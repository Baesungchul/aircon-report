/* ═══════════════════════════════
   STATE
═══════════════════════════════ */
let units = [];
let nid   = 1;
let currentWorkId = '';          // ★ 현재 작업의 고유 ID
let currentWorkType = 'household'; // ★ 'household' | 'facility'
let currentFolderName = null;    // ★ 불러온 작업의 폴더명 (새 작업이면 null)
let facilityCustomer = { phone: '', contact: '', address: '', memo: '' };
let workPosts = [];             // ★ 글작성(블로그/SNS) 저장글 — 현재 작업에 귀속
let workPostMemo = '';          // ★ 글작성 참고메모 — 채널 무관 재사용(작업에 귀속)
let currentWorkEndDate = '';    // ★ 작업 종료일(YYYY-MM-DD, 여러 날 작업). 빈값=당일 완료

/* ═══════════════════════════════════════════════════════════
   작업 귀속 전역 초기화 (2026-08-13)

   왜: workPosts 같은 '현재 작업에 딸린' 전역은 작업을 바꿀 때마다 비워야 하는데,
       비우는 코드가 진입 경로마다 흩어져 있어서 새 경로를 만들 때 빠지기 쉽다.
       실제로 공유작업 열기 경로에 workPosts 초기화가 없어서, 직전 작업의 글 칩이
       엉뚱한 작업 호수 옆에 붙어 보이는 버그가 있었다(2026-08-13 수정).
       삭제 후 화면 초기화(clearIfCurrent)에도 빠져 있었다.

   앞으로 작업에 귀속되는 전역을 추가하면 여기 한 곳에만 넣으면 된다.
   ⚠️ units/currentWorkId/currentFolderName 처럼 경로마다 다른 값을 넣어야 하는 것은
      여기서 건드리지 않는다(각 경로가 직접 설정). 여긴 '항상 비워야 하는 것'만.
═══════════════════════════════════════════════════════════ */
function resetWorkGlobals() {
  try { workPosts = []; } catch (e) {}
  try { workPostMemo = ''; } catch (e) {}
  try { currentWorkEndDate = ''; } catch (e) {}
  /* ★ 2026-08-16: 작업의 업종. 여기서 안 비우면 직전 작업의 업종이 따라붙어
     엉뚱한 보고서 제목·호칭이 나온다(저장글이 따라붙던 것과 같은 사고 유형).
     각 진입 경로가 곧바로 Profiles.bindWork() 로 제 값을 채운다. */
  try { window._workProfileId = ''; window._workProfileSnap = null; } catch (e) {}
  /* ★ 2026-08-23 '기존 작업을 연 것'인지 '새 작업'인지 구분한다.
       새 작업  = 업종이 비어 있으면 지금 쓰는 업종을 새기는 게 맞다
       기존 작업 = 업종이 비어 있으면 **비운 채로 둬야 한다**.
       안 그러면 업종을 고른 적 없는 옛 작업을 열어서 저장하는 것만으로
       '지금 업종'이 그 작업에 박혀 버린다(사용자 보고: 작업C의 업종이 D→B로 바뀜). */
  try { window._workProfileLoaded = false; } catch (e) {}
  try { if (window.ProfilesUI && ProfilesUI.renderWorkChip) ProfilesUI.renderWorkChip(); } catch (e) {}
}
if (typeof window !== 'undefined') window.resetWorkGlobals = resetWorkGlobals;

