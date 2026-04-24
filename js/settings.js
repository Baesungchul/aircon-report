/* ═══════════════════════════════
   설정 모달
═══════════════════════════════ */

// 설정 상태
const FS_SIZES = [
  { label: '아주 작게', value: 13 },
  { label: '작게',     value: 14 },
  { label: '보통',     value: 15 },
  { label: '크게',     value: 16 },
  { label: '더 크게',  value: 17 },
  { label: '아주 크게', value: 18 }
];
const FS_KEY    = 'ac_fs_index_v1';
const THEME_KEY = 'ac_theme_v1';
const LANG_KEY  = 'ac_lang_v1';

function applyTheme(name) {
  const root = document.documentElement;
  if (name === 'dark' || !name) {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', name);
  }
  // active 버튼 표시
  document.querySelectorAll('.theme-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === (name || 'dark'));
  });
  localStorage.setItem(THEME_KEY, name || 'dark');
}

function applyFontSize(idx) {
  idx = Math.max(0, Math.min(FS_SIZES.length - 1, idx));
  const { label, value } = FS_SIZES[idx];
  document.documentElement.style.setProperty('--fs-base', value + 'px');
  const lblEl = document.getElementById('fsLabel');
  if (lblEl) lblEl.textContent = label;
  localStorage.setItem(FS_KEY, String(idx));
  return idx;
}

function loadSettings() {
  // 테마 복원
  const theme = localStorage.getItem(THEME_KEY) || 'dark';
  applyTheme(theme);
  // 폰트 크기 복원 (기본: 보통 = index 2)
  const fsIdx = parseInt(localStorage.getItem(FS_KEY) || '2', 10);
  applyFontSize(fsIdx);
  // 언어 복원
  const lang = localStorage.getItem(LANG_KEY) || 'ko';
  const langSel = document.getElementById('langSelect');
  if (langSel) langSel.value = lang;
}

function openSettings() {
  // 폴더 상태 갱신
  const statusEl = document.getElementById('setFolderStatus');
  const clearBtn = document.getElementById('setClearFolder');
  if (statusEl) {
    if (typeof photoFolderHandle !== 'undefined' && photoFolderHandle) {
      statusEl.textContent = '📁 ' + (photoFolderHandle.name || '폴더 설정됨');
      statusEl.style.color = 'var(--ac2)';
      if (clearBtn) clearBtn.style.display = 'block';
    } else {
      statusEl.textContent = '폴더 미설정';
      statusEl.style.color = 'var(--mu)';
      if (clearBtn) clearBtn.style.display = 'none';
    }
  }
  document.getElementById('settingsModal').classList.add('open');
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('open');
}

function bindSettings() {
  // 열기/닫기
  const btn = document.getElementById('btnSettings');
  if (btn) btn.addEventListener('click', openSettings);
  const closeBtn = document.getElementById('settingsClose');
  if (closeBtn) closeBtn.addEventListener('click', closeSettings);
  const okBtn = document.getElementById('settingsCloseBtn');
  if (okBtn) okBtn.addEventListener('click', closeSettings);

  // 업체정보 편집 (기존 모달 열기)
  const coBtn = document.getElementById('setOpenCoInfo');
  if (coBtn) coBtn.addEventListener('click', () => {
    closeSettings();
    setTimeout(() => { if (typeof openCoModal === 'function') openCoModal(); }, 200);
  });

  // 폴더 관리
  const changeBtn = document.getElementById('setChangeFolder');
  if (changeBtn) changeBtn.addEventListener('click', async () => {
    closeSettings();
    setTimeout(() => { if (typeof selectPhotoFolder === 'function') selectPhotoFolder(); }, 200);
  });
  const clearBtn = document.getElementById('setClearFolder');
  if (clearBtn) clearBtn.addEventListener('click', async () => {
    if (typeof clearPhotoFolder === 'function') {
      await clearPhotoFolder();
      openSettings(); // 상태 갱신
    }
  });

  // 테마 선택
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });

  // 폰트 크기
  let fsIdx = parseInt(localStorage.getItem(FS_KEY) || '2', 10);
  const fsDown = document.getElementById('fsDown');
  const fsUp   = document.getElementById('fsUp');
  if (fsDown) fsDown.addEventListener('click', () => { fsIdx = applyFontSize(fsIdx - 1); });
  if (fsUp)   fsUp.addEventListener('click',   () => { fsIdx = applyFontSize(fsIdx + 1); });

  // 언어 (준비 중)
  const langSel = document.getElementById('langSelect');
  if (langSel) langSel.addEventListener('change', () => {
    localStorage.setItem(LANG_KEY, langSel.value);
    if (langSel.value !== 'ko') {
      showToast('해당 언어는 곧 지원 예정입니다', 'err');
      langSel.value = 'ko';
      localStorage.setItem(LANG_KEY, 'ko');
    }
  });
}
