/* ═══════════════════════════════════════════════
   CLOUD CHAT ─ 공유 상대와의 채팅 (하단 "채팅" 탭)
   - 일정 공유(shares status accepted)된 상대와만 대화 시작 가능
   - rooms/{roomId}: members[], memberNames{uid:name}, lastRead{uid:ts}, lastMessage, lastMessageAt
       · 1:1 방은 두 uid를 정렬결합한 id(기존 pairId 규칙과 동일) → 항상 같은 방 재사용
       · 그룹(3명+) 방은 자동 생성 id
   - rooms/{roomId}/messages/{msgId}: text, senderUid, senderName, createdAt
   - 메시지 옆에 "이 메시지를 아직 안 읽은 인원 수"를 표시(카카오톡 방식) → room.lastRead와 members로 계산
   - users/{uid}.lastActive: 하트비트로 갱신 → 참가자 접속 중 표시
   - 탭 안에서 목록 → (새 대화 상대 선택) / 대화 상세 화면을 전환한다.
═══════════════════════════════════════════════ */
(function () {
  'use strict';
  window.CloudChat = window.CloudChat || {};

  // ★ 2026-08-08 배터리 개선: '접속중' 표시 하나 때문에 25초마다 Firestore write가 나가던 것을 완화.
  //   HEARTBEAT_MS를 늘리면 ONLINE_MS(접속중으로 간주하는 시간)도 함께 늘려야 한다.
  //   그러지 않으면 beat 사이 간격에 '접속중'이 꺼졌다 켜졌다 깜빡인다(여유 2.4배로 잡음).
  //   대가: 상대가 앱을 닫은 뒤 '접속중'이 사라지기까지 최대 2분(기존 45초) 걸린다.
  var ONLINE_MS = 120000;      // 2분
  var HEARTBEAT_MS = 50000;    // 50초 (기존 25초 → write 절반)
  var FILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // ★ 파일 보관 1주일 (지나면 다운로드 불가)
  var FILE_MAX = 30 * 1024 * 1024;             // ★ 사진/문서 최대 30MB
  var FILE_MAX_VIDEO = 100 * 1024 * 1024;      // ★ 동영상 최대 100MB
  var _fileBlobs = {};                          // msgId -> {blob, url, name, type, kind} (다운로드된 파일)

  var _sharesUnsub = null;
  var _roomsUnsub = null;
  var _msgUnsubs = {};        // roomId -> unsub
  var _roomDocUnsubs = {};    // roomId -> unsub
  var _presenceUnsubs = {};   // uid -> unsub
  var _messages = {};         // roomId -> [{...}]
  var _pending = {};          // roomId -> [보내는 중/실패한 임시 메시지] (낙관적 표시)
  var _rooms = {};            // roomId -> {members, memberNames, lastRead, lastMessage, lastMessageAtMs, isGroup}
  var _partners = {};         // uid -> name  (일정 공유 accepted 상대 = 새 대화 시작 가능한 사람들)
  var _presence = {};         // uid -> ms(lastActive)
  var _openRoomId = null;
  var _renderedRoomId = null;   // 현재 대화창 HTML이 그려진 방 (입력창 재생성 방지)
  var _viewMode = 'list';     // 'list' | 'picker' | 'chat'
  var _heartbeatTimer = null;
  var _tickTimer = null;
  var _msgPollTimer = null;
  // ★ 적응형 폴링(배터리 절약): 대화가 오갈 땐 5초, 조용하면 최대 30초까지 늘린다.
  //   실시간 구독(onSnapshot)이 정상이면 폴링은 매번 빈손 → 그 낭비를 줄이는 것이 목적.
  //   새 메시지 수신/전송/방 열기 시 즉시 5초로 되돌려 대화 중 지연이 생기지 않게 한다.
  var POLL_MIN_MS = 5000;
  var POLL_MAX_MS = 30000;
  var _pollMs = POLL_MIN_MS;

  function loggedIn(){ return window.Cloud && Cloud.ready && Cloud.user; }
  function db(){ return Cloud.db; }
  function myUid(){ return Cloud.user.uid; }
  function myName(){
    // ★ 2026-07-11: 닉네임 우선, 미설정 시 로그인 사용자명
    try { if (window.CloudShare && CloudShare.nickOf) { var nk = CloudShare.nickOf(myUid()); if (nk) return nk; } } catch(e){}
    return Cloud.user.displayName || Cloud.user.email || '';
  }
  function esc(s){ return String(s||'').replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function toast(m,t){ if (typeof showToast==='function') showToast(m,t||'ok'); else alert(m); }
  function tabOpen(){ var m = document.getElementById('chatTabModal'); return !!(m && m.classList.contains('open')); }
  function twoPersonRoomId(a,b){ return a < b ? a + '_' + b : b + '_' + a; }

  function notifyBadge(){
    document.dispatchEvent(new CustomEvent('cloud-share-render'));
    if (tabOpen() && _viewMode === 'list') renderChatTabBody();
  }

  // ★ 일정 공유 중(accepted 상대가 1명 이상)일 때만 하단 "채팅" 탭을 노출
  function updateTabVisibility(){
    var btn = document.getElementById('chatTabBtn');
    if (!btn) return;
    var hasAny = Object.keys(_partners).length > 0 || Object.keys(_rooms).length > 0;  // ★ 팀방 있으면 노출
    btn.style.display = hasAny ? '' : 'none';
    try { localStorage.setItem('chatTabVisible', hasAny ? '1' : '0'); } catch (e) {}  // ★ 다음 실행 때 즉시 반영(탭 바 밀림 방지)
    if (!hasAny) {
      var modal = document.getElementById('chatTabModal');
      if (modal && modal.classList.contains('open') && window.switchTab) switchTab('work');
    }
  }

  /* ════════ 일정 공유 상대(accepted) = 새 대화를 시작할 수 있는 사람 목록 ════════ */
  function syncShares(shares){
    var accepted = {};
    shares.forEach(function (s) {
      if (s.status === 'accepted') {
        var ou = (s.members || []).filter(function(u){ return u !== myUid(); })[0];
        var name = (s.requestedBy === myUid()) ? (s.toName || '상대') : (s.fromName || '상대');
        if (ou) accepted[ou] = name;
      }
    });
    _partners = accepted;
    Object.keys(accepted).forEach(function(uid){ subscribePresence(uid); });
    Object.keys(_presenceUnsubs).forEach(function(uid){
      if (!accepted[uid]) { try { _presenceUnsubs[uid](); } catch(e){} delete _presenceUnsubs[uid]; }
    });
    updateTabVisibility();
    if (tabOpen()) renderChatTabBody();
    notifyBadge();
  }
  function subscribeShares(){
    if (!loggedIn()) return;
    if (_sharesUnsub) return;
    var q = db().collection('shares').where('members','array-contains', myUid());
    function apply(snap){
      var docs = []; snap.forEach(function(d){ docs.push(Object.assign({id:d.id}, d.data())); });
      syncShares(docs);
    }
    // ★ 중복 .get() 제거 — onSnapshot 최초 스냅샷이 같은 데이터를 주므로 둘 다 하면 읽기가 2배
    _sharesUnsub = q.onSnapshot(apply, function(err){ console.warn('[CloudChat] shares 구독 오류', err && err.code); });
  }

  /* ════════ 내가 속한 채팅방(rooms) 목록 ════════
     ★ WebView Firestore 실시간 스트림이 가끔 멈춰있다 늦게 따라잡는 현상이 있어
       (schedules/shares 때도 겪은 문제) 최초 1회 직접 읽기(pull)를 항상 병행한다. */
  function subscribeRooms(){
    if (!loggedIn()) return;
    if (_roomsUnsub) return;
    var q = db().collection('rooms').where('members','array-contains', myUid());
    function apply(snap){
      var seen = {};
      snap.forEach(function(doc){
        var d = doc.data() || {};
        var roomId = doc.id;
        seen[roomId] = 1;
        var lr = {};
        // ★ 2026-08-12 '1' 재출현 버그: markRead()가 serverTimestamp()로 쓰면 같은 리스너가
        //   서버 확정 전 로컬 반영(hasPendingWrites) 스냅샷을 먼저 주는데, 이때 serverTimestamp
        //   필드는 아직 null로 읽힌다. 이걸 그대로 0 처리하면 방금 지운 안읽음 배지가 잠깐
        //   되살아났다가 서버 확정 스냅샷이 오면 다시 사라진다(깜빡임). null이면 0으로 리셋하지
        //   말고 이전 값을 유지해 진짜 값이 올 때까지 기다린다.
        var _prevLr = (_rooms[roomId] && _rooms[roomId].lastRead) || {};
        if (d.lastRead) Object.keys(d.lastRead).forEach(function(uid){
          var v = d.lastRead[uid];
          lr[uid] = (v && v.toMillis) ? v.toMillis() : (_prevLr[uid] || 0);
        });
        _rooms[roomId] = {
          members: d.members || [],
          memberNames: d.memberNames || {},
          lastRead: lr,
          lastMessage: d.lastMessage || '',
          lastMessageAtMs: (d.lastMessageAt && d.lastMessageAt.toMillis) ? d.lastMessageAt.toMillis() : 0,
          isGroup: (d.members || []).length > 2,
          teamName: d.teamName || '', teamId: d.teamId || ''
        };
        subscribeMessages(roomId);
        (d.members || []).forEach(function(pu){ if (pu !== myUid()) subscribePresence(pu); });
      });
      Object.keys(_rooms).forEach(function(roomId){
        if (!seen[roomId]) {
          try { if (_msgUnsubs[roomId]) _msgUnsubs[roomId](); } catch(e){}
          try { if (_roomDocUnsubs[roomId]) _roomDocUnsubs[roomId](); } catch(e){}
          delete _msgUnsubs[roomId]; delete _roomDocUnsubs[roomId];
          delete _messages[roomId]; delete _rooms[roomId];
        }
      });
      updateTabVisibility();   // ★ 팀방 생기면 채팅 탭 노출
      if (tabOpen()) renderChatTabBody();
      notifyBadge();
    }
    // ★ 중복 .get() 제거 (위와 동일 이유)
    _roomsUnsub = q.onSnapshot(apply, function(err){ console.warn('[CloudChat] rooms 구독 오류', err && err.code); });
  }

  // ★ 시작하자마자 지난 세션의 채팅탭 표시상태를 반영(방 로드 후 늦게 튀어나오지 않도록)
  try {
    document.addEventListener('DOMContentLoaded', function(){
      try { var _b = document.getElementById('chatTabBtn'); if (_b && localStorage.getItem('chatTabVisible') === '1') _b.style.display = ''; } catch (e) {}
    });
  } catch (e) {}
  CloudChat.ensure = function(){
    if (loggedIn()) { subscribeShares(); subscribeRooms(); startHeartbeat(); startTick(); startMsgPoll(); }
  };

  /* ★ 2026-08-12 배터리 개선 — 앱이 백그라운드일 땐 채팅 실시간 리스너를 모두 끊는다.
       (presence 일시정지(2026-08-08)·일정공유 일시정지(2026-08-11)와 같은 패턴)

       왜 방이 하나뿐인데도 의미가 있나:
         rooms/{roomId} 문서에는 lastMessage 뿐 아니라 lastRead{uid:ts} 가 들어 있다.
         즉 팀원이 채팅을 '읽기만 해도' 문서가 갱신되고 그 쓰기가 전원에게 푸시된다.
         (읽음 표시는 markRead 4초 스로틀이라 상대가 방을 보고 있는 동안 계속 흐른다)
         팀원이 여러 명이면 한 방에 그 트래픽이 전부 몰리므로, 방 개수와 무관하게 자주 깨어난다.
         화면이 꺼져 있으면 안읽음 배지도 탭도 그릴 일이 없으니 전부 헛깨움이다.

       끊어도 안전한 이유: 새 메시지 알림은 리스너가 아니라 FCM 푸시(push.js + Cloud Functions)로
       오므로 알림을 놓치지 않는다. 복귀 시 재구독하면서 최초 스냅샷으로 최신 메시지를 즉시 받는다.

       rooms 리스너는 messages/presence 구독의 시발점(발견 즉시 subscribeMessages/subscribePresence 호출)이라
       이것만 끊으면 나머지도 자동으로 따라붙지 않는다. 재개 시 rooms 스냅샷이 다시 fan-out 해준다. */
  var _chatPaused = false;
  function pauseChatSync(){
    if (_chatPaused) return;
    _chatPaused = true;
    if (_roomsUnsub) { try { _roomsUnsub(); } catch(e){} _roomsUnsub = null; }
    if (_sharesUnsub) { try { _sharesUnsub(); } catch(e){} _sharesUnsub = null; }
    Object.keys(_msgUnsubs).forEach(function(k){ try { _msgUnsubs[k](); } catch(e){} });
    _msgUnsubs = {};
    Object.keys(_roomDocUnsubs).forEach(function(k){ try { _roomDocUnsubs[k](); } catch(e){} });
    _roomDocUnsubs = {};
    // 폴링 타이머도 함께 정지 (백그라운드에서 .get({source:'server'})이 도는 것 방지)
    if (_msgPollTimer) { clearTimeout(_msgPollTimer); _msgPollTimer = null; }
    if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
    // ★ _rooms/_messages 데이터는 지우지 않는다 - 복귀 즉시 이전 화면을 그대로 보여주기 위함
    //   (cleanup()과 다른 점: 저기는 로그아웃용이라 데이터까지 비운다)
  }
  function resumeChatSync(){
    if (!_chatPaused) return;
    _chatPaused = false;
    if (!loggedIn()) return;
    subscribeShares();
    subscribeRooms();   // 스냅샷이 오면 방마다 subscribeMessages/subscribePresence 재부착
    startTick();
    startMsgPoll();
    bumpPoll();         // 복귀 직후엔 폴링 간격을 최소로 → 밀린 메시지를 빨리 따라잡음
  }
  document.addEventListener('visibilitychange', function(){
    if (document.hidden) pauseChatSync(); else resumeChatSync();
  });
  // Capacitor 네이티브에서 visibilitychange가 안 오는 경우 대비(이중 안전망)
  try {
    var _AppC = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (_AppC && _AppC.addListener) {
      _AppC.addListener('appStateChange', function(st){
        if (st && st.isActive === false) pauseChatSync(); else resumeChatSync();
      });
    }
  } catch(e){}

  /* ════════ 메시지 구독 (방별) ════════ */
  function subscribeMessages(roomId){
    var q = db().collection('rooms').doc(roomId).collection('messages')
      .orderBy('createdAt','asc').limitToLast(300);
    function apply(snap){
      var arr = [];
      snap.forEach(function(doc){ arr.push(Object.assign({id:doc.id}, doc.data())); });
      if (arr.length !== (_messages[roomId] || []).length) bumpPoll();   // 실시간 수신 = 대화 중 → 폴링 간격 리셋
      _messages[roomId] = arr;
      _reconcilePending(roomId, arr);   // 서버 확정 메시지 도착 → 임시메시지 제거(정렬 정상화)
      if (_openRoomId === roomId && _viewMode === 'chat') renderMessages(roomId);
      /* ★ 2026-08-08 '1'이 안 지워지던 문제
           방을 열어둔 채 새 메시지를 받으면 여기(onSnapshot)로 들어오는데, 예전엔 쓰기폭주를 막으려고
           markRead 를 아예 빼놨다. 그래서 받는 쪽 lastRead 가 갱신되지 않아 보낸 쪽 '1'이 남아 있었다.
           → 화면을 실제로 보고 있고, 안 읽은 게 있을 때만 markRead 한다.
             (markRead 는 rooms 문서에 쓰므로 이 messages 구독을 다시 깨우지 않는다 = 무한루프 아님.
              게다가 서버 쓰기는 4초 스로틀이 걸려 있고, 읽고 나면 안읽음이 0이라 반복 호출도 안 된다) */
      if (CloudChat.isViewingChat(roomId)) {
        try { if (CloudChat.getUnreadCount(roomId) > 0) markRead(roomId); } catch (e) {}
      }
      notifyBadge();
    }
    _messages[roomId] = _messages[roomId] || [];
    if (_msgUnsubs[roomId]) return;   // ★ 이미 구독 중이면 재조회/재구독 안 함(중복 .get 폭주 방지)
    // ★ 중복 .get() 제거 (위와 동일 이유)
    _msgUnsubs[roomId] = q.onSnapshot(apply, function(err){ console.warn('[CloudChat] 메시지 구독 오류', roomId, err && err.code); if (typeof showToast === 'function') showToast('메시지 수신 오류: ' + (err && (err.code || err.message)), 'err'); });
  }
  function pullMessagesNow(roomId){
    db().collection('rooms').doc(roomId).collection('messages')
      .orderBy('createdAt','asc').limitToLast(300).get()
      .then(function(snap){
        var arr = [];
        snap.forEach(function(doc){ arr.push(Object.assign({id:doc.id}, doc.data())); });
        _messages[roomId] = arr;
        _reconcilePending(roomId, arr);
        if (_openRoomId === roomId && _viewMode === 'chat') renderMessages(roomId);
        notifyBadge();
      }).catch(function(e){ console.warn('[CloudChat] 메시지 재읽기 실패', roomId, e && e.code); });
  }

  /* ════════ 접속 상태(presence) ════════ */
  function startHeartbeat(){
    if (_heartbeatTimer) return;
    function beat(){
      if (!loggedIn()) return;
      if (document.hidden) return;
      db().collection('users').doc(myUid()).set(
        { lastActive: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }
      ).catch(function(){});
    }
    beat();
    _heartbeatTimer = setInterval(beat, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', function(){ if (!document.hidden) beat(); });
  }
  function subscribePresence(uid){
    if (_presencePaused) return;   // ★ 백그라운드 동안엔 구독하지 않음(shares/rooms 스냅샷이 도착해도 되살아나지 않게)
    if (!uid || _presenceUnsubs[uid]) return;
    /* ★ 2026-08-24 같은 users/{uid} 문서를 cloud_share._subProfile 도 듣고 있었다.
         한 문서를 두 번 구독하면 갱신 때마다 문서 전체가 두 번 내려온다(심박 50초 + 업종아이콘 최대 300KB).
         → CloudShare 의 공용 구독에 얹어 uid 당 하나만 쓴다. CloudShare 가 없으면 예전처럼 직접 구독한다. */
    var handler = function(d){
      d = d || {};
      var t = d.lastActive && d.lastActive.toMillis ? d.lastActive.toMillis() : 0;
      _presence[uid] = t;
      if (document.hidden) return;   // ★ 화면에 안 보이면 그릴 필요 없음
      if (_viewMode === 'chat' && _openRoomId) renderParticipants(_openRoomId);
      if (tabOpen() && _viewMode === 'list') renderChatTabBody();
    };
    _presenceUnsubs[uid] = function(){};   // 재진입 가드
    if (window.CloudShare && CloudShare.subscribeUserDoc) {
      _presenceUnsubs[uid] = CloudShare.subscribeUserDoc(uid, handler);
    } else {
      _presenceUnsubs[uid] = db().collection('users').doc(uid).onSnapshot(function(doc){
        handler((doc && doc.data()) || {});
      }, function(){});
    }
  }

  /* ★ 2026-08-08 배터리 개선 — presence(접속중 표시) 구독을 백그라운드에서만 잠시 끊는다.
       왜 필요한가: 상대는 앱이 켜져 있는 동안 HEARTBEAT_MS(50초)마다 users/{uid}.lastActive 를 쓴다.
       그 쓰기 하나하나가 나에게 푸시되어 폰을 깨우는데, 내 앱이 백그라운드면 그 초록불은 보이지도 않는다.
       상대가 3명이면 평균 17초마다 헛되이 깨어나는 셈(LTE는 패킷 하나에도 라디오가 수 초간 고전력 유지).
       왜 이것만 끊나: presence는 순수 장식이라 끊겨도 잃는 데이터가 없고, 복귀 시 재구독 한 줄로 즉시 복구된다.
       일정/메시지 리스너는 그대로 두므로 공유 데이터가 늦게 들어올 위험이 없고,
       채팅 알림은 어차피 리스너가 아니라 FCM 푸시(push.js)로 오므로 알림도 놓치지 않는다. */
  var _presencePaused = false;
  function pausePresence(){
    if (_presencePaused) return;
    _presencePaused = true;
    Object.keys(_presenceUnsubs).forEach(function(uid){ try { _presenceUnsubs[uid](); } catch(e){} });
    _presenceUnsubs = {};
  }
  function resumePresence(){
    if (!_presencePaused) return;
    _presencePaused = false;
    if (!loggedIn()) return;
    // 구독 대상 복원: 공유 상대 + 내가 속한 방의 멤버 (구독 시점에 최신 상태를 즉시 받아옴)
    Object.keys(_partners).forEach(function(uid){ subscribePresence(uid); });
    Object.keys(_rooms).forEach(function(rid){
      var mem = (_rooms[rid] && _rooms[rid].members) || [];
      mem.forEach(function(pu){ if (pu !== myUid()) subscribePresence(pu); });
    });
    if (tabOpen()) renderChatTabBody();
  }
  document.addEventListener('visibilitychange', function(){
    if (document.hidden) pausePresence(); else resumePresence();
  });
  // Capacitor 네이티브에서 visibilitychange가 안 오는 경우 대비(이중 안전망)
  try {
    var _AppP = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (_AppP && _AppP.addListener) {
      _AppP.addListener('appStateChange', function(st){
        if (st && st.isActive === false) pausePresence(); else resumePresence();
      });
    }
  } catch(e){}
  function isOnline(uid){
    var t = _presence[uid] || 0;
    return t > 0 && (Date.now() - t) < ONLINE_MS;
  }
  function startTick(){
    if (_tickTimer) return;
    _tickTimer = setInterval(function(){
      if (document.hidden) return;   // ★ 백그라운드에선 렌더 불필요(tabOpen은 백그라운드에서도 true라 따로 막아야 함)
      if (!tabOpen()) return;
      if (_viewMode === 'chat' && _openRoomId) renderParticipants(_openRoomId);
      else if (_viewMode === 'list') renderChatTabBody();
    }, 15000);
  }
  /* ★ 메시지 폴링: WebView 실시간 스트림이 멈춰도 열려 있는 방의 새 메시지를 몇 초 안에 확실히 받는다.

     2026-08-13 읽기량 절감 —
       예전엔 폴링 회차마다 메시지 20건을 통째로 읽었다(limitToLast(20).get). 방을 열어두면
       5~30초마다 20읽기 + 인원수만큼 presence 읽기 → 시간당 수백~수천 읽기가 조용히 나갔다.

       바꾼 방식: 방 문서 1건만 읽어 lastMessageAt 이 지난번과 달라졌는지 본다(1읽기).
       달라졌을 때만 메시지 20건을 읽는다. 대화가 없으면 회차당 1읽기로 떨어진다.

       ⚠️ rooms 문서의 lastMessageAt 갱신은 전송 경로에서 fire-and-forget 이라 실패할 수 있다.
          그 경우 방 문서만 봐서는 새 메시지를 영영 못 볼 수 있으므로,
          6회차마다 한 번은 조건 없이 메시지를 직접 확인한다(안전망). */
  var _lastSeenLm = {};      // roomId -> 마지막으로 확인한 lastMessageAt(ms)
  var _pollRound = {};       // roomId -> 폴링 회차
  var FULL_POLL_EVERY = 6;   // 이 회차마다 한 번은 메시지 직접 확인

  function pollMessagesFull(roomId){
    db().collection('rooms').doc(roomId).collection('messages')
      .orderBy('createdAt', 'asc').limitToLast(20).get({ source: 'server' })   // 캐시 무시·서버에서 최신 확보
      .then(function(snap){
        var cur = _messages[roomId] || [];
        var have = {}; cur.forEach(function(m){ if (m.id) have[m.id] = 1; });
        var adds = [];
        snap.forEach(function(doc){ if (!have[doc.id]) adds.push(Object.assign({ id: doc.id }, doc.data())); });
        if (!adds.length) return;                       // 변화 없음 → 렌더 안 함(백오프 유지)
        bumpPoll();                                     // 새 메시지 발견 → 다시 5초 간격으로
        _messages[roomId] = cur.concat(adds);
        _reconcilePending(roomId, _messages[roomId]);
        if (_openRoomId === roomId && _viewMode === 'chat') { renderMessages(roomId); markRead(roomId); }
        notifyBadge();
      }).catch(function(){});
  }

  function pollMessagesLight(roomId){
    _pollRound[roomId] = (_pollRound[roomId] || 0) + 1;
    if (_pollRound[roomId] % FULL_POLL_EVERY === 0) { pollMessagesFull(roomId); return; }  // 안전망 회차
    // 평소: 방 문서 1건만 확인
    db().collection('rooms').doc(roomId).get({ source: 'server' })
      .then(function(doc){
        if (!doc.exists) return;
        var d = doc.data() || {};
        var lm = (d.lastMessageAt && d.lastMessageAt.toMillis) ? d.lastMessageAt.toMillis() : 0;
        if (!lm) { pollMessagesFull(roomId); return; }        // 방 요약이 없는 옛 방 → 직접 확인
        if (_lastSeenLm[roomId] === lm) return;               // 그대로 → 새 메시지 없음(읽기 1로 끝)
        _lastSeenLm[roomId] = lm;
        pollMessagesFull(roomId);                             // 바뀌었을 때만 메시지 읽기
      }).catch(function(){});
  }

  // 접속상태(presence)도 서버에서 직접 확인 → 실시간 스트림 멈춰도 상대 접속표시 갱신
  //   ★ 2026-08-13: 폴링이 5초까지 빨라지면 인원수만큼 읽기가 곱해지므로 30초에 한 번으로 제한.
  //     (접속중 표시는 분 단위 정보라 더 자주 볼 이유가 없다)
  var _lastPresencePoll = 0;
  var PRESENCE_MIN_MS = 30000;
  function pollPresence(roomId){
    var now = Date.now();
    if (now - _lastPresencePoll < PRESENCE_MIN_MS) return;
    _lastPresencePoll = now;
    var room = _rooms[roomId] || {};
    (room.members || []).forEach(function(uid){
      if (uid === myUid()) return;
      db().collection('users').doc(uid).get({ source: 'server' }).then(function(doc){
        var d = doc.data() || {};
        var t = (d.lastActive && d.lastActive.toMillis) ? d.lastActive.toMillis() : 0;
        if (t && t !== _presence[uid]) { _presence[uid] = t; if (_openRoomId === roomId && _viewMode === 'chat') renderParticipants(roomId); }
      }).catch(function(){});
    });
  }
  // 대화가 살아있다는 신호 → 폴링 간격을 최소(5초)로 되돌리고 즉시 재예약
  //   (setInterval로 1초마다 '지금인가?'를 확인하면 헛깨움이 생기므로,
  //    setTimeout 자기재예약 방식으로 '실제 폴링할 때만' CPU를 깨운다)
  function bumpPoll(){
    var was = _pollMs;
    _pollMs = POLL_MIN_MS;
    if (_msgPollTimer && was !== POLL_MIN_MS) _schedulePoll();   // 늘어나 있던 예약을 앞당김
  }
  CloudChat._bumpPoll = bumpPoll;
  function _pollTick(){
    _msgPollTimer = null;
    // 화면에 안 보이거나 채팅방이 열려있지 않으면 이번 회차는 건너뛴다(다음 회차는 계속 예약)
    if (!document.hidden && tabOpen() && _viewMode === 'chat' && _openRoomId) {
      pollMessagesLight(_openRoomId);
      pollPresence(_openRoomId);
      // 빈손이면 간격을 늘린다(5→10→20→30초). 새 메시지가 오면 pollMessagesLight가 bumpPoll로 되돌림.
      _pollMs = Math.min(POLL_MAX_MS, _pollMs * 2);
    } else {
      /* ★ 2026-08-24 배터리 — 건너뛴 회차도 간격을 늘린다.
           예전엔 여기서 _pollMs 를 그대로 두고 재예약만 했다. 그래서 채팅방을 한 번도 열지 않으면
           백오프가 영영 걸리지 않아 앱을 켜 둔 내내 5초마다 CPU 를 깨웠다(시간당 720회).
           건너뛰는 회차는 어차피 아무 일도 안 하므로 곧장 최대 간격으로 올린다(시간당 120회).
           ⚠️ 반응성 손해는 없다 — 방을 여는 경로(openConversation / renderChatTabBody 폴백)가
              bumpPoll() 로 즉시 5초로 되돌리고 예약도 앞당긴다. */
      _pollMs = POLL_MAX_MS;
    }
    _schedulePoll();
  }
  function _schedulePoll(){
    clearTimeout(_msgPollTimer);
    _msgPollTimer = setTimeout(_pollTick, _pollMs);
  }
  function startMsgPoll(){
    if (_msgPollTimer) return;
    _pollMs = POLL_MIN_MS;
    _schedulePoll();
  }

  /* ════════ 방 이름/참가자 계산 ════════ */
  function nameOf(room, uid){
    if (uid === myUid()) return myName() || '나';
    // ★ 2026-07-11: 상대 닉네임 우선 (실시간 프로필)
    try { if (window.CloudShare && CloudShare.nickOf) { var nk = CloudShare.nickOf(uid); if (nk) return nk; } } catch(e){}
    return (room.memberNames && room.memberNames[uid]) || _partners[uid] || '상대';
  }
  // ★ 2026-07-11: 말풍선 보낸이 닉네임/색상
  function _senderNick(m){
    try { if (m && m.senderUid && window.CloudShare && CloudShare.nickOf) { var nk = CloudShare.nickOf(m.senderUid); if (nk) return nk; } } catch(e){}
    return (m && m.senderName) || '상대';
  }
  function _senderColor(uid){
    try { if (uid && window.CloudShare && CloudShare.profileOf) { var pf = CloudShare.profileOf(uid); if (pf && pf.color) return pf.color; } } catch(e){}
    return 'var(--mu)';
  }
  function roomTitle(roomId){
    var room = _rooms[roomId];
    if (!room) return '채팅';
    if (room.teamName) return '👥 ' + room.teamName;   // ★ 팀 단체 채팅방
    var others = (room.members || []).filter(function(u){ return u !== myUid(); });
    if (!others.length) return '나';
    var names = others.map(function(u){ return nameOf(room, u); });
    return (room.isGroup ? '👥 ' : '') + names.join(', ');
  }
  function participantsOf(roomId){
    var room = _rooms[roomId];
    if (!room) return [];
    return (room.members || []).map(function(uid){
      return { uid: uid, name: nameOf(room, uid), online: uid === myUid() ? true : isOnline(uid) };
    });
  }
  // 이 메시지를 아직 안 읽은 인원 수 (보낸 사람 본인 제외)
  function unreadCountForMessage(room, msg){
    var t = msg.createdAt && msg.createdAt.toMillis ? msg.createdAt.toMillis() : 0;
    if (!t) return 0;
    var n = 0;
    (room.members || []).forEach(function(uid){
      if (uid === msg.senderUid) return;
      var lr = (room.lastRead && room.lastRead[uid]) || 0;
      if (lr < t) n++;
    });
    return n;
  }

  /* 지금 채팅방을 실제로 '보고 있는' 상태인가 (토스트 억제·읽음처리 판단용)
     tabOpen()만으로는 부족하다 — 앱이 백그라운드여도 모달 class는 남아 true다. */
  CloudChat.isViewingChat = function(roomId){
    if (document.hidden) return false;
    if (!tabOpen() || _viewMode !== 'chat' || !_openRoomId) return false;
    return roomId ? (String(roomId) === String(_openRoomId)) : true;
  };

  /* ════════ 안읽음(방 단위, 목록 배지용) ════════ */
  CloudChat.getUnreadCount = function(roomId){
    var arr = _messages[roomId] || [];
    var room = _rooms[roomId] || {};
    var lr = (room.lastRead && room.lastRead[myUid()]) || 0;
    var n = 0;
    arr.forEach(function(m){
      if (m.senderUid === myUid()) return;
      var t = m.createdAt && m.createdAt.toMillis ? m.createdAt.toMillis() : 0;
      if (t > lr) n++;
    });
    return n;
  };
  CloudChat.totalUnread = function(){
    var t = 0;
    Object.keys(_rooms).forEach(function(rid){ t += CloudChat.getUnreadCount(rid); });
    return t;
  };

  /* ════════ 방 만들기 / 열기 ════════ */
  function ensureTwoPersonRoom(partnerUid){
    var roomId = twoPersonRoomId(myUid(), partnerUid);
    var ref = db().collection('rooms').doc(roomId);
    return ref.get().then(function(doc){
      if (doc.exists) return roomId;
      var memberNames = {};
      memberNames[myUid()] = myName() || '나';
      memberNames[partnerUid] = _partners[partnerUid] || '상대';
      return ref.set({
        members: [myUid(), partnerUid],
        memberNames: memberNames,
        createdBy: myUid(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }).then(function(){ return roomId; });
    });
  }
  CloudChat.openOrCreateDirect = function(partnerUid){
    if (!loggedIn()) { toast('먼저 로그인해주세요','err'); return; }
    if (!_partners[partnerUid]) { toast('일정 공유 중인 상대에게만 채팅할 수 있습니다','err'); return; }
    ensureTwoPersonRoom(partnerUid).then(function(roomId){
      subscribeMessages(roomId);
      CloudChat.openConversation(roomId);
    }).catch(function(e){ console.warn('[CloudChat] 방 생성 실패', e); toast('채팅방을 여는 데 실패했습니다','err'); });
  };

  /* ════════ 파일 공유 ════════ */
  function fmtSize(n) {
    n = +n || 0;
    if (n >= 1048576) return (n / 1048576).toFixed(1) + 'MB';
    if (n >= 1024) return Math.round(n / 1024) + 'KB';
    return n + 'B';
  }
  function fileKindOf(type, name) {
    if (/^image\//.test(type || '')) return 'image';
    if (/^video\//.test(type || '')) return 'video';
    if (/\.(jpe?g|png|gif|webp|heic)$/i.test(name || '')) return 'image';
    if (/\.(mp4|mov|webm|3gp|mkv)$/i.test(name || '')) return 'video';
    return 'doc';
  }
  function fileIconOf(kind) { return kind === 'image' ? '🖼️' : (kind === 'video' ? '🎬' : '📄'); }
  function msgTimeMs(m) { return (m && m.createdAt && m.createdAt.toMillis) ? m.createdAt.toMillis() : 0; }
  function fileExpired(m) {
    var t = msgTimeMs(m);
    return t > 0 && (Date.now() - t) > FILE_TTL_MS;
  }

  // ── 썸네일 생성 (이미지: 축소본 / 동영상: 첫 장면 캡처) — 메시지에 저장돼 만료 후에도 보임 ──
  var THUMB_DIM = 320;
  var THUMB_MAX_LEN = 200000;  // dataURL 200KB 제한 (Firestore 문서 1MB 보호)
  function makeImageThumb(f) {
    return new Promise(function (resolve) {
      try {
        var url = URL.createObjectURL(f);
        var img = new Image();
        img.onload = function () {
          try {
            var w = img.width, h = img.height;
            var scale = Math.min(1, THUMB_DIM / Math.max(w, h));
            var cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round(w * scale));
            cv.height = Math.max(1, Math.round(h * scale));
            cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
            var d = cv.toDataURL('image/jpeg', 0.72);
            URL.revokeObjectURL(url);
            resolve(d.length < THUMB_MAX_LEN ? { thumb: d } : null);
          } catch (e) { URL.revokeObjectURL(url); resolve(null); }
        };
        img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
      } catch (e) { resolve(null); }
    });
  }
  function makeVideoThumb(f) {
    return new Promise(function (resolve) {
      try {
        var url = URL.createObjectURL(f);
        var v = document.createElement('video');
        var done = false;
        function finish(r) { if (done) return; done = true; clearTimeout(to); try { URL.revokeObjectURL(url); } catch (e) {} resolve(r); }
        var to = setTimeout(function () { finish(null); }, 6000);
        v.muted = true; v.playsInline = true; v.preload = 'auto';
        v.onloadedmetadata = function () {
          try { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); } catch (e) {}
        };
        v.onseeked = function () {
          try {
            var w = v.videoWidth, h = v.videoHeight;
            if (!w || !h) { finish({ thumb: '', duration: Math.round(v.duration || 0) }); return; }
            var scale = Math.min(1, THUMB_DIM / Math.max(w, h));
            var cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round(w * scale));
            cv.height = Math.max(1, Math.round(h * scale));
            cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
            var d = cv.toDataURL('image/jpeg', 0.7);
            finish({ thumb: (d.length < THUMB_MAX_LEN ? d : ''), duration: Math.round(v.duration || 0) });
          } catch (e) { finish(null); }
        };
        v.onerror = function () { finish(null); };
        v.src = url;
      } catch (e) { resolve(null); }
    });
  }
  function fmtDur(sec) {
    sec = Math.max(0, Math.round(+sec || 0));
    return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
  }

  CloudChat.sendFile = function (roomId, f) {
    if (!loggedIn()) { toast('먼저 로그인해주세요', 'err'); return; }
    if (!f) return;
    var kind = fileKindOf(f.type, f.name);
    // ★ 사진/영상 전송은 프로(19,900) 이상
    if ((kind === 'image' || kind === 'video') && window.Subs && !Subs.gateFeature('chatMedia', '채팅 사진·동영상 전송')) return;
    var maxSize = (kind === 'video') ? FILE_MAX_VIDEO : FILE_MAX;
    if (f.size > maxSize) {
      toast('파일이 너무 큽니다 (' + (kind === 'video' ? '동영상 최대 100MB' : '사진/문서 최대 30MB') + ')', 'err');
      return;
    }
    var safe = String(f.name || 'file').replace(/[\/\\:*?"<>|#\[\]%]/g, '_');
    if (safe.length > 80) safe = safe.slice(-80);
    var sp = 'chat_files/' + roomId + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '_' + safe;
    toast('📎 업로드 중... (' + fmtSize(f.size) + ')');
    // 썸네일 먼저 생성 (실패해도 그냥 아이콘으로 전송)
    var thumbP = (kind === 'image') ? makeImageThumb(f) : (kind === 'video' ? makeVideoThumb(f) : Promise.resolve(null));
    var _ti = null;
    thumbP.then(function (ti) { _ti = ti; })
      .then(function () { return firebase.storage().ref(sp).put(f, { contentType: f.type || 'application/octet-stream' }); })
      .then(function () {
        var fileDoc = { name: f.name || 'file', size: f.size || 0, type: f.type || '', kind: kind, storagePath: sp };
        if (_ti && _ti.thumb) fileDoc.thumb = _ti.thumb;
        if (_ti && _ti.duration) fileDoc.duration = _ti.duration;
        return db().collection('rooms').doc(roomId).collection('messages').add({
          text: '',
          file: fileDoc,
          senderUid: myUid(), senderName: myName(),
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      })
      .then(function (ref) {
        // 보낸 사람은 즉시 열기 가능 (로컬 파일 그대로 보관)
        try { _fileBlobs[ref.id] = { blob: f, url: URL.createObjectURL(f), name: f.name || 'file', type: f.type || '', kind: kind }; } catch (e) {}
        toast('📎 파일 전송 완료', 'ok');
        return db().collection('rooms').doc(roomId).set({
          lastMessage: '📎 ' + String(f.name || '파일').slice(0, 60),
          lastMessageAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      })
      .catch(function (e) {
        console.warn('[CloudChat] 파일 전송 실패', e);
        toast('파일 전송 실패: ' + ((e && e.code) || (e && e.message) || ''), 'err');
      });
  };

  function downloadChatFile(roomId, mid) {
    var m = (_messages[roomId] || []).filter(function (x) { return x.id === mid; })[0];
    if (!m || !m.file) return;
    if (fileExpired(m)) { toast('보관기간(1주일)이 지나 다운로드할 수 없습니다', 'err'); renderMessages(roomId); return; }
    toast('⬇ 다운로드 중... (' + fmtSize(m.file.size) + ')');
    firebase.storage().ref(m.file.storagePath).getDownloadURL()
      .then(function (url) { return fetch(url); })
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.blob(); })
      .then(function (blob) {
        _fileBlobs[mid] = {
          blob: blob, url: URL.createObjectURL(blob),
          name: m.file.name || 'file', type: m.file.type || blob.type || '', kind: m.file.kind || fileKindOf(m.file.type, m.file.name)
        };
        toast('✅ 다운로드 완료', 'ok');
        renderMessages(roomId);
        // 이미지/영상은 바로 열어서 보여줌 (문서는 열기 버튼으로 공유/저장)
        var k = _fileBlobs[mid].kind;
        if (k === 'image' || k === 'video') openChatFile(mid);
      })
      .catch(function (e) {
        console.warn('[CloudChat] 다운로드 실패', e);
        var code = (e && e.code) || '';
        if (String(code).indexOf('object-not-found') >= 0) toast('서버에서 파일이 삭제되었습니다 (보관기간 경과)', 'err');
        else toast('다운로드 실패: ' + (code || (e && e.message) || ''), 'err');
      });
  }

  function openChatFile(mid) {
    var g = _fileBlobs[mid];
    if (!g) { toast('먼저 다운로드해주세요', 'err'); return; }
    if (g.kind === 'image') {
      showFileViewer('<img src="' + g.url + '" style="max-width:100%;max-height:100%;object-fit:contain;">', g);
    } else if (g.kind === 'video') {
      showFileViewer('<video src="' + g.url + '" controls autoplay playsinline style="max-width:100%;max-height:100%;"></video>', g);
    } else {
      shareOrSaveFile(g);
    }
  }

  // 썸네일 탭 → 확대 미리보기. 원본 다운로드는 미리보기 안에서 한 번 더 눌러야 함
  function openThumbPreview(roomId, mid) {
    var m = (_messages[roomId] || []).filter(function (x) { return x.id === mid; })[0];
    if (!m || !m.file || !m.file.thumb) return;
    var f = m.file;
    var expired = fileExpired(m);
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.95);z-index:2300;display:flex;flex-direction:column;';
    var dlBtnHtml = expired
      ? '<div style="flex:1;max-width:260px;text-align:center;font-size:12px;color:#aaa;align-self:center;">⏳ 보관기간(1주일) 만료 — 원본 다운로드 불가</div>'
      : '<button class="btn b-blue" id="tpDownload" style="flex:1;max-width:260px;justify-content:center;">⬇ 원본 다운로드 (' + fmtSize(f.size) + ')</button>';
    ov.innerHTML =
      '<div style="flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;min-height:0;position:relative;">' +
        '<img src="' + f.thumb + '" style="max-width:100%;max-height:100%;object-fit:contain;">' +
        (f.kind === 'video' ? '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:56px;color:rgba(255,255,255,.85);text-shadow:0 2px 12px #000;pointer-events:none;">▶</div>' : '') +
      '</div>' +
      '<div style="flex-shrink:0;text-align:center;font-size:11px;color:#999;padding:0 16px 6px;">' + esc(f.name || '') + ' · 미리보기(썸네일)' + (f.kind === 'video' && f.duration ? ' · ' + fmtDur(f.duration) : '') + '</div>' +
      '<div style="flex-shrink:0;display:flex;gap:8px;padding:6px 16px calc(12px + env(safe-area-inset-bottom));justify-content:center;">' +
        dlBtnHtml +
        '<button class="btn b-ghost" id="tpClose" style="flex:1;max-width:140px;justify-content:center;">닫기</button>' +
      '</div>';
    document.body.appendChild(ov);
    var close = function () { if (ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.querySelector('#tpClose').onclick = close;
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    var dl = ov.querySelector('#tpDownload');
    if (dl) dl.onclick = function () {
      close();
      downloadChatFile(roomId, mid);  // 완료되면 이미지/영상 원본이 바로 열림
    };
  }

  function showFileViewer(innerHtml, g) {
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.95);z-index:2300;display:flex;flex-direction:column;';
    ov.innerHTML =
      '<div style="flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;min-height:0;">' + innerHtml + '</div>' +
      '<div style="flex-shrink:0;display:flex;gap:8px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));justify-content:center;">' +
        '<button class="btn b-ghost" id="cfShare" style="flex:1;max-width:180px;justify-content:center;">📤 공유/저장</button>' +
        '<button class="btn b-ghost" id="cfClose" style="flex:1;max-width:180px;justify-content:center;">닫기</button>' +
      '</div>';
    document.body.appendChild(ov);
    var close = function () { try { var v = ov.querySelector('video'); if (v) v.pause(); } catch (e) {} if (ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.querySelector('#cfClose').onclick = close;
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('#cfShare').onclick = function () { shareOrSaveFile(g); };
  }

  function shareOrSaveFile(g) {
    try {
      var file = new File([g.blob], g.name, { type: g.type || 'application/octet-stream' });
      if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        navigator.share({ files: [file] }).catch(function (e) { if (!e || e.name !== 'AbortError') _fallbackSave(g); });
        return;
      }
    } catch (e) {}
    _fallbackSave(g);
  }
  function _fallbackSave(g) {
    try {
      var a = document.createElement('a');
      a.href = g.url; a.download = g.name || 'file';
      document.body.appendChild(a); a.click(); a.remove();
      toast('파일을 저장했습니다', 'ok');
    } catch (e) { toast('열기/저장 실패', 'err'); }
  }

  /* ════════ 전송 / 읽음 처리 ════════ */
  function _reconcilePending(roomId, arr){
    var lst = _pending[roomId]; if (!lst || !lst.length) return;
    var have = {}; arr.forEach(function(m){ if (m.clientId) have[m.clientId] = 1; });
    _pending[roomId] = lst.filter(function(t){ return !have[t._tempId]; });   // 서버 확정된 임시메시지 제거(중복 방지)
  }
  CloudChat.send = function(roomId, text){
    text = (text || '').trim();
    if (!text) return Promise.resolve();
    if (!loggedIn()) { toast('먼저 로그인해주세요','err'); return Promise.reject(); }
    // ★ 낙관적 표시: 서버 왕복을 기다리지 않고 즉시 화면에 띄운다(1:1처럼 빠른 체감)
    var tempId = 'tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    var temp = { _tempId: tempId, _pending: true, text: text, senderUid: myUid(), senderName: myName(), _localTime: Date.now() };
    _pending[roomId] = _pending[roomId] || [];
    _pending[roomId].push(temp);
    bumpPoll();   // 내가 말을 걸었다 → 답장 대비해 폴링 간격 최소로
    if (_openRoomId === roomId && _viewMode === 'chat') renderMessages(roomId);
    return db().collection('rooms').doc(roomId).collection('messages').add({
      text: text, senderUid: myUid(), senderName: myName(), clientId: tempId,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function(){
      // ★ 여기 도달 = 서버가 실제 커밋을 확인함(캐시 아님). 이제야 '전송 중' 해제.
      temp._pending = false;
      if (_openRoomId === roomId && _viewMode === 'chat') renderMessages(roomId);
      // 방 요약 갱신은 메시지 전달과 무관하게 fire-and-forget (실패해도 메시지엔 영향 없음)
      db().collection('rooms').doc(roomId).set({
        lastMessage: text.slice(0, 80),
        lastMessageAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }).catch(function(){});
    }).catch(function(e){
      console.warn('[CloudChat] 전송 실패', e);
      temp._pending = false; temp._failed = true;   // 사라지지 않고 '실패 · 재시도'로 남김
      temp._errCode = (e && (e.code || e.message)) || '알수없음';
      toast('전송 실패: ' + temp._errCode, 'err');
      if (_openRoomId === roomId && _viewMode === 'chat') renderMessages(roomId);
    });
  };
  var _lastMarkReadWrite = {};
  function markRead(roomId){
    if (!loggedIn()) return;
    if (_rooms[roomId]) { _rooms[roomId].lastRead = _rooms[roomId].lastRead || {}; _rooms[roomId].lastRead[myUid()] = Date.now(); }
    notifyBadge();
    var now = Date.now();
    if (_lastMarkReadWrite[roomId] && (now - _lastMarkReadWrite[roomId]) < 4000) return;   // ★ 서버 쓰기 4초 스로틀(쓰기폭주 방지)
    _lastMarkReadWrite[roomId] = now;
    var patch = {}; patch[myUid()] = firebase.firestore.FieldValue.serverTimestamp();
    db().collection('rooms').doc(roomId).set({ lastRead: patch }, { merge: true }).catch(function(){});
  }

  /* ════════ 탭/화면 전환 ════════ */
  CloudChat.openTab = function(){
    if (!loggedIn()) {
      var body = document.getElementById('chatTabBody');
      if (body) body.innerHTML = '<div style="text-align:center;color:var(--mu);font-size:13px;padding:40px 16px;">☁️ 먼저 설정에서 로그인해주세요.</div>';
      return;
    }
    if (window.Subs && !Subs.hasFeature('chat')) {
      var body2 = document.getElementById('chatTabBody');
      if (body2) body2.innerHTML = '<div style="text-align:center;color:var(--mu);font-size:13px;padding:40px 16px;line-height:1.7;">💬 채팅은 구독 사용자 전용 기능입니다.<br><button class="btn b-blue" style="margin-top:12px;" onclick="if(window.Subs)Subs.openPlans()">⭐ 요금제 보기</button></div>';
      return;
    }
    // ★ 단일 방 정책: 목록/방개설 없이 대표(팀) 방으로 바로 입장
    var rid = pickPrimaryRoomId();
    if (rid && _rooms[rid]) { CloudChat.openConversation(rid); return; }
    var puids = Object.keys(_partners);
    if (puids.length === 1) { CloudChat.openOrCreateDirect(puids[0]); return; }
    _viewMode = 'chat'; _openRoomId = null;
    renderChatTabBody();
    _waitRoomTries = 0; _waitForRoom();
  };
  CloudChat.openConversation = function(roomId){
    if (!_rooms[roomId]) { toast('채팅방을 찾을 수 없습니다','err'); return; }
    _openRoomId = roomId;
    _viewMode = 'chat';
    renderChatTabBody();
    markRead(roomId);
    pullMessagesNow(roomId);
    bumpPoll();   // 방 열기 = 대화 시작 → 폴링 간격 최소로
  };
  // 푸시 알림을 눌러 앱이 막 켜진 경우처럼, rooms 구독이 아직 안 끝났을 수 있어 잠시 재시도한다.
  CloudChat.openConversationWhenReady = function(roomId, attempts){
    attempts = attempts || 0;
    if (_rooms[roomId]) { CloudChat.openConversation(roomId); return; }
    if (attempts > 20) { console.warn('[CloudChat] 방을 찾지 못해 자동 열기 포기', roomId); return; }
    setTimeout(function(){ CloudChat.openConversationWhenReady(roomId, attempts + 1); }, 500);
  };

  var _waitRoomTries = 0;
  // 대표 방 = 팀방 우선, 없으면 가장 최근 방
  function pickPrimaryRoomId(){
    var ids = Object.keys(_rooms);
    if (!ids.length) return null;
    var team = ids.filter(function(id){ return _rooms[id].teamId || id.indexOf('team_')===0; });
    var pool = team.length ? team : ids;
    pool.sort(function(a,b){ return (_rooms[b].lastMessageAtMs||0) - (_rooms[a].lastMessageAtMs||0); });
    return pool[0];
  }
  // 팀방 자동생성/구독 지연 대비 짧게 재시도
  function _waitForRoom(){
    if (!tabOpen()) return;
    if (_openRoomId && _rooms[_openRoomId]) return;
    var rid = pickPrimaryRoomId();
    if (rid && _rooms[rid]) { CloudChat.openConversation(rid); return; }
    if ((_waitRoomTries = (_waitRoomTries||0) + 1) > 10) return;
    setTimeout(_waitForRoom, 700);
  }

  function renderChatTabBody(){
    var body = document.getElementById('chatTabBody');
    if (!body) return;
    // ★ 단일 방 정책: 열린 방 없으면 대표(팀) 방 자동 선택
    if (!(_viewMode === 'chat' && _openRoomId && _rooms[_openRoomId])) {
      var rid = pickPrimaryRoomId();
      if (rid && _rooms[rid]) { _openRoomId = rid; _viewMode = 'chat'; bumpPoll(); }   // ★ 폴백으로 방이 열릴 때도 폴링 5초로 되돌림(2026-08-24)
    }
    if (_viewMode === 'chat' && _openRoomId && _rooms[_openRoomId]) {
      // 같은 방 대화창이 이미 그려져 있으면 입력창은 그대로 두고 동적 부분만 갱신한다.
      // (rooms 스냅샷마다 innerHTML을 새로 그리면 입력 중 글자가 지워지고 포커스를 잃어 '입력이 안되는' 현상이 생김)
      if (_renderedRoomId === _openRoomId && document.getElementById('chatInput')) {
        var _tt = document.getElementById('chatRoomTitle');
        if (_tt) _tt.textContent = roomTitle(_openRoomId);
        renderMessages(_openRoomId);
        renderParticipants(_openRoomId);
        return;
      }
      _renderedRoomId = _openRoomId;
      body.innerHTML = conversationHtml();
      wireConversation(_openRoomId);
      renderMessages(_openRoomId);
      renderParticipants(_openRoomId);
      markRead(_openRoomId);
    } else {
      _renderedRoomId = null;
      var pc = Object.keys(_partners).length;
      body.innerHTML = pc
        ? '<div style="text-align:center;color:var(--mu);font-size:13px;padding:40px 16px;">💬 채팅방 준비 중...</div>'
        : '<div style="text-align:center;color:var(--mu);font-size:13px;padding:40px 16px;line-height:1.7;">아직 공유 중인 상대가 없습니다.<br>설정에서 일정 공유 또는 팀 공유를 시작하면<br>모두가 함께 쓰는 그룹 채팅방이 자동으로 열립니다.</div>';
    }
  }


  /* ── 대화 상세 ── */
  // 채팅방 글자 기준 상향: 화면설정 '아주크게'(최대) 배율을 채팅방 '보통'처럼 보이게
  //   (사용자 요청 2026-07-29). .rd-body의 사용자 zoom 위에 이 배율을 덧입혀(중첩) 적용.
  //   목록 화면은 제외, 대화방 루트에만 적용.
  function chatFontBoost(){
    try { if (typeof FS_SIZES !== 'undefined' && FS_SIZES.length) return (FS_SIZES[FS_SIZES.length - 1].value / 15).toFixed(3); } catch(e){}
    return '1.44';
  }
  function conversationHtml(){
    return (
      '<div style="zoom:' + chatFontBoost() + ';display:flex;flex-direction:column;height:100%;">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-shrink:0;">' +
          '<div style="font-size:14px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" id="chatRoomTitle"></div>' +
        '</div>' +
        '<div id="chatParticipants" style="font-size:11px;color:var(--mu);margin-bottom:10px;flex-shrink:0;"></div>' +
        '<div id="chatMsgList" style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:8px;padding-bottom:8px;"></div>' +
        '<div style="display:flex;gap:6px;padding-top:10px;border-top:1px solid var(--bd);flex-shrink:0;">' +
          '<button class="btn b-ghost" id="chatFileBtn" style="padding:0 12px;font-size:16px;" title="파일 보내기">📎</button>' +
          '<input type="file" id="chatFileInput" style="display:none;" accept="image/*,video/*,.pdf,.hwp,.hwpx,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip">' +
          '<input class="co-input" id="chatInput" type="text" placeholder="메시지 입력..." style="flex:1;">' +
          '<button class="btn b-blue" id="chatSendBtn">전송</button>' +
        '</div>' +
      '</div>'
    );
  }
  function wireConversation(roomId){
    var title = document.getElementById('chatRoomTitle');
    if (title) title.textContent = roomTitle(roomId);
    var sendBtn = document.getElementById('chatSendBtn');
    var inp = document.getElementById('chatInput');
    function doSend(){
      if (!inp) return;
      var t = inp.value;
      if (!t.trim()) return;
      inp.value = '';
      CloudChat.send(roomId, t);
    }
    if (sendBtn) sendBtn.onclick = doSend;
    if (inp) inp.addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); doSend(); } });
    var fb = document.getElementById('chatFileBtn');
    var fi = document.getElementById('chatFileInput');
    if (fb && fi) {
      fb.onclick = function(){ fi.click(); };
      fi.onchange = function(){
        var f = fi.files && fi.files[0];
        fi.value = '';
        if (f) CloudChat.sendFile(roomId, f);
      };
    }
  }
  function renderParticipants(roomId){
    var box = document.getElementById('chatParticipants');
    if (!box) return;
    var list = participantsOf(roomId);
    var h = '👥 참가자 ' + list.length + '명&nbsp; ';
    h += list.map(function(u){ return (u.online ? '🟢' : '⚫') + ' ' + esc(u.name); }).join(' &nbsp;·&nbsp; ');
    box.innerHTML = h;
  }
  function _isEmojiOnly(t){
    t = (t || '').replace(/[\s\uFE0F\u200D]/g, '');
    if (!t) return false;
    try { return /^(?:\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}])+$/u.test(t); } catch (e) { return false; }
  }
  function _msgTime(m){ return (m.createdAt && m.createdAt.toMillis) ? m.createdAt.toMillis() : (m._localTime || 0); }
  function renderMessages(roomId){
    var list = document.getElementById('chatMsgList');
    if (!list) return;
    var room = _rooms[roomId] || {};
    var _pend = _pending[roomId] || [];
    var _pc = {}; _pend.forEach(function(t){ if (t._tempId) _pc[t._tempId] = 1; });
    var arr = (_messages[roomId] || []).filter(function(m){ return !(m.clientId && _pc[m.clientId]); }).concat(_pend);   // 확정 + 보내는중/실패(중복 clientId 제거)
    arr.sort(function(a2, b2){ return _msgTime(a2) - _msgTime(b2); });   // ★ 항상 시간순 정렬
    var h = '';
    if (!arr.length) h = '<div style="text-align:center;color:var(--mu);font-size:12px;padding:20px 0;">아직 메시지가 없습니다. 첫 메시지를 보내보세요.</div>';
    arr.forEach(function(m){
      var mine = m.senderUid === myUid();
      var _emojiBig = (!m.file && _isEmojiOnly(m.text));   // 이모티콘만 있는 메시지 → 크게
      var t = m.createdAt && m.createdAt.toDate ? m.createdAt.toDate() : (m._localTime ? new Date(m._localTime) : null);
      var timeStr = t ? (t.getHours() + ':' + ('0' + t.getMinutes()).slice(-2)) : '';
      var meta;
      if (m._failed) meta = '<span style="color:var(--dn,#e5484d);font-weight:700;">⚠ 전송 실패' + (m._errCode ? '(' + esc(m._errCode) + ')' : '') + ' · 눌러서 재시도</span>';
      else if (m._pending) meta = '<span style="color:var(--mu);">전송 중…</span>';
      else { var unread = unreadCountForMessage(room, m); meta = (unread > 0 ? '<span style="color:var(--wn);font-weight:700;">' + unread + '</span> ' : '') + esc(timeStr); }
      var body;
      var isThumbMsg = false;
      if (m.file) {
        // ★ 파일 메시지 말풍선
        var f = m.file;
        var got = _fileBlobs[m.id];
        var expired = fileExpired(m);
        if (f.thumb) {
          // 카톡처럼 썸네일로 표시 (탭 = 다운로드/열기)
          isThumbMsg = true;
          var stateTx = got ? '📂 눌러서 원본 열기'
            : (expired ? '⏳ 보관기간(1주일) 만료 — 미리보기만 가능'
              : '👆 눌러서 미리보기 · 원본 ' + fmtSize(f.size));
          body = '<div class="chat-thumb" data-mid="' + m.id + '" style="position:relative;cursor:pointer;border-radius:10px;overflow:hidden;">' +
              '<img src="' + f.thumb + '" style="display:block;width:200px;max-width:100%;height:auto;' + ((expired && !got) ? 'filter:grayscale(1) brightness(.55);' : '') + '">' +
              (f.kind === 'video' ? '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:36px;color:#fff;text-shadow:0 1px 8px #000;pointer-events:none;">▶</div>' : '') +
              (f.kind === 'video' && f.duration ? '<div style="position:absolute;right:6px;bottom:6px;background:rgba(0,0,0,.65);color:#fff;font-size:10px;padding:1px 6px;border-radius:6px;">' + fmtDur(f.duration) + '</div>' : '') +
            '</div>' +
            '<div style="margin-top:4px;font-size:11px;color:var(--mu);">' + stateTx + '</div>';
        } else {
          var actionHtml;
          if (got) {
            actionHtml = '<button class="btn b-ghost b-xs chat-file-open" data-mid="' + m.id + '" style="justify-content:center;">📂 열기</button>';
          } else if (expired) {
            actionHtml = '<div style="font-size:11px;opacity:.75;">⏳ 보관기간(1주일) 만료 — 다운로드 불가</div>';
          } else {
            actionHtml = '<button class="btn b-ghost b-xs chat-file-dl" data-mid="' + m.id + '" style="justify-content:center;">⬇ 다운로드 (' + fmtSize(f.size) + ')</button>';
          }
          body = '<div style="display:flex;align-items:center;gap:8px;">' +
              '<span style="font-size:22px;">' + fileIconOf(f.kind || fileKindOf(f.type, f.name)) + '</span>' +
              '<span style="font-size:12px;word-break:break-all;min-width:0;">' + esc(f.name || '파일') + '</span>' +
            '</div>' +
            '<div style="margin-top:6px;">' + actionHtml + '</div>';
        }
      } else {
        body = esc(m.text);
      }
      h += '<div ' + (m._failed ? 'class="chat-retry" data-temp="' + m._tempId + '" ' : '') + 'style="display:flex;flex-direction:column;align-items:' + (mine ? 'flex-end' : 'flex-start') + ';' + (m._pending ? 'opacity:.55;' : '') + (m._failed ? 'cursor:pointer;' : '') + '">' +
        (!mine ? '<div style="font-size:11px;color:' + _senderColor(m.senderUid) + ';margin-bottom:2px;font-weight:700;">' + esc(_senderNick(m)) + '</div>' : '') +
        '<div style="max-width:75%;padding:' + (_emojiBig ? '2px 2px' : (isThumbMsg ? '4px' : '8px 12px')) + ';border-radius:14px;font-size:' + (_emojiBig ? '60px' : '13px') + ';line-height:1.2;white-space:pre-wrap;word-break:break-word;background:' +
          (_emojiBig ? 'transparent' : (mine && !m.file ? 'var(--ac)' : 'var(--sf2)')) + ';color:' + (_emojiBig ? 'inherit' : (mine && !m.file ? '#fff' : 'inherit')) + ';">' + body + '</div>' +
        '<div style="font-size:10px;color:var(--mu);margin-top:2px;">' + meta + '</div>' +
      '</div>';
    });
    list.innerHTML = h;
    list.querySelectorAll('.chat-file-dl').forEach(function(b){
      b.onclick = function(){ downloadChatFile(roomId, b.getAttribute('data-mid')); };
    });
    list.querySelectorAll('.chat-file-open').forEach(function(b){
      b.onclick = function(){ openChatFile(b.getAttribute('data-mid')); };
    });
    list.querySelectorAll('.chat-thumb').forEach(function(el){
      el.onclick = function(){
        var mid = el.getAttribute('data-mid');
        if (_fileBlobs[mid]) openChatFile(mid);       // 이미 받았으면 원본 바로 열기
        else openThumbPreview(roomId, mid);           // 아니면 미리보기 → 그 안에서 다운로드
      };
    });
    list.querySelectorAll('.chat-retry').forEach(function(el){
      el.onclick = function(){
        var tid = el.getAttribute('data-temp'); if (!tid) return;
        var arr2 = _pending[roomId] || [];
        for (var i = 0; i < arr2.length; i++) { if (arr2[i]._tempId === tid) { var msg = arr2[i]; arr2.splice(i, 1); CloudChat.send(roomId, msg.text); break; } }
      };
    });
    list.scrollTop = list.scrollHeight;
  }

  function cleanup(){
    if (_sharesUnsub) { try { _sharesUnsub(); } catch(e){} _sharesUnsub = null; }
    if (_roomsUnsub) { try { _roomsUnsub(); } catch(e){} _roomsUnsub = null; }
    Object.keys(_msgUnsubs).forEach(function(k){ try { _msgUnsubs[k](); } catch(e){} });
    Object.keys(_roomDocUnsubs).forEach(function(k){ try { _roomDocUnsubs[k](); } catch(e){} });
    Object.keys(_presenceUnsubs).forEach(function(k){ try { _presenceUnsubs[k](); } catch(e){} });
    _msgUnsubs = {}; _roomDocUnsubs = {}; _presenceUnsubs = {}; _presencePaused = false; _chatPaused = false;
    _messages = {}; _pending = {}; _rooms = {}; _partners = {}; _presence = {};
    _viewMode = 'list'; _openRoomId = null;
    if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
    if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
    if (_msgPollTimer) { clearTimeout(_msgPollTimer); _msgPollTimer = null; }
    updateTabVisibility();
    if (tabOpen()) renderChatTabBody();
  }
  document.addEventListener('cloud-auth-changed', function(e){
    if (e && e.detail && e.detail.user) { CloudChat.ensure(); }
    else { cleanup(); }
  });
})();
