/* ═══════════════════════════════════════════════════════════════════
   tools/manual_edit.js — 설명서를 **화면에서** 고친다   (2026-09-20)
   ----------------------------------------------------------------
        npm run manual:edit

   ⭐ 왜 만들었나
      www/js/manual_data.js 를 메모장으로 고치라고 안내했더니 "너무 어렵다" 고 하셨다.
      맞는 말이다. 따옴표·쉼표를 지키면서 62개 그림 자리를 손으로 채우는 건
      프로그램 하는 사람 일이지, 쓰는 사람 일이 아니다.

      그래서 이 명령을 켜면 **브라우저에 편집 화면**이 뜬다.
        · 글은 칸에 대고 그냥 고친다 (따옴표를 볼 일이 없다)
        · 그림은 끌어다 놓거나, 눌러서 고르거나, 붙여넣기(Ctrl+V) 한다
        · 고치는 즉시 manual_data.js 에 저장된다 — 저장 버튼도 없다
        · 사진은 브라우저가 알아서 줄여서 넣는다 (한 장 300KB 아래)

   ⚠️ 이 도구는 **내 PC 에서만** 쓴다. 앱에는 안 들어간다.
      앱에 들어가는 건 www/ 안의 파일뿐이다.

   ☠️ 파일을 통째로 다시 쓰는 도구다. 그래서 두 가지를 반드시 지킨다.
      ① 맨 위 주석(고친 내력이 적혀 있다)은 **손대지 않고 그대로 옮긴다.**
      ② 쓴 다음 **다시 읽어서** 내가 쓰려던 것과 같은지 확인한다.
         다르면 즉시 원래 내용으로 되돌린다. (2026-09-20, 안 써졌는데
         고쳤다고 말한 적이 있다. 같은 일을 반복하지 않기 위한 장치다)

   ⚠️ 지우기(rm)는 쓰지 않는다 — 임시 파일을 만들었다가 지우는 방식 대신,
      원본 글자를 기억해 뒀다가 실패하면 그대로 다시 쓴다.
═══════════════════════════════════════════════════════════════════ */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');
const DATA = path.join(WWW, 'js', 'manual_data.js');
const IMG_DIR = path.join(WWW, 'assets', 'manual');
const PREVIEW = path.join(ROOT, 'manual-preview.html');
const PORT = Number(process.env.MANUAL_PORT || 8787);

/* ══════════════════════════════════════════════════════════════════
   1. 글 파일 읽기 / 쓰기
   ══════════════════════════════════════════════════════════════════ */

/* 맨 위 주석은 건드리지 않는다. (function 이 시작되는 자리에서 자른다 */
function splitHead(src) {
  const at = src.indexOf('(function');
  if (at < 0) throw new Error('manual_data.js 모양이 예상과 다릅니다');
  return { head: src.slice(0, at), body: src.slice(at) };
}

function parse(src) {
  const ctx = { window: {}, console: { log() {}, warn() {}, error() {} } };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'manual_data.js' });
  const d = ctx.window.MANUAL_DATA;
  if (!d || !Array.isArray(d.parts)) throw new Error('MANUAL_DATA 를 못 찾았습니다');
  return d;
}

function load() {
  return parse(fs.readFileSync(DATA, 'utf8'));
}

/* ── 글자 하나를 자바스크립트 따옴표 글로 바꾼다 ──────────────────
   ⚠️ 순서가 중요하다. 역슬래시를 **먼저** 늘려야 한다.
      먼저 따옴표를 처리하면 그때 붙인 역슬래시까지 또 늘어난다. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, '\\n');
}

/* 한글은 화면에서 두 칸을 먹는다. 글자 수로 재면 한글 줄만 유난히 길어진다 */
function wide(s) {
  let n = 0;
  for (const c of String(s)) n += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(c) ? 2 : 1;
  return n;
}

