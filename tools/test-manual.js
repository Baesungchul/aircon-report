/* ═══════════════════════════════════════════════════════════
   tools/test-manual.js
   사용 설명서 (2026-09-19 추가)
   ----------------------------------------------------------------
   ⭐ 이 기능에서 틀리면 곤란한 것은 '글이 예쁜가' 가 아니라 이 셋이다.

   ① **빈 그림 자리가 사용자에게 보이면 안 된다.**
      설명서는 글부터 넣고 그림은 나중에 채우기로 했다. 그 사이에 배포되는
      판에서 점선 빈 액자가 줄줄이 보이면 '덜 만든 앱' 으로 보인다.
      그래서 src 가 비면 아무것도 안 그린다 — 소스를 읽어 짐작하지 않고,
      실제로 bodyHtml 을 돌려 결과 글자를 본다.

   ② **하드웨어 뒤로가기로 닫혀야 한다.**
      이 앱에서 여러 번 터진 자리다(state.js closeTopPopup 주석 참고).
      오버레이에 ov-lock 이 있고 닫기 버튼 id 에 'Close' 가 들어가야
      뒤로가기가 이걸 찾아 닫는다. 둘 중 하나만 빠져도 조용히 샌다.

   ③ **글 파일이 화면 파일보다 먼저 실려야 한다.**
      manual.js 는 열리는 순간 MANUAL_DATA 를 읽는다. 순서가 뒤집히면
      '설명서를 불러오지 못했습니다' 만 뜬다 — 그런데 이건 눈으로는
      순서가 멀쩡해 보여서 놓치기 쉽다.

   ☠️ 그림 자리 보기(슬롯)는 **기본이 꺼짐**이어야 한다. 만드는 사람이 켜 둔 채
      잊고 배포하면 ① 이 그대로 터진다. 기본값을 못 박는다.
═══════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');
const JS = path.join(WWW, 'js');

let fails = 0, oks = 0;
function chk(name, fn) {
  try { const r = fn(); console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; }
  catch (e) { console.log('  ❌ ' + name + ' — ' + e.message); fails++; }
}
const must = (c, m) => { if (!c) throw new Error(m); };
const read = (p) => fs.readFileSync(p, 'utf8');

/* ── 가짜 브라우저 ──
   manual.js 는 불러올 때 document 를 쓰지 않는다(함수 안에서만 쓴다).
   그래서 순수 부분(srcOf/bodyHtml/listHtml)은 이렇게 진짜로 돌려 볼 수 있다. */
function load(store) {
  const s = Object.assign({}, store || {});
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    Date, String, Math, JSON, Object, Array, Number, Error, RegExp,
    setTimeout, clearTimeout,
    localStorage: {
      getItem: (k) => (k in s ? s[k] : null),
      setItem: (k, v) => { s[k] = String(v); },
      removeItem: (k) => { delete s[k]; }
    },
    document: { createElement: () => ({ style: {}, classList: { add() {} } }), body: { appendChild() {} } }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read(path.join(JS, 'manual_data.js')), ctx, { filename: 'manual_data.js' });
  vm.runInContext(read(path.join(JS, 'manual.js')), ctx, { filename: 'manual.js' });
  return ctx;
}

const HTML = read(path.join(WWW, 'index.html'));
const CSS = read(path.join(WWW, 'styles.css'));
const MJS = read(path.join(JS, 'manual.js'));

console.log('\n── 설명서 내용(manual_data.js) ──');

const base = load();
const D = base.window.MANUAL_DATA;
const allSecs = [];
(D.parts || []).forEach(p => (p.secs || []).forEach(s => allSecs.push(s)));
/* 그림은 이제 **단계 안**에 있다(2026-09-19). 검사도 거기를 봐야 한다 —
   칸(sec.img)만 보면 하나도 없으니 전부 조용히 통과한다(가짜 통과). */
const allImgs = [];
allSecs.forEach(sec => (sec.steps || []).forEach((st, j) =>
  (st.img || []).forEach((im, k) => allImgs.push({ sec: sec.t, step: st.h, j, k, im }))));

chk('MANUAL_DATA 가 실린다', () => {
  must(D && Array.isArray(D.parts), 'MANUAL_DATA.parts 가 없다');
  must(D.parts.length >= 1, '부(part)가 하나도 없다');
  return D.parts.length + '부 / ' + allSecs.length + '칸';
});

