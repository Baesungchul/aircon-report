/* ═══════════════════════════════
   SAVE DIALOG
═══════════════════════════════ */

// 변경 추적: 마지막 저장 후 변경 사항이 있는지
let _dataDirty = true;  // 처음엔 dirty (한 번은 저장 필요)
let _lastSaveSnapshot = '';  // 마지막 저장 시점의 데이터 스냅샷

// ★ 썸네일 백그라운드 생성 큐 (불러오기 시 썸네일 없는 사진 등록 → 백그라운드로 생성)
const _pendingThumbGen = [];
let _thumbGenInProgress = false;

async function processPendingThumbGen() {
  if (_thumbGenInProgress || _pendingThumbGen.length === 0) return;
  if (typeof createThumbnailBlob !== 'function') return;
  _thumbGenInProgress = true;

  // 일감 복사 후 큐 비우기 (다시 추가될 수 있도록)
  const tasks = _pendingThumbGen.splice(0);

  for (const t of tasks) {
    try {
      const { workDir, fh } = t;
      let thumbsDir = t.thumbsDir;
      if (!thumbsDir) {
        try { thumbsDir = await workDir.getDirectoryHandle('_thumbs', { create: true }); } catch(e) { continue; }
      }
      // 이미 썸네일 있으면 스킵
      try {
        await thumbsDir.getFileHandle(fh.name);
        continue;
      } catch(e) { /* 없으니 생성 */ }

      const origFile = await fh.getFile();
      const thumbBlob = await createThumbnailBlob(origFile);
      const tfh = await thumbsDir.getFileHandle(fh.name, { create: true });
      const w = await tfh.createWritable();
      await w.write(thumbBlob);
      await w.close();
    } catch(e) {
      // 개별 실패는 무시 (다음 일감 진행)
    }
    // CPU 부하 분산: 다음 일감 전에 잠깐 양보
    await new Promise(r => setTimeout(r, 30));
  }

  _thumbGenInProgress = false;
  // 그동안 또 추가됐으면 재귀
  if (_pendingThumbGen.length > 0) processPendingThumbGen();
}
window.processPendingThumbGen = processPendingThumbGen;

// 데이터 변경 시 호출 (외부에서 사용)
function markDataDirty() {
  _dataDirty = true;
}
window.markDataDirty = markDataDirty;

// 현재 데이터의 빠른 스냅샷 (변경 비교용 - 사진 ID + 호수명 + 특이사항)
function quickSnapshot() {
  try {
    const apt = document.getElementById('aptName')?.value || '';
    const date = document.getElementById('workDate')?.value || '';
    const worker = document.getElementById('workerName')?.value || '';
    const wt = currentWorkType || 'household';
    const fc = (wt === 'facility' && facilityCustomer)
      ? `${facilityCustomer.phone||''}|${facilityCustomer.contact||''}|${facilityCustomer.address||''}|${facilityCustomer.memo||''}`
      : '';
    const unitsKey = (units || []).map(u => {
      const bIds = (u.before || []).map(p => p.id || p.name || '').join('|');
      const aIds = (u.after || []).map(p => p.id || p.name || '').join('|');
      const sp = (u.specials || []).map(s => (s.desc||'') + ':' + (s.photos||[]).length).join(';');
      const cust = u.customer ? `${u.customer.phone||''}|${u.customer.address||''}|${u.customer.memo||''}` : '';
      return `${u.name||''}::${bIds}::${aIds}::${sp}::${cust}`;
    }).join('@@');
    return `${apt}|${date}|${worker}|${wt}|${fc}|${unitsKey}`;
  } catch(e) {
    console.warn('[quickSnapshot] 실패:', e.message);
    return '';  // 빈 문자열 → "변경 없음"으로 처리
  }
}

// 저장 버튼 메인 핸들러 - 상황에 맞게 자동 분기
async function handleSaveClick() {
  if (units.length === 0) {
    showToast('저장할 호수가 없습니다', 'err');
    return;
  }

  // ★ 즉시 피드백 - 사용자가 저장 클릭 시 바로 알림
  showToast('💾 저장 중...', 'ok');

  // 폴더가 설정되어 있으면 → 폴더 저장 (사진 + 세션)
  if (photoFolderHandle) {
    await saveToFolder();
    return;
  }

  // 폴더 미설정 → IndexedDB 저장 (이름 입력)
  openSaveDialog();
}

