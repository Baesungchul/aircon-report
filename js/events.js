/* ═══════════════════════════════
   EVENT BINDING
═══════════════════════════════ */
function bindAll() {
  // 헤더 버튼
  document.getElementById('btnCoInfo').addEventListener('click', openCoModal);
  document.getElementById('coModalClose').addEventListener('click', closeCoModal);
  document.getElementById('coModalCancel').addEventListener('click', closeCoModal);
  document.getElementById('coModalSave').addEventListener('click', saveCoInfo);
  document.getElementById('btnSavePhotos').addEventListener('click', savePhotosToFolder);
  document.getElementById('btnSetFolder').addEventListener('click', selectPhotoFolder);
  document.getElementById('btnClearFolder').addEventListener('click', clearPhotoFolder);
  document.getElementById('btnFlushNow').addEventListener('click', flushPendingSaves);
  document.getElementById('btnResumeFolder').addEventListener('click', resumeFolderPermission);
  document.getElementById('btnResetSaved').addEventListener('click', resetSavedState);
  document.getElementById('btnAdd').addEventListener('click', () => addUnit());
  document.getElementById('newName').addEventListener('keydown', e => { if(e.key==='Enter') addUnit(); });
  document.getElementById('btnBulk').addEventListener('click', bulkAdd);
  document.getElementById('btnClear').addEventListener('click', clearAll);
  document.getElementById('btnExp').addEventListener('click', ()=>{ units.forEach(u=>u.open=true); renderAll(); });
  document.getElementById('btnCol').addEventListener('click', ()=>{ units.forEach(u=>u.open=false); renderAll(); });
  document.getElementById('srch').addEventListener('input', renderAll);

  // 저장/불러오기
  document.getElementById('btnNew').addEventListener('click', newWork);
  document.getElementById('btnSave').addEventListener('click', openSaveDialog);
  document.getElementById('btnLoad').addEventListener('click', openLoadList);
  document.getElementById('saveDlgClose').addEventListener('click', closeSaveDialog);
  document.getElementById('saveDlgCancel').addEventListener('click', closeSaveDialog);
  document.getElementById('saveDlgOk').addEventListener('click', doSave);
  document.getElementById('saveNameInp').addEventListener('keydown', e=>{ if(e.key==='Enter') doSave(); });
  document.getElementById('btnSlClose').addEventListener('click', ()=>document.getElementById('slModal').classList.remove('open'));

  // 보고서
  document.getElementById('btnGen').addEventListener('click', buildAndPreview);
  document.getElementById('btnPDF').addEventListener('click', exportPDF);
  document.getElementById('btnJPG').addEventListener('click', exportJPG);
  document.getElementById('btnPDF2').addEventListener('click', exportPDF);
  document.getElementById('btnJPG2').addEventListener('click', exportJPG);
  document.getElementById('btnPvClose').addEventListener('click', ()=>document.getElementById('pvModal').classList.remove('open'));

  // 이미지 모달
  document.getElementById('imgX').addEventListener('click', ()=>document.getElementById('imgModal').classList.remove('open'));
  document.getElementById('imgModal').addEventListener('click', e=>{ if(e.target===document.getElementById('imgModal')) document.getElementById('imgModal').classList.remove('open'); });

  // 유닛 리스트 이벤트 위임
  const ul = document.getElementById('uList');

  ul.addEventListener('click', e => {
    const t = e.target;

    // 카드 토글
    const top = t.closest('.u-top');
    if (top && !t.closest('.u-name-row') && !t.closest('.del-btn') && !t.closest('.bdg')) {
      const id = +top.dataset.id;
      const u = findU(id); if(u){ u.open=!u.open; renderAll(); } return;
    }
    // 이름 수정
    if (t.closest('.edit-ic')) {
      e.stopPropagation();
      startEdit(+t.closest('[data-uid]').dataset.uid); return;
    }
    // 삭제
    const db2 = t.closest('.del-btn');
    if (db2) { e.stopPropagation(); deleteUnit(+db2.dataset.id); return; }
    // 사진 썸네일 삭제
    const tdl = t.closest('.th-del');
    if (tdl) {
      e.stopPropagation();
      // 특이사항 사진 삭제는 별도 핸들러에서 처리
      if (tdl.classList.contains('sp-th-del')) return;
      const uid=+tdl.dataset.uid, type=tdl.dataset.type, idx=+tdl.dataset.idx;
      const u=findU(uid); if(u){ u[type].splice(idx,1); renderAll(); updateStats(); sessionAutoSave(); } return;
    }
    // 개별 사진 폴더로 저장 (↓ 버튼)
    const tsv = t.closest('.th-save-btn');
    if (tsv) {
      e.stopPropagation();
      // 특이사항 사진 저장은 별도 처리
      if (tsv.classList.contains('sp-save-btn')) {
        const uid=+tsv.dataset.uid, sid=+tsv.dataset.sid, idx=+tsv.dataset.idx;
        const u=findU(uid); if(!u) return;
        const s=u.specials.find(s=>s.id===sid); if(!s) return;
        const p=s.photos[idx]; if(!p) return;
        const sIdx = u.specials.indexOf(s);
        saveSinglePhoto(p, u.name, `특이${sIdx+1}_`, idx+1);
      } else {
        const uid=+tsv.dataset.uid, type=tsv.dataset.type, idx=+tsv.dataset.idx;
        const u=findU(uid); if(!u) return;
        const p=u[type][idx]; if(!p) return;
        const label = type==='before' ? '전' : '후';
        saveSinglePhoto(p, u.name, label, idx+1);
      }
      return;
    }
    // 사진 크게 보기
    if (t.tagName==='IMG' && t.closest('.th-wrap')) { showImg(t.src); return; }
    // 특이사항 삭제
    const sdl = t.closest('.sp-del');
    if (sdl) {
      e.stopPropagation();
      const uid=+sdl.dataset.uid, sid=+sdl.dataset.sid;
      const u=findU(uid); if(u){ u.specials=u.specials.filter(s=>s.id!==sid); renderAll(); sessionAutoSave(); } return;
    }
    // 특이사항 추가
    const asp = t.closest('.add-sp-btn');
    if (asp) {
      e.stopPropagation();
      const u=findU(+asp.dataset.uid);
      if(u){ u.specials.push({id:Date.now(),desc:'',photos:[]}); renderAll(); sessionAutoSave(); } return;
    }
    // 특이사항 사진 삭제
    const spdl = t.closest('.sp-th-del');
    if (spdl) {
      e.stopPropagation();
      const uid=+spdl.dataset.uid, sid=+spdl.dataset.sid, idx=+spdl.dataset.idx;
      const u=findU(uid); if(!u) return;
      const s=u.specials.find(s=>s.id===sid); if(s){ s.photos.splice(idx,1); renderAll(); sessionAutoSave(); } return;
    }
  });

  // 파일 업로드 위임
  // 파일 업로드 위임 (압축 처리 포함)
  ul.addEventListener('change', e => {
    const t = e.target;
    if (t.type!=='file' || !t.files || !t.files.length) return;
    e.stopPropagation();
    const uid  = +t.dataset.uid;
    const type = t.dataset.type;
    const sid  = t.dataset.sid ? +t.dataset.sid : null;
    const files = Array.from(t.files).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;

    let totalOrig = 0, totalNew = 0, processed = 0;

    files.forEach(f => {
      compressImage(f).then(result => {
        const { dataUrl, origKB, newKB, w, h, wasCropped } = result;
        totalOrig += origKB;
        totalNew  += newKB;
        processed++;

        const u = findU(uid); if(!u) return;
        const photo = makePhoto(dataUrl);  // 고유 ID 부여

        if (type === 'special' && sid) {
          const s = u.specials.find(s => s.id === sid);
          if (s) {
            s.photos.push(photo);
            renderAll(); updateStats(); sessionAutoSave();
            enqueueAutoSave(photo, u.name, '특이');
          }
        } else {
          u[type].push(photo);
          renderAll(); updateStats(); sessionAutoSave();
          const label = type === 'before' ? '전' : '후';
          enqueueAutoSave(photo, u.name, label);
        }

        // 마지막 파일 처리 완료 시 토스트
        if (processed === files.length) {
          const ratio = totalOrig > 0 ? Math.round((1 - totalNew/totalOrig)*100) : 0;
          const cropNote = wasCropped ? ' · 세로→가로 변환' : '';
          showToast(`📸 ${files.length}장${cropNote} | ${totalOrig}KB → ${totalNew}KB (${ratio}% 절감)`, 'ok');
        }
      });
    });

    t.value = '';
  });

  // textarea 위임
  ul.addEventListener('input', e => {
    const t=e.target;
    if (!t.classList.contains('sp-txt')) return;
    const u=findU(+t.dataset.uid); if(!u) return;
    const s=u.specials.find(s=>s.id===+t.dataset.sid); if(s){ s.desc=t.value; sessionAutoSave(); }
  });
}

