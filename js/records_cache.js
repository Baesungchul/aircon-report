/* ═══════════════════════════════════════════════
   작업 기록 캐시 시스템 (단순화 v2)
   - 전체 작업 목록 하나만 캐싱
   - 기간 필터는 customers.js에서 매번 적용
   - 저장/삭제 시 무효화 + 백그라운드 재빌드
═══════════════════════════════════════════════ */

let _recordsCache = null;       // 전체 작업 배열
let _recordsBuiltAt = 0;

let _cacheRebuildInProgress = false;
let _cacheRebuildQueued = false;

// 캐시 조회 (기간 무관 - 전체 반환)
window.getRecordsFromCache = function() {
  return _recordsCache;  // null 또는 배열
};

// ★ customers.js에서 직접 캐시 채우기용 (빈 배열은 캐시 안 함)
window.__cacheAllRecords = function(items) {
  if (!Array.isArray(items)) return;
  if (items.length === 0) {
    // ★ 빈 결과는 캐시하지 않음 - 권한 미확보 등으로 인한 빈 결과일 수 있음
    console.log('[기록캐시] 빈 결과 → 캐시 안 함');
    return;
  }
  _recordsCache = items;
  _recordsBuiltAt = Date.now();
  console.log(`[기록캐시] 외부 채움: ${items.length}건`);
};

// 캐시 무효화 (저장/삭제 시 호출)
window.invalidateRecordsCache = function() {
  console.log('[기록캐시] 무효화');
  _recordsCache = null;
  _recordsBuiltAt = 0;
  scheduleBackgroundBuild();
};

// 백그라운드 빌드 - 변경 발생 시 호출됨
// 첫 로드는 customers.js의 renderCustomerList가 직접 함
async function _buildAllRecords() {
  if (typeof loadCombinedRecords !== 'function') return;
  if (!photoFolderHandle) return;

  // 현재 캐시가 있으면 비교를 위해 백업
  console.log('[기록캐시] 백그라운드 빌드');

  // ★ customers.js의 상태 변수를 잠시 바꿔야 함
  // setCustomerFilter가 있으면 사용
  if (typeof setCustomerFilter === 'function' && typeof getCustomerFilter === 'function') {
    const prev = getCustomerFilter();
    try {
      setCustomerFilter({ useDefault: false, dateFrom: null, dateTo: null });
      const items = await loadCombinedRecords();
      _recordsCache = items;
      _recordsBuiltAt = Date.now();
      console.log(`[기록캐시] 빌드 완료: ${items.length}건`);
    } catch(e) {
      console.warn('[기록캐시] 빌드 실패:', e.message);
    } finally {
      setCustomerFilter(prev);
    }
  }
  // setter 없으면 빌드 안 함 (customers.js가 첫 로드 시 채움)
}

window.scheduleBackgroundBuild = function() {
  if (_cacheRebuildInProgress) {
    _cacheRebuildQueued = true;
    return;
  }
  _cacheRebuildInProgress = true;
  setTimeout(async () => {
    try {
      await _buildAllRecords();
    } catch(e) {
      console.warn('[기록캐시] 빌드 오류:', e);
    } finally {
      _cacheRebuildInProgress = false;
      if (_cacheRebuildQueued) {
        _cacheRebuildQueued = false;
        scheduleBackgroundBuild();
      }
    }
  }, 100);
};

// 앱 시작 시 자동 빌드는 folder.js에서 권한 확보 후 호출됨
