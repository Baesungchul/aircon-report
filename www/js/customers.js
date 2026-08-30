/* ═══════════════════════════════════════════════
   고객 관리 (Customers)
═══════════════════════════════════════════════ */

/* ★ 2026-08-16 업종 아이콘 — 목록에서 어느 업종의 작업인지 바로 알아보게.
     인덱스(work_index sessionToIndexEntry)에 저장된 profileIcon 을 먼저 보고,
     없으면 profileId 로 내 프로필에서 찾는다(옛 인덱스 호환). */
function _custIndIcon(w) {
  try {
    if (!w) return '';
    // ⭐ 내 업종이면 '지금 아이콘'. 저장된 사본을 먼저 보면 아이콘을 바꿔도 옛 작업이 안 따라온다.
    if (window.Profiles && Profiles.iconForWork) return Profiles.iconForWork(w);
    return w.profileIcon || '';
  } catch (e) {}
  return '';
}
function _custIndChip(w) {
  var ic = _custIndIcon(w);
  if (!ic) return '';
  var nm = '';
  try { nm = (window.Profiles && Profiles.nameForWork) ? Profiles.nameForWork(w) : ((w && w.profileName) || ''); } catch (e) {}
  // 그림(svg:) 아이콘 지원
  try { if (window.Profiles && Profiles.iconHtml) ic = Profiles.iconHtml(ic, 15); } catch (e) {}
  return '<span class="cust-ind" title="' + escHtmlSafe(nm) + '">' + ic + '</span>';
}

const CUSTOMER_FILTER_KEY = 'ac_customer_filter_v1';
const CUSTOMER_DEFAULT_DAYS = 3;

let _customerSearch = '';
let _customerDateFrom = null;
let _customerDateTo = null;
let _customerUseDefault = true;

// 저장된 필터 불러오기
(function loadSavedFilter(){
  try {
    const saved = JSON.parse(localStorage.getItem(CUSTOMER_FILTER_KEY) || 'null');
    if (saved) {
      _customerUseDefault = saved.useDefault !== false;
      _customerDateFrom = saved.dateFrom || null;
      _customerDateTo = saved.dateTo || null;
    }
  } catch(e) {}
})();

// ★ 외부에서 필터 조회/설정 (records_cache.js에서 사용)
window.getCustomerFilter = function() {
  return {
    useDefault: _customerUseDefault,
    dateFrom: _customerDateFrom,
    dateTo: _customerDateTo
  };
};
window.setCustomerFilter = function(f) {
  if (!f) return;
  if ('useDefault' in f) _customerUseDefault = f.useDefault;
  if ('dateFrom' in f)   _customerDateFrom   = f.dateFrom;
  if ('dateTo' in f)     _customerDateTo     = f.dateTo;
};

// 필터 저장
function saveCustomerFilter() {
  try {
    localStorage.setItem(CUSTOMER_FILTER_KEY, JSON.stringify({
      useDefault: _customerUseDefault,
      dateFrom: _customerDateFrom,
      dateTo: _customerDateTo
    }));
  } catch(e) {}
}

async function openCustomerModal() {
  // 스케줄 열 때마다 관리자 여부 재확인 (로그인 후 확정되므로)
  try { if (window.refreshPhotoAuditVisibility) window.refreshPhotoAuditVisibility(); } catch (e) {}
  // ★ 백그라운드 저장 중이면 완료될 때까지 안내 모달 표시
  if (window._isSavingInBackground) {
    // 안내 오버레이 표시
    const overlay = document.createElement('div');
    overlay.id = 'bgSaveOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:1600;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
      <div style="background:var(--sf);border-radius:14px;padding:24px 28px;max-width:320px;width:90%;text-align:center;">
        <div style="font-size:22px;margin-bottom:10px;">💾</div>
        <div style="font-weight:700;font-size:15px;margin-bottom:6px;">변경사항 반영 중...</div>
        <div style="font-size:12px;color:var(--mu);line-height:1.6;">이전 작업을 저장하고 있습니다.<br>완료되면 자동으로 작업 기록이 열립니다.</div>
        <div style="margin-top:14px;height:4px;background:var(--bd);border-radius:2px;overflow:hidden;">
          <div id="bgSaveBar" style="height:100%;background:var(--ac);border-radius:2px;width:0%;transition:width 0.3s;"></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // 진행바 애니메이션
    let prog = 0;
    const barEl = overlay.querySelector('#bgSaveBar');
    const progTimer = setInterval(() => {
      prog = Math.min(prog + 3, 90);  // 최대 90%까지만 (완료 시 100%로)
      if (barEl) barEl.style.width = prog + '%';
    }, 200);

    // 완료될 때까지 폴링 (최대 30초)
    let waited = 0;
    while (window._isSavingInBackground && waited < 30000) {
      await new Promise(r => setTimeout(r, 100));
      waited += 100;
    }

    clearInterval(progTimer);
    if (barEl) barEl.style.width = '100%';
    await new Promise(r => setTimeout(r, 200));  // 100% 잠깐 보여주기
    overlay.remove();
  }

  document.getElementById('customerModal').classList.add('open');
  _customerSearch = '';

  // 권한 먼저 확보 (싱글톤 가드 사용 - 동시 호출 시 한 팝업만)
  let permOk = true;
  if (photoFolderHandle) {
    try {
      let perm = await photoFolderHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        perm = await requestFolderPermissionSafe('readwrite');
      }
      if (perm !== 'granted') {
        permOk = false;
      }
    } catch(e) {
      console.warn('[작업기록] 권한 확인 실패:', e);
      permOk = false;
    }
  }

  // ★ 권한 없으면 빈 목록 대신 "다시 연결" 안내 화면 (1.251)
  //   - 앱 오래 안 쓰면 안드로이드가 폴더 권한을 만료시킴
  //   - 데이터는 살아있고 권한만 끊긴 것 → 재연결하면 복구
  if (photoFolderHandle && !permOk) {
    const body = document.getElementById('customerBody');
    if (body) {
      body.innerHTML = `
        <div style="padding:40px 24px;text-align:center;">
          <div style="font-size:40px;margin-bottom:16px;">🔒</div>
          <div style="font-weight:700;font-size:16px;margin-bottom:10px;">폴더 연결이 일시 해제되었어요</div>
          <div style="font-size:13px;color:var(--mu);line-height:1.7;margin-bottom:20px;">
            앱을 오래 사용하지 않으면 보안상 폴더 접근 권한이<br>
            자동으로 해제됩니다. 작업 데이터는 안전하게 남아있어요.<br>
            아래 버튼을 눌러 다시 연결해주세요.
          </div>
          <button id="reconnectFolderBtn" style="background:var(--ac);color:#fff;border:none;padding:14px 28px;border-radius:10px;font-size:15px;font-weight:700;">
            📁 폴더 다시 연결하기
          </button>
        </div>`;
      const btn = body.querySelector('#reconnectFolderBtn');
      if (btn) {
        btn.addEventListener('click', async () => {
          try {
            // 사용자 제스처 컨텍스트에서 권한 재요청 → 팝업 확실히 뜸
            const newPerm = await photoFolderHandle.requestPermission({ mode: 'readwrite' });
            if (newPerm === 'granted') {
              showToast('✅ 폴더 다시 연결됨', 'ok');
              if (typeof invalidateRecordsCache === 'function') invalidateRecordsCache();
              await renderCustomerList({ forceFresh: true });
              if (typeof scheduleBackgroundBuild === 'function') scheduleBackgroundBuild();
            } else {
              showToast('권한이 거부되었습니다. 설정에서 폴더를 다시 선택해주세요.', 'err');
            }
          } catch(e) {
            showToast('재연결 실패: ' + e.message, 'err');
          }
        });
      }
    }
    return;  // 권한 복구 전까지 목록 로드 안 함
  }

  // ★ 모달 열 때마다 기본 3일로 리셋 (사용자 요구사항)
  // - 전체 보고 닫았다가 다시 열어도 3일 보여줌
  // - 캐시는 그대로 유지 (전체 데이터 메모리에 있으면 "전체" 선택 시 즉시 표시)
  _customerUseDefault = true;
  _customerDateFrom = null;
  _customerDateTo = null;
  saveCustomerFilter();  // localStorage에도 반영 (앱 재시작 후도 3일)

  // ★ 모달 열 때 캐시 정책:
  // - 캐시 있으면 그대로 사용 (필터링은 renderCustomerList에서)
  // - 캐시 없으면 3일치만 빠르게 로드 → 표시 → 백그라운드 전체 빌드

  await renderCustomerList();

  // 렌더 후 백그라운드에서 전체 데이터 미리 빌드 (다음 "전체" 보기 시 즉시 표시)
  if (typeof scheduleBackgroundBuild === 'function') {
    scheduleBackgroundBuild();
  }
}

function closeCustomerModal() {
  document.getElementById('customerModal').classList.remove('open');
}

function getDefaultDateFrom() {
  const d = new Date();
  d.setDate(d.getDate() - CUSTOMER_DEFAULT_DAYS + 1);
  return localDateStr(d);
}

// ★ filterTo - 오늘 + 1일 (시간대/시간 차이로 인한 누락 방지)
function getDefaultDateTo() {
  // 미래 작업은 모두 표시 (내일/모레 등 미리 입력한 예정 작업)
  return '9999-12-31';
}

