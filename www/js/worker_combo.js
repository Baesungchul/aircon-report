/* ═══════════════════════════════════════════════
   WORKER COMBO ─ 작업탭 담당자 콤보상자 + 닉네임 자동입력
   - #workerName 에 datalist(콤보) 연결: 내 닉네임 + 공유상대 닉네임 + 과거 사용 이름
   - 자동채움(닉네임)은 '새 작업'(newWork)에서만 수행 (불러온 작업은 건드리지 않음)
   - 공유 필수 모드(CloudShare.setupWorkerCombo select)와 공존: input 숨김 시엔 영향 없음
═══════════════════════════════════════════════ */
(function () {
  'use strict';
  window.WorkerCombo = window.WorkerCombo || {};

  var HKEY = 'ac_worker_names', MAX = 15;
  function loadHist() { try { return JSON.parse(localStorage.getItem(HKEY) || '[]') || []; } catch (e) { return []; } }
  function saveHist(a) { try { localStorage.setItem(HKEY, JSON.stringify(a.slice(0, MAX))); } catch (e) {} }
  function record(name) {
    name = String(name || '').trim();
    if (!name) return;
    var h = loadHist().filter(function (n) { return n !== name; });
    h.unshift(name);
    saveHist(h);
  }
  function myNick() {
    try { if (window.CloudShare && CloudShare.myProfile) { return CloudShare.myProfile().name || ''; } } catch (e) {}
    return '';
  }
  function names() {
    var set = [];
    var push = function (n) { n = String(n || '').trim(); if (n && set.indexOf(n) < 0) set.push(n); };
    push(myNick());
    try { if (window.CloudShare && CloudShare.getWorkerNames) CloudShare.getWorkerNames().forEach(push); } catch (e) {}
    loadHist().forEach(push);
    return set;
  }
  function refresh() {
    var dl = document.getElementById('workerNameList');
    if (!dl) return;
    dl.innerHTML = names().map(function (n) { return '<option value="' + n.replace(/"/g, '&quot;') + '">'; }).join('');
  }
  function autofillIfEmpty() {
    var inp = document.getElementById('workerName');
    if (!inp) return;
    if (!inp.value || !inp.value.trim()) { var n = myNick(); if (n) inp.value = n; }
  }
  WorkerCombo.refresh = refresh;
  WorkerCombo.autofillIfEmpty = autofillIfEmpty;
  WorkerCombo.record = record;
  // 기본 작업자: 내 닉네임 → 최근 사용 이름 순 (작업자 미선택 저장 방지용 자동채움)
  WorkerCombo.defaultName = function () { return myNick() || (loadHist()[0] || ''); };

  function initInput() {
    var inp = document.getElementById('workerName');
    if (inp && !inp._wcBound) {
      inp._wcBound = true;
      inp.addEventListener('change', function () { record(inp.value); refresh(); });
    }
  }

  // 자동채움은 newWork에서만 수행 — 불러온 작업의 담당자 칸을 바꾸면 저장 상태와 달라져
  // "변경사항 있음" 오탐이 생기므로, 여기선 datalist 목록만 갱신한다.
  document.addEventListener('DOMContentLoaded', function () {
    initInput(); refresh();
  });
  document.addEventListener('cloud-auth-changed', function () {
    setTimeout(function () { refresh(); }, 300);
  });
})();