/* 긴 글은 여러 줄로 나눠 적는다 — 나중에 사람이 읽을 수 있게.
   나눌 때 띄어쓰기를 **앞 조각 끝에 붙여** 두니 이어 붙이면 원문 그대로다. */
function slit(s, indent) {
  const e = esc(s);
  if (wide(e) <= 84) return "'" + e + "'";
  const words = e.split(' ');
  const lines = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    const w = words[i] + (i < words.length - 1 ? ' ' : '');
    if (cur && wide(cur) + wide(w) > 78) { lines.push(cur); cur = w; }
    else cur += w;
  }
  if (cur) lines.push(cur);
  const pad = ' '.repeat(indent);
  return lines.map((l) => "'" + l + "'").join(' +\n' + pad);
}

/* { k: v, k: v } 한 덩어리를 줄들로 만든다 */
function block(fields, indent, suffix) {
  const pad = ' '.repeat(indent);
  return fields.map((f, i) => {
    const head = (i === 0 ? pad + '{ ' : pad + '  ') + f.k + ': ';
    const val = f.raw != null ? f.raw : slit(f.v, head.length);
    return head + val + (i < fields.length - 1 ? ',' : ' }' + suffix);
  });
}

function imgLit(im) {
  return '{ src: ' + slit(im.src || '', 0) +
         ', shape: ' + slit(im.shape || 'wide', 0) +
         ', cap: ' + slit(im.cap || '', 0) + ' }';
}

function emit(d) {
  const o = [];
  o.push('(function () {');
  o.push("  'use strict';");
  o.push('');
  o.push('  window.MANUAL_DATA = {');
  o.push('    ver: ' + slit(d.ver || '2', 0) + ',');
  o.push('    lead: ' + slit(d.lead || '', 10) + ',');
  o.push('');
  o.push('    parts: [');

  d.parts.forEach((p, pi) => {
    o.push('');
    o.push('      /* ══ ' + (pi + 1) + '부 ══════════════════════════════════════════════ */');
    o.push('      { p: ' + slit(p.p, 0) + ', secs: [');

    p.secs.forEach((s, si) => {
      o.push('');
      o.push('        { t: ' + slit(s.t, 13) + ',');
      if (s.s) o.push('          s: ' + slit(s.s, 13) + ',');
      o.push('          steps: [');

      s.steps.forEach((t, ti) => {
        const f = [{ k: 'h', v: t.h }];
        if (t.d) f.push({ k: 'd', v: t.d });
        if (t.img && t.img.length) {
          f.push({ k: 'img', raw: '[' + t.img.map(imgLit).join(', ') + ']' });
        }
        const last = ti === s.steps.length - 1;
        block(f, 12, last ? '' : ',').forEach((l) => o.push(l));
      });

      o.push('          ]' + (s.tip ? ',' : ''));
      if (s.tip) o.push('          tip: ' + slit(s.tip, 15));
      o.push('        }' + (si < p.secs.length - 1 ? ',' : ''));
    });

    o.push('      ] }' + (pi < d.parts.length - 1 ? ',' : ''));
  });

  o.push('    ]');
  o.push('  };');
  o.push('})();');
  return o.join('\n') + '\n';
}

/* 비교용으로 모양을 맞춘다 — 없는 값과 빈 값을 같게 본다 */
function norm(d) {
  return {
    ver: d.ver || '2',
    lead: d.lead || '',
    parts: (d.parts || []).map((p) => ({
      p: p.p,
      secs: (p.secs || []).map((s) => ({
        t: s.t,
        s: s.s || '',
        tip: s.tip || '',
        steps: (s.steps || []).map((t) => ({
          h: t.h,
          d: t.d || '',
          img: (t.img || []).map((im) => ({
            src: im.src || '', shape: im.shape || 'wide', cap: im.cap || ''
          }))
        }))
      }))
    }))
  };
}

/* ☠️ 여기가 이 파일에서 제일 조심스러운 곳이다.
      쓰고 나서 **다시 읽어** 확인하고, 다르면 원래대로 되돌린다. */
