/* ═══════════════════════════════════════════════
   온보딩 (첫 실행 시 기본 세팅 안내)
═══════════════════════════════════════════════ */

const ONBOARDING_DONE_KEY = 'ac_onboarding_done_v1';
let _obStep = 1;
let _obData = { coName: '', coTel: '', coIcon: '❄️', folderSet: false };
let _obAnimTimers = [];  // ★ 슬라이드 애니메이션 타이머 (전환 시 정리)

function _obClearAnimTimers() {
  _obAnimTimers.forEach(t => clearTimeout(t));
  _obAnimTimers = [];
}
function _obAddTimer(fn, ms) {
  const t = setTimeout(fn, ms);
  _obAnimTimers.push(t);
  return t;
}

function safeGetItem(key) {
  try { return localStorage.getItem(key); } catch(e) {}
  try { return sessionStorage.getItem(key); } catch(e) {}
  return null;
}
function safeSetItem(key, val) {
  try { localStorage.setItem(key, val); return; } catch(e) {}
  try { sessionStorage.setItem(key, val); } catch(e) {}
}

function getSlides() {
  return [
    { id: 'intro',   render: renderSlideIntro },
    { id: 's1',      render: renderSlideScreen1 },
    { id: 's2',      render: renderSlideScreen2 },
    { id: 's3',      render: renderSlideScreen3 },
    { id: 's4',      render: renderSlideScreen4 },
    { id: 's5',      render: renderSlideScreen5 },
    { id: 's6',      render: renderSlideScreen6 },
    { id: 'setup',   render: renderSlideSetup },
  ];
}

function showOnboarding() {
  _obStep = 1;
  _obData = { coName: '', coTel: '', coIcon: '❄️', folderSet: false };
  const modal = document.getElementById('onboardingModal');
  if (!modal) return;
  modal.classList.add('open');
  renderOnboardingStep();
}
function hideOnboarding() { document.getElementById('onboardingModal').classList.remove('open'); }
function closeOnboarding(completed) {
  _obClearAnimTimers();  // ★ 애니메이션 타이머 정리
  if (completed) safeSetItem(ONBOARDING_DONE_KEY, '1');
  hideOnboarding();
}

function renderOnboardingStep() {
  const slides = getSlides();
  const total  = slides.length;
  const content     = document.getElementById('obContent');
  const counter     = document.getElementById('obStepCounter');
  const progressBar = document.getElementById('obProgressBar');
  const prevBtn     = document.getElementById('obPrev');
  const nextBtn     = document.getElementById('obNext');
  if (!content) {
    console.warn('[온보딩] obContent를 찾을 수 없음');
    return;
  }

  // ★ 이전 inline 스타일 모두 초기화 (이전 애니메이션 잔재 제거)
  content.style.cssText = '';
  _obClearAnimTimers();  // ★ 이전 슬라이드 애니메이션 타이머 정리

  if (counter)     counter.textContent = `${_obStep} / ${total}`;
  if (progressBar) progressBar.style.width = `${(_obStep / total) * 100}%`;
  if (prevBtn)     prevBtn.style.display = _obStep > 1 ? 'inline-flex' : 'none';
  if (nextBtn) {
    nextBtn.textContent = _obStep === total ? '시작하기 🚀' : '다음 →';
    nextBtn.className   = _obStep === total ? 'btn b-green' : 'btn b-blue';
  }

  try {
    slides[_obStep - 1].render(content);
    console.log(`[온보딩] 슬라이드 ${_obStep}/${total} 렌더 완료`);
  } catch(e) {
    console.error('[온보딩] 렌더 실패:', e);
    content.innerHTML = `<div style="padding:20px;text-align:center;color:var(--tx);">
      <div style="font-size:14px;font-weight:700;margin-bottom:8px;">화면 표시 오류</div>
      <div style="font-size:11px;color:var(--mu);">${e.message}</div>
    </div>`;
  }
}

function onboardingNext() {
  const total = getSlides().length;
  if (_obStep === total) { applyOnboardingSettings(); closeOnboarding(true); return; }
  _obStep++; renderOnboardingStep();
}
function onboardingPrev() { if (_obStep > 1) { _obStep--; renderOnboardingStep(); } }

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function badge(n) { return `<span class="ob-badge">${n}</span>`; }
function callout(n, text) {
  return `<div class="ob-callout"><span class="ob-callout-num">${n}</span><span class="ob-callout-txt">${text}</span></div>`;
}

