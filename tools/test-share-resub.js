/* ═══════════════════════════════════════════════════════════
   tools/test-share-resub.js
   끊긴 팀원 일정 구독이 스스로 살아나는가 (2026-09-18)
   ----------------------------------------------------------------
   ☠️ "팀원이 나갔다 들어왔더니 일정이 일부는 보이고 일부는 안 보인다" 의 뿌리
      ① onSnapshot 에러 콜백이 console.warn 한 줄이 전부였다 — 재시도가 없었다.
      ② subscribePartner 의 `if (_partnerUnsubs[pUid]) return;` 가드 때문에, 리스너가
         권한 거부로 죽어도 항목이 남아 앱이 살아 있는 동안 다시 걸리지 않았다.
      ③ _partnerItems[pUid] 는 마지막 스냅샷을 그대로 들고 있었다.
      → 팀에서 나가면 구독이 죽고, 그때까지 받은 일정은 화면에 남고, 다시 들어와도
        재구독이 안 되니 **그 뒤에 생기거나 바뀐 것만 안 보인다.**
        탈퇴 시점을 경계로 앞은 보이고 뒤는 안 보이는 것이 '일부만'의 정체였다.

   ⚠️ 이 검사는 실제로 구독을 죽여 보고 다시 붙는지 센다. 소스만 훑으면
      가드에 막혀 영영 안 걸리는 상태여도 통과한다.
═══════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'www', 'js');

let fails = 0, oks = 0;
function achk(name, fn) {
  return fn().then(r => { console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; })
             .catch(e => { console.log('  ❌ ' + name + ' — ' + e.message); fails++; });
}
const must = (c, m) => { if (!c) throw new Error(m); };
const read = (f) => fs.readFileSync(path.join(JS, f), 'utf8');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

/* ── 아주 작은 DOM ── 배너가 붙었는지만 보면 된다 */
function tinyDom() {
  const nodes = {};
  const body = { appendChild(el) { nodes[el.id] = el; }, removeChild(el) { delete nodes[el.id]; } };
  const mk = () => {
    const el = { id: '', className: '', textContent: '', style: {}, children: [],
                 parentNode: body, appendChild(c) { this.children.push(c); },
                 addEventListener() {}, setAttribute() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
                 querySelector: () => null, querySelectorAll: () => [] };
    return el;
  };
  return {
    _nodes: nodes,
    addEventListener() {}, createElement: mk, body,
    getElementById: (id) => nodes[id] || null,
    querySelector: () => null, querySelectorAll: () => []
  };
}

/* ── 가짜 파이어베이스 ── 구독을 손으로 죽일 수 있다 */
function tinyDb() {
  const subs = [];                       // 지금까지 만들어진 상대 일정 구독들
  function itemsQuery(pUid) {
    return {
      where() { return this; },
      onSnapshot(next, err) {
        const rec = { pUid, next, err, alive: true };
        subs.push(rec);
        setTimeout(() => { if (rec.alive) next({ forEach() {} }); }, 0);   // 최초 스냅샷
        return function () { rec.alive = false; };
      }
    };
  }
  const db = {
    collection(name) {
      return {
        where() { return { get: () => Promise.resolve({ docs: [], forEach() {} }),
                           onSnapshot() { return function () {}; } }; },
        doc(id) {
          return {
            collection: () => itemsQuery(id),
            onSnapshot() { return function () {}; },
            get: () => Promise.resolve({ exists: false, data: () => ({}) }),
            set: () => Promise.resolve(), update: () => Promise.resolve()
          };
        }
      };
    }
  };
  return { db, subs, live: (p) => subs.filter(s => s.pUid === p && s.alive).length,
           made: (p) => subs.filter(s => s.pUid === p).length,
           killLast: (p) => { const l = subs.filter(s => s.pUid === p && s.alive).pop();
                              must(l, '죽일 구독이 없습니다'); l.alive = false;
                              l.err({ code: 'permission-denied' }); } };
}

function load() {
  const f = tinyDb();
  const doc = tinyDom();
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Date, String, Math, JSON, Object, Array, Promise,
    parseInt, parseFloat, isNaN, Error,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: doc,
    showToast() {},
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'TS', delete: () => 'DEL',
                                           arrayUnion: () => 'AU', arrayRemove: () => 'AR' } } },
    Cloud: { ready: true, user: { uid: 'me', email: 'me@x.com', displayName: '나' }, db: f.db }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('cloud_share.js'), ctx, { filename: 'cloud_share.js' });
  must(ctx.CloudShare && ctx.CloudShare.setTeamPartners, 'CloudShare 가 안 올라왔습니다');
  return { CS: ctx.CloudShare, f, doc };
}
const banner = (env) => !!env.doc.getElementById('csSubBanner');

