/* ═══════════════════════════════════════════════════════════
   tools/test-calmap.js
   그날 지도 · 지도에서 주소 찍기 (2026-09-17 추가)
   ----------------------------------------------------------------
   왜 검사가 필요한가
     ① 이 기능은 **밖(카카오)에 묻는다.** 캐시가 새면 오류는 안 나고
        요금·쿼터와 화면 속도로만 나타난다 — 눈으로는 영영 못 잡는다.
        (2026-09-08 리소스 점검에서 고친 것들과 같은 종류다)
     ② 지도 키는 한동안 비어 있을 예정이다. 그 상태에서 앱이 멀쩡해야 한다 —
        키 없다고 스케줄 탭이 깨지면 그건 지도 기능이 아니라 사고다.
     ③ 전체화면 오버레이를 둘 새로 만들었다. 표식(ov-lock)을 빠뜨리면
        뒤로가기가 그 팝업을 못 보고 뒤 화면 탭이 바뀐다(2026-09-08 신고와 같은 뿌리).
═══════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'www', 'js');

let fails = 0, oks = 0;
function chk(name, fn) {
  try { const r = fn(); console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; }
  catch (e) { console.log('  ❌ ' + name + ' — ' + e.message); fails++; }
}
function achk(name, fn) { return fn().then(r => { console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; })
  .catch(e => { console.log('  ❌ ' + name + ' — ' + e.message); fails++; }); }
const must = (c, m) => { if (!c) throw new Error(m); };
const read = (f) => fs.readFileSync(path.join(JS, f), 'utf8');
/* '없어야 한다' 를 볼 때는 주석을 걷어내고 본다 — 왜 뺐는지를 주석에 길게 적는 저장소다 */
const strip = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ── geocode.js 를 가짜 브라우저에 올린다 ──
   kakao SDK 를 미리 끼워 두면 loadSdk 가 바로 통과한다(스크립트를 실제로 받지 않는다).
   opts.answers 로 '카카오가 뭐라고 답했는지'를 조종하고, calls 로 몇 번 물었는지 센다. */
