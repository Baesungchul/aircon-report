/* ═══════════════════════════════
   설정 모달
═══════════════════════════════ */

// 설정 상태
const FS_SIZES = [
  { label: '아주 작게', value: 13 },
  { label: '작게',     value: 14 },
  { label: '보통',     value: 15 },
  { label: '크게',     value: 17.2 },
  { label: '더 크게',  value: 19.4 },
  { label: '아주 크게', value: 21.6 }
];
const FS_KEY    = 'ac_fs_index_v1';
const THEME_KEY = 'ac_theme_v1';
const MODE_KEY  = 'ac_mode_v1';  // 화면 모드: light | dark
const REPORT_THEME_KEY = 'ac_report_theme_v1';
const LANG_KEY  = 'ac_lang_v1';
const CAM_RES_KEY = 'ac_cam_res_v1';  // ★ camera.js와 동일한 키 - 앱내장 카메라 촬영 해상도
// ⚠️ REPORT_RES_KEY는 report.js에서 이미 전역 const로 선언됨(report.js가 먼저 로드).
//    여기서 다시 const로 선언하면 "Identifier 'REPORT_RES_KEY' has already been declared"
//    SyntaxError가 나면서 settings.js 전체가 실행되지 않아 openSettings 등이 미정의가 됨
//    (= 설정 탭이 안 열리던 원인, 2026-07-07 수정). report.js의 전역을 그대로 사용한다.

// 보고서 테마와 매칭되는 통합 테마 목록 (6개)
const APP_THEMES = [
  { id: 'deepteal',   label: '딥틸',   ac: '#0F5F6B' },
  { id: 'clean',      label: '인디고', ac: '#4338CA' },
  { id: 'light',      label: '블루',   ac: '#1D66C9' },
  { id: 'bright',     label: '그린',   ac: '#0E7C56' },
  { id: 'darkpurple', label: '퍼플',   ac: '#7C3AED' },
  { id: 'cool',       label: '시안',   ac: '#0E7490' },
  { id: 'premium',    label: '로즈',   ac: '#BE123C' },
];

const REPORT_THEMES = [
  { id: 'default', label: '인디고', gradient: 'linear-gradient(135deg,#ffffff,#4f46e5)' },
  { id: 'clean',   label: '블루',   gradient: 'linear-gradient(135deg,#ffffff,#2563eb)' },
  { id: 'navy',    label: '네이비', gradient: 'linear-gradient(135deg,#ffffff,#1e40af)' },
  { id: 'cool',    label: '시안',   gradient: 'linear-gradient(135deg,#ffffff,#0891b2)' },
  { id: 'teal',    label: '청록',   gradient: 'linear-gradient(135deg,#ffffff,#0d9488)' },
  { id: 'bright',  label: '그린',   gradient: 'linear-gradient(135deg,#ffffff,#059669)' },
  { id: 'amber',   label: '앰버',   gradient: 'linear-gradient(135deg,#ffffff,#d97706)' },
  { id: 'orange',  label: '오렌지', gradient: 'linear-gradient(135deg,#ffffff,#ea580c)' },
  { id: 'premium', label: '로즈',   gradient: 'linear-gradient(135deg,#ffffff,#e11d48)' },
  { id: 'fuchsia', label: '푸시아', gradient: 'linear-gradient(135deg,#ffffff,#c026d3)' },
  { id: 'dark',    label: '퍼플',   gradient: 'linear-gradient(135deg,#ffffff,#7c3aed)' },
  { id: 'slate',   label: '그레이', gradient: 'linear-gradient(135deg,#ffffff,#475569)' },
];

function applyTheme(name) {
  const root = document.documentElement;
  if (name === 'dark' || !name) {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', name);
  }
  localStorage.setItem(THEME_KEY, name || 'dark');
  // 라벨 업데이트
  updateThemeLabels();
}

function applyMode(mode) {
  const root = document.documentElement;
  if (mode === 'dark') root.setAttribute('data-mode', 'dark');
  else root.removeAttribute('data-mode');
  localStorage.setItem(MODE_KEY, mode === 'dark' ? 'dark' : 'light');
  updateThemeLabels();
}

function applyReportTheme(name) {
  localStorage.setItem(REPORT_THEME_KEY, name || 'default');
  updateThemeLabels();
}

function updateThemeLabels() {
  const curApp = localStorage.getItem(THEME_KEY) || 'deepteal';
  const curReport = localStorage.getItem(REPORT_THEME_KEY) || 'default';
  const appTheme = APP_THEMES.find(t => t.id === curApp);
  const reportTheme = REPORT_THEMES.find(t => t.id === curReport);
  const appLabel = document.getElementById('curAppThemeLabel');
  const reportLabel = document.getElementById('curReportThemeLabel');
  const mode = localStorage.getItem(MODE_KEY) || 'light';
  if (appLabel && appTheme) appLabel.textContent = `${appTheme.label} · ${mode === 'dark' ? '다크' : '화이트'}`;
  if (reportLabel && reportTheme) reportLabel.textContent = reportTheme.label;
}

