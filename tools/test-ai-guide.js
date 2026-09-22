/* ═══════════════════════════════════════════════════════════════════
   tools/test-ai-guide.js — 사용자가 쓴 지침이 글쓰기에 실제로 먹히는가
   ----------------------------------------------------------------
   ☠️ 2026-09-22 사용자 신고
      "상가 업체명은 개인정보이니 쓰지 말라고 지침에 넣었는데 반영이 안 된다."

      지침은 제대로 들어가고 있었다. 문제는 **앱이 박아 둔 규칙이 그 반대를
      허락**하고 있었다는 것이다 — "위치는 아파트/건물명(단지명)까지만 언급합니다".
      상가 현장에서는 건물명이 곧 상호다. 게다가 그 규칙에는 '최우선 규칙'이라는
      이름표가 붙어 있었고, 사용자 지침은 그냥 "[반드시 반영할 지침]" 이었다.
      모델은 이름표를 보고 앞의 것을 따랐다.

   ⭐ 그래서 이 검사가 지키는 것은 세 가지다.
      ① 앱이 사용자 지침과 **반대되는 허락**을 하지 않는다.
      ② 사용자 지침이 프롬프트의 **맨 마지막**에 오고, 이긴다고 글로 적혀 있다.
      ③ 규칙이 **한 곳에만** 있다. 예전에는 같은 문장이 채널 4개 sys 와 기본 지침
         4개에 따로 박혀 있어서, 한 군데를 고쳐도 나머지 일곱이 옛말을 했다.

   ⚠️ 주석을 걷어내고 본다. 위 설명에 옛 문장이 그대로 적혀 있어서, 주석째로 찾으면
      규칙을 제대로 고쳐 놓고도 검사가 실패한다(이 세션에서 두 번 당했다).
═══════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RAW = fs.readFileSync(path.join(ROOT, 'www', 'js', 'ai.js'), 'utf8');
/* 줄 주석과 블록 주석을 걷어낸 '실제로 도는 코드' */
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0;
const fails = [];
function chk(name, fn) {
  try { const n = fn(); pass++; console.log('  ✅ ' + name + (n ? ' — ' + n : '')); }
  catch (e) { fails.push(name); console.log('  ❌ ' + name + ' — ' + ((e && e.message) || e)); }
}
function must(c, m) { if (!c) throw new Error(m); }

/* 이름 붙은 상수의 본문만 떼어 온다 */
function constOf(name) {
  const at = SRC.indexOf('var ' + name + ' =');
  must(at > 0, name + ' 을 못 찾았습니다');
  const end = SRC.indexOf("].join(", at);
  must(end > at, name + ' 이 줄 배열 모양이 아닙니다');
  return SRC.slice(at, end);
}
/* generatePost 본문 */
function postBody() {
  const at = SRC.indexOf('async function generatePost(');
  must(at > 0, 'generatePost 를 못 찾았습니다');
  const end = SRC.indexOf('\n  }', SRC.indexOf('callClaude(', at));
  return SRC.slice(at, end > at ? end : at + 3000);
}

console.log('\n── 앱이 사용자 지침과 반대되는 말을 하지 않는가 ──');

chk('☠️ 「건물명까지만 언급합니다」 라는 허락이 남아 있지 않다', () => {
  /* 이 한 문장이 이번 신고의 원인이었다. 상가에서는 건물명이 곧 상호다 */
  must(!/건물명\(단지명\)까지만/.test(SRC),
       '아직 건물명을 써도 된다고 허락하고 있습니다');
  must(!/아파트\/건물명까지만/.test(SRC), '기본 지침에도 같은 허락이 남아 있습니다');
  return '없음';
});

chk('☠️ 상호·점포명을 쓰지 말라고 분명히 적혀 있다', () => {
  const r = constOf('PRIVACY_RULE');
  must(/상호/.test(r) && /점포명|업체명/.test(r), '상호를 쓰지 말라는 줄이 없습니다');
  must(/쓰지 않습니다/.test(r), '금지가 아니라 권고로 적혀 있습니다');
  return '금지';
});

chk('☠️ 사진에서 읽어 옮기지 말라고 적혀 있다', () => {
  /* 간판이 찍힌 사진을 같이 보내면서 상호를 쓰지 말라고만 하면
     모델은 사진에서 읽어 쓴다. 예전에는 이 줄이 한 줄도 없었다 */
  const r = constOf('PRIVACY_RULE');
  must(/사진에/.test(r) && /간판/.test(r), '사진에 대한 규칙이 없습니다');
  must(/옮겨 적지 않습니다/.test(r), '읽지 말라고만 하고 옮기지 말라는 말이 없습니다');
  return '간판 포함';
});

chk('작업명을 그대로 옮기지 말라고 적혀 있다', () => {
  /* [작업 정보] 첫 줄이 「현장/작업명」이고, 상가 작업이면 그 값이 곧 상호다 */
  const r = constOf('PRIVACY_RULE');
  must(/현장\/작업명/.test(r), '작업명에 대한 규칙이 없습니다');
  return '있음';
});

chk('아파트 단지명은 계속 쓸 수 있다', () => {
  /* 지역명+단지명이 검색 키워드다. 여기까지 막으면 글이 안 읽힌다 —
     이번 요청은 '상호를 빼 달라'였지 '지명을 다 빼 달라'가 아니었다 */
  const r = constOf('PRIVACY_RULE');
  must(/아파트 단지명까지만|단지명까지만 씁니다/.test(r), '단지명까지 막아 버렸습니다');
  return '허용';
});

