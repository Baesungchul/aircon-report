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
  /* ⚠️ 네이버는 빠졌다 — 갤러리 방식이라 '사진만 들어간 화면' 자체가 없다.
       (예전엔 목록에 있었는데, 900자 창이 우연히 인스타 단계까지 닿아서 통과하고 있었다.
        2026-09-08 네이버 단계가 길어지면서 들통났다 — 기준을 바로잡는다.) */
  ['insta', 'facebook'].forEach(k => {
    const at = snsSrc.indexOf(k + ':');
    const blk = snsSrc.slice(at, at + 900);
    must(/<b>사진만<\/b>/.test(blk), k + ' 단계에 "사진만 들어간 화면" 설명이 없습니다');
  });
  /* 네이버는 '사진은 갤러리로, 글은 공유로' 라는 두 갈래를 단계가 보여 줘야 한다 */
  const nvAt = snsSrc.indexOf('naver:  {');
  const nvBlk = snsSrc.slice(nvAt, nvAt + 1600);
  must(/갤러리에 저장<\/b>/.test(nvBlk) && /글 복사 \+ 공유<\/b>/.test(nvBlk),
       '네이버 단계에 사진(갤러리) · 글(공유) 두 갈래가 안 보입니다');
  must(/사진과 글은 따로 들어갑니다/.test(snsSrc), '당근 단계에 따로 들어간다는 설명이 없습니다');
  return '인스타·페이스북 + 네이버(갤러리) + 당근';
});

  await chk('네이버는 한 번에 넣는 길(PC 링크)도 알려 준다', () => {
  must(/PC 블로그에 올리기<\/b> 가 더 빠릅니다/.test(snsSrc),
       'PC 에서 할 때 더 빠른 길(PC 링크)을 안내하지 않습니다');
  return '안내함';
});

  /* ═══════════════════════════════════════════════════════════
     [6] 2026-09-08 — 발행 24시간 뒤 블로그 글의 사진이 전부
         "존재하지 않는 이미지입니다" 로 바뀐 사고에서 나온 검사들.

     ☠️ 사고의 뿌리는 코드가 아니라 **문구가 한 약속**이었다.
        "붙여넣으면 사진은 네이버가 자동으로 받아 옮깁니다" 라고 적어 둬서,
        사장님은 붙여넣기만 하고 발행했다. 네이버는 안 가져갔고, 24시간 뒤
        우리가 원본을 지우자 발행된 글이 통째로 깨졌다.
        → 남의 서버가 사진을 가져가 줄 거라는 약속을 **다시 쓰지 못하게** 막는다.
     ═══════════════════════════════════════════════════════════ */
  console.log('\n[6] 사진은 직접 넣어야 한다고 말하는가 (2026-09-08 사고 재발 방지)');

  await chk('"네이버가 자동으로 옮겨 준다"는 약속이 없다', () => {
    [['post.html', postSrc], ['sns_share.js', snsSrc]].forEach(([n, src]) => {
      const body = src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      must(!/사진은 네이버가 자동으로/.test(body), n + ' 이 아직 "네이버가 자동으로 옮긴다"고 약속합니다');
      must(!/사진까지 한 번에 들어갑니다/.test(body), n + ' 이 아직 "한 번에 들어간다"고 약속합니다');
      must(!/사진은 네이버 쪽에 남으니/.test(body), n + ' 이 아직 "지워져도 괜찮다"고 말합니다');
    });
    return '두 곳 다 지워짐';
  });

  await chk('붙여넣은 사진을 "교체"하라고 단계로 알려 준다', () => {
    /* 사용자가 정한 방법(2026-09-08): 붙여넣기가 사진 자리를 잡아 주므로,
       그 뒤 사진을 하나씩 눌러 [교체] 로 내 사진으로 바꾸면 위치를 다시 잡을 일이 없다. */
    must(/사진만 내 것으로 교체/.test(postSrc), 'PC 링크 페이지가 교체를 앞에서 말하지 않습니다');
    must(/<b>교체<\/b>를 눌러/.test(postSrc), '교체 단계가 번호 목록에 없습니다');
    must(/사진을 클릭<\/b>한 뒤 <b>화면 맨 위 도구모음의 \[교체\]/.test(snsSrc), '앱 안내에 교체 단계가 없습니다');
    must(/모든 사진을 교체한 뒤<\/b> 발행/.test(postSrc), '"다 바꾼 뒤 발행" 이 빠졌습니다');
    /* ☠️ 2026-09-08 사용자 확인 — [교체]는 사진 위 도구막대가 아니라 **상단 도구모음**에 있다.
         자리를 잘못 알려 주면 찾다가 그냥 발행하고, 하루 뒤 사진이 깨진다. */
    must(/화면 맨 위 도구모음/.test(postSrc), 'PC 링크가 교체 버튼 자리를 안 알려 줍니다');
    [['post.html', postSrc], ['sns_share.js', snsSrc]].forEach(([nm, src]) => {
      must(!/사진 위에 도구막대/.test(src), nm + ' 이 교체 버튼 자리를 사진 위라고 잘못 알려 줍니다');
    });
    return '두 곳 다 있음 · 자리는 상단 도구모음';
  });

  await chk('교체하지 않으면 어떻게 되는지 두 가지를 다 말한다', () => {
    [['post.html', postSrc], ['sns_share.js', snsSrc]].forEach(([n, src]) => {
      must(/존재하지 않는 이미지입니다/.test(src), n + ' 이 "사진이 깨진다"를 안 말합니다');
      must(/저품질의 원인/.test(src), n + ' 이 "저품질의 원인" 을 안 말합니다 (사용자 요청 2026-09-08)');
    });
    return '깨짐 + 저품질';
  });

  await chk('사진을 낱장으로 받을 수 있다 (ZIP 만 있으면 또 풀어야 한다)', () => {
    must(/function saveOne\(url, name\)/.test(postSrc), '한 장 저장 기능이 없습니다');
    must(/function saveAllOneByOne\(\)/.test(postSrc), '전부 낱장으로 받기가 없습니다');
    must(/id="saveAll">⬇ 사진 내려받기 \(/.test(postSrc), '사진 내려받기 버튼이 없습니다');
    /* 버튼은 단계 순서와 같아야 한다 — ① 사진 내려받기 ② 글+사진 전체 복사 */
    must(postSrc.indexOf('id="saveAll"') < postSrc.indexOf('id="copyAll"'),
         '사진 내려받기가 전체 복사보다 아래 있습니다 — 1번 단계가 위에 있어야 합니다');
    must(postSrc.indexOf('id="saveAll"') < postSrc.indexOf('id="zipAll"'),
         '낱장 받기가 ZIP 보다 아래 있습니다');
    must(!/사진 깨질 수 있음/.test(postSrc),
         '전체 복사에 아직 경고 딱지가 붙어 있습니다 — 교체 단계가 생겨 정상 경로가 됐습니다');
    return '낱장 + ZIP';
  });

  await chk('사진 목록이 복사 영역(#post) 밖에 있다', () => {
    const cardAt = postSrc.indexOf('id="photoCard"');
    const postAt = postSrc.indexOf('<div id="post">');
    must(cardAt > 0 && postAt > 0, '사진 카드나 본문 영역을 못 찾았습니다');
    must(cardAt < postAt, '사진 목록이 #post 안에 있습니다 — 전체 복사에 버튼 글자가 섞입니다');
    return '밖에 있음';
  });

  await chk('모바일 네이버는 사진을 공유로 안 보내고 갤러리에 저장한다', () => {
    /* 2026-09-08 사용자 결정 — 공유로 넘기면 사진이 글쓰기 화면 맨 위에 다 몰려,
       결국 하나씩 끌어 내려야 했다. 갤러리에 저장해 두고 마커 자리에서 꺼내 넣는다. */
    const m = snsSrc.match(/naver:\s*\{([^}]*)\}/);
    must(m, 'naver 채널 설정을 못 찾았습니다 (검사 기준이 낡았습니다)');
    must(/gallery: true/.test(m[1]), '네이버가 아직 공유 시트로 사진을 보냅니다');
    must(/async function saveGallery\(\)/.test(snsSrc), '갤러리 저장 동작이 따로 없습니다');
    must(/async function shareTextOnly\(chId, text\)/.test(snsSrc), '글만 공유하는 동작이 없습니다');
    must(!/_Share\(\)\.share\(\{ files: uris[\s\S]{0,400}exportCurrentWorkPhotosToGallery/.test(snsSrc),
         '네이버가 아직 사진을 공유 시트로 보냅니다');
    return '갤러리 저장 + 글만 공유';
  });

  await chk('갤러리 방식에서는 사진 고르는 칸을 안 띄운다', () => {
    /* 갤러리 저장은 이 작업 사진을 전부 내보낸다 — 고르게 해 놓고 다 저장하면 화면이 거짓말이 된다 */
    must(/\(ch\.gallery \? '' :/.test(snsSrc), '갤러리 방식에도 종류 체크박스가 뜹니다');
    must(/갤러리에 저장할 사진 ' \+ all\.length/.test(snsSrc), '저장할 장수를 안 알려 줍니다');
    return '체크박스 없음';
  });

  await chk('버튼이 1️⃣2️⃣ 로 나뉘어 순서가 보인다', () => {
    /* 사용자 결정 2026-09-08 — 한 버튼이 저장과 공유를 같이 하면, 블로그로 넘어간 뒤에야
       사진이 갤러리에 들어갔는지 알게 된다. ① 저장 → 확인 → ② 공유 로 끊는다. */
    must(/id="snsSave"[^>]*>1️⃣ 갤러리에 저장/.test(snsSrc), '① 갤러리에 저장 버튼이 없습니다');
    must(/id="snsGo"[^>]*>2️⃣ 글 복사 \+ 공유/.test(snsSrc), '② 글 복사 + 공유 버튼이 없습니다');
    /* ⚠️ '2️⃣ 글 복사' 는 단계 안내(CH.naver.steps)에도 나온다 — 버튼 구간만 잘라서 본다 */
    const btnAt = snsSrc.indexOf('id="snsSave"');
    const btnBlk = snsSrc.slice(btnAt, btnAt + 600);
    must(btnBlk.indexOf('1️⃣ 갤러리에 저장') < btnBlk.indexOf('2️⃣ 글 복사'), '①② 순서가 뒤바뀌었습니다');
    must(/saveBtn\.textContent = ok \? '✅ 갤러리에 저장했습니다'/.test(snsSrc),
         '저장이 끝난 걸 버튼이 안 알려 줍니다 — ② 로 넘어갈 시점을 모릅니다');
    must(/if \(saveBtn\) shareTextOnly\(chId, text\)/.test(snsSrc),
         '② 가 사진까지 다시 공유합니다 — 사진은 ① 에서 이미 갤러리로 갔습니다');
    return '① 저장 → ② 공유';
  });

  await chk('공유 직전에 참고 화면을 깔아 둔다', () => {
    /* ☠️ 사용자 지적 2026-09-08: 갤러리는 썸네일만 보여 줘서 어느 사진인지 알 수 없다.
       공유 시트를 열기 **전에** 참고 화면을 깔아야, 네이버에서 최근앱으로 돌아왔을 때
       앱에 그 화면이 남아 있다. 순서가 바뀌면 아무 소용이 없다. */
    must(/function openRefScreen\(text\)/.test(snsSrc), '참고 화면이 없습니다');
    const at = snsSrc.indexOf('async function shareTextOnly');
    const blk = snsSrc.slice(at, at + 2000);
    must(blk.indexOf('_Share().share') > 0, '공유 호출을 못 찾았습니다 (검사 기준이 낡았습니다)');
    must(blk.indexOf('openRefScreen(text)') < blk.indexOf('_Share().share'),
         '공유 시트를 연 뒤에 참고 화면을 깝니다 — 돌아왔을 때 안 보입니다');
    must(/id="snsRefClose"/.test(snsSrc), '참고 화면에 닫기 버튼이 없습니다');
    must(!/setTimeout\([^)]*snsRefOv/.test(snsSrc), '참고 화면이 스스로 닫힙니다 — 사용자가 닫을 때까지 남아야 합니다');
    return '공유 전에 깔림';
  });

  await chk('참고 화면의 사진에 마커가 붙는다', () => {
    /* 사진과 '(사진: 🔴 작업 전 1)' 을 나란히 보여 주는 게 짝을 맞추는 유일한 단서다 */
    must(/P\.renderRef = function/.test(prevSrc), '참고용 렌더가 없습니다');
    must(/KIND_LB = \{ before: '🔴 작업 전', after: '🟢 작업 후', special: '⚠️ 특이사항' \}/.test(prevSrc),
         '마커 이름이 ai.js 의 표기와 다릅니다 — 참고표가 거짓말이 됩니다');
    must(/<figcaption><span class="pv-mk">/.test(prevSrc), '사진 밑에 마커를 안 적습니다');
    must(/pushImgs\(list, markTx\)/.test(prevSrc), '캡션이 글의 마커가 아니라 계산한 이름입니다');
    must(/\.post-pv \.pv-fig figcaption\{/.test(css), '참고 화면 캡션 스타일이 없습니다');
    must(/\.post-pv \.pv-fig \.pv-mk\{/.test(css), '마커 상자 스타일이 없습니다');
    return '마커 표기';
  });

  /* ☠️ 2026-09-08 사용자 신고 —
       "참고용과 블로그앱에 복사해 붙인 텍스트가 달라. 블로그 앱 쪽에는
        (사진: 작업 전) (사진: 작업 후) 이렇게밖에 없어"
     원인은 둘이었다.
       ① AI 가 이모지·번호를 빼고 짧게 적는다 → ai.js normalizeMarkers 가 바로잡는다
       ② 참고 화면이 사진 목록에서 이름을 **계산해** 붙였다 → 글을 안 보고 지어낸 셈이다
     그래서 여기서는 '화면 캡션 = 글에 있는 그 글자' 인지를 실제로 렌더해서 확인한다. */
  await chk('캡션이 글에 박힌 마커 글자를 그대로 쓴다', () => {
    /* AI 가 짧게 적은 글을 그대로 넣어 본다 — 계산해서 붙이던 시절엔 여기서 어긋났다 */
    return P.renderRef('제목\n\n(사진: 작업 전 1)\n\n본문입니다.\n\n(사진: 작업 후 1)\n\n끝.')
      .then(h => {
        const figs = h.match(/<figure class="pv-fig">[\s\S]*?<\/figure>/g) || [];
        must(figs.length === 5, '사진 5장에 캡션이 다 안 붙었습니다 (' + figs.length + '개)');
        const pair = {};
        figs.forEach(f => {
          const src = (f.match(/src="([^"]*)"/) || [])[1];
          pair[src] = (f.match(/<span class="pv-mk">([^<]*)<\/span>/) || [])[1];
        });
        must(pair.B1 === '(사진: 작업 전 1)',
             '첫 마커 자리의 캡션이 글과 다릅니다 — 글: (사진: 작업 전 1) / 화면: ' + pair.B1);
        must(pair.A1 === '(사진: 작업 후 1)',
             '둘째 마커 자리의 캡션이 글과 다릅니다 — 글: (사진: 작업 후 1) / 화면: ' + pair.A1);
        /* 마커에 안 걸린 사진은 '없는 표시'를 지어내지 않는다 — 글에서 찾다 시간만 버린다 */
        ['B2', 'A2', 'S1'].forEach(k => {
          must(pair[k] === '글에 표시 없음',
               k + ' 은 글에 마커가 없는데 있는 것처럼 적었습니다: ' + pair[k]);
        });
        return '글자 그대로 · 남은 사진은 표시 없음';
      });
  });

  await chk('AI 가 짧게 적은 마커를 우리가 바로잡는다', () => {
    /* ☠️ 번호가 없으면 (사진: 작업 전) 이 두 번 나올 때 둘이 글자까지 같아져
         어느 자리에 어느 사진인지 알 길이 없다. normalizeMarkers 가 번호를 매긴다. */
    must(/function normalizeMarkers\(text, inv\)/.test(aiSrc), 'normalizeMarkers 가 없습니다');
    const m = aiSrc.match(/function normalizeMarkers\(text, inv\)[\s\S]*?\n  \}/);
    must(m, 'normalizeMarkers 본문을 못 찾았습니다');
    const body = m[0];
    const run = new Function('MARK_EMO', 'photoInventory',
      'var MARK_LB = { before: \'작업 전\', after: \'작업 후\', special: \'특이사항\' };'
      + body + '; return normalizeMarkers;')(
        { before: '🔴', after: '🟢', special: '⚠️' },
        () => ({ before: 2, after: 2, special: 1, total: 5 }));
    const got = run('제목\n\n(사진: 작업 전)\n\n가\n\n(사진: 작업 전)\n\n나\n\n(사진: 작업 후)\n\n다\n\n(사진: 작업 후)\n\n라\n\n(사진: 특이사항)\n\n마\n\n(사진: 작업 후)\n\n끝', null);
    ['(사진: 🔴 작업 전 1)', '(사진: 🔴 작업 전 2)', '(사진: 🟢 작업 후 1)',
     '(사진: 🟢 작업 후 2)', '(사진: ⚠️ 특이사항 1)'].forEach(w => {
      must(got.indexOf(w) >= 0, '마커를 못 바로잡았습니다: ' + w + '\n' + got);
    });
    /* 사진보다 마커가 많으면 남는 마커는 지운다 — 넣을 사진이 없는 자리는 지저분한 글자다 */
    must((got.match(/작업 후/g) || []).length === 2, '사진이 없는 마커가 남았습니다:\n' + got);
    /* 종류를 못 읽는 마커는 손대지 않는다 — 뜻을 지어내면 안 된다 */
    must(run('(사진: 하늘)', null) === '(사진: 하늘)', '알 수 없는 마커를 함부로 고쳤습니다');
    return '이모지 + 번호 붙임 · 남는 마커 제거';
  });

  await chk('바로잡기가 실제 생성 경로에 걸려 있다', () => {
    /* 함수만 있고 안 부르면 아무 소용이 없다 — 조용히 새는 자리라 배선까지 본다 */
    const at = aiSrc.indexOf('async function generatePost');
    const blk = aiSrc.slice(at, aiSrc.indexOf('// ── 견적 교정 학습', at));
    must(/normalizeMarkers\(_out\)/.test(blk), '생성 결과에 마커 바로잡기를 안 겁니다');
    must(/if \(markGuide\)[\s\S]{0,120}normalizeMarkers/.test(blk),
         '마커를 안 쓰는 채널(인스타 등)까지 건드립니다');
    return '네이버 글에만 적용';
  });

  /* ☠️ 2026-09-08 사용자 신고 — 모바일 네이버로 공유했더니 제목이 이렇게 나왔다:
       "[공유] 삼원빌딩 에어컨 청소 — 곰팡이가 이 정도면 … 필요가 있습니다. 삼원"
       제목을 안 넘기면 블로그 앱이 본문 앞부분을 제 마음대로 잘라 쓴다.
       "제목은 본문 내용의 첫줄이 적당해 보여. [공유] 이거 없이 첫줄만 제목에 넣어줘" */
  await chk('공유할 때 글의 첫 줄을 제목으로 넘긴다', () => {
    must(/function firstLine\(text\)/.test(snsSrc), '제목 뽑는 코드가 없습니다');
    const at = snsSrc.indexOf('async function shareTextOnly');
    const blk = snsSrc.slice(at, at + 1800);
    must(/_payload\.title = _ti/.test(blk),
         '공유에 제목을 안 넘깁니다 (네이버는 무시하지만 티스토리 등은 이 값을 씁니다)');
    /* ☠️ 2026-09-08 3차 (사용자 결정) — 본문은 **그대로 넘긴다.**
         한때 제목을 깨끗이 하려고 본문을 안 넘겨 봤는데, 제목은 "[공유]" 만 남고
         본문이 통째로 비었다("본문은 왜 비어있는거야??").
         네이버가 붙이는 "[공유]" 말머리는 어차피 못 없애므로 제목은 손을 대야 한다.
         그렇다면 본문이라도 자동으로 채워지는 쪽이 손이 덜 간다. */
    must(/text: text \|\| ''/.test(blk), '본문을 안 넘깁니다 — 블로그 본문이 텅 빕니다');
    must(!/noShareBody/.test(snsSrc), '본문을 안 넘기던 코드가 남아 있습니다');
    /* 제목을 옮겨 담는 법을 안내가 알려 줘야 한다 — 안 알려 주면 "[공유]…" 를 보고 막힌다 */
    must(/제목 칸의 글자를 모두 지우고<\/b> 거기에 <b>붙여넣기/.test(snsSrc),
         '제목을 지우고 붙여넣으라는 안내가 없습니다');
    must(/네이버가 붙인 것/.test(snsSrc), '"[공유]" 가 네이버가 붙인 말이라는 설명이 없습니다');
    must(/본문에 남은 <b>추천 제목 줄<\/b>을 지우세요/.test(snsSrc),
         '본문에 남는 추천 제목을 지우라는 안내가 없습니다');

    const m = snsSrc.match(/function firstLine\(text\)[\s\S]*?\n  \}/);
    must(m, 'firstLine 본문을 못 찾았습니다');
    const fn = new Function('TITLE_MAX', m[0] + '; return firstLine;')(100);
    must(fn('삼원빌딩 에어컨 청소 — 곰팡이가 이 정도면\n\n본문입니다') === '삼원빌딩 에어컨 청소 — 곰팡이가 이 정도면',
         '첫 줄을 그대로 못 가져옵니다');
    must(fn('[공유] 제목입니다\n본문') === '제목입니다', '[공유] 를 안 떼어 냅니다');
    must(fn('## 제목입니다\n본문') === '제목입니다', '마크다운 기호를 안 떼어 냅니다');
    must(fn('**굵은 제목**\n본문') === '굵은 제목', '굵게 표시를 안 떼어 냅니다');
    must(fn('\n\n  \n실제 첫 줄\n본문') === '실제 첫 줄', '빈 줄을 못 건너뜁니다');
    must(fn('(사진: 🔴 작업 전 1)\n진짜 제목') === '진짜 제목', '사진 마커 줄을 제목으로 씁니다');
    /* ☠️ 글 맨 위에 [추천 제목] 블록이 생겼다 — 그 머리글이나 후보 줄을 제목으로 집으면 안 된다 */
    must(fn('추천 제목\n1. 후보 하나\n2. 후보 둘\n3. 후보 셋\n\n본문 제목입니다\n본문') === '본문 제목입니다',
         '추천 제목 블록을 건너뛰지 못합니다');
    must(fn('가'.repeat(150)).length === 100, '제목 길이 상한(100)이 안 걸립니다');
    must(fn('') === '', '빈 글에서 터집니다');
    return '첫 줄 · [공유] 제거 · 마커 건너뜀 · 100자';
  });

  /* ☠️ 2026-09-08 사용자 요청 — "글을 생성할 때 처음에 추천제목으로, 그 아래 추천하는
     제목 3가지를 나열하고, 그 아래부터 본문을 넣어줘"
     네이버 앱이 공유 제목을 안 읽어서 제목 칸은 손으로 채워야 한다. 글을 만들 때 같이
     지어 두면 고르기만 하면 되고, 본문과 한 번에 나오므로 추가 요금이 없다. */
  await chk('블로그 글 맨 위에 추천 제목 3개를 붙인다', () => {
    must(/var TITLE_BLOCK_GUIDE = \[/.test(aiSrc), '추천 제목 지침이 없습니다');
    const g = aiSrc.match(/var TITLE_BLOCK_GUIDE = \[[\s\S]*?\]\.join/);
    must(g, '추천 제목 지침 본문을 못 찾았습니다');
    ['추천 제목', '1. (제목 후보)', '2. (제목 후보)', '3. (제목 후보)'].forEach(k => {
      must(g[0].indexOf(k) >= 0, '지침에 "' + k + '" 가 없습니다 — 형식이 흔들립니다');
    });
    must(/25~32자/.test(g[0]), '제목 길이 기준이 빠졌습니다');
    /* ☠️ 순위를 보장한다고 쓰면 안 된다 — 검색 규칙은 공개돼 있지도 고정돼 있지도 않다 */
    must(!/순위를 (보장|올려)/.test(g[0]), '검색 순위를 보장하는 것처럼 적었습니다');
    const at = aiSrc.indexOf('async function generatePost');
    const blk = aiSrc.slice(at, aiSrc.indexOf('// ── 견적 교정 학습', at));
    must(/if \(chId === 'naver'\) sys \+= '\\n\\n' \+ TITLE_BLOCK_GUIDE;/.test(blk),
         '추천 제목 지침이 실제로 안 걸립니다');
    must(!/insta|carrot/.test(blk.slice(blk.indexOf('TITLE_BLOCK_GUIDE') - 120, blk.indexOf('TITLE_BLOCK_GUIDE'))),
         '블로그가 아닌 채널에도 제목 후보를 붙입니다');
    /* 마커 규칙도 새 첫 줄에 맞춰 고쳐 뒀어야 한다 */
    must(/\[추천 제목\] 블록 안, 본문 제목 줄/.test(aiSrc),
         '마커 금지 자리 안내가 옛 "맨 첫 줄" 그대로입니다 — 제목 후보 사이에 마커가 낍니다');
    return '네이버 글에만 · 3개 · 25~32자';
  });

  await chk('인스타·페이스북은 그대로 공유 시트를 쓴다', () => {
    /* 거기선 사진이 게시물 자체라 '자리' 개념이 없다 — 몰려도 문제가 안 된다 */
    ['insta', 'facebook'].forEach(k => {
      const b = snsSrc.match(new RegExp(k + ':\\s*\\{([^}]*)\\}'));
      must(b, k + ' 채널 설정을 못 찾았습니다');
      must(!/gallery: true/.test(b[1]), k + ' 까지 갤러리 방식으로 바뀌었습니다');
    });
    return '공유 시트 유지';
  });

  await chk('모바일 안내에는 저품질 경고를 넣지 않는다', () => {
    /* 링크가 안 들어가는 방식이라 저품질과 무관하다(사용자 2026-09-08).
       PC 링크 안내(openPc)에만 있어야 한다. */
    const at = snsSrc.indexOf('var CH = {');
    const end = snsSrc.indexOf('function isNative()');
    must(at > 0 && end > at, '채널 안내 구간을 못 찾았습니다');
    must(!/저품질/.test(snsSrc.slice(at, end)), '모바일 채널 단계에 저품질 경고가 들어갔습니다');
    must(/저품질의 원인/.test(snsSrc), 'PC 링크 안내의 저품질 경고까지 사라졌습니다');
    return '모바일 없음 · PC 링크만';
  });

  await chk('마크다운 구분선(---)이 글자로 남지 않는다', () => {
    const rule = /\^\(\[-\*_\]\)\\1\{2,\}\$/;
    [['preview.js', prevSrc], ['post.html', postSrc]].forEach(([n, src]) => {
      must(/\[-\*_\]\)\\1\{2,\}/.test(src), n + ' 의 para() 가 구분선을 안 거릅니다');
    });
    must(/마크다운 구분선\(---, \*\*\*, ___\)을 쓰지 마세요/.test(aiSrc),
         'AI 에게 구분선을 쓰지 말라고 안 합니다 — 매번 걸러내는 건 뒷수습입니다');
    return '프롬프트 + 두 화면';
  });

  console.log('\n' + (fails ? '❌ 실패 ' + fails + '건 / ' : '✅ ') + '통과 ' + oks + '건');
  process.exit(fails ? 1 : 0);
})();