// ════════════════════════════════════════
// 통합 데이터 로딩
//   - 고객 (customers DB)
//   - 폴더의 모든 작업 (_session.json) - 전화번호 없는 것도 포함
//   - 중복 제거: 같은 작업이 customer.visits에 있으면 작업 카드는 생략
// 반환: [{ type: 'customer'|'work', sortDate, data }, ...]
// ════════════════════════════════════════
async function loadCombinedRecords(opts) {
  const T0 = Date.now();
  // ★ opts.allDates === true이면 전역 필터 무시하고 전체 로드 (백그라운드 빌드용)
  // 기본은 전역 사용자 필터 사용
  const forceAll = opts && opts.allDates === true;
  console.log('[⏱️] loadCombinedRecords 시작' + (forceAll ? ' (전체)' : ''));

  const items = [];
  const customerWorkIds = new Set();
  const customerAptDateKeys = new Set();

  // ★ 폴더 권한 체크 (호출자가 이미 요청했어야 함 - 중복 팝업 방지)
  // openCustomerModal에서 readwrite 권한을 미리 받으므로 여기선 query만
  if (photoFolderHandle) {
    try {
      const perm = await photoFolderHandle.queryPermission({ mode: 'read' });
      if (perm !== 'granted') {
        // 권한 없으면 안내만 (요청은 호출자 책임)
        showToast('폴더 권한이 필요합니다', 'err');
      }
    } catch(e) { console.warn('[작업기록] 권한 체크 실패:', e); }
  }

  // 1. 고객 데이터 로드 - workId별로 그룹화
  const T1 = Date.now();
  console.log(`[⏱️] 권한 체크: ${T1-T0}ms`);
  try {
    const customers = await customerListAll();
    console.log(`[⏱️] customerListAll: ${Date.now()-T1}ms (${customers.length}명)`);
    customers.forEach(c => {
      if (!c.visits || c.visits.length === 0) {
        items.push({
          type: 'customer',
          sortDate: c.lastVisit || '',
          data: c
        });
        return;
      }

      // ★ workId별로 visits 그룹화 (workId 없는 visits는 apt별로 폴백)
      const visitsByGroup = new Map();
      c.visits.forEach(v => {
        // 그룹 키: workId 우선, 없으면 apt
        const groupKey = v.workId || `apt:${v.apt || '(없음)'}`;
        if (!visitsByGroup.has(groupKey)) visitsByGroup.set(groupKey, []);
        visitsByGroup.get(groupKey).push(v);

        // 키 등록
        if (v.workId) customerWorkIds.add(v.workId);
        const aptDate = `${v.apt || ''}::${v.date || ''}`;
        customerAptDateKeys.add(aptDate);
      });

      // 각 그룹마다 카드 생성
      visitsByGroup.forEach((groupVisits, groupKey) => {
        // ★ 정렬 키: 폴더명(작업 날짜+시간) 우선 → savedAt(저장시간) → date(날짜만)
        // 폴더명 형식: YYYY-MM-DD_HHMM → ISO 비교 가능하도록 정규화
        const visitSortKey = (v) => {
          // ★ V2 visit은 sourceFolderName, 일반은 folderName/folder - 모두 확인
          const fn = v.sourceFolderName || v.folderName || v.folder || '';
          if (fn) {
            // YYYY-MM-DD_HHMM → "YYYY-MM-DDTHH:MM" (ISO-like for lexicographic compare)
            const m = fn.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})/);
            if (m) return `${m[1]}T${m[2]}:${m[3]}`;
            // 날짜만 있는 옛날 폴더는 그대로
            if (/^\d{4}-\d{2}-\d{2}$/.test(fn)) return `${fn}T00:00`;
          }
          // 폴더명 없거나 형식 안 맞으면 savedAt 또는 date
          return v.savedAt || v.date || '';
        };
        const sortedVisits = [...groupVisits].sort((a, b) => {
          return visitSortKey(b).localeCompare(visitSortKey(a));
        });
        const lastVisit = sortedVisits[0]?.date || '';
        const lastSortKey = visitSortKey(sortedVisits[0] || {});
        const apt = sortedVisits[0]?.apt || '';
        const workId = sortedVisits[0]?.workId || '';

        items.push({
          type: 'customer',
          sortDate: lastSortKey,  // 폴더명(작업시간) 또는 savedAt 또는 date
          data: {
            ...c,
            visits: groupVisits,
            visitCount: groupVisits.length,
            lastVisit: lastVisit,
            _aptFilter: apt,
            _workIdFilter: workId  // ★ workId 필터 (있으면 우선 사용)
          }
        });
      });
    });
  } catch(e) { console.warn('고객 로드 실패:', e); }

  // 2. 폴더의 모든 작업 로드 (전화번호 없는 작업만)
  if (photoFolderHandle) {
    try {
      // ★ 기간 필터 미리 계산 (폴더명으로 필터링해서 읽을 파일 최소화)
      let filterFrom = null;
      let filterTo = null;
      if (forceAll) {
        // 전체 로드 (백그라운드 빌드용) - 필터 안 함
        filterFrom = null;
        filterTo = null;
      } else if (_customerUseDefault) {
        filterFrom = getDefaultDateFrom();
        filterTo = getDefaultDateTo();  // 오늘 + 1일 (안전마진)
      } else {
        filterFrom = _customerDateFrom;
        filterTo = _customerDateTo;
      }

      // ★★ 인덱스 파일 시도 (있으면 폴더 스캔 0회!)
      const T2 = Date.now();
      let useIndex = false;
      let indexData = null;
      if (typeof loadWorkIndex === 'function') {
        indexData = await loadWorkIndex();
        console.log(`[⏱️] loadWorkIndex: ${Date.now()-T2}ms (${indexData ? indexData.works.length + '건' : '없음'})`);
        if (indexData && Array.isArray(indexData.works) && indexData.works.length > 0) {
          // ★ 인덱스 신뢰 (1.253) - 매번 폴더 카운트하던 stale 감지 제거
          //   (그 루프가 매 로드마다 전체 폴더 순회 → 느림. stale은 설정의 "재생성" 버튼으로 해결)
          useIndex = true;
        }
      }

      if (useIndex) {
        // 인덱스에서 바로 작업 카드 생성
        const seenAptDate = new Set();
        for (const w of indexData.works) {
          // ★ 기간 필터 - date 필드 우선 (사용자 입력 날짜), 없으면 폴더명
          const checkDate = w.date || (w.folderName || '').slice(0, 10);
          if (filterFrom && checkDate < filterFrom) continue;
          if (filterTo && checkDate > filterTo) continue;

          const apt = w.apt || '';
          const date = w.date || checkDate;
          const workId = w.workId || '';

          // 고객 카드 중복 제거
          if (workId && customerWorkIds.has(workId)) continue;
          if (!workId) {
            const aptDateKey = `${apt}::${date}`;
            if (customerAptDateKeys.has(aptDateKey)) continue;
          }
          // ★ 중복 제거 - workId가 있으면 workId 기준, 없으면 apt+date 폴백
          //   (이전: apt+date만으로 중복 판정 → 같은 날 같은 아파트의 다른 작업이 사라짐)
          const dupKey = workId ? `wid:${workId}` : `apt:${apt}::${date}`;
          if (seenAptDate.has(dupKey)) continue;
          seenAptDate.add(dupKey);

          // ★ 정렬 키: 폴더명(작업 날짜+시간) 우선 → savedAt → date
          let workSortKey;
          const fnW = w.folderName || '';
          const mW = fnW.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})/);
          if (mW) {
            workSortKey = `${mW[1]}T${mW[2]}:${mW[3]}`;
          } else if (/^\d{4}-\d{2}-\d{2}$/.test(fnW)) {
            workSortKey = `${fnW}T00:00`;
          } else {
            workSortKey = w.savedAt || date;
          }

          items.push({
            type: 'work',
            sortDate: workSortKey,
            data: {
              folderName: w.folderName,
              dirHandle: null,  // 인덱스에는 핸들 없음 - 필요 시 동적 가져옴
              workId,
              apt,
              date,
              savedAt: w.savedAt || '',
              worker: w.worker || '',
              units: w.units || [],
              totalUnits: w.totalUnits || (w.units || []).length,
              totalPhotos: w.totalPhotos || 0,
              session: w  // 인덱스 항목 그대로
            }
          });
        }
      } else {
        // ★ 인덱스 없거나 손상 → 폴더 스캔 (기존 방식 폴백)
        console.log('[작업기록] 인덱스 없음 - 폴더 스캔으로 폴백');

        // 1단계: 디렉토리 엔트리 수집
      const dirs = [];
      for await (const entry of photoFolderHandle.values()) {
        if (entry.kind !== 'directory') continue;
        if (!/^\d{4}-\d{2}-\d{2}/.test(entry.name)) continue;

        // ★ 폴더명의 날짜 부분만 추출해서 기간 체크 (파일 안 읽고!)
        const folderDate = entry.name.slice(0, 10);  // "YYYY-MM-DD"
        if (filterFrom && folderDate < filterFrom) continue;
        if (filterTo && folderDate > filterTo) continue;

        dirs.push(entry);
      }

      // 2단계: 필터된 폴더만 _session.json 병렬 읽기
      const results = await Promise.all(dirs.map(async (entry) => {
        try {
          const sessionFile = await entry.getFileHandle('_session.json');
          const file = await sessionFile.getFile();
          const text = await file.text();
          const data = JSON.parse(text);
          return { entry, data };
        } catch(e) { return null; }
      }));

      // 3단계: 메모리에서 처리
      const seenAptDate = new Set();
      for (const result of results) {
        if (!result) continue;
        const { entry, data } = result;

        if (!data.units || data.units.length === 0) continue;

        const apt = data.apt || '';
        const date = data.date || entry.name.slice(0, 10);
        const workId = data.workId || '';

        // ★ 고객 카드로 이미 표시되는 작업은 작업 카드에서 제외 (중복 방지)
        if (workId && customerWorkIds.has(workId)) continue;
        if (!workId) {
          const aptDateKey = `${apt}::${date}`;
          if (customerAptDateKeys.has(aptDateKey)) continue;
        }

        // 폴더 자체의 중복 제거 - workId 우선
        //   (이전: apt+date만 → 같은 날 같은 아파트의 다른 작업이 사라짐)
        const dupKey = workId ? `wid:${workId}` : `apt:${apt}::${date}`;
        if (seenAptDate.has(dupKey)) continue;
        seenAptDate.add(dupKey);

        // ★ 정렬 키: 폴더명(작업 날짜+시간) 우선 → savedAt → date
        // 폴더명 형식 YYYY-MM-DD_HHMM → ISO-like 정규화
        let folderSortKey;
        const fnF = entry.name;
        const mF = fnF.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})/);
        if (mF) {
          folderSortKey = `${mF[1]}T${mF[2]}:${mF[3]}`;
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(fnF)) {
          folderSortKey = `${fnF}T00:00`;
        } else {
          folderSortKey = data.savedAt || date;
        }

        items.push({
          type: 'work',
          sortDate: folderSortKey,
          data: {
            folderName: entry.name,
            dirHandle: entry,
            workId: workId,
            apt: apt,
            date: date,
            savedAt: data.savedAt || '',
            worker: data.worker || '',
            units: data.units,
            totalUnits: data.units.length,
            totalPhotos: data.units.reduce((s, u) => s + (u.beforeCount || 0) + (u.afterCount || 0), 0),
            session: data
          }
        });
      }

      // ★ 폴더 스캔으로 작업을 찾았으면 인덱스 자동 생성 (다음번부터 빠르게)
      if (!useIndex && results.length > 0 && typeof rebuildIndexFromFolders === 'function') {
        setTimeout(() => {
          rebuildIndexFromFolders().catch(e => console.warn('[인덱스] 자동 생성 실패:', e.message));
        }, 2000);
      }
      }  // end of else (폴더 스캔)
    } catch(e) { console.warn('폴더 작업 로드 실패:', e); }
  }

  // ★ 정렬 키 통일: savedAt(초까지 ISO) 우선 → 작업 종류(전화 유무)와 무관하게
  //   "가장 마지막에 입력한 작업"이 정확히 맨 위로 오도록.
  //   (이전: customer는 날짜 위주, work는 초까지 시각 → 형식이 달라 같은 날 순서가 꼬임)
  const _sortKey = (it) => {
    const d = it.data || {};
    let k = d.savedAt;  // 1순위: 저장 시각(초까지)
    if (!k && Array.isArray(d.visits) && d.visits.length) {
      // 고객(여러 방문)은 가장 최근 방문의 시각
      k = d.visits.map(v => v.savedAt || v.folderName || v.date || '').sort().pop();
    }
    k = k || it.sortDate || d.date || '';
    // 날짜만(YYYY-MM-DD) 형식이면 시각을 0으로 보정해 시각 있는 항목과 정확히 비교
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(k))) k = String(k) + 'T00:00:00';
    return String(k);
  };
  items.sort((a, b) => _sortKey(b).localeCompare(_sortKey(a)));

  console.log(`[⏱️] loadCombinedRecords 완료: 총 ${Date.now()-T0}ms (${items.length}건)`);
  return items;
}

