/* ═══════════════════════════════════════════════════════════
   tools/test-calendar-anim.js
   달력 달 이동이 부드럽게 넘어가는 배선이 끊기지 않았는지 검사한다
   ----------------------------------------------------------------
   왜 필요한가 (2026-09-07 사용자 신고):
     "달력 이동할 때 깨끗하게 이동 안 되고 버벅인다. 프레임이 적다고 할까?"

     원인이 둘이었고, 둘 다 **화면을 봐서는 원인을 알 수 없는 종류**였다.
       ① 격자에 레이어 승격이 없어 옮기는 매 프레임마다 칸 42개를 다시 그렸다.
       ② loadCalendarData() 가 미끄러지는 도중에 끝나면 renderCalendarGrid() 가
          innerHTML 로 격자를 통째로 새로 만들어, 그 프레임이 통째로 밀렸다.

     고친 방식이 "잠금을 걸었다가 푼다"는 것이라, **푸는 길이 하나라도 끊기면
     달력에 일정 점이 영영 안 찍힌다.** 눈으로는 '일정이 사라진 버그'로 보이고
     원인은 애니메이션 코드에 있다 — 그래서 여기서 못 박아 둔다.
═══════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path');
const WWW = path.join(__dirname, '..', 'www');

let fails = 0, oks = 0;
function chk(name, fn) {
  try { const r = fn(); console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; }
  catch (e) { console.log('  ❌ ' + name + ' — ' + e.message); fails++; }
}
const must = (c, m) => { if (!c) throw new Error(m); };

const cal = fs.readFileSync(path.join(WWW, 'js', 'calendar.js'), 'utf8');
const css = fs.readFileSync(path.join(WWW, 'styles.css'), 'utf8');

/* _navMonth 본문만 잘라 본다 */
const navAt = cal.indexOf('function _navMonth(dir, selDate)');
must(navAt > 0, '_navMonth 를 못 찾았습니다');
const nav = cal.slice(navAt, cal.indexOf('function _navDay(', navAt));

console.log('\n[1] 레이어 승격 — 옮기는 동안 다시 그리지 않게');

chk('.cal-anim 규칙이 있다', () => {
  must(/\.cal-grid\.cal-anim\s*\{[^}]*will-change\s*:\s*transform/.test(css),
       '.cal-grid.cal-anim 에 will-change:transform 이 없습니다 — 매 프레임 다시 그립니다');
  return '있음';
});

chk('will-change 를 항상 켜 두지는 않는다', () => {
  const bare = css.match(/\n\.cal-grid\s*\{([^}]*)\}/);
  must(bare, '.cal-grid 기본 규칙을 못 찾았습니다 (검사 기준이 낡았습니다)');
  must(!/will-change/.test(bare[1]),
       '.cal-grid 가 항상 레이어를 물고 있습니다 — 메모리를 먹고 기기에 따라 글자가 뿌옇습니다');
  return '움직일 때만';
});

chk('트랜지션을 걸기 전에 붙인다', () => {
  const add = nav.indexOf("classList.add('cal-anim')");
  const tr  = nav.indexOf('g0.style.transition');
  must(add > 0 && tr > 0, '달 이동에서 .cal-anim 을 안 붙입니다');
  must(add < tr, '트랜지션을 건 뒤에 붙입니다 — 그 프레임에는 레이어가 안 생겨 소용이 없습니다');
  return '순서 정상';
});

chk('가로 드래그가 확정될 때도 붙인다', () => {
  must(/mode = 2; grid\.classList\.add\('cal-anim'\)/.test(cal),
       '손가락으로 끌 때는 승격이 안 됩니다 — 스와이프가 제일 많이 버벅입니다');
  return '드래그도 승격';
});

console.log('\n[2] 애니메이션 도중 격자를 다시 만들지 않게');

chk('달 이동 중에는 다시 그리기를 미룬다', () => {
  const g = cal.indexOf('function renderCalendarGrid()');
  must(g > 0, 'renderCalendarGrid 를 못 찾았습니다');
  const head = cal.slice(g, g + 220);
  must(/_navAnimating\s*\)\s*\{\s*_gridRenderPending = true; return;/.test(head),
       '애니메이션 중에도 격자를 새로 만듭니다 — 그 프레임이 통째로 밀립니다');
  must(/function _renderCalendarGridNow\(\)/.test(cal), '실제로 그리는 함수가 분리돼 있지 않습니다');
  return '미룸';
});