function openThemePicker(type) {
  const isApp = type === 'app';
  const themes = isApp ? APP_THEMES : REPORT_THEMES;
  const curKey = isApp ? THEME_KEY : REPORT_THEME_KEY;
  const curId = localStorage.getItem(curKey) || (isApp ? 'deepteal' : 'default');
  const mode = localStorage.getItem(MODE_KEY) || 'light';

  document.getElementById('themePickerTitle').textContent =
    isApp ? '\uD83C\uDFA8 \uC571 \uD14C\uB9C8 \uC120\uD0DD' : '\uD83D\uDCC4 \uBCF4\uACE0\uC11C \uD14C\uB9C8 \uC120\uD0DD';

  const seg = (m, label) => {
    const on = mode === m;
    return `<button class="mode-seg" data-mode="${m}" style="flex:1;padding:12px;border-radius:11px;cursor:pointer;`
      + `font-size:14px;font-weight:800;border:2px solid ${on ? 'var(--ac)' : 'var(--bd)'};`
      + `background:${on ? 'var(--brand-soft)' : 'var(--sf)'};color:${on ? 'var(--ac)' : 'var(--mu)'};">${label}</button>`;
  };
  const modeRow = isApp ? `
    <div style="font-size:12px;font-weight:800;color:var(--mu);margin-bottom:8px;">\uD654\uBA74 \uBAA8\uB4DC</div>
    <div style="display:flex;gap:8px;margin-bottom:18px;">${seg('light','\u2600\uFE0F \uD654\uC774\uD2B8')}${seg('dark','\uD83C\uDF19 \uB2E4\uD06C')}</div>
    <div style="font-size:12px;font-weight:800;color:var(--mu);margin-bottom:8px;">\uAC15\uC870 \uC0C9\uC0C1</div>
  ` : '';

  const prevBg = (t) => {
    if (!isApp) return t.gradient;
    return mode === 'dark'
      ? `linear-gradient(135deg,#1E2730,${t.ac})`
      : `linear-gradient(135deg,#ffffff,${t.ac})`;
  };

  const body = document.getElementById('themePickerBody');
  body.innerHTML = modeRow + `
    <div class="theme-picker-grid">
      ${themes.map(t => `
        <button class="theme-pick-item ${t.id === curId ? 'active' : ''}" data-tid="${t.id}" data-ttype="${type}">
          <div class="theme-pick-prev" style="background:${prevBg(t)};"></div>
          <div class="theme-pick-lbl">${t.label}</div>
        </button>
      `).join('')}
    </div>
  `;

  if (isApp) {
    body.querySelectorAll('.mode-seg').forEach(btn => {
      btn.addEventListener('click', () => {
        applyMode(btn.dataset.mode);
        openThemePicker('app');
      });
    });
  }

  body.querySelectorAll('.theme-pick-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const tid = btn.dataset.tid;
      const ttype = btn.dataset.ttype;
      if (ttype === 'app') {
        applyTheme(tid);
        if (typeof showToast === 'function') showToast('\u2713 \uC571 \uD14C\uB9C8 \uBCC0\uACBD\uB428', 'ok');
      } else {
        applyReportTheme(tid);
        if (typeof showToast === 'function') showToast('\u2713 \uBCF4\uACE0\uC11C \uD14C\uB9C8 \uBCC0\uACBD\uB428', 'ok');
      }
      closeThemePicker();
    });
  });

  document.getElementById('themePickerModal').classList.add('open');
}

function closeThemePicker() {
  document.getElementById('themePickerModal').classList.remove('open');
}

