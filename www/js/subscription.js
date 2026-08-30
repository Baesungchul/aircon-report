/* ═══════════════════════════════════════════════
   SUBSCRIPTION ─ 구독 / AI 사용량 / 쿠폰 (v2.0)
   플랜: free / lite(팀원 4,900) / basic(9,900) / pro(19,900) / master(49,900)
   - 사용량: localStorage(항상) + 로그인 시 Firestore users/{uid}.subs 동기화
   - plan: users/{uid}.plan (Play Billing 연동 전까지 앱 내 관리자 화면에서 수동 설정)
   - 쿠폰: coupons/{code} → 등록 시 users/{uid}.subs.coupon 크레딧 (기본 30일)
═══════════════════════════════════════════════ */
(function () {
  'use strict';
  window.Subs = window.Subs || {};

  var PLANS = {
    free:   { name: '무료',   price: 0,     sched: 0,    blog: 0,   share: false, chat: false, chatMedia: false, teamCreate: false },
    /* ★ 2026-08-30 개편 — 예전엔 4,900원을 내고도 AI 를 한 번도 못 썼다('팀 참여 전용').
         무료(0회) 와 베이직(9,900원·100회) 사이가 비어 있어 진입 계단이 없었다.
         베이직이 100회이므로 반값에 반건수(50회)로 둔다 — 건당 단가가 같아야
         '더 쓰려면 베이직' 이 성립하고 베이직을 잠식하지 않는다.
         ⭐ 새 상품을 만들지 않고 기존 lite 상품의 내용만 바꾸므로
            Play Console·RevenueCat 에 추가로 등록할 것이 없다.
         ⚠️ 이름을 '팀원'→'라이트' 로 바꿨다. 팀을 만들 수 있는 줄 알고 결제하는
            사례가 있었다(2026-08-26). 아래 LITE_WARN 도 함께 고칠 것. */
    lite:   { name: '라이트', price: 4900,  sched: 50,   blog: 0,   share: true,  chat: true,  chatMedia: false, teamCreate: false },
    basic:  { name: '베이직', price: 9900,  sched: 100,  blog: 30,  share: true,  chat: true,  chatMedia: false, teamCreate: true },
    pro:    { name: '프로',   price: 19900, sched: 300,  blog: 80,  share: true,  chat: true,  chatMedia: true,  teamCreate: true },
    master: { name: '마스터', price: 49900, sched: 1500, blog: 300, share: true,  chat: true,  chatMedia: true,  teamCreate: true, unlimited: true }
  };
  /* ★ 2026-08-24 무료 지급분의 기준을 '설치'에서 '로그인 계정'으로 옮겼다.
       왜: ① 설치 기준이라 앱을 지웠다 깔면 무한히 리셋됐다(기기에만 기록이 남아 막을 방법이 없었다)
           ② 로그인해도 무료 사용자가 얻는 게 없어서 로그인할 이유가 없었다
       INSTALL_TASTER 를 0 이 아닌 값으로 바꾸면 '설치 시 맛보기'를 다시 켤 수 있다(사용자 결정: 지금은 없음). */
  var FREE_INIT = { sched: 30, blog: 5 };        // 계정당 1회 지급(첫 로그인)
  var INSTALL_TASTER = { sched: 0, blog: 0 };    // 로그인 전 맛보기 — 현재 없음
  var GRANT_LEGACY = 'legacy';                   // 이 변경 이전부터 쓰던 기기 표시(횟수 보존용)
  var FREE_TTL_MS = 30 * 24 * 60 * 60 * 1000;    // ★ 2026-08-24 무료 지급분 유효기간 = 지급일로부터 30일(1회성)
  var LS_KEY = 'ac_subs_v1';
  var KIND_LABEL = { sched: 'AI 일정등록', blog: 'AI 글작성' };

  function esc(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(m, t) { if (typeof showToast === 'function') showToast(m, t || 'ok'); else alert(m); }
  function ymNow() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function loggedIn() { return !!(window.Cloud && Cloud.ready && Cloud.user); }
  function fdb() { return Cloud.db; }

  /* ── 상태 ── */
  var S = null;
  function fresh() {
    return { plan: 'free', ym: ymNow(), used: { sched: 0, blog: 0 },
             freeLeft: { sched: INSTALL_TASTER.sched, blog: INSTALL_TASTER.blog },
             freeGranted: 0,   // 0=아직 지급 안 됨 / 숫자=지급 시각 / 'legacy'=설치 기준 시절 사용자
             freeExp: 0,       // 무료 지급분 만료 시각(0=아직 지급 전)
             coupon: { sched: 0, blog: 0, exp: 0 }, aiCost: 0, aiTok: { in: 0, out: 0 }, admin: false };
  }
  function load() {
    if (S) return S;
    var _fresh = false;
    try { S = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { S = null; }
    if (!S || typeof S !== 'object') { S = fresh(); _fresh = true; }
    if (!S.used) S.used = { sched: 0, blog: 0 };
    /* ⚠️⚠️ 기존 사용자에게서 횟수를 빼앗지 않는다.
         freeGranted 필드가 아예 없는 기록 = 이 변경 이전에 설치해서 쓰던 기기다.
         그 사람들은 '설치 시 지급'을 이미 받았으므로 남은 잔량을 그대로 두고 legacy 로 표시한다.
         (이걸 놓치면 업데이트하는 순간 남은 횟수가 0 이 되어 항의를 받는다) */
    var _migrated = false;
    if (S.freeGranted === undefined) { S.freeGranted = _fresh ? 0 : GRANT_LEGACY; _migrated = true; }
    /* ★ 2026-08-24 유효기간 도입.
         기존 사용자(legacy)는 만료 시각이 없다. 잔량을 그 자리에서 없애면 '빼앗기'가 되므로,
         **이 버전을 처음 실행한 날로부터 30일**을 새로 준다(사실상 한 달 유예).
         ⚠️ 여기서 _fresh 인 경우는 아직 지급 전이라 0 으로 둔다 — 지급 시점에 채운다. */
    if (S.freeExp === undefined) {
      S.freeExp = (S.freeGranted === GRANT_LEGACY) ? (Date.now() + FREE_TTL_MS) : 0;
      _migrated = true;
    }
    if (!S.freeLeft) {
      S.freeLeft = S.freeGranted === GRANT_LEGACY
        ? { sched: FREE_INIT.sched, blog: FREE_INIT.blog }   // 옛 기록인데 잔량 필드가 없음 → 예전 기본값 유지
        : { sched: INSTALL_TASTER.sched, blog: INSTALL_TASTER.blog };
    }
    if (!S.coupon) S.coupon = { sched: 0, blog: 0, exp: 0 };
    if (typeof S.aiCost !== 'number') S.aiCost = 0;
    if (!S.aiTok) S.aiTok = { in: 0, out: 0 };
    rollover();
    /* ⚠️⚠️ 마이그레이션 결과를 **반드시 저장한다.**
         안 하면 다음 실행에서 freeExp 가 또 undefined 가 되어 유예 30일이 매번 새로 시작된다
         = 기존 사용자의 무료 횟수가 영원히 안 끝난다(시뮬레이션에서 실제로 그랬다).
         load() 안에서 부르지만 persist() 는 load() 를 되부르지 않으므로 재귀 걱정은 없다. */
    if (_migrated) persist();
    return S;
  }
  function rollover() {
    var ym = ymNow();
    if (S.ym !== ym) { S.ym = ym; S.used = { sched: 0, blog: 0 }; S.aiCost = 0; S.aiTok = { in: 0, out: 0 }; persist(); }
    if (S.coupon && S.coupon.exp && Date.now() > S.coupon.exp) { S.coupon = { sched: 0, blog: 0, exp: 0 }; persist(); }
    /* ★ 2026-08-24 무료 지급분 만료 — 쿠폰과 같은 방식으로 여기서 한 번에 처리한다.
         ⚠️ freeExp 가 0 이면(아직 지급 전) 건드리지 않는다. 0 을 '이미 만료'로 보면
            지급 직전에 잔량을 지워 버린다. */
    if (S.freeExp && Date.now() > S.freeExp && ((S.freeLeft.sched || 0) > 0 || (S.freeLeft.blog || 0) > 0)) {
      S.freeLeft = { sched: 0, blog: 0 };
      persist();
    }
  }
  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {}
    pushCloudSoon();
  }

  /* ── 클라우드 동기화 (로그인 시) ── */
  var _pushT = null;
  function pushCloudSoon() {
    if (!loggedIn()) return;
    clearTimeout(_pushT);
    _pushT = setTimeout(function () {
      try {
        fdb().collection('users').doc(Cloud.user.uid).set({
          subs: { ym: S.ym, used: S.used, freeLeft: S.freeLeft, coupon: S.coupon, aiCost: S.aiCost || 0, aiTok: S.aiTok || { in: 0, out: 0 },
                  freeGranted: S.freeGranted || 0, freeExp: S.freeExp || 0 }   // ★ 계정당 1회 지급 도장 + 만료 시각
        }, { merge: true }).catch(function () {});
      } catch (e) {}
    }, 1200);
  }
  function pullCloud() {
    if (!loggedIn()) return;
    try {
      fdb().collection('users').doc(Cloud.user.uid).get().then(function (doc) {
        var d = doc.data() || {};
        var _justGranted = false;   // ★ 이번 로그인에 무료 횟수를 지급했는가(아래에서 안내)
        var _needStamp = false;     // ★ 지급 도장을 서버에 남겨야 하는가
        load();
        S.plan = PLANS[d.plan] ? d.plan : 'free';
        S.admin = (d.admin === true);
        /* ★ 2026-08-23 결제 플랜은 RevenueCat(네이티브)에서만 확인된다.
             그래서 웹이나 결제하지 않은 다른 기기에서는 구독이 안 보였다.
             클라우드에 적어둔 값을 초기값으로 쓰고, 네이티브에서 Billing.init 이
             돌면 그 결과가 곧 덮어쓴다(그쪽이 권위). */
        if (!_billingPlan && PLANS[d.billingPlan]) _billingPlan = d.billingPlan;
        var c = d.subs || {};
        if (c.ym === S.ym && c.used) {
          // 같은 달이면 큰 쪽(다른 기기에서 쓴 만큼) 반영
          S.used.sched = Math.max(S.used.sched || 0, c.used.sched || 0);
          S.used.blog = Math.max(S.used.blog || 0, c.used.blog || 0);
        }
        if (c.ym === S.ym) {
          if (typeof c.aiCost === 'number') S.aiCost = Math.max(S.aiCost || 0, c.aiCost);
          if (c.aiTok) { S.aiTok.in = Math.max(S.aiTok.in || 0, c.aiTok.in || 0); S.aiTok.out = Math.max(S.aiTok.out || 0, c.aiTok.out || 0); }
        }
        /* ★ 2026-08-24 무료 지급분은 '계정'에 1회 지급한다. 네 가지 경우를 갈라야 한다.
             ① 계정도 기기도 처음      → 지금 지급하고 서버에 도장을 찍는다
             ② 기기만 처음(재설치·기기변경) → 서버 잔량을 그대로 물려받는다
                ⚠️ 여기서 min 을 쓰면 안 된다 — 새 기기의 잔량은 0 이라 남은 횟수가 통째로 날아간다
             ③ 평소                  → 더 작은 쪽을 취한다(오프라인에서 쓴 차감이 서버보다 앞설 수 있음)
             ④ legacy(설치 기준 시절)  → S.freeGranted 가 이미 truthy 라 ③으로 흘러 잔량이 보존된다 */
        var _stamp = c.freeGranted || 0;
        if (!S.freeGranted && !_stamp) {                       // ①
          S.freeLeft = { sched: FREE_INIT.sched, blog: FREE_INIT.blog };
          S.freeGranted = Date.now();
          S.freeExp = Date.now() + FREE_TTL_MS;   // ★ 지급일로부터 30일
          _justGranted = true;
        } else if (!S.freeGranted && _stamp) {                 // ②
          S.freeGranted = _stamp;
          S.freeLeft = { sched: (c.freeLeft && c.freeLeft.sched) || 0,
                         blog:  (c.freeLeft && c.freeLeft.blog)  || 0 };
          S.freeExp = c.freeExp || 0;   // ★ 만료 시각도 계정 것을 따라간다(기기를 바꿔도 기한은 그대로)
        } else if (c.freeLeft) {                               // ③④
          S.freeLeft.sched = Math.min(S.freeLeft.sched, c.freeLeft.sched != null ? c.freeLeft.sched : 999);
          S.freeLeft.blog = Math.min(S.freeLeft.blog, c.freeLeft.blog != null ? c.freeLeft.blog : 999);
        }
        /* 만료 시각은 **더 이른 쪽**을 취한다. 기기 데이터를 지워 기한을 늘리는 걸 막는다.
           (서버에만 있으면 서버 것을 그대로 받는다) */
        if (c.freeExp) S.freeExp = S.freeExp ? Math.min(S.freeExp, c.freeExp) : c.freeExp;
        /* ★ 도장이 서버에 없는데 기기에는 있는 경우(주로 legacy) → 지금 서버에 남긴다.
             안 남기면 그 사람이 앱을 지웠다 깔았을 때 ①로 판정돼 30회를 새로 받는다. */
        if (!_stamp && S.freeGranted) _needStamp = true;
        if (c.coupon && (c.coupon.exp || 0) > Date.now()) S.coupon = c.coupon;
        rollover();
        try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {}
        /* ★ 지급했으면 서버에 도장을 반드시 남긴다.
             ⚠️ 여기는 persist() 를 안 거치고 localStorage 에 직접 쓰므로 자동 업로드가 안 걸린다.
                도장이 서버에 안 올라가면 앱을 지웠다 깔 때마다 다시 지급되어 리셋 악용이 그대로 남는다. */
        if (_justGranted || _needStamp) pushCloudSoon();
        if (_justGranted) {
          if (typeof showToast === 'function') {
            showToast('🎁 무료 AI 횟수를 드렸어요 — 일정등록 ' + FREE_INIT.sched + '회 · 글작성 ' + FREE_INIT.blog + '회', 'ok');
          }
        }
        renderSettings();
      }).catch(function () {});
    } catch (e) {}
  }
  document.addEventListener('cloud-auth-changed', function (e) {
    if (e && e.detail && e.detail.user) { pullCloud(); setTimeout(function () { if (loggedIn()) pullCloud(); }, 1500); _resumeAfterLogin(); }   // ★ 2026-08-30 하려던 작업 이어서
    else { load(); S.plan = 'free'; S.admin = false; renderSettings(); }
  });

  /* ── 결제(RevenueCat) 연동 플랜: 활성 엔타이틀먼트가 진실 공급원 ── */
  var _billingPlan = null;
  function effPlan() { return (_billingPlan && PLANS[_billingPlan]) ? _billingPlan : ((S && S.plan) || 'free'); }
  Subs.effectivePlan = effPlan;
  /* ★ 2026-08-23 결제 플랜을 클라우드에 남긴다.
       왜: 예전엔 _billingPlan 이 메모리에만 있어서
         · 관리자 통계가 결제 구독자를 'free' 로 셌고(users/{uid}.plan 이 그대로 free)
         · 서버 정리 로직(cleanupAccounts)의 subscriptionActive 판정이 늘 false 였고
         · 웹·다른 기기에서는 구독이 인식되지 않았다.
       ⚠️ 절대 users/{uid}.plan 을 건드리지 않는다 — 그건 관리자가 수동 지정하는 칸이다.
          결제로 받은 플랜은 별도 필드(billingPlan)에 넣고, 읽는 쪽에서 billingPlan || plan 으로 본다.
          (그러지 않으면 관리자가 수동 지정한 마스터 계정이 결제 없음으로 free 로 덮어써진다) */
  function pushBillingPlan(k, prev) {
    if (!loggedIn()) return;
    try {
      var FV = firebase.firestore.FieldValue;
      var upd = { subscriptionActive: !!k };
      if (k) {
        upd.billingPlan = k;
        upd.subscriptionEndedAt = FV.delete();      // 재구독 → 종료 기록 취소
      } else {
        if (!prev) return;                          // 원래 무구독이면 아무것도 쓰지 않는다
        upd.billingPlan = FV.delete();
        upd.subscriptionEndedAt = FV.serverTimestamp();   // 해지 시점(보관기간 기산점)
      }
      fdb().collection('users').doc(Cloud.user.uid).set(upd, { merge: true }).catch(function () {});
    } catch (e) {}
  }
  Subs.setBillingPlan = function (k) {
    var next = (k && PLANS[k]) ? k : null;
    var prev = _billingPlan;
    _billingPlan = next;
    try { load(); } catch (e) {}
    try { renderSettings(); } catch (e) {}
    if (next !== prev) pushBillingPlan(next, prev);   // 바뀔 때만 1회 기록
  };

  /* ── 조회 ── */
  Subs.plan = function () { load(); return effPlan(); };
  Subs.isAdmin = function () { load(); return S.admin === true; };  // ★ 관리자(개발자) = 모든 권한·무제한
  // 토큰 사용 비용 누적 (ai.js가 호출 → 이번 달 aiCost/aiTok 증가, 클라우드 동기화)
  Subs.addAiUsage = function (usd, inTok, outTok) {
    load(); rollover();
    S.aiCost = (S.aiCost || 0) + (Number(usd) || 0);
    if (!S.aiTok) S.aiTok = { in: 0, out: 0 };
    S.aiTok.in += (Number(inTok) || 0);
    S.aiTok.out += (Number(outTok) || 0);
    persist();
  };
  Subs.planInfo = function () { load(); return PLANS[effPlan()] || PLANS.free; };
  Subs.hasFeature = function (k) {
    if (Subs.isAdmin()) return true;
    var p = Subs.planInfo();
    return !!p[k];
  };
  // 남은 횟수: {coupon, monthly, free, total}
  Subs.quota = function (kind) {
    load(); rollover();
    if (S.admin === true) return { coupon: 0, monthly: 999999, free: 0, total: 999999 };
    var p = Subs.planInfo();
    var coupon = (S.coupon.exp > Date.now()) ? Math.max(0, S.coupon[kind] || 0) : 0;
    /* ⭐ 2026-08-23 무료 지급분을 구독 중에도 **합산**한다(사용자 확정).
         예전에는 유료 플랜이면 freeLeft 를 0으로 가렸다. 값은 보존돼 해지하면
         되살아났지만, 구독하는 순간 남아 있던 무료 횟수가 사라진 것처럼 보였고
         실제로 쓰지도 못했다. 이제 월 한도 + 무료 지급분이 함께 '남은 횟수'다.
         차감 순서는 consumeAI 참고 — 월 한도를 먼저 쓴다. */
    var monthly = Math.max(0, (p[kind] || 0) - (S.used[kind] || 0));
    var freeC = Math.max(0, S.freeLeft[kind] || 0);
    return { coupon: coupon, monthly: monthly, free: freeC, total: coupon + monthly + freeC };
  };
  // 사용 지점 표시용: {admin, free, base(총), left(남은), coupon}
  /* ★ 2026-08-24 '아직 무료 지급분을 못 받은 상태'인가.
       = 로그인한 적이 없어서 계정에 지급이 안 된 사람. 이 사람에게 필요한 말은
         '구독하세요'가 아니라 '로그인하면 드려요' 다. */
  Subs.needsLoginForFree = function () {
    load();
    return !loggedIn() && !S.freeGranted;
  };
  Subs.freeInit = function (kind) { return FREE_INIT[kind] || 0; };
  /* 무료 지급분 남은 일수. 0 이하면 만료. 지급 전이면 null.
     ⚠️ 만료를 화면에 안 보여주면 어느 날 갑자기 횟수가 0 이 된 것처럼 보인다 — 반드시 같이 표시할 것. */
  Subs.freeDaysLeft = function () {
    load();
    if (!S.freeExp) return null;
    return Math.ceil((S.freeExp - Date.now()) / 86400000);
  };

  Subs.quotaInfo = function (kind) {
    load(); rollover();
    if (S.admin === true) return { admin: true, free: false, base: 0, left: 0, coupon: 0 };
    var q = Subs.quota(kind);
    var p = PLANS[effPlan()] || PLANS.free;
    var noMonthly = ((p[kind] || 0) === 0);   // 무료·팀원 = 월 한도 없음(1회 지급분만)
    /* freeLeft = 따로 표시할 무료 지급분 잔량.
       월 한도가 없는 플랜은 left 가 이미 그 값이라 0으로 둔다(두 번 세지 않기). */
    return { admin: false, free: noMonthly,
             base: noMonthly ? FREE_INIT[kind] : (p[kind] || 0),
             left: noMonthly ? q.free : q.monthly, coupon: q.coupon,
             freeLeft: noMonthly ? 0 : q.free };
  };
  // "총 N회 중 M회 남음" 문자열
  Subs.quotaText = function (kind) {
    var i = Subs.quotaInfo(kind);
    if (i.admin) return '무제한 (관리자)';
    // ★ 2026-08-24 아직 지급 전이면 잔량 대신 '로그인하면 드린다'를 보여준다
    if (Subs.needsLoginForFree()) return '로그인하면 무료 ' + FREE_INIT[kind] + '회를 드려요';
    var txt = (i.free ? '무료 총 ' : '이번 달 총 ') + i.base + '회 중 ' + i.left + '회 남음';
    /* ★ 2026-08-24 무료 지급분은 30일이면 끝난다 → 남은 기간을 같이 보여준다 */
    var _d = Subs.freeDaysLeft();
    if (_d !== null && i.left > 0) txt += (_d > 0 ? ' · ' + _d + '일 뒤 만료' : ' · 기간 만료');
    if (i.freeLeft > 0) txt += ' + 무료 잔여 ' + i.freeLeft + '회';
    if (i.coupon > 0) txt += ' + 쿠폰 ' + i.coupon + '회';
    return txt;
  };
  Subs.canUseAI = function (kind) {
    if (Subs.isAdmin()) return { ok: true };
    var q = Subs.quota(kind);
    if (q.total > 0) return { ok: true };
    /* ★ 2026-08-24 아직 지급 전(=로그인한 적 없음)이면 결제로 보내지 않는다.
         무료 횟수는 계정에 지급되므로, 이 사람에게 맞는 다음 행동은 로그인이다. */
    if (Subs.needsLoginForFree()) {
      return { ok: false, needLogin: true,
               msg: '로그인하면 ' + KIND_LABEL[kind] + ' 무료 ' + FREE_INIT[kind] + '회를 바로 드려요' };
    }
    /* ★ 2026-08-24 다 써서 없는 것과 기간이 끝나 없는 것은 다른 말이어야 한다 */
    if (S.freeExp && Date.now() > S.freeExp && (Subs.planInfo()[kind] || 0) === 0) {
      return { ok: false, msg: '무료 AI 사용 기간(30일)이 끝났습니다. 구독하거나 쿠폰을 등록해주세요.' };
    }
    var msg = ((Subs.planInfo()[kind] || 0) === 0)
      ? KIND_LABEL[kind] + ' 무료 횟수를 모두 사용했습니다. 구독하거나 쿠폰을 등록해주세요.'
      : '이번 달 ' + KIND_LABEL[kind] + ' 한도를 모두 사용했습니다. 다음 달에 초기화됩니다. (쿠폰으로 충전 가능)';
    return { ok: false, msg: msg };
  };
  // UI 게이트: 안 되면 안내창 띄우고 false
  Subs.gateAI = function (kind, retry) {
    var r = Subs.canUseAI(kind);
    if (r.ok) return true;
    toast(r.msg, r.needLogin ? 'ok' : 'err');
    // ★ 2026-08-24 지급 전이면 요금제가 아니라 로그인 창을 연다
    /* ★ 2026-08-30 retry = 로그인하고 나면 이어서 할 일.
         버튼 id(문자열) 또는 함수. 안 넘겨도 예전처럼 동작한다. */
    if (r.needLogin) { setTimeout(function () { Subs.openLoginForFree(retry, kind); }, 400); return false; }
    setTimeout(function () { Subs.openPlans(kind); }, 400);
    return false;
  };
  /* 로그인 창 열기 — 온보딩의 _obOpenLogin 과 같은 경로(cloudModal)를 쓴다.
     ⚠️ 모달이 다른 오버레이 밑에 깔리는 경우가 있어 body 끝으로 옮긴 뒤 연다. */
  /* ★ 2026-08-30 '로그인하고 나면 이어서 할 일'.
       그 전에는 "로그인하면 무료 5회 드려요" 를 보고 로그인해도 아무 일이 없어서,
       하려던 작업(글작성·일정등록·견적서) 버튼을 사용자가 다시 눌러야 했다.
       backup.js 의 서버복구와 같은 얼개다. */
  var _afterLogin = null, _afterLoginKind = null, _afterLoginAt = 0;
  var AFTER_LOGIN_TTL = 3 * 60 * 1000;   // 3분. 넘으면 버린다 — 한참 뒤 딴 이유로 로그인했을 때 놀라지 않게.
  function _runResume(fn) {
    try {
      if (typeof fn === 'function') { fn(); return; }
      /* 문자열이면 버튼 id — 다시 누른다. 그 창이 이미 닫혔으면 아무 일도 일어나지 않는다(의도한 것).
         ⭐ 입력값을 따로 복제하지 않아도 되는 게 이 방식의 장점이다.
            로그인창은 작성 중이던 창 '위에' 떴을 뿐이라 그 밑에 그대로 살아 있다. */
      var el = document.getElementById(fn);
      if (el) el.click();
    } catch (e) {}
  }
  function _resumeAfterLogin() {
    var fn = _afterLogin, kind = _afterLoginKind, at = _afterLoginAt;
    _afterLogin = null; _afterLoginKind = null; _afterLoginAt = 0;
    if (!fn || Date.now() - at > AFTER_LOGIN_TTL) return;
    /* ⚠️ 곧바로 다시 누르면 안 된다. 무료 횟수는 pullCloud() 가 서버에서 받아와야 생기는데
         그게 아직 안 끝났으면 '횟수 없음'으로 판정돼 엉뚱하게 요금제 창이 뜬다.
         그래서 잔량이 실제로 들어올 때까지 짧게 기다린다(최대 약 3.6초). */
    var tries = 0;
    (function wait() {
      tries++;
      var ok = false;
      try { ok = !!Subs.canUseAI(kind).ok; } catch (e) {}
      if (ok || tries > 12) { _runResume(fn); return; }
      setTimeout(wait, 300);
    })();
  }
  Subs.openLoginForFree = function (retry, kind) {
    if (retry) { _afterLogin = retry; _afterLoginKind = kind || null; _afterLoginAt = Date.now(); }
    /* ⚠️ 이미 로그인돼 있으면 로그인창을 열지 않는다. 지급 동기화가 늦어 여기까지 온 경우인데,
         창을 또 띄우면 '로그인했는데 왜 또?' 가 된다. */
    if (window.Cloud && Cloud.user) { _resumeAfterLogin(); return; }
    try {
      if (window.Cloud && Cloud.openModal) Cloud.openModal();
      var cm = document.getElementById('cloudModal');
      if (cm) { try { document.body.appendChild(cm); } catch (e) {} cm.classList.add('open'); }
      else toast('로그인 창을 불러오는 중이에요. 잠시 후 다시 시도해주세요', 'err');
    } catch (e) { toast('로그인 창 오류: ' + (e && e.message), 'err'); }
  };
  Subs.gateFeature = function (k, label, msg) {
    if (Subs.hasFeature(k)) return true;
    toast(msg || ((label || '이 기능') + '은 구독 사용자만 이용할 수 있습니다'), 'err');
    setTimeout(function () { Subs.openPlans(k); }, 400);
    return false;
  };
  // 사용 1회 차감: 쿠폰 → 월 한도 → 무료 지급분
  Subs.consumeAI = function (kind) {
    load(); rollover();
    if (S.admin === true) return;  // 관리자는 차감 없음
    if (S.coupon.exp > Date.now() && (S.coupon[kind] || 0) > 0) { S.coupon[kind]--; persist(); renderSettings(); return; }
    /* ⭐ 2026-08-23 월 한도가 **남아 있을 때만** 월 사용량에서 빼고, 다 쓰면
         무료 지급분으로 넘어간다(합산). 월 한도는 다음 달에 리셋되고 무료
         지급분은 설치 시 1회뿐이라, 월 한도를 먼저 쓰는 쪽이 사용자에게 유리하다.
         ⚠️ 예전에는 유료 플랜이면 한도를 넘겨도 used 만 계속 늘렸다. */
    var cap = Subs.planInfo()[kind] || 0;
    if (cap > 0 && (S.used[kind] || 0) < cap) { S.used[kind] = (S.used[kind] || 0) + 1; persist(); renderSettings(); return; }
    if ((S.freeLeft[kind] || 0) > 0) S.freeLeft[kind]--;
    persist(); renderSettings();
  };

  /* ── 쿠폰 등록 ── */
  Subs.redeemCoupon = async function (code) {
    code = String(code || '').trim().toUpperCase();
    if (!code) { toast('쿠폰 코드를 입력해주세요', 'err'); return false; }
    if (!loggedIn()) { toast('쿠폰 등록은 로그인 후 가능합니다 (설정 → 기본 정보 → 로그인)', 'err'); return false; }
    var uid = Cloud.user.uid;
    var ref = fdb().collection('coupons').doc(code);
    try {
      var ok = await fdb().runTransaction(async function (tx) {
        var doc = await tx.get(ref);
        if (!doc.exists) throw new Error('존재하지 않는 쿠폰입니다');
        var d = doc.data() || {};
        if (d.active === false) throw new Error('사용이 중지된 쿠폰입니다');
        if (d.expiresAt && d.expiresAt.toMillis && Date.now() > d.expiresAt.toMillis()) throw new Error('기한이 지난 쿠폰입니다');
        var usedBy = d.usedBy || {};
        if (usedBy[uid]) throw new Error('이미 등록한 쿠폰입니다');
        var maxUses = d.maxUses || 1;
        if ((d.usedCount || 0) >= maxUses) throw new Error('모두 소진된 쿠폰입니다');
        var patch = { usedCount: (d.usedCount || 0) + 1 };
        patch['usedBy.' + uid] = Date.now();
        tx.update(ref, patch);
        return { sched: d.sched || 0, blog: d.blog || 0, validDays: d.validDays || 30 };
      });
      load();
      var now = Date.now();
      var exp = now + (ok.validDays * 86400000);
      // 기존 쿠폰이 살아있으면 크레딧 합산 + 만료는 더 늦은 쪽
      if (S.coupon.exp > now) {
        S.coupon.sched += ok.sched; S.coupon.blog += ok.blog;
        S.coupon.exp = Math.max(S.coupon.exp, exp);
      } else {
        S.coupon = { sched: ok.sched, blog: ok.blog, exp: exp };
      }
      persist(); renderSettings();
      toast('🎟️ 쿠폰 등록! 일정 +' + ok.sched + '회, 글작성 +' + ok.blog + '회 (' + ok.validDays + '일간)', 'ok');
      return true;
    } catch (e) {
      toast('쿠폰 등록 실패: ' + ((e && e.message) || ''), 'err');
      return false;
    }
  };

  /* ── 쿠폰 발급 (관리자 전용: users/{uid}.admin == true) ── */
  function genCode() {
    var s = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', out = 'AC-';
    for (var i = 0; i < 8; i++) { if (i === 4) out += '-'; out += s[Math.floor(Math.random() * s.length)]; }
    return out;
  }
  Subs.openCouponAdmin = function () {
    if (!loggedIn() || !S.admin) { toast('관리자만 사용할 수 있습니다', 'err'); return; }
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:2400;display:flex;align-items:center;justify-content:center;padding:16px;';
    ov.innerHTML = '<div style="background:var(--sf);border-radius:14px;padding:18px;max-width:420px;width:100%;">' +
      '<div style="font-size:16px;font-weight:800;margin-bottom:10px;">🎟️ 쿠폰 발급 (관리자)</div>' +
      '<label style="font-size:12px;color:var(--mu);font-weight:700;">코드</label>' +
      '<input class="cust-inp" id="cpCode" value="' + genCode() + '" style="width:100%;margin:4px 0 10px;">' +
      '<div style="display:flex;gap:8px;">' +
        '<div style="flex:1;"><label style="font-size:12px;color:var(--mu);font-weight:700;">일정등록 횟수</label>' +
          '<input class="cust-inp" id="cpSched" type="number" value="200" style="width:100%;margin-top:4px;"></div>' +
        '<div style="flex:1;"><label style="font-size:12px;color:var(--mu);font-weight:700;">글작성 횟수</label>' +
          '<input class="cust-inp" id="cpBlog" type="number" value="100" style="width:100%;margin-top:4px;"></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:10px;">' +
        '<div style="flex:1;"><label style="font-size:12px;color:var(--mu);font-weight:700;">유효기간(일)</label>' +
          '<input class="cust-inp" id="cpDays" type="number" value="30" style="width:100%;margin-top:4px;"></div>' +
        '<div style="flex:1;"><label style="font-size:12px;color:var(--mu);font-weight:700;">사용 가능 인원</label>' +
          '<input class="cust-inp" id="cpMax" type="number" value="1" style="width:100%;margin-top:4px;"></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:14px;">' +
        '<button class="btn b-blue" id="cpMake" style="flex:1;">발급</button>' +
        '<button class="btn b-ghost" id="cpCancel">취소</button>' +
      '</div></div>';
    document.body.appendChild(ov);
    var close = function () { if (ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('#cpCancel').onclick = close;
    ov.querySelector('#cpMake').onclick = async function () {
      var code = ov.querySelector('#cpCode').value.trim().toUpperCase();
      var sched = parseInt(ov.querySelector('#cpSched').value, 10) || 0;
      var blog = parseInt(ov.querySelector('#cpBlog').value, 10) || 0;
      var days = parseInt(ov.querySelector('#cpDays').value, 10) || 30;
      var maxUses = parseInt(ov.querySelector('#cpMax').value, 10) || 1;
      if (!code) { toast('코드를 입력해주세요', 'err'); return; }
      try {
        await fdb().collection('coupons').doc(code).set({
          sched: sched, blog: blog, validDays: days, maxUses: maxUses,
          usedCount: 0, usedBy: {}, active: true,
          createdBy: Cloud.user.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        close();
        var msg = '🎟️ 쿠폰 발급됨\n\n코드: ' + code + '\n일정 ' + sched + '회 · 글작성 ' + blog + '회 · ' + days + '일 · ' + maxUses + '명';
        try { if (navigator.clipboard) navigator.clipboard.writeText(code); } catch (e) {}
        alert(msg + '\n\n(코드가 복사되었습니다)');
      } catch (e) { toast('발급 실패: ' + (e && e.code), 'err'); }
    };
  };

  /* ── 사용자 플랜 관리 (관리자 전용) ─ Play 결제 연동 전 수동 지정용 ── */
  Subs.openPlanManager = function () {
    load();
    if (!loggedIn() || !S.admin) { toast('관리자만 사용할 수 있습니다', 'err'); return; }
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:2400;display:flex;align-items:flex-start;justify-content:center;padding:40px 16px 16px;overflow-y:auto;';
    ov.innerHTML = '<div style="background:var(--sf);border-radius:14px;padding:18px;max-width:440px;width:100%;">' +
      '<div style="font-size:16px;font-weight:800;margin-bottom:4px;">🛠️ 사용자 플랜 관리 (관리자)</div>' +
      '<div style="font-size:12px;color:var(--mu);margin-bottom:12px;">사용자 이메일로 검색해 플랜을 지정합니다. Google Play 결제 연동 전까지 수동 지정용.</div>' +
      '<div style="display:flex;gap:8px;">' +
        '<input class="cust-inp" id="pmEmail" placeholder="사용자 이메일" autocapitalize="off" style="flex:1;">' +
        '<button class="btn b-blue" id="pmFind">검색</button>' +
      '</div>' +
      '<div id="pmResult" style="margin-top:12px;"></div>' +
      '<button class="btn b-ghost" id="pmClose" style="width:100%;justify-content:center;margin-top:14px;">닫기</button>' +
      '</div>';
    document.body.appendChild(ov);
    var close = function () { if (ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('#pmClose').onclick = close;
    var box = ov.querySelector('#pmResult');
    var inp = ov.querySelector('#pmEmail');
    var doFind = async function () {
      var email = (inp.value || '').trim().toLowerCase();
      if (!email) { toast('이메일을 입력해주세요', 'err'); return; }
      box.innerHTML = '<div style="font-size:13px;color:var(--mu);">검색 중…</div>';
      try {
        var snap = await fdb().collection('users').where('shareCode', '==', email).limit(1).get();
        if (snap.empty) { box.innerHTML = '<div style="font-size:13px;color:var(--wn);">해당 이메일의 사용자를 찾을 수 없습니다.<br>(상대가 앱에서 로그인/가입한 적이 있어야 합니다)</div>'; return; }
        var doc = snap.docs[0];
        renderUser(doc.id, doc.data() || {});
      } catch (e) { box.innerHTML = '<div style="font-size:13px;color:#e5484d;">검색 실패: ' + esc((e && (e.code || e.message)) || '') + '</div>'; }
    };
    ov.querySelector('#pmFind').onclick = doFind;
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') doFind(); });
    function renderUser(uid, d) {
      var cur = PLANS[d.plan] ? d.plan : 'free';
      var bill = PLANS[d.billingPlan] ? d.billingPlan : null;   // ★ 결제로 받은 플랜(수동 지정과 별개)
      var isAdm = (d.admin === true);
      var name = esc(d.nickname || d.displayName || d.email || uid);
      var planBtns = ['free', 'lite', 'basic', 'pro', 'master'].map(function (k) {
        var on = (cur === k);
        return '<button class="btn ' + (on ? 'b-blue' : 'b-ghost') + ' pmPlan" data-plan="' + k + '" style="flex:1;justify-content:center;padding:8px 4px;font-size:12px;">' + PLANS[k].name + '</button>';
      }).join('');
      box.innerHTML =
        '<div style="border:1px solid var(--bd);border-radius:12px;padding:12px 14px;">' +
        '<div style="font-size:14px;font-weight:700;">' + name + (isAdm ? ' 👑' : '') + '</div>' +
        '<div style="font-size:12px;color:var(--mu);margin:2px 0 10px;">' + esc(d.email || '') +
          (bill ? ('<br>💳 결제 구독: <b style="color:var(--ac);">' + PLANS[bill].name + '</b>') : '') +
          '<br>수동 지정: <b>' + PLANS[cur].name + '</b>' +
          (bill ? '<br><span style="font-size:11px;">실제 적용은 결제 구독이 우선입니다</span>' : '') +
        '</div>' +
        '<div style="font-size:11px;color:var(--mu);margin-bottom:4px;">플랜 지정</div>' +
        '<div style="display:flex;gap:6px;">' + planBtns + '</div>' +
        '<label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:13px;">' +
          '<input type="checkbox" id="pmAdmin"' + (isAdm ? ' checked' : '') + '> 관리자 권한 (모든 기능 무제한)</label>' +
        '</div>';
      Array.prototype.forEach.call(box.querySelectorAll('.pmPlan'), function (btn) {
        btn.onclick = async function () {
          var k = btn.getAttribute('data-plan');
          if (k === cur) return;
          try {
            await fdb().collection('users').doc(uid).set({ plan: k }, { merge: true });
            toast('✅ ' + name + ' → ' + PLANS[k].name + ' 플랜으로 변경', 'ok');
            if (uid === Cloud.user.uid) { S.plan = k; persist(); renderSettings(); }
            d.plan = k; renderUser(uid, d);
          } catch (e) { toast('변경 실패: ' + ((e && e.code) || (e && e.message) || ''), 'err'); }
        };
      });
      var adm = box.querySelector('#pmAdmin');
      if (adm) adm.onchange = async function () {
        var v = adm.checked;
        if (!confirm(v ? name + ' 계정에 관리자 권한을 부여할까요?' : name + ' 계정의 관리자 권한을 해제할까요?')) { adm.checked = !v; return; }
        try {
          await fdb().collection('users').doc(uid).set({ admin: v }, { merge: true });
          toast(v ? '👑 관리자 권한 부여됨' : '관리자 권한 해제됨', 'ok');
          d.admin = v;
          if (uid === Cloud.user.uid) { S.admin = v; persist(); renderSettings(); }
        } catch (e) { adm.checked = !v; toast('변경 실패: ' + ((e && e.code) || (e && e.message) || ''), 'err'); }
      };
    }
  };

  /* ★ 2026-08-26 '팀원' 요금제를 팀을 만들 수 있는 줄 알고 결제하는 사례가 있었다.
       안내 문구는 원래 있었지만 11px 회색 보조문구라 눈에 안 들어왔다 → 경고 박스로 올린다. */
  var LITE_WARN =
    '<div style="margin-top:10px;border:1.5px solid var(--wn);background:rgba(240,180,41,.12);border-radius:10px;padding:10px 12px;">' +
      '<div style="font-size:13px;font-weight:800;color:var(--wn);line-height:1.5;">❗ 팀 만들기 ✕ · AI 글작성 ✕</div>' +
      '<div style="font-size:12px;color:var(--tx);margin-top:5px;line-height:1.6;">' +
        'AI <b>일정등록만</b> 쓰거나, <b>이미 만들어진 팀에 초대 코드로 참여</b>할 때 쓰는 요금제입니다.<br>' +
        '내가 팀을 직접 만들려면 <b>베이직(월 9,900원)</b> 이상이 필요합니다.' +
      '</div>' +
    '</div>';

  /* ── 요금제 안내 ── */
  Subs.openPlans = function () {
    load();
    var billingOn = !!(window.Billing && Billing.available && Billing.available());
    var rows = ['lite', 'basic', 'pro', 'master'].map(function (k) {
      var p = PLANS[k];
      var cur = (effPlan() === k);
      var buyBtn = (billingOn && !cur)
        ? '<button class="btn b-blue subsBuy" data-plan="' + k + '" style="width:100%;justify-content:center;margin-top:8px;">구독하기</button>'
        : '';
      return '<div style="border:1px solid ' + (cur ? 'var(--ac)' : 'var(--bd)') + ';border-radius:12px;padding:12px 14px;margin-bottom:8px;' + (cur ? 'background:rgba(124,92,255,.08);' : '') + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<b style="font-size:14px;">' + p.name +
            (p.teamCreate ? '' : ' <span style="font-size:10px;font-weight:800;color:var(--wn);background:rgba(240,180,41,.18);border-radius:6px;padding:2px 6px;vertical-align:middle;">팀 참여 전용</span>') +
            (cur ? ' <span style="font-size:11px;color:var(--ac);">현재 이용중</span>' : '') + '</b>' +
          '<b style="font-size:14px;">월 ' + p.price.toLocaleString('ko-KR') + '원</b>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--mu);margin-top:6px;line-height:1.6;">' +
          (p.unlimited ? 'AI 일정등록·글작성 무제한*'
                       : ((p.sched || p.blog) ? ('AI 일정등록 월 ' + p.sched + '회 · 글작성 월 ' + p.blog + '회')
                                              : 'AI 기능 미포함 (무료 제공분만 사용)')) +
          '<br>일정공유 ✓ · 채팅 ✓' + (p.chatMedia ? ' · 채팅 사진/영상 ✓' : ' · 채팅은 텍스트/문서만') +
          (p.teamCreate ? '<br>팀 만들기 ✓ · 팀 참여 ✓' : '') +
        '</div>' + (p.teamCreate ? '' : LITE_WARN) + buyBtn + '</div>';
    }).join('');
    var footMsg = billingOn
      ? '<div style="font-size:12px;color:var(--mu);margin-top:10px;line-height:1.6;">결제는 Google Play를 통해 안전하게 진행됩니다. <a href="#" id="plRestore" style="color:var(--ac);">구매 복원</a> · <a href="#" id="plManage" style="color:var(--ac);">구독 관리</a></div>'
      : '<div style="font-size:12px;color:var(--wn);margin-top:10px;line-height:1.6;">💳 결제는 앱(안드로이드)에서만 가능합니다.<br>웹에서는 문의(bsc500327@gmail.com)로 연락주시면 수동으로 등급을 올려드립니다.</div>';
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:2400;display:flex;align-items:flex-start;justify-content:center;padding:40px 16px 16px;overflow-y:auto;';
    ov.innerHTML = '<div style="background:var(--sf);border-radius:14px;padding:18px;max-width:440px;width:100%;">' +
      '<div style="font-size:16px;font-weight:800;margin-bottom:4px;">⭐ 구독 안내</div>' +
      '<div style="font-size:12px;color:var(--mu);margin-bottom:12px;">무료: 모든 기본 기능 + 사진 폰 저장 · AI 일정 30회/글작성 5회(1회 지급) · 일정공유/채팅 미포함' +
        '<br>남아 있는 무료 지급분은 구독한 뒤에도 <b>사라지지 않고 월 한도와 합산</b>됩니다(월 한도를 먼저 사용).</div>' +
      rows +
      '<div style="font-size:11px;color:var(--mu);margin-top:6px;line-height:1.5;">*무제한: 공정 사용 정책(월 일정 1,500회·글 300회 초과 시 속도 제한). 가격은 부가세 포함.</div>' +
      footMsg +
      '<button class="btn b-blue" id="plClose" style="width:100%;justify-content:center;margin-top:12px;">닫기</button></div>';
    document.body.appendChild(ov);
    var close = function () { if (ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('#plClose').onclick = close;
    Array.prototype.forEach.call(ov.querySelectorAll('.subsBuy'), function (b) {
      b.onclick = function () {
        var k = b.getAttribute('data-plan');
        /* ★ 2026-08-26 팀원(lite) 오구매 방지 — 결제 직전에 범위를 한 번 더 확인받는다. */
        if (!(PLANS[k] || {}).teamCreate && !confirm(
              '「라이트」 요금제는 팀 참여 전용입니다.\n\n' +
              '• 팀 만들기 ✕ (베이직 월 9,900원부터)\n' +
              '• AI 일정등록 월 50회 · AI 글작성 ✕\n' +
              '• 일정공유 ✓ · 채팅 ✓\n\n' +
              '이미 만들어진 팀에 초대 코드로 들어가시는 경우에만 선택해주세요.\n계속할까요?')) return;
        close(); if (window.Billing) Billing.purchase(k);
      };
    });
    var rb = ov.querySelector('#plRestore'); if (rb) rb.onclick = function (e) { e.preventDefault(); if (window.Billing) Billing.restore(); };
    var mb = ov.querySelector('#plManage'); if (mb) mb.onclick = function (e) { e.preventDefault(); if (window.Billing) Billing.manage(); };
  };

  /* ── 설정 화면 렌더 ── */
  function renderSettings() {
    var box = document.getElementById('subsSecBody');
    if (!box) return;
    load(); rollover();
    var p = Subs.planInfo();
    var qs = Subs.quota('sched'), qb = Subs.quota('blog');
    var isAdm = (S.admin === true);
    function line(label, q, monthlyMax) {
      var parts = [];
      if (isAdm) parts.push('무제한 (관리자)');
      else if (!monthlyMax) parts.push('남은 ' + q.free + '회');
      else if (p.unlimited) parts.push('무제한');
      else parts.push('이번 달 ' + q.monthly + '/' + monthlyMax + '회 남음');
      // ★ 2026-08-23 구독 중에도 무료 지급분이 남아 있으면 함께 보여준다(합산)
      if (monthlyMax && !p.unlimited && q.free > 0) parts.push('무료 +' + q.free + '회');
      if (q.coupon > 0) parts.push('🎟️ 쿠폰 +' + q.coupon + '회');
      return '<div style="display:flex;justify-content:space-between;font-size:13px;padding:6px 0;">' +
        '<span>' + label + '</span><span style="color:var(--mu);">' + parts.join(' · ') + '</span></div>';
    }
    var couponExp = (S.coupon.exp > Date.now()) ? '<div style="font-size:11px;color:var(--mu);">쿠폰 만료: ' + new Date(S.coupon.exp).toLocaleDateString('ko-KR') + '</div>' : '';
    box.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
        '<div style="font-size:14px;"><b>' + (isAdm ? '👑 관리자' : p.name) + '</b>' + (isAdm ? ' <span style="font-size:11px;color:var(--ac);">모든 기능 무제한</span>' : ' 플랜' + (p.price ? ' <span style="font-size:12px;color:var(--mu);">월 ' + p.price.toLocaleString('ko-KR') + '원</span>' : '')) + '</div>' +
        '<button class="btn b-ghost b-xs" id="subsPlansBtn">요금제 보기</button>' +
      '</div>' +
      line('📩 AI 일정등록', qs, p.sched) +
      line('✍️ AI 글작성', qb, p.blog) +
      couponExp +
      '<div style="display:flex;gap:6px;margin-top:10px;">' +
        '<button class="btn b-blue" id="subsCouponBtn" style="flex:1;justify-content:center;">🎟️ 쿠폰 등록</button>' +
        (S.admin ? '<button class="btn b-ghost" id="subsCouponAdminBtn">쿠폰 발급</button>' : '') +
      '</div>' +
      (S.admin ? '<button class="btn b-ghost" id="subsPlanMgrBtn" style="width:100%;justify-content:center;margin-top:6px;">🛠️ 사용자 플랜 관리</button>' : '');
    var pb = document.getElementById('subsPlansBtn');
    if (pb) pb.onclick = function () { Subs.openPlans(); };
    var cb = document.getElementById('subsCouponBtn');
    if (cb) cb.onclick = function () {
      var code = prompt('쿠폰 코드를 입력하세요 (예: AC-XXXX-XXXX)');
      if (code != null) Subs.redeemCoupon(code);
    };
    var ab = document.getElementById('subsCouponAdminBtn');
    if (ab) ab.onclick = function () { Subs.openCouponAdmin(); };
    var pm = document.getElementById('subsPlanMgrBtn');
    if (pm) pm.onclick = function () { Subs.openPlanManager(); };
  }
  Subs.renderSettings = renderSettings;

  document.addEventListener('DOMContentLoaded', function () {
    load();
    renderSettings();
    if (loggedIn()) pullCloud();
    // 설정 모달이 열릴 때마다 최신 admin/plan 재조회 → 첫 로그인 직후 재시작 없이 반영
    try {
      var _sm = document.getElementById('settingsModal');
      if (_sm) new MutationObserver(function () {
        if (_sm.classList.contains('open') && loggedIn()) pullCloud();
      }).observe(_sm, { attributes: true, attributeFilter: ['class'] });
    } catch (e) {}
  });
})();
