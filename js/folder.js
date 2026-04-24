/* ═══════════════════════════════
   세션 자동저장 (변경시 즉시)
═══════════════════════════════ */
let _autoSaveTimer = null;

function sessionAutoSave() {
  // 변경 후 1.5초 대기 후 저장 (디바운스)
  clearTimeout(_autoSaveTimer);
  showSaveStatus('saving', '저장 중...');
  _autoSaveTimer = setTimeout(() => sessionAutoSaveNow(), 1500);
}

async function sessionAutoSaveNow() {
  clearTimeout(_autoSaveTimer);
  const obj = {
    saveId:      'session_data',
    label:       '[세션]',
    apt:         document.getElementById('aptName').value,
    date:        document.getElementById('workDate').value || new Date().toISOString().split('T')[0],
    savedAt:     new Date().toISOString(),
    worker:      document.getElementById('workerName').value,
    companyName: document.getElementById('coName').value,
    companyTel:  document.getElementById('coTel').value,
    companyDesc: document.getElementById('coDesc').value,
    units:       JSON.parse(JSON.stringify(units)),
    nid,
    // 명시적 플래그: 빈 작업인지 표시
    isEmpty: (units.length === 0)
  };
  // 1차: IndexedDB
  try {
    await dbPut(obj);
    if (units.length > 0) showSaveStatus('saved', '✓ 자동저장됨');
  } catch(e) {
    if (units.length > 0) showSaveStatus('saving', '저장 실패');
  }
  // 2차: localStorage 백업 (사진 dataURL 제외하여 크기 줄임)
  try {
    const backup = {
      ...obj,
      units: obj.units.map(u => ({
        ...u,
        before: u.before.map(p => ({ id: p.id, savedToFolder: p.savedToFolder || false })),
        after:  u.after.map(p => ({ id: p.id, savedToFolder: p.savedToFolder || false })),
        specials: u.specials.map(s => ({ desc: s.desc, photos: s.photos.map(p => ({ id: p.id, savedToFolder: p.savedToFolder || false })) }))
      }))
    };
    localStorage.setItem('ac_session_backup', JSON.stringify(backup));
  } catch(e) {}
}

function showSaveStatus(cls, msg) {
  const el = document.getElementById('saveStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = `save-status ${cls}`;
  if (cls === 'saved') {
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hide'), 3000);
  }
}

/* ═══════════════════════════════
   자동저장 폴더 관리
═══════════════════════════════ */

async function initPhotoFolder() {
  document.getElementById('folderBar').style.display = 'flex';
  document.getElementById('folderBar').style.flexDirection = 'column';

  if (!('showDirectoryPicker' in window)) {
    document.getElementById('folderStatusText').textContent = '⚠️ 폴더 자동저장 미지원 브라우저';
    document.getElementById('folderPathText').textContent = '크롬(Chrome) 브라우저에서 사용해 주세요';
    document.getElementById('btnSetFolder').style.display = 'none';
    return;
  }

  try {
    const handle = await settingsGet('photoFolderHandle');
    if (!handle) {
      updateFolderUI(null);
      return;
    }

    photoFolderHandle = handle;

    // 1단계: 현재 권한 상태 확인
    let perm = 'prompt';
    try {
      perm = await handle.queryPermission({ mode: 'readwrite' });
    } catch(e) { perm = 'prompt'; }

    // 2단계: 이미 granted면 바로 사용 (PWA + 영구권한 케이스)
    if (perm === 'granted') {
      updateFolderUI(handle, 'granted');
      return;
    }

    // 3단계: prompt 상태면 자동 권한 요청 시도
    // (PWA 설치 후 영구권한 있으면 프롬프트 없이 자동 통과됨)
    try {
      const autoPerm = await handle.requestPermission({ mode: 'readwrite' });
      if (autoPerm === 'granted') {
        updateFolderUI(handle, 'granted');
        return;
      }
    } catch(e) {
      // 사용자 제스처 없이 요청하면 에러나는 게 정상 → 수동 복구 안내로 전환
    }

    // 4단계: 자동 실패 → 사용자가 버튼 눌러야 함
    updateFolderUI(handle, 'prompt');
  } catch(e) {
    console.warn('폴더 복원 실패:', e);
    updateFolderUI(null);
  }
}

// 복원된 핸들의 권한을 사용자 제스처와 함께 요청
async function resumeFolderPermission() {
  if (!photoFolderHandle) return;
  try {
    const perm = await photoFolderHandle.requestPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      updateFolderUI(photoFolderHandle, 'granted');
      showToast(`✅ ${photoFolderHandle.name} 폴더 권한 복구 완료`, 'ok');
      // 권한 복구 후 대기 중인 사진 자동 저장 시도
      if (pendingSaves.length > 0) {
        setTimeout(() => flushPendingSaves(), 300);
      }
    } else {
      showToast('권한이 거부되었습니다', 'err');
    }
  } catch(e) {
    if (e.name !== 'AbortError') showToast('권한 요청 실패: ' + e.message, 'err');
  }
}