/* ═══ 공통 스포트라이트 애니메이션 엔진 ═══
   - 탭할 때만 다음 단계로 (자동이동 없음)
   - 마지막 단계에서 탭하면 다음 슬라이드로 (onboardingNext)
   - title, img, steps[{zone,finger,title,desc}] 를 받아 렌더 */
function renderSpotlightSlide(c, opts) {
  const { slideTitle, img, imgAlt, steps, ratio } = opts;

  c.innerHTML = `
  <div class="ob-slide">
    <div class="ob-slide-ttl">${slideTitle}</div>
    <div class="ob-anim-wrap"${ratio ? ` style="aspect-ratio:${ratio};"` : ''}>
      <img src="${img}" alt="${imgAlt || ''}">
      <div class="ob-anim-dim" id="obDim"></div>
      <div class="ob-hl-box" id="obHlBox"></div>
      <div class="ob-hl-pin" id="obHlPin">1</div>
      <div class="ob-finger" id="obFinger">👆</div>
    </div>
    <div class="ob-anim-desc" id="obAnimDesc">
      <div class="ob-anim-desc-title" id="obDescTitle"></div>
      <div class="ob-anim-desc-txt" id="obDescTxt"></div>
    </div>
    <div class="ob-anim-dots" id="obAnimDots"></div>
    <div class="ob-anim-hint" id="obAnimHint">화면을 탭하면 다음으로 넘어가요</div>
  </div>`;

  const hlBox    = c.querySelector('#obHlBox');
  const hlPin    = c.querySelector('#obHlPin');
  const finger   = c.querySelector('#obFinger');
  const descTtl  = c.querySelector('#obDescTitle');
  const descTxt  = c.querySelector('#obDescTxt');
  const dotsWrap = c.querySelector('#obAnimDots');
  const animWrap = c.querySelector('.ob-anim-wrap');
  const descCard = c.querySelector('#obAnimDesc');
  const hint     = c.querySelector('#obAnimHint');

  dotsWrap.innerHTML = steps.map((_, i) =>
    `<span class="ob-dot${i === 0 ? ' on' : ''}" data-i="${i}"></span>`).join('');

  let cur = 0;

  const dim = c.querySelector('#obDim');

  function applyStep(i, animate) {
    const s = steps[i];
    const z = s.zone;
    hlBox.style.top    = z.top + '%';
    hlBox.style.left   = z.left + '%';
    hlBox.style.width  = z.w + '%';
    hlBox.style.height = z.h + '%';
    // ★ dim 레이어에 박스 영역만큼 구멍 (clip-path) - dim 자체는 고정이라 이미지 안 흔들림
    if (dim) {
      const t = z.top, l = z.left, r = z.left + z.w, b = z.top + z.h;
      // 바깥 사각형(전체) → 안쪽 사각형(박스, 역방향)으로 구멍 뚫기 (evenodd)
      dim.style.clipPath =
        `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ` +
        `${l}% ${t}%, ${l}% ${b}%, ${r}% ${b}%, ${r}% ${t}%, ${l}% ${t}%)`;
    }
    hlPin.textContent = (i + 1);
    hlPin.style.top  = (z.top - 1.5) + '%';
    hlPin.style.left = (z.left + 1) + '%';
    if (s.finger) {
      finger.style.display = '';
      finger.style.top  = s.finger.top + '%';
      finger.style.left = s.finger.left + '%';
    } else {
      finger.style.display = 'none';
    }
    if (animate) {
      descCard.classList.remove('show');
      _obAddTimer(() => {
        descTtl.innerHTML = `<span class="ob-anim-num">${i+1}</span> ${s.title}`;
        descTxt.innerHTML = s.desc;
        descCard.classList.add('show');
      }, 150);
    } else {
      descTtl.innerHTML = `<span class="ob-anim-num">${i+1}</span> ${s.title}`;
      descTxt.innerHTML = s.desc;
      descCard.classList.add('show');
    }
    finger.classList.remove('tap');
    void finger.offsetWidth;
    finger.classList.add('tap');
    dotsWrap.querySelectorAll('.ob-dot').forEach((d, di) =>
      d.classList.toggle('on', di === i));
    // 마지막 단계면 힌트 변경
    if (hint) {
      hint.textContent = (i === steps.length - 1)
        ? '탭하면 다음 화면으로 넘어가요 →'
        : '화면을 탭하면 다음 항목으로 넘어가요';
    }
    // ★ 진단: 이미지 실제 크기 로그 (1.269)
    const imgEl = c.querySelector('.ob-anim-wrap img');
    const wrapEl = c.querySelector('.ob-anim-wrap');
    if (imgEl && wrapEl) {
      requestAnimationFrame(() => {
        const ir = imgEl.getBoundingClientRect();
        const wr = wrapEl.getBoundingClientRect();
        console.log(`[온보딩진단] 단계${i+1} img=${Math.round(ir.width)}x${Math.round(ir.height)} wrap=${Math.round(wr.width)}x${Math.round(wr.height)}`);
      });
    }
  }

  // 탭 = 다음 단계 / 마지막이면 다음 슬라이드
  animWrap.addEventListener('click', () => {
    if (cur < steps.length - 1) {
      cur++;
      applyStep(cur, true);
    } else {
      // 마지막 항목에서 탭 → 다음 슬라이드
      if (typeof onboardingNext === 'function') onboardingNext();
    }
  });
  // 점 클릭으로 직접 이동
  dotsWrap.querySelectorAll('.ob-dot').forEach(d => {
    d.addEventListener('click', (e) => {
      e.stopPropagation();
      cur = +d.dataset.i;
      applyStep(cur, true);
    });
  });

  applyStep(0, false);
}



