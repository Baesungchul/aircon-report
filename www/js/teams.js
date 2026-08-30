/* ═══════════════════════════════════════════════
   CLOUD TEAMS ─ 여러 명 그룹 공유 (일정 + 사진)
   - teams/{teamId}: { name, owner, members[], memberNames{uid:name}, inviteCode, createdAt }
   - users/{uid}.teamIds: [teamId]  ← Firestore 규칙에서 "같은 팀이면 서로 읽기 허용"(hasAny) 판정용
   - 팀원 uid를 CloudShare.setTeamPartners()로 주입 → 기존 공유 인프라(달력 병합·사진 업/다운로드·
     작업자 콤보·닉네임 색상)를 그대로 재사용한다. (1:1 shares 와 독립적으로 병행 동작)
═══════════════════════════════════════════════ */
(function () {
  'use strict';
  window.CloudTeams = window.CloudTeams || {};

  function loggedIn() { return window.Cloud && Cloud.ready && Cloud.user; }
  function db() { return Cloud.db; }
  function myUid() { return Cloud.user.uid; }
  function myName() { return (Cloud.user.displayName) || String(Cloud.user.email || '').split('@')[0] || '나'; }
  function esc(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(m, t) { if (typeof showToast === 'function') showToast(m, t || 'ok'); else alert(m); }

  var _teams = [];
  var _teamsUnsub = null;
  var _lastTeamIds = '';

  function genCode() {
    var s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', c = '';
    for (var i = 0; i < 6; i++) c += s[Math.floor(Math.random() * s.length)];
    return c;
  }

  // 내 프로필 닉네임 우선 사용 (있으면), 없으면 로그인 이름
  function displayMyName() {
    try { if (window.CloudShare && CloudShare.myProfile) { var p = CloudShare.myProfile(); if (p && p.name) return p.name; } } catch (e) {}
    return myName();
  }

  // ── 팀원 uid 집계 → CloudShare 에 주입 (본인 제외, 중복 제거) ──
  function pushPartners() {
    var map = {};
    _teams.forEach(function (t) {
      (t.members || []).forEach(function (u) {
        if (u && u !== myUid()) map[u] = (t.memberNames && t.memberNames[u]) || '팀원';
      });
    });
    try { if (window.CloudShare && CloudShare.setTeamPartners) CloudShare.setTeamPartners(map); } catch (e) {}
    // 팀 참여 후 공유 사진 자동 다운로드 한번 더 확인
    try { if (window.CloudPhotoSync && CloudPhotoSync.syncDownloads) setTimeout(function () { CloudPhotoSync.syncDownloads(); }, 1500); } catch (e) {}
    renderArea();
  }

  // users/{uid}.teamIds 를 현재 소속과 일치시킴(자가치유: 삭제된 팀 잔여 id 제거)
  function reconcileTeamIds() {
    if (!loggedIn()) return;
    var ids = _teams.map(function (t) { return t.id; }).sort();
    var key = ids.join(',');
    if (key === _lastTeamIds) return;
    _lastTeamIds = key;
    db().collection('users').doc(myUid()).set({ teamIds: ids }, { merge: true })
      .catch(function (e) { console.warn('[CloudTeams] teamIds 갱신 실패', e && e.code); });
  }

  function processTeams(docs) {
    _teams = [];
    docs.forEach(function (d) { _teams.push(Object.assign({ id: d.id }, d.data())); });
    reconcileTeamIds();
    pushPartners();
    _teams.forEach(ensureTeamRoom);   // ★ 팀 단체 채팅방 자동 관리
    _teams.forEach(mergeTeamIndustries);  // ★ 2026-08-23 팀 업종을 내 업종에 병합
    reconcileGuideLocks();                // ★ 2026-08-24 나간 팀의 지침 잠금 풀기
  }

  /* 아직 '팀이 관리 중'인 업종만 남기고 지침 편집 잠금을 푼다 */
  function reconcileGuideLocks() {
    if (!window.ClaudeAI || !ClaudeAI.reconcileTeamGuideOwners || !window.Profiles) return;
    var active = [];
    try {
      _teams.forEach(function (t) {
        if (!t || t.owner === myUid() || t.shareGuides === false) return;
        var g = (t.industryGuides && typeof t.industryGuides === 'object') ? t.industryGuides : null;
        if (!g) return;
        (Array.isArray(t.industries) ? t.industries : []).forEach(function (e) {
          if (!e || !g[e.key]) return;
          var own = null;
          try { own = Profiles.matchName ? Profiles.matchName(e.name) : Profiles.matchByName(e.name); } catch (er) {}
          if (own) active.push(own.id);
        });
      });
      ClaudeAI.reconcileTeamGuideOwners(active);
    } catch (e) { console.warn('[CloudTeams] 지침 잠금 정리 실패', e && e.message); }
  }

  /* ═══ ⭐ 2026-08-23 팀 업종 ══════════════════════════════════
     "팀으로 운영한다면 팀은 같은 업종을 가지고 있는 게 맞다"(사용자)

     teams/{teamId}.industries = [{key, name, icon, reportTitle, unitLabel, stageLabel}]
     · 팀장만 지정한다(owner === myUid)
     · 팀원 앱은 팀 문서를 받을 때마다 자기 업종에 **병합**한다 — 삭제는 절대 안 한다
     · 이름·아이콘·호칭만 맞춘다. 지침·양식·가격표는 개인 자산이라 안 건드린다
     ⚠️ processTeams 는 스냅샷마다 불린다. 내용이 바뀐 팀만 처리하지 않으면
        localStorage 쓰기가 계속 돈다([[project_chat_write_storm]] 과 같은 유형).
        → 팀별 서명(signature)을 기억해 두고 달라졌을 때만 병합한다. */
  var _indSig = {};
  var _healedOnce = false;
  function mergeTeamIndustries(t) {
    if (!t || !t.id || !window.Profiles || !Profiles.mergeFromTeam) return;
    var list = Array.isArray(t.industries) ? t.industries : null;
    if (!list || !list.length) return;
    /* ★ 2026-08-23 자가치유는 서명 검사 **앞**에서 세션 1회 돌린다.
         v571 이전 버그로 생긴 '(이름 없음)' 중복은, 팀 문서가 그대로면(서명 동일)
         아래에서 그냥 return 돼 영영 정리되지 않는다.
         팀장이 팀 업종을 다시 저장하지 않아도 앱을 켜면 정리되게 한다. */
    if (!_healedOnce) {
      _healedOnce = true;
      try {
        var hn = Profiles.healNamelessProfiles ? Profiles.healNamelessProfiles() : 0;
        if (hn) {
          toast('업종 목록에서 중복 ' + hn + '건을 정리했습니다', 'ok');
          try { if (window.ProfilesUI && ProfilesUI.renderSettingsIndustries) ProfilesUI.renderSettingsIndustries(); } catch (e) {}
          try { if (window.ProfilesUI && ProfilesUI.renderWorkChip) ProfilesUI.renderWorkChip(); } catch (e) {}
          try { if (window.__calendarRefresh) window.__calendarRefresh(); } catch (e) {}
        }
      } catch (e) { console.warn('[CloudTeams] 업종 자가치유 실패', e && e.message); }
    }
    /* ★ 2026-08-24 서명에 지침도 넣는다 — 업종 목록은 그대로인데 팀장이 가격표만
         고친 경우가 실제로 더 흔하다. 안 넣으면 그 수정이 영영 안 내려간다. */
    var guides = (t.industryGuides && typeof t.industryGuides === 'object') ? t.industryGuides : null;
    var sig = '';
    try { sig = JSON.stringify([list, guides]); } catch (e) { sig = String(list.length); }
    if (_indSig[t.id] === sig) return;        // 안 바뀜 → 병합은 건너뛴다(치유는 위에서 이미 했다)
    _indSig[t.id] = sig;
    var r = null;
    try { r = Profiles.mergeFromTeam(list); } catch (e) { console.warn('[CloudTeams] 업종 병합 실패', e && e.message); return; }
    if (!r) return;

    /* ── 지침·가격표 적용(팀원만) ──────────────────────────
       팀장 폰은 자기가 원본이라 받지 않는다. 받으면 자기 지침을 자기가 덮는 꼴이고,
       편집 잠금(teamGuideOwner)까지 걸려 정작 팀장이 못 고치게 된다. */
    var gApplied = 0;
    if (guides && t.owner !== myUid() && window.ClaudeAI && ClaudeAI.importGuides) {
      Object.keys(r.map || {}).forEach(function (k) {
        var g = guides[k];
        if (!g) return;
        try { gApplied += (ClaudeAI.importGuides(r.map[k], g, t.name || '팀').applied || 0); } catch (e) {}
      });
      /* 팀장이 지침 공유를 껐으면 잠금을 푼다 — 본문은 그대로 두고 편집만 다시 열어준다 */
      if (t.shareGuides === false && ClaudeAI.clearTeamGuideOwner) {
        Object.keys(r.map || {}).forEach(function (k) {
          try { ClaudeAI.clearTeamGuideOwner(r.map[k]); } catch (e) {}
        });
      }
    }

    if (!r.added && !r.updated && !gApplied) return;
    console.log('[CloudTeams] 팀 업종 병합:', t.name || t.id, '추가', r.added, '갱신', r.updated, '지침', gApplied);
    if (r.added) toast('👥 팀 업종 ' + r.added + '개를 받았습니다', 'ok');
    if (gApplied) toast('📋 팀 지침·가격표 ' + gApplied + '건을 받았습니다', 'ok');
    try { if (window.ProfilesUI && ProfilesUI.renderSettingsIndustries) ProfilesUI.renderSettingsIndustries(); } catch (e) {}
    try { if (window.ProfilesUI && ProfilesUI.renderWorkChip) ProfilesUI.renderWorkChip(); } catch (e) {}
  }

  /* 팀장이 '내 업종' 중 골라 팀 업종으로 올린다 */
  CloudTeams.setIndustries = async function (teamId, pfIds, shareGuides) {
    if (!loggedIn()) { toast('먼저 로그인해주세요', 'err'); return false; }
    var t = _teams.filter(function (x) { return x.id === teamId; })[0];
    if (!t) { toast('팀을 찾을 수 없습니다', 'err'); return false; }
    if (t.owner !== myUid()) { toast('팀 업종은 팀장만 정할 수 있습니다', 'err'); return false; }
    var list = [], guides = {};
    (pfIds || []).forEach(function (id) {
      try {
        var e = Profiles.teamEntryOf(id);
        if (!e) return;
        list.push(e);
        /* ★ 2026-08-24 지침·가격표 동봉 — 팀 업종의 지침은 팀장이 쓴 것으로 통일한다.
             한 번도 안 쓴 채널은 exportGuides 가 알아서 뺀다(기본 지침이 굳는 걸 막는다). */
        if (shareGuides && window.ClaudeAI && ClaudeAI.exportGuides) {
          var g = ClaudeAI.exportGuides(id);
          if (g && Object.keys(g).length) guides[e.key] = g;
        }
      } catch (er) {}
    });
    /* Firestore 문서는 1MB 한도다. 지침이 그만큼 길 일은 없지만, 넘으면 통째로 실패하므로 미리 막는다. */
    try {
      if (JSON.stringify(guides).length > 400000) {
        toast('지침이 너무 깁니다 — 지침 공유는 빼고 저장합니다', 'err');
        guides = {};
      }
    } catch (er) {}
    try {
      await db().collection('teams').doc(teamId).set({
        industries: list,
        industryGuides: guides,
        shareGuides: !!shareGuides,
        industriesAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      _indSig[teamId] = '';        // 내 폰에서도 다시 병합되도록 서명 초기화
      var _gn = Object.keys(guides).length;
      toast(list.length
        ? ('✅ 팀 업종 ' + list.length + '개를 지정했습니다' + (_gn ? (' (지침·가격표 ' + _gn + '개 포함)') : ''))
        : '팀 업종을 비웠습니다', 'ok');
      return true;
    } catch (e) {
      toast('저장 실패: ' + ((e && e.code) || (e && e.message) || ''), 'err');
      return false;
    }
  };

  // ── 팀마다 채팅방(rooms/team_{teamId}) 자동 생성/멤버 동기화 (방 개설 UI 불필요) ──
  function ensureTeamRoom(t) {
    if (!loggedIn() || !t || !t.id) return;
    var members = (t.members || []).slice();
    if (members.indexOf(myUid()) < 0) return;
    var memberNames = t.memberNames || {};
    var ref = db().collection('rooms').doc('team_' + t.id);
    ref.get().then(function (doc) {
      if (!doc.exists) {
        ref.set({
          teamId: t.id, teamName: t.name || '팀',
          members: members, memberNames: memberNames, isGroup: true,
          createdBy: myUid(), createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(function (e) { console.warn('[CloudTeams] 채팅방 생성 실패', e && e.code); });
      } else {
        var d = doc.data() || {};
        var cur = (d.members || []).slice().sort().join(',');
        var want = members.slice().sort().join(',');
        if (cur !== want || (d.teamName || '') !== (t.name || '') || !d.teamId) {
          ref.set({ teamId: t.id, teamName: t.name || '팀', members: members, memberNames: memberNames, isGroup: true }, { merge: true })
            .catch(function (e) { console.warn('[CloudTeams] 채팅방 갱신 실패', e && e.code); });
        }
      }
    }).catch(function (e) { console.warn('[CloudTeams] 채팅방 확인 실패', e && e.code); });
  }

  function pull() {
    if (!loggedIn()) return;
    db().collection('teams').where('members', 'array-contains', myUid()).get()
      .then(function (s) { processTeams(s.docs); })
      .catch(function (e) { console.warn('[CloudTeams] 목록 실패', e && e.code); });
  }

  function subscribe() {
    if (!loggedIn()) { _teams = []; return; }
    if (_teamsUnsub) return;
    pull();
    _teamsUnsub = db().collection('teams').where('members', 'array-contains', myUid())
      .onSnapshot(function (s) { processTeams(s.docs); },
        function (e) { console.warn('[CloudTeams] 구독 오류', e && e.code); });
  }
  function cleanup() {
    if (_teamsUnsub) { try { _teamsUnsub(); } catch (e) {} _teamsUnsub = null; }
    _teams = []; _lastTeamIds = '';
    try { if (window.CloudShare && CloudShare.setTeamPartners) CloudShare.setTeamPartners({}); } catch (e) {}
    renderArea();
  }

  CloudTeams.getTeams = function () { return _teams.slice(); };
  CloudTeams.ensure = function () { if (loggedIn()) subscribe(); };

  /* ★ 2026-08-11 배터리 개선 - 앱이 백그라운드일 땐 팀 목록 리스너를 끊는다.
       (cloud_share.js의 pauseShareSync/cloud_chat.js의 pausePresence와 동일 패턴)
       cleanup()과 달리 _teams 데이터나 CloudShare 팀원 주입은 건드리지 않는다 -
       화면에 안 보이는 동안 리스너만 잠깐 끊었다가 복귀 시 그대로 되살린다. */
  var _teamsPaused = false;
  function pauseTeams(){
    if (_teamsPaused) return;
    _teamsPaused = true;
    if (_teamsUnsub) { try { _teamsUnsub(); } catch (e) {} _teamsUnsub = null; }
  }
  function resumeTeams(){
    if (!_teamsPaused) return;
    _teamsPaused = false;
    if (!loggedIn()) return;
    subscribe();
  }
  document.addEventListener('visibilitychange', function(){
    if (document.hidden) pauseTeams(); else resumeTeams();
  });
  try {
    var _AppT = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (_AppT && _AppT.addListener) {
      _AppT.addListener('appStateChange', function (st) {
        if (st && st.isActive === false) pauseTeams(); else resumeTeams();
      });
    }
  } catch (e) {}

  /* ════════ 팀 만들기 / 참여 / 나가기 ════════ */
  CloudTeams.createTeam = async function (name) {
    if (!loggedIn()) { toast('먼저 로그인해주세요', 'err'); return; }
    if (window.Subs && !Subs.gateFeature('teamCreate', '팀 만들기', '팀 만들기는 베이직 이상 플랜에서 가능합니다. 라이트 플랜은 초대 코드로 참여만 할 수 있어요.')) return;
    name = (name || '').trim();
    if (!name) { toast('팀 이름을 입력해주세요', 'err'); return; }
    var code = genCode();
    var mn = {}; mn[myUid()] = displayMyName();
    try {
      var ref = await db().collection('teams').add({
        name: name.slice(0, 30), owner: myUid(), members: [myUid()],
        memberNames: mn, inviteCode: code,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await db().collection('users').doc(myUid()).set(
        { teamIds: firebase.firestore.FieldValue.arrayUnion(ref.id) }, { merge: true });
      toast('팀 "' + name + '"을(를) 만들었습니다', 'ok');
      pull();
    } catch (e) { console.warn('[CloudTeams] 생성 실패', e); toast('생성 실패: ' + (e && (e.message || e.code)), 'err'); }
  };

  CloudTeams.joinByCode = async function (code) {
    if (!loggedIn()) { toast('먼저 로그인해주세요', 'err'); return; }
    if (window.Subs && !Subs.gateFeature('share', '팀 공유', '팀 참여는 라이트 플랜(월 4,900원)부터 가능합니다.')) return;
    code = (code || '').trim().toUpperCase();
    if (!code) { toast('초대 코드를 입력해주세요', 'err'); return; }
    try {
      var snap = await db().collection('teams').where('inviteCode', '==', code).limit(1).get();
      if (snap.empty) { toast('해당 코드의 팀을 찾을 수 없습니다', 'err'); return; }
      var t = snap.docs[0];
      if ((t.data().members || []).indexOf(myUid()) >= 0) { toast('이미 참여 중인 팀입니다', 'ok'); return; }
      var upd = { members: firebase.firestore.FieldValue.arrayUnion(myUid()) };
      upd['memberNames.' + myUid()] = displayMyName();
      await db().collection('teams').doc(t.id).update(upd);
      await db().collection('users').doc(myUid()).set(
        { teamIds: firebase.firestore.FieldValue.arrayUnion(t.id) }, { merge: true });
      toast('"' + (t.data().name || '팀') + '"에 참여했습니다', 'ok');
      pull();
    } catch (e) { console.warn('[CloudTeams] 참여 실패', e); toast('참여 실패: ' + (e && (e.message || e.code)), 'err'); }
  };

  CloudTeams.leaveTeam = async function (teamId) {
    if (!loggedIn()) return;
    var t = _teams.filter(function (x) { return x.id === teamId; })[0];
    if (!t) return;
    if (t.owner === myUid()) {
      if (!confirm('팀장입니다. 팀 "' + (t.name || '') + '"을(를) 삭제할까요?\n(모든 멤버의 공유가 해제됩니다)')) return;
      try {
        await db().collection('teams').doc(teamId).delete();
        try { await db().collection('rooms').doc('team_' + teamId).delete(); } catch (e) { console.warn('[팀] 팀 채팅방 삭제 실패:', teamId, e && (e.code || e.message)); }
        await db().collection('users').doc(myUid()).set(
          { teamIds: firebase.firestore.FieldValue.arrayRemove(teamId) }, { merge: true });
        toast('팀을 삭제했습니다', 'ok'); pull();
      } catch (e) { toast('삭제 실패: ' + (e && (e.message || e.code)), 'err'); }
      return;
    }
    if (!confirm('팀 "' + (t.name || '') + '"에서 나갈까요?')) return;
    var upd = { members: firebase.firestore.FieldValue.arrayRemove(myUid()) };
    upd['memberNames.' + myUid()] = firebase.firestore.FieldValue.delete();
    try {
      await db().collection('teams').doc(teamId).update(upd);
      try { await db().collection('rooms').doc('team_' + teamId).set({ members: firebase.firestore.FieldValue.arrayRemove(myUid()) }, { merge: true }); } catch (e) {}
      await db().collection('users').doc(myUid()).set(
        { teamIds: firebase.firestore.FieldValue.arrayRemove(teamId) }, { merge: true });
      toast('팀에서 나갔습니다', 'ok'); pull();
    } catch (e) { toast('나가기 실패: ' + (e && (e.message || e.code)), 'err'); }
  };

  /* ⭐ 2026-08-24 — 팀장이 지침을 고치면 그 자리에서 팀 문서도 갱신한다.
       안 하면 '팀 업종 지정' 화면을 다시 열어 저장할 때까지 팀원 폰에 안 내려가서,
       팀장은 고쳤는데 팀원은 옛 가격표로 견적을 뽑는 상태가 조용히 유지된다.
       내가 팀장인 팀 중, 그 업종을 팀 업종으로 올려둔 팀만 갱신한다. */
  CloudTeams.refreshIndustryGuides = async function (pfId) {
    if (!pfId || !loggedIn() || !window.Profiles || !window.ClaudeAI || !ClaudeAI.exportGuides) return 0;
    var e = null;
    try { e = Profiles.teamEntryOf(pfId); } catch (er) {}
    if (!e || !e.key) return 0;
    var g = null;
    try { g = ClaudeAI.exportGuides(pfId); } catch (er) {}
    if (!g || !Object.keys(g).length) return 0;
    var n = 0;
    for (var i = 0; i < _teams.length; i++) {
      var t = _teams[i];
      if (!t || t.owner !== myUid() || t.shareGuides === false) continue;
      var has = (Array.isArray(t.industries) ? t.industries : []).some(function (x) { return x && x.key === e.key; });
      if (!has) continue;
      try {
        var patch = {};
        patch['industryGuides.' + e.key] = g;
        patch.industriesAt = firebase.firestore.FieldValue.serverTimestamp();
        await db().collection('teams').doc(t.id).update(patch);
        _indSig[t.id] = '';       // 내 폰 서명도 초기화(다음 스냅샷에서 다시 훑도록)
        n++;
      } catch (er) {
        console.warn('[CloudTeams] 팀 지침 갱신 실패', er && er.code);
        /* 조용히 실패하면 팀장은 반영된 줄 알고, 팀원은 옛 가격표로 견적을 뽑는다.
           Firestore 규칙이 industryGuides 쓰기를 막고 있을 수 있어 사유를 그대로 띄운다. */
        toast('팀 지침 반영 실패: ' + ((er && er.code) || (er && er.message) || '알 수 없음'), 'err');
      }
    }
    if (n) toast('📋 팀 지침을 팀원에게 반영했습니다', 'ok');
    return n;
  };

  /* ════════ UI (#cloudTeamArea) ════════ */
  /* 팀 업종 칩 — 아이콘은 그림(svg:)·이미지(img:)도 그릴 수 있게 Profiles.iconHtml 을 거친다 */
  function _indChipsHtml(t) {
    var list = Array.isArray(t && t.industries) ? t.industries : [];
    if (!list.length) return '<span style="font-size:11px;color:var(--mu);">미지정 — 팀원마다 각자 업종을 씁니다 (팀장이 지정할 수 있어요)</span>';
    return list.map(function (e) {
      var ic = '';
      try { ic = (window.Profiles && Profiles.iconHtml) ? Profiles.iconHtml(e.icon || '', 13) : (e.icon || ''); } catch (er) { ic = ''; }
      return '<span style="display:inline-flex;align-items:center;gap:4px;background:var(--sf);border:1px solid var(--bd);' +
             'border-radius:999px;padding:2px 9px;margin:0 4px 4px 0;font-size:11px;font-weight:700;">' +
             (ic ? ('<span style="display:inline-flex;">' + ic + '</span>') : '') + esc(e.name || '') + '</span>';
    }).join('');
  }

  /* 팀장 전용 — 내 업종 중에서 팀 업종을 고르는 시트 (다중 선택) */
  function openIndustryPicker(teamId) {
    if (!window.Profiles || !Profiles.list) { toast('업종 모듈 로드 안 됨 (앱 재빌드 필요)', 'err'); return; }
    var t = _teams.filter(function (x) { return x.id === teamId; })[0];
    if (!t) return;
    var mine = Profiles.list() || [];
    if (!mine.length) { toast('먼저 설정에서 내 업종을 추가해주세요', 'err'); return; }
    // 이미 팀 업종인 것을 '이름'으로 매칭해 체크 상태로 (id 는 폰마다 다르다)
    var cur = {};
    (Array.isArray(t.industries) ? t.industries : []).forEach(function (e) {
      var m = null; try { m = Profiles.matchByName(e.name); } catch (er) {}
      if (m) cur[m.id] = 1;
    });
    var shareG = (t.shareGuides !== false);     // 기본 켬 — 팀 업종이면 지침도 맞추는 게 자연스럽다
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:3700;display:flex;align-items:center;justify-content:center;padding:20px;';
    var rows = mine.map(function (p) {
      var ic = '';
      try { ic = Profiles.iconHtml(Profiles.iconOf(p), 16); } catch (er) { ic = ''; }
      return '<label style="display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid var(--sf2,#eee);font-size:14px;">' +
             '<input type="checkbox" class="tiPick" value="' + esc(p.id) + '"' + (cur[p.id] ? ' checked' : '') + '>' +
             '<span style="display:inline-flex;">' + ic + '</span>' +
             '<span style="flex:1;font-weight:700;">' + esc(p.name || '') + '</span></label>';
    }).join('');
    ov.innerHTML =
      '<div style="background:var(--sf);border-radius:14px;padding:18px;max-width:400px;width:100%;max-height:calc(100vh - 60px);display:flex;flex-direction:column;">' +
        '<div style="font-size:16px;font-weight:800;margin-bottom:4px;">🏷 팀 업종 지정</div>' +
        '<div style="font-size:11.5px;color:var(--mu);line-height:1.6;margin-bottom:10px;">' +
          '팀 업종은 <b>팀장만</b> 지정하고 해제할 수 있습니다.<br>' +
          '고른 업종이 <b>팀원 폰에 자동으로 추가</b>되고 이름·아이콘·호칭이 팀 기준으로 맞춰집니다.<br>' +
          '체크를 풀면 맞추는 것만 멈춥니다 — <b>이미 팀원 폰에 들어간 업종이 지워지지는 않아요</b>' +
          '(필요 없으면 각자 목록에서 빼면 됩니다).' +
        '</div>' +
        '<div style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;margin-bottom:10px;">' + rows + '</div>' +
        /* ★ 2026-08-24 지침·가격표 공유 */
        '<label style="display:flex;align-items:flex-start;gap:9px;background:var(--sf2,#2a2f36);border-radius:9px;' +
               'padding:10px 11px;margin-bottom:12px;cursor:pointer;">' +
          '<input type="checkbox" id="tiGuides" style="margin-top:2px;"' + (shareG ? ' checked' : '') + '>' +
          '<span style="flex:1;font-size:11.5px;line-height:1.6;">' +
            '<b style="font-size:13px;">글쓰기 지침·가격표도 함께 공유</b><br>' +
            '<span style="color:var(--mu);">' +
              '고른 업종의 <b>견적 지침(가격표)</b>과 블로그·당근·인스타·페이스북 지침을 팀원에게 내려보냅니다. ' +
              '팀 업종의 지침은 <b>팀장이 작성</b>하는 것으로 통일되고, 팀원 폰에서는 읽기 전용이 됩니다.<br>' +
              '⚠️ 지침에 적어둔 <b>업체명·연락처가 그대로 팀원 글에 쓰입니다.</b> ' +
              '사람마다 달라야 하면 지침에서 그 줄을 빼주세요.<br>' +
              '※ 업로드한 엑셀 견적 양식(파일)은 공유되지 않습니다.' +
            '</span>' +
          '</span>' +
        '</label>' +
        '<div style="display:flex;gap:8px;">' +
          '<button class="btn b-ghost" id="tiCancel" style="flex:1;justify-content:center;">취소</button>' +
          '<button class="btn b-blue" id="tiSave" style="flex:1;justify-content:center;">저장</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    var close = function () { if (ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('#tiCancel').onclick = close;
    ov.querySelector('#tiSave').onclick = async function () {
      var ids = Array.prototype.slice.call(ov.querySelectorAll('.tiPick'))
        .filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
      this.disabled = true;
      var _g = ov.querySelector('#tiGuides');
      var ok = await CloudTeams.setIndustries(teamId, ids, !!(_g && _g.checked));
      this.disabled = false;
      if (ok) close();
    };
  }

  function renderArea() {
    var box = document.getElementById('cloudTeamArea');
    if (!box) return;
    if (!loggedIn()) { box.innerHTML = ''; return; }

    var h = '';
    h += '<div style="border-top:1px solid var(--bd);margin:14px 0 12px;"></div>';
    h += '<div style="text-align:left;">';
    h += '<div style="font-size:13px;font-weight:800;margin-bottom:2px;">👥 팀 공유 (여러 명)</div>';
    // 내 팀 목록
    if (_teams.length) {
      h += '<div style="font-size:12px;font-weight:700;margin-bottom:6px;">내 팀</div>';
      _teams.forEach(function (t) {
        var isOwner = t.owner === myUid();
        var members = (t.members || []);
        var names = members.map(function (u) { return (t.memberNames && t.memberNames[u]) || (u === myUid() ? '나' : '팀원'); });
        var ownerName = (t.memberNames && t.memberNames[t.owner]) || '';
        try { if (window.CloudShare && CloudShare.nickOf) { var _on = CloudShare.nickOf(t.owner); if (_on) ownerName = _on; } } catch (e) {}
        if (!ownerName) ownerName = isOwner ? '나' : '팀장';
        h += '<div style="background:var(--sf2);border-radius:8px;padding:10px;margin-bottom:8px;">' +
          '<div style="display:flex;align-items:center;gap:6px;">' +
            '<span style="flex:1;font-size:13px;font-weight:700;">' + esc(t.name || '팀') + ' <span style="font-size:10px;color:var(--mu);font-weight:400;">(' + esc(ownerName) + ' 팀장)</span>' + '</span>' +
            '<button class="btn b-ghost b-xs" data-tact="leave" data-id="' + t.id + '">' + (isOwner ? '삭제' : '나가기') + '</button>' +
          '</div>' +
          '<div style="font-size:11px;color:var(--mu);margin-top:4px;">멤버 ' + members.length + '명: ' + esc(names.join(', ')) + '</div>' +
          '<div style="display:flex;align-items:center;gap:6px;margin-top:6px;">' +
            '<span style="font-size:11px;color:var(--mu);">초대 코드</span>' +
            '<code style="font-size:14px;font-weight:800;letter-spacing:1px;background:var(--sf);padding:2px 8px;border-radius:6px;">' + esc(t.inviteCode || '------') + '</code>' +
            '<button class="btn b-ghost b-xs" data-tact="copy" data-code="' + esc(t.inviteCode || '') + '">복사</button>' +
          '</div>' +
          /* ★ 2026-08-23 팀 업종 — 팀원 폰의 업종 이름·아이콘·호칭을 팀 기준으로 맞춘다 */
          '<div style="display:flex;align-items:flex-start;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid var(--bd);">' +
            '<span style="font-size:11px;color:var(--mu);flex:0 0 auto;padding-top:3px;">🏷 팀 업종</span>' +
            '<div style="flex:1;min-width:0;">' + _indChipsHtml(t) + '</div>' +
            (isOwner ? ('<button class="btn b-ghost b-xs" data-tact="ind" data-id="' + t.id + '" style="flex:0 0 auto;">지정</button>') : '') +
          '</div>' +
          /* ★ 2026-08-23 안내 — '누가 정하는가'가 안 적혀 있어 팀원이 자기 업종을 고쳤다가
               팀 기준으로 되돌아오는 걸 오작동으로 여겼다(사용자 지적). 역할별로 나눠 적는다. */
          (isOwner
            ? '<div style="font-size:11px;color:var(--mu);margin-top:6px;line-height:1.55;">' +
                '팀 업종은 <b>팀장인 나만</b> 지정하고 해제할 수 있습니다. ' +
                '지정하면 팀원 폰에 자동으로 추가되고 이름·아이콘·호칭이 팀 기준으로 맞춰져요.' +
                (t.shareGuides !== false
                  ? '<br><b>글쓰기 지침과 견적 가격표도 함께 내려갑니다</b> — 팀 업종의 지침은 내가 쓴 것으로 통일되고, ' +
                    '팀원 폰에서는 읽기 전용이 됩니다. 내가 고치면 자동으로 따라와요.'
                  : '<br>지침·가격표는 지금 <b>공유하지 않는 중</b>입니다 — 지정 화면에서 켤 수 있어요.') +
                '<br>해제하면 더 이상 맞추지 않습니다. 다만 <b>이미 팀원 폰에 들어간 업종이 사라지지는 않아요</b> — ' +
                '필요 없으면 각자 업종 목록에서 빼면 됩니다.' +
              '</div>'
            : '<div style="font-size:11px;color:var(--mu);margin-top:6px;line-height:1.55;">' +
                '팀 업종은 <b>팀장이 정합니다.</b> 팀장이 지정한 업종은 내 목록에 자동으로 추가되고, ' +
                '이름·아이콘·호칭이 팀 기준으로 맞춰집니다.' +
                (t.shareGuides !== false
                  ? '<br>이 업종들의 <b>글쓰기 지침과 견적 가격표는 팀장이 작성</b>합니다(읽기 전용). ' +
                    '팀장이 고치면 내 폰에도 자동으로 반영돼요.'
                  : '') +
                '<br>내가 직접 만든 업종과 지침은 그대로 남고, 업로드한 엑셀 견적 양식은 공유되지 않습니다.' +
              '</div>') +
          (isOwner ? '<div style="font-size:11px;color:var(--mu);margin-top:6px;line-height:1.5;">초대받는 팀원은 <b>라이트 플랜(월 4,900원)</b>으로 참여할 수 있어요.</div>' : '') +
        '</div>';
      });
    } else {
      // ★ 팀이 없을 때만 '만들기 / 초대코드 참여' 노출
      /* ★ 2026-08-26 '팀원' 플랜인데 팀을 만들 수 있는 줄 알고 눌러보는 사례가 있었다.
           안내는 아래 회색 문구에 있었지만 눌러봐야 알 수 있었다 → 만들기 칸 자체를 잠근 모습으로 보여준다.
           버튼은 살려둔다 — 누르면 기존 gateFeature 가 요금제 창을 열어준다. */
      var canCreate = !window.Subs || Subs.hasFeature('teamCreate');
      h += '<div style="font-size:11px;color:var(--mu);line-height:1.5;margin-bottom:10px;">팀을 만들어 초대 코드를 알려주거나, 받은 코드로 참여하세요. 팀원 모두의 일정·사진이 함께 표시됩니다.</div>';
      if (!canCreate) {
        h += '<div style="border:1.5px solid var(--wn);background:rgba(240,180,41,.12);border-radius:10px;padding:10px 12px;margin-bottom:8px;">' +
          '<div style="font-size:13px;font-weight:800;color:var(--wn);line-height:1.5;">🔒 팀 만들기는 베이직(월 9,900원)부터</div>' +
          '<div style="font-size:12px;color:var(--tx);margin-top:5px;line-height:1.6;">지금 요금제로는 <b>초대 코드로 참여</b>만 할 수 있어요. 팀장에게 코드를 받아 아래에 넣어주세요.</div>' +
          '</div>';
      }
      h += '<div style="display:flex;gap:6px;margin-bottom:8px;' + (canCreate ? '' : 'opacity:.5;') + '">' +
        '<input class="co-input" id="teamNewName" type="text" placeholder="' + (canCreate ? '새 팀 이름' : '베이직부터 만들 수 있어요') + '" style="flex:1;"' + (canCreate ? '' : ' disabled') + '>' +
        '<button class="btn b-blue" id="teamCreateBtn" style="white-space:nowrap;">' + (canCreate ? '만들기' : '🔒 만들기') + '</button>' +
        '</div>';
      h += '<div style="display:flex;gap:6px;margin-bottom:12px;">' +
        '<input class="co-input" id="teamJoinCode" type="text" placeholder="초대 코드 (예: ABC123)" maxlength="6" style="flex:1;text-transform:uppercase;">' +
        '<button class="btn b-ghost" id="teamJoinBtn" style="white-space:nowrap;">참여</button>' +
        '</div>';
    }
    h += '</div>';

    box.innerHTML = h;

    var cb = document.getElementById('teamCreateBtn');
    if (cb) cb.onclick = function () { CloudTeams.createTeam(document.getElementById('teamNewName').value); };
    var jb = document.getElementById('teamJoinBtn');
    if (jb) jb.onclick = function () { CloudTeams.joinByCode(document.getElementById('teamJoinCode').value); };
    box.querySelectorAll('[data-tact]').forEach(function (btn) {
      btn.onclick = function () {
        var act = btn.getAttribute('data-tact');
        if (act === 'leave') CloudTeams.leaveTeam(btn.getAttribute('data-id'));
        else if (act === 'ind') openIndustryPicker(btn.getAttribute('data-id'));
        else if (act === 'copy') {
          var code = btn.getAttribute('data-code') || '';
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code);
            else { var ta = document.createElement('textarea'); ta.value = code; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
            toast('초대 코드를 복사했습니다: ' + code, 'ok');
          } catch (e) { toast('복사 실패 — 코드: ' + code, 'err'); }
        }
      };
    });
  }
  CloudTeams.renderArea = renderArea;

  document.addEventListener('cloud-auth-changed', function (e) {
    if (e && e.detail && e.detail.user) { subscribe(); }
    else { cleanup(); }
  });
  document.addEventListener('cloud-share-render', renderArea);
})();
