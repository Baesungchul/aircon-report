/* ═══════════════════════════════
   EVENT BINDING
═══════════════════════════════ */
function bindAll() {
  // 헤더 버튼
  const btnCo = document.getElementById('btnCoInfo');
  if (btnCo) btnCo.addEventListener('click', openCoModal);  // 구버전 호환
  document.getElementById('coModalClose').addEventListener('click', closeCoModal);
  document.getElementById('coModalCancel').addEventListener('click', closeCoModal);
  document.getElementById('coModalSave').addEventListener('click', saveCoInfo);
  const btnSP = document.getElementById('btnSavePhotos');
  if (btnSP) btnSP.addEventListener('click', savePhotosToFolder);
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
  document.getElementById('btnSave').addEventListener('click', handleSaveClick);
  document.getElementById('btnLoad').addEventListener('click', openLoadList);

  // 헤더 접기/펼치기
  const hdr = document.querySelector('.hdr');
  const hdrToggle = document.getElementById('hdrToggle');
  if (hdrToggle && hdr) {
    // 상태 복원
    if (localStorage.getItem('ac_hdr_collapsed') === '1') {
      hdr.classList.add('collapsed');
    }
    hdrToggle.addEventListener('click', () => {
      hdr.classList.toggle('collapsed');
      localStorage.setItem('ac_hdr_collapsed', hdr.classList.contains('collapsed') ? '1' : '0');
    });
  }
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
  document.getElementById('btnPvClose').addEventListener('click', () => {
    document.getElementById('pvModal').classList.remove('open');
    // 줌 리셋 - 기본 스케일로 복귀
    document.querySelectorAll('#pvScroll .rpage').forEach(p => {
      const baseScale = parseFloat(p.dataset.baseScale) || 0.72;
      p.style.transform = `scale(${baseScale})`;
      const box = p.parentElement;
      if (box && box.classList.contains('pv-pg-scaled')) {
        box.style.width = `${794 * baseScale}px`;
        box.style.height = `${1123 * baseScale}px`;
      }
    });
    _pvZoom = 1;
    // viewport 손가락 줌 차단으로 복귀
    setViewportZoom(false);
  });

  // viewport 메타 변경 - 손가락 줌 활성/비활성
  function setViewportZoom(allow) {
    const meta = document.getElementById('metaViewport');
    if (!meta) return;
    if (allow) {
      meta.setAttribute('content', 'width=device-width,initial-scale=1.0,maximum-scale=5.0,user-scalable=yes');
    } else {
      meta.setAttribute('content', 'width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no');
    }
  }
  // 전역 노출 (다른 파일에서도 호출 가능)
  window.setViewportZoom = setViewportZoom;

  // 미리보기 줌 컨트롤 - 기본 스케일에 사용자 줌 배율 적용
  let _pvZoom = 1;
  function setPvZoom(z) {
    _pvZoom = Math.max(0.5, Math.min(3, z));
    document.querySelectorAll('#pvScroll .rpage').forEach(p => {
      const baseScale = parseFloat(p.dataset.baseScale) || 0.72;
      const finalScale = baseScale * _pvZoom;
      p.style.transform = `scale(${finalScale})`;
      // 부모 박스도 같이 크기 변경 (스크롤 영역 위해)
      const box = p.parentElement;
      if (box && box.classList.contains('pv-pg-scaled')) {
        box.style.width = `${794 * finalScale}px`;
        box.style.height = `${1123 * finalScale}px`;
      }
    });
  }
  document.getElementById('btnPvZoomIn')?.addEventListener('click', () => setPvZoom(_pvZoom + 0.2));
  document.getElementById('btnPvZoomOut')?.addEventListener('click', () => setPvZoom(_pvZoom - 0.2));

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
    })),
    // customer 필드 기본값 보장 (이전 버전 데이터에는 없을 수 있음)
    customer: u.customer || { phone: '', address: '', memo: '' }
  }));
}

function addUnit(name) {
  const inp=document.getElementById('newName');
  const n=(name!==undefined?name:inp.value).trim();
  if(!n){ showToast('호수명을 입력해주세요','err'); return; }
  units.push({id:nid++,name:n,before:[],after:[],specials:[],open:true,customer:{phone:'',address:'',memo:''}});
  if(name===undefined){ inp.value=''; inp.focus(); }
  renderAll(); updateStats(); sessionAutoSave();
  showToast(`✅ "${n}" 호수가 추가되었습니다`, 'ok');
}

