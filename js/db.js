/* ═══════════════════════════════
   IndexedDB  ─  용량 무제한 저장
═══════════════════════════════ */
const DB_NAME = 'AirconReportDB';
const DB_VER  = 2;           // ← 버전 올려서 settings 스토어 추가
const STORE   = 'saves';
const SETTINGS_STORE = 'settings';
let   db      = null;
let   photoFolderHandle = null;   // 저장 폴더 핸들 (메모리 캐시)

function openDB() {
  return new Promise((res, rej) => {
    if (db) { res(db); return; }
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE)) {
        const s = d.createObjectStore(STORE, { keyPath:'saveId' });
        s.createIndex('savedAt','savedAt',{unique:false});
      }
      // v2: settings 스토어 (폴더 핸들 등 저장)
      if (!d.objectStoreNames.contains(SETTINGS_STORE)) {
        d.createObjectStore(SETTINGS_STORE, { keyPath:'key' });
      }
    };
    req.onsuccess = e => { db = e.target.result; res(db); };
    req.onerror   = e => rej(e.target.error);
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

