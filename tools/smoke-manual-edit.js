/* ═══════════════════════════════════════════════════════════
   tools/smoke-manual-edit.js — 편집 화면을 **진짜 브라우저에서** 눌러 본다
   ----------------------------------------------------------------
   tools/test-manual-edit.js 는 글 파일을 다시 쓰는 셈과 화면 소스를 본다.
   여기서는 화면을 실제로 열어 **빠진 그림 찾기**를 눌러 본다 —
   세는 것과 뛰는 것은 글자만 봐서는 맞는지 알 수 없다.

   ⚠️ npm test 에 넣지 않는다(Playwright 가 있어야 돈다). 손으로 돌린다:
        node tools/smoke-manual-edit.js
   ☠️ 이 검사는 글 파일에 **아무것도 쓰지 않는다.** 읽기만 한다.
      편집 화면은 고치는 즉시 저장하므로, 검사가 실수로 저장하면
      진짜 설명서가 망가진다. 저장을 부르는 길(사진 넣기·글자 치기)은 건드리지 않는다.
═══════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'www', 'js', 'manual_data.js');
const PORT = 8791;

let fails = 0, oks = 0;
const say = (ok, name, extra) => {
  console.log('  ' + (ok ? '✅' : '❌') + ' ' + name + (extra ? ' — ' + extra : ''));
  ok ? oks++ : fails++;
};

/* 이 컨테이너의 크로미움은 고정 폴더 아래에 있다. 폴더 이름에 판 번호가 붙으므로 찾아본다 */
function findChrome() {
  const base = '/opt/pw-browsers';
  if (!fs.existsSync(base)) return null;
  for (const d of fs.readdirSync(base)) {
    const f = path.join(base, d, 'chrome-linux', 'chrome');
    if (fs.existsSync(f)) return f;
  }
  return null;
}

(async () => {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (e) { console.log('playwright 가 없다 — 이 검사는 건너뛴다'); process.exit(0); }

  /* ☠️ 글 파일을 통째로 떠 둔다. 검사가 끝나면 한 글자도 안 바뀌었는지 견준다 */
  const before = fs.readFileSync(DATA, 'utf8');

  const chrome = findChrome();
  const browser = await chromium.launch(chrome ? { executablePath: chrome } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  const srv = cp.spawn(process.execPath, [path.join(__dirname, 'manual_edit.js')],
    { env: Object.assign({}, process.env, { MANUAL_PORT: String(PORT) }), stdio: 'ignore' });
  const stop = () => { try { srv.kill(); } catch (e) {} };

  try {
    await new Promise(r => setTimeout(r, 1500));
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('#sel option').length > 0);

    console.log('\n[1] 빠진 그림을 세어 보여 준다');

    const n = await page.evaluate(() => document.querySelectorAll('#gapList a').length);
    say(n > 0, '빈 자리 목록이 만들어졌다', n + '곳');

    const bar = await page.evaluate(() => ({
      off: document.getElementById('gapBar').classList.contains('off'),
      txt: document.getElementById('gapCnt').textContent
    }));
    say(!bar.off, '위쪽 띠가 보인다');
    say(bar.txt.indexOf(String(n)) >= 0, '띠에 빈 자리 수가 적힌다', bar.txt);

    /* ☠️ 칸 목록에도 같이 보여야 한다. 띠만 있으면 '어느 칸인지'를 여전히 못 찾는다 */
    const marked = await page.evaluate(() =>
      [...document.getElementById('sel').options].filter(o => /○\d/.test(o.textContent)).length);
    say(marked > 0, '칸 고르는 목록에 ○표시가 붙는다', marked + '칸');

    /* 표시된 칸 수와 목록에 적힌 칸 수가 같아야 한다 — 한쪽만 맞으면 헛다리를 짚는다 */
    const secs = await page.evaluate(() =>
      new Set([...document.querySelectorAll('#gapList a')].map(a => a.getAttribute('data-n'))).size);
    say(secs === n, '목록 줄 수와 빈 자리 수가 맞는다', secs + ' / ' + n);

    console.log('\n[2] 그 자리로 건너뛴다');

    const seen = [];
    for (let i = 0; i < n + 1; i++) {
      await page.click('#gapNext');
      await page.waitForTimeout(220);
      seen.push(await page.evaluate(() => {
        const h = [...document.querySelectorAll('.drop.hit')];
        const el = h[h.length - 1];
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { no: el.querySelector('.gno').textContent,
                 seen: r.top > -20 && r.top < innerHeight };
      }));
    }
    say(seen.every(Boolean), '누를 때마다 그 자리가 깜빡인다');
    say(seen.every(s => s && s.seen), '☠️ 깜빡이는 자리가 화면 안으로 들어온다');
    const nos = seen.map(s => s && s.no);
    const want = [];
    for (let i = 1; i <= n; i++) want.push('빈 자리 ' + i + ' / ' + n);
    want.push('빈 자리 1 / ' + n);                 /* 끝까지 가면 처음으로 돈다 */
    say(JSON.stringify(nos) === JSON.stringify(want),
        '목록 순서대로 하나씩 가고 끝에서 처음으로 돈다', nos[0] + ' … ' + nos[nos.length - 1]);

    console.log('\n[3] 목록에서 골라 간다');

    await page.click('#gapShow');
    await page.waitForTimeout(150);
    say(await page.evaluate(() => document.getElementById('gapList').classList.contains('on')),
        '[목록] 을 누르면 펼쳐진다');

    const pick = Math.min(4, n - 1);
    await page.click('#gapList a[data-n="' + pick + '"]');
    await page.waitForTimeout(350);
    const jumped = await page.evaluate(() => {
      const h = [...document.querySelectorAll('.drop.hit')];
      const el = h[h.length - 1];
      return { no: el ? el.querySelector('.gno').textContent : '',
               closed: !document.getElementById('gapList').classList.contains('on') };
    });
    say(jumped.no === '빈 자리 ' + (pick + 1) + ' / ' + n, '고른 자리로 간다', jumped.no);
    say(jumped.closed, '가면서 목록이 닫힌다');

    console.log('\n[4] 오류');
    say(errs.length === 0, '콘솔 오류 없음', errs.join(' | '));
    say(fs.readFileSync(DATA, 'utf8') === before, '☠️ 글 파일을 건드리지 않았다');
  } finally {
    await browser.close();
    stop();
  }

  console.log('\n' + (fails ? '❌ 실패 ' + fails + '건' : '✅ 통과 ' + oks + '건') + '\n');
  process.exit(fails ? 1 : 0);
})();
