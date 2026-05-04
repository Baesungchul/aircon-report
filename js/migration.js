/* ═══════════════════════════════════════════════
   workId 마이그레이션 (v43+)
   - 기존 _session.json에 workId가 없는 작업들에 workId 부여
   - 같은 폴더의 visits도 workId 연결
═══════════════════════════════════════════════ */

const MIGRATION_KEY = 'ac_workid_migration_v1';

// 마이그레이션 완료 여부 확인
function isMigrationDone() {
  return localStorage.getItem(MIGRATION_KEY) === 'done';
}

function markMigrationDone() {
  localStorage.setItem(MIGRATION_KEY, 'done');
}

function resetMigration() {
  localStorage.removeItem(MIGRATION_KEY);
}

// 폴더 단위 workId 생성 - 폴더명의 시간 정보 활용 (안정적)
// 폴더명 예: "2026-05-04" 또는 "2026-05-04_1430"
function generateWorkIdFromFolder(folderName, fallbackDate) {
  let date = fallbackDate || folderName.slice(0, 10).replace(/-/g, '');
  if (folderName.length >= 10) {
    const m = folderName.match(/^(\d{4})-(\d{2})-(\d{2})(?:_(\d{4}))?/);
    if (m) {
      date = m[1] + m[2] + m[3];
      const hm = m[4] || '0000';
      // 폴더명 자체의 해시를 사용 (같은 폴더는 항상 같은 workId)
      let hash = 0;
      for (let i = 0; i < folderName.length; i++) {
        hash = ((hash << 5) - hash) + folderName.charCodeAt(i);
        hash |= 0;
      }
      const rand = Math.abs(hash).toString(36).slice(0, 4).padStart(4, '0');
      return `W${date}-${hm}-${rand}`;
    }
  }
  // 폴백
  let hash = 0;
  for (let i = 0; i < folderName.length; i++) {
    hash = ((hash << 5) - hash) + folderName.charCodeAt(i);
    hash |= 0;
  }
  const rand = Math.abs(hash).toString(36).slice(0, 4).padStart(4, '0');
  return `W${date}-0000-${rand}`;
}

// 메인 마이그레이션 함수
async function runWorkIdMigration(opts = {}) {
  if (isMigrationDone() && !opts.force) {
    console.log('[Migration] 이미 완료됨');
    return { done: true, skipped: true };
  }

  if (!photoFolderHandle) {
    console.log('[Migration] 폴더 없음 - 스킵');
    return { done: false, reason: 'no_folder' };
  }

  console.log('[Migration] workId 마이그레이션 시작...');

  let folderProcessed = 0;
  let folderUpdated = 0;
  let visitUpdated = 0;
  const folderToWorkId = new Map();  // "apt::date" → workId
  const errors = [];

  try {
    // 1. 폴더 스캔하여 workId 부여
    for await (const entry of photoFolderHandle.values()) {
      if (entry.kind !== 'directory') continue;
      if (!/^\d{4}-\d{2}-\d{2}/.test(entry.name)) continue;

      try {
        let sessionFile;
        try {
          sessionFile = await entry.getFileHandle('_session.json');
        } catch(e) { continue; }  // _session.json 없는 폴더 스킵

        const file = await sessionFile.getFile();
        const text = await file.text();
        const data = JSON.parse(text);

        folderProcessed++;

        // 이미 workId 있으면 스킵 (단, 키 매핑은 추가)
        if (data.workId) {
          const key = `${data.apt || ''}::${data.date || ''}`;
          folderToWorkId.set(key, data.workId);
          continue;
        }

        // workId 부여
        const workId = generateWorkIdFromFolder(entry.name, data.date);
        data.workId = workId;

        // 폴더에 다시 쓰기
        const writableHandle = await sessionFile.createWritable();
        await writableHandle.write(JSON.stringify(data, null, 2));
        await writableHandle.close();

        // 키 매핑 등록
        const key = `${data.apt || ''}::${data.date || ''}`;
        folderToWorkId.set(key, workId);

        folderUpdated++;
        console.log(`[Migration] ${entry.name} → ${workId}`);
      } catch(e) {
        errors.push(`${entry.name}: ${e.message}`);
      }
    }

    console.log(`[Migration] 폴더 ${folderProcessed}개 검사, ${folderUpdated}개에 workId 부여`);

    // 2. 고객 visits에 workId 연결
    if (typeof customerListAll === 'function' && typeof customerUpdateVisits === 'function') {
      const customers = await customerListAll();

      for (const c of customers) {
        if (!c.visits || c.visits.length === 0) continue;

        let updated = false;
        const newVisits = c.visits.map(v => {
          if (v.workId) return v;  // 이미 있으면 그대로

          const key = `${v.apt || ''}::${v.date || ''}`;
          const workId = folderToWorkId.get(key);
          if (workId) {
            updated = true;
            visitUpdated++;
            return { ...v, workId, unitName: v.unitName || v.unit };
          }
          return v;
        });

        if (updated) {
          try {
            await customerUpdateVisits(c.phone, newVisits);
          } catch(e) {
            console.warn(`[Migration] 고객 ${c.phone} visits 업데이트 실패:`, e);
          }
        }
      }

      // xlsx 갱신
      if (typeof flushCustomersXlsx === 'function') {
        try { await flushCustomersXlsx(); } catch(e) {}
      }
    }

    console.log(`[Migration] visits ${visitUpdated}개 연결`);

    markMigrationDone();
    console.log('[Migration] ✓ 완료');

    return {
      done: true,
      folderProcessed,
      folderUpdated,
      visitUpdated,
      errors
    };
  } catch(e) {
    console.error('[Migration] 실패:', e);
    return { done: false, error: e.message };
  }
}

// 자동 실행 (앱 시작 시) - 폴더 권한 있을 때만
async function maybeRunMigration() {
  if (isMigrationDone()) return;
  if (!photoFolderHandle) return;

  // 권한 확인
  try {
    const perm = await photoFolderHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      console.log('[Migration] 권한 없음 - 다음에 시도');
      return;
    }

    // 작업 시작 토스트 (조용히)
    if (typeof showToast === 'function') {
      showToast('🔄 작업 데이터 정리 중...', 'ok');
    }

    const result = await runWorkIdMigration();

    if (result.done && (result.folderUpdated > 0 || result.visitUpdated > 0)) {
      if (typeof showToast === 'function') {
        showToast(`✓ 작업 ${result.folderUpdated}개 정리됨`, 'ok');
      }
    }
  } catch(e) {
    console.warn('[Migration] 자동 실행 실패:', e);
  }
}

// 전역 노출
if (typeof window !== 'undefined') {
  window.runWorkIdMigration = runWorkIdMigration;
  window.maybeRunMigration = maybeRunMigration;
  window.resetMigration = resetMigration;
}
