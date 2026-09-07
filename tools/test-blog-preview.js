/* ═══════════════════════════════════════════════════════════
   tools/test-blog-preview.js
   글 결과에서 사진 마커가 실제 사진으로 보이는지, 그리고 그 자리가
   PC 링크(site/post.html)와 **같은 자리**인지 검사한다
   ----------------------------------------------------------------
   왜 필요한가 (2026-09-07 사용자 요청):
     "찍고쓰다는 블로그 글에 사진이 글 사이사이에 들어가는데,
      현장매니저는 사진이 안 들어가고 마커만 들어간다"

   ☠️ 가장 위험한 것은 '두 곳이 갈라지는 것'이다.
      마커를 사진으로 바꾸는 코드가 이제 두 군데 있다 —
        · www/js/preview.js   (앱 안에서 보는 화면)
        · site/post.html      (PC 링크로 열리는 페이지)
      post.html 은 배포된 별도 페이지라 preview.js 를 못 읽는다. 한쪽만 고치면
      **앱에서 본 배치와 실제 블로그 결과가 달라진다** — 그런데 둘 다 오류 없이
      잘 도는 것처럼 보여서, 사장님이 블로그에 올린 뒤에야 알게 된다.
      그래서 여기서 두 파일의 규칙이 같은지 직접 맞춰 본다.

   ☠️ 두 번째로 위험한 것은 '마커가 글에서 사라지는 것'이다.
      복사되는 글에는 마커가 반드시 남아야 한다 — 모바일에서 손으로 사진을 끼울 때
      자리를 알려주는 유일한 표시다(사용자 결정 2026-09-01).
═══════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'www', 'js');

let fails = 0, oks = 0;
/* ⚠️ 검사가 사진을 읽는 비동기 함수라 await 로 받는다 — 안 그러면 실패해도 통과로 샌다 */
async function chk(name, fn) {
  try { const r = await fn(); console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; }
  catch (e) { console.log('  ❌ ' + name + ' — ' + e.message); fails++; }
}
const must = (c, m) => { if (!c) throw new Error(m); };

const prevSrc = fs.readFileSync(path.join(JS, 'preview.js'), 'utf8');
const aiSrc   = fs.readFileSync(path.join(JS, 'ai.js'), 'utf8');
const snsSrc  = fs.readFileSync(path.join(JS, 'sns_share.js'), 'utf8');
const html    = fs.readFileSync(path.join(ROOT, 'www', 'index.html'), 'utf8');
const postSrc = fs.readFileSync(path.join(ROOT, 'site', 'post.html'), 'utf8');
const css     = fs.readFileSync(path.join(ROOT, 'www', 'styles.css'), 'utf8');

/* preview.js 를 가짜 브라우저에 올린다. 사진은 dataUrl 로 바로 돌려주는
   가짜 Gallery 를 물려, 실제 파일 없이 배치만 본다. */
