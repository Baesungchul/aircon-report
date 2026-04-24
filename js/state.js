/* ═══════════════════════════════
   STATE
═══════════════════════════════ */
let units = [];
let nid   = 1;
const CO_KEY  = 'ac_co_v2';
const CO_FIELDS = ['coName','coBrand','coTel','coBiz','coAddr','coEmail','coWeb','coDesc'];
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

  // ── 뒤로가기 차단 ──
  history.pushState(null, '', location.href);
  window.addEventListener('popstate', () => {
    history.pushState(null, '', location.href);
    if (units.length > 0) {
      showToast('뒤로가기는 차단됩니다 — 💾 저장 버튼을 이용해주세요', 'err');
    }
  });

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

