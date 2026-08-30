/* ═══════════════════════════════════════════════
   DOCS EXCEL ─ 견적서 / 거래명세서 (업로드 양식 템플릿에 값 주입)
   - 템플릿: assets/templates/quote_template.xlsx, statement_template.xlsx (서식·테두리 그대로)
   - JSZip 로 sheet1.xml 셀 값만 교체(스타일 s 보존) → 원본 서식 100% 유지
   - 공급자=업체정보(ac_co_v2), 공급받는자=고객 사업자정보(사업자등록증 이미지 분석으로 자동입력)
   - 학습: 사업자등록증 분석 교정 학습(ai.js, ac_bizcert_corrections) on/off
═══════════════════════════════════════════════ */
(function () {
  'use strict';
  window.DocsExcel = window.DocsExcel || {};

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(m, t) { if (typeof showToast === 'function') showToast(m, t || 'ok'); else if (t === 'err') alert(m); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function digits(v) { return parseInt(String(v == null ? '' : v).replace(/[^0-9]/g, ''), 10) || 0; }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function numKor(n) {
    n = Math.floor(Math.abs(+n || 0));
    if (n === 0) return '영';
    var d = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
    var sm = ['', '십', '백', '천'], big = ['', '만', '억', '조', '경'];
    var out = '', gi = 0;
    while (n > 0) {
      var grp = n % 10000; n = Math.floor(n / 10000);
      if (grp) {
        var gs = '', t = grp, pos = 0;
        while (t > 0) { var dg = t % 10; if (dg) gs = d[dg] + sm[pos] + gs; t = Math.floor(t / 10); pos++; }
        out = gs + big[gi] + out;
      }
      gi++;
    }
    return out;
  }
  function excelSerial(dateStr) {
    var p = String(dateStr || '').split('-');
    if (p.length < 3) return '';
    var ms = Date.UTC(+p[0], +p[1] - 1, +p[2]) - Date.UTC(1899, 11, 30);
    return Math.floor(ms / 86400000);
  }

  /* ── 공급자(내 업체) ──
     ★ 2026-08-16: 지금 열린 작업의 업종 프로필이 참조하는 사업자를 쓴다.
       사업자등록증이 여러 개일 때 업종에 맞는 공급자가 들어가게 하기 위함.
       (ac_co_v2 는 현재 업종의 파생 뷰라 폴백으로만 남긴다) */
  function getCompany() {
    var ci = null;
    try { if (window.Profiles && Profiles.infoForCurrentWork) ci = Profiles.infoForCurrentWork(); } catch (e) {}
    if (!ci) { try { ci = JSON.parse(localStorage.getItem('ac_co_v2') || '{}'); } catch (e) { ci = {}; } }
    return { name: ci.coName || '', ceo: ci.coCeo || '', tel: ci.coTel || '', biz: ci.coBiz || '',
             addr: ci.coAddr || '', email: ci.coEmail || '', bank: ci.coBank || '' };
  }

  /* ── 열린 작업 ── */
  function getWorkHead() {
    var g = function (id) { var el = document.getElementById(id); return el ? (el.value || '') : ''; };
    return { apt: g('aptName'), date: g('workDate') || todayStr(), worker: g('workerName') };
  }
  function getWorkItems() {
    var items = [];
    try {
      if (typeof units !== 'undefined' && units && units.length) {
        units.forEach(function (u) {
          var c = u.customer || {};
          items.push({ name: (u.name || c.workTarget || '작업'), spec: (c.workTarget || ''), qty: 1, price: digits(c.price), memo: (c.memo || '') });
        });
      }
    } catch (e) {}
    if (!items.length) {
      try { if (typeof facilityCustomer !== 'undefined' && facilityCustomer) items.push({ name: facilityCustomer.workTarget || '작업', spec: '', qty: 1, price: digits(facilityCustomer.price), memo: facilityCustomer.memo || '' }); } catch (e) {}
    }
    if (!items.length) items.push({ name: '', spec: '', qty: 1, price: 0, memo: '' });
    return items;
  }
  function firstCustomer() {
    var o = { phone: '', address: '' };
    try {
      if (typeof units !== 'undefined' && units) {
        for (var i = 0; i < units.length; i++) { var c = units[i].customer || {}; if (c.phone || c.address) { o.phone = c.phone || c.contact || ''; o.address = c.address || ''; break; } }
      }
      if (!o.address && typeof facilityCustomer !== 'undefined' && facilityCustomer) { o.phone = o.phone || facilityCustomer.phone || ''; o.address = facilityCustomer.address || ''; }
    } catch (e) {}
    return o;
  }

  /* ── 템플릿 셀 값 주입 (스타일 보존) ── */
  function xesc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function setCell(xml, ref, val, isNum) {
    var re = new RegExp('<c r="' + ref + '"([^>]*?)(/>|>[\\s\\S]*?</c>)');
    var m = xml.match(re);
    var sAttr = '';
    if (m) { var sm = m[1].match(/ s="(\d+)"/); if (sm) sAttr = ' s="' + sm[1] + '"'; }
    var cell = isNum
      ? '<c r="' + ref + '"' + sAttr + '><v>' + (Number(val) || 0) + '</v></c>'
      : '<c r="' + ref + '"' + sAttr + ' t="inlineStr"><is><t xml:space="preserve">' + xesc(val) + '</t></is></c>';
    return m ? xml.replace(re, cell) : xml;
  }
  function shiftRef(ref, dRow) {
    var m = ref.match(/^([A-Z]+)(\d+)$/);
    return m[1] + (parseInt(m[2], 10) + dRow);
  }
  async function genFromTemplate(url, edits) {
    if (typeof JSZip === 'undefined') throw new Error('압축 모듈(JSZip) 로드 안 됨');
    var resp = await fetch(url);
    if (!resp.ok) throw new Error('템플릿을 불러올 수 없습니다 (' + resp.status + ')');
    var buf = await resp.arrayBuffer();
    var zip = await JSZip.loadAsync(buf);
    var path = 'xl/worksheets/sheet1.xml';
    var xml = await zip.file(path).async('string');
    edits.forEach(function (e) { xml = setCell(xml, e[0], e[1], e[2]); });
    zip.file(path, xml);
    return await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }

  /* ── 다운로드 / 공유 ── */
  var MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  async function shareOrDownload(buffer, fname, mode, title) {
    var blob = new Blob([buffer], { type: MIME });
    if (typeof _ccIsNative === 'function' && _ccIsNative()) {
      var FS = _ccPlugin('Filesystem');
      if (!FS) { toast('파일 저장 모듈이 없어요(앱 재빌드 필요)', 'err'); return; }
      try {
        var b64 = await _ccBlobToBase64(blob);
        var relDir = '작업보고서', dir = 'DOCUMENTS';
        try { await FS.writeFile({ path: relDir + '/' + fname, data: b64, directory: dir, recursive: true }); }
        catch (e1) { dir = 'EXTERNAL'; await FS.writeFile({ path: relDir + '/' + fname, data: b64, directory: dir, recursive: true }); }
        var uri = ''; try { var u = await FS.getUri({ path: relDir + '/' + fname, directory: dir }); uri = u && u.uri; } catch (e) {}
        if (mode === 'share') {
          var Share = _ccPlugin('Share');
          if (Share && uri) { try { await Share.share({ title: title, text: title, files: [uri], dialogTitle: title + ' 공유' }); return; } catch (e) { if (e && /cancel/i.test(e.message || '')) return; } }
        }
        var where = (dir === 'DOCUMENTS') ? '내장메모리 > Documents > 작업보고서' : '앱 전용 폴더 > 작업보고서';
        alert('✅ 엑셀 저장 완료\n\n파일: ' + fname + '\n위치: ' + where + '\n\n\'내 파일\' 앱에서 열거나 공유할 수 있어요.');
        return;
      } catch (e) { console.error(e); toast('저장 실패: ' + (e.message || e), 'err'); return; }
    }
    if (mode === 'share') {
      try { var file = new File([buffer], fname, { type: MIME }); if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: title, text: title }); return; } }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a'); a.href = url; a.download = fname;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      toast('📥 다운로드 완료: ' + fname, 'ok');
    } catch (e) { toast('내보내기 실패: ' + (e.message || e), 'err'); }
  }

  /* ── 편집값 → 템플릿 셀 매핑 ── */
  function calc(ctx) {
    var supply = 0; ctx.items.forEach(function (it) { supply += (it.qty || 0) * (it.price || 0); });
    var vat = ctx.vat ? Math.round(supply * 0.1) : 0;
    return { supply: supply, vat: vat, total: supply + vat };
  }
  function quoteEdits(ctx) {
    var co = ctx.company, c = calc(ctx), e = [];
    var qtySum = 0; ctx.items.forEach(function (it) { qtySum += (it.qty || 0); });
    var detail = ['* 산출내용', '------------------------------'];
    ctx.items.forEach(function (it, i) { if (it.name || it.price) detail.push((i + 1) + '. ' + it.name + (it.spec ? '(' + it.spec + ')' : '') + ' ' + it.qty + '개 X ' + (it.price).toLocaleString('ko-KR') + '원 = ' + ((it.qty || 0) * (it.price || 0)).toLocaleString('ko-KR') + '원'); });
    var summary = (ctx.items[0] && ctx.items[0].name) || '작업';
    if (ctx.items.length > 1) summary += ' 외 ' + (ctx.items.length - 1) + '건';
    e.push(['D2', ctx.docNo, false]);
    e.push(['J2', ctx.date.replace(/(\d+)-(\d+)-(\d+)/, '$1년$2월$3일'), false]);
    e.push(['D3', ctx.custName, false]);
    e.push(['D5', ctx.custTel, false]);
    e.push(['D6', ctx.custEmail, false]);
    e.push(['D8', (ctx.custName || '') + ' 견적서', false]);
    e.push(['D9', numKor(c.total) + '원정(' + (ctx.vat ? 'vat포함' : 'vat별도') + ')', false]);
    e.push(['J3', co.name, false]);
    e.push(['J4', '등록번호 ' + co.biz + ' / 대표 ' + co.ceo, false]);
    e.push(['J5', co.tel, false]);
    e.push(['J6', co.email, false]);
    e.push(['J7', ctx.worker, false]);
    e.push(['E11', summary, false]);
    e.push(['I11', qtySum, true]);
    e.push(['K11', c.supply, true]);
    e.push(['D13', detail.join('\n'), false]);
    e.push(['K14', c.supply, true]);
    e.push(['K18', c.total, true]);
    e.push(['C7', ' 기간 : ', false]);
    return e;
  }
  function statementEdits(ctx) {
    var co = ctx.company, c = calc(ctx), e = [];
    function pair(ref, val, num) { e.push([ref, val, num]); e.push([shiftRef(ref, 22), val, num]); }
    var comp = ctx.date.replace(/-/g, '');
    pair('A3', '거래명세서 번호: ' + comp, false);
    pair('P3', excelSerial(ctx.date), true);
    // 공급자
    pair('C4', co.biz, false); pair('C5', co.name, false); pair('G5', co.ceo, false); pair('C6', co.addr, false); pair('C7', co.tel, false);
    // 공급받는자
    pair('N4', ctx.bizNo, false); pair('N5', ctx.custName, false); pair('U5', ctx.bizCeo, false); pair('N6', ctx.bizAddr, false); pair('N7', ctx.custTel, false);
    pair('A8', '       총금액 (공급가액 + 세액) : ' + c.total.toLocaleString('ko-KR') + ' (' + numKor(c.total) + '원)정', false);
    var qtySum = 0;
    for (var i = 0; i < 8; i++) {
      var r = 10 + i;
      if (i < ctx.items.length) {
        var it = ctx.items[i];
        var sup = (it.qty || 0) * (it.price || 0), iv = ctx.vat ? Math.round(sup * 0.1) : 0;
        qtySum += (it.qty || 0);
        pair('A' + r, it.name, false); pair('I' + r, it.qty, true); pair('K' + r, it.price, true);
        pair('P' + r, sup, true); pair('Q' + r, iv, true); pair('V' + r, it.memo || '', false);
      } else {
        // 양식에 남아있는 샘플 항목 제거(빈칸)
        pair('A' + r, '', false); pair('I' + r, '', false); pair('K' + r, '', false);
        pair('P' + r, '', false); pair('Q' + r, '', false); pair('V' + r, '', false);
      }
    }
    pair('I18', qtySum, true); pair('P18', c.supply, true); pair('Q18', c.vat, true);
    return e;
  }

  /* ── 생성 다이얼로그 ── */
  function openDialog(kind) {
    var isQuote = (kind === 'quote');
    var co = getCompany();
    var head = getWorkHead();
    var items = getWorkItems();
    var fc = firstCustomer();
    var docNo = (isQuote ? 'No.U-' : '') + head.date.replace(/-/g, '');
    var _ocrRaw = null;  // 사업자등록증 분석 원본(학습 비교용)

    function itemRowHtml(it) {
      return '<div class="dxItemRow" style="display:flex;gap:4px;margin-bottom:5px;align-items:center;">' +
        '<input class="cust-inp dxName" value="' + esc(it.name) + '" placeholder="품목" style="flex:2;min-width:0;">' +
        '<input class="cust-inp dxSpec" value="' + esc(it.spec) + '" placeholder="규격" style="flex:1.1;min-width:0;">' +
        '<input class="cust-inp dxQty" value="' + esc(it.qty) + '" inputmode="numeric" placeholder="수량" style="width:42px;">' +
        '<input class="cust-inp dxPrice" value="' + esc(it.price) + '" inputmode="numeric" placeholder="단가" style="flex:1.1;min-width:0;">' +
        '<button class="dxDel" style="background:none;border:none;color:var(--wn);font-size:16px;cursor:pointer;padding:2px 4px;">✕</button>' +
      '</div>';
    }

    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(17,24,32,.55);z-index:2400;display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow-y:auto;-webkit-overflow-scrolling:touch;';
    ov.innerHTML =
      '<div style="background:var(--sf);border-radius:16px;max-width:520px;width:100%;overflow:hidden;box-shadow:0 14px 44px rgba(0,0,0,.28);">' +
        // 헤더
        '<div style="display:flex;align-items:center;gap:11px;padding:15px 16px;border-bottom:1px solid var(--bd);">' +
          '<div style="width:40px;height:40px;border-radius:11px;background:var(--ac);color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">' + (isQuote ? '\uD83E\uDDFE' : '\uD83D\uDCCB') + '</div>' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:16px;font-weight:800;color:var(--tx);">' + (isQuote ? '견적서' : '거래명세서') + ' <span style="font-size:11px;font-weight:600;color:var(--mu);">엑셀 양식</span></div>' +
            '<div style="font-size:11px;color:var(--mu);margin-top:1px;">양식 그대로 생성 · 공급자=설정 업체정보</div>' +
          '</div>' +
          '<button id="dxClose" style="background:var(--sf2);border:1px solid var(--bd);color:var(--mu);border-radius:9px;width:32px;height:32px;font-size:15px;cursor:pointer;flex-shrink:0;">\u2715</button>' +
        '</div>' +
        // 본문
        '<div style="padding:14px 16px;">' +
          '<div style="border:1px solid var(--bd);border-radius:12px;padding:12px;margin-bottom:12px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px;">' +
              '<b style="font-size:13px;color:var(--ac);">공급받는자 (고객)</b>' +
              '<button class="btn b-blue b-xs" id="dxOcr">\uD83D\uDCF7 사업자등록증 분석</button>' +
            '</div>' +
            '<input type="file" id="dxOcrFile" accept="image/*" style="display:none;">' +
            '<div id="dxOcrStat" style="font-size:11px;color:var(--mu);margin-bottom:6px;display:none;"></div>' +
            '<div style="display:flex;gap:6px;margin-bottom:6px;">' +
              '<input class="cust-inp" id="dxBizName" value="' + esc(head.apt) + '" placeholder="상호(법인명)" style="flex:2;min-width:0;">' +
              '<input class="cust-inp" id="dxBizNo" placeholder="등록번호" style="flex:1.4;min-width:0;">' +
            '</div>' +
            '<div style="display:flex;gap:6px;margin-bottom:6px;">' +
              '<input class="cust-inp" id="dxBizCeo" placeholder="대표자" style="flex:1;min-width:0;">' +
              '<input class="cust-inp" id="dxBizTel" value="' + esc(fc.phone) + '" placeholder="연락처" style="flex:1.4;min-width:0;">' +
            '</div>' +
            '<input class="cust-inp" id="dxBizAddr" value="' + esc(fc.address) + '" placeholder="주소" style="width:100%;margin-bottom:' + (isQuote ? '6px' : '0') + ';">' +
            (isQuote ? '<input class="cust-inp" id="dxBizEmail" placeholder="이메일(선택)" style="width:100%;">' : '<input type="hidden" id="dxBizEmail">') +
          '</div>' +
          '<div style="display:flex;gap:10px;margin-bottom:12px;align-items:flex-end;">' +
            '<div style="flex:1;"><label style="font-size:11px;color:var(--mu);font-weight:700;">' + (isQuote ? '견적일자' : '거래일자') + '</label>' +
              '<input class="cust-inp" id="dxDate" type="date" value="' + esc(head.date) + '" style="width:100%;margin-top:3px;"></div>' +
            '<label style="flex:1;font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer;padding-bottom:8px;"><input type="checkbox" id="dxVat" checked> 부가세(10%) 포함</label>' +
          '</div>' +
          '<div style="font-size:12px;color:var(--ac);font-weight:700;margin-bottom:6px;">품목 <span style="color:var(--mu);font-weight:400;">· 품목·규격·수량·단가' + (isQuote ? '' : ' (최대 8줄)') + '</span></div>' +
          '<div id="dxItems">' + items.map(itemRowHtml).join('') + '</div>' +
          '<button class="btn b-ghost b-xs" id="dxAdd" style="margin-top:2px;">\uFF0B 항목 추가</button>' +
          '<div id="dxTotal" style="text-align:right;font-size:15px;font-weight:800;color:var(--ac);margin-top:12px;"></div>' +
          (co.name ? '' : '<div style="font-size:11px;color:var(--dn);margin-top:10px;">\u26A0\uFE0F 설정 \u2192 업체정보(상호·대표·등록번호)를 먼저 입력하면 공급자란이 채워집니다.</div>') +
          // ★ 2026-08-13: 쓰던 엑셀 양식 올려서 쓰기
          '<div style="margin-top:14px;padding:11px 12px;background:var(--sf2);border:1px solid var(--bd);border-radius:11px;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
              /* ★ 2026-08-16 어느 업종의 양식인지 밝힌다.
                   양식이 업종별로 갈렸는데 화면엔 '등록한 양식'이라고만 나오면
                   업종을 바꾼 뒤 '내가 올린 양식이 사라졌다'로 오해한다. */
              '<div style="font-size:12px;font-weight:800;color:var(--tx);">\uD83D\uDCC4 내 양식으로 만들기' +
                (function(){ try {
                  var pf = window.Profiles && Profiles.forCurrentWork();
                  return pf ? ' <span style="font-weight:600;color:var(--ac);">· ' + Profiles.iconOf(pf) + ' ' + pf.name + '</span>' : '';
                } catch(e){ return ''; } })() + '</div>' +
              '<button class="btn b-ghost b-xs" id="dxTplPick">양식 올리기</button>' +
            '</div>' +
            '<div id="dxTplInfo" style="font-size:11px;color:var(--mu);margin-top:7px;line-height:1.6;">확인 중…</div>' +
            '<input type="file" id="dxTplFile" accept=".xlsx" style="display:none;">' +
          '</div>' +
          '<div style="font-size:11px;color:var(--mu);margin-top:10px;text-align:center;line-height:1.7;"><label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;margin-right:8px;"><input type="checkbox" id="dxLearnToggle"> \uD83E\uDDE0 사업자등록증 분석 학습</label><a href="#" id="dxLearnReset" style="color:var(--mu);">학습 초기화</a></div>' +
        '</div>' +
        // 푸터
        '<div style="display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--bd);background:var(--sf2);">' +
          '<button class="btn b-blue" id="dxDownload" style="flex:1;justify-content:center;">\uD83D\uDCE5 다운로드</button>' +
          '<button class="btn b-green" id="dxShare" style="flex:1;justify-content:center;">\uD83D\uDCE4 공유</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(ov);
    var close = function () { if (ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('#dxClose').onclick = close;

    // 학습 토글
    var lt = ov.querySelector('#dxLearnToggle');
    var learnOff = function () { try { return localStorage.getItem('ac_docs_learn_off') === '1'; } catch (e) { return false; } };
    lt.checked = !learnOff();
    lt.onchange = function () { try { if (lt.checked) localStorage.removeItem('ac_docs_learn_off'); else localStorage.setItem('ac_docs_learn_off', '1'); } catch (e) {} toast(lt.checked ? '학습 사용 켜짐' : '학습 사용 꺼짐', 'ok'); };
    ov.querySelector('#dxLearnReset').onclick = function (e) { e.preventDefault(); if (confirm('사업자등록증 분석 학습을 초기화할까요?')) { if (window.ClaudeAI && ClaudeAI.clearBizCorr) ClaudeAI.clearBizCorr(); toast('학습 초기화됨', 'ok'); } };

    /* ── 내 양식 올리기 (2026-08-13) ──
       올린 양식은 IndexedDB에 보관되어 다음에도 그대로 쓰인다.
       양식 안의 '상호', '수량', '단가' 같은 글자를 찾아 그 옆 칸에 값을 넣는다. */
    var tplInfoEl = ov.querySelector('#dxTplInfo');
    var tplFile = ov.querySelector('#dxTplFile');
    var TPLKIND = kind;

    function fmtKB(n) { return Math.max(1, Math.round((n || 0) / 1024)) + 'KB'; }
    async function refreshTplInfo() {
      if (!window.DocsTemplate) { tplInfoEl.textContent = '양식 모듈 로드 안 됨 (앱 재빌드 필요)'; return; }
      var info = await DocsTemplate.info(TPLKIND);
      if (!info) {
        var _pfn = '';
        try { var _p = window.Profiles && Profiles.forCurrentWork(); if (_p) _pfn = _p.name || ''; } catch (e) {}
        tplInfoEl.innerHTML = '기본 양식으로 만듭니다.<br>업체에서 쓰시던 엑셀 양식을 올리면 그 양식에 값을 채워 드립니다.' +
          (_pfn ? '<br><span style="color:var(--ac);">※ 양식은 업종마다 따로 저장됩니다 — 지금은 <b>' + _pfn + '</b> 업종</span>' : '');
        return;
      }
      tplInfoEl.innerHTML =
        '<b style="color:var(--ac);">' + esc(info.name) + '</b> <span style="opacity:.8;">(' + fmtKB(info.size) + ')</span> 사용 중' +
        ' <a href="#" id="dxTplDel" style="color:var(--dn);margin-left:6px;">삭제</a>' +
        '<div id="dxTplFields" style="margin-top:5px;"></div>';
      var del = ov.querySelector('#dxTplDel');
      if (del) del.onclick = async function (e) {
        e.preventDefault();
        if (!confirm('등록한 양식을 삭제하고 기본 양식으로 돌아갈까요?')) return;
        await DocsTemplate.clear(TPLKIND);
        toast('기본 양식으로 되돌렸습니다', 'ok');
        refreshTplInfo();
      };
      // 인식 결과 표시
      try {
        var buf = await DocsTemplate.buffer(TPLKIND);
        var pv = await DocsTemplate.preview(TPLKIND, buf);
        var box = ov.querySelector('#dxTplFields');
        if (box) {
          box.innerHTML =
            '<span style="color:var(--ok,#16a34a);">채울 항목 ' + pv.ok.length + '개</span>' +
            (pv.no.length ? ' <span style="color:var(--mu);">· 못 찾음: ' + esc(pv.no.join(', ')) + '</span>' : '');
        }
      } catch (e) {}
    }

    ov.querySelector('#dxTplPick').onclick = function () { tplFile.click(); };
    tplFile.onchange = async function () {
      var f = tplFile.files && tplFile.files[0]; tplFile.value = '';
      if (!f) return;
      if (!/\.xlsx$/i.test(f.name)) { toast('엑셀(.xlsx) 파일만 올릴 수 있어요', 'err'); return; }
      if (f.size > 5 * 1024 * 1024) { toast('양식 파일이 너무 큽니다(5MB 이하)', 'err'); return; }
      if (!window.DocsTemplate) { toast('양식 모듈 로드 안 됨 (앱 재빌드 필요)', 'err'); return; }
      try {
        // 먼저 인식 결과를 보여주고 확인받는다
        var ab = await f.arrayBuffer();
        var pv = await DocsTemplate.preview(TPLKIND, ab);
        if (!pv.ok.length) {
          alert('\u26A0\uFE0F 이 양식에서는 채울 칸을 찾지 못했습니다.\n\n' +
                '\'상호\', \'사업자등록번호\', \'수량\', \'단가\' 같은 항목 이름이\n' +
                '엑셀 칸에 글자로 들어있어야 자동으로 찾을 수 있습니다.\n' +
                '(글자가 그림으로 되어 있으면 찾지 못합니다)');
          return;
        }
        var msg = '이 양식에서 찾은 칸입니다.\n\n\u2714 ' + pv.ok.join(', ');
        if (pv.no.length) msg += '\n\n\u00B7 못 찾은 항목: ' + pv.no.join(', ') + '\n(이 항목은 비워둔 채로 만들어집니다)';
        msg += '\n\n이 양식을 사용할까요?';
        if (!confirm(msg)) return;
        await DocsTemplate.save(TPLKIND, f);
        toast('\u2705 양식이 등록되었습니다', 'ok');
        refreshTplInfo();
      } catch (e) {
        console.error(e);
        toast('양식을 읽지 못했습니다: ' + (e.message || e), 'err');
      }
    };
    refreshTplInfo();

    // 사업자등록증 분석
    var ocrFile = ov.querySelector('#dxOcrFile');
    ov.querySelector('#dxOcr').onclick = function () { ocrFile.click(); };
    /* ★ 2026-08-30 게이트 뒤의 본체를 함수로 떼어냈다.
         로그인 유도로 막혔을 때 로그인 후 '고른 파일 그대로' 이어서 분석하기 위해서다.
         ⚠️ input 은 value 를 바로 비우므로, 여기서 f 를 붙들지 않으면 사용자가 파일을 다시 골라야 한다. */
    async function _runBizOcr(f) {
      var stat = ov.querySelector('#dxOcrStat'); stat.style.display = ''; stat.textContent = '⏳ 사업자등록증 분석 중…';
      try {
        var img = await ClaudeAI.fileToResizedBase64(f, 1600, 0.85);
        var r = await ClaudeAI.analyzeBizCert([{ media_type: img.media_type, data: img.data }]);
        if (!r) { stat.textContent = '❌ 인식 실패 — 직접 입력해주세요'; return; }
        try { if (window.Subs) Subs.consumeAI('sched'); } catch (e) {}  // ★ 구독: 일정등록 1회 차감
        _ocrRaw = r;
        if (r.name) ov.querySelector('#dxBizName').value = r.name;
        if (r.bizNo) ov.querySelector('#dxBizNo').value = r.bizNo;
        if (r.ceo) ov.querySelector('#dxBizCeo').value = r.ceo;
        if (r.addr) ov.querySelector('#dxBizAddr').value = r.addr;
        if (r.tel) ov.querySelector('#dxBizTel').value = r.tel;
        stat.textContent = '✅ 분석 완료 — 내용을 확인/수정하세요';
      } catch (e) { stat.textContent = '❌ 분석 실패: ' + (e.message || e); }
    }
    ocrFile.onchange = async function () {
      var f = ocrFile.files && ocrFile.files[0]; ocrFile.value = '';
      if (!f) return;
      if (!(window.ClaudeAI && ClaudeAI.analyzeBizCert)) { toast('AI 모듈 로드 안됨', 'err'); return; }
      // ★ 구독: 사업자등록증 분석도 일정등록 차감 / 로그인 후엔 고른 파일로 이어서
      if (window.Subs && Subs.gateAI && !Subs.gateAI('sched', function () { _runBizOcr(f); })) return;
      _runBizOcr(f);
    };

    // 항목
    var itemsBox = ov.querySelector('#dxItems');
    function readItems() {
      var arr = [];
      itemsBox.querySelectorAll('.dxItemRow').forEach(function (r) {
        arr.push({ name: r.querySelector('.dxName').value.trim(), spec: r.querySelector('.dxSpec').value.trim(), qty: digits(r.querySelector('.dxQty').value) || 1, price: digits(r.querySelector('.dxPrice').value), memo: '' });
      });
      return arr;
    }
    function recalc() {
      var its = readItems(), sup = 0; its.forEach(function (it) { sup += it.qty * it.price; });
      var vatOn = ov.querySelector('#dxVat').checked, vat = vatOn ? Math.round(sup * 0.1) : 0;
      ov.querySelector('#dxTotal').textContent = '합계: ₩' + (sup + vat).toLocaleString('ko-KR') + (vatOn ? ' (VAT 포함)' : ' (VAT 별도)');
    }
    function bindRow(r) {
      r.querySelector('.dxDel').onclick = function () { if (itemsBox.querySelectorAll('.dxItemRow').length <= 1) { r.querySelectorAll('input').forEach(function (i) { i.value = ''; }); recalc(); return; } r.remove(); recalc(); };
      r.querySelectorAll('.dxQty,.dxPrice').forEach(function (i) { i.addEventListener('input', recalc); });
    }
    itemsBox.querySelectorAll('.dxItemRow').forEach(bindRow);
    ov.querySelector('#dxAdd').onclick = function () { var t = document.createElement('div'); t.innerHTML = itemRowHtml({ name: '', spec: '', qty: 1, price: 0 }); var r = t.firstChild; itemsBox.appendChild(r); bindRow(r); };
    ov.querySelector('#dxVat').addEventListener('change', recalc);
    recalc();

    function makeCtx() {
      return {
        company: getCompany(),
        custName: ov.querySelector('#dxBizName').value.trim(),
        custTel: ov.querySelector('#dxBizTel').value.trim(),
        custEmail: ov.querySelector('#dxBizEmail').value.trim(),
        bizNo: ov.querySelector('#dxBizNo').value.trim(),
        bizCeo: ov.querySelector('#dxBizCeo').value.trim(),
        bizAddr: ov.querySelector('#dxBizAddr').value.trim(),
        date: ov.querySelector('#dxDate').value || todayStr(),
        docNo: docNo, worker: getWorkHead().worker,
        items: readItems(), vat: ov.querySelector('#dxVat').checked
      };
    }
    function fname(ctx) { var who = (ctx.custName || '문서').replace(/[\\/:*?"<>|]/g, '').slice(0, 20); return (isQuote ? '견적서_' : '거래명세서_') + who + '_' + ctx.date + '.xlsx'; }
    function learnMaybe(ctx) {
      // OCR로 채운 뒤 사용자가 고쳤으면 교정 학습 저장
      if (!_ocrRaw || !(window.ClaudeAI && ClaudeAI.saveBizCorr)) return;
      var confirmed = { bizNo: ctx.bizNo, name: ctx.custName, ceo: ctx.bizCeo, addr: ctx.bizAddr, tel: ctx.custTel };
      if (JSON.stringify(confirmed) !== JSON.stringify({ bizNo: _ocrRaw.bizNo || '', name: _ocrRaw.name || '', ceo: _ocrRaw.ceo || '', addr: _ocrRaw.addr || '', tel: _ocrRaw.tel || '' })) {
        ClaudeAI.saveBizCorr(JSON.stringify(_ocrRaw), confirmed);
      }
    }
    async function run(mode) {
      var ctx = makeCtx();
      try {
        toast('엑셀 생성 중…', 'ok');
        learnMaybe(ctx);
        var buf;
        /* ★ 2026-08-13: 사용자가 올린 양식이 있으면 그 양식에 채운다.
             내장 양식은 셀 주소가 코드에 박혀 있어(D2, J3 …) 다른 양식엔 쓸 수 없으므로,
             올린 양식은 DocsTemplate 가 라벨 글자를 찾아 채우는 방식으로 처리한다. */
        var hasMine = false;
        try { hasMine = !!(window.DocsTemplate && await DocsTemplate.info(kind)); } catch (e) {}
        if (hasMine) {
          buf = await DocsTemplate.fill(kind, ctx);
        } else {
          var url = './assets/templates/' + (isQuote ? 'quote_template2.xlsx' : 'statement_template6.xlsx');
          var edits = isQuote ? quoteEdits(ctx) : statementEdits(ctx);
          buf = await genFromTemplate(url, edits);
        }
        await shareOrDownload(buf, fname(ctx), mode, isQuote ? '견적서' : '거래명세서');
      } catch (e) { console.error(e); toast('생성 실패: ' + (e.message || e), 'err'); }
    }
    ov.querySelector('#dxDownload').onclick = function () { run('download'); };
    ov.querySelector('#dxShare').onclick = function () { run('share'); };
  }

  DocsExcel.openQuoteExcel = function () { openDialog('quote'); };
  DocsExcel.openStatementExcel = function () { openDialog('statement'); };
  window.openQuoteExcel = DocsExcel.openQuoteExcel;
  window.openStatementExcel = DocsExcel.openStatementExcel;
})();
