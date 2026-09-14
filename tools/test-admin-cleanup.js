/* ═══════════════════════════════════════════════════════════
   tools/test-admin-cleanup.js
   계정 정리 작업이 무엇을 했는지 관리자 화면에서 보이는가
   ----------------------------------------------------------------
   ☠️ 계정 정리(cleanupAccounts)는 사용자의 사진·백업·Auth 계정까지 지운다.
      되돌릴 수 없다. 그래서 두 가지를 검사로 못 박는다.
        ① 판정(_isSubscribed)이 앱과 같은 기준인가 — 좁아지면 살아있는 사용자가 지워진다
        ② 무슨 일이 있었는지 관리자 화면에서 **빨간색으로** 보이는가 — 회색에 섞이면 못 본다
═══════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');

let fails = 0, oks = 0;
function chk(name, fn) {
  try { const r = fn(); console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; }
  catch (e) { console.log('  ❌ ' + name + ' — ' + e.message); fails++; }
}
const must = (c, m) => { if (!c) throw new Error(m); };
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const fn = strip(fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8'));
const ad = strip(fs.readFileSync(path.join(ROOT, 'www', 'js', 'admin_stats.js'), 'utf8'));

console.log('\n[1] 구독 판정이 앱과 같은 기준인가');

chk('_isSubscribed 가 plan 과 billingPlan 을 본다', () => {
  const i = fn.indexOf('function _isSubscribed');
  must(i > 0, '_isSubscribed 가 없습니다');
  const blk = fn.slice(i, i + 900);
  must(/billingPlan \|\| u\.plan/.test(blk),
       '관리자 수동 부여 플랜(plan)을 보지 않습니다 — 그 사용자가 6개월 뒤 계정째 지워집니다');
  must(/u\.admin === true/.test(blk), '관리자 계정을 보호하지 않습니다');
  return null;
});

chk('판정을 실제 값으로 확인', () => {
  /* 구현을 그대로 옮겨 확인한다 */
  const KEYS = { free: 1, lite: 1, basic: 1, pro: 1, master: 1 };
  const iss = (u, now) => {
    if (!u) return false;
    if (u.admin === true) return true;
    const p = u.billingPlan || u.plan || '';
    if (p && p !== 'free' && KEYS[p]) return true;
    if (u.subscriptionActive === true) {
      const e = (u.subscriptionExpiresAt && u.subscriptionExpiresAt.toMillis) ? u.subscriptionExpiresAt.toMillis() : 0;
      return e ? (now < e) : true;
    }
    return false;
  };
  const now = Date.now();
  const cases = [
    ['관리자 수동 플랜 + 옛 결제 이력', { plan: 'pro' }, true],
    ['결제 플랜', { billingPlan: 'basic' }, true],
    ['관리자 계정', { admin: true }, true],
    ['결제 플래그만', { subscriptionActive: true }, true],
    ['만료된 결제 플래그', { subscriptionActive: true, subscriptionExpiresAt: { toMillis: () => now - 1 } }, false],
    ['무료 + 해지 이력', { plan: 'free' }, false],
    ['빈 문서', {}, false],
    ['알 수 없는 플랜값', { plan: 'weird' }, false]
  ];
  cases.forEach(([n, u, exp]) => must(iss(u, now) === exp, n + ' 판정이 틀립니다'));
  return cases.length + '가지 경우';
});

console.log('\n[2] 지우기 전에 한 번 더 확인하는가');

