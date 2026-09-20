/* ═══════════════════════════════════════════════════════════════════
   tools/test-manual-edit.js — 편집 화면이 글 파일을 **안 망가뜨리는지**
   ----------------------------------------------------------------
   ⭐ 왜 이 시험이 있나
      tools/manual_edit.js 는 브라우저에서 고친 내용으로 www/js/manual_data.js 를
      **통째로 다시 쓴다.** 즉 한 글자만 잘못 적어도 설명서 전체가 날아간다.
      그래서 "다시 적은 것을 다시 읽으면 원래와 같은가" 를 여기서 못 박는다.

      특히 위험한 것 세 가지 —
        ① 따옴표(')가 든 글을 적을 때
        ② 역슬래시(\\)가 든 글을 적을 때 (늘리는 순서를 틀리기 쉽다)
        ③ 긴 글을 여러 줄로 나눠 적을 때 (띄어쓰기가 사라지기 쉽다)
      셋 다 아래에서 실제 글자를 넣어 확인한다.

   ⚠️ 이 시험은 파일을 **읽기만** 한다. 절대 쓰지 않는다.
═══════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('./manual_edit.js');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'www', 'js', 'manual_data.js');

let pass = 0;
const fails = [];
function chk(name, fn) {
  try {
    const note = fn();
    pass++;
    console.log('  ✅ ' + name + (note ? ' — ' + note : ''));
  } catch (e) {
    fails.push(name + '\n      ' + ((e && e.message) || e));
    console.log('  ❌ ' + name + '\n      ' + ((e && e.message) || e));
  }
}
function must(c, m) { if (!c) throw new Error(m); }
function same(a, b, m) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(m + '\n      기대: ' + JSON.stringify(a) + '\n      실제: ' + JSON.stringify(b));
  }
}

/* 한 바퀴 돌린다 — 데이터 → 글자 → 데이터 */
function round(d) {
  return E.parse(E.emit(d));
}

const SRC = fs.readFileSync(DATA, 'utf8');
const REAL = E.parse(SRC);

console.log('\n── 글 파일 다시 쓰기 ──');

chk('진짜 설명서를 다시 적어도 내용이 똑같다', () => {
  /* ☠️ 이것 하나가 깨지면 편집 화면은 쓰면 안 된다 */
  const back = round(REAL);
  same(E.norm(REAL), E.norm(back), '다시 읽은 내용이 원본과 다릅니다');
  let n = 0;
  REAL.parts.forEach((p) => p.secs.forEach((s) => (n += s.steps.length)));
  return REAL.parts.length + '부 · ' + n + '단계';
});

chk('맨 위 주석(고친 내력)은 손대지 않는다', () => {
  const { head, body } = E.splitHead(SRC);
  must(head.indexOf('manual_data.js — 사용 설명서') > 0, '머리 주석을 못 찾았습니다');
  must(head.trim().endsWith('*/'), '머리 주석이 중간에서 잘렸습니다');
  must(body.startsWith('(function'), '본문이 (function 에서 시작하지 않습니다');
  /* 다시 적을 때 head 를 그대로 붙이는지 — 본문만 바뀌어야 한다 */
  must(E.emit(REAL).startsWith('(function'), '다시 적은 본문 모양이 다릅니다');
  return head.split('\n').length + '줄 보존';
});

chk('다시 적은 파일이 문법 오류 없이 읽힌다', () => {
  const { head } = E.splitHead(SRC);
  E.parse(head + E.emit(REAL));   /* 던지면 실패 */
  return '읽힘';
});

console.log('\n── 위험한 글자 ──');

const TRICKY = [
  ["작은따옴표", "이건 'A' 라고 적습니다"],
  ["역슬래시", 'C:\\aircon-report\\www 폴더'],
  ["역슬래시 + 따옴표", "경로 C:\\a 에서 'x' 를 찾습니다"],
  ["줄바꿈", '첫 줄\n둘째 줄'],
  ["따옴표로 끝남", "끝이 따옴표입니다'"],
  ["별표(굵게 표시)", '여기는 **굵게** 입니다'],
  ["아주 긴 글", '가나다라마바사 '.repeat(40).trim()]
];

TRICKY.forEach(([why, text]) => {
  chk('글에 ' + why + ' 이(가) 들어가도 그대로 돌아온다', () => {
    const d = { ver: '2', lead: text, parts: [{ p: '1부', secs: [{
      t: text, s: text, tip: text,
      steps: [{ h: text, d: text, img: [{ src: '', shape: 'tall', cap: text }] }]
    }] }] };
    const back = round(d);
    same(text, back.lead, 'lead 가 달라졌습니다');
    same(text, back.parts[0].secs[0].t, '큰제목이 달라졌습니다');
    same(text, back.parts[0].secs[0].steps[0].d, '설명이 달라졌습니다');
    same(text, back.parts[0].secs[0].steps[0].img[0].cap, '그림 설명이 달라졌습니다');
    return text.length + '자';
  });
});

