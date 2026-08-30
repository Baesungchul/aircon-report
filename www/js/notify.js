/* ═══════════════════════════════════════════════
   NOTIFY ─ 일정 작업시간 로컬 알림 (@capacitor/local-notifications)
   - 설정에서 on/off + 알림시간(정시/10·30분·1시간·1일 전) 설정
   - 작업(일정)의 시작시간 기준으로 (시작 - 알림시간)에 로컬 알림 예약
   - 예약 대상: 로컬 작업 인덱스(_works_index.json)의 앞으로 남은 일정
   - refresh() 호출 때마다 기존 예약을 모두 지우고 다시 계산 → 항상 최신 상태
═══════════════════════════════════════════════ */
(function () {
  'use strict';
  window.Notify = window.Notify || {};

  var ENABLED_KEY = 'notifyEnabled';   // '1' | '0'
  var LEAD_KEY    = 'notifyLeadMin';   // 분 단위 정수 (0=정시)
  var SIG_KEY     = 'notifySchedSig';  // 마지막으로 실제 예약한 목록의 서명(불필요한 재예약 차단, 2026-08-24)
  var _busy = false;

  function LN() { return window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.LocalNotifications; }
  function isNative() { return !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform()); }

  Notify.enabled = function () { try { return localStorage.getItem(ENABLED_KEY) === '1'; } catch (e) { return false; } };
  Notify.leadMin = function () {
    try { var v = parseInt(localStorage.getItem(LEAD_KEY), 10); return isNaN(v) ? 30 : v; } catch (e) { return 30; }
  };

  // 안정적인 정수 id (같은 일정은 항상 같은 id → 재예약 시 중복 안 쌓임)
  function hashId(str) {
    str = String(str || '');
    var h = 0;
    for (var i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; }
    return Math.abs(h) % 2000000000;
  }

  // 'YYYY-MM-DD' + 'HH:MM' → 로컬 Date
  function parseAt(dateStr, timeStr) {
    if (!dateStr || !timeStr) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr));
    var t = /^(\d{1,2}):(\d{2})/.exec(String(timeStr));
    if (!m || !t) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3], +t[1], +t[2], 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }

  // 한 작업의 대표 시작시간(가장 이른 것)
  function startTimeOf(w) {
    if (!w) return '';
    if (w.workType === 'facility' && w.facilityCustomer && w.facilityCustomer.startTime) return w.facilityCustomer.startTime;
    var times = (w.units || []).map(function (u) { return u && u.customer && u.customer.startTime; }).filter(Boolean).sort();
    return times[0] || '';
  }

  Notify.ensurePermission = async function () {
    var ln = LN(); if (!ln) return false;
    try {
      var p = await ln.checkPermissions();
      if (p && p.display === 'granted') return true;
      var r = await ln.requestPermissions();
      return !!(r && r.display === 'granted');
    } catch (e) { return false; }
  };

  /* ── 정확한 시간 알림 (Android 12+) ──────────────────────────────
     ★ 2026-08-27. '30분 전'으로 예약한 알림이 7분 전에 온 실측에서 나왔다.
     예약 계산은 맞았고, 안드로이드가 늦게 깨운 것이다 —
     SCHEDULE_EXACT_ALARM 이 허용돼 있지 않으면 플러그인이 부정확 알람으로
     폴백하고(LocalNotificationManager.setExactIfPossible), 절전 중에는 몰아서 처리돼 밀린다.
     권한은 매니페스트에 넣었지만 targetSdk 33+ 에선 자동 허용이 아니다 → 사용자가 켜야 한다.
     ⚠️ 이 값이 바뀌면 이미 걸어 둔 알람은 여전히 부정확한 채로 남는다.
        그래서 아래 refresh() 의 서명(sig)에 이 상태를 같이 넣는다 — 켜는 순간 전부 다시 걸린다. */
  Notify.checkExact = async function () {          // 'granted' | 'denied' | ''(해당 없음)
    var ln = LN();
    if (!ln || !isNative() || typeof ln.checkExactNotificationSetting !== 'function') return '';
    try { var r = await ln.checkExactNotificationSetting(); return (r && r.exact_alarm) || ''; }
    catch (e) { return ''; }
  };
  Notify.requestExact = async function () {        // 시스템 설정 화면을 열고, 돌아오면 다시 예약
    var ln = LN();
    if (!ln || !isNative() || typeof ln.changeExactNotificationSetting !== 'function') return '';
    var st = '';
    try { var r = await ln.changeExactNotificationSetting(); st = (r && r.exact_alarm) || ''; }
    catch (e) { st = ''; }
    /* 서명에 상태가 들어가므로 굳이 지울 필요는 없지만, 사용자가 방금 켠 직후에는
       확실히 다시 걸리도록 한 번 비워 준다 */
    try { localStorage.removeItem(SIG_KEY); } catch (e) {}
    try { await Notify.refresh(); } catch (e) {}
    return st;
  };

  // 예약 다시 계산 (기존 전부 취소 후 재예약)
  Notify.refresh = async function () {
    var ln = LN();
    if (!ln || !isNative()) return;
    if (_busy) return; _busy = true;
    try {
      /* ★ 2026-08-24 알람 부하 — 예전엔 여기서 무조건 '전부 취소'부터 하고 400건까지 다시 걸었다.
           이 함수는 앱이 포그라운드로 돌아올 때마다 불리므로(파일 끝 visibilitychange),
           하루에 앱을 스무 번 열면 AlarmManager 등록/해제가 수천 번 일어났다(복귀 직후 버벅임의 원인).
           → 순서를 바꾼다. 예약할 목록을 **먼저** 만들고(작업 인덱스는 캐시되어 있어 싸다),
             지금 실제로 걸려 있는 것과 같으면 알람은 아예 건드리지 않는다.
           ⚠️ 취소는 없애지 않고 아래 '서명 비교' 뒤로 옮겼을 뿐이다 — 알림을 끄면 여전히 전부 취소된다. */
      // ★ 설정의 '작업 알림'이 꺼져 있어도 리마인더는 각자 알림 설정을 따라 동작해야 한다.
      //   → 여기서 return 하지 않고, 작업 알림만 건너뛴다.
      var workNotifyOn = Notify.enabled();

      // 1) 작업 인덱스 로드 (작업 알림이 켜져 있을 때만)
      var idx = null;
      if (workNotifyOn) {
        try { idx = (typeof loadWorkIndex === 'function') ? await loadWorkIndex() : null; } catch (e) {}
      }
      var works = (idx && idx.works) || [];

      var now = Date.now();
      var lead = Notify.leadMin() * 60 * 1000;
      var horizon = now + 60 * 24 * 60 * 60 * 1000;   // 60일 이내만
      var jobs = [];
      var seen = {};
      works.forEach(function (w) {
        var st = startTimeOf(w);
        if (!st) return;
        var at = parseAt(w.date, st);
        if (!at) return;
        var fireAt = at.getTime() - lead;
        if (fireAt <= now + 30000) return;   // 이미 지남
        if (fireAt > horizon) return;        // 너무 먼 미래
        var id = hashId(w.folderName || w.workId || (w.date + '_' + st));
        if (seen[id]) return; seen[id] = 1;
        var title = w.apt || (w.workType === 'facility' ? '공용시설 작업' : '작업');
        var lm = Notify.leadMin();
        var body = (lm > 0)
          ? (st + ' 작업 시작 ' + (lm >= 1440 ? Math.round(lm / 1440) + '일' : (lm >= 60 ? Math.round(lm / 60) + '시간' : lm + '분')) + ' 전이에요')
          : (st + ' 작업 시작 시간이에요');
        jobs.push({
          id: id,
          title: '🔔 ' + title,
          body: body,
          schedule: { at: new Date(fireAt), allowWhileIdle: true }
        });
      });

      /* ★ 2026-08-08 리마인더 알림도 여기서 함께 예약한다.
           이 함수는 맨 앞에서 '예약 전부 취소'를 하므로, 리마인더를 따로 예약하면
           작업 알림이 갱신될 때마다 리마인더가 같이 지워진다. 반드시 같은 패스에서 처리해야 한다.
           리마인더는 설정의 알림 on/off·리드타임과 무관하게 '항목별 알림 설정'을 따른다. */
      try {
        if (window.Reminders && Reminders.pendingNotifications) {
          var rems = Reminders.pendingNotifications(60 * 24 * 60 * 60 * 1000) || [];
          rems.forEach(function (r) {
            var rid = hashId(r.key);
            if (seen[rid]) return; seen[rid] = 1;
            jobs.push({
              id: rid,
              title: r.title,
              body: r.body,
              schedule: { at: r.at, allowWhileIdle: true }
            });
          });
          if (rems.length) console.log('[Notify] 리마인더 알림 ' + rems.length + '건 포함');
        }
      } catch (e) { console.warn('[Notify] 리마인더 예약 실패', e && (e.message || e)); }

      jobs.sort(function (a, b) { return a.schedule.at - b.schedule.at; });
      if (jobs.length > 400) jobs = jobs.slice(0, 400);  // 가까운 것 우선(안드로이드 한도 보호)

      /* 2) 바뀐 게 없으면 알람을 그대로 둔다. 두 가지를 같이 본다 —
             sig     : 이번에 걸 목록(id + 시각 + 문구). 시간이나 현장 이름만 바뀐 경우까지 잡는다.
             pendIds : 지금 실제로 걸려 있는 id. 알람이 조용히 사라진 경우를 잡는다.
           둘 다 일치할 때만 건너뛴다. sig 는 저장해 두므로 앱을 새로 켰을 때도 건너뛴다. */
      /* ★ 2026-08-27 정확알람 상태를 서명에 넣는다.
           사용자가 시스템 설정에서 '알람 및 리마인더'를 켜도 목록은 그대로라 sig 가 같아서
           재예약을 건너뛰고, 이미 걸린 알람은 부정확한 채로 남는 함정이 있었다. */
      var exactState = await Notify.checkExact();
      var sig = jobs.length + ':x' + exactState + ':' + hashId(jobs.map(function (j) {
        return j.id + '@' + (+j.schedule.at) + '|' + j.title + '|' + j.body;
      }).join(','));
      var wantIds = jobs.map(function (j) { return j.id; }).sort().join(',');
      var pend = null, pendIds = '';
      try {
        pend = await ln.getPending();
        pendIds = ((pend && pend.notifications) || []).map(function (n) { return n.id; }).sort().join(',');
      } catch (e) {}
      var lastSig = '';
      try { lastSig = localStorage.getItem(SIG_KEY) || ''; } catch (e) {}
      if (sig === lastSig && pendIds === wantIds) {
        console.log('[Notify] 변경 없음 - 재예약 건너뜀 (' + jobs.length + '건 유지)');
        return;
      }

      // 3) 기존 예약 전부 취소 (여기서부터는 실제로 바뀐 경우만 온다)
      try {
        if (pend && pend.notifications && pend.notifications.length) {
          await ln.cancel({ notifications: pend.notifications.map(function (n) { return { id: n.id }; }) });
        }
      } catch (e) {}

      if (!jobs.length) {
        try { localStorage.setItem(SIG_KEY, sig); } catch (e) {}
        console.log('[Notify] 알림 꺼짐 또는 예약할 일정 없음 - 취소만 수행');
        return;
      }
      var ok = await Notify.ensurePermission();
      if (!ok) {
        console.warn('[Notify] 알림 권한 없음');
        try { localStorage.removeItem(SIG_KEY); } catch (e) {}   // 권한을 나중에 주면 다시 걸리도록
        return;
      }
      try {
        await ln.schedule({ notifications: jobs });
        try { localStorage.setItem(SIG_KEY, sig); } catch (e) {}
      } catch (e) {
        console.warn('[Notify] schedule 실패', e && e.message);
        try { localStorage.removeItem(SIG_KEY); } catch (e2) {}   // 다음 복귀 때 다시 시도하도록
      }
      console.log('[Notify] 예약 ' + jobs.length + '건 (알림 ' + Notify.leadMin() + '분 전)');
    } finally { _busy = false; }
  };

  Notify.setEnabled = async function (on) {
    try { localStorage.setItem(ENABLED_KEY, on ? '1' : '0'); } catch (e) {}
    if (on) { await Notify.ensurePermission(); }
    await Notify.refresh();
  };
  Notify.setLead = async function (min) {
    try { localStorage.setItem(LEAD_KEY, String(min)); } catch (e) {}
    await Notify.refresh();
  };

  // 부팅/복귀 시 자동 재계산
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () { try { Notify.refresh(); } catch (e) {} }, 5000);
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      setTimeout(function () { try { Notify.refresh(); } catch (e) {} }, 1500);
    }
  });
})();
