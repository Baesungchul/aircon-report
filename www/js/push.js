/* ═══════════════════════════════════════════════
   PUSH ─ 채팅 메시지 + 공유 사진 푸시 알림 (FCM, @capacitor/push-notifications)
   - 로그인 시 알림 권한 요청 → FCM 토큰을 users/{uid}.fcmTokens 배열에 저장(여러 기기 지원)
   - 실제 발송은 Cloud Functions(functions/index.js의 onNewChatMessage, onNewSharedPhotoUpload,
     onReuploadRequested, onBorrowedPhotoAdded)가 처리
   - 알림 탭 → 채팅 메시지면 채팅탭+해당 방, 공유 사진이면 그 작업을 작업탭에 바로 열기,
     원본요청/상대가 사진 추가면 내 작업을 바로 열어 자동 처리
═══════════════════════════════════════════════ */
(function () {
  'use strict';
  window.Push = window.Push || {};

  var _inited = false;
  var _lastToken = null;

  function loggedIn(){ return window.Cloud && Cloud.ready && Cloud.user; }
  function db(){ return Cloud.db; }
  function myUid(){ return Cloud.user.uid; }
  function safeId(name){ return String(name||'').replace(/[\/\.\#\$\[\]]/g, '_').slice(0, 200); }
  function PN(){ return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications; }

  function saveToken(token){
    if (!loggedIn() || !token) return;
    _lastToken = token;
    db().collection('users').doc(myUid()).set(
      { fcmTokens: firebase.firestore.FieldValue.arrayUnion(token) },
      { merge: true }
    ).catch(function(e){ console.warn('[Push] 토큰 저장 실패', e); });
  }
  function removeToken(token){
    if (!loggedIn() || !token) return;
    db().collection('users').doc(myUid()).set(
      { fcmTokens: firebase.firestore.FieldValue.arrayRemove(token) },
      { merge: true }
    ).catch(function(){});
  }

  // ── 알림 종류별 on/off (chat / sharedPhoto / borrowedPhoto / reupload) ──
  //    로컬(localStorage)에 즉시 저장 + 로그인 시 서버(users/{uid}.notifPrefs)에도 저장 → Cloud Function이 발송 전 확인
  var PREF_KEYS = ['chat', 'sharedPhoto'];   // 사진류(도착·상대추가·원본요청)는 sharedPhoto 하나로 통합
  Push.PREF_KEYS = PREF_KEYS;
  Push.getPref = function(key){ try { return localStorage.getItem('notifPref_' + key) !== '0'; } catch(e){ return true; } };
  Push.setPref = function(key, on){
    try { localStorage.setItem('notifPref_' + key, on ? '1' : '0'); } catch(e){}
    if (loggedIn()) {
      var np = {}; np[key] = !!on;
      db().collection('users').doc(myUid()).set({ notifPrefs: np }, { merge: true }).catch(function(){});
    }
  };
  Push.syncPrefs = function(){
    if (!loggedIn()) return;
    db().collection('users').doc(myUid()).get().then(function(doc){
      var np = (doc.exists && doc.data().notifPrefs) || {};
      PREF_KEYS.forEach(function(k){
        try { localStorage.setItem('notifPref_' + k, np[k] === false ? '0' : '1'); } catch(e){}
      });
      try { document.dispatchEvent(new CustomEvent('notif-prefs-synced')); } catch(e){}
    }).catch(function(){});
  };

  function doRegister(){
    var p = PN();
    if (!p) return;
    try { p.register(); } catch(e){ console.warn('[Push] register 실패', e); }
  }

  // 공유 사진 알림을 눌렀을 때 - 그 작업을 바로 작업탭에 열어줌 (openInWorkTab 재사용)
  function openSharedPhotoWork(ownerUid, workId){
    if (!loggedIn()) return;
    db().collection('schedules').doc(ownerUid).collection('items').doc(safeId(workId)).get()
      .then(function(doc){
        if (!doc.exists) { if (typeof showToast === 'function') showToast('작업을 찾을 수 없습니다 (삭제되었을 수 있음)', 'err'); return; }
        var itemData = doc.data() || {};
        if (window.CloudPhotoSync && CloudPhotoSync.openInWorkTab) {
          CloudPhotoSync.openInWorkTab(ownerUid, workId, itemData);
        }
      })
      .catch(function(e){ console.warn('[Push] 공유 작업 열기 실패', e); });
  }

  // "원본 요청" / "상대가 사진 추가" 알림을 눌렀을 때 - 내 작업(workId=날짜폴더명)을 바로 열어봄
  // (정상 열기 흐름에서 fulfillReuploadRequest가 자동 실행됨). 폴더를 못 찾으면 기록 탭으로 안내만.
  function openMyWorkForReupload(workId){
    var fallback = function(){
      if (typeof showToast === 'function') showToast('📩 알림이 왔습니다 - 기록 탭에서 해당 작업을 열어주세요', 'ok');
      if (window.switchTab) switchTab('records');
    };
    // ⚠️ photoFolderHandle은 db.js에 let으로 선언되어 window.photoFolderHandle로는 항상 undefined임 - 맨 식별자로 확인
    var _pfh = (typeof photoFolderHandle !== 'undefined') ? photoFolderHandle : null;
    if (!_pfh || !workId) { fallback(); return; }
    _pfh.getDirectoryHandle(workId, { create: false })
      .then(function(dateDir){
        return dateDir.getFileHandle('_session.json')
          .then(function(fh){ return fh.getFile(); })
          .then(function(file){ return file.text(); })
          .then(function(text){
            var data = JSON.parse(text);
            if (typeof restoreFromData === 'function') restoreFromData(data, dateDir);
            else fallback();
          });
      })
      .catch(function(e){ console.warn('[Push] 자동 열기 실패', e); fallback(); });
  }

  Push.init = function(){
    if (_inited) return;
    var p = PN();
    if (!p) { console.warn('[Push] PushNotifications 플러그인 없음 (웹 환경이거나 미설치 빌드)'); return; }
    _inited = true;

    p.addListener('registration', function(token){
      saveToken(token && token.value);
    });
    p.addListener('registrationError', function(err){ console.warn('[Push] 등록 실패', err); });

    // 포그라운드(앱 사용 중)에 알림이 오면 토스트로만 알려줌 (배지는 이미 채팅 목록에 표시됨)
    p.addListener('pushNotificationReceived', function(notification){
      try {
        var data = notification.data || {};
        // 종류별 설정 확인(포그라운드 토스트도 설정 반영)
        var _typ = data.type;
        var _pk = (_typ === 'sharedPhoto' || _typ === 'borrowedPhotoAdded' || _typ === 'reuploadRequested') ? 'sharedPhoto' : 'chat';
        if (Push.getPref && !Push.getPref(_pk)) return;
        if (data.type === 'sharedPhoto' || data.type === 'reuploadRequested' || data.type === 'borrowedPhotoAdded') {
          if (typeof showToast === 'function') showToast((notification.title || '📷 새 사진') + ': ' + (notification.body || ''), 'ok');
          return;
        }
        // ★ 2026-08-08: 채팅창을 보고 있는 중이면 토스트를 띄우지 않는다.
        //   지금 그 대화를 눈으로 보고 있는데 같은 내용을 토스트로 또 알리는 건 방해만 된다.
        //   (메시지 자체는 실시간 구독으로 화면에 바로 나타난다)
        var _inChat = false;
        try { _inChat = !!(window.CloudChat && CloudChat.isViewingChat && CloudChat.isViewingChat(data.roomId)); } catch (e) {}
        if (_inChat) return;
        if (typeof showToast === 'function') {
          showToast('💬 ' + (notification.title || '새 메시지') + ': ' + (notification.body || ''), 'ok');
        }
      } catch(e){}
    });

    // 알림을 눌러서 들어온 경우 → 채팅 메시지면 채팅탭+해당 방, 공유 사진이면 그 작업 열기,
    // 원본 요청/상대가 사진 추가면 내 작업을 바로 열어 자동 처리 트리거
    p.addListener('pushNotificationActionPerformed', function(action){
      try {
        var data = (action && action.notification && action.notification.data) || {};
        if (data.type === 'sharedPhoto' && data.ownerUid && data.workId) {
          openSharedPhotoWork(data.ownerUid, data.workId);
          return;
        }
        if ((data.type === 'reuploadRequested' || data.type === 'borrowedPhotoAdded') && data.workId) {
          openMyWorkForReupload(data.workId);
          return;
        }
        var roomId = data.roomId;
        if (window.switchTab) switchTab('chat');
        if (roomId && window.CloudChat && CloudChat.openConversationWhenReady) {
          CloudChat.openConversationWhenReady(roomId);
        }
      } catch(e){}
    });

    p.checkPermissions().then(function(res){
      if (res && res.receive === 'granted') { doRegister(); return; }
      return p.requestPermissions().then(function(res2){
        if (res2 && res2.receive === 'granted') doRegister();
      });
    }).catch(function(e){ console.warn('[Push] 권한 확인 실패', e); });
  };

  document.addEventListener('cloud-auth-changed', function(e){
    if (e && e.detail && e.detail.user) {
      Push.init();
      Push.syncPrefs();
    } else if (_lastToken) {
      removeToken(_lastToken);
      _lastToken = null;
    }
  });
})();
