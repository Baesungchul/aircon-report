/* ═══════════════════════════════
   APP ENTRY POINT
═══════════════════════════════ */

// 서비스 워커 등록 (PWA)
if ('serviceWorker' in navigator)
  navigator.serviceWorker.register('./sw.js').catch(()=>{});

// 테마/폰트 설정은 최대한 빨리 적용 (깜빡임 방지)
(function() {
  try {
    const theme = localStorage.getItem('ac_theme_v1');
    if (theme && theme !== 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
    }
    const fsIdx = parseInt(localStorage.getItem('ac_fs_index_v1') || '2', 10);
    const fsSizes = [13, 14, 15, 16, 17, 18];
    const size = fsSizes[Math.max(0, Math.min(5, fsIdx))] || 15;
    document.documentElement.style.setProperty('--fs-base', size + 'px');
  } catch(e) {}
})();

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', async () => {
  await init();
  if (typeof loadSettings === 'function') loadSettings();
  if (typeof bindSettings === 'function') bindSettings();
  // 다국어 적용 (저장된 언어 설정으로)
  if (typeof applyI18nToDOM === 'function') applyI18nToDOM();
});
