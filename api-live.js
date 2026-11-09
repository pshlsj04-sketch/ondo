// 실서비스 모드: Supabase(로그인 + 데이터베이스 함수) 와 결제 Edge Function 을 호출합니다.
// 브라우저는 테이블을 직접 읽거나 쓰지 않고 schema.sql 에 만든 함수(RPC)만 부릅니다.
(function (O) {
  "use strict";

  var MSG = {
    not_authenticated: "로그인이 필요해요.",
    not_available: "지금 열려 있는 추천이 아니에요.",
    already_requested: "이미 신청한 분이에요.",
    no_asks_left: "남은 대화 신청이 없어요. 이용권을 확인해주세요.",
    not_found: "이미 처리됐거나 찾을 수 없는 요청이에요.",
    invalid_target: "본인에게는 사용할 수 없어요.",
    profile_required: "프로필과 온도 테스트를 먼저 완료해주세요.",
    not_enough_candidates: "지금은 열 수 있는 추천이 부족해요. 새 회원이 가입하면 열려요.",
    invalid_plan: "알 수 없는 이용권이에요.",
    unauthorized: "로그인이 만료됐어요. 다시 로그인해주세요.",
    toss_unreachable: "결제 서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요.",
    toss_unavailable: "결제 서버가 응답하지 않아요. 잠시 후 다시 시도해주세요.",
    order_closed: "이미 종료된 주문이에요. 다시 결제를 시작해주세요.",
    amount_mismatch: "결제 금액이 달라 처리하지 않았어요.",
    beta_closed: "무료 이용권 이벤트가 끝났어요. 새로고침하면 이용권 결제를 이용할 수 있어요.",
    already_active: "이미 이용권이 열려 있어요.",
    consent_required: "'만나고 싶은 상대' 정보 수집·이용에 동의해주세요."
  };
  function rawOf(e) {
    // DB 오류는 code(P0001 등)가 아니라 message 에 우리가 던진 코드가 들어 있습니다.
    return e ? [e.message, e.error, e.code].filter(Boolean).join(" ") : "";
  }
  function keyOf(e) { var raw = rawOf(e); for (var k in MSG) if (raw.indexOf(k) >= 0) return k; return null; }
  function pretty(e) {
    var raw = rawOf(e), low = raw.toLowerCase(), key = keyOf(e);
    if (key) return MSG[key];
    if (low.indexOf("invalid login credentials") >= 0) return "이메일 또는 비밀번호가 맞지 않아요.";
    if (low.indexOf("email not confirmed") >= 0) return "이메일 인증을 먼저 완료해주세요. 메일함을 확인해주세요.";
    if (low.indexOf("already registered") >= 0) return "이미 가입된 이메일이에요. 로그인해주세요.";
    if (low.indexOf("rate limit") >= 0 || low.indexOf("over_email_send_rate_limit") >= 0) return "요청이 너무 많아요. 잠시 후 다시 시도해주세요.";
    if (low.indexOf("password") >= 0 && low.indexOf("least") >= 0) return "비밀번호는 영문과 숫자를 포함해 8자 이상이어야 해요.";
    if (low.indexOf("failed to fetch") >= 0 || low.indexOf("networkerror") >= 0) return "네트워크에 연결하지 못했어요. 잠시 후 다시 시도해주세요.";
    return "요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요.";
  }
  function wrap(e) { var x = new Error(pretty(e)); x.code = keyOf(e) || "error"; x.raw = e; return x; }

  O.createLiveAPI = function (cfg) {
    var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" }
    });
    var base = location.origin + location.pathname;
    var fnBase = cfg.supabaseUrl.replace(/\/+$/, "") + "/functions/v1/payments";

    function rpc(name, args) {
      return sb.rpc(name, args || {}).then(function (r) { if (r.error) throw wrap(r.error); return r.data; });
    }
    function token() {
      return sb.auth.getSession().then(function (r) {
        var s = r.data && r.data.session; if (!s) throw wrap({ error: "unauthorized" }); return s.access_token;
      });
    }
    function userOf(u) { return u ? { id: u.id, email: u.email } : null; }

    var API = {
      mode: "live",
      onAuth: null,
      init: function () {
        sb.auth.onAuthStateChange(function (evt, session) { if (API.onAuth) API.onAuth(evt, session); });
        return sb.auth.getSession().then(function (r) { return userOf(r.data && r.data.session && r.data.session.user); });
      },
      signUp: function (email, pw, mkt) {
        return sb.auth.signUp({ email: email, password: pw, options: { emailRedirectTo: base, data: { mkt: !!mkt, agreed_at: new Date().toISOString() } } })
          .then(function (r) {
            if (r.error) throw wrap(r.error);
            if (r.data.user && r.data.user.identities && r.data.user.identities.length === 0) throw wrap({ message: "User already registered" });
            return { needsConfirm: !r.data.session, user: userOf(r.data.user) };
          });
      },
      signIn: function (email, pw) {
        return sb.auth.signInWithPassword({ email: email, password: pw }).then(function (r) {
          if (r.error) throw wrap(r.error); return userOf(r.data.user);
        });
      },
      signOut: function () { return sb.auth.signOut().then(function () {}); },
      resetPassword: function (email) {
        return sb.auth.resetPasswordForEmail(email, { redirectTo: base }).then(function (r) { if (r.error) throw wrap(r.error); });
      },
      updatePassword: function (pw) {
        return sb.auth.updateUser({ password: pw }).then(function (r) { if (r.error) throw wrap(r.error); });
      },
      deleteAccount: function () { return rpc("delete_my_account").then(function () { return sb.auth.signOut(); }); },
      me: function () {
        return Promise.all([rpc("get_me"), sb.auth.getSession()]).then(function (a) {
          var m = a[0] || {}, s = a[1].data && a[1].data.session;
          return {
            email: s && s.user ? s.user.email : "",
            profile: m.profile || null,
            result: m.result ? { dims: [m.result.d0, m.result.d1, m.result.d2], temp: Number(m.result.temp) } : null,
            pass: m.pass || null,
            orders: (m.orders || []).map(function (o) { return { id: o.id, plan: o.plan, amount: o.amount, status: o.status, at: Date.parse(o.created_at) }; }),
            inboxCount: Number(m.inbox_count || 0)
          };
        });
      },
      saveProfile: function (p) {
        return rpc("save_profile", { p_nick: p.nick, p_age: p.age, p_gender: p.gender, p_seek: p.seek, p_region: p.region, p_amin: p.amin, p_amax: p.amax, p_bio: p.bio, p_contact: p.contact, p_consent: !!p.consent });
      },
      submitResult: function (dims) {
        return rpc("submit_result", { p_d0: dims[0], p_d1: dims[1], p_d2: dims[2] }).then(function (r) {
          return { dims: [r.d0, r.d1, r.d2], temp: Number(r.temp) };
        });
      },
      recommend: function () {
        return rpc("recommend").then(function (rows) {
          rows = rows || [];
          return {
            total: rows.length ? Number(rows[0].total) : 0,
            list: rows.map(function (r) {
              return {
                rank: r.rank, id: r.cand_id, nick: r.nick, age: r.age, region: r.region, temp: Number(r.temp), score: r.score,
                diffs: [r.diff0, r.diff1, r.diff2], same: r.same_region, outAge: r.out_age, opened: r.opened, bio: r.bio,
                status: r.req_status, total: Number(r.total)
              };
            })
          };
        });
      },
      sendRequest: function (id) { return rpc("send_request", { p_to: id }); },
      inbox: function () {
        return rpc("inbox").then(function (rows) {
          return (rows || []).map(function (r) {
            return { id: r.id, userId: r.user_id, nick: r.nick, age: r.age, region: r.region, bio: r.bio, temp: Number(r.temp), score: r.score };
          });
        });
      },
      respond: function (id, accept) { return rpc("respond_request", { p_id: id, p_accept: !!accept }); },
      matches: function () {
        return rpc("my_matches").then(function (rows) {
          return (rows || []).map(function (r) { return { userId: r.user_id, nick: r.nick, age: r.age, region: r.region, contact: r.contact, at: Date.parse(r.matched_at) }; });
        });
      },
      report: function (id, reason) { return rpc("report_user", { p_target: id, p_reason: reason || "" }); },
      appStatus: function () {
        return rpc("app_status").then(function (r) { return { betaFree: !!(r && r.beta_free) }; });
      },
      claimBeta: function () { return rpc("claim_beta_pass"); },
      prepareOrder: function (plan) {
        return token().then(function (t) {
          return fetch(fnBase + "/create-order", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t }, body: JSON.stringify({ plan: plan })
          });
        }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (b) {
            if (!res.ok) throw wrap(b); b.plan = plan; return b;
          });
        }, function (e) { throw wrap(e); });
      }
    };
    return API;
  };
})(window.ONDO);
