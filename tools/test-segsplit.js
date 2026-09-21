/* ═══════════════════════════════════════════════════════════
   tools/test-segsplit.js
   되짚는 길을 **한 선 위에 두 색으로** 보이기 (2026-09-21 사용자 요청)
   ----------------------------------------------------------------
   ☠️ 2026-09-20 에는 겹치는 구간을 나란히 **두 줄로 밀어서** 그렸다.
      왕복은 보였지만 선이 실제 도로에서 비껴 나가고 이음매마다 꺾여
      지도가 지저분해졌다. 사용자가 "한 선으로 되돌리고 색으로 구분해 달라" 했다.
      → 이제 선은 **늘 실제 길 위에 한 줄**이다. 겹침은 무늬로만 알린다.
         첫 구간이 바탕(실선), 같은 길을 또 쓰는 구간이 그 위에 점선.
         점선 빈틈으로 아래 색이 비쳐 한 줄이 두 색 줄무늬가 된다.

   ⭐ 무엇을 지켜야 하나
      ① 같은 길을 두 번 지나면 뒤 구간에 **등수(1 이상)** 가 붙는다.
      ② 등수가 붙은 토막은 **바탕과 다른 무늬**여야 한다.
         같은 무늬면 빈틈이 같은 자리에 와서 위가 아래를 고스란히 덮는다 —
         고치기 전과 결과가 똑같아진다. 여기가 제일 조용히 망가지는 자리다.
      ③ 혼자 쓰는 길은 등수 0. 무늬가 바뀌면 안 된다.
      ④ 겹치는 데가 길 일부뿐이면 **그 부분만** 토막나야 한다.
      ⑤ 토막을 다 이으면 원래 점 목록 그대로다 —
         ☠️ 한 점이라도 잃으면 경계에서 선이 뚝 끊긴다. 좌표를 **만들어 내서도** 안 된다.
            (예전 방식이 좌표를 옮겼다. 이제는 한 치도 안 옮긴다 — 그게 이 개편의 핵심이다)
═══════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'www', 'js');

let fails = 0, oks = 0;
function chk(name, fn) {
  try { const r = fn(); console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; }
  catch (e) { console.log('  ❌ ' + name + ' — ' + e.message); fails++; }
}
const must = (c, m) => { if (!c) throw new Error(m); };

/* cal_map.js 는 불러올 때 window 에 붙기만 한다(그리기는 open 에서).
   그래서 가짜 window 하나로 셈 함수를 꺼내 쓸 수 있다. */
function load() {
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    Math, Date, String, Number, Object, Array, JSON, Error, RegExp, isNaN, parseInt, parseFloat,
    setTimeout, clearTimeout,
    document: { createElement: () => ({ style: { setProperty() {} }, classList: { add() {}, toggle() {} } }),
                getElementById: () => null, body: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(JS, 'cal_map.js'), 'utf8'), ctx, { filename: 'cal_map.js' });
  must(ctx.window.__calmapGeom, 'cal_map.js 가 셈 함수를 내주지 않는다');
  return ctx.window.__calmapGeom;
}
const G = load();

const A = { lat: 37.000, lng: 127.000 };
const B = { lat: 37.010, lng: 127.000 };   // A 에서 북쪽으로 약 1.1km
const C = { lat: 37.010, lng: 127.020 };   // B 에서 동쪽

/* 토막을 다 이으면 원본이 되는가 — 좌표를 **그대로** 지나왔는지 본다 */
function rejoin(runs) {
  const out = [];
  runs.forEach((r, i) => r.pts.forEach((p, j) => {
    if (i && !j) return;                    // 경계 점은 앞 토막이 이미 넣었다
    out.push(p);
  }));
  return out;
}
const sameXY = (a, b) => a.lat === b.lat && a.lng === b.lng;

console.log('\n── 같은 길을 되짚을 때 ──');

chk('되짚는 구간에 등수가 붙는다', () => {
  const ranks = G.overRanks([[A, B], [B, A]]);   // 갔다가 그대로 돌아온다
  must(ranks[0][0] === 0, '첫 구간이 바탕(0) 이 아니다: ' + ranks[0][0]);
  must(ranks[1][0] === 1, '되돌아오는 구간에 등수가 안 붙었다: ' + ranks[1][0]);
  return '0 / 1';
});

