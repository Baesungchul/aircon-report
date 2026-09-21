/* ═══════════════════════════════════════════════════════════════════
   tools/test-notify-time.js — 알림이 **지금 시간**으로 울리는지
   ----------------------------------------------------------------
   ☠️ 2026-09-21 사용자 신고: "작업시간을 바꿨는데 기존 시간으로 알림이 온다"

   원인은 세 갈래였다. 셋 다 여기서 못 박는다.

     ① 공유 일정의 고친 시간(CloudShare 오버라이드)을 notify.js 만 안 봤다.
        달력(_workStart)은 오버라이드를 맨 먼저 보는데 알람은 units 의 옛 값을 봤다.
        → 화면과 알람이 어긋났다. **같은 답을 내야 한다.**

     ② 시간을 글자 그대로 정렬했다. '9:00' 과 '13:00' 을 글자로 견주면
        '13:00' 이 앞선다. 0 을 안 채운 값이 섞이면 가장 이른 시간을 잘못 골랐다.

     ③ 일정을 고친 뒤 알람을 다시 걸지 않았다. Notify.refresh 는 앱이 앞으로
        돌아올 때만 돌아서, 고치고 앱에 계속 머무르면 옛 알람이 그대로 남았다.

   ⚠️ 이 시험은 브라우저 없이 돈다 — notify.js 를 가짜 window 에 얹어서 본다.
═══════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'www', 'js');
const read = (f) => fs.readFileSync(path.join(JS, f), 'utf8');

let pass = 0;
const fails = [];
function chk(name, fn) {
  try { const n = fn(); pass++; console.log('  ✅ ' + name + (n ? ' — ' + n : '')); }
  catch (e) { fails.push(name + '\n      ' + ((e && e.message) || e)); console.log('  ❌ ' + name + '\n      ' + ((e && e.message) || e)); }
}
function must(c, m) { if (!c) throw new Error(m); }
function same(a, b, m) { if (a !== b) throw new Error(m + '\n      기대: ' + a + '\n      실제: ' + b); }

/* notify.js 를 가짜 브라우저에 얹는다. 실제 알람은 안 건다(네이티브가 아니라서). */
function loadNotify(extra) {
  const listeners = {};
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout,
    localStorage: (function () {
      const m = {};
      return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
    })(),
    document: { addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); }, visibilityState: 'visible' }
  };
  ctx.window = ctx;
  Object.assign(ctx, extra || {});
  vm.createContext(ctx);
  vm.runInContext(read('notify.js'), ctx, { filename: 'notify.js' });
  return ctx;
}

console.log('\n── 어느 시간을 쓰는가 ──');

const N = loadNotify();

chk('호수 하나짜리 작업은 그 시간을 쓴다', () => {
  const w = { units: [{ customer: { startTime: '14:00' } }] };
  same('14:00', N.Notify._startTimeOf(w), '시간을 잘못 골랐습니다');
  return '14:00';
});

chk('☠️ 0 을 안 채운 시간도 이른 것부터 고른다', () => {
  /* '9:00' 과 '13:00' — 글자로 견주면 13 이 먼저 온다. 그게 예전 버그다 */
  const w = { units: [{ customer: { startTime: '13:00' } }, { customer: { startTime: '9:00' } }] };
  same('09:00', N.Notify._startTimeOf(w), '늦은 시간을 골랐습니다 (글자 정렬 버그)');
  return '09:00';
});

chk('0 을 채운 시간끼리도 이른 것부터', () => {
  const w = { units: [{ customer: { startTime: '15:30' } }, { customer: { startTime: '08:20' } }] };
  same('08:20', N.Notify._startTimeOf(w), '이른 시간을 못 골랐습니다');
  return '08:20';
});

chk('공용시설은 facilityCustomer 의 시간을 쓴다', () => {
  const w = { workType: 'facility', facilityCustomer: { startTime: '7:5' }, units: [{ customer: { startTime: '18:00' } }] };
  same('07:05', N.Notify._startTimeOf(w), '공용시설 시간을 못 읽었습니다');
  return '07:05';
});

chk('시간이 하나도 없으면 빈 값 (알람을 안 건다)', () => {
  same('', N.Notify._startTimeOf({ units: [{ customer: {} }] }), '없는 시간을 만들어 냈습니다');
  return '빈 값';
});

console.log('\n── 공유 일정에서 고친 시간 ──');

chk('☠️ 고친 시간(오버라이드)이 units 의 옛 시간을 이긴다', () => {
  /* 공유 일정의 시간을 고치면 서버 쪽 오버라이드에만 들어간다.
     달력은 그걸 보고 새 시간을 그리는데 알람이 안 보면 옛 시간에 울린다. */
  const M = loadNotify({
    CloudShare: { getOverride: (k) => (k === 'w1' ? { startTime: '16:00' } : null) }
  });
  const w = { folderName: 'w1', units: [{ customer: { startTime: '09:00' } }] };
  same('16:00', M.Notify._startTimeOf(w), '화면은 16:00 인데 알람은 옛 시간을 씁니다');
  return '16:00';
});

chk('오버라이드가 없으면 units 의 시간을 그대로 쓴다', () => {
  const M = loadNotify({ CloudShare: { getOverride: () => null } });
  same('09:00', M.Notify._startTimeOf({ folderName: 'w1', units: [{ customer: { startTime: '09:00' } }] }),
       '오버라이드가 없는데 값이 바뀌었습니다');
  return '09:00';
});

