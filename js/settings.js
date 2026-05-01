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
const REPORT_THEME_KEY = 'ac_report_theme_v1';
const LANG_KEY  = 'ac_lang_v1';

function applyTheme(name) {
  const root = document.documentElement;
  if (name === 'dark' || !name) {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', name);
  }
  // active 버튼 표시 (앱 테마만)
  document.querySelectorAll('[data-theme]').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === (name || 'dark'));
  });
  localStorage.setItem(THEME_KEY, name || 'dark');
}

// 보고서 테마 적용 (저장만, 적용은 보고서 빌드 시)
function applyReportTheme(name) {
  // active 버튼 표시 (보고서 테마만)
  document.querySelectorAll('[data-rtheme]').forEach(b => {
    b.classList.toggle('active', b.dataset.rtheme === (name || 'default'));
  });
  localStorage.setItem(REPORT_THEME_KEY, name || 'default');
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

  // 업체정보 미리보기 갱신
  const coSummary = document.getElementById('setCoSummary');
  if (coSummary) {
    const coName  = document.getElementById('coName')?.value  || '';
    const coBrand = document.getElementById('coBrand')?.value || '';
    const coTel   = document.getElementById('coTel')?.value   || '';
    const coBiz   = document.getElementById('coBiz')?.value   || '';
    const coAddr  = document.getElementById('coAddr')?.value  || '';
    const coEmail = document.getElementById('coEmail')?.value || '';
    const coWeb   = document.getElementById('coWeb')?.value   || '';
    const coDesc  = document.getElementById('coDesc')?.value  || '';

    const lines = [];
    if (coName)  lines.push(`<b style="color:var(--ac);">🏷️ ${escHtml(coName)}</b>` + (coBrand ? ` <span style="color:var(--mu);">· ${escHtml(coBrand)}</span>` : ''));
    if (coTel)   lines.push(`📞 ${escHtml(coTel)}`);
    if (coBiz)   lines.push(`🏢 사업자 ${escHtml(coBiz)}`);
    if (coAddr)  lines.push(`📍 ${escHtml(coAddr)}`);
    if (coEmail) lines.push(`✉️ ${escHtml(coEmail)}`);
    if (coWeb)   lines.push(`🌐 ${escHtml(coWeb)}`);
    if (coDesc)  lines.push(`<span style="color:var(--mu);font-size:11px;">📋 ${escHtml(coDesc.split('\n')[0]).slice(0, 60)}${coDesc.length > 60 ? '...' : ''}</span>`);

    if (lines.length > 0) {
      coSummary.innerHTML = lines.join('<br>');
      coSummary.style.display = 'block';
    } else {
      coSummary.innerHTML = '<span style="color:var(--wn);">⚠️ 업체정보가 입력되지 않았습니다</span>';
      coSummary.style.display = 'block';
    }
  }

  document.getElementById('settingsModal').classList.add('open');
}

// HTML escape (settings.js 내에서 안전하게)
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
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

  // 앱 테마 선택
  document.querySelectorAll('[data-theme]').forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });

  // 보고서 테마 선택
  document.querySelectorAll('[data-rtheme]').forEach(btn => {
    btn.addEventListener('click', () => {
      applyReportTheme(btn.dataset.rtheme);
      if (typeof showToast === 'function') showToast('✓ 보고서 테마 변경됨', 'ok');
    });
  });

  // 저장된 보고서 테마 복원
  const savedReportTheme = localStorage.getItem(REPORT_THEME_KEY) || 'default';
  applyReportTheme(savedReportTheme);

  // 폰트 크기
  let fsIdx = parseInt(localStorage.getItem(FS_KEY) || '2', 10);
  const fsDown = document.getElementById('fsDown');
  const fsUp   = document.getElementById('fsUp');
  if (fsDown) fsDown.addEventListener('click', () => { fsIdx = applyFontSize(fsIdx - 1); });
  if (fsUp)   fsUp.addEventListener('click',   () => { fsIdx = applyFontSize(fsIdx + 1); });

  // 언어 변경
  const langSel = document.getElementById('langSelect');
  if (langSel) langSel.addEventListener('change', () => {
    const newLang = langSel.value;
    if (newLang === 'ja') {
      // 일본어는 아직 준비 중
      showToast('해당 언어는 곧 지원 예정입니다 / Coming soon', 'err');
      langSel.value = localStorage.getItem(LANG_KEY) || 'ko';
      return;
    }
    // 한국어 또는 영어로 즉시 적용
    if (typeof setLanguage === 'function') {
      setLanguage(newLang);
      if (typeof showToast === 'function') {
        showToast(newLang === 'en' ? '✓ Language: English' : '✓ 언어: 한국어', 'ok');
      }
    }
  });
}
