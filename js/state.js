/* ═══════════════════════════════
   STATE
═══════════════════════════════ */
let units = [];
let nid   = 1;
const CO_KEY  = 'ac_co_v2';
const CO_FIELDS = ['coName','coBrand','coTel','coBiz','coAddr','coEmail','coWeb','coDesc','coReportTitle','coUnitLabel','coStageLabel','coIndustryMajor','coIndustryMinor'];
let coIconData = '';   // '' = 기본, 이모지 1글자, 또는 'data:image/...' (업로드 이미지)
const CO_ICON_KEY = 'ac_co_icon_v1';

/* ═══════════════════════════════
   INIT
═══════════════════════════════ */
async function init() {
  document.getElementById('workDate').value = new Date().toISOString().split('T')[0];

  // 회사정보 불러오기
  try {
    const ci = JSON.parse(localStorage.getItem(CO_KEY)||'{}');
    CO_FIELDS.forEach(id => {
      const el = document.getElementById(id);
      if (el && ci[id]) el.value = ci[id];
    });
    updateCoHdrBtn();
    // 업종별 호칭이 있으면 메인 화면 라벨 변경
    applyCustomLabels();
  } catch(e){}

  // 아이콘 로드
  try {
    coIconData = localStorage.getItem(CO_ICON_KEY) || '';
    applyCoIcon();
  } catch(e){}

  // 아이콘 선택 버튼 이벤트
  document.querySelectorAll('.co-icon-pick[data-ic]').forEach(btn => {
    btn.addEventListener('click', () => {
      coIconData = btn.dataset.ic;
      applyCoIcon();
    });
  });

  // 아이콘 파일 업로드
  document.getElementById('coIconFile')?.addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) {
      showToast('이미지가 너무 큽니다 (최대 2MB)', 'err');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      // 작은 사이즈로 리사이즈 (200x200 정도)
      const img = new Image();
      img.onload = () => {
        const size = 200;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        // 정사각형 크롭
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2;
        const sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
        coIconData = canvas.toDataURL('image/jpeg', 0.85);
        applyCoIcon();
        showToast('✅ 아이콘 업로드 완료', 'ok');
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
    e.target.value = '';
  });

  // 아이콘 초기화 버튼
  document.getElementById('coIconClear')?.addEventListener('click', () => {
    coIconData = '';
    applyCoIcon();
  });

  // 모달 내 실시간 미리보기
  ['coName','coBrand','coTel','coBiz','coDesc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateCoPreview);
  });

  // 헤더 입력 변경도 자동저장 + 폴더 캐시 무효화
  ['aptName','workDate','workerName'].forEach(id =>
    document.getElementById(id).addEventListener('change', () => {
      sessionAutoSave();
      clearDirIndexCache();  // 아파트/날짜 바뀌면 폴더 경로도 바뀜 → 캐시 초기화
    })
  );

  // ── 세션 자동 복원 (이중 백업) ──
  // 1순위: IndexedDB / 2순위: localStorage
  try {
    let s = null;
    try {
      s = await dbGet('session_data');
    } catch(e) {}

    // IndexedDB에 없으면 localStorage 확인
    if (!s) {
      try {
        const ls = localStorage.getItem('ac_session_backup');
        if (ls) s = JSON.parse(ls);
      } catch(e) {}
    }

    if (s) {
      // isEmpty가 true면 빈 새 작업 상태 (작업명/날짜는 저장된 값 유지)
      if (s.isEmpty) {
        units = [];
        nid = 1;
        document.getElementById('aptName').value    = s.apt||'';
        document.getElementById('workDate').value   = s.date||new Date().toISOString().split('T')[0];
        document.getElementById('workerName').value = s.worker||'';
      } else if (s.units && s.units.length > 0) {
        units = normalizeUnits(s.units);
        nid   = s.nid || units.length + 1;
        document.getElementById('aptName').value    = s.apt||'';
        document.getElementById('workDate').value   = s.date||new Date().toISOString().split('T')[0];
        document.getElementById('workerName').value = s.worker||'';
      }
      // 업체정보는 항상 복원
      if (s.companyName) document.getElementById('coName').value = s.companyName;
      if (s.companyTel)  document.getElementById('coTel').value  = s.companyTel;
      if (s.companyDesc) document.getElementById('coDesc').value = s.companyDesc;
    }
  } catch(e) {}

  // ── 뒤로가기 처리 ──
  // 모달이 열려있으면 모달 닫기 (메인 화면으로)
  // 메인 화면에서 뒤로가기는 종료 확인
  // 자동저장(visibilitychange + IndexedDB + localStorage)으로 데이터 유실 위험 없음
  setupBackButtonHandler();

  // beforeunload 경고는 사용자 친화성 위해 제거 (자동저장으로 충분)

  // ── 앱 숨김/보임 시 자동저장 (화면 전환 대응) ──
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && units.length > 0) {
      // 백그라운드로 갈 때 즉시 저장
      sessionAutoSaveNow();
    }
  });

  // ── 화면 포커스 해제 시 저장 ──
  window.addEventListener('pagehide', () => {
    if (units.length > 0) sessionAutoSaveNow();
  });

  // ── bfcache에서 복원되는 경우 ──
  // (백그라운드에서 돌아왔을 때 브라우저가 캐시에서 페이지를 복원하는 경우)
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      // 페이지가 캐시에서 복원됨 - 상태 그대로 유지 (아무것도 안해도 됨)
      // 혹시 UI가 이상하면 재렌더
      if (typeof renderAll === 'function') {
        renderAll();
        updateStats();
      }
    }
  });

  // 자동다운로드 설정 복원
  try {
    const ad = localStorage.getItem('ac_auto_dl');
    if (ad === '1') {
      const el = document.getElementById('autoDownload');
      if (el) el.checked = true;
    }
  } catch(e){}
  const adEl = document.getElementById('autoDownload');
  if (adEl) adEl.addEventListener('change', e => {
    try { localStorage.setItem('ac_auto_dl', e.target.checked ? '1' : '0'); } catch(e2){}
  });

  // ── 자동저장 폴더 복원 ──
  await initPhotoFolder();

  bindAll();
  renderAll();
  updateStats();
}


