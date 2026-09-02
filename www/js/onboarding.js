/* ═══════════════════════════════════════════════
   온보딩 (첫 실행 시 기본 세팅 안내)
═══════════════════════════════════════════════ */

const ONBOARDING_DONE_KEY = 'ac_onboarding_done_v2';   // v2: 분기형 온보딩 (2026-07-23)
const ONBOARDING_DONE_KEY_V1 = 'ac_onboarding_done_v1'; // v1 완료자는 v2 재노출 안 함
let _obStep = 1;
let _obPath = '';   // '' | 'new'(처음) | 'restore'(재설치 복구) | 'invite'(초대코드)
function _setObPath(p) { _obPath = p; window._obPath = p; }
let _obData = { coName: '', coTel: '', coIcon: '❄️', folderSet: false, coIndustryMajor: '', coIndustryMinor: '', coReportTitle: '', coUnitLabel: '', coStageLabel: '' };
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
  // ★ 로그인 슬라이드를 항상 맨 앞(1단계)에 둔다 (건너뛰기 가능).
  //   로그인 상태(구독 여부)에 따라 복구 화면의 옵션이 달라짐.
  if (_obPath === 'restore') return [
    { id: 'login',    render: renderSlideLogin },
    { id: 'branch',   render: renderSlideBranch },
    { id: 'restore',  render: renderSlideRestore },
    { id: 'backup',   render: renderSlideBackup },
  ];
  if (_obPath === 'invite') return [
    { id: 'login',    render: renderSlideLogin },
    { id: 'branch',   render: renderSlideBranch },
    { id: 'invite',   render: renderSlideInvite },
    { id: 'industry', render: renderSlideIndustry },
    { id: 'setup',    render: renderSlideSetup },
    { id: 'backup',   render: renderSlideBackup },
  ];
  if (_obPath === 'new') return [
    { id: 'login',    render: renderSlideLogin },
    { id: 'branch',   render: renderSlideBranch },
    { id: 'intro',    render: renderSlideIntro },
    { id: 'industry', render: renderSlideIndustry },
    { id: 'myname',   render: renderSlideMyName },
    { id: 'setup',    render: renderSlideSetup },
    { id: 'backup',   render: renderSlideBackup },
  ];
  return [
    { id: 'login',    render: renderSlideLogin },
    { id: 'branch',   render: renderSlideBranch },
  ];   // 분기 선택 전
}

function showOnboarding() {
  _obStep = 1;
  _setObPath('');
  _obData = { coName: '', coTel: '', coIcon: '❄️', folderSet: false, coIndustryMajor: '', coIndustryMinor: '', coReportTitle: '', coUnitLabel: '', coStageLabel: '', coBiz: '', coCeo: '', coAddr: '', coEmail: '', coBank: '', coNick: '' };
  // 기존 업체정보가 있으면 불러와 채움 (초기설정 다시하기 시 기존 값 연결)
  try {
    var _ci = JSON.parse((typeof safeGetItem === 'function' ? safeGetItem(CO_KEY) : localStorage.getItem(CO_KEY)) || '{}');
    ['coName','coTel','coBiz','coCeo','coAddr','coEmail','coBank','coIndustryMajor','coIndustryMinor','coReportTitle','coUnitLabel','coStageLabel'].forEach(function (k) { if (_ci[k]) _obData[k] = _ci[k]; });
    var _ic = (typeof CO_ICON_KEY !== 'undefined') ? (typeof safeGetItem === 'function' ? safeGetItem(CO_ICON_KEY) : localStorage.getItem(CO_ICON_KEY)) : null;
    if (_ic && _ic.length <= 4) _obData.coIcon = _ic;
  } catch (e) {}
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
  // ★ 분기 화면: '다음'은 숨기고(선택 버튼으로만 진행), '이전'은 남겨 로그인 등 앞 단계로 돌아갈 수 있게 함
  const _curSl = slides[_obStep - 1];
  if (_curSl && _curSl.id === 'branch') {
    if (nextBtn) nextBtn.style.display = 'none';
    if (prevBtn) prevBtn.style.display = _obStep > 1 ? 'inline-flex' : 'none';
  } else if (nextBtn) { nextBtn.style.display = ''; }

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
  const slides = getSlides();
  const total = slides.length;
  const curSlide = slides[_obStep - 1] || {};
  // ★ 내 이름 슬라이드: 필수 입력 (작업자 기본값으로 쓰임)
  if (curSlide.id === 'myname') {
    const nEl = document.getElementById('obMyName');
    const nm = ((nEl && nEl.value) || '').trim();
    if (!nm) {
      if (typeof showToast === 'function') showToast('이름을 입력해주세요 (작업자 이름으로 사용돼요)', 'err');
      if (nEl) nEl.focus();
      return;
    }
    _obData.myName = nm; if (!_obData.coNick) _obData.coNick = nm;
  }
  if (_obStep === total) {
    applyOnboardingSettings();
    closeOnboarding(true);
    finishOnboardingExtras();
    /* ★ 2026-09-02 보강 — 백업 폴더 지정(네이티브 피커)과 로그인 안내(모달)가
         각자 따로 setTimeout(800)/setTimeout(500)으로 거의 동시에 뜨다 보니, 폴더 피커가
         로그인 모달에 가려지거나 사용자가 뭐가 뭔지 모르고 폴더 피커 쪽을 취소해버려도
         AutoBackup.pickFolder()는 취소 시 에러를 띄우지 않아 조용히 "폴더 미지정" 상태로
         끝나던 문제(사용자 보고 2026-09-02). 순서를 매겨 겹치지 않게 한다 —
         폴더 피커가 끝난 뒤(성공/취소 상관없이)에만 로그인 모달을 띄운다. */
    setTimeout(function () {
      _obPickBackupFolderIfNeeded().then(function () {
        try {
          if (window.Cloud && Cloud.ready && !Cloud.user && typeof openCloudModal === 'function') {
            openCloudModal();
          }
        } catch (e) {}
      });
    }, 800);
    return;
  }
  _obStep++; renderOnboardingStep();
}
function onboardingPrev() { if (_obStep > 1) { _obStep--; renderOnboardingStep(); } }

/* ── 로그인 모달 열기: 온보딩(높은 z-index) 위로 '확실히' 띄운다.
   · openModal 내부에서 예외가 나도(.open 미부착) 여기서 직접 open 처리
   · 온보딩과 z-index가 같아 뒤에 깔리던 문제 → 맨 앞으로 재배치 ── */
function _obOpenLogin() {
  try {
    if (window.Cloud && Cloud.openModal) Cloud.openModal();
    else if (typeof openCloudModal === 'function') openCloudModal();
  } catch (e) { if (typeof showToast === 'function') showToast('로그인 창 오류: ' + (e && e.message), 'err'); }
  var cm = document.getElementById('cloudModal');
  if (cm) { try { document.body.appendChild(cm); } catch (e2) {} cm.classList.add('open'); }
  else if (typeof showToast === 'function') showToast('로그인 모듈을 불러오는 중이에요. 잠시 후 다시 시도해주세요', 'err');
}

