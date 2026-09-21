/* ═══════════════════════════════════════════════════════════════════
   tools/manual_web.js — 설명서를 **웹 페이지**로 내보낸다   (2026-09-21)
   ----------------------------------------------------------------
        npm run manual:web      →  site/manual.html + site/assets/manual/
        firebase deploy --only hosting
        →  https://work-report-826ec.web.app/manual.html

   ⭐ 왜 만들었나
      앱 안에서만 보면 폰 화면이 좁고, 남에게 보여 주거나 PC 로 크게 보려면
      앱을 켜야 한다. 주소 하나로 열리면 팀원·고객에게 그냥 보내면 된다.

   ⚠️ 앱 화면과 **같은 코드**로 그린다(www/js/manual.js).
      따로 만들면 한쪽만 고쳐지는 일이 반드시 생긴다.
   ⚠️ '그림 자리 보기'는 꺼진 채로 낸다 — 읽는 사람에게 빈 액자를 보이면 안 된다.
═══════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');
const JS = path.join(WWW, 'js');
const IMG = path.join(WWW, 'assets', 'manual');
const SITE = path.join(ROOT, 'site');
const OUTIMG = path.join(SITE, 'assets', 'manual');
const OUT = path.join(SITE, 'manual.html');

const css = fs.readFileSync(path.join(WWW, 'styles.css'), 'utf8');
const data = fs.readFileSync(path.join(JS, 'manual_data.js'), 'utf8');
/* 슬롯 보기는 localStorage 를 보는데, 읽는 사람에겐 늘 꺼져 있어야 한다 */
const mjs = fs.readFileSync(path.join(JS, 'manual.js'), 'utf8')
  .replace("return localStorage.getItem(SLOT_KEY) === '1';", 'return false;');

/* 사진을 site 로 옮긴다 (쓰는 것만) */
fs.mkdirSync(OUTIMG, { recursive: true });
const used = new Set();
(data.match(/src:\s*'([^']+)'/g) || []).forEach((m) => {
  const n = m.replace(/^src:\s*'/, '').replace(/'$/, '');
  if (n) used.add(n);
});
let copied = 0, bytes = 0;
used.forEach((n) => {
  const from = path.join(IMG, n);
  if (!fs.existsSync(from)) return;
  fs.copyFileSync(from, path.join(OUTIMG, n));
  bytes += fs.statSync(from).size; copied++;
});

const html = `<!doctype html><html lang="ko" data-mode="light"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>현장매니저 사용설명서</title>
<meta name="description" content="현장매니저 사용설명서 — 처음 쓰는 순서대로.">
<meta property="og:title" content="현장매니저 사용설명서">
<meta property="og:description" content="사진만 찍으면 보고서가 끝납니다. 처음 쓰는 순서대로 따라 하세요.">
<style>${css}</style>
<style>
 html,body{margin:0;background:var(--bg);}
 /* 앱에서는 화면을 덮는 판이지만, 웹에서는 그냥 페이지다 */
 .mn-ov{position:static;inset:auto;height:auto;max-width:720px;margin:0 auto;box-shadow:none;}
 .mn-head{position:sticky;top:0;z-index:5;}
 .mn-x{display:none;}
 /* 이미 브라우저다 — 브라우저로 보내는 단추는 뜻이 없다 */
 .mn-web{display:none;}
 .mn-web-foot{max-width:720px;margin:0 auto;padding:26px 16px 40px;text-align:center;
   color:var(--mu);font-size:12.5px;line-height:1.7;}
 .mn-web-foot a{color:var(--ac);}
</style></head><body>
<script>${data}<\/script>
<script>${mjs}<\/script>
<script>
 window.openManual();
 /* 이 페이지에서는 닫을 곳이 없다 — 닫혀도 다시 연다 */
 setInterval(function () { if (!document.querySelector('.mn-ov')) window.openManual(); }, 500);
<\/script>
<div class="mn-web-foot">
  현장매니저 · 평택에어컨1004<br>
  <a href="app.html">앱 받기</a>
</div>
</body></html>`;

fs.writeFileSync(OUT, html);
console.log('');
console.log('  ✅ ' + path.relative(ROOT, OUT) + ' 을(를) 만들었습니다');
console.log('     사진 ' + copied + '장 (' + Math.round(bytes / 1024) + 'KB) → ' + path.relative(ROOT, OUTIMG));
console.log('');
console.log('  올리려면:  firebase deploy --only hosting');
console.log('  주소    :  https://work-report-826ec.web.app/manual.html');
console.log('');
