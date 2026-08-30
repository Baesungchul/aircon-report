/* ═══════════════════════════════════════════════════════════
   appdata_backup.js — 설정·지침·학습기록 백업/복원  (2026-08-09)
   ----------------------------------------------------------------
   왜 필요한가:
     기존 백업(자동백업·ZIP·폴더복원)은 앱 폴더의 '파일'만 복사했다.
     그런데 업체정보·AI 글쓰기 지침·일정등록 학습·작업자 이름·알림설정 등은
     파일이 아니라 localStorage 에 있어서 백업 대상에서 통째로 빠져 있었다.
     → 앱을 지우면 사진은 백업으로 살려도 "그동안 길들인 설정"은 전부 날아갔다.
   해결:
     앱 폴더 루트에 _appdata.json 스냅샷을 남긴다.
     이 파일 하나면 자동백업(SAF 거울) · ZIP 내보내기 · 폴더 복원에 전부 자동으로 포함된다.
   복원 정책:
     기본은 '비어있는 것만 채우기'(비파괴). 사용자가 원하면 덮어쓰기 선택 가능.
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  window.AppData = window.AppData || {};

  var FILE = '_appdata.json';
  var DONE_LS = 'ac_appdata_restored_at';

  // 백업에서 제외 — 캐시/파생값, 기기 고유값, 비밀
  var SKIP_RE = [
    /^calCache_/,            // 달력 월별 캐시 (파생)
    /^cloudSyncHash_/, /^cloudSyncedIds_/, /^cloudFullHash_/,  // 동기화 해시 (파생)
    /^ac_fs_index_/,         // 폴더 인덱스 (파생)
    /^auto_backup_/,         // 백업 폴더 URI·스냅샷 — 기기마다 다름
    /^cloud_?photo/i
  ];
  var SKIP_KEYS = {
    'lastFolderName': 1, 'folderLostAt': 1,
    'saveFolderFailedAt': 1, 'saveFolderFailedName': 1,
    'claude_api_key': 1,          // 비밀키는 평문 파일로 내보내지 않음
    'ac_workid_migration_v1': 1,
    'verGateSeen': 1,
    'ac_appdata_restored_at': 1
  };
  // 복원하지 않을 키 (백업엔 있지만 되돌리면 곤란한 것)
  var NO_RESTORE = { 'ac_onboarding_done_v2': 1 };

  // 사람이 알아볼 이름 (복원 화면에 표시)
  var LABEL = {
    'ac_co_v2': '업체정보',
    'ac_co_icon_v1': '업체 로고',
    'claude_blog_guideline': 'AI 글쓰기 지침',
    'ai_schedule_corrections': '일정등록 학습기록',
    'ai_quote_corrections': '견적서 학습기록',
    'ac_bizcert_corrections': '사업자등록증 학습기록',
    'ac_worker_names': '작업자 이름 목록',
    'ac_my_industries': '내 업종',
    'ac_reminders_v1': '리마인더',
    'ac_theme_v1': '앱 테마', 'ac_mode_v1': '화면 모드',
    'ac_report_theme_v1': '보고서 테마', 'ac_report_res_v1': '보고서 해상도',
    'ac_cam_res_v1': '카메라 해상도', 'ac_font_scale_v1': '글자 크기',
    'notifyEnabled': '알림 사용', 'notifyLeadMin': '알림 시간',
    'claude_model': 'AI 모델', 'claude_blog_model': '글쓰기 AI 모델',
    'ac_naver_import_uids_v1': '캘린더 가져오기 기록',
    'ac_customer_filter_v1': '고객 목록 필터'
  };
  AppData.label = function (k) { return LABEL[k] || k; };

  function skip(k) {
    if (SKIP_KEYS[k]) return true;
    for (var i = 0; i < SKIP_RE.length; i++) if (SKIP_RE[i].test(k)) return true;
    return false;
  }

  /* ── 수집 ───────────────────────────── */
  AppData.collect = function () {
    var data = {}, n = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || skip(k)) continue;
        var v = localStorage.getItem(k);
        if (v == null) continue;
        if (v.length > 512 * 1024) continue;   // 비정상적으로 큰 값은 제외
        data[k] = v; n++;
      }
    } catch (e) {}
    return { version: 1, savedAt: new Date().toISOString(), count: n, data: data };
  };

  /* ── 저장 (앱 폴더 루트) ───────────────── */
  AppData.write = async function () {
    try {
      if (typeof photoFolderHandle === 'undefined' || !photoFolderHandle) return false;
      var snap = AppData.collect();
      if (!snap.count) return false;
      var fh = await photoFolderHandle.getFileHandle(FILE, { create: true });
      var w = await fh.createWritable();
      await w.write(new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' }));
      await w.close();
      return true;
    } catch (e) { console.warn('[설정백업] 저장 실패:', e && e.message); return false; }
  };

  /* ── 읽기 ───────────────────────────── */
  AppData.read = async function (dirHandle) {
    var dir = dirHandle || (typeof photoFolderHandle !== 'undefined' ? photoFolderHandle : null);
    if (!dir) return null;
    try {
      var fh = await dir.getFileHandle(FILE);
      var j = JSON.parse(await (await fh.getFile()).text());
      return (j && j.data) ? j : null;
    } catch (e) { return null; }
  };

  /* ── 적용 ───────────────────────────── */
  //  mode: 'missing' = 지금 비어있는 항목만 채움(기본) / 'overwrite' = 전부 덮어씀
  AppData.apply = function (snap, mode) {
    if (!snap || !snap.data) return { applied: 0, skipped: 0 };
    var applied = 0, skipped = 0, names = [];
    Object.keys(snap.data).forEach(function (k) {
      if (NO_RESTORE[k] || skip(k)) { skipped++; return; }
      var cur = null;
      try { cur = localStorage.getItem(k); } catch (e) {}
      var isEmpty = (cur == null || cur === '' || cur === '[]' || cur === '{}');
      if (mode !== 'overwrite' && !isEmpty) { skipped++; return; }
      if (cur === snap.data[k]) { skipped++; return; }
      try { localStorage.setItem(k, snap.data[k]); applied++; names.push(AppData.label(k)); } catch (e) { skipped++; }
    });
    try { localStorage.setItem(DONE_LS, new Date().toISOString()); } catch (e) {}
    return { applied: applied, skipped: skipped, names: names };
  };

  /* ── 지금 비어있는 주요 항목 ───────────── */
  function missingImportant(snap) {
    var out = [];
    ['ac_co_v2', 'claude_blog_guideline', 'ai_schedule_corrections',
     'ai_quote_corrections', 'ac_bizcert_corrections', 'ac_worker_names',
     'ac_my_industries', 'ac_reminders_v1'].forEach(function (k) {
      if (!snap.data[k]) return;
      var cur = null; try { cur = localStorage.getItem(k); } catch (e) {}
      if (cur == null || cur === '' || cur === '[]' || cur === '{}') out.push(AppData.label(k));
    });
    return out;
  }

  /* ── 자동 적용 (팝업 없이, 비어있는 것만) ────────
     복원은 한 번으로 끝나야 한다. 사진·작업을 되돌린 뒤
     설정만 따로 버튼을 누르게 하면 대부분 그냥 지나친다.
     그래서 복원 직후 조용히 '비어있는 항목만' 채운다(비파괴). */
  AppData.autoApply = async function (dir) {
    var snap = await AppData.read(dir);
    if (!snap) return { applied: 0 };
    var r = AppData.apply(snap, 'missing');
    if (r.applied) {
      try { if (typeof updateCoHdrBtn === 'function') updateCoHdrBtn(); } catch (e) {}
      try { if (typeof applyCoIcon === 'function') applyCoIcon(); } catch (e) {}
      try { if (typeof applyCustomLabels === 'function') applyCustomLabels(); } catch (e) {}
      if (typeof showToast === 'function') showToast('⚙️ 설정 · 지침 · 학습기록 ' + r.applied + '건도 함께 되살렸어요', 'ok');
    }
    return r;
  };

  /* ── 복원 UI ───────────────────────────── */
  AppData.offerRestore = async function (opts) {
    opts = opts || {};
    var snap = await AppData.read(opts.dir);
    if (!snap) { if (opts.manual) alert('백업된 설정 파일(_appdata.json)을 찾지 못했습니다.'); return false; }
    var miss = missingImportant(snap);
    if (!miss.length && !opts.manual) return false;   // 자동 제안은 빠진 게 있을 때만

    var when = '';
    try { when = new Date(snap.savedAt).toLocaleString('ko-KR'); } catch (e) {}
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:3200;display:flex;align-items:center;justify-content:center;padding:20px;';
    ov.innerHTML = '<div style="background:var(--sf);border-radius:14px;padding:22px;max-width:400px;width:100%;">' +
      '<div style="font-size:32px;text-align:center;">⚙️</div>' +
      '<div style="font-size:17px;font-weight:800;margin:8px 0 10px;text-align:center;">설정을 되살릴까요?</div>' +
      '<div style="font-size:12px;color:var(--mu);text-align:center;margin-bottom:12px;">백업 시각 ' + (when || '알 수 없음') + ' · 항목 ' + snap.count + '개</div>' +
      (miss.length ?
        '<div style="background:var(--bg2,rgba(255,255,255,.05));border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:13px;line-height:1.8;">' +
          '<b>지금 비어 있는 항목</b><br><span style="color:var(--mu);">' + miss.join(' · ') + '</span></div>'
        : '<div style="font-size:13px;color:var(--mu);margin-bottom:12px;line-height:1.7;">주요 항목은 이미 채워져 있어요. 덮어쓰기를 선택하면 백업 시점 값으로 되돌립니다.</div>') +
      '<button class="btn b-blue" id="adFill" style="width:100%;justify-content:center;margin-bottom:8px;">비어있는 것만 채우기 (권장)</button>' +
      '<div style="display:flex;gap:8px;">' +
        '<button class="btn b-ghost b-xs" id="adOver" style="flex:1;justify-content:center;">전부 덮어쓰기</button>' +
        '<button class="btn b-ghost b-xs" id="adNo" style="flex:1;justify-content:center;">나중에</button>' +
      '</div></div>';
    document.body.appendChild(ov);

    return await new Promise(function (resolve) {
      function done(mode) {
        ov.remove();
        if (!mode) return resolve(false);
        var r = AppData.apply(snap, mode);
        if (typeof showToast === 'function') {
          showToast(r.applied ? ('✅ 설정 ' + r.applied + '개 복원됨') : '되살릴 항목이 없었어요', r.applied ? 'ok' : 'err');
        }
        if (r.applied) setTimeout(function () {
          if (confirm('설정을 되살렸습니다.\n\n앱을 새로고침해야 모두 반영됩니다. 지금 새로고침할까요?')) location.reload();
        }, 600);
        resolve(true);
      }
      ov.querySelector('#adFill').onclick = function () { done('missing'); };
      ov.querySelector('#adOver').onclick = function () {
        if (!confirm('지금 설정을 백업 시점 값으로 전부 되돌립니다.\n계속할까요?')) return;
        done('overwrite');
      };
      ov.querySelector('#adNo').onclick = function () { done(null); };
    });
  };

  // 앱 시작 시: 업체정보가 비어있는데 백업 파일이 있으면 1회 제안 (재설치 직후 상황)
  AppData.maybeAutoOffer = async function () {
    try {
      if (localStorage.getItem(DONE_LS)) return;         // 이미 복원했음
      var co = localStorage.getItem('ac_co_v2');
      if (co && co !== '{}' && co !== '') return;         // 설정이 살아있음 → 제안 불필요
      await AppData.offerRestore({});
    } catch (e) {}
  };
})();

// 앱 시작 후 재설치 복구 상황이면 설정 복원 제안
setTimeout(function () { try { if (window.AppData && AppData.maybeAutoOffer) AppData.maybeAutoOffer(); } catch (e) {} }, 8000);
