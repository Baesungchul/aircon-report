/* ═══════════════════════════════════════════════
   version_gate.js — 앱 버전 게이트 (구버전 사용자 업데이트 유도)
   - Firestore config/app 문서를 읽어 현재 버전(APP_VERSION)과 비교
     · minVersion   : 이 버전 미만 → 강제(차단형) 업데이트 안내
     · latestVersion: 이 버전 미만(그러나 min 이상) → 권장(닫기 가능) 안내, 하루 1회
     · updateNote   : (선택) 안내 문구
   - 서버 값만 바꾸면 언제든 조절. Firestore 규칙에 config 읽기 허용 필요:
       match /config/{doc} { allow read: if true; allow write: if false; }
═══════════════════════════════════════════════ */
(function () {
  'use strict';
  var STORE_URL = 'https://play.google.com/store/apps/details?id=com.baesungchul.workreport';

  function cur() { return String(window.APP_VERSION || '0'); }
  function cmp(a, b) {
    a = String(a || '0').split('.').map(function (n) { return parseInt(n, 10) || 0; });
    b = String(b || '0').split('.').map(function (n) { return parseInt(n, 10) || 0; });
    for (var i = 0; i < Math.max(a.length, b.length); i++) {
      var x = a[i] || 0, y = b[i] || 0;
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  }
  function openStore() {
    try {
      if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Browser && Capacitor.Plugins.Browser.open) {
        Capacitor.Plugins.Browser.open({ url: STORE_URL }); return;
      }
    } catch (e) {}
    try { window.open(STORE_URL, '_system'); } catch (e) { try { window.location.href = STORE_URL; } catch (e2) {} }
  }
  function showGate(force, note) {
    if (document.getElementById('verGate')) return;
    var ov = document.createElement('div');
    ov.id = 'verGate';
    ov.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.78);';
    ov.innerHTML =
      '<div style="background:#fff;border-radius:16px;padding:26px 22px;max-width:340px;width:100%;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.3);">' +
        '<div style="font-size:42px;margin-bottom:10px;">⬆️</div>' +
        '<div style="font-size:17px;font-weight:800;color:#111;margin-bottom:8px;">' + (force ? '업데이트가 필요합니다' : '새 버전이 있습니다') + '</div>' +
        '<div style="font-size:13px;color:#555;line-height:1.65;margin-bottom:20px;">' + (note ? String(note).replace(/</g, '&lt;') : (force ? '계속 사용하려면 최신 버전으로 업데이트해주세요.' : '더 나은 사용을 위해 업데이트를 권장합니다.')) + '</div>' +
        '<button id="verGateUpdate" style="width:100%;padding:13px;border:0;border-radius:11px;background:#0f766e;color:#fff;font-size:15px;font-weight:800;">지금 업데이트</button>' +
        (force ? '' : '<button id="verGateLater" style="width:100%;padding:11px;margin-top:8px;border:0;border-radius:11px;background:transparent;color:#999;font-size:13px;">나중에</button>') +
      '</div>';
    document.body.appendChild(ov);
    document.getElementById('verGateUpdate').onclick = openStore;
    var later = document.getElementById('verGateLater');
    if (later) later.onclick = function () { ov.remove(); };
  }
  function check() {
    if (!(window.Cloud && Cloud.db)) { setTimeout(check, 1500); return; }
    try {
      Cloud.db.collection('config').doc('app').get().then(function (doc) {
        if (!doc.exists) return;
        var d = doc.data() || {};
        if (d.minVersion && cmp(cur(), d.minVersion) < 0) { showGate(true, d.updateNote); return; }
        if (d.latestVersion && cmp(cur(), d.latestVersion) < 0) {
          var today = new Date().toISOString().slice(0, 10);
          try { if (localStorage.getItem('verGateSeen') === today) return; localStorage.setItem('verGateSeen', today); } catch (e) {}
          showGate(false, d.updateNote);
        }
      }).catch(function () {});
    } catch (e) {}
  }
  document.addEventListener('DOMContentLoaded', function () { setTimeout(check, 2000); });
})();
