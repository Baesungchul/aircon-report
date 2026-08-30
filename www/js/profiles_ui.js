/* ═══════════════════════════════════════════════════════════
   PROFILES UI ─ 업종 고르기 / 내 업종 관리   2026-08-16 신설

   설계 원칙: 최대한 단순하게, 탭 한 번으로 끝나게.
     · 대분류 → 소분류 2단 드롭다운을 **없앴다.** 전부 펼친 칩(태그) 목록에서
       탭 한 번 = 선택, 다시 탭 = 해제. 한 화면에서 여러 업종을 고른다.
     · 보고서 제목·호수 호칭·단계 호칭은 **자동으로 채워진다.**
       (industries.js 항목이 이미 title/unit/stage 를 갖고 있다)
       고치고 싶을 때만 ✏️ 로 들어간다 — 처음 쓰는 사람은 볼 일이 없다.
     · 사업자 선택 줄은 **사업자가 2개 이상일 때만** 나타난다.
       사업자 1개인 사용자는 2계층 구조를 알 필요조차 없다.
     · 목록에 없으면 이름만 적어 추가. 나머지는 앱이 알아서 채운다.

   같은 시트를 온보딩과 설정이 함께 쓴다(ProfilesUI.openPicker).
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  window.ProfilesUI = window.ProfilesUI || {};
  var U = window.ProfilesUI;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(m, k) { try { if (typeof showToast === 'function') showToast(m, k || 'ok'); } catch (e) {} }
  /* ★ 2026-08-16 z-index 주의
       업종 시트는 '작업 정보(상세창 z:1760)' 와 '일정 추가(z:1840)' 창 **위에** 떠야 한다.
       처음에 1590~1620 을 써서 상세창 뒤에 가려 보이지 않는 문제가 있었다(사용자 보고).
       이미 쓰이는 값: … 1760(상세창) 1830 1840(일정추가) 1900 1950(닉네임) 2000 …
       → 1902~1908 구간을 쓴다(1900 바로 위, 1950 아래). */
  var Z_MANAGER = 1902, Z_SWITCH = 1904, Z_PICKER = 1906, Z_EDIT = 1908;

  function shell(inner, z) {
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:' + (z || 1600) +
      ';display:flex;align-items:flex-start;justify-content:center;padding:40px 14px 14px;overflow-y:auto;-webkit-overflow-scrolling:touch;';
    ov.innerHTML = '<div style="background:var(--sf);border-radius:14px;padding:16px;max-width:520px;width:100%;">' + inner + '</div>';
    document.body.appendChild(ov);
    return ov;
  }
  /* ★ 2026-08-17 — 올린 이미지를 정사각으로 잘라 작은 아이콘으로 만든다.
       ⚠️ 원본을 그대로 쓰면 안 된다. 이 값은 localStorage 와 users 문서에 들어가고
          달력·목록의 15~22px 칸에 그려진다. 64px 이면 충분하고 2~4KB 로 떨어진다.
       가운데를 정사각으로 잘라내므로(cover) 가로/세로 사진 모두 안 찌그러진다. */
  var ICON_PX = 64, ICON_MAX_BYTES = 60 * 1024;
  function resizeSquare(file, cb) {
    try {
      var fr = new FileReader();
      fr.onerror = function () { cb(''); };
      fr.onload = function () {
        var im = new Image();
        im.onerror = function () { cb(''); };
        im.onload = function () {
          try {
            var side = Math.min(im.width, im.height);
            if (!side) { cb(''); return; }
            var sx = (im.width - side) / 2, sy = (im.height - side) / 2;
            var cv = document.createElement('canvas');
            cv.width = ICON_PX; cv.height = ICON_PX;
            var g = cv.getContext('2d');
            try { g.imageSmoothingQuality = 'high'; } catch (e) {}
            g.drawImage(im, sx, sy, side, side, 0, 0, ICON_PX, ICON_PX);
            var out = '';
            try { out = cv.toDataURL('image/webp', 0.85); } catch (e) {}
            if (!out || out.indexOf('data:image/webp') !== 0) out = cv.toDataURL('image/png');
            cb(out.length > ICON_MAX_BYTES ? '' : out);
          } catch (e) { cb(''); }
        };
        im.src = fr.result;
      };
      fr.readAsDataURL(file);
    } catch (e) { cb(''); }
  }

  function industries() {
    try {
      if (typeof getIndustriesWithCustom === 'function') return getIndustriesWithCustom();
      return (typeof INDUSTRIES !== 'undefined') ? INDUSTRIES : [];
    } catch (e) { return []; }
  }

  /* ═══ 업종 칩 목록 HTML (온보딩 · 업종 추가 시트 공용) ══
     ⭐ 2026-08-16: 예전엔 온보딩과 업종 추가 시트가 각자 칩을 그렸다.
        그래서 업종을 늘리고 아이콘을 붙였을 때 시트에만 반영되고
        온보딩 4/7 화면은 옛 모양 그대로 남았다(사용자 보고).
        → 두 화면이 **이 함수 하나**를 쓰게 해서 다시 갈라지지 않게 한다.

     opts.chipClass : 칩에 붙일 class (핸들러를 각자 붙이므로 이름이 다르다)
     opts.isOn(k)   : 그 칩이 켜진 상태인가
     opts.skip(k)   : 목록에서 뺄 항목인가 (이미 등록된 업종 등) */
  U.catalogChipsHtml = function (opts) {
    opts = opts || {};
    var cls = opts.chipClass || 'pfChip';
    var isOn = opts.isOn || function () { return false; };
    var skip = opts.skip || function () { return false; };
    return industries().map(function (m) {
      var chips = (m.items || []).filter(function (it) { return !skip(m.id + '|' + it.id); })
        .map(function (it) {
          var k = m.id + '|' + it.id;
          var on = !!isOn(k);
          /* ⚠️ 이미 등록된 업종이면 **그 프로필의 아이콘**을 쓴다.
               카탈로그 값만 보면, 사용자가 아이콘을 직접 바꾼 업종이
               온보딩 화면에서만 다른 아이콘으로 보인다(같은 업종 두 아이콘). */
          var ic = '';
          try {
            if (window.Profiles) {
              var _rp = window.Profiles.list().filter(function (pp) {
                return pp.industryMajor === m.id && pp.industryMinor === it.id;
              })[0];
              if (_rp) ic = window.Profiles.iconOf(_rp);
            }
          } catch (e) {}
          if (!ic) ic = it.icon || (window.Profiles ? window.Profiles.defaultIconFor(m.id) : '');
          var icHtml = (ic && window.Profiles && window.Profiles.iconHtml) ? window.Profiles.iconHtml(ic, 15) : ic;
          return '<button type="button" class="' + cls + '" data-k="' + esc(k) + '" ' +
            'data-major="' + esc(m.id) + '" data-minor="' + esc(it.id) + '" ' +
            'style="display:inline-flex;align-items:center;gap:5px;border:1px solid var(--bd);' +
            'background:' + (on ? 'var(--ac)' : 'var(--sf2)') + ';color:' + (on ? '#fff' : 'var(--tx)') + ';' +
            'font-size:13px;font-weight:600;padding:9px 12px;border-radius:999px;cursor:pointer;line-height:1.2;">' +
            (icHtml ? icHtml + ' ' : '') + esc(it.label) + '</button>';
        }).join('');
      if (!chips) return '';
      return '<div style="margin-bottom:14px;">' +
        '<div style="font-size:12px;font-weight:800;color:var(--mu);margin-bottom:7px;">' + esc(m.label) + '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:7px;">' + chips + '</div></div>';
    }).join('');
  };

  /* 등록된 '내 업종' 그룹 HTML (온보딩·시트 공용) */
  U.mineChipsHtml = function (mine, keep, chipClass) {
    if (!mine || !mine.length) return '';
    var chips = mine.map(function (p) {
      var on = keep ? !!keep[p.id] : true;
      return '<button type="button" class="' + (chipClass || 'pfMine') + '" data-pf="' + esc(p.id) + '" ' +
        'style="display:inline-flex;align-items:center;gap:5px;border:1px solid var(--bd);' +
        'background:' + (on ? 'var(--ac)' : 'var(--sf2)') + ';color:' + (on ? '#fff' : 'var(--tx)') + ';' +
        'font-size:13px;font-weight:600;padding:9px 12px;border-radius:999px;cursor:pointer;line-height:1.2;">' +
        Profiles.iconHtml(p, 15) + ' ' + esc(p.name || '(이름 없음)') + '</button>';
    }).join('');
    return '<div style="margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--bd);">' +
      '<div style="font-size:12px;font-weight:800;color:var(--ac);margin-bottom:7px;">⭐ 내 업종 (등록됨)</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:7px;">' + chips + '</div>' +
      '<div style="font-size:10px;color:var(--mu);margin-top:7px;line-height:1.5;">' +
        '눌러서 끄면 목록에서 빠집니다 (지난 작업의 보고서는 그대로 유지)</div></div>';
  };

  /* ═══ 업종 고르기 시트 (온보딩·설정 공용) ═══════════════
     onDone(addedIds) 로 결과를 알려준다. 취소하면 부르지 않는다.

     ⭐ 2026-08-16 버그수정 — "이미 추가한 업종이 여기선 안 보인다"(사용자 보고)
       예전엔 이 시트가 **industries.js 카탈로그만** 그렸다. 그래서
         · '직접 입력'으로 만든 업종(카탈로그에 대응 칩이 없음)
         · 업종을 고른 적 없이 마이그레이션된 첫 프로필(industryMinor 가 빈 값)
       은 앱 다른 곳에는 멀쩡히 있는데 이 시트에서만 통째로 사라져 보였다.
       → 맨 위에 **'⭐ 내 업종'** 그룹을 두고 등록된 프로필을 전부 그린다.
         카탈로그에서는 이미 등록된 항목을 빼서 같은 업종이 두 번 나오지 않게 한다. */
  U.openPicker = function (onDone) {
    if (!window.Profiles) { toast('업종 모듈 로드 안 됨 (앱 재빌드 필요)', 'err'); return; }
    Profiles.ensure();

    var mine = Profiles.list();                 // 등록된 내 업종(숨김 제외)
    var keep = {};                              // profileId → 유지할지
    mine.forEach(function (p) { keep[p.id] = true; });
    // 이미 등록된 카탈로그 항목은 카탈로그에서 뺀다(중복 표시 방지)
    var registered = {};
    mine.forEach(function (p) { if (p.industryMinor) registered[p.industryMajor + '|' + p.industryMinor] = true; });

    var mineGroup = U.mineChipsHtml(mine, keep, 'pfMine');

    var groups = U.catalogChipsHtml({
      chipClass: 'pfChip',
      isOn: function () { return false; },      // 카탈로그는 전부 꺼진 채로 시작(등록된 건 위 그룹에 있다)
      skip: function (k) { return !!registered[k]; }
    });

    var ov = shell(
      '<div style="font-size:17px;font-weight:800;margin-bottom:4px;">어떤 일을 하세요?</div>' +
      '<div style="font-size:12px;color:var(--mu);margin-bottom:14px;line-height:1.5;">' +
        '하시는 일을 <b>전부</b> 눌러주세요. 여러 개 고를 수 있어요.<br>' +
        '보고서 제목과 호칭은 자동으로 맞춰집니다.</div>' +
      '<div id="pfChosenBar" style="display:none;background:var(--sf2);border-radius:10px;padding:9px 11px;margin-bottom:14px;font-size:12px;line-height:1.7;"></div>' +
      '<div style="max-height:46vh;overflow-y:auto;-webkit-overflow-scrolling:touch;margin-bottom:12px;">' +
        mineGroup + groups + '</div>' +
      '<div style="border-top:1px solid var(--bd);padding-top:12px;margin-bottom:12px;">' +
        '<div style="font-size:12px;font-weight:700;color:var(--mu);margin-bottom:6px;">목록에 없나요?</div>' +
        '<div style="display:flex;gap:7px;">' +
          '<input class="co-input" id="pfCustomInp" placeholder="예: 실링팬 설치" style="flex:1;min-width:0;">' +
          '<button class="btn b-ghost" id="pfCustomAdd" style="flex-shrink:0;">추가</button>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;">' +
        '<button class="btn b-green" id="pfPickOk" style="flex:2;justify-content:center;">완료</button>' +
        '<button class="btn b-ghost" id="pfPickCancel" style="flex:1;justify-content:center;">취소</button>' +
      '</div>', Z_PICKER);

    var close = function () { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });

    var newPicks = {};        // 'major|minor' → item (카탈로그에서 새로 고른 것)
    var customNames = [];     // 직접 입력한 이름

    function refreshBar() {
      var bar = ov.querySelector('#pfChosenBar');
      var names = [];
      mine.forEach(function (p) { if (keep[p.id]) names.push(p.name || ''); });
      Object.keys(newPicks).forEach(function (k) {
        var np = newPicks[k];
        names.push((np.icon ? np.icon + ' ' : '') + np.label);
      });
      names = names.concat(customNames).filter(Boolean);
      if (!names.length) { bar.style.display = 'none'; return; }
      bar.style.display = 'block';
      bar.innerHTML = '<b>모두 ' + names.length + '개</b> · ' + esc(names.join(' , '));
    }
    refreshBar();

    // 내 업종 칩 — 끄면 목록에서 빠진다(숨김)
    ov.querySelectorAll('.pfMine').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-pf');
        keep[id] = !keep[id];
        b.style.background = keep[id] ? 'var(--ac)' : 'var(--sf2)';
        b.style.color = keep[id] ? '#fff' : 'var(--tx)';
        b.style.textDecoration = keep[id] ? 'none' : 'line-through';
        b.style.opacity = keep[id] ? '1' : '.6';
        refreshBar();
      };
    });

    // 카탈로그 칩 — 새로 추가할 업종
    ov.querySelectorAll('.pfChip').forEach(function (b) {
      b.onclick = function () {
        var k = b.getAttribute('data-k');
        if (newPicks[k]) { delete newPicks[k]; }
        else {
          var mid = k.split('|')[0], iid = k.split('|')[1];
          var major = industries().filter(function (m) { return m.id === mid; })[0];
          var item = major ? (major.items || []).filter(function (it) { return it.id === iid; })[0] : null;
          if (item) newPicks[k] = item;
        }
        var on = !!newPicks[k];
        b.style.background = on ? 'var(--ac)' : 'var(--sf2)';
        b.style.color = on ? '#fff' : 'var(--tx)';
        refreshBar();
      };
    });

    ov.querySelector('#pfCustomAdd').onclick = function () {
      var inp = ov.querySelector('#pfCustomInp');
      var v = (inp.value || '').trim();
      if (!v) { inp.focus(); return; }
      if (mine.some(function (p) { return (p.name || '').trim() === v; })) {
        toast('이미 등록된 업종입니다', 'err'); inp.value = ''; return;
      }
      if (customNames.indexOf(v) < 0) customNames.push(v);
      inp.value = '';
      refreshBar();
    };
    ov.querySelector('#pfCustomInp').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); ov.querySelector('#pfCustomAdd').click(); }
    });

    ov.querySelector('#pfPickCancel').onclick = close;
    ov.querySelector('#pfPickOk').onclick = function () {
      var added = [];
      // ① 새로 고른 카탈로그 항목
      Object.keys(newPicks).forEach(function (k) {
        var id = Profiles.addFromIndustry(k.split('|')[0], newPicks[k]);
        if (id) added.push(id);
      });
      // ② 직접 입력
      customNames.forEach(function (nm) { var id = Profiles.addCustom(nm); if (id) added.push(id); });
      // ③ 끈 것은 숨김(삭제 아님 — 지난 작업의 보고서를 지키기 위해)
      mine.forEach(function (p) { if (!keep[p.id]) Profiles.hide(p.id); });

      // 처음 등록이면 첫 업종을 현재 업종으로
      if (!Profiles.currentId() || !Profiles.current()) {
        var f = Profiles.list()[0]; if (f) Profiles.setCurrent(f.id);
      }
      Profiles.syncCoKey();
      try { if (typeof applyCustomLabels === 'function') applyCustomLabels(); } catch (e) {}
      close();
      if (typeof onDone === 'function') onDone(added);
    };
  };

  /* ═══ ⭐ 업종 관리 — 하나의 시트로 통합 (2026-08-17) ═══════
     예전엔 같은 개념의 시트가 4개였다:
       openPicker(카탈로그) / openManager(설정) / openSwitcher(작업탭) / select 의 '＋ 업종 추가…'
     어느 문으로 들어가도 **지침에 닿을 수 없어서** 늘 설정까지 나가야 했다.
     이제 관리 시트 하나로 모으고, 카탈로그 피커는 그 아래 '추가' 전용 시트로만 남긴다.

     ⚠️ 역할이 두 개라 모드를 반드시 나눈다 — 뭉개면 "골랐는데 작업엔 안 붙는다"가 된다.
       mode:'manage' (설정)  … 행 탭 = Profiles.setCurrent 만
       mode:'pick'   (작업탭·일정창) … 행 탭 = onPick(id) 를 부르고 닫는다.
                       무엇을 할지는 **부르는 쪽**이 정한다
                       (작업탭 = bindWork+setCurrent+markDataDirty+renderAll,
                        일정 창 = select 값만 교체)

     opts = { mode, title, desc, currentId, onPick, onClose, z }
     ⚠️ 옛 호출부는 첫 인자로 onClose 함수를 넘긴다(dialogs.js) — 그대로 받는다. */
  U.openManager = function (opts) {
    if (!window.Profiles) { toast('업종 모듈 로드 안 됨 (앱 재빌드 필요)', 'err'); return; }
    if (typeof opts === 'function') opts = { onClose: opts };
    opts = opts || {};
    var isPick   = (opts.mode === 'pick');
    var onClose  = opts.onClose;
    Profiles.ensure();
    var ov = shell('<div id="pfMgrBody"></div>', opts.z || (isPick ? Z_SWITCH : Z_MANAGER));
    var close = function () {
      if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
      if (typeof onClose === 'function') onClose();
    };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });

    function render() {
      var cur = isPick ? (opts.currentId || Profiles.currentId()) : Profiles.currentId();
      var rows = Profiles.list().map(function (p) {
        var isCur = (p.id === cur);
        return '<div class="pfRow" data-id="' + esc(p.id) + '" style="display:flex;align-items:center;gap:9px;padding:12px 10px;border-bottom:1px solid rgba(128,128,128,.18);">' +
          '<span style="font-size:22px;flex-shrink:0;width:30px;text-align:center;">' + Profiles.iconHtml(p, 21) + '</span>' +
          '<div style="flex:1;min-width:0;cursor:pointer;" class="pfPick">' +
            '<div style="font-size:14px;font-weight:700;color:var(--tx);">' + esc(p.name || '(이름 없음)') +
              (isCur ? ' <span style="font-size:10px;font-weight:800;color:#fff;background:var(--ac);padding:2px 7px;border-radius:999px;vertical-align:middle;">' +
                       (isPick ? '✓ 선택됨' : '사용중') + '</span>' : '') +
            '</div>' +
            '<div style="font-size:11px;color:var(--mu);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
              esc(p.reportTitle || '보고서 제목 미설정') + ' · ' + esc(p.unitLabel || '호수') + ' · ' + esc(p.stageLabel || '작업') +
            '</div>' +
          '</div>' +
          '<button class="pfEdit btn b-ghost b-xs" data-id="' + esc(p.id) + '" style="flex-shrink:0;">✏️</button>' +
        '</div>';
      }).join('');
      var title = opts.title || (isPick ? '이 작업의 업종' : '📋 내 업종');
      var desc  = opts.desc  || (isPick
        ? '바꾸면 보고서 제목·호칭과 글쓰기 지침·견적서 양식이 그 업종 것으로 바뀝니다.<br>' +
          '<b>이미 저장한 글과 견적서는 그대로 남습니다.</b>'
        : '업종을 누르면 그 업종으로 바뀝니다. 업종마다 <b>글쓰기 지침·견적 지침·양식</b>이 따로 저장돼요.');

      ov.querySelector('#pfMgrBody').innerHTML =
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
          '<div style="font-size:17px;font-weight:800;flex:1;">' + title + '</div>' +
          '<button class="btn b-blue b-xs" id="pfAdd">＋ 추가</button>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--mu);margin-bottom:12px;line-height:1.5;">' + desc + '</div>' +
        (rows || '<div style="font-size:13px;color:var(--mu);text-align:center;padding:24px 0;">등록된 업종이 없습니다.<br>＋ 추가를 눌러 시작하세요.</div>') +
        '<div style="font-size:10px;color:var(--mu);margin-top:10px;line-height:1.5;">✏️ 를 누르면 그 업종의 이름·호칭과 <b>글쓰기 지침·견적 지침·양식</b>을 설정합니다.</div>' +
        '<button class="btn b-ghost" id="pfMgrClose" style="width:100%;justify-content:center;margin-top:10px;">닫기</button>';

      ov.querySelector('#pfAdd').onclick = function () { U.openPicker(function () { render(); }); };
      ov.querySelector('#pfMgrClose').onclick = close;
      ov.querySelectorAll('.pfRow').forEach(function (r) {
        r.querySelector('.pfPick').onclick = function () {
          var id = r.getAttribute('data-id');
          if (isPick) {
            /* ⚠️ 여기서 setCurrent 를 부르지 않는다 — 무엇을 할지는 부르는 쪽이 정한다.
                 (작업탭은 작업에 새기고, 일정 창은 select 값만 바꾼다) */
            close();
            if (typeof opts.onPick === 'function') opts.onPick(id);
            return;
          }
          Profiles.setCurrent(id);
          toast('업종을 바꿨습니다', 'ok');
          render();
        };
      });
      ov.querySelectorAll('.pfEdit').forEach(function (b) {
        b.onclick = function (e) { e.stopPropagation(); U.openEdit(b.getAttribute('data-id'), function () { render(); }); };
      });
    }
    render();
  };

  /* ═══ 업종 하나 편집 ════════════════════════════════════
     기본은 이름 하나. 나머지는 자동으로 채워져 있고 고치고 싶을 때만 만진다. */
  /* 업종 상세 안에 넣는 지침 줄 정의 (라벨은 ai.js CHANNELS 와 맞춰 둔다) */
  var GUIDE_ROWS = [
    { ch: 'naver',    label: '네이버 블로그' },
    { ch: 'daangn',   label: '당근 소식' },
    { ch: 'insta',    label: '인스타그램' },
    { ch: 'facebook', label: '페이스북' }
  ];
  var QUOTE_ROW = { ch: 'quote', label: '견적서 지침 (가격표)' };

  U.openEdit = function (pfId, onDone) {
    var pf = Profiles.get(pfId);
    if (!pf) return;
    var bizes = Profiles.bizList();

    /* ⚠️ 배지 판정은 반드시 hasChGuide 다.
         ClaudeAI.getChGuide 는 값이 없으면 **기본 지침을 돌려주므로**
         그걸로 판정하면 전부 '작성됨'으로 보인다(설계안 3단계 경고). */
    function guideSaved(chId) {
      try { return !!(window.ClaudeAI && ClaudeAI.hasChGuide && ClaudeAI.hasChGuide(chId, pfId)); }
      catch (e) { return false; }
    }
    function badgeHtml(chId) {
      var on = guideSaved(chId);
      return '<span style="font-size:10px;font-weight:800;color:' + (on ? 'var(--ac)' : 'var(--mu)') + ';">' +
        (on ? '● 작성됨' : '○ 기본값') + '</span>';
    }
    function chIconHtml(chId) {
      try { if (window.ClaudeAI && ClaudeAI.channelIcon) return ClaudeAI.channelIcon(chId, 15); } catch (e) {}
      return '';
    }
    function guideRowHtml(row) {
      return '<button type="button" class="btn b-ghost pfeGuide" data-ch="' + esc(row.ch) + '" ' +
        'style="width:100%;justify-content:space-between;margin-bottom:6px;">' +
        '<span style="display:inline-flex;align-items:center;gap:6px;">' + chIconHtml(row.ch) + esc(row.label) + '</span>' +
        '<span style="display:inline-flex;align-items:center;gap:6px;"><span id="pfeB_' + esc(row.ch) + '">' +
        badgeHtml(row.ch) + '</span><span style="opacity:.5;">▶</span></span></button>';
    }
    var showBiz = bizes.length > 1;   // ⭐ 사업자가 1개면 이 줄 자체를 안 보여준다

    var bizOpts = bizes.map(function (b) {
      return '<option value="' + esc(b.id) + '"' + (b.id === pf.bizId ? ' selected' : '') + '>' +
        esc(b.name || '(상호 미입력)') + (b.bizNo ? ' · ' + esc(b.bizNo) : '') + '</option>';
    }).join('');

    /* 아이콘 — 스케줄 목록 왼쪽(시간 위)에 이 아이콘이 뜬다.
       기본값이 이미 들어 있으므로 바꾸고 싶을 때만 만지면 된다. */
    var curIcon = Profiles.iconOf(pf);
    // ★ 지금 아이콘이 기본 목록에 없으면 = 사용자가 직접 넣은 것
    /* ★ 2026-08-17 — '직접입력 이모지' 자리를 '내 이미지'로 바꿨다(사용자 요청).
         ⚠️ 예전에 직접입력해둔 이모지는 지우지 않는다 — 그대로 선택된 채 보인다. */
    var imgOn      = Profiles.isImgIcon(curIcon) && !!Profiles.getIconImage(pf.id);
    var customOn   = !imgOn && (Profiles.ICON_CHOICES.indexOf(curIcon) < 0) && !Profiles.isSvgIcon(curIcon)
                     && !Profiles.isImgIcon(curIcon);
    var customIcon = customOn ? curIcon : '';
    var curImgData = imgOn ? Profiles.getIconImage(pf.id) : '';
    var iconGrid = Profiles.ICON_CHOICES.map(function (ic) {
      var on = (ic === curIcon);
      return '<button type="button" class="pfeIc" data-ic="' + esc(ic) + '" ' +
        'style="width:40px;height:40px;font-size:20px;border-radius:10px;cursor:pointer;' +
        'display:inline-flex;align-items:center;justify-content:center;' +
        'border:2px solid ' + (on ? 'var(--ac)' : 'transparent') + ';background:var(--sf2);">' +
        Profiles.iconHtml(ic, 22) + '</button>';
    }).join('');

    var ov = shell(
      '<div style="font-size:17px;font-weight:800;margin-bottom:12px;">✏️ 업종 설정</div>' +
      '<div class="co-field"><label>아이콘 <span class="co-tag">일정 목록에 표시</span></label>' +
        '<div id="pfeIcons" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;">' + iconGrid + '</div>' +
        /* ★ 2026-08-16 사용자가 원하는 이모지를 직접 넣을 수 있게.
           키보드의 이모지 자판에서 골라 넣으면 그대로 아이콘이 된다. */
        '<div style="display:flex;align-items:center;gap:8px;margin-top:8px;">' +
          '<button type="button" class="pfeIc" id="pfeIcMine" ' +
            'style="width:40px;height:40px;font-size:20px;border-radius:10px;cursor:pointer;overflow:hidden;' +
            'display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;padding:0;' +
            'border:2px solid ' + ((imgOn || customOn) ? 'var(--ac)' : 'var(--bd)') + ';background:var(--sf2);">' +
            (curImgData
              ? '<img id="pfeIcPrev" src="' + esc(curImgData) + '" alt="" style="width:100%;height:100%;object-fit:cover;">'
              : (customIcon ? esc(customIcon) : '<span style="font-size:12px;color:var(--mu);">내 그림</span>')) +
          '</button>' +
          '<button type="button" class="btn b-ghost" id="pfeIcPick" style="flex:1;justify-content:center;font-size:12px;">🖼️ 내 이미지 올리기</button>' +
          '<button type="button" class="btn b-ghost" id="pfeIcDel" style="flex-shrink:0;font-size:12px;' +
            (imgOn ? '' : 'display:none;') + '">지우기</button>' +
        '</div>' +
        '<input type="file" id="pfeIcFile" accept="image/*" style="display:none;">' +
        '<div style="font-size:10px;color:var(--mu);margin-top:4px;line-height:1.5;">' +
          '💡 로고나 사진을 올리면 <b>가운데를 정사각으로 잘라</b> 작은 아이콘으로 만듭니다.<br>' +
          '공유 중이면 상대 폰의 일정 목록에도 이 아이콘이 보입니다.</div>' +
      '</div>' +
      '<div class="co-field"><label>업종 이름</label>' +
        '<input class="co-input" id="pfeName" value="' + esc(pf.name || '') + '" placeholder="예: 에어컨 청소"></div>' +
      '<div class="co-field"><label>보고서 제목</label>' +
        '<input class="co-input" id="pfeTitle" value="' + esc(pf.reportTitle || '') + '" placeholder="예: 에어컨 청소 보고서"></div>' +
      '<div class="co-grid-2">' +
        '<div class="co-field"><label>현장 단위 호칭</label>' +
          '<input class="co-input" id="pfeUnit" value="' + esc(pf.unitLabel || '') + '" placeholder="호수 / 현장 / 차량"></div>' +
        '<div class="co-field"><label>작업 단계 호칭</label>' +
          '<input class="co-input" id="pfeStage" value="' + esc(pf.stageLabel || '') + '" placeholder="청소 / 시공 / 설치"></div>' +
      '</div>' +
      '<div style="font-size:10px;color:var(--mu);margin:-4px 0 12px;">💡 비워두면 기본값(호수 / 작업)을 씁니다</div>' +
      (showBiz
        ? '<div class="co-field"><label>사업자</label><select class="co-input" id="pfeBiz">' + bizOpts + '</select>' +
          '<div style="font-size:10px;color:var(--mu);margin-top:3px;">견적서·거래명세서의 공급자로 들어갑니다</div></div>'
        : '') +

      /* ★ 2026-08-17 — 지침을 업종 안으로 들여왔다.
           예전엔 설정 ▸ Claude AI 에 평평하게 있어서 '지금 어느 업종 칸을 여는지' 알 수 없었다.
           여기서 열면 profileId 가 **명시**로 넘어가므로 forCurrentWork() 추측이 사라진다. */
      '<div style="border-top:1px solid var(--bd);margin:16px 0 0;padding-top:14px;">' +
        '<div style="font-size:13px;font-weight:800;color:var(--ac);">✨ 이 업종의 글쓰기 지침</div>' +
        '<div style="font-size:10px;color:var(--mu);margin:3px 0 9px;line-height:1.5;">' +
          '여기서 고친 지침은 <b>' + esc(pf.name || '이 업종') + '</b> 글에만 반영됩니다.</div>' +
        GUIDE_ROWS.map(guideRowHtml).join('') +
      '</div>' +

      '<div style="border-top:1px solid var(--bd);margin:14px 0 0;padding-top:14px;">' +
        '<div style="font-size:13px;font-weight:800;color:var(--ac);">🧾 이 업종의 견적 지침</div>' +
        '<div style="font-size:10px;color:var(--mu);margin:3px 0 9px;line-height:1.5;">' +
          '가격표·업체명·연락처를 적어두면 견적서 금액이 정확해집니다. 업종마다 가격이 다르므로 여기서 관리합니다.</div>' +
        guideRowHtml(QUOTE_ROW) +
      '</div>' +

      '<div style="border-top:1px solid var(--bd);margin:14px 0 4px;padding-top:14px;">' +
        '<div style="font-size:13px;font-weight:800;color:var(--ac);">📄 이 업종의 문서 양식</div>' +
        '<div id="pfeTpl" style="font-size:11px;color:var(--mu);margin-top:6px;line-height:1.9;">확인 중…</div>' +
        '<div style="font-size:10px;color:var(--mu);margin-top:4px;line-height:1.5;">' +
          '양식 올리기·바꾸기는 견적서·거래명세서 화면에서 합니다. 업종마다 따로 보관됩니다.</div>' +
      '</div>' +

      '<div style="display:flex;gap:8px;margin-top:14px;">' +
        '<button class="btn b-green" id="pfeSave" style="flex:2;justify-content:center;">저장</button>' +
        '<button class="btn b-ghost" id="pfeCancel" style="flex:1;justify-content:center;">취소</button>' +
      '</div>' +
      '<button class="btn b-ghost" id="pfeHide" style="width:100%;justify-content:center;margin-top:10px;font-size:12px;color:var(--dn,#e05252);">이 업종 목록에서 빼기</button>' +
      '<div style="font-size:10px;color:var(--mu);margin-top:6px;line-height:1.5;">' +
        '빼도 지난 작업의 보고서는 그대로 유지됩니다(완전 삭제가 아니라 목록에서만 감춥니다).</div>', Z_EDIT);

    var close = function () { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('#pfeCancel').onclick = close;

    /* 지침 줄 — ⭐ profileId 를 명시로 넘긴다(이게 이번 수정의 핵심).
       z 를 올려주지 않으면 업종 상세(Z_EDIT) 아래에 깔려 안 보인다. */
    ov.querySelectorAll('.pfeGuide').forEach(function (b) {
      b.onclick = function () {
        var ch = b.getAttribute('data-ch');
        if (!(window.ClaudeAI && ClaudeAI.openChannelGuideline)) {
          toast('AI 모듈 로드 안 됨 (앱 재빌드 필요)', 'err'); return;
        }
        ClaudeAI.openChannelGuideline(ch, {
          profileId: pfId,
          z: Z_EDIT + 2,
          onSave: function () {
            var sp = ov.querySelector('#pfeB_' + ch);
            if (sp) sp.innerHTML = badgeHtml(ch);
          }
        });
      };
    });

    /* 문서 양식 — 이 업종에 올려둔 양식이 있는지만 보여준다(올리기는 견적서 화면). */
    (function () {
      var box = ov.querySelector('#pfeTpl');
      if (!box) return;
      if (!(window.DocsTemplate && DocsTemplate.info)) { box.textContent = '(양식 모듈 없음)'; return; }
      Promise.all([
        DocsTemplate.info('quote', pfId).catch(function () { return null; }),
        DocsTemplate.info('statement', pfId).catch(function () { return null; })
      ]).then(function (r) {
        function line(t, v) {
          return '<div>' + t + ' — ' + (v
            ? '<b style="color:var(--ac);">✔ ' + esc(v.name || '업로드됨') + '</b>'
            : '<span style="color:var(--mu);">없음 (앱 기본 양식 사용)</span>') + '</div>';
        }
        box.innerHTML = line('견적서 양식', r[0]) + line('거래명세서 양식', r[1]);
      }).catch(function () { box.textContent = '(양식 정보를 읽지 못했습니다)'; });
    })();

    var pickedIcon  = curIcon;
    var pickedImg   = null;      // 새로 올린 dataURL (저장 눌러야 반영)
    var removeImg   = false;     // '지우기' 를 눌렀나
    var mineBtn  = ov.querySelector('#pfeIcMine');
    var fileInp  = ov.querySelector('#pfeIcFile');
    var pickBtn  = ov.querySelector('#pfeIcPick');
    var delBtn   = ov.querySelector('#pfeIcDel');
    function clearSel() {
      ov.querySelectorAll('.pfeIc').forEach(function (x) {
        x.style.borderColor = (x.id === 'pfeIcMine') ? 'var(--bd)' : 'transparent';
      });
    }
    ov.querySelectorAll('.pfeIc').forEach(function (b) {
      if (b.id === 'pfeIcMine') return;      // 내 그림 칸은 아래에서 따로 다룬다
      b.onclick = function () {
        pickedIcon = b.getAttribute('data-ic');
        pickedImg = null; removeImg = true;   // 기본 아이콘을 고르면 올린 그림은 내려놓는다
        if (delBtn) delBtn.style.display = 'none';
        if (mineBtn) mineBtn.innerHTML = '<span style="font-size:12px;color:var(--mu);">내 그림</span>';
        clearSel();
        b.style.borderColor = 'var(--ac)';
      };
    });

    /* ★ 내 이미지 올리기 — 고르는 즉시 정사각 축소해서 미리보기.
         실제 저장은 '저장' 을 눌렀을 때다(취소하면 원래대로). */
    function showPicked(data) {
      pickedImg = data; removeImg = false;
      pickedIcon = 'img:' + pf.id;
      if (mineBtn) {
        mineBtn.innerHTML = '<img src="' + esc(data) + '" alt="" style="width:100%;height:100%;object-fit:cover;">';
        clearSel();
        mineBtn.style.borderColor = 'var(--ac)';
      }
      if (delBtn) delBtn.style.display = '';
    }
    if (pickBtn && fileInp) {
      pickBtn.onclick = function () { fileInp.value = ''; fileInp.click(); };
      fileInp.addEventListener('change', function () {
        var f = fileInp.files && fileInp.files[0];
        if (!f) return;
        if (!/^image\//.test(f.type || '')) { toast('이미지 파일만 올릴 수 있어요', 'err'); return; }
        resizeSquare(f, function (data) {
          if (!data) { toast('이미지를 읽지 못했습니다 — 다른 파일로 해보세요', 'err'); return; }
          showPicked(data);
          toast('아이콘 미리보기 — 저장을 누르면 적용됩니다', 'ok');
        });
      });
    }
    if (mineBtn) mineBtn.onclick = function () {
      if (pickedImg || curImgData) { clearSel(); mineBtn.style.borderColor = 'var(--ac)';
                                     pickedIcon = 'img:' + pf.id; removeImg = false; return; }
      if (pickBtn) pickBtn.click();
    };
    if (delBtn) delBtn.onclick = function () {
      pickedImg = null; removeImg = true;
      /* 그림을 지우면 자동 아이콘(카탈로그/대분류)으로 되돌린다 */
      pickedIcon = '';
      mineBtn.innerHTML = '<span style="font-size:12px;color:var(--mu);">내 그림</span>';
      clearSel();
      delBtn.style.display = 'none';
      toast('아이콘 그림을 내렸습니다 — 저장을 누르면 적용됩니다', 'ok');
    };
    ov.querySelector('#pfeSave').onclick = function () {
      var patch = {
        id: pf.id,
        name: (ov.querySelector('#pfeName').value || '').trim(),
        reportTitle: (ov.querySelector('#pfeTitle').value || '').trim(),
        unitLabel: (ov.querySelector('#pfeUnit').value || '').trim(),
        stageLabel: (ov.querySelector('#pfeStage').value || '').trim()
      };
      if (!patch.name) { toast('업종 이름을 입력해주세요', 'err'); return; }
      /* 아이콘은 **직접 바꿨을 때만** 저장한다(iconSet).
         안 바꿨는데 저장해 버리면 그 순간 아이콘이 고정돼, 나중에 앱 기본 아이콘을
         개선해도 이 업종만 옛것으로 남는다. */
      if (pickedIcon !== curIcon) { patch.icon = pickedIcon; patch.iconSet = true; }

      /* ★ 2026-08-17 이미지 아이콘 저장.
           데이터는 프로필당 한 벌(localStorage)에만 두고, 프로필에는 참조만 남긴다.
           iconFallback 은 이미지가 없거나 아직 못 받았을 때 대신 보여줄 이모지다. */
      if (pickedImg) {
        if (!Profiles.setIconImage(pf.id, pickedImg)) {
          toast('저장 공간이 부족해 아이콘 그림을 저장하지 못했습니다', 'err');
        } else {
          patch.icon = 'img:' + pf.id;
          patch.iconSet = true;
          patch.iconFallback = Profiles.catalogIcon(pf.industryMajor, pf.industryMinor)
                               || Profiles.defaultIconFor(pf.industryMajor);
        }
      } else if (removeImg) {
        Profiles.clearIconImage(pf.id);
        if (Profiles.isImgIcon(curIcon) || pickedIcon === '') {
          patch.icon = ''; patch.iconSet = false;    // 자동(카탈로그) 아이콘으로 복귀
        }
      }

      var bizSel = ov.querySelector('#pfeBiz');
      if (bizSel) patch.bizId = bizSel.value;
      Profiles.save(patch);
      Profiles.dropIconMemo();
      Profiles.syncCoKey();
      /* 상대 폰에서도 보이도록 users/{uid} 에 올린다(이름 슬러그가 키).
         이름을 바꿨을 때도 맵을 통째로 다시 만들어 올리므로 자동으로 맞춰진다. */
      try { if (window.CloudShare && CloudShare.pushMyProfileIcons) CloudShare.pushMyProfileIcons(); } catch (e) {}
      try { if (typeof applyCustomLabels === 'function') applyCustomLabels(); } catch (e) {}
      toast('저장했습니다', 'ok');
      close();
      if (typeof onDone === 'function') onDone();
    };
    ov.querySelector('#pfeHide').onclick = function () {
      if (Profiles.list().length <= 1) { toast('업종이 하나뿐이라 뺄 수 없습니다', 'err'); return; }
      if (!confirm('"' + (pf.name || '') + '" 을(를) 목록에서 뺄까요?\n지난 작업의 보고서는 그대로 유지됩니다.')) return;
      Profiles.hide(pf.id);
      close();
      if (typeof onDone === 'function') onDone();
    };
  };

  /* ═══ 2단계: 일정 창·상세 창에 넣는 업종 선택 줄 ═════════
     폼 안에서는 칩보다 select 가 낫다 — 다른 입력칸들과 줄이 맞고 자리를 안 먹는다.
     마지막 항목 '＋ 업종 추가…' 를 고르면 칩 선택 시트가 열린다. */
  U.selectHtml = function (id, selectedId, label, snap) {
    if (!window.Profiles) return '';
    Profiles.ensure();
    var list = Profiles.list();
    var cur = selectedId || Profiles.currentId();
    /* ⭐ 2026-08-23 — profileId 는 폰마다 다르다. 상대 폰 id 여도 **이름이 같으면 내 업종**이다.
         안 그러면 나도 가진 '에어컨 청소' 작업이 '에어컨 청소 (상대 업종)' 으로 잠기고,
         골라서 저장해도 상대 폰을 한 바퀴 돌아 다시 상대 id 로 내려오므로
         계속 '(상대 업종)' 로 보였다(사용자 보고 2026-08-23).
       ⚠️ snap 은 **그 작업의 사본**이어야 한다. window._workProfileSnap 을 몰래 쓰면
          목록에서 다른 작업을 열었을 때 엉뚱한 업종으로 바뀐다. */
    /* ⚠️ '내 목록에 그 id 가 없을 때만' 되짚으면 안 된다. 두 폰의 첫 업종 id 는 둘 다 'pf_1'
         이라, 팀장의 'pf_1(에어컨 청소)' 이 내 'pf_1(기본)' 에 그대로 걸린다.
         → 사본이 있으면 **언제나** 이름 기준으로 다시 확정한다(Profiles.ownOf 규칙). */
    try {
      if (cur && Profiles.ownOf) {
        var _own = Profiles.ownOf({ profileId: cur, profileSnap: snap || null });
        if (_own) cur = _own.id;
      }
    } catch (e) {}
    // 목록에 없는 id(= 공유받은 상대 업종)면 첫 줄에 그대로 보여준다
    var known = list.some(function (p) { return p.id === cur; });
    /* ⚠️ <option> 안에는 그림(SVG)을 넣을 수 없다 — HTML 제약이다.
         예전엔 대체 이모지를 넣었는데, 다른 화면은 그림이고 여기만 이모지라
         '같은 업종인데 아이콘이 다르다'로 보였다(사용자 지적 2026-08-16).
         → 드롭다운은 **아이콘 없이 이름만** 보여준다. */
    var opts = list.map(function (p) {
      return '<option value="' + esc(p.id) + '"' + (p.id === cur ? ' selected' : '') + '>' +
        esc(p.name || '(이름 없음)') + '</option>';
    }).join('');
    if (!known && cur) {
      /* 내 업종인데 '목록에서 뺀'(hidden) 것일 수 있다 — 그건 상대 업종이 아니다.
         숨긴 걸 다시 목록에 올리지는 않고, 이 줄에만 제 이름으로 보여준다. */
      var _mineHidden = null;
      try { _mineHidden = Profiles.get(cur); } catch (e) {}
      if (_mineHidden) {
        opts = '<option value="' + esc(cur) + '" selected>' + esc(_mineHidden.name || '(이름 없음)') +
               ' (목록에서 뺌)</option>' + opts;
      } else {
        var _sn = snap || window._workProfileSnap;
        var nm = (_sn && _sn.name) || '상대 업종';
        opts = '<option value="' + esc(cur) + '" selected>' + esc(nm) + ' (상대 업종)</option>' + opts;
      }
    }
    /* ★ 2026-08-17 '추가'가 아니라 '관리' — 여기서 추가·전환·이름수정·지침까지 다 된다 */
    opts += '<option value="__add__">⚙️ 업종 관리…</option>';
    return '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">' + esc(label || '업종') + '</label>' +
      '<select class="cust-inp" id="' + esc(id) + '" style="width:100%;margin-top:4px;">' + opts + '</select></div>';
  };
  /* select 를 만든 뒤 반드시 호출 — '⚙️ 업종 관리…' 를 눌렀을 때 시트를 띄우고
     돌아와서 목록을 다시 채운다(안 하면 값이 __add__ 로 저장돼 버린다).

     ★ 2026-08-17 — 예전엔 카탈로그 피커를 띄우고 '방금 추가된 마지막 업종'을 골랐다.
       이제 관리 시트(pick 모드)를 띄우고 **사용자가 실제로 고른 업종**을 받는다.
       ⚠️ 여기서는 setCurrent·bindWork 를 하지 않는다 — 이 select 는 '이 일정'의 값일 뿐,
          앱 전체의 현재 업종이나 지금 열린 작업을 건드리면 안 된다. */
  U.bindSelect = function (id) {
    var sel = document.getElementById(id);
    if (!sel) return;
    var prev = sel.value;
    function refill(keep) {
      var html = U.selectHtml(id, keep, '');
      // option 부분만 갈아끼운다(라벨은 그대로)
      var tmp = document.createElement('div'); tmp.innerHTML = html;
      var fresh = tmp.querySelector('select');
      if (fresh) { sel.innerHTML = fresh.innerHTML; sel.value = keep; prev = keep; }
    }
    sel.addEventListener('change', function () {
      if (sel.value !== '__add__') { prev = sel.value; return; }
      sel.value = prev;
      U.openManager({
        mode: 'pick',
        currentId: prev,
        title: '업종 고르기',
        desc: '고른 업종이 <b>이 일정</b>에 적용됩니다. 업종마다 보고서 제목·호칭과 글쓰기 지침이 달라요.',
        onPick: function (picked) { refill(picked); },
        onClose: function () { refill(sel.value === '__add__' ? prev : (sel.value || prev)); }
      });
    });
  };
  // select 에서 고른 실제 프로필 id (없거나 __add__ 면 현재 업종)
  U.pickedId = function (id) {
    var sel = document.getElementById(id);
    var v = sel ? sel.value : '';
    if (!v || v === '__add__') v = Profiles.currentId();
    return v;
  };

  /* ═══ 2단계: 작업탭 최상단 우측 업종 칩 ══════════════════
     지금 열린 작업이 어느 업종인지 항상 보이게 하고, 눌러서 바꾼다.
     ★ 2026-08-23 — 공유받은 작업의 업종도 바꿀 수 있다(마지막에 저장한 쪽이 이긴다).
        예전엔 '상대 작업의 업종'이라며 잠갔는데, 팀으로 같은 현장을 나눠 하는 구조라
        팀원이 업종을 못 고치는 게 오히려 두 폰의 업종이 어긋난 채 굳는 원인이었다. */
  U.renderWorkChip = function () {
    var el = document.getElementById('workIndChip');
    if (!el || !window.Profiles) return;
    Profiles.ensure();
    var snap = window._workProfileSnap;
    // id 가 달라도 이름이 같으면 내 업종으로 본다(공유작업에서 내가 바꾼 업종이 잠기던 문제)
    var own = Profiles.resolvedForWork ? Profiles.resolvedForWork() : Profiles.get(window._workProfileId);
    /* ⚠️ 2026-08-23 — 예전엔 업종이 없으면 Profiles.current() 로 떨어져서,
         업종을 고른 적 없는 작업이 **'지금 업종'으로 보였다**. 다른 작업에서 업종을 바꾸면
         이 작업의 칩까지 따라 바뀌어 "작업C의 업종이 D에서 B로 변경됐다"로 보였다.
       → 저장된 작업인데 업종이 없으면 '업종 선택'으로 정직하게 보여준다.
         (새 작업은 지금 업종을 그대로 쓰는 게 맞으므로 예전 동작 유지) */
    var _loaded = false;
    try { _loaded = !!window._workProfileLoaded; } catch (e) {}
    var unset = !own && !(snap && (snap.name || snap.icon)) && _loaded;
    var pf = own || (unset ? null : Profiles.current());
    /* ⚠️ 사본(snap)을 먼저 보면 안 된다 — 여기가 마지막까지 남아 있던 곳이라
         같은 업종인데 작업탭 칩만 옛 아이콘으로 보였다(사용자 보고 2026-08-16).
         내 업종이면 언제나 내 프로필의 지금 값. 사본은 내게 없는 업종일 때만. */
    var icon = unset ? '🏷' : (own ? Profiles.iconOf(own) : ((snap && snap.icon) || (pf ? Profiles.iconOf(pf) : '🛠️')));
    var iconHtml = Profiles.iconHtml(icon, 15);
    var name = unset ? '업종 선택' : (own ? (own.name || '업종') : ((snap && snap.name) || (pf && pf.name) || '업종'));
    var foreign = !!(window._workProfileId && !own);
    el.innerHTML = '<span style="font-size:14px;line-height:1;display:inline-flex;align-items:center;">' + iconHtml + '</span>' +
      '<span style="max-width:92px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(name) + '</span>' +
      '<span style="opacity:.55;font-size:9px;">▼</span>';
    el.style.opacity = foreign ? '.8' : (unset ? '.7' : '1');
    el.title = foreign ? '상대 업종입니다 — 눌러서 내 업종으로 바꿀 수 있습니다(상대에게도 반영)'
                       : (unset ? '이 작업은 업종이 지정되지 않았습니다 — 눌러서 고르세요' : '업종 바꾸기');
    el.onclick = function () { U.openSwitcher(); };
  };

  /* 작업탭 칩에서 여는 전환 시트 — ★ 2026-08-17 관리 시트(pick 모드)로 흡수.
     함수는 얇은 래퍼로 남긴다(호출부 보호: renderWorkChip 등).
     ⚠️ 여기가 '작업에 새기는' 유일한 곳이다. 4콜 중 하나라도 빠지면
        골라도 작업에 안 붙거나(bindWork) 저장 버튼이 안 살아난다(markDataDirty). */
  U.applyWorkProfile = function (id) {
    Profiles.bindWork(id, Profiles.snapOf(id));
    /* ⭐ 2026-08-23 공유받은(빌려보는) 작업이면 원작업자 쪽에도 바로 반영한다.
         저장 때 같이 보내기도 하지만(dialogs.js), 공유 작업은 사진이 없으면
         저장을 안 누르는 경우가 많아 여기서 한 번 확실히 밀어준다.
         editItem 이 savedAt 을 올리므로 원작업자의 옛 값 재업로드로 되돌아가지 않는다. */
    try {
      var _bs = window._borrowedShare;
      if (_bs && _bs.ownerUid && _bs.workId && window.CloudShare && CloudShare.editItem) {
        var _sn = Profiles.snapOf(id) || {};
        CloudShare.editItem(_bs.ownerUid, _bs.workId, {
          profileId:   id,
          profileSnap: _sn,
          profileIcon: _sn.icon || '',
          profileName: _sn.name || ''
        }).catch(function () {});
      }
    } catch (e) {}
    /* 작업탭에서 바꾼 업종은 '이 작업'에 붙는다. 저장할 때 _session.json 에 기록된다.
       앞으로 만들 작업의 기본값도 같이 바꿔주는 편이 자연스럽다(연달아 같은 업종을 하니까). */
    Profiles.setCurrent(id);
    // ⚠️ _dataDirty 는 dialogs.js 의 최상위 let(전역 렉시컬)이라 window 로는 못 건드린다.
    //    markDataDirty() 를 써야 저장 버튼이 살아난다.
    try { if (typeof markDataDirty === 'function') markDataDirty(); } catch (e) {}
    try { if (typeof renderAll === 'function') renderAll(); } catch (e) {}
    try {
      var _b2 = window._borrowedShare;
      toast(_b2 && _b2.workId ? '업종을 바꿨습니다 — 상대에게도 반영됩니다'
                              : '업종을 바꿨습니다 — 저장하면 이 작업에 반영됩니다', 'ok');
    } catch (e) { toast('업종을 바꿨습니다', 'ok'); }
  };
  U.openSwitcher = function () {
    Profiles.ensure();
    var _rv = Profiles.resolvedForWork && Profiles.resolvedForWork();
    var curId = (_rv && _rv.id) || window._workProfileId || Profiles.currentId();
    U.openManager({
      mode: 'pick',
      currentId: curId,
      onPick: function (id) { U.applyWorkProfile(id); }
    });
  };

  /* ═══ ⭐ 2026-08-17 설정 표면의 '내 업종' 블록 ═══════════
       업체정보 편집 모달 안에 숨어 있던 것을 설정 화면으로 꺼냈다.
       칩 = 그 업종으로 전환 / 칩 안의 ✏️ = 업종 상세(이름·라벨·지침·양식)로 직행.
       ⚠️ 예전엔 ✏️ 로 가려면 [관리] 시트를 한 번 더 거쳐야 했다 — 그 한 단계가 깊이의 주범. */
  U.renderSettingsIndustries = function () {
    var box = document.getElementById('setIndustryBox');
    if (!box || !window.Profiles) return;
    Profiles.ensure();
    var cur = Profiles.currentId();
    var list = Profiles.list();

    var chips = list.map(function (p) {
      var on = (p.id === cur);
      return '<span class="pfSetChip" data-id="' + esc(p.id) + '" ' +
        'style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;' +
        'padding:7px 6px 7px 12px;border-radius:999px;margin:0 6px 6px 0;cursor:pointer;' +
        'background:' + (on ? 'var(--ac)' : 'var(--sf2)') + ';color:' + (on ? '#fff' : 'var(--tx)') + ';">' +
        '<span class="pfSetPick" style="display:inline-flex;align-items:center;gap:5px;">' +
          Profiles.iconHtml(p, 14) + '<span>' + esc(p.name || '(이름 없음)') + '</span>' +
          (on ? '<span style="font-size:9px;font-weight:800;opacity:.85;">사용중</span>' : '') +
        '</span>' +
        '<span class="pfSetEdit" title="업종 설정·지침" ' +
          'style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;' +
          'border-radius:999px;font-size:11px;background:' + (on ? 'rgba(255,255,255,.22)' : 'rgba(128,128,128,.18)') + ';">✏️</span>' +
        '</span>';
    }).join('');

    box.innerHTML =
      '<div style="background:rgba(77,208,225,.08);border:1px solid rgba(77,208,225,.25);border-radius:10px;padding:12px;">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
          '<div style="font-size:13px;font-weight:700;color:var(--ac);flex:1;">📋 내 업종</div>' +
          '<button type="button" class="btn b-ghost b-xs" id="pfSetAdd">＋ 추가</button>' +
        '</div>' +
        '<div style="margin-bottom:6px;">' +
          (chips || '<span style="font-size:12px;color:var(--mu);">아직 등록된 업종이 없습니다</span>') + '</div>' +
        '<div style="font-size:10px;color:var(--mu);line-height:1.6;">' +
          '칩을 누르면 그 업종으로 바뀌고, <b>✏️</b> 를 누르면 그 업종의 ' +
          '<b>보고서 제목·호칭·글쓰기 지침·견적 지침·양식</b>을 설정합니다.</div>' +
      '</div>';

    var addBtn = document.getElementById('pfSetAdd');
    if (addBtn) addBtn.onclick = function () { U.openPicker(function () { U.renderSettingsIndustries(); }); };

    box.querySelectorAll('.pfSetChip').forEach(function (c) {
      var id = c.getAttribute('data-id');
      var pick = c.querySelector('.pfSetPick');
      var edit = c.querySelector('.pfSetEdit');
      if (pick) pick.onclick = function (e) {
        e.stopPropagation();
        Profiles.setCurrent(id);
        toast('업종을 바꿨습니다', 'ok');
        U.renderSettingsIndustries();
      };
      if (edit) edit.onclick = function (e) {
        e.stopPropagation();
        U.openEdit(id, function () { U.renderSettingsIndustries(); });
      };
    });
  };
  /* 업종이 바뀌면(어느 화면에서 바꿨든) 설정 블록도 따라 갱신 */
  try {
    window.addEventListener('profileChanged', function () {
      try { U.renderSettingsIndustries(); } catch (e) {}
    });
  } catch (e) {}

  /* 업체정보 모달 안의 '내 업종' 블록 — ★ 2026-08-17 설정 표면으로 옮기면서 안내만 남긴다.
     ⚠️ 함수는 지우지 않는다: dialogs.js populateIndustryDropdowns 가 매번 부른다. */
  U.renderCoSection = function () {
    var box = document.getElementById('coIndustryBox');
    if (!box || !window.Profiles) return;
    Profiles.ensure();
    var cur = Profiles.current();
    box.innerHTML =
      '<div style="font-size:12px;color:var(--mu);line-height:1.6;">' +
        '이 화면은 <b>사업자 정보</b>(상호·사업자번호·대표·주소·연락처·계좌)만 다룹니다.<br>' +
        '업종별 <b>보고서 제목·호칭·글쓰기 지침·견적 지침</b>은 설정 화면의 <b>📋 내 업종</b> 에서 설정하세요.' +
        (cur ? '<br><span style="color:var(--ac);font-weight:700;">지금 쓰는 업종 · ' + esc(cur.name || '') + '</span>' : '') +
      '</div>';
  };
})();
