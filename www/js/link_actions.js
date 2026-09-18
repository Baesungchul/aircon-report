/* ═══════════════════════════════════════════════
   LINK ACTIONS ─ 전화/주소 필드 옆 바로가기 아이콘
   - 전화번호: 전화 걸기 / 문자 보내기
   - 주소: 길안내(설치된 지도·내비 앱 선택창) / 지도에서 찍기(앱 안 지도, 2026-09-17)
   - 아이콘은 이모지가 아니라 선 그림(SVG)이다 — 아래 svgIcon 주석 참고
   - 작업탭·스케줄수정·일정추가 등 알려진 입력 id에 자동 부착(MutationObserver)
═══════════════════════════════════════════════ */
(function () {
  'use strict';
  window.LinkActions = window.LinkActions || {};

  var PHONE_IDS = ['wePhone', 'qwPhone', 'cePhone', 'custEditPhone', 'asPhone', 'facilityPhone'];
  var ADDR_IDS = ['weAddr', 'qwAddr', 'ceAddr', 'custEditAddr', 'asAddr', 'facilityAddress'];

  /* ★ 2026-09-17 — 지도 아래 막대에 그날 지도 카드와 같은 정보(시간·이름·대상)를 띄우려면
       지금 열려 있는 창의 다른 입력칸을 읽어야 한다. 주소칸 id 하나로 그 창을 알 수 있다.
     ⚠️ 값은 **열 때마다 새로 읽는다.** 창을 열어 두고 시간을 고친 뒤 지도를 열면
        고친 값이 보여야 한다.
     ⚠️ 여기 없는 주소칸(고객 정보 등)은 그냥 주소만 보여 준다 — 작업이 아닌 화면도 있다. */
  var ADDR_FORM = {
    weAddr:   { apt: 'weApt', unit: 'weUnit', target: 'weTarget', start: 'weStart', end: 'weEnd' },
    qwAddr:   { apt: 'qwApt', unit: 'qwUnit', target: 'qwTarget', start: 'qwStart', end: 'qwEnd' },
    asAddr:   { apt: 'asApt', unit: 'asUnit', target: 'asTarget', start: 'asStart', end: 'asEnd' },
    ceAddr:   { apt: 'ceApt', unit: 'ceUnit', target: 'ceTarget', start: 'ceStart', end: 'ceEnd' },
    facilityAddress: { target: 'facilityWorkTarget', start: 'facilityStartTime', end: 'facilityEndTime' },
    custEditAddr:    { apt: 'custEditName' }
  };
  function val(id) {
    var el = id && document.getElementById(id);
    return (el && String(el.value || '').trim()) || '';
  }
  /* 그날 지도 카드와 같은 규칙으로 고른다:
       제목 = 작업명, 없으면 호수 / 아래 = 작업대상, 없으면 호수 / 시간 = 시작~종료 */
  function metaOf(el) {
    var f = ADDR_FORM[el && el.id];
    if (!f) return {};
    var apt = val(f.apt), unit = val(f.unit), target = val(f.target);
    var st = val(f.start), et = val(f.end);
    return {
      title: apt || unit || '',
      sub: target || (apt ? unit : ''),
      time: (st && et) ? (st + '~' + et) : (st || et || '')
    };
  }

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

  /* ── 아이콘 버튼 ──
     ★ 2026-09-17 — 네 버튼 모두 이모지에서 직접 그린 선 아이콘으로 바꿨다.
       · 이모지는 기기·OS·글꼴마다 그림이 다르고, 34px 칸에서 뭉갠다.
       · 컬러 이모지는 테마를 안 따라가서 다크 모드에서 혼자 튄다.
       · 선 색이 currentColor 라 테마(다크·미드나잇·포레스트)를 그대로 물려받는다.
     ⚠️ 카카오맵 로고를 쓰지 않는다. 카카오 마크는 '카카오맵 앱으로 넘어가는' 버튼에
        쓰라고 배포되는 상표인데, 이 버튼은 앱 안에서 우리 화면을 연다.
        접힌 지도·수화기·말풍선·화살표는 어디서나 통하는 일반적인 표시다.
     ⚠️ 굵기(1.7)와 크기(19)를 넷이 똑같이 쓴다. 하나만 다르면 줄이 어긋나 보인다. */
  function svgIcon(inner) {
    return '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      inner + '</svg>';
  }
  var IC_TEL = svgIcon(
    '<path d="M21.5 16.9v2.7a2 2 0 0 1-2.2 2 19.6 19.6 0 0 1-8.5-3 19.3 19.3 0 0 1-6-6 19.6 19.6 0 0 1-3-8.6 2 2 0 0 1 2-2.2h2.7a2 2 0 0 1 2 1.7c.13.94.36 1.86.7 2.74a2 2 0 0 1-.46 2.1L8.2 9.7a16 16 0 0 0 6 6l1.4-1.24a2 2 0 0 1 2.1-.45c.88.33 1.8.57 2.74.7a2 2 0 0 1 1.7 2z"/>');
  var IC_SMS = svgIcon(
    '<path d="M20.5 11.6a7.9 7.9 0 0 1-8.5 7.9 9 9 0 0 1-3.6-.7L3.5 20.5l1.7-4.9a7.9 7.9 0 0 1-.7-3.6A7.9 7.9 0 0 1 12.5 4a7.9 7.9 0 0 1 8 7.6z"/>');
  var IC_NAV = svgIcon(
    '<path d="M21 3 3 10.5l7.6 2.9L13.5 21z"/>');
  var IC_MAP = svgIcon(
    '<path d="M9 4 3 6.2v13.3L9 17l6 2.5 6-2.2V4l-6 2.2z"/>' +
    '<path d="M9 4v13"/><path d="M15 6.2v13.3"/>');

  /* icon 이 '<' 로 시작하면 그림(SVG), 아니면 글자·이모지로 본다 */
  function mkIcon(icon, title, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    if (String(icon).charAt(0) === '<') b.innerHTML = icon;
    else b.textContent = icon;
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
    wrap.appendChild(mkIcon(IC_TEL, '전화 걸기', function () { tel(el.value); }));
    wrap.appendChild(mkIcon(IC_SMS, '문자 보내기', function () { sms(el.value); }));
  }
  function enhanceAddr(el) {
    if (!el || el._laDone) return; el._laDone = true;
    var wrap = wrapInput(el);
    wrap.appendChild(mkIcon(IC_NAV, '길안내', function () { nav(el.value); }));
    /* ★ 2026-09-17 지도에서 주소 찍기 (2단계)
       주소칸이 비었거나 아파트 이름만 적힌 작업은 지도에 안 뜬다 — 그 원인을
       입력하는 자리에서 막는다. 지도를 길게 눌러 그 자리 주소를 넣을 수 있다.
       ⚠️ 지도 키(config_map.js)가 없으면 버튼 자체를 안 만든다.
          눌러도 아무 일 없는 버튼을 두는 것보다, 없는 편이 덜 헷갈린다. */
    if (window.MapPick && MapPick.available()) {
      wrap.appendChild(mkIcon(IC_MAP, '지도에서 찍기', function () {
        MapPick.open(el.value, function (addr) {
          el.value = addr;
          /* 입력칸을 코드로 바꾸면 사람이 친 것과 달리 아무 신호도 안 난다.
             저장 여부를 input/change 로 판단하는 화면들이 있어 직접 알려 준다. */
          try { el.dispatchEvent(new Event('input',  { bubbles: true })); } catch (e) {}
          try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
        }, metaOf(el));
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
