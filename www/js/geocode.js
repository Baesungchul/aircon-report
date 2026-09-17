/* ═══════════════════════════════════════════════════════════
   geocode.js — 주소 → 좌표 (그날 지도 · 지도에서 주소 찍기 공용)
   ----------------------------------------------------------------
   현장매니저는 작업에 **주소 글자만** 있고 좌표가 없다.
   (찍고쓰다는 장소에 geo{lat,lng} 가 붙어 있어 지도가 찍기만 하면 된다 — 여기는 다르다)
   그래서 지도에 올리려면 주소를 좌표로 바꾸는 단계가 하나 더 필요하다.

   ⭐ 카카오 지도 JS SDK 의 **services 라이브러리**만 쓴다.
      · 주소검색(addressSearch)·키워드검색(keywordSearch)·좌표→주소(coord2Address)가
        전부 JavaScript 키 하나로 된다. REST 키가 필요 없다
        (찍고쓰다는 REST 키를 깃허브 시크릿으로 주입하는데, 여기는 그 장치가 없어도 된다).
      · SDK 는 지도를 처음 열 때 받는다 — 앱 시작을 무겁게 하지 않는다.

   ☠️ 주소 글자는 제각각이다. 그래서 두 단으로 찾는다.
        1단 addressSearch  — '평택시 비전동 123-4' 같은 정식 주소에 강하다.
        2단 keywordSearch  — '○○아파트 101동' 처럼 건물 이름이 섞이면 이쪽만 찾는다.
      작업 주소칸에는 아파트명만 적히는 일이 흔하다(빠른 작업추가가 주소칸을
      아파트명으로 채워 주기도 한다). 1단만 쓰면 그 작업들이 통째로 지도에서 사라진다.

   ☠️ 찾은 좌표는 반드시 캐시한다. 안 하면 그날 목록을 열 때마다 사람 수 × 작업 수만큼
      카카오에 묻게 된다(일일 쿼터가 있고, 화면도 매번 느려진다).
      못 찾은 주소도 캐시한다 — 안 그러면 '안 나오는 주소'가 제일 자주 묻는 주소가 된다.
      다만 못 찾은 건 7일 뒤 다시 시도한다(카카오 쪽 데이터가 늘기도 하므로).
      주소 글자를 고치면 열쇠 자체가 달라지므로, 고친 주소는 캐시에 막히지 않는다.

   ⚠️ localStorage 는 이 앱에서 이미 빠듯하다(달력 월캐시가 한도를 밀어낸 적 있다).
      그래서 개수 상한을 두고, 넘으면 오래 쓴 것부터 버린다.
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CACHE_KEY = 'ac_geocache_v1';
  var CACHE_MAX = 400;                   // 주소 하나에 약 60바이트 → 상한에서도 25KB 안쪽
  var MISS_TTL  = 7 * 24 * 60 * 60 * 1000;   // 못 찾은 주소를 다시 물어보기까지
  var _sdk = null;

  function key() { return String(window.KAKAO_JS_KEY || ''); }
  /* 키가 '있다'는 건 자리표시자가 아니라는 뜻까지 포함한다 */
  function available() { var k = key(); return !!k && k.indexOf('TODO_') !== 0; }

  /* 주소를 캐시 열쇠로 — 공백·전각공백만 정리한다. 그 이상 손대면 서로 다른 주소가 합쳐진다 */
  function norm(addr) { return String(addr || '').replace(/[\s　]+/g, ' ').trim(); }

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function writeCache(c) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); }
    catch (e) { /* 한도가 찼으면 캐시를 포기한다 — 기능은 느려질 뿐 멈추지 않는다 */ }
  }
  /* 상한을 넘으면 마지막으로 쓴 지 오래된 것부터 버린다 */
  function prune(c) {
    var ks = Object.keys(c);
    if (ks.length <= CACHE_MAX) return c;
    ks.sort(function (a, b) { return (c[a].t || 0) - (c[b].t || 0); });
    for (var i = 0; i < ks.length - CACHE_MAX; i++) delete c[ks[i]];
    return c;
  }

  /* 캐시에 있으면 {lat,lng} / 못 찾은 것으로 기억돼 있으면 null / 모르면 undefined */
  function cached(addr) {
    var k = norm(addr); if (!k) return null;
    var c = readCache(), e = c[k];
    if (!e) return undefined;
    if (e.lat == null) {                       // 못 찾음으로 기억된 것
      if (Date.now() - (e.t || 0) > MISS_TTL) return undefined;   // 기한이 지나면 다시 물어본다
      return null;
    }
    return { lat: e.lat, lng: e.lng };
  }
  function remember(addr, geo) {
    var k = norm(addr); if (!k) return;
    var c = readCache();
    c[k] = geo ? { lat: geo.lat, lng: geo.lng, t: Date.now() } : { lat: null, t: Date.now() };
    writeCache(prune(c));
  }

  /* ── SDK 한 번만 받아 온다 ──
     ⚠️ libraries=services 를 빼면 kakao.maps.services 가 통째로 없다(주소검색 불가).
     ⚠️ autoload=false + kakao.maps.load() 가 공식 순서다. 빼면 지도 객체가 늦게 생겨
        "kakao.maps.Map is not a constructor" 로 조용히 실패한다. */
  function loadSdk() {
    if (_sdk) return _sdk;
    _sdk = new Promise(function (res, rej) {
      if (!available()) { rej(new Error('지도 키가 설정되지 않았습니다 (www/js/config_map.js)')); return; }
      if (window.kakao && window.kakao.maps && window.kakao.maps.services) { res(); return; }
      var s = document.createElement('script');
      s.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' +
              encodeURIComponent(key()) + '&libraries=services&autoload=false';
      s.onload = function () {
        try { kakao.maps.load(function () { res(); }); }
        catch (e) { rej(new Error('지도를 초기화하지 못했습니다')); }
      };
      s.onerror = function () {
        _sdk = null;   // 다음에 다시 시도할 수 있게 (비행기 모드로 한 번 실패했다고 영영 막지 않는다)
        rej(new Error('지도를 불러오지 못했습니다 (키·도메인 등록을 확인해 주세요)'));
      };
      document.head.appendChild(s);
    });
    return _sdk;
  }

  function svc() {
    return { geo: new kakao.maps.services.Geocoder(), places: new kakao.maps.services.Places() };
  }

  /* 주소 하나 → {lat,lng} 또는 null. 실패해도 reject 하지 않는다 —
     한 건이 안 나왔다고 지도 전체가 안 뜨면 안 된다. */
  function lookup(addr) {
    var k = norm(addr);
    if (!k) return Promise.resolve(null);
    var hit = cached(k);
    if (hit !== undefined) return Promise.resolve(hit);
    if (!available()) return Promise.resolve(null);

    return loadSdk().then(function () {
      var s = svc();
      return new Promise(function (res) {
        var done = false;
        var finish = function (g) { if (done) return; done = true; remember(k, g); res(g); };
        /* 1단 — 정식 주소 */
        s.geo.addressSearch(k, function (r, st) {
          if (st === kakao.maps.services.Status.OK && r && r.length) {
            finish({ lat: parseFloat(r[0].y), lng: parseFloat(r[0].x) });
            return;
          }
          /* 2단 — 건물·상호 이름으로 (아파트명만 적힌 주소가 여기서 잡힌다) */
          s.places.keywordSearch(k, function (r2, st2) {
            if (st2 === kakao.maps.services.Status.OK && r2 && r2.length) {
              finish({ lat: parseFloat(r2[0].y), lng: parseFloat(r2[0].x) });
            } else {
              finish(null);
            }
          });
        });
      });
    }).catch(function () { return null; });
  }

  /* 여러 주소를 한꺼번에. 같은 주소가 섞여 있으면 한 번만 묻는다.
     ⚠️ 한 번에 다 던지지 않고 3개씩 나눠 보낸다 — 카카오가 순간 요청을 막으면
        일부만 찍힌 지도가 되는데, 그건 '어제는 됐는데 오늘은 안 되네'로 보인다. */
  function lookupMany(addrs) {
    var uniq = [];
    var seen = {};
    (addrs || []).forEach(function (a) {
      var k = norm(a);
      if (!k || seen[k]) return;
      seen[k] = 1; uniq.push(k);
    });
    var out = {};
    var i = 0;
    function step() {
      if (i >= uniq.length) return Promise.resolve(out);
      var slice = uniq.slice(i, i + 3);
      i += 3;
      return Promise.all(slice.map(function (k) {
        return lookup(k).then(function (g) { out[k] = g; });
      })).then(step);
    }
    return step();
  }

  /* 좌표 → 주소 (지도를 눌러 주소를 채울 때). 도로명이 있으면 도로명을 준다 */
  function reverse(geo) {
    if (!geo || !available()) return Promise.resolve('');
    return loadSdk().then(function () {
      return new Promise(function (res) {
        svc().geo.coord2Address(geo.lng, geo.lat, function (r, st) {
          if (st !== kakao.maps.services.Status.OK || !r || !r.length) { res(''); return; }
          var d = r[0];
          res((d.road_address && d.road_address.address_name) ||
              (d.address && d.address.address_name) || '');
        });
      });
    }).catch(function () { return ''; });
  }

  window.Geocode = {
    available: available,
    loadSdk: loadSdk,
    lookup: lookup,
    lookupMany: lookupMany,
    cached: cached,
    reverse: reverse,
    norm: norm,
    /* 검사·디버그용 — 캐시를 비운다 */
    clearCache: function () { try { localStorage.removeItem(CACHE_KEY); } catch (e) {} }
  };
  window.__geocodeInternals = { CACHE_KEY: CACHE_KEY, CACHE_MAX: CACHE_MAX, MISS_TTL: MISS_TTL, prune: prune };
})();
