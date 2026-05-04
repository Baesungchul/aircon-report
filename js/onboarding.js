/* ═══════════════════════════════════════════════
   온보딩 (첫 실행 시 기본 세팅 안내)
═══════════════════════════════════════════════ */

const ONBOARDING_DONE_KEY = 'ac_onboarding_done_v1';
const TOTAL_STEPS = 5;
let _obStep = 1;
let _obData = {
  industryMajor: '',
  industryMinor: '',
  reportTitle: '',
  unitLabel: '',
  stageLabel: '',
  coName: '',
  coTel: '',
  coIcon: '',
  folderSet: false
};

// ════════════════════════════════════════
// 온보딩이 필요한지 확인 + 시작
// ════════════════════════════════════════
function checkAndStartOnboarding() {
  // 이미 완료했으면 스킵
  if (localStorage.getItem(ONBOARDING_DONE_KEY) === '1') return;

  // 업체정보가 이미 있으면 (기존 사용자) 스킵
  try {
    const ci = JSON.parse(localStorage.getItem(CO_KEY) || '{}');
    if (ci.coName && ci.coName.trim()) {
      // 기존 사용자 - 온보딩 표시 안 함
      localStorage.setItem(ONBOARDING_DONE_KEY, '1');
      return;
    }
  } catch(e) {}

  // 첫 사용자 - 온보딩 시작 (페이지 로드 후 약간 지연)
  setTimeout(() => startOnboarding(), 500);
}

function startOnboarding() {
  _obStep = 1;
  _obData = {
    industryMajor: '',
    industryMinor: '',
    reportTitle: '',
    unitLabel: '',
    stageLabel: '',
    coName: '',
    coTel: '',
    coIcon: '',
    folderSet: false
  };
  document.getElementById('onboardingModal').classList.add('open');
  renderOnboardingStep();
}

function closeOnboarding(completed) {
  document.getElementById('onboardingModal').classList.remove('open');
  if (completed) {
    localStorage.setItem(ONBOARDING_DONE_KEY, '1');
  }
}

// ════════════════════════════════════════
// 단계별 콘텐츠 렌더
// ════════════════════════════════════════
function renderOnboardingStep() {
  const content = document.getElementById('obContent');
  const counter = document.getElementById('obStepCounter');
  const progressBar = document.getElementById('obProgressBar');
  const prevBtn = document.getElementById('obPrev');
  const nextBtn = document.getElementById('obNext');

  counter.textContent = `${_obStep} / ${TOTAL_STEPS}`;
  progressBar.style.width = `${(_obStep / TOTAL_STEPS) * 100}%`;
  prevBtn.style.display = _obStep > 1 ? 'inline-flex' : 'none';

  if (_obStep === TOTAL_STEPS) {
    nextBtn.textContent = '✓ 시작하기';
    nextBtn.className = 'btn b-green';
  } else {
    nextBtn.textContent = '다음 →';
    nextBtn.className = 'btn b-blue';
  }

  // 단계별 화면
  switch (_obStep) {
    case 1: renderStep1Welcome(content); break;
    case 2: renderStep2Industry(content); break;
    case 3: renderStep3Company(content); break;
    case 4: renderStep4Folder(content); break;
    case 5: renderStep5Done(content); break;
  }
}

// 1단계: 환영
function renderStep1Welcome(c) {
  c.innerHTML = `
    <div class="ob-step ob-welcome">
      <div class="ob-icon-big">📋</div>
      <h2 class="ob-title">작업 보고서 생성기</h2>
      <p class="ob-subtitle">현장 사진과 작업 내역을 깔끔한 보고서로</p>

      <div class="ob-features">
        <div class="ob-feature">
          <div class="ob-feature-ic">📸</div>
          <div>
            <div class="ob-feature-name">사진 자동 정리</div>
            <div class="ob-feature-desc">작업 전/후 사진을 한 번에</div>
          </div>
        </div>
        <div class="ob-feature">
          <div class="ob-feature-ic">📄</div>
          <div>
            <div class="ob-feature-name">PDF 즉시 생성</div>
            <div class="ob-feature-desc">전문적인 보고서 출력</div>
          </div>
        </div>
        <div class="ob-feature">
          <div class="ob-feature-ic">👥</div>
          <div>
            <div class="ob-feature-name">고객 자동 관리</div>
            <div class="ob-feature-desc">전화번호로 재의뢰 추적</div>
          </div>
        </div>
        <div class="ob-feature">
          <div class="ob-feature-ic">💾</div>
          <div>
            <div class="ob-feature-name">자동 저장</div>
            <div class="ob-feature-desc">선택한 폴더에 자동 백업</div>
          </div>
        </div>
      </div>

      <p class="ob-hint">간단한 5단계로 설정해드릴게요. 1분이면 됩니다!</p>
    </div>
  `;
}

