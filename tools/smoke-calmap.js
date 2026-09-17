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
  Map: function(box, o){ box.setAttribute('data-map','1');
    this.setBounds=()=>{}; this.setLevel=()=>{}; this.panTo=()=>{ window.__panned=(window.__panned||0)+1; };
    this.getCenter=()=>({getLat:()=>37,getLng:()=>127});
    this.getProjection=()=>({coordsFromContainerPoint:()=>new kakao.maps.LatLng(37,127)}); },
  Marker: function(o){ window.__markers=(window.__markers||0)+1; this.setMap=()=>{}; },
  Polyline: function(o){ window.__poly=o; },
  CustomOverlay: function(o){ window.__pins=(window.__pins||0)+1;
    if(o.content && o.map) document.querySelector('#calMapBox').appendChild(o.content); },
  InfoWindow: function(){ this.open=()=>{}; },
  event: { addListener: (t,e,f)=>{ (t.__h=t.__h||{})[e]=f; } },
  services: {
    Status: { OK:'OK', ZERO_RESULT:'ZERO' },
    Geocoder: function(){ return {
      addressSearch:(q,cb)=> setTimeout(()=>cb(/비전동/.test(q)?[{y:'37.0',x:'127.1'}]:[], /비전동/.test(q)?'OK':'ZERO'),0),
      coord2Address:(x,y,cb)=> setTimeout(()=>cb([{road_address:{address_name:'경기 평택시 테스트로 1'}}],'OK'),0) }; },
    Places: function(){ return {
      keywordSearch:(q,cb)=> setTimeout(()=>cb([{y:'37.1',x:'127.2',place_name:'테스트아파트',road_address_name:'경기 평택시 테스트로 2'}],'OK'),0) }; }
  }
}};`;

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
    <script>window.KAKAO_JS_KEY='FAKEKEY';<\/script>
    <script>${R('js/geocode.js')}<\/script>
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
    MapPick.open('평택시 비전동 1', (addr) => { window.__picked = addr; });
  });
  await page.waitForTimeout(400);
  ok('오버레이가 떴다', await page.locator('#mapPickOverlay').count() === 1);
  ok('주소칸 값이 검색어로 들어온다', await page.locator('#mpQ').inputValue() === '평택시 비전동 1');
  ok('지도가 그려졌다', await page.locator('#mpMap[data-map="1"]').count() === 1);

  await page.locator('#mpFind').click();
  await page.waitForTimeout(200);
  ok('찾으면 아래 막대에 후보가 뜬다', (await page.locator('.mp-sel-ad').innerText()).includes('테스트로 2'));
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
