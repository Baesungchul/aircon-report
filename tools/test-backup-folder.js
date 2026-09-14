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
  must(/boolean isDir/.test(jbody.slice(i, i + 200)),
       '폴더/파일 종류를 보지 않습니다 — 날짜로 시작하는 카메라 파일이 지워질 수 있습니다');
  must(/if \(!isDir\) return false/.test(blk), '파일을 우리 폴더로 오인할 수 있습니다');
  must(/isOursTopLevel\(nm, isDir\)/.test(jbody), '호출부가 종류를 넘기지 않습니다');

  /* 자바 구현을 그대로 JS 로 옮겨 실제 이름들로 확인한다 */
  const ours = (name, isDir) => {
    if (!name) return false;
    if (name === '.nomedia') return false;
    if (name.toLowerCase().endsWith('.json')) return true;
    if (!isDir) return false;
    if (name[0] === '_') return true;
    if (name.indexOf('m_') === 0) return true;
    if (name.length < 10) return false;
    for (let k = 0; k < 10; k++) {
      const ch = name[k], dash = (k === 4 || k === 7);
      if (dash ? (ch !== '-') : (ch < '0' || ch > '9')) return false;
    }
    return true;
  };
  /* 남의 파일 — 절대 지워선 안 된다 (전부 파일) */
  ['IMG_20260905_143012.jpg', '20260905_143012.jpg', 'Screenshot_20260905_143012.jpg',
   'PXL_20260905_143012.jpg', 'KakaoTalk_20260905.jpg', 'VID_20260905.mp4',
   '2026-09-05 14.30.12.jpg',        // ☠️ 날짜로 시작하는 카메라 파일 — 이름만 보면 우리 것처럼 보인다
   '2026-09-05_143012.jpg', '2026-09-05.png', '_DSC0001.jpg', 'm_20260905.mp4',
   ].forEach((n) => {
    must(ours(n, false) === false, '남의 파일을 우리 것으로 봅니다: ' + n);
  });
  /* 남의 폴더 — 이름이 우리 규칙과 안 겹친다 */
  ['Camera', 'Screenshots', '.thumbnails', 'my-photos', 'WhatsApp'].forEach((n) => {
    must(ours(n, true) === false, '남의 폴더를 우리 것으로 봅니다: ' + n);
  });
  /* 우리 것 — 정리는 계속 돼야 한다 */
  ['2026-09-05_143012', '2026-09-05', '_shared', 'm_1757000000000'].forEach((n) => {
    must(ours(n, true) === true, '우리 폴더를 못 알아봅니다: ' + n);
  });
  ['_appdata.json', 'work-index.json'].forEach((n) => {
    must(ours(n, false) === true, '우리 json 을 못 알아봅니다: ' + n);
  });
  must(ours('.nomedia', false) === false, '.nomedia 를 매 백업마다 지웁니다');
  return '날짜로 시작하는 카메라 파일까지 보호';
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
  const blk = jbody.slice(i, i + 1600);
  ['dcim', 'pictures', 'download', 'documents', 'movies', 'android'].forEach((t) => {
    must(blk.indexOf('"' + t + '"') > 0, t + ' 가 목록에 없습니다');
  });
  must(/r\.isEmpty\(\)/.test(blk), '저장소 루트를 막지 않습니다');
  must(/albums/.test(blk), '사진 앨범 1단계 하위(DCIM/Camera)를 구분하지 않습니다');

  /* 자바 구현을 그대로 옮겨 실제 경로로 확인한다 */
  const tops = ['dcim', 'pictures', 'movies', 'music', 'download', 'downloads',
                'documents', 'alarms', 'ringtones', 'notifications', 'podcasts',
                'android', 'recordings', 'audiobooks'];
  const albums = ['dcim', 'pictures', 'movies', 'music'];
  const OUR = 'work-report-backups';   /* 네이티브 OUR_BACKUP_DIR 과 같아야 한다 */
  const sys = (rel) => {
    if (rel == null) return false;
    let r = String(rel).trim().replace(/\/+$/, '');
    if (!r) return true;
    /* endsWithOurDir — 마지막 칸만, 대소문자 무시 */
    const last = r.indexOf('/') >= 0 ? r.slice(r.lastIndexOf('/') + 1) : r;
    if (last.toLowerCase() === OUR.toLowerCase()) return false;
    const low = r.toLowerCase();
    if (tops.indexOf(low) >= 0) return true;
    for (const t of albums) {
      if (low.startsWith(t + '/') && low.indexOf('/', t.length + 1) < 0) return true;
    }
    return false;
  };
  /* 막아야 하는 것 */
  ['', 'DCIM', 'DCIM/Camera', 'Pictures', 'Pictures/Screenshots', 'Documents',
   'Download', 'Android', 'Movies/Camera'].forEach((p) => {
    must(sys(p) === true, '막아야 하는데 통과합니다: ' + (p || '(저장소 루트)'));
  });
  /* 통과해야 하는 것 — 사용자가 직접 만든 폴더와 우리 전용 폴더 */
  ['Documents/work-report-backups', 'Documents/내백업', 'Download/backup', 'work-report-backups',
   'DCIM/Camera/work-report-backups', 'DCIM/Camera/Work-Report-Backups',   /* 대소문자가 달라도 우리 것 */
   'MyBackup', 'Documents/내백업/2026'].forEach((p) => {
    must(sys(p) === false, '통과해야 하는데 막힙니다: ' + p);
  });
  return 'DCIM/Camera 차단 · Documents/내백업 허용';
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
  return 'Documents 를 그대로 골라도 Documents/work-report-backups';
});

