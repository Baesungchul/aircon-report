/* ═══════════════════════════════
   STATE
═══════════════════════════════ */
let units = [];
let nid   = 1;
let currentWorkId = '';          // ★ 현재 작업의 고유 ID
let currentWorkType = 'household'; // ★ 'household' | 'facility'
let currentFolderName = null;    // ★ 불러온 작업의 폴더명 (새 작업이면 null)
let facilityCustomer = { phone: '', contact: '', address: '', memo: '' };

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
      // ★ 새 작업 상태 (units 비어있음)였으면 → 새 작업으로 시작 (이전 작업 복원 X)
      // s.isEmpty가 명시적으로 true이거나, units가 비어있고 currentWorkId가 비어있으면 새 작업
      const wasEmpty = s.isEmpty === true ||
                       (!s.units || s.units.length === 0) && !s.workId;
      if (wasEmpty) {
        // 새 작업 상태로 시작
        units = [];
        nid = 1;
        currentWorkId = '';
        currentFolderName = null;
        currentWorkType = 'household';
        facilityCustomer = { phone: '', contact: '', address: '', memo: '' };
        // 업체정보는 복원
        if (s.companyName) document.getElementById('coName').value = s.companyName;
        if (s.companyTel)  document.getElementById('coTel').value  = s.companyTel;
        if (s.companyDesc) document.getElementById('coDesc').value = s.companyDesc;
        // workType UI 적용
        setTimeout(() => {
          if (typeof applyWorkTypeUI === 'function') applyWorkTypeUI();
        }, 50);
        return; // 이전 작업 복원 안 함
      }

      // ★ workType 먼저 복원 (UI 적용 순서 중요)
      currentWorkId = s.workId || '';
      currentWorkType = s.workType || 'household';
      currentFolderName = s.currentFolderName || null;  // ★ 폴더명 복원
      if (currentWorkType === 'facility' && s.facilityCustomer) {
        facilityCustomer = {
          phone: s.facilityCustomer.phone || '',
          contact: s.facilityCustomer.contact || '',
          address: s.facilityCustomer.address || '',
          memo: s.facilityCustomer.memo || ''
        };
      } else if (s.facilityCustomer) {
        // ★ 가정용이어도 facilityCustomer 복원 (모드 전환 시 공유)
        facilityCustomer = {
          phone: s.facilityCustomer.phone || '',
          contact: s.facilityCustomer.contact || '',
          address: s.facilityCustomer.address || '',
          memo: s.facilityCustomer.memo || ''
        };
      } else {
        facilityCustomer = { phone: '', contact: '', address: '', memo: '' };
      }

      if (s.units && s.units.length > 0) {
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

      // ★ workType UI 적용 (DOM 준비된 후)
      setTimeout(() => {
        if (typeof applyWorkTypeUI === 'function') applyWorkTypeUI();
      }, 50);
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
    } else if (document.visibilityState === 'visible') {
      // ★ 다시 보일 때 폴더 권한 재확인 (1.272) - 안드로이드가 권한 만료시키면 배너로 재연결 유도
      checkFolderPermissionBanner();
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

  // ★ 앱 시작 시 폴더 권한 확인 (1.272) - 풀렸으면 재연결 배너
  setTimeout(() => { try { checkFolderPermissionBanner(); } catch(e) {} }, 1500);
}