function applyFontSize(idx) {
  idx = Math.max(0, Math.min(FS_SIZES.length - 1, idx));
  const { label, value } = FS_SIZES[idx];
  document.documentElement.style.setProperty('--fs-base', value + 'px');
  // ★ 대부분 텍스트가 고정 px라 --fs-base만으론 반영 안 됨 → 전체 배율(zoom)로 적용
  //   15px(보통) 기준 비율. 글자 크게=확대, 작게=축소
  // ★ 앱 전체 콘텐츠에 '일괄' 적용: 작업/기록(달력)/채팅 탭, 설정·팝업·다이얼로그, 하단 탭바.
  //   단, 전체화면 모달은 오버레이/헤더/푸터가 아닌 스크롤 '본문'(.co-body/.rd-body 등)에만
  //   걸어 저장버튼(푸터)이 화면 밖으로 밀리지 않게 한다. 탭바(.tabbar)도 동일 배율이라
  //   본문 하단여백과 비율이 유지되어 가림이 없다. (2026-07-29 일괄 적용 확장)
  const _z = (value / 15).toFixed(3);
  const _FS_ZOOM_SEL = ['.hdr', '.main', '.tabbar',
    '.co-body', '.dlg-body', '.sl-body', '.rd-body', '.ob-content'];
  _FS_ZOOM_SEL.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => { el.style.zoom = _z; });
  });
  document.documentElement.style.zoom = '';  // html 전체 zoom 해제(모달 보호)
  /* ★ 2026-08-17 달력 날짜 칸 '안쪽'은 이 배율에서 뺀다.
     달력은 화면 폭을 7로 나눈 고정 격자라, 배율을 올리면 칸이 쓸 수 있는 CSS 폭이
     오히려 줄어든다(아주 크게에서 45px → 31px). 칸 안의 점·업종 아이콘·시간은
     고정 px 라 그대로 두면 옆 칸을 침범한다 → 역수를 걸어 기본 크기를 유지시킨다.
     날짜 숫자·요일·월매출·아래 작업목록은 설정대로 커진다(가독성 이득은 그대로). */
  document.documentElement.style.setProperty('--fs-unzoom', (1 / parseFloat(_z)).toFixed(4));
  // ★ 2026-08-08: 글자가 커지면 헤더 버튼(새작업·저장·가져오기)이 가로로 비좁아진다.
  //   CSS에서 분기할 수 있도록 현재 단계를 body 속성으로 노출한다('더 크게' 이상이면 아이콘 위/글자 아래).
  try { document.body.setAttribute('data-fs', String(idx)); } catch (e) {}
  const lblEl = document.getElementById('fsLabel');
  if (lblEl) lblEl.textContent = label;
  localStorage.setItem(FS_KEY, String(idx));
  /* ★ 2026-08-21 배율이 바뀌면 펼쳐둔 달력 높이가 어긋난다 → 실측 보정을 한 번 돌린다 */
  try { if (window.__calRefit) window.__calRefit(80); } catch (e) {}
  return idx;
}

/* ★ 2026-08-17 설정 화면 2단 아코디언 — 사용자 요청으로 구조를 다시 짰다.
     이전 문제: '큰 타이틀'과 그 안의 '작은 타이틀'이 같은 말이라 같은 글자가 두 번 나왔고
                (소개/약관/개인정보처럼 항목 하나짜리 그룹이 여러 개), 기본 정보 그룹은
                업체정보·업종·로그인·공유가 한 덩어리로 쏟아져 복잡했다.

     새 규칙(사용자 확정)
       · 큰 타이틀을 누르면 → 소타이틀들이 보인다
       · 소타이틀을 누르면 → 그 내용이 보인다
       · 소타이틀이 **1건뿐이면 소타이틀을 생략**하고 내용을 바로 보여준다
         (그때 섹션 자체 제목은 큰 타이틀과 같은 말이라 숨긴다 — 반복 제거)
       · 소타이틀이 2건 이상이면 소타이틀만 접힌 채 보여준다

     ⚠️ index.html 은 그대로 두고 실행 시 .set-sec 을 옮기기만 한다 —
        기존 id·이벤트·동적 주입(닉네임 버튼 등)이 전부 살아 있어야 하기 때문. */