// 폴더 저장 - 사진 + 세션 정보를 한번에
async function saveToFolder(opts) {
  opts = opts || {};
  const isAutoSave = opts.auto === true;
  const isForced = opts.force === true;
  const isSilent = opts.silent === true;  // ★ 오버레이/토스트 없이 조용히 저장

  // ★ 변경 없으면 스킵 (수동/자동 모두, force 아닐 때)
  if (!isForced) {
    const currentSnap = quickSnapshot();
    if (!_dataDirty && currentSnap === _lastSaveSnapshot) {
      console.log('✓ 변경 없음 - 저장 스킵');
      if (!isAutoSave) showToast('✓ 이미 저장됨', 'ok');
      return { skipped: true, reason: 'no_changes' };
    }
  }

  // ★ _workNum 등록
  units.forEach(u => {
    if (u._workNum && !_unitWorkNumber.has(u.name)) {
      _unitWorkNumber.set(u.name, u._workNum);
    }
  });

  // ★ 권한 확인 (오버레이 전에)
  let permOk = false;
  try {
    const permResult = await Promise.race([
      photoFolderHandle.requestPermission({ mode: 'readwrite' }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('권한 요청 시간 초과 (10초)')), 10000)
      )
    ]);
    permOk = (permResult === 'granted');
  } catch(e) {
    showToast('⚠️ 폴더 권한 오류: ' + e.message, 'err');
    return;
  }
  if (!permOk) {
    showToast('폴더 쓰기 권한이 거부되었습니다', 'err');
    return;
  }

  if (!isSilent) {
    // 수동 저장도 오버레이 없이 진행 (사용자 차단 없음)
    // 완료/실패 시 토스트로만 알림
  }
  const _saveTimeout = null;  // 타임아웃 불필요 (오버레이 없음)

  let saved = 0;
  let skippedPhotos = 0;
  let failed = 0;
  let sessionFileSaved = false;

  if (typeof _indexCounter !== 'undefined' && _indexCounter.clear) _indexCounter.clear();
  if (typeof _savedPhotoIds !== 'undefined' && _savedPhotoIds.clear) _savedPhotoIds.clear();
  if (typeof clearDirHandleCache === 'function') clearDirHandleCache();

  const date = document.getElementById('workDate').value || getLocalDateStr();
  const apt  = document.getElementById('aptName').value || 'site';

  function normalizeAptName(s) {
    if (!s) return '';
    return String(s).normalize('NFC')
      .replace(/[\u200B-\u200F\uFEFF]/g, '')
      .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  const currentApt = normalizeAptName(apt);

  // ★ 폴더명 결정 - 단순하고 명확
  // - 불러온 작업 (currentFolderName 있음): 그 폴더에만 덮어쓰기
  // - 새 작업 (currentFolderName = null): 날짜+시간 새 폴더 생성 (충돌 없음)
  let dateFolderName;

  if (currentFolderName) {
    // ★ 불러온 작업 → 기존 폴더 덮어쓰기
    dateFolderName = currentFolderName;
    console.log(`📁 기존 폴더 덮어쓰기: ${dateFolderName}`);

    // 불필요한 파일 정리
    try {
      const oldDir = await photoFolderHandle.getDirectoryHandle(dateFolderName);
      const expectedFiles = new Set();
      const protectedWorkDirs = new Set();
      units.forEach(u => {
        const workNum = String(u._workNum || getWorkNumber(u.name)).padStart(2,'0');
        const workKey = `work${workNum}`;
        if (u._photosOnDisk?.skipPhotoSync) {
          protectedWorkDirs.add(workKey);
          for (let i = 1; i <= u._photosOnDisk.before; i++)
            expectedFiles.add(`${workKey}/A_image${String(i).padStart(2,'0')}.jpg`);
          for (let i = 1; i <= u._photosOnDisk.after; i++)
            expectedFiles.add(`${workKey}/B_image${String(i).padStart(2,'0')}.jpg`);
          (u._photosOnDisk.specials || []).forEach((cnt, si) => {
            for (let i = 1; i <= cnt; i++)
              expectedFiles.add(`${workKey}/S${si+1}_image${String(i).padStart(2,'0')}.jpg`);
          });
          return;
        }
        for (let i = 1; i <= u.before.length; i++)
          expectedFiles.add(`${workKey}/A_image${String(i).padStart(2,'0')}.jpg`);
        for (let i = 1; i <= u.after.length; i++)
          expectedFiles.add(`${workKey}/B_image${String(i).padStart(2,'0')}.jpg`);
        u.specials.forEach((sp, si) => {
          for (let i = 1; i <= sp.photos.length; i++)
            expectedFiles.add(`${workKey}/S${si+1}_image${String(i).padStart(2,'0')}.jpg`);
        });
      });
      let deletedCount = 0;
      for await (const [workName, workHandle] of oldDir.entries()) {
        if (workHandle.kind !== 'directory' || !/^work\d+/.test(workName)) continue;
        if (protectedWorkDirs.has(workName)) continue;
        const filesToCheck = [];
        for await (const [fn, fh] of workHandle.entries()) {
          if (fh.kind === 'file') filesToCheck.push(fn);
        }
        for (const fn of filesToCheck) {
          if (!expectedFiles.has(`${workName}/${fn}`)) {
            try { await workHandle.removeEntry(fn); deletedCount++; } catch(e) {}
          }
        }
        let isEmpty = true;
        for await (const _ of workHandle.entries()) { isEmpty = false; break; }
        if (isEmpty) { try { await oldDir.removeEntry(workName); } catch(e) {} }
      }
      if (deletedCount > 0) console.log(`🗑️ 불필요한 파일 ${deletedCount}개 정리`);
    } catch(e) {
      console.warn('기존 폴더 정리 실패:', e.message);
    }
  } else {
    // ★ 새 작업 → 날짜+시간 새 폴더 (기존 폴더 절대 건드리지 않음)
    const timeStr = localTimeStr();
    dateFolderName = `${date}_${timeStr}`;
    currentFolderName = dateFolderName;  // 저장 후 현재 폴더로 등록
    console.log(`📁 새 폴더 생성: ${dateFolderName}`);
  }

  _currentSaveDateFolderName = dateFolderName;

  try {
    // 1) 사진 저장 - ★ 이미 저장된 사진은 스킵
    for (const u of units) {
      const tasks = [];

      for (let i = 0; i < u.before.length; i++) {
        const p = u.before[i];
        if (p.savedToFolder) { skippedPhotos++; continue; }  // ★ 이미 저장됨
        tasks.push(
          doWriteOne(p, u.name, '전')
            .then(() => { saved++; p.savedToFolder = true; })
            .catch(e => { failed++; console.warn('사진 저장 실패:', e.message); })
        );
      }
      for (let i = 0; i < u.after.length; i++) {
        const p = u.after[i];
        if (p.savedToFolder) { skippedPhotos++; continue; }  // ★ 이미 저장됨
        tasks.push(
          doWriteOne(p, u.name, '후')
            .then(() => { saved++; p.savedToFolder = true; })
            .catch(e => { failed++; console.warn('사진 저장 실패:', e.message); })
        );
      }
      for (let si = 0; si < u.specials.length; si++) {
        for (let pi = 0; pi < u.specials[si].photos.length; pi++) {
          const p = u.specials[si].photos[pi];
          if (p.savedToFolder) { skippedPhotos++; continue; }  // ★ 이미 저장됨
          tasks.push(
            doWriteOne(p, u.name, `특이${si+1}_`)
              .then(() => { saved++; p.savedToFolder = true; })
              .catch(e => { failed++; console.warn('사진 저장 실패:', e.message); })
          );
        }
      }

      if (tasks.length > 0) await Promise.all(tasks);
    }
    if (skippedPhotos > 0) console.log(`⚡ 사진 ${skippedPhotos}장 스킵 (이미 저장됨)`);
  } catch(eOuter) {
    console.warn('사진 저장 루프 에러:', eOuter);
  }

  // 2) 불러오기용 JSON 파일 저장 (사진 저장 실패와 무관하게 무조건 시도)
  // ★ workId 보장 (없으면 생성)
  if (typeof ensureWorkId === 'function') ensureWorkId();

  const sessionData = {
    version: 1,
    type: 'aircon-report',
    workId: currentWorkId || '',
    workType: currentWorkType || 'household',  // ★ 작업 유형
    facilityCustomer: currentWorkType === 'facility' ? {
      phone: facilityCustomer.phone || '',
      contact: facilityCustomer.contact || '',
      address: facilityCustomer.address || '',
      memo: facilityCustomer.memo || ''
    } : null,
    savedAt: kstIsoString(),
    apt: currentApt,
    date,
    worker:  document.getElementById('workerName').value || '',
    coName:  document.getElementById('coName')?.value || '',
    coTel:   document.getElementById('coTel')?.value || '',
    coBiz:   document.getElementById('coBiz')?.value || '',
    coDesc:  document.getElementById('coDesc')?.value || '',
    units: units.map(u => {
      // ★ 각 사진의 메타데이터 추출 (파일명 + 썸네일 dataUrl)
      const mapPhotoMeta = (p) => {
        if (!p) return null;
        return {
          fname: p.fileName || null,           // 디스크 파일명 (불러올 때 매칭용)
          thumb: p.thumbDataUrl || null        // 작은 썸네일 (앱 화면용)
        };
      };
      return {
        name: u.name,
        workNum: u._workNum || getWorkNumber(u.name),
        beforeCount: (u._photosOnDisk?.skipPhotoSync) ? (u._photosOnDisk.before || 0) : u.before.length,
        afterCount: (u._photosOnDisk?.skipPhotoSync) ? (u._photosOnDisk.after || 0) : u.after.length,
        // ★ 사진 메타데이터 - 폴더 스캔 없이 바로 사용 가능
        beforeMeta: u.before.map(mapPhotoMeta).filter(Boolean),
        afterMeta: u.after.map(mapPhotoMeta).filter(Boolean),
        specials: u.specials.map((s, si) => ({
          desc: s.desc,
          photoCount: (u._photosOnDisk?.skipPhotoSync) ? (u._photosOnDisk.specials?.[si] || 0) : s.photos.length,
          photosMeta: s.photos.map(mapPhotoMeta).filter(Boolean)
        })),
        customer: currentWorkType === 'facility'
          ? { phone: '', address: '', memo: '' }
          : (u.customer || { phone: '', address: '', memo: '' })
      };
    })
  };

  // JSON 텍스트 (쓰기 검증용)
  const jsonText = JSON.stringify(sessionData, null, 2);

  let saveOk = false;
  let lastError = '';

  // JSON 파일 쓰기 (재시도 포함)
  async function writeJsonFile(dirHandle, fileName, content) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const fh = await dirHandle.getFileHandle(fileName, { create: true });
        const writable = await fh.createWritable();
        const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
        await writable.write(blob);
        await writable.close();
        return true;  // ★ 검증 대기 제거 - 쓰기 성공이면 OK
      } catch(e) {
        lastError = e.message;
        console.warn(`쓰기 시도 ${attempt}/3 실패:`, e.message);
        if (attempt < 3) await new Promise(r => setTimeout(r, 200));
      }
    }
    return false;
  }

  try {
    // 새 폴더명으로 저장 (시간 추가된 경우 시간 폴더에 저장)
    const dateDir = await photoFolderHandle.getDirectoryHandle(dateFolderName, { create: true });

    // 파일명: 한글 제거하고 영문/숫자만 사용 (안드로이드 크롬 호환성)
    // 작업명 정보는 파일 내부 데이터(apt 필드)에 저장됨
    const fileName = `report_${dateFolderName}.acreport.json`;

    // 메인 파일 (재시도 포함)
    const ok1 = await writeJsonFile(dateDir, fileName, jsonText);
    // 호환용 _session.json
    const ok2 = await writeJsonFile(dateDir, '_session.json', jsonText);

    if (ok1 || ok2) {
      saveOk = true;
      sessionFileSaved = true;
      console.log('✓ 세션 파일 저장 완료:', { folder: dateFolderName, mainFile: ok1, sessionJson: ok2 });
      // 🆕 고객 정보도 함께 저장 (조용히)
      try {
        if (typeof flushAllCustomers === 'function') {
          await flushAllCustomers();
        }
        // customers.xlsx도 즉시 쓰기
        if (typeof flushCustomersXlsx === 'function') {
          await flushCustomersXlsx();
        }
      } catch(e) { console.warn('고객 저장 실패:', e); }
    } else {
      console.error('❌ 모든 시도 실패. 마지막 에러:', lastError);
    }
  } catch(e) {
    console.error('❌ 세션 파일 저장 실패:', e);
    lastError = e.message;
  }

  // 글로벌 변수 정리
  _currentSaveDateFolderName = null;

  if (!sessionFileSaved) {
    showToast('세션 파일 저장 실패: ' + lastError, 'err');
  }

  // 3) 자동저장도 함께
  try { await sessionAutoSaveNow(); } catch(e) {}

  // ★ 타임아웃 클리어 + 오버레이 닫기
  clearTimeout(_saveTimeout);
  // hideOverlay 불필요 (오버레이 없음)

  // ★ 저장 성공 시 dirty 해제 + 스냅샷 갱신
  if (sessionFileSaved) {
    _dataDirty = false;
    _lastSaveSnapshot = quickSnapshot();
  }

  // 결과 토스트
  if (sessionFileSaved) {
    if (isAutoSave) {
      console.log(`💾 자동 저장 완료 - 신규 ${saved}장 저장, ${skippedPhotos}장 스킵`);
    } else if (failed > 0) {
      showToast(`💾 ${saved}장 저장 완료 (${failed}장 실패)`, 'ok');
    } else if (saved === 0 && skippedPhotos > 0) {
      showToast(`💾 저장 완료 (사진 ${skippedPhotos}장은 이미 저장됨)`, 'ok');
    } else if (saved === 0) {
      showToast(`💾 작업 정보 저장 완료`, 'ok');
    } else {
      showToast(`💾 ${saved}장 저장 완료 ✓`, 'ok');
    }

    if (typeof flushCustomersXlsx === 'function') {
      flushCustomersXlsx().catch(e => console.warn('xlsx 재생성 실패:', e));
    }
    if (typeof invalidateCustomersCache === 'function') {
      invalidateCustomersCache();
    }
    // ★ 작업기록 캐시 무효화 + 백그라운드 재빌드
    if (typeof invalidateRecordsCache === 'function') {
      invalidateRecordsCache();
    }
  } else {
    if (!isAutoSave) {
      showToast('저장 실패: 작업 정보를 저장하지 못했습니다', 'err');
    }
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
      savedAt:     kstIsoString(),
      worker:      document.getElementById('workerName').value,
      companyName: document.getElementById('coName').value,
      companyTel:  document.getElementById('coTel').value,
      companyDesc: document.getElementById('coDesc').value,
      units:       JSON.parse(JSON.stringify(units)), // deep copy
      nid
    };
    await dbPut(obj);

    // 🆕 고객 정보 자동 저장 (각 호수의 customer 정보를 customers DB에)
    let savedCustomers = 0;
    try {
      const apt = document.getElementById('aptName').value || '';
      const date = document.getElementById('workDate').value || '';
      for (const u of units) {
        const phone = u.customer?.phone?.trim();
        if (!phone) continue;  // 전화번호 없으면 스킵
        const norm = normalizePhone(phone);
        if (!norm || norm.replace(/[^\d]/g, '').length < 9) continue;
        try {
          await customerSave({
            phone: norm,
            // name 미전달 - 기존 이름 보존, 신규 시 visit.unit 사용
            address: u.customer.address || '',
            memo: u.customer.memo || '',
            visit: {
              date: date || kstDateStr(),
              apt: apt,
              unit: u.name,
              work: `Photos: ${u.before.length + u.after.length}${u.specials.length ? `, Notes: ${u.specials.length}` : ''}`
            }
          });
          savedCustomers++;
        } catch(e) { console.warn('고객 저장 실패:', e.message); }
      }
      // 즉시 파일 쓰기
      if (typeof flushCustomersXlsx === 'function') {
        await flushCustomersXlsx();
      }
    } catch(e) { console.warn('고객 저장 루프 실패:', e); }

    hideOverlay();
    showToast(`"${name}" 저장 완료 ✓${savedCustomers ? ` (고객 ${savedCustomers}명)` : ''}`,'ok');
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

