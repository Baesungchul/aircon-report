/* ═══════════════════════════════════════════════════════════
   tools/test-segsplit.js
   왔던 길을 되짚는 구간을 **두 줄로 갈라 그리기** (2026-09-20 사용자 요청)
   ----------------------------------------------------------------
   ⭐ 무엇을 지켜야 하나
      ① 같은 길을 두 번 지나면 두 선이 **서로 반대쪽**으로 밀려야 한다.
      ② 혼자 쓰는 길은 **한 치도 움직이면 안 된다.** 안 그러면 멀쩡한 길이
         도로에서 비껴 나가 "여기 길이 없는데?" 가 된다.
      ③ 겹치는 구간이 길 일부뿐이면 **그 부분만** 밀린다.

   ☠️ 여기서 제일 틀리기 쉬운 자리 — **방향**
      A→B 와 B→A 는 같은 길이지만 진행 방향이 반대다. 그래서 각자의 '왼쪽'도
      정반대를 가리킨다. 배수만 +0.5 / -0.5 로 주고 각자의 왼쪽으로 밀면
      **둘 다 같은 쪽으로 가서 여전히 겹친다** — 그런데 화면에는 선이 두 개
      그려지고 배수도 달라서, 코드를 읽어서는 맞아 보인다.
      → 그래서 이 검사는 '배수가 다른가' 를 보지 않는다. 밀린 **좌표를 실제로 재서
        기준선의 어느 쪽에 있는지** 부호로 확인한다. 그것만이 이 버그를 잡는다.

   ☠️ 한 가지 더 — 간격은 화면(px) 기준이어야 한다. 이 검사는 미터를 직접 주므로
      px 환산(mppOf)까지는 못 본다. 그건 tools/smoke-calmap.js 가 본다.
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
   그래서 가짜 window 하나로 기하 함수를 꺼내 쓸 수 있다. */
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
  must(ctx.window.__calmapGeom, 'cal_map.js 가 기하 함수를 내주지 않는다');
  return ctx.window.__calmapGeom;
}
const G = load();

/* 두 점 사이 미터 (검사 쪽에서 따로 잰다 — 앱 코드를 믿지 않는다) */
const M = 111320;
function metres(a, b) {
  const lat = (a.lat + b.lat) / 2 * Math.PI / 180;
  const dx = (b.lng - a.lng) * Math.cos(lat) * M;
  const dy = (b.lat - a.lat) * M;
  return Math.sqrt(dx * dx + dy * dy);
}
/* 점 p 가 선분 a→b 의 **어느 쪽**에 있나. 왼쪽이 +, 오른쪽이 −, 거리(m) */
function side(a, b, p) {
  const lat = a.lat * Math.PI / 180;
  const ax = 0, ay = 0;
  const bx = (b.lng - a.lng) * Math.cos(lat) * M, by = (b.lat - a.lat) * M;
  const px = (p.lng - a.lng) * Math.cos(lat) * M, py = (p.lat - a.lat) * M;
  const L = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
  return ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / L;   // 외적 / 길이
}

const A = { lat: 37.000, lng: 127.000 };
const B = { lat: 37.010, lng: 127.000 };   // A 에서 북쪽으로 약 1.1km
const C = { lat: 37.010, lng: 127.020 };   // B 에서 동쪽
const D_M = 12;                            // 밀 거리(미터). 화면 px 환산은 앱이 한다

console.log('\n── 같은 길을 되짚을 때 ──');