// ═══════════════════════════════
// 뒤로가기 처리: 모달 닫기 → 메인 → 종료 확인
// ═══════════════════════════════
function setupBackButtonHandler() {
  // history에 더미 상태 추가
  history.pushState({ page: 'main' }, '', location.href);

  window.addEventListener('popstate', (e) => {
    // 1) 열린 모달 찾기
    const modalIds = ['saveDlg', 'slModal', 'coModal', 'settingsModal', 'imgModal', 'pvModal', 'reorderModal', 'themePickerModal'];
    let openModal = null;
    for (const id of modalIds) {
      const el = document.getElementById(id);
      if (el && el.classList.contains('open')) {
        openModal = el;
        break;
      }
    }

    if (openModal) {
      // 모달 닫기 (메인으로)
      openModal.classList.remove('open');
      // history 상태 다시 추가 (뒤로가기 다시 가능하게)
      history.pushState({ page: 'main' }, '', location.href);
      return;
    }

    // 2) 메인 화면에서 뒤로가기 = 종료 확인
    const confirmExit = confirm('앱을 종료하시겠습니까?\n\n작업 내용은 자동으로 저장되어 있어 다음에 다시 열 수 있습니다.');

    if (confirmExit) {
      // 자동저장 후 종료
      try { sessionAutoSaveNow(); } catch(e) {}
      // 페이지 닫기 시도 (window.close는 일반적으로 작동 안함)
      // 대신 history 더 뒤로 이동하여 브라우저가 자연스럽게 처리
      window.history.back();
    } else {
      // 취소 → 현재 페이지 유지 (history 상태 다시 추가)
      history.pushState({ page: 'main' }, '', location.href);
    }
  });
}

// ═══════════════════════════════
// 모달 열릴 때 body 스크롤 막기 (뒷 화면 움직임 방지)
// ═══════════════════════════════
(function setupModalScrollLock() {
  const modalIds = ['saveDlg', 'slModal', 'coModal', 'settingsModal', 'imgModal', 'pvModal', 'reorderModal', 'themePickerModal'];

  let savedScrollY = 0;

  function updateBodyLock() {
    // 열린 모달이 있는지 확인
    const anyOpen = modalIds.some(id => {
      const el = document.getElementById(id);
      return el && el.classList.contains('open');
    });

    if (anyOpen) {
      if (!document.body.classList.contains('modal-open')) {
        savedScrollY = window.scrollY;
        document.body.classList.add('modal-open');
        document.body.style.top = `-${savedScrollY}px`;
      }
    } else {
      if (document.body.classList.contains('modal-open')) {
        document.body.classList.remove('modal-open');
        document.body.style.top = '';
        window.scrollTo(0, savedScrollY);
      }
    }
  }

  // 페이지 로드 후 각 모달의 클래스 변화 감지
  function bind() {
    modalIds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const observer = new MutationObserver(updateBodyLock);
      observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();

// 업체정보의 호칭 설정에 따라 메인 화면 라벨/플레이스홀더 동적 변경
function applyCustomLabels() {
  try {
    const ci = JSON.parse(localStorage.getItem(CO_KEY) || '{}');
    const unitLabel = (ci.coUnitLabel || '').trim();  // "호수" / "현장" / "차량" 등
    const stageLabel = (ci.coStageLabel || '').trim(); // "작업" / "시공" / "청소" 등

    if (unitLabel) {
      // newName placeholder
      const newName = document.getElementById('newName');
      if (newName) newName.placeholder = `${unitLabel} 입력`;

      // 호수 검색 placeholder
      const searchInp = document.getElementById('searchUnit');
      if (searchInp) searchInp.placeholder = `🔍 ${unitLabel} 검색`;
    }

    // app.js의 작업명 placeholder도 변경 가능
    if (stageLabel) {
      const aptName = document.getElementById('aptName');
      if (aptName && !aptName.placeholder.includes('현장')) {
        aptName.placeholder = `${stageLabel}명을 입력하세요`;
      }
    }
  } catch(e) {}
}
