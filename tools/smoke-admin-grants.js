/* ═══════════════════════════════════════════════════════════
   tools/smoke-admin-grants.js — 관리자 통계 안의 부여 내역을 **실제로 열어 본다**
   ----------------------------------------------------------------
   ⚠️ npm test 에 넣지 않는다(Playwright 필요). 손으로 돌린다:
        node tools/smoke-admin-grants.js

   ☠️ 왜 따로 필요한가
      tools/test-admin-grants.js 는 값과 소스를 본다. 그런데 "통계 화면을 다시 그린 뒤에
      부여 내역을 **다시 채우는가**" 는 소스를 훑어서는 알 수 없다 —
      호출문이 죽은 가지 안에 들어가 있어도 글자로는 멀쩡히 보인다
      (변형 시험에서 실제로 빠져나갔다). 그래서 여기서 진짜로 눌러 본다.

   Firebase 는 안 띄운다. Cloud·Subs·fetch 를 가짜로 끼우고 화면만 본다.
═══════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..'), WWW = path.join(ROOT, 'www');

let fails = 0, oks = 0;
const ok = (name, cond, extra) => {
  console.log('  ' + (cond ? '✅' : '❌') + ' ' + name + (extra ? ' — ' + extra : ''));
  cond ? oks++ : fails++;
};

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
function serve(page) {
  const srv = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/h.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(page);
    }
    const f = path.join(WWW, u.replace(/^\/+/, ''));
    if (!f.startsWith(WWW) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': (TYPES[path.extname(f)] || 'application/octet-stream') + '; charset=utf-8' });
    res.end(fs.readFileSync(f));
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

/* 가짜 Firestore — 부여 기록 2건, 계정 2개.
   u1: 이번 달에 쓰고 있음 / u2: 지난달 기록만 있고 이번 달은 안 씀(+ 결제 전환) */
const STUB = `
<script>
(function () {
  var THIS_YM = (function () { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'); })();
  var LOG = [
    { targetUid:'u1', targetEmail:'u1@x.com', targetName:'김기사', kind:'plan', value:'lite', prevValue:'free',
      grantedAt:{ toDate:function(){ return new Date(Date.now()-86400000); } } },
    { targetUid:'u2', targetEmail:'u2@x.com', targetName:'<b>박</b>기사', kind:'plan', value:'basic', prevValue:'free',
      grantedAt:{ toDate:function(){ return new Date(Date.now()-5*86400000); } } }
  ];
  var USERS = {
    u1: { email:'u1@x.com', plan:'lite', subs:{ ym:THIS_YM, used:{ sched:7, blog:2 }, aiCost:0.42 },
          lastActiveAt:{ toDate:function(){ return new Date(); } } },
    u2: { email:'u2@x.com', plan:'basic', billingPlan:'basic',
          subs:{ ym:'2020-01', used:{ sched:99, blog:40 }, aiCost:12 } }
  };
  function snapDocs(arr){ return { empty:!arr.length, docs: arr.map(function(d,i){ return { id:'g'+i, data:function(){ return d; } }; }) }; }
  window.Cloud = {
    ready:true, user:{ uid:'me', getIdToken:function(){ return Promise.resolve('tok'); } },
    db: {
      collection:function(c){
        return {
          doc:function(id){
            return {
              collection:function(){ return {
                orderBy:function(){ return this; }, limit:function(){ return this; },
                get:function(){ return Promise.resolve(snapDocs(LOG)); }
              }; },
              get:function(){
                var d = USERS[id];
                return Promise.resolve({ exists:!!d, data:function(){ return d || {}; } });
              }
            };
          }
        };
      }
    }
  };
  window.Subs = {
    isAdmin:function(){ return true; },
    planOf:function(k){ return ({ free:{name:'무료',sched:0,blog:0}, lite:{name:'라이트',sched:30,blog:10},
      basic:{name:'베이직',sched:70,blog:30} })[k] || null; }
  };
  window.showToast = function(){};
  window.fetch = function(){ return Promise.resolve({ ok:true, json:function(){ return Promise.resolve({
    ok:true, users:{ total:3, authTotal:3, planCounts:{}, ai:{} }, claude:{}, storage:{}, play:{}, earnings:{},
    generatedAt:'2026-09-20T00:00' }); } }); };
})();
<\/script>`;

