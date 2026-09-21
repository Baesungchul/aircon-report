/* ═══════════════════════════════════════════════════════════════════
   tools/test-photo-trash.js — 지운 사진이 **되살릴 수 있게** 남는지
   ----------------------------------------------------------------
   ☠️ 2026-09-21 사용자 신고: "작업에서 사진을 삭제했는데 복구할 수 없다"

   무엇이 문제였나 —
     사진 파일 이름은 **화면에서의 자리**로 정해진다(A_image02.jpg = 작업 전 2번).
     ① 2번을 지우면 화면 휴지통(u._trash)에는 들어가지만 **메모리에만** 있었다.
        작업을 닫으면 그 목록이 사라져, 폴더에 파일이 남아 있어도 아무도 몰랐다.
     ② 그 자리에 새 사진을 넣으면 같은 이름을 써서 **지운 사진 파일을 덮어썼다.**
        거기서부터는 정말로 복구가 안 된다.

   고친 방법 — 지우는 즉시 **T_<사진번호>.jpg** 로 따로 복사한다.
     자리 번호를 안 쓰는 이름이라 무엇에도 안 덮인다.
     목록은 _session.json 의 trashMeta 로 남아 작업을 닫았다 열어도 살아 있다.
     **사용자가 휴지통을 비울 때만** 파일이 지워진다.

   ⚠️ 이 시험은 소스를 읽어 '그렇게 하도록 짜여 있는지'를 본다.
      진짜 파일 동작은 폰에서 확인할 것.
═══════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), path = require('path');
const JS = path.join(__dirname, '..', 'www', 'js');
const read = (f) => fs.readFileSync(path.join(JS, f), 'utf8');

let pass = 0; const fails = [];
function chk(n, fn) {
  try { const r = fn(); pass++; console.log('  ✅ ' + n + (r ? ' — ' + r : '')); }
  catch (e) { fails.push(n + '\n      ' + (e.message || e)); console.log('  ❌ ' + n + '\n      ' + (e.message || e)); }
}
function must(c, m) { if (!c) throw new Error(m); }
function near(s, anchor, span) {
  const at = s.indexOf(anchor);
  must(at > 0, '기준점을 못 찾았습니다: ' + anchor.slice(0, 40));
  return s.slice(at, at + (span || 1200));
}

const F = read('folder.js'), E = read('events.js'), D = read('dialogs.js');

console.log('\n── 지운 사진을 어디에 두는가 ──');

chk('☠️ 휴지통 파일 이름은 화면 자리와 무관하다', () => {
  /* 자리(01·02…)로 이름을 지으면 다음 사진이 같은 이름으로 덮어쓴다 — 그게 원래 버그다 */
  const b = near(F, 'function trashFileName(', 400);
  must(/TRASH_PREFIX/.test(b), '고정 앞글자를 안 씁니다');
  must(/photo && photo\.id/.test(b), '사진 고유번호를 안 씁니다');
  must(!/idx|padStart/.test(b), '자리 번호로 이름을 짓고 있습니다 — 덮어쓰기가 다시 납니다');
  return 'T_<사진번호>.jpg';
});

chk('원본 파일을 그대로 복사한다 (썸네일이 아니라)', () => {
  const b = near(F, 'async function keepTrashPhoto(', 1600);
  must(b.indexOf('photo.fileName') < b.indexOf('photo.dataUrl'),
       '화면 자료를 먼저 씁니다 — 작은 썸네일이 원본을 대신할 수 있습니다');
  must(/getFileHandle\(photo\.fileName/.test(b), '폴더의 원본을 안 읽습니다');
  return '원본 우선';
});

chk('이미 보관돼 있으면 다시 안 쓴다', () => {
  const b = near(F, 'async function keepTrashPhoto(', 1600);
  must(/create: false \}\); return true;/.test(b), '있는지 안 보고 덮어씁니다');
  return '건너뜀';
});

console.log('\n── 언제 보관하는가 ──');

