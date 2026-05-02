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

// 보고서 테마와 매칭되는 통합 테마 목록 (6개)
const APP_THEMES = [
  { id: 'dark',    label: '기본 (다크 블루)', gradient: 'linear-gradient(135deg,#0d0f18,#3d8ef0)' },
  { id: 'bright',  label: '밝은',             gradient: 'linear-gradient(135deg,#26201a,#fbbf24)' },
  { id: 'darkpurple', label: '어두운',        gradient: 'linear-gradient(135deg,#18181b,#a78bfa)' },
  { id: 'cool',    label: '시원한',           gradient: 'linear-gradient(135deg,#0c2c44,#22d3ee)' },
  { id: 'clean',   label: '깔끔한',           gradient: 'linear-gradient(135deg,#fafbfc,#2563eb)' },
  { id: 'premium', label: '세련된',           gradient: 'linear-gradient(135deg,#18181b,#d4af37)' },
];

const REPORT_THEMES = [
  { id: 'default', label: '기본',   gradient: 'linear-gradient(135deg,#0a1628,#4dd0e1)' },
  { id: 'bright',  label: '밝은',   gradient: 'linear-gradient(135deg,#fef3c7,#fbbf24)' },
  { id: 'dark',    label: '어두운', gradient: 'linear-gradient(135deg,#1a1a1a,#a78bfa)' },
  { id: 'cool',    label: '시원한', gradient: 'linear-gradient(135deg,#0c4a6e,#22d3ee)' },
  { id: 'clean',   label: '깔끔한', gradient: 'linear-gradient(135deg,#fafbfc,#2563eb)' },
  { id: 'premium', label: '세련된', gradient: 'linear-gradient(135deg,#18181b,#d4af37)' },
];

function applyTheme(name) {
  const root = document.documentElement;
  if (name === 'dark' || !name) {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', name);
  }
  localStorage.setItem(THEME_KEY, name || 'dark');
  // 라벨 업데이트
  updateThemeLabels();
}

function applyReportTheme(name) {
  localStorage.setItem(REPORT_THEME_KEY, name || 'default');
  updateThemeLabels();
}

function updateThemeLabels() {
  const curApp = localStorage.getItem(THEME_KEY) || 'dark';
  const curReport = localStorage.getItem(REPORT_THEME_KEY) || 'default';
  const appTheme = APP_THEMES.find(t => t.id === curApp);
  const reportTheme = REPORT_THEMES.find(t => t.id === curReport);
  const appLabel = document.getElementById('curAppThemeLabel');
  const reportLabel = document.getElementById('curReportThemeLabel');
  if (appLabel && appTheme) appLabel.textContent = appTheme.label;
  if (reportLabel && reportTheme) reportLabel.textContent = reportTheme.label;
}

function openThemePicker(type) {
  console.log('🎨 테마 팝업 열기:', type);
  // type: 'app' or 'report'
  const themes = type === 'app' ? APP_THEMES : REPORT_THEMES;
  const curKey = type === 'app' ? THEME_KEY : REPORT_THEME_KEY;
  const curId = localStorage.getItem(curKey) || (type === 'app' ? 'dark' : 'default');

  document.getElementById('themePickerTitle').textContent =
    type === 'app' ? '🎨 앱 테마 선택' : '📄 보고서 테마 선택';

  const body = document.getElementById('themePickerBody');
  body.innerHTML = `
    <div class="theme-picker-grid">
      ${themes.map(t => `
        <button class="theme-pick-item ${t.id === curId ? 'active' : ''}" data-tid="${t.id}" data-ttype="${type}">
          <div class="theme-pick-prev" style="background:${t.gradient};"></div>
          <div class="theme-pick-lbl">${t.label}</div>
        </button>
      `).join('')}
    </div>
  `;

  // 클릭 이벤트
  body.querySelectorAll('.theme-pick-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const tid = btn.dataset.tid;
      const ttype = btn.dataset.ttype;
      if (ttype === 'app') {
        applyTheme(tid);
        if (typeof showToast === 'function') showToast('✓ 앱 테마 변경됨', 'ok');
      } else {
        applyReportTheme(tid);
        if (typeof showToast === 'function') showToast('✓ 보고서 테마 변경됨', 'ok');
      }
      closeThemePicker();
    });
  });

  document.getElementById('themePickerModal').classList.add('open');
}

function closeThemePicker() {
  document.getElementById('themePickerModal').classList.remove('open');
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

  // 고객 통계 갱신
  if (typeof updateCustomerSummary === 'function') updateCustomerSummary();

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

  // 앱 테마 선택 - 팝업 열기
  const btnPickApp = document.getElementById('btnPickAppTheme');
  if (btnPickApp) btnPickApp.addEventListener('click', () => openThemePicker('app'));

  // 보고서 테마 선택 - 팝업 열기
  const btnPickReport = document.getElementById('btnPickReportTheme');
  if (btnPickReport) btnPickReport.addEventListener('click', () => openThemePicker('report'));

  // 테마 팝업 닫기
  const themePickerClose = document.getElementById('themePickerClose');
  if (themePickerClose) themePickerClose.addEventListener('click', closeThemePicker);

  // 라벨 초기화
  updateThemeLabels();

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

// 전화번호 자동 하이픈
function autoFormatPhone(input) {
  if (!input) return;
  input.addEventListener('input', () => {
    let v = input.value.replace(/[^\d]/g, '');
    let formatted = '';
    // 010-XXXX-XXXX 또는 02-XXX(X)-XXXX 등
    if (v.startsWith('02')) {
      // 서울 02
      if (v.length <= 2) formatted = v;
      else if (v.length <= 5) formatted = v.slice(0,2) + '-' + v.slice(2);
      else if (v.length <= 9) formatted = v.slice(0,2) + '-' + v.slice(2,5) + '-' + v.slice(5);
      else formatted = v.slice(0,2) + '-' + v.slice(2,6) + '-' + v.slice(6,10);
    } else if (v.length <= 3) {
      formatted = v;
    } else if (v.length <= 7) {
      formatted = v.slice(0,3) + '-' + v.slice(3);
    } else if (v.length <= 11) {
      formatted = v.slice(0,3) + '-' + v.slice(3,7) + '-' + v.slice(7);
    } else {
      formatted = v.slice(0,3) + '-' + v.slice(3,7) + '-' + v.slice(7,11);
    }
    input.value = formatted;
  });
}

// 사업자번호 자동 하이픈 (000-00-00000)
function autoFormatBiz(input) {
  if (!input) return;
  input.addEventListener('input', () => {
    let v = input.value.replace(/[^\d]/g, '');
    let formatted = '';
    if (v.length <= 3) formatted = v;
    else if (v.length <= 5) formatted = v.slice(0,3) + '-' + v.slice(3);
    else formatted = v.slice(0,3) + '-' + v.slice(3,5) + '-' + v.slice(5,10);
    input.value = formatted;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  autoFormatPhone(document.getElementById('coTel'));
  autoFormatBiz(document.getElementById('coBiz'));
});