/* ── 슬라이드 1: 소개 ── */
function renderSlideIntro(c) {
  // ★ 업종 설정 반영한 제목 (1.263)
  let introTitle = '작업보고서 작성기';
  try {
    const ci = JSON.parse(localStorage.getItem(typeof CO_KEY !== 'undefined' ? CO_KEY : 'ac_company_info') || '{}');
    const rt = (ci.coReportTitle || '').trim();
    if (rt) {
      const industry = rt.replace(/\s*작업\s*보고서\s*$/, '').replace(/\s*보고서\s*$/, '').trim();
      if (industry) introTitle = `${industry} 작업보고서 작성기`;
    }
  } catch(e) {}
  c.innerHTML = `
  <div class="ob-slide ob-slide-intro">
    <div class="ob-intro-icon">❄️</div>
    <h2 class="ob-intro-title">${introTitle}</h2>
    <p class="ob-intro-sub">현장 사진을 전문 보고서로<br>고객 관리까지 한번에</p>
    <div class="ob-intro-feats">
      <div class="ob-feat"><span>📸</span><div><b>작업 전·후 사진 정리</b><br><small>호수별로 체계적 관리</small></div></div>
      <div class="ob-feat"><span>📄</span><div><b>PDF · JPG 보고서</b><br><small>전문 보고서 즉시 출력</small></div></div>
      <div class="ob-feat"><span>👥</span><div><b>고객 자동 관리</b><br><small>전화번호로 이력 추적</small></div></div>
      <div class="ob-feat"><span>💾</span><div><b>자동 저장·백업</b><br><small>내 폴더에 안전 보관</small></div></div>
    </div>
    <div class="ob-intro-hint">👉 6장의 화면으로 사용법을 안내해드려요</div>
  </div>`;
}


/* ── 슬라이드 2: 메인 화면 구성 (애니메이션) ── */
function renderSlideScreen1(c) {
  renderSpotlightSlide(c, {
    slideTitle: '① 메인 화면 구성',
    img: './assets/onboarding/screen1.jpeg',
    ratio: '968/1346',
    imgAlt: '메인 화면',
    steps: [
      {
        zone: { top: 10.2, left: 0.7, w: 98.3, h: 12.1 },
        finger: { top: 20.2, left: 25.2 },
        title: '작업 정보 입력',
        desc: '먼저 <b>작업명</b>을 적어요. 아파트면 단지명(예: 청솔타운 2동), 상가면 상호를 넣으면 나중에 찾기 쉬워요. 날짜는 오늘로 자동 입력돼요.'
      },
      {
        zone: { top: 23, left: 1.2, w: 98.3, h: 12.6 },
        finger: { top: 30.4, left: 38.1 },
        title: '작업 유형 선택',
        desc: '<b>가정용</b>은 호수마다 고객이 다를 때(아파트 여러 세대), <b>공용시설</b>은 건물 전체가 한 고객일 때(어린이집·사무실) 골라요.'
      },
      {
        zone: { top: 35.1, left: 2, w: 96.7, h: 10.2 },
        finger: { top: 40.3, left: 19.3 },
        title: '주요 버튼',
        desc: '<b>💾저장</b>은 지금 작업을 폴더에 보관, <b>🆕새작업</b>은 새 현장 시작, <b>📄보고서</b>는 사진을 정리해 PDF로 만들어요.'
      },
      {
        zone: { top: 48.1, left: 2.1, w: 95, h: 21 },
        finger: { top: 56.3, left: 61.1 },
        title: '호수 관리',
        desc: '작업할 <b>호수</b>를 추가해요. 한 개씩은 <b>➕추가</b>, 여러 개는 <b>📋일괄</b>(예: 101~105 한 번에). 호수가 많으면 <b>검색</b>으로 빨리 찾아요.'
      },
    ]
  });
}


