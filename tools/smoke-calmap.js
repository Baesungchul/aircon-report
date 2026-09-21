/* ═══════════════════════════════════════════════════════════
   tools/smoke-calmap.js — 지도 두 화면을 진짜 브라우저에 올려 본다
   ----------------------------------------------------------------
   tools/test-calmap.js 는 소스를 읽어 규칙을 지키는지 본다(빠르고, 설치가 필요 없다).
   이 파일은 그 위층 — **실제로 그려지는지**를 본다. 카드가 몇 장 나오는지, 번호 표식이
   찍히는지, 버튼을 눌렀을 때 값이 제대로 넘어오는지, 콘솔에 오류가 나는지.

   ⚠️ npm test 에는 넣지 않았다 — playwright(브라우저)가 필요해서 설치가 무겁다.
      돌리려면:  npm i -D playwright && npx playwright install chromium && node tools/smoke-calmap.js
   ⚠️ 카카오 SDK 는 가짜로 끼운다. 키도 네트워크도 없이 **그리는 길**만 지나가게 하려는 것이다.
      진짜 지도가 뜨는지는 실기기에서 눈으로 볼 일이지, 여기서 잴 수 있는 게 아니다.
═══════════════════════════════════════════════════════════ */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'www');
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let fails = 0, oks = 0;
const ok = (n, x) => { console.log('  ' + (x ? '✅' : '❌') + ' ' + n); x ? oks++ : fails++; };

const FAKE_KAKAO = `
window.kakao = { maps: {
  load: f => f(),
  LatLng: function(a,b){ this.getLat=()=>a; this.getLng=()=>b; },
  LatLngBounds: function(){ this.extend=()=>{}; },
  Point: function(x,y){ this.x=x; this.y=y; },
  Map: function(box, o){ box.setAttribute('data-map','1'); this._box=box;
    this.setLevel=()=>{}; this.panTo=()=>{ window.__panned=(window.__panned||0)+1; };
    this.getCenter=()=>({getLat:()=>37,getLng:()=>127});
    /* 범위를 묻는 자리가 여기저기 있다(거리 표시 등). 가짜에도 범위는 있어야 한다.
       ⚠️ 2026-09-21 이전에는 겹친 선을 옆으로 미느라 m/px 를 여기서 구했다.
          지금은 선을 밀지 않으므로 이 값이 그림에 영향을 주지 않는다. */
    this.__span=0.05;
    this.setBounds=()=>{ this.__span=0.5; };
    window.__map=this;
    this.getBounds=()=>({ getSouthWest:()=>new kakao.maps.LatLng(37.0,127.0),
                          getNorthEast:()=>new kakao.maps.LatLng(37.0+this.__span,127.0+this.__span) });
    this.getProjection=()=>({coordsFromContainerPoint:()=>new kakao.maps.LatLng(37,127)}); },
  Marker: function(o){ window.__markers=(window.__markers||0)+1; this.setMap=()=>{}; },
  Polyline: function(o){ window.__poly=o; (window.__polys=window.__polys||[]).push(o);
    this.setMap=function(m){ if(m===null) o.__off=1; };
    /* 진짜 카카오 Polyline 에 있는 것은 가짜에도 둔다 — 가짜가 진짜보다 기능이
       적으면, 그 차이만큼 검사가 눈을 감는다(try/catch 에 먹혀 조용히 통과한다). */
    this.setPath=function(p){ o.path=p; o.__repathed=(o.__repathed||0)+1; };
    this.setOptions=function(x){ for(var k in x) o[k]=x[k]; o.__dimmed=1; }; },
  CustomOverlay: function(o){ window.__pins=(window.__pins||0)+1;
    var box = (o.map && o.map._box) || document.querySelector('#calMapBox');
    if(o.content && box) box.appendChild(o.content);
    this.setPosition=function(){}; this.setMap=function(){}; },
  InfoWindow: function(){ this.open=()=>{}; },
  event: { addListener: (t,e,f)=>{ (t.__h=t.__h||{})[e]=f; } },
  services: {
    Status: { OK:'OK', ZERO_RESULT:'ZERO' },
    Geocoder: function(){ return {
      /* ⚠️ 주소마다 좌표를 다르게 준다 — 다 같은 자리면 직선거리가 0 이 되어
         '거리를 못 적는 것'과 '0 이라 안 적는 것'이 구분되지 않는다(실제로 한 번 놓쳤다) */
      /* ⚠️ 이 덩어리는 **템플릿 문자열 안**이다. 정규식에 역슬래시를 쓰면 먹혀 버린다
         (\d 가 d 로 바뀐다 — 실제로 여기서 한 번 당했다). 역슬래시 없는 표현만 쓴다. */
      addressSearch:(q,cb)=> { var m=(String(q).replace(/[^0-9]/g,'').slice(-1)||'0');
        setTimeout(()=>cb(/비전동/.test(q)?[{y:String(37.0+(+m)*0.05),x:String(127.1+(+m)*0.05)}]:[], /비전동/.test(q)?'OK':'ZERO'),0); },
      coord2Address:(x,y,cb)=> setTimeout(()=>cb([{road_address:{address_name:'경기 평택시 테스트로 1'}}],'OK'),0) }; },
    Places: function(){ return {
      keywordSearch:(q,cb)=> setTimeout(()=>cb([{y:'37.1',x:'127.2',place_name:'테스트아파트',road_address_name:'경기 평택시 테스트로 2'}],'OK'),0) }; }
  }
}};`;