async function selectPhotoFolder() {
  if (!('showDirectoryPicker' in window)) {
    showToast('이 브라우저는 지원하지 않습니다. 크롬을 사용해 주세요.', 'err');
    return;
  }
  try {
    showToast('저장할 폴더를 선택해주세요', 'ok');
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    photoFolderHandle = handle;
    await settingsPut('photoFolderHandle', handle);
    updateFolderUI(handle, 'granted');
    showToast(`✅ 폴더 설정 완료: ${handle.name}`, 'ok');
  } catch(e) {
    if (e.name !== 'AbortError') showToast('폴더 선택 실패: ' + e.message, 'err');
  }
}

async function clearPhotoFolder() {
  if (!confirm('자동저장 폴더 설정을 해제할까요?')) return;
  photoFolderHandle = null;
  try { await settingsPut('photoFolderHandle', null); } catch(e) {}
  updateFolderUI(null);
  showToast('폴더 설정 해제됨', 'ok');
}

function updateFolderUI(handle, perm) {
  const statusEl   = document.getElementById('folderStatusText');
  const pathEl     = document.getElementById('folderPathText');
  const clearBtn   = document.getElementById('btnClearFolder');
  const setBtn     = document.getElementById('btnSetFolder');
  const resumeBtn  = document.getElementById('btnResumeFolder');
  const resetBtn   = document.getElementById('btnResetSaved');

  if (handle) {
    if (perm === 'granted') {
      statusEl.textContent = `✅ 저장 폴더: ${handle.name}`;
      statusEl.style.color = 'var(--ac2)';
      pathEl.textContent   = `${handle.name}/[날짜]/work01/image01.jpg`;
      clearBtn.style.display = 'inline-flex';
      setBtn.textContent   = '📁 폴더 변경';
      if (resumeBtn) resumeBtn.style.display = 'none';
      if (resetBtn)  resetBtn.style.display  = 'inline-flex';
    } else {
      statusEl.textContent = `🔒 ${handle.name}`;
      statusEl.style.color = 'var(--wn)';
      pathEl.textContent   = '권한 복구가 필요합니다';
      clearBtn.style.display = 'inline-flex';
      setBtn.textContent   = '📁 폴더 변경';
      if (resumeBtn) resumeBtn.style.display = 'inline-flex';
      if (resetBtn)  resetBtn.style.display  = 'none';
    }
  } else {
    statusEl.textContent = '📁 자동저장 폴더 미설정';
    statusEl.style.color = 'var(--mu)';
    pathEl.textContent   = '아래 버튼을 눌러 저장 위치를 설정해주세요';
    clearBtn.style.display = 'none';
    setBtn.textContent   = '📁 폴더 설정';
    if (resumeBtn) resumeBtn.style.display = 'none';
    if (resetBtn)  resetBtn.style.display  = 'none';
  }
}

/* ═══════════════════════════════
   사진 폴더 저장 (버튼용)
═══════════════════════════════ */

// base64 dataURL → Blob  (동기 방식)
function dataURLtoBlob(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') {
    throw new Error('dataUrl이 비어있음');
  }
  const i = dataUrl.indexOf(',');
  if (i < 0) throw new Error('잘못된 dataUrl 형식');

  const meta = dataUrl.slice(0, i);
  const b64  = dataUrl.slice(i + 1);
  const mimeMatch = meta.match(/data:([^;]+)/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';

  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);

  const blob = new Blob([arr], { type: mime });
  if (blob.size === 0) {
    throw new Error(`Blob 생성 실패 — bin len: ${bin.length}, b64 len: ${b64.length}`);
  }
  return blob;
}

// Blob 을 파일에 쓰기 — 가장 단순한 방식 (truncate, getFile 사용 안 함)
// truncate와 getFile은 Android Chrome에서 InvalidStateError를 일으킴
async function writeBlobToFile(fh, blob) {
  if (!blob || blob.size === 0) {
    throw new Error('빈 Blob');
  }

  // 단일 시도 — Blob을 직접 write에 전달 (가장 호환성 높음)
  // ※ truncate() 호출 안 함, getFile() 검증 안 함
  const w = await fh.createWritable();
  try {
    await w.write(blob);
    await w.close();
  } catch(e) {
    // 실패시 abort로 깨끗하게 정리
    try { await w.abort(); } catch(_) {}
    throw e;
  }
}

// ───────── 저장 대기 큐 (사진 ID 기반 중복 방지) ─────────
// 한 사진은 ID로 추적 → 같은 사진은 절대 중복 저장되지 않음
let pendingSaves = [];   // { photo: {id,dataUrl,savedToFolder}, unitName, typeLabel }
let _saveCount = 0;
let _failCount = 0;

