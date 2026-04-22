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

  // ── 세션 자동 복원 ──
  try {
    const s = await dbGet('session_data');
    if (s && s.units && s.units.length > 0) {
      const ago = Math.round((Date.now() - new Date(s.savedAt).getTime()) / 60000);
      const msg = ago < 60
        ? `${ago}분 전 작업이 있습니다 (${s.units.length}개 호수)\n복원할까요?`
        : `이전 작업이 있습니다 (${s.units.length}개 호수, ${Math.round(ago/60)}시간 전)\n복원할까요?`;
      if (confirm(msg)) {
        units = normalizeUnits(s.units);
        nid   = s.nid || units.length + 1;
        document.getElementById('aptName').value    = s.apt||'';
        document.getElementById('workDate').value   = s.date||new Date().toISOString().split('T')[0];
        document.getElementById('workerName').value = s.worker||'';
        if (s.companyName) document.getElementById('coName').value = s.companyName;
        if (s.companyTel)  document.getElementById('coTel').value  = s.companyTel;
        if (s.companyDesc) document.getElementById('coDesc').value = s.companyDesc;
        showSaveStatus('saved', '✓ 복원됨');
      }
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

  // ── 페이지 이탈 경고 ──
  window.addEventListener('beforeunload', e => {
    if (units.length > 0) {
      e.preventDefault();
      e.returnValue = '작업 중인 내용이 있습니다. 페이지를 떠나면 저장되지 않은 내용이 사라질 수 있습니다.';
      return e.returnValue;
    }
  });

  // ── 앱 숨김/보임 시 자동저장 (화면 전환 대응) ──
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && units.length > 0) {
      sessionAutoSaveNow();
    }
  });

  // ── 화면 포커스 해제 시 저장 ──
  window.addEventListener('pagehide', () => {
    if (units.length > 0) sessionAutoSaveNow();
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

