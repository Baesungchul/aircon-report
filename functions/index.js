/* ═══════════════════════════════════════════════
   work-report Cloud Functions
   - 채팅 푸시 / 공유사진 알림 / 계정·데이터 삭제 / 관리자 통계
   ⚠️ 2026-08-26 자원점검: 여기 있던 claudeProxy 를 제거했다.
      앱(ai.js)은 예전부터 vercel-proxy 만 부른다 — 이 함수는 아무도 안 쓰면서
      인증 없이 열려있는 '두 번째 문'이었다. 배포해야 실제로 사라진다.
      ⭐근거: _bak/_bak_archive 의 ai.js 사본 15개(2026-07-07~08-23)를 전부 확인 —
        처음부터 끝까지 PROXY_URL 이 vercel 이었고, 저장소 어디에도
        cloudfunctions.net/claudeProxy 를 부르는 코드가 없다. 즉 출시된 어떤 버전도
        이 함수를 쓴 적이 없다 → 지워도 미업데이트 사용자에게 영향 없음.
      → firebase deploy --only functions  (삭제 확인 프롬프트에 y)
   ⚠️ vercel-proxy 쪽 인증은 아직 없다. 그건 별도 작업.
═══════════════════════════════════════════════ */
const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');



/* ═══════════════════════════════════════════════
   onNewChatMessage — 채팅방(rooms/{roomId}/messages)에 새 메시지가 생기면
   보낸 사람을 제외한 방 참가자 전원에게 FCM 푸시 알림을 보낸다.
   - 토큰은 users/{uid}.fcmTokens 배열(기기 여러 대 지원)
   - 만료/무효 토큰은 발송 결과를 보고 users 문서에서 자동 제거(청소)
═══════════════════════════════════════════════ */
// 수신자의 알림 종류별 설정 확인 — users/{uid}.notifPrefs[key]===false 면 발송 안 함(기본 발송)
function notifOn(userData, key) {
  return !(userData && userData.notifPrefs && userData.notifPrefs[key] === false);
}

exports.onNewChatMessage = onDocumentCreated(
  { document: 'rooms/{roomId}/messages/{messageId}', region: 'asia-northeast3' },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const msg = snap.data() || {};
    const roomId = event.params.roomId;
    const db = admin.firestore();

    const roomSnap = await db.collection('rooms').doc(roomId).get();
    if (!roomSnap.exists) return;
    const room = roomSnap.data() || {};
    const members = Array.isArray(room.members) ? room.members : [];
    const recipients = members.filter((uid) => uid && uid !== msg.senderUid);
    if (!recipients.length) return;

    const userDocs = await Promise.all(
      recipients.map((uid) => db.collection('users').doc(uid).get())
    );

    const title = msg.senderName || '새 메시지';
    const body = String(msg.text || '').slice(0, 200);

    await Promise.all(userDocs.map(async (userDoc) => {
      if (!userDoc.exists) return;
      if (!notifOn(userDoc.data(), 'chat')) return;
      const tokens = userDoc.data().fcmTokens;
      if (!Array.isArray(tokens) || !tokens.length) return;

      const res = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: { roomId: String(roomId) },
        android: { priority: 'high' }
      });

      // 만료/무효 토큰 청소
      const badTokens = [];
      res.responses.forEach((r, i) => {
        if (!r.success) {
          const code = r.error && r.error.code;
          if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
            badTokens.push(tokens[i]);
          }
        }
      });
      if (badTokens.length) {
        await userDoc.ref.update({
          fcmTokens: admin.firestore.FieldValue.arrayRemove(...badTokens)
        }).catch(() => {});
      }
    }));
  }
);


/* ═══════════════════════════════════════════════
   onReuploadRequested — 상대가 만료된 사진의 "원본 재업로드"를 요청하면
   원본 소유자에게 FCM 푸시를 보낸다 (앱을 열어야 자동 재업로드가 실행되므로 알려줘야 함).
   - schedules/{uid}/items/{itemId} 문서의 reuploadRequestedAt이 새로 세팅될 때만 발송
   - 받는 사람: 이 항목의 소유자(uid) 본인
═══════════════════════════════════════════════ */
exports.onReuploadRequested = onDocumentUpdated(
  { document: 'schedules/{uid}/items/{itemId}', region: 'asia-northeast3' },
  async (event) => {
    const before = event.data.before.data() || {};
    const after = event.data.after.data() || {};
    if (!after.reuploadRequestedAt) return;
    const beforeMs = (before.reuploadRequestedAt && before.reuploadRequestedAt.toMillis) ? before.reuploadRequestedAt.toMillis() : 0;
    const afterMs = after.reuploadRequestedAt.toMillis ? after.reuploadRequestedAt.toMillis() : 0;
    if (beforeMs === afterMs) return;

    const ownerUid = event.params.uid;
    const workId = event.params.itemId;
    const db = admin.firestore();

    const userDoc = await db.collection('users').doc(ownerUid).get();
    if (!userDoc.exists) return;
    if (!notifOn(userDoc.data(), 'sharedPhoto')) return;   // 사진 알림 통합: 공유사진 도착 토글로 제어
    const tokens = userDoc.data().fcmTokens;
    if (!Array.isArray(tokens) || !tokens.length) return;

    const title = '📩 원본 요청';
    const body = (after.apt ? after.apt + ' - ' : '') + '만료된 사진 원본을 다시 요청받았습니다';

    const res = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: { type: 'reuploadRequested', ownerUid: String(ownerUid), workId: String(workId) },
      android: { priority: 'high' }
    });

    const badTokens = [];
    res.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error && r.error.code;
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
          badTokens.push(tokens[i]);
        }
      }
    });
    if (badTokens.length) {
      await userDoc.ref.update({
        fcmTokens: admin.firestore.FieldValue.arrayRemove(...badTokens)
      }).catch(() => {});
    }
  }
);


