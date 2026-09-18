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
    this.setBounds=()=>{}; this.setLevel=()=>{}; this.panTo=()=>{ window.__panned=(window.__panned||0)+1; };
    this.getCenter=()=>({getLat:()=>37,getLng:()=>127});
    this.getProjection=()=>({coordsFromContainerPoint:()=>new kakao.maps.LatLng(37,127)}); },
  Marker: function(o){ window.__markers=(window.__markers||0)+1; this.setMap=()=>{}; },
  Polyline: function(o){ window.__poly=o; (window.__polys=window.__polys||[]).push(o);
    this.setMap=function(m){ if(m===null) o.__off=1; };
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
    <script>${FAKE_GEO}<\/script>
    <script>window.KAKAO_JS_KEY='FAKEKEY';window.KAKAO_ROUTE_URL='';<\/script>
    <script>${R('js/geocode.js')}<\/script>
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
      distance: 12000, duration: 1500,
      legs: [{ distance: 5000, duration: 600 }, { distance: 7000, duration: 900 }]
    }) });
    window.__geoMode = 'ok'; window.__polys = []; if (window.MyLoc) MyLoc.forget();
  });
  await page.evaluate(() => CalMap.open('9월 18일 (금)', [
    { title: 'A', sub: '', time: '09:00', addr: '평택시 비전동 1' },
    { title: 'B', sub: '', time: '13:00', addr: '평택시 비전동 2' }]));
  await page.waitForTimeout(700);
  ok('선이 두 가닥이다 (직선 + 실제 경로)', await page.evaluate(() => (window.__polys || []).length) === 2);
  ok('점선을 지우지 않는다', await page.evaluate(() => !window.__polys[0].__off));
  ok('겹칠 땐 점선을 낮춘다', await page.evaluate(() => window.__polys[0].strokeOpacity) === 0.3);
  ok('실제 경로는 진한 실선이다', await page.evaluate(() =>
    window.__polys[1].strokeStyle === 'solid' && window.__polys[1].strokeWeight === 5));
  const d0 = (await page.locator('.cm-card-dist[data-i="0"]').innerText()).trim();
  ok('첫 카드에 직선·주행이 같이 나온다 (' + d0 + ')', /직선/.test(d0) && /주행/.test(d0));
  ok('첫 구간 주행이 5km 다', /주행 5\.0km/.test(d0));
  const d1 = (await page.locator('.cm-card-dist[data-i="1"]').innerText()).trim();
  ok('둘째 카드는 이전 작업에서의 거리다 (' + d1 + ')', /직선/.test(d1) && /주행 7\.0km/.test(d1));
  ok('머리줄에 총 주행거리·시간이 뜬다',
     /주행 12km/.test((await page.locator('#calMapHeadSub').innerText())));
  await page.evaluate(() => CalMap.close());

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
