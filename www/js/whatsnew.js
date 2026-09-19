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
    },
    '3.2.4': {
      lead: '고객 정보에 이름을 남길 수 있습니다.',
      blocks: [
        {
          ic: '🙍',
          title: '고객 정보에 이름 칸이 추가됐습니다',
          body: '작업화면 고객 정보와 일정 정보수정 창에서 전화번호 위에 이름을 입력할 수 있습니다. ' +
                '고객 목록에도 그대로 반영되고, 공유 중인 팀원에게도 함께 보입니다.'
        }
      ]
    },
    /* ★ 2026-09-07 요금제 개편(subscription.js PLANS 참고).
         ⚠️ 방침상 '고쳤습니다'는 안 적지만, **한도를 조정한 사실은 적는다** —
            나중에 "말도 없이 줄였다"가 되면 그게 훨씬 나쁘다. 지금은 구독자가 0명이라
            실제로 손해 보는 사람이 없으니, 이 배포에 같이 알리는 게 가장 싸다. */
    '3.2.10': {
      lead: '라이트 요금제로도 팀을 만들 수 있습니다.',
      blocks: [
        {
          ic: '👥',
          title: '팀 만들기가 라이트(월 4,900원)부터 열렸습니다',
          body: '팀을 만들려면 베이직(월 9,900원) 이상이어야 했는데, 이제 라이트에서도 만들 수 있습니다. ' +
                '라이트에는 AI 글작성 월 10회도 함께 들어갔습니다.',
          subs: [
            '팀 인원은 <b>팀장을 포함해</b> 라이트 2명 · 베이직 3명 · 프로 5명 · 마스터 10명입니다',
            '팀원도 각자 라이트 이상이어야 참여할 수 있는 점은 그대로입니다',
            '요금제별 AI 사용 횟수를 함께 조정했습니다 — 요금제 화면에서 확인하실 수 있습니다'
          ],
          action: { tx: '요금제 보기', fn: 'plans' }
        }
      ]
    },
    /* ★ 2026-09-08 모바일 블로그 올리기 방식 변경.
         ☠️ 방침상 '고쳤습니다'는 안 적지만, **사진을 직접 넣어야 한다는 것**은
            반드시 알려야 한다. 예전 안내대로 PC 링크에서 붙여넣기만 하면
            24시간 뒤에 발행된 글의 사진이 전부 깨진다(사용자가 실제로 겪음). */
    '3.2.15': {
      lead: '블로그에 올리는 순서가 달라졌습니다.',
      blocks: [
        {
          ic: '🖼',
          title: '글 결과 화면에서 사진 자리를 볼 수 있습니다',
          body: '지금까지는 (사진: 🔴 작업 전 1) 같은 표시만 보였는데, ' +
                '이제 그 자리에 실제 사진이 들어간 모습을 보여 줍니다.',
          subs: [
            '복사되는 글에는 표시가 그대로 남습니다 — 사진을 끼울 자리를 알려주는 표시입니다'
          ]
        },
        {
          ic: '📱',
          title: '모바일은 사진을 갤러리에 저장해서 넣습니다',
          body: '네이버로 사진을 공유하면 글쓰기 화면 맨 위에 전부 몰려서 하나씩 ' +
                '끌어 내려야 했습니다. 이제 올리기 창의 버튼이 둘로 나뉩니다.',
          subs: [
            '1️⃣ 갤러리에 저장 → 2️⃣ 글 복사 + 공유 순서로 누르세요',
            '네이버에 글을 붙여넣고, 표시된 자리에서 [사진]으로 갤러리 사진을 넣습니다',
            '공유 버튼을 누르면 <b>참고용 화면</b>이 밑에 깔립니다 — 갤러리에서 헷갈리면 최근앱으로 돌아와 보세요'
          ]
        },
        {
          ic: '💻',
          title: 'PC 링크로 올릴 때는 사진을 꼭 바꿔 주세요',
          body: '붙여넣은 사진은 임시 주소만 들어가 있습니다. 그대로 두면 하루 뒤 ' +
                '블로그에서 사진이 사라집니다.',
          subs: [
            'PC 링크 페이지에 <b>사진 내려받기</b> 버튼을 넣었습니다',
            '블로그에 붙은 사진을 눌러 [교체] → 내려받은 같은 사진을 고르면 됩니다',
            '교체하지 않고 링크만 두면 저품질의 원인이 됩니다'
          ]
        }
      ]
    },
    /* ★ 2026-09-17 지도 기능.
         ⚠️ 이 키는 **실제로 스토어에 올리는 버전과 같아야** 뜬다(tick 이 NOTES[APP_VERSION]
            로 정확히 찾는다). 배포 전에 버전을 더 올리면 키도 같이 옮길 것 —
            안 옮기면 안내가 조용히 안 뜬다.
         ⚠️ 2026-09-18 — 여기 '있지도 않은 bump-version.js 가 경고해 준다'고 적혀 있었다.
            실제로 확인해 주는 것은 `npm run release`(tools/release.js) 다. 빌드 전에
            이 키가 지금 버전에 있는지 보고 없으면 경고한다(막지는 않는다 — 일부러
            안 띄우는 버전도 있다. 위 3.2.1 참고). */
    '3.2.31': {
      lead: '그날 갈 곳을 지도로 볼 수 있습니다.',
      blocks: [
        {
          ic: '🗺',
          title: '날짜를 누르면 나오는 목록에 [동선 보기]가 생겼습니다',
          body: '그날 갈 곳들이 시간 순서대로 번호가 붙어 지도에 찍히고, ' +
                '지금 계신 자리에서 출발하는 선이 함께 그려집니다. ' +
                '아래 카드를 옆으로 넘기면서 가고 싶은 곳의 길안내를 바로 누를 수 있습니다.',
          subs: [
            '작업이 <b>하나라도 있는 날</b>이면 [동선 보기]가 보입니다',
            '카드마다 앞 지점에서 여기까지의 <b>거리와 걸리는 시간</b>이 적힙니다',
            '내 위치를 쓰려면 위치 권한이 필요합니다 — 거절하셔도 지도는 그대로 보입니다',
            '길안내를 누르면 카카오맵·티맵·네이버 등 깔려 있는 앱 중에서 고르게 됩니다',
            '주소가 없는 작업은 카드 끝에 따로 모입니다 — 눌러서 바로 주소를 넣을 수 있습니다'
          ]
        },
        {
          ic: '📍',
          title: '주소 칸에서 지도를 열어 주소를 넣습니다',
          body: '주소 칸 오른쪽에 지도 버튼이 생겼습니다. 이름이나 주소로 찾아서 고르거나, ' +
                '지도에서 빈 곳을 길게 눌러 그 자리 주소를 넣을 수 있습니다.',
          subs: [
            '새로 지은 곳이나 골목 안처럼 검색으로 안 나오는 자리도 길게 눌러 넣을 수 있습니다',
            '고른 자리는 아래에서 한 번 확인하고 [이 주소 쓰기]를 눌러야 들어갑니다',
            '주소를 넣어 둔 작업만 지도에 찍힙니다'
          ]
        },
        {
          ic: '🏠',
          title: '집과 회사를 넣어 두면 지도에서 바로 출발합니다',
          body: '지도 위쪽 [집]·[회사] 버튼을 누르면 길안내가 곧바로 열립니다. ' +
                '[복귀 집]·[복귀 회사]를 켜면 마지막 작업에서 돌아가는 길까지 동선에 들어갑니다.',
          subs: [
            '버튼을 <b>길게 누르면</b> 주소를 등록·수정합니다 (설정 → 내 장소에서도 됩니다)',
            '복귀는 둘 중 하나만 켜집니다 — 켜진 것을 다시 누르면 꺼집니다',
            '이 주소는 이 휴대폰에만 저장되고 팀원에게 보이지 않습니다'
          ]
        },
        /* ★ 2026-09-18 일정 동기화.
           ⚠️ 사용자에게 설명할 것은 '무엇이 달라졌는가'지 '무엇을 고쳤는가'가 아니다.
              자가복구·내용 대조·규칙 같은 말은 적지 않는다 — 알아도 할 일이 없다.
              대신 **버튼이 생겼다는 것**과 **언제 누르면 되는지**만 적는다. */
        {
          ic: '⟳',
          title: '팀원과 일정이 다르면 [스케줄] 위의 ⟳ 를 누르세요',
          body: '내 일정을 서버와 처음부터 다시 맞춥니다. ' +
                '평소에는 앱이 알아서 맞추지만, 어긋난 것이 보이면 직접 누를 수 있습니다.',
          subs: [
            '일정이 며칠째 안 올라가고 있으면 화면 위에 한 줄로 알려 드립니다',
            '팀원이 고친 내용이 내 폰에 안 들어와 있으면 그것도 알려 드립니다',
            '저장 폴더가 연결되어 있어야 합니다'
          ]
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
