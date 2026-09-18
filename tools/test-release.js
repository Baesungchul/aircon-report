/* ═══════════════════════════════════════════════════════════
   tools/test-release.js
   출시 빌드가 '틀린 채로' 끝나지 못하게 막는가 (2026-09-18)
   ----------------------------------------------------------------
   ☠️ 실제로 난 사고
      3.2.30 을 스토어에 올렸는데 앱 정보는 3.2.30, 앱 설정 화면은 3.2.29 였고
      새 기능이 하나도 안 들어가 있었다. `cap sync` 를 안 하고 빌드해서
      gradle 은 새 번호로 빌드하고 웹 코드는 예전 사본이 그대로 들어간 것이다.
      assets/public 은 깃에 안 올라가는 폴더라 git pull 로는 절대 안 맞춰진다.

   ⭐ 그래서 검사할 것은 '스크립트가 있는가'가 아니라
      **틀린 조합을 실제로 잡아내는가** 다. 판정 함수에 그 사고와 똑같은 상황을
      그대로 넣어 보고, 문제로 잡는지 센다.
═══════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const R = require('./release.js');

let fails = 0, oks = 0;
function chk(name, fn) {
  try { const r = fn(); console.log('  ✅ ' + name + (r ? ' — ' + r : '')); oks++; }
  catch (e) { console.log('  ❌ ' + name + ' — ' + e.message); fails++; }
}
const must = (c, m) => { if (!c) throw new Error(m); };

/* 실제 파일 모양 그대로 만든다 — 정규식이 실제 파일에서 안 먹으면 의미가 없다 */
const wwwJs = (v) => "const APP_VERSION = '" + v + "';\nconst APP_VERSION_DATE = '2026-09-18';\n";
const gradle = (name, code) => 'android {\n  defaultConfig {\n    versionCode ' + code +
                               '\n    versionName "' + name + '"\n  }\n}\n';

(function () {
  console.log('\n[1] 2026-09-18 사고를 그대로 재현하면 잡는가');

  chk('cap sync 를 안 한 상태(사본이 옛 버전)를 잡는다', () => {
    /* 바로 이 조합이 스토어에 올라갔다 */
    const r = R.checkVersions(wwwJs('3.2.30'), wwwJs('3.2.29'), gradle('3.2.30', 52));
    must(r.problems.length > 0, '틀린 조합을 그냥 통과시켰습니다 — 같은 사고가 또 납니다');
    must(r.problems.join(' ').indexOf('3.2.29') >= 0, '어느 값이 틀렸는지 안 알려 줍니다');
    return r.problems.length + '건 잡음';
  });

  chk('사본이 아예 없으면 잡는다', () => {
    const r = R.checkVersions(wwwJs('3.2.31'), null, gradle('3.2.31', 53));
    must(r.problems.length > 0, '복사가 안 됐는데 빌드로 넘어갑니다');
    must(r.problems.join(' ').indexOf('cap sync') >= 0, 'cap sync 문제라고 알려 주지 않습니다');
    return '멈춤';
  });

  chk('웹 버전과 스토어 버전이 어긋나면 잡는다', () => {
    /* 한쪽만 올리는 실수 — 설정 화면과 앱 정보가 다르게 보인다 */
    const r = R.checkVersions(wwwJs('3.2.30'), wwwJs('3.2.30'), gradle('3.2.31', 53));
    must(r.problems.length > 0, '두 버전이 다른데 통과시켰습니다');
    return '멈춤';
  });

  chk('세 곳이 모두 같으면 통과시킨다', () => {
    const r = R.checkVersions(wwwJs('3.2.31'), wwwJs('3.2.31'), gradle('3.2.31', 53));
    must(r.problems.length === 0, '멀쩡한데 막았습니다: ' + r.problems.join(' / '));
    must(r.gradle.code === 53, 'versionCode 를 못 읽었습니다');
    return 'versionCode 53';
  });

  console.log('\n[2] 실제 저장소 파일에서도 읽히는가');

  chk('www/js/version.js 에서 버전을 읽는다', () => {
    const v = R.appVersionOf(fs.readFileSync(path.join(ROOT, 'www', 'js', 'version.js'), 'utf8'));
    must(v, '못 읽었습니다 — 파일 형식이 바뀌면 검사가 통째로 무력해집니다');
    return v;
  });

  chk('build.gradle 에서 버전과 코드를 읽는다', () => {
    const g = R.gradleVersionOf(fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle'), 'utf8'));
    must(g.name && g.code, '못 읽었습니다');
    return g.name + ' / ' + g.code;
  });

  chk('저장소의 두 버전이 지금 서로 맞는다', () => {
    /* 커밋된 상태 자체가 어긋나 있으면 빌드 전에 알아야 한다 */
    const w = R.appVersionOf(fs.readFileSync(path.join(ROOT, 'www', 'js', 'version.js'), 'utf8'));
    const g = R.gradleVersionOf(fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle'), 'utf8'));
    must(w === g.name, '저장소가 이미 어긋나 있습니다 — www ' + w + ' / gradle ' + g.name);
    return w;
  });

  console.log('\n[3] 업데이트 안내 항목');

  chk('안내가 있는 버전과 없는 버전을 가른다', () => {
    const src = fs.readFileSync(path.join(ROOT, 'www', 'js', 'whatsnew.js'), 'utf8');
    const w = R.appVersionOf(fs.readFileSync(path.join(ROOT, 'www', 'js', 'version.js'), 'utf8'));
    must(R.hasNotice(src, w), '지금 버전의 안내 항목이 없습니다 — 업데이트 안내가 조용히 안 뜹니다');
    must(!R.hasNotice(src, '9.9.9'), '없는 버전을 있다고 합니다 — 검사가 늘 통과합니다');
    return w;
  });

  console.log('\n[4] 명령이 실제로 연결돼 있는가');

  chk('npm run release 가 이 스크립트를 부른다', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    must(pkg.scripts && pkg.scripts.release, 'release 스크립트가 없습니다');
    must(pkg.scripts.release.indexOf('tools/release.js') >= 0,
         'release 가 이 스크립트를 안 부릅니다: ' + pkg.scripts.release);
    must(pkg.scripts['release:check'], 'release:check 가 없습니다');
    return pkg.scripts.release;
  });

  chk('스크립트 안에 cap sync 와 bundleRelease 가 둘 다 있다', () => {
    const src = fs.readFileSync(path.join(__dirname, 'release.js'), 'utf8');
    must(src.indexOf("'cap', 'sync'") > 0 || src.indexOf('cap sync') > 0, 'cap sync 가 없습니다');
    must(src.indexOf('bundleRelease') > 0, 'bundleRelease 가 없습니다');
    must(src.indexOf('cap') < src.indexOf('bundleRelease'), '순서가 뒤바뀌었습니다');
    return 'sync → build';
  });

  console.log(fails ? ('\n❌ 실패 ' + fails + '건 / 통과 ' + oks + '건')
                    : ('\n✅ 통과 ' + oks + '건'));
  process.exit(fails ? 1 : 0);
})();