async function renderCustomerList(opts) {
  const body = document.getElementById('customerBody');
  if (!body) return;

  // ★ opts.forceFresh: 사용자가 명시적으로 필터 변경한 직후엔 캐시 무시 (1.249)
  const forceFresh = opts && opts.forceFresh === true;

  // ★ 캐시에서 전체 데이터 가져오기 (있으면, 그리고 forceFresh가 아닐 때만)
  let items = null;
  if (!forceFresh && typeof getRecordsFromCache === 'function') {
    items = getRecordsFromCache();
    if (items) console.log(`[작업기록] 캐시 사용: ${items.length}건`);
  }

  // 검색어 (먼저 확인 - 검색 시 전체 로드 필요)
  const qEarly = _customerSearch.trim();

  // 캐시 없으면 직접 로드
  // ★ 점진적 로딩: 사용자가 보는 기간(기본 3일)만 빠르게 로드 → 표시
  //    → 백그라운드에서 전체 빌드 → 다음에는 캐시에서 즉시
  if (!items) {
    if (!body.querySelector('.cust-card') && !body.querySelector('.cust-card-work')) {
      body.innerHTML = `<div style="padding:40px 20px;text-align:center;color:var(--mu);">
        <div style="font-size:24px;margin-bottom:12px;">⏳</div>
        <div>${qEarly ? '전체 작업에서 검색 중...' : '최근 작업 불러오는 중...'}</div>
      </div>`;
    }
    // ★ 검색 중이면 전체 로드(allDates), 아니면 사용자 필터(기본 3일) - 빠르게 로드 (1.270)
    try {
      items = await loadCombinedRecords(qEarly ? { allDates: true } : undefined);
      // 부분 캐시는 안 함 - 전체 데이터가 아니므로
      // (백그라운드에서 전체 빌드 후 캐시 채움)
    } catch(e) {
      body.innerHTML = `<div style="padding:20px;text-align:center;color:var(--mu);">목록 로드 실패: ${e.message}</div>`;
      return;
    }
    // 백그라운드 전체 빌드 예약 (다음 호출 또는 "전체" 보기 시 즉시 표시)
    if (typeof scheduleBackgroundBuild === 'function') {
      scheduleBackgroundBuild();
    }
    // ★ items는 이미 사용자 필터(3일) 적용된 결과지만 안전하게 아래 필터링 한 번 더 적용
    // (race condition으로 _customerUseDefault가 바뀌어도 화면이 라벨과 일치하도록)
  }

  // 검색어
  const q = _customerSearch.trim().toLowerCase();

  // ★ 기간 필터 - 단, 검색 중이면 기간 무시하고 전체에서 검색 (1.270)
  //   검색은 기간과 무관하게 모든 작업에서 찾아야 함
  //   (이전엔 3일 필터된 목록에서만 검색돼서 기간 밖 작업이 안 나왔음)
  let dateFrom = _customerDateFrom;
  let dateTo = _customerDateTo;
  if (_customerUseDefault) {
    dateFrom = getDefaultDateFrom();
    dateTo = localDateStr();
  }

  let filtered = items;
  if (!q && (dateFrom || dateTo)) {
    // 검색 중이 아닐 때만 기간 필터 적용
    filtered = items.filter(it => {
      // sortDate 없는 항목은 통과 (필터 못 함)
      if (!it.sortDate) return true;
      // ★ sortDate가 ISO 시간 형식이면 날짜 부분만 추출해서 비교
      // 예: "2026-05-19T15:30:00.123Z" → "2026-05-19"
      const sortDateOnly = String(it.sortDate).slice(0, 10);
      if (dateFrom && sortDateOnly < dateFrom) return false;
      if (dateTo && sortDateOnly > dateTo) return false;
      return true;
    });
  }

  // 검색 필터 (전체 items 대상 - 위에서 기간 필터를 건너뛰었으므로)
  if (q) {
    // ★ 전화번호 검색용: 숫자만 추출 (하이픈/공백 무시) (1.271)
    const qDigits = q.replace(/[^0-9]/g, '');
    const phoneMatch = (phone) => {
      if (!phone) return false;
      if (phone.toLowerCase().includes(q)) return true;  // 원문 그대로도 시도
      if (qDigits && phone.replace(/[^0-9]/g, '').includes(qDigits)) return true;  // 숫자만 비교
      return false;
    };
    filtered = filtered.filter(it => {
      if (it.type === 'customer') {
        const c = it.data;
        if ((c.name || '').toLowerCase().includes(q)) return true;
        if (phoneMatch(c.phone)) return true;
        if ((c.address || '').toLowerCase().includes(q)) return true;
        if ((c.memo || '').toLowerCase().includes(q)) return true;
        if (c.visits && c.visits.some(v =>
          (v.apt || '').toLowerCase().includes(q) ||
          (v.unit || '').toLowerCase().includes(q)
        )) return true;
      } else {
        // 작업 카드
        const w = it.data;
        if ((w.apt || '').toLowerCase().includes(q)) return true;
        if (phoneMatch(w.phone)) return true;  // ★ 작업 카드 전화번호도 검색 (1.271)
        if ((w.worker || '').toLowerCase().includes(q)) return true;  // 담당자도
        if (w.units && w.units.some(u => (u.name || '').toLowerCase().includes(q))) return true;
      }
      return false;
    });
  }

  // 통계 (고객만)
  const allCustomers = items.filter(it => it.type === 'customer').map(it => it.data);
  const total = allCustomers.length;
  const repeat = allCustomers.filter(c => (c.visitCount || 0) >= 2).length;
  const recent = allCustomers.filter(c => {
    if (!c.lastVisit) return false;
    const days = (Date.now() - new Date(c.lastVisit).getTime()) / (1000 * 60 * 60 * 24);
    return days <= 30;
  }).length;

  let periodLabel = '';
  if (q) periodLabel = `🔍 "${_customerSearch.trim()}" 검색 (전체 기간)`;
  else if (_customerUseDefault) periodLabel = `최근 ${CUSTOMER_DEFAULT_DAYS}일`;
  else if (dateFrom && dateTo && dateFrom === dateTo) periodLabel = dateFrom;
  else if (dateFrom && dateTo) periodLabel = `${dateFrom} ~ ${dateTo}`;
  else if (dateFrom) periodLabel = `${dateFrom} 이후`;
  else if (dateTo) periodLabel = `${dateTo} 이전`;
  else periodLabel = '전체';

  body.innerHTML = `
    <div style="background:var(--sf2);border-radius:10px;padding:12px;margin-bottom:14px;">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;text-align:center;">
        <div>
          <div style="font-size:11px;color:var(--mu);">총 고객</div>
          <div style="font-size:20px;font-weight:800;color:var(--ac);">${total}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--mu);">재작업</div>
          <div style="font-size:20px;font-weight:800;color:var(--ac2);">${repeat}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--mu);">최근 30일</div>
          <div style="font-size:20px;font-weight:800;color:var(--wn);">${recent}</div>
        </div>
      </div>
      ${photoFolderHandle ? `
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--bd);font-size:11px;color:var(--mu);text-align:center;">
          📁 저장 위치: <b>${escHtmlSafe(photoFolderHandle.name)}/customers.xlsx</b>
        </div>
      ` : `
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--bd);font-size:11px;color:var(--wn);text-align:center;">
          ⚠️ 저장 폴더가 설정되지 않았습니다
        </div>
      `}
    </div>

    <div style="background:var(--sf2);border-radius:10px;padding:10px 12px;margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <span style="font-size:12px;color:var(--mu);font-weight:700;">📅 기간:</span>
      <span style="font-size:13px;color:var(--ac);font-weight:700;">${periodLabel}</span>
      <span style="font-size:11px;color:var(--mu);">(${filtered.length}건)</span>
      <button class="btn b-ghost b-xs" id="custDateBtn" style="margin-left:auto;">기간 변경</button>
      ${!_customerUseDefault ? `<button class="btn b-ghost b-xs" id="custDateReset">최근 ${CUSTOMER_DEFAULT_DAYS}일</button>` : ''}
    </div>

    <input class="cust-inp" id="customerSearchInp" type="text" placeholder="🔍 작업명/호수/이름/전화번호 검색" value="${escHtmlSafe(_customerSearch)}" style="width:100%;margin-bottom:12px;">

    <div style="display:flex;flex-direction:column;gap:8px;">
      ${filtered.length === 0
        ? '<div style="padding:30px 14px;text-align:center;color:var(--mu);">' +
          (q ? '검색 결과가 없습니다' :
            (_customerUseDefault ? `최근 ${CUSTOMER_DEFAULT_DAYS}일 내 작업이 없습니다.<br>"기간 변경"으로 이전 작업도 볼 수 있어요.` : '해당 기간에 작업이 없습니다')
          ) +
          '</div>'
        : filtered.map(it => it.type === 'customer' ? renderCustomerCard(it.data) : renderWorkCard(it.data)).join('')
      }
    </div>
  `;

  const searchEl = document.getElementById('customerSearchInp');
  if (searchEl) {
    searchEl.addEventListener('input', e => {
      _customerSearch = e.target.value;
      clearTimeout(searchEl._timer);
      searchEl._timer = setTimeout(async () => {
        // ★ 포커스/커서 위치 보존
        const wasFocused = document.activeElement === searchEl;
        const cursorPos = searchEl.selectionStart;
        await renderCustomerList();
        if (wasFocused) {
          const newEl = document.getElementById('customerSearchInp');
          if (newEl) {
            newEl.focus();
            try { newEl.setSelectionRange(cursorPos, cursorPos); } catch(e) {}
          }
        }
      }, 200);
    });
  }

  const dateBtn = document.getElementById('custDateBtn');
  if (dateBtn) dateBtn.addEventListener('click', openCustomerDateFilter);

  const dateReset = document.getElementById('custDateReset');
  if (dateReset) dateReset.addEventListener('click', () => {
    _customerUseDefault = true;
    _customerDateFrom = null;
    _customerDateTo = null;
    saveCustomerFilter();
    renderCustomerList();
  });

  // ★ 카드 자체 클릭 비활성화 - 버튼으로만 동작
  // (실수 클릭 방지 + 명확한 액션 의도 표현)

  // ★ 고객 카드 "열기" 버튼
  body.querySelectorAll('.cust-card-open').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const phone = btn.dataset.phone;
      const aptFilter = btn.dataset.aptFilter || '';
      const workId = btn.dataset.workid || '';
      openWorkForCustomer(phone, aptFilter, workId);
    });
  });

  // ★ 작업 카드 "열기" 버튼 (전화번호 없는 작업)
  body.querySelectorAll('.cust-card-work-open').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openWorkByFolder(btn.dataset.folder, btn.dataset.apt, btn.dataset.date);
    });
  });

  body.querySelectorAll('.cust-card-edit').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      await openCustomerEdit(btn.dataset.phone);
    });
  });

  body.querySelectorAll('.cust-card-del').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const phone = btn.dataset.phone;
      const aptFilter = btn.dataset.aptFilter || '';
      const workIdFilter = btn.dataset.workid || '';

      // 어떤 visits를 삭제할지 결정
      const c = await customerLookup(phone);
      if (!c) {
        showToast('고객을 찾을 수 없습니다', 'err');
        return;
      }

      let visitsToDelete = c.visits || [];
      if (workIdFilter) {
        visitsToDelete = visitsToDelete.filter(v => v.workId === workIdFilter);
      } else if (aptFilter) {
        visitsToDelete = visitsToDelete.filter(v => (v.apt || '') === aptFilter);
      }

      // 작업 폴더 목록 (workId/folderName으로)
      const folderNames = new Set();
      visitsToDelete.forEach(v => {
        // ★ folderName 또는 sourceFolderName 둘 다 확인 (V2 visit은 sourceFolderName 사용)
        const fn = v.folderName || v.sourceFolderName;
        if (fn) folderNames.add(fn);
      });

      // folderName도 sourceFolderName도 없는 visits면 폴더 검색
      const needFolderSearch = visitsToDelete.some(v => !v.folderName && !v.sourceFolderName);

      // 사용자 확인
      const aptLabel = aptFilter || (visitsToDelete[0]?.apt) || '작업';
      const totalVisits = c.visits?.length || 0;
      const visitCount = visitsToDelete.length;

      let confirmMsg = '';
      if (visitCount === totalVisits) {
        confirmMsg = `${phone} 고객을 완전히 삭제하시겠습니까?\n\n` +
          `📞 고객 정보 + ${visitCount}개 작업 폴더가 모두 삭제됩니다.\n` +
          `⚠️ 사진 파일도 모두 삭제됩니다.`;
      } else {
        confirmMsg = `"${aptLabel}" 작업을 삭제하시겠습니까?\n\n` +
          `${visitCount}개 작업 폴더가 삭제됩니다.\n` +
          `(다른 작업 ${totalVisits - visitCount}개는 유지)`;
      }

      if (!confirm(confirmMsg)) return;

      // 권한 체크
      try {
        let perm = await photoFolderHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          perm = await photoFolderHandle.requestPermission({ mode: 'readwrite' });
          if (perm !== 'granted') {
            showToast('쓰기 권한이 거부되었습니다', 'err');
            return;
          }
        }
      } catch(err) {
        showToast('권한 확인 실패: ' + err.message, 'err');
        return;
      }

      showOverlay('삭제 중...');
      const safetyTimeout = setTimeout(() => {
        hideOverlay();
        showToast('삭제 시간 초과', 'err');
      }, 60000);

      try {
        let folderDeleted = 0;
        let folderFailed = 0;

        // 폴더 검색 (folderName 없는 visit 처리)
        if (needFolderSearch) {
          for await (const entry of photoFolderHandle.values()) {
            if (entry.kind !== 'directory') continue;
            if (!/^\d{4}-\d{2}-\d{2}/.test(entry.name)) continue;

            try {
              const sessionFile = await entry.getFileHandle('_session.json');
              const file = await sessionFile.getFile();
              const data = JSON.parse(await file.text());

              // workId 매칭
              if (workIdFilter && data.workId === workIdFilter) {
                folderNames.add(entry.name);
                continue;
              }
              // apt 매칭 (legacy)
              if (!workIdFilter && aptFilter && data.apt === aptFilter) {
                // 호수 중 하나라도 이 phone에 속하면 폴더 삭제 대상
                const hasMatchingPhone = (data.units || []).some(u => {
                  const p = (u.customer?.phone || '').replace(/[^\d]/g, '');
                  return p && normalizePhone(u.customer.phone) === normalizePhone(phone);
                });
                if (hasMatchingPhone) folderNames.add(entry.name);
              }
            } catch(e) {}
          }
        }

        // 폴더 삭제
        for (const folderName of folderNames) {
          try {
            // 1차: recursive
            try {
              await photoFolderHandle.removeEntry(folderName, { recursive: true });
              folderDeleted++;
              continue;
            } catch(e1) {
              console.warn(`recursive 삭제 실패 (${folderName}):`, e1.message);
            }

            // 2차: 수동
            if (typeof deleteDirectoryContents === 'function') {
              try {
                const dh = await photoFolderHandle.getDirectoryHandle(folderName);
                await deleteDirectoryContents(dh);
                await photoFolderHandle.removeEntry(folderName);
                folderDeleted++;
                continue;
              } catch(e2) {
                console.warn(`수동 삭제 실패 (${folderName}):`, e2.message);
              }
            }

            folderFailed++;
          } catch(e) {
            folderFailed++;
            console.error(`폴더 ${folderName} 삭제 실패:`, e);
          }
        }

        // ★ 폴더 삭제 결과와 무관하게 뒷정리는 모두 수행
        // (폴더가 이미 없거나 권한 문제로 못 지워도 인덱스·캐시만이라도 정리)
        // purgeWorkEverywhere 한 곳에서 인덱스·캐시·백업거울·클라우드휴지통·화면초기화를 처리한다.
        if (typeof window.purgeWorkEverywhere === 'function') {
          for (const folderName of folderNames) {
            await window.purgeWorkEverywhere(folderName, { cloud: true });
          }
        }

        // 모든 visits 삭제 시 → 메타도 삭제
        if (visitCount === totalVisits) {
          try { await customerRemove(phone); } catch(e) {}
        }

        if (typeof flushCustomersXlsx === 'function') {
          await flushCustomersXlsx();
        }

        clearTimeout(safetyTimeout);
        hideOverlay();
        await renderCustomerList();

        if (folderFailed === 0) {
          showToast(`✓ ${folderDeleted}개 폴더 삭제됨`, 'ok');
        } else {
          showToast(`${folderDeleted}개 삭제, ${folderFailed}개 실패`, 'err');
        }
      } catch(err) {
        clearTimeout(safetyTimeout);
        hideOverlay();
        console.error(err);
        showToast('삭제 실패: ' + err.message, 'err');
      }
    });
  });

  // 작업 카드 삭제 (폴더 전체) - ★ 즉시 UI 반영 + 백그라운드 삭제 (1.252)
  body.querySelectorAll('.cust-card-work-del').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const folder = btn.dataset.folder;
      if (!confirm(`작업 "${folder}"을 삭제할까요?\n폴더의 모든 사진과 데이터가 삭제됩니다.`)) return;

      // 권한 체크 (빠름)
      try {
        let perm = await photoFolderHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          perm = await photoFolderHandle.requestPermission({ mode: 'readwrite' });
          if (perm !== 'granted') {
            showToast('쓰기 권한이 거부되어 삭제할 수 없습니다', 'err');
            return;
          }
        }
      } catch(e) {
        showToast('권한 확인 실패: ' + e.message, 'err');
        return;
      }

      // ★ 1) UI에서 카드 즉시 제거 (체감 0초)
      const card = btn.closest('.cust-card-work') || btn.closest('.cust-card');
      if (card) {
        card.style.transition = 'opacity 0.2s';
        card.style.opacity = '0.4';
        card.style.pointerEvents = 'none';
      }
      showToast('🗑️ 삭제 중...', 'ok');

      // ★ 2) 인덱스/캐시에서 즉시 제거 (다음 열기에 안 보이도록)
      if (typeof scheduleIndexDelete === 'function') scheduleIndexDelete(folder);
      if (typeof invalidateRecordsCache === 'function') invalidateRecordsCache();
      if (typeof invalidateCustomersCache === 'function') invalidateCustomersCache();

      // ★ 현재 화면이 삭제한 작업이면 화면도 초기화
      if (typeof clearIfCurrent === 'function') {
        try { await clearIfCurrent(folder); } catch(e) {}
      }

      // ★ 3) 실제 폴더 삭제는 백그라운드 (await 안 함 - UI 안 막음)
      (async () => {
        try {
          let dirHandle;
          try {
            dirHandle = await photoFolderHandle.getDirectoryHandle(folder);
          } catch(err) {
            // 이미 없음 - OK
            card?.remove();
            return;
          }

          let deleted = false;
          // 1차: recursive (데스크톱/최신 안드로이드)
          try {
            await photoFolderHandle.removeEntry(folder, { recursive: true });
            deleted = true;
          } catch(e1) {
            console.warn('recursive 삭제 실패:', e1.message);
          }
          // 2차: 수동 재귀 삭제
          if (!deleted && typeof deleteDirectoryContents === 'function') {
            try {
              await deleteDirectoryContents(dirHandle);
              await photoFolderHandle.removeEntry(folder);
              deleted = true;
            } catch(e2) {
              console.warn('수동 삭제 실패:', e2.message);
            }
          }
          // 3차: 빈 폴더 직접 삭제
          if (!deleted) {
            try {
              await photoFolderHandle.removeEntry(folder);
              deleted = true;
            } catch(e3) {
              console.warn('빈 폴더 삭제도 실패:', e3.message);
            }
          }

          if (deleted) {
            /* ★ 2026-08-13: 뒷정리 일원화(purgeWorkEverywhere).
               폴더가 실제로 지워진 뒤에 부르는 이유 — 캐시를 비우면 다음 조회가 폴더를
               다시 스캔하는데, 삭제 전에 비우면 아직 남아있는 폴더를 읽어 되살아난다.
               위쪽(삭제 직전)의 인덱스/캐시 정리는 화면 즉시 반영용으로 그대로 둔다. */
            if (typeof window.purgeWorkEverywhere === 'function') {
              await window.purgeWorkEverywhere(folder, { cloud: true, xlsx: true });
            }
            card?.remove();
            showToast('✓ 작업 삭제 완료', 'ok');
          } else {
            // 삭제 실패 - 카드 복원
            if (card) {
              card.style.opacity = '1';
              card.style.pointerEvents = '';
            }
            showToast('삭제 실패: 다시 시도해주세요', 'err');
          }
        } catch(err) {
          if (card) {
            card.style.opacity = '1';
            card.style.pointerEvents = '';
          }
          showToast('삭제 실패: ' + err.message, 'err');
        }
      })();
    });
  });
}

