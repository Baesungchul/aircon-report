#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════
   tools/release.js — 플레이스토어 출시용 빌드 한 줄로 (2026-09-18)
   ----------------------------------------------------------------
   쓰는 법:  npm run release        (검사 → cap sync → 서명된 .aab)
             npm run release:check  (빌드는 안 하고 검사만)

   ☠️ 왜 만들었나 — 2026-09-18 실제 사고
      3.2.30 을 스토어에 올렸는데, 앱 정보는 3.2.30 인데 앱 설정 화면은 3.2.29 였고
      새 기능이 하나도 안 들어가 있었다.

      원인: 이 앱은 버전이 **두 군데**에 있다.
        · android/app/build.gradle  versionName   → 스토어 '앱 정보'
        · www/js/version.js         APP_VERSION   → 앱 안 '설정' 화면
      그리고 웹 코드는 www/ 에서 바로 도는 게 아니라, `cap sync` 가
      android/app/src/main/assets/public/ 으로 **복사한 사본**이 APK 에 들어간다.
      그 복사를 안 하면 gradle 은 새 번호로 빌드하고 알맹이는 예전 그대로가 된다.
      assets/public 은 깃에 안 올라가는 폴더라 git pull 로는 절대 갱신되지 않는다.

      깃허브 액션(테스트 APK)은 워크플로에 `npx cap sync android` 가 박혀 있어 항상 맞았다.
      **PC 에서 손으로 하는 출시 빌드에만 그 단계가 없었다.**

   ⭐ 그래서 이 스크립트가 하는 일은 '순서를 기억해 주는 것'이 아니라
      **틀린 채로 빌드가 끝나지 못하게 막는 것**이다.
        ① cap sync 를 먼저 돌린다(빼먹을 수가 없다)
        ② 돌린 뒤 세 곳의 버전이 실제로 같은지 확인한다
             www/js/version.js  =  assets/public/js/version.js  =  build.gradle
           하나라도 다르면 **빌드하지 않고 멈춘다.** 잘못된 걸 스토어에 올리고
           번호를 올려 다시 빌드하는 것보다, 여기서 멈추는 게 훨씬 싸다.
        ③ 업데이트 안내(whatsnew.js)에 이 버전 항목이 있는지 본다 — 없으면 안내가
           조용히 안 뜬다. 이건 막지 않고 경고만 한다(일부러 안 넣는 경우가 있다).
        ④ 서명 설정(keystore.properties)이 있는지 본다 — 없으면 서명 안 된 .aab 가
           나오고 스토어가 안 받는다. 이건 막는다.

   ⚠️ 비밀번호는 묻지 않는다. android/keystore.properties 에서 gradle 이 읽어간다.
   ⚠️ 이 스크립트는 버전을 **고치지 않는다.** 무엇을 올릴지는 사람이 정할 일이다.
      틀렸다고 알려 주고, 어디를 고치면 되는지만 말한다.
═══════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const P = {
  www: path.join(ROOT, 'www', 'js', 'version.js'),
  built: path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'public', 'js', 'version.js'),
  gradle: path.join(ROOT, 'android', 'app', 'build.gradle'),
  whatsnew: path.join(ROOT, 'www', 'js', 'whatsnew.js'),
  keystore: path.join(ROOT, 'android', 'keystore.properties')
};

/* ── 버전 읽기 ── 세 파일이 형식이 달라 각각 뽑는다 */
function appVersionOf(src) {
  const m = /APP_VERSION\s*=\s*'([^']+)'/.exec(String(src || ''));
  return m ? m[1] : null;
}
function gradleVersionOf(src) {
  const name = /versionName\s+"([^"]+)"/.exec(String(src || ''));
  const code = /versionCode\s+(\d+)/.exec(String(src || ''));
  return { name: name ? name[1] : null, code: code ? parseInt(code[1], 10) : null };
}
function hasNotice(src, ver) {
  if (!ver) return false;
  return new RegExp("'" + ver.replace(/\./g, '\\.') + "'\\s*:").test(String(src || ''));
}