// ═══════════════════════════════
// 뒤로가기 처리: 모달 닫기 → 메인 → 종료 확인
// ═══════════════════════════════
// ★ 폴더 권한 풀림 감지 + 재연결 배너 (1.272)
//   안드로이드가 앱 비활성 중 폴더 권한을 만료시키면, 저장이 조용히 건너뛰어짐.
//   사용자가 캐시 전체 삭제 없이 버튼 한 번으로 복구할 수 있도록 배너 표시.
async function checkFolderPermissionBanner() {
  if (typeof photoFolderHandle === 'undefined' || !photoFolderHandle) return;
  let granted = false;
  try {
    const p = await Promise.race([
      photoFolderHandle.queryPermission({ mode: 'readwrite' }),
      new Promise(res => setTimeout(() => res('prompt'), 2000))
    ]);
    granted = (p === 'granted');
  } catch(e) { granted = false; }

  let banner = document.getElementById('folderReconnectBanner');
  if (granted) {
    if (banner) banner.remove();
    return;
  }
  if (banner) return;  // 이미 표시 중
  banner = document.createElement('div');
  banner.id = 'folderReconnectBanner';
  banner.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:9999;background:#c2410c;color:#fff;padding:11px 14px;display:flex;align-items:center;gap:10px;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.4);';
  banner.innerHTML = `
    <span style="flex:1;line-height:1.4;">📁 저장 폴더 연결이 풀렸어요. 사진 저장을 위해 다시 연결해주세요.</span>
    <button id="folderReconnectBtn" style="background:#fff;color:#c2410c;border:none;border-radius:7px;padding:8px 14px;font-size:13px;font-weight:800;white-space:nowrap;">다시 연결</button>`;
  document.body.appendChild(banner);
  document.getElementById('folderReconnectBtn').addEventListener('click', async () => {
    try {
      const np = await photoFolderHandle.requestPermission({ mode: 'readwrite' });
      if (np === 'granted') {
        banner.remove();
        showToast('✅ 폴더 다시 연결됨', 'ok');
        if (typeof saveToFolder === 'function') {
          try { await saveToFolder({ auto: true, silent: true }); } catch(e) {}
        }
      } else {
        showToast('권한이 거부되었습니다. 설정 → 저장 폴더에서 다시 선택해주세요.', 'err');
      }
    } catch(e) {
      showToast('재연결 실패: ' + e.message, 'err');
    }
  });
}
if (typeof window !== 'undefined') window.checkFolderPermissionBanner = checkFolderPermissionBanner;

