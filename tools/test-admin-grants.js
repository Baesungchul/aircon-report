/* ═══════════════════════════════════════════════════════════
   tools/test-admin-grants.js
   내가 부여한 플랜 + 그 계정들의 사용 내역 (2026-09-20 추가)
   ----------------------------------------------------------------
   ⭐ 이 화면은 **숫자를 보고 판단하려고** 만든 것이다. 그래서 틀리면
      화면이 깨지는 게 아니라 **판단이 틀린다** — 그게 훨씬 나쁘다.
      눈으로는 절대 못 잡으니 여기서 값을 직접 재 본다.

   ☠️ 제일 위험한 자리 — 지난달 숫자를 이번 달 것처럼 보여 주기
      users/{uid}.subs.used 는 '이번 달' 이 아니라 subs.ym 에 적힌 달의 것이다.
      상대가 이번 달에 앱을 한 번도 안 열었으면 **지난달 숫자가 그대로 남아 있다.**
      그걸 그대로 그리면 "잘 쓰고 있네" 하고 정반대로 판단한다.
      → ym 이 이번 달이 아니면 0 으로 보고, 대신 언제 기록인지 남긴다.

   ☠️ 두 번째 — 내가 준 것과 스스로 결제한 것을 안 가르기
      plan 칸에는 둘 다 들어간다. 결제로 받은 건 billingPlan 에만 따로 있다.
      안 가르면 '내가 부여한 계정' 수를 실제보다 많게 세고,
      "결제로 전환된 사람" 을 영영 못 본다.

   ☠️ 세 번째 — 같은 사람을 여러 번 바꿨을 때 옛 기록까지 줄로 세기
      (플랜 관리 화면에서 실제로 났던 문제다. 같은 실수를 반복하지 않는다)
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
const read = (f) => fs.readFileSync(path.join(JS, f), 'utf8');

/* 가짜 브라우저 — admin_grants.js 는 실릴 때 window 에 붙기만 한다 */
function load(withSubs) {
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    Math, Date, String, Number, Object, Array, JSON, Error, RegExp, isNaN, parseInt, parseFloat, Promise,
    setTimeout, clearTimeout,
    document: { createElement: () => ({ style: {}, classList: { add() {} } }), body: { appendChild() {} } }
  };
  ctx.window = ctx;
  if (withSubs !== false) {
    /* 진짜 subscription.js 의 한도를 그대로 쓴다 — 여기서 숫자를 베끼면
       요금제가 바뀌었을 때 검사만 옛 값으로 통과한다 */
    const src = fs.readFileSync(path.join(JS, 'subscription.js'), 'utf8');
    const m = src.match(/lite:\s*\{[^}]*sched:\s*(\d+)[^}]*blog:\s*(\d+)/);
    must(m, 'subscription.js 에서 라이트 한도를 못 찾았습니다');
    ctx.window.Subs = {
      planOf: (k) => ({
        free: { name: '무료', sched: 0, blog: 0 },
        lite: { name: '라이트', sched: +m[1], blog: +m[2] }
      })[k] || null
    };
    ctx.__lite = { sched: +m[1], blog: +m[2] };
  }
  vm.createContext(ctx);
  vm.runInContext(read('admin_grants.js'), ctx, { filename: 'admin_grants.js' });
  must(ctx.window.AdminGrants && ctx.window.AdminGrants._pure, 'AdminGrants 가 안 실렸습니다');
  return ctx;
}
const C = load();
const G = C.window.AdminGrants._pure;

/* 2026-09-20 기준으로 본다 */
const NOW = new Date('2026-09-20T10:00:00+09:00').getTime();
const THIS_YM = '2026-09';
const LAST_YM = '2026-08';
const g = (uid, over) => Object.assign(
  { targetUid: uid, targetEmail: uid + '@x.com', targetName: uid, kind: 'plan', value: 'lite',
    prevValue: 'free', grantedAtMs: NOW - 86400000 }, over || {});
const u = (over) => Object.assign({ email: 'a@x.com', plan: 'lite' }, over || {});

console.log('\n── 지난달 숫자를 이번 달로 보여 주지 않기 (제일 중요) ──');

