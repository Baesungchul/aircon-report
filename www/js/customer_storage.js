/* ═══════════════════════════════════════════════
   고객 정보 - 폴더 저장 (customers.xlsx)
   ─ IndexedDB는 2차 백업
═══════════════════════════════════════════════ */

const CUSTOMERS_XLSX_FILENAME = 'customers.xlsx';
const CUSTOMERS_SHEET_MAIN = 'Customers';
const CUSTOMERS_SHEET_VISITS = 'Visits';

// 메모리 캐시
let _customersCache = null;        // Map<phone, customer>
let _customersCacheLoaded = false; // 폴더에서 한 번 읽었는지
let _customersWriteTimer = null;   // 디바운스 타이머
let _customersWriting = false;     // 동시 쓰기 방지

// ════════════════════════════════════════
// 캐시 초기화 (폴더에서 읽어서 캐시에 로드)
// ════════════════════════════════════════
async function initCustomersCache() {
  if (_customersCacheLoaded) return;
  _customersCache = new Map();

  if (!photoFolderHandle) {
    console.log('[Customers] 폴더 미설정 - IndexedDB만 사용');
    // IndexedDB에서 로드
    try {
      const list = await customerGetAll();
      list.forEach(c => _customersCache.set(c.phone, c));
      console.log(`[Customers] IndexedDB에서 ${list.length}명 로드`);
    } catch(e) {
      console.warn('[Customers] IndexedDB 로드 실패:', e);
    }
    _customersCacheLoaded = true;
    return;
  }

  try {
    // 폴더에서 customers.xlsx 읽기 시도
    const fileHandle = await photoFolderHandle.getFileHandle(CUSTOMERS_XLSX_FILENAME, { create: false });
    const file = await fileHandle.getFile();
    const buffer = await file.arrayBuffer();

    if (typeof XLSX === 'undefined') {
      console.warn('[Customers] XLSX 라이브러리 없음');
      _customersCacheLoaded = true;
      return;
    }

    const wb = XLSX.read(buffer, { type: 'array' });

    // Customers 시트 읽기
    const ws = wb.Sheets[CUSTOMERS_SHEET_MAIN];
    if (ws) {
      const rows = XLSX.utils.sheet_to_json(ws);
      rows.forEach(r => {
        const rawPhone = (r.phone || '').trim();
        if (!rawPhone) return;
        // ★ 정규화 - 하이픈 형식 통일
        const phone = normalizePhone(rawPhone);
        if (!phone) return;

        // 이미 같은 정규화 phone이 있으면 병합 (xlsx에서 중복 발견 시)
        const existing = _customersCache.get(phone);
        if (existing) {
          // 더 최신 데이터로 병합
          if ((r.updated_at || '') > (existing.updatedAt || '')) {
            existing.name = r.name || existing.name;
            existing.address = r.address || existing.address;
            existing.email = r.email || existing.email;
            existing.memo = r.memo || existing.memo;
            existing.lastVisit = r.last_visit || existing.lastVisit;
            existing.visitCount = parseInt(r.visit_count) || existing.visitCount;
            existing.updatedAt = r.updated_at || existing.updatedAt;
          }
        } else {
          _customersCache.set(phone, {
            phone: phone,
            name: r.name || '',
            address: r.address || '',
            email: r.email || '',
            memo: r.memo || '',
            firstVisit: r.first_visit || '',
            lastVisit: r.last_visit || '',
            visitCount: parseInt(r.visit_count) || 0,
            createdAt: r.created_at || '',
            updatedAt: r.updated_at || '',
            visits: []
          });
        }
      });
    }

    // Visits 시트 읽기 - 각 고객의 visits 배열에 채우기
    const wsV = wb.Sheets[CUSTOMERS_SHEET_VISITS];
    if (wsV) {
      const visits = XLSX.utils.sheet_to_json(wsV);
      visits.forEach(v => {
        const rawPhone = (v.phone || '').trim();
        if (!rawPhone) return;
        const phone = normalizePhone(rawPhone);
        if (!phone) return;
        const c = _customersCache.get(phone);
        if (c) {
          // 같은 날짜+호수+작업장 중복 방지
          const dup = c.visits.find(vv =>
            vv.date === (v.date || '') &&
            vv.unit === (v.unit || '') &&
            vv.apt === (v.work_site || '')
          );
          if (!dup) {
            c.visits.push({
              date: v.date || '',
              apt: v.work_site || '',
              unit: v.unit || '',
              work: v.work_detail || ''
            });
          }
        }
      });
    }

    console.log(`[Customers] xlsx에서 ${_customersCache.size}명 로드`);

    // IndexedDB에도 동기화 (백업)
    for (const c of _customersCache.values()) {
      try { await customerPut(c); } catch(e) {}
    }
  } catch(e) {
    if (e.name === 'NotFoundError' || e.message?.includes('not found')) {
      console.log('[Customers] xlsx 파일 없음 - 새로 생성됨');
      // IndexedDB에 데이터 있으면 그것부터 로드
      try {
        const list = await customerGetAll();
        list.forEach(c => _customersCache.set(c.phone, c));
        if (list.length > 0) {
          console.log(`[Customers] IndexedDB에서 ${list.length}명 마이그레이션`);
          // 파일 쓰기 예약
          scheduleCustomersWrite();
        }
      } catch(e2) {}
    } else {
      console.warn('[Customers] xlsx 읽기 실패:', e);
      // IndexedDB 폴백
      try {
        const list = await customerGetAll();
        list.forEach(c => _customersCache.set(c.phone, c));
      } catch(e2) {}
    }
  }

  _customersCacheLoaded = true;
}