chk('_navMonth 는 자기가 건 잠금에 막히지 않는다', () => {
  must(/_renderCalendarGridNow\(\);\s*\/\/ ★ 새 달 날짜 칸/.test(nav),
       '_navMonth 가 관문을 거치는 renderCalendarGrid 를 부릅니다 — 새 달 뼈대가 안 그려집니다');
  return '직접 호출';
});

console.log('\n[3] 잠금이 반드시 풀리는가 (안 풀리면 일정 점이 영영 안 찍힌다)');

chk('푸는 길이 둘이다 — transitionend 와 안전 타이머', () => {
  must(/addEventListener\('transitionend', done\)/.test(nav), 'transitionend 로 안 풉니다');
  must(/setTimeout\(function \(\) \{ _unlockGrid\(myNav\); \}, IN \+ \d+\)/.test(nav),
       '안전 타이머가 없습니다 — transitionend 가 안 오면 영영 잠깁니다');
  return '2중';
});

chk('풀 때 미뤄 둔 그리기를 반드시 한 번 실행한다', () => {
  const u = cal.indexOf('function _unlockGrid(');
  const body = cal.slice(u, cal.indexOf('\n  }', u));
  must(/_gridRenderPending\s*\)\s*\{\s*_gridRenderPending = false; renderCalendarGrid\(\);/.test(body),
       '미뤄 둔 그리기를 실행하지 않습니다 — 달력에 일정 점이 영영 안 찍힙니다');
  return '실행함';
});

chk('빠르게 두 번 넘겨도 남의 잠금을 풀지 않는다', () => {
  must(/var _navToken = 0;/.test(cal), '세대 번호가 없습니다');
  must(/token != null && token !== _navToken/.test(cal),
       '_unlockGrid 가 세대를 확인하지 않습니다 — 이전 이동의 타이머가 이번 이동을 깹니다');
  must(/myNav !== _navToken/.test(nav), '이전 회차의 후속 처리가 이번 이동을 덮어씁니다');
  return '세대로 구분';
});

console.log('\n[4] 들어오는 애니메이션이 실제로 보이는가');

chk('시작 위치를 확정하는 reflow 가 있다', () => {
  must(/void g2\.offsetWidth;/.test(nav),
       'void offsetWidth 가 없습니다 — 시작값과 목표값이 한 번에 합쳐져 애니메이션이 사라집니다');
  const v = nav.indexOf('void g2.offsetWidth;');
  const start = nav.indexOf("g2.style.transform = 'translateX(");
  const end = nav.indexOf("g2.style.transform = 'none'");
  must(start < v && v < end, 'reflow 가 시작값과 목표값 사이에 있지 않습니다');
  return '자리 정상';
});

chk('움직이는 거리가 화면을 가로지르지 않는다', () => {
  const m = nav.match(/var OUT = (\d+), IN = (\d+), DIST = (\d+);/);
  must(m, '애니메이션 값들을 못 찾았습니다 (검사 기준이 낡았습니다)');
  must(+m[3] <= 40, '이동 거리가 ' + m[3] + '% 입니다 — 멀수록 프레임이 빠졌을 때 티가 납니다');
  must(+m[1] + +m[2] <= 400, '전체 ' + (+m[1] + +m[2]) + 'ms 로 너무 깁니다');
  return m[1] + 'ms + ' + m[2] + 'ms · ' + m[3] + '%';
});

console.log('\n[5] 펼친 달력을 접을 때 (2026-09-21)');

/* ☠️ 사용자: "펼친 달력을 접을 때 동작이 부자연스럽다".
      화면을 프레임 단위로 찍어 원인을 찾았다 — 예전에는 격자를 **접힘 모양인데 화면 가득한
      높이**로 먼저 그려 놓고 나서 줄였다. 어느 상태에도 없는 '늘어난 달력'이 200ms 넘게
      보이다가 쭈그러드니 세 토막으로 읽혔다.
      → 격자를 처음부터 제 크기로 그리고, 걷히는 목록은 유령으로 띄워 레이아웃에서 빼낸다.
      아래 검사는 그 네 가지 약속을 지킨다. 하나라도 풀리면 예전 모습으로 되돌아간다. */

/* ☠️ 2026-09-21 여기서 한 번 속았다 — 규칙이 사라졌는지 보려고 **글자**를 찾았는데,
      바로 위 주석에 "예전에는 … 로 숨겼다" 라고 그 선택자를 적어 둬서 규칙을 지워도
      검사가 실패했다. 규칙을 볼 때는 주석을 걷어내고 본다. */
