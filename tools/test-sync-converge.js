/* ═══════════════════════════════════════════════════════════
   tools/test-sync-converge.js
   "서버에 올라간 일정 = 원작업자 로컬" 이 스스로 맞춰지는가 (2026-09-18)
   ----------------------------------------------------------------
   요구: "목적은 팀원간 동일한 일정을 유지하는 것. 그러려면 서버에 올라가 있는 일정과
         원작업자 일정이 동일해야 한다."

   ☠️ R1(test-sync-heal.js)이 못 보던 절반
      R1 은 문서가 **있는지**만 본다. 있는데 **내용이 다른** 문서는 아무도 안 본다.
      올릴지 말지는 로컬 해시로만 판단하는데, 그 해시가 기록하는 것은
      "서버에 이게 있다"가 아니라 "내가 이걸 올리려고 했다"이기 때문이다.
      특히 충돌 가드가 '서버가 최신'이라며 건너뛸 때 **해시를 써 버린다** —
      그 순간부터 로컬 ≠ 서버인데 시스템은 '동기화됨'으로 표시한다.

   ⭐ 넣은 대책 (R4)
      ① 올릴 때 내용 지문(syncHash)을 같이 싣는다 → 서버 문서가 자기 내용을 말한다.
      ② 12시간 전체 대조에서 지문을 비교한다(추가 읽기 0).
         · 지문이 다르다   = 내 올리기가 반영 안 됨 → 해시만 지우고 평소 경로로 다시 올린다.
         · 서버가 더 최신  = 상대 수정을 내가 못 받음 → 받아와야 한다(CloudShare.retryApply).
      ③ 저장시각이 지금보다 크게 미래면 충돌 가드로 치지 않는다(시계가 틀린 기기 방어).
      ④ 달력 피기백(pushWorkItems)을 pushOne 으로 합쳤다 — 업로드 경로가 둘이면 갈라진다.

   ☠️ 소스만 훑지 않는다. 가짜 파이어베이스·가짜 폴더로 syncAll 을 실제로 돌리고
      서버 쪽 결과를 본다 — 안 그러면 R4 가 죽어 있어도 통과한다.
═══════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'www', 'js');

let fails = 0, oks = 0;
function achk(name, fn) {
  return fn().then(r => { console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; })
             .catch(e => { console.log('  ❌ ' + name + ' — ' + e.message); fails++; });
}
function chk(name, fn) {
  try { const r = fn(); console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; }
  catch (e) { console.log('  ❌ ' + name + ' — ' + e.message); fails++; }
}
const must = (c, m) => { if (!c) throw new Error(m); };
const read = (f) => fs.readFileSync(path.join(JS, f), 'utf8');

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

/* 폴더마다 현장명·저장시각을 따로 줄 수 있어야 한다 —
   '로컬만 고쳐진 상태'와 '상대가 더 최신인 상태'를 만들어야 하기 때문이다 */
