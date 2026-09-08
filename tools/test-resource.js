/* ═══════════════════════════════════════════════════════════
   tools/test-resource.js
   조용히 새던 요금·전력을 다시 새게 만들지 않는가
   ----------------------------------------------------------------
   2026-09-08 리소스 전수 점검에서 찾아 고친 것들을 지킨다.

   ☠️ 이 항목들의 공통점: **없어져도 오류가 안 난다.** 앱은 멀쩡히 돌고
      요금 고지서에만 나타난다. 그래서 눈으로는 영영 못 잡는다.

   고친 것 (요약)
     ① '접속중' 표시 폐지 — 50초마다 users/{uid} write, 그 문서를 파트너 전원이
        구독, 게다가 업종 아이콘 최대 300KB 동거. 사람 수만큼 곱해지던 유일한 항목.
     ② 저장 1회당 사진 컬렉션 2회 통째 읽기 → 1회 (사진 100장이면 저장당 200→100)
     ③ cleanupAccounts 가 매일 users 전체 스캔 → 대상 후보만 (하루 사용자 수만큼 → 수십)
     ④ config/app 을 앱 실행마다 2번 읽음 → 1번 (DAU × 2 → × 1)
     ⑤ AI 요청에 중단·시간제한 없음 → 화면을 닫아도 끝까지 과금되던 것 차단
     ⑥ 교정 예시 원문을 안 잘라 매 호출 실어 보냄 → 1,200자
     ⑦ 앱 켤 때마다 푸시 토큰 write / 복귀 때마다 shares·teams 중복 읽기 → 제거
═══════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'www', 'js');

let fails = 0, oks = 0;
function chk(name, fn) {
  try { const r = fn(); console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; }
  catch (e) { console.log('  ❌ ' + name + ' — ' + e.message); fails++; }
}
const must = (c, m) => { if (!c) throw new Error(m); };
const read = (f) => fs.readFileSync(path.join(JS, f), 'utf8');
const fnSrc = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
/* ☠️ '없어야 한다' 를 볼 때는 주석을 걷어내고 본다.
     여기 고친 것들은 **왜 뺐는지를 주석에 길게 적어 두는 게 핵심**이라(되살아나기 쉬운 종류다),
     주석까지 세면 지운 코드가 그대로 남아 있는 것처럼 보인다. */
const strip = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = (f) => strip(read(f));

console.log('\n[1] 사람 수만큼 곱해지던 것 — 접속중 표시');

chk('50초 심박이 되살아나지 않았다', () => {
  const s = code('cloud_chat.js');
  must(!/HEARTBEAT_MS/.test(s), '심박 주기 상수가 되살아났습니다');
  must(!/startHeartbeat/.test(s), '심박 타이머가 되살아났습니다');
  must(!/lastActive:\s*firebase/.test(s), 'users 문서에 lastActive 를 다시 쓰고 있습니다');
  return '없음';
});

chk('접속중을 보려고 users 문서를 읽지 않는다', () => {
  const s = code('cloud_chat.js');
  must(!/function subscribePresence/.test(s), 'presence 구독이 되살아났습니다');
  must(!/function pollPresence/.test(s), 'presence 폴링이 되살아났습니다');
  must(!/function isOnline/.test(s), '접속중 판정이 되살아났습니다');
  must(!/🟢/.test(s), '참가자 줄에 접속중 표시가 되살아났습니다');
  return '구독·폴링·표시 모두 없음';
});

chk('되살릴 때 지켜야 할 조건을 코드에 남겼다', () => {
  /* 이 사고는 '좋아 보여서' 다시 넣기 쉽다 — 왜 뺐는지와 어떻게 넣어야 하는지를 남겨 둔다 */
  const s = read('cloud_chat.js');
  must(/되살리지 말 것/.test(s), '왜 뺐는지 기록이 없습니다');
  must(/아무도 구독하지 않는/.test(s), '다시 넣을 때의 조건이 안 적혀 있습니다');
  return '기록 있음';
});

console.log('\n[2] 저장할 때마다 나가던 읽기');

chk('사진 컬렉션을 저장 1회에 한 번만 읽는다', () => {
  const s = code('cloud_photo_sync.js');
  const at = s.indexOf('async function _autoUploadPhotosInner');
  const end = s.indexOf('\n  }', s.indexOf('pushPhotoOrder(workId, units)'));
  const blk = s.slice(at, end);
  const n = (blk.match(/itemPhotosCol\(workId\)\.get\(\)/g) || []).length;
  must(n === 1, '저장 경로에서 사진 컬렉션을 ' + n + '번 읽습니다 (1번이어야 합니다)');
  must(/_uploadedNames/.test(blk), '방금 올린 문서 이름을 모으지 않습니다 — 두 번째 읽기가 필요해집니다');
  return '1회';
});

chk('업로드가 올린 문서 이름을 돌려준다', () => {
  const s = read('cloud_photo_sync.js');
  const at = s.indexOf('async function uploadOnePhoto');
  const blk = s.slice(at, at + 2600);
  must(/return cloudName;/.test(blk), '업로드가 이름을 안 돌려줍니다');
  /* 호출부는 filter(Boolean) 로 개수를 센다 — 빈 문자열을 돌려주면 개수가 틀어진다 */
  must(!/return '';/.test(blk), '빈 문자열을 돌려주면 업로드 개수가 틀어집니다');
  return 'cloudName';
});

