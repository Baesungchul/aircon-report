// 서비스워커 v57 - 1.103: 엑셀 share만 사용 (사용자가 앱 선택)
const CACHE = 'ac1004-v57';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }
  // 자체 리소스는 항상 네트워크 우선
  e.respondWith(
    fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone)).catch(()=>{});
      return res;
    }).catch(() => caches.match(e.request).then(r => r || new Response('offline', { status: 503 })))
  );
});
