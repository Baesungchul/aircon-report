/* ═══════════════════════════════════════════════════════════
   backup.js — 전체 작업 백업 / 복원 (앱 삭제 대비)
   ----------------------------------------------------------------
   ★ 메모리 안전 설계 (v2): 사진을 zip 하나로 메모리에서 압축하면
     사진이 많을 때 OOM으로 앱이 강제 종료된다. 그래서 압축하지 않고
     **파일을 하나씩 복사**한다 (네이티브 복사 → JS 메모리 거의 안 씀, 용량 무제한).
   · 백업: 앱 전용 저장소(EXTERNAL/work-report) 전체를
     공용 문서(Documents/work-report-backups/backup_<시각>/)로 파일단위 복사.
   · 복원: 그 백업 폴더에서 EXTERNAL로 되돌림 (최신 자동).
   · 옛 zip 백업도 복원 가능 (restoreBackupFromZip, JSZip 사용).
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function _isNative() {
    return !!(window.NativeFS && typeof NativeFS.isNative === 'function' && NativeFS.isNative());
  }
  function _FS() {
    var p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
    if (!p) throw new Error('Capacitor Filesystem 없음');
    return p;
  }
  function _pad(n) { return String(n).padStart(2, '0'); }
  function _stamp() {
    var d = new Date();
    return d.getFullYear() + _pad(d.getMonth() + 1) + _pad(d.getDate()) + '_' +
           _pad(d.getHours()) + _pad(d.getMinutes()) + _pad(d.getSeconds());
  }
  function _toast(msg, type) { if (typeof showToast === 'function') showToast(msg, type || ''); }

  async function _appFolder() {
    if (window.NativeFS && NativeFS.resolveAppFolder) {
      try { return await NativeFS.resolveAppFolder(); } catch (e) {}
    }
    return 'work-report';
  }

  // 디렉토리 1단계 목록 → [{name, isDir}]
  async function _list(dir, path) {
    var FS = _FS(); var r;
    try { r = await FS.readdir({ path: path, directory: dir }); } catch (e) { return []; }
    var files = (r && r.files) || []; var out = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var name = (typeof f === 'string') ? f : f.name;
      var ty = (typeof f === 'object' && (f.type || f.kind)) || null;
      if (ty !== 'directory' && ty !== 'file') {
        try { var st = await FS.stat({ path: path + '/' + name, directory: dir }); ty = st && st.type; }
        catch (e) { ty = 'file'; }
      }
      out.push({ name: name, isDir: ty === 'directory' });
    }
    return out;
  }

  async function _exists(dir, path) {
    try { await _FS().stat({ path: path, directory: dir }); return true; }
    catch (e) { return false; }
  }

  // 디렉토리 간 복사. 일부 기기에서 FS.copy(DOCUMENTS→EXTERNAL)가 막히면
  // readFile→writeFile 로 폴백한다.
  async function _copyFile(fromDir, fromPath, toPath) {
    var FS = _FS();
    try {
      await FS.copy({ from: fromPath, to: toPath, directory: fromDir, toDirectory: 'EXTERNAL' });
      return;
    } catch (e1) {
      var rd = await FS.readFile({ path: fromPath, directory: fromDir });
      var data = (rd && rd.data != null) ? rd.data : rd;
      await FS.writeFile({ path: toPath, data: data, directory: 'EXTERNAL', recursive: true });
    }
  }

  /* ═══════════ 백업 내보내기 (파일단위 복사) ═══════════ */
  async function exportBackup() {
    if (!_isNative()) { _toast('이 기능은 앱에서만 지원됩니다', 'err'); return; }
    var FS = _FS();
    try {
      if (typeof showOverlay === 'function') showOverlay('백업 만드는 중...');
      // ★ 설정·지침·학습기록을 _appdata.json 으로 먼저 남긴다 (아래 복사에 자동 포함)
      try { if (window.AppData && AppData.write) await AppData.write(); } catch (e) {}
      var appFolder = await _appFolder();
      var dest = 'work-report-backups/backup_' + _stamp();

      // 대상 디렉토리: 공용 문서 우선(파일앱에서 보임) → 실패 시 앱 전용
      var destDir = 'DOCUMENTS';
      try { await FS.mkdir({ path: dest, directory: destDir, recursive: true }); }
      catch (e) {
        destDir = 'EXTERNAL';
        try { await FS.mkdir({ path: dest, directory: destDir, recursive: true }); }
        catch (e2) { throw new Error('백업 폴더를 만들 수 없습니다'); }
      }

      var copied = 0, failed = 0, total = 0;
      async function walkCopy(rel) {
        var items = await _list('EXTERNAL', appFolder + (rel ? '/' + rel : ''));
        for (var i = 0; i < items.length; i++) {
          var childRel = rel ? rel + '/' + items[i].name : items[i].name;
          if (items[i].isDir) {
            try { await FS.mkdir({ path: dest + '/' + childRel, directory: destDir, recursive: true }); } catch (e) {}
            await walkCopy(childRel);
          } else {
            try {
              await FS.copy({ from: appFolder + '/' + childRel, to: dest + '/' + childRel, directory: 'EXTERNAL', toDirectory: destDir });
              copied++;
            } catch (e) { failed++; console.warn('[백업] 복사 실패:', childRel, e && e.message); }
            total++;
            if (total % 8 === 0) { if (typeof setProg === 'function') setProg(0, '복사 중 ' + total + '개'); await new Promise(function (r) { setTimeout(r, 0); }); }
          }
        }
      }
      await walkCopy('');

      if (typeof hideOverlay === 'function') hideOverlay();
      if (copied === 0) { _toast('백업할 사진이 없습니다', 'err'); return; }
      var label = (destDir === 'DOCUMENTS')
        ? '내장메모리 > Documents > ' + dest
        : '앱 전용 폴더(파일앱에서 안 보일 수 있음) > ' + dest;
      alert('✅ 백업 완료\n\n사진/파일 ' + copied + '개 복사' + (failed ? (' (실패 ' + failed + ')') : '') +
            '\n저장 위치:\n' + label +
            '\n\n\'내 파일\' 앱에서 이 폴더를 드라이브/PC로 복사해두면 앱을 지워도 안전합니다.');
    } catch (e) {
      if (typeof hideOverlay === 'function') hideOverlay();
      _toast('백업 실패: ' + (e && e.message), 'err');
    }
  }

  /* ═══════════ 백업 폴더 이름 → 읽기 좋은 날짜 ═══════════ */
  function _fmtBackupName(name) {
    var m = String(name).match(/^backup_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/);
    if (!m) return name;
    return m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5];
  }

  /* ═══════════ zip 내부 경로 → 앱 기준 상대경로 ═══════════
     사용자가 직접 압축한 zip도 인식: 날짜 폴더(YYYY-MM-DD…)부터 시작하도록 잘라냄.
     날짜 폴더가 없으면 work-report / aircon-report / backup_… 래퍼만 제거. */
  function _relFromZipPath(path) {
    var parts = String(path).replace(/^\/+/, '').split('/');
    for (var i = 0; i < parts.length; i++) {
      if (/^\d{4}-\d{2}-\d{2}/.test(parts[i])) return parts.slice(i).join('/');
    }
    var rel = parts.join('/');
    rel = rel.replace(/^(work-report|aircon-report)\//, '');
    rel = rel.replace(/^backup_[^/]+\//, '');
    return rel;
  }

  /* ═══════════ 위치 라벨 ═══════════ */
  function _dirLabel(dir) {
    if (dir === 'DOCUMENTS') return '문서';
    if (dir === 'EXTERNAL')  return '앱 전용';
    return dir;
  }

  /* ═══════════ 이 폴더가 작업 백업처럼 생겼나 (가벼운 점검) ═══════════ */
  async function _looksLikeBackup(dir, path) {
    var kids = await _list(dir, path);
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (!k.isDir) continue;
      if (/^\d{4}-\d{2}-\d{2}/.test(k.name)) return true;               // 날짜 폴더 직접 포함
      if (k.name === 'work-report' || k.name === 'aircon-report') return true;
      if (/^backup_/.test(k.name)) return true;
    }
    return false;
  }

  /* ═══════════ 복원 가능한 폴더 모으기 ═══════════
     · 앱 백업 폴더(work-report-backups/*) — 문서/앱전용
     · 문서 루트에 사용자가 직접 복사해 넣은 폴더
  ═══════════════════════════════════════════════ */
  async function _gatherRestoreFolders() {
    var out = [], seen = {};
    var bases = [
      { dir: 'DOCUMENTS', path: 'work-report-backups' },
      { dir: 'EXTERNAL',  path: 'work-report-backups' },
      { dir: 'DOCUMENTS', path: '' }   // 문서 루트(외부에서 복사해온 폴더)
    ];
    for (var b = 0; b < bases.length; b++) {
      var base = bases[b];
      var list = await _list(base.dir, base.path);
      for (var i = 0; i < list.length; i++) {
        if (!list[i].isDir) continue;
        var name = list[i].name;
        if (base.path === '' && name === 'work-report-backups') continue;  // 위에서 이미 처리
        var full = base.path ? (base.path + '/' + name) : name;
        var key = base.dir + '|' + full;
        if (seen[key]) continue;
        try {
          if (await _looksLikeBackup(base.dir, full)) {
            seen[key] = true;
            out.push({ dir: base.dir, path: full, name: name });
          }
        } catch (e) {}
      }
    }
    // 최신 백업(backup_…) 이름이 위로 오도록 정렬
    out.sort(function (a, b) { return a.name < b.name ? 1 : (a.name > b.name ? -1 : 0); });
    return out;
  }

  /* ═══════════ 폴더 안에서 '날짜 폴더가 있는 위치' 찾기 ═══════════ */
  async function _findDataRoot(dir, root) {
    var kids = await _list(dir, root);
    var hasDate = kids.some(function (k) { return k.isDir && /^\d{4}-\d{2}-\d{2}/.test(k.name); });
    if (hasDate) return root;
    // work-report / aircon-report 하위
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.isDir && (k.name === 'work-report' || k.name === 'aircon-report')) {
        var sub = root + '/' + k.name;
        var subkids = await _list(dir, sub);
        if (subkids.some(function (x) { return x.isDir && /^\d{4}-\d{2}-\d{2}/.test(x.name); })) return sub;
      }
    }
    // backup_… 한 단계 더 내려가서 재귀
    for (var j = 0; j < kids.length; j++) {
      var k2 = kids[j];
      if (k2.isDir && /^backup_/.test(k2.name)) {
        var r = await _findDataRoot(dir, root + '/' + k2.name);
        if (r) return r;
      }
    }
    return root;  // 폴백: 그대로
  }

  /* ═══════════ 복원할 폴더 선택 모달 ═══════════ */
  function _chooseRestoreFolder(folders) {
    return new Promise(function (resolve) {
      var ov = document.createElement('div');
      ov.className = 'bk-choose-overlay';
      var itemsHtml = folders.map(function (f, idx) {
        var pretty = /^backup_/.test(f.name) ? _fmtBackupName(f.name) : f.name;
        return '<button class="bk-choose-item" data-i="' + idx + '">' +
                 '<span class="bk-choose-when">' + _esc(pretty) + '</span>' +
                 '<span class="bk-choose-raw">' + _dirLabel(f.dir) + ' · ' + _esc(f.path) + '</span>' +
               '</button>';
      }).join('');
      ov.innerHTML =
        '<div class="bk-choose-box">' +
          '<div class="bk-choose-title">📁 복원할 폴더 선택</div>' +
          '<div class="bk-choose-hint">앱 백업뿐 아니라, PC·파일앱에서 <b>문서(Documents)</b> 폴더에 복사해 넣은 작업 폴더도 여기에 나타납니다.</div>' +
          '<div class="bk-choose-list">' + itemsHtml + '</div>' +
          '<button class="btn b-ghost bk-choose-cancel">취소</button>' +
        '</div>';
      document.body.appendChild(ov);
      function done(v) { ov.remove(); resolve(v); }
      ov.addEventListener('click', function (e) {
        var t = e.target;
        if (t === ov || (t.classList && t.classList.contains('bk-choose-cancel'))) { done(null); return; }
        var btn = t.closest ? t.closest('.bk-choose-item') : null;
        if (btn) done(folders[parseInt(btn.getAttribute('data-i'), 10)]);
      });
    });
  }

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ═══════════ 폴더에서 복원 (앱 백업 + 외부 복사 폴더) ═══════════ */
  async function restoreBackupFromFolder() {
    if (!_isNative()) { _toast('이 기능은 앱에서만 지원됩니다', 'err'); return; }
    var FS = _FS();
    try {
      if (typeof showOverlay === 'function') showOverlay('백업 폴더 찾는 중...');
      var folders = await _gatherRestoreFolders();
      if (typeof hideOverlay === 'function') hideOverlay();

      if (!folders.length) {
        alert('복원할 폴더를 찾지 못했습니다.\n\n· 앱에서 만든 폴더 백업이 없거나,\n· 외부에서 가져온 폴더라면 휴대폰 \'문서(Documents)\' 폴더 안에 복사해 넣어주세요.\n\n또는 \'ZIP에서 복원\'을 사용하세요.');
        return;
      }

      var chosen = await _chooseRestoreFolder(folders);
      if (!chosen) return;

      if (typeof showOverlay === 'function') showOverlay('복원 준비 중...');
      var dataRoot = await _findDataRoot(chosen.dir, chosen.path);

      var prettyName = /^backup_/.test(chosen.name) ? _fmtBackupName(chosen.name) : chosen.name;
      if (typeof hideOverlay === 'function') hideOverlay();
      if (!confirm('선택한 폴더로 복원합니다:\n' + prettyName +
                   '\n\n없어진 사진만 채웁니다.\n지금 있는 사진·정보는 그대로 둡니다(덮어쓰지 않음). 진행할까요?')) return;

      if (typeof showOverlay === 'function') showOverlay('복원 중...');
      var srcDir = chosen.dir;
      var appFolder = await _appFolder();
      console.log('[복원] 시작 chosen=', JSON.stringify(chosen), 'dataRoot=', dataRoot, '→ appFolder=', appFolder);
      try {
        var _raw = await FS.readdir({ path: dataRoot, directory: srcDir });
        console.log('[복원진단] RAW readdir(dataRoot):', JSON.stringify(_raw && _raw.files));
        // ★ 첫 날짜폴더에서 중첩 접근 능력 점검 (readdir vs 정확경로 read)
        var _f0e = (_raw && _raw.files && _raw.files[0]) || null;
        var _f0 = _f0e ? (_f0e.name || _f0e) : null;
        if (_f0) {
          var _np = dataRoot + '/' + _f0;
          try {
            var _nr = await FS.readdir({ path: _np, directory: srcDir });
            console.log('[복원진단] 중첩 readdir(' + _f0 + '):', JSON.stringify(_nr && _nr.files));
          } catch (e) { console.warn('[복원진단] 중첩 readdir 실패(' + _f0 + '):', e && e.message); }
          try {
            var _ss = await FS.stat({ path: _np + '/_session.json', directory: srcDir });
            console.log('[복원진단] _session.json stat OK:', JSON.stringify(_ss));
          } catch (e) { console.warn('[복원진단] _session.json stat 실패:', e && e.message); }
          try {
            var _rf = await FS.readFile({ path: _np + '/_session.json', directory: srcDir, encoding: 'utf8' });
            var _txt = (_rf && _rf.data != null) ? String(_rf.data) : '';
            console.log('[복원진단] _session.json 정확경로 읽기 OK, 길이=' + _txt.length + ' 앞부분:', _txt.slice(0, 80));
          } catch (e) { console.warn('[복원진단] _session.json 정확경로 읽기 실패:', e && e.message); }
        }
      } catch (e) { console.warn('[복원진단] RAW readdir 실패:', e && e.message); }
      var ok = 0, skip = 0, fail = 0, prog = 0, lastErr = '';
      async function walkRestore(rel) {
        var here = dataRoot + (rel ? '/' + rel : '');
        var items = await _list(srcDir, here);
        console.log('[복원진단] 스캔 [' + (rel || '(root)') + '] ' + items.length + '개:',
                    items.map(function (x) { return x.name + (x.isDir ? '/' : ''); }).join(', '));
        for (var i = 0; i < items.length; i++) {
          var childRel = rel ? rel + '/' + items[i].name : items[i].name;
          if (items[i].isDir) {
            try { await FS.mkdir({ path: appFolder + '/' + childRel, directory: 'EXTERNAL', recursive: true }); } catch (e) {}
            await walkRestore(childRel);
          } else {
            prog++;
            // ★ 비파괴: 이미 있는 파일은 건너뜀 (지금 데이터/정보 보호, 없는 것만 채움)
            if (await _exists('EXTERNAL', appFolder + '/' + childRel)) { skip++; }
            else {
              try { await _copyFile(srcDir, dataRoot + '/' + childRel, appFolder + '/' + childRel); ok++; }
              catch (e) {
                // 폴더를 파일로 오판했을 가능성 → 디렉토리로 재시도
                var sub = await _list(srcDir, dataRoot + '/' + childRel);
                if (sub && sub.length) {
                  try { await FS.mkdir({ path: appFolder + '/' + childRel, directory: 'EXTERNAL', recursive: true }); } catch (e2) {}
                  await walkRestore(childRel);
                } else {
                  fail++; lastErr = (e && e.message) || String(e);
                  console.warn('[복원] 실패:', childRel, lastErr);
                }
              }
            }
            if (prog % 8 === 0) { if (typeof setProg === 'function') setProg(0, '복원 중 ' + prog + '개'); await new Promise(function (r) { setTimeout(r, 0); }); }
          }
        }
      }
      await walkRestore('');

      if (typeof invalidateWorkIndex === 'function') invalidateWorkIndex();
      if (typeof invalidateRecordsCache === 'function') invalidateRecordsCache();
      if (typeof hideOverlay === 'function') hideOverlay();
      if (ok === 0 && skip === 0 && fail === 0) {
        _toast('폴더 안에서 사진·파일을 찾지 못했습니다 (폴더 구조 확인)', 'err');
        return;
      }
      if (ok === 0 && skip === 0) {
        // 파일은 찾았지만 전부 복사 실패 → 진짜 원인(권한/경로)을 표시
        _toast('파일은 찾았으나 복원에 실패했습니다 (' + fail + '개): ' + lastErr, 'err');
        return;
      }
      // ★ 설정·지침·학습기록(_appdata.json)도 함께 되살릴지 제안 (2026-08-09)
      try { if (window.AppData && AppData.autoApply) AppData.autoApply(); } catch (e) {}
      alert('✅ 복원 완료\n\n새로 채운 파일 ' + ok + '개' + (skip ? (' · 그대로 둠 ' + skip + '개') : '') + (fail ? (' · 실패 ' + fail + '개' ) : '') +
            '\n\n스케줄/작업기록을 열어 확인하세요.');
    } catch (e) {
      if (typeof hideOverlay === 'function') hideOverlay();
      _toast('복원 실패: ' + (e && e.message), 'err');
    }
  }

  /* ═══════════ 폴더 직접 선택 복원 (파일 선택기 / SAF) ═══════════
     공용 Documents 백업을 Capacitor Filesystem이 직접 못 읽을 때(EACCES)
     사용한다. 사용자가 폴더를 직접 고르면 WebView가 읽기 권한을 부여하므로
     파일 내용을 읽어 EXTERNAL(앱 전용)로 되돌릴 수 있다. ZIP과 달리 파일을
     하나씩 처리하므로 메모리(OOM) 위험도 없다. */
  async function importBackupFromPicker() {
    // 1) 네이티브 SAF 폴더 선택기 우선 (권한 문제 없음, 압축 불필요, OOM 없음)
    var BF = (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.BackupFolder) || null;
    if (BF && BF.pickFolder && BF.restoreTree) {
      try {
        var picked = await BF.pickFolder();
        if (!picked || picked.cancelled || !picked.uri) return;  // 사용자가 취소
        if (typeof showOverlay === 'function') showOverlay('복원 중... (잠시만요)');
        var appFolder = await _appFolder();
        var res = await BF.restoreTree({ uri: picked.uri, appFolder: appFolder });
        if (typeof invalidateWorkIndex === 'function') invalidateWorkIndex();
        if (typeof invalidateRecordsCache === 'function') invalidateRecordsCache();
        var ok = (res && res.ok) || 0, skip = (res && res.skip) || 0, fail = (res && res.fail) || 0;
        console.log('[복원] SAF 결과 ok=' + ok + ' skip=' + skip + ' fail=' + fail);
        // 복원 직후 인덱스 재빌드(_session.json 다시 읽어 기록/스케줄 즉시 반영)
        if ((ok > 0) && typeof rebuildIndexFromFolders === 'function') {
          try { await rebuildIndexFromFolders(); } catch (e) { console.warn('[복원] 재빌드 경고:', e && e.message); }
        }
        if (typeof hideOverlay === 'function') hideOverlay();
        if (ok === 0 && skip === 0) {
          _toast('복원할 파일을 찾지 못했습니다 (실패 ' + fail + '개). 백업 폴더가 맞는지 확인하세요.', 'err');
          return;
        }
      // ★ 설정·지침·학습기록(_appdata.json)도 함께 되살릴지 제안 (2026-08-09)
      try { if (window.AppData && AppData.autoApply) AppData.autoApply(); } catch (e) {}
      alert('\u2705 복원 완료\n\n새로 채운 파일 ' + ok + '개' + (skip ? (' \u00b7 그대로 둠 ' + skip + '개') : '') + (fail ? (' \u00b7 실패 ' + fail + '개') : '') +
              '\n\n스케줄/작업기록을 열어 확인하세요.');
        return;
      } catch (e) {
        if (typeof hideOverlay === 'function') hideOverlay();
        var m = (e && (e.message || e.errorMessage)) || String(e);
        if (/취소|cancel/i.test(m)) return;
        _toast('폴더 복원 실패: ' + m, 'err');
        return;
      }
    }
    // 2) 폴백: 웹 폴더 선택기 (webkitdirectory) — 지원 안 하는 기기도 있음
    var input = document.createElement('input');
    input.type = 'file';
    try { input.webkitdirectory = true; } catch (e) {}
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.multiple = true;
    input.addEventListener('change', async function () {
      var files = input.files ? Array.prototype.slice.call(input.files) : [];
      await restoreBackupFromFileList(files);
    });
    input.click();
  }

  function _readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var sft = String(fr.result || '');
        var c = sft.indexOf(',');
        resolve(c >= 0 ? sft.slice(c + 1) : sft);
      };
      fr.onerror = function () { reject(fr.error || new Error('파일 읽기 실패')); };
      fr.readAsDataURL(file);
    });
  }

  async function restoreBackupFromFileList(files) {
    if (!_isNative()) { _toast('이 기능은 앱에서만 지원됩니다', 'err'); return; }
    if (!files || !files.length) { _toast('선택된 파일이 없습니다', 'err'); return; }
    var FS = _FS();
    try {
      if (typeof showOverlay === 'function') showOverlay('복원 준비 중...');
      var appFolder = await _appFolder();
      // 앱 기준 상대경로(날짜폴더부터)로 변환
      var items = [];
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var raw = f.webkitRelativePath || f.name;
        var rel = _relFromZipPath(raw);
        if (!rel) continue;
        items.push({ file: f, rel: rel });
      }
      console.log('[복원] 폴더선택: 파일 ' + files.length + '개 중 백업파일 ' + items.length + '개');
      if (!items.length) {
        if (typeof hideOverlay === 'function') hideOverlay();
        _toast('백업 구조의 파일을 찾지 못했습니다 (날짜 폴더 없음)', 'err');
        return;
      }
      var ok = 0, skip = 0, fail = 0, lastErr = '';
      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        if (typeof setProg === 'function') setProg((j / items.length) * 100, '복원 중 ' + (j + 1) + '/' + items.length);
        // ★ 비파괴: 이미 있는 파일은 건너뜀 (지금 데이터 보호, 없는 것만 채움)
        if (await _exists('EXTERNAL', appFolder + '/' + it.rel)) { skip++; }
        else {
          try {
            var b64 = await _readFileAsBase64(it.file);
            await FS.writeFile({ path: appFolder + '/' + it.rel, data: b64, directory: 'EXTERNAL', recursive: true });
            ok++;
          } catch (e) { fail++; lastErr = (e && e.message) || String(e); console.warn('[복원] 쓰기 실패:', it.rel, lastErr); }
        }
        if (j % 8 === 7) await new Promise(function (r) { setTimeout(r, 0); });
      }
      if (typeof invalidateWorkIndex === 'function') invalidateWorkIndex();
      if (typeof invalidateRecordsCache === 'function') invalidateRecordsCache();
      if (typeof hideOverlay === 'function') hideOverlay();
      if (ok === 0 && skip === 0) {
        _toast('복원에 실패했습니다 (' + fail + '개): ' + lastErr, 'err');
        return;
      }
      // ★ 설정·지침·학습기록(_appdata.json)도 함께 되살릴지 제안 (2026-08-09)
      try { if (window.AppData && AppData.autoApply) AppData.autoApply(); } catch (e) {}
      alert('\u2705 복원 완료\n\n새로 채운 파일 ' + ok + '개' + (skip ? (' \u00b7 그대로 둠 ' + skip + '개') : '') + (fail ? (' \u00b7 실패 ' + fail + '개') : '') +
            '\n\n스케줄/작업기록을 열어 확인하세요.');
    } catch (e) {
      if (typeof hideOverlay === 'function') hideOverlay();
      _toast('복원 실패: ' + (e && e.message), 'err');
    }
  }

  /* ═══════════ (호환) 옛 zip 백업 복원 ═══════════ */
  function importBackupZip() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.addEventListener('change', async function () {
      if (!input.files || !input.files[0]) return;
      await restoreBackupFromZip(input.files[0]);
    });
    input.click();
  }

  async function restoreBackupFromZip(file) {
    if (typeof JSZip === 'undefined') { _toast('백업 모듈(JSZip) 로드 실패', 'err'); return; }
    if (!_isNative()) { _toast('이 기능은 앱에서만 지원됩니다', 'err'); return; }
    try {
      if (typeof showOverlay === 'function') showOverlay('복원 준비 중...');
      var zip = await JSZip.loadAsync(file);
      var FS = _FS();
      var appFolder = await _appFolder();
      var entries = [];
      zip.forEach(function (path, e) { if (!e.dir) entries.push({ path: path, e: e }); });
      if (!entries.length) {
        if (typeof hideOverlay === 'function') hideOverlay();
        _toast('백업 파일이 비어있거나 형식이 다릅니다', 'err');
        return;
      }
      var ok = 0, skip = 0, fail = 0;
      for (var i = 0; i < entries.length; i++) {
        var path = entries[i].path;
        if (typeof setProg === 'function') setProg((i / entries.length) * 100, '복원 중 ' + (i + 1) + '/' + entries.length);
        var rel = _relFromZipPath(path);
        if (!rel) continue;
        // ★ 비파괴: 이미 있는 파일은 건너뜀 (지금 데이터 보호, 없는 것만 채움)
        if (await _exists('EXTERNAL', appFolder + '/' + rel)) { skip++; continue; }
        try {
          var b64 = await entries[i].e.async('base64');
          await FS.writeFile({ path: appFolder + '/' + rel, data: b64, directory: 'EXTERNAL', recursive: true });
          ok++;
        } catch (err) { fail++; console.warn('[복원] 실패:', path, err.message); }
        if (i % 8 === 7) await new Promise(function (r) { setTimeout(r, 0); });
      }
      if (typeof invalidateWorkIndex === 'function') invalidateWorkIndex();
      if (typeof invalidateRecordsCache === 'function') invalidateRecordsCache();
      if (typeof hideOverlay === 'function') hideOverlay();
      // ★ 설정·지침·학습기록(_appdata.json)도 함께 되살릴지 제안 (2026-08-09)
      try { if (window.AppData && AppData.autoApply) AppData.autoApply(); } catch (e) {}
      alert('✅ 복원 완료\n\n새로 채운 파일 ' + ok + '개' + (skip ? (' · 그대로 둠 ' + skip + '개') : '') + (fail ? (' · 실패 ' + fail + '개') : '') +
            '\n\n스케줄/작업기록을 열어 확인하세요.');
    } catch (e) {
      if (typeof hideOverlay === 'function') hideOverlay();
      _toast('복원 실패: ' + e.message, 'err');
    }
  }

  // 전역 노출 + 버튼 연결
  window.exportBackup = exportBackup;
  window.restoreBackupFromFolder = restoreBackupFromFolder;
  window.restoreBackup = restoreBackupFromFolder;  // 호환
  window.importBackup = restoreBackupFromFolder;   // 호환
  window.importBackupZip = importBackupZip;         // zip 복원
  window.importBackupFromPicker = importBackupFromPicker;  // 폴더 직접 선택(SAF) 복원

  /* ☁️ 서버에서 복구: 미로그인 → 로그인창 / 로그인하면 바로 복구
     ★ 2026-08-24 예전엔 여기서 구독을 확인해 무료 계정을 요금제 창으로 돌려보냈다.
        작업 기록 복구를 무료 로그인에 개방하면서 이 입구도 함께 열어야 한다 —
        ⚠️ 안 열면 cloud_backup 쪽만 열려 있고 화면에서는 여전히 막혀 '되는데 안 되는' 상태가 된다.
        사진 복구는 여전히 구독 전용이며, 그 안내는 복구 팝업 안에서 한다. */
  /* ★ 2026-08-30 '로그인하고 나면 이어서 할 일'.
       그 전에는 복구를 누르면 로그인창만 뜨고, 로그인해도 아무 일이 없어서
       사용자가 복구 버튼을 다시 눌러야 했다 — 로그인한 이유가 복구인데도.
       온보딩이 쓰는 방식(_obAfterLogin)과 같은 얼개다. */
  var _afterLogin = null, _afterLoginAt = 0;
  var AFTER_LOGIN_TTL = 3 * 60 * 1000;   // 3분
  document.addEventListener('cloud-auth-changed', function (e) {
    if (!(e && e.detail && e.detail.user)) return;   // 로그아웃은 대상 아님
    var fn = _afterLogin, at = _afterLoginAt;
    _afterLogin = null; _afterLoginAt = 0;
    if (!fn) return;
    /* ⚠️ 시간 제한이 필요하다. 로그인창을 그냥 닫아버린 뒤 한참 있다가 다른 이유로
         로그인하면, 시키지도 않은 복구창이 튀어나온다. 그건 놀랄 일이다. */
    if (Date.now() - at > AFTER_LOGIN_TTL) return;
    /* ⚠️ 곧바로 부르지 않는다. 이 이벤트 시점엔 로그인창이 막 닫히는 중이고
         CloudBackup 쪽 초기 pull 도 아직이다. 조금 기다렸다 이어간다. */
    setTimeout(function () { try { fn(); } catch (e2) {} }, 600);
  });

  function restoreFromServer() {
    if (!(window.Cloud && Cloud.user)) {
      if (typeof showToast === 'function') showToast('서버 복구는 로그인이 필요해요', 'ok');
      _afterLogin = restoreFromServer; _afterLoginAt = Date.now();   // ★ 로그인 끝나면 여기로 되돌아온다
      if (window.Cloud && Cloud.openModal) Cloud.openModal();
      else if (typeof openCloudModal === 'function') openCloudModal();
      return;
    }
    _afterLogin = null; _afterLoginAt = 0;           // 이어달리기 완료 — 남겨두면 다음 로그인 때 또 뜬다
    if (window.CloudBackup && CloudBackup.checkAndOfferRestore) CloudBackup.checkAndOfferRestore(true, { notify: true });
    else if (typeof showToast === 'function') showToast('복구 모듈을 찾을 수 없어요', 'err');
  }
  window.restoreFromServer = restoreFromServer;

  function wire() {
    var be = document.getElementById('btnBackupExport');
    var bz = document.getElementById('btnRestoreZip');
    var bp = document.getElementById('btnRestorePicker');
    var bsv = document.getElementById('btnRestoreServer');
    if (be) be.addEventListener('click', exportBackup);
    if (bz) bz.addEventListener('click', importBackupZip);
    if (bp) bp.addEventListener('click', importBackupFromPicker);  // 📁 폴더에서 복원(네이티브 SAF 우선)
    if (bsv) bsv.addEventListener('click', restoreFromServer);     // ☁️ 서버에서 복구
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();

/* ══════════════════════════════════════════════════
   복원 방법 고르기 (2026-08-09)
   설정 화면에 복원 버튼이 3개나 늘어서 있어 복잡했다.
   '♻️ 복원하기' 하나로 모으고, 여기서 상황에 맞게 고르게 한다.
   실제 동작은 기존 버튼(btnRestorePicker / btnRestoreZip / btnRestoreServer)을
   그대로 눌러주는 방식이라 기존 로직은 손대지 않는다.
══════════════════════════════════════════════════ */
(function () {
  'use strict';
  function open() {
    var isSub = false;
    try { isSub = !!(window.CloudBackup && CloudBackup.isSub && CloudBackup.isSub()); } catch (e) {}
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:3250;display:flex;align-items:center;justify-content:center;padding:18px;overflow-y:auto;';
    function card(id, icon, title, desc, tag) {
      return '<button type="button" data-go="' + id + '" style="display:block;width:100%;text-align:left;' +
        'background:var(--sf2,rgba(255,255,255,.05));border:1px solid var(--bd,#2a2f36);border-radius:12px;' +
        'padding:13px 14px;margin-bottom:8px;color:var(--tx);cursor:pointer;">' +
        '<div style="font-size:14px;font-weight:800;margin-bottom:3px;">' + icon + ' ' + title +
          (tag ? ' <span style="font-size:10px;font-weight:700;color:var(--ac);">' + tag + '</span>' : '') + '</div>' +
        '<div style="font-size:12px;color:var(--mu);line-height:1.5;">' + desc + '</div></button>';
    }
    ov.innerHTML = '<div style="background:var(--sf);border-radius:14px;padding:20px;max-width:400px;width:100%;">' +
      '<div style="font-size:17px;font-weight:800;margin-bottom:4px;">♻️ 무엇으로 되돌릴까요?</div>' +
      '<div style="font-size:12px;color:var(--mu);line-height:1.6;margin-bottom:14px;">' +
        '지금 있는 사진·정보는 그대로 두고 <b>없어진 것만</b> 채웁니다.</div>' +
      card('btnRestoreServer', '☁️', '서버에서 복구',
           '로그인 계정에 백업된 작업 기록을 받아옵니다. 기기를 바꿨을 때 가장 간단해요.' +
           (isSub ? ' 사진도 함께 받아옵니다.' : ' <b>사진은 구독 사용자만</b> 받아올 수 있어요.'),
           '') +
      card('btnRestorePicker', '📁', '백업 폴더에서 복원', '자동백업으로 만들어진 폴더를 골라 되돌립니다.') +
      card('btnRestoreZip', '🗜️', 'ZIP 파일에서 복원', '다른 곳에 옮겨 둔 백업 ZIP 파일이 있을 때 사용하세요.') +
      '<button class="btn b-ghost" id="rcCancel" style="width:100%;justify-content:center;margin-top:4px;">닫기</button>' +
      '</div>';
    document.body.appendChild(ov);
    ov.querySelector('#rcCancel').onclick = function () { ov.remove(); };
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
    ov.querySelectorAll('button[data-go]').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-go');
        ov.remove();
        var real = document.getElementById(id);
        if (real) real.click();
        else if (typeof showToast === 'function') showToast('복원 기능을 불러오지 못했습니다', 'err');
      };
    });
  }
  function wire() {
    var b = document.getElementById('btnRestoreOpen');
    if (b && !b._rcWired) { b._rcWired = true; b.addEventListener('click', open); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
  window.openRestoreChooser = open;
})();