/* ═══════════════════════════════
   UNIT OPERATIONS
═══════════════════════════════ */
function findU(id){ return units.find(u=>u.id===id); }

/* ── 사진 객체 헬퍼 (중복 방지를 위한 ID 시스템) ──
   사진 저장 형태:
   - 신규: { id: 'p_xxx', dataUrl: 'data:image/...', savedToFolder: false }
   - 구버전 호환: 'data:image/...' (문자열) → 자동으로 객체로 정규화
*/
let _photoIdCounter = 0;
function newPhotoId() {
  return `p_${Date.now()}_${++_photoIdCounter}`;
}
function makePhoto(dataUrl) {
  return { id: newPhotoId(), dataUrl, savedToFolder: false };
}
// 사진의 dataUrl 추출 (객체든 문자열이든)
function photoUrl(p) {
  return typeof p === 'string' ? p : p.dataUrl;
}
// 사진의 ID 추출 (없으면 즉석 생성)
function photoId(p) {
  if (typeof p === 'string') return null;
  return p.id;
}
// 배열을 객체 배열로 정규화 (문자열은 객체로 변환)
function normalizePhotos(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(p => {
    if (typeof p === 'string') return makePhoto(p);
    if (!p.id) p.id = newPhotoId();
    if (typeof p.savedToFolder !== 'boolean') p.savedToFolder = false;
    return p;
  });
}
// units 전체 정규화 (불러오기 / 세션 복원 시 호출)
function normalizeUnits(arr) {
  return (arr||[]).map(u => ({
    ...u,
    before: normalizePhotos(u.before),
    after:  normalizePhotos(u.after),
    specials: (u.specials||[]).map(s => ({
      ...s,
      photos: normalizePhotos(s.photos)
    }))
  }));
}

