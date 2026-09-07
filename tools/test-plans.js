/* ═══════════════════════════════════════════════════════════
   tools/test-plans.js
   요금제 한도·팀 인원 상한이 정한 대로인지, 그리고 원가를 넘지 않는지 검사한다
   ----------------------------------------------------------------
   왜 필요한가 (2026-09-07):
     요금제 값은 **틀려도 앱이 멀쩡히 돈다**. 한도를 잘못 적으면 화면은 그대로인데
     매달 조용히 적자가 난다(실제로 개편 전 마스터는 한도를 다 쓰면 원가율 156% 였다).
     화면을 열어봐서는 절대 안 보이는 종류의 버그라 숫자로 못 박아 둔다.

   원가 기준 — 파이어스토어 users/{uid}.subs.aiCost 에 쌓인 실측값에서 뽑았다
   (2026-09 표본: 일정 8건·글 2건, 26,500 in / 5,635 out, $0.164025):
     · AI 일정등록  16원(문자만) ~ 31원(캡처 1장)   → 평상시 25원 / 최악 40원(캡처 3장)
     · AI 글작성    57원(사진 없음) ~ 83원(사진 6장) → 평상시 80원 / 최악 83원
   실수령 = 표시가 ÷ 1.1(부가세) × 0.85(구글 수수료)
═══════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path');
const JS = path.join(__dirname, '..', 'www', 'js');

let fails = 0, oks = 0;
function chk(name, fn) {
  try { const r = fn(); console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; }
  catch (e) { console.log('  ❌ ' + name + ' — ' + e.message); fails++; }
}
const must = (c, m) => { if (!c) throw new Error(m); };
const read = (f) => fs.readFileSync(path.join(JS, f), 'utf8');

const subs = read('subscription.js');
const teams = read('teams.js');

/* ⚠️ 주석을 걷어낸 사본 — 이 파일들은 '왜 이렇게 했는지'를 주석에 길게 남기는 편이라,
     옛 숫자("월 50회")가 기록으로 남아 있다. 그건 화면에 나가는 글자가 아니다.
     실제로 사용자에게 보이는 문구만 보려면 주석을 빼고 봐야 한다. */
function noComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}
const subsCode = noComments(subs);
const teamsCode = noComments(teams);

/* PLANS 리터럴에서 숫자만 뽑아 온다 — subscription.js 는 파이어베이스에 얽혀 있어
   통째로 실행하기 어렵다. 여기서 보려는 건 '적어 둔 값' 자체다. */
function plan(key) {
  const m = subs.match(new RegExp('\\n\\s*' + key + ':\\s*\\{([^}]*)\\}'));
  must(m, key + ' 플랜을 못 찾았습니다 (검사 기준이 낡았습니다)');
  const body = m[1];
  const num = (f) => { const x = body.match(new RegExp(f + ':\\s*(\\d+)')); return x ? +x[1] : 0; };
  const bool = (f) => new RegExp(f + ':\\s*true').test(body);
  return { key, price: num('price'), sched: num('sched'), blog: num('blog'),
           maxMembers: num('maxMembers'), teamCreate: bool('teamCreate'),
           unlimited: bool('unlimited'), raw: body };
}
const P = { lite: plan('lite'), basic: plan('basic'), pro: plan('pro'), master: plan('master') };
const ORDER = ['lite', 'basic', 'pro', 'master'];

const net = (won) => won / 1.1 * 0.85;                    // 실수령
const cost = (p, s, b) => p.sched * s + p.blog * b;       // 한도를 다 썼을 때 원가
const pct = (p, s, b) => cost(p, s, b) / net(p.price) * 100;

console.log('\n[1] 정한 값이 그대로 들어가 있는가 (2026-09-07 사용자 결정)');

chk('한도와 팀 인원', () => {
  const want = {
    lite:   { price: 4900,  sched: 30,  blog: 10,  maxMembers: 2 },
    basic:  { price: 9900,  sched: 70,  blog: 25,  maxMembers: 3 },
    pro:    { price: 19900, sched: 150, blog: 55,  maxMembers: 5 },
    master: { price: 49900, sched: 400, blog: 140, maxMembers: 10 }
  };
  ORDER.forEach(k => {
    Object.keys(want[k]).forEach(f => {
      must(P[k][f] === want[k][f], k + '.' + f + ' 가 ' + P[k][f] + ' 입니다 (정한 값: ' + want[k][f] + ')');
    });
  });
  return ORDER.map(k => P[k].sched + '/' + P[k].blog + '/' + P[k].maxMembers + '명').join('  ');
});