chk('☠️ 등수가 붙으면 바탕과 다른 무늬가 된다', () => {
  /* 여기가 조용히 망가지는 자리다. 무늬가 같으면 빈틈이 같은 자리에 와서
     위가 아래를 고스란히 덮는다 — 겹쳤다는 사실이 그대로 사라진다. */
  must(G.styleOf('solid', 0) === 'solid', '바탕 무늬가 바뀌었다');
  must(G.styleOf('solid', 1) !== 'solid', '실선 위에 실선을 얹는다 — 아래가 안 비친다');
  must(G.styleOf('shortdash', 0) === 'shortdash', '직선 바탕 무늬가 바뀌었다');
  must(G.styleOf('shortdash', 1) !== 'shortdash', '같은 점선을 얹는다 — 아래가 안 비친다');
  return G.styleOf('solid', 1) + ' / ' + G.styleOf('shortdash', 1);
});

chk('셋이 같은 길을 쓰면 무늬가 셋 다 다르다', () => {
  const ranks = G.overRanks([[A, B], [B, A], [A, B]]);
  const got = [ranks[0][0], ranks[1][0], ranks[2][0]];
  must(got.join() === '0,1,2', '등수가 0,1,2 가 아니다: ' + got.join());
  const st = got.map((r) => G.styleOf('solid', r));
  must(new Set(st).size === 3, '무늬가 겹친다: ' + st.join(' / '));
  return st.join(' / ');
});

chk('☠️ 겹치지 않는 구간은 등수가 0 이고 무늬가 그대로다', () => {
  /* 이게 무너지면 멀쩡한 외길이 점선으로 그려져 '되짚은 길'로 읽힌다.
     겹침을 못 잡는 것보다 이쪽이 더 나쁘다 — 없는 사실을 지도가 말하는 셈이다. */
  const ranks = G.overRanks([[A, B], [B, C]]);   // 이어지기만 하고 겹치진 않는다
  ranks.forEach((m, i) => m.forEach((v, j) =>
    must(v === 0, (i + 1) + '번 구간 ' + (j + 1) + '번째 변에 등수가 붙었다: ' + v)));
  const runs = G.runsOf([A, B], ranks[0]);
  must(runs.length === 1, '안 겹치는 구간이 토막났다: ' + runs.length + '개');
  must(G.styleOf('solid', runs[0].rank) === 'solid', '무늬가 바뀌었다');
});

chk('A→B 와 B→A 를 같은 길로 본다', () => {
  must(G.edgeKey(A, B) === G.edgeKey(B, A), '방향이 반대면 딴 길로 본다');
});

chk('몇 미터 어긋난 점도 같은 길로 본다 (좌표를 끊어서 비교)', () => {
  /* 왕복 경로는 같은 도로인데도 점이 몇 미터씩 어긋나 온다.
     그대로 비교하면 '딴 길'이 되어 겹침을 통째로 놓친다. */
  const A2 = { lat: A.lat + 0.00002, lng: A.lng - 0.00002 };   // 약 2~3m
  must(G.edgeKey(A2, B) === G.edgeKey(A, B), '몇 미터 차이를 딴 길로 본다');
});

chk('멀리 떨어진 길은 딴 길로 본다', () => {
  /* 너무 성기게 끊으면 옆 도로까지 같은 길이 된다 — 반대쪽도 막아 둔다 */
  const far = { lat: A.lat + 0.002, lng: A.lng };              // 약 220m
  must(G.edgeKey(far, B) !== G.edgeKey(A, B), '220m 떨어진 길을 같은 길로 본다');
});

console.log('\n── 길 일부만 겹칠 때 ──');

const P1 = { lat: 37.000, lng: 127.000 };
const P2 = { lat: 37.005, lng: 127.000 };
const P3 = { lat: 37.010, lng: 127.000 };
const P4 = { lat: 37.015, lng: 127.010 };
const Q0 = { lat: 37.000, lng: 127.010 };

chk('겹치는 가운데 토막에만 등수가 붙는다', () => {
  const a = [P1, P2, P3, P4];
  const b = [Q0, P2, P3];                 // 다른 데서 와서 같은 토막을 탄다
  const ranks = G.overRanks([a, b]);
  must(ranks[0].join() === '0,0,0', '먼저 그린 쪽에 등수가 붙었다: ' + ranks[0].join());
  must(ranks[1][0] === 0, '겹치지 않는 첫 변에 등수가 붙었다');
  must(ranks[1][1] === 1, '겹치는 변에 등수가 안 붙었다');
  return ranks[1].join(' / ');
});

chk('그 부분만 토막난다 — 앞뒤는 바탕 무늬 그대로', () => {
  const a = [P1, P2, P3, P4];
  const b = [Q0, P2, P3];
  const ranks = G.overRanks([a, b]);
  const runs = G.runsOf(b, ranks[1]);
  must(runs.length === 2, '토막이 ' + runs.length + '개다 (2개여야 한다)');
  must(runs[0].rank === 0 && runs[1].rank === 1, '토막 등수가 0,1 이 아니다');
  must(runs[0].pts.length === 2 && runs[1].pts.length === 2, '토막 길이가 이상하다');
  return '바탕 1토막 + 덧줄 1토막';
});

