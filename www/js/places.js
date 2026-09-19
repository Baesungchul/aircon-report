/* ═══════════════════════════════════════════════════════════
   places.js — 내 장소 (집 · 회사)  2026-09-19
   ----------------------------------------------------------------
   그날 지도에서 자주 쓰는 두 곳을 미리 넣어 둔다.
     · 머리줄 칩을 누르면 **바로 길안내**가 열린다(퇴근할 때 한 번에 출발).
     · [복귀] 를 켜면 마지막 작업에서 집·회사로 돌아가는 구간까지 동선에 들어간다.

   ⚠️ 좌표는 저장하지 않는다. 주소 글자만 들고 있고, 좌표가 필요하면 그때 Geocode 에
      물어본다. geocode.js 가 이미 캐시를 하고 있어서(ac_geocache_v1) 두 번 묻지 않는다.
      좌표까지 저장하면 '주소는 고쳤는데 좌표는 옛날 것'인 상태가 생긴다 — 그게 제일 고치기 어렵다.

   ⚠️ 이 값은 기기에만 있다(localStorage). 클라우드로 올리지 않는다.
      집 주소는 남과 나눌 값이 아니고, 팀원에게 보일 이유도 없다.

   ⚠️ 복귀 대상은 따로 기억한다(끔 / 집 / 회사). 기본은 **꺼짐** —
      평소 화면을 단순하게 두고, 경로 API 호출도 필요할 때만 늘린다.
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var KEY = 'ac_myplaces_v1';
  var RET_KEY = 'ac_myplace_return';
  var KINDS = [{ k: 'home', label: '집' }, { k: 'work', label: '회사' }];

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function write(o) {
    try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {}
  }
  function labelOf(kind) {
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i].k === kind) return KINDS[i].label;
    return '';
  }
  /* {addr} 또는 null */
  function get(kind) {
    var o = read()[kind];
    if (!o || !String(o.addr || '').trim()) return null;
    return { addr: String(o.addr).trim() };
  }
  function set(kind, addr) {
    var o = read();
    addr = String(addr || '').trim();
    if (addr) o[kind] = { addr: addr }; else delete o[kind];
    write(o);
    /* 등록을 지웠는데 복귀가 그 곳을 가리키고 있으면 같이 끈다 —
       안 그러면 '켜져 있는데 아무 데도 안 가는' 상태가 된다 */
    if (!addr && returnTo() === kind) setReturnTo('');
  }
  function any() { return !!(get('home') || get('work')); }

  function returnTo() {
    var v = '';
    try { v = localStorage.getItem(RET_KEY) || ''; } catch (e) {}
    if (v && !get(v)) return '';          // 등록이 없어졌으면 꺼진 것으로 본다
    return v;
  }
  function setReturnTo(v) {
    try {
      if (v) localStorage.setItem(RET_KEY, v); else localStorage.removeItem(RET_KEY);
    } catch (e) {}
  }
  /* 끔 → 집 → 회사 → 끔. **등록된 곳만** 거친다 —
     없는 곳을 거치면 '눌렀는데 아무 일도 안 나는' 한 칸이 생긴다. */
  function cycleReturn() {
    var order = [''].concat(KINDS.map(function (x) { return x.k; }))
      .filter(function (k) { return !k || !!get(k); });
    var cur = returnTo();
    var i = order.indexOf(cur);
    var next = order[(i < 0 ? 0 : i + 1) % order.length];
    setReturnTo(next);
    return next;
  }

  window.MyPlaces = {
    KINDS: KINDS, get: get, set: set, any: any, label: labelOf,
    returnTo: returnTo, setReturnTo: setReturnTo, cycleReturn: cycleReturn,
    _key: KEY, _retKey: RET_KEY
  };
})();

/* ═══════════════════════════════════════════════════════════
   설정 화면의 '내 장소' 칸 — 지도 칩과 같은 값을 다룬다
   ⚠️ 그리는 시점은 settings.js 의 openSettings 다(업종 칸과 같은 자리).
      여기서 스스로 그리지 않는다 — 설정을 안 여는 사람에게도 매번 도는 코드가 된다.
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function render() {
    var host = document.getElementById('setPlacesBox');
    if (!host) return;
    host.innerHTML = MyPlaces.KINDS.map(function (K) {
      var p = MyPlaces.get(K.k);
      return '<div class="pl-row" data-k="' + K.k + '">' +
        '<div class="pl-tx"><b>' + esc(K.label) + '</b>' +
          '<span>' + esc(p ? p.addr : '아직 없음') + '</span></div>' +
        '<button type="button" class="btn b-ghost pl-edit" data-k="' + K.k + '">' +
          (p ? '수정' : '등록') + '</button>' +
        (p ? '<button type="button" class="btn b-ghost pl-del" data-k="' + K.k + '">지움</button>' : '') +
      '</div>';
    }).join('') +
    '<div class="pl-help">스케줄의 [동선 보기] 위쪽에 칩으로 나옵니다. ' +
    '눌러서 바로 길안내를 열고, 길게 누르면 여기와 같은 수정 화면이 뜹니다.</div>';

    host.querySelectorAll('.pl-edit').forEach(function (b) {
      b.onclick = function () { edit(b.getAttribute('data-k')); };
    });
    host.querySelectorAll('.pl-del').forEach(function (b) {
      b.onclick = function () {
        var k = b.getAttribute('data-k');
        /* 지우기는 되돌릴 수 없으니 한 번 확인한다(실패·확인은 남긴다는 팝업 기준) */
        if (!confirm(MyPlaces.label(k) + ' 주소를 지울까요?')) return;
        MyPlaces.set(k, '');
        render();
      };
    });
  }

  function edit(kind) {
    var cur = MyPlaces.get(kind);
    var label = MyPlaces.label(kind);
    if (window.MapPick && MapPick.available()) {
      MapPick.open((cur && cur.addr) || '', function (addr) {
        MyPlaces.set(kind, addr); render();
      }, { title: label, sub: '내 장소', time: '' });
      return;
    }
    var v = null;
    try { v = window.prompt(label + ' 주소', (cur && cur.addr) || ''); } catch (e) {}
    if (v === null) return;
    MyPlaces.set(kind, v);
    render();
  }

  window.PlacesUI = { renderSettings: render };
})();
