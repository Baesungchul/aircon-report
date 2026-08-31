/* ═══════════════════════════════════════════════
   calendar.js — 작업 기록 캘린더 뷰 (v2.2)
   Samsung Calendar 스타일 (도트 방식)
═══════════════════════════════════════════════ */

(function () {
  'use strict';

  let _calYear  = new Date().getFullYear();
  let _calMonth = new Date().getMonth();
  let _calItems = null;
  let _dateMap  = {};
  let _monthCache = {};  // 'YYYY-MM' -> items[] (열려있는 동안 달별 캐시)
  let _boundaryMap = {}; // 인접 달(이전/다음) 경계 날짜 -> items[] : 흐린 칸에 점만 표시
  let _boundaryKey = ''; // _boundaryMap 이 어느 달 기준인지 (스테일 방지)
  let _boundaryScanCache = {}; // 경계 표시 전용 스캔 캐시 (★ 메인 _monthCache 와 분리 — 절대 섞지 않음)
  let _boundaryBusy = false;   // 경계 로더 중복 실행 방지
  let _selDate  = null;
  let _isOpen   = false;
  let _loadGen  = 0;  // 로드 세대 카운터 — 구버전 결과가 최신 결과를 덮어쓰는 것 방지
  /* ★ 2026-08-16 달력 확장(아래로 당겨 늘리기)
     · 확장 중에만 날짜 칸에 업종 아이콘을 그린다.
       접힘 상태의 5px 점 자리에 그림을 넣으면 뭉개지고, 42칸 × 최대 4개라 DOM 도 무거워진다.
     · 업종 조회(Profiles.get)는 호출할 때마다 localStorage 를 파싱하므로
       렌더 1회 동안만 쓰는 메모 캐시를 둔다(칸마다 부르면 수백 번 파싱된다). */
  let _expanded   = false;
  /* ★ 2026-08-27 펼침 보기 두 가지 (사용자 요청 — "예전 달력 키우기도 좋았다")
       'list' = 세로 목록(아젠다, 2026-08-22 부터의 기본)
       'grid' = 7열 격자를 화면 가득 키우고 칸마다 [업종아이콘][시작시간]  ← 예전 '달력 키우기'
     ⭐ 격자 코드는 지운 적이 없다. 아젠다는 renderCalendarGrid() 에서 분기 한 줄로
        갈아 끼웠을 뿐이라, 그 조건에 이 값을 더하는 것만으로 예전 화면이 그대로 돌아온다.
     ⚠️ 격자 보기는 '화면 폭 ÷ 7' 이라 글자 크기를 키우면 칸이 오히려 좁아진다(45→31px).
        그래서 격자 보기에서만 .cal-icos 에 --fs-unzoom 예외를 되살렸다(styles.css).
        목록 보기는 화면 폭을 통째로 쓰므로 글자 크기가 그대로 먹는다. 이게 두 보기의 맞바꿈이다. */
  const _EXPVIEW_KEY = 'calExpandView';
  let _expandView = 'list';
  try { if (localStorage.getItem(_EXPVIEW_KEY) === 'grid') _expandView = 'grid'; } catch (e) {}
  /* ⭐ 2026-08-22 확장은 세로 목록(아젠다)이라 '접힘 격자 높이'를 그 자리에서 잴 수 없다.
     접힘으로 그릴 때마다 기억해 두고, 접기 드래그의 하한(vLo)으로 쓴다. */
  let _lastNaturalH = 0;
  let _pfIconMemo = null;
  let _pfSoloIcon = '';   // 내 업종이 딱 하나일 때 그 아이콘 (렌더 시작 때 한 번만 구한다)

  /* ── 유틸 */
  function _pad(n) { return String(n).padStart(2, '0'); }
  function _escH(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  const _today = (function () {
    var d = new Date();
    return d.getFullYear() + '-' + _pad(d.getMonth() + 1) + '-' + _pad(d.getDate());
  })();

  /* ══════════════════════════════════════════
     인터셉트: openCustomerModal
     원래 함수 완료(권한 확보) 후 캘린더 시작
  ══════════════════════════════════════════ */
  function interceptOpenCustomerModal() {
    if (typeof window.openCustomerModal !== 'function') {
      setTimeout(interceptOpenCustomerModal, 300);
      return;
    }
    const _orig = window.openCustomerModal;
    window.openCustomerModal = async function () {
      await _orig.call(this);
      var body = document.getElementById('customerBody');
      if (!body) return;
      if (body.querySelector('#reconnectFolderBtn')) return;

      _isOpen = true;
      if (body.querySelector('#calWrap')) {
        /* ★ 2026-08-31 1차 수정 — 사용자 보고: "설정탭에서 스케줄로 이동했더니 펼침 화면이
           위쪽 절반만 보이는 채로 깨져 있었다" (드래그·인터럽트 등 다른 이벤트는 없었음).
           원인: 펼친(_expanded=true) 채로 다른 탭에 갔다가 돌아오면 이 재열기 경로를 타는데,
           renderCalendarShell()을 다시 안 부르니 _expanded 가 초기화되지 않고, 여기서
           loadCalendarData()로 내용만 새로 그릴 뿐 높이를 다시 맞추는 코드가 하나도 없었다
           — 그래서 예전에(또는 숨겨진 동안) 어긋난 grid 높이가 그대로 굳어 있었다.

           ★ 2026-08-31 2차 수정(사용자 피드백 — "결국 돌아오긴 하는데 깨진 게 잠깐 보인다") —
           1차 수정은 loadCalendarData() 가 다 끝난 '뒤에' 높이를 고쳤다. loadCalendarData()
           는 폴더 스캔 등으로 시간이 걸릴 수 있어, 그 사이 사용자 눈엔 깨진 화면이 그대로
           보였다. 펼친 높이(_expandedHeight)는 목록 내용과 무관하게 화면 크기만으로
           정해지므로, 데이터를 기다릴 필요가 없다 — 화면이 다시 보이는 이 시점에 **곧바로,
           애니메이션 없이** 높이부터 맞추고 나서(화면엔 이미 정상 크기로 보임) 그다음에
           내용을 새로고침한다. */
        var _wGrid = document.getElementById('calGrid');
        if (_expanded && _wGrid) {
          _wGrid.style.transition   = 'none';
          _wGrid.style.gridAutoRows = '1fr';
          _wGrid.style.height       = _expandedHeight() + 'px';
        }
        _calItems = null;
        _dateMap  = {};
        _monthCache = {};
        await loadCalendarData();
        // 내용이 새로 들어온 뒤 혹시 남은 오차(개수 변화 등)를 마무리로 한 번 더 다듬는다
        if (_expanded) { try { _fitExpanded(0); } catch (e) {} }
      } else {
        await window.__calendarOpen();
      }
    };
  }

  /* ══════════════════════════════════════════
     인터셉트: renderCustomerList
     캘린더가 그려진 경우 덮어쓰기 차단
  ══════════════════════════════════════════ */
  function interceptRenderCustomerList() {
    if (typeof window.renderCustomerList !== 'function') {
      setTimeout(interceptRenderCustomerList, 300);
      return;
    }
    const _orig = window.renderCustomerList;
    window.renderCustomerList = async function (opts) {
      var body = document.getElementById('customerBody');
      if (body && body.querySelector('#calWrap')) {
        // ★ rebuildIndexFromFolders 완료 직후 호출됨 → 여기서 새로고침해야 최신 인덱스 사용
        _calItems = null;
        _dateMap  = {};
        _monthCache = {};
        loadCalendarData();
        return;
      }
      return _orig.call(this, opts);
    };
  }

  /* ══════════════════════════════════════════
     훅: invalidateRecordsCache
     새 작업 저장 / 새로고침 버튼 후 캘린더 자동 갱신
     ★ customers.js 새로고침 버튼은 교체하지 않음
       → 원래 핸들러가 invalidateRecordsCache 호출 → 이 훅이 캘린더 새로고침
  ══════════════════════════════════════════ */
  function hookCacheInvalidation() {
    const _orig = window.invalidateRecordsCache;
    window.invalidateRecordsCache = function () {
      if (typeof _orig === 'function') _orig.call(this);
      if (_isOpen) {
        _calItems = null;
        _dateMap  = {};
        _monthCache = {};
        loadCalendarData();
      }
    };
  }

  /* ── 모달 닫힘 감지 */
  function watchModalClose() {
    var modal = document.getElementById('customerModal');
    if (!modal) { setTimeout(watchModalClose, 500); return; }
    new MutationObserver(function () {
      if (!modal.classList.contains('open')) _isOpen = false;
    }).observe(modal, { attributes: true, attributeFilter: ['class'] });
  }

  /* ══════════════════════════════════════════
     진입점
  ══════════════════════════════════════════ */
  window.__calendarOpen = async function () {
    _isOpen   = true;
    _calItems = null;
    _dateMap  = {};
    _monthCache = {};  // 새로 열 때 최신 데이터로
    _selDate  = null;
    renderCalendarShell();
    renderCalendarGrid();       // ★ 달력 뼈대 먼저 표시 (일정은 로드 후 채움)
    _pulseGrab();
    await loadCalendarData();
  };

  /* ══════════════════════════════════════════
     ★ 월별 localStorage 캐시 — 스캔 완료 전 즉시 표시용 (2026-07-21)
     - 사진 메타(썸네일 base64)는 제외한 슬림 데이터만 저장
     - 표시 전용: 수정은 반드시 디스크 _session.json 재로드 후 진행 (_slim 플래그)
  ══════════════════════════════════════════ */
  var CAL_LS_PREFIX = 'calCache_';
  function _slimCalItems(items) {
    var out = [];
    (items || []).forEach(function (it) {
      if (!it || it.type !== 'work' || !it.data) return;   // 로컬 작업만 저장 (공유 일정은 CloudShare가 실시간 관리)
      var d = it.data;
      var sess = d.session || {};
      out.push({
        type: 'work',
        sortDate: it.sortDate || '',
        _fromPrevMonth: !!it._fromPrevMonth,
        data: {
          _slim: true,
          folderName: d.folderName || '',
          dirHandle: null,
          apt: d.apt || '', date: d.date || '', endDate: d.endDate || '',
          worker: d.worker || '',
          totalUnits: d.totalUnits || 0, totalPhotos: d.totalPhotos || 0,
          units: (d.units || []).map(function (u) {
            return {
              name: u.name || '', workNum: u.workNum || 0,
              beforeCount: u.beforeCount || 0, afterCount: u.afterCount || 0,
              specials: (u.specials || []).map(function (s) {
                return { desc: (s && s.desc) || '', photoCount: (s && (s.photoCount || (s.photosMeta && s.photosMeta.length))) || 0 };
              }),
              customer: u.customer || null
            };
          }),
          session: {
            workType: sess.workType || 'household',
            endDate: sess.endDate || '',
            worker: sess.worker || '',
            facilityCustomer: sess.facilityCustomer || null,
            posts: (Array.isArray(sess.posts) ? sess.posts : []).map(function () { return 1; }),  // 개수만 보존 (배지용)
            /* ⭐ 2026-08-16 버그수정 — 앱을 껐다 켜면 내 작업의 업종 아이콘이 사라지던 원인.
               달력은 이 슬림캐시로 먼저 그리는데, 여기 담기는 session 필드가 화이트리스트라
               profileId/profileSnap 이 빠져 있었다(공유 카드는 실시간이라 멀쩡해서 더 헷갈렸다).
               ⚠️ session 에 표시용 필드를 추가하면 여기도 같이 넣을 것. */
            profileId: sess.profileId || '',
            profileSnap: sess.profileSnap || null
          }
        }
      });
    });
    return out;
  }
  function _saveMonthCacheLS(month, items) {
    try {
      var txt = JSON.stringify(_slimCalItems(items));
      if (txt.length > 500000) return;   // 안전 상한 (localStorage 용량 보호)
      localStorage.setItem(CAL_LS_PREFIX + month, txt);
      // 오래된 달 정리 (최근 8개 달만 보관)
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(CAL_LS_PREFIX) === 0) keys.push(k);
      }
      if (keys.length > 8) {
        keys.sort();
        while (keys.length > 8) { localStorage.removeItem(keys.shift()); }
      }
    } catch (e) { /* 용량 초과 등 → 캐시 없이 동작 */ }
  }
  function _loadMonthCacheLS(month) {
    try {
      var txt = localStorage.getItem(CAL_LS_PREFIX + month);
      if (!txt) return null;
      var arr = JSON.parse(txt);
      return (Array.isArray(arr) && arr.length) ? arr : null;
    } catch (e) { return null; }
  }
  // ── 삭제한 작업을 localStorage 월 캐시에서도 즉시 제거 ──
  //   (작업 수가 적은 기기에서 삭제 후 폴더 스캔이 0건이 되면 loadCalendarData가
  //    '빈 스캔=신뢰불가'로 판단해 낡은 캐시를 유지 → 삭제한 작업이 되살아나던 문제 방지)
  function _purgeWorkFromMonthCacheLS(folderName) {
    if (!folderName) return;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf(CAL_LS_PREFIX) !== 0) continue;
        var txt = localStorage.getItem(k);
        if (!txt || txt.indexOf(folderName) === -1) continue;
        var arr; try { arr = JSON.parse(txt); } catch (e) { continue; }
        if (!Array.isArray(arr)) continue;
        var filtered = arr.filter(function (it) {
          return !(it && it.type === 'work' && it.data && it.data.folderName === folderName);
        });
        if (filtered.length !== arr.length) {
          try { localStorage.setItem(k, JSON.stringify(filtered)); } catch (e) {}
        }
      }
    } catch (e) {}
  }
  // ── 공유(상대) 일정 숨김: 내가 지울 수 없는 상대 소유 일정을 내 달력에서만 안 보이게 ──
  function _shHideKey(d){ return (d && ((d.ownerUid||'')+'|'+(d.workId|| ((d.apt||'')+'@'+(d.date||''))))) || ''; }
  function _shHiddenSet(){ try{ return JSON.parse(localStorage.getItem('calHiddenShared')||'{}')||{}; }catch(e){ return {}; } }
  function _shIsHidden(d){ var k=_shHideKey(d); return !!(k && _shHiddenSet()[k]); }
  function _shHide(k){ if(!k) return; var h=_shHiddenSet(); h[k]=1; try{ localStorage.setItem('calHiddenShared', JSON.stringify(h)); }catch(e){} }
  if (!window.__calShHideInit) {
    window.__calShHideInit = true;
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('.cal-shared-hide');
      if (!btn) return;
      e.stopPropagation(); e.preventDefault();
      if (!confirm('이 공유 일정을 내 달력에서 숨길까요?\n(상대가 삭제했거나 더 이상 필요 없는 경우)')) return;
      _shHide(btn.getAttribute('data-hidekey') || '');
      if (window.__calendarRefresh) window.__calendarRefresh();
      if (typeof showToast === 'function') showToast('공유 일정을 숨겼습니다', 'ok');
    }, true);
  }

  // 공유 일정 병합 + 수동일정 중복 숨김 (캐시 표시/스캔 완료 양쪽에서 동일 규칙)
  function _withShared(baseItems, month) {
    var out = (baseItems || []).slice();
    try {
      if (window.CloudShare && CloudShare.getItemsForMonth) {
        var _sh = CloudShare.getItemsForMonth(month) || [];
        if (_sh.length) out = out.concat(_sh);
      }
      // ★ 개인 리마인더(공유 안 되는 내 참고용 일정) 병합
      if (window.Reminders && Reminders.forMonth) {
        (Reminders.forMonth(month) || []).forEach(function (r) {
          out.push({
            type: 'reminder',
            sortDate: (r._occDate || r.date) + 'T' + (r.time || '00:00'),
            data: r
          });
        });
      }
      // ★ 사용자가 '숨김' 처리한 공유(상대) 일정 제외
      /* ★ 2026-08-26 자원점검: 예전엔 filter 콜백이 항목마다 _shIsHidden → _shHiddenSet() 을 불러
         항목 수만큼 localStorage 읽기 + JSON.parse 가 돌았다(둘 다 동기 → 그리는 스레드를 그대로 막는다).
         밖에서 한 번만 읽어 쓴다. 판정 규칙과 결과는 완전히 동일하다. */
      var _hidSet = _shHiddenSet();
      out = out.filter(function (it) {
        if (!(it && it.type === 'shared')) return true;
        var _k = _shHideKey(it.data);
        return !(_k && _hidSet[_k]);
      });
    } catch (e) {}
    try {
      // 실제 작업(로컬 work / 상대의 비-수동 작업)이 있는 날짜+현장 (사진 수 무관)
      var _realWork = {};
      out.forEach(function (it) {
        var _isReal = (it.type === 'work') || (it.type === 'shared' && it.data && !it.data.manual);
        if (_isReal && it.data) _realWork[((it.data.date) || '') + '|' + ((it.data.apt) || '')] = 1;
      });
      // 📅 수동 일정은 같은 날짜+현장에 실제 작업이 있으면 숨김 (재등장/중복 방지)
      out = out.filter(function (it) {
        if (it.type === 'shared' && it.data && it.data.manual
            && _realWork[(it.data.date || '') + '|' + (it.data.apt || '')]) return false;
        return true;
      });
    } catch (e) {}
    return out;
  }

  /* ══════════════════════════════════════════
     데이터 로드
  ══════════════════════════════════════════ */
  async function loadCalendarData() {
    var myGen = ++_loadGen;  // 이 호출의 세대 번호
    setCalLoading(true);
    // ★ 콜드스타트 지연 방지(2026-07-24): 폴더 권한 확인 전에 로컬 월 캐시부터 '즉시' 그린다
    //   (예전엔 권한 await 뒤에 있어, 네이티브 폴더 재연결이 느리면 내 일정이 한참 안 보였음)
    var _monthFast = _calYear + '-' + _pad(_calMonth + 1);
    if (!_monthCache[_monthFast]) {
      try {
        var _lsFast = _loadMonthCacheLS(_monthFast);
        if (_lsFast) {
          try { if (window.CloudShare && CloudShare.ensure) CloudShare.ensure(); } catch (e) {}
          _calItems = _withShared(_lsFast, _monthFast);
          buildDateMap();
          renderCalendarGrid();
          if (_selDate) renderDayDetail(_selDate);
        }
      } catch (e) {}
    }
    try {
      // 폴더 권한 확인
      if (typeof photoFolderHandle !== 'undefined' && photoFolderHandle) {
        try {
          var perm = await photoFolderHandle.queryPermission({ mode: 'readwrite' });
          if (perm !== 'granted' && typeof requestFolderPermissionSafe === 'function') {
            await requestFolderPermissionSafe('readwrite');
          }
        } catch (e) {}
      }

      // ★ 현재 보고 있는 '달'에 해당하는 폴더만 스캔 (대량 작업 성능: 폴더명에 날짜 포함)
      var _month = _calYear + '-' + _pad(_calMonth + 1);
      var items;
      if (_monthCache[_month]) {
        items = _monthCache[_month];
      } else {
        // (캐시-우선 즉시표시는 loadCalendarData 진입부에서 이미 처리함 - 폴더권한 대기 전)
        var scanned = await scanFoldersDirect(_month);
        if (myGen !== _loadGen) return;
        var _scanEmpty = (Array.isArray(scanned) && scanned.length === 0);
        if (scanned === null || _scanEmpty) {
          // 스캔 실패(null) 또는 0건([]) → 인덱스로 교차검증.
          //   (폴더가 순간 미준비이거나 _session.json 읽기가 일시 실패하면 스캔이 0건이 되어 '내 일정만' 사라지는 오탐이 생김 → 인덱스/캐시로 방어)
          var _idxItems = null;
          if (typeof loadCombinedRecords === 'function') {
            try {
              var all = await loadCombinedRecords({ allDates: true });
              if (myGen !== _loadGen) return;
              _idxItems = (all || []).filter(function (it) {
                /* ★ 2026-08-30 버그수정 — 달력 목록에 '작업명' 대신 전화번호가 나오던 원인.
                   loadCombinedRecords 는 달력용이 아니라 기록·고객 목록용이라
                   type:'work' 과 함께 **type:'customer'(고객 카드)** 도 돌려준다.
                   그걸 그대로 _calItems 에 넣으니 아젠다 줄이 고객 카드로 그려졌고,
                   _itemTitle 의 customer 분기가 `d.name || d.phone` 이라
                   이름이 빈 고객은 제목 자리에 전화번호가 찍혔다.
                   ⚠️ 더 나쁜 건 길이 판정이었다 — 고객 카드만 들어와도 _idxItems.length 가 참이 되어
                      '복구 성공'으로 보고 멀쩡한 캐시를 고객 카드로 덮어썼다.
                      작업만 남기면 이 경우 0건이 되어 아래 '캐시 유지' 가지로 제대로 떨어진다.
                   (폴더 스캔이 일시 실패했을 때만 지나는 길이라 재실행하면 저절로 사라졌다) */
                if (!it || it.type !== 'work') return false;
                var d = (it.data && it.data.date) || (it.sortDate || '');
                return String(d).slice(0, 7) === _month;
              });
            } catch (e) {}
          }
          if (_idxItems && _idxItems.length) {
            items = _idxItems;   // 인덱스에 내 일정 있음 → 복구
          } else if (_scanEmpty && !(_calItems || []).some(function (it) { return it && it.type === 'work'; })) {
            items = [];          // 스캔·인덱스 모두 0건이고 표시중인 내 작업도 없음 → 진짜 빈 달
          } else {
            // ★ 신뢰할 데이터 없음(또는 내 일정 캐시가 있음) → 빈 값으로 덮지 않고 캐시 유지. 폴더 준비되면 다시 로드됨.
            //   (예전엔 여기서 items=[]로 덮고 캐시에 빈 값을 저장해 → 재실행 때도 내 일정이 사라졌음)
            setCalLoading(false);
            return;
          }
        } else {
          items = scanned;
        }
        _monthCache[_month] = items;
        _saveMonthCacheLS(_month, items);   // ★ 다음에 열 때 즉시 표시용
      }

      // ★ 더 최신 호출이 이미 완료됐으면 결과 버림 (레이스 컨디션 방지)
      if (myGen !== _loadGen) return;

      _calItems = items || [];
      /* ⭐ 2026-08-13 상대가 고친 값(오버라이드)을 항목에 직접 얹는다.
         예전엔 카드를 그릴 때만 부분적으로(_ovOf) 참고했다. 그래서 '어느 날짜 칸에 놓을지'를
         정하는 date 같은 값은 로컬 _session.json 이 갱신되기 전까지 전혀 반영되지 않았고,
         작업자도 배지 한 곳에서만 보정돼 상세·작업열기·업로드는 옛 값을 그대로 썼다.
         여기서 한 번 얹으면 달력 배치·정렬·상세·작업열기·pushWorkItems 업로드까지
         전부 같은 값을 본다. (업로드까지 새 값이 나가므로 되돌아감도 함께 끊긴다) */
      try {
        if (window.CloudShare && CloudShare.getOverride) {
          _calItems.forEach(function (it) {
            if (!it || it.type !== 'work' || !it.data) return;
            var ov = CloudShare.getOverride(it.data.folderName || it.data.workId);
            if (!ov) return;
            if (ov.worker) it.data.worker = ov.worker;
            if (ov.date)   it.data.date   = ov.date;
            if (ov.apt)    it.data.apt    = ov.apt;
            if (ov.endDate !== undefined && ov.endDate !== null) it.data.endDate = ov.endDate;
          });
        }
      } catch (eov) { console.warn('[달력] 오버라이드 적용 실패', eov); }
      try { if (window.CloudSync && CloudSync.pushWorkItems) CloudSync.pushWorkItems((_calItems || []).filter(function (it) { return !it._fromPrevMonth; }), _month); } catch(e){}
      try { if (window.CloudShare && CloudShare.ensure) CloudShare.ensure(); } catch(e){}
      _calItems = _withShared(_calItems, _month);   // ★ 공유 일정 병합 + 수동중복 숨김 (캐시 표시와 동일 규칙)
      buildDateMap();
    } catch (e) {
      if (myGen !== _loadGen) return;
      console.warn('[캘린더] 데이터 로드 실패:', e);
      _calItems = [];
      _dateMap  = {};
    }
    setCalLoading(false);
    renderCalendarGrid();
    if (_selDate) renderDayDetail(_selDate);
    // 인접 달 경계 칸 점은 메인 렌더 후 조용히 채움
    _boundaryKey = '';   // 달이 바뀌었을 수 있으므로 다시 로드하게 함
    loadBoundaryMonths();
  }

  /* ══════════════════════════════════════════
     폴더 직접 스캔 (Web FS API — Capacitor 인덱스 우회)
     photoFolderHandle.values() 를 직접 순회
  ══════════════════════════════════════════ */
  async function scanFoldersDirect(monthStr) {
    if (typeof photoFolderHandle === 'undefined' || !photoFolderHandle) return null;  // ★ 폴더 미준비 = 스캔실패(null), 빈 달([])과 구분
    var results = [];
    // ★ 여러 날 작업: 이전 달에 시작해 이번 달까지 이어지는 작업도 잡기 위해 이전 달 폴더도 확인
    var prevMonth = '';
    if (monthStr) {
      var _pm = monthStr.split('-'); var _py = +_pm[0]; var _pmm = +_pm[1] - 1;
      if (_pmm < 1) { _py--; _pmm = 12; }
      prevMonth = _py + '-' + _pad(_pmm);
    }
    try {
      for await (var entry of photoFolderHandle.values()) {
        if (entry.kind !== 'directory') continue;
        if (!/^\d{4}-\d{2}-\d{2}/.test(entry.name)) continue;
        var _fMonth = entry.name.slice(0, 7);
        if (monthStr && _fMonth !== monthStr && _fMonth !== prevMonth) continue;  // ★ 현재 달 + 이전 달만 읽음
        try {
          var sf   = await entry.getFileHandle('_session.json');
          var file = await sf.getFile();
          var data = JSON.parse(await file.text());
          if (!data.units || !data.units.length) continue;

          var fn   = entry.name;
          // ★ 이전 달 폴더는 '이번 달까지 이어지는(endDate)' 작업만 포함
          var _isPrev = !!(monthStr && _fMonth !== monthStr);
          if (_isPrev && (!data.endDate || String(data.endDate).slice(0, 7) < monthStr)) continue;
          var mFn  = fn.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})/);
          var sortKey = mFn ? (mFn[1] + 'T' + mFn[2] + ':' + mFn[3])
                            : (fn.slice(0, 10) + 'T00:00');
          var date = data.date || fn.slice(0, 10);

          results.push({
            type: 'work',
            sortDate: sortKey,
            _fromPrevMonth: _isPrev,
            data: {
              folderName:  fn,
              dirHandle:   entry,
              apt:         data.apt    || '',
              date:        date,
              endDate:     data.endDate || '',
              worker:      data.worker || '',
              units:       data.units,
              totalUnits:  data.units.length,
              totalPhotos: data.units.reduce(function (s, u) {
                return s + (u.beforeCount || 0) + (u.afterCount || 0);
              }, 0),
              session: data
            }
          });
        } catch (e) { /* _session.json 없거나 파싱 오류 → skip */ }
      }
    } catch (e) {
      console.warn('[캘린더] 직접 스캔 오류:', e);
      return null;  // ★ 루트 스캔 실패 → 폴백 신호 (빈 달과 구분)
    }
    return results;
  }

  function _nextDateStr(ds) {
    var q = ds.split('-');
    var d = new Date(+q[0], +q[1] - 1, +q[2] + 1);
    return d.getFullYear() + '-' + _pad(d.getMonth() + 1) + '-' + _pad(d.getDate());
  }

  function buildDateMap() {
    _dateMap = {};
    var _spans = [];
    (_calItems || []).forEach(function (it) {
      var date = '';
      if (it.type === 'work' || it.type === 'shared' || it.type === 'reminder') {
        // ★ reminder 도 여기 포함해야 한다. 빠져 있으면 date가 ''로 남아 아래에서 return 되고,
        //   _dateMap 에 안 들어가 달력 점도 날짜 상세 카드도 전혀 나오지 않는다. (2026-08-08 수정)
        date = it.data.date || (it.sortDate || '').slice(0, 10);
      } else if (it.type === 'customer') {
        date = it.data.lastVisit || (it.sortDate || '').slice(0, 10);
      }
      // YYYY-MM-DD 형식 검증
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      // ★ 여러 날 작업(endDate): 일단 모아뒀다가 lane(줄) 배치 후 날짜별로 펼침
      // ★ 2026-08-17 리마인더도 종료일(기간)을 가질 수 있다
      var endD = ((it.type === 'work' || it.type === 'shared' || it.type === 'reminder') && it.data && it.data.endDate)
        ? String(it.data.endDate) : '';
      if (endD && /^\d{4}-\d{2}-\d{2}$/.test(endD) && endD > date) {
        _spans.push({ it: it, start: date, end: endD });
        return;
      }
      if (!_dateMap[date]) _dateMap[date] = [];
      _dateMap[date].push(it);
    });
    // ★ 겹치는 기간 작업은 서로 다른 줄(lane)에 "고정" 배치 → 날짜마다 줄 위치가 튀지 않음
    _spans.sort(function (a, b) {
      if (a.start !== b.start) return a.start < b.start ? -1 : 1;
      var ak = (a.it.data && (a.it.data.folderName || a.it.data.workId)) || '';
      var bk = (b.it.data && (b.it.data.folderName || b.it.data.workId)) || '';
      return ak < bk ? -1 : 1;
    });
    var _laneEnds = [];
    _spans.forEach(function (spn) {
      var lane = 0;
      while (lane < _laneEnds.length && _laneEnds[lane] >= spn.start) lane++;
      _laneEnds[lane] = spn.end;
      spn.lane = lane;
    });
    _spans.forEach(function (spn) {
      var cur = spn.start, guard = 0;
      while (cur <= spn.end && guard++ < 62) {
        if (!_dateMap[cur]) _dateMap[cur] = [];
        var clone = Object.assign({}, spn.it);
        clone._span = { start: spn.start, end: spn.end, lane: spn.lane, pos: (cur === spn.start ? 'start' : (cur === spn.end ? 'end' : 'mid')) };
        _dateMap[cur].push(clone);
        cur = _nextDateStr(cur);
      }
    });

    /* ★ 2026-08-08 달력 점(dot)도 시간순으로
         지금까지는 배열에 담긴 순서(작업 → 공유 → 리마인더)로 점이 찍혀서,
         날짜 상세 목록은 시간순인데 점 순서는 달라 헷갈렸다.
         · 기간작업(_span)은 lane(줄) 기준으로 막대로 그려지므로 순서를 건드리지 않고 앞에 모아둔다.
         · 나머지(점으로 찍히는 항목)만 시작시간 오름차순, 시간 없는 항목은 뒤로. */
    Object.keys(_dateMap).forEach(function (d) {
      var arr = _dateMap[d];
      if (!arr || arr.length < 2) return;
      arr.sort(function (a, b) {
        var sa = a && a._span ? 1 : 0, sb = b && b._span ? 1 : 0;
        if (sa !== sb) return sb - sa;      // 기간작업 먼저(막대)
        if (sa && sb) return 0;             // 기간작업끼리는 기존 lane 순서 유지
        var ta = _itemStart(a), tb = _itemStart(b);
        if (ta && tb) return ta < tb ? -1 : (ta > tb ? 1 : 0);
        if (ta) return -1;
        if (tb) return 1;
        return 0;
      });
    });
  }

  /* ══════════════════════════════════════════
     캘린더 껍데기 렌더
     ★ 클릭 핸들러는 여기서 딱 한 번만 등록
  ══════════════════════════════════════════ */
  function renderCalendarShell() {
    var body = document.getElementById('customerBody');
    if (!body) return;
    body.innerHTML =
      '<div class="cal-wrap" id="calWrap">' +
        '<div class="cal-nav">' +
          '<button class="cal-nav-btn" id="calPrev">&#8249;</button>' +
          /* ⚠️ 라벨을 가운데 묶음으로 감쌌다 — renderCalendarGrid 가 건수(calCountSub)를
             label.parentNode 에 끼워 넣으므로 이 묶음 안에 나란히 들어간다. */
          '<div class="cal-nav-mid">' +
            '<div class="cal-nav-label" id="calNavLabel">' + _calYear + '년 ' + (_calMonth + 1) + '월</div>' +
          '</div>' +
          '<button class="cal-nav-btn" id="calNext">&#8250;</button>' +
          '<button class="cal-today-btn" id="calToday">오늘</button>' +
          /* ★ 2026-08-27 펼친 동안에만 보이는 보기 전환 (CSS 에서 .cal-expanded 일 때만 표시).
             ⚠️ 네비 줄은 배율 1.44 에서 CSS 폭이 285px 뿐이다 → 글자 없이 아이콘만, 폭 고정 최소로. */
          '<button class="cal-view-btn" id="calViewToggle" aria-label="보기 전환"></button>' +
        '</div>' +
        '<div class="cal-dow-row">' +
          '<span class="cal-dow sun">일</span>' +
          '<span class="cal-dow">월</span>' +
          '<span class="cal-dow">화</span>' +
          '<span class="cal-dow">수</span>' +
          '<span class="cal-dow">목</span>' +
          '<span class="cal-dow">금</span>' +
          '<span class="cal-dow sat">토</span>' +
        '</div>' +
        '<div class="cal-grid" id="calGrid"><div class="cal-loading">⏳ 불러오는 중…</div></div>' +
        /* ⭐ 2026-08-22 '아래로 당기면 펼쳐진다'는 표시 (사용자 제안).
           ⚠️ 화면 맨 아래(.cal-swipe-hint '⬆️ 위로 밀어 목록 보기')가 아니라 **격자 바로 아래**에 둔다.
              맨 아래에 두면 같은 자리에서 화살표 둘이 반대 방향으로 흔들리고,
              손잡이는 '잡아당길 물건의 가장자리'에 있어야 뜻이 통한다. */
        '<div class="cal-grab" id="calGrab" title="아래로 당기면 한 달 목록">' +
          '<span class="cal-grab-bar"></span>' +
          '<span class="cal-grab-tx">⌄</span>' +
        '</div>' +
        '<div class="cal-revenue" id="calRevenue"></div>' +
        '<div class="cal-detail" id="calDetail" style="display:none;"></div>' +
        '<div class="cal-swipe-hint" id="calSwipeHint"><span>⬆️ 위로 밀어 목록 보기</span></div>' +
      '</div>';
    body.classList.add('cal-mode');  // 달력 상단 고정 + 목록만 스크롤 레이아웃
    _expanded = false;               // ★ 껍데기를 새로 그리면 확장 상태도 초기화
    body.classList.remove('cal-expanded');
    body.classList.remove('cal-exp-grid');
    body.classList.remove('cal-exp-list');
    _syncFab();                      // ＋ 버튼도 원래 모양으로 (펼친 채 탭을 옮겼다 돌아온 경우)
    window._calSelectedDate = null;  // 달력 열 때 선택 날짜 초기화

    // ★ 스와이프업 힌트: 눌러서 오늘/선택일 목록 열기
    var _hint = document.getElementById('calSwipeHint');
    if (_hint) _hint.addEventListener('click', function () {
      var t = _selDate || _today;
      _selDate = t;
      try { renderDayDetail(t); } catch (e) {}
      var d = document.getElementById('calDetail');
      if (d) setTimeout(function () { d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
    });

    /* ★ 날짜 클릭: 그리드에 한 번만 등록 */
    document.getElementById('calGrid').addEventListener('click', function (e) {
      if (Date.now() - (window._calSwipeTs || 0) < 400) return;  // ★ 스와이프 직후 클릭 무시
      /* ⭐ 2026-08-22 펼친 목록에서 '일정 줄'을 누르면 열기/상세 메뉴.
         왼쪽 날짜 기둥과 빈 곳은 아래로 흘러 예전처럼 '접힘 + 그날 목록'이 된다. */
      var _agRow = e.target && e.target.closest && e.target.closest('.cal-ag-row');
      if (_agRow) {
        _openAgendaMenu(_agRow.getAttribute('data-date'), parseInt(_agRow.getAttribute('data-ai'), 10));
        return;
      }
      var cell = e.target;
      while (cell && cell !== this) {
        if (cell.dataset && (cell.dataset.date || cell.dataset.otherdate)) break;
        cell = cell.parentNode;
      }
      if (!cell || !cell.dataset) return;

      // ★ 이전/다음달(흐린) 칸 클릭 → 그 달로 이동하면서 그 날짜를 열어준다
      if (cell.dataset.otherdate) {
        var od = cell.dataset.otherdate;                       // 'YYYY-MM-DD'
        var oy = +od.slice(0, 4), om = +od.slice(5, 7) - 1;
        var diff = (oy - _calYear) * 12 + (om - _calMonth);    // 현재 달 기준 몇 달 차이인지
        if (diff !== 0) _navMonth(diff, od);
        return;
      }
      if (!cell.dataset.date) return;

      var date = cell.dataset.date;
      var grid = this;
      /* ★ 2026-08-16 확장(전체화면) 상태에서 날짜를 누르면
         → 달력을 접으면서 그 날짜 목록을 연다 (선택 해제 토글보다 우선) */
      if (_expanded) { _goDayFromExpanded(date); return; }
      if (_selDate === date) {
        _selDate = null;
        grid.querySelectorAll('.cal-sel').forEach(function (c) { c.classList.remove('cal-sel'); });
        hideDayDetail();
        return;
      }
      grid.querySelectorAll('.cal-sel').forEach(function (c) { c.classList.remove('cal-sel'); });
      cell.classList.add('cal-sel');
      _selDate = date;
      renderDayDetail(date, false);  // 날짜 클릭 시 화면 자동 스크롤 안 함 (요청)
    });

    document.getElementById('calPrev').addEventListener('click', function () { _navMonth(-1); });
    document.getElementById('calNext').addEventListener('click', function () { _navMonth(1); });
    var _tdBtn = document.getElementById('calToday');
    if (_tdBtn) _tdBtn.addEventListener('click', _goToday);
    var _vwBtn = document.getElementById('calViewToggle');
    if (_vwBtn) _vwBtn.addEventListener('click', _switchExpandView);
    _syncViewBtn();
    var _grab = document.getElementById('calGrab');
    if (_grab) _grab.addEventListener('click', function () {
      if (Date.now() - (window._calSwipeTs || 0) < 400) return;   // 방금 끌었으면 touchend 가 이미 처리했다
      if (!_expanded) _setExpanded(true, true);
    });

    /* ★ 년월 라벨 클릭 → 특정 년/월로 바로 이동하는 선택창 */
    var _navLabel = document.getElementById('calNavLabel');
    if (_navLabel) {
      _navLabel.classList.add('cal-nav-label-tap');
      _navLabel.addEventListener('click', openMonthPicker);
    }

    /* ★ 달력 스와이프 — 한 핸들러에서 방향을 판별한다.
         · 좌우 : 손가락을 따라 드래그, 놓으면 이전/다음달
         · 아래로 당김 : 달력이 늘어나며 전체 화면 (상단 헤더·하단 탭바는 그대로 둔다)
         · 위로 밀기   : 다시 접힘
       ★ 세로를 따로 addEventListener 로 붙이면 방향 판별이 두 군데로 갈라져 서로 잡아먹는다.
         반드시 여기 한 곳에서만 정한다. */
    (function () {
      var grid = document.getElementById('calGrid');
      var body = document.getElementById('customerBody');
      if (!grid) return;
      var sx = 0, sy = 0, st = 0, mode = 0;   // 0대기 1판별중 2가로드래그 3취소(세로스크롤) 4세로(확장)드래그 5접기드래그
      var vBase = 0, vLo = 0, vHi = 0;        // 세로 드래그: 시작 높이 / 접힘 높이 / 확장 높이
      var v5Base = 0, v5Lo = 0;               // 접기 드래그(mode 5): 시작 높이 / 접힘 높이
      var startedAtBottom = false;            // 터치를 시작할 때 목록이 이미 바닥이었나(접기 판정용)

      /* ★ 2026-08-24 (사용자 요청) 세로 목록에서 마지막 날짜까지 내린 뒤 **한 번 더 위로** → 달력으로 접기.
           ⚠️ 2026-08-22 에 없앤 '위로 밀어 접기'와 무엇이 다른지 반드시 기억할 것 —
             그때 실패한 원인은 방향 판별 12px 동안 브라우저가 먼저 목록을 스크롤해
             '맨 위인가' 판정이 무너진 것이었다. 여기서는 조건을 **바닥**으로 잡는다.
             바닥에서는 위로 밀어도 더 갈 곳이 없어 scrollTop 이 그대로라 판정이 안 무너진다.
           ⚠️ 그리고 '손을 댈 때 이미 바닥'일 때만 인정한다.
             목록을 죽 내리다가 바닥에 닿는 **같은 손짓**으로 접히면 마지막 일정을 읽을 수가 없다.
             손을 뗐다가 다시 미는 '의도적인 한 번 더'만 접기로 본다.
           ⚠️ .cal-agenda 는 자기 자신이 스크롤 컨테이너다(styles.css: overflow-y:auto).
             #customerBody 가 아니라 grid 의 scrollTop 을 봐야 한다 — 여기서 대상을 헷갈리면 또 안 먹는다. */
      function _agendaAtBottom() {
        if (!_expanded) return false;
        /* ★ 2026-08-27 격자 보기('달력 키우기')는 **자기 스크롤이 없다** — 화면에 딱 맞춰 그린다.
             그래서 볼 '바닥'이 없고, 위로 밀면 곧바로 접기로 본다.
             목록 보기에서 바닥 조건이 필요했던 이유(스크롤과의 경합)는 아래 주석 참고. */
        if (!grid.classList.contains('cal-agenda')) return true;
        /* 여유 4px — 글자 배율(zoom)이 걸리면 소수점이 남아 정확히 안 맞을 수 있다.
             빡빡하게 잡으면 '조건이 영영 참이 안 돼 조용히 안 먹는' 08-22 실패를 되풀이한다. */
        return (grid.scrollTop + grid.clientHeight) >= (grid.scrollHeight - 4);
      }
      // ★ 2026-08-21 W()는 요소 좌표계 폭. dx(화면 px)와 비교하려면 배율을 곱해 화면 폭으로 맞춘다
      function W() { return (grid.offsetWidth || 320) * _zoomFactor(grid); }
      function snapBack() {
        grid.style.transition = 'transform .18s ease-out, opacity .18s ease-out';
        grid.style.transform = 'none';
        grid.style.opacity = '1';
      }
      function onStart(e) {
        if (!e.touches || e.touches.length !== 1) { mode = 3; return; }
        sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now();
        startedAtBottom = _agendaAtBottom();   // ★ 2026-08-24 접기 판정은 '손댈 때 이미 바닥'이어야 한다
        mode = 1;
      }
      function onMove(e) {
        if (mode === 0 || mode === 3) return;
        var t = e.touches && e.touches[0];
        if (!t) return;
        var dx = t.clientX - sx, dy = t.clientY - sy;
        if (mode === 1) {
          // 방향 판별: 가로가 확실하면 월 이동, 세로가 먼저 크면 확장/접힘 또는 스크롤에 양보
          if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.3) mode = 2;
          else if (Math.abs(dy) > 12) {
            // 아래로 당겨 확장은 '맨 위까지 올라와 있을 때'만 — 아니면 평소 스크롤을 뺏는다
            var atTop = !body || body.scrollTop <= 0;
            var wantExpand   = (dy > 0) && !_expanded && atTop;
            // ★ 2026-08-24 목록 바닥에서 위로 밀기 → 달력으로 되돌아가기
            if ((dy < 0) && _expanded && startedAtBottom) {
              mode = 5;
              /* ★ 2026-08-24 손가락을 따라 '계속' 접히게 하려면 시작/끝 높이를 여기서 잡아 둔다.
                 v5Lo = 접힘 격자 높이 → 손가락이 그만큼 올라가면 화면이 접힌 모습에 정확히 도달한다. */
              v5Base = grid.offsetHeight;
              v5Lo   = Math.min(v5Base, _naturalHeight(grid));
              if (e.cancelable) e.preventDefault();
              return;
            }
            /* ⭐ 2026-08-22 '위로 밀어 접기'는 없앴다 (사용자: "되돌아가는 게 잘 안 된다").
               확장이 세로 목록이 되면서 '위로 밀기'가 두 뜻을 갖게 됐고, 둘은 양립할 수 없다:
                 · 방향을 판별하는 12px 동안은 아직 preventDefault 전이라 브라우저가 먼저 목록을
                   스크롤해 버린다 → scrollTop>0 → 접기 판정이 거의 항상 실패했다(목록이 긴 달은 100%).
                 · 그렇다고 touchstart 시점 scrollTop 으로 고치면, 이번엔 목록 맨 위에서
                   위로 밀 때마다 달력이 접혀 목록을 읽을 수가 없다.
               → 위로 밀기는 스크롤에 온전히 돌려주고, 되돌아가기는 손이 닿는 자리로 옮겼다:
                 ▲ 버튼(＋ 자리, _syncFab) · 날짜 탭 · 하드웨어 뒤로가기 세 가지. */
            if (!wantExpand) { mode = 3; return; }
            vBase = grid.offsetHeight;
            vLo   = vBase;
            vHi   = _expandedHeight();
            if (vHi - vLo < 40) { mode = 3; return; }   // 늘릴 여지가 없으면 그냥 둔다
            mode = 4;
          } else return;
        }
        if (mode === 2) {
          if (e.cancelable) e.preventDefault();  // 가로 드래그 중엔 세로 스크롤 차단
          grid.style.transition = 'none';
          // translateX 도 요소 좌표계 → 배율로 환산(안 하면 배율에서 손가락보다 앞서 나간다)
          grid.style.transform = 'translateX(' + (dx / _zoomFactor(grid)) + 'px)';
          grid.style.opacity = String(Math.max(0.35, 1 - Math.abs(dx) / W()));
        } else if (mode === 4) {
          if (e.cancelable) e.preventDefault();  // 세로 드래그 중엔 목록 스크롤 차단
          // ★ 2026-08-21 dy 는 화면 px, vBase/height 는 요소 좌표계 → 배율로 환산해야 손가락과 같이 움직인다
          var h = vBase + dy / _zoomFactor(grid);
          if (h < vLo) h = vLo; else if (h > vHi) h = vHi;
          grid.style.transition   = 'none';
          grid.style.gridAutoRows = '1fr';       // 5줄/6줄 상관없이 남은 높이를 나눠 갖게
          grid.style.height       = h + 'px';
        } else if (mode === 5) {
          if (e.cancelable) e.preventDefault();  // 접기 판정 중엔 목록 스크롤을 잡아 둔다
          /* ⭐ 2026-08-24 2차 (사용자: "조금 올라가다 멈추지 말고, 계속 올라가면서 점점 더 흐려지게")
             1차에서는 transform 으로 최대 60px 만 따라 올렸다가 멈췄다 — 손가락은 계속 가는데
             화면이 멈추니 오히려 더 어색했다. 이제 **펼치기 드래그(mode 4)의 정확한 반대**로,
             달력 높이를 손가락만큼 줄이면서 같이 흐려진다. 접힘 높이(v5Lo)에 닿으면 이미 접힌
             모습·거의 투명 상태라, 손을 떼면 그 자리에서 격자로 갈아 끼우기만 하면 된다.
             ⚠️ transform 으로 계속 올리는 방법은 못 쓴다 — #calGrid 가 통째로 올라가 위쪽
                년월 네비 줄을 덮어 버린다. 높이를 줄이는 쪽은 레이아웃 안에 머문다. */
          var z5 = _zoomFactor(grid) || 1;
          var h5 = v5Base + dy / z5;             // dy < 0 → 줄어든다
          if (h5 < v5Lo) h5 = v5Lo;
          var prog5 = (v5Base - v5Lo) > 0 ? (v5Base - h5) / (v5Base - v5Lo) : 0;
          grid.style.transition = 'none';
          grid.style.height     = h5 + 'px';
          grid.style.opacity    = String(Math.max(0.08, 1 - prog5 * 0.92));
        }
      }
      function onEnd(e) {
        var was = mode;
        mode = 0;
        if (was !== 2 && was !== 4 && was !== 5) return;
        window._calSwipeTs = Date.now();  // 드래그 직후 날짜 클릭 오작동 방지
        var t = e.changedTouches && e.changedTouches[0];
        if (was === 2) {
          if (!t) { snapBack(); return; }
          var dx = t.clientX - sx;
          var fast = (Date.now() - st) < 300 && Math.abs(dx) > 40;  // 짧고 빠르게 튕기기
          if (Math.abs(dx) > W() * 0.28 || fast) _navMonth(dx < 0 ? 1 : -1);
          else snapBack();
          return;
        }
        /* ★ 2026-08-24 목록 바닥에서 위로 밀어 접기 — 충분히 밀었거나 짧게 튕겼을 때만.
             문턱을 낮게 잡으면 마지막 줄을 보려고 살짝 미는 것까지 접혀 버린다. */
        if (was === 5) {
          var dy5 = t ? (t.clientY - sy) : 0;
          var flick5 = (Date.now() - st) < 300 && dy5 < -40;
          if (dy5 < -55 || flick5) { _setExpanded(false, true); return; }
          /* ★ 2026-08-24 문턱을 못 넘었으면 줄어든 높이와 흐려짐을 함께 되돌린다.
             (snapBack() 은 좌우 스와이프용이라 높이를 모른다 — 여기서 따로 되돌려야 한다) */
          grid.style.transition = 'height .18s ease-out, opacity .18s ease-out';
          grid.style.opacity    = '1';
          grid.style.height     = (v5Base || _expandedHeight()) + 'px';
          return;
        }
        // 세로: 놓은 위치가 어느 쪽에 가까운지로 확장/접힘 결정 (짧고 빠른 튕김도 인정)
        var dy2 = t ? (t.clientY - sy) : 0;
        var h2  = Math.min(vHi, Math.max(vLo, vBase + dy2 / _zoomFactor(grid)));
        var prog = (vHi - vLo) ? (h2 - vLo) / (vHi - vLo) : 0;
        var flick = (Date.now() - st) < 300 && Math.abs(dy2) > 40;
        var on = flick ? (dy2 > 0) : (prog > 0.4);
        _setExpanded(on, true);
      }
      function onCancel() {
        if (mode === 2) snapBack();
        if (mode === 4) _setExpanded(_expanded, true);
        /* ★ 2026-08-31 수정: 접기 드래그(mode 5) 도중 touchcancel(전화 수신,
           OS 뒤로가기 제스처, 알림창 당김 등)이 발생하면 grid 가 줄어들던
           중간 높이·중간 투명도에 transition:none 상태로 멈춰버려
           "펼침 화면이 위쪽 절반만 보이거나 펼쳐지다 만 모습"으로 고정되는
           버그가 있었다. onEnd 의 '문턱을 못 넘었을 때' 복구와 같은 방식으로
           펼친 높이/투명도를 되돌린다. */
        if (mode === 5) {
          grid.style.transition = 'height .18s ease-out, opacity .18s ease-out';
          grid.style.opacity    = '1';
          grid.style.height     = (v5Base || _expandedHeight()) + 'px';
        }
        mode = 0;
      }

      /* ⭐ 2026-08-22 (사용자 지적) — "당기라고 그려 놨으면 그걸 당기는 게 사람 마음인데,
           정작 당겨야 하는 건 달력이라 손잡이를 끌면 아무 일도 안 났다."
         → 손잡이(.cal-grab)에도 **같은 핸들러 함수**를 건다. 대상만 둘이고 판별 코드는 하나다.
         ⚠️ 절대 손잡이용 핸들러를 따로 쓰지 말 것 — 방향 판별이 두 군데로 갈라지면 서로 잡아먹는다
            (이 파일 위쪽 주석 '반드시 여기 한 곳에서만 정한다'와 같은 이유).
         손잡이는 격자 바로 아래라, 격자가 늘어나면 손잡이도 같이 내려가 손가락을 따라온다. */
      var _dragTargets = [grid];
      var _grabEl = document.getElementById('calGrab');
      if (_grabEl) _dragTargets.push(_grabEl);
      _dragTargets.forEach(function (el) {
        el.addEventListener('touchstart',  onStart,  { passive: true });
        el.addEventListener('touchmove',   onMove,   { passive: false });
        el.addEventListener('touchend',    onEnd,    { passive: true });
        el.addEventListener('touchcancel', onCancel, { passive: true });
      });
    })();

    /* ★ 하단 상세목록 좌우 스와이프 → 이전/다음 날짜로 이동 */
    (function () {
      var panel = document.getElementById('calDetail');
      if (!panel) return;
      var sx = 0, sy = 0, st = 0, mode = 0;
      function W() { return panel.offsetWidth || 320; }
      function snapBack() {
        panel.style.transition = 'transform .18s ease-out, opacity .18s ease-out';
        panel.style.transform = 'none';
        panel.style.opacity = '1';
      }
      // 스와이프 직후 카드 버튼 클릭 오작동 차단 (캡처 단계)
      panel.addEventListener('click', function (e) {
        if (Date.now() - (window._calSwipeTs || 0) < 400) { e.stopPropagation(); e.preventDefault(); }
      }, true);
      panel.addEventListener('touchstart', function (e) {
        if (!e.touches || e.touches.length !== 1) { mode = 3; return; }
        sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now();
        mode = 1;
      }, { passive: true });
      panel.addEventListener('touchmove', function (e) {
        if (mode === 0 || mode === 3) return;
        var t = e.touches && e.touches[0];
        if (!t) return;
        var dx = t.clientX - sx, dy = t.clientY - sy;
        if (mode === 1) {
          if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.4) mode = 2;
          else if (Math.abs(dy) > 12) { mode = 3; return; }
          else return;
        }
        if (mode === 2) {
          if (e.cancelable) e.preventDefault();
          panel.style.transition = 'none';
          panel.style.transform = 'translateX(' + dx + 'px)';
          panel.style.opacity = String(Math.max(0.4, 1 - Math.abs(dx) / W()));
        }
      }, { passive: false });
      panel.addEventListener('touchend', function (e) {
        var wasDrag = (mode === 2);
        mode = 0;
        if (!wasDrag) return;
        window._calSwipeTs = Date.now();
        var t = e.changedTouches && e.changedTouches[0];
        if (!t) { snapBack(); return; }
        var dx = t.clientX - sx;
        var fast = (Date.now() - st) < 300 && Math.abs(dx) > 40;
        if (Math.abs(dx) > W() * 0.25 || fast) {
          var dir = dx < 0 ? 1 : -1;
          panel.style.transition = 'transform .12s ease-in, opacity .12s ease-in';
          panel.style.transform = 'translateX(' + (dx < 0 ? '-60%' : '60%') + ')';
          panel.style.opacity = '0';
          setTimeout(function () {
            _navDay(dir);
            panel.style.transition = 'none';
            panel.style.transform = 'translateX(' + (dx < 0 ? '60%' : '-60%') + ')';
            panel.style.opacity = '0';
            requestAnimationFrame(function () {
              requestAnimationFrame(function () {
                panel.style.transition = 'transform .2s ease-out, opacity .2s ease-out';
                panel.style.transform = 'none';
                panel.style.opacity = '1';
              });
            });
          }, 120);
        } else snapBack();
      }, { passive: true });
      panel.addEventListener('touchcancel', function () {
        if (mode === 2) snapBack();
        mode = 0;
      }, { passive: true });
    })();
  }

  /* ★ 달 이동 공통 (버튼/스와이프에서 사용) — 페이지 넘기듯 슬라이드 전환 */
  function _navMonth(dir, selDate) {
    _calMonth += dir;
    if (_calMonth < 0) { _calMonth = 11; _calYear--; }
    if (_calMonth > 11) { _calMonth = 0; _calYear++; }
    // ★ selDate가 주어지면(이전/다음달 칸 클릭) 이동 후 그 날짜를 선택 상태로 둔다.
    //   renderCalendarGrid가 _selDate로 cal-sel을 칠하고,
    //   loadCalendarData 끝에서 renderDayDetail(_selDate)가 아래 상세를 채운다.
    _selDate = selDate || null;
    _dateMap = {}; _calItems = null;   // ★ 이전 달 점 즉시 제거 → 달력 뼈대만 남김
    var lb = document.getElementById('calNavLabel');
    if (lb) lb.textContent = _calYear + '년 ' + (_calMonth + 1) + '월';
    // 1) 현재 달력이 민 방향으로 밀려 나감
    var outDone = new Promise(function (res) {
      try {
        var g = document.getElementById('calGrid');
        if (!g) { res(); return; }
        g.style.transition = 'transform .15s ease-in, opacity .15s ease-in';
        g.style.transform = 'translateX(' + (dir > 0 ? '-75%' : '75%') + ')';
        g.style.opacity = '0';
        setTimeout(res, 150);
      } catch (e) { res(); }
    });
    // 2) 나가는 애니메이션이 끝나면 → 새 달 '뼈대'를 즉시 그려(점 없이) 반대편에서 들여옴
    //    일정(점)은 loadCalendarData 가 끝나는 대로 채워짐 → 달력은 끊기지 않음
    outDone.then(function () {
      try {
        renderCalendarGrid();  // ★ 새 달 날짜 칸 즉시 표시 (dateMap 비어 있어 점은 아직 없음)
        var g2 = document.getElementById('calGrid');
        if (!g2) return;
        g2.style.transition = 'none';
        g2.style.transform = 'translateX(' + (dir > 0 ? '75%' : '-75%') + ')';
        g2.style.opacity = '0';
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            g2.style.transition = 'transform .2s ease-out, opacity .2s ease-out';
            g2.style.transform = 'none';
            g2.style.opacity = '1';
          });
        });
      } catch (e) {}
    });
    // 3) 데이터는 병렬 로드 → 완료되면 점이 채워짐
    loadCalendarData();
    hideDayDetail();
  }

  /* ★ 날짜 이동 (하단 목록 좌우 스와이프) — 이전/다음 날로 이동 */
  function _navDay(dir) {
    var base = _selDate || _today;
    var p = base.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    d.setDate(d.getDate() + dir);
    var y = d.getFullYear(), mo = d.getMonth();
    var ds = y + '-' + _pad(mo + 1) + '-' + _pad(d.getDate());
    var monthChanged = (y !== _calYear || mo !== _calMonth);
    _selDate = ds;
    window._calSelectedDate = ds;
    window._calSwipeTs = Date.now();
    if (monthChanged) {
      _calYear = y; _calMonth = mo;
      var lb = document.getElementById('calNavLabel');
      if (lb) lb.textContent = _calYear + '년 ' + (_calMonth + 1) + '월';
      _dateMap = {}; _calItems = null;
      renderCalendarGrid();
      loadCalendarData();
    }
    var grid = document.getElementById('calGrid');
    if (grid) {
      grid.querySelectorAll('.cal-sel').forEach(function (c) { c.classList.remove('cal-sel'); });
      var cell = grid.querySelector('[data-date="' + ds + '"]');
      if (cell) cell.classList.add('cal-sel');
    }
    renderDayDetail(ds, false);
  }

  /* ══════════════════════════════════════════
     년월 선택 피커 (라벨 클릭 시)
  ══════════════════════════════════════════ */
  function openMonthPicker() {
    var MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
    var pickYear = _calYear;
    var now = new Date();
    var nowY = now.getFullYear(), nowM = now.getMonth();

    var overlay = document.createElement('div');
    overlay.className = 'cal-mp-overlay';

    function draw() {
      var grid = '';
      for (var i = 0; i < 12; i++) {
        var cls = 'cal-mp-month';
        if (pickYear === _calYear && i === _calMonth) cls += ' active';
        else if (pickYear === nowY && i === nowM)     cls += ' cur';
        grid += '<button class="' + cls + '" data-m="' + i + '">' + MONTHS[i] + '</button>';
      }
      overlay.innerHTML =
        '<div class="cal-mp-box">' +
          '<div class="cal-mp-yr">' +
            '<button class="cal-mp-yr-btn" data-act="py">&#8249;</button>' +
            '<span class="cal-mp-yr-lbl">' + pickYear + '년</span>' +
            '<button class="cal-mp-yr-btn" data-act="ny">&#8250;</button>' +
          '</div>' +
          '<div class="cal-mp-grid">' + grid + '</div>' +
          '<button class="btn b-ghost cal-mp-close">닫기</button>' +
        '</div>';
    }
    draw();
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) {
      var t = e.target;
      if (t === overlay || (t.classList && t.classList.contains('cal-mp-close'))) { overlay.remove(); return; }
      var act = t.getAttribute && t.getAttribute('data-act');
      if (act === 'py') { pickYear--; draw(); return; }
      if (act === 'ny') { pickYear++; draw(); return; }
      var mEl = t.closest ? t.closest('.cal-mp-month') : null;
      if (mEl) {
        _calYear  = pickYear;
        _calMonth = parseInt(mEl.getAttribute('data-m'), 10);
        _selDate  = null;
        var lbl = document.getElementById('calNavLabel');
        if (lbl) lbl.textContent = _calYear + '년 ' + (_calMonth + 1) + '월';
        overlay.remove();
        hideDayDetail();
        _dateMap = {}; _calItems = null;
        renderCalendarGrid();   // ★ 달력 뼈대 먼저
        loadCalendarData();
      }
    });
  }

  function setCalLoading(on) {
    // ★ 달력(그리드)은 지우지 않고, 우측 상단에 작은 로딩 표시만 → 달력은 계속 보임
    var wrap = document.getElementById('calWrap');
    if (!wrap) return;
    var tag = document.getElementById('calLoadingTag');
    if (on) {
      if (!tag) {
        if (!wrap.style.position) wrap.style.position = 'relative';
        tag = document.createElement('span');
        tag.id = 'calLoadingTag';
        tag.textContent = '⏳';
        tag.style.cssText = 'position:absolute;top:10px;right:12px;font-size:14px;opacity:.75;z-index:5;pointer-events:none;';
        wrap.appendChild(tag);
      }
      tag.style.display = '';
    } else if (tag) {
      tag.style.display = 'none';
    }
  }

  /* ══════════════════════════════════════════
     그리드 렌더 (삼성 스타일 도트)
     ★ 클릭 핸들러 추가 없음 (Shell에서 등록)
  ══════════════════════════════════════════ */
  /* ★ 한국 공휴일 (음력 명절·대체공휴일 포함, 2024~2028 내장)
     ※ 2029년 이후는 아래 표에 연도별로 추가 필요 (양력 고정 공휴일은 자동 표시) */
  var KR_HOLIDAYS = {
    // 2024
    '2024-01-01':'신정','2024-02-09':'설날연휴','2024-02-10':'설날','2024-02-11':'설날연휴','2024-02-12':'대체공휴일',
    '2024-03-01':'삼일절','2024-04-10':'국회의원선거','2024-05-05':'어린이날','2024-05-06':'대체공휴일','2024-05-15':'부처님오신날',
    '2024-06-06':'현충일','2024-08-15':'광복절','2024-09-16':'추석연휴','2024-09-17':'추석','2024-09-18':'추석연휴',
    '2024-10-03':'개천절','2024-10-09':'한글날','2024-12-25':'성탄절',
    // 2025
    '2025-01-01':'신정','2025-01-27':'임시공휴일','2025-01-28':'설날연휴','2025-01-29':'설날','2025-01-30':'설날연휴',
    '2025-03-01':'삼일절','2025-03-03':'대체공휴일','2025-05-05':'어린이날·부처님오신날','2025-05-06':'대체공휴일',
    '2025-06-03':'대통령선거','2025-06-06':'현충일','2025-08-15':'광복절','2025-10-03':'개천절',
    '2025-10-05':'추석연휴','2025-10-06':'추석','2025-10-07':'추석연휴','2025-10-08':'대체공휴일','2025-10-09':'한글날','2025-12-25':'성탄절',
    // 2026
    '2026-01-01':'신정','2026-02-16':'설날연휴','2026-02-17':'설날','2026-02-18':'설날연휴',
    '2026-03-01':'삼일절','2026-03-02':'대체공휴일','2026-05-05':'어린이날','2026-05-24':'부처님오신날','2026-05-25':'대체공휴일',
    '2026-06-03':'지방선거','2026-06-06':'현충일','2026-08-15':'광복절','2026-08-17':'대체공휴일',
    '2026-09-24':'추석연휴','2026-09-25':'추석','2026-09-26':'추석연휴','2026-10-03':'개천절','2026-10-05':'대체공휴일','2026-10-09':'한글날','2026-12-25':'성탄절',
    // 2027
    '2027-01-01':'신정','2027-02-06':'설날연휴','2027-02-07':'설날','2027-02-08':'설날연휴','2027-02-09':'대체공휴일',
    '2027-03-01':'삼일절','2027-05-05':'어린이날','2027-05-13':'부처님오신날','2027-06-06':'현충일',
    '2027-08-15':'광복절','2027-08-16':'대체공휴일','2027-09-14':'추석연휴','2027-09-15':'추석','2027-09-16':'추석연휴',
    '2027-10-03':'개천절','2027-10-04':'대체공휴일','2027-10-09':'한글날','2027-10-11':'대체공휴일','2027-12-25':'성탄절','2027-12-27':'대체공휴일',
    // 2028
    '2028-01-01':'신정','2028-01-26':'설날연휴','2028-01-27':'설날','2028-01-28':'설날연휴',
    '2028-03-01':'삼일절','2028-05-02':'부처님오신날','2028-05-05':'어린이날','2028-06-06':'현충일','2028-08-15':'광복절',
    '2028-10-02':'추석연휴','2028-10-03':'추석·개천절','2028-10-04':'추석연휴','2028-10-05':'대체공휴일','2028-10-09':'한글날','2028-12-25':'성탄절'
  };
  var KR_FIXED = { '01-01':'신정','03-01':'삼일절','05-05':'어린이날','06-06':'현충일','08-15':'광복절','10-03':'개천절','10-09':'한글날','12-25':'성탄절' };
  function _holidayOf(dateStr) {
    if (KR_HOLIDAYS[dateStr]) return KR_HOLIDAYS[dateStr];
    // 표에 없는 연도(2029+)는 양력 고정 공휴일만
    var y = dateStr.slice(0, 4);
    // 2024~2028는 표가 진실 공급원 (표에 없으면 공휴일 아님)
    if (y >= '2024' && y <= '2028') return '';
    return KR_FIXED[dateStr.slice(5)] || '';
  }

  /* ★ 2026-08-08: 인접 달(흐린 칸)에 공유 일정도 표시
       _boundaryMap 은 로컬 폴더 스캔(scanFoldersDirect) 결과만 담아서 '내 작업'만 점이 찍혔다.
       공유 일정은 CloudShare 가 메모리로 들고 있으므로, 인접 달 것만 따로 모아 합쳐준다.
       (메모리 필터라 비용이 거의 없다. 렌더할 때마다 다시 만들어 최신 상태를 반영한다) */
  var _otherSharedMap = {};
  function _buildOtherSharedMap() {
    _otherSharedMap = {};
    try {
      var _hasCS = !!(window.CloudShare && CloudShare.getItemsForMonth);
      var _hasRem = !!(window.Reminders && Reminders.forMonth);
      if (!_hasCS && !_hasRem) return;
      var base = new Date(_calYear, _calMonth, 1);
      [-1, 1].forEach(function (off) {
        var d = new Date(base.getFullYear(), base.getMonth() + off, 1);
        var mo = d.getFullYear() + '-' + _pad(d.getMonth() + 1);
        var arr = _hasCS ? (CloudShare.getItemsForMonth(mo) || []) : [];
        // 리마인더도 함께 (인접 달 흐린 칸에서도 보이게)
        try {
          if (window.Reminders && Reminders.forMonth) {
            (Reminders.forMonth(mo) || []).forEach(function (r) {
              arr = arr.concat([{ type: 'reminder', sortDate: r.date + 'T' + (r.time || '00:00'), data: r }]);
            });
          }
        } catch (e2) {}
        arr.forEach(function (it) {
          var ds = (it && it.data && it.data.date) || '';
          if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) return;
          (_otherSharedMap[ds] = _otherSharedMap[ds] || []).push(it);
        });
      });
    } catch (e) { _otherSharedMap = {}; }
  }

  // ── 흐린(다른 달) 칸에 표시할 점: 현재 _dateMap 또는 경계맵(_boundaryMap) + 공유 일정 ──
  function _otherMonthItems(dateStr) {
    var items = _dateMap[dateStr];
    if ((!items || !items.length) && _boundaryKey === (_calYear + '-' + _pad(_calMonth + 1))) {
      items = _boundaryMap[dateStr];
    }
    var shared = _otherSharedMap[dateStr];
    if (shared && shared.length) items = (items || []).concat(shared);
    return items || [];
  }
  function _otherMonthCellHtml(dateStr, dayNum) {
    // ★ 이 칸(보조 표시) 렌더가 실패해도 달력 전체(내 작업 포함)가 깨지지 않도록 전부 감싼다
    var dotsHtml = '<div class="cal-dots"></div>';
    try {
      var items = _otherMonthItems(dateStr);
      if (items && items.length) {
        if (_expanded) {
          dotsHtml = _iconChipsHtml(items);          // ★ 확장 상태에선 흐린 칸도 아이콘으로
        } else {
        var inner = '';
        var shown = Math.min(items.length, 4);
        for (var j = 0; j < shown; j++) {
          var it = items[j];
          var _dc = (it.type === 'reminder') ? 'rem' : (it.type === 'shared') ? 'shared' : (it.type === 'customer') ? 'cust' : (_isWorkDone(it.data) ? 'done' : 'pending');
          var _dcol = (it.type === 'customer' || it.type === 'reminder') ? '' : _workColorOf(it);
          inner += '<span class="cal-dot cal-dot-' + _dc + '"' + (_dcol ? ' style="background:' + _dcol + ';"' : '') + '></span>';
        }
        if (items.length > 4) inner += '<span class="cal-dot cal-dot-more"></span>';
        dotsHtml = '<div class="cal-dots">' + inner + '</div>';
        }
      }
    } catch (e) { dotsHtml = '<div class="cal-dots"></div>'; }
    // cal-other-month 은 CSS 로 opacity:.32 → 점도 자동으로 흐리게 표시됨
    // ★ data-otherdate: 클릭하면 그 달로 이동해서 해당 날짜를 열어준다 (일반 칸의 data-date와 구분)
    return '<div class="cal-cell cal-other-month" data-otherdate="' + dateStr + '"><span class="cal-day-num">' + dayNum + '</span>' + dotsHtml + '</div>';
  }

  // ── 인접 달(이전/다음) 데이터를 조용히 로드해 경계 칸 점을 채움 ──
  //   ★ 절대 규칙: 메인 _monthCache / _calItems / _dateMap 을 건드리지 않는다.
  //     (예전 버그: 여기서 인접 달의 '빈 스캔' 결과를 _monthCache 에 써버려,
  //      나중에 그 달을 열 때 내 작업이 사라지고 공유작업만 남았음)
  async function loadBoundaryMonths() {
    if (_boundaryBusy) return;
    var key = _calYear + '-' + _pad(_calMonth + 1);
    if (_boundaryKey === key) return;   // 이미 이 달 기준으로 로드됨
    _boundaryBusy = true;
    try {
      if (typeof photoFolderHandle === 'undefined' || !photoFolderHandle) return;
      var months = [];
      var pd = new Date(_calYear, _calMonth - 1, 1);
      months.push(pd.getFullYear() + '-' + _pad(pd.getMonth() + 1));
      var nd = new Date(_calYear, _calMonth + 1, 1);
      months.push(nd.getFullYear() + '-' + _pad(nd.getMonth() + 1));
      var map = {};
      for (var mi = 0; mi < months.length; mi++) {
        var adjM = months[mi];
        // 읽기 전용: 경계 전용 캐시 → (메인이 이미 제대로 로드해둔) _monthCache 순으로 재사용, 없으면 스캔
        var arr = _boundaryScanCache[adjM];
        if (!arr) arr = _monthCache[adjM];
        if (!arr) arr = await scanFoldersDirect(adjM);
        if (!Array.isArray(arr) || !arr.length) continue;   // null/빈 결과는 캐시도 안 함(스테일 방지)
        _boundaryScanCache[adjM] = arr;   // ★ 전용 캐시에만 저장 (메인 _monthCache 는 절대 안 씀)
        arr.forEach(function (it) {
          if (!it || it._fromPrevMonth) return;   // 기간작업 중복분은 제외
          var date = (it.data && it.data.date) || (it.sortDate || '').slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
          (map[date] = map[date] || []).push(it);
        });
      }
      _boundaryMap = map;
      _boundaryKey = key;
      renderCalendarGrid();   // 경계 점 반영해 다시 그림
    } catch (e) { /* 경계 점은 보조 기능 — 실패해도 무시 */ }
    finally { _boundaryBusy = false; }
  }

  function renderCalendarGrid() {
    var grid = document.getElementById('calGrid');
    if (!grid) return;
    _pfIconMemo = {};         // ★ 이번 렌더 동안만 쓰는 업종 아이콘 캐시 (localStorage 재파싱 방지)
    /* ★ 업종 스탬프가 없는 옛 작업(업종 기능 이전에 만든 것)의 폴백.
       업종이 딱 하나뿐이면 그 작업도 그 업종일 수밖에 없다 → 그 아이콘을 쓴다.
       둘 이상이면 추측하지 않는다(엉뚱한 업종으로 보이는 게 더 나쁘다). */
    _pfSoloIcon = '';
    try {
      if (window.Profiles && Profiles.list) {
        var _pl = Profiles.list();
        if (_pl && _pl.length === 1) _pfSoloIcon = Profiles.iconOf(_pl[0]) || '';
      }
    } catch (e) {}
    _buildOtherSharedMap();   // ★ 인접 달 공유 일정(흐린 칸 점) 최신화

    // ★ 진단: 전체 로드 건수 표시
    var totalLoaded = _calItems ? _calItems.length : 0;
    var dateCount   = Object.keys(_dateMap).length;
    var label = document.getElementById('calNavLabel');
    if (label) {
      var y = _calYear, m = _calMonth + 1;
      label.textContent = y + '년 ' + m + '월';
      // 작은 글씨로 로드 건수 표시
      var sub = document.getElementById('calCountSub');
      if (!sub) {
        sub = document.createElement('div');
        sub.id = 'calCountSub';
        sub.className = 'cal-nav-sub';   /* ★ 2026-08-22 '오늘' 버튼이 생겨 자리가 빠듯하다 → 이게 먼저 줄게 */
        sub.style.cssText = 'font-size:11px;color:var(--mu);margin-top:2px;';
        label.parentNode.insertBefore(sub, label.nextSibling);
      }
      sub.textContent = (_calItems === null) ? '일정 불러오는 중…' : ('전체 ' + totalLoaded + '건 · ' + dateCount + '일');
    }

    /* ⭐ 2026-08-22 확장(전체화면) = 7열 격자가 아니라 '세로 목록(아젠다)'.
       모양만 갈아 끼운다 — 요소는 계속 #calGrid 다(제스처·높이 애니메이션·날짜 클릭이 여기 붙어 있다). */
    if (_expanded && _expandView === 'list') {
      grid.classList.add('cal-agenda');
      grid.innerHTML = _agendaHtml();
      /* '오늘' 버튼으로 달을 옮겨 온 경우 — 일정이 채워진 이 시점에 스크롤한다 */
      if (_wantTodayScroll && grid.querySelector('.cal-ag-day')) {
        _wantTodayScroll = false;
        _scrollAgendaToToday();
      }
      try { renderMonthRevenue(); } catch (e) {}
      return;
    }
    grid.classList.remove('cal-agenda');

    var firstDay = new Date(_calYear, _calMonth, 1).getDay();
    var lastDate = new Date(_calYear, _calMonth + 1, 0).getDate();
    var prevLast = new Date(_calYear, _calMonth, 0).getDate();
    var html = '';

    // 이전 달 빈 칸 (저장된 작업이 있으면 흐린 점으로 표시)
    for (var i = 0; i < firstDay; i++) {
      var _pdn = prevLast - firstDay + 1 + i;
      var _pdt = new Date(_calYear, _calMonth - 1, _pdn);
      var _pds = _pdt.getFullYear() + '-' + _pad(_pdt.getMonth() + 1) + '-' + _pad(_pdt.getDate());
      html += _otherMonthCellHtml(_pds, _pdn);
    }

    // 이번 달
    for (var d = 1; d <= lastDate; d++) {
      var dateStr = _calYear + '-' + _pad(_calMonth + 1) + '-' + _pad(d);
      var items   = _dateMap[dateStr] || [];
      var cnt     = items.length;
      var dow     = (firstDay + d - 1) % 7;

      // ★ 여러 날 작업(_span)은 점 대신 이어지는 줄(바)로
      var spanItems = items.filter(function (x) { return x && x._span; });
      var dotItems  = items.filter(function (x) { return x && !x._span; });

      /* ★ 2026-08-16 확장 상태에서는 점 대신 업종 아이콘.
         기간(여러 날) 작업도 막대 대신 그날그날 아이콘으로 세운다(사용자 요청) →
         items 를 통째로 넘기고 아래에서 막대는 그리지 않는다. */
      var dotsHtml;
      if (_expanded) {
        dotsHtml = _iconChipsHtml(items);
      } else {
        dotsHtml = '<div class="cal-dots">';
        if (dotItems.length > 0) {
          var shown = Math.min(dotItems.length, 4);
          for (var j = 0; j < shown; j++) {
            var _dc = (dotItems[j].type === 'reminder') ? 'rem' : (dotItems[j].type === 'shared') ? 'shared' : (dotItems[j].type === 'customer') ? 'cust' : (_isWorkDone(dotItems[j].data) ? 'done' : 'pending');
            var _dcol = (dotItems[j].type === 'customer' || dotItems[j].type === 'reminder') ? '' : _workColorOf(dotItems[j]);  // ★ 공유작업자 색상 우선
            dotsHtml += '<span class="cal-dot cal-dot-' + _dc + '"' + (_dcol ? ' style="background:' + _dcol + ';"' : '') + '></span>';
          }
          if (dotItems.length > 4) dotsHtml += '<span class="cal-dot cal-dot-more"></span>';
        }
        dotsHtml += '</div>';
      }

      var barsHtml = '';
      if (spanItems.length && !_expanded) {
        // lane 고정: 같은 작업은 어느 날짜 칸에서든 같은 줄에 그려짐 (빈 줄은 투명 자리 유지)
        var laneMap = {};
        var topLane = 0;
        spanItems.forEach(function (sp) {
          var L = (sp._span && sp._span.lane) || 0;
          if (L > 2) L = 2;  // 최대 3줄까지 표시
          if (!laneMap[L]) { laneMap[L] = sp; if (L > topLane) topLane = L; }
        });
        barsHtml = '<div class="cal-bars">';
        for (var Li = 0; Li <= topLane; Li++) {
          var sp2 = laneMap[Li];
          if (!sp2) { barsHtml += '<div class="cal-bar cal-bar-empty"></div>'; continue; }
          var _bc = (sp2.type === 'reminder') ? 'rem'
                  : (sp2.type === 'shared') ? 'shared'
                  : (_isWorkDone(sp2.data) ? 'done' : 'pending');
          // 리마인더는 내 참고용이라 작업자 색을 입히지 않는다
          var _wcol = (sp2.type === 'reminder') ? '' : _workColorOf(sp2);  // ★ 공유작업자 색상 우선
          barsHtml += '<div class="cal-bar cal-bar-' + _bc + ' cal-bar-' + sp2._span.pos + '"' + (_wcol ? ' style="background:' + _wcol + ';"' : '') + '></div>';
        }
        barsHtml += '</div>';
      }

      var holi = _holidayOf(dateStr);

      var cls = 'cal-cell';
      if (dow === 0)              cls += ' cal-sun';
      if (dow === 6)              cls += ' cal-sat';
      if (holi)                   cls += ' cal-holiday';
      if (dateStr === _today)     cls += ' cal-today';
      if (dateStr === _selDate)   cls += ' cal-sel';
      if (cnt > 0)                cls += ' cal-has-evt';

      html += '<div class="' + cls + '" data-date="' + dateStr + '">' +
        '<span class="cal-day-num">' + d + '</span>' +
        (holi ? '<div class="cal-holi-name">' + holi + '</div>' : '') +
        dotsHtml + barsHtml + '</div>';
    }

    // 다음 달 빈 칸 (저장된 작업이 있으면 흐린 점으로 표시)
    var remain = (firstDay + lastDate) % 7;
    if (remain > 0) {
      for (var ndd = 1; ndd <= 7 - remain; ndd++) {
        var _ndt = new Date(_calYear, _calMonth + 1, ndd);
        var _nds = _ndt.getFullYear() + '-' + _pad(_ndt.getMonth() + 1) + '-' + _pad(_ndt.getDate());
        html += _otherMonthCellHtml(_nds, ndd);
      }
    }

    grid.innerHTML = html;
    /* ★ 확장 중에는 격자 높이를 잴 수 없다 → 접힘으로 그릴 때마다 자연 높이를 기억해 둔다.
       (인라인 높이가 걸려 있는 동안은 그 값이 자연 높이가 아니므로 건너뛴다) */
    try { if (!grid.style.height) _lastNaturalH = grid.offsetHeight; } catch (e) {}
    try { renderMonthRevenue(); } catch (e) {}
  }

  /* ── 가격/시간 헬퍼 ── */
  function _digits(v){ return parseInt(String(v==null?'':v).replace(/[^0-9]/g,''),10) || 0; }
  function _ovOf(w){ return (window.CloudShare && CloudShare.getOverride) ? CloudShare.getOverride(w && (w.folderName||w.workId)) : null; }
  // ★ 공유작업자 색상: 작업자 프로필 색 우선, 공유 항목은 소유자 색 폴백.
  //   색이 있으면 당일 점·기간 바 모두 이 색으로 (수행 전/후 색 규칙은 단일 작업자일 때만)
  /* 달력 점/막대 색상 결정 (2026-08-08 개정)
       규칙: · 공유를 쓰는 중(수락된 상대 1명 이상)  → '누가 한 작업인가'를 사람별 색으로 구분
             · 공유를 안 쓰는 단독 사용자             → 색을 주지 않고 기존 작업 전/후 색
                                                      (cal-dot-pending 노랑 / cal-dot-done 청록)을 그대로 쓴다
       빈 문자열('')을 돌려주면 호출부가 인라인 스타일을 안 붙이므로 자동으로 전/후 색이 적용된다. */
  function _workColorOf(it) {
    try {
      if (!window.CloudShare) return '';
      // ★ 단독 사용자는 사람별 색을 쓰지 않는다 → 작업 전/후 구분 유지
      if (!CloudShare.workerRequired || !CloudShare.workerRequired()) return '';
      // ★ 프로필이 아직 안 왔으면 칠하지 않는다(늦게 덧칠되며 깜빡이는 것 방지, 도착하면 refreshCal로 다시 그림)
      if (CloudShare.profilesReady && !CloudShare.profilesReady()) return '';
      var d = it && it.data;
      if (!d) return '';
      // 1) 작업자 이름 → uid → 색 (누가 했는지가 기준)
      var wn = d.worker || (d.session && d.session.worker) || '';
      if (wn && CloudShare.uidForName && CloudShare.colorForUid) {
        var u = CloudShare.uidForName(wn);
        if (u) return CloudShare.colorForUid(u);
      }
      // 2) 공유받은 항목인데 작업자 매칭이 안 되면 → 소유자(올린 사람) 색
      if (it.type === 'shared' && d.ownerUid && CloudShare.colorForUid) return CloudShare.colorForUid(d.ownerUid);
      // 3) 내 작업인데 작업자가 비어 있으면(닉네임 도입 전 데이터) → 내 색
      if (it.type !== 'shared' && !wn && CloudShare.colorForUid) {
        var myU = window.Cloud && Cloud.user && Cloud.user.uid;
        if (myU) return CloudShare.colorForUid(myU);
      }
      // 그 외(작업자 이름이 있는데 아는 사람이 아님) → 색 없음. 억지로 추측하지 않는다.
    } catch (e) {}
    return '';
  }

  /* ══════════════════════════════════════════
     ★ 2026-08-16 확장 모드 — 업종 아이콘
       처음엔 아이콘 뒤에 상태색 배경을 깔았는데 지저분하다는 지적(사용자)에 따라
       배경을 걷어내고 아이콘만 크게 키웠다. 상태색은 접힘 상태의 점이 계속 담당한다.
  ══════════════════════════════════════════ */
  /* 항목의 업종 아이콘 — 목록 카드의 _indIconHtml() 과 **완전히 같은 규칙**을 쓴다.
     ⚠️ 2026-08-16 버그: 캐시 키를 w.profileId / w.profileSnap 만 보고 만들었더니,
        로컬 작업은 업종이 w.session.profileId 에 들어 있어서 키가 전부 '|' 로 같아졌다
        → 맨 처음 항목의 결과가 달력 전체에 복사돼 온통 같은 아이콘(또는 빈 값)이 됐다.
        키는 반드시 Profiles.readWork() 가 실제로 읽어낸 값으로 만든다. */
  function _indIconOf(it) {
    if (!it || !it.data) return '';
    if (it.type === 'reminder') return '🔔';
    if (it.type === 'customer') return '👤';
    if (!(window.Profiles && Profiles.iconForWork)) return '';
    var w = it.data, ov = null, k = '';
    try {
      ov = _ovOf(w);
      var r = Profiles.readWork ? Profiles.readWork(w) : { id: '', snap: null };
      k = (ov ? ((ov.profileId || '') + '~' + (ov.profileName || '') + '~' + (ov.profileIcon || '')) : '') +
          '|' + (r.id || '') +
          '|' + ((r.snap && r.snap.name) || '') +
          '|' + ((r.snap && r.snap.icon) || '');
    } catch (e) { k = ''; }
    if (k && _pfIconMemo && Object.prototype.hasOwnProperty.call(_pfIconMemo, k)) return _pfIconMemo[k];
    var ic = '';
    try {
      // 상대가 방금 바꾼 업종(오버라이드)이 먼저, 없거나 못 풀면 작업 자체로 (_indIconHtml 과 동일)
      if (ov && (ov.profileId || ov.profileName || ov.profileIcon)) {
        ic = Profiles.iconForWork({ profileId: ov.profileId, profileSnap: ov.profileSnap,
                                    profileIcon: ov.profileIcon, profileName: ov.profileName }) || '';
      }
      if (!ic) ic = Profiles.iconForWork(w) || '';
    } catch (e) {}
    if (!ic) ic = _pfSoloIcon;          // 업종이 하나뿐이면 스탬프 없는 옛 작업도 그 업종이다
    if (k && _pfIconMemo) _pfIconMemo[k] = ic;
    return ic;
  }
  /* 접힘 상태 점과 똑같은 색 규칙 — 업종을 모르는 항목은 아이콘 대신 이 점으로 그린다 */
  function _dotMeta(it) {
    return {
      dc: (it.type === 'reminder') ? 'rem' : (it.type === 'shared') ? 'shared'
        : (it.type === 'customer') ? 'cust' : (_isWorkDone(it.data) ? 'done' : 'pending'),
      col: (it.type === 'customer' || it.type === 'reminder') ? '' : _workColorOf(it)
    };
  }
  function _icoInnerHtml(ic, px) {
    // 그림(svg:) 아이콘은 currentColor 를 쓰므로 칩의 color(흰색)를 따라간다
    if (window.Profiles && Profiles.isSvgIcon && Profiles.isSvgIcon(ic)) return Profiles.iconHtml(ic, px || 12);
    return _escH(ic);
  }
  /* 시간 글자색 — 작업자 색(사용자 요청 2026-08-16). 점 색 규칙과 같은 순서를 쓴다.
     단독 사용자(작업자 색 없음)는 기본 글자색으로 둔다. */
  function _timeColorOf(it) {
    if (!it) return '';
    if (it.type === 'reminder') return 'var(--mu)';
    if (it.type === 'customer') return 'var(--ac2)';
    var c = _workColorOf(it);
    if (c) return c;
    if (it.type === 'shared') return '#a855f7';
    return '';                       // 내 단독 작업 → 기본 글자색
  }
  /* 한 날짜 칸의 내용 — 한 줄에 [업종 아이콘][시작시간] 하나씩.
     ★ 2026-08-16 사용자 선택: 확장은 '날짜별 분포'를 보려는 화면이라
       아이콘만 모아 두는 것보다 '언제 몇 건'이 보이는 편이 낫다.
       칸 안쪽이 45px 뿐이라 한글 현장명은 3자에서 잘려 못 쓰고, 시간(숫자)은 여유가 있다.
     ⚠️ 업종을 못 푸는 항목은 엉뚱한 아이콘 대신 접힘과 같은 '점'을 아이콘 자리에 넣는다. */
  function _iconChipsHtml(items) {
    if (!items || !items.length) return '<div class="cal-icos"></div>';
    var n = items.length;
    var shown = (n <= 4) ? n : 3;    // 칸 높이상 4줄이 한계 → 넘치면 3줄 + '+N'
    var html = '<div class="cal-icos">';
    for (var i = 0; i < shown; i++) {
      var it = items[i];
      var ic = _indIconOf(it), icHtml;
      if (ic) icHtml = _icoInnerHtml(ic, 15);
      else {
        var m = _dotMeta(it);
        icHtml = '<i class="cal-dot cal-dot-' + m.dc + '"' +
                 (m.col ? ' style="background:' + m.col + ';"' : '') + '></i>';
      }
      var t   = _itemStart(it);
      var col = _timeColorOf(it);
      html += '<div class="cal-erow">' +
                '<span class="cal-eic">' + icHtml + '</span>' +
                (t ? '<span class="cal-etm"' + (col ? ' style="color:' + col + ';"' : '') + '>' + _escH(t) + '</span>'
                   : '<span class="cal-etm cal-enotm">–</span>') +
              '</div>';
    }
    if (n > shown) html += '<div class="cal-emore">+' + (n - shown) + '</div>';
    return html + '</div>';
  }

  /* ══════════════════════════════════════════════════════════════
     ⭐ 2026-08-22 확장(전체화면) = 세로 목록(아젠다)  — 'A안'
       왜 바꿨나: 확장도 7열 격자였는데 격자는 '화면 폭 ÷ 7' 이라 칸 안쪽이 45px 뿐이었다.
       그래서 (1) 한글 현장명을 못 넣어 시간(숫자)만 세웠고,
              (2) 설정의 글자 크기를 칸 안쪽만 역수(--fs-unzoom)로 되돌려 빼야 했다
                  — 배율을 올리면 칸 폭이 오히려 45px → 31px 로 줄어 옆 날짜를 침범하기 때문.
       세로 목록은 폭 제약이 사라진다 → 현장명·호수까지 들어가고, 글자 크기가 그대로 먹는다.
     ⚠️ 요소는 계속 #calGrid 를 쓴다. 좌우 스와이프(월 이동)·위로 밀어 접기·높이 애니메이션·
        날짜 클릭 위임이 전부 이 요소에 붙어 있어서, 새 컨테이너를 만들면 그 넷을 다시 짜야 한다.
     ⚠️ 일정이 있는 날만 세운다(8월 = 31건/19일). 빈 날까지 세우면 목록이 두 배로 길어진다.
  ══════════════════════════════════════════════════════════════ */
  function _itemTitle(it) {
    if (!it || !it.data) return '';
    var d = it.data;
    if (it.type === 'work')     { var ov = _ovOf(d); return (ov && ov.apt) || d.apt || '작업'; }
    if (it.type === 'shared')   return d.apt || '작업';
    if (it.type === 'reminder') return d.title || '리마인더';
    if (it.type === 'customer') return d.name || d.phone || '고객';
    return '';
  }
  /* 작업의 '작업대상' — 시설은 facilityCustomer, 일반은 첫 호수 고객, 상대가 고친 값(오버라이드)이 있으면 그것.
     ⚠️ 날짜 카드·검색 결과와 같은 규칙을 써야 한다. 규칙이 갈라지면 같은 작업이 화면마다 달라 보인다. */
  function _workTargetOf(w) {
    if (!w) return '';
    var isFac = !!(w.session && w.session.workType === 'facility') || w.workType === 'facility';
    var t = '';
    if (isFac && w.session && w.session.facilityCustomer) t = w.session.facilityCustomer.workTarget || '';
    if (!t) {
      for (var i = 0; i < (w.units || []).length; i++) {
        var c = w.units[i].customer;
        if (c && c.workTarget) { t = c.workTarget; break; }
      }
    }
    var ov = _ovOf(w); if (ov && ov.target) t = ov.target;
    return t || '';
  }
  /* 호수 글자 (2개까지, 나머지는 +N) — 아젠다 줄과 줄 메뉴가 같은 표기를 쓰도록 */
  function _itemUnitsText(it) {
    var d = it && it.data; if (!d) return '';
    var nm = [];
    if (it.type === 'work')        nm = (d.units || []).map(function (u) { return u.name || ''; }).filter(Boolean);
    else if (it.type === 'shared') nm = (d.unitNames || []).filter(Boolean);
    if (!nm.length) return '';
    return nm.slice(0, 2).join(', ') + (nm.length > 2 ? ' +' + (nm.length - 2) : '');
  }
  function _itemTargetText(it) {
    var d = it && it.data; if (!d) return '';
    if (it.type === 'work')   return _workTargetOf(d);
    if (it.type === 'shared') return d.target || '';
    return '';
  }
  /* 제목 뒤 보조 글자 — ★ 2026-08-24 사용자 요청: 줄 우측 끝은 호수가 아니라 **작업대상**.
     작업대상이 비어 있을 때만 호수로 대신한다(빈칸으로 두면 줄이 허전하다). 폭이 모자라면 CSS 로 잘린다. */
  function _itemSub(it) {
    if (!it || !it.data) return '';
    var d = it.data;
    if (it.type === 'work' || it.type === 'shared') {
      return _itemTargetText(it) || _itemUnitsText(it);
    }
    if (it.type === 'reminder') return d.memo || '';
    return '';
  }
  /* 날짜 하나의 항목을 화면에 보이는 순서(시간순)로. 목록 렌더와 줄 클릭이 같은 배열을 봐야
     인덱스가 어긋나지 않는다 — 그래서 한 곳에서만 정렬한다. */
  function _sortedItems(dateStr) {
    return (_dateMap[dateStr] || []).slice().sort(function (a, b) {
      var ta = _itemStart(a), tb = _itemStart(b);
      if (ta && tb) return ta < tb ? -1 : (ta > tb ? 1 : 0);
      if (ta) return -1;
      if (tb) return 1;
      return 0;
    });
  }
  function _agendaRowHtml(it, dateStr, idx) {
    var ic = _indIconOf(it), icHtml;
    if (ic) icHtml = _icoInnerHtml(ic, 18);
    else {
      /* 업종을 못 푸는 항목은 엉뚱한 아이콘 대신 접힘과 같은 '점' (규칙 통일) */
      var m = _dotMeta(it);
      icHtml = '<i class="cal-dot cal-dot-' + m.dc + '"' +
               (m.col ? ' style="background:' + m.col + ';"' : '') + '></i>';
    }
    var t   = _itemStart(it);
    var col = _timeColorOf(it);       // 시간 글자색 = 작업자 색 (접힘 점과 같은 순서)
    var sub = _itemSub(it);
    /* ★ 2026-08-22 완료한 리마인더는 날짜 목록 카드(.cal-rem-done)와 같은 규칙으로 —
       줄 전체를 흐리게 + 제목에 취소선. 규칙이 갈라지면 같은 항목이 화면마다 달라 보인다. */
    var done = (it.type === 'reminder' && it.data && it.data._done);
    return '<div class="cal-ag-row' + (done ? ' cal-ag-done' : '') +
             '" data-date="' + dateStr + '" data-ai="' + idx + '">' +
             '<span class="cal-ag-ic">' + icHtml + '</span>' +
             '<span class="cal-ag-tm' + (t ? '' : ' cal-ag-notm') + '"' +
               ((t && col) ? ' style="color:' + col + ';"' : '') + '>' + (t ? _escH(t) : '–') + '</span>' +
             '<span class="cal-ag-ti">' + _escH(_itemTitle(it)) + '</span>' +
             (sub ? '<span class="cal-ag-sub">' + _escH(sub) + '</span>' : '') +
           '</div>';
  }
  function _agendaHtml() {
    var DOW_KR = ['일', '월', '화', '수', '목', '금', '토'];
    var lastDate = new Date(_calYear, _calMonth + 1, 0).getDate();
    var out = '', days = 0;
    for (var d = 1; d <= lastDate; d++) {
      var dateStr = _calYear + '-' + _pad(_calMonth + 1) + '-' + _pad(d);
      var items = _sortedItems(dateStr);
      if (!items.length) continue;
      days++;
      var dow  = new Date(_calYear, _calMonth, d).getDay();
      var holi = _holidayOf(dateStr);
      var cls  = 'cal-ag-day';
      if (dow === 0 || holi)    cls += ' cal-ag-sun';
      else if (dow === 6)       cls += ' cal-ag-sat';
      if (dateStr === _today)   cls += ' cal-ag-today';
      if (dateStr === _selDate) cls += ' cal-ag-sel';
      var rows = '';
      for (var i = 0; i < items.length; i++) rows += _agendaRowHtml(items[i], dateStr, i);
      out += '<div class="' + cls + '" data-date="' + dateStr + '">' +
               /* 날짜 기둥: '19 수' 한 줄 + 그 아래 건수 (2026-08-22 사용자 요청 — 3줄은 답답했다) */
               '<div class="cal-ag-date">' +
                 '<div class="cal-ag-dline">' +
                   '<span class="cal-ag-dnum">' + d + '</span>' +
                   '<span class="cal-ag-dow">' + DOW_KR[dow] + '</span>' +
                 '</div>' +
                 '<span class="cal-ag-cnt">' + items.length + '건</span>' +
               '</div>' +
               '<div class="cal-ag-items">' +
                 (holi ? '<div class="cal-ag-holi">' + _escH(holi) + '</div>' : '') +
                 rows +
               '</div>' +
             '</div>';
    }
    if (!days) {
      // 아직 불러오는 중이면 '없습니다'라고 하면 안 된다 (손잡이를 눌러 바로 펼친 경우)
      if (_calItems === null) return '<div class="cal-ag-empty">⏳ 일정 불러오는 중…</div>';
      return '<div class="cal-ag-empty">이 달에는 등록된 일정이 없습니다.<br>' +
             '오른쪽 아래 <b>▲</b> 로 달력으로 돌아간 뒤 <b>＋</b> 로 추가하세요.</div>';
    }
    return out;
  }

  /* ⭐ 2026-08-22 손잡이 튕김 — 스케줄 탭에 들어올 때 아래로 3번 튕기고 멈춘다.
       ⚠️ 무한 반복은 쓰지 않는다. 시선을 계속 뺏기도 하고, 예전에 끝나지 않는 타이머로
          발열을 겪은 적이 있다([[project_battery_optimization]] 취지). CSS 3회 반복 + 3초 뒤 클래스 제거.
       문구('아래로 당겨 한 달 보기')는 처음 5번까지만 — 그 뒤엔 '⌄' 만 남는다. */
  var GRAB_TIP_KEY = 'calGrabTipN';
  var _grabT = null;
  function _pulseGrab() {
    var g = document.getElementById('calGrab');
    if (!g) return;
    var n = 0;
    try { n = parseInt(localStorage.getItem(GRAB_TIP_KEY) || '0', 10) || 0; } catch (e) {}
    var tx = g.querySelector('.cal-grab-tx');
    if (tx) tx.textContent = (n < 5) ? '⌄ 아래로 당겨 한 달 보기' : '⌄';
    try { localStorage.setItem(GRAB_TIP_KEY, String(n + 1)); } catch (e) {}
    g.classList.remove('cal-grab-hint');
    void g.offsetWidth;                 // 클래스를 도로 붙여도 애니메이션이 다시 돌게
    g.classList.add('cal-grab-hint');
    clearTimeout(_grabT);
    _grabT = setTimeout(function () { g.classList.remove('cal-grab-hint'); }, 3000);
  }

  /* ⭐ 2026-08-22 상단 '오늘' 버튼 (사용자 요청).
       · 다른 달을 보고 있으면 오늘이 있는 달로 이동
       · 접힌 달력이면 오늘을 선택하고 아래에 그날 목록을 편다
       · 펼친 목록이면 오늘(없으면 오늘 이후 첫 일정) 자리로 스크롤한다
     ⚠️ 달을 옮기면 일정은 비동기로 나중에 채워진다(loadCalendarData) → 그 자리에서 스크롤하면
        아직 빈 목록이다. 그래서 깃발만 세우고 renderCalendarGrid 가 그린 뒤에 처리한다. */
  var _wantTodayScroll = false;
  function _scrollAgendaToToday() {
    var grid = document.getElementById('calGrid');
    if (!grid || !grid.classList.contains('cal-agenda')) return;
    var days = grid.querySelectorAll('.cal-ag-day'), target = null;
    for (var i = 0; i < days.length; i++) {
      var dv = days[i].getAttribute('data-date') || '';
      if (dv >= _today) { target = days[i]; break; }   // 오늘이 비었으면 그 이후 첫 일정으로
    }
    if (!target) target = days[days.length - 1];
    if (target) grid.scrollTop = Math.max(0, target.offsetTop - 6);
  }
  function _goToday() {
    var ty = +_today.slice(0, 4), tm = +_today.slice(5, 7) - 1;
    var diff = (ty - _calYear) * 12 + (tm - _calMonth);
    if (diff !== 0) {
      _wantTodayScroll = _expanded;
      _navMonth(diff, _today);
      return;
    }
    if (_expanded) { _scrollAgendaToToday(); return; }
    _selDate = _today;
    window._calSelectedDate = _today;
    renderCalendarGrid();
    renderDayDetail(_today, false);
    var cb = document.getElementById('customerBody');
    if (cb) cb.scrollTop = 0;
  }

  /* 펼친 목록 → 접히면서 그 날짜 목록 열기.
     날짜 기둥 탭과 줄 메뉴의 '이 날짜 목록' 두 곳에서 쓴다. */
  function _goDayFromExpanded(date) {
    _selDate = date;
    window._calSelectedDate = date;
    _setExpanded(false, true);     // 안에서 renderCalendarGrid → cal-sel 도 다시 붙는다
    renderDayDetail(date, false);
    /* ★ 접은 뒤에는 스케줄 화면 맨 위(달력 상단)가 보이게 둔다.
       예전엔 목록으로 scrollIntoView 를 걸어 화면이 아래로 밀렸다(사용자 지적 2026-08-16). */
    var _cb = document.getElementById('customerBody');
    if (_cb) {
      _cb.scrollTop = 0;
      setTimeout(function () { _cb.scrollTop = 0; }, 270);   // 접힘 애니메이션 끝난 뒤 한 번 더
    }
  }

  /* ══════════════════════════════════════════════════════════════
     ⭐ 2026-08-22 펼친 목록에서 줄을 누르면 뜨는 작은 메뉴 (열기·상세·삭제)
       왜 줄에 버튼을 안 달았나:
         · 폭 — 어제 폭 때문에 격자를 버렸는데 다시 폭을 내주면 현장명이 줄어든다.
         · 항목마다 할 수 있는 게 다르다(작업 열기/상세/삭제, 공유 열기/상세/숨기기,
           리마인더는 열기가 없고 완료/상세) → 줄마다 버튼 수가 달라 목록이 들쭉날쭉해진다.
       메뉴는 폭을 안 먹고 종류별로 가능한 것만 고를 수 있으며, 오탭해도 작업이 안 열린다.
     ⚠️ 동작은 전부 날짜 상세 카드가 쓰는 것과 **같은 함수**를 부른다. 새 경로를 만들지 말 것.
     ⚠️ 메뉴는 body 에 붙어 글자 크기(zoom) 밖이다 → #customerBody 의 배율을 그대로 복사한다.
  ══════════════════════════════════════════════════════════════ */
  window.__calAgMenuClose = function () {
    var m = document.getElementById('calAgMenu');
    if (!m) return false;
    if (m.parentNode) m.parentNode.removeChild(m);
    return true;
  };
  function _openAgendaMenu(dateStr, idx) {
    var it = _sortedItems(dateStr)[idx];
    if (!it || !it.data) return;
    // 고객 항목은 따로 할 게 없다 → 예전처럼 그날 목록으로
    if (it.type === 'customer') { _goDayFromExpanded(dateStr); return; }
    window.__calAgMenuClose();

    var rows = [];
    if (it.type === 'work') {
      rows.push({ ic: '📂', tx: '작업 열기',        fn: function () { openWorkFromCalendar(it); } });
      rows.push({ ic: '📄', tx: '상세 보기 / 수정', fn: function () { openWorkEdit(it); } });
      rows.push({ ic: '🗑️', tx: '삭제', danger: 1, fn: function () { deleteWorkFromCalendar(it); } });
    } else if (it.type === 'shared') {
      var d = it.data;
      var sMine = !!(window.Cloud && Cloud.user && d.ownerUid === Cloud.user.uid);
      rows.push({ ic: '📂', tx: '작업 열기', fn: function () {
        if (window.CloudPhotoSync && CloudPhotoSync.openInWorkTab) {
          CloudPhotoSync.openInWorkTab(d.ownerUid || d.partnerUid, d.workId, d);
        }
      } });
      rows.push({ ic: '📄', tx: '상세 보기 / 수정', fn: function () { openWorkEdit(it); } });
      if (sMine) {
        rows.push({ ic: '🗑️', tx: '삭제', danger: 1, fn: function () {
          if (!confirm('🗑 공유 휴지통으로 이동할까요? (설정에서 복원할 수 있습니다)')) return;
          if (window.CloudShare && CloudShare.deleteSchedule) {
            CloudShare.deleteSchedule(d.workId, d.manual).then(function () {
              if (window.__calendarRefresh) window.__calendarRefresh();
            }).catch(function () {});
          }
        } });
      } else {
        rows.push({ ic: '🚫', tx: '내 달력에서 숨기기', fn: function () {
          if (!confirm('이 공유 일정을 내 달력에서 숨길까요?\n(상대가 삭제했거나 더 이상 필요 없는 경우)')) return;
          _shHide(_shHideKey(d));
          if (window.__calendarRefresh) window.__calendarRefresh();
          if (typeof showToast === 'function') showToast('공유 일정을 숨겼습니다', 'ok');
        } });
      }
    } else if (it.type === 'reminder') {
      var rm = it.data, rDone = !!rm._done;
      rows.push({ ic: rDone ? '↩️' : '✅', tx: rDone ? '완료 취소' : '완료로 표시', fn: function () {
        if (window.Reminders) Reminders.toggleDone(rm._srcId, rm._occDate);
      } });
      rows.push({ ic: '📄', tx: '상세 / 수정', fn: function () { window.openReminderEdit(null, rm._srcId); } });
    }
    // 어디서 눌러도 막다른 길이 없게 — 날짜 목록으로 가는 길을 항상 마지막에 둔다
    rows.push({ ic: '📅', tx: '이 날짜 목록 보기', fn: function () { _goDayFromExpanded(dateStr); } });

    var parts = dateStr.split('-');
    var DOW_KR = ['일', '월', '화', '수', '목', '금', '토'];
    var dlabel = parseInt(parts[1], 10) + '월 ' + parseInt(parts[2], 10) + '일 (' +
                 DOW_KR[new Date(+parts[0], +parts[1] - 1, +parts[2]).getDay()] + ')';
    var tstr = _itemStart(it);

    var ov = document.createElement('div');
    ov.id = 'calAgMenu';
    ov.className = 'cal-agm-ov';
    /* ★ 2026-08-24 사용자 요청 — 작업명 옆 빈 자리에 호수와 작업대상을 같이 보여준다.
       (메뉴를 열고 나서야 '무슨 작업이었지' 하고 다시 닫는 일이 없도록) */
    var _mUnit = _itemUnitsText(it), _mTgt = _itemTargetText(it);
    var _metaHtml = (_mUnit || _mTgt)
      ? '<div class="cal-agm-meta">' +
          (_mUnit ? '<span class="cal-agm-chip">' + _escH(_mUnit) + '</span>' : '') +
          (_mTgt  ? '<span class="cal-agm-chip">\uD83C\uDFAF ' + _escH(_mTgt) + '</span>' : '') +
        '</div>'
      : '';

    ov.innerHTML =
      '<div class="cal-agm-box">' +
        '<div class="cal-agm-head">' +
          '<div class="cal-agm-tline">' +
            '<div class="cal-agm-title">' + _escH(_itemTitle(it)) + '</div>' + _metaHtml +
          '</div>' +
          '<div class="cal-agm-sub">' + _escH(dlabel + (tstr ? ' · ' + tstr : '')) + '</div>' +
        '</div>' +
        rows.map(function (r, i) {
          return '<button class="cal-agm-item' + (r.danger ? ' cal-agm-danger' : '') + '" data-ri="' + i + '">' +
                   '<span class="cal-agm-ic">' + r.ic + '</span><span>' + r.tx + '</span></button>';
        }).join('') +
        '<button class="cal-agm-cancel">닫기</button>' +
      '</div>';
    document.body.appendChild(ov);
    // 글자 크기(zoom) 승계 — 오버레이가 아니라 상자에만 걸어야 배경이 화면을 다 덮는다
    /* ⚠️ 2026-08-22 실측 — zoom 안에서는 vh 가 배율만큼 부푼다(퍼센트 폭은 멀쩡한데 vh 는 아니다).
       메뉴 상한도 화면 px 을 배율로 나눠 요소 좌표계로 넣는다. 넘치면 .cal-agm-box 가 스크롤. */
    var _box = ov.querySelector('.cal-agm-box'), _z = 1;
    try {
      var zs = (document.getElementById('customerBody') || {}).style;
      if (zs && zs.zoom) { _box.style.zoom = zs.zoom; _z = parseFloat(zs.zoom) || 1; }
    } catch (e) {}
    try { _box.style.maxHeight = Math.floor(Math.max(200, window.innerHeight - 24) / _z) + 'px'; } catch (e) {}
    requestAnimationFrame(function () { ov.classList.add('open'); });

    ov.addEventListener('click', function (e) {
      if (e.target === ov || (e.target.classList && e.target.classList.contains('cal-agm-cancel'))) {
        window.__calAgMenuClose(); return;
      }
      var b = e.target.closest && e.target.closest('.cal-agm-item');
      if (!b) return;
      var r = rows[parseInt(b.getAttribute('data-ri'), 10)];
      window.__calAgMenuClose();
      if (r && r.fn) { try { r.fn(); } catch (err) { console.warn(err); } }
    });
  }

  /* ── 확장/접힘 전환 ──────────────────────────────
     높이를 직접 애니메이션한다. transform:scaleY 는 날짜 숫자까지 찌그러뜨려서 못 쓴다.
     확장 중에는 grid-auto-rows:1fr → 그 달이 5줄이든 6줄이든 알아서 나눠 갖는다. */
  /* ⭐ 2026-08-21 — 글자 크기를 '크게/아주 크게'로 쓰면 달력이 접히지 않던 버그.
     설정의 글자 크기는 .main 등에 **CSS zoom** 배율로 적용된다(settings.js applyFontSize).
     그런데 zoom 안에서는 좌표계가 둘로 갈린다:
       · getBoundingClientRect()/touch clientY = 화면(뷰포트) px  ← 배율이 이미 반영된 값
       · offsetHeight / style.height          = 요소 자기 좌표계 ← 배율 적용 '전' 값
     예전 _expandedHeight() 는 화면 px 로 잰 값을 style.height 에 그대로 넣었다.
     배율 1.2면 실제로는 1.2배 높이로 그려져 달력이 화면 아래로 넘쳤고,
     넘친 상태에선 브라우저가 스크롤을 먼저 가져가 preventDefault 가 먹지 않아
     '접기 드래그'가 통째로 무시됐다. (배율 1인 폰에서는 z=1 이라 멀쩡했다)
     → 실측 배율로 나눠 요소 좌표계 값으로 돌려준다. */
  function _zoomFactor(el) {
    try {
      var r = el.getBoundingClientRect(), o = el.offsetHeight;
      if (o > 0 && r.height > 0) { var z = r.height / o; if (z > 0.2 && z < 5) return z; }
    } catch (e) {}
    return 1;
  }
  function _expandedHeight() {
    var body = document.getElementById('customerBody');
    var grid = document.getElementById('calGrid');
    if (!body || !grid) return 0;
    var br = body.getBoundingClientRect(), gr = grid.getBoundingClientRect();
    var z = _zoomFactor(grid);
    // 하단 고정 탭바가 가리는 만큼(= cal-mode 의 padding-bottom)은 비워 둔다
    return Math.max(240, Math.round((((br.bottom - 84) - gr.top - 6)) / z));
  }
  /* ⭐⭐ 2026-08-21 근본 대책 — "계산을 믿지 말고, 그려진 걸 재서 맞춘다".
       왜 이렇게까지 하나: CSS zoom 안에서 좌표를 어느 기준으로 돌려주는지가
       **안드로이드 WebView(크로미움) 버전마다 다르다.** 크로미움 128에서 zoom 이
       표준화되면서 getBoundingClientRect 의 기준이 바뀌었고, 같은 코드가
       어떤 폰에서는 맞고 어떤 폰에서는 어긋난다(= '일부 폰에서만' 안 되던 이유).
       그래서 '어느 계산식이 옳은가'를 고르는 방식으로는 영원히 못 맞춘다.
       → 높이를 넣은 뒤 **실제로 그려진 아래쪽 위치를 다시 재서** 넘치거나 남는 만큼
         보정한다. 배율이 얼마든, WebView 가 어느 버전이든 두세 프레임 안에
         화면에 딱 맞는 값으로 수렴한다. 넘치지 않으므로 브라우저가 스크롤을
         가로채는 일도 없고, 따라서 접기 드래그가 무시되지 않는다. */
  var _fitT = null;
  function _fitExpanded(delay) {
    clearTimeout(_fitT);
    _fitT = setTimeout(function () {
      var body = document.getElementById('customerBody');
      var grid = document.getElementById('calGrid');
      if (!_expanded || !body || !grid) return;
      var pass = 0;
      (function step() {
        if (!_expanded || pass++ >= 5) return;   // 배율 측정이 빗나가도 5패스면 확실히 수렴(실측 시뮬레이션)
        var br = body.getBoundingClientRect(), gr = grid.getBoundingClientRect();
        var allow = (br.bottom - 84) - 6;      // 하단 탭바 자리를 비운 '허용 바닥'(화면 px)
        var over  = gr.bottom - allow;         // +면 넘침, -면 남음
        if (Math.abs(over) < 2) return;        // 이미 맞았다
        var z   = _zoomFactor(grid) || 1;
        var cur = grid.offsetHeight;           // 요소 좌표계
        var next = Math.max(240, Math.round(cur - over / z));
        if (next === cur) return;
        grid.style.transition = 'none';
        grid.style.height = next + 'px';
        requestAnimationFrame(step);
      })();
    }, delay || 0);
  }
  // 인라인 높이를 잠깐 걷어내고 '원래 높이'를 재본다 (접을 때 목표값)
  function _naturalHeight(grid) {
    /* ⚠️ 2026-08-22 확장 상태의 #calGrid 안에는 격자가 아니라 '세로 목록'이 들어 있다.
       여기서 인라인 높이를 지우면 목록 전체 길이(화면 몇 배)가 나와서
       접기 드래그의 하한이 터무니없이 커진다 → 마지막 접힘 격자 높이를 쓴다. */
    /* ⭐ 2026-08-27 조건을 '아젠다인가'에서 '펼쳐져 있는가'로 넓혔다.
       격자 보기도 펼친 동안에는 칸 스타일(.cal-expanded .cal-cell)과 내용(점→아이콘)이 달라
       여기서 인라인 높이를 지우고 재면 접힘 높이와 다른 값이 나온다.
       펼친 동안에는 **마지막으로 잰 접힘 높이**를 쓴다(1390행에서 적립). */
    if (_expanded || grid.classList.contains('cal-agenda')) return _lastNaturalH || 240;
    var h = grid.style.height, ar = grid.style.gridAutoRows, tr = grid.style.transition;
    grid.style.transition = 'none'; grid.style.height = ''; grid.style.gridAutoRows = '';
    var n = grid.offsetHeight;
    grid.style.height = h; grid.style.gridAutoRows = ar; grid.style.transition = tr;
    return n;
  }
  /* ⭐ 2026-08-22 도입 — 펼친 동안 ＋ 버튼이 '▲ 달력으로'가 되던 겉모습.
     ⭐ 2026-08-31 되돌림(사용자 요청): "위쪽 삼각형은 이제 필요 없다, ＋ 아이콘으로 유지".
       펼침을 접는 다른 방법(날짜 탭·하드웨어 뒤로가기·목록 바닥에서 위로 밀기)이
       이미 있어서, ＋는 펼친 동안에도 항상 '새 작업' 그대로 둔다.
       tabbar.js bindFab 의 __calCollapse() 가드도 같이 제거했다 — 겉모습과 동작을 맞춘다. */
  function _syncFab() {
    var fab = document.getElementById('fabNewWork');
    if (!fab) return;
    fab.classList.remove('fab-back');
    fab.textContent = '＋';
    fab.title       = '새 작업';
  }
  /* ★ 2026-08-27 펼침 보기 전환 ─────────────────────────────
       버튼은 **펼친 동안에만** 보인다(styles.css 의 .cal-expanded 조건).
       ⚠️ 아이콘은 '지금 보기'가 아니라 '누르면 갈 보기'를 보여준다 — 버튼은 행동이지 표시가 아니다.
       ⚠️ 전환에 애니메이션을 넣지 않는다. 펼치기/접기 제스처와 달리 이건 사용자가 직접 누른
          명시적 동작이라 바로 바뀌는 편이 낫고, 연출을 넣으면 v585 에서 고생한 '순서' 문제를
          한 군데 더 만들게 된다. */
  function _syncViewBtn() {
    var b = document.getElementById('calViewToggle');
    if (!b) return;
    var toGrid = (_expandView !== 'grid');
    b.textContent = toGrid ? '▦' : '☰';
    b.title = toGrid ? '달력 키우기로 보기' : '목록으로 보기';
    b.setAttribute('aria-label', b.title);
  }

  function _applyExpViewClass(body) {
    if (!body) return;
    body.classList.toggle('cal-exp-grid', _expanded && _expandView === 'grid');
    body.classList.toggle('cal-exp-list', _expanded && _expandView === 'list');
  }

  function _switchExpandView() {
    _expandView = (_expandView === 'grid') ? 'list' : 'grid';
    try { localStorage.setItem(_EXPVIEW_KEY, _expandView); } catch (e) {}
    _syncViewBtn();
    if (!_expanded) return;
    var body = document.getElementById('customerBody');
    var grid = document.getElementById('calGrid');
    _applyExpViewClass(body);
    if (!grid) return;
    /* 목록에서 스크롤을 내려 둔 채 격자로 가면 격자가 잘려 보인다 */
    grid.scrollTop = 0;
    if (body) body.scrollTop = 0;
    renderCalendarGrid();
    /* 높이는 보기와 무관하게 '화면 가득'. 격자는 grid-auto-rows:1fr 로 줄을 고르게 나눠야 한다 */
    grid.style.gridAutoRows = '1fr';
    grid.style.transition   = 'none';
    grid.style.height       = _expandedHeight() + 'px';
    _fitExpanded(0);
  }

  function _setExpanded(on, animate) {
    var body = document.getElementById('customerBody');
    var grid = document.getElementById('calGrid');
    if (!body || !grid) return;
    var changed = (_expanded !== on);
    _expanded = on;
    _syncFab();
    _syncViewBtn();
    if (on) { body.scrollTop = 0; grid.scrollTop = 0; }   // 높이 계산 전에 맨 위로 (안 그러면 좌표가 어긋난다)

    function applyHeight() {
      if (_expanded) {
        grid.style.gridAutoRows = '1fr';
        grid.style.transition   = animate ? 'height .24s cubic-bezier(.22,.68,.3,1)' : 'none';
        grid.style.height       = _expandedHeight() + 'px';
        _fitExpanded(animate ? 260 : 0);   // ★ 애니메이션이 끝난 뒤 실측으로 재보정
      } else {
        var nat = _naturalHeight(grid);
        /* ⚠️ 접힐 때는 grid-auto-rows 를 1fr 로 두면 안 된다 (2026-08-17 실측).
           1fr 은 모든 줄을 똑같이 나누는데, 실제 접힘 레이아웃은 줄마다 높이가 다르다
           (기간 막대·공휴일 이름이 있는 줄이 더 높다). 그래서 높이가 nat 인 '마지막 프레임'의
           줄 위치와, 인라인 높이를 지운 순간의 줄 위치가 최대 7px 어긋나 툭 튀었다.
           auto(기본) + align-content:stretch 는 높이가 nat 일 때 자연 레이아웃과 정확히 같아
           지우는 순간 아무 변화가 없다. (펼칠 때는 줄을 고르게 나눠야 하므로 1fr 유지) */
        grid.style.gridAutoRows = '';
        grid.style.transition   = animate ? 'height .24s cubic-bezier(.22,.68,.3,1)' : 'none';
        grid.style.height       = nat + 'px';
        // 달마다 줄 수가 달라지므로 고정 높이를 남겨두면 안 된다 → 끝나면 자연 높이로 되돌림
        var _onEnd, _done = function () {
          if (_expanded) return;
          var g = document.getElementById('calGrid'); if (!g) return;
          g.removeEventListener('transitionend', _onEnd);
          g.style.transition = 'none'; g.style.height = ''; g.style.gridAutoRows = '';
        };
        _onEnd = function (e) { if (!e || e.propertyName === 'height') _done(); };
        grid.addEventListener('transitionend', _onEnd);
        setTimeout(_done, animate ? 340 : 0);   // transitionend 를 놓쳤을 때의 폴백
      }
    }

    if (!changed) { applyHeight(); return; }   // 드래그를 도로 놓은 경우 — 높이만 제자리로

    /* ★ 2026-08-17 전환 연출 — 사용자 피드백대로 **접을 때만** 부드럽게 한다.
         · 펼칠 때: 예전처럼 바로 그린다(크로스페이드를 넣었더니 오히려 어색하다고 함).
         · 접을 때: 날짜 숫자는 그대로 둔 채 칸 '내용'만 잠깐 흐려진 사이에 갈아 끼운다.
       ⚠️ 매출·목록을 '떠오르게' 하는 연출도 넣어 봤다가 화면이 살짝 위로 움직여 뺐다. */
    if (on || !animate) {
      body.classList.toggle('cal-expanded', on);
      _applyExpViewClass(body);
      renderCalendarGrid(); applyHeight(); return;
    }

    /* ⭐ 2026-08-24 접는 '순서'를 고쳤다 (사용자: "달력으로 돌아갈 때 화면 전환이 부자연스럽다").
       예전엔 cal-expanded 를 **맨 먼저** 벗겼다. 그런데 그 클래스가 월매출·상세목록·스와이프
       힌트를 감추고 body 스크롤을 잠그고 있어서, 달력이 아직 화면을 가득 채운 상태에서
       그것들이 한꺼번에 튀어나오고 스크롤까지 생겨 목록이 사라지기도 전에 화면이 덜컹였다.
       → 클래스 제거를 '내용 교체'와 같은 프레임으로 미룬다. 순서:
         (1) 목록만 조용히 흐려짐 → (2) 그 사이 격자로 교체 → (3) 높이가 줄어듦 →
         (4) 다 줄어든 뒤에야 격자가 떠오름.
       ⚠️ _naturalHeight() 는 cal-expanded 가 걸린 상태에서 재면 칸 스타일이 달라 값이 틀린다.
          그래서 클래스 제거는 renderCalendarGrid()/applyHeight() **앞**이어야 한다. */
    grid.classList.add('cal-swapping');
    setTimeout(function () {
      if (_expanded !== on) { grid.classList.remove('cal-swapping'); return; }  // 그 사이 또 바뀌었으면 취소
      // 손가락을 따라 올라가 있던 목록의 잔상 정리 (흐려짐은 cal-swapping 이 이어받는다)
      grid.style.transform = 'none';
      grid.style.opacity   = '';
      body.classList.remove('cal-expanded');
      _applyExpViewClass(body);
      renderCalendarGrid();
      applyHeight();
      // 격자는 높이가 다 줄어든 뒤에 떠오르게 — 줄어드는 도중에 나타나면 아랫줄이 잘려 보인다
      setTimeout(function () {
        if (_expanded) return;
        var g = document.getElementById('calGrid');
        if (g) g.classList.remove('cal-swapping');
      }, 190);
    }, 150);
  }
  /* ★ 2026-08-21 화면 조건이 바뀌면(회전·키보드·글자 크기 변경) 확장 높이를 다시 맞춘다.
       예전엔 펼친 뒤 글자 크기를 바꾸면 높이가 그대로라 화면 밖으로 넘쳤다. */
  window.__calRefit = _fitExpanded;
  window.addEventListener('resize', function () { if (_expanded) _fitExpanded(120); });
  window.addEventListener('orientationchange', function () { if (_expanded) _fitExpanded(360); });

  // 하드웨어 뒤로가기에서 먼저 접기 (state.js 백버튼 핸들러가 호출)
  window.__calCollapse = function () {
    // ★ 2026-08-22 줄 메뉴가 떠 있으면 그것부터 닫는다 (달력을 접어버리면 메뉴만 남는다)
    if (window.__calAgMenuClose && window.__calAgMenuClose()) return true;
    if (!_expanded) return false;
    _setExpanded(false, true);
    return true;
  };

  // ★ 2026-07-11: 작업자 닉네임 배지 (본인이 고른 색상으로 표시)
  //   2026-08-13 사용자 요청 — 이름 앞 아이콘(👤) 제거. 색상만으로 누군지 구분한다.
  function _workerBadge(name){
    if (!name) return '';
    var c = (window.CloudShare && CloudShare.colorForName) ? (CloudShare.colorForName(name) || '') : '';
    return '<span class="cust-unit" style="' + (c ? 'color:' + c + ';' : '') + 'font-weight:700;">' + _escH(name) + '</span>';
  }
  /* 공유 카드 이름 영역.
     ★ 2026-08-13 사용자 요청 — 여기 나오는 이름을 '올린 사람'이 아니라 '작업자'로 바꿨다.
       내 작업 카드는 원래 작업자(_workerBadge)를 보여줘서 공유 카드만 기준이 달랐고,
       그래서 담당자를 바꿔도 목록의 이름이 그대로라 '안 바뀐다'로 보였다.
       누가 올렸는지는 카드 색(cust-card-shared / cw-time-shared)으로 구분된다.
       아이콘(📅·👥)도 같이 뺐다. 작업자가 비어 있는 옛 항목만 올린 사람 이름으로 폴백한다. */
  function _sharedNameBadge(sw, sMine){
    var name = (sw && sw.worker) || '';
    var color = '';
    if (name) {
      try { color = (window.CloudShare && CloudShare.colorForName) ? (CloudShare.colorForName(name) || '') : ''; } catch (e) {}
    } else {
      var uid = sMine ? (window.Cloud && Cloud.user && Cloud.user.uid) : sw.ownerUid;
      var pf = (window.CloudShare && CloudShare.profileOf && uid) ? CloudShare.profileOf(uid) : null;
      name = (pf && pf.name) || (sMine ? '내 일정' : (sw.partnerName || '상대'));
      color = (pf && pf.color) || '';
    }
    return '<span class="cust-unit' + (sMine ? '' : ' cust-unit-shared') + '" style="' +
           (color ? 'color:' + color + ';' : (sMine ? 'color:var(--mu);' : '')) +
           'font-weight:700;">' + _escH(name) + '</span>';
  }
  // ★ 2026-07-11: 사진 개수 표시 - 내 사진 / 공유(상대가 보탠) 사진 구분
  // 저장된 글 개수 배지 (_session.json posts)
  /* 저장된 글 개수 배지.
     내 작업은 _session.json 의 posts 배열, 공유 작업은 클라우드 요약의 posts 숫자를 쓴다. */
  function _postsBadge(w){
    var n = 0;
    if (w && w.session && Array.isArray(w.session.posts)) n = w.session.posts.length;
    else if (w && typeof w.posts === 'number') n = w.posts;
    return n ? '<span class="cw-posts">✍️ ' + n + '</span>' : '';
  }
  /* ⛔ 2026-08-13 '가져오기' UI 제거 — 담당자 변경([상세] 안의 담당자 칸)으로 대체했다.
       가져오기는 작업 소유권(사진 실물이 든 로컬 폴더)까지 옮기려는 기능이라,
       원작업자 폴더 삭제 실패 → syncAll 재업로드 → 작업 부활/삭제불가 루프를 만들었다.
       이제 데이터는 만든 사람 자리에 그대로 두고 '누가 맡는가(worker)'만 바꾼다.
       ⚠️ CloudShare.canTakeSchedule / takeSchedule / markClaimed 와
          buildOverrides 의 claimedBy 처리는 지우지 말 것 — 예전에 가져간 항목이
          클라우드에 남아 있으면 유령 카드가 된다. 여기서는 버튼만 내린다.
       (두 함수는 호출부 2곳이 있어 이름을 남긴 채 빈 껍데기로 둔다) */
  function _takeBtnHtml(sw, sMine, idxAttr, i){ return ''; }
  function _bindTakeButtons(root, getItem, idxAttr, afterFn){ /* 가져오기 제거됨 */ }
  /* ★ 2026-08-16 업종 아이콘 — 시간칸 위에 띄워 어느 업종의 작업인지 한눈에 보이게.
     내 작업은 _session.json 의 profileSnap, 공유 작업은 요약의 profileIcon 을 쓴다.
     ⚠️ 이번 변경 이전에 만든 작업에는 업종이 없다 → 아이콘 없이 그대로 그린다(빈 칸 아님, 아예 생략). */
  function _indIconHtml(w){
    try {
      var ic = '';
      if (w && window.Profiles && Profiles.iconForWork) {
        /* ⭐ 순서 주의 — '내 업종이면 지금 아이콘'이 먼저다.
             예전엔 저장된 사본(profileSnap.icon)을 먼저 봐서, 업종 아이콘을 바꿔도
             기존 작업들은 옛 아이콘 그대로였다(사용자 보고 2026-08-16). */
        var _ov = _ovOf(w);
        // 상대가 방금 바꾼 업종(오버라이드)은 로컬 반영 전이므로 그걸 먼저 본다
        if (_ov && (_ov.profileId || _ov.profileName || _ov.profileIcon)) {
          ic = Profiles.iconForWork({ profileId: _ov.profileId, profileSnap: _ov.profileSnap,
                                      profileIcon: _ov.profileIcon, profileName: _ov.profileName });
        }
        if (!ic) ic = Profiles.iconForWork(w);
      }
      // 그림(svg:) 아이콘도 그릴 수 있게 iconHtml 을 거친다
      if (ic && window.Profiles && Profiles.iconHtml) ic = Profiles.iconHtml(ic, 16);
      return ic ? '<div class="cw-ind">' + ic + '</div>' : '';
    } catch (e) { return ''; }
  }
  function _photoCntHtml(own, added){
    return '<span>📷 ' + (own || 0) + '장' + (added ? ' <b style="color:#b087ff;">+공유' + added + '</b>' : '') + '</span>';
  }
  function _fmtWon(n){ return '\u20a9' + (n||0).toLocaleString('ko-KR'); }
  // 'YYYY-MM-DD' → 'M/D'
  function _mdLabel(ds){ var p = String(ds||'').split('-'); return p.length === 3 ? (+p[1] + '/' + (+p[2])) : String(ds||''); }
  function _facOf(w){ return (w.session && w.session.facilityCustomer) || w.facilityCustomer || null; }
  function _isFacW(w){ return (w.session && w.session.workType === 'facility') || w.workType === 'facility'; }
  function _workPrice(w){
    var ov=_ovOf(w); if (ov && ov.price!=null && ov.price!=='') return _digits(ov.price);
    if (_isFacW(w)) { var fc=_facOf(w); return fc ? _digits(fc.price) : 0; }
    return (w.units||[]).reduce(function(a,u){ return a + _digits(u.customer && u.customer.price); }, 0);
  }
  function _workStart(w){
    var ov=_ovOf(w); if (ov && ov.startTime) return ov.startTime;
    if (_isFacW(w)) { var fc=_facOf(w); return (fc && fc.startTime) || ''; }
    var ts=(w.units||[]).map(function(u){return u.customer && u.customer.startTime;}).filter(Boolean).sort();
    return ts.length?ts[0]:'';
  }
  function _workEnd(w){
    var ov=_ovOf(w); if (ov && ov.endTime) return ov.endTime;
    if (_isFacW(w)) { var fc=_facOf(w); return (fc && fc.endTime) || ''; }
    var ts=(w.units||[]).map(function(u){return u.customer && u.customer.endTime;}).filter(Boolean).sort();
    return ts.length?ts[ts.length-1]:'';
  }
  function _timeRangeHtml(w){
    var st=_workStart(w), et=_workEnd(w);
    if(st && et) return st + '<br><span class="cw-tilde">~</span><br>' + et;
    if(st) return st;
    if(et) return et;
    return '<span class="cw-notime">–</span>';
  }
  /* 날짜 상세 목록 정렬 기준 시간.
     ★ 2026-08-08: reminder 를 빼먹어 '' 를 돌려주고 있었다 → 시간 없는 항목으로 취급돼
       리마인더가 항상 목록 맨 아래로 밀렸다(작업과 시간순 정렬이 안 맞음). */
  function _itemStart(it){
    if (!it || !it.data) return '';
    if (it.type === 'work')     return _workStart(it.data);
    if (it.type === 'shared')   return it.data.startTime || '';
    if (it.type === 'reminder') return it.data.time || '';
    return '';
  }

  // ── 완료 판정(언어 기반 시간대): 한글=KST(UTC+9), 영어=UTC ──
  function _localizedNow(){
    var lang = (typeof getCurrentLang === 'function') ? getCurrentLang() : 'ko';
    var offsetMin = (lang === 'en') ? 0 : 540;
    var d = new Date(Date.now() + offsetMin * 60000);
    var ymd = d.getUTCFullYear() + '-' + _pad(d.getUTCMonth()+1) + '-' + _pad(d.getUTCDate());
    var hm  = _pad(d.getUTCHours()) + ':' + _pad(d.getUTCMinutes());
    return { ymd: ymd, dt: ymd + 'T' + hm };
  }
  // 종료시간 있으면 종료시간 이후, 없으면 시작시간 이후, 둘 다 없으면 날짜 기준
  function _isWorkDone(w){
    if(!w) return false;
    var d = w.date || ''; if(!d) return false;
    var now = _localizedNow();
    var et = _workEnd(w), st = _workStart(w);
    if(et) return (d + 'T' + et) <= now.dt;
    if(st) return (d + 'T' + st) <= now.dt;
    return d < now.ymd;
  }

  var REV_IND_KEY = 'ac_cal_rev_ind_open_v1';   // 업종별 내역 펼침 상태

  /* ── 월 매출 (수행완료/미수행) ── */
  function renderMonthRevenue(){
    var el=document.getElementById('calRevenue'); if(!el) return;
    var ym = _calYear + '-' + _pad(_calMonth+1);
    var done=0, pend=0;
    var byInd={};                  // ★ 2026-08-16 업종별 {icon,cnt,sum}
    var _now=_localizedNow();
    (_calItems||[]).forEach(function(it){
      if(!it.data) return;
      var d=it.data.date||''; if(d.slice(0,7)!==ym) return;
      var pr, isDone;
      if(it.type==='work'){ pr=_workPrice(it.data); isDone=_isWorkDone(it.data); }
      else if(it.type==='shared'){
        // 공유 작업/일정: 가격은 항목의 price, 완료 판정은 종료/시작시간 또는 날짜 기준
        pr=_digits(it.data.price);
        var _et=it.data.endTime, _st=it.data.startTime;
        isDone = _et ? ((d+'T'+_et)<=_now.dt) : (_st ? ((d+'T'+_st)<=_now.dt) : (d<_now.ymd));
      } else { return; }
      if(isDone) done+=pr; else pend+=pr;
      /* ★ 2026-08-16 업종별 집계.
         업종 이름이 있어야 줄로 세울 수 있으므로 아이콘만 있고 이름이 없으면 '기타'로 묶는다.
         업종이 아예 없는 옛 작업도 '기타'로 간다(빠뜨리면 합계가 안 맞는다). */
      var _pn = '', _pi = '';
      if (window.Profiles && Profiles.nameForWork) {
        var _ovp = _ovOf(it.data);
        var _src = (_ovp && (_ovp.profileId || _ovp.profileName))
          ? { profileId: _ovp.profileId, profileSnap: _ovp.profileSnap,
              profileIcon: _ovp.profileIcon, profileName: _ovp.profileName }
          : it.data;
        _pn = Profiles.nameForWork(_src);      // 내 업종이면 지금 이름
        _pi = Profiles.iconForWork(_src);      // 내 업종이면 지금 아이콘
      }
      var _key = _pn || '기타';
      if (!byInd[_key]) byInd[_key] = { icon: _pi || '', cnt: 0, sum: 0 };
      byInd[_key].cnt++; byInd[_key].sum += pr;
      if (!byInd[_key].icon && _pi) byInd[_key].icon = _pi;
    });

    /* ★ 2026-08-16 업종별 내역 — 기본은 접어 둔다.
         칩을 옆으로 늘어놓으니 정신없다는 지적(사용자)에 따라
         '한 줄에 한 업종'으로 세우고, 필요할 때만 펼쳐 보게 바꿨다.
         업종이 하나뿐이면 버튼조차 만들지 않는다(대부분의 사용자에겐 군더더기). */
    var indKeys = Object.keys(byInd);
    var indHtml = '';
    if (indKeys.length > 1) {
      indKeys.sort(function (a2, b2) { return byInd[b2].sum - byInd[a2].sum; });   // 금액 큰 순
      var _open = false;
      try { _open = localStorage.getItem(REV_IND_KEY) === '1'; } catch (e) {}
      var rows = indKeys.map(function (k) {
        var v = byInd[k];
        var _vi = v.icon ? ((window.Profiles && Profiles.iconHtml) ? Profiles.iconHtml(v.icon, 15) : v.icon) : '';
        return '<div class="cal-rev-ind-row">' +
                 '<span class="cal-rev-ind-ic">' + _vi + '</span>' +
                 '<span class="cal-rev-ind-nm">' + _escH(k) + '</span>' +
                 '<span class="cal-rev-ind-ct">' + v.cnt + '건</span>' +
                 '<span class="cal-rev-ind-sum">' + _fmtWon(v.sum) + '</span>' +
               '</div>';
      }).join('');
      indHtml =
        '<button type="button" class="cal-rev-ind-toggle" id="calRevIndBtn">' +
          '<span>업종별 ' + indKeys.length + '개</span>' +
          '<span class="cal-rev-ind-arw">' + (_open ? '▴' : '▾') + '</span>' +
        '</button>' +
        '<div class="cal-rev-ind" id="calRevIndBox"' + (_open ? '' : ' hidden') + '>' + rows + '</div>';
    }

    el.innerHTML =
      '<div class="cal-rev-title">' + _calYear + '년 ' + (_calMonth+1) + '월 매출</div>' +
      '<div class="cal-rev-row">' +
        '<span class="cal-rev-cell cal-rev-done">수행완료<b>' + _fmtWon(done) + '</b></span>' +
        '<span class="cal-rev-cell cal-rev-pend">미수행<b>' + _fmtWon(pend) + '</b></span>' +
        '<span class="cal-rev-cell cal-rev-total">합계<b>' + _fmtWon(done+pend) + '</b></span>' +
      '</div>' + indHtml;

    // 펼침 상태는 기억한다 — 매달 다시 펼치게 하면 번거롭다
    var _btn = document.getElementById('calRevIndBtn');
    if (_btn) _btn.onclick = function () {
      var box = document.getElementById('calRevIndBox');
      if (!box) return;
      var willOpen = box.hasAttribute('hidden');
      if (willOpen) box.removeAttribute('hidden'); else box.setAttribute('hidden', '');
      var arw = _btn.querySelector('.cal-rev-ind-arw');
      if (arw) arw.textContent = willOpen ? '▴' : '▾';
      try { localStorage.setItem(REV_IND_KEY, willOpen ? '1' : '0'); } catch (e) {}
    };
  }

  /* ══════════════════════════════════════════
     날짜 상세 목록
  ══════════════════════════════════════════ */
  // doScroll: 사용자가 날짜를 '직접 눌렀을 때'만 true → 목록으로 스크롤.
  //   (백그라운드 갱신/사진 다운로드로 인한 재렌더 때는 스크롤하지 않음 → 화면이 제멋대로 내려가는 문제 방지)
  function renderDayDetail(dateStr, doScroll) {
    var panel = document.getElementById('calDetail');
    if (!panel) return;
    window._calSelectedDate = dateStr;  // + 버튼이 이 날짜로 작업 추가
    var items = (_dateMap[dateStr] || []).slice().sort(function(a,b){
      var ta=_itemStart(a), tb=_itemStart(b);
      if(ta&&tb) return ta<tb?-1:(ta>tb?1:0);
      if(ta) return -1; if(tb) return 1; return 0;
    });

    var parts  = dateStr.split('-');
    var DOW_KR = ['일','월','화','수','목','금','토'];
    var dow    = DOW_KR[new Date(+parts[0], +parts[1] - 1, +parts[2]).getDay()];
    var label  = parseInt(parts[1]) + '월 ' + parseInt(parts[2]) + '일 (' + dow + ')';

    /* ★ 2026-08-16 빈 날짜일 때, 패널이 문구 높이만큼만 그려져서
       그 아래 빈 공간에서는 좌우 스와이프(날짜 이동)가 안 먹었다.
       (스와이프 핸들러는 #calDetail 에 붙어 있는데 손가락이 패널 밖을 짚는 것)
       → 빈 상태에서는 패널을 한 화면 높이로 채워 그 영역까지 패널이 되게 한다. */
    if (!items.length) {
      panel.classList.add('cal-detail-empty');
      panel.style.minHeight = '';        // 재는 동안은 걷어둔다
      panel.innerHTML =
        '<div class="cal-detail-head">' +
          '<span class="cal-detail-date">' + label + '</span>' +
          '<span class="cal-detail-cnt">0건</span>' +
        '</div>' +
        '<div class="cal-detail-list">' +
          '<div class="cal-empty-day">이 날짜에 작업이 없습니다.<br>아래 <b>＋</b> 버튼으로 이 날짜에 작업을 추가하세요.</div>' +
        '</div>';
      panel.style.display = 'flex';
      /* ★ 채우는 높이는 '달력 + 월매출 아래 남은 화면'까지만.
         한 화면을 통째로 잡았더니 안내문이 화면 밖으로 밀려 빈 화면만 보였다(사용자 지적 2026-08-16). */
      try {
        var _b = document.getElementById('customerBody');
        if (_b) {
          var _br = _b.getBoundingClientRect(), _pr = panel.getBoundingClientRect();
          var _top = (_pr.top - _br.top) + _b.scrollTop;   // 스크롤 콘텐츠 상단 기준 패널 위치
          var _h   = (_b.clientHeight - 84) - _top;        // 하단 고정 탭바 자리는 뺀다
          panel.style.minHeight = (_h > 120 ? Math.round(_h) : 120) + 'px';
        }
      } catch (e) {}
      if (doScroll) setTimeout(function () { panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 60);
      return;
    }

    panel.classList.remove('cal-detail-empty');
    panel.style.minHeight = '';

    var cards = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.type === 'work') {
        var w        = it.data;
        var isFac    = !!(w.session && w.session.workType === 'facility');
        var _aptOv   = _ovOf(w);
        var apt      = _escH((_aptOv && _aptOv.apt) || w.apt || '작업');
        var photoCnt = w.totalPhotos ||
          (w.units || []).reduce(function (s, u) { return s + (u.beforeCount || 0) + (u.afterCount || 0); }, 0);
        var addedCnt = (window.CloudShare && CloudShare.addedPhotosOf) ? CloudShare.addedPhotosOf(w.folderName || w.workId) : 0;
        var unitNames = (w.units || []).map(function (u) { return u.name || ''; }).filter(Boolean);
        var unitInfo  = unitNames.slice(0, 2).join(', ') + (unitNames.length > 2 ? ' +' + (unitNames.length - 2) : '');
        // 전화번호: 시설은 facilityCustomer, 일반은 호수 customer 중 첫 번째
        var phone = '';
        if (isFac && w.session && w.session.facilityCustomer) phone = w.session.facilityCustomer.phone || '';
        if (!phone) { for (var pi = 0; pi < (w.units || []).length; pi++) { var cu = w.units[pi].customer; if (cu && cu.phone) { phone = cu.phone; break; } } }
        var target = _workTargetOf(w);   // ★ 2026-08-24 아젠다 줄과 한 규칙으로 통일
        cards +=
          '<div class="cust-card' + (isFac ? ' cust-card-facility' : '') + '" data-widx="' + i + '">' +
            '<div class="cw-flex">' +
              '<div class="cw-time ' + (_isWorkDone(w) ? 'cw-time-done' : 'cw-time-pending') + '">' + _indIconHtml(w) + _timeRangeHtml(w) + '</div>' +
              '<div class="cw-body">' +
                '<div class="cust-card-top">' +
                  '<span class="cust-card-name">' + (isFac ? '🏢' : '🏠') + ' ' + apt + '</span>' +
                  (unitInfo ? '<span class="cust-unit">' + _escH(unitInfo) + '</span>' : '') +
                  /* ★ 2026-08-13: 상대가 담당자를 바꾼 경우 오버라이드를 먼저 본다.
                     (로컬 _session.json 반영은 되지만 다음 폴더 스캔 전까지 w.worker 가 옛값) */
                  _workerBadge(((_ovOf(w) || {}).worker) || w.worker) +
                '</div>' +
                '<div class="cust-card-bottom">' +
                  '<div class="cust-card-info">' +
                    (target ? '<span class="cw-target">🎯 ' + _escH(target) + '</span>'
                            : '<span style="color:var(--mu);font-style:italic;">🎯 작업대상 미입력</span>') +
                    _photoCntHtml(photoCnt, addedCnt) +
                    '<span class="cw-price">💰 ' + _fmtWon(_workPrice(w)) + '</span>' +
                    _postsBadge(w) +
                  '</div>' +
                  '<div class="cust-card-actions">' +
                    '<button class="cust-card-btn cal-card-open" data-widx="' + i + '" title="작업 열기"><span class="btn-ic">📂</span><span class="btn-tx">열기</span></button>' +
                    '<button class="cust-card-btn cal-card-info" data-widx="' + i + '" title="상세 보기 / 수정"><span class="btn-ic">📄</span><span class="btn-tx">상세</span></button>' +
                    '<button class="cust-card-btn cal-card-del" data-widx="' + i + '" title="삭제"><span class="btn-ic">🗑️</span><span class="btn-tx">삭제</span></button>' +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>';
      } else if (it.type === 'shared') {
        var sw = it.data;
        var sMine = !!(window.Cloud && Cloud.user && sw.ownerUid === Cloud.user.uid);
        var sIsFac = sw.workType === 'facility';
        var sApt = _escH(sw.apt || '작업');
        var sUarr = sw.unitNames || [];
        var sUnits = sUarr.slice(0,2).join(', ') + (sUarr.length>2 ? ' +'+(sUarr.length-2) : '');
        var sTime = (sw.startTime && sw.endTime) ? (sw.startTime+'<br><span class="cw-tilde">~</span><br>'+sw.endTime) : (sw.startTime || sw.endTime || '<span class="cw-notime">–</span>');
        cards +=
          '<div class="cust-card' + (sMine ? '' : ' cust-card-shared') + '">' +
            '<div class="cw-flex">' +
              /* ★ 2026-08-08: 내 일정(가져온 작업 포함)은 내 작업 카드와 똑같은 시간칸 색을 쓴다.
                     (예전엔 sMine 이면 클래스를 아무것도 안 붙여 기본 회색톤이 나와 혼자 튀어 보였다) */
              '<div class="cw-time ' + (sMine ? (_isWorkDone(sw) ? 'cw-time-done' : 'cw-time-pending') : 'cw-time-shared') + '">' + _indIconHtml(sw) + sTime + '</div>' +
              '<div class="cw-body">' +
                '<div class="cust-card-top">' +
                  '<span class="cust-card-name">' + (sIsFac ? '🏢' : '🏠') + ' ' + sApt + '' + '</span>' +
                  (sUnits ? '<span class="cust-unit">' + _escH(sUnits) + '</span>' : '') +
                  _sharedNameBadge(sw, sMine) +
                '</div>' +
                '<div class="cust-card-bottom"><div class="cust-card-info">' +
                  (sw.target ? '<span class="cw-target">🎯 ' + _escH(sw.target) + '</span>'
                             : '<span style="color:var(--mu);font-style:italic;">🎯 작업대상 미입력</span>') +
                  _photoCntHtml(sw.totalPhotos, sw.addedPhotos) +
                  '<span class="cw-price">💰 ₩' + (sw.price||0).toLocaleString('ko-KR') + '</span>' +
                  _postsBadge(sw) +
                '</div>' +
                '<div class="cust-card-actions">' +
                  '<button class="cust-card-btn cal-shared-open" data-sidx="' + i + '" title="열기"><span class="btn-ic">📂</span><span class="btn-tx">열기</span></button>' +
                  '<button class="cust-card-btn cal-shared-edit" data-sidx="' + i + '" title="상세 보기 / 수정"><span class="btn-ic">📄</span><span class="btn-tx">상세</span></button>' +
                  _takeBtnHtml(sw, sMine, 'data-sidx', i) +
                  (sMine ? '<button class="cust-card-btn cal-shared-del" data-sidx="' + i + '" title="삭제"><span class="btn-ic">🗑️</span><span class="btn-tx">삭제</span></button>' : '<button class="cust-card-btn cal-shared-hide" data-hidekey="' + _escH(_shHideKey(sw)) + '" title="내 달력에서 숨기기"><span class="btn-ic">🚫</span><span class="btn-tx">숨기기</span></button>') +
                '</div>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>';
      } else if (it.type === 'reminder') {
        var rm = it.data;
        var rDone = !!rm._done;
        var rTime = rm.time ? rm.time : '<span class="cw-notime">–</span>';
        cards +=
          '<div class="cust-card cal-rem-card' + (rDone ? ' cal-rem-done' : '') + '">' +
            '<div class="cw-flex">' +
              '<div class="cw-time cw-time-rem">' + rTime + '</div>' +
              '<div class="cw-body">' +
                '<div class="cust-card-top">' +
                  '<span class="cust-card-name">🔔 ' + _escH(rm.title || '리마인더') + '</span>' +
                  /* ★ 2026-08-17 기간 리마인더는 며칠짜리인지 보여준다 */
                  (rm.endDate && rm.endDate > rm.date
                    ? '<span class="cust-unit">' + _escH(_mdLabel(rm.date) + '~' + _mdLabel(rm.endDate)) + '</span>' : '') +
                  (rm.repeat && rm.repeat !== 'none'
                    ? '<span class="cust-unit">' + _escH(Reminders.repeatLabel(rm.repeat)) + '</span>' : '') +
                '</div>' +
                '<div class="cust-card-bottom"><div class="cust-card-info">' +
                  (rm.memo ? '<span class="cw-target">📝 ' + _escH(rm.memo) + '</span>' : '') +
                  '<span>' + (typeof rm.lead === 'number' && rm.lead >= 0
                      ? '⏰ ' + _escH(Reminders.leadLabel(rm.lead)) : '🔕 알림 없음') + '</span>' +
                '</div>' +
                '<div class="cust-card-actions">' +
                  '<button class="cust-card-btn cal-rem-done-btn" data-rid="' + _escH(rm._srcId) + '" data-rocc="' + _escH(rm._occDate) + '" title="' + (rDone ? '완료 취소' : '완료') + '">' +
                    '<span class="btn-ic">' + (rDone ? '↩️' : '✅') + '</span><span class="btn-tx">' + (rDone ? '취소' : '완료') + '</span></button>' +
                  '<button class="cust-card-btn cal-rem-edit" data-rid="' + _escH(rm._srcId) + '" title="상세/수정"><span class="btn-ic">📄</span><span class="btn-tx">상세</span></button>' +
                '</div>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>';
      } else if (it.type === 'customer') {
        var c    = it.data;
        var capt = c.visits && c.visits[0] ? _escH(c.visits[0].apt || '') : '';
        cards +=
          '<div class="cal-work-card cal-cust-card">' +
            '<div class="cal-work-dot-col"><span class="cal-dot cal-dot-cust" style="width:8px;height:8px;"></span></div>' +
            '<div class="cal-work-info">' +
              '<div class="cal-work-apt">👤 ' + _escH(c.name || c.phone || '') + '</div>' +
              (capt ? '<div class="cal-work-units">📍 ' + capt + '</div>' : '') +
              '<div class="cal-work-meta">방문 ' + (c.visitCount || 1) + '회 · ' +
                _escH(c.phone || '') + '</div>' +
            '</div>' +
          '</div>';
      }
    }

    panel.innerHTML =
      '<div class="cal-detail-head">' +
        '<span class="cal-detail-date">' + label + '</span>' +
        '<span class="cal-detail-cnt">' + items.length + '건</span>' +
      '</div>' +
      '<div class="cal-detail-list">' + cards + '</div>';
    panel.style.display = 'flex';

    /* ★ 카드 버튼(열기/정보/삭제): 패널 갱신 때마다 새 노드에 직접 바인딩 */
    panel.querySelectorAll('.cal-card-open').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        openWorkFromCalendar(items[parseInt(btn.getAttribute('data-widx'))]);
      });
    });
    panel.querySelectorAll('.cal-card-info').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        openWorkEdit(items[parseInt(btn.getAttribute('data-widx'))]);
      });
    });
    panel.querySelectorAll('.cal-card-del').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteWorkFromCalendar(items[parseInt(btn.getAttribute('data-widx'))]);
      });
    });
    panel.querySelectorAll('.cal-shared-open').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var it = items[parseInt(btn.getAttribute('data-sidx'))];
        if (!it || it.type !== 'shared') return;
        var d = it.data;
        if (window.CloudPhotoSync && CloudPhotoSync.openInWorkTab) {
          CloudPhotoSync.openInWorkTab(d.ownerUid || d.partnerUid, d.workId, d);
        }
      });
    });
    panel.querySelectorAll('.cal-shared-edit').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var it = items[parseInt(btn.getAttribute('data-sidx'))];
        if (!it || it.type !== 'shared') return;   // ★ 통합 후 CloudShare.openEdit 의존 없음
        openWorkEdit(it);   // ★ 2026-08-13 통합 — 공유 일정도 같은 '작업 정보' 창을 쓴다
      });
    });
    // 리마인더 완료/상세
    panel.querySelectorAll('.cal-rem-done-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (window.Reminders) Reminders.toggleDone(btn.getAttribute('data-rid'), btn.getAttribute('data-rocc'));
      });
    });
    panel.querySelectorAll('.cal-rem-edit').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        window.openReminderEdit(null, btn.getAttribute('data-rid'));
      });
    });
    _bindTakeButtons(panel, function(ix){ return items[ix]; }, 'data-sidx', function(){ if (window.__calendarRefresh) window.__calendarRefresh(); });
    panel.querySelectorAll('.cal-shared-del').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var it = items[parseInt(btn.getAttribute('data-sidx'))];
        if (!it || it.type !== 'shared') return;
        var d = it.data;
        if (!confirm('🗑 공유 휴지통으로 이동할까요? (설정에서 복원할 수 있습니다)')) return;
        if (window.CloudShare && CloudShare.deleteSchedule) {
          CloudShare.deleteSchedule(d.workId, d.manual).then(function () {
            if (window.__calendarRefresh) window.__calendarRefresh();
          }).catch(function () {});
        }
      });
    });

    if (doScroll) setTimeout(function () {
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  }

  function hideDayDetail() {
    var p = document.getElementById('calDetail');
    if (p) p.style.display = 'none';
    window._calSelectedDate = null;
  }

  /* ══════════ 작업 정보 수정 (작업대상/가격/시간) ══════════ */
  // 폴더 내용 재귀 복사 (_session.json 제외 - 최신본은 따로 기록)
  async function _copyDirRecursive(srcDir, dstDir) {
    for await (var entry of srcDir.values()) {
      if (entry.kind === 'file') {
        if (entry.name === '_session.json') continue;
        var f = await entry.getFile();
        var fh = await dstDir.getFileHandle(entry.name, { create: true });
        var wr = await fh.createWritable();
        await wr.write(f);
        await wr.close();
      } else if (entry.kind === 'directory') {
        var sub = await dstDir.getDirectoryHandle(entry.name, { create: true });
        await _copyDirRecursive(entry, sub);
      }
    }
  }

  // ★ 작업자 텍스트 입력을 공유사용자 닉네임 select로 전환 (로그인+공유상대 있을 때만)
  function _workerComboify(inputId) {
    try {
      if (!window.CloudShare || !CloudShare.getWorkerNames) return;
      var names = CloudShare.getWorkerNames();
      if (!names || !names.length) return;
      var inp = document.getElementById(inputId);
      if (!inp || inp._comboified) return;
      inp._comboified = true;
      var cur = inp.value || '';
      var sel = document.createElement('select');
      sel.className = 'cust-inp';
      sel.style.cssText = 'width:100%;margin-top:4px;';
      var opts = '<option value="">👤 작업자 선택</option>' +
        names.map(function (n) { return '<option value="' + _escH(n) + '">' + _escH(n) + '</option>'; }).join('');
      if (cur && names.indexOf(cur) < 0) opts += '<option value="' + _escH(cur) + '">' + _escH(cur) + '</option>';
      sel.innerHTML = opts;
      sel.value = cur;
      inp.style.display = 'none';
      inp.parentNode.insertBefore(sel, inp.nextSibling);
      sel.addEventListener('change', function () { inp.value = sel.value; });
    } catch (e) {}
  }

  /* ★ 2026-08-13 통합 — '작업 정보'와 '공유 일정 정보' 두 창이 거의 같은 항목을
       따로 보여주고 있었다. 이제 이 창 하나로 둘 다 처리한다.
       화면은 같고 저장 경로만 갈라진다.
         · 내 로컬 작업(type:'work')  → _session.json 직접 쓰기 (기존 동작 그대로)
         · 상대 작업(type:'shared')   → CloudShare.editItem 으로 클라우드 문서 수정
       상대 작업도 날짜·담당자·고객정보를 고칠 수 있게 된다.
       (예전 '공유 일정 정보' 창엔 날짜 칸이 아예 없어 공유작업자가 일정을 못 옮겼다)
       사진과 호수 구조는 원작업자 쪽에 있으므로 여기서 건드리지 않는다. */
  async function openWorkEdit(item, afterSaved) {
    if (!item || !item.data) return;
    var isShared = (item.type === 'shared');
    if (!isShared && item.type !== 'work') return;
    var w = item.data;

    var sess = null, isFac = false, fc = {}, u0 = {};
    var curName, curTarget, curPhone, curAddr, curMemo, curPrice, curStart, curEnd;
    var curDate, curWorker, curUnit, curEndDate;
    var curProfileId = '', curProfileSnap = null;
    var sharedUnits = [], multiUnit = false;

    if (isShared) {
      if (!w.workId || !(w.ownerUid || w.partnerUid)) {
        if (typeof showToast === 'function') showToast('이 일정은 수정할 수 없습니다', 'err');
        return;
      }
      isFac       = (w.workType === 'facility');
      sharedUnits = w.unitNames || [];
      multiUnit   = sharedUnits.length > 1;
      curName     = w.name || '';
      curTarget   = w.target || '';
      curPhone    = w.phone || '';
      curAddr     = w.address || '';
      curMemo     = w.memo || '';
      curPrice    = (w.price ? w.price : '');   // 공유 요약은 미입력도 0으로 오므로 0은 빈칸 취급
      curStart    = w.startTime || '';
      curEnd      = w.endTime || '';
      curDate     = w.date || '';
      curWorker   = w.worker || '';
      curUnit     = isFac ? '' : (multiUnit ? sharedUnits.join(', ') : (sharedUnits[0] || ''));
      curEndDate  = w.endDate || '';
      curProfileId = w.profileId || '';
      curProfileSnap = (w.profileIcon || w.profileName)
        ? { icon: w.profileIcon || '', name: w.profileName || '' } : null;
    } else {
      // ★ localStorage 캐시로 그려진 항목: 실제 _session.json을 다시 읽은 뒤에만 수정 허용
      //   (슬림 세션으로 저장하면 사진 메타가 날아가므로 절대 금지)
      if (w._slim) {
        try {
          if (!w.dirHandle && w.folderName && typeof photoFolderHandle !== 'undefined' && photoFolderHandle) {
            w.dirHandle = await photoFolderHandle.getDirectoryHandle(w.folderName);
          }
          var _sf = await w.dirHandle.getFileHandle('_session.json');
          var _sd = JSON.parse(await (await _sf.getFile()).text());
          w.session = _sd;
          if (_sd.units) w.units = _sd.units;
          w._slim = false;
        } catch (e) {
          if (typeof showToast === 'function') showToast('작업 정보를 아직 불러오는 중입니다. 잠시 후 다시 시도해주세요', 'err');
          return;
        }
      }
      if (!w.dirHandle) { if (typeof showToast === 'function') showToast('이 작업은 폴더를 찾을 수 없어 수정할 수 없습니다', 'err'); return; }
      sess = w.session || (w.session = {});
      isFac = (sess.workType === 'facility') || w.workType === 'facility';
      fc = sess.facilityCustomer || {};
      u0 = (w.units && w.units[0] && w.units[0].customer) ? w.units[0].customer : {};
      curName    = isFac ? (fc.contact || '')    : (u0.name || '');
      curTarget  = isFac ? (fc.workTarget || '') : (u0.workTarget || '');
      curPhone   = isFac ? (fc.phone || '')      : (u0.phone || '');
      curAddr    = isFac ? (fc.address || '')    : (u0.address || '');
      curMemo    = isFac ? (fc.memo || '')       : (u0.memo || '');
      curPrice   = isFac ? (fc.price || '')      : (u0.price || '');
      curStart   = isFac ? (fc.startTime || '')  : (u0.startTime || '');
      curEnd     = isFac ? (fc.endTime || '')    : (u0.endTime || '');
      curDate    = w.date || sess.date || '';
      curWorker  = sess.worker || w.worker || '';
      curUnit    = (!isFac && w.units && w.units[0]) ? (w.units[0].name || '') : '';
      curEndDate = (sess && sess.endDate) || '';
      curProfileId = (sess && sess.profileId) || '';
      curProfileSnap = (sess && sess.profileSnap) || null;
    }

    var aptUnitRow;
    if (isFac) {
      aptUnitRow = '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">작업명(현장)</label>' +
        '<input class="cust-inp" id="weApt" type="text" value="' + _escH(w.apt || '') + '" placeholder="예: ○○빌딩" style="width:100%;margin-top:4px;"></div>';
    } else {
      /* 상대 작업이 여러 호수면 입력칸을 잠근다. 한 칸으로 받으면 저장할 때
         호수 목록이 1개로 접혀 나머지가 사라진다(예전 공유 일정 창의 문제). */
      var _unitLocked = isShared && multiUnit;
      aptUnitRow = '<div style="display:flex;gap:8px;">' +
        '<div style="flex:2;"><label style="font-size:12px;color:var(--mu);font-weight:700;">작업명(현장)</label>' +
          '<input class="cust-inp" id="weApt" type="text" value="' + _escH(w.apt || '') + '" placeholder="예: ○○아파트 101동" style="width:100%;margin-top:4px;"></div>' +
        '<div style="flex:1;"><label style="font-size:12px;color:var(--mu);font-weight:700;">동호수' +
          (_unitLocked ? ' <span style="font-weight:400;">(여러 개)</span>' : '') + '</label>' +
          '<input class="cust-inp" id="weUnit" type="text" value="' + _escH(curUnit) + '"' +
            (_unitLocked ? ' readonly title="호수가 여러 개입니다 — 작업탭에서 열어 수정하세요" style="width:100%;margin-top:4px;opacity:.6;"'
                         : ' placeholder="예: 101동 502호" style="width:100%;margin-top:4px;"') + '></div>' +
      '</div>';
    }

    var _sharedWho = '';
    if (isShared) {
      try {
        var _pf = (window.CloudShare && CloudShare.profileOf) ? CloudShare.profileOf(w.ownerUid) : null;
        _sharedWho = (_pf && _pf.name) || w.partnerName || '';
      } catch (e) {}
    }
    var _subTitle = _escH(w.apt || '작업') +
      (isShared ? ' <span style="color:var(--ac,#6cf);font-weight:700;">· 공유' + (_sharedWho ? ' (' + _escH(_sharedWho) + ')' : '') + '</span>' : '');

    var html =
      '<div style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:1760;display:flex;align-items:center;justify-content:center;padding:16px;" id="workEditOverlay">' +
        '<div style="background:var(--sf);border-radius:14px;padding:20px;max-width:460px;width:100%;max-height:calc(100vh - 44px);overflow-y:auto;-webkit-overflow-scrolling:touch;">' +
          '<div style="font-size:16px;font-weight:800;margin-bottom:4px;">📄 작업 정보</div>' +
          '<div style="font-size:12px;color:var(--mu);margin-bottom:14px;">' + _subTitle + '</div>' +
          (isShared ? '<div style="font-size:11px;color:var(--mu);background:var(--sf2,#2a2f36);border-radius:8px;padding:8px 10px;margin-bottom:12px;line-height:1.6;">여기서 고친 내용은 상대에게도 반영됩니다. 사진과 호수 구성은 원작업자 쪽에 있어 작업탭에서만 다룹니다.</div>' : '') +
          '<div style="display:flex;flex-direction:column;gap:10px;">' +
            '<div style="display:flex;gap:8px;">' +
              '<div style="flex:1;"><label style="font-size:12px;color:var(--mu);font-weight:700;">작업일자</label>' +
                '<input class="cust-inp" id="weDate" type="date" value="' + _escH(curDate) + '" style="width:100%;margin-top:4px;"></div>' +
              '<div style="flex:1;"><label style="font-size:12px;color:var(--mu);font-weight:700;">' + (isShared ? '담당자' : '작업자') + '</label>' +
                '<input class="cust-inp" id="weWorker" type="text" value="' + _escH(curWorker) + '" placeholder="담당자" style="width:100%;margin-top:4px;"></div>' +
            '</div>' +
            aptUnitRow +
            /* ★ 2026-08-16 업종 — 상대 작업이면 상대 업종이 첫 줄에 그대로 보인다(바꾸면 상대에게도 반영) */
            /* ⭐ 사본(curProfileSnap)을 같이 넘긴다 — id 는 폰마다 달라서, 이름이 같은 내 업종으로
                 맞춰 골라주려면 사본이 있어야 한다. 없으면 '(상대 업종)' 으로 잠긴다. */
            ((window.ProfilesUI && ProfilesUI.selectHtml) ? ProfilesUI.selectHtml('weProfile', curProfileId, '업종', curProfileSnap) : '') +
            '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">고객명 <span style="font-weight:400;">(선택)</span></label>' +
              '<input class="cust-inp" id="weName" type="text" value="' + _escH(curName) + '" placeholder="예: 홍길동" style="width:100%;margin-top:4px;"></div>' +
            '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">작업대상</label>' +
              '<input class="cust-inp" id="weTarget" type="text" value="' + _escH(curTarget) + '" placeholder="예: 벽걸이 2대" style="width:100%;margin-top:4px;"></div>' +
            '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">전화번호</label>' +
              '<input class="cust-inp" id="wePhone" type="text" inputmode="tel" value="' + _escH(curPhone) + '" placeholder="010-1234-5678" style="width:100%;margin-top:4px;"></div>' +
            '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">주소</label>' +
              '<input class="cust-inp" id="weAddr" type="text" value="' + _escH(curAddr) + '" placeholder="주소" style="width:100%;margin-top:4px;"></div>' +
            '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">가격 (원)</label>' +
              '<input class="cust-inp" id="wePrice" type="text" inputmode="numeric" value="' + _escH(String(curPrice)) + '" placeholder="예: 120000" style="width:100%;margin-top:4px;"></div>' +
            '<div style="display:flex;gap:8px;">' +
              '<div style="flex:1;"><label style="font-size:12px;color:var(--mu);font-weight:700;">시작시간</label>' +
                '<input class="cust-inp" id="weStart" type="time" value="' + _escH(curStart) + '" style="width:100%;margin-top:4px;"></div>' +
              '<div style="flex:1;"><label style="font-size:12px;color:var(--mu);font-weight:700;">종료시간</label>' +
                '<input class="cust-inp" id="weEnd" type="time" value="' + _escH(curEnd) + '" style="width:100%;margin-top:4px;"></div>' +
            '</div>' +
            '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">종료일 <span style="font-weight:400;">(여러 날 작업일 때만 — 비우면 당일 완료)</span></label>' +
              '<input class="cust-inp" id="weEndDate" type="date" value="' + _escH(curEndDate) + '" style="width:100%;margin-top:4px;"></div>' +
            '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">메모</label>' +
              '<textarea class="cust-memo" id="weMemo" rows="2" placeholder="메모" style="width:100%;margin-top:4px;">' + _escH(curMemo) + '</textarea></div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">' +
            '<button class="btn b-blue" id="weSave" style="flex:2;min-width:96px;">저장</button>' +
            '<button class="btn b-ghost" id="weDup" style="flex:2;min-width:110px;" title="같은 내용으로 오늘 날짜 작업 만들기">📑 복제</button>' +
            '<button class="btn b-ghost" id="weCancel" style="flex:1;min-width:64px;">취소</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    var wrap = document.createElement('div'); wrap.innerHTML = html;
    document.body.appendChild(wrap.firstElementChild);
    try { if (window.ProfilesUI && ProfilesUI.bindSelect) ProfilesUI.bindSelect('weProfile'); } catch (e) {}
    try {   // ★ 작업자 비어 있으면 기본값 미리 채움 (콤보 변환 전에)
      var _dwEl = document.getElementById('weWorker');
      if (_dwEl && !(_dwEl.value || '').trim() && window.WorkerCombo && WorkerCombo.defaultName) {
        var _dwN = WorkerCombo.defaultName();
        if (_dwN) _dwEl.value = _dwN;
      }
    } catch (e) {}
    _workerComboify('weWorker');  // ★ 공유 닉네임 콤보
    var close = function () { var o = document.getElementById('workEditOverlay'); if (o) o.remove(); };
    document.getElementById('weCancel').addEventListener('click', close);
    /* ★ 2026-08-08 복제 — 같은 고객/현장을 다시 방문할 때 매번 다시 입력하는 수고를 없앤다.
         · 저장된 값이 아니라 '지금 화면에 있는 값'을 복사한다(고쳐놓고 복제하는 경우가 자연스러움).
         · 사진은 복사하지 않는다(새 작업이므로 새로 찍는 게 맞다).
         · 바로 만들지 않고 '일정 추가' 폼을 오늘 날짜로 채워서 띄운다.
           날짜·시간을 확인하고 저장하게 해야 실수로 중복 작업이 쌓이지 않는다.
         · 상대 작업에서 눌러도 안전하다 — 원본은 그대로 두고 내 작업을 새로 만든다. */
    document.getElementById('weDup').addEventListener('click', function () {
      var gv = function (id) { var el = document.getElementById(id); return el ? (el.value || '') : ''; };
      var pf = {
        apt: gv('weApt'),
        unit: (isShared && multiUnit) ? '' : gv('weUnit'),
        worker: gv('weWorker'),
        name: gv('weName'),
        target: gv('weTarget'),
        phone: gv('wePhone'),
        address: gv('weAddr'),
        price: gv('wePrice'),
        startTime: gv('weStart'),
        endTime: gv('weEnd'),
        memo: gv('weMemo'),
        // ★ 2026-08-16 업종도 물려준다. 같은 현장을 다시 가는 복제인데 업종만 현재 값으로 바뀌면 어색하다
        profileId: (window.ProfilesUI && ProfilesUI.pickedId) ? ProfilesUI.pickedId('weProfile') : ''
      };
      close();
      if (typeof window.openQuickWorkAdd === 'function') {
        window.openQuickWorkAdd(_today, pf);
        if (typeof showToast === 'function') showToast('📑 오늘 날짜로 복제했어요 — 확인 후 저장하세요', 'ok');
      } else if (typeof showToast === 'function') {
        showToast('복제 기능을 사용할 수 없습니다', 'err');
      }
    });
    document.getElementById('weSave').addEventListener('click', async function () {
      var nm = document.getElementById('weName').value.trim();
      var t  = document.getElementById('weTarget').value.trim();
      var ph = document.getElementById('wePhone').value.trim();
      var ad = document.getElementById('weAddr').value.trim();
      var mm = document.getElementById('weMemo').value.trim();
      var pr = document.getElementById('wePrice').value.trim();
      var st = document.getElementById('weStart').value;
      var et = document.getElementById('weEnd').value;
      var ap = document.getElementById('weApt').value.trim();
      var nd = document.getElementById('weDate').value || curDate;
      var nw = document.getElementById('weWorker').value.trim();
      var nu = (!isFac && document.getElementById('weUnit')) ? document.getElementById('weUnit').value.trim() : '';
      var nEndD = (document.getElementById('weEndDate') && document.getElementById('weEndDate').value) || '';
      if (!nw) { if (typeof showToast === 'function') showToast('작업자를 선택해주세요', 'err'); try { document.getElementById('weWorker').focus(); } catch (e) {} return; }
      if (nEndD && nd && nEndD <= nd) nEndD = '';  // 당일/이전이면 단일 작업으로

      /* ── 상대 작업: 클라우드 문서만 고친다 ── */
      if (isShared) {
        /* ⚠️ 다른 '달'로는 옮길 수 없다.
           원작업자 폴더 이름이 YYYY-MM-DD_... 이고 달력 스캔이 그 폴더명 기준으로
           그 달 폴더만 읽는다. 날짜만 다른 달로 바꾸면 원작업자 화면에서 그 작업이
           통째로 안 보이게 된다(폴더 이름은 옛 달, 내용 날짜는 새 달).
           폴더 이름 변경은 사진을 통째로 복사해야 해서 자동으로 하지 않는다. */
        /* 단, 로컬 폴더가 없는 '수동 일정'(m_*)은 이 제약이 없다 — 옮길 폴더 자체가 없다.
           사진 없는 예약 일정을 다음 달로 미루는 건 가장 흔한 조작이라 막으면 안 된다. */
        var _hasFolder = !w.manual && String(w.workId || '').indexOf('m_') !== 0;
        if (_hasFolder && nd && curDate && String(nd).slice(0, 7) !== String(curDate).slice(0, 7)) {
          if (typeof showToast === 'function') showToast('사진이 있는 공유 작업은 같은 달 안에서만 날짜를 옮길 수 있습니다', 'err');
          return;
        }
        var fields = {
          apt: ap,
          worker: nw,
          name: nm,
          target: t,
          phone: ph,
          address: ad,
          price: pr === '' ? 0 : (parseInt(String(pr).replace(/[^0-9]/g, ''), 10) || 0),
          startTime: st,
          endTime: et,
          memo: mm,
          date: nd || curDate,
          endDate: nEndD
        };
        /* ★ 2026-08-16 업종. 바뀌었을 때만 보낸다(안 건드린 작업의 해시를 흔들지 않게).
             아이콘·이름을 같이 보내는 이유: 상대 폰엔 내 프로필 목록이 없어 id 만으론 못 그린다. */
        try {
          var _wePid = (window.ProfilesUI && ProfilesUI.pickedId) ? ProfilesUI.pickedId('weProfile') : '';
          /* 비교 기준을 '내 업종으로 맞춰진 id' 로 바꾼다. 상대 폰 id 와 그대로 비교하면
             같은 업종인데도 늘 '바뀜'으로 보여 불필요한 쓰기가 계속 나간다. */
          var _weCur = curProfileId;
          try {
            if (window.Profiles && Profiles.ownOf) {
              var _weOwn = Profiles.ownOf({ profileId: curProfileId, profileSnap: curProfileSnap });
              if (_weOwn) _weCur = _weOwn.id;
            }
          } catch (e9) {}
          if (_wePid && _wePid !== _weCur) {
            var _weSnap = window.Profiles ? Profiles.snapOf(_wePid) : null;
            if (_weSnap) {
              fields.profileId = _wePid;
              /* ⚠️ 이름·아이콘만 보내면 상대 쪽엔 보고서 제목·호수/단계 호칭이 옛 업종 것으로 남는다
                   (조명 아이콘인데 표지는 "에어컨 청소 보고서"). 스냅샷을 통째로 보낸다. */
              fields.profileSnap = _weSnap;
              fields.profileIcon = _weSnap.icon || '';   // 카드 렌더용 평면 필드(toCalItem)
              fields.profileName = _weSnap.name || '';
            }
          }
        } catch (e) {}
        // 호수는 1개짜리일 때만 보낸다 (여러 개면 접혀서 사라짐 — 위 입력칸도 잠가 뒀다)
        if (!isFac && !multiUnit) fields.unit = nu;
        close();
        if (!(window.CloudShare && CloudShare.editItem)) {
          if (typeof showToast === 'function') showToast('공유 기능을 불러오지 못했습니다', 'err');
          return;
        }
        CloudShare.editItem(w.ownerUid || w.partnerUid, w.workId, fields)
          .then(function () {
            /* 검색 결과에서 열었으면 검색을 다시 돌려야 한다. __calendarRefresh 는
               같은 #calDetail 영역을 '선택 날짜 목록'으로 덮어써 검색 결과가 날아간다. */
            if (typeof afterSaved === 'function') afterSaved();
            else if (window.__calendarRefresh) window.__calendarRefresh();
          })
          .catch(function (err) {
            /* ★ 2026-08-13: 예전엔 지나가는 토스트뿐이라, 저장이 서버에서 거부돼도
               '저장됐는데 반영이 안 된다'로 보였다(창은 이미 닫힌 뒤라 더 헷갈린다).
               실패했을 때만 사유를 확실히 띄운다. 성공하면 아무것도 안 뜬다. */
            var code = (err && (err.code || err.message)) || '알 수 없음';
            var msg = '⚠️ 저장하지 못했습니다\n\n사유: ' + code + '\n';
            if (String(code).indexOf('permission-denied') >= 0) {
              msg += '\n서버(Firestore) 규칙이 이 수정을 막고 있습니다.\n' +
                     '공유 상대가 고칠 수 있는 항목에 작업자·날짜가 빠져 있을 수 있습니다.';
            } else if (String(code).indexOf('not-found') >= 0) {
              msg += '\n원본 일정을 서버에서 찾지 못했습니다.';
            } else if (String(code).indexOf('unavailable') >= 0) {
              msg += '\n서버에 연결하지 못했습니다. 통신 상태를 확인해주세요.';
            }
            try { alert(msg); } catch (e6) {}
          });
        return;
      }

      /* ── 내 로컬 작업: _session.json 에 직접 쓴다 (기존 동작) ── */
      try {
        if (typeof showOverlay === 'function') showOverlay('저장 중...');
        var tc;
        if (isFac) { sess.facilityCustomer = sess.facilityCustomer || {}; tc = sess.facilityCustomer; }
        else { if (!sess.units) sess.units = []; if (!sess.units[0]) sess.units[0] = {}; sess.units[0].customer = sess.units[0].customer || {}; tc = sess.units[0].customer; }
        tc.workTarget = t; tc.phone = ph; tc.address = ad; tc.memo = mm;
        tc.price = pr; tc.startTime = st; tc.endTime = et;
        if (isFac) tc.contact = nm; else tc.name = nm;   // ★ 2026-08-30 고객명(공용시설은 담당자 필드 재사용)
        if (ap) { sess.apt = ap; w.apt = ap; }
        sess.worker = nw;
        /* ★ 2026-08-16 업종을 _session.json 에 새긴다. 스냅샷도 같이 —
             나중에 업종 이름을 바꾸거나 목록에서 빼도 이 작업의 보고서는 그대로 나와야 한다. */
        try {
          var _wePid2 = (window.ProfilesUI && ProfilesUI.pickedId) ? ProfilesUI.pickedId('weProfile') : '';
          if (_wePid2) {
            sess.profileId = _wePid2;
            if (window.Profiles) sess.profileSnap = Profiles.snapOf(_wePid2) || sess.profileSnap || null;
          }
        } catch (e) {}
        if (!isFac && nu && sess.units && sess.units[0]) { sess.units[0].name = nu; if (w.units && w.units[0]) w.units[0].name = nu; }
        var oldName = w.dirHandle.name;
        var _moveWarn = '';   // ★ 옛 폴더를 못 지웠을 때 사용자에게 알릴 말
        var dateChanged = !!(nd && nd !== (sess.date || w.date || ''));
        sess.date = nd; w.date = nd;
        sess.endDate = nEndD; w.endDate = nEndD;
        var targetDir = w.dirHandle;
        var newName = oldName;
        if (dateChanged && typeof photoFolderHandle !== 'undefined' && photoFolderHandle) {
          var m = oldName.match(/^\d{4}-\d{2}-\d{2}(_.*)?$/);
          var suffix = (m && m[1]) ? m[1] : ('_' + Date.now());
          var base = nd + suffix, cand = base, n = 1;
          while (n < 50) { try { await photoFolderHandle.getDirectoryHandle(cand); cand = base + '-' + (++n); } catch (e) { break; } }
          newName = cand;
          var newDir = await photoFolderHandle.getDirectoryHandle(newName, { create: true });
          await _copyDirRecursive(w.dirHandle, newDir);
          targetDir = newDir;
          if (sess.workId === oldName) sess.workId = newName;
        }
        var fh = await targetDir.getFileHandle('_session.json', { create: true });
        var wr = await fh.createWritable();
        await wr.write(new Blob([JSON.stringify(sess, null, 2)], { type: 'application/json' }));
        await wr.close();
        if (dateChanged && newName !== oldName && typeof photoFolderHandle !== 'undefined' && photoFolderHandle) {
          try { await photoFolderHandle.removeEntry(oldName, { recursive: true }); } catch (e) {}

          /* ★ 2026-08-30 옛 폴더가 정말 사라졌는지 눈으로 확인한다.
               native-fs 의 removeEntry 는 안에서 모든 오류를 삼켜서 실패해도 조용하다.
               남아 있으면 같은 작업이 옛 날짜·새 날짜 두 곳에 보인다. */
          var _oldGone = false;
          try { await photoFolderHandle.getDirectoryHandle(oldName); } catch (e) { _oldGone = true; }
          if (!_oldGone) _moveWarn = '날짜는 바뀌었지만 예전 폴더를 지우지 못했습니다. 같은 작업이 두 날짜에 보일 수 있어요';

          /* ★ 열려 있는 작업이 바로 이 작업이면 폴더 이름을 새 것으로 갈아 끼운다.
               ⚠️ 순서가 중요하다 — 아래 purge 안의 clearIfCurrent 가 옛 이름과 맞으면
                  작업 화면을 통째로 비운다. 먼저 바꿔두면 화면이 유지되고,
                  옛 이름으로 저장해 지운 폴더가 되살아나는 것도 막는다. */
          try { if (typeof currentFolderName !== 'undefined' && currentFolderName === oldName) currentFolderName = newName; } catch (e) {}

          /* ★★ 2026-08-30 버그수정 — '날짜를 바꿔도 옛 날짜에 그대로 남는다' 의 원인.
               날짜 변경은 사실상 '새 폴더 생성 + 옛 폴더 삭제' 인데 뒷정리가 반쪽이었다.
               예전엔 scheduleIndexDelete 하나만 불러서, 옛 폴더 이름이
                 · 달력 월별 localStorage 캐시(calCache_YYYY-MM)  ← 화면에 계속 보이던 주범
                 · 작업 인덱스(removeFromWorkIndex / invalidateWorkIndex)
                 · 고객 캐시(invalidateCustomersCache / V2)
                 · 자동백업 거울(안 지우면 복원 때 되살아남)
               에 그대로 남았다.
               [[삭제 뒷정리는 purgeWorkEverywhere 한 곳에서]] 규칙을 이 경로만 안 따르고 있었다.
               ⚠️ cloud:false — 옮긴 것이지 버린 게 아니다. true 면 공유 상대 쪽에서 사라진다. */
          try {
            if (typeof window.purgeWorkEverywhere === 'function') await window.purgeWorkEverywhere(oldName, { cloud: false });
            else if (typeof scheduleIndexDelete === 'function') scheduleIndexDelete(oldName);
          } catch (e) {
            try { if (typeof scheduleIndexDelete === 'function') scheduleIndexDelete(oldName); } catch (e2) {}
          }

          w.dirHandle = targetDir; w.folderName = newName; item.data.folderName = newName;
        }
        try {
          if (typeof scheduleIndexUpdate === 'function' && typeof sessionToIndexEntry === 'function') {
            var ie = sessionToIndexEntry(w.folderName || newName, sess);
            if (ie) scheduleIndexUpdate(ie);
          }
        } catch (e) {}
        close();
        _monthCache = {};
        if (typeof invalidateRecordsCache === 'function') invalidateRecordsCache();
        await loadCalendarData();
        if (typeof hideOverlay === 'function') hideOverlay();
        if (typeof showToast === 'function') showToast(_moveWarn || '✓ 작업 정보 저장됨', _moveWarn ? 'err' : 'ok');
      } catch (e) {
        if (typeof hideOverlay === 'function') hideOverlay();
        if (typeof showToast === 'function') showToast('저장 실패: ' + (e && e.message), 'err');
      }
    });
  }

  /* ══════════════════════════════════════════
     작업 삭제 (달력 카드 🗑️)
  ══════════════════════════════════════════ */
  /* ═══════════════════════════════════════════════════════════
     작업 하나를 '앱 전체에서' 지우는 뒷정리 (2026-08-13 신설)

     왜 만들었나:
       작업을 지울 때 비워야 할 캐시·인덱스·백업이 9종인데, 그 호출이 삭제 경로
       5곳에 흩어져 있어 경로마다 빠진 항목이 제각각이었다. 실제로 같은 원인의
       '고객 방문기록 유령카드'가 두 번 재발했고(2026-08-09 가져가기 경로,
       2026-08-13 달력 삭제 경로), 점검해보니 고객화면 삭제는 작업 인덱스와
       자동백업 거울 정리까지 빠져 있었다(복원 시 부활 위험).

     이제 삭제 경로는 '폴더를 지우는 일'만 하고 뒷정리는 전부 이 함수에 맡긴다.
     앞으로 정리 대상이 늘면 여기 한 곳에만 추가하면 된다.

     opts.cloud  = true  → 클라우드 항목도 휴지통 처리(사용자가 직접 지운 경우)
                   false → 클라우드는 건드리지 않음(가져가기로 넘어간 원본 등)
     opts.xlsx   = true  → 고객 엑셀 파일도 갱신(고객 화면에서 지운 경우)
  ═══════════════════════════════════════════════════════════ */
  window.purgeWorkEverywhere = async function (workId, opts) {
    if (!workId) return;
    opts = opts || {};
    // ── 인덱스 ──
    try { if (typeof scheduleIndexDelete === 'function') scheduleIndexDelete(workId); } catch (e) {}
    try { if (typeof window.removeFromWorkIndex === 'function') await window.removeFromWorkIndex(workId); } catch (e) {}
    try { if (typeof invalidateWorkIndex === 'function') invalidateWorkIndex(); } catch (e) {}
    // ── 캐시 ──
    try { if (typeof invalidateRecordsCache === 'function') invalidateRecordsCache(); } catch (e) {}
    try { if (typeof invalidateCustomersCache === 'function') invalidateCustomersCache(); } catch (e) {}
    try { if (typeof invalidateCustomersV2 === 'function') invalidateCustomersV2(); } catch (e) {}
    try { _purgeWorkFromMonthCacheLS(workId); } catch (e) {}   // 달력 월별 로컬캐시(빈 스캔 시 부활 방지)
    // ── 백업 거울 (안 지우면 복원 때 되살아남) ──
    try { if (window.AutoBackup && AutoBackup.removeFromBackup) await AutoBackup.removeFromBackup(workId); } catch (e) {}
    // ── 클라우드 (사용자가 직접 지운 경우만) ──
    if (opts.cloud) {
      try { if (window.CloudBackup && CloudBackup.markWorkTrashed) await CloudBackup.markWorkTrashed(workId); } catch (e) {}
      try { if (window.CloudSync && CloudSync.trashWorkItem) await CloudSync.trashWorkItem(workId); } catch (e) {}
    }
    // ── 화면 (지운 작업이 열려 있었으면 초기화) ──
    try { if (typeof clearIfCurrent === 'function') await clearIfCurrent(workId); } catch (e) {}
    // ── 고객 엑셀 ──
    if (opts.xlsx) {
      try { if (typeof flushCustomersXlsx === 'function') await flushCustomersXlsx(); } catch (e) {}
    }
    console.log('[정리] purgeWorkEverywhere 완료:', workId, opts);
  };

  async function deleteWorkFromCalendar(item) {
    if (!item || item.type !== 'work') return;
    var w = item.data;
    var label = w.apt || w.folderName || '작업';
    var _bupRecoverable = false;
    try { _bupRecoverable = !!(window.CloudBackup && CloudBackup.isSub && CloudBackup.isSub()); } catch (e) {}
    if (!confirm('"' + label + '" 작업을 삭제할까요?\n\n폴더와 사진이 이 기기에서 삭제됩니다.\n' + (_bupRecoverable ? '구독 중이므로 30일간 설정 › 공유 휴지통에서 복구할 수 있어요.' : '(되돌릴 수 없습니다)'))) return;
    try {
      if (typeof setAppBusy === 'function') setAppBusy(true, '삭제 중...');
      if (typeof photoFolderHandle !== 'undefined' && photoFolderHandle && w.folderName) {
        try { await photoFolderHandle.removeEntry(w.folderName, { recursive: true }); }
        catch (e) { try { await photoFolderHandle.removeEntry(w.folderName); } catch (e2) {} }
      }
      // ★ 뒷정리는 purgeWorkEverywhere 한 곳에서 (인덱스·캐시·백업거울·클라우드휴지통·화면초기화)
      await window.purgeWorkEverywhere(w.folderName || w.workId, { cloud: true });
      if (typeof showToast === 'function') showToast('🗑️ 삭제되었습니다', 'ok');
    } catch (e) {
      if (typeof showToast === 'function') showToast('삭제 실패: ' + (e && e.message), 'err');
    } finally {
      if (typeof setAppBusy === 'function') setAppBusy(false);
    }
    // 달력 새로고침
    _calItems = null; _dateMap = {}; _monthCache = {};
    await loadCalendarData();
  }

  /* ══════════════════════════════════════════
     작업 열기
  ══════════════════════════════════════════ */
  async function openWorkFromCalendar(item) {
    if (!item || item.type !== 'work') {
      if (typeof showToast === 'function') showToast('고객 방문 기록입니다', 'ok');
      return;
    }
    var w = item.data;
    var dirHandle = w.dirHandle || null;

    if (!dirHandle && w.folderName &&
        typeof photoFolderHandle !== 'undefined' && photoFolderHandle) {
      try {
        dirHandle = await photoFolderHandle.getDirectoryHandle(w.folderName);
      } catch (e) {
        if (typeof showToast === 'function') showToast('폴더를 찾을 수 없습니다: ' + (w.folderName || ''), 'err');
        return;
      }
    }

    // 모달 닫기
    var modal = document.getElementById('customerModal');
    if (modal) modal.classList.remove('open');
    _isOpen = false;

    if (typeof switchTab === 'function') switchTab('work');

    if (dirHandle && typeof loadFromDateFolder === 'function') {
      try {
        await loadFromDateFolder(dirHandle, w);
      } catch (e) {
        if (typeof showToast === 'function') showToast('열기 실패: ' + e.message, 'err');
      }
    } else if (!dirHandle) {
      var saveId = w.workId || w.saveId;
      if (saveId && typeof doLoad === 'function') {
        try { await doLoad(saveId); } catch (e) {}
      } else {
        if (typeof showToast === 'function') showToast('저장 폴더를 연결해주세요', 'err');
      }
    }
  }

  /* ══════════════════════════════════════════
     외부 새로고침 진입점 (선택적)
  ══════════════════════════════════════════ */
  /* ══════════════════════════════════════════
     ＋ 추가 메뉴 (작업 추가 / 일정 추가)
  ══════════════════════════════════════════ */
  window.openCalendarAddMenu = function (presetDate) {
    // 토글: 이미 열려 있으면 닫기
    var exist = document.getElementById('calAddMenu');
    if (exist) { exist.remove(); return; }

    var ov = document.createElement('div');
    ov.id = 'calAddMenu';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.32);z-index:1530;';

    function item(id, bottom, label, icon, bg) {
      return '<div id="' + id + '" style="position:fixed;right:18px;bottom:' + bottom + 'px;display:flex;align-items:center;gap:10px;cursor:pointer;opacity:0;transform:translateY(10px);transition:opacity .16s ease,transform .16s ease;">' +
        '<span style="background:var(--sf);color:var(--tx);font-size:13px;font-weight:700;padding:8px 13px;border-radius:9px;box-shadow:0 2px 10px rgba(0,0,0,.3);white-space:nowrap;">' + label + '</span>' +
        '<span style="width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;color:#fff;background:' + bg + ';box-shadow:0 4px 14px rgba(0,0,0,.35);">' + icon + '</span>' +
      '</div>';
    }
    /* ★ 2026-08-13 통합: '사진 작업추가'와 '간단한 일정추가'는 결국 똑같은 로컬 작업을 만들었다.
       (둘 다 manual:false 인 진짜 작업 — cloud_sync.js toPayload 참고)
       메뉴를 '일정 추가' 하나로 합치고, 사진부터 찍는 흐름은 폼 안의
       '저장하고 바로 사진 찍기' 버튼이 대신한다. */
    ov.innerHTML =
      item('addMenuSearch', 246, '검색', '🔍', 'var(--sf2,#6b7280)') +
      item('addMenuSchedule', 190, '일정 추가', '📅', 'linear-gradient(135deg,var(--ac),var(--ac2))') +
      item('addMenuReminder', 134, '리마인더', '🔔', 'linear-gradient(135deg,#8b8fa3,#6b7280)');
    document.body.appendChild(ov);

    // 등장 애니메이션
    requestAnimationFrame(function () {
      ov.querySelectorAll('#addMenuSearch,#addMenuSchedule,#addMenuReminder').forEach(function (el) {
        el.style.opacity = '1'; el.style.transform = 'none';
      });
    });

    var close = function () { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.getElementById('addMenuSchedule').onclick = function () {
      close();
      // 문자/캡처 분석 창을 먼저 띄우고, 그 안의 '수동으로 직접 입력'으로 수동 폼 진입
      if (window.ClaudeAI && ClaudeAI.openSmsToSchedule) ClaudeAI.openSmsToSchedule(presetDate);
      else window.openQuickWorkAdd(presetDate);
    };
    document.getElementById('addMenuSearch').onclick = function () { close(); window.openCalendarSearch(); };
    document.getElementById('addMenuReminder').onclick = function () { close(); window.openReminderEdit(presetDate); };
  };

  /* ══════════════════════════════════════════
     🔔 리마인더 추가/수정 (공유 안 됨 — 내 참고용)
  ══════════════════════════════════════════ */
  window.openReminderEdit = function (presetDate, editId) {
    if (!window.Reminders) { if (typeof showToast === 'function') showToast('리마인더 모듈 로드 안됨', 'err'); return; }
    var cur = editId ? Reminders.get(editId) : null;
    var d = (cur && cur.date) || presetDate || _today;
    var leadOpts = Reminders.LEADS.map(function (o) {
      var sel = (cur ? cur.lead === o.v : o.v === 30) ? ' selected' : '';
      return '<option value="' + o.v + '"' + sel + '>' + o.label + '</option>';
    }).join('');
    var repOpts = Reminders.REPEATS.map(function (o) {
      var sel = (cur ? (cur.repeat || 'none') === o.v : o.v === 'none') ? ' selected' : '';
      return '<option value="' + o.v + '"' + sel + '>' + o.label + '</option>';
    }).join('');

    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:1830;display:flex;align-items:flex-start;justify-content:center;padding:24px 16px;overflow-y:auto;-webkit-overflow-scrolling:touch;';
    ov.innerHTML =
      '<div style="background:var(--sf);border-radius:14px;padding:18px;max-width:440px;width:100%;">' +
        '<div style="font-size:16px;font-weight:800;margin-bottom:4px;">🔔 ' + (cur ? '리마인더 정보' : '리마인더 추가') + '</div>' +
        '<div style="font-size:12px;color:var(--mu);margin-bottom:14px;">나만 보는 참고용 일정입니다 (공유되지 않습니다)</div>' +
        '<div style="display:flex;flex-direction:column;gap:10px;">' +
          '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">내용</label>' +
            '<input class="cust-inp" id="remTitle" type="text" placeholder="예: 서비스센터 방문" value="' + _escH((cur && cur.title) || '') + '" style="width:100%;margin-top:4px;"></div>' +
          '<div style="display:flex;gap:8px;">' +
            '<div style="flex:1.3;"><label style="font-size:12px;color:var(--mu);font-weight:700;">날짜</label>' +
              '<input class="cust-inp" id="remDate" type="date" value="' + _escH(d) + '" style="width:100%;margin-top:4px;"></div>' +
            '<div style="flex:1;"><label style="font-size:12px;color:var(--mu);font-weight:700;">시간</label>' +
              '<input class="cust-inp" id="remTime" type="time" value="' + _escH((cur && cur.time) || '') + '" style="width:100%;margin-top:4px;"></div>' +
          '</div>' +
          /* ★ 2026-08-17 종료일 — 여러 날에 걸치는 리마인더(대기·휴무 등)를 위해. 비워두면 하루짜리 */
          '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">종료일 (선택)</label>' +
            '<input class="cust-inp" id="remEnd" type="date" value="' + _escH((cur && cur.endDate) || '') + '" style="width:100%;margin-top:4px;">' +
            '<div style="font-size:11px;color:var(--mu);margin-top:3px;">비워두면 하루짜리입니다. 넣으면 달력에 그 기간 내내 표시됩니다.</div></div>' +
          '<div style="display:flex;gap:8px;">' +
            '<div style="flex:1;"><label style="font-size:12px;color:var(--mu);font-weight:700;">알림</label>' +
              '<select class="cust-inp" id="remLead" style="width:100%;margin-top:4px;">' + leadOpts + '</select></div>' +
            '<div style="flex:1;"><label style="font-size:12px;color:var(--mu);font-weight:700;">반복</label>' +
              '<select class="cust-inp" id="remRepeat" style="width:100%;margin-top:4px;">' + repOpts + '</select></div>' +
          '</div>' +
          '<div id="remLeadHint" style="font-size:11px;color:var(--mu);line-height:1.5;"></div>' +
          '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">메모 (선택)</label>' +
            '<input class="cust-inp" id="remMemo" type="text" placeholder="예: 부품번호 A-123 가져가기" value="' + _escH((cur && cur.memo) || '') + '" style="width:100%;margin-top:4px;"></div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:16px;">' +
          '<button class="btn b-blue" id="remSave" style="flex:2;justify-content:center;">저장</button>' +
          (cur ? '<button class="btn b-ghost" id="remDel" style="flex:1;justify-content:center;color:var(--dn);">삭제</button>' : '') +
          '<button class="btn b-ghost" id="remCancel" style="flex:1;justify-content:center;">취소</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);

    var close = function () { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.getElementById('remCancel').onclick = close;

    // 시간이 비어 있으면 알림을 걸 수 없다는 점을 알려준다(조용히 안 울리는 상황 방지)
    function hint() {
      var t = document.getElementById('remTime').value;
      var lead = parseInt(document.getElementById('remLead').value, 10);
      var el = document.getElementById('remLeadHint');
      if (!el) return;
      if (lead >= 0 && !t) el.innerHTML = '⚠️ 시간을 입력해야 알림이 동작합니다. 시간이 없으면 달력에만 표시됩니다.';
      else if (lead < 0) el.innerHTML = '알림 없이 달력에만 표시됩니다.';
      else el.innerHTML = '';
    }
    document.getElementById('remTime').addEventListener('input', hint);
    document.getElementById('remLead').addEventListener('change', hint);
    hint();

    var delBtn = document.getElementById('remDel');
    if (delBtn) delBtn.onclick = function () {
      if (!confirm('이 리마인더를 삭제할까요?')) return;
      Reminders.remove(cur.id);
      close();
      if (typeof showToast === 'function') showToast('삭제되었습니다', 'ok');
    };

    document.getElementById('remSave').onclick = function () {
      var title = (document.getElementById('remTitle').value || '').trim();
      var date = document.getElementById('remDate').value;
      if (!title) { if (typeof showToast === 'function') showToast('내용을 입력해주세요', 'err'); return; }
      if (!date) { if (typeof showToast === 'function') showToast('날짜를 입력해주세요', 'err'); return; }
      var endD = (document.getElementById('remEnd') || {}).value || '';
      if (endD && endD < date) { if (typeof showToast === 'function') showToast('종료일이 날짜보다 앞설 수 없습니다', 'err'); return; }
      Reminders.save({
        id: cur ? cur.id : null,
        title: title,
        date: date,
        endDate: endD,
        time: document.getElementById('remTime').value || '',
        lead: parseInt(document.getElementById('remLead').value, 10),
        repeat: document.getElementById('remRepeat').value || 'none',
        memo: document.getElementById('remMemo').value || ''
      });
      close();
      if (typeof showToast === 'function') showToast('🔔 리마인더가 저장되었습니다', 'ok');
    };
  };

  /* ══════════════════════════════════════════
     작업 추가 (사진 없이 작업 정보만 입력 → 로컬 작업 생성)
  ══════════════════════════════════════════ */
  window.openQuickWorkAdd = function (presetDate, prefill) {
    if (typeof photoFolderHandle === 'undefined' || !photoFolderHandle) {
      if (typeof showToast === 'function') showToast('먼저 저장 폴더를 연결해주세요', 'err');
      return;
    }
    var today = (typeof kstDateStr === 'function') ? kstDateStr() : new Date().toISOString().slice(0, 10);
    var theDate = (prefill && prefill.date) || presetDate || today;
    var html =
      '<div style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:1840;display:flex;align-items:center;justify-content:center;padding:16px;" id="quickWorkOverlay">' +
        '<div style="background:var(--sf);border-radius:14px;padding:20px;max-width:460px;width:100%;max-height:calc(100vh - 44px);overflow-y:auto;-webkit-overflow-scrolling:touch;">' +
          '<div style="font-size:16px;font-weight:800;margin-bottom:4px;">🆕 일정 추가</div>' +
          '<div style="font-size:12px;color:var(--mu);margin-bottom:14px;">사진 없이 정보만 입력합니다 (나중에 열기로 작업탭에서 이어서 작업)</div>' +
          '<div style="display:flex;flex-direction:column;gap:10px;">' +
            '<div style="display:flex;gap:8px;">' +
              '<div style="flex:1;"><label style="font-size:12px;color:var(--mu);font-weight:700;">작업일자 <span style="color:#e74c3c;">*</span></label>' +
                '<input class="cust-inp" id="qwDate" type="date" value="' + _escH(theDate) + '" style="width:100%;margin-top:4px;"></div>' +
              '<div style="flex:1;"><label style="font-size:12px;color:var(--mu);font-weight:700;">작업자 <span style="color:#e74c3c;">*</span></label>' +
                '<input class="cust-inp" id="qwWorker" type="text" placeholder="담당자" style="width:100%;margin-top:4px;"></div>' +
            '</div>' +
            '<div style="display:flex;gap:8px;">' +
              '<div style="flex:2;"><label style="font-size:12px;color:var(--mu);font-weight:700;">작업명(현장) <span style="color:#e74c3c;">*</span></label>' +
                '<input class="cust-inp" id="qwApt" type="text" placeholder="예: ○○아파트 101동" style="width:100%;margin-top:4px;"></div>' +
              '<div style="flex:1;"><label style="font-size:12px;color:var(--mu);font-weight:700;">동호수 <span style="color:#e74c3c;">*</span></label>' +
                '<input class="cust-inp" id="qwUnit" type="text" placeholder="예: 101동 502호" style="width:100%;margin-top:4px;"></div>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--mu);margin-top:-4px;"><span style="color:#e74c3c;">*</span> 필수 항목 · 작업명 또는 호수 중 하나는 꼭 입력</div>' +
            '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">고객명 <span style="font-weight:400;">(선택)</span></label>' +
              '<input class="cust-inp" id="qwName" type="text" placeholder="예: 홍길동" style="width:100%;margin-top:4px;"></div>' +
            /* ★ 2026-08-16 업종 — 고른 업종에 따라 보고서 제목·호칭·글쓰기 지침·견적서 양식이 달라진다 */
            ((window.ProfilesUI && ProfilesUI.selectHtml)
               ? ProfilesUI.selectHtml('qwProfile', (prefill && prefill.profileId) || '', '업종') : '') +
            '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">작업대상</label>' +
              '<input class="cust-inp" id="qwTarget" type="text" placeholder="예: 벽걸이 2대" style="width:100%;margin-top:4px;"></div>' +
            '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">전화번호</label>' +
              '<input class="cust-inp" id="qwPhone" type="text" inputmode="tel" placeholder="010-1234-5678" style="width:100%;margin-top:4px;"></div>' +
            '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">주소</label>' +
              '<input class="cust-inp" id="qwAddr" type="text" placeholder="주소" style="width:100%;margin-top:4px;"></div>' +
            '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">가격 (원)</label>' +
              '<input class="cust-inp" id="qwPrice" type="text" inputmode="numeric" placeholder="예: 120000" style="width:100%;margin-top:4px;"></div>' +
            '<div style="display:flex;gap:8px;">' +
              '<div style="flex:1;"><label style="font-size:12px;color:var(--mu);font-weight:700;">시작시간</label>' +
                '<input class="cust-inp" id="qwStart" type="time" style="width:100%;margin-top:4px;"></div>' +
              '<div style="flex:1;"><label style="font-size:12px;color:var(--mu);font-weight:700;">종료시간</label>' +
                '<input class="cust-inp" id="qwEnd" type="time" style="width:100%;margin-top:4px;"></div>' +
            '</div>' +
            '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">종료일 <span style="font-weight:400;">(여러 날 작업일 때만 — 비우면 당일 완료)</span></label>' +
              '<input class="cust-inp" id="qwEndDate" type="date" style="width:100%;margin-top:4px;"></div>' +
            '<div><label style="font-size:12px;color:var(--mu);font-weight:700;">메모</label>' +
              '<textarea class="cust-memo" id="qwMemo" rows="2" placeholder="메모" style="width:100%;margin-top:4px;"></textarea></div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;margin-top:14px;">' +
            '<button class="btn b-blue" id="qwSave" style="flex:1;">저장</button>' +
            '<button class="btn b-ghost" id="qwCancel">취소</button>' +
          '</div>' +
          '<button class="btn b-ghost" id="qwSaveShoot" style="width:100%;justify-content:center;margin-top:8px;">📷 저장하고 바로 사진 찍기</button>' +
        '</div>' +
      '</div>';
    var wrap = document.createElement('div'); wrap.innerHTML = html;
    document.body.appendChild(wrap.firstElementChild);
    try { if (window.ProfilesUI && ProfilesUI.bindSelect) ProfilesUI.bindSelect('qwProfile'); } catch (e) {}
    if (prefill) {
      var _setv = function (id, v) { var el = document.getElementById(id); if (el && v != null && v !== '') el.value = v; };
      _setv('qwName', prefill.name);
      _setv('qwApt', prefill.apt); _setv('qwUnit', prefill.unit); _setv('qwWorker', prefill.worker);
      _setv('qwTarget', prefill.target); _setv('qwPhone', prefill.phone); _setv('qwAddr', prefill.address);
      _setv('qwPrice', (prefill.price ? String(prefill.price) : '')); _setv('qwStart', prefill.startTime); _setv('qwEnd', prefill.endTime);
      _setv('qwMemo', prefill.memo);
      // 주소가 비었는데 아파트/건물명이 있으면 네비게이션용으로 주소칸에 아파트명을 채움
      try {
        var _addrEl = document.getElementById('qwAddr');
        var _aptStr = (prefill.apt != null) ? String(prefill.apt).trim() : '';
        if (_addrEl && !(_addrEl.value || '').trim() && _aptStr) _addrEl.value = _aptStr;
      } catch (e) {}
    }
    try {   // ★ 작업자 비어 있으면 기본값 미리 채움 (콤보 변환 전에)
      var _dwEl = document.getElementById('qwWorker');
      if (_dwEl && !(_dwEl.value || '').trim() && window.WorkerCombo && WorkerCombo.defaultName) {
        var _dwN = WorkerCombo.defaultName();
        if (_dwN) _dwEl.value = _dwN;
      }
    } catch (e) {}
    _workerComboify('qwWorker');  // ★ 공유 닉네임 콤보
    var close = function () { var o = document.getElementById('quickWorkOverlay'); if (o) o.remove(); };
    document.getElementById('qwCancel').addEventListener('click', close);
    /* ★ 2026-08-13: 저장 로직을 함수로 빼서 [저장]과 [저장하고 바로 사진 찍기]가 공유한다.
       openAfter=true 면 저장 직후 그 작업을 작업탭에 열어 촬영으로 바로 이어진다
       (없어진 '사진 작업추가' 메뉴가 하던 일). */
    var _qwSave = async function (openAfter) {
      var date   = document.getElementById('qwDate').value || theDate;
      var custName = document.getElementById('qwName').value.trim();
      var apt    = document.getElementById('qwApt').value.trim();
      var unit   = document.getElementById('qwUnit').value.trim();
      var worker = document.getElementById('qwWorker').value.trim();
      var target = document.getElementById('qwTarget').value.trim();
      var phone  = document.getElementById('qwPhone').value.trim();
      var addr   = document.getElementById('qwAddr').value.trim();
      var memo   = document.getElementById('qwMemo').value.trim();
      var price  = document.getElementById('qwPrice').value.trim();
      var st     = document.getElementById('qwStart').value;
      var et     = document.getElementById('qwEnd').value;
      var endD   = (document.getElementById('qwEndDate') && document.getElementById('qwEndDate').value) || '';
      if (endD && endD <= date) endD = '';  // 당일이거나 시작일 이전이면 무시
      // ★ 필수 항목 검증 — 비어있는 항목을 모두 모아 한 번에 안내하고 첫 항목으로 포커스
      var _miss = [];
      if (!date) _miss.push('작업일자');
      if (!apt && !unit) _miss.push('작업명 또는 호수');
      if (!worker) _miss.push('작업자');
      if (_miss.length) {
        if (typeof showToast === 'function') showToast('필수 항목을 입력해주세요: ' + _miss.join(', '), 'err');
        try {
          var _fid = !date ? 'qwDate' : ((!apt && !unit) ? 'qwApt' : 'qwWorker');
          var _fe = document.getElementById(_fid); if (_fe) _fe.focus();
        } catch (e) {}
        return;
      }
      var unitName = unit || apt || '작업';
      try {
        if (typeof showOverlay === 'function') showOverlay('저장 중...');
        if (typeof requestFolderPermissionSafe === 'function') { try { await requestFolderPermissionSafe('readwrite'); } catch (e) {} }
        // 폴더명: 작업일자_시분초 (충돌 시 -N)
        var d = new Date();
        var p2 = function (n) { return String(n).padStart(2, '0'); };
        var base = date + '_' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
        var folderName = base, n = 1;
        while (n < 50) {
          try { await photoFolderHandle.getDirectoryHandle(folderName); folderName = base + '-' + (++n); }
          catch (e) { break; }
        }
        /* ★ 2026-08-16 이 일정의 업종을 새긴다. 스냅샷을 같이 넣어야
             상대 폰(내 프로필 목록이 없는)에서도 아이콘·보고서 제목을 그릴 수 있다. */
        var _qwPfId = '';
        var _qwPfSnap = null;
        try {
          if (window.ProfilesUI && ProfilesUI.pickedId) _qwPfId = ProfilesUI.pickedId('qwProfile');
          if (window.Profiles && _qwPfId) _qwPfSnap = Profiles.snapOf(_qwPfId);
        } catch (e) {}
        var sessionData = {
          version: 1,
          type: 'aircon-report',
          workId: folderName,
          workType: 'household',
          profileId: _qwPfId || '',
          profileSnap: _qwPfSnap || null,
          endDate: endD,
          facilityCustomer: null,
          savedAt: (typeof kstIsoString === 'function') ? kstIsoString() : new Date().toISOString(),
          apt: apt || unitName,
          date: date,
          worker: worker,
          units: [{
            name: unitName,
            workNum: 1,
            beforeCount: 0,
            afterCount: 0,
            beforeMeta: [],
            afterMeta: [],
            specials: [],
            customer: { name: custName, phone: phone, address: addr, memo: memo, workTarget: target, price: price, startTime: st, endTime: et }
          }]
        };
        var jsonText = JSON.stringify(sessionData, null, 2);
        var dir = await photoFolderHandle.getDirectoryHandle(folderName, { create: true });
        async function writeFile(name) {
          var fh = await dir.getFileHandle(name, { create: true });
          var wr = await fh.createWritable();
          await wr.write(new Blob([jsonText], { type: 'application/json;charset=utf-8' }));
          await wr.close();
        }
        await writeFile('_session.json');
        try { await writeFile('report_' + folderName + '.acreport.json'); } catch (e) {}
        // 작업 인덱스 갱신 (기록 탭/고객 목록 반영)
        try {
          if (typeof scheduleIndexUpdate === 'function' && typeof sessionToIndexEntry === 'function') {
            var ie = sessionToIndexEntry(folderName, sessionData);
            if (ie) scheduleIndexUpdate(ie);
          }
        } catch (e) {}
        try { if (typeof invalidateRecordsCache === 'function') invalidateRecordsCache(); } catch (e) {}
        try { if (typeof invalidateCustomersCache === 'function') invalidateCustomersCache(); } catch (e) {}
        try { if (typeof invalidateCustomersV2 === 'function') invalidateCustomersV2(); } catch (e) {}
        // ── AI 교정 학습: AI가 채운 값 vs 사용자가 최종 저장한 값 비교해 저장 ──
        try {
          if (prefill && prefill.__aiSource && window.ClaudeAI && ClaudeAI.saveCorrection) {
            ClaudeAI.saveCorrection(prefill.__aiSource,
              { startTime: prefill.startTime, endTime: prefill.endTime, apt: prefill.apt, unit: prefill.unit, target: prefill.target, phone: prefill.phone, address: prefill.address, price: prefill.price, memo: prefill.memo },
              { startTime: st, endTime: et, apt: apt, unit: unit, target: target, phone: phone, address: addr, price: price, memo: memo });
          }
        } catch (e) {}
        close();
        if (typeof hideOverlay === 'function') hideOverlay();
        // 달력 새로고침(월 캐시 비우고 추가한 날짜 선택)
        _monthCache = {};
        _selDate = date;
        window._calSelectedDate = date;
        await loadCalendarData();
        if (openAfter) {
          /* 방금 만든 폴더를 작업탭에서 연다 → 곧바로 사진 촬영.
             안내 토스트는 열기가 끝난 뒤에 띄운다 — 먼저 띄우면 복원 완료 토스트
             ('✓ 불러오기 완료')가 같은 엘리먼트를 덮어써서 안 보인다. */
          try {
            /* ⚠️ 복원 함수(restoreFromData)는 _session.json 을 다시 읽지 않고 여기 넘긴 data 를 그대로 믿는다.
               특히 data.units 가 없으면 dialogs.js 의 units 루프에서 TypeError 로 조용히 실패한다.
               → scanFoldersDirect 가 만드는 항목과 같은 모양으로 채워서 넘길 것. */
            await openWorkFromCalendar({ type: 'work', data: {
              folderName:  folderName,
              dirHandle:   dir,
              workId:      folderName,
              apt:         sessionData.apt || '',
              date:        date,
              endDate:     endD || '',
              worker:      worker || '',
              units:       sessionData.units,
              totalUnits:  sessionData.units.length,
              totalPhotos: 0,
              session:     sessionData
            } });
            if (typeof showToast === 'function') {
              setTimeout(function () { showToast('✓ 저장했습니다 — 사진을 찍으세요', 'ok'); }, 120);
            }
          } catch (e2) {
            if (typeof showToast === 'function') showToast('작업 열기 실패: ' + (e2 && e2.message), 'err');
          }
          return;
        }
        if (typeof showToast === 'function') showToast('✓ 일정이 추가되었습니다', 'ok');
      } catch (e) {
        if (typeof hideOverlay === 'function') hideOverlay();
        if (typeof showToast === 'function') showToast('저장 실패: ' + (e && e.message), 'err');
      }
    };
    document.getElementById('qwSave').addEventListener('click', function () { _qwSave(false); });
    var _qwShootBtn = document.getElementById('qwSaveShoot');
    if (_qwShootBtn) _qwShootBtn.addEventListener('click', function () { _qwSave(true); });
  };

  /* ══════════════════════════════════════════
     작업 검색 (전체 폴더 대상, 달력 아래 목록 표시)
  ══════════════════════════════════════════ */
  function _searchText(w) {
    var parts = [w.apt || '', w.worker || '', w.date || '', w.folderName || ''];
    var sess = w.session || {};
    var fcx = sess.facilityCustomer;
    if (fcx) parts.push(fcx.workTarget || '', fcx.phone || '', fcx.address || '', fcx.memo || '', String(fcx.price || ''), fcx.startTime || '', fcx.endTime || '');
    (w.units || []).forEach(function (u) {
      parts.push(u.name || '');
      var c = u.customer || {};
      parts.push(c.name || '', c.workTarget || '', c.phone || '', c.address || '', c.memo || '', String(c.price || ''), c.startTime || '', c.endTime || '');
    });
    return parts.join(' ').toLowerCase();
  }

  // 공유(shared) 일정용 검색 텍스트 (로컬 작업과 데이터 구조가 다름)
  function _searchTextShared(d) {
    var parts = [d.apt || '', d.date || '', d.name || '', d.target || '', d.memo || '', d.phone || '', d.address || '', d.partnerName || ''];
    (d.unitNames || []).forEach(function (n) { parts.push(n || ''); });
    return parts.join(' ').toLowerCase();
  }

  var _lastSearchQuery = '';
  async function runCalendarSearch(q) {
    _lastSearchQuery = q;
    var panel = document.getElementById('calDetail');
    if (!panel) return;
    if (typeof showOverlay === 'function') showOverlay('검색 중...');
    var all = null;
    try { all = await scanFoldersDirect(null); } catch (e) { all = null; }
    if (typeof hideOverlay === 'function') hideOverlay();
    all = all || [];
    // ★ 공유받은 일정(shared)도 검색 대상에 포함 (공유만 받는 상대도 검색되게)
    var sharedAll = [];
    try { if (window.CloudShare && CloudShare.getItemsForMonth) sharedAll = CloudShare.getItemsForMonth(null) || []; } catch (e) {}
    var candidates = all.concat(sharedAll);
    var ql = q.toLowerCase();
    var results = candidates.filter(function (it) {
      if (!it || !it.data) return false;
      if (it.type === 'work')   return _searchText(it.data).indexOf(ql) >= 0;
      if (it.type === 'shared') return _searchTextShared(it.data).indexOf(ql) >= 0;
      return false;
    });
    results.sort(function (a, b) { return String(b.sortDate || '').localeCompare(String(a.sortDate || '')); });
    window._calSearchResults = results;

    var head =
      '<div class="cal-detail-head">' +
        '<span class="cal-detail-date">🔍 "' + _escH(q) + '"</span>' +
        '<span class="cal-detail-cnt">' + results.length + '건</span>' +
      '</div>';
    var footer = '<div style="padding:8px 0;"><button class="btn b-ghost" id="calSearchClear" style="width:100%;justify-content:center;">검색 닫기</button></div>';

    if (!results.length) {
      panel.innerHTML = head + '<div class="cal-detail-list"><div class="cal-empty-day">검색 결과가 없습니다.</div></div>' + footer;
    } else {
      var cards = '';
      for (var i = 0; i < results.length; i++) {
        if (results[i].type === 'shared') {
          var sw = results[i].data;
          var sMine = !!(window.Cloud && Cloud.user && sw.ownerUid === Cloud.user.uid);
          var sIsFac = sw.workType === 'facility';
          var sApt = _escH(sw.apt || '작업');
          var sUarr = sw.unitNames || [];
          var sUnits = sUarr.slice(0,2).join(', ') + (sUarr.length>2 ? ' +'+(sUarr.length-2) : '');
          var sTime = (sw.startTime && sw.endTime) ? (sw.startTime+'<br><span class="cw-tilde">~</span><br>'+sw.endTime) : (sw.startTime || sw.endTime || '<span class="cw-notime">–</span>');
          cards +=
            '<div class="cust-card' + (sMine ? '' : ' cust-card-shared') + '">' +
              '<div class="cw-flex">' +
                /* ★ 2026-08-08: 내 일정(가져온 작업 포함)은 내 작업 카드와 똑같은 시간칸 색을 쓴다.
                     (예전엔 sMine 이면 클래스를 아무것도 안 붙여 기본 회색톤이 나와 혼자 튀어 보였다) */
              '<div class="cw-time ' + (sMine ? (_isWorkDone(sw) ? 'cw-time-done' : 'cw-time-pending') : 'cw-time-shared') + '">' + _indIconHtml(sw) + sTime + '</div>' +
                '<div class="cw-body">' +
                  '<div class="cust-card-top">' +
                    '<span class="cust-card-name">' + (sIsFac ? '🏢' : '🏠') + ' ' + sApt + '' + '</span>' +
                    (sUnits ? '<span class="cust-unit">' + _escH(sUnits) + '</span>' : '') +
                    _sharedNameBadge(sw, sMine) +
                  '</div>' +
                  '<div class="cust-card-bottom"><div class="cust-card-info">' +
                    (sw.target ? '<span class="cw-target">🎯 ' + _escH(sw.target) + '</span>'
                               : '<span style="color:var(--mu);font-style:italic;">🎯 작업대상 미입력</span>') +
                    _photoCntHtml(sw.totalPhotos, sw.addedPhotos) +
                    '<span class="cw-price">💰 ₩' + (sw.price||0).toLocaleString('ko-KR') + '</span>' +
                    _postsBadge(sw) +
                  '</div>' +
                  '<div class="cust-card-actions">' +
                    '<button class="cust-card-btn cal-shared-open" data-sidx="' + i + '" title="열기"><span class="btn-ic">📂</span><span class="btn-tx">열기</span></button>' +
                    '<button class="cust-card-btn cal-shared-edit" data-sidx="' + i + '" title="상세 보기 / 수정"><span class="btn-ic">📄</span><span class="btn-tx">상세</span></button>' +
                    _takeBtnHtml(sw, sMine, 'data-sidx', i) +
                  (sMine ? '<button class="cust-card-btn cal-shared-del" data-sidx="' + i + '" title="삭제"><span class="btn-ic">🗑️</span><span class="btn-tx">삭제</span></button>' : '<button class="cust-card-btn cal-shared-hide" data-hidekey="' + _escH(_shHideKey(sw)) + '" title="내 달력에서 숨기기"><span class="btn-ic">🚫</span><span class="btn-tx">숨기기</span></button>') +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>';
          continue;
        }
        var w = results[i].data;
        var isFac = !!(w.session && w.session.workType === 'facility') || w.workType === 'facility';
        var _aptOv = _ovOf(w);
        var apt = _escH((_aptOv && _aptOv.apt) || w.apt || '작업');
        var photoCnt = w.totalPhotos || (w.units || []).reduce(function (s, u) { return s + (u.beforeCount || 0) + (u.afterCount || 0); }, 0);
        var addedCnt = (window.CloudShare && CloudShare.addedPhotosOf) ? CloudShare.addedPhotosOf(w.folderName || w.workId) : 0;
        var unitNames = (w.units || []).map(function (u) { return u.name || ''; }).filter(Boolean);
        var unitInfo = unitNames.slice(0, 2).join(', ') + (unitNames.length > 2 ? ' +' + (unitNames.length - 2) : '');
        var target = _workTargetOf(w);   // ★ 2026-08-24 아젠다 줄과 한 규칙으로 통일
        cards +=
          '<div class="cust-card' + (isFac ? ' cust-card-facility' : '') + '">' +
            '<div class="cw-flex">' +
              '<div class="cw-time ' + (_isWorkDone(w) ? 'cw-time-done' : 'cw-time-pending') + '" style="font-size:11px;">' + _indIconHtml(w) + _escH(w.date || '') + '</div>' +
              '<div class="cw-body">' +
                '<div class="cust-card-top">' +
                  '<span class="cust-card-name">' + (isFac ? '🏢' : '🏠') + ' ' + apt + '</span>' +
                  (unitInfo ? '<span class="cust-unit">' + _escH(unitInfo) + '</span>' : '') +
                  /* ★ 2026-08-13: 상대가 담당자를 바꾼 경우 오버라이드를 먼저 본다.
                     (로컬 _session.json 반영은 되지만 다음 폴더 스캔 전까지 w.worker 가 옛값) */
                  _workerBadge(((_ovOf(w) || {}).worker) || w.worker) +
                '</div>' +
                '<div class="cust-card-bottom">' +
                  '<div class="cust-card-info">' +
                    (target ? '<span class="cw-target">🎯 ' + _escH(target) + '</span>'
                            : '<span style="color:var(--mu);font-style:italic;">🎯 작업대상 미입력</span>') +
                    _photoCntHtml(photoCnt, addedCnt) +
                    '<span class="cw-price">💰 ' + _fmtWon(_workPrice(w)) + '</span>' +
                    _postsBadge(w) +
                  '</div>' +
                  '<div class="cust-card-actions">' +
                    '<button class="cust-card-btn srch-open" data-idx="' + i + '" title="작업 열기"><span class="btn-ic">📂</span><span class="btn-tx">열기</span></button>' +
                    '<button class="cust-card-btn srch-edit" data-idx="' + i + '" title="상세 보기 / 수정"><span class="btn-ic">📄</span><span class="btn-tx">상세</span></button>' +
                    '<button class="cust-card-btn srch-del" data-idx="' + i + '" title="삭제"><span class="btn-ic">🗑️</span><span class="btn-tx">삭제</span></button>' +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>';
      }
      panel.innerHTML = head + '<div class="cal-detail-list">' + cards + '</div>' + footer;
    }
    panel.style.display = 'flex';
    var clr = document.getElementById('calSearchClear');
    if (clr) clr.onclick = function () { if (_selDate) renderDayDetail(_selDate); else panel.style.display = 'none'; };
    panel.querySelectorAll('.srch-open').forEach(function (btn) {
      btn.addEventListener('click', function (e) { e.stopPropagation(); openWorkFromCalendar(window._calSearchResults[parseInt(btn.getAttribute('data-idx'))]); });
    });
    panel.querySelectorAll('.srch-edit').forEach(function (btn) {
      btn.addEventListener('click', function (e) { e.stopPropagation(); openWorkEdit(window._calSearchResults[parseInt(btn.getAttribute('data-idx'))]); });
    });
    panel.querySelectorAll('.srch-del').forEach(function (btn) {
      btn.addEventListener('click', async function (e) {
        e.stopPropagation();
        await deleteWorkFromCalendar(window._calSearchResults[parseInt(btn.getAttribute('data-idx'))]);
        runCalendarSearch(_lastSearchQuery);
      });
    });
    // ★ 공유(shared) 검색결과 버튼 — 달력과 동일 동작 (수정/삭제)
    panel.querySelectorAll('.cal-shared-open').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var it = window._calSearchResults[parseInt(btn.getAttribute('data-sidx'))];
        if (!it || it.type !== 'shared') return;
        var d = it.data;
        if (window.CloudPhotoSync && CloudPhotoSync.openInWorkTab) {
          CloudPhotoSync.openInWorkTab(d.ownerUid || d.partnerUid, d.workId, d);
        }
      });
    });
    panel.querySelectorAll('.cal-shared-edit').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var it = window._calSearchResults[parseInt(btn.getAttribute('data-sidx'))];
        if (!it || it.type !== 'shared') return;   // ★ 통합 후 CloudShare.openEdit 의존 없음
        openWorkEdit(it, function () { runCalendarSearch(_lastSearchQuery); });   // ★ 통합 창 + 검색 유지
      });
    });
    _bindTakeButtons(panel, function(ix){ return window._calSearchResults[ix]; }, 'data-sidx', function(){ runCalendarSearch(_lastSearchQuery); });
    panel.querySelectorAll('.cal-shared-del').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var it = window._calSearchResults[parseInt(btn.getAttribute('data-sidx'))];
        if (!it || it.type !== 'shared') return;
        var d = it.data;
        if (!confirm('🗑 공유 휴지통으로 이동할까요? (설정에서 복원할 수 있습니다)')) return;
        if (window.CloudShare && CloudShare.deleteSchedule) {
          CloudShare.deleteSchedule(d.workId, d.manual).then(function () { runCalendarSearch(_lastSearchQuery); }).catch(function () {});
        }
      });
    });
    setTimeout(function () { panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 60);
  }
  window.runCalendarSearch = runCalendarSearch;

  window.openCalendarSearch = function () {
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:1840;display:flex;align-items:flex-start;justify-content:center;padding:60px 16px 16px;';
    ov.innerHTML =
      '<div style="background:var(--sf);border-radius:14px;padding:18px;max-width:460px;width:100%;">' +
        '<div style="font-size:16px;font-weight:800;margin-bottom:10px;">🔍 작업 검색</div>' +
        '<div style="display:flex;gap:8px;">' +
          '<input class="cust-inp" id="calSearchInput" type="text" placeholder="작업명·동호수·전화·주소·대상·메모·작업자" style="flex:1;" autocomplete="off">' +
          '<button class="btn b-blue" id="calSearchGo">검색</button>' +
        '</div>' +
        '<div style="display:flex;justify-content:flex-end;margin-top:10px;">' +
          '<button class="btn b-ghost" id="calSearchCancel">취소</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    var inp = document.getElementById('calSearchInput');
    var close = function () { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.getElementById('calSearchCancel').onclick = close;
    function go() { var q = inp.value.trim(); if (!q) { try { inp.focus(); } catch (e) {} return; } close(); runCalendarSearch(q); }
    document.getElementById('calSearchGo').onclick = go;
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 50);
  };

  window.__calendarRefresh = async function () {
    _calItems = null;
    _dateMap  = {};
    _boundaryScanCache = {}; _boundaryKey = '';   // 복원·수정 등 데이터 변경 시 경계 캐시도 새로 (스테일 방지)
    await loadCalendarData();
  };

  // 가져간 원본(사진 없는 로컬 작업)의 폴더를 삭제
  window.deleteLocalWorkFolder = async function (workId) {
    try {
      if (typeof photoFolderHandle === 'undefined' || !photoFolderHandle || !workId) return;
      if (String(workId).indexOf('m_') === 0) return;  // 수동일정은 로컬 폴더 없음
      try { await photoFolderHandle.removeEntry(workId, { recursive: true }); }
      catch(e) { try { await photoFolderHandle.removeEntry(workId); } catch(e2) {} }
      // ★ 뒷정리 일원화. cloud:false — 상대가 가져간 것이라 클라우드 항목은 건드리지 않는다
      await window.purgeWorkEverywhere(workId, { cloud: false });
      console.log('[달력] 가져간 원본 로컬 삭제:', workId);
    } catch (e) { console.warn('[달력] 로컬 폴더 삭제 실패', workId, e); }
  };

  // 상대가 공유 수정한 내용을 내 로컬 작업파일(_session.json)에도 반영
  //  → 정보수정/작업열기에서도 보이도록 (목록은 오버레이로 이미 반영됨)
  window.applyCloudEditToLocal = async function (workId, f) {
    try {
      /* ★ 2026-08-13: 반영 성공 여부를 boolean 으로 돌려준다.
         호출부(cloud_share buildOverrides)가 실패했을 때 '반영했다'고 기록해 버리면
         그 세션 동안 재시도가 없어 옛 값이 다시 클라우드로 올라간다(담당자 되돌아감). */
      // 'retry' = 아직 폴더가 연결되지 않음(콜드스타트) → 실패로 세지 말고 다음 스냅샷에 다시
      if (typeof photoFolderHandle === 'undefined' || !photoFolderHandle) return 'retry';
      if (!workId) return false;
      if (String(workId).indexOf('m_') === 0) return false;  // 수동일정은 로컬 폴더 없음
      if (typeof requestFolderPermissionSafe === 'function') { try { await requestFolderPermissionSafe('readwrite'); } catch(e){} }
      var dir;
      try { dir = await photoFolderHandle.getDirectoryHandle(workId); } catch(e) { return false; }  // 폴더 없으면 skip
      var fh = await dir.getFileHandle('_session.json');
      var sess = JSON.parse(await (await fh.getFile()).text());
      var isFac = (sess.workType === 'facility');
      var tc;
      if (isFac) { sess.facilityCustomer = sess.facilityCustomer || {}; tc = sess.facilityCustomer; }
      else { if (!sess.units) sess.units = []; if (!sess.units[0]) sess.units[0] = {}; sess.units[0].customer = sess.units[0].customer || {}; tc = sess.units[0].customer; }
      if (f.apt !== undefined && f.apt !== '') sess.apt = f.apt;
      /* ★ 2026-08-13 담당자(worker)도 로컬에 반영한다.
         이걸 빠뜨리면 다음 syncAll 이 옛 로컬 worker 를 클라우드에 다시 올려
         방금 바꾼 담당자가 되돌아간다(로컬이 진실의 원천이므로). */
      if (f.worker !== undefined)    sess.worker = f.worker;
      /* ★ 2026-08-13 날짜/종료일도 반영. 이게 없으면 상대가 옮긴 일정이
         다음 syncAll 에서 옛 날짜로 되돌아간다.
         ⚠️ 폴더 이름(YYYY-MM-DD_...)은 바꾸지 않는다 — 사진을 통째로 복사해야 해서 위험하다.
            달력은 _session.json 의 date 를 우선 쓰므로 같은 달 안에서는 문제없고,
            다른 달로 옮기는 건 openWorkEdit 에서 막아 뒀다(폴더명 달로만 스캔하기 때문). */
      if (f.date !== undefined && f.date) sess.date = f.date;
      if (f.endDate !== undefined)   sess.endDate = f.endDate;
      /* ★ 2026-08-13 작업유형. 클라우드는 'facility'/'home', 로컬은 'facility'/'household' 표기다. */
      if (f.workType !== undefined && f.workType) {
        var _wt = (f.workType === 'facility') ? 'facility' : 'household';
        if (sess.workType !== _wt) {
          sess.workType = _wt;
          if (_wt === 'facility' && !sess.facilityCustomer) sess.facilityCustomer = {};
        }
      }
      /* ★ 2026-08-13 호수 이름. 이게 없으면 상대가 바꾼 호수명이
         다음 syncAll 의 unitNames 재업로드로 되돌아간다.
         호수가 1개일 때만 반영한다(여러 개면 애초에 수정 자체를 잠가 뒀다). */
      if (f.unit !== undefined && f.unit && Array.isArray(sess.units) && sess.units.length === 1) {
        sess.units[0].name = f.unit;
      }
      /* ★ 2026-08-16 업종. 이게 없으면 상대가 바꾼 업종이 다음 syncAll 의
         재업로드(toPayload 가 로컬 session 을 읽는다)로 옛 값으로 되돌아간다.
         ⚠️ 상대가 보낸 아이콘·이름은 '스냅샷'으로만 저장한다 —
            상대의 프로필 id 를 내 프로필 목록에 넣지 않는다(표시 전용). */
      if (f.profileId !== undefined && f.profileId) {
        var _fs = f.profileSnap || null;
        var _snap = {
          name:        (_fs && _fs.name) || f.profileName || (sess.profileSnap && sess.profileSnap.name) || '',
          icon:        (_fs && _fs.icon) || f.profileIcon || (sess.profileSnap && sess.profileSnap.icon) || '',
          reportTitle: (_fs && _fs.reportTitle) || '',
          unitLabel:   (_fs && _fs.unitLabel) || '',
          stageLabel:  (_fs && _fs.stageLabel) || ''
        };
        /* ⭐ 내 업종 목록에 같은 이름이 있으면 **내 id 로 바꿔 단다.**
             안 그러면 내 작업인데 profileId 가 상대 폰 id 라
             작업탭 업종 칩이 '상대 업종'으로 잠겨 내가 못 바꾸게 된다.
             이름이 같으면 내 업종의 보고서 제목·호칭이 더 정확하므로 스냅샷도 내 것으로. */
        /* ⚠️ 2026-08-23 — 이름이 id 를 이긴다(Profiles.ownOf). 두 폰의 첫 업종 id 가
             둘 다 'pf_1' 이라 id 로 먼저 보면 남의 '에어컨 청소' 가 내 '기본' 에 걸린다.
             숨긴 업종까지 되짚으므로 손으로 정리해 둔 폰에서도 제대로 붙는다. */
        var _mine = null;
        try {
          if (window.Profiles && Profiles.ownOf) _mine = Profiles.ownOf({ profileId: f.profileId, profileSnap: _snap });
        } catch (e6) {}
        if (_mine) {
          sess.profileId = _mine.id;
          try { sess.profileSnap = Profiles.snapOf(_mine.id) || _snap; } catch (e7) { sess.profileSnap = _snap; }
        } else {
          sess.profileId = f.profileId;
          sess.profileSnap = _snap;
        }
      }
      if (f.name !== undefined)      { if (isFac) tc.contact = f.name; else tc.name = f.name; }
      if (f.target !== undefined)    tc.workTarget = f.target;
      if (f.phone !== undefined)     tc.phone = f.phone;
      if (f.address !== undefined)   tc.address = f.address;
      if (f.memo !== undefined)      tc.memo = f.memo;
      if (f.price !== undefined)     tc.price = f.price;
      if (f.startTime !== undefined) tc.startTime = f.startTime;
      if (f.endTime !== undefined)   tc.endTime = f.endTime;
      /* ★ 2026-08-13 로컬에 반영했으면 저장시각도 올린다.
         안 올리면 서버(상대 수정 시각)가 계속 더 최신이라 syncAll 의 충돌 가드가
         내 이후 저장까지 영영 막아버린다. (editItem 의 savedAt 과 짝) */
      try { sess.savedAt = (typeof kstIsoString === 'function') ? kstIsoString() : new Date().toISOString(); } catch (e5) {}
      var wh = await dir.getFileHandle('_session.json', { create: true });
      var wr = await wh.createWritable();
      await wr.write(new Blob([JSON.stringify(sess, null, 2)], { type: 'application/json' }));
      await wr.close();
      /* ⭐ 2026-08-13 여기가 '상대가 고쳤는데 내 폰에선 그대로'의 진짜 원인이었다.
         __calendarRefresh 는 _calItems/_dateMap 만 비우고 _monthCache 는 안 지운다.
         그래서 방금 파일을 고쳐도 달력은 '수정 전에 스캔해 둔 달 캐시'를 그대로 다시 써서
         디스크를 아예 안 읽는다(apt/가격 같은 건 오버라이드가 덮어줘서 되는 것처럼 보였고,
         메모·담당자처럼 오버라이드로 안 그리는 값은 영영 옛날 값이었다).
         → 해당 '달'의 캐시만 버리고 다시 그린다. 전체를 지우지 않으므로 재스캔은 1개월치뿐. */
      try {
        /* ⚠️ 한 작업이 두 달의 캐시에 동시에 들어간다.
           scanFoldersDirect 는 '폴더명 달 + 이전 달'을 읽고, 이전 달 폴더는
           endDate 가 이번 달까지 걸칠 때만 포함한다. 그래서 시작달만 지우면
           걸침 작업(예: 7/30 시작 ~ 8/10 종료)을 8월에서 보고 있을 때 여전히 옛 값이다.
           → 시작달·종료달·폴더명달을 모두 무효화한다(보통 1~2개라 비용은 같다). */
        var _ms = {};
        [String(sess.date || ''), String(sess.endDate || ''), String(workId || '')].forEach(function (v) {
          var mm = v.slice(0, 7);
          if (/^\d{4}-\d{2}$/.test(mm)) _ms[mm] = 1;
          // 걸침 작업은 다음 달 캐시에도 들어가므로 종료달 다음 달까지는 필요 없다(종료달이 곧 그 달)
        });
        var _mk = Object.keys(_ms);
        if (_mk.length) {
          _mk.forEach(function (mm) {
            delete _monthCache[mm];
            try { localStorage.removeItem(CAL_LS_PREFIX + mm); } catch (e3) {}
          });
          console.log('[달력] 달 캐시 무효화:', _mk.join(', '));
        } else {
          _monthCache = {};   // 날짜를 못 읽으면 안전하게 전체 무효화
        }
        _boundaryScanCache = {}; _boundaryKey = '';
        if (typeof window.__calendarRefresh === 'function') window.__calendarRefresh();
      } catch (e4) { console.warn('[달력] 캐시 무효화 실패', e4); }
      console.log('[달력] 공유 수정 → 로컬 반영 완료:', workId);
      return true;
    } catch (e) { console.warn('[달력] 로컬 반영 실패', workId, e); return false; }
  };

  // 사진 담당: 공유 일정에 사진 추가 → 일정 정보로 새 작업 미리 채우기
  window.startPhotoWorkFromSchedule = async function (sw) {
    try {
      sw = sw || {};
      var modal = document.getElementById('customerModal');
      if (modal) modal.classList.remove('open');
      _isOpen = false;
      if (typeof switchTab === 'function') switchTab('work');
      if (typeof newWork === 'function') await newWork(sw.date);
      // 새 작업 준비가 안 됐으면(사용자가 새작업 시작을 취소) 중단
      if (typeof units === 'undefined') { if (typeof showToast==='function') showToast('작업 화면을 열 수 없습니다','err'); return; }
      if (units.length !== 0) return;
      // 작업명
      var aptEl = document.getElementById('aptName');
      if (aptEl) aptEl.value = sw.apt || '';
      // 호수 + 고객정보 미리 채우기 (첫 호수에 일정의 고객정보)
      var names = (sw.unitNames && sw.unitNames.length) ? sw.unitNames.slice() : [''];
      names.forEach(function (nm, idx) {
        var cust = { phone: '', address: '', memo: '' };
        if (idx === 0) {
          cust.workTarget = sw.target || '';
          cust.phone      = sw.phone || '';
          cust.address    = sw.address || '';
          cust.memo       = sw.memo || '';
          cust.price      = (sw.price != null && sw.price !== '') ? String(sw.price) : '';
          cust.startTime  = sw.startTime || '';
          cust.endTime    = sw.endTime || '';
        }
        units.push({ id: nid++, name: nm || '', before: [], after: [], specials: [], open: true, customer: cust });
      });
      if (typeof renderAll === 'function') renderAll();
      if (typeof updateStats === 'function') updateStats();
      if (typeof sessionAutoSaveNow === 'function') { try { await sessionAutoSaveNow(); } catch(e){} }
      if (typeof showToast === 'function') showToast('일정을 불러왔어요. 사진을 추가하고 저장하면 내 작업이 됩니다', 'ok');
    } catch (e) { console.warn('[달력] startPhotoWork 오류', e); }
  };

  /* ══════════════════════════════════════════
     초기화
  ══════════════════════════════════════════ */
  function init() {
    interceptRenderCustomerList();
    interceptOpenCustomerModal();
    hookCacheInvalidation();
    watchModalClose();
    // ★ bindRefreshBtn 제거 — customers.js 원래 핸들러가 invalidateRecordsCache 호출
    //   → 내 훅이 캘린더 갱신 (이중 처리 방지)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
