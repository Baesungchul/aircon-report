/* ═══════════════════════════════════════════════════════════════
   preview.js — 글 안의 사진 마커를 실제 사진으로 바꿔 보여준다 (2026-09-07)
   ----------------------------------------------------------------
   왜 필요한가 (사용자 요청):
     "찍고쓰다는 블로그 글을 작성하면 글 사이사이에 사진이 들어가는데
      현장매니저는 사진이 안 들어가고 마커만 들어간다"

     맞는 지적이었다. 지금까지 마커가 사진으로 바뀌는 곳은 **PC 링크(site/post.html)
     하나뿐**이었다. 앱 안 결과 화면은 그냥 textarea 라 (사진: 작업 전 2) 가 글자로 보였다.
     찍고쓰다는 2026-09-05 에 같은 요청을 받아 preview.js 를 만들었고, 이 파일은 그
     짝이다.

   ☠️ 그렇다고 **글에서 마커를 빼면 안 된다.**
      모바일 블로그에 붙여넣은 뒤 손으로 사진을 끼울 때, 마커가 '여기에 어느 사진'
      인지 알려주는 유일한 표시다(사용자 결정 2026-09-01, ai.js 주석 참고).
      → 여기서는 **화면만** 바꾼다. 복사되는 글은 마커를 그대로 유지한다.

   ⚠️ 마커 해석 규칙은 site/post.html 의 render() 와 **글자 그대로 같아야 한다.**
      한쪽만 고치면 앱에서 본 자리와 PC 링크의 자리가 달라져, 사장님이 화면에서
      확인한 배치와 실제 결과물이 어긋난다. post.html 은 배포된 별도 페이지라
      이 파일을 못 읽는다 — 고칠 때는 **두 곳 다** 고칠 것.

   사진 출처·순서는 sns_share.js 의 collect() 와 같다(호수 순 → 전 → 후 → 특이).
   공유·PC 링크가 쓰는 것과 같은 축이라야 화면과 결과가 맞는다.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var P = window.Preview = {};

  /* ⚠️ site/post.html 의 MARK 와 같은 식 */
  var MARK_SRC = '[\\(（]\\s*(?:사진|이미지)\\s*[:：\\-]?\\s*([^)）]*)[\\)）]' +
                 '|\\[\\s*(?:PHOTO_|사진\\s*)(\\d+)\\s*\\]';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* 글에 사진 마커가 하나라도 있나 — 버튼을 띄울지 정할 때 쓴다 */
  P.hasMarker = function (text) {
    return new RegExp(MARK_SRC, 'i').test(String(text || ''));
  };

  /* ── 현재 작업의 사진을 '보이는 순서대로' ──
     ☠️ sns_share.js 의 collect() 와 같은 순서·같은 kind 여야 한다.
        여기서만 순서를 바꾸면 화면에서 본 배치와 PC 링크 결과가 어긋난다. */
  function collect() {
    var out = [];
    if (typeof units === 'undefined' || !Array.isArray(units)) return out;
    units.forEach(function (u) {
      if (!u) return;
      (u.before || []).forEach(function (p) { out.push({ p: p, kind: 'before' }); });
      (u.after  || []).forEach(function (p) { out.push({ p: p, kind: 'after' }); });
      (u.specials || []).forEach(function (sp) {
        ((sp && sp.photos) || []).forEach(function (p) { out.push({ p: p, kind: 'special' }); });
      });
    });
    return out;
  }

  /* 만들어 둔 blob URL — 화면을 닫을 때 반드시 놓아 준다.
     ⚠️ 안 놓으면 글을 여러 번 열 때마다 사진 몇 MB 씩 메모리에 쌓인다. */
  var _made = [];
  P.release = function () {
    _made.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    _made = [];
  };

  function toUrl(p) {
    /* Gallery.resolvePhoto 가 dataUrl / blob 중 하나를 준다(폴더 핸들·지연 로딩까지 처리) */
    var r = null;
    try {
      if (window.Gallery && Gallery.resolvePhoto) r = Gallery.resolvePhoto(p);
    } catch (e) {}
    var pr = (r && r.then) ? r : Promise.resolve(r);
    return pr.then(function (x) {
      if (!x) return '';
      if (x.dataUrl) return x.dataUrl;
      if (x.blob) { var u = URL.createObjectURL(x.blob); _made.push(u); return u; }
      return '';
    }).catch(function () { return ''; });
  }

  /* ═══ 아래 build() 는 site/post.html 의 render() 를 그대로 옮긴 것이다.
         ☠️ 고칠 일이 생기면 두 곳을 같이 고칠 것 (위 머리말 참고). ═══ */
  function build(text, photos, kinds) {
    kinds = kinds || [];
    var used = photos.map(function () { return false; });

    function poolOf(k) {
      var a = [];
      photos.forEach(function (u, i) { if (kinds[i] === k) a.push(i); });
      return a;
    }
    var POOL = { before: poolOf('before'), after: poolOf('after'), special: poolOf('special') };

    function markUse(i) { used[i] = true; return [photos[i]]; }
    function takeKindNth(k, nth) {
      var arr = POOL[k] || [];
      if (nth > 0) {
        var i = arr[nth - 1];
        if (i != null && !used[i]) return markUse(i);
      }
      for (var j = 0; j < arr.length; j++) { if (!used[arr[j]]) return markUse(arr[j]); }
      return [];   // 그 종류가 동났으면 비워 둔다 — 다른 종류를 억지로 끼우지 않는다
    }
    function takeOne(i) { return (photos[i] && !used[i]) ? markUse(i) : []; }
    function takeAny() {
      for (var i = 0; i < photos.length; i++) { if (!used[i]) return markUse(i); }
      return [];
    }
    function resolve(label) {
      label = String(label || '');
      var m = label.match(/(\d+)/);
      var nth = m ? parseInt(m[1], 10) : 0;
      if (/후/.test(label)) return takeKindNth('after', nth);
      if (/전/.test(label)) return takeKindNth('before', nth);
      if (/특이|추가|기타/.test(label)) return takeKindNth('special', nth);
      if (nth > 0) return takeOne(nth - 1);
      return takeAny();
    }
    function para(t) {
      t = t.trim();
      if (!t) return '';
      return '<p>' + esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>') + '</p>';
    }

    var MARK = new RegExp(MARK_SRC, 'gi');
    var blocks = [];
    function pushPara(t) { var h = para(t); if (h) blocks.push({ t: 'p', html: h }); }
    function pushImgs(list) { list.forEach(function (u) { blocks.push({ t: 'img', url: u }); }); }

    var lines = String(text || '').replace(/\r/g, '').split('\n');
    lines.forEach(function (ln) {
      var t = ln.replace(/^#{1,6}\s+/, '').replace(/^\s*[-*+]\s+/, '• ').replace(/^\s{0,3}>\s?/, '');
      MARK.lastIndex = 0;
      var last = 0, m, hit = false;
      while ((m = MARK.exec(t)) !== null) {
        hit = true;
        pushPara(t.slice(last, m.index));
        pushImgs(m[2] != null ? takeOne(parseInt(m[2], 10) - 1) : resolve(m[1] || ''));
        last = m.index + m[0].length;
      }
      if (hit) { pushPara(t.slice(last)); return; }
      pushPara(t);
    });

    /* 남은 사진을 문단 사이에 고르게 흩는다 — 제목(첫 문단) 앞에는 넣지 않는다 */
    var left = [];
    photos.forEach(function (u, i) { if (!used[i]) left.push(u); });
    if (left.length) {
      var pPos = [], firstImg = -1;
      blocks.forEach(function (b, i) {
        if (b.t === 'p') pPos.push(i);
        else if (firstImg < 0) firstImg = i;
      });
      var slots = pPos.slice(1);
      if (firstImg >= 0) {
        var after = slots.filter(function (i) { return i > firstImg; });
        if (after.length) slots = after;
      }
      if (!slots.length) {
        left.forEach(function (u) { blocks.push({ t: 'img', url: u }); });
      } else {
        var bySlot = {};
        var step = slots.length / left.length;
        left.forEach(function (u, i) {
          var s = slots[Math.min(slots.length - 1, Math.floor(i * step))];
          (bySlot[s] = bySlot[s] || []).push(u);
        });
        var out = [];
        blocks.forEach(function (b, i) {
          (bySlot[i] || []).forEach(function (u) { out.push({ t: 'img', url: u }); });
          out.push(b);
        });
        blocks = out;
      }
    }

    var html = blocks.map(function (b) {
      return b.t === 'img'
        ? '<img src="' + esc(b.url) + '" alt="" loading="lazy">'
        : b.html;
    }).join('');
    return html || '<div class="pv-empty">아직 글이 없습니다.</div>';
  }

  /* 글 → 사진이 박힌 HTML.
     ⚠️ 이 화면은 **결과 미리보기**다. 복사되는 글은 여전히 마커 그대로다. */
  P.render = function (text) {
    var list = collect();
    if (!list.length) {
      return Promise.resolve(
        '<div class="pv-empty">이 작업에 담긴 사진이 없어 글만 보여줍니다.</div>' +
        build(text, [], [])
      );
    }
    return Promise.all(list.map(function (x) { return toUrl(x.p); })).then(function (urls) {
      var photos = [], kinds = [];
      urls.forEach(function (u, i) { if (u) { photos.push(u); kinds.push(list[i].kind); } });
      return build(text, photos, kinds);
    });
  };

  console.log('[Preview] 로드됨');
})();