function bulkAdd() {
  const raw=prompt('여러 호수를 한꺼번에 입력하세요\n\n📌 구분자: 쉼표(,) 또는 슬래시(/)\n\n예시 1) 101동 201호, 101동 202호, 101동 203호\n예시 2) 201호 / 202호 / 203호');
  if(!raw) return;
  // 반각/전각 쉼표, 반각/전각 슬래시, 줄바꿈 모두 구분자로 인식
  const lines=raw.split(/[,，\/／\n]/).map(l=>l.trim()).filter(Boolean);
  if(lines.length===0) return;
  if(lines.length===1) {
    showToast('구분자(쉼표/슬래시)가 없습니다. 단일 호수로 추가합니다','err');
  }
  lines.forEach(l=>units.push({id:nid++,name:l,before:[],after:[],specials:[],open:false,customer:{phone:'',address:'',memo:''}}));
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
  // 작업 내용이 없으면 확인 없이 바로 초기화
  if (units.length === 0) {
    document.getElementById('workDate').value = kstDateStr();
    document.getElementById('aptName').value  = '';
    document.getElementById('aptName').placeholder = '작업명을 입력하세요';
    showToast('🆕 새 작업', 'ok');
    return;
  }

  // 작업 내용이 있으면 확인 1번만
  const totalPhotos = units.reduce((s,u) =>
    s + u.before.length + u.after.length +
    u.specials.reduce((a,sp) => a+sp.photos.length, 0), 0);

  let msg = `📋 현재 작업: 호수 ${units.length}개, 사진 ${totalPhotos}장\n\n`;
  if (photoFolderHandle) {
    msg += `저장 폴더에 자동 저장 후 새 작업을 시작합니다.\n계속할까요?`;
  } else {
    msg += `새 작업을 시작합니다.\n(저장 폴더가 없어 사진은 저장되지 않습니다)`;
  }

  if (!confirm(msg)) return;

  // 폴더 있으면 자동으로 저장 (변경 없으면 빠르게 스킵됨)
  if (photoFolderHandle) {
    try {
      await saveToFolder({ auto: true });
    } catch(e) {
      console.warn('자동 저장 실패:', e);
    }
  }

  // 🆕 고객 정보 저장 (폴더 없어도 customers DB는 별도)
  try {
    if (typeof flushAllCustomers === 'function') {
      const cnt = await flushAllCustomers();
      if (cnt > 0) console.log(`✓ ${cnt}명 고객 정보 저장`);
    }
  } catch(e) { console.warn('고객 저장 실패:', e); }

  // 초기화
  units = [];
  nid = 1;
  document.getElementById('rpWrap').innerHTML = '';
  document.getElementById('btnPDF').disabled = true;
  document.getElementById('btnJPG').disabled = true;
  document.getElementById('aptName').value = '';
  document.getElementById('aptName').placeholder = '작업명을 입력하세요';
  document.getElementById('workDate').value = kstDateStr();

  if (typeof _indexCounter !== 'undefined') _indexCounter.clear();
  if (typeof _unitWorkNumber !== 'undefined') _unitWorkNumber.clear();
  if (typeof _savedPhotoIds !== 'undefined') _savedPhotoIds.clear();
  if (typeof pendingSaves !== 'undefined') pendingSaves.length = 0;

  renderAll();
  updateStats();
  try { await sessionAutoSaveNow(); } catch(e) {}

  showToast('🆕 새 작업', 'ok');
}

// (이전 savePhotosForNewWork 함수는 saveToFolder로 통합되어 제거)


// ═══════════════════════════════
// 호수별 고객 정보 입력 이벤트 (이벤트 위임)
// ═══════════════════════════════
document.addEventListener('input', e => {
  const el = e.target;
  if (!el.classList || !(el.classList.contains('cust-inp') || el.classList.contains('cust-memo'))) return;

  const uid = el.dataset.uid;
  const field = el.dataset.field;
  if (!uid || !field) return;

  const u = units.find(x => String(x.id) === String(uid));
  if (!u) return;

  if (!u.customer) u.customer = { phone: '', address: '', memo: '' };

  // 전화번호 자동 하이픈
  if (field === 'phone') {
    const raw = el.value.replace(/[^\d]/g, '');
    let formatted = el.value;
    if (raw.length === 11 && raw.startsWith('010')) formatted = `${raw.slice(0,3)}-${raw.slice(3,7)}-${raw.slice(7)}`;
    else if (raw.length === 10 && raw.startsWith('02')) formatted = `${raw.slice(0,2)}-${raw.slice(2,6)}-${raw.slice(6)}`;
    else if (raw.length === 11) formatted = `${raw.slice(0,3)}-${raw.slice(3,7)}-${raw.slice(7)}`;
    else if (raw.length === 10) formatted = `${raw.slice(0,3)}-${raw.slice(3,6)}-${raw.slice(6)}`;
    if (formatted !== el.value) {
      const cur = el.selectionStart;
      el.value = formatted;
      try { el.setSelectionRange(cur+1, cur+1); } catch(e2) {}
    }
  }

  u.customer[field] = el.value;
  u.customer._dirty = true;  // 미저장 변경 표시
  sessionAutoSave();

  // 호수 카드의 저장 버튼 상태 갱신
  updateCustSaveBtnState(u.id);
});