// ─── 이하 기존 작업 카드 삭제 (구버전, 미사용) ───

// 현재 화면이 같은 작업인지 확인 (apt + date)
function isSameAsCurrent(targetApt, targetDate, targetFolderName) {
  try {
    // ★ folderName으로 비교 (가장 정확)
    if (targetFolderName && typeof currentFolderName !== 'undefined' && currentFolderName) {
      return currentFolderName === targetFolderName;
    }
    // 폴더명 정보 없을 때만 apt+date 비교 (느슨한 비교)
    const curApt = (document.getElementById('aptName').value || '').trim();
    const curDate = (document.getElementById('workDate').value || '').trim();
    // 현재 작업이 새 작업 상태(currentFolderName이 null이면) - 무조건 다른 작업
    if (typeof currentFolderName !== 'undefined' && !currentFolderName) return false;
    return curApt === (targetApt || '').trim() && curDate === (targetDate || '').trim();
  } catch(e) { return false; }
}

// 다른 작업 열기 전 - 저장 확인
// 반환: true → 진행 / false → 취소
async function confirmBeforeLoad() {
  // 작업 없으면 그냥 진행
  if (typeof units === 'undefined' || !units || units.length === 0) return true;

  // ★ 실제 데이터 변경만 체크 (dirty 플래그는 input 이벤트로 인한 거짓 양성 많음)
  let snapsEqual = true;
  if (typeof quickSnapshot === 'function' && typeof _lastSaveSnapshot !== 'undefined') {
    snapsEqual = (quickSnapshot() === _lastSaveSnapshot);
  }
  if (snapsEqual) {
    console.log('✓ 변경 없음 - 저장 스킵 (불러오기 전)');
    return true;
  }

  // 저장 확인
  const result = confirm('⚠️ 현재 작업이 저장되지 않았습니다.\n\n저장 후 다른 작업을 불러오시겠습니까?\n\n[확인] 저장 후 진행\n[취소] 저장하지 않고 진행');
  if (result) {
    if (photoFolderHandle && typeof saveToFolder === 'function') {
      try {
        await saveToFolder({ auto: true, force: true });
      } catch(e) {
        hideOverlay();
        if (!confirm('저장 실패. 그래도 진행할까요?')) return false;
      }
    } else if (typeof sessionAutoSaveNow === 'function') {
      try { await sessionAutoSaveNow(); } catch(e) {}
    }
  }
  // 취소든 확인이든 진행
  return true;
}


