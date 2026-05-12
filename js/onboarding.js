/* ═══════════════════════════════════════════════
   온보딩 (첫 실행 시 기본 세팅 안내)
═══════════════════════════════════════════════ */

const ONBOARDING_DONE_KEY = 'ac_onboarding_done_v1';
let _obStep = 1;
let _obData = { coName: '', coTel: '', coIcon: '❄️', folderSet: false };

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
    { id: 'setup',   render: renderSlideSetup },
  ];
}

function showOnboarding() {
  console.log('[온보딩] showOnboarding 호출');
  _obStep = 1;
  _obData = { coName: '', coTel: '', coIcon: '❄️', folderSet: false };
  const modal = document.getElementById('onboardingModal');
  if (!modal) {
    console.warn('[온보딩] onboardingModal 없음');
    return;
  }
  modal.classList.add('open');
  renderOnboardingStep();
}
function hideOnboarding() { document.getElementById('onboardingModal').classList.remove('open'); }
function closeOnboarding(completed) {
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


/* ── 슬라이드 1: 소개 ── */
function renderSlideIntro(c) {
  c.innerHTML = `
  <div class="ob-slide ob-slide-intro">
    <div class="ob-intro-icon">❄️</div>
    <h2 class="ob-intro-title">에어컨 보고서 작성기</h2>
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

/* ── 슬라이드 2: 메인 화면 구성 ── */
function renderSlideScreen1(c) {
  c.innerHTML = `
  <div class="ob-slide">
    <div class="ob-slide-ttl">① 메인 화면 구성</div>
    <div class="ob-screen">
      <div class="obs-hdr">
        <div class="obs-logo-row">
          <span class="obs-logo-ic">❄️</span>
          <span class="obs-logo-txt">에어컨 보고서 작성기</span>
          <span class="obs-logo-badge">작업 기록</span>
        </div>
        <div class="obs-fields">
          <div class="obs-field-row">
            <div class="obs-field"><div class="obs-fl">작업명</div><div class="obs-fv obs-fv-hl">지제더샵 3단지</div></div>
            <div class="obs-field"><div class="obs-fl">날짜</div><div class="obs-fv">2026.05.11</div></div>
            <div class="obs-field"><div class="obs-fl">담당자</div><div class="obs-fv">배성철</div></div>
          </div>
        </div>
        <div class="obs-modes">
          <div class="obs-mode obs-mode-on">🏠 가정용</div>
          <div class="obs-mode">🏢 공용시설</div>
        </div>
        <div class="obs-btns">
          <div class="obs-btn obs-c-gray">⚙️설정</div>
          <div class="obs-btn obs-c-orange">🆕새작업</div>
          <div class="obs-btn obs-c-gold">💾저장</div>
          <div class="obs-btn obs-c-blue">📄미리보기</div>
          <div class="obs-btn obs-c-green">⬇️PDF</div>
          <div class="obs-btn obs-c-org2">🖼️JPG</div>
        </div>
      </div>
      <div class="obs-stats">
        <div class="obs-stat"><b>2</b><small>총 호수</small></div>
        <div class="obs-stat"><b>1</b><small>완료</small></div>
        <div class="obs-stat obs-stat-warn"><b>1</b><small>미완료</small></div>
        <div class="obs-stat"><b>14</b><small>총 사진</small></div>
      </div>
      <div class="obs-badges">
        ${badge(1)}${badge(2)}${badge(3)}${badge(4)}
      </div>
    </div>
    <div class="ob-callouts">
      ${callout(1,'작업명(아파트명)·날짜·담당자를 입력해요')}
      ${callout(2,'가정용(호수 1개) 또는 공용시설(다수 영역) 선택')}
      ${callout(3,'⚙️설정 / 🆕새작업 / 💾저장 / 📄보고서 버튼')}
      ${callout(4,'현재 작업의 호수·완료·사진 현황을 보여줘요')}
    </div>
  </div>`;
}

/* ── 슬라이드 3: 호수 추가 ── */
function renderSlideScreen2(c) {
  c.innerHTML = `
  <div class="ob-slide">
    <div class="ob-slide-ttl">② 호수 추가하기</div>
    <div class="ob-screen">
      <div class="obs-add-area">
        <div class="obs-add-row">
          <div class="obs-input-box">316동 602호</div>
          <div class="obs-btn obs-c-blue">➕ 추가</div>
          <div class="obs-btn obs-c-gray">📋 일괄</div>
        </div>
      </div>
      <div class="obs-card obs-card-open">
        <div class="obs-card-top">
          <span class="obs-cnum">1</span>
          <span class="obs-cname">316동 602호 ✏️</span>
          <span class="obs-chip obs-chip-done">✅완료</span>
          <div style="margin-left:auto;display:flex;gap:3px;">
            <span class="obs-btn obs-btn-xs obs-c-gray">순서편집</span>
            <span class="obs-btn obs-btn-xs obs-c-gray">✓완료</span>
            <span class="obs-btn obs-btn-xs obs-c-red">삭제</span>
          </div>
        </div>
        <div class="obs-card-body">
          <div class="obs-psec">
            <div class="obs-plabel" style="color:#f06060;">🔴 작업 전 (3장)</div>
            <div class="obs-thumbs">
              <div class="obs-th obs-th-f">📷</div>
              <div class="obs-th obs-th-f">📷</div>
              <div class="obs-th obs-th-f">📷</div>
            </div>
          </div>
          <div class="obs-psec">
            <div class="obs-plabel" style="color:#10b981;">🟢 작업 후 (3장)</div>
            <div class="obs-thumbs">
              <div class="obs-th obs-th-f">📷</div>
              <div class="obs-th obs-th-f">📷</div>
              <div class="obs-th obs-th-f">📷</div>
            </div>
          </div>
          <div class="obs-special">⚠️ 특이사항 (0건) &nbsp;&nbsp;<span class="obs-btn obs-btn-xs obs-c-warn">＋ 추가</span></div>
          <div class="obs-cust-row"><span class="obs-fl">전화번호</span><span class="obs-input-box" style="flex:1;color:var(--mu)">010-____-____</span></div>
        </div>
      </div>
      <div class="obs-card">
        <div class="obs-card-top">
          <span class="obs-cnum">2</span>
          <span class="obs-cname">316동 603호</span>
          <span class="obs-chip obs-chip-pnd">⏳진행중</span>
        </div>
      </div>
      <div class="obs-badges">
        ${badge(1)}${badge(2)}${badge(3)}${badge(4)}${badge(5)}
      </div>
    </div>
    <div class="ob-callouts">
      ${callout(1,'호수명 입력 후 ➕추가 / 📋일괄로 여러 호수 한번에 추가')}
      ${callout(2,'카드를 터치하면 펼쳐져요. 작업 전·후 사진 구역이 나타나요')}
      ${callout(3,'사진 추가 후 완료 표시. 특이사항도 사진+메모로 추가 가능')}
      ${callout(4,'고객 전화번호 입력 시 다음 방문 때 이력 확인 가능')}
      ${callout(5,'✏️ 호수명 수정 / 순서편집 / 삭제 버튼')}
    </div>
  </div>`;
}

/* ── 슬라이드 4: 사진 찍기 ── */
function renderSlideScreen3(c) {
  c.innerHTML = `
  <div class="ob-slide">
    <div class="ob-slide-ttl">③ 사진 찍기 · 순서 편집</div>
    <div class="ob-screen">
      <div class="obs-photo-main">
        <div class="obs-photo-col">
          <div class="obs-plabel" style="color:#f06060;">🔴 작업 전</div>
          <div class="obs-cam-row">
            <div class="obs-btn obs-c-gray obs-btn-sm">📷 카메라</div>
            <div class="obs-btn obs-c-gray obs-btn-sm">🖼️ 갤러리</div>
          </div>
          <div class="obs-thumbs obs-thumbs-lg">
            <div class="obs-th obs-th-f obs-th-lg">📷<br><small>1</small></div>
            <div class="obs-th obs-th-f obs-th-lg">📷<br><small>2</small></div>
            <div class="obs-th obs-th-e obs-th-lg">＋</div>
          </div>
        </div>
        <div class="obs-photo-col">
          <div class="obs-plabel" style="color:#10b981;">🟢 작업 후</div>
          <div class="obs-cam-row">
            <div class="obs-btn obs-c-gray obs-btn-sm">📷 카메라</div>
            <div class="obs-btn obs-c-gray obs-btn-sm">🖼️ 갤러리</div>
          </div>
          <div class="obs-thumbs obs-thumbs-lg">
            <div class="obs-th obs-th-f obs-th-lg">📷<br><small>1</small></div>
            <div class="obs-th obs-th-f obs-th-lg">📷<br><small>2</small></div>
            <div class="obs-th obs-th-e obs-th-lg">＋</div>
          </div>
        </div>
      </div>
      <!-- 순서편집 미니 -->
      <div class="obs-reorder-box">
        <div class="obs-reorder-ttl">🔄 순서 편집 (드래그)</div>
        <div class="obs-reorder-item"><span class="obs-ri-n">1</span><span class="obs-ri-ph">📷</span><span class="obs-ri-del">✕</span><span class="obs-ri-handle">≡</span></div>
        <div class="obs-reorder-item"><span class="obs-ri-n">2</span><span class="obs-ri-ph">📷</span><span class="obs-ri-del">✕</span><span class="obs-ri-handle">≡</span></div>
      </div>
      <div class="obs-badges">
        ${badge(1)}${badge(2)}${badge(3)}${badge(4)}
      </div>
    </div>
    <div class="ob-callouts">
      ${callout(1,'📷카메라로 바로 촬영 또는 🖼️갤러리에서 여러 장 선택')}
      ${callout(2,'같은 번호끼리 보고서에서 짝이 돼요 (전1 ↔ 후1, 전2 ↔ 후2)')}
      ${callout(3,'순서 편집 버튼 → ≡ 드래그로 순서 변경 / ✕로 삭제')}
      ${callout(4,'사진을 탭하면 전체화면으로 크게 볼 수 있어요')}
    </div>
  </div>`;
}

/* ── 슬라이드 5: 저장·새작업·작업기록 ── */
function renderSlideScreen4(c) {
  c.innerHTML = `
  <div class="ob-slide">
    <div class="ob-slide-ttl">④ 저장 · 작업 기록</div>
    <div class="ob-screen">
      <div class="obs-save-row">
        <div class="obs-btn obs-c-orange obs-btn-lg">🆕 새작업</div>
        <div class="obs-btn obs-c-gold obs-btn-lg">💾 저장</div>
      </div>
      <div class="obs-history">
        <div class="obs-hist-hdr">
          <span style="font-weight:700;">📋 작업 기록</span>
          <div class="obs-filter">
            <span class="obs-ftag obs-ftag-on">오늘</span>
            <span class="obs-ftag">3일</span>
            <span class="obs-ftag">7일</span>
            <span class="obs-ftag">전체</span>
          </div>
        </div>
        <div class="obs-hcard">
          <div class="obs-hcard-apt">지제더샵 3단지</div>
          <div class="obs-hcard-sub">2026.05.11 · 6호수 · 24장</div>
          <span class="obs-chip obs-chip-done" style="font-size:9px;margin-left:auto;">완료</span>
        </div>
        <div class="obs-hcard">
          <div class="obs-hcard-apt" style="color:var(--mu);">📞 010-1234-5678 · 홍길동</div>
          <div class="obs-hcard-sub">지제더샵 · 2회 방문</div>
        </div>
        <div class="obs-hcard">
          <div class="obs-hcard-apt">○○ 어린이집</div>
          <div class="obs-hcard-sub">2026.05.10 · 공용시설</div>
        </div>
      </div>
      <div class="obs-badges">
        ${badge(1)}${badge(2)}${badge(3)}${badge(4)}
      </div>
    </div>
    <div class="ob-callouts">
      ${callout(1,'💾저장: 폴더에 사진·작업정보 보관')}
      ${callout(2,'🆕새작업: 현재 작업 자동저장 후 새 화면 시작')}
      ${callout(3,'날짜별·고객별 과거 작업 기록 조회 (카드 탭하면 불러오기)')}
      ${callout(4,'고객 전화번호로 방문 이력·재의뢰 여부 확인')}
    </div>
  </div>`;
}

/* ── 슬라이드 6: 보고서 ── */
function renderSlideScreen5(c) {
  c.innerHTML = `
  <div class="ob-slide">
    <div class="ob-slide-ttl">⑤ 보고서 출력 · 공유</div>
    <div class="ob-screen">
      <div class="obs-save-row">
        <div class="obs-btn obs-c-blue obs-btn-lg">📄 미리보기</div>
        <div class="obs-btn obs-c-green obs-btn-lg">⬇️ PDF</div>
        <div class="obs-btn obs-c-org2 obs-btn-lg">🖼️ JPG</div>
      </div>
      <div class="obs-report">
        <div class="obs-rp-hdr">
          <div style="font-weight:800;font-size:11px;">❄️ 에어컨 작업 보고서</div>
          <div style="font-size:9px;color:var(--mu);">지제더샵 3단지 | 2026.05.11 | 담당: 배성철</div>
        </div>
        <!-- 커버 페이지 -->
        <div class="obs-rp-cover">
          <div class="obs-rp-cover-ttl">📋 작업 목록 (6호수)</div>
          <div class="obs-rp-rows">
            <div class="obs-rp-row"><span class="obs-rp-n">1</span>316동 602호<span class="obs-chip obs-chip-done" style="font-size:8px;margin-left:auto;">완료</span></div>
            <div class="obs-rp-row"><span class="obs-rp-n">2</span>316동 603호<span class="obs-chip obs-chip-done" style="font-size:8px;margin-left:auto;">완료</span></div>
            <div class="obs-rp-row"><span class="obs-rp-n">3</span>316동 604호 ⚠️<span class="obs-chip obs-chip-done" style="font-size:8px;margin-left:auto;">완료</span></div>
          </div>
        </div>
        <!-- 상세 페이지 -->
        <div class="obs-rp-detail">
          <div class="obs-rp-unit-bar">❄️ 316동 602호 &nbsp;<small style="color:var(--mu);">1/6 · 전3장 · 후3장</small></div>
          <div class="obs-rp-photo-cols">
            <div class="obs-rp-pcol">
              <div class="obs-rp-pcol-lbl" style="color:#f06060;">🔴 작업 전</div>
              <div class="obs-rp-phs">
                <div class="obs-rp-ph" style="background:#fde8e8;">전1</div>
                <div class="obs-rp-ph" style="background:#fde8e8;">전2</div>
                <div class="obs-rp-ph" style="background:#fde8e8;">전3</div>
              </div>
            </div>
            <div class="obs-rp-pcol">
              <div class="obs-rp-pcol-lbl" style="color:#10b981;">🟢 작업 후</div>
              <div class="obs-rp-phs">
                <div class="obs-rp-ph" style="background:#e8fde8;">후1</div>
                <div class="obs-rp-ph" style="background:#e8fde8;">후2</div>
                <div class="obs-rp-ph" style="background:#e8fde8;">후3</div>
              </div>
            </div>
          </div>
        </div>
        <!-- 특이사항 -->
        <div class="obs-rp-special">
          <span style="font-size:9px;font-weight:700;">⚠️ 특이사항 별도 페이지</span>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-top:3px;">
            <div style="background:#fde8e8;border-radius:3px;padding:4px;font-size:8px;">📷 사진</div>
            <div style="background:#fffbf0;border-radius:3px;padding:4px;font-size:8px;">📝 메모</div>
          </div>
        </div>
      </div>
      <div class="obs-badges">
        ${badge(1)}${badge(2)}${badge(3)}${badge(4)}
      </div>
    </div>
    <div class="ob-callouts">
      ${callout(1,'📄미리보기로 먼저 확인 후 PDF 또는 JPG로 저장')}
      ${callout(2,'커버 페이지: 전체 작업 목록 + 특이사항 호수 표시')}
      ${callout(3,'각 호수별 작업 전·후 사진이 짝지어 출력돼요')}
      ${callout(4,'특이사항: 좌측 사진 + 우측 메모 별도 페이지')}
    </div>
  </div>`;
}

/* ── 슬라이드 7: 세팅 ── */
function renderSlideSetup(c) {
  const hasFolder = (typeof photoFolderHandle !== 'undefined' && photoFolderHandle);
  c.innerHTML = `
  <div class="ob-slide">
    <div class="ob-slide-ttl">⑥ 업체 정보 설정</div>
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
const CO_KEY = 'ac_company_info';
const CO_ICON_KEY = 'ac_company_icon';

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
  console.log('[온보딩] replayOnboarding 호출됨');
  document.getElementById('settingsModal')?.classList.remove('open');
  try {
    const ci = JSON.parse(safeGetItem(CO_KEY) || '{}');
    _obData.coName = ci.coName || '';
    _obData.coTel  = ci.coTel  || '';
    _obData.coIcon = safeGetItem(CO_ICON_KEY) || '❄️';
    _obData.folderSet = !!(typeof photoFolderHandle !== 'undefined' && photoFolderHandle);
  } catch(e) { console.warn('[온보딩] 데이터 로드 실패:', e); }
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
