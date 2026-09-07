/* ═══════════════════════════════════════════════════════════
   tools/test-restore-snapshot.js
   폴더 복원에서 리마인더·설정이 되살아나는지 검사한다 (node tools/test-restore-snapshot.js)
   ----------------------------------------------------------------
   왜 필요한가 (2026-09-07 사용자 신고: "폴더복구를 했는데 리마인더는 복구가 안 되는 현상"):
     복원은 사진 기준으로 '이미 있는 파일은 건너뜀'인데, 리마인더·설정은 이름이 늘 같은
     스냅샷 파일이라 앱이 다시 써 둔 (거의 빈) 사본에 막혀 백업본이 영영 안 들어왔다.
     이건 오류가 안 나고 조용히 실패한다 — 그래서 사람 눈으로는 못 잡는다.
   브라우저가 필요 없다. localStorage·Filesystem 을 가짜로 만들어 로직만 돌린다.
═══════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', 'www', 'js');

let fails = 0, oks = 0;
function chk(name, fn) {
  try { const r = fn(); if (r && r.then) throw new Error('동기 검사만'); console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; }
  catch (e) { console.log('  ❌ ' + name + ' — ' + e.message); fails++; }
}
async function chkA(name, fn) {
  try { const r = await fn(); console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; }
  catch (e) { console.log('  ❌ ' + name + ' — ' + e.message); fails++; }
}
const must = (c, m) => { if (!c) throw new Error(m); };

/* ── 가짜 브라우저 ── */
function makeWorld() {
  const store = {};
  const ls = {
    get length() { return Object.keys(store).length; },
    key: i => Object.keys(store)[i],
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };
  const ctx = {
    console, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number, Array, Object, Error,
    localStorage: ls,
    document: { addEventListener() {}, readyState: 'complete', querySelectorAll: () => [], getElementById: () => null },
    photoFolderHandle: null,
    showToast() {}
  };
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  return { ctx, store };
}
function load(ctx, file) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
}

const REM = (items) => JSON.stringify({ version: 1, savedAt: new Date().toISOString(), items });
const mk = (id, title, date, updatedAt) =>
  ({ id, title, date, endDate: '', time: '09:00', lead: 30, repeat: 'none', memo: '',
     done: false, doneDates: [], createdAt: updatedAt, updatedAt });

console.log('\n[1] Reminders.mergeSnapshot — 백업본을 지금 목록에 합친다');

