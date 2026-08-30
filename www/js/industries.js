/* ═══════════════════════════════════════════════
   업종 분류 (대분류 → 소분류 → 기본 호칭 + 아이콘)

   icon: 업종별 아이콘. 스케줄 목록 시간칸 위와 업종 고르기 시트에 쓴다.
         새 업종을 추가할 때 icon 을 같이 넣을 것 — 없으면 대분류 기본 아이콘으로 떨어진다.
═══════════════════════════════════════════════ */

const INDUSTRIES = [
  {
    id: 'cleaning',
    label: '🧼 시설 관리/청소',
    items: [
      { id: 'aircon',     label: '에어컨 청소',         title: '에어컨 청소 보고서',      unit: '호수',     stage: '청소', icon: '❄️' },
      { id: 'boiler',     label: '보일러/배관 청소',    title: '배관 청소 보고서',        unit: '현장',     stage: '청소', icon: '🚰' },
      { id: 'tank',       label: '물탱크 청소',         title: '물탱크 청소 보고서',      unit: '탱크',     stage: '청소', icon: '🛢️' },
      { id: 'duct',       label: '환풍기/덕트 청소',    title: '덕트 청소 보고서',        unit: '구역',     stage: '청소', icon: '💨' },
      { id: 'office',     label: '사무실 청소',         title: '사무실 청소 보고서',      unit: '구역',     stage: '청소', icon: '🏢' },
      { id: 'movein',     label: '입주 청소',           title: '입주 청소 보고서',        unit: '방',       stage: '청소', icon: '🧹' },
      { id: 'grout',      label: '줄눈/타일 시공',      title: '줄눈 시공 보고서',        unit: '구역',     stage: '시공', icon: '🔲' },
      { id: 'mold',       label: '곰팡이 제거',         title: '곰팡이 제거 보고서',      unit: '구역',     stage: '제거', icon: '🦠' },
      { id: 'waterproof', label: '베란다/옥상 방수',    title: '방수 시공 보고서',        unit: '구역',     stage: '시공', icon: '🌧️' },
      { id: 'exterior',   label: '외벽 청소',           title: '외벽 청소 보고서',        unit: '구역',     stage: '청소', icon: '🏬' },
      { id: 'carpet',     label: '카펫/매트리스 청소',  title: '카펫 청소 보고서',        unit: '품목',     stage: '청소', icon: '🛋️' },
      { id: 'washer_cl',  label: '세탁기·건조기 청소',  title: '세탁기 청소 보고서',      unit: '대',       stage: '청소', icon: 'svg:washer' },   // ★ 2026-08-17 드럼 세탁기 그림
      { id: 'sterile',    label: '살균 소독',           title: '살균 소독 보고서',        unit: '구역',     stage: '소독', icon: '🧴' },
      { id: 'pest',       label: '방역(해충/쥐)',       title: '방역 작업 보고서',        unit: '구역',     stage: '방역', icon: '🐜' },
    ]
  },
  {
    id: 'construction',
    label: '🔧 설비/시공',
    items: [
      { id: 'wallpaper',  label: '도배·장판',           title: '도배 시공 보고서',        unit: '현장',     stage: '시공', icon: '🧻' },
      { id: 'paint',      label: '도색·페인트',         title: '도색 작업 보고서',        unit: '현장',     stage: '도색', icon: '🎨' },
      { id: 'interior',   label: '인테리어/리모델링',   title: '인테리어 시공 보고서',    unit: '공간',     stage: '시공', icon: '🪛' },
      { id: 'floor',      label: '마루 시공',           title: '마루 시공 보고서',        unit: '공간',     stage: '시공', icon: '🪵' },
      { id: 'bathroom',   label: '욕실 리모델링',       title: '욕실 리모델링 보고서',    unit: '욕실',     stage: '시공', icon: '🚽' },
      { id: 'kitchen',    label: '싱크대/주방 교체',    title: '주방 시공 보고서',        unit: '주방',     stage: '시공', icon: '🍽️' },
      { id: 'window',     label: '창호/방충망 시공',    title: '창호 시공 보고서',        unit: '창호',     stage: '시공', icon: '🪟' },
      { id: 'blind',      label: '블라인드/커튼',       title: '블라인드 시공 보고서',    unit: '창',       stage: '시공', icon: '🎚️' },
      { id: 'electric',   label: '전기 공사',           title: '전기 공사 보고서',        unit: '구역',     stage: '시공', icon: '⚡' },
      { id: 'cctv',       label: 'CCTV/통신 설치',      title: 'CCTV 설치 보고서',        unit: '카메라',   stage: '설치', icon: '📹' },
      { id: 'doorlock',   label: '도어락 시공',         title: '도어락 설치 보고서',      unit: '문',       stage: '설치', icon: '🔐' },
      { id: 'aircon_inst',label: '에어컨 설치',         title: '에어컨 설치 보고서',      unit: '호수',     stage: '설치', icon: 'svg:ac_wall' },   // ★ 유니코드에 에어컨 이모지가 없어 그림(SVG)으로 그린다
      { id: 'boiler_inst',label: '보일러 설치/수리',    title: '보일러 시공 보고서',      unit: '현장',     stage: '시공', icon: '♨️' },
      /* ★ 2026-08-16 사용자 요청 추가 — 에어컨 기사가 함께 하는 소형 설치 작업 */
      { id: 'light',      label: '조명 설치',           title: '조명 설치 보고서',        unit: '위치',     stage: '설치', icon: '💡' },
      { id: 'ceilingfan', label: '실링팬 설치',         title: '실링팬 설치 보고서',      unit: '위치',     stage: '설치', icon: '🌀' },
      /* ★ 2026-08-17 — TV 와 선반은 원래 항목이 따로 있었다. 그림만 각각 붙였다(항목 신설·삭제 없음).
           ⚠️ tvshelf 의 id 와 라벨은 그대로 둔다 — 이미 이 업종을 쓰는 분의 아이콘이 기본값으로 떨어지면 안 된다. */
      { id: 'tv',         label: 'TV 설치(벽걸이)',     title: 'TV 설치 보고서',          unit: '위치',     stage: '설치', icon: 'svg:tv_wall' },
      { id: 'tvshelf',    label: '벽걸이TV 선반 설치',  title: 'TV 선반 설치 보고서',     unit: '위치',     stage: '설치', icon: 'svg:shelf_wall' },
      { id: 'washer',     label: '세탁기·건조기 설치',  title: '세탁기 설치 보고서',      unit: '위치',     stage: '설치', icon: '🧺' },
    ]
  },
  {
    id: 'auto',
    label: '🚗 자동차/장비',
    items: [
      { id: 'repair',     label: '자동차 정비',         title: '차량 정비 보고서',        unit: '차량',     stage: '정비', icon: '🔧' },
      { id: 'detailing',  label: '광택/디테일링',       title: '광택 작업 보고서',        unit: '차량',     stage: '작업', icon: '✨' },
      { id: 'tinting',    label: '썬팅',                title: '썬팅 시공 보고서',        unit: '차량',     stage: '시공', icon: '🕶️' },
      { id: 'paint_car',  label: '자동차 도색',         title: '도색 작업 보고서',        unit: '차량',     stage: '도색', icon: '🖌️' },
      { id: 'engine',     label: '엔진룸 청소',         title: '엔진룸 청소 보고서',      unit: '차량',     stage: '청소', icon: '⚙️' },
      { id: 'headlight',  label: '헤드라이트 복원',     title: '헤드라이트 복원 보고서',  unit: '차량',     stage: '복원', icon: '🔦' },
      { id: 'wheel',      label: '휠 복원/광택',        title: '휠 복원 보고서',          unit: '차량',     stage: '복원', icon: '⭕' },
      { id: 'heavy',      label: '중장비/농기계 정비',  title: '장비 정비 보고서',        unit: '장비',     stage: '정비', icon: '🚜' },
    ]
  },
  {
    id: 'realestate',
    label: '🏠 부동산/임대',
    items: [
      { id: 'movein_chk', label: '원룸/빌라 입퇴실 점검', title: '입퇴실 점검 보고서',    unit: '호수',     stage: '점검', icon: '🔑' },
      { id: 'mgmt',       label: '아파트/빌라 관리',    title: '시설 점검 보고서',        unit: '구역',     stage: '점검', icon: '🏘️' },
      { id: 'broker',     label: '부동산 중개 사진',    title: '매물 사진 보고서',        unit: '매물',     stage: '점검', icon: '📸' },
      { id: 'airbnb',     label: '에어비앤비 청소',     title: '숙소 청소 보고서',        unit: '객실',     stage: '청소', icon: '🛏️' },
      { id: 'deposit',    label: '임대 보증금 산정',    title: '보증금 산정 보고서',      unit: '호수',     stage: '점검', icon: '💰' },
    ]
  },
  {
    id: 'building',
    label: '🏗️ 건축/공사',
    items: [
      { id: 'repair_b',   label: '건물 보수',           title: '건물 보수 보고서',        unit: '구역',     stage: '보수', icon: '🧱' },
      { id: 'leak',       label: '누수 탐지/수리',      title: '누수 수리 보고서',        unit: '위치',     stage: '수리', icon: '💧' },
      { id: 'crack',      label: '균열 보수',           title: '균열 보수 보고서',        unit: '위치',     stage: '보수', icon: '🪨' },
      { id: 'demol',      label: '철거',                title: '철거 작업 보고서',        unit: '구역',     stage: '철거', icon: '🔨' },
      { id: 'safety',     label: '안전 점검',           title: '안전 점검 보고서',        unit: '구역',     stage: '점검', icon: '⛑️' },
      { id: 'insulation', label: '단열 시공',           title: '단열 시공 보고서',        unit: '구역',     stage: '시공', icon: '🧊' },
    ]
  },
  {
    id: 'insurance',
    label: '📋 보험/감정',
    items: [
      { id: 'auto_loss',  label: '차량 손해사정',       title: '차량 손해 조사 보고서',   unit: '차량',     stage: '조사', icon: '🚙' },
      { id: 'home_loss',  label: '주택 손해사정',       title: '주택 손해 조사 보고서',   unit: '구역',     stage: '조사', icon: '🏚️' },
      { id: 'fire',       label: '화재 피해 조사',      title: '화재 조사 보고서',        unit: '구역',     stage: '조사', icon: '🔥' },
      { id: 'flood',      label: '침수 피해 조사',      title: '침수 조사 보고서',        unit: '구역',     stage: '조사', icon: '🌊' },
      { id: 'leak_loss',  label: '누수 피해 조사',      title: '누수 조사 보고서',        unit: '위치',     stage: '조사', icon: '💦' },
      { id: 'theft',      label: '도난 피해',           title: '도난 조사 보고서',        unit: '품목',     stage: '조사', icon: '🚨' },
      { id: 'appraise',   label: '부동산 감정평가',     title: '감정평가 보고서',         unit: '매물',     stage: '평가', icon: '📋' },
    ]
  },
  {
    id: 'farm',
    label: '🌾 농업/시설',
    items: [
      { id: 'pesticide',  label: '병해충 방제',         title: '방제 작업 보고서',        unit: '구역',     stage: '방제', icon: '🌿' },
      { id: 'orchard',    label: '과수원 작업',         title: '과수원 작업 보고서',      unit: '구역',     stage: '작업', icon: '🍎' },
      { id: 'greenhouse', label: '시설하우스 점검',     title: '하우스 점검 보고서',      unit: '동',       stage: '점검', icon: '🌱' },
      { id: 'spray',      label: '농약 살포',           title: '농약 살포 보고서',        unit: '구역',     stage: '살포', icon: '🚿' },
    ]
  },
  {
    id: 'service',
    label: '✨ 기타 서비스',
    items: [
      { id: 'laundry',    label: '세탁(이불/소파)',     title: '세탁 작업 보고서',        unit: '품목',     stage: '세탁', icon: '👕' },
      { id: 'moving',     label: '포장이사 작업',       title: '이사 작업 보고서',        unit: '품목',     stage: '작업', icon: '📦' },
      { id: 'water',      label: '정수기/공기청정기',   title: '필터 교체 보고서',        unit: '제품',     stage: '교체', icon: '🚰' },
      { id: 'appliance',  label: '가전 수리',           title: '가전 수리 보고서',        unit: '제품',     stage: '수리', icon: '🔌' },
      { id: 'computer',   label: '컴퓨터 출장 수리',    title: 'PC 수리 보고서',          unit: 'PC',       stage: '수리', icon: '💻' },
      { id: 'pet',        label: '펫 그루밍/케어',      title: '펫 케어 보고서',          unit: '펫',       stage: '케어', icon: '🐶' },
      { id: 'errand',     label: '청소 대행/심부름',    title: '대행 작업 보고서',        unit: '건',       stage: '대행', icon: '🏃' },
    ]
  },
  {
    id: 'public',
    label: '🏛️ 공공/관리',
    items: [
      { id: 'public_chk', label: '지자체 시설 점검',    title: '시설 점검 보고서',        unit: '시설',     stage: '점검', icon: '🏛️' },
      { id: 'park',       label: '공원 관리',           title: '공원 관리 보고서',        unit: '구역',     stage: '관리', icon: '🌳' },
      { id: 'road',       label: '도로/가로등 보수',    title: '도로 보수 보고서',        unit: '위치',     stage: '보수', icon: '🚧' },
      { id: 'school',     label: '학교 시설 관리',      title: '학교 시설 보고서',        unit: '구역',     stage: '관리', icon: '🏫' },
    ]
  },
  {
    id: 'custom',
    label: '✏️ 기타 (직접 입력)',
    items: []
  }
];

