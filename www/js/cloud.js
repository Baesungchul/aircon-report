/* ═══════════════════════════════════════════════
   CLOUD ─ 로그인 / 계정 (Firebase Auth + Firestore)
   - 옵트인: 기존 앱은 그대로 동작. 설정 → "일정 공유"에서만 진입.
   - config 미입력 또는 SDK 미로드 시 자동 비활성(앱에 영향 없음).
   ※ 일정 동기화/공유는 다음 모듈(cloud_sync / cloud_share)에서 추가.
═══════════════════════════════════════════════ */
(function () {
  'use strict';

  window.Cloud = window.Cloud || {};
  Cloud.ready = false;     // Firebase 초기화 성공 여부
  Cloud.user  = null;      // 로그인된 사용자 (firebase user)
  var _prevUid = null;     // ★ 2026-08-30 '로그아웃→로그인' 전환을 가려내려고 기억한다
  Cloud.auth  = null;
  Cloud.db    = null;

  /* ★ 2026-08-31 로그인 세션 "복원 완료" 신호 — AI 글쓰기 등에서 Cloud.user 를 읽기 전에
       기다리는 용도. 앱을 막 연 직후엔 Firebase 가 저장된 로그인 세션을 아직 복원 중일 수
       있어서, 그 사이 Cloud.user 는 실제로는 로그인된 사용자인데도 null 이다. 이 시점에
       AI 요청을 보내면 인증 헤더가 빠져서 서버가 401(로그인 필요)로 거부한다 — 실사용자가
       "로그인했는데 로그인 오류가 뜬다"고 보고한 원인 중 하나. onAuthStateChanged 가 처음
       호출되는 순간(로그인 여부와 무관하게) 또는 Firebase 초기화 자체가 실패하는 순간
       한 번만 풀린다. */
  var _authReadyResolve;
  Cloud.authReadyPromise = new Promise(function (resolve) { _authReadyResolve = resolve; });

  // ── 토스트(있으면 사용, 없으면 alert) ──────────────
  function toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'ok');
    else alert(msg);
  }

  // ── config 유효성 검사 ─────────────────────────────
  function configValid() {
    var c = window.FIREBASE_CONFIG;
    if (!c) return false;
    var keys = ['apiKey', 'authDomain', 'projectId', 'appId'];
    for (var i = 0; i < keys.length; i++) {
      var v = c[keys[i]];
      if (!v || String(v).indexOf('PASTE_') === 0) return false;
    }
    return true;
  }

  // ── Firebase 초기화 ────────────────────────────────
  function initFirebase() {
    if (typeof firebase === 'undefined' || !firebase.initializeApp) {
      console.warn('[Cloud] Firebase SDK 미로드 - 클라우드 기능 비활성');
      _authReadyResolve();   // ★ 기다리는 쪽이 무한 대기하지 않도록
      return false;
    }
    if (!configValid()) {
      console.warn('[Cloud] firebase_config.js 미설정 - 클라우드 기능 비활성');
      _authReadyResolve();
      return false;
    }
    try {
      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(window.FIREBASE_CONFIG);
      }
      Cloud.auth = firebase.auth();
      Cloud.db   = firebase.firestore();
      // ★ WebView/프록시 환경에서 Firestore 스트리밍 안정화 (반드시 사용 전에 호출)
      try { Cloud.db.settings({ experimentalAutoDetectLongPolling: true }); } catch (e) {}
      // 오프라인 캐시(텍스트라 가벼움)
      try { Cloud.db.enablePersistence({ synchronizeTabs: true }); } catch (e) {}
      Cloud.ready = true;
      Cloud.auth.onAuthStateChanged(function (u) {
        _authReadyResolve();   // ★ 세션 복원 완료(로그인 여부와 무관하게 신호만) — 여러 번 불러도 무해
        var _wasOut = !_prevUid;
        Cloud.user = u || null;
        _prevUid = u ? u.uid : null;
        if (u) ensureProfile(u);
        updateUI();
        /* ★ 2026-08-30 로그인에 성공하면 로그인 창을 닫는다.
             ☠️ 그 전에는 성공해도 창이 그대로 떠 있어서, 온보딩의 '다음 →' 버튼을 가렸다.
                사용자에게는 위쪽 X 말고 나갈 길이 없어 보였다(실사용 제보).
             ⭐ 여기 한 곳만 고치면 이 창을 여는 여섯 군데가 모두 해결된다 —
                온보딩 4곳 · 요금제 로그인 유도(subscription) · 서버복구(backup).
             ⚠️ '로그아웃 → 로그인' 전환일 때만 닫는다. 이미 로그인한 채로 계정 정보를
                보려고 연 경우까지 닫아버리지 않도록. (앱 시작 시 자동 로그인도 이 가지를
                지나지만 그땐 창이 안 열려 있어 아무 일도 일어나지 않는다)
             ⚠️ 설정 화면은 mountInline 이라 'open' 클래스를 쓰지 않는다 — 영향 없다.
             ⚠️ 아래 이벤트 통지보다 **먼저** 닫는다. 온보딩이 그 이벤트로 화면을 다시 그리는데,
                창이 남아 있으면 새로 그린 '다음' 버튼이 또 가려진다. */
        if (u && _wasOut) { try { closeModal(); } catch (e) {} }
        // 로그인 상태 변화를 다른 모듈에 알림 (단, 다른 계정 로그인 감지 시엔 자동 동기화를 건너뛴다)
        if (u) { _checkLocalOwner(u); }
        else { document.dispatchEvent(new CustomEvent('cloud-auth-changed', { detail: { user: null } })); }
      });
      console.log('[Cloud] 초기화 완료');
      return true;
    } catch (e) {
      console.error('[Cloud] 초기화 실패:', e);
      return false;
    }
  }

  // ── 사용자 프로필 생성/갱신 ────────────────────────
  function ensureProfile(user, displayName) {
    if (!Cloud.db || !user) return Promise.resolve();
    var ref = Cloud.db.collection('users').doc(user.uid);
    var data = {
      email: user.email || '',
      shareCode: (user.email || '').toLowerCase(),  // 상대가 나를 찾는 키
      lastActiveAt: firebase.firestore.FieldValue.serverTimestamp(),  // 비활성 계정 정리 기준(6개월 미접속 시 서버 정리)
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (displayName) data.displayName = displayName;
    return ref.set(
      Object.assign({ sharedWith: [], createdAt: firebase.firestore.FieldValue.serverTimestamp() }, data),
      { merge: true }
    ).catch(function (e) { console.warn('[Cloud] 프로필 저장 실패:', e); });
  }

  // ── 에러 메시지 한글화 ─────────────────────────────
  function errMsg(e) {
    var code = (e && e.code) || '';
    var map = {
      'auth/invalid-email': '이메일 형식이 올바르지 않습니다.',
      'auth/user-not-found': '등록되지 않은 이메일입니다.',
      'auth/wrong-password': '비밀번호가 일치하지 않습니다.',
      'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다.',
      'auth/email-already-in-use': '이미 가입된 이메일입니다.',
      'auth/weak-password': '비밀번호는 6자 이상이어야 합니다.',
      'auth/network-request-failed': '네트워크 연결을 확인해주세요.',
      'auth/too-many-requests': '잠시 후 다시 시도해주세요.'
    };
    return map[code] || (e && e.message) || '오류가 발생했습니다.';
  }

  // ── 인증 동작 ──────────────────────────────────────
  Cloud.signUp = function (email, pw, displayName) {
    if (!Cloud.ready) { toast('클라우드가 설정되지 않았습니다.', 'err'); return; }
    return Cloud.auth.createUserWithEmailAndPassword(email.trim(), pw)
      .then(function (cred) {
        var u = cred.user;
        var p = u.updateProfile ? u.updateProfile({ displayName: displayName || '' }) : Promise.resolve();
        return p.then(function () { return ensureProfile(u, displayName); });
      })
      .then(function () { toast('가입 완료! 자동 로그인되었습니다.', 'ok'); })
      .catch(function (e) { toast(errMsg(e), 'err'); throw e; });
  };

  Cloud.signIn = function (email, pw) {
    if (!Cloud.ready) { toast('클라우드가 설정되지 않았습니다.', 'err'); return; }
    return Cloud.auth.signInWithEmailAndPassword(email.trim(), pw)
      .then(function () { toast('로그인되었습니다.', 'ok'); })
      .catch(function (e) { toast(errMsg(e), 'err'); throw e; });
  };

  // ── 구글 로그인 ────────────────────────────────────
  //   네이티브: @capgo/capacitor-social-login(SocialLogin)으로 idToken 받아 Firebase credential 로그인
  //   웹: signInWithPopup 폴백 (WebView에선 구글이 막을 수 있음)
  Cloud.signInWithGoogle = function () {
    if (!Cloud.ready) { toast('클라우드가 설정되지 않았습니다.', 'err'); return Promise.reject(new Error('not ready')); }

    var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    var SL = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SocialLogin;
    var WEB_CLIENT_ID = '370264394871-3oba6d734etlu6qu4so98rilb2uhf2c1.apps.googleusercontent.com';

    if (isNative) {
      if (!SL || !SL.login) {
        toast('구글 로그인 준비가 필요합니다. (플러그인 설치 후 재빌드)', 'err');
        return Promise.reject(new Error('SocialLogin plugin missing'));
      }
      var initP = Cloud._slInited
        ? Promise.resolve()
        : SL.initialize({ google: { webClientId: WEB_CLIENT_ID } }).then(function () { Cloud._slInited = true; });
      return initP.then(function () {
        return SL.login({ provider: 'google' });  // scopes 미지정: 기본 프로필·이메일 포함(MainActivity 수정 불필요)
      }).then(function (res) {
        var r = (res && res.result) || {};
        var idToken = r.idToken;
        var accessToken = r.accessToken && r.accessToken.token;
        if (!idToken) throw new Error('구글 토큰을 받지 못했습니다.');
        var cred = firebase.auth.GoogleAuthProvider.credential(idToken, accessToken);
        return Cloud.auth.signInWithCredential(cred);
      }).then(function () {
        toast('구글 계정으로 로그인되었습니다.', 'ok');
      }).catch(function (e) {
        /* ★ 2026-08-30 버그수정 — "로그인창은 뜨는데 이후 에러 없이 아무 반응 없음".
             예전엔 메시지에 cancel/closed/popup/12501 이 '들어만 있어도' 통째로 무시했다.
             그런데 SocialLogin 플러그인은 실패 사유를 전부 "Google Sign-In failed: ..." 로
             묶어서 던지는데, 그 안에 우연히 저 단어가 섞이면(예: 팝업 관련 안내 문구) 진짜 오류도
             조용히 삼켜져 사용자는 창만 닫히고 아무 설명도 못 봤다.
             → 콘솔엔 항상 원본 오류를 남기고, '사용자가 취소함'은 플러그인이 주는
                코드(USER_CANCELLED)로만 판정한다. */
        console.warn('[Cloud] 구글 로그인 실패', (e && e.code) || '', (e && e.message) || '', e);
        var code = (e && e.code) || '';
        var msg = (e && (e.message || e.error || '')) + '';
        if (code === 'USER_CANCELLED' || /cancelled by user|popup-closed-by-user|cancelled-popup-request/i.test(msg)) return;
        toast(errMsg(e), 'err'); throw e;
      });
    }

    // 웹 폴백
    var provider = new firebase.auth.GoogleAuthProvider();
    return Cloud.auth.signInWithPopup(provider)
      .then(function () { toast('구글 계정으로 로그인되었습니다.', 'ok'); })
      .catch(function (e) {
        var msg = (e && e.code) || '';
        if (msg === 'auth/popup-closed-by-user' || msg === 'auth/cancelled-popup-request') return;
        toast(errMsg(e), 'err'); throw e;
      });
  };

  /* ★ 2026-08-31 로그아웃 시 안내 — 로컬 데이터는 지워지지 않고 남는다는 것과,
       다른 계정으로 로그인했을 때 실제로 일어나는 일을 미리 알려준다.
       ⚠️ '자동 삭제'라고는 적지 않는다 — 로그아웃 자체는 삭제를 하지 않기 때문에,
          사실과 다른 경고문은 오히려 신뢰를 깎는다. 실제 삭제는 '다른 계정으로 로그인한
          순간'(아래 _checkLocalOwner)에 사용자가 원할 때만 그 자리에서 이뤄진다. */
  function _hasLocalData() {
    return (async function () {
      try {
        if (typeof window.getWorkIndex === 'function') {
          var idx = await window.getWorkIndex();
          if (idx && Array.isArray(idx.works) && idx.works.length) return true;
        }
      } catch (e) {}
      try { if (JSON.parse(localStorage.getItem('ac_reminders_v1') || '[]').length) return true; } catch (e) {}
      return false;
    })();
  }
  async function _warnBeforeSignOut() {
    try {
      if (await _hasLocalData()) {
        alert('ℹ️ 로그아웃해도 이 기기에 저장된 일정·고객 데이터는 지워지지 않고 그대로 남습니다.\n\n' +
              '나중에 다른 계정으로 로그인하면, 이 데이터가 그 계정 것이 아니라는 걸 감지해서 자동 동기화를 건너뛰고, 그 자리에서 삭제할지 남겨둘지 물어봅니다.\n\n' +
              '다른 사람이 이 기기를 쓸 예정이라면, 다음 로그인 때 뜨는 안내에서 "이전 데이터 삭제"를 선택하면 됩니다.');
      }
    } catch (e) {}
  }

  /* ★ 2026-08-31 다른 계정 로그인 시 로컬 데이터(사진·일정) 유출 방지
       문제: 로그아웃은 Firebase 세션만 끊고 로컬 데이터(폰에 저장된 작업기록)는 그대로 둔다.
       그 상태에서 '다른' 계정으로 로그인하면, cloud_sync.js 가 로그인 1.5초 뒤 자동으로
       로컬 데이터를 그 계정 서버로 올려버린다 — 이전 사용자의 고객정보가 다른 계정에 섞여 들어간다.
       또한 화면(작업 목록·달력)에도 이전 사용자의 데이터가 그대로 보인다.
       대응: 이 기기의 로컬 데이터가 '누구 것'인지(ac_local_owner_uid) 기억해두고,
       로그인한 계정이 그 사람과 다르면:
         1) 자동 동기화를 일단 막고,
         2) "이전 데이터를 삭제하고 새로 시작할지" 그 자리에서 confirm으로 물어본다.
       [확인] → 이미 검증된 삭제 primitive(폴더 removeEntry + purgeWorkEverywhere)를
                재사용해 실제로 지운다 (클라우드에는 손대지 않음 — cloud:false).
       [취소] → 기존과 동일하게 동기화만 건너뛰고 데이터는 남겨둔다(안내 문구 표시).
       같은 사람 재로그인이거나 이 기기에 기록된 주인이 아직 없으면(첫 로그인) 평소처럼 조용히 진행. */
  var LOCAL_OWNER_KEY = 'ac_local_owner_uid';

  // 이미 검증된 삭제 primitive 재사용 (dialogs.js의 deleteDateFolder, calendar.js의
  // purgeWorkEverywhere와 동일한 방식) — 새 삭제 로직을 만들지 않는다.
  async function _purgeMismatchedLocalData() {
    try {
      if (typeof photoFolderHandle === 'undefined' || !photoFolderHandle) {
        alert('저장 폴더가 연결되어 있지 않아 삭제할 항목이 없습니다.');
        return true;
      }
      try {
        var perm = await photoFolderHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') perm = await photoFolderHandle.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') { alert('쓰기 권한이 거부되어 삭제할 수 없습니다.'); return false; }
      } catch (e) { alert('권한 확인 실패: ' + (e && e.message)); return false; }

      var idx = null;
      try { idx = await window.getWorkIndex(); } catch (e) {}
      var works = (idx && Array.isArray(idx.works)) ? idx.works : [];

      var failed = [];
      for (var i = 0; i < works.length; i++) {
        var name = works[i] && (works[i].folderName || works[i].name || works[i].workId);
        if (!name) continue;
        var deleted = false;
        try {
          await photoFolderHandle.removeEntry(name, { recursive: true });
          deleted = true;
        } catch (e1) {
          try {
            var dh = await photoFolderHandle.getDirectoryHandle(name);
            if (typeof deleteDirectoryContents === 'function') await deleteDirectoryContents(dh);
            await photoFolderHandle.removeEntry(name);
            deleted = true;
          } catch (e2) { /* 아래에서 failed 처리 */ }
        }
        if (!deleted) { failed.push(name); continue; }
        try { if (typeof window.purgeWorkEverywhere === 'function') await window.purgeWorkEverywhere(name, { cloud: false }); }
        catch (e3) {}
      }

      try { if (window.Reminders && Reminders.clearAll) await Reminders.clearAll(); } catch (e) {}
      try { if (typeof invalidateWorkIndex === 'function') invalidateWorkIndex(); } catch (e) {}
      try { if (typeof rebuildIndexFromFolders === 'function') await rebuildIndexFromFolders(); } catch (e) {}
      try { if (typeof window.__calendarRefresh === 'function') window.__calendarRefresh(); } catch (e) {}

      if (failed.length) {
        alert('일부 항목(' + failed.length + '개)은 삭제하지 못했습니다.\n설정 > 작업기록 재생성 후, 남은 항목은 목록에서 직접 삭제해주세요.');
      } else {
        alert('✅ 이전 데이터 삭제가 완료되었습니다. 이제부터는 이 계정 데이터만 사용됩니다.');
      }
      return true;
    } catch (e) {
      alert('삭제 중 오류가 발생했습니다: ' + (e && e.message));
      return false;
    }
  }

  async function _checkLocalOwner(u) {
    var owner = null;
    try { owner = localStorage.getItem(LOCAL_OWNER_KEY); } catch (e) {}
    var hasData = false;
    try { hasData = await _hasLocalData(); } catch (e) {}
    var mismatch = !!(owner && owner !== u.uid && hasData);
    if (!mismatch) {
      try { localStorage.setItem(LOCAL_OWNER_KEY, u.uid); } catch (e) {}
      document.dispatchEvent(new CustomEvent('cloud-auth-changed', { detail: { user: u } }));
      return;
    }
    console.warn('[Cloud] 다른 계정 로그인 감지 (기존 주인:', owner, '새 계정:', u.uid + ')');

    var wantsDelete = false;
    try {
      wantsDelete = confirm(
        '⚠️ 이 기기에는 다른 계정으로 저장된 일정·고객 데이터가 남아있습니다.\n\n' +
        '이전 데이터를 삭제하고 이 계정으로 새로 시작할까요?\n\n' +
        '[확인] 이전 데이터 삭제 후 계속\n' +
        '[취소] 일단 보류 (자동 동기화만 건너뛰고 데이터는 남겨둠)\n\n' +
        '※ 이 데이터가 사실 내 것이라면 [취소]를 누르고, 설정 화면의 "지금 동기화" 버튼을 이용해주세요.'
      );
    } catch (e) {}

    if (wantsDelete) {
      await _purgeMismatchedLocalData();
      try { localStorage.setItem(LOCAL_OWNER_KEY, u.uid); } catch (e) {}
      document.dispatchEvent(new CustomEvent('cloud-auth-changed', { detail: { user: u } }));
      return;
    }

    try {
      alert('⚠️ 이전 데이터를 남겨두었습니다.\n\n' +
            '실수로 다른 사람 데이터가 이 계정 클라우드에 올라가지 않도록 자동 동기화를 건너뛰었습니다.\n\n' +
            '이 데이터가 내 것이 맞다면 설정 > 로그인/계정 화면의 "지금 동기화" 버튼을 눌러주세요.\n' +
            '내 것이 아니라면 각 작업을 열어 직접 삭제하거나, 앱을 삭제 후 다시 설치해 새로 시작해주세요.');
    } catch (e) {}
    try { localStorage.setItem(LOCAL_OWNER_KEY, u.uid); } catch (e) {}
    document.dispatchEvent(new CustomEvent('cloud-auth-changed', { detail: { user: u, skipAutoSync: true } }));
  }

  Cloud.signOut = function () {
    if (!Cloud.ready) return;
    return Promise.resolve(_warnBeforeSignOut()).then(function () {
      return Cloud.auth.signOut().then(function () { toast('로그아웃되었습니다.', 'ok'); });
    });
  };

  Cloud.resetPw = function (email) {
    if (!Cloud.ready) { toast('클라우드가 설정되지 않았습니다.', 'err'); return; }
    if (!email) { toast('이메일을 먼저 입력해주세요.', 'err'); return; }
    return Cloud.auth.sendPasswordResetEmail(email.trim())
      .then(function () { toast('비밀번호 재설정 메일을 보냈습니다.', 'ok'); })
      .catch(function (e) { toast(errMsg(e), 'err'); });
  };

  // ── 모달 UI (기존 .co-modal 스타일 재사용) ─────────
  function buildModal() {
    if (document.getElementById('cloudModal')) return;
    var m = document.createElement('div');
    m.className = 'co-modal';
    m.id = 'cloudModal';
    m.innerHTML =
      '<div class="co-box" style="max-width:440px;">' +
        '<div class="co-head">' +
          '<div class="co-head-title">☁️ 로그인 / 일정 공유</div>' +
          '<button class="btn b-ghost b-xs" id="cloudClose">✕</button>' +
        '</div>' +
        '<div class="co-body" id="cloudBody" style="padding:16px;">' +
          // 로그아웃 상태
          '<div id="cloudAuthBox">' +
            '<div id="cloudTabs" style="display:flex;gap:6px;margin-bottom:12px;">' +
              '<button class="btn b-blue" id="cloudTabLogin" style="flex:1;justify-content:center;">로그인</button>' +
              '<button class="btn b-ghost" id="cloudTabSignup" style="flex:1;justify-content:center;">회원가입</button>' +
            '</div>' +
            '<input class="co-input" id="cloudEmail" type="email" placeholder="이메일" autocomplete="username" style="margin-bottom:8px;">' +
            '<input class="co-input" id="cloudPw" type="password" placeholder="비밀번호 (6자 이상)" autocomplete="current-password" style="margin-bottom:8px;">' +
            '<input class="co-input" id="cloudName" type="text" placeholder="표시 이름 (상호/이름)" style="margin-bottom:8px;display:none;">' +
            '<button class="btn b-blue" id="cloudSubmit" style="width:100%;justify-content:center;">로그인</button>' +
            '<button class="btn b-ghost" id="cloudForgot" style="width:100%;justify-content:center;margin-top:6px;font-size:12px;">비밀번호를 잊으셨나요?</button>' +
            '<div style="display:flex;align-items:center;gap:8px;margin:14px 0 10px;color:var(--mu);font-size:12px;">' +
              '<span style="flex:1;height:1px;background:var(--bd);"></span>또는<span style="flex:1;height:1px;background:var(--bd);"></span>' +
            '</div>' +
            '<button class="btn b-ghost" id="cloudGoogle" style="width:100%;justify-content:center;gap:8px;">🔵 Google로 로그인</button>' +
            '<div style="margin-top:14px;padding:10px;background:var(--sf2);border-radius:8px;font-size:11px;color:var(--mu);line-height:1.6;">' +
              'ℹ️ 클라우드 저장·공유는 유료 구독 기능입니다. 구독을 해지하면 <b>6개월간 미구독 상태가 지속될 경우</b> 클라우드에 저장된 사진·일정이 삭제될 수 있습니다(삭제 30일 전 안내). 구독 중에는 계속 보관됩니다. 가입 시 이 정책에 동의하는 것으로 간주됩니다.' +
            '</div>' +
          '</div>' +
          // 로그인 상태
          '<div id="cloudAcctBox" style="display:none;">' +
            '<div style="background:var(--sf2);border-radius:8px;padding:12px;margin-bottom:12px;font-size:13px;line-height:1.7;">' +
              '<div>👤 <b id="cloudAcctName"></b></div>' +
              '<div style="color:var(--mu);" id="cloudAcctEmail"></div>' +
            '</div>' +
            '<div id="cloudShareArea" style="font-size:13px;color:var(--mu);text-align:center;padding:10px 0;">일정 공유 기능은 곧 추가됩니다.</div>' +
            '<div id="cloudTeamArea"></div>' +
            '<div style="margin-top:10px;font-size:11px;color:var(--mu);line-height:1.6;">ℹ️ 구독 해지 후 6개월간 미구독 상태가 지속되면 클라우드 데이터가 삭제될 수 있습니다(삭제 30일 전 안내).</div>' +
            '<button class="btn b-ghost" id="cloudSyncNow" style="width:100%;justify-content:center;margin-top:8px;">🔄 지금 동기화</button>' +
            '<button class="btn b-red" id="cloudLogout" style="width:100%;justify-content:center;margin-top:8px;">로그아웃</button>' +
            '<button class="btn b-ghost" id="cloudDeleteAcct" style="width:100%;justify-content:center;margin-top:8px;font-size:11px;color:#d9534f;">🗑 계정·데이터 삭제</button>' +
          '</div>' +
          // 미설정 안내
          '<div id="cloudDisabledBox" style="display:none;font-size:13px;color:var(--mu);line-height:1.7;">' +
            '⚠️ 클라우드가 아직 설정되지 않았습니다.<br>Firebase 프로젝트 생성 후 설정값을 입력하면 활성화됩니다.' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(m);

    var mode = 'login';
    function setMode(mm) {
      mode = mm;
      var login = mm === 'login';
      document.getElementById('cloudTabLogin').className = 'btn ' + (login ? 'b-blue' : 'b-ghost');
      document.getElementById('cloudTabSignup').className = 'btn ' + (login ? 'b-ghost' : 'b-blue');
      document.getElementById('cloudTabLogin').style.flex = '1';
      document.getElementById('cloudTabSignup').style.flex = '1';
      document.getElementById('cloudName').style.display = login ? 'none' : '';
      document.getElementById('cloudSubmit').textContent = login ? '로그인' : '회원가입';
      document.getElementById('cloudForgot').style.display = login ? '' : 'none';
    }
    document.getElementById('cloudTabLogin').onclick = function () { setMode('login'); };
    document.getElementById('cloudTabSignup').onclick = function () { setMode('signup'); };
    document.getElementById('cloudClose').onclick = closeModal;
    document.getElementById('cloudModal').addEventListener('click', function (e) {
      if (e.target === this) closeModal();
    });
    document.getElementById('cloudSubmit').onclick = function () {
      var email = document.getElementById('cloudEmail').value;
      var pw = document.getElementById('cloudPw').value;
      var name = document.getElementById('cloudName').value;
      if (!email || !pw) { toast('이메일과 비밀번호를 입력해주세요.', 'err'); return; }
      var btn = this; btn.disabled = true;
      var done = function () { btn.disabled = false; };
      if (mode === 'login') Cloud.signIn(email, pw).then(done, done);
      else Cloud.signUp(email, pw, name).then(done, done);
    };
    document.getElementById('cloudForgot').onclick = function () {
      Cloud.resetPw(document.getElementById('cloudEmail').value);
    };
    var gBtn = document.getElementById('cloudGoogle');
    if (gBtn) gBtn.onclick = function () {
      var b = this; b.disabled = true;
      var done = function () { b.disabled = false; };
      Cloud.signInWithGoogle().then(done, done);
    };
    document.getElementById('cloudLogout').onclick = function () { Cloud.signOut(); };
    var _syncBtn = document.getElementById('cloudSyncNow');
    if (_syncBtn) _syncBtn.onclick = function () {
      if (!(window.CloudSync && CloudSync.fullSync)) { toast('동기화 기능을 불러오지 못했습니다.', 'err'); return; }
      var b = this; b.disabled = true; toast('동기화 중...', 'ok');
      CloudSync.fullSync().then(function () { b.disabled = false; toast('동기화 완료', 'ok'); },
                                 function (e) { b.disabled = false; toast('동기화 실패: ' + ((e && e.message) || ''), 'err'); });
    };
    var _delBtn = document.getElementById('cloudDeleteAcct');
    if (_delBtn) _delBtn.onclick = function () { Cloud.requestAccountDeletion(); };
  }

  // ── 계정·데이터 삭제 요청 (실제 삭제/공유 이관은 서버 Cloud Function이 처리) ──
  Cloud.requestAccountDeletion = function () {
    if (!Cloud.ready || !Cloud.db) { toast('클라우드가 준비되지 않았습니다.', 'err'); return; }
    if (!Cloud.user) { toast('먼저 로그인해주세요.', 'err'); return; }
    if (!confirm('계정과 클라우드에 저장된 모든 사진·일정의 삭제를 요청합니다.\n\n· 공유 중인 사진은 상대에게 안내/이관 후 삭제됩니다.\n· 처리에는 다소 시간이 걸릴 수 있습니다.\n\n계속할까요?')) return;
    if (!confirm('정말 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) return;
    var ref = Cloud.db.collection('users').doc(Cloud.user.uid);
    ref.set({
      deletionRequestedAt: firebase.firestore.FieldValue.serverTimestamp(),
      deletionRequestedBy: Cloud.user.uid
    }, { merge: true }).then(function () {
      toast('삭제 요청이 접수되었습니다. 곧 처리됩니다.', 'ok');
      return Cloud.signOut();
    }).catch(function (e) {
      toast('삭제 요청 실패: ' + ((e && e.code) || e), 'err');
    });
  };

  function closeModal() {
    var m = document.getElementById('cloudModal');
    if (m) m.classList.remove('open');
  }

  // 인라인(설정 화면)으로 옮겨간 본문(#cloudBody)을 다시 모달로 복귀
  //  ★ 설정 화면이 본문을 가져가면 모달 내부엔 없으므로 id로 문서 전체에서 찾아 되돌린다
  //    (예전엔 m.querySelector('.co-body')로 모달 내부만 찾아 → 못 찾으면 헤더만 뜨고 본문이 빈 화면이 됨)
  function _restoreBodyToModal() {
    var m = document.getElementById('cloudModal'); if (!m) return;
    var coBox = m.querySelector('.co-box');
    var body = document.getElementById('cloudBody');
    if (coBox && body && body.parentNode !== coBox) { body.style.padding = '16px'; coBox.appendChild(body); }
    var head = m.querySelector('.co-head'); if (head) head.style.display = '';
  }
  Cloud.openModal = function () {
    buildModal();
    _restoreBodyToModal();
    updateUI();
    var m = document.getElementById('cloudModal');
    m.classList.add('open');
  };
  window.openCloudModal = Cloud.openModal;

  // 설정 화면에 로그인/공유 UI를 인라인으로 표시 (중간 모달 없이 바로)
  Cloud.mountInline = function (host) {
    if (!host) return;
    buildModal();
    var m = document.getElementById('cloudModal');
    var body = document.getElementById('cloudBody');
    if (body && body.parentNode !== host) { body.style.padding = '0'; host.appendChild(body); }
    var head = m ? m.querySelector('.co-head') : null; if (head) head.style.display = 'none';
    updateUI();
  };

  // ── UI 갱신 ────────────────────────────────────────
  function updateUI() {
    // 설정 화면 요약 라벨
    var lbl = document.getElementById('cloudSetLabel');
    if (lbl) {
      if (!Cloud.ready) lbl.textContent = '설정 필요';
      else if (Cloud.user) {
        var _pc = 0;
        try { if (window.CloudShare && CloudShare.getSharedPartnerUids) _pc = CloudShare.getSharedPartnerUids().length; } catch (e) {}
        lbl.textContent = (Cloud.user.displayName || Cloud.user.email) + ' (로그인됨' + (_pc > 0 ? ' · 공유 ' + _pc + '명' : '') + ')';
      }
      else lbl.textContent = '로그인하기';
    }
    // 모달 내부
    if (!document.getElementById('cloudModal')) return;
    var authBox = document.getElementById('cloudAuthBox');
    var acctBox = document.getElementById('cloudAcctBox');
    var disBox  = document.getElementById('cloudDisabledBox');
    if (!Cloud.ready) {
      authBox.style.display = 'none'; acctBox.style.display = 'none'; disBox.style.display = '';
      return;
    }
    disBox.style.display = 'none';
    if (Cloud.user) {
      authBox.style.display = 'none'; acctBox.style.display = '';
      document.getElementById('cloudAcctName').textContent = Cloud.user.displayName || '(이름 미설정)';
      document.getElementById('cloudAcctEmail').textContent = Cloud.user.email || '';
      document.dispatchEvent(new CustomEvent('cloud-share-render'));  // 공유 모듈 훅
    } else {
      authBox.style.display = ''; acctBox.style.display = 'none';
    }
  }
  Cloud.updateUI = updateUI;

  // ── 부팅 ───────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    initFirebase();
    updateUI();
    var btn = document.getElementById('cloudSetBtn');
    if (btn) btn.onclick = Cloud.openModal;
  });
})();