const cssR = css.replace(/\/\*[\s\S]*?\*\//g, '');

const COL = (function () {
  const at = cal.indexOf('function _collapseAnim(');
  if (at < 0) return '';
  const end = cal.indexOf('function _collapseDone(', at);
  return cal.slice(at, end > at ? end : at + 4000);
})();

chk('접기 연출이 한 함수에 모여 있다', () => {
  must(COL, '_collapseAnim 을 못 찾았습니다');
  must(/function _collapseDone\(/.test(cal), '_collapseDone(뒷정리)이 없습니다');
  return '_collapseAnim · _collapseDone';
});

chk('☠️ 격자를 늘렸다 줄이지 않는다 — 접힘 크기로 먼저 그린다', () => {
  /* cal-expanded 를 벗기고 인라인 높이를 지운 뒤 그려야 '접힘 크기'가 나온다.
     이 순서가 깨지면 늘어난 격자가 다시 보인다. */
  const off = COL.indexOf("classList.remove('cal-expanded')");
  const clr = COL.indexOf("grid.style.height       = ''");
  const draw = COL.indexOf('renderCalendarGrid()');
  must(off > 0 && clr > 0 && draw > 0, '순서를 이루는 세 줄 중 빠진 것이 있습니다');
  must(off < clr && clr < draw,
       '펼침 클래스 제거 → 인라인 높이 지우기 → 다시 그리기 순서가 아닙니다');
  return '벗기고 · 지우고 · 그린다';
});

chk('☠️ 목표 높이를 지금 실측한다 (기억해 둔 옛 값이 아니라)', () => {
  /* 달이 5줄↔6줄로 바뀌거나 글자 크기를 바꿨으면 옛 값과 어긋나 끝에 한 번 툭 튄다 */
  must(/var nat = Math\.max\(1, grid\.offsetHeight\)/.test(COL),
       '접힘 높이를 실측하지 않습니다');
  must(!/_lastNaturalH/.test(COL) && !/_naturalHeight\(/.test(COL),
       '기억해 둔 옛 높이를 목표로 씁니다 — 달이 바뀌면 끝에서 튑니다');
  return 'offsetHeight 실측';
});

chk('☠️ 걷히는 목록을 레이아웃에서 빼낸다 (유령)', () => {
  /* 빼내지 않으면 격자를 그리는 순간 목록이 아래로 밀려 덜컥인다 */
  must(/cal-ghost/.test(COL), '유령을 만들지 않습니다');
  must(/while \(grid\.firstChild\) ghost\.appendChild/.test(COL),
       '지금 보이는 것을 유령으로 옮기지 않습니다');
  must(/\.cal-ghost\{[^}]*position:absolute/.test(cssR),
       'CSS 에서 유령을 띄우지 않습니다 — 레이아웃에 남으면 목록이 밀립니다');
  return '유령으로 띄움';
});

chk('☠️ 옛 규칙이 유령을 즉시 지워 버리지 않는다', () => {
  /* .cal-grid.cal-swapping .cal-ag-day{opacity:0} 이 남아 있으면 유령이 그 자리에서
     사라져 '걷히는 모습'이 통째로 없어진다. 화면은 멀쩡해 보이고 연출만 사라진다. */
  must(!/\.cal-grid\.cal-swapping \.cal-ag-day/.test(cssR),
       '목록을 즉시 숨기는 옛 규칙이 남아 있습니다 — 유령이 걷히지 않습니다');
  return '없음';
});

chk('드래그로 접을 때 흐려진 정도를 이어받는다', () => {
  /* 손가락으로 끌어 올리는 동안 목록은 이미 거의 투명하다.
     여기서 1 로 되돌리면 손을 떼는 순간 한 번 번쩍인다 */
  must(/var op\s*=\s*grid\.style\.opacity/.test(COL), '지금 투명도를 읽지 않습니다');
  must(/ghost\.style\.opacity\s*=/.test(COL), '유령이 그 투명도를 이어받지 않습니다');
  return '이어받음';
});

chk('무거운 일을 트랜지션 **앞**에서 끝낸다', () => {
  /* 다시 그리기가 트랜지션 중간에 끼어들면 그 프레임이 통째로 밀린다.
     실제로 재 보니 예전 방식은 멈춤이 시작 150~200ms 지점(움직이는 한가운데)에 생겼고,
     새 방식은 시작 0ms 지점 하나로 모였다. */
  const draw = COL.indexOf('renderCalendarGrid()');
  const tr = COL.indexOf("grid.style.transition = 'height");
  must(draw > 0 && tr > 0, '다시 그리기나 트랜지션을 못 찾았습니다');
  must(draw < tr, '트랜지션을 걸고 나서 다시 그립니다 — 움직이는 도중에 프레임이 밀립니다');
  must(/requestAnimationFrame\(function \(\) \{/.test(COL), '다음 프레임으로 넘기지 않습니다');
  return '그리고 → 움직인다';
});

chk('시작 높이를 확정하는 reflow 가 있다', () => {
  must(/void grid\.offsetHeight;/.test(COL),
       'reflow 가 없습니다 — 시작값과 목표값이 합쳐져 높이 애니메이션이 사라집니다');
  const set = COL.indexOf("grid.style.height   = from + 'px'");
  const v = COL.indexOf('void grid.offsetHeight;');
  const go = COL.indexOf("grid.style.height     = nat + 'px'");
  must(set > 0 && v > set && go > v, 'reflow 가 시작값과 목표값 사이에 있지 않습니다');
  return '자리 정상';
});

chk('접히는 동안 화면을 잠갔다가 끝에 푼다', () => {
  /* 안 잠그면 달력이 아직 클 때 매출·상세가 튀어나오고 스크롤이 생겨 덜컹인다 */
  must(/classList\.add\('cal-collapsing'\)/.test(COL), '접히는 동안 잠그지 않습니다');
  must(/\.cal-collapsing\{overflow:hidden/.test(cssR.replace(/\s/g, '')),
       'CSS 에 잠금 규칙이 없습니다');
  const done = cal.slice(cal.indexOf('function _collapseDone('));
  must(/classList\.remove\('cal-collapsing'\)/.test(done.slice(0, 600)), '잠금을 안 풉니다');
  return '잠그고 · 푼다';
});

chk('☠️ 유령과 잠금은 어느 길로 끝나도 치운다', () => {
  /* 도중에 다시 펼치면(빠르게 두 번) 유령이 화면에 남아 달력을 덮는다 */
  const done = cal.slice(cal.indexOf('function _collapseDone('), cal.indexOf('function _collapseDone(') + 700);
  must(/removeChild\(ghost\)/.test(done), '유령을 치우지 않습니다');
  const calls = (COL.match(/_collapseDone\(/g) || []).length;
  must(calls >= 2, '뒷정리를 부르는 길이 ' + calls + '개뿐입니다 (취소 · 정상 두 길이 필요합니다)');
  must(/if \(_expanded\) \{ _collapseDone/.test(COL), '그새 다시 펼쳐졌을 때 정리하지 않습니다');
  return calls + '곳에서 부름';
});

chk('격자 보기의 유령은 7열을 지킨다', () => {
  /* 블록으로 두면 칸 42개가 세로로 쏟아진다 */
  must(/cal-ghost-grid/.test(COL), '격자 보기용 유령 표시가 없습니다');
  must(/\.cal-ghost-grid\{[^}]*grid-template-columns:repeat\(7/.test(cssR),
       'CSS 에서 7열을 지키지 않습니다');
  must(/\.cal-ghost-grid \.cal-cell\{/.test(cssR),
       '유령 안의 칸이 펼친 모습을 잃습니다 (body 에서 cal-expanded 를 이미 벗겼습니다)');
  return '7열 유지';
});

chk('펼치기는 손대지 않았다', () => {
  /* 펼칠 때는 안에 든 목록 크기가 그대로고 통만 커져서 원래 자연스럽다.
     괜히 같이 고치면 멀쩡한 쪽을 망친다 (2026-08-17 크로스페이드 실패 이력) */
  const ap = cal.indexOf('function applyHeight()');
  const b = cal.slice(ap, ap + 500);
  must(/_expandedHeight\(\) \+ 'px'/.test(b), '펼침 높이 계산이 바뀌었습니다');
  must(/_fitExpanded\(animate \? 260 : 0\)/.test(b), '펼친 뒤 실측 보정이 사라졌습니다');
  return '그대로';
});

console.log('\n' + (fails ? '❌ 실패 ' + fails + '건 / ' : '✅ ') + '통과 ' + oks + '건');
process.exit(fails ? 1 : 0);