/* ── 판정 ── 파일을 안 읽고 내용만 받는다(검사에서 그대로 쓴다) ── */
function checkVersions(wwwSrc, builtSrc, gradleSrc) {
  const web = appVersionOf(wwwSrc);
  const built = builtSrc === null ? null : appVersionOf(builtSrc);
  const g = gradleVersionOf(gradleSrc);
  const problems = [];
  if (!web) problems.push('www/js/version.js 에서 APP_VERSION 을 못 읽었습니다');
  if (!g.name) problems.push('build.gradle 에서 versionName 을 못 읽었습니다');
  if (builtSrc === null) {
    problems.push('cap sync 가 웹 파일을 복사하지 못했습니다 (assets/public/js/version.js 없음)');
  } else if (web && built && web !== built) {
    problems.push('앱에 들어갈 웹 버전이 저장소와 다릅니다 — 복사본 ' + built + ' / 저장소 ' + web +
                  '\n     → cap sync 가 제대로 안 돌았습니다. android/app/src/main/assets/public 를 지우고 다시 실행해 보세요');
  }
  if (web && g.name && web !== g.name) {
    problems.push('웹 버전과 스토어 버전이 다릅니다 — 설정 화면 ' + web + ' / 앱 정보 ' + g.name +
                  '\n     → www/js/version.js 의 APP_VERSION 과 android/app/build.gradle 의 versionName 을 같게 맞추세요');
  }
  return { web: web, built: built, gradle: g, problems: problems };
}

/* ── 실행 ── */
function run(cmd, args, cwd, env) {
  console.log('\n> ' + cmd + ' ' + args.join(' '));
  const r = spawnSync(cmd, args, {
    cwd: cwd || ROOT, stdio: 'inherit', shell: true,
    env: env ? Object.assign({}, process.env, env) : process.env
  });
  return r.status === 0;
}

/* ── 자바 찾기 ──
   ☠️ 2026-09-19 실제로 겪은 것: 명령줄에서 gradle 을 돌리니
      "JAVA_HOME is not set and no 'java' command could be found in your PATH" 로 멈췄다.
      안드로이드 스튜디오로 빌드할 때는 스튜디오가 **자기 안에 든 자바**를 쓰기 때문에
      JAVA_HOME 이 없어도 됐다. 명령줄에는 그 배려가 없다.
   → 스튜디오가 깔아 둔 자바를 찾아 이 빌드에만 JAVA_HOME 을 달아 준다.
      시스템 환경변수를 건드리지 않는다 — 여기서만 쓰고 끝낸다.
   ⚠️ 못 찾으면 어디를 뒤졌는지 적어 준다. '자바가 없습니다' 한 줄은 아무 도움이 안 된다. */
function javaHome() {
  const win = process.platform === 'win32';
  const bin = win ? 'java.exe' : 'java';
  const okDir = (d) => { try { return !!d && fs.existsSync(path.join(d, 'bin', bin)); } catch (e) { return false; } };
  if (okDir(process.env.JAVA_HOME)) return { dir: process.env.JAVA_HOME, from: 'JAVA_HOME' };

  const tried = [];
  const cands = [];
  if (win) {
    const PF = process.env['ProgramFiles'] || 'C:\\Program Files';
    const PF86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const LA = process.env['LOCALAPPDATA'] || '';
    ['Android Studio', 'Android Studio1', 'Android Studio Preview'].forEach((n) => {
      cands.push(path.join(PF, 'Android', n, 'jbr'));
      cands.push(path.join(PF, 'Android', n, 'jre'));
      if (LA) cands.push(path.join(LA, 'Programs', n, 'jbr'));
      if (LA) cands.push(path.join(LA, 'Programs', n, 'jre'));
    });
    /* 따로 설치한 JDK 들 — 최신 것부터 */
    [path.join(PF, 'Java'), path.join(PF, 'Eclipse Adoptium'), path.join(PF86, 'Java')].forEach((root) => {
      try {
        fs.readdirSync(root).sort().reverse().forEach((n) => cands.push(path.join(root, n)));
      } catch (e) {}
    });
  } else {
    cands.push('/Applications/Android Studio.app/Contents/jbr/Contents/Home');
    cands.push('/usr/lib/jvm/default-java');
  }
  for (const d of cands) { tried.push(d); if (okDir(d)) return { dir: d, from: '자동 탐색' }; }
  return { dir: '', tried: tried };
}
function die(msg) {
  console.error('\n중단했습니다 — ' + msg + '\n');
  process.exit(1);
}
function readOrNull(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } }

/* 서명 설정이 '있는지'가 아니라 '쓸 수 있는지'를 본다.
   ⚠️ 비밀번호 값은 읽어서 비교만 한다 — 돌려주는 것은 문제 목록뿐이고 값은 절대 안 담는다. */
function readKeystoreProps() {
  const raw = readOrNull(P.keystore);
  if (raw === null) {
    return { problems: ['android/keystore.properties 가 없습니다 — ' +
                        'android/keystore.properties.example 을 복사해 만들어 주세요'] };
  }
  const get = (k) => {
    const m = new RegExp('^\\s*' + k + '\\s*=(.*)$', 'm').exec(raw);
    return m ? m[1].trim() : '';
  };
  /* 예시 파일을 그대로 복사해 둔 상태를 잡아낸다 */
  const looksExample = (v) => !v || /your[-_]?|path\/to|\bexample\b|여기에|바꾸세요/i.test(v);
  const problems = [];

  const storeFile = get('storeFile');
  if (looksExample(storeFile)) {
    problems.push('storeFile 이 예시값 그대로입니다 — 실제 .jks 파일 경로를 넣어 주세요');
  } else {
    /* 절대경로 / app 기준 / android 기준 / 저장소 기준 — 어떻게 적었든 찾아 준다.
       ⚠️ build.gradle 의 file() 은 app 모듈 기준이라, 상대경로를 쓰면 헷갈리기 쉽다.
          여기서 미리 확인해 주면 그 혼동이 빌드까지 가지 않는다. */
    const AND = path.join(ROOT, 'android');
    const cands = [storeFile,
                   path.resolve(AND, 'app', storeFile),
                   path.resolve(AND, storeFile),
                   path.resolve(ROOT, storeFile)];
    const found = cands.some((c) => { try { return fs.existsSync(c); } catch (e) { return false; } });
    if (!found) problems.push('서명키 파일을 찾을 수 없습니다: ' + storeFile);
  }
  /* ⚠️ 뒤에 붙는 말까지 통째로 적는다 — '비밀번호을(를)' 같은 조사 깨짐을 피한다 */
  [['storePassword', '키스토어 비밀번호를 넣어 주세요'],
   ['keyAlias', '키 별칭(alias)을 넣어 주세요'],
   ['keyPassword', '키 비밀번호를 넣어 주세요']].forEach(function (pair) {
    if (looksExample(get(pair[0]))) {
      problems.push(pair[0] + ' 가 비었거나 예시값입니다 — ' + pair[1]);
    }
  });
  return { problems: problems };
}

