/* ═══════════════════════════════════════════════════════════
   tools/test-myloc.js
   내 위치 · 실제 도로 경로 (2026-09-18 추가)
   ----------------------------------------------------------------
   ⭐ 이 기능의 규칙은 하나다 — **위치 때문에 지도가 망가지면 안 된다.**
      위치는 있으면 좋은 것이지 없으면 안 되는 것이 아니다. 권한을 거부해도,
      GPS 가 안 잡혀도, 응답이 영영 안 와도 지도는 그대로 떠야 한다.
      그래서 MyLoc.get 은 어떤 경우에도 reject 하지 않고 null 을 돌려준다.
      이 검사는 그 약속이 실제로 지켜지는지를 본다 — 소스를 훑는 게 아니라 돌려 본다.

   ☠️ 특히 조심한 것 두 가지
      ① 안드로이드에서 권한 창이 뜬 채로 사용자가 아무것도 안 누르면 geolocation 의
         timeout 이 안 도는 경우가 있다. 그 상태로 두면 '지도를 불러오는 중…' 이 영영 남는다.
         → 자체 시계로 끊는다. 그게 실제로 도는지 본다.
      ② 거부를 기억해야 한다. 안 그러면 지도를 열 때마다 시스템 권한 창이 뜬다.
         동시에 **영영 막으면 안 된다** — 머리줄 ◎(force)로 다시 물을 수 있어야 한다.
═══════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'www', 'js');

let fails = 0, oks = 0;
function chk(name, fn) {
  try { const r = fn(); console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; }
  catch (e) { console.log('  ❌ ' + name + ' — ' + e.message); fails++; }
}
function achk(name, fn) {
  return fn().then(r => { console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; })
             .catch(e => { console.log('  ❌ ' + name + ' — ' + (e && e.message)); fails++; });
}
const must = (c, m) => { if (!c) throw new Error(m); };
const read = (f) => fs.readFileSync(path.join(JS, f), 'utf8');
const strip = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ── 가짜 브라우저 ──
   mode: 'ok' | 'deny' | 'fail' | 'hang' | 'none'
   'hang' = 콜백을 영영 안 부른다(권한 창이 떠 있는 상태). 자체 시계가 끊어야 한다. */
function loadMyLoc(mode, store) {
  const calls = { n: 0 };
  const s = Object.assign({}, store || {});
  const geo = (mode === 'none') ? undefined : {
    getCurrentPosition: (ok, err) => {
      calls.n++;
      if (mode === 'ok') return ok({ coords: { latitude: 37.1, longitude: 127.05, accuracy: 12 } });
      if (mode === 'deny') return err({ code: 1, message: 'denied' });
      if (mode === 'fail') return err({ code: 2, message: 'unavailable' });
      /* hang: 아무것도 안 부른다 */
    }
  };
  const ctx = {
    console: { log(){}, warn(){}, error(){} },
    setTimeout, clearTimeout, Date, String, Math, JSON, Object, Promise, parseInt, Error,
    localStorage: {
      getItem: (k) => (k in s ? s[k] : null),
      setItem: (k, v) => { s[k] = String(v); },
      removeItem: (k) => { delete s[k]; }
    },
    navigator: geo ? { geolocation: geo } : {}
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('myloc.js'), ctx, { filename: 'myloc.js' });
  must(ctx.MyLoc, 'MyLoc 이 안 올라왔습니다');
  return { M: ctx.MyLoc, calls, store: s, I: ctx.__mylocInternals };
}

/* ── routing.js 를 가짜 fetch 위에 올린다 ── */
function loadRouting(opts) {
  opts = opts || {};
  const calls = [];
  const ctx = {
    console: { log(){}, warn(){}, error(){} },
    setTimeout, clearTimeout, Date, String, Math, JSON, Object, Array, Promise, Error,
    AbortController: function () { this.signal = {}; this.abort = function () {}; },
    fetch: (u, o) => {
      calls.push({ u, body: JSON.parse(o.body) });
      if (opts.hang) return new Promise(function () {});           // 영영 안 옴
      if (opts.bad) return Promise.resolve({ ok: false });
      if (opts.throws) return Promise.reject(new Error('net'));
      return Promise.resolve({ ok: true, json: () => Promise.resolve(opts.body || {
        path: [[37.1, 127.0], [37.2, 127.1]], distance: 5400, duration: 900,
        legs: [{ distance: 5400, duration: 900 }]
      }) });
    }
  };
  ctx.window = ctx;
  if (opts.url !== undefined) ctx.KAKAO_ROUTE_URL = opts.url;
  vm.createContext(ctx);
  vm.runInContext(read('routing.js'), ctx, { filename: 'routing.js' });
  must(ctx.Routing, 'Routing 이 안 올라왔습니다');
  return { R: ctx.Routing, calls };
}

