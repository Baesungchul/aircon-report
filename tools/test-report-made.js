/* ═══════════════════════════════════════════════════════════════════
   tools/test-report-made.js — 보고서 표지 맨 아래 한 줄
   ----------------------------------------------------------------
   왜 넣었나 (2026-09-21)
     보고서는 만든 사람 손을 떠나 **업체와 고객에게 그대로 건너간다.**
     그런데 그 종이에 앱 흔적이 한 글자도 없어서, 매일 나가는 보고서가
     전부 그냥 지나갔다. 표지 푸터 왼쪽 칸이 비어 있어 거기에 한 줄만 넣었다.

   ⭐ 여기서 지켜야 하는 것은 '광고가 잘 보이는가'가 아니다. 그 반대다 —
      남의 서류를 망치지 않는 선을 지키는 것이다. 선을 넘으면 사용자가 앱을 버린다.
        ① 표지에만. 쪽마다 넣으면 남의 서류에 도배하는 꼴이 된다.
        ② 끌 수 있어야 한다. 강제로 남기면 신뢰를 깎는다.
        ③ 기본은 켬. 다만 끈 사람에게는 한 글자도 나가면 안 된다.
═══════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const REP = rd('www', 'js', 'report.js');
const SET = rd('www', 'js', 'settings.js');
const HTML = rd('www', 'index.html');
const CSS = rd('www', 'styles.css');

let pass = 0;
const fails = [];
function chk(name, fn) {
  try { const n = fn(); pass++; console.log('  ✅ ' + name + (n ? ' — ' + n : '')); }
  catch (e) { fails.push(name); console.log('  ❌ ' + name + ' — ' + ((e && e.message) || e)); }
}
function must(c, m) { if (!c) throw new Error(m); }

/* 문구를 만드는 함수만 떼어 진짜로 돌려 본다.
   ☠️ 글자만 찾아보면 '켜고 끄는 셈'이 뒤집혀 있어도 통과한다 — 실제로 불러 본다. */
function madeLine(stored, lang) {
  const at = REP.indexOf('function reportMadeLine()');
  must(at > 0, 'reportMadeLine 을 못 찾았습니다');
  const end = REP.indexOf('\n}', at) + 2;
  const src = REP.slice(at, end);
  const f = new Function('localStorage', 'getCurrentLang', 'REPORT_MADE_KEY',
    src + '; return reportMadeLine();');
  return f({ getItem: () => stored }, () => (lang || 'ko'), 'ac_report_made_v1');
}

console.log('\n── 켜고 끄기 ──');

chk('아무 설정도 안 한 사람은 켜져 있다', () => {
  const s = madeLine(null);
  must(s && s.length > 0, '기본이 꺼져 있습니다 — 값이 없는 기존 사용자에게 안 나옵니다');
  return s;
});

chk('켠 사람에게도 나온다', () => {
  must(madeLine('on').length > 0, "'on' 인데 안 나옵니다");
});

chk('☠️ 끈 사람에게는 한 글자도 안 나간다', () => {
  /* 여기가 무너지면 '껐는데 그대로 찍혔다'가 된다. 남의 서류에 그러면 앱을 버린다 */
  const s = madeLine('off');
  must(s === '', '끈 사람에게 「' + s + '」 가 나갑니다');
  return '빈 값';
});