// 저장된 사진 ID 추적 (메모리 캐시) — 같은 ID는 다시 저장 안 함
const _savedPhotoIds = new Set();

function updatePendingUI() {
  const bar  = document.getElementById('pendingSaveBar');
  const cnt  = document.getElementById('pendingSaveCount');
  const btn  = document.getElementById('btnFlushNow');
  if (!bar) return;
  if (pendingSaves.length > 0 && photoFolderHandle) {
    bar.style.display = 'block';
    cnt.textContent = pendingSaves.length;
    btn.style.display = 'inline-flex';
  } else {
    bar.style.display = 'none';
    btn.style.display = 'none';
  }
}

// 인덱스 카운터 — 디렉토리 조회 없이 메모리에서만 관리
// 키: "folder/unit/typeLabel" → 다음 인덱스
const _indexCounter = new Map();

async function findNextFileIndex(unitDir, typeLabel) {
  const date = document.getElementById('workDate').value || new Date().toISOString().split('T')[0];
  const apt  = document.getElementById('aptName').value  || '작업';
  const key  = `${date}_${apt}/${unitDir.name}/${typeLabel}`;

  let next;
  if (_indexCounter.has(key)) {
    next = _indexCounter.get(key);
  } else {
    // 처음 호출이면 1부터 시작 (또는 폴더에 이미 있는 파일 개수만큼 건너뜀)
    next = 1;
    // 안전을 위해 최대 100까지만 확인 (있으면 다음 인덱스로)
    while (next < 100) {
      try {
        await unitDir.getFileHandle(`${typeLabel}${next}.jpg`, { create: false });
        next++;
      } catch(e) {
        break; // NotFoundError = 빈 슬롯
      }
    }
  }

  _indexCounter.set(key, next + 1);
  return next;
}

function clearDirIndexCache() {
  _indexCounter.clear();
}

// 동시 쓰기 방지용 순차 처리 락
let _writeLock = Promise.resolve();

// 저장 시도 — Android에서는 즉시 시도하지 않고 큐에만 적재
// (사용자 제스처 컨텍스트 밖에서 쓰기는 InvalidStateError 발생)
async function tryAutoSave(photo, unitName, typeLabel) {
  if (!photoFolderHandle) return;
  if (!photo || !photo.id) return;

  // 이미 저장된 사진이면 스킵
  if (photo.savedToFolder || _savedPhotoIds.has(photo.id)) return;

  // 큐에 이미 같은 ID가 있으면 스킵
  if (pendingSaves.some(p => p.photo.id === photo.id)) return;

  // ★ Android Chrome에서는 자동 시도가 InvalidStateError를 일으킴
  // → 무조건 큐에 적재하고, 사용자가 "지금 저장" 버튼을 눌러야 처리
  pendingSaves.push({ photo, unitName, typeLabel });
  updatePendingUI();
}

// 호수별 번호 매핑 (1호 → work01, 2호 → work02, ...)
// 앱 실행 중 동일 호수는 같은 번호 유지
const _unitWorkNumber = new Map();
function getWorkNumber(unitName) {
  if (!_unitWorkNumber.has(unitName)) {
    _unitWorkNumber.set(unitName, _unitWorkNumber.size + 1);
  }
  return String(_unitWorkNumber.get(unitName)).padStart(2, '0');
}

// 실제 쓰기 (한 장) — 간결한 영문 폴더/파일명
// 구조: [선택폴더]/[YYYY-MM-DD]/workNN/imageNN.jpg
async function doWriteOne(photo, unitName, typeLabel) {
  const date = document.getElementById('workDate').value || new Date().toISOString().split('T')[0];

  let step = 'init';
  try {
    step = 'Blob 변환';
    const blob = dataURLtoBlob(photo.dataUrl);
    if (blob.size === 0) throw new Error('Blob 크기 0');

    // 인덱스 결정 (타입별 카운터)
    step = '인덱스 결정';
    const idxKey = `${date}/${unitName}/${typeLabel}`;
    let idx = _indexCounter.get(idxKey) || 1;
    _indexCounter.set(idxKey, idx + 1);

    // 호수 → workNN 번호
    const workNum = getWorkNumber(unitName);

    // 타입 프리픽스: B=before, A=after, S1=special1, ...
    const typePrefix = typeLabel === '전' ? 'B'
                     : typeLabel === '후' ? 'A'
                     : typeLabel.replace(/^특이(\d+)_?$/, 'S$1').replace(/[^A-Za-z0-9]/g, '');

    // 폴더 구조: [루트] / [날짜] / workNN / [타입]imageNN.jpg
    step = '날짜폴더';
    const dateDir = await photoFolderHandle.getDirectoryHandle(date, { create: true });

    step = '작업폴더';
    const workDir = await dateDir.getDirectoryHandle(`work${workNum}`, { create: true });

    step = '파일핸들';
    const fname = `${typePrefix}_image${String(idx).padStart(2, '0')}.jpg`;
    const fh = await workDir.getFileHandle(fname, { create: true });

    step = 'createWritable';
    const w = await fh.createWritable();

    step = 'write';
    await w.write(blob);

    step = 'close';
    await w.close();

  } catch(e) {
    throw new Error(`[${step}] ${e.name||'Error'}: ${e.message}`);
  }
}