/* ── 가짜 위치 제공자 ──
   window.__geoMode 로 조종한다: 'ok' | 'deny' | 'none'
   ☠️ navigator.geolocation 은 읽기 전용이라 defineProperty 로 갈아끼운다. */
/* ── 가짜 localStorage ──
   ☠️ setContent 로 띄운 페이지는 출처(origin)가 없어 진짜 localStorage 를 읽으면
      SecurityError 가 난다. 앱 코드는 전부 try/catch 로 감싸 놨으므로 '조용히 저장 안 됨'
      으로 흘러가는데, 그러면 저장을 보는 검사가 **아무것도 안 보면서 통과**한다.
   → 메모리로 도는 것을 끼워 넣어 실제와 같은 길을 타게 한다. */
const FAKE_LS = `
(function(){ var m = {};
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: function(k){ return Object.prototype.hasOwnProperty.call(m,k) ? m[k] : null; },
    setItem: function(k,v){ m[k] = String(v); },
    removeItem: function(k){ delete m[k]; },
    clear: function(){ m = {}; },
    key: function(i){ return Object.keys(m)[i]; },
    get length(){ return Object.keys(m).length; }
  }});
})();`;

const FAKE_GEO = `
window.__geoMode = 'deny';
Object.defineProperty(navigator, 'geolocation', { configurable: true, get: function () {
  if (window.__geoMode === 'none') return undefined;
  return { getCurrentPosition: function (okcb, errcb) {
    window.__geoAsked = (window.__geoAsked || 0) + 1;
    if (window.__geoMode === 'ok') return setTimeout(function () {
      /* ⚠️ 주소 좌표와 겹치지 않는 자리로 둔다. 겹치면 직선거리가 0 이 되어
         '못 적는 것'과 '0 이라 안 적는 것'이 구분되지 않는다. */
      okcb({ coords: { latitude: 37.30, longitude: 127.40, accuracy: 10 } }); }, 0);
    setTimeout(function () { errcb({ code: 1 }); }, 0);
  } };
}});`;