function addUnit(name) {
  const inp=document.getElementById('newName');
  const n=(name!==undefined?name:inp.value).trim();
  if(!n){ showToast('호수명을 입력해주세요','err'); return; }
  units.push({id:nid++,name:n,before:[],after:[],specials:[],open:true});
  if(name===undefined){ inp.value=''; inp.focus(); }
  renderAll(); updateStats(); sessionAutoSave();
  showToast(`✅ "${n}" 호수가 추가되었습니다`, 'ok');
}

function bulkAdd() {
  const raw=prompt('여러 호수를 줄바꿈으로 입력:\n\n예)\n101동 201호\n101동 202호\n101동 203호');
  if(!raw) return;
  const lines=raw.split('\n').map(l=>l.trim()).filter(Boolean);
  lines.forEach(l=>units.push({id:nid++,name:l,before:[],after:[],specials:[],open:false}));
  renderAll(); updateStats(); sessionAutoSave();
  showToast(`${lines.length}개 호수 추가됨`,'ok');
}

function deleteUnit(id) {
  if(!confirm('이 호수를 삭제할까요?')) return;
  units=units.filter(u=>u.id!==id);
  renderAll(); updateStats(); sessionAutoSave();
}

function startEdit(id) {
  const u=findU(id); if(!u) return;
  const el=document.getElementById(`nm-${id}`); if(!el) return;
  const inp=document.createElement('input');
  inp.className='u-name-inp'; inp.value=u.name;
  inp.addEventListener('click',e=>e.stopPropagation());
  inp.addEventListener('blur',()=>{ u.name=inp.value.trim()||u.name; renderAll(); updateStats(); sessionAutoSave(); });
  inp.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key==='Escape') inp.blur(); e.stopPropagation(); });
  el.replaceWith(inp); inp.focus(); inp.select();
}

function clearAll() {
  if(!confirm('모든 호수와 사진을 초기화할까요?')) return;
  units=[]; nid=1;
  document.getElementById('rpWrap').innerHTML='';
  document.getElementById('btnPDF').disabled=true;
  document.getElementById('btnJPG').disabled=true;
  renderAll(); updateStats();
}