function setupBackButtonHandler() {
  // 메인 상태 1개만 유지
  history.pushState({ page: 'main' }, '', location.href);

  // ★ 방금 닫힌 모달 추적 (history.back 후 popstate 발생 시 메인으로 처리 안 하기)
  let _justClosedTimer = 0;
  // ★ 종료 확인됨 - 이후 모든 popstate에서 종료 확인 다시 띄우지 않음
  let _exitConfirmed = false;
  // ★ 종료 진행 중 뒤로가기 횟수 (무한 루프 안전장치)
  let _exitBackAttempts = 0;
  window._markModalJustClosed = function() {
    _justClosedTimer = Date.now();
  };

  window.addEventListener('popstate', async (e) => {
    // ★ -1) 종료가 이미 확인됨 - 다시 묻지 않고 계속 뒤로 (히스토리 끝까지)
    if (_exitConfirmed) {
      // 안전장치: 50회 넘게 뒤로 가도 안 끝나면 멈춤 (무한 루프 방지)
      if (_exitBackAttempts++ > 50) return;
      try { window.history.back(); } catch(err) {}
      return;
    }

    // ★ 0) 방금 모달을 닫은 직후의 popstate → 추가 처리 안 함
    // (closeReorderFullView, closeImgModal 등의 history.back으로 발생)
    if (Date.now() - _justClosedTimer < 500) {
      _justClosedTimer = 0;  // 한 번만 사용
      history.pushState({ page: 'main' }, '', location.href);
      return;
    }

    // ★ 1) 순서편집 전체화면 - 모달보다 먼저 처리 (스택의 가장 위)
    const rfv = document.getElementById('reorderFullView');
    if (rfv && rfv.classList.contains('open')) {
      rfv.classList.remove('open');
      _justClosedTimer = Date.now();
      history.pushState({ page: 'main' }, '', location.href);
      return;
    }

    // 2) 열린 모달 찾기
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
      // ★ reorderModal이면 변경사항 확인
      if (openModal.id === 'reorderModal' && typeof hasReorderChanges === 'function' && hasReorderChanges()) {
        const ok = confirm('🔄 변경된 순서가 있어요.\n\n저장하지 않고 닫을까요?\n(취소하면 순서편집으로 돌아갑니다)');
        if (!ok) {
          history.pushState({ page: 'main' }, '', location.href);
          return;
        }
      }
      openModal.classList.remove('open');
      // ★ 보고서 모달 닫을 때 줌 리셋 + viewport 줌 차단
      if (openModal.id === 'pvModal') {
        if (typeof window._resetPvZoom === 'function') window._resetPvZoom();
        if (typeof setViewportZoom === 'function') setViewportZoom(false);
      }
      _justClosedTimer = Date.now();
      history.pushState({ page: 'main' }, '', location.href);
      return;
    }

    // 3) 메인 화면에서 뒤로가기 = 종료 확인
    const confirmExit = confirm('앱을 종료하시겠습니까?\n\n작업 내용은 자동으로 저장되어 있어 다음에 다시 열 수 있습니다.');

    if (confirmExit) {
      // ★ 종료 의도 마킹 - 다음 popstate에서 또 종료 확인 안 띄움
      _exitConfirmed = true;

      // ★ 변경 있을 때만 저장 완료를 기다림 (변경 없으면 즉시 종료)
      const needsSave = (typeof _dataDirty === 'undefined' || _dataDirty);
      if (needsSave) {
        if (typeof showToast === 'function') showToast('저장 후 종료합니다...', 'ok');
        try {
          if (typeof sessionAutoSaveNow === 'function') await sessionAutoSaveNow();
        } catch(e) { console.warn('종료 저장 실패:', e); }
        try {
          if (typeof flushAllCustomers === 'function') await flushAllCustomers();
        } catch(e) { console.warn('고객 flush 실패:', e); }
      }

      // ★ 종료 시도 (1.254) - confirm 시점엔 이미 뒤로가기로 popstate가 발생해
      //   현재 히스토리 위치가 우리 가짜 'main' 상태보다 한 칸 뒤임.
      //   여기서 가짜 상태를 다시 push하지 않고 곧바로 한 번 더 뒤로 보내면
      //   진짜 이전 페이지(앱 진입 전)로 나가서 종료됨. (이전엔 go(-N) 계산이 안 맞아
      //   한 번 더 눌러야 했음)
      try { window.close(); } catch(e) {}
      // 다음 tick에 back() - popstate 처리 끝난 후 실행되도록
      setTimeout(() => {
        try { window.history.back(); } catch(e) {
          try { window.history.go(-1); } catch(e2) {}
        }
      }, 0);
      return;
    } else {
      // 취소 → 메인 상태 다시 pushState
      history.pushState({ page: 'main' }, '', location.href);
      return;
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

    // ★ 메인 타이틀 변경 (1.263)
    //   기본: "작업보고서 작성기"
    //   업종 설정 시: "{업종} 작업보고서 작성기"
    //     예) reportTitle "에어컨 청소 보고서" → 업종 "에어컨 청소" → "에어컨 청소 작업보고서 작성기"
    //         reportTitle "도배 시공 보고서"   → 업종 "도배 시공"   → "도배 시공 작업보고서 작성기"
    //   - reportTitle 뒤의 "보고서"/"작업 보고서" 같은 접미사는 떼어내고 업종만 추출
    const logoTx = document.querySelector('.logo-tx');
    const titleTag = document.querySelector('title');
    if (logoTx) {
      let industry = '';  // 업종 (예: "에어컨 청소")
      if (reportTitle) {
        // 끝의 "보고서", "작업 보고서", "작업보고서" 접미사 제거 → 업종만 남김
        industry = reportTitle
          .replace(/\s*작업\s*보고서\s*$/, '')
          .replace(/\s*보고서\s*$/, '')
          .trim();
      }
      const firstPart = industry ? `${industry} 작업` : '작업';
      // span으로 분리 - 좁아지면 두 span 사이에서만 줄바꿈
      logoTx.innerHTML = `<span class="logo-tx-1">${firstPart}</span> <span class="logo-tx-2">보고서 작성기</span>`;
      const fullTitle = industry ? `${industry} 작업보고서 작성기` : '작업보고서 작성기';
      if (titleTag) titleTag.textContent = fullTitle;
    }
  } catch(e) {}
}
