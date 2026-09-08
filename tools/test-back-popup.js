/* ═══════════════════════════════════════════════════════════
   tools/test-back-popup.js
   팝업에서 하드웨어 뒤로가기를 누르면 그 팝업이 닫히는가
   ----------------------------------------------------------------
   사용자 신고 (2026-09-08):
     "팝업에서 뒤로가기했는데 포커스가 뒤편에 있는 증상이야.
      이건 이전에도 자주 있던 문제인데 … 다른 곳도 조사해서 수정해줘"

   ☠️ 이 사고는 오류가 안 난다. 화면에는 팝업이 그대로 떠 있는데 뒤에서 탭이
      바뀌거나 "한 번 더 누르면 종료" 가 뜬다. 한 번 더 누르면 앱이 꺼진다.
      사용자는 '팝업이 안 닫힌다' 로 겪지만, 실제로는 뒤로가기가 그 팝업을
      **보지 못한** 것이다.

   ☠️ 실제 원인 (2026-09-08 전수 조사)
      state.js closeTopPopup() 이 z-index 1000 미만을 전부 버리고 있었다.
      그런데 ai.js 의 팝업 8개는 탭바를 가리지 않으려고 z 를 850~860 으로 잡았다.
      → 그 8개가 통째로 뒤로가기에서 샜다.
      고친 방법: z 만 보지 않고, 이 앱이 동적 오버레이에 붙이는 표식(.ov-lock)이
      있으면 z 가 낮아도 팝업으로 본다.

   여기서 재는 것
     ① closeTopPopup 이 .ov-lock 을 z 와 무관하게 잡는가
     ② body 에 직접 붙는 전체화면 오버레이가 전부 .ov-lock 을 달고 있는가
        (표식을 빠뜨리면 그 팝업만 조용히 다시 샌다)
     ③ 그 팝업들에 닫기/취소 버튼이 있는가 (없으면 강제 제거뿐이라 정리를 건너뛴다)
═══════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'www', 'js');

let fails = 0, oks = 0;
function chk(name, fn) {
  try { const r = fn(); console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; }
  catch (e) { console.log('  ❌ ' + name + ' — ' + e.message); fails++; }
}
const must = (c, m) => { if (!c) throw new Error(m); };
const read = (f) => fs.readFileSync(path.join(JS, f), 'utf8');
const files = fs.readdirSync(JS).filter(f => f.endsWith('.js') && !f.endsWith('.min.js'));

console.log('\n[1] 뒤로가기가 팝업을 찾는 규칙');

chk('.ov-lock 이면 z 가 낮아도 팝업으로 본다', () => {
  const s = read('state.js');
  must(/window\.closeTopPopup = function/.test(s), 'closeTopPopup 이 없습니다');
  must(/classList\.contains\('ov-lock'\)/.test(s.slice(s.indexOf('window.closeTopPopup'))),
       'z-index 만 보고 있습니다 — ai.js 팝업 8개(z 850~860)가 통째로 샙니다');
  must(/if \(!marked && z < 1000\) continue;/.test(s),
       '표식이 있어도 z 로 걸러 냅니다');
  return 'z + 표식 둘 다 본다';
});

chk('뒤로가기 순서에 실제로 걸려 있다', () => {
  const s = read('state.js');
  const at = s.indexOf("addListener('backButton'");
  must(at > 0, '뒤로가기 리스너를 못 찾았습니다');
  const blk = s.slice(at, at + 2600);
  must(/closeTopPopup && window\.closeTopPopup\(\)|window\.closeTopPopup && window\.closeTopPopup\(\)/.test(blk),
       '뒤로가기가 closeTopPopup 을 안 부릅니다');
  must(blk.indexOf('closeTopPopup') < blk.indexOf('switchTab'),
       '탭 이동보다 늦게 팝업을 봅니다 — 팝업이 떠 있는데 탭이 바뀝니다');
  return '탭 이동보다 먼저';
});

console.log('\n[2] 전체화면 오버레이가 표식을 달고 있는가');

/* body 에 직접 붙이는 전체화면 오버레이를 전부 훑어, 뒤로가기가 볼 수 있는지 따진다.
   볼 수 있는 조건은 둘 중 하나다 — z ≥ 1000 이거나, .ov-lock 표식이 붙어 있거나.
   ⚠️ 배너·토스트·진행바는 inset:0 이 아니라 애초에 걸리지 않는다(팝업이 아니다).
   ☠️ z 를 변수로 넘기는 오버레이(overlayShell(html, z))는 값을 알 수 없으므로
      **표식을 반드시** 요구한다 — 낮은 z 를 넘기는 순간 조용히 새기 때문이다. */
chk('전체화면 오버레이가 모두 뒤로가기에 걸린다', () => {
  const leak = [];
  files.forEach(f => {
    const lines = read(f).split('\n');
    lines.forEach((ln, i) => {
      if (!/position:fixed;inset:0/.test(ln)) return;
      if (!/z-?index:/i.test(ln)) return;
      const near = lines.slice(Math.max(0, i - 6), i + 1).join('\n');
      if (/ov-lock/.test(near)) return;                       // 표식 있음 → 걸린다
      const zm = ln.match(/z-?index:\s*(\d+)/i);
      if (zm && +zm[1] >= 1000) return;                       // 충분히 높다 → 걸린다
      leak.push(f + ':' + (i + 1) + (zm ? '  z=' + zm[1] : '  z=변수'));
    });
  });
  must(!leak.length,
       '뒤로가기가 못 보는 전체화면 팝업이 있습니다 (표식을 붙이거나 z 를 1000 이상으로):\n      '
       + leak.join('\n      '));
  return '샘 없음';
});

console.log('\n[3] 닫기 버튼 — 강제 제거 대신 제 손으로 닫히게');

chk('AI 팝업들에 닫기/취소 버튼이 있다', () => {
  /* 버튼이 있으면 closeTopPopup 이 그 버튼을 눌러 준다 → 각자의 정리 코드가 돈다.
     없으면 노드만 지워서 blob URL 해제 같은 뒷정리를 건너뛴다. */
  const s = read('ai.js');
  const at = [];
  const re = /var ov = overlayShell\(/g;
  let m; while ((m = re.exec(s)) !== null) at.push(m.index);
  must(at.length >= 8, 'overlayShell 팝업이 ' + at.length + '개뿐입니다 (검사 기준이 낡았습니다)');
  const bad = [];
  at.forEach(i => {
    const blk = s.slice(i, i + 4000);
    if (!/id="[A-Za-z]*(Close|Cancel|close|cancel)"/.test(blk)) bad.push(i);
  });
  must(!bad.length, at.length + '개 중 ' + bad.length + '개에 닫기 버튼이 없습니다');
  return at.length + '개 모두 있음';
});

chk('공유·참고 화면도 표식과 닫기 버튼을 갖췄다', () => {
  const s = read('sns_share.js');
  must((s.match(/ov-lock/g) || []).length >= 3, '공유 오버레이에 표식이 빠졌습니다');
  must(/id="snsRefClose"/.test(s), '참고 화면에 닫기 버튼이 없습니다');
  must(/id="snsCancel"/.test(s), '올리기 시트에 닫기 버튼이 없습니다');
  return '표식 3곳 · 닫기 버튼';
});

console.log(fails ? `\n❌ 실패 ${fails}건 / 통과 ${oks}건` : `\n✅ 통과 ${oks}건`);
process.exit(fails ? 1 : 0);
