// ONDO 결제 Edge Function (Supabase / Deno)
//
//  POST /functions/v1/payments/create-order  { plan }                       → 주문 생성 (금액은 서버가 정함)
//  POST /functions/v1/payments/confirm       { paymentKey, orderId, amount } → 토스 결제 승인 + 이용권 지급
//
// 필요한 환경변수(Secrets): TOSS_SECRET_KEY, ALLOWED_ORIGINS(선택, 쉼표로 구분)
// SUPABASE_URL, SUPABASE_SECRET_KEYS(없으면 SUPABASE_SERVICE_ROLE_KEY) 는 Supabase 가 자동으로 넣어 줍니다.
// 이 함수는 코드 안에서 로그인 토큰을 직접 검증하므로, 대시보드의 "Verify JWT" 는 꺼도 됩니다.

const TOSS = "https://api.tosspayments.com/v1/payments";

export interface Deps {
  tossSecretKey: string;
  allowedOrigins: string[];
  getUserId(jwt: string): Promise<string | null>;
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  fetchFn: typeof fetch;
}

// 데이터베이스 함수가 raise 하는 코드 → HTTP 상태
const KNOWN: Record<string, number> = {
  invalid_plan: 400,
  profile_required: 409,
  not_enough_candidates: 409,
  order_not_found: 404,
  amount_mismatch: 409,
  user_deleted: 409,
};

function cors(req: Request, deps: Deps): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const list = deps.allowedOrigins;
  const allow = list.includes("*") ? "*" : list.includes(origin) ? origin : (list[0] ?? "");
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, deps: Deps, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req, deps), "Content-Type": "application/json; charset=utf-8" },
  });
}

function dbError(message: string): { status: number; code: string } {
  for (const code of Object.keys(KNOWN)) if (message.includes(code)) return { status: KNOWN[code], code };
  return { status: 500, code: "server_error" };
}

