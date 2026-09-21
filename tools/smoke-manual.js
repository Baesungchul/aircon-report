/* ═══════════════════════════════════════════════════════════
   tools/smoke-manual.js — 설명서를 **진짜 브라우저에서** 열어 본다
   ----------------------------------------------------------------
   ⚠️ npm test 에 넣지 않는다(Playwright 가 있어야 돈다). 손으로 돌린다:
        node tools/smoke-manual.js
   tools/test-manual.js 는 그려 낸 글자를 본다. 여기서는 실제로 눌러 본다 —
   펼침/접힘, 한 번에 하나, 닫기처럼 손가락이 닿는 부분은 글자만 봐서는 모른다.
═══════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..'), WWW = path.join(ROOT, 'www');

/* ☠️ setContent 로 띄우면 페이지에 출처(origin)가 없어서 localStorage 가
     SecurityError 로 터진다. 앱 코드는 try/catch 로 삼키므로 '조용히 아무것도 안 함'
     이 되어, 슬롯 보기 같은 걸 검사해도 가짜로 통과한다.
   → 작은 서버로 진짜 http:// 에서 연다. 파일 경로(assets/manual/…)도 이때 진짜가 된다. */
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
function serve() {
  const srv = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/_harness.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><html><head><meta charset="utf-8">' +
        '<link rel="stylesheet" href="./styles.css">' +
        '<script src="./js/manual_data.js" defer></script>' +
        '<script src="./js/manual.js" defer></script></head><body></body></html>');
    }
    const f = path.join(WWW, u.replace(/^\/+/, ''));
    if (!f.startsWith(WWW) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': (TYPES[path.extname(f)] || 'application/octet-stream') + '; charset=utf-8' });
    res.end(fs.readFileSync(f));
  });
  return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

let fails = 0, oks = 0;
const say = (ok, name, extra) => {
  console.log('  ' + (ok ? '✅' : '❌') + ' ' + name + (extra ? ' — ' + extra : ''));
  ok ? oks++ : fails++;
};

(async () => {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (e) { console.log('playwright 가 없다 — 이 검사는 건너뛴다'); process.exit(0); }

  /* 이 컨테이너의 크로미움은 /opt/pw-browsers 아래에 있다. 폴더 이름에 판 번호가
     붙으므로(chromium-1194 …) 찾아서 쓴다. 못 찾으면 playwright 기본 경로를 쓴다.
     ☠️ 예전에는 '/opt/pw-browsers/chromium' 을 그대로 썼는데, 그건 **폴더**라
        존재하기는 해서 검사를 통과하고 실행에서만 터졌다. 있는지가 아니라
        실행 파일인지를 봐야 한다. */
  let opt = {};
  try {
    const base = '/opt/pw-browsers';
    for (const d of fs.readdirSync(base)) {
      const f = path.join(base, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(f)) { opt = { executablePath: f }; break; }
    }
  } catch (e) {}
  const browser = await chromium.launch(opt);
  const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
  page.on('pageerror', e => say(false, '페이지 오류', e.message));

  const srv = await serve();
  await page.goto('http://127.0.0.1:' + srv.address().port + '/_harness.html');
  await page.waitForFunction(() => typeof window.openManual === 'function');

  /* ① 열린다 */
  await page.evaluate(() => window.openManual());
  const ovs = await page.locator('.mn-ov').count();
  say(ovs === 1, '설명서가 열린다', ovs + '개');
  say(await page.locator('.mn-ov.ov-lock').count() === 1, 'ov-lock 이 붙어 있다');

  const heads = page.locator('.mn-h');
  const n = await heads.count();
  say(n >= 20, '큰제목이 다 보인다', n + '칸');

  /* ② 처음에는 전부 접혀 있다 */
  const openAtFirst = await page.locator('.mn-b:not([hidden])').count();
  say(openAtFirst === 0, '처음에는 전부 접혀 있다', openAtFirst + '개 열림');

  /* ③ 누르면 펼쳐진다 */
  await heads.nth(0).click();
  await page.waitForTimeout(80);
  say(await page.locator('.mn-item.on').count() === 1, '누르면 펼쳐진다');
  const body0 = page.locator('.mn-item').nth(0).locator('.mn-b');
  say(await body0.isVisible(), '펼친 본문이 화면에 보인다');
  const stepN = await body0.locator('.mn-steps li').count();
  say(stepN > 0, '단계가 그려진다', stepN + '단계');

  /* ④ 다른 걸 누르면 앞의 것이 닫힌다 (한 번에 하나) */
  await heads.nth(3).click();
  await page.waitForTimeout(80);
  const onN = await page.locator('.mn-item.on').count();
  say(onN === 1, '한 번에 하나만 펼쳐진다', onN + '개 열림');
  say(await page.locator('.mn-item').nth(3).locator('.mn-b').isVisible(), '새로 누른 칸이 열렸다');

  /* ⑤ 같은 걸 다시 누르면 접힌다 */
  await heads.nth(3).click();
  await page.waitForTimeout(80);
  say(await page.locator('.mn-item.on').count() === 0, '같은 칸을 다시 누르면 접힌다');

  /* ⑥ 빈 그림 자리는 보이지 않는다 (기본) */
  const slots = await page.locator('.mn-slot').count();
  say(slots === 0, '빈 그림 자리가 사용자에게 안 보인다', slots + '개');

  /* ⑦ 가로로 넘치지 않는다 — 긴 한국어 문장이 잘리거나 옆으로 새면 여기서 걸린다 */
  await heads.nth(0).click();
  await page.waitForTimeout(120);
  const over = await page.evaluate(() => {
    const s = document.querySelector('.mn-scroll');
    return { sw: s.scrollWidth, cw: s.clientWidth };
  });
  say(over.sw <= over.cw + 1, '가로로 넘치지 않는다', over.sw + '/' + over.cw);

  /* ⑧ 닫기 */
  await page.locator('#mnClose').click();
  await page.waitForTimeout(60);
  say(await page.locator('.mn-ov').count() === 0, '✕ 로 닫힌다');

  /* ⑨ 슬롯 보기를 켜면 액자가 보인다 (만드는 사람용 길) */
  await page.evaluate(() => { localStorage.setItem('ac_manual_slots', '1'); window.openManual(); });
  await page.locator('.mn-h').nth(0).click();
  await page.waitForTimeout(80);
  const slots2 = await page.locator('.mn-slot').count();
  say(slots2 > 0, '슬롯 보기를 켜면 액자가 보인다', slots2 + '개');

  await browser.close();
  srv.close();
  console.log('\n' + (fails ? '❌ ' + fails + '개 실패' : '✅ 전부 통과') + ' (' + oks + '개)');
  process.exit(fails ? 1 : 0);
})();
