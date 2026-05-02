/* ═══════════════════════════════════════════════
   고객 관리 (Customers)
═══════════════════════════════════════════════ */

let _customerSearch = '';

async function openCustomerModal() {
  document.getElementById('customerModal').classList.add('open');
  await renderCustomerList();
}

function closeCustomerModal() {
  document.getElementById('customerModal').classList.remove('open');
}

async function renderCustomerList() {
  const body = document.getElementById('customerBody');
  if (!body) return;

  let customers = [];
  try {
    customers = await customerListAll();
  } catch(e) {
    body.innerHTML = `<div style="padding:20px;text-align:center;color:var(--mu);">고객 목록 로드 실패: ${e.message}</div>`;
    return;
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

  // 통계
  const total = customers.length;
  const repeat = customers.filter(c => (c.visitCount || 0) >= 2).length;
  const recent = customers.filter(c => {
    if (!c.lastVisit) return false;
    const days = (Date.now() - new Date(c.lastVisit).getTime()) / (1000 * 60 * 60 * 24);
    return days <= 30;
  }).length;

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
          ⚠️ 저장 폴더가 설정되지 않았습니다 (브라우저 내부에만 저장됨)
        </div>
      `}
    </div>

    <input class="cust-inp" id="customerSearchInp" type="text" placeholder="🔍 이름/전화번호/주소 검색" value="${escHtmlSafe(_customerSearch)}" style="width:100%;margin-bottom:12px;">

    <div style="display:flex;flex-direction:column;gap:8px;">
      ${customers.length === 0
        ? '<div style="padding:30px 14px;text-align:center;color:var(--mu);">' +
          (q ? '검색 결과가 없습니다' : '아직 등록된 고객이 없습니다.<br>호수 카드에 전화번호를 입력하면 자동 저장됩니다.') +
          '</div>'
        : customers.map(c => renderCustomerCard(c)).join('')
      }
    </div>
  `;

  // 검색 이벤트
  const searchEl = document.getElementById('customerSearchInp');
  if (searchEl) {
    searchEl.addEventListener('input', e => {
      _customerSearch = e.target.value;
      clearTimeout(searchEl._timer);
      searchEl._timer = setTimeout(renderCustomerList, 200);
    });
  }

  // 카드 클릭 - 상세 보기
  body.querySelectorAll('.cust-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.cust-card-del')) return;  // 삭제 버튼은 별도
      showCustomerDetail(card.dataset.phone);
    });
  });

  // 삭제 버튼
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
    ? `<span style="color:var(--ac2);font-weight:700;">${c.visitCount}회 방문</span>`
    : `<span style="color:var(--mu);">1회 방문</span>`;

  const lastWork = (c.visits && c.visits.length > 0)
    ? c.visits[c.visits.length - 1]
    : null;
  const workInfo = lastWork
    ? `${escHtmlSafe(lastWork.apt || '')} ${escHtmlSafe(lastWork.unit || '')}`.trim()
    : '';

  return `
    <div class="cust-card" data-phone="${escHtmlSafe(c.phone)}">
      <div class="cust-card-head">
        <div class="cust-card-name">${escHtmlSafe(c.name || c.phone)}</div>
        <button class="cust-card-del" data-phone="${escHtmlSafe(c.phone)}" title="삭제">🗑️</button>
      </div>
      <div class="cust-card-body">
        <div>📞 ${escHtmlSafe(c.phone)}</div>
        ${c.address ? `<div>🏠 ${escHtmlSafe(c.address)}</div>` : ''}
        <div style="display:flex;gap:10px;font-size:11px;color:var(--mu);margin-top:4px;">
          <span>${visitText}</span>
          <span>최근: ${lastVisit}</span>
          ${workInfo ? `<span>· ${workInfo}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

async function showCustomerDetail(phone) {
  const c = await customerLookup(phone);
  if (!c) return;

  const visitsHtml = (c.visits || []).slice().reverse().map(v => `
    <div style="background:var(--sf2);border-radius:8px;padding:10px;margin-bottom:6px;font-size:12px;">
      <div style="font-weight:700;">${escHtmlSafe(v.date || '')}</div>
      <div style="color:var(--mu);margin-top:2px;">${escHtmlSafe(v.apt || '')} ${escHtmlSafe(v.unit || '')}</div>
      ${v.work ? `<div style="color:var(--mu);font-size:11px;">${escHtmlSafe(v.work)}</div>` : ''}
    </div>
  `).join('');

  alert(`📋 ${c.name || c.phone} 고객 상세\n\n` +
    `📞 ${c.phone}\n` +
    (c.address ? `🏠 ${c.address}\n` : '') +
    (c.email ? `✉️ ${c.email}\n` : '') +
    (c.memo ? `💬 ${c.memo}\n` : '') +
    `\n첫 방문: ${c.firstVisit}\n` +
    `최근 방문: ${c.lastVisit}\n` +
    `총 방문: ${c.visitCount}회\n\n` +
    `방문 내역:\n` +
    (c.visits || []).map(v => `· ${v.date} - ${v.apt} ${v.unit} (${v.work || ''})`).join('\n')
  );
}

