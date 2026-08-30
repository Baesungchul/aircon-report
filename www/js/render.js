/* ★ 2026-08-13 공용 판정 — '내가 손댈 수 없는 남의 사진'인가.
   내 작업 화면에서는 상대가 보탠 사진(_borrowedIncoming),
   공유작업(빌려보기) 화면에서는 원작업자 사진(_cloudUploaded && !_addedByMe)이 여기 해당한다.
   예전엔 _borrowedIncoming 하나만 보는 곳이 여럿이었는데, 그 플래그는 내 작업 화면 전용이라
   빌려보기 화면에서는 항상 false 였다. 순서편집을 공유작업자에게 열면서 그 구멍이 드러났다. */
window.isForeignPhoto = function (p) {
  if (!p || typeof p !== 'object') return false;
  if (p._borrowedIncoming) return true;
  return !!(window._borrowedShare && p._cloudUploaded && !p._addedByMe);
};

/* ★ 2026-08-13 '작업 전↔후로 옮길 수 있는가' — 삭제 권한(isForeignPhoto)과는 기준이 다르다.
   전/후는 그 사진 문서의 role 값이고, 그 값을 고칠 수 있는 쪽만 옮길 수 있다.
     · 내 작업 화면에서 상대가 보탠 사진 → **옮길 수 있다.**
       그 문서는 내 저장소에 있고, 상대 사진 이름(add_...)에는 전/후가 안 들어가서
       role 값만 고치면 끝난다(다시 올리거나 지우는 동작 없음).
     · 빌려보기 화면에서 원작업자 사진 → **옮길 수 없다.**
       원작업자 사진은 이름에 전/후가 박혀 있고, 무엇보다 원작업자의 _session.json 이
       위치의 기준이라 내가 클라우드만 고쳐도 그쪽 화면이 안 따라온다.
   삭제는 별개다 — 남의 사진 삭제는 지금처럼 계속 막는다. */
window.canMovePhotoSide = function (p) {
  if (!p || typeof p !== 'object') return true;
  if (window._borrowedShare) return !window.isForeignPhoto(p);   // 빌려보기 화면: 내가 올린 것만
  return true;                                                   // 내 작업 화면: 상대가 보탠 사진도 허용
};

/* ═══════════════════════════════
   RENDER  (리디자인: 밝은 딥틸 / 트랙 UI / SVG 아이콘)
═══════════════════════════════ */

// 인라인 SVG 아이콘 (이모지 전량 교체) — currentColor 상속
const _SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">';
const ICO = {
  edit:    _SVG+'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  reorder: _SVG+'<path d="M8 7l4-4 4 4M8 17l4 4 4-4M12 3v18"/></svg>',
  trash:   _SVG+'<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>',
  gallery: _SVG+'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
  chevD:   _SVG+'<path d="M6 9l6 6 6-6"/></svg>',
  chevR:   _SVG+'<path d="M9 18l6-6-6-6"/></svg>',
  camera:  _SVG+'<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  file:    _SVG+'<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  plus:    _SVG+'<path d="M12 5v14M5 12h14"/></svg>',
  x:       _SVG+'<path d="M6 6l12 12M18 6L6 18"/></svg>',
  arrowR:  _SVG+'<path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  alert:   _SVG+'<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  phone:   _SVG+'<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
  undo:    _SVG+'<path d="M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8"/></svg>',
  home:    _SVG+'<path d="M3 10.5L12 3l9 7.5M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/></svg>',
  search:  _SVG+'<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>',
  check:   _SVG+'<path d="M5 13l4 4L19 7"/></svg>',
  users:   _SVG+'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>'
};

