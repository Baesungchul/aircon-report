/* ═══════════════════════════════════════════════
   ai.js — Claude AI 보조 기능 (BYO 키 프로토타입)
   - 문자/캡처(이미지) 분석 → 일정(작업) 추가
   - (예정) 작업+사진 → 블로그 글 작성
   ⚠️ BYO 키: API 키를 기기 localStorage에 저장. 개인/소규모용.
      공개 배포 전엔 서버 프록시로 교체 권장.
═══════════════════════════════════════════════ */
(function () {
  'use strict';
  window.ClaudeAI = window.ClaudeAI || {}; // 문자/캡처 학습 + 이미지 학습 지원

  var KEY_LS = 'claude_api_key';
  var MODEL_LS = 'claude_model';
  var DEFAULT_MODEL = 'claude-sonnet-4-6';  // 일정추출도 소넷으로 (판독 정확도↑)

  function getKey() { try { return localStorage.getItem(KEY_LS) || ''; } catch (e) { return ''; } }
  function setKey(v) { try { localStorage.setItem(KEY_LS, v || ''); } catch (e) {} }
  function getModel() { try { return localStorage.getItem(MODEL_LS) || DEFAULT_MODEL; } catch (e) { return DEFAULT_MODEL; } }
  function setModel(v) { try { localStorage.setItem(MODEL_LS, v || DEFAULT_MODEL); } catch (e) {} }
  // 예전 기본값(Haiku)에 고정돼 있던 기존 사용자 → Sonnet으로 1회 자동 이전
  try { if (localStorage.getItem(MODEL_LS) === 'claude-haiku-4-5-20251001') localStorage.setItem(MODEL_LS, DEFAULT_MODEL); } catch (e) {}
  function toast(m, t) { if (typeof showToast === 'function') showToast(m, t || 'ok'); else alert(m); }
  function esc(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function today() { return (typeof kstDateStr === 'function') ? kstDateStr() : new Date().toISOString().slice(0, 10); }

  // ── 교정 학습 저장소 (사용자가 AI 결과를 고치면 few-shot 예시로 축적) ──
  var CORR_LS = 'ai_schedule_corrections';
  var CORR_MAX = 40;   // 최대 보관 건수
  var CORR_SHOTS = 8;  // 프롬프트에 넣을 최근 예시 수
  var CORR_FIELDS = ['startTime', 'endTime', 'apt', 'unit', 'target', 'phone', 'address', 'price', 'memo']; // date는 상대적이라 학습 제외
  function learnOff(k){ try{ return localStorage.getItem(k) === '1'; }catch(e){ return false; } }
  function setLearnOff(k, off){ try{ if(off) localStorage.setItem(k,'1'); else localStorage.removeItem(k); }catch(e){} }
  ClaudeAI.learnOff = learnOff; ClaudeAI.setLearnOff = setLearnOff;
  function getCorrections() {
    try { var a = JSON.parse(localStorage.getItem(CORR_LS) || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function setCorrections(a) { try { localStorage.setItem(CORR_LS, JSON.stringify(a || [])); } catch (e) {} }
  function _normOut(o) {
    var r = {}; o = o || {};
    CORR_FIELDS.forEach(function (k) {
      var v = o[k]; if (v == null) v = '';
      if (k === 'price') v = (v === '' || v === 0 || v === '0') ? '' : String(v).replace(/[^\d]/g, '');
      r[k] = String(v).trim();
    });
    return r;
  }
  // AI 원본과 사용자 확정본이 다르면 교정 예시로 저장 (문자 원문 또는 캡처에서 읽어낸 _src가 있을 때)
  function saveCorrection(sourceText, aiRaw, finalOut) {
    if (learnOff('ai_schedule_learn_off')) return;
    try {
      sourceText = String(sourceText || '').trim();
      if (!sourceText) return;
      var ai = _normOut(aiRaw), fin = _normOut(finalOut);
      var changed = CORR_FIELDS.some(function (k) { return ai[k] !== fin[k]; });
      if (!changed) return; // 고친 게 없으면 저장 안 함
      var list = getCorrections().filter(function (c) { return c.in !== sourceText; }); // 같은 입력은 최신으로 교체
      list.push({ in: sourceText, out: fin, at: Date.now() });
      if (list.length > CORR_MAX) list = list.slice(list.length - CORR_MAX);
      setCorrections(list);
      try { if (window.CloudAILearn && CloudAILearn.onLocalChanged) CloudAILearn.onLocalChanged(); } catch (e) {}
    } catch (e) {}
  }
  function clearCorrections() { setCorrections([]); try { if (window.CloudAILearn && CloudAILearn.push) CloudAILearn.push(true); } catch (e) {} }
  ClaudeAI.saveCorrection = saveCorrection;
  ClaudeAI.getCorrections = getCorrections;
  ClaudeAI.setCorrectionsRaw = function (a) { setCorrections(a); };  // 클라우드 병합 결과 반영용
  ClaudeAI.clearCorrections = clearCorrections;
  // 최근 교정들을 few-shot 프롬프트 블록으로 (빈 값은 생략)
  function buildFewShot() {
    if (learnOff('ai_schedule_learn_off')) return '';
    var list = getCorrections();
    if (!list.length) return '';
    var recent = list.slice(-CORR_SHOTS);
    var lines = ['', '[과거 교정 예시 — 아래는 사용자가 최종 확정한 정답이다. 같거나 비슷한 입력은 반드시 이 정답 패턴을 따르라]'];
    recent.forEach(function (c) {
      var out = {};
      CORR_FIELDS.forEach(function (k) { if (c.out && c.out[k]) out[k] = c.out[k]; });
      lines.push('입력: ' + JSON.stringify(c.in));
      lines.push('정답: ' + JSON.stringify(out));
    });
    return lines.join('\n');
  }

  // ── 이미지 → 리사이즈 base64 (긴 변 maxDim 이하, JPEG) ──
  function fileToResizedBase64(file, maxDim, quality) {
    maxDim = maxDim || 1568;
    quality = quality || 0.85;
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () {
          var w = img.width, h = img.height;
          var scale = Math.min(1, maxDim / Math.max(w, h));
          var nw = Math.max(1, Math.round(w * scale)), nh = Math.max(1, Math.round(h * scale));
          var cv = document.createElement('canvas'); cv.width = nw; cv.height = nh;
          cv.getContext('2d').drawImage(img, 0, 0, nw, nh);
          var durl = cv.toDataURL('image/jpeg', quality);
          resolve({ media_type: 'image/jpeg', data: durl.split(',')[1], thumbUrl: durl });
        };
        img.onerror = function () { reject(new Error('이미지를 읽을 수 없습니다')); };
        img.src = fr.result;
      };
      fr.onerror = function () { reject(new Error('파일 읽기 실패')); };
      fr.readAsDataURL(file);
    });
  }

  // ── Claude Messages API 호출 (서버 프록시 경유 — 키는 서버에만 있음) ──
  // ⚠️ Cloudflare Worker 배포 후 실제 출력된 주소로 교체하세요.
  //    (wrangler deploy 실행 시 https://claude-proxy.<계정서브도메인>.workers.dev 형태로 출력됨)
  var PROXY_URL = 'https://vercel-proxy-orpin-pi.vercel.app/api/claude-proxy';

  // ── 토큰 사용량 → 비용 자가 집계 (조직/Admin API 없이 실제 비용 추정) ──
  //   응답의 usage(input/output 토큰)에 모델별 단가(백만 토큰당 USD)를 곱해 누적한다.
  function _priceOf(model) {
    var m = String(model || '').toLowerCase();
    if (m.indexOf('opus') >= 0) return { in: 15, out: 75 };
    if (m.indexOf('haiku') >= 0) return { in: 1, out: 5 };
    return { in: 3, out: 15 };   // sonnet(기본)
  }
  function _recordUsage(model, usage) {
    if (!usage) return;
    var it = Number(usage.input_tokens || 0), ot = Number(usage.output_tokens || 0);
    if (!it && !ot) return;
    var pr = _priceOf(model);
    var usd = it / 1e6 * pr.in + ot / 1e6 * pr.out;
    try { if (window.Subs && Subs.addAiUsage) Subs.addAiUsage(usd, it, ot); } catch (e) {}
  }

  async function callClaude(opts) {
    var body = {
      model: opts.model || getModel(),
      max_tokens: opts.max_tokens || 1024,
      messages: opts.messages
    };
    if (opts.system) body.system = opts.system;
    var res;
    try {
      res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (e) {
      throw new Error('네트워크 오류: ' + (e && e.message));
    }
    var data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      var msg = (data && data.error && (data.error.message || data.error)) || ('HTTP ' + res.status);
      throw new Error('AI 서버 오류: ' + String(msg).slice(0, 180));
    }
    try { if (data && data.usage) _recordUsage(body.model, data.usage); } catch (e) {}
    return ((data && data.content) || []).filter(function (b) { return b.type === 'text'; })
      .map(function (b) { return b.text; }).join('\n');
  }
  ClaudeAI.callClaude = callClaude;
  ClaudeAI.getKey = getKey;

  // ── 캡처 이미지 → 정확한 텍스트 전사 (OCR 단계) ──
  async function transcribeImages(images) {
    var sys = '당신은 정밀 OCR 도구입니다. 제공된 스크린샷(문자메시지·일정 캡처)에 실제로 보이는 텍스트를 오타 없이 그대로 옮겨 적으세요. 화면 상단의 발신자 이름 또는 전화번호(연락처 표시줄)가 보이면 반드시 맨 첫 줄에 [연락처: 010-1234-5678] 형식으로 옮겨 적으세요(저장된 이름 대신 숫자로 표시돼 있으면 그 번호를 그대로 옮깁니다). 그다음 줄부터 대화 말풍선을 시간·순서대로 옮깁니다. 보이는 글자만 정확히 옮기고, 해석·요약·추측·없는 내용 추가는 절대 금지. 설명 없이 옮긴 텍스트만 출력하세요.';
    var content = [];
    images.forEach(function (im) {
      content.push({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } });
    });
    content.push({ type: 'text', text: '위 이미지에 보이는 텍스트를 그대로 정확히 옮겨 적어줘.' });
    var out = await callClaude({ model: getModel(), max_tokens: 1200, system: sys, messages: [{ role: 'user', content: content }] });
    return String(out || '').trim();
  }
  ClaudeAI.transcribeImages = transcribeImages;

  // ── 문자/이미지 → 일정 JSON 추출 ──
  async function extractSchedule(opts) {
    opts = opts || {};
    var text = (opts.text || '').trim();
    var images = opts.images || [];
    if (!text && !images.length) throw new Error('문자 또는 이미지를 입력해주세요');

    // ★ 2026-08-16: 역할 문구를 지금 업종으로 (아래 주소 파싱 예시는 업종 무관이라 그대로 둔다)
    var sys = indFill('당신은 {업종} 기사의 일정 비서입니다.') + ' 입력된 문자 텍스트 또는 문자 대화 스크린샷(이미지)에서 작업 일정 정보를 추출해 JSON 객체 하나만 출력하세요.\n' +
      '키: date(YYYY-MM-DD), startTime(HH:MM 24시간), endTime(HH:MM), apt(현장/건물/아파트명), unit(동호수), target(작업대상 예: 벽걸이 2대), phone, address(도로명/지번 주소), price(숫자만), memo.\n' +
      '\n' +
      '[apt·unit·address 구분 규칙 — 가장 중요, 4단계로 판단]\n' +
      '1) 먼저 도로명주소·지번주소를 찾는다: "○○로 123", "○○길 45", "○○동 123-4"처럼 "로/길" 또는 "동"+숫자 뒤에 지번이 오는 형태는 address에 넣고, apt·unit에는 포함하지 않는다.\n' +
      '2) 아파트 단지명의 "차수"(1차, 2차, 3차 등)는 그 단지 고유 이름의 일부다. 반드시 앞 이름과 붙여서 apt에 통째로 넣는다(예: "우미2차", "래미안3차"). 절대로 숫자만 떼어 unit으로 보내지 않는다.\n' +
      '3) apt: 1)의 도로명주소를 제외한, 건물/단지/상가/회사의 고유 이름만. "○○아파트", "○○빌라", "○○타운"+차수, "○○오피스텔", "○○빌딩", "○○점"처럼 이름 자체. 동(棟)/호수/층 숫자는 apt에 넣지 않는다(단, 2)의 차수는 예외로 apt에 포함).\n' +
      '4) unit: 그 건물 안에서의 세부 위치. "101동 502호", "502호", "3층 소마사무실"처럼 동(棟)·호수·층 숫자가 들어간 부분만. 단지명·차수·도로명주소는 unit에 넣지 않는다.\n' +
      '- 건물명 없이 동호수만 있으면 apt는 빈 문자열("")로 두고 unit에 동호수 전체를 넣는다.\n' +
      '- 이름과 동호수가 띄어쓰기 없이 붙어 있어도(예: "행복아파트101동502호") 이름 부분과 숫자+동/호 부분을 분리해서 각각 apt/unit에 넣는다.\n' +
      '예시) "행복아파트 101동 502호 벽걸이 청소" → address:"", apt:"행복아파트", unit:"101동 502호"\n' +
      '예시) "101동 502호 스탠드 설치" → address:"", apt:"", unit:"101동 502호"\n' +
      '예시) "라이프타워 3층 소마사무실 시스템에어컨" → address:"", apt:"라이프타워", unit:"3층 소마사무실"\n' +
      '예시) "경기대로 1188 우미2차 203동 602호 시스템에어컨 점검" → address:"경기대로 1188", apt:"우미2차", unit:"203동 602호"\n' +
      '\n' +
      '[전화번호 규칙 — 최우선] 텍스트에 "[연락처: ...]" 줄이 있으면 그 번호를 반드시 phone 값으로 사용한다. 이 형식이 아니어도 텍스트 안에 010으로 시작하는 번호가 보이면 절대 비우지 말고 phone에 채운다.\n' +
      '\n' +
      '모르는 값은 빈 문자열("")로, price는 모르면 0. 상대적 날짜(오늘/내일/모레/요일)는 오늘(' + today() + ') 기준으로 계산. 연도가 없으면 올해로. 스크린샷이면 대화 내용을 읽어 고객이 요청한 작업 정보를 추출.\n' +
      '입력이 이미지(캡처)일 때는 _src 키를 추가로 넣으세요: 스크린샷에서 읽은 고객 요청 핵심을 한 줄 텍스트로 옮겨 담습니다(예: "내일 2시 행복아파트 101동 502호 벽걸이 2대 청소 010-1234-5678"). 이는 학습용이며 일정 필드가 아닙니다. 텍스트로 입력된 경우엔 _src를 생략하세요.\n' +
      '코드펜스나 설명 없이 순수 JSON만 출력하세요.';

    // 사용자 지침 (일정 분석 전용 — 설정/분석창에서 편집)
    try { var _schedGuide = getChGuide('schedule'); if (_schedGuide) sys += '\n\n[사용자 지침 — 반드시 반영]\n' + _schedGuide; } catch (e) {}

    sys += buildFewShot();

    // OCR 우선: 캡처 이미지는 먼저 '글자만 정확히' 전사한 뒤, 그 텍스트로 일정을 구조화한다
    var fromImage = images.length > 0;
    var ocrText = '';
    if (fromImage) {
      try { ocrText = await transcribeImages(images); } catch (e) { ocrText = ''; }
    }
    var srcText = [text, ocrText].filter(Boolean).join('\n').trim();

    var contentArr = [];
    if (fromImage && !ocrText) {
      // 전사 실패 시에만 이미지를 직접 첨부(구버전 방식으로 폴백)
      images.forEach(function (im) {
        contentArr.push({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } });
      });
      var ask0 = '위 스크린샷에서 일정 정보를 추출해 JSON으로만 출력하세요.';
      contentArr.push({ type: 'text', text: text ? (text + '\n\n' + ask0) : ask0 });
    } else {
      var ask1 = (fromImage ? '아래 내용(캡처에서 읽은 문자)' : '아래 문자') + '에서 일정 정보를 추출해 JSON으로만 출력하세요.';
      contentArr.push({ type: 'text', text: srcText + '\n\n' + ask1 });
    }

    var out = await callClaude({ system: sys, max_tokens: 800, messages: [{ role: 'user', content: contentArr }] });
    var m = out.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('일정 정보를 찾지 못했습니다');
    var obj = JSON.parse(m[0]);
    // 전화번호 안전망: AI가 놓쳐도 원문(OCR 포함)에서 정규식으로 재확인해 채운다 (학습에 의존하지 않는 기본기능)
    if (!obj.phone) {
      var _pm = srcText.match(/\[연락처:\s*([\d.\-\s]+)\]/) || srcText.match(/01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/);
      if (_pm) {
        var _pnum = (_pm[1] || _pm[0]).replace(/[^\d]/g, '');
        if (_pnum.length >= 9) obj.phone = _pnum.replace(/(\d{3})(\d{3,4})(\d{4})/, '$1-$2-$3');
      }
    }
    // 학습 소스: 이미지였으면 전사 텍스트를 원본으로 사용(다음 분석 few-shot 정확도↑)
    if (fromImage && srcText) obj._src = srcText;
    try { if (window.Subs) Subs.consumeAI('sched'); } catch (e) {}  // ★ 구독: 1회 차감
    return obj;
  }
  ClaudeAI.extractSchedule = extractSchedule;

  // ── 블로그: 지침/모델 저장 ──
  var GUIDE_LS = 'claude_blog_guideline';
  var BLOGMODEL_LS = 'claude_blog_model';
  var DEFAULT_BLOG_MODEL = 'claude-sonnet-4-6';
  function getGuide() { try { return localStorage.getItem(GUIDE_LS) || ''; } catch (e) { return ''; } }
  function setGuide(v) { try { localStorage.setItem(GUIDE_LS, v || ''); } catch (e) {} }
  function getBlogModel() { try { return localStorage.getItem(BLOGMODEL_LS) || DEFAULT_BLOG_MODEL; } catch (e) { return DEFAULT_BLOG_MODEL; } }
  function setBlogModel(v) { try { localStorage.setItem(BLOGMODEL_LS, v || DEFAULT_BLOG_MODEL); } catch (e) {} }

  // dataURL → 리사이즈 base64 (블로그 사진용, 비용 절감)
  function dataUrlToResizedBase64(durl, maxDim) {
    maxDim = maxDim || 1024;
    return new Promise(function (resolve) {
      try {
        var img = new Image();
        img.onload = function () {
          var w = img.width, h = img.height, scale = Math.min(1, maxDim / Math.max(w, h));
          var nw = Math.max(1, Math.round(w * scale)), nh = Math.max(1, Math.round(h * scale));
          var cv = document.createElement('canvas'); cv.width = nw; cv.height = nh;
          cv.getContext('2d').drawImage(img, 0, 0, nw, nh);
          var out = cv.toDataURL('image/jpeg', 0.82);
          resolve({ media_type: 'image/jpeg', data: out.split(',')[1] });
        };
        img.onerror = function () { resolve(null); };
        img.src = durl;
      } catch (e) { resolve(null); }
    });
  }

  // 현재 작업탭에 열린 작업에서 대표 사진 수집(호수당 전 1·후 1)
  async function collectWorkImages(maxN) {
    maxN = maxN || 6;
    var durls = [];
    try {
      if (typeof units === 'undefined' || !units) return [];
      for (var i = 0; i < units.length && durls.length < maxN; i++) {
        var u = units[i];
        var pools = [u.before || [], u.after || []];
        for (var pi = 0; pi < pools.length && durls.length < maxN; pi++) {
          var arr = pools[pi];
          for (var k = 0; k < arr.length; k++) {
            var px = arr[k];
            var d = (typeof px === 'string') ? px : (px && (px.dataUrl || px.thumbDataUrl));
            if (d && d.indexOf('data:image') === 0) { durls.push(d); break; }
          }
        }
      }
    } catch (e) {}
    var out = [];
    for (var j = 0; j < durls.length; j++) { var im = await dataUrlToResizedBase64(durls[j], 1024); if (im) out.push(im); }
    return out;
  }

  // 현재 작업 메타 텍스트
  function currentWorkMeta() {
    var g = function (id) { var el = document.getElementById(id); return el ? (el.value || '') : ''; };
    var apt = g('aptName'), date = g('workDate'), worker = g('workerName');
    var isFac = (typeof currentWorkType !== 'undefined' && currentWorkType === 'facility');
    var lines = [];
    lines.push('현장/작업명: ' + (apt || '(미입력)'));
    if (date) lines.push('작업일: ' + date);
    if (worker) lines.push('작업자: ' + worker);
    lines.push('작업유형: ' + (isFac ? '공용시설' : '가정용'));
    try {
      (units || []).forEach(function (u) {
        var c = u.customer || {};
        var seg = '- ' + (u.name || '');
        if (c.workTarget) seg += ' / 작업대상: ' + c.workTarget;
        if (c.price) seg += ' / 가격: ' + c.price;
        if (c.memo) seg += ' / 메모: ' + c.memo;
        seg += ' / 사진 전' + ((u.before || []).length) + '·후' + ((u.after || []).length);
        lines.push(seg);
      });
    } catch (e) {}
    try {
      if (isFac && typeof facilityCustomer !== 'undefined' && facilityCustomer) {
        if (facilityCustomer.workTarget) lines.push('시설 작업대상: ' + facilityCustomer.workTarget);
        if (facilityCustomer.memo) lines.push('시설 메모: ' + facilityCustomer.memo);
      }
    } catch (e) {}
    return { apt: apt, text: lines.join('\n') };
  }

  // ── 글작성 채널 설정 (네이버/당근/인스타/페북/견적서) ──
  /* ── 채널 대표 아이콘 (2026-08-09) ─────────────────
     이모지(📝🥕📸👍)는 기기·OS마다 모양이 달라 브랜드로 안 읽혔다.
     인라인 SVG로 각 서비스의 대표 아이콘을 직접 그린다. */
  var CH_SVG = {
    naver: '<rect width="24" height="24" rx="6.5" fill="#03C75A"/>'
         + '<path d="M7.6 5.4v13.2" stroke="#fff" stroke-width="2.7" stroke-linecap="round"/>'
         + '<circle cx="12.1" cy="14.4" r="3.7" fill="none" stroke="#fff" stroke-width="2.7"/>'
         + '<path d="M18.9 9.9v8.7" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>',
    daangn: '<rect width="24" height="24" rx="6.5" fill="#FF6F0F"/>'
          + '<ellipse cx="10.4" cy="7.3" rx="2.15" ry="1.55" fill="#00A05B" transform="rotate(-28 10.4 7.3)"/>'
          + '<ellipse cx="13.3" cy="6.5" rx="2.35" ry="1.65" fill="#00A05B" transform="rotate(18 13.3 6.5)"/>'
          + '<circle cx="12" cy="14.4" r="6.1" fill="#fff"/>'
          + '<circle cx="12" cy="14.4" r="2.55" fill="#FF6F0F"/>',
    insta: '<defs><linearGradient id="acIg" x1="0" y1="1" x2="1" y2="0">'
         + '<stop offset="0" stop-color="#FEDA75"/><stop offset=".35" stop-color="#FA7E1E"/>'
         + '<stop offset=".6" stop-color="#D62976"/><stop offset=".85" stop-color="#962FBF"/>'
         + '<stop offset="1" stop-color="#4F5BD5"/></linearGradient></defs>'
         + '<rect width="24" height="24" rx="6.5" fill="url(#acIg)"/>'
         + '<rect x="5" y="5" width="14" height="14" rx="4.3" fill="none" stroke="#fff" stroke-width="1.9"/>'
         + '<circle cx="12" cy="12" r="3.5" fill="none" stroke="#fff" stroke-width="1.9"/>'
         + '<circle cx="16.4" cy="7.6" r="1.15" fill="#fff"/>',
    facebook: '<rect width="24" height="24" rx="6.5" fill="#1877F2"/>'
            + '<path d="M15.1 24v-8.8h2.9l.44-3.45h-3.34V9.55c0-1 .28-1.68 1.71-1.68h1.83V4.78c-.32-.04-1.4-.14-2.67-.14-2.64 0-4.45 1.62-4.45 4.58v2.53H8.6v3.45h2.92V24z" fill="#fff"/>'
  };
  // chId 의 아이콘 HTML — SVG 가 있으면 SVG, 없으면 기존 이모지
  function chIcon(chId, size) {
    var sv = CH_SVG[chId];
    var px = size || 16;
    if (sv) {
      return '<svg viewBox="0 0 24 24" width="' + px + '" height="' + px + '" '
           + 'style="vertical-align:-.16em;flex:none;" aria-hidden="true">' + sv + '</svg>';
    }
    var m = CHANNELS[chId] || CHANNELS.naver;
    return '<span style="font-size:' + px + 'px;">' + (m && m.icon ? m.icon : '') + '</span>';
  }
  ClaudeAI.channelIcon = chIcon;

  /* ★ 2026-08-16 — 업종 토큰 치환 (다중 업종의 마지막 조각)
       문제: 기본 지침(defGuide)과 AI 역할 문구(sys)가 전부 '에어컨 청소/설치'로 박혀 있었다.
             그래서 업종별로 지침 키를 갈라놔도, 새 업종에서 지침 편집을 열면
             '에어컨 청소' 기본 지침이 그대로 떴고(사용자 보고 2026-08-16),
             글을 생성하면 AI 역할 자체가 "에어컨 전문가"라 조명·선반 글이 에어컨 쪽으로 끌려갔다.
       해결: 아래 문구들을 {업종}·{단계} 토큰으로 바꾸고, 쓰는 순간
             지금 열린 작업의 업종 프로필 값으로 치환한다(indFill).
       ⚠️ 정의 시점이 아니라 '사용 시점'에 치환해야 한다 — 업종은 도중에 바뀐다. */
  /* ★ 2026-08-17 — pf 를 넘기면 그 업종으로 치환한다.
       설정·업종 상세에서 지침을 열 때는 '지금 작업의 업종'이 아니라
       '사용자가 보고 있는 업종'으로 기본 지침이 보여야 하기 때문. */
  function indTokens(pf) {
    var name = '', stage = '';
    try {
      if (!pf && window.Profiles && Profiles.forCurrentWork) pf = Profiles.forCurrentWork();
      if (pf) { name = pf.name || ''; stage = pf.stageLabel || ''; }
    } catch (e) {}
    if (!name) name = '현장';                 // 업종 미설정이어도 문장이 어색해지지 않게
    if (!stage) stage = '작업';
    return { ind: name, tag: name.replace(/[\s·/]/g, ''), stage: stage };
  }
  function indFill(s, pf) {
    if (!s) return s;
    var t = indTokens(pf);
    return String(s).replace(/\{업종태그\}/g, t.tag).replace(/\{업종\}/g, t.ind).replace(/\{단계\}/g, t.stage);
  }
  ClaudeAI.indFill = indFill;

  var CHANNELS = {
    naver: {
      label: '네이버 블로그', icon: '📝', color: 'linear-gradient(135deg,#03c75a,#02a34a)',
      copyHint: '전체 복사 후 네이버 블로그에 붙여넣으세요. (#·** 같은 기호가 거슬리면 "서식 없이")',
      guidePh: '예) 친근한 존댓말, 800자 내외, 소제목 3개, 마지막에 업체명·연락처와 해시태그 5개. {단계} 전후 차이를 강조.',
      defGuide: '- 친근하고 신뢰감 있는 존댓말로 작성\n- 전체 1,000~1,500자, 소제목 3~4개로 단락 구분\n- 도입: 고객이 겪던 불편에 공감하며 시작\n- 본문: {단계} 과정과 전/후 변화를 구체적으로 설명\n- 검색 키워드(지역명+{업종})를 제목과 본문에 자연스럽게 2~3회 포함\n- 사진이 들어갈 자리를 (사진: 작업 전) (사진: 작업 후) 형식으로 표시\n- 마무리: {업종} 관련 관리 팁 1가지 + 예약/문의 안내\n- 마지막 줄에 해시태그 5개 (#지역명{업종태그} #{업종태그} 등)\n- 개인정보 보호: 동·호수, 고객 이름, 전화번호는 절대 쓰지 않기 (아파트/건물명까지만)',
      sys: '당신은 {업종} 전문가의 마케팅 블로그 글을 쓰는 한국어 카피라이터입니다. 제공된 작업 정보와 작업 전/후 사진을 바탕으로 자연스럽고 신뢰감 있는 네이버 블로그 글을 작성하세요. 사진이 있으면 전/후 변화와 {단계} 효과를 구체적으로 묘사하고, 사실에 근거하되 과장은 피하세요. 이 글은 {업종} 작업에 대한 글입니다 — 다른 업종의 내용을 끌어오지 마세요. [개인정보 보호 — 최우선 규칙] 글에 동(棟)·호수, 고객 이름, 전화번호, 상세 주소 등 개인정보는 절대 쓰지 마세요. 위치는 아파트/건물명(단지명)까지만 언급합니다.'
    },
    daangn: {
      label: '당근 소식', icon: '🥕', color: 'linear-gradient(135deg,#ff8a3d,#ff6f0f)',
      copyHint: '전체 복사 후 당근 비즈프로필 소식에 붙여넣으세요.',
      guidePh: '예) 동네 이웃에게 말하듯 편안한 존댓말, 300~500자, 이모지 조금, 우리 동네(○○동) 언급, 마지막에 예약 안내.',
      defGuide: '- 동네 이웃에게 말하듯 편안한 존댓말, 과장 없이 담백하게\n- 300~500자로 짧게, 문단 2~3개\n- 동네 이름을 자연스럽게 언급 (예: ○○동에서 진행한 {업종} 작업이에요)\n- 실제 작업 내용과 전/후 변화 위주로 쓰고, 광고 문구·최상급 표현(최고/최저가 등)은 금지\n- 이모지는 1~3개만\n- 마지막에 예약/문의 안내 한 줄\n- 개인정보 보호: 동·호수, 고객 이름, 전화번호는 절대 쓰지 않기 (아파트/건물명까지만)',
      sys: '당신은 동네 기반 앱 "당근" 비즈프로필의 소식 글을 쓰는 한국어 카피라이터입니다. {업종} 작업 정보와 전/후 사진을 바탕으로 동네 이웃에게 말하듯 친근하고 담백한 소식 글을 작성하세요. 짧고 읽기 쉽게, 과장 광고 표현 없이 실제 작업 내용 위주로 쓰고, 마크다운 기호(#, ** 등)는 쓰지 마세요. 이 글은 {업종} 작업에 대한 글입니다 — 다른 업종의 내용을 끌어오지 마세요. [개인정보 보호 — 최우선 규칙] 글에 동(棟)·호수, 고객 이름, 전화번호, 상세 주소 등 개인정보는 절대 쓰지 마세요. 위치는 아파트/건물명(단지명)까지만 언급합니다.'
    },
    insta: {
      label: '인스타그램', icon: '📸', color: 'linear-gradient(135deg,#f58529,#dd2a7b)',
      copyHint: '전체 복사 후 인스타그램 게시글 캡션에 붙여넣으세요.',
      guidePh: '예) 짧은 문장 + 줄바꿈 위주, 이모지 활용, 마지막에 해시태그 10~15개(#{업종태그} #○○동{업종태그} 등).',
      defGuide: '- 첫 문장은 시선을 끄는 한 줄 (질문형 또는 전/후 반전 강조)\n- 짧은 문장 + 줄바꿈 위주, 문단 사이 빈 줄로 리듬감 있게\n- 이모지를 문장마다 1개 정도 자연스럽게\n- 전/후 사진 변화를 언급하며 넘겨보기 유도 (👉 옆으로 넘겨보세요)\n- 본문 300자 내외로 간결하게\n- 마지막에 해시태그 10~15개 (#{업종태그} + 지역 태그 혼합)\n- 개인정보 보호: 동·호수, 고객 이름, 전화번호는 절대 쓰지 않기 (아파트/건물명까지만)',
      sys: '당신은 인스타그램 마케팅 캡션을 쓰는 한국어 카피라이터입니다. {업종} 작업 정보와 전/후 사진을 바탕으로 인스타그램 게시글 캡션을 작성하세요. 짧은 문장과 줄바꿈 위주로 리듬감 있게, 이모지를 적절히 쓰고, 마지막에 관련 해시태그를 넣으세요. 마크다운 기호(#제목, ** 등)는 쓰지 마세요(해시태그 제외). 이 글은 {업종} 작업에 대한 글입니다 — 다른 업종의 내용을 끌어오지 마세요. [개인정보 보호 — 최우선 규칙] 글에 동(棟)·호수, 고객 이름, 전화번호, 상세 주소 등 개인정보는 절대 쓰지 마세요. 위치는 아파트/건물명(단지명)까지만 언급합니다.'
    },
    facebook: {
      label: '페이스북', icon: '👍', color: 'linear-gradient(135deg,#1877f2,#0a5dc2)',
      copyHint: '전체 복사 후 페이스북 게시글에 붙여넣으세요.',
      guidePh: '예) 신뢰감 있는 존댓말, 500자 내외 스토리텔링, 마지막에 연락처와 해시태그 3~5개.',
      defGuide: '- 신뢰감 있는 존댓말, 스토리텔링 형식 (의뢰 배경 → {단계} 과정 → 결과)\n- 500~800자, 문단 3~4개\n- 첫 두 줄에 핵심 내용 (더보기 접힘 전에 흥미 유발)\n- 전/후 차이와 효과를 구체적으로\n- 마무리에 연락처·예약 안내\n- 해시태그는 3~5개만 마지막 줄에\n- 개인정보 보호: 동·호수, 고객 이름, 전화번호는 절대 쓰지 않기 (아파트/건물명까지만)',
      sys: '당신은 페이스북 페이지 게시글을 쓰는 한국어 카피라이터입니다. {업종} 작업 정보와 전/후 사진을 바탕으로 신뢰감 있는 페이스북 게시글을 작성하세요. 자연스러운 스토리텔링으로 {단계} 과정과 결과를 전하고, 사실에 근거하되 과장은 피하세요. 마크다운 기호(#, ** 등)는 쓰지 말고 해시태그는 마지막에만 넣으세요. 이 글은 {업종} 작업에 대한 글입니다 — 다른 업종의 내용을 끌어오지 마세요. [개인정보 보호 — 최우선 규칙] 글에 동(棟)·호수, 고객 이름, 전화번호, 상세 주소 등 개인정보는 절대 쓰지 마세요. 위치는 아파트/건물명(단지명)까지만 언급합니다.'
    },
    quote: {
      label: '견적서', icon: '🧾', color: 'linear-gradient(135deg,#10b981,#059669)',
      copyHint: '전체 복사 후 문자·카카오톡으로 고객에게 보내세요.',
      guidePh: '예) 업체명 ○○(010-0000-0000), {업종} 항목별 단가를 적어주세요. 예) A작업 80,000원 / B작업 120,000원, 2개 이상 10% 할인, 부가세 포함, 예약금 안내 문구.',
      sys: '당신은 {업종} 업체의 견적서를 작성하는 한국어 어시스턴트입니다. 고객 요청 내용에서 작업 항목·수량을 파악해 문자/카카오톡으로 바로 보낼 수 있는 깔끔한 견적서 텍스트를 작성하세요.\n- 구성: 인사말 → 견적 내역(항목/수량/금액) → 합계 → 안내사항(소요시간·준비사항 등) → 업체명·연락처.\n- 가격은 지침에 적힌 가격표를 근거로만 계산하세요. 지침에 없는 항목의 가격은 절대 지어내지 말고 "[가격 확인 후 안내]"로 표기하세요.\n- 이 견적서는 {업종} 작업 건입니다. 다른 업종의 항목·가격은 절대 넣지 마세요.\n- 마크다운 기호(#, ** 등) 없이 일반 텍스트로, 줄맞춤은 공백과 줄바꿈으로 하세요.'
    },
    schedule: {
      label: '일정 분석', icon: '📩', color: 'var(--sf2,#6b7280)',
      copyHint: '',
      guidePh: '예) 시간이 없으면 오전 10시로. "OO타워"는 주소가 △△로 123. 금액에 "만"이 붙으면 만원 단위. 메모에는 요청사항 원문을 남겨줘.',
      sys: ''
    }
  };
  /* ★ 2026-08-16 — 글쓰기 지침을 업종별로 분리
       예전에는 지침 키가 채널당 하나뿐이라, 에어컨 청소 지침을 써두고 조명설치
       글을 쓰면 에어컨 가격표·말투가 그대로 섞여 나왔다.
       이제 지금 열린 작업의 업종 프로필별로 키가 갈린다.
       ⚠️ 첫 프로필은 기존 키를 그대로 쓴다(Profiles.key) → 기존 지침이 그대로 살아있고
          옮기는 과정이 없으므로 유실 위험이 없다. */
  /* ★ 2026-08-17 — 업종 무관 채널(4단계에서 키 분기까지 붙는다).
       일정 분석 지침은 주소·시간·금액 해석 같은 공통 지식이라 업종별로 갈라지면 안 된다. */
  var SHARED_CH = { schedule: 1 };
  ClaudeAI.isSharedChannel = function (id) { return !!SHARED_CH[id]; };

  function chGuideBase(id) { return (id === 'naver') ? GUIDE_LS : ('claude_write_guide_' + id); }
  /* pfId 를 넘기면 **그 업종의 칸**을 연다(설정·업종 상세용).
     생략하면 예전처럼 '지금 열린 작업의 업종'(forCurrentWork) — 글쓰기 화면용. */
  function chGuideKey(id, pfId) {
    var base = chGuideBase(id);
    /* ★ 2026-08-17 — 업종 무관 채널은 여기서 끝. 프로필 접미사를 붙이지 않는다.
         첫 프로필은 원래 접미사가 없었으므로(Profiles.key) 기존 값이 그대로 살아난다.
         두 번째 이후 업종에 써둔 '..._schedule__pf_xxx' 는 손대지 않고 그냥 둔다
         (자동 병합은 문장이 중복·충돌해서 더 나쁘다 — 2026-08-17 결정). */
    if (SHARED_CH[id]) return base;
    try {
      if (window.Profiles && Profiles.key) {
        var _id = pfId;
        if (!_id) { var pf = Profiles.forCurrentWork(); _id = pf && pf.id; }
        return Profiles.key(base, _id);
      }
    } catch (e) {}
    return base;
  }
  /* ⭐ '이 업종에 직접 써둔 값이 있나' — 배지 판정 전용.
     ⚠️ getChGuide 는 값이 없으면 기본 지침을 돌려주므로 배지에 쓰면 전부 '작성됨'이 된다. */
  function hasChGuide(id, pfId) {
    try { return localStorage.getItem(chGuideKey(id, pfId)) !== null; } catch (e) { return false; }
  }
  function getChGuide(id, pfId) {
    try {
      var v = localStorage.getItem(chGuideKey(id, pfId));
      // 한 번도 저장 안 한 업종이면 기본 지침 — 그 업종에 맞게 치환해서 준다
      if (v === null) {
        var ch = CHANNELS[id];
        var _pf = null;
        try { if (window.Profiles) _pf = pfId ? Profiles.get(pfId) : null; } catch (e2) {}
        return indFill((ch && ch.defGuide) || '', _pf);
      }
      return v || '';
    } catch (e) { return ''; }
  }
  function setChGuide(id, v, pfId) { try { localStorage.setItem(chGuideKey(id, pfId), v || ''); } catch (e) {} }
  ClaudeAI.hasChGuide = hasChGuide;

  /* ═══ ⭐ 2026-08-24 팀 지침 공유 ═══════════════════════════════
     "지침과 가격표도 공유하게 해줘 / 공유 업종의 지침과 가격표는 팀장이 작성하는걸로"(사용자)
     견적 지침이 곧 가격표다. 같은 팀이 같은 현장을 나눠 하는데 사람마다 단가가 다르면
     그게 더 큰 사고라, 팀 업종의 지침은 **팀장이 쓴 것 하나로 통일한다.**

     규칙:
       · 팀장   — 자기가 쓴 지침이 원본이다. 받아 적용하지 않는다(내려주기만).
       · 팀원   — 팀 지침이 우선이다. 내려오면 그대로 맞춘다.
       · 팀원이 팀 업종 지침을 고쳐도 다음 동기화 때 팀 값으로 돌아온다
         → 편집 화면을 아예 잠그고 이유를 적어준다(ai.js 지침 편집).
     ⚠️ 팀에 들기 전에 팀원이 써둔 개인 지침은 **한 번 백업해 둔다**(BK_BASE).
        덮어쓰는 기능이 사용자의 글을 소리 없이 없애는 건 안 된다.
     ⚠️ 업종 무관 채널(일정 분석)은 제외 — 업종별 자산이 아니다.
     ⚠️ 한 번도 안 쓴 채널은 내보내지 않는다. getChGuide 는 비어 있으면 기본 지침을
        돌려주므로, 그대로 올리면 '기본 지침'이 팀 지침으로 굳어버린다. */
  var TG_BASE = 'ac_team_guide_';        // 마지막으로 받은 팀 지침(원문)
  var BK_BASE = 'ac_myguide_bak_';       // 팀 지침이 덮기 전의 내 개인 지침(1회 백업)
  var TG_OWNER = 'ac_team_guide_owner_'; // pfId → 팀 이름 (편집 잠금 표시용)
  function teamGuideKey(id, pfId) { return TG_BASE + chGuideKey(id, pfId); }
  function myGuideBakKey(id, pfId) { return BK_BASE + chGuideKey(id, pfId); }

  ClaudeAI.guideChannelIds = function () {
    return Object.keys(CHANNELS).filter(function (k) { return !SHARED_CH[k]; });
  };
  /* 내보내기 — 그 업종에 **직접 써둔** 지침만 {채널id: 본문} 으로 */
  ClaudeAI.exportGuides = function (pfId) {
    var out = {};
    ClaudeAI.guideChannelIds().forEach(function (id) {
      if (!hasChGuide(id, pfId)) return;
      var v = '';
      try { v = localStorage.getItem(chGuideKey(id, pfId)) || ''; } catch (e) {}
      v = String(v).slice(0, 6000);          // 문서 크기 방어(Firestore 1MB)
      if (v.trim()) out[id] = v;
    });
    return out;
  };
  /* 받아 적용(팀원 전용) — 팀 지침이 이긴다. 반환 {applied} */
  ClaudeAI.importGuides = function (pfId, guides, teamName) {
    var r = { applied: 0 };
    if (!pfId || !guides || typeof guides !== 'object') return r;
    ClaudeAI.guideChannelIds().forEach(function (id) {
      var incoming = guides[id];
      if (typeof incoming !== 'string' || !incoming.trim()) return;
      var k = chGuideKey(id, pfId), tk = teamGuideKey(id, pfId), bk = myGuideBakKey(id, pfId);
      var mine = null, lastTeam = null;
      try { mine = localStorage.getItem(k); lastTeam = localStorage.getItem(tk); } catch (e) {}
      if (mine === incoming) { try { localStorage.setItem(tk, incoming); } catch (e) {} return; }
      try {
        /* 팀 지침이 처음 들어오는데 내가 써둔 개인 지침이 있으면 딱 한 번 백업 */
        if (mine !== null && lastTeam === null && localStorage.getItem(bk) === null) {
          localStorage.setItem(bk, mine);
        }
        localStorage.setItem(k, incoming);
        localStorage.setItem(tk, incoming);
        r.applied++;
      } catch (e) {}
    });
    if (r.applied) { try { localStorage.setItem(TG_OWNER + pfId, String(teamName || '팀')); } catch (e) {} }
    return r;
  };
  /* 이 업종의 지침을 팀장이 관리하는가 — 편집 잠금·안내 문구용. 팀 이름 또는 '' */
  ClaudeAI.teamGuideOwner = function (pfId) {
    try { return localStorage.getItem(TG_OWNER + pfId) || ''; } catch (e) { return ''; }
  };
  /* 팀 지침 관리 해제(팀에서 나가거나 팀장이 공유를 껐을 때) — 지침 본문은 그대로 둔다 */
  ClaudeAI.clearTeamGuideOwner = function (pfId) {
    try { localStorage.removeItem(TG_OWNER + pfId); } catch (e) {}
  };
  /* ⚠️ 팀에서 나갔는데 잠금이 남으면 자기 지침을 영영 못 고친다.
       팀 목록을 받을 때마다 '아직 팀이 관리하는 업종'만 남기고 나머지 잠금을 푼다.
       본문은 건드리지 않는다 — 나갔다고 지침이 사라지면 그게 더 나쁘다. */
  ClaudeAI.reconcileTeamGuideOwners = function (activePfIds) {
    var keep = {};
    (activePfIds || []).forEach(function (id) { if (id) keep[id] = 1; });
    var drop = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(TG_OWNER) === 0 && !keep[k.slice(TG_OWNER.length)]) drop.push(k);
      }
      drop.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
    return drop.length;
  };

  async function generatePost(chId, memo) {
    var ch = CHANNELS[chId] || CHANNELS.naver;
    var meta = currentWorkMeta();
    var images = await collectWorkImages(6);
    var guide = getChGuide(chId);
    var sys = indFill(ch.sys);   // ★ AI 역할 문구도 지금 업종으로 (안 하면 조명 글이 에어컨 쪽으로 끌려간다)
    if (guide) sys += '\n\n[반드시 반영할 지침]\n' + guide;
    var content = [];
    images.forEach(function (im) { content.push({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } }); });
    var ask = '아래 작업 정보' + (memo ? '와 추가 메모' : '') + (images.length ? '와 전/후 사진' : '') + '를 바탕으로 ' + ch.label + ' 글을 작성해줘.\n\n[작업 정보]\n' + meta.text;
    if (memo) ask += '\n\n[추가 메모/강조점]\n' + memo;
    content.push({ type: 'text', text: ask });
    return await callClaude({ model: getBlogModel(), max_tokens: 2200, system: sys, messages: [{ role: 'user', content: content }] });
  }

  // ── 견적 교정 학습 (사용자가 견적서를 고치면 다음 생성에 반영 — 일정 분석과 동일 개념) ──
  var QCORR_LS = 'ai_quote_corrections';
  var QCORR_MAX = 10;   // 견적서는 텍스트가 길어 보관 수 제한
  var QCORR_SHOTS = 3;  // 프롬프트에 넣을 최근 예시 수
  /* ★ 2026-08-16: 견적 교정 학습도 업종별로 분리.
       에어컨 견적을 고친 예시가 조명 견적 생성에 끼어들면 안 된다. */
  function qcorrKey() {
    try {
      if (window.Profiles && Profiles.key) {
        var pf = Profiles.forCurrentWork();
        return Profiles.key(QCORR_LS, pf && pf.id);
      }
    } catch (e) {}
    return QCORR_LS;
  }
  function getQuoteCorrections() {
    try { var a = JSON.parse(localStorage.getItem(qcorrKey()) || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function setQuoteCorrections(a) { try { localStorage.setItem(qcorrKey(), JSON.stringify(a || [])); } catch (e) {} }
  function saveQuoteCorrection(inText, outText) {
    if (learnOff('ai_quote_learn_off')) return;
    try {
      inText = String(inText || '').trim(); outText = String(outText || '').trim();
      if (!inText || !outText) return;
      var list = getQuoteCorrections().filter(function (c) { return c.in !== inText; });
      list.push({ in: inText, out: outText, at: Date.now() });
      if (list.length > QCORR_MAX) list = list.slice(list.length - QCORR_MAX);
      setQuoteCorrections(list);
    } catch (e) {}
  }
  function clearQuoteCorrections() { setQuoteCorrections([]); }
  function buildQuoteFewShot() {
    if (learnOff('ai_quote_learn_off')) return '';
    var list = getQuoteCorrections();
    if (!list.length) return '';
    var recent = list.slice(-QCORR_SHOTS);
    var lines = ['', '[과거 교정 예시 — 아래는 사용자가 최종 확정한 견적서다. 형식·말투·가격 산정 방식을 반드시 이 정답 패턴에 맞춰라]'];
    recent.forEach(function (c) {
      lines.push('--- 고객 요청 ---');
      lines.push(c.in);
      lines.push('--- 확정 견적서 ---');
      lines.push(c.out);
    });
    return lines.join('\n');
  }

  async function generateQuote(request, useWork) {
    var guide = getChGuide('quote');
    var sys = indFill(CHANNELS.quote.sys);   // ★ 견적서도 지금 업종 기준
    if (guide) sys += '\n\n[업체 정보·가격표 등 반드시 반영할 지침]\n' + guide;
    sys += buildQuoteFewShot();
    var ask = '아래 고객 요청에 맞는 견적서를 작성해줘.\n\n[고객 요청]\n' + (request || '(요청 문자 없음 — 아래 작업 정보 기준)');
    if (useWork) {
      try { var meta = currentWorkMeta(); if (meta && meta.text) ask += '\n\n[참고: 열린 작업 정보]\n' + meta.text; } catch (e) {}
    }
    return await callClaude({ model: getBlogModel(), max_tokens: 1500, system: sys, messages: [{ role: 'user', content: [{ type: 'text', text: ask }] }] });
  }

  function copyText(t) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t); return true; }
    } catch (e) {}
    try {
      var ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); return true;
    } catch (e) { return false; }
  }

  function overlayShell(innerHtml, z) {
    var ov = document.createElement('div');
    /* ★ 2026-08-27 뒷 화면이 같이 스크롤되던 문제 (사용자 지적)
         · `ov-lock` : state.js 의 body 스크롤 잠금이 이 클래스를 보고 잠근다.
                       고정 id 모달만 보던 잠금에 동적 오버레이를 태우는 표식이다. **빼지 말 것.**
         · `overscroll-behavior:contain` : 오버레이 안에서 끝까지 스크롤했을 때
                       그 힘이 뒷 화면으로 넘어가는 것(스크롤 체이닝)을 막는 두 번째 방어선.
         ⭐ 앞으로 body 에 직접 붙이는 오버레이를 새로 만들면 `ov-lock` 을 같이 붙일 것. */
    ov.className = 'ov-lock';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:' + (z || 850) + ';display:flex;align-items:flex-start;justify-content:center;padding:48px 16px 16px;-webkit-overflow-scrolling:touch;overflow-y:auto;overscroll-behavior:contain;';
    ov.innerHTML = '<div style="background:var(--sf);border-radius:14px;padding:18px;max-width:460px;width:100%;">' + innerHtml + '</div>';
    document.body.appendChild(ov);
    return ov;
  }

  // ── API 키 설정 다이얼로그 ──
  function openKeyDialog(cb) {
    var ov = overlayShell(
      '<div style="font-size:16px;font-weight:800;margin-bottom:6px;">⚙️ Claude API 키</div>' +
      '<div style="font-size:11px;color:var(--mu);margin-bottom:12px;line-height:1.5;">키는 이 기기에만 저장됩니다(localStorage). platform.claude.com 에서 발급. ⚠️ 공개 배포 전엔 서버 프록시 권장.</div>' +
      '<label style="font-size:12px;color:var(--mu);font-weight:700;">API 키</label>' +
      '<input class="cust-inp" id="aiKeyInp" type="password" placeholder="sk-ant-..." value="' + esc(getKey()) + '" style="width:100%;margin:4px 0 10px;" autocomplete="off">' +
      '<label style="font-size:12px;color:var(--mu);font-weight:700;">모델</label>' +
      '<input class="cust-inp" id="aiModelInp" type="text" value="' + esc(getModel()) + '" style="width:100%;margin:4px 0 14px;" autocomplete="off">' +
      '<div style="display:flex;gap:8px;">' +
        '<button class="btn b-blue" id="aiKeySave" style="flex:1;">저장</button>' +
        '<button class="btn b-ghost" id="aiKeyCancel">취소</button>' +
      '</div>', 860);
    var close = function () { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.getElementById('aiKeyCancel').onclick = close;
    document.getElementById('aiKeySave').onclick = function () {
      setKey(document.getElementById('aiKeyInp').value.trim());
      var md = document.getElementById('aiModelInp').value.trim();
      setModel(md || DEFAULT_MODEL);
      toast('저장되었습니다', 'ok');
      close();
      if (cb) cb();
    };
  }
  ClaudeAI.openKeyDialog = openKeyDialog;

  // ── 문자/캡처 분석 → 일정 추가 ──
  function openSmsToSchedule(presetDate) {
    var imgs = [];  // {media_type, data, thumbUrl}
    var ov = overlayShell(
      '<div style="font-size:16px;font-weight:800;margin-bottom:4px;">📩 문자/캡처 분석 → 일정 추가</div>' +
      '<div style="font-size:12px;color:var(--mu);margin-bottom:10px;">문자를 붙여넣거나, 대화 캡처 이미지를 첨부하면 날짜·현장·동호수·연락처 등을 자동 추출합니다. (둘 다 가능)</div>' +
      quotaBadge('sched', 'AI 일정등록') +
      '<textarea class="cust-memo" id="aiSmsText" rows="5" placeholder="예) 내일 오후 2시 행복아파트 101동 502호 벽걸이 2대 청소 010-1234-5678" style="width:100%;"></textarea>' +
      '<input type="file" id="aiImgInput" accept="image/*" multiple style="display:none;">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-top:10px;">' +
        '<button class="btn b-ghost" id="aiImgPick" style="font-size:13px;">📷 캡처 이미지 첨부</button>' +
        '<span style="font-size:11px;color:var(--mu);" id="aiImgCnt"></span>' +
      '</div>' +
      '<div id="aiImgPreview" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;"></div>' +
      '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">' +
        '<button class="btn b-blue" id="aiSmsGo" style="flex:1;">분석</button>' +
        '<button class="btn b-ghost" id="aiSmsGuideBtn">지침 편집</button>' +
        '<button class="btn b-ghost" id="aiSmsCancel">취소</button>' +
      '</div>' +
      '<button class="btn b-ghost" id="aiSmsManual" style="width:100%;margin-top:8px;justify-content:center;">✏️ 수동으로 직접 입력</button>' +
      '<div style="font-size:11px;color:var(--mu);margin-top:12px;text-align:center;line-height:1.8;"><label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;margin-right:8px;"><input type="checkbox" id="aiCorrToggle"> 🧠 학습 사용</label>분석 학습 <b id="aiCorrCnt">' + getCorrections().length + '</b>건 <a href="#" id="aiCorrReset" style="color:var(--mu);margin-left:6px;">초기화</a><br><span style="font-size:10px;opacity:.8;">결과를 고쳐 저장할수록 다음 분석이 정확해집니다 (일정 추가 전용)</span></div>', 855);
    var close = function () { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.getElementById('aiSmsCancel').onclick = close;
    document.getElementById('aiSmsGuideBtn').onclick = function () { openChannelGuideline('schedule'); };
    // 수동 입력: 분석 없이 빈 일정 추가 폼 열기
    document.getElementById('aiSmsManual').onclick = function () {
      close();
      if (typeof window.openQuickWorkAdd === 'function') window.openQuickWorkAdd(presetDate || '');
      else toast('일정 추가 화면을 열 수 없습니다', 'err');
    };
    var _rc = document.getElementById('aiCorrReset');
    if (_rc) _rc.onclick = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      if (!getCorrections().length) { toast('학습된 교정이 없습니다', 'ok'); return; }
      if (confirm('학습된 교정 데이터를 모두 지울까요?')) {
        clearCorrections();
        var c = document.getElementById('aiCorrCnt'); if (c) c.textContent = '0';
        toast('학습 데이터를 초기화했습니다', 'ok');
      }
    };
    var _ct = document.getElementById('aiCorrToggle');
    if (_ct) { _ct.checked = !learnOff('ai_schedule_learn_off'); _ct.onchange = function () { setLearnOff('ai_schedule_learn_off', !_ct.checked); toast(_ct.checked ? '학습 사용 켜짐' : '학습 사용 꺼짐', 'ok'); }; }

    var fileInput = document.getElementById('aiImgInput');
    document.getElementById('aiImgPick').onclick = function () { fileInput.click(); };
    function renderPreview() {
      var box = document.getElementById('aiImgPreview');
      var cnt = document.getElementById('aiImgCnt');
      cnt.textContent = imgs.length ? (imgs.length + '장 첨부됨') : '';
      box.innerHTML = '';
      imgs.forEach(function (im, idx) {
        var wrap = document.createElement('div');
        wrap.style.cssText = 'position:relative;width:64px;height:64px;border-radius:8px;overflow:hidden;border:1px solid var(--bd,#444);';
        wrap.innerHTML = '<img src="' + im.thumbUrl + '" style="width:100%;height:100%;object-fit:cover;">' +
          '<button data-idx="' + idx + '" class="aiImgDel" style="position:absolute;top:0;right:0;background:rgba(0,0,0,.6);color:#fff;border:none;width:20px;height:20px;line-height:20px;cursor:pointer;font-size:13px;">×</button>';
        box.appendChild(wrap);
      });
      box.querySelectorAll('.aiImgDel').forEach(function (b) {
        b.onclick = function () { imgs.splice(parseInt(b.getAttribute('data-idx')), 1); renderPreview(); };
      });
    }
    fileInput.onchange = async function () {
      var files = Array.prototype.slice.call(fileInput.files || []);
      if (!files.length) return;
      if (typeof showOverlay === 'function') showOverlay('이미지 처리 중...');
      try {
        for (var i = 0; i < files.length; i++) {
          if (imgs.length >= 6) { toast('이미지는 최대 6장까지', 'err'); break; }
          var im = await fileToResizedBase64(files[i], 1568, 0.92);  // 문자·일정 캡처는 글자 판독이 중요 → 고해상도·고화질로 전송
          imgs.push(im);
        }
      } catch (e) { toast('이미지 오류: ' + (e && e.message), 'err'); }
      if (typeof hideOverlay === 'function') hideOverlay();
      fileInput.value = '';
      renderPreview();
    };

    document.getElementById('aiSmsGo').onclick = async function () {
      var txt = document.getElementById('aiSmsText').value.trim();
      if (!txt && !imgs.length) { toast('문자 내용을 입력하거나 이미지를 첨부해주세요', 'err'); return; }
      if (window.Subs && !Subs.gateAI('sched')) return;  // ★ 구독: 사용량 확인
      if (typeof showOverlay === 'function') showOverlay('분석 중...');
      try {
        var j = await extractSchedule({ text: txt, images: imgs });
        if (typeof hideOverlay === 'function') hideOverlay();
        close();
        if (typeof window.openQuickWorkAdd === 'function') {
          // 학습 소스: 텍스트 입력이 있으면 그 원문, 없으면(이미지만) AI가 캡처에서 읽어낸 _src 한 줄
          try { j.__aiSource = txt || j._src || ''; } catch (e) {}
          try { delete j._src; } catch (e) {}  // 일정 필드가 아니므로 폼에 넘기지 않음
          window.openQuickWorkAdd(j.date || presetDate || '', j);
        } else {
          toast('일정 추가 화면을 열 수 없습니다', 'err');
        }
      } catch (e) {
        if (typeof hideOverlay === 'function') hideOverlay();
        toast('분석 실패: ' + (e && e.message), 'err');
      }
    };
  }
  ClaudeAI.openSmsToSchedule = openSmsToSchedule;

  /* ── 채널별 글작성 지침 편집 ──
     ★ 2026-08-17 재구성 — 두 번째 인자가 opts 로 바뀌었다.
         openChannelGuideline('naver', { profileId: 'pf_ab', onSave: fn })
       ⚠️ 옛 호출부는 콜백 함수를 그대로 넘긴다 → 함수면 { onSave } 로 감싸서 받는다.

       profileId 를 넘기면 **그 업종의 칸**을 연다(설정·업종 상세).
       생략하면 예전처럼 지금 열린 작업의 업종(글쓰기 화면). 여기서 축이 갈린다. */
  function openChannelGuideline(chId, opts) {
    var ch = CHANNELS[chId] || CHANNELS.naver;
    chId = CHANNELS[chId] ? chId : 'naver';
    if (typeof opts === 'function') opts = { onSave: opts };
    opts = opts || {};
    var pfId   = opts.profileId || '';
    var shared = !!SHARED_CH[chId];          // 업종 무관 채널은 업종 칩을 안 붙인다

    var pf = null;
    try {
      if (window.Profiles && !shared) pf = pfId ? Profiles.get(pfId) : Profiles.forCurrentWork();
    } catch (e) {}

    /* ⭐ 이 시트가 '어느 업종의 칸'인지 항상 보이게 한다 — 이게 없어서 헷갈렸다(2026-08-17 사용자 보고) */
    var indChip = '';
    try {
      if (pf) {
        indChip = '<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:800;' +
          'background:var(--sf2);color:var(--tx);padding:4px 10px;border-radius:999px;">' +
          Profiles.iconHtml(pf, 13) + '<span>' + esc(pf.name || '업종') + '</span></span>' +
          '<span style="color:var(--mu);font-size:12px;">›</span>';
      }
    } catch (e) {}

    /* ⭐ 2026-08-24 — 팀장이 관리하는 업종이면 팀원 쪽에서는 읽기 전용이다.
         고칠 수 있게 두면 고쳐놓고 다음 동기화 때 팀 값으로 돌아와 '저장이 안 된다'로 보인다.
         (팀장 폰에서는 자기가 원본이라 teamGuideOwner 가 비어 있어 평소대로 편집된다) */
    var _teamOwner = '';
    try { if (pf && !shared) _teamOwner = ClaudeAI.teamGuideOwner(pf.id) || ''; } catch (e) {}
    var _locked = !!_teamOwner;

    function stateHtml() {
      if (_locked) return '<span style="color:var(--ac);">🔒 ' + esc(_teamOwner) + ' 팀장이 관리하는 지침입니다</span>';
      var saved = hasChGuide(chId, pfId);
      if (saved) return '<span style="color:var(--ac);">● 저장된 지침을 쓰는 중</span>';
      return '<span style="color:var(--mu);">○ 아직 없음' + (ch.defGuide ? ' — 기본 지침을 쓰는 중' : '') + '</span>';
    }
    var scopeTxt = shared
      ? '이 지침은 <b>모든 업종에 공통</b>으로 적용됩니다.'
      : (pf ? '이 지침은 <b>' + esc(pf.name || '업종') + '</b> 업종에만 적용됩니다.' : '');

    var ov = overlayShell(
      '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px;">' + indChip +
        '<span style="font-size:16px;font-weight:800;display:inline-flex;align-items:center;gap:6px;">' +
        chIcon(chId, 18) + '<span>' + ch.label + ' 작성 지침</span></span></div>' +
      '<div style="font-size:11px;color:var(--mu);margin-bottom:10px;line-height:1.5;">' +
        (scopeTxt ? scopeTxt + '<br>' : '') +
        (_locked
          ? '이 업종은 <b>팀 업종</b>이라 지침·가격표를 <b>팀장이 작성</b>합니다. 팀장이 고치면 자동으로 따라옵니다.'
          : '여기에 적은 지침이 ' + ch.label + ' 작성 때마다 반영됩니다. (말투, 길이, 가격표, 업체/연락처, 해시태그 등)') + '</div>' +
      '<textarea class="cust-memo" id="aiGuide" rows="8"' + (_locked ? ' readonly' : '') +
        ' placeholder="' + esc(indFill(ch.guidePh, pf)) + '" style="width:100%;' +
        (_locked ? 'opacity:.75;' : '') + '">' + esc(getChGuide(chId, pfId)) + '</textarea>' +
      '<div id="aiGuideState" style="font-size:11px;font-weight:700;margin-top:7px;">' + stateHtml() + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">' +
        (_locked ? '' : '<button class="btn b-blue" id="aiGuideSave" style="flex:1;">저장</button>') +
        (!_locked && ch.defGuide ? '<button class="btn b-ghost" id="aiGuideDefault">기본 지침</button>' : '') +
        '<button class="btn b-ghost" id="aiGuideCancel" style="flex:1;">' + (_locked ? '닫기' : '취소') + '</button>' +
      '</div>', opts.z || 862);
    /* ⚠️ z 를 받는 이유: 업종 상세 시트(Z_EDIT=1908) 위에서 열리면
         기본값 862 로는 **아래에 깔려** 화면에 안 보인다. */
    var close = function () { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.getElementById('aiGuideCancel').onclick = close;
    var _defBtn = document.getElementById('aiGuideDefault');
    if (_defBtn) _defBtn.onclick = function () {
      if (!confirm('기본 지침으로 되돌릴까요? (현재 적힌 내용은 지워집니다)')) return;
      document.getElementById('aiGuide').value = indFill(ch.defGuide, pf);
      toast('기본 지침을 불러왔습니다 — 저장을 누르면 적용됩니다', 'ok');
    };
    var _saveBtn = document.getElementById('aiGuideSave');
    if (_saveBtn) _saveBtn.onclick = function () {
      setChGuide(chId, document.getElementById('aiGuide').value, pfId);
      toast('지침이 저장되었습니다', 'ok');
      /* ★ 2026-08-24 팀 업종이면 팀원에게도 바로 내려보낸다(내가 팀장일 때만 동작한다).
           await 하지 않는다 — 저장은 로컬에서 이미 끝났고, 네트워크 때문에 창이 붙잡히면 안 된다. */
      try {
        var _rp = pfId || (pf && pf.id);
        if (_rp && !shared && window.CloudTeams && CloudTeams.refreshIndustryGuides) {
          CloudTeams.refreshIndustryGuides(_rp);
        }
      } catch (e) {}
      close();
      if (typeof opts.onSave === 'function') opts.onSave();
    };
  }
  ClaudeAI.openChannelGuideline = openChannelGuideline;
  ClaudeAI.openBlogGuideline = function (cb) { openChannelGuideline('naver', cb); };

  /* ★ 2026-08-08 버그수정 — 저장한 글이 작업을 다시 열면 사라지던 문제
       원인: savePostToWork 가 sessionAutoSave() 만 불렀는데, 이건 IndexedDB의 '현재 세션 스냅샷'에만 쓴다.
             작업 폴더의 _session.json 에는 안 써서, 다른 작업을 열면 workPosts 가 그 작업 값으로 덮이고
             원래 작업으로 돌아오면 디스크에서 읽어오는데 거기엔 글이 없어 사라져 보였다.
             (스케줄 목록에는 클라우드로 올라간 글 정보가 남아 '있다고 표시'만 되던 것)
       수정: 글 저장/삭제 때마다 작업 폴더의 _session.json 에 posts/postMemo 를 즉시 반영한다.
             사진은 건드리지 않고 JSON만 다시 쓰므로 가볍다. */
  async function persistPostsToFolder() {
    // ★ 쓰기 시점이 아니라 '호출 시점'의 값을 찍어둔다.
    //   이 함수는 await 로 잠깐 멈추는데, 그 사이 사용자가 다른 작업을 열면
    //   전역 workPosts/currentFolderName 이 바뀌어 엉뚱한 폴더에 엉뚱한 글(또는 빈 배열)을 쓸 수 있다.
    var folder = (typeof currentFolderName !== 'undefined') ? currentFolderName : '';
    var postsSnapshot = (typeof workPosts !== 'undefined' && Array.isArray(workPosts))
      ? JSON.parse(JSON.stringify(workPosts)) : [];
    var memoSnapshot = (typeof workPostMemo !== 'undefined') ? String(workPostMemo || '') : '';
    try {
      if (typeof photoFolderHandle === 'undefined' || !photoFolderHandle) return false;
      if (!folder) { console.log('[글작성] 아직 저장 전 작업 → 폴더 반영 보류(작업 저장 시 함께 기록됨)'); return false; }
      if (typeof requestFolderPermissionSafe === 'function') { try { await requestFolderPermissionSafe('readwrite'); } catch (e) {} }
      var dir = await photoFolderHandle.getDirectoryHandle(folder);
      var sess;
      try {
        var fh = await dir.getFileHandle('_session.json');
        sess = JSON.parse(await (await fh.getFile()).text()) || {};
      } catch (e) { console.warn('[글작성] _session.json 없음 → 폴더 반영 건너뜀:', folder); return false; }
      sess.posts = postsSnapshot;
      sess.postMemo = memoSnapshot;
      var wh = await dir.getFileHandle('_session.json', { create: true });
      var wr = await wh.createWritable();
      await wr.write(new Blob([JSON.stringify(sess, null, 2)], { type: 'application/json' }));
      await wr.close();
      console.log('[글작성] 작업 폴더에 글 반영:', folder, postsSnapshot.length + '건');
      return true;
    } catch (e) {
      console.warn('[글작성] 작업 폴더 반영 실패:', folder, e && (e.message || e));
      return false;
    }
  }
  ClaudeAI.persistPostsToFolder = persistPostsToFolder;

  // ── 생성된 글을 현재 작업에 저장 (세션 + 폴더 _session.json에 posts로 보존) ──
  function savePostToWork(chId, text, postId) {
    if (typeof workPosts === 'undefined') return null;
    text = String(text || '');
    if (!text.trim()) return null;
    try {
      var now = Date.now();
      if (postId) {
        for (var i = 0; i < workPosts.length; i++) {
          if (workPosts[i] && workPosts[i].id === postId) { workPosts[i].text = text; workPosts[i].at = now; break; }
        }
      } else {
        postId = 'p' + now + Math.random().toString(36).slice(2, 6);
        workPosts.push({ id: postId, ch: chId || 'naver', text: text, at: now });
        if (workPosts.length > 50) workPosts = workPosts.slice(workPosts.length - 50);
      }
      if (typeof sessionAutoSave === 'function') sessionAutoSave();
      persistPostsToFolder();   // ★ 디스크에도 즉시 반영 (작업 다시 열어도 남아있게)
      /* ★ 2026-08-16 버그수정 — 공유작업자가 쓴 글이 통째로 사라지던 문제
           공유작업(빌려보기)은 currentFolderName 이 null 이라 위의 persistPostsToFolder 가
           "아직 저장 전 작업"으로 보고 그냥 빠져나간다. 즉 남는 곳이 임시 세션뿐이라
           다른 작업을 열면 resetWorkGlobals() 로 글이 사라졌다.
           → 클라우드 posts 서브컬렉션에 즉시 올린다. 이게 공유작업자 글의 유일한 보관처이며,
             동시에 내 작업 글을 상대에게 전달하는 통로이기도 하다. */
      try {
        var _p = null;
        for (var k = 0; k < workPosts.length; k++) { if (workPosts[k] && workPosts[k].id === postId) { _p = workPosts[k]; break; } }
        if (_p && window.CloudPhotoSync && CloudPhotoSync.pushPost) CloudPhotoSync.pushPost(_p);
      } catch (e2) {}
      return postId;
    } catch (e) { return null; }
  }
  // 현재 작업에 전/후 사진이 있는지 (저장된 글은 실제 작업 기반 글만 보관)
  function hasPhotosInWork() {
    try {
      if (typeof units === 'undefined' || !units || !units.length) return false;
      return units.some(function (u) {
        if (((u.before || []).length + (u.after || []).length) > 0) return true;
        return (u.specials || []).some(function (sp) { return (sp.photos || []).length > 0; });
      });
    } catch (e) { return false; }
  }
  function deletePostFromWork(postId) {
    if (typeof workPosts === 'undefined') return;
    try {
      workPosts = workPosts.filter(function (x) { return x && x.id !== postId; });
      if (typeof sessionAutoSave === 'function') sessionAutoSave();
      persistPostsToFolder();   // ★ 삭제도 디스크에 반영(안 하면 다시 열 때 되살아남)
      /* ★ 2026-08-16: 클라우드에도 '묘비'를 남긴다(하드삭제 아님).
           하드삭제하면 상대 폰 로컬에 남아 있던 같은 글이 다음 동기화 때
           "클라우드에 없는 글"로 판정돼 되살아난다.
           권한(소유자 또는 작성자 본인)은 Firestore 규칙이 판정 — 거부되면 조용히 넘어간다. */
      try {
        if (window.CloudPhotoSync && CloudPhotoSync.deleteCloudPost) CloudPhotoSync.deleteCloudPost(postId);
      } catch (e2) {}
    } catch (e) {}
  }

  // ── 마크다운 기호 제거 (네이버 등 일반 에디터 붙여넣기용) ──
  function stripMarkdown(t) {
    return String(t || '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '• ')
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
      .replace(/^\s*-{3,}\s*$/gm, '');
  }

  // ── 블로그 결과 뷰어 ──
  function showBlogResult(text, chId, postId, learnCtx) {
    var ch = CHANNELS[chId] || CHANNELS.naver;
    var isQuote = (chId === 'quote');
    /* ★ 2026-08-08 개선
         · 글이 잘 안 보여 스크롤해야 했던 문제 → 본문 높이를 화면 크기에 맞춰 최대한 키운다.
         · 버튼 정리: 저장/공유 제거. 저장은 '닫으면 자동 저장'으로 대체(무조건 작업에 귀속),
           공유는 복사와 사실상 같은 기능이라 뺀다. → 전체복사 / 서식없이 복사 / 닫기 3개만.
           버튼 줄이 하나 줄어든 만큼도 본문 높이로 돌아간다. */
    /* ★ 2026-08-26 글+사진을 한 번에 올리는 버튼. 문자·견적서는 사진 보낼 곳이 없어 제외.
         · 📱 모바일 = 글은 클립보드, 사진은 OS 공유 시트 → 폰의 해당 앱 글쓰기 화면이 열린다 (앱 전용)
         · 💻 PC     = 글+사진을 한 페이지로 올려 주소 발급 → PC 에서 통째로 붙여넣기
       ⭐ 문구는 '무엇을 하는지 + 어디에 쓰는지'가 다 들어가야 한다 —
          '사진과 함께 / PC 링크'로는 뭔지 모르겠다는 지적을 받았다(2026-08-26 사용자).
       ⭐ PC 버튼은 네이버 블로그에서만 띄운다. PC 링크의 가치는 스마트에디터에 사진까지
          한 번에 붙여넣는 것이라, 인스타·당근에는 있어도 안 쓰게 된다.
       ⚠️ 버튼 줄을 넣으면 본문 textarea 높이를 그만큼 줄여야 한다 — 안 그러면 팝업이 화면을 넘어
          아래 복사·닫기 버튼이 안 보인다(2026-08-26 실제로 겪음). 아래 _snsOff 가 그 보정값. */
    /* ☠️ 2026-08-27 여기 채널 이름은 위 CHANNELS 의 **키와 정확히 같아야 한다.**
         페이스북을 'fb' 로 적어 둬서 실제 키 'facebook' 과 안 맞았고, 그 결과
         페이스북에서만 올리기 버튼이 조용히 안 떴다(사용자 지적). 줄임말을 쓰지 말 것. */
    var _snsCh = (['naver', 'carrot', 'insta', 'facebook'].indexOf(chId) >= 0);
    var _snsMo = !!(_snsCh && window.SnsShare && SnsShare.available());
    var _snsPc = !!(chId === 'naver' && window.SnsShare && SnsShare.openPc);
    var _snsMoLabel = (chId === 'naver') ? '📱 모바일 블로그에 올리기'
                    : (chId === 'insta') ? '📱 인스타그램에 올리기'
                    : (chId === 'facebook') ? '📱 페이스북에 올리기'
                    :                      '📱 당근에 올리기';
    /* ★ 2026-08-26 버튼 아래 작은 안내줄은 제거했다 —
         "잘 보이지도 않고 의미도 부정확하다"(사용자). 설명은 버튼 문구로 끝낸다. */
    var _snsOff = 230 + ((_snsMo ? 1 : 0) + (_snsPc ? 1 : 0)) * 54;
    var snsRow = (_snsMo || _snsPc)
      ? ((_snsMo ? '<button class="btn b-blue" id="aiBlogSns" style="width:100%;justify-content:center;margin-top:10px;">' + _snsMoLabel + '</button>' : '') +
         (_snsPc ? '<button class="btn b-blue" id="aiBlogSnsPc" style="width:100%;justify-content:center;margin-top:10px;">💻 PC 블로그에 올리기</button>' : ''))
      : '';
    var ov = overlayShell(
      '<div style="font-size:16px;font-weight:800;margin-bottom:6px;display:flex;align-items:center;gap:6px;">' + chIcon(chId, 18) + '<span>' + ch.label + ' 초안</span></div>' +
      '<div style="font-size:11px;color:var(--mu);margin-bottom:6px;">' + ch.copyHint +
        (isQuote ? '' : ' 닫으면 현재 작업에 자동 저장되어 <b>📂 저장된 글</b>에서 다시 열 수 있어요.') +
        (isQuote && learnCtx ? ' 내용을 고쳐서 복사하면 다음 견적서에 그 방식이 반영됩니다. 🧠' : '') + '</div>' +
      '<textarea class="cust-memo" id="aiBlogOut" rows="14" style="width:100%;font-size:13px;line-height:1.6;' +
        'height:calc(100vh - ' + _snsOff + 'px);min-height:180px;box-sizing:border-box;resize:none;">' + esc(text) + '</textarea>' +
      snsRow +
      '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">' +
        '<button class="btn b-blue" id="aiBlogCopy" style="flex:2;min-width:110px;">📋 전체 복사</button>' +
        '<button class="btn b-ghost" id="aiBlogCopyPlain" style="flex:2;min-width:110px;">서식 없이 복사</button>' +
        '<button class="btn b-ghost" id="aiBlogClose" style="flex:1;min-width:64px;">닫기</button>' +
      '</div>', 858);
    // 결과 화면은 본문이 주인공 → 오버레이 위쪽 여백을 줄여 그만큼 글에 준다
    try { ov.style.paddingTop = '14px'; ov.style.paddingBottom = '14px'; } catch (e) {}
    // 견적 교정 학습: 사용자가 고친 견적서를 복사/공유/닫기 시점에 정답으로 저장
    function maybeLearnQuote() {
      if (!isQuote || !learnCtx || !learnCtx.request) return;
      try {
        var cur = document.getElementById('aiBlogOut').value;
        if (cur.trim() && cur !== learnCtx.aiText) {
          saveQuoteCorrection(learnCtx.request, cur);
          learnCtx.aiText = cur;  // 같은 내용 중복 저장 방지
          toast('🧠 수정 내용을 학습했습니다 — 다음 견적서에 반영됩니다', 'ok');
        }
      } catch (e) {}
    }
    // ★ 닫기 = 현재 작업에 자동 저장 (견적서는 일회성이라 제외)
    var close = function () {
      maybeLearnQuote();
      if (!isQuote) {
        try {
          var v = (document.getElementById('aiBlogOut') || {}).value || '';
          if (v.trim()) {
            var pid = savePostToWork(chId || 'naver', v, postId);
            if (pid) {
              postId = pid;
              // 아직 폴더에 저장된 적 없는 새 작업이면 디스크에 못 넣으므로 그 사실을 알려준다
              var noFolder = (typeof currentFolderName === 'undefined' || !currentFolderName);
              toast(noFolder ? '글을 임시 보관했어요 — 작업을 저장하면 함께 보관됩니다' : '📂 저장된 글에 보관했습니다', 'ok');
            }
          }
        } catch (e) {}
      }
      if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    };
    document.getElementById('aiBlogClose').onclick = close;
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });   // 바깥 탭해서 닫아도 저장되게
    function doCopy(v) {
      var ta = document.getElementById('aiBlogOut');
      try { ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length); } catch (e) {}
      var ok = copyText(v);
      toast(ok ? '전체 복사되었습니다' : '복사 실패(텍스트를 길게 눌러 복사)', ok ? 'ok' : 'err');
    }
    document.getElementById('aiBlogCopy').onclick = function () { maybeLearnQuote(); doCopy(document.getElementById('aiBlogOut').value); };
    var _snsp = document.getElementById('aiBlogSnsPc');
    if (_snsp) _snsp.onclick = function () {
      SnsShare.openPc(chId, document.getElementById('aiBlogOut').value);
    };
    var _sns = document.getElementById('aiBlogSns');
    if (_sns) _sns.onclick = function () {
      /* 화면에서 고친 내용을 그대로 보낸다 — 원본 text 가 아니라 textarea 값 */
      SnsShare.open(chId, document.getElementById('aiBlogOut').value);
    };
    document.getElementById('aiBlogCopyPlain').onclick = function () {
      maybeLearnQuote();  // 서식 제거 전, 사용자가 고친 상태를 먼저 학습
      var plain = stripMarkdown(document.getElementById('aiBlogOut').value);
      document.getElementById('aiBlogOut').value = plain;
      if (learnCtx) learnCtx.aiText = plain;  // 서식 제거는 사용자 교정이 아님
      doCopy(plain);
    };
  }

  // ── 채널별 글 작성 다이얼로그 ──
  function openChannelWriter(chId) {
    var ch = CHANNELS[chId] || CHANNELS.naver;
    chId = CHANNELS[chId] ? chId : 'naver';
    var hasWork = false;
    try { hasWork = (typeof units !== 'undefined' && units && units.length > 0); } catch (e) {}
    var apt = (document.getElementById('aptName') && document.getElementById('aptName').value) || '';
    var ov = overlayShell(
      '<div style="font-size:16px;font-weight:800;margin-bottom:4px;display:flex;align-items:center;gap:6px;">' + chIcon(chId, 18) + '<span>' + ch.label + ' 글 작성</span></div>' +
      (hasWork
        ? '<div style="font-size:12px;color:var(--mu);margin-bottom:10px;">대상 작업: <b>' + (esc(apt) || '(작업명 미입력)') + '</b> · 작업탭에 열린 작업의 내용·사진으로 작성합니다.</div>'
        : '<div style="font-size:12px;color:#e06;margin-bottom:10px;">작업탭에 열린 작업이 없습니다. 달력에서 작업을 <b>열기</b>한 뒤 다시 시도하세요.</div>') +
      quotaBadge('blog', 'AI 글작성') +
      '<label style="font-size:12px;color:var(--mu);font-weight:700;">추가 메모 / 강조하고 싶은 점 (선택)</label>' +
      '<textarea class="cust-memo" id="aiBlogMemo" rows="3" placeholder="예) 곰팡이 심했던 점, 알러지 가족이라 항균 강조" style="width:100%;margin-top:4px;">' + esc((typeof workPostMemo !== 'undefined' && workPostMemo) ? workPostMemo : '') + '</textarea>' +
      ((typeof workPostMemo !== 'undefined' && workPostMemo) ? '<div style="font-size:11px;color:var(--mu);margin-top:4px;">이전에 입력한 참고사항이 자동으로 채워졌어요. 필요하면 수정하세요.</div>' : '') +
      '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">' +
        '<button class="btn b-blue" id="aiBlogGo" style="flex:1;"' + (hasWork ? '' : ' disabled') + '>글 생성</button>' +
        '<button class="btn b-ghost" id="aiBlogGuide">지침 편집</button>' +
        '<button class="btn b-ghost" id="aiBlogCancel">취소</button>' +
      '</div>', 856);
    var close = function () { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.getElementById('aiBlogCancel').onclick = close;
    document.getElementById('aiBlogGuide').onclick = function () { openChannelGuideline(chId); };
    document.getElementById('aiBlogGo').onclick = async function () {
      if (!hasWork) { toast('작업탭에서 작업을 먼저 열어주세요', 'err'); return; }
      if (window.Subs && !Subs.gateAI('blog')) return;  // ★ 구독: 사용량 확인
      var memo = document.getElementById('aiBlogMemo').value.trim();
      // ★ 참고메모 기억: 다음 글작성(다른 채널)에서 자동으로 다시 채워짐
      try { workPostMemo = memo; if (typeof sessionAutoSave === 'function') sessionAutoSave(); } catch (e) {}
      if (typeof showOverlay === 'function') showOverlay(ch.label + ' 글 생성 중...');
      try {
        var t = await generatePost(chId, memo);
        try { if (window.Subs) Subs.consumeAI('blog'); } catch (e) {}  // ★ 구독: 1회 차감
        if (typeof hideOverlay === 'function') hideOverlay();
        close();
        var pid = hasPhotosInWork() ? savePostToWork(chId, t) : null;
        showBlogResult(t, chId, pid);
      } catch (e) {
        if (typeof hideOverlay === 'function') hideOverlay();
        toast('생성 실패: ' + (e && e.message), 'err');
      }
    };
  }
  ClaudeAI.openChannelWriter = openChannelWriter;
  function openBlogWriter() { openChannelWriter('naver'); }
  ClaudeAI.openBlogWriter = openBlogWriter;
  window.openBlogWriter = openBlogWriter;

  // ── 견적서 작성 다이얼로그 (문자 붙여넣기 + 캡처 이미지 첨부) ──
  function openQuoteWriter() {
    var hasWork = false;
    try { hasWork = (typeof units !== 'undefined' && units && units.length > 0); } catch (e) {}
    var imgs = [];  // {media_type, data, thumbUrl}
    var ov = overlayShell(
      '<div style="font-size:16px;font-weight:800;margin-bottom:4px;">🧾 문자/캡처 → 견적서 작성</div>' +
      '<div style="font-size:12px;color:var(--mu);margin-bottom:10px;">고객 요청 문자를 붙여넣거나 대화 캡처를 첨부하면, 지침에 적어둔 가격표·업체정보를 참고해 견적서를 만듭니다.</div>' +
      (getChGuide('quote') ? '' : '<div style="font-size:12px;color:#e06;margin:-4px 0 10px;line-height:1.5;">⚠️ 견적 지침(가격표)이 아직 없습니다. 가격을 알아야 견적서를 만들 수 있어요 — 아래 <b>지침 편집</b>에서 가격표·업체명·연락처를 먼저 입력하세요.</div>') +
      quotaBadge('sched', 'AI 견적서(일정등록 횟수 사용)') +
      '<label style="font-size:12px;color:var(--mu);font-weight:700;">고객 요청 / 작업 내용</label>' +
      '<textarea class="cust-memo" id="aiQuoteReq" rows="4" placeholder="예) 행복아파트 101동 벽걸이 2대, 스탠드 1대 분해청소 견적 부탁드려요" style="width:100%;margin-top:4px;"></textarea>' +
      '<input type="file" id="aiQtImgInput" accept="image/*" multiple style="display:none;">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-top:8px;">' +
        '<button class="btn b-ghost" id="aiQtImgPick" style="font-size:13px;">📷 캡처 이미지 첨부</button>' +
        '<span style="font-size:11px;color:var(--mu);" id="aiQtImgCnt"></span>' +
      '</div>' +
      '<div id="aiQtImgPreview" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;"></div>' +
      (hasWork ? '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--mu);margin-top:8px;cursor:pointer;"><input type="checkbox" id="aiQuoteUseWork" checked> 작업탭에 열린 작업 정보도 함께 반영</label>' : '') +
      '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">' +
        '<button class="btn b-blue" id="aiQuoteGo" style="flex:1;">견적서 생성</button>' +
        '<button class="btn b-ghost" id="aiQuoteGuide">지침 편집</button>' +
        '<button class="btn b-ghost" id="aiQuoteCancel">취소</button>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--mu);margin-top:12px;text-align:center;line-height:1.8;"><label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;margin-right:8px;"><input type="checkbox" id="aiQCorrToggle"> 🧠 학습 사용</label>견적 교정 학습 <b id="aiQCorrCnt">' + getQuoteCorrections().length + '</b>건 <a href="#" id="aiQCorrReset" style="color:var(--mu);margin-left:6px;">초기화</a><br><span style="font-size:10px;opacity:.8;">생성된 견적서를 고쳐서 복사·공유하면 다음 견적서에 반영됩니다</span></div>', 856);
    var close = function () { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.getElementById('aiQuoteCancel').onclick = close;
    document.getElementById('aiQuoteGuide').onclick = function () { openChannelGuideline('quote'); };
    var _qrc = document.getElementById('aiQCorrReset');
    if (_qrc) _qrc.onclick = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      if (!getQuoteCorrections().length) { toast('학습된 교정이 없습니다', 'ok'); return; }
      if (confirm('학습된 견적 교정을 모두 지울까요?')) {
        clearQuoteCorrections();
        var c = document.getElementById('aiQCorrCnt'); if (c) c.textContent = '0';
        toast('견적 학습 데이터를 초기화했습니다', 'ok');
      }
    };
    var _qt = document.getElementById('aiQCorrToggle');
    if (_qt) { _qt.checked = !learnOff('ai_quote_learn_off'); _qt.onchange = function () { setLearnOff('ai_quote_learn_off', !_qt.checked); toast(_qt.checked ? '학습 사용 켜짐' : '학습 사용 꺼짐', 'ok'); }; }
    // 캡처 이미지 첨부 (문자/캡처 분석과 동일 패턴)
    var qtFileInput = document.getElementById('aiQtImgInput');
    document.getElementById('aiQtImgPick').onclick = function () { qtFileInput.click(); };
    function renderQtPreview() {
      var box = document.getElementById('aiQtImgPreview');
      var cnt = document.getElementById('aiQtImgCnt');
      cnt.textContent = imgs.length ? (imgs.length + '장 첨부됨') : '';
      box.innerHTML = '';
      imgs.forEach(function (im, idx) {
        var wrap = document.createElement('div');
        wrap.style.cssText = 'position:relative;width:64px;height:64px;border-radius:8px;overflow:hidden;border:1px solid var(--bd,#444);';
        wrap.innerHTML = '<img src="' + im.thumbUrl + '" style="width:100%;height:100%;object-fit:cover;">' +
          '<button data-idx="' + idx + '" class="aiQtImgDel" style="position:absolute;top:0;right:0;background:rgba(0,0,0,.6);color:#fff;border:none;width:20px;height:20px;line-height:20px;cursor:pointer;font-size:13px;">×</button>';
        box.appendChild(wrap);
      });
      box.querySelectorAll('.aiQtImgDel').forEach(function (b) {
        b.onclick = function () { imgs.splice(parseInt(b.getAttribute('data-idx')), 1); renderQtPreview(); };
      });
    }
    qtFileInput.onchange = async function () {
      var files = Array.prototype.slice.call(qtFileInput.files || []);
      if (!files.length) return;
      if (typeof showOverlay === 'function') showOverlay('이미지 처리 중...');
      try {
        for (var i = 0; i < files.length; i++) {
          if (imgs.length >= 6) { toast('이미지는 최대 6장까지', 'err'); break; }
          var im = await fileToResizedBase64(files[i], 1568, 0.92);
          imgs.push(im);
        }
      } catch (e) { toast('이미지 오류: ' + (e && e.message), 'err'); }
      if (typeof hideOverlay === 'function') hideOverlay();
      qtFileInput.value = '';
      renderQtPreview();
    };
    document.getElementById('aiQuoteGo').onclick = async function () {
      var req = document.getElementById('aiQuoteReq').value.trim();
      var useEl = document.getElementById('aiQuoteUseWork');
      var useWork = !!(useEl && useEl.checked);
      if (!req && !imgs.length && !useWork) { toast('고객 요청 내용을 입력하거나 캡처를 첨부해주세요', 'err'); return; }
      if (window.Subs && !Subs.gateAI('sched')) return;  // ★ 구독: 견적서(문자용)은 일정등록 횟수 차감
      if (typeof showOverlay === 'function') showOverlay('견적서 생성 중...');
      try {
        // 캡처가 있으면 먼저 글자만 정확히 전사(OCR) 후 요청 텍스트에 합침
        if (imgs.length) {
          var ocr = '';
          try { ocr = await transcribeImages(imgs); } catch (e) { ocr = ''; }
          if (ocr) req = [req, '[캡처에서 읽은 내용]', ocr].filter(Boolean).join('\n');
          else if (!req && !useWork) throw new Error('캡처에서 글자를 읽지 못했습니다');
        }
        var t = await generateQuote(req, useWork);
        try { if (window.Subs) Subs.consumeAI('sched'); } catch (e) {}  // ★ 구독: 일정등록 1회 차감
        if (typeof hideOverlay === 'function') hideOverlay();
        close();
        // 견적서는 작업에 저장하지 않음(의뢰 전 일회성) — 대신 사용자가 고치면 교정 학습
        showBlogResult(t, 'quote', null, { request: req || '(열린 작업 정보 기준)', aiText: t });
      } catch (e) {
        if (typeof hideOverlay === 'function') hideOverlay();
        toast('생성 실패: ' + (e && e.message), 'err');
      }
    };
  }
  ClaudeAI.openQuoteWriter = openQuoteWriter;
  window.openQuoteWriter = openQuoteWriter;

  /* ── 사업자등록증 이미지 분석 + 학습 (견적서/거래명세서 공급받는자 자동입력) ── */
  var BIZCORR_LS = 'ac_bizcert_corrections';
  function getBizCorr() { try { var a = JSON.parse(localStorage.getItem(BIZCORR_LS) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function saveBizCorr(rawText, fixedObj) {
    if (learnOff('ac_docs_learn_off')) return;
    try {
      rawText = String(rawText || '').trim();
      if (!rawText) return;
      var list = getBizCorr().filter(function (c) { return c.in !== rawText; });
      list.push({ in: rawText, out: fixedObj, at: Date.now() });
      if (list.length > 8) list = list.slice(list.length - 8);
      localStorage.setItem(BIZCORR_LS, JSON.stringify(list));
    } catch (e) {}
  }
  function clearBizCorr() { try { localStorage.setItem(BIZCORR_LS, '[]'); } catch (e) {} }
  function bizFewShot() {
    if (learnOff('ac_docs_learn_off')) return '';
    var list = getBizCorr(); if (!list.length) return '';
    var lines = ['', '[과거 교정 예시 — 사용자가 최종 확정한 정답이다. 같은 방식으로 정확히 추출하라]'];
    list.slice(-3).forEach(function (c) { lines.push('확정 결과: ' + JSON.stringify(c.out)); });
    return lines.join('\n');
  }
  async function analyzeBizCert(images) {
    var sys = '너는 한국 사업자등록증(사업자등록 이미지)에서 정보를 정확히 읽어 JSON 하나만 출력하는 도우미다. 설명·마크다운 금지, JSON만 출력. '
      + '키: {"bizNo":"등록번호 000-00-00000","name":"상호(법인명)","ceo":"대표자 성명","addr":"사업장 소재지 주소","bizType":"업태","bizItem":"종목","tel":"전화(있으면)"}. 읽을 수 없는 값은 빈 문자열로.'
      + bizFewShot();
    var content = [{ type: 'text', text: '이 사업자등록증에서 정보를 위 JSON 형식으로 추출해줘.' }];
    images.forEach(function (im) { content.push({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } }); });
    var t = await callClaude({ model: getModel(), max_tokens: 700, system: sys, messages: [{ role: 'user', content: content }] });
    try { var m = String(t || '').match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); } catch (e) {}
    return null;
  }
  ClaudeAI.analyzeBizCert = analyzeBizCert;
  ClaudeAI.fileToResizedBase64 = fileToResizedBase64;
  ClaudeAI.saveBizCorr = saveBizCorr;
  ClaudeAI.getBizCorr = getBizCorr;
  ClaudeAI.clearBizCorr = clearBizCorr;

  // ── 📂 저장된 글 목록 (현재 작업에 저장된 글) ──
  function openSavedPosts() {
    // 견적서는 작업 귀속 대상이 아님 — 과거 버전에서 저장된 견적서는 정리
    try {
      if (typeof workPosts !== 'undefined' && Array.isArray(workPosts) && workPosts.some(function (x) { return x && x.ch === 'quote'; })) {
        workPosts = workPosts.filter(function (x) { return x && x.ch !== 'quote'; });
        if (typeof sessionAutoSave === 'function') sessionAutoSave();
      }
    } catch (e) {}
    var posts = (typeof workPosts !== 'undefined' && Array.isArray(workPosts)) ? workPosts.slice().reverse() : [];
    var apt = (document.getElementById('aptName') && document.getElementById('aptName').value) || '';
    function fmtDate(t) {
      try {
        var d = new Date(t || 0);
        return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      } catch (e) { return ''; }
    }
    var rows = posts.map(function (px) {
      var ch = CHANNELS[px.ch] || CHANNELS.naver;
      var first = String(px.text || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean)[0] || '';
      if (first.length > 34) first = first.slice(0, 34) + '…';
      return '<div class="aiPostRow" data-id="' + px.id + '" style="display:flex;align-items:center;gap:8px;padding:10px 6px;border-bottom:1px solid rgba(128,128,128,.18);cursor:pointer;">' +
        '<span style="display:inline-flex;">' + chIcon(px.ch || 'naver', 20) + '</span>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:13px;font-weight:700;">' + ch.label + ' <span style="font-weight:400;color:var(--mu);font-size:11px;">' + fmtDate(px.at) + '</span></div>' +
          '<div style="font-size:12px;color:var(--mu);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(first) + '</div>' +
        '</div>' +
        '<button class="aiPostDel" data-id="' + px.id + '" style="background:none;border:none;color:var(--mu);font-size:15px;cursor:pointer;padding:6px;">🗑️</button>' +
      '</div>';
    }).join('');
    var ov = overlayShell(
      '<div style="font-size:16px;font-weight:800;margin-bottom:4px;">📂 저장된 글</div>' +
      '<div style="font-size:12px;color:var(--mu);margin-bottom:8px;">현재 작업' + (apt ? ' <b>' + esc(apt) + '</b>' : '') + '에 저장된 글입니다. 눌러서 다시 열어보세요.</div>' +
      (rows || '<div style="font-size:13px;color:var(--mu);padding:20px 0;text-align:center;line-height:1.6;">저장된 글이 없습니다.<br>글을 생성하면 자동으로 여기에 저장됩니다.</div>') +
      '<button class="btn b-ghost" id="aiPostsClose" style="width:100%;margin-top:12px;justify-content:center;">닫기</button>', 855);
    var close = function () { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.getElementById('aiPostsClose').onclick = close;
    ov.querySelectorAll('.aiPostDel').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        if (!confirm('이 글을 삭제할까요?')) return;
        deletePostFromWork(b.getAttribute('data-id'));
        close();
        openSavedPosts();
      };
    });
    ov.querySelectorAll('.aiPostRow').forEach(function (r) {
      r.onclick = function () {
        var id = r.getAttribute('data-id');
        var px = null;
        try { px = (workPosts || []).filter(function (x) { return x && x.id === id; })[0]; } catch (e) {}
        if (!px) return;
        close();
        showBlogResult(px.text, px.ch, px.id);
      };
    });
  }
  ClaudeAI.openSavedPosts = openSavedPosts;
  window.openSavedPosts = openSavedPosts;

  /* ── 작업탭 호수 헤더용: 저장된 글 채널 요약 (2026-08-09) ──
     글이 있는데도 ＋ 버튼을 눌러 들어가야만 보여서 지나치기 쉬웠다.
     호수 헤더에 채널 아이콘을 띄워 바로 알아보고 열 수 있게 한다.
     ※ 글은 '작업' 단위로 저장되므로 첫 호수 헤더에만 표시한다. */
  ClaudeAI.postChannels = function () {
    var out = [];
    try {
      var posts = (typeof workPosts !== 'undefined' && Array.isArray(workPosts)) ? workPosts : [];
      var by = {};
      posts.forEach(function (p2) {
        if (!p2 || !p2.text) return;
        var c = p2.ch || 'naver';
        if (c === 'quote') return;                 // 견적서는 작업 귀속 대상이 아님
        if (!by[c]) by[c] = { ch: c, count: 0, latest: null, at: 0 };
        by[c].count++;
        if ((p2.at || 0) >= by[c].at) { by[c].at = p2.at || 0; by[c].latest = p2.id; }
      });
      Object.keys(by).forEach(function (c) {
        var meta = CHANNELS[c] || CHANNELS.naver;
        out.push({ ch: c, icon: meta.icon, iconHtml: chIcon(c, 16), label: meta.label, count: by[c].count, latest: by[c].latest });
      });
      out.sort(function (a, b) { return a.ch < b.ch ? -1 : 1; });
    } catch (e) {}
    return out;
  };

  // 해당 채널의 가장 최근 글을 바로 연다
  ClaudeAI.openPostByChannel = function (chId) {
    var posts = [];
    try { posts = (typeof workPosts !== 'undefined' && Array.isArray(workPosts)) ? workPosts : []; } catch (e) {}
    var mine = posts.filter(function (p2) { return p2 && p2.text && (p2.ch || 'naver') === chId; });
    if (!mine.length) { if (typeof showToast === 'function') showToast('저장된 글이 없습니다', 'err'); return; }
    mine.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    var px = mine[0];
    showBlogResult(px.text, px.ch, px.id);
  };
  window.openPostByChannel = ClaudeAI.openPostByChannel;

  // ── ✍️ 글작성 하위 메뉴 (달력 ＋ 메뉴와 동일한 스피드다이얼) ──
  // ── AI 잔여횟수 표시 (구독) ──
  function quotaBadge(kind, label) {
    try {
      if (!window.Subs || !Subs.quotaInfo) return '';
      var i = Subs.quotaInfo(kind);
      var ok = i.admin || (i.left + i.coupon + (i.freeLeft || 0)) > 0;   // ★ 2026-08-23 무료 지급분 합산
      var col = ok ? 'var(--ac)' : 'var(--dn,#e05252)';
      return '<div style="font-size:12px;font-weight:700;color:' + col + ';margin:-4px 0 10px;">🧮 ' + label + ' — ' + Subs.quotaText(kind) +
        (ok ? '' : ' · 요금제를 확인해주세요') + '</div>';
    } catch (e) { return ''; }
  }
  function quotaShort(kind) {
    try {
      if (!window.Subs || !Subs.quotaInfo) return '';
      var i = Subs.quotaInfo(kind);
      if (i.admin) return '무제한';
      var t = i.left + '/' + i.base + '회';
      var extra = (i.coupon || 0) + (i.freeLeft || 0);   // ★ 2026-08-23 쿠폰 + 무료 지급분
      if (extra > 0) t += '+' + extra;
      return t;
    } catch (e) { return ''; }
  }

  function openWriteMenu() {
    var exist = document.getElementById('writeMenu');
    if (exist) { exist.remove(); return; }
    var ov = document.createElement('div');
    ov.id = 'writeMenu';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.32);z-index:1530;';
    function item(id, bottom, label, icon, bg) {
      return '<div id="' + id + '" style="position:fixed;right:18px;bottom:' + bottom + 'px;display:flex;align-items:center;gap:10px;cursor:pointer;opacity:0;transform:translateY(10px);transition:opacity .16s ease,transform .16s ease;">' +
        '<span style="background:var(--sf);color:var(--tx);font-size:13px;font-weight:700;padding:8px 13px;border-radius:9px;box-shadow:0 2px 10px rgba(0,0,0,.3);white-space:nowrap;">' + label + '</span>' +
        '<span style="width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;color:#fff;background:' + bg + ';box-shadow:0 4px 14px rgba(0,0,0,.35);">' + icon + '</span>' +
      '</div>';
    }
    var savedCnt = 0;
    try { savedCnt = (typeof workPosts !== 'undefined' && Array.isArray(workPosts)) ? workPosts.length : 0; } catch (e) {}
    ov.innerHTML =
      item('wmFacebook', 358, '페이스북', chIcon('facebook', 26), CHANNELS.facebook.color) +
      item('wmInsta', 414, '인스타그램', chIcon('insta', 26), CHANNELS.insta.color) +
      item('wmDaangn', 470, '당근 소식', chIcon('daangn', 26), CHANNELS.daangn.color) +
      item('wmNaver', 526, '네이버 블로그', chIcon('naver', 26), CHANNELS.naver.color) +
      item('wmStmtXlsx', 302, '거래명세서(엑셀)', '📋', 'linear-gradient(135deg,#3b82f6,#2563eb)') +
      item('wmQuoteSms', 190, '견적서(문자용)', '📱', 'linear-gradient(135deg,#f59e0b,#d97706)') +
      item('wmQuoteXlsx', 246, '견적서(엑셀)', '🧾', 'linear-gradient(135deg,#10b981,#059669)') +
      item('wmSaved', 134, '저장된 글' + (savedCnt ? ' (' + savedCnt + ')' : ''), '📂', 'var(--sf2,#6b7280)');
    var _qs = quotaShort('sched'), _qb = quotaShort('blog');
    if (_qs || _qb) {
      ov.innerHTML += '<div id="wmQuota" style="position:fixed;right:18px;bottom:582px;background:var(--sf);color:var(--tx);font-size:12px;font-weight:700;padding:8px 13px;border-radius:9px;box-shadow:0 2px 10px rgba(0,0,0,.3);white-space:nowrap;opacity:0;transform:translateY(10px);transition:opacity .16s ease,transform .16s ease;">🧮 남은횟수 — 글작성 ' + (_qb || '-') + ' · 일정 ' + (_qs || '-') + '</div>';
    }
    document.body.appendChild(ov);
    requestAnimationFrame(function () {
      ov.querySelectorAll('#wmSaved,#wmNaver,#wmDaangn,#wmInsta,#wmFacebook,#wmQuoteXlsx,#wmStmtXlsx,#wmQuoteSms,#wmQuota').forEach(function (el) {
        el.style.opacity = '1'; el.style.transform = 'none';
      });
    });
    var close = function () { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.getElementById('wmSaved').onclick = function () { close(); openSavedPosts(); };
    document.getElementById('wmNaver').onclick = function () { close(); openChannelWriter('naver'); };
    document.getElementById('wmDaangn').onclick = function () { close(); openChannelWriter('daangn'); };
    document.getElementById('wmInsta').onclick = function () { close(); openChannelWriter('insta'); };
    document.getElementById('wmFacebook').onclick = function () { close(); openChannelWriter('facebook'); };
    document.getElementById('wmQuoteXlsx').onclick = function () { close(); if (window.DocsExcel) DocsExcel.openQuoteExcel(); else toast('문서 모듈 로드 안됨', 'err'); };
    document.getElementById('wmStmtXlsx').onclick = function () { close(); if (window.DocsExcel) DocsExcel.openStatementExcel(); else toast('문서 모듈 로드 안됨', 'err'); };
    document.getElementById('wmQuoteSms').onclick = function () { close(); openQuoteWriter(); };
  }
  ClaudeAI.openWriteMenu = openWriteMenu;
  window.openWriteMenu = openWriteMenu;

  // ── Claude AI 메인 시트 ──
  function open() {
    var ov = overlayShell(
      '<div style="font-size:17px;font-weight:800;margin-bottom:4px;">✨ Claude AI</div>' +
      '<div style="font-size:12px;color:var(--mu);margin-bottom:14px;">무엇을 도와드릴까요?</div>' +
      '<button class="btn b-blue" id="aiMenuSms" style="width:100%;justify-content:center;margin-bottom:8px;">📩 문자/캡처 분석 → 일정 추가</button>' +
      '<button class="btn b-ghost" id="aiMenuQuote" style="width:100%;justify-content:center;margin-bottom:8px;">📱 문자 전송용 견적서 (AI 텍스트)</button>' +
      '<button class="btn b-ghost" id="aiMenuCancel" style="width:100%;justify-content:center;">닫기</button>', 850);
    var close = function () { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.getElementById('aiMenuCancel').onclick = close;
    document.getElementById('aiMenuSms').onclick = function () { close(); openSmsToSchedule(); };
    document.getElementById('aiMenuQuote').onclick = function () { close(); openQuoteWriter(); };
  }
  ClaudeAI.open = open;
  window.openClaudeAI = open;
})();