// 2단계: 업종 선택 (가장 중요)
function renderStep2Industry(c) {
  c.innerHTML = `
    <div class="ob-step">
      <h2 class="ob-title">어떤 업종이세요?</h2>
      <p class="ob-subtitle">업종에 맞춰 보고서를 자동 세팅합니다</p>

      <div class="ob-form">
        <div class="ob-field">
          <label>대분류</label>
          <select class="ob-input" id="obMajor">
            <option value="">선택하세요</option>
          </select>
        </div>

        <div class="ob-field">
          <label>소분류</label>
          <select class="ob-input" id="obMinor" disabled>
            <option value="">먼저 대분류를 선택하세요</option>
          </select>
        </div>

        <div id="obIndustryPreview" style="display:none;background:rgba(77,208,225,.1);border:1px solid rgba(77,208,225,.3);border-radius:10px;padding:12px;margin-top:10px;">
          <div style="font-size:12px;color:var(--ac);font-weight:700;margin-bottom:6px;">✨ 자동 설정될 항목</div>
          <div style="font-size:13px;line-height:1.7;">
            <div>📄 보고서 제목: <b id="obPreviewTitle">-</b></div>
            <div>🏷️ 현장 호칭: <b id="obPreviewUnit">-</b></div>
            <div>🔧 작업 단계: <b id="obPreviewStage">-</b></div>
          </div>
        </div>

        <p class="ob-hint" style="margin-top:14px;">
          나중에 설정에서 자유롭게 수정할 수 있어요
        </p>
      </div>
    </div>
  `;

  // 대분류 채우기
  const majorSel = document.getElementById('obMajor');
  if (typeof INDUSTRIES !== 'undefined') {
    INDUSTRIES.forEach(major => {
      const opt = document.createElement('option');
      opt.value = major.id;
      opt.textContent = major.label;
      majorSel.appendChild(opt);
    });
  }

  // 저장된 값 복원
  if (_obData.industryMajor) {
    majorSel.value = _obData.industryMajor;
    updateOnboardingMinor(_obData.industryMajor, _obData.industryMinor);
  }

  // 이벤트
  majorSel.addEventListener('change', () => {
    _obData.industryMajor = majorSel.value;
    _obData.industryMinor = '';
    updateOnboardingMinor(majorSel.value, '');
  });

  document.getElementById('obMinor').addEventListener('change', e => {
    _obData.industryMinor = e.target.value;
    const item = findIndustryItem(_obData.industryMajor, e.target.value);
    if (item) {
      _obData.reportTitle = item.title;
      _obData.unitLabel = item.unit;
      _obData.stageLabel = item.stage;
      // 미리보기 표시
      document.getElementById('obIndustryPreview').style.display = 'block';
      document.getElementById('obPreviewTitle').textContent = item.title;
      document.getElementById('obPreviewUnit').textContent = item.unit;
      document.getElementById('obPreviewStage').textContent = item.stage;
    } else {
      document.getElementById('obIndustryPreview').style.display = 'none';
    }
  });
}

function updateOnboardingMinor(majorId, currentMinorId) {
  const minorSel = document.getElementById('obMinor');
  if (!minorSel) return;
  minorSel.innerHTML = '';

  if (!majorId) {
    minorSel.innerHTML = '<option value="">먼저 대분류를 선택하세요</option>';
    minorSel.disabled = true;
    return;
  }

  const major = INDUSTRIES.find(i => i.id === majorId);
  if (!major || major.items.length === 0) {
    minorSel.innerHTML = '<option value="">(직접 입력)</option>';
    minorSel.disabled = false;
    return;
  }

  minorSel.disabled = false;
  minorSel.innerHTML = '<option value="">소분류 선택</option>';
  major.items.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = item.label;
    minorSel.appendChild(opt);
  });

  if (currentMinorId) {
    minorSel.value = currentMinorId;
    minorSel.dispatchEvent(new Event('change'));
  }
}