// 고객 정보 복사 버튼 - 다른 호수에서 가져오기
function renderCustomerCopyButtons(u) {
  // 같은 작업 안의 다른 호수 중 전화번호가 입력된 것 찾기
  const others = units.filter(other =>
    other.id !== u.id &&
    other.customer?.phone &&
    other.customer.phone.replace(/[^\d]/g, '').length >= 9
  );

  if (others.length === 0) return '';

  // 직전 호수 (현재 호수 바로 위)
  const myIdx = units.findIndex(x => x.id === u.id);
  const prevUnit = myIdx > 0 ? units[myIdx - 1] : null;
  const prevHasPhone = prevUnit && prevUnit.customer?.phone &&
    prevUnit.customer.phone.replace(/[^\d]/g, '').length >= 9;

  // 현재 호수에 이미 전화번호 있으면 복사 버튼 숨김
  const myPhone = (u.customer?.phone || '').replace(/[^\d]/g, '');
  if (myPhone.length >= 9) return '';

  let html = '<div class="cust-copy-row">';

  // 직전 호수 복사
  if (prevHasPhone) {
    html += `<button class="cust-copy-btn cust-copy-prev" data-uid="${u.id}" data-from="${prevUnit.id}">위 동호수와 동일 (${escH(prevUnit.name)})</button>`;
  }

  // 다른 호수 선택
  if (others.length > (prevHasPhone ? 1 : 0)) {
    html += `<button class="cust-copy-btn cust-copy-other" data-uid="${u.id}">다른 동호수에서 복사</button>`;
  }

  html += '</div>';
  return html;
}

/* ═══════════════════════════════════════════════════════════
   특이사항 id 보정 (2026-08-12)

   증상: 작업을 불러오거나 공유작업을 연 뒤에는 특이사항의
         삭제·설명 편집·사진 삭제가 전부 먹지 않았다.

   원인: 특이사항 객체에 id를 붙이는 곳은 '특이사항 추가' 버튼 하나뿐이다
         (events.js `u.specials.push({ id: Date.now(), ... })`).
         반면 다시 만드는 경로 8곳(dialogs.js 불러오기 3곳,
         cloud_photo_sync.js 공유작업/병합 5곳)은 { desc, photos } 만 만들어
         id가 없었다. 화면은 data-sid="undefined" 로 그려지고,
         핸들러는 `s.id === +dataset.sid` 로 찾는데 +undefined = NaN 이라
         무엇과도 일치하지 않는다 → 삭제 필터가 아무것도 못 거르고,
         설명 편집도 대상을 못 찾아 조용히 저장되지 않았다.

   해결: 만드는 곳을 8군데 고치면 앞으로 새 경로가 생길 때 또 빠진다.
         화면을 그리기 직전에 한 번 보정해 모든 경로를 한꺼번에 덮는다.
         이미 id가 있으면 절대 건드리지 않는다(기존 데이터 보존).
═══════════════════════════════════════════════════════════ */
function ensureSpecialIds() {
  try {
    if (typeof units === 'undefined' || !Array.isArray(units)) return 0;
    var fixed = 0;
    units.forEach(function (u) {
      if (!u || !Array.isArray(u.specials)) return;
      var used = {};
      u.specials.forEach(function (s) {
        if (s && s.id !== undefined && s.id !== null && s.id !== '' && !isNaN(+s.id)) used[+s.id] = 1;
      });
      u.specials.forEach(function (s) {
        if (!s) return;
        if (s.id !== undefined && s.id !== null && s.id !== '' && !isNaN(+s.id)) return;  // 정상 → 유지
        var cand = Date.now();
        while (used[cand]) cand++;              // 같은 호수 안에서 유일하게
        used[cand] = 1;
        s.id = cand;
        fixed++;
      });
    });
    return fixed;
  } catch (e) { return 0; }
}
if (typeof window !== 'undefined') window.ensureSpecialIds = ensureSpecialIds;