/* ═══════════════════════════════════════════════
   onNewSharedPhotoUpload — 공유 작업에 새 사진이 "저장"되면(사진 찍을 때마다가 아니라
   저장 1번당 1번만) 공유 상대에게 FCM 푸시를 보낸다.
   - schedules/{uid}/items/{itemId} 문서의 lastPhotoUploadNonce 필드가 바뀐 경우에만 발송
     (nonce 비교로 "진짜 새 업로드 배치가 있었을 때"만 정확히 1번 감지, 중복 발송 방지)
   - 받는 사람: 이 항목 소유자(uid)와 accepted 상태로 공유 중인 상대들
═══════════════════════════════════════════════ */
exports.onNewSharedPhotoUpload = onDocumentUpdated(
  { document: 'schedules/{uid}/items/{itemId}', region: 'asia-northeast3' },
  async (event) => {
    const before = event.data.before.data() || {};
    const after = event.data.after.data() || {};
    if (!after.lastPhotoUploadNonce || after.lastPhotoUploadNonce === before.lastPhotoUploadNonce) return;

    const ownerUid = event.params.uid;
    const workId = event.params.itemId;
    const db = admin.firestore();

    const sharesSnap = await db.collection('shares')
      .where('members', 'array-contains', ownerUid)
      .where('status', '==', 'accepted')
      .get();
    const partnerUids = [];
    sharesSnap.forEach((doc) => {
      const members = doc.data().members || [];
      members.forEach((uid) => { if (uid && uid !== ownerUid) partnerUids.push(uid); });
    });
    if (!partnerUids.length) return;

    const userDocs = await Promise.all(
      partnerUids.map((uid) => db.collection('users').doc(uid).get())
    );

    const title = '📷 새 사진 도착';
    const count = after.lastPhotoUploadCount || 1;
    const body = (after.apt ? after.apt + ' - ' : '') + '사진 ' + count + '장이 추가되었습니다';

    await Promise.all(userDocs.map(async (userDoc) => {
      if (!userDoc.exists) return;
      if (!notifOn(userDoc.data(), 'sharedPhoto')) return;
      const tokens = userDoc.data().fcmTokens;
      if (!Array.isArray(tokens) || !tokens.length) return;

      const res = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: { type: 'sharedPhoto', ownerUid: String(ownerUid), workId: String(workId) },
        android: { priority: 'high' }
      });

      const badTokens = [];
      res.responses.forEach((r, i) => {
        if (!r.success) {
          const code = r.error && r.error.code;
          if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
            badTokens.push(tokens[i]);
          }
        }
      });
      if (badTokens.length) {
        await userDoc.ref.update({
          fcmTokens: admin.firestore.FieldValue.arrayRemove(...badTokens)
        }).catch(() => {});
      }
    }));
  }
);


/* ═══════════════════════════════════════════════
   onBorrowedPhotoAdded — 공유 상대가 "열기"로 내 작업을 보다가 새 사진을 찍어
   저장하면(같은 작업에 진짜 보태기, saveBorrowedPhotos), 원본 소유자에게 FCM 푸시를 보낸다.
   - onNewSharedPhotoUpload와 정반대 방향: 저 함수는 "소유자→상대" 알림이고
     이 함수는 "상대→소유자" 알림. 그래서 별도 nonce 필드(lastBorrowedUploadNonce)를 쓴다.
   - schedules/{uid}/items/{itemId} 문서의 lastBorrowedUploadNonce가 바뀐 경우에만 발송
   - 받는 사람: 이 항목의 소유자(uid) 본인 (상대가 아님 - 상대는 자기가 방금 올렸으니 알 필요 없음)
═══════════════════════════════════════════════ */
exports.onBorrowedPhotoAdded = onDocumentUpdated(
  { document: 'schedules/{uid}/items/{itemId}', region: 'asia-northeast3' },
  async (event) => {
    const before = event.data.before.data() || {};
    const after = event.data.after.data() || {};
    if (!after.lastBorrowedUploadNonce || after.lastBorrowedUploadNonce === before.lastBorrowedUploadNonce) return;

    const ownerUid = event.params.uid;
    const workId = event.params.itemId;
    const db = admin.firestore();

    const userDoc = await db.collection('users').doc(ownerUid).get();
    if (!userDoc.exists) return;
    if (!notifOn(userDoc.data(), 'sharedPhoto')) return;   // 사진 알림 통합: 공유사진 도착 토글로 제어
    const tokens = userDoc.data().fcmTokens;
    if (!Array.isArray(tokens) || !tokens.length) return;

    const title = '📷 상대가 사진을 추가했습니다';
    const count = after.lastBorrowedUploadCount || 1;
    const body = (after.apt ? after.apt + ' - ' : '') + '사진 ' + count + '장이 추가되었습니다';

    const res = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: { type: 'borrowedPhotoAdded', ownerUid: String(ownerUid), workId: String(workId) },
      android: { priority: 'high' }
    });

    const badTokens = [];
    res.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error && r.error.code;
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
          badTokens.push(tokens[i]);
        }
      }
    });
    if (badTokens.length) {
      await userDoc.ref.update({
        fcmTokens: admin.firestore.FieldValue.arrayRemove(...badTokens)
      }).catch(() => {});
    }
  }
);


/* ═══════════════════════════════════════════════
   cleanupAccounts — 미구독/삭제요청 계정 정리 (예약 실행, 매일 새벽 4시 KST)
   정책(2026-07-10): 서버 저장은 유료(구독) 기능이므로, 삭제 기준은 '앱 접속'이 아니라 '구독 상태'다.
   - 구독 활성(subscriptionActive) → 데이터 계속 유지(앱 접속 여부와 무관).
   - 구독 종료(해지/만료) 후 '미구독 상태가 6개월 지속' → 정리. 삭제 30일 전 경고 푸시.
     그 사이 다시 구독하면 예약 자동 취소.
   - 사용자가 앱에서 직접 삭제 요청(deletionRequestedAt) → 유예 없이 즉시 정리.
   - 한 번도 구독한 적 없는 계정은 서버 데이터가 없으므로 정리 대상 제외(무해).
   - 정리 전, 공유 중인 상대에게 사전 알림 발송(상대는 로컬 사본 보유, 앱에서 재저장 가능).
   ⚠️ 배포 시 Cloud Scheduler API 자동 활성화(Blaze 필요). 첫 배포에서 승인할 것.
═══════════════════════════════════════════════ */
const _DAY = 24 * 60 * 60 * 1000;
const UNSUB_LIMIT_MS = 182 * _DAY;   // 구독 종료 후 데이터 보관 한도(약 6개월)
const WARN_LEAD_MS = 30 * _DAY;      // 삭제 며칠 전에 미리 경고
const CLEANUP_BUCKET = 'work-report-826ec.firebasestorage.app';

// FCM 푸시 헬퍼(무효 토큰 자동 청소) — 기존 함수들과 동일 패턴
async function _pushTo(db, uid, title, body, data) {
  try {
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) return;
    const tokens = userDoc.data().fcmTokens;
    if (!Array.isArray(tokens) || !tokens.length) return;
    const res = await admin.messaging().sendEachForMulticast({
      tokens, notification: { title, body }, data: data || {}, android: { priority: 'high' }
    });
    const bad = [];
    res.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error && r.error.code;
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') bad.push(tokens[i]);
      }
    });
    if (bad.length) await userDoc.ref.update({ fcmTokens: admin.firestore.FieldValue.arrayRemove(...bad) }).catch(() => {});
  } catch (e) { console.warn('[cleanup] push 실패', uid, e && e.message); }
}