// 대분류/소분류 ID로 항목 찾기
function findIndustryItem(majorId, minorId) {
  const major = INDUSTRIES.find(i => i.id === majorId);
  if (!major) return null;
  return major.items.find(it => it.id === minorId) || null;
}

/* ═══ 내 업종 (사용자 직접 추가) ═══ */
const MY_INDUSTRY_KEY = 'ac_my_industries';

function loadMyIndustries() {
  try {
    const arr = JSON.parse(localStorage.getItem(MY_INDUSTRY_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch(e) { return []; }
}

function saveMyIndustryItem(item) {
  const arr = loadMyIndustries();
  // 같은 title이면 갱신, 없으면 추가
  const idx = arr.findIndex(x => x.title === item.title);
  if (idx >= 0) arr[idx] = item;
  else arr.push(item);
  localStorage.setItem(MY_INDUSTRY_KEY, JSON.stringify(arr));
}

function deleteMyIndustryItem(id) {
  const arr = loadMyIndustries().filter(x => x.id !== id);
  localStorage.setItem(MY_INDUSTRY_KEY, JSON.stringify(arr));
}

// INDUSTRIES에 "내 업종" 카테고리를 동적으로 합쳐서 반환
function getIndustriesWithCustom() {
  const my = loadMyIndustries();
  const myCategory = {
    id: 'my',
    label: '⭐ 내 업종',
    items: my
  };
  // 내 업종이 있으면 맨 앞에, custom(직접입력)은 맨 뒤 유지
  if (my.length > 0) {
    return [myCategory, ...INDUSTRIES];
  }
  return INDUSTRIES;
}
