/* ═══════════════════════════════════════════════
   CUSTOMER STORAGE V2 (1.002+)
   - 진실 공급원: 폴더의 _session.json들
   - 메타 (이름/주소/메모): customers_meta.json
   - 캐시: customers.xlsx (자동 재생성)
═══════════════════════════════════════════════ */

const META_FILE_NAME = 'customers_meta.json';
const XLSX_FILE_NAME = 'customers.xlsx';

// 메타 캐시 (메모리)
let _metaCache = null;
let _metaCacheLoaded = false;

// 통합 customers 캐시 (재생성용)
let _customersV2Cache = null;
let _customersV2CacheTime = 0;
const CACHE_TTL = 60000;  // 60초 (빈번한 모달 열기 시 재스캔 방지)

// ════════════════════════════════════════
// 메타 로드/저장
// ════════════════════════════════════════
async function loadCustomerMeta() {
  if (_metaCacheLoaded) return _metaCache;

  if (!photoFolderHandle) {
    _metaCache = {};
    _metaCacheLoaded = true;
    return _metaCache;
  }

  try {
    const fh = await photoFolderHandle.getFileHandle(META_FILE_NAME);
    const file = await fh.getFile();
    const text = await file.text();
    _metaCache = JSON.parse(text || '{}');
    // ★ null 또는 비객체 방어
    if (!_metaCache || typeof _metaCache !== 'object' || Array.isArray(_metaCache)) {
      _metaCache = {};
    }
  } catch(e) {
    // 파일 없으면 빈 객체
    _metaCache = {};
  }
  _metaCacheLoaded = true;
  return _metaCache;
}

async function saveCustomerMeta() {
  if (!photoFolderHandle || !_metaCache) return;

  try {
    // 권한 확인
    const perm = await photoFolderHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      const newPerm = await photoFolderHandle.requestPermission({ mode: 'readwrite' });
      if (newPerm !== 'granted') return;
    }

    const fh = await photoFolderHandle.getFileHandle(META_FILE_NAME, { create: true });
    const writable = await fh.createWritable();
    await writable.write(JSON.stringify(_metaCache, null, 2));
    await writable.close();
  } catch(e) {
    console.warn('customers_meta.json 저장 실패:', e);
  }
}

// 메타 업데이트 (이름/주소/메모)
async function updateCustomerMeta(phone, info) {
  await loadCustomerMeta();
  if (!_metaCache || typeof _metaCache !== 'object') _metaCache = {};

  const norm = normalizePhone(phone);
  if (!_metaCache[norm]) _metaCache[norm] = {};

  if (info.name !== undefined) _metaCache[norm].name = info.name;
  if (info.address !== undefined) _metaCache[norm].address = info.address;
  if (info.memo !== undefined) _metaCache[norm].memo = info.memo;
  if (info.email !== undefined) _metaCache[norm].email = info.email;

  _metaCache[norm].updatedAt = (typeof kstIsoString === 'function') ? kstIsoString() : new Date().toISOString();
  if (!_metaCache[norm].createdAt) _metaCache[norm].createdAt = _metaCache[norm].updatedAt;

  // 캐시 무효화
  invalidateCustomersV2();
  await saveCustomerMeta();
}

// 메타 삭제
async function deleteCustomerMeta(phone) {
  await loadCustomerMeta();
  const norm = normalizePhone(phone);
  delete _metaCache[norm];
  invalidateCustomersV2();
  await saveCustomerMeta();
}

function invalidateCustomersV2() {
  _customersV2Cache = null;
  _customersV2CacheTime = 0;
}

function invalidateCustomerMetaCache() {
  _metaCache = null;
  _metaCacheLoaded = false;
}