function save(d) {
  const before = fs.readFileSync(DATA, 'utf8');
  const { head } = splitHead(before);
  const next = head + emit(d);

  fs.writeFileSync(DATA, next, 'utf8');

  let back;
  try { back = parse(fs.readFileSync(DATA, 'utf8')); }
  catch (e) {
    fs.writeFileSync(DATA, before, 'utf8');
    throw new Error('저장한 파일을 다시 읽을 수 없어 되돌렸습니다: ' + e.message);
  }
  if (JSON.stringify(norm(back)) !== JSON.stringify(norm(d))) {
    fs.writeFileSync(DATA, before, 'utf8');
    throw new Error('저장 내용이 달라 되돌렸습니다');
  }
}

/* 한 번에 하나씩만 고친다 (브라우저가 빨리 여러 번 보내도 섞이지 않게) */
let busy = Promise.resolve();
function mutate(fn) {
  const run = busy.then(() => {
    const d = load();
    const r = fn(d);
    save(d);
    return r;
  });
  busy = run.catch(() => {});
  return run;
}

/* ══════════════════════════════════════════════════════════════════
   2. 자리 찾기
   ══════════════════════════════════════════════════════════════════ */
function at(d, q) {
  const p = d.parts[q.pi];
  if (!p) throw new Error('없는 부입니다');
  const s = p.secs[q.si];
  if (!s) throw new Error('없는 칸입니다');
  if (q.ti == null || q.ti < 0) return { p, s, t: null, im: null };
  const t = s.steps[q.ti];
  if (!t) throw new Error('없는 단계입니다');
  if (q.ii == null || q.ii < 0) return { p, s, t, im: null };
  const im = (t.img || [])[q.ii];
  if (!im) throw new Error('없는 그림 자리입니다');
  return { p, s, t, im };
}

/* 사진 파일 이름 — 자리에서 바로 나오게 만든다.
   같은 자리에 다시 넣으면 같은 이름으로 덮어써서 찌꺼기가 안 쌓인다. */
function imgName(q, ext) {
  return 'm' + (q.pi + 1) + '-' + (q.si + 1) + '-' + (q.ti + 1) +
         (q.ii ? '-' + (q.ii + 1) : '') + '.' + ext;
}

/* ☠️ 이름이 **자리**에서 나오기 때문에, 설명서 중간에 부나 칸을 새로 끼워 넣으면
      뒤 칸들이 한 자리씩 밀린다. 그때 새 자리에 사진을 넣으면 밀려난 칸이
      아직 쓰고 있는 파일을 **덮어써 버린다.** 남의 사진이 조용히 바뀐다.
      그래서 다른 자리가 이미 쓰고 있는 이름이면 뒤에 번호를 붙여 피한다.
      (내 자리가 쓰던 이름은 덮어써도 된다 — 바꿔 끼우는 것이니까) */
function freeName(d, q, ext) {
  const base = imgName(q, ext).replace(/\.[^.]+$/, '');
  const used = Object.create(null);
  (d.parts || []).forEach((p, pi) => (p.secs || []).forEach((s, si) =>
    (s.steps || []).forEach((t, ti) => (t.img || []).forEach((im, ii) => {
      if (!im.src) return;
      if (pi === q.pi && si === q.si && ti === q.ti && ii === q.ii) return;
      used[im.src] = true;
    }))));
  let n = base + '.' + ext;
  for (let k = 2; used[n]; k++) n = base + '_' + k + '.' + ext;
  return n;
}

/* ══════════════════════════════════════════════════════════════════
   3. 서버
   ══════════════════════════════════════════════════════════════════ */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8'
};

function sendJSON(res, code, obj) {
  const b = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': b.length });
  res.end(b);
}

