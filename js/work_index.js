/* ═══════════════════════════════════════════════
   작업 인덱스 파일 시스템 (_works_index.json)
   - 모든 작업의 메타데이터를 단일 파일에 저장
   - 폴더 전체 스캔 없이 작업 목록을 즉시 불러옴
   - 손상 시 폴더 스캔으로 자동 복구
═══════════════════════════════════════════════ */

const INDEX_FILE_NAME = '_works_index.json';
const INDEX_VERSION = 2;  // ★ v2: facilityCustomer 포함 (v1은 facility 작업 누락)

let _indexCache = null;          // 메모리 캐시
let _indexLoaded = false;
let _indexWriteTimer = null;     // 디바운스용
let _indexWriteInProgress = false;
const INDEX_WRITE_DEBOUNCE = 1500;  // 1.5초 디바운스

// 인덱스 파일 로드 (메모리 캐시 활용)
async function loadWorkIndex(force = false) {
  if (_indexLoaded && !force && _indexCache) return _indexCache;
  if (!photoFolderHandle) return null;

  try {
    const fh = await photoFolderHandle.getFileHandle(INDEX_FILE_NAME);
    const file = await fh.getFile();
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || !Array.isArray(data.works)) {
      throw new Error('인덱스 형식 오류');
    }
    _indexCache = data;
    _indexLoaded = true;
    console.log(`[인덱스] 로드 완료: ${data.works.length}건`);
    return data;
  } catch(e) {
    // 파일 없거나 손상 → null 반환 (호출자가 폴더 스캔으로 복구)
    if (e.name !== 'NotFoundError') {
      console.warn('[인덱스] 로드 실패:', e.message);
    }
    return null;
  }
}

