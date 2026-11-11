/* ═══════════════════════════════════════════════════════════
   tools/test-schedule-industry.js
   AI 일정 분석이 '지금 업종'에 끌려가지 않고 내용으로 업종을 고르는지,
   칸에 안 맞는 내용을 버리지 않는지 검사한다.
   ----------------------------------------------------------------
   왜 필요한가 (2026-10-26 사용자 신고):
     "내용에 맞춰서 업종이 되어야 하는데 기존에 선택된 업종에 맞춰
      제공된 정보를 바꾸는 상황이 있었어 / 가끔 제공된 내용이 반영 안 되는 경우도 있어"
     ── 원인 ① 역할 문구가 '{지금 업종} 기사의 일정 비서' 였다
        ② AI 결과에 업종이 없어 일정추가 창이 항상 지금 업종으로 열렸다
        ③ 교정 예시 머리말이 '반드시 이 정답 패턴을 따르라' 였다
        ④ OCR 상한 1,200 토큰 — 긴 대화의 마지막 말풍선이 잘렸다
        ⑤ 칸에 안 맞는 내용을 둘 곳(memo 규칙)이 없었다
═══════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const JS = path.join(__dirname, '..', 'www', 'js');
let fails = 0, oks = 0;
async function chk(name, fn) {
  try { const r = await fn(); console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; }
  catch (e) { console.log('  ❌ ' + name + ' — ' + e.message); fails++; }
}
const must = (c, m) => { if (!c) throw new Error(m); };

function loadAI(profiles, curId, reply, opt) {
  opt = opt || {};
  const calls = [];
  const ctx = {
    console, setTimeout, clearTimeout, Date, String, Math, JSON, Object, Array, RegExp, Promise, AbortController,
    localStorage: opt.ls || { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      createElement: () => ({ style: {}, classList: { add() {} }, addEventListener() {} }), body: { appendChild() {} } },
    fetch: async (url, o) => {
      const body = JSON.parse(o.body); calls.push(body);
      const isOcr = /정밀 OCR/.test(body.system || '');
      const text = isOcr ? (opt.ocrText || '') : reply;
      const stop = (isOcr && opt.ocrCut) ? 'max_tokens' : 'end_turn';
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text }], stop_reason: stop }) };
    }
  };
  ctx.window = ctx;
  const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();
  ctx.Profiles = {
    list: () => profiles, current: () => profiles.find(p => p.id === curId),
    get: id => profiles.find(p => p.id === id) || null,
    forCurrentWork: () => profiles.find(p => p.id === curId),
    matchByName: n => profiles.find(p => p.name === n) || profiles.find(p => norm(p.name) === norm(n)) || null,
    key: (b, id) => b
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(JS, 'ai.js'), 'utf8'), ctx, { filename: 'ai.js' });
  return { AI: ctx.ClaudeAI, calls };
}
const PF = [{ id: 'pf_1', name: '에어컨 청소' }, { id: 'pf_2', name: 'TV 선반 설치' }, { id: 'pf_3', name: '조명 설치' }];
const SMS = '내일 2시 행복아파트 101동 502호 거실 TV 아래 선반 1개 설치요. 주차는 지하2층이에요';

(async () => {
  console.log('\n[1] 역할 문구가 지금 업종에 끌려가지 않는다');
  await chk('지금 업종이 에어컨이어도 역할 문구에 "에어컨 청소 기사"가 없다', async () => {
    const { AI, calls } = loadAI(PF, 'pf_1', '{"industry":"TV 선반 설치","target":"TV 아래 선반 1개"}');
    await AI.extractSchedule({ text: SMS });
    const sys = calls[0].system;
    must(!/에어컨 청소 기사의 일정 비서/.test(sys), '역할 문구가 지금 업종으로 채워져 있습니다');
    must(/현장 작업 기사의 일정 비서/.test(sys), '중립 역할 문구가 없습니다');
    return '중립';
  });

  console.log('\n[2] 내용으로 고른 업종이 일정추가 창에 넘어간다');
  await chk('AI 가 고른 업종 이름 → 내 업종 id', async () => {
    const { AI, calls } = loadAI(PF, 'pf_1', '{"industry":"TV 선반 설치","target":"TV 아래 선반 1개"}');
    const r = await AI.extractSchedule({ text: SMS });
    must(/"TV 선반 설치"/.test(calls[0].system), '업종 목록이 프롬프트에 없습니다');
    must(r.profileId === 'pf_2', 'profileId=' + r.profileId);
    return r.profileId;
  });
  await chk('띄어쓰기만 다른 이름도 내 업종으로 잇는다', async () => {
    const { AI } = loadAI(PF, 'pf_1', '{"industry":"TV선반설치"}');
    const r = await AI.extractSchedule({ text: SMS });
    must(r.profileId === 'pf_2' && r.industry === 'TV 선반 설치', JSON.stringify(r));
    return r.industry;
  });
  await chk('목록에 없는 이름이면 비운다 → 창은 예전처럼 지금 업종', async () => {
    const { AI } = loadAI(PF, 'pf_1', '{"industry":"도배"}');
    const r = await AI.extractSchedule({ text: SMS });
    must(r.profileId === '' && r.industry === '', JSON.stringify(r));
    return '비움';
  });
  await chk('업종이 1개뿐이면 판정 규칙을 붙이지 않는다', async () => {
    const { AI, calls } = loadAI([PF[0]], 'pf_1', '{}');
    await AI.extractSchedule({ text: SMS });
    must(!/\[업종\(industry\) 판정\]/.test(calls[0].system), '불필요한 규칙');
    return '생략';
  });

  console.log('\n[3] 내용 보존');
  await chk('칸에 안 맞는 내용은 memo 로 모으라는 규칙이 있다', async () => {
    const { AI, calls } = loadAI(PF, 'pf_1', '{}');
    await AI.extractSchedule({ text: SMS });
    must(/\[내용 보존 규칙/.test(calls[0].system) && /memo 에 모두 적는다/.test(calls[0].system), '규칙 없음');
    must(!/target\(작업대상 예: 벽걸이/.test(calls[0].system), '작업대상 정의가 아직 에어컨 품목 예시입니다');
    return '있음';
  });
  await chk('교정 예시는 값을 옮기지 말라고 한다', async () => {
    const src = fs.readFileSync(path.join(JS, 'ai.js'), 'utf8');
    must(!/'\[과거 교정 예시[^']*반드시 이 정답 패턴을 따르라\]'/.test(src), '예전 강제 문구가 남아 있습니다');
    must(/값은 반드시 이번 입력에서만 가져온다/.test(src), '새 머리말이 없습니다');
    return '변경됨';
  });
  await chk('OCR 상한이 올라갔고, 잘리면 표시한다', async () => {
    const { AI, calls } = loadAI(PF, 'pf_1', '{"industry":"조명 설치"}', { ocrText: '[연락처: 010-1111-2222]\n거실 조명 교체', ocrCut: true });
    const r = await AI.extractSchedule({ images: [{ media_type: 'image/jpeg', data: 'x' }] });
    must(calls[0].max_tokens >= 3000, 'OCR max_tokens=' + calls[0].max_tokens);
    must(calls[1].max_tokens >= 1200, '분석 max_tokens=' + calls[1].max_tokens);
    must(r._ocrCut === true, '잘림 표시 없음');
    return 'OCR ' + calls[0].max_tokens + ' / 분석 ' + calls[1].max_tokens;
  });
  await chk('교정 학습이 업종도 비교한다 (calendar.js)', async () => {
    const cal = fs.readFileSync(path.join(JS, 'calendar.js'), 'utf8');
    must(/industry: prefill\.industry/.test(cal) && /industry: _qwPfName\(\)/.test(cal), '업종 비교 누락');
    must(/saveIndustryLearn\(prefill\.__aiSource, _qwPfName\(\)\)/.test(cal), '확정 업종 기록 누락');
    must(/CORR_FIELDS = \['industry'/.test(fs.readFileSync(path.join(JS, 'ai.js'), 'utf8')), 'CORR_FIELDS 누락');
    return '있음';
  });

  console.log('\n[4] 학습 — 쌓일수록 업종을 더 잘 고르는가');
  const memLS = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; };
  await chk('저장한 업종이 다음 분석 프롬프트에 비슷한 기록으로 실린다', async () => {
    const ls = memLS();
    const { AI, calls } = loadAI(PF, 'pf_1', '{"industry":""}', { ls });
    AI.saveIndustryLearn('거실 벽에 TV 선반 달아주세요 행복아파트', 'TV 선반 설치');
    AI.saveIndustryLearn('안방 에어컨 분해청소 2대', '에어컨 청소');
    await AI.extractSchedule({ text: '작은방 벽에 TV 선반 하나 설치 부탁드려요' });
    const sys = calls[0].system;
    must(/\[업종 학습/.test(sys), '업종 학습 블록이 없습니다');
    const blk = sys.slice(sys.indexOf('[업종 학습'));
    must(/TV 선반 설치/.test(blk.split('\n').slice(0, 6).join('\n')), '비슷한 기록이 먼저 오지 않습니다');
    must(!/분해청소/.test(blk.split('[과거 교정')[0]), '관계없는 기록이 실렸습니다');
    return '비슷한 1건만';
  });
  await chk('AI 가 업종을 비워도 같은 업종 기록이 쌓였으면 그 업종으로 채운다', async () => {
    const ls = memLS();
    const { AI } = loadAI(PF, 'pf_1', '{"industry":""}', { ls });
    ['거실 실링팬 교체 원해요', '안방 실링팬 새로 달아주세요', '실링팬 소음 나서 교체'].forEach(t => AI.saveIndustryLearn(t, '조명 설치'));
    for (let i = 0; i < 8; i++) AI.saveIndustryLearn('벽걸이 에어컨 청소 ' + i + '대 행복아파트', '에어컨 청소');
    const r = await AI.extractSchedule({ text: '작업실 실링팬 교체 가능할까요' });
    must(r.profileId === 'pf_3', 'profileId=' + r.profileId);
    return '조명 설치 (실링팬을 조명 업종으로 써 온 사용자)';
  });
  await chk('기록이 1건뿐이거나 엇갈리면 추측하지 않는다', async () => {
    const ls = memLS();
    const { AI } = loadAI(PF, 'pf_1', '{"industry":""}', { ls });
    AI.saveIndustryLearn('거실 조명 교체', '조명 설치');
    const r = await AI.extractSchedule({ text: '거실 조명 교체 문의' });
    must(r.profileId === '', 'profileId=' + r.profileId);
    return '비움';
  });
  await chk('교정 예시는 최근 8건이 아니라 비슷한 것을 먼저 고른다', async () => {
    const ls = memLS();
    const list = [{ in: '세탁기 위 건조기 직렬 설치', out: { target: '건조기 직렬' }, at: 1 }];
    for (let i = 0; i < 20; i++) list.push({ in: '벽걸이 청소 ' + i, out: { target: '벽걸이 ' + i }, at: 2 + i });
    ls.setItem('ai_schedule_corrections', JSON.stringify(list));
    const { AI, calls } = loadAI(PF, 'pf_1', '{}', { ls });
    await AI.extractSchedule({ text: '드럼세탁기 위에 건조기 직렬로 올려주세요' });
    must(/건조기 직렬 설치/.test(calls[0].system), '오래된 비슷한 교정이 빠졌습니다');
    return '21건 중 가장 오래된 것도 선택';
  });
  await chk('주소칸 자동값(아파트명)은 예시에서 뺀다', async () => {
    const ls = memLS();
    ls.setItem('ai_schedule_corrections', JSON.stringify([{ in: '행복아파트 선반', out: { apt: '행복아파트', address: '행복아파트' }, at: 1 }]));
    const { AI, calls } = loadAI(PF, 'pf_1', '{}', { ls });
    await AI.extractSchedule({ text: '행복아파트 선반 설치' });
    must(!/"address":"행복아파트"/.test(calls[0].system), '자동 주소가 정답으로 실렸습니다');
    return '제외';
  });
  await chk('학습 사용을 끄면 기록도 안 쌓이고 싣지도 않는다', async () => {
    const ls = memLS(); ls.setItem('ai_schedule_learn_off', '1');
    const { AI, calls } = loadAI(PF, 'pf_1', '{}', { ls });
    AI.saveIndustryLearn('거실 TV 선반', 'TV 선반 설치');
    must(AI.getIndLearn().length === 0, '꺼져 있는데 쌓였습니다');
    await AI.extractSchedule({ text: '거실 TV 선반' });
    must(!/\[업종 학습/.test(calls[0].system), '꺼져 있는데 실렸습니다');
    return '꺼짐';
  });

  console.log('\n' + (fails ? '❌ ' + fails + '개 실패' : '✅ ' + oks + '개 모두 통과'));
  process.exit(fails ? 1 : 0);
})();
