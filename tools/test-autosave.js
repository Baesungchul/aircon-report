/* ═══════════════════════════════════════════════════════════
   tools/test-autosave.js
   저장을 잊어도 사진이 사라지지 않는가
   ----------------------------------------------------------------
   ☠️ 2026-09-09 실제 사고 (사용자 신고)
     "일정을 만들고 사진을 찍었는데 저장을 잊었어. 다른 작업하다가 앱을 다시 열었는데
      일정이 열려 있는 걸 모르고 달력에서 선택하고 다시 열었어. 그랬더니 찍은 사진이
      없어졌어"

   두 가지가 겹쳐서 났다.
     ① 자동저장이 **세션 스냅샷**까지만이었다. 앱을 껐다 켤 때 복원하는 용도라
        폴더에는 안 썼다. 그런데 작업을 다시 열면 화면은 **폴더 저장본**으로 덮인다.
     ② 이미 열려 있는 작업을 다시 열 수 있었다. 다시 열기는 저장본으로 화면을
        덮어쓰는 일이라, 아직 저장 안 한 사진이 그 순간 사라진다.

   ☠️ 사진 유실은 되돌릴 수 없다. 앱이 하는 일 중 제일 나쁜 실패라 검사로 못 박는다.
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

console.log('\n[1] 저장을 잊어도 폴더에 남는가');

chk('폴더 자동저장이 있다', () => {
  const s = read('folder.js');
  must(/async function workAutoSaveNow/.test(s), '작업 자동저장이 없습니다');
  must(/saveToFolder\(\{ auto: true \}\)/.test(s),
       '폴더에 안 씁니다 — 세션 스냅샷만으로는 작업을 다시 열 때 덮여 사라집니다');
  must(/sessionAutoSaveNow\(\)/.test(s.slice(s.indexOf('async function workAutoSaveNow'), s.indexOf('async function workAutoSaveNow') + 900)),
       '폴더가 없을 때의 대비가 없습니다');
  return '폴더 + 세션';
});

chk('조용해졌을 때와 최대 간격, 둘 다 있다', () => {
  /* 조용해질 때만 저장하면, 계속 만지고 있는 동안에는 영영 저장이 안 된다 */
  const s = read('folder.js');
  const idle = s.match(/WORK_AUTOSAVE_IDLE_MS = (\d+)/);
  const max  = s.match(/WORK_AUTOSAVE_MAX_MS\s*= (\d+)/);
  must(idle && max, '자동저장 간격이 없습니다');
  must(+idle[1] >= 5000 && +idle[1] <= 60000, '조용해짐 간격이 이상합니다: ' + idle[1]);
  must(+max[1] >= 60000 && +max[1] <= 600000, '최대 간격이 이상합니다: ' + max[1]);
  must(+max[1] > +idle[1], '최대 간격이 조용해짐 간격보다 짧습니다');
  must(/if \(!_workAutoMax\) _workAutoMax = setTimeout/.test(s),
       '최대 간격 타이머가 매번 밀립니다 — 계속 만지면 영영 저장이 안 됩니다');
  return (+idle[1] / 1000) + '초 / ' + (+max[1] / 1000) + '초';
});

chk('앱을 내리거나 화면이 꺼질 때 저장한다', () => {
  const s = read('folder.js');
  must(/visibilityState === 'hidden'\) workAutoSaveNow/.test(s), '백그라운드 진입에서 안 저장합니다');
  must(/'pagehide', function \(\) \{ workAutoSaveNow/.test(s), '페이지 종료에서 안 저장합니다');
  must(/st\.isActive === false\) workAutoSaveNow/.test(s),
       '안드로이드에서 visibilitychange 가 안 오는 기종이 있습니다 — Capacitor 이벤트도 걸어야 합니다');
  return '3경로';
});

chk('자동저장이 조용하고, 남의 작업을 덮지 않는다', () => {
  const s = read('folder.js');
  must(/auto: true/.test(s), '자동저장이 토스트를 띄웁니다 — 작업을 방해합니다');
  must(/window\._isSavingInBackground\) return false/.test(s),
       '백그라운드 저장 중에도 씁니다 — 그때 전역 units 는 이전 작업입니다');
  must(/window\._workLoading\) return false/.test(s), '불러오는 중에도 씁니다');
  must(/_dataDirty !== 'undefined' && !_dataDirty\) return false/.test(s),
       '바뀐 게 없어도 씁니다 — 타이머가 도는 것만으로 요금이 나갑니다');
  return '조용 · 안전';
});

console.log('\n[2] 이미 열려 있는 작업을 다시 열지 않는가');

chk('폴더 이름으로도 같은 작업인지 본다', () => {
  /* ☠️ 예전엔 workId 가 양쪽 다 있을 때만 비교했다. 새로 만든 작업은 저장 전이라
       화면 쪽 currentWorkId 가 비어 있는 일이 있어 그 판정을 빠져나갔다. */
  const s = read('dialogs.js');
  const at = s.indexOf('async function loadFromDateFolder');
  const blk = s.slice(at, at + 3000);
  must(/_sameFolder/.test(blk), '폴더 이름을 안 봅니다');
  must(/_sameDirName/.test(blk), '실제로 연 폴더 이름을 안 봅니다');
  must(/if \(_sameId \|\| _sameFolder \|\| _sameDirName\)/.test(blk), '세 가지를 함께 안 봅니다');
  must(/이미 열려 있는 작업입니다/.test(blk),
       '조용히 넘어갑니다 — 눌러도 아무 일이 없는 것처럼 보입니다');
  return 'workId · folderName · dirHandle';
});

chk('폴더 없이 불러오는 길에도 같은 판정이 있다', () => {
  const s = read('dialogs.js');
  const at = s.indexOf('async function doLoad');
  const blk = s.slice(at, at + 900);
  must(/String\(saveId\) === String\(currentWorkId\)/.test(blk), 'doLoad 에는 판정이 없습니다');
  must(/이미 열려 있는 작업입니다/.test(blk), '왜 안 열리는지 안 알려 줍니다');
  return '있음';
});

console.log(fails ? `\n❌ 실패 ${fails}건 / 통과 ${oks}건` : `\n✅ 통과 ${oks}건`);
process.exit(fails ? 1 : 0);