function main() {
  const checkOnly = process.argv.indexOf('--check') >= 0;

  /* ① 웹 파일을 네이티브 쪽으로 복사. 이게 이 스크립트가 존재하는 이유다 */
  if (!run('npx', ['cap', 'sync', 'android'])) die('cap sync 가 실패했습니다');

  /* ② 세 곳의 버전이 실제로 같은가 */
  const r = checkVersions(readOrNull(P.www), readOrNull(P.built), readOrNull(P.gradle));
  console.log('\n버전 확인');
  console.log('  앱 설정 화면 (www)        : ' + (r.web || '?'));
  console.log('  APK 에 들어갈 사본        : ' + (r.built || '없음'));
  console.log('  스토어 앱 정보 (gradle)   : ' + (r.gradle.name || '?') + '  (versionCode ' + (r.gradle.code == null ? '?' : r.gradle.code) + ')');
  if (r.problems.length) {
    r.problems.forEach(function (p) { console.error('\n  [x] ' + p); });
    die('버전이 맞지 않습니다. 이대로 올리면 2026-09-18 과 같은 일이 납니다');
  }
  console.log('  → 세 곳이 모두 같습니다');

  /* ③ 업데이트 안내 — 막지는 않는다 */
  if (!hasNotice(readOrNull(P.whatsnew), r.web)) {
    console.warn("\n  [!] whatsnew.js 에 '" + r.web + "' 항목이 없습니다 — 업데이트 안내가 안 뜹니다.");
    console.warn('      일부러 그런 것이면 그대로 두셔도 됩니다.');
  }

  /* ④ 서명 — 이건 막는다. 서명 안 된 .aab 는 스토어가 안 받는다.
     ☠️ 2026-09-19 실제로 겪은 것: 파일은 **있는데 예시값 그대로**였다
        (storeFile=C:/path/to/your-release-key.jks). 그런데 gradle 은 438개 작업을
        2분 동안 다 돌린 **뒤에야** validateSigningRelease 에서 터졌다.
        있는지만 보고 통과시킨 앞 판이 그 2분을 그대로 버리게 만들었다.
        → 있는지가 아니라 **쓸 수 있는지**를 본다. 2초 안에 끝난다.
     ⚠️ 비밀번호 값은 읽어서 비교만 하고 화면에도 로그에도 내보내지 않는다. */
  const ks = readKeystoreProps();
  if (ks.problems.length) {
    die('서명 설정(android/keystore.properties)이 아직 준비되지 않았습니다.\n\n     ' +
        ks.problems.join('\n     ') +
        '\n\n     이 파일은 깃에 올라가지 않습니다(.gitignore). 값을 채우고 다시 실행해 주세요.\n' +
        '     키 별칭을 모르면: keytool -list -v -keystore <키파일>');
  }

  /* ⑤ 자바. --check 에서도 찾아서 경로를 알려 준다 —
     keytool(키 별칭 확인)이 그 폴더의 bin 에 같이 있어서, 이 한 줄이 설정을 채우는 길이 된다. */
  const jh = javaHome();
  if (!jh.dir) {
    die('자바(JDK)를 찾지 못했습니다.\n' +
        '     안드로이드 스튜디오가 깔려 있으면 보통 여기에 있습니다:\n' +
        '       C:\\Program Files\\Android\\Android Studio\\jbr\n' +
        '     그 경로를 시스템 환경변수 JAVA_HOME 에 넣고 다시 실행해 주세요.\n' +
        '     찾아본 곳:\n       ' + (jh.tried || []).slice(0, 8).join('\n       '));
  }
  console.log('\n자바: ' + jh.dir + '  (' + jh.from + ')');
  console.log('  키 별칭을 확인하려면:');
  console.log('    "' + path.join(jh.dir, 'bin', 'keytool') + '" -list -v -keystore <키파일>');

  if (checkOnly) { console.log('\n검사만 했습니다 (--check). 빌드하려면 npm run release\n'); return; }

  const gradlew = (process.platform === 'win32') ? 'gradlew.bat' : './gradlew';
  if (!run(gradlew, ['bundleRelease'], path.join(ROOT, 'android'), { JAVA_HOME: jh.dir })) {
    die('gradle 빌드가 실패했습니다');
  }

  const aab = path.join(ROOT, 'android', 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
  if (!fs.existsSync(aab)) {
    die('빌드는 끝났는데 .aab 를 못 찾았습니다 — android/app/build/outputs/bundle/release 를 확인해 주세요');
  }

  /* ★ 2026-09-18 — 버전이 박힌 이름으로 한 곳에 모아 둔다.
     ☠️ gradle 이 내놓는 이름은 언제나 app-release.aab 다. 버전이 안 들어간다.
        3.2.30 을 올리려다 3.2.29 알맹이를 올린 일이 있었는데, 파일 이름만 봐서는
        그게 뭔지 알 수가 없다. 올리기 전에 이름으로 한 번 더 확인할 수 있게 한다.
     ⚠️ 원본은 그대로 둔다(복사). 안드로이드 스튜디오로 빌드하던 습관이 남아 있어도
        예전 경로에서 찾는 게 계속 된다.
     ⚠️ 이름은 ASCII 로 — 한글 파일명이 도구·업로드에서 깨지는 일이 있었다. */
  const outDir = path.join(ROOT, 'release');
  const outName = 'hyeonjang-' + r.gradle.name + '-' + r.gradle.code + '.aab';
  let copied = null;
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.copyFileSync(aab, path.join(outDir, outName));
    copied = path.join(outDir, outName);
  } catch (e) {
    console.warn('\n  [!] 복사본을 만들지 못했습니다 (' + (e && e.message) + ') — 원본을 쓰시면 됩니다');
  }

  console.log('\n끝났습니다 — 버전 ' + r.gradle.name + ' (versionCode ' + r.gradle.code + ')');
  if (copied) console.log('\n  올릴 파일 : ' + copied);
  console.log('  gradle 원본: ' + aab + '\n');
}

module.exports = { checkVersions: checkVersions, appVersionOf: appVersionOf,
                   gradleVersionOf: gradleVersionOf, hasNotice: hasNotice };

if (require.main === module) main();