/* ── 로그인 게이트: 로그인이 필요한 선택(서버복구·초대)을 미로그인 상태에서 고르면
      로그인 슬라이드(1단계)로 보내고, 로그인 완료되면 원래 가려던 단계로 자동 복귀 ── */
function _obRequireLogin(path, targetStep) {
  if (window.Cloud && Cloud.user) {            // 이미 로그인 → 바로 해당 단계로
    _setObPath(path); _obStep = targetStep; renderOnboardingStep();
    return;
  }
  window._obAfterLogin = { path: path, step: targetStep };
  _setObPath(path);                            // 경로 유지(로그인 슬라이드는 모든 경로의 1단계)
  _obStep = 1;                                 // 로그인 슬라이드로 이동
  renderOnboardingStep();
  if (typeof showToast === 'function') showToast('이 기능은 로그인이 필요해요', 'ok');
  _obOpenLogin();
}

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



/* ── 슬라이드: 로그인 (맨 앞, 건너뛰기 가능) ── */
function renderSlideLogin(c) {
  var isIn = !!(window.Cloud && Cloud.user);
  var isSub = false;
  try { isSub = !!(window.CloudBackup && CloudBackup.isSub && CloudBackup.isSub()); } catch (e) {}
  /* ★ 2026-08-24 문구 교체.
       예전엔 내세우는 이득이 '구독 계정의 서버 백업 복구' 하나뿐이었다. 그건 **예전에 구독했던 사람**에게만
       해당하는 말이라, 처음 설치한 사람에게는 로그인할 이유가 되지 못했다.
       게다가 같은 화면에서 '건너뛰세요'를 두 번 말하고 있었다(콜아웃 + 맨 아래).
       → 실제로 받는 것 두 가지를 보여주고, 건너뛰기 안내는 맨 아래 한 번만 남긴다.
       ⚠️ 횟수는 Subs 상수에서 읽는다. 여기에 숫자를 박아두면 정책이 바뀔 때 조용히 어긋난다. */
  var _fSched = 30, _fBlog = 5;
  try { if (window.Subs && Subs.freeInit) { _fSched = Subs.freeInit('sched'); _fBlog = Subs.freeInit('blog'); } } catch (e) {}
  /* ★ 2026-09-02 문구 정리 (사용자 지시).
       - "로그인하면 무료로 드려요" 서브타이틀 삭제 — 아래 캘아웃과 내용이 겹쳐 불필요.
       - "작업 기록이 서버에 보관돼 폰을 바꿔도 되살릴 수 있어요" 캘아웃 삭제 —
         서버 보관(백업/복구)은 무료 로그인이 아니라 구독(유료) 기능이라, 로그인만 하면
         받는 혜택인 것처럼 안내하면 사실과 다르다. 로그인 시 실제로 바로 받는 혜택인
         AI 일정등록/글작성 무료 횟수만 남긴다. */
  /* ★ 2026-09-02 "로그인됨 · 무료 — 작업 기록이 서버에 보관돼요"도 삭제(사용자 지시: 사실과 다름).
       서버 보관은 구독 전용이라, 무료 로그인 상태에는 그 혜택을 붙여 말하지 않는다. */
  var statusHtml = isIn
    ? '<div class="ob-callout" style="margin-top:12px;"><span class="ob-callout-num">✓</span><span class="ob-callout-txt">로그인됨' + (isSub ? ' · <b>구독 중</b> — 사진까지 서버에 보관돼요' : '') + '</span></div>'
    : '<div class="ob-callout" style="margin-top:12px;"><span class="ob-callout-num">1</span><span class="ob-callout-txt">로그인하면 <b>AI 일정등록 ' + _fSched + '회, AI 글작성 ' + _fBlog + '회</b> 무료 지급</span></div>';
  c.innerHTML = `
  <div class="ob-slide">
    <div class="ob-slide-ttl">로그인</div>
    ${isIn ? '<p class="ob-setup-sub">쓰던 데이터가 있다면 복구할 수 있어요</p>' : ''}
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:6px;">
      <button class="btn ${isIn ? 'b-ghost' : 'b-blue'}" id="obLoginBtn" style="width:100%;justify-content:center;padding:14px 16px;">
        ${isIn ? '✓ 로그인됨' : '☁️ 로그인 / 회원가입'}
      </button>
      ${isIn ? '' : `
      <div style="display:flex;align-items:center;gap:10px;margin:2px 0;">
        <div style="flex:1;height:1px;background:var(--bd);"></div>
        <span style="font-size:11px;color:var(--mu);">또는</span>
        <div style="flex:1;height:1px;background:var(--bd);"></div>
      </div>
      <button class="btn b-ghost" id="obGoogleBtn" style="width:100%;justify-content:center;gap:8px;padding:14px 16px;">
        🔵 Google로 계속하기
      </button>`}
    </div>
    ${statusHtml}
    <div style="font-size:12px;color:var(--mu);margin-top:14px;text-align:center;line-height:1.7;">지금 필요 없으면 <b>다음 →</b> 으로 건너뛰세요</div>
  </div>`;
  document.getElementById('obLoginBtn').onclick = function () {
    if (window.Cloud && Cloud.user) { if (typeof showToast === 'function') showToast('이미 로그인됨', 'ok'); return; }
    _obOpenLogin();
  };
  /* ★ 2026-08-23 간편 로그인을 첫 화면에 노출.
       이메일·비밀번호를 새로 만들어야 하는 부담 때문에 '건너뛰기'로 빠지는 이탈이 있었다(사용자 판단).
       모달을 한 번 더 여는 단계 없이 여기서 바로 구글 로그인이 되게 한다.
       ⚠️ 로그인에 성공하면 이 슬라이드를 다시 그려 '✓ 로그인됨'으로 바꿔야 한다
          (안 그러면 성공했는데 화면이 그대로라 또 누른다). */
  var _g = document.getElementById('obGoogleBtn');
  if (_g) _g.onclick = function () {
    if (!(window.Cloud && Cloud.signInWithGoogle)) {
      if (typeof showToast === 'function') showToast('로그인 모듈을 불러오는 중이에요. 잠시 후 다시 시도해주세요', 'err');
      return;
    }
    var b = this;
    b.disabled = true;
    var done = function () {
      b.disabled = false;
      try { if (typeof renderOnboardingStep === 'function') renderOnboardingStep(); } catch (e) {}
    };
    Cloud.signInWithGoogle().then(done, done);
  };
}

