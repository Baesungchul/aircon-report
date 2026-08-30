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

  console.log('[기록캐시] 백그라운드 빌드');

  try {
    // ★ 전역 필터 안 건드림 - 명시적 allDates 옵션으로 전체 로드
    const items = await loadCombinedRecords({ allDates: true });
    _recordsCache = items;
    _recordsBuiltAt = Date.now();
    console.log(`[기록캐시] 빌드 완료: ${items.length}건`);

    // ★ 모달이 열려 있으면 조용히 갱신 (전역 필터 변경 없으므로 사용자가 보던 화면 그대로 + 캐시만 최신)
    // 단, 사용자가 "전체" 보고 있다면 (캐시 신규 추가분 반영을 위해) 다시 그리기
    const modalOpen = document.getElementById('customerModal')?.classList.contains('open');
    if (modalOpen && typeof renderCustomerList === 'function') {
      // 사용자가 "전체" 또는 명시적 기간일 때만 다시 그리기 (기본 3일은 그대로)
      const filter = (typeof getCustomerFilter === 'function') ? getCustomerFilter() : { useDefault: true };
      if (!filter.useDefault) {
        renderCustomerList();
      }
    }
  } catch(e) {
    console.warn('[기록캐시] 빌드 실패:', e.message);
  }
}

let _cacheRebuildTimer = null;

window.scheduleBackgroundBuild = function() {
  if (_cacheRebuildInProgress) {
    _cacheRebuildQueued = true;
    return;
  }
  _cacheRebuildInProgress = true;
  // ★ 100ms → 3000ms (1.242) - 작업 로딩 중 메인 스레드 경쟁 방지
  //   - 사용자가 작업 열어 사진 로딩 시작하는데 동시에 폴더 스캔 돌면 paint 멈춤
  //   - 3초 후 시작 → 사진 로딩이 어느 정도 진행된 후
  _cacheRebuildTimer = setTimeout(async () => {
    _cacheRebuildTimer = null;
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
  }, 3000);
};

// ★ 작업 열기 등 무거운 작업 시작 시 호출 - 예약된 백그라운드 빌드 취소
window.cancelBackgroundBuild = function() {
  if (_cacheRebuildTimer) {
    clearTimeout(_cacheRebuildTimer);
    _cacheRebuildTimer = null;
    _cacheRebuildInProgress = false;
    _cacheRebuildQueued = true;  // 나중에 다시 trigger되면 실행되도록 큐만 켜둠
    console.log('[기록캐시] 예약된 빌드 취소 (다른 무거운 작업 진행 중)');
  }
};

// 앱 시작 시 자동 빌드는 folder.js에서 권한 확보 후 호출됨