// 전역 동작 중 플래그 (중복 클릭 방지)
let _appBusy = false;
let _busyLastUpdate = 0;
let _busyAutoReleaseTimer = null;
function setAppBusy(busy, msg, pct) {
  _appBusy = busy;
  // ★★ 안전망: 일정 시간 갱신 없으면 차단막 자동 해제 (잔존 방지)
  if (_busyAutoReleaseTimer) { clearTimeout(_busyAutoReleaseTimer); _busyAutoReleaseTimer = null; }
  if (busy) {
    _busyAutoReleaseTimer = setTimeout(() => {
      console.warn('[setAppBusy] 15초간 갱신 없음 → 차단막 자동 해제 (잔존 방지)');
      _appBusy = false;
      const b = document.getElementById('appBlock');
      if (b) b.style.display = 'none';
    }, 15000);
  }
  _busyLastUpdate = Date.now();

  let block = document.getElementById('appBlock');
  if (busy) {
    if (!block) {
      block = document.createElement('div');
      block.id = 'appBlock';
      block.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;cursor:wait;';
      block.innerHTML = '<div style="background:var(--sf);padding:22px 30px;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.5);min-width:230px;text-align:center;">'
        + '<div id="appBusyMsg" style="font-size:15px;font-weight:700;color:var(--ac);"></div>'
        + '<div id="appBusyBarWrap" style="display:none;position:relative;margin-top:14px;height:12px;background:var(--sf2,#e9edf6);border-radius:7px;overflow:hidden;">'
        +   '<div id="appBusyTrackShine" style="position:absolute;inset:0;background:linear-gradient(90deg,transparent 0%,rgba(255,255,255,.55) 50%,transparent 100%);background-size:220% 100%;animation:appBusyTrack 1.5s linear infinite;"></div>'
        +   '<div id="appBusyBar" style="position:absolute;left:0;top:0;height:100%;width:0%;background:linear-gradient(90deg,var(--ac),var(--ac2,#4dd0e1),var(--ac));background-size:220% 100%;border-radius:7px;transition:width .5s cubic-bezier(.22,1,.36,1);animation:appBusyFlow 1.4s linear infinite;"></div>'
        + '</div>'
        + '<div id="appBusyPct" style="display:none;font-size:22px;font-weight:800;color:var(--ac);margin-top:8px;letter-spacing:.5px;">0%</div>'
        + '</div>';
      if (!document.getElementById('appBusyKeyframes')) {
        var _bkf = document.createElement('style');
        _bkf.id = 'appBusyKeyframes';
        _bkf.textContent = '@keyframes appBusyFlow{0%{background-position:220% 0}100%{background-position:0 0}}@keyframes appBusyTrack{0%{background-position:200% 0}100%{background-position:-40% 0}}';
        document.head.appendChild(_bkf);
      }
      document.body.appendChild(block);
    } else {
      block.style.display = 'flex';
    }
    const msgEl = document.getElementById('appBusyMsg');
    if (msgEl) msgEl.textContent = msg || '⏳ 처리 중...';
    const barWrap = document.getElementById('appBusyBarWrap');
    const bar     = document.getElementById('appBusyBar');
    const pctEl   = document.getElementById('appBusyPct');
    if (typeof pct === 'number' && isFinite(pct)) {
      const pp = Math.max(0, Math.min(100, Math.round(pct)));
      if (barWrap) barWrap.style.display = 'block';
      if (bar)     bar.style.width = pp + '%';
      if (pctEl)   { pctEl.style.display = 'block'; pctEl.textContent = pp + '%'; }
    } else {
      if (barWrap) barWrap.style.display = 'none';
      if (pctEl)   pctEl.style.display = 'none';
    }
  } else {
    if (block) block.style.display = 'none';
  }
}
window.setAppBusy = setAppBusy;

// 폴더명으로 작업 직접 열기
async function openWorkByFolder(folderName, apt, date) {
  if (_appBusy) return;  // 이미 처리 중이면 무시

  if (!photoFolderHandle) {
    showToast('저장 폴더가 설정되지 않았습니다', 'err');
    return;
  }

  // ★ 현재 작업이면 바로 닫기
  if (folderName && currentFolderName === folderName) {
    closeCustomerModal();
    showToast('이미 현재 작업입니다', 'ok');
    return;
  }

  // ★ 클릭 즉시 confirm (지연 없음) - 폴더명도 표시 (디버그)
  const aptName = apt || folderName;
  const dateStr = date || '';
  const msg = `📂 작업 불러오기\n\n${aptName}${dateStr ? ' · ' + dateStr : ''}\n📁 ${folderName}\n\n이 작업을 불러올까요?`;
  if (!confirm(msg)) return;

  // ★ 확인 후 - 모든 입력 차단
  setAppBusy(true, '📂 불러오는 중...');
  closeCustomerModal();

  // ★ 예약된 백그라운드 빌드 취소 - 메인 스레드 점유 방지 (1.247)
  //   작업기록 모달 열 때 3초 후 빌드가 예약되는데, 작업 열기 진행 중이면 안 됨
  if (typeof cancelBackgroundBuild === 'function') {
    cancelBackgroundBuild();
  }

  const _T0 = Date.now();
  console.log('[작업열기] 시작:', folderName);

  try {
    // ★ 변경사항 있으면 사용자에게 물어봄 (1.240) - 자동저장 제거
    //   - 자동저장은 사용자가 의식 못 함 + 시간 소요 큼
    //   - 명시적 선택: 저장 후 열기 / 버리고 열기 / 취소
    try {
      let isDirty = (typeof _dataDirty !== 'undefined' && _dataDirty);
      // 공유(불러온) 작업: 실시간 수신·순서변경은 내 변경이 아님 → 내가 새로 추가한 '미저장 사진'이 있을 때만 dirty
      if (window._borrowedShare) {
        const _hasNew = (arr) => (arr||[]).some(p => p && p.dataUrl && !p.savedToFolder && !p._cloudUploaded && !p._borrowedIncoming);
        let _d = (units || []).some(u => _hasNew(u.before) || _hasNew(u.after) || (u.specials||[]).some(s => _hasNew(s.photos)));
        /* ⭐ 2026-08-13 버그수정 — 사진만 보고 있어서, 작업탭에서 작업자·작업일자·작업명을
           바꾼 뒤 다른 작업을 열면 "저장할까요?" 조차 안 뜨고 조용히 사라졌다.
           이 세 가지는 sw v476부터 원작업자에게 전달된다(dialogs.js saveToFolder 의 borrowed 분기).
           ⚠️ 호수별 고객정보·특이사항 설명은 아직 전달 경로가 없어 일부러 뺐다.
              저장해도 사라지는 값으로 '저장할까요?'를 띄우면 더 헷갈린다.
              그 경로가 생기면 여기에 같이 넣을 것. */
        if (!_d) {
          try {
            const _b = window._borrowedShare;
            const _cur = (window.CloudShare && CloudShare.findSharedItem)
              ? (CloudShare.findSharedItem(_b.ownerUid, _b.workId) || {}) : {};
            const _gv = (id) => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
            const _nw = _gv('workerName'), _nd = _gv('workDate'), _na = _gv('aptName');
            if ((_nw && _nw !== (_cur.worker || '')) ||
                (_nd && _nd !== (_cur.date  || '')) ||
                (_na && _na !== (_cur.apt   || ''))) _d = true;
          } catch (e) {}
        }
        isDirty = _d;
      }
      if (isDirty && units && units.length > 0) {
        const choice = confirm(
          '💾 현재 작업에 저장 안 된 변경사항이 있어요.\n\n' +
          '저장하고 열까요?\n\n' +
          '확인 → 저장 후 새 작업 열기\n' +
          '취소 → 저장 안 하고 새 작업 열기'
        );
        if (choice && typeof saveToFolder === 'function') {
          console.log('[작업열기] 사용자가 저장 선택 → 저장');
          // ★ force 제거 - saveToFolder 내부 dirty 체크가 작동하여 정말 변경 없으면 스킵
          await saveToFolder({ auto: true, silent: true });
          console.log(`[작업열기] 자동저장: ${Date.now() - _T0}ms`);
        } else {
          console.log('[작업열기] 사용자가 저장 안 함 선택 → 변경 버리고 진행');
        }
      } else {
        console.log('[작업열기] 변경사항 없음 → 자동저장 스킵');
      }
    } catch(e) { console.warn('자동저장 분기 실패:', e); }

    const _T1 = Date.now();
    const _tAuto = _T1 - _T0;

    // 폴더 읽기 + 불러오기
    const dirHandle = await photoFolderHandle.getDirectoryHandle(folderName);
    const sf = await dirHandle.getFileHandle('_session.json');
    const f = await sf.getFile();
    const data = JSON.parse(await f.text());
    const _T2 = Date.now();
    const _tMeta = _T2 - _T1;
    console.log(`[작업열기] 폴더 메타 읽기: ${_tMeta}ms`);

    let _tLoad = 0;
    if (typeof loadFromDateFolder === 'function') {
      await Promise.race([
        loadFromDateFolder(dirHandle, data),
        new Promise((_, reject) => setTimeout(() => reject(new Error('시간 초과')), 60000))
      ]);
      _tLoad = Date.now() - _T2;
      console.log(`[작업열기] loadFromDateFolder: ${_tLoad}ms`);
    }
    const _tTotal = Date.now() - _T0;
    console.log(`[작업열기] 총 소요: ${_tTotal}ms`);

    // ★ 화면에 진단 토스트 - 항상 표시 (시간 까먹는 곳 파악용)
    if (typeof showToast === 'function') {
      const breakdown = `⏱️ 총 ${(_tTotal/1000).toFixed(1)}s = 저장${(_tAuto/1000).toFixed(1)}s + 메타${_tMeta}ms + 복원${(_tLoad/1000).toFixed(1)}s`;
      showToast(breakdown, _tTotal > 2000 ? 'err' : 'ok');
    }
  } catch(e) {
    showToast('불러오기 실패: ' + e.message, 'err');
  } finally {
    setAppBusy(false);
  }
}

function renderCustomerCard(c) {
  const lastVisit = c.lastVisit || '-';
  const visitText = c.visitCount >= 2
    ? `<span style="color:var(--ac2);font-weight:700;">${c.visitCount}회</span>`
    : `<span style="color:var(--mu);">1회</span>`;

  const lastWork = (c.visits && c.visits.length > 0)
    ? c.visits[0]  // 최신 (정렬되어 있음)
    : null;

  const apt = lastWork?.apt || '';
  const isFacility = lastWork?.isFacility || false;
  const contactName = lastWork?.contactName || '';

  // 모든 visits의 사진 수 합계
  let totalPhotos = 0;
  (c.visits || []).forEach(v => {
    if (typeof v.totalPhotos === 'number') totalPhotos += v.totalPhotos;
    else if (typeof v.photos === 'number') totalPhotos += v.photos;
    else {
      const m = (v.work || '').match(/Photos:\s*(\d+)/);
      if (m) totalPhotos += parseInt(m[1]) || 0;
    }
  });

  // ★ 새 레이아웃
  // 1줄: 작업명 (+ 시설 배지)
  // 2줄: 호수/영역 + 전화번호
  // 3줄: 메타 (회수, 날짜)
  const aptDisplay = apt
    ? `${isFacility ? '🏢' : '🏠'} ${escHtmlSafe(apt)}`
    : `${isFacility ? '🏢' : '🏠'} (작업명 없음)`;

  // 호수/영역 정보
  let unitInfo = '';
  if (isFacility) {
    const zones = lastWork?.unitNames || [];
    if (zones.length > 0) {
      const shown = zones.slice(0, 2).join(', ');
      const more = zones.length > 2 ? ` +${zones.length - 2}` : '';
      unitInfo = `${shown}${more}`;
    } else {
      unitInfo = '공용시설';
    }
  } else {
    const unit = lastWork?.unit || '';
    unitInfo = unit ? escHtmlSafe(unit) : '';
  }

  // 전화번호
  const phone = c.phone || '';

  return `
    <div class="cust-card${isFacility ? ' cust-card-facility' : ''}" data-phone="${escHtmlSafe(c.phone)}" data-apt-filter="${escHtmlSafe(c._aptFilter || '')}" data-workid="${escHtmlSafe(c._workIdFilter || '')}">
      <div class="cust-card-top">
        ${_custIndChip(lastWork)}
        <span class="cust-card-name">${aptDisplay}</span>
        ${unitInfo ? `<span class="cust-unit">${unitInfo}</span>` : ''}
      </div>
      <div class="cust-card-bottom">
        <div class="cust-card-info">
          ${phone ? `<span class="cust-phone">📞 ${escHtmlSafe(phone)}</span>` : ''}
          <span>📷 사진 ${totalPhotos}장</span>
          <span>· ${lastVisit}</span>
          ${c.visitCount >= 2 ? `<span>· ${c.visitCount}회 작업</span>` : ''}
        </div>
        <div class="cust-card-actions">
          <button class="cust-card-btn cust-card-open" data-phone="${escHtmlSafe(c.phone)}" data-apt-filter="${escHtmlSafe(c._aptFilter || '')}" data-workid="${escHtmlSafe(c._workIdFilter || '')}" title="작업 열기"><span class="btn-ic">📂</span><span class="btn-tx">열기</span></button>
          <button class="cust-card-btn cust-card-edit" data-phone="${escHtmlSafe(c.phone)}" title="정보 수정"><span class="btn-ic">✏️</span><span class="btn-tx">정보</span></button>
          <button class="cust-card-btn cust-card-del" data-phone="${escHtmlSafe(c.phone)}" data-apt-filter="${escHtmlSafe(c._aptFilter || '')}" data-workid="${escHtmlSafe(c._workIdFilter || '')}" title="삭제"><span class="btn-ic">🗑️</span><span class="btn-tx">삭제</span></button>
        </div>
      </div>
    </div>
  `;
}