// 한국 시간 기준 YYYY-MM-DD 반환
function getLocalDateStr(d) {
  return kstDateStr(d);
}

async function openLoadList() {
  const today = new Date();
  const todayStr = getLocalDateStr(today);
  _loadDateFrom = todayStr;
  _loadDateTo   = todayStr;

  // ★ 1단계: 모달+로딩 즉시 표시
  document.getElementById('slModal').classList.add('open');
  const body = freshSlBody();
  body.innerHTML = `<div class="sl-empty">⏳ 불러오는 중...</div>`;

  // ★ 2단계: 브라우저가 실제로 화면을 그릴 때까지 대기 (requestAnimationFrame 2번)
  // 1번으로는 레이아웃 계산만 되고 실제 페인트가 안 될 수 있음
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  // ★ 3단계: 화면이 표시된 후 권한 확인 + 스캔 시작
  await renderLoadList();
}

// slBody의 이벤트 리스너를 모두 제거하고 깨끗한 새 요소 반환
function freshSlBody() {
  const old = document.getElementById('slBody');
  const fresh = old.cloneNode(false);  // 자식 X, 속성만 복제 → 리스너 모두 제거
  old.parentNode.replaceChild(fresh, old);
  return fresh;
}

async function renderLoadList() {
  // ★ openLoadList에서 이미 freshSlBody + "⏳ 불러오는 중..." 표시함
  // 여기서는 현재 body 참조만 가져옴
  let body = document.getElementById('slBody');

  // 폴더 없으면 파일 탐색기로 대체
  if (!photoFolderHandle) {
    body = freshSlBody();
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

  // 권한 확인 (삭제 기능 위해 처음부터 readwrite 요청)
  try {
    const perm = await photoFolderHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      const newPerm = await photoFolderHandle.requestPermission({ mode: 'readwrite' });
      if (newPerm !== 'granted') {
        // readwrite 거부되면 read만이라도 시도
        const readPerm = await photoFolderHandle.requestPermission({ mode: 'read' });
        if (readPerm !== 'granted') {
          body = freshSlBody();
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
    }
  } catch(e) {
    body.innerHTML = `<div class="sl-empty">폴더 접근 실패: ${e.message}</div>`;
    return;
  }

  // 날짜 폴더들 스캔 (기간 필터 적용) - 병렬 처리로 속도 개선
  const sessions = [];
  const debugInfo = { totalFolders: 0, dateFolders: 0, inRange: 0, withSession: 0, errors: [], details: [] };

  // 안정적인 파일 읽기 헬퍼 (1회 시도 + 1회 재시도)
  async function readJsonFile(fhandle) {
    let lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const file = await fhandle.getFile();
        const buffer = await file.arrayBuffer();
        const decoder = new TextDecoder('utf-8');
        let text = decoder.decode(buffer);
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        text = text.trim();
        if (!text) throw new Error('빈 문자열');
        return { text, size: file.size, parsed: JSON.parse(text) };
      } catch(e) {
        lastErr = e;
        if (attempt < 2) await new Promise(r => setTimeout(r, 50));
      }
    }
    throw lastErr;
  }

  // 한 폴더에서 _session.json 읽기 (병렬 처리용)
  async function processOneFolder(name, handle) {
    let data = null;
    let foundFile = null;

    try {
      const fh = await handle.getFileHandle('_session.json');
      const result = await readJsonFile(fh);
      if (result.parsed && Array.isArray(result.parsed.units)) {
        data = result.parsed;
        foundFile = '_session.json';
      }
    } catch(e) {
      // _session.json 없거나 읽기 실패 - legacy 처리
    }

    return { name, data, dirHandle: handle, sourceFile: foundFile };
  }

  try {
    // 1) 빠른 1차 스캔: 디렉토리 이름만 모음 (파일 안 읽음)
    const candidates = [];
    for await (const [name, handle] of photoFolderHandle.entries()) {
      debugInfo.totalFolders++;
      if (handle.kind !== 'directory') continue;
      if (!/^\d{4}-\d{2}-\d{2}(_\d{4})?$/.test(name)) continue;
      debugInfo.dateFolders++;

      // 기간 필터
      const dateOnly = name.substring(0, 10);
      if (_loadDateFrom && dateOnly < _loadDateFrom) continue;
      if (_loadDateTo && dateOnly > _loadDateTo) continue;
      debugInfo.inRange++;

      candidates.push({ name, handle });
    }

    // 2) 병렬 처리: 모든 후보 폴더를 한 번에 처리
    // (안드로이드 크롬에서 너무 많은 동시 요청은 부담될 수 있어 청크로 나눔)
    const CHUNK = 8;  // 한 번에 8개씩 병렬
    for (let i = 0; i < candidates.length; i += CHUNK) {
      const chunk = candidates.slice(i, i + CHUNK);
      const results = await Promise.all(
        chunk.map(c => processOneFolder(c.name, c.handle).catch(() => ({ name: c.name, data: null, dirHandle: c.handle })))
      );
      for (const r of results) {
        if (r.data) {
          sessions.push(r);
          debugInfo.withSession++;
        }
      }
    }
  } catch(e) {
    body = freshSlBody();
    body.innerHTML = `<div class="sl-empty">폴더 읽기 실패: ${e.message}</div>`;
    return;
  }
  // 정렬: 작업일(data.date) 최신순 우선, 같으면 저장 시각순
  sessions.sort((a,b) => {
    const da = (a.data.date || a.name.substring(0,10) || '').replace(/[^\d-]/g,'');
    const db = (b.data.date || b.name.substring(0,10) || '').replace(/[^\d-]/g,'');
    if (db !== da) return db.localeCompare(da);
    // 같은 작업일이면 저장 시각순
    const ta = new Date(a.data.savedAt).getTime();
    const tb = new Date(b.data.savedAt).getTime();
    if (tb !== ta) return tb - ta;
    return b.name.localeCompare(a.name);
  });

  // 콘솔 로그 (F12로 확인 가능)
  console.log('📂 불러오기 스캔 결과:', debugInfo);

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
      const unitArr = s.data.units || [];
      const uc = unitArr.length;
      const phc = unitArr.reduce((a,u)=>a+(u.beforeCount||0)+(u.afterCount||0),0);
      // 전화번호가 있는 호수 카운트
      const custCount = unitArr.filter(u => u.customer?.phone).length;

      // 호수 미리보기 (최대 5개까지 표시, 그 이상은 +N)
      const unitNames = unitArr.map(u => u.name).filter(n => n);
      let unitsPreview = '';
      if (unitNames.length > 0) {
        const shown = unitNames.slice(0, 5);
        const remain = unitNames.length - shown.length;
        unitsPreview = shown.map(escH).join(', ');
        if (remain > 0) unitsPreview += ` <span style="opacity:.7">+${remain}</span>`;
      }

      return `<div class="sl-item" data-sname="${s.name}" style="border-left:3px solid ${s.isLegacy?'#fbbf24':'var(--ac2)'};">
        <div class="sl-info" data-fload="${s.name}" style="cursor:pointer;">
          <div class="sl-name">📁 ${escH(s.data.apt || '작업')} <span style="font-size:11px;color:var(--mu);font-weight:500;">· ${s.data.date || s.name}</span></div>
          ${unitsPreview ? `<div class="sl-units" style="font-size:11px;color:var(--ac2);margin:3px 0;line-height:1.4;word-break:break-all;">🏠 ${unitsPreview}</div>` : ''}
          <div class="sl-meta">${ts} · ${uc}호수 · 사진 ${phc}장${custCount > 0 ? ` · 📞${custCount}명` : ''}</div>
        </div>
        <div class="sl-btns">
          <button class="btn b-blue b-xs" data-fload="${s.name}">불러오기</button>
          <button class="btn b-red b-xs" data-fdel="${s.name}">삭제</button>
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

  body = freshSlBody();
  body.innerHTML = html;

  // 이벤트 (한 번만 등록 - body가 새 요소이므로 중복 없음)
  body.addEventListener('click', async e => {
    const loadEl = e.target.closest('[data-fload]');
    const delEl  = e.target.closest('[data-fdel]');
    const dateBtn = e.target.closest('#btnChangeDateRange');
    const fileBtn = e.target.closest('#btnPickFileFallback');

    if (delEl) {
      e.stopPropagation();
      const target = sessions.find(s => s.name === delEl.dataset.fdel);
      if (target) await deleteDateFolder(target);
      return;
    }
    if (loadEl) {
      const target = sessions.find(s => s.name === loadEl.dataset.fload);
      if (target) await loadFromDateFolder(target.dirHandle, target.data);
    } else if (dateBtn) {
      showDateRangeDialog();
    } else if (fileBtn) {
      openFilePickerFallback();
    }
  });
}

// 날짜 폴더 삭제 (작업 전체 삭제)
async function deleteDateFolder(target) {
  const apt = target.data.apt || '작업';
  const dateStr = target.data.date || target.name;

  if (!confirm(
    `🗑️ 다음 작업을 삭제할까요?\n\n` +
    `${apt} · ${dateStr}\n` +
    `${(target.data.units||[]).length}개 호수\n\n` +
    `※ 폴더의 사진과 모든 파일이 삭제됩니다.\n` +
    `이 작업은 되돌릴 수 없습니다.`
  )) return;

  // ✨ 권한 체크는 overlay 띄우기 전에 (안드로이드에서 권한 다이얼로그가 가려지는 문제 방지)
  try {
    let perm = await photoFolderHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      perm = await photoFolderHandle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        showToast('쓰기 권한이 거부되어 삭제할 수 없습니다', 'err');
        return;
      }
    }
  } catch(e) {
    showToast('권한 확인 실패: ' + e.message, 'err');
    return;
  }

  showOverlay('삭제 중...');

  // 30초 안전장치: 너무 오래 걸리면 강제 종료
  const safetyTimeout = setTimeout(() => {
    hideOverlay();
    showToast('삭제 시간 초과 - 다시 시도해주세요', 'err');
  }, 30000);

  try {
    // 폴더 핸들 가져오기
    let freshDirHandle;
    try {
      freshDirHandle = await photoFolderHandle.getDirectoryHandle(target.name);
    } catch(e) {
      clearTimeout(safetyTimeout);
      hideOverlay();
      // 폴더가 없으면 이미 삭제된 것 → 목록만 새로고침
      console.warn('폴더를 찾을 수 없음 (이미 삭제됨?):', e.message);
      showToast('이미 삭제된 폴더입니다', 'ok');
      await renderLoadList();
      return;
    }

    // 폴더 전체 삭제 시도
    let deleted = false;

    // 1차: recursive 옵션 (데스크톱 크롬에서 잘 됨)
    try {
      await photoFolderHandle.removeEntry(target.name, { recursive: true });
      deleted = true;
      console.log('✓ recursive 삭제 성공');
    } catch(e1) {
      console.warn('recursive 삭제 실패, 수동 삭제 시도:', e1.message);
    }

    // 2차: 수동 재귀 삭제 (안드로이드용)
    if (!deleted) {
      try {
        await deleteDirectoryContents(freshDirHandle);
        await photoFolderHandle.removeEntry(target.name);
        deleted = true;
        console.log('✓ 수동 삭제 성공');
      } catch(e2) {
        console.warn('수동 삭제 실패:', e2.message);
      }
    }

    // 3차: 빈 폴더면 그냥 삭제 시도
    if (!deleted) {
      try {
        await photoFolderHandle.removeEntry(target.name);
        deleted = true;
      } catch(e3) {
        clearTimeout(safetyTimeout);
        hideOverlay();
        showToast('삭제 실패: ' + e3.message, 'err');
        return;
      }
    }

    clearTimeout(safetyTimeout);
    hideOverlay();
    showToast(`✓ "${apt}" 삭제됨`, 'ok');

    // 목록 새로고침
    await renderLoadList();
  } catch(e) {
    clearTimeout(safetyTimeout);
    hideOverlay();
    showToast('삭제 실패: ' + e.message, 'err');
  }
}

// 디렉토리 내부 모든 파일/폴더 재귀적으로 삭제
async function deleteDirectoryContents(dirHandle) {
  const entries = [];
  for await (const [name, handle] of dirHandle.entries()) {
    entries.push({ name, handle });
  }
  for (const { name, handle } of entries) {
    if (handle.kind === 'directory') {
      // 하위 폴더 → 내용 비우고 삭제
      await deleteDirectoryContents(handle);
      try {
        await dirHandle.removeEntry(name);
      } catch(e) {
        try { await dirHandle.removeEntry(name, { recursive: true }); } catch(e2) {
          console.warn(`폴더 삭제 실패: ${name}`, e2.message);
        }
      }
    } else {
      // 파일 → 직접 삭제
      try { await dirHandle.removeEntry(name); } catch(e) {
        console.warn(`파일 삭제 실패: ${name}`, e.message);
      }
    }
  }
}

// 기간 설정 다이얼로그
function showDateRangeDialog() {
  // 기본값: 지난 3개월
  const today = new Date();
  const threeMonthsAgo = new Date(today);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const fromDefault = _loadDateFrom || getLocalDateStr(threeMonthsAgo);
  const toDefault   = _loadDateTo   || getLocalDateStr(today);

  const body = freshSlBody();
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

      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:14px;">
        <button class="btn b-ghost b-xs" data-preset="0">오늘</button>
        <button class="btn b-ghost b-xs" data-preset="3">최근 3일</button>
        <button class="btn b-ghost b-xs" data-preset="30">최근 30일</button>
        <button class="btn b-ghost b-xs" data-preset="90">최근 3개월</button>
        <button class="btn b-ghost b-xs" data-preset="365">최근 1년</button>
        <button class="btn b-ghost b-xs" data-preset="all">전체 기간</button>
      </div>

      <div style="display:flex;gap:8px;">
        <button class="btn b-ghost" id="rangeCancel" style="flex:1;justify-content:center;">취소</button>
        <button class="btn b-blue" id="rangeApply" style="flex:1;justify-content:center;">적용</button>
      </div>
    </div>
  `;

  body.addEventListener('click', async e => {
    const preset = e.target.closest('[data-preset]');
    if (preset) {
      const type = preset.dataset.preset;
      const now = new Date();
      const fromEl = document.getElementById('rangeFrom');
      const toEl = document.getElementById('rangeTo');
      if (type === 'all') {
        fromEl.value = '2020-01-01';
        toEl.value = getLocalDateStr(now);
      } else {
        const days = parseInt(type);
        const from = new Date(now);
        from.setDate(from.getDate() - days);
        fromEl.value = getLocalDateStr(from);
        toEl.value = getLocalDateStr(now);
      }
      return;
    }

    if (e.target.closest('#rangeCancel')) {
      freshSlBody().innerHTML = `<div class="sl-empty">⏳ 불러오는 중...</div>`;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      renderLoadList();
      return;
    }

    if (e.target.closest('#rangeApply')) {
      _loadDateFrom = document.getElementById('rangeFrom').value;
      _loadDateTo   = document.getElementById('rangeTo').value;
      freshSlBody().innerHTML = `<div class="sl-empty">⏳ 불러오는 중...</div>`;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
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
  // 현재 작업과 같으면 그냥 닫기 (모든 모달 닫기)
  try {
    const curApt = (document.getElementById('aptName').value || '').trim();
    const curDate = (document.getElementById('workDate').value || '').trim();
    if (curApt === (data.apt || '').trim() && curDate === (data.date || '').trim()) {
      document.getElementById('slModal')?.classList.remove('open');
      document.getElementById('customerModal')?.classList.remove('open');
      showToast('이미 현재 작업입니다', 'ok');
      return;
    }
  } catch(e) {}

  // 저장되지 않은 변경사항 확인
  if (typeof units !== 'undefined' && units && units.length > 0) {
    if (typeof _dataDirty !== 'undefined' && _dataDirty) {
      const result = confirm('현재 작업이 저장되지 않았습니다.\n\n저장하시겠습니까?\n\n[확인] 저장 후 진행\n[취소] 저장하지 않고 진행');
      if (result) {
        if (photoFolderHandle && typeof saveToFolder === 'function') {
          try {
            await saveToFolder({ auto: true });
          } catch(e) {
            if (!confirm('저장 실패. 그래도 진행할까요?')) return;
          }
        } else if (typeof sessionAutoSaveNow === 'function') {
          try { await sessionAutoSaveNow(); } catch(e) {}
        }
      }
    }
  }

  await restoreFromData(data, dateDir);
}

// 공통 복원 로직
async function restoreFromData(data, dateDir) {
  // ★ 사진은 무조건 복원 (질문 제거 - 항상 사진까지 불러옴)
  const restorePhotos = !!dateDir;

  showOverlay('불러오는 중...');

  // ★ workId 복원
  currentWorkId = data.workId || generateWorkId();
  console.log('[workId] 작업 불러옴:', currentWorkId, data.workId ? '(기존)' : '(신규 발급)');

  // ★ 불러온 폴더명 저장 - 저장 시 이 폴더에만 덮어씀 (새 폴더 만들지 않음)
  currentFolderName = dateDir ? dateDir.name : null;
  console.log('[folderName] 현재 작업 폴더:', currentFolderName || '(없음 - 새 폴더 생성됨)');

  // ★ workType 복원 (없으면 기본 가정용)
  currentWorkType = data.workType || 'household';
  if (currentWorkType === 'facility' && data.facilityCustomer) {
    facilityCustomer = {
      phone: data.facilityCustomer.phone || '',
      contact: data.facilityCustomer.contact || '',
      address: data.facilityCustomer.address || '',
      memo: data.facilityCustomer.memo || ''
    };
  } else {
    facilityCustomer = { phone: '', contact: '', address: '', memo: '' };
  }
  if (typeof applyWorkTypeUI === 'function') applyWorkTypeUI();

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

  // ★ customers DB에서 이 작업의 고객 정보 미리 로드 (호수별 역조회용 - 가정용 모드만)
  let customersByUnit = new Map();
  if (currentWorkType !== 'facility') {
    try {
      if (typeof customerListAll === 'function') {
        const allCustomers = await customerListAll();
        const apt = data.apt || '';
        allCustomers.forEach(c => {
          (c.visits || []).forEach(v => {
            if (v.apt === apt && v.unit) {
              const key = `${apt}::${v.unit}`;
              const existing = customersByUnit.get(key);
              if (!existing || (c.lastVisit || '') > (existing.lastVisit || '')) {
                customersByUnit.set(key, c);
              }
            }
          });
        });
        if (customersByUnit.size > 0) {
          console.log(`[Load] customers DB에서 ${customersByUnit.size}개 호수 매칭`);
        }
      }
    } catch(e) { console.warn('customers 역조회 실패:', e); }
  }

  for (let ui = 0; ui < data.units.length; ui++) {
    const u = data.units[ui];

    // ★ 시설 모드면 호수 customer는 무조건 빈 값 (시설 customer는 별도)
    let customerData;
    if (currentWorkType === 'facility') {
      customerData = { phone: '', address: '', memo: '' };
    } else {
      // 가정용: 1차로 저장된 데이터 사용, 없으면 customers DB에서 역조회
      customerData = u.customer || { phone: '', address: '', memo: '' };
      if (!customerData.phone) {
        const apt = data.apt || '';
        const matchedCust = customersByUnit.get(`${apt}::${u.name}`);
        if (matchedCust) {
          customerData = {
            phone: matchedCust.phone || '',
            address: matchedCust.address || '',
            memo: matchedCust.memo || ''
          };
          console.log(`  ✓ ${u.name}: customers DB에서 ${matchedCust.phone} 매칭`);
        }
      }
    }

    const newUnit = {
      id: nid++,
      name: u.name,
      before: [],
      after: [],
      specials: (u.specials||[]).map(s => ({ desc:s.desc||'', photos:[] })),
      open: false,
      customer: customerData
    };

    if (restorePhotos && dateDir) {
      // ★ 사진 개수 확인 - 모두 0이면 즉시 다음 호수로
      const beforeCnt = u.beforeCount || 0;
      const afterCnt = u.afterCount || 0;
      const specialCnt = (u.specials || []).reduce((s, sp) => s + (sp.photoCount || 0), 0);
      const totalPhotos = beforeCnt + afterCnt + specialCnt;

      if (totalPhotos === 0) {
        units.push(newUnit);
        continue;
      }

      // ★ NEW: _session.json에 메타데이터 있으면 폴더 스캔 안 함
      const hasMeta = (u.beforeMeta || u.afterMeta ||
                       (u.specials || []).some(s => s.photosMeta));

      if (hasMeta) {
        // 폴더 핸들만 lazy 참조용으로 가져옴 (스캔 안 함)
        let workDir = null;
        try {
          const workNum = String(u.workNum || (ui+1)).padStart(2,'0');
          workDir = await dateDir.getDirectoryHandle(`work${workNum}`);
        } catch(e) { /* 폴더 없으면 원본 lazy 로딩 못 함 (썸네일은 가능) */ }

        // 메타에서 사진 객체 생성 (썸네일은 즉시 사용 + 원본은 lazy)
        const buildFromMeta = (meta) => {
          if (!meta) return null;
          const obj = {
            id: photoId(),
            dataUrl: meta.thumb || null,  // 썸네일 dataUrl (즉시 표시)
            fileName: meta.fname,
            savedToFolder: true,
            hasOriginal: true,
            lazy: !meta.thumb  // 썸네일 있으면 lazy 아님
          };
          // 원본 lazy 로딩을 위한 fileHandle (보고서 생성 시 필요)
          if (workDir && meta.fname) {
            obj._workDir = workDir;  // 나중에 getFileHandle 호출
          }
          return obj;
        };

        newUnit.before = (u.beforeMeta || []).map(buildFromMeta).filter(Boolean);
        newUnit.after  = (u.afterMeta  || []).map(buildFromMeta).filter(Boolean);
        newUnit.specials = (u.specials || []).map(s => ({
          desc: s.desc || '',
          photos: (s.photosMeta || []).map(buildFromMeta).filter(Boolean)
        }));

        units.push(newUnit);
        continue;
      }

      // ★ 구버전 호환: 메타데이터 없으면 기존처럼 폴더 스캔
      try {
        // ★ 저장된 workNum 우선 사용, 없으면 인덱스+1 (구버전 호환)
        const workNum = String(u.workNum || (ui+1)).padStart(2,'0');
        let workDir;
        try {
          workDir = await dateDir.getDirectoryHandle(`work${workNum}`);
        } catch(e) {
          // ★ workNum 폴더 못 찾으면 폴더명 패턴 폴백 시도
          // (호수명 직접 매칭, 같은 인덱스 재시도 등)
          console.warn(`work${workNum} 폴더 없음 - 폴백 시도`);
          // 인덱스 기반으로 다시 시도
          if (u.workNum && u.workNum !== ui+1) {
            try {
              workDir = await dateDir.getDirectoryHandle(`work${String(ui+1).padStart(2,'0')}`);
            } catch(e2) { throw e; }
          } else { throw e; }
        }

        // ★ 폴더의 실제 파일들을 모두 스캔 (A/B/S 패턴별로 분류)
        const filesByType = { A: [], B: [], S: {} };  // S는 si별로 그룹
        for await (const [fname, fh] of workDir.entries()) {
          if (fh.kind !== 'file') continue;
          // A_imageNN.jpg / B_imageNN.jpg / SN_imageNN.jpg 패턴 매칭
          const mA = fname.match(/^A_image(\d+)\.jpg$/i);
          const mB = fname.match(/^B_image(\d+)\.jpg$/i);
          const mS = fname.match(/^S(\d+)_image(\d+)\.jpg$/i);
          if (mA) {
            filesByType.A.push({ idx: parseInt(mA[1]), name: fname, handle: fh });
          } else if (mB) {
            filesByType.B.push({ idx: parseInt(mB[1]), name: fname, handle: fh });
          } else if (mS) {
            const sIdx = parseInt(mS[1]);
            if (!filesByType.S[sIdx]) filesByType.S[sIdx] = [];
            filesByType.S[sIdx].push({ idx: parseInt(mS[2]), name: fname, handle: fh });
          }
        }

        // 인덱스 순으로 정렬
        filesByType.A.sort((a, b) => a.idx - b.idx);
        filesByType.B.sort((a, b) => a.idx - b.idx);
        Object.values(filesByType.S).forEach(arr => arr.sort((a, b) => a.idx - b.idx));

        // ★ 썸네일 폴더 핸들 가져오기 (있을 수도 없을 수도)
        let thumbsDir = null;
        try {
          thumbsDir = await workDir.getDirectoryHandle('_thumbs');
        } catch(e) { /* 썸네일 폴더 없음 */ }

        // ★ 파일 읽기 - 썸네일 우선 + 원본은 lazy
        const readPhoto = async (fh) => {
          try {
            let thumbDataUrl = null;
            // 1) 썸네일 시도
            if (thumbsDir) {
              try {
                const thumbFh = await thumbsDir.getFileHandle(fh.name);
                const thumbFile = await thumbFh.getFile();
                thumbDataUrl = await blobToDataURL(thumbFile);
              } catch(e) { /* 썸네일 없음 */ }
            }
            // 2) 썸네일 없으면 백그라운드에서 생성 예약
            if (!thumbDataUrl) {
              _pendingThumbGen.push({ workDir, thumbsDir: thumbsDir, fh });
            }
            return {
              id: photoId(),
              dataUrl: thumbDataUrl,    // 썸네일 (작음) 또는 null
              fileHandle: fh,            // 원본 핸들 (보고서/확대용)
              fileName: fh.name,
              savedToFolder: true,
              hasOriginal: true,
              lazy: !thumbDataUrl        // 썸네일 없으면 원본을 lazy
            };
          } catch(e) { return null; }
        };

        // 작업 전 사진 (A) - 병렬
        const beforePhotos = await Promise.all(filesByType.A.map(f => readPhoto(f.handle)));
        newUnit.before = beforePhotos.filter(Boolean);

        // 작업 후 사진 (B) - 병렬
        const afterPhotos = await Promise.all(filesByType.B.map(f => readPhoto(f.handle)));
        newUnit.after = afterPhotos.filter(Boolean);

        // ★ 구버전 호환: A/B 없으면 카운트 기반 시도
        if (filesByType.A.length === 0 && filesByType.B.length === 0) {
          const legacyBefore = await Promise.all(
            Array.from({length: u.beforeCount||0}, (_, i) =>
              workDir.getFileHandle(`B_image${String(i+1).padStart(2,'0')}.jpg`)
                .then(fh => readPhoto(fh)).catch(() => null)
            )
          );
          newUnit.before = legacyBefore.filter(Boolean);

          const legacyAfter = await Promise.all(
            Array.from({length: u.afterCount||0}, (_, i) =>
              workDir.getFileHandle(`A_image${String(i+1).padStart(2,'0')}.jpg`)
                .then(fh => readPhoto(fh)).catch(() => null)
            )
          );
          newUnit.after = legacyAfter.filter(Boolean);
        }

        // 특이사항 - specials 슬롯 자동 생성 + 병렬 읽기
        const maxSi = Math.max(
          newUnit.specials.length,
          ...Object.keys(filesByType.S).map(k => parseInt(k))
        );
        while (newUnit.specials.length < maxSi) {
          newUnit.specials.push({ desc: '', photos: [] });
        }
        for (let si = 0; si < newUnit.specials.length; si++) {
          const sFiles = filesByType.S[si+1] || [];
          const spPhotos = await Promise.all(sFiles.map(f => readPhoto(f.handle)));
          newUnit.specials[si].photos = spPhotos.filter(Boolean);
        }

        const totalRestored = newUnit.before.length + newUnit.after.length +
          newUnit.specials.reduce((s, sp) => s + sp.photos.length, 0);
        const totalExpected = (u.beforeCount||0) + (u.afterCount||0) +
          (u.specials||[]).reduce((s, sp) => s + (sp.photoCount||0), 0);
        if (totalRestored !== totalExpected) {
          console.log(`📷 ${u.name}: 기대 ${totalExpected}장, 복원 ${totalRestored}장`);
        }

        // ★ workNum 정보 newUnit에 보존 (저장 시 같은 폴더에 쓰도록)
        newUnit._workNum = u.workNum || (ui+1);
      } catch(e) {
        console.warn(`work${u.workNum || (ui+1)} 폴더 사진 로드 실패:`, e.message);
        // 사진 폴더 자체가 없는 케이스 - 가드 처리
        newUnit._workNum = u.workNum || (ui+1);
        newUnit._photosOnDisk = {
          before: u.beforeCount || 0,
          after: u.afterCount || 0,
          specials: (u.specials || []).map(s => s.photoCount || 0),
          skipPhotoSync: true
        };
      }
    } else {
      // ★ 사진 없이 불러오기 - 사진 정보 메타데이터로 보존
      // 저장 시 폴더의 사진은 건드리지 않음 (안전 가드)
      newUnit._workNum = u.workNum || (ui+1);
      newUnit._photosOnDisk = {
        before: u.beforeCount || 0,
        after: u.afterCount || 0,
        specials: (u.specials || []).map(s => s.photoCount || 0),
        // 디스크에 사진이 있다는 표시
        skipPhotoSync: true
      };
    }

    units.push(newUnit);
  }

  document.getElementById('slModal').classList.remove('open');
  renderAll();
  updateStats();

  // ★ 불러온 직후 - dirty 초기화 + 스냅샷 저장 (다음 변경 추적용)
  // 이래야 변경 없이 또 불러올 때 저장 스킵됨
  if (typeof _dataDirty !== 'undefined') _dataDirty = false;
  if (typeof quickSnapshot === 'function') {
    _lastSaveSnapshot = quickSnapshot();
  }

  hideOverlay();
  showToast(`✓ ${units.length}호수 불러옴`, 'ok');

  // ★ 썸네일 없는 사진들 백그라운드 생성 (3초 후 시작 - 첫 렌더 방해 안 함)
  if (_pendingThumbGen.length > 0) {
    setTimeout(() => processPendingThumbGen(), 3000);
  }
}

// 평문 이스케이프
function escPlain(s) {
  return String(s||'').replace(/[<>&"]/g, c => ({'<':'‹','>':'›','&':'＆','"':'"'}[c]));
}

// IndexedDB 저장 목록 (백업용 - 폴더 지원 안 하는 브라우저)
async function openSavedList() {
  document.getElementById('slModal').classList.add('open');
  let body = freshSlBody();
  body.innerHTML = `<div class="sl-empty">⏳ 불러오는 중...</div>`;
  try {
    const saves = await dbGetAll();
    if (saves.length === 0) {
      body = freshSlBody();
      body.innerHTML = `<div class="sl-empty">저장된 작업이 없습니다</div>`;
      return;
    }
    body = freshSlBody();
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
  // 현재 작업이 있고 저장 안 된 경우 - 저장 확인
  if (units.length > 0) {
    if (typeof _dataDirty !== 'undefined' && _dataDirty) {
      const result = confirm('현재 작업이 저장되지 않았습니다.\n\n저장하시겠습니까?\n\n[확인] 저장 후 진행\n[취소] 저장하지 않고 진행');
      if (result) {
        if (photoFolderHandle && typeof saveToFolder === 'function') {
          try {
            await saveToFolder({ auto: true });
          } catch(e) {
            if (!confirm('저장 실패. 그래도 진행할까요?')) return;
          }
        } else if (typeof sessionAutoSaveNow === 'function') {
          try { await sessionAutoSaveNow(); } catch(e) {}
        }
      }
    } else if (!confirm('현재 작업이 사라집니다.\n불러올까요?')) return;
  }
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

    // ★ customers DB에서 빈 customer 자동 채우기
    try {
      if (typeof customerListAll === 'function') {
        const allCustomers = await customerListAll();
        const apt = s.apt || '';
        units.forEach(u => {
          if (!u.customer) u.customer = { phone: '', address: '', memo: '' };
          if (u.customer.phone) return;  // 이미 있으면 스킵
          // 매칭 검색
          let matched = null;
          for (const c of allCustomers) {
            const v = (c.visits || []).find(v => v.apt === apt && v.unit === u.name);
            if (v && (!matched || (c.lastVisit || '') > (matched.lastVisit || ''))) {
              matched = c;
            }
          }
          if (matched) {
            u.customer = {
              phone: matched.phone || '',
              address: matched.address || '',
              memo: matched.memo || ''
            };
          }
        });
      }
    } catch(e) { console.warn('customers 역조회 실패:', e); }

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
  // 업종 드롭다운 채우기 (한 번만)
  populateIndustryDropdowns();
  updateCoPreview();
  applyCoIcon();
  document.getElementById('coModal').classList.add('open');
  document.getElementById('coName').focus();
}

// 업종 드롭다운 채우기
function populateIndustryDropdowns() {
  const majorSel = document.getElementById('coIndustryMajor');
  const minorSel = document.getElementById('coIndustryMinor');
  if (!majorSel || !minorSel) return;

  // 이미 채워져있으면 스킵
  if (majorSel.options.length <= 1 && typeof INDUSTRIES !== 'undefined') {
    majorSel.innerHTML = '<option value="">선택 안함</option>';
    INDUSTRIES.forEach(major => {
      const opt = document.createElement('option');
      opt.value = major.id;
      opt.textContent = major.label;
      majorSel.appendChild(opt);
    });
  }

  // 저장된 값 복원
  try {
    const ci = JSON.parse(localStorage.getItem(CO_KEY) || '{}');
    if (ci.coIndustryMajor) {
      majorSel.value = ci.coIndustryMajor;
      updateMinorDropdown(ci.coIndustryMajor, ci.coIndustryMinor);
    }
  } catch(e) {}

  // 대분류 변경 시 소분류 갱신
  if (!majorSel._bound) {
    majorSel.addEventListener('change', () => {
      updateMinorDropdown(majorSel.value, '');
      // 대분류 변경 시 소분류 초기화 (자동 적용은 하지 않음 - 사용자가 소분류 선택해야)
    });
    majorSel._bound = true;
  }

  // 소분류 변경 시 자동 입력
  if (!minorSel._bound) {
    minorSel.addEventListener('change', () => {
      const item = findIndustryItem(majorSel.value, minorSel.value);
      if (item) {
        // 비어있는 항목만 자동 채우기 (사용자가 이미 입력한 건 보존)
        const titleEl = document.getElementById('coReportTitle');
        const unitEl  = document.getElementById('coUnitLabel');
        const stageEl = document.getElementById('coStageLabel');
        if (titleEl && !titleEl.value.trim()) titleEl.value = item.title;
        if (unitEl  && !unitEl.value.trim())  unitEl.value  = item.unit;
        if (stageEl && !stageEl.value.trim()) stageEl.value = item.stage;
        // 항상 적용 옵션 - 비어있지 않아도 덮어씀 (사용자 선택)
        if (confirm(`"${item.label}" 업종으로 자동 입력하시겠습니까?\n\n📄 보고서 제목: ${item.title}\n🏷️ 현장 호칭: ${item.unit}\n🔧 작업 단계: ${item.stage}\n\n[확인] 모두 덮어쓰기 / [취소] 빈 항목만 채우기`)) {
          if (titleEl) titleEl.value = item.title;
          if (unitEl)  unitEl.value  = item.unit;
          if (stageEl) stageEl.value = item.stage;
        }
        updateCoPreview();
      }
    });
    minorSel._bound = true;
  }
}

function updateMinorDropdown(majorId, currentMinorId) {
  const minorSel = document.getElementById('coIndustryMinor');
  if (!minorSel) return;
  minorSel.innerHTML = '';

  if (!majorId) {
    minorSel.innerHTML = '<option value="">먼저 대분류 선택</option>';
    return;
  }

  const major = INDUSTRIES.find(i => i.id === majorId);
  if (!major || major.items.length === 0) {
    minorSel.innerHTML = '<option value="">(직접 입력)</option>';
    return;
  }

  minorSel.innerHTML = '<option value="">소분류 선택</option>';
  major.items.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = item.label;
    minorSel.appendChild(opt);
  });

  // 저장된 값 복원
  if (currentMinorId) minorSel.value = currentMinorId;
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
    // 업종별 호칭 즉시 적용
    if (typeof applyCustomLabels === 'function') applyCustomLabels();
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

  // 앱 헤더 로고 아이콘도 갱신
  const appLogo = document.getElementById('appLogoIcon');
  if (appLogo) renderTo(appLogo);

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


// ═══════════════════════════════════════════
// 사진 순서 편집
// ═══════════════════════════════════════════
// _reorderState: { unitId, before: [...복제], after: [...복제] }
let _reorderState = null;

function openReorderModal(unitId, side) {
  // unitId는 DOM 데이터셋에서 온 문자열, u.id는 숫자일 수 있음 → 문자열로 통일 비교
  const u = units.find(x => String(x.id) === String(unitId));
  if (!u) {
    console.warn('호수를 찾을 수 없음:', unitId);
    return;
  }

  if (u.before.length < 2 && u.after.length < 2) {
    showToast('순서 편집은 사진이 2장 이상일 때 가능합니다', 'err');
    return;
  }

  // 복제본 만들기 (취소 시 원본 보존)
  _reorderState = {
    unitId: u.id,
    before: u.before.map(p => ({ ...p })),
    after: u.after.map(p => ({ ...p }))
  };

  // 제목 설정
  document.getElementById('reorderTitle').textContent =
    `🔄 ${u.name} - 사진 순서 편집`;

  renderReorderList();
  document.getElementById('reorderModal').classList.add('open');
}

function renderReorderList() {
  const body = document.getElementById('reorderBody');
  if (!_reorderState) return;

  const before = _reorderState.before;
  const after  = _reorderState.after;

  function colHtml(photos, side, label, color) {
    if (!photos.length) {
      return `<div class="reorder-col" data-side="${side}">
        <div class="reorder-col-head" style="color:${color};">${label} (0장)</div>
        <div class="reorder-empty">사진 없음</div>
      </div>`;
    }
    return `<div class="reorder-col" data-side="${side}">
      <div class="reorder-col-head" style="color:${color};">${label} (${photos.length}장)</div>
      <div class="reorder-list" data-side="${side}">
        ${photos.map((p, idx) => `
          <div class="reorder-item" data-side="${side}" data-idx="${idx}">
            <div class="reorder-num">${idx + 1}</div>
            <img class="reorder-thumb" src="${p.dataUrl}" data-fullview="${p.dataUrl}" alt="${label} ${idx+1}">
            <button class="reorder-del" data-side="${side}" data-idx="${idx}" title="삭제">✕</button>
            <div class="reorder-drag-handle">≡</div>
          </div>`).join('')}
      </div>
    </div>`;
  }

  body.innerHTML = `
    <div class="reorder-info">
      ☰ 드래그로 순서 변경 · 사진 탭하면 크게 보기
    </div>
    <div class="reorder-cols">
      ${colHtml(before, 'before', '🔴 작업 전', '#f06060')}
      ${colHtml(after,  'after',  '🟢 작업 후', '#10b981')}
    </div>`;

  // ✕ 삭제
  body.querySelectorAll('.reorder-del').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const side = btn.dataset.side;
      const idx  = parseInt(btn.dataset.idx);
      if (!confirm('이 사진을 삭제할까요?')) return;
      _reorderState[side].splice(idx, 1);
      renderReorderList();
    });
  });

  // 사진 탭 → 전체화면
  body.querySelectorAll('.reorder-thumb').forEach(img => {
    img.addEventListener('click', e => {
      e.stopPropagation();
      openReorderFullView(img.dataset.fullview);
    });
  });

  // 드래그
  bindReorderDrag(body);
}

/* ── 드래그 순서 변경 (안정적 재작성) ── */
let _dragCleanup = null;  // 이전 드래그 리스너 정리용

function bindReorderDrag(body) {
  // ★ 이전 드래그 리스너 완전 정리
  if (_dragCleanup) { _dragCleanup(); _dragCleanup = null; }

  let drag = null;  // 드래그 상태
  let rafId = null; // requestAnimationFrame ID
  let pendingY = 0; // 최신 Y 좌표

  // ── 고스트 생성 ──
  function createGhost(el) {
    const r = el.getBoundingClientRect();
    const g = el.cloneNode(true);
    // 버튼 이벤트 제거
    g.querySelectorAll('button,input').forEach(b => b.disabled = true);
    Object.assign(g.style, {
      position: 'fixed',
      left: r.left + 'px',
      top:  r.top  + 'px',
      width: r.width + 'px',
      height: r.height + 'px',
      margin: '0',
      zIndex: '9999',
      opacity: '0.85',
      pointerEvents: 'none',
      boxShadow: '0 8px 28px rgba(0,0,0,.5)',
      borderRadius: '10px',
      background: 'var(--sf)',
      transform: 'scale(1.02)',
      transition: 'none',
      willChange: 'top',
    });
    document.body.appendChild(g);
    return { el: g, baseTop: r.top };
  }

  // ── 모든 항목의 중간 Y 계산 ──
  function getDropIndex(side, clientY) {
    const items = [...body.querySelectorAll(`.reorder-item[data-side="${side}"]`)];
    let idx = items.length - 1;
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) { idx = i; break; }
    }
    return idx;
  }

  // ── 드롭 강조 갱신 ──
  function updateHighlight(side, dropIdx) {
    body.querySelectorAll('.reorder-item').forEach((el, i) => {
      const isSide = el.dataset.side === side;
      const isTarget = isSide && parseInt(el.dataset.idx) === dropIdx && dropIdx !== drag.fromIdx;
      el.classList.toggle('reorder-over', isTarget);
    });
  }

  // ── RAF 루프 ──
  function rafLoop() {
    if (!drag) return;
    const dy = pendingY - drag.startY;
    drag.ghost.el.style.top = (drag.ghost.baseTop + dy) + 'px';
    const dropIdx = getDropIndex(drag.side, pendingY);
    if (dropIdx !== drag.lastDropIdx) {
      drag.lastDropIdx = dropIdx;
      updateHighlight(drag.side, dropIdx);
    }
    rafId = requestAnimationFrame(rafLoop);
  }

  // ── 시작 ──
  function onStart(e) {
    const handle = e.target.closest('.reorder-drag-handle');
    if (!handle) return;
    const item = handle.closest('.reorder-item');
    if (!item) return;

    e.preventDefault();
    e.stopPropagation();

    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const ghost = createGhost(item);
    item.classList.add('reorder-dragging');

    drag = {
      side:        item.dataset.side,
      fromIdx:     parseInt(item.dataset.idx),
      el:          item,
      ghost,
      startY:      clientY,
      lastDropIdx: parseInt(item.dataset.idx),
    };
    pendingY = clientY;
    rafId = requestAnimationFrame(rafLoop);
  }

  // ── 이동 ──
  function onMove(e) {
    if (!drag) return;
    e.preventDefault();
    pendingY = e.touches ? e.touches[0].clientY : e.clientY;
  }

  // ── 종료 ──
  function onEnd(e) {
    if (!drag) return;

    cancelAnimationFrame(rafId); rafId = null;

    // 정리
    drag.ghost.el.remove();
    drag.el.classList.remove('reorder-dragging');
    body.querySelectorAll('.reorder-over').forEach(el => el.classList.remove('reorder-over'));

    const dropIdx = drag.lastDropIdx;
    const fromIdx = drag.fromIdx;

    if (dropIdx !== fromIdx) {
      const photos = _reorderState[drag.side];
      const [moved] = photos.splice(fromIdx, 1);
      photos.splice(dropIdx, 0, moved);
      photos.forEach(p => { p.savedToFolder = false; });
      renderReorderList();
    }

    drag = null;
  }

  // ── 이벤트 등록 ──
  // 터치: body에만 (passive:false 필수)
  const touchOpts = { passive: false };
  body.addEventListener('touchstart',  onStart, touchOpts);
  body.addEventListener('touchmove',   onMove,  touchOpts);
  body.addEventListener('touchend',    onEnd);
  body.addEventListener('touchcancel', onEnd);

  // 마우스: move/up은 document에 (드래그가 영역 벗어나도 대응)
  body.addEventListener('mousedown', onStart);
  const docMove = e => onMove(e);
  const docUp   = e => onEnd(e);
  document.addEventListener('mousemove', docMove);
  document.addEventListener('mouseup',   docUp);

  // ★ 정리 함수 등록 (모달 닫을 때 호출)
  _dragCleanup = () => {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (drag?.ghost?.el?.parentNode) drag.ghost.el.remove();
    drag = null;
    body.removeEventListener('touchstart',  onStart, touchOpts);
    body.removeEventListener('touchmove',   onMove,  touchOpts);
    body.removeEventListener('touchend',    onEnd);
    body.removeEventListener('touchcancel', onEnd);
    body.removeEventListener('mousedown',   onStart);
    document.removeEventListener('mousemove', docMove);
    document.removeEventListener('mouseup',   docUp);
  };
}