chk('이번 달 기록이면 사용량을 그대로 센다', () => {
  const r = G.buildRows([g('u1')], { u1: u({ subs: { ym: THIS_YM, used: { sched: 7, blog: 2 }, aiCost: 0.5 } }) }, NOW);
  const x = r.rows[0];
  must(x.usedSched === 7 && x.usedBlog === 2, '사용량이 안 잡힌다');
  must(x.staleUsage === false, '이번 달인데 옛 기록으로 본다');
  must(Math.abs(x.aiCost - 0.5) < 1e-9, '원가가 안 잡힌다');
  return '일정7 글2';
});

chk('☠️ 지난달 기록이면 0 으로 보고 옛 기록이라고 표시한다', () => {
  const r = G.buildRows([g('u1')], { u1: u({ subs: { ym: LAST_YM, used: { sched: 99, blog: 40 }, aiCost: 12 } }) }, NOW);
  const x = r.rows[0];
  must(x.usedSched === 0 && x.usedBlog === 0,
    '지난달 숫자를 이번 달 사용량으로 세고 있다 (' + x.usedSched + '/' + x.usedBlog + ')');
  must(x.aiCost === 0, '지난달 원가를 이번 달 것으로 센다');
  must(x.staleUsage === true, '옛 기록이라는 표시가 없다');
  must(x.ym === LAST_YM, '언제 기록인지 안 남긴다');
});

chk('지난달만 쓴 사람은 「이번 달 사용」 인원에 안 들어간다', () => {
  const r = G.buildRows(
    [g('u1'), g('u2')],
    { u1: u({ subs: { ym: THIS_YM, used: { sched: 1, blog: 0 } } }),
      u2: u({ subs: { ym: LAST_YM, used: { sched: 50, blog: 9 } } }) },
    NOW);
  must(r.sum.activeUsers === 1, '이번 달 사용 인원이 ' + r.sum.activeUsers + '명으로 잡힌다');
  must(r.sum.usedSched === 1 && r.sum.usedBlog === 0,
    '합계에 지난달 숫자가 섞였다 (' + r.sum.usedSched + '/' + r.sum.usedBlog + ')');
});

chk('사용 기록이 아예 없는 계정과 0 회를 구분한다', () => {
  /* 화면 문구가 달라야 한다 — '기록 없음' 과 '0회' 는 다른 뜻이다 */
  const r = G.buildRows([g('u1')], { u1: u({}) }, NOW).rows[0];
  must(r.ym === '', '없는 기록에 달이 붙었다');
  must(r.staleUsage === false, '없는 기록을 옛 기록으로 본다');
});

console.log('\n── 내가 준 것 / 스스로 결제한 것 ──');

chk('☠️ 결제로 받은 플랜(billingPlan)은 따로 표시한다', () => {
  const r = G.buildRows([g('u1')], { u1: u({ plan: 'pro', billingPlan: 'pro' }) }, NOW).rows[0];
  must(r.paid === true, '결제 계정을 못 가려낸다 — 내가 준 것처럼 보인다');
  must(r.paidPlan === 'pro', '결제 플랜이 안 담긴다');
});

chk('결제 기록이 없으면 결제로 세지 않는다', () => {
  const r = G.buildRows([g('u1')], { u1: u({ plan: 'lite' }) }, NOW);
  must(r.rows[0].paid === false, '결제한 것으로 잘못 센다');
  must(r.sum.paid === 0, '합계가 틀렸다');
});

chk('내가 준 뒤에 플랜이 바뀌었으면 표시한다', () => {
  const r = G.buildRows([g('u1', { value: 'pro' })], { u1: u({ plan: 'lite' }) }, NOW).rows[0];
  must(r.changed === true, '부여한 것과 지금이 다른데 표시가 없다');
  const same = G.buildRows([g('u1', { value: 'lite' })], { u1: u({ plan: 'lite' }) }, NOW).rows[0];
  must(same.changed === false, '같은데 바뀌었다고 한다');
});

chk('계정이 지워졌으면 숫자로 세지 않는다', () => {
  const r = G.buildRows([g('u1')], {}, NOW);
  must(r.rows[0].found === false, '없는 계정을 있다고 한다');
  must(r.rows[0].usedSched === 0 && r.sum.activeUsers === 0, '없는 계정을 사용자로 센다');
});