(async function () {
  console.log('\n[1] 구독이 죽으면 스스로 다시 붙는가');

  await achk('권한 거부로 죽어도 잠시 뒤 다시 건다', async () => {
    const env = load();
    env.CS.setTeamPartners({ p1: '팀원' });
    await wait(50);
    must(env.f.made('p1') === 1, '처음 구독이 안 걸렸습니다');
    env.f.killLast('p1');                       // 팀에서 나간 순간처럼 죽인다
    await wait(50);
    must(env.f.made('p1') === 1, '너무 일찍 다시 걸었습니다');
    await wait(2600);                            // 첫 백오프 2초
    must(env.f.made('p1') === 2,
         '다시 안 걸렸습니다 — 구독이 죽은 채로 남아 그 뒤 일정이 영영 안 보입니다');
    return '2초 뒤 재구독';
  });

  await achk('되살아나면 화면 위 한 줄이 사라진다', async () => {
    const env = load();
    env.CS.setTeamPartners({ p1: '팀원' });
    await wait(50);
    must(!banner(env), '멀쩡한데 경고가 떴습니다');
    env.f.killLast('p1');
    await wait(50);
    must(banner(env), '구독이 끊겼는데 화면에 아무 표시가 없습니다 — 옛 목록을 사실처럼 보여줍니다');
    await wait(2600);                            // 재구독 → 최초 스냅샷 → 해제
    must(!banner(env), '되살아났는데 경고가 남아 있습니다');
    return '뜸 → 사라짐';
  });

  await achk('진짜로 떠난 상대는 두드리지 않는다', async () => {
    const env = load();
    env.CS.setTeamPartners({ p1: '팀원' });
    await wait(50);
    env.CS.setTeamPartners({});                  // 팀에서 빠졌다
    await wait(50);
    const before = env.f.made('p1');
    await wait(2600);
    must(env.f.made('p1') === before, '떠난 상대를 계속 다시 구독합니다 — 통신 낭비입니다');
    must(!banner(env), '떠난 상대 때문에 경고가 떠 있습니다');
    return '재시도 없음';
  });

  console.log('\n[2] 팀에 다시 들어오면');

  await achk('재참여하면 구독을 강제로 새로 건다', async () => {
    const env = load();
    env.CS.setTeamPartners({ p1: '팀원' });
    await wait(50);
    env.f.killLast('p1');                        // 죽은 채로 두고
    env.CS.setTeamPartners({ p1: '팀원' });      // 곧바로 다시 들어옴(재시도 타이머보다 먼저)
    await wait(50);
    must(env.f.made('p1') >= 2,
         '재참여했는데 구독이 그대로입니다 — 가드에 막혀 영영 안 걸립니다');
    return '강제 재구독';
  });

  console.log('\n[3] 소스에 남아 있어야 할 규칙');

  await achk('구독 에러 콜백이 그냥 넘어가지 않는다', async () => {
    const s = read('cloud_share.js');
    must(/_partnerSubFailed\(pUid, err\)/.test(s), '에러를 처리하는 함수로 넘기지 않습니다');
    const at = s.indexOf('function _partnerSubFailed');
    must(at > 0, '_partnerSubFailed 가 없습니다');
    const blk = s.slice(at, at + 1400);
    must(/_dropPartnerSub\(pUid, true\)/.test(blk),
         '구독 항목을 놓아 주지 않습니다 — 가드에 막혀 재구독이 안 됩니다');
    must(/_stillPartner\(pUid\)/.test(blk), '떠난 상대까지 무한 재시도합니다');
    must(/Math\.min\(60000/.test(blk), '백오프 상한이 없습니다');
    return '놓아줌 · 조건부 · 상한';
  });

  await achk('과거 달 캐시에 수명이 있다', async () => {
    const s = read('cloud_share.js');
    must(/OLD_MONTH_TTL/.test(s), '과거 달 캐시가 영구입니다 — 그 달에 일정이 추가돼도 안 보입니다');
    must(/_oldMonthFresh\(ck\)/.test(s), '낡았는지 보지 않고 캐시만 씁니다');
    return 'TTL 있음';
  });

  console.log('\n' + (fails ? '❌ 실패 ' + fails + '건 / ' : '✅ ') + '통과 ' + oks + '건');
  process.exit(fails ? 1 : 0);
})();
