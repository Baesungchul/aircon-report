/* ═══════════════════════════════════════════════
   APP VERSION
   - 1.0 = 2026-06-12 Google Play 정식 출시
   - 이후 버그 수정/소소한 개선: 1.001, 1.002, ...
   - 큰 기능 추가: 1.1, 1.2, ...
   - 메이저 업데이트: 2.0
═══════════════════════════════════════════════ */

/* ⚠️ 이 값은 android/app/build.gradle 의 versionName 과 **반드시 같아야** 한다.
   따로 놀면 사용자가 보는 번호와 스토어 번호가 어긋나고,
   version_gate.js 의 강제 업데이트 판정(minVersion 비교)도 엉뚱해진다.
   배포할 때 build.gradle(versionCode +1, versionName) 과 여기를 같이 고칠 것. */
const APP_VERSION = '3.2.3';
const APP_VERSION_DATE = '2026-08-30';

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