/* ── 슬라이드 0: 환영 + 분기 (v2 신규) ── */
function renderSlideBranch(c) {
  let icon = '❄️';
  try { const sv = (typeof CO_ICON_KEY !== 'undefined') ? localStorage.getItem(CO_ICON_KEY) : null; if (sv && sv.length <= 4) icon = sv; } catch (e) {}
  c.innerHTML = `
  <div class="ob-slide ob-slide-intro">
    <div class="ob-intro-icon">${icon}</div>
    <h2 class="ob-intro-title">현장 매니저</h2>
    <p class="ob-intro-sub">현장 사진부터 보고서·견적·일정까지 한 앱에서</p>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:18px;">
      <button class="btn b-blue" id="obBranchNew" style="width:100%;justify-content:flex-start;padding:14px 16px;text-align:left;">
        <span style="font-size:20px;margin-right:10px;">🆕</span>
        <span><b>처음 시작해요</b><br><small style="opacity:.85;font-weight:400;">기본 설정 몇 가지만 하면 바로 시작</small></span>
      </button>
      <button class="btn b-ghost" id="obBranchRestore" style="width:100%;justify-content:flex-start;padding:14px 16px;text-align:left;">
        <span style="font-size:20px;margin-right:10px;">☁️</span>
        <span><b>쓰던 데이터가 있어요</b><br><small style="opacity:.85;font-weight:400;">재설치·기기 변경 — 백업에서 복구</small></span>
      </button>
      <button class="btn b-ghost" id="obBranchInvite" style="width:100%;justify-content:flex-start;padding:14px 16px;text-align:left;">
        <span style="font-size:20px;margin-right:10px;">💌</span>
        <span><b>초대코드가 있어요</b><br><small style="opacity:.85;font-weight:400;">동료에게 초대받아 설치했어요</small></span>
      </button>
    </div>
    <div style="text-align:center;margin-top:16px;">
      <a href="javascript:void(0)" id="obIntroLink"
         style="font-size:12.5px;color:var(--mu);text-decoration:underline;">
        어떤 앱인지 먼저 볼래요 →
      </a>
    </div>
  </div>`;
  function go(p) { _setObPath(p); _obStep = 3; renderOnboardingStep(); }  // 1:로그인 2:분기 → 3:경로 첫 화면
  // ★ 2026-08-12: 처음 설치한 사람이 '이 앱이 뭐 하는 앱인지' 바로 확인할 수 있게 소개 페이지 링크
  var _obIntro = document.getElementById('obIntroLink');
  if (_obIntro) _obIntro.onclick = function () { if (window.openIntro) window.openIntro(); };
  document.getElementById('obBranchNew').onclick = function () { go('new'); };
  document.getElementById('obBranchRestore').onclick = function () { go('restore'); };
  document.getElementById('obBranchInvite').onclick = function () {
    // 초대(팀)는 구독 기능 → 미로그인은 로그인으로, 로그인+무료는 구독 안내, 구독자는 초대 화면
    if (!(window.Cloud && Cloud.user)) { _obRequireLogin('', 2); return; }  // 로그인 후 분기로 복귀
    var _isSub = false;
    try { _isSub = !!(window.CloudBackup && CloudBackup.isSub && CloudBackup.isSub()); } catch (e) {}
    if (!_isSub) {
      if (typeof showToast === 'function') showToast('라이트 플랜(월 4,900원)부터 팀 초대를 쓸 수 있어요', 'ok');
      if (window.Subs && Subs.openPlans) Subs.openPlans();
      return;
    }
    go('invite');
  };
}

/* ── 슬라이드: 업종 선택 ──────────────────────────────────
   ★ 2026-08-16 단순화 + 다중 업종
     예전: 대분류 select → 소분류 select (한 개만, 두 번 눌러야 함)
     지금: 하는 일을 **전부 눌러서** 고른다. 탭 한 번 = 선택, 다시 탭 = 해제.
           보고서 제목·호칭·아이콘은 고르는 즉시 자동으로 채워진다.
     현장 작업자는 에어컨 청소 + 설치 + 조명 + 선반처럼 여러 업종을 같이 한다.
     한 개만 고르게 하면 글쓰기 지침·견적서가 계속 섞여 나온다. */