const P = [{ lat: 37.1, lng: 127.0 }, { lat: 37.2, lng: 127.1 }];

(async function () {
  console.log('\n[1] 위치를 못 받아도 지도는 살아 있는가');

  await achk('권한을 거부해도 null 만 돌려준다 (터지지 않는다)', async () => {
    const e = loadMyLoc('deny');
    const v = await e.M.get();
    must(v === null, '거부했는데 값을 돌려줬습니다');
    return 'null';
  });

  await achk('GPS 를 못 잡아도 null 만 돌려준다', async () => {
    const e = loadMyLoc('fail');
    must((await e.M.get()) === null, '실패했는데 값을 돌려줬습니다');
    return 'null';
  });

  await achk('위치 기능이 아예 없는 기기에서도 조용히 넘어간다', async () => {
    const e = loadMyLoc('none');
    must(e.M.available() === false, 'available 이 true 입니다');
    must((await e.M.get()) === null, 'null 이 아닙니다');
    return '조용히';
  });

  await achk('응답이 영영 안 와도 스스로 끊는다', async () => {
    /* ☠️ 이게 없으면 지도가 '불러오는 중…' 에서 영영 멈춘다 */
    const e = loadMyLoc('hang');
    const t0 = Date.now();
    /* ⚠️ 검사 자체에도 시계를 둔다. 안 두면 이 방어가 사라졌을 때 검사가 **실패가 아니라
       멈춤**이 된다 — 그러면 npm test 가 영영 안 끝나고, 결국 검사를 끄게 된다. */
    const v = await Promise.race([
      e.M.get(),
      new Promise(r => setTimeout(() => r('TIMEOUT'), e.I.TIMEOUT_MS + 5000))
    ]);
    const took = Date.now() - t0;
    must(v !== 'TIMEOUT', '스스로 안 끊습니다 — 지도가 "불러오는 중…" 에서 영영 멈춥니다');
    must(v === null, 'null 이 아닙니다');
    must(took < e.I.TIMEOUT_MS + 4000, '너무 오래 붙잡습니다: ' + took + 'ms');
    return Math.round(took / 1000) + '초 만에 포기';
  });

  console.log('\n[2] 거부를 기억하되 영영 막지는 않는가');

  await achk('한 번 거부하면 다시 묻지 않는다', async () => {
    const e = loadMyLoc('deny');
    await e.M.get();
    const n1 = e.calls.n;
    await e.M.get();
    must(e.calls.n === n1, '거부했는데 또 물었습니다 — 지도를 열 때마다 권한 창이 뜹니다');
    must(e.M.denied(), '거부를 기억하지 않습니다');
    return '1번만';
  });

  await achk('[내 위치] 를 직접 누르면 다시 묻는다', async () => {
    const e = loadMyLoc('deny');
    await e.M.get();
    const n1 = e.calls.n;
    await e.M.get({ force: true });
    must(e.calls.n === n1 + 1, 'force 인데 안 물었습니다 — 한 번 거부하면 영영 못 켭니다');
    return '다시 물음';
  });

  await achk('못 잡은 것(거부가 아님)은 거부로 기억하지 않는다', async () => {
    /* 지하주차장에서 한 번 못 잡았다고 다음부터 안 묻는 건 말이 안 된다 */
    const e = loadMyLoc('fail');
    await e.M.get();
    must(!e.M.denied(), '실패를 거부로 기억했습니다');
    const n1 = e.calls.n;
    await e.M.get();
    must(e.calls.n === n1 + 1, '다시 시도하지 않습니다');
    return '다시 시도';
  });

  await achk('성공하면 거부 기억이 풀린다', async () => {
    const e = loadMyLoc('ok', { ac_geoloc_denied: String(Date.now()) });
    const v = await e.M.get({ force: true });
    must(v && v.lat === 37.1, '위치를 못 받았습니다');
    must(!e.M.denied(), '성공했는데 거부 기억이 남아 있습니다 — 다음에 또 안 묻습니다');
    return '풀림';
  });

  console.log('\n[3] 같은 위치를 또 묻지 않는가');

  await achk('잠깐 안에는 기억해 둔 위치를 그대로 쓴다', async () => {
    const e = loadMyLoc('ok');
    await e.M.get();
    await e.M.get();
    must(e.calls.n === 1, '지도를 열 때마다 GPS 를 새로 켭니다: ' + e.calls.n + '번');
    return '1번만';
  });

  chk('오래되면 다시 잡는다', () => {
    /* 차로 이동 중이면 2분이면 위치가 꽤 달라진다 — 무한정 재사용하면 안 된다 */
    const e = loadMyLoc('ok');
    must(e.I.FRESH_MS > 0 && e.I.FRESH_MS <= 5 * 60 * 1000,
         '기억 시간이 너무 깁니다: ' + e.I.FRESH_MS + 'ms');
    return Math.round(e.I.FRESH_MS / 60000) + '분';
  });

  console.log('\n[4] 실제 도로 경로 — 아직 꺼져 있어도 멀쩡한가');

  await achk('주소(KAKAO_ROUTE_URL)가 비어 있으면 조용히 null', async () => {
    const e = loadRouting({ url: '' });
    must(e.R.available() === false, '안 켰는데 켜졌다고 합니다');
    must((await e.R.route(P)) === null, 'null 이 아닙니다');
    must(e.calls.length === 0, '켜지지도 않았는데 서버를 불렀습니다');
    return '호출 0';
  });

  await achk('켜면 좌표를 보내고 경로를 받는다', async () => {
    const e = loadRouting({ url: 'https://x.example/route' });
    const r = await e.R.route(P);
    must(r && r.path.length === 2, '경로를 못 받았습니다');
    must(r.distance === 5400 && r.duration === 900, '거리·시간이 안 왔습니다');
    must(e.calls[0].body.points.length === 2, '좌표를 안 보냈습니다');
    return r.path.length + '점';
  });

  await achk('서버가 실패해도 null 만 돌려준다 (지도는 점선으로 남는다)', async () => {
    for (const o of [{ bad: true }, { throws: true }]) {
      const e = loadRouting(Object.assign({ url: 'https://x.example/route' }, o));
      must((await e.R.route(P)) === null, '실패했는데 값을 돌려줬습니다');
    }
    return 'null';
  });

  await achk('서버가 안 답해도 스스로 끊는다', async () => {
    const e = loadRouting({ url: 'https://x.example/route', hang: true });
    const t0 = Date.now();
    must((await e.R.route(P)) === null, 'null 이 아닙니다');
    must(Date.now() - t0 < 12000, '너무 오래 붙잡습니다');
    return '끊음';
  });

  await achk('지점이 하나뿐이면 서버를 부르지 않는다', async () => {
    const e = loadRouting({ url: 'https://x.example/route' });
    must((await e.R.route([P[0]])) === null, 'null 이 아닙니다');
    must(e.calls.length === 0, '한 점짜리로 서버를 불렀습니다');
    return '호출 0';
  });

  await achk('경유지 상한을 넘기지 않는다', async () => {
    /* 카카오 문서: 경유지 최대 30개. 넘으면 서버가 아니라 여기서 먼저 자른다 */
    const many = [];
    for (let i = 0; i < 50; i++) many.push({ lat: 37 + i / 1000, lng: 127 });
    const e = loadRouting({ url: 'https://x.example/route' });
    await e.R.route(many);
    must(e.calls[0].body.points.length <= e.R.MAX_POINTS,
         '상한을 넘겨 보냈습니다: ' + e.calls[0].body.points.length);
    return e.calls[0].body.points.length + '점';
  });

  console.log('\n[5] 지도에 제대로 물려 있는가');

  chk('두 선을 같이 두되 모양이 다르다 (연한 점선 / 진한 실선)', () => {
    /* ☠️ 2026-09-18 — 예전엔 경로가 오면 점선을 지웠다. 사용자 요청으로 **같이 둔다**:
       두 값이 같이 있어야 "직선 4km인데 돌아가느라 7km"가 읽힌다.
       ⚠️ 대신 겹칠 때 점선을 낮춰야 한다. 안 낮추면 어느 쪽이 진짜 길인지 모른다. */
    const s = read('cal_map.js');
    const at = s.indexOf('function drawLines');
    must(at > 0, 'drawLines 를 못 찾았습니다');
    const b = s.slice(at, at + 1800);
    must(/strokeStyle: 'shortdash'/.test(b), '직선을 점선으로 안 그립니다');
    must(/strokeStyle: 'solid'/.test(b), '실제 경로를 실선으로 안 그립니다');
    must(b.indexOf('dashed.setMap(null)') < 0,
         '경로가 오면 점선을 지웁니다 — 직선과 주행을 나란히 볼 수 없습니다');
    must(/dashed\.setOptions\(\{ strokeWeight: 2, strokeOpacity: 0\.3/.test(b),
         '겹칠 때 점선을 안 낮춥니다 — 두 선이 엉켜 어느 쪽이 길인지 모릅니다');
    return '점선 + 실선';
  });

  chk('경로가 없을 때는 점선이 원래 굵기를 지킨다', () => {
    /* 아직 안 켜졌거나 실패한 상태에서는 점선이 **유일한 선**이다.
       처음부터 흐리게 그리면 지도가 비어 보인다 → 실선이 붙는 순간에만 낮춘다. */
    const s = strip(read('cal_map.js'));
    const at = s.indexOf('function drawLines');
    const b = s.slice(at, at + 1800);
    const first = b.indexOf('strokeOpacity: 0.65');
    const dim = b.indexOf('strokeOpacity: 0.3');
    must(first > 0, '점선을 원래 굵기로 안 그립니다');
    must(dim > first, '처음부터 흐리게 그립니다 — 경로가 없는 날 지도가 비어 보입니다');
    return '붙을 때만 낮춤';
  });

  chk('경로를 기다리느라 지도를 늦추지 않는다', () => {
    /* 먼저 점선으로 그려 놓고, 답이 오면 바꿔 단다 */
    const s = strip(read('cal_map.js'));
    const at = s.indexOf('function drawLines');
    const b = s.slice(at, at + 1200);
    must(b.indexOf('new kakao.maps.Polyline') < b.indexOf('Routing.route'),
         '경로를 받은 뒤에 선을 그립니다 — 응답이 늦으면 지도에 아무것도 없습니다');
    return '점선 먼저';
  });

  chk('내 위치를 지도 범위에 넣는다', () => {
    /* 안 넣으면 내 위치가 화면 밖일 때 선만 잘려 나간다 */
    const s = read('cal_map.js');
    must(/bounds\.extend\(mePos\)/.test(s), '내 위치를 bounds 에 안 넣습니다');
    must(/located\.length > 1 \|\| me/.test(s), '한 곳 + 내 위치일 때 범위를 안 맞춥니다');
    return 'bounds 포함';
  });

  chk('내 위치 표식이 번호 표식과 다르게 생겼다', () => {
    const css = fs.readFileSync(path.join(ROOT, 'www', 'styles.css'), 'utf8');
    must(css.indexOf('.cm-me{') > 0, '.cm-me 스타일이 없습니다');
    must(/\.cm-me\{[^}]*border-radius:50%/.test(css), '번호 표식과 구분이 안 됩니다(동그라미가 아님)');
    return '파란 점';
  });

  chk('위치를 못 쓰는 기기에서는 버튼을 안 만든다', () => {
    const s = read('cal_map.js');
    must(/window\.MyLoc && MyLoc\.available\(\)[\s\S]{0,120}calMapLoc/.test(s),
         '눌러도 아무 일 없는 버튼이 생깁니다');
    return '숨김';
  });

  console.log('\n[5-2] 카드에 적는 거리 (2026-09-18)');

  chk('직선과 주행을 글자로 구분해 적는다', () => {
    /* ☠️ 숫자만 두 개 있으면 무엇이 무엇인지 알 수 없다 */
    const s = read('cal_map.js');
    const at = s.indexOf('function setDist');
    must(at > 0, 'setDist 를 못 찾았습니다');
    const b = s.slice(at, at + 700);
    must(b.indexOf("'직선 '") > 0, '직선 거리에 이름을 안 붙입니다');
    must(b.indexOf("'주행 '") > 0, '주행 거리에 이름을 안 붙입니다');
    return '직선 · 주행';
  });

  chk('직선 거리는 경로 없이도 바로 채운다', () => {
    /* 좌표만 있으면 잴 수 있다. 경로 API 를 기다릴 이유가 없다 */
    const s = strip(read('cal_map.js'));
    const at = s.indexOf('var legOf');
    must(at > 0, '거리 계산 자리를 못 찾았습니다');
    const b = s.slice(at, at + 600);
    must(/setDist\(L\.i, MyLoc\.distance\([\s\S]{0,60}, 0\)/.test(b),
         '직선을 바로 안 채웁니다 — 경로가 꺼져 있으면 거리가 영영 안 보입니다');
    /* 경로를 부르기 **전에** 채우는지 (호출 자리와 비교한다 — 함수 정의가 아니라) */
    const call = s.indexOf('drawLines(map, linePts');
    must(call > 0, 'drawLines 호출부를 못 찾았습니다');
    must(at < call, '경로를 부른 뒤에 직선을 잽니다 — 응답이 늦으면 거리가 한참 비어 있습니다');
    return '즉시';
  });

  chk('구간 수가 안 맞으면 주행 거리를 안 적는다', () => {
    /* ☠️ 총거리를 나눠 추정하면 그럴듯한 거짓 숫자가 된다. 없는 편이 낫다 */
    const s = read('cal_map.js');
    must(/r\.legs\.length !== linePts\.length - 1\) return/.test(s),
         '구간 수를 확인하지 않습니다 — 엉뚱한 카드에 엉뚱한 거리가 붙습니다');
    return '안 적음';
  });

  chk('주소를 못 찾은 작업 때문에 자리가 밀리지 않는다', () => {
    /* ☠️ 여기가 이 기능에서 제일 틀리기 쉬운 자리다.
       주소를 못 찾은 작업은 located 에서 빠지므로 카드 번호와 선 위의 자리가 다르다.
       표(legOf)를 한 번만 만들어 쓰는지 본다 — 각각 계산하면 언젠가 어긋난다. */
    const s = strip(read('cal_map.js'));
    must(/legOf\[L\.i\] = at - 1/.test(s), '카드 자리와 구간 자리를 맞추는 표가 없습니다');
    must(/var at = k \+ \(me \? 1 : 0\)/.test(s), '내 위치만큼 자리를 밀어 주지 않습니다');
    return 'legOf 표';
  });

  chk('값이 없으면 거리 줄이 자리를 차지하지 않는다', () => {
    const css = fs.readFileSync(path.join(ROOT, 'www', 'styles.css'), 'utf8');
    must(/\.cm-card-dist\{[^}]*display:none/.test(css), '빈 줄이 카드에 남습니다');
    must(/\.cm-card-dist\.on\{display:block/.test(css), '값이 있어도 안 보입니다');
    return '비면 숨김';
  });

  console.log('\n[6] 안드로이드 권한 선언');

  chk('위치 권한 두 줄이 선언돼 있다', () => {
    /* ☠️ 캐패시터가 런타임 권한을 대신 물어보지만, 이 선언이 없으면 조용히 거부로 떨어진다 */
    const m = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
    must(m.indexOf('ACCESS_COARSE_LOCATION') > 0, 'ACCESS_COARSE_LOCATION 이 없습니다');
    must(m.indexOf('ACCESS_FINE_LOCATION') > 0, 'ACCESS_FINE_LOCATION 이 없습니다');
    must(m.indexOf('ACCESS_BACKGROUND_LOCATION') < 0,
         '백그라운드 위치를 선언했습니다 — 쓰지도 않는데 심사가 까다로워집니다');
    return '앞/뒤 2줄';
  });

  chk('REST 키를 앱에 심지 않았다', () => {
    /* ☠️ 도메인 제한이 없는 키라 APK 에서 꺼내면 누구나 쓴다. 서버를 거쳐야 한다 */
    const cfg = read('config_map.js');
    must(/window\.KAKAO_ROUTE_URL\s*=\s*''/.test(cfg) || /KAKAO_ROUTE_URL\s*=\s*'https?:/.test(cfg),
         'KAKAO_ROUTE_URL 이 주소 형식이 아닙니다');
    must(!/KakaoAK/.test(cfg + read('routing.js')), 'REST 키를 앱에서 직접 씁니다');
    return '서버 경유';
  });

  console.log(fails ? ('\n❌ 실패 ' + fails + '건 / 통과 ' + oks + '건')
                    : ('\n✅ 통과 ' + oks + '건'));
  process.exit(fails ? 1 : 0);
})();