function fakeFolder(names, opt) {
  opt = opt || {};
  const apt = opt.apt || {}, saved = opt.saved || {};
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
              getFileHandle: () => Promise.resolve({ getFile: () => Promise.resolve({
                text: () => Promise.resolve(JSON.stringify({
                  apt: apt[name] || (name + ' 현장'),
                  date: name.slice(0, 10),
                  units: [{ name: '101', beforeCount: 1, afterCount: 1, customer: {} }],
                  savedAt: saved[name] || '2026-09-01T00:00:00.000Z'
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
  const retried = [];                       // CloudShare.retryApply 가 불린 workId
  const ctx = {
    console: { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error(){} },
    setTimeout, clearTimeout, Date, String, Math, JSON, Object, Array, Promise, Symbol,
    parseInt, parseFloat, isNaN, Error,
    localStorage: ls,
    document: { addEventListener() {} },
    showToast() {},
    photoFolderHandle: fakeFolder(opts.folders || [], opts),
    requestFolderPermissionSafe: () => Promise.resolve(true),
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } },
    CloudShare: { retryApply: (w) => { retried.push(w); return Promise.resolve(true); } },
    Cloud: { ready: true, user: { uid: 'me' }, db: f.db }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('cloud_sync.js'), ctx, { filename: 'cloud_sync.js' });
  must(ctx.CloudSync, 'CloudSync 가 없습니다 (검사 기준이 낡았습니다)');
  return { CloudSync: ctx.CloudSync, srv: f.store.items, ls, logs, retried, ctx };
}

/* 사용자가 직접 누른 동기화(!silent) = 전체 대조가 돈다. 큐가 빠질 때까지 기다린다 */
async function runSync(env) {
  await env.CloudSync.fullSync();
  for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 20)); }
  return env;
}

const W1 = '2026-09-01', W2 = '2026-09-02';

/* ☠️ 검사가 진짜를 보게 하는 장치.
   로컬 해시(cloudSyncHash_)가 **지금 내용과 맞는** 상태여야 평소 업로드 경로가 건너뛴다.
   그래야 "서버가 다른데 로컬은 '동기화됨'으로 굳어 있다"는 **실제로 나던 상태**가 되고,
   거기서 고쳐지는지를 봐야 R4 를 보는 것이다.
   (해시를 아무 값이나 넣으면 평소 경로가 올려 버려서, R4 를 통째로 지워도 검사가 통과한다 —
    실제로 그렇게 새던 것을 변이 검사로 잡았다.) */
async function correctHash(opt) {
  const e = load(opt);
  await runSync(e);
  const id = (opt.folders || [])[0];
  must(e.srv[id] && e.srv[id].syncHash, '기준 지문을 못 구했습니다');
  return e.srv[id].syncHash;
}

(async function () {
  console.log('\n[1] 서버 문서가 자기 내용을 말하는가 (syncHash)');

  await achk('올릴 때 내용 지문이 같이 실린다', async () => {
    const env = load({ folders: [W1] });
    await runSync(env);
    must(env.srv[W1], '올라가지 않았습니다');
    must(env.srv[W1].syncHash, '지문이 없습니다 — 이게 없으면 내용 대조가 통째로 불가능합니다');
    return env.srv[W1].syncHash;
  });

  await achk('지문은 저장시각·기기값이 바뀌어도 달라지지 않는다', async () => {
    /* 지문이 휘발 필드까지 포함하면 매번 달라져 '항상 불일치'가 된다(전량 재업로드). */
    const a = load({ folders: [W1] });
    await runSync(a);
    const b = load({ folders: [W1], ls: { ac_device_id_v1: 'other-device' } });
    await runSync(b);
    must(a.srv[W1].syncHash === b.srv[W1].syncHash,
         '기기가 다르다고 지문이 달라집니다 — 매번 불일치로 잡힙니다');
    must(a.srv[W1].deviceId !== b.srv[W1].deviceId, '기기 식별자는 달라야 합니다(검사 전제 확인)');
    return '내용만 본다';
  });

  console.log('\n[2] 내용이 다르면 스스로 맞추는가 (R4-a)');

  await achk('서버 내용이 내 로컬과 다르면 다시 올린다', async () => {
    /* ☠️ 실제로 나던 상태: 충돌 가드가 건너뛰면서 해시를 써 둬서
         로컬 ≠ 서버인데 '동기화됨'으로 굳어 있다. */
    const h = await correctHash({ folders: [W1], apt: { [W1]: '진짜 현장' } });
    const env = load({
      folders: [W1],
      apt: { [W1]: '진짜 현장' },
      server: { [W1]: { workId: W1, date: W1, apt: '옛날 현장', syncHash: '9:zzzz', deviceId: 'me' } },
      ls: { ['cloudSyncHash_me_' + W1]: h }     // 로컬은 '이미 올렸다'로 굳어 있다
    });
    await runSync(env);
    must(env.srv[W1].apt === '진짜 현장',
         '서버가 옛 내용 그대로입니다 — 내용 대조(R4)가 죽었습니다: ' + env.srv[W1].apt);
    return '맞춰짐';
  });

  await achk('내용이 같으면 헛쓰기를 하지 않는다', async () => {
    /* 먼저 한 번 올려 서버에 올바른 지문을 만든 뒤, 같은 상태로 다시 돌린다. */
    const env = load({ folders: [W1] });
    await runSync(env);
    const h = env.srv[W1].syncHash;
    env.srv[W1].apt = env.srv[W1].apt;            // 그대로
    let writes = 0;
    const realSet = env.srv;                       // 쓰기 횟수는 로그로 본다
    env.logs.length = 0;
    await runSync(env);
    must(env.srv[W1].syncHash === h, '지문이 바뀌었습니다');
    const line = env.logs.filter(l => l.indexOf('내용불일치') >= 0).join(' ');
    must(line.indexOf('내용불일치 0') >= 0, '같은데도 불일치로 셌습니다: ' + line);
    return '0건';
  });

  await achk('지문이 없는 옛 문서는 불일치로 세지 않는다', async () => {
    /* 도입 직후엔 모든 문서에 지문이 없다. 그걸 전부 불일치로 보면
       첫 실행에 전 작업이 재업로드된다(요금·지연). */
    const h = await correctHash({ folders: [W1] });
    const env = load({
      folders: [W1],
      /* 내용은 일부러 다르게 둔다 — 지문이 없다는 이유만으로 건너뛰는지 보는 것이다 */
      server: { [W1]: { workId: W1, date: W1, apt: '서버 옛 이름', deviceId: 'me' } },
      ls: { ['cloudSyncHash_me_' + W1]: h }
    });
    env.logs.length = 0;
    await runSync(env);
    const line = env.logs.filter(l => l.indexOf('내용불일치') >= 0).join(' ');
    must(line.indexOf('내용불일치 0') >= 0, '지문 없는 옛 문서를 불일치로 셌습니다: ' + line);
    return '건너뜀';
  });

  console.log('\n[3] 상대 수정을 못 받고 멈춘 것을 푸는가 (R4-b)');

  await achk('서버가 더 최신이면 올리지 않고 반영을 다시 시도한다', async () => {
    /* ☠️ 이게 '사라지는 게 아니라 멈추는' 상태다.
         상대가 고쳐 서버 savedAt 이 올라갔는데 내 폰이 그걸 로컬에 못 썼다.
         그대로 올리면 상대 수정이 되돌아가므로, 올리는 게 아니라 받아와야 한다. */
    const env = load({
      folders: [W1],
      saved: { [W1]: '2026-09-01T00:00:00.000Z' },
      server: { [W1]: { workId: W1, date: W1, apt: '상대가 고친 이름',
                        syncHash: '1:aaa', deviceId: 'me',
                        savedAt: Date.now() - 30 * 60 * 1000 } }   // 30분 전 = 충분히 묵음
    });
    await runSync(env);
    must(env.retried.length > 0, '반영 재시도를 안 불렀습니다 — 멈춘 채로 남습니다');
    must(env.srv[W1].apt === '상대가 고친 이름',
         '상대가 고친 값을 내 옛 값으로 덮었습니다: ' + env.srv[W1].apt);
    return 'retryApply(' + env.retried[0] + ')';
  });

  await achk('방금 들어온 상대 수정은 멈춘 것으로 세지 않는다', async () => {
    /* 상대가 1분 전에 고쳤으면 아직 반영 중일 수 있다. 그걸 '멈췄다'고 세면
       배너가 늘 떠 있게 된다. */
    const env = load({
      folders: [W1],
      server: { [W1]: { workId: W1, date: W1, apt: '방금 고침', syncHash: '1:aaa',
                        deviceId: 'me', savedAt: Date.now() - 60 * 1000 } }
    });
    env.logs.length = 0;
    await runSync(env);
    const line = env.logs.filter(l => l.indexOf('못받음') >= 0).join(' ');
    must(line.indexOf('못받음 0') >= 0, '방금 수정을 멈춘 것으로 셌습니다: ' + line);
    return '0건';
  });

  await achk('멈춘 건수와 처음 본 시각을 남긴다 (배너가 읽는다)', async () => {
    const env = load({
      folders: [W1],
      server: { [W1]: { workId: W1, date: W1, apt: 'x', syncHash: '1:a', deviceId: 'me',
                        savedAt: Date.now() - 30 * 60 * 1000 } }
    });
    await runSync(env);
    const st = env.CloudSync.status();
    must(st.stuck === 1, '멈춘 건수를 안 남겼습니다: ' + st.stuck);
    must(st.stuckDays >= 0, '처음 본 시각을 안 남겼습니다');
    return 'stuck=' + st.stuck;
  });

  await achk('다 풀리면 경고 기록을 지운다', async () => {
    const env = load({
      folders: [W1],
      ls: { cloudSyncStuckN: '3', cloudSyncStuckSince: String(Date.now() - 86400000 * 5) }
    });
    await runSync(env);
    must(env.CloudSync.status().stuck === 0, '멈춘 게 없는데 경고가 남아 있습니다');
    must(!env.ls.getItem('cloudSyncStuckSince'), '처음 본 시각이 안 지워졌습니다 — 배너가 영영 안 꺼집니다');
    return '지워짐';
  });

  console.log('\n[4] 시계가 틀린 기기 방어');

  await achk('하루 미래로 찍힌 저장시각은 내 업로드를 막지 못한다', async () => {
    /* ☠️ 팀원 폰 시계가 하루 빠르면, 그 한 번의 수정으로 원작업자의 이후 수정이
         하루 동안 통째로 안 올라갔다. 규칙이 막기 전에 이미 오염된 문서를 푼다. */
    const env = load({
      folders: [W1],
      apt: { [W1]: '내가 고친 이름' },
      server: { [W1]: { workId: W1, date: W1, apt: '옛 이름', deviceId: 'me',
                        savedAt: Date.now() + 24 * 60 * 60 * 1000 } }
    });
    await runSync(env);
    must(env.srv[W1].apt === '내가 고친 이름',
         '미래 시각에 막혀 내 수정이 안 올라갔습니다: ' + env.srv[W1].apt);
    return '올라감';
  });

  await achk('정상 범위(1시간 안)의 최신 서버 값은 그대로 지킨다', async () => {
    /* 여유를 너무 넓게 잡으면 방어가 아니라 '상대 수정 덮어쓰기'가 된다. */
    const env = load({
      folders: [W1],
      apt: { [W1]: '내 옛 이름' },
      server: { [W1]: { workId: W1, date: W1, apt: '상대가 방금 고침', deviceId: 'me',
                        savedAt: Date.now() + 10 * 60 * 1000 } }
    });
    await runSync(env);
    must(env.srv[W1].apt === '상대가 방금 고침',
         '10분 앞선 정상 값까지 덮었습니다: ' + env.srv[W1].apt);
    return '지켜짐';
  });

  console.log('\n[5] 업로드 경로가 하나인가');

  await achk('달력 피기백도 pushOne 을 탄다 (기기값·지문이 찍힌다)', async () => {
    /* ☠️ 예전엔 pushWorkItems 가 따로 썼다. 그래서 달력을 먼저 연 작업은
         deviceId 없는 '옛 문서'가 되고 지문도 안 붙었다 — 같은 문서를 두 코드가
         다르게 쓰고 있었다. */
    const env = load({ folders: [] });
    env.CloudSync.pushWorkItems([{ type: 'work', sortDate: W2, data: {
      folderName: W2, date: W2, apt: '달력에서 올린 현장',
      units: [{ name: '101', customer: {} }],
      session: { units: [{ name: '101', customer: {} }], savedAt: '2026-09-02T00:00:00.000Z' }
    } }]);
    for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 20)); }
    must(env.srv[W2], '달력 피기백이 안 올렸습니다');
    must(env.srv[W2].deviceId, '기기 식별자가 없습니다 — 경로가 아직 둘입니다');
    must(env.srv[W2].syncHash, '지문이 없습니다 — 경로가 아직 둘입니다');
    return 'pushOne 경유';
  });

  chk('pushWorkItems 안에 따로 쓰는 코드가 남아 있지 않다', () => {
    const src = read('cloud_sync.js');
    const i = src.indexOf('CloudSync.pushWorkItems');
    const j = src.indexOf('CloudSync.retireRenamedItem');
    must(i > 0 && j > i, '함수를 못 찾았습니다 (검사 기준이 낡았습니다)');
    const body = src.slice(i, j);
    must(body.indexOf('.set(') < 0, '아직 직접 set 합니다 — 경로가 둘로 갈라집니다');
    must(body.indexOf('pushOne(') > 0, 'pushOne 을 안 부릅니다');
    return '한 곳';
  });

  console.log('\n[6] 파이어스토어 규칙 — 마지막 방어선');

  const RULES = path.join(ROOT, 'firestore.rules');
  chk('규칙 파일이 저장소에 있다', () => {
    must(fs.existsSync(RULES), 'firestore.rules 가 없습니다 — 콘솔에만 두면 코드와 같이 못 본다');
    return 'firestore.rules';
  });

  const rules = fs.existsSync(RULES) ? fs.readFileSync(RULES, 'utf8') : '';

  chk('팀원 update 가 필드 화이트리스트로 묶여 있다', () => {
    const i = rules.indexOf('match /schedules/{uid}/items/{itemId}');
    must(i > 0, '일정 문서 규칙을 못 찾았습니다');
    const block = rules.slice(i, i + 4000);
    must(block.indexOf('partnerSafe()') > 0, '팀원 update 에 제한이 없습니다');
    must(block.indexOf('hasOnly(partnerKeys())') > 0, '필드 화이트리스트가 없습니다');
    return 'partnerSafe';
  });

  chk('팀원이 남의 일정을 휴지통으로 보낼 수 없다', () => {
    must(/trashed.*==\s*false/.test(rules), '되살리기만 허용하는 조건이 없습니다');
    return '되살리기만';
  });

  chk('팀원이 저장시각을 미래로 찍을 수 없다', () => {
    must(rules.indexOf('request.time.toMillis()') > 0,
         '서버 시각 기준 검사가 없습니다 — 시계가 틀린 기기를 못 막습니다');
    return '서버 시각 기준';
  });

  chk('앱이 실제로 쓰는 팀원 필드가 화이트리스트에 전부 있다', () => {
    /* ☠️ 여기서 하나라도 빠지면 그 기능이 permission-denied 로 **조용히** 실패한다.
       규칙과 코드가 따로 놀지 않게, 실제 쓰기 목록을 여기 박아 두고 대조한다. */
    const used = [
      // cloud_share.editItem
      'apt','name','target','phone','address','price','startTime','endTime','memo',
      'worker','date','endDate','workType','unitNames','totalUnits',
      'profileId','profileIcon','profileName','profileSnap','editedBy','updatedAt','savedAt',
      // cloud_share.restoreSchedule (상대도 복원할 수 있다)
      'trashed','trashedAt','cleanupTrashed','restoredBy','restoredAt',
      // cloud_share.markClaimed
      'claimedBy','claimedAt',
      // cloud_photo_sync — 순서편집 / 보탠 사진 / 원본 재요청
      'photoOrder','orderedBy','orderedAt',
      'addedPhotos','lastBorrowedUploadNonce','lastBorrowedUploadCount','lastBorrowedUploadAt',
      'reuploadRequestedAt','reuploadRequestedBy'
    ];
    const i = rules.indexOf('function partnerKeys()');
    must(i > 0, 'partnerKeys 를 못 찾았습니다');
    const list = rules.slice(i, rules.indexOf('}', rules.indexOf('return [', i)));
    const miss = used.filter(k => list.indexOf("'" + k + "'") < 0);
    must(!miss.length, '규칙에 빠진 필드: ' + miss.join(', '));
    return used.length + '개 전부';
  });

  chk('원작업자만 쓰는 필드는 화이트리스트에 없다', () => {
    /* ⚠️ 이게 핵심이다. 이 값들이 남의 손에 바뀌면 자가복구가 '내가 올린 게 아니다'라고
       오판하거나(deviceId), 내용 대조가 영영 어긋난다(syncHash). */
    const i = rules.indexOf('function partnerKeys()');
    const list = rules.slice(i, rules.indexOf('}', rules.indexOf('return [', i)));
    const forbidden = ['workId', 'deviceId', 'syncHash', 'manual', 'totalPhotos', 'posts'];
    const leaked = forbidden.filter(k => list.indexOf("'" + k + "'") >= 0);
    must(!leaked.length, '팀원이 바꿀 수 있게 열려 있습니다: ' + leaked.join(', '));
    return forbidden.length + '개 잠김';
  });

  console.log('\n[7] 멈춘 반영을 푸는 경로 (cloud_share.retryApply)');

  chk('retryApply 가 있고, 포기 기록을 지우고 직접 다시 시도한다', () => {
    const src = read('cloud_share.js');
    const i = src.indexOf('CloudShare.retryApply');
    must(i > 0, 'retryApply 가 없습니다 — 3회 실패로 포기된 작업을 풀 방법이 없습니다');
    const body = src.slice(i, i + 1600);
    must(body.indexOf('_applyFails[w] = 0') > 0, '포기 횟수를 초기화하지 않습니다');
    must(body.indexOf('delete _appliedHash[w]') > 0,
         "'이미 반영했다' 기록을 안 지웁니다 — 같은 내용은 다시 안 써집니다");
    must(body.indexOf('applyCloudEditToLocal') > 0,
         '직접 다시 시도하지 않습니다 — 다음 스냅샷까지 아무 일도 안 납니다');
    return '초기화 + 재시도';
  });

  chk('cloud_sync 가 실제로 그 경로를 부른다', () => {
    const src = read('cloud_sync.js');
    must(src.indexOf('CloudShare.retryApply') > 0,
         '내용 대조가 retryApply 를 안 부릅니다 — 멈춘 것은 계속 멈춰 있습니다');
    return '연결됨';
  });

  chk('배너가 멈춘 건수를 읽어 말한다', () => {
    const src = read('sync_watch.js');
    must(src.indexOf('st.stuck') > 0, '배너가 멈춘 건수를 안 봅니다');
    must(src.indexOf('stuckDays') > 0, '하루는 기다렸다 말하는 조건이 없습니다');
    return '하루 뒤 알림';
  });

  console.log(fails ? ('\n❌ 실패 ' + fails + '건 / 통과 ' + oks + '건')
                    : ('\n✅ 통과 ' + oks + '건'));
  process.exit(fails ? 1 : 0);
})();
