/* ═══════════════════════════════════════════════════════════════════
   tools/test-photo-lazy.js — 불러온 사진이 한 장씩 안 보이던 문제
   ----------------------------------------------------------------
   무슨 일이 있었나 (2026-09-22, 사용자 신고)
     "방금 불러오기를 했는데 사진 한 장이 안 보이는 증상이 있었어.
      다른 걸 불렀다가 다시 불러오니 이번에는 보였어."

   원인 세 가지가 겹쳐 있었다.
     ① 한 번 실패한 사진을 아무도 다시 읽지 않았다.
        예전 catch 는 _loading 만 내리고 lazy 를 true 로 남겼다. 그런데 그
        'lazy 니까 다시 읽어라' 를 읽어 줄 다음 렌더가 오지 않는다. 회색 칸이 굳는다.
     ② 동시에 수십 장을 읽었다. 불러온 호수는 전부 펼침(open:true)이라
        render.js 가 사진 전부의 읽기를 한꺼번에 건다. 안드로이드는 파일 하나를
        읽을 때마다 base64 문자열이 네이티브에서 WebView 로 통째로 넘어온다
        (native-fs.js NFile.getFile). 몰리면 그중 하나가 떨어진다.
     ③ 폴더 목록 읽기가 실패하면 native-fs 가 조용히 빈 목록을 돌려줬다.
        부르는 쪽은 '사진 0장' 으로 받아들이고, _photosOnDisk 가 안 붙어
        다음 저장 때 폴더의 사진이 지워질 수 있었다.

   ⭐ 이 시험이 지키는 것
     · 실패하면 반드시 다시 읽는다 (그리고 무한히는 아니다)
     · 동시에 읽는 장수에 뚜껑이 있다
     · 있어야 할 사진을 한 장도 못 읽으면 폴더를 건드리지 않는다
═══════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

/* ☠️ 세 번 당한 함정 — 찾는 글자가 그 글자를 설명하는 주석에도 들어 있어서
      코드를 다 지워도 시험이 통과했다. 주석을 먼저 걷어내고 본다. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const EV_RAW  = rd('www', 'js', 'events.js');
const EV      = strip(EV_RAW);
const NFS     = strip(rd('www', 'js', 'native-fs.js'));
const DLG     = strip(rd('www', 'js', 'dialogs.js'));
const CSS     = rd('www', 'styles.css');

let pass = 0;
const fails = [];
/* ☠️ 2026-09-22 처음 쓸 때 여기서 한 번 속았다.
     chk 가 fn() 을 기다리지 않아, async 시험은 Promise 만 돌려주고 바로 ✅ 가 찍혔다.
     안에서 던진 것은 아무도 못 받는다 — 코드를 다 망가뜨려도 15개 전부 통과했다.
   ★ 반드시 await 할 것. 그리고 돌려받은 값이 Promise 면 그 자체가 사고다. */
const jobs = [];
function chk(name, fn) { jobs.push([name, fn]); }
async function runAll() {
  for (const [name, fn] of jobs) {
    if (fn === null) { console.log(name); continue; }
    try {
      const n = await fn();
      if (n && typeof n.then === 'function') throw new Error('시험이 Promise 를 돌려줬습니다 — 기다리지 않았습니다');
      pass++; console.log('  ✅ ' + name + (n ? ' — ' + n : ''));
    } catch (e) { fails.push(name); console.log('  ❌ ' + name + ' — ' + ((e && e.message) || e)); }
  }
}
function say(line) { jobs.push([line, null]); }
function must(c, m) { if (!c) throw new Error(m); }

say('\n📷 사진 지연 로딩 — 실패해도 다시 읽는가\n');

/* ── 1. 진짜로 돌려 본다 ─────────────────────────────────────────────
   글자만 찾으면 숫자가 뒤집혀 있어도 통과한다. loadLazyPhoto 를 떼어
   가짜 파일핸들과 함께 실제로 실행한다. */
function harness() {
  const at = EV_RAW.indexOf('const LAZY_MAX');
  must(at > 0, 'LAZY_MAX 를 못 찾았습니다');
  const end = EV_RAW.indexOf('window.retryLazyPhoto = function', at);
  must(end > at, 'retryLazyPhoto 를 못 찾았습니다');
  const tail = EV_RAW.indexOf('\n};', end) + 3;
  const src = EV_RAW.slice(at, tail);

  const calls = { rerender: 0 };
  const doc = { querySelectorAll: () => [] };
  const win = {};
  const f = new Function('document', 'window', 'blobToDataURL', 'scheduleLazyRerender', 'console',
    src + '; return { loadLazyPhoto: loadLazyPhoto, retry: window.retryLazyPhoto, LAZY_MAX: LAZY_MAX, LAZY_TRY: LAZY_TRY, LAZY_ROUNDS: LAZY_ROUNDS, calls: arguments[4] };');
  const api = f(doc, win, async () => 'data:image/jpeg;base64,AAA',
    () => { calls.rerender++; }, { warn: () => {} });
  api.calls = calls;
  return api;
}