// 호수 카드의 저장 버튼 상태 표시 갱신
function updateCustSaveBtnState(unitId) {
  const u = units.find(x => String(x.id) === String(unitId));
  if (!u) return;
  const statusEl = document.querySelector(`.cust-save-status[data-uid="${unitId}"]`);
  const btnEl = document.querySelector(`.cust-save-btn[data-uid="${unitId}"]`);
  if (!statusEl || !btnEl) return;

  const hasPhone = (u.customer?.phone || '').trim().length >= 9;
  const dirty = u.customer?._dirty;

  if (!hasPhone) {
    btnEl.disabled = true;
    btnEl.classList.add('disabled');
    statusEl.innerHTML = '<span style="color:var(--mu);">전화번호를 입력하세요</span>';
  } else if (dirty) {
    btnEl.disabled = false;
    btnEl.classList.remove('disabled');
    statusEl.innerHTML = '<span style="color:var(--wn);">● 저장 안 됨</span>';
  } else if (u.customer?._savedAt) {
    btnEl.disabled = false;
    btnEl.classList.remove('disabled');
    statusEl.innerHTML = `<span style="color:var(--ac2);">✓ ${u.customer._savedAt} 저장됨</span>`;
  } else {
    btnEl.disabled = false;
    btnEl.classList.remove('disabled');
    statusEl.innerHTML = '';
  }
}

// 호수 카드의 저장 버튼 클릭 (이벤트 위임)
document.addEventListener('click', async e => {
  const btn = e.target.closest('.cust-save-btn');
  if (!btn) return;
  e.stopPropagation();

  const uid = btn.dataset.uid;
  const u = units.find(x => String(x.id) === String(uid));
  if (!u) return;

  if (!u.customer?.phone || u.customer.phone.replace(/[^\d]/g,'').length < 9) {
    showToast('올바른 전화번호를 입력하세요', 'err');
    return;
  }

  try {
    btn.disabled = true;
    await saveCustomerForUnit(u);
    u.customer._dirty = false;
    const now = new Date();
    u.customer._savedAt = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    updateCustSaveBtnState(uid);
    // 폴더 xlsx 즉시 쓰기
    if (typeof flushCustomersXlsx === 'function') flushCustomersXlsx().catch(()=>{});
  } catch(err) {
    btn.disabled = false;
    showToast('저장 실패: ' + (err.message || err), 'err');
  }
});

