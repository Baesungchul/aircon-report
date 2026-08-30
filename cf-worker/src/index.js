/* ═══════════════════════════════════════════════
   claude-proxy — Cloudflare Worker
   - Anthropic API 키는 이 Worker의 비밀 환경변수(ANTHROPIC_API_KEY)에만 저장됨
   - 앱(ai.js)은 이 Worker 주소만 호출, 키는 클라이언트에 절대 노출되지 않음

   ★ 2026-08-30 인증 추가 — vercel-proxy/api/claude-proxy.js 와 동작을 맞춘 것.
     ⚠️ 둘 중 하나만 고치면 어느 쪽이 도는지에 따라 결과가 달라진다. 항상 같이 고칠 것.
     (현재 앱이 실제로 부르는 것은 vercel 쪽 — ai.js PROXY_URL 참고)
═══════════════════════════════════════════════ */
const MAX_TOKENS_CAP = 4000; // 남용 방지: 요청값이 더 커도 이 값으로 자름

// 공개 식별자 (firebase_config.js 와 같은 값)
const FIREBASE_API_KEY = 'AIzaSyB0qA_QXtQOYPpnJNHX3SMk9hIpNA40NMk';
const LOOKUP_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY;

const CACHE = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX = 500;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  // ⚠️ authorization 을 빼면 프리플라이트가 막혀 요청이 아예 안 간다
  'Access-Control-Allow-Headers': 'content-type, authorization'
};

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'content-type': 'application/json' }, CORS_HEADERS)
  });
}

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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'POST 요청만 허용됩니다' }, 405);
    }

    const auth = String(request.headers.get('authorization') || '');
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    const v = await verifyIdToken(token);
    if (!v.ok) return jsonResponse({ error: v.error }, v.status);

    let b;
    try { b = await request.json(); } catch (e) { return jsonResponse({ error: '잘못된 요청 본문' }, 400); }
    if (!b || !b.messages) return jsonResponse({ error: 'messages가 필요합니다' }, 400);

    const body = {
      model: b.model || 'claude-haiku-4-5-20251001',
      max_tokens: Math.min(Number(b.max_tokens) || 1024, MAX_TOKENS_CAP),
      messages: b.messages
    };
    if (b.system) body.system = b.system;

    let upstream;
    try {
      upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(body)
      });
    } catch (e) {
      return jsonResponse({ error: '업스트림 호출 실패: ' + (e && e.message) }, 502);
    }
    const data = await upstream.json();
    return jsonResponse(data, upstream.status);
  }
};