function renderSlideIndustry(c) {
  var inds = (typeof getIndustriesWithCustom === 'function')
    ? getIndustriesWithCustom()
    : (typeof INDUSTRIES !== 'undefined' ? INDUSTRIES : []);

  if (!_obData._picked) _obData._picked = {};      // 'major|minor' → item
  if (!_obData._pickedCustom) _obData._pickedCustom = [];

  /* ⭐ 2026-08-16: 칩 목록은 업종 추가 시트와 **같은 함수**로 그린다(ProfilesUI.catalogChipsHtml).
       예전엔 여기서 따로 그려서, 업종을 늘리고 아이콘을 붙였을 때 이 화면만 옛 모양으로 남았다. */
  var groups = (window.ProfilesUI && ProfilesUI.catalogChipsHtml)
    ? ProfilesUI.catalogChipsHtml({
        chipClass: 'ob-ind-chip',
        isOn: function (k) { return !!_obData._picked[k]; }
      })
    : inds.map(function (m) {   // 폴백: 모듈 로드 실패 시에도 화면이 비지 않게
        var chips = (m.items || []).map(function (it) {
          var k = m.id + '|' + it.id;
          return '<button type="button" class="ob-ind-chip" data-k="' + k + '" data-major="' + m.id + '" data-minor="' + it.id + '" ' +
            'style="border:1px solid var(--bd);background:var(--sf2);color:var(--tx);font-size:13px;font-weight:600;' +
            'padding:9px 12px;border-radius:999px;cursor:pointer;line-height:1.2;">' + escHtml(it.label) + '</button>';
        }).join('');
        if (!chips) return '';
        return '<div style="margin-bottom:14px;"><div style="font-size:12px;font-weight:800;color:var(--mu);margin-bottom:7px;">' +
          escHtml(m.label) + '</div><div style="display:flex;flex-wrap:wrap;gap:7px;">' + chips + '</div></div>';
      }).join('');

  /* 재설치 복구로 들어와 이미 업종이 있으면 맨 위에 보여준다(시트와 같은 모양) */
  var mineGroup = '';
  try {
    if (window.Profiles && window.ProfilesUI && ProfilesUI.mineChipsHtml) {
      Profiles.ensure();
      var _mine = Profiles.list();
      if (_mine.length && !(_mine.length === 1 && !_mine[0].industryMinor && _mine[0].name === '기본')) {
        var _keep = {}; _mine.forEach(function (p) { _keep[p.id] = true; });
        mineGroup = ProfilesUI.mineChipsHtml(_mine, _keep, 'ob-mine-chip');
      }
    }
  } catch (e) {}

  c.innerHTML = `
  <div class="ob-slide">
    <div class="ob-slide-ttl">어떤 일을 하세요?</div>
    <p class="ob-setup-sub">하시는 일을 <b>전부</b> 눌러주세요 · 여러 개 괜찮아요<br><small style="color:var(--mu);">보고서 제목·호칭은 자동으로 맞춰집니다 · ⚙️설정에서 언제든 변경</small></p>
    <div style="text-align:left;margin-bottom:12px;">
      <label class="ob-setup-label">앱 아이콘</label>
      <div class="ob-setup-icons">
        <button class="ob-icon-opt" data-ic="❄️">❄️</button><button class="ob-icon-opt" data-ic="🔧">🔧</button><button class="ob-icon-opt" data-ic="🏠">🏠</button><button class="ob-icon-opt" data-ic="🧼">🧼</button><button class="ob-icon-opt" data-ic="⚡">⚡</button><button class="ob-icon-opt" data-ic="🛠️">🛠️</button><button class="ob-icon-opt" data-ic="🎨">🎨</button><button class="ob-icon-opt" data-ic="🚗">🚗</button>
      </div>
    </div>
    <div id="obIndBar" style="display:none;background:var(--sf2);border-radius:10px;padding:9px 11px;margin-bottom:12px;font-size:12px;line-height:1.7;"></div>
    <div style="max-height:44vh;overflow-y:auto;-webkit-overflow-scrolling:touch;text-align:left;">${mineGroup}${groups}</div>
    <div style="border-top:1px solid var(--bd);padding-top:11px;margin-top:11px;text-align:left;">
      <div style="font-size:12px;font-weight:700;color:var(--mu);margin-bottom:6px;">목록에 없나요?</div>
      <div style="display:flex;gap:7px;">
        <input class="ob-setup-input" id="obIndCustom" placeholder="예: 실링팬 설치" style="flex:1;min-width:0;margin:0;">
        <button type="button" class="btn b-ghost" id="obIndCustomAdd" style="flex-shrink:0;">추가</button>
      </div>
    </div>
  </div>`;

  // 등록된 내 업종 칩은 온보딩에서 끄지 않는다(설정에서 관리) — 눌러도 아무 일 없게
  document.querySelectorAll('.ob-mine-chip').forEach(function (b2) {
    b2.addEventListener('click', function () {
      if (typeof showToast === 'function') showToast('이미 등록된 업종이에요 — 설정에서 관리할 수 있어요', 'ok');
    });
  });

  document.querySelectorAll('.ob-icon-opt').forEach(function (btn) {
    if (btn.dataset.ic === _obData.coIcon) btn.classList.add('selected');
    btn.addEventListener('click', function () {
      document.querySelectorAll('.ob-icon-opt').forEach(function (b) { b.classList.remove('selected'); });
      btn.classList.add('selected');
      _obData.coIcon = btn.dataset.ic;
    });
  });

  function refreshBar() {
    var bar = document.getElementById('obIndBar');
    if (!bar) return;
    var names = Object.keys(_obData._picked).map(function (k) { return _obData._picked[k].label; })
                  .concat(_obData._pickedCustom);
    if (!names.length) { bar.style.display = 'none'; return; }
    bar.style.display = 'block';
    bar.innerHTML = '<b>선택함 ' + names.length + '개</b> · ' + escHtml(names.join(' , '));
  }

  // 첫 번째로 고른 업종이 기본 업종이 된다(보고서 제목·호칭의 기본값)
  function syncPrimary() {
    var ks = Object.keys(_obData._picked);
    if (ks.length) {
      var k = ks[0], it = _obData._picked[k];
      _obData.coIndustryMajor = k.split('|')[0];
      _obData.coIndustryMinor = k.split('|')[1];
      _obData.coReportTitle = it.title || '';
      _obData.coUnitLabel = it.unit || '';
      _obData.coStageLabel = it.stage || '';
    } else if (_obData._pickedCustom.length) {
      _obData.coIndustryMajor = 'custom';
      _obData.coIndustryMinor = '';
      _obData.coReportTitle = _obData._pickedCustom[0] + ' 보고서';
      _obData.coUnitLabel = ''; _obData.coStageLabel = '';
    } else {
      _obData.coIndustryMajor = ''; _obData.coIndustryMinor = '';
      _obData.coReportTitle = ''; _obData.coUnitLabel = ''; _obData.coStageLabel = '';
    }
  }

  document.querySelectorAll('.ob-ind-chip').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.dataset.k;
      if (_obData._picked[k]) { delete _obData._picked[k]; }
      else {
        var major = inds.find(function (i) { return i.id === b.dataset.major; });
        var item = major ? (major.items || []).find(function (it) { return it.id === b.dataset.minor; }) : null;
        if (item) _obData._picked[k] = item;
      }
      var on = !!_obData._picked[k];
      b.style.background = on ? 'var(--ac)' : 'var(--sf2)';
      b.style.color = on ? '#fff' : 'var(--tx)';
      syncPrimary();
      refreshBar();
    });
  });

  var addBtn = document.getElementById('obIndCustomAdd');
  var addInp = document.getElementById('obIndCustom');
  if (addBtn && addInp) {
    addBtn.addEventListener('click', function () {
      var v = (addInp.value || '').trim();
      if (!v) { addInp.focus(); return; }
      if (_obData._pickedCustom.indexOf(v) < 0) _obData._pickedCustom.push(v);
      addInp.value = '';
      syncPrimary();
      refreshBar();
    });
    addInp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); }
    });
  }
  refreshBar();
}

/* 온보딩에서 고른 업종들을 실제 프로필로 만든다 (finishOnboarding 에서 호출) */
function obCommitIndustries() {
  try {
    if (!window.Profiles) return;
    Profiles.ensure();
    var picked = _obData._picked || {};
    var first = null;
    Object.keys(picked).forEach(function (k) {
      var id = Profiles.addFromIndustry(k.split('|')[0], picked[k]);
      if (id && !first) first = id;
    });
    (_obData._pickedCustom || []).forEach(function (nm) {
      var id = Profiles.addCustom(nm);
      if (id && !first) first = id;
    });
    if (first) Profiles.setCurrent(first);
    Profiles.syncCoKey();
  } catch (e) { console.warn('[온보딩] 업종 등록 실패', e && e.message); }
}

/* ── 슬라이드: 내 이름 (v2 신규 — 작업자 기본값용) ── */
function renderSlideMyName(c) {
  c.innerHTML = `
  <div class="ob-slide">
    <div class="ob-slide-ttl">이름을 알려주세요</div>
    <p class="ob-setup-sub">작업 저장 시 <b>작업자 이름</b>으로 자동 입력돼요<br><small style="color:var(--mu);">팀 공유를 쓰면 표시 이름(닉네임)으로도 사용됩니다</small></p>
    <div class="ob-setup-form">
      <label class="ob-setup-label">내 이름 (별명도 좋아요) <span style="color:var(--dn);">*</span></label>
      <input class="ob-setup-input" id="obMyName" type="text" maxlength="20" placeholder="예: 홍길동" value="${escHtml(_obData.myName || _obData.coNick || '')}">
    </div>
  </div>`;
  var el = document.getElementById('obMyName');
  if (el) el.addEventListener('input', function (e) { _obData.myName = e.target.value; _obData.coNick = e.target.value; });
}

