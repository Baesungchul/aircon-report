/* ═══════════════════════════════════════════════════════════
   sns_share.js — 글 + 사진을 블로그/SNS에 올리기 (모바일 모드)
   ----------------------------------------------------------------
   ★ 2026-08-26 신규.
   왜: AI 글작성 결과는 '전체 복사'만 있어서, 사용자가 글을 복사해 붙여넣고
       사진은 갤러리에서 따로 골라 넣어야 했다(단계가 4~5번).
   무엇: [📤 사진과 함께 올리기] 한 번에
         ① 글을 클립보드에 넣고 ② OS 공유 시트로 사진을 순서대로 넘긴다.
         네이버블로그·인스타·페북은 공유받은 사진으로 글쓰기 화면이 바로 열린다.
         → 사용자는 본문 칸에 붙여넣기(길게 눌러 붙여넣기)만 하면 끝.
   ⚠️ 캡션(글) 자동 채움은 어느 앱도 지원하지 않는다 — 글은 항상 클립보드다.
   ⚠️ 당근마켓은 공유 시트에 뜨지 않는다 → 갤러리 저장 + 수동 첨부로 대체.
   ⚠️ 공유 순서가 보장되지 않는 기기가 있어 파일명에 순번(01_,02_)을 박는다.
   의존: @capacitor/share(설치·등록 완료), @capacitor/filesystem, window.Gallery
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CACHE_DIR = 'sns_share';

  /* 채널별 안내 — 공유 시트에서 무엇을 골라야 하는지 사람 말로 적는다 */
  var CH = {
    /* ★ 2026-09-01 마커 안내 — 모바일 앱은 본문 중간에 사진을 자동으로 못 넣는다.
         글에 남겨 둔 (사진: 🔴 작업 전 1) 표시가 '어느 사진을 여기에' 인지 알려주는 지도다.
         사진은 작업 전 → 작업 후 순으로 첨부되므로 번호와 그대로 맞물린다. */
    naver:  { label: '네이버 블로그', pick: '네이버 블로그', max: 30,
              steps: ['공유 목록에서 <b>네이버 블로그</b>를 고르세요',
                      '사진이 들어간 글쓰기 화면이 열립니다',
                      '본문 칸을 길게 눌러 <b>붙여넣기</b> 하세요 (글은 이미 복사해 뒀어요)',
                      '글 속 <b>🔴 작업 전 1</b> · <b>🟢 작업 후 1</b> 표시가 사진 자리예요. 사진을 그 자리로 옮기고 표시 줄은 지우세요 (사진은 작업 전 → 작업 후 순으로 첨부돼요)'] },
    insta:  { label: '인스타그램', pick: '인스타그램', max: 20,
              steps: ['공유 목록에서 <b>인스타그램</b>을 고르세요 (피드/스토리 선택)',
                      '사진이 들어간 게시물 작성 화면이 열립니다',
                      '캡션 칸을 길게 눌러 <b>붙여넣기</b> 하세요'] },
    /* ⚠️ 키는 ai.js CHANNELS 의 키와 같아야 한다 — 'fb' 로 적어 뒀다가 안 맞아서
         페이스북만 버튼이 안 떴다(2026-08-27 수정). */
    facebook: { label: '페이스북', pick: '페이스북', max: 30,
              steps: ['공유 목록에서 <b>페이스북</b>을 고르세요',
                      '사진이 첨부된 게시물 작성 화면이 열립니다',
                      '내용 칸을 길게 눌러 <b>붙여넣기</b> 하세요'] },
    carrot: { label: '당근', pick: null, max: 10,
              steps: ['사진을 <b>갤러리에 저장</b>했습니다',
                      '당근 앱에서 글쓰기 → 사진 추가를 누르세요',
                      '방금 저장된 사진을 <b>번호 순서대로</b> 고른 뒤, 내용 칸에 붙여넣기 하세요'] }
  };

  function isNative() {
    return !!(window.Capacitor && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform());
  }
  function _Share() { return window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Share; }
  function _FS() { return window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Filesystem; }
  function toast(m, t) { if (typeof showToast === 'function') showToast(m, t || 'ok'); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* 사용 가능 여부 — 앱(네이티브) + Share 플러그인이 있어야 한다 */
  function available() { return isNative() && !!_Share(); }

  /* ── 현재 작업의 사진을 '보이는 순서대로' 모은다 ──
     순서 = 호수 순 → 작업전 → 작업후 → 특이사항. 글의 흐름과 같은 순서다. */
  function collect() {
    var out = [];
    if (typeof units === 'undefined' || !Array.isArray(units)) return out;
    /* ⭐ unit/role 은 cloud_photo_sync 가 쓰는 것과 똑같은 값이어야 한다 —
         이 둘로 서버에 이미 올라간 사진의 경로를 그대로 계산해 재사용한다. */
    units.forEach(function (u) {
      if (!u) return;
      (u.before || []).forEach(function (p) { out.push({ p: p, kind: 'before', unit: u.name, role: 'before' }); });
      (u.after || []).forEach(function (p) { out.push({ p: p, kind: 'after', unit: u.name, role: 'after' }); });
      (u.specials || []).forEach(function (sp, si) {
        ((sp && sp.photos) || []).forEach(function (p) {
          out.push({ p: p, kind: 'special', unit: u.name, role: 'special' + (si + 1) });
        });
      });
    });
    return out;
  }
  function countBy(list) {
    var c = { before: 0, after: 0, special: 0 };
    list.forEach(function (x) { c[x.kind]++; });
    return c;
  }

  function copyText(t) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t); return true; }
    } catch (e) {}
    try {
      var ta = document.createElement('textarea');
      ta.value = t;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
      document.body.appendChild(ta);
      ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length);
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  function b64of(r) {
    /* Gallery.resolvePhoto 결과({blob}|{dataUrl})를 base64 문자열로 */
    return new Promise(function (res, rej) {
      if (!r) { rej(new Error('사진을 읽지 못했습니다')); return; }
      if (r.dataUrl) {
        var s = String(r.dataUrl), i = s.indexOf(',');
        res(i >= 0 ? s.slice(i + 1) : s); return;
      }
      var fr = new FileReader();
      fr.onloadend = function () { var s = String(fr.result), i = s.indexOf(','); res(i >= 0 ? s.slice(i + 1) : s); };
      fr.onerror = function () { rej(fr.error || new Error('사진 읽기 실패')); };
      fr.readAsDataURL(r.blob);
    });
  }

  /* 캐시 폴더를 비운다 — 지난번 공유 파일이 섞여 나가면 엉뚱한 사진이 올라간다 */
  async function clearCache() {
    var FS = _FS(); if (!FS) return;
    try { await FS.rmdir({ path: CACHE_DIR, directory: 'CACHE', recursive: true }); } catch (e) {}
    try { await FS.mkdir({ path: CACHE_DIR, directory: 'CACHE', recursive: true }); } catch (e) {}
  }

  /* 사진들을 캐시에 순번 파일명으로 써서 file:// URI 배열을 만든다 */
  async function stage(list) {
    var FS = _FS();
    if (!FS) throw new Error('파일 플러그인 미등록 (재빌드 필요)');
    if (!window.Gallery || !Gallery.resolvePhoto) throw new Error('사진 모듈을 찾을 수 없습니다');
    await clearCache();
    var uris = [];
    for (var i = 0; i < list.length; i++) {
      if (typeof setProg === 'function') setProg((i / list.length) * 100, '사진 준비 ' + (i + 1) + '/' + list.length);
      var r = null;
      try { r = await Gallery.resolvePhoto(list[i].p); } catch (e) {}
      if (!r) continue;
      var b64;
      try { b64 = await b64of(r); } catch (e) { continue; }
      /* ⚠️ 파일명 순번이 공유 순서의 유일한 보험이다 — 빼지 말 것 */
      var name = CACHE_DIR + '/' + String(i + 1).padStart(2, '0') + '_' +
                 (list[i].kind === 'before' ? 'before' : list[i].kind === 'after' ? 'after' : 'etc') + '.jpg';
      try {
        await FS.writeFile({ path: name, data: b64, directory: 'CACHE', recursive: true });
        var u = await FS.getUri({ path: name, directory: 'CACHE' });
        if (u && u.uri) uris.push(u.uri);
      } catch (e) { console.warn('[SnsShare] 사진 준비 실패', name, e && e.message); }
      if (i % 4 === 3) await new Promise(function (res) { setTimeout(res, 0); });
    }
    return uris;
  }

  /* ── 실행 ── */
  /* ☠️ 2026-09-01 글은 **마커를 지우지 않고 그대로** 클립보드에 넣는다 (사용자 결정).
       모바일 앱은 본문 중간에 사진을 자동으로 못 넣는다 → 사용자가 손으로 끼워 넣어야 하고,
       (사진: 작업 전 1) 같은 마커가 '여기에 어느 사진' 인지 알려주는 유일한 표시다.
       사진 파일명도 01_before, 02_before … 순번이라 마커 번호와 그대로 맞물린다. */
  async function run(chId, text, list) {
    var ch = CH[chId] || CH.naver;
    var okCopy = copyText(text || '');
    try {
      if (typeof showOverlay === 'function') showOverlay('사진 준비 중...');
      if (chId === 'carrot') {
        /* 당근은 공유 시트에 안 뜬다 → 갤러리 저장으로 대체 */
        if (typeof hideOverlay === 'function') hideOverlay();
        if (window.Gallery && Gallery.exportCurrentWorkPhotosToGallery) await Gallery.exportCurrentWorkPhotosToGallery();
        else toast('갤러리 저장을 쓸 수 없습니다', 'err');
        return;
      }
      var uris = await stage(list);
      if (typeof hideOverlay === 'function') hideOverlay();
      if (!uris.length) { toast('공유할 사진을 준비하지 못했습니다', 'err'); return; }
      await _Share().share({ files: uris, dialogTitle: ch.label + '에 올리기' });
      if (!okCopy) toast('사진은 보냈어요 — 글은 복사가 안 됐으니 다시 복사해주세요', 'err');
      /* ★ 2026-08-27 별점 — 글과 사진을 무사히 보낸 직후. 아무것도 묻지 않는다(js/review.js). */
      try { window.Review && Review.maybeAskSoon('sns-mobile', 2500); } catch (e2) {}
    } catch (e) {
      if (typeof hideOverlay === 'function') hideOverlay();
      var m = (e && (e.message || e.code)) || '';
      /* 사용자가 공유 시트를 그냥 닫은 것은 오류가 아니다 */
      if (/cancel|abort|Share canceled/i.test(m)) return;
      toast('공유 실패: ' + m, 'err');
    }
  }

  /* ── 안내 + 실행 시트 ── */
  function open(chId, text) {
    if (!available()) { toast('이 기능은 앱에서만 쓸 수 있습니다', 'err'); return; }
    /* ★ 2026-08-31 무료 5회 블로그 글쓰기 안에서는 공유도 열어준다 — snsShare 로 분리
         (share 는 팀 참여·일정공유 전용, 이거까지 같이 열리면 안 됨) */
    if (window.Subs && !Subs.gateFeature('snsShare', '사진과 함께 올리기',
        '사진과 함께 올리기는 구독 사용자 전용 기능입니다.')) return;

    var ch = CH[chId] || CH.naver;
    var all = collect();
    if (!all.length) { toast('이 작업에 사진이 없습니다 — 글만 복사해 쓰세요', 'err'); return; }

    var c = countBy(all);
    var sel = { before: true, after: true, special: c.special > 0 };
    function picked() {
      var l = all.filter(function (x) { return sel[x.kind]; });
      return l.slice(0, ch.max);
    }

    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:2500;display:flex;' +
      'align-items:flex-start;justify-content:center;padding:40px 16px 16px;overflow-y:auto;';
    function chk(k, label, n) {
      if (!n) return '';
      return '<label style="display:flex;align-items:center;gap:8px;font-size:13px;padding:7px 0;cursor:pointer;">' +
        '<input type="checkbox" class="snsChk" data-k="' + k + '"' + (sel[k] ? ' checked' : '') + '>' +
        '<span>' + label + ' <b>' + n + '장</b></span></label>';
    }
    ov.innerHTML = '<div style="background:var(--sf);border-radius:14px;padding:18px;max-width:440px;width:100%;">' +
      '<div style="font-size:16px;font-weight:800;margin-bottom:4px;">📤 ' + esc(ch.label) + '에 올리기</div>' +
      '<div style="font-size:12px;color:var(--mu);margin-bottom:10px;line-height:1.6;">글은 <b>클립보드에 복사</b>되고, 사진은 <b>공유 시트</b>로 넘어갑니다.</div>' +
      '<div style="border:1px solid var(--bd);border-radius:10px;padding:8px 12px;margin-bottom:10px;">' +
        chk('before', '작업 전', c.before) + chk('after', '작업 후', c.after) + chk('special', '특이사항', c.special) +
      '</div>' +
      '<div id="snsCnt" style="font-size:12px;color:var(--ac);font-weight:700;margin-bottom:10px;"></div>' +
      '<ol style="font-size:12px;color:var(--tx);line-height:1.9;margin:0 0 4px 18px;padding:0;">' +
        ch.steps.map(function (s) { return '<li>' + s + '</li>'; }).join('') +
      '</ol>' +
      '<div style="font-size:11px;color:var(--mu);margin-top:8px;line-height:1.6;">캡션 자동 입력은 어느 앱도 지원하지 않아서, 글은 붙여넣기로 넣어야 합니다.</div>' +
      '<div style="display:flex;gap:8px;margin-top:14px;">' +
        '<button class="btn b-blue" id="snsGo" style="flex:2;justify-content:center;">' + (chId === 'carrot' ? '갤러리에 저장' : '글 복사 + 사진 공유') + '</button>' +
        '<button class="btn b-ghost" id="snsCancel" style="flex:1;justify-content:center;">취소</button>' +
      '</div></div>';
    document.body.appendChild(ov);

    function refresh() {
      var l = picked();
      var over = all.filter(function (x) { return sel[x.kind]; }).length - l.length;
      document.getElementById('snsCnt').innerHTML = '보낼 사진 ' + l.length + '장' +
        (over > 0 ? ' <span style="color:var(--wn);">(' + esc(ch.label) + ' 한 번에 ' + ch.max + '장까지 — 뒤 ' + over + '장은 빠집니다)</span>' : '');
      document.getElementById('snsGo').disabled = (l.length === 0);
    }
    refresh();

    var close = function () { if (ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('#snsCancel').onclick = close;
    Array.prototype.forEach.call(ov.querySelectorAll('.snsChk'), function (b) {
      b.onchange = function () { sel[b.getAttribute('data-k')] = b.checked; refresh(); };
    });
    ov.querySelector('#snsGo').onclick = function () {
      var l = picked();
      close();
      run(chId, text, l);
    };
  }

  /* ═══════════════════════════════════════════════════════════
     PC 링크 모드 — 글+사진을 한 페이지로 올리고 주소를 발급한다.
     ★ 2026-08-26 신규.
     왜: 모바일 공유 시트는 사진만 넘긴다. PC 스마트에디터는 붙여넣은 HTML 의
         외부 이미지 URL 을 자기 서버로 재업로드해 주므로, 공개 페이지 하나를
         만들어 두면 Ctrl+A → Ctrl+C → Ctrl+V 한 번에 글과 사진이 다 들어간다.
     ☠️ 이미지는 반드시 실제 https URL 이어야 한다 — base64 는 네이버가 걸러낸다.
     · 링크는 24시간 뒤 만료(사용자 결정). 실제 삭제는 functions/cleanupSnsPosts.
     · 페이지는 site/post.html (Firebase 호스팅).
     ═══════════════════════════════════════════════════════════ */
  /* ⚠️ 호스팅 주소가 바뀌면 이 한 줄만 고치면 된다 (js/legal.js INTRO_URL 과 같은 사이트) */
  var POST_BASE = 'https://work-report-826ec.web.app/post.html';
  var LINK_MAX = 30;                       // 한 링크에 담을 사진 상한
  var LINK_TTL_MS = 24 * 60 * 60 * 1000;   // 24시간

  function loggedIn() { return !!(window.Cloud && Cloud.ready && Cloud.user); }

  /* 원본 그대로 올리면 느리고 비싸다 → 블로그에 충분한 크기로 줄인다 */
  function shrink(blob, maxDim, q) {
    return new Promise(function (res) {
      var done = false, fin = function (v) { if (!done) { done = true; res(v); } };
      setTimeout(function () { fin(blob); }, 8000);   // 못 줄이면 원본으로 진행
      try {
        var u = URL.createObjectURL(blob);
        var img = new Image();
        img.onload = function () {
          try {
            var w = img.width, h = img.height, sc = Math.min(1, maxDim / Math.max(w, h));
            if (sc >= 1) { try { URL.revokeObjectURL(u); } catch (e) {} fin(blob); return; }
            var cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round(w * sc)); cv.height = Math.max(1, Math.round(h * sc));
            cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
            try { URL.revokeObjectURL(u); } catch (e) {}
            if (cv.toBlob) cv.toBlob(function (b) { fin(b && b.size ? b : blob); }, 'image/jpeg', q || 0.82);
            else fin(blob);
          } catch (e) { fin(blob); }
        };
        img.onerror = function () { try { URL.revokeObjectURL(u); } catch (e) {} fin(blob); };
        img.src = u;
      } catch (e) { fin(blob); }
    });
  }

  /* Gallery.resolvePhoto 결과를 Blob 으로 (dataUrl 이면 변환) */
  async function toBlob(r) {
    if (!r) return null;
    if (r.blob) return r.blob;
    if (!r.dataUrl) return null;
    try { return await (await fetch(r.dataUrl)).blob(); } catch (e) { return null; }
  }

  /* ── 이미 서버에 올라가 있는 사진이면 그 주소를 그대로 쓴다 ──
     ★ 2026-08-26 사용자 지적: "구독 서비스니까 서버에 이미 사진이 있지 않나?"
       맞다. 팀·공유 작업 사진은 저장할 때 sharedPhotos/ 로 올라가고 영구 보관된다
       (7일 자동삭제는 2026-07-09 폐기). 그러면 폰에서 다시 올릴 이유가 없다.
     ⭐ 경로는 cloud_photo_sync 와 같은 규칙이라 계산만 하면 된다 — Firestore 조회 0회.
        getDownloadURL 이 object-not-found 로 던지면 '서버에 없음' → 그때만 올린다.
     ☠️ 재사용한 사진은 **절대 지우지 않는다.** 공유용 원본이라 지우면 팀원 사진이 사라진다.
        그래서 paths[] 에 담지 않는다(cleanupSnsPosts 는 paths 만 지운다).
     ⚠️ 상대가 보탠 사진(_borrowedIncoming)은 남의 uid 밑에 있어 경로가 다르다 → 새로 올린다. */
  async function existingUrl(it) {
    try {
      if (!it || !it.p || it.p._borrowedIncoming || !it.p.fileName) return '';
      if (typeof currentFolderName === 'undefined' || !currentFolderName) return '';
      if (typeof _cpsCloudName !== 'function' || typeof _cpsSafeId !== 'function') return '';
      var cn = _cpsCloudName(it.unit || '', it.role || '', it.p.fileName);
      var path = 'sharedPhotos/' + Cloud.user.uid + '/' + _cpsSafeId(currentFolderName) + '/' + cn + '.jpg';
      return (await firebase.storage().ref(path).getDownloadURL()) || '';
    } catch (e) { return ''; }
  }

  async function makeLink(chId, text, list) {
    var uid = Cloud.user.uid;
    var postId = firebase.firestore().collection('sns_posts').doc().id;
    var use = list.slice(0, LINK_MAX);
    var urls = [], paths = [], kinds = [];
    var reused = 0;
    for (var i = 0; i < use.length; i++) {
      if (typeof setProg === 'function') setProg((i / use.length) * 100, '사진 준비 중 ' + (i + 1) + '/' + use.length);
      // ① 서버에 이미 있으면 그대로 쓴다(업로드도 삭제도 안 함)
      var have = await existingUrl(use[i]);
      if (have) { urls.push(have); kinds.push(use[i].kind || 'etc'); reused++; continue; }
      // ② 없으면 그때만 올린다 — 이건 24시간 뒤 지운다
      var r = null;
      try { r = await Gallery.resolvePhoto(use[i].p); } catch (e) {}
      var b = await toBlob(r);
      if (!b || !b.size) continue;
      b = await shrink(b, 1280, 0.82);
      /* 경로에 uid 를 넣어야 '남의 링크에 사진을 끼워 넣기'를 규칙으로 막을 수 있다 */
      var path = 'snsPosts/' + uid + '/' + postId + '/' + String(i + 1).padStart(2, '0') + '.jpg';
      try {
        await firebase.storage().ref(path).put(b, { contentType: 'image/jpeg', cacheControl: 'public,max-age=86400' });
        urls.push(await firebase.storage().ref(path).getDownloadURL());
        paths.push(path);
        /* ★ 2026-08-26 종류를 같이 넘겨야 페이지가 '(사진: 작업 전)' 자리에 맞는 사진을 넣을 수 있다 */
        kinds.push(use[i].kind || 'etc');
      } catch (e) { console.warn('[SnsShare] 업로드 실패', path, e && (e.code || e.message)); }
      await new Promise(function (res) { setTimeout(res, 0); });
    }
    if (!urls.length) throw new Error('사진을 하나도 올리지 못했습니다');

    var expMs = Date.now() + LINK_TTL_MS;
    await firebase.firestore().collection('sns_posts').doc(postId).set({
      uid: uid, ch: chId || 'naver', text: String(text || ''),
      photos: urls, paths: paths, kinds: kinds,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      expiresAt: firebase.firestore.Timestamp.fromMillis(expMs)
    });
    return { url: POST_BASE + '?id=' + postId, exp: expMs, n: urls.length, reused: reused, skipped: list.length - use.length };
  }

  function showLink(res) {
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:2500;display:flex;' +
      'align-items:flex-start;justify-content:center;padding:40px 16px 16px;overflow-y:auto;';
    ov.innerHTML = '<div style="background:var(--sf);border-radius:14px;padding:18px;max-width:440px;width:100%;">' +
      '<div style="font-size:16px;font-weight:800;margin-bottom:4px;">💻 PC용 링크를 만들었어요</div>' +
      '<div style="font-size:12px;color:var(--mu);margin-bottom:10px;line-height:1.6;">사진 ' + res.n + '장이 글과 함께 담겼습니다.' +
        (res.reused > 0 ? ' (' + res.reused + '장은 이미 서버에 있어 다시 올리지 않았어요)' : '') +
        (res.skipped > 0 ? ' (한 링크에 ' + LINK_MAX + '장까지 — 뒤 ' + res.skipped + '장은 빠졌어요)' : '') + '</div>' +
      '<div style="border:1px solid var(--bd);border-radius:10px;padding:10px 12px;font-size:12px;' +
        'word-break:break-all;line-height:1.6;background:var(--sf2);">' + esc(res.url) + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:10px;">' +
        '<button class="btn b-blue" id="snsLinkCopy" style="flex:2;justify-content:center;">📋 링크 복사</button>' +
        '<button class="btn b-ghost" id="snsLinkSend" style="flex:2;justify-content:center;">보내기</button>' +
      '</div>' +
      '<ol style="font-size:12px;color:var(--tx);line-height:1.9;margin:14px 0 0 18px;padding:0;">' +
        '<li>이 링크를 <b>PC에서</b> 여세요 (카톡으로 나에게 보내면 편해요)</li>' +
        '<li>페이지의 <b>글+사진 전체 복사</b>를 누르세요</li>' +
        '<li>네이버 블로그 글쓰기 본문에 <b>Ctrl+V</b> — 사진까지 한 번에 들어갑니다</li>' +
      '</ol>' +
      '<div style="border:1.5px solid var(--wn);background:rgba(240,180,41,.12);border-radius:10px;padding:10px 12px;margin-top:12px;">' +
        '<div style="font-size:12px;color:var(--tx);line-height:1.6;">⏳ 링크는 <b>24시간 뒤 자동으로 사라집니다</b>' +
        ' (' + new Date(res.exp).toLocaleString('ko-KR') + ').<br>주소를 아는 사람은 누구나 볼 수 있으니 아무 데나 올리지 마세요.' +
        ' 붙여넣고 나면 사진은 네이버 쪽에 남으니 지워져도 괜찮습니다.</div>' +
      '</div>' +
      '<button class="btn b-ghost" id="snsLinkClose" style="width:100%;justify-content:center;margin-top:12px;">닫기</button>' +
      '</div>';
    document.body.appendChild(ov);
    var close = function () { if (ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('#snsLinkClose').onclick = close;
    ov.querySelector('#snsLinkCopy').onclick = function () {
      toast(copyText(res.url) ? '링크를 복사했습니다' : '복사 실패 — 주소를 길게 눌러 복사해주세요', copyText(res.url) ? 'ok' : 'err');
    };
    ov.querySelector('#snsLinkSend').onclick = function () {
      var S = _Share();
      if (!S) { toast('공유를 쓸 수 없습니다 — 링크를 복사해 보내주세요', 'err'); return; }
      S.share({ title: '블로그에 붙여넣기', text: res.url, dialogTitle: '링크 보내기' }).catch(function () {});
    };
  }

  /* PC 링크 모드 진입 — 사진 선택 없이 '보이는 순서 전체'를 담는다 */
  function openPc(chId, text) {
    /* ★ 2026-08-31 무료 5회 블로그 글쓰기 안에서는 PC 링크도 열어준다 — snsShare 로 분리
         (share 는 팀 참여·일정공유 전용, 이거까지 같이 열리면 안 됨) */
    if (window.Subs && !Subs.gateFeature('snsShare', 'PC로 올리기',
        'PC로 올리기는 구독 사용자 전용 기능입니다.')) return;
    if (!loggedIn()) { toast('PC 링크를 만들려면 먼저 로그인해주세요', 'err'); return; }
    if (typeof firebase === 'undefined' || !firebase.storage) { toast('네트워크 기능을 불러오지 못했습니다', 'err'); return; }
    var all = collect();
    if (!all.length) { toast('이 작업에 사진이 없습니다 — 글만 복사해 쓰세요', 'err'); return; }

    (async function () {
      try {
        if (typeof showOverlay === 'function') showOverlay('PC용 링크 만드는 중...');
        var res = await makeLink(chId, text, all);
        if (typeof hideOverlay === 'function') hideOverlay();
        showLink(res);
        try { window.Review && Review.maybeAskSoon('sns-pc', 2500); } catch (e2) {}
      } catch (e) {
        if (typeof hideOverlay === 'function') hideOverlay();
        toast('링크 만들기 실패: ' + ((e && (e.message || e.code)) || ''), 'err');
      }
    })();
  }

  window.SnsShare = {
    available: available,
    open: open,
    openPc: openPc,
    canPc: function () { return loggedIn(); },
    collect: collect,
    CH: CH
  };
  console.log('[SnsShare] 로드됨, 사용가능:', available());
})();
