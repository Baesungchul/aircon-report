/* ═══════════════════════════════════════════════
   고객 관리 (Customers)
═══════════════════════════════════════════════ */

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
  // ★ 백그라운드 저장 중이면 완료될 때까지 안내 모달 표시
  if (window._isSavingInBackground) {
    // 안내 오버레이 표시
    const overlay = document.createElement('div');
    overlay.id = 'bgSaveOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:600;display:flex;align-items:center;justify-content:center;';
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

  // 권한 먼저 확보
  if (photoFolderHandle) {
    try {
      let perm = await photoFolderHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        perm = await photoFolderHandle.requestPermission({ mode: 'readwrite' });
      }
      if (perm !== 'granted') {
        showToast('폴더 권한이 필요합니다', 'err');
      }
    } catch(e) {
      console.warn('[작업기록] 권한 확인 실패:', e);
    }
  }

  await renderCustomerList();
}

function closeCustomerModal() {
  document.getElementById('customerModal').classList.remove('open');
}

function getDefaultDateFrom() {
  const d = new Date();
  d.setDate(d.getDate() - CUSTOMER_DEFAULT_DAYS + 1);
  return localDateStr(d);
}

// ════════════════════════════════════════
// 통합 데이터 로딩
//   - 고객 (customers DB)
//   - 폴더의 모든 작업 (_session.json) - 전화번호 없는 것도 포함
//   - 중복 제거: 같은 작업이 customer.visits에 있으면 작업 카드는 생략
// 반환: [{ type: 'customer'|'work', sortDate, data }, ...]
// ════════════════════════════════════════
async function loadCombinedRecords() {
  const items = [];
  const customerWorkIds = new Set();
  const customerAptDateKeys = new Set();

  // ★ 폴더 권한 보장 (V2는 _session.json 스캔이 필수)
  if (photoFolderHandle) {
    try {
      let perm = await photoFolderHandle.queryPermission({ mode: 'read' });
      if (perm !== 'granted') {
        perm = await photoFolderHandle.requestPermission({ mode: 'read' });
        if (perm !== 'granted') {
          // 권한 없으면 안내 (작업 카드는 표시 못 함)
          showToast('폴더 권한이 필요합니다', 'err');
        }
      }
    } catch(e) { console.warn('[작업기록] 권한 체크 실패:', e); }
  }

  // 1. 고객 데이터 로드 - workId별로 그룹화
  try {
    const customers = await customerListAll();
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
        const sortedVisits = [...groupVisits].sort((a, b) =>
          (b.date || '').localeCompare(a.date || ''));
        const lastVisit = sortedVisits[0]?.date || '';
        const apt = sortedVisits[0]?.apt || '';
        const workId = sortedVisits[0]?.workId || '';

        items.push({
          type: 'customer',
          sortDate: lastVisit,
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
      if (_customerUseDefault) {
        filterFrom = getDefaultDateFrom();
        filterTo = localDateStr();
      } else {
        filterFrom = _customerDateFrom;
        filterTo = _customerDateTo;
      }

      // 1단계: 디렉토리 엔트리 수집 - ★ 폴더명으로 기간 필터링
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
      const seenWorkIds = new Set();
      for (const result of results) {
        if (!result) continue;
        const { entry, data } = result;

        if (!data.units || data.units.length === 0) continue;

        const apt = data.apt || '';
        const date = data.date || entry.name.slice(0, 10);
        const workId = data.workId || '';

        // ★ 폴더 자체의 중복만 제거 (같은 작업이 여러 폴더에 있는 경우)
        // 고객 매칭과 무관하게 모든 작업을 표시
        if (workId) {
          if (seenWorkIds.has(workId)) continue;
          seenWorkIds.add(workId);
        } else {
          const aptDateKey = `${apt}::${date}::${entry.name}`;
          if (seenAptDate.has(aptDateKey)) continue;
          seenAptDate.add(aptDateKey);
        }

        items.push({
          type: 'work',
          sortDate: date,
          data: {
            folderName: entry.name,
            dirHandle: entry,
            workId: workId,
            apt: apt,
            date: date,
            worker: data.worker || '',
            units: data.units,
            totalUnits: data.units.length,
            totalPhotos: data.units.reduce((s, u) => s + (u.beforeCount || 0) + (u.afterCount || 0), 0),
            session: data
          }
        });
      }
    } catch(e) { console.warn('폴더 작업 로드 실패:', e); }
  }

  items.sort((a, b) => (b.sortDate || '').localeCompare(a.sortDate || ''));

  return items;
}

async function renderCustomerList() {
  const body = document.getElementById('customerBody');
  if (!body) return;

  // ★ 현재 기간 계산 (캐시 키 결정용)
  let currentDays = null;
  if (_customerUseDefault) {
    currentDays = 3;  // 기본은 3일
  } else if (_customerDateFrom) {
    const from = new Date(_customerDateFrom);
    const now = new Date();
    currentDays = Math.ceil((now - from) / (1000 * 60 * 60 * 24));
  } else {
    currentDays = 999;  // 전체
  }

  // ★ 캐시에서 즉시 표시 (있으면)
  let items = null;
  if (typeof getRecordsFromCache === 'function') {
    items = getRecordsFromCache(currentDays);
  }

  // 캐시 없으면 로딩 표시 후 직접 로드
  if (!items) {
    if (!body.querySelector('.cust-card') && !body.querySelector('.cust-card-work')) {
      body.innerHTML = `<div style="padding:40px 20px;text-align:center;color:var(--mu);">
        <div style="font-size:24px;margin-bottom:12px;">⏳</div>
        <div>작업 기록 불러오는 중...</div>
      </div>`;
    }
    try {
      items = await loadCombinedRecords();
    } catch(e) {
      body.innerHTML = `<div style="padding:20px;text-align:center;color:var(--mu);">목록 로드 실패: ${e.message}</div>`;
      return;
    }
  }

  // 캐시는 변경 발생 전까지 무한 유효 (시간 기반 자동 갱신 제거)
  // 변경 발생 시 invalidateRecordsCache()가 호출되어 무효화됨

  // 기간 필터
  let dateFrom = _customerDateFrom;
  let dateTo = _customerDateTo;
  if (_customerUseDefault) {
    dateFrom = getDefaultDateFrom();
    dateTo = localDateStr();
  }

  let filtered = items;
  if (dateFrom || dateTo) {
    filtered = items.filter(it => {
      if (!it.sortDate) return false;
      if (dateFrom && it.sortDate < dateFrom) return false;
      if (dateTo && it.sortDate > dateTo) return false;
      return true;
    });
  }

  // 검색 필터
  const q = _customerSearch.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(it => {
      if (it.type === 'customer') {
        const c = it.data;
        if ((c.name || '').toLowerCase().includes(q)) return true;
        if ((c.phone || '').includes(q)) return true;
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
  if (_customerUseDefault) periodLabel = `최근 ${CUSTOMER_DEFAULT_DAYS}일`;
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
      searchEl._timer = setTimeout(renderCustomerList, 200);
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

  body.querySelectorAll('.cust-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.cust-card-del')) return;
      if (e.target.closest('.cust-card-edit')) return;
      if (e.target.closest('.cust-card-work-del')) return;
      // 작업 카드면 폴더로 열기, 고객 카드면 전화번호로 열기
      if (card.classList.contains('cust-card-work')) {
        openWorkByFolder(card.dataset.folder);
      } else {
        const aptFilter = card.dataset.aptFilter || '';
        const workId = card.dataset.workid || '';
        openWorkForCustomer(card.dataset.phone, aptFilter, workId);
      }
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
        if (v.folderName) folderNames.add(v.folderName);
      });

      // 만약 folderName 없는 visits면 폴더 검색
      const needFolderSearch = visitsToDelete.some(v => !v.folderName);

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

        // 모든 visits 삭제 시 → 메타도 삭제
        if (visitCount === totalVisits) {
          try { await customerRemove(phone); } catch(e) {}
        }

        // V2: 캐시 무효화 + xlsx 재생성
        if (typeof invalidateCustomersCache === 'function') {
          invalidateCustomersCache();
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

  // 작업 카드 삭제 (폴더 전체)
  body.querySelectorAll('.cust-card-work-del').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const folder = btn.dataset.folder;
      if (!confirm(`작업 "${folder}"을 삭제할까요?\n폴더의 모든 사진과 데이터가 삭제됩니다.`)) return;

      // 권한 체크
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

      showOverlay('삭제 중...');
      const safetyTimeout = setTimeout(() => {
        hideOverlay();
        showToast('삭제 시간 초과 - 다시 시도해주세요', 'err');
      }, 30000);

      try {
        // 폴더 존재 확인
        let dirHandle;
        try {
          dirHandle = await photoFolderHandle.getDirectoryHandle(folder);
        } catch(err) {
          clearTimeout(safetyTimeout);
          hideOverlay();
          // 이미 없으면 목록 갱신만
          await renderCustomerList();
          showToast('이미 삭제된 폴더입니다', 'ok');
          return;
        }

        let deleted = false;

        // 1차: recursive (데스크톱)
        try {
          await photoFolderHandle.removeEntry(folder, { recursive: true });
          deleted = true;
        } catch(e1) {
          console.warn('recursive 삭제 실패:', e1.message);
        }

        // 2차: 수동 재귀 삭제 (안드로이드)
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

        clearTimeout(safetyTimeout);
        hideOverlay();

        if (deleted) {
          // V2: 캐시 무효화 + xlsx 재생성
          if (typeof invalidateCustomersCache === 'function') {
            invalidateCustomersCache();
          }
          if (typeof flushCustomersXlsx === 'function') {
            await flushCustomersXlsx();
          }
          await renderCustomerList();
          showToast('✓ 작업 삭제됨', 'ok');
        } else {
          showToast('삭제 실패: 다시 시도해주세요', 'err');
        }
      } catch(err) {
        clearTimeout(safetyTimeout);
        hideOverlay();
        showToast('삭제 실패: ' + err.message, 'err');
      }
    });
  });
}

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

  // ★ 변경 없으면 그냥 진행 (dirty 플래그 + 스냅샷 비교)
  const isDirty = (typeof _dataDirty !== 'undefined' && _dataDirty);
  let snapsEqual = true;
  if (typeof quickSnapshot === 'function' && typeof _lastSaveSnapshot !== 'undefined') {
    snapsEqual = (quickSnapshot() === _lastSaveSnapshot);
  }
  if (!isDirty && snapsEqual) {
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


// 폴더명으로 작업 직접 열기
async function openWorkByFolder(folderName) {
  if (!photoFolderHandle) {
    showToast('저장 폴더가 설정되지 않았습니다', 'err');
    return;
  }

  // ★ 모달 즉시 닫기 + 오버레이 즉시 표시 (5초 지연 체감 제거)
  closeCustomerModal();
  showOverlay('불러오는 중...');

  // 브라우저가 화면 그릴 시간 확보
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  let dirHandle, data;
  try {
    // ★ 타임아웃 적용 (무한 대기 방지 - 10초)
    const readPromise = (async () => {
      const dh = await photoFolderHandle.getDirectoryHandle(folderName);
      const sf = await dh.getFileHandle('_session.json');
      const f = await sf.getFile();
      const d = JSON.parse(await f.text());
      return { dh, d };
    })();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('읽기 시간 초과')), 10000));
    const result = await Promise.race([readPromise, timeoutPromise]);
    dirHandle = result.dh;
    data = result.d;
  } catch(e) {
    hideOverlay();
    showToast('작업 정보를 읽을 수 없습니다: ' + e.message, 'err');
    return;
  }

  // 현재 작업과 같은 작업이면 닫기 (folderName 정확 비교)
  if (isSameAsCurrent(data.apt, data.date, folderName)) {
    hideOverlay();
    showToast('이미 현재 작업입니다', 'ok');
    return;
  }

  hideOverlay();

  // 변경사항 확인 (저장 필요하면 저장)
  const proceed = await confirmBeforeLoad();
  if (!proceed) return;

  showOverlay('불러오는 중...');
  try {
    if (typeof loadFromDateFolder === 'function') {
      // ★ 타임아웃 적용 (60초)
      await Promise.race([
        loadFromDateFolder(dirHandle, data),
        new Promise((_, reject) => setTimeout(() => reject(new Error('불러오기 시간 초과')), 60000))
      ]);
    } else {
      hideOverlay();
      showToast('불러오기 함수를 찾을 수 없습니다', 'err');
    }
  } catch(e) {
    hideOverlay();
    showToast('작업 불러오기 실패: ' + e.message, 'err');
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

  // 모든 visits의 사진 수 합계 - V2는 v.photos 직접 사용
  let totalPhotos = 0;
  (c.visits || []).forEach(v => {
    if (typeof v.photos === 'number') totalPhotos += v.photos;
    else {
      const m = (v.work || '').match(/Photos:\s*(\d+)/);
      if (m) totalPhotos += parseInt(m[1]) || 0;
    }
  });

  // 제목 - 시설 vs 가정 구분
  let titleLine = '';
  if (isFacility) {
    // 🏢 시설명 · 영역 N개
    const zones = lastWork?.unitNames?.length || 0;
    titleLine = `🏢 ${escHtmlSafe(apt)}${zones ? ` · ${zones}개 영역` : ''}`;
  } else {
    // 가정용 - 작업명 · 호수
    const unit = lastWork?.unit || c.name || c.phone;
    if (apt && unit) titleLine = `${escHtmlSafe(apt)} · ${escHtmlSafe(unit)}`;
    else if (apt) titleLine = escHtmlSafe(apt);
    else titleLine = escHtmlSafe(unit);
  }

  // 연락처 표시 - 시설은 담당자 이름도
  const phoneDisplay = isFacility && contactName
    ? `📞 ${escHtmlSafe(c.phone)} · ${escHtmlSafe(contactName)}`
    : `📞 ${escHtmlSafe(c.phone)}${c.address ? ` · 🏠 ${escHtmlSafe(c.address)}` : ''}`;

  return `
    <div class="cust-card${isFacility ? ' cust-card-facility' : ''}" data-phone="${escHtmlSafe(c.phone)}" data-apt-filter="${escHtmlSafe(c._aptFilter || '')}" data-workid="${escHtmlSafe(c._workIdFilter || '')}" title="클릭하여 작업 열기">
      <div class="cust-card-head">
        <div class="cust-card-name">${titleLine}</div>
        <div class="cust-card-actions">
          <button class="cust-card-btn cust-card-edit" data-phone="${escHtmlSafe(c.phone)}" title="정보 수정"><span class="btn-ic">✏️</span><span class="btn-tx">수정</span></button>
          <button class="cust-card-btn cust-card-del" data-phone="${escHtmlSafe(c.phone)}" data-apt-filter="${escHtmlSafe(c._aptFilter || '')}" data-workid="${escHtmlSafe(c._workIdFilter || '')}" title="삭제"><span class="btn-ic">🗑️</span><span class="btn-tx">삭제</span></button>
        </div>
      </div>
      <div class="cust-card-line">${phoneDisplay}</div>
      <div class="cust-card-line cust-card-meta">
        <span>${visitText} 작업</span>
        <span>· ${lastVisit}</span>
        ${totalPhotos > 0 ? `<span>· 사진 ${totalPhotos}장</span>` : ''}
        ${c.memo ? `<span class="cust-card-memo">· 💬 ${escHtmlSafe(c.memo)}</span>` : ''}
      </div>
    </div>
  `;
}

