/* ═══════════════════════════════════════════════
   CLOUD PHOTO SYNC ─ 공유 상대와 사진 동기화 (업로드)
   - 저장 성공 + 공유 중(accepted 상대 1명 이상)일 때만 사진을 Storage에 업로드
   - 스키마: schedules/{uid}/items/{workId}/photos/{photoId}
       { fname, unitName, role, storagePath, size, uploadedAt }
   - Storage 경로: sharedPhotos/{myUid}/{workId}/{fname}
   - 서버 보관: 원본 영구보관(2026-07-09 7일 자동삭제 폐기). 오래된 원본은 GCS 수명주기로
     Nearline/Coldline 자동 계층화(저장비 절감). 목록은 썸네일(thumbPath)만 받아 대역폭 절감.
   - 압축은 새로 하지 않음: 로컬에 이미 저장된 파일(1600px/q0.78, image.js)을 그대로 재사용
═══════════════════════════════════════════════ */

// ★ 공유 폴더 핸들 확보 공통 헬퍼 (모든 IIFE에서 공용)
//   ⚠️ 근본 원인(2026-07-06 확정): photoFolderHandle은 db.js에 `let`으로 선언됨.
//   최상위 스크립트의 let/const/class는 다른 <script> 파일에서 "맨이름"으로는
//   접근되지만 window의 프로퍼티는 되지 않는다 → `window.photoFolderHandle`은
//   실제 폴더가 연결돼 있어도 항상 undefined였음(이 파일의 모든 다운로드가
//   "폴더 없음"으로 즉시 실패한 진짜 원인). 반드시 맨 식별자 photoFolderHandle로 읽어야 함.
function _cpsGetFolderHandle(){
  try { return (typeof photoFolderHandle !== 'undefined') ? photoFolderHandle : null; }
  catch (e) { return null; }
}
async function _cpsEnsureFolderHandle(){
  var h = _cpsGetFolderHandle();
  if (h) return h;
  if (typeof reconnectFolderIfNeeded === 'function') {
    try { await reconnectFolderIfNeeded(); } catch (e) {}
  }
  return _cpsGetFolderHandle();
}

