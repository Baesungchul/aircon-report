/* ═══════════════════════════════
   REPORT BUILD
═══════════════════════════════ */
function getInfo(){
  const d=document.getElementById('workDate').value;
  let ds='';
  if(d){const[y,m,dd]=d.split('-');ds=`${y}년 ${parseInt(m)}월 ${parseInt(dd)}일`;}

  // 전화번호 자동 포맷: 01012345678 → 010-1234-5678
  function formatTel(tel){
    if(!tel) return '';
    const t = tel.replace(/[^\d]/g,'');  // 숫자만
    if(t.length === 11 && t.startsWith('010')) return `${t.slice(0,3)}-${t.slice(3,7)}-${t.slice(7)}`;
    if(t.length === 10 && t.startsWith('02'))  return `${t.slice(0,2)}-${t.slice(2,6)}-${t.slice(6)}`;
    if(t.length === 11)                         return `${t.slice(0,3)}-${t.slice(3,7)}-${t.slice(7)}`;
    if(t.length === 10)                         return `${t.slice(0,3)}-${t.slice(3,6)}-${t.slice(6)}`;
    if(t.length === 9)                          return `${t.slice(0,2)}-${t.slice(2,5)}-${t.slice(5)}`;
    if(t.length === 8)                          return `${t.slice(0,4)}-${t.slice(4)}`;
    return tel; // 알 수 없는 형식은 원본 유지
  }
  // 사업자번호: 1234567890 → 123-45-67890
  function formatBiz(biz){
    if(!biz) return '';
    const b = biz.replace(/[^\d]/g,'');
    if(b.length === 10) return `${b.slice(0,3)}-${b.slice(3,5)}-${b.slice(5)}`;
    return biz;
  }

  return{
    apt:    document.getElementById('aptName').value||'OO아파트',
    dateStr:ds,
    worker: document.getElementById('workerName').value||'담당자',
    coName: document.getElementById('coName').value||'',
    coBrand:document.getElementById('coBrand')?.value||'',
    coTel:  formatTel(document.getElementById('coTel').value||''),
    coBiz:  formatBiz(document.getElementById('coBiz').value||''),
    coAddr: document.getElementById('coAddr').value||'',
    coEmail:document.getElementById('coEmail').value||'',
    coWeb:  document.getElementById('coWeb').value||'',
    coDesc: document.getElementById('coDesc').value||'',
    coIcon: coIconData||'',
    // 업종별 커스텀 호칭 (비어있으면 기본값 사용)
    coReportTitle: (document.getElementById('coReportTitle')?.value || '').trim(),
    coUnitLabel:   (document.getElementById('coUnitLabel')?.value   || '').trim() || '호수',
    coStageLabel:  (document.getElementById('coStageLabel')?.value  || '').trim() || '작업'
  };
}

