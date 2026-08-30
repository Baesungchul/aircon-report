/* ═══════════════════════════════════════════════
   cloud_ai_learn.js — AI 일정입력 교정 데이터 클라우드 동기화
   - 기기 localStorage의 교정 예시(ClaudeAI)를 Firestore(ai_corrections/{uid})에 백업/동기화.
   - 로그인 시 원격+로컬 병합, 저장 시 업로드(디바운스). 미로그인이면 로컬만 사용(앱에 영향 없음).
   - 단일 문서에 list 배열로 저장(최대 40건, 텍스트라 매우 가벼움).
═══════════════════════════════════════════════ */
(function () {
  'use strict';
  window.CloudAILearn = window.CloudAILearn || {};

  var CAP = 40;
  function loggedIn() { return window.Cloud && Cloud.ready && Cloud.user && Cloud.db; }
  function hasAI() { return window.ClaudeAI && ClaudeAI.getCorrections && ClaudeAI.setCorrectionsRaw; }
  function docRef() { return Cloud.db.collection('ai_corrections').doc(Cloud.user.uid); }

  // 입력문장(in) 기준 병합 — 최신(at)이 우선, 최대 CAP건 유지
  function mergeLists(a, b) {
    var map = {};
    (a || []).concat(b || []).forEach(function (c) {
      if (!c || !c.in) return;
      var prev = map[c.in];
      if (!prev || (c.at || 0) >= (prev.at || 0)) map[c.in] = c;
    });
    var out = Object.keys(map).map(function (k) { return map[k]; });
    out.sort(function (x, y) { return (x.at || 0) - (y.at || 0); });
    if (out.length > CAP) out = out.slice(out.length - CAP);
    return out;
  }

  var _busy = false, _pending = false;

  async function push(silent) {
    if (!loggedIn() || !hasAI()) return;
    if (_busy) { _pending = true; return; }
    _busy = true;
    try {
      await docRef().set({
        list: ClaudeAI.getCorrections(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (e) { console.warn('[AILearn] push 실패:', e && e.message); }
    _busy = false;
    if (_pending) { _pending = false; setTimeout(function () { push(true); }, 500); }
  }

  async function pull() {
    if (!loggedIn() || !hasAI()) return;
    try {
      var snap = await docRef().get();
      var remote = (snap.exists && snap.data() && snap.data().list) || [];
      var local = ClaudeAI.getCorrections();
      var merged = mergeLists(local, remote);
      ClaudeAI.setCorrectionsRaw(merged);
      // 병합 결과가 원격과 다르면(로컬에 새 교정이 있었으면) 되올림
      if (JSON.stringify(merged) !== JSON.stringify(remote)) await push(true);
      var cnt = document.getElementById('aiCorrCnt'); if (cnt) cnt.textContent = String(merged.length);
    } catch (e) { console.warn('[AILearn] pull 실패:', e && e.message); }
  }

  // saveCorrection에서 호출 — 디바운스 업로드
  var _t = null;
  CloudAILearn.onLocalChanged = function () {
    if (!loggedIn()) return;
    clearTimeout(_t);
    _t = setTimeout(function () { push(true); }, 1200);
  };
  CloudAILearn.pull = pull;
  CloudAILearn.push = push;

  // 로그인 상태가 되면 병합 동기화
  document.addEventListener('cloud-auth-changed', function (e) {
    if (e && e.detail && e.detail.user) pull();
  });
  // 이 스크립트가 로그인 이후에 늦게 로드된 경우 대비
  setTimeout(function () { if (loggedIn()) pull(); }, 1500);
})();
