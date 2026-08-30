// 서비스워커 v227 - 1.273: 네이티브 전환 준비 - 사용자에게 불필요한 개발/진단 기능 제거. 설정에서 (1) 앱 캐시 초기화, (2) 작업기록 재생성, (3) 저장소 상태 진단, (4) 도움말 좌표 편집기, (5) 홈 화면에 앱 설치 버튼 + 힌트 제거. "초기 설정 다시 하기"만 유지. coord-editor.html 파일 삭제. 온보딩 설정 슬라이드의 도구모음 설명을 초기설정 다시하기로 교체
const CACHE = 'ac1004-v227';

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
  if (url.origin !== self.location.origin) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }
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
