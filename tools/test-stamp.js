/* ═══════════════════════════════════════════════════════════════════
   tools/test-stamp.js — 견적서·거래명세서에 직인이 제대로 박히는지
   ----------------------------------------------------------------
   ☠️ xlsx 는 한 군데만 어긋나도 엑셀이 "파일이 손상되었습니다" 를 띄우고
      **통째로 안 열린다.** 서류가 안 열리면 그날 일이 멈춘다.
      그래서 실제 양식 파일에 진짜로 찍어 보고, 들어가야 할 것이 다 들어갔는지 센다.

   여기서 잡는 사고 —
     · <drawing> 을 </worksheet> 앞이 아닌 곳에 넣는 것
     · 거래명세서 양식에 xmlns:r 선언을 빠뜨리는 것 (그 양식엔 원래 없다)
     · 이미 쓰는 rId 번호를 덮어쓰는 것 (견적서는 rId1 을 프린터가 쓴다)
     · [Content_Types].xml 에 png·drawing 을 안 알리는 것
     · 한 장에 두 벌인 거래명세서에 도장을 한 번만 찍는 것
═══════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const JSZip = require(path.join(ROOT, 'www', 'js', 'jszip.min.js'));
const S = require(path.join(ROOT, 'www', 'js', 'docs_stamp.js'));
const TPL = path.join(ROOT, 'www', 'assets', 'templates');

let pass = 0; const fails = [];
function chk(n, fn) {
  return Promise.resolve().then(fn).then((r) => { pass++; console.log('  ✅ ' + n + (r ? ' — ' + r : '')); })
    .catch((e) => { fails.push(n + '\n      ' + (e.message || e)); console.log('  ❌ ' + n + '\n      ' + (e.message || e)); });
}
function must(c, m) { if (!c) throw new Error(m); }

/* 1x1 짜리 투명 png — 진짜 도장 대신 쓴다 */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function stamped(file, kind) {
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(TPL, file)));
  const ok = await S.apply(zip, PNG, S.SPOTS[kind]);
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { ok, zip: await JSZip.loadAsync(buf) };
}