chk('오버라이드를 읽다 터져도 알람은 계속 걸린다', () => {
  const M = loadNotify({ CloudShare: { getOverride: () => { throw new Error('서버 오류'); } } });
  same('09:00', M.Notify._startTimeOf({ folderName: 'w1', units: [{ customer: { startTime: '09:00' } }] }),
       '오버라이드 오류가 알람을 통째로 막습니다');
  return '버팀';
});

chk('달력과 같은 순서로 본다 (오버라이드 → 공용시설 → 호수)', () => {
  /* calendar.js _workStart 와 순서가 어긋나면 화면과 알람이 다른 시간을 가리킨다 */
  const cal = fs.readFileSync(path.join(JS, 'calendar.js'), 'utf8');
  const at = cal.indexOf('function _workStart(');
  must(at > 0, 'calendar.js 에서 _workStart 를 못 찾았습니다');
  const b = cal.slice(at, at + 400);
  const calOrder = [/_ovOf\(w\)/, /_isFacW\(w\)/, /w\.units/].map((re) => re.test(b));
  must(calOrder.every(Boolean), '달력 쪽 순서가 바뀌었습니다 — 알람 쪽도 같이 봐야 합니다');
  const nj = read('notify.js');
  const at2 = nj.indexOf('function startTimeOf(');
  must(at2 > 0, 'startTimeOf 를 못 찾았습니다');
  const b2 = nj.slice(at2, at2 + 500);
  must(b2.indexOf('overrideOf(w)') >= 0, '알람이 오버라이드를 안 봅니다');
  must(b2.indexOf('overrideOf(w)') < b2.indexOf('facilityCustomer'), '오버라이드를 나중에 봅니다 (달력과 순서가 다름)');
  must(b2.indexOf('facilityCustomer') < b2.indexOf('w.units'), '공용시설보다 호수를 먼저 봅니다');
  return '같은 순서';
});

console.log('\n── 고친 뒤 다시 거는가 ──');

function after(file, anchor, span) {
  const s = fs.readFileSync(path.join(JS, file), 'utf8');
  const at = s.indexOf(anchor);
  must(at > 0, file + ' 에서 기준점을 못 찾았습니다: ' + anchor);
  return s.slice(at, at + (span || 900));
}

/* ☠️ 2026-09-21 여기서 한 번 속았다 —
      처음엔 'Notify.refresh' 라는 **글자**만 찾았는데, 바로 위 주석에 그 이름이
      적혀 있어서 **실제 호출을 지워도 시험이 통과했다.** 돌연변이로 들켰다.
      이름이 아니라 **부르는 모양**을 본다. 주석은 이 모양을 만들지 못한다. */
const CALL = /if \(window\.Notify && Notify\.refresh\)[\s\S]{0,120}Notify\.refresh\(\)/;

chk('☠️ 일정 시간을 고쳐 저장하면 알람을 다시 건다', () => {
  /* 여기가 빠져 있어서, 고치고 앱에 계속 머무르면 옛 알람이 그대로 남았다 */
  const b = after('calendar.js', "var ie = sessionToIndexEntry(w.folderName || newName, sess);", 700);
  must(CALL.test(b), '고친 뒤 Notify.refresh() 를 안 부릅니다 (주석만 있고 호출이 없습니다)');
  return '부름';
});

chk('일정을 새로 만들어도 알람을 건다', () => {
  const b = after('calendar.js', "var ie = sessionToIndexEntry(folderName, sessionData);", 700);
  must(CALL.test(b), '새 일정 뒤 Notify.refresh() 를 안 부릅니다');
  return '부름';
});

chk('작업을 저장해도 알람을 다시 건다 (원래 있던 것)', () => {
  const s = fs.readFileSync(path.join(JS, 'dialogs.js'), 'utf8');
  must(CALL.test(s), 'dialogs.js 에서 Notify.refresh() 호출이 사라졌습니다');
  return '있음';
});

chk('네이버에서 가져온 일정도 알람을 건다', () => {
  const s = fs.readFileSync(path.join(JS, 'naver_import.js'), 'utf8');
  must(CALL.test(s), '가져오기 뒤 Notify.refresh() 를 안 부릅니다');
  return '부름';
});

chk('다시 걸 때는 걸려 있던 것을 먼저 전부 취소한다', () => {
  /* 취소를 건너뛰면 옛 시간 알람과 새 알람이 **둘 다** 울린다 */
  const s = read('notify.js');
  const at = s.indexOf('// 3) 기존 예약 전부 취소');
  must(at > 0, '취소 단계를 못 찾았습니다');
  const b = s.slice(at, at + 400);
  must(/ln\.cancel\(/.test(b), '취소를 안 합니다');
  must(s.indexOf('ln.cancel(') < s.indexOf('ln.schedule('), '새로 걸고 나서 취소합니다 (순서가 거꾸로)');
  return '취소 먼저';
});

chk('서명에 시각이 들어간다 (시간만 바뀌어도 다시 건다)', () => {
  /* 서명이 같으면 재예약을 건너뛴다. 시각이 빠지면 시간을 바꿔도 안 걸린다 */
  const s = read('notify.js');
  const at = s.indexOf('var sig =');
  must(at > 0, '서명 만드는 자리를 못 찾았습니다');
  const b = s.slice(at, at + 300);
  must(/\+ \(\+j\.schedule\.at\)/.test(b), '서명에 알람 시각이 없습니다 — 시간을 바꿔도 안 다시 걸립니다');
  return '들어 있음';
});

console.log('');
if (fails.length) {
  console.log('❌ ' + fails.length + '개 실패\n');
  fails.forEach((f) => console.log('  · ' + f));
  process.exit(1);
}
console.log('✅ 전부 통과 (' + pass + '개)\n');
