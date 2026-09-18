/* ═══════════════════════════════════════════════════════════
   tools/test-sync-heal.js
   일정이 서버에서 빠지는 일이 '다시는 영구적으로 남지 않게' (2026-09-18)
   ----------------------------------------------------------------
   신고: "팀원이 나갔다 들어왔더니 일정이 일부는 보이고 일부는 안 보인다"

   ☠️ 영구 누락이 만들어지던 경로
      ① 같은 계정을 기기 둘에서 쓰면, 각 기기의 '권위적 정리'가 **서로의 작업**을 휴지통으로
         보낸다. 치운 쪽만 자기 해시를 지우므로, 다른 쪽은 해시가 멀쩡해 다시 안 올리고
         치운 쪽은 로컬에 없어 올릴 일이 없다 → 그 일정은 영영 휴지통.
      ② 폴더 하나를 못 읽어도 스캔은 '성공'처럼 보였다(조용한 부분 스캔). 그 줄어든 목록이
         기준선(cloudSyncedIds)으로 저장돼, 다음번 안전장치가 이미 깎인 숫자와 비교했다.
      ③ 업로드 여부를 로컬 해시로만 판단하고 서버를 확인하지 않아, ①②가 뚫은 구멍을
         스스로 메울 방법이 없었다.

   ⭐ 넣은 대책
      R1 자가복구 — 12시간마다 도는 전체 대조는 서버 문서를 이미 전부 읽는다. 그 목록으로
         '로컬엔 있는데 서버엔 없는' 작업을 찾아 해시를 무시하고 다시 올린다(추가 읽기 0).
      R2 부분 스캔 차단 — 실패한 폴더가 하나라도 있으면 정리도, 기준선 갱신도 하지 않는다.
      R3 기기 구분 — 올릴 때 기기 식별자를 찍고, 정리는 내 기기가 올린 문서만 건드린다.

   ☠️ 이 검사는 '진짜로 도는지'를 본다. 가짜 파이어베이스와 가짜 폴더를 만들어 syncAll 을
      실제로 돌리고 서버 쪽 결과를 확인한다 — 소스만 훑으면 R1 이 죽어 있어도 통과한다.
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

/* ── 가짜 파이어베이스 ── items / full 두 컬렉션을 따로 들고 있는다 */
function fakeDb(items) {
  const store = { items: Object.assign({}, items), full: {} };
  function colOf(name) {
    const m = store[name] || (store[name] = {});
    return {
      get: () => Promise.resolve({
        size: Object.keys(m).length,
        forEach: (f) => Object.keys(m).forEach(id => f({ id, data: () => m[id] }))
      }),
      doc: (id) => ({
        get: () => Promise.resolve({ exists: Object.prototype.hasOwnProperty.call(m, id), data: () => m[id] }),
        set: (p) => { m[id] = Object.assign({}, m[id] || {}, p); return Promise.resolve(); },
        update: (p) => { m[id] = Object.assign({}, m[id] || {}, p); return Promise.resolve(); },
        collection: () => colOf('photos')
      })
    };
  }
  return { store, db: { collection: () => ({ doc: () => ({ collection: colOf }) }) } };
}

/* ── 가짜 저장 폴더 ── names 의 폴더를 내주고, bad 에 든 이름은 읽다가 터진다 */
function fakeFolder(names, bad) {
  bad = bad || [];
  return {
    values: function () {
      let i = 0;
      return {
        [Symbol.asyncIterator]() { return this; },
        next() {
          if (i >= names.length) return Promise.resolve({ done: true });
          const name = names[i++];
          return Promise.resolve({
            done: false,
            value: {
              kind: 'directory', name,
              getFileHandle: () => bad.indexOf(name) >= 0
                ? Promise.reject(new Error('읽기 실패'))
                : Promise.resolve({ getFile: () => Promise.resolve({
                    text: () => Promise.resolve(JSON.stringify({
                      apt: name + ' 현장', date: name.slice(0, 10),
                      units: [{ name: '101', beforeCount: 1, afterCount: 1, customer: {} }],
                      savedAt: '2026-09-01T00:00:00.000Z'
                    }))
                  }) })
            }
          });
        }
      };
    }
  };
}