chk('무료 첫 지급분은 15회 / 3회', () => {
  const m = subs.match(/var FREE_INIT = \{ sched: (\d+), blog: (\d+) \}/);
  must(m, 'FREE_INIT 를 못 찾았습니다 (검사 기준이 낡았습니다)');
  must(+m[1] === 15 && +m[2] === 3, 'FREE_INIT 가 ' + m[1] + '/' + m[2] + ' 입니다 (정한 값: 15/3)');
  must(+m[1] < P.lite.sched, '무료 지급분(' + m[1] + ')이 라이트 월 한도(' + P.lite.sched +
       ') 이상입니다 — 첫 달에 결제할 이유가 사라집니다');
  return '15/3 (라이트 ' + P.lite.sched + '회보다 적음)';
});

console.log('\n[2] 원가 — 한도를 다 써도 남아야 한다');

chk('평상시(일정 25원·글 80원) 원가율이 60% 미만', () => {
  const out = ORDER.map(k => {
    const r = pct(P[k], 25, 80);
    must(r < 60, P[k].key + ' 원가율이 ' + r.toFixed(0) + '% 입니다');
    return P[k].key + ' ' + r.toFixed(0) + '%';
  });
  return out.join(' · ');
});

chk('최악(캡처 3장 40원·사진 6장 83원)에도 적자가 아니다', () => {
  const out = ORDER.map(k => {
    const r = pct(P[k], 40, 83);
    must(r < 100, P[k].key + ' 가 최악에서 원가율 ' + r.toFixed(0) + '% 로 적자입니다');
    return P[k].key + ' ' + r.toFixed(0) + '%';
  });
  return out.join(' · ');
});

console.log('\n[3] 계단 — 위 플랜을 잠식하면 아무도 안 올린다');

chk('가격이 오른 만큼보다 횟수가 더 늘어난다', () => {
  const out = [];
  for (let i = 1; i < ORDER.length; i++) {
    const lo = P[ORDER[i - 1]], hi = P[ORDER[i]];
    const pr = hi.price / lo.price, s = hi.sched / lo.sched, b = hi.blog / lo.blog;
    must(s >= pr, ORDER[i] + ' 일정이 ' + s.toFixed(2) + '배뿐입니다 (가격은 ' + pr.toFixed(2) + '배) — 올릴 이유가 없습니다');
    must(b >= pr, ORDER[i] + ' 글작성이 ' + b.toFixed(2) + '배뿐입니다 (가격은 ' + pr.toFixed(2) + '배)');
    out.push(ORDER[i] + ' 가격' + pr.toFixed(2) + '배/일정' + s.toFixed(2) + '배');
  }
  return out.join(' · ');
});

chk('팀 인원 상한이 위로 갈수록 늘어난다', () => {
  for (let i = 1; i < ORDER.length; i++) {
    must(P[ORDER[i]].maxMembers > P[ORDER[i - 1]].maxMembers,
         ORDER[i] + ' 인원이 아래 플랜보다 많지 않습니다');
  }
  return ORDER.map(k => P[k].maxMembers).join(' → ');
});

console.log('\n[4] 팀 만들기 — 라이트부터 열렸다');

chk('유료 플랜은 모두 팀을 만들 수 있고 인원이 정해져 있다', () => {
  ORDER.forEach(k => {
    must(P[k].teamCreate, k + ' 가 팀을 못 만듭니다');
    must(P[k].maxMembers > 0, k + ' 에 인원 상한이 없습니다 — 무제한으로 열립니다');
  });
  return '4개 플랜 전부';
});

chk('무료는 팀을 못 만든다', () => {
  const f = plan('free');
  must(!f.teamCreate && f.maxMembers === 0, '무료가 팀을 만들 수 있습니다');
  return '막힘';
});

