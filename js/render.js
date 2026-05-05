/* ═══════════════════════════════
   RENDER
═══════════════════════════════ */

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
    html += `<button class="cust-copy-btn cust-copy-prev" data-uid="${u.id}" data-from="${prevUnit.id}">⬆️ 위 호수와 동일 (${escH(prevUnit.name)})</button>`;
  }

  // 다른 호수 선택
  if (others.length > (prevHasPhone ? 1 : 0)) {
    html += `<button class="cust-copy-btn cust-copy-other" data-uid="${u.id}">📋 다른 호수에서 복사</button>`;
  }

  html += '</div>';
  return html;
}

function renderAll() {
  const q=document.getElementById('srch').value.trim().toLowerCase();
  const filtered=q?units.filter(u=>u.name.toLowerCase().includes(q)):units;
  const el=document.getElementById('uList');

  if(units.length===0){ el.innerHTML=`<div class="empty"><div class="empty-ic">🏠</div><p>위에서 호수를 추가해주세요</p></div>`; return; }
  if(filtered.length===0){ el.innerHTML=`<div class="empty"><div class="empty-ic">🔍</div><p>검색 결과 없음</p></div>`; return; }

  el.innerHTML=filtered.map(u=>{
    const ri=units.indexOf(u);
    const hB=u.before.length>0, hA=u.after.length>0;
    const scls=(hB&&hA)?'done':(hB||hA)?'part':'';
    const badge=(hB&&hA)?`<span class="bdg bdg-ok">✅ 완료</span>`
      :(hB||hA)?`<span class="bdg bdg-pt">⚠️ ${hB?`전${u.before.length}`:''}${hA?`후${u.after.length}`:''}장</span>`
      :`<span class="bdg bdg-no">사진없음</span>`;

    const makeThumbs=(arr,type)=>arr.map((p,idx)=>{
      const src = photoUrl(p);
      const saved = (typeof p === 'object' && p.savedToFolder);
      return `<div class="th-wrap" title="${saved?'폴더 저장됨':''}">
        <img src="${src}" alt="">
        ${saved?'<span class="th-saved">✓</span>':''}
        <button class="th-del" data-uid="${u.id}" data-type="${type}" data-idx="${idx}">✕</button>
        <button class="th-save-btn" data-uid="${u.id}" data-type="${type}" data-idx="${idx}" title="폴더로 저장">↓</button>
      </div>`;
    }).join('');

    const makeSpThumbs=(s)=>s.photos.map((p,idx)=>{
      const src = photoUrl(p);
      const saved = (typeof p === 'object' && p.savedToFolder);
      return `<div class="th-wrap" title="${saved?'폴더 저장됨':''}">
        <img src="${src}" style="width:50px;height:50px;object-fit:cover;border-radius:5px;border:1px solid var(--bd);cursor:pointer;" alt="">
        ${saved?'<span class="th-saved" style="font-size:8px;width:13px;height:13px;">✓</span>':''}
        <button class="th-del sp-th-del" data-uid="${u.id}" data-sid="${s.id}" data-idx="${idx}">✕</button>
        <button class="th-save-btn sp-save-btn" data-uid="${u.id}" data-sid="${s.id}" data-idx="${idx}" title="폴더로 저장" style="width:15px;height:15px;font-size:8px;">↓</button>
      </div>`;
    }).join('');

    const makeUpload=type=>`
      <div class="up-btns">
        <label class="up-btn">📷 카메라<input type="file" accept="image/*" capture="environment" multiple data-uid="${u.id}" data-type="${type}"></label>
        <label class="up-btn">🗂️ 파일<input type="file" accept="image/*" multiple data-uid="${u.id}" data-type="${type}"></label>
      </div>`;

    const spHtml=u.specials.map(s=>`
      <div class="sp-item">
        <button class="sp-del" data-uid="${u.id}" data-sid="${s.id}">✕ 삭제</button>
        <textarea class="sp-txt" placeholder="특이사항 내용..." data-uid="${u.id}" data-sid="${s.id}">${escH(s.desc)}</textarea>
        <div class="sp-photos">
          ${makeSpThumbs(s)}
          <label class="up-btn" style="width:50px;height:50px;flex:none;border-radius:6px;font-size:9px;flex-direction:column;gap:1px;">
            📷<input type="file" accept="image/*" multiple data-uid="${u.id}" data-type="special" data-sid="${s.id}">
          </label>
        </div>
      </div>`).join('');

    return `<div class="u-card ${scls}" id="card-${u.id}">
      <div class="u-top" data-id="${u.id}">
        <!-- 1줄: 번호 + 호수명 + 펼침 -->
        <div class="u-row1">
          <div class="u-num">${ri+1}</div>
          <div class="u-name-row" data-uid="${u.id}">
            <span class="u-name" id="nm-${u.id}">${escH(u.name)}</span>
            <button class="icon-btn edit-ic">✏️</button>
          </div>
          <span class="u-chev ${u.open?'open':''}">▼</span>
        </div>
        <!-- 2줄: 상태/액션 -->
        <div class="u-row2">
          ${badge}
          ${(u.before.length >= 2 || u.after.length >= 2) ? `<button class="reorder-btn" data-uid="${u.id}" title="사진 순서 편집">🔄 순서 편집</button>` : ''}
          <button class="del-btn" data-id="${u.id}">삭제</button>
        </div>
      </div>
      <div class="u-body ${u.open?'open':''}">
        <div class="ph-cols">
          <div>
            <div class="ph-lbl lbl-b">🔴 작업 전 (${u.before.length}장)</div>
            ${makeUpload('before')}
            <div class="thumbs">${makeThumbs(u.before,'before')}</div>
          </div>
          <div>
            <div class="ph-lbl lbl-a">🟢 작업 후 (${u.after.length}장)</div>
            ${makeUpload('after')}
            <div class="thumbs">${makeThumbs(u.after,'after')}</div>
          </div>
        </div>
        <div class="sp-sec">
          <div class="sp-hdr">⚠️ 특이사항 (${u.specials.length}건)</div>
          ${spHtml}
          <button class="add-sp-btn" data-uid="${u.id}">＋ 특이사항 추가</button>
        </div>
        ${currentWorkType === 'facility' ? '' : `
        <div class="cust-sec">
          <div class="cust-toggle" data-uid="${u.id}">
            <span class="cust-toggle-label">
              📞 고객 정보
              ${u.customer?.phone ? `<span class="cust-toggle-info">${escH(u.customer.phone)}${u.customer.address?' · '+escH(u.customer.address):''}</span>` : '<span class="cust-toggle-empty">미입력</span>'}
            </span>
            <span class="cust-toggle-arrow">${u.customerOpen ? '▼' : '▶'}</span>
          </div>
          <div class="cust-content" style="${u.customerOpen ? '' : 'display:none;'}">
            <div class="cust-hdr">
              <span style="font-size:11px;color:var(--mu);">변경 후 💾 버튼을 눌러주세요</span>
              <button class="cust-save-btn ${(u.customer?.phone||'').replace(/[^\d]/g,'').length<9?'disabled':''}" data-uid="${u.id}" ${(u.customer?.phone||'').replace(/[^\d]/g,'').length<9?'disabled':''}>💾 저장</button>
            </div>
            <div class="cust-save-status" data-uid="${u.id}">${(u.customer?.phone||'').trim() ? '' : '<span style="color:var(--mu);">전화번호를 입력하세요</span>'}</div>

            ${renderCustomerCopyButtons(u)}

            <div class="cust-grid">
              <input class="cust-inp" type="text" inputmode="tel" placeholder="📞 전화번호 (예: 010-1234-5678)" data-uid="${u.id}" data-field="phone" value="${escH(u.customer?.phone || '')}">
              <input class="cust-inp" type="text" placeholder="🏠 주소 (선택)" data-uid="${u.id}" data-field="address" value="${escH(u.customer?.address || '')}">
            </div>
            <textarea class="cust-memo" rows="2" placeholder="💬 메모 (요청사항, 결제 방법, 추천인 등)" data-uid="${u.id}" data-field="memo">${escH(u.customer?.memo || '')}</textarea>
          </div>
        </div>`}
      </div>
    </div>`;
  }).join('');
}

function updateStats() {
  const t=units.length;
  const c=units.filter(u=>u.before.length>0&&u.after.length>0).length;
  const p=units.filter(u=>(u.before.length>0||u.after.length>0)&&!(u.before.length>0&&u.after.length>0)).length;
  const ph=units.reduce((s,u)=>s+u.before.length+u.after.length+u.specials.reduce((a,sp)=>a+sp.photos.length,0),0);
  document.getElementById('sTot').textContent=t;
  document.getElementById('sCmp').textContent=c;
  document.getElementById('sPrt').textContent=p;
  document.getElementById('sPh').textContent=ph;
  document.getElementById('btnGen').disabled=t===0;
}

