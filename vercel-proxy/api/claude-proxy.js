/* ═══════════════════════════════════════════════
   claude-proxy — Vercel Serverless Function
   - Anthropic API 키는 Vercel 환경변수(ANTHROPIC_API_KEY)에만 저장됨
   - 앱(ai.js)은 이 주소만 호출, 키는 클라이언트에 절대 노출되지 않음

   ★ 2026-08-30 인증 추가 (그 전까지는 누구나 호출 가능했다)
     저장소가 공개라 이 주소가 그대로 보인다 → 로그인한 우리 앱 사용자만 통과시킨다.
     검증 방식: Firebase ID 토큰을 구글 identitytoolkit 에 물어본다.
       · JWT 서명을 직접 검증하지 않는 이유 = aud/iss 검사를 빠뜨리면
         '다른 프로젝트 토큰도 통과'하는 조용한 구멍이 생긴다. 구글에 묻는 쪽은 그런 실수가 불가능하다.
       · 대가는 왕복 1회(수십 ms). AI 응답이 수 초라 체감 없음. 5분 캐시로 대부분 생략된다.
     ⚠️ 앱은 2026-08-24 부터 비로그인 AI 사용이 0회다(subscription.js INSTALL_TASTER)
        → 이 인증으로 막히는 정상 사용자는 없다. (확인함)
═══════════════════════════════════════════════ */
const MAX_TOKENS_CAP = 4000; // 남용 방지: 요청값이 더 커도 이 값으로 자름

// 공개 식별자 (firebase_config.js 와 같은 값). 비밀이 아니므로 하드코딩한다.
// 환경변수로 빼지 않는 이유: 설정을 깜빡하면 앱 전체 AI 가 죽는다.
const FIREBASE_API_KEY = 'AIzaSyB0qA_QXtQOYPpnJNHX3SMk9hIpNA40NMk';
const LOOKUP_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY;

// 검증 결과 캐시 (토큰 문자열 → uid). ID 토큰 자체가 1시간짜리라 5분 캐시는 안전하다.
const CACHE = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX = 500;

async function verifyIdToken(token) {
  if (!token) return { ok: false, status: 401, error: '로그인이 필요합니다' };

  const hit = CACHE.get(token);
  if (hit && hit.until > Date.now()) return { ok: true, uid: hit.uid };

  let r;
  try {
    r = await fetch(LOOKUP_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: token })
    });
  } catch (e) {
    // 구글에 못 닿은 것 — 토큰이 틀린 게 아니다. 상태코드를 구분해 둔다.
    return { ok: false, status: 503, error: '인증 서버에 연결할 수 없습니다' };
  }
  if (!r.ok) return { ok: false, status: 401, error: '로그인 정보가 유효하지 않습니다' };

  let d = null;
  try { d = await r.json(); } catch (e) {}
  const uid = d && d.users && d.users[0] && d.users[0].localId;
  if (!uid) return { ok: false, status: 401, error: '로그인 정보가 유효하지 않습니다' };

  if (CACHE.size >= CACHE_MAX) CACHE.clear();
  CACHE.set(token, { uid: uid, until: Date.now() + CACHE_TTL });
  return { ok: true, uid: uid };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  // ⚠️ authorization 을 빼면 브라우저 프리플라이트가 막혀 요청이 아예 안 간다
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 허용됩니다' });
    return;
  }

  const auth = String(req.headers['authorization'] || '');
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const v = await verifyIdToken(token);
  if (!v.ok) {
    res.status(v.status).json({ error: v.error });
    return;
  }

  const b = req.body || {};
  if (!b.messages) {
    res.status(400).json({ error: 'messages가 필요합니다' });
    return;
  }

  const body = {
    model: b.model || 'claude-haiku-4-5-20251001',
    max_tokens: Math.min(Number(b.max_tokens) || 1024, MAX_TOKENS_CAP),
    messages: b.messages
  };
  if (b.system) body.system = b.system;

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(502).json({ error: '업스트림 호출 실패: ' + (e && e.message) });
  }
};
