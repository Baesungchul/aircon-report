/* ═══════════════════════════════════════════════════════════
   photo_audit.js — 사진 개수 정합성 검사 / 재기록  (임시 도구)
   ----------------------------------------------------------------
   왜 필요한가:
     · 그동안 업데이트/재설치/폴더번호(workNN) 어긋남 등으로
       _session.json 에 적힌 사진 수와 실제 폴더의 사진 수가 달라진 작업이 있다.
     · 앱은 _session.json 을 믿고 화면을 그리므로, 실제로 없는 사진을
       "있다"고 표시하거나(빈칸/로딩실패), 있는 사진을 안 보여준다.
   무엇을 하는가:
     1) 검사  — 모든 작업 폴더를 훑어 '기록된 수' vs '실제 파일 수' 비교 (읽기만 함)
     2) 재기록 — 실제 파일 기준으로 _session.json 을 다시 씀
                · beforeCount / afterCount / specials[].photoCount
                · beforeMeta / afterMeta / specials[].photosMeta  (썸네일은 파일명 일치 시 보존)
                · workNum 을 실제 폴더 번호로 교정 (번호 어긋남 영구 해소)
                · 원본은 _session.bak.json 으로 보관
   파일 규칙 (folder.js 와 동일):
     [작업폴더]/workNN/A_imageNN.jpg = 작업 전 / B_imageNN.jpg = 작업 후
                      S1_imageNN.jpg = 특이사항 1번 ...
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  window.PhotoAudit = window.PhotoAudit || {};

  var _report = null;      // 마지막 검사 결과
  var _busy = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function toast(m, t) { if (typeof showToast === 'function') showToast(m, t || 'ok'); }

  /* ── 폴더 스캔 ───────────────────────────── */

  // work 폴더 하나의 실제 파일을 종류별로 집계
  async function scanWorkDir(handle) {
    var out = { A: [], B: [], S: {} };
    try {
      for await (var ent of handle.entries()) {
        var fname = ent[0], fh = ent[1];
        if (fh.kind !== 'file') continue;
        var mA = fname.match(/^A_image(\d+)\.jpe?g$/i);
        var mB = fname.match(/^B_image(\d+)\.jpe?g$/i);
        var mS = fname.match(/^S(\d+)_image(\d+)\.jpe?g$/i);
        if (mA) out.A.push({ idx: parseInt(mA[1], 10), name: fname });
        else if (mB) out.B.push({ idx: parseInt(mB[1], 10), name: fname });
        else if (mS) {
          var si = parseInt(mS[1], 10);
          (out.S[si] = out.S[si] || []).push({ idx: parseInt(mS[2], 10), name: fname });
        }
      }
    } catch (e) {}
    out.A.sort(function (a, b) { return a.idx - b.idx; });
    out.B.sort(function (a, b) { return a.idx - b.idx; });
    Object.keys(out.S).forEach(function (k) { out.S[k].sort(function (a, b) { return a.idx - b.idx; }); });
    return out;
  }

  // 작업 폴더 하나 검사
  async function auditWorkFolder(dirHandle) {
    var sess = null;
    try {
      var fh = await dirHandle.getFileHandle('_session.json');
      sess = JSON.parse(await (await fh.getFile()).text());
    } catch (e) { return null; }          // _session.json 없는 폴더는 작업이 아님
    if (!sess || !Array.isArray(sess.units)) return null;

    // 폴더 안의 workNN 수집
    var workDirs = [];
    try {
      for await (var ent of dirHandle.entries()) {
        var nm = ent[0], h = ent[1];
        if (h.kind === 'directory' && /^work\d+/i.test(nm)) {
          var m = nm.match(/\d+/);
          workDirs.push({ name: nm, num: m ? parseInt(m[0], 10) : 0, handle: h });
        }
      }
    } catch (e) {}
    workDirs.sort(function (a, b) { return a.num - b.num; });

    // 호수 ↔ 폴더 매칭 (loader 와 같은 규칙: workNum 정확매칭 → 번호순 폴백)
    var used = {}, matched = {};
    sess.units.forEach(function (u, ui) {
      var wn = parseInt(String(u.workNum || (ui + 1)), 10);
      for (var k = 0; k < workDirs.length; k++) {
        if (used[k]) continue;
        if (workDirs[k].num === wn) { matched[ui] = k; used[k] = 1; break; }
      }
    });
    var rest = [];
    workDirs.forEach(function (w, k) { if (!used[k]) rest.push(k); });
    var ri = 0;
    sess.units.forEach(function (u, ui) {
      if (matched[ui] !== undefined) return;
      if (ri < rest.length) { matched[ui] = rest[ri]; used[rest[ri]] = 1; ri++; }
    });

    var rows = [], anyDiff = false;
    for (var ui = 0; ui < sess.units.length; ui++) {
      var u = sess.units[ui];
      var wd = (matched[ui] !== undefined) ? workDirs[matched[ui]] : null;
      var files = wd ? await scanWorkDir(wd.handle) : { A: [], B: [], S: {} };

      var recB = (u.beforeCount || 0), recA = (u.afterCount || 0);
      var actB = files.A.length, actA = files.B.length;   // A_=전, B_=후
      var specs = (u.specials || []).map(function (s, si) {
        return { rec: (s.photoCount || 0), act: (files.S[si + 1] || []).length };
      });
      var recSum = recB + recA + specs.reduce(function (a, x) { return a + x.rec; }, 0);
      var actSum = actB + actA + specs.reduce(function (a, x) { return a + x.act; }, 0);
      var diff = (recB !== actB) || (recA !== actA) || specs.some(function (s) { return s.rec !== s.act; });
      var numDrift = wd ? (parseInt(String(u.workNum || (ui + 1)), 10) !== wd.num) : false;

      // ★ 판정 (2026-08-09)
      //   ok      : 기록 = 실제
      //   empty   : 기록도 0, 실제도 0 (사진 안 찍은 예정 작업 등) → 정상
      //   lost    : 기록은 있는데 실제 파일이 하나도 없음 → 유실 의심 (건드리면 안 됨)
      //   partial : 사진은 있는데 개수가 다름
      //   drift   : 개수는 같은데 폴더 번호만 어긋남
      var verdict = 'ok';
      if (recSum === 0 && actSum === 0) verdict = 'empty';
      else if (recSum > 0 && actSum === 0) verdict = 'lost';
      else if (diff) verdict = 'partial';
      else if (numDrift) verdict = 'drift';
      if (verdict !== 'ok' && verdict !== 'empty') anyDiff = true;

      rows.push({
        ui: ui, name: u.name || ('호수' + (ui + 1)),
        folder: wd ? wd.name : null, folderNum: wd ? wd.num : null,
        recWorkNum: parseInt(String(u.workNum || (ui + 1)), 10),
        recBefore: recB, actBefore: actB,
        recAfter: recA, actAfter: actA,
        recSum: recSum, actSum: actSum,
        specs: specs, files: files, diff: diff, numDrift: numDrift,
        verdict: verdict
      });
    }

    var hasLost = rows.some(function (r) { return r.verdict === 'lost'; });
    var hasFixable = rows.some(function (r) { return r.verdict === 'partial' || r.verdict === 'drift'; });
    return {
      folderName: dirHandle.name, handle: dirHandle, sess: sess,
      apt: sess.apt || '', date: sess.date || '',
      rows: rows, hasDiff: anyDiff, hasLost: hasLost, hasFixable: hasFixable,
      recTotal: rows.reduce(function (s, r) {
        return s + r.recBefore + r.recAfter + r.specs.reduce(function (a, x) { return a + x.rec; }, 0);
      }, 0),
      actTotal: rows.reduce(function (s, r) {
        return s + r.actBefore + r.actAfter + r.specs.reduce(function (a, x) { return a + x.act; }, 0);
      }, 0)
    };
  }

  /* ── 전체 검사 ───────────────────────────── */
  PhotoAudit.scanAll = async function (onProgress, opts) {
    if (typeof photoFolderHandle === 'undefined' || !photoFolderHandle) {
      throw new Error('사진 폴더가 지정되지 않았습니다');
    }
    try {
      var perm = await photoFolderHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') await photoFolderHandle.requestPermission({ mode: 'readwrite' });
    } catch (e) {}

    var from = (opts && opts.from) || '';   // 'YYYY-MM-DD' 이상
    var to   = (opts && opts.to) || '';     // 'YYYY-MM-DD' 이하 (해당일 포함)
    var dirs = [];
    for await (var ent of photoFolderHandle.entries()) {
      if (ent[1].kind !== 'directory') continue;
      var nm = ent[0];
      if (!/^\d{4}-\d{2}-\d{2}/.test(nm)) continue;
      var d10 = nm.slice(0, 10);
      if (from && d10 < from) continue;
      if (to && d10 > to) continue;
      dirs.push(ent[1]);
    }
    dirs.sort(function (a, b) { return a.name < b.name ? 1 : -1; });   // 최신 먼저

    var works = [];
    for (var i = 0; i < dirs.length; i++) {
      if (onProgress) onProgress(i + 1, dirs.length);
      try {
        var r = await auditWorkFolder(dirs[i]);
        if (r) works.push(r);
      } catch (e) { console.warn('[사진검사] 실패:', dirs[i].name, e && e.message); }
      if (i % 5 === 4) await new Promise(function (r2) { setTimeout(r2, 0); });
    }
    _report = { works: works, scannedAt: new Date() };
    return _report;
  };

  /* ── 진단: 루트 아래 이미지 파일 전수 집계 ───────── */
  //   "기록 1270 / 실제 211" 같은 결과가 나왔을 때,
  //   사진이 정말 사라진 건지 / 앱이 다른 폴더를 보고 있는 건지 가른다.
  PhotoAudit.diagnose = async function () {
    var root = photoFolderHandle;
    var info = { path: '(알 수 없음)', dirs: 0, images: 0, others: 0, byDir: [] };
    try { info.path = root._path || root.name || '(이름 없음)'; } catch (e) {}
    async function walk(h, depth, label) {
      if (depth > 3) return 0;
      var n = 0;
      try {
        for await (var ent of h.entries()) {
          var nm = ent[0], c = ent[1];
          if (c.kind === 'file') {
            if (/\.(jpe?g|png)$/i.test(nm)) { n++; info.images++; } else info.others++;
          } else {
            info.dirs++;
            n += await walk(c, depth + 1, label);
          }
        }
      } catch (e) {}
      return n;
    }
    try {
      for await (var ent2 of root.entries()) {
        if (ent2[1].kind !== 'directory') { if (/\.(jpe?g|png)$/i.test(ent2[0])) info.images++; continue; }
        info.dirs++;
        var c = await walk(ent2[1], 1, ent2[0]);
        if (c > 0) info.byDir.push({ name: ent2[0], count: c });
      }
    } catch (e) { info.error = e && e.message; }
    info.byDir.sort(function (a, b) { return b.count - a.count; });
    return info;
  };

  /* ── 결과를 텍스트 파일로 남기기 (유실 목록 보존) ── */
  PhotoAudit.exportReport = async function (rep) {
    var L = [];
    L.push('사진 개수 검사 결과 — ' + new Date().toLocaleString('ko-KR'));
    L.push('작업 ' + rep.works.length + '건');
    var sumRec = 0, sumAct = 0;
    rep.works.forEach(function (w) { sumRec += w.recTotal; sumAct += w.actTotal; });
    L.push('기록 ' + sumRec + '장 / 실제 ' + sumAct + '장 (차이 ' + (sumAct - sumRec) + ')');
    L.push('');
    L.push('구분: LOST=기록만 있고 파일 0 / PARTIAL=개수 다름 / DRIFT=번호 어긋남 / EMPTY=원래 사진 없음');
    L.push('─────────────────────────────');
    rep.works.forEach(function (w) {
      w.rows.forEach(function (r) {
        if (r.verdict === 'ok' || r.verdict === 'empty') return;
        L.push([r.verdict.toUpperCase(), w.date, w.folderName, w.apt, r.name,
                '기록 ' + r.recSum, '실제 ' + r.actSum,
                '폴더 ' + (r.folder || '없음')].join(' | '));
      });
    });
    var name = '_photo_audit_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.txt';
    var fh = await photoFolderHandle.getFileHandle(name, { create: true });
    var w2 = await fh.createWritable();
    await w2.write(new Blob([L.join('\n')], { type: 'text/plain; charset=utf-8' }));
    await w2.close();
    return name;
  };

  /* ── 재기록 ───────────────────────────── */
  async function rewriteOne(work) {
    var sess = work.sess;
    // 원본 백업 (최초 1회만)
    try {
      var exists = true;
      try { await work.handle.getFileHandle('_session.bak.json'); } catch (e) { exists = false; }
      if (!exists) {
        var bh = await work.handle.getFileHandle('_session.bak.json', { create: true });
        var bw = await bh.createWritable();
        await bw.write(new Blob([JSON.stringify(sess, null, 2)], { type: 'application/json' }));
        await bw.close();
      }
    } catch (e) { console.warn('[사진검사] 백업 실패:', work.folderName, e && e.message); }

    work.rows.forEach(function (r) {
      var u = sess.units[r.ui];
      if (!u) return;
      // 파일명 → 기존 썸네일 보존
      var oldThumb = {};
      (u.beforeMeta || []).concat(u.afterMeta || []).forEach(function (m) {
        if (m && m.fname && m.thumb) oldThumb[m.fname] = m.thumb;
      });
      (u.specials || []).forEach(function (s) {
        (s.photosMeta || []).forEach(function (m) { if (m && m.fname && m.thumb) oldThumb[m.fname] = m.thumb; });
      });
      var mk = function (list) {
        return list.map(function (f) { return { fname: f.name, thumb: oldThumb[f.name] || null }; });
      };

      u.beforeMeta = mk(r.files.A);
      u.afterMeta  = mk(r.files.B);
      u.beforeCount = r.files.A.length;
      u.afterCount  = r.files.B.length;
      if (Array.isArray(u.specials)) {
        u.specials.forEach(function (s, si) {
          var list = r.files.S[si + 1] || [];
          s.photosMeta = mk(list);
          s.photoCount = list.length;
        });
      }
      // ★ 폴더 번호 교정 (workNN 어긋남 영구 해소)
      if (r.folderNum) u.workNum = r.folderNum;
    });

    sess._photoAuditAt = new Date().toISOString();
    var fh = await work.handle.getFileHandle('_session.json', { create: true });
    var w = await fh.createWritable();
    await w.write(new Blob([JSON.stringify(sess, null, 2)], { type: 'application/json' }));
    await w.close();
  }

  PhotoAudit.fixAll = async function (works, onProgress) {
    var ok = 0, fail = 0;
    for (var i = 0; i < works.length; i++) {
      if (onProgress) onProgress(i + 1, works.length);
      try { await rewriteOne(works[i]); ok++; }
      catch (e) { fail++; console.warn('[사진검사] 재기록 실패:', works[i].folderName, e && e.message); }
      if (i % 3 === 2) await new Promise(function (r) { setTimeout(r, 0); });
    }
    // 캐시/인덱스 갱신 - 화면에 바로 반영
    try { if (typeof invalidateRecordsCache === 'function') invalidateRecordsCache(); } catch (e) {}
    try { if (typeof invalidateWorkIndex === 'function') invalidateWorkIndex(); } catch (e) {}
    try { if (typeof invalidateCustomersCache === 'function') invalidateCustomersCache(); } catch (e) {}
    return { ok: ok, fail: fail };
  };

  /* ── 서버에서 사진 다시 받기 (유실 복구) ───────── */
  PhotoAudit.redownload = async function (works, onProgress) {
    if (!(window.CloudBackup && CloudBackup.redownloadWork)) throw new Error('서버 백업 기능을 쓸 수 없습니다');
    var sum = { works: 0, got: 0, failed: 0, unmatched: 0, noServer: 0 };
    for (var i = 0; i < works.length; i++) {
      var w = works[i];
      if (onProgress) onProgress(i + 1, works.length, w.apt || w.folderName);
      try {
        var r = await CloudBackup.redownloadWork(w.handle, w.sess);
        if (r && r.skipped) throw new Error(r.skipped);
        if (!r || !r.server) { sum.noServer++; continue; }
        sum.works++;
        sum.got += (r.got || 0);
        sum.failed += (r.failed || 0);
        sum.unmatched += (r.unmatched || 0);
      } catch (e) { sum.failed++; console.warn('[사진복구]', w.folderName, e && e.message); }
      await new Promise(function (r2) { setTimeout(r2, 0); });
    }
    return sum;
  };

  /* ── UI ───────────────────────────── */
  var VLABEL = { lost: ['유실 의심', '#e0574a'], partial: ['개수 다름', '#d98324'],
                 drift: ['번호 어긋남', '#d98324'], empty: ['사진 없음', 'var(--mu)'], ok: ['정상', '#1b8a5f'] };

  function rowHtml(r) {
    var parts = [];
    function cell(label, rec, act) {
      var bad = rec !== act;
      parts.push('<span style="margin-right:10px;white-space:nowrap;">' + label + ' ' +
        '<b style="color:' + (bad ? '#e0574a' : 'var(--tx)') + '">' + act + '</b>' +
        (bad ? '<span style="color:var(--mu);"> (기록 ' + rec + ')</span>' : '') + '</span>');
    }
    cell('전', r.recBefore, r.actBefore);
    cell('후', r.recAfter, r.actAfter);
    r.specs.forEach(function (s2, i) { cell('특' + (i + 1), s2.rec, s2.act); });
    var v = VLABEL[r.verdict] || VLABEL.ok;
    var tag = '<span style="color:' + v[1] + ';font-weight:700;">' + v[0] + '</span>';
    if (r.verdict === 'drift') tag += '<span style="color:var(--mu);"> work' +
      String(r.recWorkNum).padStart(2, '0') + ' → ' + r.folder + '</span>';
    if (r.verdict === 'lost') tag += '<span style="color:var(--mu);"> 기록 ' + r.recSum + '장, 파일 0장</span>';
    return '<div style="padding:6px 0;border-top:1px solid var(--bd,#2a2f36);font-size:12px;">' +
      '<div style="font-weight:700;margin-bottom:2px;">' + esc(r.name) + '</div>' +
      '<div style="color:var(--mu);">' + parts.join('') + '</div>' +
      '<div style="margin-top:2px;">' + tag + '</div></div>';
  }

  function render(box, rep, onlyDiff) {
    var cnt = { lost: 0, partial: 0, drift: 0, empty: 0, ok: 0 };
    var recSum = 0, actSum = 0, lostPhotos = 0;
    rep.works.forEach(function (w) {
      recSum += w.recTotal; actSum += w.actTotal;
      w.rows.forEach(function (r) {
        cnt[r.verdict] = (cnt[r.verdict] || 0) + 1;
        if (r.verdict === 'lost') lostPhotos += r.recSum;
      });
    });
    var works = rep.works.filter(function (w) { return onlyDiff ? w.hasDiff : true; });

    var head =
      '<div style="background:var(--bg2,rgba(255,255,255,.05));border-radius:10px;padding:12px;margin-bottom:10px;font-size:13px;line-height:1.8;">' +
        '작업 <b>' + rep.works.length + '</b>건 · 호수 <b>' +
          (cnt.lost + cnt.partial + cnt.drift + cnt.empty + cnt.ok) + '</b>개<br>' +
        '기록 <b>' + recSum + '</b>장 · 실제 <b>' + actSum + '</b>장' +
        (recSum !== actSum ? ' <span style="color:#e0574a;">(' + (actSum - recSum) + ')</span>' : '') +
        '<div style="margin-top:8px;font-size:12px;">' +
          '<span style="color:#e0574a;">■ 유실 의심 ' + cnt.lost + '개</span> (' + lostPhotos + '장)<br>' +
          '<span style="color:#d98324;">■ 개수 다름 ' + cnt.partial + '개 · 번호 어긋남 ' + cnt.drift + '개</span><br>' +
          '<span style="color:var(--mu);">■ 원래 사진 없음 ' + cnt.empty + '개 · 정상 ' + cnt.ok + '개</span>' +
        '</div>' +
      '</div>' +
      (cnt.lost > 0 ?
        '<div style="background:#e0574a1a;border:1px solid #e0574a55;border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:12px;line-height:1.7;">' +
        '<b style="color:#e0574a;">⚠️ 유실 의심 ' + cnt.lost + '개는 재기록에서 제외됩니다.</b><br>' +
        '기록만 있고 파일이 0장인 상태예요. 사진이 정말 사라진 건지, 앱이 다른 폴더를 보고 있는 건지 먼저 확인해야 합니다. ' +
        '지금 재기록하면 “몇 장이 있었는지”라는 단서까지 지워집니다.<br>' +
        '<b>📋 폴더 진단</b>으로 실제 파일이 어디 있는지 먼저 확인하세요.' +
        '</div>' : '');

    if (!works.length) {
      box.innerHTML = head + '<div style="text-align:center;color:var(--mu);padding:24px;font-size:13px;">' +
        (onlyDiff ? '문제 있는 작업이 없습니다 👍' : '검사할 작업이 없습니다') + '</div>';
      return;
    }
    box.innerHTML = head + works.map(function (w) {
      var bc = w.hasLost ? '#e0574a55' : (w.hasFixable ? '#d9832455' : 'var(--bd,#2a2f36)');
      return '<div style="background:var(--sf);border:1px solid ' + bc + ';border-radius:10px;padding:10px 12px;margin-bottom:8px;">' +
        '<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;">' +
          '<div style="font-size:13px;font-weight:800;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
            esc(w.apt || w.folderName) + '</div>' +
          '<div style="font-size:11px;color:var(--mu);white-space:nowrap;">' + esc(w.date || '') + '</div>' +
        '</div>' +
        '<div style="font-size:10px;color:var(--mu);margin-bottom:2px;">' + esc(w.folderName) + '</div>' +
        w.rows.filter(function (r) { return !onlyDiff || (r.verdict !== 'ok' && r.verdict !== 'empty'); })
              .map(rowHtml).join('') +
      '</div>';
    }).join('');
  }

  PhotoAudit.open = function () {
    if (_busy) { toast('검사가 진행 중입니다', 'err'); return; }
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.86);z-index:2700;display:flex;align-items:flex-start;justify-content:center;padding:20px 10px;overflow-y:auto;';
    ov.innerHTML =
      '<div style="background:var(--sf);border-radius:14px;padding:16px;max-width:560px;width:100%;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
          '<div style="font-size:16px;font-weight:800;">🔍 사진 개수 검사</div>' +
          '<button class="btn b-ghost b-xs" id="paClose">✕</button>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--mu);line-height:1.6;margin-bottom:12px;">' +
          '폴더에 <b>실제로 있는 사진</b>과 앱에 <b>기록된 개수</b>를 비교합니다. 검사는 읽기만 하므로 안전합니다.<br>' +
          '<b>개수만 교정</b>은 사진이 남아 있는 호수만 손봅니다. 파일이 0장인 “유실 의심”은 단서 보존을 위해 건드리지 않습니다. ' +
          '원본은 <b>_session.bak.json</b> 으로 보관됩니다.' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:12px;">' +
          '<span style="color:var(--mu);white-space:nowrap;">기간</span>' +
          '<select id="paRange" style="flex:1;padding:7px 8px;border-radius:8px;background:var(--sf);color:var(--tx);border:1px solid var(--bd,#2a2f36);font-size:12px;">' +
            '<option value="thismonth">이번 달</option>' +
            '<option value="1m">최근 1개월</option>' +
            '<option value="3m">최근 3개월</option>' +
            '<option value="all">전체</option>' +
          '</select>' +
        '</div>' +
        '<div style="display:flex;gap:6px;margin-bottom:6px;">' +
          '<button class="btn b-blue" id="paScan" style="flex:1;justify-content:center;">🔍 검사 시작</button>' +
          '<button class="btn b-ghost" id="paDiag" style="flex:1;justify-content:center;">📋 폴더 진단</button>' +
        '</div>' +
        '<div style="display:flex;gap:6px;margin-bottom:6px;">' +
          '<button class="btn b-ghost" id="paSave" style="flex:1;justify-content:center;" disabled>💾 결과 파일로 저장</button>' +
          '<button class="btn b-ghost" id="paFix" style="flex:1;justify-content:center;" disabled>✏️ 개수만 교정</button>' +
        '</div>' +
        '<div style="display:flex;gap:6px;margin-bottom:10px;">' +
          '<button class="btn b-ghost" id="paDL" style="flex:1;justify-content:center;" disabled>☁️ 서버에서 사진 다시 받기</button>' +
        '</div>' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--mu);margin-bottom:10px;">' +
          '<input type="checkbox" id="paOnlyDiff" checked> 불일치만 보기</label>' +
        '<div id="paBody" style="max-height:56vh;overflow-y:auto;"><div style="text-align:center;color:var(--mu);padding:28px;font-size:13px;">검사 시작을 눌러주세요</div></div>' +
      '</div>';
    document.body.appendChild(ov);

    var box = ov.querySelector('#paBody');
    var btnScan = ov.querySelector('#paScan');
    var btnFix = ov.querySelector('#paFix');
    var btnDiag = ov.querySelector('#paDiag');
    var btnSave = ov.querySelector('#paSave');
    var btnDL = ov.querySelector('#paDL');
    var selRange = ov.querySelector('#paRange');

    function rangeOpts() {
      var v = selRange.value, now = new Date();
      var p2 = function (n) { return String(n).padStart(2, '0'); };
      var fmt = function (d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
      if (v === 'all') return {};
      if (v === 'thismonth') return { from: fmt(new Date(now.getFullYear(), now.getMonth(), 1)) };
      var m = (v === '3m') ? 3 : 1;
      var d = new Date(now); d.setMonth(d.getMonth() - m);
      return { from: fmt(d) };
    }
    var chk = ov.querySelector('#paOnlyDiff');
    var close = function () { try { document.body.removeChild(ov); } catch (e) {} };
    ov.querySelector('#paClose').onclick = close;
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    chk.onchange = function () { if (_report) render(box, _report, chk.checked); };

    btnDiag.onclick = async function () {
      if (_busy) return;
      _busy = true; btnDiag.disabled = true;
      box.innerHTML = '<div style="text-align:center;color:var(--mu);padding:28px;font-size:13px;">폴더 살펴보는 중…</div>';
      try {
        var d = await PhotoAudit.diagnose();
        box.innerHTML =
          '<div style="background:var(--bg2,rgba(255,255,255,.05));border-radius:10px;padding:12px;font-size:13px;line-height:1.9;">' +
            '<div style="font-weight:800;margin-bottom:6px;">📋 앱이 보고 있는 폴더</div>' +
            '<div style="font-size:11px;color:var(--mu);word-break:break-all;margin-bottom:10px;">' + esc(d.path) + '</div>' +
            '하위 폴더 <b>' + d.dirs + '</b>개<br>' +
            '이미지 파일 <b style="font-size:16px;">' + d.images + '</b>장<br>' +
            '그 외 파일 ' + d.others + '개' +
            (d.error ? '<div style="color:#e0574a;margin-top:6px;">오류: ' + esc(d.error) + '</div>' : '') +
          '</div>' +
          '<div style="font-size:12px;color:var(--mu);line-height:1.7;margin:10px 0;">' +
            '이 숫자가 검사의 “실제 파일” 합계와 비슷하면, 사진은 정말 이 폴더에 없는 것입니다.<br>' +
            '기기 파일 관리자에서 <b>Android/data/com.baesungchul.workreport/files</b> 와 ' +
            '<b>Documents/work-report-backups</b> 를 직접 확인해 보세요.' +
          '</div>' +
          '<div style="font-size:12px;font-weight:700;margin-bottom:4px;">사진이 있는 폴더</div>' +
          (d.byDir.length ? d.byDir.slice(0, 40).map(function (x) {
            return '<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-top:1px solid var(--bd,#2a2f36);">' +
              '<span style="color:var(--mu);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(x.name) + '</span>' +
              '<b style="white-space:nowrap;margin-left:8px;">' + x.count + '장</b></div>';
          }).join('') : '<div style="color:#e0574a;font-size:13px;padding:8px 0;">사진이 있는 폴더가 하나도 없습니다</div>');
      } catch (e) {
        box.innerHTML = '<div style="color:#e0574a;padding:20px;font-size:13px;">진단 실패: ' + esc(e && e.message) + '</div>';
      } finally { _busy = false; btnDiag.disabled = false; }
    };

    btnSave.onclick = async function () {
      if (_busy || !_report) return;
      try {
        var nm = await PhotoAudit.exportReport(_report);
        toast('✅ ' + nm + ' 저장됨 (사진 폴더 안)');
      } catch (e) { toast('저장 실패: ' + (e && e.message), 'err'); }
    };

    btnDL.onclick = async function () {
      if (_busy || !_report) return;
      var targets = _report.works.filter(function (w) { return w.hasLost; });
      if (!targets.length) { toast('받을 대상이 없습니다'); return; }
      if (!confirm('유실 의심 ' + targets.length + '건을 서버 백업에서 다시 받을까요?\n\n' +
                   '· 이미 있는 사진은 건너뜁니다\n' +
                   '· 구독 계정에 백업된 사진만 받을 수 있습니다\n' +
                   '· 시간이 걸릴 수 있어요')) return;
      _busy = true; btnDL.disabled = true; btnScan.disabled = true; btnFix.disabled = true;
      try {
        var r = await PhotoAudit.redownload(targets, function (cur, total, nm) {
          box.innerHTML = '<div style="text-align:center;color:var(--mu);padding:28px;font-size:13px;">' +
            '📥 받는 중… ' + cur + ' / ' + total + '<br><span style="font-size:11px;">' + esc(nm) + '</span></div>';
        });
        toast('📥 ' + r.got + '장 복구' +
              (r.noServer ? ' · 서버에 없음 ' + r.noServer + '건' : '') +
              (r.unmatched ? ' · 호수 못 찾음 ' + r.unmatched : '') +
              (r.failed ? ' · 실패 ' + r.failed : ''), r.got ? 'ok' : 'err');
        var rep3 = await PhotoAudit.scanAll(null, rangeOpts());
        render(box, rep3, chk.checked);
        btnFix.disabled = !rep3.works.some(function (w) { return w.hasFixable && !w.hasLost; });
        btnDL.disabled = !rep3.works.some(function (w) { return w.hasLost; });
      } catch (e) {
        toast('복구 실패: ' + (e && e.message), 'err');
        btnDL.disabled = false;
      } finally { _busy = false; btnScan.disabled = false; }
    };

    btnScan.onclick = async function () {
      if (_busy) return;
      _busy = true; btnScan.disabled = true; btnFix.disabled = true;
      box.innerHTML = '<div style="text-align:center;color:var(--mu);padding:28px;font-size:13px;">검사 중…</div>';
      try {
        var rep = await PhotoAudit.scanAll(function (cur, total) {
          box.innerHTML = '<div style="text-align:center;color:var(--mu);padding:28px;font-size:13px;">검사 중… ' + cur + ' / ' + total + '</div>';
        }, rangeOpts());
        render(box, rep, chk.checked);
        btnFix.disabled = !rep.works.some(function (w) { return w.hasFixable && !w.hasLost; });
        btnSave.disabled = false;
        btnDL.disabled = !rep.works.some(function (w) { return w.hasLost; });
      } catch (e) {
        box.innerHTML = '<div style="color:#e0574a;padding:20px;font-size:13px;">검사 실패: ' + esc(e && e.message) + '</div>';
      } finally { _busy = false; btnScan.disabled = false; }
    };

    btnFix.onclick = async function () {
      if (_busy || !_report) return;
      // ★ 유실 의심(파일 0장)이 하나라도 있는 작업은 제외 — 단서를 지우지 않기 위해
      var targets = _report.works.filter(function (w) { return w.hasFixable && !w.hasLost; });
      var skipped = _report.works.filter(function (w) { return w.hasLost; }).length;
      if (!targets.length) {
        toast(skipped ? '교정 대상이 없습니다 (유실 의심 ' + skipped + '건은 제외)' : '고칠 작업이 없습니다', 'err');
        return;
      }
      if (!confirm(targets.length + '건의 사진 개수를 실제 파일 기준으로 교정할까요?\n\n' +
                   '· 사진 파일은 전혀 건드리지 않습니다\n' +
                   '· 원본 기록은 _session.bak.json 으로 보관됩니다\n' +
                   (skipped ? '· 유실 의심 ' + skipped + '건은 제외됩니다' : ''))) return;
      _busy = true; btnFix.disabled = true; btnScan.disabled = true;
      try {
        var r = await PhotoAudit.fixAll(targets, function (cur, total) {
          box.innerHTML = '<div style="text-align:center;color:var(--mu);padding:28px;font-size:13px;">재기록 중… ' + cur + ' / ' + total + '</div>';
        });
        toast('✅ ' + r.ok + '건 교정 완료' + (r.fail ? ' (실패 ' + r.fail + ')' : ''), r.fail ? 'err' : 'ok');
        var rep2 = await PhotoAudit.scanAll(null, rangeOpts());
        render(box, rep2, chk.checked);
        btnFix.disabled = !rep2.works.some(function (w) { return w.hasFixable && !w.hasLost; });
      } catch (e) {
        toast('재기록 실패: ' + (e && e.message), 'err');
      } finally { _busy = false; btnScan.disabled = false; }
    };
  };
})();