console.log('\n── 사용자 지침이 이기는가 ──');

chk('☠️ 사용자 지침이 프롬프트의 맨 마지막에 붙는다', () => {
  /* 앞에 '최우선'이라 적힌 규칙이 있으면 뒤에 와도 밀린다. 자리부터 맨 뒤여야 한다 */
  const b = postBody();
  const user = b.indexOf('USER_GUIDE_HEAD');
  must(user > 0, '사용자 지침 머리말을 안 붙입니다');
  ['COMMON_WRITE_GUIDE', 'PRIVACY_RULE', 'TITLE_BLOCK_GUIDE', 'markGuide'].forEach((k) => {
    const at = b.lastIndexOf(k + ';');
    if (at > 0) must(at < user, k + ' 가 사용자 지침보다 **뒤에** 붙습니다');
  });
  return '맨 뒤';
});

chk('☠️ 어긋나면 사용자 지침을 따르라고 글로 적혀 있다', () => {
  const h = constOf('USER_GUIDE_HEAD');
  must(/우선한다/.test(h), '누가 이기는지 안 적혀 있습니다');
  must(/아래를 따르세요/.test(h), '어긋날 때 어느 쪽을 따를지 안 적혀 있습니다');
  return '적힘';
});

chk('예전 머리말(반드시 반영할 지침)이 남아 있지 않다', () => {
  must(!/\[반드시 반영할 지침\]/.test(SRC.slice(SRC.indexOf('async function generatePost('))),
       '옛 머리말을 그대로 쓰고 있습니다');
  return '바뀜';
});

chk('☠️ 지침으로도 풀 수 없는 것이 명시돼 있다', () => {
  /* 사용자 지침이 이긴다고만 하면 "고객 전화번호도 넣어줘" 가 통한다.
     동·호수·이름·전화번호·상세주소는 어떤 지침으로도 못 푼다 */
  const h = constOf('USER_GUIDE_HEAD');
  must(/전화번호/.test(h) && /어떤 지침이 있어도/.test(h),
       '지침으로 개인정보까지 풀 수 있게 열려 있습니다');
  return '잠김';
});

chk('사진 마커 형식만은 예외로 남겨 둔다', () => {
  /* 2026-09-01 에 고친 것 — 옛 지침에 옛 마커 형식이 적혀 있어도 새 형식이 이겨야 한다 */
  const h = constOf('USER_GUIDE_HEAD');
  must(/사진 배치 규칙/.test(h), '마커 형식 예외가 빠졌습니다');
  return '예외';
});

console.log('\n── 규칙이 한 곳에만 있는가 ──');

chk('☠️ 채널 sys 4개에 개인정보 규칙을 따로 박아 두지 않았다', () => {
  /* 예전에는 같은 문장이 8군데에 흩어져 있었다. 그래서 한 곳을 고쳐도 나머지가 옛말을 했다 */
  const n = (SRC.match(/\[개인정보 보호 — 최우선 규칙\]/g) || []).length;
  must(n === 0, '채널 sys 에 옛 규칙이 ' + n + '군데 남아 있습니다');
  const inConst = (SRC.match(/\[개인정보 보호\]/g) || []).length;
  must(inConst === 1, '개인정보 규칙이 ' + inConst + '군데 있습니다 (한 곳이어야 합니다)');
  return '1곳';
});

chk('기본 지침에도 상호 금지가 들어 있다', () => {
  /* 지침을 한 번도 저장 안 한 사람은 기본 지침으로 글을 쓴다 */
  const n = (SRC.match(/상호·점포명도 쓰지 않고/g) || []).length;
  must(n === 4, '기본 지침 ' + n + '개에만 들어 있습니다 (네 채널 모두여야 합니다)');
  return '4채널';
});

chk('견적서·일정 분석에는 이 규칙을 붙이지 않는다', () => {
  /* 견적서에는 상호와 연락처가 있어야 한다. 블로그 규칙을 거기까지 끌고 가면 안 된다 */
  const q = SRC.indexOf('function generateQuote');
  if (q > 0) {
    must(!/PRIVACY_RULE/.test(SRC.slice(q, q + 2500)), '견적서에도 붙였습니다');
  }
  const n = (SRC.match(/PRIVACY_RULE/g) || []).length;
  must(n === 2, 'PRIVACY_RULE 을 ' + n + '번 씁니다 (정의 1 + 글쓰기 1 이어야 합니다)');
  return '글쓰기에만';
});

console.log('\n── 지침이 어느 업종 것인지 보이는가 ──');

chk('지침 편집 창이 적용 업종을 알려 준다', () => {
  /* 지침은 업종 프로필마다 따로 저장된다. 설정에서 A업종 지침을 고쳐 놓고
     B업종 작업으로 글을 쓰면 그 지침은 안 들어간다 — 화면에 적혀 있어야 찾는다 */
  must(/업종에만 적용됩니다/.test(RAW), '어느 업종 지침인지 안 알려 줍니다');
  must(/모든 업종에 공통/.test(RAW), '공통 지침 표시가 없습니다');
  return '표시함';
});

console.log('');
if (fails.length) {
  console.log('❌ ' + fails.length + '개 실패\n');
  fails.forEach((f) => console.log('  · ' + f));
  process.exit(1);
}
console.log('✅ 전부 통과 (' + pass + '개)\n');
