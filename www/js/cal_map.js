/* ═══════════════════════════════════════════════════════════
   cal_map.js — 그날 작업을 지도 한 장으로 (스케줄 탭)
   ----------------------------------------------------------------
   날짜를 누르면 나오는 목록의 머리줄에서 [지도] 를 누르면 열린다.
   그날 갈 곳들이 **시간순 번호**로 찍히고, 아래 카드에서 바로 길안내로 넘어간다.

   ☠️ 왜 목록 패널 안이 아니라 전체화면인가 (2026-09-17 결정)
      ① #calDetail 에는 좌우 스와이프(날짜 이동) 손짓이 직접 붙어 있다(calendar.js).
         지도를 그 안에 넣으면 지도를 끄는 손짓과 날짜 넘김이 매번 싸운다.
         찍고쓰다에서 롱프레스 하나 잡느라 실기기를 몇 번씩 왕복한 걸 생각하면,
         애초에 안 부딪히는 자리에 두는 쪽이 싸다.
      ② 스케줄 탭은 달력이 위에 고정되고 목록만 스크롤한다 → 목록 자리는 화면 절반이 안 된다.
         아침에 동선을 훑는 용도로 그 크기는 쓸모가 없다.

   ⚠️ 뒤로가기(하드웨어 ←)에 걸리려면 오버레이에 `ov-lock` 과 닫기 버튼이 있어야 한다.
      (state.js closeTopPopup — 표식이 없으면 팝업이 뜬 채로 뒤 화면 탭이 바뀐다)

   ⭐ 지도 키가 없어도 이 화면은 쓸모가 있다 — 길안내는 주소 글자만으로 되기 때문이다.
      그래서 키가 없으면 지도 자리에 한 줄만 적고, 카드와 길안내는 그대로 준다.
      (빈 회색 네모를 보여주느니 왜 없는지 적고 쓸 수 있는 걸 주는 게 낫다 — 찍고쓰다와 같은 규칙)
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var _ov = null;          // 열려 있는 오버레이
  var _pins = [];          // 번호 표식 DOM (선택 표시를 바꾸려고 들고 있는다)
  var _sel = -1;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function toastErr(m) { if (typeof showToast === 'function') showToast(m, 'err'); }

  /* 테마 강조색을 카카오 도형이 받는 형태로.
     ⚠️ --ac 는 var() 로 한 겹 더 감싸여 있어 getPropertyValue 로는 원문("var(--ac-l,#...)")이 나온다
        → 실제로 그려 보고 계산된 색을 읽는다.
     ⚠️ 계산된 색은 "rgb(15, 95, 107)" 꼴인데 카카오 strokeColor 는 #RRGGBB 를 받는다
        → 여기서 바꿔 준다. 안 바꾸면 선이 검정으로 떨어진다(오류는 안 난다). */
  function accent() {
    var FALLBACK = '#3b82f6';
    try {
      var d = document.createElement('div');
      d.style.cssText = 'position:absolute;left:-9999px;top:-9999px;color:var(--ac);';
      document.body.appendChild(d);
      var c = getComputedStyle(d).color || '';
      if (d.parentNode) d.parentNode.removeChild(d);
      var m = c.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (!m) return /^#[0-9a-f]{3,8}$/i.test(c) ? c : FALLBACK;
      return '#' + [m[1], m[2], m[3]].map(function (n) {
        return ('0' + parseInt(n, 10).toString(16)).slice(-2);
      }).join('');
    } catch (e) { return FALLBACK; }
  }

  /* 길안내 — 이미 앱에 있는 길을 그대로 쓴다(geo: 인텐트 → 설치된 지도·내비 앱 선택창).
     ⚠️ 좌표를 알아도 좌표로 보내지 않는다. 주소로 보내는 지금 방식이 실기기에서
        검증된 길이고, 국내 내비 앱마다 geo:위도,경도 해석이 미묘하게 다르다.
        바꾸고 싶으면 이 함수 한 곳만 고치면 된다. */
  function navTo(addr) {
    if (window.LinkActions && LinkActions.nav) { LinkActions.nav(addr); return; }
    toastErr('길안내를 열 수 없습니다');
  }

  function close() {
    if (_ov && _ov.parentNode) _ov.parentNode.removeChild(_ov);
    _ov = null; _pins = []; _sel = -1;
  }

  /* ── 카드 줄 ──
     ☠️ 길안내 버튼을 마커 말풍선 안에 넣지 않는다. 말풍선은 손가락으로 누르기엔 작고,
        지도를 훑다 잘못 누르면 엉뚱한 내비가 켜진다(되돌릴 화면이 없다).
        찍고쓰다도 '찍고 → 아래 막대에서 확인 → 실행' 두 단계를 쓴다. 규칙을 맞춘다. */
  function cardsHtml(stops) {
    return stops.map(function (s, i) {
      var noAddr = !String(s.addr || '').trim();
      return '<div class="cm-card' + (noAddr ? ' cm-card-noaddr' : '') + '" data-i="' + i + '">' +
        '<div class="cm-card-top">' +
          (noAddr ? '<span class="cm-no">–</span>' : '<span class="cm-num">' + (i + 1) + '</span>') +
          '<span class="cm-time">' + esc(s.time || '시간 미정') + '</span>' +
        '</div>' +
        '<div class="cm-card-ti">' + esc(s.title || '작업') + '</div>' +
        '<div class="cm-card-sub">' + esc(s.sub || '') + '</div>' +
        '<div class="cm-card-addr">' + (noAddr ? '주소 미입력' : esc(s.addr)) + '</div>' +
        /* ★ 2026-09-18 거리 줄 — 앞 지점(내 위치 또는 이전 작업)에서 여기까지.
           비워 두고 시작한다. 직선은 좌표만 나오면 바로 채워지고,
           주행은 경로가 오면 뒤에 붙는다. 둘 다 없으면 줄 자체가 안 보인다(비어 있음). */
        (noAddr ? '' : '<div class="cm-card-dist" data-i="' + i + '"></div>') +
        (noAddr
          ? '<button type="button" class="btn b-ghost cm-btn cm-edit" data-i="' + i + '">주소 넣기</button>'
          : '<button type="button" class="btn b-blue cm-btn cm-nav" data-i="' + i + '">길안내</button>') +
      '</div>';
    }).join('');
  }

  function selectCard(i, opts) {
    opts = opts || {};
    if (i === _sel) return;
    _sel = i;
    if (!_ov) return;
    _ov.querySelectorAll('.cm-card').forEach(function (c) {
      c.classList.toggle('on', parseInt(c.getAttribute('data-i'), 10) === i);
    });
    _pins.forEach(function (p) { if (p) p.classList.toggle('on', p._i === i); });
    if (opts.scroll) {
      var card = _ov.querySelector('.cm-card[data-i="' + i + '"]');
      var box = _ov.querySelector('#calMapCards');
      if (card && box) box.scrollTo({ left: card.offsetLeft - 12, behavior: 'smooth' });
    }
  }

  /* ── 선 두 가닥을 겹쳐 그린다 (2026-09-18 사용자 요청) ──
     ☠️ 예전엔 경로가 오면 점선을 **지웠다.** 같이 두기로 바꾼 이유는,
        두 값이 같이 있어야 "직선으로는 4km인데 돌아가느라 7km" 가 읽히기 때문이다.
        하나만 보이면 그게 무엇인지 알 수 없다.
        · 연한 점선 = 직선이다. 거리를 재는 선이 아니라 **순서**를 보여 주는 선이다.
        · 진한 실선 = 카카오모빌리티가 돌려준 **실제 도로 경로**다.
     ⚠️ 겹칠 땐 점선을 **더 흐리게** 낮춘다. 안 낮추면 두 선이 비슷한 굵기로 엉켜
        어느 쪽이 진짜 길인지 알 수 없다. 반대로 경로가 안 올 때(아직 안 켜졌거나
        실패)는 점선이 유일한 선이므로 원래 굵기를 지켜야 한다.
        → 그래서 처음엔 진하게 그리고, 실선이 붙는 순간에만 낮춘다.
     ⚠️ 경로 요청은 지도를 붙잡지 않는다. 점선을 먼저 그려 놓고 답이 오면 얹는다. */
  function drawLines(map, pts, head, onRoute) {
    if (!pts || pts.length < 2) return;
    var ac = accent();
    var dashed = new kakao.maps.Polyline({
      map: map,
      path: pts.map(function (p) { return new kakao.maps.LatLng(p.lat, p.lng); }),
      strokeWeight: 3, strokeColor: ac, strokeOpacity: 0.65, strokeStyle: 'shortdash'
    });
    if (!window.Routing || !Routing.available()) return;
    Routing.route(pts).then(function (r) {
      if (!r || !_ov) return;                      // 실패하거나 그새 닫혔으면 점선 그대로
      /* 실선이 주인공이 되도록 점선을 한 단계 낮춘다(지우지는 않는다) */
      try { if (dashed.setOptions) dashed.setOptions({ strokeWeight: 2, strokeOpacity: 0.3 }); } catch (e) {}
      new kakao.maps.Polyline({
        map: map,
        path: r.path.map(function (c) { return new kakao.maps.LatLng(c[0], c[1]); }),
        strokeWeight: 5, strokeColor: ac, strokeOpacity: 0.9, strokeStyle: 'solid'
      });
      if (head && r.distance) {
        head.textContent = '주행 ' + MyLoc.fmtKm(r.distance) +
          (r.duration ? ' · ' + Routing.fmtMin(r.duration) : '');
      }
      if (onRoute) onRoute(r);
    });
  }

  /* ── 카드 아래 거리 줄 ──
     '이 카드까지 오는 한 구간'의 거리다. 첫 카드는 내 위치에서, 그 뒤는 이전 작업에서.
     ⚠️ 직선은 '얼마나 떨어져 있나', 주행은 '실제로 몇 km 달리나' 다. 글자로 구분해 둔다 —
        숫자만 두 개 있으면 무엇이 무엇인지 알 수 없다. */
  function setDist(stopIdx, straightM, driveM) {
    if (!_ov) return;
    var el = _ov.querySelector('.cm-card-dist[data-i="' + stopIdx + '"]');
    if (!el) return;
    var parts = [];
    if (straightM) parts.push('직선 ' + MyLoc.fmtKm(straightM));
    if (driveM) parts.push('주행 ' + MyLoc.fmtKm(driveM));
    el.textContent = parts.join(' · ');
    el.classList.toggle('on', !!parts.length);
  }

  /* ── 지도 그리기 ──
     me : { lat, lng } 또는 null — 위치를 못 받았으면 예전과 똑같이 동작한다 */
  function draw(box, stops, coords, me) {
    var located = [];
    stops.forEach(function (s, i) {
      var g = coords[Geocode.norm(s.addr)];
      if (g) located.push({ i: i, s: s, g: g });
    });
    if (!located.length) {
      box.innerHTML = '<div class="cm-msg">주소로 위치를 찾은 작업이 없습니다.' +
        '<br><span class="cm-msg-sub">아래 카드에서 길안내는 그대로 쓸 수 있어요.</span></div>';
      return;
    }

    box.innerHTML = '';
    var map = new kakao.maps.Map(box, {
      center: new kakao.maps.LatLng(located[0].g.lat, located[0].g.lng),
      level: 6
    });
    var bounds = new kakao.maps.LatLngBounds();

    /* 내 위치 — 번호 표식과 **다르게** 생겼다. 숫자를 붙이면 '0번 작업'처럼 보인다.
       ⚠️ bounds 에 넣는다. 안 넣으면 내 위치가 화면 밖에 있을 때 선만 밖으로 뻗어
          "선이 왜 잘려 있지"가 된다. */
    if (me) {
      var mePos = new kakao.maps.LatLng(me.lat, me.lng);
      bounds.extend(mePos);
      var meEl = document.createElement('div');
      meEl.className = 'cm-me';
      meEl.title = '내 위치';
      new kakao.maps.CustomOverlay({ map: map, position: mePos, content: meEl, yAnchor: 0.5, zIndex: 2 });
    }

    /* 동선 — 내 위치가 있으면 거기서 출발해 시간순으로 잇는다 */
    var linePts = located.map(function (L) { return { lat: L.g.lat, lng: L.g.lng }; });
    if (me) linePts.unshift({ lat: me.lat, lng: me.lng });

    /* ★ 2026-09-18 카드 거리.
       ☠️ 자리 계산을 조심한다. 주소를 못 찾은 작업은 located 에서 빠지므로
          **카드 번호(stop 자리)와 선 위의 자리가 다르다.** 여기서 한 번만 맞춰 두고
          나머지는 이 표를 쓴다. 각각 계산하면 언젠가 한 쪽이 어긋난다.
            linePts 자리 = located 순번 + (내 위치가 있으면 1)
            그 지점으로 '들어오는 구간' = linePts 자리 - 1 (0 이면 출발점이라 구간 없음) */
    var legOf = {};   // stop 자리 -> 구간 번호
    located.forEach(function (L, k) {
      var at = k + (me ? 1 : 0);
      if (at === 0) return;                       // 내 위치가 없을 때의 첫 작업 = 출발점
      legOf[L.i] = at - 1;
      setDist(L.i, MyLoc.distance(linePts[at - 1], linePts[at]), 0);   // 직선은 지금 바로
    });

    drawLines(map, linePts, _ov && _ov.querySelector('#calMapHeadSub'), function (r) {
      /* 주행 거리는 경로가 와야 안다. 구간별(legs)이 오면 카드마다 붙인다.
         ⚠️ legs 가 없거나 개수가 안 맞으면 **아무것도 안 붙인다.** 총거리를 나눠
            추정하면 그럴듯한 거짓 숫자가 된다 — 없는 편이 낫다. */
      if (!r || !Array.isArray(r.legs) || r.legs.length !== linePts.length - 1) return;
      located.forEach(function (L, k) {
        var j = legOf[L.i];
        if (j == null) return;
        var at = k + (me ? 1 : 0);
        setDist(L.i, MyLoc.distance(linePts[at - 1], linePts[at]), (r.legs[j] || {}).distance || 0);
      });
    });

    _pins = [];
    located.forEach(function (L, n) {
      var pos = new kakao.maps.LatLng(L.g.lat, L.g.lng);
      bounds.extend(pos);
      /* 기본 마커 대신 번호 표식을 쓴다 — 마커 + 라벨 두 겹보다 작고, 순서가 바로 읽힌다 */
      var el = document.createElement('div');
      el.className = 'cm-pin';
      el.textContent = String(L.i + 1);
      el._i = L.i;
      el.addEventListener('click', function () { selectCard(L.i, { scroll: true }); });
      _pins.push(el);
      new kakao.maps.CustomOverlay({ map: map, position: pos, content: el, yAnchor: 1, zIndex: 3 });
    });

    if (located.length > 1 || me) map.setBounds(bounds, 40, 40, 40, 40);
    else map.setLevel(4);

    /* 카드를 넘기면 지도가 따라간다. 손이 멈춘 뒤에만 움직인다 —
       넘기는 도중에 매번 지도를 옮기면 화면이 출렁여 멀미가 난다. */
    var cards = _ov && _ov.querySelector('#calMapCards');
    if (cards) {
      var t = null;
      cards.addEventListener('scroll', function () {
        clearTimeout(t);
        t = setTimeout(function () {
          var mid = cards.scrollLeft + cards.clientWidth / 2;
          var best = -1, bestD = Infinity;
          cards.querySelectorAll('.cm-card').forEach(function (c) {
            var d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
            if (d < bestD) { bestD = d; best = parseInt(c.getAttribute('data-i'), 10); }
          });
          if (best < 0) return;
          selectCard(best);
          var hit = null;
          for (var k = 0; k < located.length; k++) if (located[k].i === best) hit = located[k];
          if (hit) map.panTo(new kakao.maps.LatLng(hit.g.lat, hit.g.lng));
        }, 180);
      }, { passive: true });
    }
    selectCard(located[0].i);
  }

  /* ── 열기 ──
     stops : [{ title, sub, time, addr }]  — 목록에 보이는 순서(시간순) 그대로 받는다
     opts  : { onEdit: function(i) }        — '주소 넣기' 를 눌렀을 때 그 작업을 여는 길 */
  function open(label, stops, opts) {
    opts = opts || {};
    close();
    stops = stops || [];

    var withAddr = stops.filter(function (s) { return String(s.addr || '').trim(); }).length;

    var ov = document.createElement('div');
    /* ⚠️ ov-lock — 뒤로가기와 뒷화면 스크롤 잠금이 이 표식을 본다. 빼지 말 것 */
    ov.className = 'cm-ov ov-lock';
    ov.id = 'calMapOverlay';
    ov.innerHTML =
      '<div class="cm-head">' +
        '<div class="cm-head-tx"><b>' + esc(label) + '</b>' +
          '<span class="cm-head-sub" id="calMapHeadSub">' + withAddr + '곳</span></div>' +
        /* ⚠️ 위치를 아예 못 쓰는 기기(웹 미리보기 등)에서는 버튼 자체를 안 만든다 —
           눌러도 아무 일 없는 버튼을 두는 것보다 없는 편이 덜 헷갈린다(지도 찍기와 같은 규칙) */
        (window.MyLoc && MyLoc.available()
          ? '<button type="button" class="cm-loc" id="calMapLoc" aria-label="내 위치" title="내 위치">◎</button>' : '') +
        '<button type="button" class="cm-close" id="calMapClose" aria-label="닫기">✕</button>' +
      '</div>' +
      '<div class="cm-map" id="calMapBox"><div class="cm-msg">지도를 불러오는 중…</div></div>' +
      '<div class="cm-cards" id="calMapCards">' + cardsHtml(stops) + '</div>';
    document.body.appendChild(ov);
    _ov = ov;

    document.getElementById('calMapClose').addEventListener('click', close);

    ov.querySelectorAll('.cm-nav').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        navTo(stops[parseInt(b.getAttribute('data-i'), 10)].addr);
      });
    });
    ov.querySelectorAll('.cm-edit').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var i = parseInt(b.getAttribute('data-i'), 10);
        close();
        if (opts.onEdit) opts.onEdit(i);
      });
    });
    ov.querySelectorAll('.cm-card').forEach(function (c) {
      c.addEventListener('click', function () {
        selectCard(parseInt(c.getAttribute('data-i'), 10), { scroll: true });
      });
    });

    var box = document.getElementById('calMapBox');
    if (!window.Geocode || !Geocode.available()) {
      box.innerHTML = '<div class="cm-msg">지도 키가 아직 설정되지 않았습니다.' +
        '<br><span class="cm-msg-sub">www/js/config_map.js 의 KAKAO_JS_KEY 를 채우면 켜집니다. ' +
        '길안내는 지금도 됩니다.</span></div>';
      return;
    }
    if (!withAddr) {
      box.innerHTML = '<div class="cm-msg">주소가 적힌 작업이 없습니다.' +
        '<br><span class="cm-msg-sub">카드에서 작업을 열어 주소를 넣으면 지도에 찍혀요.</span></div>';
      return;
    }

    /* ── 지도 + 내 위치를 같이 기다린다 ──
       ☠️ 위치 때문에 지도가 늦어지면 안 된다. 그래서 MyLoc.get 은 어떤 경우에도
          null 을 돌려주고(거부·실패·시간초과) 스스로 8초 안에 끝난다.
          여기서 Promise.all 로 묶는 건 '둘 다 오면 한 번에 그린다'는 뜻이지
          '위치를 기다린다'는 뜻이 아니다.
       ⚠️ 위치를 아직 한 번도 안 물어본 사람에게는 여기서 시스템 권한 창이 뜬다.
          거부하면 MyLoc 이 기억해서 다음부터는 안 묻는다(머리줄 ◎ 로 다시 물을 수 있다). */
    var _draw = function (me) {
      return Geocode.loadSdk().then(function () {
        return Geocode.lookupMany(stops.map(function (s) { return s.addr; }));
      }).then(function (coords) {
        if (_ov !== ov) return;      // 그새 닫혔으면 아무것도 하지 않는다
        draw(box, stops, coords, me);
      }).catch(function (e) {
        if (_ov !== ov) return;
        box.innerHTML = '<div class="cm-msg">' + esc((e && e.message) || '지도를 열지 못했습니다') +
          '<br><span class="cm-msg-sub">길안내는 아래에서 그대로 쓸 수 있어요.</span></div>';
      });
    };

    (window.MyLoc ? MyLoc.get() : Promise.resolve(null)).then(_draw);

    /* 머리줄 ◎ — 위치를 거부했거나 못 잡았을 때 다시 물어보는 길.
       force:true 라 '거부 기억'을 넘어간다. 사람 마음은 바뀐다. */
    var locBtn = document.getElementById('calMapLoc');
    if (locBtn) locBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      locBtn.disabled = true;
      MyLoc.get({ force: true }).then(function (me) {
        locBtn.disabled = false;
        if (_ov !== ov) return;
        if (!me) { toastErr('위치를 확인할 수 없습니다 — 위치 권한과 GPS 를 확인해 주세요'); return; }
        box.innerHTML = '<div class="cm-msg">지도를 불러오는 중…</div>';
        _draw(me);
      });
    });
  }

  window.CalMap = { open: open, close: close };
})();
