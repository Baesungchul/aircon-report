/* ═══════════════════════════════════════════════════════════════════
   manual.js — 사용 설명서 **화면**  (2026-09-19)
   ----------------------------------------------------------------
   설정 ▸ ℹ️ 현장매니저 소개 ▸ [사용 설명서 보기] 에서 열린다.
   큰제목만 죽 보이고, 누르면 그 밑이 펼쳐진다(한 번에 하나만).

   ⭐ 글은 여기 없다 — manual_data.js 에 있다. 이 파일은 그리기만 한다.
      나눠 둔 이유: 설명서는 앞으로 계속 고쳐야 하는데, 고칠 때마다
      화면 코드를 건드리면 멀쩡하던 화면이 같이 깨진다.

   ⚠️ ov-lock — 하드웨어 뒤로가기와 뒷화면 스크롤 잠금이 이 표식을 본다.
      닫기 버튼 id 에 'Close' 가 들어가야 state.js 의 closeTopPopup 이
      **내부 정리를 거쳐** 닫는다(그냥 노드를 지우면 잠금이 안 풀린다).
      (state.js closeTopPopup 주석 참고)

   ⚠️ 한 번에 하나만 펼친다. 여러 개가 열리면 스크롤 위치가 제멋대로 튀어
      '내가 뭘 보고 있었지' 가 된다 — 설명서에서 그게 제일 나쁘다.

   ☠️ 그림이 없는 칸(src:'')은 **아무것도 그리지 않는다**. 빈 액자를 보여 주면
      덜 만든 앱으로 보이기 때문. 그림을 채워 넣는 동안 자리를 보고 싶으면
      머리줄 제목을 다섯 번 누른다(슬롯 보기). 이 상태는 localStorage 에
      남으므로, 켜 둔 채 배포하지 않도록 조심할 것 — 검사가 기본값이 꺼짐인지 본다.
═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var SLOT_KEY = 'ac_manual_slots';   // '1' 이면 빈 그림 자리를 보여 준다(만드는 사람용)
  var IMG_DIR = 'assets/manual/';     // 파일 이름만 적었을 때 붙는 앞자리

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* 설명 안의 **굵게** 만 봐준다.
     ⚠️ 반드시 esc 를 **먼저** 돌린 뒤에 별표를 바꾼다. 순서가 바뀌면
        글 속의 <b> 가 살아나 글자가 통째로 HTML 이 된다(검사가 이걸 본다).
     ⚠️ 다른 표시(기울임·링크)는 일부러 안 넣었다 — 설명서에 필요 없고,
        늘리면 여기가 작은 HTML 해석기가 된다. */
  function md(s) {
    return esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  }

  function slotsOn() {
    try { return localStorage.getItem(SLOT_KEY) === '1'; } catch (e) { return false; }
  }
  function setSlots(on) {
    try {
      if (on) localStorage.setItem(SLOT_KEY, '1'); else localStorage.removeItem(SLOT_KEY);
    } catch (e) {}
  }

  /* 파일 이름만 적혀 있으면 assets/manual/ 을 붙인다.
     이미 주소 꼴이면(그리고 data:/절대경로면) 그대로 쓴다 — 나중에 웹에 올려 쓸 수도 있으니. */
  function srcOf(v) {
    v = String(v || '').trim();
    if (!v) return '';
    if (/^(https?:)?\/\//i.test(v) || /^data:/i.test(v) || v.charAt(0) === '/') return v;
    return IMG_DIR + v;
  }

  /* 그림 묶음 하나 → HTML. 넣을 게 없으면 빈 글자를 돌려준다.
     ⚠️ 여기서 '빈 액자를 그리지 않는다'는 약속이 지켜진다 — 이 함수 한 곳뿐이다.

     ☠️ 2026-09-20 세로 그림 문제.
        휴대폰 화면을 통째로 찍으면 9:19.5 다. 그걸 width:100% 로 두면 390px 폭에서
        높이가 845px — **설명 한 줄 읽자고 한 화면을 넘겨야 한다.**
        게다가 빈 액자는 가로로 납작해서, 만드는 사람이 "이 비율로 어떻게 넣지" 가 된다.
     → 가로/세로를 **그림을 실제로 불러와서** 판단한다(onload). 사람이 표시를 빠뜨려도
        알아서 맞는다. 세로면 폭을 묶고 가운데에 놓고, 눌러서 크게 볼 수 있게 한다.
     ⚠️ 판단 기준을 1.0 이 아니라 1.2 로 둔다. 정사각에 가까운 조각(보고서 한 쪽 등)까지
        좁게 묶으면 오히려 작아져서 안 보인다.
     ⚠️ shape:'tall' 은 **빈 액자 모양**에만 쓴다(찍기 전엔 불러올 그림이 없으니까).
        실제 그림이 들어오면 위 onload 가 이기므로, 표시가 틀려도 결과는 맞는다. */
  function picsHtml(list) {
    var show = slotsOn();
    var pics = '';
    (list || []).forEach(function (im) {
      var u = srcOf(im && im.src);
      var tall = im && im.shape === 'tall';
      if (u) {
        /* onerror — 파일이 없으면 그 그림만 조용히 지운다. 설명서는 계속 읽혀야 한다 */
        pics += '<figure class="mn-fig">' +
          '<img src="' + esc(u) + '" alt="" loading="lazy" ' +
            'onload="if(this.naturalHeight>this.naturalWidth*1.2){' +
              'this.closest(\'.mn-fig\').classList.add(\'mn-fig-tall\');' +
              'var L=this.closest(\'li\');' +
              'if(L&&L.querySelectorAll(\'.mn-fig\').length===1){' +
                'L.classList.add(\'mn-li-split\');' +
                /* 띄운 그림은 뒤에 오는 글만 감싼다 → 맨 앞으로 옮긴다 */
                'var P=this.closest(\'.mn-pics\');' +
                'if(P&&P!==L.firstChild)L.insertBefore(P,L.firstChild);}}" ' +
            'onerror="this.closest(\'.mn-fig\').remove();">' +
          (im.cap ? '<figcaption>' + esc(im.cap) + '</figcaption>' : '') +
          '</figure>';
      } else if (show) {
        pics += '<figure class="mn-fig mn-slot' + (tall ? ' mn-slot-tall' : '') + '">' +
          '<div class="mn-slotbox">' + (tall ? '세로 화면' : '가로로 잘라서') + '</div>' +
          '<figcaption>' + esc((im && im.cap) || '') + '</figcaption>' +
          '</figure>';
      }
    });
    return pics ? '<div class="mn-pics">' + pics + '</div>' : '';
  }

  /* 눌러서 크게 보기 — 세로 그림을 200px 로 묶은 대신 열어 볼 길을 준다.
     ⚠️ ov-lock + id 에 'Close' — 설명서 위에 뜨므로 뒤로가기가 이걸 먼저 닫아야 한다. */
  function zoom(src) {
    var z = document.createElement('div');
    z.className = 'mn-zoom ov-lock';
    z.innerHTML = '<img src="' + esc(src) + '" alt="">' +
      '<button type="button" class="mn-zoom-x" id="mnZoomClose" aria-label="닫기">✕</button>';
    document.body.appendChild(z);
    var out = function () { if (z.parentNode) z.parentNode.removeChild(z); };
    z.addEventListener('click', out);
    z.querySelector('#mnZoomClose').onclick = out;
  }

  /* ── 한 칸의 속 내용 ───────────────────────────────────────
     ⭐ 그림은 그 **단계 안**에 들어간다(2026-09-19 사용자 요청).
        "여기를 누르세요" 를 읽은 자리에서 바로 그 화면이 보여야 한다.
        끝에 몰아 두면 글을 다 읽고 나서 그림을 다시 짝지어야 한다.
     ⚠️ 옛 글(sec.img)도 그대로 받아 준다 — 내용 파일을 한꺼번에 못 고칠 때가 있다. */
  /* 세로 그림 한 장짜리 단계는 **글 왼쪽 / 그림 오른쪽**으로 나눈다 (2026-09-20 사용자 요청).
     ☠️ 세로 캡처를 글 아래에 쭉 깔면 단계 하나가 화면 절반을 먹는다.
        옆으로 돌리면 같은 내용이 절반 높이에 들어간다.
     ⚠️ **세로 그림에만** 쓴다. 가로 조각을 절반 폭으로 줄이면 정작 가리키는 버튼이 안 보인다.
     ⚠️ 그림이 두 장 이상이면 나누지 않는다 — 좁은 칸에 두 장을 세우면 둘 다 못 알아본다.
     ⚠️ 여기서 보는 건 shape('빈 액자'용)이고, 진짜 그림은 onload 가 다시 판단해 붙인다.
        둘이 어긋나도 결과는 onload 쪽이 이긴다. */
  function splitStep(s) {
    var im = s && s.img;
    return !!(im && im.length === 1 && im[0] && im[0].shape === 'tall');
  }

  function bodyHtml(sec) {
    var h = '';

    var steps = sec.steps || [];
    if (steps.length) {
      h += '<ol class="mn-steps">';
      steps.forEach(function (s) {
        /* ☠️ 띄운 그림(float)은 **자기 뒤에 오는 글만** 감싼다.
           글 다음에 넣으면 옆으로 안 올라가고 글 아래에서 시작한다 —
           처음에 그렇게 넣었다가 왼쪽이 통째로 비는 모양이 됐다(2026-09-20).
           → 나누는 단계에서는 그림을 **먼저** 내보낸다. 안 나누면 예전대로 뒤에. */
        var sp = splitStep(s);
        var pics = picsHtml(s.img);
        var txt = '<b>' + esc(s.h) + '</b>' + (s.d ? '<span>' + md(s.d) + '</span>' : '');
        h += '<li' + (sp ? ' class="mn-li-split"' : '') + '>' +
             (sp ? pics + txt : txt + pics) +
             '</li>';
      });
      h += '</ol>';
    }

    if (sec.tip) h += '<div class="mn-tip">' + esc(sec.tip) + '</div>';
    h += picsHtml(sec.img);          /* 옛 글 호환: 칸 끝에 남은 그림 */

    return h;
  }

  /* ── 목록 ─────────────────────────────────────────────── */
  function listHtml(data) {
    var h = '';
    var n = 0;
    (data.parts || []).forEach(function (part) {
      h += '<div class="mn-part">' + esc(part.p) + '</div>';
      (part.secs || []).forEach(function (sec) {
        var id = 'mnS' + (n++);
        h += '<div class="mn-item" data-id="' + id + '">' +
          '<button type="button" class="mn-h" aria-expanded="false">' +
            '<span class="mn-ht">' + esc(sec.t) +
              (sec.s ? '<em>' + esc(sec.s) + '</em>' : '') + '</span>' +
            '<span class="mn-ar" aria-hidden="true">▾</span>' +
          '</button>' +
          '<div class="mn-b" hidden>' + bodyHtml(sec) + '</div>' +
        '</div>';
      });
    });
    return h;
  }

  var _ov = null;

  function close() {
    if (!_ov) return;
    if (_ov.parentNode) _ov.parentNode.removeChild(_ov);
    _ov = null;
  }

  function open() {
    if (_ov) return;                       // 두 번 열리지 않게
    var data = window.MANUAL_DATA;
    if (!data || !(data.parts || []).length) {
      if (window.toast) window.toast('설명서를 불러오지 못했습니다');
      return;
    }

    var ov = document.createElement('div');
    ov.className = 'mn-ov ov-lock';
    ov.innerHTML =
      '<div class="mn-head">' +
        '<div class="mn-title" id="mnTitle">사용 설명서</div>' +
        '<button type="button" class="mn-web" id="mnWeb" title="브라우저에서 보기">🌐</button>' +
        '<button type="button" class="mn-x" id="mnClose" aria-label="닫기">✕</button>' +
      '</div>' +
      '<div class="mn-scroll">' +
        (data.lead ? '<div class="mn-lead">' + esc(data.lead) + '</div>' : '') +
        listHtml(data) +
        '<div class="mn-end">막히는 곳이 있으면 설정 ▸ 💬 오픈채팅방으로 알려 주세요.</div>' +
      '</div>';
    document.body.appendChild(ov);
    _ov = ov;

    /* 🌐 — 같은 설명서를 브라우저에서 크게 본다.
       ⚠️ 앱 안 웹뷰가 아니라 **바깥 브라우저**로 열어야 뜻이 있다(주소를 복사·공유할 수 있다).
          legal.js 가 쓰는 것과 같은 길을 쓴다. */
    var _webBtn = ov.querySelector('#mnWeb');
    if (_webBtn) _webBtn.onclick = function () {
      var url = 'https://work-report-826ec.web.app/manual.html';
      try {
        if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Browser) {
          Capacitor.Plugins.Browser.open({ url: url });
          return;
        }
      } catch (e) {}
      try { window.open(url, '_system'); } catch (e) { window.open(url, '_blank'); }
    };

    ov.querySelector('#mnClose').onclick = close;

    /* 그림을 누르면 크게. 한 장씩 묶지 않고 위임으로 받는다 —
       칸을 펼칠 때마다 새로 그려지므로 그때마다 묶으면 빠뜨린다. */
    ov.querySelector('.mn-scroll').addEventListener('click', function (e) {
      var img = e.target && e.target.closest && e.target.closest('.mn-fig img');
      if (img && img.getAttribute('src')) zoom(img.getAttribute('src'));
    });

    /* 제목 다섯 번 = 빈 그림 자리 보기(만드는 사람용). 3초 안에 눌러야 센다 */
    var taps = 0, tapAt = 0;
    ov.querySelector('#mnTitle').onclick = function () {
      var now = Date.now();
      taps = (now - tapAt < 3000) ? taps + 1 : 1;
      tapAt = now;
      if (taps < 5) return;
      taps = 0;
      var on = !slotsOn();
      setSlots(on);
      if (window.toast) window.toast(on ? '그림 자리 보기 켬' : '그림 자리 보기 끔');
      /* 다시 그린다 — 열려 있던 칸은 잃어도 된다(만드는 사람만 쓰는 길이다) */
      close(); open();
    };

    /* 한 번에 하나만 펼친다 */
    var items = ov.querySelectorAll('.mn-item');
    Array.prototype.forEach.call(items, function (it) {
      var btn = it.querySelector('.mn-h');
      var box = it.querySelector('.mn-b');
      btn.onclick = function () {
        var willOpen = !it.classList.contains('on');
        Array.prototype.forEach.call(items, function (o) {
          o.classList.remove('on');
          o.querySelector('.mn-b').hidden = true;
          o.querySelector('.mn-h').setAttribute('aria-expanded', 'false');
        });
        if (!willOpen) return;
        it.classList.add('on');
        box.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        /* 펼친 줄이 화면 위쪽으로 오게 — 안 그러면 긴 칸을 열었을 때
           제목이 화면 밖으로 밀려 어디를 읽는지 모르게 된다 */
        try { btn.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) {}
      };
    });
  }

  window.openManual = open;
  window.closeManual = close;
  /* 검사·수동 조작용 */
  window.__manual = { srcOf: srcOf, md: md, picsHtml: picsHtml, zoom: zoom, splitStep: splitStep, bodyHtml: bodyHtml, listHtml: listHtml, slotsOn: slotsOn, _key: SLOT_KEY };
})();