// 작업 카드 (전화번호 없는 작업) - 고객 카드와 동일한 형식
function renderWorkCard(w) {
  const isFacility = w.session?.workType === 'facility';
  const unitNames = (w.units || []).map(u => u.name).filter(n => n);

  // 호수/영역 정보
  let unitInfo = '';
  if (unitNames.length > 0) {
    const shown = unitNames.slice(0, 2).join(', ');
    const more = unitNames.length > 2 ? ` +${unitNames.length - 2}` : '';
    unitInfo = `${shown}${more}`;
  }

  const aptDisplay = w.apt
    ? `${isFacility ? '🏢' : '🏠'} ${escHtmlSafe(w.apt)}`
    : `${isFacility ? '🏢' : '🏠'} (작업명 없음)`;

  return `
    <div class="cust-card cust-card-work${isFacility ? ' cust-card-facility' : ''}" data-folder="${escHtmlSafe(w.folderName)}" data-apt="${escHtmlSafe(w.apt || '')}" data-date="${escHtmlSafe(w.date || '')}">
      <div class="cust-card-top">
        ${_custIndChip(w)}
        <span class="cust-card-name">${aptDisplay}</span>
        ${unitInfo ? `<span class="cust-unit">${escHtmlSafe(unitInfo)}</span>` : ''}
      </div>
      <div class="cust-card-bottom">
        <div class="cust-card-info">
          <span style="color:var(--mu);font-style:italic;">📞 미입력</span>
          <span>· ${escHtmlSafe(w.date)}</span>
          <span>· 사진 ${w.totalPhotos}장</span>
        </div>
        <div class="cust-card-actions">
          <button class="cust-card-btn cust-card-work-open" data-folder="${escHtmlSafe(w.folderName)}" data-apt="${escHtmlSafe(w.apt || '')}" data-date="${escHtmlSafe(w.date || '')}" title="작업 열기"><span class="btn-ic">📂</span><span class="btn-tx">열기</span></button>
          <button class="cust-card-btn cust-card-work-del" data-folder="${escHtmlSafe(w.folderName)}" title="삭제"><span class="btn-ic">🗑️</span><span class="btn-tx">삭제</span></button>
        </div>
      </div>
    </div>
  `;
}

// 기간 필터 다이얼로그
function openCustomerDateFilter() {
  const today = localDateStr();
  const from = _customerDateFrom || getDefaultDateFrom();
  const to = _customerDateTo || today;

  const html = `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:1700;display:flex;align-items:center;justify-content:center;padding:16px;" id="custDateOverlay">
      <div style="background:var(--sf);border-radius:14px;padding:20px;max-width:380px;width:100%;">
        <div style="font-size:16px;font-weight:800;margin-bottom:14px;">📅 기간 선택</div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">
          <button class="btn b-ghost" id="custDQuick3" style="width:100%;justify-content:flex-start;">최근 3일 (기본)</button>
          <button class="btn b-ghost" id="custDQuick7" style="width:100%;justify-content:flex-start;">최근 7일</button>
          <button class="btn b-ghost" id="custDQuick30" style="width:100%;justify-content:flex-start;">최근 30일</button>
          <button class="btn b-ghost" id="custDQuickAll" style="width:100%;justify-content:flex-start;">전체</button>
        </div>
        <div style="border-top:1px solid var(--bd);padding-top:14px;">
          <div style="font-size:12px;color:var(--mu);margin-bottom:8px;">또는 직접 선택</div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:12px;width:36px;">시작</span>
              <input type="date" id="custDFrom" value="${from}" class="cust-inp" style="flex:1;">
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:12px;width:36px;">종료</span>
              <input type="date" id="custDTo" value="${to}" max="${today}" class="cust-inp" style="flex:1;">
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:14px;">
          <button class="btn b-blue" id="custDApply" style="flex:1;">적용</button>
          <button class="btn b-ghost" id="custDCancel">취소</button>
        </div>
      </div>
    </div>
  `;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap.firstElementChild);

  const closeOverlay = () => document.getElementById('custDateOverlay')?.remove();

  document.getElementById('custDQuick3').addEventListener('click', () => {
    _customerUseDefault = true;
    _customerDateFrom = null;
    _customerDateTo = null;
    saveCustomerFilter();
    closeOverlay();
    if (typeof invalidateRecordsCache === 'function') invalidateRecordsCache();
    renderCustomerList({ forceFresh: true });
  });

  document.getElementById('custDQuick7').addEventListener('click', () => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    _customerUseDefault = false;
    _customerDateFrom = localDateStr(d);
    _customerDateTo = localDateStr();
    saveCustomerFilter();
    closeOverlay();
    if (typeof invalidateRecordsCache === 'function') invalidateRecordsCache();
    renderCustomerList({ forceFresh: true });
  });

  document.getElementById('custDQuick30').addEventListener('click', () => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    _customerUseDefault = false;
    _customerDateFrom = localDateStr(d);
    _customerDateTo = localDateStr();
    saveCustomerFilter();
    closeOverlay();
    // ★ 캐시 무시하고 최신 데이터로 - 사용자 명시적 기간 변경 (1.249)
    if (typeof invalidateRecordsCache === 'function') invalidateRecordsCache();
    renderCustomerList({ forceFresh: true });
  });

  document.getElementById('custDQuickAll').addEventListener('click', () => {
    _customerUseDefault = false;
    _customerDateFrom = null;
    _customerDateTo = null;
    saveCustomerFilter();
    closeOverlay();
    if (typeof invalidateRecordsCache === 'function') invalidateRecordsCache();
    renderCustomerList({ forceFresh: true });
  });

  document.getElementById('custDApply').addEventListener('click', () => {
    const f = document.getElementById('custDFrom').value;
    const t = document.getElementById('custDTo').value;
    _customerUseDefault = false;
    _customerDateFrom = f || null;
    _customerDateTo = t || null;
    saveCustomerFilter();
    closeOverlay();
    if (typeof invalidateRecordsCache === 'function') invalidateRecordsCache();
    renderCustomerList({ forceFresh: true });
  });

  document.getElementById('custDCancel').addEventListener('click', closeOverlay);
}

// 작업 열기
async function openWorkForCustomer(phone, aptFilter, workIdFilter) {
  let c = await customerLookup(phone);
  // ★ 못 찾으면 캐시 무효화 후 재시도 (1.248) - 작업기록 모달 직후 race condition 대응
  if (!c) {
    if (typeof invalidateCustomersV2 === 'function') invalidateCustomersV2();
    c = await customerLookup(phone);
  }
  if (!c) {
    showToast('고객 정보를 찾을 수 없습니다', 'err');
    return;
  }

  let visits = c.visits || [];

  // ★ workId 매칭 우선 (있으면)
  if (workIdFilter) {
    visits = visits.filter(v => v.workId === workIdFilter);
  } else if (aptFilter) {
    // workId 없으면 apt 매칭 (legacy)
    visits = visits.filter(v => (v.apt || '') === aptFilter);
  }

  if (visits.length === 0) {
    showToast('연결된 작업이 없습니다', 'err');
    return;
  }

  if (visits.length === 1) {
    await loadWorkByVisit(visits[0]);
    return;
  }

  showVisitSelector(c, visits);
}