// accepted 상태의 공유 상대 uid 목록
async function _acceptedPartners(db, uid) {
  const out = [];
  try {
    const snap = await db.collection('shares')
      .where('members', 'array-contains', uid)
      .where('status', '==', 'accepted').get();
    snap.forEach((d) => (d.data().members || []).forEach((m) => { if (m && m !== uid && out.indexOf(m) < 0) out.push(m); }));
  } catch (e) {}
  return out;
}

// 채팅 첨부파일 통째 삭제 (rooms/{roomId} 하위)
async function _deleteRoomFiles(roomId) {
  try { await admin.storage().bucket(CLEANUP_BUCKET).deleteFiles({ prefix: 'chat_files/' + roomId + '/' }); }
  catch (e) { console.warn('[cleanup] chat_files 삭제 실패', roomId, e && e.message); }
}

// 계정 완전 정리: 공유 상대 알림 → Storage → Firestore → 채팅/백업/학습/팀 → shares → Auth
async function _purgeAccount(db, uid) {
  // 1) 공유 상대에게 사전 알림(이관 안내)
  const partners = await _acceptedPartners(db, uid);
  for (const p of partners) {
    await _pushTo(db, p, '⚠️ 공유 사진 정리 예정',
      '공유 상대의 계정 정리로 관련 클라우드 사진이 곧 삭제됩니다. 필요하면 앱에서 내 작업으로 저장해두세요.',
      { type: 'ownerPurged', ownerUid: String(uid) });
  }
  // 2) Storage 삭제(원본+썸네일: sharedPhotos/{uid}/**)
  try { await admin.storage().bucket(CLEANUP_BUCKET).deleteFiles({ prefix: 'sharedPhotos/' + uid + '/' }); }
  catch (e) { console.warn('[cleanup] Storage 삭제 실패', uid, e && e.message); }
  // 3) 일정/사진 서브컬렉션 통째 삭제
  try { await db.recursiveDelete(db.collection('schedules').doc(uid)); }
  catch (e) { console.warn('[cleanup] schedules 삭제 실패', uid, e && e.message); }
  // 4) 이 계정이 낀 공유 문서 제거
  try {
    const sh = await db.collection('shares').where('members', 'array-contains', uid).get();
    for (const d of sh.docs) { await d.ref.delete().catch(() => {}); }
  } catch (e) {}
  // 4-1) 채팅방 정리
  //   방침(2026-08-23 사용자 결정): 1:1 방은 양쪽 모두가 당사자이므로 방을 통째로 지운다.
  //     상대의 대화 기록도 함께 사라지지만, 탈퇴자의 발언·첨부가 남지 않는 쪽을 택했다.
  //     chat_files 는 어차피 1주일 수명주기라 실질 손실은 작다.
  //   ⚠️ 팀 단체방(members 3명 이상 또는 team_ 접두사)은 남은 사람들의 대화다. 통째로 지우면 안 된다.
  //     → members 에서 나를 빼고 '내가 보낸 메시지'만 지운다. 남는 인원이 1명 이하면 방도 삭제.
  try {
    const rooms = await db.collection('rooms').where('members', 'array-contains', uid).get();
    for (const r of rooms.docs) {
      const rd = r.data() || {};
      const rest = (rd.members || []).filter((m) => m && m !== uid);
      const isGroup = (rd.members || []).length > 2 || String(r.id).indexOf('team_') === 0;
      if (!isGroup || rest.length < 2) {
        await _deleteRoomFiles(r.id);
        try { await db.recursiveDelete(r.ref); }
        catch (e) { console.warn('[cleanup] room 삭제 실패', r.id, e && e.message); }
        continue;
      }
      // 단체방 — 내 흔적만 제거
      try {
        const mine = await r.ref.collection('messages').where('senderUid', '==', uid).get();
        for (const m of mine.docs) {
          const sp = ((m.data() || {}).file || {}).storagePath;
          if (sp) { try { await admin.storage().bucket(CLEANUP_BUCKET).file(sp).delete(); } catch (e) {} }
          await m.ref.delete().catch(() => {});
        }
      } catch (e) { console.warn('[cleanup] 단체방 메시지 정리 실패', r.id, e && e.message); }
      const roomUpd = { members: rest };
      roomUpd['memberNames.' + uid] = admin.firestore.FieldValue.delete();
      roomUpd['lastRead.' + uid] = admin.firestore.FieldValue.delete();
      await r.ref.update(roomUpd).catch(() => {});
    }
  } catch (e) { console.warn('[cleanup] rooms 정리 실패', uid, e && e.message); }
  // 4-2) 구독자 서버 백업 (backups/{uid} + 하위 full 등)
  try { await db.recursiveDelete(db.collection('backups').doc(uid)); }
  catch (e) { console.warn('[cleanup] backups 삭제 실패', uid, e && e.message); }
  // 4-3) AI 학습기록
  try { await db.collection('ai_corrections').doc(uid).delete(); }
  catch (e) { console.warn('[cleanup] ai_corrections 삭제 실패', uid, e && e.message); }
  // 4-4) 팀에서 나를 제거. 마지막 1인이면 팀·팀채팅방까지 삭제, 팀장이었으면 다음 사람에게 넘김
  try {
    const teams = await db.collection('teams').where('members', 'array-contains', uid).get();
    for (const t of teams.docs) {
      const td = t.data() || {};
      const rest = (td.members || []).filter((m) => m && m !== uid);
      if (!rest.length) {
        await _deleteRoomFiles('team_' + t.id);
        try { await db.recursiveDelete(db.collection('rooms').doc('team_' + t.id)); } catch (e) {}
        try { await db.recursiveDelete(t.ref); } catch (e) {}
        continue;
      }
      const teamUpd = { members: rest };
      teamUpd['memberNames.' + uid] = admin.firestore.FieldValue.delete();
      if (td.owner === uid) teamUpd.owner = rest[0];   // 팀장 공백 방지
      await t.ref.update(teamUpd).catch(() => {});
    }
  } catch (e) { console.warn('[cleanup] teams 정리 실패', uid, e && e.message); }
  // 5) 사용자 문서 삭제
  try { await db.collection('users').doc(uid).delete(); } catch (e) {}
  // 6) Auth 계정 삭제
  try { await admin.auth().deleteUser(uid); } catch (e) { console.warn('[cleanup] auth 삭제 실패', uid, e && e.message); }
  console.log('[cleanup] 계정 정리 완료:', uid);
}

// 구독 활성 여부: subscriptionActive=true 이고 (만료시각이 없거나 아직 안 지남)
//  ⚠️ 구독 결제 구현 시 서버(영수증검증)가 users/{uid}에 아래 필드를 기록하도록 맞출 것:
//     subscriptionActive(bool), subscriptionExpiresAt(Timestamp, 선택)
function _isSubscribed(u, now) {
  if (!u || u.subscriptionActive !== true) return false;
  const exp = (u.subscriptionExpiresAt && u.subscriptionExpiresAt.toMillis) ? u.subscriptionExpiresAt.toMillis() : 0;
  return exp ? (now < exp) : true;
}