// 호수의 고객 정보를 customers DB에 저장 (재방문이면 매칭)
async function saveCustomerForUnit(u) {
  if (!u) { console.log('🔴 [고객] u 없음'); return; }

  if (!u.customer) u.customer = { phone: '', address: '', memo: '' };

  let phone = (u.customer.phone || '').trim();
  if (!phone) {
    const phoneEl = document.querySelector(`.cust-inp[data-uid="${u.id}"][data-field="phone"]`);
    if (phoneEl) {
      phone = phoneEl.value.trim();
      u.customer.phone = phone;
    }
  }

  if (!phone) {
    console.log(`🟡 [고객] ${u.name} - 전화번호 없음, 스킵`);
    return;
  }

  const norm = normalizePhone(phone);
  const digits = norm.replace(/[^\d]/g, '');
  if (digits.length < 9) {
    console.log(`🟡 [고객] ${u.name} - 짧음 (${digits.length}자리), 스킵: ${phone}`);
    return;
  }

  console.log(`🔵 [고객] ${u.name} 저장 시도: ${norm}`);

  try {
    // customerSave 함수 (폴더 + IndexedDB 자동 저장)
    if (typeof customerSave !== 'function') {
      throw new Error('customerSave 함수 없음 - customer_storage.js 로드 실패?');
    }

    const addrEl = document.querySelector(`.cust-inp[data-uid="${u.id}"][data-field="address"]`);
    const memoEl = document.querySelector(`.cust-memo[data-uid="${u.id}"]`);
    const address = (addrEl?.value || u.customer.address || '').trim();
    const memo = (memoEl?.value || u.customer.memo || '').trim();

    const apt = document.getElementById('aptName').value || '';
    const date = document.getElementById('workDate').value || kstDateStr();
    const photoCount = u.before.length + u.after.length;

    // 기존 고객 확인 (재방문 토스트용)
    const existing = await customerLookup(norm);

    const result = await customerSave({
      phone: norm,
      // name은 보내지 않음 - 기존 이름 보존, 신규 시에만 visit.unit 사용
      address: address,
      memo: memo,
      visit: {
        date: date,
        apt: apt,
        unit: u.name,
        work: photoCount > 0
          ? `Photos: ${photoCount}${u.specials.length ? `, Notes: ${u.specials.length}` : ''}`
          : (u.specials.length ? `Notes: ${u.specials.length}` : 'In progress')
      }
    });

    console.log(`🟢 [고객] ${u.name} 저장 성공:`, result.phone);

    if (!existing) {
      showToast(`✓ 신규 고객 등록: ${norm}`, 'ok');
    } else if (u._lastShownExisting !== norm) {
      showToast(`🔔 재방문 고객! ${existing.name || norm} (${existing.visitCount}회)`, 'ok');
      u._lastShownExisting = norm;

      if (addrEl && !addrEl.value && existing.address) {
        addrEl.value = existing.address;
        u.customer.address = existing.address;
      }
      if (memoEl && !memoEl.value && existing.memo) {
        memoEl.value = existing.memo;
        u.customer.memo = existing.memo;
      }
    }

    return result;
  } catch(err) {
    console.error(`🔴 [고객] ${u.name} 저장 실패:`, err);
    showToast(`고객 저장 실패: ${err.message || err}`, 'err');
    throw err;
  }
}

// 모든 호수의 고객 정보를 customers DB에 저장 (배치)
async function flushAllCustomers() {
  if (typeof units === 'undefined' || !units || units.length === 0) {
    console.log('🟡 [flush] units 비어있음');
    return 0;
  }
  console.log(`🔵 [flush] 시작 - ${units.length}개 호수 검사`);
  let count = 0;
  let failed = 0;
  for (const u of units) {
    // 메모리 + DOM 양쪽에서 phone 확인
    const phoneFromMem = (u.customer?.phone || '').trim();
    const phoneEl = document.querySelector(`.cust-inp[data-uid="${u.id}"][data-field="phone"]`);
    const phoneFromDom = phoneEl ? phoneEl.value.trim() : '';
    const phone = phoneFromDom || phoneFromMem;

    if (!phone) {
      console.log(`  ⏭️ ${u.name}: 전화번호 없음`);
      continue;
    }

    // u.customer 동기화
    if (!u.customer) u.customer = { phone: '', address: '', memo: '' };
    if (phoneFromDom) u.customer.phone = phoneFromDom;

    try {
      await saveCustomerForUnit(u);
      // dirty 해제 + 저장 시각 기록
      if (u.customer) {
        u.customer._dirty = false;
        const now = new Date();
        u.customer._savedAt = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      }
      // UI 갱신 (열려있는 카드만)
      if (typeof updateCustSaveBtnState === 'function') updateCustSaveBtnState(u.id);
      count++;
    } catch(e) {
      console.error(`  ❌ ${u.name}:`, e);
      failed++;
    }
  }
  console.log(`🟢 [flush] 완료 - 성공 ${count}, 실패 ${failed}`);
  return count;
}

// 페이지 종료 시 저장
// 페이지 종료/숨김 시: 변경 있을 때만 저장 (빠르게)
function onPageEnd() {
  // 변경 없으면 스킵 (빠르게 종료)
  if (typeof _dataDirty !== 'undefined' && !_dataDirty) {
    return;
  }
  // 변경 있을 때만 customer 정보 저장 시도 (비동기, 결과 안 기다림)
  flushAllCustomers().then(() => {
    if (typeof flushCustomersXlsx === 'function') return flushCustomersXlsx();
  }).catch(()=>{});
}

window.addEventListener('pagehide', onPageEnd);
window.addEventListener('beforeunload', onPageEnd);
