/* ═══════════════════════════════════════════════
   LINK ACTIONS ─ 전화/주소 필드 옆 바로가기 아이콘
   - 전화번호: 📞 전화앱 / 💬 문자앱
   - 주소: 🗺️ 지도(카카오·네이버·구글) / 🧭 길안내(구글·티맵·카카오)
   - 작업탭·스케줄수정·일정추가 등 알려진 입력 id에 자동 부착(MutationObserver)
═══════════════════════════════════════════════ */
(function () {
  'use strict';
  window.LinkActions = window.LinkActions || {};

  var PHONE_IDS = ['wePhone', 'qwPhone', 'cePhone', 'custEditPhone', 'asPhone', 'facilityPhone'];
  var ADDR_IDS = ['weAddr', 'qwAddr', 'ceAddr', 'custEditAddr', 'asAddr', 'facilityAddress'];

  function toast(m, t) { if (typeof showToast === 'function') showToast(m, t || 'ok'); else if (t === 'err') alert(m); }
  function enc(s) { return encodeURIComponent(String(s || '').trim()); }

  function openExternal(url) {
    try {
      if (/^https?:/.test(url) && window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Browser) {
        Capacitor.Plugins.Browser.open({ url: url }); return;
      }
    } catch (e) {}
    if (!/^https?:/.test(url)) { try { window.location.href = url; return; } catch (e) {} }
    try {
      var a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove(); return;
    } catch (e) {}
    try { window.location.href = url; } catch (e) {}
  }
  function tel(num) { num = String(num || '').replace(/[^0-9+]/g, ''); if (!num) { toast('전화번호가 없습니다', 'err'); return; } openExternal('tel:' + num); }
  function sms(num) { num = String(num || '').replace(/[^0-9+]/g, ''); if (!num) { toast('전화번호가 없습니다', 'err'); return; } openExternal('sms:' + num); }

  LinkActions.tel = tel; LinkActions.sms = sms;

  function nav(addr) {
    if (!String(addr || '').trim()) { toast('주소가 없습니다', 'err'); return; }
    // geo: 인텐트 → 안드로이드가 설치된 지도/내비 앱(카카오맵·카카오내비·티맵·네이버·구글 등) 선택창을 띄움
    openExternal('geo:0,0?q=' + enc(addr));
  }
  LinkActions.nav = nav;

  /* 아이콘 버튼 */
  function mkIcon(emoji, title, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = emoji;
    b.title = title;
    b.style.cssText = 'flex:0 0 auto;width:34px;height:34px;border-radius:9px;border:1px solid var(--bd);background:var(--sf2,#2a2f3a);color:var(--tx);font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;';
    b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); fn(); };
    return b;
  }
  function wrapInput(el) {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:4px;';
    el.parentNode.insertBefore(wrap, el);
    wrap.appendChild(el);
    el.style.marginTop = '0';
    el.style.flex = '1';
    el.style.minWidth = '0';
    return wrap;
  }
  function enhancePhone(el) {
    if (!el || el._laDone) return; el._laDone = true;
    var wrap = wrapInput(el);
    wrap.appendChild(mkIcon('📞', '전화 걸기', function () { tel(el.value); }));
    wrap.appendChild(mkIcon('💬', '문자 보내기', function () { sms(el.value); }));
  }
  function enhanceAddr(el) {
    if (!el || el._laDone) return; el._laDone = true;
    var wrap = wrapInput(el);
    wrap.appendChild(mkIcon('🧭', '길안내', function () { nav(el.value); }));
    /* ★ 2026-09-17 지도에서 주소 찍기 (2단계)
       주소칸이 비었거나 아파트 이름만 적힌 작업은 지도에 안 뜬다 — 그 원인을
       입력하는 자리에서 막는다. 지도를 길게 눌러 그 자리 주소를 넣을 수 있다.
       ⚠️ 지도 키(config_map.js)가 없으면 버튼 자체를 안 만든다.
          눌러도 아무 일 없는 버튼을 두는 것보다, 없는 편이 덜 헷갈린다. */
    if (window.MapPick && MapPick.available()) {
      wrap.appendChild(mkIcon('🗺', '지도에서 찍기', function () {
        MapPick.open(el.value, function (addr) {
          el.value = addr;
          /* 입력칸을 코드로 바꾸면 사람이 친 것과 달리 아무 신호도 안 난다.
             저장 여부를 input/change 로 판단하는 화면들이 있어 직접 알려 준다. */
          try { el.dispatchEvent(new Event('input',  { bubbles: true })); } catch (e) {}
          try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
        });
      }));
    }
  }
  function scan() {
    PHONE_IDS.forEach(function (id) { enhancePhone(document.getElementById(id)); });
    ADDR_IDS.forEach(function (id) { enhanceAddr(document.getElementById(id)); });
    Array.prototype.forEach.call(document.querySelectorAll('input[data-field="phone"]'), function (el) { enhancePhone(el); });
    Array.prototype.forEach.call(document.querySelectorAll('input[data-field="address"]'), function (el) { enhanceAddr(el); });
  }
  /* ★ 2026-08-08 배터리 개선:
       기존엔 body 전체(subtree) 변경이 생길 때마다 rAF(약 16ms)마다 scan()이 돌았다.
       scan()은 문서 전체 querySelectorAll을 4번 하므로, 채팅/달력처럼 자주 다시 그리는
       화면에서 헛스캔이 계속 쌓였다. 두 가지로 줄인다.
        (1) 엘리먼트가 새로 추가된 변경만 대상으로 삼는다(글자만 바뀐 변경은 무시).
            입력칸이 통째로 추가될 때만 아이콘을 붙이면 되므로 누락되지 않는다.
        (2) rAF 대신 200ms 디바운스로 묶어 연속 렌더를 한 번으로 합친다.
            아이콘이 최대 200ms 늦게 붙지만 체감되지 않는다. */
  var _scanT = null;
  function schedule() {
    if (_scanT) return;
    _scanT = setTimeout(function () { _scanT = null; scan(); }, 200);
  }
  function onMutations(muts) {
    for (var i = 0; i < muts.length; i++) {
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        if (added[j].nodeType === 1) { schedule(); return; }   // 엘리먼트 추가일 때만
      }
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    scan();
    try {
      var mo = new MutationObserver(onMutations);
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  });
})();
