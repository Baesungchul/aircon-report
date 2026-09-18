/* ═══════════════════════════════════════════════════════════
   tools/test-resync.js
   일정 다시 맞추기 (스케줄 머리줄 ⟳) — 2026-09-18
   ----------------------------------------------------------------
   신고: "팀원이 나갔다 들어왔더니 일정이 일부는 보이고 일부는 안 보인다"

   ☠️ 원인은 팀 쪽이 아니라 업로드 쪽이었다.
      cloud_sync 는 '이미 올렸다'를 **로컬 해시(cloudSyncHash_)로만** 판단하고
      서버에 그 문서가 실제로 있는지는 보지 않는다. 그래서 어떤 이유로든 서버 문서가
      사라지면(권위적 정리·기기 교체·폴더가 덜 잡힌 채 돈 동기화 …) 그 일정은
      **영영 다시 안 올라간다.** 팀 재참여는 구독만 다시 걸 뿐 없는 문서를 만들지 않는다.

   ☠️ 이 버튼이 위험해질 수 있는 지점이 하나 있다 — 같은 동기화 안에 '로컬에 없는 클라우드
      문서를 휴지통으로 보내는' 정리가 들어 있다. 사용자가 이 버튼을 누르는 상황은
      "일정이 안 보인다" 일 때고, 그때 로컬 스캔이 조금이라도 모자라면 더 지워 버린다.
      고치러 온 버튼이 피해를 키우면 안 된다 → resync 는 그 정리를 반드시 꺼야 한다.
      이 검사가 지키는 것 중 제일 중요한 항목이다.
═══════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'www', 'js');

let fails = 0, oks = 0;
function chk(name, fn) {
  try { const r = fn(); console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; }
  catch (e) { console.log('  ❌ ' + name + ' — ' + e.message); fails++; }
}
function achk(name, fn) {
  return fn().then(r => { console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; })
             .catch(e => { console.log('  ❌ ' + name + ' — ' + e.message); fails++; });
}
const must = (c, m) => { if (!c) throw new Error(m); };
const read = (f) => fs.readFileSync(path.join(JS, f), 'utf8');
const strip = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('\n[1] 지우는 쪽을 껐는가 (제일 중요)');

chk('resync 는 권위적 정리를 끄고 부른다', () => {
  const s = strip(read('cloud_sync.js'));
  const at = s.indexOf('CloudSync.resync');
  must(at > 0, 'resync 가 없습니다');
  must(/syncAll\(true,\s*\{\s*noCleanup:\s*true\s*\}\)/.test(s.slice(at, at + 2600)),
       'resync 가 noCleanup 없이 syncAll 을 부릅니다 — 안 보이는 일정을 고치러 와서 더 지울 수 있습니다');
  return 'noCleanup: true';
});

chk('syncAll 이 그 값을 실제로 본다', () => {
  const s = strip(read('cloud_sync.js'));
  must(/if \(currentIds\.length > 0 && !opts\.noCleanup\)/.test(s),
       '정리 블록이 noCleanup 을 보지 않습니다 — 넘겨도 아무 소용이 없습니다');
  return '정리 블록에 걸려 있음';
});

console.log('\n[2] 해시를 비우는가 — 이걸 안 하면 버튼이 아무 일도 안 한다');

chk('두 해시를 모두 지운다', () => {
  const s = strip(read('cloud_sync.js'));
  const at = s.indexOf('CloudSync.resync');
  const blk = s.slice(at, at + 2600);
  must(/cloudSyncHash_/.test(blk), '요약 해시를 안 지웁니다');
  must(/cloudFullHash_/.test(blk), '전체본 해시를 안 지웁니다 — 재설치 복구본이 빈 채로 남습니다');
  return '요약 · 전체본';
});

chk('올리기 큐가 빠질 때까지 기다리되 상한이 있다', () => {
  const s = strip(read('cloud_sync.js'));
  must(/function gateIdle/.test(s), 'gateIdle 이 없습니다 — 큐에 넣자마자 끝났다고 알리게 됩니다');
  const at = s.indexOf('function gateIdle');
  must(/Date\.now\(\) - t0 >/.test(s.slice(at, at + 600)),
       '상한이 없습니다 — 통신이 막히면 화면을 영영 붙잡습니다');
  return '상한 있음';
});

console.log('\n[3] 버튼 — 달력 상단');

chk('스케줄 머리줄에 버튼이 있고 달력이 받는다', () => {
  const h = fs.readFileSync(path.join(ROOT, 'www', 'index.html'), 'utf8');
  must(/id="calResync"/.test(h), 'index.html 에 버튼이 없습니다');
  const at = h.indexOf('id="calResync"');
  must(h.lastIndexOf('id="customerModal"', at) > 0, '스케줄 창 머리줄이 아닙니다');
  const c = read('calendar.js');
  must(/getElementById\('calResync'\)/.test(c), 'calendar.js 가 버튼을 안 받습니다');
  must(/function resyncSchedules/.test(c), '실행 함수가 없습니다');
  return '머리줄 · 바인딩';
});

chk('내 쪽만이 아니라 상대 쪽도 새로 받는다', () => {
  const c = read('calendar.js');
  const at = c.indexOf('function resyncSchedules');
  const blk = c.slice(at, at + 3000);
  must(/CloudShare\.resubscribePartners/.test(blk), '팀원 구독을 다시 걸지 않습니다');
  must(/CloudTeams\.refresh/.test(blk), '팀 목록을 다시 읽지 않습니다');
  const sh = read('cloud_share.js');
  const at2 = sh.indexOf('CloudShare.resubscribePartners');
  must(at2 > 0, 'resubscribePartners 가 없습니다');
  must(/_oldMonthCache = \{\}/.test(sh.slice(at2, at2 + 700)),
       '과거 달 캐시를 안 비웁니다 — 이미 읽은 달은 다시 안 읽어서 그대로 비어 보입니다');
  return '구독 · 팀 목록 · 과거 달 캐시';
});

console.log('\n[4] 말없이 하지 않는가');

chk('먼저 물어본 뒤에 실행한다', () => {
  /* 건수가 많으면 1~2분 걸리고 통신도 쓴다. 모르고 눌러서 시작되면 안 된다. */
  const c = read('calendar.js');
  const at = c.indexOf('function resyncSchedules');
  const blk = c.slice(at, at + 3000);
  const askAt = blk.indexOf('confirm(');
  const runAt = blk.indexOf('CloudSync.resync');
  must(askAt > 0 && runAt > askAt, '확인창 없이 바로 시작합니다');
  return '확인창 먼저';
});