/* ═══════════════════════════════════════════════════════════
   sns_posts 만료 청소 — PC 링크 모드(글+사진 공개 페이지)
   ★ 2026-08-26 신규.
   · 앱이 sns_posts/{id} 를 만들 때 expiresAt = 생성 +24시간 을 박아 둔다.
   · 페이지(site/post.html)는 expiresAt 을 보고 스스로 만료를 표시하지만,
     실제 사진·문서 삭제는 여기서 한다(안 지우면 공개 사진이 계속 쌓인다).
   ⚠️ 사진은 링크를 아는 사람 누구나 읽을 수 있는 공개 파일이다 —
      이 함수가 죽어 있으면 그 상태가 영원히 남는다. 배포 확인 필수.
   ═══════════════════════════════════════════════════════════ */
exports.cleanupSnsPosts = onSchedule(
  { schedule: 'every 60 minutes', timeZone: 'Asia/Seoul', region: 'asia-northeast3', timeoutSeconds: 300, memory: '256MiB' },
  async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    // 한 번에 너무 많이 잡으면 타임아웃 → 500건씩, 다음 시간에 이어서 지운다
    const snap = await db.collection('sns_posts').where('expiresAt', '<', now).limit(500).get();
    if (snap.empty) { console.log('[cleanupSnsPosts] 만료 없음'); return; }

    let files = 0, docs = 0;
    for (const doc of snap.docs) {
      const d = doc.data() || {};
      // paths 가 있으면 그것만 정확히 지운다. 없으면(구버전) 폴더 통째로.
      const paths = Array.isArray(d.paths) ? d.paths : [];
      if (paths.length) {
        for (const p of paths) {
          try { await admin.storage().bucket(CLEANUP_BUCKET).file(p).delete(); files++; }
          catch (e) { /* 이미 없으면 무시 */ }
        }
      } else if (d.uid) {
        try { await admin.storage().bucket(CLEANUP_BUCKET).deleteFiles({ prefix: 'snsPosts/' + d.uid + '/' + doc.id + '/' }); }
        catch (e) {}
      }
      try { await doc.ref.delete(); docs++; } catch (e) {}
    }
    console.log('[cleanupSnsPosts] 문서 ' + docs + '건, 사진 ' + files + '장 삭제');
  }
);

