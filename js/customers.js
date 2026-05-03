/* ═══════════════════════════════════════════════
   고객 관리 (Customers)
═══════════════════════════════════════════════ */

let _customerSearch = '';
let _customerDateFrom = null;
let _customerDateTo = null;
let _customerUseDefault = true;

const CUSTOMER_DEFAULT_DAYS = 3;

async function openCustomerModal() {
  document.getElementById('customerModal').classList.add('open');
  _customerSearch = '';
  _customerUseDefault = true;
  _customerDateFrom = null;
  _customerDateTo = null;
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

async function renderCustomerList() {
  const body = document.getElementById('customerBody');
  if (!body) return;

  let allCustomers = [];
  try {
    allCustomers = await customerListAll();
  } catch(e) {
    body.innerHTML = `<div style="padding:20px;text-align:center;color:var(--mu);">고객 목록 로드 실패: ${e.message}</div>`;
    return;
  }

  // 기간 필터
  let dateFrom = _customerDateFrom;
  let dateTo = _customerDateTo;
  if (_customerUseDefault) {
    dateFrom = getDefaultDateFrom();
    dateTo = localDateStr();
  }

  let customers = allCustomers;
  if (dateFrom || dateTo) {
    customers = allCustomers.filter(c => {
      if (!c.lastVisit) return false;
      if (dateFrom && c.lastVisit < dateFrom) return false;
      if (dateTo && c.lastVisit > dateTo) return false;
      return true;
    });
  }

  // 검색 필터
  const q = _customerSearch.trim().toLowerCase();
  if (q) {
    customers = customers.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.phone || '').includes(q) ||
      (c.address || '').toLowerCase().includes(q)
    );
  }

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
          <div style="font-size:11px;color:var(--mu);">재방문</div>
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
      <span style="font-size:11px;color:var(--mu);">(${customers.length}명)</span>
      <button class="btn b-ghost b-xs" id="custDateBtn" style="margin-left:auto;">기간 변경</button>
      ${!_customerUseDefault ? `<button class="btn b-ghost b-xs" id="custDateReset">최근 ${CUSTOMER_DEFAULT_DAYS}일</button>` : ''}
    </div>

    <input class="cust-inp" id="customerSearchInp" type="text" placeholder="🔍 이름/전화번호/주소 검색" value="${escHtmlSafe(_customerSearch)}" style="width:100%;margin-bottom:12px;">

    <div style="display:flex;flex-direction:column;gap:8px;">
      ${customers.length === 0
        ? '<div style="padding:30px 14px;text-align:center;color:var(--mu);">' +
          (q ? '검색 결과가 없습니다' :
            (_customerUseDefault ? `최근 ${CUSTOMER_DEFAULT_DAYS}일 내 방문 고객이 없습니다.<br>"기간 변경"으로 이전 고객도 볼 수 있어요.` : '해당 기간에 고객이 없습니다')
          ) +
          '</div>'
        : customers.map(c => renderCustomerCard(c)).join('')
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
    renderCustomerList();
  });

  body.querySelectorAll('.cust-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.cust-card-del')) return;
      if (e.target.closest('.cust-card-edit')) return;
      openWorkForCustomer(card.dataset.phone);
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
      if (!confirm(`${phone} 고객을 삭제할까요?\n방문 내역도 함께 삭제됩니다.`)) return;
      try {
        await customerRemove(phone);
        await renderCustomerList();
        showToast('✓ 고객 삭제됨', 'ok');
      } catch(e) {
        showToast('삭제 실패: ' + e.message, 'err');
      }
    });
  });
}

