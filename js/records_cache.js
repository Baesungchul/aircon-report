/* ═══════════════════════════════════════════════
   작업 기록 캐시 시스템
   - 기간별 캐시 (3일 / 7일 / 30일 / 전체)
   - 앱 시작 시 백그라운드 빌드
   - 저장/삭제 시 캐시 무효화 + 백그라운드 재빌드
   - 모달 열기 시 캐시에서 즉시 표시
═══════════════════════════════════════════════ */

const RECORDS_CACHE = {
  '3':    { items: null, builtAt: 0 },
  '7':    { items: null, builtAt: 0 },
  '30':   { items: null, builtAt: 0 },
  'all':  { items: null, builtAt: 0 },
};

let _cacheRebuildInProgress = false;
let _cacheRebuildQueued = false;

// 기간(일수)을 캐시 키로 변환
function _periodKey(days) {
  if (days == null || days <= 0 || days >= 999) return 'all';
  if (days <= 3)  return '3';
  if (days <= 7)  return '7';
  if (days <= 30) return '30';
  return 'all';
}

// 캐시에서 즉시 조회
window.getRecordsFromCache = function(days) {
  const key = _periodKey(days);
  const entry = RECORDS_CACHE[key];
  if (entry && entry.items) {
    console.log(`[기록캐시] 캐시 적중 (${key}): ${entry.items.length}건`);
    return entry.items;
  }
  return null;
};

// 캐시 신선도 확인
window.isRecordsCacheFresh = function(days, maxAgeMs = 300000) {
  const key = _periodKey(days);
  const entry = RECORDS_CACHE[key];
  if (!entry || !entry.items) return false;
  return (Date.now() - entry.builtAt) < maxAgeMs;
};

// 전체 캐시 무효화 (저장/삭제 시 호출)
window.invalidateRecordsCache = function() {
  console.log('[기록캐시] 무효화');
  Object.keys(RECORDS_CACHE).forEach(k => {
    RECORDS_CACHE[k].items = null;
    RECORDS_CACHE[k].builtAt = 0;
  });
  // 백그라운드 재빌드 예약
  scheduleBackgroundBuild();
};

// 백그라운드에서 모든 기간 캐시 빌드
async function _buildAllPeriods() {
  if (typeof loadCombinedRecords !== 'function') {
    console.warn('[기록캐시] loadCombinedRecords 함수 없음');
    return;
  }
  if (!photoFolderHandle) return;

  console.log('[기록캐시] 백그라운드 빌드 시작');
  const periods = [
    { key: '3',   from: _daysAgo(3) },
    { key: '7',   from: _daysAgo(7) },
    { key: '30',  from: _daysAgo(30) },
    { key: 'all', from: null },
  ];

  for (const p of periods) {
    try {
      const items = await _loadFiltered(p.from);
      RECORDS_CACHE[p.key].items = items;
      RECORDS_CACHE[p.key].builtAt = Date.now();
      console.log(`[기록캐시] ${p.key} 빌드 완료: ${items.length}건`);
    } catch(e) {
      console.warn(`[기록캐시] ${p.key} 빌드 실패:`, e.message);
    }
    // 다음 빌드 전에 메인 스레드 양보
    await new Promise(r => setTimeout(r, 50));
  }
  console.log('[기록캐시] 백그라운드 빌드 완료');
}

function _daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// 기간 필터를 임시로 설정해서 loadCombinedRecords 호출
async function _loadFiltered(fromDate) {
  // 기존 필터 백업
  const prevFrom    = (typeof _customerDateFrom !== 'undefined') ? _customerDateFrom : null;
  const prevTo      = (typeof _customerDateTo !== 'undefined') ? _customerDateTo : null;
  const prevDefault = (typeof _customerUseDefault !== 'undefined') ? _customerUseDefault : true;

  try {
    if (typeof _customerUseDefault !== 'undefined') {
      window._customerUseDefault = false;
    }
    if (typeof _customerDateFrom !== 'undefined') {
      window._customerDateFrom = fromDate;
      window._customerDateTo = null;
    }
    return await loadCombinedRecords();
  } finally {
    // 원래 필터 복원
    if (typeof _customerUseDefault !== 'undefined') window._customerUseDefault = prevDefault;
    if (typeof _customerDateFrom !== 'undefined')   window._customerDateFrom   = prevFrom;
    if (typeof _customerDateTo !== 'undefined')     window._customerDateTo     = prevTo;
  }
}

// 백그라운드 빌드 예약 (중복 방지)
window.scheduleBackgroundBuild = function() {
  if (_cacheRebuildInProgress) {
    _cacheRebuildQueued = true;
    return;
  }
  _cacheRebuildInProgress = true;
  setTimeout(async () => {
    try {
      await _buildAllPeriods();
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

// 앱 시작 시 자동 빌드 (3초 지연 - 초기 로딩 방해 안 함)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => scheduleBackgroundBuild(), 3000);
  });
} else {
  setTimeout(() => scheduleBackgroundBuild(), 3000);
}
