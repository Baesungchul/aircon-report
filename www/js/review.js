/* ═══════════════════════════════════════════════════════════
   REVIEW ─ 앱 안에서 별점 받기 (Google Play In-App Review)
   ★ 2026-08-27 신규.

   ☠️ 정책 — 여기 손대기 전에 반드시 읽을 것 (developer.android.com/guide/playcore/in-app-review)
   1) **평점 카드를 띄우기 전이나 띄우는 중에 어떤 질문도 하면 안 된다.**
      "앱이 마음에 드세요?" → 예면 스토어 / 아니오면 의견창 — 이 흔한 2단 필터는 **명시적 금지**다.
      유도 문구("별 5개 주시겠어요?")도 마찬가지. 그래서 이 파일은 **아무 것도 묻지 않고** 바로 부른다.
   2) **버튼으로 부르지 말 것.** 구글이 쿼터를 걸어 두어 눌러도 아무 일이 안 일어날 수 있고,
      그러면 고장난 것처럼 보인다. 문서가 "그런 용도라면 스토어로 보내라"고 못박았다.
      → 수동 경로는 `legal.js` 의 `openStoreReview()`(Play 리뷰 화면 열기)가 담당한다. 여기 버튼 만들지 말 것.
   3) **띄웠는지·별점을 남겼는지 알 수 없다.** 성공 콜백은 '흐름이 끝났다'는 뜻일 뿐이다.
      그래서 아래 기록은 전부 "**시도**했다"는 기록이지 "받았다"가 아니다. 통계로 쓰지 말 것.
   4) 쿼터 값은 비공개이고 예고 없이 바뀐다. 한 달 안에 여러 번 부르면 대개 안 뜬다.

   ⭐ 그래서 이 파일이 하는 일은 하나다 — **부를 만한 사람인지, 부를 만한 순간인지 판단.**
      실제로 띄울지는 구글이 정한다.
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  window.Review = window.Review || {};

  var K_FIRST   = 'rvFirstSeen';    // 이 기기에서 앱을 처음 연 시각(ms)
  var K_RUNS    = 'rvRunCount';     // 앱 실행 횟수
  var K_LASTTRY = 'rvLastTry';      // 마지막으로 카드를 부른 시각(ms)
  var K_LASTVER = 'rvLastVer';      // 마지막으로 부른 앱 버전
  var K_FAIL    = 'rvLastFail';     // 마지막으로 실패·오류를 겪은 시각(ms)

  /* 문턱 — 아무에게나 띄우면 낮은 별점만 받는다. '진짜 쓰는 사람'만 남긴다. */
  var MIN_DAYS  = 7;                        // 설치 후 7일
  var MIN_RUNS  = 5;                        // 앱 실행 5회
  var MIN_WORKS = 3;                        // 저장된 작업 3건
  var COOLDOWN  = 90 * 24 * 60 * 60 * 1000; // 다시 부르기까지 90일
  var FAIL_QUIET= 10 * 60 * 1000;           // 오류 직후 10분은 부르지 않는다

  function _n(k) { try { return parseInt(localStorage.getItem(k), 10) || 0; } catch (e) { return 0; } }
  function _set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }
  function _ver() { return String(window.APP_VERSION || '0'); }

  function isNative() {
    return !!(window.Capacitor && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform());
  }
  function _plugin() {
    return window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.InAppReview;
  }

  /* ── 실행 횟수·설치일 적립 (부팅 때 한 번) ── */
  function _tick() {
    if (!_n(K_FIRST)) _set(K_FIRST, Date.now());
    _set(K_RUNS, _n(K_RUNS) + 1);
  }

  /* ★ 오류를 겪은 직후에는 묻지 않는다. 실패한 사람에게 별점을 청하는 게 최악이다.
       실패 경로에서 이걸 불러 준다(report.js 등). */
  Review.markFailure = function () { _set(K_FAIL, Date.now()); };

  /* 저장된 작업 수 — 새 카운터를 만들지 않고 이미 있는 작업 인덱스를 센다.
     ⚠️ loadWorkIndex() 는 비동기이고 캐시되어 있어 싸다. 못 읽으면 '모름'(-1). */
  async function _workCount() {
    try {
      if (typeof loadWorkIndex !== 'function') return -1;
      var idx = await loadWorkIndex();
      return (idx && idx.works && idx.works.length) || 0;
    } catch (e) { return -1; }
  }

  /* 자격 판단 — 왜 걸렀는지 콘솔에 남긴다(현장 디버깅용) */
  async function _eligible() {
    if (!isNative())  return '앱(네이티브)이 아님';
    if (!_plugin())   return '플러그인 미등록 (npm install + cap sync 필요)';

    var now = Date.now();
    var first = _n(K_FIRST) || now;
    if (now - first < MIN_DAYS * 86400000) return '설치 후 ' + MIN_DAYS + '일 미만';
    if (_n(K_RUNS) < MIN_RUNS)             return '실행 ' + MIN_RUNS + '회 미만';

    var lastFail = _n(K_FAIL);
    if (lastFail && now - lastFail < FAIL_QUIET) return '최근 오류 직후';

    /* 같은 버전에서는 한 번만. 버전이 올라가면 쿨다운만 본다. */
    var lastVer = '';
    try { lastVer = localStorage.getItem(K_LASTVER) || ''; } catch (e) {}
    if (lastVer === _ver()) return '이 버전에서 이미 시도함';

    var lastTry = _n(K_LASTTRY);
    if (lastTry && now - lastTry < COOLDOWN) return '쿨다운 중';

    var wc = await _workCount();
    if (wc >= 0 && wc < MIN_WORKS) return '저장된 작업 ' + MIN_WORKS + '건 미만';

    return '';   // 통과
  }

  /* ── 바깥에서 부르는 유일한 입구 ──
       reason 은 로그용이다. 어디서 불렀는지 남겨야 나중에 시점을 조정할 수 있다.
       ⚠️ 성공 여부를 돌려주지 않는다 — 알 수 없기 때문이다(위 3번). */
  Review.maybeAsk = async function (reason) {
    try {
      var why = await _eligible();
      if (why) { console.log('[Review] 건너뜀 (' + reason + '): ' + why); return; }

      /* ⚠️ 기록을 **부르기 전에** 남긴다. 카드가 떴는지 알 수 없으므로,
           호출 자체를 1회로 세지 않으면 실패할 때마다 매번 다시 부르게 된다. */
      _set(K_LASTTRY, Date.now());
      _set(K_LASTVER, _ver());

      await _plugin().requestReview();
      console.log('[Review] 요청함 (' + reason + ')');
    } catch (e) {
      console.warn('[Review] 실패', e && (e.message || e));
    }
  };

  /* 좋은 순간에 곧바로 부르지 않고 살짝 늦춘다 —
     저장 완료 토스트가 뜨는 순간에 겹치면 화면이 어수선하다. */
  Review.maybeAskSoon = function (reason, delayMs) {
    setTimeout(function () { Review.maybeAsk(reason); }, delayMs || 1200);
  };

  try { _tick(); } catch (e) {}
})();