function initSettingsAccordion() {
  try {
    var body = document.querySelector('#settingsModal .co-body');
    if (!body || body._accordionDone) return;
    body._accordionDone = true;

    /* subs = 이 그룹에 들어갈 소타이틀 순서. 각 항목은 .set-sec 제목의 일부 글자.
       ⚠️ 순서가 화면 순서다. 여기 안 걸린 섹션은 맨 끝 그룹으로 떨어진다. */
    var groups = [
      { icon: '⭐', name: '구독',        desc: '요금제 · AI 사용량 · 쿠폰',
        subs: ['구독'], badgeId: 'setGrpBadgeSub' },
      { icon: '🏢', name: '기본 정보',   desc: '업체정보 · 내 업종 · 로그인 · 공유 설정',
        subs: ['업체정보', '내 업종', '로그인', '공유 설정'] },
      { icon: '🔔', name: '알림 설정',   desc: '일정 알림 · 공유/채팅 알림',
        subs: ['일정 알림', '공유 · 채팅 알림'] },
      { icon: '🎨', name: '화면 설정',   desc: '앱 테마 · 글자 크기',
        subs: ['앱 테마', '글자 크기'] },
      { icon: '📄', name: '보고서 설정', desc: '보고서 테마 · 해상도',
        subs: ['보고서 테마', '보고서 해상도'] },
      { icon: '💾', name: '데이터',      desc: '백업/복원 · 고객 데이터 · 캘린더 가져오기',
        subs: ['데이터 백업', '고객 데이터', '네이버 캘린더'] },
      { icon: 'ℹ️', name: '앱 정보',    desc: '앱 소개 · 오픈채팅방 · 별점 · 약관 · 개인정보',
        subs: ['현장매니저 소개', '오픈채팅방', '별점', '약관', '개인정보'] }
    ];

    var secs = Array.prototype.slice.call(body.querySelectorAll('.set-sec'));
    function titleEl(sec) { return sec.querySelector('.set-sec-title'); }
    function titleOf(sec) { var t = titleEl(sec); return t ? (t.textContent || '').trim() : ''; }

    /* 섹션을 (그룹, 소타이틀) 자리에 배정한다.
       ⚠️ 먼저 걸린 소타이틀이 이긴다 — '공유 설정'이 '로그인'보다 뒤에 있어도
          '☁️ 로그인' 제목엔 '공유 설정'이 없으므로 서로 안 뺏는다. */
    var slots = groups.map(function (g) { return g.subs.map(function () { return []; }); });
    var leftover = [];
    secs.forEach(function (sec) {
      var t = titleOf(sec), gi = -1, si = -1;
      outer:
      for (var i = 0; i < groups.length; i++) {
        for (var j = 0; j < groups[i].subs.length; j++) {
          if (t.indexOf(groups[i].subs[j]) >= 0) { gi = i; si = j; break outer; }
        }
      }
      if (gi >= 0) slots[gi][si].push(sec); else leftover.push(sec);
    });
    // 어디에도 안 걸린 섹션(새로 추가된 것 등)은 마지막 그룹의 마지막 소타이틀로
    if (leftover.length) {
      var lg = slots.length - 1;
      leftover.forEach(function (sec) { slots[lg][slots[lg].length - 1].push(sec); });
    }

    var frag = document.createDocumentFragment();
    var groupEls = [];

    groups.forEach(function (g, gi) {
      // 실제로 섹션이 들어온 소타이틀만 남긴다(빈 소타이틀은 안 그린다)
      var filled = [];
      g.subs.forEach(function (label, si) {
        if (slots[gi][si].length) filled.push({ label: label, secs: slots[gi][si] });
      });
      if (!filled.length) return;

      var wrap = document.createElement('div');
      wrap.className = 'set-group';
      wrap.innerHTML =
        '<div class="set-group-head">' +
          '<div style="display:flex;align-items:center;gap:10px;min-width:0;">' +
            '<span style="font-size:18px;">' + g.icon + '</span>' +
            '<div style="min-width:0;">' +
              '<div style="font-size:14px;font-weight:800;">' + g.name +
                (g.badgeId ? ' <span id="' + g.badgeId + '" style="font-weight:700;color:var(--ac);font-size:12px;"></span>' : '') +
              '</div>' +
              '<div style="font-size:11px;color:var(--mu);font-weight:400;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + g.desc + '</div>' +
            '</div>' +
          '</div>' +
          '<span class="set-group-arrow">▸</span>' +
        '</div>' +
        '<div class="set-group-body"></div>';
      var gbody = wrap.querySelector('.set-group-body');

      if (filled.length === 1) {
        /* ⭐ 소타이틀 1건 — 소타이틀을 만들지 않고 내용을 바로 붙인다.
             섹션 자체 제목은 큰 타이틀과 같은 말이라 숨긴다(반복 제거). */
        filled[0].secs.forEach(function (sec) {
          var te = titleEl(sec);
          if (te) te.style.display = 'none';
          gbody.appendChild(sec);
        });
      } else {
        var subEls = [];
        filled.forEach(function (f) {
          var sub = document.createElement('div');
          sub.className = 'set-sub';
          /* 소타이틀 글자는 섹션 제목을 그대로 쓴다(아이콘·배지까지 살아 있게 통째로 옮긴다) */
          var head = document.createElement('div');
          head.className = 'set-sub-head';
          var lab = document.createElement('div');
          lab.className = 'set-sub-label';
          var first = titleEl(f.secs[0]);
          if (first) { first.style.display = 'none'; lab.innerHTML = first.innerHTML; }
          else lab.textContent = f.label;
          var arw = document.createElement('span');
          arw.className = 'set-sub-arrow';
          arw.textContent = '▸';
          head.appendChild(lab); head.appendChild(arw);
          var sbody = document.createElement('div');
          sbody.className = 'set-sub-body';
          f.secs.forEach(function (sec, k) {
            if (k > 0) { var te2 = titleEl(sec); if (te2) te2.style.display = ''; }
            sbody.appendChild(sec);
          });
          sub.appendChild(head); sub.appendChild(sbody);
          gbody.appendChild(sub);
          subEls.push(sub);
        });
        // 소타이틀도 한 번에 하나만 열린다
        subEls.forEach(function (el) {
          el.querySelector('.set-sub-head').addEventListener('click', function () {
            var open = el.classList.contains('open');
            subEls.forEach(function (o) { o.classList.remove('open'); });
            if (!open) el.classList.add('open');
          });
        });
      }

      frag.appendChild(wrap);
      groupEls.push(wrap);
    });

    body.appendChild(frag);

    // 큰 타이틀도 한 번에 하나만 열린다
    groupEls.forEach(function (el) {
      el.querySelector('.set-group-head').addEventListener('click', function () {
        var isOpen = el.classList.contains('open');
        groupEls.forEach(function (o) { o.classList.remove('open'); });
        if (!isOpen) el.classList.add('open');
      });
    });
  } catch (e) { console.warn('[설정] 아코디언 구성 실패:', e); }
}