// ════════════════════════════════════════
// 고객 추가/업데이트 (캐시 + 디바운스 후 파일 쓰기)
// ════════════════════════════════════════
async function customerSave(info) {
  // info: { phone, name, address, email, memo, visit, allowEmpty }
  await initCustomersCache();

  const phone = normalizePhone(info.phone);
  if (!phone) throw new Error('Phone required');
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.length < 9) throw new Error('Phone too short');

  const now = kstIsoString();
  const visit = info.visit || null;

  let customer = _customersCache.get(phone);

  if (customer) {
    // 기존 고객 - 모든 필드를 항상 업데이트 (빈 문자열도 반영)
    // info에 명시된 필드는 항상 적용 (undefined만 보존)
    if (info.name !== undefined)    customer.name    = (info.name || '').trim();
    if (info.address !== undefined) customer.address = (info.address || '').trim();
    if (info.email !== undefined)   customer.email   = (info.email || '').trim();
    if (info.memo !== undefined)    customer.memo    = (info.memo || '').trim();

    if (visit) {
      customer.lastVisit = visit.date || now.slice(0, 10);
      customer.visits = (customer.visits || []).filter(v => v && typeof v === 'object');  // ★ null/잘못된 항목 제거

      // 0차 (★ 최우선): workId + unitName 매칭 (불변 식별자)
      let dupIdx = -1;
      if (visit.workId && visit.unitName) {
        dupIdx = customer.visits.findIndex(v =>
          v && v.workId === visit.workId && (v.unitName === visit.unitName || v.unit === visit.unitName)
        );
      }

      // 0-B차: workId + 옛 unitName 매칭 (호수명 수정 직후)
      if (dupIdx < 0 && visit.workId && visit._oldUnitName) {
        dupIdx = customer.visits.findIndex(v =>
          v && v.workId === visit.workId &&
          (v.unitName === visit._oldUnitName || v.unit === visit._oldUnitName)
        );
      }

      // 1차: 정확 매칭 (date + unit + apt)
      if (dupIdx < 0) {
        dupIdx = customer.visits.findIndex(v =>
          v && v.date === visit.date && v.unit === visit.unit && v.apt === visit.apt
        );
      }

      // 1-B차: 옛 unit 이름으로 정확 매칭
      if (dupIdx < 0 && visit._oldUnitName) {
        dupIdx = customer.visits.findIndex(v =>
          v && v.date === visit.date && v.unit === visit._oldUnitName && v.apt === visit.apt
        );
      }

      // 2차: 작업명 수정 대응 - 같은 날짜+호수
      if (dupIdx < 0) {
        dupIdx = customer.visits.findIndex(v =>
          v && v.date === visit.date && v.unit === visit.unit
        );
      }

      // 3차: sourceFolderName 매칭 (예비)
      if (dupIdx < 0 && visit.sourceFolderName) {
        dupIdx = customer.visits.findIndex(v =>
          v && v.sourceFolderName === visit.sourceFolderName && v.unit === visit.unit
        );
      }

      // 저장할 visit 객체 (내부용 _oldUnitName 제외)
      const visitToSave = { ...visit };
      delete visitToSave._oldUnitName;

      if (dupIdx >= 0) {
        // 기존 visit 갱신 (작업명/호수명 변경 등 반영)
        customer.visits[dupIdx] = visitToSave;
      } else {
        customer.visits.push(visitToSave);
      }
      customer.visitCount = customer.visits.length;
    }
    customer.updatedAt = now;

    // ★ 이름이 비었고 visit 있으면 호수명 적용 (단, 사용자가 빈 값으로 명시 갱신한 경우는 호수명 적용)
    if (!customer.name && visit?.unit) {
      customer.name = visit.unit;
    }
  } else {
    // 신규
    customer = {
      phone,
      name: (info.name || '').trim() || (visit?.unit || ''),  // 신규 시 비어있으면 호수명
      address: (info.address || '').trim(),
      email: (info.email || '').trim(),
      memo: (info.memo || '').trim(),
      firstVisit: visit?.date || now.slice(0, 10),
      lastVisit:  visit?.date || now.slice(0, 10),
      visitCount: visit ? 1 : 0,
      visits: visit ? [visit] : [],
      createdAt: now,
      updatedAt: now
    };
  }

  // 캐시 업데이트
  _customersCache.set(phone, customer);

  // IndexedDB에 즉시 저장 (백업)
  try { await customerPut(customer); } catch(e) { console.warn('IndexedDB 저장 실패:', e); }

  // 폴더 파일 쓰기 (디바운스)
  scheduleCustomersWrite();

  return customer;
}

