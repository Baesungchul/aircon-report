/* ═══════════════════════════════════════════════════════════
   tools/test-backup-folder.js
   백업 폴더가 사용자의 기존 사진을 지울 수 없는가
   ----------------------------------------------------------------
   ☠️ 2026-09-13 실제 사고 (사용자 신고)
     "사용자가 백업폴더를 카메라로 저장해서 기존 사진이 다 사라졌어"

   세 가지가 겹쳐서 났다.
     ① pickBackupFolder 가 시작 폴더(EXTRA_INITIAL_URI)를 지정하지 않아, 시스템
        폴더 선택기가 '자기가 마지막에 보던 곳'에서 열렸다. 그게 DCIM/Camera 였던
        사용자는 「다음」 한 번으로 카메라 폴더를 백업 폴더로 지정했다.
     ② BackupFolderPlugin.mirror() 의 prune 이 **백업 폴더 맨 위에서 앱 폴더에 없는
        이름을 전부 삭제**했다 → 기존 카메라 사진이 DocumentsContract.deleteDocument
        로 삭제됐다. 되돌릴 수 없었다.
     ③ hideFromGallery 가 그 폴더 맨 위에 .nomedia 를 쓰고 MediaStore 줄까지 지워,
        남아 있던 것도 갤러리에서 사라졌다.

   ☠️ 사진 유실은 되돌릴 수 없다. 앱이 하는 일 중 제일 나쁜 실패라 검사로 못 박는다.
      아래 게이트를 느슨하게 고치지 말 것.
═══════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'www', 'js');
const JAVA = path.join(ROOT, 'android', 'app', 'src', 'main', 'java',
                       'com', 'baesungchul', 'workreport', 'BackupFolderPlugin.java');

let fails = 0, oks = 0;
function chk(name, fn) {
  try { const r = fn(); console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; }
  catch (e) { console.log('  ❌ ' + name + ' — ' + e.message); fails++; }
}
const must = (c, m) => { if (!c) throw new Error(m); };
const read = (f) => fs.readFileSync(path.join(JS, f), 'utf8');
const java = fs.readFileSync(JAVA, 'utf8');
/* 주석을 지운 본문 — 검사가 자기 설명 주석을 매칭하지 않게 */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const jbody = strip(java);

console.log('\n[1] 선택기가 카메라 폴더에서 열리지 않는가');

chk('pickBackupFolder 가 시작 폴더를 지정한다', () => {
  must(/EXTRA_INITIAL_URI/.test(jbody),
       '시작 폴더를 지정하지 않습니다 — 선택기가 마지막에 보던 곳(카메라 폴더 등)에서 열립니다');
  const i = jbody.indexOf('public void pickBackupFolder');
  must(i > 0, 'pickBackupFolder 가 없습니다');
  const blk = jbody.slice(i, i + 1600);
  must(blk.indexOf('EXTRA_INITIAL_URI') > 0, '시작 폴더 지정이 pickBackupFolder 안에 없습니다');
  must(/primary:Documents/.test(blk), '기본 시작 위치가 Documents 가 아닙니다');
  return 'Documents 에서 열림';
});

