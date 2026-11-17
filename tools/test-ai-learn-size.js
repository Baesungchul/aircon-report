/* ═══════════════════════════════════════════════════════════
   tools/test-ai-learn-size.js
   일정 분석 학습 기록이 클라우드 문서 한도(1MB)를 넘지 않는지 (2026-11-17)
   ----------------------------------------------------------------
   교정 40→100건, 업종 학습 200건을 새로 쌓으면서 ai_corrections/{uid} 한 문서에
   둘 다 싣는다. 긴 캡처 전사문이 쌓이면 1MB 를 넘어 set 이 통째로 실패하고,
   두 학습 모두 동기화가 조용히 멈춘다.
═══════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const JS = path.join(__dirname, '..', 'www', 'js');
let fails = 0, oks = 0;
function chk(name, fn) {
  try { const r = fn(); console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; }
  catch (e) { console.log('  ❌ ' + name + ' — ' + e.message); fails++; }
}
const must = (c, m) => { if (!c) throw new Error(m); };
const ctx = { console: { log() {}, warn() {} }, TextEncoder, setTimeout, document: { addEventListener() {} } };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(JS, 'cloud_ai_learn.js'), 'utf8'), ctx);
const fit = ctx.CloudAILearn._fitBudget;
const mk = (n, s) => Array.from({ length: n }, (_, i) => ({ in: s + i, out: { memo: 'x' }, at: i }));
const size = (o) => Buffer.byteLength(JSON.stringify(o));

console.log('\n[일정 분석 학습 기록 크기]');
chk('가득 차도 문서 한도 안쪽으로 줄인다', () => {
  must(typeof fit === 'function', '_fitBudget 이 없습니다 (검사 기준이 낡았습니다)');
  const r = fit(mk(100, '가'.repeat(2000)), mk(200, '나'.repeat(600)));
  const b = size({ list: r.list, ind: r.ind });
  must(r.cut && b < 900000, '줄이지 않았습니다 (' + b + ' 바이트)');
  must(r.list[r.list.length - 1].at === 99 && r.ind[r.ind.length - 1].at === 199, '최근 기록을 버렸습니다');
  return Math.round(b / 1024) + 'KB';
});
chk('작으면 손대지 않는다', () => {
  const r = fit(mk(30, '짧'), mk(30, '짧'));
  must(!r.cut && r.list.length === 30 && r.ind.length === 30, '작은 기록을 덜어 냈습니다');
});
chk('교정 원문은 2,000자까지만 저장한다', () => {
  const src = fs.readFileSync(path.join(JS, 'ai.js'), 'utf8');
  must(/sourceText = String\(sourceText \|\| ''\)\.trim\(\)\.slice\(0, 2000\)/.test(src), 'saveCorrection 에 원문 상한이 없습니다');
});
console.log('\n' + (fails ? '❌ 실패 ' + fails + '건 / ' : '✅ ') + '통과 ' + oks + '건');
process.exit(fails ? 1 : 0);