exports.cleanupAccounts = onSchedule(
  { schedule: 'every day 04:00', timeZone: 'Asia/Seoul', region: 'asia-northeast3', timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const db = admin.firestore();
    const now = Date.now();
    const usersSnap = await db.collection('users').get();
    let warned = 0, purged = 0, cleared = 0;

    for (const doc of usersSnap.docs) {
      const u = doc.data() || {};
      const uid = doc.id;
      const explicit = !!u.deletionRequestedAt;
      const pendingMs = (u.pendingDeletionAt && u.pendingDeletionAt.toMillis) ? u.pendingDeletionAt.toMillis() : 0;

      // (1) 직접 삭제 요청 → 유예 없이 즉시 정리 (구독 여부와 무관, 본인 의사)
      if (explicit) { await _purgeAccount(db, uid); purged++; continue; }

      // (2) 구독 활성 → 데이터 유지. 예약/경고가 남아 있으면 취소(재구독 반영).
      if (_isSubscribed(u, now)) {
        if (pendingMs || u.deletionWarnedAt) {
          await doc.ref.update({
            pendingDeletionAt: admin.firestore.FieldValue.delete(),
            deletionWarnedAt: admin.firestore.FieldValue.delete()
          }).catch(() => {});
          cleared++;
        }
        continue;
      }

      // (3) 미구독 상태 — '구독이 끝난 시각'부터 6개월을 센다.
      //     한 번도 구독한 적 없으면(subEndMs=0) 서버 데이터가 없으므로 대상 아님.
      const subEndMs = (u.subscriptionEndedAt && u.subscriptionEndedAt.toMillis) ? u.subscriptionEndedAt.toMillis()
        : (u.subscriptionExpiresAt && u.subscriptionExpiresAt.toMillis) ? u.subscriptionExpiresAt.toMillis() : 0;
      if (!subEndMs) continue;
      const deleteAtMs = subEndMs + UNSUB_LIMIT_MS;

      // (3a) 삭제 시점 도래 → 정리
      if (now >= deleteAtMs) { await _purgeAccount(db, uid); purged++; continue; }

      // (3b) 삭제 30일 전 → 경고 1회 + 예약시각 기록
      if (now >= deleteAtMs - WARN_LEAD_MS && !u.deletionWarnedAt) {
        await doc.ref.set({
          pendingDeletionAt: admin.firestore.Timestamp.fromMillis(deleteAtMs),
          deletionWarnedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(() => {});
        await _pushTo(db, uid, '⚠️ 데이터 삭제 예정 안내',
          '구독 해지 후 6개월이 다가와, 30일 후 클라우드에 저장된 사진·일정이 삭제될 예정입니다. 다시 구독하면 유지됩니다.',
          { type: 'deletionWarning' });
        warned++; continue;
      }
    }
    console.log(`[cleanupAccounts] 경고 ${warned} / 정리 ${purged} / 예정취소 ${cleared}`);
  }
);


/* ═══════════════════════════════════════════════
   onAccountDeletionRequested — 앱에서 '계정·데이터 삭제'를 누르면 즉시 정리 (2026-08-23)
   - 예약 실행(cleanupAccounts)은 하루 1회(새벽 4시)라 최대 28시간이 걸렸다.
     사용자는 "삭제했는데 그대로"로 느끼고, 스토어 심사자도 확인이 어렵다.
   - deletionRequestedAt 이 '새로 생겼을 때만' 1회 실행. 예약 실행은 누락분 보완용으로 그대로 둔다.
   ⚠️ 재진입 방지: _purgeAccount 가 users/{uid} 를 지우면 이 트리거가 다시 불린다.
      after 가 없으면(문서 삭제) 즉시 반환한다. before 에 이미 값이 있으면 중복이므로 무시.
═══════════════════════════════════════════════ */
exports.onAccountDeletionRequested = onDocumentWritten(
  /* ★ 2026-08-26 자원점검: 심박(50초)이 users/{uid} 를 쓰므로 이 트리거는
     사용자 1명당 시간당 72회 기동된다(거의 전부 조기 반환).
     512MiB → 256MiB 로 낮춰 기동당 단가를 절반으로. 실제 삭제 경로는
     recursiveDelete + 작은 문서 수백건이라 256MiB 로 충분하고,
     모자라도 실패하면 매일 04:00 cleanupAccounts(512MiB)가 재시도한다.
     ★ 근본 해법은 심박을 presence/{uid} 로 분리하는 것(다음 빌드). */
  { document: 'users/{uid}', region: 'asia-northeast3', timeoutSeconds: 540, memory: '256MiB' },
  async (event) => {
    const afterSnap = event.data && event.data.after;
    if (!afterSnap || !afterSnap.exists) return;             // 문서 삭제 → 재진입 차단
    const after = afterSnap.data() || {};
    if (!after.deletionRequestedAt) return;                  // 삭제 요청이 아님
    const beforeSnap = event.data.before;
    const before = (beforeSnap && beforeSnap.exists) ? (beforeSnap.data() || {}) : {};
    if (before.deletionRequestedAt) return;                  // 이미 접수된 요청 → 중복 실행 방지
    const uid = event.params.uid;
    console.log('[cleanup] 즉시 삭제 요청 수신:', uid);
    try { await _purgeAccount(admin.firestore(), uid); }
    catch (e) { console.error('[cleanup] 즉시 삭제 실패(예약 실행이 재시도함):', uid, e && e.message); }
  }
);


/* ═══════════════════════════════════════════════
   adminStats — 관리자 전용 통계 (사용자수·플랜별 구독자·Claude 사용금액·Storage 용량/비용)
   - 호출: 앱에서 POST + Authorization: Bearer <Firebase ID 토큰>
   - 관리자(users/{uid}.admin === true)만 허용. 비밀 키는 이 서버에만.
   - Claude 금액: Cost API 조회(기존 ANTHROPIC_API_KEY 사용). 개인 조직은 조직급 권한이 없어 콘솔(분석→비용) 안내로 대체됨
   - Storage 용량: Cloud Monitoring(총 바이트) → 단가 곱해 월 비용 추정
   - 각 파트는 실패해도 available:false로 우아하게 반환(다른 통계는 계속 보임)
═══════════════════════════════════════════════ */
const { GoogleAuth } = require('google-auth-library');
const ANTHROPIC_ADMIN_KEY = defineSecret('ANTHROPIC_ADMIN_KEY');
const STATS_BUCKET_ID = 'work-report-826ec.firebasestorage.app';
const STATS_GCP_PROJECT = 'work-report-826ec';
const STORAGE_PRICE_PER_GB = 0.026;   // asia-northeast3 Standard 저장 월 단가(USD) 근사
// ── Play 설치 통계(설치한 사용자 수) ──
// Play Console → 보고서 다운로드 → 통계 → 'Cloud Storage URI 복사'로 버킷 이름 확인 (pubsite_prod_rev_로 시작)
// 이 함수의 서비스계정을 Play Console 사용자·권한에 '뷰어(전체)'로 초대해야 접근 가능
const STATS_PLAY_BUCKET = 'pubsite_prod_7885196709496840141';    // gs:// 제외한 버킷 이름
const STATS_PLAY_PACKAGE = 'com.baesungchul.workreport';   // 앱 패키지명/applicationId

async function _verifyAdmin(req) {
  const authz = req.headers.authorization || req.headers.Authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(authz);
  if (!m) return { ok: false, code: 401, msg: '로그인이 필요합니다' };
  let decoded;
  try { decoded = await admin.auth().verifyIdToken(m[1].trim()); }
  catch (e) { return { ok: false, code: 401, msg: '유효하지 않은 토큰' }; }
  const doc = await admin.firestore().collection('users').doc(decoded.uid).get();
  if (!doc.exists || doc.data().admin !== true) return { ok: false, code: 403, msg: '관리자 전용입니다' };
  return { ok: true, uid: decoded.uid };
}

async function _statsFirestore() {
  const db = admin.firestore();
  const snap = await db.collection('users').get();
  const ym = new Date().toISOString().slice(0, 7);
  const planCounts = { free: 0, lite: 0, basic: 0, pro: 0, master: 0, other: 0 };
  const paidCounts = { free: 0, lite: 0, basic: 0, pro: 0, master: 0, other: 0 };   // 결제 구독만
  let total = 0, activeSub = 0, admins = 0, aiSched = 0, aiBlog = 0, aiCost = 0, aiTokIn = 0, aiTokOut = 0;
  let paidActiveSub = 0, manualGranted = 0;
  const PLAN_PRICE_KRW = { free: 0, lite: 4900, basic: 9900, pro: 19900, master: 49900 };
  snap.forEach((d) => {
    const u = d.data() || {};
    total++;
    // ★ 2026-08-23 결제 구독자가 통계에서 빠지던 문제.
    //   users/{uid}.plan 은 '관리자가 수동 지정한 값'만 들어간다.
    //   RevenueCat 결제로 받은 플랜은 billingPlan 에 들어오므로 그쪽이 우선이다.
    //   (앱의 Subs.effectivePlan() 우선순위와 같게 맞춘 것)
    const plan = u.billingPlan || u.plan || 'free';
    if (planCounts[plan] === undefined) planCounts.other++; else planCounts[plan]++;
    if (u.admin === true) admins++;
    if (u.subscriptionActive === true || (plan && plan !== 'free')) activeSub++;
    /* ★ 2026-08-23 '내가 직접 부여한 플랜은 빼고 보기' 용 — 결제(billingPlan)만 센 값도 함께 만든다.
         앱에서 토글로 갈아 끼우므로 서버 왕복 없이 바뀐다. */
    const bp = (u.billingPlan && PLAN_PRICE_KRW[u.billingPlan] !== undefined) ? u.billingPlan : '';
    if (bp && bp !== 'free') { paidCounts[bp]++; paidActiveSub++; } else { paidCounts.free++; }
    if (!bp && u.plan && u.plan !== 'free') manualGranted++;
    const used = (u.subs && u.subs.used) || {};
    if (!u.subs || !u.subs.ym || u.subs.ym === ym) {
      aiSched += Number(used.sched || 0);
      aiBlog += Number(used.blog || 0);
      aiCost += Number((u.subs && u.subs.aiCost) || 0);   // 전체 사용자 토큰 비용 합산(구독자 사용량)
      const tk = (u.subs && u.subs.aiTok) || {};
      aiTokIn += Number(tk.in || 0); aiTokOut += Number(tk.out || 0);
    }
  });
  // 월 예상 수익(MRR) — 지금 이 순간의 구독 구성으로 계산한 런레이트.
  //   Play 리포트의 '확정 수익'과는 다른 숫자다(수수료·환불·프로모션 반영 전, 세금 별도).
  //   ⚠️ subscription.js 의 PLANS 가격과 반드시 같이 고칠 것.
  let mrrKrw = 0, paidMrrKrw = 0;
  Object.keys(PLAN_PRICE_KRW).forEach((k) => {
    mrrKrw     += (planCounts[k] || 0) * PLAN_PRICE_KRW[k];
    paidMrrKrw += (paidCounts[k] || 0) * PLAN_PRICE_KRW[k];
  });
  return { total, planCounts, activeSub, admins, mrrKrw, planPrice: PLAN_PRICE_KRW,
           paid: { planCounts: paidCounts, activeSub: paidActiveSub, mrrKrw: paidMrrKrw, manualGranted },
           ai: { sched: aiSched, blog: aiBlog, ym,
                 costUsd: Math.round(aiCost * 10000) / 10000, tokIn: aiTokIn, tokOut: aiTokOut } };
}

async function _statsClaudeCost(adminKey) {
  if (!adminKey || adminKey.length < 10) return { available: false, reason: '콘솔 분석 → 비용에서 확인' };
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  let total = 0, currency = 'USD', page = null, guard = 0;
  do {
    const url = new URL('https://api.anthropic.com/v1/organizations/cost_report');
    url.searchParams.set('starting_at', start);
    url.searchParams.set('bucket_width', '1d');
    url.searchParams.set('limit', '31');
    if (page) url.searchParams.set('page', page);
    const r = await fetch(url.toString(), { headers: { 'x-api-key': adminKey, 'anthropic-version': '2023-06-01' } });
    if (!r.ok) { return { available: false, reason: '앱에서 직접 조회 불가(개인 조직) · 콘솔 분석 → 비용 참고' }; }
    const j = await r.json();
    (j.data || []).forEach((bucket) => {
      (bucket.results || []).forEach((res) => {
        const raw = (res.amount != null) ? res.amount : (res.cost != null ? res.cost : (res.value != null ? res.value : 0));
        const amt = parseFloat(raw);
        if (!isNaN(amt)) total += amt;
        if (res.currency) currency = res.currency;
      });
    });
    page = j.has_more ? j.next_page : null;
  } while (page && ++guard < 12);
  return { available: true, monthToDate: Math.round(total * 10000) / 10000, currency, since: start };
}

async function _statsStorage() {
  try {
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/monitoring.read'] });
    const client = await auth.getClient();
    const tk = await client.getAccessToken();
    const token = tk && (tk.token || tk);
    const end = new Date();
    const startT = new Date(end.getTime() - 3 * 24 * 3600 * 1000);
    const filter = 'metric.type="storage.googleapis.com/storage/total_bytes" AND resource.label.bucket_name="' + STATS_BUCKET_ID + '"';
    const url = 'https://monitoring.googleapis.com/v3/projects/' + STATS_GCP_PROJECT + '/timeSeries'
      + '?filter=' + encodeURIComponent(filter)
      + '&interval.startTime=' + encodeURIComponent(startT.toISOString())
      + '&interval.endTime=' + encodeURIComponent(end.toISOString())
      + '&aggregation.alignmentPeriod=86400s&aggregation.perSeriesAligner=ALIGN_MEAN';
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) { const t = await r.text(); return { available: false, reason: 'Monitoring ' + r.status + ': ' + t.slice(0, 160) }; }
    const j = await r.json();
    let bytes = 0, series = 0;
    (j.timeSeries || []).forEach((ts) => {
      const pts = ts.points || [];
      if (pts.length) {
        const v = pts[0].value || {};
        const b = Number(v.doubleValue != null ? v.doubleValue : (v.int64Value != null ? v.int64Value : 0));
        bytes += b; series++;   // 스토리지 클래스별 시계열 합산
      }
    });
    const gb = bytes / (1024 * 1024 * 1024);
    return {
      available: true, bytes, gb: Math.round(gb * 1000) / 1000,
      estMonthlyCostUsd: Math.round(gb * STORAGE_PRICE_PER_GB * 100) / 100,
      rate: STORAGE_PRICE_PER_GB, note: series ? '' : '해당 버킷 지표 없음(용량 0이거나 지표 미수집)'
    };
  } catch (e) {
    return { available: false, reason: String((e && e.message) || e) };
  }
}

// ── Play 설치 통계 CSV(GCS, UTF-16) 파싱 ──
async function _fetchPlayCsv(token, bucket, object) {
  const url = 'https://storage.googleapis.com/storage/v1/b/' + encodeURIComponent(bucket)
    + '/o/' + encodeURIComponent(object) + '?alt=media';
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 404) return null;
  if (!r.ok) { const t = await r.text(); throw new Error('GCS ' + r.status + ': ' + t.slice(0, 140)); }
  const ab = await r.arrayBuffer();
  return Buffer.from(ab).toString('utf16le').replace(/^\uFEFF/, '');  // Play CSV는 UTF-16LE(BOM)
}
// CSV 한 줄 분해 (따옴표 안의 쉼표 보호)
function _splitCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}
// 헤더 + 전체 행을 그대로 돌려준다 (일별 합계를 내려면 마지막 행만으론 부족하다)
function _parsePlayCsv(csv) {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return null;
  const head = _splitCsvLine(lines[0]);
  const idx = {}; head.forEach((h, i) => { idx[h] = i; });
  const rows = [];
  for (let i = 1; i < lines.length; i++) rows.push(_splitCsvLine(lines[i]));
  return { head, idx, rows };
}
// 컬럼 이름이 리포트 버전마다 조금씩 달라서, 후보를 순서대로 찾는다
function _colIndex(idx, names) {
  for (const n of names) if (idx[n] != null) return idx[n];
  return null;
}
function _toInt(v) {
  const n = parseInt(String(v == null ? '' : v).replace(/[^0-9-]/g, ''), 10);
  return isNaN(n) ? null : n;
}
async function _statsPlayInstalls() {
  if (!STATS_PLAY_BUCKET || !STATS_PLAY_PACKAGE) {
    return { available: false, reason: 'Play 버킷/패키지 미설정 (functions/index.js STATS_PLAY_BUCKET·STATS_PLAY_PACKAGE 입력 후 재배포)' };
  }
  try {
    const token = await _gcsToken();
    const ym = (d) => d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0');
    const now = new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

    // 최근 28일 창이 월을 걸치므로 이번 달·지난 달 파일을 둘 다 읽어 이어 붙인다
    let head = null, idx = null;
    const all = [];
    const usedFiles = [];
    for (const m of [ym(prev), ym(now)]) {
      const obj = 'stats/installs/installs_' + STATS_PLAY_PACKAGE + '_' + m + '_overview.csv';
      const csv = await _fetchPlayCsv(token, STATS_PLAY_BUCKET, obj);
      if (!csv) continue;
      const p = _parsePlayCsv(csv);
      if (!p) continue;
      head = p.head; idx = p.idx;
      usedFiles.push(m);
      for (const r of p.rows) all.push(r);
    }
    if (!all.length) {
      return { available: false, reason: '설치 통계 CSV 없음 (월초 3~7일 지연 또는 서비스계정 권한·버킷 확인)' };
    }

    const iDate = _colIndex(idx, ['Date']);
    const iDaily = _colIndex(idx, ['Daily Device Installs', 'Daily device installs', 'Daily Device Install']);
    const iActive = _colIndex(idx, ['Active Device Installs', 'Current Device Installs']);
    const iTotalUser = _colIndex(idx, ['Total User Installs']);

    // 날짜 오름차순 정렬 후 뒤에서 28일 / 그 앞 28일
    if (iDate != null) all.sort((a, b) => String(a[iDate]).localeCompare(String(b[iDate])));
    const sumRange = (from, to) => {
      if (iDaily == null) return null;
      let acc = 0, seen = 0;
      for (let i = Math.max(0, from); i < Math.min(all.length, to); i++) {
        const v = _toInt(all[i][iDaily]);
        if (v != null) { acc += v; seen++; }
      }
      return seen ? acc : null;
    };
    const n = all.length;
    const acq28 = sumRange(n - 28, n);
    const acqPrev28 = (n >= 56) ? sumRange(n - 56, n - 28) : null;
    const last = all[n - 1] || [];

    /* ★ 2026-08-23 진단용 — 앱에 표시된 값(20)과 Play 대시보드('기기 획득 수' 165)가 8배 차이났다.
         'Daily Device Installs' 가 대시보드의 '기기 획득 수'와 다른 지표일 가능성이 크다.
         어느 컬럼이 대시보드와 맞는지 눈으로 대조할 수 있게, 숫자형 컬럼 전부의 28일 합을 함께 보낸다.
         맞는 컬럼을 확정하면 _colIndex 후보만 고치고 이 블록은 지우면 된다. */
    const sums28 = {};
    if (head) {
      head.forEach(function (h, ci) {
        if (ci === iDate) return;
        let acc = 0, seen = 0;
        for (let i = Math.max(0, n - 28); i < n; i++) {
          const v = _toInt(all[i][ci]);
          if (v != null) { acc += v; seen++; }
        }
        if (seen) sums28[h] = acc;
      });
    }
    // 어떤 리포트가 실제로 있는지도 같이 본다(store_performance 등)
    let reports = [];
    try {
      const names = await _gcsList(token, STATS_PLAY_BUCKET, 'stats/');
      const seen = {};
      names.forEach(function (nm) {
        const parts = String(nm).split('/');
        const k = parts.slice(0, 2).join('/');
        if (!seen[k]) { seen[k] = 1; reports.push(k); }
      });
      reports = reports.slice(0, 12);
    } catch (e) { reports = ['(목록 조회 실패: ' + String((e && e.message) || e).slice(0, 60) + ')']; }

    // ★ 2026-08-23 획득 리포트가 있으면 그 값이 대시보드 '기기 획득 수'와 맞는다
    const perf = await _statsPlayStorePerf(token);

    return {
      available: true,
      perf: perf,
      files: usedFiles,
      days: n,
      lastDate: (iDate != null ? String(last[iDate] || '') : ''),
      acq28: acq28,                                   // 폴백 (installs 의 Daily Device Installs)
      acqPrev28: acqPrev28,                           // 직전 28일 (증감 비교용)
      activeDeviceInstalls: (iActive != null ? _toInt(last[iActive]) : null),
      totalUserInstalls: (iTotalUser != null ? _toInt(last[iTotalUser]) : null),
      headers: head || undefined,
      sums28: sums28,     // ← 진단
      reports: reports    // ← 진단
    };
  } catch (e) {
    return { available: false, reason: String((e && e.message) || e) };
  }
}