// 작업 카드 (전화번호 없는 작업) - 고객 카드와 동일한 형식
function renderWorkCard(w) {
  const unitNames = w.units.map(u => u.name).filter(n => n);
  let unitText = '';
  if (unitNames.length > 0) {
    const shown = unitNames.slice(0, 3);
    const remain = unitNames.length - shown.length;
    unitText = shown.join(', ') + (remain > 0 ? ` +${remain}` : '');
  }

  // 고객 카드와 동일: "작업명 · 호수" 형식
  const titleLine = `${escHtmlSafe(w.apt || '작업')} · ${unitText ? escHtmlSafe(unitText) : `${w.units.length}호수`}`;

  return `
    <div class="cust-card cust-card-work" data-folder="${escHtmlSafe(w.folderName)}" title="클릭하여 작업 열기">
      <div class="cust-card-head">
        <div class="cust-card-name">${titleLine}</div>
        <div class="cust-card-actions">
          <button class="cust-card-btn cust-card-work-del" data-folder="${escHtmlSafe(w.folderName)}" title="삭제"><span class="btn-ic">🗑️</span><span class="btn-tx">삭제</span></button>
        </div>
      </div>
      <div class="cust-card-line"><span style="color:var(--mu);font-style:italic;">📞 미입력</span></div>
      <div class="cust-card-line cust-card-meta">
        <span style="color:var(--mu);">${escHtmlSafe(w.date)}</span>
        <span>· 사진 ${w.totalPhotos}장</span>
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
    <div style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:700;display:flex;align-items:center;justify-content:center;padding:16px;" id="custDateOverlay">
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
    renderCustomerList();
  });

  document.getElementById('custDQuick7').addEventListener('click', () => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    _customerUseDefault = false;
    _customerDateFrom = localDateStr(d);
    _customerDateTo = localDateStr();
    saveCustomerFilter();
    closeOverlay();
    renderCustomerList();
  });

  document.getElementById('custDQuick30').addEventListener('click', () => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    _customerUseDefault = false;
    _customerDateFrom = localDateStr(d);
    _customerDateTo = localDateStr();
    saveCustomerFilter();
    closeOverlay();
    renderCustomerList();
  });

  document.getElementById('custDQuickAll').addEventListener('click', () => {
    _customerUseDefault = false;
    _customerDateFrom = null;
    _customerDateTo = null;
    saveCustomerFilter();
    closeOverlay();
    renderCustomerList();
  });

  document.getElementById('custDApply').addEventListener('click', () => {
    const f = document.getElementById('custDFrom').value;
    const t = document.getElementById('custDTo').value;
    _customerUseDefault = false;
    _customerDateFrom = f || null;
    _customerDateTo = t || null;
    saveCustomerFilter();
    closeOverlay();
    renderCustomerList();
  });

  document.getElementById('custDCancel').addEventListener('click', closeOverlay);
}

// 작업 열기
async function openWorkForCustomer(phone, aptFilter, workIdFilter) {
  const c = await customerLookup(phone);
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
    <div style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:700;display:flex;align-items:center;justify-content:center;padding:16px;" id="visitSelOverlay">
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
  if (!photoFolderHandle) {
    showToast('저장 폴더가 설정되어 있어야 작업을 열 수 있습니다', 'err');
    return;
  }
  if (!visit.date && !visit.workId) {
    showToast('작업 정보가 부족합니다', 'err');
    return;
  }

  // 현재 작업과 같으면 그냥 닫기 (workId 우선 비교)
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

  // 저장 확인
  const proceed = await confirmBeforeLoad();
  if (!proceed) return;

  closeCustomerModal();
  showOverlay('작업 불러오는 중...');

  try {
    let matchedFolder = null;
    let matchedSession = null;

    // ★ 1차: workId로 검색 (가장 정확)
    if (visit.workId) {
      for await (const entry of photoFolderHandle.values()) {
        if (entry.kind !== 'directory') continue;
        if (!/^\d{4}-\d{2}-\d{2}/.test(entry.name)) continue;
        try {
          const sessionFile = await entry.getFileHandle('_session.json');
          const file = await sessionFile.getFile();
          const data = JSON.parse(await file.text());
          if (data.workId && data.workId === visit.workId) {
            matchedFolder = entry;
            matchedSession = data;
            break;
          }
        } catch(e) {}
      }
    }

    // 2차: apt + date로 검색 (legacy)
    if (!matchedFolder && visit.apt && visit.date) {
      const targetDate = visit.date;
      const targetApt = visit.apt;

      for await (const entry of photoFolderHandle.values()) {
        if (entry.kind !== 'directory') continue;
        if (!entry.name.startsWith(targetDate)) continue;

        try {
          const sessionFile = await entry.getFileHandle('_session.json');
          const file = await sessionFile.getFile();
          const data = JSON.parse(await file.text());

          if (data.apt === targetApt) {
            matchedFolder = entry;
            matchedSession = data;
            break;
          }
        } catch(e) {}
      }
    }

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
    showToast('작업 불러오기 실패: ' + e.message, 'err');
  }
}

// 고객 정보 수정 다이얼로그
async function openCustomerEdit(phone) {
  const c = await customerLookup(phone);
  if (!c) return;

  const html = `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:700;display:flex;align-items:center;justify-content:center;padding:16px;" id="custEditOverlay">
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

// 엑셀 파일 열기 - 파일 자체를 OS의 엑셀 앱으로 직접 실행
async function openCustomersXlsxFile() {
  if (!photoFolderHandle) {
    showToast('저장 폴더가 설정되지 않았습니다', 'err');
    return;
  }

  // customers.xlsx 존재 여부 확인
  let fileSize = '';
  try {
    const fh = await photoFolderHandle.getFileHandle('customers.xlsx');
    const f = await fh.getFile();
    const kb = (f.size / 1024).toFixed(1);
    fileSize = `${kb} KB`;
  } catch(e) {
    // 파일 없음 - 안내만
  }

  // ★ 위치/파일명 안내 모달
  const existing = document.getElementById('xlsxInfoModal');
  if (existing) existing.remove();

  const wrap = document.createElement('div');
  wrap.id = 'xlsxInfoModal';
  wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:700;display:flex;align-items:center;justify-content:center;padding:16px;';
  wrap.innerHTML = `
    <div style="background:var(--sf);border-radius:14px;padding:22px;max-width:380px;width:100%;">
      <div style="font-size:15px;font-weight:800;margin-bottom:16px;">📊 엑셀 파일 위치</div>
      <div style="background:var(--sf2);border-radius:8px;padding:14px;margin-bottom:14px;">
        <div style="font-size:11px;color:var(--mu);margin-bottom:4px;">📁 폴더</div>
        <div style="font-size:14px;font-weight:700;word-break:break-all;">${photoFolderHandle.name}/</div>
        <div style="margin-top:10px;font-size:11px;color:var(--mu);margin-bottom:4px;">📄 파일명</div>
        <div style="font-size:14px;font-weight:700;">customers.xlsx</div>
        ${fileSize ? `<div style="margin-top:6px;font-size:11px;color:var(--mu);">크기: ${fileSize}</div>` : `<div style="margin-top:6px;font-size:11px;color:#e55;">⚠️ 아직 파일이 없습니다 (작업 저장 후 자동 생성됨)</div>`}
      </div>
      <div style="font-size:12px;color:var(--mu);line-height:1.6;margin-bottom:16px;">
        내 파일 앱에서 위 폴더를 열어<br>
        <b>customers.xlsx</b> 파일을 실행하세요.
      </div>
      <button class="btn b-blue" id="xlsxInfoClose" style="width:100%;justify-content:center;">확인</button>
    </div>`;
  document.body.appendChild(wrap);

  wrap.querySelector('#xlsxInfoClose').addEventListener('click', () => wrap.remove());
  wrap.addEventListener('click', e => { if (e.target === wrap) wrap.remove(); });
}

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
  const xlsxBtn = document.getElementById('customerOpenXlsx');
  const allBtn = document.getElementById('customerOpenAll');

  if (hdrBtn) hdrBtn.addEventListener('click', openCustomerModal);

  if (setBtn) setBtn.addEventListener('click', () => {
    document.getElementById('settingsModal')?.classList.remove('open');
    openCustomerModal();
  });

  if (closeBtn) closeBtn.addEventListener('click', closeCustomerModal);
  if (closeFoot) closeFoot.addEventListener('click', closeCustomerModal);
  if (xlsxBtn) xlsxBtn.addEventListener('click', openCustomersXlsxFile);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindCustomerEvents);
} else {
  bindCustomerEvents();
}
