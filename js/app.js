/* ═══════════════════════════════
   APP ENTRY POINT
═══════════════════════════════ */

// 서비스 워커 등록 (PWA)
if ('serviceWorker' in navigator)
  navigator.serviceWorker.register('./sw.js').catch(()=>{});

// 페이지 로드 시 init 실행
document.addEventListener('DOMContentLoaded', init);
