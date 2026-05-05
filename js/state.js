/* ═══════════════════════════════
   STATE
═══════════════════════════════ */
let units = [];
let nid   = 1;
let currentWorkId = '';  // ★ 현재 작업의 고유 ID (일련번호)
let currentWorkType = 'household';  // ★ 'household' | 'facility'
let facilityCustomer = { phone: '', contact: '', address: '', memo: '' };  // ★ 공용시설 모드용

const CO_KEY  = 'ac_co_v2';
const CO_FIELDS = ['coName','coBrand','coTel','coBiz','coAddr','coEmail','coWeb','coDesc','coReportTitle','coUnitLabel','coStageLabel','coIndustryMajor','coIndustryMinor'];
let coIconData = '';
const CO_ICON_KEY = 'ac_co_icon_v1';

// workId 생성 - W{YYYYMMDD}-{HHMM}-{rand4}
function generateWorkId() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const hm = `${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
  const rand = Math.random().toString(36).slice(2, 6);  // 4자리
  return `W${ymd}-${hm}-${rand}`;
}

// 새 workId 보장 - 없으면 생성
function ensureWorkId() {
  if (!currentWorkId) {
    currentWorkId = generateWorkId();
    console.log('[workId] 새 작업 ID 생성:', currentWorkId);
  }
  return currentWorkId;
}

/* ═══════════════════════════════
   시간 헬퍼 (브라우저 로컬 시간대)
   - localDateStr: YYYY-MM-DD (로컬 기준)
   - localIsoString: YYYY-MM-DDTHH:mm:ss±HH:MM (로컬 + 오프셋)
   - localTimeStr: HHMM (로컬)
═══════════════════════════════ */

// 로컬 시간 기준 YYYY-MM-DD (UTC 변환 없음)
function localDateStr(d) {
  d = d || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 로컬 시간 기준 ISO 8601 (시간대 오프셋 포함)
// 예: 2026-05-03T10:30:00+09:00 (한국)
//     2026-05-03T01:30:00+00:00 (영국)
function localIsoString(d) {
  d = d || new Date();
  const tz = -d.getTimezoneOffset();  // 분 단위 (한국 = +540)
  const sign = tz >= 0 ? '+' : '-';
  const tzAbs = Math.abs(tz);
  const tzH = String(Math.floor(tzAbs / 60)).padStart(2, '0');
  const tzM = String(tzAbs % 60).padStart(2, '0');
  const y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${M}-${D}T${h}:${m}:${s}${sign}${tzH}:${tzM}`;
}

// 로컬 시간 기준 HHMM
function localTimeStr(d) {
  d = d || new Date();
  return String(d.getHours()).padStart(2,'0') + String(d.getMinutes()).padStart(2,'0');
}

// 호환성 - 기존 함수명 유지 (모두 브라우저 로컬 시간 사용)
function kstDateStr(d) { return localDateStr(d); }
function kstIsoString(d) { return localIsoString(d); }
function kstTimeStr(d) { return localTimeStr(d); }
function nowKST() { return new Date(); }

