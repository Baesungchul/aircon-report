/* ═══════════════════════════════════════════════
   CLOUD SYNC ─ 내 작업 기록 → Firestore 자동 동기화 (텍스트만)
   - schedules/{uid}/items/{workId} 에 가벼운 요약만 저장 (사진 제외)
   - 자동: 로그인 시 + 작업 저장/수정/삭제(invalidateRecordsCache) 시 자동 업로드
   - 삭제 반영: 로컬에 없는 항목은 Firestore에서도 삭제 (동기화 ID 목록 비교)
   - 변경분만 업서트(해시 비교)로 쓰기 최소화
═══════════════════════════════════════════════ */
(function () {
  'use strict';
  window.CloudSync = window.CloudSync || {};

  function loggedIn() { return window.Cloud && Cloud.ready && Cloud.user; }
  function itemsCol() { return Cloud.db.collection('schedules').doc(Cloud.user.uid).collection('items'); }

  // ── 가격/시간 헬퍼 (calendar.js와 동일 규칙) ──
  function digits(v){ return parseInt(String(v==null?'':v).replace(/[^0-9]/g,''),10) || 0; }
  function sessOf(d){ return d.session || d || {}; }
  function isFac(d){ var s=sessOf(d); return s.workType === 'facility' || d.workType === 'facility'; }
  function facOf(d){ var s=sessOf(d); return s.facilityCustomer || d.facilityCustomer || null; }
  function unitsOf(d){ var s=sessOf(d); return s.units || d.units || []; }
  function workPrice(d){
    if (isFac(d)) { var fc=facOf(d); return fc ? digits(fc.price) : 0; }
    return unitsOf(d).reduce(function(a,u){ return a + digits(u.customer && u.customer.price); }, 0);
  }
  function workStart(d){
    if (isFac(d)) { var fc=facOf(d); return (fc && fc.startTime) || ''; }
    var ts=unitsOf(d).map(function(u){return u.customer && u.customer.startTime;}).filter(Boolean).sort();
    return ts.length?ts[0]:'';
  }
  function workEnd(d){
    if (isFac(d)) { var fc=facOf(d); return (fc && fc.endTime) || ''; }
    var ts=unitsOf(d).map(function(u){return u.customer && u.customer.endTime;}).filter(Boolean).sort();
    return ts.length?ts[ts.length-1]:'';
  }
  function firstField(d, field){
    if (isFac(d)) { var fc=facOf(d); return (fc && fc[field]) || ''; }
    var us=unitsOf(d); for (var i=0;i<us.length;i++){ var c=us[i].customer; if (c && c[field]) return c[field]; }
    return '';
  }
  /* ★ 2026-08-30 고객명 — 공용시설은 'contact'(담당자) 필드를 그대로 재사용,
     가정용은 customer.name. 공유 카드 쪽에서는 둘 다 하나의 'name' 으로 합쳐 보낸다. */
  function nameField(d){
    if (isFac(d)) { var fc=facOf(d); return (fc && fc.contact) || ''; }
    return firstField(d, 'name');
  }
  function safeId(name){ return String(name||'').replace(/[\/\.\#\$\[\]]/g, '_').slice(0, 200); }

  function toPayload(item){
    var d = item.data || {};
    /* ★ 업종은 '지금 값'으로 올린다. _session.json 의 사본은 저장 시점에 찍힌 것이라
         아이콘·제목을 바꿔도 상대 폰엔 옛 값이 계속 올라간다. */
    var _pfSnap = (d.session && d.session.profileSnap) || null;
    var _pfId   = (d.session && d.session.profileId) || '';
    try {
      if (window.Profiles && Profiles.ownOf) {
        var _own = Profiles.ownOf({ profileId: _pfId, profileSnap: _pfSnap });
        if (_own) { _pfId = _own.id; _pfSnap = Profiles.snapOf(_own.id) || _pfSnap; }
      }
    } catch (e) {}
    var unitNames = (unitsOf(d)||[]).map(function(u){ return u.name || ''; }).filter(Boolean).slice(0, 8);
    var _p = {
      workId:     d.folderName || d.workId || '',
      date:       d.date || (item.sortDate||'').slice(0,10) || '',
      endDate:    d.endDate || (d.session && d.session.endDate) || '',
      worker:     d.worker || (d.session && d.session.worker) || '',
      apt:        d.apt || '',
      workType:   isFac(d) ? 'facility' : 'home',
      price:      workPrice(d),
      startTime:  workStart(d),
      endTime:    workEnd(d),
      totalUnits: d.totalUnits || (unitsOf(d)||[]).length || 0,
      totalPhotos:d.totalPhotos || 0,
      unitNames:  unitNames,
      name:       nameField(d) || '',
      target:     firstField(d, 'workTarget') || '',
      memo:       firstField(d, 'memo') || '',
      phone:      firstField(d, 'phone') || '',
      address:    firstField(d, 'address') || '',
      // ★ 2026-08-13: 저장된 글 개수. 공유 카드에도 ✍️ 배지를 띄우려면 요약에 있어야 한다
      //   (전체 글 내용이 아니라 개수만 — 몇 바이트다)
      posts:      (d.session && Array.isArray(d.session.posts)) ? d.session.posts.length : 0,
      /* ★ 2026-08-16 업종. 아이콘·이름까지 넣는 이유는 상대 폰에 내 프로필 목록이 없어서다.
         id 만 보내면 상대는 아무것도 못 그린다. (몇 바이트라 비용은 무시할 수준)
         ⚠️ 여기에 필드를 더하면 모든 작업의 해시가 바뀌어 한 번은 전량 재업로드된다. */
      profileId:   _pfId || '',
      profileIcon: (_pfSnap && _pfSnap.icon) || '',
      profileName: (_pfSnap && _pfSnap.name) || '',
      /* 스냅샷 통째로 — 아이콘·이름만 보내면 상대 쪽 보고서 제목·호수/단계 호칭이 옛 업종 것으로 남는다 */
      profileSnap: _pfSnap || null,
      // ★ 2026-08-11 버그수정: 실제 사진폴더가 있는 진짜 작업은 항상 manual:false로 명시.
      //   (예전에 '간단한 일정추가'로 만들었다가 나중에 같은 workId로 실제 사진을 찍은 경우,
      //    이 필드가 없으면 merge:true 저장이 서버의 옛 manual:true를 못 지워 계속
      //    "공유" 병합목록의 수동일정으로 남아 openInWorkTab(빌려보기 취급) 경로를 타게 됨)
      manual: false
    };
    /* ⭐ 2026-08-21 — 상대 폰 업종 오염 차단.
       재설치 직후엔 profiles.js P.ensure() 가 이름이 '기본'인 빈 프로필을 먼저 만든다.
       그 상태로 동기화하면 '기본' 이 클라우드 요약에 실려 상대 폰까지 건너가고,
       상대는 그 이름을 자기 목록에서 못 찾아 모든 작업이 '(상대 업종)' 으로 바뀐다(실제 사고).
       → 아직 껍데기면 업종 4필드를 **payload 에서 통째로 뺀다.**
         set(..., {merge:true}) 이므로 서버에 이미 있는 올바른 값이 그대로 유지된다.
       업종을 하나라도 만들거나 고치면 seed 표시가 풀려 평소처럼 다시 실린다. */
    try {
      if (window.Profiles && Profiles.seeded && Profiles.seeded()) {
        delete _p.profileId; delete _p.profileIcon; delete _p.profileName; delete _p.profileSnap;
        if (!toPayload._seedWarned) { toPayload._seedWarned = 1; console.warn('[CloudSync] 업종이 아직 초기 상태 → 업종 정보는 올리지 않습니다(상대 폰 보호)'); }
      }
    } catch (e) {}
    return _p;
  }

  /* ★ 2026-09-01 (1단계) — 동기화 해시를 'payload JSON 통째'에서 짧은 지문으로
       예전 hashOf 는 JSON.stringify(p) 를 **그대로** localStorage 값으로 넣었다(작업당 300~800B).
       2,000건이면 이것만 1MB 를 넘겨 오리진 한도(≈5MB)를 밀어올렸고, 한도에 닿는 순간
       해시 저장이 조용히 실패해 **매 동기화마다 전량 재업로드**가 났다(요금·지연의 주범).
       → 길이 + FNV-1a 32bit 로 8~16B. 약 50~100배 절감.
       길이를 같이 보는 건 cloudFullHash_ 가 이미 쓰던 검증된 패턴이다(충돌 확률 사실상 0). */
  function fnv1a(str){
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(36);
  }
  function hashOf(p){ try { var j = JSON.stringify(p); return j.length + ':' + fnv1a(j); } catch(e){ return String(Math.random()); } }
  function hkey(uid, id){ return 'cloudSyncHash_' + uid + '_' + id; }

  /* ★ 마이그레이션 패스 — 이게 없으면 형식이 바뀌는 첫 실행에 전 작업이 한꺼번에 재업로드된다
       (2,000건이면 get 2,000 + set 2,000 이 동시에 발사). 옛 값은 payload JSON 통째라
       '{' 로 시작한다 → 지금 payload 와 문자열이 같으면 **업로드 없이 짧은 해시로 갈아끼우고**
       '변경 없음'으로 처리한다. 결과적으로 전환 비용 0건. */
  function hashUnchanged(uid, id, p, h){
    var prev = null;
    try { prev = localStorage.getItem(hkey(uid, id)); } catch (e) {}
    if (prev == null) return false;
    if (prev === h) return true;
    if (prev.charAt(0) === '{') {
      var same = false;
      try { same = (prev === JSON.stringify(p)); } catch (e) {}
      if (same) {
        try { localStorage.setItem(hkey(uid, id), h); } catch (e) {}
        try { if (window.Diag) Diag.noteHashMigrated(); } catch (e) {}
        return true;
      }
    }
    return false;
  }

  /* ★ 동시 실행 제한 — 예전엔 items.forEach 안에서 get/set 이 제한 없이 한꺼번에 발사됐다.
       평소엔 변경분이 0~1건이라 티가 안 나지만, 전량 재업로드가 도는 순간(위 상황) 수천 개가
       동시에 나가 실패·지연을 만든다. 한 번에 6건까지만 흐르게 한다. 총량은 그대로다. */
  var _gateRun = 0, _gateQ = [];
  function _gatePump(){ while (_gateRun < 6 && _gateQ.length) { (_gateQ.shift())(); } }
  function gate(fn){
    _gateQ.push(function(){
      _gateRun++;
      Promise.resolve().then(fn).catch(function(){}).then(function(){ _gateRun--; _gatePump(); });
    });
    _gatePump();
  }
  function idsKey(uid){ return 'cloudSyncedIds_' + uid; }
  function getSyncedIds(uid){ try { return JSON.parse(localStorage.getItem(idsKey(uid)) || '[]'); } catch(e){ return []; } }
  function setSyncedIds(uid, arr){ try { localStorage.setItem(idsKey(uid), JSON.stringify(arr)); } catch(e){} }

  // ── 전체본(full) 업로드: 재설치 복구용 _session.json 전체 ──
  /* ★ 2026-08-24 구독자 전용 → **로그인만으로** 개방.
       왜: 로그인해도 무료 사용자가 얻는 게 없어 로그인할 이유가 없었다. 그런데 이 앱에서 가장 아픈
           사고가 재설치로 기록을 잃는 것이고(저장소 구조상 아직 미해결), 자동 폴더백업은 기본이 꺼져 있다.
           = 미로그인 사용자는 폰을 바꾸면 그동안 쌓은 게 사라지는데 본인은 그걸 모른다.
       비용: 여기서 올리는 건 _session.json **텍스트뿐**이다(사진은 Storage 로 따로 가고 그건 구독 유지).
             사진 메타는 파일명·pid 뿐이고 썸네일은 THUMBNAILS_ENABLED=false 라 실제로 안 담긴다.
       경계: 무료=내 기록이 지켜진다 / 구독=사진까지 지켜지고 남과 함께 일한다. */
  //  ⚠️ items 해시(hkey)와 반드시 분리 추적할 것!
  //     pushWorkItems가 먼저 items를 올려 해시를 기록하면 syncAll이 조기 return 되어
  //     전체본이 영영 업로드되지 않는 경합이 있었음 (2026-07-22 재설치 복구 4건 누락의 원인)
  function fkey(uid, id){ return 'cloudFullHash_' + uid + '_' + id; }
  function pushFull(uid, it, p, id){
    try {
      if (!(window.Cloud && Cloud.ready && Cloud.user)) return;   // 로그인만 확인(구독 무관)
      var d = it && it.data;
      var sess = d && d.session;
      if (!sess || d._slim) return;                                  // 달력 슬림캐시 항목은 전체본이 아님 → 스킵
      if (!Array.isArray(sess.units) || !sess.units.length) return;  // 완전한 세션만 업로드
      var j = JSON.stringify(sess);
      try { if (window.Diag) Diag.noteFull(id, j.length); } catch (e) {}   // ★ 2026-09-01 계측(탐지만, 동작 변화 없음)
      var tag = j.length + ':' + (sess.savedAt || '');
      var prev = null; try { prev = localStorage.getItem(fkey(uid, id)); } catch (e) {}
      if (prev === tag) return;   // 변경 없음
      gate(function () { return Cloud.db.collection('schedules').doc(uid).collection('full').doc(id).set({
        workId: p.workId, date: p.date, json: j,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true })
      .then(function(){ try { localStorage.setItem(fkey(uid, id), tag); } catch (e) {} })
      .catch(function(e){ console.warn('[CloudSync] 전체본 업로드 실패', id, e && e.code); }); });
    } catch (e) {}
  }

  // ── 로컬 폴더 직접 스캔 (모든 날짜 폴더) ──
  async function scanLocalItems(){
    if (typeof photoFolderHandle === 'undefined' || !photoFolderHandle) throw new Error('NO_FOLDER');
    if (typeof requestFolderPermissionSafe === 'function') { try { await requestFolderPermissionSafe('readwrite'); } catch(e){} }
    var items = [];
    for await (var entry of photoFolderHandle.values()) {
      if (entry.kind !== 'directory') continue;
      if (!/^\d{4}-\d{2}-\d{2}/.test(entry.name)) continue;
      try {
        var sf = await entry.getFileHandle('_session.json');
        var file = await sf.getFile();
        var data = JSON.parse(await file.text());
        if (!data.units || !data.units.length) continue;
        items.push({ type:'work', sortDate: entry.name.slice(0,10), data: {
          folderName: entry.name, apt: data.apt||'', date: data.date||entry.name.slice(0,10),
          units: data.units, totalUnits: data.units.length,
          totalPhotos: data.units.reduce(function(s,u){return s+(u.beforeCount||0)+(u.afterCount||0);},0),
          session: data
        }});
      } catch(e) {}
    }
    return items;
  }

  // ── 핵심 동기화: 업로드(변경분) + 삭제 반영 ──
  var _syncing = false;
  async function syncAll(silent){
    if (!loggedIn()) { if (!silent && typeof showToast==='function') showToast('먼저 로그인해주세요','err'); return; }
    if (_syncing) return;
    if (typeof photoFolderHandle === 'undefined' || !photoFolderHandle) {
      if (!silent && typeof showToast==='function') showToast('저장 폴더를 먼저 연결해주세요','err'); return;
    }
    _syncing = true;
    var uid = Cloud.user.uid;
    try {
      var items = await scanLocalItems();   // 실패 시 throw → 아래 catch (삭제 반영 안 함)
      var currentIds = [];
      var writes = 0;
      items.forEach(function(it){
        var p = toPayload(it);
        if (!p.workId || !p.date) return;
        var id = safeId(p.workId);
        currentIds.push(id);
        pushFull(uid, it, p, id);   // ★ 전체본은 items 해시와 무관하게 항상 검사
        // 가져오기(claim) 예약이 있고 이 작업이 그 일정과 일치하면 → 원본을 가져감 표시
        try {
          var _pc = window._pendingTakeClaim;
          if (_pc && p.date === _pc.date && (p.apt||'') === (_pc.apt||'') && p.workId !== _pc.workId) {
            if (window.CloudShare && CloudShare.markClaimed) CloudShare.markClaimed(_pc.ownerUid, _pc.workId);
            window._pendingTakeClaim = null;
          }
        } catch(e){}
        var h = hashOf(p);
        if (hashUnchanged(uid, id, p, h)) return;  // 변경 없음(옛 형식이면 여기서 조용히 갈아끼운다)
        // ★ 로컬 저장시각(충돌 방지)
        var _lsaved = 0; try { if (it.data.session && it.data.session.savedAt) { var _tt = Date.parse(it.data.session.savedAt); if (!isNaN(_tt)) _lsaved = _tt; } } catch (e) {}
        p.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
        p.editedBy = uid;
        p.savedAt = _lsaved;
        writes++;
        (function (it2, p2, id2, h2, lsaved2) {
          // 서버가 더 최신이면(=다른 기기에서 나중에 수정) 구버전 로컬로 덮어쓰지 않음
          gate(function () { return itemsCol().doc(id2).get().then(function (snap) {
            var sd = (snap.exists && snap.data()) || null;
            var sv = (sd && sd.savedAt) || 0;
            if (sv && lsaved2 && sv > lsaved2) {
              console.warn('[CloudSync] 서버가 최신 → 업로드 건너뜀(충돌 방지)', id2);
              try { localStorage.setItem(hkey(uid, id2), h2); } catch (e) {}   // 매번 재확인하지 않도록
              return;
            }
            // ★ 자동정리로 휴지통에 갔던 작업이 로컬에 다시 있으면 = 오삭제 → 자동 복원
            if (sd && sd.cleanupTrashed) { p2.trashed = false; p2.cleanupTrashed = false; p2.restoredAt = firebase.firestore.FieldValue.serverTimestamp(); }
            return itemsCol().doc(id2).set(p2, { merge: true })
              .then(function () { try { localStorage.setItem(hkey(uid, id2), h2); } catch (e) {} })
              .catch(function (e) { console.warn('[CloudSync] 업로드 실패', id2, e && e.code); });
            // (전체본 업로드는 pushFull로 일원화 — 해시 경합으로 인한 누락 방지)
          }).catch(function (e) { console.warn('[CloudSync] savedAt 확인 실패', id2, e && e.code); }); });
        })(it, p, id, h, _lsaved);
      });
      // ★ 권위적 정리(2026-07-24): localStorage 목록이 아니라 "클라우드 실제 문서 ↔ 로컬 폴더"를 대조해
      //    로컬에 없는 '작업' 문서를 삭제 → 상대에게만 보이던 중복/유령/삭제잔존 일소.
      //    보존: 수동일정(manual / m_*), 휴지통(trashed), 가져가기(claimedBy). 로컬 스캔이 비면 대량삭제 방지로 스킵.
      var curSet = {}; currentIds.forEach(function(i){ curSet[i]=1; });
      var removed = 0;
      if (currentIds.length > 0) {
        try {
          /* ★ 2026-08-13 읽기량 절감
             기존엔 동기화할 때마다 itemsCol().get() 으로 내 작업 문서를 '전부' 읽었다.
             작업 100개면 1회 100읽기이고, 저장할 때마다(2.5초 디바운스)·앱 복귀할 때마다 돌아
             Firestore 읽기 할당량을 가장 많이 먹는 지점이었다.

             바꾼 방식:
               · 평소(자동 동기화) = 변경분 대조. 지난번 목록(cloudSyncedIds)에 있었는데
                 지금 로컬에 없는 것만 후보로 삼고, 그 후보만 1건씩 읽어 확인한다.
                 삭제된 작업이 없으면 읽기 0.
               · 전체 대조 = 사용자가 직접 '동기화'를 누르거나(!silent), 마지막 전체 대조가
                 12시간 지났을 때만. 다른 기기에서 생긴 유령 문서는 여기서 걸러진다.
             → 평소 읽기는 0에 수렴하고, 권위적 정리 능력은 그대로 유지된다. */
          var FULL_EVERY_MS = 12 * 60 * 60 * 1000;
          var _lastFullKey = 'cloudSyncLastFull_' + uid;
          var _lastFull = 0;
          try { _lastFull = parseInt(localStorage.getItem(_lastFullKey) || '0', 10) || 0; } catch (e) {}
          var doFull = (!silent) || ((Date.now() - _lastFull) > FULL_EVERY_MS);

          var delIds = [];
          if (doFull) {
            var cloudSnap = await itemsCol().get();
            var cloudWork = 0;   // 클라우드의 정상 '작업' 문서 수(수동/휴지통/claim 제외)
            cloudSnap.forEach(function (doc) {
              var id = doc.id;
              var d = doc.data() || {};
              var isWork = !(d.manual || String(d.workId || id).indexOf('m_') === 0);
              if (isWork && !d.trashed && !d.claimedBy) cloudWork++;
              if (curSet[id]) return;                                              // 로컬에 있음 → 유지
              if (d.manual || String(d.workId || id).indexOf('m_') === 0) return;  // 수동 일정 보존
              if (d.trashed) return;                                               // 휴지통 보존
              if (d.claimedBy) return;                                             // 가져가기 처리중 보존
              delIds.push(id);                                                     // 로컬에 없는 작업 문서 = 찌꺼기
            });
            // ★★ 안전장치(2026-07-28): 로컬 스캔이 클라우드 작업수의 절반도 안 되면 = 폴더가 덜 읽힌 '부분 스캔' 의심
            //    → 파괴적 정리를 통째로 건너뜀. (앱 복귀/콜드스타트 순간 부분 스캔이 멀쩡한 작업을 휴지통으로 보내는 사고 방지)
            if (cloudWork >= 4 && currentIds.length < cloudWork * 0.5) {
              console.warn('[CloudSync] 부분 스캔 의심(로컬 ' + currentIds.length + ' < 클라우드작업 ' + cloudWork + ') → 정리 건너뜀');
              delIds = [];
            }
            try { localStorage.setItem(_lastFullKey, String(Date.now())); } catch (e) {}
            console.log('[CloudSync] 전체 대조 수행(클라우드 ' + cloudSnap.size + '건 읽음)');
          } else {
            // ── 변경분 대조: 지난번엔 있었는데 지금 로컬에 없는 것만 후보 ──
            var prevIds = getSyncedIds(uid);
            var cand = prevIds.filter(function (id) { return !curSet[id]; });
            // 같은 취지의 부분 스캔 가드(클라우드 수 대신 '지난번 로컬 수'와 비교 → 읽기 0)
            if (prevIds.length >= 4 && currentIds.length < prevIds.length * 0.5) {
              console.warn('[CloudSync] 부분 스캔 의심(로컬 ' + currentIds.length + ' < 지난번 ' + prevIds.length + ') → 정리 건너뜀');
              cand = [];
            }
            for (var ci = 0; ci < cand.length; ci++) {
              var cid = cand[ci];
              if (String(cid).indexOf('m_') === 0) continue;    // 수동 일정은 로컬 폴더가 없으므로 대상 아님
              var dsnap = await itemsCol().doc(cid).get();      // 후보만 1건씩 확인
              if (!dsnap.exists) continue;
              var dd = dsnap.data() || {};
              if (dd.manual || String(dd.workId || cid).indexOf('m_') === 0) continue;
              if (dd.trashed) continue;
              if (dd.claimedBy) continue;
              delIds.push(cid);
            }
            if (cand.length) console.log('[CloudSync] 변경분 대조: 후보 ' + cand.length + '건만 읽음');
          }
          delIds.forEach(function (id) {
            removed++;
            // ★ 하드삭제 대신 공유 휴지통으로 소프트삭제 → ♻️ 복원 가능 (오삭제 대비, 2026-07-26)
            //    재설치 복구용 full 백업은 지우지 않고 보존한다.
            itemsCol().doc(id).update({
              trashed: true,
              trashedAt: firebase.firestore.FieldValue.serverTimestamp(),
              trashedBy: uid,
              cleanupTrashed: true
            })
              .then(function(){ try { localStorage.removeItem(hkey(uid, id)); } catch(e){} })
              .catch(function(e){ console.warn('[CloudSync] 정리 휴지통이동 실패', id, e && e.code); });
          });
        } catch (e) { console.warn('[CloudSync] 권위적 정리 실패(스킵)', e && e.code); }
      }
      setSyncedIds(uid, currentIds);
      console.log('[CloudSync] 동기화: 총 ' + items.length + '건, 변경 ' + writes + ', 휴지통정리 ' + removed);
      try { if (window.Diag) Diag.noteSync({ scanned: items.length, changed: writes, removed: removed }); } catch (e) {}
      if (!silent && typeof showToast==='function') showToast('✓ 동기화 완료 (' + items.length + '건)','ok');
    } catch (e) {
      console.warn('[CloudSync] 동기화 오류', e);
      if (!silent && typeof showToast==='function') showToast('동기화 오류: ' + (e && e.message), 'err');
    } finally {
      _syncing = false;
    }
  }

  // ── 디바운스 자동 동기화 ──
  var _debTimer = null;
  CloudSync.autoSync = function(){
    if (!loggedIn()) return;
    clearTimeout(_debTimer);
    _debTimer = setTimeout(function(){ syncAll(true); }, 2500);
  };
  CloudSync.fullSync = function(){ return syncAll(false); };

  // 달력 월 로드 피기백(즉시 반영용, 변경분만)
  CloudSync.pushWorkItems = function (calItems) {
    if (!loggedIn() || !Array.isArray(calItems)) return;
    var uid = Cloud.user.uid;
    calItems.filter(function(it){ return it && it.type === 'work' && it.data; }).forEach(function(it){
      try {
        var p = toPayload(it);
        if (!p.workId || !p.date) return;
        var id = safeId(p.workId);
        // 가져오기(claim) 예약이 있고 이 작업이 그 일정과 일치하면 → 원본을 가져감 표시
        try {
          var _pc = window._pendingTakeClaim;
          if (_pc && p.date === _pc.date && (p.apt||'') === (_pc.apt||'') && p.workId !== _pc.workId) {
            if (window.CloudShare && CloudShare.markClaimed) CloudShare.markClaimed(_pc.ownerUid, _pc.workId);
            window._pendingTakeClaim = null;
          }
        } catch(e){}
        pushFull(uid, it, p, id);   // ★ 전체본 업로드 (items 해시와 별개 - 경합 누락 방지)
        var h = hashOf(p);
        if (hashUnchanged(uid, id, p, h)) return;  // 변경 없음(옛 형식이면 여기서 조용히 갈아끼운다)
        /* ⭐⭐ 2026-08-13 근본버그 — 여기엔 충돌 가드가 통째로 없었다.
           pushWorkItems 는 달력을 열 때마다 호출된다(loadCalendarData). 그래서 공유 상대가
           작업자·날짜를 고쳐 서버에 잘 저장해도, 원작업자가 달력을 여는 순간
           자기 로컬(옛 값)을 merge 로 덮어써 상대 수정이 사라졌다.
           syncAll 에는 있던 'savedAt 비교 후 서버가 최신이면 건너뛰기'가 여기엔 없었고,
           p.savedAt 조차 안 실어서 서버 값이 갱신되지도 않았다.
           (2026-08-13 toPayload 에 posts 를 추가하면서 모든 작업의 해시가 바뀌어
            전량 재업로드가 돌았고, 그래서 증상이 더 확실해졌다)
           → syncAll 과 같은 가드를 넣는다. 해시가 바뀐 항목에서만 1건 읽으므로 비용도 같다. */
        var _lsaved = 0;
        try { if (it.data.session && it.data.session.savedAt) { var _tt = Date.parse(it.data.session.savedAt); if (!isNaN(_tt)) _lsaved = _tt; } } catch (e) {}
        p.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
        p.editedBy = uid;
        p.savedAt = _lsaved;
        (function (p2, id2, h2, lsaved2) {
          gate(function () { return itemsCol().doc(id2).get().then(function (snap) {
            var sd = (snap.exists && snap.data()) || null;
            var sv = (sd && sd.savedAt) || 0;
            if (sv && lsaved2 && sv > lsaved2) {
              console.warn('[CloudSync] 서버가 최신 → 업로드 건너뜀(상대 수정 보호)', id2);
              // 해시를 기록해 둔다: 매번 다시 읽어 읽기 비용이 늘지 않게.
              // 내 로컬이 실제로 바뀌면 해시가 달라져 다시 시도된다.
              try { localStorage.setItem(hkey(uid, id2), h2); } catch (e) {}
              return;
            }
            return itemsCol().doc(id2).set(p2, { merge: true })
              .then(function(){ try { localStorage.setItem(hkey(uid, id2), h2); } catch(e){} })
              .catch(function(e){ console.warn('[CloudSync] 업로드 실패', id2, e && e.code); });
          }).catch(function (e) { console.warn('[CloudSync] savedAt 확인 실패', id2, e && e.code); }); });
        })(p, id, h, _lsaved);
      } catch(e){}
    });
  };

  // ── 단일 작업 즉시 삭제(휴지통) ──
  //   삭제 시 syncAll의 자동정리(부분스캔/빈스캔 가드로 건너뛸 수 있음)에 의존하지 않고
  //   해당 작업 문서 하나만 곧바로 휴지통 처리 → 작업 수가 적은 공유작업자도 즉시 반영됨.
  CloudSync.trashWorkItem = function (workId) {
    if (!loggedIn() || !workId) return Promise.resolve();
    var uid = Cloud.user.uid;
    var id = safeId(workId);
    // update: 내 컬렉션에 실제로 있는 작업만 휴지통 처리(빌려온 남의 작업은 문서가 없어 무시됨)
    return itemsCol().doc(id).update({
      trashed: true,
      trashedAt: firebase.firestore.FieldValue.serverTimestamp(),
      trashedBy: uid
    })
      .then(function () { try { localStorage.removeItem(hkey(uid, id)); } catch (e) {} })
      .catch(function (e) { console.warn('[CloudSync] 단일 삭제(휴지통) 스킵/실패', id, e && e.code); });
  };

  /* ★ 2026-08-08 버그수정 — 삭제한 작업을 복구했는데 상대 폰에 안 보이던 문제
       원인: 작업을 지우면 schedules/{uid}/items/{id} 에 trashed:true 가 찍힌다(trashWorkItem).
             그런데 복구(restoreTrashWork)는 로컬 파일과 backups/full 의 trashedAt 만 되돌리고
             정작 상대가 보는 schedules 항목의 trashed 는 그대로 뒀다.
             상대 달력은 trashed 항목을 걸러내므로(getItemsForMonth) 복구해도 상대에겐 계속 안 보였다.
             (내 폰은 로컬 폴더를 직접 읽어 보이니 나만 정상으로 보였던 것)
       수정: 복구 시 trashed 를 명시적으로 해제한다.
             폴더명과 workId 가 어긋난 예전 데이터가 있어 후보 id 를 모두 시도한다.
             해시도 지워 다음 동기화에서 내용이 확실히 다시 올라가게 한다. */
  CloudSync.untrashWorkItem = function (workIdOrIds) {
    if (!loggedIn()) return Promise.resolve();
    var uid = Cloud.user.uid;
    var list = Array.isArray(workIdOrIds) ? workIdOrIds : [workIdOrIds];
    var ids = [];
    list.forEach(function (w) {
      if (!w) return;
      var id = safeId(w);
      if (id && ids.indexOf(id) < 0) ids.push(id);
    });
    if (!ids.length) return Promise.resolve();
    return Promise.all(ids.map(function (id) {
      return itemsCol().doc(id).update({
        trashed: false,
        trashedAt: null,
        cleanupTrashed: false,
        restoredAt: firebase.firestore.FieldValue.serverTimestamp()
      })
        .then(function () {
          try { localStorage.removeItem(hkey(uid, id)); } catch (e) {}
          console.log('[CloudSync] 복구 → 공유 항목 되살림:', id);
        })
        .catch(function (e) {
          // 문서가 없으면(완전삭제 후 복구 등) 무시 — 곧 이어지는 동기화가 새로 만든다
          if (e && e.code !== 'not-found') console.warn('[CloudSync] 복구 해제 실패', id, e && e.code);
        });
    })).then(function () {
      try { CloudSync.autoSync(); } catch (e) {}   // 내용까지 확실히 다시 올림
    });
  };

  // ── 저장/수정/삭제 훅: invalidateRecordsCache 가로채기 ──
  (function hookInvalidate(){
    var orig = window.invalidateRecordsCache;
    window.invalidateRecordsCache = function(){
      if (typeof orig === 'function') { try { orig.apply(this, arguments); } catch(e){} }
      CloudSync.autoSync();
    };
  })();

  // ── 저장폴더가 늦게 연결돼도(네이티브 콜드스타트) 확실히 동기화되도록: 폴더 준비될 때까지 재시도 후 1회 동기화 ──
  //   (앱 복귀 트리거는 파괴적 정리를 자주 돌려 위험하므로 넣지 않음. 로그인 시 1회만. 정리에는 별도 부분스캔 안전장치 있음)
  CloudSync.syncWhenReady = function(){
    if (!loggedIn()) return;
    if (typeof photoFolderHandle !== 'undefined' && photoFolderHandle) { CloudSync._waitTries = 0; syncAll(true); return; }
    if ((CloudSync._waitTries = (CloudSync._waitTries || 0) + 1) > 30) return;   // 최대 ~45초까지 폴더 대기
    setTimeout(function(){ CloudSync.syncWhenReady(); }, 1500);
  };
  // ── 로그인 시 자동 동기화(폴더 준비 대기 포함) ──
  document.addEventListener('cloud-auth-changed', function(e){
    if (e && e.detail && e.detail.user && !e.detail.skipAutoSync) { CloudSync._waitTries = 0; setTimeout(function(){ CloudSync.syncWhenReady(); }, 1500); }
  });
})();