chk('읽기가 늘 실패하면 한 번에 여러 번 다시 읽는다', async () => {
  const A = harness();
  let reads = 0;
  const p = { id: 'p1', lazy: true, fileHandle: { getFile: async () => { reads++; throw new Error('bridge'); } } };
  await A.loadLazyPhoto(p);
  must(reads === A.LAZY_TRY, '읽기 시도가 ' + reads + '회 (' + A.LAZY_TRY + '회여야 함)');
  return reads + '회 시도';
});

chk('그래도 실패하면 lazy 를 살려 둔다 (다음 렌더가 또 해 볼 수 있게)', async () => {
  const A = harness();
  const p = { id: 'p1', lazy: true, fileHandle: { getFile: async () => { throw new Error('x'); } } };
  await A.loadLazyPhoto(p);
  must(p.lazy === true, '실패했는데 lazy 가 꺼졌습니다 — 영영 회색 칸이 됩니다');
  must(!p.dataUrl, '실패했는데 dataUrl 이 생겼습니다');
  must(p._loading === false, '_loading 이 안 내려갔습니다 — 다음 시도가 막힙니다');
  return 'lazy 유지';
});

chk('실패하면 다시 그리기를 예약한다 — 이게 없으면 영영 그대로다', async () => {
  const A = harness();
  const p = { id: 'p1', lazy: true, fileHandle: { getFile: async () => { throw new Error('x'); } } };
  await A.loadLazyPhoto(p);
  await new Promise(r => setTimeout(r, 1200));
  must(A.calls.rerender > 0, '재렌더 예약이 없습니다');
  return A.calls.rerender + '회 예약';
});

chk('그래도 무한히는 아니다 — 묶음 한도를 넘으면 그만둔다', async () => {
  const A = harness();
  let reads = 0;
  const p = { id: 'p1', lazy: true, fileHandle: { getFile: async () => { reads++; throw new Error('x'); } } };
  for (let i = 0; i < A.LAZY_ROUNDS + 3; i++) await A.loadLazyPhoto(p);
  must(reads === A.LAZY_TRY * A.LAZY_ROUNDS,
    '읽기 ' + reads + '회 (' + (A.LAZY_TRY * A.LAZY_ROUNDS) + '회에서 멈춰야 함)');
  return reads + '회에서 멈춤';
});

chk('사용자가 그 칸을 누르면 한도를 넘었어도 다시 읽는다', async () => {
  const A = harness();
  let reads = 0;
  const p = { id: 'p1', lazy: true, fileHandle: { getFile: async () => { reads++; throw new Error('x'); } } };
  for (let i = 0; i < A.LAZY_ROUNDS + 2; i++) await A.loadLazyPhoto(p);
  const before = reads;
  A.retry(p);
  await new Promise(r => setTimeout(r, 1500));
  must(reads > before, '손으로 눌러도 다시 읽지 않았습니다');
  return '재시도 되살아남';
});

chk('한 번이라도 읽히면 거기서 끝낸다 (쓸데없이 더 읽지 않는다)', async () => {
  const A = harness();
  let reads = 0;
  const p = { id: 'p1', lazy: true, fileHandle: { getFile: async () => { reads++; if (reads < 2) throw new Error('x'); return {}; } } };
  await A.loadLazyPhoto(p);
  must(reads === 2, '읽기 ' + reads + '회 (2회여야 함)');
  must(p.lazy === false && !!p.dataUrl, '읽었는데 반영이 안 됐습니다');
  return '2번째에 성공';
});

chk('읽을 파일 자체가 없으면 재시도하지 않는다', async () => {
  const A = harness();
  const p = { id: 'p1', lazy: true };   // fileHandle 도 _workDir 도 없다
  await A.loadLazyPhoto(p);
  must((p._failRounds || 0) === 0, '없는 파일을 붙잡고 재시도했습니다');
  return '바로 포기';
});

chk('동시에 읽는 장수에 뚜껑이 있다', async () => {
  const A = harness();
  must(A.LAZY_MAX >= 2 && A.LAZY_MAX <= 8, 'LAZY_MAX 가 ' + A.LAZY_MAX + ' 입니다 — 2~8 사이여야 합니다');
  let now = 0, peak = 0;
  const mk = (i) => ({ id: 'p' + i, lazy: true, fileHandle: { getFile: async () => {
    now++; peak = Math.max(peak, now);
    await new Promise(r => setTimeout(r, 25));
    now--; return {};
  } } });
  const list = Array.from({ length: 20 }, (_, i) => mk(i));
  await Promise.all(list.map(p => A.loadLazyPhoto(p)));
  must(peak <= A.LAZY_MAX, '동시에 ' + peak + '장까지 읽었습니다 (최대 ' + A.LAZY_MAX + ')');
  must(list.every(p => !p.lazy), '다 읽히지 않은 사진이 있습니다 — 자리 넘김이 막혔습니다');
  return '최고 동시 ' + peak + '장 · 20장 모두 완료';
});