// ★★ 사진 고유 이름 헬퍼 (2026-07-08 사진 섞임/삭제 참사 수정) ★★
//   근본 원인: 사진 파일명(B_image01.jpg 등)은 "호수(unit) 안에서만" 유일하다.
//   모든 호수의 첫 작업전 사진이 전부 B_image01.jpg → 파일명만으로 Firestore 문서ID·
//   Storage 경로·로컬 미러 파일명을 만들면 호수끼리 서로 덮어써서(=섞임) 다른 호수의
//   사진이 엉뚱한 자리에 들어가고 원래 사진은 지워졌다.
//   → 호수명+역할+파일명을 합쳐 작업 전체에서 유일한 이름을 만들어 사용한다.
function _cpsSafeId(name){ return String(name||'').replace(/[\/\.\#\$\[\]]/g, '_').slice(0, 200); }
function _cpsCloudName(unitName, role, fname){
  return _cpsSafeId(unitName) + '__' + _cpsSafeId(role) + '__' + _cpsSafeId(fname);
}
// 다운로드/열기 시 로컬 미러에 쓸 파일명: 새 스키마(cloudName) 우선, 없으면(구버전 문서) 원본 fname.
function _cpsLocalName(photoData){
  if (photoData && photoData.cloudName) return photoData.cloudName;
  return (photoData && photoData.fname) || '';
}
// ★ 사진 다운로드 재시도 래퍼 — Storage 규칙의 firestore.get() 교차조회 일시실패 또는 인증토큰 만료로
//   storage/unauthorized 가 떴다 안 떴다 하는 문제 해결. unauthorized면 토큰을 강제 재발급 후 재시도한다.
//   object-not-found/4xx 는 즉시 중단(재시도 무의미).
async function _cpsFetchBlob(storagePath, tries){
  tries = tries || 4;
  var lastErr = null;
  for (var attempt = 0; attempt < tries; attempt++){
    try {
      var url = await firebase.storage().ref(storagePath).getDownloadURL();
      var resp = await fetch(url);
      if (resp && resp.ok) return await resp.blob();
      lastErr = new Error('HTTP ' + (resp && resp.status));
      if (resp && resp.status && resp.status < 500 && resp.status !== 429) break;
    } catch (e){
      lastErr = e;
      var code = String((e && (e.code || e.message)) || '');
      if (code.indexOf('storage/object-not-found') >= 0) break;
      if (code.indexOf('unauthor') >= 0) {
        try { var _u = firebase.auth && firebase.auth().currentUser; if (_u) await _u.getIdToken(true); } catch (_e) {}
      }
    }
    if (attempt < tries - 1) await new Promise(function(r){ setTimeout(r, 350 * (attempt + 1)); });
  }
  throw lastErr || new Error('download failed');
}
// ★ 순서 동기화(2026-07-11): 항목 문서의 photoOrder({unit__role: [cloudName,...]}) 순서대로 배열에 끼워넣기
//   photoObj.fileName은 상대 사진(add_)의 cloudName과 동일. 목록에 없거나 photoOrder가 없으면 맨 뒤(기존 규칙).
function _cpsInsertByOrder(arr, photoObj, unitName, role, po) {
  var list = po && po[_cpsSafeId(unitName) + '__' + role];
  var target = (list && list.indexOf) ? list.indexOf(photoObj.fileName) : -1;
  if (target < 0) { arr.push(photoObj); return; }
  var pos = arr.length;
  for (var i = 0; i < arr.length; i++) {
    var p = arr[i];
    if (!p || !p.fileName) continue;
    var en = p._borrowedIncoming ? p.fileName : (p._cloudName || _cpsCloudName(unitName, role, p.fileName));
    var ei = list.indexOf(en);
    if (ei >= 0 && ei > target) { pos = i; break; }
  }
  arr.splice(pos, 0, photoObj);
}
// ── 목록용 썸네일 생성/업로드 (원본 대신 작은 미리보기만 받게 해 대역폭 절감) ──
function _cpsMakeThumbBlob(srcBlob, maxDim, quality){
  return new Promise(function(resolve){
    var done = false;
    var fin = function(v){ if(!done){ done=true; resolve(v); } };
    // 안전장치: 6초 안에 못 끝내면 포기(썸네일 때문에 사진 업로드가 멈추지 않게)
    setTimeout(function(){ fin(null); }, 6000);
    try{
      var url = URL.createObjectURL(srcBlob);
      var img = new Image();
      img.onload = function(){
        try{
          var w=img.width, h=img.height, scale=Math.min(1, maxDim/Math.max(w,h));
          var nw=Math.max(1,Math.round(w*scale)), nh=Math.max(1,Math.round(h*scale));
          var cv=document.createElement('canvas'); cv.width=nw; cv.height=nh;
          cv.getContext('2d').drawImage(img,0,0,nw,nh);
          try{ URL.revokeObjectURL(url); }catch(e){}
          if (cv.toBlob) { cv.toBlob(function(b){ fin(b||null); }, 'image/jpeg', quality||0.6); }
          else { fin(null); }
        }catch(e){ try{URL.revokeObjectURL(url);}catch(_e){} fin(null); }
      };
      img.onerror = function(){ try{URL.revokeObjectURL(url);}catch(e){} fin(null); };
      img.src = url;
    }catch(e){ fin(null); }
  });
}
// 원본 blob으로 썸네일을 만들어 업로드하고 thumbPath 반환(실패 시 '' → 목록은 원본으로 폴백)
async function _cpsUploadThumb(uid, workId, cloudName, srcBlob){
  try{
    if (!srcBlob || !srcBlob.size) return '';
    var tb = await _cpsMakeThumbBlob(srcBlob, 240, 0.6);
    if (!tb || !tb.size) return '';
    var tp = 'sharedPhotos/' + uid + '/' + _cpsSafeId(workId) + '/' + cloudName + '_thumb.jpg';
    await firebase.storage().ref(tp).put(tb, { contentType: 'image/jpeg' });
    return tp;
  }catch(e){ return ''; }
}
// ★ 재동기화용: 로컬 작업폴더의 _session.json(sess)에서 units(사진핸들 포함)를 재구성
//   - 각 사진은 { fileName, _workDir } 형태 → uploadOnePhoto가 _workDir에서 파일을 읽어 올린다
async function _cpsBuildUnitsFromSession(dateDir, sess){
  if (!sess || !Array.isArray(sess.units)) return [];
  var out = [];
  for (var ui = 0; ui < sess.units.length; ui++) {
    var u = sess.units[ui];
    var wn = String(u.workNum || (ui + 1));
    while (wn.length < 2) wn = '0' + wn;
    var workDir = null;
    try { workDir = await dateDir.getDirectoryHandle('work' + wn, { create: false }); } catch (e) { workDir = null; }
    var mk = function (meta) {
      return (meta || []).filter(function (m) { return m && m.fname; })
        .map(function (m) { return { fileName: m.fname, _workDir: workDir, savedToFolder: true }; });
    };
    out.push({
      name: u.name || '',
      before: mk(u.beforeMeta),
      after: mk(u.afterMeta),
      specials: (u.specials || []).map(function (s) { return { desc: s.desc || '', photos: mk(s.photosMeta) }; })
    });
  }
  return out;
}

(function () {
  'use strict';
  window.CloudPhotoSync = window.CloudPhotoSync || {};

  function loggedIn(){ return window.Cloud && Cloud.ready && Cloud.user; }
  function myUid(){ return Cloud.user.uid; }
  function db(){ return Cloud.db; }
  function stg(){ return firebase.storage(); }
  function hasActiveShare(){
    return !!(window.CloudShare && CloudShare.hasAcceptedShare && CloudShare.hasAcceptedShare());
  }
  function safeId(name){ return String(name||'').replace(/[\/\.\#\$\[\]]/g, '_').slice(0, 200); }

  // ★ 방어적 중복 제거: 같은 fileName(=cloudName)이 한 배열에 2장 이상이면 첫 장만 남김.
  //   (상대 사진이 초기 pull과 실시간(live) 동기화 양쪽에서 경합으로 들어와 '같은 사진 2장'
  //    생기던 문제의 안전망. add_ 이름과 내 사진 이름은 전역 유일이라 오제거 위험 없음.)
  function _cpsDedupUnits(){
    try {
      if (typeof units === 'undefined' || !Array.isArray(units)) return 0;
      var removed = 0;
      function dd(arr){
        if (!Array.isArray(arr)) return arr;
        var seen = {}, out = [];
        for (var i = 0; i < arr.length; i++){
          var p = arr[i], fn = p && p.fileName;
          if (fn && seen[fn]) { removed++; continue; }
          if (fn) seen[fn] = 1;
          out.push(p);
        }
        return out;
      }
      units.forEach(function(u){
        u.before = dd(u.before || []);
        u.after  = dd(u.after || []);
        (u.specials || []).forEach(function(s){ s.photos = dd(s.photos || []); });
      });
      if (removed) console.warn('[CloudPhotoSync] 중복 사진 ' + removed + '장 정리');
      return removed;
    } catch(e){ return 0; }
  }

  function itemPhotosCol(workId){
    return db().collection('schedules').doc(myUid()).collection('items').doc(safeId(workId)).collection('photos');
  }

  // 사진 1장 업로드 (이미 업로드된 사진은 스킵 - photo._cloudUploaded 플래그) - 업로드했으면 true 반환
  async function uploadOnePhoto(workId, unitName, role, photo){
    if (!photo || !photo.fileName) return false;
    if (photo._borrowedIncoming) return false; // ★ 규칙1: 상대가 보탠 사진은 절대 내 이름으로 재업로드하지 않음(중복 생성 방지)
    if (photo._cloudUploaded) return false;
    try {
      var blob = null;
      if (photo.dataUrl && typeof dataURLtoBlob === 'function') {
        blob = dataURLtoBlob(photo.dataUrl);
      } else if (photo._workDir && photo.fileName) {
        var fh = await photo._workDir.getFileHandle(photo.fileName);
        blob = await fh.getFile();
      }
      if (!blob || !blob.size) return false;

      // ★ 호수+역할+파일명으로 유일한 이름 생성 (호수 간 파일명 충돌 방지)
      var cloudName = _cpsCloudName(unitName, role, photo.fileName);
      var storagePath = 'sharedPhotos/' + myUid() + '/' + safeId(workId) + '/' + cloudName + '.jpg';
      var ref = stg().ref(storagePath);
      await ref.put(blob, { contentType: 'image/jpeg' });

      var photoId = cloudName;
      await itemPhotosCol(workId).doc(photoId).set({
        fname: photo.fileName,        // 원본 파일명(표시/참조용)
        pid: photo.id || null,        // ★ 2026-08-13 사진 고유번호(찍는 순간 발급, 이동해도 불변)
        cloudName: cloudName,         // ★ 유일 식별자 = 로컬 미러 파일명
        unitName: unitName || '',
        role: role || '',
        storagePath: storagePath,
        size: blob.size || 0,
        uploadedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      photo._cloudUploaded = true;

      // 목록용 썸네일(부가) - 사진 저장/동기화를 절대 막지 않도록 백그라운드로 처리
      _cpsUploadThumb(myUid(), workId, cloudName, blob).then(function (thumbPath) {
        if (thumbPath) itemPhotosCol(workId).doc(photoId).set({ thumbPath: thumbPath }, { merge: true }).catch(function () {});
      }).catch(function () {});

      return true;
    } catch (e) {
      console.warn('[CloudPhotoSync] 업로드 실패', photo && photo.fileName, e && (e.code || e.message));
      return false;
    }
  }

  // 저장 성공 직후 dialogs.js에서 호출 - 공유 중이 아니면 아무 것도 안 함(서버 사용량 방지)
  // ★ 사진 찍을 때마다가 아니라 "저장" 1번당 신호(nonce) 1번만 기록 → Cloud Function이 감지해 상대에게 푸시 발송
  /* ★ 2026-08-13 재진입 가드 — 순서편집 직후와 저장이 겹치면 이 함수가 동시에 두 번 돌 수 있었다
     (호출부 2곳이 await 없이 부른다). 두 인스턴스가 서로 다른 keep 으로 동시에 삭제하면 위험하다.
     진행 중이면 '한 번 더 돌 예약'만 남기고 즉시 돌아간다. */
  var _auRunning = false, _auPending = null;
  CloudPhotoSync.autoUploadPhotos = async function (workId, units, opts) {
    if (!loggedIn() || (!hasActiveShare() && !(window.CloudBackup && CloudBackup.isSub && CloudBackup.isSub()))) return;  // ★ 공유중이거나 구독자면 사진 서버 백업
    if (!workId || !Array.isArray(units)) return;
    if (_auRunning) { _auPending = { workId: workId, units: units, opts: opts }; console.log('[CloudPhotoSync] 사진 동기화 진행중 → 예약'); return; }
    _auRunning = true;
    try {
      return await _autoUploadPhotosInner(workId, units, opts);
    } finally {
      _auRunning = false;
      var _pd = _auPending; _auPending = null;
      if (_pd) { setTimeout(function () { CloudPhotoSync.autoUploadPhotos(_pd.workId, _pd.units, _pd.opts); }, 0); }
    }
  };

  async function _autoUploadPhotosInner(workId, units, opts) {
    // 사진이 없어도 상대가 호수 구조를 볼 수 있도록 호수 이름을 항목에 기록(merge)
    try {
      var _unitNames = units.map(function (u) { return (u && u.name) || ''; }).filter(Boolean);
      await db().collection('schedules').doc(myUid()).collection('items').doc(safeId(workId)).set({ unitNames: _unitNames, totalUnits: _unitNames.length }, { merge: true });
    } catch (e) {}
    /* ★ 2026-08-13 [3단계] 사진 고유번호(pid)로 찾는다.
       예전엔 필요할 때마다 (호수+전후+파일명)으로 이름을 다시 계산해서 찾았다. 그래서 사진을
       작업 전→후로 옮기면 '다른 사진'이 되어 새로 올리고 옛 것을 지우는 모양이 됐다(유실 위험).
       이제 pid 로 문서를 찾으므로 **자리를 옮겨도 같은 사진**이고, 이동은 필드 수정으로 끝난다.
       ⚠️ 안전 원칙
         · pid 로 못 찾으면 **옛 방식(이름 계산)으로 폴백** — 옛 데이터가 그대로 동작해야 한다
         · 물려주기는 이름이 **정확히 일치할 때만**. 추측 금지(로컬 파일명은 위치 기반이라 식별자가 아니다)
         · `_cloudUploaded` 는 계속 메모리 전용 — 문서가 사라지면 다시 올라가는 자가치유를 유지
         · keep 은 pid 와 옛 이름의 **합집합** — 애매하면 남기는 쪽으로
       설계 전문: 메모리 project_photo_pid_design */
    var _docByPid = {}, _docByName = {}, _localPids = {}, _borrowedDocs = {};
    try {
      var _preSnap = await itemPhotosCol(workId).get();
      _preSnap.forEach(function (d) {
        var dd = d.data() || {};
        if (dd.addedBy) {
          /* ★ 2026-08-13: 상대가 보탠 사진은 **내용은 그쪽이 관리**하지만,
             내 작업 안에서의 자리(작업 전/후·호수)는 내가 정할 수 있어야 한다.
             이 사진들은 이름(add_...)에 전/후가 안 들어가서 role 값만 고치면 끝난다
             — 다시 올리거나 지우는 동작이 전혀 없어 유실 위험이 0이다.
             ⚠️ 정리(삭제) 루프는 지금처럼 addedBy 문서를 계속 건너뛴다. 자리만 고친다. */
          _borrowedDocs[dd.cloudName || d.id] = { ref: d.ref, role: dd.role || '', unitName: dd.unitName || '' };
          return;
        }
        var rec = { ref: d.ref, name: dd.cloudName || d.id, pid: dd.pid || '', role: dd.role || '', unitName: dd.unitName || '', sp: dd.storagePath || '' };
        _docByName[rec.name] = rec;
        if (rec.pid) _docByPid[rec.pid] = rec;
      });
      var _fixJobs = [];
      units.forEach(function (u) {
        var scan = function (arr, role) {
          (arr || []).forEach(function (p) {
            if (!p || !p.fileName) return;
            if (p._borrowedIncoming) {
              // 상대가 보탠 사진: 자리(전/후·호수)만 갱신. 내용·삭제는 건드리지 않는다.
              var brec = _borrowedDocs[p.fileName];
              if (brec && (brec.role !== role || brec.unitName !== (u.name || ''))) {
                _fixJobs.push(brec.ref.set({ role: role, unitName: u.name || '' }, { merge: true }));
                brec.role = role; brec.unitName = u.name || '';
                console.log('[CloudPhotoSync] 상대 사진 자리 변경(값만):', p.fileName, '→', u.name, role);
              }
              return;
            }
            if (!p.id) return;
            _localPids[p.id] = 1;
            var rec = _docByPid[p.id];
            var byPid = !!rec;            // 고유번호로 정확히 찾았는가
            if (!rec) {
              // 아직 번호가 없는 옛 문서 → 이름이 정확히 맞을 때만 물려준다
              var nm = _cpsCloudName(u.name, role, p.fileName);
              var byName = _docByName[nm];
              if (byName && !byName.pid) {
                byName.pid = p.id; _docByPid[p.id] = byName;
                _fixJobs.push(byName.ref.set({ pid: p.id }, { merge: true }));
                rec = byName;
              }
            }
            if (!rec) return;
            p._cloudName = rec.name;      // 메모리 전용 — 순서 키를 문서 이름으로 맞추기 위함
            /* ⚠️⚠️ 여기서 '이미 올렸다'로 표시하는 조건이 사진 유실의 갈림길이다. 두 가지를 모두 만족해야 한다.
               ① **고유번호로 정확히 찾았을 때만.** 이름으로 물려받은 경우는 안 된다 —
                  로컬 파일명은 위치 기반이라, 순서를 바꾸고 저장하면 같은 이름에 다른 사진이 들어간다.
                  (folder.js 가 그래서 재기록 시 _cloudUploaded 를 false 로 되돌린다)
                  이름만 우연히 맞은 문서를 '올라간 것'으로 치면 바이트가 영영 안 올라가고,
                  짝을 잃은 옛 문서는 정리에서 삭제돼 **원본이 사라진다.**
               ② **Storage 원본이 실제로 있을 때만.** 만료 정리는 원본만 지우고 문서는 남긴다.
                  문서 존재만 보고 건너뛰면 만료된 사진이 다시는 복구되지 않는다
                  (매 저장마다 재업로드로 되살아나던 자가치유가 죽는다).
               둘 중 하나라도 아니면 그냥 올린다 — 최악이라도 중복 업로드일 뿐 유실이 아니다. */
            if (byPid && rec.sp) p._cloudUploaded = true;   // 이 실행 안에서만 유효(세션에 저장하지 않는다)
            if (rec.role !== role || rec.unitName !== (u.name || '')) {
              // ★ 자리만 바뀐 사진 — 다시 올리지 않고 필드만 고친다(유실 위험 0)
              _fixJobs.push(rec.ref.set({ role: role, unitName: u.name || '' }, { merge: true }));
              rec.role = role; rec.unitName = u.name || '';
              console.log('[CloudPhotoSync] 사진 자리 변경(재업로드 없이):', rec.name, '→', u.name, role);
            }
          });
        };
        scan(u.before, 'before');
        scan(u.after, 'after');
        (u.specials || []).forEach(function (sp, si) { scan(sp.photos, 'special' + (si + 1)); });
      });
      if (_fixJobs.length) await Promise.all(_fixJobs);
    } catch (e) { console.warn('[CloudPhotoSync] 고유번호 대조 실패', e && (e.code || e.message)); }

    var jobs = [];
    units.forEach(function (u) {
      (u.before || []).forEach(function (p) { jobs.push(uploadOnePhoto(workId, u.name, 'before', p)); });
      (u.after || []).forEach(function (p) { jobs.push(uploadOnePhoto(workId, u.name, 'after', p)); });
      (u.specials || []).forEach(function (s, si) {
        (s.photos || []).forEach(function (p) { jobs.push(uploadOnePhoto(workId, u.name, 'special' + (si + 1), p)); });
      });
    });
    var results = await Promise.all(jobs);
    var uploadedCount = results.filter(Boolean).length;

    // ★★ 편집(삭제/이동/순서변경) 반영: 지금 로컬에 없는 "내가 올린" 사진을 클라우드에서도 제거
    //    - 상대가 보탠(addedBy 있음) 사진은 절대 건드리지 않음
    //    - 없으면 삭제/이동된 사진이 클라우드에 남아 상대 폰에 계속 보이고(=두 폰 불일치), 유령/섞임의 원인이 됨
    try {
      var keep = {};
      var keepByFname = {};   // 파일명 → 지금 화면에서의 새 이름(cloudName)
      units.forEach(function (u) {
        var mark = function (arr, role) {
          (arr || []).forEach(function (p) {
            if (!p.fileName || p._borrowedIncoming) return;
            var cn2 = _cpsCloudName(u.name, role, p.fileName);
            keep[cn2] = 1;
            keepByFname[(u.name || '') + '|' + p.fileName] = cn2;   // ★ 호수까지 봐야 함(파일명은 호수마다 겹친다)
          });
        };
        mark(u.before, 'before');
        mark(u.after, 'after');
        (u.specials || []).forEach(function (s, si) { mark(s.photos, 'special' + (si + 1)); });
      });
      var recSnap = await itemPhotosCol(workId).get();
      var existing = {};      // 지금 서버에 실제로 있는 문서 이름
      recSnap.forEach(function (d) {
        var dd = d.data() || {};
        existing[dd.cloudName || d.id] = 1;
      });
      var dels = [];
      recSnap.forEach(function (d) {
        var data = d.data() || {};
        if (data.addedBy) return; // 상대 기여분 보존
        var cn = data.cloudName || _cpsCloudName(data.unitName, data.role, data.fname);
        /* ★ 3단계: 고유번호가 화면에 살아 있으면 무조건 보존.
           자리를 옮겼어도 pid 는 안 바뀌므로 **이동한 사진이 삭제 후보가 되는 일 자체가 없어진다.** */
        if (data.pid && _localPids[data.pid]) return;
        if (keep[cn]) return;     // 그대로 있는 사진(옛 방식 폴백)
        /* ⭐ 2026-08-13 안전장치 — 사진을 작업 전↔후로 옮기면 이름이 바뀌므로
           '새 이름으로 올리고 옛 이름을 지우는' 모양이 된다. 그런데 예전엔 **새 업로드가 실패해도**
           옛 문서를 그냥 지워서, 그 순간 그 사진이 클라우드에서 사라졌다.
           → 같은 파일의 새 이름이 **실제로 서버에 올라와 있을 때만** 옛 것을 지운다.
              올라와 있지 않으면(=업로드 실패) 지우지 않고 그대로 둔다.
              (사용자가 진짜로 지운 사진은 새 이름 자체가 없으므로 정상 삭제된다) */
        var moved = data.fname && keepByFname[(data.unitName || '') + '|' + data.fname];
        if (moved && !existing[moved]) {
          console.warn('[CloudPhotoSync] 이동한 사진의 새 업로드가 아직 없어 옛 것을 지우지 않음:', cn);
          return;
        }
        dels.push({ ref: d.ref, sp: data.storagePath, tp: data.thumbPath });
      });
      for (var k = 0; k < dels.length; k++) {
        if (dels[k].sp) { try { await stg().ref(dels[k].sp).delete(); } catch (e) { console.warn('[사진동기화] 원본 삭제 실패:', dels[k].sp, e && (e.code || e.message)); } }
        if (dels[k].tp) { try { await stg().ref(dels[k].tp).delete(); } catch (e) { console.warn('[사진동기화] 썸네일 삭제 실패:', dels[k].tp, e && (e.code || e.message)); } }
        try { await dels[k].ref.delete(); } catch (e) { console.warn('[사진동기화] 문서 삭제 실패:', e && (e.code || e.message)); }
      }
      if (dels.length) console.log('[CloudPhotoSync] 편집 반영: 클라우드 사진 ' + dels.length + '장 정리');
    } catch (e) { console.warn('[CloudPhotoSync] 편집 정리 실패', e && (e.code || e.message)); }

    /* (2단계의 '물려주기'는 3단계에서 업로드 전 대조 블록으로 통합했다 —
       같은 컬렉션을 두 번 읽지 않도록 여기서는 제거) */
    // ★ 표시 순서(photoOrder) 기록 - 상대가 보탠 사진 포함 전체 순서를 항목 문서에 저장(파일은 안 건드림)
    try { await CloudPhotoSync.pushPhotoOrder(workId, units); } catch (e) {}

    if (uploadedCount > 0 && !(opts && opts.silent)) {
      try {
        await db().collection('schedules').doc(myUid()).collection('items').doc(safeId(workId)).set({
          lastPhotoUploadNonce: 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
          lastPhotoUploadCount: uploadedCount,
          lastPhotoUploadAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (e) { console.warn('[CloudPhotoSync] 업로드 알림 신호 실패', e && e.code); }
    }
  }

  // ★ 순서 동기화(2026-07-11): 현재 units의 표시 순서를 항목 문서 photoOrder에 기록 (원작업자 전용)
  //   key: safeUnit__role, value: [cloudName,...] (내 사진=unit__role__fname, 상대 사진=add_ 파일명 그대로)
  //   양쪽 폰 모두 이 목록 순서로 정렬/끼워넣기 → 파일 이동 없이 순서만 동기화(규칙1 유지)
  /* ★ 2026-08-13: ownerUid 인자 추가. 예전엔 무조건 내 문서(doc(myUid()))에만 써서,
     공유작업자가 순서를 바꿔도 아무 데도 가지 않았다(그래서 UI도 막아 뒀던 것).
     남의 작업이면 orderedBy/orderedAt 도 남겨 원작업자가 '상대가 바꾼 순서'임을 알 수 있게 한다. */
  /* ★ 2026-08-13: 원작업자가 호수를 지웠을 때, 그 호수에 있던 **상대가 보탠 사진**까지 클라우드에서 지운다.
     평소 정리(autoUploadPhotos)는 `if (data.addedBy) return;` 로 상대 기여분을 보존한다.
     그래서 호수를 지워도 그 호수의 상대 사진 문서가 남고, 다음에 작업을 열면
     pull 이 그 사진을 다시 받아오면서 **호수까지 되살아났다.**
     호수 삭제는 소유자의 명시적 행동이므로 그 호수의 사진은 같이 정리하는 게 맞다.
     ⚠️ 빌려보기(공유작업자) 화면에서는 절대 부르지 말 것 — 남의 사진을 지우게 된다. */
  CloudPhotoSync.deleteUnitCloudPhotos = async function (workId, unitName) {
    if (!loggedIn() || !workId || !unitName) return 0;
    if (window._borrowedShare) return 0;              // 남의 작업이면 손대지 않는다
    var n = 0;
    try {
      var snap = await itemPhotosCol(workId).get();
      var dels = [];
      snap.forEach(function (d) {
        var data = d.data() || {};
        if ((data.unitName || '') !== unitName) return;
        dels.push({ ref: d.ref, sp: data.storagePath, tp: data.thumbPath });
      });
      for (var i = 0; i < dels.length; i++) {
        if (dels[i].sp) { try { await stg().ref(dels[i].sp).delete(); } catch (e) { console.warn('[CloudPhotoSync] 원본 삭제 실패', e && (e.code || e.message)); } }
        if (dels[i].tp) { try { await stg().ref(dels[i].tp).delete(); } catch (e) {} }
        try { await dels[i].ref.delete(); n++; } catch (e) { console.warn('[CloudPhotoSync] 문서 삭제 실패', e && (e.code || e.message)); }
      }
      if (n) console.log('[CloudPhotoSync] 호수 삭제 → 클라우드 사진 ' + n + '장 정리:', unitName);
    } catch (e) { console.warn('[CloudPhotoSync] 호수 사진 정리 실패', e && (e.code || e.message)); }
    return n;
  };

  /* ★ 2026-08-13: 작업 전↔후 이동(과 호수 이동)은 '순서'가 아니라 사진 문서의 role/unitName 이다.
     photoOrder 로는 표현할 수 없어서, 공유작업자가 전↔후로 옮겨도 아무 데도 전달되지 않았다.
     다행히 상대가 올린 사진(add_)은 cloudName 에 role 이 안 들어가서 **필드 하나만 고치면 된다**
     (원작업자 사진은 cloudName 이 unit__role__fname 이라 이름까지 바뀌어야 해서 대상이 아니고,
      애초에 isForeignPhoto 로 전↔후 이동이 막혀 있다).
     → 빌려보기 화면에서 순서를 만질 때마다 '내가 올린 사진'의 현재 위치를 문서에 반영한다. */
  CloudPhotoSync.pushBorrowedPlacement = async function (workId, units, ownerUid) {
    if (!loggedIn() || !workId || !ownerUid || !Array.isArray(units)) return 0;
    if (ownerUid === myUid()) return 0;                 // 내 작업은 기존 경로가 처리
    var n = 0;
    try {
      var colRef = db().collection('schedules').doc(safeId(ownerUid)).collection('items').doc(safeId(workId)).collection('photos');
      var snap = await colRef.get();
      var mine = {};
      snap.forEach(function (d) {
        var data = d.data() || {};
        if (data.addedBy !== myUid()) return;           // 내가 올린 사진만
        mine[data.cloudName || d.id] = { ref: d.ref, role: data.role || '', unitName: data.unitName || '' };
      });
      var jobs = [];
      units.forEach(function (u) {
        var un = u.name || '';
        var scan = function (arr, role) {
          (arr || []).forEach(function (p) {
            if (!p || !p.fileName) return;
            var rec = mine[p.fileName];
            if (!rec) return;
            if (rec.role === role && rec.unitName === un) return;   // 바뀐 게 없음
            jobs.push(rec.ref.set({ role: role, unitName: un }, { merge: true }));
            n++;
          });
        };
        scan(u.before, 'before');
        scan(u.after, 'after');
        (u.specials || []).forEach(function (sp, si) { scan(sp.photos, 'special' + (si + 1)); });
      });
      if (jobs.length) await Promise.all(jobs);
      if (n) console.log('[CloudPhotoSync] 내가 올린 사진 위치(전/후·호수) ' + n + '건 반영');
    } catch (e) {
      console.warn('[CloudPhotoSync] 사진 위치 반영 실패', e && (e.code || e.message));
      try { if (typeof showToast === 'function') showToast('사진 위치를 상대에게 전달하지 못했습니다', 'err'); } catch (e2) {}
    }
    return n;
  };

  CloudPhotoSync.pushPhotoOrder = async function (workId, units, ownerUid, clearOrdered) {
    if (!loggedIn() || !hasActiveShare() || !workId || !Array.isArray(units)) return;
    var _tgtUid = ownerUid || myUid();
    var _isBorrowedMode = (_tgtUid !== myUid());   // 남의 작업 = 빌려보기 화면
    try {
      var po = {};
      units.forEach(function (u) {
        var mk = function (arr, role) {
          var list = [];
          (arr || []).forEach(function (p) {
            if (!p || !p.fileName) return;
            /* ⭐⭐ 2026-08-13 치명버그 수정 — 목록에 넣을 이름은 언제나 '그 사진 문서의 cloudName' 이다.
               내 작업 화면에서는 p.fileName 이 디스크 원본 파일명이라 변환이 필요하지만,
               공유작업(빌려보기) 화면에서는 p.fileName 이 **이미 cloudName** 이다.
               그대로 변환하면 이름이 두 번 감싸져(101호__before__101호__before__…)
               ① 순서가 아무 데도 안 맞고 ② 같은 키에 merge 되어
               **원작업자가 맞춰 둔 정상 순서를 쓰레기 값으로 덮어썼다.** */
            /* ★ 3단계: 이 실행에서 확인한 실제 문서 이름(_cloudName)이 있으면 그걸 쓴다.
               자리를 옮겨도 이름이 안 바뀌므로 상대와 순서 키가 어긋나지 않는다.
               (_cloudName 은 메모리 전용 — 없으면 예전처럼 계산해서 동작은 그대로) */
            list.push((p._borrowedIncoming || _isBorrowedMode) ? p.fileName
                      : (p._cloudName || _cpsCloudName(u.name, role, p.fileName)));
          });
          if (list.length) po[_cpsSafeId(u.name) + '__' + role] = list;
        };
        mk(u.before, 'before');
        mk(u.after, 'after');
        (u.specials || []).forEach(function (s, si) { mk(s.photos, 'special' + (si + 1)); });
      });
      var _payload = { photoOrder: po };
      if (_tgtUid !== myUid()) {
        _payload.orderedBy = myUid();
        _payload.orderedAt = Date.now();   // ⚠️ serverTimestamp 금지 - pending 중 null 로 읽혀 오판
      } else if (clearOrdered) {
        /* ⚠️ 표시 해제는 '내가 직접 순서를 바꿨을 때'만 한다.
           사진 저장(autoUploadPhotos)에서까지 지우면, 원작업자가 그 작업을 작업탭에
           열어 둔 채 상대가 순서를 바꿨을 때 → 로컬 반영은 'retry' 로 미뤄지는데
           표시만 지워져 **상대의 순서 변경이 흔적도 없이 사라진다.** */
        _payload.orderedBy = null;
      }
      await db().collection('schedules').doc(_tgtUid).collection('items').doc(safeId(workId))
        .set(_payload, { merge: true });
    } catch (e) {
      console.warn('[CloudPhotoSync] photoOrder 기록 실패', e && (e.code || e.message));
      /* ★ 2026-08-13: 예전엔 조용히 실패했다. 화면엔 '✓ 순서 변경 완료'가 떠서
         상대에게 전달됐다고 믿게 된다. 실패는 알려야 한다. */
      try {
        var _c = (e && (e.code || e.message)) || '';
        if (typeof showToast === 'function') {
          showToast(String(_c).indexOf('permission-denied') >= 0
            ? '순서를 상대에게 전달하지 못했습니다 (권한 없음)'
            : '순서를 상대에게 전달하지 못했습니다: ' + _c, 'err');
        }
      } catch (e2) {}
    }
  };

  /* ★ 2026-08-13: 상대(공유작업자)가 바꾼 사진 순서를 내 로컬 _session.json 에 반영한다.
     ⚠️ 절대 원칙 — 여기서 하는 일은 **순서 바꾸기(순열)뿐**이다.
        기존 메타 객체를 그대로 재배열만 하고, 추가·삭제·파일명 수정은 하지 않는다.
        (남의 폰 파일명을 내 세션에 쓰면 사진 참조가 깨지고 원본이 삭제될 수 있다)
        개수가 달라지면 그 배열은 통째로 포기한다.
     반환: true=반영함/변경없음, 'retry'=지금은 못 함(폴더 미연결·작업탭에 열려 있음), false=실패 */
  CloudPhotoSync.applyPhotoOrderToLocal = async function (workId, po) {
    try {
      if (!workId || !po || typeof po !== 'object') return false;
      if (String(workId).indexOf('m_') === 0) return false;          // 수동일정은 폴더가 없음
      CloudPhotoSync._lastOrderApply = { matched: 0, total: 0, changed: false };
      if (typeof photoFolderHandle === 'undefined' || !photoFolderHandle) return 'retry';
      /* ⭐ 2026-08-13 수정 — 예전엔 '작업탭에 열려 있으면' 메모리만 바꾸고 곧바로 return true 했다.
         그런데 _session.json 은 그대로라 작업을 다시 열면 옛 순서로 돌아갔고,
         '반영했다'로 기록돼 재시도도 없었다(배너에 0/0 으로 뜬 원인).
         ⚠️ currentFolderName 은 그 작업을 한 번이라도 연 뒤 계속 남아 있어서
            실제로는 대부분의 경우 이 길로 빠졌다.
         → 이제는 항상 파일을 고치고, 열려 있으면 화면(메모리)도 같이 맞춘다. */
      var _liveOpen = false;
      try {
        _liveOpen = (typeof currentFolderName !== 'undefined' && currentFolderName === workId
                     && typeof units !== 'undefined' && Array.isArray(units));
      } catch (e) {}
      var _applyLive = function () {
        if (!_liveOpen) return;
        try {
          var _memChanged = false;
          var _sortLive = function (arr, unitName, role) {
            if (!Array.isArray(arr) || arr.length < 2) return arr;
            var lst = po[_cpsSafeId(unitName) + '__' + role];
            if (!Array.isArray(lst) || !lst.length) return arr;
            var ix = {}; lst.forEach(function (n, i) { ix[n] = i; });
            var kk = arr.map(function (pp, i) {
              var fn = (pp && pp.fileName) || '';
              var k = (pp && pp._borrowedIncoming) ? ix[fn] : ix[_cpsCloudName(unitName, role, fn)];
              if (k === undefined) k = ix[fn];
              return { p: pp, i: i, k: (k === undefined ? Infinity : k) };
            });
            kk.sort(function (a, b) { return (a.k - b.k) || (a.i - b.i); });
            var o = kk.map(function (x) { return x.p; });
            for (var z = 0; z < o.length; z++) { if (o[z] !== arr[z]) { _memChanged = true; break; } }
            return o;
          };
          units.forEach(function (u) {
            var un = u.name || '';
            u.before = _sortLive(u.before, un, 'before');
            u.after  = _sortLive(u.after,  un, 'after');
            (u.specials || []).forEach(function (sp, si) { sp.photos = _sortLive(sp.photos, un, 'special' + (si + 1)); });
          });
          if (_memChanged) {
            try { if (typeof renderAll === 'function') renderAll(); } catch (e) {}
            try { if (typeof sessionAutoSaveNow === 'function') sessionAutoSaveNow(); } catch (e) {}
            console.log('[CloudPhotoSync] 열려 있는 작업 화면에도 순서 반영:', workId);
          }
        } catch (e) { console.warn('[CloudPhotoSync] 메모리 순서 반영 실패', e); }
      };
      /* ⭐ 2026-08-21 — 재설치 직후 온보딩에서 '반영하지 못했습니다' 배너가 뜨던 버그.
         작업 폴더나 _session.json 이 아직 없는 건 '실패'가 아니라 '아직 준비 안 됨'이다.
         (복구 전이거나 그 작업을 아직 안 받은 상태)
         false 로 돌려주면 cloud_share 가 빨간 실패 배너를 띄우고 재시도도 안 한다.
         폴더 핸들이 없을 때(위)와 똑같이 'retry' 로 돌려 조용히 다음 기회를 기다린다. */
      var dir;
      try { dir = await photoFolderHandle.getDirectoryHandle(workId); }
      catch (e) { console.log('[CloudPhotoSync] 순서 반영 보류 — 작업 폴더 없음(복구 전):', workId); return 'retry'; }
      var fh;
      try { fh = await dir.getFileHandle('_session.json'); }
      catch (e) { console.log('[CloudPhotoSync] 순서 반영 보류 — _session.json 없음:', workId); return 'retry'; }
      var sess = JSON.parse(await (await fh.getFile()).text());
      if (!sess || !Array.isArray(sess.units)) return false;

      var changed = false, _matched = 0, _total = 0;
      /* ── 임시 진단(2026-08-13) — '0/0' 이 ①맞출 사진이 없음 ②키 불일치 중 무엇인지 구분하기 위함.
         원인 확정되면 제거할 것. ── */
      var _dg = { keysIn: Object.keys(po || {}), skipShort: 0, skipNoKey: 0, sampleIn: '', sampleLocal: '' };
      try { if (_dg.keysIn.length) { var _k0 = _dg.keysIn[0]; var _l0 = po[_k0]; _dg.sampleIn = _k0 + ' → ' + ((_l0 && _l0[0]) || '(빈목록)'); } } catch (e) {}
      function sortMeta(arr, unitName, role) {
        if (!Array.isArray(arr) || arr.length < 2) { if (Array.isArray(arr) && arr.length) _dg.skipShort++; return arr; }
        var _key = _cpsSafeId(unitName) + '__' + role;
        var list = po[_key];
        if (!_dg.sampleLocal) {
          try { _dg.sampleLocal = _key + ' → ' + _cpsCloudName(unitName, role, (arr[0] && arr[0].fname) || ''); } catch (e) {}
        }
        if (!Array.isArray(list) || !list.length) { _dg.skipNoKey++; return arr; }
        var idx = {};
        list.forEach(function (n, i) { idx[n] = i; });
        var keyed = arr.map(function (m, i) {
          var fn = (m && m.fname) || '';
          _total++;
          var k = idx[_cpsCloudName(unitName, role, fn)];
          if (k === undefined) k = idx[fn];            // 옛 문서(파일명 그대로) 대비
          if (k !== undefined) _matched++;
          return { m: m, i: i, k: (k === undefined ? Infinity : k) };
        });
        keyed.sort(function (a, b) { return (a.k - b.k) || (a.i - b.i); });   // 모르는 건 뒤로, 안정 정렬
        var out = keyed.map(function (x) { return x.m; });
        if (out.length !== arr.length) return arr;     // 안전장치: 개수가 달라지면 포기
        for (var z = 0; z < out.length; z++) { if (out[z] !== arr[z]) { changed = true; break; } }
        return out;
      }
      sess.units.forEach(function (u) {
        var un = u.name || '';
        u.beforeMeta = sortMeta(u.beforeMeta, un, 'before');
        u.afterMeta  = sortMeta(u.afterMeta,  un, 'after');
        (u.specials || []).forEach(function (sp, si) {
          sp.photosMeta = sortMeta(sp.photosMeta, un, 'special' + (si + 1));
        });
      });
      CloudPhotoSync._lastOrderApply = { matched: _matched, total: _total, changed: changed, dg: _dg };
      console.log('[CloudPhotoSync] 순서 진단', JSON.stringify(_dg));
      if (!changed) {
        console.log('[CloudPhotoSync] 순서 반영: 바뀔 것 없음 (일치 ' + _matched + '/' + _total + ')');
        _applyLive();
        if (_matched > 0) return true;
        /* 내 사진이 2장 미만인 칸만 있었다면 애초에 맞출 게 없다 = 실패가 아니다.
           (상대 사진과의 끼워넣기 순서는 작업을 열 때 _cpsInsertByOrder 가 photoOrder 로 처리한다) */
        if (_total === 0 && _dg.skipNoKey === 0) return 'nothing';
        return 'nomatch';
      }
      // 로컬이 최신임을 표시(안 하면 syncAll 충돌 가드가 내 이후 업로드를 막는다)
      try { sess.savedAt = (typeof kstIsoString === 'function') ? kstIsoString() : new Date().toISOString(); } catch (e) {}
      var wh = await dir.getFileHandle('_session.json', { create: true });
      var wr2 = await wh.createWritable();
      await wr2.write(new Blob([JSON.stringify(sess, null, 2)], { type: 'application/json' }));
      await wr2.close();
      console.log('[CloudPhotoSync] 상대가 바꾼 사진 순서를 로컬에 반영:', workId, '(일치 ' + _matched + '/' + _total + ')');
      _applyLive();
      try { if (window.__calendarRefresh) window.__calendarRefresh(); } catch (e) {}
      return true;
    } catch (e) { console.warn('[CloudPhotoSync] 순서 반영 실패', workId, e); return false; }
  };

  /* ──────────────────────────────────────────
     "같은 작업에 진짜 보태기" ─ 공유 작업(빌려보기)을 작업탭에서 열어
     새 사진을 추가로 찍고 저장했을 때, 내 로컬 폴더가 아니라
     원본 소유자의 클라우드 항목(schedules/{ownerUid}/items/{workId})에
     실제로 병합해 넣는다. dialogs.js의 saveToFolder()가
     window._borrowedShare 를 감지하면 일반 저장 대신 이 함수를 호출한다.
     - 새 사진(fileName 없고 dataUrl만 있는 것)만 대상 - 이미 받은 원본 사진은 건너뜀
     - 로컬 저장 위치도 다운로드와 동일한 격리 폴더: _shared/{ownerUid}/{workId}/
     - Storage 업로드 경로도 원본 소유자 네임스페이스 그대로: sharedPhotos/{ownerUid}/{workId}/{fname}
  ────────────────────────────────────────── */
  async function getBorrowedMirrorDir(ownerUid, workId){
    var handle = await _cpsEnsureFolderHandle();
    if (!handle) throw new Error('저장 폴더 미설정');
    var root = await handle.getDirectoryHandle('_shared', { create: true });
    var ownerDir = await root.getDirectoryHandle(safeId(ownerUid), { create: true });
    return await ownerDir.getDirectoryHandle(safeId(workId), { create: true });
  }

  function genBorrowedFileName(){
    return 'add_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.jpg';
  }

  async function uploadBorrowedOne(ownerUid, workId, unitName, role, photo, dir){
    if (!photo || !photo.dataUrl || typeof dataURLtoBlob !== 'function') return false;
    var blob = dataURLtoBlob(photo.dataUrl);
    if (!blob || !blob.size) return false;

    // ★ 중복 업로드 방지(2026-08-05): 파일명을 '사진의 고유 id' 기반으로 결정적 생성.
    //   (이전엔 호출마다 랜덤 add_ 이름 → 저장 트리거가 겹쳐 saveBorrowedPhotos가 동시에 돌면
    //    같은 사진이 서로 다른 이름의 2개 문서로 올라가 원작업자 화면에 '같은 사진 2장'으로 보였음.
    //    결정적 이름이면 동시에 올려도 같은 문서에 덮어써져 1장으로 수렴.)
    var _stableId = photo.id ? String(photo.id) : (Date.now() + '_' + Math.random().toString(36).slice(2, 8));
    var fname = photo._borrowedName || ('add_' + safeId(_stableId) + '.jpg');
    photo._borrowedName = fname;

    var fh = await dir.getFileHandle(fname, { create: true });
    var w = await fh.createWritable();
    await w.write(blob);
    await w.close();

    var storagePath = 'sharedPhotos/' + safeId(ownerUid) + '/' + safeId(workId) + '/' + fname;
    await stg().ref(storagePath).put(blob, { contentType: 'image/jpeg' });

    var photoId = safeId(fname);
    await db().collection('schedules').doc(ownerUid).collection('items').doc(safeId(workId))
      .collection('photos').doc(photoId).set({
        fname: fname,
        cloudName: fname,             // ★ add_ 파일명은 이미 전역 유일 → 그대로 로컬 미러 이름으로 사용
        unitName: unitName || '',
        role: role || '',
        storagePath: storagePath,
        size: blob.size || 0,
        addedBy: myUid(),
        uploadedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

    // 썸네일(부가) - 백그라운드로(사진 저장을 막지 않음)
    _cpsUploadThumb(ownerUid, workId, fname, blob).then(function (_bt) {
      if (_bt) db().collection('schedules').doc(ownerUid).collection('items').doc(safeId(workId))
        .collection('photos').doc(photoId).set({ thumbPath: _bt }, { merge: true }).catch(function () {});
    }).catch(function () {});

    photo.fileName = fname;
    photo.savedToFolder = true;
    photo.hasOriginal = true;
    photo._cloudUploaded = true;
    photo._addedByMe = true;   // ★ 내가 공유작업에 올린 사진 → 나는 삭제 가능
    return true;
  }

  // 공유작업(남의 작업)에 내가 올린 사진을 서버에서 삭제 (내가 올린 것만). 원작업자는 live sync로 자동 제거됨
  CloudPhotoSync.deleteBorrowedPhoto = async function (ownerUid, workId, photo) {
    if (!loggedIn() || !ownerUid || !workId || !photo || !photo.fileName) return false;
    var photoId = safeId(photo.fileName);
    var col = db().collection('schedules').doc(safeId(ownerUid)).collection('items').doc(safeId(workId)).collection('photos');
    try {
      var docSnap = await col.doc(photoId).get();
      var data = docSnap.exists ? (docSnap.data() || {}) : null;
      if (data && data.addedBy && data.addedBy !== myUid()) return false;   // 남이 올린 것은 삭제 금지
      var sp = (data && data.storagePath) || ('sharedPhotos/' + safeId(ownerUid) + '/' + safeId(workId) + '/' + photo.fileName);
      try { await stg().ref(sp).delete(); } catch (e) { console.warn('[사진동기화] 사진 삭제 실패:', sp, e && (e.code || e.message)); }
      if (data && data.thumbPath) { try { await stg().ref(data.thumbPath).delete(); } catch (e) { console.warn('[사진동기화] 썸네일 삭제 실패:', data.thumbPath, e && (e.code || e.message)); } }
      await col.doc(photoId).delete();
      // 스케줄 배지(공유 N) 갱신용 addedPhotos 감소
      try {
        await db().collection('schedules').doc(safeId(ownerUid)).collection('items').doc(safeId(workId))
          .set({ addedPhotos: firebase.firestore.FieldValue.increment(-1) }, { merge: true });
      } catch (e) {}
      try {
        var handle = await _cpsEnsureFolderHandle();
        if (handle) {
          var root = await handle.getDirectoryHandle('_shared', { create: true });
          var od = await root.getDirectoryHandle(safeId(ownerUid), { create: true });
          var mdir = await od.getDirectoryHandle(safeId(workId), { create: true });
          try { await mdir.removeEntry(photo.fileName); } catch (e) {}
        }
      } catch (e) {}
      return true;
    } catch (e) { console.warn('[CloudPhotoSync] 공유사진 삭제 실패', e && e.message); return false; }
  };

  CloudPhotoSync.saveBorrowedPhotos = async function (units) {
    var b = window._borrowedShare;
    if (!loggedIn() || !b || !b.ownerUid || !b.workId) return { uploaded: 0 };
    if (!Array.isArray(units)) return { uploaded: 0 };
    // ★ 동시 실행 방지: 저장 트리거가 겹쳐도 업로드가 두 번 돌지 않게 잠금(중복 업로드/알림 방지)
    if (CloudPhotoSync._savingBorrowed) return { uploaded: 0, busy: true };
    CloudPhotoSync._savingBorrowed = true;
    try {

    var dir = await getBorrowedMirrorDir(b.ownerUid, b.workId);
    var uploaded = 0;

    for (var ui = 0; ui < units.length; ui++) {
      var u = units[ui];
      var jobs = [];
      (u.before || []).forEach(function (p) {
        if (!p.savedToFolder && !p._cloudUploaded && p.dataUrl) jobs.push({ p: p, role: 'before' });
      });
      (u.after || []).forEach(function (p) {
        if (!p.savedToFolder && !p._cloudUploaded && p.dataUrl) jobs.push({ p: p, role: 'after' });
      });
      (u.specials || []).forEach(function (s, si) {
        (s.photos || []).forEach(function (p) {
          if (!p.savedToFolder && !p._cloudUploaded && p.dataUrl) jobs.push({ p: p, role: 'special' + (si + 1) });
        });
      });
      for (var ji = 0; ji < jobs.length; ji++) {
        try {
          var ok = await uploadBorrowedOne(b.ownerUid, b.workId, u.name, jobs[ji].role, jobs[ji].p, dir);
          if (ok) uploaded++;
        } catch (e) {
          console.warn('[CloudPhotoSync] 병합 사진 업로드 실패', e && e.message);
        }
      }
    }

    if (uploaded > 0) {
      try {
        // ★ 원본 소유자에게 알림 - "새 사진 도착"과는 반대 방향(내가 소유자 항목에 보탠 것)이라
        //   별도 nonce 필드 사용, functions/index.js의 onBorrowedPhotoAdded가 감지해 소유자에게 푸시
        await db().collection('schedules').doc(b.ownerUid).collection('items').doc(safeId(b.workId))
          .set({
            // ★ 2026-07-11: 내(공유작업자)가 보탠 사진은 addedPhotos로 따로 셈 (totalPhotos=원작업자 사진 수 유지)
            addedPhotos: firebase.firestore.FieldValue.increment(uploaded),
            lastBorrowedUploadNonce: 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            lastBorrowedUploadCount: uploaded,
            lastBorrowedUploadAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
      } catch (e) { console.warn('[CloudPhotoSync] totalPhotos/알림신호 갱신 실패', e && e.message); }
    }

    return { uploaded: uploaded };
    } finally { CloudPhotoSync._savingBorrowed = false; }
  };

  /* ──────────────────────────────────────────
     기존 작업 재동기화 (설정 버튼)
     - 이미 저장된 "내 작업"들의 사진을 최신 규칙(cloudName)으로 다시 올리고
       편집(순서변경/삭제/이동)으로 사라진 사진은 클라우드에서 정리(reconcile)
     - 공유 중일 때만 동작, 로컬 폴더 없는 작업은 건너뜀(클라우드 사진 보존)
     - 알림(nonce)은 생략(silent) → 상대에게 대량 푸시가 가지 않음
  ────────────────────────────────────────── */
  /* ──────────────────────────────────────────
     원작업자가 "상대가 보탠 사진"을 받아 표시 (A)
     - 상대(공유작업자)가 saveBorrowedPhotos로 올린 사진은 내(원작업자) 클라우드
       schedules/{myUid}/items/{workId}/photos 에 addedBy=상대uid 로 들어있다.
     - 내 작업을 열 때(restoreFromData 끝) 호출 → addedBy≠나 인 사진을 로컬 미러
       (_shared/{myUid}/{workId}/)로 받아 units에 병합해 화면에 표시한다.
     - _borrowedIncoming=true 로 표시 → 내 _session.json에는 저장 안 함(열 때마다 재병합,
       이미 받은 파일은 미러에 있어 재다운로드 안 함 → 빠름).
  ────────────────────────────────────────── */
  CloudPhotoSync.pullBorrowedAdditions = async function (workId, units) {
    if (!loggedIn() || !workId || !Array.isArray(units)) return { pulled: 0 };
    if (!hasActiveShare()) return { pulled: 0 };
    var handle = await _cpsEnsureFolderHandle();
    if (!handle) return { pulled: 0 };

    var snap;
    try { snap = await itemPhotosCol(workId).get(); }
    catch (e) { console.warn('[CloudPhotoSync] 상대사진 조회 실패', e && e.code); return { pulled: 0 }; }
    // ★ 표시 순서(photoOrder) 조회 - 내가 정한 순서 위치에 상대 사진을 끼워넣기 위함(없으면 맨 뒤)
    var _po = null;
    try {
      var _itemSnap = await db().collection('schedules').doc(myUid()).collection('items').doc(safeId(workId)).get();
      _po = (_itemSnap.exists && _itemSnap.data() && _itemSnap.data().photoOrder) || null;
    } catch (e) {}

    // ★ 자가치유(2026-07-11): 과거 버그로 생긴 "내 소유인데 내 로컬엔 없는" 유령/중복 문서를 열 때도 정리
    //   (저장 시 reconcile과 동일 규칙. 상대 기여분(addedBy)은 절대 안 건드림.
    //    "사진 없이 불러온" 작업이나 내 사진이 0장인 경우는 오판 위험이 있어 건너뜀)
    try {
      var _skipClean = units.some(function (u) { return u && u._photosOnDisk && u._photosOnDisk.skipPhotoSync; });
      var _keep = {};
      var _keepByFname = {};
      var _localPids2 = {};   // ★ 3단계: 화면에 살아 있는 사진 고유번호
      var _ownCount = 0;
      units.forEach(function (u) {
        var mk2 = function (arr, role) {
          (arr || []).forEach(function (p) {
            if (p && p.fileName && !p._borrowedIncoming) {
              var _n2 = _cpsCloudName(u.name, role, p.fileName);
              _keep[_n2] = 1; _keepByFname[(u.name || '') + '|' + p.fileName] = _n2; _ownCount++;
              if (p.id) _localPids2[p.id] = 1;
            }
          });
        };
        mk2(u.before, 'before');
        mk2(u.after, 'after');
        (u.specials || []).forEach(function (s, si) { mk2(s.photos, 'special' + (si + 1)); });
      });
      if (!_skipClean && _ownCount > 0) {
        var _exist2 = {};
        snap.forEach(function (d) { var dd = d.data() || {}; _exist2[dd.cloudName || d.id] = 1; });
        var _dels = [];
        snap.forEach(function (d) {
          var data = d.data() || {};
          if (data.addedBy) return; // 상대 기여분 보존
          var cn = data.cloudName || _cpsCloudName(data.unitName, data.role, data.fname);
          if (data.pid && _localPids2[data.pid]) return;   // ★ 3단계: 고유번호가 살아 있으면 보존
          if (_keep[cn]) return;
          /* ★ 2026-08-13 안전장치(다른 정리 지점과 동일) — 자리를 옮겨 이름이 바뀐 경우,
             새 이름이 서버에 실제로 있을 때만 옛 것을 지운다. 없으면 = 아직 안 올라감 → 보존.
             (여기도 예전엔 무조건 지워서 사진이 사라질 수 있는 두 번째 지점이었다) */
          var _mv = data.fname && _keepByFname[(data.unitName || '') + '|' + data.fname];
          if (_mv && !_exist2[_mv]) {
            console.warn('[사진동기화] 이동한 사진의 새 업로드가 아직 없어 옛 것을 지우지 않음:', cn);
            return;
          }
          _dels.push({ ref: d.ref, sp: data.storagePath, tp: data.thumbPath });
        });
        for (var _di = 0; _di < _dels.length; _di++) {
          if (_dels[_di].sp) { try { await stg().ref(_dels[_di].sp).delete(); } catch (e) { console.warn('[사진동기화] 원본 삭제 실패:', _dels[_di].sp, e && (e.code || e.message)); } }
          if (_dels[_di].tp) { try { await stg().ref(_dels[_di].tp).delete(); } catch (e) { console.warn('[사진동기화] 썸네일 삭제 실패:', _dels[_di].tp, e && (e.code || e.message)); } }
          try { await _dels[_di].ref.delete(); } catch (e) { console.warn('[사진동기화] 문서 삭제 실패:', e && (e.code || e.message)); }
        }
        if (_dels.length) console.log('[CloudPhotoSync] 열기 자가치유: 유령 사진 문서 ' + _dels.length + '건 정리');
      }
    } catch (e) { console.warn('[CloudPhotoSync] 열기 자가치유 실패', e && (e.code || e.message)); }

    var incoming = [];
    var _addedCnt = 0; // ★ 상대가 보탠 사진 총수 (스케줄 카드 구분 표시용)
    snap.forEach(function (d) {
      var data = d.data() || {};
      if (!data.addedBy || data.addedBy === myUid()) return; // 상대가 보탠 것만
      _addedCnt++;
      if (!data.storagePath) return;                          // 만료/삭제된 건 제외
      incoming.push(data);
    });
    // ★ addedPhotos 필드 보정(자가치유): 실제 문서 수와 다르면 맞춰 씀
    try {
      var _curAdded = (typeof _itemSnap !== 'undefined' && _itemSnap && _itemSnap.exists) ? ((_itemSnap.data() || {}).addedPhotos || 0) : 0;
      if (_curAdded !== _addedCnt) {
        db().collection('schedules').doc(myUid()).collection('items').doc(safeId(workId))
          .set({ addedPhotos: _addedCnt }, { merge: true }).catch(function () {});
      }
    } catch (e) {}
    // ★ 삭제 반영(2026-07-24): 내가 갖고 있는 _borrowedIncoming 사진 중, 클라우드(상대 문서)에서 사라진 것 제거.
    //   (pullBorrowedAdditions가 '추가'만 하고 '삭제'를 안 해서, 상대가 지운 사진이 내 화면에 계속 남던 문제)
    var _srvBorrowed = {};
    snap.forEach(function (d) { var _d = d.data() || {}; if (_d.addedBy && _d.addedBy !== myUid()) { var _ln = _d.cloudName || _d.fname; if (_ln) _srvBorrowed[_ln] = 1; } });
    var _rmAny = false;
    units.forEach(function (u) {
      var filt = function (arr) {
        if (!arr) return arr;
        var b = arr.length;
        var out = arr.filter(function (p) { return !(p && p._borrowedIncoming && p.fileName && !_srvBorrowed[p.fileName]); });
        if (out.length !== b) _rmAny = true;
        return out;
      };
      u.before = filt(u.before); u.after = filt(u.after);
      (u.specials || []).forEach(function (s) { s.photos = filt(s.photos); });
    });
    if (_rmAny) {
      if (typeof renderAll === 'function') renderAll();
      if (typeof updateStats === 'function') updateStats();
      if (typeof sessionAutoSave === 'function') { try { sessionAutoSave(); } catch (e) {} }
      console.log('[CloudPhotoSync] 상대가 삭제한 사진 제거 반영');
    }

    if (!incoming.length) return { pulled: 0 };

    var mdir;
    try {
      var root = await handle.getDirectoryHandle('_shared', { create: true });
      var od = await root.getDirectoryHandle(safeId(myUid()), { create: true });
      mdir = await od.getDirectoryHandle(safeId(workId), { create: true });
    } catch (e) { console.warn('[CloudPhotoSync] 상대사진 미러 폴더 실패', e && e.message); return { pulled: 0 }; }

    // 정렬: fname 순(상대 add_ 이름 → 뒤에 붙음)
    incoming.sort(function (a, b) { var fa=a.cloudName||a.fname||'', fb=b.cloudName||b.fname||''; return fa<fb?-1:fa>fb?1:0; });

    // 이미 units에 병합된 파일명 집합
    var have = {};
    units.forEach(function (u) {
      var arrs = [u.before||[], u.after||[]];
      (u.specials||[]).forEach(function(s){ arrs.push(s.photos||[]); });
      arrs.forEach(function(arr){ arr.forEach(function(p){ if (p && p.fileName) have[p.fileName] = 1; }); });
    });

    var pulled = 0;
    var _pullTotal = incoming.length;
    var _pullOv = false;
    for (var i = 0; i < incoming.length; i++) {
      var data = incoming[i];
      // ★ 진행표시(2026-07-11): "몇 장 중 몇 장" 안내
      if (typeof showOverlay === 'function') { _pullOv = true; showOverlay('📥 상대 사진을 가져오는 중입니다 ' + (i + 1) + '/' + _pullTotal + '장'); }
      var localName = data.cloudName || data.fname;
      if (!localName || have[localName]) continue;

      var haveLocal = false;
      try { await mdir.getFileHandle(localName, { create: false }); haveLocal = true; } catch (e) {}
      if (!haveLocal) {
        try {
          var blob = await _cpsFetchBlob(data.storagePath);
          var fh = await mdir.getFileHandle(localName, { create: true });
          var w = await fh.createWritable(); await w.write(blob); await w.close();
        } catch (e) { console.warn('[CloudPhotoSync] 상대사진 다운로드 오류', localName, e && e.message); continue; }
      }

      var target = null;
      for (var t = 0; t < units.length; t++) { if ((units[t].name || '') === (data.unitName || '')) { target = units[t]; break; } }
      /* ⭐ 2026-08-13 데이터 오염 수정 — 예전엔 모르는 호수면 무조건 첫 호수에 넣었다.
         공유작업자가 새 호수를 만들어 찍은 사진이 원작업자 쪽에서 전부 첫 호수에
         처박혀 섞였다. 이름이 있으면 그 호수를 만들어서 제자리에 넣는다. */
      if (!target) {
        var _newUn = String((data && data.unitName) || '').trim();
        if (_newUn) {
          target = { id: (typeof nid !== 'undefined' ? nid++ : (units.length + 1)), name: _newUn,
                     before: [], after: [], specials: [], open: true, customerOpen: true,
                     customer: { phone: '', address: '', memo: '' } };
          units.push(target);
          /* ★ 2026-08-13: 호수가 2개 이상이면 이 앱에서는 '공용시설'이다(가정용은 1호수 전용 —
             events.js addUnit 이 가정용에서 호수 추가를 막는다). 상대가 호수를 늘려 보낸 것이므로
             작업유형도 같이 맞춘다. 안 맞추면 '가정용인데 호수 2개'라는 규칙 위반 상태가 되고
             원작업자 화면에서는 호수 추가 버튼도 막힌다. */
          try {
            if (typeof currentWorkType !== 'undefined' && currentWorkType !== 'facility' && units.length > 1) {
              currentWorkType = 'facility';
              if (typeof facilityCustomer !== 'undefined' && !facilityCustomer) facilityCustomer = { phone: '', contact: '', address: '', memo: '' };
              if (typeof applyWorkTypeUI === 'function') applyWorkTypeUI();
              console.log('[CloudPhotoSync] 호수 2개 이상 → 공용시설로 전환');
            }
          } catch (e) { console.warn('[CloudPhotoSync] 작업유형 전환 실패', e); }
          console.log('[CloudPhotoSync] 상대 사진 수신 → 새 호수 자동 생성:', _newUn);
        } else {
          target = units[0];
        }
      }
      if (!target) continue;

      var photoObj = {
        id: 'in_' + Date.now() + '_' + i,
        fileName: localName, _workDir: mdir, dataUrl: null,
        savedToFolder: true, hasOriginal: true, _cloudUploaded: true,
        _borrowedIncoming: true
      };
      var role = data.role || 'before';
      var m = /^special(\d+)$/.exec(role);
      if (role === 'after') { target.after = target.after || []; _cpsInsertByOrder(target.after, photoObj, target.name, 'after', _po); }
      else if (m) {
        var si = parseInt(m[1], 10) - 1;
        target.specials = target.specials || [];
        while (target.specials.length <= si) target.specials.push({ desc: '', photos: [] });
        _cpsInsertByOrder(target.specials[si].photos, photoObj, target.name, 'special' + (si + 1), _po);
      } else { target.before = target.before || []; _cpsInsertByOrder(target.before, photoObj, target.name, 'before', _po); }
      have[localName] = 1;
      pulled++;
    }

    if (_pullOv && typeof hideOverlay === 'function') { try { hideOverlay(); } catch (eOv) {} }

    if (pulled > 0) {
      _cpsDedupUnits();   // ★ 경합으로 인한 중복 사진 방어
      if (typeof renderAll === 'function') renderAll();
      if (typeof updateStats === 'function') updateStats();
      if (typeof startLazyPhotoLoading === 'function') setTimeout(function(){ try{ startLazyPhotoLoading(); }catch(e){} }, 300);
      if (typeof showToast === 'function') showToast('📥 상대가 추가한 사진 ' + pulled + '장을 받았습니다', 'ok');
    }
    return { pulled: pulled };
  };

  /* ── 작업탭이 열려 있는 동안 실시간 동기화 (onSnapshot) ──
     상대가 추가/삭제한 사진을 열린 작업탭에 즉시 반영한다.
     - ownerUid: 이 작업의 소유자(내 작업이면 내 uid), workId: 폴더명(=클라우드 항목 id)
     - _borrowedIncoming 으로 표시 → 내 세션에는 저장 안 됨(pull과 동일 규칙) */
  var _livePhotoUnsub = null;
  var _liveItemUnsub = null;   // ★ 항목 문서 구독(원작업자 삭제 감지, 2026-07-11)
  var _liveKey = '';
  var _liveBusy = false;
  var _livePending = null;   // 처리 중 도착한 최신 스냅샷 예약(버리지 않음)
  var _liveSnapDeb = null;   // 스냅샷 디바운스 타이머
  var _lastArrSig = {};      // key -> {phys, arr} : 순서/위치 변경 감지용 배치 서명

  CloudPhotoSync.stopLivePhotoSync = function () {
    if (_livePhotoUnsub) { try { _livePhotoUnsub(); } catch (e) {} }
    if (_liveItemUnsub) { try { _liveItemUnsub(); } catch (e) {} }
    _livePhotoUnsub = null; _liveItemUnsub = null; _liveKey = '';
    clearTimeout(_liveSnapDeb);
    _cpsRemoveReorderBanner();   // 작업 닫힘/전환 시 배너 정리
  };

  // ★ 원작업자가 작업을 삭제(휴지통/완전삭제)했을 때: 안내 후 새 작업으로 전환 (2026-07-11)
  function _cpsHandleSharedWorkDeleted() {
    try { CloudPhotoSync.stopLivePhotoSync(); } catch (e) {}
    try { alert('⚠️ 원작업자가 이 작업을 삭제했습니다.\n\n새 작업으로 전환합니다.'); } catch (e) {}
    try {
      window._borrowedShare = null;
      if (typeof units !== 'undefined' && Array.isArray(units)) units.length = 0; // 비워서 newWork가 확인창 없이 즉시 초기화하게
      if (typeof newWork === 'function') { newWork(); return; }
    } catch (e) { console.warn('[CloudPhotoSync] 삭제 전환 실패', e && e.message); }
    // 폴백: newWork가 없으면 화면만 초기화
    try { if (typeof renderAll === 'function') renderAll(); } catch (e) {}
    try { if (typeof updateStats === 'function') updateStats(); } catch (e) {}
  }

  /* ── 순서/위치 변경(이동·재정렬) 감지 + '다시 불러오기' 배너 ──────────────────
     사용자 요청(2026-08-05): 사진 '추가'는 지금처럼 라이브 반영하되,
     사진의 순서/위치(작업전↔작업후 이동 포함)가 바뀌어 저장된 경우에는
     라이브로 억지 반영하지 않고 상단 배너로 '작업을 다시 불러와 주세요'만 안내한다.
     (라이브 이동 반영은 이벤트 순서/타이밍 때문에 겹침·중복이 생기기 쉬움) */

  // 배치 서명: phys=어떤 사진들이 있는지(순서 무시), arr=각 (호수+구분)별 나열 순서(역할이동+순서변경 감지)
  function _cpsArrSig(docs, po) {
    var physList = docs.map(function (d) { return (d.unitName || '') + '|' + (d.fname || d.cloudName || ''); });
    physList.sort();
    var groups = {};  // unit__role -> { list:[fname...], cloud:{cloudName:fname} }
    docs.forEach(function (d) {
      var k = _cpsSafeId(d.unitName || '') + '__' + (d.role || '');
      if (!groups[k]) groups[k] = { list: [], cloud: {} };
      var fn = d.fname || d.cloudName || '';
      groups[k].list.push(fn);
      groups[k].cloud[d.cloudName] = fn;
    });
    var arrParts = [];
    Object.keys(groups).sort().forEach(function (k) {
      var g = groups[k], ordered;
      if (po && Array.isArray(po[k])) {
        ordered = po[k].map(function (cn) { return g.cloud[cn]; }).filter(Boolean);
        g.list.forEach(function (fn) { if (ordered.indexOf(fn) === -1) ordered.push(fn); });
      } else {
        ordered = g.list.slice().sort();
      }
      arrParts.push(k + ':' + ordered.join('>'));
    });
    return { phys: physList.join(','), arr: arrParts.join(';') };
  }

  // 서버의 현재 배치를 이전 배치와 비교 → '구성 동일 + 배치 변경'이면 순서변경으로 판정
  async function _cpsReorderCheck(ownerUid, workId) {
    if (ownerUid === myUid()) return false;   // 내 소유 작업은 대상 아님(빌려본 작업만)
    try {
      var itemRef = db().collection('schedules').doc(safeId(ownerUid)).collection('items').doc(safeId(workId));
      var psnap = await itemRef.collection('photos').get();
      var docs = [];
      psnap.forEach(function (d) {
        var x = d.data() || {};
        // ★ 2026-08-05: 내가 보탠 사진도 포함해서 전체 배치를 본다.
        //   (원작업자가 '내가 보낸 사진'의 순서를 바꾼 경우도 배치 변경으로 감지 → 상단 배너 표시.
        //    추가/삭제는 phys가 달라져 순서변경으로 오판되지 않음.)
        docs.push({ cloudName: x.cloudName || d.id, fname: x.fname || x.cloudName || d.id, unitName: x.unitName || '', role: x.role || '' });
      });
      var idoc = await itemRef.get();
      var idata = (idoc.exists && idoc.data()) || {};
      var po = idata.photoOrder || null;
      var sig = _cpsArrSig(docs, po);
      var key = safeId(ownerUid) + '|' + safeId(workId);
      var prev = _lastArrSig[key];
      _lastArrSig[key] = sig;
      /* ⭐ 2026-08-13: 내가 방금 바꾼 순서에도 배너가 떴다.
         (내가 원작업자 문서에 photoOrder 를 쓰면 내 구독이 그 변경을 감지해
          '상대가 순서를 변경했어요 → 다시 불러오기' 를 나에게 띄운다.
          거기서 다시 불러오면 방금 내가 바꾼 순서가 되돌아간 것처럼 보였다.)
         → 마지막으로 순서를 쓴 사람이 나면 배너를 띄우지 않는다.
         비교 기준(_lastArrSig)은 위에서 이미 갱신했으므로 다음 진짜 변경은 정상 감지된다. */
      if (idata.orderedBy && idata.orderedBy === myUid()) return false;
      return !!(prev && prev.phys === sig.phys && prev.arr !== sig.arr);
    } catch (e) { return false; }
  }

  /* ★ 2026-08-13 (사용자 요청) 원작업자에게도 배너.
     상대가 사진 순서를 바꾸면 자동으로 로컬에 반영하는데, 조용히 실패하면 알 길이 없었다.
     결과를 배너로 보여준다 — 성공하면 몇 장 맞췄는지, 실패하면 이유와 '다시 시도' 버튼. */
  CloudPhotoSync.showOwnerOrderBanner = function (workId, status, info) {
    try {
      _cpsRemoveReorderBanner();
      var bar = document.createElement('div');
      bar.id = 'cpsReorderBanner';
      // 'nothing' = 바꿀 게 없었던 정상 상태 → 빨간색(오류)으로 보이면 안 된다
      var ok = (status === 'ok' || status === 'nothing');
      bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:3000;background:' +
        (ok ? 'var(--ac,#2f6fed)' : '#b4453a') +
        ';color:#fff;padding:10px 12px;display:flex;align-items:center;gap:10px;font-size:13px;box-shadow:0 2px 12px rgba(0,0,0,.35);';
      var msg = document.createElement('span');
      msg.style.cssText = 'flex:1;line-height:1.4;';
      var m = (info && info.matched) || 0, t = (info && info.total) || 0;
      if (ok) msg.textContent = '상대가 사진 순서를 변경했어요. 이 작업에 반영했습니다. (사진 ' + m + '/' + t + '장)';
      else if (status === 'retry') msg.textContent = '상대가 사진 순서를 변경했어요. 지금은 반영할 수 없어 잠시 뒤 다시 시도합니다.';
      else if (status === 'nothing') msg.textContent = '상대가 사진 순서를 변경했어요. 작업을 열면 그 순서로 보입니다. (이 작업의 내 사진끼리는 바꿀 순서가 없었습니다)';
      else if (status === 'nomatch') {
        var _d = (info && info.dg) || {};
        msg.textContent = '순서를 반영하지 못했습니다 (일치 ' + m + '/' + t + '장). '
          + '[진단] 받은키 ' + ((_d.keysIn && _d.keysIn.length) || 0) + '개 · 짧아서건너뜀 ' + (_d.skipShort || 0)
          + ' · 키없음 ' + (_d.skipNoKey || 0) + ' | 받음: ' + (_d.sampleIn || '-') + ' | 내계산: ' + (_d.sampleLocal || '-');
        msg.style.fontSize = '11px';
        msg.style.wordBreak = 'break-all';
      }
      else msg.textContent = '상대가 사진 순서를 변경했는데 반영하지 못했습니다.';
      var again = document.createElement('button');
      again.textContent = ok ? '확인' : '다시 시도';
      again.style.cssText = 'background:#fff;color:#333;border:none;border-radius:7px;padding:7px 12px;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap;';
      again.onclick = function () {
        // 2026-08-13: 예전엔 여기서 탭을 옮겨 '열기를 눌렀는데 스케줄로 튕기는' 문제가 있었다.
        //   탭 이동 없이 달력 데이터만 새로 읽는다.
        _cpsRemoveReorderBanner();
        try { if (window.__calendarRefresh) window.__calendarRefresh(); } catch (e) {}
      };
      var close = document.createElement('button');
      close.textContent = '✕';
      close.style.cssText = 'background:transparent;color:#fff;border:none;font-size:16px;line-height:1;cursor:pointer;padding:4px 6px;';
      close.onclick = _cpsRemoveReorderBanner;
      bar.appendChild(msg); bar.appendChild(again); bar.appendChild(close);
      document.body.appendChild(bar);
    } catch (e) {}
  };

  function _cpsRemoveReorderBanner() {
    try { var b = document.getElementById('cpsReorderBanner'); if (b && b.parentNode) b.parentNode.removeChild(b); } catch (e) {}
  }

  function _cpsShowReorderBanner(ownerUid, workId) {
    try {
      if (document.getElementById('cpsReorderBanner')) return;  // 이미 떠 있음
      var bar = document.createElement('div');
      bar.id = 'cpsReorderBanner';
      bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:3000;background:var(--ac,#2f6fed);color:#fff;padding:10px 12px;display:flex;align-items:center;gap:10px;font-size:13px;box-shadow:0 2px 12px rgba(0,0,0,.35);';
      var msg = document.createElement('span');
      msg.style.cssText = 'flex:1;line-height:1.4;';
      msg.textContent = '상대가 사진 순서를 변경했어요. 최신 상태로 보려면 작업을 다시 불러와 주세요.';
      var reload = document.createElement('button');
      reload.textContent = '다시 불러오기';
      reload.style.cssText = 'background:#fff;color:var(--ac,#2f6fed);border:none;border-radius:7px;padding:7px 12px;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap;';
      reload.onclick = function () {
        _cpsRemoveReorderBanner();
        try { if (CloudPhotoSync.openInWorkTab) CloudPhotoSync.openInWorkTab(ownerUid, workId); } catch (e) {}
      };
      var close = document.createElement('button');
      close.textContent = '✕';
      close.style.cssText = 'background:transparent;color:#fff;border:none;font-size:16px;line-height:1;cursor:pointer;padding:4px 6px;';
      close.onclick = _cpsRemoveReorderBanner;
      bar.appendChild(msg); bar.appendChild(reload); bar.appendChild(close);
      document.body.appendChild(bar);
    } catch (e) {}
  }

  // 서버 변경 정착 후 1회 실행: 순서변경이면 배너, 아니면(추가/삭제) 기존 라이브 반영
  async function _cpsOnServerChange(ownerUid, workId) {
    var isReorder = false;
    try { isReorder = await _cpsReorderCheck(ownerUid, workId); } catch (e) {}
    /* ★ 2026-08-13: 예전엔 순서변경이면 라이브 반영을 건너뛰고 '다시 불러오기' 배너만 띄웠다.
       이제 _applyServerPhotos 가 photoOrder(순서)와 role/호수 이동까지 실시간으로 맞추므로
       배너 없이 바로 반영한다. (isReorder 판정은 로그용으로만 남긴다) */
    if (isReorder) console.log('[CloudPhotoSync] 상대가 순서/위치를 바꿈 → 실시간 반영');
    _applyServerPhotos(ownerUid, workId);
  }

  async function _applyServerPhotos(ownerUid, workId) {
    if (_liveBusy) { _livePending = { ownerUid: ownerUid, workId: workId }; return; }  // ★ 진행 중이면 버리지 말고 예약 → 서버 최종상태로 반드시 수렴
    if (!ownerUid || !workId) return;
    if (typeof units === 'undefined' || !Array.isArray(units)) return;
    _liveBusy = true;
    try {
      var handle = await _cpsEnsureFolderHandle();
      if (!handle) return;
      var col = db().collection('schedules').doc(safeId(ownerUid)).collection('items').doc(safeId(workId)).collection('photos');
      var snap = await col.get();
      // ★ 2026-08-13: 끼워넣을 위치를 정하려면 photoOrder 가 필요하다(없으면 맨 뒤 = 기존 규칙)
      var _livePo = null;
      try {
        var _liveItem = await db().collection('schedules').doc(safeId(ownerUid)).collection('items').doc(safeId(workId)).get();
        _livePo = (_liveItem.exists && _liveItem.data() && _liveItem.data().photoOrder) || null;
      } catch (e) { console.warn('[CloudPhotoSync] 실시간 photoOrder 조회 실패', e && (e.code || e.message)); }
      // 서버의 '상대(내가 올린 게 아닌)' 사진 목록
      var serverOther = {};
      snap.forEach(function (d) {
        var data = d.data() || {};
        var mine = (data.addedBy === myUid()) || (!data.addedBy && ownerUid === myUid());
        if (mine) return;
        if (!data.storagePath) return;
        var ln = data.cloudName || data.fname;
        if (ln) serverOther[ln] = data;
      });

      var mdir;
      try {
        var root = await handle.getDirectoryHandle('_shared', { create: true });
        var od = await root.getDirectoryHandle(safeId(ownerUid), { create: true });
        mdir = await od.getDirectoryHandle(safeId(workId), { create: true });
      } catch (e) { return; }

      var have = {};
      var loc = {};   // fileName → { u, role } 현재 화면에서의 위치
      units.forEach(function (u) {
        var mark = function (arr, role) {
          (arr || []).forEach(function (p) {
            if (p && p.fileName) { have[p.fileName] = 1; loc[p.fileName] = { u: u, role: role }; }
          });
        };
        mark(u.before, 'before');
        mark(u.after, 'after');
        (u.specials || []).forEach(function (sp, si) { mark(sp.photos, 'special' + (si + 1)); });
      });

      var changed = false;

      /* ⭐ 2026-08-13: 이미 갖고 있는 사진은 아래에서 `if (have[ln]) continue;` 로 통째로 건너뛴다.
         그래서 상대가 사진을 작업 전↔후로 옮기거나 다른 호수로 옮겨도 실시간으론 안 움직이고
         작업을 새로 열어야 반영됐다(순서는 photoOrder 로 따로 오니까 실시간이었다).
         → 위치(role/unitName)가 서버와 다르면 화면에서도 옮긴다. 파일은 건드리지 않는다. */
      try {
        var _bucketOf = function (u, role) {
          var mm = /^special(\d+)$/.exec(role || '');
          if (role === 'after') { u.after = u.after || []; return u.after; }
          if (mm) {
            var si = parseInt(mm[1], 10) - 1;
            u.specials = u.specials || [];
            while (u.specials.length <= si) u.specials.push({ desc: '', photos: [] });
            u.specials[si].photos = u.specials[si].photos || [];
            return u.specials[si].photos;
          }
          u.before = u.before || []; return u.before;
        };
        Object.keys(serverOther).forEach(function (ln) {
          var cur = loc[ln]; if (!cur) return;                       // 아직 없는 사진은 아래 추가 단계에서 처리
          var data = serverOther[ln] || {};
          var newRole = data.role || 'before';
          var newUnit = data.unitName || '';
          var sameUnit = ((cur.u && cur.u.name) || '') === newUnit;
          if (cur.role === newRole && sameUnit) return;              // 그대로면 통과
          var tu = cur.u;
          if (!sameUnit && newUnit) {
            tu = null;
            for (var t = 0; t < units.length; t++) { if ((units[t].name || '') === newUnit) { tu = units[t]; break; } }
            if (!tu) return;                                          // 그 호수가 아직 없으면 다음 열기 때 정리
          }
          var from = _bucketOf(cur.u, cur.role);
          var ix = -1;
          for (var z = 0; z < from.length; z++) { if (from[z] && from[z].fileName === ln) { ix = z; break; } }
          if (ix < 0) return;
          var obj = from.splice(ix, 1)[0];
          _cpsInsertByOrder(_bucketOf(tu, newRole), obj, tu.name || '', newRole, _livePo);
          loc[ln] = { u: tu, role: newRole };
          changed = true;
          console.log('[CloudPhotoSync] 사진 위치 실시간 이동:', ln, cur.role, '→', newRole, newUnit);
        });
      } catch (e) { console.warn('[CloudPhotoSync] 위치 이동 반영 실패', e); }

      /* ⭐ 2026-08-13: 같은 칸 안에서의 순수 순서변경도 실시간으로 맞춘다.
         위 이동 처리는 role/호수가 바뀐 것만 보고, 순서만 바뀐 건 못 잡는다.
         이게 있어야 공유작업자 쪽도 '다시 불러오기' 없이 바로 반영된다. */
      try {
        if (_livePo) {
          var _sortBucket = function (arr, unitName, role) {
            if (!Array.isArray(arr) || arr.length < 2) return arr;
            var lst = _livePo[_cpsSafeId(unitName) + '__' + role];
            if (!Array.isArray(lst) || !lst.length) return arr;
            var ix2 = {}; lst.forEach(function (n2, i2) { ix2[n2] = i2; });
            var kk = arr.map(function (pp, i2) {
              var fn = (pp && pp.fileName) || '';
              var k = ix2[fn];
              if (k === undefined) k = ix2[_cpsCloudName(unitName, role, fn)];
              return { p: pp, i: i2, k: (k === undefined ? Infinity : k) };
            });
            kk.sort(function (a, b) { return (a.k - b.k) || (a.i - b.i); });
            var o = kk.map(function (x) { return x.p; });
            for (var z2 = 0; z2 < o.length; z2++) { if (o[z2] !== arr[z2]) { changed = true; break; } }
            return o;
          };
          units.forEach(function (u) {
            var un = u.name || '';
            u.before = _sortBucket(u.before, un, 'before');
            u.after  = _sortBucket(u.after,  un, 'after');
            (u.specials || []).forEach(function (sp, si) { sp.photos = _sortBucket(sp.photos, un, 'special' + (si + 1)); });
          });
        }
      } catch (e) { console.warn('[CloudPhotoSync] 순서 실시간 반영 실패', e); }
      // (1) 추가만: 서버엔 있는데 화면엔 없는 상대 사진 → 다운로드 후 삽입 (순서변경 실시간 반영은 안전상 제외)
      var names = Object.keys(serverOther); names.sort();
      // ★ 진행표시(2026-07-11): 새로 받을 사진이 있으면 "몇 장 중 몇 장" 안내
      var _missing = names.filter(function (n) { return !have[n]; });
      var _prog = 0;
      var _showProg = _missing.length > 0 && typeof showOverlay === 'function';
      for (var i = 0; i < names.length; i++) {
        var ln = names[i];
        if (have[ln]) continue;
        if (_showProg) { _prog++; showOverlay('📥 사진을 가져오는 중입니다 ' + _prog + '/' + _missing.length + '장'); }
        var data = serverOther[ln];
        var okLocal = false;
        try { await mdir.getFileHandle(ln, { create: false }); okLocal = true; } catch (e) {}
        if (!okLocal) {
          try {
            var blob = await _cpsFetchBlob(data.storagePath);
            var fh = await mdir.getFileHandle(ln, { create: true });
            var w = await fh.createWritable(); await w.write(blob); await w.close();
          } catch (e) { continue; }
        }
        var target = null;
        for (var t = 0; t < units.length; t++) { if ((units[t].name || '') === (data.unitName || '')) { target = units[t]; break; } }
        /* ⭐ 2026-08-13 데이터 오염 수정 — 예전엔 모르는 호수면 무조건 첫 호수에 넣었다.
           공유작업자가 새 호수를 만들어 찍은 사진이 원작업자 쪽에서 전부 첫 호수에
           처박혀 섞였다. 이름이 있으면 그 호수를 만들어서 제자리에 넣는다. */
        if (!target) {
          var _newUn = String((data && data.unitName) || '').trim();
          if (_newUn) {
            target = { id: (typeof nid !== 'undefined' ? nid++ : (units.length + 1)), name: _newUn,
                       before: [], after: [], specials: [], open: true, customerOpen: true,
                       customer: { phone: '', address: '', memo: '' } };
            units.push(target);
            /* ★ 2026-08-13: 호수가 2개 이상이면 이 앱에서는 '공용시설'이다(가정용은 1호수 전용 —
               events.js addUnit 이 가정용에서 호수 추가를 막는다). 상대가 호수를 늘려 보낸 것이므로
               작업유형도 같이 맞춘다. 안 맞추면 '가정용인데 호수 2개'라는 규칙 위반 상태가 되고
               원작업자 화면에서는 호수 추가 버튼도 막힌다. */
            try {
              if (typeof currentWorkType !== 'undefined' && currentWorkType !== 'facility' && units.length > 1) {
                currentWorkType = 'facility';
                if (typeof facilityCustomer !== 'undefined' && !facilityCustomer) facilityCustomer = { phone: '', contact: '', address: '', memo: '' };
                if (typeof applyWorkTypeUI === 'function') applyWorkTypeUI();
                console.log('[CloudPhotoSync] 호수 2개 이상 → 공용시설로 전환');
              }
            } catch (e) { console.warn('[CloudPhotoSync] 작업유형 전환 실패', e); }
            console.log('[CloudPhotoSync] 상대 사진 수신 → 새 호수 자동 생성:', _newUn);
          } else {
            target = units[0];
          }
        }
        if (!target) continue;
        var photoObj = { id: 'in_' + Date.now() + '_' + i, fileName: ln, _workDir: mdir, dataUrl: null,
          savedToFolder: true, hasOriginal: true, _cloudUploaded: true, _borrowedIncoming: true };
        var role = data.role || 'before'; var m = /^special(\d+)$/.exec(role);
        /* ⭐ 2026-08-13: 여기(실시간 경로)는 photoOrder 를 무시하고 무조건 맨 뒤에 붙이고 있었다.
           작업을 '열 때'(pull 경로)만 순서를 지켰기 때문에, 원작업자가 그 작업을 열어 둔 채
           상대 사진이 들어오면 순서가 어긋났다. 특히 원작업자 사진이 없는 작업은
           들어오는 사진이 전부 이 경로를 타서 순서가 전혀 반영되지 않았다.
           → 열 때와 같은 규칙으로 끼워 넣는다. */
        if (role === 'after') { target.after = target.after || []; _cpsInsertByOrder(target.after, photoObj, target.name, 'after', _livePo); }
        else if (m) { var si = parseInt(m[1], 10) - 1; target.specials = target.specials || []; while (target.specials.length <= si) target.specials.push({ desc: '', photos: [] }); _cpsInsertByOrder(target.specials[si].photos, photoObj, target.name, 'special' + (si + 1), _livePo); }
        else { target.before = target.before || []; _cpsInsertByOrder(target.before, photoObj, target.name, 'before', _livePo); }
        have[ln] = 1; changed = true;
      }

      if (_showProg && typeof hideOverlay === 'function') { try { hideOverlay(); } catch (eOv) {} }

      /* (2) 삭제: 서버에서 사라진 '남의 사진' 제거.
         ⭐ 2026-08-13 조건 확대 — 예전엔 `_borrowedIncoming` 인 것만 지웠다. 그런데 그 표시는
         **실시간으로 받아온 사진에만** 붙는다. 작업을 열 때 이미 화면에 들어와 있던
         원작업자 사진에는 안 붙어서, 원작업자가 그 사진을 작업 전→후로 옮기면
         (이름이 바뀌어 새 문서가 생기고 옛 문서는 지워짐)
         새 위치엔 사진이 생기는데 옛 위치의 것은 안 지워져 **같은 사진이 양쪽에 하나씩** 남았다.
         → 판정을 isForeignPhoto(남의 사진인가)로 통일한다.
         내 작업 화면에서는 _borrowedShare 가 없어 예전과 동일하게 동작한다(회귀 없음). */
      var _foreignCnt = 0;
      units.forEach(function (u) {
        var cnt = function (arr) { (arr || []).forEach(function (p) { if (window.isForeignPhoto && window.isForeignPhoto(p)) _foreignCnt++; }); };
        cnt(u.before); cnt(u.after); (u.specials || []).forEach(function (sp) { cnt(sp.photos); });
      });
      /* 안전장치: 화면엔 남의 사진이 있는데 서버 목록이 통째로 비어 있으면 조회 실패를 의심해
         지우지 않는다(일시적 오류로 사진이 전부 사라져 보이는 사고 방지). */
      var _serverCnt = Object.keys(serverOther).length;
      if (_foreignCnt > 0 && _serverCnt === 0) {
        console.warn('[CloudPhotoSync] 서버 사진 목록이 비어 삭제 반영을 건너뜀(조회 실패 의심)');
      } else {
        var filt = function (arr) {
          if (!arr) return arr;
          var b = arr.length;
          var out = arr.filter(function (p) {
            if (!p || !p.fileName) return true;
            if (!(window.isForeignPhoto && window.isForeignPhoto(p))) return true;   // 내 사진은 대상 아님
            return !!serverOther[p.fileName];                                        // 서버에 없으면 제거
          });
          if (out.length !== b) changed = true;
          return out;
        };
        units.forEach(function (u) { u.before = filt(u.before); u.after = filt(u.after); (u.specials || []).forEach(function (sp) { sp.photos = filt(sp.photos); }); });
      }

      if (changed) {
        _cpsDedupUnits();   // ★ 초기 pull과 실시간 반영이 겹쳐 같은 사진이 2장 들어가는 것 방어
        if (typeof renderAll === 'function') renderAll();
        if (typeof updateStats === 'function') updateStats();
        if (typeof startLazyPhotoLoading === 'function') setTimeout(function () { try { startLazyPhotoLoading(); } catch (e) {} }, 300);
      }
    } catch (e) {
      console.warn('[CloudPhotoSync] 실시간 반영 오류', e && e.message);
      try { if (typeof hideOverlay === 'function') hideOverlay(); } catch (eOv) {}
    }
    finally {
      _liveBusy = false;
      if (_livePending) {   // ★ 처리 중 도착했던 최신 스냅샷을 마저 반영 → 이동/삭제가 부분상태로 굳는 문제 방지
        var _pend = _livePending; _livePending = null;
        setTimeout(function () { if (_liveKey) _applyServerPhotos(_pend.ownerUid, _pend.workId); }, 60);
      }
    }
  }

  // ownerUid: 소유자 uid, workId: 폴더명(클라우드 항목 id)
  CloudPhotoSync.startLivePhotoSync = function (ownerUid, workId) {
    if (!loggedIn() || !ownerUid || !workId) return;
    if (!hasActiveShare()) return;
    var key = safeId(ownerUid) + '|' + safeId(workId);
    if (_liveKey === key && _livePhotoUnsub) return;   // 이미 같은 작업 구독 중
    CloudPhotoSync.stopLivePhotoSync();
    _liveKey = key;
    var col;
    try { col = db().collection('schedules').doc(safeId(ownerUid)).collection('items').doc(safeId(workId)).collection('photos'); }
    catch (e) { _liveKey = ''; return; }
    var first = true;
    _livePhotoUnsub = col.onSnapshot(function () {
      if (first) { first = false; return; }   // 최초 스냅샷은 openInWorkTab/pull이 이미 반영
      if (_liveKey !== key) return;            // 다른 작업으로 이동함
      // ★ 이동/순서변경은 '삭제+추가' 이벤트가 잇따라 도착 → 디바운스로 합쳐 '정착된' 서버상태를 한 번에 반영
      //   (개별 이벤트마다 반영하면 추가만 되고 삭제가 늦어, 사진이 양쪽에 겹쳐 보이던 문제 방지)
      clearTimeout(_liveSnapDeb);
      _liveSnapDeb = setTimeout(function () { if (_liveKey === key) _cpsOnServerChange(ownerUid, workId); }, 400);
    }, function (err) { console.warn('[CloudPhotoSync] 실시간 사진 구독 오류', err && err.code); });

    // ★ (재)열기 시: 이전 배너/배치 서명 초기화 후, 잠시 뒤 현재 배치를 기준선으로 프라임
    _cpsRemoveReorderBanner();
    delete _lastArrSig[key];
    setTimeout(function () { if (_liveKey === key) { try { _cpsReorderCheck(ownerUid, workId); } catch (e) {} } }, 800);

    // ★ 항목 문서 구독: 원작업자가 삭제(trashed/완전삭제)하면 공유작업자에게 안내 후 새 작업 전환 (2026-07-11)
    //   내 작업(내가 소유자)은 대상 아님 - 내가 지우는 흐름은 각자 화면에서 처리됨
    if (ownerUid !== myUid()) {
      try {
        var itemRef = db().collection('schedules').doc(safeId(ownerUid)).collection('items').doc(safeId(workId));
        _liveItemUnsub = itemRef.onSnapshot(function (docSnap) {
          if (_liveKey !== key) return;
          var d = docSnap && docSnap.exists ? (docSnap.data() || {}) : null;
          var gone = !docSnap || !docSnap.exists || (d && d.trashed);
          if (gone) {
            var b = window._borrowedShare;
            if (!b || safeId(b.workId) !== safeId(workId)) return; // 지금 열어둔 작업일 때만
            _cpsHandleSharedWorkDeleted();
            return;
          }
          // 항목 문서 변경(같은 구분 내 순서편집 등)도 사진 스냅샷과 같은 디바운스로 합쳐 정착 후 1회 판정
          clearTimeout(_liveSnapDeb);
          _liveSnapDeb = setTimeout(function () { if (_liveKey === key) _cpsOnServerChange(ownerUid, workId); }, 400);
        }, function (err) { console.warn('[CloudPhotoSync] 항목 구독 오류', err && err.code); });
      } catch (e) {}
    }
  };

  // (기존 작업 공유사진 재동기화 기능은 제거되었습니다)

  /* ═══════════════════════════════════════════════════════════
     저장된 글(posts) 클라우드 동기화 — 2026-08-16 신설

     왜 필요했나 (버그 2건):
       ① 공유작업자가 쓴 글이 통째로 사라졌다.
          공유작업을 열면 currentFolderName = null 이라(로컬 폴더를 안 만든다)
          ai.js persistPostsToFolder() 가 "아직 저장 전 작업"으로 보고 그냥 빠져나갔다.
          → 글은 IndexedDB 임시 세션에만 남고, 다른 작업을 열면 resetWorkGlobals() 로 소멸.
          클라우드로 올라가는 경로가 아예 없었다.
       ② 원작업자가 쓴 글이 공유작업자에게 안 보였다.
          글 공유가 full(전체본 _session.json) 문서에만 얹혀 있었는데
          - pushFull 은 CloudBackup.isSub() **구독자 전용**
          - full 은 Firestore 규칙상 **쓰기가 소유자만**
          - 달력 즉시열기(_quickOpenSchedule) 경로엔 글을 채우는 코드가 없었다

     해결: 글을 사진과 똑같이 독립 서브컬렉션으로 뺀다.
       schedules/{ownerUid}/items/{workId}/posts/{postId}
       구독 여부·소유자 여부와 무관하게 양방향. full 통째 덮어쓰기(위험)는 안 건드린다.

     ⚠️ 삭제는 하드삭제가 아니라 **묘비(deleted:true)** 다.
        하드삭제하면 상대 폰의 로컬 _session.json 에 남아 있던 같은 글이
        다음 동기화 때 "클라우드에 없는 글"로 판정돼 되살아난다(부활 버그).

     workId 주의: 클라우드 항목 문서 id 는 cloud_sync.js toPayload 가
       `d.folderName || d.workId` 로 만든다 → **내 작업은 폴더명이 곧 클라우드 workId**.
       (dialogs.js 가 pullBorrowedAdditions 에 currentFolderName 을 넘기는 것과 같은 이유)
  ═══════════════════════════════════════════════════════════ */

  function _postsCol(ownerUid, workId) {
    return db().collection('schedules').doc(safeId(ownerUid))
             .collection('items').doc(safeId(workId)).collection('posts');
  }

  // 지금 화면에 열린 작업의 '클라우드 주소'. 알 수 없으면 null(=클라우드 동기화 건너뜀)
  CloudPhotoSync.postScope = function () {
    try {
      if (!loggedIn()) return null;
      var b = window._borrowedShare;
      if (b && b.ownerUid && b.workId) return { ownerUid: b.ownerUid, workId: b.workId, borrowed: true };
      // 내 작업: 폴더명이 클라우드 workId. 아직 저장 전(폴더 없음)이면 주소가 없다.
      var wid = (typeof currentFolderName !== 'undefined' && currentFolderName) ? currentFolderName : '';
      if (!wid) return null;
      return { ownerUid: myUid(), workId: wid, borrowed: false };
    } catch (e) { return null; }
  };

  // 클라우드에 올릴 상황인가 — 남의 작업(빌려보기)이거나, 내가 공유중일 때
  function _postSyncOn(sc) {
    if (!sc) return false;
    if (sc.borrowed) return true;
    return hasActiveShare();
  }

  // 글 1건 올리기(생성·수정 공용)
  CloudPhotoSync.pushPost = async function (post) {
    try {
      var sc = CloudPhotoSync.postScope();
      if (!_postSyncOn(sc) || !post || !post.id) return false;
      await _postsCol(sc.ownerUid, sc.workId).doc(safeId(post.id)).set({
        id: post.id,
        ch: post.ch || 'naver',
        text: String(post.text || ''),
        at: post.at || Date.now(),
        authorUid: myUid(),
        deleted: false,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return true;
    } catch (e) {
      console.warn('[글작성] 클라우드 반영 실패', e && (e.code || e.message));
      return false;
    }
  };

  /* 글 삭제 = 묘비 남기기.
     권한은 Firestore 규칙이 최종 판정한다(소유자 또는 작성자 본인 — 사진 규칙과 동일). */
  CloudPhotoSync.deleteCloudPost = async function (postId) {
    try {
      var sc = CloudPhotoSync.postScope();
      if (!_postSyncOn(sc) || !postId) return false;
      await _postsCol(sc.ownerUid, sc.workId).doc(safeId(postId)).set({
        id: postId, text: '', deleted: true,
        deletedBy: myUid(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return true;
    } catch (e) {
      console.warn('[글작성] 클라우드 삭제 실패', e && (e.code || e.message));
      return false;
    }
  };

  /* 열린 작업의 글을 클라우드와 맞춘다(양방향 1회).
       ① 서버에서 받아 로컬에 합침 (묘비면 로컬에서도 제거)
       ② 서버에 없는 로컬 글은 올림 (원작업자가 공유 전에 써둔 글도 뒤늦게 전달됨)
     seqCheck: 그 사이 사용자가 다른 작업을 열었으면 false 를 돌려주는 함수(엉뚱한 작업 오염 방지) */
  CloudPhotoSync.syncPosts = async function (seqCheck) {
    var sc = CloudPhotoSync.postScope();
    if (!_postSyncOn(sc)) return { changed: false };
    if (typeof workPosts === 'undefined' || !Array.isArray(workPosts)) return { changed: false };
    var snap;
    try { snap = await _postsCol(sc.ownerUid, sc.workId).get(); }
    catch (e) { console.log('[글작성] 클라우드 글 조회 건너뜀:', e && (e.code || e.message)); return { changed: false }; }
    if (typeof seqCheck === 'function' && !seqCheck()) return { changed: false };

    var remote = {}, tombs = {};
    snap.forEach(function (d) {
      var r = d.data() || {};
      if (!r.id) return;
      if (r.deleted) { tombs[r.id] = 1; return; }
      if (typeof r.text !== 'string' || !r.text) return;
      remote[r.id] = { id: r.id, ch: r.ch || 'naver', text: r.text, at: r.at || 0 };
    });

    var before = JSON.stringify(workPosts);
    var seen = {}, merged = [], localOnly = [];
    workPosts.forEach(function (p) {
      if (!p || !p.id || typeof p.text !== 'string') return;
      if (seen[p.id]) return;
      if (tombs[p.id]) return;                       // 상대가 지운 글 → 내 쪽에서도 제거
      seen[p.id] = 1;
      var r = remote[p.id];
      if (!r) {
        merged.push(p);
        // 서버가 모르는 글 → 올린다. 단 '전체본에서 받아온 원작업자 글'은 제외(작성자 뒤바뀜 방지)
        if (!(sc.borrowed && CloudPhotoSync._fullPostIds && CloudPhotoSync._fullPostIds[p.id])) localOnly.push(p);
        return;
      }
      // 같은 글이면 나중에 고친 쪽을 남긴다
      merged.push(((r.at || 0) > (p.at || 0)) ? r : p);
    });
    Object.keys(remote).forEach(function (id) { if (!seen[id]) { seen[id] = 1; merged.push(remote[id]); } });
    merged.sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
    if (merged.length > 50) merged = merged.slice(merged.length - 50);

    if (typeof seqCheck === 'function' && !seqCheck()) return { changed: false };
    workPosts = merged;
    var changed = (JSON.stringify(workPosts) !== before);

    // 서버가 아직 모르는 로컬 글 올리기(조용히)
    for (var i = 0; i < localOnly.length; i++) {
      try { await CloudPhotoSync.pushPost(localOnly[i]); } catch (e) {}
    }
    if (changed) {
      try { if (typeof sessionAutoSave === 'function') sessionAutoSave(); } catch (e) {}
      // 내 작업이면 디스크(_session.json)에도 반영해 다음에 열 때 바로 보이게
      if (!sc.borrowed && window.ClaudeAI && ClaudeAI.persistPostsToFolder) {
        try { ClaudeAI.persistPostsToFolder(); } catch (e) {}
      }
      try { if (typeof renderAll === 'function') renderAll(); } catch (e) {}
    }
    console.log('[글작성] 클라우드 동기화: 총 ' + workPosts.length + '건 (올림 ' + localOnly.length + '건)' + (changed ? ' · 화면 갱신' : ''));
    return { changed: changed, count: workPosts.length };
  };
})();

/* ═══════════════════════════════════════════════
   다운로드 (공유 상대의 사진을 내 폰에도 받기)
   - 앱 열 때(로그인 직후) 자동 확인
   - 저장 위치: photoFolderHandle/_shared/{상대uid}/{workId}/{파일명}
     ★ 개인 작업 폴더와 완전히 분리 — workNum 매칭/정리 로직에 절대 안 걸리게 함
       (로컬 사진폴더 삭제 버그를 겪은 뒤 내린 결정: 공유 다운로드는 별도 영역에만 씀)
   - Wi-Fi면 자동 다운로드, 모바일 데이터면 확인 후 다운로드
   - storagePath가 없는(7일 지나 만료된) 사진은 건너뜀 - 5단계 "원본요청" 버튼에서 처리
═══════════════════════════════════════════════ */
(function () {
  'use strict';

  function loggedIn(){ return window.Cloud && Cloud.ready && Cloud.user; }
  function db(){ return Cloud.db; }
  function stg(){ return firebase.storage(); }
  function safeId(name){ return String(name||'').replace(/[\/\.\#\$\[\]]/g, '_').slice(0, 200); }

  async function getSharedMirrorDir(ownerUid, workId) {
    var handle = await _cpsEnsureFolderHandle();
    if (!handle) throw new Error('저장 폴더 미설정');
    var root = await handle.getDirectoryHandle('_shared', { create: true });
    var ownerDir = await root.getDirectoryHandle(safeId(ownerUid), { create: true });
    return await ownerDir.getDirectoryHandle(safeId(workId), { create: true });
  }

  async function getNetworkType() {
    try {
      var Net = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Network;
      if (!Net) return 'unknown';
      var status = await Net.getStatus();
      if (!status || !status.connected) return 'none';
      return status.connectionType === 'wifi' ? 'wifi'
           : status.connectionType === 'cellular' ? 'cellular'
           : 'unknown';
    } catch (e) { return 'unknown'; }
  }

  // 아직 로컬에 없는 사진인지 확인 (있으면 스킵 - 중복 다운로드 방지)
  async function alreadyHave(ownerUid, workId, fname, expectedSize) {
    try {
      var dir = await getSharedMirrorDir(ownerUid, workId);
      var fh = await dir.getFileHandle(fname, { create: false });
      // ★ 순서편집/사진교체로 같은 파일명에 다른 사진이 올라오면 크기가 달라짐 → 스킵하지 말고 다시 받는다
      if (expectedSize) {
        try { var f = await fh.getFile(); if (f && f.size && f.size !== expectedSize) return false; } catch (e2) {}
      }
      return true;
    } catch (e) { return false; }
  }

  async function downloadOnePhoto(ownerUid, workId, photoDoc) {
    if (!photoDoc.storagePath || !photoDoc.fname) return { skipped: true, reason: 'expired' };
    var localName = photoDoc.cloudName || photoDoc.fname;   // ★ 유일 파일명(호수 간 충돌 방지)
    if (await alreadyHave(ownerUid, workId, localName, photoDoc.size)) return { skipped: true, reason: 'exists' };

    var blob = await _cpsFetchBlob(photoDoc.storagePath);

    var dir = await getSharedMirrorDir(ownerUid, workId);
    var fh = await dir.getFileHandle(localName, { create: true });
    var w = await fh.createWritable();
    await w.write(blob);
    await w.close();
    return { ok: true, size: blob.size };
  }

  // 모든 공유 상대의 아직 안 받은 사진(storagePath 있는 것만) 목록 수집
  // ★ 백그라운드 프리페치 범위: '이번 달'이 아니라 오늘 기준 '지난 N일(롤링)'.
  //   (이전 버그: 이번 달 YYYY-MM만 받아, 지난달 말 작업(예: 7/28)이 30일 이내여도 빠짐 → 열 때마다 온디맨드 다운로드)
  var DL_RECENT_DAYS = 30;   // 필요 시 설정값으로 뺄 수 있음
  function _dlCutoffYmd(){
    var base = null;
    try { if (typeof kstDateStr === 'function') base = new Date(String(kstDateStr()).slice(0,10) + 'T00:00:00'); } catch(e){}
    if (!base || isNaN(base.getTime())) base = new Date();
    base.setDate(base.getDate() - DL_RECENT_DAYS);
    return base.getFullYear() + '-' + String(base.getMonth()+1).padStart(2,'0') + '-' + String(base.getDate()).padStart(2,'0');
  }
  async function collectPendingDownloads() {
    var partners = (window.CloudShare && CloudShare.getSharedPartnerUids) ? CloudShare.getSharedPartnerUids() : [];
    var pending = [];
    var _cutYmd = _dlCutoffYmd();   // 오늘-30일 (YYYY-MM-DD), 롤링 기준선
    for (var i = 0; i < partners.length; i++) {
      var ownerUid = partners[i];
      try {
        /* ★ 2026-08-13 읽기량 절감
           예전엔 상대 items 를 통째로 읽고(.get()) 나서 아래에서 30일 컷오프로 걸렀다.
           팀원 수 × 작업 수만큼 읽기가 나가 Firestore 읽기의 큰 몫을 차지했다.
           같은 컷오프를 쿼리로 내려 '최근 30일'만 받아온다.
           (date 단일 필드 부등호 → 복합 인덱스 불필요. 상대 일정 24개월 창과 같은 방식)
           ⚠️ date 필드가 아예 없는 옛 문서는 이 쿼리에서 빠지지만,
              원래도 프리페치 대상일 뿐이라 그 작업을 직접 열면 온디맨드로 받아온다. */
        var itemsSnap = await db().collection('schedules').doc(ownerUid).collection('items')
          .where('date', '>=', _cutYmd).get();
        for (var di = 0; di < itemsSnap.docs.length; di++) {
          var itemDoc = itemsSnap.docs[di];
          var workId = itemDoc.id;
          // ★ 사진 폭탄 방지(팀 공유): 백그라운드 프리페치는 "최근 30일(롤링)" 작업 사진만.
          //   그 이전 작업은 직접 열 때(openInWorkTab) 온디맨드로 받아온다.
          //   (쿼리에서 이미 걸렀지만, endDate만 있는 문서 등을 대비해 한 번 더 확인 - 읽기 비용 없음)
          var _idata = itemDoc.data() || {};
          var _idt = String(_idata.date || _idata.endDate || '');
          var _dstr = _idt.slice(0, 10);
          if (!_dstr || _dstr < _cutYmd) continue;
          /* ★ 사진이 0장이라고 기록된 작업은 photos 서브컬렉션을 읽지 않는다.
             (읽어봐야 빈 결과인데 문서 수만큼 읽기가 나감)
             totalPhotos 필드가 있는 문서에만 적용 - 옛 문서는 그대로 확인한다. */
          if (typeof _idata.totalPhotos === 'number' &&
              (_idata.totalPhotos + (_idata.addedPhotos || 0)) === 0) continue;
          try {
            var photosSnap = await db().collection('schedules').doc(ownerUid).collection('items').doc(workId).collection('photos').get();
            for (var _pj = 0; _pj < photosSnap.docs.length; _pj++) {
              var _pdoc = photosSnap.docs[_pj];
              var data = _pdoc.data() || {};
              if (!data.storagePath) continue; // 만료됨 - 5단계에서 요청 기능으로 처리
              // ★ 이미 로컬에 받아둔 사진은 제외 → "N장 받는 중" 반복 안내/재다운로드 방지 (변경/추가분만)
              var _ln = data.cloudName || data.fname;
              if (_ln && await alreadyHave(ownerUid, workId, _ln, data.size)) continue;
              pending.push({ ownerUid: ownerUid, workId: workId, photoId: _pdoc.id, data: data });
            }
          } catch (e) { console.warn('[CloudPhotoSync] photos 조회 실패', ownerUid, workId, e && e.code); }
        }
      } catch (e) { console.warn('[CloudPhotoSync] items 조회 실패', ownerUid, e && e.code); }
    }
    return pending;
  }

  var _syncing = false;
  // ★ 백그라운드 다운로드: 화면(overlay)을 막지 않고 조용히 받는다. 앱은 계속 사용 가능,
  //   시작/완료만 토스트로 안내하고 받은 사진은 달력에 점차 반영한다.
  CloudPhotoSync.syncDownloads = async function () {
    if (!loggedIn() || _syncing) return;
    _syncing = true;
    try {
      var pending = await collectPendingDownloads();
      if (!pending.length) return;

      var netType = await getNetworkType();
      if (netType === 'none') { console.log('[CloudPhotoSync] 오프라인 - 다운로드 보류'); return; }

      if (netType === 'cellular') {
        var totalKB = Math.round(pending.reduce(function (s, p) { return s + ((p.data.size || 0) / 1024); }, 0));
        var ok = confirm('📷 공유 사진 ' + pending.length + '장(약 ' + totalKB + 'KB)이 있습니다.\n\n지금 모바일 데이터로 받을까요?\n(Wi-Fi에서는 자동으로 받습니다)');
        if (!ok) { console.log('[CloudPhotoSync] 사용자가 모바일 데이터 다운로드 거부'); return; }
      }

      if (pending.length >= 5 && typeof showToast === 'function') showToast('📥 공유 사진 ' + pending.length + '장을 백그라운드로 받는 중…', 'ok');

      var okCount = 0, failCount = 0, lastRefresh = 0;
      for (var i = 0; i < pending.length; i++) {
        var p = pending[i];
        try {
          var r = await downloadOnePhoto(p.ownerUid, p.workId, p.data);
          if (r && r.ok) {
            okCount++;
            // 받은 사진이 화면에 점차 반영되도록 가끔 달력 갱신
            if (okCount - lastRefresh >= 10) { lastRefresh = okCount; try { if (window.__calendarRefresh) window.__calendarRefresh(); } catch (e2) {} }
          }
        } catch (e) {
          failCount++;
          console.warn('[CloudPhotoSync] 다운로드 실패', p.workId, p.data && p.data.fname, e && e.message);
        }
      }
      console.log('[CloudPhotoSync] 다운로드 완료: ' + okCount + '장 성공, ' + failCount + '장 실패 (전체 ' + pending.length + '장 중)');
      try { if (window.__calendarRefresh) window.__calendarRefresh(); } catch (e3) {}
      if (okCount > 0 && typeof showToast === 'function') showToast('✓ 공유 사진 ' + okCount + '장 받기 완료', 'ok');
    } catch (e) {
      console.warn('[CloudPhotoSync] 다운로드 확인 실패', e);
    } finally {
      _syncing = false;
    }
  };

  // 로그인 직후(=앱 열 때) 자동 확인
  document.addEventListener('cloud-auth-changed', function (e) {
    if (e && e.detail && e.detail.user) {
      setTimeout(function () { CloudPhotoSync.syncDownloads(); }, 3000);
    }
  });
})();

/* ═══════════════════════════════════════════════
   읽기전용 뷰어 - 공유 상대 작업의 사진 보기("열기" 버튼)
   - Firestore photos 서브컬렉션에서 메타(호수/역할) 조회
   - 실제 이미지는 로컬 _shared/{ownerUid}/{workId}/ 폴더에서 읽음
   - 아직 로컬에 없으면(다운로드 전) 그 자리에서 1장만 즉시 받아서 보여줌
═══════════════════════════════════════════════ */
(function () {
  'use strict';
  window.CloudPhotoSync = window.CloudPhotoSync || {};

  function db(){ return Cloud.db; }
  function stg(){ return firebase.storage(); }
  function safeId(name){ return String(name||'').replace(/[\/\.\#\$\[\]]/g, '_').slice(0, 200); }
  function esc(s){ return String(s||'').replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  function roleLabel(role){
    if (role === 'before') return '전';
    if (role === 'after') return '후';
    var m = /^special(\d+)$/.exec(role||'');
    if (m) return '특이' + m[1];
    return role || '';
  }

  async function getMirrorDirReadonly(ownerUid, workId){
    var handle = await _cpsEnsureFolderHandle();
    if (!handle) return null;
    try {
      var root = await handle.getDirectoryHandle('_shared', { create: true });
      var ownerDir = await root.getDirectoryHandle(safeId(ownerUid), { create: true });
      return await ownerDir.getDirectoryHandle(safeId(workId), { create: true });
    } catch (e) { return null; }
  }

  // 로컬에 없으면 지금 즉시 1장 받아오기 (뷰어에서 보기용 - 다운로드 확인창 없이 바로)
  async function ensureLocalFile(ownerUid, workId, photoData){
    var dir = await getMirrorDirReadonly(ownerUid, workId);
    if (!dir || !photoData.fname) return null;
    var localName = photoData.cloudName || photoData.fname;   // ★ 유일 파일명
    try {
      var fh = await dir.getFileHandle(localName, { create: false });
      var f = await fh.getFile();
      // ★ 순서편집 등으로 클라우드 내용이 바뀌었으면(크기 상이) 로컬 갱신 위해 다시 받는다
      if (photoData.storagePath && photoData.size && f && f.size && f.size !== photoData.size) throw new Error('_stale');
      return f;
    } catch (e) {
      // 로컬에 없음(또는 변경됨) - storagePath 있으면 즉시 다운로드 시도
      if (!photoData.storagePath) return null;
      try {
        var blob = await _cpsFetchBlob(photoData.storagePath);
        var fh2 = await dir.getFileHandle(localName, { create: true });
        var w = await fh2.createWritable();
        await w.write(blob);
        await w.close();
        return blob;
      } catch (e2) { console.warn('[CloudPhotoSync] 뷰어 즉시다운 실패', photoData.fname, e2 && e2.message); return null; }
    }
  }

  // 목록용: 썸네일만 받아 표시(대역폭 절감). thumbPath 없으면 원본으로 폴백(구버전 사진 호환)
  async function ensureThumb(ownerUid, workId, photoData){
    if (photoData && photoData.thumbPath){
      try {
        var url = await stg().ref(photoData.thumbPath).getDownloadURL();
        var resp = await fetch(url);
        if (resp.ok){ var b = await resp.blob(); return URL.createObjectURL(b); }
      } catch (e) { /* 폴백으로 진행 */ }
    }
    var fob = await ensureLocalFile(ownerUid, workId, photoData);
    return fob ? URL.createObjectURL(fob) : null;
  }

  /* ★ 2026-08-24 메모리 누수 — createObjectURL 로 만든 주소는 명시적으로 반납하기 전까지
       원본 blob 을 메모리에 붙잡아 둔다. 예전엔 라이트박스를 닫아도 원본 사진이 그대로 남아,
       사진 많은 공유작업을 여러 번 열수록 계속 쌓였다.
       → 넘겨받은 URL 의 소유권을 라이트박스가 가지고, 닫을 때 반납한다. */
  function openLightbox(url){
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:2000;display:flex;align-items:center;justify-content:center;padding:12px;';
    ov.innerHTML = '<img src="' + url + '" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;">';
    ov.addEventListener('click', function () {
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      try { if (url && url.indexOf('blob:') === 0) URL.revokeObjectURL(url); } catch (e) {}
    });
    document.body.appendChild(ov);
  }

  CloudPhotoSync.openViewer = async function (ownerUid, workId, title) {
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:1900;display:flex;align-items:center;justify-content:center;padding:16px;';
    ov.innerHTML =
      '<div style="background:var(--sf);border-radius:14px;padding:16px;max-width:520px;width:100%;max-height:calc(100vh - 44px);overflow-y:auto;-webkit-overflow-scrolling:touch;">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">' +
          '<div style="flex:1;font-size:16px;font-weight:800;">📷 ' + esc(title || '공유 작업') + '</div>' +
          '<button id="cpsViewerClose" class="btn b-ghost" style="padding:6px 10px;">닫기</button>' +
        '</div>' +
        '<div id="cpsViewerBody" style="font-size:13px;color:var(--mu);">불러오는 중...</div>' +
      '</div>';
    document.body.appendChild(ov);
    /* ★ 2026-08-24 메모리 누수 — 썸네일마다 만든 blob URL 을 반납한 적이 없었다.
         닫을 때 일괄 반납한다. 아직 안 끝난 다운로드가 뒤늦게 URL 을 들고 와도
         _closed 플래그를 보고 그 자리에서 바로 반납하므로 새지 않는다. */
    var _thumbUrls = [], _closed = false;
    var keepUrl = function (u) {
      if (!u || u.indexOf('blob:') !== 0) return u;
      if (_closed) { try { URL.revokeObjectURL(u); } catch (e) {} return u; }
      _thumbUrls.push(u);
      return u;
    };
    var close = function () {
      _closed = true;
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      _thumbUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
      _thumbUrls = [];
    };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('#cpsViewerClose').onclick = close;

    var body = ov.querySelector('#cpsViewerBody');
    try {
      var snap = await db().collection('schedules').doc(ownerUid).collection('items').doc(safeId(workId)).collection('photos').get();
      var photos = [];
      snap.forEach(function (d) { photos.push(d.data() || {}); });

      if (!photos.length) {
        body.innerHTML = '<div style="text-align:center;padding:30px 10px;">사진 정보가 없습니다.</div>';
        return;
      }

      // 호수별로 묶기
      var groups = {};
      var order = [];
      photos.forEach(function (p) {
        var key = p.unitName || '(호수 미상)';
        if (!groups[key]) { groups[key] = []; order.push(key); }
        groups[key].push(p);
      });

      var html = '';
      order.forEach(function (unitName) {
        html += '<div style="margin-bottom:14px;">';
        html += '<div style="font-size:13px;font-weight:700;margin-bottom:6px;">🔧 ' + esc(unitName) + '</div>';
        html += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
        groups[unitName].forEach(function (p, idx) {
          var ph = 'cps_' + safeId(unitName) + '_' + idx;
          html += '<div class="cps-thumb-slot" data-fname="' + esc(p.fname||'') + '" data-role="' + esc(roleLabel(p.role)) + '" ' +
                  'style="width:72px;height:72px;border-radius:8px;background:var(--sf2);display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--mu);overflow:hidden;position:relative;">' +
                  '<span class="cps-thumb-label" style="position:absolute;top:2px;left:4px;background:rgba(0,0,0,.5);color:#fff;border-radius:4px;padding:1px 4px;font-size:9px;">' + esc(roleLabel(p.role)) + '</span>' +
                  '<span class="cps-thumb-loading">⏳</span>' +
                  '</div>';
        });
        html += '</div></div>';
      });
      body.innerHTML = html;

      // 각 슬롯에 실제 이미지 비동기 로드(로컬에 없으면 즉시 다운로드 후 표시)
      var slots = body.querySelectorAll('.cps-thumb-slot');
      var flatPhotos = [];
      order.forEach(function (unitName) { groups[unitName].forEach(function (p) { flatPhotos.push(p); }); });
      slots.forEach(function (slot, i) {
        var p = flatPhotos[i];
        if (!p) return;
        ensureThumb(ownerUid, workId, p).then(function (thumbUrl) {
          if (!thumbUrl) {
            slot.innerHTML = '<span style="font-size:9px;color:var(--mu);">만료됨</span>';
            return;
          }
          keepUrl(thumbUrl);   // ★ 닫을 때 반납되도록 등록(2026-08-24)
          slot.innerHTML = '<img src="' + thumbUrl + '" style="width:100%;height:100%;object-fit:cover;">' +
            '<span style="position:absolute;top:2px;left:4px;background:rgba(0,0,0,.5);color:#fff;border-radius:4px;padding:1px 4px;font-size:9px;">' + esc(roleLabel(p.role)) + '</span>';
          slot.style.cursor = 'pointer';
          // 원본은 탭했을 때만 다운로드(고화질 온디맨드)
          slot.onclick = function () {
            if (typeof showOverlay === 'function') showOverlay('원본 여는 중...');
            ensureLocalFile(ownerUid, workId, p).then(function (fob) {
              if (typeof hideOverlay === 'function') hideOverlay();
              if (!fob) { if (typeof showToast === 'function') showToast('원본이 만료되어 재요청이 필요합니다', 'err'); return; }
              openLightbox(URL.createObjectURL(fob));
            }).catch(function () {
              if (typeof hideOverlay === 'function') hideOverlay();
              if (typeof showToast === 'function') showToast('원본 열기 실패', 'err');
            });
          };
        }).catch(function () {
          slot.innerHTML = '<span style="font-size:9px;color:var(--mu);">오류</span>';
        });
      });
    } catch (e) {
      console.warn('[CloudPhotoSync] 뷰어 로드 실패', e);
      body.innerHTML = '<div style="text-align:center;padding:30px 10px;color:var(--dn);">불러오기 실패: ' + esc(e && e.message) + '</div>';
    }
  };
})();

/* ═══════════════════════════════════════════════
   "열기" = 작업 탭에 그대로 불러오기 (일정+사진 통째로)
   - 팝업 뷰어 대신, 내 작업을 여는 것과 동일하게 작업 탭(units 등)에 채워 넣음
   - 저장하면 원본을 건드리지 않고 "내 새 작업"으로 저장됨(currentFolderName=null → 새 폴더)
     → 상대 작업을 실수로 덮어쓸 위험 없음
═══════════════════════════════════════════════ */
(function () {
  'use strict';
  window.CloudPhotoSync = window.CloudPhotoSync || {};

  function db(){ return Cloud.db; }
  function safeId(name){ return String(name||'').replace(/[\/\.\#\$\[\]]/g, '_').slice(0, 200); }

  function roleToBucket(role){
    if (role === 'before') return 'before';
    if (role === 'after') return 'after';
    var m = /^special(\d+)$/.exec(role || '');
    if (m) return { special: parseInt(m[1], 10) - 1 };
    return 'before'; // 알 수 없는 값은 안전하게 전(before)으로
  }

  /* ═══════════════════════════════════════════════════════════
     공유 작업 '전체본' 읽기 (2026-08-12, 1단계 = 읽기 전용)

     왜 필요한가:
       공유 작업을 열면 지금까지는 일정 항목(items)의 요약 필드만 볼 수 있었다.
       그래서 호수가 여러 개인 작업에서 2호수부터는 고객정보가 비어 보이고,
       특이사항 설명도 사진이 있는 것만 나왔다.

     어디서 오나:
       cloud_sync.js pushFull() 이 이미 _session.json 통째로를
       schedules/{uid}/full/{workId} 에 json 문자열로 올리고 있다(재설치 복구용).
       그걸 공유 상대도 읽게 해서 같은 화면을 보게 하는 것이 이 함수의 역할.

     ⚠️ 사진은 절대 여기서 가져오지 않는다.
       _session.json 의 사진 정보는 '그 폰의 파일명'(fname)일 뿐이라,
       남의 세션에 적힌 파일명을 내 쪽에 쓰면 있지도 않은 파일을 가리키게 되어
       사진이 통째로 안 보이거나(참조 깨짐), 그 상태로 저장하면 클라우드 정리
       로직이 실제 사진을 지운다. 사진은 지금처럼 photos 서브컬렉션 + Storage
       (cloudName 기준)로만 주고받는다. 이 함수는 '글자'만 본다.

     실패해도 조용히 null → 규칙 게시 전이거나 구독자가 아니면 기존 동작 그대로.
  ═══════════════════════════════════════════════════════════ */
  CloudPhotoSync.fetchFullSession = async function (ownerUid, workId) {
    try {
      if (!loggedIn() || !ownerUid || !workId) return null;
      var snap = await db().collection('schedules').doc(ownerUid)
        .collection('full').doc(safeId(workId)).get();
      if (!snap.exists) return null;
      var d = snap.data() || {};
      if (!d.json) return null;
      var sess = JSON.parse(d.json);
      if (!sess || !Array.isArray(sess.units)) return null;
      return sess;
    } catch (e) {
      // 권한 없음(규칙 미게시) / 문서 없음 / JSON 깨짐 → 요약 정보로 폴백
      console.log('[CloudPhotoSync] 전체본 없음 - 요약 정보로 표시:', e && (e.code || e.message));
      return null;
    }
  };

  // 전체본에서 '글자'만 뽑아 units 에 채운다. 사진 배열은 손대지 않는다.
  function _cpsFillTextFromFull(newUnits, sess) {
    if (!sess || !Array.isArray(sess.units)) return 0;
    var TXT = ['name', 'contact', 'phone', 'address', 'memo', 'workTarget', 'price', 'startTime', 'endTime'];
    var byName = {};
    sess.units.forEach(function (fu) {
      if (!fu) return;
      var k = fu.name || '(호수 미상)';
      if (!byName[k]) byName[k] = fu;
    });
    var filled = 0;
    newUnits.forEach(function (nu) {
      var fu = byName[nu.name];
      if (!fu) return;
      // ① 고객정보(글자만)
      if (fu.customer) {
        nu.customer = nu.customer || {};
        TXT.forEach(function (k) {
          var v = fu.customer[k];
          if (v !== undefined && v !== null && v !== '') nu.customer[k] = v;
        });
        filled++;
      }
      // ② 특이사항 '설명'만 — photos 배열은 사진 경로로 이미 채워져 있으므로 건드리지 않는다
      if (Array.isArray(fu.specials)) {
        nu.specials = nu.specials || [];
        fu.specials.forEach(function (fs, si) {
          if (!fs) return;
          if (!nu.specials[si]) nu.specials[si] = { desc: '', photos: [] };   // 사진 없는 특이사항도 보이게
          if (fs.desc) nu.specials[si].desc = fs.desc;
        });
      }
    });
    return filled;
  }

  // ★ 쾌적 열기용: 달력이 이미 가진 itemData만으로 스케줄을 즉시 작업탭에 표시(네트워크·파일 접근 0)
  function _quickOpenSchedule(ownerUid, workId, itemData) {
    var it = itemData || {};
    var names = (Array.isArray(it.unitNames) && it.unitNames.length) ? it.unitNames.slice() : ['1호'];
    var qUnits = names.map(function (nm, i) {
      return { id: i + 1, name: nm || ((i + 1) + '호'), before: [], after: [], specials: [],
               open: true, customerOpen: true, customer: { phone: '', address: '', memo: '' } };
    });
    units = qUnits;
    nid = qUnits.length + 1;
    currentWorkId = workId;
    currentFolderName = null;
    // ★ 작업 전환 = 작업 귀속 전역 초기화 (state.js resetWorkGlobals 한 곳에서 관리)
    if (typeof resetWorkGlobals === 'function') resetWorkGlobals();
    CloudPhotoSync._fullPostIds = {};   // ★ 2026-08-16: 이전 작업의 '원작업자 글' 표시도 함께 비운다
    /* ★ 2026-08-16 상대 작업의 업종. id 는 상대 폰 것이라 내 목록엔 없다 →
         표시는 스냅샷(아이콘·이름)으로, 내가 쓰는 지침은 이름이 같은 내 업종으로 떨어진다
         (Profiles.forCurrentWork 3단계 폴백). */
    try {
      if (window.Profiles) Profiles.bindWork(it.profileId || '',
        it.profileSnap || ((it.profileIcon || it.profileName)
          ? { icon: it.profileIcon || '', name: it.profileName || '' } : null));
      window._workProfileLoaded = true;   // ★ 2026-08-23 저장된(공유) 작업을 연 것
    } catch (e) {}
    // ★ 2026-08-11 버그수정: 내 소유 작업(캘린더 병합목록에 '공유'로 섞여 들어온 내 수동일정 등)을
    //   열 때도 여기로 올 수 있음 - ownerUid가 나 자신이면 "빌려보기"가 아니라 내 작업이므로
    //   _borrowedShare를 세우지 않는다(안 그러면 새로 찍는 사진이 계속 "공유 사진"으로 잠기고
    //   순서편집(끌기 핸들)도 사라짐)
    var _isMyOwn = !!(window.Cloud && Cloud.user && ownerUid === Cloud.user.uid);
    window._borrowedShare = _isMyOwn ? null : { ownerUid: ownerUid, workId: workId };
    currentWorkType = (it.workType === 'facility') ? 'facility' : 'household';
    if (typeof facilityCustomer !== 'undefined') {
      facilityCustomer = {
        phone: it.phone || '', contact: '', address: it.address || '',
        memo: it.memo || '', workTarget: it.target || '',
        price: (it.price != null ? it.price : ''), startTime: it.startTime || '', endTime: it.endTime || ''
      };
    }
    if (currentWorkType !== 'facility' && qUnits[0]) {
      qUnits[0].customer = {
        name: '', contact: '',
        phone: it.phone || '', address: it.address || '', memo: it.memo || '',
        workTarget: it.target || '', price: (it.price != null ? it.price : ''),
        startTime: it.startTime || '', endTime: it.endTime || ''
      };
    }
    if (typeof applyWorkTypeUI === 'function') applyWorkTypeUI();
    var aptEl = document.getElementById('aptName'); if (aptEl) aptEl.value = it.apt || '';
    var dateEl = document.getElementById('workDate'); if (dateEl) dateEl.value = it.date || '';
    /* ★ 2026-08-13: 담당자(worker)를 채우는 코드가 아예 없었다.
       그래서 담당자를 바꿔도 작업탭에는 옛 값(또는 내 기본 닉네임)이 남아 '안 바뀐다'로 보였다.
       공유 중이면 입력칸(input)이 숨고 select(#workerNickSel)가 대신 보이므로 둘 다 맞춘다.
       select 에 없는 값을 넣으면 브라우저가 빈 값으로 되돌리므로 옵션을 직접 추가한다.
       renderAll 이 콤보를 다시 그릴 수 있어 잠시 뒤 한 번 더 확인한다(render.js 와 같은 이유). */
    var _setWorkerField = function () {
      try {
        var nm = it.worker || '';
        if (!nm) return;
        var inp = document.getElementById('workerName');
        if (inp && inp.value !== nm) inp.value = nm;
        var sel = document.getElementById('workerNickSel');
        if (sel) {
          var found = false;
          for (var wi = 0; wi < sel.options.length; wi++) { if (sel.options[wi].value === nm) { found = true; break; } }
          if (!found) { var op = document.createElement('option'); op.value = nm; op.textContent = nm; sel.appendChild(op); }
          if (sel.value !== nm) sel.value = nm;
        }
      } catch (e) {}
    };
    _setWorkerField();
    if (typeof _dataDirty !== 'undefined') _dataDirty = false;
    if (typeof quickSnapshot === 'function' && typeof _lastSaveSnapshot !== 'undefined') {
      try { _lastSaveSnapshot = quickSnapshot(); } catch (e) {}
    }
    var modal = document.getElementById('customerModal'); if (modal) modal.classList.remove('open');
    var slm = document.getElementById('slModal'); if (slm) slm.classList.remove('open');
    if (typeof switchTab === 'function') switchTab('work');
    if (typeof renderAll === 'function') renderAll();
    if (typeof updateStats === 'function') updateStats();
    _setWorkerField();
    setTimeout(_setWorkerField, 0);
    setTimeout(_setWorkerField, 400);   // 공유 프로필 스냅샷이 늦게 와 콤보를 다시 그리는 경우 대비
  }

  CloudPhotoSync.openInWorkTab = async function (ownerUid, workId, itemData) {
    if (!window.Cloud || !Cloud.ready || !Cloud.user) { if (typeof showToast === 'function') showToast('먼저 로그인해주세요', 'err'); return; }
    if (!ownerUid || !workId) { if (typeof showToast === 'function') showToast('작업 정보를 찾을 수 없습니다', 'err'); return; }

    CloudPhotoSync._openSeq = (CloudPhotoSync._openSeq || 0) + 1;
    var _mySeq = CloudPhotoSync._openSeq;
    // ★ 쾌적 열기: 달력이 이미 가진 itemData로 스케줄을 '즉시' 표시(딜레이 0). 사진/폴더/다운로드는 아래에서 백그라운드로 보강.
    try { _quickOpenSchedule(ownerUid, workId, itemData); } catch (eq) { console.warn('[CloudPhotoSync] 즉시 열기 실패', eq); }
    try {
      // 1) 사진 메타 조회
      var snap = await db().collection('schedules').doc(ownerUid).collection('items').doc(safeId(workId)).collection('photos').get();
      var photoDocs = [];
      snap.forEach(function (d) { photoDocs.push(d.data() || {}); });

      // 2) 로컬에 없는 사진은 즉시 다운로드 (openViewer의 ensureLocalFile 로직과 동일한 방식)
      //    ★ photoFolderHandle이 아직 안 잡혀 있으면(콜드스타트 직후 초기화 경합 등)
      //      바로 포기하지 않고 _cpsEnsureFolderHandle로 즉시 재확보를 한 번 더 시도한다.
      var dir = null;
      var dirSetupError = null;
      // ★ 진단용 - "폴더 없음"이 왜 발생했는지 화면에 바로 찍기 위한 스냅샷
      var diagIsNative = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
      var diagNativeFS = !!window.NativeFS;
      var diagHadHandleBefore = !!_cpsGetFolderHandle();
      var folderHandle = null;
      try {
        folderHandle = await _cpsEnsureFolderHandle();
        if (folderHandle) {
          var root = await folderHandle.getDirectoryHandle('_shared', { create: true });
          var ownerDir = await root.getDirectoryHandle(safeId(ownerUid), { create: true });
          dir = await ownerDir.getDirectoryHandle(safeId(workId), { create: true });
        }
      } catch (eDir) {
        dirSetupError = eDir && (eDir.code || eDir.message || String(eDir));
        console.warn('[CloudPhotoSync] 공유 폴더 준비 실패', dirSetupError);
      }

      // ★ "진짜 만료(storagePath 없음)"와 "다운로드 일시 실패(권한/네트워크)"를 구분 - 후자를 만료로 오판하면
      //   방금 올린 사진도 "원본 요청"을 묻는 오작동이 생김
      async function getBlobFor(p){
        if (!dir) {
          var diag = '[네이티브:' + (diagIsNative ? 'Y' : 'N') +
            ' NativeFS:' + (diagNativeFS ? 'Y' : 'N') +
            ' 이전핸들:' + (diagHadHandleBefore ? 'Y' : 'N') +
            ' 재연결후:' + (folderHandle ? 'Y' : 'N') +
            (dirSetupError ? ' 오류:' + dirSetupError : '') + ']';
          return { status: 'failed', detail: '사진 저장 폴더가 연결되어 있지 않습니다 ' + diag };
        }
        if (!p.fname) return { status: 'failed', detail: '사진 파일명 정보 없음' };
        var localName = p.cloudName || p.fname;   // ★ 유일 파일명(호수 간 충돌 방지)
        // ① 이미 로컬에 있으면 재다운로드/변환 없이 즉시 반환(지연로딩으로 표시) → 재열람이 빠름
        try {
          var fh = await dir.getFileHandle(localName, { create: false });
          var file = await fh.getFile();
          // 순서편집 등으로 클라우드 내용이 바뀐 경우(크기 상이)만 다시 받는다
          if (!(p.storagePath && p.size && file && file.size && file.size !== p.size)) {
            return { status: 'local', localName: localName };   // 캐시 적중 - 서버에서 다시 받지 않음
          }
        } catch (e) { /* 로컬에 없음 → 아래에서 다운로드 */ }
        // ② 로컬에 없거나 내용이 바뀐 사진만 다운로드(추가분만 받기)
        if (!p.storagePath) return { status: 'expired' }; // 진짜 만료(7일 지나 storagePath 비워짐)
        try {
          var blob = await _cpsFetchBlob(p.storagePath);
          var fh2 = await dir.getFileHandle(localName, { create: true });
          var w = await fh2.createWritable();
          await w.write(blob);
          await w.close();
          return { status: 'downloaded', blob: blob, localName: localName };
        } catch (e2) {
          console.warn('[CloudPhotoSync] 원본 다운로드 실패(만료 아님 - storagePath 존재)', p.fname, e2 && (e2.code || e2.message));
          return { status: 'failed', detail: e2 && (e2.code || e2.message) };
        }
      }

      // ★ 2026-08-12: 원작업자의 전체본(_session.json)을 먼저 읽어둔다.
      //   호수 구성·호수별 고객정보·특이사항 설명을 그대로 보여주기 위함(글자만 사용).
      //   구독자가 아니거나 규칙 미게시면 null → 아래 요약 정보 경로로 그대로 동작.
      var _fullSess = null;
      try { _fullSess = await CloudPhotoSync.fetchFullSession(ownerUid, workId); } catch (eF) {}

      // 3) 호수별로 묶어서 units 배열 구성
      var groups = {};
      var order = [];
      // ★ 사진이 없어도 호수가 보이도록, 일정 항목의 호수 이름(unitNames)을 먼저 넣는다
      if (itemData && Array.isArray(itemData.unitNames)) {
        itemData.unitNames.forEach(function (nm) {
          var key = nm || '(호수 미상)';
          if (!groups[key]) { groups[key] = []; order.push(key); }
        });
      }
      // ★ 전체본에 있는 호수도 빠짐없이 (요약 unitNames는 최대 8개로 잘려 올라간다 - cloud_sync.js toPayload)
      if (_fullSess && Array.isArray(_fullSess.units)) {
        _fullSess.units.forEach(function (fu) {
          var key = (fu && fu.name) || '(호수 미상)';
          if (!groups[key]) { groups[key] = []; order.push(key); }
        });
      }
      photoDocs.forEach(function (p) {
        var key = p.unitName || '(호수 미상)';
        if (!groups[key]) { groups[key] = []; order.push(key); }
        groups[key].push(p);
      });
      // 사진도 없고 호수 이름도 없으면 최소 1호수를 만들어 빈 작업탭을 방지
      if (!order.length) { order.push('1호'); groups['1호'] = []; }
      // ★ 정렬(2026-07-11 개정): 원작업자가 기록한 photoOrder(항목 문서) 우선, 없으면 기존 fname 순.
      //   photoOrder에는 상대가 보탠 사진(add_)도 포함 → 원작업자가 정한 전체 순서가 그대로 재현됨.
      //   달력 캐시(itemData)가 낡았거나 필드가 빠졌을 수 있어 항목 문서에서 직접 읽는 것을 우선한다.
      var _po = (itemData && itemData.photoOrder) || {};
      try {
        var _itSnap = await db().collection('schedules').doc(ownerUid).collection('items').doc(safeId(workId)).get();
        if (_itSnap.exists) {
          var _itData = _itSnap.data() || {};
          if (_itData.photoOrder) _po = _itData.photoOrder;
        }
      } catch (ePo) { /* 실패 시 itemData/fname 폴백 */ }
      order.forEach(function (k) {
        groups[k].sort(function (a, b) {
          var ra = a.role || 'before', rb = b.role || 'before';
          if (ra !== rb) return ra < rb ? -1 : ra > rb ? 1 : 0;
          var list = _po[_cpsSafeId(k) + '__' + ra];
          if (list && list.indexOf) {
            var ia = list.indexOf(a.cloudName || a.fname || ''), ib = list.indexOf(b.cloudName || b.fname || '');
            if (ia < 0) ia = 1e9;
            if (ib < 0) ib = 1e9;
            if (ia !== ib) return ia - ib;
          }
          var fa = a.fname || '', fb = b.fname || '';
          return fa < fb ? -1 : fa > fb ? 1 : 0;
        });
      });

      var totalPhotos = photoDocs.length;
      var processed = 0, cachedCount = 0, downloadedCount = 0;
      var newUnits = [];
      var expiredCount = 0;
      var downloadFailCount = 0;
      var firstDownloadErrorDetail = null; // ★ 진단용 - 화면에 바로 띄워서 원인 파악
      var hasLazy = false;
      function progress(label){
        if (typeof showOverlay === 'function') showOverlay(label + ' ' + processed + '/' + totalPhotos + '장');
      }

      for (var gi = 0; gi < order.length; gi++) {
        var unitName = order[gi];
        var newUnit = {
          id: gi + 1, name: unitName,
          before: [], after: [], specials: [],
          open: true, customerOpen: true,
          customer: { phone: '', address: '', memo: '' }
        };
        var plist = groups[unitName];
        for (var pi = 0; pi < plist.length; pi++) {
          var p = plist[pi];
          var got = await getBlobFor(p);   // ★ 로컬 캐시면 네트워크 없이 즉시 반환 → 오버레이 안 띄움(내 작업처럼 빠르게)
          processed++;
          if (got.status === 'downloaded') progress('📥 사진을 받는 중입니다');   // 실제 다운로드할 때만 진행 표시
          if (got.status === 'expired') { expiredCount++; continue; }
          if (got.status === 'failed') {
            downloadFailCount++;
            if (!firstDownloadErrorDetail) firstDownloadErrorDetail = got.detail || '(원인 불명)';
            continue;
          }
          var photoObj = {
            id: (typeof photoId === 'function') ? photoId() : ('p_' + Date.now() + '_' + pi),
            fileName: got.localName || p.fname,   // ★ 로컬 실제 파일명(지연로딩이 이 이름으로 찾음)
            _workDir: dir,                         // ★ 공유 미러 폴더 - 지연로딩/재로딩용
            savedToFolder: true, hasOriginal: true,
            _cloudUploaded: true, // 이미 클라우드에 있는 원본 - 재저장 시 다시 업로드하지 않도록 표시
            _addedByMe: !!(p.addedBy && window.Cloud && Cloud.user && p.addedBy === Cloud.user.uid)  // ★ 내가 올린 사진 → 나는 삭제 가능
          };
          if (got.status === 'downloaded') {
            // 방금 서버에서 받은 것만 즉시 변환(이미 blob이 있어 저렴) (C: 추가분만 받음)
            downloadedCount++;
            progress('📥 사진을 가져오는 중입니다');
            photoObj.dataUrl = (typeof blobToDataURL === 'function') ? await blobToDataURL(got.blob) : null;
          } else {
            // 캐시 적중(status==='local') - 변환/다운로드 없이 지연로딩에 맡김 → 재열람이 빠름 (C)
            cachedCount++;
            photoObj.dataUrl = null;
            hasLazy = true;
          }
          var bucket = roleToBucket(p.role);
          if (bucket === 'before') newUnit.before.push(photoObj);
          else if (bucket === 'after') newUnit.after.push(photoObj);
          else if (bucket && typeof bucket === 'object') {
            while (newUnit.specials.length <= bucket.special) newUnit.specials.push({ desc: '', photos: [] });
            newUnit.specials[bucket.special].photos.push(photoObj);
          }
        }
        newUnits.push(newUnit);
      }

      // 4) 전역 상태 채우기 (내 작업을 여는 것과 동일한 방식)
      // ★ 그 사이 사용자가 다른 작업을 열었거나(seq) 편집을 시작(_dataDirty)했으면 통째 교체하지 않는다(입력 보호)
      if (CloudPhotoSync._openSeq !== _mySeq) return;
      if (typeof _dataDirty !== 'undefined' && _dataDirty) {
        if (typeof showToast === 'function' && totalPhotos > 0) showToast('편집 중이라 사진은 다시 열 때 반영됩니다', 'ok');
        return;
      }
      units = newUnits;
      nid = newUnits.length + 1;
      // ★ 같은 작업에 진짜 보태기: workId를 새로 만들지 않고 원본 그대로 유지
      //   (여기서 새 사진을 추가로 찍으면 saveToFolder가 _borrowedShare를 감지해
      //    saveBorrowedPhotos()로 우회 → 원본 소유자의 클라우드 항목에 실제로 추가됨)
      currentWorkId = workId;
      currentFolderName = null; // 로컬 폴더는 만들지 않음 - 개인 폴더 정리 로직에 절대 안 걸리게 격리
      // ★ 2026-08-11 버그수정: ownerUid가 나 자신이면 빌려보기가 아니라 내 작업 - 잠금/순서편집 비활성화 방지
      window._borrowedShare = (window.Cloud && Cloud.user && ownerUid === Cloud.user.uid) ? null : { ownerUid: ownerUid, workId: workId };
      /* ★ 2026-08-13: 이전 작업의 저장된 글이 따라오지 않게 비운 뒤,
           전체본에 이 작업의 글이 있으면 그것만 넣는다(읽기 전용 표시).
           달력 슬림캐시는 posts 를 개수([1,1,1])로만 담으므로 '글 모양'인지 검사한다. */
      try {
        if (typeof resetWorkGlobals === 'function') resetWorkGlobals();
        var _lp = function (a) {
          return Array.isArray(a) && a.length > 0 &&
                 a.every(function (x) { return x && typeof x === 'object' && typeof x.text === 'string'; });
        };
        if (_fullSess && _lp(_fullSess.posts)) {
          workPosts = _fullSess.posts;
          workPostMemo = (typeof _fullSess.postMemo === 'string') ? _fullSess.postMemo : '';
          /* ★ 2026-08-16: 여기서 온 글은 '원작업자 글'이다.
               syncPosts 가 이걸 내 것인 양 다시 올리면 작성자(authorUid)가 나로 뒤바뀌어
               원작업자 글을 내가 지울 수 있게 된다 → 올리지 않도록 표시해 둔다.
               원작업자 글의 업로드는 원작업자 폰(dialogs.js 복원 직후)이 책임진다. */
          CloudPhotoSync._fullPostIds = {};
          workPosts.forEach(function (p) { if (p && p.id) CloudPhotoSync._fullPostIds[p.id] = 1; });
        }
        /* ★ 2026-08-16 업종 재바인딩 — resetWorkGlobals 가 방금 비웠으므로 여기서 다시 싣는다.
             전체본(_fullSess)에 스냅샷이 있으면 그게 가장 정확하다(요약보다 뒤에 적용). */
        if (window.Profiles) {
          /* ⚠️ 순서 주의 — 업종은 **item 문서가 우선**이다.
               full(전체본)은 규칙상 소유자만 쓸 수 있어서, 공유작업자가 상세창에서 업종을 바꾸면
               그 변경은 item 에만 들어간다. full 을 먼저 보면 방금 바꾼 업종이 옛 값으로 덮인다.
               (다른 글자 필드는 full 이 더 완전해서 full 우선인 것과 반대다) */
          var _itSnap = (itemData && itemData.profileSnap) ||
                        ((itemData && (itemData.profileIcon || itemData.profileName))
                          ? { icon: itemData.profileIcon || '', name: itemData.profileName || '' } : null);
          var _pid = (itemData && itemData.profileId) || (_fullSess && _fullSess.profileId) || '';
          var _sn  = _itSnap || (_fullSess && _fullSess.profileSnap) || null;
          Profiles.bindWork(_pid, _sn);
          window._workProfileLoaded = true;   // ★ 2026-08-23 저장된(공유) 작업을 연 것
        }
      } catch (e) {}
      currentWorkType = (itemData && itemData.workType === 'facility') ? 'facility' : 'household';
      if (typeof facilityCustomer !== 'undefined') {
        facilityCustomer = {
          phone: (itemData && itemData.phone) || '', contact: '', address: (itemData && itemData.address) || '',
          memo: (itemData && itemData.memo) || '', workTarget: (itemData && itemData.target) || '',
          price: (itemData && itemData.price) || '', startTime: (itemData && itemData.startTime) || '', endTime: (itemData && itemData.endTime) || ''
        };
      }
      // 가정용: 공유 항목의 고객정보(1명분)를 첫 호수에 채운다(작업탭에서 고객정보가 비던 문제)
      if (currentWorkType !== 'facility' && itemData && newUnits[0]) {
        newUnits[0].customer = {
          name: '', contact: '',
          phone: itemData.phone || '', address: itemData.address || '', memo: itemData.memo || '',
          workTarget: itemData.target || '', price: (itemData.price != null ? itemData.price : ''),
          startTime: itemData.startTime || '', endTime: itemData.endTime || ''
        };
      }

      /* ★ 2026-08-12: 전체본의 '글자'를 덮어 씌운다 (요약 1명분보다 정확하므로 나중에 적용).
           채우는 것: 호수별 고객정보 / 특이사항 설명 / 시설 고객정보
           건드리지 않는 것: before·after·specials[].photos, fileName, workNum
           (남의 폰 파일명을 내 쪽에 쓰면 사진 참조가 깨지고, 그 상태로 저장하면
            autoUploadPhotos의 '편집 반영' 정리가 실제 사진을 지운다) */
      if (_fullSess) {
        try {
          var _nFilled = _cpsFillTextFromFull(newUnits, _fullSess);
          if (currentWorkType === 'facility' && _fullSess.facilityCustomer &&
              typeof facilityCustomer !== 'undefined') {
            ['name', 'contact', 'phone', 'address', 'memo', 'workTarget', 'price', 'startTime', 'endTime']
              .forEach(function (k) {
                var v = _fullSess.facilityCustomer[k];
                if (v !== undefined && v !== null && v !== '') facilityCustomer[k] = v;
              });
          }
          console.log('[CloudPhotoSync] 전체본 반영: 호수 ' + newUnits.length + '개 중 ' + _nFilled + '개 고객정보 채움');
        } catch (eFill) { console.warn('[CloudPhotoSync] 전체본 반영 실패(요약으로 표시)', eFill && eFill.message); }
      }
      if (typeof applyWorkTypeUI === 'function') applyWorkTypeUI();

      var aptEl = document.getElementById('aptName'); if (aptEl) aptEl.value = (itemData && itemData.apt) || '';
      var dateEl = document.getElementById('workDate'); if (dateEl) dateEl.value = (itemData && itemData.date) || '';

      if (typeof _dataDirty !== 'undefined') _dataDirty = false;
      if (typeof quickSnapshot === 'function' && typeof _lastSaveSnapshot !== 'undefined') {
        try { _lastSaveSnapshot = quickSnapshot(); } catch (e) {}
      }

      // 5) 모달 닫고 작업 탭으로 전환 + 렌더
      var modal = document.getElementById('customerModal');
      if (modal) modal.classList.remove('open');
      document.getElementById('slModal') && document.getElementById('slModal').classList.remove('open');
      if (typeof switchTab === 'function') switchTab('work');
      if (typeof renderAll === 'function') renderAll();
      if (typeof updateStats === 'function') updateStats();

      // ★ 캐시된(로컬) 사진들 지연로딩 시작 - 화면엔 즉시 뜨고 사진은 백그라운드로 채워짐(빠름)
      if (hasLazy && typeof startLazyPhotoLoading === 'function') {
        setTimeout(function () { try { startLazyPhotoLoading(); } catch (e) {} }, 300);
      }

      // 작업탭이 열려 있는 동안 상대의 추가/삭제를 실시간 반영
      if (CloudPhotoSync.startLivePhotoSync) { try { CloudPhotoSync.startLivePhotoSync(ownerUid, workId); } catch (e) {} }

      if (typeof showToast === 'function') {
        var extraParts = [];
        if (downloadedCount > 0) extraParts.push('새로 받은 사진 ' + downloadedCount + '장');
        if (cachedCount > 0) extraParts.push('저장된 사진 ' + cachedCount + '장');
        if (expiredCount > 0) extraParts.push('만료 ' + expiredCount + '장 제외');
        if (downloadFailCount > 0) extraParts.push('실패 ' + downloadFailCount + '장(다시 열어보세요)');
        var msg = '✓ 불러오기 완료' + (extraParts.length ? ' (' + extraParts.join(', ') + ')' : '');
        showToast(msg, 'ok');
      }
      // ★ 진단용 - 다운로드 실패 원인을 화면에 바로 표시(원격디버깅 없이 바로 확인)
      if (downloadFailCount > 0 && firstDownloadErrorDetail) {
        setTimeout(function () {
          alert('📛 사진 다운로드 실패 원인(진단용)\n\n' + firstDownloadErrorDetail + '\n\n이 내용을 그대로 캡처해서 알려주세요.');
        }, 200);
      }
      // ★ 만료된(7일 지난) 원본이 있으면 재업로드 요청 여부 확인
      if (expiredCount > 0 && window.CloudPhotoSync && CloudPhotoSync.requestReupload) {
        setTimeout(function () {
          if (confirm('만료된 원본 사진 ' + expiredCount + '장이 있습니다.\n상대에게 원본 재업로드를 요청할까요?\n(상대가 앱을 열면 자동으로 전달됩니다)')) {
            CloudPhotoSync.requestReupload(ownerUid, workId);
          }
        }, 300);
      }
    } catch (e) {
      console.warn('[CloudPhotoSync] 작업탭 불러오기 실패', e);
      if (typeof showToast === 'function') showToast('불러오기 실패: ' + (e && e.message), 'err');
    } finally {
      if (typeof hideOverlay === 'function') hideOverlay();
      /* ★ 2026-08-16: 저장된 글을 클라우드 posts 서브컬렉션과 맞춘다.
           위에서 채운 전체본(full)의 글은 '구독자만 업로드·소유자만 쓰기'라 비어 있을 수 있다.
           여기서 합쳐야 구독 여부와 무관하게 양쪽 글이 다 보인다.
           finally 에 두는 이유: 사진 다운로드가 실패하거나 중간에 return 해도 글은 맞춘다.
           _openSeq 로 '지금도 이 작업이 열려 있는지' 확인해 엉뚱한 작업 오염을 막는다. */
      if (CloudPhotoSync.syncPosts && CloudPhotoSync._openSeq === _mySeq) {
        CloudPhotoSync.syncPosts(function () { return CloudPhotoSync._openSeq === _mySeq; })
          .catch(function (e2) { console.warn('[글작성] 공유 글 동기화 실패', e2 && e2.message); });
      }
    }
  };
})();

/* ═══════════════════════════════════════════════
   7일 만료 정리 (내 사진만, 클라이언트 트리거)
   - Cloud Functions 없이(Spark 무료 플랜 유지) 내 앱이 열릴 때 스스로 정리
   - uploadedAt 기준 7일 지난 storagePath만 Storage에서 삭제하고 필드 비움
   - Firestore 문서(일정/텍스트/썸네일)는 그대로 유지 - "원본요청"으로 재업로드 가능
═══════════════════════════════════════════════ */
(function () {
  'use strict';
  window.CloudPhotoSync = window.CloudPhotoSync || {};
  var TTL_MS = 7 * 24 * 60 * 60 * 1000;

  function loggedIn(){ return window.Cloud && Cloud.ready && Cloud.user; }
  function myUid(){ return Cloud.user.uid; }
  function db(){ return Cloud.db; }
  function stg(){ return firebase.storage(); }

  var _cleaning = false;
  CloudPhotoSync.cleanupExpiredMine = async function () {
    if (!loggedIn() || _cleaning) return;
    _cleaning = true;
    try {
      var itemsSnap = await db().collection('schedules').doc(myUid()).collection('items').get();
      var cutoff = Date.now() - TTL_MS;
      var cleaned = 0;
      for (var di = 0; di < itemsSnap.docs.length; di++) {
        var workId = itemsSnap.docs[di].id;
        try {
          var photosSnap = await db().collection('schedules').doc(myUid()).collection('items').doc(workId).collection('photos').get();
          for (var pi = 0; pi < photosSnap.docs.length; pi++) {
            var pdoc = photosSnap.docs[pi];
            var data = pdoc.data() || {};
            if (!data.storagePath || !data.uploadedAt) continue;
            var ts = (typeof data.uploadedAt.toMillis === 'function') ? data.uploadedAt.toMillis() : 0;
            if (!ts || ts > cutoff) continue;
            try { await stg().ref(data.storagePath).delete(); } catch (e) { /* 이미 없어도 무시 */ }
            await pdoc.ref.update({
              storagePath: firebase.firestore.FieldValue.delete(),
              expiredAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            cleaned++;
          }
        } catch (e) { console.warn('[CloudPhotoSync] 만료 정리 조회 실패', workId, e && e.code); }
      }
      if (cleaned > 0) console.log('[CloudPhotoSync] 만료 원본 정리: ' + cleaned + '장');
    } catch (e) {
      console.warn('[CloudPhotoSync] 만료 정리 실패', e);
    } finally {
      _cleaning = false;
    }
  };

  // ★ 2026-07-09 정책 변경: 원본 7일 자동삭제 폐기 → 원본은 영구보관하고
  //    오래된 원본은 GCS 수명주기(Nearline/Coldline)로 자동 계층화(저장비 절감).
  //    아래 자동삭제 스케줄러는 비활성화. (cleanupExpiredMine 함수는 수동 호출용으로만 남겨둠)
  // document.addEventListener('cloud-auth-changed', function (e) {
  //   if (e && e.detail && e.detail.user) {
  //     setTimeout(function () { CloudPhotoSync.cleanupExpiredMine(); }, 8000);
  //   }
  // });
})();

/* ═══════════════════════════════════════════════
   원본 요청 - 만료된(storagePath 없는) 사진을 상대에게 재업로드 요청
   - 승인 절차 없음: 일정 문서에 요청 표시만 하면, 원본 소유자가 그 작업을
     다음에 열 때(정상 "열기" 흐름) 이미 로드된 로컬 파일 핸들로 자동 재업로드
   - Firestore 규칙 변경 불필요: items 문서 update는 이미 소유자+상대 모두 허용됨
═══════════════════════════════════════════════ */
(function () {
  'use strict';
  window.CloudPhotoSync = window.CloudPhotoSync || {};

  function loggedIn(){ return window.Cloud && Cloud.ready && Cloud.user; }
  function myUid(){ return Cloud.user.uid; }
  function db(){ return Cloud.db; }
  function safeId(name){ return String(name||'').replace(/[\/\.\#\$\[\]]/g, '_').slice(0, 200); }

  CloudPhotoSync.requestReupload = function (ownerUid, workId) {
    if (!loggedIn()) { if (typeof showToast === 'function') showToast('먼저 로그인해주세요', 'err'); return Promise.reject(); }
    if (!ownerUid || !workId) return Promise.reject();
    return db().collection('schedules').doc(ownerUid).collection('items').doc(safeId(workId))
      .update({
        reuploadRequestedAt: firebase.firestore.FieldValue.serverTimestamp(),
        reuploadRequestedBy: myUid()
      })
      .then(function () {
        if (typeof showToast === 'function') showToast('📩 원본 요청을 보냈습니다 (상대가 앱을 열면 자동으로 다시 받아집니다)', 'ok');
      })
      .catch(function (e) {
        console.warn('[CloudPhotoSync] 원본 요청 실패', e);
        if (typeof showToast === 'function') showToast('요청 실패: ' + (e && e.code), 'err');
        throw e;
      });
  };

  // 원본 소유자가 자기 작업을 다시 열었을 때(restoreFromData 완료 후 호출됨) -
  // 요청이 있으면 만료 사진을 재업로드. 이미 로드된 photo._workDir 핸들만 사용(새 폴더 탐색 없음, 안전).
  CloudPhotoSync.fulfillReuploadRequest = async function (workId, units) {
    if (!loggedIn() || !workId || !Array.isArray(units)) return;
    var itemRef = db().collection('schedules').doc(myUid()).collection('items').doc(safeId(workId));
    try {
      var itemSnap = await itemRef.get();
      var item = itemSnap.data();
      if (!item || !item.reuploadRequestedAt) return; // 요청 없음

      var photosSnap = await itemRef.collection('photos').get();
      var expired = {}; // cloudName -> docRef
      photosSnap.forEach(function (d) {
        var data = d.data() || {};
        if (data.storagePath) return;
        var key = data.cloudName || _cpsCloudName(data.unitName, data.role, data.fname);
        expired[key] = d.ref;
      });
      if (!Object.keys(expired).length) {
        await itemRef.update({
          reuploadRequestedAt: firebase.firestore.FieldValue.delete(),
          reuploadRequestedBy: firebase.firestore.FieldValue.delete()
        });
        return;
      }

      var reuploaded = 0;
      for (var ui = 0; ui < units.length; ui++) {
        var u = units[ui];
        // ★ 역할(before/after/specialN)을 추적해 cloudName으로 매칭 - 호수 간 파일명 충돌 방지
        var roleList = [];
        (u.before || []).forEach(function (p) { roleList.push({ p: p, role: 'before' }); });
        (u.after || []).forEach(function (p) { roleList.push({ p: p, role: 'after' }); });
        (u.specials || []).forEach(function (s, si) {
          (s.photos || []).forEach(function (p) { roleList.push({ p: p, role: 'special' + (si + 1) }); });
        });
        for (var pi = 0; pi < roleList.length; pi++) {
          var p = roleList[pi].p;
          if (!p.fileName || !p._workDir) continue;
          var cloudName = _cpsCloudName(u.name, roleList[pi].role, p.fileName);
          if (!expired[cloudName]) continue;
          try {
            var fh = await p._workDir.getFileHandle(p.fileName);
            var file = await fh.getFile();
            var storagePath = 'sharedPhotos/' + myUid() + '/' + safeId(workId) + '/' + cloudName + '.jpg';
            await firebase.storage().ref(storagePath).put(file, { contentType: 'image/jpeg' });
            await expired[cloudName].update({
              storagePath: storagePath,
              cloudName: cloudName,
              uploadedAt: firebase.firestore.FieldValue.serverTimestamp(),
              expiredAt: firebase.firestore.FieldValue.delete()
            });
            _cpsUploadThumb(myUid(), workId, cloudName, file).then(function (_tp) {
              if (_tp) expired[cloudName].update({ thumbPath: _tp }).catch(function () {});
            }).catch(function () {});
            reuploaded++;
          } catch (e) { console.warn('[CloudPhotoSync] 원본 재업로드 실패', p.fileName, e && e.message); }
        }
      }
      await itemRef.update({
        reuploadRequestedAt: firebase.firestore.FieldValue.delete(),
        reuploadRequestedBy: firebase.firestore.FieldValue.delete()
      });
      if (reuploaded > 0 && typeof showToast === 'function') {
        showToast('📤 요청받은 원본 사진 ' + reuploaded + '장을 다시 올렸습니다', 'ok');
      }
    } catch (e) {
      console.warn('[CloudPhotoSync] 원본요청 처리 실패', e);
    }
  };
})();
