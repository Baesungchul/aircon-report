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
  // 썸네일 비활성화 시 큐 비우고 종료
  if (typeof window !== 'undefined' && window.THUMBNAILS_ENABLED === false) {
    _pendingThumbGen.length = 0;
    return;
  }
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

/* 현재 데이터의 빠른 스냅샷 (변경 비교용 - 사진 ID + 호수명 + 특이사항 + 업종)
   ⭐ 2026-08-23 버그수정 — "작업탭에서 업종을 바꿔도 저장하라는 말이 없고, 달력에도 안 붙는다"
     탭 이탈·새작업 가드(events.js)와 saveToFolder 의 '변경 없음 스킵'은 _dataDirty 를 보지 않고
     오직 이 스냅샷 문자열만 비교한다("dirty 플래그는 거짓 양성 많음"이라 일부러 그렇게 만들었다).
     그런데 여기에 업종이 빠져 있어서, 업종만 바꾸면 스냅샷이 그대로 → '변경 없음' → 저장 자체가 건너뛰어졌다.
     그래서 _session.json 에 새 업종이 안 써지고(folder.js 의 stampForCurrentWork 가 실행될 일이 없음),
     달력은 계속 옛 업종을 보여줬다.
   ⚠️ 스냅샷에 안 담기는 값은 '바뀌어도 저장되지 않는다'. 표시용이 아닌 필드를 새로 추가하면 여기도 같이 넣을 것. */
