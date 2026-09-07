/* ═══════════════════════════════════════════════════════════
   tools/test-schedule-name.js
   문자·캡처 분석(AI 일정등록)이 고객명을 실제로 채우는지 검사한다
   ----------------------------------------------------------------
   왜 필요한가 (2026-09-07 사용자 신고):
     "일정등록에서 고객명 필드가 추가되고 나서, 분석한 내용에 고객명이 있어도
      들어가지지 않고 있어"
     ── 원인은 화면이 아니라 프롬프트였다. 2026-08-30 에 폼(qwName)과 저장 구조
        (customer.name)에는 고객명이 생겼는데, ai.js 의 일정 추출 프롬프트에는
        name 키가 아예 없었다. AI 가 내놓지 않는 값을 폼이 채울 방법은 없다.
     ── 이런 '한쪽만 고친 상태'는 화면을 열어봐도 티가 안 난다(칸은 멀쩡히 보인다).
        그래서 프롬프트 ↔ 폼 ↔ 학습 세 곳이 같은 키를 쓰는지 여기서 못 박아 둔다.
═══════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const JS = path.join(__dirname, '..', 'www', 'js');

let fails = 0, oks = 0;
function chk(name, fn) {
  try { const r = fn(); console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; }
  catch (e) { console.log('  ❌ ' + name + ' — ' + e.message); fails++; }
}
const must = (c, m) => { if (!c) throw new Error(m); };
const read = (f) => fs.readFileSync(path.join(JS, f), 'utf8');

/* ai.js 를 가짜 브라우저에 올려 이름 다듬기 함수만 꺼내 쓴다 */
function loadAI() {
  const ctx = {
    console, setTimeout, clearTimeout, Date, String, Math, JSON, Object, Array, RegExp, Promise,
    fetch: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: {
      addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      createElement: () => ({ style: {}, classList: { add() {} }, addEventListener() {} }), body: { appendChild() {} }
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('ai.js'), ctx, { filename: 'ai.js' });
  must(typeof ctx.__aiCleanName === 'function', 'ai.js 가 이름 다듬기 함수를 안 내놓습니다 (검사 기준이 낡았습니다)');
  return ctx;
}
const AI = loadAI();
const clean = AI.__aiCleanName;

const ai = read('ai.js');
const cal = read('calendar.js');

console.log('\n[1] 프롬프트 — AI 에게 고객명을 아예 안 물어보고 있었다');

chk('추출 키 목록에 name 이 있다', () => {
  const m = ai.match(/키:\s*date\(YYYY-MM-DD\)[^\n]*/);
  must(m, '추출 키 목록을 못 찾았습니다 (검사 기준이 낡았습니다)');
  must(/\bname\(/.test(m[0]), '키 목록에 name 이 없습니다 — AI 가 고객명을 영영 안 내놓습니다');
  return 'name 있음';
});

chk('고객명 규칙이 프롬프트에 들어 있다', () => {
  must(/\[고객명\(name\) 규칙\]/.test(ai), '규칙 블록이 없습니다');
  must(/건물[·・]단지[^\n]*name 에 넣지 않는다/.test(ai), '건물명을 이름으로 넣지 말라는 규칙이 없습니다');
  must(/못 찾으면[^\n]*빈 문자열/.test(ai), '못 찾으면 비우라는 규칙이 없습니다 — 이름을 지어냅니다');
  return '규칙 있음';
});

chk('캡처 전사에서 발신자 이름을 따로 옮긴다', () => {
  must(/\[발신자:/.test(ai), 'OCR 프롬프트에 [발신자:] 줄이 없습니다 — 캡처의 저장된 이름이 사라집니다');
  must(/\[연락처: 010-1234-5678\] 형식으로 숫자만/.test(ai),
       '[연락처:] 가 숫자 전용이라는 지시가 없습니다 — 전화번호 안전망 정규식(숫자만 매칭)이 깨집니다');
  return '연락처/발신자 분리';
});

console.log('\n[2] 안전망 — AI 가 비워도 캡처의 발신자 이름으로 되살린다');

chk('[발신자:] 줄에서 이름을 꺼내는 코드가 있다', () => {
  must(/\\\[발신자:\\s\*\(\[\^\\\]\\n\]\{1,20\}\)\\\]/.test(ai) || /\[발신자:\\s\*/.test(ai),
       '발신자 줄을 읽는 정규식이 없습니다');
  const at = ai.indexOf('obj.name = _cleanName(obj.name)');
  must(at > 0, '결과에 이름 다듬기를 안 걸었습니다');
  return '있음';
});

console.log('\n[3] 이름 다듬기 — 이 칸은 고객 목록·보고서·문자에 그대로 나간다');

chk('호칭을 뗀다', () => {
  must(clean('홍길동님') === '홍길동', '님 이 안 떨어집니다: ' + clean('홍길동님'));
  must(clean('김철수 사장님') === '김철수', '사장님 이 안 떨어집니다: ' + clean('김철수 사장님'));
  must(clean('박민정씨') === '박민정', '씨 가 안 떨어집니다: ' + clean('박민정씨'));
  must(clean('고객명: 이영희') === '이영희', '라벨이 안 떨어집니다: ' + clean('고객명: 이영희'));
  return '님/씨/사장님/라벨';
});

chk('전화번호·호수는 이름이 아니다', () => {
  must(clean('010-1234-5678') === '', '전화번호가 이름으로 들어갑니다');
  must(clean('101동 502호') === '', '동호수가 이름으로 들어갑니다');
  return '숫자 덩어리 거름';
});

chk('건물·업체 이름은 이름이 아니다', () => {
  ['행복아파트', '우미2차 아파트', '라이프타워', '한빛빌라', '주식회사 시원'].forEach(function (s) {
    must(clean(s) === '', s + ' 가 고객명으로 들어갑니다');
  });
  return '건물/업체 거름';
});

chk('멀쩡한 이름은 그대로 둔다', () => {
  must(clean('김영수') === '김영수', '이름이 바뀝니다');
  must(clean(' 박민정 ') === '박민정', '공백이 안 지워집니다');
  must(clean('') === '' && clean(null) === '' && clean(undefined) === '', '빈 값 처리가 안 됩니다');
  return '보존';
});

chk('말도 안 되게 긴 값은 버린다', () => {
  must(clean('가나다라마바사아자차카타파하') === '', '문장이 이름으로 들어갑니다');
  return '12자 초과 거름';
});

console.log('\n[4] 배선 — 프롬프트·폼·학습이 같은 키를 써야 한다');

chk('폼이 prefill.name 을 고객명 칸에 넣는다', () => {
  must(/_setv\('qwName',\s*prefill\.name\)/.test(cal), 'openQuickWorkAdd 가 고객명을 안 채웁니다');
  must(/id="qwName"/.test(cal), '고객명 입력칸이 없습니다');
  return '연결됨';
});

chk('저장할 때 고객명이 customer.name 으로 들어간다', () => {
  must(/customer:\s*\{\s*name:\s*custName/.test(cal), '저장 구조에 고객명이 안 담깁니다');
  return '저장됨';
});

chk('학습 대상에도 name 이 들어 있다 (양쪽 짝이 맞아야 한다)', () => {
  const m = ai.match(/var CORR_FIELDS = \[([^\]]*)\]/);
  must(m, 'CORR_FIELDS 를 못 찾았습니다 (검사 기준이 낡았습니다)');
  must(/'name'/.test(m[1]), "CORR_FIELDS 에 'name' 이 없습니다 — 이름을 고쳐도 학습되지 않습니다");
  must(/name:\s*prefill\.name/.test(cal), 'saveCorrection 이 AI 원본 이름을 안 넘깁니다');
  must(/name:\s*custName/.test(cal), 'saveCorrection 이 사용자 확정 이름을 안 넘깁니다');
  return '학습 포함';
});

console.log('\n' + (fails ? '❌ 실패 ' + fails + '건 / ' : '✅ ') + '통과 ' + oks + '건');
process.exit(fails ? 1 : 0);