const CO_KEY  = 'ac_co_v2';
const CO_FIELDS = ['coName','coBrand','coTel','coBiz','coAddr','coEmail','coWeb','coDesc','coBank','coCeo','coReportTitle','coUnitLabel','coStageLabel','coIndustryMajor','coIndustryMinor'];
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

  // ★★ UI 리스너를 최우선 등록 (어떤 await도 가로막지 못하게)
  //   아래 await dbGet('session_data') 등 비동기가 hang/실패해도
  //   버튼·호수펼침 리스너가 항상 살아있도록 init 진입 즉시 바인딩한다.
  //   (원인: await dbGet이 멈추면 그 뒤 bindAll()이 영영 실행 안 돼 일부 클릭 먹통)
  try { bindAll(); } catch(e){ console.error('초기 bindAll 실패:', e); }
  // ★★ 뒤로가기 핸들러도 최우선 등록 — 아래 await/세션복원 early-return에 막히면
  //   등록이 통째로 누락돼 하드웨어 뒤로가기가 먹통이 되던 문제 수정.
  try { setupBackButtonHandler(); } catch(e){ console.error('뒤로가기 등록 실패:', e); }

  // ★ 저장 폴더 연결도 일찍 시작 (아래 await dbGet 등에 막히지 않도록 병렬로).
  //   콜드 스타트(앱 완전 종료 후 재실행) 때 dbGet이 느리면 폴더 연결이
  //   지연/누락되어 "폴더 풀림"으로 보이던 문제 방지. 완료되면 화면을 다시 렌더한다.
  try {
    initPhotoFolder().then(() => {
      if (typeof renderAll === 'function') renderAll();
      if (typeof updateStats === 'function') updateStats();
    }).catch(e => console.warn('[init] 폴더 연결 실패(무시):', e));
  } catch(e) { console.warn('[init] initPhotoFolder 호출 실패:', e); }

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
    // ★ 2026-08-16 작업탭 우측 업종 칩 첫 렌더
    try { if (window.ProfilesUI && ProfilesUI.renderWorkChip) ProfilesUI.renderWorkChip(); } catch(e){}
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
        resetWorkGlobals();   // 저장글·참고메모·종료일
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
      // ★ 공유 작업 "빌려보기" 모드 복원 - 이게 없으면 앱이 백그라운드에서 종료된 후
      //   재시작 시 새로 찍은 사진이 원본 소유자 항목이 아니라 내 계정 밑에 새 작업으로
      //   저장되는 버그가 있었음(2026-07-08). sessionAutoSaveNow가 저장한 값을 그대로 복원.
      window._borrowedShare = s.borrowedShare || null;
      workPosts = Array.isArray(s.posts) ? s.posts : [];  // ★ 저장글 복원
      workPostMemo = (typeof s.postMemo === 'string') ? s.postMemo : '';  // ★ 참고메모 복원
      currentWorkEndDate = s.endDate || '';  // ★ 종료일 복원
      if (currentWorkType === 'facility' && s.facilityCustomer) {
        facilityCustomer = {
          phone: s.facilityCustomer.phone || '',
          contact: s.facilityCustomer.contact || '',
          address: s.facilityCustomer.address || '',
          memo: s.facilityCustomer.memo || '',
          workTarget: s.facilityCustomer.workTarget || '',
          price: s.facilityCustomer.price || '',
          startTime: s.facilityCustomer.startTime || '',
          endTime: s.facilityCustomer.endTime || ''
        };
      } else if (s.facilityCustomer) {
        // ★ 가정용이어도 facilityCustomer 복원 (모드 전환 시 공유)
        facilityCustomer = {
          phone: s.facilityCustomer.phone || '',
          contact: s.facilityCustomer.contact || '',
          address: s.facilityCustomer.address || '',
          memo: s.facilityCustomer.memo || '',
          workTarget: s.facilityCustomer.workTarget || '',
          price: s.facilityCustomer.price || '',
          startTime: s.facilityCustomer.startTime || '',
          endTime: s.facilityCustomer.endTime || ''
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

      // ★ 콜드 스타트 복원 직후엔 "저장된 상태 그대로" → 변경 없음으로 표시.
      //   (안 하면 앱 새로 열고 작업탭을 나갈 때 불필요한 저장 확인이 한 번 뜸)
      try {
        if (typeof _dataDirty !== 'undefined') _dataDirty = false;
        if (typeof quickSnapshot === 'function' && typeof _lastSaveSnapshot !== 'undefined') {
          _lastSaveSnapshot = quickSnapshot();
        }
      } catch(e) {}
    }
  } catch(e) {}

  // ── 뒤로가기 처리 ──
  //   ★ setupBackButtonHandler()는 init 맨 앞으로 이동함(세션복원 early-return에 막히지 않도록).

  // beforeunload 경고는 사용자 친화성 위해 제거 (자동저장으로 충분)

  // ── 앱 숨김/보임 시 자동저장 (화면 전환 대응) ──
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && units.length > 0) {
      // 백그라운드로 갈 때 즉시 저장
      sessionAutoSaveNow();
    } else if (document.visibilityState === 'visible') {
      // ★ 다시 보일 때 폴더 권한 재확인 (1.272) - 안드로이드가 권한 만료시키면 배너로 재연결 유도
      checkFolderPermissionBanner();
      // ★ 복귀 시 줌 잠금 재적용 - 백그라운드→복귀 후 웹뷰가 확대상태로 남는 버그 방지
      if (typeof setViewportZoom === 'function') setViewportZoom(false);
    }
  });
  // ★ Capacitor 네이티브 resume에서도 줌 잠금 재적용 (visibilitychange 미발화 대비)
  try {
    var _AppZ = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (_AppZ && _AppZ.addListener) {
      _AppZ.addListener('appStateChange', function (st) {
        if (st && st.isActive && typeof setViewportZoom === 'function') setViewportZoom(false);
      });
    }
  } catch (e) {}

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

  // ★ bindAll은 init 최상단으로 이동됨 (중복 등록 방지를 위해 여기선 호출 안 함)
  renderAll();
  updateStats();

  // ★ 폴더 연결은 init 최상단에서 백그라운드로 시작됨 (여기서 중복 호출 안 함)

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