chk('전용 폴더 이름이 네이티브와 같고, ASCII 다', () => {
  const s = read('auto_backup.js');
  const m = s.match(/var OUR_DIR = '([^']+)'/);
  must(m, 'JS 에 OUR_DIR 이 없습니다');
  const jm = jbody.match(/String OUR_BACKUP_DIR = "([^"]+)"/);
  must(jm, '네이티브에 OUR_BACKUP_DIR 이 없습니다');
  must(m[1] === jm[1], '이름이 어긋납니다: JS ' + m[1] + ' / 네이티브 ' + jm[1]);
  /* ☠️ 한글·공백·특수문자 금지 — 자모 분리(NFD)나 이름 치환으로 비교가 어긋나면
        같은 폴더를 매번 새로 만들어 끝없이 겹쳐 들어간다 */
  must(/^[A-Za-z0-9._-]+$/.test(m[1]),
       '전용 폴더 이름에 ASCII 가 아닌 글자가 있습니다: ' + m[1]);
  must(m[1] === m[1].normalize('NFC') && m[1] === m[1].normalize('NFD'),
       '정규화 형태에 따라 달라지는 이름입니다: ' + m[1]);
  return m[1];
});

chk('전용 폴더 안에서 또 만들지 않는다 (무한 겹침 방지)', () => {
  const i = jbody.indexOf('public void ensureChildDir');
  const blk = jbody.slice(i, i + 1400);
  must(/endsWithOurDir\(parentRel\)/.test(blk), '이미 우리 폴더 안인지 확인하지 않습니다');
  must(/alreadyOurs/.test(blk), '그 자리를 그대로 쓴다는 표시가 없습니다');
  const g = blk.indexOf('endsWithOurDir(parentRel)'), cd = blk.indexOf('createDir(');
  must(g > 0 && cd > g, '겹침 방지 검사가 폴더 생성보다 뒤에 있습니다');
  must(/findChildDir\(/.test(blk), '대소문자 차이를 견디는 조회를 쓰지 않습니다');
  must(/equalsIgnoreCase/.test(jbody.slice(jbody.indexOf('private String findChildDir'),
                                           jbody.indexOf('private String findChildDir') + 1200)),
       'findChildDir 이 대소문자를 구분해 같은 폴더를 또 만듭니다');
  must(/equalsIgnoreCase\(OUR_BACKUP_DIR\)/.test(jbody), 'endsWithOurDir 이 대소문자를 구분합니다');
  return null;
});

chk('우리가 만든 전용 폴더를 우리가 다시 거부하지 않는다', () => {
  const i = jbody.indexOf('boolean isSystemMediaDir');
  const blk = jbody.slice(i, i + 1400);
  must(/endsWithOurDir\(r\)/.test(blk),
       '우리 전용 폴더가 다시 시스템 폴더로 판정됩니다 — 지정이 무한히 거부됩니다');
  must(blk.indexOf('return false') > 0, '예외가 통과로 이어지지 않습니다');
  return null;
});

chk('ensureChildDir 이 실제로 읽히는지 확인한 뒤 돌려준다', () => {
  const i = jbody.indexOf('public void ensureChildDir');
  must(i > 0, 'ensureChildDir 이 없습니다');
  const blk = jbody.slice(i, i + 3600);
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
  must(/hideBackupFromGallery\(true\)/.test(blk),
       '옮긴 폴더에 .nomedia 를 다시 넣지 않습니다 — 백업 사진이 갤러리에 보입니다');
  must(/백업 폴더 바꾸기/.test(blk), '직접 다시 지정할 수 있다는 안내가 없습니다');
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

chk('백업 폴더 자체를 지우라는 요청은 거부한다', () => {
  /* ☠️ '/' · '.' · '..' 이 들어오면 경로가 한 칸도 내려가지 않아 백업 폴더가 통째로 지워질 수 있었다 */
  const i = jbody.indexOf('public void deletePath');
  must(i > 0, 'deletePath 가 없습니다');
  const blk = jbody.slice(i, i + 2600);
  must(/int depth = 0/.test(blk) && /depth\+\+/.test(blk), '내려간 칸을 세지 않습니다');
  must(/if \(depth == 0\)/.test(blk), '한 칸도 못 내려갔을 때를 막지 않습니다');
  must(blk.indexOf('"refused"') > 0, '거부를 알려주지 않습니다');
  const rf = blk.indexOf('if (depth == 0)'), dd = blk.indexOf('boolean ok = deleteDoc');
  must(rf > 0 && dd > rf, '거부 검사가 삭제보다 뒤에 있습니다');
  must(/seg\.equals\("\."\)/.test(blk), "'.' 세그먼트를 건너뛰지 않습니다");
  return null;
});

chk('JS 쪽에서도 같은 경로를 걸러낸다', () => {
  const s = read('auto_backup.js');
  must(/function safeRelPath/.test(s), 'safeRelPath 가 없습니다');
  const i = s.indexOf('AutoBackup.removeFromBackup');
  const blk = s.slice(i, i + 500);
  must(/safeRelPath\(relPath\)/.test(blk), 'removeFromBackup 이 경로를 검사하지 않습니다');
  must(/if \(!relPath\) \{[^}]*return/.test(blk), '거부된 경로로 그대로 진행합니다');

  /* 구현을 그대로 옮겨 확인 */
  const safe = (relPath) => {
    let p = String(relPath == null ? '' : relPath).replace(/\\/g, '/').trim();
    if (!p) return '';
    const segs = p.split('/').filter((x) => x && x !== '.' && x !== '..');
    if (!segs.length) return '';
    if (p.indexOf('..') >= 0) return '';
    return segs.join('/');
  };
  ['', '/', '//', '.', '..', './', '../', '../..', ' ', null, undefined].forEach((p) => {
    must(safe(p) === '', '백업 폴더 자체를 가리키는 값을 통과시킵니다: ' + JSON.stringify(p));
  });
  must(safe('2026-09-05_120000') === '2026-09-05_120000', '정상 경로를 막습니다');
  must(safe('2026-09-05/work1') === '2026-09-05/work1', '정상 하위 경로를 막습니다');
  must(safe('a/../../b') === '', '위로 올라가는 경로를 통과시킵니다');
  return '빈값·루트·상위이동 모두 거부';
});

chk('보호한 항목 수를 결과로 알려준다', () => {
  must(/ret\.put\("kept"/.test(jbody), '보호한 항목 수를 안 돌려줍니다 — 사고를 알아챌 수 없습니다');
  must(/new int\[\]\{0, 0, 0, 0, 0\}/.test(jbody), 'counts 배열이 kept 를 담지 못합니다');
  return null;
});

console.log('\n' + (fails ? '❌ ' + fails + '건 실패' : '✅ 전부 통과') + ' (' + oks + '건)');
process.exit(fails ? 1 : 0);