// 고객 가져오기 (캐시 우선)
async function customerLookup(phone) {
  await initCustomersCache();
  const norm = normalizePhone(phone);
  return _customersCache.get(norm) || null;
}

// 모든 고객
async function customerListAll() {
  await initCustomersCache();
  const list = Array.from(_customersCache.values());
  list.sort((a, b) => (b.lastVisit || '').localeCompare(a.lastVisit || ''));
  return list;
}

// 고객 삭제
async function customerRemove(phone) {
  await initCustomersCache();
  const norm = normalizePhone(phone);
  _customersCache.delete(norm);
  try { await customerDelete(norm); } catch(e) {}
  scheduleCustomersWrite();
}

// 고객의 visits 배열을 통째로 교체 (visit 삭제 등에 사용)
async function customerUpdateVisits(phone, newVisits) {
  await initCustomersCache();
  const norm = normalizePhone(phone);
  const customer = _customersCache.get(norm);
  if (!customer) throw new Error('Customer not found');

  customer.visits = newVisits || [];
  customer.visitCount = customer.visits.length;
  if (customer.visits.length > 0) {
    customer.lastVisit = customer.visits.reduce((max, v) =>
      (v.date || '') > (max || '') ? v.date : max, '');
  } else {
    customer.lastVisit = '';
  }
  customer.updatedAt = (typeof kstIsoString === 'function') ? kstIsoString() : new Date().toISOString();

  // DB 업데이트
  try { await customerPut(customer); } catch(e) {}
  scheduleCustomersWrite();
}

// ════════════════════════════════════════
// 폴더에 xlsx 쓰기 (디바운스)
// ════════════════════════════════════════
function scheduleCustomersWrite() {
  clearTimeout(_customersWriteTimer);
  _customersWriteTimer = setTimeout(() => writeCustomersXlsx(), 1000);
}