// 한글/유니코드 문자를 ASCII로 안전 변환
function toShortHash(str) {
  if (!str) return 'x';
  const ascii = str.replace(/[^A-Za-z0-9]/g, '');
  const hasNonAscii = /[^\x00-\x7F]/.test(str);
  if (!hasNonAscii && ascii.length > 0) {
    return ascii.substring(0, 20);
  }
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  const h = Math.abs(hash).toString(36);
  return ascii ? `${ascii.substring(0, 10)}${h}` : `u${h}`;
}

// 사용자가 "지금 저장" 버튼 클릭 시 호출 — 사용자 제스처 컨텍스트
async function flushPendingSaves() {
  if (pendingSaves.length === 0) return;
  if (!photoFolderHandle) { showToast('폴더가 설정되지 않았습니다', 'err'); return; }

  // ★ 핵심: 이미 granted면 requestPermission 건너뛰기 (제스처 보존)
  let permOk = false;
  try {
    const curPerm = await photoFolderHandle.queryPermission({ mode: 'readwrite' });
    if (curPerm === 'granted') {
      permOk = true;
    } else {
      // 권한 없을 때만 요청 (이 경우 다음 번엔 queryPermission만 쓰게 됨)
      const newPerm = await photoFolderHandle.requestPermission({ mode: 'readwrite' });
      permOk = (newPerm === 'granted');
    }
  } catch(e) {
    showToast('📁 권한 확인 실패: ' + e.message, 'err');
    return;
  }

  if (!permOk) {
    showToast('📁 폴더 권한이 거부됐습니다', 'err');
    return;
  }
  updateFolderUI(photoFolderHandle, 'granted');

  showOverlay('저장 중...');
  const total = pendingSaves.length;
  let ok = 0, fail = 0, skipped = 0;
  const remaining = [];
  const errorMessages = [];
  let firstErrorIsInvalidState = false;

  for (let i = 0; i < pendingSaves.length; i++) {
    const item = pendingSaves[i];
    setProg((i / total) * 100, `${i+1} / ${total} 저장 중`);

    if (item.photo.savedToFolder || _savedPhotoIds.has(item.photo.id)) {
      skipped++;
      continue;
    }

    // 최대 3번 재시도
    let success = false;
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await doWriteOne(item.photo, item.unitName, item.typeLabel);
        item.photo.savedToFolder = true;
        _savedPhotoIds.add(item.photo.id);
        ok++;
        success = true;
        break;
      } catch(e) {
        lastErr = e;
        await sleep(100 + attempt * 200);  // 재시도 전 대기
      }
    }

    if (!success) {
      console.warn('flush 실패:', lastErr.name, lastErr.message, item);
      fail++;
      remaining.push(item);
      errorMessages.push(`[${item.unitName} ${item.typeLabel}] ${lastErr.name||'Error'}: ${lastErr.message}`);
      if (lastErr.name === 'InvalidStateError') firstErrorIsInvalidState = true;
    }

    await sleep(50);  // ★ 각 저장 사이 쿨다운
  }

  pendingSaves = remaining;
  sessionAutoSave();
  hideOverlay();
  updatePendingUI();

  if (fail > 0) {
    // InvalidStateError면 폴더 핸들 캐시 문제 → 폴더 다시 선택 안내
    if (firstErrorIsInvalidState) {
      showDebugPanel(
        `⚠️ ${ok}장 성공, ${fail}장 실패\n\n` +
        `🔍 원인: Android Chrome의 폴더 핸들 캐시 문제\n\n` +
        `✅ 해결법:\n` +
        `1. "📁 폴더 변경" 버튼을 누르세요\n` +
        `2. 같은 폴더(작업사진)를 다시 선택하세요\n` +
        `3. "💾 지금 저장" 버튼을 다시 누르세요\n\n` +
        `(앱을 새로 열거나 페이지를 새로고침해도 같은 효과)\n\n` +
        `── 상세 에러 ──\n` + errorMessages.join('\n\n')
      );
    } else {
      showDebugPanel(`⚠️ ${ok}장 성공, ${fail}장 실패\n\n` + errorMessages.join('\n\n'));
    }
  } else {
    let msg = `✅ ${ok}장 저장 완료`;
    if (skipped > 0) msg += ` (${skipped}장 이미 저장됨)`;
    showToast(msg, 'ok');
  }
}

