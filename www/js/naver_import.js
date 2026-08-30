/* ═══════════════════════════════════════════════
   naver_import.js — 네이버 캘린더(.ics) 일회성 가져오기
   - 사진 없는 로컬 작업(work)으로 변환해 저장 (openQuickWorkAdd와 동일한 방식)
   - 로그인/클라우드 불필요, 저장 폴더만 연결되어 있으면 동작
   - Claude AI(설정에 API 키 등록 시)로 제목/설명/장소를 분석해
     동호수/전화번호/주소/작업대상/가격을 자동으로 채움
   - AI 키가 없거나 분석 실패 시 안전한 고정 규칙으로 대체:
     작업명(apt)="네이버 일정" 고정, 동호수(unit)=캘린더 제목, 나머지=메모
═══════════════════════════════════════════════ */
(function () {
  'use strict';

  var DEDUPE_KEY = 'ac_naver_import_uids_v1';

  function _pad(n) { return String(n).padStart(2, '0'); }

  /* ── 재가져오기 시 중복 생성 방지 ── */
  function _loadImportedKeys() {
    try { return JSON.parse(localStorage.getItem(DEDUPE_KEY) || '[]'); } catch (e) { return []; }
  }
  function _saveImportedKeys(arr) {
    try { localStorage.setItem(DEDUPE_KEY, JSON.stringify(arr)); } catch (e) {}
  }

  /* ══════════════════════════════════════════
     ICS 파서 (RFC5545 최소 구현: VEVENT만 처리, RRULE 반복은 미지원)
  ══════════════════════════════════════════ */
  function unfoldLines(text) {
    var raw = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var line = raw[i];
      if ((line.charAt(0) === ' ' || line.charAt(0) === '\t') && out.length) {
        out[out.length - 1] += line.slice(1);
      } else {
        out.push(line);
      }
    }
    return out;
  }

  function unescapeText(s) {
    return String(s || '')
      .replace(/\\n/gi, '\n')
      .replace(/\\,/g, ',')
      .replace(/\\;/g, ';')
      .replace(/\\\\/g, '\\');
  }

  function splitLine(line) {
    var colonIdx = line.indexOf(':');
    if (colonIdx < 0) return null;
    var left = line.slice(0, colonIdx);
    var value = line.slice(colonIdx + 1);
    var parts = left.split(';');
    var key = parts[0].toUpperCase();
    var params = {};
    for (var i = 1; i < parts.length; i++) {
      var eq = parts[i].indexOf('=');
      if (eq > 0) params[parts[i].slice(0, eq).toUpperCase()] = parts[i].slice(eq + 1);
    }
    return { key: key, params: params, value: value };
  }

  // ICS 날짜/시간 → { date:'YYYY-MM-DD', time:'HH:MM' or '' }
  // 표기된 벽시계 시각을 그대로 사용(대부분 Asia/Seoul 기준), UTC(Z)만 KST로 보정
  function parseIcsDateTime(field) {
    var v = field.value.trim();
    var isUtc = /Z$/i.test(v);
    var m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var hasTime = m[4] !== undefined;
    if (!hasTime || field.params.VALUE === 'DATE') {
      return { date: y + '-' + _pad(mo) + '-' + _pad(d), time: '' };
    }
    var hh = +m[4], mm = +m[5];
    if (isUtc) {
      var dt = new Date(Date.UTC(y, mo - 1, d, hh, mm, 0));
      dt.setUTCHours(dt.getUTCHours() + 9); // UTC → KST
      return {
        date: dt.getUTCFullYear() + '-' + _pad(dt.getUTCMonth() + 1) + '-' + _pad(dt.getUTCDate()),
        time: _pad(dt.getUTCHours()) + ':' + _pad(dt.getUTCMinutes())
      };
    }
    return { date: y + '-' + _pad(mo) + '-' + _pad(d), time: _pad(hh) + ':' + _pad(mm) };
  }

  function parseIcsEvents(text) {
    var lines = unfoldLines(text);
    var events = [];
    var cur = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line) continue;
      if (/^BEGIN:VEVENT/i.test(line)) { cur = {}; continue; }
      if (/^END:VEVENT/i.test(line)) { if (cur) events.push(cur); cur = null; continue; }
      if (!cur) continue;
      var f = splitLine(line);
      if (!f) continue;
      switch (f.key) {
        case 'UID':         cur.uid = f.value.trim(); break;
        case 'SUMMARY':     cur.summary = unescapeText(f.value); break;
        case 'DESCRIPTION': cur.description = unescapeText(f.value); break;
        case 'LOCATION':    cur.location = unescapeText(f.value); break;
        case 'DTSTART':     cur.dtstart = parseIcsDateTime(f); break;
        case 'DTEND':       cur.dtend = parseIcsDateTime(f); break;
        default: break;
      }
    }
    return events;
  }

  /* ══════════════════════════════════════════
     이벤트 → 앱 작업(work) 필드 매핑 (고정 규칙 · AI 실패 시 폴백)
  ══════════════════════════════════════════ */
  function buildMemo(ev) {
    var lines = [];
    if (ev.location) lines.push('📍 ' + ev.location);
    if (ev.description) lines.push(ev.description);
    lines.push('(네이버 캘린더에서 가져옴' + (ev.summary ? ' · 원제목: ' + ev.summary : '') + ')');
    return lines.join('\n');
  }

  function toWorkFieldsFallback(ev) {
    var d = ev.dtstart || {};
    var e = ev.dtend || {};
    var unit = (ev.summary && ev.summary.trim()) ||
               (ev.description ? ev.description.split('\n')[0].trim() : '') ||
               '(제목 없음)';
    return {
      date: d.date || '',
      startTime: d.time || '',
      endTime: e.time || '',
      apt: '네이버 일정',
      unit: unit,
      target: '',
      phone: '',
      address: '',
      price: '',
      memo: buildMemo(ev)
    };
  }

  /* ══════════════════════════════════════════
     Claude AI로 제목/설명/장소 분석 → 필드 자동 채움
     (날짜/시간은 ICS 값을 그대로 신뢰 — AI에는 넘기지 않음)
  ══════════════════════════════════════════ */
  async function toWorkFieldsWithAI(ev) {
    var fallback = toWorkFieldsFallback(ev);
    try {
      var parts = [];
      if (ev.summary)     parts.push('제목: ' + ev.summary);
      if (ev.location)    parts.push('장소: ' + ev.location);
      if (ev.description) parts.push('설명: ' + ev.description);
      var text = parts.join('\n');
      if (!text.trim()) return fallback;

      var ai = await ClaudeAI.extractSchedule({ text: text });
      var out = {
        date: fallback.date, startTime: fallback.startTime, endTime: fallback.endTime,  // ICS 값 유지
        apt:     (ai.apt     && String(ai.apt).trim())     || fallback.apt,
        unit:    (ai.unit    && String(ai.unit).trim())    || fallback.unit,
        target:  (ai.target  && String(ai.target).trim())  || '',
        phone:   (ai.phone   && String(ai.phone).trim())   || '',
        address: (ai.address && String(ai.address).trim()) || '',
        price:   (ai.price && ai.price !== '0' && ai.price !== 0) ? ai.price : ''
      };
      // 메모: AI 요약 + 원본(장소·설명·원제목)은 항상 보존 (AI가 놓친 정보 대비)
      var memoParts = [];
      if (ai.memo && String(ai.memo).trim()) memoParts.push(String(ai.memo).trim());
      memoParts.push(buildMemo(ev));
      out.memo = memoParts.join('\n\n');
      return out;
    } catch (e) {
      console.warn('[네이버가져오기] AI 분석 실패, 고정 규칙으로 대체:', e && e.message);
      return fallback;
    }
  }

  /* ══════════════════════════════════════════
     로컬 작업 폴더 생성 (calendar.js openQuickWorkAdd 저장 로직과 동일)
  ══════════════════════════════════════════ */
  async function _createLocalWork(fields, seq) {
    var d = new Date();
    var base = fields.date + '_' + _pad(d.getHours()) + _pad(d.getMinutes()) + _pad(d.getSeconds()) + '-ni' + seq;
    var folderName = base, n = 1;
    while (n < 50) {
      try { await photoFolderHandle.getDirectoryHandle(folderName); folderName = base + '-' + (++n); }
      catch (e) { break; }
    }
    var sessionData = {
      version: 1,
      type: 'aircon-report',
      workId: folderName,
      workType: 'household',
      facilityCustomer: null,
      savedAt: (typeof kstIsoString === 'function') ? kstIsoString() : new Date().toISOString(),
      apt: fields.apt,
      date: fields.date,
      worker: '',
      units: [{
        name: fields.unit,
        workNum: 1,
        beforeCount: 0,
        afterCount: 0,
        beforeMeta: [],
        afterMeta: [],
        specials: [],
        customer: {
          phone: fields.phone, address: fields.address, memo: fields.memo,
          workTarget: fields.target, price: fields.price,
          startTime: fields.startTime, endTime: fields.endTime
        }
      }]
    };
    var jsonText = JSON.stringify(sessionData, null, 2);
    var dir = await photoFolderHandle.getDirectoryHandle(folderName, { create: true });
    async function writeFile(name) {
      var fh = await dir.getFileHandle(name, { create: true });
      var wr = await fh.createWritable();
      await wr.write(new Blob([jsonText], { type: 'application/json;charset=utf-8' }));
      await wr.close();
    }
    await writeFile('_session.json');
    try { await writeFile('report_' + folderName + '.acreport.json'); } catch (e) {}
    try {
      if (typeof scheduleIndexUpdate === 'function' && typeof sessionToIndexEntry === 'function') {
        var ie = sessionToIndexEntry(folderName, sessionData);
        if (ie) scheduleIndexUpdate(ie);
      }
    } catch (e) {}
  }

  /* ══════════════════════════════════════════
     가져오기 실행
  ══════════════════════════════════════════ */
  async function importIcsText(text) {
    var events = parseIcsEvents(text);
    if (!events.length) {
      if (typeof showToast === 'function') showToast('일정을 찾을 수 없습니다 (.ics 파일을 확인해주세요)', 'err');
      else alert('일정을 찾을 수 없습니다');
      return;
    }
    if (typeof photoFolderHandle === 'undefined' || !photoFolderHandle) {
      if (typeof showToast === 'function') showToast('먼저 설정에서 저장 폴더를 연결해주세요', 'err');
      else alert('먼저 저장 폴더를 연결해주세요');
      return;
    }
    if (typeof requestFolderPermissionSafe === 'function') {
      try { await requestFolderPermissionSafe('readwrite'); } catch (e) {}
    }

    /* Claude AI 자동분석 사용 여부. 없으면 고정 규칙으로 폴백한다.
       ★ 2026-08-24 여기에 사용량 게이트가 빠져 있었다.
         extractSchedule() 은 안에서 consumeAI('sched') 로 차감까지 하는데,
         이 경로만 gateAI() 를 안 거쳐 **잔량이 0이어도 AI 호출이 그대로 나갔다**.
         무료 횟수를 로그인 계정 지급으로 바꾼 뒤에는 이게 게이트를 통째로 우회하는 구멍이 된다.
         → 잔량이 없으면 조용히 고정 규칙 폴백으로 내린다(가져오기 자체는 그대로 동작한다). */
    var useAI = !!(window.ClaudeAI && ClaudeAI.extractSchedule);
    function _aiQuotaLeft() {
      try { return !window.Subs || !Subs.canUseAI || Subs.canUseAI('sched').ok; } catch (e) { return true; }
    }
    if (useAI && !_aiQuotaLeft()) useAI = false;

    var importedKeys = _loadImportedKeys();
    var seen = {};
    importedKeys.forEach(function (k) { seen[k] = 1; });

    var added = 0, skipped = 0, failed = 0;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (!ev.dtstart || !ev.dtstart.date) { skipped++; continue; }
      var key = ev.uid || ((ev.summary || '') + '|' + ev.dtstart.date + '|' + ev.dtstart.time);
      if (seen[key]) { skipped++; continue; }
      if (typeof showOverlay === 'function') {
        showOverlay(useAI
          ? ('AI로 분석 중... (' + (i + 1) + '/' + events.length + ')')
          : ('가져오는 중... (' + (i + 1) + '/' + events.length + ')'));
      }
      try {
        // ★ 여러 건을 한 번에 가져오면 중간에 잔량이 바닥날 수 있다 → 회차마다 확인
        var fields = (useAI && _aiQuotaLeft()) ? await toWorkFieldsWithAI(ev) : toWorkFieldsFallback(ev);
        await _createLocalWork(fields, i);
        seen[key] = 1;
        importedKeys.push(key);
        added++;
      } catch (e) {
        console.warn('[네이버가져오기] 이벤트 저장 실패', e);
        failed++;
      }
    }
    _saveImportedKeys(importedKeys);
    if (typeof hideOverlay === 'function') hideOverlay();

    try { if (typeof invalidateRecordsCache === 'function') invalidateRecordsCache(); } catch (e) {}
    try { if (typeof invalidateCustomersCache === 'function') invalidateCustomersCache(); } catch (e) {}
    try { if (typeof invalidateCustomersV2 === 'function') invalidateCustomersV2(); } catch (e) {}

    var msg = '✓ ' + added + '개 일정을 가져왔습니다' + (useAI ? ' (AI 자동분석 적용)' : '');
    if (skipped) msg += ' · 중복/날짜없음 ' + skipped + '개 건너뜀';
    if (failed)  msg += ' · 실패 ' + failed + '개';
    if (typeof showToast === 'function') showToast(msg, added ? 'ok' : 'err');
    else alert(msg);
  }

  /* ══════════════════════════════════════════
     UI 연결 (설정 화면 버튼 + 숨김 파일선택)
  ══════════════════════════════════════════ */
  function bindUI() {
    var btn = document.getElementById('btnNaverImport');
    var fileInput = document.getElementById('naverImportFile');
    if (!btn || !fileInput) { setTimeout(bindUI, 300); return; }
    if (btn.dataset.niBound) return;
    btn.dataset.niBound = '1';
    btn.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { importIcsText(String(reader.result || '')); };
      reader.onerror = function () { if (typeof showToast === 'function') showToast('파일을 읽을 수 없습니다', 'err'); };
      reader.readAsText(file, 'utf-8');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindUI);
  } else {
    bindUI();
  }

  window.NaverImport = { importIcsText: importIcsText, parseIcsEvents: parseIcsEvents };
})();