chk('안내 문구가 옛 조건("베이직 이상")을 말하지 않는다', () => {
  must(!/팀 만들기는 베이직 이상/.test(teamsCode), 'teams.js 가 아직 "베이직 이상"이라고 안내합니다');
  must(/팀 만들기는 라이트 플랜/.test(teamsCode), '라이트부터라는 안내가 없습니다');
  return '고쳐짐';
});

console.log('\n[5] 상한을 실제로 막는가 (배선)');

chk('팀을 만들 때 인원 상한을 문서에 새긴다', () => {
  must(/maxMembers:\s*myMaxMembers\(\)/.test(teams),
       '팀 문서에 maxMembers 를 안 새깁니다 — 참여자는 팀장 플랜을 읽을 수 없어 상한을 모릅니다');
  return '새김';
});

chk('참여할 때 인원이 찼는지 본다', () => {
  const at = teamsCode.indexOf('CloudTeams.joinByCode');
  const end = teamsCode.indexOf('CloudTeams.leaveTeam');
  const body = teamsCode.slice(at, end);
  must(/capOf\(/.test(body), '참여 경로에서 상한을 안 봅니다');
  must(/length\s*>=\s*_cap/.test(body), '인원이 찼는지 비교하는 곳이 없습니다');
  must(body.indexOf('capOf(') < body.indexOf('arrayUnion(myUid())'),
       '상한 검사가 실제 추가(arrayUnion) 뒤에 있습니다 — 이미 들어간 뒤엔 못 막습니다');
  return '막음';
});

chk('팀장 플랜이 바뀌면 팀 문서도 따라간다', () => {
  must(/function syncMaxMembers/.test(teams), '플랜 변경을 팀 문서에 반영하는 곳이 없습니다');
  must(/_teams\.forEach\(syncMaxMembers\)/.test(teams), '팀 목록을 받을 때 갱신하지 않습니다');
  must(/t\.owner !== myUid\(\)/.test(teams), '팀장이 아닌 사람도 팀 문서를 덮어씁니다');
  return '팀장만 갱신';
});

chk('옛 팀 문서(maxMembers 없음)도 상한이 있다', () => {
  must(/function capOf/.test(teams), 'capOf 가 없습니다');
  must(/membersFallback/.test(teams) && /membersFallback/.test(subs),
       '기본값이 없습니다 — 개편 전에 만든 팀이 무제한이 됩니다');
  return '기본 3명';
});

console.log('\n[6] 화면 문구가 거짓말하지 않는가');

chk('요금제 화면이 한도를 손으로 안 적는다', () => {
  must(!/월 50회/.test(subsCode), "'월 50회' 가 화면 문구에 박혀 있습니다 (실제 한도: " + P.lite.sched + '회)');
  must(/월 ' \+ _p\.sched \+ '회/.test(subs), '구매 직전 확인창이 한도를 PLANS 에서 꺼내 쓰지 않습니다');
  must(/FREE_INIT\.sched \+ '회/.test(subs), '무료 지급분 안내가 FREE_INIT 를 안 씁니다');
  return 'PLANS/FREE_INIT 에서 꺼내 씀';
});

chk('팀 인원이 팀장 포함이라고 적혀 있다', () => {
  must(/팀 인원 ' \+ \(p\.maxMembers \|\| 0\) \+ '명<\/b>\(팀장 포함\)/.test(subs),
       '요금제 카드에 팀 인원(팀장 포함) 표기가 없습니다');
  must(/팀장 포함 — 팀원은 1명까지/.test(subs), '라이트 구매 확인창에 실제 팀원 수 안내가 없습니다');
  return '표기됨';
});

chk('마스터를 "무제한"이라고 하지 않는다', () => {
  must(!P.master.unlimited,
       '마스터에 unlimited 가 남아 있습니다 — 한도 ' + P.master.sched + '회를 무제한이라 적으면 과장 표기입니다');
  must(!/월 일정 1,500회·글 300회 초과 시 속도 제한/.test(subsCode), '옛 공정사용 각주가 남아 있습니다');
  return '실제 숫자로 표기';
});

console.log('\n' + (fails ? '❌ 실패 ' + fails + '건 / ' : '✅ ') + '통과 ' + oks + '건');
process.exit(fails ? 1 : 0);