// 3단계: 업체 정보
function renderStep3Company(c) {
  c.innerHTML = `
    <div class="ob-step">
      <h2 class="ob-title">업체 정보</h2>
      <p class="ob-subtitle">보고서 표지에 표시됩니다</p>

      <div class="ob-form">
        <div class="ob-field">
          <label>업체 아이콘</label>
          <div class="ob-icon-picker">
            <button class="ob-icon-opt" data-ic="❄️">❄️</button>
            <button class="ob-icon-opt" data-ic="🔧">🔧</button>
            <button class="ob-icon-opt" data-ic="🏠">🏠</button>
            <button class="ob-icon-opt" data-ic="🚗">🚗</button>
            <button class="ob-icon-opt" data-ic="🧼">🧼</button>
            <button class="ob-icon-opt" data-ic="🎨">🎨</button>
            <button class="ob-icon-opt" data-ic="⚡">⚡</button>
            <button class="ob-icon-opt" data-ic="🛠️">🛠️</button>
          </div>
        </div>

        <div class="ob-field">
          <label>업체명 <span style="color:var(--dn);">*</span></label>
          <input class="ob-input" id="obCoName" type="text" placeholder="예: 평택에어컨1004" value="${_obData.coName || ''}">
        </div>

        <div class="ob-field">
          <label>대표 연락처</label>
          <input class="ob-input" id="obCoTel" type="text" inputmode="tel" placeholder="010-1234-5678" value="${_obData.coTel || ''}">
        </div>

        <p class="ob-hint">나머지 정보(주소/이메일/소개 등)는 나중에 설정에서 추가할 수 있어요</p>
      </div>
    </div>
  `;

  // 아이콘 선택 (기존 선택 표시)
  document.querySelectorAll('.ob-icon-opt').forEach(btn => {
    if (btn.dataset.ic === _obData.coIcon) btn.classList.add('selected');
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ob-icon-opt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      _obData.coIcon = btn.dataset.ic;
    });
  });

  // 입력 저장
  document.getElementById('obCoName').addEventListener('input', e => {
    _obData.coName = e.target.value;
  });

  document.getElementById('obCoTel').addEventListener('input', e => {
    // 자동 하이픈
    const raw = e.target.value.replace(/[^\d]/g, '');
    let formatted = e.target.value;
    if (raw.length === 11 && raw.startsWith('010')) formatted = `${raw.slice(0,3)}-${raw.slice(3,7)}-${raw.slice(7)}`;
    else if (raw.length === 10 && raw.startsWith('02')) formatted = `${raw.slice(0,2)}-${raw.slice(2,6)}-${raw.slice(6)}`;
    else if (raw.length === 11) formatted = `${raw.slice(0,3)}-${raw.slice(3,7)}-${raw.slice(7)}`;
    else if (raw.length === 10) formatted = `${raw.slice(0,3)}-${raw.slice(3,6)}-${raw.slice(6)}`;
    if (formatted !== e.target.value) {
      e.target.value = formatted;
    }
    _obData.coTel = e.target.value;
  });
}

