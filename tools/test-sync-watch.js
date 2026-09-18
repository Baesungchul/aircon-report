/* ═══════════════════════════════════════════════════════════
   tools/test-sync-watch.js
   일정이 조용히 안 올라가는 일이 없게 (2026-09-18)
   ----------------------------------------------------------------
   ☠️ 신고: "업데이트하고 보니 이전 한 달가량의 공유일정이 안 보인다"
      사건 시점이 경계가 아니라 **기간**이라는 게 열쇠였다 — 그 기간 동안 그 폰이
      일정을 안 올리고 있었다는 뜻이다. 그리고 그게 완벽하게 조용했다:

        if (!photoFolderHandle) { if (!silent) showToast(...); return; }

      자동 동기화는 **언제나 silent** 다. 저장 폴더가 안 잡혀 있으면 아무 말 없이 돌아간다.
      본인 폰은 로컬 폴더로 달력을 그리니 멀쩡해 보이고, 팀원 쪽에서만 비어 보인다.
      몇 달이 지나도 알 방법이 없었다.

   ⭐ 이 검사가 지키는 약속: **며칠째 안 올라가고 있으면 반드시 화면에 보인다.**
      원인이 폴더든 로그인이든 부분 스캔이든, 같은 자리에서 같은 모양으로.
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
const read = (f) => fs.readFileSync(path.join(JS, f), 'utf8');

const DAY = 86400000;

function load(opts) {
  opts = opts || {};
  const nodes = {};
  const body = { appendChild(el) { nodes[el.id] = el; }, removeChild(el) { delete nodes[el.id]; } };
  const mk = () => ({
    id: '', className: '', innerHTML: '', textContent: '', parentNode: body,
    addEventListener() {}, appendChild() {},
    querySelector: () => ({ textContent: '' })
  });
  const ls = {
    _d: Object.assign({}, opts.ls || {}),
    getItem: (k) => (k in ls._d ? ls._d[k] : null),
    setItem: (k, v) => { ls._d[k] = String(v); },
    removeItem: (k) => { delete ls._d[k]; }
  };
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
    Date, String, Math, JSON, Object, parseInt, Error,
    localStorage: ls,
    document: { addEventListener() {}, createElement: mk, body,
                getElementById: (id) => nodes[id] || null },
    CloudSync: { status: () => opts.status || { okAt: Date.now(), blocked: '', days: 0 } },
    CloudShare: { hasAcceptedShare: () => opts.sharing !== false }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('sync_watch.js'), ctx, { filename: 'sync_watch.js' });
  must(ctx.SyncWatch, 'SyncWatch 가 없습니다 (검사 기준이 낡았습니다)');
  return { SW: ctx.SyncWatch, nodes, ls };
}
const shown = (env) => !!env.nodes['syncWarnBanner'];

console.log('\n[1] 조용히 멈춘 상태를 잡아내는가');

chk('저장 폴더가 없으면 알린다', () => {
  const env = load({ status: { okAt: Date.now(), blocked: 'folder', days: 0 } });
  env.SW.check();
  must(shown(env), '폴더가 없어 아무것도 안 올라가는데 화면에 아무 표시가 없습니다');
  must(/저장 폴더/.test(env.SW.reason()), '무엇을 하라는 건지 안 적혀 있습니다');
  return '뜸';
});

chk('로그인이 풀려도 알린다', () => {
  const env = load({ status: { okAt: Date.now(), blocked: 'login', days: 0 } });
  env.SW.check();
  must(shown(env), '로그인이 풀렸는데 표시가 없습니다');
  return '뜸';
});

chk('폴더를 다 못 읽었을 때도 알린다', () => {
  const env = load({ status: { okAt: Date.now(), blocked: 'partial', days: 0 } });
  env.SW.check();
  must(shown(env), '절반만 올라간 상태인데 표시가 없습니다');
  return '뜸';
});

chk('막힌 이유가 없어도 며칠째 안 올라갔으면 알린다', () => {
  /* 원인을 몰라도 '며칠째'는 말해야 한다 — 이번 신고가 딱 이 모양이었다 */
  const env = load({ status: { okAt: Date.now() - 30 * DAY, blocked: '', days: 30 } });
  env.SW.check();
  must(shown(env), '30일째 안 올라갔는데 표시가 없습니다');
  must(/30일째/.test(env.SW.reason()), '며칠째인지 안 알려줍니다');
  return '30일째';
});

console.log('\n[2] 쓸데없이 띄우지 않는가');

chk('멀쩡하면 안 띄운다', () => {
  const env = load({ status: { okAt: Date.now(), blocked: '', days: 0 } });
  env.SW.check();
  must(!shown(env), '멀쩡한데 경고가 떴습니다');
  return '조용';
});

chk('하루 이틀 늦은 것으로는 안 띄운다', () => {
  const env = load({ status: { okAt: Date.now() - 2 * DAY, blocked: '', days: 2 } });
  env.SW.check();
  must(!shown(env), '이틀 만에 경고를 띄웁니다 — 주말만 지나도 뜨면 아무도 안 봅니다');
  return '3일부터';
});

chk('혼자 쓰는 사람에게는 안 띄운다', () => {
  /* 공유 상대가 없으면 로컬 폴더가 곧 원본이다. 안 올라가도 잃는 게 없다. */
  const env = load({ sharing: false, status: { okAt: 0, blocked: 'folder', days: -1 } });
  env.SW.check();
  must(!shown(env), '혼자 쓰는데 팀원 얘기로 겁을 줍니다');
  return '조용';
});

chk('닫으면 하루는 조용하다', () => {
  const env = load({ ls: { 'ac_syncwarn_hid': String(Date.now() - 60000) },
                     status: { okAt: Date.now(), blocked: 'folder', days: 0 } });
  env.SW.check();
  must(!shown(env), '방금 닫았는데 또 띄웁니다');
  const env2 = load({ ls: { 'ac_syncwarn_hid': String(Date.now() - 2 * DAY) },
                      status: { okAt: Date.now(), blocked: 'folder', days: 0 } });
  env2.SW.check();
  must(shown(env2), '하루가 지났는데도 계속 조용합니다 — 문제가 그대로인데 잊힙니다');
  return '하루 뒤 다시';
});

console.log('\n[3] 기록하는 쪽 (cloud_sync)');

chk('막힌 이유를 남긴다', () => {
  const s = read('cloud_sync.js');
  must(/noteBlocked\('folder'\)/.test(s), '폴더가 없어 돌아갈 때 이유를 안 남깁니다');
  must(/noteBlocked\('login'\)/.test(s), '로그인이 없어 돌아갈 때 이유를 안 남깁니다');
  must(/if \(scanOk\) noteOk\(\); else noteBlocked\('partial'\)/.test(s),
       '부분 스캔을 성공으로 기록합니다 — 절반만 올라간 채로 경고가 안 뜹니다');
  return 'folder · login · partial';
});

chk('sync_watch 가 index.html 에 실리고 cloud_sync 뒤에 온다', () => {
  const h = fs.readFileSync(path.join(ROOT, 'www', 'index.html'), 'utf8');
  const a = h.indexOf('js/cloud_sync.js'), b = h.indexOf('js/sync_watch.js');
  must(b > 0, 'sync_watch.js 가 안 실립니다 — 파일만 있고 아무 일도 안 일어납니다');
  must(b > a, 'cloud_sync 보다 먼저 실립니다 — status 를 못 읽습니다');
  return '순서 정상';
});

console.log('\n' + (fails ? '❌ 실패 ' + fails + '건 / ' : '✅ ') + '통과 ' + oks + '건');
process.exit(fails ? 1 : 0);
