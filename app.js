// 화면 동작. 데모(api-demo.js)와 실서비스(api-live.js)는 같은 모양의 API 를 가지므로 이 파일은 둘을 구분하지 않습니다.
(function () {
  "use strict";
  var O = window.ONDO, CFG = window.ONDO_CONFIG || {};
  var WANT_LIVE = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
  // 이메일 인증/비밀번호 재설정 링크로 돌아온 경우인지는 Supabase 가 주소를 정리하기 전에 기록해 둡니다.
  var FROM_LINK = /[#&?](access_token|code)=/.test(location.hash + location.search);
  var IS_RECOVERY = /type=recovery/.test(location.hash);

  var $ = function (id) { return document.getElementById(id); };
  function h(tag, props) {
    var e = document.createElement(tag), p = props || {};
    Object.keys(p).forEach(function (k) {
      var v = p[k];
      if (k === "class") e.className = v; else if (k === "text") e.textContent = v;
      else if (k.indexOf("on") === 0) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i]; if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) e.append(x.nodeType ? x : document.createTextNode(x)); });
      else e.append(c.nodeType ? c : document.createTextNode(c));
    }
    return e;
  }
  function ls(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function toast(msg) { var t = $("toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast.h); toast.h = setTimeout(function () { t.classList.remove("on"); }, 3200); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function busy(btn, fn) {
    if (!btn || btn.disabled) return Promise.resolve();
    btn.disabled = true;
    return Promise.resolve().then(fn).then(function (r) { btn.disabled = false; return r; }, function (e) { btn.disabled = false; throw e; });
  }
  function fail(e) { toast(e && e.message ? e.message : "요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요."); }

  if (WANT_LIVE && !window.supabase) {
    document.body.textContent = "";
    document.body.appendChild(h("p", { style: "padding:48px 24px;font-size:16px;line-height:1.8", text: "서비스에 연결하지 못했어요. 네트워크를 확인하고 새로고침해주세요." }));
    return;
  }
  var LIVE = WANT_LIVE;
  var API = LIVE ? O.createLiveAPI(CFG) : O.DemoAPI;
  document.documentElement.setAttribute("data-mode", LIVE ? "live" : "demo");
  var IS_TEST_KEY = /^test_/.test(CFG.tossClientKey || "");

  var S = { user: null, me: null, recTotal: null, recovery: IS_RECOVERY, beta: false };
  var PLAN_NOTE0 = $("plan-note").textContent;
  var D = { answers: [], idx: 0, busy: false };

  /* ---------- 라우터 ---------- */
  var VIEWS = ["home", "login", "signup", "reset", "profile", "test", "result", "my"];
  var seq = 0, lastView = null;
  function go(v) { if (location.hash.replace("#", "") === v) route(); else location.hash = v; }
  function nextStep() {
    if (!S.user) return "signup";
    var m = S.me || {};
    if (!m.profile) return "profile";
    if (!m.result) return "test";
    return "result";
  }
  function refreshMe() { return API.me().then(function (m) { S.me = m; return m; }); }
  async function route() {
    var my = ++seq;
    var v = location.hash.replace("#", "");
    if (VIEWS.indexOf(v) < 0) v = "home";
    if (S.user && !S.me) { try { await refreshMe(); } catch (e) { fail(e); } if (my !== seq) return; }
    var me = S.me || {};
    if (!S.user && ["profile", "test", "result", "my"].indexOf(v) >= 0) v = "login";
    if (S.user && v === "test" && !me.profile) v = "profile";
    if (S.user && v === "result" && !me.result) v = me.profile ? "test" : "profile";
    if (S.user && (v === "login" || v === "signup")) v = nextStep();
    VIEWS.forEach(function (n) { $("v-" + n).hidden = n !== v; });
    document.body.setAttribute("data-view", v);
    renderNav();
    // 같은 화면으로의 중복 이동(해시 이벤트 재발생 등)에는 열려 있는 결제창을 닫지 않습니다.
    if (v !== lastView) closePay(true);
    lastView = v;
    if (v === "reset") { $("reset-ask").hidden = S.recovery; $("reset-new").hidden = !S.recovery; }
    if (v === "profile") fillProfile();
    if (v === "test") startTest();
    if (v === "result") renderResult(my);
    if (v === "my") renderMy(my);
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);
  function renderNav() {
    var on = !!S.user, m = S.me || {};
    $("nav-login").hidden = on; $("nav-me").hidden = !on;
    if (on) $("nav-me").textContent = (m.profile ? m.profile.nick + "님" : "내 정보") + (m.inboxCount ? " · 새 신청 " + m.inboxCount : "");
    $("nav-start").textContent = on ? (m.result ? "내 결과" : "이어하기") : "시작하기";
    renderBeta();
  }
  // 무료 베타 기간이면 요금 안내와 이용권 버튼을 "무료로 열어보기"로 바꿔요. (켜고 끄는 건 서버 설정값이 기준)
  function renderBeta() {
    var note = $("plan-note"), pass = S.me && S.me.pass;
    $("beta-banner").hidden = !S.beta;
    var text = S.beta ? "지금은 베타 기간이라 이용권을 무료로 열어 드려요. 정식 오픈 후에는 위 요금이 적용돼요."
      : LIVE ? (IS_TEST_KEY ? "현재 결제 테스트 중이라 실제로 청구되지 않아요." : "") : PLAN_NOTE0;
    note.textContent = text; note.hidden = !text;
    $("r-unlock").textContent = S.beta ? "무료로 열어보기" : "이용권 보기";
    $("m-buy").textContent = S.beta ? "무료 이용권 받기" : "이용권 보기";
    $("m-buy").hidden = !!(S.beta && pass && pass.picks >= 3);
  }
  async function claimBeta(btn) {
    if (!S.user) { go("login"); return; }
    try {
      await busy(btn, async function () {
        await API.claimBeta();
        await refreshMe(); S.recTotal = null; renderNav();
        toast("베타 무료 이용권이 열렸어요. 30일 동안 쓸 수 있어요.");
        if (document.body.getAttribute("data-view") === "result") renderResult(); else go("result");
      });
    } catch (e) {
      fail(e);
      if (e && e.code === "beta_closed") { S.beta = false; renderBeta(); }
    }
  }
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-go]"); if (t) { go(t.getAttribute("data-go")); return; }
    t = e.target.closest("[data-start]"); if (t) { go(nextStep()); return; }
    t = e.target.closest("[data-soon]"); if (t) { toast(t.getAttribute("data-soon")); return; }
    t = e.target.closest("[data-scroll]");
    if (t) {
      var id = t.getAttribute("data-scroll");
      var run = function () { var el = $(id); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); };
      if (document.body.getAttribute("data-view") !== "home") { go("home"); setTimeout(run, 80); } else run();
    }
  });
  $("logo").addEventListener("click", function () { go("home"); });
  $("nav-start").addEventListener("click", function () { go(nextStep()); });
  $("nav-me").addEventListener("click", function () { go("my"); });

  /* ---------- 폼 공통 ---------- */
  function setErr(id, msg) { var e = $("e-" + id), f = $("f-" + id); if (e) e.textContent = msg || ""; if (f) f.classList.toggle("bad", !!msg); }
  function wireClear(ids) { ids.forEach(function (id) { var el = $(id); if (el) el.addEventListener("input", function () { setErr(id); }); }); }
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function pwOk(pw) { return pw.length >= 8 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw); }
  function submitBtn(form) { return form.querySelector('[type="submit"]'); }

  /* ---------- 회원가입 / 로그인 / 재설정 ---------- */
  var tAll = $("t-all"), tBoxes = Array.prototype.slice.call(document.querySelectorAll("#terms .t"));
  tAll.addEventListener("change", function () { tBoxes.forEach(function (b) { b.checked = tAll.checked; }); setErr("s-terms"); });
  tBoxes.forEach(function (b) { b.addEventListener("change", function () { tAll.checked = tBoxes.every(function (x) { return x.checked; }); setErr("s-terms"); }); });
  wireClear(["s-email", "s-pw", "s-pw2", "l-email", "l-pw", "r-email", "n-pw", "n-pw2"]);

  async function afterAuth() { S.me = null; await refreshMe(); go(nextStep()); }

  $("signup-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var form = e.target, email = $("s-email").value.trim().toLowerCase(), pw = $("s-pw").value, pw2 = $("s-pw2").value, ok = true, first = null;
    ["s-email", "s-pw", "s-pw2", "s-terms"].forEach(function (i) { setErr(i); });
    function bad(id, m, el) { setErr(id, m); ok = false; if (!first) first = el; }
    if (!EMAIL_RE.test(email)) bad("s-email", "이메일 형식을 확인해주세요.", $("s-email"));
    if (!pwOk(pw)) bad("s-pw", "영문과 숫자를 포함해 8자 이상 입력해주세요.", $("s-pw"));
    if (pw2 !== pw) bad("s-pw2", "비밀번호가 서로 달라요.", $("s-pw2"));
    if (!$("t-age").checked || !$("t-priv").checked) bad("s-terms", "필수 항목에 동의해주세요.", $("t-age"));
    if (!ok) { first.focus(); return; }
    busy(submitBtn(form), async function () {
      try {
        var r = await API.signUp(email, pw, $("t-mkt").checked);
        form.reset();
        if (r.needsConfirm) {
          form.hidden = true; var box = $("signup-done"); box.hidden = false;
          box.textContent = email + " 로 인증 메일을 보냈어요. 메일의 링크를 누르면 가입이 완료되고, 바로 이어서 프로필을 입력할 수 있어요. 메일이 보이지 않으면 스팸함도 확인해주세요.";
          return;
        }
        S.user = r.user; toast("가입이 완료됐어요"); await afterAuth();
      } catch (err) {
        if (err.code === "exists" || /이미 가입/.test(err.message)) setErr("s-email", err.message); else fail(err);
      }
    });
  });
  $("login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var form = e.target, email = $("l-email").value.trim().toLowerCase(), pw = $("l-pw").value;
    setErr("l-email"); setErr("l-pw");
    if (!EMAIL_RE.test(email)) { setErr("l-email", "이메일 형식을 확인해주세요."); return; }
    if (!pw) { setErr("l-pw", "비밀번호를 입력해주세요."); return; }
    busy(submitBtn(form), async function () {
      try { S.user = await API.signIn(email, pw); form.reset(); toast("로그인했어요"); await afterAuth(); }
      catch (err) { setErr("l-pw", err.message); }
    });
  });
  $("reset-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var form = e.target, email = $("r-email").value.trim().toLowerCase(); setErr("r-email");
    if (!EMAIL_RE.test(email)) { setErr("r-email", "이메일 형식을 확인해주세요."); return; }
    busy(submitBtn(form), async function () {
      try {
        await API.resetPassword(email);
        var n = $("reset-sent"); n.hidden = false; n.textContent = "가입된 이메일이라면 재설정 링크가 도착해요. 메일함과 스팸함을 확인해주세요.";
      } catch (err) { fail(err); }
    });
  });
  $("newpw-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var form = e.target, pw = $("n-pw").value, pw2 = $("n-pw2").value; setErr("n-pw"); setErr("n-pw2");
    if (!pwOk(pw)) { setErr("n-pw", "영문과 숫자를 포함해 8자 이상 입력해주세요."); return; }
    if (pw !== pw2) { setErr("n-pw2", "비밀번호가 서로 달라요."); return; }
    busy(submitBtn(form), async function () {
      try { await API.updatePassword(pw); S.recovery = false; form.reset(); toast("비밀번호를 바꿨어요"); await afterAuth(); }
      catch (err) { fail(err); }
    });
  });
  API.onAuth = function (evt) {
    if (evt === "PASSWORD_RECOVERY") { S.recovery = true; go("reset"); }
  };
  async function logout() {
    try { await API.signOut(); } catch (e) { fail(e); return; }
    S.user = null; S.me = null; toast("로그아웃했어요"); go("home");
  }

  /* ---------- 프로필 ---------- */
  (function buildSelects() {
    var age = $("age"), amin = $("amin"), amax = $("amax");
    for (var a = 20; a <= 29; a++) {
      [age, amin, amax].forEach(function (s) { s.appendChild(h("option", { value: String(a), text: a + "세" })); });
    }
    amin.value = "20"; amax.value = "29";
    O.REGIONS.forEach(function (r) { $("region").appendChild(h("option", { value: r, text: r })); });
  })();
  wireClear(["nick", "age", "gender", "seek", "region", "bio", "contact"]);
  $("bio").addEventListener("input", function () { $("bio-n").textContent = String($("bio").value.length); });
  $("amin").addEventListener("change", function () { setErr("amax"); });
  $("amax").addEventListener("change", function () { setErr("amax"); });
  function fillProfile() {
    var p = S.me && S.me.profile; if (!p) return;
    $("nick").value = p.nick; $("age").value = String(p.age); $("gender").value = p.gender;
    $("seek").value = p.seek; $("region").value = p.region; $("amin").value = String(p.amin); $("amax").value = String(p.amax);
    $("bio").value = p.bio || ""; $("contact").value = p.contact || ""; $("bio-n").textContent = String(($("bio").value || "").length);
  }
  $("profile-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var form = e.target, nick = $("nick").value.trim(), bio = $("bio").value.trim(), contact = $("contact").value.trim(), ok = true, first = null;
    ["nick", "age", "gender", "seek", "region", "amax", "bio", "contact"].forEach(function (i) { setErr(i); });
    function bad(id, m, el) { setErr(id, m); ok = false; if (!first) first = el; }
    if (nick.length < 2 || nick.length > 10) bad("nick", "닉네임은 2~10자로 입력해주세요.", $("nick"));
    if (!$("age").value) bad("age", "나이를 선택해주세요.", $("age"));
    if (!$("gender").value) bad("gender", "성별을 선택해주세요.", $("gender"));
    if (!$("seek").value) bad("seek", "만나고 싶은 상대를 선택해주세요.", $("seek"));
    if (!$("region").value) bad("region", "활동 지역을 선택해주세요.", $("region"));
    if (Number($("amin").value) > Number($("amax").value)) bad("amax", "최대 나이는 최소 나이보다 크거나 같아야 해요.", $("amax"));
    if (bio.length < 10 || bio.length > 120) bad("bio", "소개글은 10~120자로 적어주세요.", $("bio"));
    if (contact.length < 3) bad("contact", "연락 방법을 입력해주세요.", $("contact"));
    if (!ok) { first.focus(); return; }
    var p = { nick: nick, age: Number($("age").value), gender: $("gender").value, seek: $("seek").value, region: $("region").value, amin: Number($("amin").value), amax: Number($("amax").value), bio: bio, contact: contact };
    busy(submitBtn(form), async function () {
      try { await API.saveProfile(p); await refreshMe(); go(S.me.result ? "result" : "test"); } catch (err) { fail(err); }
    });
  });

  /* ---------- 테스트 ---------- */
  function draftKey() { return "ondo.draft." + (S.user ? S.user.id : "guest"); }
  function loadDraft() {
    var d = ls(draftKey(), null) || {}, a = Array.isArray(d.answers) ? d.answers.slice(0, O.Q.length) : [];
    while (a.length < O.Q.length) a.push(null);
    D.answers = a; D.busy = false;
  }
  function saveDraft() { lsSet(draftKey(), { answers: D.answers }); }
  function startTest() {
    loadDraft();
    var i = D.answers.findIndex(function (a) { return a == null; });
    D.idx = i < 0 ? 0 : i;
    $("t-wait").hidden = true; $("t-main").hidden = false;
    renderQ();
  }
  function renderQ() {
    var q = O.Q[D.idx], a = D.answers[D.idx];
    $("t-count").textContent = (D.idx + 1) + " / " + O.Q.length;
    $("t-bar").style.width = (D.idx / O.Q.length * 100) + "%";
    $("t-dim").textContent = O.DIMS[q.d].name;
    $("t-q").textContent = q.t;
    Array.prototype.forEach.call($("t-scale").children, function (b) { b.setAttribute("aria-pressed", String(Number(b.getAttribute("data-v")) === a)); });
    $("t-prev").disabled = D.idx === 0;
    $("t-next").hidden = !(a != null && D.idx < O.Q.length - 1);
  }
  function answer(v) {
    if (D.busy) return;
    D.answers[D.idx] = v; saveDraft(); renderQ();
    if (D.idx < O.Q.length - 1) {
      setTimeout(function () { if (document.body.getAttribute("data-view") === "test" && !D.busy) { D.idx++; renderQ(); } }, 220);
    } else finish();
  }
  async function finish() {
    D.busy = true;
    $("t-bar").style.width = "100%"; $("t-main").hidden = true; $("t-wait").hidden = false;
    try {
      await Promise.all([API.submitResult(O.computeDims(D.answers)), sleep(1200)]);
      lsDel(draftKey()); await refreshMe(); go("result");
    } catch (e) {
      fail(e); D.busy = false; $("t-wait").hidden = true; $("t-main").hidden = false; renderQ();
    }
  }
  $("t-scale").addEventListener("click", function (e) { var b = e.target.closest("button[data-v]"); if (b) answer(Number(b.getAttribute("data-v"))); });
  $("t-prev").addEventListener("click", function () { if (D.idx > 0) { D.idx--; renderQ(); } });
  $("t-next").addEventListener("click", function () { if (D.idx < O.Q.length - 1) { D.idx++; renderQ(); } });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closePay();
    if (document.body.getAttribute("data-view") !== "test" || $("t-main").hidden) return;
    if (e.key >= "1" && e.key <= "5") answer(Number(e.key));
    if (e.key === "ArrowLeft" && D.idx > 0) { D.idx--; renderQ(); }
  });

  /* ---------- 게이지 ---------- */
  function makeGauge() {
    var NS = "http://www.w3.org/2000/svg", R = 100, C = 2 * Math.PI * R, ARC = C * 0.75;
    function el(n, a) { var e = document.createElementNS(NS, n); Object.keys(a || {}).forEach(function (k) { e.setAttribute(k, a[k]); }); return e; }
    var svg = el("svg", { viewBox: "0 0 240 240", "class": "gauge", role: "img" });
    var tr = el("circle", { cx: 120, cy: 120, r: R, "class": "g-track", transform: "rotate(135 120 120)", "stroke-dasharray": ARC + " " + C });
    var vl = el("circle", { cx: 120, cy: 120, r: R, "class": "g-val", transform: "rotate(135 120 120)", "stroke-dasharray": "0 " + C });
    var num = el("text", { x: 120, y: 132, "class": "g-num" });
    var nTxt = document.createTextNode("36.5"), deg = el("tspan", { "class": "g-deg", dy: "-18" }); deg.textContent = "°";
    num.appendChild(nTxt); num.appendChild(deg);
    var c1 = el("text", { x: 52, y: 214, "class": "g-cap" }); c1.textContent = "30°";
    var c2 = el("text", { x: 188, y: 214, "class": "g-cap" }); c2.textContent = "44°";
    var c3 = el("text", { x: 120, y: 160, "class": "g-cap" }); c3.textContent = "연애 온도";
    [tr, vl, num, c1, c2, c3].forEach(function (n) { svg.appendChild(n); });
    return {
      el: svg,
      set: function (t) {
        var p = Math.max(0, Math.min(1, (t - 30) / 14));
        nTxt.nodeValue = t.toFixed(1);
        vl.setAttribute("stroke-dasharray", (ARC * p) + " " + C);
        svg.setAttribute("aria-label", "연애 온도 " + t.toFixed(1) + "도");
      }
    };
  }

  /* ---------- 결과 ---------- */
  function argmin(a) { return a.indexOf(Math.min.apply(null, a)); }
  function argmax(a) { return a.indexOf(Math.max.apply(null, a)); }
  var armedReport = null;

  function reportBtn(userId, after) {
    var b = h("button", { type: "button", "class": "linkbtn", text: "신고·차단" }), t;
    b.addEventListener("click", async function () {
      if (b.dataset.armed !== "1") {
        b.dataset.armed = "1"; b.textContent = "정말 신고·차단할게요"; t = setTimeout(function () { b.dataset.armed = ""; b.textContent = "신고·차단"; }, 4000); return;
      }
      clearTimeout(t);
      try { await API.report(userId, "사용자 신고"); toast("신고하고 차단했어요. 이 분은 더 이상 보이지 않아요."); await after(); } catch (e) { fail(e); }
    });
    return b;
  }

  async function renderResult(my) {
    var me = S.me, r = me.result, p = me.profile, t = O.typeOf(r.temp);
    $("r-who").textContent = p.nick + "님의 연애 온도";
    var g = makeGauge(); $("r-gauge").textContent = ""; $("r-gauge").appendChild(g.el); g.set(30);
    setTimeout(function () { g.set(r.temp); }, 60);
    $("r-type").textContent = t.name + "형"; $("r-desc").textContent = t.desc;
    var box = $("r-dims"); box.textContent = "";
    O.DIMS.forEach(function (d, i) {
      var v = r.dims[i];
      box.appendChild(h("div", { "class": "dim" },
        h("h3", {}, d.name, h("span", { text: v + " / 100" })),
        h("div", { "class": "track" }, h("s", { style: "width:" + v + "%" }), h("b", { style: "left:" + v + "%" })),
        h("div", { "class": "poles" }, h("span", { text: d.lo }), h("span", { text: d.hi }))));
    });
    $("r-title").textContent = p.nick + "님과 잘 맞는 온도";
    var cs = $("r-cands"); cs.textContent = ""; $("r-empty").hidden = true; $("r-lock").hidden = true;
    var rec;
    try { rec = await API.recommend(); } catch (e) { fail(e); return; }
    if (my !== undefined && my !== seq) return;
    S.recTotal = rec.total;
    $("r-share").hidden = true;

    if (rec.total === 0) {
      var em = $("r-empty"); em.hidden = false;
      em.textContent = "아직 " + p.nick + "님과 조건이 맞는 분이 없어요. 새 회원이 가입하면 이곳에 나타나요. "
        + (S.beta ? "추천할 분이 생기면 이 화면에서 \"무료로 열어보기\"를 눌러 바로 볼 수 있어요." : "추천할 분이 생기기 전에는 결제하지 않아도 돼요.");
      return;
    }
    var pass = me.pass, picks = pass ? pass.picks : 0;
    var asksLeft = pass ? (pass.unlimited ? Infinity : pass.asks_left) : 0;

    rec.list.forEach(function (m, idx) {
      var open = m.opened, why = [];
      if (open) {
        why.push(O.DIMS[argmin(m.diffs)].same);
        if (m.diffs[argmax(m.diffs)] >= 20) why.push(O.DIMS[argmax(m.diffs)].diff + "은 조금 달라서 서로 이야기해 볼 만해요");
        if (m.outAge) why.push("선호 나이대에서 조금 벗어나 있어요");
      } else { why = ["이용권을 열면 맞춤 이유를 볼 수 있어요", "비슷한 점과 다른 점을 함께 알려드려요"]; }

      var action = null;
      if (open) {
        var st = m.status;
        if (st === "accepted") action = h("button", { type: "button", "class": "btn sm", text: "매칭 성사 · 연락처 보기", onclick: function () { go("my"); } });
        else if (st === "sent") action = h("span", { "class": "pill on", text: "신청함 · 답을 기다리는 중" });
        else if (st === "declined") action = h("span", { "class": "pill", text: "정중히 거절됐어요" });
        else {
          var incoming = st === "received";
          var can = incoming || asksLeft > 0;
          var btn = h("button", { type: "button", "class": "btn line sm", text: incoming ? "대화 시작하기" : (can ? "대화 신청" : "남은 신청 없음") });
          if (!can) btn.disabled = true;
          btn.addEventListener("click", function () {
            busy(btn, async function () {
              try {
                var res = await API.sendRequest(m.id);
                toast(res && res.matched ? m.nick + "님과 매칭됐어요. 연락처는 내 정보에서 확인하세요." : m.nick + "님에게 대화를 신청했어요" + (LIVE ? "" : " (데모에서는 몇 초 뒤 수락돼요)"));
                await refreshMe(); renderNav(); renderResult();
              } catch (e) { fail(e); }
            });
          });
          action = incoming ? h("span", { "class": "row" }, btn, h("span", { "class": "pill on", text: "이 분이 먼저 신청했어요" })) : btn;
        }
      }
      var name = m.nick;
      cs.appendChild(h("article", { "class": "cand" + (open ? "" : " locked") },
        h("div", { "class": "avatar" + (idx % 2 ? " alt" : ""), text: open ? name.charAt(0) : "?" }),
        h("div", {},
          h("div", { "class": "cand-top" },
            h("h3", {}, name, h("small", { text: m.age + "세 · " + m.region + (m.same ? " · 같은 지역" : "") })),
            h("span", { "class": "score", text: m.temp.toFixed(1) + "° · 맞춤도 " + m.score + "%" })),
          h("p", { "class": "bio", text: open ? m.bio : "소개글은 이용권을 열면 볼 수 있어요. 한 줄 소개가 이곳에 보여요." }),
          h("ul", { "class": "why" }, why.map(function (w) { return h("li", { text: w }); })),
          h("div", { "class": "row" }, action, open && m.id ? reportBtn(m.id, function () { return renderResult(); }) : null))));
    });
    var rest = rec.list.length - picks;
    var lock = $("r-lock");
    if (rest > 0) {
      lock.hidden = false;
      $("r-lock-h").textContent = picks ? "나머지 " + rest + "명도 만나보고 싶다면" : "추천 " + rec.list.length + "명의 이야기가 궁금하다면";
      $("r-lock-p").textContent = S.beta ? "베타 기간에는 이용권을 무료로 열어 드려요. 소개글과 맞춤 이유, 대화 신청이 열려요."
        : picks ? "추천 열람권이나 프리미엄으로 모두 열 수 있어요." : "이용권을 선택하면 소개글과 맞춤 이유, 대화 신청을 열어 드려요.";
    }
  }
  $("r-unlock").addEventListener("click", function () { if (S.beta) claimBeta($("r-unlock")); else openPay(); });
  $("r-copy").addEventListener("click", function () {
    var r = S.me.result, t = O.typeOf(r.temp), ta = $("r-share");
    var txt = "나의 연애 온도는 " + r.temp.toFixed(1) + "° — " + t.name + "형\n대화 " + r.dims[0] + " · 가치관 " + r.dims[1] + " · 관계 " + r.dims[2] + "\n#ONDO #BetterMatchWarmerDay";
    function fb() { ta.value = txt; ta.hidden = false; ta.focus(); ta.select(); toast("아래 문구를 길게 눌러 복사해주세요"); }
    try { navigator.clipboard.writeText(txt).then(function () { toast("결과 문구를 복사했어요"); }, fb); } catch (e) { fb(); }
  });
  $("r-retry").addEventListener("click", function () { lsDel(draftKey()); go("test"); });

  /* ---------- 결제 ---------- */
  var PAY = { widgets: null, order: null, loading: false };
  var payNote = IS_TEST_KEY ? "테스트 결제입니다. 실제로 청구되지 않아요." : "";
  function paySteps(which) {
    $("pay-step1").hidden = which !== 1; $("pay-step2").hidden = which !== 2; $("pay-wait").hidden = which !== 3;
  }
  function loadToss() {
    return new Promise(function (resolve, reject) {
      if (window.TossPayments) return resolve();
      var s = h("script", { src: "https://js.tosspayments.com/v2/standard" });
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("결제 모듈을 불러오지 못했어요. 네트워크를 확인해주세요.")); };
      document.head.appendChild(s);
    });
  }
  function selectedPlan() { var r = document.querySelector('input[name="plan"]:checked'); return r ? r.value : null; }
  function syncPayBtn() {
    var k = selectedPlan(), b = $("pay-go");
    b.disabled = !k;
    b.textContent = !k ? "열 수 있는 이용권이 없어요" : (LIVE ? "결제 진행" : O.won(O.PLANS[k].price) + " 결제하기 (테스트)");
  }
  async function openPay() {
    if (!S.user) { go("login"); return; }
    var total = S.recTotal;
    if (total == null) { try { total = (await API.recommend()).total; S.recTotal = total; } catch (e) { fail(e); return; } }
    var box = $("pay-opts"); box.textContent = "";
    var first = null;
    ["lite", "once", "month"].forEach(function (k) {
      var p = O.PLANS[k], enabled = total >= p.min;
      if (enabled && (!first || k === "once")) first = first === "once" ? first : k;
      var input = h("input", { type: "radio", name: "plan", value: k, disabled: !enabled });
      var info = h("span", {}, h("b", { text: p.name }),
        h("small", { text: (k === "lite" ? "가장 잘 맞는 1명 열람 · 대화 신청 1회" : k === "once" ? "추천 3명 상세 열람 · 대화 신청 3회" : "열람권 기능 + 대화 신청 제한 없음 · 30일") }),
        enabled ? null : h("small", { "class": "need", text: "추천 가능한 분이 " + p.min + "명 이상이면 열려요 (지금 " + total + "명)" }));
      box.appendChild(h("label", { "class": "opt", "aria-disabled": enabled ? "false" : "true" }, input, info, h("span", { "class": "p", text: O.won(p.price) })));
    });
    var pick = box.querySelector('input[value="' + (first || "") + '"]');
    if (pick) pick.checked = true;
    Array.prototype.forEach.call(box.querySelectorAll("input"), function (i) { i.addEventListener("change", syncPayBtn); });
    $("pay-note").textContent = LIVE ? payNote : "테스트 모드입니다. 실제로 결제되지 않고 카드 정보도 받지 않아요.";
    $("pay-note").hidden = !$("pay-note").textContent;
    syncPayBtn(); paySteps(1); $("pay").hidden = false; $("pay-go").focus();
  }
  function closePay(silent) {
    if ($("pay").hidden) return;
    if (!$("pay-wait").hidden && !silent) return;
    $("pay").hidden = true; PAY.widgets = null; PAY.order = null;
    $("toss-methods").textContent = ""; $("toss-agree").textContent = "";
  }
  $("pay-x").addEventListener("click", function () { closePay(); });
  $("pay").addEventListener("click", function (e) { if (e.target === $("pay")) closePay(); });
  $("pay-back").addEventListener("click", function () { PAY.widgets = null; $("toss-methods").textContent = ""; $("toss-agree").textContent = ""; paySteps(1); });
  $("pay-go").addEventListener("click", async function () {
    var plan = selectedPlan(); if (!plan) return;
    paySteps(3); $("pay-wait-t").textContent = LIVE ? "결제창을 연결하고 있어요" : "결제를 진행하고 있어요";
    try {
      var order = await API.prepareOrder(plan);
      if (!LIVE) {
        await API.payDemo(order); await refreshMe(); S.recTotal = null; renderNav();
        $("pay").hidden = true; toast(O.PLANS[plan].name + "이(가) 열렸어요 (테스트 결제)");
        if (document.body.getAttribute("data-view") === "result") renderResult(); else go("result");
        return;
      }
      await loadToss();
      var toss = window.TossPayments(CFG.tossClientKey);
      var widgets = toss.widgets({ customerKey: S.user.id });
      await widgets.setAmount({ currency: "KRW", value: order.amount });
      // 결제수단 위젯이 다 그려지기 전에는 결제 버튼을 막아 둡니다.
      $("pay-final").disabled = true;
      paySteps(2);
      $("pay-sum").textContent = order.orderName + " · " + O.won(order.amount);
      await Promise.all([
        widgets.renderPaymentMethods({ selector: "#toss-methods", variantKey: "DEFAULT" }),
        widgets.renderAgreement({ selector: "#toss-agree", variantKey: "AGREEMENT" })
      ]);
      PAY.widgets = widgets; PAY.order = order;
      $("pay-final").disabled = false;
    } catch (e) { fail(e); paySteps(1); }
  });
  $("pay-final").addEventListener("click", function () {
    if (!PAY.widgets || !PAY.order) return;
    var o = PAY.order, back = new URL("pay-result.html", location.href).href;
    busy($("pay-final"), async function () {
      try {
        await PAY.widgets.requestPayment({ orderId: o.orderId, orderName: o.orderName, successUrl: back, failUrl: back, customerEmail: S.user.email });
      } catch (e) {
        // 사용자가 결제창을 닫은 경우 등. 같은 주문으로 다시 시도할 수 있어요.
        toast("결제가 완료되지 않았어요. 다시 시도해주세요.");
      }
    });
  });

  /* ---------- 내 정보 ---------- */
  function fmtDate(ts) { var d = new Date(ts); return d.getFullYear() + "." + (d.getMonth() + 1) + "." + d.getDate(); }
  async function renderMy(my) {
    var me = S.me, p = me.profile, kv = $("m-kv"); kv.textContent = "";
    $("m-hello").textContent = p ? p.nick + "님" : "내 정보";
    function row(k, v) { kv.appendChild(h("div", {}, h("dt", { text: k }), h("dd", { text: v }))); }
    row("이메일", me.email || (S.user && S.user.email) || "");
    if (p) { row("나이 · 성별", p.age + "세 · " + p.gender); row("활동 지역", p.region); row("만나고 싶은 상대", (p.seek === "모두" ? "상관없음" : p.seek) + " · " + p.amin + "~" + p.amax + "세"); row("연락 방법", p.contact || "-"); }
    row("연애 온도", me.result ? me.result.temp.toFixed(1) + "° · " + O.typeOf(me.result.temp).name : "아직 측정 전");
    var pass = me.pass, label = "없음";
    if (pass) label = O.PLANS[pass.plan].name + " (" + fmtDate(Date.parse(pass.expires_at)) + "까지" + (pass.unlimited ? "" : ", 대화 신청 " + pass.asks_left + "회 남음") + ")";
    row("이용권", label);
    row("결제 내역", me.orders.length ? me.orders.length + "건" + (LIVE && !IS_TEST_KEY ? "" : " (테스트)") : "없음");
    $("m-result").hidden = !me.result;

    var inb = $("m-inbox"), mat = $("m-matches"); inb.textContent = ""; mat.textContent = "";
    inb.appendChild(h("div", { "class": "empty", text: "불러오는 중이에요" })); mat.appendChild(h("div", { "class": "empty", text: "불러오는 중이에요" }));
    var a;
    try { a = await Promise.all([API.inbox(), API.matches()]); } catch (e) { fail(e); inb.textContent = ""; mat.textContent = ""; return; }
    if (my !== undefined && my !== seq) return;
    inb.textContent = ""; mat.textContent = "";
    var again = async function () { await refreshMe(); renderNav(); renderMy(); };
    if (!a[0].length) inb.appendChild(h("div", { "class": "empty", text: "받은 대화 신청이 없어요." }));
    a[0].forEach(function (c) {
      var yes = h("button", { type: "button", "class": "btn sm", text: "수락" });
      var no = h("button", { type: "button", "class": "btn line sm", text: "거절" });
      yes.addEventListener("click", function () { busy(yes, async function () { try { await API.respond(c.id, true); toast(c.nick + "님과 매칭됐어요"); await again(); } catch (e) { fail(e); } }); });
      no.addEventListener("click", function () { busy(no, async function () { try { await API.respond(c.id, false); toast("거절했어요"); await again(); } catch (e) { fail(e); } }); });
      inb.appendChild(h("article", { "class": "cand" },
        h("div", { "class": "avatar", text: c.nick.charAt(0) }),
        h("div", {},
          h("div", { "class": "cand-top" }, h("h3", {}, c.nick, h("small", { text: c.age + "세 · " + c.region })), h("span", { "class": "score", text: c.temp.toFixed(1) + "° · 맞춤도 " + c.score + "%" })),
          h("p", { "class": "bio", text: c.bio }),
          h("div", { "class": "row" }, yes, no, reportBtn(c.userId, again)))));
    });
    if (!a[1].length) mat.appendChild(h("div", { "class": "empty", text: "아직 성사된 매칭이 없어요. 서로 수락하면 연락처가 열려요." }));
    a[1].forEach(function (c) {
      var link = /^https?:\/\//i.test(c.contact);
      var codeEl = link ? h("a", { href: c.contact, target: "_blank", rel: "noopener noreferrer", text: c.contact }) : h("code", { text: c.contact });
      var copy = h("button", { type: "button", "class": "btn line sm", text: "복사" });
      copy.addEventListener("click", function () {
        try { navigator.clipboard.writeText(c.contact).then(function () { toast("연락처를 복사했어요"); }, function () { toast("직접 선택해서 복사해주세요"); }); } catch (e) { toast("직접 선택해서 복사해주세요"); }
      });
      mat.appendChild(h("article", { "class": "cand" },
        h("div", { "class": "avatar alt", text: c.nick.charAt(0) }),
        h("div", {},
          h("div", { "class": "cand-top" }, h("h3", {}, c.nick, h("small", { text: c.age + "세 · " + c.region })), h("span", { "class": "score", text: fmtDate(c.at) + " 매칭" })),
          h("div", { "class": "contact" }, h("span", { text: "연락 방법" }), link ? codeEl : codeEl, copy),
          h("div", { "class": "row" }, reportBtn(c.userId, again)))));
    });
  }
  $("m-result").addEventListener("click", function () { go("result"); });
  $("m-edit").addEventListener("click", function () { go("profile"); });
  $("m-buy").addEventListener("click", function () { if (S.beta) claimBeta($("m-buy")); else openPay(); });
  $("m-logout").addEventListener("click", logout);
  var delArmed = false;
  $("m-delete").addEventListener("click", async function () {
    var b = $("m-delete");
    if (!delArmed) {
      delArmed = true; b.textContent = "정말 삭제할게요";
      setTimeout(function () { delArmed = false; b.textContent = "계정 삭제"; }, 4000); return;
    }
    try { await API.deleteAccount(); } catch (e) { fail(e); return; }
    S.user = null; S.me = null; delArmed = false; b.textContent = "계정 삭제"; toast("계정과 저장된 정보를 삭제했어요"); go("home");
  });

  /* ---------- 홈: 일러스트 / 체험 / 푸터 ---------- */
  function rng(seed) { var s = seed; return function () { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }
  (function art() {
    var NS = "http://www.w3.org/2000/svg", R = rng(7);
    function mk(n, a, parent) { var e = document.createElementNS(NS, n); for (var k in a) e.setAttribute(k, a[k]); parent.appendChild(e); return e; }
    var far = $("cityFar"), near = $("cityNear"), x = -6;
    while (x < 470) { var w = 14 + R() * 22, hh = 30 + R() * 70; var r1 = mk("rect", { x: x, y: 354 - hh, width: w, height: hh, "class": "s-far" }, far); r1.style.opacity = ".78"; x += w + R() * 3; }
    x = -4;
    var towers = [{ x: 330, w: 16, h: 150 }, { x: 352, w: 14, h: 118 }, { x: 392, w: 18, h: 98 }];
    while (x < 470) { var w2 = 12 + R() * 26, h2 = 24 + R() * 60; mk("rect", { x: x, y: 356 - h2, width: w2, height: h2, "class": "s-near" }, near); x += w2 + 1 + R() * 3; }
    towers.forEach(function (t) { mk("rect", { x: t.x, y: 356 - t.h, width: t.w, height: t.h, "class": "s-near" }, near); });
    var lights = $("lights");
    for (var i = 0; i < 9; i++) { var wd = 38 - i * 3.2, rr = mk("rect", { x: 300 - wd / 2, y: 360 + i * 11, width: wd, height: 2, rx: 1, "class": "s-sun" }, lights); rr.style.opacity = String(.7 - i * .06); }
    for (var j = 0; j < 14; j++) { var rr2 = mk("rect", { x: 60 + R() * 340, y: 372 + R() * 110, width: 8 + R() * 22, height: 1.4, "class": "s-sun" }, lights); rr2.style.opacity = String(.12 + R() * .2); }
    for (var k = 0; k < 26; k++) { var win = mk("rect", { x: 335 + R() * 74, y: 230 + R() * 120, width: 1.6, height: 2, "class": "s-sun" }, near); win.style.opacity = String(.35 + R() * .5); }
  })();
  (function demo() {
    var g = makeGauge(); $("demo-gauge").appendChild(g.el);
    var vals = [62, 55, 50], wrap = $("demo-sliders");
    O.DIMS.forEach(function (d, i) {
      var out = h("span", { text: String(vals[i]) });
      var inp = h("input", { type: "range", min: "0", max: "100", step: "1", value: String(vals[i]), id: "dm" + i });
      inp.addEventListener("input", function () { vals[i] = Number(inp.value); out.textContent = inp.value; update(); });
      wrap.appendChild(h("div", { "class": "slider-row" }, h("label", { "for": "dm" + i }, d.name, out), inp, h("div", { "class": "poles" }, h("span", { text: d.lo }), h("span", { text: d.hi }))));
    });
    function update() { var t = O.tempOf(vals), ty = O.typeOf(t); g.set(t); $("demo-name").textContent = ty.name + "형"; $("demo-desc").textContent = ty.desc; }
    update();
  })();
  (function footer() {
    var B = CFG.business || {}, f = function (v, ph) { return v || ph; };
    $("biz").textContent = "";
    $("biz").appendChild(document.createTextNode(f(B.name, "[사업자명]") + " · 대표 " + f(B.ceo, "[대표자명]") + " · 사업자등록번호 " + f(B.regNo, "[000-00-00000]") + " · 통신판매업신고 " + f(B.mailOrderNo, "[제0000-지역-0000호]")));
    $("biz").appendChild(document.createElement("br"));
    $("biz").appendChild(document.createTextNode(f(B.address, "[사업장 주소]") + " · 고객센터 " + f(B.contact, "[이메일 또는 전화번호]")));
    $("foot-note").textContent = LIVE ? "" : "베타 테스트 중 · 추천 후보는 예시 프로필이며, 대괄호 항목은 운영 전에 실제 정보로 바꿔야 해요.";
    if (LIVE) $("plan-note").textContent = IS_TEST_KEY ? "현재 결제 테스트 중이라 실제로 청구되지 않아요." : "";
    $("plan-note").hidden = !$("plan-note").textContent;
  })();

  /* ---------- 시작 ---------- */
  (async function init() {
    try { S.user = await API.init(); } catch (e) { S.user = null; }
    try { S.beta = (await API.appStatus()).betaFree; } catch (e) { S.beta = false; }
    renderBeta();
    if (S.user) { try { await refreshMe(); } catch (e) { fail(e); } }
    var q = new URLSearchParams(location.search);
    if (q.get("paid") === "1") { toast("결제가 완료됐어요. 이용권이 열렸어요."); history.replaceState(null, "", location.pathname + "#result"); }
    else if (FROM_LINK && S.user) { history.replaceState(null, "", location.pathname); location.hash = IS_RECOVERY ? "reset" : nextStep(); }
    else if (FROM_LINK && !S.user) { history.replaceState(null, "", location.pathname + "#login"); }
    route();
  })();
})();
