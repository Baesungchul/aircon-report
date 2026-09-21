/* ═══════════════════════════════════════════════════════════════════
   admin_grants.js — 내가 부여한 플랜 + 그 계정들의 사용 내역  (2026-09-20)
   ----------------------------------------------------------------
   관리자 통계(📊) 안에서 [자세히 보기] 로 열린다.
   "누구에게 무슨 플랜을 줬고, 그 사람이 실제로 쓰고 있는가" 한 화면.

   ⭐ 왜 만들었나
      플랜을 수동으로 부여하면 그때뿐이고, 나중에 **준 걸 쓰고 있는지**를 알 길이 없었다.
      플랜 관리 화면에도 '내가 부여한 내역' 이 있지만 거기는 지금 플랜만 보여 준다.
      여기서는 부여 내역에 **이번 달 사용량과 AI 원가**를 붙인다.

   ── 어디서 읽나 ────────────────────────────────────────────────
     admin_grants/{내uid}/log/{자동id}   ← 부여할 때 subscription.js 가 남긴다
        { targetUid, targetEmail, targetName, kind:'plan'|'admin', value, prevValue, grantedAt }
     users/{대상uid}                      ← 지금 상태
        { email, displayName, nickname, plan, billingPlan, admin, lastActiveAt,
          subs: { ym, used:{sched,blog}, coupon, aiCost, ... } }

   ☠️ **subs.used 는 "이번 달" 이 아니다.** subs.ym 에 적힌 달의 것이다.
      앱이 달이 바뀔 때 0 으로 되돌리는데, 그 사람이 이번 달에 앱을 한 번도 안 열었으면
      **지난달 숫자가 그대로 남아 있다.** 그걸 이번 달 사용량이라고 보여 주면
      "쓰고 있구나" 하고 잘못 판단한다 — 이 화면을 만든 이유와 정반대다.
      → ym 이 이번 달이 아니면 사용량을 0 으로 보고, 언제 기록인지 따로 적는다.
      (검사 tools/test-admin-grants.js 가 이걸 본다)

   ⚠️ subs 는 앱이 열려 있을 때 1.2초 늦게 올라간다. 방금 쓴 건 안 보일 수 있다.
      실시간 장부가 아니라 '대충 쓰고 있나' 를 보는 화면이다. 화면에도 적어 둔다.

   ⚠️ plan 은 내가 준 것도 결제한 것도 같은 칸에 들어간다. 결제로 받은 건
      billingPlan 에만 따로 적힌다 → 그게 있으면 '실결제' 로 갈라 표시한다.
      (안 가르면 내가 준 계정 수를 실제보다 많게 센다)

   ⚠️ 읽기 비용 — 계정 하나당 1 read 다. 한 번에 MAX_USERS 명까지만 본다.
      부여 계정이 그보다 많아질 일은 당분간 없고, 넘으면 화면에 적는다.
═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var LOG_MAX = 300;     // 읽어 올 부여 기록 수(사람 수가 아니라 기록 수다)
  var MAX_USERS = 80;    // 지금 상태를 조회할 계정 수 상한

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function ymOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  /* ⚠️ 이름·한도는 subscription.js 가 주인이다(Subs.planOf). 여기서 값을 베껴 두면
     요금제를 고쳤을 때 이 화면만 옛 숫자를 말한다. 아래 표는 Subs 가 아직 안 실렸을
     때를 위한 **이름 대체물**일 뿐이고, 한도는 일부러 안 적는다(모르면 안 보여 준다). */
  function planOf(k) {
    try { if (window.Subs && Subs.planOf) return Subs.planOf(k); } catch (e) {}
    return null;
  }
  function planName(k) {
    var p = planOf(k);
    if (p && p.name) return p.name;
    return ({ free: '무료', lite: '라이트', basic: '베이직', pro: '프로', master: '마스터' })[k] || k || '무료';
  }
  function planLimit(k) { return planOf(k); }
  function fmtKrw(n) { return '₩' + Math.round(Number(n) || 0).toLocaleString('ko-KR'); }
  function fmtUsd(n) { return '$' + (Number(n) || 0).toFixed(2); }
  function ago(ms, now) {
    if (!ms) return '기록 없음';
    var d = Math.floor((now - ms) / 86400000);
    if (d <= 0) return '오늘';
    if (d === 1) return '어제';
    if (d < 30) return d + '일 전';
    return Math.floor(d / 30) + '개월 전';
  }

  /* ══ 순수 부분 ══════════════════════════════════════════════
     화면과 떼어 놓는다 — 여기가 틀리면 숫자가 조용히 거짓말을 한다.
     logs  : [{ targetUid, targetEmail, targetName, kind, value, prevValue, grantedAtMs }]  최신순
     users : { uid: {…users 문서…} }
     now   : Date.now()
     돌려주는 것: { rows, sum } */
  function buildRows(logs, users, now) {
    var ym = ymOf(new Date(now));
    var byUid = {}, order = [];
    (logs || []).forEach(function (g) {
      var u = g && g.targetUid;
      if (!u) return;
      if (!byUid[u]) {
        /* logs 는 최신순이므로 처음 만난 것이 가장 최근 부여다 */
        byUid[u] = { uid: u, last: g, count: 0, first: g };
        order.push(u);
      }
      byUid[u].count++;
      byUid[u].first = g;          // 계속 덮어쓰면 마지막에 남는 것이 가장 오래된 기록
    });

    var rows = order.slice(0, MAX_USERS).map(function (uid) {
      var e = byUid[uid];
      var g = e.last;
      var d = (users && users[uid]) || null;
      var subs = (d && d.subs) || {};
      /* ☠️ 이번 달 기록일 때만 사용량으로 친다. 위 머리말 참고. */
      var sameMonth = (subs.ym === ym);
      var used = (sameMonth && subs.used) ? subs.used : null;
      var nowPlan = d ? (d.admin === true ? 'admin' : (d.plan || 'free')) : null;
      var lim = planLimit(nowPlan);
      return {
        uid: uid,
        name: (d && (d.nickname || d.displayName)) || g.targetName || g.targetEmail || uid,
        email: (d && (d.email || d.shareCode)) || g.targetEmail || '',
        /* 부여 */
        kind: g.kind || 'plan',
        given: g.value,
        givenPrev: g.prevValue,
        grantedAtMs: g.grantedAtMs || 0,
        grantCount: e.count,
        firstAtMs: (e.first && e.first.grantedAtMs) || 0,
        /* 지금 */
        found: !!d,
        nowPlan: nowPlan,
        paid: !!(d && d.billingPlan),        // 실제 결제로 받은 플랜이 따로 있는가
        paidPlan: (d && d.billingPlan) || '',
        changed: !!(d && g.kind === 'plan' && nowPlan !== g.value),
        lastActiveMs: (d && d.lastActiveMs) || 0,
        /* 사용 */
        ym: subs.ym || '',
        staleUsage: !!(subs.ym && !sameMonth),
        usedSched: used ? (used.sched || 0) : 0,
        usedBlog: used ? (used.blog || 0) : 0,
        limSched: lim ? (lim.sched || 0) : 0,
        limBlog: lim ? (lim.blog || 0) : 0,
        aiCost: sameMonth ? (Number(subs.aiCost) || 0) : 0,
        couponLeft: ((subs.coupon && subs.coupon.sched) || 0) + ((subs.coupon && subs.coupon.blog) || 0)
      };
    });

    var sum = {
      people: rows.length,
      more: Math.max(0, order.length - rows.length),
      plans: {},
      paid: 0,
      changed: 0,
      usedSched: 0,
      usedBlog: 0,
      aiCost: 0,
      activeUsers: 0      // 이번 달에 한 번이라도 쓴 사람
    };
    rows.forEach(function (r) {
      var k = (r.kind === 'admin') ? 'admin' : (r.nowPlan || 'free');
      sum.plans[k] = (sum.plans[k] || 0) + 1;
      if (r.paid) sum.paid++;
      if (r.changed) sum.changed++;
      sum.usedSched += r.usedSched;
      sum.usedBlog += r.usedBlog;
      sum.aiCost += r.aiCost;
      if (r.usedSched > 0 || r.usedBlog > 0) sum.activeUsers++;
    });
    return { rows: rows, sum: sum, ym: ym };
  }

  /* 정렬 — '많이 쓴 순' 은 일정+글 합, 같으면 AI 원가 */
  function sortRows(rows, mode) {
    var a = rows.slice();
    if (mode === 'use') {
      a.sort(function (x, y) {
        var dx = (y.usedSched + y.usedBlog) - (x.usedSched + x.usedBlog);
        return dx || (y.aiCost - x.aiCost);
      });
    } else {
      a.sort(function (x, y) { return (y.grantedAtMs || 0) - (x.grantedAtMs || 0); });
    }
    return a;
  }

  /* ══ 읽어 오기 ══════════════════════════════════════════════ */
  function ts(v) {
    try { if (v && v.toDate) return v.toDate().getTime(); } catch (e) {}
    return (typeof v === 'number') ? v : 0;
  }

  async function collect() {
    var db = Cloud.db, me = Cloud.user.uid;
    var snap = await db.collection('admin_grants').doc(me)
      .collection('log').orderBy('grantedAt', 'desc').limit(LOG_MAX).get();
    var logs = snap.docs.map(function (doc) {
      var g = doc.data() || {};
      return {
        targetUid: g.targetUid || '',
        targetEmail: g.targetEmail || '',
        targetName: g.targetName || '',
        kind: g.kind || 'plan',
        value: g.value,
        prevValue: g.prevValue,
        grantedAtMs: ts(g.grantedAt)
      };
    });

    var uids = [];
    logs.forEach(function (g) { if (g.targetUid && uids.indexOf(g.targetUid) < 0) uids.push(g.targetUid); });
    uids = uids.slice(0, MAX_USERS);

    var users = {};
    await Promise.all(uids.map(function (u) {
      return db.collection('users').doc(u).get().then(function (doc) {
        if (!doc || !doc.exists) return;
        var d = doc.data() || {};
        d.lastActiveMs = ts(d.lastActiveAt);
        users[u] = d;
      }).catch(function () { /* 한 명 못 읽어도 나머지는 보여 준다 */ });
    }));

    return buildRows(logs, users, Date.now());
  }

  /* ══ 화면 ══════════════════════════════════════════════════ */
  var _cache = null;      // 통계 화면이 다시 그려질 때 또 읽지 않게

  function rowHtml(r, now) {
    var isAdm = (r.kind === 'admin');
    var give = isAdm
      ? (r.given ? '👑 관리자 권한' : '관리자 해제')
      : planName(r.given);
    var when = r.grantedAtMs ? new Date(r.grantedAtMs).toLocaleDateString('ko-KR') : '';

    var right;
    if (!r.found) {
      right = '<span style="color:#e5484d;">계정 없음</span>';
    } else if (r.paid) {
      /* 내가 준 뒤에 진짜로 결제한 사람 — 제일 반가운 줄이라 눈에 띄게 */
      right = '<span style="color:#2e9e5b;font-weight:800;">💳 ' + esc(planName(r.paidPlan)) + ' 결제중</span>';
    } else if (r.changed) {
      right = '<span style="color:#e5484d;">현재 ' + esc(planName(r.nowPlan)) + '</span>';
    } else {
      right = '<span style="color:var(--ac);">' + esc(isAdm ? '관리자' : planName(r.nowPlan)) + '</span>';
    }

    /* 사용 줄 — 이번 달 것만. 아니면 왜 비었는지 적는다(0 과 '기록 없음'은 다르다) */
    var use;
    if (!r.found) {
      use = '';
    } else if (r.staleUsage) {
      use = '<span style="color:var(--mu);">이번 달 사용 없음 · 마지막 기록 ' + esc(r.ym) + '</span>';
    } else if (!r.ym) {
      use = '<span style="color:var(--mu);">사용 기록 없음</span>';
    } else if (!r.usedSched && !r.usedBlog) {
      use = '<span style="color:var(--mu);">이번 달 0회</span>';
    } else {
      var p = [];
      p.push('일정 ' + r.usedSched + (r.limSched ? '/' + r.limSched : '') + '회');
      p.push('글 ' + r.usedBlog + (r.limBlog ? '/' + r.limBlog : '') + '회');
      use = '<b>' + esc(p.join(' · ')) + '</b>';
      if (r.aiCost > 0) use += ' <span style="color:var(--mu);">· 원가 ' + esc(fmtUsd(r.aiCost)) + '</span>';
    }

    var sub = [];
    sub.push(give + ' 부여');
    if (r.grantCount > 1) sub.push('변경 ' + r.grantCount + '회');
    if (when) sub.push(when);
    if (r.found && r.lastActiveMs) sub.push('접속 ' + ago(r.lastActiveMs, now));

    return '<div style="padding:9px 0;border-bottom:1px solid var(--bd);">' +
      '<div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;">' +
        '<div style="min-width:0;font-weight:800;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
          esc(r.name) + '</div>' +
        '<div style="flex:0 0 auto;font-size:11px;white-space:nowrap;">' + right + '</div>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--mu);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
        esc(sub.join(' · ')) + '</div>' +
      (use ? '<div style="font-size:11.5px;margin-top:3px;">' + use + '</div>' : '') +
    '</div>';
  }

  function summaryHtml(sum, ym) {
    var order = ['master', 'pro', 'basic', 'lite', 'free', 'admin'];
    var chips = order.filter(function (k) { return sum.plans[k]; }).map(function (k) {
      return '<span style="display:inline-block;background:var(--sf2);border-radius:8px;padding:3px 8px;margin:0 4px 4px 0;font-size:11px;">' +
        esc(k === 'admin' ? '관리자' : planName(k)) + ' ' + sum.plans[k] + '</span>';
    }).join('');
    return '<div style="font-size:12px;line-height:1.7;">' +
      '<div><b>' + sum.people + '명</b>에게 부여' +
        (sum.more ? ' <span style="color:var(--mu);">(' + sum.more + '명 더 있음 — 최근 순으로 ' + sum.people + '명만 표시)</span>' : '') +
      '</div>' +
      '<div style="margin-top:4px;">' + (chips || '<span style="color:var(--mu);">없음</span>') + '</div>' +
      '<div style="margin-top:4px;color:var(--mu);">' +
        '이번 달(' + esc(ym) + ') 실제 사용 <b style="color:var(--tx);">' + sum.activeUsers + '명</b>' +
        ' · 일정 ' + sum.usedSched + '회 · 글 ' + sum.usedBlog + '회' +
        (sum.aiCost > 0 ? ' · 원가 ' + esc(fmtUsd(sum.aiCost)) : '') +
      '</div>' +
      (sum.paid ? '<div style="margin-top:2px;color:#2e9e5b;">그중 ' + sum.paid + '명은 실제 결제로 전환</div>' : '') +
      (sum.changed ? '<div style="margin-top:2px;color:#e5484d;">' + sum.changed + '명은 부여한 것과 지금 플랜이 다름</div>' : '') +
    '</div>';
  }

  /* 통계 화면 안에 넣을 한 줄 요약 — 이미 읽어 둔 게 있으면 바로 그린다 */
  function summaryInto(el) {
    if (!el) return;
    if (_cache) { el.innerHTML = summaryHtml(_cache.sum, _cache.ym); return; }
    el.innerHTML = '<span style="color:var(--mu);font-size:12px;">불러오는 중…</span>';
    collect().then(function (res) {
      _cache = res;
      if (el.isConnected !== false) el.innerHTML = summaryHtml(res.sum, res.ym);
    }).catch(function (e) {
      el.innerHTML = '<span style="color:#e5484d;font-size:12px;">불러오지 못했습니다: ' +
        esc((e && (e.code || e.message)) || '') + '</span>';
    });
  }

  function open() {
    if (!(window.Subs && Subs.isAdmin && Subs.isAdmin())) {
      if (typeof showToast === 'function') showToast('관리자 전용입니다', 'err');
      return;
    }
    if (!(window.Cloud && Cloud.user)) {
      if (typeof showToast === 'function') showToast('먼저 로그인해주세요', 'err');
      return;
    }
    var ov = document.createElement('div');
    /* ⚠️ ov-lock + id 에 'Close' — 하드웨어 뒤로가기가 이걸 보고 닫는다
       (state.js closeTopPopup). 통계(3400) 위에 뜨므로 z 를 더 높인다. */
    ov.className = 'ov-lock';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:3450;' +
      'display:flex;align-items:flex-start;justify-content:center;padding:28px 12px;overflow-y:auto;';
    var body = '<div style="background:var(--sf);border-radius:14px;padding:18px;max-width:460px;width:100%;">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
        '<div style="flex:1;font-size:16px;font-weight:800;">🎟️ 내가 부여한 플랜</div>' +
        '<button class="btn b-ghost" id="agClose">닫기</button>' +
      '</div>' +
      '<div id="agSum" style="margin-bottom:10px;"></div>' +
      '<div style="display:flex;gap:6px;margin-bottom:6px;">' +
        '<button class="btn b-ghost" id="agSortNew" style="flex:1;justify-content:center;font-size:12px;">최근 부여순</button>' +
        '<button class="btn b-ghost" id="agSortUse" style="flex:1;justify-content:center;font-size:12px;">많이 쓴 순</button>' +
      '</div>' +
      '<div id="agList" style="color:var(--mu);font-size:13px;padding:18px 0;text-align:center;">불러오는 중…</div>' +
      '<div style="font-size:10.5px;color:var(--mu);margin-top:10px;line-height:1.6;">' +
        '사용량은 상대 앱이 켜져 있을 때 올라옵니다 — 방금 쓴 건 안 보일 수 있습니다.<br>' +
        '「결제중」은 내가 준 게 아니라 실제 결제로 받은 플랜입니다.' +
      '</div>' +
      '</div>';
    ov.innerHTML = body;
    document.body.appendChild(ov);
    var close = function () { if (ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('#agClose').onclick = close;

    var mode = 'new';
    function paint(res) {
      var now = Date.now();
      ov.querySelector('#agSum').innerHTML = summaryHtml(res.sum, res.ym);
      var list = ov.querySelector('#agList');
      if (!res.rows.length) {
        list.innerHTML = '<div style="color:var(--mu);">아직 부여한 계정이 없습니다.<br>' +
          '<span style="font-size:11px;">설정 ▸ ⭐ 구독 ▸ 🛠️ 사용자 플랜 관리 에서 부여하면 여기에 쌓입니다.</span></div>';
          return;
      }
      list.style.color = ''; list.style.padding = ''; list.style.textAlign = '';
      list.innerHTML = sortRows(res.rows, mode).map(function (r) { return rowHtml(r, now); }).join('');
      var a = ov.querySelector('#agSortNew'), b = ov.querySelector('#agSortUse');
      if (a && b) {
        a.className = 'btn ' + (mode === 'new' ? 'b-blue' : 'b-ghost');
        b.className = 'btn ' + (mode === 'use' ? 'b-blue' : 'b-ghost');
      }
    }
    ov.querySelector('#agSortNew').onclick = function () { mode = 'new'; if (_cache) paint(_cache); };
    ov.querySelector('#agSortUse').onclick = function () { mode = 'use'; if (_cache) paint(_cache); };

    (_cache ? Promise.resolve(_cache) : collect()).then(function (res) {
      _cache = res;
      if (!ov.parentNode) return;
      paint(res);
    }).catch(function (e) {
      if (!ov.parentNode) return;
      ov.querySelector('#agList').innerHTML =
        '<div style="color:#e5484d;">불러오지 못했습니다: ' + esc((e && (e.code || e.message)) || '') + '</div>' +
        '<div style="font-size:11px;color:var(--mu);margin-top:6px;">' +
        'Firestore 규칙에 admin_grants 블록이 게시돼 있는지 확인해주세요.</div>';
    });
  }

  window.AdminGrants = {
    open: open,
    summaryInto: summaryInto,
    refresh: function () { _cache = null; },
    /* 검사용 — 숫자가 틀리면 화면으로는 못 본다 */
    _pure: { buildRows: buildRows, sortRows: sortRows, ymOf: ymOf, MAX_USERS: MAX_USERS,
             summaryHtml: summaryHtml, rowHtml: rowHtml }
  };
})();
