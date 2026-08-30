/* ═══════════════════════════════════════════════
   claude-proxy — Vercel Serverless Function
   - Anthropic API 키는 Vercel 환경변수(ANTHROPIC_API_KEY)에만 저장됨
   - 앱(ai.js)은 이 주소만 호출, 키는 클라이언트에 절대 노출되지 않음
   - ⚠️ 현재 인증 없이 누구나 호출 가능(요청사항: 일단 제한없이 열고 이후 구독형으로 개선).
     Anthropic 콘솔(console.anthropic.com)에서 지출 한도(Spend limit)를 꼭 설정해두세요.
═══════════════════════════════════════════════ */
const MAX_TOKENS_CAP = 4000; // 남용 방지: 요청값이 더 커도 이 값으로 자름

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 허용됩니다' });
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
