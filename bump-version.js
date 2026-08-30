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
console.log('\n\ub2e4\uc74c: npx cap copy android \u2192 Android Studio\uc5d0\uc11c \ube4c\ub4dc/\uc5c5\ub85c\ub4dc');
