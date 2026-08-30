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
      return false;
    }
    if (!configValid()) {
      console.warn('[Cloud] firebase_config.js 미설정 - 클라우드 기능 비활성');
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
        // 로그인 상태 변화를 다른 모듈에 알림
        document.dispatchEvent(new CustomEvent('cloud-auth-changed', { detail: { user: u } }));
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

  Cloud.signOut = function () {
    if (!Cloud.ready) return;
    return Cloud.auth.signOut().then(function () { toast('로그아웃되었습니다.', 'ok'); });
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