chk('같은 사진을 두 번 걸어도 한 번만 읽는다', async () => {
  const A = harness();
  let reads = 0;
  const p = { id: 'p1', lazy: true, fileHandle: { getFile: async () => { reads++; await new Promise(r => setTimeout(r, 30)); return {}; } } };
  await Promise.all([A.loadLazyPhoto(p), A.loadLazyPhoto(p)]);
  must(reads === 1, '읽기 ' + reads + '회 — 같은 사진을 겹쳐 읽었습니다');
  return '1회';
});

/* ── 2. 구조 ─────────────────────────────────────────────────────── */
say('\n🗂  폴더 목록 읽기\n');

chk('native-fs 목록 읽기가 한 번 실패해도 다시 해 본다', () => {
  const at = NFS.indexOf('async *entries()');
  must(at > 0, 'entries() 를 못 찾았습니다');
  const body = NFS.slice(at, at + 1400);
  /* ☠️ 반복문이 '있는가' 만 보면 횟수를 1 로 줄여도 통과한다 — 숫자를 꺼내서 본다. */
  const m = body.match(/for\s*\(\s*let\s+_t\s*=\s*0\s*;\s*_t\s*<\s*(\d+)\s*;/);
  must(m, '재시도 반복문이 없습니다');
  must(+m[1] >= 2, '재시도 횟수가 ' + m[1] + '회입니다 — 2회 이상이어야 다시 해 보는 뜻이 있습니다');
  must(/setTimeout/.test(body), '재시도 사이에 쉬는 구간이 없습니다 — 바로 다시 하면 같은 이유로 또 떨어집니다');
  return m[1] + '회까지 재시도';
});

chk('그래도 실패하면 조용히 넘어가지 않고 경고를 남긴다', () => {
  const at = NFS.indexOf('async *entries()');
  const body = NFS.slice(at, at + 1400);
  must(/console\.warn/.test(body), '빈 목록을 돌려주면서 아무 말도 없습니다');
  return '경고 있음';
});

chk('있어야 할 사진을 한 장도 못 읽으면 폴더를 건드리지 않는다', () => {
  must(/totalExpected\s*>\s*0\s*&&\s*totalRestored\s*===\s*0/.test(DLG),
    '0장 판정 가드가 없습니다 — 다음 저장 때 폴더의 사진이 지워질 수 있습니다');
  const at = DLG.indexOf('totalExpected > 0 && totalRestored === 0');
  const after = DLG.slice(at, at + 400);
  must(/throw new Error/.test(after), '가드가 걸려도 던지지 않습니다 — catch 의 skipPhotoSync 가 안 붙습니다');
  /* 던진 것을 받는 catch 가 정말 skipPhotoSync 를 붙이는지까지 확인한다 */
  const guard = DLG.slice(at, at + 1600);
  must(/skipPhotoSync:\s*true/.test(guard), '받는 catch 에 skipPhotoSync 가 없습니다');
  return '가드 + skipPhotoSync';
});

chk('일부만 읽힌 경우까지 막지는 않는다 (밖에서 지운 경우와 구분이 안 된다)', () => {
  must(!/totalRestored\s*<\s*totalExpected[\s\S]{0,120}throw/.test(DLG),
    '일부 손실에도 던지고 있습니다 — 정상적으로 사진을 지운 사용자가 저장을 못 하게 됩니다');
  return '부분 손실은 통과';
});

say('\n👆 못 읽은 칸 표시\n');

chk('못 읽은 칸에 표시가 붙는다', () => {
  must(/th-fail/.test(EV), 'events.js 가 th-fail 을 붙이지 않습니다');
  must(/\.th-wrap\.th-fail/.test(CSS), 'styles.css 에 th-fail 모양이 없습니다');
  return 'th-fail';
});

chk('그 칸을 누르면 크게 보기 대신 다시 읽는다', () => {
  const at = EV.indexOf("t.tagName==='IMG' && t.closest('.th-wrap')");
  must(at > 0, '썸네일 클릭 처리를 못 찾았습니다');
  const openAt = EV.indexOf('_pvOpenFromThumb(t)', at);
  const retryAt = EV.indexOf('retryLazyPhoto', at);
  must(retryAt > 0 && retryAt < openAt,
    '다시 읽기가 크게 보기보다 뒤에 있습니다 — 빈 화면만 열립니다');
  /* ☠️ 글자 순서만 보면 if (false) 로 꺼 두어도 통과한다 — 판정식 자체를 본다. */
  const blk = EV.slice(at, openAt);
  must(/if\s*\(\s*window\.retryLazyPhoto\(\s*_ph\s*\)\s*\)/.test(blk),
    '다시 읽기 결과로 갈라지지 않습니다 — 판정식이 꺼져 있습니다');
  must(/_ph\.lazy/.test(blk), '아직 못 읽은 사진인지 보지 않고 있습니다');
  must(/return;/.test(blk), '다시 읽고 나서도 크게 보기로 흘러갑니다');
  return '재시도 우선';
});

runAll().then(function () {
  console.log('');
  if (fails.length) {
    console.log('❌ ' + fails.length + '개 실패: ' + fails.join(', ') + '\n');
    process.exit(1);
  }
  console.log('✅ ' + pass + '개 모두 통과\n');
});
