/* ═══════════════════════════════════════════════════════════
   bizcert_fill.js — 사업자등록증 촬영 → 업체정보 자동입력  (2026-08-09)
   ----------------------------------------------------------------
   · 분석은 기존 ClaudeAI.analyzeBizCert 재사용 (견적서에서 쓰던 것과 동일 + 학습 공유)
   · 온보딩 '업체 정보' 슬라이드와 설정 '업체정보 편집' 두 곳에서 같은 코드를 쓴다.
   · 결과는 사용자가 확인/수정한 뒤 채워 넣는다(바로 덮어쓰지 않음).
     확정본은 ClaudeAI.saveBizCorr 로 학습에 반영되어 다음 인식이 좋아진다.
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  window.BizFill = window.BizFill || {};

  function toast(m, t) { if (typeof showToast === 'function') showToast(m, t || 'ok'); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function hyphenTel(v) {
    var d = String(v || '').replace(/[^\d]/g, '');
    if (d.length === 11) return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
    if (d.length === 10) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
    if (d.length === 9)  return d.slice(0, 2) + '-' + d.slice(2, 5) + '-' + d.slice(5);
    return String(v || '');
  }
  function hyphenBiz(v) {
    var d = String(v || '').replace(/[^\d]/g, '');
    if (d.length === 10) return d.slice(0, 3) + '-' + d.slice(3, 5) + '-' + d.slice(5);
    return String(v || '');
  }

  /* ── 확인 화면 ─────────────────────────── */
  //  r: analyzeBizCert 결과 → 사용자가 고친 뒤 {name,bizNo,ceo,addr,tel} 반환 (취소면 null)
  function confirmDialog(r) {
    return new Promise(function (resolve) {
      var rows = [
        ['name',  '상호 (업체명)', r.name || ''],
        ['bizNo', '사업자 등록번호', hyphenBiz(r.bizNo)],
        ['ceo',   '대표자 성명',   r.ceo || ''],
        ['addr',  '사업장 주소',   r.addr || ''],
        ['tel',   '전화번호',      hyphenTel(r.tel)]
      ];
      var ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:3300;display:flex;align-items:center;justify-content:center;padding:18px;overflow-y:auto;';
      ov.innerHTML = '<div style="background:var(--sf);border-radius:14px;padding:20px;max-width:420px;width:100%;">' +
        '<div style="font-size:17px;font-weight:800;margin-bottom:4px;">📄 읽은 내용을 확인해주세요</div>' +
        '<div style="font-size:12px;color:var(--mu);line-height:1.6;margin-bottom:14px;">잘못 읽은 곳은 고쳐주세요. 고친 내용은 다음 인식에 반영됩니다.</div>' +
        rows.map(function (f) {
          return '<div style="margin-bottom:10px;">' +
            '<label style="display:block;font-size:12px;color:var(--mu);margin-bottom:4px;">' + f[1] + '</label>' +
            '<input class="co-input" data-k="' + f[0] + '" value="' + esc(f[2]) + '" ' +
              'style="width:100%;padding:9px 10px;border-radius:8px;background:var(--bg2,rgba(255,255,255,.06));' +
              'color:var(--tx);border:1px solid var(--bd,#2a2f36);font-size:14px;box-sizing:border-box;">' +
          '</div>';
        }).join('') +
        '<div style="display:flex;gap:8px;margin-top:14px;">' +
          '<button class="btn b-ghost" id="bfCancel" style="flex:1;justify-content:center;">취소</button>' +
          '<button class="btn b-green" id="bfOk" style="flex:1.4;justify-content:center;">✅ 입력하기</button>' +
        '</div></div>';
      document.body.appendChild(ov);
      ov.querySelector('#bfCancel').onclick = function () { ov.remove(); resolve(null); };
      ov.querySelector('#bfOk').onclick = function () {
        var out = {};
        ov.querySelectorAll('input[data-k]').forEach(function (i) { out[i.getAttribute('data-k')] = i.value.trim(); });
        ov.remove(); resolve(out);
      };
    });
  }

  /* ── 파일 → 분석 → 확인 → 반환 ───────────── */
  BizFill.analyze = async function (file) {
    if (!file) return null;
    if (!(window.ClaudeAI && ClaudeAI.analyzeBizCert)) { toast('AI 모듈을 불러오지 못했습니다', 'err'); return null; }
    // 구독 게이트 — 견적서 쪽과 동일하게 일정등록 사용량에서 차감
    /* ★ 2026-08-30 로그인 후엔 고른 파일 그대로 분석을 이어간다 (다시 고르게 하지 않는다) */
    try { if (window.Subs && Subs.gateAI && !Subs.gateAI('sched', function () { BizFill.analyze(file); })) return null; } catch (e) {}

    if (typeof showOverlay === 'function') showOverlay('📄 사업자등록증 읽는 중...');
    var r = null;
    try {
      var img = await ClaudeAI.fileToResizedBase64(file, 1600, 0.85);
      r = await ClaudeAI.analyzeBizCert([{ media_type: img.media_type, data: img.data }]);
    } catch (e) {
      if (typeof hideOverlay === 'function') hideOverlay();
      toast('분석 실패: ' + (e && e.message), 'err');
      return null;
    }
    if (typeof hideOverlay === 'function') hideOverlay();
    if (!r) { toast('인식하지 못했습니다. 밝은 곳에서 반듯하게 다시 찍어주세요', 'err'); return null; }
    try { if (window.Subs && Subs.consumeAI) Subs.consumeAI('sched'); } catch (e) {}

    var fixed = await confirmDialog(r);
    if (!fixed) return null;
    // 사용자가 확정한 값을 학습에 반영
    try {
      if (ClaudeAI.saveBizCorr) {
        ClaudeAI.saveBizCorr(JSON.stringify(r), {
          name: fixed.name, bizNo: fixed.bizNo, ceo: fixed.ceo, addr: fixed.addr, tel: fixed.tel
        });
      }
    } catch (e) {}
    return fixed;
  };

  /* ── 버튼 + 파일입력 UI 조각 ───────────── */
  BizFill.buttonHtml = function (id, style) {
    // ★ 2026-08-10: capture="environment"를 넣으면 카메라만 강제로 열려 갤러리(사진 선택)를
    //   쓸 수 없었다. capture 속성을 빼면 OS가 카메라/갤러리 둘 다 고를 수 있는 선택창을 띄운다.
    return '<button type="button" class="btn b-ghost" id="' + id + '" ' +
      'style="width:100%;justify-content:center;' + (style || '') + '">📄 사업자등록증으로 자동입력</button>' +
      '<input type="file" id="' + id + 'File" accept="image/*" style="display:none;">';
  };

  //  id: buttonHtml 에 쓴 것과 같은 id
  //  map: { name:'coName', bizNo:'coBiz', ceo:'coCeo', addr:'coAddr', tel:'coTel' } (요소 id)
  //  onFilled(fixed): 값 채운 뒤 후처리 (온보딩 _obData 갱신 등)
  BizFill.wire = function (id, map, onFilled) {
    var btn = document.getElementById(id);
    var fin = document.getElementById(id + 'File');
    if (!btn || !fin || btn._bfWired) return;
    btn._bfWired = true;
    btn.addEventListener('click', function () { fin.value = ''; fin.click(); });
    fin.addEventListener('change', async function () {
      var f = fin.files && fin.files[0];
      fin.value = '';
      if (!f) return;
      var fixed = await BizFill.analyze(f);
      if (!fixed) return;
      var n = 0;
      Object.keys(map).forEach(function (k) {
        var v = fixed[k];
        if (!v) return;
        var el = document.getElementById(map[k]);
        if (!el) return;
        if (k === 'tel') v = hyphenTel(v);
        if (k === 'bizNo') v = hyphenBiz(v);
        el.value = v; n++;
        try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
      });
      if (typeof onFilled === 'function') { try { onFilled(fixed); } catch (e) {} }
      toast(n ? ('✅ ' + n + '개 항목을 채웠어요') : '채울 항목이 없었어요', n ? 'ok' : 'err');
    });
  };
})();