function loadGeocode(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.store || {});
  const calls = { addr: 0, kw: 0 };
  const OK = 'OK', ZERO = 'ZERO_RESULT';
  const ctx = {
    console, setTimeout, clearTimeout, Date, String, Math, JSON, Object, Promise,
    parseFloat, parseInt, encodeURIComponent, Error,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { if (opts.full) throw new Error('QuotaExceeded'); store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    },
    document: { head: { appendChild() {} }, createElement: () => ({ style: {} }) }
  };
  ctx.window = ctx;
  ctx.KAKAO_JS_KEY = ('key' in opts) ? opts.key : 'REAL_KEY_1234';
  ctx.kakao = {
    maps: {
      load: (f) => f(),
      services: {
        Status: { OK, ZERO_RESULT: ZERO },
        Geocoder: function () {
          return {
            addressSearch: (q, cb) => { calls.addr++; const a = (opts.answers || {})[q];
              cb(a && a.addr ? [{ y: a.addr.lat, x: a.addr.lng }] : [], a && a.addr ? OK : ZERO); },
            coord2Address: (x, y, cb) => cb([{ road_address: { address_name: '도로명 주소' } }], OK)
          };
        },
        Places: function () {
          return { keywordSearch: (q, cb) => { calls.kw++; const a = (opts.answers || {})[q];
            cb(a && a.kw ? [{ y: a.kw.lat, x: a.kw.lng, place_name: 'X' }] : [], a && a.kw ? OK : ZERO); } };
        }
      }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(read('geocode.js'), ctx, { filename: 'geocode.js' });
  must(ctx.Geocode, 'geocode.js 가 Geocode 를 안 내놓습니다 (검사 기준이 낡았습니다)');
  return { G: ctx.Geocode, I: ctx.__geocodeInternals, store, calls };
}

console.log('\n[1] 배선 — 네 파일이 바른 순서로 실려 있는가');

chk('index.html 에 실려 있고 config_map 이 geocode 보다 먼저다', () => {
  const h = fs.readFileSync(path.join(ROOT, 'www', 'index.html'), 'utf8');
  const at = (f) => h.indexOf('js/' + f);
  ['config_map.js', 'geocode.js', 'cal_map.js', 'map_pick.js'].forEach(f =>
    must(at(f) > 0, f + ' 가 index.html 에 없습니다 — 파일만 있고 안 실리면 아무 일도 안 일어납니다'));
  must(at('config_map.js') < at('geocode.js'),
       'config_map.js 가 geocode.js 보다 늦게 실립니다 — 키를 못 읽어 지도가 항상 꺼집니다');
  return '4개 · 순서 정상';
});

chk('스케줄 목록이 지도를 부른다', () => {
  const s = read('calendar.js');
  must(/CalMap\.open\(/.test(s), 'calendar.js 가 CalMap.open 을 안 부릅니다 — 버튼이 있어도 안 열립니다');
  must(/_mapStops\(/.test(s), '지도에 넘길 목록을 만드는 곳이 없습니다');
  must(/id="calDetailMap"/.test(s), '머리줄에 지도 버튼이 없습니다');
  return '버튼 · 목록 · 열기';
});

chk('주소칸이 지도 찍기를 부른다 (2단계)', () => {
  const s = read('link_actions.js');
  must(/MapPick\.open\(/.test(s), 'link_actions.js 가 MapPick.open 을 안 부릅니다');
  must(/MapPick\.available\(\)/.test(s),
       '키가 없어도 버튼을 만듭니다 — 눌러도 아무 일 없는 버튼이 생깁니다');
  must(/dispatchEvent\(new Event\('change'/.test(s),
       '주소를 코드로 채우고 change 를 안 알립니다 — 바뀐 걸 모르고 저장을 건너뛸 수 있습니다');
  return '버튼 · 조건 · 변경 알림';
});

console.log('\n[2] 지도 키가 없을 때 — 앱이 멀쩡한가');

chk('자리표시자(TODO_)는 키로 치지 않는다', () => {
  must(!loadGeocode({ key: 'TODO_KAKAO_JS_KEY' }).G.available(), 'TODO_ 값을 진짜 키로 봅니다');
  must(!loadGeocode({ key: '' }).G.available(), '빈 값을 진짜 키로 봅니다');
  must(loadGeocode({ key: 'REAL' }).G.available(), '진짜 키를 못 알아봅니다');
  return 'TODO_ · 빈값 걸러냄';
});

chk('config_map.js 가 키 자리를 하나만 둔다', () => {
  const s = read('config_map.js');
  must(/window\.KAKAO_JS_KEY\s*=/.test(s), '키 자리가 없습니다');
  must((strip(s).match(/window\.KAKAO_JS_KEY\s*=/g) || []).length === 1,
       '키를 여러 곳에서 정합니다 — 나중 것이 이깁니다');
  return '한 곳';
});

chk('키가 없으면 조용히 못 찾았다고 한다 (예외를 던지지 않는다)', () => {
  const { G } = loadGeocode({ key: 'TODO_KAKAO_JS_KEY' });
  let thrown = false, got = 'X';
  G.lookup('평택시 어딘가').then(v => { got = v; }, () => { thrown = true; });
  must(!thrown, '키가 없다고 예외를 던집니다 — 달력이 통째로 멈출 수 있습니다');
  return '조용히 null';
});

chk('키가 없어도 길안내 카드는 그대로 나온다', () => {
  const s = read('cal_map.js');
  const cardAt = s.indexOf('cardsHtml(stops)');
  const keyAt  = s.indexOf('Geocode.available()');
  must(cardAt > 0 && keyAt > cardAt,
       '키를 먼저 보고 빠져나갑니다 — 키가 없다고 길안내까지 막으면 안 됩니다(주소만으로 되는 일입니다)');
  return '카드 먼저 · 지도 나중';
});

console.log('\n[3] 뒤로가기 · 화면');

chk('새 오버레이 둘 다 표식(ov-lock)을 달았다', () => {
  ['cal_map.js', 'map_pick.js'].forEach(f =>
    must(/ov-lock/.test(read(f)), f + ' 오버레이에 ov-lock 이 없습니다 — 뒤로가기가 못 봅니다'));
  return 'cal_map · map_pick';
});

chk('닫기 버튼 id 가 뒤로가기의 검색어에 걸린다', () => {
  /* state.js 는 button[id*="Close"] 로 찾아 눌러 준다. id 를 바꾸면 노드만 지워져
     각자의 정리 코드가 안 돈다. */
  must(/id="calMapClose"/.test(read('cal_map.js')), '그날 지도에 Close 를 담은 닫기 버튼이 없습니다');
  must(/id="mapPickClose"/.test(read('map_pick.js')), '주소 찍기에 Close 를 담은 닫기 버튼이 없습니다');
  return 'calMapClose · mapPickClose';
});

chk('오버레이가 충분히 위에 있다', () => {
  const css = fs.readFileSync(path.join(ROOT, 'www', 'styles.css'), 'utf8');
  const z = (sel) => {
    const m = css.match(new RegExp('\\' + sel + '\\{[^}]*z-index:(\\d+)'));
    must(m, sel + ' 의 z-index 를 못 찾았습니다');
    return +m[1];
  };
  const cm = z('.cm-ov'), mp = z('.mp-ov');
  must(cm >= 1000, '.cm-ov 가 ' + cm + ' 입니다 — 뒤로가기(closeTopPopup)가 못 봅니다');
  /* ☠️ 주소 찍기는 **주소 입력칸이 있는 창 위에서** 열린다. 그 창들이 이미 높다.
     앱 안에서 쓰는 다른 오버레이의 z 를 실제로 훑어, 그보다 위인지 본다.
     (카메라 99999 · 업데이트 게이트 100000 은 지도를 덮어야 맞는 것이라 뺀다) */
  let top = 0;
  fs.readdirSync(JS).filter(f => f.endsWith('.js')).forEach(f => {
    (read(f).match(/z-?index:\s*(\d+)/g) || []).forEach(t => {
      const v = +t.replace(/\D/g, '');
      if (v < 9000 && v > top) top = v;
    });
  });
  must(mp > top, '.mp-ov 가 ' + mp + ' 인데 앱 안에 ' + top +
       ' 짜리 창이 있습니다 — 지도가 그 뒤에 깔려 "눌러도 아무 일이 없는" 것처럼 보입니다');
  return '.cm-ov ' + cm + ' · .mp-ov ' + mp + ' (앱 최고 ' + top + ')';
});

chk('달력 캐시가 주소를 버리지 않는다', () => {
  /* ☠️ 달력은 앱을 켜자마자 localStorage 슬림 캐시로 먼저 그린다. 거기서 주소가 빠지면
       '어제는 지도에 다 나왔는데 오늘 아침엔 텅 비어 있다'가 된다 — 오류는 안 난다.
       (2026-08-16 업종 아이콘이 사라지던 버그와 같은 뿌리) */
  const s = read('calendar.js');
  const at = s.indexOf('function _slimCalItems');
  must(at > 0, '_slimCalItems 를 못 찾았습니다 (검사 기준이 낡았습니다)');
  const blk = s.slice(at, s.indexOf('function _saveMonthCacheLS'));
  must(/customer:\s*u\.customer\s*\|\|\s*null/.test(blk),
       '호수 고객을 필드별로 추립니다 — 주소가 빠지면 앱을 껐다 켠 뒤 지도가 텅 빕니다');
  must(/facilityCustomer:\s*sess\.facilityCustomer\s*\|\|\s*null/.test(blk),
       '시설 고객이 캐시에서 빠집니다 — 시설 작업이 지도에 안 뜹니다');
  return 'customer · facilityCustomer 통째로';
});

chk('지도 선 색을 카카오가 읽는 형태로 바꾼다', () => {
  /* 계산된 색은 "rgb(15, 95, 107)" 인데 카카오 strokeColor 는 #RRGGBB 를 받는다.
     안 바꾸면 선이 검정으로 떨어진다 — 오류가 안 나서 눈치채기 어렵다. */
  const s = read('cal_map.js');
  const at = s.indexOf('function accent');
  must(at > 0, 'accent 를 못 찾았습니다');
  must(/toString\(16\)/.test(s.slice(at, at + 900)), 'rgb 를 16진수로 안 바꿉니다');
  return 'rgb → #RRGGBB';
});

chk('손 뗀 신호가 유실돼도 누르기가 굳지 않는다', () => {
  /* 2026-09-08 '드래그가 중간에 굳는다' 신고와 같은 뿌리.
     ⚠️ 그 취소 리스너를 지도를 열 때마다 달면 연 횟수만큼 쌓인다 — 한 번만 달아야 한다. */
  const s = read('map_pick.js');
  const n = (strip(s).match(/addEventListener\('visibilitychange'/g) || []).length;
  must(n === 1, 'visibilitychange 리스너가 ' + n + '개입니다 (1개여야 합니다)');
  must(s.indexOf("addEventListener('visibilitychange'") < s.indexOf('function attachLongPress'),
       '리스너를 attachLongPress 안에서 답니다 — 지도를 열 때마다 쌓입니다');
  must(/_lpCancel\(\);\s*_lpCancel = null;/.test(s), '닫을 때 누르기 타이머를 안 끕니다');
  return '한 번만 · 닫을 때 정리';
});

chk('지도는 갈 곳이 둘 이상일 때만 권한다', () => {
  const s = read('calendar.js');
  const at = s.indexOf('_mapBtn');
  must(at > 0, '지도 버튼 조건을 못 찾았습니다');
  must(/\.length >= 2\)/.test(s.slice(at - 260, at + 200)),
       '한 곳뿐인 날에도 지도를 권합니다 — 그 경우 카드의 길안내가 이미 한 번에 갑니다');
  return '주소 2곳 이상';
});

chk('업데이트 안내가 들어 있다', () => {
  const wn = read('whatsnew.js');
  const at = wn.indexOf("'3.2.29': {");
  must(at > 0, '지도 안내(3.2.29)가 whatsnew.js 에 없습니다');
  const blk = wn.slice(at, at + 2200);
  must(/\[지도\]/.test(blk) && /길게 눌러/.test(blk),
       '안내에 지도 보기·주소 찍기 두 가지가 다 적혀 있지 않습니다');
  return '2가지 · 3.2.29';
});

chk('배포 전에 버전을 더 올리면 안내 키를 옮기라고 알려 준다', () => {
  /* ☠️ whatsnew 는 NOTES[APP_VERSION] 으로 정확히 찾는다. 안내를 써 두고 버전을 한 번 더
       올리면 그 안내는 조용히 안 뜬다 — 오류도 안 나고 배포가 끝난 뒤에야 알게 된다.
       bump-version.js 가 그 순간에 알려 주도록 해 뒀다. 그 경고를 지우지 못하게 막는다. */
  const bv = fs.readFileSync(path.join(ROOT, 'bump-version.js'), 'utf8');
  must(/whatsnew\.js/.test(bv), 'bump-version.js 가 whatsnew 를 보지 않습니다');
  must(/에 업데이트 안내가 있는데/.test(bv), '안내 키 이월 경고가 사라졌습니다');
  must(/process\.exit/.test(bv.slice(bv.indexOf('whatsnew'), bv.indexOf('// 1) version.js'))) === false,
       '경고가 빌드를 막습니다 — 안내 없이 버전만 올리는 일은 정상입니다');
  return '경고만 (막지 않음)';
});

console.log('\n[4] 팝업 정책 — 새 기능에 성공 토스트를 붙이지 않았는가');

chk('새 파일에 성공 토스트가 없다', () => {
  /* 2026-09-07 기준 ①: 성공은 알리지 않는다. 지도는 화면이 바로 바뀌므로 더더욱. */
  const bad = [];
  ['cal_map.js', 'map_pick.js', 'geocode.js'].forEach(f => {
    read(f).split('\n').forEach((l, i) => {
      const t = l.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      if (/showToast\s*\([^)]*,\s*'ok'\s*\)/.test(l)) bad.push(f + ':' + (i + 1));
    });
  });
  must(!bad.length, '성공 토스트가 붙었습니다: ' + bad.join(', '));
  return '없음';
});

console.log('\n[5] 화면에 넣는 글자를 그대로 붙이지 않는가');

chk('주소·작업명이 esc 를 거쳐 들어간다', () => {
  /* 주소·작업명은 사용자가 손으로 친 값이다. 따옴표 하나로 카드가 깨진다. */
  [['cal_map.js', ['s.title', 's.addr', 's.time', 's.sub']],
   ['map_pick.js', ['d.name', 'd.address']]].forEach(([f, vars]) => {
    const s = read(f);
    vars.forEach(v => {
      const re = new RegExp("'\\s*\\+\\s*" + v.replace('.', '\\.') + "\\s*\\+\\s*'");
      must(!re.test(s), f + ' 의 ' + v + ' 가 esc 없이 화면에 들어갑니다');
    });
  });
  return 'cal_map · map_pick';
});

/* 캐시 검사는 Promise 라 마지막에 모아 돌린다 */
(async function () {
  console.log('\n[6] 캐시 — 같은 주소를 두 번 묻지 않는가');
  const A = { '평택시 비전동 1': { addr: { lat: '37.0', lng: '127.1' } } };

  await achk('한 번 찾은 주소는 다시 묻지 않는다', async () => {
    const { G, calls } = loadGeocode({ answers: A });
    await G.lookup('평택시 비전동 1');
    await G.lookup('평택시 비전동 1');
    await G.lookup(' 평택시  비전동 1 ');        // 띄어쓰기만 다른 같은 주소
    must(calls.addr === 1, '카카오에 ' + calls.addr + '번 물었습니다 (1번이어야 합니다)');
    return '1번만';
  });

  await achk('정식 주소로 못 찾으면 이름으로 한 번 더 찾는다', async () => {
    const { G, calls } = loadGeocode({ answers: { '○○아파트 101동': { kw: { lat: '37', lng: '127' } } } });
    const g = await G.lookup('○○아파트 101동');
    must(g && g.lat === 37, '아파트 이름으로 못 찾았습니다 — 주소칸에 아파트명만 적힌 작업이 통째로 사라집니다');
    must(calls.addr === 1 && calls.kw === 1, '2단 폴백이 아닙니다 (addr ' + calls.addr + ' / kw ' + calls.kw + ')');
    return 'addr → keyword';
  });

  await achk('못 찾은 주소도 기억한다 (열 때마다 다시 묻지 않는다)', async () => {
    const { G, calls } = loadGeocode({ answers: {} });
    must((await G.lookup('없는 주소')) === null, 'null 이 아닙니다');
    await G.lookup('없는 주소');
    await G.lookup('없는 주소');
    must(calls.addr === 1, '못 찾은 주소를 ' + calls.addr + '번 물었습니다 — 제일 자주 묻는 주소가 됩니다');
    return '1번만';
  });

  await achk('못 찾은 기억은 7일 뒤 풀린다', async () => {
    const { G, I, store, calls } = loadGeocode({ answers: {} });
    await G.lookup('없는 주소');
    const c = JSON.parse(store[I.CACHE_KEY]);
    c[Object.keys(c)[0]].t = Date.now() - (I.MISS_TTL + 1000);
    store[I.CACHE_KEY] = JSON.stringify(c);
    await G.lookup('없는 주소');
    must(calls.addr === 2, '기한이 지났는데 다시 묻지 않습니다');
    return '다시 물음';
  });

  await achk('주소를 고치면 옛 기억에 막히지 않는다', async () => {
    const { G } = loadGeocode({ answers: { '평택시 비전동 9': { addr: { lat: '37.9', lng: '127.9' } } } });
    must((await G.lookup('평택시 비전동 1')) === null, '엉뚱하게 찾았습니다');
    const g = await G.lookup('평택시 비전동 9');
    must(g && g.lat === 37.9, '주소를 고쳤는데 못 찾음으로 막혔습니다');
    return '새 주소는 새로 찾는다';
  });

  await achk('캐시가 상한을 넘지 않는다 (오래된 것부터 버린다)', async () => {
    const { G, I, store } = loadGeocode({ answers: {} });
    for (let i = 0; i < I.CACHE_MAX + 25; i++) await G.lookup('주소 ' + i);
    const c = JSON.parse(store[I.CACHE_KEY]);
    const n = Object.keys(c).length;
    must(n <= I.CACHE_MAX, '캐시가 ' + n + '건입니다 (상한 ' + I.CACHE_MAX + ') — localStorage 한도를 밀어냅니다');
    must(c['주소 0'] === undefined, '오래된 것이 아니라 새 것을 버렸습니다');
    must(c['주소 ' + (I.CACHE_MAX + 24)], '방금 찾은 것이 사라졌습니다');
    return n + '건 / 상한 ' + I.CACHE_MAX;
  });

  await achk('localStorage 가 꽉 차도 지도는 뜬다', async () => {
    const { G } = loadGeocode({ answers: A, full: true });    // setItem 이 항상 던진다
    const g = await G.lookup('평택시 비전동 1');
    must(g && g.lat === 37, '캐시를 못 쓴다고 좌표까지 못 냅니다 — 캐시는 빠르기용이지 필수가 아닙니다');
    return '느려질 뿐 멈추지 않음';
  });

  await achk('한꺼번에 찾을 때 같은 주소는 한 번만 묻는다', async () => {
    const { G, calls } = loadGeocode({ answers: A });
    await G.lookupMany(['평택시 비전동 1', '평택시 비전동 1', '', null, '평택시 비전동 1']);
    must(calls.addr === 1, '같은 주소를 ' + calls.addr + '번 물었습니다');
    return '1번만';
  });

  console.log('\n' + (fails ? '❌ 실패 ' + fails + '건 / ' : '✅ ') + '통과 ' + oks + '건');
  process.exit(fails ? 1 : 0);
})();