function openReorderFullView(src) {
  let fv = document.getElementById('reorderFullView');
  if (!fv) {
    fv = document.createElement('div');
    fv.id = 'reorderFullView';
    fv.className = 'reorder-fullview';
    fv.innerHTML = `<img id="reorderFullImg" src="" alt="전체화면">`;
    fv.addEventListener('click', () => closeReorderFullView());
    document.body.appendChild(fv);
  }
  document.getElementById('reorderFullImg').src = src;
  fv.classList.add('open');
  history.pushState({ reorderFullView: true }, '');
}

function closeReorderFullView() {
  const fv = document.getElementById('reorderFullView');
  if (!fv || !fv.classList.contains('open')) return;
  fv.classList.remove('open');
  if (history.state?.reorderFullView) history.back();
}

function moveReorderItem(side, idx, direction) {
  if (!_reorderState) return;
  const photos = _reorderState[side];
  if (!photos) return;
  const newIdx = idx + direction;

  if (newIdx < 0 || newIdx >= photos.length) return;

  // 스왑
  [photos[idx], photos[newIdx]] = [photos[newIdx], photos[idx]];

  // 다시 그리기
  renderReorderList();
}

function saveReorder() {
  if (!_reorderState) return;
  const u = units.find(x => String(x.id) === String(_reorderState.unitId));
  if (!u) return;

  // 원본에 적용 (양쪽 모두)
  u.before = _reorderState.before;
  u.after = _reorderState.after;

  // 폴더에 이미 저장된 사진은 새 순서로 다시 저장 필요
  u.before.forEach(p => { p.savedToFolder = false; });
  u.after.forEach(p => { p.savedToFolder = false; });

  closeReorderModal();
  renderAll();
  updateStats();
  showToast('✓ 순서 변경 완료', 'ok');

  // 자동저장 (세션)
  if (typeof sessionAutoSaveNow === 'function') sessionAutoSaveNow();
}

