/* ═══════════════════════════════════════════════════════════
   myloc.js — 지금 내 위치 (그날 지도에서만 쓴다)
   ----------------------------------------------------------------
   ⭐ 플러그인을 쓰지 않는다. WebView 의 navigator.geolocation 을 그대로 쓴다.
      캐패시터가 그 호출을 받아 **안드로이드 런타임 권한을 알아서 물어본다**
      (@capacitor/android BridgeWebChromeClient.onGeolocationPermissionsShowPrompt).
      그래서 필요한 것은 AndroidManifest 의 권한 선언 두 줄뿐이고,
      새 네이티브 의존성이 늘지 않는다(설치·동기화 단계가 안 늘어난다).
      ⚠️ 대신 그 권한 선언을 빼면 조용히 '거부'로 떨어진다. 둘은 한 쌍이다.

   ☠️ 위치는 '있으면 좋은 것'이지 '없으면 안 되는 것'이 아니다.
      권한을 거부해도, GPS 가 안 잡혀도, 시간이 걸려도 **지도는 그대로 떠야 한다.**
      그래서 이 모듈은 어떤 경우에도 reject 하지 않고 null 을 돌려준다.

   ⚠️ 거부를 기억한다. 안 그러면 지도를 열 때마다 시스템 권한 창이 떠서,
      위치를 안 쓰겠다고 한 사람을 계속 괴롭힌다.
      다만 **영영 막지는 않는다** — 지도 안 [내 위치] 버튼으로 다시 물어볼 수 있다
      (force:true). 생각이 바뀌는 건 흔한 일이다.

   ⚠️ 잠깐 기억한다(2분). 지도를 닫았다 다시 여는 건 아침에 흔한 일인데,
      그때마다 GPS 를 새로 켜면 느리고 배터리를 먹는다. 차로 이동 중이면
      2분이면 위치가 꽤 달라지므로 그보다 길게 잡지 않는다.
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var DENY_KEY = 'ac_geoloc_denied';      // 거부한 시각(ms) — 다시 묻지 않으려고
  var FRESH_MS = 2 * 60 * 1000;           // 이 안쪽이면 기억해 둔 위치를 그대로
  var TIMEOUT_MS = 8000;                  // 이보다 오래 걸리면 포기 (지도를 붙잡아 두지 않는다)

  var _last = null;                       // { lat, lng, acc, t }

  function available() {
    try { return !!(navigator && navigator.geolocation && navigator.geolocation.getCurrentPosition); }
    catch (e) { return false; }
  }
  function denied() {
    try { return !!parseInt(localStorage.getItem(DENY_KEY) || '0', 10); } catch (e) { return false; }
  }
  function noteDenied(on) {
    try {
      if (on) localStorage.setItem(DENY_KEY, String(Date.now()));
      else localStorage.removeItem(DENY_KEY);
    } catch (e) {}
  }

  /* 기억해 둔 위치가 아직 쓸 만한가 */
  function fresh() {
    if (!_last) return null;
    if (Date.now() - _last.t > FRESH_MS) return null;
    return { lat: _last.lat, lng: _last.lng, acc: _last.acc };
  }

  /* opts.force — 사용자가 [내 위치] 를 직접 눌렀다. 거부 기억을 무시하고 다시 묻는다.
     돌려주는 값: { lat, lng, acc } 또는 null. **절대 reject 하지 않는다.** */
  function get(opts) {
    opts = opts || {};
    if (!available()) return Promise.resolve(null);
    if (!opts.force) {
      var f = fresh();
      if (f) return Promise.resolve(f);
      if (denied()) return Promise.resolve(null);
    }
    return new Promise(function (res) {
      var done = false;
      var finish = function (v) { if (done) return; done = true; res(v); };
      /* ⚠️ 자체 시계도 둔다. 안드로이드에서 권한 창이 뜬 채로 사용자가 아무것도 안 누르면
         geolocation 의 timeout 이 돌지 않는 경우가 있다(창이 답을 기다리는 동안 멈춤).
         그 상태로 두면 '지도를 불러오는 중…' 이 영영 남는다. */
      var t = setTimeout(function () { finish(null); }, TIMEOUT_MS + 2000);
      try {
        navigator.geolocation.getCurrentPosition(
          function (p) {
            clearTimeout(t);
            noteDenied(false);
            var c = (p && p.coords) || {};
            if (typeof c.latitude !== 'number' || typeof c.longitude !== 'number') { finish(null); return; }
            _last = { lat: c.latitude, lng: c.longitude, acc: c.accuracy || 0, t: Date.now() };
            finish({ lat: _last.lat, lng: _last.lng, acc: _last.acc });
          },
          function (err) {
            clearTimeout(t);
            /* code 1 = PERMISSION_DENIED. 2(위치 못 구함)·3(시간초과)은 거부가 아니다 —
               지하주차장에서 한 번 못 잡았다고 다음부터 안 묻는 건 말이 안 된다. */
            if (err && err.code === 1) noteDenied(true);
            finish(null);
          },
          { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: 60000 }
        );
      } catch (e) { clearTimeout(t); finish(null); }
    });
  }

  /* 두 지점 사이 직선거리(m) — 경로를 못 그릴 때 거리라도 보여 주려고.
     ⚠️ 직선이다. '몇 km 남았다'로 읽히면 안 되므로 화면에서는 '직선'이라고 적는다. */
  function distance(a, b) {
    if (!a || !b) return 0;
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    var la1 = a.lat * rad, la2 = b.lat * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
  }
  function fmtKm(m) {
    if (!m) return '';
    return (m < 1000) ? (m + 'm') : ((m / 1000).toFixed(m < 10000 ? 1 : 0) + 'km');
  }

  window.MyLoc = {
    available: available, get: get, denied: denied,
    forget: function () { _last = null; noteDenied(false); },
    distance: distance, fmtKm: fmtKm
  };
  window.__mylocInternals = { DENY_KEY: DENY_KEY, FRESH_MS: FRESH_MS, TIMEOUT_MS: TIMEOUT_MS };
})();
