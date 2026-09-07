/* ═══════════════════════════════════════════════════════════
   tools/test-popup-policy.js
   팝업으로 알리는 정보를 최소한으로 유지한다 (2026-09-07 사용자 지시)
   ----------------------------------------------------------------
   사용자 말: "폰에 뜨는 알림은 최소한으로 줄여야해. 사용자는 너무 많은 정보를
   알 필요가 없어. 정보제공을 최소화하는 방향으로 팝업 체계를 수정해줘."

   정한 기준:
     ① 성공을 alert 모달로 알리지 않는다 — 화면을 막고 눌러야 사라진다.
        오래 걸리는 일(백업·복원)은 '끝났다'는 토스트 한 줄까지만.
     ② 건수·용량·절감률처럼 사용자가 그걸로 할 일이 없는 숫자를 보여주지 않는다.
     ③ 화면을 보면 아는 것(삭제·순서변경·저장·새 작업)은 알리지 않는다.
     ④ 방금 고른 설정값을 되읽어 주지 않는다.
     실패(err)와 확인창(confirm)은 손대지 않는다 — 사용자가 뭔가 해야 하는 것들이다.

   ☠️ 이 검사는 '슬금슬금 다시 늘어나는 것'을 막으려고 있다.
      새 기능을 만들 때 성공 토스트를 습관적으로 붙이기 쉬운데, 그때 여기서 걸린다.
      기준을 바꾸기로 했다면 아래 상한을 같이 올릴 것 — 조용히 넘기지 말 것.
═══════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path'), glob = require('fs');
const JS = path.join(__dirname, '..', 'www', 'js');

let fails = 0, oks = 0;
function chk(name, fn) {
  try { const r = fn(); console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; }
  catch (e) { console.log('  ❌ ' + name + ' — ' + e.message); fails++; }
}
const must = (c, m) => { if (!c) throw new Error(m); };

/* 주석을 뺀 실제 호출만 센다 */
function scan() {
  const out = { toastOk: [], toastErr: [], alert: [], confirm: [] };
  for (const f of fs.readdirSync(JS)) {
    if (!f.endsWith('.js') || f.endsWith('.min.js')) continue;
    fs.readFileSync(path.join(JS, f), 'utf8').split('\n').forEach((l, i) => {
      const s = l.trim();
      if (s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')) return;
      const at = { f, n: i + 1, t: s };
      if (/showToast\s*\(/.test(l)) {
        if (/,\s*'err'\s*\)/.test(s)) out.toastErr.push(at);
        else if (/,\s*'ok'\s*\)/.test(s)) out.toastOk.push(at);
      } else if (/(?<![\w.])alert\s*\(/.test(l)) out.alert.push(at);
      else if (/(?<![\w.])confirm\s*\(/.test(l)) out.confirm.push(at);
    });
  }
  return out;
}
const P = scan();

console.log('\n[1] 총량 — 2026-09-07 정리 시점 기준으로 다시 늘지 않았는가');

chk('성공 토스트 상한', () => {
  const MAX = 70;                       // 정리 직후 62건
  must(P.toastOk.length <= MAX,
       '성공 토스트가 ' + P.toastOk.length + '건 (상한 ' + MAX + ') — 새로 붙인 걸 다시 보세요');
  return P.toastOk.length + '건 / 상한 ' + MAX;
});

chk('alert 모달 상한', () => {
  const MAX = 32;                       // 정리 직후 29건. 남은 건 대부분 '막다른 길' 안내다
  must(P.alert.length <= MAX, 'alert 가 ' + P.alert.length + '건 (상한 ' + MAX + ')');
  return P.alert.length + '건 / 상한 ' + MAX;
});

chk('실패 알림은 줄이지 않았다', () => {
  must(P.toastErr.length >= 150,
       '실패 토스트가 ' + P.toastErr.length + '건으로 줄었다 — 실패는 사용자가 다시 해야 하므로 남겨야 한다');
  return P.toastErr.length + '건 그대로';
});

console.log('\n[2] 되돌아오면 안 되는 것들');

chk('백업·복원 완료를 alert 로 알리지 않는다', () => {
  const bad = P.alert.filter(a => /복원 완료|백업 완료|저장 완료|재생성 완료/.test(a.t));
  must(!bad.length, '성공 alert 가 되살아났다: ' + bad.map(b => b.f + ':' + b.n).join(', '));
  return '없음';
});

chk('설정·리마인더 복원 건수를 알리지 않는다', () => {
  const s = fs.readFileSync(path.join(JS, 'backup.js'), 'utf8') +
            fs.readFileSync(path.join(JS, 'appdata_backup.js'), 'utf8');
  must(!/showToast\([^)]*리마인더 ' \+/.test(s), '리마인더 건수 토스트가 되살아났다');
  must(!/showToast\([^)]*설정 · 지침[^)]*건/.test(s), '설정 건수 토스트가 되살아났다');
  return '없음';
});

chk('사진 용량·절감률을 보여주지 않는다', () => {
  const s = fs.readFileSync(path.join(JS, 'events.js'), 'utf8');
  must(!/showToast\([^)]*절감/.test(s), '용량 절감률 토스트가 되살아났다');
  return '없음';
});

chk('설정을 바꿀 때 고른 값을 되읽지 않는다', () => {
  const s = fs.readFileSync(path.join(JS, 'settings.js'), 'utf8');
  const bad = ['✓ 사진 해상도:', '✓ 보고서 해상도:', '테마 변경됨'].filter(k => s.includes(k));
  must(!bad.length, '설정 확인 토스트가 되살아났다: ' + bad.join(', '));
  return '없음';
});

console.log('\n[3] 남겨 둔 것 — 지우면 안 되는 자리');

chk('확인창(confirm)은 그대로 둔다', () => {
  must(P.confirm.length >= 70,
       '확인창이 ' + P.confirm.length + '건으로 줄었다 — 되돌릴 수 없는 일은 물어봐야 한다');
  return P.confirm.length + '건';
});

chk('오래 걸리는 일은 끝났다는 신호를 남긴다', () => {
  const b = fs.readFileSync(path.join(JS, 'backup.js'), 'utf8');
  must(/_toast\('백업했습니다'/.test(b), '백업 완료 신호가 사라졌다');
  must(/복원했습니다/.test(b), '복원 완료 신호가 사라졌다');
  return '백업 · 복원';
});

console.log('\n' + (fails ? '❌ 실패 ' + fails + '건 / ' : '✅ ') + '통과 ' + oks + '건');
process.exit(fails ? 1 : 0);
