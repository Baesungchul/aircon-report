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

// ═══════════════════════════════════════════════
// 저장소 상태 진단 - 폴더가 풀리는 원인 추적용
// ═══════════════════════════════════════════════
window.showStorageDiagnostics = async function() {
  const lines = ['📊 저장소 상태 진단', '═══════════════════', ''];

  // 1) PWA 모드 여부
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                    || window.navigator.standalone === true;
  lines.push(`📱 PWA 모드: ${isStandalone ? '✅ 예 (standalone)' : '❌ 아니오 (브라우저 탭)'}`);

  // 2) 영구 저장 권한
  let persisted = '확인 불가';
  if (navigator.storage && navigator.storage.persisted) {
    try {
      persisted = await navigator.storage.persisted() ? '✅ 허용됨' : '⚠️ 거부됨';
    } catch(e) { persisted = 'API 오류: ' + e.message; }
  }
  lines.push(`🔒 영구 저장: ${persisted}`);

  // 3) 저장소 용량
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      const usedMB = (est.usage / 1024 / 1024).toFixed(1);
      const quotaMB = (est.quota / 1024 / 1024).toFixed(0);
      const pct = ((est.usage / est.quota) * 100).toFixed(1);
      lines.push(`💾 사용량: ${usedMB} MB / ${quotaMB} MB (${pct}%)`);
    } catch(e) {}
  }

  // 4) 현재 폴더 핸들
  lines.push('');
  lines.push('━━━ 저장 폴더 상태 ━━━');
  if (typeof photoFolderHandle !== 'undefined' && photoFolderHandle) {
    lines.push(`📁 현재 폴더: ${photoFolderHandle.name}`);
    try {
      const perm = await photoFolderHandle.queryPermission({ mode: 'readwrite' });
      lines.push(`   권한: ${perm === 'granted' ? '✅' : '⚠️'} ${perm}`);
    } catch(e) {}
  } else {
    lines.push('📁 현재 폴더: ❌ 없음');
  }

  // 5) IndexedDB에 핸들 있는지 직접 확인
  try {
    const dbHandle = await settingsGet('photoFolderHandle');
    if (dbHandle) {
      lines.push(`💿 IndexedDB 저장: ✅ "${dbHandle.name}"`);
    } else {
      lines.push(`💿 IndexedDB 저장: ❌ 없음`);
    }
  } catch(e) {
    lines.push(`💿 IndexedDB 저장: 오류 - ${e.message}`);
  }

  // 6) 마지막 손실 기록
  lines.push('');
  lines.push('━━━ 진단 이력 ━━━');
  const lastName = localStorage.getItem('lastFolderName');
  if (lastName) lines.push(`🔖 마지막 폴더명 (메모): ${lastName}`);
  const lostAt = localStorage.getItem('folderLostAt');
  if (lostAt) lines.push(`🔴 마지막 손실 시각: ${lostAt}`);
  const failedAt = localStorage.getItem('saveFolderFailedAt');
  if (failedAt) {
    const failedName = localStorage.getItem('saveFolderFailedName');
    lines.push(`🔴 마지막 저장 실패: ${failedAt}`);
    if (failedName) lines.push(`   폴더명: ${failedName}`);
  }

  // 7) Chrome 버전
  lines.push('');
  lines.push('━━━ 환경 ━━━');
  lines.push(`🌐 UA: ${navigator.userAgent.substring(0, 100)}...`);

  // 8) 가이드
  lines.push('');
  lines.push('━━━ 진단 가이드 ━━━');
  if (!isStandalone) {
    lines.push('⚠️ PWA로 설치 안 됨 → 폴더 풀림 위험 높음');
    lines.push('  → 설정 → 홈 화면에 앱 설치');
  }
  if (persisted.includes('거부')) {
    lines.push('⚠️ 영구 저장 거부됨 → 안드로이드가 데이터 정리할 수 있음');
    lines.push('  → 폴더 다시 설정하면 재요청 됨');
  }

  const text = lines.join('\n');
  console.log(text);

  // 화면에 alert로 보여주기 (모바일에서 콘솔 보기 어려움)
  if (confirm(text + '\n\n클립보드에 복사할까요?')) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('✅ 진단 정보 복사됨', 'ok');
    } catch(e) {
      showToast('복사 실패 - 직접 메모해주세요', 'err');
    }
  }
};