/* ── 슬라이드 3: 호수 추가 · 카드 구성 (애니메이션) ── */
function renderSlideScreen2(c) {
  renderSpotlightSlide(c, {
    slideTitle: '② 호수 추가 · 카드 구성',
    img: './assets/onboarding/screen2_card.jpg',
    ratio: '968/1080',
    imgAlt: '호수 카드',
    steps: [
      {
        zone: { top: 0.4, left: 3.9, w: 92.8, h: 21.2 },
        finger: { top: 9.2, left: 53.6 },
        title: '호수명 · 완료 · 순서편집',
        desc: '<b>호수명</b>을 ✏️로 바꿀 수 있어요. 작업이 끝나면 <b>✅완료</b>로 표시하고, 사진 순서를 바꾸려면 <b>🔄순서편집</b>을 눌러요.'
      },
      {
        zone: { top: 23.9, left: 3.3, w: 92.7, h: 22.3 },
        finger: { top: 31.3, left: 40.7 },
        title: '작업 전 / 작업 후 사진',
        desc: '<b>작업 전</b>(🔴) 사진과 <b>작업 후</b>(🟢) 사진을 따로 찍어요. 📷<b>카메라</b>로 바로 찍거나 📁<b>파일</b>에서 기존 사진을 골라요.'
      },
      {
        zone: { top: 45.8, left: 3.5, w: 92.7, h: 38.1 },
        finger: { top: 58.3, left: 17.8 },
        title: '사진 관리',
        desc: '추가한 사진들이에요. 잘못 찍었으면 <b>✗</b>로 지우고(휴지통에 보관), <b>⬇️</b>로 그 사진 원본을 따로 저장할 수 있어요.'
      },
      {
        zone: { top: 87, left: 3.4, w: 93, h: 13 },
        finger: { top: 96.9, left: 59 },
        title: '특이사항',
        desc: '고장·누수처럼 특별히 남길 게 있으면 <b>특이사항</b>에 사진과 메모로 기록해요. 보고서에 따로 표시돼요.'
      },
    ]
  });
}


/* ── 슬라이드 4: 사진 정렬 · 순서 편집 (애니메이션) ── */
function renderSlideScreen3(c) {
  renderSpotlightSlide(c, {
    slideTitle: '③ 사진 정렬 · 순서 편집',
    img: './assets/onboarding/screen3_reorder.jpg',
    ratio: '968/1300',
    imgAlt: '사진 순서 편집',
    steps: [
      {
        zone: { top: 0, left: 0.1, w: 99.9, h: 7.9 },
        finger: { top: 5.3, left: 74.7 },
        title: '순서 편집 화면',
        desc: '호수 카드의 <b>🔄순서편집</b>을 누르면 이 화면이 열려요.'
      },
      {
        zone: { top: 12.3, left: 0.4, w: 99.2, h: 8.7 },
        finger: { top: 17.2, left: 83.1 },
        title: '드래그로 순서 변경',
        desc: '사진을 <b>길게 눌러 끌면</b> 순서가 바뀌어요. 사진을 한 번 탭하면 크게 볼 수 있어요.'
      },
      {
        zone: { top: 21.5, left: 0, w: 100, h: 65.3 },
        finger: { top: 42.4, left: 41.4 },
        title: '작업 전 / 작업 후',
        desc: '왼쪽이 <b>작업 전</b>, 오른쪽이 <b>작업 후</b>예요. 전·후를 같은 순서로 맞추면 보고서에서 나란히 짝지어 나와요(전1↔후1). 전↔후로 옮길 수도 있어요.'
      },
      {
        zone: { top: 91.3, left: 57.5, w: 42.5, h: 8.7 },
        finger: { top: 96.8, left: 91.7 },
        title: '저장 / 취소',
        desc: '<b>저장</b>하면 바뀐 순서가 적용되고, <b>취소</b>하면 원래대로 돌아가요.'
      },
    ]
  });
}