/* ★ 2026-08-17 — '로그인'과 '공유 설정'을 소타이틀 둘로 나누기 위해,
     cloud.js 가 #cloudAcctBox 안에 만들어 둔 공유·팀 영역을 공유 소타이틀로 옮긴다.
     ⚠️ cloud_share.renderArea 와 teams.js 는 이 둘을 **id 로 찾으므로** 옮겨도 그대로 동작한다.
     ⚠️ 모달 복귀(Cloud.unmountInline)는 현재 진입점이 없어(#cloudSetBtn 없음) 되돌릴 필요가 없다. */
function moveShareAreaToOwnSection() {
  try {
    var host = document.getElementById('shareInlineHost');
    if (!host) return;
    ['cloudShareArea', 'cloudTeamArea'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.parentNode !== host) host.appendChild(el);
    });
  } catch (e) { console.warn('[설정] 공유 영역 이동 실패:', e); }
}

function loadSettings() {
  initSettingsAccordion();
  // 테마 복원
  const theme = localStorage.getItem(THEME_KEY) || 'deepteal';
  applyTheme(theme);
  // 화면 모드(라이트/다크) 복원
  applyMode(localStorage.getItem(MODE_KEY) || 'light');
  // 폰트 크기 복원 (기본: 보통 = index 2)
  const fsIdx = parseInt(localStorage.getItem(FS_KEY) || '2', 10);
  applyFontSize(fsIdx);
  // 언어 복원
  const lang = localStorage.getItem(LANG_KEY) || 'ko';
  const langSel = document.getElementById('langSelect');
  if (langSel) langSel.value = lang;
  // 카메라 해상도 복원
  const camRes = localStorage.getItem(CAM_RES_KEY) || 'std';
  const camResSel = document.getElementById('camResSelect');
  if (camResSel) camResSel.value = camRes;
  // 보고서 해상도 복원
  const reportRes = localStorage.getItem(REPORT_RES_KEY) || 'normal';
  const reportResSel = document.getElementById('reportResSelect');
  if (reportResSel) reportResSel.value = reportRes;
  // 일정 알림 설정 복원
  const notifyChk = document.getElementById('notifyEnabledChk');
  const notifyLead = document.getElementById('notifyLeadSelect');
  const notifyOn = (window.Notify && Notify.enabled) ? Notify.enabled() : (localStorage.getItem('notifyEnabled') === '1');
  const notifyMin = (window.Notify && Notify.leadMin) ? Notify.leadMin() : (parseInt(localStorage.getItem('notifyLeadMin'), 10) || 30);
  if (notifyChk) notifyChk.checked = !!notifyOn;
  if (notifyLead) notifyLead.value = String(notifyMin);
  const notifyWrap = document.getElementById('notifyLeadWrap');
  if (notifyWrap) notifyWrap.style.opacity = notifyOn ? '1' : '.45';
  // 정확한 시간 알림 상태 (2026-08-27)
  refreshExactAlarmUi();
  // 공유·채팅 알림 종류별 복원
  restoreShareNotifChecks();
}

/* ── 정확한 시간 알림 안내 (2026-08-27) ─────────────────────────
   '30분 전'으로 예약한 알림이 7분 전에 온 실측에서 나왔다. 예약은 맞았고 전달이 밀린 것 —
   SCHEDULE_EXACT_ALARM 이 꺼져 있으면 플러그인이 부정확 알람으로 폴백한다(notify.js 주석 참고).
   허용돼 있으면 초록 안내만, 아니면 허용 버튼을 띄운다.
   ⚠️ 앱이 아니거나(웹) Android 11 이하면 checkExact 가 '' 를 주므로 둘 다 숨긴다 — 쓸데없는 버튼을 안 보이게. */
function refreshExactAlarmUi() {
  const warn = document.getElementById('notifyExactWrap');
  const ok = document.getElementById('notifyExactOk');
  if (!warn || !ok) return;
  warn.style.display = 'none';
  ok.style.display = 'none';
  if (!(window.Notify && Notify.checkExact)) return;
  Notify.checkExact().then(function (st) {
    if (st === 'granted') ok.style.display = '';
    else if (st === 'denied') warn.style.display = '';
  }).catch(function () {});
}