chk('저장한 값을 못 읽어도 보고서는 만들어진다', () => {
  /* localStorage 가 막힌 환경(웹뷰 설정·시크릿)에서 던지면 보고서 생성이 통째로 멈춘다 */
  const at = REP.indexOf('function reportMadeLine()');
  const src = REP.slice(at, REP.indexOf('\n}', at) + 2);
  must(/try \{[\s\S]*catch/.test(src), '읽기를 감싸지 않았습니다');
  const f = new Function('localStorage', 'getCurrentLang', 'REPORT_MADE_KEY',
    src + '; return reportMadeLine();');
  const s = f({ getItem: () => { throw new Error('접근 불가'); } }, () => 'ko', 'k');
  must(typeof s === 'string', '터집니다');
  return '버팀';
});

console.log('\n── 어디에 찍히는가 ──');

chk('표지 푸터의 빈 칸에 들어간다', () => {
  const at = REP.indexOf('<div class="rp-cv-foot">');
  must(at > 0, '표지 푸터를 못 찾았습니다');
  const b = REP.slice(at, at + 260);
  must(/rp-made/.test(b) && /reportMadeLine\(\)/.test(b), '표지에 안 들어갑니다');
  return 'rp-cv-foot';
});

chk('☠️ 쪽마다 찍지 않는다 (표지에만)', () => {
  /* 쪽마다 넣으면 남의 서류에 도배하는 꼴이다. 한 번 그러면 다시 안 쓴다 */
  /* ⚠️ 함수를 만드는 줄(function reportMadeLine())도 같이 잡히니 빼고 센다 */
  const n = (REP.match(/(?<!function )reportMadeLine\(\)/g) || []).length;
  must(n === 1, '보고서 안에서 ' + n + '번 부릅니다 (표지 한 번이어야 합니다)');
  const foot = REP.indexOf('<div class="rp-foot">');
  must(foot > 0, '쪽 푸터를 못 찾았습니다');
  must(!/rp-made/.test(REP.slice(foot, foot + 300)), '쪽 푸터에도 넣었습니다');
  return '1곳';
});

chk('작고 연한 글씨다 (서류가 주인공)', () => {
  const m = CSS.match(/\.rp-made\{([^}]*)\}/);
  must(m, 'styles.css 에 .rp-made 가 없습니다');
  const sz = m[1].match(/font-size:([\d.]+)px/);
  must(sz && parseFloat(sz[1]) <= 11.5, '글씨가 큽니다 (' + (sz ? sz[1] : '?') + 'px)');
  return sz[1] + 'px';
});

chk('종이에 주소를 적지 않는다', () => {
  /* work-report-826ec.web.app 은 종이에 적어 봐야 아무도 손으로 못 친다.
     스토어에서 이름으로 찾게 하는 편이 실제로 닿고, 그 검색이 스토어 순위에도 쌓인다 */
  const s = madeLine(null);
  must(!/https?:|web\.app|\.com/.test(s), '주소를 적었습니다: ' + s);
  must(/현장매니저/.test(s), '앱 이름이 없습니다');
  return '이름만';
});

chk('영어로 쓸 때도 나온다', () => {
  const s = madeLine(null, 'en');
  must(s && s.length > 0, '영어에서 빕니다');
  return s;
});

console.log('\n── 끄는 길이 실제로 있는가 ──');

chk('설정 화면에 스위치가 있다', () => {
  must(/id="reportMadeChk"/.test(HTML), '설정에 스위치가 없습니다 — 끌 방법이 없습니다');
  const at = HTML.indexOf('id="reportMadeChk"');
  const around = HTML.slice(Math.max(0, at - 700), at);
  must(/set-sec-title/.test(around), '설정 묶음 안에 있지 않습니다');
  return '있음';
});

chk('설정을 열면 지금 상태로 보인다', () => {
  must(/reportMadeChk[\s\S]{0,200}checked\s*=/.test(SET) || /madeChk\.checked\s*=/.test(SET),
       '복원하지 않습니다 — 껐는데 켜진 것처럼 보입니다');
  must(/REPORT_MADE_KEY\) !== 'off'/.test(SET), '기본이 켬이 아닙니다');
  return '복원함';
});

chk('☠️ 스위치를 누르면 저장된다', () => {
  /* 저장을 안 하면 앱을 껐다 켤 때마다 되살아난다 */
  must(/setItem\(REPORT_MADE_KEY/.test(SET), '저장하지 않습니다');
  must(/madeChkEl\.checked \? 'on' : 'off'/.test(SET), '켜고 끔이 값과 반대로 저장될 수 있습니다');
  return '저장함';
});

chk('설정 검색에서도 찾을 수 있다', () => {
  must(/'표지 문구'/.test(SET), '설정 검색 목록에 없습니다');
  return '표지 문구';
});

console.log('');
if (fails.length) {
  console.log('❌ ' + fails.length + '개 실패\n');
  fails.forEach((f) => console.log('  · ' + f));
  process.exit(1);
}
console.log('✅ 전부 통과 (' + pass + '개)\n');
