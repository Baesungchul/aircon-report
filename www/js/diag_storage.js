/* ═══════════════════════════════════════════════
   diag_storage.js — 저장소 진단 (2026-09-01 · 0단계 "보는 눈")
   ----------------------------------------------------------------
   왜 필요한가:
     이 앱의 localStorage 쓰기는 거의 전부 `try{...}catch(e){}` 로 감싸져 있어
     한도(오리진당 5MB 안팎)에 닿아 실패해도 **아무 일도 일어나지 않는다.**
     그러면 동기화 해시가 저장 안 돼 매번 전량 재업로드되고,
     ac_session_backup(크래시 복구)이 조용히 죽는다.
     → setItem 을 한 겹 감싸 "실패했다는 사실"만 기록한다.

   ⚠️ 동작은 바꾸지 않는다. 예외는 그대로 다시 던져 기존 catch 로 간다.
   ⚠️ 일반 사용자 화면에는 아무것도 띄우지 않는다.
      숫자는 **관리자 통계 화면(관리자 전용)** 에서만 보인다.
      콘솔에서 수동 확인은 storageDiag().

   ★ index.html 에서 가장 먼저 로드할 것 (다른 스크립트가 쓰기 전에 감싸야 한다)
═══════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.Diag && window.Diag.__on) return;

  var TAG = '[저장소진단]';

  var state = {
    quotaFails: 0,        // localStorage 쓰기 실패 횟수(이번 실행)
    lastQuotaKey: '',     // 마지막으로 실패한 키
    lastQuotaAt: 0,
    indexCount: -1,       // 작업 인덱스 건수
    indexBytes: -1,       // 인덱스 JSON 크기(자)
    indexAt: 0,
    fullMaxLen: 0,        // 전체본(full) 업로드 중 가장 큰 것
    fullMaxId: '',
    fullOver: 0,          // 경고 임계 초과 건수
    // ★ 2026-09-01 동기화 결과 — 해시 형식 전환이 잘 됐는지 폰에서 바로 보려고
    syncAt: 0, syncScanned: -1, syncChanged: 0, syncRemoved: 0,
    tmpLeft: null,        // 인덱스 .tmp 찌꺼기가 남아있는지 (null=미확인 / false=깨끗)
    hashMigrated: 0       // 옛 해시(payload JSON 통째)를 업로드 없이 갈아끼운 건수
  };

  // Firestore 문서 한도는 1MiB. 여유를 두고 700KB 를 관찰 임계로 잡는다.
  var FULL_WARN = 700000;

  /* ── localStorage 사용량 집계 (읽기만) ───────────── */
  function groupOf(k) {
    // cloudSyncHash_{uid}_{workId} / calCache_2026-08 → 접두어로 묶는다
    var i = k.indexOf('_');
    return i > 0 ? k.slice(0, i) + '_*' : k;
  }
  function lsUsage() {
    var out = { keys: 0, bytes: 0, top: [], ok: false };
    try {
      var g = {};
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k === null) continue;
        var v = '';
        try { v = localStorage.getItem(k) || ''; } catch (e) {}
        // UTF-16 이라 실제 소모는 더 크지만, 비교·추세용으로는 자 수로 충분
        var b = k.length + v.length;
        out.keys++; out.bytes += b;
        var gk = groupOf(k);
        if (!g[gk]) g[gk] = { g: gk, bytes: 0, n: 0 };
        g[gk].bytes += b; g[gk].n++;
      }
      var arr = [];
      for (var kk in g) if (Object.prototype.hasOwnProperty.call(g, kk)) arr.push(g[kk]);
      arr.sort(function (a, b2) { return b2.bytes - a.bytes; });
      out.top = arr.slice(0, 5);
      out.ok = true;
    } catch (e) { /* 접근 자체가 막힌 환경 */ }
    return out;
  }

  /* ── setItem 감싸기 — 실패를 세고 그대로 다시 던진다 ── */
  try {
    var proto = window.Storage && window.Storage.prototype;
    if (proto && typeof proto.setItem === 'function' && !proto.__diagWrapped) {
      var orig = proto.setItem;
      proto.setItem = function (k, v) {
        try {
          return orig.apply(this, arguments);
        } catch (e) {
          var isLocal = false;
          try { isLocal = (this === window.localStorage); } catch (_) {}
          if (isLocal) {
            state.quotaFails++;
            state.lastQuotaKey = String(k);
            state.lastQuotaAt = Date.now();
            if (state.quotaFails === 1) {   // 실행당 한 번만 시끄럽게
              try {
                var quota = !!(e && (e.name === 'QuotaExceededError'
                  || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22));
                var u = lsUsage();
                console.warn(TAG + ' localStorage 쓰기 실패'
                  + (quota ? ' — 용량 한도 초과' : ' — ' + (e && e.name))
                  + ' / key=' + k
                  + ' / 값 ' + String(v == null ? '' : v).length + '자'
                  + ' / 현재 ' + u.keys + '키 ' + Math.round(u.bytes / 1024) + 'KB');
                console.warn(TAG + ' 많이 쓰는 키:', u.top);
                console.warn(TAG + ' ⚠️ 이 실패는 앱 곳곳의 빈 catch 로 묻힌다 — '
                  + '동기화 해시·크래시 복구 저장이 조용히 안 될 수 있음');
              } catch (_) {}
            }
          }
          throw e;   // ★ 동작 유지 — 기존 catch 가 그대로 받는다
        }
      };
      proto.__diagWrapped = true;
    }
  } catch (e) { /* 감싸기 실패해도 앱은 그대로 */ }

  /* ── 다른 모듈이 숫자를 넘겨주는 창구 ───────────── */
  var Diag = {
    __on: true,
    state: state,
    lsUsage: lsUsage,
    FULL_WARN: FULL_WARN,

    // work_index.js 가 인덱스를 읽거나 쓸 때 호출
    noteIndex: function (count, bytes) {
      try {
        state.indexCount = Number(count) || 0;
        if (bytes != null) state.indexBytes = Number(bytes) || 0;
        state.indexAt = Date.now();
      } catch (e) {}
    },

    // cloud_sync.js 의 syncAll 이 한 바퀴 끝낼 때 호출
    noteSync: function (o) {
      try {
        o = o || {};
        state.syncAt = Date.now();
        state.syncScanned = Number(o.scanned) || 0;
        state.syncChanged = Number(o.changed) || 0;
        state.syncRemoved = Number(o.removed) || 0;
      } catch (e) {}
    },

    // work_index.js 가 .tmp 찌꺼기를 정리한 뒤 실제로 사라졌는지 확인해 알려준다
    //   (안드로이드는 Android/data 를 파일관리자로 못 여니 앱이 대신 확인한다)
    noteIndexFiles: function (tmpLeft) { try { state.tmpLeft = !!tmpLeft; } catch (e) {} },

    // 옛 형식 해시를 업로드 없이 갈아끼웠을 때 (마이그레이션 패스가 실제로 동작한 증거)
    noteHashMigrated: function () { try { state.hashMigrated++; } catch (e) {} },

    /* 동기화 해시 키의 형식·소유를 센다 — 이걸 봐야 '전환이 됐는지'를 콘솔 없이 알 수 있다.
       old > 0 이면 아직 옛 형식이 남아 있다는 뜻이고,
       other > 0 이면 지금 계정이 아닌 uid 의 찌꺼기가 쌓여 있다는 뜻이다. */
    hashStats: function (uid) {
      var out = { total: 0, old: 0, mine: 0, other: 0, bytes: 0 };
      try {
        var pre = 'cloudSyncHash_';
        var mineP = uid ? (pre + uid + '_') : null;
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (!k || k.indexOf(pre) !== 0) continue;
          var v = '';
          try { v = localStorage.getItem(k) || ''; } catch (e) {}
          out.total++; out.bytes += k.length + v.length;
          if (v.charAt(0) === '{') out.old++;
          if (mineP && k.indexOf(mineP) === 0) out.mine++; else out.other++;
        }
      } catch (e) {}
      return out;
    },

    // cloud_sync.js 의 pushFull 이 전체본을 올리기 직전에 호출
    noteFull: function (id, len) {
      try {
        len = Number(len) || 0;
        if (len > state.fullMaxLen) { state.fullMaxLen = len; state.fullMaxId = String(id || ''); }
        if (len > FULL_WARN) {
          state.fullOver++;
          console.warn(TAG + ' 전체본이 큽니다 — ' + id + ' / ' + Math.round(len / 1024) + 'KB'
            + ' (Firestore 문서 한도 1MiB). 썸네일을 다시 켜면 여기서 터진다');
        }
      } catch (e) {}
    }
  };
  window.Diag = Diag;

  // 콘솔 수동 확인용
  window.storageDiag = function () {
    var u = lsUsage();
    console.log(TAG + ' localStorage ' + u.keys + '키 / 약 ' + Math.round(u.bytes / 1024) + 'KB', u.top);
    console.log(TAG + ' 인덱스 ' + (state.indexCount < 0 ? '미확인' : state.indexCount + '건 / ' + Math.round(state.indexBytes / 1024) + 'KB'));
    console.log(TAG + ' 쓰기 실패 ' + state.quotaFails + '회 / 전체본 최대 ' + Math.round(state.fullMaxLen / 1024) + 'KB');
    return { ls: u, state: state };
  };
})();
