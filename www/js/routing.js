/* ═══════════════════════════════════════════════════════════
   routing.js — 실제 도로 경로 (그날 지도의 선)
   ----------------------------------------------------------------
   ☠️ 아직 **꺼져 있다.** 카카오모빌리티 길찾기 API 사용 신청이 끝나고
      서버 함수가 올라가면 config_map.js 의 KAKAO_ROUTE_URL 한 줄만 채우면 켜진다.
      그때까지 route() 는 null 을 돌려주고, 지도는 지금처럼 점선(직선)으로 그린다.
      → 이 파일이 하는 일은 '자리를 비워 두는 것'이다. 켜질 때 cal_map.js 를
        건드리지 않아도 되게, 부르는 쪽 모양을 지금 확정해 둔다.

   왜 앱에서 직접 부르지 않는가
     · 지도 JS 키는 **도메인**으로 막혀 있어 공개돼도 괜찮다(config_map.js 주석 참고).
     · 길찾기 API 는 REST 키를 쓰는데 그런 장치가 없다. APK 에서 꺼내면 누구나
       쓸 수 있고 쿼터는 이 계정에서 나간다.
     → 그래서 Cloud Functions(asia-northeast3)를 한 번 거친다. 앱은 좌표만 보내고
       키는 서버 시크릿에 둔다. functions/index.js 의 adminStats 가 앤트로픽 키를
       다루는 방식과 같다.

   서버가 돌려줄 모양(그대로 그릴 수 있게 미리 정한다):
     { path: [[lat,lng], ...],        // 이어 그릴 좌표. 없으면 실패로 본다
       distance: 12345,               // m
       duration: 1800,                // 초
       legs: [{ distance, duration }] // 구간별(출발→1번, 1번→2번 …)
     }

   ⚠️ 카카오 쪽 응답은 x=경도, y=위도 순서다(위도·경도가 아니다).
      서버에서 [lat,lng] 로 바꿔 보내기로 한다 — 앱에서 뒤집으면 언젠가 한 번은
      섞인다. 바꾸는 자리를 한 곳으로 못 박아 둔다.
   ⚠️ 경유지는 최대 30개, 총 1,500km 미만이다(카카오 문서). 그날 일정이 그보다
      많을 일은 없지만, 넘으면 서버가 아니라 여기서 먼저 잘라 낸다.
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var MAX_POINTS = 31;          // 출발 1 + 경유·도착 30
  var TIMEOUT_MS = 8000;        // 지도를 붙잡아 두지 않는다

  function url() { return String(window.KAKAO_ROUTE_URL || ''); }
  function available() {
    var u = url();
    return !!u && u.indexOf('TODO_') !== 0 && /^https?:/.test(u);
  }

  /* points: [{lat,lng}, ...] — 첫 번째가 출발, 마지막이 도착.
     돌려주는 값: 위 주석의 객체, 또는 null. **절대 reject 하지 않는다** —
     경로를 못 그렸다고 지도가 안 뜨면 안 된다. */
  function route(points) {
    var pts = (points || []).filter(function (p) {
      return p && typeof p.lat === 'number' && typeof p.lng === 'number';
    });
    if (pts.length < 2) return Promise.resolve(null);
    if (!available()) return Promise.resolve(null);
    if (pts.length > MAX_POINTS) pts = pts.slice(0, MAX_POINTS);

    var ctl = null, timer = null;
    try { ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null; } catch (e) {}

    return new Promise(function (res) {
      var done = false;
      var finish = function (v) { if (done) return; done = true; clearTimeout(timer); res(v); };
      timer = setTimeout(function () {
        try { if (ctl) ctl.abort(); } catch (e) {}
        finish(null);
      }, TIMEOUT_MS);

      var opt = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: pts })
      };
      if (ctl) opt.signal = ctl.signal;

      fetch(url(), opt)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j || !Array.isArray(j.path) || j.path.length < 2) { finish(null); return; }
          finish({
            path: j.path,
            distance: j.distance || 0,
            duration: j.duration || 0,
            legs: Array.isArray(j.legs) ? j.legs : []
          });
        })
        .catch(function () { finish(null); });
    });
  }

  /* 초 → '1시간 20분' / '35분'. 경로를 그렸을 때 머리줄에 적는다 */
  function fmtMin(sec) {
    if (!sec) return '';
    var m = Math.round(sec / 60);
    if (m < 60) return m + '분';
    return Math.floor(m / 60) + '시간' + (m % 60 ? ' ' + (m % 60) + '분' : '');
  }

  window.Routing = { available: available, route: route, fmtMin: fmtMin, MAX_POINTS: MAX_POINTS };
})();