console.log('\n[3] 서버가 아무 일 없이 쓰는 요금');

chk('매일 도는 정리가 사용자 전체를 훑지 않는다', () => {
  const bare = strip(fnSrc);
  const at = bare.indexOf('exports.cleanupAccounts');
  const blk = bare.slice(at, at + 4000);
  must(!/db\.collection\('users'\)\.get\(\)/.test(blk),
       'users 컬렉션을 통째로 읽습니다 — 사용자 수만큼 매일 과금됩니다');
  must(/orderBy\('deletionRequestedAt'\)/.test(blk), '삭제 요청 후보를 안 고릅니다');
  must(/where\('subscriptionEndedAt', '<=', subCutoff\)/.test(blk), '구독 종료 후보를 안 고릅니다');
  must(/CAND_LIMIT/.test(blk), '후보 조회에 상한이 없습니다');
  return '후보만 조회';
});

chk('앱을 켤 때 config/app 을 한 번만 읽는다', () => {
  const files = ['version_gate.js', 'notice.js'];
  files.forEach(f => {
    must(!/collection\('config'\)\.doc\('app'\)/.test(code(f)),
         f + ' 가 config/app 을 직접 읽습니다 — Cloud.appConfig 를 쓰세요');
    must(/Cloud\.appConfig\(\)/.test(read(f)), f + ' 가 공용 읽기를 안 씁니다');
  });
  const c = read('cloud.js');
  must(/Cloud\.appConfig = function/.test(c), '공용 읽기가 없습니다');
  must(/_appCfgP = null;\s*throw e;/.test(c) || /_appCfgP = null; throw e/.test(c),
       '실패까지 캐시하면 그 실행 내내 공지가 영영 안 뜹니다');
  return '한 번 + 실패는 캐시 안 함';
});

chk('앱을 켤 때마다 푸시 토큰을 다시 쓰지 않는다', () => {
  const s = read('push.js');
  must(/ac_push_token_pushed/.test(s), '이미 올린 토큰인지 확인하지 않습니다');
  const at = s.indexOf('function saveToken');
  const blk = s.slice(at, at + 900);
  must(blk.indexOf('localStorage.getItem') < blk.indexOf('.set('),
       '쓰기 전에 확인하지 않습니다');
  must(/removeItem\(TOK_KEY\)/.test(s), '실패했을 때 표시를 안 지우면 다시는 안 올라갑니다');
  return '같으면 건너뜀';
});

chk('앱에 돌아올 때마다 같은 목록을 두 번 읽지 않는다', () => {
  const sh = code('cloud_share.js');
  const at = sh.indexOf('function subscribeShares');
  must(!/pullShares\(\);/.test(sh.slice(at, at + 700)),
       '구독 직전에 같은 쿼리를 또 읽습니다');
  const tm = code('teams.js');
  const at2 = tm.indexOf('function subscribe()');
  must(!/\bpull\(\);/.test(tm.slice(at2, at2 + 700)),
       'teams 도 구독 직전에 같은 쿼리를 또 읽습니다');
  return 'shares · teams';
});

console.log('\n[4] AI 호출에서 버려지던 요금');

chk('요청에 중단·시간제한이 걸려 있다', () => {
  const s = read('ai.js');
  must(/new AbortController\(\)/.test(s), '중단 장치가 없습니다 — 화면을 닫아도 끝까지 과금됩니다');
  must(/signal: ctl \? ctl\.signal : undefined/.test(s), 'fetch 에 signal 을 안 넘깁니다');
  const m = s.match(/var AI_TIMEOUT_MS = (\d+);/);
  must(m, '시간제한이 없습니다');
  must(+m[1] >= 30000 && +m[1] <= 180000, '시간제한이 이상합니다: ' + m[1] + 'ms');
  must(/ClaudeAI\.cancel = function/.test(s), '취소 함수가 없습니다');
  return (+m[1] / 1000) + '초';
});

chk('글이 잘렸는지 확인하고 알려 준다', () => {
  const s = read('ai.js');
  must(/stop_reason === 'max_tokens'/.test(s), '잘림을 확인하지 않습니다 — 통째로 재생성하게 됩니다');
  must(/ClaudeAI\.wasTruncated/.test(s), '부르는 쪽이 알 방법이 없습니다');
  must(/뒷부분이 잘렸습니다/.test(s), '사용자에게 안 알려 줍니다');
  return '확인 + 안내';
});

chk('교정 예시를 자르지 않고 실어 보내지 않는다', () => {
  const s = read('ai.js');
  const m = s.match(/var SHOT_MAX = (\d+);/);
  must(m, '예시 길이 상한이 없습니다');
  must(+m[1] > 0 && +m[1] <= 2000, '상한이 이상합니다: ' + m[1]);
  must(/JSON\.stringify\(String\(c\.in \|\| ''\)\.slice\(0, SHOT_MAX\)\)/.test(s),
       '일정 교정 예시를 안 자릅니다');
  const q = s.indexOf('function buildQuoteFewShot');
  const qb = s.slice(q, q + 900);
  must((qb.match(/slice\(0, SHOT_MAX\)/g) || []).length === 2,
       '견적 교정 예시(요청·결과)를 안 자릅니다');
  return m[1] + '자';
});

console.log(fails ? `\n❌ 실패 ${fails}건 / 통과 ${oks}건` : `\n✅ 통과 ${oks}건`);
process.exit(fails ? 1 : 0);