chk('☠️ 긴 글을 여러 줄로 나눠도 띄어쓰기가 안 사라진다', () => {
  /* 나눠 적는 자리가 하필 띄어쓰기라서, 조각 끝에 공백을 안 붙이면
     "가나다라" 가 "가나다라"+"마바사" 로 붙어 버린다. 눈에 잘 안 띈다. */
  const text = '한 칸씩 띄어 쓴 아주 긴 문장을 넣어 봅니다 ' .repeat(6).trim();
  const lit = E.slit(text, 10);
  must(lit.indexOf('+\n') > 0, '긴 글인데 한 줄로 적었습니다 (시험이 무의미해집니다)');
  const back = round({ ver: '2', lead: text, parts: [] });
  same(text, back.lead, '이어 붙인 글이 원문과 다릅니다');
  return lit.split('+\n').length + '조각';
});

chk('짧은 글은 나누지 않는다 (읽기 좋게)', () => {
  const lit = E.slit('짧은 글', 10);
  must(lit === "'짧은 글'", '짧은 글인데 나눴습니다: ' + lit);
  return lit;
});

console.log('\n── 고친 뒤 ──');

chk('글을 고치면 그 자리만 바뀐다', () => {
  const d = E.parse(SRC);
  const before = JSON.stringify(E.norm(d));
  d.parts[0].secs[0].steps[0].h = '바꾼 제목';
  const back = round(d);
  same('바꾼 제목', back.parts[0].secs[0].steps[0].h, '고친 값이 안 들어갔습니다');
  /* 나머지는 그대로여야 한다 */
  const a = E.norm(E.parse(SRC)), b = E.norm(back);
  a.parts[0].secs[0].steps[0].h = '바꾼 제목';
  same(a, b, '고치지 않은 곳까지 바뀌었습니다');
  must(before !== JSON.stringify(b), '아무것도 안 바뀌었습니다');
  return '한 곳만';
});

chk('그림을 넣으면 src 가 저장된다', () => {
  const d = E.parse(SRC);
  const im = d.parts[0].secs[0].steps[0].img[0];
  must(im, '첫 단계에 그림 자리가 없습니다 (시험을 고쳐야 합니다)');
  im.src = 'm1-1-1.jpg';
  const back = round(d);
  same('m1-1-1.jpg', back.parts[0].secs[0].steps[0].img[0].src, 'src 가 안 남았습니다');
  return 'm1-1-1.jpg';
});

chk('그림을 빼면 src 가 빈 값이 된다', () => {
  const d = E.parse(SRC);
  d.parts[0].secs[0].steps[0].img[0].src = 'x.jpg';
  const one = round(d);
  one.parts[0].secs[0].steps[0].img[0].src = '';
  const two = round(one);
  same('', two.parts[0].secs[0].steps[0].img[0].src, '빈 값으로 안 돌아갑니다');
  return '빈 값';
});

chk('그림 파일 이름은 자리마다 다르다', () => {
  /* 같은 이름이 나오면 다른 자리 사진을 덮어쓴다 */
  const seen = new Set();
  for (let pi = 0; pi < 6; pi++) for (let si = 0; si < 6; si++)
    for (let ti = 0; ti < 8; ti++) for (let ii = 0; ii < 3; ii++) {
      const n = E.imgName({ pi, si, ti, ii }, 'jpg');
      must(!seen.has(n), '같은 이름이 두 번 나왔습니다: ' + n);
      seen.add(n);
    }
  return seen.size + '자리 모두 다름';
});

chk('같은 자리에 다시 넣으면 같은 이름이다 (찌꺼기가 안 쌓인다)', () => {
  same(E.imgName({ pi: 1, si: 2, ti: 3, ii: 0 }, 'jpg'),
       E.imgName({ pi: 1, si: 2, ti: 3, ii: 0 }, 'jpg'), '이름이 흔들립니다');
  return E.imgName({ pi: 1, si: 2, ti: 3, ii: 0 }, 'jpg');
});

/* 부·칸을 중간에 끼워 넣으면 뒤 칸들이 한 자리씩 밀린다.
   그때 새 자리가 밀려난 칸의 사진을 덮어쓰면 **남의 사진이 조용히 바뀐다.** */
function two(srcA, srcB) {
  return { ver: '2', lead: 'x', parts: [{ p: '1부', secs: [{
    t: 'ㄱ', steps: [
      { h: 'A', img: [{ src: srcA, shape: 'tall', cap: 'A' }] },
      { h: 'B', img: [{ src: srcB, shape: 'tall', cap: 'B' }] }
    ] }] }] };
}

chk('☠️ 다른 자리가 쓰는 파일 이름은 피한다', () => {
  /* 2단계(B)가 이미 m1-1-1.jpg 를 쓰고 있는데 1단계(A)에 새 사진을 넣는 상황 —
     자리에서 뽑은 이름이 딱 m1-1-1.jpg 라서 그냥 두면 B 의 사진이 바뀐다 */
  const d = two('', 'm1-1-1.jpg');
  const n = E.freeName(d, { pi: 0, si: 0, ti: 0, ii: 0 }, 'jpg');
  must(n !== 'm1-1-1.jpg', '남의 사진을 덮어쓰는 이름을 골랐습니다: ' + n);
  must(/^m1-1-1_\d+\.jpg$/.test(n), '이름 모양이 예상과 다릅니다: ' + n);
  return n;
});