function body(req) {
  return new Promise((ok, no) => {
    let n = 0; const parts = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > 40 * 1024 * 1024) { no(new Error('보낸 내용이 너무 큽니다')); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => { try { ok(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch (e) { no(e); } });
    req.on('error', no);
  });
}

/* www/ 안의 파일만 내준다 (.. 로 빠져나가지 못하게 막는다) */
function serveStatic(res, rel) {
  const f = path.join(WWW, rel);
  if (!f.startsWith(WWW + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (e, b) => {
    if (e) { res.writeHead(404); res.end('없는 파일'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(b);
  });
}

const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = decodeURIComponent(u.pathname);

  try {
    if (p === '/' || p === '/index.html') {
      const b = Buffer.from(PAGE, 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': b.length, 'cache-control': 'no-store' });
      return res.end(b);
    }

    if (p === '/api/data') return sendJSON(res, 200, load());

    if (p === '/api/text' && req.method === 'POST') {
      const q = await body(req);
      await mutate((d) => {
        const n = at(d, q);
        const v = String(q.value == null ? '' : q.value);
        if (q.field === 't' || q.field === 's' || q.field === 'tip') n.s[q.field] = v;
        else if (q.field === 'h' || q.field === 'd') n.t[q.field] = v;
        else if (q.field === 'cap') n.im.cap = v;
        else if (q.field === 'lead') d.lead = v;
        else throw new Error('모르는 칸입니다: ' + q.field);
      });
      return sendJSON(res, 200, { ok: true });
    }

    if (p === '/api/img' && req.method === 'POST') {
      const q = await body(req);
      const ext = /^image\/png$/.test(q.type || '') ? 'png' : 'jpg';
      const buf = Buffer.from(String(q.b64 || ''), 'base64');
      if (!buf.length) throw new Error('사진이 비어 있습니다');
      fs.mkdirSync(IMG_DIR, { recursive: true });
      /* 이름은 **지금 글 파일을 보고** 정한다 — 남의 사진을 덮어쓰지 않으려고 */
      const name = await mutate((d) => {
        const n = freeName(d, q, ext);
        fs.writeFileSync(path.join(IMG_DIR, n), buf);
        at(d, q).im.src = n;
        return n;
      });
      return sendJSON(res, 200, { ok: true, name, kb: Math.round(buf.length / 1024) });
    }

    if (p === '/api/imgclear' && req.method === 'POST') {
      const q = await body(req);
      /* 파일은 지우지 않는다(지우기 권한이 없을 수 있다). 안 쓰는 파일은
         npm run manual 이 목록으로 알려 주니 그때 손으로 지우면 된다. */
      await mutate((d) => { at(d, q).im.src = ''; });
      return sendJSON(res, 200, { ok: true });
    }

    if (p === '/preview.html') {
      /* 미리보기는 tools/manual.js 가 만든다 — 같은 코드를 두 번 쓰지 않는다 */
      try { execFileSync(process.execPath, [path.join(__dirname, 'manual.js')], { stdio: 'ignore' }); }
      catch (e) { /* 검사에 걸린 게 있어도 미리보기는 만들어진다 */ }
      return fs.readFile(PREVIEW, (e, b) => {
        if (e) { res.writeHead(500); return res.end('미리보기를 못 만들었습니다'); }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(b);
      });
    }

    if (p.startsWith('/www/')) return serveStatic(res, p.slice(5));

    res.writeHead(404); res.end('없는 주소');
  } catch (e) {
    sendJSON(res, 400, { ok: false, msg: (e && e.message) || String(e) });
  }
});

/* ══════════════════════════════════════════════════════════════════
   4. 편집 화면
   ══════════════════════════════════════════════════════════════════ */
const PAGE = `<!doctype html><html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>설명서 편집</title>
<style>
 :root{--bg:#f4f6f8;--sf:#fff;--bd:#dde3e9;--tx:#1c2429;--mu:#6b7785;--ac:#2a78d6;--ok:#1baf7a;--no:#e34948;}
 *{box-sizing:border-box;}
 body{margin:0;font:15px/1.6 'Malgun Gothic','맑은 고딕',system-ui,sans-serif;background:var(--bg);color:var(--tx);}
 header{position:sticky;top:0;z-index:10;background:var(--sf);border-bottom:1px solid var(--bd);
   padding:10px 14px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;}
 header b{font-size:16px;}
 #prog{background:#eef4fb;color:var(--ac);border-radius:999px;padding:3px 10px;font-size:13px;font-weight:700;}
 #save{font-size:13px;color:var(--mu);min-width:64px;}
 #save.on{color:var(--ok);font-weight:700;} #save.err{color:var(--no);font-weight:700;}
 header a{margin-left:auto;background:var(--ac);color:#fff;text-decoration:none;border-radius:8px;
   padding:8px 14px;font-size:14px;font-weight:700;}
 nav{background:var(--sf);border-bottom:1px solid var(--bd);padding:10px 14px;display:flex;gap:8px;align-items:center;}
 select{flex:1;min-width:0;min-height:42px;font:inherit;border:1px solid var(--bd);border-radius:8px;padding:0 10px;background:#fff;color:var(--tx);}
 nav button{min-width:46px;min-height:42px;border:1px solid var(--bd);background:#fff;border-radius:8px;font-size:18px;cursor:pointer;}
 main{max-width:760px;margin:0 auto;padding:14px 14px 80px;}
 label{display:block;font-size:12.5px;font-weight:700;color:var(--mu);margin:14px 0 4px;}
 input[type=text],textarea{width:100%;font:inherit;border:1px solid var(--bd);border-radius:8px;
   padding:9px 11px;background:#fff;color:var(--tx);}
 textarea{min-height:92px;resize:vertical;line-height:1.65;}
 input:focus,textarea:focus{outline:2px solid var(--ac);outline-offset:-1px;border-color:var(--ac);}
 .card{background:var(--sf);border:1px solid var(--bd);border-radius:12px;padding:12px 14px 16px;margin:14px 0;}
 .no{display:inline-block;background:#eef4fb;color:var(--ac);font-size:12px;font-weight:800;
   border-radius:6px;padding:2px 8px;margin-bottom:6px;}
 .drop{margin-top:12px;border:2px dashed #c3ccd6;border-radius:12px;background:#fafcfe;
   padding:16px;text-align:center;cursor:pointer;}
 .drop.over{border-color:var(--ac);background:#eef4fb;}
 .drop .want{font-size:13px;color:var(--mu);margin-bottom:8px;white-space:pre-wrap;}
 .drop .big{font-size:14px;font-weight:700;color:var(--ac);}
 .drop .hint{font-size:12px;color:var(--mu);margin-top:4px;}
 .shot{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;margin-top:12px;
   border:1px solid var(--bd);border-radius:12px;padding:10px;background:#fafcfe;}
 .shot img{width:104px;max-height:190px;object-fit:contain;border:1px solid var(--bd);border-radius:8px;background:#fff;}
 .shot .side{flex:1 1 180px;min-width:0;}
 .shot .row{display:flex;gap:8px;margin-top:8px;}
 .shot button{flex:1;min-height:38px;border:1px solid var(--bd);background:#fff;border-radius:8px;
   font:inherit;font-size:13px;white-space:nowrap;cursor:pointer;}
 .shot button.del{color:var(--no);}
 .tag{font-size:11.5px;color:var(--mu);}
 .empty{color:var(--mu);font-size:14px;padding:20px 0;text-align:center;}
</style></head><body>

<header>
  <b>설명서 편집</b>
  <span id="prog">그림 · · ·</span>
  <span id="save"></span>
  <a href="/preview.html" target="_blank" rel="noopener">미리보기</a>
</header>

<nav>
  <button type="button" id="prev" title="앞 칸">‹</button>
  <select id="sel"></select>
  <button type="button" id="next" title="다음 칸">›</button>
</nav>

<main id="main"><div class="empty">불러오는 중…</div></main>

<input type="file" id="pick" accept="image/*" style="display:none">

<script>
(function () {
  'use strict';
  var D = null, cur = 0, flat = [], lastDrop = null;

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  /* ── 저장 표시 ───────────────────────────────────────── */
  var sTimer = null;
  function mark(txt, cls) {
    var e = $('save'); e.textContent = txt; e.className = cls || '';
    clearTimeout(sTimer);
    if (cls !== 'err') sTimer = setTimeout(function () { e.textContent = ''; e.className = ''; }, 1800);
  }
  function post(url, obj) {
    mark('저장 중…');
    return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) throw new Error(j.msg || '저장 실패');
        mark('저장됨', 'on');
        return j;
      })
      .catch(function (e) { mark('저장 안 됨 — ' + e.message, 'err'); throw e; });
  }

  /* ── 불러오기 ───────────────────────────────────────── */
  function boot() {
    fetch('/api/data').then(function (r) { return r.json(); }).then(function (d) {
      D = d; flat = [];
      d.parts.forEach(function (p, pi) {
        p.secs.forEach(function (s, si) { flat.push({ pi: pi, si: si, p: p.p, t: s.t }); });
      });
      var sel = $('sel');
      sel.innerHTML = '';
      var og = null, lastP = null;
      flat.forEach(function (f, i) {
        if (f.p !== lastP) { og = document.createElement('optgroup'); og.label = f.p; sel.appendChild(og); lastP = f.p; }
        var o = document.createElement('option'); o.value = i; o.textContent = (i + 1) + '. ' + f.t;
        og.appendChild(o);
      });
      var keep = Number(sessionStorage.getItem('mnCur') || 0);
      cur = (keep >= 0 && keep < flat.length) ? keep : 0;
      sel.value = cur;
      draw();
    });
  }

  function prog() {
    var all = 0, got = 0;
    D.parts.forEach(function (p) { p.secs.forEach(function (s) { s.steps.forEach(function (t) {
      (t.img || []).forEach(function (im) { all++; if (im.src) got++; });
    }); }); });
    $('prog').textContent = '그림 ' + got + ' / ' + all;
  }

  /* ── 한 칸 그리기 ───────────────────────────────────── */
  function draw() {
    sessionStorage.setItem('mnCur', cur);
    $('sel').value = cur;
    var f = flat[cur], s = D.parts[f.pi].secs[f.si];
    var h = '';

    h += '<div class="card">';
    h += '<label>큰제목</label><input type="text" data-f="t" value="' + esc(s.t) + '">';
    h += '<label>한 줄 설명 (없어도 됩니다)</label><input type="text" data-f="s" value="' + esc(s.s || '') + '">';
    h += '</div>';

    s.steps.forEach(function (t, ti) {
      h += '<div class="card" data-ti="' + ti + '">';
      h += '<span class="no">' + (ti + 1) + '단계</span>';
      h += '<label>제목</label><input type="text" data-f="h" value="' + esc(t.h) + '">';
      h += '<label>설명 &nbsp;<span class="tag">**굵게** 로 감싸면 굵은 글씨가 됩니다</span></label>';
      h += '<textarea data-f="d">' + esc(t.d || '') + '</textarea>';
      (t.img || []).forEach(function (im, ii) {
        h += slotHTML(f, ti, ii, im);
      });
      h += '</div>';
    });

    h += '<div class="card">';
    h += '<label>도움말 (맨 아래 파란 상자 · 없어도 됩니다)</label>';
    h += '<input type="text" data-f="tip" value="' + esc(s.tip || '') + '">';
    h += '</div>';

    $('main').innerHTML = h;
    $('main').querySelectorAll('textarea').forEach(grow);
    wire(f, s);
    prog();
    window.scrollTo(0, 0);
  }

  /* 글이 길면 칸도 같이 길어진다 — 잘려 보이면 고칠 마음이 안 난다 */
  function grow(el) { el.style.height = 'auto'; el.style.height = (el.scrollHeight + 4) + 'px'; }

  function slotHTML(f, ti, ii, im) {
    var key = 'data-pi="' + f.pi + '" data-si="' + f.si + '" data-ti="' + ti + '" data-ii="' + ii + '"';
    if (im.src) {
      return '<div class="shot" ' + key + '>' +
        '<img src="/www/assets/manual/' + esc(im.src) + '?t=' + Date.now() + '" alt="">' +
        '<div class="side">' +
          '<label style="margin-top:0">그림 설명</label>' +
          '<input type="text" data-f="cap" value="' + esc(im.cap || '') + '">' +
          '<div class="row">' +
            '<button type="button" class="chg">바꾸기</button>' +
            '<button type="button" class="del">빼기</button>' +
          '</div>' +
          '<div class="tag" style="margin-top:6px">' + esc(im.src) + '</div>' +
        '</div></div>';
    }
    var want = im.cap || '이 단계에 어울리는 화면';
    return '<div class="drop" ' + key + ' tabindex="0">' +
      '<div class="want">찍어 올 화면 — ' + esc(want) + '</div>' +
      '<div class="big">사진을 여기로 끌어다 놓으세요</div>' +
      '<div class="hint">눌러서 고르기 · 복사한 사진은 여기 누르고 Ctrl+V</div>' +
      '</div>';
  }

  /* ── 손대면 저장 ────────────────────────────────────── */
  function wire(f, s) {
    var tmr = {};
    $('main').querySelectorAll('input[data-f],textarea[data-f]').forEach(function (el) {
      el.addEventListener('input', function () {
        if (el.tagName === 'TEXTAREA') grow(el);
        var fld = el.getAttribute('data-f');
        var box = el.closest('.shot');
        var card = el.closest('.card');
        var ti = card && card.getAttribute('data-ti');
        var q = { pi: f.pi, si: f.si, field: fld, value: el.value };
        if (fld === 'h' || fld === 'd') q.ti = Number(ti);
        if (fld === 'cap' && box) {
          q.ti = Number(box.getAttribute('data-ti'));
          q.ii = Number(box.getAttribute('data-ii'));
        }
        clearTimeout(tmr[fld + (q.ti || 0) + (q.ii || 0)]);
        tmr[fld + (q.ti || 0) + (q.ii || 0)] = setTimeout(function () {
          post('/api/text', q).then(function () {
            /* 화면에 들고 있는 값도 맞춰 둔다 (다시 그릴 때 옛 값이 안 나오게) */
            if (fld === 't') { s.t = el.value; flat[cur].t = el.value; $('sel').options[cur].textContent = (cur + 1) + '. ' + el.value; }
            else if (fld === 's') s.s = el.value;
            else if (fld === 'tip') s.tip = el.value;
            else if (fld === 'h') s.steps[q.ti].h = el.value;
            else if (fld === 'd') s.steps[q.ti].d = el.value;
            else if (fld === 'cap') s.steps[q.ti].img[q.ii].cap = el.value;
          });
        }, 500);
      });
    });

    $('main').querySelectorAll('.drop').forEach(function (z) {
      z.addEventListener('click', function () { lastDrop = z; $('pick').click(); });
      z.addEventListener('focus', function () { lastDrop = z; });
      z.addEventListener('dragover', function (e) { e.preventDefault(); z.classList.add('over'); });
      z.addEventListener('dragleave', function () { z.classList.remove('over'); });
      z.addEventListener('drop', function (e) {
        e.preventDefault(); z.classList.remove('over');
        var fl = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (fl) send(z, fl);
      });
    });

    $('main').querySelectorAll('.shot').forEach(function (b) {
      b.addEventListener('click', function () { lastDrop = b; });
      b.querySelector('.chg').addEventListener('click', function () { lastDrop = b; $('pick').click(); });
      b.querySelector('.del').addEventListener('click', function () {
        post('/api/imgclear', keyOf(b)).then(function () { reload(); });
      });
      b.addEventListener('dragover', function (e) { e.preventDefault(); });
      b.addEventListener('drop', function (e) {
        e.preventDefault();
        var fl = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (fl) send(b, fl);
      });
    });
  }

  function keyOf(el) {
    return { pi: +el.getAttribute('data-pi'), si: +el.getAttribute('data-si'),
             ti: +el.getAttribute('data-ti'), ii: +el.getAttribute('data-ii') };
  }

  /* ── 사진을 줄여서 보낸다 ───────────────────────────────
     ☠️ 폰 캡처는 한 장에 1~3MB 다. 62장이면 앱이 100MB 넘게 부푼다.
        그래서 브라우저에서 긴 변 1400px 로 줄이고 300KB 아래가 될 때까지
        품질을 낮춘다. 사용자는 아무것도 안 해도 된다. */
  function shrink(file, cb) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var MAX = 1400;
      var r = Math.min(1, MAX / Math.max(img.width, img.height));
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * r));
      c.height = Math.max(1, Math.round(img.height * r));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      var q = 0.85, out = '';
      for (;;) {
        out = c.toDataURL('image/jpeg', q);
        if (out.length * 0.75 < 300 * 1024 || q <= 0.45) break;
        q -= 0.1;
      }
      URL.revokeObjectURL(url);
      cb(out.split(',')[1]);
    };
    img.onerror = function () { URL.revokeObjectURL(url); mark('사진을 못 읽었습니다', 'err'); };
    img.src = url;
  }

  function send(el, file) {
    if (!/^image\\//.test(file.type)) { mark('사진 파일만 됩니다', 'err'); return; }
    mark('사진 줄이는 중…');
    shrink(file, function (b64) {
      var q = keyOf(el); q.b64 = b64; q.type = 'image/jpeg';
      post('/api/img', q).then(function (j) { mark('넣었습니다 (' + j.kb + 'KB)', 'on'); reload(); });
    });
  }

  function reload() {
    fetch('/api/data').then(function (r) { return r.json(); }).then(function (d) { D = d; draw(); });
  }

  $('pick').addEventListener('change', function () {
    var fl = this.files && this.files[0];
    if (fl && lastDrop) send(lastDrop, fl);
    this.value = '';
  });

  document.addEventListener('paste', function (e) {
    if (!lastDrop) return;
    var it = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < it.length; i++) {
      if (it[i].type && it[i].type.indexOf('image/') === 0) {
        var fl = it[i].getAsFile();
        if (fl) { e.preventDefault(); send(lastDrop, fl); return; }
      }
    }
  });

  $('sel').addEventListener('change', function () { cur = Number(this.value); draw(); });
  $('prev').addEventListener('click', function () { if (cur > 0) { cur--; draw(); } });
  $('next').addEventListener('click', function () { if (cur < flat.length - 1) { cur++; draw(); } });

  boot();
})();
<\/script></body></html>`;

/* ══════════════════════════════════════════════════════════════════
   5. 켠다
   ══════════════════════════════════════════════════════════════════ */
function lanIPs() {
  const out = [];
  const n = os.networkInterfaces();
  Object.keys(n).forEach((k) => (n[k] || []).forEach((a) => {
    if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }));
  return out;
}

if (require.main === module) {
  srv.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  설명서 편집 화면을 켰습니다.');
    console.log('');
    console.log('    이 PC 에서   →  http://localhost:' + PORT);
    lanIPs().forEach((ip) => {
      console.log('    휴대폰에서   →  http://' + ip + ':' + PORT + '   (같은 와이파이)');
    });
    console.log('');
    console.log('  고치는 즉시 저장됩니다. 끝내려면 이 창에서 Ctrl+C.');
    console.log('');
  });
}

module.exports = { emit, parse, splitHead, norm, slit, esc, imgName, freeName };
