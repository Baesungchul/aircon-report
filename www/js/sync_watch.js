/* ═══════════════════════════════════════════════════════════
   sync_watch.js — 일정이 안 올라가고 있으면 화면에 말해 준다 (2026-09-18)
   ----------------------------------------------------------------
   ☠️ 왜 만들었나
      "팀원 달력에서 이전 한 달가량의 공유일정이 안 보인다" 를 쫓다가 찾은 것 —
      자동 동기화는 언제나 silent 라, **저장 폴더가 안 잡혀 있으면 아무 말 없이 돌아간다.**
      로그인이 풀려도 마찬가지다. 그 상태로 한 달이 지나면 그 한 달치가 통째로 서버에 없고,
      본인 폰에서는 로컬 폴더로 그리니까 **멀쩡해 보인다.** 팀원 쪽에서만 비어 보인다.
      폴더 '권한'이 풀린 경우엔 배너가 뜨지만(state.js folderReconnectBanner),
      폴더 핸들 자체가 없으면 그 배너도 돌지 못한다.

   ⭐ 이 파일이 지키는 약속 하나: **일정이 며칠째 안 올라가고 있으면 반드시 눈에 보인다.**
      원인이 무엇이든(폴더·로그인·권한·알 수 없는 오류) 같은 자리에서 같은 모양으로 알린다.

   ⚠️ 팝업이 아니다. 화면 위 한 줄이고, 눌러서 닫을 수 있고, 고쳐지면 저절로 사라진다.
      (2026-09-07 팝업 기준: 실패는 알린다. 다만 화면을 막지 않는다)
   ⚠️ 혼자 쓰는 사람에게는 띄우지 않는다. 공유 상대나 팀원이 있을 때만 의미가 있는 경고다.
      혼자 쓰면 로컬 폴더가 곧 원본이라 안 올라가도 잃는 게 없다.
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var STALE_DAYS = 3;               // 며칠 이상 안 올라갔으면 알릴까
  var HIDE_KEY = 'ac_syncwarn_hid'; // 닫아 둔 시각 — 하루는 조용히 있는다
  var HIDE_MS = 24 * 60 * 60 * 1000;
  var CHECK_MS = 30 * 60 * 1000;    // 30분마다 다시 본다 (배터리에 영향 없는 수준)

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function sharing() {
    try {
      return !!(window.CloudShare && CloudShare.hasAcceptedShare && CloudShare.hasAcceptedShare());
    } catch (e) { return false; }
  }

  /* 무엇이 막고 있는지 한 줄로. 사용자가 **할 수 있는 일**을 적는다 — 원인 이름이 아니라. */
  function reason() {
    if (!(window.CloudSync && CloudSync.status)) return null;
    var st = CloudSync.status();
    if (st.blocked === 'folder')  return '저장 폴더가 연결되어 있지 않아 일정이 팀원에게 올라가지 않습니다';
    if (st.blocked === 'login')   return '로그인이 풀려 일정이 팀원에게 올라가지 않습니다';
    if (st.blocked === 'partial') return '저장 폴더를 다 읽지 못해 일부 일정이 올라가지 않았습니다';
    /* 막힌 이유가 없는데도 오래됐다 = 알 수 없는 사정. 며칠째인지만 말한다. */
    if (st.days >= STALE_DAYS) return st.days + '일째 일정이 팀원에게 올라가지 않았습니다';
    if (st.okAt === 0 && st.blocked === 'error') return '일정을 올리지 못하고 있습니다';
    return null;
  }

  function hide() {
    var el = document.getElementById('syncWarnBanner');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function show(msg) {
    if (document.getElementById('syncWarnBanner')) return;
    var el = document.createElement('div');
    el.id = 'syncWarnBanner';
    el.className = 'sync-warn-banner';
    el.innerHTML = '<span class="sw-tx"></span>' +
                   '<button type="button" class="sw-x" id="syncWarnClose" aria-label="닫기">✕</button>';
    el.querySelector('.sw-tx').textContent = msg;   // 사용자 값이 아니지만 습관을 지킨다
    document.body.appendChild(el);
    document.getElementById('syncWarnClose').addEventListener('click', function () {
      set(HIDE_KEY, String(Date.now()));            // 하루는 조용히
      hide();
    });
  }

  function check() {
    try {
      if (!sharing()) { hide(); return; }
      var msg = reason();
      if (!msg) { hide(); return; }
      var hid = parseInt(get(HIDE_KEY) || '0', 10) || 0;
      if (Date.now() - hid < HIDE_MS) return;       // 사용자가 닫아 뒀다
      show(msg);
    } catch (e) { /* 경고 때문에 앱이 멈추면 본말전도다 */ }
  }

  /* 앱이 막 켜진 순간엔 아직 폴더도 로그인도 붙는 중이다 — 조금 기다렸다 본다 */
  document.addEventListener('DOMContentLoaded', function () { setTimeout(check, 6000); });
  setInterval(check, CHECK_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(check, 3000); });

  window.SyncWatch = { check: check, hide: hide, reason: reason };
})();
