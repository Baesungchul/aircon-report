/* ═══════════════════════════════════════════════════════════
   DOCS TEMPLATE ─ 사용자가 올린 엑셀 양식에 값 채우기 (2026-08-13)

   왜 필요한가:
     기존에는 앱 내장 양식(assets/templates/*.xlsx)에만 값을 넣을 수 있었다.
     셀 주소(D2=문서번호, J3=상호 …)가 코드에 박혀 있어서, 업체가 쓰던 양식을
     올려도 어디에 무엇을 넣을지 알 수 없었기 때문이다.

   어떻게 하나:
     올린 양식의 '글자'를 읽어 라벨을 찾고, 그 옆(또는 아래) 칸에 값을 넣는다.
     국내 견적서·거래명세서는 '상호', '사업자등록번호', '수량', '단가' 같은
     라벨이 거의 정형화되어 있어 이 방식으로 대부분 맞는다.

   주의한 점:
     · 라벨에 공백이 섞여 있다('견 적 번 호', '공  급  자') → 공백 제거 후 비교
     · 병합 셀이 많다 → 병합 범위의 왼쪽 위 칸에 써야 보인다
     · 값이 없는 칸은 XML에 아예 없다 → 셀·행을 순서 맞게 새로 끼워 넣어야 한다
     · 스타일(s 속성)은 반드시 보존 → 테두리·글꼴이 깨지지 않는다
     · 공급자(우리)와 공급받는자(거래처) 양쪽에 '상호'가 있다
       → '공급자' / '공급받는자' 글자와의 거리로 어느 쪽인지 판별
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  window.DocsTemplate = window.DocsTemplate || {};
  var DT = window.DocsTemplate;

  /* ── 저장 (IndexedDB settings 스토어) ─────────────────
     ★ 2026-08-16: 업로드한 견적서·거래명세서 양식도 업종별로 갈린다.
       업종마다 쓰는 양식이 다르기 때문(에어컨 견적서 ≠ 조명공사 견적서).
       ⚠️ 첫 프로필은 기존 키 그대로 → 이미 올려둔 양식이 그대로 살아있다. */
  /* ★ 2026-08-17 — pfId 를 넘기면 그 업종의 양식을 본다(업종 상세 화면용).
       생략하면 예전처럼 지금 열린 작업의 업종 → 기존 호출부는 손댈 필요 없다. */
  function key(kind, pfId) {                              // kind: 'quote' | 'statement'
    var base = 'docsTemplate_' + kind;
    try {
      if (window.Profiles && Profiles.key) {
        var _id = pfId;
        if (!_id) { var pf = Profiles.forCurrentWork(); _id = pf && pf.id; }
        return Profiles.key(base, _id);
      }
    } catch (e) {}
    return base;
  }

  /* pfId 는 전부 **선택 인자**다 — 기존 호출부(docs_excel.js)는 그대로 동작한다. */
  DT.save = async function (kind, file, pfId) {
    var buf = await file.arrayBuffer();
    var b64 = _abToB64(buf);
    await settingsPut(key(kind, pfId), { name: file.name, size: buf.byteLength, at: Date.now(), b64: b64 });
  };
  DT.info = async function (kind, pfId) {
    try {
      var v = await settingsGet(key(kind, pfId));
      if (!v || !v.b64) return null;
      return { name: v.name, size: v.size, at: v.at };
    } catch (e) { return null; }
  };
  DT.buffer = async function (kind, pfId) {
    var v = await settingsGet(key(kind, pfId));
    if (!v || !v.b64) return null;
    return _b64ToAb(v.b64);
  };
  DT.clear = async function (kind, pfId) { await settingsPut(key(kind, pfId), null); };
  DT.keyFor = function (kind, pfId) { return key(kind, pfId); };

  function _abToB64(buf) {
    var bytes = new Uint8Array(buf), bin = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(bin);
  }
  function _b64ToAb(b64) {
    var bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  /* ── 셀 주소 유틸 ───────────────────────────────────── */
  function colNum(letters) {
    var n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n;
  }
  function colName(n) {
    var s = '';
    while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  function parseRef(ref) {
    var m = String(ref).match(/^([A-Z]+)(\d+)$/);
    return m ? { col: colNum(m[1]), row: parseInt(m[2], 10) } : null;
  }
  function mkRef(c, r) { return colName(c) + r; }
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, '').replace(/[()［］\[\]:：.·]/g, '').toUpperCase(); }

  /* XML 엔티티 풀기.
     ⚠️ 엑셀은 한글을 &#49345;&#54840; 같은 '숫자 문자 참조'로 저장하는 경우가 많다.
        이걸 안 풀면 라벨이 전혀 매칭되지 않는다(실제로 거래명세서 양식이 그랬다). */
  function unent(s) {
    return String(s == null ? '' : s)
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCodePoint(parseInt(d, 10)); })
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  /* ── 시트 읽기 ──────────────────────────────────────── */
  async function readSheet(zip) {
    // 첫 번째 시트 경로
    var path = 'xl/worksheets/sheet1.xml';
    if (!zip.file(path)) {
      var cand = Object.keys(zip.files).filter(function (n) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(n); }).sort();
      if (!cand.length) throw new Error('시트를 찾을 수 없습니다');
      path = cand[0];
    }
    var xml = await zip.file(path).async('string');

    // 공유 문자열
    var shared = [];
    var ssf = zip.file('xl/sharedStrings.xml');
    if (ssf) {
      var ss = await ssf.async('string');
      var sis = ss.match(/<si>[\s\S]*?<\/si>/g) || [];
      shared = sis.map(function (si) {
        var ts = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
        return unent(ts.map(function (t) { return t.replace(/<[^>]+>/g, ''); }).join(''));
      });
    }

    // 셀 → 글자
    var texts = {};
    var re = /<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, m;
    while ((m = re.exec(xml)) !== null) {
      var ref = m[1], attr = m[2] || '', inner = m[3] || '', t = '';
      if (/ t="s"/.test(attr)) {
        var vi = inner.match(/<v>(\d+)<\/v>/);
        if (vi) t = shared[parseInt(vi[1], 10)] || '';
      } else if (/ t="(inlineStr|str)"/.test(attr)) {
        var its = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
        t = unent(its.map(function (x) { return x.replace(/<[^>]+>/g, ''); }).join(''));
      } else {
        var vv = inner.match(/<v>([\s\S]*?)<\/v>/);
        if (vv) t = vv[1];
      }
      if (t !== '') texts[ref] = t;
    }

    // 병합 범위
    var merges = [];
    var mc = xml.match(/<mergeCell ref="([A-Z]+\d+:[A-Z]+\d+)"\/>/g) || [];
    mc.forEach(function (s) {
      var r = s.match(/ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/);
      if (r) merges.push({ c1: colNum(r[1]), r1: +r[2], c2: colNum(r[3]), r2: +r[4] });
    });

    return { path: path, xml: xml, texts: texts, merges: merges };
  }

  function mergeAt(sheet, c, r) {
    for (var i = 0; i < sheet.merges.length; i++) {
      var g = sheet.merges[i];
      if (c >= g.c1 && c <= g.c2 && r >= g.r1 && r <= g.r2) return g;
    }
    return null;
  }

  /* ── 라벨 사전 ──────────────────────────────────────── */
  var L = {
    supplier: ['공급자', '공급인', '공급자정보'],
    buyer:    ['공급받는자', '공급받는', '거래처', '견적처', '수신', '수신처', '발주자', '주문자', '고객', '현장'],
    name:     ['상호', '상호명', '회사명', '법인명', '업체명', '회사'],
    bizNo:    ['사업자등록번호', '등록번호', '사업자번호', '사업자등록'],
    ceo:      ['대표자', '대표', '대표자명', '성명', '대표이사'],
    addr:     ['사업장주소', '주소', '소재지', '사업장소재지'],
    tel:      ['연락처', '전화', '전화번호', 'TEL', '휴대폰', 'HP'],
    email:    ['이메일', 'EMAIL', 'E-MAIL', '메일'],
    worker:   ['담당자', '담당'],
    date:     ['견적일자', '작성일자', '거래일자', '발행일자', '작성일', '거래일', '발행일', '일자', '날짜'],
    docNo:    ['견적번호', '문서번호', '거래명세서번호', '명세서번호', '번호'],
    total:    ['합계금액', '총금액', '견적금액', '총액', '합계'],
    supply:   ['공급가액'],
    vat:      ['부가세', '세액', 'VAT', '부가가치세']
  };
  var ITEM = {
    name:  ['품목', '품명', '내역', '공사명', '항목', '견적내용', '세부구분', '구분', '작업내용', '규격품명'],
    spec:  ['규격', '사양', '단위'],
    qty:   ['수량'],
    price: ['단가'],
    amount:['금액', '공급가액', '합계']
  };

  function findLabels(sheet, words) {
    var out = [];
    var set = words.map(norm);
    Object.keys(sheet.texts).forEach(function (ref) {
      var n = norm(sheet.texts[ref]);
      if (!n) return;
      for (var i = 0; i < set.length; i++) {
        if (n === set[i]) { out.push({ ref: ref, exact: true, word: set[i] }); return; }
      }
      for (var j = 0; j < set.length; j++) {
        if (set[j].length >= 2 && n.indexOf(set[j]) >= 0 && n.length <= set[j].length + 4) {
          out.push({ ref: ref, exact: false, word: set[j] }); return;
        }
      }
    });
    return out;
  }

  // 라벨 옆(오른쪽 우선) 빈 칸 찾기 — 병합이면 병합 시작 칸
  function targetOf(sheet, labelRef) {
    var p = parseRef(labelRef); if (!p) return null;
    var g = mergeAt(sheet, p.col, p.row);
    var startCol = g ? g.c2 + 1 : p.col + 1;
    for (var c = startCol; c <= startCol + 4; c++) {
      var g2 = mergeAt(sheet, c, p.row);
      var ref = g2 ? mkRef(g2.c1, g2.r1) : mkRef(c, p.row);
      var cur = sheet.texts[ref];
      if (cur == null || String(cur).trim() === '') return ref;
      if (g2) c = g2.c2;   // 병합이면 그 끝으로 점프
    }
    // 오른쪽이 다 차 있으면 아래 칸
    var below = mergeAt(sheet, p.col, p.row + 1);
    return below ? mkRef(below.c1, below.r1) : mkRef(p.col, p.row + 1);
  }

  /* ── 자동 인식 ──────────────────────────────────────── */
  function detect(sheet) {
    var map = {}, unknown = [];

    function anchorList(words) {
      return findLabels(sheet, words).map(function (x) {
        var p = parseRef(x.ref); return p ? { ref: x.ref, row: p.row, col: p.col } : null;
      }).filter(Boolean);
    }
    var supL = anchorList(L.supplier), buyL = anchorList(L.buyer);

    /* 어떤 라벨이 '공급자' 쪽인지 '공급받는자' 쪽인지 판정.

       단순 거리 계산은 좌우 배치 양식에서 틀린다. 예를 들어
         A4 '공급자'   J4 '공급받는자'
         B5 '상호' F5 '성명'   L5 '상호' S5 '성명'
       에서 F5(공급자 성명)는 J4가 A4보다 열 거리가 가까워 공급받는자로 잘못 분류된다.

       그래서 두 앵커의 배치를 먼저 보고 기준선을 잡는다.
         · 같은 행(±1)에 있으면 = 좌우 배치 → 열(column) 기준으로 가른다
         · 행이 다르면        = 상하 배치 → 행(row) 기준으로 가른다 */
    function sideOf(p) {
      if (!supL.length) return 'buy';
      if (!buyL.length) return 'sup';
      var a = supL[0], b = buyL[0];
      if (Math.abs(a.row - b.row) <= 1) {
        return (a.col < b.col) ? (p.col < b.col ? 'sup' : 'buy')
                               : (p.col < a.col ? 'buy' : 'sup');
      }
      return (a.row < b.row) ? (p.row < b.row ? 'sup' : 'buy')
                             : (p.row < a.row ? 'buy' : 'sup');
    }

    // 공급자/공급받는자가 갈리는 항목
    ['name', 'bizNo', 'ceo', 'addr', 'tel'].forEach(function (f) {
      var found = findLabels(sheet, L[f]);
      if (!found.length) { unknown.push('sup_' + f); unknown.push('buy_' + f); return; }
      var cands = found.map(function (x) {
        var p = parseRef(x.ref);
        return p ? { ref: x.ref, p: p, side: sideOf(p) } : null;
      }).filter(Boolean).sort(function (u, v) {
        return (u.p.row - v.p.row) || (u.p.col - v.p.col);
      });
      var sup = cands.filter(function (c) { return c.side === 'sup'; })[0] || null;
      var buy = cands.filter(function (c) { return c.side === 'buy'; })[0] || null;
      // 한쪽만 잡혔는데 후보가 2개 이상이면 나머지를 반대편에 배정
      if (sup && !buy) buy = cands.filter(function (c) { return c !== sup; })[0] || null;
      if (buy && !sup) sup = cands.filter(function (c) { return c !== buy; })[0] || null;
      if (sup) map['sup_' + f] = targetOf(sheet, sup.ref); else unknown.push('sup_' + f);
      if (buy) map['buy_' + f] = targetOf(sheet, buy.ref); else unknown.push('buy_' + f);
    });

    /* 상호를 못 찾은 경우 보완:
       견적서는 '상호' 라벨 없이 '견적처 : ___', '수신 : ___' 처럼
       구분 라벨이 곧 값 자리를 가리키는 형태가 흔하다. */
    if (!map.buy_name && buyL.length) {
      map.buy_name = targetOf(sheet, buyL[0].ref);
      unknown = unknown.filter(function (u) { return u !== 'buy_name'; });
    }
    if (!map.sup_name && supL.length) {
      map.sup_name = targetOf(sheet, supL[0].ref);
      unknown = unknown.filter(function (u) { return u !== 'sup_name'; });
    }

    // 단일 항목
    ['email', 'worker', 'date', 'docNo', 'total', 'supply', 'vat'].forEach(function (f) {
      var found = findLabels(sheet, L[f]);
      if (!found.length) { unknown.push(f); return; }
      var ex = found.filter(function (x) { return x.exact; });
      map[f] = targetOf(sheet, (ex[0] || found[0]).ref);
    });

    // 품목 표: 수량+단가가 같은 행에 있는 곳이 머리글
    var qty = findLabels(sheet, ITEM.qty), price = findLabels(sheet, ITEM.price);
    var headRow = null, cols = {};
    qty.forEach(function (q) {
      var pq = parseRef(q.ref);
      price.forEach(function (pr) {
        var pp = parseRef(pr.ref);
        if (pq && pp && pq.row === pp.row) { if (headRow == null || pq.row < headRow) headRow = pq.row; }
      });
    });
    if (headRow != null) {
      Object.keys(ITEM).forEach(function (f) {
        var best = null;
        findLabels(sheet, ITEM[f]).forEach(function (x) {
          var p = parseRef(x.ref);
          if (p && p.row === headRow) { if (!best || (x.exact && !best.exact)) best = { p: p, exact: x.exact }; }
        });
        if (best) cols[f] = best.p.col;
      });
      // 데이터 행 수: 머리글 아래 ~ '합계' 행 직전
      var lastRow = headRow + 8;
      var tot = findLabels(sheet, L.total).map(function (x) { return parseRef(x.ref); }).filter(Boolean)
                 .filter(function (p) { return p.row > headRow; });
      if (tot.length) lastRow = Math.min.apply(null, tot.map(function (p) { return p.row; })) - 1;
      map._items = { headRow: headRow, firstRow: headRow + 1, lastRow: Math.max(headRow + 1, lastRow), cols: cols };
    } else {
      unknown.push('items');
    }
    return { map: map, unknown: unknown };
  }

  /* ── 셀 쓰기 (없으면 끼워 넣기, 스타일 보존) ────────── */
  function xesc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function writeCell(xml, ref, val, isNum) {
    var p = parseRef(ref); if (!p) return xml;
    var re = new RegExp('<c r="' + ref + '"([^>]*?)(/>|>[\\s\\S]*?</c>)');
    var m = xml.match(re), sAttr = '';
    if (m) { var sm = m[1].match(/ s="(\d+)"/); if (sm) sAttr = ' s="' + sm[1] + '"'; }
    var cell = isNum
      ? '<c r="' + ref + '"' + sAttr + '><v>' + (Number(val) || 0) + '</v></c>'
      : '<c r="' + ref + '"' + sAttr + ' t="inlineStr"><is><t xml:space="preserve">' + xesc(val) + '</t></is></c>';
    if (m) return xml.replace(re, cell);

    // 셀 없음 → 같은 행에 열 순서 맞춰 삽입
    var rowOpen = new RegExp('<row[^>]* r="' + p.row + '"[^>]*>');
    var ro = xml.match(rowOpen);
    if (ro) {
      if (/\/>$/.test(ro[0])) {   // <row .../> 자기닫힘 → 열어서 넣기
        var opened = ro[0].replace(/\/>$/, '>') + cell + '</row>';
        return xml.replace(rowOpen, opened);
      }
      var start = xml.indexOf(ro[0]) + ro[0].length;
      var end = xml.indexOf('</row>', start);
      var inner = xml.slice(start, end);
      var cre = /<c r="([A-Z]+)(\d+)"/g, cm, pos = -1;
      while ((cm = cre.exec(inner)) !== null) {
        if (colNum(cm[1]) > p.col) { pos = cm.index; break; }
      }
      var newInner = (pos >= 0) ? inner.slice(0, pos) + cell + inner.slice(pos) : inner + cell;
      return xml.slice(0, start) + newInner + xml.slice(end);
    }

    // 행도 없음 → sheetData 안에 행 순서 맞춰 삽입
    var newRow = '<row r="' + p.row + '">' + cell + '</row>';
    var sd = xml.indexOf('<sheetData>');
    if (sd < 0) return xml;
    var sdEnd = xml.indexOf('</sheetData>');
    var body = xml.slice(sd + 11, sdEnd);
    var rre = /<row[^>]* r="(\d+)"/g, rm2, at = -1;
    while ((rm2 = rre.exec(body)) !== null) {
      if (parseInt(rm2[1], 10) > p.row) { at = rm2.index; break; }
    }
    var nb = (at >= 0) ? body.slice(0, at) + newRow + body.slice(at) : body + newRow;
    return xml.slice(0, sd + 11) + nb + xml.slice(sdEnd);
  }

  /* ── 값 채우기 ──────────────────────────────────────── */
  DT.fill = async function (kind, ctx) {
    if (typeof JSZip === 'undefined') throw new Error('압축 모듈(JSZip) 로드 안 됨');
    var buf = await DT.buffer(kind);
    if (!buf) throw new Error('등록된 양식이 없습니다');
    var zip = await JSZip.loadAsync(buf);
    var sheet = await readSheet(zip);
    var det = detect(sheet);
    var M = det.map, xml = sheet.xml;

    function put(f, val, isNum) {
      if (!M[f] || val == null || val === '') return;
      xml = writeCell(xml, M[f], val, !!isNum);
    }
    var co = ctx.company || {};
    // 공급자(우리)
    put('sup_name', co.name); put('sup_bizNo', co.biz); put('sup_ceo', co.ceo);
    put('sup_addr', co.addr); put('sup_tel', co.tel);
    // 공급받는자(거래처)
    put('buy_name', ctx.custName); put('buy_bizNo', ctx.bizNo); put('buy_ceo', ctx.bizCeo);
    put('buy_addr', ctx.bizAddr); put('buy_tel', ctx.custTel);
    // 공통
    put('email', co.email); put('worker', ctx.worker);
    put('date', ctx.date); put('docNo', ctx.docNo);

    // 품목
    var supplySum = 0;
    ctx.items.forEach(function (it) { supplySum += (it.qty || 0) * (it.price || 0); });
    var vatAmt = ctx.vat ? Math.round(supplySum * 0.1) : 0;

    if (M._items) {
      var T = M._items, r = T.firstRow, n = 0;
      for (var i = 0; i < ctx.items.length && r <= T.lastRow; i++, r++, n++) {
        var it = ctx.items[i];
        var amt = (it.qty || 0) * (it.price || 0);
        if (T.cols.name)   xml = writeCell(xml, mkRef(T.cols.name, r), it.name || '', false);
        if (T.cols.spec)   xml = writeCell(xml, mkRef(T.cols.spec, r), it.spec || '', false);
        if (T.cols.qty)    xml = writeCell(xml, mkRef(T.cols.qty, r), it.qty || 0, true);
        if (T.cols.price)  xml = writeCell(xml, mkRef(T.cols.price, r), it.price || 0, true);
        if (T.cols.amount) xml = writeCell(xml, mkRef(T.cols.amount, r), amt, true);
      }
      // 양식에 남아있는 샘플 줄 비우기
      for (; r <= T.lastRow; r++) {
        Object.keys(T.cols).forEach(function (f) {
          xml = writeCell(xml, mkRef(T.cols[f], r), '', false);
        });
      }
    }

    put('supply', supplySum, true);
    put('vat', vatAmt, true);
    put('total', supplySum + vatAmt, true);

    zip.file(sheet.path, xml);
    // 수식 캐시가 있으면 제거(값이 바뀌었으므로 엑셀이 다시 계산하도록)
    try { if (zip.file('xl/calcChain.xml')) zip.remove('xl/calcChain.xml'); } catch (e) {}
    return await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  };

  /* ── 인식 결과 미리보기용 ───────────────────────────── */
  DT.preview = async function (kind, arrayBuffer) {
    if (typeof JSZip === 'undefined') throw new Error('압축 모듈(JSZip) 로드 안 됨');
    var zip = await JSZip.loadAsync(arrayBuffer);
    var sheet = await readSheet(zip);
    var det = detect(sheet);
    var LABEL = {
      sup_name: '우리 상호', sup_bizNo: '우리 등록번호', sup_ceo: '우리 대표',
      sup_addr: '우리 주소', sup_tel: '우리 연락처',
      buy_name: '거래처 상호', buy_bizNo: '거래처 등록번호', buy_ceo: '거래처 대표',
      buy_addr: '거래처 주소', buy_tel: '거래처 연락처',
      email: '이메일', worker: '담당자', date: '날짜', docNo: '문서번호',
      total: '합계', supply: '공급가액', vat: '부가세'
    };
    var ok = [], no = [];
    Object.keys(LABEL).forEach(function (k) {
      if (det.map[k]) ok.push(LABEL[k]); else no.push(LABEL[k]);
    });
    if (det.map._items) ok.push('품목표(' + (det.map._items.lastRow - det.map._items.firstRow + 1) + '줄)');
    else no.push('품목표');
    return { ok: ok, no: no };
  };
})();