/* ── Play '기기 획득 수' = 획득 리포트(store_performance) ────────────
   ⚠️ 2026-08-23 진단으로 확인: installs 리포트에는 대시보드의 '기기 획득 수'가 없다.
      실측 28일 합 — Daily Device Installs 20 / Daily User Installs 20 / Install events 31
      / Update events 79 … 어디에도 165 가 없었다.
      대시보드 '사용자 늘리기' 카드는 **획득 리포트(store_performance)** 에서 온다.
   · 파일명이 차원별로 갈린다(country / traffic_source / …). 이름을 추측하지 말고
     GCS 목록으로 실제 파일을 찾는다.
   · 차원별로 같은 날짜가 여러 행이므로 **날짜별로 먼저 합치고** 28일 창을 만든다.
─────────────────────────────────────────────────────────────── */
async function _statsPlayStorePerf(token) {
  try {
    const names = await _gcsList(token, STATS_PLAY_BUCKET, 'stats/store_performance/');
    const csvs = names.filter((n) => /\.csv$/i.test(n));
    if (!csvs.length) return { available: false, reason: '획득 리포트 없음' };

    const ym = (d) => d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0');
    const now = new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const want = [ym(prev), ym(now)];

    // 월별로 파일 하나씩만 읽는다(차원이 달라도 날짜별 합계는 같다)
    const picked = [];
    want.forEach((m) => {
      const hit = csvs.filter((n) => n.indexOf('_' + m + '_') >= 0)[0];
      if (hit) picked.push(hit);
    });
    if (!picked.length) return { available: false, reason: '이번달·지난달 획득 리포트 없음', found: csvs.slice(0, 6) };

    const byDate = {};      // 'YYYY-MM-DD' -> { 컬럼: 합 }
    let head = null;
    for (const obj of picked) {
      const csv = await _fetchPlayCsv(token, STATS_PLAY_BUCKET, obj);
      if (!csv) continue;
      const p = _parsePlayCsv(csv);
      if (!p) continue;
      head = p.head;
      const iDate = _colIndex(p.idx, ['Date']);
      if (iDate == null) continue;
      p.rows.forEach((r) => {
        const d = String(r[iDate] || '');
        if (!d) return;
        if (!byDate[d]) byDate[d] = {};
        p.head.forEach((h, ci) => {
          if (ci === iDate) return;
          const v = _toInt(r[ci]);
          if (v != null) byDate[d][h] = (byDate[d][h] || 0) + v;
        });
      });
    }
    const dates = Object.keys(byDate).sort();
    if (!dates.length) return { available: false, reason: '획득 리포트에 날짜 행이 없음', files: picked };

    const win = dates.slice(-28);
    const prevWin = dates.length >= 56 ? dates.slice(-56, -28) : [];
    const sumOver = (ds, col) => {
      let acc = 0, seen = 0;
      ds.forEach((d) => { const v = byDate[d][col]; if (v != null) { acc += v; seen++; } });
      return seen ? acc : null;
    };
    const sums28 = {};
    (head || []).forEach((h) => { const v = sumOver(win, h); if (v != null) sums28[h] = v; });

    const cands = ['Store Listing Acquisitions', 'Store listing acquisitions',
                   'Store Listing Acquirers', 'Store Listing Unique Acquirers'];
    let col = null;
    for (const c of cands) if (sums28[c] != null) { col = c; break; }

    return {
      available: true,
      files: picked, days: dates.length, lastDate: dates[dates.length - 1] || '',
      column: col,
      acq28: col ? sums28[col] : null,
      acqPrev28: (col && prevWin.length) ? sumOver(prevWin, col) : null,
      sums28: sums28,
      headers: head || undefined
    };
  } catch (e) {
    return { available: false, reason: String((e && e.message) || e) };
  }
}

