/* ═══════════════════════════════════════════════
   admin_stats.js — 관리자 전용 통계 화면
   - users/{uid}.admin === true 인 관리자만 사용
   - Cloud Function adminStats(POST + Firebase ID 토큰)로 서버에서 집계값만 받아옴
   - 비밀 키/결제권한은 서버(Cloud Function)에만 있고 앱엔 없음
═══════════════════════════════════════════════ */
(function () {
  window.AdminStats = window.AdminStats || {};
  var FN_URL = 'https://asia-northeast3-work-report-826ec.cloudfunctions.net/adminStats';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function fmtUsd(n) { n = Number(n) || 0; return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtKrw(n) { n = Math.round(Number(n) || 0); return '₩' + n.toLocaleString('ko-KR'); }
  /* 증감 화살표 — Play Console 대시보드처럼 이전 28일 대비 */
  function delta(now, prev) {
    if (now == null || prev == null || !prev) return '';
    var d = Math.round(((now - prev) / prev) * 100);
    if (!isFinite(d) || d === 0) return ' <span style="color:var(--mu);">±0%</span>';
    var up = d > 0;
    return ' <span style="color:' + (up ? '#2e9e5b' : '#d9534f') + ';">' + (up ? '↑' : '↓') + Math.abs(d) + '%</span>';
  }
  function fmtBytes(b) { b = Number(b) || 0; if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB'; if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB'; if (b >= 1024) return (b / 1024).toFixed(0) + ' KB'; return b + ' B'; }
  function card(inner) { return '<div style="background:var(--sf);border-radius:14px;padding:20px;max-width:420px;width:100%;max-height:calc(100vh - 44px);overflow-y:auto;-webkit-overflow-scrolling:touch;">' + inner + '</div>'; }
  function row(label, val, sub) {
    return '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:9px 0;border-bottom:1px solid var(--sf2,#eee);">' +
      '<span style="font-size:13px;color:var(--mu);flex-shrink:0;">' + esc(label) + '</span>' +
      '<span style="font-size:14px;font-weight:800;text-align:right;">' + val + (sub ? ('<br><span style="font-size:11px;font-weight:400;color:var(--mu);">' + sub + '</span>') : '') + '</span>' +
    '</div>';
  }
  function sechead(t) { return '<div style="font-size:12px;font-weight:800;color:var(--ac);margin:14px 0 4px;">' + t + '</div>'; }
  function _thisYm() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function _manualClaude() { try { var o = JSON.parse(localStorage.getItem('admin_claude_cost') || 'null'); return (o && o.ym === _thisYm()) ? o : null; } catch (e) { return null; } }
  function _editClaudeCost(ov, j) {
    var cur = _manualClaude();
    var m = document.createElement('div');
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:3500;display:flex;align-items:center;justify-content:center;padding:24px;';
    m.innerHTML = '<div style="background:var(--sf);border-radius:14px;padding:20px;max-width:320px;width:100%;">' +
      '<div style="font-size:15px;font-weight:800;margin-bottom:8px;">🤖 Claude 사용금액 입력</div>' +
      '<div style="font-size:12px;color:var(--mu);line-height:1.6;margin-bottom:12px;">Anthropic 콘솔 → 사용량·비용에서 확인한 <b>이번 달</b> 금액(USD)을 입력하세요. (개인 조직이라 API 자동조회가 안 되어 수동 입력합니다)</div>' +
      '<input id="ccInput" type="number" inputmode="decimal" step="0.01" min="0" value="' + (cur ? esc(cur.amount) : '') + '" placeholder="예: 1.21" style="width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:1px solid var(--bd,#ccc);background:var(--sf2,#f4f4f4);color:var(--tx);font-size:15px;margin-bottom:12px;">' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
        '<button class="btn b-ghost" id="ccClear">지우기</button>' +
        '<button class="btn b-ghost" id="ccCancel">취소</button>' +
        '<button class="btn b-blue" id="ccSave">저장</button>' +
      '</div></div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) { if (e.target === m) m.remove(); });
    var inp = m.querySelector('#ccInput'); try { inp.focus(); } catch (e) {}
    m.querySelector('#ccCancel').onclick = function () { m.remove(); };
    m.querySelector('#ccClear').onclick = function () { try { localStorage.removeItem('admin_claude_cost'); } catch (e) {} m.remove(); render(ov, j, null); };
    m.querySelector('#ccSave').onclick = function () {
      var v = parseFloat(inp.value); if (isNaN(v) || v < 0) v = 0;
      try { localStorage.setItem('admin_claude_cost', JSON.stringify({ amount: v, ym: _thisYm() })); } catch (e) {}
      m.remove(); render(ov, j, null);
    };
  }

  // ── 공유 진단: 팀장 계정으로 직접 Firestore를 읽어 팀원별 상태/작업수를 확인 ──
  async function _diagShare() {
    var lines = [];
    function P(x){ lines.push(x); }
    try {
      var me = Cloud.user.uid;
      P('내 uid: ' + me.slice(0, 10));
      var myDoc = await Cloud.db.collection('users').doc(me).get();
      var myTeamIds = (myDoc.data() || {}).teamIds || [];
      P('내 teamIds: ' + (myTeamIds.length ? JSON.stringify(myTeamIds) : '(없음!)'));
      if (window.CloudShare && CloudShare.getSharedPartnerUids) {
        var subs = CloudShare.getSharedPartnerUids();
        P('구독 중 파트너 수: ' + subs.length);
      }
      P('──────────');
      // 내 작업(클라우드) 상태 - 회귀로 휴지통 이동됐는지 확인
      try {
        var myItems = await Cloud.db.collection('schedules').doc(me).collection('items').get();
        var myTot = 0, myTr = 0, myCl = 0;
        myItems.forEach(function (d) { var v = d.data() || {}; myTot++; if (v.trashed) myTr++; if (v.cleanupTrashed) myCl++; });
        P('내 작업(클라우드): 총 ' + myTot + ' · 휴지통 ' + myTr + ' (자동정리 ' + myCl + ')');
      } catch (e) { P('내 작업 읽기 실패: ' + (e.code || e.message)); }
      P('──────────');
      var seen = {};
      for (var ti = 0; ti < myTeamIds.length; ti++) {
        var teamId = myTeamIds[ti];
        var t = await Cloud.db.collection('teams').doc(teamId).get();
        var td = t.exists ? (t.data() || {}) : {};
        var members = td.members || [];
        P('팀 ' + String(teamId).slice(0, 8) + ' · 멤버 ' + members.length + '명');
        for (var mi = 0; mi < members.length; mi++) {
          var m = members[mi];
          if (m === me || seen[m]) continue;
          seen[m] = 1;
          var mu = await Cloud.db.collection('users').doc(m).get();
          var md = mu.exists ? (mu.data() || {}) : {};
          var mTeamIds = md.teamIds || [];
          var email = md.email || '(이메일없음)';
          var intersect = myTeamIds.some(function (x) { return mTeamIds.indexOf(x) >= 0; });
          var cnt = '?', withDate = 0;
          try {
            var items = await Cloud.db.collection('schedules').doc(m).collection('items').get();
            cnt = items.size;
            var detail = [];
            items.forEach(function (d) {
              var v = d.data() || {};
              if (v.date) withDate++;
              detail.push('    - ' + (v.date || '?') + ' ' + String(v.apt || '').slice(0, 10) +
                (v.trashed ? ' [휴지통]' : '') + (v.claimedBy ? ' [claimed]' : '') + (v.manual ? ' [수동]' : ''));
            });
          } catch (e) { cnt = '읽기실패(' + (e.code || e.message) + ')'; }
          P('· ' + email);
          P('   teamIds:' + (mTeamIds.length ? 'O' : 'X(없음!)') + ' 교집합:' + (intersect ? 'O' : 'X') + ' plan:' + (md.plan || 'free'));
          P('   내가 읽는 작업수: ' + cnt + ' (날짜있음 ' + withDate + ')');
          if (typeof detail !== 'undefined') detail.forEach(function (x) { P(x); });
        }
      }
      if (!myTeamIds.length) P('⚠️ 팀이 없습니다. 설정에서 팀 공유를 먼저 확인하세요.');
    } catch (e) {
      P('진단 오류: ' + (e && (e.code || e.message)));
    }
    var m = document.createElement('div');
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:3600;display:flex;align-items:center;justify-content:center;padding:18px;';
    m.innerHTML = '<div style="background:var(--sf);border-radius:14px;padding:18px;max-width:420px;width:100%;max-height:82vh;overflow:auto;">' +
      '<div style="font-size:15px;font-weight:800;margin-bottom:10px;">🔧 공유 진단</div>' +
      '<pre style="white-space:pre-wrap;word-break:break-all;font-size:12px;line-height:1.6;margin:0;color:var(--tx);">' + esc(lines.join('\n')) + '</pre>' +
      '<div style="text-align:right;margin-top:12px;"><button class="btn b-ghost" id="dgClose">닫기</button></div></div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) { if (e.target === m) m.remove(); });
    m.querySelector('#dgClose').onclick = function () { m.remove(); };
  }

  AdminStats.open = async function () {
    if (!(window.Subs && Subs.isAdmin && Subs.isAdmin())) { if (typeof showToast === 'function') showToast('관리자 전용입니다', 'err'); return; }
    if (!(window.Cloud && Cloud.user)) { if (typeof showToast === 'function') showToast('먼저 로그인해주세요', 'err'); return; }
    var ov = document.createElement('div');
    ov.id = 'adminStatsOv';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:3400;display:flex;align-items:center;justify-content:center;padding:16px;';
    ov.innerHTML = card('<div style="text-align:center;padding:34px 0;color:var(--mu);font-size:14px;">📊 통계 불러오는 중...</div>');
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
    try {
      var token = await Cloud.user.getIdToken();
      var r = await fetch(FN_URL, { method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}' });
      var j = await r.json();
      if (!r.ok || !j.ok) throw new Error((j && (j.error || j.reason)) || ('HTTP ' + r.status));
      render(ov, j, null);
    } catch (e) {
      render(ov, null, String((e && e.message) || e));
    }
  };

  function render(ov, j, err) {
    if (err || !j) {
      ov.innerHTML = card(
        '<div style="font-size:16px;font-weight:800;margin-bottom:10px;">📊 관리자 통계</div>' +
        '<div style="color:var(--dn,#e5484d);font-size:13px;line-height:1.6;">불러오기 실패: ' + esc(err || '알 수 없음') + '</div>' +
        '<div style="font-size:11px;color:var(--mu);margin-top:8px;line-height:1.6;">함수 배포·Admin 키 시크릿·Monitoring API 활성화 상태를 확인해주세요.</div>' +
        '<div style="text-align:right;margin-top:14px;"><button class="btn b-ghost" id="asClose">닫기</button></div>');
      ov.querySelector('#asClose').onclick = function () { ov.remove(); };
      return;
    }
    /* ★ 2026-08-23 '수동 지정 제외' 토글 — 서버가 결제만 센 값(users.paid)도 같이 보내므로
         서버 왕복 없이 갈아 끼운다. 선택은 localStorage 에 기억한다. */
    var _po = false;
    try { _po = localStorage.getItem('admin_stats_paid_only') === '1'; } catch (e) {}
    var _u0 = j.users || {}, _pd = _u0.paid || null;
    if (_po && _pd) {
      _u0 = Object.assign({}, _u0, { planCounts: _pd.planCounts, activeSub: _pd.activeSub, mrrKrw: _pd.mrrKrw });
    }
    var u = _u0, pc = u.planCounts || {}, ai = u.ai || {}, c = j.claude || {}, s = j.storage || {}, pl = j.play || {}, er = j.earnings || {};
    var aiTotal = (Number(ai.sched) || 0) + (Number(ai.blog) || 0);
    var h = '';
    h += '<div style="display:flex;align-items:center;margin-bottom:6px;"><div style="flex:1;font-size:16px;font-weight:800;">📊 관리자 통계</div><button class="btn b-ghost" id="asClose">닫기</button></div>';

    h += sechead('👥 사용자');
    if (_pd) {
      h += '<label style="display:flex;align-items:center;gap:8px;padding:8px 0 4px;font-size:12px;color:var(--mu);cursor:pointer;">' +
        '<input type="checkbox" id="asPaidOnly"' + (_po ? ' checked' : '') + '>' +
        '<span>내가 직접 부여한 플랜 제외 (실제 결제만)' +
        (_pd.manualGranted ? ('<b style="color:var(--ac);"> · ' + _pd.manualGranted + '명 해당</b>') : '') +
        '</span></label>';
    }
    var _acct = (u.authTotal != null) ? u.authTotal : (u.total || 0);
    h += row('가입 사용자(계정)', _acct + '명', '로그인·회원가입 기준 · 설치만 하고 미로그인은 제외');
    if (u.authTotal != null && u.total != null && u.authTotal !== u.total) {
      h += row('프로필 문서', (u.total || 0) + '개', '프로필 생성 완료 계정');
    }
    /* ★ 2026-08-23 '설치 사용자 수'(활성 기기 설치)는 반영이 너무 느려 제거하고,
         Play Console 대시보드와 같은 '기기 획득 수(최근 28일)'로 바꿨다.
         일별 Daily Device Installs 를 28일 합산하므로 하루 단위로 움직인다. */
    /* ★ 2026-08-23 획득 리포트(store_performance)가 대시보드 '기기 획득 수'의 출처다.
         installs 리포트에는 그 값이 없다(진단으로 확인). 있으면 그걸 쓰고, 없으면 설치 수로 떨어진다. */
    var _pf = pl.perf || {};
    var _acq = (_pf.available && _pf.acq28 != null) ? _pf.acq28 : pl.acq28;
    var _acqPrev = (_pf.available && _pf.acq28 != null) ? _pf.acqPrev28 : pl.acqPrev28;
    var _acqDate = (_pf.available && _pf.acq28 != null) ? (_pf.lastDate || '') : (pl.lastDate || '');
    var _acqSrc = (_pf.available && _pf.acq28 != null) ? ('획득 리포트 · ' + esc(_pf.column || '')) : '설치 수 기준(획득 리포트 없음)';
    var _lagTxt = '';
    try {
      if (_acqDate) {
        var _d = Math.round((Date.now() - new Date(_acqDate + 'T00:00:00Z').getTime()) / 86400000);
        if (_d > 0) _lagTxt = ' · ' + _d + '일 지연';
      }
    } catch (e) {}
    if (pl.available && _acq != null) {
      h += row('기기 획득 수 (Play)', _acq.toLocaleString('ko-KR') + '개' + delta(_acq, _acqPrev),
               '최근 28일 · ' + esc(_acqDate) + '까지' + _lagTxt + '<br>' + _acqSrc);
    } else if (pl.available) {
      h += row('기기 획득 수 (Play)', '<span style="color:var(--mu);">컬럼 미확인</span>',
               '리포트 컬럼명이 바뀐 것 같습니다: ' + esc((pl.headers || []).join(', ')));
    } else {
      h += row('기기 획득 수 (Play)', '<span style="color:var(--mu);">미설정</span>', esc(pl.reason || ''));
    }
    /* ★ 2026-08-23 진단 블록 제거 — 정답을 찾았다.
         installs 리포트에는 대시보드의 '기기 획득 수'가 없고,
         획득 리포트(store_performance)의 'Store listing acquisitions' 가 그 값이다.
       ⚠️ 다만 획득 리포트는 지연이 크다(실측 14일). 대시보드의 최근 28일과는
          창이 어긋나므로 숫자가 바로 같아지지 않는다 — 리포트가 채워지면 수렴한다.
          다시 대조해야 하면 pl.perf.sums28 / pl.sums28 을 그대로 뿌리면 된다. */
    h += row('활성 구독자', (u.activeSub || 0) + '명');
    h += row('플랜 분포', '무료 ' + (pc.free || 0) + ' · 팀원 ' + (pc.lite || 0) + ' · Basic ' + (pc.basic || 0) + '<br>Pro ' + (pc.pro || 0) + ' · Master ' + (pc.master || 0) + (pc.other ? (' · 기타 ' + pc.other) : ''));

    /* ★ 2026-08-23 수익 섹션 신설.
         두 숫자는 성격이 다르다 — 섞어 보면 안 된다.
           · 월 예상 수익(MRR) = 지금 구독 구성 × 요금. 실시간이지만 수수료·환불 반영 전.
           · Play 확정 수익      = earnings 리포트. 정확하지만 다음 달 5일경에야 나온다. */
    h += sechead('💰 수익');
    var _mrr = Number(u.mrrKrw || 0);
    h += row('월 예상 수익', fmtKrw(_mrr),
             '현재 구독 구성 기준 · 수수료·환불 반영 전 · 세금 별도');
    if (er.available) {
      h += row('Play 확정 수익', fmtKrw(er.amount) + (er.currency && er.currency !== 'KRW' ? (' ' + esc(er.currency)) : ''),
               esc((er.ym || '').replace(/(\d{4})(\d{2})/, '$1-$2')) + ' 확정분 · 구글 수수료·환불 차감 후 · ' + (er.rows || 0) + '건');
    } else {
      h += row('Play 확정 수익', '<span style="color:var(--mu);">대기</span>',
               esc(er.reason || '다음 달 5일경 생성됩니다'));
    }

    h += sechead('🤖 Claude AI');
    var mc = _manualClaude();
    var meterCost = Number(ai.costUsd || 0);
    var _tk = function (n) { return (Number(n) || 0).toLocaleString('en-US'); };
    if (c.available) {
      h += row('이번 달 사용금액', fmtUsd(c.monthToDate) + ' ' + (c.currency || 'USD'), '월초~현재 · 조직 전체');
    } else if (meterCost > 0) {
      h += row('이번 달 사용금액', '≈ ' + fmtUsd(meterCost) + ' USD', '앱 집계 · 전체 사용자 토큰 기준(추정) · 입력 ' + _tk(ai.tokIn) + ' / 출력 ' + _tk(ai.tokOut) + ' 토큰');
    } else if (mc) {
      h += row('이번 달 사용금액', fmtUsd(mc.amount) + ' USD <button class="btn b-ghost" id="claudeCostEdit" style="padding:2px 8px;font-size:11px;margin-left:6px;">수정</button>', '수동 입력 · 콘솔 기준 · ' + _thisYm());
    } else {
      h += row('이번 달 사용금액', '<button class="btn b-ghost" id="claudeCostEdit" style="padding:3px 10px;font-size:12px;">✏️ 금액 입력</button>', '토큰 집계 대기(AI 호출 발생 시 자동 누적) · 또는 콘솔 금액 직접 입력');
    }
    h += row('이번 달 AI 호출(앱 기록)', aiTotal + '회', '일정추출 ' + (ai.sched || 0) + ' · 글작성 ' + (ai.blog || 0));

    h += sechead('💾 Firebase Storage');
    if (s.available) {
      h += row('사용 용량', fmtBytes(s.bytes), (s.gb != null ? ((s.gb || 0) + 'GB / 무료 5GB') : ''));
      var _c = Number(s.estMonthlyCostUsd) || 0;
      var _cs = (_c > 0 && _c < 0.01) ? ('$' + _c.toFixed(4)) : fmtUsd(_c);
      var _free = (Number(s.gb) || 0) <= 5;
      h += row('예상 월 비용', _cs + ' USD', '추정 · ' + (s.gb || 0) + 'GB × $' + s.rate + '/GB' + (_free ? ' · 무료 한도(5GB) 내라 실제 청구는 $0' : '') + (s.note ? (' · ' + esc(s.note)) : ''));
    } else { h += row('사용 용량', '<span style="color:var(--mu);">미설정</span>', esc(s.reason || '')); }

    h += '<div style="text-align:center;margin-top:14px;"><button class="btn b-ghost" id="asDiag" style="font-size:12px;">🔧 공유 진단 (팀원 작업 표시 문제)</button></div>';
    h += '<div style="font-size:10px;color:var(--mu);margin-top:10px;text-align:center;">생성: ' + esc((j.generatedAt || '').replace('T', ' ').slice(0, 16)) + ' · 금액은 참고용(추정 포함)</div>';
    ov.innerHTML = card(h);
    ov.querySelector('#asClose').onclick = function () { ov.remove(); };
    var _pob = ov.querySelector('#asPaidOnly');
    if (_pob) _pob.onchange = function () {
      try { localStorage.setItem('admin_stats_paid_only', this.checked ? '1' : '0'); } catch (e) {}
      render(ov, j);   // 받아둔 데이터로 다시 그리기만 한다(서버 재호출 없음)
    };
        var _cce = ov.querySelector('#claudeCostEdit'); if (_cce) _cce.onclick = function () { _editClaudeCost(ov, j); };
    var _dg = ov.querySelector('#asDiag'); if (_dg) _dg.onclick = function () { _diagShare(); };
  }
})();