/* ── 슬라이드 5: 작업 기록 (애니메이션) ── */
function renderSlideScreen4(c) {
  renderSpotlightSlide(c, {
    slideTitle: '④ 작업 기록 · 고객 관리',
    img: './assets/onboarding/screen5_records.jpg',
    ratio: '968/1945',
    imgAlt: '작업 기록',
    steps: [
      {
        zone: { top: 6.7, left: 0, w: 100, h: 17.5 },
        finger: { top: 15.5, left: 29.7 },
        title: '작업 통계',
        desc: '지금까지 작업한 <b>고객 수</b>와 <b>재방문(재작업)</b> 건수, 최근 30일 작업량을 한눈에 봐요.'
      },
      {
        zone: { top: 23.9, left: 0, w: 99.9, h: 12.4 },
        finger: { top: 33.7, left: 71.8 },
        title: '기간 필터',
        desc: '기본은 <b>최근 3일</b>만 보여줘요. 예전 작업을 찾으려면 <b>기간 변경</b>으로 7일·30일·전체로 넓혀요.'
      },
      {
        zone: { top: 43.4, left: 0, w: 100, h: 46.2 },
        finger: { top: 50.3, left: 55.6 },
        title: '작업 불러오기 · 수정 · 삭제',
        desc: '작업을 다시 보려면 카드를 누르거나 <b>📂열기</b>를 눌러요. <b>✏️</b>로 고객 정보를 고치고, <b>🗑️</b>로 지울 수 있어요. 이름·호수·전화번호로 검색도 돼요.'
      },
      {
        zone: { top: 93, left: 39.6, w: 60.4, h: 7 },
        finger: { top: 98.1, left: 76.5 },
        title: '엑셀 파일',
        desc: '모든 고객 기록은 <b>엑셀 파일</b>로도 저장돼요. 이 버튼으로 위치를 확인해 컴퓨터에서 열어볼 수 있어요.'
      },
    ]
  });
}

/* ── 슬라이드 6: 보고서 출력 (애니메이션) ── */
function renderSlideScreen5(c) {
  renderSpotlightSlide(c, {
    slideTitle: '⑤ 보고서 출력 · 공유',
    img: './assets/onboarding/screen4_report.jpg',
    ratio: '968/1380',
    imgAlt: '보고서 미리보기',
    steps: [
      {
        zone: { top: 0, left: 0, w: 99.8, h: 11 },
        finger: { top: 9, left: 81.2 },
        title: '저장 · 공유 도구',
        desc: '위쪽 도구막대에서 글자 크기를 ➖➕로 조절하고, <b>⬇️PDF</b>나 <b>🖼️JPG</b>로 저장해요. 저장한 파일을 고객에게 보내면 돼요.'
      },
      {
        zone: { top: 14.4, left: 0, w: 100, h: 40.9 },
        finger: { top: 33.1, left: 39.7 },
        title: '표지',
        desc: '<b>표지</b>에는 회사 정보·작업 현장·날짜·담당자·완료율이 자동으로 들어가요.'
      },
      {
        zone: { top: 55.2, left: 0, w: 100, h: 29.1 },
        finger: { top: 66.2, left: 81.4 },
        title: '작업 상세 · 사진',
        desc: '요약 통계와 호수별 작업 내역이 정리돼요. 그 아래로 호수마다 <b>작업 전·후 사진이 나란히</b>(왼쪽 전 / 오른쪽 후) 출력돼요.'
      },
    ]
  });
}

