/* ═══════════════════════════════════════════════
   APP VERSION
   - 1.0 = 2026-05-04 정식 출시
   - 이후 버그 수정/소소한 개선: 1.001, 1.002, ...
   - 큰 기능 추가: 1.1, 1.2, ...
   - 메이저 업데이트: 2.0
═══════════════════════════════════════════════ */

const APP_VERSION = '1.111';
const APP_VERSION_DATE = '2026-05-10';

// 버전 표시 갱신 함수
function applyAppVersion() {
  const el = document.getElementById('appVersion');
  if (el) el.textContent = `v${APP_VERSION}`;
}

if (typeof window !== 'undefined') {
  window.APP_VERSION = APP_VERSION;
  window.APP_VERSION_DATE = APP_VERSION_DATE;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyAppVersion);
  } else {
    applyAppVersion();
  }
}