chk('삭제 직전 문서를 다시 읽어 재판정한다', () => {
  const i = fn.indexOf('if (now >= deleteAtMs)');
  must(i > 0, '삭제 시점 분기를 찾을 수 없습니다');
  const blk = fn.slice(i, i + 1400);
  must(/doc\.ref\.get\(\)/.test(blk), '후보 목록의 사본만 보고 지웁니다');
  must(/_isSubscribed\(_fresh/.test(blk), '재확인에서 구독 판정을 다시 하지 않습니다');
  must(/continue;/.test(blk.slice(blk.indexOf('재확인 실패') >= 0 ? 0 : 0)),
       '재확인 실패 시 건너뛰지 않습니다');
  const f = blk.indexOf('catch'), p = blk.indexOf('_purgeAccount');
  must(f > 0 && f < p, '재확인 실패 처리가 삭제보다 뒤에 있습니다');
  return null;
});

chk('비상 정지 스위치가 삭제보다 앞에 있다', () => {
  must(/purgeDryRun/.test(fn), '드라이런 스위치가 없습니다');
  const i = fn.indexOf('if (_PURGE_DRY_RUN)');
  const p = fn.indexOf('_purgeAccount(db, uid); purged++; continue;\n      }');
  must(i > 0, '드라이런 분기가 없습니다');
  must(i < fn.lastIndexOf('await _purgeAccount(db, uid); purged++;'),
       '드라이런 검사가 삭제보다 뒤에 있습니다');
  return 'config/app 의 purgeDryRun';
});

console.log('\n[3] 관리자 화면에서 보이는가');

chk('실행 요약을 남긴다', () => {
  must(/collection\('admin'\)\.doc\('cleanupLast'\)/.test(fn), '요약을 기록하지 않습니다');
  const i = fn.indexOf("doc('cleanupLast')");
  const blk = fn.slice(i - 200, i + 600);
  must(/dryRun:/.test(blk) && /purged:/.test(blk) && /targets:/.test(blk),
       '요약에 모드·삭제수·대상 목록이 빠졌습니다');
  must(!/collection\('config'\)\.doc\('app'\)\.set/.test(blk),
       'config/app 은 누구나 읽을 수 있습니다 — 여기에 uid 를 쓰면 안 됩니다');
  return null;
});

chk('adminStats 가 그 요약을 내려준다', () => {
  const i = fn.indexOf('let cleanup = null');
  must(i > 0, 'adminStats 가 요약을 읽지 않습니다');
  must(/earnings, cleanup \}\)/.test(fn), '응답에 cleanup 이 없습니다');
  return null;
});

chk('문제 상태가 빨간색으로 표시된다', () => {
  must(/function bad\(txt\)/.test(ad), '빨간색 헬퍼가 없습니다');
  must(/#e5484d/.test(ad.slice(ad.indexOf('function bad('), ad.indexOf('function bad(') + 200)),
       'bad() 가 빨간색이 아닙니다');
  const i = ad.indexOf('계정 정리 (매일 04:00)');
  must(i > 0, '관리자 화면에 계정 정리 항목이 없습니다');
  const blk = ad.slice(i, i + 3400);
  /* 손봐야 할 상태는 전부 빨간색이어야 한다 */
  [['기록 없음', '한 번도 안 돌았을 때'],
   ['_stale', '오래 안 돌았을 때'],
   ['상한 500', '후보가 밀렸을 때'],
   ['_cu.purged ? bad(', '실제로 지워졌을 때'],
   ['지워질 뻔한 사람', '드라이런 대상이 있을 때']].forEach(([k, why]) => {
    must(blk.indexOf(k) > 0, why + ' 표시가 없습니다: ' + k);
  });
  must((blk.match(/bad\(/g) || []).length >= 5, '빨간색 표시가 너무 적습니다');
  return null;
});

chk('대상 목록에서 삭제·보류만 빨갛다', () => {
  const i = ad.indexOf('_isBad');
  must(i > 0, '항목별 강조 구분이 없습니다');
  const blk = ad.slice(i, i + 400);
  must(/'purged': 1/.test(blk) && /'dryRun': 1/.test(blk), '삭제·보류가 강조 대상이 아닙니다');
  must(!/'warned': 1/.test(blk), '경고까지 빨갛게 하면 진짜 문제가 묻힙니다');
  return null;
});

console.log('\n' + (fails ? '❌ ' + fails + '건 실패' : '✅ 전부 통과') + ' (' + oks + '건)');
process.exit(fails ? 1 : 0);