/* ── Play 확정 수익 (earnings 월간 리포트) ─────────────────────────
   · earnings/earnings_YYYYMM*.zip — 다음 달 5일경 확정본이 올라온다.
   · 그래서 '최근 28일 수익'은 만들 수 없다. 지난 달(없으면 전전달) 확정 수익만 낸다.
   · 실시간 감각은 위의 MRR(users.mrrKrw)이 담당한다. 둘은 다른 숫자다.
   ⚠️ 압축 해제는 외부 의존성 없이 zlib 만으로 처리한다(npm install 불필요).
      어떤 이유로든 실패하면 available:false 로 조용히 빠진다 — 다른 통계는 그대로 나온다.
─────────────────────────────────────────────────────────────── */
async function _gcsToken() {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/devstorage.read_only'] });
  const client = await auth.getClient();
  const tk = await client.getAccessToken();
  return tk && (tk.token || tk);
}
async function _gcsList(token, bucket, prefix) {
  const url = 'https://storage.googleapis.com/storage/v1/b/' + encodeURIComponent(bucket)
    + '/o?prefix=' + encodeURIComponent(prefix) + '&maxResults=200&fields=items(name,size)';
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 403) {
    // 재무 리포트는 Play Console 에서 '재무 데이터 보기' 권한이 따로 필요하다.
    // 설치 통계용 '뷰어(전체)'만으로는 earnings/ 를 못 읽는다.
    throw new Error("권한 없음 — Play Console ▸ 사용자 및 권한에서 이 함수의 서비스계정에 '재무 데이터 보기'를 추가하세요");
  }
  if (!r.ok) throw new Error('GCS list ' + r.status);
  const j = await r.json();
  return (j.items || []).map((o) => o.name);
}
async function _gcsGetBuffer(token, bucket, object) {
  const url = 'https://storage.googleapis.com/storage/v1/b/' + encodeURIComponent(bucket)
    + '/o/' + encodeURIComponent(object) + '?alt=media';
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('GCS ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}
// 최소 ZIP 리더: 중앙 디렉토리를 읽어 .csv 항목만 풀어낸다 (store/deflate 만 지원)
function _unzipCsvTexts(buf) {
  const zlib = require('zlib');
  const out = [];
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP EOCD 없음');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + cmtLen;
    if (!/\.csv$/i.test(name)) continue;
    if (buf.readUInt32LE(lho) !== 0x04034b50) continue;
    const lNameLen = buf.readUInt16LE(lho + 26);
    const lExtraLen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(start, start + compSize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else continue;
    // BOM 으로 인코딩 판별 (통계 CSV는 UTF-16LE, 재무 CSV는 대개 UTF-8)
    if (data[0] === 0xFF && data[1] === 0xFE) out.push(data.toString('utf16le').replace(/^\uFEFF/, ''));
    else out.push(data.toString('utf8').replace(/^\uFEFF/, ''));
  }
  if (!out.length) throw new Error('ZIP 안에 CSV 없음');
  return out;
}
async function _statsPlayEarnings() {
  if (!STATS_PLAY_BUCKET) return { available: false, reason: 'Play 버킷 미설정' };
  try {
    const token = await _gcsToken();
    const names = await _gcsList(token, STATS_PLAY_BUCKET, 'earnings/');
    const zips = names.filter((n) => /\.zip$/i.test(n)).sort();   // 이름에 YYYYMM 이 들어가 사전순 = 시간순
    if (!zips.length) return { available: false, reason: '확정 수익 리포트 없음 (다음 달 5일경 생성)' };
    const obj = zips[zips.length - 1];
    const m = /(\d{6})/.exec(obj);
    const buf = await _gcsGetBuffer(token, STATS_PLAY_BUCKET, obj);
    if (!buf) return { available: false, reason: '리포트 내려받기 실패' };
    const texts = _unzipCsvTexts(buf);

    let sum = 0, cur = '', rows = 0;
    for (const csv of texts) {
      const p = _parsePlayCsv(csv);
      if (!p) continue;
      const iAmt = _colIndex(p.idx, ['Amount (Merchant Currency)', 'Amount (Merchant currency)']);
      const iCur = _colIndex(p.idx, ['Merchant Currency', 'Merchant currency']);
      if (iAmt == null) continue;
      for (const r of p.rows) {
        const v = parseFloat(String(r[iAmt] == null ? '' : r[iAmt]).replace(/[^0-9.-]/g, ''));
        if (!isNaN(v)) { sum += v; rows++; }
        if (!cur && iCur != null && r[iCur]) cur = String(r[iCur]);
      }
    }
    if (!rows) return { available: false, reason: '금액 컬럼을 찾지 못했습니다', object: obj };
    return { available: true, ym: m ? m[1] : '', object: obj,
             amount: Math.round(sum), currency: cur || 'KRW', rows: rows };
  } catch (e) {
    return { available: false, reason: String((e && e.message) || e) };
  }
}

// Firebase Auth 전체 계정 수(가입한 사용자 = 로그인/회원가입한 사람). 설치만 하고 로그인 안 한 사용자는 제외됨.
async function _authUserCount() {
  let count = 0, pageToken = undefined, guard = 0;
  do {
    const r = await admin.auth().listUsers(1000, pageToken);
    count += (r.users || []).length;
    pageToken = r.pageToken;
  } while (pageToken && ++guard < 50);
  return count;
}

exports.adminStats = onRequest(
  { secrets: [ANTHROPIC_ADMIN_KEY, ANTHROPIC_API_KEY], cors: true, region: 'asia-northeast3', memory: '512MiB', timeoutSeconds: 120 },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'POST 요청만 허용됩니다' }); return; }
    const gate = await _verifyAdmin(req);
    if (!gate.ok) { res.status(gate.code).json({ error: gate.msg }); return; }
    try {
      let adminKey = '';
      try { adminKey = ANTHROPIC_ADMIN_KEY.value() || ''; } catch (e) {}
      if (!adminKey) { try { adminKey = ANTHROPIC_API_KEY.value() || ''; } catch (e) {} }
      const [users, claude, storage, authTotal, play, earnings] = await Promise.all([
        _statsFirestore(),
        _statsClaudeCost(adminKey),
        _statsStorage(),
        _authUserCount().catch(() => null),
        _statsPlayInstalls(),
        _statsPlayEarnings()
      ]);
      if (authTotal != null) users.authTotal = authTotal;   // 가입 계정 수(권위)
      res.json({ ok: true, generatedAt: new Date().toISOString(), users, claude, storage, play, earnings });
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  }
);