/* ═══════════════════════════════
   INIT
═══════════════════════════════ */
async function init() {
  document.getElementById('workDate').value = kstDateStr();

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
        document.getElementById('workDate').value   = s.date||kstDateStr();
        document.getElementById('workerName').value = s.worker||'';
      } else if (s.units && s.units.length > 0) {
        units = normalizeUnits(s.units);
        nid   = s.nid || units.length + 1;
        document.getElementById('aptName').value    = s.apt||'';
        document.getElementById('workDate').value   = s.date||kstDateStr();
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
  // 메인 상태 1개만 유지
  history.pushState({ page: 'main' }, '', location.href);

  window.addEventListener('popstate', (e) => {
    // 1) 열린 모달 찾기
    const modalIds = ['saveDlg', 'slModal', 'coModal', 'settingsModal', 'imgModal', 'pvModal', 'reorderModal', 'themePickerModal', 'customerModal', 'onboardingModal'];
    let openModal = null;
    for (const id of modalIds) {
      const el = document.getElementById(id);
      if (el && el.classList.contains('open')) {
        openModal = el;
        break;
      }
    }

    if (openModal) {
      // 모달 닫기 (메인으로 돌아오기만)
      openModal.classList.remove('open');
      // 메인 상태 다시 pushState - 다음 뒤로가기를 위함
      history.pushState({ page: 'main' }, '', location.href);
      return;
    }

    // 2) 메인 화면에서 뒤로가기 = 종료 확인
    const confirmExit = confirm('앱을 종료하시겠습니까?\n\n작업 내용은 자동으로 저장되어 있어 다음에 다시 열 수 있습니다.');

    if (confirmExit) {
      // 변경 있을 때만 저장 (변경 없으면 빠르게 종료)
      if (typeof _dataDirty === 'undefined' || _dataDirty) {
        try { sessionAutoSaveNow(); } catch(e) {}
        try { if (typeof flushAllCustomers === 'function') flushAllCustomers(); } catch(e) {}
      }

      // 종료 시도:
      // PWA/Chrome 앱 환경에서는 window.close()가 동작
      try { window.close(); } catch(e) {}

      // 동작 안 하면 빈 페이지로 이동 (사용자가 한번 더 뒤로가기 누르면 종료)
      // 더 확실한 방법: location.replace로 진입 페이지로 가서 사용자가 한 번 더 누르면 종료
      try {
        // history 0개로 만들기 시도
        const totalDepth = history.length;
        if (totalDepth > 1) {
          history.go(-(totalDepth - 1));
        } else {
          window.history.back();
        }
      } catch(e) {
        window.history.back();
      }
    } else {
      // 취소 → 메인 상태 다시 pushState
      history.pushState({ page: 'main' }, '', location.href);
    }
  });
}

// ═══════════════════════════════
// 모달 열릴 때 body 스크롤 막기 (뒷 화면 움직임 방지)
// ═══════════════════════════════
(function setupModalScrollLock() {
  const modalIds = ['saveDlg', 'slModal', 'coModal', 'settingsModal', 'imgModal', 'pvModal', 'reorderModal', 'themePickerModal', 'customerModal', 'onboardingModal'];

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
    const unitLabel = (ci.coUnitLabel || '').trim();
    const stageLabel = (ci.coStageLabel || '').trim();
    const reportTitle = (ci.coReportTitle || '').trim();  // "에어컨 청소 보고서"

    if (unitLabel) {
      const newName = document.getElementById('newName');
      if (newName) newName.placeholder = `${unitLabel} 입력`;

      const searchInp = document.getElementById('searchUnit');
      if (searchInp) searchInp.placeholder = `🔍 ${unitLabel} 검색`;
    }

    if (stageLabel) {
      const aptName = document.getElementById('aptName');
      if (aptName && !aptName.placeholder.includes('현장')) {
        aptName.placeholder = `${stageLabel}명을 입력하세요`;
      }
    }

    // ★ 메인 타이틀 변경
    // "에어컨 청소 보고서" → "에어컨 보고서 작성기" (좁아지면 "에어컨" + "보고서 작성기")
    // "도배 시공 보고서" → "도배 보고서 작성기"
    // (첫 단어만 사용)
    const logoTx = document.querySelector('.logo-tx');
    const titleTag = document.querySelector('title');
    if (logoTx) {
      let firstPart = '작업';
      let secondPart = '보고서 작성기';
      if (reportTitle) {
        const firstWord = reportTitle.split(/\s+/)[0];
        if (firstWord) {
          firstPart = firstWord;
        }
      }
      // span으로 분리 - 좁아지면 두 span 사이에서만 줄바꿈
      logoTx.innerHTML = `<span class="logo-tx-1">${firstPart}</span> <span class="logo-tx-2">보고서 작성기</span>`;
      if (titleTag) titleTag.textContent = `${firstPart} 보고서 작성기`;
    }
  } catch(e) {}
}
