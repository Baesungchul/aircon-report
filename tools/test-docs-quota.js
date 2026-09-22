/* ═══════════════════════════════════════════════════════════════════
   tools/test-docs-quota.js — 엑셀 견적서·거래명세서 횟수 차감
   ----------------------------------------------------------------
   왜 넣었나 (2026-09-22)
     엑셀 견적서와 거래명세서에는 아무 확인이 없어서 무료 플랜에서 무제한으로
     만들어졌다. 스토어 등록정보를 쓰다가 이걸 발견했다 — 요금 안내에 적을 수도,
     안 적을 수도 없는 상태였다. 문서 1건에 AI 글작성 1회를 쓰도록 맞춘다.

   ⭐ 이 시험이 지키는 것 — 돈이 걸린 자리라 셋 다 어긋나면 안 된다.
     ① 확인은 만들기 **전에**. 다 만들어 놓고 못 준다고 하면 안 된다.
     ② 차감은 만들어진 **뒤에**. 생성이 실패했는데 횟수가 줄면 안 된다.
     ③ 세는 단위는 '문서 1건'. 같은 문서를 다운로드하고 또 공유했다고
        두 번 빼면 사용자는 속았다고 느낀다.
═══════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
/* ☠️ 찾는 글자가 그 글자를 설명하는 주석에도 들어 있다 — 주석부터 걷어낸다. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const DX_RAW = rd('www', 'js', 'docs_excel.js');
const DX = strip(DX_RAW);
const SUBS = strip(rd('www', 'js', 'subscription.js'));

let pass = 0;
const fails = [];
const jobs = [];
function chk(name, fn) { jobs.push([name, fn]); }
function say(line) { jobs.push([line, null]); }
function must(c, m) { if (!c) throw new Error(m); }
async function runAll() {
  for (const [name, fn] of jobs) {
    if (fn === null) { console.log(name); continue; }
    try {
      const n = await fn();
      if (n && typeof n.then === 'function') throw new Error('시험이 Promise 를 돌려줬습니다');
      pass++; console.log('  ✅ ' + name + (n ? ' — ' + n : ''));
    } catch (e) { fails.push(name); console.log('  ❌ ' + name + ' — ' + ((e && e.message) || e)); }
  }
}

/* run() 을 떼어 실제로 돌린다. 글자만 찾아서는 ①②③ 중 무엇도 확인되지 않는다. */
function harness(opt) {
  opt = opt || {};
  const at = DX_RAW.indexOf('    var DOC_KIND =');
  must(at > 0, 'DOC_KIND 를 못 찾았습니다');
  const end = DX_RAW.indexOf("    ov.querySelector('#dxDownload').onclick");
  must(end > at, 'run() 끝을 못 찾았습니다');
  const src = DX_RAW.slice(at, end);

  const log = [];
  const Subs = {
    isAdmin: () => false,
    quotaText: () => '무료 총 3회 중 3회 남음',
    gateAI: (kind, retry) => { log.push(['gate', kind, retry]); return opt.allow !== false; },
    consumeAI: (kind) => { log.push(['consume', kind]); }
  };
  const el = { textContent: '' };
  const ov = { querySelector: () => el };
  const ctxFor = (items) => ({ custName: 'ㄱ상사', bizNo: '1', date: '2026-09-22',
    vat: true, items: items || [{ name: '청소', spec: '', qty: 1, price: 1000 }] });

  /* ⚠️ 실제 코드는 window.Subs 로 있는지 보고 나서 맨 Subs 로 부른다.
       브라우저에서는 window 속성이 전역이라 되지만 여기서는 아니다 — 둘 다 넘긴다. */
  const f = new Function('ov', 'window', 'Subs', 'console', 'kind', 'isQuote', 'toast', 'makeCtx',
    'learnMaybe', 'DocsTemplate', 'genFromTemplate', 'shareOrDownload', 'fname', 'quoteEdits', 'statementEdits', 'log',
    src + '; return { run: run, refreshQuota: refreshQuota, ctxSig: ctxSig };');

  let items = null;
  const api = f(ov, { Subs: Subs, DocsTemplate: null }, Subs,
    { error: () => {}, warn: () => {}, log: () => {} }, 'quote', true,
    () => {}, () => ctxFor(items), () => {}, null,
    async () => { log.push(['gen']); if (opt.genFails) throw new Error('생성 실패'); return {}; },
    async () => { log.push(['sent']); }, () => 'x.xlsx', () => [], () => [], log);
  api.log = log;
  api.setItems = (v) => { items = v; };
  api.el = el;
  return api;
}