function load(unitsArr) {
  const ctx = {
    console: { log() {}, warn() {} },
    setTimeout, Promise, String, Number, Math, JSON, Object, Array, RegExp, parseInt,
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    units: unitsArr,
    Gallery: { resolvePhoto: (p) => Promise.resolve({ dataUrl: String(p) }) },
    document: { addEventListener() {} }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(prevSrc, ctx, { filename: 'preview.js' });
  must(ctx.Preview && typeof ctx.Preview.render === 'function', 'preview.js 가 Preview.render 를 안 내놓습니다');
  return ctx.Preview;
}

/* 전 2장 · 후 2장 · 특이 1장 */
const UNITS = [{
  name: '101호',
  before: ['B1', 'B2'],
  after: ['A1', 'A2'],
  specials: [{ photos: ['S1'] }]
}];
const P = load(UNITS);

(async function () {
const imgs = (h) => (h.match(/<img[^>]*src="([^"]*)"/g) || [])
  .map(s => s.match(/src="([^"]*)"/)[1]);

  console.log('\n[1] 마커가 실제 사진으로 바뀐다');

  await chk('마커 자리마다 사진이 하나씩 들어간다', () => {
  return P.render('제목\n\n(사진: 작업 전 1)\n\n앞 문장입니다.\n\n(사진: 작업 후 1)\n\n뒷 문장입니다.')
    .then(h => {
      const got = imgs(h);
      must(got.length >= 2, '사진이 ' + got.length + '장뿐입니다');
      must(got[0] === 'B1', '첫 마커에 작업 전 1(B1) 이 아니라 ' + got[0] + ' 이 들어갔습니다');
      must(got.indexOf('A1') >= 0, '작업 후 1(A1) 이 안 들어갔습니다');
      must(!/\(사진:/.test(h.replace(/<[^>]*>/g, '')), '화면에 마커 글자가 그대로 남았습니다');
      return got.join(',');
    });
});

  await chk('번호를 안 적으면 그 종류의 다음 한 장', () => {
  /* ⚠️ 마커에 안 걸린 사진이 문단 사이에 끼어들므로 '연달아' 나오지는 않는다.
       봐야 할 것은 **순서**다 — 첫 마커가 B1, 두 번째가 B2 여야 한다. */
  return P.render('가\n\n(사진: 작업 전)\n\n나\n\n(사진: 작업 전)\n\n다').then(h => {
    const got = imgs(h);
    must(got.indexOf('B1') >= 0 && got.indexOf('B2') >= 0, 'B1·B2 가 다 안 나왔습니다: ' + got.join(','));
    must(got.indexOf('B1') < got.indexOf('B2'), '작업 전 순서가 뒤집혔습니다: ' + got.join(','));
    return 'B1 → B2 (사이에 남은 사진 끼임)';
  });
});

  await chk('마커에 안 걸린 사진은 문단 사이에 흩어진다 (뒤에 몰지 않는다)', () => {
  return P.render('제목\n\n첫 문단\n\n둘째 문단\n\n셋째 문단\n\n넷째 문단').then(h => {
    const got = imgs(h);
    must(got.length === 5, '사진 5장이 다 안 나왔습니다 (' + got.length + '장)');
    const tail = h.slice(h.lastIndexOf('</p>'));
    must((tail.match(/<img/g) || []).length < 5, '사진이 전부 글 끝에 몰렸습니다');
    return got.length + '장 분산';
  });
});

  await chk('사진이 없는 작업이면 글만 보여준다 (터지지 않는다)', () => {
  const P0 = load([]);
  return P0.render('제목\n\n(사진: 작업 전 1)\n\n본문').then(h => {
    must(/pv-empty/.test(h), '사진 없음 안내가 없습니다');
    must(imgs(h).length === 0, '없는 사진이 나왔습니다');
    return '안내만';
  });
});

  console.log('\n[2] 앱 화면과 PC 링크가 같은 자리에 넣는가');

  await chk('마커 정규식이 두 파일에서 같다', () => {
  /* preview.js 는 문자열 두 조각을 이어 붙인 형태, post.html 은 정규식 리터럴이다.
     양쪽을 '실제 정규식 본문' 으로 되돌려 놓고 비교한다. */
  const a = prevSrc.match(/var MARK_SRC =([\s\S]*?);\n/);
  const b = postSrc.match(/var MARK = \/([\s\S]*?)\/gi;/);
  must(a && b, '마커 식을 못 찾았습니다 (검사 기준이 낡았습니다)');
  /* ☠️ 이어붙이기 '+' 만 걷어내야 한다 — 통째로 지우면 정규식의 수량자 '+' 까지 없어져서
       (\d+) 가 (\d) 로 보이고, 멀쩡한 코드가 '다르다'고 잡힌다(2026-09-07 실제로 겪음). */
  const fromJs = (a[1].match(/'((?:[^'\\]|\\.)*)'/g) || [])
    .map(x => x.slice(1, -1)).join('').replace(/\s+/g, '').replace(/\\\\/g, '\\');
  const fromRe = b[1].replace(/\s+/g, '');
  must(fromJs === fromRe,
       '앱과 PC 링크의 마커 식이 다릅니다 — 사진이 서로 다른 자리에 들어갑니다\n      앱  : ' + fromJs + '\n      PC  : ' + fromRe);
  return '일치';
});

  await chk('종류 판정(전/후/특이)이 두 파일에서 같다', () => {
  const pick = s => (s.match(/if \(\/[^\/]+\/\.test\(label\)\) return takeKindNth\('[a-z]+', nth\);/g) || []).join('|');
  const a = pick(prevSrc), b = pick(postSrc);
  must(a && b, '종류 판정 코드를 못 찾았습니다 (검사 기준이 낡았습니다)');
  must(a === b, '앱과 PC 링크의 종류 판정이 다릅니다\n      앱: ' + a + '\n      PC: ' + b);
  return '전/후/특이 일치';
});

  await chk('사진 순서(전 → 후 → 특이)가 공유와 같다', () => {
  const order = s => (s.match(/kind: '(before|after|special)'/g) || []).join(',');
  must(order(prevSrc) === order(snsSrc),
       '미리보기와 공유의 사진 순서가 다릅니다 — 화면에서 본 번호와 실제 첨부 순서가 어긋납니다');
  return order(prevSrc);
});

  console.log('\n[3] 복사되는 글에는 마커가 남아야 한다');

  await chk('미리보기는 textarea 를 건드리지 않는다', () => {
  /* 미리보기 코드 구간만 본다 — '서식 없이 복사'가 textarea 를 다시 쓰는 건 예전부터 있던
     기능이고 마커를 지우지 않는다(stripMarkdown 은 서식 기호만 건드린다). */
  const from = aiSrc.indexOf('var _pvBtn = ov.querySelector');
  const to = aiSrc.indexOf('if (_pvOn) showPreview(true)');
  must(from > 0 && to > from, '미리보기 코드 구간을 못 찾았습니다 (검사 기준이 낡았습니다)');
  const blk = aiSrc.slice(from, to);
  must(!/\.value\s*=[^=]/.test(blk),
       '미리보기가 원본 글을 덮어씁니다 — 마커가 사라져 모바일에서 사진 자리를 못 찾습니다');
  must(/Preview\.render\(src\)/.test(blk), '미리보기가 현재 글을 읽어 그리지 않습니다');
  return '보기 전용';
});

  await chk('창을 닫을 때 blob URL 을 놓아 준다', () => {
  must(/Preview\.release/.test(aiSrc), '창을 닫아도 사진 URL 을 안 놓습니다 — 열 때마다 메모리가 쌓입니다');
  must(/P\.release = function/.test(prevSrc), 'preview.js 에 release 가 없습니다');
  return '해제함';
});

  console.log('\n[4] 배선 — 조용히 끊기면 안 되는 것들');

  await chk('index.html 이 ai.js 보다 먼저 preview.js 를 부른다', () => {
  const p = html.indexOf('js/preview.js'), a = html.indexOf('js/ai.js');
  must(p > 0, 'index.html 에서 preview.js 가 빠졌습니다 — 버튼이 영영 안 뜹니다');
  must(p < a, 'preview.js 가 ai.js 보다 뒤에 있습니다');
  return '순서 정상';
});

  await chk('마커가 있을 때만 버튼을 띄운다', () => {
  must(/Preview\.hasMarker\(text\) && hasPhotosInWork\(\)/.test(aiSrc),
       '마커·사진 유무를 안 보고 버튼을 띄웁니다 (견적서에도 뜹니다)');
  return '조건 확인';
});

  await chk('사진이 들어간 화면을 먼저 보여준다', () => {
  must(/if \(_pvOn\) showPreview\(true\)/.test(aiSrc),
       '기본이 편집 화면입니다 — 사장님이 요청한 건 사진이 보이는 화면입니다');
  return '사진 먼저';
});

  await chk('미리보기 스타일이 있다', () => {
  must(/\.post-pv\{/.test(css), '.post-pv 스타일이 없습니다');
  must(/\.post-pv img\{/.test(css), '사진 크기 규칙이 없어 원본 크기로 튀어나옵니다');
  return '있음';
});

  console.log('\n[5] 모바일 올리기 안내 — 사진과 글이 따로 들어간다는 설명');

  await chk('사진과 글이 따로 들어간다고 먼저 말한다', () => {
  must(/사진과 글은 <b>따로 들어갑니다<\/b>/.test(snsSrc),
       '안내 첫 줄에 "따로 들어간다"는 설명이 없습니다 (2026-09-07 사용자 요청)');
  return '있음';
});

  await chk('각 채널 단계에서도 "사진만" 열린다고 알려 준다', () => {
  ['naver', 'insta', 'facebook'].forEach(k => {
    const at = snsSrc.indexOf(k + ':');
    const blk = snsSrc.slice(at, at + 900);
    must(/<b>사진만<\/b>/.test(blk), k + ' 단계에 "사진만 들어간 화면" 설명이 없습니다');
  });
  must(/사진과 글은 따로 들어갑니다/.test(snsSrc), '당근 단계에 따로 들어간다는 설명이 없습니다');
  return '4개 채널';
});

  await chk('네이버는 한 번에 넣는 길(PC 링크)도 알려 준다', () => {
  must(/PC 블로그에 올리기<\/b>를 쓰세요/.test(snsSrc),
       '따로 넣기가 번거로운 사람에게 PC 링크를 안내하지 않습니다');
  return '안내함';
});

  console.log('\n' + (fails ? '❌ 실패 ' + fails + '건 / ' : '✅ ') + '통과 ' + oks + '건');
  process.exit(fails ? 1 : 0);
})();
