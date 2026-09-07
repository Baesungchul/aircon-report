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

console.log('\n' + (fails ? '❌ 실패 ' + fails + '건 / ' : '✅ ') + '통과 ' + oks + '건');
process.exit(fails ? 1 : 0);