chk('숨긴 일정은 따로 묻고, 있을 때만 묻는다', () => {
  const c = read('calendar.js');
  const at = c.indexOf('function resyncSchedules');
  const blk = c.slice(at, at + 3000);
  must(/var hid = Object\.keys\(_shHiddenSet\(\) \|\| \{\}\)\.length;/.test(blk), '숨김 건수를 안 셉니다');
  must(/if \(hid && confirm\(/.test(blk),
       '숨김을 말없이 지우거나, 없는데도 물어봅니다 — 일부러 숨긴 걸 소리 없이 되살리면 더 놀랍습니다');
  return '있을 때만 · 따로 물음';
});

chk('성공 토스트는 한 줄뿐', () => {
  /* 2026-09-07 팝업 기준 ①: 오래 걸리는 일만 '끝났다' 한 줄. 건수는 적지 않는다. */
  const c = read('calendar.js');
  const at = c.indexOf('function resyncSchedules');
  const blk = c.slice(at, at + 3000);
  const oks_ = (blk.match(/showToast\([^)]*'ok'\)/g) || []);
  must(oks_.length === 1, '성공 토스트가 ' + oks_.length + '개입니다');
  must(!/건'/.test(oks_[0]) && !/changed/.test(oks_[0]),
       '건수를 알립니다 — 사용자가 그 숫자로 할 일이 없습니다');
  return '1개 · 건수 없음';
});

/* ── 실제로 돌려 본다 ──
   진짜 파이어베이스 없이 cloud_sync.js 를 가짜 브라우저에 올려, resync 가
   ① 내 해시만 지우는지 ② 남의 해시는 남기는지 ③ 폴더가 없으면 조용히 거절하는지 본다. */
function loadSync(store, opts) {
  opts = opts || {};
  const calls = { syncAll: 0, lastOpts: null };
  const ls = {
    _d: Object.assign({}, store),
    getItem: (k) => (k in ls._d ? ls._d[k] : null),
    setItem: (k, v) => { ls._d[k] = String(v); },
    removeItem: (k) => { delete ls._d[k]; },
    key: (i) => Object.keys(ls._d)[i],
    get length() { return Object.keys(ls._d).length; }
  };
  const ctx = {
    console: { log(){}, warn(){}, error(){} },
    setTimeout, clearTimeout, Date, String, Math, JSON, Object, Promise, Array,
    parseInt, parseFloat, isNaN, Error,
    localStorage: ls,
    document: { addEventListener() {} },
    showToast() {},
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } },
    Cloud: { ready: true, user: { uid: 'me' }, db: { collection: () => ({ doc: () => ({ collection: () => ({}) }) }) } }
  };
  if (opts.folder) ctx.photoFolderHandle = { name: 'f' };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('cloud_sync.js'), ctx, { filename: 'cloud_sync.js' });
  must(ctx.CloudSync && ctx.CloudSync.resync, 'CloudSync.resync 가 없습니다 (검사 기준이 낡았습니다)');
  return { CloudSync: ctx.CloudSync, ls, calls };
}