/* ── 슬라이드: 자동백업 선택 (v2 신규 — 팝업 대체) ── */
function renderSlideBackup(c) {
  if (_obData.autoBackup !== '1' && _obData.autoBackup !== '0') _obData.autoBackup = '0';
  c.innerHTML = `
  <div class="ob-slide">
    <div class="ob-slide-ttl">자동백업을 사용할까요?</div>
    <p class="ob-setup-sub">앱을 벗어날 때마다 작업·사진을 지정 폴더로 자동 복사해<br>앱을 삭제해도 데이터를 지킬 수 있어요</p>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px;">
      <button class="btn ob-bk-opt" data-v="1" style="width:100%;justify-content:flex-start;padding:14px 16px;text-align:left;">
        <span style="font-size:20px;margin-right:10px;">📲</span>
        <span><b>사용하기</b><br><small style="opacity:.85;font-weight:400;">데이터 안전 최우선 · ⚠️ 사진을 한 번 더 저장해 저장공간 최대 2배 필요</small></span>
      </button>
      <button class="btn ob-bk-opt" data-v="0" style="width:100%;justify-content:flex-start;padding:14px 16px;text-align:left;">
        <span style="font-size:20px;margin-right:10px;">🚫</span>
        <span><b>사용 안 함</b><br><small style="opacity:.85;font-weight:400;">저장공간 절약 · 설정 → 데이터 백업/복원에서 언제든 켤 수 있어요</small></span>
      </button>
    </div>

    ${ (window.hasChatRoom && window.hasChatRoom()) ? `
    <!-- ★ 2026-08-17 마지막 슬라이드에 사용자 오픈채팅방 안내.
         주소는 js/legal.js 의 OPENCHAT_URL 한 줄. 없으면 이 블록 자체가 안 그려진다. -->
    <div style="margin-top:20px;padding-top:15px;border-top:1px solid var(--bd);">
      <div style="font-size:12.5px;font-weight:800;color:var(--ac);margin-bottom:4px;">💬 사용자 오픈채팅방</div>
      <div style="font-size:11px;color:var(--mu);line-height:1.6;margin-bottom:9px;">
        같은 일 하는 기사님들이 모여 있어요.<br>
        쓰다가 막히는 것·불편한 것 남겨주시면 만든 사람이 직접 봅니다.
      </div>
      <button type="button" id="obOpenChat" class="btn b-ghost" style="width:100%;justify-content:center;font-size:12px;">카카오톡 오픈채팅방 들어가기</button>
      <div style="font-size:10px;color:var(--mu);text-align:center;margin-top:6px;">나중에 ⚙️설정 → 앱 정보에서도 들어갈 수 있어요</div>
    </div>` : '' }
  </div>`;

  var _obChat = document.getElementById('obOpenChat');
  /* 카카오톡/브라우저로 넘어갔다가 돌아와도 온보딩은 그대로 떠 있다(오버레이라 유지됨) */
  if (_obChat) _obChat.onclick = function () {
    try { if (window.openChatRoom) window.openChatRoom(); } catch (e) {}
  };
  function paint() {
    document.querySelectorAll('.ob-bk-opt').forEach(function (b) {
      var on = b.dataset.v === _obData.autoBackup;
      b.classList.toggle('b-blue', on);
      b.classList.toggle('b-ghost', !on);
    });
  }
  document.querySelectorAll('.ob-bk-opt').forEach(function (b) {
    b.onclick = function () { _obData.autoBackup = b.dataset.v; paint(); };
  });
  paint();
}

/* ── 슬라이드: 재설치 복구 (v2 신규) ── */
function renderSlideRestore(c) {
  // ★ '서버에서 복구'는 항상 보여준다. 클릭 시:
  //   · 미로그인   → 로그인 슬라이드로 안내
  //   · 로그인+무료 → 구독 안내 페이지
  //   · 로그인+구독 → 서버 복구 진행
  var serverBtnHtml = `
      <button class="btn b-ghost" id="obRestoreServer" style="width:100%;justify-content:flex-start;padding:14px 16px;text-align:left;">
        <span style="font-size:20px;margin-right:10px;">☁️</span>
        <span><b>서버에서 복구</b><br><small style="opacity:.85;font-weight:400;">구독 계정 — 서버에 백업된 작업을 받아와요</small></span>
      </button>`;
  c.innerHTML = `
  <div class="ob-slide">
    <div class="ob-slide-ttl">데이터 복구</div>
    <p class="ob-setup-sub">쓰시던 데이터를 되찾아올게요</p>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <button class="btn b-blue" id="obRestoreLocal" style="width:100%;justify-content:flex-start;padding:14px 16px;text-align:left;">
        <span style="font-size:20px;margin-right:10px;">📁</span>
        <span><b>백업 폴더에서 복원</b><br><small style="opacity:.85;font-weight:400;">자동백업·백업 폴더를 지정해뒀다면 — 사진 포함 · 무료</small></span>
      </button>
      ${serverBtnHtml}
    </div>
    <div style="font-size:12px;color:var(--mu);margin-top:14px;text-align:center;line-height:1.7;">복구가 끝나면 아래 <b>다음</b>을 눌러주세요<br><a href="#" id="obRestoreNone" style="color:var(--ac);">복구할 데이터가 없어요 → 처음부터 시작</a></div>
  </div>`;
  document.getElementById('obRestoreLocal').onclick = function () {
    if (typeof importBackupFromPicker === 'function') importBackupFromPicker();
    else if (typeof restoreBackupFromFolder === 'function') restoreBackupFromFolder();
    else if (typeof showToast === 'function') showToast('복원 모듈을 찾을 수 없어요', 'err');
  };
  var _srvBtn = document.getElementById('obRestoreServer');
  if (_srvBtn) _srvBtn.onclick = function () {
    if (!(window.Cloud && Cloud.user)) {
      // 미로그인 → 로그인 슬라이드로 보내고, 로그인 후 이 복구 화면으로 자동 복귀
      _obRequireLogin('restore', 3);
      return;
    }
    var _isSub = false;
    try { _isSub = !!(window.CloudBackup && CloudBackup.isSub && CloudBackup.isSub()); } catch (e) {}
    if (!_isSub) {
      // 로그인+무료 → 구독 안내 페이지
      if (typeof showToast === 'function') showToast('구독하면 서버 복구를 쓸 수 있어요', 'ok');
      if (window.Subs && Subs.openPlans) Subs.openPlans();
      return;
    }
    // ★ 서버 복구가 끝나면 자동으로 다음 단계(자동백업)로 진행
    if (!window._obRestoreAdvHooked) {
      window._obRestoreAdvHooked = true;
      document.addEventListener('cloudbackup-restored', function _adv() {
        document.removeEventListener('cloudbackup-restored', _adv);
        window._obRestoreAdvHooked = false;
        if (_obPath === 'restore') {          // 아직 복구 슬라이드일 때만
          var sl = getSlides();
          if (_obStep < sl.length) { _obStep++; renderOnboardingStep(); }
        }
      });
    }
    if (window.CloudBackup && CloudBackup.checkAndOfferRestore) CloudBackup.checkAndOfferRestore(true, { notify: true });
  };
  document.getElementById('obRestoreNone').onclick = function (e) {
    e.preventDefault();
    _setObPath('new'); _obStep = 3; renderOnboardingStep();
  };
}

