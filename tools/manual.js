/* ═══════════════════════════════════════════════════════════════════
   tools/manual.js — 설명서를 고치고 바로 확인한다
   ----------------------------------------------------------------
        npm run manual          검사 + 미리보기 만들기 (평소 이것만)
        npm run manual:check    검사만 (고칠 곳이 있으면 1 로 끝난다)

   ⭐ 왜 만들었나
      설명서를 고치려면 www/js/manual_data.js 하나만 만지면 된다. 그런데 그 파일은
      **자바스크립트**라서 따옴표 하나만 빠져도 설명서가 통째로 안 뜬다.
      게다가 앱을 다시 빌드해야 눈으로 볼 수 있으니, 오타 하나 고치는 데 몇 분이 든다.
      → 고치고 이 명령 한 번이면 "어디가 틀렸는지" 와 "어떻게 보이는지" 를 같이 준다.

   ⚠️ 미리보기는 **repo 맨 위**에 manual-preview.html 로 만든다. www/ 안에 두면
      앱에 같이 실려 배포된다(cap sync 는 www 를 통째로 복사한다).
      대신 <base href="www/"> 를 넣어 assets/manual/… 그림이 그대로 보이게 한다.

   ⚠️ 미리보기에서는 '그림 자리 보기' 를 켠 채로 연다 — 만드는 사람용 화면이다.
      진짜 앱에서는 기본이 꺼짐이라 빈 액자가 사용자에게 안 보인다(검사가 지킨다).
═══════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');
const JS = path.join(WWW, 'js');
const IMG_DIR = path.join(WWW, 'assets', 'manual');
const OUT = path.join(ROOT, 'manual-preview.html');
const CHECK_ONLY = process.argv.includes('--check');

const BIG_KB = 300;          // 이보다 크면 알려 준다 (사진 용량 = 앱 용량)

let errs = [], warns = [];
const bad = (m) => errs.push(m);
const warn = (m) => warns.push(m);

/* ── 1. 글 파일을 읽어 본다 ─────────────────────────────── */
function loadData() {
  const src = fs.readFileSync(path.join(JS, 'manual_data.js'), 'utf8');
  const ctx = { window: {}, console: { log() {}, warn() {}, error() {} } };
  ctx.window.window = ctx.window;
  try {
    vm.createContext(ctx);
    vm.runInContext(src, ctx, { filename: 'manual_data.js' });
  } catch (e) {
    /* ☠️ 여기가 제일 흔한 사고다 — 따옴표·쉼표 하나. 줄 번호를 꼭 같이 준다.
       "문법 오류" 만 던지면 어디를 볼지 몰라 파일 전체를 노려보게 된다. */
    const line = (e && e.stack || '').match(/manual_data\.js:(\d+)/);
    bad('글 파일에 문법 오류가 있습니다' + (line ? ' — ' + line[1] + '번째 줄 근처' : '') +
        '\n      ' + ((e && e.message) || e) +
        '\n      따옴표(\')가 짝이 맞는지, 줄 끝 쉼표(,)가 빠지지 않았는지 보세요.');
    return null;
  }
  const d = ctx.window.MANUAL_DATA;
  if (!d || !Array.isArray(d.parts)) { bad('MANUAL_DATA 가 없습니다 (파일 구조가 깨졌습니다)'); return null; }
  return d;
}

