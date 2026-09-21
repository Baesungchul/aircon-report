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
  /* ★ 2026-09-19 — 장소·복귀를 바꾸면 시트를 다시 그린다. 그때 필요한 것들을 들고 있는다.
     ⚠️ _base 는 달력이 준 **원본**이다. 복귀 지점을 여기 밀어 넣으면 안 된다 —
        달력이 onEdit 에서 이 배열의 자리(i)로 작업을 찾는다. */
  var _base = [], _shown = [], _label = '', _opts = {};

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
    _ov = null; _pins = []; _sel = -1; _polys = []; legOf = {};
    _base = []; _shown = []; _label = ''; _opts = {};
  }

  /* ── 카드 줄 ──
     ☠️ 길안내 버튼을 마커 말풍선 안에 넣지 않는다. 말풍선은 손가락으로 누르기엔 작고,
        지도를 훑다 잘못 누르면 엉뚱한 내비가 켜진다(되돌릴 화면이 없다).
        찍고쓰다도 '찍고 → 아래 막대에서 확인 → 실행' 두 단계를 쓴다. 규칙을 맞춘다. */
  /* legOf 를 카드에서도 쓴다 — 카드 색 = 그 카드로 들어오는 구간 색.
     ⚠️ 지도를 그리기 전에는 비어 있다(주소를 못 찾은 작업이 몇인지 알아야 정해진다).
        그래서 카드를 먼저 그려 두고, 지도가 자리를 잡은 뒤 색만 입힌다. */
  var legOf = {};

  function paintCards() {
    if (!_ov) return;
    _ov.querySelectorAll('.cm-card').forEach(function (c) {
      var i = parseInt(c.getAttribute('data-i'), 10);
      var j = legOf[i];
      if (j == null) { c.classList.remove('cm-card-seg'); return; }
      c.style.setProperty('--seg', segOf(j));
      c.classList.add('cm-card-seg');
    });
  }

  function cardsHtml(stops) {
    return stops.map(function (s, i) {
      var noAddr = !String(s.addr || '').trim();
      /* ★ 2026-09-19 복귀 카드 — 갈 곳이 아니라 '돌아갈 곳'이다.
         번호를 붙이지 않는다. 번호는 그날 작업 순서를 뜻하는데 복귀는 작업이 아니다. */
      var mark = s._place ? '<span class="cm-num cm-num-place">' + esc(MyPlaces.label(s._place)) + '</span>'
               : noAddr   ? '<span class="cm-no">–</span>'
               :            '<span class="cm-num">' + (i + 1) + '</span>';
      return '<div class="cm-card' + (noAddr ? ' cm-card-noaddr' : '') +
             (s._place ? ' cm-card-place' : '') + '" data-i="' + i + '">' +
        '<div class="cm-card-top">' + mark +
          '<span class="cm-time">' + esc(s.time || (s._place ? '복귀' : '시간 미정')) + '</span>' +
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

  /* ══ 구간 색 ══════════════════════════════════════════════
     구간마다 다른 색으로 그린다. 아래 카드도 같은 색을 달아, 선 하나를 보고
     "이게 몇 번째 카드 구간인지" 를 색으로 바로 잇는다.

     ⚠️ 눈대중으로 고른 색이 아니다. dataviz 의 validate_palette 로 돌려
        (밝기 띠 · 채도 · 색각이상 구분 · 정상시 구분 · 대비) 전부 PASS 한 값이다.
        색맹에서 가장 가까운 짝이 ΔE 9.1, 정상시 19.6.
     ☠️ 지도 타일은 **밝기 모드와 상관없이 늘 밝다.** 그래서 이 값은 다크 모드에서도
        그대로 쓴다. 테마색(--ac)을 쓰면 안 된다 — 다크에서 밝은 민트가 되어 흰 지도 위에서 사라진다.
     ⚠️ 순서를 섞지 말 것. 이웃끼리 구분되도록 짠 차례다.
     ⚠️ 여덟 구간을 넘으면 색을 돌려쓰지 않고 회색으로 묶는다. 돌려쓰면
        1번과 9번이 같은 색이 되어 '같은 구간'처럼 보인다 — 없느니만 못하다. */
  var SEG = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100',
             '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
  var SEG_OVER = '#8b95a1';
  function segOf(i) { return (i >= 0 && i < SEG.length) ? SEG[i] : SEG_OVER; }

  /* ══ 겹치는 구간을 나란히 두 줄로 ══════════════════════════ 2026-09-20
     ☠️ 왔던 길을 그대로 되짚는 날이 흔하다(들어갔다 나오는 막다른 길, 같은 도로 왕복).
        그때 두 구간이 **정확히 같은 자리**에 겹쳐 그려져 한 줄로 보인다.
        나중에 그린 쪽 색만 남으니 "갔다가 돌아왔다" 가 지도에서 사라진다.
     → 같은 길을 쓰는 구간들을 찾아 서로 반대쪽으로 조금씩 밀어 둔다.
        겹치는 곳만 밀고, 혼자 쓰는 곳은 그대로 둔다.

     ⚠️ 방향을 맞추는 게 핵심이다. A→B 와 B→A 는 같은 길이지만 진행 방향이 반대라
        각자의 '왼쪽'도 반대다. 그대로 밀면 **둘 다 같은 쪽으로** 가서 여전히 겹친다.
        → 두 끝점을 정렬한 기준 방향을 정해 두고, 거꾸로 가는 쪽은 부호를 뒤집는다.
     ⚠️ 간격은 화면 기준(px)이어야 한다. 미터로 고정하면 넓게 보면 두 줄이 붙고
        확대하면 딴 길처럼 벌어진다. → 지도 배율에서 m/px 를 구해 그때그때 환산하고,
        배율이 바뀌면 다시 계산한다.
     ⚠️ 좌표를 그대로 비교하면 왕복 경로의 점이 몇 미터씩 어긋나 '다른 길'이 된다.
        SNAP 으로 끊어서 본다. 촘촘하면 못 잡고 성기면 옆 도로까지 같은 길로 본다 —
        1e4(약 11m)가 이 둘 사이에서 실제로 잘 맞았다. */
  var GAP_PX = 6;      // 두 줄 사이 간격(화면 px)
  var SNAP = 1e4;      // 좌표를 이 단위로 끊어 같은 길인지 본다 (약 11m)
  var M_DEG = 111320;  // 위도 1도 ≈ 111.32km

  function qk(p) { return Math.round(p.lat * SNAP) + ',' + Math.round(p.lng * SNAP); }
  /* 두 끝점을 정렬해 만든 키. A→B 와 B→A 가 같은 키를 갖는다.
     rev = 이 진행 방향이 기준(정렬된) 방향과 반대인가 */
  function edgeKey(a, b) {
    var x = qk(a), y = qk(b);
    return (x < y) ? { k: x + '|' + y, rev: false } : { k: y + '|' + x, rev: true };
  }

  /* 여러 선의 점 목록을 받아, 각 선의 '변(edge)마다 얼마나 밀지' 배수를 돌려준다.
     겹치지 않는 변은 0. 두 개가 겹치면 -0.5 / +0.5, 셋이면 -1 / 0 / +1 …
     (가운데를 기준으로 좌우로 퍼진다 — 한쪽으로만 밀면 원래 길에서 통째로 벗어난다) */
  function offsetMuls(paths) {
    var use = {};
    paths.forEach(function (pts, p) {
      for (var i = 0; i + 1 < (pts || []).length; i++) {
        var e = edgeKey(pts[i], pts[i + 1]);
        (use[e.k] = use[e.k] || []).push({ p: p, i: i, rev: e.rev });
      }
    });
    var muls = paths.map(function (pts) {
      var n = Math.max(0, (pts || []).length - 1), a = [];
      for (var i = 0; i < n; i++) a.push(0);
      return a;
    });
    Object.keys(use).forEach(function (k) {
      var list = use[k];
      /* 혼자 쓰는 길은 안 민다.
         ⚠️ 이 줄은 **속도·읽기용이지 안전장치가 아니다** — 아래 셈이 하나뿐일 때
            (0 - 0) * ±1 = 0 이라 지워도 결과가 같다(변형 시험에서 확인했다).
            지웠다고 안심하지 말고, 미는 값이 0 인지는 검사가 따로 본다. */
      if (list.length < 2) return;
      var mid = (list.length - 1) / 2;
      list.forEach(function (it, r) {
        muls[it.p][it.i] = (r - mid) * (it.rev ? -1 : 1);
      });
    });
    return muls;
  }

  /* a→b 의 왼쪽 단위 법선 (미터 공간) */
  function perp(a, b) {
    var latR = (a.lat + b.lat) / 2 * Math.PI / 180;
    var dx = (b.lng - a.lng) * Math.cos(latR) * M_DEG;
    var dy = (b.lat - a.lat) * M_DEG;
    var L = Math.sqrt(dx * dx + dy * dy);
    if (!L) return null;
    return { x: dy / L, y: -dx / L };
  }

  /* 점마다 앞뒤 변의 배수·법선을 평균내어 민다.
     ⚠️ 변 단위로 잘라 밀면 겹치는 구간이 시작·끝나는 자리에서 선이 뚝 끊긴다.
        점 단위로 평균을 내면 그 자리에서 비스듬히 갈라져 이어진다. */
  function offsetPath(pts, muls, d) {
    if (!d || !pts || pts.length < 2) return pts;
    var any = false;
    for (var i = 0; i < muls.length; i++) if (muls[i]) { any = true; break; }
    if (!any) return pts;
    return pts.map(function (p, j) {
      var ux = 0, uy = 0, m = 0, c = 0, e;
      if (j > 0) { e = perp(pts[j - 1], pts[j]); if (e) { ux += e.x; uy += e.y; m += muls[j - 1]; c++; } }
      if (j + 1 < pts.length) { e = perp(pts[j], pts[j + 1]); if (e) { ux += e.x; uy += e.y; m += muls[j]; c++; } }
      if (!c) return p;
      m /= c;
      if (!m) return p;
      var L = Math.sqrt(ux * ux + uy * uy);
      if (!L) return p;
      var cos = Math.cos(p.lat * Math.PI / 180) || 1e-6;
      return {
        lat: p.lat + (uy / L * m * d) / M_DEG,
        lng: p.lng + (ux / L * m * d) / (M_DEG * cos)
      };
    });
  }

  /* 지금 배율에서 1픽셀이 몇 미터인가. 못 구하면 0 → 안 민다(원래대로 겹쳐 그린다) */
  function mppOf(map, box) {
    try {
      var b = map.getBounds(), sw = b.getSouthWest(), ne = b.getNorthEast();
      var w = (box && box.clientWidth) || 0;
      if (!w) return 0;
      var m = MyLoc.distance({ lat: sw.getLat(), lng: sw.getLng() },
                             { lat: sw.getLat(), lng: ne.getLng() });
      return m > 0 ? m / w : 0;
    } catch (e) { return 0; }
  }

  /* 그려 둔 선들 — 배율이 바뀌면 같은 px 간격을 지키려고 다시 민다 */
  var _polys = [];
  function reoffset(map, box) {
    if (!_polys.length) return;
    var d = mppOf(map, box) * GAP_PX;
    _polys.forEach(function (it) {
      try {
        it.poly.setPath(offsetPath(it.pts, it.muls, d).map(function (p) {
          return new kakao.maps.LatLng(p.lat, p.lng);
        }));
      } catch (e) {}
    });
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
  function poly(map, pts, muls, d, opt) {
    var o = { map: map, path: offsetPath(pts, muls, d).map(function (p) {
      return new kakao.maps.LatLng(p.lat, p.lng);
    }) };
    for (var k in opt) if (Object.prototype.hasOwnProperty.call(opt, k)) o[k] = opt[k];
    var pl = new kakao.maps.Polyline(o);
    _polys.push({ poly: pl, pts: pts, muls: muls });
    return pl;
  }

  function drawLines(map, box, pts, head, onRoute) {
    if (!pts || pts.length < 2) return;
    _polys = [];

    /* 점선 — 구간마다 한 줄씩. 한 줄로 쭉 긋지 않는 이유가 색과 겹침 둘 다다 */
    var segs = [];
    for (var i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]]);
    var muls = offsetMuls(segs);
    var d = mppOf(map, box) * GAP_PX;

    var dashed = segs.map(function (sp, i) {
      return poly(map, sp, muls[i], d, {
        strokeWeight: 3, strokeColor: segOf(i), strokeOpacity: 0.65, strokeStyle: 'shortdash',
        zIndex: 1
      });
    });

    /* 배율이 바뀌면 간격을 다시 맞춘다 — 안 하면 확대할수록 두 줄이 딴 길처럼 벌어진다 */
    try {
      kakao.maps.event.addListener(map, 'zoom_changed', function () { reoffset(map, box); });
    } catch (e) {}

    if (!window.Routing || !Routing.available()) return;
    Routing.route(pts).then(function (r) {
      if (!r || !_ov) return;                      // 실패하거나 그새 닫혔으면 점선 그대로
      /* 실선이 주인공이 되도록 점선을 한 단계 낮춘다(지우지는 않는다) */
      dashed.forEach(function (pl) {
        try { if (pl.setOptions) pl.setOptions({ strokeWeight: 2, strokeOpacity: 0.28 }); } catch (e) {}
      });

      /* 구간별 경로가 오면 구간마다, 안 오면 예전처럼 한 줄로.
         ⚠️ 개수가 안 맞으면 구간별로 그리지 않는다 — 엉뚱한 구간에 엉뚱한 색이 붙는다. */
      var list = (Array.isArray(r.paths) && r.paths.length === segs.length)
        ? r.paths.map(function (pp) {
            return (pp || []).map(function (c) { return { lat: c[0], lng: c[1] }; });
          })
        : null;
      if (!list) list = [r.path.map(function (c) { return { lat: c[0], lng: c[1] }; })];

      var rMuls = offsetMuls(list);
      var rd = mppOf(map, box) * GAP_PX;
      list.forEach(function (pp, i) {
        if (pp.length < 2) return;
        var col = (list.length === segs.length) ? segOf(i) : accent();
        /* 흰 테두리를 깔고 그 위에 색을 얹는다 — 지도 글씨·도로 위에서 선이 묻히지 않게.
           ⚠️ 테두리도 같이 밀어야 한다. 안 밀면 흰 줄만 제자리에 남아 두 줄 사이가 지저분해진다. */
        poly(map, pp, rMuls[i], rd, {
          strokeWeight: 8, strokeColor: '#ffffff', strokeOpacity: 0.9, strokeStyle: 'solid', zIndex: 2
        });
        poly(map, pp, rMuls[i], rd, {
          strokeWeight: 5, strokeColor: col, strokeOpacity: 0.95, strokeStyle: 'solid', zIndex: 3
        });
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
  function setDist(stopIdx, straightM, driveM, driveSec) {
    if (!_ov) return;
    var el = _ov.querySelector('.cm-card-dist[data-i="' + stopIdx + '"]');
    if (!el) return;
    var parts = [];
    if (straightM) parts.push('직선 ' + MyLoc.fmtKm(straightM));
    if (driveM) {
      /* ★ 2026-09-19 주행 시간도 같이. 거리보다 시간이 일정 짜는 데 더 쓸모 있다 —
         10km 가 15분일 수도 40분일 수도 있다. 거리 바로 뒤에 붙여 한 덩어리로 읽히게 한다. */
      parts.push('주행 ' + MyLoc.fmtKm(driveM) +
                 (driveSec ? ' ' + Routing.fmtMin(driveSec) : ''));
    }
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
        '<br><span class="cm-msg-sub">아래 카드에서 길안내는 그대로 쓸 수 있습니다.</span></div>';
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
    legOf = {};   // stop 자리 -> 구간 번호 (모듈 변수 — 카드 색도 이걸 쓴다)
    located.forEach(function (L, k) {
      var at = k + (me ? 1 : 0);
      if (at === 0) return;                       // 내 위치가 없을 때의 첫 작업 = 출발점
      legOf[L.i] = at - 1;
      setDist(L.i, MyLoc.distance(linePts[at - 1], linePts[at]), 0);   // 직선은 지금 바로
    });

    drawLines(map, box, linePts, _ov && _ov.querySelector('#calMapHeadSub'), function (r) {
      /* 주행 거리는 경로가 와야 안다. 구간별(legs)이 오면 카드마다 붙인다.
         ⚠️ legs 가 없거나 개수가 안 맞으면 **아무것도 안 붙인다.** 총거리를 나눠
            추정하면 그럴듯한 거짓 숫자가 된다 — 없는 편이 낫다. */
      if (!r || !Array.isArray(r.legs) || r.legs.length !== linePts.length - 1) return;
      located.forEach(function (L, k) {
        var j = legOf[L.i];
        if (j == null) return;
        var at = k + (me ? 1 : 0);
        var leg = r.legs[j] || {};
        setDist(L.i, MyLoc.distance(linePts[at - 1], linePts[at]), leg.distance || 0, leg.duration || 0);
      });
    });

    paintCards();
    _pins = [];
    located.forEach(function (L, n) {
      var pos = new kakao.maps.LatLng(L.g.lat, L.g.lng);
      bounds.extend(pos);
      /* 기본 마커 대신 번호 표식을 쓴다 — 마커 + 라벨 두 겹보다 작고, 순서가 바로 읽힌다 */
      var el = document.createElement('div');
      /* 복귀 지점은 번호가 아니라 이름('집'·'회사')으로 찍는다 — 작업 순서와 섞이면 안 된다 */
      el.className = 'cm-pin' + (L.s && L.s._place ? ' cm-pin-place' : '');
      el.textContent = (L.s && L.s._place) ? MyPlaces.label(L.s._place) : String(L.i + 1);
      /* ★ 2026-09-20 핀도 '여기로 들어오는 구간' 색으로 칠한다 — 선·카드와 같은 색이라
         선 하나를 보고 어느 지점으로 가는 길인지 바로 읽힌다.
         ⚠️ 출발점(들어오는 구간이 없는 곳)은 칠하지 않는다. 남의 색을 빌려 쓰면 거짓말이 된다. */
      var pLeg = legOf[L.i];
      if (pLeg != null) el.style.setProperty('--seg', segOf(pLeg));
      el._i = L.i;
      el.addEventListener('click', function () { selectCard(L.i, { scroll: true }); });
      _pins.push(el);
      new kakao.maps.CustomOverlay({ map: map, position: pos, content: el, yAnchor: 1, zIndex: 3 });
    });

    if (located.length > 1 || me) map.setBounds(bounds, 40, 40, 40, 40);
    else map.setLevel(4);
    /* ☠️ setBounds 로 배율이 바뀐 **뒤**에 간격을 다시 잰다.
       처음 그릴 때의 m/px 는 아직 맞춰지기 전 값이라, 그대로 두면 두 줄 간격이
       화면에서 엉뚱하게 좁거나 넓다. 'zoom_changed' 는 여기서 안 불릴 수도 있어 직접 부른다. */
    reoffset(map, box);

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

  /* ── 내 장소 칩 (집 · 회사 · 복귀) ── 2026-09-19
     ☠️ 누르면 **바로 내비**가 열린다. 그게 이 칩의 존재 이유다 —
        일 끝내고 차에 앉아 한 손으로 누르는 자리이지, 주소를 확인하는 자리가 아니다.
     ⚠️ 아직 등록 안 했으면 같은 칩이 '집 등록'이 된다. 칩을 숨기지 않는다 —
        숨기면 그런 기능이 있는 줄을 영영 모른다.
     ⚠️ 고치는 길은 **길게 누르기**다. 짧게 누르면 내비가 뜨는 자리라,
        고치기를 짧은 누름에 두면 출발하려다 편집창이 뜬다. */
  function chipsHtml() {
    var out = MyPlaces.KINDS.map(function (K) {
      var p = MyPlaces.get(K.k);
      return '<button type="button" class="cm-chip' + (p ? '' : ' cm-chip-empty') +
             '" data-k="' + K.k + '">' + esc(p ? K.label : K.label + ' 등록') + '</button>';
    });
    /* ★ 2026-09-19 — 복귀를 **집·회사 두 버튼으로 나눴다**(사용자 요청).
       ☠️ 앞 판은 버튼 하나를 눌러 끔 → 집 → 회사 로 돌렸다. 지금 무엇이 켜져 있는지
          글자를 읽어야 알 수 있었고, 회사로 바꾸려면 집을 한 번 거쳐야 했다.
          두 개로 나누면 **보는 즉시 알고, 한 번에 고른다.**
       ⚠️ 둘 중 하나만 켜진다(돌아갈 곳은 하나다). 켜진 것을 다시 누르면 꺼진다.
       ⚠️ 등록된 곳만 만든다 — 없는 곳으로 돌아갈 수는 없다. */
    var r = MyPlaces.returnTo();
    MyPlaces.KINDS.forEach(function (K) {
      if (!MyPlaces.get(K.k)) return;
      out.push('<button type="button" class="cm-chip cm-chip-ret' + (r === K.k ? ' on' : '') +
               '" data-ret="' + K.k + '">복귀 ' + esc(K.label) + '</button>');
    });
    return out.join('');
  }

  /* 길게 누르기 — 짧은 누름(내비)과 겹치지 않게 시간으로 가른다.
     ⚠️ 손가락이 움직이면(스크롤) 취소한다. 안 그러면 칩 줄을 넘기다 편집창이 뜬다. */
  function bindChip(el, onTap, onHold) {
    var t = null, moved = false, held = false;
    var cancel = function () { clearTimeout(t); t = null; };
    el.addEventListener('touchstart', function () {
      moved = false; held = false;
      t = setTimeout(function () { held = true; onHold(); }, 500);
    }, { passive: true });
    el.addEventListener('touchmove', function () { moved = true; cancel(); }, { passive: true });
    el.addEventListener('touchend', function (e) {
      cancel();
      if (held) { e.preventDefault(); return; }   // 이미 편집창이 떴다
      if (!moved) { e.preventDefault(); onTap(); }
    });
    /* 마우스(PC 미리보기)에서는 그냥 누름 = 실행, 오래 누름은 안 쓴다 */
    el.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (held) { held = false; return; }
      if (!('ontouchstart' in window)) onTap();
    });
  }

  /* 장소 등록·수정 — 지도에서 찍는 길이 있으면 그걸 쓴다(주소칸 🗺 과 같은 화면) */
  function editPlace(kind) {
    var cur = MyPlaces.get(kind);
    var label = MyPlaces.label(kind);
    if (window.MapPick && MapPick.available()) {
      MapPick.open((cur && cur.addr) || '', function (addr) {
        MyPlaces.set(kind, addr);
        redraw();
      }, { title: label, sub: '내 장소', time: '' });
      return;
    }
    var v = null;
    try { v = window.prompt(label + ' 주소', (cur && cur.addr) || ''); } catch (e) {}
    if (v === null) return;                 // 취소
    MyPlaces.set(kind, v);
    redraw();
  }

  /* ── 열기 ──
     stops : [{ title, sub, time, addr }]  — 목록에 보이는 순서(시간순) 그대로 받는다
     opts  : { onEdit: function(i) }        — '주소 넣기' 를 눌렀을 때 그 작업을 여는 길 */
  function open(label, stops, opts) {
    close();
    _label = label;
    _base = stops || [];
    _opts = opts || {};
    redraw();
  }

  /* 장소·복귀가 바뀌면 시트를 다시 그린다.
     ⚠️ 통째로 다시 그린다. 선·핀·카드·거리가 서로 맞물려 있어 일부만 고치면 어긋난다.
        위치는 MyLoc 이 2분 기억하므로 다시 묻지 않는다(권한 창이 또 뜨지 않는다). */
  function redraw() {
    var label = _label, opts = _opts;
    /* 복귀가 켜져 있으면 맨 뒤에 한 곳을 더 붙인다.
       ⚠️ 원본(_base)은 건드리지 않는다 — 달력이 onEdit 에서 그 배열의 자리를 쓴다.
          여기서 밀어 넣으면 '주소 넣기'가 엉뚱한 작업을 연다. */
    var stops = _base.slice();
    var retK = MyPlaces.returnTo();
    var retP = retK && MyPlaces.get(retK);
    if (retP && _base.some(function (s) { return String(s.addr || '').trim(); })) {
      stops.push({ _place: retK, title: MyPlaces.label(retK), sub: '', time: '', addr: retP.addr });
    }
    _shown = stops;

    var withAddr = stops.filter(function (s) { return String(s.addr || '').trim(); }).length;

    if (_ov && _ov.parentNode) _ov.parentNode.removeChild(_ov);
    _pins = []; _sel = -1;

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
      '<div class="cm-places" id="calMapPlaces">' + chipsHtml() + '</div>' +
      /* ⚠️ 길게 누르기는 눈에 보이지 않는 동작이다. 적어 두지 않으면 아무도 모른다.
         (지도에서 주소 찍기도 같은 이유로 화면에 한 줄 적어 뒀다) */
      '<div class="cm-hint">집·회사 버튼을 <b>길게 누르면</b> 주소를 등록·수정할 수 있습니다</div>' +
      '<div class="cm-map" id="calMapBox"><div class="cm-msg">지도를 불러오는 중…</div></div>' +
      '<div class="cm-cards" id="calMapCards">' + cardsHtml(stops) + '</div>';
    document.body.appendChild(ov);
    _ov = ov;

    document.getElementById('calMapClose').addEventListener('click', close);

    /* 내 장소 칩 — 짧게 누르면 내비, 길게 누르면 고치기 */
    ov.querySelectorAll('.cm-chip[data-k]').forEach(function (b) {
      var k = b.getAttribute('data-k');
      bindChip(b,
        function () { var p = MyPlaces.get(k); if (p) navTo(p.addr); else editPlace(k); },
        function () { editPlace(k); });
    });
    ov.querySelectorAll('.cm-chip[data-ret]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        var k = b.getAttribute('data-ret');
        /* 켜진 것을 다시 누르면 끈다. 다른 것을 누르면 그쪽으로 옮긴다 */
        MyPlaces.setReturnTo(MyPlaces.returnTo() === k ? '' : k);
        redraw();
      });
    });

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
          '<br><span class="cm-msg-sub">길안내는 아래에서 그대로 쓸 수 있습니다.</span></div>';
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

  window.CalMap = { open: open, close: close, _redraw: redraw };
  /* 검사용 — 겹침 계산은 눈으로 못 본다(지도 위 몇 픽셀 차이다).
     tools/test-segsplit.js 가 이 함수들을 직접 돌려 좌우로 갈라지는지 잰다. */
  window.__calmapGeom = {
    SEG: SEG, segOf: segOf, GAP_PX: GAP_PX,
    edgeKey: edgeKey, offsetMuls: offsetMuls, offsetPath: offsetPath, perp: perp
  };
})();
