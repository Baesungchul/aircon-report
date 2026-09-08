/* ═══════════════════════════════════════════════════════════
   tools/test-drag-safety.js
   손가락을 뗀 신호가 유실돼도 화면이 '중간에 굳지' 않는가
   ----------------------------------------------------------------
   사용자 신고 (2026-09-08):
     "사진 순서를 이동하다 보면 중간에 떠 있는 유령 이미지가 정말 가끔 생기고,
      가끔 달력을 옆으로 밀거나 아래로 내리는데 중간에 멈추는 경우도 있어.
      이런 경우가 안 생기게 예방할 수 있게 해줘"

   ☠️ 두 증상은 뿌리가 같다. 드래그하는 동안 화면은
        transition:none + 인라인 transform/height/opacity
      상태로 손가락을 따라간다. 이 상태를 풀어 주는 건 오직 '손 뗌' 신호다.
      그 신호가 안 오면(두 번째 손가락, OS 제스처 가로채기, 앱 내림, 전화 수신)
      화면은 그 중간값 그대로 굳는다.

   ☠️ 사진 쪽에는 원인이 하나 더 있었다 — 드래그 도중 renderAll 이 목록을
      innerHTML 로 다시 만들면 손에 쥔 썸네일이 화면에서 떨어져 나가고,
      그 옛 조각을 새 화면에 다시 끼우면서 같은 사진이 두 장 보였다.

   여기서 재는 것: '빠져나갈 구멍이 막혀 있는가'를 코드로 확인한다.
   ⚠️ 실제 터치 이벤트 유실은 단위 검사로 못 만든다 — 그래서 되돌리는 길이
      실제로 연결돼 있는지(호출 관계)를 본다. 눈으로만 고치면 또 새어 나간다.
═══════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path');
const JS = path.join(__dirname, '..', 'www', 'js');

let fails = 0, oks = 0;
function chk(name, fn) {
  try { const r = fn(); console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; }
  catch (e) { console.log('  ❌ ' + name + ' — ' + e.message); fails++; }
}
const must = (c, m) => { if (!c) throw new Error(m); };
const read = (f) => fs.readFileSync(path.join(JS, f), 'utf8');

const cal = read('calendar.js');
const ev  = read('events.js');
const rd  = read('render.js');

console.log('\n[1] 달력 — 밀다 만 화면이 굳지 않는가');

chk('되돌리기가 한 곳(restoreDrag)에 모여 있다', () => {
  /* 갈래(가로 2 · 펼치기 4 · 접기 5)마다 따로 적어 두면 새 갈래를 만들 때 하나를 빠뜨린다 */
  must(/function restoreDrag\(\)/.test(cal), 'restoreDrag 가 없습니다');
  const m = cal.match(/function restoreDrag\(\)[\s\S]*?\n      \}/);
  must(m, 'restoreDrag 본문을 못 찾았습니다 (검사 기준이 낡았습니다)');
  const b = m[0];
  must(/was === 2/.test(b) && /was === 4/.test(b) && /was === 5/.test(b),
       '되돌리기가 세 갈래(2·4·5)를 다 다루지 않습니다: ' + b.slice(0, 200));
  must(/mode = 0/.test(b), 'mode 를 0 으로 안 돌립니다 — 다음 손짓이 두 번 움직입니다');
  return '가로 · 펼치기 · 접기';
});

chk('두 번째 손가락이 닿아도 밀던 화면을 되돌린다', () => {
  /* 예전엔 onStart 가 mode 만 3(무시)으로 덮어써서, 밀리다 만 화면의 주인이 사라졌다 */
  const m = cal.match(/function onStart\(e\)[\s\S]*?\n      \}/);
  must(m, 'onStart 를 못 찾았습니다');
  must(/mode === 2 \|\| mode === 4 \|\| mode === 5[\s\S]{0,80}restoreDrag\(\)/.test(m[0]),
       '드래그 중 새 터치가 들어와도 되돌리지 않습니다 — 밀리다 만 채 굳습니다');
  return '되돌리고 무시';
});

