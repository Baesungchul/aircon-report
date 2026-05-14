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

// ════════════════════════════════════════
// PWA 설치 프롬프트 (Android Chrome)
// ════════════════════════════════════════
let _deferredPWAPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  // 자동 프롬프트 막고 저장 (나중에 사용자 제스처로 호출)
  e.preventDefault();
  _deferredPWAPrompt = e;
  console.log('[PWA] 설치 가능 - 설정에서 버튼 표시');

  // 설정에 버튼/안내 표시
  const btn = document.getElementById('setInstallPWA');
  const hint = document.getElementById('pwaInstallHint');
  if (btn) btn.style.display = '';
  if (hint) hint.style.display = '';
});

window.promptPWAInstall = async function() {
  if (!_deferredPWAPrompt) {
    // iOS Safari 또는 이미 설치됨
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                       || window.navigator.standalone;
    if (isStandalone) {
      alert('✅ 이미 앱으로 설치되어 있어요');
    } else {
      alert('이 브라우저에서는 설치 버튼을 사용할 수 없어요.\n\n' +
            'Chrome 메뉴(⋮) → "홈 화면에 추가" 를 선택해주세요.');
    }
    return;
  }

  try {
    _deferredPWAPrompt.prompt();
    const choice = await _deferredPWAPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      console.log('[PWA] 설치됨');
      showToast?.('✅ 앱 설치 완료', 'ok');
      const btn = document.getElementById('setInstallPWA');
      const hint = document.getElementById('pwaInstallHint');
      if (btn) btn.style.display = 'none';
      if (hint) hint.style.display = 'none';
    }
    _deferredPWAPrompt = null;
  } catch(e) {
    console.warn('[PWA] 설치 실패:', e);
  }
};

// 이미 설치된 PWA로 실행 중이면 버튼 숨김
window.addEventListener('appinstalled', () => {
  const btn = document.getElementById('setInstallPWA');
  const hint = document.getElementById('pwaInstallHint');
  if (btn) btn.style.display = 'none';
  if (hint) hint.style.display = 'none';
});
