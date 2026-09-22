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

chk('☠️ 폴더를 다 못 읽었다고 겁주지 않는다', () => {
  /* ☠️ 2026-09-22 사용자 신고 — 화면 위에 빨간 띠가 계속 떴다.
       "저장 폴더를 다 읽지 못해 일부 일정이 올라가지 않았습니다"
     원인은 둘이었다.
       ① cloud_sync 가 **세션 파일이 없는 평범한 폴더**를 '못 읽은 폴더'로 세고 있었다.
          날짜 폴더에 _session.json 이 없는 건 흔한 일이다 → scanOk 가 영영 false.
       ② 설령 진짜였어도 사용자가 **할 수 있는 일이 없는 경고**였다.
     → 이 띠를 없앴다. 정말 안 올라가고 있으면 아래 '며칠째' 검사가 잡는다. */
  const env = load({ status: { okAt: Date.now(), blocked: 'partial', days: 0 } });
  env.SW.check();
  must(!shown(env), '없앤 경고가 다시 뜹니다 — 사용자가 할 수 있는 일이 없는 경고입니다');
  must(env.SW.reason() === null, 'partial 에 아직 문구가 달려 있습니다');
  return '안 뜸';
});

chk('☠️ 그래도 정말 안 올라가면 며칠째인지는 말한다', () => {
  /* 위 경고를 없앤 대신, 진짜 사고(한 달치가 조용히 안 올라감)는 이쪽이 잡아야 한다.
     이 검사가 없으면 '시끄러워서 껐다'가 '아무도 모른다'가 된다. */
  const env = load({ status: { okAt: Date.now() - 5 * DAY, blocked: 'partial', days: 5 } });
  env.SW.check();
  must(shown(env), '5일째 안 올라갔는데도 조용합니다');
  must(/5일째/.test(env.SW.reason()), '며칠째인지 안 알려줍니다');
  return '5일째';
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
  /* ⚠️ 2026-09-22 — partial 은 더 이상 막힌 이유로 남기지 않는다. 남기면 okAt 이 갱신되지
     않아 '며칠째 안 올라갔습니다' 경고가 뒤따라 뜬다(올라가고 있는데도). */
  must(!/noteBlocked\('partial'\)/.test(s),
       'partial 을 막힌 이유로 남깁니다 — 올라가고 있는데 날짜가 쌓입니다');
  return 'folder · login';
});

chk('☠️ 세션 파일이 없는 폴더를 「못 읽은 폴더」로 세지 않는다', () => {
  /* 이번 오경보의 뿌리다. 한 덩어리 try 안에 getFileHandle 과 읽기가 같이 있어서,
     파일이 없는 폴더도 failed++ 로 갔다.
     ⚠️ 오류 이름(NotFoundError)으로 가르면 안 된다 — 네이티브 폴더는 Capacitor 오류를
        그대로 던져 이름이 다르다. 구조로 갈라야 한다. */
  /* ☠️ 주석을 걷어내고 본다 — 위 설명 주석에 'failed++' 라는 글자가 그대로 적혀 있어서,
     주석째로 세면 제대로 고쳐 놓고도 2군데로 잡힌다(이 세션에서 세 번째 당했다). */
  const s = read('cloud_sync.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const at = s.indexOf('async function scanLocalItems');
  must(at > 0, 'scanLocalItems 를 못 찾았습니다');
  const b = s.slice(at, at + 1600);
  must(/try \{ sf = await entry\.getFileHandle\('_session\.json'\); \}[\s\S]{0,120}catch \(e\) \{ continue; \}/.test(b),
       '세션 파일 찾기를 따로 떼어내지 않았습니다 — 없는 폴더가 실패로 셉니다');
  const fails = (b.match(/failed\+\+/g) || []).length;
  must(fails === 1, 'failed++ 가 ' + fails + '군데입니다 (읽기 실패 한 곳이어야 합니다)');
  must(!/NotFoundError/.test(b), '오류 이름으로 가르고 있습니다 — 네이티브에서는 이름이 다릅니다');
  return '따로 가름';
});

chk('부분 스캔이어도 기준선·정리는 여전히 건너뛴다', () => {
  /* 경고를 없앴다고 안전장치까지 풀면, 반만 읽은 목록이 기준선이 되어 톱니가 생긴다 */
  const s = read('cloud_sync.js');
  must(/if \(scanOk\) setSyncedIds\(uid, currentIds\)/.test(s), '부분 스캔으로 기준선을 갱신합니다');
  must(/if \(currentIds\.length > 0 && scanOk\)/.test(s), '부분 스캔으로 서버 대조를 돌립니다');
  return '그대로';
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
