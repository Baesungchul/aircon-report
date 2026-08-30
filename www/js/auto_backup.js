/* ═══════════════════════════════════════════════════════════
   auto_backup.js — 앱을 벗어날 때 자동 증분 백업
   ----------------------------------------------------------------
   · 주 저장소(EXTERNAL/work-report)는 그대로 두고,
     앱이 백그라운드로 갈 때마다 바뀐 파일만 공용 문서로 복사한다.
       EXTERNAL/work-report/**  →  DOCUMENTS/work-report-backups/auto/**
   · 증분: 대상에 없거나 / 크기가 다르거나 / 원본이 더 최신일 때만 복사.
     (사진 추가·순서편집·_session.json 갱신·_shared 공유자료 모두 포함)
   · 백그라운드로 가며 중단되면, 다음에 앱을 켜거나 다시 나갈 때 이어서 보완.
   · 고정 대상 폴더 · 별도 권한 불필요(앱이 만든 파일 범위).
   ★ index.html에서 native-fs.js 이후에 로드할 것.
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  window.AutoBackup = window.AutoBackup || {};

  var DEST_BASE = 'work-report-backups/auto';
  var ENABLED_LS = 'auto_backup_enabled';
  var LAST_LS = 'auto_backup_last';
  var SAF_URI_LS = 'auto_backup_saf_uri';  // 사용자가 지정한 SAF 백업 폴더(재설치 후에도 쓰기 가능)
  var MIN_INTERVAL_MS = 4000;  // 너무 잦은 연속 실행 방지
  // ★ 2026-08-08 배터리 개선: 앱 복귀(return-refresh)는 '바뀐 게 없어도' 매번 전체 폴더를 훑던 경로다.
  //   앱을 자주 들락거리면 그때마다 readdir+사진 개수 스캔이 돌아 디스크 I/O가 컸다.
  //   실제 변경은 저장 직후(after-save)와 앱 나갈 때(hidden/background)에 이미 백업되므로,
  //   '복귀 시 재확인'만 10분 간격으로 늦춘다. 나머지 사유는 기존 4초 그대로 유지.
  var RETURN_REFRESH_MIN_MS = 10 * 60 * 1000;   // 10분
  function minIntervalFor(reason) {
    return (reason === 'return-refresh') ? RETURN_REFRESH_MIN_MS : MIN_INTERVAL_MS;
  }

  var _running = false;
  var _incomplete = false;     // 이전 실행이 끝까지 못 갔는지
  var _lastRunAt = 0;

  function isNative() {
    try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); }
    catch (e) { return false; }
  }
  function FS() {
    var p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
    if (!p) throw new Error('Capacitor Filesystem 플러그인이 없습니다');
    return p;
  }
  async function appFolder() {
    if (window.NativeFS && NativeFS.resolveAppFolder) {
      try { return await NativeFS.resolveAppFolder(); } catch (e) {}
    }
    return 'work-report';
  }

  // ★ 옵트인: 사용자가 설정/팝업에서 명시적으로 켰을 때('1')만 동작 (저장공간 2배 필요하므로)
  // ★ 2026-08-09 기본값 전환: 미설정이면 '켜짐'
  //   EXTERNAL(주 저장소)은 앱 삭제 시 안드로이드가 통째로 지운다.
  //   자동백업이 꺼져 있으면 앱을 지우는 순간 사진이 전부 사라지므로, 옵트아웃 방식으로 바꿨다.
  function enabled() {
    try {
      var v = localStorage.getItem(ENABLED_LS);
      if (v === '0') return false;   // 사용자가 명시적으로 끔
      return true;                    // '1' 또는 미설정
    } catch (e) { return true; }
  }
  AutoBackup.isEnabled = enabled;
  AutoBackup.setEnabled = function (on) { try { localStorage.setItem(ENABLED_LS, on ? '1' : '0'); } catch (e) {} };
  AutoBackup.lastAt = function () { try { return localStorage.getItem(LAST_LS) || ''; } catch (e) { return ''; } };

  function getSaf() { try { return localStorage.getItem(SAF_URI_LS) || ''; } catch (e) { return ''; } }
  function setSaf(v) { try { if (v) localStorage.setItem(SAF_URI_LS, v); else localStorage.removeItem(SAF_URI_LS); } catch (e) {} }
  AutoBackup.folderUri = getSaf;
  AutoBackup.hasFolder = function () { return !!getSaf(); };
  function BF() {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.BackupFolder) || null;
  }

  // 사용자가 백업 폴더를 한 번 지정 (읽기+쓰기 영구 권한). 재설치 후 재지정하면 옛 파일까지 자유롭게 갱신/삭제됨.
  AutoBackup.pickFolder = async function () {
    var bf = BF();
    if (!bf || !bf.pickBackupFolder) {
      if (typeof showToast === 'function') showToast('이 기기에서는 폴더 지정을 지원하지 않습니다', 'err');
      return false;
    }
    try {
      var r = await bf.pickBackupFolder();
      if (!r || r.cancelled || !r.uri) return false;
      setSaf(r.uri);
      if (typeof showToast === 'function') showToast('백업 폴더가 지정되었습니다', 'ok');
      AutoBackup.run('manual');
      return true;
    } catch (e) {
      if (typeof showToast === 'function') showToast('폴더 지정 실패: ' + (e && (e.message || e.errorMessage || e)), 'err');
      return false;
    }
  };

  async function statSafe(fs, dir, path) {
    try { return await fs.stat({ path: path, directory: dir }); } catch (e) { return null; }
  }

  // ★ 사진 유실 방지용 스냅샷: 마지막으로 정상 백업했을 때의 날짜폴더별 실제 사진 수
  var SNAP_LS = 'auto_backup_photo_snap';
  function _loadSnap() { try { return JSON.parse(localStorage.getItem(SNAP_LS) || '{}') || {}; } catch (e) { return {}; } }
  function _saveSnap(o) { try { localStorage.setItem(SNAP_LS, JSON.stringify(o || {})); } catch (e) {} }
  /* ★ 2026-08-08 자동백업이 조용히 멈춰 있던 문제
       구조: 사진이 줄어 보이면(_detectDrops) 자동 실행은 백업을 통째로 건너뛰고 스냅샷도 갱신하지 않는다.
             그래서 스냅샷에는 예전의 '많은 개수'가 계속 남아, 다음 실행에서도 같은 급감이 또 감지된다.
             = 한 번 걸리면 자동백업이 영구히 멈춘다. 게다가 안내 토스트도 제거된 상태(2026-08-05)라
               사용자는 멈춘 줄도 모른 채 며칠치 작업이 백업되지 않았다.
       해결: ① 같은 급감이 HOLD_ACCEPT_MS(12시간) 넘게 계속 관측되면 '실제 삭제'로 보고 스냅샷을 갱신해 통과시킨다.
                (일시적 스캔 오류는 12시간 내내 똑같이 재현되지 않는다 — 원래 막으려던 사고는 그대로 방지)
             ② 보류 중에도 '추가/갱신 복사'는 계속한다. 위험한 건 삭제(prune)뿐이므로 새 작업은 백업되게 한다. */
  var HOLD_ACCEPT_MS = 12 * 60 * 60 * 1000;
  function _dropSig(drops) {
    return (drops || []).map(function (d) { return d.folder + ':' + d.was + '>' + d.now; }).sort().join('|');
  }
  AutoBackup.pendingDrop = function () { try { return JSON.parse(localStorage.getItem('auto_backup_pending_drop') || 'null'); } catch (e) { return null; } };
  AutoBackup.clearPendingDrop = function () { try { localStorage.removeItem('auto_backup_pending_drop'); } catch (e) {} };
  // 지금 자동백업이 보류 상태인지 + 사람이 읽을 설명 (설정 화면 표시용)
  AutoBackup.holdStatus = function () {
    var p = AutoBackup.pendingDrop();
    if (!p) return null;
    var lost = (p.drops || []).reduce(function (a, d) { return a + (d.lost || 0); }, 0);
    var hours = Math.floor((Date.now() - (p.at || 0)) / 3600000);
    return {
      at: p.at, lost: lost, folders: (p.drops || []).length, hours: hours,
      text: '사진이 ' + lost + '장 줄어든 것으로 보여 백업의 삭제 반영을 보류 중입니다 (' + hours + '시간째). ' +
            '새 작업 백업은 계속됩니다. 12시간 넘게 같은 상태면 실제 삭제로 보고 자동으로 재개합니다.'
    };
  };

  // 원본(EXTERNAL)에서 날짜폴더별 실제 사진(_imageNN.jpg, 썸네일 제외) 개수 집계
  async function _scanSourcePhotoCounts(fs, appF) {
    var counts = {};
    async function _cnt(rel) {
      var base = appF + (rel ? '/' + rel : '');
      var items;
      try { var r = await fs.readdir({ path: base, directory: 'EXTERNAL' }); items = (r && r.files) || []; }
      catch (e) { return; }
      for (var i = 0; i < items.length; i++) {
        var f = items[i];
        var name = (typeof f === 'string') ? f : f.name;
        if (name === '_thumbs' || name === '_cloudPhotos') continue;
        var ty = (typeof f === 'object' && (f.type || f.kind)) || null;
        if (ty == null) { var st = await statSafe(fs, 'EXTERNAL', base + '/' + name); ty = st && st.type; }
        var childRel = rel ? rel + '/' + name : name;
        if (ty === 'directory') { await _cnt(childRel); }
        else if (/_image\d{2}\.jpg$/i.test(name)) {
          var top = childRel.split('/')[0];
          counts[top] = (counts[top] || 0) + 1;
        }
      }
    }
    await _cnt('');
    return counts;
  }

  // 스냅샷 대비 사진이 줄어든 날짜폴더 목록
  function _detectDrops(snap, cur) {
    var drops = [];
    Object.keys(snap || {}).forEach(function (k) {
      var was = snap[k] || 0, now = (cur && cur[k]) || 0;
      if (now < was) drops.push({ folder: k, was: was, now: now, lost: was - now });
    });
    return drops;
  }
  async function ensureDir(fs, path) {
    try { await fs.mkdir({ path: path, directory: 'DOCUMENTS', recursive: true }); } catch (e) {}
  }

  // 필요할 때만 복사 (대상 없음 / 크기 다름 / 원본이 더 최신)
  async function copyIfNeeded(fs, appF, rel) {
    var src = appF + '/' + rel;
    var dest = DEST_BASE + '/' + rel;
    var s = await statSafe(fs, 'EXTERNAL', src);
    if (!s) return 0;
    var d = await statSafe(fs, 'DOCUMENTS', dest);
    var need = !d || (d.size !== s.size) || ((s.mtime || 0) > (d.mtime || 0));
    if (!need) return 0;
    // 1차: 네이티브 copy
    try { await fs.copy({ from: src, to: dest, directory: 'EXTERNAL', toDirectory: 'DOCUMENTS' }); return 1; }
    catch (e1) {}
    // 2차: 기존 파일 삭제 후 재복사 (덮어쓰기 거부 대비)
    try { await fs.deleteFile({ path: dest, directory: 'DOCUMENTS' }); } catch (e) { console.warn('[자동백업] 백업본 삭제 실패:', dest, e && (e.message || e)); }
    try { await fs.copy({ from: src, to: dest, directory: 'EXTERNAL', toDirectory: 'DOCUMENTS' }); return 1; }
    catch (e2) {}
    // 3차: readFile → writeFile 폴백
    try {
      var rd = await fs.readFile({ path: src, directory: 'EXTERNAL' });
      var data = (rd && rd.data != null) ? rd.data : rd;
      await fs.writeFile({ path: dest, data: data, directory: 'DOCUMENTS', recursive: true });
      return 1;
    } catch (e3) { console.warn('[자동백업] 복사 실패:', rel, e3 && e3.message); return 0; }
  }

  // 디렉토리 목록 → [{name, type}]
  async function listDir(fs, dir, path) {
    var r;
    try { r = await fs.readdir({ path: path, directory: dir }); } catch (e) { return []; }
    var files = (r && r.files) || [];
    return files.map(function (f) {
      var name = (typeof f === 'string') ? f : f.name;
      var ty = (typeof f === 'object' && (f.type || f.kind)) || null;
      return { name: name, type: ty };
    });
  }

  // 원본(EXTERNAL)에 없는 백업 파일/폴더를 제거 → 백업을 현재 상태와 정확히 일치시킴
  async function pruneWalk(fs, appF, rel, budget) {
    var destPath = DEST_BASE + (rel ? '/' + rel : '');
    var items = await listDir(fs, 'DOCUMENTS', destPath);
    for (var i = 0; i < items.length; i++) {
      var name = items[i].name;
      var childRel = rel ? rel + '/' + name : name;
      var ty = items[i].type;
      if (ty == null) { var dst = await statSafe(fs, 'DOCUMENTS', destPath + '/' + name); ty = dst && dst.type; }
      var srcSt = await statSafe(fs, 'EXTERNAL', appF + '/' + childRel);
      if (!srcSt) {
        // 일시적 네이티브 실패로 '없음' 오판 방지 → 삭제 전 재확인
        for (var _rt = 0; _rt < 2 && !srcSt; _rt++) {
          await new Promise(function (rz) { setTimeout(rz, 140); });
          srcSt = await statSafe(fs, 'EXTERNAL', appF + '/' + childRel);
        }
      }
      if (!srcSt) {
        // 원본에 없음 → 백업에서 제거 (삭제된 작업 · 순서편집 잔재)
        if (ty === 'directory') {
          try { await fs.rmdir({ path: DEST_BASE + '/' + childRel, directory: 'DOCUMENTS', recursive: true }); budget.pruned++; }
          catch (e) { console.warn('[자동백업] 폴더 정리 실패:', childRel, e && e.message); }
        } else {
          try { await fs.deleteFile({ path: DEST_BASE + '/' + childRel, directory: 'DOCUMENTS' }); budget.pruned++; }
          catch (e) { console.warn('[자동백업] 파일 정리 실패:', childRel, e && e.message); }
        }
      } else if (ty === 'directory') {
        await pruneWalk(fs, appF, childRel, budget);
      }
    }
  }

  async function walk(fs, appF, rel, budget) {
    var base = appF + (rel ? '/' + rel : '');
    var r;
    try { r = await fs.readdir({ path: base, directory: 'EXTERNAL' }); } catch (e) { return; }
    var files = (r && r.files) || [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var name = (typeof f === 'string') ? f : f.name;
      var ty = (typeof f === 'object' && (f.type || f.kind)) || null;
      var childRel = rel ? rel + '/' + name : name;
      if (ty == null) { var st = await statSafe(fs, 'EXTERNAL', base + '/' + name); ty = st && st.type; }
      if (ty === 'directory') {
        await ensureDir(fs, DEST_BASE + '/' + childRel);
        await walk(fs, appF, childRel, budget);
      } else {
        budget.copied += await copyIfNeeded(fs, appF, childRel);
        budget.seen++;
        if (budget.seen % 6 === 0) await new Promise(function (r2) { setTimeout(r2, 0); });
      }
    }
  }

  // 증분 백업 실행. reason은 로그용.
  AutoBackup.run = async function (reason) {
    if (!isNative() || !enabled()) return { skipped: true };
    if (_running) return { skipped: true, busy: true };
    var now = Date.now();
    if (reason !== 'manual' && (now - _lastRunAt) < minIntervalFor(reason)) return { skipped: true, throttled: true };
    _running = true;
    _lastRunAt = now;
    _incomplete = true;  // 성공적으로 끝나면 false 로 내림
    try {
      var appF = await appFolder();

      // ★★★ 데이터 손실 방지 가드 (최우선) ★★★
      //   거울 백업은 '원본에 없는 파일을 백업에서 삭제'한다. 그래서 재설치 직후처럼
      //   원본(EXTERNAL/work-report)이 비어있는 상태에서 실행되면, 백업(거울)을 '빈 원본'에
      //   맞춰 통째로 지워버리는 참사가 난다. → 원본에 실제 작업이 하나도 없으면 백업/정리를
      //   절대 하지 않고 즉시 중단한다. (원본이 정상일 때만 거울 동기화 허용)
      try {
        var _fsGuard = FS();
        var _rootR = await _fsGuard.readdir({ path: appF, directory: 'EXTERNAL' });
        var _rootFiles = (_rootR && _rootR.files) || [];
        var _srcWorks = _rootFiles.filter(function (f) {
          var n = (typeof f === 'string') ? f : (f && f.name) || '';
          return /^\d{4}-\d{2}-\d{2}/.test(n);   // 작업 폴더(YYYY-MM-DD…)
        }).length;
        if (!_rootFiles.length || _srcWorks === 0) {
          console.warn('[자동백업] 원본에 작업이 없음(재설치 직후 등) → 백업/정리 중단하여 백업 보호');
          if (reason === 'manual' && typeof showToast === 'function') {
            showToast('원본에 작업이 없어 백업을 건너뛰었어요 (기존 백업은 그대로 보호됨)', 'ok');
          }
          _incomplete = false;
          return { skipped: true, reason: 'empty-source-guard' };
        }
      } catch (e) {
        // 원본을 읽지 못하면(권한·경로 문제) 위험하므로 안전하게 중단 — 백업을 지우지 않는다
        console.warn('[자동백업] 원본 확인 실패 → 안전하게 백업/정리 중단:', e && (e.message || e));
        _incomplete = false;
        return { skipped: true, reason: 'source-unreadable-guard' };
      }

      // ★★★ 사진 급감 가드 ★★★ — 거울 백업이 '삭제로 오인'해 실제 사진을 지우는 것 방지.
      //   마지막 정상 백업 시점보다 사진이 줄어 보이면(로딩/일시 오류 포함) 삭제성 백업을 막는다.
      var _curCounts = null;
      var _holdPrune = false;   // 사진 급감 보류 중이면 '삭제 반영'만 건너뛴다
      try {
        var _fsScan = FS();
        _curCounts = await _scanSourcePhotoCounts(_fsScan, appF);
        var _drops = _detectDrops(_loadSnap(), _curCounts);
        if (_drops.length) {
          var _lost = _drops.reduce(function (a, d) { return a + d.lost; }, 0);
          var _detail = _drops.slice(0, 6).map(function (d) { return '· ' + d.folder + ': ' + d.was + '→' + d.now + '장'; }).join('\n');
          if (reason === 'manual') {
            var _ok = (typeof confirm === 'function') && confirm(
              '⚠️ 원본에서 사진이 줄어든 것으로 보입니다 (총 ' + _lost + '장 감소).\n\n' +
              _detail + (_drops.length > 6 ? ('\n... 외 ' + (_drops.length - 6) + '개 폴더') : '') +
              '\n\n로딩 오류나 일시적 문제로 안 읽혔을 수도 있습니다.\n\n' +
              '[확인] 정말 삭제된 게 맞음 → 백업에도 삭제 반영\n' +
              '[취소] 아직 확실치 않음 → 이번 백업 건너뛰고 기존 백업 보존 (권장)'
            );
            if (!_ok) {
              console.warn('[자동백업] 사진 급감 → 사용자가 보존 선택, 백업 건너뜀');
              _incomplete = false;
              return { skipped: true, reason: 'photo-drop-declined', drops: _drops };
            }
            console.warn('[자동백업] 사진 급감 사용자 승인 → 백업 진행');
          } else {
            // 백그라운드 자동 실행: confirm을 띄울 수 없으므로 삭제(prune)는 하지 않는다.
            var _sig = _dropSig(_drops);
            var _prev = AutoBackup.pendingDrop();
            if (_prev && _prev.sig === _sig && (Date.now() - (_prev.at || 0)) > HOLD_ACCEPT_MS) {
              // 같은 급감이 12시간 넘게 그대로 → 실제 삭제로 보고 받아들인다(영구 정지 방지)
              console.warn('[자동백업] 사진 급감이 12시간 이상 지속 → 실제 삭제로 인정하고 백업 재개');
              try { if (_curCounts) _saveSnap(_curCounts); } catch (e) {}
              AutoBackup.clearPendingDrop();
              // 아래로 계속 진행(정상 백업)
            } else {
              if (!_prev || _prev.sig !== _sig) {
                try { localStorage.setItem('auto_backup_pending_drop', JSON.stringify({ at: Date.now(), sig: _sig, drops: _drops })); } catch (e) {}
              }
              console.warn('[자동백업] 사진 급감 감지(자동) → 삭제 반영만 보류하고, 추가/갱신 복사는 계속');
              _holdPrune = true;   // ★ 통째로 멈추지 않고 '삭제만' 건너뛴다
            }
          }
        }
      } catch (e) {
        console.warn('[자동백업] 급감 가드 스캔 실패(무시하고 진행):', e && (e.message || e));
      }

      // ★ 설정·지침·학습기록 스냅샷을 앱 폴더에 먼저 남긴다 (2026-08-09)
      //   localStorage 값들은 파일이 아니라 백업에서 통째로 빠져 있었다.
      //   여기서 _appdata.json 으로 떨궈두면 아래 거울 백업이 자동으로 함께 복사한다.
      try { if (window.AppData && AppData.write) await AppData.write(); } catch (e) {}

      // ── 우선: 사용자가 지정한 SAF 폴더로 네이티브 거울 백업 (재설치 후에도 쓰기/삭제 자유) ──
      var saf = getSaf();
      var bf = BF();
      // ★ 네이티브 backupTree는 복사+삭제를 함께 하므로, 급감 보류 중에는 쓰지 않고
      //   아래 Filesystem 폴백으로 '복사만' 수행한다(새 작업은 백업되고, 백업 사진은 안 지워짐).
      if (saf && bf && bf.backupTree && !_holdPrune) {
        try {
          var r = await bf.backupTree({ uri: saf, appFolder: appF });
          _incomplete = false;
          try { if (_curCounts) _saveSnap(_curCounts); AutoBackup.clearPendingDrop(); } catch (e) {}
          try { localStorage.setItem(LAST_LS, new Date().toISOString()); } catch (e) {}
          console.log('[자동백업/SAF](' + (reason || '') + ') 완료 - 갱신 ' + (r && r.copied) + ' / 정리 ' + (r && r.pruned) + ' / 실패 ' + (r && r.fail));
          return { ok: true, saf: true, copied: (r && r.copied) || 0, pruned: (r && r.pruned) || 0, fail: (r && r.fail) || 0 };
        } catch (e) {
          var msg = (e && (e.message || e.errorMessage)) || String(e);
          console.warn('[자동백업/SAF] 실패:', msg);
          // 권한 상실(재설치 등)로 보이면 폴더 지정 해제 → 사용자에게 재지정 유도
          if (/permission|security|uri|denied|권한/i.test(msg)) {
            setSaf('');
            if (typeof showToast === 'function') showToast('백업 폴더 권한이 만료됐어요. 설정에서 폴더를 다시 지정해주세요', 'err');
          }
          return { error: msg };
        }
      }

      // ── 폴백: SAF 미지정 시 고정 Documents 폴더로 Filesystem 증분 백업 ──
      var fs = FS();
      await ensureDir(fs, DEST_BASE);
      var budget = { copied: 0, seen: 0, pruned: 0 };
      await walk(fs, appF, '', budget);            // 추가·갱신 (항상 수행 — 안전)
      if (_holdPrune) {
        console.warn('[자동백업] 급감 보류 중 → 삭제 반영(prune) 건너뜀. 추가/갱신만 반영됨');
      } else {
        await pruneWalk(fs, appF, '', budget);     // 삭제 반영 (거울 정리)
      }
      _incomplete = false;
      // 보류 중에는 스냅샷을 갱신하지 않는다(다음 판정에서 같은 급감을 계속 보게 해야 12시간 규칙이 동작)
      try { if (_curCounts && !_holdPrune) { _saveSnap(_curCounts); AutoBackup.clearPendingDrop(); } } catch (e) {}
      try { localStorage.setItem(LAST_LS, new Date().toISOString()); } catch (e) {}
      console.log('[자동백업](' + (reason || '') + ') 완료 - 갱신 ' + budget.copied + ' / 확인 ' + budget.seen + ' / 정리 ' + budget.pruned);
      return { ok: true, copied: budget.copied, seen: budget.seen, pruned: budget.pruned };
    } catch (e) {
      console.warn('[자동백업] 오류:', e && e.message);
      return { error: e && e.message };
    } finally {
      _running = false;
    }
  };

  // 특정 작업 폴더를 백업에서 즉시 제거 (작업 삭제 시 호출)
  AutoBackup.removeFromBackup = async function (relPath) {
    if (!isNative() || !relPath) return;
    // 1) 사용자가 지정한 백업 폴더(SAF)에서도 즉시 제거 (복원 시 삭제 작업 부활 방지)
    try {
      var saf = getSaf();
      var bf = BF();
      if (saf && bf && bf.deletePath) {
        try {
          var r = await bf.deletePath({ uri: saf, path: relPath });
          console.log('[자동백업/SAF] 삭제 반영:', relPath, r && (r.deleted ? 'OK' : (r.notFound ? '이미 없음' : '실패')));
        } catch (e) { console.warn('[자동백업/SAF] 삭제 반영 실패:', relPath, e && (e.message || e.errorMessage)); }
      }
    } catch (e) {}
    // 2) 기본 Documents 백업에서 제거
    try {
      var fs = FS();
      var p = DEST_BASE + '/' + relPath;
      var st = await statSafe(fs, 'DOCUMENTS', p);
      if (!st) return;
      if (st.type === 'directory') { try { await fs.rmdir({ path: p, directory: 'DOCUMENTS', recursive: true }); } catch (e) { console.warn('[자동백업] 폴더 정리 실패:', p, e && (e.message || e)); } }
      else { try { await fs.deleteFile({ path: p, directory: 'DOCUMENTS' }); } catch (e) { console.warn('[자동백업] 파일 정리 실패:', p, e && (e.message || e)); } }
      console.log('[자동백업] 삭제 반영:', relPath);
    } catch (e) { console.warn('[자동백업] 삭제 반영 실패:', relPath, e && e.message); }
  };

  // 설정 화면: 상태 카드 + 버튼
  function refreshStatus() {
    var tg = document.getElementById('btnAutoBackupToggle');
    if (tg) tg.textContent = enabled() ? '⏸️ 자동백업 끄기' : '▶️ 자동백업 켜기';
    var fb = document.getElementById('btnAutoBackupFolder');
    if (fb) fb.textContent = getSaf() ? '📁 백업 폴더 바꾸기' : '📁 백업 폴더 지정';
    var el = document.getElementById('autoBackupStatus');
    if (!el) return;

    var last = AutoBackup.lastAt();
    var when = '';
    if (last) { try { when = new Date(last).toLocaleString('ko-KR'); } catch (e) {} }

    if (!enabled()) {
      el.innerHTML = '<b style="color:#e0574a;">⚠️ 자동백업 꺼짐</b><br>' +
        '<span style="color:var(--mu);">앱을 삭제하면 사진이 모두 사라집니다.</span>';
      return;
    }
    if (!getSaf()) {
      el.innerHTML = '<b style="color:#e0574a;">⚠️ 백업 폴더를 정해주세요</b><br>' +
        '<span style="color:var(--mu);">지금은 앱을 삭제하면 백업까지 함께 지워집니다. ' +
        '폴더를 직접 골라야 사진이 남아요.</span>';
      return;
    }
    el.innerHTML = '<b style="color:#1b8a5f;">✓ 자동으로 백업되고 있어요</b><br>' +
      '<span style="color:var(--mu);">앱을 삭제해도 사진이 남습니다' +
      (when ? ' · 마지막 ' + when : '') + '</span>';
  }
  AutoBackup.refreshStatus = refreshStatus;

  function wire() {
    var btn = document.getElementById('btnAutoBackupFolder');
    if (btn && !btn._abWired) {
      btn._abWired = true;
      btn.addEventListener('click', async function () {
        await AutoBackup.pickFolder();
        refreshStatus();
      });
    }
    var tg = document.getElementById('btnAutoBackupToggle');
    if (tg && !tg._abWired) {
      tg._abWired = true;
      tg.addEventListener('click', function () {
        var on = !enabled();
        AutoBackup.setEnabled(on);
        refreshStatus();
        if (on) {
          if (typeof showToast === 'function') showToast('자동백업을 켰습니다', 'ok');
          if (!getSaf()) { AutoBackup.pickFolder().then(refreshStatus); }
          else AutoBackup.run('manual');
        } else {
          if (typeof showToast === 'function') showToast('자동백업을 껐습니다 (이미 백업된 파일은 그대로 둡니다)', 'ok');
        }
      });
    }
    refreshStatus();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();

  // ── 백업 폴더 지정 유도 (2026-08-09 전면 개편) ──
  //   기존엔 "자동백업을 쓸까요?"를 한 번 묻고 끝이었다.
  //   그런데 EXTERNAL 주 저장소는 앱 삭제 시 사라지고, 기본 Documents 백업도 함께 사라진다.
  //   앱 삭제에도 남는 건 사용자가 고른 SAF 폴더뿐이므로, 폴더를 지정할 때까지 안내한다.
  var ASK_LS = 'auto_backup_folder_ask_at';   // 마지막 안내 시각 (너무 자주 안 뜨게)
  var ASK_GAP_MS = 3 * 24 * 60 * 60 * 1000;   // 3일

  function askedRecently() {
    try {
      var t = parseInt(localStorage.getItem(ASK_LS) || '0', 10);
      return t > 0 && (Date.now() - t) < ASK_GAP_MS;
    } catch (e) { return false; }
  }
  function markAsked() { try { localStorage.setItem(ASK_LS, String(Date.now())); } catch (e) {} }

  function maybeAskOptIn() {
    if (!isNative()) return;
    if (getSaf()) return;                 // 이미 폴더 지정됨 → 안내 불필요
    if (!enabled()) return;               // 사용자가 자동백업을 명시적으로 껐으면 존중
    try { if (localStorage.getItem('ac_onboarding_done_v2') !== '1') return; } catch (e) {}
    if (askedRecently()) return;
    if (document.getElementById('abOptInOv')) return;

    markAsked();
    var ov = document.createElement('div');
    ov.id = 'abOptInOv';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:3150;display:flex;align-items:center;justify-content:center;padding:20px;';
    ov.innerHTML = '<div style="background:var(--sf);border-radius:14px;padding:22px;max-width:380px;width:100%;">' +
      '<div style="font-size:34px;text-align:center;">🛟</div>' +
      '<div style="font-size:17px;font-weight:800;margin:8px 0 10px;text-align:center;">사진 백업 폴더를 지정해주세요</div>' +
      '<div style="font-size:13px;color:var(--mu);line-height:1.75;margin-bottom:8px;">' +
        '<b style="color:#e0574a;">앱을 삭제하면 앱 안의 사진은 안드로이드가 모두 지웁니다.</b> ' +
        '기기를 바꾸거나 앱을 다시 설치할 때 사진이 사라질 수 있어요.' +
      '</div>' +
      '<div style="font-size:13px;color:var(--mu);line-height:1.75;margin-bottom:14px;">' +
        '백업 폴더를 직접 골라두면 앱을 지워도 사진이 그 폴더에 남습니다. ' +
        '<b style="color:var(--tx);">사진을 한 번 더 저장하므로 저장공간은 최대 2배가 필요해요.</b>' +
      '</div>' +
      '<button class="btn b-blue" id="abPick" style="width:100%;justify-content:center;margin-bottom:8px;">📁 백업 폴더 고르기</button>' +
      '<div style="display:flex;gap:8px;">' +
        '<button class="btn b-ghost b-xs" id="abLater" style="flex:1;justify-content:center;">나중에</button>' +
        '<button class="btn b-ghost b-xs" id="abNever" style="flex:1;justify-content:center;">백업 안 함</button>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--mu);margin-top:10px;text-align:center;">설정 → 데이터 백업/복원에서 언제든 바꿀 수 있어요</div>' +
      '</div>';
    document.body.appendChild(ov);

    ov.querySelector('#abLater').onclick = function () { ov.remove(); };
    ov.querySelector('#abNever').onclick = function () {
      if (!confirm('백업을 사용하지 않으면 앱을 삭제하거나 기기를 바꿀 때 사진을 되살릴 수 없습니다.\n\n그래도 끌까요?')) return;
      AutoBackup.setEnabled(false); ov.remove(); refreshStatus();
    };
    ov.querySelector('#abPick').onclick = async function () {
      ov.remove();
      AutoBackup.setEnabled(true);
      try { await AutoBackup.pickFolder(); } catch (e) {}
      refreshStatus();
      if (getSaf()) {
        if (typeof showToast === 'function') showToast('✓ 백업 폴더가 지정됐어요. 첫 백업을 시작합니다', 'ok');
        AutoBackup.run('manual');
      }
    };
  }
  setTimeout(maybeAskOptIn, 5000);

  function onLeave(reason) { try { AutoBackup.run(reason); } catch (e) {} }
  function onReturn() { try { AutoBackup.run(_incomplete ? 'resume-catchup' : 'return-refresh'); } catch (e) {} }

  // 앱을 벗어날 때(백그라운드) 백업, 못 끝냈으면 돌아올 때 보완
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') onLeave('hidden');
    else if (document.visibilityState === 'visible') onReturn();
  });
  window.addEventListener('pagehide', function () { onLeave('pagehide'); });
  try {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      window.Capacitor.Plugins.App.addListener('appStateChange', function (state) {
        if (state && state.isActive === false) onLeave('background');
        else if (state && state.isActive === true) onReturn();
      });
    }
  } catch (e) {}

  // 저장/수정/삭제 후에도 (앱을 나가지 않아도) 최근 작업을 백업 폴더에 반영한다.
  //  · 앱-백그라운드 순간에만 의존하면 큰 사진 복사가 중단돼 최근 며칠이 백업에서 누락될 수 있음.
  //  · 저장 직후 포그라운드에서 한 번 더 증분 백업을 예약해 누락을 방지.
  var _saveDebT = null;
  function scheduleAfterSave() {
    clearTimeout(_saveDebT);
    _saveDebT = setTimeout(function () { try { AutoBackup.run('after-save'); } catch (e) {} }, 8000);
  }
  AutoBackup.scheduleAfterSave = scheduleAfterSave;
  (function hookInvalidateForBackup() {
    var orig = window.invalidateRecordsCache;
    window.invalidateRecordsCache = function () {
      if (typeof orig === 'function') { try { orig.apply(this, arguments); } catch (e) {} }
      scheduleAfterSave();
    };
  })();

})();