chk('touchcancel 이 되돌리기로 이어진다', () => {
  must(/function onCancel\(\) \{ restoreDrag\(\); \}/.test(cal),
       'touchcancel 이 되돌리기와 끊겼습니다');
  must(/'touchcancel', onCancel/.test(cal), '격자에 touchcancel 이 안 걸려 있습니다');
  return '연결됨';
});

chk('손 뗌 신호가 아예 안 와도 스스로 풀린다 (워치독)', () => {
  /* 안드로이드에서 OS 가 제스처를 가져가면 touchend·touchcancel 이 둘 다 안 오는 기종이 있다 */
  must(/_dragWd|_armWd/.test(cal), '격자 드래그 워치독이 없습니다');
  const m = cal.match(/function _armWd\(\)[\s\S]*?\n      \}/);
  must(m, '_armWd 본문을 못 찾았습니다');
  must(/restoreDrag\(\)/.test(m[0]), '워치독이 화면을 되돌리지 않습니다');
  const ms = (m[0].match(/\}, (\d+)\)/) || [])[1];
  must(ms && +ms >= 3000 && +ms <= 8000, '워치독 시간이 이상합니다: ' + ms + 'ms');
  return ms + 'ms 뒤 자동 복구';
});

chk('앱을 내렸다 올려도 굳어 있지 않다', () => {
  must(/visibilitychange[\s\S]{0,200}__calRestoreDrag\(\)/.test(cal),
       '앱을 내릴 때 드래그를 안 되돌립니다 — touchend 가 유실됩니다');
  must(/function sweepStuck\(\)/.test(cal), '남은 흔적을 치우는 코드가 없습니다');
  const s = cal.match(/function sweepStuck\(\)[\s\S]*?\n      \}/);
  must(s && /_navAnimating/.test(s[0]),
       '달 이동 애니메이션 중에도 값을 지웁니다 — 정상 동작을 망칩니다');
  return '내릴 때 되돌리고 · 올릴 때 흔적 정리';
});

chk('달력을 여닫아도 감시자가 쌓이지 않는다', () => {
  /* renderCalendarShell 은 달력을 열 때마다 다시 돈다 — 그 안에서 창에 리스너를 걸면
     열 때마다 한 겹씩 쌓이고, 옛 겹은 이미 사라진 격자를 붙들고 있다(누수). */
  must(/__calDragGuardBound/.test(cal) && /__calPanelGuardBound/.test(cal),
       '창 리스너에 한 번만 걸리게 하는 자물쇠가 없습니다 — 열 때마다 쌓입니다');
  const n = (cal.match(/window\.addEventListener\('blur'/g) || []).length;
  must(n <= 1, "window blur 리스너를 여러 번 겁니다 (" + n + '개)');
  return '자물쇠 2개 · blur ' + n + '개';
});

chk('달 이동 애니메이션이 안 돌아도 제자리로 온다', () => {
  /* 화면이 꺼져 있으면 transition 이 아예 안 돈다 → 32% 밀린 투명한 달력이 남는다 */
  const m = cal.match(/outDone\.then\(function \(\)[\s\S]*?\n    \}\);/);
  must(m, '달 이동 애니메이션 코드를 못 찾았습니다');
  must(/IN \+ 400/.test(m[0]), '들어오는 애니메이션이 멈췄을 때의 안전망이 없습니다');
  must(/catch \(e\) \{[\s\S]{0,300}transform = 'none'/.test(m[0]),
       '새 달을 그리다 실패하면 밀려 나간 채로 남습니다');
  return '안전망 2겹 (타이머 · 예외)';
});

chk('하단 목록 스와이프도 같은 보호를 받는다', () => {
  const at = cal.indexOf('하단 상세목록 좌우 스와이프');
  must(at > 0, '하단 목록 스와이프 코드를 못 찾았습니다 (검사 기준이 낡았습니다)');
  const b = cal.slice(at, at + 4500);
  must(/_pArm|_pWd/.test(b), '하단 목록에 워치독이 없습니다');
  must(/mode === 2\) \{ mode = 0; _pClear\(\); snapBack\(\); mode = 3;/.test(b),
       '두 번째 손가락이 닿으면 밀리다 만 목록이 굳습니다');
  must(/try \{ _navDay\(dir\); \}/.test(b),
       '_navDay 가 던지면 목록이 투명한 채로 남습니다');
  return '워치독 · 두 손가락 · 예외';
});

console.log('\n[2] 사진 순서 — 유령 이미지가 남지 않는가');

chk('드래그 중에는 목록을 다시 그리지 않는다 (유령의 진짜 원인)', () => {
  must(/__riDragging[\s\S]{0,80}__riRenderPending[\s\S]{0,40}return/.test(rd),
       'renderAll 이 드래그 중에도 목록을 새로 만듭니다 — 손에 쥔 썸네일이 떨어져 나가 두 장이 됩니다');
  return '미뤘다가 끝나면 그린다';
});

chk('미뤄 둔 그리기가 반드시 되살아난다', () => {
  must(/function flushPendingRender\(\)/.test(ev), '미뤄 둔 그리기를 되살리는 코드가 없습니다');
  must(/flushPendingRender\(\)/.test(ev.slice(ev.indexOf('function end()'))),
       '드래그가 끝나도 미뤄 둔 그리기를 안 되살립니다 — 화면이 옛 데이터로 남습니다');
  must(/__riRenderPending[\s\S]{0,60}redraw\(\)/.test(ev.slice(ev.indexOf('function cancelDrag'))),
       '취소 경로에서 미뤄 둔 그리기가 사라집니다');
  return 'end · cancelDrag 두 길 모두';
});

chk('화면에서 떨어져 나온 썸네일로는 순서를 고치지 않는다', () => {
  must(/document\.body\.contains\(D\.wrap\)/.test(ev),
       '떨어져 나온 옛 조각을 그대로 다시 끼웁니다 — 같은 사진이 두 장 보입니다');
  const mv = ev.slice(ev.indexOf('function moveTo'), ev.indexOf('function moveTo') + 900);
  must(/contains\(D\.wrap\)\) \{ cancelDrag\(\); return; \}/.test(mv),
       '드래그 중 확인이 없습니다');
  const en = ev.slice(ev.indexOf('function end()'), ev.indexOf('function end()') + 1100);
  must(/contains\(D\.wrap\)\)/.test(en), '손 뗄 때 확인이 없습니다');
  return '끄는 중 · 놓을 때 두 곳';
});