function showVisitSelector(customer, visits) {
  const sorted = [...visits].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  function renderItems() {
    return sorted.map((v, i) => {
      const isFacility = v.isFacility;
      const titleIc = isFacility ? '🏢' : '📁';
      const subIc = isFacility ? '📐' : '🏠';
      const subText = isFacility
        ? (v.unitNames?.length ? `${v.unitNames.length}개 영역 (${v.unitNames.slice(0, 3).join(', ')}${v.unitNames.length > 3 ? '...' : ''})` : v.unit || '')
        : (v.unit || '');
      const photoText = (typeof v.photos === 'number' && v.photos > 0)
        ? `사진 ${v.photos}장`
        : (v.work || '');

      return `
        <div class="visit-sel-row" style="display:flex;gap:6px;align-items:stretch;">
          <button class="btn b-ghost visit-sel-btn" data-visit-idx="${i}" style="flex:1;justify-content:flex-start;text-align:left;padding:12px;">
            <div style="display:flex;flex-direction:column;gap:4px;width:100%;">
              <div style="font-weight:700;color:var(--ac);">${titleIc} ${escHtmlSafe(v.apt || '작업')}</div>
              <div style="font-size:12px;">${subIc} ${escHtmlSafe(subText)} <span style="color:var(--mu);">· ${escHtmlSafe(v.date || '')}</span></div>
              ${photoText ? `<div style="font-size:11px;color:var(--mu);">${escHtmlSafe(photoText)}</div>` : ''}
            </div>
          </button>
          <button class="btn b-ghost visit-sel-del" data-visit-idx="${i}" title="이 작업 삭제" style="flex-shrink:0;width:48px;padding:0;font-size:18px;">🗑️</button>
        </div>
      `;
    }).join('');
  }

  const html = `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:1700;display:flex;align-items:center;justify-content:center;padding:16px;" id="visitSelOverlay">
      <div style="background:var(--sf);border-radius:14px;padding:20px;max-width:480px;width:100%;max-height:80vh;display:flex;flex-direction:column;">
        <div style="font-size:16px;font-weight:800;margin-bottom:6px;">${escHtmlSafe(customer.name || customer.phone)}</div>
        <div style="font-size:12px;color:var(--mu);margin-bottom:14px;">${sorted.length}개 작업이 있습니다. 선택하세요.</div>
        <div id="visitSelList" style="overflow-y:auto;display:flex;flex-direction:column;gap:8px;">
          ${renderItems()}
        </div>
        <button class="btn b-ghost" id="visitSelCancel" style="margin-top:14px;">취소</button>
      </div>
    </div>
  `;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap.firstElementChild);

  const closeSel = () => document.getElementById('visitSelOverlay')?.remove();

  function bindRowEvents() {
    document.querySelectorAll('.visit-sel-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.visitIdx);
        const visit = sorted[idx];
        closeSel();
        await loadWorkByVisit(visit);
      });
    });

    // 삭제 버튼
    document.querySelectorAll('.visit-sel-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.visitIdx);
        const visit = sorted[idx];

        if (!confirm(
          `다음 작업을 삭제할까요?\n\n` +
          `${visit.apt || ''} · ${visit.unit || ''}\n` +
          `${visit.date || ''}\n\n` +
          `※ 이 고객의 작업 기록과 폴더 데이터가 삭제됩니다.\n` +
          `(다른 작업 기록은 유지됩니다)`
        )) return;

        showOverlay('작업 기록 삭제 중...');
        try {
          // 1) 고객의 visits 배열에서 이 항목만 제거
          const updatedVisits = (customer.visits || []).filter(v =>
            !(v.apt === visit.apt && v.unit === visit.unit && v.date === visit.date)
          );

          customer.visits = updatedVisits;
          customer.visitCount = updatedVisits.length;
          if (updatedVisits.length > 0) {
            customer.lastVisit = updatedVisits.reduce((max, v) =>
              (v.date || '') > (max || '') ? v.date : max, '');
          } else {
            customer.lastVisit = '';
          }

          // 2) customers DB 저장
          if (typeof customerSave === 'function') {
            // visits 배열 통째 업데이트가 필요 - 직접 DB 업데이트
            if (typeof customerUpdateVisits === 'function') {
              await customerUpdateVisits(customer.phone, updatedVisits);
            } else {
              // 폴백: 일단 visits 직접 수정 시도
              await customerSave({
                phone: customer.phone,
                name: customer.name,
                address: customer.address,
                memo: customer.memo,
                _visitsOverride: updatedVisits  // 특수 마커
              });
            }
          }

          // 3) xlsx 갱신
          if (typeof flushCustomersXlsx === 'function') {
            await flushCustomersXlsx();
          }

          // 4) 폴더 삭제 (다른 호수도 함께 있을 수 있으니 신중하게)
          // → 폴더는 다른 작업과 공유될 수 있으므로 자동 삭제하지 않음
          //   사용자가 작업 기록의 작업 카드에서 별도로 삭제하도록 안내
          //   (대신 visits에서만 제거)

          hideOverlay();
          showToast('✓ 작업 기록 삭제됨', 'ok');

          // 5) 모든 visits 삭제됐으면 다이얼로그 닫고 목록 갱신
          if (updatedVisits.length === 0) {
            closeSel();
            await renderCustomerList();
            return;
          }

          // 6) 다이얼로그 갱신 (sorted 재구성)
          sorted.splice(idx, 1);
          const listEl = document.getElementById('visitSelList');
          if (listEl) {
            listEl.innerHTML = renderItems();
            bindRowEvents();
          }

          // 1개 남았으면 자동 닫고 그 작업 열기? → 아니, 사용자가 다시 선택하도록
          if (sorted.length === 0) {
            closeSel();
            await renderCustomerList();
          }
        } catch(err) {
          hideOverlay();
          console.error(err);
          showToast('삭제 실패: ' + (err.message || err), 'err');
        }
      });
    });
  }

  bindRowEvents();
  document.getElementById('visitSelCancel').addEventListener('click', closeSel);
}

// visit으로 실제 작업 불러오기
async function loadWorkByVisit(visit) {
  if (_appBusy) return;

  if (!photoFolderHandle) {
    showToast('저장 폴더가 설정되어 있어야 작업을 열 수 있습니다', 'err');
    return;
  }
  if (!visit.date && !visit.workId) {
    showToast('작업 정보가 부족합니다', 'err');
    return;
  }

  // 현재 작업과 같으면 그냥 닫기
  if (visit.workId && currentWorkId === visit.workId) {
    closeCustomerModal();
    showToast('이미 현재 작업입니다', 'ok');
    return;
  }
  if (!visit.workId && isSameAsCurrent(visit.apt, visit.date)) {
    closeCustomerModal();
    showToast('이미 현재 작업입니다', 'ok');
    return;
  }

  // ★ 확인 다이얼로그 즉시 (지연 없이)
  const aptName = visit.apt || '작업';
  const dateStr = visit.date || '';
  const msg = `📂 작업 불러오기\n\n${aptName}${dateStr ? ' · ' + dateStr : ''}\n\n이 작업을 불러올까요?`;
  if (!confirm(msg)) return;

  // 입력 차단
  setAppBusy(true, '📂 불러오는 중...');
  closeCustomerModal();

  try {
    // 변경사항 있으면 먼저 저장 (백그라운드)
    // ★ _dataDirty 플래그 우선 (1.248) - force 제거하여 내부 dirty 체크 작동
    try {
      const isDirty = (typeof _dataDirty !== 'undefined' && _dataDirty);
      if (isDirty && units && units.length > 0 && photoFolderHandle && typeof saveToFolder === 'function') {
        await saveToFolder({ auto: true, silent: true });
      }
    } catch(e) { console.warn('자동저장 실패:', e); }

    let matchedFolder = null;
    let matchedSession = null;

    // ★★★ 1단계: visit.sourceFolderName으로 직접 열기 (1.248)
    //   - 전체 폴더 스캔(작업 N개 × _session.json 읽기) 회피 - 10초 → 0.5초
    //   - 이전: 모든 폴더 순회하며 workId 매칭 검색
    const _T0 = Date.now();
    if (visit.sourceFolderName) {
      try {
        const entry = await photoFolderHandle.getDirectoryHandle(visit.sourceFolderName);
        const sf = await entry.getFileHandle('_session.json');
        const file = await sf.getFile();
        const data = JSON.parse(await file.text());
        // workId 검증 (선택적)
        if (!visit.workId || data.workId === visit.workId) {
          matchedFolder = entry;
          matchedSession = data;
          console.log(`[작업열기] sourceFolderName 직접 매칭: ${visit.sourceFolderName} (${Date.now()-_T0}ms)`);
        }
      } catch(e) {
        console.warn(`[작업열기] sourceFolderName(${visit.sourceFolderName}) 직접 열기 실패 - 폴더 스캔으로 폴백`);
      }
    }

    // ★ 2단계: 직접 매칭 실패 시에만 전체 스캔 (폴백)
    if (!matchedFolder) {
      console.log('[작업열기] 폴더 스캔 폴백 시작');
      const _Tscan = Date.now();
      // ★ 모든 폴더 목록 한 번에 수집 후 병렬 _session.json 읽기
      const dateDirs = [];
      for await (const entry of photoFolderHandle.values()) {
        if (entry.kind !== 'directory') continue;
      if (!/^\d{4}-\d{2}-\d{2}/.test(entry.name)) continue;
      // 2차 매칭용 - 날짜로 사전 필터
      if (!visit.workId && visit.date && !entry.name.startsWith(visit.date)) continue;
      dateDirs.push(entry);
    }

    // 병렬로 _session.json 모두 읽기
    const results = await Promise.all(dateDirs.map(async (entry) => {
      try {
        const sessionFile = await entry.getFileHandle('_session.json');
        const file = await sessionFile.getFile();
        const data = JSON.parse(await file.text());
        return { entry, data };
      } catch(e) { return null; }
    }));

    // ★ 1차: workId로 검색 (가장 정확)
    if (visit.workId) {
      for (const r of results) {
        if (!r) continue;
        if (r.data.workId === visit.workId) {
          matchedFolder = r.entry;
          matchedSession = r.data;
          break;
        }
      }
    }

    // ★ 2차: apt + date로 검색 (legacy)
    if (!matchedFolder && visit.apt && visit.date) {
      for (const r of results) {
        if (!r) continue;
        if (r.data.apt === visit.apt && r.entry.name.startsWith(visit.date)) {
          matchedFolder = r.entry;
          matchedSession = r.data;
          break;
        }
      }
    }
      console.log(`[작업열기] 폴더 스캔 완료: ${Date.now() - _Tscan}ms`);
    }  // !matchedFolder 폴백 끝

    if (!matchedFolder || !matchedSession) {
      hideOverlay();
      showToast(`작업을 찾을 수 없습니다`, 'err');
      return;
    }

    if (typeof loadFromDateFolder === 'function') {
      await loadFromDateFolder(matchedFolder, matchedSession);
    } else {
      hideOverlay();
      showToast('작업 불러오기 함수를 찾을 수 없습니다', 'err');
    }
  } catch(e) {
    hideOverlay();
    console.error(e);
    showToast('불러오기 실패: ' + e.message, 'err');
  } finally {
    setAppBusy(false);
  }
}

// 고객 정보 수정 다이얼로그
async function openCustomerEdit(phone) {
  const c = await customerLookup(phone);
  if (!c) return;

  const html = `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:1700;display:flex;align-items:center;justify-content:center;padding:16px;" id="custEditOverlay">
      <div style="background:var(--sf);border-radius:14px;padding:20px;max-width:480px;width:100%;">
        <div style="font-size:16px;font-weight:800;margin-bottom:14px;">✏️ 고객 정보 수정</div>

        <div style="display:flex;flex-direction:column;gap:10px;">
          <div>
            <label style="font-size:12px;color:var(--mu);font-weight:700;">전화번호</label>
            <input class="cust-inp" id="custEditPhone" type="text" value="${escHtmlSafe(c.phone)}" style="width:100%;margin-top:4px;" disabled>
          </div>
          <div>
            <label style="font-size:12px;color:var(--mu);font-weight:700;">이름</label>
            <input class="cust-inp" id="custEditName" type="text" value="${escHtmlSafe(c.name || '')}" placeholder="이름" style="width:100%;margin-top:4px;">
          </div>
          <div>
            <label style="font-size:12px;color:var(--mu);font-weight:700;">주소</label>
            <input class="cust-inp" id="custEditAddr" type="text" value="${escHtmlSafe(c.address || '')}" placeholder="주소" style="width:100%;margin-top:4px;">
          </div>
          <div>
            <label style="font-size:12px;color:var(--mu);font-weight:700;">메모</label>
            <textarea class="cust-memo" id="custEditMemo" rows="3" placeholder="메모" style="width:100%;margin-top:4px;">${escHtmlSafe(c.memo || '')}</textarea>
          </div>
        </div>

        <div style="display:flex;gap:8px;margin-top:14px;">
          <button class="btn b-blue" id="custEditSave" style="flex:1;">저장</button>
          <button class="btn b-ghost" id="custEditCancel">취소</button>
        </div>
      </div>
    </div>
  `;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap.firstElementChild);

  const closeEdit = () => document.getElementById('custEditOverlay')?.remove();

  document.getElementById('custEditSave').addEventListener('click', async () => {
    const newName = document.getElementById('custEditName').value.trim();
    const newAddr = document.getElementById('custEditAddr').value.trim();
    const newMemo = document.getElementById('custEditMemo').value.trim();

    showOverlay('저장 중...');
    try {
      await customerSave({
        phone: c.phone,
        name: newName,
        address: newAddr,
        memo: newMemo
      });
      if (typeof flushCustomersXlsx === 'function') await flushCustomersXlsx();
      closeEdit();
      await renderCustomerList();
      hideOverlay();
      showToast('✓ 고객 정보 수정됨', 'ok');
    } catch(e) {
      hideOverlay();
      showToast('수정 실패: ' + e.message, 'err');
    }
  });

  document.getElementById('custEditCancel').addEventListener('click', closeEdit);
}

