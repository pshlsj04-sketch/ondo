// 데모 모드: 서버 없이 브라우저(localStorage)에만 저장합니다. 설정(config.js)이 비어 있을 때 사용됩니다.
// API 의 모양은 api-live.js 와 같습니다. app.js 는 둘 중 무엇이 연결됐는지 신경 쓰지 않습니다.
(function (O) {
  "use strict";
  var ACC = "ondo2.acc", SES = "ondo2.ses", DK = "ondo2.d.";
  var ACCEPT_AFTER_MS = 4000; // 데모에서는 신청이 몇 초 뒤 자동 수락됩니다.

  function ls(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function err(msg, code) { var e = new Error(msg); e.code = code || "error"; return e; }
  function hashPw(pw, salt) {
    return Promise.resolve().then(function () {
      return crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + ":" + pw));
    }).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    }).catch(function () { return "x" + btoa(unescape(encodeURIComponent(salt + ":" + pw))); });
  }

  var email = null, d = null;
  function blank() { return { profile: null, result: null, orders: [], passes: [], reqs: {}, inbox: null, matches: [], blocked: {} }; }
  function load(e) { email = e; d = ls(DK + e, null) || blank(); }
  function save() { if (email) lsSet(DK + email, d); }
  function need() { if (!email) throw err("로그인이 필요해요.", "not_authenticated"); }

  function activePasses() { var now = Date.now(); return d.passes.filter(function (p) { return p.until > now; }); }
  function passSummary() {
    var ps = activePasses();
    if (!ps.length) return null;
    var picks = 0, left = 0, unlimited = false, until = 0, best = ps[0];
    ps.forEach(function (p) {
      if (p.picks > picks) { picks = p.picks; best = p; }
      if (p.asks === null) unlimited = true; else left += p.asks - p.used;
      if (p.until > until) until = p.until;
    });
    return { plan: best.plan, picks: picks, asks_left: left, unlimited: unlimited, expires_at: new Date(until).toISOString() };
  }
  function reqState(id) {
    var r = d.reqs[id]; if (!r) return null;
    if (r.status === "pending" && Date.now() - r.at >= ACCEPT_AFTER_MS) { r.status = "accepted"; r.at2 = Date.now(); save(); }
    return r.status === "pending" ? "sent" : r.status;
  }
  function incomingSample() {
    if (!d.profile || !d.result) return null;
    if (d.inbox === null) {
      var seek = d.profile.seek;
      var pick = O.POOL_INCOMING.filter(function (c) { return seek === "모두" || c.g === seek; })[0];
      d.inbox = pick ? [pick.n] : []; save();
    }
    return d.inbox.map(function (n) { return O.POOL_INCOMING.filter(function (c) { return c.n === n; })[0]; }).filter(Boolean);
  }
  function scoreOf(v) {
    var r = d.result, dist = Math.sqrt(v.reduce(function (s, x, i) { return s + Math.pow(x - r.dims[i], 2); }, 0));
    return Math.max(0, Math.min(99, Math.round(100 - dist * 0.6)));
  }
  function userObj() { return email ? { id: email, email: email } : null; }

  var API = {
    mode: "demo",
    onAuth: null,
    init: function () {
      var e = ls(SES, null);
      if (e && ls(ACC, {})[e]) load(e); else if (e) lsDel(SES);
      return Promise.resolve(userObj());
    },
    signUp: function (mail, pw, mkt) {
      var accs = ls(ACC, {});
      if (accs[mail]) return Promise.reject(err("이미 가입된 이메일이에요. 로그인해주세요.", "exists"));
      var salt = String(Math.random()).slice(2) + Date.now();
      return hashPw(pw, salt).then(function (hash) {
        accs[mail] = { salt: salt, hash: hash, at: Date.now(), mkt: !!mkt };
        lsSet(ACC, accs); lsSet(SES, mail); load(mail);
        return { needsConfirm: false, user: userObj() };
      });
    },
    signIn: function (mail, pw) {
      var acc = ls(ACC, {})[mail];
      if (!acc) return Promise.reject(err("이메일 또는 비밀번호가 맞지 않아요.", "invalid"));
      return hashPw(pw, acc.salt).then(function (hash) {
        if (hash !== acc.hash) throw err("이메일 또는 비밀번호가 맞지 않아요.", "invalid");
        lsSet(SES, mail); load(mail); return userObj();
      });
    },
    signOut: function () { lsDel(SES); email = null; d = null; return Promise.resolve(); },
    resetPassword: function () { return Promise.reject(err("데모에서는 비밀번호 재설정 메일을 보내지 않아요.", "demo")); },
    updatePassword: function () { return Promise.reject(err("데모에서는 지원하지 않아요.", "demo")); },
    deleteAccount: function () {
      need(); var accs = ls(ACC, {}); delete accs[email]; lsSet(ACC, accs); lsDel(DK + email); lsDel(SES);
      email = null; d = null; return Promise.resolve();
    },
    me: function () {
      need();
      var inc = incomingSample();
      return Promise.resolve({
        email: email, profile: d.profile, result: d.result, pass: passSummary(),
        orders: d.orders.map(function (o) { return { id: o.id, plan: o.plan, amount: o.amount, status: "paid", at: o.at }; }).reverse(),
        inboxCount: inc ? inc.length : 0
      });
    },
    saveProfile: function (p) {
      need();
      if (!p.consent && !(d.profile && d.profile.consent)) return Promise.reject(err("'만나고 싶은 상대' 정보 수집·이용에 동의해주세요.", "consent_required"));
      p.consent = true; d.profile = p; save(); return Promise.resolve();
    },
    submitResult: function (dims) {
      need(); d.result = { dims: dims, temp: O.tempOf(dims) }; save();
      return Promise.resolve(d.result);
    },
    recommend: function () {
      need();
      var p = d.profile, ps = passSummary(), picks = ps ? ps.picks : 0;
      var list = O.POOL.filter(function (c) { return (p.seek === "모두" || c.g === p.seek) && !d.blocked[c.n]; }).map(function (c) {
        var diffs = c.v.map(function (x, i) { return Math.abs(x - d.result.dims[i]); });
        var dist = Math.sqrt(diffs.reduce(function (s, x) { return s + x * x; }, 0));
        var out = c.a < p.amin || c.a > p.amax, same = c.r === p.region;
        return { c: c, diffs: diffs, out: out, same: same, key: dist + (out ? 30 : 0) - (same ? 6 : 0) };
      }).sort(function (a, b) { return a.key - b.key; });
      var total = list.length;
      var rows = list.slice(0, 3).map(function (m, i) {
        var open = i < picks;
        return {
          rank: i + 1, id: open ? m.c.n : null, nick: open ? m.c.n : m.c.n.charAt(0) + "＊", age: m.c.a, region: m.c.r,
          temp: O.tempOf(m.c.v), score: scoreOf(m.c.v), diffs: m.diffs, same: m.same, outAge: m.out,
          opened: open, bio: open ? m.c.b : null, status: reqState(m.c.n), total: total
        };
      });
      return Promise.resolve({ list: rows, total: total });
    },
    sendRequest: function (id) {
      need();
      var ps = passSummary(); if (!ps || !O.POOL.some(function (c) { return c.n === id; })) return Promise.reject(err("지금 열려 있는 추천이 아니에요.", "not_available"));
      if (d.reqs[id]) return Promise.reject(err("이미 신청한 분이에요.", "already_requested"));
      if (!ps.unlimited) {
        var p = activePasses().filter(function (x) { return x.asks !== null && x.used < x.asks; }).sort(function (a, b) { return a.until - b.until; })[0];
        if (!p) return Promise.reject(err("남은 대화 신청이 없어요. 이용권을 확인해주세요.", "no_asks_left"));
        p.used++;
      }
      d.reqs[id] = { status: "pending", at: Date.now() }; save();
      return Promise.resolve({ matched: false });
    },
    inbox: function () {
      need(); var inc = incomingSample() || [];
      return Promise.resolve(inc.map(function (c) {
        return { id: "in-" + c.n, userId: "demo:" + c.n, nick: c.n, age: c.a, region: c.r, bio: c.b, temp: O.tempOf(c.v), score: scoreOf(c.v) };
      }));
    },
    respond: function (id, accept) {
      need(); var n = id.replace(/^in-/, "");
      d.inbox = (d.inbox || []).filter(function (x) { return x !== n; });
      if (accept) d.matches.unshift({ n: n, at: Date.now(), incoming: true });
      save(); return Promise.resolve();
    },
    matches: function () {
      need();
      Object.keys(d.reqs).forEach(reqState);
      var out = [];
      Object.keys(d.reqs).forEach(function (n) {
        var r = d.reqs[n]; if (r.status !== "accepted") return;
        var c = O.POOL.filter(function (x) { return x.n === n; })[0]; if (!c || d.blocked[n]) return;
        out.push({ userId: "demo:" + n, nick: n, age: c.a, region: c.r, contact: "open.kakao.com/o/demo-" + n, at: r.at2 || r.at });
      });
      d.matches.forEach(function (m) {
        var c = O.POOL_INCOMING.filter(function (x) { return x.n === m.n; })[0];
        if (c) out.push({ userId: "demo:" + m.n, nick: m.n, age: c.a, region: c.r, contact: "open.kakao.com/o/demo-" + m.n, at: m.at });
      });
      out.sort(function (a, b) { return b.at - a.at; });
      return Promise.resolve(out);
    },
    report: function (id) { need(); d.blocked[id] = true; save(); return Promise.resolve(); },
    // 데모에서는 config.js 의 freeBeta 값으로 무료 베타 화면을 미리 볼 수 있어요.
    appStatus: function () { return Promise.resolve({ betaFree: !!(window.ONDO_CONFIG && window.ONDO_CONFIG.freeBeta) }); },
    claimBeta: function () {
      need();
      if (!window.ONDO_CONFIG || !window.ONDO_CONFIG.freeBeta) return Promise.reject(err("무료 이용권 이벤트가 끝났어요.", "beta_closed"));
      if (!d.profile || !d.result) return Promise.reject(err("프로필과 온도 테스트를 먼저 완료해주세요.", "profile_required"));
      if (activePasses().some(function (p) { return p.picks >= 3; })) return Promise.reject(err("이미 이용권이 열려 있어요.", "already_active"));
      d.passes.push({ plan: "beta", picks: 3, asks: 3, used: 0, until: Date.now() + 30 * 864e5 });
      save(); return Promise.resolve({ plan: "beta" });
    },
    prepareOrder: function (plan) {
      need(); var p = O.PLANS[plan]; if (!p) return Promise.reject(err("알 수 없는 이용권이에요.", "invalid_plan"));
      return Promise.resolve({ orderId: "DEMO-" + Date.now().toString(36).toUpperCase(), orderName: "ONDO " + p.name, amount: p.price, plan: plan });
    },
    payDemo: function (order) {
      need();
      return new Promise(function (resolve) {
        setTimeout(function () {
          var p = O.PLANS[order.plan];
          d.orders.push({ id: order.orderId, plan: order.plan, amount: order.amount, at: Date.now(), test: true });
          d.passes.push({ plan: order.plan, picks: p.picks, asks: p.asks, used: 0, until: Date.now() + p.days * 864e5 });
          save(); resolve();
        }, 1400);
      });
    }
  };
  O.DemoAPI = API;
})(window.ONDO);