say('\n🧾 엑셀 견적서·거래명세서 — 문서 1건에 1회\n');

chk('만들기 전에 잔량을 확인한다 (만들어 놓고 못 준다고 하면 안 된다)', async () => {
  const A = harness();
  await A.run('download');
  const gate = A.log.findIndex(x => x[0] === 'gate');
  const gen = A.log.findIndex(x => x[0] === 'gen');
  must(gate >= 0, '잔량 확인을 하지 않습니다');
  must(gen >= 0 && gate < gen, '확인이 생성보다 뒤에 있습니다');
  return '확인 → 생성';
});

chk('차감은 글작성(blog) 횟수에서 한다', async () => {
  const A = harness();
  await A.run('download');
  const c = A.log.find(x => x[0] === 'consume');
  const g = A.log.find(x => x[0] === 'gate');
  must(c && c[1] === 'blog', '차감한 항목이 ' + (c && c[1]) + ' 입니다');
  must(g && g[1] === 'blog', '확인한 항목이 ' + (g && g[1]) + ' 입니다');
  return 'blog 1회';
});

chk('차감은 파일이 만들어진 뒤에 한다', async () => {
  const A = harness();
  await A.run('download');
  const sent = A.log.findIndex(x => x[0] === 'sent');
  const con = A.log.findIndex(x => x[0] === 'consume');
  must(con >= 0 && sent >= 0 && sent < con, '보내기 전에 차감했습니다');
  return '생성 → 차감';
});

chk('생성이 실패하면 횟수를 쓰지 않는다', async () => {
  const A = harness({ genFails: true });
  await A.run('download');
  must(!A.log.some(x => x[0] === 'consume'), '실패했는데 횟수를 뺐습니다');
  return '차감 없음';
});

chk('잔량이 없으면 만들지도 않는다', async () => {
  const A = harness({ allow: false });
  await A.run('download');
  must(!A.log.some(x => x[0] === 'gen'), '잔량이 없는데 생성이 돌았습니다');
  must(!A.log.some(x => x[0] === 'consume'), '잔량이 없는데 차감했습니다');
  return '멈춤';
});

chk('같은 문서를 다운로드하고 또 공유해도 1회만 뺀다', async () => {
  const A = harness();
  await A.run('download');
  await A.run('share');
  const n = A.log.filter(x => x[0] === 'consume').length;
  must(n === 1, '차감이 ' + n + '회입니다 — 같은 문서를 두 번 셌습니다');
  return '1회';
});

chk('같은 내용이면 지문이 같다 (시각·횟수에 안 흔들린다)', async () => {
  /* ☠️ 위의 '1회만 뺀다' 는 지문에 Date.now() 를 섞어 놔도 통과했다 —
       두 번 부르는 사이가 같은 밀리초였기 때문이다. 지문 자체를 직접 본다. */
  const A = harness();
  const c = { custName: 'ㄱ상사', bizNo: '1', date: '2026-09-22', vat: true,
              items: [{ name: '청소', spec: '', qty: 1, price: 1000 }] };
  const a1 = A.ctxSig(c);
  await new Promise(r => setTimeout(r, 30));
  const a2 = A.ctxSig(JSON.parse(JSON.stringify(c)));
  must(a1 === a2, '같은 내용인데 지문이 다릅니다 — 다운로드하고 공유하면 2회 빠집니다');
  const b = A.ctxSig(Object.assign({}, c, { items: [{ name: '청소', spec: '', qty: 2, price: 1000 }] }));
  must(a1 !== b, '내용이 달라졌는데 지문이 같습니다 — 고쳐서 다시 만들어도 안 빠집니다');
  return '내용만 반영';
});

chk('내용을 고치면 새 문서로 보고 다시 1회를 뺀다', async () => {
  const A = harness();
  await A.run('download');
  A.setItems([{ name: '청소', spec: '', qty: 2, price: 1000 }]);   // 수량만 바꿈
  await A.run('download');
  const n = A.log.filter(x => x[0] === 'consume').length;
  must(n === 2, '차감이 ' + n + '회입니다 — 내용이 달라졌는데 같은 문서로 셌습니다');
  return '2회';
});