function renderAll() {
  try {
    ensureSpecialIds();   // ★ 그리기 전에 특이사항 id 보정 (없으면 삭제·편집이 안 먹음)
    const q=(document.getElementById('srch')?.value||'').trim().toLowerCase();
    const filtered=q?units.filter(u=>u.name.toLowerCase().includes(q)):units;
    const el=document.getElementById('uList');
    if (!el) return;

    if(units.length===0){ el.innerHTML=`<div class="empty"><div class="empty-ic">${ICO.home}</div><p>위에서 동호수를 추가해주세요</p></div>`; return; }
    if(filtered.length===0){ el.innerHTML=`<div class="empty"><div class="empty-ic">${ICO.search}</div><p>검색 결과 없음</p></div>`; return; }

  el.innerHTML=filtered.map(u=>{
    const ri=units.indexOf(u);
    const hB=u.before.length>0, hA=u.after.length>0;
    const scls=(hB&&hA)?'done':(hB||hA)?'part':'';
    const badge=(hB&&hA)?`<span class="bdg bdg-ok">완료</span>`
      :(hB||hA)?`<span class="bdg bdg-pt">${hB?`전${u.before.length}`:''}${hA?`후${u.after.length}`:''}장</span>`
      :`<span class="bdg bdg-no">사진없음</span>`;

    // ★ 2026-07-11: 공유로 받은 사진은 삭제 불가(올린 사람만 삭제 가능) → ✕ 대신 잠금 배지
    const _phLocked = (p) => window.isForeignPhoto(p);
    const makeThumbs=(arr,type)=>arr.map((p,idx)=>{
      const src = photoUrl(p);
      const saved = (typeof p === 'object' && p.savedToFolder);
      const pid = (typeof p === 'object' && p.id) ? p.id : '';
      return `<div class="th-wrap${saved?' th-saved':''}" title="${saved?'폴더 저장됨':''}">
        <img src="${src}" alt="" data-photo-id="${pid}" loading="lazy">
        ${((u.before.length + u.after.length)>1) ? `<div class="th-drag" title="끌어서 순서 변경">☰</div>` : ''}
        ${_phLocked(p) ? `<span class="th-lock" title="공유 사진 - 삭제는 올린 사람만 가능">${ICO.users}</span>` : `<button class="th-del" data-uid="${u.id}" data-type="${type}" data-idx="${idx}">${ICO.x}</button>`}
      </div>`;
    }).join('');

    const makeSpThumbs=(s)=>s.photos.map((p,idx)=>{
      const src = photoUrl(p);
      const saved = (typeof p === 'object' && p.savedToFolder);
      const pid = (typeof p === 'object' && p.id) ? p.id : '';
      return `<div class="th-wrap th-wrap-sp${saved?' th-saved':''}" title="${saved?'폴더 저장됨':''}">
        <img src="${src}" data-photo-id="${pid}" loading="lazy" alt="">
        ${(s.photos.length>1) ? `<div class="th-drag" title="끌어서 순서 변경">☰</div>` : ''}
        ${_phLocked(p) ? `<span class="th-lock" title="공유 사진 - 삭제는 올린 사람만 가능">${ICO.users}</span>` : `<button class="th-del sp-th-del" data-uid="${u.id}" data-sid="${s.id}" data-idx="${idx}">${ICO.x}</button>`}
      </div>`;
    }).join('');

    const makeUpload=type=>`
      <div class="up-btns">
        <button type="button" class="up-btn" onclick="openInAppCamera(${u.id},'${type}')">${ICO.camera}<span>카메라</span></button>
        <label class="up-btn">${ICO.file}<span>파일</span><input type="file" accept="image/*" multiple data-uid="${u.id}" data-type="${type}"></label>
      </div>`;

    const spHtml=u.specials.map(s=>`
      <div class="sp-item" data-uid="${u.id}" data-sid="${s.id}">
        <div class="sp-header">
          <textarea class="sp-txt" placeholder="특이사항 내용..." data-uid="${u.id}" data-sid="${s.id}">${escH(s.desc)}</textarea>
          <button class="sp-del icon-btn" data-uid="${u.id}" data-sid="${s.id}" title="특이사항 삭제">${ICO.x}</button>
        </div>
        <div class="up-btns">
          <button type="button" class="up-btn sp-up-cam" onclick="openInAppCamera(${u.id},'special',${s.id})">${ICO.camera}<span>카메라</span></button>
          <label class="up-btn sp-up-gal">${ICO.gallery}<span>갤러리</span><input type="file" accept="image/*" multiple data-uid="${u.id}" data-type="special" data-sid="${s.id}"></label>
        </div>
        <div class="sp-photos">${makeSpThumbs(s)}</div>
      </div>`).join('');

    // ★ 저장된 글 채널 칩 (첫 호수에만 - 글은 작업 단위로 저장됨)
    function postChips() {
      var list = [];
      try { list = (window.ClaudeAI && ClaudeAI.postChannels) ? ClaudeAI.postChannels() : []; } catch (e) {}
      if (!list.length) return '';
      return '<div class="u-posts">' + list.map(function (c) {
        return '<button type="button" class="u-post-chip" data-ch="' + c.ch + '" title="' + c.label + ' 글 열기">' +
          '<span class="u-post-ic">' + (c.iconHtml || c.icon) + '</span>' +
          (c.count > 1 ? '<span class="u-post-n">' + c.count + '</span>' : '') +
        '</button>';
      }).join('') + '</div>';
    }

    return `<div class="u-card ${scls}" id="card-${u.id}">
      <div class="u-top" data-id="${u.id}">
        <div class="u-head">
          <div class="u-num">${ri+1}</div>
          <div class="u-name-row" data-uid="${u.id}">
            <span class="u-name" id="nm-${u.id}">${escH(u.name)}</span>
            <button class="icon-btn edit-ic" title="이름 편집">${ICO.edit}</button>
          </div>
          ${ri===0 ? postChips() : ''}
          <span class="u-chev ${u.open?'open':''}">${ICO.chevD}</span>
          <div class="u-head-actions">
            ${badge}
            <button class="icon-btn u-act u-gal-btn" data-uid="${u.id}" title="이 동호수 사진을 휴대폰 갤러리에 저장">${ICO.gallery}<span>갤러리 저장</span></button>
            <button class="icon-btn u-act del-btn" data-id="${u.id}" title="삭제">${ICO.trash}</button>
          </div>
        </div>
      </div>
      ${u.open ? `
      <div class="u-body open">
        <div class="track">
          <div class="track-body">
            <div class="pane pane-b">
              <div class="pane-hd"><span class="dot"></span><span>작업 전</span><span class="cnt">${u.before.length}</span></div>
              ${makeUpload('before')}
              <div class="thumbs">${makeThumbs(u.before,'before')}</div>
            </div>
            <div class="pane pane-a">
              <div class="pane-hd"><span class="dot"></span><span>작업 후</span><span class="cnt">${u.after.length}</span></div>
              ${makeUpload('after')}
              <div class="thumbs">${makeThumbs(u.after,'after')}</div>
            </div>
          </div>
        </div>
        ${currentWorkType === 'facility' ? '' : `
        <div class="cust-sec">
          <div class="cust-toggle rowlink" data-uid="${u.id}">
            <span class="rowlink-lead">${ICO.phone}</span>
            <span class="cust-toggle-title">고객 정보</span>
            ${u.customer?.name || u.customer?.phone ? `<span class="cust-toggle-info">${u.customer?.name?escH(u.customer.name)+' · ':''}${escH(u.customer?.phone||'')}${u.customer?.address?' · '+escH(u.customer.address):''}</span>` : '<span class="cust-toggle-empty">미입력</span>'}
            <span class="cust-toggle-arrow">${u.customerOpen ? ICO.chevD : ICO.chevR}</span>
          </div>
          <div class="cust-content" style="${u.customerOpen ? '' : 'display:none;'}">
            <div class="cust-hdr">
              <span class="cust-hint">메인 저장 시 함께 저장됩니다</span>
            </div>
            <div class="cust-save-status" data-uid="${u.id}">${(u.customer?.phone||'').trim() ? '' : '<span class="cust-hint">전화번호를 입력하세요</span>'}</div>

            ${renderCustomerCopyButtons(u)}

            <label class="cust-fld-lb">고객명 <span style="font-weight:400;color:var(--mu);">(선택)</span></label>
            <input class="cust-inp" type="text" placeholder="예: 홍길동" data-uid="${u.id}" data-field="name" value="${escH(u.customer?.name || '')}">
            <label class="cust-fld-lb">전화번호</label>
            <input class="cust-inp" type="text" inputmode="tel" placeholder="010-1234-5678" data-uid="${u.id}" data-field="phone" value="${escH(u.customer?.phone || '')}">
            <label class="cust-fld-lb">주소</label>
            <input class="cust-inp" type="text" placeholder="주소 (선택)" data-uid="${u.id}" data-field="address" value="${escH(u.customer?.address || '')}">
            <label class="cust-fld-lb">작업대상</label>
            <input class="cust-inp" type="text" placeholder="예: 벽걸이 2대, 시스템에어컨" data-uid="${u.id}" data-field="workTarget" value="${escH(u.customer?.workTarget || '')}">
            <label class="cust-fld-lb">메모</label>
            <textarea class="cust-memo" rows="2" placeholder="요청사항, 결제 방법, 추천인 등" data-uid="${u.id}" data-field="memo">${escH(u.customer?.memo || '')}</textarea>
            <label class="cust-fld-lb">가격 (원)</label>
            <input class="cust-inp" type="text" inputmode="numeric" placeholder="예: 120000" data-uid="${u.id}" data-field="price" value="${escH(u.customer?.price || '')}">
            <label class="cust-fld-lb">작업시간</label>
            <div class="cust-time-row">
              <input class="cust-inp cust-time" type="time" data-uid="${u.id}" data-field="startTime" value="${escH(u.customer?.startTime || '')}">
              <span class="cust-pt-tilde">~</span>
              <input class="cust-inp cust-time" type="time" data-uid="${u.id}" data-field="endTime" value="${escH(u.customer?.endTime || '')}">
            </div>
          </div>
        </div>`}
        ${(u._trash && u._trash.length > 0) ? `
        <div class="trash-sec">
          <div class="trash-hdr" data-uid="${u.id}">
            <span class="trash-hdr-l">${ICO.trash}<span>삭제된 사진 (${u._trash.length}장)</span></span>
            <span class="trash-arrow">${u._trashOpen ? ICO.chevD : ICO.chevR}</span>
          </div>
          <div class="trash-content" style="${u._trashOpen ? '' : 'display:none;'}">
            <div class="trash-actions">
              <button class="trash-restore-all" data-uid="${u.id}">${ICO.undo}<span>전체 복원</span></button>
              <button class="trash-empty" data-uid="${u.id}">${ICO.trash}<span>비우기</span></button>
            </div>
            <div class="trash-thumbs">
              ${u._trash.map((p, ti) => `
                <div class="trash-thumb">
                  <img src="${p.dataUrl || p.thumb || ''}" data-photo-id="${p.id || ''}" alt="삭제된 사진">
                  <span class="trash-thumb-type">${p._trashType === 'before' ? '전' : '후'}</span>
                  <button class="trash-restore-one icon-btn" data-uid="${u.id}" data-tidx="${ti}" title="복원">${ICO.undo}</button>
                </div>
              `).join('')}
            </div>
          </div>
        </div>` : ''}
        <div class="sp-sec">
          <div class="sp-hdr">${ICO.alert}<span>특이사항</span><span class="sp-cnt">${u.specials.length}</span></div>
          ${spHtml}
          <button class="add-sp-btn" data-uid="${u.id}">${ICO.plus}<span>특이사항 추가</span></button>
        </div>
      </div>` : ''}
    </div>`;
  }).join('');

  // ★ 지연(lazy) 사진 즉시 로딩 트리거 — 최초 렌더에서 전/후 사진이 안 뜨던 문제 방지
  try {
    filtered.forEach(u => {
      if (!u.open) return;
      const all = [...(u.before||[]), ...(u.after||[]), ...((u.specials||[]).flatMap(s => s.photos||[]))];
      all.forEach(p => {
        if (p && typeof p === 'object' && p.lazy && !p._loading &&
            (p.fileHandle || (p._workDir && p.fileName)) && typeof loadLazyPhoto === 'function') {
          loadLazyPhoto(p);
        }
      });
    });
  } catch(e) {}

  // ★ 호수 변경 후 UI 동기화 (가정용 1호수 제한 등)
  if (typeof applyWorkTypeUI === 'function') applyWorkTypeUI();
  } catch(e) {
    console.error('[renderAll] 실패:', e);
    const el = document.getElementById('uList');
    if (el) el.innerHTML = `<div class="empty"><div class="empty-ic">${ICO.alert}</div><p>화면 표시 오류 - 새로고침해주세요</p></div>`;
  }
}