chk('겹치는 두 구간이 서로 반대쪽으로 갈라진다', () => {
  const paths = [[A, B], [B, A]];          // 갔다가 그대로 돌아온다
  const muls = G.offsetMuls(paths);
  const o1 = G.offsetPath(paths[0], muls[0], D_M);
  const o2 = G.offsetPath(paths[1], muls[1], D_M);

  /* 기준선 A→B 을 놓고, 두 선의 가운데 점이 각각 어느 쪽에 있는지 잰다 */
  const m1 = { lat: (o1[0].lat + o1[1].lat) / 2, lng: (o1[0].lng + o1[1].lng) / 2 };
  const m2 = { lat: (o2[0].lat + o2[1].lat) / 2, lng: (o2[0].lng + o2[1].lng) / 2 };
  const s1 = side(A, B, m1), s2 = side(A, B, m2);

  must(Math.abs(s1) > 1, '첫 구간이 안 밀렸다 (' + s1.toFixed(2) + 'm)');
  must(Math.abs(s2) > 1, '되돌아오는 구간이 안 밀렸다 (' + s2.toFixed(2) + 'm)');
  must(s1 * s2 < 0,
    '☠️ 두 구간이 같은 쪽으로 밀렸다 — 방향 부호가 빠졌다 (' +
    s1.toFixed(2) + 'm, ' + s2.toFixed(2) + 'm)');
  return '좌우 ' + s1.toFixed(1) + 'm / ' + s2.toFixed(1) + 'm';
});

chk('벌어진 간격이 시킨 만큼이다', () => {
  const paths = [[A, B], [B, A]];
  const muls = G.offsetMuls(paths);
  const o1 = G.offsetPath(paths[0], muls[0], D_M);
  const o2 = G.offsetPath(paths[1], muls[1], D_M);
  /* 둘 다 -0.5 / +0.5 이므로 사이가 정확히 D_M 이어야 한다 */
  const gap = metres(o1[0], o2[1]);        // o2 는 방향이 반대라 끝점끼리 맞댄다
  must(Math.abs(gap - D_M) < 1.5, '간격이 ' + gap.toFixed(1) + 'm (시킨 값 ' + D_M + 'm)');
  return gap.toFixed(1) + 'm';
});

chk('겹치지 않는 구간은 한 치도 안 움직인다', () => {
  /* ☠️ 이게 무너지면 멀쩡한 길이 도로에서 비껴 나간다. 겹침 기능보다 이쪽이 더 무섭다 */
  const paths = [[A, B], [B, C]];          // 이어지기만 하고 겹치진 않는다
  const muls = G.offsetMuls(paths);
  muls.forEach((m, i) => m.forEach((v, j) =>
    must(v === 0, (i + 1) + '번 구간 ' + (j + 1) + '번째 변에 배수가 붙었다: ' + v)));
  const o = G.offsetPath(paths[0], muls[0], D_M);
  must(o[0].lat === A.lat && o[0].lng === A.lng, '시작점이 움직였다');
  must(o[1].lat === B.lat && o[1].lng === B.lng, '끝점이 움직였다');
});

chk('셋이 같은 길을 쓰면 가운데를 두고 좌 · 중 · 우', () => {
  const paths = [[A, B], [B, A], [A, B]];
  const muls = G.offsetMuls(paths);
  const mid = paths.map((p, i) => {
    const o = G.offsetPath(p, muls[i], D_M);
    return side(A, B, { lat: (o[0].lat + o[1].lat) / 2, lng: (o[0].lng + o[1].lng) / 2 });
  });
  const sorted = mid.slice().sort((x, y) => x - y);
  must(Math.abs(sorted[1]) < 1, '가운데 선이 원래 자리에 없다 (' + sorted[1].toFixed(2) + 'm)');
  must(sorted[0] < -1 && sorted[2] > 1, '좌우로 안 벌어졌다: ' + sorted.map(v => v.toFixed(1)).join(', '));
  /* 양 끝 사이가 2 × D_M */
  must(Math.abs((sorted[2] - sorted[0]) - 2 * D_M) < 2,
    '양 끝 간격이 ' + (sorted[2] - sorted[0]).toFixed(1) + 'm');
  return sorted.map(v => v.toFixed(1)).join(' / ');
});

console.log('\n── 길 일부만 겹칠 때 ──');

