#!/usr/bin/env node
/* ─────────────────────────────────────────────
   bump-version.js — 릴리스 버전 한 번에 올리기
   사용법:
     node bump-version.js          → 패치 +1 (예: 2.3.0 → 2.3.1)
     node bump-version.js 2.4.0    → 지정 버전으로
   갱신 대상:
     www/js/version.js  (APP_VERSION, APP_VERSION_DATE)
     android/app/build.gradle (versionName, versionCode +1)
     www/sw.js  (캐시 ac1004-vNNN +1)
───────────────────────────────────────────────── */
const fs = require('fs');
const path = require('path');
const root = __dirname;

const P_VER = path.join(root, 'www', 'js', 'version.js');
const P_SW = path.join(root, 'www', 'sw.js');
const P_GRADLE = path.join(root, 'android', 'app', 'build.gradle');

function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, s) { fs.writeFileSync(p, s); }

let ver = read(P_VER);
let m = ver.match(/APP_VERSION\s*=\s*'([\d.]+)'/);
if (!m) { console.error('❌ version.js 에서 APP_VERSION 을 못 찾았습니다'); process.exit(1); }
let cur = m[1];

let next = process.argv[2];
if (!next) {
  let p = cur.split('.').map(function (n) { return parseInt(n, 10) || 0; });
  while (p.length < 3) p.push(0);
  p[2] += 1;
  next = p.join('.');
}
if (!/^\d+\.\d+\.\d+$/.test(next)) { console.error('❌ 버전 형식 오류 (예: 2.4.0):', next); process.exit(1); }

let d = new Date();
let today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

// 1) version.js
ver = ver.replace(/APP_VERSION\s*=\s*'[\d.]+'/, "APP_VERSION = '" + next + "'");
ver = ver.replace(/APP_VERSION_DATE\s*=\s*'[^']*'/, "APP_VERSION_DATE = '" + today + "'");
write(P_VER, ver);

// 2) build.gradle
let g = read(P_GRADLE);
let gc = g.match(/versionCode\s+(\d+)/);
let oldCode = gc ? gc[1] : '?';
let newCode = gc ? (parseInt(gc[1], 10) + 1) : 1;
g = g.replace(/versionCode\s+\d+/, 'versionCode ' + newCode);
g = g.replace(/versionName\s+"[\d.]+"/, 'versionName "' + next + '"');
write(P_GRADLE, g);

// 3) sw.js 캐시 버전 +1
let sw = read(P_SW);
let sc = sw.match(/ac1004-v(\d+)/);
sw = sw.replace(/(ac1004-v)(\d+)/g, function (mm, pre, n) { return pre + (parseInt(n, 10) + 1); });
write(P_SW, sw);

console.log('\u2705 \ubc84\uc804 \uc62c\ub9bc \uc644\ub8cc');
console.log('  APP_VERSION / versionName : ' + cur + ' \u2192 ' + next);
console.log('  versionCode               : ' + oldCode + ' \u2192 ' + newCode);
console.log('  \ub0a0\uc9dc                       : ' + today);
console.log('  sw \uce90\uc2dc                    : v' + (sc ? sc[1] : '?') + ' \u2192 v' + (sc ? (parseInt(sc[1], 10) + 1) : '?'));

// 4) npx cap copy android \ub97c \uc9c1\uc811 \uc2e4\ud589\ud55c \ub4a4, \ubc88\ub4e4(assets/public)\uc5d0 \ub4e4\uc5b4\uac04 \ubc84\uc804\uc774\n//    \ubc29\uae08 \uc62c\ub9b0 \ubc84\uc804\uacfc \uc2e4\uc81c\ub85c \uac19\uc740\uc9c0 \uac80\uc99d\ud55c\ub2e4. \uc548 \ub9de\uc73c\uba74 \ube4c\ub4dc\ub97c \uba48\ucd94\uac8c \ud574\uc11c\n//    \uc637\ubc84\uc804\uc774 \uadf8\ub300\ub85c \uc62c\ub77c\uac00\ub294 \uc0ac\uace0(2026-09-06 3.2.6/3.2.8 \ub545\uc5b4\uae40 \uc0ac\uac74)\ub97c \ub9c9\ub294\ub2e4.
const { execSync } = require('child_process');
const P_BUNDLE_VER = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'public', 'js', 'version.js');

console.log('\n\u25b6 npx cap copy android \uc2e4\ud589 \uc911...');
try {
  execSync('npx cap copy android', { cwd: root, stdio: 'inherit' });
} catch (e) {
  console.error('\u274c cap copy \uc2e4\ud328 \u2014 \ube4c\ub4dc\ub97c \uba48\ucda5\ub2c8\ub2e4. \uc704 \uc624\ub958\ub97c \ud655\uc778\ud558\uace0 \ub2e4\uc2dc \uc2dc\ub3c4\ud558\uc138\uc694.');
  process.exit(1);
}

let bundleVer;
try { bundleVer = read(P_BUNDLE_VER); } catch (e) {
  console.error('\u274c \ubc88\ub4e4 version.js\ub97c \ucc3e\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4: ' + P_BUNDLE_VER);
  process.exit(1);
}
let bm = bundleVer.match(/APP_VERSION\s*=\s*'([\d.]+)'/);
let bundleVerNum = bm ? bm[1] : null;
if (bundleVerNum !== next) {
  console.error('\n\u274c \uac80\uc99d \uc2e4\ud328: \ubc88\ub4e4\uc5d0 \ub4e4\uc5b4\uac04 \ubc84\uc804(' + bundleVerNum + ')\uc774 \uc2e4\uc81c \uc62c\ub9b0 \ubc84\uc804(' + next + ')\uacfc \ub2e4\ub985\ub2c8\ub2e4.');
  console.error('   \u2192 \uc774 \uc0c1\ud0dc\ub85c \ube4c\ub4dc\ud558\uba74 \uc608\uc804\ucc98\ub7fc \uc637\ubc84\uc804\uc774 \uc2a4\ud1a0\uc5b4\uc5d0 \uc62c\ub77c\uac11\ub2c8\ub2e4. \ube4c\ub4dc\ub97c \uba48\ucda5\ub2c8\ub2e4.');
  process.exit(1);
}
console.log('\u2705 \ubc88\ub4e4 \uac80\uc99d \ud1b5\uacfc: assets/public/js/version.js \ub3c4 ' + bundleVerNum + ' (\uc77c\uce58)');
console.log('\n\ub2e4\uc74c: Android Studio\uc5d0\uc11c \ube4c\ub4dc/\uc5c5\ub85c\ub4dc (cap copy\ub294 \uc774\ubbf8 \uc2e4\ud589\ub428, \ub2e4\uc2dc \ub3cc\ub9bc\ud544\uc694 \uc5c6\uc74c)');
