/* ═══════════════════════════════════════════════════════════
   map_pick.js — 지도에서 주소 찍기 (주소 입력칸 옆 🗺 버튼)
   ----------------------------------------------------------------
   왜 만드는가 (2026-09-17, 2단계)
     '그날 지도'의 진짜 약점은 지도 쪽이 아니라 **주소 쪽**이다.
     주소칸은 필수 입력이 아니고(필수는 작업일자·작업명/호수·작업자뿐),
     아파트 이름만 적히는 일도 흔하다. 그런 작업은 지도를 아무리 잘 만들어도 안 뜬다.
     그래서 주소를 넣는 자리에서 지도를 열 수 있게 한다 — 원인 쪽을 막는 것이다.

   쓰는 법 두 가지
     ① 이름·주소로 찾기 — '평택 ○○아파트' 처럼 적고 찾으면 후보가 지도에 찍힌다.
     ② 지도를 길게 누르기 — 그 자리의 주소가 잡힌다(등록되지 않은 곳, 신축, 골목 안).

   ☠️ 고른 즉시 채우지 않는다. 아래 막대에서 한 번 확인하고 [이 주소 쓰기] 를 눌러야 들어간다.
      지도를 훑다가 손가락이 스치는 일이 잦은데, 주소칸은 되돌릴 화면이 없다.

   ⚠️ 위치 권한(GPS)은 쓰지 않는다.
      안드로이드 위치 권한을 새로 요구하면 매니페스트·런타임 권한·플레이 콘솔의
      데이터 보안 항목까지 함께 건드려야 한다. 주소를 찍는 데는 필요도 없다 —
      시작 위치는 ①지금 주소칸 값 ②지난번에 보던 자리 ③평택 순으로 잡는다.

   ── 롱프레스 구현 요점 (찍고쓰다에서 실기기 왕복 끝에 확정된 것 — 다시 헤매지 말 것) ──
     · click 을 기다리지 않고 누르는 동안 타이머로 직접 판정한다. 모바일에서 500ms 넘게
       가만히 누르고 떼면 합성 click 이 아예 안 오는 경우가 흔하다.
     · 리스너는 캡처 단계(capture:true)로 단다. 지도 SDK 가 안쪽 엘리먼트에서
       stopPropagation 을 부르면 버블 단계 리스너는 이벤트를 아예 못 받는다.
     · 움직임 허용치를 넉넉히 둔다. 손가락은 가만히 있어도 접촉면이 흔들린다.
     · 좌표 변환은 map.getProjection().coordsFromContainerPoint() — Map 이 아니라
       Projection 에 있는 메서드다. map 에 바로 부르면 "not a function" 으로 조용히 실패한다.
     · 안드로이드 WebView 의 '길게 눌러 선택' 메뉴가 뜨면 손짓을 가로챈다 → contextmenu 막기.
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var LAST_KEY = 'ac_mappick_last_v1';
  var DEFAULT_CENTER = { lat: 36.9921, lng: 127.1129 };   // 평택시청 — 이 앱의 주 활동 지역
  var _ov = null;
  var _picked = null;
  var _pin = null;        // 고른 자리 표시 — 하나만 두고 자리만 옮긴다
  var _lpCancel = null;   // 지금 떠 있는 지도의 '누르기 취소' — 아래 visibilitychange 가 부른다

  /* ☠️ 손 뗀 신호가 유실되면(두 번째 손가락 · OS 제스처 · 전화 수신 · 앱 내림) 타이머와
       손끝 원이 그대로 남는다 — 2026-09-08 '드래그가 중간에 굳는다' 신고와 같은 뿌리다.
     ⚠️ 이 리스너는 여기서 **딱 한 번만** 단다. 지도를 열 때마다 달면 연 횟수만큼 쌓인다. */
  document.addEventListener('visibilitychange', function () { if (_lpCancel) _lpCancel(); });

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function toastErr(m) { if (typeof showToast === 'function') showToast(m, 'err'); }

  function lastCenter() {
    try { var v = JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); return (v && v.lat) ? v : null; }
    catch (e) { return null; }
  }
  function rememberCenter(g) {
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ lat: g.lat, lng: g.lng })); } catch (e) {}
  }

  /* ── 고른 자리 핀 ──
     ★ 2026-09-17 사용자 지적: "지도를 눌렀을 때 주소에 해당하는 자리에 표시가 없어 허전하다".
       지도만 그 자리로 옮겨 놓고 아무 표시를 안 했더니, 어디를 보고 있는 건지 알 수 없었다.
     · 모양은 그날 지도(cal_map.js)의 번호 핀과 **같은 클래스(.cm-pin)** 를 쓴다 —
       한 앱에서 지도 핀이 두 가지로 보이면 안 된다.
     · 다만 여기는 자리가 하나뿐이라 번호가 뜻이 없다. .cm-pin-dot 으로 점 하나만 찍는다.
     ⚠️ 핀은 하나만 두고 자리만 옮긴다(setPosition). 새로 만들어 쌓으면 길게 누를 때마다
        옛 핀이 지도에 남는다. */
  function setPin(map, latlng) {
    if (!_pin) {
      var el = document.createElement('div');
      el.className = 'cm-pin cm-pin-dot';
      el.innerHTML = '<span class="cm-pin-core"></span>';
      _pin = new kakao.maps.CustomOverlay({ map: map, position: latlng, content: el, yAnchor: 1, zIndex: 4 });
    } else {
      _pin.setPosition(latlng);
      _pin.setMap(map);
    }
  }

  function close() {
    if (_lpCancel) { _lpCancel(); _lpCancel = null; }
    _pin = null;
    if (_ov && _ov.parentNode) _ov.parentNode.removeChild(_ov);
    _ov = null; _picked = null;
  }

  /* 아래 막대 — 고른 자리를 보여주고 [이 주소 쓰기] 를 준다 */
  function showPick(d) {
    _picked = d;
    var sel = _ov && _ov.querySelector('#mpSel');
    if (!sel) return;
    if (!d) {
      sel.innerHTML = '<span class="mp-hint">위에서 찾거나, 지도에서 고르세요</span>';
      return;
    }
    sel.innerHTML =
      '<div class="mp-sel-tx"><b>' + esc(d.name || '이 자리') + '</b>' +
        '<span class="mp-sel-ad">' + esc(d.address || '') + '</span></div>' +
      '<button type="button" class="btn b-blue mp-use" id="mpUse">이 주소 쓰기</button>';
    sel.querySelector('#mpUse').addEventListener('click', function () {
      var cb = _ov && _ov._onPick;
      var addr = d.address || '';
      close();
      if (cb) cb(addr);
    });
  }

  /* ── 길게 누르기 ── */
  function attachLongPress(map, box, onLongPress) {
    var LP_MS = 550, MOVE_TOL = 32;
    var sx = 0, sy = 0, cx = 0, cy = 0, moved = false, timer = null, ripple = null;
    var CAP = { capture: true, passive: true };

    function toLatLng(x, y) {
      var r = box.getBoundingClientRect();
      return map.getProjection().coordsFromContainerPoint(new kakao.maps.Point(x - r.left, y - r.top));
    }
    function showRipple(x, y) {
      hideRipple();
      var r = box.getBoundingClientRect();
      var el = document.createElement('div');
      el.className = 'mp-ripple';
      el.style.left = (x - r.left) + 'px';
      el.style.top = (y - r.top) + 'px';
      el.style.setProperty('--lp-ms', LP_MS + 'ms');
      box.appendChild(el);
      void el.offsetWidth;                 // 강제 리플로우 — 없으면 트랜지션 없이 순간이동한다
      el.classList.add('grow');
      ripple = el;
    }
    function hideRipple() {
      if (!ripple) return;
      var el = ripple; ripple = null;
      el.classList.add('gone');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
    }
    function start(x, y) {
      sx = x; sy = y; cx = x; cy = y; moved = false;
      clearTimeout(timer);
      showRipple(x, y);
      timer = setTimeout(function () {
        hideRipple();
        if (moved) return;
        try { onLongPress(toLatLng(cx, cy)); }
        catch (err) { toastErr('이 자리를 읽지 못했어요'); }
      }, LP_MS);
    }
    function move(x, y) {
      cx = x; cy = y;
      if (moved) return;
      if (Math.abs(x - sx) > MOVE_TOL || Math.abs(y - sy) > MOVE_TOL) { moved = true; clearTimeout(timer); hideRipple(); }
    }
    function cancel() { clearTimeout(timer); hideRipple(); }
    _lpCancel = cancel;   // 화면이 가려질 때 바깥에서도 취소할 수 있게

    box.addEventListener('touchstart', function (e) {
      var t = e.touches && e.touches[0]; if (t) start(t.clientX, t.clientY);
    }, CAP);
    box.addEventListener('touchmove', function (e) {
      var t = e.touches && e.touches[0]; if (t) move(t.clientX, t.clientY);
    }, CAP);
    box.addEventListener('touchend', cancel, CAP);
    box.addEventListener('touchcancel', cancel, CAP);
    box.addEventListener('mousedown', function (e) { start(e.clientX, e.clientY); }, { capture: true });
    box.addEventListener('mousemove', function (e) { if (e.buttons) move(e.clientX, e.clientY); }, { capture: true });
    box.addEventListener('mouseup', cancel, { capture: true });
    box.addEventListener('mouseleave', cancel, { capture: true });
    box.addEventListener('contextmenu', function (e) { e.preventDefault(); }, { capture: true });
  }

  /* ── 열기 ──
     initialAddr : 주소칸에 이미 들어 있는 값 (시작 위치·검색어의 밑바탕)
     onPick      : 고른 주소 글자를 받는 함수 */
  function open(initialAddr, onPick) {
    if (!window.Geocode || !Geocode.available()) {
      toastErr('지도 키가 설정되지 않았습니다 (www/js/config_map.js)');
      return;
    }
    close();

    var ov = document.createElement('div');
    /* ⚠️ ov-lock — 뒤로가기·뒷화면 스크롤 잠금이 이 표식을 본다. 빼지 말 것 */
    ov.className = 'mp-ov ov-lock';
    ov.id = 'mapPickOverlay';
    ov._onPick = onPick;
    ov.innerHTML =
      '<div class="mp-head">' +
        '<input class="cust-inp mp-q" id="mpQ" type="text" placeholder="이름이나 주소로 찾기" ' +
          'value="' + esc(initialAddr || '') + '">' +
        '<button type="button" class="btn b-ghost mp-find" id="mpFind">찾기</button>' +
        '<button type="button" class="mp-close" id="mapPickClose" aria-label="닫기">✕</button>' +
      '</div>' +
      '<div class="mp-map" id="mpMap"><div class="mp-msg">지도를 불러오는 중…</div></div>' +
      /* ★ 2026-09-17 사용자 요청: "지점을 눌러서 주소로 등록이 가능한 것도 안내해야 한다".
         아래 막대는 고른 자리에 따라 내용이 바뀌므로, 쓰는 법은 자리가 고정된 줄에 적는다.
         ⚠️ 한 줄만 둔다 — 처음엔 '표시를 누르면 골라져요' 줄을 같이 뒀는데, 표시를 누르는
            건 눌러 보면 바로 아는 일이라 빼라고 하셨다(2026-09-17). 길게 누르기만 남긴다.
         ⚠️ 두 줄로 나눠 적을 일이 생기면 줄 끝에 + 를 꼭 붙일 것. 빠뜨리면 자바스크립트가
            앞 줄에서 문장을 끝내 버려 뒤 내용이 통째로 사라진다(문법 오류가 아니라
            node --check 도 npm test 도 통과한다. 2026-09-17 에 실제로 겪었다). */
      '<div class="mp-tip">빈 곳을 <b>길게</b> 누르면 그 자리 주소로 등록됩니다</div>' +
      '<div class="mp-sel" id="mpSel">' +
        '<span class="mp-hint">위에서 찾거나, 지도에서 고르세요</span>' +
      '</div>';
    document.body.appendChild(ov);
    _ov = ov;
    document.getElementById('mapPickClose').addEventListener('click', close);

    var box = document.getElementById('mpMap');

    Geocode.loadSdk().then(function () {
      /* 시작 위치 — 주소칸 값 → 지난번 자리 → 평택.
         ⚠️ 주소로 찾아낸 것인지(found)를 같이 들고 간다. 지난번 자리나 평택 기본값에
            핀을 꽂으면 '거기가 이 작업 주소'라는 거짓말이 된다. */
      return Geocode.lookup(initialAddr).then(function (g) {
        return g ? { at: g, found: true } : { at: lastCenter() || DEFAULT_CENTER, found: false };
      });
    }).then(function (start) {
      if (_ov !== ov) return;
      box.innerHTML = '';
      var map = new kakao.maps.Map(box, {
        center: new kakao.maps.LatLng(start.at.lat, start.at.lng),
        level: start.found ? 3 : 4        // 주소를 찾았으면 한 단계 더 당겨서 보여준다
      });

      /* 지금 주소칸에 있는 자리 — 핀을 꽂고 아래 막대에 그대로 적어 준다.
         '이 주소 쓰기' 는 붙이지 않는다. 이미 들어 있는 값이라 누를 이유가 없다. */
      if (start.found) {
        setPin(map, new kakao.maps.LatLng(start.at.lat, start.at.lng));
        var sel0 = ov.querySelector('#mpSel');
        if (sel0) sel0.innerHTML =
          '<div class="mp-sel-tx"><b>지금 주소</b>' +
            '<span class="mp-sel-ad">' + esc(initialAddr || '') + '</span></div>' +
          '';
      }
      var marks = [];
      function clearMarks() { marks.forEach(function (m) { m.setMap(null); }); marks = []; }

      kakao.maps.event.addListener(map, 'idle', function () {
        var c = map.getCenter();
        rememberCenter({ lat: c.getLat(), lng: c.getLng() });
      });

      /* 길게 누르기 → 그 자리 주소 */
      attachLongPress(map, box, function (latlng) {
        var g = { lat: latlng.getLat(), lng: latlng.getLng() };
        var sel = _ov && _ov.querySelector('#mpSel');
        if (sel) sel.innerHTML = '<span class="mp-hint">주소를 찾는 중…</span>';
        Geocode.reverse(g).then(function (addr) {
          if (_ov !== ov) return;
          if (!addr) {
            showPick(null);
            toastErr('이 자리의 주소를 찾지 못했어요. 조금 옮겨서 다시 눌러보세요');
            return;
          }
          clearMarks();
          setPin(map, latlng);
          showPick({ name: '', address: addr });
        });
      });

      /* 이름·주소로 찾기 */
      function find() {
        var q = (document.getElementById('mpQ').value || '').trim();
        if (!q) { toastErr('찾을 이름이나 주소를 적어주세요'); return; }
        var places = new kakao.maps.services.Places();
        places.keywordSearch(q, function (r, st) {
          if (_ov !== ov) return;
          if (st !== kakao.maps.services.Status.OK || !r || !r.length) {
            toastErr('찾지 못했어요. 지도를 길게 눌러 그 자리 주소를 쓸 수도 있어요');
            return;
          }
          clearMarks();
          var bounds = new kakao.maps.LatLngBounds();
          r.slice(0, 10).forEach(function (d) {
            var pos = new kakao.maps.LatLng(parseFloat(d.y), parseFloat(d.x));
            bounds.extend(pos);
            var mk = new kakao.maps.Marker({ map: map, position: pos, title: d.place_name || '' });
            marks.push(mk);
            kakao.maps.event.addListener(mk, 'click', function () {
              setPin(map, pos);     // 후보 중 어느 것을 고른 상태인지 눈에 보이게
              showPick({
                name: d.place_name || '',
                address: d.road_address_name || d.address_name || ''
              });
            });
          });
          map.setBounds(bounds, 40, 40, 40, 40);
          setPin(map, new kakao.maps.LatLng(parseFloat(r[0].y), parseFloat(r[0].x)));
          showPick({
            name: r[0].place_name || '',
            address: r[0].road_address_name || r[0].address_name || ''
          });
        });
      }
      document.getElementById('mpFind').addEventListener('click', find);
      document.getElementById('mpQ').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); find(); }
      });
    }).catch(function (e) {
      if (_ov !== ov) return;
      box.innerHTML = '<div class="mp-msg">' + esc((e && e.message) || '지도를 열지 못했습니다') + '</div>';
    });
  }

  window.MapPick = { open: open, close: close, available: function () {
    return !!(window.Geocode && Geocode.available());
  } };
})();
