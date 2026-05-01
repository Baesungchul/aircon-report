/* ═══════════════════════════════
   다국어(i18n) 시스템
═══════════════════════════════ */

const I18N = {
  ko: {
    // 앱 헤더
    'app.title': '작업 보고서 생성기',
    'app.subtitle': '',

    // 메인 입력
    'main.workName': '작업명',
    'main.workDate': '작업일자',
    'main.worker': '담당자',
    'main.placeholder.workName': '작업명을 입력하세요',
    'main.placeholder.workerName': '담당자명',

    // 메인 버튼
    'btn.settings': '⚙️ 설정',
    'btn.newWork': '🆕 새작업',
    'btn.save': '💾 저장',
    'btn.load': '📂 불러오기',
    'btn.preview': '📋 미리보기',
    'btn.pdf': '⬇️ PDF',
    'btn.jpg': '🖼️ JPG',

    // 통계 카드
    'stats.totalUnits': '총 호수',
    'stats.completed': '전후 완비',
    'stats.incomplete': '미완료',
    'stats.totalPhotos': '총 사진',

    // 호수 입력
    'unit.placeholder': '호수 입력 (예: 101동 201호)',
    'unit.add': '➕ 추가',
    'unit.bulk': '📋 일괄',
    'unit.delete': '삭제',
    'unit.search': '🔍 호수 검색',
    'unit.expandAll': '전체 펼치기',
    'unit.collapseAll': '전체 접기',
    'unit.before': '작업 전',
    'unit.after': '작업 후',
    'unit.special': '특이사항',
    'unit.complete': '✓ 완료',
    'unit.incomplete': '⚠️',
    'unit.camera': '📷 카메라',
    'unit.file': '📂 파일',
    'unit.empty.before': '아직 작업 전 사진이 없습니다',
    'unit.empty.after': '아직 작업 후 사진이 없습니다',
    'unit.special.add': '+ 특이사항 추가',
    'unit.special.placeholder': '특이사항 설명 (예: 누수 발생)',

    // 설정
    'set.title': '⚙️ 설정',
    'set.theme': '🎨 테마',
    'set.theme.dark': '다크 블루',
    'set.theme.midnight': '미드나잇',
    'set.theme.forest': '포레스트',
    'set.theme.light': '라이트',
    'set.reportTheme': '📄 보고서 테마',
    'set.reportTheme.default': '기본',
    'set.reportTheme.bright': '밝은',
    'set.reportTheme.dark': '어두운',
    'set.reportTheme.cool': '시원한',
    'set.reportTheme.clean': '깔끔한',
    'set.reportTheme.premium': '세련된',
    'set.fontSize': '🔤 글자 크기',
    'set.language': '🌐 언어',
    'set.folder': '📁 자동저장 폴더',
    'set.folder.set': '📁 폴더 설정',
    'set.folder.change': '📁 폴더 변경',
    'set.folder.clear': '폴더 해제',
    'set.folder.unset': '📁 자동저장 폴더 미설정',
    'set.folder.notSupported': '⚠️ 폴더 자동저장 미지원 브라우저',
    'set.company': '🏢 업체 정보',
    'set.company.edit': '업체 정보 수정',
    'set.close': '닫기',

    // 회사 정보
    'co.title': '🏢 업체 정보',
    'co.icon': '아이콘',
    'co.iconUpload': '📷 사진 선택',
    'co.iconRemove': '제거',
    'co.name': '업체명',
    'co.brand': '법인명/브랜드명',
    'co.tel': '연락처',
    'co.biz': '사업자번호',
    'co.addr': '주소',
    'co.email': '이메일',
    'co.web': '웹사이트',
    'co.desc': '소개글',
    'co.descPlaceholder': '업체 소개 (보고서 표지에 표시됨)',
    'co.save': '저장',
    'co.cancel': '취소',

    // 저장 다이얼로그
    'save.title': '💾 저장',
    'save.label': '저장 이름',
    'save.toFolder': '폴더에 저장',
    'save.toApp': '앱 내 저장 (백업)',
    'save.cancel': '취소',
    'save.confirm': '저장',

    // 불러오기
    'load.title': '📂 저장된 작업 목록',
    'load.close': '× 닫기',
    'load.changePeriod': '🔍 기간 변경',
    'load.empty': '해당 기간에 저장된 작업이 없습니다',
    'load.empty.hint': '🔍 기간 변경 버튼을 눌러 범위를 넓혀보세요',
    'load.pickFile': '📂 파일 탐색기에서 직접 선택',
    'load.count': '{n}개 작업',
    'load.btn.load': '불러오기',
    'load.btn.delete': '삭제',
    'load.unitsAndPhotos': '{u}호수 · 사진 {p}장',

    // 기간 설정
    'period.title': '🔍 기간 설정',
    'period.from': '시작 날짜',
    'period.to': '종료 날짜',
    'period.recent3': '최근 3일',
    'period.recent30': '최근 30일',
    'period.recent3m': '최근 3개월',
    'period.recent1y': '최근 1년',
    'period.all': '전체 기간',
    'period.cancel': '취소',
    'period.apply': '적용',

    // 보고서
    'report.cover.report': 'WORK REPORT',
    'report.cover.no': 'No.{n}',
    'report.cover.eyebrow': 'AIR CONDITIONER',
    'report.cover.title.before': '에어컨',
    'report.cover.title.after': '청소 보고서',
    'report.cover.subtitle': '쾌적한 공기를 위한 전문 청소 서비스',
    'report.cover.about': 'ABOUT US',
    'report.cover.tel': '대표 전화',
    'report.cover.workSite': '작업 현장',
    'report.cover.workDate': '작업일',
    'report.cover.units': '호수',
    'report.cover.photos': '사진',
    'report.cover.totalUnits': '총 호수',
    'report.cover.completed': '완료',
    'report.cover.incomplete': '미완료',
    'report.cover.specials': '특이사항',
    'report.cover.unit': '호',
    'report.cover.case': '건',
    'report.list.title': '작업 상세 목록',
    'report.list.total': '총 {n}건',
    'report.list.no': '#',
    'report.list.unit': '호수',
    'report.list.before': '작업 전',
    'report.list.after': '작업 후',
    'report.list.status': '상태',
    'report.list.statusDone': '완료',
    'report.list.statusPending': '미완료',
    'report.list.statusDoneShort': '완',
    'report.list.statusPendingShort': '미완',
    'report.coCard.title': '📌 업체 정보',
    'report.coCard.name': '🏷️ 업체명',
    'report.coCard.brand': '📋 법인명',
    'report.coCard.tel': '📞 연락처',
    'report.coCard.biz': '🏢 사업자번호',
    'report.coCard.addr': '📍 주소',
    'report.coCard.email': '📧 이메일',
    'report.coCard.web': '🌐 웹사이트',
    'report.detail.unit': '호수',
    'report.detail.before': '작업 전',
    'report.detail.after': '작업 후',
    'report.detail.special': '특이사항',
    'report.detail.photo': '사진',
    'report.detail.continued': '(계속)',
    'report.footer.page': '{n} / {total}',

    // 토스트 메시지
    'msg.saveSuccess': '✓ 저장 완료',
    'msg.saveFailed': '저장 실패',
    'msg.loadSuccess': '✓ {n}호수 불러옴',
    'msg.loadFailed': '불러오기 실패',
    'msg.deleted': '✓ "{name}" 삭제됨',
    'msg.deleteFailed': '삭제 실패',
    'msg.newWork': '🆕 새 작업',
    'msg.unitAdded': '✓ 추가됨',
    'msg.unitDeleted': '✓ 호수 삭제됨',
    'msg.photoAdded': '✓ 사진 {n}장 추가',
    'msg.alreadyExists': '이미 있는 호수입니다',
    'msg.emptyName': '호수를 입력하세요',

    // 확인 다이얼로그
    'confirm.newWork.title': '📋 현재 작업: 호수 {u}개, 사진 {p}장',
    'confirm.newWork.withFolder': '저장 폴더에 자동 저장 후 새 작업을 시작합니다.\n계속할까요?',
    'confirm.newWork.noFolder': '새 작업을 시작합니다.\n(저장 폴더가 없어 사진은 저장되지 않습니다)',
    'confirm.deleteWork.title': '🗑️ 다음 작업을 삭제할까요?',
    'confirm.deleteWork.detail': '{apt} · {date}\n{n}개 호수',
    'confirm.deleteWork.warn': '※ 폴더의 사진과 모든 파일이 삭제됩니다.\n이 작업은 되돌릴 수 없습니다.',
    'confirm.exit': '앱을 종료하시겠습니까?\n\n작업 내용은 자동으로 저장되어 있어 다음에 다시 열 수 있습니다.',
    'confirm.deleteUnit': '"{name}" 호수를 삭제할까요?',
    'confirm.deletePhoto': '사진을 삭제할까요?',
    'confirm.restore.detail': '📋 {apt} · {date}\n{u}개 호수, 사진 {p}장',
    'confirm.restore.options': '▶ 확인: 사진까지 복원 (느림)\n▶ 취소: 호수 정보만 복원 (빠름)',
  },

  en: {
    // App header
    'app.title': 'Work Report Generator',
    'app.subtitle': '',

    // Main inputs
    'main.workName': 'Work Site',
    'main.workDate': 'Work Date',
    'main.worker': 'Worker',
    'main.placeholder.workName': 'Enter work site name',
    'main.placeholder.workerName': 'Worker name',

    // Main buttons
    'btn.settings': '⚙️ Settings',
    'btn.newWork': '🆕 New',
    'btn.save': '💾 Save',
    'btn.load': '📂 Load',
    'btn.preview': '📋 Preview',
    'btn.pdf': '⬇️ PDF',
    'btn.jpg': '🖼️ JPG',

    // Stats cards
    'stats.totalUnits': 'Total Units',
    'stats.completed': 'Completed',
    'stats.incomplete': 'Pending',
    'stats.totalPhotos': 'Total Photos',

    // Unit input
    'unit.placeholder': 'Enter unit (e.g. Bldg 101 #201)',
    'unit.add': '➕ Add',
    'unit.bulk': '📋 Bulk',
    'unit.delete': 'Delete',
    'unit.search': '🔍 Search units',
    'unit.expandAll': 'Expand All',
    'unit.collapseAll': 'Collapse All',
    'unit.before': 'Before',
    'unit.after': 'After',
    'unit.special': 'Notes',
    'unit.complete': '✓ Done',
    'unit.incomplete': '⚠️',
    'unit.camera': '📷 Camera',
    'unit.file': '📂 File',
    'unit.empty.before': 'No before photos yet',
    'unit.empty.after': 'No after photos yet',
    'unit.special.add': '+ Add note',
    'unit.special.placeholder': 'Note (e.g. water leak)',

    // Settings
    'set.title': '⚙️ Settings',
    'set.theme': '🎨 Theme',
    'set.theme.dark': 'Dark Blue',
    'set.theme.midnight': 'Midnight',
    'set.theme.forest': 'Forest',
    'set.theme.light': 'Light',
    'set.reportTheme': '📄 Report Theme',
    'set.reportTheme.default': 'Default',
    'set.reportTheme.bright': 'Bright',
    'set.reportTheme.dark': 'Dark',
    'set.reportTheme.cool': 'Cool',
    'set.reportTheme.clean': 'Clean',
    'set.reportTheme.premium': 'Premium',
    'set.fontSize': '🔤 Font Size',
    'set.language': '🌐 Language',
    'set.folder': '📁 Auto-save Folder',
    'set.folder.set': '📁 Set Folder',
    'set.folder.change': '📁 Change Folder',
    'set.folder.clear': 'Clear',
    'set.folder.unset': '📁 No auto-save folder',
    'set.folder.notSupported': '⚠️ Auto-save not supported in this browser',
    'set.company': '🏢 Company Info',
    'set.company.edit': 'Edit Company Info',
    'set.close': 'Close',

    // Company info
    'co.title': '🏢 Company Info',
    'co.icon': 'Icon',
    'co.iconUpload': '📷 Upload Photo',
    'co.iconRemove': 'Remove',
    'co.name': 'Company Name',
    'co.brand': 'Brand Name',
    'co.tel': 'Phone',
    'co.biz': 'Business No.',
    'co.addr': 'Address',
    'co.email': 'Email',
    'co.web': 'Website',
    'co.desc': 'Description',
    'co.descPlaceholder': 'Company description (shown on report cover)',
    'co.save': 'Save',
    'co.cancel': 'Cancel',

    // Save dialog
    'save.title': '💾 Save',
    'save.label': 'Save Name',
    'save.toFolder': 'Save to folder',
    'save.toApp': 'Save in app (backup)',
    'save.cancel': 'Cancel',
    'save.confirm': 'Save',

    // Load dialog
    'load.title': '📂 Saved Works',
    'load.close': '× Close',
    'load.changePeriod': '🔍 Change Period',
    'load.empty': 'No saved works in this period',
    'load.empty.hint': '🔍 Click "Change Period" to broaden the range',
    'load.pickFile': '📂 Pick file from explorer',
    'load.count': '{n} work(s)',
    'load.btn.load': 'Load',
    'load.btn.delete': 'Delete',
    'load.unitsAndPhotos': '{u} units · {p} photos',

    // Period
    'period.title': '🔍 Set Period',
    'period.from': 'From',
    'period.to': 'To',
    'period.recent3': 'Last 3 days',
    'period.recent30': 'Last 30 days',
    'period.recent3m': 'Last 3 months',
    'period.recent1y': 'Last 1 year',
    'period.all': 'All time',
    'period.cancel': 'Cancel',
    'period.apply': 'Apply',

    // Report
    'report.cover.report': 'WORK REPORT',
    'report.cover.no': 'No.{n}',
    'report.cover.eyebrow': 'AIR CONDITIONER',
    'report.cover.title.before': 'AC',
    'report.cover.title.after': 'Cleaning Report',
    'report.cover.subtitle': 'Professional cleaning service for fresh air',
    'report.cover.about': 'ABOUT US',
    'report.cover.tel': 'Phone',
    'report.cover.workSite': 'Work Site',
    'report.cover.workDate': 'Date',
    'report.cover.units': 'Units',
    'report.cover.photos': 'Photos',
    'report.cover.totalUnits': 'Total Units',
    'report.cover.completed': 'Completed',
    'report.cover.incomplete': 'Pending',
    'report.cover.specials': 'Notes',
    'report.cover.unit': '',
    'report.cover.case': '',
    'report.list.title': 'Work Detail List',
    'report.list.total': 'Total {n}',
    'report.list.no': '#',
    'report.list.unit': 'Unit',
    'report.list.before': 'Before',
    'report.list.after': 'After',
    'report.list.status': 'Status',
    'report.list.statusDone': 'Done',
    'report.list.statusPending': 'Pending',
    'report.list.statusDoneShort': 'Done',
    'report.list.statusPendingShort': 'Pending',
    'report.coCard.title': '📌 Company Info',
    'report.coCard.name': '🏷️ Name',
    'report.coCard.brand': '📋 Brand',
    'report.coCard.tel': '📞 Phone',
    'report.coCard.biz': '🏢 Business No.',
    'report.coCard.addr': '📍 Address',
    'report.coCard.email': '📧 Email',
    'report.coCard.web': '🌐 Website',
    'report.detail.unit': 'Unit',
    'report.detail.before': 'Before',
    'report.detail.after': 'After',
    'report.detail.special': 'Notes',
    'report.detail.photo': 'Photo',
    'report.detail.continued': '(continued)',
    'report.footer.page': '{n} / {total}',

    // Toast messages
    'msg.saveSuccess': '✓ Saved',
    'msg.saveFailed': 'Save failed',
    'msg.loadSuccess': '✓ Loaded {n} units',
    'msg.loadFailed': 'Load failed',
    'msg.deleted': '✓ "{name}" deleted',
    'msg.deleteFailed': 'Delete failed',
    'msg.newWork': '🆕 New work',
    'msg.unitAdded': '✓ Added',
    'msg.unitDeleted': '✓ Unit deleted',
    'msg.photoAdded': '✓ {n} photo(s) added',
    'msg.alreadyExists': 'Unit already exists',
    'msg.emptyName': 'Enter unit name',

    // Confirm dialogs
    'confirm.newWork.title': '📋 Current: {u} units, {p} photos',
    'confirm.newWork.withFolder': 'Auto-save to folder, then start new work.\nContinue?',
    'confirm.newWork.noFolder': 'Start new work?\n(No folder set, photos will not be saved)',
    'confirm.deleteWork.title': '🗑️ Delete this work?',
    'confirm.deleteWork.detail': '{apt} · {date}\n{n} units',
    'confirm.deleteWork.warn': '※ All photos and files in folder will be deleted.\nThis cannot be undone.',
    'confirm.exit': 'Exit app?\n\nYour work is auto-saved and can be reopened later.',
    'confirm.deleteUnit': 'Delete unit "{name}"?',
    'confirm.deletePhoto': 'Delete this photo?',
    'confirm.restore.detail': '📋 {apt} · {date}\n{u} units, {p} photos',
    'confirm.restore.options': '▶ OK: Restore with photos (slow)\n▶ Cancel: Restore info only (fast)',
  }
};