// 새 작업 시작
async function newWork() {
  // 작업 내용이 없으면 그냥 날짜만 초기화
  if (units.length === 0) {
    document.getElementById('workDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('aptName').value  = '';
    showToast('🆕 새 작업을 시작합니다', 'ok');
    return;
  }

  // 작업 내용이 있으면 사진 저장 여부 묻기
  const totalPhotos = units.reduce((s,u) =>
    s + u.before.length + u.after.length +
    u.specials.reduce((a,sp) => a+sp.photos.length, 0), 0);

  const hasUnsavedPhotos = totalPhotos > 0;

  let msg = `📋 현재 작업: 호수 ${units.length}개, 사진 ${totalPhotos}장\n\n`;
  if (hasUnsavedPhotos && photoFolderHandle) {
    msg += `▶ 확인: 사진을 폴더에 저장 후 새 작업 시작\n`;
    msg += `▶ 취소: 그냥 새 작업 시작 (사진 폴더 저장 안 함)\n\n`;
    msg += `※ 작업 내용은 자동저장되어 "📂 불러오기"로 복원 가능합니다.`;
  } else {
    msg += `새 작업을 시작하시겠습니까?\n\n`;
    msg += `※ 현재 작업은 자동저장되어 "📂 불러오기"로 복원 가능합니다.`;
  }

  const savePhotos = confirm(msg);

  // 사진 저장 옵션을 선택했고 폴더가 설정되어 있으면
  if (savePhotos && hasUnsavedPhotos && photoFolderHandle) {
    showOverlay('사진 저장 중...');
    try {
      // 자동 저장 호출 (사용자 확인 없이 즉시 저장)
      await savePhotosForNewWork();
      hideOverlay();
    } catch(e) {
      hideOverlay();
      if (!confirm(`사진 저장 중 오류가 발생했습니다.\n${e.message}\n\n그래도 새 작업을 시작할까요?`)) {
        return;
      }
    }
  } else if (savePhotos === null) {
    // 취소 (창의 X 버튼)
    return;
  }

  // 현재 작업을 자동저장 백업
  if (units.length > 0) {
    try {
      await sessionAutoSaveNow();
    } catch(e) {}
  }

  // 초기화
  units = [];
  nid = 1;
  document.getElementById('rpWrap').innerHTML = '';
  document.getElementById('btnPDF').disabled = true;
  document.getElementById('btnJPG').disabled = true;
  document.getElementById('aptName').value = '';
  document.getElementById('workDate').value = new Date().toISOString().split('T')[0];
  // 담당자 정보는 유지

  // 사진 인덱스 카운터도 초기화
  if (typeof _indexCounter !== 'undefined') _indexCounter.clear();
  if (typeof _unitWorkNumber !== 'undefined') _unitWorkNumber.clear();
  if (typeof _savedPhotoIds !== 'undefined') _savedPhotoIds.clear();
  if (typeof pendingSaves !== 'undefined') pendingSaves.length = 0;

  renderAll();
  updateStats();
  showToast('🆕 새 작업을 시작합니다', 'ok');
}

// 새 작업 시작 전 사진 일괄 저장 (확인창 없이)
async function savePhotosForNewWork() {
  // 권한 확인
  let permOk = false;
  try {
    const curPerm = await photoFolderHandle.queryPermission({ mode:'readwrite' });
    if (curPerm === 'granted') permOk = true;
    else {
      const newPerm = await photoFolderHandle.requestPermission({ mode:'readwrite' });
      permOk = (newPerm === 'granted');
    }
  } catch(e) { throw new Error('폴더 권한 확인 실패'); }

  if (!permOk) throw new Error('폴더 권한이 없습니다');

  const date = document.getElementById('workDate').value || new Date().toISOString().split('T')[0];
  const apt  = document.getElementById('aptName').value || 'site';
  let saved = 0;

  // 호수별로 work01, work02... 폴더 생성하여 저장
  for (const u of units) {
    const workNum = getWorkNumber(u.name);
    for (let i = 0; i < u.before.length; i++) {
      try {
        await doWriteOne(u.before[i], u.name, '전');
        saved++;
        await sleep(50);
      } catch(e) {}
    }
    for (let i = 0; i < u.after.length; i++) {
      try {
        await doWriteOne(u.after[i], u.name, '후');
        saved++;
        await sleep(50);
      } catch(e) {}
    }
    for (let si = 0; si < u.specials.length; si++) {
      for (let pi = 0; pi < u.specials[si].photos.length; pi++) {
        try {
          await doWriteOne(u.specials[si].photos[pi], u.name, `특이${si+1}_`);
          saved++;
          await sleep(50);
        } catch(e) {}
      }
    }
  }

  // 작업 내용 JSON 백업 (불러오기용)
  try {
    const sessionData = {
      version: 1,
      savedAt: new Date().toISOString(),
      apt: apt,
      date: date,
      worker: document.getElementById('workerName').value || '',
      coName: document.getElementById('coName')?.value || '',
      coTel:  document.getElementById('coTel')?.value || '',
      coBiz:  document.getElementById('coBiz')?.value || '',
      coDesc: document.getElementById('coDesc')?.value || '',
      units: units.map(u => ({
        name: u.name,
        beforeCount: u.before.length,
        afterCount: u.after.length,
        specials: u.specials.map(s => ({ desc: s.desc, photoCount: s.photos.length }))
      }))
    };
    const blob = new Blob([JSON.stringify(sessionData, null, 2)], { type:'application/json' });
    const dateDir = await photoFolderHandle.getDirectoryHandle(date, { create:true });
    const fh = await dateDir.getFileHandle('_session.json', { create:true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
  } catch(e) { console.warn('세션 백업 실패:', e); }

  showToast(`✅ ${saved}장 저장 완료`, 'ok');
}

