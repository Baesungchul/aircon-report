/* ═══════════════════════════════════════════════════════════════════
   tools/test-segsplit-recover.js — 선 색이 한 색으로 돌아가지 않게
   ----------------------------------------------------------------
   무슨 일이 있었나 (2026-09-22, 사용자 신고)
     "라인이 그대로인데? 라인도 색을 넣고 겹치는건 점선 하기로 하지 않았나?"

   구간 색과 겹침 점선은 **구간별 좌표(r.paths)** 가 있어야 그릴 수 있다.
   그게 안 오면 예전 코드는 곧장 한 색(accent)으로 떨어졌다. 앱은 멀쩡한데
   서버(naviRoute)가 낡은 판이면 기능이 통째로 사라진 것처럼 보인다.
   ☠️ 조용히 한 단계 낮아지는 설계가 여기서는 독이었다 — 낮아진 줄을 아무도 모른다.

   ⭐ 그래서 앱이 스스로 되살린다. 차례가 정해져 있다.
        ① r.paths        — 서버가 주면 그게 제일 정확하다(그대로 쓴다)
        ② splitByLegs    — 구간 거리는 오고 좌표만 안 올 때, 비율로 가른다
        ③ splitByWaypoints — 둘 다 없을 때, 경유지에서 제일 가까운 점으로 가른다
        ④ 그래도 안 되면 한 색 (예전 동작)

   ⚠️ 이 시험이 지키는 것은 '가르기가 예쁜가' 가 아니라
      **구간 수가 정확히 맞는가** 다. 하나라도 어긋나면 엉뚱한 카드 색이 붙는다.
═══════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'www', 'js', 'cal_map.js'), 'utf8');

let pass = 0;
const fails = [];
function chk(name, fn) {
  try { const n = fn(); pass++; console.log('  ✅ ' + name + (n ? ' — ' + n : '')); }
  catch (e) { fails.push(name); console.log('  ❌ ' + name + ' — ' + ((e && e.message) || e)); }
}
function must(c, m) { if (!c) throw new Error(m); }

/* 세 함수만 떼어 진짜로 돌린다. 글자만 찾으면 경계 하나 틀린 것을 못 잡는다. */
function load() {
  const a = SRC.indexOf('  function distM(a, b) {');
  const b = SRC.indexOf('\n  }\n', SRC.indexOf('function splitByWaypoints')) + 4;
  must(a > 0 && b > a, '함수 세 개를 못 찾았습니다');
  return new Function(SRC.slice(a, b) +
    '; return { distM: distM, byLegs: splitByLegs, byWp: splitByWaypoints };')();
}
const M = load();

/* 평택(위도 37) 근처에서 남북으로 곧게 뻗은 가짜 경로 */
function line(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ lat: 37.0 + i * 0.001, lng: 127.0 });
  return out;
}
const ends = (list) => list.map(p => [p[0], p[p.length - 1]]);
function joined(list, whole) {
  /* 토막을 이어 붙이면 원래 경로가 그대로 나와야 한다(겹친 끝점 하나만 빼고) */
  let flat = list[0].slice();
  for (let i = 1; i < list.length; i++) {
    if (flat[flat.length - 1] !== list[i][0]) return false;   // 끝점을 안 겹쳤다
    flat = flat.concat(list[i].slice(1));
  }
  return flat.length === whole.length && flat.every((p, i) => p === whole[i]);
}

console.log('\n🧭 거리(legs)로 구간 되살리기\n');

chk('구간 수가 정확히 맞는다', () => {
  const p = line(101);
  const r = M.byLegs(p, [{ distance: 1000 }, { distance: 1000 }, { distance: 2000 }], 3);
  must(r && r.length === 3, '구간이 ' + (r && r.length) + '개입니다');
  return '3구간';
});

chk('거리 비율대로 갈린다 (1:1:2 → 25%,25%,50%)', () => {
  const p = line(101);
  const r = M.byLegs(p, [{ distance: 1000 }, { distance: 1000 }, { distance: 2000 }], 3);
  const n = r.map(x => x.length - 1);          // 토막마다 몇 칸인지
  must(Math.abs(n[0] - 25) <= 1, '첫 구간이 ' + n[0] + '칸 (25칸 근처여야 함)');
  must(Math.abs(n[1] - 25) <= 1, '둘째 구간이 ' + n[1] + '칸');
  must(Math.abs(n[2] - 50) <= 1, '셋째 구간이 ' + n[2] + '칸');
  return n.join(' / ') + '칸';
});

chk('토막을 이어 붙이면 원래 경로가 된다 (끝점을 겹쳐 선이 안 끊긴다)', () => {
  const p = line(60);
  const r = M.byLegs(p, [{ distance: 300 }, { distance: 700 }], 2);
  must(joined(r, p), '이어 붙인 결과가 원래 경로와 다릅니다');
  return '이어짐';
});