// 현재 언어 (localStorage에서 읽음, 기본 한국어)
function getCurrentLang() {
  return localStorage.getItem('ac_lang_v1') || 'ko';
}

// 번역 함수
function t(key, params) {
  const lang = getCurrentLang();
  const dict = I18N[lang] || I18N.ko;
  let text = dict[key];
  if (text === undefined) {
    // 영어에 없으면 한국어 폴백
    text = I18N.ko[key];
    if (text === undefined) return key;  // 키가 아예 없으면 키 그대로 반환
  }
  // 파라미터 치환 {n}, {apt} 등
  if (params) {
    for (const k in params) {
      text = text.replace(new RegExp('\\{' + k + '\\}', 'g'), params[k]);
    }
  }
  return text;
}

// HTML 요소들의 텍스트를 현재 언어로 업데이트
function applyI18nToDOM() {
  // data-i18n 속성이 있는 요소의 텍스트 갱신
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  // data-i18n-placeholder 속성이 있는 input의 placeholder 갱신
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  // data-i18n-html 속성: HTML 그대로 (아이콘 등 포함)
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
}

// 언어 변경
function setLanguage(lang) {
  if (!I18N[lang]) lang = 'ko';
  localStorage.setItem('ac_lang_v1', lang);
  applyI18nToDOM();
  // 동적으로 생성된 요소들도 다시 렌더링
  if (typeof renderAll === 'function') renderAll();
  if (typeof updateStats === 'function') updateStats();
}