function renderCustomerCard(c) {
  const lastVisit = c.lastVisit || '-';
  const visitText = c.visitCount >= 2
    ? `<span style="color:var(--ac2);font-weight:700;">${c.visitCount}회</span>`
    : `<span style="color:var(--mu);">1회</span>`;

  const lastWork = (c.visits && c.visits.length > 0)
    ? c.visits[c.visits.length - 1]
    : null;

  const apt = lastWork?.apt || '';
  const unit = lastWork?.unit || c.name || c.phone;

  // 작업명 + 호수 한 줄
  let titleLine = '';
  if (apt && unit) titleLine = `${escHtmlSafe(apt)} · ${escHtmlSafe(unit)}`;
  else if (apt) titleLine = escHtmlSafe(apt);
  else titleLine = escHtmlSafe(unit);

  return `
    <div class="cust-card" data-phone="${escHtmlSafe(c.phone)}" title="클릭하여 작업 열기">
      <div class="cust-card-head">
        <div class="cust-card-name">${titleLine}</div>
        <div class="cust-card-actions">
          <button class="cust-card-btn cust-card-edit" data-phone="${escHtmlSafe(c.phone)}" title="정보 수정">✏️</button>
          <button class="cust-card-btn cust-card-del" data-phone="${escHtmlSafe(c.phone)}" title="삭제">🗑️</button>
        </div>
      </div>
      <div class="cust-card-line">📞 ${escHtmlSafe(c.phone)}${c.address ? ` · 🏠 ${escHtmlSafe(c.address)}` : ''}</div>
      <div class="cust-card-line cust-card-meta">
        <span>${visitText} 방문</span>
        <span>· ${lastVisit}</span>
        ${c.memo ? `<span class="cust-card-memo">· 💬 ${escHtmlSafe(c.memo)}</span>` : ''}
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
    closeOverlay();
    renderCustomerList();
  });

  document.getElementById('custDQuick7').addEventListener('click', () => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    _customerUseDefault = false;
    _customerDateFrom = localDateStr(d);
    _customerDateTo = localDateStr();
    closeOverlay();
    renderCustomerList();
  });

  document.getElementById('custDQuick30').addEventListener('click', () => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    _customerUseDefault = false;
    _customerDateFrom = localDateStr(d);
    _customerDateTo = localDateStr();
    closeOverlay();
    renderCustomerList();
  });

  document.getElementById('custDQuickAll').addEventListener('click', () => {
    _customerUseDefault = false;
    _customerDateFrom = null;
    _customerDateTo = null;
    closeOverlay();
    renderCustomerList();
  });

  document.getElementById('custDApply').addEventListener('click', () => {
    const f = document.getElementById('custDFrom').value;
    const t = document.getElementById('custDTo').value;
    _customerUseDefault = false;
    _customerDateFrom = f || null;
    _customerDateTo = t || null;
    closeOverlay();
    renderCustomerList();
  });

  document.getElementById('custDCancel').addEventListener('click', closeOverlay);
}

// 작업 열기
async function openWorkForCustomer(phone) {
  const c = await customerLookup(phone);
  if (!c) {
    showToast('고객 정보를 찾을 수 없습니다', 'err');
    return;
  }

  const visits = c.visits || [];
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

  const html = `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:700;display:flex;align-items:center;justify-content:center;padding:16px;" id="visitSelOverlay">
      <div style="background:var(--sf);border-radius:14px;padding:20px;max-width:480px;width:100%;max-height:80vh;display:flex;flex-direction:column;">
        <div style="font-size:16px;font-weight:800;margin-bottom:6px;">${escHtmlSafe(customer.name || customer.phone)}</div>
        <div style="font-size:12px;color:var(--mu);margin-bottom:14px;">${visits.length}개 작업이 있습니다. 선택하세요.</div>
        <div style="overflow-y:auto;display:flex;flex-direction:column;gap:8px;">
          ${sorted.map((v, i) => `
            <button class="btn b-ghost visit-sel-btn" data-visit-idx="${i}" style="width:100%;justify-content:flex-start;text-align:left;padding:12px;">
              <div style="display:flex;flex-direction:column;gap:4px;width:100%;">
                <div style="font-weight:700;color:var(--ac);">📁 ${escHtmlSafe(v.apt || '작업')}</div>
                <div style="font-size:12px;">🏠 ${escHtmlSafe(v.unit || '')} <span style="color:var(--mu);">· ${escHtmlSafe(v.date || '')}</span></div>
                ${v.work ? `<div style="font-size:11px;color:var(--mu);">${escHtmlSafe(v.work)}</div>` : ''}
              </div>
            </button>
          `).join('')}
        </div>
        <button class="btn b-ghost" id="visitSelCancel" style="margin-top:14px;">취소</button>
      </div>
    </div>
  `;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap.firstElementChild);

  const closeSel = () => document.getElementById('visitSelOverlay')?.remove();

  document.querySelectorAll('.visit-sel-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.visitIdx);
      const visit = sorted[idx];
      closeSel();
      await loadWorkByVisit(visit);
    });
  });

  document.getElementById('visitSelCancel').addEventListener('click', closeSel);
}

// visit으로 실제 작업 불러오기
async function loadWorkByVisit(visit) {
  if (!photoFolderHandle) {
    showToast('저장 폴더가 설정되어 있어야 작업을 열 수 있습니다', 'err');
    return;
  }
  if (!visit.date || !visit.apt) {
    showToast('작업 정보가 부족합니다', 'err');
    return;
  }

  closeCustomerModal();
  showOverlay('작업 불러오는 중...');

  try {
    const targetDate = visit.date;
    const targetApt = visit.apt;
    let matchedFolder = null;
    let matchedSession = null;

    for await (const entry of photoFolderHandle.values()) {
      if (entry.kind !== 'directory') continue;
      if (!entry.name.startsWith(targetDate)) continue;

      try {
        const sessionFile = await entry.getFileHandle('_session.json');
        const file = await sessionFile.getFile();
        const text = await file.text();
        const data = JSON.parse(text);

        if (data.apt === targetApt) {
          matchedFolder = entry;
          matchedSession = data;
          break;
        }
      } catch(e) {}
    }

    if (!matchedFolder || !matchedSession) {
      hideOverlay();
      showToast(`작업을 찾을 수 없습니다: ${targetApt} (${targetDate})`, 'err');
      return;
    }

    // loadFromDateFolder 사용 (dialogs.js의 폴더 불러오기 함수)
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
      showToast('✓ 고객 정보 수정됨', 'ok');
    } catch(e) {
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

  try {
    // 최신 데이터로 갱신
    if (typeof flushCustomersXlsx === 'function') {
      await flushCustomersXlsx();
    }

    const fileHandle = await photoFolderHandle.getFileHandle('customers.xlsx');
    const file = await fileHandle.getFile();
    const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);

    // ★ 모바일: Web Share API → "Excel로 열기" 옵션 즉시 표시
    if (isMobile && navigator.canShare) {
      try {
        const shareFile = new File([file], 'customers.xlsx', {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        if (navigator.canShare({ files: [shareFile] })) {
          await navigator.share({
            files: [shareFile],
            title: '고객 목록'
          });
          return;
        }
      } catch(e) {
        if (e.name === 'AbortError') return;
        console.warn('share 실패:', e);
      }
    }

    // ★ 데스크톱: Blob URL을 새 탭으로 → 브라우저가 엑셀 자동 실행
    const blob = new Blob([await file.arrayBuffer()], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);

    // 새 탭에서 열기 (브라우저가 .xlsx를 엑셀로 연결)
    const opened = window.open(url, '_blank');

    if (!opened) {
      // 팝업 차단 시 다운로드 폴백
      const a = document.createElement('a');
      a.href = url;
      a.download = 'customers.xlsx';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => document.body.removeChild(a), 100);
      showToast('📊 다운로드 후 엑셀로 열기', 'ok');
    } else {
      showToast('📊 엑셀에서 여는 중...', 'ok');
    }

    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch(e) {
    if (e.name === 'NotFoundError') {
      showToast('아직 customers.xlsx 파일이 없습니다.', 'err');
    } else {
      showToast('파일 열기 실패: ' + e.message, 'err');
    }
  }
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
      (repeat > 0 ? ` · 재방문 ${repeat}명` : '');
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