console.log('\n── 같은 사람을 여러 번 바꿨을 때 ──');

chk('☠️ 사람당 한 줄만 남는다 (최근 부여)', () => {
  const logs = [                                   // 최신순으로 들어온다
    g('u1', { value: 'pro', grantedAtMs: NOW - 1000 }),
    g('u1', { value: 'basic', grantedAtMs: NOW - 2000 }),
    g('u1', { value: 'lite', grantedAtMs: NOW - 3000 })
  ];
  const r = G.buildRows(logs, { u1: u({ plan: 'pro' }) }, NOW);
  must(r.rows.length === 1, '한 사람이 ' + r.rows.length + '줄로 나온다');
  must(r.rows[0].given === 'pro', '가장 최근 부여가 아니다: ' + r.rows[0].given);
  must(r.rows[0].grantCount === 3, '바꾼 횟수가 ' + r.rows[0].grantCount);
  must(r.rows[0].firstAtMs === NOW - 3000, '최초 부여 시각이 틀렸다');
});

chk('대상 uid 가 없는 옛 기록은 건너뛴다', () => {
  const r = G.buildRows([{ kind: 'plan', value: 'lite' }, g('u1')], { u1: u({}) }, NOW);
  must(r.rows.length === 1, '깨진 기록까지 줄로 센다');
});

console.log('\n── 한도 · 관리자 · 합계 ──');

chk('한도는 subscription.js 값을 그대로 쓴다', () => {
  /* 여기서 숫자를 베껴 두면 요금제를 고쳤을 때 이 화면만 옛 값을 말한다 */
  const r = G.buildRows([g('u1')], { u1: u({ plan: 'lite', subs: { ym: THIS_YM, used: { sched: 3, blog: 1 } } }) }, NOW).rows[0];
  must(r.limSched === C.__lite.sched, '일정 한도가 ' + r.limSched + ' (실제 ' + C.__lite.sched + ')');
  must(r.limBlog === C.__lite.blog, '글 한도가 ' + r.limBlog + ' (실제 ' + C.__lite.blog + ')');
  return '일정' + r.limSched + '/글' + r.limBlog;
});

chk('요금제 표를 못 읽으면 한도를 지어내지 않는다', () => {
  const bare = load(false);
  const B = bare.window.AdminGrants._pure;
  const r = B.buildRows([g('u1')], { u1: u({ plan: 'lite', subs: { ym: THIS_YM, used: { sched: 3, blog: 1 } } }) }, NOW).rows[0];
  must(r.limSched === 0 && r.limBlog === 0, '모르는 한도를 숫자로 지어낸다');
  must(r.usedSched === 3, '사용량까지 같이 잃었다');
});

chk('관리자 권한 부여는 플랜과 섞이지 않는다', () => {
  const r = G.buildRows([g('u1', { kind: 'admin', value: true })], { u1: u({ admin: true }) }, NOW);
  must(r.rows[0].kind === 'admin', '관리자 부여가 플랜으로 잡힌다');
  must(r.rows[0].changed === false, '관리자 부여를 플랜 변경으로 본다');
  must(r.sum.plans.admin === 1, '관리자를 따로 안 센다');
});

chk('합계가 각 줄의 합과 같다', () => {
  const logs = [g('u1'), g('u2'), g('u3')];
  const users = {
    u1: u({ subs: { ym: THIS_YM, used: { sched: 4, blog: 1 }, aiCost: 0.25 } }),
    u2: u({ subs: { ym: THIS_YM, used: { sched: 6, blog: 3 }, aiCost: 0.75 } }),
    u3: u({ plan: 'pro', billingPlan: 'pro', subs: { ym: THIS_YM, used: { sched: 0, blog: 0 } } })
  };
  const r = G.buildRows(logs, users, NOW);
  must(r.sum.people === 3, '인원이 ' + r.sum.people);
  must(r.sum.usedSched === 10 && r.sum.usedBlog === 4, '합계가 틀렸다');
  must(Math.abs(r.sum.aiCost - 1) < 1e-9, '원가 합계가 틀렸다: ' + r.sum.aiCost);
  must(r.sum.activeUsers === 2, '쓴 사람이 ' + r.sum.activeUsers + '명');
  must(r.sum.paid === 1, '결제 인원이 틀렸다');
});

