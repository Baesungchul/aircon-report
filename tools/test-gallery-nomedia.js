/* ═══════════════════════════════════════════════════════════
   tools/test-gallery-nomedia.js
   백업 폴더가 갤러리에서 숨겨지는 배선이 살아 있는지 검사한다
   ----------------------------------------------------------------
   왜 필요한가 (2026-09-07 사용자 신고:
     "자동백업기능과 갤러리저장을 같이쓰면 갤러리에 사진이 중복으로 보인다"):
       「갤러리 저장」은 Pictures/작업보고서 앨범에 **일부러** 넣는 것이라 보여야 맞다.
       백업 폴더는 '앱이 관리하는 사본'인데 미디어 스캐너가 폴더 용도를 안 가리고
       사진이면 다 색인해서, 같은 사진이 두 번 보였다.
       폴더 맨 위의 빈 .nomedia 하나로 그 아래를 색인에서 뺀다.
   ☠️ 실제로 갤러리에서 사라지는지는 **실기기에서만** 확인된다. 여기서는
      "배선이 끊기지 않았는지"만 본다 — 조용히 안 불리게 되는 게 가장 흔한 사고라서다.
═══════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path');
const JS = path.join(__dirname, '..', 'www', 'js');
const JAVA = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java',
                       'com', 'baesungchul', 'workreport', 'BackupFolderPlugin.java');

let fails = 0, oks = 0;
function chk(name, fn) {
  try { const r = fn(); console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; }
  catch (e) { console.log('  ❌ ' + name + ' — ' + e.message); fails++; }
}
const must = (c, m) => { if (!c) throw new Error(m); };
const read = f => fs.readFileSync(f, 'utf8');

console.log('\n[1] 네이티브 — .nomedia 를 만들고 이미 색인된 것을 정리하는가');

chk('BackupFolder 플러그인에 hideFromGallery 가 있다', () => {
  const j = read(JAVA);
  must(/@PluginMethod\s*\n\s*public void hideFromGallery/.test(j), 'hideFromGallery 메서드가 없다');
  must(/"\.nomedia"/.test(j), '.nomedia 이름이 사라졌다 — 이 이름이라야 안드로이드가 알아본다');
  return '있음';
});

chk('SAF 폴더와 절대경로 폴더를 둘 다 다룬다', () => {
  const j = read(JAVA);
  must(/getString\("uri"\)/.test(j), 'SAF uri 를 안 받는다');
  must(/getString\("path"\)/.test(j), '절대경로를 안 받는다');
  must(/pathFromTreeUri/.test(j), 'SAF uri 를 경로로 바꾸는 코드가 없다 — 재스캔 대상을 못 찾는다');
  return 'SAF · 경로 둘 다';
});

chk('이미 색인된 사진을 정리하고 다시 훑는다', () => {
  const j = read(JAVA);
  must(/purgeMediaStore/.test(j), '이미 등록된 미디어 줄을 지우는 코드가 없다');
  must(/MediaScannerConnection\.scanFile/.test(j),
       '재스캔 신호가 없다 — .nomedia 만 만들면 이미 뜬 사진은 그대로 남는다');
  return '정리 + 재스캔';
});

chk('SAF 로 만든 뒤 이름을 다시 확인한다 (제공자가 확장자를 덧붙이는 경우)', () => {
  const j = read(JAVA);
  const seg = j.slice(j.indexOf('public void hideFromGallery'), j.indexOf('pathFromTreeUri('));
  const n = (seg.match(/findChildByName\([^)]*"\.nomedia"\)/g) || []).length;
  must(n >= 2, 'createFile 뒤 확인이 없다 (findChildByName 이 ' + n + '번) — .nomedia.txt 로 만들어져도 모른다');
  return '확인함';
});

console.log('\n[2] 웹 — 백업 전에 실제로 불리는가');

chk('auto_backup 이 hideFromGallery 를 부른다', () => {
  const s = read(path.join(JS, 'auto_backup.js'));
  must(/bf\.hideFromGallery/.test(s), '네이티브 호출이 없다');
  must(/AutoBackup\.hideFromGallery/.test(s), '손으로 다시 시킬 입구가 없다');
  return '있음';
});

chk('폴더를 새로 고르면 그 폴더에도 넣는다', () => {
  const s = read(path.join(JS, 'auto_backup.js'));
  const pick = s.slice(s.indexOf('AutoBackup.pickFolder'), s.indexOf('AutoBackup.pickFolder') + 900);
  must(/hideBackupFromGallery\(true\)/.test(pick),
       '폴더를 바꿔도 새 폴더엔 .nomedia 가 안 들어간다 — 거기서 다시 중복이 생긴다');
  return '새 폴더에도 적용';
});

chk('백업을 복사하기 **전에** 부른다 (뒤에 부르면 그 회차는 이미 색인된다)', () => {
  const s = read(path.join(JS, 'auto_backup.js'));
  const hide = s.indexOf('await hideBackupFromGallery(false)');
  const copy = s.indexOf('bf.backupTree(');
  must(hide > 0, '백업 흐름 안에서 안 부른다');
  must(copy > 0, 'backupTree 호출을 못 찾음 — 검사 기준이 낡았다');
  must(hide < copy, '복사 뒤에 부른다 (' + hide + ' > ' + copy + ')');
  return '복사 전';
});

chk('옛 빌드(네이티브에 메서드 없음)에서 조용히 넘어간다', () => {
  const s = read(path.join(JS, 'auto_backup.js'));
  must(/if \(!bf \|\| !bf\.hideFromGallery\) return;/.test(s),
       '메서드 없는 빌드에서 예외가 난다 — 백업 자체가 멈출 수 있다');
  return '넘어감';
});

chk('숨김 실패가 백업을 멈추지 않는다', () => {
  const s = read(path.join(JS, 'auto_backup.js'));
  must(/try \{ await hideBackupFromGallery\(false\); \} catch \(e\) \{\}/.test(s),
       '백업 흐름에서 try 로 감싸지 않았다 — 숨김이 실패하면 백업이 통째로 멈춘다');
  return '감싸져 있음';
});

console.log('\n' + (fails ? '❌ 실패 ' + fails + '건 / ' : '✅ ') + '통과 ' + oks + '건');
process.exit(fails ? 1 : 0);