function load(opts) {
  opts = opts || {};
  const f = fakeDb(opts.server || {});
  const ls = {
    _d: Object.assign({}, opts.ls || {}),
    getItem: (k) => (k in ls._d ? ls._d[k] : null),
    setItem: (k, v) => { ls._d[k] = String(v); },
    removeItem: (k) => { delete ls._d[k]; },
    key: (i) => Object.keys(ls._d)[i],
    get length() { return Object.keys(ls._d).length; }
  };
  const logs = [];
  const ctx = {
    console: { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error(){} },
    setTimeout, clearTimeout, Date, String, Math, JSON, Object, Array, Promise, Symbol,
    parseInt, parseFloat, isNaN, Error,
    localStorage: ls,
    document: { addEventListener() {} },
    showToast() {},
    photoFolderHandle: fakeFolder(opts.folders || [], opts.badFolders),
    requestFolderPermissionSafe: () => Promise.resolve(true),
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } },
    Cloud: { ready: true, user: { uid: 'me' }, db: f.db }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('cloud_sync.js'), ctx, { filename: 'cloud_sync.js' });
  must(ctx.CloudSync, 'CloudSync 가 없습니다 (검사 기준이 낡았습니다)');
  return { CloudSync: ctx.CloudSync, srv: f.store.items, ls, logs };
}

/* 전체 대조를 태우고 올리기 큐가 빠질 때까지 기다린다 */
async function runFull(env) {
  await env.CloudSync.resync();     // noCleanup + fullCompare
  return env;
}
async function runSync(env) {
  /* 사용자가 직접 누른 동기화(!silent) = 전체 대조 + 정리까지 */
  await env.CloudSync.fullSync();
  for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 50)); }
  return env;
}

const WORK = (n) => '2026-09-0' + n;