/* ── 슬라이드: 초대코드 (v2 신규) ── */
function renderSlideInvite(c) {
  var isIn = !!(window.Cloud && Cloud.user);
  var nick = _obData.coNick || '';
  if (!nick && isIn) { try { var p = CloudShare.myProfile(); if (p && p.name) nick = p.name; } catch (e) {} }
  if (nick) { _obData.coNick = nick; if (!_obData.myName) _obData.myName = nick; }
  c.innerHTML = `
  <div class="ob-slide">
    <div class="ob-slide-ttl">팀 초대코드로 시작</div>
    <div class="ob-callout" style="margin-bottom:12px;"><span class="ob-callout-num">💳</span><span class="ob-callout-txt">팀 공유는 <b>구독 기능</b>이에요.<br>초대받아 <b>참여</b>만 한다면 <b>라이트 플랜(월 4,900원)</b>이면 충분해요.</span></div>
    <div class="ob-setup-form">
      <button type="button" class="btn ${isIn ? 'b-ghost' : 'b-blue'}" id="obInvLogin" style="width:100%;justify-content:center;margin-bottom:10px;">${isIn ? '✓ 로그인됨' : '① ☁️ 로그인'}</button>
      <label class="ob-setup-label">② 팀에 표시될 이름</label>
      <input class="ob-setup-input" id="obInvNick" type="text" maxlength="20" placeholder="예: 홍길동" value="${escHtml(nick)}">
      <label class="ob-setup-label">③ 초대코드 (6자리)</label>
      <input class="ob-setup-input" id="obInvCode" type="text" maxlength="6" placeholder="예: AB12CD" style="text-transform:uppercase;letter-spacing:3px;" autocapitalize="characters">
      <button type="button" class="btn b-green" id="obInvJoin" style="width:100%;justify-content:center;margin-top:10px;">👥 팀 참여하기</button>
      <div style="font-size:12px;color:var(--mu);margin-top:10px;text-align:center;line-height:1.7;">참여가 끝나면 아래 <b>다음</b>으로 기본 설정을 이어가요<br>지금 어려우면 그냥 다음 — 설정 → 팀 공유에서 언제든 참여 가능</div>
    </div>
  </div>`;
  document.getElementById('obInvLogin').onclick = function () {
    if (window.Cloud && Cloud.user) { if (typeof showToast === 'function') showToast('이미 로그인됨', 'ok'); return; }
    if (window.Cloud && Cloud.openModal) Cloud.openModal();
  };
  var nickEl = document.getElementById('obInvNick');
  if (nickEl) nickEl.addEventListener('input', function (e) { _obData.coNick = e.target.value; _obData.myName = e.target.value; });
  document.getElementById('obInvJoin').onclick = async function () {
    if (!(window.Cloud && Cloud.user)) { if (typeof showToast === 'function') showToast('먼저 로그인해주세요', 'err'); return; }
    var nm = ((nickEl && nickEl.value) || '').trim();
    if (!nm) { if (typeof showToast === 'function') showToast('팀에 표시될 이름을 입력해주세요', 'err'); if (nickEl) nickEl.focus(); return; }
    _obData.coNick = nm; _obData.myName = nm;
    try { if (window.CloudShare && CloudShare.saveMyProfile) { var col = (CloudShare.myProfile && CloudShare.myProfile().color) || ''; CloudShare.saveMyProfile(nm, col); } } catch (e) {}
    var code = ((document.getElementById('obInvCode') || {}).value || '').trim();
    if (!code) { if (typeof showToast === 'function') showToast('초대코드를 입력해주세요', 'err'); return; }
    if (window.CloudTeams && CloudTeams.joinByCode) await CloudTeams.joinByCode(code);
    else if (typeof showToast === 'function') showToast('팀 모듈을 찾을 수 없어요', 'err');
  };
}