(async function () {
  console.log('\n── 견적서 ──');
  const q = await stamped('quote_template2.xlsx', 'quote');

  await chk('찍혔다고 답한다', () => { must(q.ok === true, 'apply 가 false 를 돌려줬습니다'); return 'true'; });

  await chk('들어가야 할 파일이 다 들어갔다', async () => {
    ['xl/media/stamp1.png', 'xl/drawings/drawing1.xml', 'xl/drawings/_rels/drawing1.xml.rels',
     'xl/worksheets/_rels/sheet1.xml.rels'].forEach((n) => must(q.zip.file(n), '없습니다: ' + n));
    return '4개';
  });

  await chk('☠️ <drawing> 이 </worksheet> 바로 앞에 있다', async () => {
    /* 자리가 틀리면 엑셀이 파일을 거부한다 */
    const s = await q.zip.file('xl/worksheets/sheet1.xml').async('string');
    must(/<drawing r:id="rId\d+"\/><\/worksheet>$/.test(s.trim()), '자리가 틀렸습니다');
    return '맞음';
  });

  await chk('☠️ 이미 쓰는 rId 를 덮어쓰지 않는다', async () => {
    /* 이 양식은 rId1 을 프린터 설정이 쓴다. 덮으면 인쇄 설정이 날아간다 */
    const r = await q.zip.file('xl/worksheets/_rels/sheet1.xml.rels').async('string');
    must(/printerSettings/.test(r), '프린터 설정 연결이 사라졌습니다');
    const ids = (r.match(/Id="(rId\d+)"/g) || []);
    must(new Set(ids).size === ids.length, 'rId 가 겹칩니다: ' + ids.join(','));
    const s = await q.zip.file('xl/worksheets/sheet1.xml').async('string');
    const used = (s.match(/<drawing r:id="(rId\d+)"/) || [])[1];
    must(used !== 'rId1', '프린터가 쓰는 rId1 을 가져갔습니다');
    return used;
  });

  await chk('종류를 알린다 ([Content_Types].xml)', async () => {
    const ct = await q.zip.file('[Content_Types].xml').async('string');
    must(/Extension="png"/.test(ct), 'png 종류가 없습니다');
    must(/\/xl\/drawings\/drawing1\.xml/.test(ct), 'drawing 종류가 없습니다');
    return '둘 다';
  });

  await chk('셀 값은 그대로 남아 있다', async () => {
    /* 도장을 넣다가 시트를 망가뜨리면 안 된다 */
    const before = await (await JSZip.loadAsync(fs.readFileSync(path.join(TPL, 'quote_template2.xlsx'))))
      .file('xl/worksheets/sheet1.xml').async('string');
    const after = await q.zip.file('xl/worksheets/sheet1.xml').async('string');
    must(after.length >= before.length, '시트가 줄었습니다');
    must(after.indexOf('<sheetData>') === before.indexOf('<sheetData>'), '시트 앞부분이 바뀌었습니다');
    return '그대로';
  });

  console.log('\n── 거래명세서 ──');
  const t = await stamped('statement_template6.xlsx', 'statement');

  await chk('☠️ xmlns:r 선언을 넣는다 (이 양식엔 원래 없다)', async () => {
    const s = await t.zip.file('xl/worksheets/sheet1.xml').async('string');
    must(/<worksheet[^>]*xmlns:r="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships"/.test(s),
         'xmlns:r 이 없습니다 — 엑셀이 r:id 를 못 읽습니다');
    return '넣음';
  });

  await chk('☠️ rels 파일이 없던 양식이라 새로 만든다', async () => {
    must(t.zip.file('xl/worksheets/_rels/sheet1.xml.rels'), 'rels 를 안 만들었습니다');
    return '만듦';
  });

  await chk('☠️ 한 장에 두 벌이라 도장도 두 번 찍는다', async () => {
    /* 공급받는자 보관용·공급자 보관용 — 한쪽만 찍히면 반쪽짜리 서류가 된다 */
    const d = await t.zip.file('xl/drawings/drawing1.xml').async('string');
    const n = (d.match(/<xdr:oneCellAnchor>/g) || []).length;
    must(n === 2, '도장이 ' + n + '군데입니다 (2군데여야 합니다)');
    const rows = (d.match(/<xdr:row>(\d+)<\/xdr:row>/g) || []).map((x) => +x.replace(/\D/g, ''));
    must(rows[1] - rows[0] === 22, '두 번째 자리가 22행 아래가 아닙니다: ' + rows.join(','));
    return '2군데 · 22행 간격';
  });

  console.log('\n── 안 넣었을 때 ──');

  await chk('도장이 없으면 아무것도 안 건드린다', async () => {
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(TPL, 'quote_template2.xlsx')));
    const ok = await S.apply(zip, '', S.SPOTS.quote);
    must(ok === false, 'false 를 안 돌려줬습니다');
    must(!zip.file('xl/media/stamp1.png'), '그림을 넣었습니다');
    return '그대로';
  });

  await chk('두 번 찍어도 겹쳐 넣지 않는다', async () => {
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(TPL, 'quote_template2.xlsx')));
    await S.apply(zip, PNG, S.SPOTS.quote);
    const again = await S.apply(zip, PNG, S.SPOTS.quote);
    must(again === false, '두 번째도 찍었습니다 — 그림이 두 겹이 됩니다');
    const s = await zip.file('xl/worksheets/sheet1.xml').async('string');
    must((s.match(/<drawing /g) || []).length === 1, '<drawing> 이 두 개입니다');
    return '한 번만';
  });

  await chk('도장 크기가 실제 도장만 하다', () => {
    const cm = S.SPOTS.quote[0].cm;
    must(cm >= 1.2 && cm <= 2.6, '크기가 ' + cm + 'cm 입니다 (막도장은 2cm 안팎)');
    return cm + 'cm';
  });

  /* ═══ 도장이 앉는 자리 ═══════════════════════════════════════════
     ☠️ 2026-09-22 사용자 신고 — 도장이 상호 「미래솔루션」과 등록번호 숫자를
        덮어 둘 다 못 읽었다. 글자를 가리는 도장은 서류를 못 쓰게 만든다.
     ⭐ 그래서 '보기에 예쁜가' 가 아니라 **글자와 테두리를 안 건드리는가** 를 잰다.
        열 너비는 양식에서 직접 읽는다 — 양식을 고치면 이 시험이 먼저 깨진다. */
  await chk('도장이 대표 이름 오른쪽, 표 안에 들어간다', async () => {
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(TPL, 'quote_template2.xlsx')));
    const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');

    /* 엑셀 열 너비(글자 단위) → cm. 기본 글꼴 기준 픽셀 = 너비×9+5 (96dpi) */
    const W = {};
    const re = /<col min="(\d+)" max="(\d+)"[^>]*width="([\d.]+)"/g;
    let m;
    while ((m = re.exec(sheet))) {
      for (let c = +m[1]; c <= +m[2] && c <= 40; c++) W[c] = +m[3];
    }
    const cmOf = (c) => (Math.round((W[c] || 8.88671875) * 9 + 5)) / 96 * 2.54;
    const leftCm = (col0) => {            /* 0부터 센 열의 왼쪽 끝 */
      let x = 0;
      for (let c = 1; c <= col0; c++) x += cmOf(c);
      return x;
    };

    const sp = S.SPOTS.quote[0];
    const L = leftCm(sp.col) + sp.dx;     /* 도장 왼쪽 */
    const R = L + sp.cm;                  /* 도장 오른쪽 */
    const boxR = leftCm(13);              /* 표 오른쪽 테두리 = M열(0부터 12) 끝 */

    must(R <= boxR, '도장이 표 오른쪽 테두리를 ' + (R - boxR).toFixed(2) + 'cm 넘습니다');
    must(boxR - R < 0.6, '도장이 테두리에서 ' + (boxR - R).toFixed(2) + 'cm 나 떨어져 있습니다 — 오른쪽 끝에 붙여야 합니다');

    /* 「등록번호 … / 대표 ○○○」 는 J4:M4 병합칸에 **가운데 정렬**이다.
       그래서 글자는 가운데에서 양옆으로 자란다 — 도장은 그 한계선 밖에 있어야 한다. */
    const mergedL = leftCm(9), ctr = (mergedL + boxR) / 2;
    const room = (L - ctr) * 2;           /* 도장을 안 건드리고 글자가 쓸 수 있는 폭 */
    must(room >= 9.5, '글자가 쓸 수 있는 폭이 ' + room.toFixed(2) + 'cm 뿐입니다 — 「등록번호 333-06-12345 / 대표 배성철」이 도장에 닿습니다');

    /* 세로 — 그 줄(4행) 위에 걸쳐야 한다. 위 줄(상호)까지 올라가면 상호를 덮는다. */
    must(sp.row === 3, '도장이 ' + (sp.row + 1) + '행에 있습니다 — 「대표」 줄은 4행입니다');
    must(sp.dy > -0.6 && sp.dy < 0.3, '세로 치우침이 ' + sp.dy + 'cm 입니다 — 윗줄 상호를 덮습니다');

    return '왼쪽 ' + L.toFixed(2) + 'cm · 오른쪽 ' + R.toFixed(2) + 'cm (테두리 ' + boxR.toFixed(2) + 'cm) · 글자 여유 ' + room.toFixed(2) + 'cm';
  });

  console.log('');
  if (fails.length) { console.log('❌ ' + fails.length + '개 실패\n'); fails.forEach((f) => console.log('  · ' + f)); process.exit(1); }
  console.log('✅ 전부 통과 (' + pass + '개)\n');
})();