// 인덱스 파일 저장 (즉시)
async function saveWorkIndex(indexData) {
  if (!photoFolderHandle || !indexData) return false;
  if (_indexWriteInProgress) {
    // 동시 저장 충돌 방지 - 기다리기
    let retries = 5;
    while (_indexWriteInProgress && retries-- > 0) {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  _indexWriteInProgress = true;
  try {
    indexData.version = INDEX_VERSION;
    indexData.updatedAt = (typeof kstIsoString === 'function') ? kstIsoString() : new Date().toISOString();

    // 1차 저장: 임시 파일에
    const tempName = INDEX_FILE_NAME + '.tmp';
    try {
      const tmpFh = await photoFolderHandle.getFileHandle(tempName, { create: true });
      const w = await tmpFh.createWritable();
      await w.write(JSON.stringify(indexData));
      await w.close();
    } catch(e) {
      throw new Error('임시 인덱스 쓰기 실패: ' + e.message);
    }

    // 2차: 본 파일로 교체 (이전 백업 보관)
    try {
      // 기존 _works_index.json → _works_index.json.bak
      try {
        const oldFh = await photoFolderHandle.getFileHandle(INDEX_FILE_NAME);
        const oldFile = await oldFh.getFile();
        const bakFh = await photoFolderHandle.getFileHandle(INDEX_FILE_NAME + '.bak', { create: true });
        const bw = await bakFh.createWritable();
        await bw.write(oldFile);
        await bw.close();
      } catch(e) { /* 처음이면 옛 파일 없음 */ }

      // 새 인덱스 본 파일에 쓰기
      const mainFh = await photoFolderHandle.getFileHandle(INDEX_FILE_NAME, { create: true });
      const mw = await mainFh.createWritable();
      await mw.write(JSON.stringify(indexData));
      await mw.close();

      // 임시 파일 삭제
      try { await photoFolderHandle.removeEntry(tempName); } catch(e) {}
    } catch(e) {
      throw new Error('인덱스 교체 실패: ' + e.message);
    }

    _indexCache = indexData;
    _indexLoaded = true;
    console.log(`[인덱스] 저장 완료: ${indexData.works.length}건`);
    return true;
  } catch(e) {
    console.error('[인덱스] 저장 실패:', e.message);
    return false;
  } finally {
    _indexWriteInProgress = false;
  }
}

// 인덱스 항목 추가/갱신 (디바운스)
function scheduleIndexUpdate(workInfo) {
  if (!workInfo || !workInfo.folderName) return;

  // 메모리 캐시 즉시 갱신
  if (!_indexCache) {
    _indexCache = { version: INDEX_VERSION, updatedAt: '', works: [] };
    _indexLoaded = true;
  }
  const arr = _indexCache.works;

  // workId 또는 folderName으로 매칭
  let i = -1;
  if (workInfo.workId) i = arr.findIndex(w => w.workId === workInfo.workId);
  if (i < 0) i = arr.findIndex(w => w.folderName === workInfo.folderName);

  if (i >= 0) {
    arr[i] = { ...arr[i], ...workInfo };
  } else {
    arr.push(workInfo);
  }

  // 파일 쓰기 디바운스
  clearTimeout(_indexWriteTimer);
  _indexWriteTimer = setTimeout(() => {
    saveWorkIndex(_indexCache).catch(e => console.warn('[인덱스] 갱신 실패:', e.message));
  }, INDEX_WRITE_DEBOUNCE);
}
window.scheduleIndexUpdate = scheduleIndexUpdate;

// 인덱스에서 작업 항목 삭제
function scheduleIndexDelete(folderName) {
  if (!_indexCache) return;
  const before = _indexCache.works.length;
  _indexCache.works = _indexCache.works.filter(w => w.folderName !== folderName);
  if (_indexCache.works.length < before) {
    clearTimeout(_indexWriteTimer);
    _indexWriteTimer = setTimeout(() => {
      saveWorkIndex(_indexCache).catch(e => console.warn('[인덱스] 삭제 갱신 실패:', e.message));
    }, INDEX_WRITE_DEBOUNCE);
  }
}
window.scheduleIndexDelete = scheduleIndexDelete;

// _session.json + 부가정보 → 인덱스 항목 변환
function sessionToIndexEntry(folderName, sessionData) {
  if (!sessionData || !sessionData.units) return null;
  const totalPhotos = sessionData.units.reduce(
    (s, u) => s + (u.beforeCount || 0) + (u.afterCount || 0) +
              (u.specials || []).reduce((a, sp) => a + (sp.photoCount || 0), 0),
    0
  );
  const workType = sessionData.workType || 'household';
  return {
    folderName,
    workId: sessionData.workId || '',
    apt: sessionData.apt || '',
    date: sessionData.date || folderName.slice(0, 10),
    savedAt: sessionData.savedAt || '',
    worker: sessionData.worker || '',
    workType,
    // ★ 공용시설은 facilityCustomer에 전화번호가 있음
    facilityCustomer: workType === 'facility' && sessionData.facilityCustomer ? {
      phone: sessionData.facilityCustomer.phone || '',
      contact: sessionData.facilityCustomer.contact || '',
      address: sessionData.facilityCustomer.address || '',
      memo: sessionData.facilityCustomer.memo || ''
    } : null,
    totalUnits: sessionData.units.length,
    totalPhotos,
    units: sessionData.units.map(u => ({
      name: u.name,
      customer: {
        phone: u.customer?.phone || '',
        address: u.customer?.address || '',
        memo: u.customer?.memo || ''
      },
      beforeCount: u.beforeCount || 0,
      afterCount: u.afterCount || 0,
      specialsCount: (u.specials || []).length
    }))
  };
}
window.sessionToIndexEntry = sessionToIndexEntry;

// 폴더 스캔하여 인덱스 처음부터 빌드 (복구용)
async function rebuildIndexFromFolders(onProgress) {
  if (!photoFolderHandle) return null;
  console.log('[인덱스] 폴더 스캔으로 재빌드 시작...');

  const works = [];
  let scanned = 0, ok = 0, errored = 0;

  try {
    // 1단계: 폴더 목록 수집
    const dateDirs = [];
    for await (const entry of photoFolderHandle.values()) {
      if (entry.kind !== 'directory') continue;
      if (!/^\d{4}-\d{2}-\d{2}/.test(entry.name)) continue;
      dateDirs.push(entry);
    }
    console.log(`[인덱스] ${dateDirs.length}개 폴더 발견`);

    // 2단계: 병렬로 _session.json 모두 읽기 (10개씩 배치)
    const BATCH = 10;
    for (let i = 0; i < dateDirs.length; i += BATCH) {
      const batch = dateDirs.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(async (entry) => {
        try {
          const sf = await entry.getFileHandle('_session.json');
          const f = await sf.getFile();
          const data = JSON.parse(await f.text());
          return { name: entry.name, data };
        } catch(e) { return null; }
      }));

      for (const r of results) {
        scanned++;
        if (!r) { errored++; continue; }
        const entry = sessionToIndexEntry(r.name, r.data);
        if (entry) { works.push(entry); ok++; }
        else errored++;
      }

      if (onProgress) onProgress(scanned, dateDirs.length);
    }

    const indexData = {
      version: INDEX_VERSION,
      updatedAt: (typeof kstIsoString === 'function') ? kstIsoString() : new Date().toISOString(),
      works
    };
    await saveWorkIndex(indexData);
    console.log(`[인덱스] 재빌드 완료: ${ok}건 성공, ${errored}건 실패`);
    return indexData;
  } catch(e) {
    console.error('[인덱스] 재빌드 실패:', e);
    return null;
  }
}
window.rebuildIndexFromFolders = rebuildIndexFromFolders;

// 인덱스 무효화 (강제 재로드)
function invalidateWorkIndex() {
  _indexCache = null;
  _indexLoaded = false;
}
window.invalidateWorkIndex = invalidateWorkIndex;

// 사용자가 호출할 수 있는 공개 API
window.getWorkIndex = async function() {
  let idx = await loadWorkIndex();
  if (!idx) {
    // 인덱스 없음 → 폴더 스캔으로 재빌드
    idx = await rebuildIndexFromFolders();
  }
  return idx;
};

// ★ 사용자가 명시적으로 호출하는 재빌드
window.rebuildWorkIndex = async function() {
  if (!photoFolderHandle) {
    alert('저장 폴더가 설정되어 있어야 해요.');
    return;
  }
  const ok = confirm(
    '🔄 작업기록 재생성\n\n' +
    '폴더 전체를 스캔해서 작업 목록을 다시 만듭니다.\n' +
    '작업이 많으면 1~2분 걸릴 수 있어요.\n\n' +
    '계속할까요?'
  );
  if (!ok) return;

  // 설정 모달 닫기
  document.getElementById('settingsModal')?.classList.remove('open');

  if (typeof setAppBusy === 'function') setAppBusy(true, '🔄 작업기록 재생성 중...');
  try {
    const result = await rebuildIndexFromFolders((cur, total) => {
      if (typeof setAppBusy === 'function') {
        setAppBusy(true, `🔄 작업기록 재생성 중... ${cur}/${total}`);
      }
    });
    if (result) {
      // 메모리 캐시도 무효화
      if (typeof invalidateRecordsCache === 'function') invalidateRecordsCache();
      alert(`✅ 작업기록 재생성 완료!\n\n총 ${result.works.length}개 작업이 등록되었습니다.`);
    } else {
      alert('재생성 실패. 다시 시도해주세요.');
    }
  } catch(e) {
    alert('재생성 실패: ' + e.message);
  } finally {
    if (typeof setAppBusy === 'function') setAppBusy(false);
  }
};

// ★ 앱 시작 시 - 인덱스 차분 동기화 (있으면 변경분만, 없으면 전체)
let _autoBuildAttempted = false;
async function autoBuildIndexIfMissing() {
  if (_autoBuildAttempted) return;  // 한 번만
  _autoBuildAttempted = true;

  if (!photoFolderHandle) return;
  try {
    // 권한 체크
    const perm = await photoFolderHandle.queryPermission({ mode: 'read' });
    if (perm !== 'granted') return;

    // ★ 차분 동기화 (인덱스 있으면 변경분만, 없으면 전체)
    console.log('[인덱스] 백그라운드 동기화 시작');
    await syncIndexWithFolders((cur, total) => {
      if (cur === total) console.log(`[인덱스] 동기화 완료: ${total}건 처리`);
    });
  } catch(e) {
    console.warn('[인덱스] 동기화 실패:', e.message);
  }
}
window.autoBuildIndexIfMissing = autoBuildIndexIfMissing;

// ★ 차분 동기화 - 인덱스 활용 + 변경된 폴더만 처리
async function syncIndexWithFolders(onProgress) {
  if (!photoFolderHandle) return null;

  // 1단계: 인덱스 로드
  let index = await loadWorkIndex();
  if (!index) {
    // 인덱스 자체가 없으면 전체 재빌드
    console.log('[인덱스 동기화] 인덱스 없음 → 전체 재빌드');
    return await rebuildIndexFromFolders(onProgress);
  }

  // ★ 인덱스 버전이 낮으면 마이그레이션 (전체 재빌드)
  if (!index.version || index.version < INDEX_VERSION) {
    console.log(`[인덱스 동기화] 버전 업그레이드 필요 (${index.version || 0} → ${INDEX_VERSION}) - 전체 재빌드`);
    return await rebuildIndexFromFolders(onProgress);
  }

  // 2단계: 실제 폴더 목록만 빠르게 수집 (파일 안 읽음)
  const folderNames = new Set();
  try {
    for await (const entry of photoFolderHandle.values()) {
      if (entry.kind !== 'directory') continue;
      if (!/^\d{4}-\d{2}-\d{2}/.test(entry.name)) continue;
      folderNames.add(entry.name);
    }
  } catch(e) {
    console.warn('[인덱스 동기화] 폴더 목록 실패:', e.message);
    return index;  // 기존 인덱스 그대로 사용
  }

  // 3단계: 인덱스 항목과 비교
  const indexedNames = new Set(index.works.map(w => w.folderName));

  // 삭제된 폴더 (인덱스에는 있는데 실제로 없음)
  const removed = [...indexedNames].filter(n => !folderNames.has(n));
  // 추가된 폴더 (실제로는 있는데 인덱스에 없음)
  const added = [...folderNames].filter(n => !indexedNames.has(n));

  if (removed.length === 0 && added.length === 0) {
    console.log(`[인덱스 동기화] 변경 없음 (인덱스 ${index.works.length}건)`);
    return index;
  }

  console.log(`[인덱스 동기화] 변경 감지 - 삭제 ${removed.length}건, 추가 ${added.length}건`);

  // 4단계: 삭제된 항목 제거
  if (removed.length > 0) {
    const removedSet = new Set(removed);
    index.works = index.works.filter(w => !removedSet.has(w.folderName));
  }

  // 5단계: 추가된 폴더만 _session.json 읽기 (10개씩 병렬)
  if (added.length > 0) {
    const BATCH = 10;
    let scanned = 0;
    for (let i = 0; i < added.length; i += BATCH) {
      const batch = added.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(async (name) => {
        try {
          const dir = await photoFolderHandle.getDirectoryHandle(name);
          const sf = await dir.getFileHandle('_session.json');
          const f = await sf.getFile();
          const data = JSON.parse(await f.text());
          return { name, data };
        } catch(e) { return null; }
      }));

      for (const r of results) {
        scanned++;
        if (!r) continue;
        const entry = sessionToIndexEntry(r.name, r.data);
        if (entry) index.works.push(entry);
      }
      if (onProgress) onProgress(scanned, added.length);
    }
  }

  // 6단계: 인덱스 저장
  index.updatedAt = (typeof kstIsoString === 'function') ? kstIsoString() : new Date().toISOString();
  await saveWorkIndex(index);
  console.log(`[인덱스 동기화] 완료 - 최종 ${index.works.length}건`);

  return index;
}
window.syncIndexWithFolders = syncIndexWithFolders;