(async () => {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (e) { console.log('playwright 가 없다 — 건너뛴다'); process.exit(0); }

  const page404 = '<!doctype html><html><head><meta charset="utf-8">' +
    '<link rel="stylesheet" href="./styles.css"></head><body>' + STUB +
    '<script src="./js/admin_grants.js"><\/script>' +
    '<script src="./js/admin_stats.js"><\/script></body></html>';

  const fixed = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(fs.existsSync(fixed) ? { executablePath: fixed } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  const srv = await serve(page404);
  await page.goto('http://127.0.0.1:' + srv.address().port + '/h.html');
  await page.waitForFunction(() => window.AdminStats && window.AdminGrants);

  console.log('\n[A] 통계 화면 안의 부여 내역');
  await page.evaluate(() => AdminStats.open());
  await page.waitForTimeout(600);

  ok('통계가 열린다', await page.locator('#adminStatsOv').count() === 1);
  const sum1 = (await page.locator('#asGrants').innerText()).trim();
  ok('부여 내역 요약이 채워진다', /2명/.test(sum1), sum1.split('\n')[0]);
  ok('이번 달 실제 사용 인원을 가려낸다 (1명)', /실제 사용\s*1명/.test(sum1.replace(/\s+/g, ' ')));
  ok('결제 전환을 따로 센다', /1명은 실제 결제로 전환/.test(sum1));

  console.log('\n[B] 다시 그려도 사라지지 않는다');
  /* ☠️ '수동 지정 제외' 토글이 render() 를 다시 돌린다. 그때 이 칸이 통째로 새로 만들어지므로
     다시 채워야 한다. 토글이 없는 자료일 수 있어 render 를 직접 다시 부른다. */
  await page.evaluate(() => {
    var ov = document.getElementById('adminStatsOv');
    ov.dispatchEvent(new Event('x'));          // no-op
  });
  await page.evaluate(() => {
    /* admin_stats 의 render 는 밖으로 안 나와 있다 → 화면을 닫았다 다시 연다.
       (다시 열 때도 채워지는지 = 같은 계약) */
    document.getElementById('adminStatsOv').remove();
    AdminStats.open();
  });
  await page.waitForTimeout(600);
  const sum2 = (await page.locator('#asGrants').innerText()).trim();
  ok('다시 열어도 요약이 있다', /2명/.test(sum2), sum2.split('\n')[0]);

  console.log('\n[C] 계정별 사용 내역');
  await page.locator('#asGrantsMore').click();
  await page.waitForTimeout(500);
  ok('자세히 보기가 열린다', await page.locator('#agClose').count() === 1);
  const list = (await page.locator('#agList').innerText()).trim();
  ok('이번 달 쓴 사람은 횟수가 나온다', /일정 7\/30회/.test(list.replace(/\s+/g, ' ')), '김기사');
  ok('☠️ 지난달 기록은 이번 달 사용으로 안 보여 준다',
     !/99/.test(list) && /이번 달 사용 없음/.test(list));
  ok('결제 전환 계정을 표시한다', /결제중/.test(list));
  ok('닉네임의 태그가 글자로 나온다(HTML 로 안 샌다)',
     await page.evaluate(() => document.querySelector('#agList').innerHTML.indexOf('<b>박</b>') < 0));

  console.log('\n[D] 정렬 · 닫기');
  await page.locator('#agSortUse').click();
  await page.waitForTimeout(250);
  const first = (await page.locator('#agList > div').first().innerText()).trim();
  ok('많이 쓴 순으로 바꾸면 쓴 사람이 위로', /김기사/.test(first), first.split('\n')[0]);
  await page.locator('#agClose').click();
  await page.waitForTimeout(200);
  ok('닫힌다', await page.locator('#agClose').count() === 0);

  ok('콘솔 오류 없음', errs.length === 0, errs.join(' | ').slice(0, 120));

  if (process.env.SHOT) {
    await page.evaluate(() => { AdminGrants.open(); });
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/tmp/ag-light.png', fullPage: false });
    await page.evaluate(() => document.documentElement.setAttribute('data-mode', 'dark'));
    await page.waitForTimeout(150);
    await page.screenshot({ path: '/tmp/ag-dark.png', fullPage: false });
  }

  await browser.close(); srv.close();
  console.log('\n' + (fails ? '❌ ' + fails + '개 실패' : '✅ 전부 통과') + ' (' + oks + '개)');
  process.exit(fails ? 1 : 0);
})();