chk('☠️ 지우는 그 순간 바로 보관한다', () => {
  /* 저장할 때까지 기다리면, 그 사이에 새 사진이 같은 이름을 가져간다 */
  const b = near(E, "u._trash.push(_removed);", 700);
  must(/keepTrashPhoto\(_removed, u\.name\)/.test(b), '지울 때 보관하지 않습니다');
  return '즉시';
});

chk('☠️ 저장할 때는 사진을 쓰기 전에 보관한다', () => {
  /* 순서가 뒤바뀌면 보관하기 전에 덮어써 버린다 */
  const at1 = D.indexOf('keepTrashPhoto(tp, u.name, dateFolderName)');
  const at2 = D.indexOf('// 1) 사진 저장');
  must(at1 > 0, '저장 경로에서 휴지통을 안 챙깁니다');
  must(at2 > 0, '사진 저장 루프를 못 찾았습니다');
  must(at1 < at2, '사진을 먼저 쓰고 나서 휴지통을 챙깁니다 — 순서가 거꾸로입니다');
  return '보관 → 저장';
});

console.log('\n── 작업을 닫았다 열어도 남는가 ──');

chk('☠️ 휴지통 목록을 _session.json 에 적는다', () => {
  const b = near(D, 'trashMeta: (u._trash || []).map', 500);
  must(/trashFileName\(tp\)/.test(b), 'T_ 이름을 안 적습니다 — 다시 열 때 파일을 못 찾습니다');
  must(/tp\._trashType/.test(b), '작업 전·후 구분을 안 적습니다 — 복원 자리를 모릅니다');
  return '적음';
});

chk('☠️ 불러올 때 휴지통을 되살린다', () => {
  const b = near(D, 'newUnit._trash = (u.trashMeta || [])', 400);
  must(/buildFromMeta\(m\)/.test(b), '사진 객체를 안 만듭니다');
  must(/_trashType = m\.t/.test(b), '작업 전·후 구분을 안 되살립니다');
  return '되살림';
});

console.log('\n── 언제 진짜로 지워지는가 ──');

chk('☠️ 비우기를 눌렀을 때만 파일이 지워진다', () => {
  const b = near(E, "const trashEmpty = t.closest('.trash-empty');", 1200);
  must(/confirm\(/.test(b), '확인을 안 묻습니다');
  must(/pruneTrashPhotos\(_uname, \[\]\)/.test(b), '비워도 파일이 안 지워집니다');
  return '확인 + 삭제';
});

chk('지우기 자체는 파일을 안 지운다', () => {
  /* ✕ 를 눌렀을 때 파일까지 지우면 복구가 불가능해진다 — 그게 원래 문제다 */
  const b = near(E, "u._trash.push(_removed);", 700);
  must(!/removeEntry|deleteFile|pruneTrashPhotos/.test(b), '지우는 자리에서 파일을 없애고 있습니다');
  return '안 지움';
});

chk('복원하면 그 사진의 보관본만 정리된다', () => {
  must(/_syncTrashFiles\(u\)/.test(E), '복원 뒤 정리를 안 합니다');
  const b = near(E, 'function _syncTrashFiles(', 400);
  must(/u\._trash \|\| \[\]/.test(b), '남길 목록을 휴지통에서 안 만듭니다');
  must(/pruneTrashPhotos\(u\.name, keep\)/.test(b), '남길 목록을 안 넘깁니다');
  return '남은 것만 유지';
});

chk('복원한 사진은 제자리에 다시 쓰이도록 표시한다', () => {
  const b = near(E, 'const p = u._trash.splice(ti, 1)[0];', 600);
  must(/savedToFolder = false/.test(b), '이미 저장됨으로 두면 새 자리에 파일이 안 생깁니다');
  return 'savedToFolder=false';
});

console.log('');
if (fails.length) { console.log('❌ ' + fails.length + '개 실패\n'); fails.forEach(f => console.log('  · ' + f)); process.exit(1); }
console.log('✅ 전부 통과 (' + pass + '개)\n');