// 화면에 디버그 메시지를 영구 표시 (탭하면 닫힘)
function showDebugPanel(text) {
  let panel = document.getElementById('debugPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'debugPanel';
    panel.style.cssText = `
      position:fixed;top:80px;left:10px;right:10px;z-index:9999;
      background:#fff;border:2px solid var(--dn);border-radius:10px;
      padding:14px 16px;box-shadow:0 8px 32px rgba(0,0,0,0.3);
      max-height:60vh;overflow-y:auto;cursor:pointer;
      font-size:12px;line-height:1.6;color:#333;font-family:monospace;
      white-space:pre-wrap;word-break:break-word;
    `;
    panel.addEventListener('click', () => panel.remove());
    document.body.appendChild(panel);
  }
  panel.textContent = '🔴 디버그 정보 (탭하면 닫힘)\n\n' + text;
}

// 큐잉 함수 (업로드 핸들러에서 호출)
function enqueueAutoSave(photo, unitName, typeLabel) {
  return tryAutoSave(photo, unitName, typeLabel);
}

// 저장됨 상태 초기화 — 모든 사진의 "저장됨" 표시를 지우고 재저장할 수 있게
function resetSavedState() {
  if (!confirm('모든 사진의 "저장됨" 표시를 초기화할까요?\n\n그 후 "모든사진저장"을 누르면 전체를 다시 저장합니다.')) return;

  let count = 0;
  for (const u of units) {
    for (const p of u.before) {
      if (typeof p === 'object' && p.savedToFolder) { p.savedToFolder = false; count++; }
    }
    for (const p of u.after) {
      if (typeof p === 'object' && p.savedToFolder) { p.savedToFolder = false; count++; }
    }
    for (const sp of u.specials) {
      for (const p of sp.photos) {
        if (typeof p === 'object' && p.savedToFolder) { p.savedToFolder = false; count++; }
      }
    }
  }
  _savedPhotoIds.clear();
  sessionAutoSave();
  renderAll();
  showToast(`↻ ${count}장의 저장 표시를 초기화했습니다`, 'ok');
}