/* ── 슬라이드 1: 소개 ── */
function renderSlideIntro(c) {
  // ★ 업종 설정 반영한 제목 (1.263)
  let introTitle = '현장 매니저';
  try {
    const ci = JSON.parse(localStorage.getItem(typeof CO_KEY !== 'undefined' ? CO_KEY : 'ac_company_info') || '{}');
    const rt = (ci.coReportTitle || '').trim();
    if (rt) {
      const industry = rt.replace(/\s*작업\s*보고서\s*$/, '').replace(/\s*보고서\s*$/, '').trim();
      if (industry) introTitle = '현장 매니저';
    }
  } catch(e) {}
  let introIcon = '❄️';
  try {
    const sv = (typeof CO_ICON_KEY !== 'undefined') ? localStorage.getItem(CO_ICON_KEY) : null;
    if (sv && sv.length <= 4) introIcon = sv;  // 이모지만 (dataURL 제외)
  } catch(e) {}
  let unitWord = '현장';
  try {
    const ci2 = JSON.parse(localStorage.getItem(typeof CO_KEY !== 'undefined' ? CO_KEY : 'ac_company_info') || '{}');
    const u = (ci2.coUnitLabel || '').trim();
    if (u) unitWord = u;
  } catch(e) {}
  c.innerHTML = `
  <div class="ob-slide ob-slide-intro">
    <div class="ob-intro-icon">${introIcon}</div>
    <h2 class="ob-intro-title">${introTitle}</h2>
    <p class="ob-intro-sub">현장 사진부터 보고서·견적·일정까지<br>한 앱에서</p>
    <div class="ob-intro-feats">
      <div class="ob-feat"><span>📸</span><div><b>작업 전·후 사진 정리</b><br><small>${unitWord}별로 체계적 관리</small></div></div>
      <div class="ob-feat"><span>📄</span><div><b>PDF · JPG 보고서</b><br><small>전문 보고서 즉시 출력</small></div></div>
      <div class="ob-feat"><span>📅</span><div><b>스케줄 달력</b><br><small>일정 등록·이동, 월별 한눈에</small></div></div>
      <div class="ob-feat"><span>🧾</span><div><b>견적서 · 거래명세서</b><br><small>사업자등록증 촬영하면 자동 입력</small></div></div>
      <div class="ob-feat"><span>✍️</span><div><b>AI 글작성</b><br><small>블로그·당근·인스타·문자 견적</small></div></div>
      <div class="ob-feat"><span>💬</span><div><b>일정 공유 · 채팅</b><br><small>동료와 일정·사진 실시간 공유</small></div></div>
      <div class="ob-feat"><span>📞</span><div><b>전화·문자·길안내</b><br><small>고객 정보에서 바로 연결</small></div></div>
      <div class="ob-feat"><span>👥</span><div><b>고객 자동 관리</b><br><small>전화번호로 이력 추적</small></div></div>
    </div>
    <div class="ob-intro-hint">👉 다음에서 기본 설정 몇 가지만 하면 바로 시작해요</div>
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
    <div class="ob-slide-ttl">업체 정보</div>
    <p class="ob-setup-sub">보고서·견적서에 표시될 정보예요 <b>(건너뛰어도 돼요)</b><br><small style="color:var(--mu);">⚙️설정에서 언제든 입력·변경 가능</small></p>
    <button type="button" id="obLoginBtn" class="btn b-blue" style="width:100%;justify-content:center;margin-bottom:8px;">☁️ 기존 계정으로 로그인 · 업체정보 불러오기</button>
    <button type="button" id="obBizFill" class="btn b-ghost" style="width:100%;justify-content:center;margin-bottom:4px;">📄 사업자등록증으로 자동입력</button>
    <input type="file" id="obBizFillFile" accept="image/*" style="display:none;">
    <div style="font-size:11px;color:var(--mu);margin-bottom:12px;line-height:1.5;text-align:center;">찍기만 하면 상호·등록번호·대표자·주소가 채워져요</div>
    <div class="ob-setup-form">
      <label class="ob-setup-label">업체명</label>
      <input class="ob-setup-input" id="obCoName" type="text" placeholder="예: 한빛에어컨" value="">
      <label class="ob-setup-label">대표 연락처</label>
      <input class="ob-setup-input" id="obCoTel" type="text" inputmode="tel" placeholder="010-1234-5678" value="">
      <label class="ob-setup-label">사업자 등록번호 <span style="color:var(--mu);font-size:11px;">(견적·명세서)</span></label>
      <input class="ob-setup-input" id="obCoBiz" type="text" inputmode="numeric" placeholder="000-00-00000" value="">
      <label class="ob-setup-label">대표자 성명</label>
      <input class="ob-setup-input" id="obCoCeo" type="text" placeholder="예: 홍길동" value="">
      <label class="ob-setup-label">주소</label>
      <input class="ob-setup-input" id="obCoAddr" type="text" placeholder="사업장 주소" value="">
      <label class="ob-setup-label">이메일</label>
      <input class="ob-setup-input" id="obCoEmail" type="email" placeholder="example@email.com" value="">
      <label class="ob-setup-label">입금계좌 <span style="color:var(--mu);font-size:11px;">(거래명세서)</span></label>
      <input class="ob-setup-input" id="obCoBank" type="text" placeholder="예: 국민 123456-01-234567" value="">
      ${ hasFolder ? '' : `<div class="ob-callout" style="margin-top:14px;"><span class="ob-callout-num">📁</span><span class="ob-callout-txt">사진·데이터 저장을 위해 <b>폴더 접근 권한</b>이 필요할 수 있어요. 권한 요청이 나타나면 <b>허용</b>해 주세요.</span></div>` }
    </div>
  </div>`;

  var _obLogin = document.getElementById('obLoginBtn');
  if (_obLogin) _obLogin.onclick = function () {
    if (window.Cloud && Cloud.user) { if (typeof showToast === 'function') showToast('이미 로그인됨', 'ok'); return; }
    if (window.Cloud && Cloud.openModal) Cloud.openModal();
    else if (typeof showToast === 'function') showToast('로그인 모듈 로드 안됨', 'err');
  };
  const nameEl = document.getElementById('obCoName');
  const telEl  = document.getElementById('obCoTel');
  if (nameEl) { nameEl.value = _obData.coName || ''; nameEl.addEventListener('input', e => { _obData.coName = e.target.value; }); }
  if (telEl)  { telEl.value  = _obData.coTel  || ''; telEl.addEventListener('input', e => {
    const raw = e.target.value.replace(/[^\d]/g,'');
    if (raw.length===11) e.target.value=`${raw.slice(0,3)}-${raw.slice(3,7)}-${raw.slice(7)}`;
    else if (raw.length===10) e.target.value=`${raw.slice(0,3)}-${raw.slice(3,6)}-${raw.slice(6)}`;
    _obData.coTel = e.target.value;
  }); }
  [['obCoBiz','coBiz'],['obCoCeo','coCeo'],['obCoAddr','coAddr'],['obCoEmail','coEmail'],['obCoBank','coBank']].forEach(function (pr) {
    var el = document.getElementById(pr[0]);
    if (el) { el.value = _obData[pr[1]] || ''; el.addEventListener('input', function (e) { _obData[pr[1]] = e.target.value; }); }
  });

  // ★ 사업자등록증 자동입력 (2026-08-09) — 입력칸을 채운 뒤 _obData 에도 반영
  try {
    if (window.BizFill && BizFill.wire) {
      BizFill.wire('obBizFill',
        { name: 'obCoName', bizNo: 'obCoBiz', ceo: 'obCoCeo', addr: 'obCoAddr', tel: 'obCoTel' },
        function (fixed) {
          if (fixed.name)  _obData.coName = fixed.name;
          if (fixed.bizNo) _obData.coBiz  = fixed.bizNo;
          if (fixed.ceo)   _obData.coCeo  = fixed.ceo;
          if (fixed.addr)  _obData.coAddr = fixed.addr;
          if (fixed.tel)   _obData.coTel  = document.getElementById('obCoTel').value;
        });
    }
  } catch (e) {}
}

/* ── 설정 적용 ── */
// CO_KEY, CO_ICON_KEY는 state.js에서 이미 선언됨 (중복 선언 금지!)
// const CO_KEY, const CO_ICON_KEY 사용

async function applyOnboardingSettings() {
  try {
    const ci = JSON.parse(safeGetItem(CO_KEY) || '{}');
    if (_obData.coName) ci.coName = _obData.coName;
    if (_obData.coTel)  ci.coTel  = _obData.coTel;
    if (_obData.coBiz)   ci.coBiz   = _obData.coBiz;
    if (_obData.coCeo)   ci.coCeo   = _obData.coCeo;
    if (_obData.coAddr)  ci.coAddr  = _obData.coAddr;
    if (_obData.coEmail) ci.coEmail = _obData.coEmail;
    if (_obData.coBank)  ci.coBank  = _obData.coBank;
    if (_obData.coIcon) { ci.coIcon = _obData.coIcon; safeSetItem(CO_ICON_KEY, _obData.coIcon); }
    // 업종 정보 저장
    if (_obData.coIndustryMajor) ci.coIndustryMajor = _obData.coIndustryMajor;
    if (_obData.coIndustryMinor) ci.coIndustryMinor = _obData.coIndustryMinor;
    if (_obData.coReportTitle)   ci.coReportTitle   = _obData.coReportTitle;
    if (_obData.coUnitLabel)     ci.coUnitLabel     = _obData.coUnitLabel;
    if (_obData.coStageLabel)    ci.coStageLabel    = _obData.coStageLabel;
    safeSetItem(CO_KEY, JSON.stringify(ci));
    /* ★ 2026-08-16: 온보딩에서 입력한 업체정보를 사업자로, 고른 업종들을 프로필로 만든다.
         순서 중요 — 업체정보(사업자)를 먼저 넣어야 프로필이 그 사업자를 참조한다. */
    try { if (window.Profiles) Profiles.applyCoObject(ci); } catch (e) {}
    try { if (typeof obCommitIndustries === 'function') obCommitIndustries(); } catch (e) {}
    // 닉네임 → 로그인돼 있으면 클라우드 프로필(users/{uid}.nickname)로 저장
    try {
      if (_obData.coNick && window.Cloud && Cloud.user && window.CloudShare && CloudShare.saveMyProfile) {
        var _col = (CloudShare.myProfile && CloudShare.myProfile().color) || '';
        CloudShare.saveMyProfile(_obData.coNick, _col);
      }
    } catch (e) {}
    /* ★ 2026-09-02 보강 — 온보딩 직후(재시작 없이 같은 세션) 바로 작업을 저장하면
         사업자정보가 일부만 저장되던 버그(사용자 보고).
         여기서 원래 coName·coTel 딱 두 칸만 DOM에 채워줬는데, 사업자번호·대표자·주소·
         이메일·홈페이지·소개·계좌 등 나머지는 아무도 안 채워서 앱을 재시작하기 전까지
         (state.js init()이 ac_co_v2에서 다시 읽어줄 때까지) 비어 있었다.
         그 사이 저장(saveToFolder)·임시저장(doSave)·세션 자동저장(folder.js)이 전부
         '지금 DOM 값'을 그대로 작업 스냅샷에 박아 넣으므로, 그 창(window) 안에 저장한
         작업엔 사업자정보가 반쪽만(이름·전화만) 남게 됐다.
         populateIndustryDropdowns()가 방금 위에서 Profiles.applyCoObject(ci)로 반영된
         전체 사업자정보를 Profiles.info()에서 그대로 다시 읽어와 DOM 전부를 채워주므로,
         있으면 그걸 쓰고 없으면(구버전 등) 기존 2칸짜리 폴백으로 동작한다. */
    if (typeof populateIndustryDropdowns === 'function') {
      populateIndustryDropdowns();
    } else {
      const coNameEl = document.getElementById('coName');
      const coTelEl  = document.getElementById('coTel');
      if (coNameEl && _obData.coName) coNameEl.value = _obData.coName;
      if (coTelEl  && _obData.coTel)  coTelEl.value  = _obData.coTel;
    }
    if (_obData.coIcon) {
      const el = document.getElementById('logoIcon');
      if (el) el.textContent = _obData.coIcon;
    }
    // 업종별 호칭·제목 즉시 적용
    if (typeof applyCustomLabels === 'function') applyCustomLabels();
  } catch(e) {}
}