/* ── 2. 내용을 훑는다 ───────────────────────────────────── */
function scan(d) {
  const out = { secs: 0, steps: 0, imgs: 0, filled: 0, empty: [], files: new Set() };
  (d.parts || []).forEach((p) => {
    if (!p.p) bad('이름 없는 부(part)가 있습니다');
    (p.secs || []).forEach((s) => {
      out.secs++;
      if (!s.t) bad(p.p + ' 에 제목 없는 칸이 있습니다');
      (s.steps || []).forEach((st, i) => {
        out.steps++;
        const where = p.p + ' ▸ ' + s.t + ' ▸ ' + (i + 1) + '단계';
        if (!st.h) bad(where + ' 에 제목이 없습니다');
        (st.img || []).forEach((im) => {
          out.imgs++;
          if (!im || typeof im !== 'object') { bad(where + ' 의 그림이 { src, cap } 꼴이 아닙니다'); return; }
          if (!im.cap || !String(im.cap).trim()) bad(where + ' 의 그림에 설명(cap)이 없습니다');
          const src = String(im.src || '').trim();
          if (!src) { out.empty.push({ where, cap: im.cap, tall: im.shape === 'tall' }); return; }
          out.filled++;
          if (/^(https?:)?\/\//.test(src) || /^data:/.test(src) || src[0] === '/') return;  // 바깥 주소는 확인 안 함
          out.files.add(src);
          const f = path.join(IMG_DIR, src);
          if (!fs.existsSync(f)) {
            /* ☠️ 앱에서는 깨진 그림이 조용히 사라진다(onerror). 그래서 "안 보이네" 로만 보이고
               왜인지 알 수 없다. 여기서 이름을 대 준다. */
            bad(where + ' 의 그림 파일이 없습니다: www/assets/manual/' + src +
                '\n      (파일 이름이 정확한지, 폴더에 넣었는지 보세요)');
            return;
          }
          const kb = Math.round(fs.statSync(f).size / 1024);
          if (kb > BIG_KB) warn(src + ' 가 ' + kb + 'KB 입니다 — 앱 용량이 그만큼 커집니다 (' + BIG_KB + 'KB 아래 권장)');
        });
      });
    });
  });
  return out;
}

/* 폴더에는 있는데 아무 데서도 안 쓰는 파일 */
function unused(used) {
  if (!fs.existsSync(IMG_DIR)) return [];
  return fs.readdirSync(IMG_DIR)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .filter((f) => !used.has(f));
}

/* ── 3. 미리보기 만들기 ─────────────────────────────────── */
function preview() {
  const css = fs.readFileSync(path.join(WWW, 'styles.css'), 'utf8');
  const data = fs.readFileSync(path.join(JS, 'manual_data.js'), 'utf8');
  /* ⚠️ file:// 에서는 localStorage 가 막힌다 → 슬롯 보기를 메모리 값으로 바꿔 끼운다.
        앱 파일은 안 건드린다. 여기서 만든 글자만 바뀐다. */
  const js = fs.readFileSync(path.join(JS, 'manual.js'), 'utf8')
    .replace("return localStorage.getItem(SLOT_KEY) === '1';", 'return !!window.__pvSlots;')
    .replace("if (on) localStorage.setItem(SLOT_KEY, '1'); else localStorage.removeItem(SLOT_KEY);",
             'window.__pvSlots = !!on;');

  const html = `<!doctype html><html lang="ko" data-mode="light"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<base href="www/">
<title>설명서 미리보기</title>
<style>${css}</style>
<style>
 html,body{margin:0;height:100%;background:var(--bg);}
 .pv-bar{position:fixed;left:0;right:0;bottom:0;z-index:5000;display:flex;gap:8px;
   padding:10px 12px;background:var(--sf);border-top:1px solid var(--bd);}
 .pv-bar button{flex:1;min-height:40px;border-radius:10px;border:1px solid var(--bd);
   background:var(--sf2);color:var(--tx);font-family:inherit;font-size:12.5px;font-weight:700;cursor:pointer;}
 .pv-bar button.on{background:var(--ac);color:#fff;border-color:var(--ac);}
 .mn-ov{bottom:60px;} .mn-x{display:none;}
 /* 폰에서 어떻게 보이는지 — 넓은 화면에서도 폰 폭으로 묶어 본다 */
 body.pv-phone .mn-ov{left:50%;transform:translateX(-50%);width:390px;
   box-shadow:0 0 0 1px var(--bd);}
</style></head><body class="pv-phone">
<div class="pv-bar">
  <button type="button" id="pvSlot" class="on">그림 자리 보기</button>
  <button type="button" id="pvPhone" class="on">폰 폭</button>
  <button type="button" id="pvDark">어두운 화면</button>
</div>
<script>${data}<\/script>
<script>${js}<\/script>
<script>
 window.__pvSlots = true; window.openManual();
 document.getElementById('pvSlot').onclick = function () {
   window.__pvSlots = !window.__pvSlots; this.classList.toggle('on', !!window.__pvSlots);
   window.closeManual(); window.openManual();
 };
 document.getElementById('pvPhone').onclick = function () {
   document.body.classList.toggle('pv-phone');
   this.classList.toggle('on', document.body.classList.contains('pv-phone'));
 };
 document.getElementById('pvDark').onclick = function () {
   var d = document.documentElement.getAttribute('data-mode') === 'dark';
   document.documentElement.setAttribute('data-mode', d ? 'light' : 'dark');
   this.classList.toggle('on', !d);
 };
 setInterval(function () { if (!document.querySelector('.mn-ov')) window.openManual(); }, 400);
<\/script></body></html>`;
  fs.writeFileSync(OUT, html);
}

/* ── 돌린다 ─────────────────────────────────────────────── */
const d = loadData();
let s = null;
if (d) s = scan(d);

console.log('');
if (s) {
  console.log('  설명서 ' + (d.parts || []).length + '부 · ' + s.secs + '칸 · ' + s.steps + '단계');
  console.log('  그림 자리 ' + s.imgs + '개 — 채움 ' + s.filled + ' / 빈 자리 ' + s.empty.length);
  const u = unused(s.files);
  if (u.length) warn('폴더에 있는데 아무 데서도 안 쓰는 그림: ' + u.join(', '));
}

if (errs.length) {
  console.log('\n  ── 고쳐야 합니다 ──');
  errs.forEach((m) => console.log('  ❌ ' + m));
}
if (warns.length) {
  console.log('\n  ── 참고 ──');
  warns.forEach((m) => console.log('  ⚠️  ' + m));
}

if (s && s.empty.length && process.argv.includes('--todo')) {
  console.log('\n  ── 아직 비어 있는 그림 자리 ──');
  s.empty.forEach((e) => {
    console.log('  · [' + (e.tall ? '세로 화면' : '가로로 잘라서') + '] ' + e.where);
    console.log('      ' + e.cap);
  });
}

if (!CHECK_ONLY && !errs.length) {
  preview();
  console.log('\n  미리보기를 만들었습니다: ' + path.relative(ROOT, OUT));
  console.log('  이 파일을 더블클릭하면 브라우저에서 열립니다. 고친 뒤 다시 돌리고 새로고침(F5) 하세요.');
  if (s && s.empty.length) console.log('  빈 자리 목록을 보려면:  npm run manual -- --todo');
}

if (errs.length) { console.log('\n  ❌ ' + errs.length + '곳을 고쳐야 합니다.\n'); process.exit(1); }
console.log(warns.length ? '\n  ✅ 쓸 수 있습니다 (참고 ' + warns.length + '건)\n' : '\n  ✅ 이상 없습니다\n');