// 엑셀 내보내기
async function exportCustomersXlsx() {
  if (typeof XLSX === 'undefined') {
    showToast('엑셀 라이브러리 로드 실패. 새로고침 후 다시 시도해주세요', 'err');
    return;
  }

  try {
    const customers = await customerListAll();
    if (customers.length === 0) {
      showToast('내보낼 고객이 없습니다', 'err');
      return;
    }

    // 메인 시트 - 고객 목록
    const mainData = customers.map(c => ({
      '이름': c.name || '',
      '전화번호': c.phone || '',
      '주소': c.address || '',
      '이메일': c.email || '',
      '메모': c.memo || '',
      '첫 방문': c.firstVisit || '',
      '최근 방문': c.lastVisit || '',
      '방문 횟수': c.visitCount || 0,
      '최근 작업장': (c.visits && c.visits.length > 0) ? c.visits[c.visits.length-1].apt : '',
      '최근 호수': (c.visits && c.visits.length > 0) ? c.visits[c.visits.length-1].unit : '',
      '재방문 여부': (c.visitCount || 0) >= 2 ? 'O' : 'X',
      '등록일': c.createdAt ? c.createdAt.slice(0, 10) : ''
    }));

    // 방문 내역 시트 (모든 방문 평탄화)
    const visitsData = [];
    customers.forEach(c => {
      (c.visits || []).forEach(v => {
        visitsData.push({
          '이름': c.name || '',
          '전화번호': c.phone || '',
          '방문일': v.date || '',
          '작업장': v.apt || '',
          '호수': v.unit || '',
          '작업내용': v.work || ''
        });
      });
    });
    // 방문일 최근순 정렬
    visitsData.sort((a, b) => (b['방문일'] || '').localeCompare(a['방문일'] || ''));

    // 엑셀 만들기
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(mainData);
    const ws2 = XLSX.utils.json_to_sheet(visitsData);

    // 컬럼 너비 자동
    ws1['!cols'] = [
      { wch: 12 }, { wch: 16 }, { wch: 30 }, { wch: 20 }, { wch: 30 },
      { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 20 }, { wch: 14 },
      { wch: 8 }, { wch: 12 }
    ];
    ws2['!cols'] = [
      { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 20 }, { wch: 14 }, { wch: 30 }
    ];

    XLSX.utils.book_append_sheet(wb, ws1, '고객목록');
    XLSX.utils.book_append_sheet(wb, ws2, '방문내역');

    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `고객목록_${today}.xlsx`);
    showToast(`✓ ${customers.length}명 내보내기 완료`, 'ok');
  } catch(e) {
    showToast('내보내기 실패: ' + e.message, 'err');
    console.error(e);
  }
}

// HTML 이스케이프
function escHtmlSafe(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// 설정 모달의 고객 통계 갱신
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

// 이벤트 바인딩
function bindCustomerEvents() {
  const openBtn = document.getElementById('setOpenCustomers');
  const closeBtn = document.getElementById('customerClose');
  const closeFoot = document.getElementById('customerCloseFoot');
  const exportBtn = document.getElementById('customerExportXlsx');
  const flushBtn = document.getElementById('customerForceFlush');

  if (openBtn) openBtn.addEventListener('click', () => {
    closeSettings && closeSettings();
    document.getElementById('settingsModal')?.classList.remove('open');
    openCustomerModal();
  });
  if (closeBtn) closeBtn.addEventListener('click', closeCustomerModal);
  if (closeFoot) closeFoot.addEventListener('click', closeCustomerModal);
  if (exportBtn) exportBtn.addEventListener('click', exportCustomersXlsx);

  // 수동 저장: 현재 호수의 고객정보를 강제로 customers DB에 저장
  if (flushBtn) flushBtn.addEventListener('click', async () => {
    if (typeof flushAllCustomers !== 'function') {
      showToast('flush 함수 없음', 'err');
      return;
    }
    try {
      const cnt = await flushAllCustomers();
      // xlsx 파일도 즉시 쓰기
      if (typeof flushCustomersXlsx === 'function') {
        await flushCustomersXlsx();
      }
      showToast(`✓ ${cnt}명 저장 완료${photoFolderHandle ? ' (xlsx 포함)' : ''}`, 'ok');
      await renderCustomerList();
    } catch(e) {
      showToast(`저장 실패: ${e.message}`, 'err');
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindCustomerEvents);
} else {
  bindCustomerEvents();
}