// 4단계: 저장 폴더 (선택)
function renderStep4Folder(c) {
  const hasFolder = (typeof photoFolderHandle !== 'undefined' && photoFolderHandle);

  c.innerHTML = `
    <div class="ob-step">
      <h2 class="ob-title">저장 폴더 설정 <span style="color:var(--mu);font-size:14px;font-weight:400;">(선택)</span></h2>
      <p class="ob-subtitle">사진과 데이터를 자동 저장할 폴더를 선택하세요</p>

      <div class="ob-form">
        <div style="background:var(--sf2);border:1px solid var(--bd);border-radius:10px;padding:14px;margin-bottom:14px;">
          <div style="font-size:13px;font-weight:700;margin-bottom:6px;">💾 폴더 설정 시 자동으로:</div>
          <ul style="font-size:13px;line-height:1.8;color:var(--tx);margin:0;padding-left:20px;">
            <li>호수별로 작업 사진 폴더 생성</li>
            <li>고객 정보를 customers.xlsx로 저장</li>
            <li>PDF/JPG 보고서를 같은 폴더에 저장</li>
            <li>폰 바꿔도 폴더 옮기면 데이터 유지</li>
          </ul>
        </div>

        <button class="btn b-blue" id="obSelectFolder" style="width:100%;justify-content:center;padding:12px;">
          ${hasFolder ? `✅ 설정됨: ${escHtml(photoFolderHandle.name)}` : '📁 폴더 선택하기'}
        </button>

        <p class="ob-hint" style="margin-top:14px;">
          지금 설정하지 않아도 됩니다. 나중에 설정 → 저장 폴더에서 가능
        </p>

        ${!('showDirectoryPicker' in window) ? `
          <div style="background:rgba(240,180,41,.1);border:1px solid rgba(240,180,41,.3);border-radius:8px;padding:10px;margin-top:14px;font-size:12px;color:var(--wn);">
            ⚠️ 이 브라우저는 폴더 선택을 지원하지 않습니다.<br>
            크롬(안드로이드/PC)에서 사용하시면 폴더 자동저장이 가능합니다.
          </div>
        ` : ''}
      </div>
    </div>
  `;

  const btn = document.getElementById('obSelectFolder');
  if (btn && 'showDirectoryPicker' in window) {
    btn.addEventListener('click', async () => {
      try {
        if (typeof selectPhotoFolder === 'function') {
          await selectPhotoFolder();
          _obData.folderSet = !!photoFolderHandle;
          // 버튼 텍스트 갱신
          if (photoFolderHandle) {
            btn.innerHTML = `✅ 설정됨: ${escHtml(photoFolderHandle.name)}`;
            btn.className = 'btn b-green';
          }
        }
      } catch(e) { console.warn('폴더 선택 실패:', e); }
    });
  }
}

// 5단계: 완료
function renderStep5Done(c) {
  const summary = [];
  if (_obData.industryMinor) {
    const item = findIndustryItem(_obData.industryMajor, _obData.industryMinor);
    if (item) summary.push(`✅ 업종: <b>${item.label}</b>`);
  }
  if (_obData.coName) summary.push(`✅ 업체명: <b>${escHtml(_obData.coName)}</b>`);
  if (_obData.coTel)  summary.push(`✅ 연락처: <b>${escHtml(_obData.coTel)}</b>`);
  if (_obData.folderSet) summary.push(`✅ 저장 폴더: <b>설정됨</b>`);

  c.innerHTML = `
    <div class="ob-step ob-done">
      <div class="ob-icon-big" style="animation:obBounce .6s ease;">🎉</div>
      <h2 class="ob-title">준비 완료!</h2>
      <p class="ob-subtitle">설정한 내용으로 시작합니다</p>

      ${summary.length > 0 ? `
        <div style="background:rgba(0,201,167,.1);border:1px solid rgba(0,201,167,.3);border-radius:10px;padding:14px;text-align:left;margin:20px 0;">
          ${summary.map(s => `<div style="font-size:13px;line-height:1.8;">${s}</div>`).join('')}
        </div>
      ` : ''}

      <div style="background:var(--sf2);border-radius:10px;padding:14px;margin-top:10px;">
        <div style="font-size:13px;font-weight:700;margin-bottom:8px;">🚀 시작하는 방법</div>
        <ol style="font-size:13px;line-height:1.7;color:var(--tx);margin:0;padding-left:20px;">
          <li>"+추가" 버튼으로 첫 호수 입력</li>
          <li>호수 카드 펼쳐서 사진 추가</li>
          <li>📄 미리보기 → PDF/JPG로 보고서 생성</li>
        </ol>
      </div>
    </div>
  `;
}

// HTML escape
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// ════════════════════════════════════════
// 다음/이전 버튼 처리
// ════════════════════════════════════════
function onboardingNext() {
  // 단계 검증
  if (_obStep === 3) {
    if (!_obData.coName || !_obData.coName.trim()) {
      showToast('업체명을 입력해주세요', 'err');
      return;
    }
  }

  if (_obStep < TOTAL_STEPS) {
    _obStep++;
    renderOnboardingStep();
  } else {
    finishOnboarding();
  }
}