(async function () {
  console.log('\n[1] R1 — 서버에서 빠진 일정을 스스로 메우는가');

  await achk('서버에 없는 일정이 다시 올라간다 (해시가 있어도)', async () => {
    const env = load({
      folders: [WORK(1), WORK(2)],
      server: { [WORK(1)]: { workId: WORK(1), date: WORK(1), deviceId: 'me-dev' } },   // 2번이 없다
      ls: { ['cloudSyncHash_me_' + WORK(2)]: 'stale' }   // "이미 올렸다"고 잘못 기억 중
    });
    await runFull(env);
    must(env.srv[WORK(2)], '서버에 없던 일정이 그대로 비어 있습니다 — R1 이 죽었습니다');
    must(env.srv[WORK(2)].date === WORK(2), '올라간 내용이 이상합니다');
    return '다시 올라감';
  });

  await achk('정리로 휴지통에 갔던 일정도 되살아난다', async () => {
    const env = load({
      folders: [WORK(1)],
      server: { [WORK(1)]: { workId: WORK(1), date: WORK(1), trashed: true, cleanupTrashed: true } },
      ls: { ['cloudSyncHash_me_' + WORK(1)]: 'stale' }
    });
    await runFull(env);
    must(env.srv[WORK(1)].trashed === false, '휴지통에서 안 나왔습니다');
    return '복원됨';
  });

  await achk('사람이 손으로 버린 일정은 되살리지 않는다', async () => {
    /* cleanupTrashed 가 없는 trashed = 사용자가 버린 것. 되살리면 지운 게 자꾸 돌아온다. */
    const env = load({
      folders: [WORK(1)],
      server: { [WORK(1)]: { workId: WORK(1), date: WORK(1), trashed: true } },
      ls: { ['cloudSyncHash_me_' + WORK(1)]: 'stale' }
    });
    await runFull(env);
    must(env.srv[WORK(1)].trashed === true, '사용자가 버린 일정을 되살렸습니다');
    return '그대로 둠';
  });

  console.log('\n[2] R2 — 조용한 부분 스캔을 차단하는가');

  await achk('폴더를 못 읽으면 정리도 기준선 갱신도 안 한다', async () => {
    const env = load({
      folders: [WORK(1), WORK(2), WORK(3), WORK(4), WORK(5)],
      badFolders: [WORK(3)],                               // 하나가 안 읽힌다
      server: {
        [WORK(1)]: { workId: WORK(1), date: WORK(1), deviceId: 'me-dev' },
        [WORK(3)]: { workId: WORK(3), date: WORK(3), deviceId: 'me-dev' }
      },
      ls: { 'cloudSyncedIds_me': JSON.stringify([WORK(1), WORK(2), WORK(3), WORK(4), WORK(5)]) }
    });
    await runSync(env);
    must(!env.srv[WORK(3)].trashed, '못 읽은 폴더의 일정을 휴지통으로 보냈습니다');
    const base = JSON.parse(env.ls.getItem('cloudSyncedIds_me') || '[]');
    must(base.length === 5, '기준선이 ' + base.length + '개로 깎였습니다 — 다음번 안전장치가 헐거워집니다');
    return '정리 보류 · 기준선 유지';
  });

  console.log('\n[3] R3 — 다른 기기 것을 지우지 않는가');

  await achk('다른 기기가 올린 문서는 건드리지 않는다', async () => {
    const env = load({
      folders: [WORK(1)],
      server: {
        [WORK(1)]: { workId: WORK(1), date: WORK(1), deviceId: 'me-dev' },
        [WORK(9)]: { workId: WORK(9), date: WORK(9), deviceId: 'OTHER-PHONE' }   // 내 폴더엔 없다
      }
    });
    await runSync(env);
    must(!env.srv[WORK(9)].trashed,
         '다른 기기가 올린 일정을 휴지통으로 보냈습니다 — 영구 누락이 여기서 만들어집니다');
    return '보존';
  });

  await achk('내 기기가 올린 찌꺼기는 정리한다', async () => {
    const env = load({
      folders: [WORK(1)],
      server: {
        [WORK(1)]: { workId: WORK(1), date: WORK(1), deviceId: 'MYDEV' },
        [WORK(9)]: { workId: WORK(9), date: WORK(9), deviceId: 'MYDEV' }
      },
      ls: { 'ac_device_id_v1': 'MYDEV' }
    });
    await runSync(env);
    must(env.srv[WORK(9)].trashed === true, '내 기기가 올린 유령 문서가 그대로 남았습니다');
    return '정리됨';
  });

  await achk('올릴 때 기기 식별자를 찍는다', async () => {
    const env = load({ folders: [WORK(1)], server: {}, ls: { 'ac_device_id_v1': 'MYDEV' } });
    await runFull(env);
    must(env.srv[WORK(1)] && env.srv[WORK(1)].deviceId === 'MYDEV',
         '식별자가 안 찍힙니다 — 다음 정리가 남의 것과 구분하지 못합니다');
    return 'deviceId';
  });

  await achk('옛 문서(식별자 없음)는 로컬이 모자라면 보류한다', async () => {
    /* 로컬 1건 / 서버 작업 5건 → 90% 미만이라 옛 문서는 건드리지 않는다 */
    const srv = {};
    for (let i = 1; i <= 5; i++) srv[WORK(i)] = { workId: WORK(i), date: WORK(i) };   // deviceId 없음
    const env = load({ folders: [WORK(1)], server: srv });
    await runSync(env);
    const gone = [2, 3, 4, 5].filter(i => env.srv[WORK(i)].trashed).length;
    must(gone === 0, '옛 문서 ' + gone + '건을 지웠습니다 — 폴더가 덜 잡힌 상태일 수 있습니다');
    return '보류';
  });

  console.log('\n' + (fails ? '❌ 실패 ' + fails + '건 / ' : '✅ ') + '통과 ' + oks + '건');
  process.exit(fails ? 1 : 0);
})();
