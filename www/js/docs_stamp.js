/* ═══════════════════════════════════════════════════════════════════
   docs_stamp.js — 견적서·거래명세서 엑셀에 직인(도장)을 찍는다  (2026-09-21)
   ----------------------------------------------------------------
   xlsx 는 속이 압축 파일이다. 그림을 넣으려면 파일 네 개를 보태고
   두 개를 고쳐야 한다. 엑셀이 하나라도 어긋나면 "파일이 손상되었습니다" 를
   띄우고 통째로 안 열리므로, 아래 순서를 지킨다.

     보태는 것
       xl/media/stamp1.png             ← 도장 그림
       xl/drawings/drawing1.xml        ← 어느 칸 위에 얼마 크기로 놓을지
       xl/drawings/_rels/drawing1.xml.rels  ← 그림이 위 png 를 가리키게
       xl/worksheets/_rels/sheet1.xml.rels  ← 시트가 위 drawing 을 가리키게(없으면 새로)
     고치는 것
       [Content_Types].xml             ← png 와 drawing 의 종류를 알린다
       xl/worksheets/sheet1.xml        ← 맨 끝에 <drawing r:id="…"/> 한 줄

   ☠️ 조심할 것
     · <drawing> 은 **</worksheet> 바로 앞**에 와야 한다. pageSetup·headerFooter
       뒤가 제자리다. 앞에 넣으면 엑셀이 파일을 거부한다.
     · 거래명세서 양식은 시트 뿌리에 xmlns:r 이 **없다.** r:id 를 쓰려면
       그 선언을 먼저 넣어야 한다. 견적서 양식에는 이미 있다(둘을 같이 다뤄야 한다).
     · rels 파일의 rId 번호는 **이미 쓰는 번호를 피해서** 붙인다.
       견적서 양식은 rId1 을 프린터 설정이 쓰고 있다.
     · 한 장에 도장을 두 번 찍는 양식이 있다(거래명세서는 보관용이 두 벌).
       그림 하나를 여러 자리에 놓는다 — png 는 한 번만 넣는다.

   ⚠️ 이 파일은 브라우저와 Node 양쪽에서 쓴다(시험이 Node 에서 돈다).
═══════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DocsStamp = api;
}(this, function () {
  'use strict';

  var NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var EMU_PER_CM = 360000;

  /* 도장 크기 — 실제 막도장이 2cm 안팎이다 */
  var DEFAULT_CM = 2.0;

  function emu(cm) { return Math.round(cm * EMU_PER_CM); }

  /* dataUrl(또는 순수 base64) → 바이트 */
  function toBytes(data) {
    var b64 = String(data || '');
    var at = b64.indexOf(',');
    if (b64.slice(0, 5) === 'data:' && at > 0) b64 = b64.slice(at + 1);
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* 이미 쓰고 있는 rId 를 피해 새 번호를 준다 */
  function nextRid(relsXml) {
    var max = 0, m, re = /Id="rId(\d+)"/g;
    while ((m = re.exec(relsXml || ''))) max = Math.max(max, +m[1]);
    return 'rId' + (max + 1);
  }

  function drawingXml(spots) {
    var body = spots.map(function (s, i) {
      var cx = emu(s.cm || DEFAULT_CM), cy = cx;
      return '<xdr:oneCellAnchor>' +
        '<xdr:from>' +
          '<xdr:col>' + s.col + '</xdr:col><xdr:colOff>' + emu(s.dx || 0) + '</xdr:colOff>' +
          '<xdr:row>' + s.row + '</xdr:row><xdr:rowOff>' + emu(s.dy || 0) + '</xdr:rowOff>' +
        '</xdr:from>' +
        '<xdr:ext cx="' + cx + '" cy="' + cy + '"/>' +
        '<xdr:pic>' +
          '<xdr:nvPicPr>' +
            '<xdr:cNvPr id="' + (i + 1) + '" name="직인' + (i + 1) + '"/>' +
            '<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr>' +
          '</xdr:nvPicPr>' +
          '<xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
          '<xdr:spPr>' +
            '<a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
          '</xdr:spPr>' +
        '</xdr:pic>' +
        '<xdr:clientData/>' +
      '</xdr:oneCellAnchor>';
    }).join('');

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"' +
      ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
      ' xmlns:r="' + NS_R + '">' + body + '</xdr:wsDr>';
  }

  /* ── 본체 ──────────────────────────────────────────────────────
     zip    : JSZip 인스턴스 (이미 xlsx 를 읽어 둔 것)
     png    : dataUrl 또는 base64
     spots  : [{col, row, cm, dx, dy}]  col·row 는 0부터 센다
     돌려주는 값: 찍었으면 true, 넣을 게 없으면 false */
  async function apply(zip, png, spots) {
    if (!zip || !png || !spots || !spots.length) return false;

    var sheetPath = 'xl/worksheets/sheet1.xml';
    var relsPath = 'xl/worksheets/_rels/sheet1.xml.rels';
    var ctPath = '[Content_Types].xml';

    var sheet = await zip.file(sheetPath).async('string');
    if (sheet.indexOf('<drawing ') >= 0) return false;       /* 이미 찍혀 있다 */

    /* ① 그림 파일과 그림 설명서 */
    zip.file('xl/media/stamp1.png', toBytes(png), { binary: true });
    zip.file('xl/drawings/drawing1.xml', drawingXml(spots));
    zip.file('xl/drawings/_rels/drawing1.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="' + NS_R + '/image" Target="../media/stamp1.png"/>' +
      '</Relationships>');

    /* ② 시트 → 그림 연결. rels 가 아예 없는 양식도 있다(거래명세서) */
    var rels = zip.file(relsPath) ? await zip.file(relsPath).async('string') : null;
    var rid;
    if (rels) {
      rid = nextRid(rels);
      rels = rels.replace('</Relationships>',
        '<Relationship Id="' + rid + '" Type="' + NS_R + '/drawing" Target="../drawings/drawing1.xml"/>' +
        '</Relationships>');
    } else {
      rid = 'rId1';
      rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="' + NS_R + '/drawing" Target="../drawings/drawing1.xml"/>' +
        '</Relationships>';
    }
    zip.file(relsPath, rels);

    /* ③ 종류 알리기 — png 는 Default, drawing 은 Override */
    var ct = await zip.file(ctPath).async('string');
    if (ct.indexOf('Extension="png"') < 0) {
      ct = ct.replace('<Types ', '<Types ')
             .replace(/(<Types[^>]*>)/, '$1<Default Extension="png" ContentType="image/png"/>');
    }
    if (ct.indexOf('/xl/drawings/drawing1.xml') < 0) {
      ct = ct.replace('</Types>',
        '<Override PartName="/xl/drawings/drawing1.xml" ' +
        'ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');
    }
    zip.file(ctPath, ct);

    /* ④ 시트 뿌리에 xmlns:r 이 없으면 넣는다 (거래명세서 양식이 그렇다) */
    if (!/<worksheet[^>]*xmlns:r=/.test(sheet)) {
      sheet = sheet.replace(/<worksheet([^>]*)>/, '<worksheet$1 xmlns:r="' + NS_R + '">');
    }

    /* ⑤ ☠️ <drawing> 은 반드시 </worksheet> 바로 앞 */
    sheet = sheet.replace('</worksheet>', '<drawing r:id="' + rid + '"/></worksheet>');
    zip.file(sheetPath, sheet);

    return true;
  }

  /* 양식마다 도장이 앉을 자리 — 0부터 센 열·행 번호.
     ⚠️ 셀 주소를 바꾸면 양식도 같이 바꿨는지 확인할 것.
        견적서   : 공급자 칸 「등록번호 / 대표 ○○○」 줄 오른쪽
        거래명세서: 공급자 「성명」 칸 옆. 한 장에 두 벌이라 22행 아래에도 한 번 더 */
  var SPOTS = {
    /* 견적서 — 「등록번호 … / 대표 ○○○」 줄에서 **대표 이름 오른쪽**.
       ☠️ 2026-09-22 사용자 신고 — 예전 자리(col 11, row 2)는 상호 「미래솔루션」과
          등록번호 숫자를 덮어 둘 다 못 읽었다. 도장이 글자를 가리면 서류가 못 쓴다.
       측정해서 정한 값이다(사용자가 보내 준 화면 기준, 열 너비는 양식에서 읽었다).
         · M열(col 12) 왼쪽 끝에서 2.65cm → 「배성철」 끝 바로 오른쪽
         · 1.7cm 로 줄여서 표 오른쪽 테두리(M열 끝)를 넘지 않는다
         · row 3(=4행) 위에서 0.25cm 올려 그 줄 한가운데 오게 한다
       ⚠️ 이 네 값은 한 묶음이다. 양식의 열 너비(M열 18.33)를 바꾸면 다시 재야 한다. */
    quote:     [{ col: 12, row: 3, dx: 2.65, dy: -0.25, cm: 1.7 }],
    /* 거래명세서 — 공급자 「성명」 칸의 오른쪽 끝. 이름을 쓰고 그 옆에 찍는 모양이 된다.
       ☠️ 이 양식은 한 장에 두 벌(공급받는자 보관용·공급자 보관용)이라 22행 아래에 한 번 더. */
    statement: [{ col: 7, row: 4,  dx: 0.05, dy: -0.10, cm: 1.6 },
                { col: 7, row: 26, dx: 0.05, dy: -0.10, cm: 1.6 }]
  };

  return { apply: apply, SPOTS: SPOTS, DEFAULT_CM: DEFAULT_CM, _drawingXml: drawingXml, _nextRid: nextRid };
}));