function onboardingPrev() {
  if (_obStep > 1) {
    _obStep--;
    renderOnboardingStep();
  }
}

// ════════════════════════════════════════
// 완료 시 - 모든 설정 적용
// ════════════════════════════════════════
async function finishOnboarding() {
  try {
    // 1. 업체정보 저장
    const ci = JSON.parse(localStorage.getItem(CO_KEY) || '{}');
    if (_obData.coName) ci.coName = _obData.coName;
    if (_obData.coTel)  ci.coTel  = _obData.coTel;
    if (_obData.reportTitle) ci.coReportTitle = _obData.reportTitle;
    if (_obData.unitLabel)   ci.coUnitLabel   = _obData.unitLabel;
    if (_obData.stageLabel)  ci.coStageLabel  = _obData.stageLabel;
    if (_obData.industryMajor) ci.coIndustryMajor = _obData.industryMajor;
    if (_obData.industryMinor) ci.coIndustryMinor = _obData.industryMinor;
    localStorage.setItem(CO_KEY, JSON.stringify(ci));

    // 2. 업체 아이콘 저장
    if (_obData.coIcon) {
      coIconData = _obData.coIcon;
      localStorage.setItem(CO_ICON_KEY, _obData.coIcon);
    }

    // 3. 폼에 값 채우기 (다음에 설정 모달 열 때 보이도록)
    CO_FIELDS.forEach(id => {
      const el = document.getElementById(id);
      if (el && ci[id]) el.value = ci[id];
    });

    // 4. 메인 화면 라벨 적용
    if (typeof applyCustomLabels === 'function') applyCustomLabels();

    // 5. 아이콘 적용
    if (typeof applyCoIcon === 'function') applyCoIcon();

    // 6. 헤더 버튼 갱신
    if (typeof updateCoHdrBtn === 'function') updateCoHdrBtn();

    closeOnboarding(true);
    showToast('🎉 설정 완료! 시작해볼까요?', 'ok');
  } catch(e) {
    console.error('온보딩 완료 처리 실패:', e);
    closeOnboarding(true);
  }
}

// ════════════════════════════════════════
// 이벤트 바인딩
// ════════════════════════════════════════
function bindOnboardingEvents() {
  document.getElementById('obNext')?.addEventListener('click', onboardingNext);
  document.getElementById('obPrev')?.addEventListener('click', onboardingPrev);
  document.getElementById('obSkip')?.addEventListener('click', () => {
    if (confirm('설정을 건너뛰시겠습니까?\n\n나중에 설정 메뉴에서 다시 할 수 있습니다.')) {
      closeOnboarding(true);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    bindOnboardingEvents();
    checkAndStartOnboarding();
  });
} else {
  bindOnboardingEvents();
  checkAndStartOnboarding();
}

// 설정에서 "초기 설정 다시 하기" 버튼
document.addEventListener('DOMContentLoaded', () => {
  const replayBtn = document.getElementById('setReplayOnboarding');
  if (replayBtn) {
    replayBtn.addEventListener('click', () => {
      // 설정 모달 닫기
      document.getElementById('settingsModal')?.classList.remove('open');
      // 기존 데이터 미리 로드 (수정만)
      try {
        const ci = JSON.parse(localStorage.getItem(CO_KEY) || '{}');
        _obData.industryMajor = ci.coIndustryMajor || '';
        _obData.industryMinor = ci.coIndustryMinor || '';
        _obData.reportTitle = ci.coReportTitle || '';
        _obData.unitLabel = ci.coUnitLabel || '';
        _obData.stageLabel = ci.coStageLabel || '';
        _obData.coName = ci.coName || '';
        _obData.coTel = ci.coTel || '';
        _obData.coIcon = localStorage.getItem(CO_ICON_KEY) || '';
        _obData.folderSet = !!photoFolderHandle;
      } catch(e) {}

      _obStep = 1;
      document.getElementById('onboardingModal').classList.add('open');
      renderOnboardingStep();
    });
  }
});
