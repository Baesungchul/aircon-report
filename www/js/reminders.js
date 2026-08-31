/* ═══════════════════════════════════════════════
   REMINDERS ─ 개인 리마인더 (공유 안 됨, 내가 참고할 일정)
   예) "10시까지 서비스센터 방문"

   설계 메모
   - 공유 대상이 아니므로 Firestore 에 올리지 않는다. 상대에게 절대 안 보인다.
   - 저장은 이중으로 한다.
       ① localStorage : 즉시 읽기/쓰기용 (앱 켜자마자 달력에 바로 뜨게)
       ② 저장폴더/_reminders.json : 진짜 보관본
         → 자동백업·서버백업이 저장폴더를 통째로 백업하므로, 재설치해도 같이 복구된다.
           (localStorage 만 쓰면 앱을 지우는 순간 전부 사라진다)
   - 알림은 여기서 직접 예약하지 않는다. notify.js 의 Notify.refresh() 가
     '기존 예약 전부 취소 → 재계산' 방식이라, 따로 예약하면 지워져 버린다.
     그래서 Reminders.pendingNotifications() 로 목록만 넘기고 예약은 notify.js 가 한다.
═══════════════════════════════════════════════ */
(function () {
  'use strict';
  window.Reminders = window.Reminders || {};

  var LS_KEY = 'ac_reminders_v1';
  var FILE = '_reminders.json';
  var MAX = 500;

  // 알림 리드타임 선택지 (분). -1 = 알림 없음, 0 = 정시
  var LEADS = [
    { v: -1,  label: '알림 없음' },
    { v: 0,   label: '정시' },
    { v: 10,  label: '10분 전' },
    { v: 30,  label: '30분 전' },
    { v: 60,  label: '1시간 전' },
    { v: 120, label: '2시간 전' }
  ];
  var REPEATS = [
    { v: 'none',    label: '반복 없음' },
    { v: 'weekly',  label: '매주' },
    { v: 'monthly', label: '매월' }
  ];
  Reminders.LEADS = LEADS;
  Reminders.REPEATS = REPEATS;
  Reminders.leadLabel = function (v) {
    for (var i = 0; i < LEADS.length; i++) if (LEADS[i].v === v) return LEADS[i].label;
    return '알림 없음';
  };
  Reminders.repeatLabel = function (v) {
    for (var i = 0; i < REPEATS.length; i++) if (REPEATS[i].v === v) return REPEATS[i].label;
    return '반복 없음';
  };

  var _list = null;   // 메모리 캐시

  function _load() {
    if (_list) return _list;
    try {
      var a = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
      _list = Array.isArray(a) ? a.filter(_valid) : [];
    } catch (e) { _list = []; }
    return _list;
  }
  function _valid(r) {
    return !!(r && typeof r === 'object' && r.id && /^\d{4}-\d{2}-\d{2}$/.test(r.date || ''));
  }
  function _saveLS() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(_list || [])); } catch (e) {}
  }

  /* ── 저장폴더의 _reminders.json 에 보관 (백업 경로에 편승) ── */
  async function _saveFile() {
    try {
      if (typeof photoFolderHandle === 'undefined' || !photoFolderHandle) return false;
      if (typeof requestFolderPermissionSafe === 'function') {
        try { await requestFolderPermissionSafe('readwrite'); } catch (e) {}
      }
      var snapshot = JSON.stringify({ version: 1, savedAt: new Date().toISOString(), items: _list || [] }, null, 2);
      var fh = await photoFolderHandle.getFileHandle(FILE, { create: true });
      var wr = await fh.createWritable();
      await wr.write(new Blob([snapshot], { type: 'application/json' }));
      await wr.close();
      return true;
    } catch (e) {
      console.warn('[리마인더] 폴더 저장 실패:', e && (e.message || e));
      return false;
    }
  }
  // 앱 시작 시: 폴더 파일이 localStorage 보다 많으면(재설치 복구 등) 폴더 것을 채택
  Reminders.loadFromFolder = async function () {
    try {
      if (typeof photoFolderHandle === 'undefined' || !photoFolderHandle) return;
      var fh;
      try { fh = await photoFolderHandle.getFileHandle(FILE); } catch (e) { return; }  // 파일 없음 = 정상
      var obj = JSON.parse(await (await fh.getFile()).text()) || {};
      var fileItems = Array.isArray(obj.items) ? obj.items.filter(_valid) : [];
      var cur = _load();
      // 병합: id 기준. 같은 id 면 updatedAt 이 최신인 쪽을 남긴다.
      var map = {};
      cur.forEach(function (r) { map[r.id] = r; });
      fileItems.forEach(function (r) {
        var ex = map[r.id];
        if (!ex || (r.updatedAt || 0) > (ex.updatedAt || 0)) map[r.id] = r;
      });
      var merged = Object.keys(map).map(function (k) { return map[k]; });
      if (merged.length !== cur.length) {
        _list = merged; _saveLS();
        console.log('[리마인더] 폴더에서 복구/병합:', merged.length + '건');
        _notifyChanged();
      }
    } catch (e) { console.warn('[리마인더] 폴더 읽기 실패:', e && (e.message || e)); }
  };

  function _notifyChanged() {
    try { if (window.__calendarRefresh) window.__calendarRefresh(); } catch (e) {}
    try { if (window.Notify && Notify.refresh) Notify.refresh(); } catch (e) {}
  }

  /* ── 조회 ── */
  Reminders.all = function () { return _load().slice(); };
  Reminders.get = function (id) {
    var a = _load();
    for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
    return null;
  };

  /* 특정 달('YYYY-MM')에 표시할 리마인더 — 반복은 그 달의 해당 날짜로 펼쳐서 돌려준다.
     펼친 항목에는 _occDate(그 달의 실제 날짜)와 _srcId(원본 id)를 넣는다. */
  Reminders.forMonth = function (monthStr) {
    var out = [];
    if (!monthStr) return out;
    var y = +monthStr.slice(0, 4), m = +monthStr.slice(5, 7);
    var daysInMonth = new Date(y, m, 0).getDate();
    _load().forEach(function (r) {
      var rep = r.repeat || 'none';
      var sp  = _spanDays(r);          // ★ 기간(종료일) 길이 — 지난 달에서 넘어온 것도 잡아야 한다
      if (rep === 'none') {
        var st = r.date || '';
        var en = sp > 0 ? _dAdd(st, sp) : st;
        // 시작이 이 달이 아니어도 기간이 이 달에 걸치면 넣는다(달력이 날짜별로 펼친다)
        if (st.slice(0, 7) <= monthStr && en.slice(0, 7) >= monthStr) out.push(_occ(r, st));
        return;
      }
      if ((r.date || '') > (monthStr + '-31')) return;   // 시작 전인 달
      var base = _dObj(r.date);
      if (rep === 'monthly') {
        var dd = +r.date.slice(8, 10);
        if (dd <= daysInMonth) out.push(_occ(r, monthStr + '-' + _p2(dd)));
        // 지난 달 회차의 기간이 이 달까지 걸치는 경우
        if (sp > 0) {
          var pv = new Date(y, m - 2, 1);
          var pdim = new Date(pv.getFullYear(), pv.getMonth() + 1, 0).getDate();
          if (dd <= pdim) {
            var pSt = new Date(pv.getFullYear(), pv.getMonth(), dd);
            var pEn = new Date(pSt); pEn.setDate(pEn.getDate() + sp);
            if (pSt >= base && pEn >= new Date(y, m - 1, 1)) out.push(_occ(r, _ymd(pSt)));
          }
        }
        return;
      }
      if (rep === 'weekly') {
        var dow = base.getDay();
        for (var d = 1 - sp; d <= daysInMonth; d++) {   // 지난 달에서 넘어오는 회차까지
          var cur = new Date(y, m - 1, d);
          if (cur.getDay() !== dow) continue;
          if (cur < base) continue;
          out.push(_occ(r, _ymd(cur)));
        }
      }
    });
    return out;
  };
  function _p2(n) { return (n < 10 ? '0' : '') + n; }
  function _ymd(dt) { return dt.getFullYear() + '-' + _p2(dt.getMonth() + 1) + '-' + _p2(dt.getDate()); }
  function _dObj(ds) { return new Date(+ds.slice(0, 4), +ds.slice(5, 7) - 1, +ds.slice(8, 10)); }
  function _dAdd(ds, n) { var d = _dObj(ds); d.setDate(d.getDate() + n); return _ymd(d); }
  // 시작일~종료일이 며칠짜리인지 (같은 날이면 0)
  function _spanDays(r) {
    if (!r || !r.endDate || !/^\d{4}-\d{2}-\d{2}$/.test(r.endDate) || r.endDate <= r.date) return 0;
    return Math.round((_dObj(r.endDate) - _dObj(r.date)) / 86400000);
  }
  Reminders.spanDays = _spanDays;
  function _occ(r, date) {
    var c = {};
    for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) c[k] = r[k];
    c._srcDate = r.date;   // 원본 시작일 보존
    c.date = date;         // ★ 달력이 참조하는 날짜는 '이 회차의 날짜'여야 한다.
                           //   (안 바꾸면 매주/매월 반복이 전부 시작일 하루에만 몰려 표시됨)
    /* ★ 2026-08-17 종료일(기간). 반복이면 회차마다 같은 길이만큼 밀어 준다. */
    var sp = _spanDays(r);
    c.endDate = sp > 0 ? _dAdd(date, sp) : '';
    c._occDate = date;
    c._srcId = r.id;
    // 반복 항목의 완료는 '그 회차'만 완료로 본다 (doneDates 배열)
    c._done = (r.repeat && r.repeat !== 'none')
      ? (Array.isArray(r.doneDates) && r.doneDates.indexOf(date) >= 0)
      : !!r.done;
    return c;
  }

  /* ── 저장/삭제 ── */
  // 종료일은 시작일보다 뒤일 때만 의미가 있다. 아니면 빈 값(=하루짜리)
  function _validEnd(start, end) {
    if (!end || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return '';
    return (end > start) ? end : '';
  }
  Reminders.save = function (fields) {
    var a = _load();
    var now = Date.now();
    var r = null;
    if (fields.id) { r = Reminders.get(fields.id); }
    if (r) {
      r.title = String(fields.title || '').trim();
      r.date = fields.date;
      r.endDate = _validEnd(fields.date, fields.endDate);
      r.time = fields.time || '';
      r.lead = (typeof fields.lead === 'number') ? fields.lead : -1;
      r.repeat = fields.repeat || 'none';
      r.memo = String(fields.memo || '');
      r.updatedAt = now;
    } else {
      r = {
        id: 'r_' + now + '_' + Math.random().toString(36).slice(2, 7),
        title: String(fields.title || '').trim(),
        date: fields.date,
        endDate: _validEnd(fields.date, fields.endDate),
        time: fields.time || '',
        lead: (typeof fields.lead === 'number') ? fields.lead : -1,
        repeat: fields.repeat || 'none',
        memo: String(fields.memo || ''),
        done: false,
        doneDates: [],
        createdAt: now,
        updatedAt: now
      };
      a.push(r);
      if (a.length > MAX) a.splice(0, a.length - MAX);
    }
    _list = a; _saveLS(); _saveFile(); _notifyChanged();
    return r;
  };
  // ★ 2026-08-31 다른 계정 데이터 정리용 — 기존 _saveLS/_saveFile 패턴 재사용
  Reminders.clearAll = async function () {
    _list = [];
    _saveLS();
    try { await _saveFile(); } catch (e) {}
    _notifyChanged();
  };
  Reminders.remove = function (id) {
    _list = _load().filter(function (r) { return r.id !== id; });
    _saveLS(); _saveFile(); _notifyChanged();
  };
  // 완료 토글 (반복이면 그 회차만)
  Reminders.toggleDone = function (id, occDate) {
    var r = Reminders.get(id);
    if (!r) return;
    if (r.repeat && r.repeat !== 'none') {
      r.doneDates = Array.isArray(r.doneDates) ? r.doneDates : [];
      var i = r.doneDates.indexOf(occDate);
      if (i >= 0) r.doneDates.splice(i, 1); else r.doneDates.push(occDate);
    } else {
      r.done = !r.done;
    }
    r.updatedAt = Date.now();
    _saveLS(); _saveFile(); _notifyChanged();
  };

  /* ── 알림 예약 목록 (notify.js 가 가져다 씀) ──
     반복은 무한히 예약할 수 없다(안드로이드 예약 개수 한도).
     → 앞으로 MAX_OCC(8)회분만 예약하고, 앱을 열 때 Notify.refresh()가 다시 채운다. */
  var MAX_OCC = 8;
  Reminders.pendingNotifications = function (horizonMs) {
    var out = [];
    var now = Date.now();
    var horizon = now + (horizonMs || 60 * 24 * 60 * 60 * 1000);
    _load().forEach(function (r) {
      if (!r.time) return;                       // 시간이 없으면 알릴 시점이 없다
      if (typeof r.lead !== 'number' || r.lead < 0) return;   // '알림 없음'
      var dates = _futureDates(r, now, horizon, MAX_OCC);
      dates.forEach(function (ds) {
        var at = _parseAt(ds, r.time);
        if (!at) return;
        var fireAt = at.getTime() - r.lead * 60000;
        if (fireAt <= now + 30000 || fireAt > horizon) return;
        out.push({
          key: 'rem_' + r.id + '_' + ds,
          title: '🔔 ' + (r.title || '리마인더'),
          body: (r.lead > 0)
            ? (r.time + ' · ' + Reminders.leadLabel(r.lead) + (r.memo ? ' — ' + r.memo : ''))
            : (r.time + (r.memo ? ' — ' + r.memo : '')),
          at: new Date(fireAt)
        });
      });
    });
    return out;
  };
  function _futureDates(r, now, horizon, limit) {
    var res = [];
    var rep = r.repeat || 'none';
    if (rep === 'none') {
      if (!r.done) res.push(r.date);
      return res;
    }
    var base = new Date(+r.date.slice(0, 4), +r.date.slice(5, 7) - 1, +r.date.slice(8, 10));
    var cur = new Date(Math.max(base.getTime(), now - 24 * 3600 * 1000));
    // 시작일 기준으로 맞춰 이동
    if (rep === 'weekly') {
      while (cur.getDay() !== base.getDay()) cur.setDate(cur.getDate() + 1);
      for (var i = 0; i < limit; i++) {
        var ds = cur.getFullYear() + '-' + _p2(cur.getMonth() + 1) + '-' + _p2(cur.getDate());
        if (cur.getTime() > horizon) break;
        if (!(Array.isArray(r.doneDates) && r.doneDates.indexOf(ds) >= 0)) res.push(ds);
        cur.setDate(cur.getDate() + 7);
      }
    } else if (rep === 'monthly') {
      var dd = +r.date.slice(8, 10);
      var y = cur.getFullYear(), mo = cur.getMonth();
      for (var j = 0; j < limit; j++) {
        var dim = new Date(y, mo + 1, 0).getDate();
        if (dd <= dim) {
          var d2 = new Date(y, mo, dd);
          var ds2 = y + '-' + _p2(mo + 1) + '-' + _p2(dd);
          if (d2.getTime() > horizon) break;
          if (d2.getTime() >= now - 24 * 3600 * 1000 &&
              !(Array.isArray(r.doneDates) && r.doneDates.indexOf(ds2) >= 0)) res.push(ds2);
        }
        mo++; if (mo > 11) { mo = 0; y++; }
      }
    }
    return res;
  }
  function _parseAt(dateStr, timeStr) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
    var t = /^(\d{1,2}):(\d{2})/.exec(String(timeStr || ''));
    if (!m || !t) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3], +t[1], +t[2], 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }

  // 폴더가 늦게 연결되는 경우가 있어 잠시 뒤 한 번 읽어본다
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () { try { Reminders.loadFromFolder(); } catch (e) {} }, 3000);
  });
})();
