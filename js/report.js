/* ═══════════════════════════════
   REPORT BUILD
═══════════════════════════════ */
function getInfo(){
  const d=document.getElementById('workDate').value;
  let ds='';
  if(d){const[y,m,dd]=d.split('-');ds=`${y}년 ${parseInt(m)}월 ${parseInt(dd)}일`;}
  return{
    apt:    document.getElementById('aptName').value||'OO아파트',
    dateStr:ds,
    worker: document.getElementById('workerName').value||'담당자',
    coName: document.getElementById('coName').value||'평택에어컨1004',
    coBrand:document.getElementById('coBrand')?.value||'',
    coTel:  document.getElementById('coTel').value||'',
    coBiz:  document.getElementById('coBiz').value||'',
    coAddr: document.getElementById('coAddr').value||'',
    coEmail:document.getElementById('coEmail').value||'',
    coWeb:  document.getElementById('coWeb').value||'',
    coDesc: document.getElementById('coDesc').value||'',
    coIcon: coIconData||''
  };
}

function buildReportHTML(){
  const{apt,dateStr,worker,coName,coBrand,coTel,coBiz,coAddr,coEmail,coWeb,coDesc,coIcon}=getInfo();
  const total=units.length;
  const complete=units.filter(u=>u.before.length>0&&u.after.length>0).length;

  // 배열을 n개씩 나누기
  function chunk(arr, n) {
    if(!arr||arr.length===0) return [[]];
    const out=[];
    for(let i=0;i<arr.length;i+=n) out.push(arr.slice(i,i+n));
    return out;
  }

  // 아이콘 HTML 생성 (이모지 또는 업로드 이미지)
  const iconHtml = (size) => {
    if (!coIcon) return '❄';
    if (coIcon.startsWith('data:')) return `<img src="${coIcon}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" alt="">`;
    return escH(coIcon);
  };

  // 헤더 바 (상세 페이지용)
  const headBar=r=>`<div class="rp-head">
    <div class="rp-head-l">
      <div class="rp-head-ic">${iconHtml()}</div>
      <div class="rp-brand-r">${escH(coName)}${coBrand?` <span style="color:#888;font-weight:500;">· ${escH(coBrand)}</span>`:''}<small>${[coTel,coBiz?'사업자 '+coBiz:''].filter(Boolean).join(' · ')}</small></div>
    </div>
    <div class="rp-head-r">${r}</div>
  </div>`;

  // 날짜 포맷 (YYYY.MM.DD)
  const dateShort = document.getElementById('workDate').value
    ? document.getElementById('workDate').value.replace(/-/g,'.')
    : dateStr;

  let html='';
  const specialCount = units.reduce((s,u)=>s+u.specials.length,0);

  /* ── 표지 ── */
  html+=`<div class="rpage rp-cover">

    <!-- HERO -->
    <div class="rp-hero">
      <span class="rp-snw">❄</span>
      <span class="rp-snw">❄</span>
      <span class="rp-snw">❄</span>
      <span class="rp-snw">❄</span>

      <div class="rp-hero-top">
        <div class="rp-brand">
          <div class="rp-brand-logo">${iconHtml()}</div>
          <div>
            <div class="rp-brand-name">${escH(coName)}</div>
            ${coBrand?`<div class="rp-brand-sub" style="font-size:11px;color:#a8c5ff;font-weight:600;margin-top:2px;">${escH(coBrand)}</div>`:''}
            <div class="rp-brand-tag">Premium Air Care</div>
          </div>
        </div>
        <div class="rp-rpt-badge">
          <div class="rp-rpt-badge-lbl">Report Date</div>
          <div class="rp-rpt-badge-num">${dateShort}</div>
          ${coBiz?`<div class="rp-rpt-badge-num" style="margin-top:4px;font-size:10px;">사업자 ${escH(coBiz)}</div>`:''}
        </div>
      </div>

      <div class="rp-hero-title">
        <div class="rp-eyebrow">Air Conditioner Cleaning Report</div>
        <div class="rp-h1">에어컨 청소<br><span class="rp-accent">작업 보고서</span></div>
      </div>

      ${coDesc?`<div class="rp-desc-box">
        <div class="rp-desc-label">📋 업체 소개</div>
        <div class="rp-desc-text">${escH(coDesc).replace(/\n/g,'<br>')}</div>
      </div>`:''}

      ${coTel?`<div class="rp-tel-box">
        <span class="rp-tel-ic">📞</span>
        <div class="rp-tel-body">
          <div class="rp-tel-lbl">대표 연락처</div>
          <div class="rp-tel-num">${escH(coTel)}</div>
        </div>
      </div>`:''}

      <div class="rp-meta-grid">
        <div class="rp-meta-cell">
          <div class="rp-meta-lbl">현장 / Site</div>
          <div class="rp-meta-val">${escH(apt)}</div>
        </div>
        <div class="rp-meta-cell">
          <div class="rp-meta-lbl">작업일자</div>
          <div class="rp-meta-val">${dateShort}</div>
        </div>
        <div class="rp-meta-cell">
          <div class="rp-meta-lbl">담당자</div>
          <div class="rp-meta-val">${escH(worker)}</div>
        </div>
        <div class="rp-meta-cell">
          <div class="rp-meta-lbl">완료 / Status</div>
          <div class="rp-meta-val">${complete} / ${total}호</div>
        </div>
      </div>
    </div>

    <!-- KPI -->
    <div class="rp-kpi-row">
      <div class="rp-kpi">
        <div class="rp-kpi-lbl">총 호수</div>
        <div><span class="rp-kpi-num">${total}</span><span class="rp-kpi-unit">호</span></div>
      </div>
      <div class="rp-kpi rp-khi">
        <div class="rp-kpi-lbl">완료</div>
        <div><span class="rp-kpi-num">${complete}</span><span class="rp-kpi-unit">호</span></div>
      </div>
      <div class="rp-kpi rp-kwn">
        <div class="rp-kpi-lbl">미완료</div>
        <div><span class="rp-kpi-num">${total-complete}</span><span class="rp-kpi-unit">호</span></div>
      </div>
      <div class="rp-kpi">
        <div class="rp-kpi-lbl">특이사항</div>
        <div><span class="rp-kpi-num">${specialCount}</span><span class="rp-kpi-unit">건</span></div>
      </div>
    </div>

    <!-- 작업 목록 -->
    <div class="rp-list-wrap">
      <div class="rp-list-title">
        <div class="rp-list-bar"></div>
        <div class="rp-list-txt">작업 상세 목록</div>
        <div class="rp-list-cnt">총 ${total}건</div>
      </div>
      <table class="rp-wtbl">
        <thead>
          <tr>
            <th style="width:44px" class="tc">#</th>
            <th>호수</th>
            <th class="tc">작업 전</th>
            <th class="tc">작업 후</th>
            <th class="tc">상태</th>
          </tr>
        </thead>
        <tbody>
          ${units.map((u,i)=>{
            const ok=u.before.length>0&&u.after.length>0;
            const bOk=u.before.length>0, aOk=u.after.length>0;
            return`<tr>
              <td class="tc"><span class="rp-wnum">${i+1}</span></td>
              <td><span class="rp-ho">${escH(u.name)}</span></td>
              <td class="tc"><span class="rp-pst ${bOk?'d':'e'}">${bOk?'✓':'✕'}</span></td>
              <td class="tc"><span class="rp-pst ${aOk?'d':'e'}">${aOk?'✓':'✕'}</span></td>
              <td class="tc"><span class="rp-pill ${ok?'don':'pnd'}">${ok?'완료':'미완료'}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <!-- 특이사항 -->
    ${specialCount>0?`
    <div class="rp-notes">
      <div class="rp-notes-head">
        <span class="rp-notes-ic">!</span>
        <span class="rp-notes-title">특이사항 있는 호수</span>
      </div>
      <div class="rp-notes-body">${units.filter(u=>u.specials.length>0).map(u=>`${escH(u.name)} (${u.specials.length}건)`).join(' · ')}</div>
    </div>`:''}

    <!-- 업체정보 카드 -->
    <div class="rp-co-card">
      <div class="rp-co-card-title">📌 업체 정보</div>
      <div class="rp-co-card-grid">
        <div class="rp-co-card-row"><span class="rp-co-card-lbl">업체명</span><span class="rp-co-card-val">${escH(coName)}</span></div>
        ${coBrand? `<div class="rp-co-card-row"><span class="rp-co-card-lbl">법인명</span><span class="rp-co-card-val">${escH(coBrand)}</span></div>` : ''}
        ${coTel  ? `<div class="rp-co-card-row"><span class="rp-co-card-lbl">📞 연락처</span><span class="rp-co-card-val">${escH(coTel)}</span></div>` : ''}
        ${coBiz  ? `<div class="rp-co-card-row"><span class="rp-co-card-lbl">🏢 사업자번호</span><span class="rp-co-card-val">${escH(coBiz)}</span></div>` : ''}
        ${coAddr ? `<div class="rp-co-card-row"><span class="rp-co-card-lbl">📍 주소</span><span class="rp-co-card-val">${escH(coAddr)}</span></div>` : ''}
        ${coEmail? `<div class="rp-co-card-row"><span class="rp-co-card-lbl">✉️ 이메일</span><span class="rp-co-card-val">${escH(coEmail)}</span></div>` : ''}
        ${coWeb  ? `<div class="rp-co-card-row"><span class="rp-co-card-lbl">🌐 웹사이트</span><span class="rp-co-card-val">${escH(coWeb)}</span></div>` : ''}
      </div>
    </div>

    <!-- 표지 푸터 -->
    <div class="rp-cv-foot">
      <div><span class="rp-cv-foot-brand">${escH(coName)}</span>${coTel?` · ${escH(coTel)}`:''}</div>
      <div>— 1 / ${1+units.reduce((s,u)=>{
        const bc=chunk(u.before,3).length, ac=chunk(u.after,3).length;
        let pc=Math.max(bc,ac,1);
        const sc = u.specials.length;
        // 특이사항 1~2건 인라인: 마지막 페이지 사진 3장이면 +1 페이지
        if(sc>=1 && sc<=2){
          const lb=(chunk(u.before,3)[pc-1]||[]).length;
          const la=(chunk(u.after,3)[pc-1]||[]).length;
          if(lb>2||la>2) pc++;
        }
        // 특이사항 3건 이상: 각 특이사항별 별도 페이지(사진 4장씩)
        if(sc>=3){
          u.specials.forEach(sp=>{
            const phc = chunk(sp.photos, 4).length;
            pc += Math.max(phc, 1);
          });
        }
        return s+pc;
      },0)} —</div>
    </div>

  </div>`;

  /* ── 호수별 상세 페이지 ──
     규칙:
     - 일반 페이지: 사진 3장 × 2열
     - 특이사항 1~2건: 마지막 본페이지 하단에 인라인 (사진 + 텍스트), 본 사진은 2장으로 줄임
     - 특이사항 3건 이상: 별도 페이지 (페이지당 사진 4장 + 텍스트)
  */
  units.forEach((u, unitIdx) => {
    const specCount    = u.specials.length;
    const inlineSpec   = specCount >= 1 && specCount <= 2;   // 1~2건 인라인
    const separateSpec = specCount >= 3;                      // 3건 이상 별도 페이지

    // 1) 일반 사진 페이지네이션 (3장씩)
    let bChunks = chunk(u.before, 3);
    let aChunks = chunk(u.after,  3);
    let normalPages = Math.max(bChunks.length, aChunks.length, 1);

    // 2) 인라인 특이사항이면 마지막 본페이지에 사진 2장만 들어가도록 조정
    if (inlineSpec) {
      const lastB = bChunks[normalPages-1] || [];
      const lastA = aChunks[normalPages-1] || [];
      if (lastB.length > 2 || lastA.length > 2) {
        const extraB = lastB.slice(2);
        const extraA = lastA.slice(2);
        while (bChunks.length < normalPages) bChunks.push([]);
        while (aChunks.length < normalPages) aChunks.push([]);
        bChunks[normalPages-1] = lastB.slice(0, 2);
        aChunks[normalPages-1] = lastA.slice(0, 2);
        bChunks.push(extraB);
        aChunks.push(extraA);
        normalPages++;
      }
    }

    // 3) 특이사항 별도 페이지 (3건 이상) — 각 특이사항을 페이지로
    //    특이사항 1건당 사진 최대 4장, 초과 시 다음 페이지로
    const specPages = [];
    if (separateSpec) {
      u.specials.forEach((sp, spIdx) => {
        const phChunks = chunk(sp.photos, 4);
        if (phChunks.length === 0 || (phChunks.length === 1 && phChunks[0].length === 0)) {
          // 사진 없는 특이사항도 1페이지 차지
          specPages.push({ specIdx: spIdx, special: sp, photos: [], page: 1, totalPages: 1 });
        } else {
          phChunks.forEach((photoSlice, pi) => {
            specPages.push({
              specIdx: spIdx,
              special: sp,
              photos: photoSlice,
              page: pi + 1,
              totalPages: phChunks.length
            });
          });
        }
      });
    }

    const totalPagesForUnit = normalPages + specPages.length;

    // ── 일반 사진 페이지 렌더 ──
    for(let p=0; p<normalPages; p++){
      const bSlice = bChunks[p] || [];
      const aSlice = aChunks[p] || [];
      const isFirst    = p===0;
      const isLastNorm = p===normalPages-1;
      const showInlineSpec = isLastNorm && inlineSpec;
      const slotsPerCol    = showInlineSpec ? 2 : 3;

      const pageNo = p + 1;
      const pageLabel = totalPagesForUnit>1 ? ` (${pageNo}/${totalPagesForUnit}쪽)` : '';
      const unitTitle = isFirst
        ? `❄️ ${escH(u.name)}`
        : `❄️ ${escH(u.name)} <span style="font-size:11px;font-weight:400;color:#666">사진 ${p+1}/${normalPages}</span>`;

      html += `<div class="rpage rp-det">
        ${headBar(`${escH(apt)} | ${dateStr} | 담당: ${escH(worker)}`)}
        <div class="rp-ubar">
          <div class="rp-uname">${unitTitle}</div>
          <div class="rp-umeta">${unitIdx+1} / ${units.length}${pageLabel} | 전 ${u.before.length}장 · 후 ${u.after.length}장${specCount?` · 특이 ${specCount}건`:''}</div>
        </div>
        <div class="rp-photos${showInlineSpec?' has-sp':''}">
          <div class="rp-col">
            <div class="rp-clbl rp-lbl-b">🔴 작업 전 (BEFORE)${bSlice.length?` — ${p*3+1}~${p*3+bSlice.length}장`:''}</div>
            ${colPhotosFn(bSlice, slotsPerCol)}
          </div>
          <div class="rp-col">
            <div class="rp-clbl rp-lbl-a">🟢 작업 후 (AFTER)${aSlice.length?` — ${p*3+1}~${p*3+aSlice.length}장`:''}</div>
            ${colPhotosFn(aSlice, slotsPerCol)}
          </div>
        </div>
        ${showInlineSpec ? inlineSpecialSection(u.specials) : ''}
        <div class="rp-foot">
          <span>${escH(coName)} | ${escH(apt)} | ${escH(u.name)}${pageLabel}</span>
          <div>확인:<span class="sign-ln"></span></div>
        </div>
      </div>`;
    }

    // ── 특이사항 별도 페이지 렌더 (3건 이상일 때) ──
    specPages.forEach((spInfo, idx) => {
      const pageNo = normalPages + idx + 1;
      const pageLabel = ` (${pageNo}/${totalPagesForUnit}쪽)`;
      const subPageInfo = spInfo.totalPages > 1 ? ` (${spInfo.page}/${spInfo.totalPages})` : '';

      html += `<div class="rpage rp-det">
        ${headBar(`${escH(apt)} | ${dateStr} | 담당: ${escH(worker)}`)}
        <div class="rp-ubar" style="background:#fffbf0;border-bottom:2px solid #f0b429;">
          <div class="rp-uname" style="color:#c07010;">⚠️ ${escH(u.name)} 특이사항 ${spInfo.specIdx+1}/${specCount}${subPageInfo}</div>
          <div class="rp-umeta">${unitIdx+1} / ${units.length}${pageLabel}</div>
        </div>
        ${specialPageBody(spInfo.special, spInfo.photos, spInfo.page === spInfo.totalPages)}
        <div class="rp-foot">
          <span>${escH(coName)} | ${escH(apt)} | ${escH(u.name)} 특이사항</span>
          <div>확인:<span class="sign-ln"></span></div>
        </div>
      </div>`;
    });
  });

  // ── 헬퍼: 사진 슬롯 채우기 (n슬롯 고정) ──
  function colPhotosFn(photos, slots) {
    const items = [];
    for (let i = 0; i < slots; i++) {
      if (i < photos.length) {
        items.push(`<div class="rp-pitem"><img src="${photoUrl(photos[i])}"></div>`);
      } else {
        items.push(`<div class="rp-pitem empty"></div>`);
      }
    }
    return `<div class="rp-plist">${items.join('')}</div>`;
  }

  // ── 헬퍼: 특이사항 1~2건 - 본 페이지 하단에 들어가는 인라인 섹션 ──
  function inlineSpecialSection(specials) {
    // specials: 배열 (1건 또는 2건)
    const count = specials.length;

    // 사진 모으기 (모든 특이사항의 사진 합쳐서 최대 2장)
    const allPhotos = specials.flatMap(s => s.photos);
    const photos    = allPhotos.slice(0, 2);
    const extra     = allPhotos.length - photos.length;

    // 사진 슬롯
    const photoSlots = [];
    for (let i = 0; i < 2; i++) {
      if (i < photos.length) {
        photoSlots.push(`<div class="rp-pitem"><img src="${photoUrl(photos[i])}"></div>`);
      } else {
        photoSlots.push(`<div class="rp-pitem empty"></div>`);
      }
    }

    // 텍스트 (각 특이사항 번호별로)
    const textBody = specials.map((s, i) => {
      const t = (s.desc || '').trim();
      const prefix = count > 1 ? `<strong>${i+1}.</strong> ` : '';
      return prefix + (t ? escH(t).replace(/\n/g,'<br>') : '<span style="color:#aaa">(설명 없음)</span>');
    }).join('<br>');

    return `<div class="rp-sp-sec">
      <div class="rp-sp-titlebar">
        <span class="ic">⚠️ 특이사항 (${count}건${allPhotos.length?` · 사진 ${allPhotos.length}장`:''})</span>
      </div>
      <div class="rp-sp-grid">${photoSlots.join('')}</div>
      <div class="rp-sp-text">
        ${extra > 0 ? `<span class="extra-cnt">+ ${extra}장 더</span>` : ''}
        ${textBody}
      </div>
    </div>`;
  }

  // ── 헬퍼: 특이사항 별도 페이지 본문 (2건 이상일 때) ──
  function specialPageBody(sp, photoSlice, showText) {
    // 사진 4장 = 2x2 그리드
    const photoSlots = [];
    for (let i = 0; i < 4; i++) {
      if (i < photoSlice.length) {
        photoSlots.push(`<div class="rp-pitem"><img src="${photoUrl(photoSlice[i])}"></div>`);
      } else {
        photoSlots.push(`<div class="rp-pitem empty"></div>`);
      }
    }

    const text = (sp.desc || '').trim();
    const textHtml = showText
      ? `<div class="rp-sp-text" style="max-height:120px;">
           ${text ? escH(text).replace(/\n/g,'<br>') : '<span style="color:#aaa">(설명 없음)</span>'}
         </div>`
      : `<div class="rp-sp-text" style="max-height:40px;text-align:center;color:var(--mu);font-style:italic;">
           ⏬ 다음 페이지에 이어집니다
         </div>`;

    return `<div class="rp-sp-page-photos">${photoSlots.join('')}</div>${textHtml}`;
  }

  return html;
}

async function buildAndPreview(){
  const html=buildReportHTML();
  document.getElementById('rpWrap').innerHTML=html;
  document.getElementById('btnPDF').disabled=false;
  document.getElementById('btnJPG').disabled=false;
  const scroll=document.getElementById('pvScroll');
  scroll.innerHTML='';
  const pages=document.getElementById('rpWrap').querySelectorAll('.rpage');
  const scale=Math.min(0.72,(window.innerWidth-40)/794);
  pages.forEach((pg,i)=>{
    const wrap=document.createElement('div'); wrap.className='pv-pg-wrap';
    const lbl=document.createElement('div'); lbl.className='pv-pg-num'; lbl.textContent=`${i+1} / ${pages.length}페이지`;
    const clone=pg.cloneNode(true); clone.style.transform=`scale(${scale})`; clone.style.transformOrigin='top left'; clone.style.width='794px';
    const box=document.createElement('div'); box.className='pv-pg-scaled'; box.style.width=`${794*scale}px`; box.style.height=`${1123*scale}px`;
    box.appendChild(clone); wrap.appendChild(lbl); wrap.appendChild(box); scroll.appendChild(wrap);
  });
  document.getElementById('pvModal').classList.add('open');
  showToast(`보고서 ${pages.length}페이지 준비됨`,'ok');
}

async function exportPDF(){
  const pages=document.getElementById('rpWrap').querySelectorAll('.rpage');
  if(!pages.length){showToast('먼저 미리보기를 눌러 보고서를 생성해주세요','err');return;}
  showOverlay('PDF 생성 중...');
  const{jsPDF}=window.jspdf;
  const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  for(let i=0;i<pages.length;i++){
    setProg((i/pages.length)*100,`${i+1} / ${pages.length} 페이지`);
    const c=await html2canvas(pages[i],{scale:2,useCORS:true,allowTaint:true,width:794,height:1123,backgroundColor:'#ffffff'});
    if(i>0)pdf.addPage();
    pdf.addImage(c.toDataURL('image/jpeg',.92),'JPEG',0,0,210,297);
    await sleep(40);
  }
  const{apt,dateStr}=getInfo();
  pdf.save(`에어컨청소보고서_${apt}_${dateStr}.pdf`);
  hideOverlay(); showToast('PDF 저장 완료!','ok');
}

async function exportJPG(){
  const pages=document.getElementById('rpWrap').querySelectorAll('.rpage');
  if(!pages.length){showToast('먼저 미리보기를 눌러 보고서를 생성해주세요','err');return;}
  const{apt,dateStr}=getInfo();
  showOverlay('이미지 생성 중...');
  const links=[];
  for(let i=0;i<pages.length;i++){
    setProg((i/pages.length)*100,`${i+1} / ${pages.length} 변환 중`);
    const c=await html2canvas(pages[i],{scale:2,useCORS:true,allowTaint:true,width:794,height:1123,backgroundColor:'#ffffff'});
    links.push({url:c.toDataURL('image/jpeg',.92),name:`에어컨청소보고서_${apt}_${i+1}페이지.jpg`});
    await sleep(40);
  }
  hideOverlay();
  if(links.length===1){const a=document.createElement('a');a.href=links[0].url;a.download=`에어컨청소보고서_${apt}_${dateStr}.jpg`;a.click();}
  else{showToast(`${links.length}페이지 저장 시작`,'ok');for(let i=0;i<links.length;i++){await sleep(300);const a=document.createElement('a');a.href=links[i].url;a.download=links[i].name;a.click();}}
}