function basicAuth(secret: string): string {
  return "Basic " + btoa(secret + ":");
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req, deps) });
  if (req.method !== "POST") return json(req, deps, 405, { error: "method_not_allowed" });
  if (!deps.tossSecretKey) return json(req, deps, 500, { error: "server_not_configured" });

  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const uid = jwt ? await deps.getUserId(jwt) : null;
  if (!uid) return json(req, deps, 401, { error: "unauthorized" });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json(req, deps, 400, { error: "bad_request" }); }

  const route = new URL(req.url).pathname.split("/").filter(Boolean).pop();

  // ---------- 주문 생성 ----------
  if (route === "create-order") {
    const plan = String(body.plan ?? "");
    const { data, error } = await deps.rpc("create_order", { p_uid: uid, p_plan: plan });
    if (error) { const e = dbError(error.message); return json(req, deps, e.status, { error: e.code }); }
    const o = data as { order_id: string; order_name: string; amount: number };
    return json(req, deps, 200, { orderId: o.order_id, orderName: o.order_name, amount: o.amount });
  }

  // ---------- 결제 승인 ----------
  if (route === "confirm") {
    const paymentKey = String(body.paymentKey ?? "");
    const orderId = String(body.orderId ?? "");
    const amount = Number(body.amount);
    if (!paymentKey || !orderId || !Number.isInteger(amount) || amount <= 0) {
      return json(req, deps, 400, { error: "bad_request" });
    }

    // 1) 내 주문이고 금액이 우리가 저장한 금액과 같은지 확인
    const begin = await deps.rpc("begin_confirm", { p_uid: uid, p_order_id: orderId, p_amount: amount });
    if (begin.error) { const e = dbError(begin.error.message); return json(req, deps, e.status, { error: e.code }); }
    const state = begin.data as { status: string; plan: string };
    if (state.status === "paid") return json(req, deps, 200, { ok: true, plan: state.plan, already: true });
    if (state.status !== "pending") return json(req, deps, 409, { error: "order_closed" });

    const fulfill = async (key: string, method: string) => {
      const r = await deps.rpc("fulfill_order", { p_order_id: orderId, p_payment_key: key, p_amount: amount, p_method: method });
      if (r.error) { const e = dbError(r.error.message); return json(req, deps, e.status, { error: e.code }); }
      return json(req, deps, 200, { ok: true, plan: (r.data as { plan: string }).plan });
    };

    // 2) 토스에 승인 요청
    let res: Response;
    try {
      res = await deps.fetchFn(`${TOSS}/confirm`, {
        method: "POST",
        headers: { Authorization: basicAuth(deps.tossSecretKey), "Content-Type": "application/json" },
        body: JSON.stringify({ paymentKey, orderId, amount }),
      });
    } catch {
      // 네트워크 오류: 결제가 됐는지 모르므로 주문을 닫지 않고 다시 시도할 수 있게 둡니다.
      return json(req, deps, 502, { error: "toss_unreachable" });
    }
    const payment = await res.json().catch(() => ({} as Record<string, unknown>));

    if (res.ok) {
      const p = payment as { status?: string; orderId?: string; totalAmount?: number; method?: string };
      if (p.status !== "DONE" || p.orderId !== orderId || (p.totalAmount !== undefined && p.totalAmount !== amount)) {
        return json(req, deps, 409, { error: "payment_not_done" });
      }
      return fulfill(paymentKey, p.method ?? "");
    }

    // 3) 승인이 실패해도 이미 처리된 결제일 수 있으니 주문번호로 한 번 더 조회해서 복구합니다.
    if (res.status >= 500) return json(req, deps, 502, { error: "toss_unavailable" });
    try {
      const look = await deps.fetchFn(`${TOSS}/orders/${encodeURIComponent(orderId)}`, {
        headers: { Authorization: basicAuth(deps.tossSecretKey) },
      });
      if (look.ok) {
        const p = await look.json() as { status?: string; paymentKey?: string; totalAmount?: number; method?: string };
        if (p.status === "DONE" && p.paymentKey === paymentKey && p.totalAmount === amount) {
          return fulfill(paymentKey, p.method ?? "");
        }
      }
    } catch { /* 조회 실패는 아래 실패 처리로 이어집니다 */ }

    await deps.rpc("fail_order", { p_order_id: orderId, p_status: "failed" });
    const t = payment as { code?: string; message?: string };
    return json(req, deps, 402, { error: "payment_failed", code: t.code ?? null, message: t.message ?? null });
  }

  return json(req, deps, 404, { error: "not_found" });
}

// Supabase(Deno) 에서만 서버를 시작합니다. (테스트할 때는 handle 만 가져다 씁니다)
// deno-lint-ignore no-explicit-any
const g = globalThis as any;
if (typeof g.Deno !== "undefined" && g.Deno.serve) {
  const { createClient } = await import("npm:@supabase/supabase-js@2");
  // 새 방식의 secret 키(SUPABASE_SECRET_KEYS)를 먼저 쓰고, 없으면 예전 service_role 키로 돌아갑니다.
  // (예전 키는 2026년 말까지만 작동한다고 Supabase 가 안내했어요)
  let serverKey = "";
  try { serverKey = JSON.parse(g.Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}")["default"] ?? ""; } catch { /* 없으면 아래로 */ }
  if (!serverKey) serverKey = g.Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const admin = createClient(g.Deno.env.get("SUPABASE_URL")!, serverKey, {
    auth: { persistSession: false },
  });
  g.Deno.serve((req: Request) =>
    handle(req, {
      tossSecretKey: g.Deno.env.get("TOSS_SECRET_KEY") ?? "",
      allowedOrigins: (g.Deno.env.get("ALLOWED_ORIGINS") ?? "*").split(",").map((s: string) => s.trim()).filter(Boolean),
      getUserId: async (jwt: string) => {
        const { data, error } = await admin.auth.getUser(jwt);
        return error ? null : (data.user?.id ?? null);
      },
      rpc: (name, args) => admin.rpc(name, args),
      fetchFn: fetch,
    })
  );
}