chk('마지막 구간은 경로 끝까지 간다', () => {
  const p = line(50);
  const r = M.byLegs(p, [{ distance: 1 }, { distance: 1 }, { distance: 1 }], 3);
  must(r[r.length - 1][r[r.length - 1].length - 1] === p[p.length - 1], '끝점이 빠졌습니다');
  return '끝까지';
});

chk('빈 구간을 만들지 않는다 (거리가 0인 구간이 섞여도)', () => {
  const p = line(40);
  const r = M.byLegs(p, [{ distance: 0 }, { distance: 1000 }, { distance: 0 }], 3);
  must(r && r.length === 3, '구간이 ' + (r && r.length) + '개입니다');
  must(r.every(x => x.length >= 2), '점이 1개뿐인 토막이 있습니다 — 그 구간은 안 그려집니다');
  return '모두 2점 이상';
});

chk('구간 수가 안 맞으면 아예 안 가른다 (엉뚱한 색이 붙느니 한 색이 낫다)', () => {
  const p = line(50);
  must(M.byLegs(p, [{ distance: 1 }, { distance: 1 }], 3) === null, 'legs 2개로 3구간을 만들었습니다');
  must(M.byLegs(p, [{ distance: 1 }], 1) !== null, '멀쩡한 1구간을 거절했습니다');
  return '거절';
});

chk('점이 구간 수보다 적으면 거절한다', () => {
  const p = line(3);
  must(M.byLegs(p, [{d:1},{d:1},{d:1},{d:1}].map(x => ({ distance: 1 })), 4) === null,
    '점 3개로 4구간을 만들었습니다');
  return '거절';
});

chk('거리가 전부 0이면 거절한다 (0으로 나누지 않는다)', () => {
  must(M.byLegs(line(30), [{ distance: 0 }, { distance: 0 }], 2) === null, '0 거리로 갈랐습니다');
  return '거절';
});

console.log('\n📍 경유지 최근접으로 구간 되살리기\n');

chk('경유지에서 갈린다', () => {
  const p = line(101);
  const pts = [p[0], p[30], p[70], p[100]];
  const r = M.byWp(p, pts);
  must(r && r.length === 3, '구간이 ' + (r && r.length) + '개입니다');
  const n = r.map(x => x.length - 1);
  must(n[0] === 30 && n[1] === 40 && n[2] === 30, '갈린 칸이 ' + n.join('/') + ' 입니다');
  return n.join(' / ') + '칸';
});

chk('왔던 길을 되짚어도 뒤엉키지 않는다', () => {
  /* 집 → 남쪽 끝 → 집 : 같은 점 옆을 두 번 지난다.
     전체에서 최근접을 찾으면 돌아오는 길이 잡혀 구간이 뒤집힌다. */
  const down = line(51);
  const back = down.slice(0, 50).reverse();
  const p = down.concat(back);                 // 101점, 끝이 출발점
  const pts = [p[0], p[50], p[100]];           // 집 → 남쪽 끝 → 집
  const r = M.byWp(p, pts);
  must(r && r.length === 2, '구간이 ' + (r && r.length) + '개입니다');
  must(r[0].length - 1 === 50, '가는 길이 ' + (r[0].length - 1) + '칸입니다 (50칸이어야 함)');
  must(joined(r, p), '이어 붙인 결과가 원래 경로와 다릅니다');
  return '가는 길 50칸 · 오는 길 50칸';
});

chk('돌아오는 길이 더 가까이 스쳐도 가는 길에서 끊는다', () => {
  /* ☠️ 이게 진짜 함정이다. 「제일 가까운 점」을 고르면 돌아오는 길이 뽑혀
       가는 길 전체가 한 구간이 돼 버린다 — 색이 통째로 어긋난다.
     가는 길은 경유지에서 30m 떨어져 지나고, 오는 길은 5m 옆으로 스치게 만든다. */
  const DEG = 1 / 111320;                       // 위도 1m
  const out = [], back = [];
  for (let i = 0; i <= 60; i++) out.push({ lat: 37 + i * 300 * DEG, lng: 127 });
  for (let i = 60; i >= 0; i--) back.push({ lat: 37 + i * 300 * DEG, lng: 127 + 25 * DEG / Math.cos(37 * Math.PI / 180) });
  const p = out.concat(back);                   // 122점: 60번에서 꺾어 되돌아온다
  const W = { lat: 37 + 30 * 300 * DEG, lng: 127 + 30 * DEG / Math.cos(37 * Math.PI / 180) };
  /* W 는 가는 길에서 30m, 오는 길에서 5m 떨어져 있다 */
  const r = M.byWp(p, [p[0], W, p[p.length - 1]]);
  must(r && r.length === 2, '구간이 ' + (r && r.length) + '개입니다');
  must(r[0].length - 1 <= 61, '첫 구간이 ' + (r[0].length - 1) + '칸입니다 — 돌아오는 길에서 끊었습니다');
  must(Math.abs(r[0].length - 1 - 30) <= 2, '첫 구간이 ' + (r[0].length - 1) + '칸입니다 (30칸 근처여야 함)');
  must(joined(r, p), '이어 붙인 결과가 원래 경로와 다릅니다');
  return '가는 길 ' + (r[0].length - 1) + '칸에서 끊음';
});