chk('너무 많으면 잘라 내고 몇 명 남았는지 알려 준다', () => {
  const logs = [], users = {};
  const N = G.MAX_USERS + 5;
  for (let i = 0; i < N; i++) { logs.push(g('u' + i)); users['u' + i] = u({}); }
  const r = G.buildRows(logs, users, NOW);
  must(r.rows.length === G.MAX_USERS, '상한을 안 지킨다: ' + r.rows.length);
  must(r.sum.more === 5, '남은 인원을 안 알려 준다: ' + r.sum.more);
});

console.log('\n── 정렬 ──');

chk('많이 쓴 순 · 최근 부여순', () => {
  const rows = [
    { grantedAtMs: 3, usedSched: 1, usedBlog: 0, aiCost: 0 },
    { grantedAtMs: 1, usedSched: 9, usedBlog: 9, aiCost: 0 },
    { grantedAtMs: 2, usedSched: 0, usedBlog: 0, aiCost: 0 }
  ];
  const byUse = G.sortRows(rows, 'use');
  must(byUse[0].usedSched === 9, '많이 쓴 사람이 위가 아니다');
  must(byUse[2].usedSched === 0, '안 쓴 사람이 아래가 아니다');
  const byNew = G.sortRows(rows, 'new');
  must(byNew[0].grantedAtMs === 3 && byNew[2].grantedAtMs === 1, '최근 부여순이 아니다');
  must(rows[0].grantedAtMs === 3, '원본 배열을 흐트러뜨린다');
});

console.log('\n── 화면 연결 ──');

chk('관리자 통계에 자리와 버튼이 있다', () => {
  const s = fs.readFileSync(path.join(JS, 'admin_stats.js'), 'utf8');
  must(/id="asGrants"/.test(s), '통계에 부여 내역 자리가 없습니다');
  must(/AdminGrants\.summaryInto/.test(s), '요약을 채우지 않습니다');
  must(/AdminGrants\.open\(\)/.test(s), '자세히 보기가 없습니다');
  /* ☠️ render() 는 토글마다 다시 돈다 — 그 뒤에 다시 채워야 한다.
     innerHTML 을 새로 넣은 **뒤**에 summaryInto 가 불리는지 자리로 확인한다. */
  const setHtml = s.indexOf('ov.innerHTML = card(h)');
  const fill = s.indexOf('AdminGrants.summaryInto');
  must(setHtml > 0 && fill > setHtml, '다시 그린 뒤에 안 채웁니다 — 토글 한 번에 사라집니다');
});

chk('뒤로가기 계약: ov-lock + 닫기 버튼 id 에 Close', () => {
  const s = read('admin_grants.js');
  must(/ov\.className\s*=\s*'ov-lock'/.test(s), '오버레이에 ov-lock 이 없습니다');
  must(/id="agClose"/.test(s), "닫기 버튼 id 에 'Close' 가 없습니다");
  /* 통계(3400) 위에 떠야 한다 — 아래 깔리면 눌러도 안 보인다 */
  const z = (s.match(/z-index:(\d+)/) || [])[1];
  must(z && +z > 3400, '통계보다 아래에 뜹니다 (z-index:' + z + ')');
});

chk('index.html 에 실려 있다', () => {
  const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  must(/<script[^>]+src="\.\/js\/admin_grants\.js"/.test(html), 'admin_grants.js 가 안 실립니다');
});

chk('글자가 HTML 로 새지 않는다', () => {
  /* 이름은 사용자가 정한 값이다(닉네임). 그대로 넣으면 화면이 깨진다 */
  const s = read('admin_grants.js');
  must(/esc\(r\.name\)/.test(s), '이름을 그대로 넣습니다');
  must(/esc\(r\.email\)|esc\(sub\.join/.test(s), '부가 정보를 그대로 넣습니다');
});

console.log('\n' + (fails ? '❌ ' + fails + '개 실패' : '✅ 전부 통과') + ' (' + oks + '개)');
process.exit(fails ? 1 : 0);