function quickSnapshot() {
  try {
    const apt = document.getElementById('aptName')?.value || '';
    const pid = (function () { try { return window._workProfileId || ''; } catch (e) { return ''; } })();
    const date = document.getElementById('workDate')?.value || '';
    const worker = document.getElementById('workerName')?.value || '';
    const wt = currentWorkType || 'household';
    const fc = (wt === 'facility' && facilityCustomer)
      ? `${facilityCustomer.phone||''}|${facilityCustomer.contact||''}|${facilityCustomer.address||''}|${facilityCustomer.memo||''}`
      : '';
    const unitsKey = (units || []).map(u => {
      const bIds = (u.before || []).filter(p => !p._borrowedIncoming).map(p => p.id || p.name || '').join('|');
      const aIds = (u.after || []).filter(p => !p._borrowedIncoming).map(p => p.id || p.name || '').join('|');
      const sp = (u.specials || []).map(s => (s.desc||'') + ':' + (s.photos||[]).filter(p=>!p._borrowedIncoming).length).join(';');
      const cust = u.customer ? `${u.customer.name||''}|${u.customer.phone||''}|${u.customer.address||''}|${u.customer.memo||''}` : '';
      return `${u.name||''}::${bIds}::${aIds}::${sp}::${cust}`;
    }).join('@@');
    return `${apt}|${date}|${worker}|${wt}|${pid}|${fc}|${unitsKey}`;
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

  // ★ 작업자 비어 있으면 기본값 자동채움 (내 닉네임 → 최근 사용 이름)
  //   기본값조차 없을 때(최초 사용 등)만 저장 차단 + 안내
  const _wkReq = document.getElementById('workerName');
  if (_wkReq && !(_wkReq.value || '').trim()) {
    let _defW = '';
    try { if (window.WorkerCombo && WorkerCombo.defaultName) _defW = WorkerCombo.defaultName(); } catch (e) {}
    if (_defW) {
      _wkReq.value = _defW;
      try { const _ws = document.getElementById('workerNickSel'); if (_ws) _ws.value = _defW; } catch (e) {}
    }
  }
  if (!_wkReq || !(_wkReq.value || '').trim()) {
    showToast('작업자를 선택해주세요', 'err');
    try { _wkReq && _wkReq.focus(); } catch (e) {}
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

  /* ★ 2026-08-23 업종은 '저장을 시작한 이 순간'의 값으로 못 박는다.
       아래에서 백그라운드 저장 완료를 기다리고 권한 확인도 await 하는데,
       그 사이 사용자가 다른 작업을 열면 window._workProfileId 가 그 작업 값으로 바뀐다.
       그때 sessionData 를 만들면 **이전 작업에 남의 업종이 박힌다**(units 가 swap 되던 것과 같은 부류).
       → 여기서 한 번만 읽어 두고 그 값을 쓴다. */
  const _pidStamp = (function () {
    try { return (window.Profiles && Profiles.stampForCurrentWork) ? Profiles.stampForCurrentWork() : null; }
    catch (e) { return null; }
  })();

  // ★ 백그라운드 저장 중이면 완료 대기 (1.253)
  //   - 백그라운드 저장은 전역 currentFolderName을 이전 작업으로 swap함
  //   - 그 사이 사용자가 새 작업을 저장하면 이전 작업 폴더에 덮어써짐 (작업 소실!)
  //   - 백그라운드 저장이 끝나면 currentFolderName이 올바른 값(null=새작업)으로 복원됨
  if (typeof window !== 'undefined' && window._isSavingInBackground && !opts._fromBackground) {
    console.log('[저장] 백그라운드 저장 중 - 완료 대기');
    let waited = 0;
    while (window._isSavingInBackground && waited < 15000) {
      await new Promise(r => setTimeout(r, 100));
      waited += 100;
    }
    console.log(`[저장] 백그라운드 저장 완료 대기 끝 (${waited}ms)`);
  }

  // ★ 변경 없으면 스킵 (수동/자동 모두, force 아닐 때)
  if (!isForced) {
    const currentSnap = quickSnapshot();
    if (!_dataDirty && currentSnap === _lastSaveSnapshot) {
      console.log('✓ 변경 없음 - 저장 스킵');
      if (!isAutoSave) showToast('✓ 이미 저장됨', 'ok');
      return { skipped: true, reason: 'no_changes' };
    }
  }

  // ★ _workNum 확정 (2026-08-09)
  //   번호는 유닛 객체(u._workNum)에 귀속된다. 없으면 여기서 미사용 최소번호를 발급해 고정.
  //   이름을 키로 쓰지 않으므로 호수명을 바꿔도 폴더 번호가 흔들리지 않고,
  //   백그라운드 저장(units 가 이전 작업으로 swap됨) 중에도 안전하다.
  if (typeof getWorkNumberForUnit === 'function') {
    units.forEach(u => { try { getWorkNumberForUnit(u); } catch (e) {} });
  }

  // ★ 권한 확인 (오버레이 전에)
  //   - 백그라운드/자동 저장: queryPermission만 (팝업 X) → 권한 없으면 즉시 포기 (hang 방지)
  //   - 수동 저장(사용자가 직접 저장 버튼): requestPermission으로 팝업 띄움
  const isBackgroundOrAuto = opts._fromBackground === true || isAutoSave === true || isSilent === true;
  let permOk = false;
  try {
    if (isBackgroundOrAuto) {
      // 팝업 없이 현재 권한만 확인 (즉시 반환 - hang 없음)
      const q = await Promise.race([
        photoFolderHandle.queryPermission({ mode: 'readwrite' }),
        new Promise((res) => setTimeout(() => res('prompt'), 2000))
      ]);
      permOk = (q === 'granted');
      if (!permOk) {
        // 백그라운드에서 권한 없음 → 조용히 포기 (UI 안 막음, 세션은 IndexedDB에 이미 저장됨)
        console.warn('[저장] 폴더 권한 없음 - 백그라운드 저장 건너뜀 (IndexedDB 백업은 유지)');
        return { skipped: true, reason: 'no_permission_background' };
      }
    } else {
      // 수동 저장 - 팝업 허용 (사용자 제스처 컨텍스트)
      const permResult = await Promise.race([
        photoFolderHandle.requestPermission({ mode: 'readwrite' }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('권한 요청 시간 초과 (10초)')), 10000)
        )
      ]);
      permOk = (permResult === 'granted');
    }
  } catch(e) {
    if (!isBackgroundOrAuto) showToast('⚠️ 폴더 권한 오류: ' + e.message, 'err');
    return { skipped: true, reason: 'perm_error' };
  }
  if (!permOk) {
    if (!isBackgroundOrAuto) showToast('폴더 쓰기 권한이 거부되었습니다', 'err');
    return { skipped: true, reason: 'no_permission' };
  }

  // ★ 공유 작업(빌려보기) 저장 - 일반 로컬 폴더 저장을 건너뛰고
  //   원본 소유자의 클라우드 항목에 새 사진만 병합("같은 작업에 진짜 보태기")
  if (typeof window !== 'undefined' && window._borrowedShare && window._borrowedShare.workId) {
    try {
      const result = (typeof CloudPhotoSync !== 'undefined' && CloudPhotoSync.saveBorrowedPhotos)
        ? await CloudPhotoSync.saveBorrowedPhotos(units)
        : { uploaded: 0 };
      /* ⭐ 2026-08-13: 공유 작업 저장이 '사진만' 올리고 있었다.
         그래서 작업탭에서 작업자나 작업일자를 바꿔도 어디에도 반영되지 않았다
         (스케줄 상세창에서 바꾸면 되는데 작업탭에서는 안 되던 이유).
         ⚠️ 여기서 보내는 건 작업탭 헤더의 세 가지(작업자·작업일자·작업명)뿐이다.
            호수별 고객정보는 빌려보기 화면에 전부 로드되지 않을 수 있어,
            같이 보내면 원작업자의 원본을 빈 값으로 지울 수 있다. 절대 넓히지 말 것. */
      try {
        const _bs = window._borrowedShare;
        if (_bs && window.CloudShare && CloudShare.editItem) {
          const _gv = (id) => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
          const _nw = _gv('workerName'), _nd = _gv('workDate'), _na = _gv('aptName');
          const _cur = (CloudShare.findSharedItem ? CloudShare.findSharedItem(_bs.ownerUid, _bs.workId) : null) || {};
          const _f = {};
          if (_nw && _nw !== (_cur.worker || '')) _f.worker = _nw;
          if (_na && _na !== (_cur.apt || '')) _f.apt = _na;
          /* 작업유형: 호수를 2개 이상 만들면 공용시설이어야 한다(가정용은 1호수 전용).
             클라우드 표기는 'facility'/'home' — 로컬의 'household' 와 다르니 변환해서 보낸다. */
          const _nt = (typeof currentWorkType !== 'undefined' && currentWorkType === 'facility') ? 'facility' : 'home';
          if (_nt !== (_cur.workType || 'home')) _f.workType = _nt;
          if (_nd && _nd !== (_cur.date || '')) {
            // 사진 폴더가 있는 작업은 원작업자 폴더명이 날짜 기준이라 다른 달로는 못 옮긴다
            const _hasFolder = !_cur.manual && String(_bs.workId || '').indexOf('m_') !== 0;
            if (_hasFolder && _cur.date && _nd.slice(0, 7) !== String(_cur.date).slice(0, 7)) {
              if (!isSilent) showToast('사진이 있는 공유 작업은 같은 달 안에서만 날짜를 옮길 수 있습니다', 'err');
            } else {
              _f.date = _nd;
            }
          }
          /* ★ 2026-08-23 업종 — 작업탭 칩에서 바꾼 업종을 원작업자에게도 보낸다.
               ProfilesUI.applyWorkProfile 이 고르는 즉시 한 번 보내지만, 그때 통신이
               끊겨 있었으면 그대로 어긋난 채 굳는다. 저장 때 한 번 더 맞춘다(안전망).
             ⚠️ 비교는 '내 업종으로 맞춘 id' 끼리 — 폰마다 id 가 달라 그냥 비교하면 늘 다르다. */
          try {
            const _st = (window.Profiles && Profiles.stampForCurrentWork) ? Profiles.stampForCurrentWork() : null;
            if (_st && _st.profileId) {
              const _cpid = _cur.profileId || '';
              const _cown = (window.Profiles && Profiles.ownOf)
                ? Profiles.ownOf({ profileId: _cpid, profileSnap: _cur.profileSnap || null }) : null;
              if (_st.profileId !== (_cown ? _cown.id : _cpid)) {
                _f.profileId   = _st.profileId;
                _f.profileSnap = _st.profileSnap || null;
                _f.profileIcon = (_st.profileSnap && _st.profileSnap.icon) || '';
                _f.profileName = (_st.profileSnap && _st.profileSnap.name) || '';
              }
            }
          } catch (e) { console.warn('[저장] 공유 작업 업종 반영 실패', e); }
          if (Object.keys(_f).length) {
            CloudShare.editItem(_bs.ownerUid, _bs.workId, _f).catch(function () {});
          }
        }
      } catch (e) { console.warn('[저장] 공유 작업 정보 반영 실패', e); }
      if (typeof quickSnapshot === 'function') _lastSaveSnapshot = quickSnapshot();
      _dataDirty = false;
      if (!isSilent) {
        showToast(result && result.uploaded > 0
          ? `✓ 사진 ${result.uploaded}장을 공유 작업에 추가했습니다`
          : '✓ 저장 완료 (새 사진 없음)', 'ok');
      }
      return { borrowed: true, uploaded: result && result.uploaded };
    } catch (e) {
      console.warn('[저장] 공유 작업 병합 실패', e);
      if (!isSilent) showToast('⚠️ 공유 작업 저장 실패: ' + e.message, 'err');
      return { skipped: true, reason: 'borrowed_save_error' };
    }
  }

  // ★ 작업자(닉네임) 필수 (2026-07-11): 공유 사용 중에는 작업자 선택 없이 수동 저장 불가
  //   (자동/백그라운드 저장은 데이터 보호를 위해 차단하지 않음)
  if (!isBackgroundOrAuto && window.CloudShare && CloudShare.workerRequired && CloudShare.workerRequired()) {
    const _wkEl = document.getElementById('workerName');
    if (!_wkEl || !String(_wkEl.value || '').trim()) {
      showToast('👤 작업자를 선택해주세요 (필수)', 'err');
      try { const _ws = document.getElementById('workerNickSel'); if (_ws && _ws.focus) _ws.focus(); } catch (e) {}
      return { skipped: true, reason: 'no_worker' };
    }
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

    // ★★ 안전 강화: 사진 파일은 절대 삭제하지 않음 ★★
    // 이전엔 "expectedFiles에 없으면 삭제"로 원본 사진이 사라지는 버그 발생
    // 이제는 작업 자체가 명시적으로 사진 삭제를 의도한 경우 외엔 손대지 않음
    //
    // 디스크의 사진은 단일 진실 공급원. 메모리에 사진 객체가 없어도
    // 사용자가 명시적으로 삭제한 게 아니라면 디스크 사진은 보존.
    //
    // 정리는 다음 두 가지만:
    // 1) 빈 work 폴더 제거 (사진이 0장인 호수)
    // 2) work 폴더 자체가 메모리 units에 없는 경우 (호수 삭제됨)
    try {
      const oldDir = await photoFolderHandle.getDirectoryHandle(dateFolderName);

      // 메모리에 있는 workNum 목록
      const memoryWorkNums = new Set();
      units.forEach(u => {
        const workNum = String(u._workNum || getWorkNumber(u.name)).padStart(2,'0');
        memoryWorkNums.add(`work${workNum}`);
      });

      // 디스크 work 폴더 순회 - 메모리에 없는 폴더만 삭제 (호수 자체가 삭제된 경우)
      // ★ 단 호수 삭제는 사용자가 명시적으로 했을 때만 발생하므로 안전
      const dirsToRemove = [];
      for await (const [workName, workHandle] of oldDir.entries()) {
        if (workHandle.kind !== 'directory' || !/^work\d+/.test(workName)) continue;
        if (!memoryWorkNums.has(workName)) {
          dirsToRemove.push(workName);
        }
      }
      for (const workName of dirsToRemove) {
        try {
          // ★★ 안전장치 (2026-08-09) ★★
          // 번호가 어긋나면 정상 사진 폴더가 "삭제된 호수"로 오판될 수 있다.
          // 사진 파일이 한 장이라도 들어있으면 절대 지우지 않는다 (빈 폴더만 정리).
          let photoCount = 0;
          try {
            const wh = await oldDir.getDirectoryHandle(workName);
            for await (const [fn, fh] of wh.entries()) {
              if (fh.kind === 'file' && /\.(jpg|jpeg|png)$/i.test(fn)) { photoCount++; break; }
            }
          } catch(e) { photoCount = 1; }  // 확인 실패 시 보수적으로 보존
          if (photoCount > 0) {
            console.warn(`⛔ ${workName} 에 사진이 있어 삭제하지 않음 (번호 불일치 의심)`);
            continue;
          }
          await oldDir.removeEntry(workName, { recursive: true });
          console.log(`🗑️ 빈 호수 폴더 정리: ${workName}`);
        } catch(e) {
          console.warn(`폴더 ${workName} 삭제 실패:`, e.message);
        }
      }
    } catch(e) {
      console.warn('기존 폴더 정리 실패:', e.message);
    }
  } else {
    // ★ 새 작업 → 표준 폴더명(작업일자_시분초). 모든 저장 경로가 이 폴더를 재사용한다.
    const base = (typeof getWorkFolderName === 'function')
      ? getWorkFolderName()
      : `${date}_${Date.now()}`;
    // 같은 초에 만들어진 폴더가 이미 있으면 순번(-N) 부여 (충돌 방지)
    let candidate = base, n = 1;
    while (n < 50) {
      try {
        await photoFolderHandle.getDirectoryHandle(candidate);
        candidate = base + '-' + (++n);
      } catch(e) { break; }
    }
    dateFolderName = candidate;
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
        if (p._borrowedIncoming) { skippedPhotos++; continue; }  // ★ 규칙1: 상대가 보탠 사진은 내 폴더에 쓰지 않음
        if (p.savedToFolder) { skippedPhotos++; continue; }  // ★ 이미 저장됨
        tasks.push(
          doWriteOne(p, u.name, '전')
            .then(() => { saved++; p.savedToFolder = true; })
            .catch(e => { failed++; console.warn('사진 저장 실패:', e.message); })
        );
      }
      for (let i = 0; i < u.after.length; i++) {
        const p = u.after[i];
        if (p._borrowedIncoming) { skippedPhotos++; continue; }  // ★ 규칙1: 상대가 보탠 사진은 내 폴더에 쓰지 않음
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
          if (p._borrowedIncoming) { skippedPhotos++; continue; }  // ★ 규칙1: 상대가 보탠 사진은 내 폴더에 쓰지 않음
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
    posts: (typeof workPosts !== 'undefined' && Array.isArray(workPosts)) ? workPosts : [],  // ★ 글작성 저장글
    postMemo: (typeof workPostMemo !== 'undefined') ? String(workPostMemo || '') : '',  // ★ 글작성 참고메모(작업 귀속) — 저장
    endDate: (typeof currentWorkEndDate !== 'undefined' ? currentWorkEndDate : '') || '',  // ★ 작업 종료일(여러 날 작업)
    facilityCustomer: currentWorkType === 'facility' ? {
      phone: facilityCustomer.phone || '',
      contact: facilityCustomer.contact || '',
      address: facilityCustomer.address || '',
      memo: facilityCustomer.memo || '',
      workTarget: facilityCustomer.workTarget || '',
      price: facilityCustomer.price || '',
      startTime: facilityCustomer.startTime || '',
      endTime: facilityCustomer.endTime || ''
    } : null,
    savedAt: kstIsoString(),
    /* ⭐⭐ 2026-08-23 진짜 근본원인 — 이 작업의 업종.
         업종은 folder.js 의 sessionAutoSaveNow() 안에만 있었고, 그건 **IndexedDB 전용**이다.
         진짜 폴더 저장(여기 sessionData → _session.json)에는 **업종이 아예 없었다.**
         달력은 _session.json 을 읽으므로(calendar.js scanFoldersDirect → session: data)
         내 작업의 업종은 영영 달력에 반영되지 않았고, 작업을 다시 열어도 빈 값이라
         '업종 선택'으로 되돌아갔다. 화면에만 잠깐 보이고 setCurrent 만 남으니
         사용자 눈엔 "앱 전체 기본값만 바뀐다"로 보였다(사용자 진단이 정확했다).
         ⚠️ 공유 수정 경로(calendar.js applyCloudEditToLocal, cloud_photo_sync)는
            _session.json 에 profileId 를 직접 써왔다 — 그래서 공유작업만 되는 것처럼 보였다. */
    profileId:   (_pidStamp && _pidStamp.profileId) || '',
    profileSnap: (_pidStamp && _pidStamp.profileSnap) || null,
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
        if (p._borrowedIncoming) return null;  // ★ 상대가 보탠 사진은 내 세션에 저장 안 함(열 때마다 클라우드에서 재병합)
        return {
          fname: p.fileName || null,           // 디스크 파일명 (불러올 때 매칭용)
          thumb: p.thumbDataUrl || null,       // 작은 썸네일 (앱 화면용)
          /* ★ 2026-08-13 사진 고유번호(pid). 찍는 순간 발급된 id 를 그대로 영구 보존한다.
             순서를 바꾸든 작업 전↔후로 옮기든 이 값은 안 바뀐다.
             ⚠️ '이미 올렸다'(_cloudUploaded)는 여기 저장하지 않는다 —
                작업을 열 때마다 false 로 시작해 저장 시 재확인하는 자가치유를 반드시 유지할 것.
                (그걸 저장했다가 일시적 사고가 영구 유실로 바뀔 뻔했다)
             설계 전문: 메모리 project_photo_pid_design */
          pid: p.id || null
        };
      };
      const _own = (arr) => (arr || []).filter(p => p && !p._borrowedIncoming);  // ★ 상대 보탠 것 제외
      return {
        name: u.name,
        workNum: u._workNum || getWorkNumber(u.name),
        beforeCount: (u._photosOnDisk?.skipPhotoSync) ? (u._photosOnDisk.before || 0) : _own(u.before).length,
        afterCount: (u._photosOnDisk?.skipPhotoSync) ? (u._photosOnDisk.after || 0) : _own(u.after).length,
        // ★ 사진 메타데이터 - 폴더 스캔 없이 바로 사용 가능
        beforeMeta: u.before.map(mapPhotoMeta).filter(Boolean),
        afterMeta: u.after.map(mapPhotoMeta).filter(Boolean),
        specials: u.specials.map((s, si) => ({
          desc: s.desc,
          photoCount: (u._photosOnDisk?.skipPhotoSync) ? (u._photosOnDisk.specials?.[si] || 0) : _own(s.photos).length,
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
        // ★ A안: customers.xlsx는 동기 await 안 함 - 저장 속도 우선
        //    뒤쪽 디바운스 큐가 백그라운드에서 처리 (line 426)
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
    // ★ V2 캐시도 무효화 (60초 TTL 무시하고 강제 재계산)
    if (typeof invalidateCustomersV2 === 'function') {
      invalidateCustomersV2();
    }
    // ★ 작업기록 캐시 무효화 + 백그라운드 재빌드
    if (typeof invalidateRecordsCache === 'function') {
      invalidateRecordsCache();
    }
    // ★ 공유 사진 클라우드 동기화 - 공유 중일 때만 백그라운드로 업로드(서버 사용량 방지)
    if (typeof CloudPhotoSync !== 'undefined' && CloudPhotoSync.autoUploadPhotos) {
      try { CloudPhotoSync.autoUploadPhotos(dateFolderName, units); } catch (e) { console.warn('[CloudPhotoSync] 호출 실패', e); }
    }
    // ★★ 작업 인덱스 즉시 갱신 (1.5초 디바운스로 파일에 쓰기)
    if (typeof scheduleIndexUpdate === 'function' && dateFolderName) {
      try {
        const indexEntry = sessionToIndexEntry(dateFolderName, sessionData);
        if (indexEntry) scheduleIndexUpdate(indexEntry);
      } catch(e) { console.warn('[인덱스] 갱신 실패:', e.message); }
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
            // ★ 2026-08-30 고객명 입력칸이 생겨 명시 전달. 비어 있으면 기존 이름 보존,
            //   신규 고객이면 customerSave 내부 폴백(visit.unit=호수명)이 그대로 적용된다.
            name: u.customer.name || undefined,
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
    // 저장으로 일정/시작시간이 바뀌었을 수 있으니 알림 재예약
    try { if (window.Notify && Notify.refresh) setTimeout(function(){ Notify.refresh(); }, 1200); } catch(e) {}
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

    // ★ 뒷정리는 purgeWorkEverywhere 한 곳에서 (인덱스·캐시·백업거울·클라우드휴지통·화면초기화)
    if (typeof window.purgeWorkEverywhere === 'function') {
      await window.purgeWorkEverywhere(target.name, { cloud: true });
    }

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
  // ★ workId 우선 비교 - 같은 apt+date라도 workId 다르면 다른 작업
  //   (이전: apt+date만 비교 → 같은 날 같은 아파트의 다른 호수 작업이 "이미 현재 작업"으로 잘못 판정되어 안 열림)
  try {
    if (data.workId && currentWorkId && data.workId === currentWorkId) {
      document.getElementById('slModal')?.classList.remove('open');
      document.getElementById('customerModal')?.classList.remove('open');
      showToast('이미 현재 작업입니다', 'ok');
      return;
    }
    // workId가 양쪽 다 없을 때만 apt+date 폴백
    if (!data.workId && !currentWorkId) {
      const curApt = (document.getElementById('aptName').value || '').trim();
      const curDate = (document.getElementById('workDate').value || '').trim();
      if (curApt === (data.apt || '').trim() && curDate === (data.date || '').trim()) {
        document.getElementById('slModal')?.classList.remove('open');
        document.getElementById('customerModal')?.classList.remove('open');
        showToast('이미 현재 작업입니다', 'ok');
        return;
      }
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
/* ══════════════════════════════════════════════════════════
   작업 불러오기 — 중단 안전장치 (2026-08-09)
   ----------------------------------------------------------------
   문제: 사진이 없거나 폴더가 느려 로딩이 길어질 때 뒤로가기를 누르면
         복원이 중간에 끊긴 채 빠져나온다. units·currentFolderName 등
         전역 상태가 반쯤 채워진 상태로 남아, 다음 작업을 열면 에러가 났다.
   해결: ① 로딩 중 뒤로가기 차단(연속 2회면 '중단할까요?' 확인 → 탈출구는 남김)
         ② 로딩 중 다른 작업 열기 차단
         ③ 성공·실패·중단 어느 쪽이든 finally 에서 상태를 반드시 정리
══════════════════════════════════════════════════════════ */
window._workLoading = false;
window._workLoadAbort = false;

// 반쯤 열린 상태를 깨끗이 되돌린다 (다음 작업 열기가 정상 동작하도록)
window.resetWorkState = function () {
  try { if (window.CloudPhotoSync && CloudPhotoSync.stopLivePhotoSync) CloudPhotoSync.stopLivePhotoSync(); } catch (e) {}
  try { units = []; nid = 1; } catch (e) {}
  try { currentWorkId = ''; } catch (e) {}
  try { currentFolderName = null; } catch (e) {}
  if (typeof resetWorkGlobals === 'function') resetWorkGlobals();
  try { if (typeof facilityCustomer !== 'undefined') facilityCustomer = { phone: '', contact: '', address: '', memo: '' }; } catch (e) {}
  try { if (typeof _indexCounter !== 'undefined') _indexCounter.clear(); } catch (e) {}
  try { if (typeof _unitWorkNumber !== 'undefined') _unitWorkNumber.clear(); } catch (e) {}
  try { if (typeof _savedPhotoIds !== 'undefined') _savedPhotoIds.clear(); } catch (e) {}
  try { if (typeof _dataDirty !== 'undefined') _dataDirty = false; } catch (e) {}
  try { if (typeof quickSnapshot === 'function') _lastSaveSnapshot = quickSnapshot(); } catch (e) {}
  try { if (typeof renderAll === 'function') renderAll(); if (typeof updateStats === 'function') updateStats(); } catch (e) {}
};

// 사용자가 로딩을 중단시킬 때
window.abortWorkLoad = function () {
  window._workLoadAbort = true;
  try { if (typeof hideOverlay === 'function') hideOverlay(); } catch (e) {}
  window.resetWorkState();
  try { if (typeof showToast === 'function') showToast('불러오기를 중단했어요', 'err'); } catch (e) {}
};

async function restoreFromData(data, dateDir) {
  // ★ 이미 다른 작업을 불러오는 중이면 무시 (상태 뒤엉킴 방지)
  if (window._workLoading) {
    if (typeof showToast === 'function') showToast('작업을 불러오는 중이에요. 잠시만요', 'err');
    return;
  }
  window._workLoading = true;
  window._workLoadAbort = false;
  try {
    return await _restoreFromDataInner(data, dateDir);
  } catch (e) {
    console.error('[작업열기] 실패:', e);
    // ★ 반쯤 열린 상태를 남기지 않는다 — 이게 "다음 작업이 안 열림"의 원인이었다
    window.resetWorkState();
    try { if (typeof hideOverlay === 'function') hideOverlay(); } catch (e2) {}
    if (typeof showToast === 'function') {
      showToast('작업을 열지 못했습니다: ' + (e && e.message ? e.message : '알 수 없는 오류'), 'err');
    }
  } finally {
    window._workLoading = false;
    window._workLoadAbort = false;
    try { if (typeof hideOverlay === 'function') hideOverlay(); } catch (e) {}
  }
}

async function _restoreFromDataInner(data, dateDir) {
  // ★ 사진은 무조건 복원 (질문 제거 - 항상 사진까지 불러옴)
  const restorePhotos = !!dateDir;

  showOverlay('불러오는 중...');

  // ★ workId 복원
  if (window.CloudPhotoSync && CloudPhotoSync.stopLivePhotoSync) CloudPhotoSync.stopLivePhotoSync();
  currentWorkId = data.workId || generateWorkId();
  console.log('[workId] 작업 불러옴:', currentWorkId, data.workId ? '(기존)' : '(신규 발급)');

  // ★ 공유 작업 빌려보기 모드 해제 (내 작업을 정식으로 여는 것이므로)
  window._borrowedShare = null;

  // ★ 불러온 폴더명 저장 - 저장 시 이 폴더에만 덮어씀 (새 폴더 만들지 않음)
  currentFolderName = dateDir ? dateDir.name : null;
  console.log('[folderName] 현재 작업 폴더:', currentFolderName || '(없음 - 새 폴더 생성됨)');

  // ★ workType 복원 (없으면 기본 가정용)
  currentWorkType = data.workType || 'household';
  // ★ 방어 보정: 저장본에 workType이 없거나 잘못된 경우 데이터로 추론
  //   - 호수가 2개 이상이면 가정용(=1호수)일 수 없음 → 공용시설
  //   - facilityCustomer에 값이 있으면 공용시설로 저장된 작업
  //   (구버전/누락 저장본이 가정용으로 잘못 열려 "1호수만" 알림이 뜨던 문제 해결)
  if (currentWorkType !== 'facility') {
    const fc = data.facilityCustomer;
    const fcHasData = !!(fc && (fc.phone || fc.contact || fc.address || fc.memo || fc.price || fc.startTime || fc.endTime));
    if ((data.units && data.units.length > 1) || fcHasData) {
      currentWorkType = 'facility';
      console.log('[workType] 데이터 추론 → 공용시설로 보정 (호수 ' + ((data.units||[]).length) + '개)');
    }
  }
  if (currentWorkType === 'facility' && data.facilityCustomer) {
    facilityCustomer = {
      phone: data.facilityCustomer.phone || '',
      contact: data.facilityCustomer.contact || '',
      address: data.facilityCustomer.address || '',
      memo: data.facilityCustomer.memo || '',
      workTarget: data.facilityCustomer.workTarget || '',
      price: data.facilityCustomer.price || '',
      startTime: data.facilityCustomer.startTime || '',
      endTime: data.facilityCustomer.endTime || ''
    };
  } else {
    facilityCustomer = { phone: '', contact: '', address: '', memo: '', price: '', startTime: '', endTime: '' };
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
  /* ★ 2026-08-08 저장글이 계속 사라지던 진짜 원인
       달력/기록에서 작업을 열면 여기 오는 data 는 '화면용으로 재구성된 객체'다.
       (calendar.js scanFoldersDirect 가 만드는 {folderName, apt, date, units, session:...} 형태,
        또는 localStorage 슬림캐시) — 여기엔 posts 가 최상위에 없다.
       그래서 data.posts 만 보면 항상 undefined → 글이 매번 빈 배열로 초기화됐다.
       (_session.json 에는 글이 멀쩡히 저장돼 있었는데 읽는 쪽이 안 본 것)
       → data.posts → data.session.posts → 폴더의 _session.json 순으로 확인한다. */
  workPosts = [];
  workPostMemo = '';
  try {
    /* ⚠️ 달력 슬림캐시는 배지용으로 posts 를 [1,1,1] 처럼 '개수만' 담는다(calendar.js _slimCalItems).
       그걸 진짜 글로 착각해 받아들이면 workPosts 가 숫자로 오염되고,
       그 상태로 저장되면 _session.json 의 진짜 글까지 덮어써 날려버린다.
       → 반드시 '글 모양(text 를 가진 객체)'인지 검사한 뒤에만 사용한다. */
    var _looksLikePosts = function (a) {
      return Array.isArray(a) && a.length > 0 &&
             a.every(function (x) { return x && typeof x === 'object' && typeof x.text === 'string'; });
    };
    var _pv = null, _pm = null;
    if (_looksLikePosts(data.posts)) { _pv = data.posts; _pm = data.postMemo; }
    else if (data.session && _looksLikePosts(data.session.posts)) { _pv = data.session.posts; _pm = data.session.postMemo; }
    if (!_pv && dateDir) {
      // 최후의 확인: 디스크의 _session.json 을 직접 읽는다(항상 진실)
      try {
        var _sfh = await dateDir.getFileHandle('_session.json');
        var _sj = JSON.parse(await (await _sfh.getFile()).text()) || {};
        if (_looksLikePosts(_sj.posts)) { _pv = _sj.posts; _pm = _sj.postMemo; }
        else if (typeof _sj.postMemo === 'string') { _pm = _sj.postMemo; }
      } catch (e) {}
    }
    workPosts = Array.isArray(_pv) ? _pv : [];
    workPostMemo = (typeof _pm === 'string') ? _pm : '';
    if (workPosts.length) console.log('[글작성] 저장된 글 복원:', workPosts.length + '건');
  } catch (e) { workPosts = []; workPostMemo = ''; }
  currentWorkEndDate = data.endDate || '';  // ★ 종료일 복원
  /* ★ 2026-08-16 이 작업의 업종을 전역에 싣는다(보고서 제목·호칭·지침이 여기서 갈린다).
       달력 슬림캐시로 열린 항목은 profileId 가 없을 수 있어 session 쪽도 본다.
       업종이 아예 없는 '이번 변경 이전' 작업이면 빈 값 → 지금 쓰는 업종으로 떨어진다. */
  try {
    var _pid = data.profileId || (data.session && data.session.profileId) || '';
    var _psn = data.profileSnap || (data.session && data.session.profileSnap) || null;
    if (window.Profiles) Profiles.bindWork(_pid, _psn);
    window._workProfileLoaded = true;   // ★ 저장된 작업을 연 것 — 업종이 비어 있으면 비운 채로 둔다
  } catch (e) {}

  // ★ 모든 호수의 workDir 핸들을 병렬로 미리 가져오기 (큰 속도 향상)
  let workDirMap = new Map();  // ui index → workDir handle
  let workDirFailed = [];      // 실패한 호수들 (진단용)

  // ★ 사진이 전혀 없는 작업이면 workDir 빌드 통째로 스킵 (1.247)
  //   - dateDir.entries() 전체 스캔이 안드로이드에서 의외로 느림 (수초 가능)
  //   - 사진 한 장도 없으면 어차피 workDir 안 씀
  const totalPhotos = (data.units || []).reduce((sum, u) => {
    return sum + (u.beforeCount || 0) + (u.afterCount || 0)
         + ((u.specials || []).reduce((s, sp) => s + (sp.photoCount || 0), 0));
  }, 0);
  const _tScan0 = Date.now();
  console.log(`[restore] 전체 사진 수: ${totalPhotos}`);

  // ★ 서버 백업 복구본(로컬 사진 없음)이면 원본 사진을 먼저 온디맨드 다운로드
  if (restorePhotos && dateDir && totalPhotos > 0 && window.CloudBackup && CloudBackup.ensureWorkPhotos) {
    try { await CloudBackup.ensureWorkPhotos(dateDir, data); } catch (e) { console.warn('[사진 온디맨드]', e && e.message); }
  }
  if (restorePhotos && dateDir && totalPhotos > 0) {
    console.log('[restore] workDir 스캔 시작');
    // ★ 사진 가끔 안 뜨는 버그: 열기 경로엔 권한 재확인이 없어, 앱 재시작 후 권한이 'prompt'로
    //   낮아지면 디렉터리 스캔이 조용히 0건 → 사진 로드 실패. 스캔 전에 권한을 보장한다.
    try {
      if (photoFolderHandle && photoFolderHandle.queryPermission) {
        let _pm = await photoFolderHandle.queryPermission({ mode: 'readwrite' });
        if (_pm !== 'granted' && photoFolderHandle.requestPermission) {
          try { _pm = await photoFolderHandle.requestPermission({ mode: 'readwrite' }); } catch (e) {}
        }
        if (_pm !== 'granted') console.warn('[작업열기] 폴더 권한 미확보(' + _pm + ') → 사진 스캔이 실패할 수 있음');
      }
    } catch (e) { console.warn('[작업열기] 권한 확인 오류:', e && e.message); }
    // ★ 사진 폴더 탐색: 세션 폴더 + 같은 날짜의 형제 폴더까지 모두 수집
    //   메인저장은 '날짜_시간' 폴더, 사진저장/자동저장은 '날짜' 폴더에 저장돼
    //   사진이 세션 폴더와 다른 폴더에 흩어질 수 있으므로 둘 다 뒤진다.
    const baseDate = String(data.date || dateDir.name || '').slice(0, 10);
    const allWorkDirs = [];  // { name, num, handle, parentName }
    async function _collectWork(pd) {
      try {
        for await (const [nm, ent] of pd.entries()) {
          if (ent.kind === 'directory' && /^work\d+/i.test(nm)) {
            const m = nm.match(/\d+/);
            allWorkDirs.push({ name: nm, num: m ? parseInt(m[0], 10) : 0, handle: ent, parentName: pd.name });
          }
        }
      } catch (e) {}
    }
    // ★★ 형제 폴더 소유권 확인 (2026-08-09) ★★
    //   같은 날 작업이 여러 건이면 폴더가 '날짜_시각'으로 나뉜다.
    //   예전엔 날짜 접두어만 보고 남의 작업 폴더에서 사진을 빌려왔다.
    //   → 재설치 직후처럼 내 폴더가 비어 있으면 같은 날 3건이 전부 같은 사진으로 보이는 사고 발생.
    //   이제 형제 폴더에 _session.json 이 있으면 workId(없으면 작업명+날짜)로 내 작업인지 확인하고,
    //   다른 작업 폴더면 절대 빌려오지 않는다.
    //   (_session.json 이 없는 폴더 = 사진저장/자동저장용 순수 사진 폴더 → 원래 의도대로 빌려옴)
    async function _isBorrowable(pd) {
      let j = null;
      try {
        const fh = await pd.getFileHandle('_session.json');
        j = JSON.parse(await (await fh.getFile()).text());
      } catch (e) { return true; }
      try {
        if (data.workId && j.workId) return String(j.workId) === String(data.workId);
        return String(j.apt || '') === String(data.apt || '')
            && String(j.date || '') === String(data.date || '');
      } catch (e) { return false; }
    }
    const _borrowedFrom = [];
    async function _collectSiblings() {
      if (!photoFolderHandle || !baseDate) return;
      try {
        for await (const [nm, ent] of photoFolderHandle.entries()) {
          if (ent.kind !== 'directory' || nm === dateDir.name) continue;
          if (nm !== baseDate && nm.indexOf(baseDate) !== 0) continue;
          if (!(await _isBorrowable(ent))) {
            console.warn('[작업열기] 다른 작업 폴더라 건너뜀:', nm);
            continue;
          }
          const _before = allWorkDirs.length;
          await _collectWork(ent);
          if (allWorkDirs.length > _before) _borrowedFrom.push(nm);
        }
      } catch (e) { console.warn('[작업열기] 형제 폴더 스캔 실패:', e && e.message); }
    }

    // 1순위: 세션 폴더 자체
    await _collectWork(dateDir);
    // 세션 폴더에 사진폴더가 없을 때만 같은 날짜의 형제 폴더까지 탐색
    if (allWorkDirs.length === 0) await _collectSiblings();
    // ★ 네이티브 디렉터리 스캔이 일시적으로 0건을 반환하는 경우가 있어(콜드 핸들/앱 복귀 직후)
    //   사진이 있는데 work폴더가 하나도 안 잡히면 잠깐 쉬고 재시도한다. (사진 가끔 안 뜨는 버그)
    let _scanTries = 0;
    while (allWorkDirs.length === 0 && totalPhotos > 0 && _scanTries < 5) {
      _scanTries++;
      await new Promise(r => setTimeout(r, 300 * _scanTries));
      await _collectWork(dateDir);
      if (allWorkDirs.length === 0) await _collectSiblings();
      if (allWorkDirs.length > 0) console.warn('[작업열기] work폴더 스캔 재시도 성공 (시도 ' + _scanTries + ')');
    }
    console.log('[작업열기] 발견 work폴더:', allWorkDirs.map(w => w.parentName + '/' + w.name));
    // ★ 다른 폴더에서 빌려온 경우 사용자에게 알림 (사진이 남의 작업 것일 수 있음)
    if (_borrowedFrom.length > 0) {
      console.warn('[작업열기] 사진을 다른 폴더에서 가져옴:', _borrowedFrom.join(', '));
      if (typeof showToast === 'function') {
        setTimeout(() => showToast('⚠️ 이 작업 폴더에 사진이 없어 ' + _borrowedFrom[0] + ' 에서 불러왔습니다', 'err'), 1200);
      }
    }

    const _cnt = (u) => (u.beforeCount || 0) + (u.afterCount || 0) +
                        ((u.specials || []).reduce((s, sp) => s + (sp.photoCount || 0), 0));
    const usedIdx = new Set();

    // 1) 정확 매칭 (workNum 번호 일치)
    for (let ui = 0; ui < data.units.length; ui++) {
    // ★ 사용자가 중단했으면 즉시 빠져나가 정리 (반쯤 채워진 units 방지)
    if (window._workLoadAbort) throw new Error('사용자가 불러오기를 중단했습니다');
      const u = data.units[ui];
      if (_cnt(u) === 0) continue;
      const wn = parseInt(String(u.workNum || (ui + 1)), 10);
      for (let k = 0; k < allWorkDirs.length; k++) {
        if (usedIdx.has(k)) continue;
        if (allWorkDirs[k].num === wn) { workDirMap.set(ui, allWorkDirs[k].handle); usedIdx.add(k); break; }
      }
    }
    // 2) 순서 폴백 (남은 폴더를 번호순으로 미매칭 호수에 배정)
    const remaining = allWorkDirs
      .map((w, k) => ({ w, k }))
      .filter(o => !usedIdx.has(o.k))
      .sort((a, b) => a.w.num - b.w.num);
    let ri = 0;
    for (let ui = 0; ui < data.units.length; ui++) {
      if (workDirMap.has(ui)) continue;
      const u = data.units[ui];
      if (_cnt(u) === 0) continue;
      if (ri < remaining.length) {
        workDirMap.set(ui, remaining[ri].w.handle);
        console.warn('[작업열기] 순서 폴백: ' + u.name + ' → ' + remaining[ri].w.parentName + '/' + remaining[ri].w.name);
        usedIdx.add(remaining[ri].k); ri++;
      } else {
        workDirFailed.push({ name: u.name, ui, workNum: u.workNum });
      }
    }

    if (workDirFailed.length > 0 && typeof showToast === 'function') {
      const names = workDirFailed.map(f => f.name).join(', ');
      setTimeout(() => {
        showToast(`⚠️ ${workDirFailed.length}개 호수 폴더 못 찾음: ${names}`, 'err');
      }, 1500);
    }
    console.log(`[restore] workDir 스캔: ${Date.now() - _tScan0}ms`);
  } else {
    console.log(`[restore] 사진 없음 → workDir 스캔 스킵`);
  }
  const _tLoopStart = Date.now();

  // ★ customers DB 역조회 제거 (1.239) - 너무 무거움 (열기 12~20초 원인)
  //   - 작업 불러올 때마다 전체 고객 DB 로드 + visits 순회는 비효율적
  //   - 호수에 phone이 저장돼 있으면 그대로 사용, 없으면 빈값
  //   - 사용자가 명시적으로 입력 안 한 정보를 자동 추론하는 것보다 빠른 게 낫다
  let customersByUnit = new Map();

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
      open: true,           // 불러온 작업은 펼쳐서 사진을 바로 보이게
      customerOpen: true,   // 고객 정보도 펼친 상태로
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
        // ★ 미리 가져온 workDir 핸들 사용 (await 없음)
        const workDir = workDirMap.get(ui) || null;

        // 메타에서 사진 객체 생성 (썸네일은 즉시 사용 + 원본은 lazy)
        // 썸네일 비활성화 시 meta.thumb 무시
        const thumbsOn = !(typeof window !== 'undefined' && window.THUMBNAILS_ENABLED === false);
        const buildFromMeta = (meta) => {
          if (!meta) return null;
          const useThumb = thumbsOn && meta.thumb;
          const obj = {
            // ★ 2026-08-13: 저장된 고유번호를 되살린다(옛 데이터면 새로 발급 → 다음 저장 때 고정됨)
            id: meta.pid || photoId(),
            dataUrl: useThumb ? meta.thumb : null,  // 썸네일 dataUrl (즉시 표시) 또는 null
            fileName: meta.fname,
            savedToFolder: true,
            hasOriginal: true,
            lazy: !useThumb  // 썸네일 있으면 lazy 아님
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

        // ★★ 치명적 버그 수정 ★★
        // workNum 정보를 newUnit에 보존해야 함 (구버전 스캔 경로엔 있었으나 이 메타 고속경로엔 누락돼 있었음)
        // 이게 없으면: 재저장 시 saveToFolder가 u._workNum이 없어 getWorkNumber()(세션 전역 카운터)로
        // 새 번호를 계산 → 실제 디스크 폴더명(workNN)과 어긋남 → "메모리에 없는 호수 폴더"로 오판되어
        // 정상 사진 폴더가 통째로 삭제됨 (호수 삭제 정리 로직, saveToFolder 참고)
        newUnit._workNum = u.workNum || (ui + 1);

        units.push(newUnit);
        continue;
      }

      // ★ 구버전 호환: 메타데이터 없으면 기존처럼 폴더 스캔
      try {
        // 미리 가져온 핸들 우선 사용, 없으면 다시 시도
        let workDir = workDirMap.get(ui);
        if (!workDir) {
          const workNum = String(u.workNum || (ui+1)).padStart(2,'0');
          try {
            workDir = await dateDir.getDirectoryHandle(`work${workNum}`);
          } catch(e) {
            console.warn(`work${workNum} 폴더 없음 - 폴백 시도`);
            if (u.workNum && u.workNum !== ui+1) {
              try {
                workDir = await dateDir.getDirectoryHandle(`work${String(ui+1).padStart(2,'0')}`);
              } catch(e2) { throw e; }
            } else { throw e; }
          }
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
        // 썸네일 비활성화 시 _thumbs 폴더 자체를 사용하지 않음
        if (typeof window !== 'undefined' && window.THUMBNAILS_ENABLED === false) {
          thumbsDir = null;
        } else {
          try {
            thumbsDir = await workDir.getDirectoryHandle('_thumbs');
          } catch(e) { /* 썸네일 폴더 없음 */ }
        }

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

  // ★ 이전 작업의 이름→번호 잔재 제거 + 현재 units 기준 재구성 (2026-08-09)
  //   restore 경로엔 _unitWorkNumber.clear() 가 없어, 작업 A를 열었다 B를 열면
  //   A의 매핑이 남아 B의 사진이 엉뚱한 workNN 으로 저장되던 문제를 막는다.
  if (typeof rebuildWorkNumbers === 'function') rebuildWorkNumbers();

  document.getElementById('slModal').classList.remove('open');
  const _tLoopElapsed = Date.now() - _tLoopStart;
  console.log(`[restore] units 루프: ${_tLoopElapsed}ms (${units.length}개 호수)`);
  const _tRender0 = Date.now();
  renderAll();
  updateStats();
  const _tRenderElapsed = Date.now() - _tRender0;
  console.log(`[restore] renderAll: ${_tRenderElapsed}ms`);

  // ★ 빈 작업인데도 200ms 이상이면 진단 로그
  //   2026-08-13: 빨간 토스트로 띄우던 것을 콘솔로 내림. '저장하고 바로 사진 찍기'는
  //   항상 totalPhotos === 0 이라, 느린 기기에서 저장할 때마다 오류처럼 보였다.
  if (totalPhotos === 0 && (_tLoopElapsed + _tRenderElapsed) > 200) {
    console.warn(`[restore] 빈 작업 복원 지연: 루프 ${_tLoopElapsed}ms + 렌더 ${_tRenderElapsed}ms`);
  }

  // ★ 불러온 직후 - dirty 초기화 + 스냅샷 저장 (다음 변경 추적용)
  // 이래야 변경 없이 또 불러올 때 저장 스킵됨
  if (typeof _dataDirty !== 'undefined') _dataDirty = false;
  if (typeof quickSnapshot === 'function') {
    _lastSaveSnapshot = quickSnapshot();
  }

  hideOverlay();
  showToast(`✓ 불러오기 완료 (${units.length}호수)`, 'ok');

  // ★ 공유 상대의 "원본 요청"에 응답 - 만료된 사진 재업로드 (백그라운드, 안전: 이미 로드된 _workDir만 사용)
  if (window.CloudPhotoSync && CloudPhotoSync.fulfillReuploadRequest) {
    setTimeout(() => { try { CloudPhotoSync.fulfillReuploadRequest(currentFolderName, units); } catch(e){} }, 1500);
  }
  // ★ 상대(공유작업자)가 보탠 사진을 클라우드에서 받아 표시 (A)
  if (window.CloudPhotoSync && CloudPhotoSync.pullBorrowedAdditions) {
    setTimeout(() => { try { CloudPhotoSync.pullBorrowedAdditions(currentFolderName, units); } catch(e){} }, 1800);
  }
  // 작업탭이 열려 있는 동안 상대의 추가/삭제를 실시간 반영 (소유자 쪽)
  if (window.CloudPhotoSync && CloudPhotoSync.startLivePhotoSync) {
    setTimeout(() => { try { CloudPhotoSync.startLivePhotoSync(Cloud.user && Cloud.user.uid, currentFolderName); } catch(e){} }, 1900);
  }
  /* ★ 2026-08-16: 상대(공유작업자)가 쓴 저장글을 받아 표시 + 내 글 중 아직 안 올라간 것 업로드.
       사진과 같은 방식(내 작업의 클라우드 workId = 폴더명).
       그 사이 다른 작업을 열었으면 폴더명이 달라지므로 그때는 반영하지 않는다. */
  if (window.CloudPhotoSync && CloudPhotoSync.syncPosts) {
    const _postFolder = currentFolderName;
    setTimeout(() => {
      try {
        CloudPhotoSync.syncPosts(() => currentFolderName === _postFolder)
          .catch(e => console.warn('[글작성] 공유 글 동기화 실패', e && e.message));
      } catch (e) {}
    }, 2000);
  }

  // ★ 썸네일 없는 사진들 백그라운드 생성 (3초 후 시작 - 첫 렌더 방해 안 함)
  if (_pendingThumbGen.length > 0) {
    setTimeout(() => processPendingThumbGen(), 3000);
  }

  // ★ lazy 사진들이 화면에 보이면 자동 로드 트리거
  // (placeholder 표시되는 거 방지 - 백그라운드에서 진짜 사진으로 자동 교체)
  setTimeout(() => {
    if (typeof startLazyPhotoLoading === 'function') {
      startLazyPhotoLoading();
    }
  }, 500);
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
  // ★ 사업자등록증 자동입력 버튼 연결 (2026-08-09)
  try {
    if (window.BizFill && BizFill.wire) {
      BizFill.wire('coBizFill',
        { name: 'coName', bizNo: 'coBiz', ceo: 'coCeo', addr: 'coAddr', tel: 'coTel' });
    }
  } catch (e) {}
  // 업종 드롭다운 채우기 (한 번만)
  populateIndustryDropdowns();
  updateCoPreview();
  applyCoIcon();
  document.getElementById('coModal').classList.add('open');
  document.getElementById('coName').focus();
}

/* ★ 2026-08-16 단순화 — 업종을 '대분류 select → 소분류 select → 3칸 직접 입력'에서
     '칩 눌러 고르기' 로 바꿨다(profiles_ui.js ProfilesUI.openPicker).

     여기서는 두 가지만 한다.
       ① 업체정보 모달 안의 '내 업종' 요약 줄을 그린다
       ② 현재 업종의 값을 hidden input 5개에 넣어준다
          — state.js CO_FIELDS / saveCoInfo / report.js 가 아직 이 값들을 읽기 때문.
     ⚠️ 함수 이름은 그대로 둔다(호출부가 여러 곳). */
function populateIndustryDropdowns() {
  try {
    if (window.Profiles) {
      Profiles.ensure();
      const inf = Profiles.info();
      [['coIndustryMajor', inf.coIndustryMajor], ['coIndustryMinor', inf.coIndustryMinor],
       ['coReportTitle', inf.coReportTitle], ['coUnitLabel', inf.coUnitLabel],
       ['coStageLabel', inf.coStageLabel]].forEach(([id, v]) => {
        const el = document.getElementById(id);
        if (el) el.value = v || '';
      });
    }
  } catch (e) { console.warn('[업종] 값 채우기 실패', e && e.message); }
  try { if (window.ProfilesUI) ProfilesUI.renderCoSection(); } catch (e) {}
}

/* ★ 2026-08-16: 소분류 드롭다운은 없어졌다(칩 선택으로 대체).
     외부에서 부르는 곳이 남아 있어도 터지지 않도록 빈 껍데기만 남긴다. */
function updateMinorDropdown() { /* 업종 선택은 ProfilesUI.openPicker 가 담당 */ }

/* ★ 2026-08-16: '내 업종 삭제'·'내 업종으로 저장'은 업종 관리 시트로 옮겼다
     (ProfilesUI.openManager → ✏️ → 목록에서 빼기).
     옛 onclick 이 남아 있어도 오류가 나지 않도록 얇은 연결만 남긴다. */
window.deleteSelectedMyIndustry = function () {
  if (window.ProfilesUI) ProfilesUI.openManager(function () { populateIndustryDropdowns(); });
};

function closeCoModal() {
  document.getElementById('coModal').classList.remove('open');
}

window.saveMyIndustry = function () {
  if (window.ProfilesUI) ProfilesUI.openPicker(function () { populateIndustryDropdowns(); });
};

function saveCoInfo() {
  try {
    const ci = {};
    CO_FIELDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) ci[id] = el.value;
    });
    localStorage.setItem(CO_KEY, JSON.stringify(ci));
    /* ★ 2026-08-16: ac_co_v2 는 이제 '현재 업종의 파생 뷰'다.
         화면에서 고친 값을 진실의 원천(사업자 + 업종 프로필)에도 되돌려 쓴다.
         안 그러면 업종을 바꿨다 돌아왔을 때 방금 고친 상호가 사라진다. */
    try { if (window.Profiles) Profiles.applyCoObject(ci); } catch (e) { console.warn('[업종] 프로필 반영 실패', e && e.message); }
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
  const appLogoS = document.getElementById('appLogoIconSched');  // 스케줄 헤더 로고도 동일하게
  if (appLogoS) renderTo(appLogoS);

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
  // 2026-08-13: 공유 작업에서도 순서편집 허용 (원작업자 문서의 photoOrder 로 전달)
  // unitId는 DOM 데이터셋에서 온 문자열, u.id는 숫자일 수 있음 → 문자열로 통일 비교
  const u = units.find(x => String(x.id) === String(unitId));
  if (!u) {
    console.warn('호수를 찾을 수 없음:', unitId);
    return;
  }

  // ★ 규칙2(개정 2026-07-11): 상대가 보탠 사진(_borrowedIncoming)도 순서편집 가능(원작업자 전용).
  //   순서는 파일이 아니라 클라우드 항목 문서의 photoOrder 필드로 동기화 → 파일은 절대 안 건드림(규칙1 유지).
  //   단, 상대 사진은 전↔후 이동·삭제 불가(문서의 역할/소유권은 상대 것).
  if ((u.before.length + u.after.length) < 2) {
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
            ${window.isForeignPhoto(p)
              ? '<span style="position:absolute;top:4px;right:4px;font-size:11px;background:rgba(0,0,0,.45);border-radius:6px;padding:1px 5px;pointer-events:none;">👥</span>'
              : `<button class="reorder-del" data-side="${side}" data-idx="${idx}" title="삭제">✕</button>`}
            <div class="reorder-drag-handle">≡</div>
          </div>`).join('')}
      </div>
    </div>`;
  }

  body.innerHTML = `
    <div class="reorder-info">
      ☰ 드래그로 순서 변경 · 작업 전↔후 이동 가능 · 사진 탭하면 크게 보기${(_reorderState.before.some(p => window.isForeignPhoto(p)) || _reorderState.after.some(p => window.isForeignPhoto(p))) ? '<br>👥 표시된 사진은 올린 사람만 삭제할 수 있습니다' + ((_reorderState.before.some(p => !window.canMovePhotoSide(p)) || _reorderState.after.some(p => !window.canMovePhotoSide(p))) ? ' (전↔후 이동도 불가)' : '') : ''}
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
  let pendingX = 0; // 최신 X 좌표 (cross-column 판단용)

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
    return { el: g, baseTop: r.top, baseLeft: r.left };
  }

  // ── 포인터가 어느 컬럼(side) 위에 있는지 판단 ──
  function getSideAt(clientX, clientY) {
    // 각 컬럼의 영역으로 판단
    const cols = [...body.querySelectorAll('.reorder-col')];
    for (const col of cols) {
      const r = col.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        return col.dataset.side;
      }
    }
    // 영역 밖이면 X좌표로만 판단 (좌=before, 우=after)
    const colsR = cols.map(c => c.getBoundingClientRect());
    if (colsR.length === 2) {
      const mid = (colsR[0].right + colsR[1].left) / 2;
      return clientX < mid ? 'before' : 'after';
    }
    return null;
  }

  // ── 모든 항목의 중간 Y 계산 ──
  function getDropIndex(side, clientY) {
    const items = [...body.querySelectorAll(`.reorder-item[data-side="${side}"]`)];
    if (items.length === 0) return 0;
    let idx = items.length;  // 기본: 맨 끝
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) { idx = i; break; }
    }
    return idx;
  }

  // ── 드롭 강조 갱신 ──
  function updateHighlight(side, dropIdx) {
    body.querySelectorAll('.reorder-item').forEach((el) => {
      const isSide = el.dataset.side === side;
      const isTarget = isSide && parseInt(el.dataset.idx) === dropIdx && !(side === drag.side && dropIdx === drag.fromIdx);
      el.classList.toggle('reorder-over', isTarget);
    });
    // ★ 다른 컬럼으로 이동 중이면 그 컬럼 전체 강조
    body.querySelectorAll('.reorder-col').forEach(col => {
      const crossing = (side !== drag.side) && (col.dataset.side === side);
      col.classList.toggle('reorder-col-target', crossing);
    });
  }

  // ── RAF 루프 ──
  function rafLoop() {
    if (!drag) return;
    const dy = pendingY - drag.startY;
    const dx = pendingX - drag.startX;
    drag.ghost.el.style.top  = (drag.ghost.baseTop  + dy) + 'px';
    drag.ghost.el.style.left = (drag.ghost.baseLeft + dx) + 'px';
    // ★ 현재 포인터가 위치한 컬럼 판단 (cross-column 지원)
    const curSide = getSideAt(pendingX, pendingY) || drag.side;
    const dropIdx = getDropIndex(curSide, pendingY);
    if (curSide !== drag.curSide || dropIdx !== drag.lastDropIdx) {
      drag.curSide = curSide;
      drag.lastDropIdx = dropIdx;
      updateHighlight(curSide, dropIdx);
    }
    rafId = requestAnimationFrame(rafLoop);
  }

  // ── 시작 ──
  function onStart(e) {
    const handle = e.target.closest('.reorder-drag-handle');
    if (!handle) return;
    const item = handle.closest('.reorder-item');
    if (!item) return;

    // touchstart는 passive:true이므로 preventDefault 호출하지 않음
    // (스크롤 차단은 touchmove에서 처리)
    if (e.type === 'mousedown') {
      e.preventDefault();
      e.stopPropagation();
    }

    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const ghost = createGhost(item);
    item.classList.add('reorder-dragging');

    drag = {
      side:        item.dataset.side,
      curSide:     item.dataset.side,
      fromIdx:     parseInt(item.dataset.idx),
      el:          item,
      ghost,
      startY:      clientY,
      startX:      clientX,
      lastDropIdx: parseInt(item.dataset.idx),
    };
    pendingY = clientY;
    pendingX = clientX;
    rafId = requestAnimationFrame(rafLoop);
  }

  // ── 이동 ──
  function onMove(e) {
    if (!drag) return;
    e.preventDefault();
    pendingY = e.touches ? e.touches[0].clientY : e.clientY;
    pendingX = e.touches ? e.touches[0].clientX : e.clientX;
  }

  // ── 종료 ──
  function onEnd(e) {
    if (!drag) return;

    cancelAnimationFrame(rafId); rafId = null;

    // 정리
    drag.ghost.el.remove();
    drag.el.classList.remove('reorder-dragging');
    body.querySelectorAll('.reorder-over').forEach(el => el.classList.remove('reorder-over'));
    body.querySelectorAll('.reorder-col-target').forEach(el => el.classList.remove('reorder-col-target'));

    const dropIdx  = drag.lastDropIdx;
    const fromIdx  = drag.fromIdx;
    const fromSide = drag.side;
    const toSide   = drag.curSide || drag.side;

    if (fromSide === toSide) {
      // 같은 컬럼 내 순서 변경
      if (dropIdx !== fromIdx) {
        const photos = _reorderState[fromSide];
        const [moved] = photos.splice(fromIdx, 1);
        // dropIdx는 splice 전 기준 인덱스 → 빠진 후 보정
        const insertAt = dropIdx > fromIdx ? dropIdx - 1 : dropIdx;
        photos.splice(Math.max(0, Math.min(insertAt, photos.length)), 0, moved);
        photos.forEach(p => { if (!p._borrowedIncoming) p.savedToFolder = false; });
        renderReorderList();
      }
    } else {
      // ★ 다른 컬럼으로 이동 (작업 전 ↔ 작업 후)
      const fromArr = _reorderState[fromSide];
      const toArr   = _reorderState[toSide];
      if (!window.canMovePhotoSide(fromArr[fromIdx])) {
        // ★ 남의 사진은 역할(전/후)이 그 사람 문서에 있어 전↔후 이동 불가 - 순서만 변경 가능
        showToast('이 사진은 작업 전↔후 이동을 할 수 없습니다 (순서만 변경 가능)', 'err');
        drag = null;
        return;
      }
      const [moved] = fromArr.splice(fromIdx, 1);
      if (moved) {
        const insertAt = Math.min(dropIdx, toArr.length);
        toArr.splice(insertAt, 0, moved);
        // 이동된 사진은 새 위치에 다시 저장돼야 함
        moved.savedToFolder = false;
        fromArr.forEach(p => { if (!p._borrowedIncoming) p.savedToFolder = false; });
        toArr.forEach(p => { if (!p._borrowedIncoming) p.savedToFolder = false; });
        renderReorderList();
        showToast(`${fromSide === 'before' ? '작업 전→후' : '작업 후→전'} 이동`, 'ok');
      }
    }

    drag = null;
  }

  // ── 이벤트 등록 ──
  // 터치: touchstart는 passive:true (탭 클릭 합성이 막히지 않도록), touchmove는 preventDefault 필요해서 passive:false
  body.addEventListener('touchstart',  onStart, { passive: true });
  body.addEventListener('touchmove',   onMove,  { passive: false });
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
    body.removeEventListener('touchstart',  onStart);
    body.removeEventListener('touchmove',   onMove);
    body.removeEventListener('touchend',    onEnd);
    body.removeEventListener('touchcancel', onEnd);
    body.removeEventListener('mousedown',   onStart);
    document.removeEventListener('mousemove', docMove);
    document.removeEventListener('mouseup',   docUp);
  };
}

// 순서편집 미리보기 줌 상태 (외부 노출용)
let _reorderImgZoom = 1;
let _reorderImgPanX = 0;
let _reorderImgPanY = 0;

function openReorderFullView(src) {
  let fv = document.getElementById('reorderFullView');
  if (!fv) {
    fv = document.createElement('div');
    fv.id = 'reorderFullView';
    fv.className = 'reorder-fullview';
    // ★ 닫기 버튼만 추가 - 화면 영역 클릭으로는 닫히지 않음
    fv.innerHTML = `
      <button id="reorderFullClose" style="position:absolute;top:14px;right:14px;background:rgba(0,0,0,.65);color:#fff;border:none;width:42px;height:42px;border-radius:50%;font-size:22px;cursor:pointer;z-index:10;display:flex;align-items:center;justify-content:center;">✕</button>
      <img id="reorderFullImg" src="" alt="전체화면">
    `;
    fv.querySelector('#reorderFullClose').addEventListener('click', (e) => {
      e.stopPropagation();
      closeReorderFullView();
    });
    document.body.appendChild(fv);

    // ★ 핀치 줌 부착 (한 번만)
    if (typeof window.attachPinchZoomToImage === 'function') {
      window.attachPinchZoomToImage(
        fv,
        fv.querySelector('#reorderFullImg'),
        (z, px, py) => { _reorderImgZoom = z; _reorderImgPanX = px; _reorderImgPanY = py; },
        () => ({ zoom: _reorderImgZoom, panX: _reorderImgPanX, panY: _reorderImgPanY })
      );
    }
  }
  // ★ 줌 리셋
  _reorderImgZoom = 1;
  _reorderImgPanX = 0;
  _reorderImgPanY = 0;
  const img = document.getElementById('reorderFullImg');
  img.src = src;
  img.style.transform = '';
  img.style.transformOrigin = '';
  fv.classList.add('open');
  // ★ 브라우저 viewport 줌 차단 (자체 핀치 줌)
  if (typeof setViewportZoom === 'function') setViewportZoom(false);
  history.pushState({ reorderFullView: true }, '');
}

function closeReorderFullView() {
  const fv = document.getElementById('reorderFullView');
  if (!fv || !fv.classList.contains('open')) return;
  fv.classList.remove('open');
  // ★ 줌 리셋
  _reorderImgZoom = 1;
  _reorderImgPanX = 0;
  _reorderImgPanY = 0;
  const img = document.getElementById('reorderFullImg');
  if (img) {
    img.style.transform = '';
    img.style.transformOrigin = '';
  }
  // 방금 닫음 표시 → state.js의 popstate가 종료 확인 안 띄움
  if (typeof window._markModalJustClosed === 'function') window._markModalJustClosed();
  try { history.back(); } catch(e) {}
}

// ★ 순서 변경사항 있는지 확인
function hasReorderChanges() {
  if (!_reorderState) return false;
  const u = units.find(x => String(x.id) === String(_reorderState.unitId));
  if (!u) return false;

  // before/after 순서 비교
  const compare = (current, original) => {
    if (current.length !== original.length) return true;
    for (let i = 0; i < current.length; i++) {
      if (current[i].id !== original[i].id) return true;
    }
    return false;
  };
  return compare(_reorderState.before, u.before) || compare(_reorderState.after, u.after);
}
window.hasReorderChanges = hasReorderChanges;

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

  // 원본에 적용 - ★ 규칙2(개정): 상대 사진 포함 전체 새 순서 적용. 순서는 photoOrder(클라우드)로 동기화.
  // 폴더에 이미 저장된 "내" 사진만 새 순서로 다시 저장 필요 (상대 사진 파일은 절대 안 건드림 - 규칙1)
  _reorderState.before.forEach(p => { if (!p._borrowedIncoming) p.savedToFolder = false; });
  _reorderState.after.forEach(p => { if (!p._borrowedIncoming) p.savedToFolder = false; });
  u.before = _reorderState.before;
  u.after = _reorderState.after;

  closeReorderModal(true);  // 저장 후 닫으니 confirm 생략
  renderAll();
  updateStats();
  showToast('✓ 순서 변경 완료', 'ok');

  // 자동저장 (세션)
  if (typeof sessionAutoSaveNow === 'function') sessionAutoSaveNow();

  // ★ 순서를 클라우드에 즉시 기록(photoOrder) - 파일 재저장과 무관, 상대는 재오픈 시 이 순서로 봄
  //   (내 사진 파일명이 아직 옛 위치 이름이어도, 그 이름의 클라우드 문서가 옛 내용을 그대로 갖고 있어
  //    목록 순서만으로 상대 화면 순서가 정확함. 이후 "저장"하면 파일명·문서·photoOrder가 새 기준으로 재정렬됨)
  try {
    const _bo = window._borrowedShare;
    if (_bo && _bo.ownerUid && _bo.workId && window.CloudPhotoSync && CloudPhotoSync.pushPhotoOrder) {
      CloudPhotoSync.pushPhotoOrder(_bo.workId, units, _bo.ownerUid);   // 공유작업 → 원작업자 문서에
      // 전↔후·호수 이동은 순서가 아니라 사진 문서의 role/unitName → 따로 반영
      if (CloudPhotoSync.pushBorrowedPlacement) CloudPhotoSync.pushBorrowedPlacement(_bo.workId, units, _bo.ownerUid);
    } else if (typeof currentFolderName !== 'undefined' && currentFolderName
        && window.CloudPhotoSync && CloudPhotoSync.pushPhotoOrder) {
      CloudPhotoSync.pushPhotoOrder(currentFolderName, units, null, true);   // 내가 직접 정한 순서
    /* ⭐ 2026-08-13: 내 사진을 작업 전↔후(또는 다른 호수)로 옮기면 클라우드 이름 자체가 바뀐다
       (내 사진의 이름은 호수__전후__파일명 형태라 전/후가 이름에 박혀 있다).
       그래서 순서표(photoOrder)만 보내서는 상대에게 전달되지 않고, '저장'을 해야 비로소
       새 이름으로 다시 올라가고 옛 문서가 정리됐다 → 상대 쪽에서 실시간 반영이 안 됐다.
       → 옮긴 직후에 사진 동기화를 한 번 돌려 준다(로컬 파일은 건드리지 않는다).
       이미 올라간 것은 건너뛰므로 비용은 바뀐 사진 몇 장뿐이다. */
      if (CloudPhotoSync.autoUploadPhotos) {
        try { CloudPhotoSync.autoUploadPhotos(currentFolderName, units, { silent: true }); } catch (e) {}
      }
    }
  } catch (e) {}
}

function closeReorderModal(skipConfirm) {
  // ★ 변경사항 있으면 확인
  if (!skipConfirm && typeof hasReorderChanges === 'function' && hasReorderChanges()) {
    const ok = confirm('🔄 변경된 순서가 있어요.\n\n저장하지 않고 닫을까요?\n(취소하면 순서편집으로 돌아갑니다)');
    if (!ok) return;
  }
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
  // ★ 이벤트 객체가 첫 인자로 들어가면 skipConfirm = truthy가 되니까 명시적 호출
  if (closeBtn) closeBtn.addEventListener('click', () => closeReorderModal());
  if (cancelBtn) cancelBtn.addEventListener('click', () => closeReorderModal());
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