chk('내 자리가 쓰던 이름은 그대로 덮어쓴다 (바꿔 끼우기)', () => {
  const d = two('m1-1-1.jpg', '');
  same('m1-1-1.jpg', E.freeName(d, { pi: 0, si: 0, ti: 0, ii: 0 }, 'jpg'),
       '바꿔 끼우는데 새 파일을 만들면 찌꺼기가 쌓입니다');
  return 'm1-1-1.jpg';
});

chk('빈 설명서에서는 자리 이름을 그대로 쓴다', () => {
  same('m1-1-1.jpg', E.freeName(two('', ''), { pi: 0, si: 0, ti: 0, ii: 0 }, 'jpg'),
       '괜히 번호를 붙였습니다');
  return 'm1-1-1.jpg';
});

console.log('\n── 편집 화면 ──');

const EJS = fs.readFileSync(path.join(__dirname, 'manual_edit.js'), 'utf8');

chk('쓰기 전에 다시 읽어 확인하고, 다르면 되돌린다', () => {
  /* ☠️ 2026-09-20 의 교훈이 코드에 실제로 남아 있는지 본다 */
  const at = EJS.indexOf('function save(');
  must(at > 0, 'save 를 못 찾았습니다');
  const b = EJS.slice(at, at + 1200);
  must(/const before = fs\.readFileSync/.test(b), '원본을 기억해 두지 않습니다');
  must(/parse\(fs\.readFileSync\(DATA/.test(b), '쓴 다음 다시 읽지 않습니다');
  must((b.match(/fs\.writeFileSync\(DATA, before/g) || []).length >= 2,
       '틀렸을 때 되돌리는 자리가 모자랍니다 (읽기 실패·내용 불일치 둘 다 필요)');
  return '되돌림 2곳';
});

chk('이름을 짓기 전에 지금 글 파일을 읽는다', () => {
  /* 자리 이름만 보고 지으면 위의 충돌을 영영 못 본다 — 실제 호출 자리를 확인한다 */
  const at = EJS.indexOf("p === '/api/img'");
  must(at > 0, '그림 올리는 자리를 못 찾았습니다');
  const b = EJS.slice(at, at + 700);
  must(/mutate\(\([\s\S]{0,20}\) => \{[\s\S]{0,200}freeName\(d, q, ext\)/.test(b),
       '글 파일을 안 보고 이름을 정합니다 — 남의 사진을 덮어쓸 수 있습니다');
  return 'freeName';
});

chk('지우기(rm)를 쓰지 않는다', () => {
  /* 연결된 폴더에서는 지우기가 막혀 있을 수 있다 — 막히면 저장이 통째로 실패한다 */
  must(!/unlinkSync|rmSync|rmdirSync/.test(EJS), '파일을 지우는 코드가 있습니다');
  return '없음';
});

chk('사진을 줄여서 넣는다 (앱 용량)', () => {
  must(/toDataURL\('image\/jpeg'/.test(EJS), '줄이는 코드가 없습니다');
  must(/300 \* 1024/.test(EJS), '300KB 기준이 없습니다');
  must(/MAX = 1400/.test(EJS), '긴 변 제한이 없습니다');
  return '1400px · 300KB';
});

chk('www 밖의 파일은 안 내준다', () => {
  const at = EJS.indexOf('function serveStatic(');
  must(at > 0, 'serveStatic 을 못 찾았습니다');
  must(/startsWith\(WWW \+ path\.sep\)/.test(EJS.slice(at, at + 400)),
       '폴더 밖으로 빠져나가는 것을 안 막습니다');
  return '막음';
});

chk('한 번에 하나씩만 저장한다', () => {
  /* 브라우저가 글자를 빨리 치면 저장이 겹친다 — 겹치면 앞 내용이 사라진다 */
  const at = EJS.indexOf('function mutate(');
  must(at > 0, 'mutate 를 못 찾았습니다');
  must(/busy\.then/.test(EJS.slice(at, at + 400)), '줄 세우지 않고 동시에 고칩니다');
  return '줄 세움';
});

chk('package.json 에 여는 명령이 있다', () => {
  const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  must(p.scripts && p.scripts['manual:edit'], 'manual:edit 명령이 없습니다');
  must(/manual_edit\.js/.test(p.scripts['manual:edit']), '엉뚱한 파일을 부릅니다');
  return p.scripts['manual:edit'];
});

console.log('');
if (fails.length) {
  console.log('❌ ' + fails.length + '개 실패\n');
  fails.forEach((f) => console.log('  · ' + f));
  process.exit(1);
}
console.log('✅ 전부 통과 (' + pass + '개)\n');