/* ── 완료 후처리 (v2): 작업자 이름 주입 + 자동백업 선택 반영 ── */
function finishOnboardingExtras() {
  // 내 이름 → 작업자 이력(ac_worker_names) 주입: 저장 시 작업자 기본값으로 자동 채워짐
  try {
    var nm = (_obData.myName || _obData.coNick || '').trim();
    if (nm && window.WorkerCombo && WorkerCombo.record) {
      WorkerCombo.record(nm);
      if (WorkerCombo.refresh) WorkerCombo.refresh();
    }
  } catch (e) {}
  // 자동백업 on/off 값 저장 + 상태 표시 갱신 (동기 부분만 — 폴더 피커는 아래 별도 함수에서, 로그인 모달과 순서를 맞춰 실행)
  try {
    if (_obData.autoBackup === '1' || _obData.autoBackup === '0') {
      localStorage.setItem('auto_backup_enabled', _obData.autoBackup);
      if (window.AutoBackup && AutoBackup.refreshStatus) AutoBackup.refreshStatus();
    }
  } catch (e) {}
}

// 온보딩에서 "자동백업 사용하기"를 골랐고 아직 폴더가 없으면 네이티브 폴더 피커를 띄운다.
// (성공/취소/에러 상관없이 항상 resolve — 호출부가 이어서 로그인 모달을 띄울 수 있게)
function _obPickBackupFolderIfNeeded() {
  try {
    if (_obData.autoBackup === '1' && window.AutoBackup && AutoBackup.hasFolder && !AutoBackup.hasFolder()) {
      return Promise.resolve(AutoBackup.pickFolder()).catch(function () {});
    }
  } catch (e) {}
  return Promise.resolve();
}

/* ── 체크 + 이벤트 ── */
function checkAndStartOnboarding() {
  // ★ v1 완료자(기존 사용자)는 v2 온보딩을 다시 보지 않음
  if (safeGetItem(ONBOARDING_DONE_KEY) !== '1' && safeGetItem(ONBOARDING_DONE_KEY_V1) === '1') {
    safeSetItem(ONBOARDING_DONE_KEY, '1');
  }
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
  // 설정 모달은 닫지 않는다 (온보딩 z-index 600 > 설정 300 이라 위에 뜸)
  try {
    const ci = JSON.parse(safeGetItem(CO_KEY) || '{}');
    _obData.coName = ci.coName || '';
    _obData.coTel  = ci.coTel  || '';
    _obData.coIcon = safeGetItem(CO_ICON_KEY) || '❄️';
    _obData.folderSet = !!(typeof photoFolderHandle !== 'undefined' && photoFolderHandle);
  } catch(e) {}
  _obStep = 1;
  showOnboarding();
  _setObPath('new');
  _obStep = 4;   // 로그인·분기·소개 건너뛰고 업종부터
  renderOnboardingStep();
};

// ★ 온보딩 중 로그인하면 서버 업체정보 자동채움 (CloudBackup.pull이 ac_co_v2 채운 뒤 재렌더)
document.addEventListener('cloud-auth-changed', function (e) {
  if (!(e && e.detail && e.detail.user)) return;
  var modal = document.getElementById('onboardingModal');
  if (!modal || !modal.classList.contains('open')) return;
  // 로그인 게이트(_obRequireLogin)로 왔다면, 로그인 완료 후 원래 가려던 단계로 자동 복귀
  if (window._obAfterLogin) {
    var _t = window._obAfterLogin; window._obAfterLogin = null;
    try { _setObPath(_t.path); _obStep = _t.step; renderOnboardingStep(); } catch (e2) {}
  } else {
    try { renderOnboardingStep(); } catch (e2) {}   // 현재 화면 즉시 갱신(로그인 슬라이드 ✓ 표시 등)
  }
  setTimeout(function () {
    try {
      var raw = (typeof safeGetItem === 'function') ? safeGetItem(CO_KEY) : localStorage.getItem(CO_KEY);
      var ci = JSON.parse(raw || '{}');
      var filled = 0;
      ['coName','coTel','coBiz','coCeo','coAddr','coEmail','coBank','coIndustryMajor','coIndustryMinor','coReportTitle','coUnitLabel','coStageLabel'].forEach(function (k) { if (ci[k]) { _obData[k] = ci[k]; filled++; } });
      var ic = (typeof CO_ICON_KEY !== 'undefined') ? ((typeof safeGetItem === 'function') ? safeGetItem(CO_ICON_KEY) : localStorage.getItem(CO_ICON_KEY)) : null;
      if (ic && ic.length <= 4) _obData.coIcon = ic;
      if (filled) { if (typeof renderOnboardingStep === 'function') renderOnboardingStep(); if (typeof showToast === 'function') showToast('☁️ 저장된 업체정보를 불러왔어요', 'ok'); }
      else if (typeof showToast === 'function') showToast('로그인됨 · 저장된 업체정보가 없어요', 'ok');
    } catch (err) {}
  }, 1900);
});

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