// 진단 테스트 — 환경에서 어떤 쓰기 방식이 동작하는지 확인
async function diagnoseWriteTest() {
  if (!photoFolderHandle) {
    showToast('먼저 폴더를 설정해주세요', 'err');
    return;
  }

  const results = [];

  // 권한 요청
  try {
    const perm = await photoFolderHandle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      showDebugPanel('권한 거부됨');
      return;
    }
  } catch(e) {
    showDebugPanel('권한 에러: ' + e.message);
    return;
  }

  // 테스트 데이터: 짧은 텍스트
  const testText = 'Hello from aircon-report diagnostic test. ' + new Date().toISOString();
  const testBlob = new Blob([testText], { type: 'text/plain' });

  // ── 테스트 1: 텍스트 파일 쓰기 (Blob) ──
  try {
    const fh = await photoFolderHandle.getFileHandle('_test1_blob.txt', { create: true });
    const w  = await fh.createWritable();
    await w.write(testBlob);
    await w.close();
    const f = await fh.getFile();
    results.push(`✅ 테스트1 (text Blob): ${f.size}바이트`);
  } catch(e) {
    results.push(`❌ 테스트1: [${e.name}] ${e.message}`);
  }

  // ── 테스트 6: 실제 사진 크기 더미 Blob (400KB) ──
  try {
    // 400KB 더미 데이터 생성
    const size = 400 * 1024;
    const bigArr = new Uint8Array(size);
    for (let i = 0; i < size; i++) bigArr[i] = i & 0xFF;
    const bigBlob = new Blob([bigArr], { type: 'image/jpeg' });

    const fh = await photoFolderHandle.getFileHandle('_test6_400KB.bin', { create: true });
    const w  = await fh.createWritable();
    await w.write(bigBlob);
    await w.close();
    const f = await fh.getFile();
    results.push(`📦 테스트6 (더미 400KB): ${f.size}바이트`);
  } catch(e) {
    results.push(`❌ 테스트6: [${e.name}] ${e.message}`);
  }

  // ── 테스트 7: 실제 업로드된 첫 사진을 저장 ──
  try {
    const firstPhoto = units[0]?.before[0];
    if (firstPhoto) {
      const dataUrl = photoUrl(firstPhoto);
      const blob = dataURLtoBlob(dataUrl);
      const fh = await photoFolderHandle.getFileHandle('_test7_realphoto.jpg', { create: true });
      const w  = await fh.createWritable();
      await w.write(blob);
      await w.close();
      const f = await fh.getFile();
      results.push(`📷 테스트7 (실제 사진 ${Math.round(blob.size/1024)}KB): ${f.size}바이트 저장됨`);
    } else {
      results.push(`⚠️ 테스트7: 저장할 사진 없음 (1호 작업전에 사진 추가 후 다시 시도)`);
    }
  } catch(e) {
    results.push(`❌ 테스트7: [${e.name}] ${e.message}`);
  }

  // ── 테스트 8: 연속 5장 저장 (실제 사진으로) ──
  try {
    const firstPhoto = units[0]?.before[0];
    if (firstPhoto) {
      const dataUrl = photoUrl(firstPhoto);
      const blob = dataURLtoBlob(dataUrl);
      let okCount = 0;
      let errMsg = '';
      for (let i = 0; i < 5; i++) {
        try {
          const fh = await photoFolderHandle.getFileHandle(`_test8_seq${i+1}.jpg`, { create: true });
          const w  = await fh.createWritable();
          await w.write(blob);
          await w.close();
          const f = await fh.getFile();
          if (f.size > 0) okCount++;
          else { errMsg = `${i+1}번째 0바이트`; break; }
        } catch(e) {
          errMsg = `${i+1}번째 실패: [${e.name}] ${e.message}`;
          break;
        }
      }
      results.push(`🔁 테스트8 (연속 5장): ${okCount}/5 성공${errMsg?' — '+errMsg:''}`);
    }
  } catch(e) {
    results.push(`❌ 테스트8: [${e.name}] ${e.message}`);
  }

  // ── 테스트 9: 연속 5장 저장 + 각각 50ms 쿨다운 ──
  try {
    const firstPhoto = units[0]?.before[0];
    if (firstPhoto) {
      const dataUrl = photoUrl(firstPhoto);
      const blob = dataURLtoBlob(dataUrl);
      let okCount = 0;
      let errMsg = '';
      for (let i = 0; i < 5; i++) {
        try {
          const fh = await photoFolderHandle.getFileHandle(`_test9_cool${i+1}.jpg`, { create: true });
          const w  = await fh.createWritable();
          await w.write(blob);
          await w.close();
          const f = await fh.getFile();
          if (f.size > 0) okCount++;
          else { errMsg = `${i+1}번째 0바이트`; break; }
          await sleep(200);  // 200ms 쿨다운
        } catch(e) {
          errMsg = `${i+1}번째 실패: [${e.name}] ${e.message}`;
          break;
        }
      }
      results.push(`❄️ 테스트9 (200ms 쿨다운 5장): ${okCount}/5 성공${errMsg?' — '+errMsg:''}`);
    }
  } catch(e) {
    results.push(`❌ 테스트9: [${e.name}] ${e.message}`);
  }

  // ── 테스트 10: 실제 doWriteOne 함수를 직접 호출 (3번 반복) ──
  try {
    const firstPhoto = units[0]?.before[0];
    if (firstPhoto) {
      for (let i = 1; i <= 3; i++) {
        try {
          await doWriteOne(firstPhoto, units[0].name, '전');
          results.push(`🎯 테스트10-${i} (doWriteOne): 성공`);
        } catch(e) {
          results.push(`❌ 테스트10-${i} (doWriteOne): ${e.message}`);
        }
        await sleep(100);
      }
    } else {
      results.push(`⚠️ 테스트10: 사진 없음`);
    }
  } catch(e) {
    results.push(`❌ 테스트10: ${e.message}`);
  }

  // ── 테스트 11: 실제 파일명으로 저장 (doWriteOne 내부와 동일 방식) ──
  try {
    const firstPhoto = units[0]?.before[0];
    if (firstPhoto) {
      const date    = document.getElementById('workDate').value || new Date().toISOString().split('T')[0];
      const apt     = document.getElementById('aptName').value  || '작업';
      const safe    = units[0].name.replace(/[\/\\:*?"<>|]/g, '_');
      const aptSafe = apt.replace(/[\/\\:*?"<>|]/g, '_');
      const fname   = `${date}_${aptSafe}_${safe}_전1.jpg`;

      const blob = dataURLtoBlob(firstPhoto.dataUrl);
      const fh = await photoFolderHandle.getFileHandle(fname, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      results.push(`🎯 테스트11 (실제파일명 직접): 성공 "${fname}"`);
    }
  } catch(e) {
    results.push(`❌ 테스트11: [${e.name}] ${e.message}`);
  }

  showDebugPanel(
    '🔍 진단 테스트 결과\n\n' +
    results.join('\n\n') +
    '\n\n─────────\n' +
    `브라우저: ${navigator.userAgent.substring(0,80)}\n` +
    '→ 폴더에서 _test1~9 파일들이 모두 제대로 생겼는지 확인해주세요'
  );
}
async function saveSinglePhoto(photo, unitName, typeLabel, index) {
  // 폴더 미설정 시 → 브라우저 다운로드 방식으로 폴백
  if (!photoFolderHandle) {
    const url = photoUrl(photo);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${unitName}_${typeLabel}${index}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('📥 다운로드 폴더에 저장됐습니다', 'ok');
    return;
  }

  // 폴더 설정되어 있으면 폴더로 저장 (이미 granted면 requestPermission 생략)
  let permOk = false;
  try {
    const curPerm = await photoFolderHandle.queryPermission({ mode: 'readwrite' });
    if (curPerm === 'granted') {
      permOk = true;
    } else {
      const newPerm = await photoFolderHandle.requestPermission({ mode: 'readwrite' });
      permOk = (newPerm === 'granted');
    }
  } catch(e) {
    showToast('권한 확인 실패', 'err');
    return;
  }

  if (!permOk) {
    showToast('📁 폴더 권한이 거부됐습니다', 'err');
    return;
  }

  try {
    await doWriteOne(photo, unitName, typeLabel);
    if (typeof photo === 'object') {
      photo.savedToFolder = true;
      _savedPhotoIds.add(photo.id);
    }
    renderAll();
    sessionAutoSave();
    showToast('✅ 폴더에 저장 완료', 'ok');
  } catch(e) {
    console.warn('개별 저장 실패:', e);
    showToast(`저장 실패: ${e.message}`, 'err');
  }
}

// (구버전 호환용) 기존 코드에서 호출되는 함수명 유지
async function autoSavePhotoToFolder(dataUrl, unitName, typeLabel, index) {
  // dataUrl이 string이면 임시 객체로 감쌈
  if (typeof dataUrl === 'string') {
    return tryAutoSave(makePhoto(dataUrl), unitName, typeLabel);
  }
  return tryAutoSave(dataUrl, unitName, typeLabel);
}

async function savePhotosToFolder() {
  const totalPhotos = units.reduce((s, u) =>
    s + u.before.length + u.after.length +
    u.specials.reduce((a, sp) => a + sp.photos.length, 0), 0);

  if (totalPhotos === 0) { showToast('저장할 사진이 없습니다', 'err'); return; }
  if (!photoFolderHandle) { showToast('먼저 폴더를 설정해주세요', 'err'); return; }

  // ★ 이미 granted면 requestPermission 생략 (제스처 보존)
  let permOk = false;
  try {
    const curPerm = await photoFolderHandle.queryPermission({ mode: 'readwrite' });
    if (curPerm === 'granted') {
      permOk = true;
    } else {
      const newPerm = await photoFolderHandle.requestPermission({ mode: 'readwrite' });
      permOk = (newPerm === 'granted');
    }
  } catch(e) { showToast('권한 확인 실패: ' + e.message, 'err'); return; }

  if (!permOk) { showToast('📁 폴더 권한이 거부됐습니다', 'err'); return; }
  updateFolderUI(photoFolderHandle, 'granted');

  // 이미 저장됐다고 표시된 사진 개수 확인
  const alreadyMarked = units.reduce((s, u) => {
    const count = [...u.before, ...u.after, ...u.specials.flatMap(sp => sp.photos)]
      .filter(p => typeof p === 'object' && p.savedToFolder).length;
    return s + count;
  }, 0);

  // 이미 저장됨으로 표시된 게 있으면 재저장 여부 묻기
  let forceResave = false;
  if (alreadyMarked > 0) {
    forceResave = confirm(
      `💡 ${alreadyMarked}장이 "이미 저장됨"으로 표시되어 있습니다.\n\n` +
      `확인: 모든 사진을 다시 저장 (파일이 0바이트이거나 깨졌을 경우)\n` +
      `취소: 새로 추가된 사진만 저장`
    );
  }

  const date = document.getElementById('workDate').value || new Date().toISOString().split('T')[0];
  const apt  = document.getElementById('aptName').value || '작업';
  const aptSafe = apt.replace(/[\/\\:*?"<>|]/g, '_');

  showOverlay('사진 저장 중...');
  let saved = 0, skipped = 0;
  const errors = [];

  // 사진 1장 저장 헬퍼
  async function savePhoto(p, unitName, typeLabel, idx) {
    // forceResave가 아닐 때만 스킵 체크
    if (!forceResave && typeof p === 'object' && (p.savedToFolder || _savedPhotoIds.has(p.id))) {
      skipped++;
      return;
    }
    // 영문 폴더/파일명
    const workNum = getWorkNumber(unitName);
    const typePrefix = typeLabel === '전' ? 'B'
                     : typeLabel === '후' ? 'A'
                     : typeLabel.replace(/^특이(\d+)_?$/, 'S$1').replace(/[^A-Za-z0-9]/g, '');
    const fname = `${typePrefix}_image${String(idx).padStart(2, '0')}.jpg`;

    // 최대 3번 재시도
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const blob = dataURLtoBlob(photoUrl(p));
        if (blob.size === 0) throw new Error('Blob 크기 0');

        // 폴더 구조: [루트] / [날짜] / workNN / 파일명
        const dateDir = await photoFolderHandle.getDirectoryHandle(date, { create: true });
        const workDir = await dateDir.getDirectoryHandle(`work${workNum}`, { create: true });

        const fh = await workDir.getFileHandle(fname, { create: true });
        const w  = await fh.createWritable();
        await w.write(blob);
        await w.close();

        if (typeof p === 'object') {
          p.savedToFolder = true;
          _savedPhotoIds.add(p.id);
        }
        saved++;
        return;
      } catch(e) {
        lastErr = e;
        await sleep(100 + attempt * 200);
      }
    }
    throw lastErr;
  }

  try {
    for (const u of units) {
      for (let i = 0; i < u.before.length; i++) {
        setProg(((saved+skipped) / totalPhotos) * 100, `${saved+skipped+1} / ${totalPhotos}`);
        try { await savePhoto(u.before[i], u.name, '전', i+1); }
        catch(e) { errors.push(`${u.name} 전${i+1}: ${e.message}`); }
        await sleep(50);
      }
      for (let i = 0; i < u.after.length; i++) {
        setProg(((saved+skipped) / totalPhotos) * 100, `${saved+skipped+1} / ${totalPhotos}`);
        try { await savePhoto(u.after[i], u.name, '후', i+1); }
        catch(e) { errors.push(`${u.name} 후${i+1}: ${e.message}`); }
        await sleep(50);
      }
      for (let si = 0; si < u.specials.length; si++) {
        for (let pi = 0; pi < u.specials[si].photos.length; pi++) {
          setProg(((saved+skipped) / totalPhotos) * 100, `${saved+skipped+1} / ${totalPhotos}`);
          try { await savePhoto(u.specials[si].photos[pi], u.name, `특이${si+1}_`, pi+1); }
          catch(e) { errors.push(`${u.name} 특이${si+1}_${pi+1}: ${e.message}`); }
          await sleep(50);
        }
      }
    }

    // 매핑 정보 파일 저장 (work01 = 어느 호수인지)
    try {
      const lines = [
        `에어컨 청소 작업 사진 — ${new Date().toLocaleString('ko-KR')}`,
        `날짜: ${date}`,
        `아파트명: ${apt}`,
        `담당자: ${document.getElementById('workerName').value || ''}`,
        '',
        '── 폴더 구조 ──',
        `${date}/workNN/[B/A/S]_imageNN.jpg`,
        'B = 작업전 (Before)',
        'A = 작업후 (After)',
        'S1, S2... = 특이사항',
        '',
        '── 호수 매핑 ──',
      ];
      for (const u of units) {
        const num = getWorkNumber(u.name);
        lines.push(`work${num} = ${u.name}  (전 ${u.before.length}장 · 후 ${u.after.length}장 · 특이 ${u.specials.length}건)`);
      }
      const infoBlob = new Blob([lines.join('\n')], { type: 'text/plain; charset=utf-8' });
      const dateDir = await photoFolderHandle.getDirectoryHandle(date, { create: true });
      const infoFh = await dateDir.getFileHandle('_info.txt', { create: true });
      const infoW = await infoFh.createWritable();
      await infoW.write(infoBlob);
      await infoW.close();
    } catch(e) {
      console.warn('정보 파일 저장 실패:', e);
    }

    sessionAutoSave();
    hideOverlay();
    renderAll();
    if (errors.length > 0) {
      showDebugPanel(`✅ ${saved}장 저장 완료, ⚠️ ${errors.length}장 실패\n\n첫 에러:\n` + errors.slice(0,3).join('\n'));
    } else if (skipped > 0) {
      showToast(`✅ ${saved}장 저장 (${skipped}장 이미 저장됨)`, 'ok');
    } else {
      showToast(`✅ ${saved}장 저장 완료`, 'ok');
    }
  } catch(e) {
    hideOverlay();
    if (e.name !== 'AbortError') showToast('저장 실패: ' + e.message, 'err');
  }
}

/* UTILS */
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function escH(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function showImg(src){document.getElementById('modalImg').src=src;document.getElementById('imgModal').classList.add('open');}
function showOverlay(t){document.getElementById('ovTitle').textContent=t;document.getElementById('progFl').style.width='0%';document.getElementById('progLb').textContent='';document.getElementById('overlay').classList.add('show');}
function setProg(p,l){document.getElementById('progFl').style.width=p+'%';document.getElementById('progLb').textContent=l;}
function hideOverlay(){document.getElementById('overlay').classList.remove('show');}
function showToast(msg,type=''){const t=document.getElementById('toast');t.textContent=msg;t.className=`toast show ${type}`;clearTimeout(t._t);t._t=setTimeout(()=>t.className='toast',3500);}