function closeReorderModal() {
  // ★ 드래그 리스너 정리 (메모리 누수 방지)
  if (_dragCleanup) { _dragCleanup(); _dragCleanup = null; }
  _reorderState = null;
  document.getElementById('reorderModal').classList.remove('open');
}

// 이벤트 바인딩 (즉시 + 안전하게)
function bindReorderEvents() {
  // 호수 카드의 순서 편집 버튼 (이벤트 위임 - 캡처링 단계로 다른 핸들러보다 먼저)
  document.body.addEventListener('click', e => {
    const btn = e.target.closest('.reorder-btn');
    if (btn) {
      e.stopPropagation();
      e.preventDefault();
      console.log('🔄 순서 편집 버튼 클릭:', btn.dataset.uid, btn.dataset.side);
      openReorderModal(btn.dataset.uid, btn.dataset.side);
    }
  }, true);  // ← 캡처링 단계 (true)

  // 모달 버튼들
  const closeBtn = document.getElementById('reorderClose');
  const cancelBtn = document.getElementById('reorderCancel');
  const saveBtn = document.getElementById('reorderSave');
  if (closeBtn) closeBtn.addEventListener('click', closeReorderModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeReorderModal);
  if (saveBtn) saveBtn.addEventListener('click', saveReorder);
}