/* ── 슬라이드 7: ⚙️ 설정 (애니메이션) ── */
function renderSlideScreen6(c) {
  renderSpotlightSlide(c, {
    slideTitle: '⑥ ⚙️ 설정',
    img: './assets/onboarding/screen6_settings.jpg',
    ratio: '870/3055',
    imgAlt: '설정 화면',
    steps: [
      {
        zone: { top: 0.8, left: 0, w: 100, h: 15.5 },
        finger: { top: 8.8, left: 33.8 },
        title: '업체 정보',
        desc: '<b>업체명·연락처·사업자번호</b>를 넣으면 보고서 표지에 자동으로 들어가요. 한 번 넣으면 계속 쓰여요.'
      },
      {
        zone: { top: 21.3, left: 0, w: 99.8, h: 18.2 },
        finger: { top: 28, left: 50 },
        title: '초기 설정 다시 하기',
        desc: '이 안내(도움말)를 다시 보고 싶을 때 <b>초기 설정 다시 하기</b>를 눌러요.'
      },
      {
        zone: { top: 42, left: 0, w: 100, h: 10.5 },
        finger: { top: 50.1, left: 42.8 },
        title: '저장 폴더',
        desc: '사진과 작업 내용이 저장되는 <b>폴더</b>예요. 위치를 확인하거나 바꿀 수 있어요. (폴더 연결이 풀리면 여기서 다시 연결해요.)'
      },
      {
        zone: { top: 54, left: 0, w: 99.5, h: 39.9 },
        finger: { top: 70, left: 50 },
        title: '외관 설정',
        desc: '화면 <b>테마</b>(어둡게/밝게), 보고서 디자인, <b>글자 크기</b>, 언어를 취향대로 바꿔요.'
      },
    ]
  });
}

/* ── 슬라이드 7: 세팅 ── */
function renderSlideSetup(c) {
  const hasFolder = (typeof photoFolderHandle !== 'undefined' && photoFolderHandle);
  c.innerHTML = `
  <div class="ob-slide">
    <div class="ob-slide-ttl">⑦ 업체 정보 설정</div>
    <p class="ob-setup-sub">보고서에 표시될 정보를 입력해요<br><small style="color:var(--mu);">⚙️설정에서 언제든 변경 가능</small></p>
    <div class="ob-setup-form">
      <div class="ob-setup-icons">
        <button class="ob-icon-opt" data-ic="❄️">❄️</button>
        <button class="ob-icon-opt" data-ic="🔧">🔧</button>
        <button class="ob-icon-opt" data-ic="🏠">🏠</button>
        <button class="ob-icon-opt" data-ic="🧼">🧼</button>
        <button class="ob-icon-opt" data-ic="⚡">⚡</button>
        <button class="ob-icon-opt" data-ic="🛠️">🛠️</button>
        <button class="ob-icon-opt" data-ic="🎨">🎨</button>
        <button class="ob-icon-opt" data-ic="🚗">🚗</button>
      </div>
      <label class="ob-setup-label">업체명 <span style="color:var(--dn);">*</span></label>
      <input class="ob-setup-input" id="obCoName" type="text" placeholder="예: 평택에어컨1004" value="">
      <label class="ob-setup-label">대표 연락처</label>
      <input class="ob-setup-input" id="obCoTel" type="text" inputmode="tel" placeholder="010-1234-5678" value="">
      <label class="ob-setup-label">저장 폴더 <span style="color:var(--mu);font-size:11px;">(사진·데이터 자동 저장)</span></label>
      <button class="btn ${hasFolder ? 'b-green' : 'b-blue'}" id="obSelectFolder"
        style="width:100%;justify-content:center;padding:10px;">
        ${hasFolder ? `✅ ${escHtml(photoFolderHandle.name)}` : '📁 저장 폴더 선택하기'}
      </button>
    </div>
  </div>`;

  document.querySelectorAll('.ob-icon-opt').forEach(btn => {
    if (btn.dataset.ic === _obData.coIcon) btn.classList.add('selected');
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ob-icon-opt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      _obData.coIcon = btn.dataset.ic;
    });
  });

  const nameEl = document.getElementById('obCoName');
  const telEl  = document.getElementById('obCoTel');
  if (nameEl) { nameEl.value = _obData.coName || ''; nameEl.addEventListener('input', e => { _obData.coName = e.target.value; }); }
  if (telEl)  { telEl.value  = _obData.coTel  || ''; telEl.addEventListener('input', e => {
    const raw = e.target.value.replace(/[^\d]/g,'');
    if (raw.length===11) e.target.value=`${raw.slice(0,3)}-${raw.slice(3,7)}-${raw.slice(7)}`;
    else if (raw.length===10) e.target.value=`${raw.slice(0,3)}-${raw.slice(3,6)}-${raw.slice(6)}`;
    _obData.coTel = e.target.value;
  }); }

  const folderBtn = document.getElementById('obSelectFolder');
  if (folderBtn && 'showDirectoryPicker' in window) {
    folderBtn.addEventListener('click', async () => {
      try {
        if (typeof selectPhotoFolder === 'function') await selectPhotoFolder();
        if (photoFolderHandle) {
          folderBtn.textContent = `✅ ${escHtml(photoFolderHandle.name)}`;
          folderBtn.className = 'btn b-green';
          folderBtn.style.cssText = 'width:100%;justify-content:center;padding:10px;';
          _obData.folderSet = true;
        }
      } catch(e) {}
    });
  }
}

