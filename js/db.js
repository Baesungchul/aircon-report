/* ═══════════════════════════════
   IndexedDB  ─  용량 무제한 저장
═══════════════════════════════ */
const DB_NAME = 'AirconReportDB';
const DB_VER  = 3;           // ← v3: customers 스토어 추가
const STORE   = 'saves';
const SETTINGS_STORE = 'settings';
const CUSTOMER_STORE = 'customers';
let   db      = null;
let   photoFolderHandle = null;   // 저장 폴더 핸들 (메모리 캐시)

function openDB() {
  return new Promise((res, rej) => {
    if (db) {
      // 이미 열린 DB에 customers 스토어가 있는지 확인
      if (!db.objectStoreNames.contains(CUSTOMER_STORE)) {
        console.warn('🟡 customers 스토어 없음 - DB 재오픈 필요');
        db.close();
        db = null;
      } else {
        res(db);
        return;
      }
    }

    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      console.log(`🔵 DB 업그레이드: ${e.oldVersion} → ${e.newVersion}`);
      if (!d.objectStoreNames.contains(STORE)) {
        const s = d.createObjectStore(STORE, { keyPath:'saveId' });
        s.createIndex('savedAt','savedAt',{unique:false});
        console.log('  ✓ saves 스토어 생성');
      }
      if (!d.objectStoreNames.contains(SETTINGS_STORE)) {
        d.createObjectStore(SETTINGS_STORE, { keyPath:'key' });
        console.log('  ✓ settings 스토어 생성');
      }
      if (!d.objectStoreNames.contains(CUSTOMER_STORE)) {
        const c = d.createObjectStore(CUSTOMER_STORE, { keyPath:'phone' });
        c.createIndex('lastVisit', 'lastVisit', { unique:false });
        c.createIndex('name', 'name', { unique:false });
        console.log('  ✓ customers 스토어 생성');
      }
    };
    req.onsuccess = e => {
      db = e.target.result;
      console.log(`🟢 DB 오픈 완료 (v${db.version}). 스토어:`, Array.from(db.objectStoreNames));

      // ★ 안전장치: customers 스토어 없으면 강제 버전 업
      if (!db.objectStoreNames.contains(CUSTOMER_STORE)) {
        console.warn('🟡 customers 스토어 없음 - 강제 업그레이드');
        db.close();
        db = null;
        const req2 = indexedDB.open(DB_NAME, DB_VER + 1);
        req2.onupgradeneeded = e2 => {
          const d = e2.target.result;
          if (!d.objectStoreNames.contains(CUSTOMER_STORE)) {
            const c = d.createObjectStore(CUSTOMER_STORE, { keyPath:'phone' });
            c.createIndex('lastVisit', 'lastVisit', { unique:false });
            c.createIndex('name', 'name', { unique:false });
            console.log('  ✓ customers 스토어 (강제) 생성');
          }
        };
        req2.onsuccess = e2 => {
          db = e2.target.result;
          console.log('🟢 DB 강제 업그레이드 완료');
          res(db);
        };
        req2.onerror = e2 => rej(e2.target.error);
        return;
      }

      res(db);
    };
    req.onerror = e => {
      console.error('🔴 DB 오픈 실패:', e.target.error);
      rej(e.target.error);
    };
  });
}

// settings 스토어 get/put
async function settingsGet(key) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx  = d.transaction(SETTINGS_STORE,'readonly');
    const req = tx.objectStore(SETTINGS_STORE).get(key);
    req.onsuccess = () => res(req.result ? req.result.value : null);
    req.onerror   = e => rej(e.target.error);
  });
}
async function settingsPut(key, value) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx  = d.transaction(SETTINGS_STORE,'readwrite');
    const req = tx.objectStore(SETTINGS_STORE).put({ key, value });
    req.onsuccess = () => res();
    req.onerror   = e => rej(e.target.error);
  });
}

function dbGet(saveId) {
  return new Promise(async (res, rej) => {
    try {
      const d = await openDB();
      const tx  = d.transaction(STORE,'readonly');
      const req = tx.objectStore(STORE).get(saveId);
      req.onsuccess = () => res(req.result || null);
      req.onerror   = e => rej(e.target.error);
    } catch(e) { rej(e); }
  });
}

async function dbGetAll() {
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx  = d.transaction(STORE,'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => res(req.result.sort((a,b)=>b.savedAt.localeCompare(a.savedAt)));
    req.onerror   = e => rej(e.target.error);
  });
}

async function dbPut(obj) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx  = d.transaction(STORE,'readwrite');
    const req = tx.objectStore(STORE).put(obj);
    req.onsuccess = () => res();
    req.onerror   = e => rej(e.target.error);
  });
}

