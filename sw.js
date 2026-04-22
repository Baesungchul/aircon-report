const CACHE='ac1004-v4-' + Date.now();
self.addEventListener('install',e=>{self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.map(n=>caches.delete(n)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  // CSS, JS는 항상 네트워크에서 받기 (캐시 무시)
  const url = new URL(e.request.url);
  if(url.pathname.endsWith('.css') || url.pathname.endsWith('.js') || url.pathname.endsWith('.html')){
    e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
  } else {
    e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).catch(()=>new Response('offline'))));
  }
});