chk('두 번째 만들기 전에도 잔량을 다시 확인한다', async () => {
  const A = harness();
  await A.run('download');
  A.setItems([{ name: '청소', spec: '', qty: 3, price: 1000 }]);
  await A.run('download');
  const n = A.log.filter(x => x[0] === 'gate').length;
  must(n === 2, '확인이 ' + n + '회입니다 — 두 번째는 잔량 없이도 만들어집니다');
  return '2회 확인';
});

chk('로그인 뒤에 이어서 하도록 누른 버튼을 넘긴다', async () => {
  const A = harness();
  await A.run('share');
  const g = A.log.find(x => x[0] === 'gate');
  must(g[2] === 'dxShare', '이어할 버튼이 ' + g[2] + ' 입니다 (dxShare 여야 함)');
  const B = harness();
  await B.run('download');
  must(B.log.find(x => x[0] === 'gate')[2] === 'dxDownload', '다운로드 쪽 버튼이 다릅니다');
  return 'dxShare / dxDownload';
});

say('\n👀 화면에 남은 횟수가 보이는가\n');

chk('창을 열면 남은 횟수가 적힌다', () => {
  const A = harness();
  must(/AI 글작성 1회/.test(A.el.textContent), '안내 문구가 없습니다: ' + A.el.textContent);
  must(/남음/.test(A.el.textContent), '잔량이 안 붙었습니다: ' + A.el.textContent);
  return A.el.textContent;
});

chk('만들고 나면 남은 횟수 표시를 새로 그린다', async () => {
  const A = harness();
  A.el.textContent = '';
  await A.run('download');
  must(A.el.textContent, '차감 후에도 표시가 비어 있습니다 — 사용자는 줄어든 걸 못 봅니다');
  return '갱신됨';
});

chk('창에 붙일 자리(#dxQuota)가 실제로 있다', () => {
  must(/id="dxQuota"/.test(DX), '#dxQuota 칸이 없습니다');
  const q = DX.indexOf('id="dxQuota"');
  const b = DX.indexOf("id=\"dxDownload\"");
  must(q > 0 && b > 0 && q < b, '남은 횟수가 버튼 아래에 있습니다 — 누르기 전에 보여야 합니다');
  return '버튼 위';
});

say('\n🔒 다른 곳의 차감과 어긋나지 않는가\n');

chk('문자용 견적서는 예전대로 일정등록(sched) 을 쓴다', () => {
  /* ⚠️ ai.js 는 strip() 을 태우지 않는다. 그 안에 /* 를 품은 문자열이 있어
       주석 제거기가 파일 절반을 통째로 먹는다. 여기서 찾는 것은 주석에 나올 만한
       모양이 아니므로 원문 그대로 본다. */
  const AI = rd('www', 'js', 'ai.js');
  must(/gateAI\('sched',\s*'aiQuoteGo'\)/.test(AI), '문자용 견적서의 차감 항목이 바뀌었습니다');
  must(!/gateAI\('blog',\s*'aiQuoteGo'\)/.test(AI), '문자용 견적서가 blog 로 바뀌었습니다');
  return 'sched 유지';
});

chk('사업자등록증 분석도 예전대로 sched 를 쓴다', () => {
  must(/gateAI\('sched'/.test(DX), '사업자등록증 분석의 차감 항목이 바뀌었습니다');
  return 'sched 유지';
});

chk('blog 는 요금제에 실제로 있는 항목이다', () => {
  must(/FREE_INIT\s*=\s*\{[^}]*blog:/.test(SUBS), 'FREE_INIT 에 blog 가 없습니다');
  must(/lite:[^\n]*blog:\s*\d+/.test(SUBS), '유료 플랜에 blog 한도가 없습니다');
  return '있음';
});

runAll().then(function () {
  console.log('');
  if (fails.length) {
    console.log('❌ ' + fails.length + '개 실패: ' + fails.join(', ') + '\n');
    process.exit(1);
  }
  console.log('✅ ' + pass + '개 모두 통과\n');
});