async function dbDelete(saveId) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx  = d.transaction(STORE,'readwrite');
    const req = tx.objectStore(STORE).delete(saveId);
    req.onsuccess = () => res();
    req.onerror   = e => rej(e.target.error);
  });
}


/* ═══════════════════════════════
   고객 정보 (Customers) CRUD
═══════════════════════════════ */
// 전화번호 정규화 (하이픈 제거 후 다시 표준 포맷)
function normalizePhone(phone) {
  if (!phone) return '';
  const t = phone.replace(/[^\d]/g, '');
  if (t.length === 11 && t.startsWith('010')) return `${t.slice(0,3)}-${t.slice(3,7)}-${t.slice(7)}`;
  if (t.length === 10 && t.startsWith('02'))  return `${t.slice(0,2)}-${t.slice(2,6)}-${t.slice(6)}`;
  if (t.length === 11)                         return `${t.slice(0,3)}-${t.slice(3,7)}-${t.slice(7)}`;
  if (t.length === 10)                         return `${t.slice(0,3)}-${t.slice(3,6)}-${t.slice(6)}`;
  return phone;  // 형식 모를 땐 원본
}

// 고객 1명 가져오기
async function customerGet(phone) {
  const key = normalizePhone(phone);
  if (!key) return null;
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx  = d.transaction(CUSTOMER_STORE, 'readonly');
    const req = tx.objectStore(CUSTOMER_STORE).get(key);
    req.onsuccess = () => res(req.result || null);
    req.onerror   = e => rej(e.target.error);
  });
}

// 모든 고객
async function customerGetAll() {
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx  = d.transaction(CUSTOMER_STORE, 'readonly');
    const req = tx.objectStore(CUSTOMER_STORE).getAll();
    req.onsuccess = () => {
      const list = req.result || [];
      // 최근 방문 우선 정렬
      list.sort((a, b) => (b.lastVisit || '').localeCompare(a.lastVisit || ''));
      res(list);
    };
    req.onerror   = e => rej(e.target.error);
  });
}

// 고객 저장 (없으면 새로, 있으면 기존에 방문 추가)
async function customerUpsert(info) {
  // info: { phone, name, address, email, memo, visit: { date, apt, unit, work } }
  const phone = normalizePhone(info.phone);
  if (!phone) throw new Error('전화번호가 필요합니다');

  const existing = await customerGet(phone);
  const now = new Date().toISOString();
  const visit = info.visit || null;

  let customer;
  if (existing) {
    // 기존 고객 - 정보 업데이트 + 방문 추가
    customer = { ...existing };
    if (info.name && info.name.trim())     customer.name    = info.name.trim();
    if (info.address && info.address.trim()) customer.address = info.address.trim();
    if (info.email && info.email.trim())   customer.email   = info.email.trim();
    if (info.memo && info.memo.trim())     customer.memo    = info.memo.trim();
    customer.lastVisit = visit?.date || now.slice(0, 10);
    customer.visitCount = (customer.visitCount || 1) + (visit ? 1 : 0);
    customer.updatedAt = now;

    if (visit) {
      customer.visits = customer.visits || [];
      // 같은 날짜+호수 중복 방지
      const dupIdx = customer.visits.findIndex(v =>
        v.date === visit.date && v.unit === visit.unit && v.apt === visit.apt
      );
      if (dupIdx >= 0) {
        customer.visits[dupIdx] = visit;
        customer.visitCount = customer.visits.length;  // 중복 제외
      } else {
        customer.visits.push(visit);
      }
    }
  } else {
    // 신규 고객
    customer = {
      phone,
      name: (info.name || '').trim(),
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

  // 이름이 비어있으면 호수명을 이름으로 (마케팅 식별용)
  if (!customer.name && visit?.unit) {
    customer.name = visit.unit;
  }

  const d = await openDB();
  return new Promise((res, rej) => {
    const tx  = d.transaction(CUSTOMER_STORE, 'readwrite');
    const req = tx.objectStore(CUSTOMER_STORE).put(customer);
    req.onsuccess = () => res(customer);
    req.onerror   = e => rej(e.target.error);
  });
}

// 고객 삭제
async function customerDelete(phone) {
  const key = normalizePhone(phone);
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx  = d.transaction(CUSTOMER_STORE, 'readwrite');
    const req = tx.objectStore(CUSTOMER_STORE).delete(key);
    req.onsuccess = () => res();
    req.onerror   = e => rej(e.target.error);
  });
}

// 고객 직접 저장 (편집용)
async function customerPut(customer) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx  = d.transaction(CUSTOMER_STORE, 'readwrite');
    const req = tx.objectStore(CUSTOMER_STORE).put(customer);
    req.onsuccess = () => res();
    req.onerror   = e => rej(e.target.error);
  });
}