// 공유·채팅 알림 체크박스 상태를 현재 설정값으로 맞춤
function restoreShareNotifChecks() {
  const map = { notifChatChk: 'chat', notifSharedChk: 'sharedPhoto', notifBorrowedChk: 'borrowedPhoto', notifReupChk: 'reupload' };
  Object.keys(map).forEach(function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = (window.Push && Push.getPref) ? Push.getPref(map[id]) : (localStorage.getItem('notifPref_' + map[id]) !== '0');
  });
}
// 서버에서 설정 동기화가 끝나면(로그인 직후) 체크박스 갱신
document.addEventListener('notif-prefs-synced', function () { try { restoreShareNotifChecks(); } catch (e) {} });

// 설정 그룹 헤더 배지 갱신 (구독명 / 공유 인원수)
function updateSettingsGroupBadges() {
  var sb = document.getElementById('setGrpBadgeSub');
  if (sb) {
    var nm = '';
    try { if (window.Subs && Subs.planInfo) nm = (Subs.planInfo() || {}).name || ''; } catch (e) {}
    sb.textContent = nm ? ('· ' + nm) : '';
  }
  var scb = document.getElementById('shareCountBadge');
  if (scb) {
    var pc = 0;
    try { if (window.CloudShare && CloudShare.getSharedPartnerUids) pc = CloudShare.getSharedPartnerUids().length; } catch (e) {}
    scb.textContent = '(공유 ' + pc + '명)';
  }
}

/* ★ 2026-08-17 — 설정 화면의 📋 내 업종 블록으로 데려간다(접혀 있으면 펴고 스크롤).
     ⚠️ 'AI 설정' 섹션은 2026-08-17 제거됐다(일정 분석 지침은 문자/캡처 분석 시트 안의
        [지침 편집] 로 그대로 들어간다). 이 함수는 다른 안내에서 부를 수 있게 남겨 둔다. */
window.goToMyIndustries = function () {
  var box = document.getElementById('setIndustryBox');
  if (!box) return;
  try {
    var sec = box.closest ? box.closest('.set-sec') : null;
    // 아코디언으로 접혀 있으면 헤더를 눌러 편다
    if (sec && sec.previousElementSibling && sec.style.display === 'none') sec.previousElementSibling.click();
    if (sec) sec.style.display = '';
  } catch (e) {}
  try { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { }
  // 잠깐 강조해서 어디로 왔는지 알려준다
  try {
    var inner = box.firstElementChild || box;
    var old = inner.style.boxShadow;
    inner.style.transition = 'box-shadow .25s';
    inner.style.boxShadow = '0 0 0 3px var(--ac)';
    setTimeout(function () { inner.style.boxShadow = old || ''; }, 1200);
  } catch (e) {}
};

function openSettings() {
  // ★ 로그인/공유 UI를 설정 안에 인라인 표시 (중간 모달 제거)
  try { if (window.Cloud && Cloud.mountInline) Cloud.mountInline(document.getElementById('cloudInlineHost')); } catch (e) {}
  moveShareAreaToOwnSection();
  // 업체정보 미리보기 갱신
  const coSummary = document.getElementById('setCoSummary');
  if (coSummary) {
    const coName  = document.getElementById('coName')?.value  || '';
    const coBrand = document.getElementById('coBrand')?.value || '';
    const coTel   = document.getElementById('coTel')?.value   || '';
    const coBiz   = document.getElementById('coBiz')?.value   || '';
    const coAddr  = document.getElementById('coAddr')?.value  || '';
    const coEmail = document.getElementById('coEmail')?.value || '';
    const coWeb   = document.getElementById('coWeb')?.value   || '';
    const coDesc  = document.getElementById('coDesc')?.value  || '';

    const lines = [];
    if (coName)  lines.push(`<b style="color:var(--ac);">🏷️ ${escHtml(coName)}</b>` + (coBrand ? ` <span style="color:var(--mu);">· ${escHtml(coBrand)}</span>` : ''));
    if (coTel)   lines.push(`📞 ${escHtml(coTel)}`);
    if (coBiz)   lines.push(`🏢 사업자 ${escHtml(coBiz)}`);
    if (coAddr)  lines.push(`📍 ${escHtml(coAddr)}`);
    if (coEmail) lines.push(`✉️ ${escHtml(coEmail)}`);
    if (coWeb)   lines.push(`🌐 ${escHtml(coWeb)}`);
    if (coDesc)  lines.push(`<span style="color:var(--mu);font-size:11px;">📋 ${escHtml(coDesc.split('\n')[0]).slice(0, 60)}${coDesc.length > 60 ? '...' : ''}</span>`);

    if (lines.length > 0) {
      coSummary.innerHTML = lines.join('<br>');
      coSummary.style.display = 'block';
    } else {
      coSummary.innerHTML = '<span style="color:var(--wn);">⚠️ 업체정보가 입력되지 않았습니다</span>';
      coSummary.style.display = 'block';
    }
  }

  /* ★ 2026-08-17 내 업종 블록 — 설정은 index.html 정적 마크업이라
       여기서 안 부르면 처음 들어왔을 때 빈 칸으로 남는다. */
  try { if (window.ProfilesUI && ProfilesUI.renderSettingsIndustries) ProfilesUI.renderSettingsIndustries(); } catch (e) {}

  if (typeof initSettingsAccordion === 'function') initSettingsAccordion();
  if (typeof updateSettingsGroupBadges === 'function') updateSettingsGroupBadges();
  // ★ 관리자 전용 통계 진입점 (users/{uid}.admin === true 일 때만)
  try {
    var _isAdm = !!(window.Subs && Subs.isAdmin && Subs.isAdmin());
    var _asExisting = document.getElementById('adminStatsEntry');
    if (!_isAdm) {
      // 관리자가 아니면(계정 전환 등으로 남아있을 수 있는) 버튼을 확실히 제거
      if (_asExisting) _asExisting.remove();
    } else {
      var _asBody = document.querySelector('#settingsModal .co-body');
      if (_asBody && !_asExisting) {
        var _asBtn = document.createElement('button');
        _asBtn.id = 'adminStatsEntry';
        _asBtn.className = 'btn b-ghost';
        _asBtn.style.cssText = 'width:100%;justify-content:center;margin:0 0 12px;font-size:13px;font-weight:800;border:1px solid var(--ac);color:var(--ac);';
        _asBtn.textContent = '\uD83D\uDCCA \uAD00\uB9AC\uC790 \uD1B5\uACC4 (\uC0AC\uC6A9\uC790\u00B7\uAD6C\uB3C5\u00B7\uBE44\uC6A9)';
        _asBtn.onclick = function () { if (window.AdminStats) AdminStats.open(); };
        _asBody.insertBefore(_asBtn, _asBody.firstChild);
      }
    }
  } catch (e) {}
  document.getElementById('settingsModal').classList.add('open');
}

// HTML escape (settings.js 내에서 안전하게)
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('open');
}