chk('모든 부에 이름과 칸이 있다', () => {
  D.parts.forEach((p, i) => {
    must(p.p && String(p.p).trim(), (i + 1) + '번째 부에 이름(p)이 없다');
    must(Array.isArray(p.secs) && p.secs.length, p.p + ' 에 칸이 없다');
  });
});

chk('모든 칸에 큰제목이 있다', () => {
  allSecs.forEach((s, i) => must(s.t && String(s.t).trim(), (i + 1) + '번째 칸에 제목(t)이 없다'));
});

chk('큰제목이 겹치지 않는다', () => {
  const seen = {};
  allSecs.forEach(s => {
    must(!seen[s.t], '제목이 두 번 나온다: ' + s.t);
    seen[s.t] = 1;
  });
});

chk('모든 칸에 단계가 있고 단계마다 제목이 있다', () => {
  allSecs.forEach(s => {
    must(Array.isArray(s.steps) && s.steps.length, s.t + ' 에 단계(steps)가 없다');
    s.steps.forEach((st, j) => must(st.h && String(st.h).trim(),
      s.t + ' 의 ' + (j + 1) + '번째 단계에 제목(h)이 없다'));
  });
});

chk('그림 칸은 모두 설명(cap)을 달고 있다', () => {
  /* cap 이 '무엇을 찍어 와야 하는지' 다. 비어 있으면 나중에 채울 때 알 수 없다 */
  must(allImgs.length > 0, '단계 안에 그림이 하나도 없다 — 구조가 어긋났다');
  allImgs.forEach(x => {
    const w = x.sec + ' ▸ ' + x.step;
    must(x.im && typeof x.im === 'object', w + ' 의 그림이 {src,cap} 꼴이 아니다');
    must('src' in x.im, w + ' 의 그림에 src 칸이 없다');
    must(x.im.cap && String(x.im.cap).trim(), w + ' 의 그림에 설명(cap)이 없다');
  });
  return '그림 자리 ' + allImgs.length + '개';
});

chk('그림은 칸 끝이 아니라 단계 안에 있다', () => {
  /* ☠️ 옛 모양(sec.img)으로 돌아가면 다시 글 다 읽고 그림을 짝지어야 한다.
       화면 코드는 옛 모양도 받아 주므로(호환), 여기서 막지 않으면 조용히 되돌아간다. */
  allSecs.forEach(s => must(!(s.img && s.img.length),
    s.t + ' 이 그림을 칸 끝(sec.img)에 달고 있다 — 단계(step.img) 안으로 옮길 것'));
  return '칸 ' + allSecs.length + '개';
});

chk('그림 없는 칸이 너무 많지 않다', () => {
  /* 설명만 있고 그림이 하나도 없는 칸이 늘면 설명서가 다시 글덩어리가 된다.
     '이럴 때는 이렇게'(문답)처럼 그림이 필요 없는 칸은 있을 수 있어 수를 센다 */
  const none = allSecs.filter(s => !(s.steps || []).some(st => (st.img || []).length));
  must(none.length <= 2, '그림이 하나도 없는 칸이 많다: ' + none.map(s => s.t).join(', '));
  return '그림 없는 칸 ' + none.length + '개';
});

chk('☠️ 로그인을 "안 해도 된다" 로 안내하지 않는다', () => {
  /* ★ 2026-09-20 사용자 결정 — 로그인을 해야 얻는 게 실제로 많다.
       · 무료 AI 지급은 로그인한 계정에만 준다
       · 동선의 실제 주행 경로·주행거리는 서버를 거쳐 로그인이 필요하다
       · 공유·팀·채팅·서버 백업도 마찬가지
     그런데 설명서에 "혼자 쓰면 안 해도 된다" 가 적혀 있었다. 사실이긴 해도
     읽는 사람을 **손해 보는 쪽으로** 이끈다.
     ☠️ 이런 문구는 나중에 무심코 다시 들어오기 쉽다(친절해 보여서). 못 박는다.
     ⚠️ 거짓말을 하라는 게 아니다 — '사진·보고서는 로그인 없이도 된다' 는 사실이라
        그대로 두고, '안 해도 된다' 는 권유만 막는다. */
  const text = JSON.stringify(D);
  const banned = [
    '안 하셔도 됩니다', '안 해도 됩니다', '안 하셔도 돼', '할 필요 없',
    '혼자 쓰시면 안', '혼자 쓸 때는 안'
  ];
  banned.forEach(w => must(text.indexOf(w) < 0,
    '로그인을 안 해도 된다고 안내하는 문구가 있습니다: "' + w + '"'));
  return '깨끗';
});

