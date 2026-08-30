/* ═══════════════════════════════════════════════════════════
   gallery.js — 갤러리(사진앱) 내보내기
   ----------------------------------------------------------------
   · 작업 데이터 저장소(EXTERNAL, Android/data/...)는 그대로 두고,
     사용자가 "보고 싶은" 사진/보고서를 안드로이드 갤러리에 복사한다.
   · 네이티브 GallerySaver 플러그인(MediaStore) 사용:
       - API 29+ : 권한 불필요, 재설치해도 EACCES 없음, 즉시 갤러리 노출.
       - 저장 위치: 사진/Pictures/작업보고서
   · 백업/복원(backup.js, EXTERNAL 전용)과 완전히 분리 → 충돌 없음.
   · index.html에서 native-fs.js 뒤, report.js·folder.js 앞에 로드.
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const ALBUM = '작업보고서';

  function isNative() {
    return !!(window.Capacitor
      && typeof window.Capacitor.isNativePlatform === 'function'
      && window.Capacitor.isNativePlatform());
  }
  function _plugin() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.GallerySaver;
  }
  function _FS() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
  }
  function _toast(m, t) { if (typeof showToast === 'function') showToast(m, t || ''); }

  function blobToBase64(blob) {
    return new Promise(function (res, rej) {
      const r = new FileReader();
      r.onloadend = function () { const s = String(r.result); const i = s.indexOf(','); res(i >= 0 ? s.slice(i + 1) : s); };
      r.onerror = function () { rej(r.error || new Error('blob 읽기 실패')); };
      r.readAsDataURL(blob);
    });
  }
  function dataUrlToBase64(u) { const s = String(u); const i = s.indexOf(','); return i >= 0 ? s.slice(i + 1) : s; }

  // src: Blob | dataURL(string) | base64(string)  →  저장된 uri 반환
  async function saveImageToGallery(src, filename, album) {
    if (!isNative()) throw new Error('이 기능은 앱에서만 지원됩니다');
    const p = _plugin();
    if (!p) throw new Error('GallerySaver 플러그인 미등록 (npx cap sync 후 재빌드 필요)');
    let b64;
    if (typeof src === 'string') {
      b64 = src.indexOf(',') >= 0 ? dataUrlToBase64(src) : src;
    } else {
      b64 = await blobToBase64(src);
    }
    const r = await p.saveImage({
      data: b64,
      filename: filename || ('img_' + Date.now() + '.jpg'),
      album: album || ALBUM
    });
    return r && r.uri;
  }

  // EXTERNAL 저장소 재귀 순회 → 이미지 상대경로 배열
  async function _walkImages(basePath) {
    const FS = _FS();
    if (!FS) return [];
    const out = [];
    async function walk(rel) {
      const full = basePath + (rel ? '/' + rel : '');
      let entries = [];
      try { const r = await FS.readdir({ path: full, directory: 'EXTERNAL' }); entries = (r && r.files) || []; }
      catch (e) { return; }
      for (const ent of entries) {
        const nm = (typeof ent === 'string') ? ent : ent.name;
        let ty = (typeof ent === 'object' && (ent.type || ent.kind)) || null;
        const childRel = rel ? rel + '/' + nm : nm;
        if (ty !== 'directory' && ty !== 'file') {
          try { const st = await FS.stat({ path: basePath + '/' + childRel, directory: 'EXTERNAL' }); ty = st && st.type; }
          catch (e) { ty = 'file'; }
        }
        if (ty === 'directory') await walk(childRel);
        else if (/\.(jpe?g|png|webp)$/i.test(nm)) out.push(childRel);
      }
    }
    await walk('');
    return out;
  }

  async function _appFolder() {
    if (window.NativeFS && NativeFS.resolveAppFolder) {
      try { return await NativeFS.resolveAppFolder(); } catch (e) {}
    }
    return 'work-report';
  }

  // 현재 작업의 갤러리 앨범명: 작업보고서/<날짜_작업명>
  function workAlbumName() {
    const aptEl = document.getElementById('aptName');
    const dateEl = document.getElementById('workDate');
    const apt = ((aptEl && aptEl.value) || '작업').replace(/[\/\\:*?"<>|]/g, '_').trim() || '작업';
    const date = (dateEl && dateEl.value) || '';
    return ALBUM + '/' + (date ? date + '_' : '') + apt;
  }

  // 저장소에 보관된 모든 사진을 갤러리로 일괄 내보내기 (기존 사진 복구용)
  async function exportAllStoredPhotosToGallery() {
    if (!isNative()) { _toast('이 기능은 앱에서만 지원됩니다', 'err'); return; }
    if (!_plugin()) { _toast('갤러리 플러그인 미등록 (재빌드 필요)', 'err'); return; }
    const FS = _FS();
    if (!FS) { _toast('Filesystem 플러그인 없음', 'err'); return; }

    try {
      if (typeof showOverlay === 'function') showOverlay('사진 목록 읽는 중...');
      const appFolder = await _appFolder();
      const imgs = await _walkImages(appFolder);
      if (!imgs.length) {
        if (typeof hideOverlay === 'function') hideOverlay();
        _toast('내보낼 사진이 없습니다', 'err');
        return;
      }

      let ok = 0, fail = 0;
      for (let i = 0; i < imgs.length; i++) {
        const rel = imgs[i];
        if (typeof setProg === 'function') setProg((i / imgs.length) * 100, '갤러리 저장 ' + (i + 1) + '/' + imgs.length);
        try {
          const res = await FS.readFile({ path: appFolder + '/' + rel, directory: 'EXTERNAL' });
          // 작업폴더별 하위앨범: 작업보고서/<날짜_workNN>/파일명
          const parts = rel.split('/');
          const fileNm = parts.pop();
          const sub = parts.join('_');
          const subAlbum = sub ? (ALBUM + '/' + sub) : ALBUM;
          await saveImageToGallery(res.data, fileNm, subAlbum);
          ok++;
        } catch (e) { fail++; console.warn('[갤러리] 실패:', rel, e.message); }
        if (i % 6 === 5) await new Promise(function (r) { setTimeout(r, 0); });
      }

      if (typeof hideOverlay === 'function') hideOverlay();
      alert('✅ 갤러리 내보내기 완료\n\n' + ok + '장 저장' + (fail ? (' (실패 ' + fail + ')') : '') +
            '\n\n저장 위치: 갤러리 → 사진/Pictures/' + ALBUM);
    } catch (e) {
      if (typeof hideOverlay === 'function') hideOverlay();
      _toast('갤러리 내보내기 실패: ' + e.message, 'err');
    }
  }

  // 사진 한 장의 전체 해상도 데이터 확보 (메모리에 없는 lazy 사진은 파일에서 로드)
  async function _resolvePhoto(p) {
    if (typeof p === 'string') return { dataUrl: p };
    if (p && p._originalDataUrl) return { dataUrl: p._originalDataUrl };
    if (p && p.dataUrl && !p.lazy) return { dataUrl: p.dataUrl };
    try {
      let fh = p && p.fileHandle;
      if (!fh && p && p._workDir && p.fileName) fh = await p._workDir.getFileHandle(p.fileName);
      if (fh && fh.getFile) {
        const f = await fh.getFile();
        if (f && f.size > 0) return { blob: f };
      }
    } catch (e) { /* 폴백으로 진행 */ }
    if (p && p.dataUrl) return { dataUrl: p.dataUrl };
    return null;
  }

  // 현재 화면에 열려있는 작업의 사진을 작업별 앨범으로 한 번에 갤러리 저장
  async function exportCurrentWorkPhotosToGallery() {
    if (!isNative()) { _toast('이 기능은 앱에서만 지원됩니다', 'err'); return; }
    if (!_plugin()) { _toast('갤러리 플러그인 미등록 (재빌드 필요)', 'err'); return; }
    if (typeof units === 'undefined' || !Array.isArray(units)) { _toast('작업 정보를 찾을 수 없습니다', 'err'); return; }

    // 사진 개수 확인
    let total = 0;
    for (const u of units) {
      total += (u.before || []).length + (u.after || []).length;
      for (const sp of (u.specials || [])) total += (sp.photos || []).length;
    }
    if (total === 0) { _toast('이 작업에 저장할 사진이 없습니다', 'err'); return; }

    const album = workAlbumName();

    function gwn(name) { return (typeof getWorkNumber === 'function') ? getWorkNumber(name) : ''; }

    try {
      if (typeof showOverlay === 'function') showOverlay('갤러리에 저장 중...');
      let ok = 0, fail = 0, done = 0;

      async function one(p, num, prefix, idx) {
        if (typeof setProg === 'function') setProg((done / total) * 100, '갤러리 저장 ' + (done + 1) + '/' + total);
        done++;
        const r = await _resolvePhoto(p);
        if (!r) { fail++; return; }
        const fname = 'work' + num + '_' + prefix + String(idx).padStart(2, '0') + '.jpg';
        try { await saveImageToGallery(r.blob || r.dataUrl, fname, album); ok++; }
        catch (e) { fail++; console.warn('[갤러리] 실패:', fname, e.message); }
      }

      for (const u of units) {
        const num = gwn(u.name);
        for (let i = 0; i < (u.before || []).length; i++) await one(u.before[i], num, 'B_', i + 1);
        for (let i = 0; i < (u.after || []).length; i++) await one(u.after[i], num, 'A_', i + 1);
        const sps = u.specials || [];
        for (let si = 0; si < sps.length; si++) {
          const ph = sps[si].photos || [];
          for (let pi = 0; pi < ph.length; pi++) await one(ph[pi], num, 'S' + (si + 1) + '_', pi + 1);
        }
        await new Promise(function (r) { setTimeout(r, 0); });
      }

      if (typeof hideOverlay === 'function') hideOverlay();
      alert('✅ 갤러리 저장 완료\n\n' + ok + '장 저장' + (fail ? (' (실패 ' + fail + ')') : '') +
            '\n\n저장 위치: 갤러리 → 사진/Pictures/' + album);
    } catch (e) {
      if (typeof hideOverlay === 'function') hideOverlay();
      _toast('갤러리 저장 실패: ' + e.message, 'err');
    }
  }

  // 호수 1개의 사진을 현재 작업 앨범에 저장 (호수 카드의 "갤러리 저장" 버튼)
  async function exportUnitPhotosToGallery(uid) {
    if (!isNative()) { _toast('이 기능은 앱에서만 지원됩니다', 'err'); return; }
    if (!_plugin()) { _toast('갤러리 플러그인 미등록 (재빌드 필요)', 'err'); return; }
    if (typeof units === 'undefined' || !Array.isArray(units)) { _toast('작업 정보를 찾을 수 없습니다', 'err'); return; }
    const u = units.find(function (x) { return x && x.id === uid; });
    if (!u) { _toast('호수를 찾을 수 없습니다', 'err'); return; }

    let total = (u.before || []).length + (u.after || []).length;
    for (const sp of (u.specials || [])) total += (sp.photos || []).length;
    if (total === 0) { _toast('이 호수에 저장할 사진이 없습니다', 'err'); return; }

    const album = workAlbumName();
    const num = (typeof getWorkNumberForUnit === 'function') ? getWorkNumberForUnit(u)
              : (typeof getWorkNumber === 'function') ? getWorkNumber(u.name) : '';
    try {
      if (typeof showOverlay === 'function') showOverlay('갤러리에 저장 중...');
      let ok = 0, fail = 0, done = 0;
      async function one(p, prefix, idx) {
        if (typeof setProg === 'function') setProg((done / total) * 100, '갤러리 저장 ' + (done + 1) + '/' + total);
        done++;
        const r = await _resolvePhoto(p);
        if (!r) { fail++; return; }
        const fname = 'work' + num + '_' + prefix + String(idx).padStart(2, '0') + '.jpg';
        try { await saveImageToGallery(r.blob || r.dataUrl, fname, album); ok++; }
        catch (e) { fail++; console.warn('[갤러리] 실패:', fname, e.message); }
      }
      for (let i = 0; i < (u.before || []).length; i++) await one(u.before[i], 'B_', i + 1);
      for (let i = 0; i < (u.after || []).length; i++) await one(u.after[i], 'A_', i + 1);
      const sps = u.specials || [];
      for (let si = 0; si < sps.length; si++) {
        const ph = sps[si].photos || [];
        for (let pi = 0; pi < ph.length; pi++) await one(ph[pi], 'S' + (si + 1) + '_', pi + 1);
      }
      if (typeof hideOverlay === 'function') hideOverlay();
      alert('✅ 갤러리 저장 완료\n\n' + u.name + ' · ' + ok + '장' + (fail ? (' (실패 ' + fail + ')') : '') +
            '\n\n저장 위치: 갤러리 → 사진/Pictures/' + album);
    } catch (e) {
      if (typeof hideOverlay === 'function') hideOverlay();
      _toast('갤러리 저장 실패: ' + e.message, 'err');
    }
  }

  // 전역 노출
  window.Gallery = {
    isNative: isNative,
    available: function () { return isNative() && !!_plugin(); },
    saveImageToGallery: saveImageToGallery,
    /* ★ 2026-08-26 sns_share.js 가 사진을 base64 로 뽑아 쓰려고 필요 — 내부 함수를 공개한다 */
    resolvePhoto: _resolvePhoto,
    exportAllStoredPhotosToGallery: exportAllStoredPhotosToGallery,
    exportCurrentWorkPhotosToGallery: exportCurrentWorkPhotosToGallery,
    exportUnitPhotosToGallery: exportUnitPhotosToGallery,
    workAlbumName: workAlbumName,
    ALBUM: ALBUM
  };
  window.exportAllStoredPhotosToGallery = exportAllStoredPhotosToGallery;
  window.exportCurrentWorkPhotosToGallery = exportCurrentWorkPhotosToGallery;

  function wire() {
    const b = document.getElementById('btnGalleryExport');
    if (b) b.addEventListener('click', exportAllStoredPhotosToGallery);
    const w = document.getElementById('btnWorkToGallery');
    if (w) w.addEventListener('click', exportCurrentWorkPhotosToGallery);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();

  console.log('[Gallery] 로드됨, 네이티브:', isNative());
})();