chk('토막을 이어 붙이면 원래 경로가 된다', () => {
  const p = line(80);
  const r = M.byWp(p, [p[0], p[20], p[55], p[79]]);
  must(joined(r, p), '이어 붙인 결과가 원래 경로와 다릅니다');
  return '이어짐';
});

chk('경유지가 경로 끝에 붙어 있어도 마지막 구간이 비지 않는다', () => {
  /* ☠️ 마지막 작업지가 도착지(집)와 거의 같은 자리일 때가 있다.
       뒤 구간이 쓸 점을 안 남기면 마지막 구간이 점 1개가 돼 **선이 안 그려진다.**
       화면에서는 그 구간만 통째로 사라진다 — 원인을 찾기 어려운 종류의 버그다. */
  const p = line(12);
  const W = p[11];                              // 경유지가 경로의 마지막 점 바로 그 자리
  const r = M.byWp(p, [p[0], W, p[11]]);
  must(r && r.length === 2, '구간이 ' + (r && r.length) + '개입니다');
  must(r.every(x => x.length >= 2),
    '점이 1개뿐인 구간이 있습니다 (' + r.map(x => x.length).join('/') + ') — 그 구간은 안 그려집니다');
  must(joined(r, p), '이어 붙인 결과가 원래 경로와 다릅니다');
  return '구간 점 수 ' + r.map(x => x.length).join(' / ');
});

chk('점이 모자라면 거절한다', () => {
  const p = line(3);
  must(M.byWp(p, [p[0], p[1], p[2], p[2], p[2]]) === null, '점 3개로 4구간을 만들었습니다');
  return '거절';
});

console.log('\n🔗 지도가 실제로 이 길을 타는가\n');

/* 주석을 걷어내고 본다 — 설명 글에도 같은 낱말이 들어 있다 */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

chk('r.paths 가 오면 그것을 먼저 쓴다', () => {
  const at = CODE.indexOf('r.paths.length === segs.length');
  const sp = CODE.indexOf('splitByLegs', at);
  must(at > 0 && sp > at, '되살리기가 r.paths 보다 앞에 있습니다');
  return 'paths 우선';
});

chk('paths 가 없으면 legs → 경유지 차례로 되살린다', () => {
  const at = CODE.indexOf('splitByLegs(whole');
  must(at > 0, 'drawLines 가 splitByLegs 를 부르지 않습니다');
  const seg = CODE.slice(at, at + 200);
  must(/splitByWaypoints\(whole,\s*pts\)/.test(seg), '경유지 되살리기가 뒤에 없습니다');
  return 'legs → 경유지';
});

chk('되살린 뒤에야 perSeg 가 정해진다 (여기 순서가 뒤집히면 도로 한 색이 된다)', () => {
  const sp = CODE.indexOf('splitByLegs(whole');
  const ps = CODE.indexOf('perSeg = !!list', sp);
  must(ps > sp, 'perSeg 가 되살리기보다 먼저 정해집니다');
  return '되살린 뒤';
});

chk('구간별이면 겹침 등수를 매겨 점선으로 얹는다', () => {
  must(/rRanks\s*=\s*perSeg\s*\?\s*overRanks\(list\)/.test(CODE), '겹침 등수 계산이 없습니다');
  must(/strokeStyle:\s*styleOf\('solid',\s*run\.rank\)/.test(CODE), '실선에 겹침 모양이 안 붙습니다');
  return 'overRanks + styleOf';
});

chk('구간 색은 카드 색(segOf)을 그대로 쓴다', () => {
  must(/var col = perSeg \? segOf\(i\) : accent\(\)/.test(CODE), '구간 색이 카드 색을 안 씁니다');
  return 'segOf(i)';
});

console.log('');
if (fails.length) {
  console.log('❌ ' + fails.length + '개 실패: ' + fails.join(', ') + '\n');
  process.exit(1);
}
console.log('✅ ' + pass + '개 모두 통과\n');
