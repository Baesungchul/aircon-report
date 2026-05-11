/* ═══════════════════════════════════════════════
   온보딩 (첫 실행 시 기본 세팅 안내)
═══════════════════════════════════════════════ */

const ONBOARDING_DONE_KEY = 'ac_onboarding_done_v1';
const TOTAL_STEPS = 3;
let _obStep = 1;

let _obData = {
  coName: '', coTel: '', coIcon: '❄️',
  folderSet: false,
};

function showOnboarding() {
  _obStep = 1;
  _obData = { coName: '', coTel: '', coIcon: '❄️', folderSet: false };
  renderOnboardingStep();
  document.getElementById('onboardingModal').classList.add('open');
}

function hideOnboarding() {
  document.getElementById('onboardingModal').classList.remove('open');
}

function renderOnboardingStep() {
  const content     = document.getElementById('obContent');
  const counter     = document.getElementById('obStepCounter');
  const progressBar = document.getElementById('obProgressBar');  // HTML ID와 일치
  const prevBtn     = document.getElementById('obPrev');
  const nextBtn     = document.getElementById('obNext');

  if (!content) return;

  counter.textContent = `${_obStep} / ${TOTAL_STEPS}`;
  progressBar.style.width = `${(_obStep / TOTAL_STEPS) * 100}%`;
  prevBtn.style.display = _obStep > 1 ? 'inline-flex' : 'none';

  if (_obStep === TOTAL_STEPS) {
    nextBtn.textContent = '시작하기 🚀';
    nextBtn.className = 'btn b-green';
  } else {
    nextBtn.textContent = '다음 →';
    nextBtn.className = 'btn b-blue';
  }

  switch (_obStep) {
    case 1: renderStep1Intro(content); break;
    case 2: renderStep2HowTo(content); break;
    case 3: renderStep3Setup(content); break;
  }
}

// ─── 1단계: 소개 ───────────────────────────────────
function renderStep1Intro(c) {
  c.innerHTML = `
    <div class="ob-step ob-welcome">
      <div class="ob-icon-big">❄️</div>
      <h2 class="ob-title">에어컨 작업 보고서</h2>
      <p class="ob-subtitle">현장 사진 + 작업 내역을 전문 보고서로<br>고객 관리까지 한번에</p>

      <div class="ob-features">
        <div class="ob-feature">
          <div class="ob-feature-ic">📸</div>
          <div>
            <div class="ob-feature-name">작업 전·후 사진 정리</div>
            <div class="ob-feature-desc">호수별로 깔끔하게 분류</div>
          </div>
        </div>
        <div class="ob-feature">
          <div class="ob-feature-ic">📄</div>
          <div>
            <div class="ob-feature-name">PDF · JPG 보고서</div>
            <div class="ob-feature-desc">전문적인 보고서 즉시 출력</div>
          </div>
        </div>
        <div class="ob-feature">
          <div class="ob-feature-ic">👥</div>
          <div>
            <div class="ob-feature-name">고객 자동 관리</div>
            <div class="ob-feature-desc">전화번호로 방문 이력 추적</div>
          </div>
        </div>
        <div class="ob-feature">
          <div class="ob-feature-ic">💾</div>
          <div>
            <div class="ob-feature-name">자동 저장 · 백업</div>
            <div class="ob-feature-desc">내 폴더에 사진·데이터 보관</div>
          </div>
        </div>
        <div class="ob-feature">
          <div class="ob-feature-ic">🏢</div>
          <div>
            <div class="ob-feature-name">가정용 · 공용시설</div>
            <div class="ob-feature-desc">작업 유형별 최적화</div>
          </div>
        </div>
        <div class="ob-feature">
          <div class="ob-feature-ic">⚠️</div>
          <div>
            <div class="ob-feature-name">특이사항 보고서</div>
            <div class="ob-feature-desc">사진 + 메모 별도 페이지</div>
          </div>
        </div>
      </div>

      <p class="ob-hint">3단계로 빠르게 시작해요 👉</p>
    </div>`;
}