chk('☠️ 토막 경계가 이어진다 (앞 토막 끝점 = 뒤 토막 첫 점)', () => {
  /* 한 점이라도 빠뜨리면 겹침이 시작하는 자리에서 선이 뚝 끊겨 보인다 */
  const b = [Q0, P2, P3];
  const runs = G.runsOf(b, G.overRanks([[P2, P3], b])[1]);
  for (let i = 1; i < runs.length; i++) {
    const end = runs[i - 1].pts[runs[i - 1].pts.length - 1];
    must(sameXY(end, runs[i].pts[0]),
      (i + 1) + '번째 토막이 앞 토막 끝에서 시작하지 않는다');
  }
  return runs.length + '토막';
});

console.log('\n── 선이 길에서 벗어나지 않는가 ──');

chk('☠️ 토막을 다 이으면 원래 점 그대로다 (좌표를 한 치도 안 옮긴다)', () => {
  /* 이 개편의 핵심이다. 예전 방식은 좌표를 옆으로 밀어 선을 도로 밖으로 내보냈다.
     이제는 **원본 좌표 객체를 그대로 지나가야** 한다 — 값만 같은 게 아니라 그대로. */
  const a = [P1, P2, P3, P4];
  const b = [Q0, P2, P3];
  const ranks = G.overRanks([a, b]);
  [[a, ranks[0]], [b, ranks[1]]].forEach(([pts, rk], n) => {
    const back = rejoin(G.runsOf(pts, rk));
    must(back.length === pts.length,
      (n + 1) + '번 선의 점 수가 달라졌다: ' + pts.length + ' → ' + back.length);
    back.forEach((p, i) => {
      must(sameXY(p, pts[i]), (n + 1) + '번 선 ' + (i + 1) + '번째 점이 옮겨졌다');
      must(p === pts[i], (n + 1) + '번 선 ' + (i + 1) + '번째 점이 새로 만들어졌다');
    });
  });
  return '원본 그대로';
});

console.log('\n── 구간 색 ──');

chk('색이 여덟 개이고 서로 다르다', () => {
  must(G.SEG.length === 8, '색이 ' + G.SEG.length + '개다');
  const seen = {};
  G.SEG.forEach(c => {
    must(/^#[0-9a-f]{6}$/i.test(c), '색 모양이 이상하다: ' + c);
    must(!seen[c], '같은 색이 두 번 나온다: ' + c);
    seen[c] = 1;
  });
});

chk('아홉 번째부터는 돌려쓰지 않고 회색으로 묶는다', () => {
  /* ☠️ 돌려쓰면 1번과 9번이 같은 색이 되어 '같은 구간'처럼 보인다 */
  must(G.segOf(0) === G.SEG[0], '첫 구간 색이 다르다');
  must(G.segOf(7) === G.SEG[7], '여덟째 구간 색이 다르다');
  must(G.segOf(8) !== G.SEG[0], '아홉째가 첫 색을 돌려쓴다');
  must(G.segOf(8) === G.segOf(20), '넘친 구간끼리 색이 다르다');
  must(G.segOf(-1) === G.segOf(8), '없는 구간이 엉뚱한 색을 받는다');
});

console.log('\n── 안전장치 ──');

chk('점이 하나뿐이거나 비어 있어도 터지지 않는다', () => {
  must(G.runsOf([], []).length === 0, '빈 것이 이상해졌다');
  must(G.runsOf([A], []).length === 0, '점 하나짜리로 선을 만든다');
  must(G.overRanks([]).length === 0, '빈 목록이 이상해졌다');
  must(G.overRanks([[A]])[0].length === 0, '변이 없는데 등수가 생겼다');
});

chk('등수를 안 주면 통째로 한 토막 (구간별 경로가 안 온 경우)', () => {
  const runs = G.runsOf([A, B, C], null);
  must(runs.length === 1, '토막이 ' + runs.length + '개다');
  must(runs[0].rank === 0, '등수가 0 이 아니다');
  must(runs[0].pts.length === 3, '점을 잃었다');
});

chk('점이 겹쳐 길이가 0 인 변에서 터지지 않는다', () => {
  const same = { lat: 37.0, lng: 127.0 };
  const ranks = G.overRanks([[same, { lat: 37.0, lng: 127.0 }], [A, B]]);
  must(Array.isArray(ranks[0]) && ranks[0].length === 1, '결과가 이상하다');
});

console.log('\n' + (fails ? '❌ ' + fails + '개 실패' : '✅ 전부 통과') + ' (' + oks + '개)');
process.exit(fails ? 1 : 0);
