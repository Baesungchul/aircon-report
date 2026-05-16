/* ═══════════════════════════════
   APP ENTRY POINT
═══════════════════════════════ */

// ★ 전역 에러 핸들러 - 한 곳 에러로 앱 전체 멈춤 방지
window.addEventListener('error', e => {
  console.error('[전역에러]', e.error?.message || e.message, '\n', e.error?.stack);
  // 사용자에게는 알리지 않음 (이미 발생한 에러는 막을 수 없음)
});

window.addEventListener('unhandledrejection', e => {
  console.error('[Promise 거부]', e.reason?.message || e.reason);
  e.preventDefault();  // 콘솔 노이즈 차단
});

// 서비스 워커 등록 (PWA) - 자동 업데이트 + 새 버전 즉시 적용
if ('serviceWorker' in navigator) {
  // SW가 보내는 메시지 수신 (활성화 완료 시)
  let _reloadingFromSW = false;
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data && e.data.type === 'SW_UPDATED' && !_reloadingFromSW) {
      _reloadingFromSW = true;
      console.log('🔄 SW 갱신됨 - 새로고침:', e.data.version);
      setTimeout(() => window.location.reload(), 100);
    }
  });

  // SW controllerchange 시에도 새로고침 (가장 확실)
  let _refreshingFromController = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (_refreshingFromController) return;
    _refreshingFromController = true;
    console.log('🔄 새 SW 활성화 - 새로고침');
    window.location.reload();
  });

  navigator.serviceWorker.register('./sw.js').then(reg => {
    // 30분마다 업데이트 체크 (이전 1시간 → 30분)
    setInterval(() => reg.update(), 30 * 60 * 1000);

    // 새 버전 감지 시 즉시 활성화 (skipWaiting 트리거)
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          console.log('🔄 새 버전 감지 - 활성화 신호 전송');
          // 새 SW에게 즉시 활성화 명령
          newWorker.postMessage({ type: 'SKIP_WAITING' });
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

// ★ 앱 캐시 초기화 (버튼 안 먹힐 때 사용)
window.clearAppCache = async function() {
  const ok = confirm(
    '🗑️ 앱 캐시를 초기화합니다.\n\n' +
    '• 저장된 작업 파일은 삭제되지 않아요\n' +
    '• 폴더 권한을 다시 선택해야 해요\n\n' +
    '계속할까요?'
  );
  if (!ok) return;

  try {
    // 1. 서비스워커 캐시 전체 삭제
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }

    // 2. 서비스워커 등록 해제
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }

    // 3. localStorage 앱 설정 유지 (작업 데이터 제외하고 캐시만 삭제)
    // IndexedDB의 임시 캐시는 남겨둠 (작업 데이터 보호)

    alert('✅ 캐시 초기화 완료!\n\n지금 앱을 다시 시작합니다.');
    window.location.reload(true);
  } catch(e) {
    alert('캐시 삭제 실패: ' + e.message + '\n\nAndroid 설정 → 앱 → Chrome → 저장공간 → 캐시 삭제를 해주세요.');
  }
};
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
