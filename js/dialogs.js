/* ═══════════════════════════════
   SAVE DIALOG
═══════════════════════════════ */
// 저장 버튼 메인 핸들러 - 상황에 맞게 자동 분기
async function handleSaveClick() {
  if (units.length === 0) {
    showToast('저장할 호수가 없습니다', 'err');
    return;
  }

  // 폴더가 설정되어 있으면 → 폴더 저장 (사진 + 세션)
  if (photoFolderHandle) {
    await saveToFolder();
    return;
  }

  // 폴더 미설정 → IndexedDB 저장 (이름 입력)
  openSaveDialog();
}

// 폴더 저장 - 사진 + 세션 정보를 한번에
async function saveToFolder() {
  // 권한 확인 (자동 요청)
  let permOk = false;
  try {
    const curPerm = await photoFolderHandle.queryPermission({ mode: 'readwrite' });
    if (curPerm === 'granted') {
      permOk = true;
    } else {
      // 권한이 없으면 자동 요청
      showToast('저장 권한을 요청합니다...', 'ok');
      const newPerm = await photoFolderHandle.requestPermission({ mode: 'readwrite' });
      permOk = (newPerm === 'granted');
    }
  } catch(e) {
    showToast('폴더 권한 확인 실패: ' + e.message, 'err');
    return;
  }

  if (!permOk) {
    showToast('폴더 권한이 거부되었습니다', 'err');
    return;
  }

  showOverlay('저장 중...');
  let saved = 0;
  let failed = 0;

  try {
    // 1) 모든 사진을 폴더에 저장
    for (const u of units) {
      for (let i = 0; i < u.before.length; i++) {
        try { await doWriteOne(u.before[i], u.name, '전'); saved++; await sleep(30); }
        catch(e) { failed++; }
      }
      for (let i = 0; i < u.after.length; i++) {
        try { await doWriteOne(u.after[i], u.name, '후'); saved++; await sleep(30); }
        catch(e) { failed++; }
      }
      for (let si = 0; si < u.specials.length; si++) {
        for (let pi = 0; pi < u.specials[si].photos.length; pi++) {
          try { await doWriteOne(u.specials[si].photos[pi], u.name, `특이${si+1}_`); saved++; await sleep(30); }
          catch(e) { failed++; }
        }
      }
    }

    // 2) 불러오기용 JSON 파일 저장 (작업명 기반 파일명)
    const date = document.getElementById('workDate').value || new Date().toISOString().split('T')[0];
    const apt  = document.getElementById('aptName').value || 'site';
    const sessionData = {
      version: 1,
      type: 'aircon-report',  // 식별용
      savedAt: new Date().toISOString(),
      apt, date,
      worker:  document.getElementById('workerName').value || '',
      coName:  document.getElementById('coName')?.value || '',
      coTel:   document.getElementById('coTel')?.value || '',
      coBiz:   document.getElementById('coBiz')?.value || '',
      coDesc:  document.getElementById('coDesc')?.value || '',
      units: units.map(u => ({
        name: u.name,
        beforeCount: u.before.length,
        afterCount: u.after.length,
        specials: u.specials.map(s => ({ desc: s.desc, photoCount: s.photos.length }))
      }))
    };
    try {
      const blob = new Blob([JSON.stringify(sessionData, null, 2)], { type:'application/json' });
      const dateDir = await photoFolderHandle.getDirectoryHandle(date, { create: true });

      // 파일명: 작업명 기준, 기존 호환용 _session.json도 함께 저장
      const safeApt = (apt || 'work').replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
      const fileName = `${safeApt}_${date}.acreport.json`;

      // 메인 파일 (사용자가 선택할 파일)
      const fh = await dateDir.getFileHandle(fileName, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();

      // 호환용 (기존 코드가 찾는 위치)
      const fh2 = await dateDir.getFileHandle('_session.json', { create: true });
      const w2 = await fh2.createWritable();
      await w2.write(blob);
      await w2.close();
    } catch(e) { console.warn('세션 파일 저장 실패:', e); }

    // 3) 자동저장도 함께
    try { await sessionAutoSaveNow(); } catch(e) {}

    hideOverlay();
    if (failed > 0) {
      showToast(`💾 ${saved}장 저장 완료 (${failed}장 실패)`, 'ok');
    } else {
      showToast(`💾 ${saved}장 저장 완료 ✓`, 'ok');
    }
  } catch(e) {
    hideOverlay();
    showToast('저장 실패: ' + e.message, 'err');
  }
}

function openSaveDialog() {
  if(units.length===0){ showToast('저장할 호수가 없습니다','err'); return; }
  const apt=document.getElementById('aptName').value||'';
  const date=document.getElementById('workDate').value||'';
  const suggested=apt&&date?`${apt} (${date})`:(apt||'작업내용');
  const inp=document.getElementById('saveNameInp');
  inp.value=suggested;
  document.getElementById('saveHint').textContent=`제안: "${suggested}"`;
  document.getElementById('saveDlg').classList.add('open');
  setTimeout(()=>{ inp.focus(); inp.select(); },100);
}

function closeSaveDialog() {
  document.getElementById('saveDlg').classList.remove('open');
}

async function doSave() {
  const name=document.getElementById('saveNameInp').value.trim();
  if(!name){ showToast('저장 이름을 입력해주세요','err'); return; }
  closeSaveDialog();
  showOverlay('저장 중...');
  try {
    const saveId='sv_'+Date.now();
    const obj = {
      saveId,
      label:       name,
      apt:         document.getElementById('aptName').value,
      date:        document.getElementById('workDate').value,
      savedAt:     new Date().toISOString(),
      worker:      document.getElementById('workerName').value,
      companyName: document.getElementById('coName').value,
      companyTel:  document.getElementById('coTel').value,
      companyDesc: document.getElementById('coDesc').value,
      units:       JSON.parse(JSON.stringify(units)), // deep copy
      nid
    };
    await dbPut(obj);
    hideOverlay();
    showToast(`"${name}" 저장 완료 ✓`,'ok');
  } catch(e) {
    hideOverlay();
    showToast('저장 실패: '+e.message,'err');
  }
}

/* ═══════════════════════════════
   LOAD LIST
═══════════════════════════════ */
// 불러오기 - 저장 폴더에서 기간별 작업 목록 표시
let _loadDateFrom = null;  // 기간 필터 시작
let _loadDateTo = null;    // 기간 필터 종료

async function openLoadList() {
  // 기본: 최근 30일
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  _loadDateFrom = thirtyDaysAgo.toISOString().split('T')[0];
  _loadDateTo = today.toISOString().split('T')[0];

  document.getElementById('slModal').classList.add('open');
  await renderLoadList();
}

async function renderLoadList() {
  const body = document.getElementById('slBody');
  body.innerHTML = `<div class="sl-empty">⏳ 불러오는 중...</div>`;

  // 폴더 없으면 파일 탐색기로 대체
  if (!photoFolderHandle) {
    body.innerHTML = `
      <div style="padding:14px;text-align:center;">
        <div style="font-size:13px;color:var(--mu);margin-bottom:14px;line-height:1.6;">
          저장 폴더가 설정되지 않았습니다.<br>
          파일 탐색기에서 직접 선택하시거나<br>
          설정에서 저장 폴더를 먼저 선택해주세요.
        </div>
        <button class="btn b-blue" id="btnPickFileFallback" style="width:100%;justify-content:center;margin-bottom:8px;">📂 파일 탐색기로 선택</button>
        <button class="btn b-ghost" id="btnGoSettings" style="width:100%;justify-content:center;">⚙️ 설정에서 폴더 선택</button>
      </div>
    `;
    body.addEventListener('click', e => {
      if (e.target.closest('#btnPickFileFallback')) { openFilePickerFallback(); return; }
      if (e.target.closest('#btnGoSettings'))       {
        document.getElementById('slModal').classList.remove('open');
        if (typeof openSettings === 'function') openSettings();
      }
    });
    return;
  }

  // 권한 확인 (필요 시 자동 요청)
  try {
    const perm = await photoFolderHandle.queryPermission({ mode: 'read' });
    if (perm !== 'granted') {
      const newPerm = await photoFolderHandle.requestPermission({ mode: 'read' });
      if (newPerm !== 'granted') {
        body.innerHTML = `
          <div style="padding:14px;text-align:center;">
            <div style="font-size:13px;color:var(--wn);margin-bottom:14px;">저장 폴더 접근 권한이 거부되었습니다.</div>
            <button class="btn b-blue" id="btnPickFileFallback" style="width:100%;justify-content:center;">📂 파일 탐색기로 선택</button>
          </div>
        `;
        body.addEventListener('click', e => {
          if (e.target.closest('#btnPickFileFallback')) openFilePickerFallback();
        });
        return;
      }
    }
  } catch(e) {
    body.innerHTML = `<div class="sl-empty">폴더 접근 실패: ${e.message}</div>`;
    return;
  }

  // 날짜 폴더들 스캔 (기간 필터 적용)
  const sessions = [];
  try {
    for await (const [name, handle] of photoFolderHandle.entries()) {
      if (handle.kind !== 'directory') continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) continue;

      // 기간 필터
      if (_loadDateFrom && name < _loadDateFrom) continue;
      if (_loadDateTo && name > _loadDateTo) continue;

      try {
        const fh = await handle.getFileHandle('_session.json');
        const file = await fh.getFile();
        const data = JSON.parse(await file.text());
        sessions.push({ name, data, dirHandle: handle });
      } catch(e) { /* _session.json 없으면 스킵 */ }
    }
    sessions.sort((a,b) => new Date(b.data.savedAt) - new Date(a.data.savedAt));
  } catch(e) {
    body.innerHTML = `<div class="sl-empty">폴더 읽기 실패: ${e.message}</div>`;
    return;
  }

  // 날짜 범위 라벨
  const fromLabel = _loadDateFrom || '처음';
  const toLabel = _loadDateTo || '오늘';

  let html = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding:10px 12px;background:var(--sf2);border-radius:8px;">
      <div style="font-size:12px;color:var(--tx);flex:1;line-height:1.4;">
        <div style="font-weight:700;">📅 ${fromLabel} ~ ${toLabel}</div>
        <div style="font-size:11px;color:var(--mu);margin-top:2px;">${sessions.length}개 작업</div>
      </div>
      <button class="btn b-ghost b-xs" id="btnChangeDateRange">🔍 기간 변경</button>
    </div>
  `;

  if (sessions.length === 0) {
    html += `
      <div class="sl-empty" style="padding:30px 14px;">
        <div style="font-size:14px;margin-bottom:8px;">해당 기간에 저장된 작업이 없습니다</div>
        <div style="font-size:11px;color:var(--mu);">🔍 기간 변경 버튼을 눌러 범위를 넓혀보세요</div>
      </div>
    `;
  } else {
    html += sessions.map(s => {
      const d = new Date(s.data.savedAt);
      const ts = d.toLocaleString('ko-KR', { year:'2-digit', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
      const uc = (s.data.units||[]).length;
      const phc = (s.data.units||[]).reduce((a,u)=>a+(u.beforeCount||0)+(u.afterCount||0),0);
      return `<div class="sl-item" data-fload="${s.name}" style="cursor:pointer;border-left:3px solid var(--ac2);">
        <div class="sl-info">
          <div class="sl-name">📁 ${escH(s.data.apt || '작업')} <span style="font-size:11px;color:var(--mu);font-weight:500;">· ${s.data.date || s.name}</span></div>
          <div class="sl-meta">${ts} · ${uc}호수 · 사진 ${phc}장</div>
        </div>
      </div>`;
    }).join('');
  }

  // 하단 파일 탐색기 옵션
  html += `
    <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--bd);">
      <button class="btn b-ghost" id="btnPickFileFallback" style="width:100%;justify-content:center;font-size:12px;">📂 파일 탐색기에서 직접 선택</button>
    </div>
  `;

  body.innerHTML = html;

  // 이벤트
  body.addEventListener('click', async e => {
    const itemEl = e.target.closest('[data-fload]');
    const dateBtn = e.target.closest('#btnChangeDateRange');
    const fileBtn = e.target.closest('#btnPickFileFallback');

    if (itemEl) {
      const target = sessions.find(s => s.name === itemEl.dataset.fload);
      if (target) await loadFromDateFolder(target.dirHandle, target.data);
    } else if (dateBtn) {
      showDateRangeDialog();
    } else if (fileBtn) {
      openFilePickerFallback();
    }
  });
}

// 기간 설정 다이얼로그
function showDateRangeDialog() {
  // 기본값: 지난 3개월
  const today = new Date();
  const threeMonthsAgo = new Date(today);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const fromDefault = _loadDateFrom || threeMonthsAgo.toISOString().split('T')[0];
  const toDefault   = _loadDateTo   || today.toISOString().split('T')[0];

  const body = document.getElementById('slBody');
  body.innerHTML = `
    <div style="padding:14px;">
      <div style="font-size:14px;font-weight:700;color:var(--tx);margin-bottom:14px;">🔍 기간 설정</div>

      <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:16px;">
        <div>
          <label style="font-size:11px;color:var(--mu);font-weight:600;display:block;margin-bottom:4px;">시작 날짜</label>
          <input type="date" id="rangeFrom" value="${fromDefault}" style="width:100%;padding:10px;background:var(--sf2);border:1px solid var(--bd);border-radius:7px;color:var(--tx);font-size:14px;">
        </div>
        <div>
          <label style="font-size:11px;color:var(--mu);font-weight:600;display:block;margin-bottom:4px;">종료 날짜</label>
          <input type="date" id="rangeTo" value="${toDefault}" style="width:100%;padding:10px;background:var(--sf2);border:1px solid var(--bd);border-radius:7px;color:var(--tx);font-size:14px;">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:14px;">
        <button class="btn b-ghost b-xs" data-preset="30">최근 30일</button>
        <button class="btn b-ghost b-xs" data-preset="90">최근 3개월</button>
        <button class="btn b-ghost b-xs" data-preset="365">최근 1년</button>
        <button class="btn b-ghost b-xs" data-preset="all" style="grid-column:span 3;">전체 기간</button>
      </div>

      <div style="display:flex;gap:8px;">
        <button class="btn b-ghost" id="rangeCancel" style="flex:1;justify-content:center;">취소</button>
        <button class="btn b-blue" id="rangeApply" style="flex:1;justify-content:center;">적용</button>
      </div>
    </div>
  `;

  body.addEventListener('click', e => {
    const preset = e.target.closest('[data-preset]');
    if (preset) {
      const type = preset.dataset.preset;
      const now = new Date();
      const fromEl = document.getElementById('rangeFrom');
      const toEl = document.getElementById('rangeTo');
      if (type === 'all') {
        fromEl.value = '2020-01-01';
        toEl.value = now.toISOString().split('T')[0];
      } else {
        const days = parseInt(type);
        const from = new Date(now);
        from.setDate(from.getDate() - days);
        fromEl.value = from.toISOString().split('T')[0];
        toEl.value = now.toISOString().split('T')[0];
      }
      return;
    }

    if (e.target.closest('#rangeCancel')) {
      renderLoadList();
      return;
    }

    if (e.target.closest('#rangeApply')) {
      _loadDateFrom = document.getElementById('rangeFrom').value;
      _loadDateTo   = document.getElementById('rangeTo').value;
      renderLoadList();
      return;
    }
  });
}

// 파일 탐색기 대체 (폴더 권한 없을 때)
function openFilePickerFallback() {
  document.getElementById('slModal').classList.remove('open');
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', async () => {
    if (!input.files || input.files.length === 0) return;
    await loadWorkFromFile(input.files[0]);
  });
  input.click();
}

// 파일에서 작업 불러오기 (파일 탐색기용)
async function loadWorkFromFile(file) {
  try {
    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch(e) {
      showToast('올바른 작업 파일이 아닙니다 (.json)', 'err');
      return;
    }
    if (!data.units) {
      showToast('작업 데이터가 없는 파일입니다', 'err');
      return;
    }

    // 사진 복원용 날짜 폴더 찾기
    let dateDir = null;
    if (photoFolderHandle && data.date) {
      try {
        const perm = await photoFolderHandle.queryPermission({ mode: 'read' });
        if (perm === 'granted' || (await photoFolderHandle.requestPermission({mode:'read'})) === 'granted') {
          dateDir = await photoFolderHandle.getDirectoryHandle(data.date);
        }
      } catch(e) {}
    }

    await restoreFromData(data, dateDir);
  } catch(e) {
    showToast('불러오기 실패: ' + e.message, 'err');
  }
}

// 날짜 폴더에서 작업 복원 (목록에서 선택한 경우)
async function loadFromDateFolder(dateDir, data) {
  await restoreFromData(data, dateDir);
}

// 공통 복원 로직
async function restoreFromData(data, dateDir) {
  const totalPhotos = (data.units||[]).reduce((s,u)=>s+(u.beforeCount||0)+(u.afterCount||0),0);
  let restorePhotos = false;

  let msg = `📋 ${data.apt||'작업'} · ${data.date||''}\n` +
            `${(data.units||[]).length}개 호수, 사진 ${totalPhotos}장\n\n`;

  if (dateDir && totalPhotos > 0) {
    msg += `▶ 확인: 사진까지 모두 복원 (오래 걸림)\n` +
           `▶ 취소: 호수 정보만 복원`;
    restorePhotos = confirm(msg);
  } else if (totalPhotos > 0) {
    msg += `※ 사진 폴더 접근 권한이 없어 호수 정보만 복원됩니다.`;
    if (!confirm(msg + '\n\n계속할까요?')) return;
  } else {
    if (!confirm(msg + '불러올까요?')) return;
  }

  if (units.length > 0 && !confirm('현재 작업이 사라집니다.\n불러올까요?')) return;

  showOverlay('불러오는 중...');

  // 메타 복원
  document.getElementById('aptName').value    = data.apt || '';
  document.getElementById('workDate').value   = data.date || '';
  document.getElementById('workerName').value = data.worker || '';
  if (data.coName) document.getElementById('coName').value = data.coName;
  if (data.coTel)  document.getElementById('coTel').value  = data.coTel;
  if (data.coBiz)  document.getElementById('coBiz').value  = data.coBiz;
  if (data.coDesc) document.getElementById('coDesc').value = data.coDesc;

  units = [];
  nid = 1;

  for (let ui = 0; ui < data.units.length; ui++) {
    const u = data.units[ui];
    const newUnit = {
      id: nid++,
      name: u.name,
      before: [],
      after: [],
      specials: (u.specials||[]).map(s => ({ desc:s.desc||'', photos:[] })),
      open: false
    };

    if (restorePhotos && dateDir) {
      try {
        const workNum = String(ui+1).padStart(2,'0');
        const workDir = await dateDir.getDirectoryHandle(`work${workNum}`);

        for (let i = 1; i <= (u.beforeCount||0); i++) {
          try {
            const pfh = await workDir.getFileHandle(`B_image${String(i).padStart(2,'0')}.jpg`);
            const pf = await pfh.getFile();
            newUnit.before.push({ id: photoId(), dataUrl: await blobToDataURL(pf), savedToFolder:true });
          } catch(e) {}
        }
        for (let i = 1; i <= (u.afterCount||0); i++) {
          try {
            const pfh = await workDir.getFileHandle(`A_image${String(i).padStart(2,'0')}.jpg`);
            const pf = await pfh.getFile();
            newUnit.after.push({ id: photoId(), dataUrl: await blobToDataURL(pf), savedToFolder:true });
          } catch(e) {}
        }
        for (let si = 0; si < newUnit.specials.length; si++) {
          const sp = u.specials[si];
          for (let pi = 1; pi <= (sp.photoCount||0); pi++) {
            try {
              const pfh = await workDir.getFileHandle(`S${si+1}_image${String(pi).padStart(2,'0')}.jpg`);
              const pf = await pfh.getFile();
              newUnit.specials[si].photos.push({ id: photoId(), dataUrl: await blobToDataURL(pf), savedToFolder:true });
            } catch(e) {}
          }
        }
      } catch(e) {}
    }

    units.push(newUnit);
  }

  document.getElementById('slModal').classList.remove('open');
  renderAll();
  updateStats();
  hideOverlay();
  showToast(`✓ ${units.length}호수 불러옴`, 'ok');
}

// 평문 이스케이프
function escPlain(s) {
  return String(s||'').replace(/[<>&"]/g, c => ({'<':'‹','>':'›','&':'＆','"':'"'}[c]));
}

// IndexedDB 저장 목록 (백업용 - 폴더 지원 안 하는 브라우저)
async function openSavedList() {
  document.getElementById('slModal').classList.add('open');
  const body = document.getElementById('slBody');
  body.innerHTML = `<div class="sl-empty">⏳ 불러오는 중...</div>`;
  try {
    const saves = await dbGetAll();
    if (saves.length === 0) {
      body.innerHTML = `<div class="sl-empty">저장된 작업이 없습니다</div>`;
      return;
    }
    body.innerHTML = saves.map(s=>{
      const d=new Date(s.savedAt);
      const ts=d.toLocaleString('ko-KR',{year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
      const uc=(s.units||[]).length;
      const phc=(s.units||[]).reduce((a,u)=>a+u.before.length+u.after.length,0);
      return `<div class="sl-item" data-sid="${s.saveId}">
        <div class="sl-info" data-load="${s.saveId}">
          <div class="sl-name">💾 ${escH(s.label)}</div>
          <div class="sl-meta">${ts} · ${uc}호수 · 사진 ${phc}장</div>
        </div>
        <div class="sl-btns">
          <button class="btn b-blue b-xs" data-load="${s.saveId}">불러오기</button>
          <button class="btn b-red b-xs" data-del="${s.saveId}">삭제</button>
        </div>
      </div>`;
    }).join('');

    body.addEventListener('click', async e => {
      const loadEl = e.target.closest('[data-load]');
      const delEl  = e.target.closest('[data-del]');
      if (loadEl) { await doLoad(loadEl.dataset.load); return; }
      if (delEl)  { await doDelSave(delEl.dataset.del); return; }
    });
  } catch(e) {
    body.innerHTML = `<div class="sl-empty">오류: ${e.message}</div>`;
  }
}

function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

function photoId() {
  return 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

// 폴더에서 세션 목록 읽기
async function doLoad(saveId) {
  if(units.length>0&&!confirm('현재 작업이 사라집니다.\n불러올까요?')) return;
  showOverlay('불러오는 중...');
  try {
    const saves=await dbGetAll();
    const s=saves.find(x=>x.saveId===saveId);
    if(!s) throw new Error('항목을 찾을 수 없습니다');
    units=normalizeUnits(s.units);
    nid=s.nid||units.length+1;
    document.getElementById('aptName').value=s.apt||'';
    document.getElementById('workDate').value=s.date||'';
    document.getElementById('workerName').value=s.worker||'';
    document.getElementById('coName').value=s.companyName||'';
    document.getElementById('coTel').value=s.companyTel||'';
    document.getElementById('coDesc').value=s.companyDesc||'';
    renderAll(); updateStats();
    document.getElementById('slModal').classList.remove('open');
    hideOverlay();
    showToast(`"${s.label}" 불러오기 완료`,'ok');
  } catch(e) {
    hideOverlay(); showToast('불러오기 실패: '+e.message,'err');
  }
}

async function doDelSave(saveId) {
  const saves=await dbGetAll();
  const s=saves.find(x=>x.saveId===saveId);
  if(!s||!confirm(`"${s.label}"\n삭제할까요?`)) return;
  await dbDelete(saveId);
  await openLoadList();
  showToast('삭제됨','ok');
}

/* ═══════════════════════════════
   업체 정보 모달
═══════════════════════════════ */
function openCoModal() {
  updateCoPreview();
  applyCoIcon();
  document.getElementById('coModal').classList.add('open');
  document.getElementById('coName').focus();
}

function closeCoModal() {
  document.getElementById('coModal').classList.remove('open');
}

function saveCoInfo() {
  try {
    const ci = {};
    CO_FIELDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) ci[id] = el.value;
    });
    localStorage.setItem(CO_KEY, JSON.stringify(ci));
    // 아이콘 저장 (이모지 또는 dataURL)
    if (coIconData) {
      localStorage.setItem(CO_ICON_KEY, coIconData);
    } else {
      localStorage.removeItem(CO_ICON_KEY);
    }
    updateCoHdrBtn();
    closeCoModal();
    showToast('업체 정보 저장됨 ✓', 'ok');
    sessionAutoSave();
  } catch(e) {
    if (e.name === 'QuotaExceededError') {
      showToast('이미지가 너무 큽니다. 더 작은 이미지를 사용하세요', 'err');
    } else {
      showToast('저장 실패: ' + e.message, 'err');
    }
  }
}

function updateCoPreview() {
  const name  = (document.getElementById('coName')?.value  || '업체명 미입력').trim();
  const brand = (document.getElementById('coBrand')?.value || '').trim();
  const tel   = (document.getElementById('coTel')?.value   || '').trim();
  const biz   = (document.getElementById('coBiz')?.value   || '').trim();
  const desc  = (document.getElementById('coDesc')?.value  || '').trim();

  const pvName   = document.getElementById('pvName');
  const pvBrand  = document.getElementById('pvBrand');
  const pvSub    = document.getElementById('pvSub');
  const pvDesc   = document.getElementById('pvDesc');
  const pvTel    = document.getElementById('pvTel');
  const pvTelNum = document.getElementById('pvTelNum');

  if (pvName) pvName.textContent = name;

  if (pvBrand) {
    pvBrand.textContent = brand;
    pvBrand.style.display = brand ? 'block' : 'none';
  }

  // 소개글 박스 (있을 때만 표시)
  if (pvDesc) {
    if (desc) {
      pvDesc.innerHTML = '<div style="font-size:8px;color:#80deea;font-weight:700;margin-bottom:4px;">📋 업체 소개</div>' +
                        desc.replace(/\n/g,'<br>').replace(/[<>]/g,c=>({'<':'&lt;','>':'&gt;'}[c]));
      pvDesc.style.display = 'block';
    } else {
      pvDesc.style.display = 'none';
    }
  }

  // 전화번호 박스
  if (pvTel && pvTelNum) {
    if (tel) {
      pvTelNum.textContent = tel;
      pvTel.style.display = 'flex';
    } else {
      pvTel.style.display = 'none';
    }
  }

  // 사업자번호 등 부가
  if (pvSub) {
    pvSub.textContent = biz ? `사업자 ${biz}` : '사업자번호 미입력';
  }
}

// 아이콘 적용 (미리보기 + 모달 활성화 표시)
function applyCoIcon() {
  const previewEl = document.getElementById('coIconPreview');
  const infoEl    = document.getElementById('coIconInfo');
  const clearBtn  = document.getElementById('coIconClear');
  const pvIc      = document.getElementById('pvIc');

  // 모달 미리보기 + 표지 미리보기 둘 다 업데이트
  const renderTo = (el) => {
    if (!el) return;
    el.innerHTML = '';
    if (!coIconData) {
      el.textContent = '❄';
    } else if (coIconData.startsWith('data:')) {
      const img = document.createElement('img');
      img.src = coIconData;
      el.appendChild(img);
    } else {
      el.textContent = coIconData;
    }
  };
  renderTo(previewEl);
  renderTo(pvIc);

  if (infoEl)  infoEl.textContent = !coIconData ? '기본 아이콘' : (coIconData.startsWith('data:') ? '업로드된 이미지' : `이모지 ${coIconData}`);
  if (clearBtn) clearBtn.style.display = coIconData ? 'inline-flex' : 'none';

  // 활성화된 아이콘 버튼 표시
  document.querySelectorAll('.co-icon-pick[data-ic]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.ic === coIconData);
  });
}

function updateCoHdrBtn() {
  const btn  = document.getElementById('btnCoInfo');
  const name = document.getElementById('coName')?.value?.trim();
  if (!btn) return;
  if (name) {
    btn.textContent = `🏢 ${name}`;
    btn.classList.add('set');
  } else {
    btn.textContent = '🏢 업체정보';
    btn.classList.remove('set');
  }
}