chk('커밋이 실패해도 화면을 데이터에 맞춘다', () => {
  const en = ev.slice(ev.indexOf('function end()'), ev.indexOf('function end()') + 1400);
  must(/catch \(err\) \{[\s\S]{0,300}redraw\(\)/.test(en),
       '커밋이 던지면 옮겨 둔 DOM 이 그대로 남습니다 — 사진이 두 장인 것처럼 보입니다');
  return '재렌더로 복구';
});

chk('떠 있는 유령은 다음 터치에 반드시 사라진다 (마지막 그물)', () => {
  must(/function sweepGhosts\(\)/.test(ev), '유령 청소 함수가 없습니다');
  must(/addEventListener\('touchstart', function \(\) \{ if \(!D\) sweepGhosts\(\); \}/.test(ev),
       '화면을 다시 만졌을 때 유령을 걷어내지 않습니다');
  return '터치 · 마우스 두 경로';
});

chk('멈춘 드래그 워치독이 살아 있고 너무 늦지 않다', () => {
  const m = ev.match(/function _riArmWatchdog\(\)[\s\S]*?\}, (\d+)\);/);
  must(m, '사진 드래그 워치독이 없습니다');
  const ms = +m[1];
  must(ms >= 2500 && ms <= 5000, '워치독 시간이 이상합니다: ' + ms + 'ms (유령이 그만큼 떠 있습니다)');
  return ms + 'ms';
});

chk('취소·이탈 경로가 그대로 살아 있다', () => {
  ['pointercancel', 'blur', 'visibilitychange'].forEach(k => {
    must(new RegExp(k + "'[\\s\\S]{0,120}cancelDrag\\(\\)").test(ev),
         k + ' 에서 드래그를 안 치웁니다');
  });
  must(/'touchcancel', end/.test(ev), 'touchcancel 이 안 걸려 있습니다');
  return 'pointercancel · blur · visibilitychange · touchcancel';
});

console.log(fails ? `\n❌ 실패 ${fails}건 / 통과 ${oks}건` : `\n✅ 통과 ${oks}건`);
process.exit(fails ? 1 : 0);