// DOM이 이미 로드됐으면 즉시, 아니면 DOMContentLoaded 대기
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindReorderEvents);
} else {
  bindReorderEvents();
}

// 전화번호/사업자번호 입력 시 자동 하이픈
function setupAutoFormat() {
  const coTel = document.getElementById('coTel');
  if (coTel) {
    coTel.addEventListener('input', e => {
      const raw = e.target.value.replace(/[^\d]/g, '');
      let formatted = raw;
      if (raw.length === 11 && raw.startsWith('010')) {
        formatted = `${raw.slice(0,3)}-${raw.slice(3,7)}-${raw.slice(7)}`;
      } else if (raw.length === 10 && raw.startsWith('02')) {
        formatted = `${raw.slice(0,2)}-${raw.slice(2,6)}-${raw.slice(6)}`;
      } else if (raw.length === 11) {
        formatted = `${raw.slice(0,3)}-${raw.slice(3,7)}-${raw.slice(7)}`;
      } else if (raw.length === 10) {
        formatted = `${raw.slice(0,3)}-${raw.slice(3,6)}-${raw.slice(6)}`;
      } else if (raw.length === 9) {
        formatted = `${raw.slice(0,2)}-${raw.slice(2,5)}-${raw.slice(5)}`;
      } else if (raw.length === 8) {
        formatted = `${raw.slice(0,4)}-${raw.slice(4)}`;
      }
      // 커서 위치 보존
      const cursorPos = e.target.selectionStart;
      const oldLen = e.target.value.length;
      e.target.value = formatted;
      const newLen = formatted.length;
      const diff = newLen - oldLen;
      try { e.target.setSelectionRange(cursorPos + diff, cursorPos + diff); } catch(e2) {}
    });
  }

  const coBiz = document.getElementById('coBiz');
  if (coBiz) {
    coBiz.addEventListener('input', e => {
      const raw = e.target.value.replace(/[^\d]/g, '');
      let formatted = raw;
      if (raw.length === 10) {
        formatted = `${raw.slice(0,3)}-${raw.slice(3,5)}-${raw.slice(5)}`;
      }
      e.target.value = formatted;
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupAutoFormat);
} else {
  setupAutoFormat();
}
