/* ═══════════════════════════════════════════════
   cloud_ai_learn.js — AI 일정입력 교정 데이터 클라우드 동기화
   - 기기 localStorage의 교정 예시(ClaudeAI)를 Firestore(ai_corrections/{uid})에 백업/동기화.
   - 로그인 시 원격+로컬 병합, 저장 시 업로드(디바운스). 미로그인이면 로컬만 사용(앱에 영향 없음).
   - 단일 문서에 list 배열로 저장(최대 40건, 텍스트라 매우 가벼움).
═══════════════════════════════════════════════ */
(function () {
  'use strict';
  window.CloudAILearn = window.CloudAILearn || {};

  var CAP = 100;      // ★ 2026-11-12 40→100 (ai.js CORR_MAX 와 같게)
  var IND_CAP = 200;  // ★ 2026-11-12 업종 학습 (ai.js IND_MAX 와 같게)
  function loggedIn() { return window.Cloud && Cloud.ready && Cloud.user && Cloud.db; }
  function hasAI() { return window.ClaudeAI && ClaudeAI.getCorrections && ClaudeAI.setCorrectionsRaw; }
  function docRef() { return Cloud.db.collection('ai_corrections').doc(Cloud.user.uid); }

  // 입력문장(in) 기준 병합 — 최신(at)이 우선, 최대 CAP건 유지
  function mergeLists(a, b, cap) {
    cap = cap || CAP;
    var map = {};
    (a || []).concat(b || []).forEach(function (c) {
      if (!c || !c.in) return;
      var prev = map[c.in];
      if (!prev || (c.at || 0) >= (prev.at || 0)) map[c.in] = c;
    });
    var out = Object.keys(map).map(function (k) { return map[k]; });
    out.sort(function (x, y) { return (x.at || 0) - (y.at || 0); });
    if (out.length > cap) out = out.slice(out.length - cap);
    return out;
  }

  var _busy = false, _pending = false;

  /* ★ 2026-11-17 문서 크기 안전장치 — Firestore 문서는 1MB 가 한도다. 넘으면 set 이 통째로 실패해
       교정·업종 학습 둘 다 동기화가 멈춘다(경고만 남고 사용자는 모른다).
       교정 100건 + 업종 200건으로 늘린 뒤 긴 캡처 전사문이 쌓이면 닿을 수 있어, 올리기 전에
       850KB 안쪽이 될 때까지 **오래된 것부터** 덜어 낸다. 덜어 낸 결과를 로컬에도 그대로 반영해
       다음 병합 때 다시 늘어나 매번 올리는 일이 없게 한다. */
  var DOC_BUDGET = 850000;
  function _bytes(o) {
    try {
      var s = JSON.stringify(o);
      return (typeof TextEncoder !== 'undefined') ? new TextEncoder().encode(s).length : s.length * 3;
    } catch (e) { return 0; }
  }
  function _fitBudget(list, ind) {
    var cut = false, guard = 0;
    while (_bytes({ list: list, ind: ind }) > DOC_BUDGET && guard++ < 50) {
      if (ind.length > 20 && ind.length >= list.length) ind = ind.slice(Math.ceil(ind.length * 0.1));
      else if (list.length > 20) list = list.slice(Math.ceil(list.length * 0.1));
      else break;
      cut = true;
    }
    return { list: list, ind: ind, cut: cut };
  }
  CloudAILearn._fitBudget = _fitBudget;   /* 검사용 */

  async function push(silent) {
    if (!loggedIn() || !hasAI()) return;
    if (_busy) { _pending = true; return; }
    _busy = true;
    try {
      var _fit = _fitBudget(ClaudeAI.getCorrections(), (ClaudeAI.getIndLearn ? ClaudeAI.getIndLearn() : []));
      if (_fit.cut) {
        console.warn('[AILearn] 학습 기록이 커서 오래된 것을 덜어 냈습니다', _fit.list.length, _fit.ind.length);
        try { ClaudeAI.setCorrectionsRaw(_fit.list); } catch (e) {}
        try { if (ClaudeAI.setIndLearnRaw) ClaudeAI.setIndLearnRaw(_fit.ind); } catch (e) {}
      }
      await docRef().set({
        list: _fit.list,
        ind: _fit.ind,   // ★ 2026-11-12 업종 학습
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
      // ★ 2026-11-12 업종 학습도 같은 방식으로 병합
      var remoteInd = (snap.exists && snap.data() && snap.data().ind) || [];
      var mergedInd = remoteInd;
      if (ClaudeAI.getIndLearn && ClaudeAI.setIndLearnRaw) {
        mergedInd = mergeLists(ClaudeAI.getIndLearn(), remoteInd, IND_CAP);
        ClaudeAI.setIndLearnRaw(mergedInd);
      }
      // 병합 결과가 원격과 다르면(로컬에 새 교정이 있었으면) 되올림
      if (JSON.stringify(merged) !== JSON.stringify(remote) ||
          JSON.stringify(mergedInd) !== JSON.stringify(remoteInd)) await push(true);
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