function updateStats() {
  try {
    const t=units.length;
    const c=units.filter(u=>u.before.length>0&&u.after.length>0).length;
  const p=units.filter(u=>(u.before.length>0||u.after.length>0)&&!(u.before.length>0&&u.after.length>0)).length;
  const ph=units.reduce((s,u)=>s+u.before.length+u.after.length+u.specials.reduce((a,sp)=>a+sp.photos.length,0),0);
  const sTot = document.getElementById('sTot');
  const sCmp = document.getElementById('sCmp');
  const sPrt = document.getElementById('sPrt');
  const sPh  = document.getElementById('sPh');
  const btnGen = document.getElementById('btnGen');
  if (sTot) sTot.textContent = t;
  if (sCmp) sCmp.textContent = c;
  if (sPrt) sPrt.textContent = p;
  if (sPh)  sPh.textContent  = ph;
  if (btnGen) btnGen.disabled = t === 0;
  syncTakeBtn();
  } catch(e) {
    console.error('[updateStats] 실패:', e);
  }
}

// ★ 지연 사진 로딩 완료 후 전체 재렌더(디바운스) — id 매칭 실패 대비 안전망
let _lazyRerenderTimer = null;
function scheduleLazyRerender() {
  clearTimeout(_lazyRerenderTimer);
  _lazyRerenderTimer = setTimeout(() => { try { renderAll(); } catch (e) {} }, 140);
}