chk('겹치는 가운데만 밀리고 양 끝은 제자리', () => {
  /* 두 경로가 가운데 한 토막(P2→P3)만 같이 쓴다 */
  const P1 = { lat: 37.000, lng: 127.000 };
  const P2 = { lat: 37.005, lng: 127.000 };
  const P3 = { lat: 37.010, lng: 127.000 };
  const P4 = { lat: 37.015, lng: 127.010 };
  const Q0 = { lat: 37.000, lng: 127.010 };

  const a = [P1, P2, P3, P4];
  const b = [Q0, P2, P3];                 // 다른 데서 와서 같은 토막을 탄다
  const muls = G.offsetMuls([a, b]);

  must(muls[0][0] === 0, '겹치지 않는 첫 변이 밀린다');
  must(muls[0][1] !== 0, '겹치는 변이 안 밀린다');
  must(muls[0][2] === 0, '겹치지 않는 셋째 변이 밀린다');

  const oa = G.offsetPath(a, muls[0], D_M);
  must(oa[0].lat === P1.lat && oa[0].lng === P1.lng, '바깥 끝점이 움직였다');
  must(oa[3].lat === P4.lat && oa[3].lng === P4.lng, '반대쪽 바깥 끝점이 움직였다');
  /* 겹치는 토막의 한가운데(P2·P3 는 이음매라 절반만 밀린다)는 확실히 벌어져야 한다 */
  const ob = G.offsetPath(b, muls[1], D_M);
  const gap = metres(oa[1], ob[1]);
  must(gap > 2, '겹치는 토막이 안 벌어졌다 (' + gap.toFixed(1) + 'm)');
  return '가운데 ' + gap.toFixed(1) + 'm 벌어짐';
});

chk('이음매에서 선이 끊기지 않는다', () => {
  /* 변마다 뚝뚝 잘라 밀면 겹침이 시작·끝나는 자리에서 선이 어긋나 보인다.
     점마다 앞뒤를 평균내므로, 이음매는 '절반'만 밀려 비스듬히 이어져야 한다. */
  const P1 = { lat: 37.000, lng: 127.000 };
  const P2 = { lat: 37.005, lng: 127.000 };
  const P3 = { lat: 37.010, lng: 127.000 };
  const a = [P1, P2, P3];
  const b = [P2, P3];                     // 뒤 토막만 같이 쓴다
  const muls = G.offsetMuls([a, b]);
  const oa = G.offsetPath(a, muls[0], D_M);
  const d1 = metres(P1, oa[0]);           // 겹침 밖 끝 — 0
  const d2 = metres(P2, oa[1]);           // 이음매 — 절반쯤
  const d3 = metres(P3, oa[2]);           // 겹침 안 끝 — 온전히
  must(d1 < 0.2, '겹침 밖 끝점이 밀렸다 (' + d1.toFixed(2) + 'm)');
  must(d3 > d2 && d2 > 0.5,
    '이음매가 단계적으로 안 밀렸다 (' + d2.toFixed(2) + ' / ' + d3.toFixed(2) + ')');
  return '0 → ' + d2.toFixed(1) + ' → ' + d3.toFixed(1) + 'm';
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

chk('밀 거리가 0 이면 원본 그대로 (px 환산 실패 시)', () => {
  /* mppOf 가 0 을 돌려주는 경우(지도 크기를 못 잼) — 예전처럼 겹쳐 그린다.
     엉뚱한 자리로 밀리는 것보다 겹치는 쪽이 낫다 */
  const paths = [[A, B], [B, A]];
  const muls = G.offsetMuls(paths);
  const o = G.offsetPath(paths[0], muls[0], 0);
  must(o === paths[0] || (o[0].lat === A.lat && o[1].lat === B.lat), '0 인데 움직였다');
});

chk('점이 겹쳐 길이가 0 인 변에서 터지지 않는다', () => {
  const same = { lat: 37.0, lng: 127.0 };
  const paths = [[same, { lat: 37.0, lng: 127.0 }], [A, B]];
  const muls = G.offsetMuls(paths);
  const o = G.offsetPath(paths[0], muls[0], D_M);
  must(Array.isArray(o) && o.length === 2, '결과가 이상하다');
  must(isFinite(o[0].lat) && isFinite(o[0].lng), '좌표가 NaN 이 됐다');
});

chk('점이 하나뿐이거나 비어 있어도 그대로 돌려준다', () => {
  must(G.offsetPath([], [], D_M).length === 0, '빈 것이 이상해졌다');
  const one = [A];
  must(G.offsetPath(one, [], D_M) === one, '점 하나짜리를 건드린다');
});

console.log('\n' + (fails ? '❌ ' + fails + '개 실패' : '✅ 전부 통과') + ' (' + oks + '개)');
process.exit(fails ? 1 : 0);
