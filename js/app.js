/* ═══════════════════════════════
   APP ENTRY POINT
═══════════════════════════════ */

// 서비스 워커 등록 (PWA) - 자동 업데이트 + 새 버전 즉시 적용
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(reg => {
    // 1시간마다 업데이트 체크
    setInterval(() => reg.update(), 60 * 60 * 1000);

    // 새 버전 감지 시 즉시 reload
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // 새 버전이 설치됐으면 자동으로 새로고침
          console.log('🔄 새 버전 감지 - 새로고침');
          window.location.reload();
        }
      });
    });

    // 페이지 로드 시 즉시 업데이트 체크
    reg.update();
  }).catch(()=>{});
}

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
  // 회사 아이콘 적용 (앱 로고에 반영)
  if (typeof applyCoIcon === 'function') applyCoIcon();
});
