/* ═══════════════════════════════════════════════════════════════
   whatsnew.js — 업데이트 후 처음 열 때 '이번에 바뀐 것' 안내 (2026-08-22)

   version_gate.js 와 짝이다:
     · version_gate = "업데이트 **하세요**" (서버 config/app 의 minVersion/latestVersion)
     · whatsnew     = "업데이트 **됐습니다**" (앱 코드의 APP_VERSION 기준, 여기)

   ⭐ 문구를 앱 코드에 두는 이유(사용자 선택 2026-08-22):
      서버·로그인 없이도 뜨고, 버전과 내용이 어긋날 일이 없다.
      대신 문구를 고치려면 재빌드 — 어차피 버전마다 새로 쓰는 글이라 같이 간다.

   ⚠️ 첫 설치에는 띄우지 않는다. 처음 쓰는 사람에게 '이번에 바뀐 것'은 뜻이 없다.
      판별은 온보딩 완료 플래그로 한다(있으면 = 예전부터 쓰던 사람).
      재설치 복구도 온보딩을 다시 하므로 조용히 넘어간다 — 방금 최신을 깐 사람이라 맞다.

   ⚠️ 저장은 '실제로 보여준 뒤에만' 한다. 다른 팝업(온보딩·업데이트 게이트·설정)이
      떠 있으면 이번 실행은 건너뛰고 다음 실행에 다시 시도한다.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var WN_KEY   = 'ac_whatsnew_seen';           // 마지막으로 안내를 본 버전
  var OB_KEYS  = ['ac_onboarding_done_v2', 'ac_onboarding_done_v1'];

  /* ── 버전별 안내 문구 ──
     키가 없는 버전은 아무것도 띄우지 않고 조용히 기록만 한다. */
  var NOTES = {
    /* ⚠️ 업데이트 안내 작성 방침 (2026-08-24 사용자 명시)
         · **새 기능만** 적는다. '안 되던 것을 고쳤습니다' 류는 넣지 않는다
           (사용자가 몰랐던 결함을 굳이 알릴 이유가 없다).
         · 다만 항목마다 **무엇이 어떻게 달라지는지는 제대로** 적는다 — 제목 한 줄만 던지면
           읽는 사람이 뭘 하라는 건지 모른다. 3.2.0 처럼 제목 + 2문장 + 세부 항목.
         · ⛔ '○○ 기능을 크게 손봤습니다' 같은 총평 lead 는 쓰지 말 것(너무 AI 같다는 지적).
       ★ 3.2.1 은 사용자 결정으로 **안내를 띄우지 않는다**(다음 배포로 미룸).
         NOTES 에 그 버전 키가 없으면 아래 tick() 이 조용히 버전만 기록하고 넘어간다.
         초안은 _bak_archive 의 whatsnew_3.2.1_draft.txt 와 메모 project_login_conversion 에 있다. */
    '3.2.0': {
      lead: '스케줄 달력이 업그레이드 되었습니다.',
      blocks: [
        {
          ic: '📅',
          title: '달력을 아래로 당기면 한 달치가 목록으로',
          body: '날짜별로 시간과 현장 이름이 한 줄씩 펼쳐집니다. ' +
                '줄을 누르면 그 자리에서 작업을 열거나 내용을 고칠 수 있습니다.',
          subs: [
            '달력 아래 손잡이(⌄)를 끌거나 눌러도 펼쳐집니다',
            '펼친 동안에는 오른쪽 아래 ＋ 버튼이 ▲(달력으로)로 바뀝니다',
            '달력 위에 <b>오늘</b> 버튼이 생겼습니다'
          ]
        },
        {
          ic: '👥',
          title: '팀원 요금제가 생겼습니다 · 월 4,900원',
          body: '팀에 참여해 일정과 사진을 함께 쓰는 분들을 위한 요금제입니다. ' +
                '팀 만들기는 안 되고 초대코드로 참여만 됩니다.',
          action: { tx: '요금제 보기', fn: 'plans' }
        }
      ]
    },
    '3.2.3': {
      lead: '라이트 요금제가 더 넉넉해졌습니다.',
      blocks: [
        {
          ic: '💳',
          title: '라이트 요금제에 AI 일정등록 월 50회가 추가됐습니다',
          body: '문자를 붙여넣으면 AI가 날짜·주소·가격을 읽어 일정으로 등록해주는 기능을 ' +
                '라이트 요금제(월 4,900원)에서도 쓸 수 있습니다. ' +
                '팀 만들기는 여전히 베이직(월 9,900원)부터 가능합니다.',
          action: { tx: '요금제 보기', fn: 'plans' }
        }
      ]
    }
  };

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function isOldUser() {
    for (var i = 0; i < OB_KEYS.length; i++) if (get(OB_KEYS[i]) === '1') return true;
    return false;
  }
  /* 다른 팝업이 떠 있으면 지금은 띄우지 않는다 */
  function busy() {
    if (document.getElementById('verGate')) return true;          // 업데이트 게이트
    if (document.getElementById('whatsNewOv')) return true;        // 이미 떠 있음
    var sel = '.ob-modal.open, .co-modal.open, .sl-modal.open, .dlg-backdrop.open';
    try { if (document.querySelector(sel)) return true; } catch (e) {}
    return false;
  }

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  /* ⚠️ 2026-08-22 실측 — zoom 이 걸린 상자 안에서는 `100vh` 가 배율만큼 부푼다.
     (퍼센트 폭은 화면 기준으로 잘 잡히는데, vh 는 요소 좌표계라 ×배율 된다.
      '아주 크게'(1.44)에서 팝업이 화면을 65px 넘어 확인 버튼이 잘렸다.)
     → 화면 px 로 잰 여유 높이를 배율로 나눠 요소 좌표계 값으로 직접 넣는다. */
  function _fitZoomBox(box, z) {
    if (!box) return;
    var avail = Math.max(200, window.innerHeight - 44);
    box.style.maxHeight = Math.floor(avail / (parseFloat(z) || 1)) + 'px';
  }


  function show(ver, note) {
    var body = note.blocks.map(function (b) {
      return '<div class="wn-block">' +
               '<div class="wn-bt"><span class="wn-ic">' + b.ic + '</span>' + b.title + '</div>' +
               '<div class="wn-bd">' + b.body + '</div>' +
               (b.subs ? '<ul class="wn-subs">' + b.subs.map(function (s) {
                   return '<li>' + s + '</li>'; }).join('') + '</ul>' : '') +
               (b.action ? '<button class="wn-act" data-fn="' + b.action.fn + '">' +
                   esc(b.action.tx) + ' ›</button>' : '') +
             '</div>';
    }).join('');

    var ov = document.createElement('div');
    ov.id = 'whatsNewOv';
    ov.className = 'wn-ov';
    ov.innerHTML =
      '<div class="wn-box">' +
        '<div class="wn-head">' +
          '<div class="wn-ver">✨ 업데이트 v' + esc(ver) + '</div>' +
          '<div class="wn-lead">' + esc(note.lead) + '</div>' +
        '</div>' +
        '<div class="wn-body">' + body + '</div>' +
        /* ⚠️ id 에 'Close' 가 들어가야 한다 — state.js closeTopPopup() 이 하드웨어 뒤로가기에서
           button[id*="Close"] 를 찾아 눌러 준다(그래야 노드까지 정리된다). */
        '<div class="wn-foot"><button class="wn-close" id="whatsNewCloseBtn">확인</button></div>' +
      '</div>';
    document.body.appendChild(ov);

    /* 글자 크기(zoom) 승계 — 이 오버레이는 body 직속이라 설정 배율 밖이다.
       ⚠️ 오버레이가 아니라 상자에만 건다(오버레이에 걸면 배경이 화면을 못 덮는다). */
    var _bx = ov.querySelector('.wn-box'), _z = 1;
    try {
      var zs = (document.querySelector('.main') || {}).style;
      if (zs && zs.zoom) { _bx.style.zoom = zs.zoom; _z = parseFloat(zs.zoom) || 1; }
    } catch (e) {}
    _fitZoomBox(_bx, _z);

    requestAnimationFrame(function () { ov.classList.add('open'); });
    set(WN_KEY, ver);                       // ★ 실제로 띄운 뒤에만 기록한다

    function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
    ov.addEventListener('click', function (e) {
      if (e.target === ov || (e.target.classList && e.target.classList.contains('wn-close'))) { close(); return; }
      var b = e.target.closest && e.target.closest('.wn-act');
      if (!b) return;
      close();
      if (b.getAttribute('data-fn') === 'plans') {
        setTimeout(function () {
          try {
            if (window.Subs && Subs.openPlans) Subs.openPlans();
            else if (typeof showToast === 'function') showToast('설정 ▸ 요금제에서 볼 수 있습니다', 'warn');
          } catch (err) {}
        }, 220);
      }
    });
    /* 하드웨어 뒤로가기는 state.js 의 closeTopPopup() 이 알아서 처리한다
       (position:fixed · z-index≥1000 · 화면 대부분을 덮는 오버레이를 찾아 닫기 버튼을 누른다). */
  }

  var tries = 0;
  function tick() {
    var ver = String(window.APP_VERSION || '');
    if (!ver) { if (++tries < 20) setTimeout(tick, 800); return; }
    var note = NOTES[ver];
    var seen = get(WN_KEY);

    // 첫 설치 = 조용히 현재 버전만 기록하고 끝 (이번에 바뀐 것을 알릴 대상이 아니다)
    if (!seen && !isOldUser()) { set(WN_KEY, ver); return; }
    if (seen === ver) return;                 // 이 버전 안내는 이미 봤다
    if (!note) { set(WN_KEY, ver); return; }  // 이 버전에 쓸 문구가 없다

    if (busy()) { if (++tries < 20) setTimeout(tick, 900); return; }   // 다음 실행에 다시 시도
    show(ver, note);
  }

  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(tick, 2600);   // version_gate(2000ms) 가 먼저 판단하도록 뒤에 선다
  });
})();