function bindSettings() {
  // 열기/닫기
  const btn = document.getElementById('btnSettings');
  if (btn) btn.addEventListener('click', openSettings);
  const closeBtn = document.getElementById('settingsClose');
  if (closeBtn) closeBtn.addEventListener('click', closeSettings);
  const okBtn = document.getElementById('settingsCloseBtn');
  if (okBtn) okBtn.addEventListener('click', closeSettings);

  // 업체정보 편집 (기존 모달 열기)
  const coBtn = document.getElementById('setOpenCoInfo');
  if (coBtn) coBtn.addEventListener('click', () => {
    // 설정을 닫지 않고 위에 띄운다 (닫으면 뒤가 작업탭으로 보임)
    if (typeof openCoModal === 'function') openCoModal();
  });

  // 앱 테마 선택 - 팝업 열기
  const btnPickApp = document.getElementById('btnPickAppTheme');
  if (btnPickApp) btnPickApp.addEventListener('click', () => openThemePicker('app'));

  // 보고서 테마 선택 - 팝업 열기
  const btnPickReport = document.getElementById('btnPickReportTheme');
  if (btnPickReport) btnPickReport.addEventListener('click', () => openThemePicker('report'));

  // 테마 팝업 닫기
  const themePickerClose = document.getElementById('themePickerClose');
  if (themePickerClose) themePickerClose.addEventListener('click', closeThemePicker);

  // 라벨 초기화
  updateThemeLabels();

  // 폰트 크기
  let fsIdx = parseInt(localStorage.getItem(FS_KEY) || '2', 10);
  const fsDown = document.getElementById('fsDown');
  const fsUp   = document.getElementById('fsUp');
  if (fsDown) fsDown.addEventListener('click', () => { fsIdx = applyFontSize(fsIdx - 1); });
  if (fsUp)   fsUp.addEventListener('click',   () => { fsIdx = applyFontSize(fsIdx + 1); });

  // 언어 변경
  const langSel = document.getElementById('langSelect');
  if (langSel) langSel.addEventListener('change', () => {
    const newLang = langSel.value;
    if (newLang === 'ja') {
      // 일본어는 아직 준비 중
      showToast('해당 언어는 곧 지원 예정입니다 / Coming soon', 'err');
      langSel.value = localStorage.getItem(LANG_KEY) || 'ko';
      return;
    }
    // 한국어 또는 영어로 즉시 적용
    if (typeof setLanguage === 'function') {
      setLanguage(newLang);
      if (typeof showToast === 'function') {
        showToast(newLang === 'en' ? '✓ Language: English' : '✓ 언어: 한국어', 'ok');
      }
    }
  });

  // 카메라 해상도 변경 - camera.js가 다음에 카메라를 열 때 localStorage를 다시 읽어 적용
  const camResSel = document.getElementById('camResSelect');
  if (camResSel) camResSel.addEventListener('change', () => {
    localStorage.setItem(CAM_RES_KEY, camResSel.value);
    const preset = (window.CAM_RES_PRESETS && window.CAM_RES_PRESETS[camResSel.value]) || null;
    if (typeof showToast === 'function') {
      showToast('✓ 사진 해상도: ' + (preset ? preset.label : camResSel.value), 'ok');
    }
  });

  // 보고서 해상도 변경 - report.js가 다음 PDF/JPG 생성 시 localStorage를 다시 읽어 적용
  // ── 일정 알림 on/off + 알림시간 ──
  const notifyChkB = document.getElementById('notifyEnabledChk');
  if (notifyChkB) notifyChkB.addEventListener('change', () => {
    const on = notifyChkB.checked;
    const wrap = document.getElementById('notifyLeadWrap');
    if (wrap) wrap.style.opacity = on ? '1' : '.45';
    if (window.Notify && Notify.setEnabled) {
      Notify.setEnabled(on).then(() => {
        if (on && typeof showToast === 'function') showToast('🔔 일정 알림을 켰어요', 'ok');
      });
    }
  });
  const notifyLeadB = document.getElementById('notifyLeadSelect');
  if (notifyLeadB) notifyLeadB.addEventListener('change', () => {
    if (window.Notify && Notify.setLead) Notify.setLead(parseInt(notifyLeadB.value, 10) || 0);
  });
  // 정확한 시간에 알림 받기 — 시스템 '알람 및 리마인더' 화면을 열고, 돌아오면 상태를 다시 읽는다
  const notifyExactB = document.getElementById('notifyExactBtn');
  if (notifyExactB) notifyExactB.addEventListener('click', () => {
    if (!(window.Notify && Notify.requestExact)) return;
    Notify.requestExact().then(function (st) {
      refreshExactAlarmUi();
      if (typeof showToast === 'function') {
        showToast(st === 'granted' ? '⏰ 이제 정확한 시간에 알림이 옵니다' : '허용하지 않으면 알림이 늦게 올 수 있어요',
                  st === 'granted' ? 'ok' : 'err');
      }
    }).catch(function () {});
  });
  // 공유·채팅 알림 종류별 토글
  const _shareNotifMap = { notifChatChk: 'chat', notifSharedChk: 'sharedPhoto' };
  Object.keys(_shareNotifMap).forEach(function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', function () {
      if (window.Push && Push.setPref) Push.setPref(_shareNotifMap[id], el.checked);
    });
  });
  const reportResSel = document.getElementById('reportResSelect');
  if (reportResSel) reportResSel.addEventListener('change', () => {
    localStorage.setItem(REPORT_RES_KEY, reportResSel.value);
    var _pv = document.getElementById('pvResSelect'); if (_pv) _pv.value = reportResSel.value;
    const preset = (window.REPORT_RES_PRESETS && window.REPORT_RES_PRESETS[reportResSel.value]) || null;
    if (typeof showToast === 'function') {
      showToast('✓ 보고서 해상도: ' + (preset ? preset.label : reportResSel.value), 'ok');
    }
  });
}

