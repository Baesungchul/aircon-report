/* ═══════════════════════════════
   REPORT BUILD
═══════════════════════════════ */

// ★ 보고서(PDF/JPG) 출력 해상도 설정 - 설정(⚙️) 화면 "📄 보고서 해상도"에서 선택
//   html2canvas의 scale(픽셀 밀도)과 최종 JPEG 압축 품질을 함께 조절한다.
//   기본값 'normal'은 기존 동작(scale 1.5, quality .92)과 동일 - 기존 사용자는 체감 변화 없음.
const REPORT_RES_KEY = 'ac_report_res_v1';
const REPORT_RES_PRESETS = {
  low:    { scale: 1.14, quality: 0.85, label: '저화질 (HD급)' },
  normal: { scale: 1.71, quality: 0.92, label: '일반화질 (FHD급)' },
  high:   { scale: 2.28, quality: 0.95, label: '고화질 (2K급)' }
};
if (typeof window !== 'undefined') {
  window.REPORT_RES_PRESETS = REPORT_RES_PRESETS;
  window.REPORT_RES_KEY = REPORT_RES_KEY;
}
function getReportResPreset() {
  var key = 'normal';
  try { key = localStorage.getItem(REPORT_RES_KEY) || 'normal'; } catch (e) {}
  return REPORT_RES_PRESETS[key] || REPORT_RES_PRESETS.normal;
}

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

  /* ★ 2026-08-16 — 값을 어디서 읽는가를 바꿨다 (다중 업종의 핵심)
       예전: 화면 DOM(#coName, #coReportTitle …)에서 읽었다.
             DOM 은 언제나 '지금 설정된 것'만 반영하므로, 작업마다 업종이 달라지면
             지난달 에어컨 작업 보고서를 오늘 뽑을 때 오늘 업종으로 나온다.
       지금: 이 작업에 딸린 업종 프로필에서 읽는다(Profiles.infoForCurrentWork).
             프로필이 하나뿐이면 값이 DOM 과 같아 동작이 기존과 동일하다.
       DOM 폴백을 남겨둔 이유: profiles.js 로드 실패·구버전 캐시 상황에서 보고서가
       통째로 비어버리는 것을 막기 위함. */
  const P = (function () {
    /* ★ 2단계: 표시값(보고서 제목·호칭)은 '그 작업의 업종'이 우선이다.
         공유작업이면 상대 업종 스냅샷, 지난 작업이면 그때 업종으로 나온다. */
    try { if (window.Profiles && Profiles.displayForCurrentWork) return Profiles.displayForCurrentWork(); } catch (e) {}
    try { if (window.Profiles && Profiles.infoForCurrentWork) return Profiles.infoForCurrentWork(); } catch (e) {}
    return null;
  })();
  const dom = (id) => (document.getElementById(id)?.value || '');
  const co  = (k) => ((P && P[k] != null && P[k] !== '') ? P[k] : dom(k));
  /* ★ 업종 3필드(보고서 제목·호수 호칭·단계 호칭)는 DOM 으로 폴백하지 않는다.
       숨은 input 에는 '지금 설정된 업종' 값이 들어 있어서, 다른 업종의 작업을 열었는데
       그 업종에 제목이 비어 있으면 엉뚱한 업종 제목이 표지에 찍힌다. */
  const ind = (k) => (P ? (P[k] || '') : dom(k));

  return{
    apt:    document.getElementById('aptName').value||'OO아파트',
    dateStr:ds,
    worker: document.getElementById('workerName').value||'담당자',
    coName: co('coName'),
    coBrand:co('coBrand'),
    coTel:  formatTel(co('coTel')),
    coBiz:  formatBiz(co('coBiz')),
    coAddr: co('coAddr'),
    coEmail:co('coEmail'),
    coWeb:  co('coWeb'),
    coDesc: co('coDesc'),
    coIcon: coIconData||'',
    // 업종별 커스텀 호칭 (비어있으면 기본값 사용)
    coReportTitle: String(ind('coReportTitle')).trim(),
    coUnitLabel:   String(ind('coUnitLabel')).trim() || '호수',
    coStageLabel:  String(ind('coStageLabel')).trim() || '작업',
    // ★ 2026-08-16 업종 이름 — 표지 태그라인·제목 폴백에 쓴다(에어컨 하드코딩 대체)
    coProfileName: String((P && P._profileName) || '').trim()
  };
}