// 고객 엑셀(customers.xlsx)을 앱 안에서 표로 보여준다.
// (저장 폴더는 앱 전용 영역이라 '내 파일'로 직접 열 수 없으므로 인앱 뷰어 제공)
async function openCustomersXlsxFile() {
  if (!photoFolderHandle) { showToast('저장 폴더가 설정되지 않았습니다', 'err'); return; }
  if (typeof XLSX === 'undefined') { showToast('엑셀 모듈을 불러오지 못했습니다', 'err'); return; }

  let wb = null, fileSize = '';
  try {
    const fh = await photoFolderHandle.getFileHandle('customers.xlsx');
    const f = await fh.getFile();
    fileSize = (f.size / 1024).toFixed(1) + ' KB';
    const buf = await f.arrayBuffer();
    wb = XLSX.read(buf, { type: 'array' });
  } catch (e) { /* 파일 없음 → 아래에서 안내 */ }

  const existing = document.getElementById('xlsxInfoModal');
  if (existing) existing.remove();

  function sheetLabel(name) {
    if (name === 'Customers') return '고객';
    if (name === 'Visits') return '방문기록';
    return name;
  }

  let inner = '';
  if (!wb) {
    inner = '<div style="font-size:13px;color:#e55;line-height:1.7;">아직 고객 데이터가 없습니다.<br>작업을 저장하면 자동으로 만들어집니다.</div>';
  } else {
    let tables = '';
    (wb.SheetNames || []).forEach(function (name) {
      const ws = wb.Sheets[name];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const label = sheetLabel(name);
      if (!aoa.length) {
        tables += '<div style="font-weight:700;margin:12px 0 6px;">' + escHtmlSafe(label) + '</div>' +
                  '<div style="font-size:12px;color:var(--mu);">(비어 있음)</div>';
        return;
      }
      let rows = '';
      aoa.forEach(function (r, ri) {
        const tag = ri === 0 ? 'th' : 'td';
        const bg = ri === 0 ? 'background:var(--sf2);position:sticky;top:0;' : '';
        let cells = '';
        (r || []).forEach(function (c) {
          cells += '<' + tag + ' style="border:1px solid var(--bd,#3a3a4a);padding:5px 9px;white-space:nowrap;font-size:12px;text-align:left;' + bg + '">' +
                   escHtmlSafe(String(c == null ? '' : c)) + '</' + tag + '>';
        });
        rows += '<tr>' + cells + '</tr>';
      });
      tables += '<div style="font-weight:700;margin:14px 0 6px;">' + escHtmlSafe(label) +
                ' <span style="font-size:11px;color:var(--mu);font-weight:400;">(' + (aoa.length - 1) + '건)</span></div>' +
                '<div style="overflow:auto;max-height:42vh;border-radius:8px;border:1px solid var(--bd,#3a3a4a);">' +
                '<table style="border-collapse:collapse;min-width:100%;">' + rows + '</table></div>';
    });
    inner = '<div style="font-size:11px;color:var(--mu);margin-bottom:6px;">customers.xlsx · ' + fileSize + '</div>' + tables;
  }

  const wrap = document.createElement('div');
  wrap.id = 'xlsxInfoModal';
  wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:1700;display:flex;align-items:center;justify-content:center;padding:16px;';
  wrap.innerHTML =
    '<div style="background:var(--sf);border-radius:14px;padding:18px;max-width:560px;width:100%;max-height:calc(100vh - 44px);display:flex;flex-direction:column;">' +
      '<div style="font-size:15px;font-weight:800;margin-bottom:12px;">📊 고객 정보</div>' +
      '<div style="overflow:auto;flex:1;">' + inner + '</div>' +
      '<button class="btn b-blue" id="xlsxInfoClose" style="width:100%;justify-content:center;margin-top:14px;">확인</button>' +
    '</div>';
  document.body.appendChild(wrap);
  wrap.querySelector('#xlsxInfoClose').addEventListener('click', function () { wrap.remove(); });
  wrap.addEventListener('click', function (e) { if (e.target === wrap) wrap.remove(); });
}


// 고객 엑셀(customers.xlsx)을 내보낸다.
// 네이티브: Capacitor Filesystem으로 Documents/작업보고서에 저장(파일앱·PC에서 보임).
//          Share 플러그인이 있으면 공유창도 시도. (backup.js와 동일한 검증된 방식)
// 웹/PWA: navigator.share 또는 anchor 다운로드.
function _ccIsNative() {
  if (window.NativeFS && typeof NativeFS.isNative === 'function') return NativeFS.isNative();
  return !!(window.Capacitor && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform());
}
function _ccPlugin(name) {
  return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name];
}
function _ccBlobToBase64(blob) {
  return new Promise(function (res, rej) {
    var r = new FileReader();
    r.onloadend = function () { var t = String(r.result); var k = t.indexOf(','); res(k >= 0 ? t.slice(k + 1) : t); };
    r.onerror = function () { rej(r.error || new Error('파일 읽기 실패')); };
    r.readAsDataURL(blob);
  });
}

async function exportCustomersExcel(mode) {
  if (!photoFolderHandle) { showToast('저장 폴더가 설정되지 않았습니다', 'err'); return; }

  // 최신 데이터로 즉시 갱신
  try {
    if (typeof flushCustomersXlsx === 'function') await flushCustomersXlsx({ immediate: true });
  } catch(e) { console.warn('xlsx 즉시 갱신 실패:', e); }

  // customers.xlsx 읽기
  let blob = null;
  try {
    const fh = await photoFolderHandle.getFileHandle('customers.xlsx');
    blob = await fh.getFile();
  } catch(e) {
    showToast('고객 엑셀 파일이 아직 없어요. 작업을 먼저 저장해 주세요.', 'err');
    return;
  }
  if (!blob || blob.size === 0) { showToast('내보낼 고객 데이터가 없어요.', 'err'); return; }

  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const fname = `고객정보_${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}.xlsx`;
  const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  // ── 네이티브 앱 ──
  if (_ccIsNative()) {
    const FS = _ccPlugin('Filesystem');
    if (!FS) { showToast('파일 저장 모듈이 없어요(앱 재빌드 필요)', 'err'); return; }
    try {
      const b64 = await _ccBlobToBase64(blob);
      const relDir = '작업보고서';
      // 공용 문서 폴더 우선 → 실패 시 앱 전용(EXTERNAL)
      let dir = 'DOCUMENTS';
      try {
        await FS.writeFile({ path: relDir + '/' + fname, data: b64, directory: dir, recursive: true });
      } catch(e1) {
        dir = 'EXTERNAL';
        await FS.writeFile({ path: relDir + '/' + fname, data: b64, directory: dir, recursive: true });
      }
      // 저장 파일 uri
      let savedUri = '';
      try { const u = await FS.getUri({ path: relDir + '/' + fname, directory: dir }); savedUri = u && u.uri; } catch(e) {}

      // 공유 버튼이면 Share 플러그인으로 공유창 시도
      if (mode === 'share') {
        const Share = _ccPlugin('Share');
        if (Share && savedUri) {
          try { await Share.share({ title: '고객정보', text: '고객정보 엑셀 파일', files: [savedUri], dialogTitle: '고객정보 공유' }); return; }
          catch(e) { if (e && /cancel/i.test(e.message || '')) return; console.warn('공유 실패:', e); }
        }
      }

      const where = (dir === 'DOCUMENTS') ? '내장메모리 > Documents > 작업보고서' : '앱 전용 폴더 > 작업보고서';
      const extra = (mode === 'share' && !_ccPlugin('Share'))
        ? '\n\n※ 카톡 등으로 바로 공유하려면 공유 기능 추가가 필요해, 우선 파일로 저장했어요.\n\'내 파일\' 앱에서 이 파일을 열어 공유할 수 있어요.'
        : '\n\n\'내 파일\' 앱이나 PC에서 이 파일을 열 수 있어요.';
      alert('✅ 엑셀 저장 완료\n\n파일: ' + fname + '\n위치: ' + where + extra);
      return;
    } catch(e) {
      console.error('엑셀 저장 실패:', e);
      showToast('저장 실패: ' + (e.message || e), 'err');
      return;
    }
  }

  // ── 웹/PWA ──
  if (mode === 'share') {
    try {
      const file = new File([await blob.arrayBuffer()], fname, { type: MIME });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: '고객정보', text: '고객정보 엑셀 파일' });
        return;
      }
    } catch(e) { if (e && e.name === 'AbortError') return; }
  }
  try {
    const url = URL.createObjectURL(new Blob([await blob.arrayBuffer()], { type: MIME }));
    const a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast('📥 다운로드 완료: ' + fname, 'ok');
  } catch(e) {
    showToast('내보내기 실패: ' + (e.message || e), 'err');
  }
}
window.exportCustomersExcel = exportCustomersExcel;


function escHtmlSafe(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

async function updateCustomerSummary() {
  const el = document.getElementById('setCustomerSummary');
  if (!el) return;
  try {
    const customers = await customerListAll();
    const total = customers.length;
    const repeat = customers.filter(c => (c.visitCount || 0) >= 2).length;
    el.innerHTML = `<b style="color:var(--ac);">총 ${total}명</b>` +
      (repeat > 0 ? ` · 재작업 ${repeat}명` : '');
  } catch(e) {
    el.textContent = '고객 0명';
  }
}

function bindCustomerEvents() {
  const hdrBtn = document.getElementById('btnCustomersHdr');
  const setBtn = document.getElementById('setOpenCustomers');
  const closeBtn = document.getElementById('customerClose');
  const closeFoot = document.getElementById('customerCloseFoot');
  const xlsxBtn = document.getElementById('setOpenXlsx');
  const allBtn = document.getElementById('customerOpenAll');

  if (hdrBtn) hdrBtn.addEventListener('click', openCustomerModal);

  if (setBtn) setBtn.addEventListener('click', () => {
    document.getElementById('settingsModal')?.classList.remove('open');
    openCustomerModal();
  });

  if (closeBtn) closeBtn.addEventListener('click', closeCustomerModal);
  if (closeFoot) closeFoot.addEventListener('click', closeCustomerModal);
  if (xlsxBtn) xlsxBtn.addEventListener('click', openCustomersXlsxFile);
  const shareXlsxBtn = document.getElementById('setShareXlsx');
  const dlXlsxBtn    = document.getElementById('setDownloadXlsx');
  if (shareXlsxBtn) shareXlsxBtn.addEventListener('click', () => exportCustomersExcel('share'));
  if (dlXlsxBtn)    dlXlsxBtn.addEventListener('click', () => exportCustomersExcel('download'));

  // ★ 사진 개수 검사 버튼 — 관리자 전용 (2026-08-09)
  //   일반 사용자에게는 숨긴다. 데이터가 어긋나면 설정 → '서버에서 복구'를 쓰면 되고,
  //   이 도구는 진단·수동 교정용이라 잘못 쓰면 기록을 덮어쓸 수 있다.
  const refreshBtn = document.getElementById('customerRefresh');
  if (refreshBtn) {
    refreshBtn.style.display = 'none';   // 기본 숨김 (관리자 확인 후 노출)
    refreshBtn.addEventListener('click', () => {
      if (_appBusy) return;
      if (!(window.Subs && Subs.isAdmin && Subs.isAdmin())) { showToast('관리자 전용입니다', 'err'); return; }
      if (window.PhotoAudit && typeof PhotoAudit.open === 'function') PhotoAudit.open();
      else showToast('사진 검사 도구를 불러오지 못했습니다', 'err');
    });
  }
  // 구독/관리자 정보는 로그인 후에 확정되므로 주기적으로 확인해 노출 전환
  window.refreshPhotoAuditVisibility = function () {
    var b = document.getElementById('customerRefresh');
    if (!b) return;
    var adm = false;
    try { adm = !!(window.Subs && Subs.isAdmin && Subs.isAdmin()); } catch (e) {}
    b.style.display = adm ? '' : 'none';
  };
  setTimeout(window.refreshPhotoAuditVisibility, 2500);
  setTimeout(window.refreshPhotoAuditVisibility, 8000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindCustomerEvents);
} else {
  bindCustomerEvents();
}