// 전화번호 자동 하이픈
function autoFormatPhone(input) {
  if (!input) return;
  input.addEventListener('input', () => {
    let v = input.value.replace(/[^\d]/g, '');
    let formatted = '';
    // 010-XXXX-XXXX 또는 02-XXX(X)-XXXX 등
    if (v.startsWith('02')) {
      // 서울 02
      if (v.length <= 2) formatted = v;
      else if (v.length <= 5) formatted = v.slice(0,2) + '-' + v.slice(2);
      else if (v.length <= 9) formatted = v.slice(0,2) + '-' + v.slice(2,5) + '-' + v.slice(5);
      else formatted = v.slice(0,2) + '-' + v.slice(2,6) + '-' + v.slice(6,10);
    } else if (v.length <= 3) {
      formatted = v;
    } else if (v.length <= 7) {
      formatted = v.slice(0,3) + '-' + v.slice(3);
    } else if (v.length <= 11) {
      formatted = v.slice(0,3) + '-' + v.slice(3,7) + '-' + v.slice(7);
    } else {
      formatted = v.slice(0,3) + '-' + v.slice(3,7) + '-' + v.slice(7,11);
    }
    input.value = formatted;
  });
}

// 사업자번호 자동 하이픈 (000-00-00000)
function autoFormatBiz(input) {
  if (!input) return;
  input.addEventListener('input', () => {
    let v = input.value.replace(/[^\d]/g, '');
    let formatted = '';
    if (v.length <= 3) formatted = v;
    else if (v.length <= 5) formatted = v.slice(0,3) + '-' + v.slice(3);
    else formatted = v.slice(0,3) + '-' + v.slice(3,5) + '-' + v.slice(5,10);
    input.value = formatted;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  autoFormatPhone(document.getElementById('coTel'));
  autoFormatBiz(document.getElementById('coBiz'));
});