function buildReportHTML(){
  const{apt,dateStr,worker,coName,coBrand,coTel,coBiz,coAddr,coEmail,coWeb,coDesc,coIcon,coReportTitle,coUnitLabel,coStageLabel,coProfileName}=getInfo();

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
            ${coProfileName?`<div class="rp-brand-tag">${escH(coProfileName)} 전문</div>`:''}
          </div>
        </div>
        <div class="rp-rpt-badge">
          <div class="rp-rpt-badge-lbl">${t('report.cover.report')}</div>
          <div class="rp-rpt-badge-num">${dateShort}</div>
          ${coBiz?`<div class="rp-rpt-badge-num" style="margin-top:4px;font-size:10px;">${t('report.coCard.biz').replace(/^[^\w가-힣]+\s*/, '')} ${escH(coBiz)}</div>`:''}
        </div>
      </div>

      <div class="rp-hero-title">
        <div class="rp-eyebrow">${escH(coProfileName || t('report.cover.eyebrow'))}</div>
        ${coReportTitle
          ? `<div class="rp-h1">${escH(coReportTitle)}</div>`
          : (coProfileName
              ? `<div class="rp-h1">${escH(coProfileName)}<br><span class="rp-accent">${t('report.cover.title.after')}</span></div>`
              : `<div class="rp-h1">${t('report.cover.title.before')}<br><span class="rp-accent">${t('report.cover.title.after')}</span></div>`)
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
        items.push(`<div class="rp-pitem"><img src="${photoUrlFull(photos[i])}"></div>`);
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
        photoSlots.push(`<div class="rp-sp-photo-item"><img src="${photoUrlFull(photoSlice[i])}" style="width:100%;height:100%;object-fit:contain;border-radius:4px;"></div>`);
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
        photoSlots.push(`<div class="rp-sp-photo-item"><img src="${photoUrlFull(photoSlice[i])}" style="width:100%;height:100%;object-fit:contain;border-radius:4px;"></div>`);
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
  if (typeof _appBusy !== 'undefined' && _appBusy) return;

  if (!units || units.length === 0) {
    showToast('호수를 먼저 추가해주세요', 'err');
    return;
  }

  // ★ 보고서 탭에서 호출 - 확인 팝업 없이 바로 생성

  // 입력 차단
  if (typeof setAppBusy === 'function') setAppBusy(true, '📄 보고서 생성 중...');

  try {
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

    // ★ lazy 사진 모두 로드 (보고서 생성에 필요)
    await ensureAllPhotosLoaded();

  const html=buildReportHTML();
  document.getElementById('rpWrap').innerHTML=html;
  { const _b = document.getElementById('btnPDF'); if (_b) _b.disabled = false; }
  { const _b = document.getElementById('btnJPG'); if (_b) _b.disabled = false; }
  const scroll=document.getElementById('pvScroll');
  scroll.innerHTML='';
  const pages=document.getElementById('rpWrap').querySelectorAll('.rpage');
  const baseScale=Math.min(0.72,(window.innerWidth-40)/794);
  const w0 = 794*baseScale;
  const h0 = 1123*baseScale;
  pages.forEach((pg,i)=>{
    const wrap=document.createElement('div'); wrap.className='pv-pg-wrap';
    wrap.style.width = `${w0}px`;
    wrap.style.height = `${h0}px`;
    const lbl=document.createElement('div'); lbl.className='pv-pg-num'; lbl.textContent=`${i+1} / ${pages.length}페이지`;
    const clone=pg.cloneNode(true);
    clone.style.transform=`scale(${baseScale})`;
    clone.style.transformOrigin='top left';
    clone.style.width='794px';
    clone.dataset.baseScale = baseScale;  // ★ 기본 스케일 저장
    const box=document.createElement('div'); box.className='pv-pg-scaled'; box.style.width=`${w0}px`; box.style.height=`${h0}px`;
    box.appendChild(clone); wrap.appendChild(lbl); wrap.appendChild(box); scroll.appendChild(wrap);
  });
    document.getElementById('pvModal').classList.add('open');
    // ★ 보고서탭 해상도 콤보를 현재 설정값으로 맞춤
    try { var _prs = document.getElementById('pvResSelect'); if (_prs) _prs.value = (localStorage.getItem(REPORT_RES_KEY) || 'normal'); } catch (e) {}
    // ★ viewport 줌은 끄고 CSS transform으로 자체 줌 처리 (깨끗한 화질)
    if (typeof setViewportZoom === 'function') setViewportZoom(false);
  } catch(e) {
    console.error('[보고서] 생성 실패:', e);
    showToast('보고서 생성 실패: ' + (e.message || e), 'err');
  } finally {
    if (typeof setAppBusy === 'function') setAppBusy(false);
  }
}

async function exportPDF(){
  if (typeof _appBusy !== 'undefined' && _appBusy) return;

  const pages=document.getElementById('rpWrap').querySelectorAll('.rpage');
  if(!pages.length){showToast('먼저 미리보기를 눌러 보고서를 생성해주세요','err');return;}

  // ★ 확인 다이얼로그
  if (!confirm(`⬇️ PDF 저장\n\n${pages.length}페이지 PDF를 만들어 저장합니다.\n완료될 때까지 기다려주세요.`)) return;

  // 입력 차단
  if (typeof setAppBusy === 'function') setAppBusy(true, '⬇️ PDF 생성 중... (페이지별 처리)');

  try {
    // ★ 보고서 해상도 설정 (설정 화면에서 선택, 기본값 = 기존 동작과 동일)
    const _resPreset = getReportResPreset();

    // 자동저장 폴더 + 작업 자동저장 처리 (실패해도 PDF는 생성)
    const folderInfo = await ensureWorkSavedToFolder();

    const{jsPDF}=window.jspdf;
    const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
    for(let i=0;i<pages.length;i++){
      const _tPdfPage = Date.now();
      // 진행 상황 차단막 메시지 갱신
      if (typeof setAppBusy === 'function') setAppBusy(true, `⬇️ PDF 생성 중... (${i+1} / ${pages.length} 페이지)`, Math.round(i / pages.length * 100));
      const c=await html2canvas(pages[i],{
        scale: _resPreset.scale,   // ★ 설정에서 선택한 해상도 (기본 1.5, 기존과 동일)
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
    pdf.addImage(c.toDataURL('image/jpeg', _resPreset.quality),'JPEG',0,0,210,297);
    c.width = c.height = 0;   // ★ 2026-08-24 캔버스 버퍼 즉시 반납(고화질 다중 페이지 메모리 절감)
    console.log(`[보고서] PDF 페이지 ${i+1}: ${Date.now() - _tPdfPage}ms`);
    if (typeof setAppBusy === 'function') setAppBusy(true, `⬇️ PDF 생성 중... (${i+1} / ${pages.length} 페이지 완료)`, Math.round((i+1) / pages.length * 100));
    await sleep(40);
  }
  if (typeof setAppBusy === 'function') setAppBusy(true, '⬇️ PDF 저장 중...', 100);
  const{apt,dateStr}=getInfo();
  const dateClean = dateStr.replace(/\./g,'-');
  // 기본 파일명 (시간 없음)
  const baseName = `report_${dateClean}`;
  let fileName = `${baseName}.pdf`;

  // 폴더에 저장 시도
  let savedToFolder = false;
  if (folderInfo && folderInfo.workDir) {
    // ★ 폴더 전체 스캔 대신 후보 파일명 직접 시도 (빠름)
    let existingFiles = [];
    const candidates = [
      `${baseName}.pdf`,
      `${baseName}_v1.pdf`, `${baseName}_v2.pdf`, `${baseName}_v3.pdf`,
    ];
    await Promise.all(candidates.map(async (fname) => {
      try {
        await folderInfo.workDir.getFileHandle(fname);
        existingFiles.push(fname);
      } catch(e) {}
    }));

    if (existingFiles.length > 0) {
      hideOverlay();
      const choice = confirm(
        `📄 PDF 파일이 이미 있습니다 (${existingFiles.length}개)\n\n` +
        `${existingFiles.slice(0, 3).join('\n')}` +
        (existingFiles.length > 3 ? `\n... 외 ${existingFiles.length - 3}개` : '') +
        `\n\n[확인] 기존 파일 덮어쓰기 (이전 PDF 모두 삭제)\n[취소] 새 파일로 저장 (시간 추가)`
      );

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

    showToast(savedToFolder ? `✓ PDF 저장됨 (${folderInfo.folderName} 폴더)` : '✓ PDF 다운로드 완료', 'ok');
    /* ★ 2026-08-27 별점 — 보고서가 손에 잡히는 순간이 이 앱에서 가장 좋은 자리다.
         아무것도 묻지 않고 조건이 맞을 때만 조용히 뜬다(js/review.js). 토스트와 겹치지 않게 살짝 늦춘다. */
    try { window.Review && Review.maybeAskSoon('pdf'); } catch(e2) {}
  } catch(e) {
    console.error('[PDF] 생성 실패:', e);
    try { window.Review && Review.markFailure(); } catch(e2) {}
    showToast('PDF 생성 실패: ' + (e.message || e), 'err');
  } finally {
    hideOverlay?.();
    if (typeof setAppBusy === 'function') setAppBusy(false);
  }
}

async function exportJPG(){
  if (typeof _appBusy !== 'undefined' && _appBusy) return;

  const pages=document.getElementById('rpWrap').querySelectorAll('.rpage');
  if(!pages.length){showToast('먼저 미리보기를 눌러 보고서를 생성해주세요','err');return;}

  // ★ 확인 다이얼로그
  if (!confirm(`🖼️ JPG 저장\n\n${pages.length}장의 JPG 이미지를 만들어 저장합니다.\n완료될 때까지 기다려주세요.`)) return;

  // 입력 차단
  if (typeof setAppBusy === 'function') setAppBusy(true, '🖼️ JPG 생성 중...');

  try {
    // ★ 보고서 해상도 설정 (설정 화면에서 선택, 기본값 = 기존 동작과 동일)
    const _resPreset = getReportResPreset();

    const{apt,dateStr}=getInfo();

    // 자동저장 폴더 + 작업 자동저장 처리
    const folderInfo = await ensureWorkSavedToFolder();

  // ✨ 기존 JPG 확인 → 덮어쓰기/새로 저장 선택
  const dateClean = dateStr.replace(/\./g,'-');
  const baseName = `report_${dateClean}`;
  let baseFileName = baseName;  // 기본은 시간 없음

  if (folderInfo && folderInfo.workDir) {
    let existingFiles = [];
    // ★ 폴더 전체 스캔 대신 후보 파일명 5개만 빠르게 시도 (10배 빠름)
    const candidates = [
      `${baseName}.jpg`,                    // report_2026-05-17.jpg
      `${baseName}_page1.jpg`,
      `${baseName}_page2.jpg`,
      `${baseName}_page3.jpg`,
      `${baseName}_page4.jpg`,
      `${baseName}_page5.jpg`,
      `${baseName}_page6.jpg`,
      `${baseName}_page7.jpg`,
      `${baseName}_page8.jpg`,
      `${baseName}_page9.jpg`,
      `${baseName}_page10.jpg`,
    ];
    await Promise.all(candidates.map(async (fname) => {
      try {
        await folderInfo.workDir.getFileHandle(fname);  // 파일 있으면 성공
        existingFiles.push(fname);
      } catch(e) { /* 파일 없음 - 정상 */ }
    }));

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


  // 페이지별 캔버스 생성
  const blobs = [];
  for(let i=0;i<pages.length;i++){
    const _tPage = Date.now();
    if (typeof setAppBusy === 'function') setAppBusy(true, `🖼️ JPG 생성 중... (${i+1} / ${pages.length} 페이지)`, Math.round(i / pages.length * 100));
    const c=await html2canvas(pages[i],{
      scale: _resPreset.scale,   // ★ 설정에서 선택한 해상도 (기본 1.5, 기존과 동일)
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
    // ★ toBlob 직접 사용 (1.261) - toDataURL→fetch→blob 2단계 변환 제거 (메모리·속도 개선)
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', _resPreset.quality));
    /* ★ 2026-08-24 메모리 — 여기서 toDataURL 로 같은 이미지의 base64 사본을 하나 더 만들어
         blobs[] 에 끝까지 들고 있었다. 그 값이 실제로 쓰이는 곳은 아래 '다운로드 폴백' 하나뿐인데,
         네이티브 앱은 폴더 저장이 거의 항상 성공하므로 사실상 한 번도 안 쓰이는 데이터였다.
         base64 는 원본보다 33% 크고 문자열로 남아, 고화질 여러 장이면 수십 MB 가 헛되이 쌓였다
         (중저가 폰에서 WebView 가 강제종료되는 전형적인 조건). → 폴백에서 그때 만들어 쓴다. */
    blobs.push({ blob, name: fname });
    c.width = c.height = 0;   // html2canvas 캔버스 버퍼 즉시 반납(GC 를 기다리지 않음)
    console.log(`[보고서] 페이지 ${i+1} 변환: ${Date.now() - _tPage}ms`);
    if (typeof setAppBusy === 'function') setAppBusy(true, `🖼️ JPG 생성 중... (${i+1} / ${pages.length} 페이지 완료)`, Math.round((i+1) / pages.length * 100));
    await sleep(40);
  }
  if (typeof setAppBusy === 'function') setAppBusy(true, '🖼️ JPG 저장 중...', 100);
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
    // 다운로드 폴백 — 필요한 이 순간에만 blob URL 을 만들고 곧바로 반납한다(2026-08-24)
    const dl = (item) => {
      const url = URL.createObjectURL(item.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = item.name;
      a.click();
      // 클릭 직후 바로 반납하면 저장이 취소되는 브라우저가 있어 여유를 둔다
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch(e){} }, 5000);
    };
    if (blobs.length === 1) {
      dl(blobs[0]);
    } else {
      for (let i = 0; i < blobs.length; i++) {
        await sleep(300);
        dl(blobs[i]);
      }
    }
  }

  // ★ 갤러리(사진앱)로도 내보내기 — MediaStore, 권한/EACCES 문제 없음
  let savedToGallery = 0;
  if (window.Gallery && Gallery.available()) {
    for (const item of blobs) {
      try { await Gallery.saveImageToGallery(item.blob, item.name, (Gallery.workAlbumName ? Gallery.workAlbumName() : '작업보고서')); savedToGallery++; }
      catch(e) { console.warn('[JPG] 갤러리 저장 실패:', item.name, e.message); }
    }
  }

    showToast(
      (savedToFolder ? `✓ JPG ${blobs.length}장 저장됨 (${folderInfo.folderName} 폴더)` : `✓ JPG ${blobs.length}장 다운로드 완료`)
      + (savedToGallery ? ` · 갤러리 ${savedToGallery}장` : ''),
      'ok');
    try { window.Review && Review.maybeAskSoon('jpg'); } catch(e2) {}
  } catch(e) {
    console.error('[JPG] 생성 실패:', e);
    try { window.Review && Review.markFailure(); } catch(e2) {}
    showToast('JPG 생성 실패: ' + (e.message || e), 'err');
  } finally {
    hideOverlay?.();
    if (typeof setAppBusy === 'function') setAppBusy(false);
  }
}

// 보고서 생성 전 폴더 핸들 반환 (자료 유실 방지 최소 저장만)
async function ensureWorkSavedToFolder() {
  if (!photoFolderHandle) return null;

  const _tPerm = Date.now();
  // 권한 확인 - ★ queryPermission 먼저 (빠름), 없을 때만 request (1.261)
  try {
    let perm = await photoFolderHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      perm = await Promise.race([
        photoFolderHandle.requestPermission({ mode: 'readwrite' }),
        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 8000))
      ]);
    }
    if (perm !== 'granted') return null;
  } catch(e) { return null; }
  console.log(`[보고서] 권한 확인: ${Date.now() - _tPerm}ms`);

  // ★ Case 1: 불러온 작업 (currentFolderName 있음) + 변경 없음 → 바로 반환
  const hasFolderName = typeof currentFolderName !== 'undefined' && currentFolderName;
  const isDirty = typeof _dataDirty !== 'undefined' && _dataDirty;
  const snap = typeof quickSnapshot === 'function' ? quickSnapshot() : '';
  const snapChanged = snap !== (typeof _lastSaveSnapshot !== 'undefined' ? _lastSaveSnapshot : '');
  const hasChanges = isDirty || snapChanged;

  if (hasFolderName && !hasChanges) {
    // 변경 없음 → 저장 스킵, 바로 폴더 핸들 반환
    try {
      const dirHandle = await photoFolderHandle.getDirectoryHandle(currentFolderName);
      console.log(`✓ 보고서: 저장 스킵 (변경 없음) - ${currentFolderName}`);
      return { workDir: dirHandle, folderName: currentFolderName };
    } catch(e) { return null; }
  }

  // ★ Case 2: 변경 있거나 폴더 모름 → 저장 후 반환 (자료 유실 방지)
  if (hasChanges || !hasFolderName) {
    try {
      await saveToFolder({ auto: true, force: true, silent: true });
      console.log(`✓ 보고서 전 자동저장 완료`);
    } catch(e) {
      console.warn('보고서 전 자동저장 실패:', e.message);
    }
  }

  const targetFolder = typeof currentFolderName !== 'undefined' ? currentFolderName : null;
  if (!targetFolder) return null;

  try {
    const dirHandle = await photoFolderHandle.getDirectoryHandle(targetFolder);
    return { workDir: dirHandle, folderName: targetFolder };
  } catch(e) { return null; }
}