(async () => {
  /* 환경에 따라 크로미움 위치가 다르다 — PW_CHROME 로 집어줄 수 있게 해 둔다 */
  const b = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
  const page = await b.newPage({ viewport: { width: 390, height: 780 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/Failed to load resource/.test(t)) errs.push('console: ' + t); });  /* 폰트(googleapis)는 이 검사망 밖이라 막힌다 — 앱 오류가 아니다 */

  await page.setContent(`<!doctype html><html><head><meta charset="utf-8">
    <style>${R('styles.css')}</style></head><body>
    <script>window.showToast=function(m,t){ (window.__toasts=window.__toasts||[]).push([m,t]); };<\/script>
    <script>${FAKE_KAKAO}<\/script>
    <script>${FAKE_LS}<\/script>
    <script>${FAKE_GEO}<\/script>
    <script>window.KAKAO_JS_KEY='FAKEKEY';window.KAKAO_ROUTE_URL='';<\/script>
    <script>${R('js/geocode.js')}<\/script>
    <script>${R('js/places.js')}<\/script>
    <script>${R('js/myloc.js')}<\/script>
    <script>${R('js/routing.js')}<\/script>
    <script>${R('js/cal_map.js')}<\/script>
    <script>${R('js/map_pick.js')}<\/script>
    <script>${R('js/link_actions.js')}<\/script>
    </body></html>`);

  console.log('\n[A] 그날 지도 시트');
  await page.evaluate(() => {
    CalMap.open('9월 17일 (목)', [
      { title: '비전동 그린아파트', sub: '벽걸이 2대', time: '09:00~11:00', addr: '평택시 비전동 1' },
      { title: '용이동 현장', sub: '스탠드 1대', time: '13:00', addr: '평택시 비전동 2' },
      { title: '주소 없는 작업', sub: '점검', time: '', addr: '' }
    ], { onEdit: (i) => { window.__edited = i; } });
  });
  ok('오버레이가 떴다', await page.locator('#calMapOverlay').count() === 1);
  ok('카드 3장이 그려졌다', await page.locator('.cm-card').count() === 3);
  ok('주소 없는 카드는 [주소 넣기] 를 준다', await page.locator('.cm-edit').count() === 1);
  ok('주소 있는 카드는 [길안내] 를 준다', await page.locator('.cm-nav').count() === 2);
  ok('머리줄 건수가 주소 있는 곳만 센다', (await page.locator('.cm-head-sub').innerText()).trim() === '2곳');

  await page.waitForTimeout(400);
  ok('지도가 그려졌다', await page.locator('#calMapBox[data-map="1"]').count() === 1);
  ok('번호 표식 2개가 찍혔다', await page.evaluate(() => window.__pins) === 2);
  ok('동선 선이 그어졌다', await page.evaluate(() => !!window.__poly));
  ok('선 색이 #RRGGBB 다', await page.evaluate(() => /^#[0-9a-f]{6}$/i.test(window.__poly.strokeColor)));
  ok('첫 카드가 골라져 있다', await page.locator('.cm-card.on').count() === 1);

  await page.locator('.cm-card[data-i="1"]').click();
  ok('카드를 누르면 그 카드가 골라진다', await page.locator('.cm-card[data-i="1"].on').count() === 1);
  await page.locator('.cm-pin').nth(0).click();
  ok('번호 표식을 누르면 카드가 따라온다', await page.locator('.cm-card[data-i="0"].on').count() === 1);

  await page.locator('.cm-edit').click();
  ok('[주소 넣기] 가 그 작업을 되돌려준다', await page.evaluate(() => window.__edited) === 2);
  ok('그때 시트가 닫힌다', await page.locator('#calMapOverlay').count() === 0);

  console.log('\n[A2] 내 위치 (2026-09-18)');
  /* ☠️ 규칙 하나 — 위치 때문에 지도가 망가지면 안 된다.
     거부한 사람의 화면이 예전과 똑같은지가 이 절의 핵심이다. */
  await page.evaluate(() => { window.__geoMode = 'deny'; window.__pins = 0; window.__polys = []; });
  await page.evaluate(() => CalMap.open('9월 18일 (금)', [
    { title: 'A', sub: '', time: '09:00', addr: '평택시 비전동 1' },
    { title: 'B', sub: '', time: '10:00', addr: '평택시 비전동 2' }]));
  await page.waitForTimeout(500);
  ok('위치를 거부해도 지도는 그려진다', await page.locator('#calMapBox[data-map="1"]').count() === 1);
  ok('그때 내 위치 점은 없다', await page.locator('.cm-me').count() === 0);
  ok('동선 선은 그대로 그어진다', await page.evaluate(() => (window.__polys || []).length) === 1);
  await page.evaluate(() => CalMap.close());

  /* 한 건짜리 날 — 예전엔 버튼 자체가 안 나왔다. 이제 내 위치에서 가는 길을 본다 */
  await page.evaluate(() => { window.__geoMode = 'ok'; window.__pins = 0; window.__polys = []; });
  await page.evaluate(() => { if (window.MyLoc) MyLoc.forget(); });
  await page.evaluate(() => CalMap.open('9월 18일 (금)', [
    { title: '한 곳뿐', sub: '', time: '09:00', addr: '평택시 비전동 1' }]));
  await page.waitForTimeout(500);
  ok('위치를 주면 내 위치 점이 찍힌다', await page.locator('.cm-me').count() === 1);
  ok('한 곳뿐이어도 내 위치에서 선을 긋는다', await page.evaluate(() => (window.__polys || []).length) === 1);
  ok('그 선은 두 점이다 (내 위치 → 그곳)', await page.evaluate(() => (window.__polys[0].path || []).length) === 2);
  ok('경로 API 가 꺼져 있으면 점선 그대로', await page.evaluate(() => window.__polys[0].strokeStyle) === 'shortdash');
  ok('머리줄에 내 위치 버튼이 있다', await page.locator('#calMapLoc').count() === 1);
  ok('내 위치 점이 화면 안에 있다', await page.evaluate(() => {
    const el = document.querySelector('.cm-me'); if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
  }));
  await page.evaluate(() => CalMap.close());

  /* 위치 기능이 아예 없는 기기(웹 미리보기 등) */
  await page.evaluate(() => { window.__geoMode = 'none'; });
  await page.evaluate(() => CalMap.open('9월 18일 (금)', [
    { title: 'A', sub: '', time: '09:00', addr: '평택시 비전동 1' }]));
  await page.waitForTimeout(400);
  ok('위치를 못 쓰면 버튼을 안 만든다', await page.locator('#calMapLoc').count() === 0);
  ok('그래도 지도는 그려진다', await page.locator('#calMapBox[data-map="1"]').count() === 1);
  await page.evaluate(() => CalMap.close());
  await page.evaluate(() => { window.__geoMode = 'deny'; });

  console.log('\n[A3] 직선 + 실제 경로를 같이 (2026-09-18)');
  /* 경로 서버를 가짜로 켠다. legs 는 구간별(내 위치→1번, 1번→2번) 주행거리다. */
  await page.evaluate(() => {
    window.KAKAO_ROUTE_URL = 'https://fake.example/route';
    window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({
      path: [[37.05,127.15],[37.0,127.1],[37.1,127.2]],
      paths: [[[37.05,127.15],[37.0,127.1]], [[37.0,127.1],[37.1,127.2]]],
      distance: 12000, duration: 1500,
      legs: [{ distance: 5000, duration: 600 }, { distance: 7000, duration: 900 }]
    }) });
    window.__geoMode = 'ok'; window.__polys = []; if (window.MyLoc) MyLoc.forget();
  });
  await page.evaluate(() => CalMap.open('9월 18일 (금)', [
    { title: 'A', sub: '', time: '09:00', addr: '평택시 비전동 1' },
    { title: 'B', sub: '', time: '13:00', addr: '평택시 비전동 2' }]));
  await page.waitForTimeout(700);
  /* ★ 2026-09-20 구간마다 따로 그린다 — 점선 2 + (흰테두리+색선) × 2 = 6 */
  ok('구간마다 점선을 하나씩 긋는다 (2구간)', await page.evaluate(() =>
    (window.__polys || []).filter(p => p.strokeStyle === 'shortdash').length) === 2);
  ok('점선을 지우지 않는다', await page.evaluate(() => !window.__polys[0].__off));
  ok('겹칠 땐 점선을 낮춘다', await page.evaluate(() => window.__polys[0].strokeOpacity) === 0.28);
  ok('구간마다 색이 다르다', await page.evaluate(() => {
    var d = window.__polys.filter(p => p.strokeStyle === 'shortdash').map(p => p.strokeColor);
    return d.length === 2 && d[0] !== d[1];
  }));
  ok('실제 경로는 흰 테두리 위에 진한 실선이다', await page.evaluate(() => {
    var sol = window.__polys.filter(p => p.strokeStyle === 'solid');
    var cas = sol.filter(p => p.strokeColor === '#ffffff' && p.strokeWeight === 8);
    var col = sol.filter(p => p.strokeColor !== '#ffffff' && p.strokeWeight === 5);
    return cas.length === 2 && col.length === 2 && col[0].strokeColor !== col[1].strokeColor;
  }));
  ok('선 색과 카드 색이 같다', await page.evaluate(() => {
    var col = window.__polys.filter(p => p.strokeStyle === 'solid' && p.strokeWeight === 5)
                            .map(p => p.strokeColor.toLowerCase());
    var c1 = document.querySelector('.cm-card[data-i="1"]');
    return !!c1 && col.indexOf((c1.style.getPropertyValue('--seg') || '').trim().toLowerCase()) >= 0;
  }));
  const d0 = (await page.locator('.cm-card-dist[data-i="0"]').innerText()).trim();
  ok('첫 카드에 직선·주행이 같이 나온다 (' + d0 + ')', /직선/.test(d0) && /주행/.test(d0));
  ok('첫 구간 주행이 5km · 10분 이다', /주행 5\.0km 10분/.test(d0));
  const d1 = (await page.locator('.cm-card-dist[data-i="1"]').innerText()).trim();
  ok('둘째 카드는 이전 작업에서의 거리다 (' + d1 + ')', /직선/.test(d1) && /주행 7\.0km/.test(d1));
  ok('머리줄에 총 주행거리·시간이 뜬다',
     /주행 12km/.test((await page.locator('#calMapHeadSub').innerText())));
  await page.evaluate(() => CalMap.close());

  /* ══ [A3-2] 되짚는 길을 한 선 위에 두 색으로 ══ 2026-09-21 사용자 요청
     ☠️ 2026-09-20 에는 겹치는 구간을 나란히 두 줄로 밀어서 그렸다. 지도가 지저분해져
        되돌렸다 — 이제 선은 **실제 길 위에 한 줄**이고, 겹침은 무늬로만 알린다.
        첫 구간이 바탕(실선), 같은 길을 또 쓰는 구간이 그 위에 점선.
     tools/test-segsplit.js 가 등수·토막 셈을 따로 재지만, 여기서는 **끝까지 이어 붙였을 때**
     실제로 그렇게 그려지는지를 본다 — 무늬를 고르는 대목이 중간에 있어서,
     거기서 새면 셈은 맞는데 화면에는 같은 무늬 두 개가 겹쳐 그려진다. */
  console.log('\n[A3-2] 되짚는 길을 한 선 위에 두 색으로 (2026-09-21)');
  await page.evaluate(() => {
    /* 2번 구간이 1번 구간을 그대로 되짚는다 */
    window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({
      path: [[37.00,127.00],[37.02,127.00],[37.00,127.00]],
      paths: [[[37.00,127.00],[37.02,127.00]], [[37.02,127.00],[37.00,127.00]]],
      distance: 4000, duration: 600,
      legs: [{ distance: 2000, duration: 300 }, { distance: 2000, duration: 300 }]
    }) });
    window.__geoMode = 'none'; window.__polys = []; if (window.MyLoc) MyLoc.forget();
  });
  /* ☠️ 마지막 일정이 **첫 일정과 같은 자리**다 — 그래야 갔다가 돌아오는 날이 된다.
     서로 다른 세 곳을 쓰면 직선(점선)은 애초에 안 겹쳐서, 점선 쪽 검사가
     '겹치는 게 없어서' 통과해 버린다(실제로 한 번 그렇게 써서 헛통과했다). */
  await page.evaluate(() => CalMap.open('9월 20일 (일)', [
    { title: 'A', sub: '', time: '09:00', addr: '평택시 비전동 1' },
    { title: 'B', sub: '', time: '11:00', addr: '평택시 비전동 2' },
    { title: 'A 다시', sub: '', time: '13:00', addr: '평택시 비전동 1' }]));
  await page.waitForTimeout(800);

  const over = await page.evaluate(() => {
    /* 가장 가까운 점끼리의 거리 — 0 에 가까우면 같은 자리다 */
    const near = (a, b) => {
      let min = Infinity;
      a.forEach(p => b.forEach(q => {
        const dy = (q.getLat() - p.getLat()) * 111320;
        const dx = (q.getLng() - p.getLng()) * 111320 * Math.cos(p.getLat() * Math.PI / 180);
        min = Math.min(min, Math.sqrt(dx * dx + dy * dy));
      }));
      return min;
    };
    const P = window.__polys || [];
    const col = P.filter(p => p.strokeWeight === 5);                  // 실선 경로(색)
    const cas = P.filter(p => p.strokeWeight === 8);                  // 흰 테두리
    const dash = P.filter(p => p.strokeWeight === 2 || p.strokeWeight === 3);  // 직선(점선)
    return {
      n: col.length,
      styles: col.map(p => p.strokeStyle),
      colors: col.map(p => p.strokeColor),
      far: col.length === 2 ? near(col[0].path, col[1].path) : -1,
      casing: cas.length,
      dashN: dash.length,
      dashStyles: dash.map(p => p.strokeStyle),
      dashFar: dash.length === 2 ? near(dash[0].path, dash[1].path) : -1,
      z: col.map(p => p.zIndex)
    };
  });
  ok('되짚는 구간도 선은 둘이다', over.n === 2);
  /* ☠️ 한 줄로 되돌린 게 이 개편의 핵심이다 — 옆으로 밀리면 안 된다 */
  ok('두 선이 같은 자리에 겹쳐 그려진다 (' + (over.far || 0).toFixed(2) + 'm)',
     over.far >= 0 && over.far < 0.5);
  ok('바탕은 실선, 되짚는 쪽은 점선이다 (' + over.styles.join(' / ') + ')',
     over.styles[0] === 'solid' && over.styles[1] !== 'solid');
  ok('두 선 색이 다르다', over.colors[0] !== over.colors[1]);
  /* ☠️ 흰 테두리를 덧줄 밑에도 깔면 아래 색을 덮어 버려, 점선 빈틈으로 비칠 게 없어진다 */
  ok('흰 테두리는 바탕에만 깔린다 (' + over.casing + '개)', over.casing === 1);
  ok('덧줄이 바탕보다 위에 온다', over.z[1] > over.z[0]);
  /* ☠️ 점선은 경로가 오기 전에 그려진다. 실선만 보면 점선 쪽이 빠져도 모른다 */
  ok('직선도 겹치는 구간은 무늬가 다르다 (' + over.dashStyles.join(' / ') + ')',
     over.dashN === 2 && over.dashStyles[0] !== over.dashStyles[1]);
  ok('직선도 같은 자리에 겹쳐 그려진다 (' + (over.dashFar || 0).toFixed(2) + 'm)',
     over.dashFar >= 0 && over.dashFar < 0.5);
  await page.evaluate(() => CalMap.close());

  /* ── 실선(실제 도로)이 **길 일부만** 겹칠 때 ──
     ☠️ 진짜 경로는 구간 전체가 똑같이 겹치는 일이 드물다. 큰길은 같이 타고
        끝에서 갈라진다. 위 검사는 '통째로 되짚는' 쉬운 경우라 여기서 한 번 더 본다:
        **겹치는 데만 점선이 되고, 갈라지는 데는 실선 그대로**여야 한다.
        길 전체를 점선으로 바꾸면 멀쩡한 외길이 '되짚은 길'로 읽힌다. */
  await page.evaluate(() => {
    window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({
      path: [[37.00,127.00],[37.01,127.00],[37.02,127.00],[37.03,127.01]],
      paths: [
        [[37.00,127.00],[37.01,127.00],[37.02,127.00]],          /* 아래→위 (큰길) */
        [[37.02,127.00],[37.01,127.00],[37.00,127.00],[37.00,127.02]]  /* 되짚다가 끝에서 갈라짐 */
      ],
      distance: 6000, duration: 900,
      legs: [{ distance: 3000, duration: 450 }, { distance: 3000, duration: 450 }]
    }) });
    window.__geoMode = 'none'; window.__polys = []; if (window.MyLoc) MyLoc.forget();
  });
  await page.evaluate(() => CalMap.open('9월 20일 (일)', [
    { title: 'A', sub: '', time: '09:00', addr: '평택시 비전동 1' },
    { title: 'B', sub: '', time: '11:00', addr: '평택시 비전동 2' },
    { title: 'C', sub: '', time: '13:00', addr: '평택시 비전동 3' }]));
  await page.waitForTimeout(800);

  const part = await page.evaluate(() => {
    const col = (window.__polys || []).filter(p => p.strokeWeight === 5);
    const last = (p) => p.path[p.path.length - 1];
    const dashed = col.filter(p => p.strokeStyle !== 'solid');
    const solid = col.filter(p => p.strokeStyle === 'solid');
    /* 갈라져 나가는 끝점이 제자리인가 — 좌표를 옮기지 않는다는 약속 */
    let endOk = false;
    solid.forEach(p => {
      const e = last(p);
      if (Math.abs(e.getLat() - 37.00) < 1e-9 && Math.abs(e.getLng() - 127.02) < 1e-9) endOk = true;
    });
    return { n: col.length, dash: dashed.length, solid: solid.length, endOk: endOk,
             dashPts: dashed.length ? dashed[0].path.length : 0 };
  });
  /* 1번 구간(실선 1) + 2번 구간이 겹치는 토막(점선) · 갈라지는 토막(실선) = 셋 */
  ok('겹치는 데서만 토막난다 (선 ' + part.n + '개)', part.n === 3);
  ok('겹치는 토막이 점선이 된다 (' + part.dash + '개)', part.dash === 1);
  ok('겹치는 토막이 겹친 만큼만이다 (점 ' + part.dashPts + '개)', part.dashPts === 3);
  ok('갈라지는 토막은 실선 그대로다 (' + part.solid + '개)', part.solid === 2);
  ok('갈라지는 끝이 제자리다 (좌표를 안 옮긴다)', part.endOk);
  await page.evaluate(() => CalMap.close());
  await page.evaluate(() => { window.__geoMode = 'ok'; if (window.MyLoc) MyLoc.forget(); });
  /* ☠️ 이 칸은 내 위치를 끄고 돌았다(구간 수를 2로 맞추려고).
     뒤 칸들은 내 위치가 있다고 보고 첫 카드의 직선거리를 잰다 — 되돌려 놓지 않으면
     **뒤 칸이 엉뚱하게 실패한다**(실제로 한 번 그랬다). 빌린 상태는 그 자리에서 갚는다. */
  await page.evaluate(() => { window.__geoMode = 'ok'; if (window.MyLoc) MyLoc.forget(); });

  /* 구간 수가 안 맞게 오면 주행은 안 적고 직선만 남아야 한다 */
  await page.evaluate(() => {
    window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({
      path: [[37.0,127.1],[37.1,127.2]], distance: 9000, duration: 900, legs: [] }) });
    window.__polys = []; if (window.MyLoc) MyLoc.forget();
  });
  await page.evaluate(() => CalMap.open('9월 18일 (금)', [
    { title: 'A', sub: '', time: '09:00', addr: '평택시 비전동 1' },
    { title: 'B', sub: '', time: '13:00', addr: '평택시 비전동 2' }]));
  await page.waitForTimeout(700);
  const d2 = (await page.locator('.cm-card-dist[data-i="0"]').innerText()).trim();
  ok('구간이 안 오면 주행은 비운다 (' + d2 + ')', /직선/.test(d2) && !/주행/.test(d2));
  await page.evaluate(() => CalMap.close());
  await page.evaluate(() => { window.KAKAO_ROUTE_URL = ''; window.__geoMode = 'deny'; });

  console.log('\n[A4] 내 장소 · 복귀 (2026-09-19)');
  await page.evaluate(() => {
    localStorage.clear && localStorage.clear();
    window.__geoMode = 'ok'; if (window.MyLoc) MyLoc.forget();
    window.__navUrl = null;
    /* 길안내는 실제로 앱 밖으로 나가므로 가로채서 어디로 보내려 했는지만 본다 */
    window.LinkActions = { nav: (a) => { window.__navUrl = a; } };
  });
  const DAY = [{ title: 'A', sub: '', time: '09:00', addr: '평택시 비전동 1' },
               { title: 'B', sub: '', time: '13:00', addr: '평택시 비전동 2' }];
  await page.evaluate((d) => CalMap.open('9월 19일 (금)', d), DAY);
  await page.waitForTimeout(400);
  ok('아직 등록 전이면 [집 등록] 으로 보인다',
     (await page.locator('.cm-chip[data-k="home"]').innerText()).trim() === '집 등록');
  ok('등록 전에는 복귀 칩이 없다', await page.locator('.cm-chip[data-ret]').count() === 0);
  ok('길게 누르기 안내가 보인다',
     /길게 누르면/.test(await page.locator('.cm-hint').innerText()));

  /* 등록 — 지도 찍기 대신 곧바로 값을 넣어 본다(등록 경로 자체는 map_pick 검사에서 본다) */
  await page.evaluate(() => { MyPlaces.set('home', '평택시 비전동 9'); CalMap._redraw(); });
  await page.waitForTimeout(400);
  ok('등록하면 칩이 [집] 으로 바뀐다',
     (await page.locator('.cm-chip[data-k="home"]').innerText()).trim() === '집');
  ok('등록한 곳만 복귀 칩이 생긴다 (집만 등록 → 1개)',
     await page.locator('.cm-chip[data-ret]').count() === 1);
  ok('그 칩은 [복귀 집] 이라고 적힌다',
     (await page.locator('.cm-chip[data-ret="home"]').innerText()).trim() === '복귀 집');

  await page.locator('.cm-chip[data-k="home"]').click();
  ok('칩을 누르면 바로 길안내로 간다 (' + await page.evaluate(() => window.__navUrl) + ')',
     await page.evaluate(() => window.__navUrl) === '평택시 비전동 9');

  ok('복귀는 처음엔 꺼져 있다', await page.evaluate(() => MyPlaces.returnTo()) === '');
  ok('그래서 카드는 작업 2장뿐', await page.locator('.cm-card').count() === 2);

  /* ☠️ 가짜 Polyline 은 다시 그려도 계속 쌓기만 한다. 비우지 않고 세면
     앞에서 그린 선까지 같이 세어 **아무 숫자나 맞아 버린다**(실제로 한 번 당했다). */
  await page.evaluate(() => { window.__polys = []; });
  await page.locator('.cm-chip[data-ret="home"]').click();
  await page.waitForTimeout(500);
  ok('누르면 그 칩이 켜진 표시가 된다',
     await page.locator('.cm-chip[data-ret="home"].on').count() === 1);
  ok('카드 끝에 복귀 카드가 붙는다', await page.locator('.cm-card').count() === 3);
  ok('복귀 카드에는 번호 대신 이름이 들어간다',
     (await page.locator('.cm-card[data-i="2"] .cm-num-place').innerText()).trim() === '집');
  ok('복귀 카드도 길안내를 준다', await page.locator('.cm-card[data-i="2"] .cm-nav').count() === 1);
  ok('복귀까지 구간이 하나 늘어난다 (내 위치+2곳+복귀 = 3구간)',
     await page.evaluate(() => (window.__polys || [])
       .filter(p => p.strokeStyle === 'shortdash').length) === 3);

  await page.locator('.cm-chip[data-ret="home"]').click();
  await page.waitForTimeout(400);
  ok('켜진 것을 다시 누르면 꺼진다',
     await page.locator('.cm-chip[data-ret="home"].on').count() === 0);
  ok('그러면 복귀 카드도 사라진다', await page.locator('.cm-card').count() === 2);

  /* ☠️ 돌아갈 곳은 하나다. 둘 다 켜지면 동선이 어디로 가는지 알 수 없다 */
  await page.evaluate(() => { MyPlaces.set('work', '평택시 비전동 7'); CalMap._redraw(); });
  await page.waitForTimeout(400);
  ok('둘 다 등록하면 복귀 칩도 둘', await page.locator('.cm-chip[data-ret]').count() === 2);
  await page.locator('.cm-chip[data-ret="home"]').click(); await page.waitForTimeout(400);
  await page.locator('.cm-chip[data-ret="work"]').click(); await page.waitForTimeout(400);
  ok('회사를 누르면 집이 꺼지고 회사만 켜진다',
     await page.locator('.cm-chip[data-ret="work"].on').count() === 1 &&
     await page.locator('.cm-chip[data-ret="home"].on').count() === 0);
  ok('복귀 카드도 회사로 바뀐다',
     (await page.locator('.cm-card[data-i="2"] .cm-num-place').innerText()).trim() === '회사');
  await page.locator('.cm-chip[data-ret="work"]').click(); await page.waitForTimeout(400);
  await page.evaluate(() => MyPlaces.set('work', ''));

  /* ☠️ 켰다 껐다를 반복해도 카드가 쌓이면 안 된다 —
     복귀 지점을 달력이 준 원본 배열에 밀어 넣으면 그렇게 된다(그리고 [주소 넣기]가
     엉뚱한 작업을 연다). 세 번 돌려 자리가 그대로인지 본다. */
  for (let i = 0; i < 3; i++) {
    await page.locator('.cm-chip[data-ret="home"]').click(); await page.waitForTimeout(300);
    await page.locator('.cm-chip[data-ret="home"]').click(); await page.waitForTimeout(300);
  }
  ok('복귀를 여러 번 켰다 꺼도 카드가 쌓이지 않는다', await page.locator('.cm-card').count() === 2);

  ok('칩 줄이 화면 안에 보인다', await page.evaluate(() => {
    const el = document.querySelector('.cm-places'); if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.height > 20 && r.top >= 0 && r.bottom <= window.innerHeight;
  }));

  /* 등록을 지우면 복귀도 같이 꺼져야 한다 — 안 그러면 '켜져 있는데 안 가는' 상태가 된다 */
  await page.evaluate(() => { MyPlaces.setReturnTo('home'); MyPlaces.set('home', ''); });
  ok('장소를 지우면 복귀도 꺼진다', await page.evaluate(() => MyPlaces.returnTo()) === '');
  await page.evaluate(() => CalMap.close());

  console.log('\n[B] 지도 키가 없을 때');
  await page.evaluate(() => { window.KAKAO_JS_KEY = 'TODO_KAKAO_JS_KEY'; });
  await page.evaluate(() => CalMap.open('9월 18일 (금)', [
    { title: 'A', sub: '', time: '09:00', addr: '평택시 비전동 1' },
    { title: 'B', sub: '', time: '10:00', addr: '평택시 비전동 2' }]));
  ok('시트는 열린다', await page.locator('#calMapOverlay').count() === 1);
  ok('길안내는 그대로 준다', await page.locator('.cm-nav').count() === 2);
  ok('지도 자리에 이유를 적는다', (await page.locator('.cm-msg').innerText()).includes('config_map.js'));
  await page.evaluate(() => CalMap.close());
  await page.evaluate(() => { window.KAKAO_JS_KEY = 'FAKEKEY'; });

  console.log('\n[C] 주소 찍기 시트 (2단계)');
  await page.evaluate(() => {
    MapPick.open('평택시 비전동 1', (addr) => { window.__picked = addr; },
      { title: '삼원빌딩', sub: '벽걸이 1대', time: '10:00~12:00' });
  });
  await page.waitForTimeout(400);
  ok('오버레이가 떴다', await page.locator('#mapPickOverlay').count() === 1);
  ok('주소칸 값이 검색어로 들어온다', await page.locator('#mpQ').inputValue() === '평택시 비전동 1');
  ok('지도가 그려졌다', await page.locator('#mpMap[data-map="1"]').count() === 1);
  /* ☠️ 2026-09-17 — 여기서 실제로 사고가 났다. 안내 문구를 두 줄로 나눠 적으면서 + 를
       빠뜨렸더니, 자바스크립트가 앞 줄에서 문장을 끝내 버려 **아래 막대가 통째로 사라졌다**.
       문법 오류가 아니라서 node --check 도 npm test 도 멀쩡히 통과했다.
       → 화면에 실제로 붙어 있는지, 그리고 화면 밖으로 밀려나지 않았는지를 잰다. */
  ok('주소 자리에 표시(핀)가 찍힌다', await page.locator('.cm-pin-dot').count() === 1);
  ok('고르는 법 안내가 보인다', await page.locator('.mp-tip').count() === 1);
  const box = await page.evaluate(() => {
    const e = document.querySelector('.mp-sel');
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { bottom: Math.round(r.bottom), h: Math.round(r.height), vh: window.innerHeight };
  });
  ok('아래 막대가 화면 안에 있다' + (box ? ` (${box.bottom}/${box.vh})` : ' — 아예 없음'),
     !!box && box.h > 0 && box.bottom <= box.vh + 1);
  ok('지금 주소를 아래 막대에 적어 준다',
     (await page.locator('.cm-card-addr').innerText()).includes('비전동'));
  /* ★ 2026-09-17 — 그날 지도 카드와 같은 정보(시간·이름·대상)를 띄운다 */
  const card = await page.evaluate(() => ({
    time: (document.querySelector('.mp-card .cm-time') || {}).innerText,
    ti:   (document.querySelector('.mp-card .cm-card-ti') || {}).innerText,
    sub:  (document.querySelector('.mp-card .cm-card-sub') || {}).innerText,
    nav:  !!document.querySelector('#mpNav'),
    use:  !!document.querySelector('#mpUse')
  }));
  ok('시간·이름·대상이 그날 지도 카드처럼 나온다',
     card.time === '10:00~12:00' && card.ti === '삼원빌딩' && card.sub === '벽걸이 1대');
  ok('길안내 버튼이 있다', card.nav === true);
  ok('주소가 그대로면 [이 주소 쓰기] 는 안 낸다', card.use === false);

  await page.locator('#mpFind').click();
  await page.waitForTimeout(200);
  ok('찾으면 아래 막대에 후보가 뜬다', (await page.locator('.cm-card-addr').innerText()).includes('테스트로 2'));
  ok('주소가 바뀌면 [이 주소 쓰기] 가 나온다', await page.locator('#mpUse').count() === 1);
  ok('작업 정보(이름·대상)는 그대로 있다',
     (await page.locator('.mp-card .cm-card-ti').innerText()) === '삼원빌딩');
  ok('바로 채우지 않는다 (확인 버튼을 거친다)', await page.evaluate(() => window.__picked) === undefined);
  await page.locator('#mpUse').click();
  ok('[이 주소 쓰기] 를 눌러야 들어간다', await page.evaluate(() => window.__picked) === '경기 평택시 테스트로 2');
  ok('그때 시트가 닫힌다', await page.locator('#mapPickOverlay').count() === 0);

  console.log('\n[D] 주소칸 옆 버튼 (link_actions)');
  await page.evaluate(() => {
    const i = document.createElement('input');
    i.id = 'weAddr'; i.value = '평택시 비전동 1';
    document.body.appendChild(i);
    window.LinkActions.__scan ? window.LinkActions.__scan() : document.dispatchEvent(new Event('DOMContentLoaded'));
  });
  await page.waitForTimeout(350);
  const icons = await page.evaluate(() => {
    const w = document.getElementById('weAddr').parentNode;
    return Array.from(w.querySelectorAll('button')).map(b => b.title);
  });
  ok('길안내 · 지도에서 찍기 두 버튼이 붙는다', icons.includes('길안내') && icons.includes('지도에서 찍기'));

  console.log('\n[E] 콘솔');
  ok('오류 없음' + (errs.length ? ' — ' + errs.slice(0, 4).join(' | ') : ''), errs.length === 0);

  await b.close();
  console.log('\n' + (fails ? '❌ 실패 ' + fails + '건 / ' : '✅ ') + '통과 ' + oks + '건');
  process.exit(fails ? 1 : 0);
})();
