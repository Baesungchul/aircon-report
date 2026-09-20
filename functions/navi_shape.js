/* ═══════════════════════════════════════════════════════════════════
   functions/navi_shape.js — 카카오 길찾기 응답 → 앱이 그릴 수 있는 모양
   ----------------------------------------------------------------
   ⭐ 왜 파일을 따로 뺐나
      이 변환이 이 기능에서 제일 틀리기 쉬운 자리다(좌표 순서·구간 대응).
      index.js 안에 두면 firebase 의존성 때문에 검사에서 못 부른다 —
      그러면 '눈으로 읽어 맞겠거니' 하게 된다. 여기는 순수 함수뿐이라
      tools/test-myloc.js 가 진짜 응답 모양을 넣어 돌려 본다.

   ☠️ 카카오는 x=경도, y=위도 다. 위도·경도 순서가 아니다.
      그리고 vertexes 는 [x,y,x,y,...] 로 납작하게 온다.
      이 두 가지를 뒤집는 자리를 **여기 한 곳으로** 못 박는다.
   ☠️ sections 하나가 '한 구간'이다 — 출발→경유1, 경유1→경유2, … →도착.
      그래서 sections.length 는 언제나 (지점 수 - 1) 이어야 한다.
      앱은 이 legs 를 카드에 그대로 붙이므로, 개수가 어긋나면 엉뚱한 카드에
      엉뚱한 거리가 찍힌다(앱 쪽에서도 한 번 더 확인한다).
═══════════════════════════════════════════════════════════════════ */
'use strict';

/* 카카오 응답(j) → { path, distance, duration, legs } 또는 { error }
   ⚠️ 던지지 않는다. 모양이 이상하면 error 를 담아 돌려준다 —
      경로 하나 때문에 함수가 500 으로 떨어지면 지도가 통째로 안 뜬다. */
function shape(j) {
  var route = ((j && j.routes) || [])[0];
  if (!route) return { error: '경로를 찾지 못했습니다' };
  /* result_code 0 이 정상. 그 외는 '길을 못 찾음' 등이고 HTTP 는 200 으로 온다 */
  if (route.result_code !== undefined && route.result_code !== 0) {
    return { error: route.result_msg || '경로를 찾지 못했습니다' };
  }
  var sections = route.sections || [];
  var path = [];
  var paths = [];
  var legs = [];
  sections.forEach(function (sec) {
    legs.push({ distance: sec.distance || 0, duration: sec.duration || 0 });
    /* ⭐ 2026-09-20 구간(section)별로 따로 담는다.
       앱이 구간마다 다른 색으로 그리고, 왔던 길을 되짚는 구간은 나란히 옆으로
       밀어 두 줄로 보여 준다. 그러려면 어디부터 어디까지가 한 구간인지 알아야 한다.
       ⚠️ path(전부 이어 붙인 것)도 그대로 둔다 — 옛 앱이 그걸 쓴다. 지우면 조용히 선이 사라진다. */
    var one = [];
    (sec.roads || []).forEach(function (road) {
      var v = road.vertexes || [];
      for (var i = 0; i + 1 < v.length; i += 2) one.push([v[i + 1], v[i]]);   // x,y → lat,lng
    });
    paths.push(one);
    path = path.concat(one);
  });
  if (path.length < 2) return { error: '경로 좌표가 없습니다' };
  return {
    path: path,
    paths: paths,
    distance: (route.summary && route.summary.distance) || 0,
    duration: (route.summary && route.summary.duration) || 0,
    legs: legs
  };
}

module.exports = { shape: shape };