function buildReportHTML(){
  const{apt,dateStr,worker,coName,coBrand,coTel,coBiz,coAddr,coEmail,coWeb,coDesc,coIcon,coReportTitle,coUnitLabel,coStageLabel}=getInfo();

  // 업종별 동적 라벨 (영어 모드는 BEFORE/AFTER 그대로)
  const isKo = getCurrentLang() !== 'en';
  const labelBefore = isKo ? `${coStageLabel} 전` : t('report.detail.before');
  const labelAfter  = isKo ? `${coStageLabel} 후` : t('report.detail.after');
  const labelSpecial = isKo ? '특이사항' : t('report.detail.special');
  const labelUnit = isKo ? coUnitLabel : '';  // "호수" / "현장" 등
  const unitOfPhoto = isKo ? '장' : '';
  const unitOfCount = isKo ? '건' : '';
  const total=units.length;
  const complete=units.filter(u=>u.before.length>0&&u.after.length>0).length;

  // 보고서 테마 (설정에서 선택)
  const reportTheme = localStorage.getItem('ac_report_theme_v1') || 'default';
  const themeClass = `rp-theme-${reportTheme}`;

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

  // 헤더 바 (상세 페이지용) - 회사명만 (연락처는 표지에만)
  const headBar=r=>`<div class="rp-head">
    <div class="rp-head-l">
      <div class="rp-head-ic">${iconHtml()}</div>
      <div class="rp-brand-r">${escH(coName)}${coBrand?` <span style="color:#888;font-weight:500;">· ${escH(coBrand)}</span>`:''}</div>
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
  html+=`<div class="rpage rp-cover ${themeClass}">

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
          <div class="rp-rpt-badge-lbl">${t('report.cover.report')}</div>
          <div class="rp-rpt-badge-num">${dateShort}</div>
          ${coBiz?`<div class="rp-rpt-badge-num" style="margin-top:4px;font-size:10px;">${t('report.coCard.biz').replace(/^[^\w가-힣]+\s*/, '')} ${escH(coBiz)}</div>`:''}
        </div>
      </div>

      <div class="rp-hero-title">
        <div class="rp-eyebrow">${t('report.cover.eyebrow')}</div>
        ${coReportTitle
          ? `<div class="rp-h1">${escH(coReportTitle)}</div>`
          : `<div class="rp-h1">${t('report.cover.title.before')}<br><span class="rp-accent">${t('report.cover.title.after')}</span></div>`
        }
      </div>

      ${coDesc?`<div class="rp-desc-box">
        <div class="rp-desc-label">📋 ${t('report.cover.about')}</div>
        <div class="rp-desc-text">${escH(coDesc).replace(/\n/g,'<br>')}</div>
      </div>`:''}

      ${coTel?`<div class="rp-tel-box">
        <span class="rp-tel-ic">📞</span>
        <div class="rp-tel-body">
          <div class="rp-tel-lbl">${t('report.cover.tel')}</div>
          <div class="rp-tel-num">${escH(coTel)}</div>
        </div>
      </div>`:''}

      ${(()=>{
        // 입력된 업체정보만 모아서 칩 형태로 표시
        const items = [];
        if (coBiz)   items.push({ ic: '🏢', label: t('report.coCard.biz'),   val: coBiz });
        if (coAddr)  items.push({ ic: '📍', label: t('report.coCard.addr'),  val: coAddr });
        if (coEmail) items.push({ ic: '✉️', label: t('report.coCard.email'), val: coEmail });
        if (coWeb)   items.push({ ic: '🌐', label: t('report.coCard.web'),   val: coWeb });
        if (items.length === 0) return '';
        return `<div class="rp-co-info">
          ${items.map(it => `
            <div class="rp-co-info-row">
              <span class="rp-co-info-ic">${it.ic}</span>
              <span class="rp-co-info-lbl">${escH(it.label.replace(/^[^\w가-힣]+\s*/, ''))}</span>
              <span class="rp-co-info-val">${escH(it.val)}</span>
            </div>
          `).join('')}
        </div>`;
      })()}

      <div class="rp-meta-grid">
        <div class="rp-meta-cell">
          <div class="rp-meta-lbl">${t('report.cover.workSite')}</div>
          <div class="rp-meta-val">${escH(apt)}</div>
        </div>
        <div class="rp-meta-cell">
          <div class="rp-meta-lbl">${t('report.cover.workDate')}</div>
          <div class="rp-meta-val">${dateShort}</div>
        </div>
        <div class="rp-meta-cell">
          <div class="rp-meta-lbl">${t('main.worker')}</div>
          <div class="rp-meta-val">${escH(worker)}</div>
        </div>
        <div class="rp-meta-cell">
          <div class="rp-meta-lbl">${t('report.cover.completed')}</div>
          <div class="rp-meta-val">${complete} / ${total}${t('report.cover.unit')}</div>
        </div>
      </div>
    </div>

    <!-- KPI -->
    <div class="rp-kpi-row">
      <div class="rp-kpi">
        <div class="rp-kpi-lbl">${t('report.cover.totalUnits')}</div>
        <div><span class="rp-kpi-num">${total}</span><span class="rp-kpi-unit">${t('report.cover.unit')}</span></div>
      </div>
      <div class="rp-kpi rp-khi">
        <div class="rp-kpi-lbl">${t('report.cover.completed')}</div>
        <div><span class="rp-kpi-num">${complete}</span><span class="rp-kpi-unit">${t('report.cover.unit')}</span></div>
      </div>
      <div class="rp-kpi rp-kwn">
        <div class="rp-kpi-lbl">${t('report.cover.incomplete')}</div>
        <div><span class="rp-kpi-num">${total-complete}</span><span class="rp-kpi-unit">${t('report.cover.unit')}</span></div>
      </div>
      <div class="rp-kpi">
        <div class="rp-kpi-lbl">${t('report.cover.specials')}</div>
        <div><span class="rp-kpi-num">${specialCount}</span><span class="rp-kpi-unit">${t('report.cover.case')}</span></div>
      </div>
    </div>

    <!-- 작업 목록 -->
    <div class="rp-list-wrap">
      <div class="rp-list-title">
        <div class="rp-list-bar"></div>
        <div class="rp-list-txt">${t('report.list.title')}</div>
        <div class="rp-list-cnt">${t('report.list.total', {n: total})}</div>
      </div>
      ${(()=>{
        // ★ 특이사항 있으면 더 일찍 그리드 전환 (공간 확보)
        const hasSpecials = specialCount > 0;
        const gridThreshold = hasSpecials ? 4 : 5;  // 특이사항 있으면 5건부터 그리드

        if (total <= gridThreshold) {
          // 1단 테이블
          return `<table class="rp-wtbl${hasSpecials?' rp-wtbl-compact':''}">
            <thead>
              <tr>
                <th style="width:44px" class="tc">${t('report.list.no')}</th>
                <th>${t('report.list.unit')}</th>
                <th class="tc">${t('report.list.before')}</th>
                <th class="tc">${t('report.list.after')}</th>
                <th class="tc">${t('report.list.status')}</th>
              </tr>
            </thead>
            <tbody>
              ${units.map((u,i)=>{
                const ok=u.before.length>0&&u.after.length>0;
                const bOk=u.before.length>0, aOk=u.after.length>0;
                return`<tr>
                  <td class="tc"><span class="rp-wnum">${i+1}</span></td>
                  <td><span class="rp-ho">${escH(u.name)}</span>${u.specials.length?`<span style="font-size:10px;color:#b07000;margin-left:6px;">⚠️${u.specials.length}</span>`:''}
                  </td>
                  <td class="tc"><span class="rp-pst ${bOk?'d':'e'}">${bOk?'✓':'✕'}</span></td>
                  <td class="tc"><span class="rp-pst ${aOk?'d':'e'}">${aOk?'✓':'✕'}</span></td>
                  <td class="tc"><span class="rp-pill ${ok?'don':'pnd'}">${ok?t('report.list.statusDone'):t('report.list.statusPending')}</span></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>`;
        } else {
          // 다단 그리드
          const cols = total <= 12 ? 2 : 3;
          return `<div class="rp-grid rp-grid-${cols}">
            ${units.map((u,i)=>{
              const ok=u.before.length>0&&u.after.length>0;
              const bOk=u.before.length>0, aOk=u.after.length>0;
              return`<div class="rp-gitem">
                <span class="rp-wnum">${i+1}</span>
                <span class="rp-ho">${escH(u.name)}${u.specials.length?`<span style="font-size:9px;color:#b07000;margin-left:4px;">⚠️</span>`:''}</span>
                <div class="rp-gstatus">
                  <span class="rp-gpst ${bOk?'d':'e'}" title="작업 전">${bOk?'✓':'✕'}</span>
                  <span class="rp-gpst ${aOk?'d':'e'}" title="작업 후">${aOk?'✓':'✕'}</span>
                  <span class="rp-pill ${ok?'don':'pnd'}">${ok?t('report.list.statusDoneShort'):t('report.list.statusPendingShort')}</span>
                </div>
              </div>`;
            }).join('')}
          </div>`;
        }
      })()}
    </div>

    <!-- 특이사항 -->
    ${specialCount>0?`
    <div class="rp-notes">
      <div class="rp-notes-head">
        <span class="rp-notes-ic">!</span>
        <span class="rp-notes-title">${t('report.detail.special')}</span>
      </div>
      <div class="rp-notes-body">${units.filter(u=>u.specials.length>0).map(u=>`${escH(u.name)} (${u.specials.length}${getCurrentLang()==='en'?'':'건'})`).join(' · ')}</div>
    </div>`:''}

    <!-- 표지 푸터 (페이지 번호만) -->
    <div class="rp-cv-foot">
      <div></div>
      <div>— 1 / ${1+units.reduce((s,u)=>{
        const bc=chunk(u.before,3).length, ac=chunk(u.after,3).length;
        let pc=Math.max(bc,ac,1);
        const sc = u.specials.length;
        // 특이사항 1~2건 인라인: 마지막 페이지 사진이 3장(꽉 참)이면 인라인용 새 페이지 +1
        if(sc>=1 && sc<=2){
          const lb=(chunk(u.before,3)[pc-1]||[]).length;
          const la=(chunk(u.after,3)[pc-1]||[]).length;
          if(lb>=3||la>=3) pc++;
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
     - 특이사항: 건수에 관계없이 무조건 별도 페이지
     - 레이아웃: 좌측 사진(최대 4장) / 우측 메모 텍스트
  */
  units.forEach((u, unitIdx) => {
    const specCount = u.specials.length;

    // 1) 일반 사진 페이지네이션 (3장씩)
    let bChunks = chunk(u.before, 3);
    let aChunks = chunk(u.after,  3);
    let normalPages = Math.max(bChunks.length, aChunks.length, 1);

    // ★ 특이사항 페이지 배치 결정
    // 사진 0~2장 → "small" (2건을 한 페이지에 상/하 배치)
    // 사진 3~4장 → "large" (1건 1페이지)
    const specPages = [];  // { items: [spInfo, spInfo?], paired: bool }

    if (specCount > 0) {
      // 먼저 각 special을 개별 슬롯으로 만들기
      const slots = [];
      u.specials.forEach((sp, spIdx) => {
        const phChunks = chunk(sp.photos, 4);
        if (phChunks.length === 0) {
          slots.push({ specIdx: spIdx, special: sp, photos: [], isSmall: true });
        } else {
          phChunks.forEach((photoSlice, pi) => {
            const isSmall = photoSlice.length <= 2;  // ★ 2장 이하면 small
            slots.push({
              specIdx: spIdx, special: sp,
              photos: photoSlice,
              page: pi + 1, totalPages: phChunks.length,
              isSmall
            });
          });
        }
      });

      // small 2개 붙이기, large는 단독
      let i = 0;
      while (i < slots.length) {
        const cur = slots[i];
        const next = slots[i + 1];
        // 둘 다 small이고, 다른 건의 첫 번째 페이지인 경우만 합치기
        if (cur.isSmall && next && next.isSmall && cur.specIdx !== next.specIdx && (!next.page || next.page === 1)) {
          specPages.push({ items: [cur, next], paired: true });
          i += 2;
        } else {
          specPages.push({ items: [cur], paired: false });
          i += 1;
        }
      }
    }

    const totalPagesForUnit = normalPages + specPages.length;

    // ── 일반 사진 페이지 렌더 ──
    for(let p=0; p<normalPages; p++){
      const bSlice = bChunks[p] || [];
      const aSlice = aChunks[p] || [];
      const isFirst = p===0;

      const pageNo = p + 1;
      const pageLabel = totalPagesForUnit>1 ? ` (${pageNo}/${totalPagesForUnit}쪽)` : '';
      const unitTitle = isFirst
        ? `❄️ ${escH(u.name)}`
        : `❄️ ${escH(u.name)} <span style="font-size:11px;font-weight:400;color:#666">사진 ${p+1}/${normalPages}</span>`;

      html += `<div class="rpage rp-det ${themeClass}">
        ${headBar(`${escH(apt)} | ${dateStr} | ${t('main.worker')}: ${escH(worker)}`)}
        <div class="rp-ubar">
          <div class="rp-uname">${unitTitle}</div>
          <div class="rp-umeta">${unitIdx+1} / ${units.length}${pageLabel} | ${labelBefore} ${u.before.length}${unitOfPhoto} · ${labelAfter} ${u.after.length}${unitOfPhoto}${specCount?` · ${labelSpecial} ${specCount}${unitOfCount}`:''}</div>
        </div>
        <div class="rp-photos">
          <div class="rp-col">
            <div class="rp-clbl rp-lbl-b">🔴 ${labelBefore.toUpperCase()}${bSlice.length?` — ${p*3+1}~${p*3+bSlice.length}${unitOfPhoto}`:''}</div>
            ${colPhotosFn(bSlice, 3)}
          </div>
          <div class="rp-col">
            <div class="rp-clbl rp-lbl-a">🟢 ${labelAfter.toUpperCase()}${aSlice.length?` — ${p*3+1}~${p*3+aSlice.length}${unitOfPhoto}`:''}</div>
            ${colPhotosFn(aSlice, 3)}
          </div>
        </div>
        <div class="rp-foot">
          <span>${escH(coName)} | ${escH(apt)} | ${escH(u.name)}${pageLabel}</span>
          <div>${getCurrentLang()==='en'?'Approved':'확인'}:<span class="sign-ln"></span></div>
        </div>
      </div>`;
    }

    // ── 특이사항 별도 페이지 렌더 ──
    specPages.forEach((spPage, idx) => {
      const pageNo = normalPages + idx + 1;
      const pageLabel = ` (${pageNo}/${totalPagesForUnit}쪽)`;

      if (spPage.paired) {
        // ★ 2건 한 페이지 (small)
        const [sp1, sp2] = spPage.items;
        const label1 = `${labelSpecial} ${sp1.specIdx+1}/${specCount}`;
        const label2 = `${labelSpecial} ${sp2.specIdx+1}/${specCount}`;
        html += `<div class="rpage rp-det rp-sp-page ${themeClass}">
          ${headBar(`${escH(apt)} | ${dateStr} | ${t('main.worker')}: ${escH(worker)}`)}
          <div class="rp-ubar" style="background:#fffbf0;border-bottom:2px solid #f0b429;">
            <div class="rp-uname" style="color:#b07000;">⚠️ ${escH(u.name)} &nbsp;${labelSpecial} ${sp1.specIdx+1}, ${sp2.specIdx+1} / ${specCount}</div>
            <div class="rp-umeta">${unitIdx+1} / ${units.length}${pageLabel}</div>
          </div>
          <div class="rp-sp-paired">
            ${specialPageBodySmall(sp1.special, sp1.photos, label1, true)}
            <div class="rp-sp-divider"></div>
            ${specialPageBodySmall(sp2.special, sp2.photos, label2, true)}
          </div>
          <div class="rp-foot">
            <span>${escH(coName)} | ${escH(apt)} | ${escH(u.name)} ${labelSpecial}</span>
            <div>${getCurrentLang()==='en'?'Approved':'확인'}:<span class="sign-ln"></span></div>
          </div>
        </div>`;
      } else {
        // ★ 1건 1페이지 (large 또는 연속 페이지)
        const spInfo = spPage.items[0];
        const subPageInfo = (spInfo.totalPages > 1) ? ` ${spInfo.page}/${spInfo.totalPages}` : '';
        const spNo = `${spInfo.specIdx+1}/${specCount}`;
        html += `<div class="rpage rp-det rp-sp-page ${themeClass}">
          ${headBar(`${escH(apt)} | ${dateStr} | ${t('main.worker')}: ${escH(worker)}`)}
          <div class="rp-ubar" style="background:#fffbf0;border-bottom:2px solid #f0b429;">
            <div class="rp-uname" style="color:#b07000;">⚠️ ${escH(u.name)} &nbsp;${labelSpecial} ${spNo}${subPageInfo}</div>
            <div class="rp-umeta">${unitIdx+1} / ${units.length}${pageLabel}</div>
          </div>
          ${specialPageBody(spInfo.special, spInfo.photos, spInfo.page === spInfo.totalPages)}
          <div class="rp-foot">
            <span>${escH(coName)} | ${escH(apt)} | ${escH(u.name)} ${labelSpecial}</span>
            <div>${getCurrentLang()==='en'?'Approved':'확인'}:<span class="sign-ln"></span></div>
          </div>
        </div>`;
      }
    });
  });

  // ── 헬퍼: 사진 슬롯 채우기 (n슬롯 고정) ──
  function colPhotosFn(photos, slots) {
    const items = [];
    for (let i = 0; i < slots; i++) {
      if (i < photos.length) {
        items.push(`<div class="rp-pitem"><img src="${photoUrl(photos[i])}"></div>`);
      } else {
        items.push(`<div class="rp-pitem rp-empty"></div>`);
      }
    }
    return `<div class="rp-plist">${items.join('')}</div>`;
  }


  // ── 헬퍼: 특이사항 별도 페이지 본문 - 좌측 사진 / 우측 메모 ──
  function specialPageBody(sp, photoSlice, showText) {
    const photoSlots = [];
    for (let i = 0; i < 4; i++) {
      if (i < photoSlice.length) {
        photoSlots.push(`<div class="rp-sp-photo-item"><img src="${photoUrl(photoSlice[i])}" style="width:100%;height:100%;object-fit:cover;border-radius:4px;"></div>`);
      } else {
        photoSlots.push(`<div class="rp-sp-photo-item rp-empty"></div>`);
      }
    }
    const text = (sp.desc || '').trim();
    const memoHtml = showText
      ? `<div class="rp-sp-memo-label">📝 메모</div>
         <div class="rp-sp-memo-text">${text ? escH(text).replace(/\n/g,'<br>') : '<span style="color:#bbb;font-style:italic;">(메모 없음)</span>'}</div>`
      : `<div class="rp-sp-memo-label">📝 메모</div>
         <div class="rp-sp-memo-text" style="color:#aaa;font-style:italic;">⏬ 다음 페이지에 계속...</div>`;
    return `<div class="rp-sp-layout">
      <div class="rp-sp-photos-col">
        <div class="rp-sp-photo-label">📷 사진 (${photoSlice.length}장)</div>
        <div class="rp-sp-photo-grid">${photoSlots.join('')}</div>
      </div>
      <div class="rp-sp-memo-col">
        ${memoHtml}
      </div>
    </div>`;
  }

  // ── 헬퍼: 특이사항 small (2건 한 페이지, 상/하 각각 1건씩) ──
  function specialPageBodySmall(sp, photoSlice, label, showText) {
    // ★ 1건(large)과 동일한 좌/우 구조 사용 (사진 1열 세로, 우측 메모)
    const maxPhotos = 2;  // 2건이 들어가므로 사진은 최대 2장씩
    const photoSlots = [];
    for (let i = 0; i < maxPhotos; i++) {
      if (i < photoSlice.length) {
        photoSlots.push(`<div class="rp-sp-photo-item"><img src="${photoUrl(photoSlice[i])}" style="width:100%;height:100%;object-fit:cover;border-radius:4px;"></div>`);
      } else {
        photoSlots.push(`<div class="rp-sp-photo-item rp-empty"></div>`);
      }
    }
    const text = (sp.desc || '').trim();
    return `<div class="rp-sp-layout rp-sp-half">
      <div class="rp-sp-photos-col">
        <div class="rp-sp-photo-label">⚠️ ${label} &nbsp;·&nbsp; 📷 ${photoSlice.length}장</div>
        <div class="rp-sp-photo-grid">${photoSlots.join('')}</div>
      </div>
      <div class="rp-sp-memo-col">
        <div class="rp-sp-memo-label">📝 메모</div>
        <div class="rp-sp-memo-text">${text ? escH(text).replace(/\n/g,'<br>') : '<span style="color:#bbb;font-style:italic;">(메모 없음)</span>'}</div>
      </div>
    </div>`;
  }

  return html;
}

async function buildAndPreview(){
  // ★ textarea 값을 units에 강제 동기화 (미리보기 직전)
  document.querySelectorAll('.sp-txt').forEach(ta => {
    const uid = +ta.dataset.uid;
    const sid = +ta.dataset.sid;
    const u = units.find(u => u.id === uid);
    if (u) {
      const s = u.specials.find(s => s.id === sid);
      if (s) s.desc = ta.value;
    }
  });

  const html=buildReportHTML();
  document.getElementById('rpWrap').innerHTML=html;
  document.getElementById('btnPDF').disabled=false;
  document.getElementById('btnJPG').disabled=false;
  const scroll=document.getElementById('pvScroll');
  scroll.innerHTML='';
  const pages=document.getElementById('rpWrap').querySelectorAll('.rpage');
  const baseScale=Math.min(0.72,(window.innerWidth-40)/794);
  pages.forEach((pg,i)=>{
    const wrap=document.createElement('div'); wrap.className='pv-pg-wrap';
    const lbl=document.createElement('div'); lbl.className='pv-pg-num'; lbl.textContent=`${i+1} / ${pages.length}페이지`;
    const clone=pg.cloneNode(true);
    clone.style.transform=`scale(${baseScale})`;
    clone.style.transformOrigin='top left';
    clone.style.width='794px';
    clone.dataset.baseScale = baseScale;  // ★ 기본 스케일 저장
    const box=document.createElement('div'); box.className='pv-pg-scaled'; box.style.width=`${794*baseScale}px`; box.style.height=`${1123*baseScale}px`;
    box.appendChild(clone); wrap.appendChild(lbl); wrap.appendChild(box); scroll.appendChild(wrap);
  });
  document.getElementById('pvModal').classList.add('open');
  // 미리보기 열렸으니 손가락 줌 허용
  if (typeof setViewportZoom === 'function') setViewportZoom(true);
  showToast(`보고서 ${pages.length}페이지 준비됨`,'ok');
}

async function exportPDF(){
  const pages=document.getElementById('rpWrap').querySelectorAll('.rpage');
  if(!pages.length){showToast('먼저 미리보기를 눌러 보고서를 생성해주세요','err');return;}

  // 자동저장 폴더 + 작업 자동저장 처리 (실패해도 PDF는 생성)
  const folderInfo = await ensureWorkSavedToFolder();

  showOverlay('PDF 생성 중...');
  const{jsPDF}=window.jspdf;
  const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  for(let i=0;i<pages.length;i++){
    setProg((i/pages.length)*100,`${i+1} / ${pages.length} 페이지`);
    const c=await html2canvas(pages[i],{
      scale:2,
      useCORS:true,
      allowTaint:true,
      width:794,
      height:1123,
      windowWidth:794,
      windowHeight:1123,
      backgroundColor:'#ffffff',
      logging:false,
      imageTimeout:0
    });
    if(i>0)pdf.addPage();
    pdf.addImage(c.toDataURL('image/jpeg',.92),'JPEG',0,0,210,297);
    await sleep(40);
  }
  const{apt,dateStr}=getInfo();
  const dateClean = dateStr.replace(/\./g,'-');
  // 기본 파일명 (시간 없음)
  const baseName = `report_${dateClean}`;
  let fileName = `${baseName}.pdf`;

  // 폴더에 저장 시도
  let savedToFolder = false;
  if (folderInfo && folderInfo.workDir) {
    // ✨ 기존 파일 존재 확인 후 사용자에게 선택 받기
    let existingFiles = [];
    try {
      for await (const [fname, fhandle] of folderInfo.workDir.entries()) {
        if (fhandle.kind === 'file' && fname.startsWith(baseName) && fname.endsWith('.pdf')) {
          existingFiles.push(fname);
        }
      }
    } catch(e) {}

    if (existingFiles.length > 0) {
      hideOverlay();
      const choice = confirm(
        `📄 PDF 파일이 이미 있습니다 (${existingFiles.length}개)\n\n` +
        `${existingFiles.slice(0, 3).join('\n')}` +
        (existingFiles.length > 3 ? `\n... 외 ${existingFiles.length - 3}개` : '') +
        `\n\n[확인] 기존 파일 덮어쓰기 (이전 PDF 모두 삭제)\n[취소] 새 파일로 저장 (시간 추가)`
      );
      showOverlay('PDF 저장 중...');

      if (choice) {
        // 덮어쓰기: 기존 PDF들 삭제
        for (const oldFile of existingFiles) {
          try {
            await folderInfo.workDir.removeEntry(oldFile);
            console.log(`🗑️ 기존 PDF 삭제: ${oldFile}`);
          } catch(e) {}
        }
        fileName = `${baseName}.pdf`;
      } else {
        // 새 파일: 시간 추가 (KST)
        fileName = `${baseName}_${kstTimeStr()}.pdf`;
      }
    }

    try {
      const pdfBlob = pdf.output('blob');
      const fh = await folderInfo.workDir.getFileHandle(fileName, { create: true });
      const w = await fh.createWritable();
      await w.write(pdfBlob);
      await w.close();
      savedToFolder = true;
      console.log(`✓ PDF 폴더 저장: ${folderInfo.folderName}/${fileName}`);
    } catch(e) {
      console.warn('PDF 폴더 저장 실패, 다운로드로 폴백:', e.message);
    }
  }

  if (!savedToFolder) {
    pdf.save(fileName);
  }

  hideOverlay();
  showToast(savedToFolder ? `✓ PDF 저장됨 (${folderInfo.folderName} 폴더)` : '✓ PDF 다운로드 완료', 'ok');
}

async function exportJPG(){
  const pages=document.getElementById('rpWrap').querySelectorAll('.rpage');
  if(!pages.length){showToast('먼저 미리보기를 눌러 보고서를 생성해주세요','err');return;}
  const{apt,dateStr}=getInfo();

  // 자동저장 폴더 + 작업 자동저장 처리
  const folderInfo = await ensureWorkSavedToFolder();

  // ✨ 기존 JPG 확인 → 덮어쓰기/새로 저장 선택
  const dateClean = dateStr.replace(/\./g,'-');
  const baseName = `report_${dateClean}`;
  let baseFileName = baseName;  // 기본은 시간 없음

  if (folderInfo && folderInfo.workDir) {
    let existingFiles = [];
    try {
      for await (const [fname, fhandle] of folderInfo.workDir.entries()) {
        if (fhandle.kind === 'file' && fname.startsWith(baseName) && fname.endsWith('.jpg')) {
          existingFiles.push(fname);
        }
      }
    } catch(e) {}

    if (existingFiles.length > 0) {
      const choice = confirm(
        `🖼️ JPG 파일이 이미 있습니다 (${existingFiles.length}개)\n\n` +
        `${existingFiles.slice(0, 3).join('\n')}` +
        (existingFiles.length > 3 ? `\n... 외 ${existingFiles.length - 3}개` : '') +
        `\n\n[확인] 기존 파일 덮어쓰기 (이전 JPG 모두 삭제)\n[취소] 새 파일로 저장 (시간 추가)`
      );

      if (choice) {
        // 덮어쓰기: 기존 JPG들 삭제
        for (const oldFile of existingFiles) {
          try {
            await folderInfo.workDir.removeEntry(oldFile);
            console.log(`🗑️ 기존 JPG 삭제: ${oldFile}`);
          } catch(e) {}
        }
        baseFileName = baseName;
      } else {
        // 새 파일: 시간 추가
        // KST 시간
        baseFileName = `${baseName}_${kstTimeStr()}`;
      }
    }
  }

  showOverlay('이미지 생성 중...');

  // 페이지별 캔버스 생성
  const blobs = [];
  for(let i=0;i<pages.length;i++){
    setProg((i/pages.length)*100,`${i+1} / ${pages.length} 변환 중`);
    const c=await html2canvas(pages[i],{
      scale:2,
      useCORS:true,
      allowTaint:true,
      width:794,
      height:1123,
      windowWidth:794,
      windowHeight:1123,
      backgroundColor:'#ffffff',
      logging:false,
      imageTimeout:0
    });
    const fname = pages.length === 1
      ? `${baseFileName}.jpg`
      : `${baseFileName}_p${String(i+1).padStart(2,'0')}.jpg`;
    // Blob과 dataUrl 모두 준비
    const dataUrl = c.toDataURL('image/jpeg', .92);
    const blob = await (await fetch(dataUrl)).blob();
    blobs.push({ blob, dataUrl, name: fname });
    await sleep(40);
  }
  hideOverlay();

  // 폴더에 저장 시도
  let savedToFolder = false;
  if (folderInfo && folderInfo.workDir) {
    try {
      for (const item of blobs) {
        const fh = await folderInfo.workDir.getFileHandle(item.name, { create: true });
        const w = await fh.createWritable();
        await w.write(item.blob);
        await w.close();
        await sleep(20);
      }
      savedToFolder = true;
      console.log(`✓ JPG ${blobs.length}장 폴더 저장: ${folderInfo.folderName}/`);
    } catch(e) {
      console.warn('JPG 폴더 저장 실패, 다운로드로 폴백:', e.message);
    }
  }

  if (!savedToFolder) {
    // 다운로드 폴백
    if (blobs.length === 1) {
      const a = document.createElement('a');
      a.href = blobs[0].dataUrl;
      a.download = blobs[0].name;
      a.click();
    } else {
      showToast(`${blobs.length}페이지 저장 시작`, 'ok');
      for (let i = 0; i < blobs.length; i++) {
        await sleep(300);
        const a = document.createElement('a');
        a.href = blobs[i].dataUrl;
        a.download = blobs[i].name;
        a.click();
      }
    }
  }

  showToast(savedToFolder ? `✓ JPG ${blobs.length}장 저장됨 (${folderInfo.folderName} 폴더)` : `✓ JPG ${blobs.length}장 다운로드 완료`, 'ok');
}

// 보고서 저장 전: 작업이 폴더에 저장되어 있는지 확인하고 없으면 자동 저장
// 반환: { workDir, folderName } 또는 null (폴더 미설정 또는 저장 실패)
async function ensureWorkSavedToFolder() {
  if (!photoFolderHandle) {
    console.log('폴더 미설정 - 보고서는 다운로드로 저장됨');
    return null;
  }

  // 권한 확인
  try {
    let perm = await photoFolderHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      perm = await photoFolderHandle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        showToast('폴더 권한이 거부되어 다운로드로 저장됩니다', 'err');
        return null;
      }
    }
  } catch(e) {
    return null;
  }

  const apt = (document.getElementById('aptName').value || '').trim();
  const date = document.getElementById('workDate').value || getLocalDateStr();

  // ✨ 1차: 이미 저장된 같은 작업 폴더가 있는지 + 변경사항 없는지 확인
  let matchFolder = null;
  let matchTime = '';
  let needsSave = true;  // 기본은 저장 필요

  try {
    for await (const [name, handle] of photoFolderHandle.entries()) {
      if (handle.kind !== 'directory') continue;
      if (name !== date && !name.startsWith(date + '_')) continue;

      try {
        const fh = await handle.getFileHandle('_session.json');
        const file = await fh.getFile();
        const buffer = await file.arrayBuffer();
        let text = new TextDecoder('utf-8').decode(buffer);
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        const parsed = JSON.parse(text.trim());
        const folderApt = (parsed.apt || '').trim();
        if (folderApt === apt && name > matchTime) {
          matchFolder = { name, handle, savedData: parsed };
          matchTime = name;
        }
      } catch(e) {}
    }
  } catch(e) {
    console.warn('폴더 검색 실패:', e.message);
  }

  // ✨ 변경사항 비교: 저장된 데이터와 현재 메모리 비교
  if (matchFolder) {
    const saved = matchFolder.savedData;
    const currentUnits = units.length;
    const savedUnits = (saved.units || []).length;

    // 호수 개수 비교
    if (currentUnits === savedUnits) {
      let allMatch = true;
      for (let i = 0; i < currentUnits; i++) {
        const cu = units[i];
        const su = saved.units[i];
        if (!su) { allMatch = false; break; }
        // 호수명 + 사진 개수만 비교 (간단 비교)
        const curBefore = cu.before.length;
        const curAfter = cu.after.length;
        const curSpec = cu.specials.length;
        const savBefore = su.beforeCount || 0;
        const savAfter = su.afterCount || 0;
        const savSpec = (su.specials || []).length;

        if (cu.name !== su.name || curBefore !== savBefore ||
            curAfter !== savAfter || curSpec !== savSpec) {
          allMatch = false;
          break;
        }
      }

      if (allMatch) {
        needsSave = false;
        console.log('✓ 작업 이미 저장됨 - 자동저장 스킵');
      }
    }
  }

  // ✨ 변경사항 있을 때만 저장
  if (needsSave) {
    showOverlay('작업 자동저장 중...');
    try {
      if (typeof saveToFolder === 'function') {
        await saveToFolder();
      }
    } catch(e) {
      console.warn('작업 자동저장 실패:', e.message);
    }
    hideOverlay();

    // 저장 후 다시 폴더 찾기
    matchFolder = null;
    matchTime = '';
    try {
      for await (const [name, handle] of photoFolderHandle.entries()) {
        if (handle.kind !== 'directory') continue;
        if (name !== date && !name.startsWith(date + '_')) continue;
        try {
          const fh = await handle.getFileHandle('_session.json');
          const file = await fh.getFile();
          const buffer = await file.arrayBuffer();
          let text = new TextDecoder('utf-8').decode(buffer);
          if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
          const parsed = JSON.parse(text.trim());
          const folderApt = (parsed.apt || '').trim();
          if (folderApt === apt && name > matchTime) {
            matchFolder = { name, handle };
            matchTime = name;
          }
        } catch(e) {}
      }
    } catch(e) {}
  }

  if (matchFolder) {
    return { workDir: matchFolder.handle, folderName: matchFolder.name };
  }
  return null;
}

