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
function run(cmd, args, cwd) {
  console.log('\n> ' + cmd + ' ' + args.join(' '));
  const r = spawnSync(cmd, args, { cwd: cwd || ROOT, stdio: 'inherit', shell: true });
  return r.status === 0;
}
function die(msg) {
  console.error('\n중단했습니다 — ' + msg + '\n');
  process.exit(1);
}
function readOrNull(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } }

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

  /* ④ 서명 — 이건 막는다. 서명 안 된 .aab 는 스토어가 안 받는다 */
  if (!fs.existsSync(P.keystore)) {
    die('android/keystore.properties 가 없습니다 — 서명이 안 된 .aab 가 만들어집니다.\n' +
        '     android/keystore.properties.example 을 참고해 만들어 주세요');
  }

  if (checkOnly) { console.log('\n검사만 했습니다 (--check). 빌드하려면 npm run release\n'); return; }

  /* ⑤ 빌드. 비밀번호는 keystore.properties 에서 gradle 이 읽어간다 */
  const gradlew = (process.platform === 'win32') ? 'gradlew.bat' : './gradlew';
  if (!run(gradlew, ['bundleRelease'], path.join(ROOT, 'android'))) die('gradle 빌드가 실패했습니다');

  const aab = path.join(ROOT, 'android', 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
  console.log('\n끝났습니다.');
  console.log('  ' + (fs.existsSync(aab) ? aab : '빌드는 끝났는데 .aab 를 못 찾았습니다 — android/app/build/outputs/bundle/release 를 확인해 주세요'));
  console.log('  버전 ' + r.gradle.name + ' (versionCode ' + r.gradle.code + ')\n');
}

module.exports = { checkVersions: checkVersions, appVersionOf: appVersionOf,
                   gradleVersionOf: gradleVersionOf, hasNotice: hasNotice };

if (require.main === module) main();
