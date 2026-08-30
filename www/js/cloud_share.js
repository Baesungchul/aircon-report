/* ═══════════════════════════════════════════════
   CLOUD SHARE ─ 아이디 간 일정 공유 (요청/수락 + 상대 구독)
   - shares/{pairId}: members[정렬], requestedBy, fromName, toName, status
   - 수락된 상대의 schedules/{uid}/items 를 직접 읽기(pull) + 실시간 구독(onSnapshot) 병행
     (WebView에서 Listen 스트림이 불안정해도 pull로 확실히 채워짐)
═══════════════════════════════════════════════ */
(function () {
  'use strict';
  window.CloudShare = window.CloudShare || {};

  var _sharesUnsub = null;
  var _partnerUnsubs = {};       // partnerUid -> unsubscribe fn
  var _partnerItems = {};        // partnerUid -> [calItem]
  var _partnerNames = {};        // partnerUid -> name
  var _shares = [];
  var _teamPartners = {};       // ★ 팀 공유(CloudTeams)로 주입된 팀원 uid->name

  function loggedIn() { return window.Cloud && Cloud.ready && Cloud.user; }
  function db() { return Cloud.db; }
  function myUid() { return Cloud.user.uid; }
  function myName() { return Cloud.user.displayName || Cloud.user.email || ''; }
  function pid(a, b) { return a < b ? a + '_' + b : b + '_' + a; }
  function otherUid(s) { return (s.members || []).filter(function (u) { return u !== myUid(); })[0] || ''; }
  function otherName(s) { return (s.requestedBy === myUid()) ? (s.toName || '상대') : (s.fromName || '상대'); }
  function esc(s){ return String(s||'').replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function toast(m,t){ if (typeof showToast==='function') showToast(m,t||'ok'); else alert(m); }
  var _refreshTimer = null;
  function refreshCal(){
    if (typeof window.__calendarRefresh !== 'function') return;
    clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(function(){ try { window.__calendarRefresh(); } catch(e){} }, 500);
  }

  /* ════════ 공유 요청 / 수락 / 해제 ════════ */
  CloudShare.sendRequest = async function (email, photoRole) {
    if (!loggedIn()) { toast('먼저 로그인해주세요','err'); return; }
    if (window.Subs && !Subs.gateFeature('share', '일정공유')) return;  // ★ 구독 전용
    email = (email||'').trim().toLowerCase();
    if (!email) { toast('상대 이메일을 입력해주세요','err'); return; }
    if (email === (Cloud.user.email||'').toLowerCase()) { toast('본인은 추가할 수 없습니다','err'); return; }
    try {
      var snap = await db().collection('users').where('shareCode','==',email).limit(1).get();
      if (snap.empty) { toast('해당 이메일의 사용자를 찾을 수 없습니다','err'); return; }
      var partner = snap.docs[0];
      var pUid = partner.id;
      var pName = (partner.data().displayName) || email;
      var id = pid(myUid(), pUid);
      var existing = _shares.filter(function(s){ return s.id === id; })[0];
      if (existing) {
        if (existing.status === 'accepted') toast('이미 공유 중입니다','ok');
        else if (existing.requestedBy === myUid()) toast('이미 요청을 보냈습니다 (상대 수락 대기중)','ok');
        else toast('상대가 보낸 요청이 있어요. 받은 요청에서 수락해주세요.','ok');
        return;
      }
      await db().collection('shares').doc(id).set({
        members: [myUid(), pUid].sort(),
        requestedBy: myUid(),
        fromName: myName(),
        toName: pName,
        status: 'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      toast('공유 요청을 보냈습니다. 상대가 수락하면 일정이 공유됩니다.','ok');
      pullShares();
    } catch (e) {
      console.warn('[CloudShare] 요청 실패', e);
      toast('요청 실패: ' + (e && (e.message||e.code)), 'err');
    }
  };

  CloudShare.accept = async function (pairId) {
    if (window.Subs && !Subs.gateFeature('share', '일정공유')) return;  // ★ 구독 전용 (수락도 구독 필요)
    try {
      await db().collection('shares').doc(pairId).update({
        status: 'accepted', acceptedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      toast('수락했습니다. 이제 서로의 일정이 공유됩니다.','ok');
      pullShares();
    } catch (e) { toast('수락 실패: ' + (e && e.code), 'err'); }
  };
  CloudShare.reject = async function (pairId) {
    try { await db().collection('shares').doc(pairId).delete(); toast('요청을 처리했습니다.','ok'); pullShares(); }
    catch (e) { toast('처리 실패: ' + (e && e.code), 'err'); }
  };
  CloudShare.remove = async function (pairId) {
    if (!confirm('이 공유를 해제할까요?')) return;
    try { await db().collection('shares').doc(pairId).delete(); toast('공유를 해제했습니다.','ok'); pullShares(); }
    catch (e) { toast('해제 실패: ' + (e && e.code), 'err'); }
  };

  /* ════════ shares 처리 (pull + 실시간 구독) ════════ */
  function processShares(docs) {
    _shares = [];
    docs.forEach(function (doc) { _shares.push(Object.assign({ id: doc.id }, doc.data())); });
    syncPartnerSubscriptions();
    renderArea();
  }

  // 직접 1회 읽기 (확실히 채움)
  function pullShares() {
    if (!loggedIn()) return;
    db().collection('shares').where('members','array-contains', myUid()).get()
      .then(function(snap){ processShares(snap.docs); })
      .catch(function(e){ console.warn('[CloudShare] shares 읽기 실패', e && e.code); });
  }

  function subscribeShares() {
    if (!loggedIn()) { _shares = []; renderArea(); return; }
    if (_sharesUnsub) return;  // ★ 이미 구독 중이면 아무것도 다시 하지 않음 (성능)
    pullShares();   // 최초 1회 즉시 읽기
    subscribeOwn(); // 최초 1회 (내 일정에 대한 상대 수정 오버레이)
    _sharesUnsub = db().collection('shares').where('members','array-contains', myUid())
      .onSnapshot(function (snap) { processShares(snap.docs); },
                  function (err) { console.warn('[CloudShare] shares 구독 오류', err && err.code); });
  }

  CloudShare.ensure = function(){ if (loggedIn()) subscribeShares(); };

  /* ★ 2026-08-11 배터리 개선 — 앱이 백그라운드일 땐 일정공유 실시간 리스너를 모두 끊는다.
       cloud_chat.js의 presence 일시정지(2026-08-08)와 같은 이유: 화면에 보이지도 않는데
       상대/팀원 각자의 일정 쓰기마다(그리고 내 일정 전체 컬렉션 - 날짜 필터 없음) 매번
       기기가 깨어난다. 여기엔 shares 목록·내 일정(subscribeOwn)·상대별 일정(subscribePartner)·
       상대별 프로필(_subProfile) 리스너가 전부 걸린다 - 팀원이 여러 명이면 상시 리스너가
       여러 개 켜져 있는 셈. 복귀 시 subscribeShares()를 다시 부르면(내부 가드가 null 체크라
       그대로 재사용 가능) 최신 상태를 즉시 다시 읽어와 동일하게 복구된다. */
  var _shareSyncPaused = false;
  function pauseShareSync(){
    if (_shareSyncPaused) return;
    _shareSyncPaused = true;
    if (_sharesUnsub) { try { _sharesUnsub(); } catch(e){} _sharesUnsub = null; }
    if (_ownUnsub) { try { _ownUnsub(); } catch(e){} _ownUnsub = null; }
    Object.keys(_partnerUnsubs).forEach(function(ou){ try { _partnerUnsubs[ou](); } catch(e){} });
    _partnerUnsubs = {};
    Object.keys(_profileUnsubs).forEach(function(uid){ try { _profileUnsubs[uid](); } catch(e){} });
    _profileUnsubs = {};
  }
  function resumeShareSync(){
    if (!_shareSyncPaused) return;
    _shareSyncPaused = false;
    if (!loggedIn()) return;
    subscribeShares();   // 내부 가드가 null이라 shares/내일정/상대일정/프로필을 모두 재구독
  }
  document.addEventListener('visibilitychange', function(){
    if (document.hidden) pauseShareSync(); else resumeShareSync();
  });
  // Capacitor 네이티브에서 visibilitychange가 안 오는 경우 대비(이중 안전망) - cloud_chat.js와 동일 패턴
  try {
    var _AppSh = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (_AppSh && _AppSh.addListener) {
      _AppSh.addListener('appStateChange', function(st){
        if (st && st.isActive === false) pauseShareSync(); else resumeShareSync();
      });
    }
  } catch(e){}

  function syncPartnerSubscriptions() {
    var accepted = {};
    _shares.forEach(function (s) {
      if (s.status === 'accepted') {
        var ou = otherUid(s);
        if (ou) { accepted[ou] = otherName(s); _partnerNames[ou] = otherName(s); }
      }
    });
    // ★ 팀 공유(CloudTeams) 팀원도 파트너로 포함
    Object.keys(_teamPartners).forEach(function (ou) {
      if (ou && ou !== myUid()) { accepted[ou] = _teamPartners[ou]; _partnerNames[ou] = _teamPartners[ou]; }
    });
    Object.keys(accepted).forEach(function (ou) { subscribePartner(ou); _subProfile(ou); });
    try { setupWorkerCombo(); } catch(e){}
    Object.keys(_partnerUnsubs).forEach(function (ou) {
      if (!accepted[ou]) { try { _partnerUnsubs[ou](); } catch(e){} delete _partnerUnsubs[ou]; delete _partnerItems[ou]; }
    });
    try { if (window.Cloud && Cloud.updateUI) Cloud.updateUI(); } catch(e){}  // ★ 로그인 라벨 공유 인원수 갱신
  }

  var _myManualItems = [];  // 내가 만든 수동 일정 (cal item 형태)
  var _myTrashedItems = []; // 내가 휴지통으로 보낸 내 항목 (cal item 형태)
  var _appliedHash = {};    // workId -> 마지막으로 로컬에 반영한 상대수정 해시 (중복반영 방지)
  var _applyingLocal = {};   // 로컬 반영 진행중 (동시 실행 방지)
  var _applyFails = {};      // 로컬 반영 연속 실패 횟수 (3회면 포기)
  var _lastTriedHash = {};   // 마지막으로 시도한 수정 내용 (내용이 바뀌면 실패 횟수 초기화)
  var _ordApplied = {};      // 상대가 바꾼 사진 순서를 로컬에 반영한 기록 (중복 반영 방지)
  var _ordApplying = {};     // 순서 반영 진행중 (동시 실행 방지)
  var _deletedClaimed = {}; // 상대가 가져가 삭제 처리한 내 항목 docId (중복 삭제 방지)

  function toCalItem(d, docId, pUid) {
    return {
      type: 'shared',
      sortDate: (d.date||'') + 'T' + (d.startTime || '00:00'),
      data: {
        date: d.date, apt: d.apt || '', workType: d.workType || 'home',
        price: d.price || 0, startTime: d.startTime || '', endTime: d.endTime || '',
        totalUnits: d.totalUnits || 0, totalPhotos: d.totalPhotos || 0,
        unitNames: d.unitNames || [], name: d.name || '', target: d.target || '', memo: d.memo || '',
        phone: d.phone || '', address: d.address || '',
        workId: d.workId || docId, manual: !!d.manual, claimedBy: d.claimedBy || null,
        worker: d.worker || '',
        posts: d.posts || 0,   // ★ 2026-08-13 공유 카드 ✍️ 글 배지용 (개수만)
        /* ⭐ 2026-08-16 버그수정 — 공유 카드에 업종 아이콘이 안 나오던 원인.
           toPayload(올리기)에만 넣고 여기(받아서 카드로 만들기)에 안 넣었다.
           toCalItem 은 서버 문서에서 '쓸 필드만 골라 담는' 화이트리스트라
           여기 없는 필드는 카드까지 도달하지 못한다.
           ⚠️ 공유 요약에 필드를 추가할 땐 toPayload + toCalItem 을 **항상 같이** 고칠 것. */
        profileId: d.profileId || '',
        profileIcon: d.profileIcon || '',
        profileName: d.profileName || '',
        profileSnap: d.profileSnap || null,   // 보고서 제목·호수/단계 호칭까지
        endDate: d.endDate || '',
        photoOrder: d.photoOrder || null,  // ★ 2026-07-11: 순서편집 동기화 (openInWorkTab 정렬용)
        addedPhotos: d.addedPhotos || 0,   // ★ 2026-07-11: 상대가 보탠 사진 수 (구분 표시용)
        trashed: !!d.trashed, trashedAt: d.trashedAt || null,
        ownerUid: pUid, partnerUid: pUid,
        partnerName: (pUid === myUid()) ? '내 일정' : (_partnerNames[pUid] || '상대')
      }
    };
  }

  function mapItems(snap, pUid) {
    var arr = [];
    snap.forEach(function (doc) {
      var d = doc.data() || {};
      if (!d.date) return;
      arr.push(toCalItem(d, doc.id, pUid));
    });
    return arr;
  }

  /* ★ 2026-08-08 읽기 비용/시작속도 개선
       기존: 상대의 items 컬렉션을 '전체 기간' 통째로 .get() 한 뒤, 같은 쿼리를 onSnapshot 으로 또 구독했다.
             → ① 3년치 수백~수천 건을 받아놓고 화면엔 그 달만 씀  ② 구독의 최초 스냅샷도 과금되어 시작 시 2배 읽기
       개선: ① 최근 WINDOW_MONTHS(24개월)치만 구독한다 (date 단일 필드 조건이라 복합 인덱스 불필요)
             ② 중복 .get() 제거 — onSnapshot 이 즉시 최초 스냅샷을 주므로 없어도 동일하게 채워진다
             ③ 창 밖(더 오래된 달)로 달력을 넘기면 그 달만 1회 불러와 캐시한다 → 과거 조회 기능은 그대로 유지 */
  var WINDOW_MONTHS = 24;
  var _oldMonthCache = {};   // 'pUid|YYYY-MM' -> [calItem]  (구독 창 밖의 과거 달 온디맨드 캐시)
  var _oldMonthBusy = {};
  function _windowStartDate() {
    var d = new Date();
    d.setMonth(d.getMonth() - WINDOW_MONTHS);
    return d.getFullYear() + '-' + _pad2(d.getMonth() + 1) + '-01';
  }
  function _pad2(n){ return (n < 10 ? '0' : '') + n; }
  function subscribePartner(pUid) {
    if (_partnerUnsubs[pUid]) return;  // ★ 이미 구독 중 → 재읽기 안 함 (성능)
    _partnerUnsubs[pUid] = db().collection('schedules').doc(pUid).collection('items')
      .where('date', '>=', _windowStartDate())
      .onSnapshot(function (snap) { _partnerItems[pUid] = mapItems(snap, pUid); refreshCal(); },
                  function (err) { console.warn('[CloudShare] 상대 일정 구독 오류', pUid, err && err.code); });
  }
  // 구독 창보다 오래된 달을 열었을 때만 그 달을 1회 읽어온다(달마다 최초 1회)
  function _loadOldMonth(pUid, monthStr) {
    var key = pUid + '|' + monthStr;
    if (_oldMonthCache[key] || _oldMonthBusy[key]) return;
    _oldMonthBusy[key] = 1;
    db().collection('schedules').doc(pUid).collection('items')
      .where('date', '>=', monthStr + '-01').where('date', '<=', monthStr + '-31')
      .get()
      .then(function (snap) { _oldMonthCache[key] = mapItems(snap, pUid); refreshCal(); })
      .catch(function (e) { console.warn('[CloudShare] 과거 달 읽기 실패', pUid, monthStr, e && e.code); })
      .then(function () { delete _oldMonthBusy[key]; });
  }

  /* ════════ 달력에 줄 shared 아이템 ════════ */
  CloudShare.getItemsForMonth = function (monthStr) {
    var out = [];
    var seen = {};
    function add(it){
      if (it.data && (it.data.claimedBy || it.data.trashed)) return;
      if (monthStr && (it.data.date || '').slice(0,7) !== monthStr) return;
      var k = (it.data.ownerUid || '') + '|' + (it.data.workId || '');   // 캐시/구독 중복 방지
      if (seen[k]) return; seen[k] = 1;
      out.push(it);
    }
    _myManualItems.forEach(add);                                  // 내 수동 일정
    Object.keys(_partnerItems).forEach(function (ou) { (_partnerItems[ou] || []).forEach(add); });  // 상대 일정(구독 창)
    // ★ 구독 창(최근 24개월)보다 오래된 달을 보는 중이면, 그 달만 따로 불러와 함께 보여준다
    if (monthStr && monthStr < _windowStartDate().slice(0, 7)) {
      Object.keys(_partnerUnsubs).forEach(function (ou) {
        var cached = _oldMonthCache[ou + '|' + monthStr];
        if (cached) cached.forEach(add);
        else _loadOldMonth(ou, monthStr);
      });
    }
    return out;
  };
  CloudShare.amIPhotographer = function(){
    return _shares.some(function(s){ return s.status==='accepted' && s.photoUid === myUid(); });
  };
  // ★ 공유 사진 동기화(CloudPhotoSync)용 - 현재 수락된(accepted) 공유 상대가 1명이라도 있는지
  CloudShare.hasAcceptedShare = function(){
    return _shares.some(function(s){ return s.status === 'accepted'; }) || Object.keys(_teamPartners).length > 0;  // ★ 팀원 있으면 공유중
  };
  // ★ 공유 사진 동기화(CloudPhotoSync)용 - 수락된 공유 상대 uid 목록
  CloudShare.getSharedPartnerUids = function(){
    var out = [];
    _shares.forEach(function(s){ if (s.status === 'accepted') out.push(otherUid(s)); });
    Object.keys(_teamPartners).forEach(function(u){ if (u && u !== myUid()) out.push(u); });  // ★ 팀원 포함
    return out.filter(function(v,i,a){ return v && a.indexOf(v) === i; });
  };
  // ★ 팀 공유: CloudTeams 가 팀원 uid->name 맵을 주입. 파트너 구독/사진스코프/작업자콤보에 반영
  CloudShare.setTeamPartners = function(map){
    _teamPartners = map || {};
    Object.keys(_teamPartners).forEach(function(u){ _partnerNames[u] = _teamPartners[u]; });
    try { syncPartnerSubscriptions(); } catch(e){}
    try { renderArea(); } catch(e){}
    try { setupWorkerCombo(); } catch(e){}
    refreshCal();
  };
  CloudShare.addManualSchedule = function(fields){
    if (!loggedIn()) { toast('먼저 로그인해주세요','err'); return Promise.reject(); }
    if (!fields || !fields.date) { toast('날짜를 입력해주세요','err'); return Promise.reject(); }
    var id = 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
    var item = {
      workId: id, date: fields.date, apt: fields.apt || '', workType: 'home',
      price: fields.price || 0, startTime: fields.startTime || '', endTime: fields.endTime || '',
      totalUnits: (fields.unit ? 1 : 0), totalPhotos: 0, unitNames: (fields.unit ? [fields.unit] : []), target: fields.target || '', memo: fields.memo || '',
      phone: fields.phone || '', address: fields.address || '',
      manual: true, createdBy: myUid(), editedBy: myUid(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    return db().collection('schedules').doc(myUid()).collection('items').doc(id).set(item)
      .then(function(){ toast('일정이 추가되었습니다','ok'); refreshCal(); })
      .catch(function(e){ console.warn('[CloudShare] 일정 추가 실패', e); toast('추가 실패: '+(e&&e.code),'err'); throw e; });
  };
  CloudShare.openAddSchedule = function(presetDate, onSaved){
    var ov = document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:1820;display:flex;align-items:center;justify-content:center;padding:16px;';
    ov.innerHTML =
      '<div style="background:var(--sf);border-radius:14px;padding:20px;max-width:440px;width:100%;max-height:calc(100vh - 44px);overflow-y:auto;-webkit-overflow-scrolling:touch;">' +
        '<div style="font-size:16px;font-weight:800;margin-bottom:4px;">📅 일정 추가 (사진 없음)</div>' +
        '<div style="font-size:12px;color:var(--mu);margin-bottom:14px;">사진은 사진 담당이 나중에 추가합니다</div>' +
        '<div style="display:flex;flex-direction:column;gap:10px;">' +
          '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">날짜</label>' +
            '<input class="cust-inp" id="asDate" type="date" value="'+(presetDate||'')+'" style="width:100%;margin-top:4px;"></div>' +
          '<div style="display:flex;gap:8px;">' +
            '<div style="flex:2;"><label style="font-size:12px;color:var(--mu);font-weight:700;">현장/작업명</label>' +
              '<input class="cust-inp" id="asApt" type="text" placeholder="예: ○○아파트 101동" style="width:100%;margin-top:4px;"></div>' +
            '<div style="flex:1;"><label style="font-size:12px;color:var(--mu);font-weight:700;">동호수</label>' +
              '<input class="cust-inp" id="asUnit" type="text" placeholder="예: 101동 502호" style="width:100%;margin-top:4px;"></div>' +
          '</div>' +
          '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">작업대상</label>' +
            '<input class="cust-inp" id="asTarget" type="text" placeholder="예: 벽걸이 2대" style="width:100%;margin-top:4px;"></div>' +
          '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">전화번호</label>' +
            '<input class="cust-inp" id="asPhone" type="text" inputmode="tel" placeholder="010-1234-5678" style="width:100%;margin-top:4px;"></div>' +
          '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">주소</label>' +
            '<input class="cust-inp" id="asAddr" type="text" placeholder="주소" style="width:100%;margin-top:4px;"></div>' +
          '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">가격 (원)</label>' +
            '<input class="cust-inp" id="asPrice" type="text" inputmode="numeric" style="width:100%;margin-top:4px;"></div>' +
          '<div style="display:flex;gap:8px;">' +
            '<div style="flex:1;"><label style="font-size:12px;color:var(--mu);font-weight:700;">시작시간</label>' +
              '<input class="cust-inp" id="asStart" type="time" style="width:100%;margin-top:4px;"></div>' +
            '<div style="flex:1;"><label style="font-size:12px;color:var(--mu);font-weight:700;">종료시간</label>' +
              '<input class="cust-inp" id="asEnd" type="time" style="width:100%;margin-top:4px;"></div>' +
          '</div>' +
          '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">메모</label>' +
            '<textarea class="cust-memo" id="asMemo" rows="2" style="width:100%;margin-top:4px;"></textarea></div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:14px;">' +
          '<button class="btn b-blue" id="asSave" style="flex:1;">추가</button>' +
          '<button class="btn b-ghost" id="asCancel">취소</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    var close=function(){ if(ov&&ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click',function(e){ if(e.target===ov) close(); });
    ov.querySelector('#asCancel').onclick=close;
    ov.querySelector('#asSave').onclick=function(){
      var dt=ov.querySelector('#asDate').value;
      if(!dt){ toast('날짜를 입력해주세요','err'); return; }
      var pr=ov.querySelector('#asPrice').value.trim();
      var fields={ date:dt, apt:ov.querySelector('#asApt').value.trim(),
        unit:ov.querySelector('#asUnit').value.trim(),
        target:ov.querySelector('#asTarget').value.trim(),
        phone:ov.querySelector('#asPhone').value.trim(),
        address:ov.querySelector('#asAddr').value.trim(),
        price: pr===''?0:(parseInt(pr.replace(/[^0-9]/g,''),10)||0),
        startTime:ov.querySelector('#asStart').value, endTime:ov.querySelector('#asEnd').value,
        memo:ov.querySelector('#asMemo').value.trim() };
      close();
      CloudShare.addManualSchedule(fields).then(function(){ if(onSaved)onSaved(); });
    };
  };

  /* ════════ 공유 영역 UI (#cloudShareArea) ════════
     1:1 공유는 폐지되고 팀 공유(👥, #cloudTeamArea)로 일원화됨.
     여기서는 휴지통 등 유틸만 유지한다. */
  function renderArea() {
    var box = document.getElementById('cloudShareArea');
    if (!box) return;
    if (!loggedIn()) { box.innerHTML = ''; return; }

    var h = '';
    // ('📅 일정 추가' 버튼 제거 2026-07-23 — 클라우드에만 저장돼 기록/백업/복구에 안 잡힘. 달력 ＋ 일정추가로 일원화)
    var trashCount = CloudShare.getTrashItems().length;
    h += '<button class="btn b-ghost" id="shareOpenTrash" style="width:100%;justify-content:center;font-size:12px;margin-bottom:8px;">🗑 공유 휴지통' + (trashCount ? (' (' + trashCount + ')') : '') + '</button>';
    h += '<div style="font-size:11px;color:var(--mu);margin-top:8px;line-height:1.5;">여러 명과 함께 쓰려면 아래 <b>👥 팀 공유</b>에서 팀을 만들거나 초대 코드로 참여하세요. 팀원의 일정·사진이 함께 표시됩니다.</div>';

    box.innerHTML = h;

    var otb = document.getElementById('shareOpenTrash');
    if (otb) otb.onclick = function () { CloudShare.openTrash(); };
    try { _injectProfileBtn(); } catch (e) {}
  }

  /* ════════ 내 일정에 대한 상대의 수정 = 오버레이 ════════ */
  function safeIdShare(name){ return String(name||'').replace(/[\/\.\#\$\[\]]/g, '_').slice(0, 200); }
  var _myOverrides = {};   // workId -> {price,startTime,endTime,target,memo}

  /* ════════ 닉네임/색상 프로필 (2026-07-11) ════════
     - users/{uid}: nickname, nickColor (미설정 시 로그인 사용자명 그대로)
     - 채팅 이름, 작업자 콤보, 스케줄 카드 이름 표시에 공통 사용 */
  var _profiles = {};       // uid -> {nickname, nickColor, icons}
  var _iconsPushOnce = false;  // ⚠️ 업종 아이콘 자동 업로드는 세션당 1회만(쓰기 폭주 차단)
  var _profileUnsubs = {};  // uid -> unsub

  /* ★ 2026-08-24 users/{uid} 문서를 두 번 구독하던 것을 한 번으로 합친다.
       예전 구조: 상대 한 명당 리스너가 두 개였다 —
         ① cloud_share._subProfile   (닉네임·색상·업종아이콘)
         ② cloud_chat.subscribePresence (접속중 표시)
       같은 문서를 두 번 듣고 있었으므로, 그 문서가 갱신될 때마다 **문서 전체가 두 번** 내려왔다.
       하필 그 문서에는 심박(lastActive)이 50초마다 쓰이고 업종 아이콘(최대 300KB)도 들어 있어,
       상대가 여럿이면 앱을 켜 둔 내내 같은 데이터를 두 배로 받고 있었다.
       → 여기서 uid 당 하나만 구독하고 여러 소비자에게 나눠 준다. 마지막 소비자가 떨어지면 실제로 끊는다.
       ⚠️ Firestore 는 필드 델타가 아니라 문서 전체를 보내므로, 리스너 수를 줄이는 것이 곧 트래픽 절감이다. */
  var _userDocSubs = {};   // uid -> { unsub, cbs[], last }
  CloudShare.subscribeUserDoc = function (uid, cb) {
    if (!uid || typeof cb !== 'function') return function () {};
    var e = _userDocSubs[uid];
    if (!e) {
      e = _userDocSubs[uid] = { unsub: null, cbs: [], last: null };
      try {
        e.unsub = db().collection('users').doc(uid).onSnapshot(function (doc) {
          var d = (doc && doc.exists) ? (doc.data() || {}) : {};
          e.last = d;
          // 콜백 안에서 구독/해지가 일어나도 안전하도록 사본으로 돈다
          e.cbs.slice().forEach(function (f) {
            try { f(d, uid); } catch (err) { console.warn('[CloudShare] users 구독 콜백 오류', err && err.message); }
          });
        }, function () {});
      } catch (err) { delete _userDocSubs[uid]; return function () {}; }
    }
    e.cbs.push(cb);
    /* 늦게 붙은 소비자에게도 마지막 값을 한 번 전달한다(각자 구독하던 시절엔 최초 스냅샷을 받았으므로).
       ⚠️ 동기로 부르면 호출자가 아직 unsub 을 변수에 담기 전이라 재진입 사고가 날 수 있어 다음 틱으로 미룬다. */
    if (e.last) {
      var _d = e.last;
      setTimeout(function () { if (e.cbs.indexOf(cb) >= 0) { try { cb(_d, uid); } catch (err) {} } }, 0);
    }
    return function () {
      var i = e.cbs.indexOf(cb);
      if (i >= 0) e.cbs.splice(i, 1);
      if (!e.cbs.length) {                       // 마지막 소비자 → 실제로 끊는다
        try { if (e.unsub) e.unsub(); } catch (err) {}
        delete _userDocSubs[uid];
      }
    };
  };
  var NICK_COLORS = ['#4dd0e1','#f06292','#ffb74d','#81c784','#9575cd','#64b5f6','#ff8a65','#a1887f'];

  function _subProfile(uid){
    if (!uid || _profileUnsubs[uid]) return;
    try {
      _profileUnsubs[uid] = function(){};                      // 재진입 가드(아래 등록 전에 또 불려도 중복 안 되게)
      _profileUnsubs[uid] = CloudShare.subscribeUserDoc(uid, function(d){   // ★ 2026-08-24 공용 구독 사용
        /* ★ 2026-08-17 업종 이미지 아이콘 — 상대가 올린 아이콘을 여기서 함께 받는다.
             이미 돌고 있는 구독이라 **읽기가 늘지 않는다**(사람당 문서 1건).
             값은 {이름슬러그: dataURL}. 아이콘 값 'img:<uid>:<슬러그>' 가 이걸 찾는다. */
        _profiles[uid] = { nickname: d.nickname || '', nickColor: d.nickColor || '',
                           icons: (d.profileIcons && typeof d.profileIcons === 'object') ? d.profileIcons : {} };
        try { if (window.Profiles && Profiles.dropIconMemo) Profiles.dropIconMemo(); } catch(e){}
        /* ★ 재설치·복구 직후 안전망 — 내 문서에 아이콘이 하나도 없는데
             로컬엔 있으면 1회 올린다. (평소에는 업종 저장 때 올라간다)

           ⚠️⚠️ 이 핸들러는 **자기가 보고 있는 문서에 쓰기**를 한다.
              쓰면 스냅샷이 다시 들어오므로, 조건이 계속 참이면 무한 루프가 된다.
              (실제 사고 이력: 채팅 markRead 를 onSnapshot 에서 불러 lastRead 폭주 — sw v404)
              올린 뒤에도 원격 맵이 비어 있을 수 있다(용량 상한에 다 걸린 경우 등)
              → 원격 개수만으로 막으면 부족하다. **세션당 1회 플래그로 확실히 잠근다.** */
        try {
          if (uid === myUid() && !_iconsPushOnce && window.Profiles && Profiles.getIconImage) {
            var _remoteN = Object.keys(_profiles[uid].icons || {}).length;
            if (!_remoteN) {
              var _hasLocal = Profiles.list({ includeHidden: true }).some(function(p){
                return !!Profiles.getIconImage(p.id);
              });
              if (_hasLocal) { _iconsPushOnce = true; CloudShare.pushMyProfileIcons(); }
            }
          }
        } catch(e){}
        refreshCal();
        try { setupWorkerCombo(); } catch(e){}
      });
    } catch(e){}
  }
  function acceptedPartnerUids(){
    var out = [];
    _shares.forEach(function(s){ if (s.status === 'accepted') { var ou = otherUid(s); if (ou && out.indexOf(ou) < 0) out.push(ou); } });
    Object.keys(_teamPartners).forEach(function(u){ if (u && u !== myUid() && out.indexOf(u) < 0) out.push(u); });  // ★ 팀원 포함
    return out;
  }
  CloudShare.nickOf = function(uid){ return (_profiles[uid] || {}).nickname || ''; };

  /* ★ 2026-08-17 업종 이미지 아이콘 조회 — Profiles.imgDataOf 가 부른다 */
  CloudShare.iconDataOf = function(uid, slug){
    var p = _profiles[uid];
    if (!p || !p.icons) return '';
    return p.icons[slug] || '';
  };
  /* 내 업종 이미지 아이콘을 users/{uid} 에 올린다(상대가 볼 수 있게).
     ⚠️ 이름이 공용 키다 — 키는 pfId 가 아니라 업종 이름 슬러그.
     ⚠️ 문서 하나에 다 들어가므로 총량을 지킨다(64px 정사각 ≈ 2~4KB × 업종 수). */
  var ICONS_MAX_TOTAL = 300 * 1024;   // 안전선 300KB (Firestore 문서 한도 1MB)
  CloudShare.pushMyProfileIcons = async function(){
    if (!loggedIn() || !window.Profiles) return false;
    try {
      var map = {}, total = 0;
      Profiles.list({ includeHidden: true }).forEach(function(p){
        var data = Profiles.getIconImage(p.id);
        if (!data) return;
        if (total + data.length > ICONS_MAX_TOTAL) return;   // 넘치면 조용히 건너뛴다
        total += data.length;
        map[Profiles.iconSlug(p.name)] = data;
      });
      _iconsPushOnce = true;   // 한 번 올렸으면 자동 안전망은 더 돌 필요가 없다
      await db().collection('users').doc(myUid()).set({ profileIcons: map }, { merge: true });
      return true;
    } catch(e){ console.warn('[업종아이콘] 업로드 실패', e && e.message); return false; }
  };
  CloudShare.profileOf = function(uid){
    var p = _profiles[uid] || {};
    var isMe = loggedIn() && uid === myUid();
    var name = p.nickname
      || (isMe ? (Cloud.user.displayName || String(Cloud.user.email||'').split('@')[0] || '나')
               : (_partnerNames[uid] || '상대'));
    return { name: name, color: p.nickColor || CloudShare.colorForUid(uid) || NICK_COLORS[0] };
  };
  CloudShare.myProfile = function(){ return loggedIn() ? CloudShare.profileOf(myUid()) : { name: '', color: NICK_COLORS[0] }; };

  /* ★ 2026-08-08 달력 점 색상 개선
       기존 문제: 색을 안 고른 사람은 전부 NICK_COLORS[0](같은 청록)이라 구분이 안 됐고,
                  색 판정을 '이름 문자열 일치'로만 해서 옛 데이터/오타면 매칭이 통째로 실패했다.
       개선: uid를 기준으로 삼고, 색을 직접 고르지 않았으면 uid 해시로 팔레트에서 고정 배정한다.
             같은 사람은 항상 같은 색, 다른 사람은 (팔레트 범위 내에서) 다른 색이 된다. */
  function _hashColor(uid){   // 명단 밖 uid(예전 상대의 옛 작업)용 폴백
    var str = String(uid), h = 0;
    for (var i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
    return NICK_COLORS[Math.abs(h) % NICK_COLORS.length];
  }
  CloudShare.colorForUid = function(uid){
    if (!uid) return '';
    var p = _profiles[uid] || {};
    if (p.nickColor) return p.nickColor;          // 본인이 직접 고른 색 최우선
    if (!loggedIn()) return _hashColor(uid);
    // 색을 안 고른 사람끼리 겹치지 않도록, 현재 명단(나+상대)을 정렬해 순서대로 배정한다.
    //   · 해시 방식은 사람이 몇 명만 돼도 같은 색이 겹쳐 '구분'이라는 목적을 못 이룬다.
    //   · 정렬 기준이 uid라 같은 명단이면 항상 같은 결과(기기 간에도 동일).
    //   · 누군가 직접 고른 색은 피해서 배정한다.
    var all = [myUid()].concat(acceptedPartnerUids());
    var taken = {};
    all.forEach(function(u){ var c = (_profiles[u] || {}).nickColor; if (c) taken[c] = 1; });
    var pool = all.filter(function(u){ return u && !(_profiles[u] || {}).nickColor; }).sort();
    var idx = pool.indexOf(uid);
    if (idx < 0) return _hashColor(uid);          // 명단에 없는 uid
    var free = NICK_COLORS.filter(function(c){ return !taken[c]; });
    if (!free.length) free = NICK_COLORS;         // 팔레트를 다 써버린 경우
    return free[idx % free.length];
  };
  // 표시 이름(닉네임) → uid 역매핑 (작업의 worker 필드는 이름 텍스트로 저장되어 있음)
  CloudShare.uidForName = function(name){
    if (!name || !loggedIn()) return '';
    var uids = [myUid()].concat(acceptedPartnerUids());
    for (var i = 0; i < uids.length; i++) {
      if (CloudShare.profileOf(uids[i]).name === name) return uids[i];
    }
    return '';
  };
  // 프로필(users/{uid})이 아직 한 건도 안 들어왔는지 — 달력이 색 없이 먼저 그려졌다가
  // 뒤늦게 덧칠되며 깜빡이는 것을 막기 위해, 도착 전에는 색을 칠하지 않는다.
  CloudShare.profilesReady = function(){ return Object.keys(_profiles).length > 0; };
  // 이름(닉네임)으로 색상 찾기 - 작업자 표시용 (내부적으로 uid 기준으로 해석)
  CloudShare.colorForName = function(name){
    var uid = CloudShare.uidForName(name);
    return uid ? CloudShare.colorForUid(uid) : '';
  };
  CloudShare.saveMyProfile = function(nick, color){
    if (!loggedIn()) { toast('먼저 로그인해주세요','err'); return Promise.reject(); }
    return db().collection('users').doc(myUid()).set({ nickname: String(nick||'').trim().slice(0,20), nickColor: color || '' }, { merge: true })
      .then(function(){ toast('👤 닉네임/색상이 저장되었습니다'); })
      .catch(function(e){ toast('저장 실패: ' + (e && e.code), 'err'); throw e; });
  };
  // 작업자 콤보 목록: 내 닉네임 + 수락된 공유상대 닉네임 (중복 제거)
  CloudShare.getWorkerNames = function(){
    if (!loggedIn()) return [];
    var out = [];
    [myUid()].concat(acceptedPartnerUids()).forEach(function(u){
      var nm = CloudShare.profileOf(u).name;
      if (nm && out.indexOf(nm) < 0) out.push(nm);
    });
    return out;
  };
  // 작업자 필수 여부: 로그인 + 수락된 공유상대 1명 이상
  CloudShare.workerRequired = function(){
    return !!(loggedIn() && acceptedPartnerUids().length > 0);
  };
  // 내 작업의 "상대가 보탠 사진" 개수 (buildOverrides에서 채움)
  var _myAddedPhotos = {};
  CloudShare.addedPhotosOf = function(workId){ return (workId && _myAddedPhotos[workId]) || 0; };

  /* ── 설정 화면: 닉네임/색상 버튼 + 미니 모달 ── */
  function _injectProfileBtn(){
    try {
      if (document.getElementById('profileSetBtn')) return;
      // 인라인 계정영역(로그인 상태) 안, 로그아웃 버튼 앞에 배치
      var anchor = document.getElementById('cloudAcctBox');
      if (!anchor) return;
      var b = document.createElement('button');
      b.className = 'btn b-ghost'; b.id = 'profileSetBtn';
      b.style.cssText = 'width:100%;justify-content:space-between;margin-top:8px;';
      b.innerHTML = '<span>👤 닉네임 · 색상</span><span style="opacity:.6;">▶</span>';
      b.onclick = CloudShare.openProfileModal;
      var lo = document.getElementById('cloudLogout');
      if (lo && lo.parentNode) lo.parentNode.insertBefore(b, lo);
      else anchor.appendChild(b);
    } catch(e){}
  }
  CloudShare.openProfileModal = function(){
    if (!loggedIn()) { toast('먼저 로그인해주세요','err'); return; }
    var cur = _profiles[myUid()] || {};
    var curColor = cur.nickColor || NICK_COLORS[0];
    var loginName = Cloud.user.displayName || String(Cloud.user.email||'').split('@')[0] || '';
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:1950;display:flex;align-items:center;justify-content:center;padding:16px;';
    var sw = NICK_COLORS.map(function(c){
      return '<button class="nick-sw" data-c="' + c + '" style="width:34px;height:34px;border-radius:50%;border:3px solid ' + (c === curColor ? '#fff' : 'transparent') + ';background:' + c + ';cursor:pointer;"></button>';
    }).join('');
    ov.innerHTML =
      '<div style="background:var(--sf);border-radius:14px;padding:18px;max-width:420px;width:100%;">' +
        '<div style="font-size:16px;font-weight:800;margin-bottom:12px;">👤 닉네임 · 색상</div>' +
        '<div style="font-size:12px;color:var(--mu);margin-bottom:6px;">닉네임 (비우면 로그인 이름 <b>' + esc(loginName) + '</b> 사용)</div>' +
        '<input id="nickInput" value="' + esc(cur.nickname || '') + '" placeholder="' + esc(loginName) + '" maxlength="20" style="width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:1px solid var(--bd);background:var(--sf2);color:var(--tx);font-size:14px;margin-bottom:12px;">' +
        '<div style="font-size:12px;color:var(--mu);margin-bottom:6px;">내 색상 (스케줄·채팅에서 내 이름 색)</div>' +
        '<div id="nickSwWrap" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">' + sw + '</div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
          '<button id="nickCancel" class="btn b-ghost" style="padding:8px 14px;">취소</button>' +
          '<button id="nickSave" class="btn" style="padding:8px 14px;">저장</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    var picked = curColor;
    ov.querySelectorAll('.nick-sw').forEach(function(btn){
      btn.onclick = function(){
        picked = btn.getAttribute('data-c');
        ov.querySelectorAll('.nick-sw').forEach(function(b2){ b2.style.borderColor = (b2 === btn) ? '#fff' : 'transparent'; });
      };
    });
    var close = function(){ if (ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function(e){ if (e.target === ov) close(); });
    ov.querySelector('#nickCancel').onclick = close;
    ov.querySelector('#nickSave').onclick = function(){
      var nick = ov.querySelector('#nickInput').value;
      CloudShare.saveMyProfile(nick, picked).then(close).catch(function(){});
    };
  };

  /* ── 작업자 콤보상자: 담당자 입력을 공유자 닉네임 select로 (필수) ── */
  /* ★ 2026-08-08 배터리 개선:
       기존엔 setInterval(_syncWorkerCombo, 1500)로 앱 켜진 내내 1.5초마다 DOM을 훑었고,
       clearInterval이 어디에도 없어 종료될 때까지 계속 돌았다(CPU가 절전으로 못 내려감).
       실제 목적은 '작업 불러오기 등 코드가 workerName.value를 바꿨을 때 select를 맞추는 것'뿐이므로,
       그 시점(value 대입)에만 반응하도록 setter를 후킹한다. 폴링 0회, 반응은 오히려 즉시.
       (코드에서 값을 넣는 경로는 전부 `.value =` 대입이라 이 방식으로 모두 잡힌다) */
  var _wcHooked = false;
  function _hookWorkerValue(inp){
    if (!inp || _wcHooked) return;
    try {
      var d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      if (!d || !d.get || !d.set) return;   // 지원 안 되면 조용히 포기(기존 동작 유지)
      Object.defineProperty(inp, 'value', {
        configurable: true,
        get: function(){ return d.get.call(this); },
        set: function(v){ d.set.call(this, v); try { _syncWorkerCombo(); } catch(e){} }
      });
      _wcHooked = true;
    } catch(e){}
  }
  function setupWorkerCombo(){
    var inp = document.getElementById('workerName');
    if (!inp) return;
    var names = CloudShare.getWorkerNames();
    var required = CloudShare.workerRequired();
    var sel = document.getElementById('workerNickSel');
    if (!required || !names.length) {
      // 공유 미사용 - 기존 자유 입력 유지
      if (sel) { try { sel.remove(); } catch(e){} inp.style.display = ''; }
      return;
    }
    if (!sel) {
      sel = document.createElement('select');
      sel.id = 'workerNickSel';
      sel.style.cssText = 'width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:1px solid var(--bd);background:var(--sf2);color:var(--tx);font-size:14px;';
      inp.style.display = 'none';
      inp.parentNode.insertBefore(sel, inp.nextSibling);
      sel.addEventListener('change', function(){
        inp.value = sel.value;
        try { if (typeof _dataDirty !== 'undefined') _dataDirty = true; } catch(e){}
      });
      _hookWorkerValue(inp);   // ★ 폴링 대신 값 변경 시점에만 동기화(배터리 절약)
    }
    // 옵션 재구성
    var opts = '<option value="">👤 작업자 선택 (필수)</option>' +
      names.map(function(n){ return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
    // 기존 데이터 호환: 현재 값이 목록에 없으면 그대로 옵션 추가
    var curV = inp.value || '';
    if (curV && names.indexOf(curV) < 0) opts += '<option value="' + esc(curV) + '">' + esc(curV) + '</option>';
    if (sel.innerHTML !== opts) sel.innerHTML = opts;
    sel.value = curV;
  }
  // 작업 불러오기 등으로 input 값이 코드로 바뀐 경우 select 표시 동기화
  function _syncWorkerCombo(){
    try {
      var inp = document.getElementById('workerName');
      var sel = document.getElementById('workerNickSel');
      if (!inp || !sel) return;
      if (sel.value !== (inp.value || '')) setupWorkerCombo();
    } catch(e){}
  }
  CloudShare.setupWorkerCombo = setupWorkerCombo;

  var _ownUnsub = null;

  function buildOverrides(snap){
    _myOverrides = {}; _myManualItems = []; _myTrashedItems = []; _myAddedPhotos = {};
    snap.forEach(function(doc){
      var d = doc.data() || {};
      // ★ 상대가 보탠 사진 개수 (스케줄 카드 구분 표시용, 2026-07-11)
      if (d.addedPhotos) _myAddedPhotos[d.workId || doc.id] = d.addedPhotos;
      // 상대가 이 항목을 "가져감"(claim) → 내 원본 삭제 (사진없는 것만 가져가므로 안전)
      if (d.claimedBy && d.claimedBy !== myUid()) {
        if (!_deletedClaimed[doc.id]) {
          _deletedClaimed[doc.id] = 1;
          var _wid2 = d.workId || doc.id;
          db().collection('schedules').doc(myUid()).collection('items').doc(doc.id).delete()
            .then(function(){ console.log('[CloudShare] 가져간 원본 삭제:', doc.id); refreshCal(); })
            .catch(function(e){ console.warn('[CloudShare] 원본 삭제 실패', e && e.code); });
          // ★ 2026-08-09 안전장치: claimedBy가 잘못 찍혔더라도(예전 버그·미래의 다른 경로 포함)
          //   실제로 사진이 있는 작업은 로컬 폴더를 자동삭제하지 않는다. 최종 방어선.
          var _photosNow = (d.totalPhotos || 0) + (d.addedPhotos || 0);
          if (!d.manual && String(_wid2).indexOf('m_') !== 0 && typeof window.deleteLocalWorkFolder === 'function') {
            if (_photosNow > 0) {
              console.warn('[CloudShare] claimedBy 감지했지만 사진(' + _photosNow + '장)이 있어 로컬 폴더 자동삭제를 건너뜀:', _wid2);
            } else {
              window.deleteLocalWorkFolder(_wid2);
            }
          }
        }
        return;  // 가져간 항목은 목록/오버레이에서 제외
      }
      // 휴지통으로 보낸 내 항목 → 일반 목록/오버레이 제외, 휴지통 전용 목록에만
      if (d.trashed) { _myTrashedItems.push(toCalItem(d, doc.id, myUid())); return; }
      if (d.manual && !d.claimedBy) _myManualItems.push(toCalItem(d, doc.id, myUid()));
      /* ★ 2026-08-13: 상대가 바꾼 사진 순서(photoOrder)를 내 로컬에 반영한다.
         orderedBy 는 남의 작업에 순서를 쓸 때만 찍힌다(내가 다시 정하면 null 로 지워진다). */
      if (d.orderedBy && d.orderedBy !== myUid() && d.photoOrder) {
        var _oid = d.workId || doc.id;
        var _oh = String(d.orderedAt || '');
        if (_ordApplied[_oid] !== _oh && !_ordApplying[_oid]
            && window.CloudPhotoSync && CloudPhotoSync.applyPhotoOrderToLocal) {
          _ordApplying[_oid] = 1;
          (function (wid, hh, poo) {
            Promise.resolve(CloudPhotoSync.applyPhotoOrderToLocal(wid, poo))
              .then(function (r) {
                var info = CloudPhotoSync._lastOrderApply || {};
                if (r === true) { _ordApplied[wid] = hh; }        // 'retry' 면 기록 안 함 → 다음에 다시
                else if (r === 'nomatch' || r === 'nothing') { _ordApplied[wid] = hh; }  // 반복해도 결과 같음
                /* 2026-08-13: 실시간 반영이 되면서 성공 배너는 군더더기가 됐다.
                   조용한 실패만 막으면 되므로 **실패했을 때만** 띄운다. */
                try {
                  if ((r === 'nomatch' || r === false) && CloudPhotoSync.showOwnerOrderBanner) {
                    CloudPhotoSync.showOwnerOrderBanner(wid,
                      (r === true ? 'ok' : (r === 'retry' ? 'retry' : (r === 'nomatch' ? 'nomatch' : (r === 'nothing' ? 'nothing' : 'fail')))), info);
                  }
                } catch (e) {}
              })
              .catch(function () {})
              .then(function () { delete _ordApplying[wid]; });
          })(_oid, _oh, d.photoOrder);
        }
      }
      if (d.editedBy && d.editedBy !== myUid()) {
        var _wid = d.workId || doc.id;
        var _ov = {
          apt: d.apt, price: d.price, startTime: d.startTime, endTime: d.endTime,
          name: d.name,   // ★ 2026-08-30 고객명 전파
          target: d.target, memo: d.memo, phone: d.phone, address: d.address,
          worker: d.worker, date: d.date, endDate: d.endDate,   // ★ 2026-08-13 담당자·일정변경 전파
          workType: d.workType                                  // ★ 2026-08-13 가정용/공용시설 전파
        };
        /* ★ 2026-08-16 업종. 이게 없으면 상대가 바꾼 업종이 내 달력 카드에
             다음 폴더 스캔 전까지 안 나타난다(담당자와 같은 이유).
           ⭐ 2026-08-21 — 다만 상대가 업종을 **안 보냈을 땐 손대지 않는다.**
             예전엔 무조건 덮어써서, 상대가 재설치 중이라 업종이 빈 껍데기면
             그 빈 값이 내 로컬 작업의 업종까지 지워버렸다(실제 사고). */
        if (d.profileId || d.profileName || d.profileIcon || d.profileSnap) {
          _ov.profileId   = d.profileId;
          _ov.profileIcon = d.profileIcon;
          _ov.profileName = d.profileName;
          _ov.profileSnap = d.profileSnap || null;
        }
        _myOverrides[_wid] = _ov;
        // 로컬 작업이면 _session.json 에도 반영 (정보수정/작업열기 일치)
        if (!d.manual && String(_wid).indexOf('m_') !== 0) {
          var _h = JSON.stringify(_ov);
          if (_appliedHash[_wid] !== _h) {
            /* ★ 2026-08-13: 예전엔 호출 직전에 해시를 찍었다. 그런데 폴더 권한이 아직 없거나
               (콜드스타트에 스냅샷이 먼저 도착) 폴더를 못 찾으면 applyCloudEditToLocal 이
               조용히 실패하는데도 '반영했다'로 기록돼, 그 세션 내내 재시도가 없었다.
               → 로컬은 옛 값 그대로 남고 다음 syncAll 이 그 옛 값을 다시 올려
                 상대가 바꾼 담당자/정보가 되돌아갔다. 성공했을 때만 기록한다. */
            /* 동시 실행 가드: 예전엔 호출 직전에 해시를 찍어서 두 번째 진입이 막혔는데,
               성공할 때만 찍도록 바꾸면서 그 차단이 사라졌다. 같은 _session.json 에
               read-modify-write 가 겹치지 않도록 진행중 표시를 동기적으로 세운다.
               또 로컬에 폴더가 아예 없는 작업(다른 기기에서 만든 것 등)은 영원히 실패하므로
               스냅샷마다 재시도하지 않도록 실패 횟수 상한을 둔다. */
            /* 수정 내용이 바뀌면(=상대가 새로 고침) 실패 상한을 초기화한다.
               안 그러면 예전 수정에서 3번 실패한 작업은 그 세션 동안 새 수정도 못 받는다. */
            if (_lastTriedHash[_wid] !== _h) { _lastTriedHash[_wid] = _h; _applyFails[_wid] = 0; }
            if (typeof window.applyCloudEditToLocal === 'function'
                && !_applyingLocal[_wid] && (_applyFails[_wid] || 0) < 3) {
              _applyingLocal[_wid] = 1;
              (function(wid, hh){
                Promise.resolve(window.applyCloudEditToLocal(wid, _ov))
                  .then(function(ok){
                    if (ok === true) { _appliedHash[wid] = hh; _applyFails[wid] = 0; }
                    else if (ok !== 'retry') _applyFails[wid] = (_applyFails[wid] || 0) + 1;
                    // 'retry'(폴더 미연결)는 실패로 세지 않는다 → 폴더가 붙으면 그때 반영
                  })
                  .catch(function(){ _applyFails[wid] = (_applyFails[wid] || 0) + 1; })
                  .then(function(){ delete _applyingLocal[wid]; });
              })(_wid, _h);
            }
          }
        }
      }
    });
  }
  function subscribeOwn(){
    if (!loggedIn()) return;
    if (_ownUnsub) return;  // ★ 이미 구독 중 → 재읽기 안 함 (성능)
    // ★ 중복 .get() 제거(onSnapshot 최초 스냅샷이 같은 역할을 하며, 둘 다 하면 읽기가 2배).
    //   ⚠️ 내 일정에는 날짜 필터를 걸지 않는다 — 오래된 휴지통 항목 표시와
    //      '상대가 가져감(claimedBy)' 원본 삭제 처리가 전체 문서를 봐야 하기 때문.
    _ownUnsub = db().collection('schedules').doc(myUid()).collection('items')
      .onSnapshot(function(snap){ buildOverrides(snap); refreshCal(); },
                  function(e){ console.warn('[CloudShare] 내 일정 구독 오류', e && e.code); });
  }
  CloudShare.getOverride = function(workId){ return (workId && _myOverrides[workId]) || null; };

  /* ════════ 공유 일정 수정 (텍스트) ════════ */
  CloudShare.editItem = function(ownerUid, workId, fields){
    if (!loggedIn()) { toast('먼저 로그인해주세요','err'); return Promise.reject(); }
    if (!ownerUid || !workId) { toast('대상을 찾을 수 없습니다','err'); return Promise.reject(); }
    var patch = {};
    /* ★ 2026-08-13 worker 추가 — 담당자 변경이 상대에게 전파되게 한다.
       (가져오기=소유권 이전 대신 '누가 맡는가'만 바꾸는 방식) */
    /* ★ 2026-08-13 workType 추가 — 호수가 2개 이상이면 '공용시설'이어야 한다(가정용은 1호수 전용).
       공유작업자가 호수를 늘려도 작업유형이 안 넘어가면 원작업자 쪽이
       '가정용인데 호수 2개'라는 앱 규칙에 어긋난 상태가 된다.
       ⚠️ 클라우드 표기는 'facility' / 'home', 로컬(_session.json)은 'facility' / 'household' 로 다르다. */
    /* ★ 2026-08-16 업종(profileId/Icon/Name) 추가 — 상대가 상세창에서 업종을 바꾸면 전파된다.
       ⚠️ 아이콘·이름을 같이 보내야 한다. 상대 폰엔 내 프로필 목록이 없어 id 만으로는 못 그린다. */
    ['apt','name','target','phone','address','price','startTime','endTime','memo','worker','date','endDate','workType',
     'profileId','profileIcon','profileName','profileSnap'].forEach(function(k){ if (fields[k] !== undefined) patch[k]=fields[k]; });
    if (fields.unit !== undefined) { patch.unitNames = fields.unit ? [fields.unit] : []; patch.totalUnits = fields.unit ? 1 : 0; }
    patch.editedBy = myUid();
    patch.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    /* ⭐ 2026-08-13 이게 없어서 '상대가 바꿔도 원작업자 쪽에서 되돌아가는' 문제가 났다.
       cloud_sync.syncAll 은 업로드 직전에 서버 savedAt 과 로컬 _session.json 의 savedAt 을 비교해
       '서버가 더 최신이면 건너뛴다'. 그런데 여기서 savedAt 을 안 올리면 서버 값이 원작업자의
       옛 저장시각 그대로라 비교를 통과해 버리고, 원작업자 앱이 자기 로컬(옛 작업자)을
       그대로 다시 올려 상대의 수정을 지운다.
       (특히 toPayload 에 필드를 추가하면 모든 작업의 해시가 바뀌어 전량 재업로드된다)
       → 상대 수정이 더 최신임을 표시해 원작업자의 옛 업로드를 막는다.
       원작업자 로컬에 반영되면(applyCloudEditToLocal) 거기서 savedAt 을 다시 올리므로
       원작업자의 이후 저장이 막히지 않는다. 반영에 실패하면 계속 막혀서 상대 수정이 살아남는다. */
    patch.savedAt = Date.now();
    return db().collection('schedules').doc(ownerUid).collection('items').doc(safeIdShare(workId)).update(patch)
      .then(function(){ toast('수정되었습니다','ok'); refreshCal(); })
      .catch(function(e){
        console.warn('[CloudShare] 수정 실패', e);
        /* ★ 2026-08-13: 권한 거부는 Firestore 규칙이 그 필드/사용자의 쓰기를 막은 것이다.
           'permission-denied' 코드만 보여주면 원인을 알 수 없어 문구를 나눈다. */
        var _c = (e && e.code) || '';
        if (String(_c).indexOf('permission-denied') >= 0) {
          toast('수정 권한이 없습니다 — Firestore 규칙에서 막혀 있습니다','err');
        } else {
          toast('수정 실패: ' + (_c || (e && e.message) || '알 수 없음'),'err');
        }
        throw e;
      });
  };

  /* ════════ 일정 삭제 = 공유 휴지통으로 이동 (작성자만, 되돌리기 가능) ════════ */
  CloudShare.deleteSchedule = function(workId, isManual){
    if (!loggedIn()) { toast('먼저 로그인해주세요','err'); return Promise.reject(); }
    if (!workId) { toast('대상을 찾을 수 없습니다','err'); return Promise.reject(); }
    var docId = safeIdShare(workId);
    return db().collection('schedules').doc(myUid()).collection('items').doc(docId)
      .update({ trashed: true, trashedAt: firebase.firestore.FieldValue.serverTimestamp(), trashedBy: myUid() })
      .then(function(){ toast('🗑 공유 휴지통으로 이동했습니다','ok'); refreshCal(); })
      .catch(function(e){ console.warn('[CloudShare] 휴지통 이동 실패', e); toast('삭제 실패: '+(e && e.code),'err'); throw e; });
  };

  /* ════════ 휴지통에서 복원 (작성자·상대 모두 가능) ════════ */
  CloudShare.restoreSchedule = function(ownerUid, workId){
    if (!loggedIn()) { toast('먼저 로그인해주세요','err'); return Promise.reject(); }
    if (!ownerUid || !workId) { toast('대상을 찾을 수 없습니다','err'); return Promise.reject(); }
    var docId = safeIdShare(workId);
    return db().collection('schedules').doc(ownerUid).collection('items').doc(docId)
      .update({ trashed: false, trashedAt: null, restoredBy: myUid(), restoredAt: firebase.firestore.FieldValue.serverTimestamp() })
      .then(function(){ toast('♻️ 복원되었습니다','ok'); refreshCal(); })
      .catch(function(e){ console.warn('[CloudShare] 복원 실패', e); toast('복원 실패: '+(e && e.code),'err'); throw e; });
  };

  /* ════════ 완전삭제 (비우기) - 작성자 전용, 되돌릴 수 없음 ════════ */
  CloudShare.permanentDelete = function(workId, isManual){
    if (!loggedIn()) { toast('먼저 로그인해주세요','err'); return Promise.reject(); }
    if (!workId) { toast('대상을 찾을 수 없습니다','err'); return Promise.reject(); }
    var docId = safeIdShare(workId);
    var itemRef = db().collection('schedules').doc(myUid()).collection('items').doc(docId);
    return itemRef.collection('photos').get().then(function(snap){
      var jobs = [];
      snap.forEach(function(d){
        var data = d.data() || {};
        jobs.push(d.ref.delete().catch(function(e){ console.warn('[CloudShare] photo 문서 삭제 실패', e && e.code); }));
        if (data.storagePath) {
          jobs.push(firebase.storage().ref(data.storagePath).delete().catch(function(e){ /* 이미 없어도 무시 */ }));
        }
      });
      return Promise.all(jobs);
    }).then(function(){
      return itemRef.delete();
    }).then(function(){
      if (!isManual && String(workId).indexOf('m_') !== 0) {
        if (typeof window.deleteLocalWorkFolder === 'function') window.deleteLocalWorkFolder(workId);
        try { localStorage.removeItem('cloudSyncHash_' + myUid() + '_' + docId); } catch(e){}
      }
      toast('완전히 삭제되었습니다','ok'); refreshCal();
    }).catch(function(e){ console.warn('[CloudShare] 완전삭제 실패', e); toast('삭제 실패: '+(e && e.code),'err'); throw e; });
  };

  /* ════════ 공유 휴지통 목록/화면 ════════ */
  CloudShare.getTrashItems = function(){
    var out = [];
    (_myTrashedItems || []).forEach(function(it){ out.push(it); });
    Object.keys(_partnerItems).forEach(function(ou){
      (_partnerItems[ou] || []).forEach(function(it){ if (it.data && it.data.trashed) out.push(it); });
    });
    out.sort(function(a,b){
      function ms(x){ return (x && typeof x.toMillis === 'function') ? x.toMillis() : 0; }
      return ms(b.data.trashedAt) - ms(a.data.trashedAt);
    });
    return out;
  };

  CloudShare.openTrash = async function(){
    var _rawTrashItems = CloudShare.getTrashItems();
    var works = [];
    try { if (window.CloudBackup && CloudBackup.getTrashWorks) works = await CloudBackup.getTrashWorks(); } catch(e){ console.warn('[CloudShare] 삭제작업 목록 실패', e); }
    // ★ 중복 제거: '삭제한 작업'에 이미 뜨는 work는 '공유 일정' 목록에서 제외(같은 작업이 두 번 보이던 문제)
    var _wset = {}; works.forEach(function(w){ if (w && w.workId) _wset[w.workId] = 1; });
    var items = _rawTrashItems.filter(function(it){ return !(it && it.data && _wset[it.data.workId]); });
    var ov = document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:1820;display:flex;align-items:center;justify-content:center;padding:16px;';

    // ── 삭제한 작업(서버 백업) 섹션 ──
    var workRows = '';
    if (works.length) {
      works.forEach(function(w, i){
        var dLeft = Math.max(0, Math.ceil((w._expireMs - Date.now())/86400000));
        workRows += '<div style="background:var(--sf2);border-radius:8px;padding:10px;margin-bottom:8px;">' +
          '<div class="twork-info" data-widx="'+i+'" style="cursor:pointer;">' +
            '<div style="font-size:13px;font-weight:700;">' + esc(w._apt || '(현장 미상)') + ' <span style="font-weight:400;color:var(--ac);font-size:11px;">자세히 ›</span></div>' +
            '<div style="font-size:11px;color:var(--mu);margin:2px 0 8px;">' + esc(w._date || '') + (w._photos ? (' · 📷 ' + w._photos + '장') : '') + ' · <span style="color:var(--dn);">' + dLeft + '일 후 자동삭제</span></div>' +
          '</div>' +
          '<div style="display:flex;gap:6px;">' +
            '<button class="btn b-blue b-xs twork-restore" data-widx="'+i+'" style="flex:1;">♻️ 복원</button>' +
            '<button class="btn b-ghost b-xs twork-purge" data-widx="'+i+'" style="flex:1;color:var(--dn);">완전삭제</button>' +
          '</div>' +
        '</div>';
      });
      workRows = '<div style="font-size:12px;font-weight:800;color:var(--tx);margin:2px 0 8px;">🗑 삭제한 작업 <span style="font-weight:400;color:var(--mu);">(30일 보관)</span></div>' + workRows;
    }

    // ── 공유 일정 휴지통 섹션 ──
    var rows = '';
    if (!items.length) {
      rows = works.length ? '' : '<div style="font-size:13px;color:var(--mu);text-align:center;padding:24px 0;">휴지통이 비어있습니다.</div>';
    } else {
      items.forEach(function(it, idx){
        var d = it.data;
        var mine = (d.ownerUid === myUid());
        rows += '<div style="background:var(--sf2);border-radius:8px;padding:10px;margin-bottom:8px;">' +
          '<div style="font-size:13px;font-weight:700;">' + esc(d.apt || '(현장 미상)') + (mine ? ' <span style="font-weight:400;color:var(--mu);">(내 항목)</span>' : ' <span style="font-weight:400;color:var(--mu);">(상대 항목)</span>') + '</div>' +
          '<div style="font-size:11px;color:var(--mu);margin:2px 0 8px;">' + esc(d.date || '') + (d.totalPhotos ? (' · 📷 ' + d.totalPhotos + '장') : '') + '</div>' +
          '<div style="display:flex;gap:6px;">' +
            '<button class="btn b-blue b-xs trash-restore" data-idx="' + idx + '" style="flex:1;">♻️ 복원</button>' +
            (mine ? '<button class="btn b-ghost b-xs trash-purge" data-idx="' + idx + '" style="flex:1;color:var(--dn);">완전삭제</button>' : '') +
          '</div>' +
        '</div>';
      });
      rows = '<div style="font-size:12px;font-weight:800;color:var(--tx);margin:' + (works.length ? '14px' : '2px') + ' 0 8px;">📅 공유 일정</div>' + rows;
    }

    ov.innerHTML =
      '<div style="background:var(--sf);border-radius:14px;padding:20px;max-width:440px;width:100%;max-height:82vh;overflow-y:auto;-webkit-overflow-scrolling:touch;">' +
        '<div style="display:flex;align-items:center;margin-bottom:4px;">' +
          '<div style="flex:1;font-size:16px;font-weight:800;">🗑 공유 휴지통</div>' +
          '<button class="btn b-ghost" id="trashClose">닫기</button>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--mu);margin-bottom:12px;">삭제한 작업은 30일간 보관 후 자동 삭제됩니다. 항목을 눌러 자세히 보고 복원할 수 있어요.</div>' +
        '<div id="trashList">' + workRows + rows + '</div>' +
      '</div>';
    document.body.appendChild(ov);
    var close = function(){ if (ov && ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function(e){ if (e.target === ov) close(); });
    ov.querySelector('#trashClose').onclick = close;

    // 공유 일정 핸들러
    ov.querySelectorAll('.trash-restore').forEach(function(btn){
      btn.onclick = function(){ var it = items[parseInt(btn.getAttribute('data-idx'))]; if (!it) return; close(); CloudShare.restoreSchedule(it.data.ownerUid, it.data.workId); };
    });
    ov.querySelectorAll('.trash-purge').forEach(function(btn){
      btn.onclick = function(){ var it = items[parseInt(btn.getAttribute('data-idx'))]; if (!it) return; if (!confirm('완전히 삭제하면 사진까지 되돌릴 수 없습니다. 계속할까요?')) return; close(); CloudShare.permanentDelete(it.data.workId, it.data.manual); };
    });

    // 삭제한 작업(서버 백업) 핸들러
    ov.querySelectorAll('.twork-info').forEach(function(el){
      el.onclick = function(){ var w = works[parseInt(el.getAttribute('data-widx'))]; if (!w || !window.CloudBackup) return; CloudBackup.showWorkDetail(w, function(){ close(); CloudBackup.restoreTrashWork(w); }); };
    });
    ov.querySelectorAll('.twork-restore').forEach(function(btn){
      btn.onclick = function(){ var w = works[parseInt(btn.getAttribute('data-widx'))]; if (!w || !window.CloudBackup) return; close(); CloudBackup.restoreTrashWork(w); };
    });
    ov.querySelectorAll('.twork-purge').forEach(function(btn){
      btn.onclick = async function(){ var w = works[parseInt(btn.getAttribute('data-widx'))]; if (!w || !window.CloudBackup) return; if (!confirm('"' + (w._apt || '작업') + '"을(를) 서버에서 완전히 삭제할까요?\n\n서버 백업(사진 포함)이 지워지고 복구할 수 없습니다.')) return; btn.disabled = true; btn.textContent='삭제 중...'; try { await CloudBackup.purgeTrashWork(w); } catch(e){} if (typeof toast==='function') toast('🗑 서버에서 삭제됨','ok'); close(); setTimeout(function(){ CloudShare.openTrash(); }, 400); };
    });
  };

  /* ★ 2026-08-08 공유작업 '가져오기'(claim)
       상대가 올린 일정을 내 것으로 가져온다. 가져오면 작업자가 나로 바뀌고, 내가 삭제할 수 있게 된다.
       동작: ① 같은 내용을 내 수동일정으로 새로 만들고(작업자=나)
             ② 원본에 claimedBy 표시 → 상대 앱이 자기 원본을 스스로 삭제(cloud_share.js 상대항목 처리)
       ⚠️ 사진이 있는 작업은 대상이 아니다.
          사진은 원본 소유자의 Storage/로컬 폴더에 있어서, 소유권까지 옮기려면 파일 복사+원본 정리가 필요하다.
          어설프게 옮기면 사진이 유실될 수 있으므로(과거 사고 이력) 사진 0장인 작업만 허용한다. */
  // 열려 있는 공유작업(_borrowedShare)의 원본 데이터를 찾아준다 (작업탭 가져오기 버튼용)
  CloudShare.findSharedItem = function(ownerUid, workId){
    if (!ownerUid || !workId) return null;
    var wid = String(workId);
    var lists = [_myManualItems].concat(Object.keys(_partnerItems).map(function(k){ return _partnerItems[k]; }));
    for (var i = 0; i < lists.length; i++) {
      var arr = lists[i] || [];
      for (var j = 0; j < arr.length; j++) {
        var d = arr[j] && arr[j].data;
        if (d && String(d.workId) === wid && d.ownerUid === ownerUid) return d;
      }
    }
    return null;
  };
  CloudShare.canTakeSchedule = function(d){
    if (!d) return { ok: false, why: 'no-data' };
    if (!loggedIn()) return { ok: false, why: 'not-logged-in' };
    if (d.ownerUid === myUid()) return { ok: false, why: 'already-mine' };
    /* ★ 가져오기는 '수동 일정(manual)'만 허용한다. 이유가 두 가지다.

       ① 경합(2026-08-09 사고): 원작업자가 그 작업을 열고 사진을 찍는 순간과 가져오기 클릭이
          겹치면, 상대 화면엔 아직 사진 0장으로 보여서 claimedBy가 찍히고 원작업자 로컬 폴더가
          자동삭제될 뻔했다.

       ② 부활 루프(2026-08-12 확인): 실제 작업은 로컬 폴더가 있고, cloud_sync.js syncAll()이
          로컬 폴더를 스캔해 클라우드 일정으로 계속 다시 올린다. 그래서 claim으로 클라우드
          항목을 지워도 다음 동기화에서 되살아나고, 원작업자 폴더 삭제가 실패하면 인덱스만
          지워져 "작업이 열리지도 상세도 안 보이다가 재시작하면 되살아나는" 오락가락 증상이
          생긴다. 상대가 지운 작업이 내 쪽에서 다시 생기는 것도 같은 원인이다.
          (syncAll의 정리 로직이 manual/m_* 를 보존 대상으로 두는 것도 같은 맥락)

       수동 일정은 로컬 폴더가 없어 두 문제 모두 구조적으로 발생하지 않는다.
       실제 작업까지 넘기려면 '작업 내용 전체 이전 + 로컬을 넘김 상태로 표시해 재업로드 차단'이
       먼저 필요하다. 지금은 일정만 넘긴다. */
    if (!d.manual) return { ok: false, why: 'real-work' };
    var photos = (d.totalPhotos || 0) + (d.addedPhotos || 0);
    if (photos > 0) return { ok: false, why: 'has-photos', photos: photos };
    return { ok: true };
  };
  CloudShare.takeSchedule = function(d){
    var chk = CloudShare.canTakeSchedule(d);
    if (!chk.ok) {
      if (chk.why === 'has-photos') toast('사진이 있는 작업은 가져올 수 없습니다', 'err');
      if (chk.why === 'real-work') toast('실제 작업은 가져올 수 없습니다 (사진 없는 일정만 가능)', 'err');
      return Promise.reject(new Error(chk.why));
    }
    var myName = (CloudShare.myProfile && CloudShare.myProfile().name) || '';
    var id = 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
    var item = {
      workId: id, date: d.date, apt: d.apt || '', workType: d.workType || 'home',
      price: d.price || 0, startTime: d.startTime || '', endTime: d.endTime || '',
      totalUnits: d.totalUnits || 0, totalPhotos: 0,
      unitNames: d.unitNames || [], target: d.target || '', memo: d.memo || '',
      phone: d.phone || '', address: d.address || '', endDate: d.endDate || '',
      worker: myName,                    // ★ 작업자를 나로
      manual: true, createdBy: myUid(), editedBy: myUid(),
      takenFrom: d.ownerUid || '', takenAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    // 순서 주의: 내 사본을 먼저 만든 뒤에 원본을 claim 한다.
    //   반대로 하면 사본 생성이 실패했을 때 원본만 사라져 일정이 통째로 증발한다.
    // ★ claim 하면 원본이 사라지므로, 그 작업을 작업탭에 열어둔 상태라면 실시간 구독을 먼저 끊는다.
    //   안 그러면 '원작업자가 이 작업을 삭제했습니다' 경고가 잘못 뜬다(내가 가져간 것인데).
    try {
      var _b = window._borrowedShare;
      if (_b && _b.ownerUid === d.ownerUid && String(_b.workId) === String(d.workId) &&
          window.CloudPhotoSync && CloudPhotoSync.stopLivePhotoSync) {
        CloudPhotoSync.stopLivePhotoSync();
      }
    } catch (e) {}
    return db().collection('schedules').doc(myUid()).collection('items').doc(id).set(item)
      .then(function(){
        CloudShare.markClaimed(d.ownerUid, d.workId);
        toast('📥 내 작업으로 가져왔습니다', 'ok');
        refreshCal();
        return id;   // ★ 새로 만들어진 내 항목 id (작업탭에서 currentWorkId 교체용)
      })
      .catch(function(e){
        console.warn('[CloudShare] 가져오기 실패', e);
        toast('가져오기 실패: ' + (e && (e.code || e.message)), 'err');
        throw e;
      });
  };

  CloudShare.markClaimed = function(ownerUid, workId){
    if (!loggedIn() || !ownerUid || !workId) return;
    var ref = db().collection('schedules').doc(ownerUid).collection('items').doc(safeIdShare(workId));
    if (ownerUid === myUid()) {
      // 내 항목 → 직접 삭제 + 로컬 폴더 삭제
      ref.delete().then(function(){ refreshCal(); }).catch(function(e){ console.warn('[CloudShare] 내 일정 삭제 실패', e && e.code); });
      if (String(workId).indexOf('m_') !== 0 && typeof window.deleteLocalWorkFolder === 'function') window.deleteLocalWorkFolder(workId);
    } else {
      // 상대 항목 → claimedBy 표시 (상대 앱이 자기 원본 삭제)
      ref.update({ claimedBy: myUid(), claimedAt: firebase.firestore.FieldValue.serverTimestamp() })
         .catch(function(e){ console.warn('[CloudShare] claim 실패', e && e.code); });
    }
  };

  /* ⚠️ 2026-08-13 이후 미사용 — 공유 일정도 calendar.js 의 '작업 정보' 창(openWorkEdit)으로
     통합했다. 두 창이 거의 같은 항목을 다르게 보여주고 있었고, 이 창엔 날짜 칸이 없어
     공유작업자가 일정을 옮길 수 없었다. 외부에서 부르는 곳이 생길 수 있어 남겨 둔다. */
  CloudShare.openEdit = function(opts){
    opts = opts || {}; var cur = opts.cur || {};
    /* ★ 2026-08-13 담당자 변경 — '가져오기'(소유권 이전)를 대체한다.
       데이터는 만든 사람 자리에 그대로 두고 worker 필드만 바꾼다. */
    var _wNames = [];
    try { _wNames = (CloudShare.getWorkerNames && CloudShare.getWorkerNames()) || []; } catch(e){}
    var _curW = cur.worker || '';
    if (_curW && _wNames.indexOf(_curW) < 0) _wNames.unshift(_curW);
    var _wOpts = '<option value="">(미지정)</option>' + _wNames.map(function(n){
      return '<option value="' + esc(n) + '"' + (n === _curW ? ' selected' : '') + '>' + esc(n) + '</option>';
    }).join('');
    var ov = document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:1820;display:flex;align-items:center;justify-content:center;padding:16px;';
    ov.innerHTML =
      '<div style="background:var(--sf);border-radius:14px;padding:20px;max-width:440px;width:100%;max-height:calc(100vh - 44px);overflow-y:auto;-webkit-overflow-scrolling:touch;">' +
        '<div style="font-size:16px;font-weight:800;margin-bottom:4px;">📄 공유 일정 정보</div>' +
        '<div style="font-size:12px;color:var(--mu);margin-bottom:14px;">' + esc(opts.title||'') + ' · 텍스트만 수정됩니다 (사진 제외)</div>' +
        '<div style="display:flex;flex-direction:column;gap:10px;">' +
          '<div style="display:flex;gap:8px;">' +
            '<div style="flex:2;"><label style="font-size:12px;color:var(--mu);font-weight:700;">작업명(현장)</label>' +
              '<input class="cust-inp" id="ceApt" type="text" value="'+esc(cur.apt||'')+'" placeholder="예: ○○아파트 101동" style="width:100%;margin-top:4px;"></div>' +
            '<div style="flex:1;"><label style="font-size:12px;color:var(--mu);font-weight:700;">동호수</label>' +
              '<input class="cust-inp" id="ceUnit" type="text" value="'+esc(cur.unit||'')+'" placeholder="예: 101동 502호" style="width:100%;margin-top:4px;"></div>' +
          '</div>' +
          '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">담당자</label>' +
            '<select class="cust-inp" id="ceWorker" style="width:100%;margin-top:4px;">' + _wOpts + '</select>' +
            '<div style="font-size:11px;color:var(--mu);margin-top:4px;">담당자를 바꾸면 달력의 일정 색이 그 사람 색으로 바뀝니다</div></div>' +
          '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">작업대상</label>' +
            '<input class="cust-inp" id="ceTarget" type="text" value="'+esc(cur.target||'')+'" style="width:100%;margin-top:4px;"></div>' +
          '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">전화번호</label>' +
            '<input class="cust-inp" id="cePhone" type="text" inputmode="tel" value="'+esc(cur.phone||'')+'" placeholder="010-1234-5678" style="width:100%;margin-top:4px;"></div>' +
          '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">주소</label>' +
            '<input class="cust-inp" id="ceAddr" type="text" value="'+esc(cur.address||'')+'" placeholder="주소" style="width:100%;margin-top:4px;"></div>' +
          '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">가격 (원)</label>' +
            '<input class="cust-inp" id="cePrice" type="text" inputmode="numeric" value="'+esc(String(cur.price!=null?cur.price:""))+'" style="width:100%;margin-top:4px;"></div>' +
          '<div style="display:flex;gap:8px;">' +
            '<div style="flex:1;"><label style="font-size:12px;color:var(--mu);font-weight:700;">시작시간</label>' +
              '<input class="cust-inp" id="ceStart" type="time" value="'+esc(cur.startTime||'')+'" style="width:100%;margin-top:4px;"></div>' +
            '<div style="flex:1;"><label style="font-size:12px;color:var(--mu);font-weight:700;">종료시간</label>' +
              '<input class="cust-inp" id="ceEnd" type="time" value="'+esc(cur.endTime||'')+'" style="width:100%;margin-top:4px;"></div>' +
          '</div>' +
          '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">메모</label>' +
            '<textarea class="cust-memo" id="ceMemo" rows="2" style="width:100%;margin-top:4px;">'+esc(cur.memo||'')+'</textarea></div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:14px;">' +
          '<button class="btn b-blue" id="ceSave" style="flex:1;">저장</button>' +
          '<button class="btn b-ghost" id="ceCancel">취소</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    var close=function(){ if (ov && ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function(e){ if (e.target===ov) close(); });
    ov.querySelector('#ceCancel').onclick = close;
    ov.querySelector('#ceSave').onclick = function(){
      var pr = ov.querySelector('#cePrice').value.trim();
      var fields = {
        apt: ov.querySelector('#ceApt').value.trim(),
        unit: ov.querySelector('#ceUnit').value.trim(),
        worker: (ov.querySelector('#ceWorker') ? ov.querySelector('#ceWorker').value : undefined),
        target: ov.querySelector('#ceTarget').value.trim(),
        phone: ov.querySelector('#cePhone').value.trim(),
        address: ov.querySelector('#ceAddr').value.trim(),
        price: pr === '' ? 0 : (parseInt(pr.replace(/[^0-9]/g,''),10)||0),
        startTime: ov.querySelector('#ceStart').value,
        endTime: ov.querySelector('#ceEnd').value,
        memo: ov.querySelector('#ceMemo').value.trim()
      };
      // 낙관적 처리: 즉시 닫고 백그라운드 저장 (네트워크 대기로 멈춤 방지)
      close();
      /* ★ 2026-08-13 안전망: 내가 내 항목을 고치면 buildOverrides 가 건너뛴다(editedBy === 나).
         현재 호출부는 항상 상대 항목이고 내 항목은 m_* 수동일정뿐이라 아래는 사실상 타지 않는다
         (applyCloudEditToLocal 이 m_* 를 먼저 걸러냄). 나중에 이 창을 내 실제 작업에도 쓰게 되면
         그때 로컬 반영이 없어 값이 되돌아가므로, 미리 걸어 둔다. */
      try {
        if (opts.ownerUid && opts.ownerUid === myUid() && typeof window.applyCloudEditToLocal === 'function') {
          window.applyCloudEditToLocal(opts.workId, fields);
        }
      } catch (e) {}
      CloudShare.editItem(opts.ownerUid, opts.workId, fields)
        .then(function(){ if(opts.onSaved)opts.onSaved(); })
        .catch(function(){});   // editItem 이 자체 토스트로 알림 (미처리 거부 방지)
    };
  };

  function cleanupSubs(){
    if (_sharesUnsub) { try{_sharesUnsub();}catch(e){} _sharesUnsub=null; }
    if (_ownUnsub) { try{_ownUnsub();}catch(e){} _ownUnsub=null; }
    Object.keys(_partnerUnsubs).forEach(function(ou){ try{_partnerUnsubs[ou]();}catch(e){} });
    Object.keys(_profileUnsubs).forEach(function(ou){ try{_profileUnsubs[ou]();}catch(e){} });
    _profileUnsubs={}; _profiles={}; _myAddedPhotos={};
    _partnerUnsubs={}; _partnerItems={}; _myOverrides={}; _shares=[]; _teamPartners={};
  }
  document.addEventListener('cloud-auth-changed', function(e){
    if (e && e.detail && e.detail.user) {
      subscribeShares();
      _subProfile(e.detail.user.uid);           // ★ 내 닉네임/색상 구독
      setTimeout(function(){ _injectProfileBtn(); try { setupWorkerCombo(); } catch(e2){} }, 800);
    }
    else { cleanupSubs(); renderArea(); try { setupWorkerCombo(); } catch(e2){} }
  });
  // 설정 버튼은 로그인 여부와 무관하게 노출 (누르면 로그인 안내)
  setTimeout(_injectProfileBtn, 2500);
  document.addEventListener('cloud-share-render', renderArea);
})();
