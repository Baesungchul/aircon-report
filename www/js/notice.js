/* ═══════════════════════════════════════════════════════════════
   notice.js — 서버에서 바꾸는 앱 안 공지 (2026-09-07)

   왜 필요한가 (사용자 요청):
     "앱 사용자에게 기간한정 할인이라는 팝업 알림을 보내려면 어떻게 해야 할까?"
     — 지금까지 앱 안 안내는 두 가지뿐이었고 둘 다 프로모션에는 안 맞았다.
        · whatsnew.js : 문구가 **앱 코드**에 박혀 있다 → 고치려면 재빌드 + 심사 + 사용자 업데이트.
                        할인은 그 사이에 끝난다.
        · version_gate: "업데이트하세요" 전용.
     → 이 파일은 **서버(Firestore config/app 의 notice)** 만 고치면 뜨고 내려간다.
       한 번 배포해 두면 그 뒤로는 빌드가 필요 없다.

   ⚠️ version_gate.js 와 같은 문서를 읽는다(config/app). 규칙은 이미 열려 있다:
        match /config/{doc} { allow read: if true; allow write: if false; }

   ── 서버에 넣는 값 ──────────────────────────────────────────
     notice: {
       id:     'promo-2026-half',   // ☠️ 필수. 사람마다 한 번만 보이게 하는 열쇠.
                                    //    이 값을 바꾸면 모두에게 다시 뜬다(같은 내용이면 그대로 둘 것)
       title:  '기간 한정 50% 할인',
       body:   '10월 15일까지…',      // 줄바꿈 그대로 살아난다
       from:   '2026-09-10',         // (선택) 이 날짜부터
       until:  '2026-10-15',         // (선택) 이 날짜까지. 지나면 저절로 안 뜬다
       target: 'free',               // (선택) all(기본) | free(무료 사용자만) | paid(구독자만)
       cta:    '요금제 보기',          // (선택) 버튼 글자
       action: 'plans',              // (선택) plans(요금제 열기) | store | url
       url:    'https://…'           // action 이 url 일 때만
     }

   ☠️ 정가로 내고 있는 구독자에게 할인 공지를 띄우지 말 것 — target:'free' 를 쓴다.
      그 사람들이 제일 먼저 화를 낸다.
   ⚠️ 광고성 '전송'(푸시·문자)은 수신 동의가 필요한 영역이다. 이 파일은 앱을 연 사람에게
      앱 화면 안에서 보여줄 뿐이라 그와 다르지만, 문구에 과장·거짓 할인 표시는 넣지 말 것
      (표시광고법). 'until' 을 적었으면 그 날짜를 진짜로 지킬 것.
   ⚠️ 2026-09-07 사용자 지시로 팝업을 449→376 개로 줄인 참이다. 이 공지도 같은 규칙을 지킨다 —
      한 번 보면 다시 안 뜨고, 닫기가 있고, 기간이 지나면 스스로 사라진다.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var SEEN_KEY = 'ac_notice_seen';     // 마지막으로 본 공지 id
  var MAX_TRY = 20;

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function today() { return new Date().toISOString().slice(0, 10); }

  /* 다른 팝업이 떠 있으면 이번 실행은 건너뛴다 — whatsnew.js 와 같은 원칙.
     ⚠️ 업데이트 게이트를 덮으면 안 된다. 그건 더 급한 안내다. */
  function busy() {
    if (document.getElementById('verGate')) return true;
    if (document.getElementById('whatsNewOv')) return true;
    if (document.getElementById('noticeOv')) return true;
    try {
      if (document.querySelector('.ob-modal.open, .co-modal.open, .sl-modal.open, .dlg-backdrop.open')) return true;
    } catch (e) {}
    return false;
  }

  /* 구독 중인가 — target 판정에 쓴다. 아직 모르겠으면 null(=판정 보류) */
  function paid() {
    try {
      if (!(window.Subs && Subs.planInfo)) return null;
      var p = Subs.planInfo();
      return !!(p && p.price > 0);
    } catch (e) { return null; }
  }

  /* 지금 이 공지를 띄워야 하나 — 순수 함수라 tools 에서 그대로 검사한다 */
  function shouldShow(n, opts) {
    opts = opts || {};
    if (!n || !n.id || !n.title) return false;          // id·제목이 없으면 공지가 아니다
    if (opts.seen === n.id) return false;               // 이미 봤다
    var d = opts.today || today();
    if (n.from  && d < String(n.from))  return false;   // 아직 시작 전
    if (n.until && d > String(n.until)) return false;   // 이미 끝났다
    var t = n.target || 'all';
    if (t === 'free' && opts.paid === true) return false;
    if (t === 'paid' && opts.paid !== true) return false;
    return true;
  }
  window.__noticeShouldShow = shouldShow;   /* 검사용 — 화면에서는 쓰지 않는다 */

  function act(n) {
    var a = n.action || 'plans';
    if (a === 'url' && n.url) {
      try {
        if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Browser) {
          Capacitor.Plugins.Browser.open({ url: n.url }); return;
        }
      } catch (e) {}
      try { window.open(n.url, '_system'); } catch (e) {}
      return;
    }
    if (a === 'store') {
      try { window.open('https://play.google.com/store/apps/details?id=com.baesungchul.workreport', '_system'); } catch (e) {}
      return;
    }
    /* 기본: 요금제 화면 */
    try {
      if (window.Subs && Subs.openPlans) Subs.openPlans();
      else if (typeof showToast === 'function') showToast('설정 ▸ 요금제에서 볼 수 있습니다', 'err');
    } catch (e) {}
  }

  function show(n) {
    var ov = document.createElement('div');
    ov.id = 'noticeOv';
    ov.className = 'wn-ov';          /* whatsnew 와 같은 껍데기를 쓴다 — 스타일을 새로 만들지 않는다 */
    ov.innerHTML =
      '<div class="wn-box">' +
        '<div class="wn-head">' +
          (n.badge ? '<div class="wn-ver">' + esc(n.badge) + '</div>' : '') +
          '<div class="wn-lead">' + esc(n.title) + '</div>' +
        '</div>' +
        '<div class="wn-body"><div class="wn-block"><div class="wn-bd">' +
          esc(n.body || '').replace(/\n/g, '<br>') +
        '</div>' +
        (n.cta ? '<button class="wn-act" id="noticeAct">' + esc(n.cta) + ' ›</button>' : '') +
        '</div></div>' +
        /* ⚠️ id 에 'Close' 가 들어가야 한다 — state.js closeTopPopup() 이 하드웨어 뒤로가기에서
           button[id*="Close"] 를 찾아 눌러 준다(그래야 노드까지 정리된다). */
        '<div class="wn-foot"><button class="wn-close" id="noticeCloseBtn">닫기</button></div>' +
      '</div>';
    document.body.appendChild(ov);

    /* 글자 크기(zoom) 승계 — whatsnew 와 같다. 이 오버레이는 body 직속이라 설정 배율 밖이다 */
    try {
      var bx = ov.querySelector('.wn-box');
      var zs = (document.querySelector('.main') || {}).style;
      if (zs && zs.zoom) bx.style.zoom = zs.zoom;
    } catch (e) {}

    requestAnimationFrame(function () { ov.classList.add('open'); });
    set(SEEN_KEY, n.id);              /* ★ 실제로 띄운 뒤에만 기록한다 */

    function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
    ov.addEventListener('click', function (e) {
      if (e.target === ov || e.target.id === 'noticeCloseBtn') { close(); return; }
      if (e.target.id === 'noticeAct') { close(); setTimeout(function () { act(n); }, 220); }
    });
  }

  var tries = 0;
  function check() {
    if (!(window.Cloud && Cloud.db)) { if (++tries < MAX_TRY) setTimeout(check, 1500); return; }
    /* config/app 은 version_gate.js 와 함께 쓴다 — Cloud.appConfig 가 한 번만 읽는다(2026-09-08) */
    Cloud.appConfig().then(function (d) {
      var n = (d || {}).notice;
      if (!shouldShow(n, { seen: get(SEEN_KEY), paid: paid() })) return;
      if (busy()) { if (++tries < MAX_TRY) setTimeout(check, 1200); return; }
      show(n);
    }).catch(function (e) {
      console.warn('[공지] 읽기 실패:', e && e.message);   /* 조용히 넘어간다 — 공지 때문에 앱이 막히면 안 된다 */
    });
  }

  /* version_gate(2000ms) · whatsnew(2600ms) 뒤에 선다 — 업데이트 안내가 우선이다 */
  document.addEventListener('DOMContentLoaded', function () { setTimeout(check, 3200); });
})();
