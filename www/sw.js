// 서비스워커 v609 (앱 v3.2.8 · 2026-09-04) — 빌드 대기
//   ★ v609: release 빌드 minifyEnabled 켜기 (Play 콘솔 "난독화 4%" 경고 대응) +
//     버전 올림(3.2.7→3.2.8). www 쪽 코드 변경은 없음(네이티브/버전 표기만).
//   ★ v608: 관리자 저장소 섹션에 확인용 3줄 추가 (실기기에서 콘솔을 못 보니 앱이 대신 보여준다)
//     · 동기화 해시 — 옛 형식이 몇 건 남았는지 / 다른 계정(uid) 찌꺼기가 몇 건인지
//     · 마지막 동기화 — 스캔·변경 건수 + 옛 해시 교체 건수(마이그레이션 패스가 실제로 돈 증거)
//     · 인덱스 파일 — .tmp 찌꺼기가 실제로 사라졌는지 (Android/data 는 파일관리자로 못 연다)
//   ★ v607: 장기누적 1단계 — 저장/동기화 낭비 제거 (파생 데이터만 건드림, 원본 무관)
//     · work_index: .tmp 쓰기 제거 + .bak 은 '건수가 줄 때만' → 저장 시 쓰기량 1/3
//       (.tmp/.bak 을 읽는 코드는 원래 0곳이었다. 안드로이드는 base64 브리지라 낭비가 컸다)
//     · calendar: 월 캐시 상한 500KB×8개월 → 150KB×3개월 (localStorage 최대 4MB → 0.45MB)
//     · cloud_sync: 동기화 해시를 payload JSON 통째 → '길이:FNV-1a' 짧은 지문(작업당 300~800B → 10B)
//       ⚠️ 옛 값과 형식이 달라 그냥 바꾸면 전량 재업로드가 난다 → hashUnchanged() 마이그레이션
//          패스로 '내용 같으면 업로드 없이 값만 교체'. 업로드/읽기 동시 실행도 6건으로 제한
//   ★ v606: 저장소 진단(0단계) — diag_storage.js 신규. localStorage 쓰기 실패를 세고
//     인덱스 크기·전체본 최대 크기를 기록한다. 표시는 관리자 통계 화면에만(일반 사용자 화면 변화 0).
//   ★ v601: 로그인 성공 시 로그인 창이 자동으로 닫힘 (온보딩에서 '다음' 버튼이 가려지던 문제)
//   ★ v602: 서버 복구 — 로그인 후 복구가 이어서 진행됨
//   ★ v603: AI 무료횟수 로그인 유도도 마찬가지 — 하려던 작업이 이어서 진행됨
//   ★ v600 담긴 것: AI 프록시 인증(ai.js 가 Firebase ID 토큰을 보냄)
//     — 깃허브 공개 저장소에 PROXY_URL 이 그대로 있어 누구나 호출 가능하던 것을 막았다.
//     ⚠️ 앱만 올리면 안 된다. vercel-proxy 를 먼저 배포해야 순서가 맞는다.
//        (프록시 먼저 → 구버전 앱이 401 로 죽는다 / 앱 먼저 → 잠깐 열려 있을 뿐, 이쪽이 안전)
//   v599 (2026-08-27, versionCode 23 로 업로드됨) 이하 이력:
//   ⚠️ 이 줄의 v번호는 아래 CACHE 와 **반드시 같아야 한다.** 2026-08-26 에도 어긋나 있었다(주석 v584 / CACHE v586).
//   ⚠️ 3.2.1 의 whatsnew 를 안 띄웠으므로 NOTES['3.2.2'] 에는 3.2.1 내용도 같이 담을 것.
//   ⚠️ 이번 빌드는 `npx cap sync android` — 새 네이티브 플러그인(in-app-review)이 있어 cap copy 로는 부족하다.
//   담긴 것: v587 달력 숨김판정 1회 읽기 / v589~v593 블로그·SNS 올리기(모바일 공유·PC 링크·마커·사진 재사용)
//           v595 정확 알람 권한(SCHEDULE_EXACT_ALARM, 매니페스트 변경) / v596 팝업 뒤 스크롤 잠금(ov-lock)
//           v597 페이스북 올리기 버튼(채널 키 'fb'→'facebook') / v598 달력 보기 전환(▦격자 ↔ ☰목록)
//           v599 인앱 별점(review.js) + 설정 Play 리뷰 링크 + 격자에서도 위로 밀어 접기
//   site/ 쪽: post.html 사진 ZIP 내려받기 + 새 파일 site/jszip.min.js → `firebase deploy --only hosting` 필요
const CACHE = 'ac1004-v609';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // 1. 옛날 캐시 모두 삭제
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));

    // 2. 모든 클라이언트 즉시 제어
    await self.clients.claim();

    // 3. 모든 열린 탭/창에 새로고침 신호 전송
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    allClients.forEach(client => {
      client.postMessage({ type: 'SW_UPDATED', version: 'v116' });
    });
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // ★ 크로스 오리진(Firestore/Firebase 등)은 SW가 절대 건드리지 않음 → 브라우저 기본 처리
  //   (respondWith로 가로채면 Firestore 스트리밍 연결이 깨짐)
  if (url.origin !== self.location.origin) return;
  // GET 외(POST 등)도 가로채지 않음
  if (e.request.method !== 'GET') return;
  // 자체 리소스는 항상 네트워크 우선 (no-store: 브라우저 캐시도 무시)
  e.respondWith(
    fetch(e.request, { cache: 'no-store' }).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone)).catch(()=>{});
      return res;
    }).catch(() => caches.match(e.request).then(r => r || new Response('offline', { status: 503 })))
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (e.data && e.data.type === 'FORCE_REFRESH') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
});