(async () => {
  await chkA('빈 앱 + 백업 3건 → 3건 되살아남', async () => {
    const { ctx } = makeWorld();
    load(ctx, 'reminders.js');
    const n = await ctx.Reminders.mergeSnapshot(REM([
      mk('r_1', '서비스센터 방문', '2026-09-10', 1000),
      mk('r_2', '자재 주문', '2026-09-11', 1000),
      mk('r_3', '세금계산서', '2026-09-12', 1000)
    ]));
    must(n === 3, '새로 채운 건수가 ' + n);
    must(ctx.Reminders.all().length === 3, '목록이 ' + ctx.Reminders.all().length + '건');
    return '3건';
  });

  await chkA('지금 것도 백업 것도 둘 다 남는다 (덮어쓰지 않음)', async () => {
    const { ctx } = makeWorld();
    load(ctx, 'reminders.js');
    ctx.localStorage.setItem('ac_reminders_v1', JSON.stringify([mk('r_now', '오늘 만든 것', '2026-09-08', 5000)]));
    const n = await ctx.Reminders.mergeSnapshot(REM([mk('r_old', '백업에 있던 것', '2026-09-01', 1000)]));
    const ids = ctx.Reminders.all().map(r => r.id).sort();
    must(ids.length === 2, '합친 결과가 ' + ids.length + '건: ' + ids);
    must(ids.indexOf('r_now') >= 0 && ids.indexOf('r_old') >= 0, '한쪽이 사라짐: ' + ids);
    must(n === 1, '새로 채운 건수가 ' + n);
    return '지금 1 + 백업 1 = 2건';
  });

  await chkA('같은 id 는 updatedAt 이 최신인 쪽이 이긴다', async () => {
    const { ctx } = makeWorld();
    load(ctx, 'reminders.js');
    ctx.localStorage.setItem('ac_reminders_v1', JSON.stringify([mk('r_1', '옛 제목', '2026-09-10', 1000)]));
    await ctx.Reminders.mergeSnapshot(REM([mk('r_1', '고친 제목', '2026-09-10', 9000)]));
    const a = ctx.Reminders.all();
    must(a.length === 1, '중복이 생김: ' + a.length + '건');
    must(a[0].title === '고친 제목', '옛 값이 이김: ' + a[0].title);
    return '최신본 채택';
  });

  await chkA('메모리 캐시까지 갱신된다 (화면이 안 바뀌던 원인)', async () => {
    const { ctx } = makeWorld();
    load(ctx, 'reminders.js');
    ctx.Reminders.all();                       // 여기서 빈 목록이 캐시된다
    await ctx.Reminders.mergeSnapshot(REM([mk('r_1', '되살릴 것', '2026-09-10', 1000)]));
    must(ctx.Reminders.all().length === 1, '캐시가 안 갈아끼워짐 — 되살려도 화면엔 안 나온다');
    return '캐시 갱신됨';
  });

  await chkA('망가진 파일·빈 파일에 안 무너진다', async () => {
    const { ctx } = makeWorld();
    load(ctx, 'reminders.js');
    ctx.localStorage.setItem('ac_reminders_v1', JSON.stringify([mk('r_1', '지금 것', '2026-09-10', 1000)]));
    must(await ctx.Reminders.mergeSnapshot('') === 0, '빈 문자열에서 0이 아님');
    must(await ctx.Reminders.mergeSnapshot('{망가짐') === 0, '깨진 JSON 에서 0이 아님');
    must(await ctx.Reminders.mergeSnapshot(REM([{ id: 'x' }])) === 0, '날짜 없는 항목을 받아들임');
    must(ctx.Reminders.all().length === 1, '지금 것이 사라짐');
    return '지금 것 보존';
  });

  console.log('\n[2] AppData.applyText — 백업본 문자열로 설정을 되살린다');

  chk('비어있는 항목만 채운다 (지금 값은 안 건드림)', () => {
    const { ctx } = makeWorld();
    load(ctx, 'appdata_backup.js');
    ctx.localStorage.setItem('ac_co_v2', '{"name":"지금 업체"}');
    const snap = JSON.stringify({ version: 1, count: 2, data: {
      'ac_co_v2': '{"name":"백업 업체"}',
      'claude_blog_guideline': '백업 지침'
    }});
    const n = ctx.AppData.applyText(snap, 'missing');
    must(n === 1, '적용 건수가 ' + n);
    must(ctx.localStorage.getItem('ac_co_v2') === '{"name":"지금 업체"}', '지금 값이 덮어써짐');
    must(ctx.localStorage.getItem('claude_blog_guideline') === '백업 지침', '빈 항목이 안 채워짐');
    return '1건 적용 · 지금 값 보존';
  });

  chk('깨진 파일은 0건 (예외로 복원 전체를 멈추지 않는다)', () => {
    const { ctx } = makeWorld();
    load(ctx, 'appdata_backup.js');
    must(ctx.AppData.applyText('{망가짐', 'missing') === 0, '깨진 JSON 에서 0이 아님');
    must(ctx.AppData.applyText('', 'missing') === 0, '빈 문자열에서 0이 아님');
    return '0건';
  });

  console.log('\n[3] backup.js — 복원 앞뒤로 스냅샷을 치웠다가 합치는가');

  chk('네 갈래 복원 모두 _snapStash 와 _snapMerge 를 쓴다', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backup.js'), 'utf8');
    const stash = (src.match(/await _snapStash\(\)/g) || []).length;
    const merge = (src.match(/await _snapMerge\(\)/g) || []).length;
    must(stash >= 4, '복원 경로 4개인데 _snapStash 가 ' + stash + '곳');
    must(merge >= 4, '_snapMerge 가 ' + merge + '곳');
    must(!/AppData && AppData\.autoApply/.test(src),
         'AppData.autoApply() 가 남아 있다 — 그건 앱 폴더의 제 사본을 읽어 늘 0건이었다');
    return '치우기 ' + stash + '곳 · 합치기 ' + merge + '곳';
  });

  chk('중간에 끊겨도 .mine 을 되돌리는 안전장치가 있다', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backup.js'), 'utf8');
    must(/_snapRecoverStray/.test(src), '끊긴 복원 복구 코드가 없다 — 리마인더가 통째로 사라질 수 있다');
    must(/'_reminders\.json', '_appdata\.json'/.test(src), '스냅샷 파일 목록이 바뀌었다');
    return '있음';
  });

  console.log('\n[4] 실제 흐름 — 앱에 빈 사본이 있어도 백업본이 들어온다');

  await chkA('예전 버그 재현 후 고쳐졌는지 확인 (복원 전 치우기 → 복사 → 합치기)', async () => {
    const { ctx } = makeWorld();

    /* 가짜 파일시스템 — EXTERNAL 한 곳만 쓴다 */
    const disk = {};
    const FSp = {
      async stat({ path }) { if (!(path in disk)) throw new Error('없음'); return { type: 'file' }; },
      async readFile({ path }) { if (!(path in disk)) throw new Error('없음'); return { data: disk[path] }; },
      async writeFile({ path, data }) { disk[path] = data; },
      async deleteFile({ path }) { if (!(path in disk)) throw new Error('없음'); delete disk[path]; },
      async rename({ from, to }) { if (!(from in disk)) throw new Error('없음'); disk[to] = disk[from]; delete disk[from]; },
      async readdir() { return { files: [] }; },
      async mkdir() {}, async copy() {}
    };
    ctx.Capacitor = { Plugins: { Filesystem: FSp }, isNativePlatform: () => true };
    ctx.NativeFS = { isNative: () => true, resolveAppFolder: async () => 'work-report' };
    ctx.JSZip = undefined;

    load(ctx, 'reminders.js');
    load(ctx, 'appdata_backup.js');
    load(ctx, 'backup.js');

    const APP = 'work-report/_reminders.json';
    /* 앱이 켜지며 써 둔 '거의 빈' 사본 — 이게 예전엔 백업본을 막았다 */
    disk[APP] = REM([]);
    /* 백업 폴더에 든 진짜 사본 */
    const BACKUP = REM([
      mk('r_a', '10시까지 서비스센터 방문', '2026-09-10', 1000),
      mk('r_b', '자재 주문', '2026-09-11', 1000)
    ]);

    /* 복원이 파일을 옮기는 방식 — 네 갈래·자바가 모두 쓰는 그 규칙 그대로 */
    async function copyLikeRestore() {
      let skipped = 0;
      if (APP in disk) { skipped++; }          // ★ "이미 있는 파일은 건너뜀"
      else disk[APP] = BACKUP;
      return skipped;
    }

    /* (가) 예전 동작 — 치우기 없이 바로 복사 */
    must(await copyLikeRestore() === 1, '예전 버그가 재현되지 않음 (건너뛰지 않았다)');
    must(disk[APP] === REM([]), '재현 실패 — 빈 사본이 아니다');

    /* (나) 고친 동작 — 치우기 → 복사 → 합치기 */
    await ctx.__snapRestore.stash();
    must(!(APP in disk), '_snapStash 가 사본을 안 치웠다 — 백업본이 또 막힌다');
    must(('work-report/_reminders.json.mine') in disk, '.mine 으로 안 옮겨졌다');
    must(await copyLikeRestore() === 0, '치웠는데도 건너뛰었다');
    await ctx.__snapRestore.merge();

    const all = ctx.Reminders.all();
    must(all.length === 2, '되살아난 리마인더가 ' + all.length + '건');
    must(!(('work-report/_reminders.json.mine') in disk), '.mine 뒷정리가 안 됐다');
    return '2건 되살아남 · .mine 정리됨';
  });

  await chkA('복원이 실패해 백업본이 안 들어오면 내 사본을 되돌린다', async () => {
    const { ctx } = makeWorld();
    const disk = {};
    ctx.Capacitor = { Plugins: { Filesystem: {
      async stat({ path }) { if (!(path in disk)) throw new Error('없음'); return { type: 'file' }; },
      async readFile({ path }) { if (!(path in disk)) throw new Error('없음'); return { data: disk[path] }; },
      async writeFile({ path, data }) { disk[path] = data; },
      async deleteFile({ path }) { if (!(path in disk)) throw new Error('없음'); delete disk[path]; },
      async rename({ from, to }) { if (!(from in disk)) throw new Error('없음'); disk[to] = disk[from]; delete disk[from]; },
      async readdir() { return { files: [] }; }, async mkdir() {}, async copy() {}
    } }, isNativePlatform: () => true };
    ctx.NativeFS = { isNative: () => true, resolveAppFolder: async () => 'work-report' };
    load(ctx, 'reminders.js'); load(ctx, 'appdata_backup.js'); load(ctx, 'backup.js');

    const APP = 'work-report/_reminders.json';
    const mine = REM([mk('r_keep', '지우면 안 되는 것', '2026-09-09', 7000)]);
    disk[APP] = mine;
    await ctx.__snapRestore.stash();
    /* 복원이 아무것도 못 넣고 끝난 상황 */
    await ctx.__snapRestore.merge();
    must(disk[APP] === mine, '내 사본이 안 돌아왔다 — 리마인더가 통째로 날아간다');
    must(!((APP + '.mine') in disk), '.mine 이 남았다');
    return '내 사본 그대로';
  });

  console.log('\n' + (fails ? '❌ 실패 ' + fails + '건 / ' : '✅ ') + '통과 ' + oks + '건');
  process.exit(fails ? 1 : 0);
})();