/* ── 설정 적용 ── */
// CO_KEY, CO_ICON_KEY는 state.js에서 이미 선언됨 (중복 선언 금지!)
// const CO_KEY, const CO_ICON_KEY 사용

async function applyOnboardingSettings() {
  try {
    const ci = JSON.parse(safeGetItem(CO_KEY) || '{}');
    if (_obData.coName) ci.coName = _obData.coName;
    if (_obData.coTel)  ci.coTel  = _obData.coTel;
    if (_obData.coIcon) { ci.coIcon = _obData.coIcon; safeSetItem(CO_ICON_KEY, _obData.coIcon); }
    safeSetItem(CO_KEY, JSON.stringify(ci));
    const coNameEl = document.getElementById('coName');
    const coTelEl  = document.getElementById('coTel');
    if (coNameEl && _obData.coName) coNameEl.value = _obData.coName;
    if (coTelEl  && _obData.coTel)  coTelEl.value  = _obData.coTel;
    if (_obData.coIcon) {
      const el = document.getElementById('logoIcon');
      if (el) el.textContent = _obData.coIcon;
    }
  } catch(e) {}
}

/* ── 체크 + 이벤트 ── */
function checkAndStartOnboarding() {
  const done = safeGetItem(ONBOARDING_DONE_KEY);
  console.log('[온보딩] DONE_KEY 값:', done);
  if (done === '1') {
    console.log('[온보딩] 이미 완료됨 - 스킵');
    return;
  }
  console.log('[온보딩] 시작 예약 (300ms 후)');
  setTimeout(() => {
    console.log('[온보딩] 시작!');
    showOnboarding();
  }, 300);
}

function bindOnboardingEvents() {
  console.log('[온보딩] bindOnboardingEvents 호출');
  const next = document.getElementById('obNext');
  const prev = document.getElementById('obPrev');
  const skip = document.getElementById('obSkip');
  console.log('[온보딩] 버튼 존재 여부:', { next: !!next, prev: !!prev, skip: !!skip });

  next?.addEventListener('click', onboardingNext);
  prev?.addEventListener('click', onboardingPrev);
  skip?.addEventListener('click', () => closeOnboarding(true));
}

// ★ 전역으로 노출 (HTML onclick에서 호출)
window.replayOnboarding = function() {
  document.getElementById('settingsModal')?.classList.remove('open');
  try {
    const ci = JSON.parse(safeGetItem(CO_KEY) || '{}');
    _obData.coName = ci.coName || '';
    _obData.coTel  = ci.coTel  || '';
    _obData.coIcon = safeGetItem(CO_ICON_KEY) || '❄️';
    _obData.folderSet = !!(typeof photoFolderHandle !== 'undefined' && photoFolderHandle);
  } catch(e) {}
  _obStep = 1;
  showOnboarding();
};

// ★ showOnboarding도 전역 노출 (디버깅용 - 콘솔에서 호출 가능)
window.showOnboarding = showOnboarding;
window.checkOnboardingState = function() {
  console.log('DONE_KEY:', safeGetItem(ONBOARDING_DONE_KEY));
  console.log('모달 요소:', !!document.getElementById('onboardingModal'));
  console.log('모달 클래스:', document.getElementById('onboardingModal')?.className);
};

function _initOnboarding() {
  console.log('[온보딩] _initOnboarding 호출');
  bindOnboardingEvents();
  checkAndStartOnboarding();
}

if (document.readyState === 'loading') {
  console.log('[온보딩] DOMContentLoaded 대기');
  document.addEventListener('DOMContentLoaded', _initOnboarding);
} else {
  console.log('[온보딩] 즉시 초기화 (readyState:', document.readyState, ')');
  _initOnboarding();
}