/* ★ 2026-08-08 작업탭 '가져오기' 버튼
     공유받은 작업(_borrowedShare)을 열어둔 상태에서만 활성화된다.
     누르면 그 일정이 내 작업이 되고(작업자=나), 이후 저장은 내 계정으로 들어간다.
     ⚠️ 사진이 있는 작업은 대상이 아니다(사진 소유권 이전 필요) — 비활성 상태로 두고 이유를 안내한다. */
function _takeBtnState() {
  /* ⛔ 2026-08-13: 가져오기 폐지 → 항상 숨김. 담당자 변경은 달력 [상세]에서 한다.
     index.html 의 #btnTake 도 함께 제거했지만, 캐시된 옛 index.html 이 남아 있어도
     버튼이 되살아나지 않도록 여기서도 막는다. */
  return { on: false, why: 'none' };
  /* eslint-disable no-unreachable */
  var b = window._borrowedShare;
  if (!b || !b.ownerUid || !b.workId) return { on: false, why: 'none' };
  if (!window.CloudShare || !CloudShare.findSharedItem) return { on: false, why: 'none' };
  var d = CloudShare.findSharedItem(b.ownerUid, b.workId);
  if (!d) return { on: false, why: 'none' };
  var me = window.Cloud && Cloud.user && Cloud.user.uid;
  if (d.ownerUid === me) return { on: false, why: 'mine', d: d };
  // ★ 실제 작업은 사진 개수와 무관하게 가져오기 불가 (사유는 cloud_share.js canTakeSchedule 주석)
  if (!d.manual) return { on: false, why: 'real-work', d: d };
  var photos = (d.totalPhotos || 0) + (d.addedPhotos || 0);
  if (photos > 0) return { on: false, why: 'photos', photos: photos, d: d };
  return { on: true, d: d };
}
/* 가져오기 직후 담당자 칸을 '나'로 확정한다.
   주의점 두 가지가 있어 그냥 value 대입만으로는 비어 보일 수 있다.
     ① 공유 중이면 입력칸(input)이 숨겨지고 select(#workerNickSel)가 대신 보인다.
     ② select 에 없는 값을 넣으면 브라우저가 빈 값으로 되돌린다 → 옵션이 없으면 직접 추가해야 한다. */