// ─── 2단계: 사용법 ─────────────────────────────────
function renderStep2HowTo(c) {
  c.innerHTML = `
    <div class="ob-step">
      <h2 class="ob-title">이렇게 사용하세요</h2>
      <p class="ob-subtitle">4단계로 보고서 완성</p>

      <div class="ob-howto-list">
        <div class="ob-howto-item">
          <div class="ob-howto-num">1</div>
          <div class="ob-howto-body">
            <div class="ob-howto-title">호수 추가</div>
            <div class="ob-howto-desc">
              작업명(아파트명)과 날짜 입력 후<br>
              <b>➕ 추가</b>로 호수를 입력해요.<br>
              <span class="ob-tip">💡 일괄 추가로 여러 호수를 한번에!</span>
            </div>
          </div>
        </div>

        <div class="ob-howto-arrow">↓</div>

        <div class="ob-howto-item">
          <div class="ob-howto-num">2</div>
          <div class="ob-howto-body">
            <div class="ob-howto-title">사진 추가</div>
            <div class="ob-howto-desc">
              호수 카드를 펼쳐<br>
              <b>📷 카메라</b> 또는 <b>🖼 갤러리</b>로<br>
              작업 전·후 사진을 넣어요.<br>
              <span class="ob-tip">💡 특이사항도 사진+메모로 기록!</span>
            </div>
          </div>
        </div>

        <div class="ob-howto-arrow">↓</div>

        <div class="ob-howto-item">
          <div class="ob-howto-num">3</div>
          <div class="ob-howto-body">
            <div class="ob-howto-title">저장</div>
            <div class="ob-howto-desc">
              <b>💾 저장</b> 버튼으로 폴더에 저장.<br>
              고객 전화번호 입력 시<br>재의뢰 이력이 자동 관리돼요.<br>
              <span class="ob-tip">💡 새작업 누르면 이전 작업 자동 저장!</span>
            </div>
          </div>
        </div>

        <div class="ob-howto-arrow">↓</div>

        <div class="ob-howto-item">
          <div class="ob-howto-num">4</div>
          <div class="ob-howto-body">
            <div class="ob-howto-title">보고서 출력</div>
            <div class="ob-howto-desc">
              <b>📄 미리보기</b> 확인 후<br>
              <b>⬇️ PDF</b> 또는 <b>🖼️ JPG</b>로 저장·공유.<br>
              <span class="ob-tip">💡 작업 기록(📋)에서 과거 작업 불러오기!</span>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

// ─── 3단계: 세팅 ───────────────────────────────────
function renderStep3Setup(c) {
  const hasFolder = (typeof photoFolderHandle !== 'undefined' && photoFolderHandle);

  c.innerHTML = `
    <div class="ob-step">
      <h2 class="ob-title">기본 설정</h2>
      <p class="ob-subtitle">보고서에 표시될 업체 정보를 입력해요</p>

      <div class="ob-form">
        <div class="ob-field">
          <label>업체 아이콘</label>
          <div class="ob-icon-grid">
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
          <input class="ob-input" id="obCoName" type="text"
            placeholder="예: 평택에어컨1004" value="${_obData.coName || ''}">
        </div>

        <div class="ob-field">
          <label>대표 연락처</label>
          <input class="ob-input" id="obCoTel" type="text" inputmode="tel"
            placeholder="010-1234-5678" value="${_obData.coTel || ''}">
        </div>

        <div class="ob-field">
          <label>저장 폴더 <span style="color:var(--mu);font-size:11px;">(선택)</span></label>
          <button class="btn ${hasFolder ? 'b-green' : 'b-blue'}" id="obSelectFolder"
            style="width:100%;justify-content:center;padding:11px;">
            ${hasFolder ? `✅ ${escHtml(photoFolderHandle.name)}` : '📁 폴더 선택하기'}
          </button>
          <p style="font-size:11px;color:var(--mu);margin:4px 0 0;">
            사진·데이터를 자동 저장할 폴더. 나중에 설정에서도 가능.
          </p>
        </div>
      </div>
    </div>`;

  // 아이콘 선택
  document.querySelectorAll('.ob-icon-opt').forEach(btn => {
    if (btn.dataset.ic === _obData.coIcon) btn.classList.add('selected');
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ob-icon-opt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      _obData.coIcon = btn.dataset.ic;
    });
  });

  // 입력 저장
  document.getElementById('obCoName').addEventListener('input', e => { _obData.coName = e.target.value; });
  document.getElementById('obCoTel').addEventListener('input', e => {
    const raw = e.target.value.replace(/[^\d]/g, '');
    let fmt = e.target.value;
    if (raw.length === 11) fmt = `${raw.slice(0,3)}-${raw.slice(3,7)}-${raw.slice(7)}`;
    else if (raw.length === 10) fmt = `${raw.slice(0,3)}-${raw.slice(3,6)}-${raw.slice(6)}`;
    if (fmt !== e.target.value) e.target.value = fmt;
    _obData.coTel = e.target.value;
  });

  // 폴더 선택
  const folderBtn = document.getElementById('obSelectFolder');
  if (folderBtn && 'showDirectoryPicker' in window) {
    folderBtn.addEventListener('click', async () => {
      try {
        if (typeof selectPhotoFolder === 'function') {
          await selectPhotoFolder();
          if (photoFolderHandle) {
            folderBtn.textContent = `✅ ${escHtml(photoFolderHandle.name)}`;
            folderBtn.className = 'btn b-green';
            folderBtn.style.cssText = 'width:100%;justify-content:center;padding:11px;';
            _obData.folderSet = true;
          }
        }
      } catch(e) { console.warn('폴더 선택 실패:', e); }
    });
  }
}

// HTML escape
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ════════════════════════════════════════
// 다음/이전 버튼 처리
// ════════════════════════════════════════
function onboardingNext() {
  // 3단계 완료 → 설정 적용 후 시작
  if (_obStep === TOTAL_STEPS) {
    applyOnboardingSettings();
    localStorage.setItem(ONBOARDING_DONE_KEY, '1');
    hideOnboarding();
    return;
  }
  _obStep++;
  renderOnboardingStep();
}

function onboardingPrev() {
  if (_obStep > 1) { _obStep--; renderOnboardingStep(); }
}

// applyOnboardingSettings → finishOnboarding 래퍼
function applyOnboardingSettings() { finishOnboarding(); }

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