// ★ 목록에 없는 동적 팝업(로그인창·수정창·일정추가·＋메뉴 등)도 뒤로가기로 닫기 위한 범용 처리.
//   탭바(z-index:1000)보다 위에 뜬 풀스크린 팝업 중 최상단을 찾아 닫는다.
//   (탭 패널/기존 목록 모달은 SKIP 또는 z<1000 → 각자의 기존 처리 유지)
var _BACK_SKIP_IDS = {
  tabbar:1, appBlock:1, camOverlay:1, toast:1, reorderFullView:1,
  saveDlg:1, slModal:1, coModal:1, settingsModal:1, imgModal:1, pvModal:1,
  reorderModal:1, themePickerModal:1, customerModal:1, onboardingModal:1
};
window.closeTopPopup = function () {
  try {
    var nodes = document.querySelectorAll('div, nav, section, aside');
    var best = null, bestZ = -1;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.id && _BACK_SKIP_IDS[el.id]) continue;
      var cs = window.getComputedStyle(el);
      if (cs.position !== 'fixed') continue;
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') === 0) continue;
      var z = parseInt(cs.zIndex, 10); if (isNaN(z)) z = 0;
      if (z < 1000) continue;                 // 탭바 이상에 뜬 진짜 팝업만 (탭 패널은 z<1000 → 제외)
      var r = el.getBoundingClientRect();
      if (r.width < window.innerWidth * 0.7 || r.height < window.innerHeight * 0.5) continue;  // 풀스크린류만
      if (z >= bestZ) { bestZ = z; best = el; }
    }
    if (!best) return false;
    // 닫기: 닫기/취소 버튼 우선(내부 정리 보존) → .open 제거 → 노드 제거
    var cb = best.querySelector('button[id*="Close"], button[id*="close"], button[id*="Cancel"], button[id*="cancel"], .cal-mp-close, .co-close');
    if (cb) { cb.click(); return true; }
    if (best.classList && best.classList.contains('open')) { best.classList.remove('open'); return true; }
    best.remove();
    return true;
  } catch (e) { return false; }
};

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

  /* ── 작업 불러오는 중 뒤로가기 차단 (2026-08-09) ──────────────
     로딩 중 뒤로가기로 빠져나오면 전역 상태가 반쯤 채워진 채 남아
     다음 작업을 열 때 에러가 났다. 기본은 차단하되,
     3초 안에 두 번 누르면 '중단할까요?'를 물어 탈출구는 남긴다. */
  let _loadBackAt = 0;
  function _blockBackWhileLoading() {
    if (!window._workLoading) return false;
    const now = Date.now();
    if (now - _loadBackAt < 3000) {
      _loadBackAt = 0;
      if (confirm('작업을 불러오는 중입니다.\n\n중단할까요?\n(중단해도 사진·데이터는 지워지지 않습니다)')) {
        if (window.abortWorkLoad) window.abortWorkLoad();
      }
    } else {
      _loadBackAt = now;
      if (typeof showToast === 'function') {
        showToast('불러오는 중이에요. 중단하려면 뒤로가기를 한 번 더 누르세요', 'err');
      }
    }
    return true;
  }

  window.addEventListener('popstate', async (e) => {
    // ★ -2) 작업 불러오는 중이면 뒤로가기 차단
    if (_blockBackWhileLoading()) {
      history.pushState({ page: 'main' }, '', location.href);
      return;
    }

    // ★ -1) 종료가 이미 확인됨 - 다시 묻지 않고 계속 뒤로 (히스토리 끝까지)
    if (_exitConfirmed) {
      // 안전장치: 50회 넘게 뒤로 가도 안 끝나면 멈춤 (무한 루프 방지)
      if (_exitBackAttempts++ > 50) return;
      try { window.history.back(); } catch(err) {}
      return;
    }

    // ★ 앱 내장 카메라가 열려있으면 먼저 닫기
    if (window.isInAppCameraOpen && window.isInAppCameraOpen()) {
      window.closeInAppCamera();
      history.pushState({ page: 'main' }, '', location.href);
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

    // ★ 목록 밖 동적 팝업(로그인/수정/일정추가/＋메뉴 등) 닫기
    if (window.closeTopPopup && window.closeTopPopup()) {
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

    if (openModal && openModal.id !== 'customerModal') {
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
      // ★ 설정/보고서 탭 모달은 작업탭이 아니라 스케줄(홈)로 이동
      if ((openModal.id === 'settingsModal' || openModal.id === 'pvModal') && typeof switchTab === 'function') switchTab('records');
      history.pushState({ page: 'main' }, '', location.href);
      return;
    }

    // ★ 3-0) 스케줄(records) 탭이 아니면 스케줄로 이동(종료 안 함) - 모든 뒤로가기는 스케줄로
    var _atP = document.querySelector('.tab-item.active');
    if (_atP && _atP.dataset && _atP.dataset.tab !== 'records') {
      if (typeof switchTab === 'function') switchTab('records');
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

  // ════════════════════════════════════════════════
  // ★ Capacitor 네이티브 하드웨어 뒤로가기 처리
  //   (popstate만으론 안드로이드 물리 뒤로가기가 안 잡혀, 어느 화면에서든
  //    한 번에 앱이 종료되던 문제. 이제: 모달 닫기 → 메인 → 종료 확인 순서)
  // ════════════════════════════════════════════════
  try {
    const _App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (_App && _App.addListener) {
      const _modalIds = ['saveDlg', 'slModal', 'coModal', 'settingsModal', 'imgModal', 'pvModal', 'reorderModal', 'themePickerModal', 'customerModal', 'onboardingModal'];
      _App.addListener('backButton', async () => {
        // ★ 작업 불러오는 중이면 차단 (연속 2회면 중단 확인)
        if (_blockBackWhileLoading()) return;

        // 0) 앱 내장 카메라가 열려있으면 먼저 닫기
        if (window.isInAppCameraOpen && window.isInAppCameraOpen()) {
          window.closeInAppCamera();
          return;
        }
        // 1) 순서편집 전체화면이 열려있으면 닫기
        const rfv = document.getElementById('reorderFullView');
        if (rfv && rfv.classList.contains('open')) {
          rfv.classList.remove('open');
          if (window._markModalJustClosed) window._markModalJustClosed();
          return;
        }
        // ★ 목록 밖 동적 팝업(로그인/수정/일정추가/＋메뉴 등) 닫기
        if (window.closeTopPopup && window.closeTopPopup()) {
          if (window._markModalJustClosed) window._markModalJustClosed();
          return;
        }
        // ★ 1-2) 달력이 확장(전체화면)되어 있으면 먼저 접는다
        if (window.__calCollapse && window.__calCollapse()) return;

        // 2) 열린 모달이 있으면 닫기 (= 메인 화면으로 돌아감)
        for (const id of _modalIds) {
          const el = document.getElementById(id);
          if (el && el.classList.contains('open')) {
            if (id === 'customerModal') break;  // 스케줄=홈 → 종료 흐름으로
            if (id === 'pvModal') {
              if (typeof window._resetPvZoom === 'function') window._resetPvZoom();
              if (typeof setViewportZoom === 'function') setViewportZoom(false);
            }
            el.classList.remove('open');
            if (window._markModalJustClosed) window._markModalJustClosed();
            // ★ 설정/보고서 탭 모달은 작업탭이 아니라 스케줄(홈)로 이동
            if ((id === 'settingsModal' || id === 'pvModal') && typeof switchTab === 'function') switchTab('records');
            return;
          }
        }
        // ★ 3-0) 스케줄(records) 탭이 아니면 스케줄로 이동(종료 안 함)
        var _atN = document.querySelector('.tab-item.active');
        if (_atN && _atN.dataset && _atN.dataset.tab !== 'records') {
          if (typeof switchTab === 'function') switchTab('records');
          return;
        }
        // 3) 메인 화면 → "한 번 더 누르면 종료" (네이티브에서 confirm()이 안 떠서
        //    종료가 막히던 문제 회피. 안드로이드 표준: 2초 내 두 번 누르면 종료)
        if (window._backExitReady) {
          try { if (typeof sessionAutoSaveNow === 'function') await sessionAutoSaveNow(); } catch(e) {}
          try { if (typeof flushAllCustomers === 'function') await flushAllCustomers(); } catch(e) {}
          try { _App.exitApp(); } catch(e) {}
        } else {
          window._backExitReady = true;
          if (typeof showToast === 'function') showToast('뒤로가기를 한 번 더 누르면 종료됩니다');
          setTimeout(() => { window._backExitReady = false; }, 2000);
        }
      });
    }
  } catch(e) { console.warn('[뒤로가기] 네이티브 리스너 등록 실패:', e); }
}

// ═══════════════════════════════
// 모달 열릴 때 body 스크롤 막기 (뒷 화면 움직임 방지)
// ═══════════════════════════════
(function setupModalScrollLock() {
  const modalIds = ['saveDlg', 'slModal', 'coModal', 'settingsModal', 'imgModal', 'pvModal', 'reorderModal', 'themePickerModal', 'customerModal', 'onboardingModal'];

  let savedScrollY = 0;

  /* ★ 2026-08-27 동적으로 만들어 붙이는 오버레이도 잠근다.
       위 modalIds 는 index.html 에 고정 id 로 박혀 있는 모달만 본다.
       AI 글작성 결과 팝업처럼 그때그때 createElement 해서 body 에 붙이는 것들은
       여기 걸리지 않아 **뒷 화면이 그대로 스크롤됐다**(2026-08-27 사용자 지적).
       → 그런 오버레이에 `ov-lock` 클래스만 붙이면 이 잠금에 함께 들어온다. */
  function anyDynOverlay() {
    try { return !!document.querySelector('.ov-lock'); } catch (e) { return false; }
  }

  function updateBodyLock() {
    // 열린 모달이 있는지 확인
    const anyOpen = modalIds.some(id => {
      const el = document.getElementById(id);
      return el && el.classList.contains('open');
    }) || anyDynOverlay();

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

    /* body 에 `ov-lock` 오버레이가 붙고 떨어지는 것을 감시한다.
       ⚠️ body 의 childList 는 토스트 때문에도 자주 흔들린다 →
          추가·제거된 노드에 실제로 ov-lock 이 있을 때만 다시 계산한다(헛일 방지). */
    function hasLockNode(list) {
      for (let i = 0; i < (list ? list.length : 0); i++) {
        const n = list[i];
        if (n && n.nodeType === 1 && n.classList && n.classList.contains('ov-lock')) return true;
      }
      return false;
    }
    try {
      const bodyObs = new MutationObserver(muts => {
        for (let i = 0; i < muts.length; i++) {
          if (hasLockNode(muts[i].addedNodes) || hasLockNode(muts[i].removedNodes)) {
            updateBodyLock();
            return;
          }
        }
      });
      bodyObs.observe(document.body, { childList: true });
    } catch (e) {}
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
    /* ★ 2026-08-16: 지금 열린 작업의 업종 프로필에서 읽는다.
         프로필이 하나뿐이면 ac_co_v2 와 값이 같아 동작이 기존과 동일하다. */
    let ci = null;
    try { if (window.Profiles && Profiles.displayForCurrentWork) ci = Profiles.displayForCurrentWork(); } catch (e) {}
    if (!ci) { try { if (window.Profiles && Profiles.infoForCurrentWork) ci = Profiles.infoForCurrentWork(); } catch (e) {} }
    if (!ci) ci = JSON.parse(localStorage.getItem(CO_KEY) || '{}');
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
    const logoTx = document.querySelector('#settingsModal .logo-tx');
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
      // 앱 이름: 현장 매니저 (업종 무관)
      logoTx.innerHTML = `<span class="logo-tx-1">현장</span> <span class="logo-tx-2">매니저</span>`;
      if (titleTag) titleTag.textContent = '현장 매니저';
    }
  } catch(e) {}
}