async function writeCustomersXlsx() {
  if (_customersWriting) {
    // 진행 중이면 다시 예약
    scheduleCustomersWrite();
    return;
  }
  if (!photoFolderHandle) {
    console.log('[Customers] 폴더 미설정 - 파일 쓰기 스킵');
    return;
  }
  if (typeof XLSX === 'undefined') {
    console.warn('[Customers] XLSX 라이브러리 없음');
    return;
  }
  if (!_customersCache || _customersCache.size === 0) return;

  _customersWriting = true;
  try {
    // 권한 체크
    const perm = await photoFolderHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      const req = await photoFolderHandle.requestPermission({ mode: 'readwrite' });
      if (req !== 'granted') {
        console.warn('[Customers] 폴더 권한 없음');
        _customersWriting = false;
        return;
      }
    }

    // 메인 시트 데이터
    const customers = Array.from(_customersCache.values());
    const mainData = customers.map(c => {
      // ★ 주소 미입력 시 마지막 visit의 apt+unit으로 자동 생성
      let address = c.address || '';
      if (!address.trim() && c.visits && c.visits.length > 0) {
        // 가장 최근 visit 사용
        const sortedVisits = [...c.visits].sort((a, b) =>
          (b.date || '').localeCompare(a.date || ''));
        const v = sortedVisits[0];
        const apt = (v.apt || '').trim();
        const unit = (v.unit || v.unitName || '').trim();
        if (apt && unit) address = `${apt} ${unit}`;
        else if (apt) address = apt;
        else if (unit) address = unit;
      }

      return {
        phone: c.phone,
        name: c.name || '',
        address: address,
        email: c.email || '',
        memo: c.memo || '',
        first_visit: c.firstVisit || '',
        last_visit: c.lastVisit || '',
        visit_count: c.visitCount || 0,
        is_repeat: (c.visitCount || 0) >= 2 ? 'Y' : 'N',
        created_at: c.createdAt || '',
        updated_at: c.updatedAt || ''
      };
    });

    // 방문 시트 데이터
    const visitsData = [];
    customers.forEach(c => {
      (c.visits || []).forEach(v => {
        visitsData.push({
          phone: c.phone,
          name: c.name || '',
          date: v.date || '',
          work_site: v.apt || '',
          unit: v.unit || '',
          work_detail: v.work || ''
        });
      });
    });
    // 최근순 정렬
    visitsData.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // xlsx 만들기
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(mainData);
    const ws2 = XLSX.utils.json_to_sheet(visitsData);

    // 컬럼 너비
    ws1['!cols'] = [
      { wch: 16 }, { wch: 14 }, { wch: 30 }, { wch: 24 }, { wch: 30 },
      { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 22 }, { wch: 22 }
    ];
    ws2['!cols'] = [
      { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 22 }, { wch: 14 }, { wch: 30 }
    ];

    XLSX.utils.book_append_sheet(wb, ws1, CUSTOMERS_SHEET_MAIN);
    XLSX.utils.book_append_sheet(wb, ws2, CUSTOMERS_SHEET_VISITS);

    // Blob으로 변환
    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    // 폴더에 쓰기
    const fileHandle = await photoFolderHandle.getFileHandle(CUSTOMERS_XLSX_FILENAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();

    console.log(`[Customers] ✓ xlsx 저장: ${customers.length}명, ${visitsData.length} 방문`);
  } catch(e) {
    console.error('[Customers] xlsx 쓰기 실패:', e);
    // 파일이 열려있어서 잠긴 경우 등 - 다시 시도 예약
    if (e.name === 'NoModificationAllowedError' || e.message?.includes('lock')) {
      console.warn('[Customers] 파일 잠김 - 5초 후 재시도');
      setTimeout(() => scheduleCustomersWrite(), 5000);
    }
  } finally {
    _customersWriting = false;
  }
}

// 강제 즉시 저장
async function flushCustomersXlsx() {
  clearTimeout(_customersWriteTimer);
  await writeCustomersXlsx();
}

// 폴더 변경 시 캐시 무효화 (다시 읽도록)
function invalidateCustomersCache() {
  _customersCache = null;
  _customersCacheLoaded = false;
}