// ════════════════════════════════════════
// 단일 진실 공급원: _session.json들에서 customers 재구성
// ════════════════════════════════════════
async function rebuildCustomersFromSessions(opts = {}) {
  // 캐시 활용 (5초 내 재호출 시)
  if (!opts.force && _customersV2Cache && (Date.now() - _customersV2CacheTime) < CACHE_TTL) {
    return _customersV2Cache;
  }

  if (!photoFolderHandle) {
    _customersV2Cache = [];
    return [];
  }

  // ★ 권한 체크
  try {
    const perm = await photoFolderHandle.queryPermission({ mode: 'read' });
    if (perm !== 'granted') {
      console.warn('[v2] 폴더 읽기 권한 없음 - 스캔 스킵');
      return [];
    }
  } catch(e) {
    console.warn('[v2] 권한 확인 실패:', e);
    return [];
  }

  await loadCustomerMeta();

  // ★★ NEW: 작업 인덱스 우선 사용 (폴더 스캔 0회!)
  let useIndex = false;
  let indexData = null;
  if (!opts.force && typeof loadWorkIndex === 'function') {
    try {
      indexData = await loadWorkIndex();
      if (indexData && Array.isArray(indexData.works) && indexData.works.length > 0) {
        useIndex = true;
      }
    } catch(e) {}
  }

  const customersByPhone = new Map();

  if (useIndex) {
    // 인덱스에서 visits 추출 (폴더 스캔 0회!)
    console.log(`[v2] 인덱스 사용: ${indexData.works.length}건 (폴더 스캔 0회)`);
    for (const w of indexData.works) {
      processWorkForCustomers(w, customersByPhone);
    }
  } else {
    // 폴더 스캔 폴백
    console.log('[v2] 인덱스 없음 - 폴더 스캔 폴백');
    try {
      const dirs = [];
      for await (const entry of photoFolderHandle.values()) {
        if (entry.kind !== 'directory') continue;
        if (!/^\d{4}-\d{2}-\d{2}/.test(entry.name)) continue;
        dirs.push(entry);
      }

      const results = await Promise.all(dirs.map(async (entry) => {
        try {
          const sessionFile = await entry.getFileHandle('_session.json');
          const file = await sessionFile.getFile();
          const data = JSON.parse(await file.text());
          return { entry, data };
        } catch(e) { return null; }
      }));

      for (const result of results) {
        if (!result) continue;
        const { entry, data } = result;
        const workInfo = {
          folderName: entry.name,
          workId: data.workId || '',
          apt: data.apt || '',
          date: data.date || entry.name.slice(0, 10),
          savedAt: data.savedAt || '',
          workType: data.workType || 'household',
          // ★ 공용시설 facilityCustomer 포함
          facilityCustomer: data.facilityCustomer || null,
          units: (data.units || []).map(u => ({
            name: u.name,
            customer: u.customer
          }))
        };
        processWorkForCustomers(workInfo, customersByPhone);
      }
    } catch(e) {
      console.warn('[v2] 폴더 스캔 실패:', e);
    }
  }

  // 메타 정보 합치기
  const customers = [];
  for (const [phone, info] of customersByPhone) {
    const meta = _metaCache?.[phone] || {};
    customers.push({
      phone,
      name: meta.name || '',
      address: meta.address || '',
      memo: meta.memo || '',
      email: meta.email || '',
      visits: info.visits,
      visitCount: info.visits.length,
      lastVisit: info.lastVisit
    });
  }
  customers.sort((a, b) => (b.lastVisit || '').localeCompare(a.lastVisit || ''));

  _customersV2Cache = customers;
  _customersV2CacheTime = Date.now();
  console.log(`[v2] 처리 완료: ${customers.length}명`);
  return customers;
}

// 작업 1건에서 고객 visits 추출 (헬퍼)
function processWorkForCustomers(work, customersByPhone) {
  if (!work || !work.units) return;

  // ★ 공용시설 모드 - facilityCustomer에서 전화번호 추출
  if (work.workType === 'facility') {
    const fc = work.facilityCustomer;
    if (!fc) return;
    const phone = normalizePhone(fc.phone || '');
    if (!phone) return;

    if (!customersByPhone.has(phone)) {
      customersByPhone.set(phone, { visits: [], lastVisit: '' });
    }
    const c = customersByPhone.get(phone);

    // 공용시설은 작업 하나당 visit 하나 (호수 단위 X)
    const visit = {
      workId: work.workId,
      apt: work.apt,
      unit: work.apt,           // unit = apt (공용시설은 전체가 한 단위)
      unitName: work.apt,
      date: work.date,
      savedAt: work.savedAt,
      sourceFolderName: work.folderName,
      workType: 'facility',
      isFacility: true,         // ★ 카드 렌더용 플래그
      unitNames: (work.units || []).map(u => u.name).filter(Boolean),  // ★ 영역 이름들
      contactName: fc.contact || '',
      memo: fc.memo || '',
      address: fc.address || '',
      contact: fc.contact || ''
    };
    c.visits.push(visit);

    if (!c.lastVisit || (work.date || '') > c.lastVisit) {
      c.lastVisit = work.date || '';
    }
    return;
  }

  // 가정용 모드 - 호수별 customer
  work.units.forEach(u => {
    const phone = normalizePhone(u.customer?.phone || '');
    if (!phone) return;

    if (!customersByPhone.has(phone)) {
      customersByPhone.set(phone, { visits: [], lastVisit: '' });
    }
    const c = customersByPhone.get(phone);

    const visit = {
      workId: work.workId,
      apt: work.apt,
      unit: u.name,
      unitName: u.name,
      date: work.date,
      savedAt: work.savedAt,
      sourceFolderName: work.folderName,
      memo: u.customer?.memo || '',
      address: u.customer?.address || ''
    };
    c.visits.push(visit);

    if (!c.lastVisit || (work.date || '') > c.lastVisit) {
      c.lastVisit = work.date || '';
    }
  });
}


// ════════════════════════════════════════
// V1 호환 API (기존 코드와 호환)
// ════════════════════════════════════════

// customerListAll → V2 사용
async function customerListAllV2() {
  return await rebuildCustomersFromSessions();
}

// customerLookup → V2 사용
async function customerLookupV2(phone) {
  const customers = await rebuildCustomersFromSessions();
  const norm = normalizePhone(phone);
  return customers.find(c => c.phone === norm) || null;
}

