/* ═══════════════════════════════════════════════
   CLOUD BACKUP ─ 설정/지침/학습 백업 + 작업 서버 복구 (구독자)
   - 설정/지침/학습: backups/{uid} (push/pull, 비파괴: 로컬 빈 것만 채움)
   - 작업 복구: schedules/{uid}/full/{workId}(전체 _session.json)을 로컬에 재생성
     · 비파괴: 로컬에 이미 있는 작업은 절대 건드리지 않음(없는 것만 생성)
     · 텍스트+썸네일 먼저 복구 → 원본 사진은 작업 열 때(온디맨드) 받아옴
   - 재설치 후 로그인 시 구독자에게 팝업으로 복구 여부 확인. '나중에'면 다음 실행에 재알림
   - 구독자(유료/관리자)만. 무료는 폰(로컬) 백업만.
═══════════════════════════════════════════════ */
(function () {
  'use strict';
  window.CloudBackup = window.CloudBackup || {};

  /* ★ 2026-08-17 — 업종별로 갈리는 지침과 공통 지침을 분리.
       claude_write_guide_schedule(일정 분석)은 주소·시간·금액 해석 같은 업종 무관 지식이라
       업종별 접미사를 붙이지 않는다(ai.js SHARED_CH). 따라서 PER_PROFILE_BASES 에서도 빠져야 한다.
       ⚠️ 여기서 빠뜨리면 두 번째 업종 지침이 서버 백업에서 통째로 누락된다. */
  var GUIDE_KEYS_PER_PROFILE = ['claude_blog_guideline', 'claude_write_guide_daangn', 'claude_write_guide_insta', 'claude_write_guide_facebook', 'claude_write_guide_quote'];
  var GUIDE_KEYS_SHARED = ['claude_write_guide_schedule'];
  var GUIDE_KEYS = GUIDE_KEYS_PER_PROFILE.concat(GUIDE_KEYS_SHARED);
  var LEARN_KEYS = ['ai_quote_corrections', 'ac_bizcert_corrections'];
  var CO_KEYS = ['ac_co_v2', 'ac_co_icon_v1', 'ac_docs_pricebook'];
  /* ★ 2026-08-16 — 업종(프로필)별로 갈리는 키까지 백업 대상에 넣는다.
       안 그러면 두 번째 업종부터 지침·가격표·견적학습이 서버 백업에서 통째로 빠져
       재설치 복구 때 조용히 사라진다.
       프로필 목록 자체(ac_profiles / ac_biz_list / ac_profile_current)도 백업해야
       복구된 기기에서 업종이 다시 보인다. */
  var PROFILE_KEYS = ['ac_profiles', 'ac_biz_list', 'ac_profile_current', 'ac_my_industries'];
  /* ★ 2026-08-17 'ac_pf_icon' = 업종별 이미지 아이콘(dataURL).
       업종마다 한 벌이라 Profiles.key/allKeysFor 규칙을 그대로 탄다.
       ⚠️ 빠뜨리면 재설치 복구 때 업종 아이콘만 조용히 사라진다. */
  var PER_PROFILE_BASES = GUIDE_KEYS_PER_PROFILE.concat(['ai_quote_corrections', 'ac_docs_pricebook', 'ac_pf_icon']);
  function allKeys() {
    var base = GUIDE_KEYS.concat(LEARN_KEYS).concat(CO_KEYS).concat(PROFILE_KEYS);
    try {
      if (window.Profiles && Profiles.allKeysFor) {
        PER_PROFILE_BASES.forEach(function (b) { base = base.concat(Profiles.allKeysFor(b)); });
      }
    } catch (e) {}
    return base.filter(function (v, i, a) { return v && a.indexOf(v) === i; });
  }

  function loggedIn() { return !!(window.Cloud && Cloud.ready && Cloud.user && Cloud.db); }
  function isSub() { try { return !!(window.Subs && (Subs.isAdmin() || (Subs.plan && Subs.plan() !== 'free'))); } catch (e) { return false; } }
  function uid() { return Cloud.user.uid; }
  function docRef() { return Cloud.db.collection('backups').doc(uid()); }
  function fullCol() { return Cloud.db.collection('schedules').doc(uid()).collection('full'); }
  function lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lset(k, v) { try { if (v == null) return; localStorage.setItem(k, v); } catch (e) {} }
  CloudBackup.isSub = isSub;
  function stg() { return firebase.storage(); }
  function safeId(name) { return String(name || '').replace(/[\/\.\#\$\[\]]/g, '_').slice(0, 200); }

  /* ── 네트워크 종류 판별 + Wi-Fi 대기 (복원 후 사진 자동 수신 정책) ── */
  async function _cbNetType() {
    try {
      var Net = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Network;
      if (!Net) return 'unknown';   // 플러그인 없음(웹/데스크톱) → 데이터 요금 걱정 없음으로 간주
      var st = await Net.getStatus();
      if (!st || !st.connected) return 'none';
      return st.connectionType === 'wifi' ? 'wifi'
           : st.connectionType === 'cellular' ? 'cellular'
           : 'unknown';
    } catch (e) { return 'unknown'; }
  }
  // Wi-Fi 로 바뀌면 runFn 을 한 번 실행하고 리스너 해제 (앱이 켜져 있는 동안 유효)
  var _cbWifiWaiter = null;
  function _cbWaitForWifi(runFn) {
    try {
      var Net = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Network;
      if (!Net) return;
      if (_cbWifiWaiter) { try { _cbWifiWaiter.remove(); } catch (e) {} _cbWifiWaiter = null; }
      Net.addListener('networkStatusChange', function (st) {
        if (st && st.connected && st.connectionType === 'wifi') {
          try { if (_cbWifiWaiter && _cbWifiWaiter.remove) _cbWifiWaiter.remove(); } catch (e) {}
          _cbWifiWaiter = null;
          try { runFn(); } catch (e) {}
        }
      }).then(function (h) {
        // 이미 다른 대기 등록됐으면 이건 즉시 해제(중복 방지)
        if (_cbWifiWaiter) { try { h.remove(); } catch (e) {} } else { _cbWifiWaiter = h; }
      }).catch(function () {});
    } catch (e) {}
  }

  /* ── 설정/지침/학습 백업 ── */
  //  ★ 2026-08-09: 예전엔 아래 allKeys() 목록만 올려서 일정등록 학습(ai_schedule_corrections),
  //    작업자 이름, 업종, 리마인더, 알림 설정 등이 서버 백업에서 빠져 있었다.
  //    AppData(설정 스냅샷)와 목록을 통일해 "서버에서 복구"만으로 전부 되살아나게 한다.
  function gather() {
    var d = {};
    try {
      if (window.AppData && AppData.collect) {
        var snap = AppData.collect();
        if (snap && snap.data) d = snap.data;
      }
    } catch (e) {}
    // 폴백/보강: 기존 필수 키는 무조건 포함
    allKeys().forEach(function (k) { var v = lget(k); if (v != null && v !== '') d[k] = v; });
    return d;
  }
  var _busy = false, _pending = false;
  async function push(silent) {
    if (!loggedIn()) return;  // 설정/업체정보/지침/학습은 로그인만으로 백업(구독 무관)
    if (_busy) { _pending = true; return; }
    _busy = true;
    try { await docRef().set({ data: gather(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }); }
    catch (e) { console.warn('[CloudBackup] push 실패:', e && (e.code || e.message)); }
    _busy = false;
    if (_pending) { _pending = false; setTimeout(function () { push(true); }, 500); }
  }
  async function pull() {
    if (!loggedIn()) return;
    try {
      var snap = await docRef().get();
      var d = (snap.exists && snap.data() && snap.data().data) || null;
      if (!d) { push(true); return; }
      var restored = 0;
      // ★ 서버에 올라온 모든 설정 키를 대상으로 (비어있는 것만 채움 — 비파괴)
      var noRestore = { 'ac_onboarding_done_v2': 1, 'auto_backup_saf_uri': 1 };
      /* ⭐ 2026-08-21 — 재설치 복구인데 업종이 안 살아나던 버그.
         profiles.js 의 P.ensure() 는 **스크립트 로드 시점**에 돌아서 여기보다 항상 먼저
         빈 프로필 pf_1 을 만든다. 아래 복구는 "로컬이 비었을 때만" 채우므로,
         그 빈 껍데기 때문에 ac_profiles/ac_biz_list/ac_profile_current 가 통째로 스킵됐다.
         → 껍데기(seed) 상태일 때만 이 세 키는 덮어쓴다. 사용자가 만든 업종이 있으면
           seed 표시가 이미 지워져 있으므로 예전처럼 절대 건드리지 않는다.
         ⚠️ 이게 안 되면 작업에 새겨진 옛 profileId 가 새로 만들어진 빈 pf_1 을 가리켜
            '일부 일정의 업종이 바뀌어 보이는' 2차 증상까지 생긴다. */
      var _seed = false;
      try { _seed = !!(window.Profiles && Profiles.seeded && Profiles.seeded()); } catch (e) {}
      var _pfKeys = _seed ? { 'ac_profiles': 1, 'ac_biz_list': 1, 'ac_profile_current': 1 } : {};
      var _pfRestored = 0;
      Object.keys(d).forEach(function (k) {
        if (noRestore[k]) return;
        var local = lget(k);
        var _empty = (local == null || local === '');
        if ((_empty || _pfKeys[k]) && d[k] != null && d[k] !== '') {
          lset(k, d[k]); restored++;
          if (_pfKeys[k] && !_empty) _pfRestored++;
        }
      });
      if (_seed) {
        try { if (window.Profiles && Profiles.clearSeed) Profiles.clearSeed(); } catch (e) {}
        if (_pfRestored) {
          console.log('[CloudBackup] 업종(프로필) ' + _pfRestored + '건 서버에서 복구 — 빈 초기 프로필을 덮어씀');
          try { if (window.Profiles) { Profiles.dropIconMemo && Profiles.dropIconMemo(); Profiles.refreshAutoIcons && Profiles.refreshAutoIcons(); Profiles.syncCoKey && Profiles.syncCoKey(); } } catch (e) {}
          try { if (typeof applyCustomLabels === 'function') applyCustomLabels(); } catch (e) {}
          try { if (window.ProfilesUI && ProfilesUI.renderWorkChip) ProfilesUI.renderWorkChip(); } catch (e) {}
          // 온보딩이 열려 있으면 업종 슬라이드를 즉시 다시 그린다(복구된 업종이 보이도록)
          try {
            var _om = document.getElementById('onboardingModal');
            if (_om && _om.classList.contains('open') && typeof renderOnboardingStep === 'function') renderOnboardingStep();
          } catch (e) {}
          try { if (window.__calendarRefresh) window.__calendarRefresh(); } catch (e) {}
        }
      }
      if (restored) {
        // ★ 2026-08-10: 앱 시작 시 state.js init()이 ac_co_v2/ac_co_icon_v1을 이미
        //   폼(coName 등 input.value)과 coIconData 변수에 '한 번' 읽어 캐시해 둔 뒤라서,
        //   pull()이 여기서 localStorage만 복구해도 화면/변수는 그 이전의 빈 값 그대로였다.
        //   이 상태에서 사용자가 업체정보를 저장(saveCoInfo)하면 화면의 빈 값이 그대로
        //   다시 저장되어 방금 복구한 값을 덮어써 지워버리고, 다음 실행 때 또 "복구"가
        //   뜨는 게 무한 반복됐다. 복구 직후 폼/변수를 서버 값으로 다시 채워 이 경합을 끊는다.
        try {
          var ci = JSON.parse(lget(CO_KEYS[0]) || '{}');
          ['coName','coBrand','coTel','coBiz','coAddr','coEmail','coWeb','coDesc','coBank','coCeo','coReportTitle','coUnitLabel','coStageLabel','coIndustryMajor','coIndustryMinor'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el && !el.value && ci[id]) el.value = ci[id];
          });
        } catch (e) {}
        try { if (typeof coIconData !== 'undefined' && !coIconData) { var ic = lget(CO_KEYS[1]); if (ic) coIconData = ic; } } catch (e) {}
        try { if (typeof updateCoHdrBtn === 'function') updateCoHdrBtn(); } catch (e) {}
        try { if (typeof applyCoIcon === 'function') applyCoIcon(); } catch (e) {}
        try { if (typeof applyCustomLabels === 'function') applyCustomLabels(); } catch (e) {}
        try { if (window.Subs && Subs.renderSettings) Subs.renderSettings(); } catch (e) {}
        // ★ 사용자 요청(2026-08-10): 정상 동작(비어있는 설정 채움)이라 알릴 필요 없음 — 콘솔에만 남김
        console.log('[CloudBackup] 설정·지침·학습 ' + restored + '건 복구(무음)');
      }
      push(true);
    } catch (e) { console.warn('[CloudBackup] pull 실패:', e && (e.code || e.message)); }
  }
  CloudBackup.pull = pull; CloudBackup.push = push;
  // ★ 2026-09-02: 계정전환 시 '이전 데이터 삭제'(cloud.js _purgeMismatchedLocalData)가
  //   업종/업체정보까지 함께 지울 수 있도록, 백업 대상 키 목록을 그대로 노출한다.
  //   (새 삭제 목록을 따로 만들지 않고 이미 검증된 정의를 재사용 — 빠뜨림 방지)
  CloudBackup.allKeys = allKeys;
  var _t = null;
  CloudBackup.onChanged = function () { if (!loggedIn()) return; clearTimeout(_t); _t = setTimeout(function () { push(true); }, 1500); };

  /* ── 작업 서버 복구 ── */
  var _dismissedThisRun = false;
  var _restoreBusy = false;

  async function localFolderNames() {
    var set = {};
    try {
      if (typeof photoFolderHandle !== 'undefined' && photoFolderHandle) {
        for await (var e of photoFolderHandle.values()) { if (e.kind === 'directory' && /^\d{4}-\d{2}-\d{2}/.test(e.name)) set[e.name] = 1; }
      }
    } catch (e) {}
    return set;
  }
  async function serverFullList() {
    var out = [];
    try {
      var snap = await fullCol().get();
      snap.forEach(function (doc) { var v = doc.data() || {}; out.push({ id: doc.id, workId: v.workId || doc.id, date: v.date || '', json: v.json || '', trashedAt: v.trashedAt || null }); });
    } catch (e) { console.warn('[CloudBackup] full 목록 실패', e && e.code); }
    return out;
  }
  function sessionHasPhotos(sess) {
    try { return ((sess && sess.units) || []).some(function (u) { return ((u.beforeCount || 0) + (u.afterCount || 0)) > 0 || ((u.specials || []).some(function (sp) { return (sp.photoCount || 0) > 0; })); }); } catch (e) { return false; }
  }

  // 비파괴 복구: 로컬에 없는 작업만 폴더+_session.json 생성. 반환 {done, infos:[{workId,date,hasPhotos,session}]}
  async function restoreWorks(missing, prog) {
    if (typeof photoFolderHandle === 'undefined' || !photoFolderHandle) throw new Error('저장 폴더가 연결되지 않았습니다');
    var done = 0, infos = [];
    for (var i = 0; i < missing.length; i++) {
      var w = missing[i];
      try {
        if (!w.workId || !w.json) { if (prog) prog(i + 1, missing.length); continue; }
        var dir = await photoFolderHandle.getDirectoryHandle(w.workId, { create: true });
        var exists = false;
        try { await dir.getFileHandle('_session.json', { create: false }); exists = true; } catch (e) {}
        var sess = null; try { sess = JSON.parse(w.json); } catch (e) {}
        var hasP = sessionHasPhotos(sess);
        if (!exists) {  // ★ 비파괴: 이미 있으면 절대 덮어쓰지 않음
          var fh = await dir.getFileHandle('_session.json', { create: true });
          var ww = await fh.createWritable(); await ww.write(w.json); await ww.close();
          done++;
          if (hasP) { try { var mk = await dir.getFileHandle('_cloudPhotos', { create: true }); var mw = await mk.createWritable(); await mw.write('1'); await mw.close(); } catch (e) {} }
        }
        infos.push({ workId: w.workId, date: w.date || String(w.workId).slice(0, 10), hasPhotos: hasP, session: sess });
      } catch (e) { console.warn('[CloudBackup] 복구 실패', w.workId, e && (e.code || e.message)); }
      if (prog) prog(i + 1, missing.length);
    }
    return { done: done, infos: infos };
  }

  // 한 작업의 원본 사진을 서버(Storage)에서 로컬 work폴더로 다운로드 (비파괴). 반환 got
  // ── 이 작업(같은 날짜)에서 로컬에 이미 존재하는 사진 파일명 전부 수집 ──
  //    세션 폴더 + 같은 날짜의 형제 폴더(날짜_시간 / 날짜 로 갈려 흩어진 경우)의 work*/ 를 모두 훑음
  //    → "이미 받아둔 사진"을 파악해 재다운로드(중복 생성)를 막고, 변경/추가된 사진만 받게 함
  async function _collectLocalPhotoNames(dateDir, session, ownOnly) {
    var names = Object.create(null);
    var baseDate = String((session && session.date) || dateDir.name || '').slice(0, 10);
    async function scanWorkDirs(pd) {
      try {
        for await (var ent of pd.values()) {
          if (ent.kind === 'directory' && /^work\d+/i.test(ent.name)) {
            try { for await (var f of ent.values()) { if (f.kind === 'file' && /\.(jpe?g|png|webp)$/i.test(f.name)) names[f.name] = 1; } } catch (e) {}
          }
        }
      } catch (e) {}
    }
    await scanWorkDirs(dateDir);
    // ★★ 2026-08-09 치명 버그 수정 ★★
    //   파일명이 A_image01.jpg 처럼 폴더 간 겹친다. 예전엔 같은 날짜 형제 폴더를 전부 훑어
    //   "이미 있음"으로 판정 → 남의 작업에 같은 이름 파일이 있으면 내 사진을 영영 안 받았다.
    //   ("서버에서 복구했는데 전부 있다고 넘어감"의 원인)
    //   이제 형제 폴더는 _session.json 의 workId 가 같을 때만 인정한다.
    //   ownOnly=true 면 형제 폴더를 아예 보지 않는다(강제 재다운로드용).
    if (!ownOnly && typeof photoFolderHandle !== 'undefined' && photoFolderHandle && baseDate) {
      var myId = (session && session.workId) || '';
      try {
        for await (var sib of photoFolderHandle.values()) {
          if (sib.kind !== 'directory' || sib.name === dateDir.name) continue;
          if (sib.name !== baseDate && sib.name.indexOf(baseDate) !== 0) continue;
          var sameWork = false;
          try {
            var sfh = await sib.getFileHandle('_session.json');
            var sj = JSON.parse(await (await sfh.getFile()).text());
            sameWork = (myId && sj.workId) ? (String(sj.workId) === String(myId))
                     : (String(sj.apt || '') === String((session && session.apt) || '') &&
                        String(sj.date || '') === String((session && session.date) || ''));
          } catch (e) { sameWork = true; }   // _session.json 없음 = 순수 사진 폴더 → 인정
          if (sameWork) await scanWorkDirs(sib);
        }
      } catch (e) {}
    }
    return names;
  }

  // 기존 폴더(work01 / work1 어느 쪽이든)를 찾고, 없으면 work01 형식으로 만든다
  async function _openWorkDir(dateDir, n) {
    var padded = 'work' + String(n).padStart(2, '0');
    for (var i = 0; i < 2; i++) {
      var nm = i === 0 ? padded : ('work' + n);
      try { return await dateDir.getDirectoryHandle(nm, { create: false }); } catch (e) {}
    }
    return await dateDir.getDirectoryHandle(padded, { create: true });
  }

  async function downloadWorkPhotos(dateDir, session, opts) {
    opts = opts || {};
    var workId = dateDir.name;
    var metas = [];
    try {
      var snap = await Cloud.db.collection('schedules').doc(uid()).collection('items').doc(safeId(workId)).collection('photos').get();
      snap.forEach(function (d) { var v = d.data() || {}; if (v.storagePath && !v.addedBy) metas.push(v); });  // ★ 내 사진만(상대 기여 addedBy 제외 - 공유동기화가 처리)
    } catch (e) { console.warn('[CloudBackup] 사진 메타 실패', workId, e && e.code); return 0; }
    if (!metas.length) { try { await dateDir.removeEntry('_cloudPhotos'); } catch (e) {} return 0; }  // 서버에 사진 없음(예: 백업 전 작업)
    // ★ 로컬(형제 폴더 포함)에 이미 있는 사진은 건너뜀 → 변경/추가된 사진만 다운로드
    var localNames = await _collectLocalPhotoNames(dateDir, session);
    var pending = metas.filter(function (m) { return !(m.fname && localNames[m.fname]); });
    if (!pending.length) {
      // ★ 마커는 '진짜로 다 받았을 때'만 지운다. 오판으로 지우면 이후 영구히 복구 불가.
      if (!opts.keepMarker) { try { await dateDir.removeEntry('_cloudPhotos'); } catch (e) {} }
      return 0;
    }
    var unitNum = {};
    ((session && session.units) || []).forEach(function (u, i) { unitNum[u.name || ''] = parseInt(String(u.workNum || (i + 1)), 10) || (i + 1); });
    // ★ 호수명이 바뀐 경우 이름 매칭이 실패해 전부 work01 로 몰리던 문제 →
    //   서버 메타의 workNum 을 우선 사용하고, 없을 때만 이름으로 찾는다.
    function _numFor(m) {
      var n = parseInt(String(m && m.workNum), 10);
      if (n > 0) return n;
      n = unitNum[(m && m.unitName) || ''];
      return (n > 0) ? n : 1;
    }
    var got = 0;
    for (var i = 0; i < pending.length; i++) {
      var m = pending[i];
      try {
        var wn = _numFor(m);
        // ★ folder.js 는 work01 형식으로 만든다. 예전엔 'work'+1='work1' 로 만들어
        //   같은 호수 사진이 work01 / work1 두 폴더로 쪼개졌다.
        var workDir = await _openWorkDir(dateDir, wn);
        var have = false;
        try { await workDir.getFileHandle(m.fname, { create: false }); have = true; } catch (e) {}
        if (!have) {
          var url = await stg().ref(m.storagePath).getDownloadURL();
          var resp = await fetch(url);
          if (resp.ok) {
            var blob = await resp.blob();
            var wfh = await workDir.getFileHandle(m.fname, { create: true });
            var w = await wfh.createWritable(); await w.write(blob); await w.close();
            got++;
          }
        }
      } catch (e) { console.warn('[CloudBackup] 사진 다운로드 실패', m && m.fname, e && e.message); }
      if (opts.onProgress) opts.onProgress(i + 1, pending.length);
    }
    try { await dateDir.removeEntry('_cloudPhotos'); } catch (e) {}
    return got;
  }

  // ── 작업 열 때 원본 사진 온디맨드 복구 (마커 없어도, 사진 있는데 로컬 폴더 없으면 서버 시도) ──
  CloudBackup.ensureWorkPhotos = async function (dateDir, session) {
    if (!loggedIn() || !isSub() || !dateDir) return;
    if (!sessionHasPhotos(session)) return;                    // 사진 없는 작업 → 스킵

    // ★ 핵심(2026-07-24 재수정): 서버 백업에서 '복구된' 작업(_cloudPhotos 마커)만 온디맨드 다운로드.
    //   일반 로컬 작업은 사용자가 직접 관리(사진 삭제 포함)하므로 절대 서버에서 되받지 않는다.
    //   (이전 '개수 기반'은 사진을 지워 로컬이 줄면 "복구 필요"로 오판해 삭제한 사진을 되살렸음)
    var marker = false;
    try { await dateDir.getFileHandle('_cloudPhotos', { create: false }); marker = true; } catch (e) {}
    if (!marker) return;   // 마커 없음 = 일반 로컬 작업 → 재다운로드 안 함(삭제 존중)

    // 복구본 → 내 백업 사진(addedBy 없음)만, 로컬(형제폴더 포함)에 없는 것만 받기
    var mine = [];
    try {
      var snap = await Cloud.db.collection('schedules').doc(uid()).collection('items').doc(safeId(dateDir.name)).collection('photos').get();
      snap.forEach(function (d) { var v = d.data() || {}; if (v.storagePath && !v.addedBy) mine.push(v); });
    } catch (e) { return; }
    if (!mine.length) { try { await dateDir.removeEntry('_cloudPhotos'); } catch (e) {} return; }

    var localNames = await _collectLocalPhotoNames(dateDir, session);
    var missing = mine.filter(function (m) { return !(m.fname && localNames[m.fname]); });
    if (!missing.length) { try { await dateDir.removeEntry('_cloudPhotos'); } catch (e) {} return; }
    if (typeof showOverlay === 'function') showOverlay('📥 사진 받는 중...');
    var got = await downloadWorkPhotos(dateDir, session, { onProgress: function (i, t) { if (typeof showOverlay === 'function') showOverlay('📥 사진 받는 중 ' + i + '/' + t); } });
    if (typeof hideOverlay === 'function') hideOverlay();
    console.log('[CloudBackup] 온디맨드 사진(복구본) ' + got);
  };

  /* ══════════════════════════════════════════════════
     강제 재다운로드 — 유실 복구용 (2026-08-09)
     · _cloudPhotos 마커를 요구하지 않는다
     · '이미 있음' 판정을 이 작업 폴더 안으로만 한정 (형제 폴더 무시)
     · 사용자가 명시적으로 요청했을 때만 호출할 것 (삭제 존중 원칙의 예외)
  ══════════════════════════════════════════════════ */
  CloudBackup.redownloadWork = async function (dateDir, session, opts) {
    opts = opts || {};
    if (!loggedIn()) return { skipped: '로그인 필요' };
    if (!isSub()) return { skipped: '구독 필요' };
    if (!dateDir) return { skipped: '폴더 없음' };
    var mine = [];
    try {
      var snap = await Cloud.db.collection('schedules').doc(uid())
        .collection('items').doc(safeId(dateDir.name)).collection('photos').get();
      snap.forEach(function (d) { var v = d.data() || {}; if (v.storagePath && !v.addedBy) mine.push(v); });
    } catch (e) { return { error: (e && e.code) || '메타 조회 실패' }; }
    if (!mine.length) return { server: 0, got: 0 };

    var localNames = await _collectLocalPhotoNames(dateDir, session, true);   // ★ 내 폴더만
    var missing = mine.filter(function (m) { return !(m.fname && localNames[m.fname]); });
    if (!missing.length) return { server: mine.length, got: 0 };

    var unitNum = {};
    ((session && session.units) || []).forEach(function (u, i) {
      unitNum[u.name || ''] = parseInt(String(u.workNum || (i + 1)), 10) || (i + 1);
    });
    var got = 0, failed = 0, unmatched = 0;
    for (var i = 0; i < missing.length; i++) {
      var m = missing[i];
      try {
        var wn = parseInt(String(m.workNum), 10);
        if (!(wn > 0)) wn = unitNum[m.unitName || ''] || 0;
        if (!(wn > 0)) {
          // 호수명이 바뀌어 서버 메타의 unitName 과 안 맞음 → work01 에 몰아넣지 말고 건너뛴다
          unmatched++; if (opts.onProgress) opts.onProgress(i + 1, missing.length); continue;
        }
        var workDir = await _openWorkDir(dateDir, wn);
        var have = false;
        try { await workDir.getFileHandle(m.fname, { create: false }); have = true; } catch (e) {}
        if (!have) {
          var url = await stg().ref(m.storagePath).getDownloadURL();
          var resp = await fetch(url);
          if (resp.ok) {
            var blob = await resp.blob();
            var wfh = await workDir.getFileHandle(m.fname, { create: true });
            var w = await wfh.createWritable(); await w.write(blob); await w.close();
            got++;
          } else failed++;
        }
      } catch (e) { failed++; console.warn('[CloudBackup] 재다운로드 실패', m && m.fname, e && e.message); }
      if (opts.onProgress) opts.onProgress(i + 1, missing.length);
    }
    return { server: mine.length, missing: missing.length, got: got, failed: failed, unmatched: unmatched };
  };

  // ── 이번 달 사진 백그라운드 다운로드(복구 직후) ──
  //   · Wi-Fi         → 곧바로 백그라운드 수신
  //   · 모바일 데이터 → 안내 후 [지금 받기] / [Wi-Fi에서 받기(대기)] 선택
  //   · 오프라인      → Wi-Fi 연결되면 자동 수신
  async function bgDownloadCurrentMonth(infos) {
    /* ⚠️★ 2026-08-24 여기에 구독 확인이 없었다.
         복구를 무료 로그인에 개방하면서 이 함수가 무료 계정에서도 돌게 되는데,
         그러면 사진까지 받아가 '사진은 구독' 경계가 무너진다. 복구 직후 호출되는 경로(2곳)라 반드시 막아야 한다. */
    if (!loggedIn() || !isSub()) return;
    if (typeof photoFolderHandle === 'undefined' || !photoFolderHandle) return;
    var ym = (typeof kstDateStr === 'function' ? kstDateStr() : (function () { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01'; })()).slice(0, 7);
    var cur = (infos || []).filter(function (w) { return w.hasPhotos && String(w.date || w.workId || '').slice(0, 7) === ym; });
    if (!cur.length) return;

    // 실제 수신 루틴
    var _running = false;
    async function runDownload() {
      if (_running) return; _running = true;
      if (typeof showToast === 'function') showToast('📥 이번 달 사진을 백그라운드로 받는 중… (' + cur.length + '개 작업)', 'ok');
      var total = 0;
      for (var i = 0; i < cur.length; i++) {
        try {
          var dir = await photoFolderHandle.getDirectoryHandle(cur[i].workId, { create: false });
          total += await downloadWorkPhotos(dir, cur[i].session, {});
          try { if (window.__calendarRefresh) window.__calendarRefresh(); } catch (e) {}
        } catch (e) { console.warn('[CloudBackup] 이번달 사진 실패', cur[i].workId, e && e.message); }
      }
      if (typeof showToast === 'function') showToast('✓ 이번 달 사진 ' + total + '장 받기 완료 (나머지는 작업 열 때 받아옴)', 'ok');
      try { if (window.__calendarRefresh) window.__calendarRefresh(); } catch (e) {}
    }

    var net = await _cbNetType();
    if (net === 'cellular') {
      var ok = false;
      try {
        ok = confirm('📷 이번 달 작업 사진(' + cur.length + '개 작업)을 받아야 합니다.\n\n지금 모바일 데이터로 받을까요?\n\n· [확인] 지금 데이터로 받기\n· [취소] Wi-Fi 연결되면 자동으로 받기');
      } catch (e) { ok = false; }
      if (ok) {
        runDownload();
      } else {
        if (typeof showToast === 'function') showToast('📶 Wi-Fi 연결되면 이번 달 사진을 자동으로 받을게요', 'ok');
        _cbWaitForWifi(runDownload);
      }
    } else if (net === 'none') {
      // 오프라인 → Wi-Fi 연결 대기
      if (typeof showToast === 'function') showToast('📶 Wi-Fi 연결되면 이번 달 사진을 자동으로 받을게요', 'ok');
      _cbWaitForWifi(runDownload);
    } else {
      // wifi / unknown(웹·데스크톱) → 바로 받기
      runDownload();
    }
  }

  function _bupEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function _bupParse(w){ try { return JSON.parse(w.json); } catch (e) { return {}; } }
  function _bupFields(sess){
    sess = sess || {};
    var isFac = (sess.workType === 'facility');
    var fc = sess.facilityCustomer || {};
    var u0 = (sess.units && sess.units[0] && sess.units[0].customer) ? sess.units[0].customer : {};
    var c = isFac ? fc : u0;
    return {
      isFac: isFac,
      apt: sess.apt || '',
      unit: (!isFac && sess.units && sess.units[0]) ? (sess.units[0].name || '') : '',
      date: sess.date || '',
      endDate: sess.endDate || '',
      worker: sess.worker || '',
      target: c.workTarget || '',
      phone: c.phone || '',
      addr: c.address || '',
      price: (c.price == null ? '' : c.price),
      start: c.startTime || '',
      end: c.endTime || '',
      memo: c.memo || '',
      photos: ((sess.units || []).reduce(function (s, u) { return s + (u.beforeCount || 0) + (u.afterCount || 0); }, 0)),
      units: (sess.units || []).length
    };
  }

  // 서버에서 완전 삭제: full 백업 + items 요약 + 사진 메타/원본(Storage)
  async function serverPurgeWork(w) {
    var fid = w.id || safeId(w.workId);
    var wid = w.workId || w.id;
    try { await fullCol().doc(fid).delete(); } catch (e) { console.warn('[CloudBackup] full 삭제 실패', e && e.code); }
    try {
      var itemRef = Cloud.db.collection('schedules').doc(uid()).collection('items').doc(safeId(wid));
      var psnap = await itemRef.collection('photos').get();
      var dels = [];
      psnap.forEach(function (d) {
        var v = d.data() || {};
        if (v.storagePath && !v.addedBy) { try { dels.push(stg().ref(v.storagePath).delete().catch(function () {})); } catch (e) {} }
        dels.push(d.ref.delete().catch(function () {}));
      });
      await Promise.all(dels);
      try { await itemRef.delete(); } catch (e) { console.warn('[서버백업] 항목 삭제 실패:', e && (e.code || e.message)); }
    } catch (e) { console.warn('[CloudBackup] items/photos 삭제 실패', e && e.code); }
    try { localStorage.removeItem('cloudFullHash_' + uid() + '_' + fid); } catch (e) {}
  }

  // 서버 백업 작업 상세 (작업 수정 화면과 동일 포맷, 읽기 전용)
  function showBackupWorkDetail(w, onRestore) {
    var f = _bupFields(_bupParse(w));
    var roStyle = 'width:100%;margin-top:4px;background:var(--sf2,#f0f3fa);color:var(--tx);';
    function fld(label, val) {
      return '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">' + label + '</label>' +
        '<input class="cust-inp" type="text" value="' + _bupEsc(val) + '" readonly style="' + roStyle + '"></div>';
    }
    var aptRow;
    if (f.isFac) {
      aptRow = fld('작업명(현장)', f.apt);
    } else {
      aptRow = '<div style="display:flex;gap:8px;">' +
        '<div style="flex:2;">' + fld('작업명(현장)', f.apt) + '</div>' +
        '<div style="flex:1;">' + fld('동호수', f.unit) + '</div>' +
      '</div>';
    }
    var html =
      '<div style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:3300;display:flex;align-items:center;justify-content:center;padding:16px;" id="bupDetailOv">' +
        '<div style="background:var(--sf);border-radius:14px;padding:20px;max-width:460px;width:100%;max-height:calc(100vh - 44px);overflow-y:auto;-webkit-overflow-scrolling:touch;">' +
          '<div style="font-size:16px;font-weight:800;margin-bottom:4px;">🗑 삭제된 작업 · 서버 백업</div>' +
          '<div style="font-size:12px;color:var(--mu);margin-bottom:8px;">' + _bupEsc(f.apt || '작업') + '</div>' +
          '<div style="font-size:11px;color:var(--mu);background:var(--sf2,#f0f3fa);border-radius:6px;padding:6px 8px;margin-bottom:12px;">🔒 미리보기 전용 · 수정 불가 · 복구하면 이 기기에 다시 저장됩니다' + (f.photos ? (' (📷 ' + f.photos + '장은 복구 후 받아옴)') : '') + '</div>' +
          '<div style="display:flex;flex-direction:column;gap:10px;">' +
            '<div style="display:flex;gap:8px;">' +
              '<div style="flex:1;">' + fld('작업일자', f.date) + '</div>' +
              '<div style="flex:1;">' + fld('작업자', f.worker) + '</div>' +
            '</div>' +
            aptRow +
            fld('작업대상', f.target) +
            fld('전화번호', f.phone) +
            fld('주소', f.addr) +
            fld('가격 (원)', String(f.price)) +
            '<div style="display:flex;gap:8px;">' +
              '<div style="flex:1;">' + fld('시작시간', f.start) + '</div>' +
              '<div style="flex:1;">' + fld('종료시간', f.end) + '</div>' +
            '</div>' +
            (f.endDate ? fld('종료일', f.endDate) : '') +
            '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">메모</label>' +
              '<textarea class="cust-memo" rows="2" readonly style="' + roStyle + '">' + _bupEsc(f.memo) + '</textarea></div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;margin-top:14px;">' +
            '<button class="btn b-blue" id="bupDetailRestore" style="flex:1;justify-content:center;">♻️ 복구</button>' +
            '<button class="btn b-ghost" id="bupDetailCancel">취소</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    var wrap = document.createElement('div'); wrap.innerHTML = html;
    var node = wrap.firstElementChild;
    document.body.appendChild(node);
    var close = function () { if (node && node.parentNode) node.parentNode.removeChild(node); };
    node.addEventListener('click', function (e) { if (e.target === node) close(); });
    document.getElementById('bupDetailCancel').addEventListener('click', close);
    document.getElementById('bupDetailRestore').addEventListener('click', function () { close(); if (typeof onRestore === 'function') onRestore(); });
  }

  function showRestorePopup(missing) {
    if (document.getElementById('bupRestoreOv')) return;
    var ov = document.createElement('div');
    ov.id = 'bupRestoreOv';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:3200;display:flex;align-items:center;justify-content:center;padding:16px;';

    function rowsHtml() {
      return missing.map(function (w, idx) {
        var f = _bupFields(_bupParse(w));
        var title = f.apt || w.workId || '(현장 미상)';
        var sub = (w.date || f.date || '');
        if (f.worker) sub += ' · ' + f.worker;
        if (f.photos) sub += ' · 📷 ' + f.photos + '장';
        return '<div style="background:var(--sf2,#f0f3fa);border-radius:9px;padding:11px 12px;margin-bottom:8px;">' +
            '<div class="bupRowInfo" data-idx="' + idx + '" style="cursor:pointer;">' +
              '<div style="font-size:14px;font-weight:700;color:var(--tx);">' + _bupEsc(title) + ' <span style="font-size:11px;font-weight:400;color:var(--ac);">자세히 ›</span></div>' +
              '<div style="font-size:11px;color:var(--mu);margin-top:2px;">' + _bupEsc(sub) + '</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px;margin-top:9px;">' +
              '<button class="btn b-blue b-xs bupRestore" data-idx="' + idx + '" style="flex:1;justify-content:center;">♻️ 복구</button>' +
              '<button class="btn b-ghost b-xs bupPurge" data-idx="' + idx + '" style="flex:1;justify-content:center;color:var(--dn,#e5484d);">🗑 서버삭제</button>' +
            '</div>' +
          '</div>';
      }).join('');
    }

    /* ★ 2026-08-24 무료 계정 안내.
         작업 기록 복구는 로그인만으로 되지만 **사진은 구독 전용**이다.
         목록에 '📷 12장'이 그대로 보이므로, 안내가 없으면 사진까지 돌아올 것으로 오해한다.
         사진이 있는 작업이 하나라도 있을 때만 띄운다(사진 없는 사람에겐 무의미한 안내). */
    function freeNoteHtml() {
      try {
        if (isSub()) return '';
        var anyPhoto = missing.some(function (w) { return (_bupFields(_bupParse(w)).photos || 0) > 0; });
        if (!anyPhoto) return '';
        return '<div style="background:var(--sf2,#f0f3fa);border:1px solid var(--bd,#dde3ee);border-radius:9px;' +
                 'padding:11px 12px;margin-bottom:12px;text-align:left;">' +
                 '<div style="font-size:12px;color:var(--tx);line-height:1.65;">' +
                   '📄 <b>작업 기록·고객정보·글</b>은 복구됩니다.<br>' +
                   '<span style="color:var(--mu);">사진 복구는 구독 사용자만 가능해요.</span>' +
                 '</div>' +
                 '<button class="btn b-ghost b-xs" id="bupSeePlans" style="margin-top:8px;padding:5px 10px;">구독 보기 ›</button>' +
               '</div>';
      } catch (e) { return ''; }
    }

    function render() {
      if (!missing.length) { ov.remove(); return; }
      ov.innerHTML = '<div style="background:var(--sf);border-radius:14px;padding:20px;max-width:420px;width:100%;max-height:86vh;display:flex;flex-direction:column;">' +
          '<div style="text-align:center;">' +
            '<div style="font-size:30px;">☁️</div>' +
            '<div style="font-size:16px;font-weight:800;margin:4px 0 6px;">서버에 백업된 작업</div>' +
            '<div style="font-size:12px;color:var(--mu);line-height:1.6;margin-bottom:14px;">이 기기에 없는 작업 <b style="color:var(--tx);">' + missing.length + '개</b>가 서버에 있어요.<br>복구할 항목을 고르거나, 필요 없으면 서버에서 삭제하세요.</div>' +
          '</div>' +
          freeNoteHtml() +
          '<div style="overflow-y:auto;-webkit-overflow-scrolling:touch;flex:1;min-height:60px;">' + rowsHtml() + '</div>' +
          '<div style="display:flex;gap:8px;margin-top:12px;">' +
            '<button class="btn b-ghost" id="bupLater" style="flex:1;justify-content:center;">나중에</button>' +
            '<button class="btn b-blue" id="bupAll" style="flex:1;justify-content:center;">전체 복구</button>' +
          '</div>' +
        '</div>';
      bind();
    }

    function bind() {
      ov.querySelector('#bupLater').onclick = function () { _dismissedThisRun = true; ov.remove(); };
      // ★ 2026-08-24 무료 안내의 '구독 보기'
      var _sp = ov.querySelector('#bupSeePlans');
      if (_sp) _sp.onclick = function () {
        try { if (window.Subs && Subs.openPlans) Subs.openPlans(); } catch (e) {}
      };
      ov.querySelector('#bupAll').onclick = function () { doRestore(missing.slice()); };
      ov.querySelectorAll('.bupRowInfo').forEach(function (el) {
        el.onclick = function () { var i = parseInt(el.getAttribute('data-idx')); showBackupWorkDetail(missing[i], function () { doRestore([missing[i]]); }); };
      });
      ov.querySelectorAll('.bupRestore').forEach(function (btn) {
        btn.onclick = function () { doRestore([missing[parseInt(btn.getAttribute('data-idx'))]]); };
      });
      ov.querySelectorAll('.bupPurge').forEach(function (btn) {
        btn.onclick = async function () {
          var i = parseInt(btn.getAttribute('data-idx'));
          var w = missing[i];
          var f = _bupFields(_bupParse(w));
          if (!confirm('"' + (f.apt || w.workId) + '" 작업을 서버에서 완전히 삭제할까요?\n\n서버 백업(사진 포함)이 지워지고,\n이후 복구 목록에 다시 뜨지 않습니다.\n(이 기기의 로컬 작업에는 영향 없음)')) return;
          btn.disabled = true; btn.textContent = '삭제 중...';
          try { await serverPurgeWork(w); } catch (e) {}
          missing.splice(i, 1);
          render();
          if (typeof showToast === 'function') showToast('🗑 서버에서 삭제됨', 'ok');
        };
      });
    }

    async function doRestore(list) {
      ov.remove();
      if (_restoreBusy) return; _restoreBusy = true;
      if (typeof showOverlay === 'function') showOverlay('작업 복구 중...');
      try {
        var res = await restoreWorks(list, function (i, t) { if (typeof showOverlay === 'function') showOverlay('작업 복구 중 ' + i + '/' + t); });
        if (typeof hideOverlay === 'function') hideOverlay();
        if (typeof showToast === 'function') showToast('✓ 작업 ' + res.done + '개 복구됨', 'ok');
        try { if (window.__calendarRefresh) window.__calendarRefresh(); } catch (e) {}
        try { if (typeof invalidateRecordsCache === 'function') invalidateRecordsCache(); } catch (e) {}
        // ★ 서버 복구 완료 알림 → 온보딩(재설치 복구)에서 다음 단계로 자동 진행
        try { document.dispatchEvent(new CustomEvent('cloudbackup-restored', { detail: { count: res.done } })); } catch (e) {}
        setTimeout(function () { bgDownloadCurrentMonth(res.infos); }, 600);
      } catch (e) {
        if (typeof hideOverlay === 'function') hideOverlay();
        if (typeof showToast === 'function') showToast('복구 오류: ' + (e && e.message), 'err');
      }
      _restoreBusy = false;
      var ids = {}; list.forEach(function (x) { ids[x.id || x.workId] = 1; });
      var remain = missing.filter(function (x) { return !ids[x.id || x.workId]; });
      if (remain.length) { setTimeout(function () { showRestorePopup(remain); }, 900); }
    }

    document.body.appendChild(ov);
    render();
  }

  /* ── 재설치 복구용 팝업 (온보딩 '복구' 분기에서만 force=true로 호출) ──
     ★ 앱 시작 자동 팝업은 폐지 — 삭제한 작업은 아래 휴지통에서 관리한다. */
  var _checkTries = 0;
  CloudBackup.checkAndOfferRestore = async function (force, opts) {
    opts = opts || {};
    var notify = !!opts.notify;   // 설정 화면 등 사용자가 직접 누른 경우 → 결과를 토스트로 안내
    var say = function (msg, type) { if (notify && typeof showToast === 'function') showToast(msg, type || 'ok'); };
    if (!force) return;                       // 자동 팝업 없음 — 온보딩 재설치 복구에서만 동작
    /* ★ 2026-08-24 작업 기록 복구는 **로그인만으로** 가능하다(구독 무관).
         사진 복구만 구독 전용으로 남는다 — bgDownloadCurrentMonth / ensureWorkPhotos / redownloadWork 참고. */
    if (!loggedIn()) { say('서버 복구는 로그인 후 이용할 수 있어요', 'err'); return; }
    if (typeof photoFolderHandle === 'undefined' || !photoFolderHandle) {
      if (notify) { say('저장 폴더를 먼저 연결해주세요', 'err'); return; }   // 사용자 클릭 → 즉시 안내(자동 재시도 X)
      if (_checkTries++ < 5) setTimeout(function () { CloudBackup.checkAndOfferRestore(true); }, 3000);
      return;
    }
    try {
      say('서버 백업 확인 중…');
      var server = await serverFullList();
      if (!server.length) { say('서버에 백업된 작업이 없어요', 'ok'); return; }
      var local = await localFolderNames();
      // ★ 삭제한 작업은 복구 목록에서 제외 (필요없는 작업 부활 방지)
      //   ① 전체본 자체의 trashedAt(신규 삭제)
      //   ② items 요약의 trashed=true(동기화 정리로 삭제됐거나, 이 기능 이전에 삭제된 구버전 삭제분)
      var trashedIds = {};
      try {
        var isnap = await Cloud.db.collection('schedules').doc(uid()).collection('items').where('trashed', '==', true).get();
        isnap.forEach(function (d) { var v = d.data() || {}; trashedIds[v.workId || d.id] = 1; });
      } catch (e) { console.warn('[CloudBackup] 휴지통 교차확인 실패(무시)', e && e.code); }
      var missing = server.filter(function (w) { return !local[w.workId] && !w.trashedAt && !trashedIds[w.workId]; });
      if (missing.length) showRestorePopup(missing);
      else say('복구할 작업이 없어요 — 이미 모두 기기에 있어요', 'ok');
    } catch (e) {
      console.warn('[CloudBackup] 복구 확인 실패', e && (e.code || e.message));
      say('복구 확인 중 오류가 났어요', 'err');
    }
  };

  /* ── 공유 휴지통(삭제 작업) — 30일 보관 후 자동 삭제 ── */
  var TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  function _tms(t) { try { if (!t) return 0; if (t.toMillis) return t.toMillis(); if (t.seconds) return t.seconds * 1000; if (typeof t === 'number') return t; } catch (e) {} return 0; }

  // 작업 삭제 시 서버 전체본에 삭제 시각 기록 → 휴지통 목록/만료 기준
  CloudBackup.markWorkTrashed = async function (folderName) {
    if (!loggedIn() || !folderName) return;   // ★ 2026-08-24 구독 무관(전체본이 무료 로그인에도 올라가므로)
    try { await fullCol().doc(safeId(folderName)).set({ trashedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }); }
    catch (e) { console.warn('[CloudBackup] trashed 표시 실패', e && e.code); }
  };

  // 휴지통에 보여줄 삭제 작업 목록 — ★ 명시적으로 삭제한 작업(trashedAt)만. "missing=삭제" 추론/지연스탬프 없음(오삭제 방지)
  CloudBackup.getTrashWorks = async function () {
    if (!loggedIn()) return [];   // ★ 2026-08-24 구독 무관
    if (typeof photoFolderHandle === 'undefined' || !photoFolderHandle) return [];
    var server, localMap;
    try { server = await serverFullList(); } catch (e) { return []; }
    try { localMap = await localFolderNames(); } catch (e) { localMap = {}; }
    var out = [];
    server.forEach(function (w) {
      var tAt = _tms(w.trashedAt);
      if (!tAt) return;                 // 삭제 표시 없는 정상 백업 → 절대 노출/삭제 대상 아님
      if (localMap[w.workId]) return;   // 로컬에 살아있으면(복구/재생성) 휴지통에 안 보임
      var f = _bupFields(_bupParse(w));
      w._apt = f.apt; w._date = w.date || f.date; w._photos = f.photos; w._worker = f.worker;
      w._trashedMs = tAt; w._expireMs = tAt + TRASH_TTL_MS;
      out.push(w);
    });
    out.sort(function (a, b) { return b._trashedMs - a._trashedMs; });
    return out;
  };

  // 만료(30일 경과) 삭제 작업 자동 완전삭제 — 앱 시작 시 조용히. ★ 다중 안전장치로 오삭제 원천 차단
  CloudBackup.autoPurgeExpiredTrash = async function () {
    if (!loggedIn()) return;   // ★ 2026-08-24 구독 무관 — 무료 계정의 전체본도 만료 정리 대상이어야 한다
    if (typeof photoFolderHandle === 'undefined' || !photoFolderHandle) return;  // 폴더 미연결 → 아무것도 삭제 안 함
    var server;
    try { server = await serverFullList(); } catch (e) { return; }
    var now = Date.now();
    // 명시적으로 삭제(trashedAt)했고 30일 지난 것만 후보
    var expired = server.filter(function (w) { var t = _tms(w.trashedAt); return t && (now - t) > TRASH_TTL_MS; });
    var purged = 0;
    for (var i = 0; i < expired.length; i++) {
      var w = expired[i];
      // ★ 최종 안전장치: 해당 폴더가 로컬에 실제로 존재하면(복구/재생성) 절대 삭제하지 않음
      //    (localFolderNames 부분 스캔 오류에도 안전 — 폴더를 직접 조회)
      var present = false;
      try { await photoFolderHandle.getDirectoryHandle(w.workId); present = true; } catch (e) {}
      if (present) continue;
      try { await serverPurgeWork(w); purged++; } catch (e) {}
    }
    if (purged) console.log('[CloudBackup] 만료 휴지통 자동삭제 ' + purged + '건');
  };

  // 휴지통에서 한 작업 복구(로컬 재생성 + 서버 trashedAt 해제)
  CloudBackup.restoreTrashWork = async function (w) {
    if (!w) return;
    if (_restoreBusy) return; _restoreBusy = true;
    if (typeof showOverlay === 'function') showOverlay('작업 복구 중...');
    try {
      var res = await restoreWorks([w], function (i, t) { if (typeof showOverlay === 'function') showOverlay('작업 복구 중 ' + i + '/' + t); });
      try { await fullCol().doc(w.id).set({ trashedAt: firebase.firestore.FieldValue.delete() }, { merge: true }); } catch (e) {}
      // ★ 공유 상대가 보는 schedules 항목의 trashed 도 함께 해제 (안 하면 나만 보이고 상대에겐 계속 안 보임)
      try { if (window.CloudSync && CloudSync.untrashWorkItem) await CloudSync.untrashWorkItem([w.workId, w.id]); } catch (e) {}
      if (typeof hideOverlay === 'function') hideOverlay();
      if (typeof showToast === 'function') showToast('✓ 작업 복구됨', 'ok');
      try { if (window.__calendarRefresh) window.__calendarRefresh(); } catch (e) {}
      try { if (typeof invalidateRecordsCache === 'function') invalidateRecordsCache(); } catch (e) {}
      setTimeout(function () { bgDownloadCurrentMonth(res.infos); }, 600);
    } catch (e) {
      if (typeof hideOverlay === 'function') hideOverlay();
      if (typeof showToast === 'function') showToast('복구 오류: ' + (e && e.message), 'err');
    }
    _restoreBusy = false;
  };

  // 휴지통 UI(cloud_share.js)에서 쓰는 진입점
  CloudBackup.showWorkDetail = showBackupWorkDetail;   // (w, onRestore)
  CloudBackup.purgeTrashWork = serverPurgeWork;        // (w) → 서버 완전삭제

  /* ── 트리거 ── */
  document.addEventListener('cloud-auth-changed', function (e) {
    if (e && e.detail && e.detail.user) { setTimeout(pull, 800); setTimeout(function () { CloudBackup.autoPurgeExpiredTrash(); }, 3000); }
  });
  setTimeout(function () { if (loggedIn()) { pull(); CloudBackup.autoPurgeExpiredTrash(); } }, 2000);
})();