/* ═══════════════════════════════════════════════════════════
   PROFILES ─ 사업자(biz) + 업종 프로필(profile)   2026-08-16 신설

   왜 필요한가:
     현장 작업자는 한 업종만 하지 않는다(에어컨 청소 / 에어컨 설치 / 실링팬 /
     조명 / 선반 …). 그런데 지금까지 업종은 '보고서 제목·호수 호칭·단계 호칭'
     세 글자를 정해주는 일회성 설정이었고, 업종과 같이 바뀌어야 하는 것들이
     전부 전역 키 하나씩이었다.
       · AI 글쓰기 지침  claude_blog_guideline / claude_write_guide_*
       · 견적서·명세서 내 양식  docsTemplate_quote / docsTemplate_statement
       · 가격표  ac_docs_pricebook
       · 견적 교정 학습  ai_quote_corrections
     그래서 에어컨 지침을 써두고 조명 글을 쓰면 에어컨 가격표가 섞여 나왔다.

   구조 (2계층):
     사업자(biz)  = 사업자등록증 단위. 상호·사업자번호·대표·주소·계좌·연락처
     업종 프로필  = 업종 단위. 라벨 3종 + 지침 + 양식 + 가격표. bizId 로 사업자 참조
     → 사용자는 '업종'만 고르면 된다. 사업자는 프로필에 딸려온다.
       사업자가 1개면 사용자는 2계층이라는 걸 알 필요조차 없다(UI에서 숨김).

   ⭐ 마이그레이션을 '하지 않는' 설계 (중요)
     첫 프로필(pf_1)은 **기존 키를 그대로 쓴다**(key() 참고).
     지침·양식·가격표를 새 키로 옮기지 않으므로 기존 사용자 데이터가
     이동 중에 유실될 위험이 원천적으로 없다. 두 번째 프로필부터
     '__pf_2' 같은 꼬리표가 붙는다.

   ⚠️ ac_co_v2 는 이제 '현재 프로필의 파생 뷰'다(진실의 원천 아님).
     기존 코드가 여기저기서 읽고 있어서 남겨둔 것이며,
     프로필이 바뀔 때마다 Profiles.syncCoKey() 가 다시 쓴다.
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  window.Profiles = window.Profiles || {};
  var P = window.Profiles;

  var BIZ_KEY = 'ac_biz_list';
  var PF_KEY  = 'ac_profiles';
  var CUR_KEY = 'ac_profile_current';
  var CO_K    = 'ac_co_v2';          // 파생 뷰 (state.js CO_KEY 와 같은 값)

  var FIRST_BIZ = 'biz_1';
  var FIRST_PF  = 'pf_1';
  /* ⭐ 2026-08-21 — '씨앗(seed) 표시'.
     P.ensure() 는 스크립트 로드 시점에 돌아서, 재설치 직후엔 서버 복구(CloudBackup.pull)보다
     **항상 먼저** 빈 프로필 pf_1 을 만들어 버린다. pull() 은 "로컬이 비었을 때만 채우는"
     비파괴 복구라, 이 빈 껍데기 때문에 ac_profiles/ac_biz_list 복구가 통째로 스킵됐다.
     → ensure() 가 스스로 만들었을 때만 이 표시를 남겨서, pull() 이 "이건 사용자 데이터가 아니라
       내가 방금 만든 빈 껍데기"임을 알고 덮어쓸 수 있게 한다.
     사용자가 업종을 실제로 만들거나 고치면(P.save/setCurrent/사업자 저장) 즉시 지워진다. */
  var SEED_KEY  = 'ac_pf_seed_v1';

  // 사업자에 담기는 필드 ↔ 기존 ac_co_v2 필드명 대응
  var BIZ_MAP = {
    name: 'coName', brand: 'coBrand', tel: 'coTel', bizNo: 'coBiz',
    addr: 'coAddr', email: 'coEmail', web: 'coWeb', desc: 'coDesc',
    bank: 'coBank', ceo: 'coCeo'
  };
  // 프로필에 담기는 필드 ↔ 기존 ac_co_v2 필드명 대응
  var PF_MAP = {
    reportTitle: 'coReportTitle', unitLabel: 'coUnitLabel', stageLabel: 'coStageLabel',
    industryMajor: 'coIndustryMajor', industryMinor: 'coIndustryMinor'
  };

  /* ── 업종 아이콘 ───────────────────────────────────────
     스케줄 목록 왼쪽(시간 위)에 띄워 어느 업종의 작업인지 한눈에 보게 한다.
     프로필에 icon 이 없으면 대분류 기본 아이콘으로 떨어진다. */
  var MAJOR_ICON = {
    cleaning: '🧼', construction: '🔧', auto: '🚗', realestate: '🏠',
    building: '🏗️', insurance: '📋', farm: '🌾', service: '✨', public: '🏛️',
    my: '⭐', custom: '🛠️'
  };
  P.ICON_CHOICES = ['svg:ac_wall','svg:tv_wall','svg:shelf_wall','svg:washer','svg:fan_ceiling','🧼','❄️','🌬️','💡','🌀','📺','🗄️','🧺','🔧','⚡','🚰','💨','🚿','🪟','🎨','🧻','🪛',
                    '🚗','🏠','🏗️','🛠️','🪜','🧯','🐜','📦','🔩','🚪','🪑','🧰','🌡️','📹','🔐','⛑️'];

  /* 아이콘 결정 순서
       ① 프로필에 직접 지정한 icon
       ② industries.js 의 그 업종 항목 icon   ← 이번에 업종마다 다 붙였다
       ③ 대분류 기본 아이콘
     ②가 있어서 이전에 만든 프로필(아이콘 없이 저장된 것)도 자동으로 제 아이콘을 갖는다. */
  function catalogIcon(majorId, minorId) {
    try {
      if (typeof findIndustryItem === 'function') {
        var it = findIndustryItem(majorId, minorId);
        if (it && it.icon) return it.icon;
      }
    } catch (e) {}
    return '';
  }
  /* ⚠️ 2026-08-16 — 아이콘이 안 바뀌던 진짜 원인
       예전엔 업종을 만들 때 카탈로그 아이콘을 **프로필에 복사해 저장**했다.
       그래서 industries.js 의 아이콘을 바꿔도(에어컨 설치 🌬️ → 벽걸이 그림)
       이미 만들어진 프로필은 옛 사본이 이겨서 영영 안 바뀌었다.
       → 이제 자동 배정 아이콘은 **저장하지 않는다.** 카탈로그를 그때그때 본다.
         사용자가 편집창에서 직접 고른 경우에만 iconSet:true 와 함께 저장한다. */
  P.iconOf = function (pf) {
    if (!pf) return '🛠️';
    /* ⭐ 이미지 아이콘인데 데이터가 없으면(지워졌거나 아직 못 받았거나)
         깨진 칸 대신 대체 이모지를 돌려준다. */
    if (pf.iconSet && P.isImgIcon(pf.icon) && !P.imgDataOf(pf.icon)) {
      return pf.iconFallback || catalogIcon(pf.industryMajor, pf.industryMinor)
             || MAJOR_ICON[pf.industryMajor] || '🛠️';
    }
    if (pf.iconSet && pf.icon) return pf.icon;                    // 사용자가 직접 고른 것
    var ci = catalogIcon(pf.industryMajor, pf.industryMinor);     // 카탈로그(항상 최신)
    if (ci) return ci;
    if (pf.icon) return pf.icon;                                  // 직접입력 업종 등 카탈로그가 없을 때
    return MAJOR_ICON[pf.industryMajor] || '🛠️';
  };
  // 업종 목록 항목의 기본 아이콘 (프로필을 새로 만들 때 채워 넣는다)
  P.defaultIconFor = function (majorId) { return MAJOR_ICON[majorId] || '🛠️'; };
  P.catalogIcon = catalogIcon;

  /* ── 그림(SVG) 아이콘 ──────────────────────────────────
     ⚠️ 유니코드에는 '에어컨' 이모지가 없다(제안만 있고 채택 안 됨).
        ❄️·🌬️ 같은 대체 이모지는 '차갑다/바람'일 뿐 벽걸이 에어컨으로 안 읽힌다.
        그래서 icon 값이 'svg:이름' 이면 아래 그림을 그린다.

     아이콘 값 두 가지:
       · 이모지 문자     예) '💡'
       · 'svg:ac_wall'   예) 벽걸이 에어컨 그림

     ⚠️ 한 곳만 예외 — 일정추가·상세창의 <select> 는 <option> 안에 그림을 넣을 수 없다.
        거기서는 iconText() 가 대체 이모지를 돌려준다(SVG_FALLBACK). */
  var SVG_ICONS = {
    /* 벽걸이 에어컨 (사용자가 보내준 그림 기준, 2026-08-16)
       본체 + 상단 표시등 3개 + 우측 센서 + 디스플레이 바 + 하단 루버 + 바람 7줄.
       ⚠️ 색은 전부 currentColor 다 — 시간칸(청록)·선택된 칩(흰색)·라이트 모드까지
          같은 아이콘이 다섯 가지 배경 위에 올라간다. 색을 고정하면 어딘가에서 사라진다.
          원본의 하늘색 느낌은 opacity 로 살렸다. */
    ac_wall: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.6" y="3.6" width="20.8" height="8.4" rx="2.4" stroke-width="1.3"/><g fill="currentColor" stroke="none" opacity=".62"><circle cx="4.7" cy="6.2" r="0.46"/><circle cx="6.2" cy="6.2" r="0.46"/><circle cx="7.7" cy="6.2" r="0.46"/><rect x="4.4" y="9.4" width="14" height="1.05" rx="0.52"/></g><path d="M19.1 8.05V7a0.92 0.92 0 0 1 1.84 0v1.05z" stroke-width="1"/><rect x="2.9" y="12.1" width="18.2" height="1.95" rx="0.95" stroke-width="1.1"/><g stroke-width="0.72" opacity=".75"><path d="M5.0 12.5v1.5"/><path d="M7.0 12.5v1.5"/><path d="M9.0 12.5v1.5"/><path d="M11.0 12.5v1.5"/><path d="M13.0 12.5v1.5"/><path d="M15.0 12.5v1.5"/><path d="M17.0 12.5v1.5"/><path d="M19.0 12.5v1.5"/></g></svg>'
  };
  SVG_ICONS.tv_shelf = /* 벽걸이TV 1단 가로 선반 — 벽걸이라 다리/브래킷 없음(사용자 지적 2026-08-16) */
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4.4h20" stroke-width="1" opacity=".3"/><rect x="8.6" y="7" width="6.8" height="4" rx="0.7" stroke-width="1.15" opacity=".5"/><rect x="2.2" y="12.4" width="19.6" height="3.2" rx="1" stroke-width="1.5"/><path d="M2.2 14.3h19.6" stroke-width="0.85" opacity=".45"/></svg>';
  SVG_ICONS.fan_ceiling = /* 실링팬 (사용자가 보내준 사진 기준, 2026-08-16)
       천장선 + 봉 + 모터 하우징 + 좌우로 뻗은 큰 날개 2장 + 뒤쪽으로 넘어간 날개 1장(흐리게).
       위에서 내려다본 3날개 배치도 그려 봤지만 12px 에서 뭉쳐 새처럼 보였다 → 정면 실루엣 채택. */
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.4 3.0h19.2" stroke-width="1" opacity=".3"/><path d="M12 3.0v5.1" stroke-width="1.5"/><g fill="currentColor" stroke="none"><path d="M11.0 8.5 C13.6 7.2 17.0 6.9 20.0 7.5 C17.5 9.1 14.2 10.0 11.8 10.0Z" opacity=".45"/><ellipse cx="12" cy="11.2" rx="3.05" ry="2.05"/><path d="M9.4 10.4 C6.2 11.2 3.1 13.1 0.8 15.8 C4.2 15.8 8.0 14.0 10.2 12.3Z"/><path d="M14.6 10.4 C17.8 11.2 20.9 13.1 23.2 15.8 C19.8 15.8 16.0 14.0 13.8 12.3Z"/></g></svg>';
  /* ★ 2026-08-17 사용자가 보내준 실물 사진 3장을 보고 새로 그렸다.
       선만 쓰지 않고 **덩어리와 명암**을 넣어 사진의 인상을 살렸다.
       ⚠️ 색은 절대 고정하지 않는다 — 이 그림은 어두운 카드·청록 시간칸·
          청록 칩(글자 흰색)·라이트 모드까지 배경이 다른 다섯 곳에 올라간다.
          그래서 currentColor 위에 **투명도만 겹쳐** 명암을 냈다. */
  SVG_ICONS.tv_wall = /* 벽걸이 TV — 얇은 베젤 + 검은 화면 + 아래 사운드바
       (사운드바가 없으면 15px 에서 그냥 사각 액자로 읽힌다) */
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<rect x="1.5" y="3.7" width="21" height="13.2" rx="1.5" fill="currentColor" stroke="none" opacity=".16"/>'
    + '<rect x="3.1" y="5.3" width="17.8" height="10" rx="0.6" fill="currentColor" stroke="none" opacity=".62"/>'
    + '<path d="M5.2 6.6 L8.6 6.6 L4.6 12.2 L4.6 8.4 Z" fill="currentColor" stroke="none" opacity=".14"/>'
    + '<rect x="1.5" y="3.7" width="21" height="13.2" rx="1.5" stroke-width="1.3"/>'
    + '<path d="M12 16.9 L12 19.1" stroke-width="1" opacity=".5"/>'
    + '<rect x="6.9" y="19.1" width="10.2" height="2" rx="1" fill="currentColor" stroke="none" opacity=".62"/>'
    + '<rect x="6.9" y="19.1" width="10.2" height="2" rx="1" stroke-width="1"/></svg>';

  SVG_ICONS.shelf_wall = /* 벽걸이 선반(수납장) — 정면. 가운데 환기 그릴이 식별 포인트 */
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M2 5.2h20" stroke-width="1" opacity=".25"/>'
    + '<rect x="1.5" y="8.6" width="21" height="6.8" rx="1.4" fill="currentColor" stroke="none" opacity=".36"/>'
    + '<rect x="8.7" y="8.6" width="6.6" height="6.8" fill="currentColor" stroke="none" opacity=".2"/>'
    + '<g stroke-width=".95" opacity=".6"><path d="M10.2 10.5v3"/><path d="M11.5 10.5v3"/>'
    + '<path d="M12.8 10.5v3"/><path d="M14.1 10.5v3"/></g>'
    + '<rect x="1.5" y="8.6" width="21" height="6.8" rx="1.4" stroke-width="1.3"/>'
    + '<g stroke-width=".85" opacity=".45"><path d="M8.7 8.6v6.8"/><path d="M15.3 8.6v6.8"/></g>'
    + '<path d="M4.6 17.4h14.8" stroke-width=".9" opacity=".18"/></svg>';

  SVG_ICONS.washer = /* 드럼 세탁기·건조기 — 상단 조작부(다이얼+표시창) + 큰 드럼 도어 + 우측 측판 */
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M18.6 3.2 L21.3 2.15 L21.3 19.45 L18.6 21.4 Z" fill="currentColor" stroke="none" opacity=".3"/>'
    + '<rect x="2.2" y="3.2" width="16.4" height="18.2" rx="1.7" fill="currentColor" stroke="none" opacity=".13"/>'
    + '<path d="M2.2 7.6 L18.6 7.6" stroke-width=".85" opacity=".4"/>'
    + '<rect x="12.9" y="4.15" width="4.7" height="2.3" rx=".55" fill="currentColor" stroke="none" opacity=".72"/>'
    + '<circle cx="9.5" cy="5.3" r="1.45" stroke-width=".95"/>'
    + '<circle cx="9.5" cy="5.3" r=".4" fill="currentColor" stroke="none" opacity=".6"/>'
    + '<g stroke-width=".7" opacity=".4"><path d="M3.6 4.3h2.6"/><path d="M3.6 5.35h2"/><path d="M3.6 6.4h2.6"/></g>'
    + '<circle cx="10.4" cy="14.2" r="5.8" fill="currentColor" stroke="none" opacity=".18"/>'
    + '<circle cx="10.4" cy="14.2" r="4.55" fill="currentColor" stroke="none" opacity=".3"/>'
    + '<circle cx="10.4" cy="14.2" r="3.45" fill="currentColor" stroke="none" opacity=".55"/>'
    + '<path d="M8.1 11.6 A3.45 3.45 0 0 0 7.4 14.6" stroke-width=".8" opacity=".22"/>'
    + '<circle cx="10.4" cy="14.2" r="5.8" stroke-width="1.15"/>'
    + '<circle cx="10.4" cy="14.2" r="3.45" stroke-width=".85" opacity=".55"/>'
    + '<path d="M2.2 20.1 L18.6 20.1" stroke-width=".85" opacity=".38"/>'
    + '<rect x="2.2" y="3.2" width="16.4" height="18.2" rx="1.7" stroke-width="1.3"/>'
    + '<path d="M18.6 3.2 L21.3 2.15 L21.3 19.45 L18.6 21.4" stroke-width="1.15"/></svg>';

  /* ⚠️ tv_shelf 는 그림만 남겨 둔다 — 예전에 이 값을 직접 고른 프로필이 있을 수 있다.
       카탈로그(industries.js)와 아이콘 고르기 목록에서는 shelf_wall 로 대체됐다. */
  var SVG_FALLBACK = { ac_wall: '❄️', tv_shelf: '🗄️', fan_ceiling: '🌀',
                       tv_wall: '📺', shelf_wall: '🗄️', washer: '🧺' };   // <option> 등 그림을 못 쓰는 곳
  P.SVG_KEYS = Object.keys(SVG_ICONS);

  P.isSvgIcon = function (ic) { return typeof ic === 'string' && ic.indexOf('svg:') === 0; };

  /* ═══ ⭐ 2026-08-17 사용자가 올린 이미지 아이콘 ═════════════
     이모지 직접입력을 대체한다(사용자 요청: "이모지 직접 입력은 좀 이상해").

     ⚠️ 왜 이미지 '데이터'를 아이콘 값에 넣으면 안 되는가 —
        profileIcon 은 **모든 작업 항목에 그대로 복사되는 평면 필드**다.
          cloud_sync.js toPayload(Firestore 항목 문서)
          calendar.js _slimCalItems(localStorage 월 캐시)
          work_index.js sessionToIndexEntry(기록·고객 목록)
        여기에 base64 를 넣으면 작업 수만큼 곱해져 Firestore 비용과
        localStorage 5MB 한도를 동시에 때린다.
     → 아이콘 값에는 **참조만** 넣고, 데이터는 프로필당 한 벌만 둔다.

     아이콘 값 3종:
       '💡'                  이모지
       'svg:ac_wall'         내장 그림
       'img:pf_ab'           내 이미지  → localStorage key('ac_pf_icon', pfId)
       'img:<uid>:<슬러그>'  상대 이미지 → users/{uid}.profileIcons[슬러그]
     ⭐ 상대에게 보낼 때는 '이름 슬러그' 로 바꿔 보낸다 — profileId 는 폰마다 다르고
        **이름이 공용 키**라는 기존 규약([[project_industry_shared_sync]])을 그대로 따른다. */
  var ICON_IMG_BASE = 'ac_pf_icon';
  var _imgMemo = {};                       // 렌더당 localStorage 재파싱 방지
  P.isImgIcon = function (ic) { return typeof ic === 'string' && ic.indexOf('img:') === 0; };
  P.iconImgKey = function (pfId) { return P.key(ICON_IMG_BASE, pfId); };
  P.iconSlug = function (name) {
    return String(name == null ? '' : name).trim().replace(/[\s.\/\[\]#$~*`'"<>&\\]/g, '_').slice(0, 40);
  };
  P.getIconImage = function (pfId) {
    if (!pfId) return '';
    if (Object.prototype.hasOwnProperty.call(_imgMemo, pfId)) return _imgMemo[pfId];
    var v = '';
    try { v = localStorage.getItem(P.iconImgKey(pfId)) || ''; } catch (e) {}
    _imgMemo[pfId] = v;
    return v;
  };
  P.setIconImage = function (pfId, dataUrl) {
    if (!pfId) return false;
    try {
      if (dataUrl) localStorage.setItem(P.iconImgKey(pfId), dataUrl);
      else localStorage.removeItem(P.iconImgKey(pfId));
      _imgMemo[pfId] = dataUrl || '';
      return true;
    } catch (e) {
      /* 용량 초과 등 — 조용히 실패하면 아이콘만 안 바뀐 채 저장된 것처럼 보인다 */
      _imgMemo[pfId] = '';
      return false;
    }
  };
  P.clearIconImage = function (pfId) { return P.setIconImage(pfId, ''); };
  P.dropIconMemo = function () { _imgMemo = {}; };

  /* 아이콘 값 → 실제 이미지 데이터(dataURL). 못 찾으면 빈 문자열. */
  P.imgDataOf = function (ic) {
    if (!P.isImgIcon(ic)) return '';
    var rest = ic.slice(4);
    var sep = rest.indexOf(':');
    if (sep < 0) return P.getIconImage(rest);                 // 내 것: img:pf_ab
    var uid = rest.slice(0, sep), slug = rest.slice(sep + 1);  // 상대 것: img:<uid>:<슬러그>
    try {
      if (window.CloudShare && CloudShare.iconDataOf) return CloudShare.iconDataOf(uid, slug) || '';
    } catch (e) {}
    return '';
  };
  /* ★ 2026-08-16 사용자가 직접 넣는 이모지 정리.
     아이콘 값은 여러 화면에서 그대로 HTML 로 붙으므로(iconHtml 은 그림이 아니면 원문을 돌려준다)
     태그가 될 수 있는 글자는 여기서 걷어낸다. 그림(svg:) 값은 손대지 않는다.
     이모지는 한 글자가 코드 여러 개(가족 이모지·피부톤)라서 '글자 수'가 아니라
     Intl.Segmenter 로 세어 2글자까지만 남긴다(없는 기기는 길이로 자른다). */
  P.sanitizeIcon = function (s) {
    var v = String(s == null ? '' : s).replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim();
    if (!v) return '';
    try {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        var seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
        var out = '', n = 0;
        for (var it of seg.segment(v)) { out += it.segment; if (++n >= 2) break; }
        return out;
      }
    } catch (e) {}
    return v.length > 8 ? v.slice(0, 8) : v;
  };

  /* 화면에 넣을 HTML. 이모지면 글자 그대로, 그림이면 <span> 안에 SVG.
     size 는 px(기본 18). 색은 currentColor 라 주변 글자색을 따라간다. */
  P.iconHtml = function (pf, size) {
    var ic = (typeof pf === 'string') ? pf : P.iconOf(pf);
    if (P.isImgIcon(ic)) {
      var data = P.imgDataOf(ic);
      /* 아직 못 받은 상대 아이콘 — 기본 그림으로 두고, users 문서 스냅샷이 오면
         refreshCal 이 다시 그린다(cloud_share _subProfile). */
      if (!data) return '🛠️';
      var ipx = size || 18;
      return '<img src="' + data + '" alt="" style="width:' + ipx + 'px;height:' + ipx + 'px;' +
             'border-radius:' + Math.max(3, Math.round(ipx * 0.22)) + 'px;object-fit:cover;' +
             'vertical-align:-3px;display:inline-block;">';
    }
    if (!P.isSvgIcon(ic)) return ic;
    var key = ic.slice(4);
    var svg = SVG_ICONS[key];
    if (!svg) return SVG_FALLBACK[key] || '🛠️';
    var px = size || 18;
    return '<span style="display:inline-block;width:' + px + 'px;height:' + px + 'px;vertical-align:-3px;">' +
           svg.replace('<svg ', '<svg width="' + px + '" height="' + px + '" ') + '</span>';
  };
  /* 그림을 못 쓰는 곳(<option>, 알림 문구 등)에서 쓸 글자 아이콘 */
  P.iconText = function (pf) {
    var ic = (typeof pf === 'string') ? pf : P.iconOf(pf);
    // <option> 안에는 그림도 이미지도 못 넣는다 — 글자로 떨어뜨린다
    if (P.isImgIcon(ic)) return (typeof pf === 'object' && pf && pf.iconFallback) || '🛠️';
    if (!P.isSvgIcon(ic)) return ic;
    return SVG_FALLBACK[ic.slice(4)] || '🛠️';
  };

  function lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lset(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function jget(k, dflt) { try { var v = JSON.parse(lget(k) || 'null'); return v == null ? dflt : v; } catch (e) { return dflt; } }
  function jset(k, v) { lset(k, JSON.stringify(v)); }
  function uid(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

  /* ── 사업자 ──────────────────────────────────────────── */
  /* ── seed 표시 조회/해제 (CloudBackup.pull 이 사용) ── */
  P.seeded = function () { return lget(SEED_KEY) === '1'; };
  P.clearSeed = function () { try { localStorage.removeItem(SEED_KEY); } catch (e) {} };

  P.bizList = function () { var a = jget(BIZ_KEY, []); return Array.isArray(a) ? a : []; };
  P.bizGet = function (id) { return P.bizList().filter(function (b) { return b && b.id === id; })[0] || null; };
  P.bizSave = function (biz) {
    if (!biz) return null;
    var list = P.bizList();
    if (!biz.id) biz.id = uid('biz_');
    var i = list.findIndex(function (b) { return b.id === biz.id; });
    if (i >= 0) list[i] = Object.assign({}, list[i], biz); else list.push(biz);
    P.clearSeed();               // 실제 사용자 데이터가 생겼다 → 더 이상 빈 껍데기 아님
    jset(BIZ_KEY, list);
    return biz.id;
  };
  /* 사업자 삭제 = 참조하는 프로필이 없을 때만. 있으면 거절(옛 작업 보고서가 깨진다) */
  P.bizDelete = function (id) {
    if (P.list({ includeHidden: true }).some(function (p) { return p.bizId === id; })) return false;
    P.clearSeed();
    jset(BIZ_KEY, P.bizList().filter(function (b) { return b.id !== id; }));
    return true;
  };

  /* ── 업종 프로필 ─────────────────────────────────────── */
  P.list = function (opt) {
    var a = jget(PF_KEY, []);
    if (!Array.isArray(a)) a = [];
    if (!(opt && opt.includeHidden)) a = a.filter(function (p) { return p && !p.hidden; });
    return a.slice().sort(function (x, y) { return (x.order || 0) - (y.order || 0); });
  };
  P.get = function (id) {
    if (!id) return null;
    return P.list({ includeHidden: true }).filter(function (p) { return p.id === id; })[0] || null;
  };
  P.save = function (pf) {
    if (!pf) return null;
    var all = jget(PF_KEY, []);
    if (!Array.isArray(all)) all = [];
    if (!pf.id) {
      pf.id = uid('pf_');
      if (pf.order == null) pf.order = all.length + 1;
    }
    var i = all.findIndex(function (p) { return p && p.id === pf.id; });
    if (i >= 0) all[i] = Object.assign({}, all[i], pf); else all.push(pf);
    P.clearSeed();               // 실제 사용자 데이터가 생겼다 → 더 이상 빈 껍데기 아님
    jset(PF_KEY, all);
    if (pf.id === P.currentId()) P.syncCoKey();
    return pf.id;
  };
  /* ⚠️ 프로필은 지우지 않고 숨긴다.
     지운 프로필을 참조하는 옛 작업이 남아 보고서 제목·호칭이 깨지기 때문이다. */
  P.hide = function (id) {
    var pf = P.get(id);
    if (!pf) return false;
    if (P.list().length <= 1) return false;      // 마지막 하나는 숨길 수 없다
    P.save({ id: id, hidden: true });
    if (P.currentId() === id) P.setCurrent((P.list()[0] || {}).id);
    return true;
  };
  P.unhide = function (id) { return P.save({ id: id, hidden: false }); };

  /* ── 현재 프로필 ─────────────────────────────────────── */
  P.currentId = function () {
    var id = lget(CUR_KEY) || '';
    if (id && P.get(id) && !P.get(id).hidden) return id;
    var first = P.list()[0];
    return first ? first.id : '';
  };
  P.current = function () { return P.get(P.currentId()); };
  P.setCurrent = function (id) {
    if (!id || !P.get(id)) return false;
    P.dropIconMemo();          // 업종이 바뀌면 아이콘 메모도 새로
    P.clearSeed();
    lset(CUR_KEY, id);
    P.syncCoKey();
    try { if (typeof applyCustomLabels === 'function') applyCustomLabels(); } catch (e) {}
    try { if (window.ProfilesUI && ProfilesUI.renderWorkChip) ProfilesUI.renderWorkChip(); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('profileChanged', { detail: { id: id } })); } catch (e) {}
    return true;
  };

  /* ── ⭐ 프로필별 저장키 ────────────────────────────────
     첫 프로필은 기존 키 그대로 → 기존 사용자 데이터를 옮기지 않는다(유실 위험 0).
     예) key('claude_blog_guideline', 'pf_1') → 'claude_blog_guideline'
         key('claude_blog_guideline', 'pf_ab') → 'claude_blog_guideline__pf_ab'   */
  P.key = function (base, pfId) {
    if (pfId === undefined) pfId = P.currentId();
    if (!pfId || pfId === FIRST_PF) return base;
    return base + '__' + pfId;
  };
  // 이 base 키가 실제로 쓰이는 모든 변형(백업 대상 열거용)
  P.allKeysFor = function (base) {
    return P.list({ includeHidden: true }).map(function (p) { return P.key(base, p.id); })
            .filter(function (v, i, a) { return a.indexOf(v) === i; });
  };

  /* ── 작업 → 프로필 해석 ────────────────────────────────
     work.profileId 가 있으면 그것, 없으면 현재 프로필. */
  P.ofWork = function (work) {
    var id = work && (work.profileId || (work.session && work.session.profileId));
    return P.get(id) || P.current();
  };
  P.matchByName = function (name, opt) {
    name = String(name || '').trim();
    if (!name) return null;
    /* ⭐ 2026-08-23 opt.includeHidden — 목록에서 '뺀'(hidden) 업종도 여전히 **내 업종**이다.
         팀 업종이 들어오며 생긴 중복을 손으로 숨겨 놓으면, 상대가 보낸 같은 이름을
         못 찾아 내 작업이 통째로 '(상대 업종)' 으로 잠겼다(사용자 보고 2026-08-23).
         기본 동작은 그대로(보이는 것만) — 부르는 쪽이 명시할 때만 숨김까지 본다. */
    var list = P.list(opt && opt.includeHidden ? { includeHidden: true } : undefined);
    var hit = list.filter(function (p) { return (p.name || '').trim() === name; })[0];
    if (hit) return hit;
    /* ⭐ 2026-08-21 — 띄어쓰기·대소문자만 다른 표기까지 같은 업종으로 본다.
       업종은 목록이 아니라 **이름**으로 두 폰을 잇는다. 그래서 한쪽이 '에어컨 청소',
       다른 쪽이 '에어컨청소' 로 적어두면 공유가 통째로 끊겨 '(상대 업종)' 이 됐다.
       정확 일치를 먼저 보므로 기존 동작은 그대로고, 못 찾았을 때만 한 번 더 시도한다. */
    var norm = function (s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); };
    var n2 = norm(name);
    if (!n2) return null;
    return list.filter(function (p) { return norm(p.name) === n2; })[0] || null;
  };

  /* 지금 열린 작업의 프로필 — ⭐ '내가 쓸 것'(글쓰기 지침·견적 양식·가격표)용.

     ⚠️ 공유작업의 profileId 는 **상대 폰의 id** 라 내 목록에 없다.
        그래서 3단계로 떨어진다.
          ① 내 프로필에 그 id 가 있으면 그것 (= 내 작업)
          ② 없으면 스냅샷의 업종 '이름'으로 내 프로필을 찾는다
             (상대가 '조명 설치' 작업을 공유했고 나도 '조명 설치'가 있으면 내 조명 지침을 쓴다)
          ③ 그래도 없으면 지금 쓰는 업종
        상대의 지침·양식은 애초에 내 폰에 없으므로 '내 것'으로 떨어지는 게 맞다. */
  P.forCurrentWork = function () {
    return P.resolvedForWork() || P.current();
  };

  /* 지금 열린 작업의 업종을 **내 목록의 프로필로 확정**한다(없으면 null).
     id 가 안 맞아도 이름이 같으면 내 것으로 본다.

     ⚠️ 왜 필요한가: 공유작업에서 내가 업종을 바꾸면 그 값이 원작업자 폰으로 갔다가
        원작업자 id 로 바뀌어 되돌아온다. 그때 id 만 보면 '내가 방금 고른 업종'인데도
        남의 것으로 보여 작업탭 칩이 잠긴다(내가 바꾼 걸 내가 못 바꾸는 상태).
        이름이 같으면 내 업종이 맞으므로 열어준다. */
  P.resolvedForWork = function () {
    /* ownOf 와 같은 규칙(이름 > id)으로 통일한다 — 여기만 id 를 먼저 보면
       작업탭 칩과 상세창 드롭다운이 서로 다른 업종을 가리킨다. */
    return P.ownOf({ profileId: window._workProfileId, profileSnap: window._workProfileSnap });
  };

  /* 지금 열린 작업의 '표시값' — 보고서 제목·호수/단계 호칭·아이콘.
     ⭐ 여기는 스냅샷이 우선이다. 상대 작업의 보고서 제목은 상대 업종으로 나와야 하고,
        지난달 작업을 오늘 열어도 그때 업종으로 보여야 하기 때문.
     ⚠️ 스냅샷을 내 프로필 목록에 병합하지 말 것 — 표시 전용이다. */
  P.displayForCurrentWork = function () {
    var snap = window._workProfileSnap;
    var own  = P.resolvedForWork();          // 내 업종(id 또는 이름으로 확정)
    var base = P.info((own || P.current() || {}).id);

    if (own) {
      /* ⭐ 내 업종이면 **내 프로필의 지금 값**이 우선이다.
           업종 설정에서 보고서 제목을 고치면 곧바로 반영돼야 한다.
           스냅샷은 내 프로필에 값이 없을 때만 메운다. */
      if (!base.coReportTitle && snap && snap.reportTitle) base.coReportTitle = snap.reportTitle;
      if (!base.coUnitLabel   && snap && snap.unitLabel)   base.coUnitLabel   = snap.unitLabel;
      if (!base.coStageLabel  && snap && snap.stageLabel)  base.coStageLabel  = snap.stageLabel;
      base._profileName = own.name || (snap && snap.name) || '';
      base._profileIcon = P.iconOf(own);
      return base;
    }

    /* ⚠️ 내게 없는 업종(상대 작업 등)일 때가 버그의 진원지였다.
         base 는 '지금 쓰는 업종'이라 보고서 제목이 '에어컨 청소 보고서' 같은 엉뚱한 값이다.
         스냅샷이 반쪽(이름·아이콘만)이면 그 엉뚱한 제목이 그대로 표지에 찍혔다
         (아이콘·이름은 맞는데 제목만 딴 업종 — 사용자 보고 2026-08-16).
         → 상대 업종일 땐 '지금 업종'의 업종 3필드를 **절대 쓰지 않는다.**
           스냅샷에 없으면 업종 이름에서 만들고, 이름도 없으면 비운다(기본값으로 떨어짐). */
    var nm = (snap && snap.name) || '';
    /* 업종 정보가 아예 없는 작업(이번 기능 이전에 만든 것)은 예외 —
       여기서 비워버리면 옛 작업 보고서 제목이 통째로 사라진다. 지금 업종으로 둔다. */
    if (!nm) return base;

    base.coReportTitle = (snap && snap.reportTitle) || (nm + ' 보고서');
    base.coUnitLabel   = (snap && snap.unitLabel)   || '';
    base.coStageLabel  = (snap && snap.stageLabel)  || '';
    base._profileName  = nm;
    base._profileIcon  = (snap && snap.icon) || '';
    return base;
  };

  /* ⭐ 작업 하나의 업종을 '살아있는 값'으로 푼다 — 2026-08-16
       왜 필요한가: profileSnap 은 작업을 저장한 순간 **찍힌 사본**이다.
       그래서 나중에 업종 아이콘이나 보고서 제목을 바꿔도 옛 작업은 옛 값을 그대로 쓴다
       ("업종 목록엔 새 아이콘인데 기존 작업은 옛 아이콘" — 사용자 보고).
       → 그 업종이 **내 것이면 언제나 내 프로필의 지금 값**을 쓴다. 사본은
         내게 없는 업종(상대 작업)일 때만 쓴다. 그러면 한 번 고치면 전부 따라온다.

     work 은 어떤 모양이든 받는다:
       내 작업   {profileId, profileSnap} 또는 {session:{profileId, profileSnap}}
       공유 요약 {profileId, profileIcon, profileName, profileSnap} */
  P.readWork = function (w) {
    var pid = '', snap = null;
    try {
      if (w) {
        pid = w.profileId || (w.session && w.session.profileId) || '';
        snap = w.profileSnap || (w.session && w.session.profileSnap) || null;
        if (!snap && (w.profileIcon || w.profileName)) {
          snap = { icon: w.profileIcon || '', name: w.profileName || '' };
        }
      }
    } catch (e) {}
    return { id: pid, snap: snap };
  };
  /* 내 프로필로 확정(없으면 null). id 가 안 맞아도 이름이 같으면 내 것으로 본다. */
  /* ⭐⭐ 2026-08-23 — **이름이 id 를 이긴다.**
       왜: 두 폰의 '첫 업종' id 는 둘 다 'pf_1' 로 고정이다(P.ensure 의 FIRST_PF).
       팀장이 첫 업종 이름을 '에어컨 청소' 로 바꿔 쓰면 그 작업의 profileId 는 'pf_1',
       팀원 폰의 'pf_1' 은 아직 '기본' 이다. id 로 먼저 찾으면 **엉뚱하게 '기본' 이 잡힌다**
       ("팀장이 에어컨 청소를 고르면 팀원에겐 기본(목록에서 뺌)" — 사용자 보고 2026-08-23).
       다른 업종은 pf_<랜덤> 이라 겹치지 않아 멀쩡했다.
       → id 로 찾은 게 사본의 이름과 **어긋나면 버리고 이름으로 다시 찾는다.**
         사본에 이름이 없을 때만(옛 작업) 예전처럼 id 를 믿는다. */
  P.matchName = function (nm) {
    if (!nm) return null;
    return P.matchByName(nm) || P.matchByName(nm, { includeHidden: true });
  };
  P.ownOf = function (w) {
    var r = P.readWork(w);
    var nm = (r.snap && r.snap.name) ? String(r.snap.name).trim() : '';
    var byId = P.get(r.id);
    if (byId && !nm) return byId;                       // 이름 정보가 없으면 id 를 믿는다
    var norm = function (x) { return String(x || '').replace(/\s+/g, '').toLowerCase(); };
    if (byId && norm(byId.name) === norm(nm)) return byId;   // id·이름이 일치 → 확실히 내 것
    var byName = P.matchName(nm);
    if (byName) return byName;
    return byId || null;
  };
  /* 작업 하나의 아이콘 — 내 업종이면 지금 아이콘, 아니면 사본 아이콘 */
  P.iconForWork = function (w) {
    var own = P.ownOf(w);
    if (own) return P.iconOf(own);
    var r = P.readWork(w);
    return (r.snap && r.snap.icon) || '';
  };
  /* 작업 하나의 업종 이름 */
  P.nameForWork = function (w) {
    var own = P.ownOf(w);
    if (own) return own.name || '';
    var r = P.readWork(w);
    return (r.snap && r.snap.name) || '';
  };

  /* 작업에 함께 저장할 스냅샷.
     상대 폰엔 내 pf_id 가 없으므로 id 만 보내면 해석할 수 없다
     (남의 폰 파일명을 내 쪽에서 해석하려다 사진이 깨졌던 것과 같은 부류의 함정). */
  /* ⭐ 2026-08-17 — 이미지 아이콘을 '옮길 수 있는 형태'로 바꿔 싣는다.
       내 폰에서는 'img:pf_ab'(로컬 참조)지만 상대 폰엔 그 pf_ab 가 없다.
       → 'img:<내uid>:<이름슬러그>' 로 보내면 상대가 users/{내uid}.profileIcons 에서 찾는다.
       ⚠️ 이미지 '데이터'는 절대 여기 싣지 않는다 — 이 스냅샷은 작업마다 복사된다.
       로그인 전이거나 이미지가 없으면 대체 이모지로 떨어뜨린다(깨진 칸 방지). */
  P.portableIcon = function (pf) {
    var ic = P.iconOf(pf);
    if (!P.isImgIcon(ic)) return ic;
    var data = P.imgDataOf(ic);
    var myUid = '';
    try { if (window.Cloud && Cloud.user && Cloud.user.uid) myUid = Cloud.user.uid; } catch (e) {}
    if (data && myUid) return 'img:' + myUid + ':' + P.iconSlug(pf && pf.name);
    return (pf && pf.iconFallback) || '🛠️';
  };
  /* ═══ ⭐ 2026-08-23 팀 업종 받기 ═══════════════════════════
     팀장이 정한 업종 목록을 내 업종에 **병합**한다.

     설계 원칙 (사용자 확정 2026-08-23):
       · 이름·아이콘·호칭 3종만 맞춘다. 지침·양식·가격표·학습기록은 **절대 안 건드린다**
         (몇 달치 개인 자산이라 덮어쓰면 되돌릴 수 없다)
       · **삭제하지 않는다.** 팀에서 뺀 업종이 있어도 내 목록에선 그대로 둔다 → 데이터 유실 0
       · 개인 업종은 그대로 공존한다
       · 내가 직접 고른 아이콘(iconSet)은 존중한다 — 팀 아이콘으로 덮지 않는다

     ⭐ 이름이 공용 키다([[project_industry_shared_sync]]). 팀 업종을 뿌리면 팀원끼리
        업종 이름 표기가 통일되므로, 공유작업의 업종 매칭이 저절로 정확해진다. */
  P.mergeFromTeam = function (list) {
    /* r.map — 팀 항목 key(또는 이름) → **내 폰의 프로필 id**.
       팀 지침(가격표)을 어느 프로필 칸에 넣을지 알아야 해서 항상 채운다.
       손댄 것만이 아니라 '이미 맞는' 항목도 넣는다(안 그러면 지침이 첫 병합 때만 붙는다). */
    var r = { added: 0, updated: 0, healed: 0, map: {} };
    if (!Array.isArray(list) || !list.length) return r;
    r.healed = P.healNamelessProfiles();     // ⭐ 먼저 과거 오염을 치우고 시작한다
    var norm = function (x) { return String(x || '').replace(/\s+/g, '').toLowerCase(); };
    list.forEach(function (t) {
      var nm = String((t && t.name) || '').trim();
      if (!nm) return;
      var own = null;
      // ① 이름으로 (공백·대소문자 무시)
      try { own = P.matchByName(nm); } catch (e) {}
      // ② 숨긴 업종까지 뒤져서 있으면 되살린다 (matchByName 은 hidden 을 못 본다)
      if (!own) {
        try {
          var n2 = norm(nm);
          var hid = P.list({ includeHidden: true }).filter(function (p) { return p && p.hidden && norm(p.name) === n2; })[0];
          if (hid) { P.unhide(hid.id); own = P.get(hid.id); r.updated++; }
        } catch (e) {}
      }
      /* ③ 마지막 수단 — 보고서 제목이 똑같으면 같은 업종으로 본다.
           팀원이 팀장과 맞추려고 **수동으로 같은 업종을 만들어 둔** 경우, 이름 표기가 조금만
           달라도(괄호·중점·오타) 이름 매칭이 빗나가 같은 업종이 두 개가 된다.
           '에어컨 청소 보고서' 처럼 제목은 충분히 고유하므로 안전한 마지막 그물이다. */
      if (!own && t.reportTitle) {
        try {
          var rt = norm(t.reportTitle);
          own = P.list({ includeHidden: true }).filter(function (p) {
            return p && String(p.reportTitle || '') && norm(p.reportTitle) === rt;
          })[0] || null;
          if (own && own.hidden) { P.unhide(own.id); own = P.get(own.id); }
          if (own) console.log('[업종] 제목으로 매칭:', t.name, '→', own.name || own.id);
        } catch (e) {}
      }

      if (own) {
        r.map[String(t.key || nm)] = own.id;
        var patch = { id: own.id }, ch = false;
        if (!String(own.name || '').trim() && nm) { patch.name = nm; ch = true; }   // 이름이 비었으면 채운다
        ['reportTitle', 'unitLabel', 'stageLabel'].forEach(function (k) {
          if (t[k] && own[k] !== t[k]) { patch[k] = t[k]; ch = true; }
        });
        /* 아이콘 — '팀원이 직접 바꿨는가'를 teamIcon 으로 판별한다.
             own.icon === own.teamIcon  → 팀이 준 걸 그대로 쓰는 중 → 팀 값으로 갱신
             다르면                      → 팀원이 직접 고른 것 → 존중하고 건드리지 않는다 */
        if (t.icon && own.icon !== t.icon) {
          var followsTeam = (!own.iconSet) || (own.teamIcon && own.teamIcon === own.icon);
          if (followsTeam) { patch.icon = t.icon; patch.iconSet = true; patch.teamIcon = t.icon; ch = true; }
        } else if (t.icon && own.teamIcon !== t.icon) { patch.teamIcon = t.icon; ch = true; }
        if (ch) { try { P.save(patch); r.updated++; } catch (e) {} }
      } else {
        /* ⚠️ 2026-08-23 여기서 사고가 났었다.
             P.addCustom() 은 **id 문자열**을 돌려준다(P.save 의 반환값). 그걸 객체로 착각해
             Object.keys(문자열) 로 복사하니 {0:'p',1:'f',...} 가 되어 id 가 사라졌고,
             이어진 P.save 가 **이름 없는 프로필을 하나 더** 만들었다.
             → 팀 업종 하나마다 '이름 있는 것 + (이름 없음)' 두 개가 생겼다. */
        var newId = null;
        try { newId = P.addCustom(nm); } catch (e) {}
        if (newId) {
          var add = { id: newId, fromTeam: true };
          if (t.reportTitle) add.reportTitle = t.reportTitle;
          if (t.unitLabel)   add.unitLabel   = t.unitLabel;
          if (t.stageLabel)  add.stageLabel  = t.stageLabel;
          if (t.icon)      { add.icon = t.icon; add.iconSet = true; add.teamIcon = t.icon; }
          try { P.save(add); } catch (e) {}   // P.save 는 Object.assign 병합이라 부분 patch 로 충분
          r.map[String(t.key || nm)] = newId;
          r.added++;
        }
      }
    });
    if (r.added || r.updated || r.healed) { try { P.dropIconMemo(); } catch (e) {} }
    return r;
  };

  /* ⭐ 자가치유 — 이름이 빈 프로필을 정리한다.
       위 버그로 생긴 '(이름 없음)' 들을 치운다. 프로필은 지우지 않는다(옛 작업이 참조할 수 있다).
         · 같은 보고서 제목의 '이름 있는' 프로필이 있으면 → 아이콘·호칭을 그쪽으로 옮기고 이 프로필은 숨긴다
         · 짝이 없으면 → 보고서 제목에서 이름을 되살린다 */
  P.healNamelessProfiles = function () {
    var fixed = 0;
    try {
      var all = P.list({ includeHidden: true });
      var norm = function (x) { return String(x || '').replace(/\s+/g, '').toLowerCase(); };
      all.forEach(function (p) {
        if (!p || p.hidden) return;
        if (String(p.name || '').trim()) return;
        var twin = all.filter(function (q) {
          return q && q.id !== p.id && !q.hidden && String(q.name || '').trim() &&
                 String(q.reportTitle || '') && norm(q.reportTitle) === norm(p.reportTitle);
        })[0];
        if (twin) {
          var mv = { id: twin.id };
          if (p.icon)       { mv.icon = p.icon; mv.iconSet = true; }
          if (p.teamIcon)   mv.teamIcon = p.teamIcon;
          else if (p.icon)  mv.teamIcon = p.icon;
          if (p.unitLabel)  mv.unitLabel = p.unitLabel;
          if (p.stageLabel) mv.stageLabel = p.stageLabel;
          try { P.save(mv); } catch (e) {}
          try { P.save({ id: p.id, name: twin.name, hidden: true }); } catch (e) {}
          fixed++;
        } else {
          var nm2 = '';
          try { nm2 = P.guessName(p.reportTitle); } catch (e) {}
          if (nm2) { try { P.save({ id: p.id, name: nm2 }); fixed++; } catch (e) {} }
        }
      });
      if (fixed) console.log('[업종] 이름 없는 프로필 정리:', fixed, '건');
    } catch (e) { console.warn('[업종] 자가치유 실패', e && e.message); }
    return fixed;
  };

  /* 팀에 올릴 형태 — snapOf 와 같은 필드에 이름 슬러그 키를 얹는다 */
  P.teamEntryOf = function (pfId) {
    var sn = P.snapOf(pfId);
    if (!sn || !sn.name) return null;
    return { key: P.iconSlug(sn.name), name: sn.name, icon: sn.icon || '',
             reportTitle: sn.reportTitle || '', unitLabel: sn.unitLabel || '', stageLabel: sn.stageLabel || '' };
  };

  P.snapOf = function (pfId) {
    var pf = (pfId ? P.get(pfId) : P.current());
    if (!pf) return null;
    return {
      name: pf.name || '', icon: P.portableIcon(pf),
      reportTitle: pf.reportTitle || '', unitLabel: pf.unitLabel || '', stageLabel: pf.stageLabel || ''
    };
  };
  // 지금 열린 작업에 새겨 넣을 값 {profileId, profileSnap}
  P.stampForCurrentWork = function () {
    /* ⚠️ 2026-08-23 — 예전엔 비어 있으면 무조건 P.currentId() 로 떨어졌다.
         그래서 업종을 고른 적 없는 **옛 작업을 열어 저장하기만 해도** 지금 업종이 박혔다
         (작업A 에서 업종을 바꾸면 setCurrent 로 '지금 업종'이 바뀌고,
          이어서 무업종인 작업C 를 열어 저장하면 C 에 그 업종이 새겨졌다).
       → 새 작업일 때만 지금 업종을 새긴다. 저장된 작업을 연 것이면 비운 채로 둔다. */
    var loaded = false;
    try { loaded = !!window._workProfileLoaded; } catch (e) {}
    var id = window._workProfileId || (loaded ? '' : (P.currentId() || '')) || '';
    if (!id) return { profileId: '', profileSnap: window._workProfileSnap || null };
    /* 저장 시점에도 내 업종이면 **지금 값**으로 다시 찍는다.
       (옛 스냅샷을 들고 있다가 그대로 다시 저장하면 아이콘 변경이 영영 안 붙는다) */
    var own = P.get(id) || (window._workProfileSnap && window._workProfileSnap.name
                              ? P.matchByName(window._workProfileSnap.name) : null);
    if (own) return { profileId: own.id, profileSnap: P.snapOf(own.id) };
    return { profileId: id, profileSnap: window._workProfileSnap || null };
  };
  /* 작업을 열 때 전역에 실어둔다. 작업 전환 시 비우는 것은 resetWorkGlobals 담당. */
  P.bindWork = function (profileId, snap) {
    window._workProfileId = profileId || '';
    window._workProfileSnap = snap || (profileId ? P.snapOf(profileId) : null) || null;
    try { if (typeof applyCustomLabels === 'function') applyCustomLabels(); } catch (e) {}
    try { if (window.ProfilesUI && ProfilesUI.renderWorkChip) ProfilesUI.renderWorkChip(); } catch (e) {}
  };

  /* ── 평면화된 업체정보 (기존 코드가 기대하는 co* 형태) ── */
  P.info = function (pfId) {
    var pf = (pfId ? P.get(pfId) : P.current()) || {};
    var biz = P.bizGet(pf.bizId) || P.bizList()[0] || {};
    var out = {};
    Object.keys(BIZ_MAP).forEach(function (k) { out[BIZ_MAP[k]] = biz[k] || ''; });
    Object.keys(PF_MAP).forEach(function (k) { out[PF_MAP[k]] = pf[k] || ''; });
    out._profileId = pf.id || '';
    out._profileName = pf.name || '';
    out._bizId = biz.id || '';
    return out;
  };
  // 지금 열린 작업 기준 업체정보 — report.js / docs_excel.js 가 쓴다
  P.infoForCurrentWork = function () {
    var pf = P.forCurrentWork();
    return P.info(pf && pf.id);
  };

  /* 파생 뷰(ac_co_v2) 다시 쓰기.
     ⚠️ 진실의 원천은 ac_profiles/ac_biz_list 다. 여기는 항상 덮어쓰는 사본이다. */
  P.syncCoKey = function () {
    try {
      var prev = jget(CO_K, {}) || {};
      var next = P.info();
      // 프로필 모델이 모르는 옛 필드(있다면)는 보존
      Object.keys(next).forEach(function (k) { if (k.charAt(0) !== '_') prev[k] = next[k]; });
      jset(CO_K, prev);
    } catch (e) {}
  };

  /* ac_co_v2 화면 편집분을 프로필 모델로 되돌려 쓰기.
     업체정보 모달 저장(dialogs.js) 이 이걸 부른다. */
  P.applyCoObject = function (ci, pfId) {
    if (!ci) return;
    var pf = (pfId ? P.get(pfId) : P.current());
    if (!pf) { P.ensure(); pf = P.current(); }
    var biz = P.bizGet(pf.bizId) || P.bizList()[0];
    if (!biz) { biz = { id: FIRST_BIZ }; }
    Object.keys(BIZ_MAP).forEach(function (k) { if (ci[BIZ_MAP[k]] !== undefined) biz[k] = ci[BIZ_MAP[k]] || ''; });
    P.bizSave(biz);
    var patch = { id: pf.id, bizId: biz.id };
    Object.keys(PF_MAP).forEach(function (k) { if (ci[PF_MAP[k]] !== undefined) patch[k] = ci[PF_MAP[k]] || ''; });
    // 이름이 없거나 아직 자리표시자('기본')면 보고서 제목에서 다시 뽑는다
    if (!pf.name || pf.name === '기본') {
      var nm = P.guessName(patch.reportTitle || pf.reportTitle);
      if (nm && nm !== '기본') patch.name = nm;
    }
    // (자동 아이콘은 저장하지 않는다 — iconOf 가 카탈로그를 본다)
    P.save(patch);
  };

  /* '에어컨 청소 보고서' → '에어컨 청소' (프로필 이름 자동 추정) */
  P.guessName = function (reportTitle) {
    var t = String(reportTitle || '').trim();
    if (!t) return '기본';
    return t.replace(/\s*작업\s*보고서\s*$/, '').replace(/\s*보고서\s*$/, '').trim() || '기본';
  };

  /* ── 최초 1회 그릇 만들기 ─────────────────────────────
     기존 ac_co_v2 를 사업자#1 + 프로필#1 로 나눠 담는다.
     지침·양식·가격표는 손대지 않는다(key() 가 첫 프로필에 기존 키를 그대로 주므로). */
  P.ensure = function () {
    try {
      var pfs = jget(PF_KEY, null);
      if (Array.isArray(pfs) && pfs.length) return false;
      var ci = jget(CO_K, {}) || {};
      var biz = { id: FIRST_BIZ };
      Object.keys(BIZ_MAP).forEach(function (k) { biz[k] = ci[BIZ_MAP[k]] || ''; });
      var pf = { id: FIRST_PF, bizId: FIRST_BIZ, order: 1, hidden: false };
      Object.keys(PF_MAP).forEach(function (k) { pf[k] = ci[PF_MAP[k]] || ''; });
      pf.name = P.guessName(pf.reportTitle);
      jset(BIZ_KEY, [biz]);
      jset(PF_KEY, [pf]);
      lset(CUR_KEY, FIRST_PF);
      lset(SEED_KEY, '1');          // ★ 내가 만든 빈 껍데기 = 서버 복구가 덮어써도 되는 상태
      console.log('[업종] 프로필 초기화:', pf.name);
      return true;
    } catch (e) { console.warn('[업종] 초기화 실패', e && e.message); return false; }
  };

  /* ── 업종 목록에서 프로필 만들기 (UI 가 부른다) ────────
     industries.js 항목 {id,label,title,unit,stage} → 프로필 */
  P.addFromIndustry = function (majorId, item, bizId) {
    if (!item) return null;
    var exist = P.list({ includeHidden: true }).filter(function (p) {
      return p.industryMinor === item.id && p.industryMajor === majorId;
    })[0];
    if (exist) { if (exist.hidden) P.unhide(exist.id); return exist.id; }
    return P.save({
      name: item.label || P.guessName(item.title),
      bizId: bizId || (P.current() && P.current().bizId) || FIRST_BIZ,
      industryMajor: majorId || '', industryMinor: item.id || '',
      reportTitle: item.title || '', unitLabel: item.unit || '', stageLabel: item.stage || '',
      /* ⚠️ icon 을 여기서 저장하지 않는다 — 저장하면 카탈로그를 바꿔도 안 따라온다.
         iconOf 가 industries.js 를 그때그때 본다. */
      hidden: false
    });
  };
  // 목록에 없는 업종을 이름만으로 추가
  P.addCustom = function (name, bizId) {
    name = String(name || '').trim();
    if (!name) return null;
    return P.save({
      name: name, bizId: bizId || (P.current() && P.current().bizId) || FIRST_BIZ,
      industryMajor: 'custom', industryMinor: '',
      reportTitle: name + ' 보고서', unitLabel: '', stageLabel: '',
      icon: P.defaultIconFor('custom'),
      hidden: false
    });
  };

  /* ⭐ 자가치유 — 예전 버전이 프로필에 복사해 둔 '자동 아이콘'을 걷어낸다.
       그 사본이 남아 있으면 카탈로그 아이콘을 바꿔도 계속 옛것이 나온다.
       카탈로그에 대응 항목이 있는 업종만 지운다(직접입력 업종의 아이콘은 그게 유일한 값이라 보존).
       사용자가 직접 고른 것(iconSet:true)도 건드리지 않는다. */
  P.refreshAutoIcons = function () {
    try {
      var all = jget(PF_KEY, []);
      if (!Array.isArray(all) || !all.length) return 0;
      var n = 0;
      all.forEach(function (pf) {
        if (!pf || pf.iconSet || !pf.icon) return;
        if (!catalogIcon(pf.industryMajor, pf.industryMinor)) return;  // 카탈로그에 없으면 그대로 둔다
        delete pf.icon; n++;
      });
      if (n) { jset(PF_KEY, all); console.log('[업종] 자동 아이콘 ' + n + '건 정리 — 이제 목록 아이콘을 따라갑니다'); }
      return n;
    } catch (e) { return 0; }
  };

  // 스크립트 로드 시점에 그릇을 만들어 둔다(state.js init 보다 먼저 실행됨)
  P.ensure();
  P.refreshAutoIcons();
})();