chk('로그인하면 얻는 것을 실제로 적어 두었다', () => {
  /* 막기만 하고 이유를 안 적으면 '왜 해야 하지' 가 남는다 */
  const text = JSON.stringify(D);
  must(/무료 AI|AI 일정등록 15회|일정등록 15회/.test(text), '무료 AI 지급 안내가 없습니다');
  must(text.indexOf('실선') >= 0 || text.indexOf('주행 경로') >= 0, '동선 실선 안내가 없습니다');
  must(text.indexOf('서버 백업') >= 0, '서버 백업 안내가 없습니다');
  /* 맨 앞 안내문에서도 한 번 권한다 */
  must(/로그인/.test(D.lead || ''), '맨 앞 안내문에 로그인 권유가 없습니다');
});

chk('탭 이름이 실제 탭바와 같다', () => {
  /* 앱에서 탭 이름을 바꾸면 설명서도 같이 바꿔야 한다. 여기서 걸린다 */
  const tabs = (HTML.match(/<span class="tab-lb">([^<]+)<\/span>/g) || [])
    .map(m => m.replace(/.*">|<\/span>/g, ''));
  must(tabs.length >= 4, '탭바를 index.html 에서 못 찾았다');
  const text = JSON.stringify(D);
  tabs.forEach(t => must(text.indexOf(t) >= 0, '설명서에 탭 이름이 없다: ' + t));
  return tabs.join('·');
});

console.log('\n── 그림 자리 (여기가 제일 중요하다) ──');

chk('그림이 비면 기본에선 아무것도 안 그린다', () => {
  const sec = { t: 'x', steps: [{ h: 'a', d: 'b', img: [{ src: '', cap: '이건 안 보여야 한다' }] }] };
  const h = base.window.__manual.bodyHtml(sec);
  must(h.indexOf('이건 안 보여야 한다') < 0, '빈 그림의 설명이 화면에 나온다');
  must(h.indexOf('mn-slot') < 0, '빈 액자(mn-slot)가 그려진다');
  must(h.indexOf('그림 자리') < 0, "'그림 자리' 글자가 나온다");
  must(h.indexOf('<img') < 0, '없는 그림을 <img> 로 그린다');
});

chk('지금 설명서에는 빈 액자가 하나도 안 나온다', () => {
  /* 내용 전체를 실제로 그려 본다 — 위 검사는 한 칸짜리라서 빠져나갈 수 있다 */
  const all = base.window.__manual.listHtml(D);
  must(all.indexOf('mn-slot') < 0, '어딘가에서 빈 액자가 그려진다');
  must(all.indexOf('그림 자리') < 0, "어딘가에 '그림 자리' 글자가 남아 있다");
  return '칸 ' + allSecs.length + '개 모두 깨끗';
});

chk('슬롯 보기를 켜면 그때만 액자가 보인다', () => {
  const on = load({ ac_manual_slots: '1' });
  const sec = { t: 'x', steps: [{ h: 'a', img: [{ src: '', cap: '찍어올 화면' }] }] };
  const h = on.window.__manual.bodyHtml(sec);
  must(h.indexOf('mn-slot') >= 0, '켰는데도 액자가 안 나온다');
  must(h.indexOf('찍어올 화면') >= 0, '켰는데 설명이 안 나온다');
});

chk('슬롯 보기 기본값은 꺼짐이다', () => {
  must(base.window.__manual.slotsOn() === false, '저장된 값이 없는데 켜져 있다');
  must(load({ ac_manual_slots: '0' }).window.__manual.slotsOn() === false, "'0' 인데 켜져 있다");
});

chk('그림을 넣으면 <img> 로 나오고, 깨지면 그 그림만 사라진다', () => {
  const sec = { t: 'x', steps: [{ h: 'a', img: [{ src: 'tabs-1.png', cap: '설명' }] }] };
  const h = base.window.__manual.bodyHtml(sec);
  must(/<img[^>]+src="assets\/manual\/tabs-1\.png"/.test(h), 'src 가 assets/manual/ 로 안 붙는다');
  must(h.indexOf('onerror') >= 0, '깨진 그림을 치우는 onerror 가 없다');
  must(/onerror="[^"]*mn-fig[^"]*remove\(\)/.test(h), 'onerror 가 그 그림(.mn-fig)만 지우지 않는다');
});

chk('☠️ 세로 그림은 폭을 묶는다 (화면을 통째로 먹지 않게)', () => {
  /* 휴대폰 화면을 통째로 찍으면 9:19.5 다. width:100% 로 두면 390px 폭에서 높이 845px —
     설명 한 줄 읽자고 한 화면을 넘겨야 한다. 실제로 그런 상태였다(2026-09-20 사용자 지적).
     ⚠️ 가로/세로는 그림을 불러와서 판단한다 → 그 코드가 살아 있는지 본다. */
  const sec = { t: 'x', steps: [{ h: 'a', img: [{ src: 'p.png', cap: '설명' }] }] };
  const h = base.window.__manual.bodyHtml(sec);
  must(/onload="[^"]*naturalHeight[^"]*naturalWidth/.test(h),
    '그림 비율을 안 본다 — 세로 캡처가 화면을 통째로 먹는다');
  must(/onload="[^"]*mn-fig-tall/.test(h), '세로일 때 붙일 표식이 없다');
  must(CSS.indexOf('.mn-fig-tall img') >= 0, 'styles.css 에 세로 그림 규칙이 없다');
  must(/\.mn-fig-tall img\{[^}]*max-width:\s*\d+px/.test(CSS),
    '세로 그림의 폭을 안 묶는다');
});

chk('빈 액자도 가로/세로를 갈라 보여 준다', () => {
  /* ☠️ 액자는 가로로 납작한데 실제로는 세로 캡처를 넣어야 하면
     "이 비율로 어떻게 넣지" 가 된다 — 만드는 사람이 헤맨다. */
  const on = load({ ac_manual_slots: '1' });
  const wide = on.window.__manual.bodyHtml(
    { t: 'x', steps: [{ h: 'a', img: [{ src: '', cap: '조각' }] }] });
  const tall = on.window.__manual.bodyHtml(
    { t: 'x', steps: [{ h: 'a', img: [{ src: '', shape: 'tall', cap: '한 화면' }] }] });
  must(wide.indexOf('mn-slot-tall') < 0, '가로 자리에 세로 표식이 붙는다');
  must(tall.indexOf('mn-slot-tall') >= 0, '세로 자리가 가로로 그려진다');
  must(wide.indexOf('가로로 잘라서') >= 0, '가로 자리에 안내가 없다');
  must(tall.indexOf('세로 화면') >= 0, '세로 자리에 안내가 없다');
  must(/\.mn-slot-tall \.mn-slotbox\{[^}]*height:\s*\d+px/.test(CSS),
    '세로 액자의 높이 규칙이 없다');
});

chk('설명서에 세로 화면이 실제로 표시돼 있다', () => {
  /* 전부 가로로 두면 "달력과 아래 탭을 같이" 같은 캡션을 만족시킬 수 없다 */
  let tall = 0, wide = 0;
  allImgs.forEach(x => { if (x.im.shape === 'tall') tall++; else wide++; });
  must(tall > 0, '세로로 표시된 칸이 하나도 없다');
  must(wide > 0, '전부 세로다 — 조각 그림이 없다');
  return '세로 ' + tall + ' / 가로 ' + wide;
});

chk('세로 그림 한 장이면 글 옆으로 돌린다', () => {
  /* 세로 캡처를 글 아래에 깔면 단계 하나가 화면 절반을 먹는다(2026-09-20 사용자 지적).
     ⚠️ 세로 한 장일 때만. 가로 조각은 절반 폭이면 가리키는 버튼이 안 보이고,
        두 장이면 좁은 칸에 둘 다 못 알아본다. */
  const f = base.window.__manual.splitStep;
  must(f({ img: [{ src: '', shape: 'tall' }] }) === true, '세로 한 장을 안 나눈다');
  must(f({ img: [{ src: '' }] }) === false, '가로 조각까지 나눈다');
  must(f({ img: [{ shape: 'tall' }, { shape: 'tall' }] }) === false, '두 장인데 나눈다');
  must(f({}) === false && f({ img: [] }) === false, '그림이 없는데 나눈다');
  must(CSS.indexOf('.mn-li-split') >= 0, 'styles.css 에 .mn-li-split 이 없다');
  must(/\.mn-li-split > \.mn-pics\{[^}]*float:\s*right/.test(CSS), '그림을 옆으로 안 띄운다');
  must(/\.mn-li-split::after\{[^}]*clear:\s*both/.test(CSS), '띄움을 안 풀어 다음 단계가 밀려 올라간다');
});

chk('☠️ 띄운 그림은 글보다 **앞**에 나와야 한다', () => {
  /* float 은 자기 **뒤에 오는 글만** 감싼다. 글 다음에 넣으면 옆으로 안 올라가고
     글 아래에서 시작해 왼쪽이 통째로 빈다 — 실제로 그렇게 만들었다가 고쳤다.
     ⚠️ 화면으로는 "그림이 오른쪽에 있네" 로 보여서 눈으로는 잘 안 잡힌다. */
  const on = load({ ac_manual_slots: '1' });
  const h = on.window.__manual.bodyHtml({
    t: 'x', steps: [{ h: '제목', d: '설명', img: [{ src: '', shape: 'tall', cap: '자리' }] }]
  });
  const li = h.slice(h.indexOf('<li'), h.indexOf('</li>'));
  must(li.indexOf('mn-li-split') >= 0, '나누는 표식이 안 붙었다');
  must(li.indexOf('mn-pics') < li.indexOf('<b>'),
    '그림이 글 뒤에 있다 — 옆으로 안 올라가고 왼쪽이 빈다');
  /* 안 나누는 단계는 예전처럼 글 다음에 */
  const h2 = on.window.__manual.bodyHtml({
    t: 'x', steps: [{ h: '제목', d: '설명', img: [{ src: '', cap: '조각' }] }]
  });
  const li2 = h2.slice(h2.indexOf('<li'), h2.indexOf('</li>'));
  must(li2.indexOf('mn-pics') > li2.indexOf('<b>'), '가로 그림까지 앞으로 갔다');
});

chk('늦게 들어온 그림도 앞으로 옮긴다', () => {
  /* 실제 그림은 불러온 뒤에야 세로인 줄 안다(onload). 그때 표식만 붙이고
     자리를 안 옮기면 위와 같은 '왼쪽이 빈' 모양이 된다. */
  must(/insertBefore\(P,\s*L\.firstChild\)/.test(MJS),
    'onload 에서 그림을 앞으로 안 옮긴다');
  must(/querySelectorAll\(\\?'\.mn-fig\\?'\)\.length===1/.test(MJS.replace(/\\'/g, "'")),
    '그림이 두 장일 때도 나눈다');
});

chk('그림을 눌러 크게 볼 수 있다', () => {
  /* 세로를 200px 로 묶은 대신 열어 볼 길을 줘야 한다 */
  must(/function zoom\(/.test(MJS), '크게 보기가 없다');
  must(/mn-zoom ov-lock/.test(MJS), '크게 보기에 ov-lock 이 없다');
  must(/id="mnZoomClose"/.test(MJS), "크게 보기 닫기 id 에 'Close' 가 없다");
  must(/closest\('\.mn-fig img'\)/.test(MJS), '그림 누름을 안 받는다');
  must(CSS.indexOf('.mn-zoom{') >= 0, 'styles.css 에 .mn-zoom 이 없다');
});

chk('그림 주소 규칙', () => {
  const f = base.window.__manual.srcOf;
  must(f('a.png') === 'assets/manual/a.png', '파일 이름에 폴더가 안 붙는다');
  must(f('p2/a.png') === 'assets/manual/p2/a.png', '하위 폴더가 안 붙는다');
  must(f('https://x/a.png') === 'https://x/a.png', 'http 주소를 건드린다');
  must(f('data:image/png;base64,AA') === 'data:image/png;base64,AA', 'data: 를 건드린다');
  must(f('/a.png') === '/a.png', '절대경로를 건드린다');
  must(f('') === '' && f(null) === '' && f('   ') === '', '빈 값이 빈 값으로 안 나온다');
});

console.log('\n── 화면 ──');

chk('그림이 그 단계 안(<li>)에 들어간다', () => {
  /* 끝에 붙으면 '여기를 누르세요' 와 그 화면이 떨어진다. 위치를 실제로 잰다 */
  const sec = {
    t: 'x', tip: '도움말',
    steps: [
      { h: '첫째', d: '설명1', img: [{ src: 'a.png', cap: '첫 그림' }] },
      { h: '둘째', d: '설명2' }
    ]
  };
  const h = base.window.__manual.bodyHtml(sec);
  const iImg = h.indexOf('a.png');
  const iSecond = h.indexOf('둘째');
  const iTip = h.indexOf('도움말');
  must(iImg > 0, '그림이 안 그려졌다');
  must(iImg < iSecond, '그림이 다음 단계보다 뒤에 있다 — 단계 안에 안 들어갔다');
  must(iImg < iTip, '그림이 도움말보다 뒤에 있다 — 칸 끝에 몰렸다');
  /* 그 <li> 안에 들어 있는지도 본다 */
  const li = h.slice(h.indexOf('<li>'), h.indexOf('</li>'));
  must(li.indexOf('a.png') >= 0, '그림이 그 단계의 <li> 밖에 있다');
});

chk('글자가 HTML 로 새지 않는다', () => {
  const sec = { t: 'x', steps: [{ h: '<b>참</b>', d: 'a & b <i>기울임</i>' }], tip: '<script>' };
  const h = base.window.__manual.bodyHtml(sec);
  must(h.indexOf('<b>참</b>') < 0, '단계 제목의 태그가 그대로 들어간다');
  must(h.indexOf('&lt;b&gt;') >= 0, '태그가 글자로 안 바뀐다');
  must(h.indexOf('<script>') < 0, '도움말의 태그가 그대로 들어간다');
  must(h.indexOf('a &amp; b') >= 0, '& 가 안 바뀐다');
  must(h.indexOf('<i>') < 0, '설명의 태그가 살아난다');
});

chk('설명의 **굵게** 만 살고 나머지는 글자로 남는다', () => {
  const f = base.window.__manual.md;
  must(f('가 **나** 다') === '가 <b>나</b> 다', '굵게가 안 된다');
  must(f('<b>진짜태그</b>').indexOf('<b>진짜태그') < 0, '글 속 태그가 살아난다');
  must(f('**<img src=x onerror=1>**') === '<b>&lt;img src=x onerror=1&gt;</b>',
    'esc 보다 별표를 먼저 바꿔 태그가 살아난다');
  must(f('별 하나 * 는 그대로') === '별 하나 * 는 그대로', '별 하나를 건드린다');
});

chk('칸마다 제목 버튼 하나 + 접힌 본문 하나', () => {
  const h = base.window.__manual.listHtml(D);
  const heads = (h.match(/class="mn-h"/g) || []).length;
  const bodies = (h.match(/class="mn-b" hidden/g) || []).length;
  must(heads === allSecs.length, '제목 버튼 수가 칸 수와 다르다 (' + heads + '/' + allSecs.length + ')');
  must(bodies === allSecs.length, '처음부터 접혀 있지 않은 본문이 있다 (' + bodies + '/' + allSecs.length + ')');
  return heads + '칸';
});

chk('한 번에 하나만 펼친다', () => {
  /* 열 때 나머지를 먼저 접는지 — 클릭 처리기 안에서 전부 순회하며 on 을 떼는 코드가 있어야 한다 */
  must(/willOpen[\s\S]{0,400}classList\.remove\('on'\)/.test(MJS), '다른 칸을 접는 코드가 없다');
});

chk('뒤로가기 계약: ov-lock + 닫기 버튼 id 에 Close', () => {
  must(/ov\.className\s*=\s*'mn-ov ov-lock'/.test(MJS), "오버레이에 ov-lock 이 없다");
  must(/id="mnClose"/.test(MJS), "닫기 버튼 id 에 'Close' 가 없다");
  must(/querySelector\('#mnClose'\)\.onclick\s*=\s*close/.test(MJS), '닫기 버튼이 close 에 안 묶여 있다');
});

chk('두 번 열려도 겹치지 않는다', () => {
  must(/if \(_ov\) return;/.test(MJS), '이미 열려 있을 때 막는 코드가 없다');
});

console.log('\n── 연결 ──');

chk('manual_data.js 가 manual.js 보다 먼저 실린다', () => {
  /* ☠️ 2026-09-19 이 검사를 처음 쓸 때 indexOf('js/manual_data.js') 로 찾았다가
       **가짜로 통과**했다 — 바로 위 설정 칸의 주석에 두 파일 이름이 같은 순서로
       적혀 있어서, script 태그를 뒤집어도 그 주석이 먼저 걸렸다.
       (일부러 순서를 뒤집어 보고서야 알았다)
     → 반드시 <script> 태그만 본다. 주석·본문에 이름이 몇 번 나오든 상관없게. */
  const tags = (HTML.match(/<script[^>]+src="\.\/js\/manual(?:_data)?\.js"[^>]*>/g) || [])
    .map(t => (t.indexOf('manual_data.js') >= 0 ? 'data' : 'view'));
  must(tags.length === 2, 'script 태그가 둘이 아니다: ' + JSON.stringify(tags));
  must(tags[0] === 'data', '순서가 뒤집혔다 — 열면 내용을 못 읽는다');
});

chk('설정 맨 아래 앱 정보에 여는 자리가 있다', () => {
  /* ★ 2026-09-21 자리를 옮겼다 — '소개' 칸의 큰 파란 버튼은 소개 글과 섞여
       눈에 안 들어왔다(사용자). 지금은 로고·버전 아래 작은 메뉴다. */
  must(/id="setManualIn"[^>]*onclick="window\.openManual && window\.openManual\(\)/.test(HTML),
       '앱 정보에 사용설명서 링크가 없다');
  must(/id="setManualWeb"[^>]*onclick="window\.openManualWeb && window\.openManualWeb\(\)/.test(HTML),
       '브라우저에서 보기 링크가 없다');
  const i = HTML.indexOf('id="setManualIn"');
  const ver = HTML.indexOf('id="appVersion"');
  must(ver > 0 && ver < i, '앱 정보(버전) 아래가 아니다');
  must(HTML.indexOf('set-mini-menu') > 0, '작은 메뉴 모양이 아니다');
});

chk('브라우저로 여는 길은 한 곳에만 적는다', () => {
  /* 주소가 두 군데 박히면 한쪽만 고쳐진다 — 설명서 머리줄 🌐 도 같은 함수를 쓴다 */
  const MJS = read(path.join(JS, 'manual.js'));
  const hits = (MJS.match(/work-report-826ec\.web\.app\/manual\.html/g) || []).length;
  must(hits === 1, '주소가 ' + hits + '군데 적혀 있다 (한 곳이어야 한다)');
  must(/window\.openManualWeb = openWeb;/.test(MJS), 'openManualWeb 이 없다');
  must(/_webBtn\.onclick = function \(\) \{ openWeb\(\); \};/.test(MJS), '🌐 가 공용 함수를 안 쓴다');
});

chk('window.openManual 이 실제로 생긴다', () => {
  must(typeof base.window.openManual === 'function', 'openManual 이 함수가 아니다');
  must(typeof base.window.closeManual === 'function', 'closeManual 이 함수가 아니다');
});

chk('쓰는 CSS 이름이 styles.css 에 다 있다', () => {
  /* 한쪽만 이름을 바꾸면 글자만 남고 모양이 사라진다 — 눈으로는 앱을 켜야 보인다 */
  const used = ['mn-ov', 'mn-head', 'mn-title', 'mn-x', 'mn-scroll', 'mn-lead', 'mn-part',
    'mn-item', 'mn-h', 'mn-ht', 'mn-ar', 'mn-b', 'mn-steps', 'mn-tip',
    'mn-pics', 'mn-fig', 'mn-fig-tall', 'mn-slot', 'mn-slot-tall', 'mn-slotbox',
    'mn-zoom', 'mn-zoom-x', 'mn-li-split', 'mn-end'];
  used.forEach(c => must(CSS.indexOf('.' + c) >= 0, 'styles.css 에 .' + c + ' 가 없다'));
  return used.length + '개';
});

console.log('\n' + (fails ? '❌ ' + fails + '개 실패' : '✅ 전부 통과') + ' (' + oks + '개)');
process.exit(fails ? 1 : 0);