(async function () {
  console.log('\n[5] 실제로 돌려 보기');

  await achk('내 해시만 지우고 남의 것은 건드리지 않는다', async () => {
    const seed = {
      'cloudSyncHash_me_w1': 'a', 'cloudSyncHash_me_w2': 'b',
      'cloudFullHash_me_w1': 'c',
      'cloudSyncHash_other_w9': 'keep',     // 다른 계정 찌꺼기
      'cloudSyncedIds_me': '["w1"]',
      'calHiddenShared': '{"x":1}',          // 숨김은 여기서 건드리지 않는다
      'ac_theme': 'dark'
    };
    const { CloudSync, ls } = loadSync(seed, { folder: true });
    const r = await CloudSync.resync();
    must(r.ok, '거절당했습니다: ' + r.why);
    must(ls.getItem('cloudSyncHash_me_w1') === null, '내 해시가 안 지워졌습니다');
    must(ls.getItem('cloudFullHash_me_w1') === null, '내 전체본 해시가 안 지워졌습니다');
    must(ls.getItem('cloudSyncedIds_me') === null, '지난번 목록이 남았습니다');
    must(ls.getItem('cloudSyncHash_other_w9') === 'keep', '다른 계정 해시까지 지웠습니다');
    must(ls.getItem('calHiddenShared') === '{"x":1}', '숨김 목록을 말없이 지웠습니다');
    must(ls.getItem('ac_theme') === 'dark', '상관없는 설정을 지웠습니다');
    return '내 것 3개 · 남의 것 보존';
  });

  await achk('저장 폴더가 없으면 조용히 거절한다', async () => {
    const { CloudSync, ls } = loadSync({ 'cloudSyncHash_me_w1': 'a' });   // folder 없음
    const r = await CloudSync.resync();
    must(!r.ok, '폴더 없이 진행했습니다');
    must(/폴더/.test(r.why || ''), '이유가 폴더 얘기가 아닙니다: ' + r.why);
    must(ls.getItem('cloudSyncHash_me_w1') === 'a',
         '거절해 놓고 해시는 지웠습니다 — 다음 동기화가 전량 재업로드를 하게 됩니다');
    return '거절 · 해시 보존';
  });

  console.log('\n' + (fails ? '❌ 실패 ' + fails + '건 / ' : '✅ ') + '통과 ' + oks + '건');
  process.exit(fails ? 1 : 0);
})();
