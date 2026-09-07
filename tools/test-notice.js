/* ═══════════════════════════════════════════════════════════
   tools/test-notice.js
   서버에서 바꾸는 앱 안 공지(notice.js)가 제 조건에만 뜨는지 검사한다
   ----------------------------------------------------------------
   왜 필요한가 (2026-09-07):
     이 공지는 **파이어베이스 콘솔에서 값만 바꿔** 실제 사용자에게 바로 뜬다.
     잘못 뜨면(끝난 할인이 계속 뜨거나, 정가로 내고 있는 구독자에게 할인 공지가 뜨거나,
     한 번 닫았는데 또 뜨거나) 되돌릴 방법이 재빌드밖에 없다.
     그래서 판정 로직만은 브라우저 없이 여기서 못 박아 둔다.
═══════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const JS = path.join(__dirname, '..', 'www', 'js');

let fails = 0, oks = 0;
function chk(name, fn) {
  try { const r = fn(); console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; }
  catch (e) { console.log('  ❌ ' + name + ' — ' + e.message); fails++; }
}
const must = (c, m) => { if (!c) throw new Error(m); };

/* notice.js 를 가짜 브라우저에 올려 shouldShow 만 꺼내 쓴다 */
function loadShouldShow() {
  const ctx = {
    console, setTimeout, Date, String, Math, JSON, Object,
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { addEventListener() {}, getElementById: () => null, querySelector: () => null,
                createElement: () => ({ style: {}, classList: { add() {} }, addEventListener() {} }) }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(JS, 'notice.js'), 'utf8'), ctx, { filename: 'notice.js' });
  must(typeof ctx.__noticeShouldShow === 'function', 'notice.js 가 판정 함수를 안 내놓습니다 (검사 기준이 낡았습니다)');
  return ctx.__noticeShouldShow;
}
const shouldShow = loadShouldShow();

const N = (over) => Object.assign({
  id: 'promo-1', title: '기간 한정 50% 할인', body: '…', target: 'all'
}, over || {});

console.log('\n[1] 뜨는 조건');

chk('id 와 제목이 있으면 뜬다', () => {
  must(shouldShow(N(), { today: '2026-09-20' }), '안 뜬다');
  return '뜸';
});

chk('id 가 없으면 안 뜬다 (한 번만 보이게 할 열쇠가 없다)', () => {
  must(!shouldShow(N({ id: '' }), { today: '2026-09-20' }), 'id 없이 떴다');
  must(!shouldShow(N({ title: '' }), { today: '2026-09-20' }), '제목 없이 떴다');
  must(!shouldShow(null, { today: '2026-09-20' }), 'notice 가 없는데 떴다');
  return '안 뜸';
});

console.log('\n[2] 기간 — 지난 할인이 계속 뜨면 안 된다');

chk('until 이 지나면 저절로 안 뜬다', () => {
  must(shouldShow(N({ until: '2026-10-15' }), { today: '2026-10-15' }), '마지막 날인데 안 뜬다');
  must(!shouldShow(N({ until: '2026-10-15' }), { today: '2026-10-16' }), '끝난 할인이 계속 뜬다');
  return '마지막 날까지만';
});

chk('from 전에는 안 뜬다', () => {
  must(!shouldShow(N({ from: '2026-09-10' }), { today: '2026-09-09' }), '시작 전에 떴다');
  must(shouldShow(N({ from: '2026-09-10' }), { today: '2026-09-10' }), '시작일에 안 뜬다');
  return '시작일부터';
});

console.log('\n[3] 대상 — 정가로 내는 구독자에게 할인 공지를 띄우지 않는다');

chk("target:'free' 는 구독자에게 안 뜬다", () => {
  must(shouldShow(N({ target: 'free' }), { today: '2026-09-20', paid: false }), '무료 사용자에게 안 뜬다');
  must(!shouldShow(N({ target: 'free' }), { today: '2026-09-20', paid: true }), '구독자에게 할인 공지가 떴다');
  return '무료만';
});

chk("target:'paid' 는 구독자에게만 뜬다", () => {
  must(shouldShow(N({ target: 'paid' }), { today: '2026-09-20', paid: true }), '구독자에게 안 뜬다');
  must(!shouldShow(N({ target: 'paid' }), { today: '2026-09-20', paid: false }), '무료 사용자에게 떴다');
  return '구독자만';
});

chk("target 을 안 적으면 모두에게 뜬다", () => {
  must(shouldShow(N({ target: undefined }), { today: '2026-09-20', paid: true }), '구독자에게 안 뜬다');
  must(shouldShow(N({ target: undefined }), { today: '2026-09-20', paid: false }), '무료 사용자에게 안 뜬다');
  return '기본 all';
});

console.log('\n[4] 한 번 보면 다시 안 뜬다');

chk('본 공지는 다시 안 뜬다', () => {
  must(!shouldShow(N({ id: 'promo-1' }), { today: '2026-09-20', seen: 'promo-1' }), '본 공지가 또 뜬다');
  must(shouldShow(N({ id: 'promo-2' }), { today: '2026-09-20', seen: 'promo-1' }), 'id 를 바꿨는데 안 뜬다');
  return 'id 로 구분';
});

console.log('\n[5] 배선 — 조용히 끊기면 안 되는 것들');

chk('index.html 이 notice.js 를 부른다', () => {
  const h = fs.readFileSync(path.join(JS, '..', 'index.html'), 'utf8');
  must(/js\/notice\.js/.test(h), 'index.html 에서 빠졌습니다 — 공지가 영영 안 뜹니다');
  return '있음';
});

chk('업데이트 안내보다 뒤에 선다', () => {
  const s = fs.readFileSync(path.join(JS, 'notice.js'), 'utf8');
  /* 재시도용 setTimeout 이 아니라 DOMContentLoaded 에서 처음 도는 시점을 본다 */
  const m = s.match(/DOMContentLoaded'[\s\S]{0,120}?setTimeout\(check,\s*(\d+)\)/);
  must(m, '앱 시작 시점을 못 찾았습니다 (검사 기준이 낡았습니다)');
  must(+m[1] >= 2600, '공지가 ' + m[1] + 'ms 에 떠서 업데이트 안내(2600ms)를 덮습니다');
  must(/getElementById\('verGate'\)/.test(s), '업데이트 게이트가 떠 있는지 안 봅니다');
  return m[1] + 'ms';
});

chk('띄운 뒤에만 봤다고 기록한다', () => {
  const s = fs.readFileSync(path.join(JS, 'notice.js'), 'utf8');
  const showAt = s.indexOf('function show(n)');
  const setAt = s.indexOf('set(SEEN_KEY, n.id)');
  must(showAt > 0 && setAt > showAt, '띄우기 전에 기록합니다 — 다른 팝업에 밀리면 공지를 영영 못 봅니다');
  return '기록 위치 정상';
});

chk('읽기 실패가 앱을 막지 않는다', () => {
  const s = fs.readFileSync(path.join(JS, 'notice.js'), 'utf8');
  must(/\.catch\(function \(e\) \{\s*\n?\s*console\.warn\('\[공지\]/.test(s),
       '파이어베이스 읽기 실패를 안 잡습니다 — 공지 때문에 앱이 멈출 수 있습니다');
  return '조용히 넘어감';
});

console.log('\n' + (fails ? '❌ 실패 ' + fails + '건 / ' : '✅ ') + '통과 ' + oks + '건');
process.exit(fails ? 1 : 0);