function _forceWorkerToMe() {
  try {
    if (!window.CloudShare) return;
    var myName = '';
    try { myName = (CloudShare.myProfile && CloudShare.myProfile().name) || ''; } catch (e) {}
    if (!myName && window.WorkerCombo && WorkerCombo.defaultName) {
      try { myName = WorkerCombo.defaultName() || ''; } catch (e) {}
    }
    if (!myName) return;
    var inp = document.getElementById('workerName');
    if (inp && inp.value !== myName) inp.value = myName;   // setter 훅이 콤보 동기화까지 처리
    var sel = document.getElementById('workerNickSel');
    if (sel) {
      var found = false;
      for (var i = 0; i < sel.options.length; i++) { if (sel.options[i].value === myName) { found = true; break; } }
      if (!found) {
        var op = document.createElement('option');
        op.value = myName; op.textContent = myName;
        sel.appendChild(op);
      }
      if (sel.value !== myName) sel.value = myName;
    }
  } catch (e) {}
}

function syncTakeBtn() {
  var btn = document.getElementById('btnTake');
  if (!btn) return;
  var st = _takeBtnState();
  // '공유작업을 안 열었을 때'는 버튼을 숨기고, 열었는데 조건이 안 될 때만 흐리게 남겨 이유를 알려준다
  var show = (st.why !== 'none');
  btn.style.display = show ? '' : 'none';
  // ★ .hdr-btns 는 2칸 그리드라 버튼이 3개면 아랫줄로 밀린다 → 보일 때만 3칸으로 전환
  try {
    var row = document.getElementById('hdrBtns');
    if (row) row.classList.toggle('has-take', show);
  } catch (e) {}
  btn.disabled = false;                 // 비활성이어도 눌러서 이유를 볼 수 있게
  btn.style.opacity = st.on ? '' : '.45';
  btn.title = st.on ? '내 작업으로 가져오기'
            : (st.why === 'photos') ? '사진이 있어 가져올 수 없음'
            : (st.why === 'real-work') ? '실제 작업은 가져올 수 없음' : '이미 내 작업입니다';
}
document.addEventListener('DOMContentLoaded', function () {
  var btn = document.getElementById('btnTake');
  if (!btn) return;
  syncTakeBtn();
  btn.addEventListener('click', function () {
    var st = _takeBtnState();
    if (st.why === 'none') { alert('공유받은 작업을 연 상태에서 사용할 수 있습니다.'); return; }
    if (st.why === 'mine') { alert('이미 내 작업입니다.'); return; }
    if (st.why === 'real-work') {
      alert('📥 실제 작업은 가져올 수 없습니다\n\n' +
            '사진이 있을 수 있는 실제 작업은 가져오기 대상이 아닙니다.\n' +
            '사진 없는 "일정"만 가져올 수 있습니다.');
      return;
    }
    if (st.why === 'photos') {
      alert('📷 사진이 있는 작업은 가져올 수 없습니다\n\n' +
            '사진 ' + st.photos + '장이 상대방 저장소에 있어서, 가져오려면 사진 소유권까지 옮겨야 합니다.\n' +
            '지금은 사진이 없는 일정만 가져올 수 있습니다.\n\n' +
            '· 상대에게 사진을 지워달라고 요청한 뒤 다시 시도하거나\n' +
            '· 채팅으로 사진을 받아 새 작업으로 만들어 주세요.');
      return;
    }
    var d = st.d;
    var who = d.partnerName || '상대';
    if (!confirm('📥 이 작업을 내 것으로 가져올까요?\n\n' +
                 '· ' + (d.apt || '작업') + ' (' + (d.date || '') + ')\n' +
                 '· 작업자가 나로 바뀌고, 저장하면 내 작업이 됩니다\n' +
                 '· ' + who + '님의 달력에서는 사라집니다')) return;
    btn.disabled = true;
    CloudShare.takeSchedule(d).then(function (newId) {
      /* ★ 2026-08-08 중요 — '빌려보기'를 완전히 끊고 내 새 작업으로 갈아끼운다.
           예전엔 _borrowedShare 만 지웠는데, currentWorkId 가 여전히 상대 작업 id 였다.
           그래서 사진을 찍어 저장하면 상대 작업에 병합되고("상대가 작업을 추가했다" 알림),
           다시 불러올 때 사진을 상대 저장소에서 받아오느라 오래 걸렸으며,
           사진을 지워도 상대 스케줄에 '공유 사진' 수가 남아 있었다. */
      window._borrowedShare = null;
      try { if (window.CloudPhotoSync && CloudPhotoSync.stopLivePhotoSync) CloudPhotoSync.stopLivePhotoSync(); } catch (e) {}
      try {
        if (newId) currentWorkId = newId;          // 내 항목 id 로 교체
        currentFolderName = null;                  // 저장 시 내 폴더를 새로 만들게 한다
      } catch (e) {}
      try { if (typeof markDataDirty === 'function') markDataDirty(); } catch (e) {}
      syncTakeBtn();
      try { if (typeof renderAll === 'function') renderAll(); } catch (e) {}
      try { if (typeof updateStats === 'function') updateStats(); } catch (e) {}
      // ★ 담당자를 '나'로 — 렌더가 모두 끝난 뒤에 넣어야 덮이지 않는다.
      //   공유 프로필 스냅샷이 늦게 도착해 콤보를 다시 그리는 경우가 있어 잠시 뒤 한 번 더 확인한다.
      _forceWorkerToMe();
      setTimeout(_forceWorkerToMe, 0);
      setTimeout(_forceWorkerToMe, 400);
      if (typeof showToast === 'function') showToast('내 작업이 되었습니다 — 사진을 찍고 저장하세요', 'ok');
    }).catch(function () { btn.disabled = false; syncTakeBtn(); });
  });
});