chk('이미 쓰던 백업 폴더가 있으면 그 자리에서 연다', () => {
  const i = jbody.indexOf('public void pickBackupFolder');
  const blk = jbody.slice(i, i + 1600);
  must(/currentUri/.test(blk), 'currentUri 를 받지 않습니다');
  const s = read('auto_backup.js');
  must(/pickBackupFolder\(\{\s*currentUri:/.test(s), 'JS 가 currentUri 를 넘기지 않습니다');
  return null;
});

console.log('\n[2] prune 이 남의 파일을 지울 수 없는가');

chk('맨 위 prune 에 이름 게이트가 있다', () => {
  must(/isOursTopLevel/.test(jbody), 'isOursTopLevel 게이트가 없습니다');
  const i = jbody.indexOf('for (Map.Entry<String, String[]> e : destMap.entrySet())');
  must(i > 0, 'prune 루프를 찾을 수 없습니다');
  const blk = jbody.slice(i, i + 600);
  must(/isRoot\s*&&\s*!isOursTopLevel/.test(blk),
       'prune 이 맨 위에서 아무 이름이나 지웁니다 — 카메라 사진이 지워집니다');
  must(blk.indexOf('continue') > 0, '게이트에 걸린 항목을 건너뛰지 않습니다');
  return null;
});

chk('mirror 가 루트와 하위를 구분한다', () => {
  must(/void mirror\([^)]*boolean isRoot\)/.test(jbody.replace(/\s+/g, ' ')),
       'mirror 에 isRoot 인자가 없습니다');
  must(/mirror\(resolver, treeUri, rootDocId, srcRoot, counts, true\)/.test(jbody),
       '최초 호출이 루트로 표시되지 않습니다');
  must(/mirror\(resolver, treeUri, childId, k, counts, false\)/.test(jbody),
       '하위 재귀가 루트로 잘못 표시됩니다 — 작업 폴더 안 정리가 멈춥니다');
  return null;
});

chk('isOursTopLevel 이 카메라 파일명을 우리 것으로 보지 않는다', () => {
  const i = jbody.indexOf('static boolean isOursTopLevel');
  must(i > 0, 'isOursTopLevel 이 없습니다');
  const blk = jbody.slice(i, i + 900);
  /* 자바 구현을 그대로 JS 로 옮겨 실제 이름들로 확인한다 */
  const ours = (name) => {
    if (!name) return false;
    if (name === '.nomedia') return false;
    if (name[0] === '_') return true;
    if (name.indexOf('m_') === 0) return true;
    if (name.toLowerCase().endsWith('.json')) return true;
    if (name.length < 10) return false;
    for (let k = 0; k < 10; k++) {
      const ch = name[k], dash = (k === 4 || k === 7);
      if (dash ? (ch !== '-') : (ch < '0' || ch > '9')) return false;
    }
    return true;
  };
  must(/'_'/.test(blk) && /m_/.test(blk) && /\.json/.test(blk),
       '구현이 바뀐 것 같습니다 — 이 검사의 모형도 같이 고쳐 주세요');
  /* 남의 것 — 절대 지워선 안 된다 */
  ['IMG_20260905_143012.jpg', '20260905_143012.jpg', 'Camera', 'Screenshots',
   'Screenshot_20260905_143012.jpg', 'PXL_20260905_143012.jpg', 'KakaoTalk_20260905.jpg',
   'VID_20260905.mp4', '.thumbnails', 'my-photos'].forEach((n) => {
    must(ours(n) === false, '남의 파일을 우리 것으로 봅니다: ' + n);
  });
  /* 우리 것 — 정리는 계속 돼야 한다 */
  ['2026-09-05_143012', '2026-09-05', '_shared', '_appdata.json', 'm_1757000000000',
   'work-index.json'].forEach((n) => {
    must(ours(n) === true, '우리 폴더를 못 알아봅니다: ' + n);
  });
  must(ours('.nomedia') === false, '.nomedia 를 매 백업마다 지웁니다');
  return '카메라·스크린샷·카톡 이름 모두 보호';
});

console.log('\n[3] .nomedia 로 갤러리를 통째로 숨기지 않는가');

chk('시스템 미디어 폴더에는 .nomedia 를 쓰지 않는다', () => {
  const i = jbody.indexOf('public void hideFromGallery');
  must(i > 0, 'hideFromGallery 가 없습니다');
  const blk = jbody.slice(i, i + 1800);
  must(/isSystemMediaDir\(relPathOfTree\(/.test(blk),
       '시스템 폴더 검사 없이 .nomedia 를 씁니다 — 사용자 갤러리가 통째로 빕니다');
  must(/safBlocked/.test(blk), '차단 상태를 구분하지 않습니다');
  return null;
});

chk('isSystemMediaDir 가 카메라·사진·저장소 루트를 막는다', () => {
  const i = jbody.indexOf('boolean isSystemMediaDir');
  must(i > 0, 'isSystemMediaDir 가 없습니다');
  const blk = jbody.slice(i, i + 1200);
  ['dcim', 'pictures', 'download', 'documents', 'movies', 'android'].forEach((t) => {
    must(blk.indexOf('"' + t + '"') > 0, t + ' 가 목록에 없습니다');
  });
  must(/r\.isEmpty\(\)/.test(blk), '저장소 루트를 막지 않습니다');
  must(/indexOf\('\/'\) < 0/.test(blk),
       '1단계 하위(DCIM/Camera)를 막지 않거나, 사용자 폴더까지 막습니다');
  return null;
});

console.log('\n[4] 지정 시점과 옛 지정을 구제하는가');

chk('위험한 폴더를 고르면 그 안에 전용 폴더를 만들어 쓴다', () => {
  const s = read('auto_backup.js');
  const i = s.indexOf('AutoBackup.pickFolder');
  const blk = s.slice(i, i + 2600);
  must(/r\.isSystemDir \|\| r\.foreignCount > 0/.test(blk),
       '시스템 폴더·남의 파일이 있는 폴더를 가리지 않습니다');
  must(/useChildDir\(r\.uri\)/.test(blk), '전용 폴더를 만들지 않고 고른 폴더를 그대로 씁니다');
  must(/setSaf\(_uri\)/.test(blk), '전용 폴더가 아니라 고른 폴더를 저장합니다');
  must(blk.indexOf('return false') > 0, '전용 폴더 준비 실패 시 그냥 진행합니다');
  return 'Documents 를 그대로 골라도 Documents/작업보고서백업';
});

chk('전용 폴더 이름이 네이티브와 같다', () => {
  const s = read('auto_backup.js');
  const m = s.match(/var OUR_DIR = '([^']+)'/);
  must(m, 'JS 에 OUR_DIR 이 없습니다');
  const jm = jbody.match(/String OUR_BACKUP_DIR = "([^"]+)"/);
  must(jm, '네이티브에 OUR_BACKUP_DIR 이 없습니다');
  must(m[1] === jm[1], '이름이 어긋납니다: JS ' + m[1] + ' / 네이티브 ' + jm[1]);
  return m[1];
});

chk('우리가 만든 전용 폴더를 우리가 다시 거부하지 않는다', () => {
  const i = jbody.indexOf('boolean isSystemMediaDir');
  const blk = jbody.slice(i, i + 1400);
  must(/OUR_BACKUP_DIR/.test(blk),
       'Documents/작업보고서백업 이 다시 시스템 폴더로 판정됩니다 — 지정이 무한히 거부됩니다');
  must(blk.indexOf('return false') > 0, '예외가 통과로 이어지지 않습니다');
  return null;
});

chk('ensureChildDir 이 실제로 읽히는지 확인한 뒤 돌려준다', () => {
  const i = jbody.indexOf('public void ensureChildDir');
  must(i > 0, 'ensureChildDir 이 없습니다');
  const blk = jbody.slice(i, i + 2400);
  must(/buildTreeDocumentUri/.test(blk), '자식 폴더의 트리 uri 를 만들지 않습니다');
  must(/usable/.test(blk) && /ret\.put\("ok", usable\)/.test(blk),
       '읽히는지 확인하지 않고 ok 를 돌려줍니다 — 백업이 조용히 안 됩니다');
  must(!/deleteDoc|removeEntry/.test(blk), '폴더를 만들면서 무언가를 지웁니다');
  return null;
});

chk('네이티브가 지정 즉시 폴더 정보를 돌려준다', () => {
  const i = jbody.indexOf('private void backupFolderPicked');
  must(i > 0, 'backupFolderPicked 가 없습니다');
  const blk = jbody.slice(i, i + 1600);
  ['isSystemDir', 'relPath', 'foreignCount'].forEach((k) => {
    must(blk.indexOf('"' + k + '"') > 0, k + ' 를 안 돌려줍니다');
  });
  return null;
});

chk('옛 빌드에서 잘못 지정된 폴더를 앱 켤 때 옮긴다 (기존 사용자 구제)', () => {
  const s = read('auto_backup.js');
  must(/AutoBackup\.auditFolder\s*=/.test(s), 'auditFolder 가 없습니다');
  const i = s.indexOf('AutoBackup.auditFolder =');
  const blk = s.slice(i, i + 2400);
  must(/inspectFolder\(\{ uri: saf \}\)/.test(blk), '저장된 폴더를 검사하지 않습니다');
  must(/useChildDir\(saf\)/.test(blk), '전용 폴더로 옮기지 않습니다 — 기존 사용자가 그대로 위험합니다');
  must(/setSaf\(sub\.uri\)/.test(blk), '옮긴 폴더를 저장하지 않습니다');
  must(/setSaf\(''\)/.test(blk), '못 옮겼을 때 지정을 해제하지 않습니다');
  must(!/removeEntry|deletePath/.test(blk),
       '구제 과정에서 파일을 지웁니다 — 이미 유실 사고가 난 경로라 절대 안 됩니다');
  must(/inspectFolder/.test(jbody), '네이티브 inspectFolder 가 없습니다');
  must(/한 번만 알린다|UNSAFE_LS/.test(blk), '앱을 켤 때마다 같은 알림이 뜹니다');
  return '전용 폴더로 이사 + 1회 안내';
});

chk('그 검사가 콜드스타트 백업보다 먼저 돈다', () => {
  const s = read('auto_backup.js');
  const i = s.indexOf("cold-start-resume");
  must(i > 0, '콜드스타트 백업을 찾을 수 없습니다');
  const blk = s.slice(Math.max(0, i - 900), i);
  must(/auditFolder/.test(blk),
       '백업이 먼저 돌면 위험한 폴더를 한 번 더 건드립니다');
  return null;
});

console.log('\n[5] 백업 폴더 밖은 손대지 않는가');

chk('mirror 는 선택된 트리 안에서만 삭제한다', () => {
  must(!/File\s*\(\s*"\/storage/.test(jbody), '절대경로로 파일을 지우는 코드가 있습니다');
  const i = jbody.indexOf('private boolean deleteDoc');
  const blk = jbody.slice(i, i + 400);
  must(/buildDocumentUriUsingTree/.test(blk),
       '삭제가 선택된 트리(treeUri) 기준이 아닙니다 — 권한 밖까지 닿을 수 있습니다');
  return null;
});

chk('보호한 항목 수를 결과로 알려준다', () => {
  must(/ret\.put\("kept"/.test(jbody), '보호한 항목 수를 안 돌려줍니다 — 사고를 알아챌 수 없습니다');
  must(/new int\[\]\{0, 0, 0, 0, 0\}/.test(jbody), 'counts 배열이 kept 를 담지 못합니다');
  return null;
});

console.log('\n' + (fails ? '❌ ' + fails + '건 실패' : '✅ 전부 통과') + ' (' + oks + '건)');
process.exit(fails ? 1 : 0);