// customerSave → V2: 메타만 저장 (visits는 _session.json이 진실)
async function customerSaveV2(info) {
  const norm = normalizePhone(info.phone || '');
  if (!norm) throw new Error('전화번호가 필요합니다');

  // 메타 업데이트 (이름/주소/메모만)
  const metaInfo = {};
  if (info.name !== undefined) metaInfo.name = info.name;
  if (info.address !== undefined) metaInfo.address = info.address;
  if (info.memo !== undefined) metaInfo.memo = info.memo;
  if (info.email !== undefined) metaInfo.email = info.email;

  await updateCustomerMeta(norm, metaInfo);

  // visit은 _session.json에 저장되므로 여기서는 무시
  // (단, 호환성을 위해 결과 반환)
  return await customerLookupV2(norm) || { phone: norm };
}

// customerRemove → V2: 메타 삭제 + 사용자 동의 시 _session.json에서도 제거
async function customerRemoveV2(phone) {
  const norm = normalizePhone(phone);
  // 메타만 삭제 (실제 데이터는 _session.json에 그대로)
  // → 작업 데이터는 보존, 마케팅 정보만 삭제
  await deleteCustomerMeta(norm);
}

// 디바운스 타이머
let _xlsxFlushTimer = null;
let _xlsxFlushPending = false;

// flushCustomersXlsx → V2: 디바운스 적용 (즉시 호출 시 빠른 응답, 백그라운드 누적)
async function flushCustomersXlsxV2(opts = {}) {
  // 즉시 모드 (force) - 작업 종료 시
  if (opts.immediate) {
    if (_xlsxFlushTimer) {
      clearTimeout(_xlsxFlushTimer);
      _xlsxFlushTimer = null;
    }
    return _writeXlsxNow();
  }

  // 디바운스 모드 (default) - 3초 후 1번만 실행
  _xlsxFlushPending = true;
  if (_xlsxFlushTimer) clearTimeout(_xlsxFlushTimer);
  _xlsxFlushTimer = setTimeout(async () => {
    _xlsxFlushTimer = null;
    if (_xlsxFlushPending) {
      _xlsxFlushPending = false;
      await _writeXlsxNow();
    }
  }, 3000);
}

async function _writeXlsxNow() {
  if (!photoFolderHandle) return;

  try {
    const perm = await photoFolderHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return;

    const customers = await rebuildCustomersFromSessions({ force: true });

    // xlsx 작성
    const mainData = customers.map(c => {
      // 주소 자동 채우기 (옵션 C에서도 유지)
      let address = c.address || '';
      if (!address.trim() && c.visits && c.visits.length > 0) {
        const v = c.visits[0];
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

    const visitsData = [];
    customers.forEach(c => {
      (c.visits || []).forEach(v => {
        visitsData.push({
          phone: c.phone,
          name: c.name || '',
          date: v.date || '',
          apt: v.apt || '',
          unit: v.unit || '',
          work: `Photos: ${v.photos || 0}${v.specials ? `, Notes: ${v.specials}` : ''}`,
          workId: v.workId || '',
          folder: v.folderName || ''
        });
      });
    });

    if (typeof XLSX === 'undefined') {
      console.warn('XLSX 라이브러리 없음');
      return;
    }

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(mainData, {
      header: ['phone','name','address','email','memo','first_visit','last_visit','visit_count','is_repeat','created_at','updated_at']
    });
    XLSX.utils.book_append_sheet(wb, ws1, 'Customers');

    const ws2 = XLSX.utils.json_to_sheet(visitsData, {
      header: ['phone','name','date','apt','unit','work','workId','folder']
    });
    XLSX.utils.book_append_sheet(wb, ws2, 'Visits');

    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

    const fh = await photoFolderHandle.getFileHandle(XLSX_FILE_NAME, { create: true });
    const writable = await fh.createWritable();
    await writable.write(buf);
    await writable.close();

    console.log(`[v2] customers.xlsx 재생성: ${customers.length}명, ${visitsData.length}개 작업`);
  } catch(e) {
    console.warn('xlsx 재생성 실패:', e);
  }
}

// ════════════════════════════════════════
// V2 활성화 - 기존 함수 오버라이드
// ════════════════════════════════════════
function activateCustomerStorageV2() {
  // 기존 함수들을 V2로 교체
  window.customerListAll = customerListAllV2;
  window.customerLookup = customerLookupV2;
  window.customerSave = customerSaveV2;
  window.customerRemove = customerRemoveV2;
  window.flushCustomersXlsx = flushCustomersXlsxV2;
  window.invalidateCustomersCache = function() {
    invalidateCustomersV2();
    invalidateCustomerMetaCache();
  };
  // initCustomersCache는 메타 로드만
  window.initCustomersCache = loadCustomerMeta;

  console.log('[v2] Customer Storage V2 활성화 - 단일 진실 공급원 모드');
}

if (typeof window !== 'undefined') {
  window.rebuildCustomersFromSessions = rebuildCustomersFromSessions;
  window.activateCustomerStorageV2 = activateCustomerStorageV2;
  window.loadCustomerMeta = loadCustomerMeta;
  window.invalidateCustomerMetaCache = invalidateCustomerMetaCache;

  // 자동 활성화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', activateCustomerStorageV2);
  } else {
    activateCustomerStorageV2();
  }
}
