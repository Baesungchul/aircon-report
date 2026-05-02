/* ═══════════════════════════════════════════════
   업종 분류 (대분류 → 소분류 → 기본 호칭)
═══════════════════════════════════════════════ */

const INDUSTRIES = [
  {
    id: 'cleaning',
    label: '🧼 시설 관리/청소',
    items: [
      { id: 'aircon',     label: '에어컨 청소',         title: '에어컨 청소 보고서',      unit: '호수',     stage: '청소' },
      { id: 'boiler',     label: '보일러/배관 청소',    title: '배관 청소 보고서',        unit: '현장',     stage: '청소' },
      { id: 'tank',       label: '물탱크 청소',         title: '물탱크 청소 보고서',      unit: '탱크',     stage: '청소' },
      { id: 'duct',       label: '환풍기/덕트 청소',    title: '덕트 청소 보고서',        unit: '구역',     stage: '청소' },
      { id: 'office',     label: '사무실 청소',         title: '사무실 청소 보고서',      unit: '구역',     stage: '청소' },
      { id: 'movein',     label: '입주 청소',           title: '입주 청소 보고서',        unit: '방',       stage: '청소' },
      { id: 'grout',      label: '줄눈/타일 시공',      title: '줄눈 시공 보고서',        unit: '구역',     stage: '시공' },
      { id: 'mold',       label: '곰팡이 제거',         title: '곰팡이 제거 보고서',      unit: '구역',     stage: '제거' },
      { id: 'waterproof', label: '베란다/옥상 방수',    title: '방수 시공 보고서',        unit: '구역',     stage: '시공' },
      { id: 'exterior',   label: '외벽 청소',           title: '외벽 청소 보고서',        unit: '구역',     stage: '청소' },
      { id: 'carpet',     label: '카펫/매트리스 청소',  title: '카펫 청소 보고서',        unit: '품목',     stage: '청소' },
      { id: 'sterile',    label: '살균 소독',           title: '살균 소독 보고서',        unit: '구역',     stage: '소독' },
      { id: 'pest',       label: '방역(해충/쥐)',       title: '방역 작업 보고서',        unit: '구역',     stage: '방역' },
    ]
  },
  {
    id: 'construction',
    label: '🔧 설비/시공',
    items: [
      { id: 'wallpaper',  label: '도배·장판',           title: '도배 시공 보고서',        unit: '현장',     stage: '시공' },
      { id: 'paint',      label: '도색·페인트',         title: '도색 작업 보고서',        unit: '현장',     stage: '도색' },
      { id: 'interior',   label: '인테리어/리모델링',   title: '인테리어 시공 보고서',    unit: '공간',     stage: '시공' },
      { id: 'floor',      label: '마루 시공',           title: '마루 시공 보고서',        unit: '공간',     stage: '시공' },
      { id: 'bathroom',   label: '욕실 리모델링',       title: '욕실 리모델링 보고서',    unit: '욕실',     stage: '시공' },
      { id: 'kitchen',    label: '싱크대/주방 교체',    title: '주방 시공 보고서',        unit: '주방',     stage: '시공' },
      { id: 'window',     label: '창호/방충망 시공',    title: '창호 시공 보고서',        unit: '창호',     stage: '시공' },
      { id: 'blind',      label: '블라인드/커튼',       title: '블라인드 시공 보고서',    unit: '창',       stage: '시공' },
      { id: 'electric',   label: '전기 공사',           title: '전기 공사 보고서',        unit: '구역',     stage: '시공' },
      { id: 'cctv',       label: 'CCTV/통신 설치',      title: 'CCTV 설치 보고서',        unit: '카메라',   stage: '설치' },
      { id: 'doorlock',   label: '도어락 시공',         title: '도어락 설치 보고서',      unit: '문',       stage: '설치' },
      { id: 'aircon_inst',label: '에어컨 설치',         title: '에어컨 설치 보고서',      unit: '호수',     stage: '설치' },
      { id: 'boiler_inst',label: '보일러 설치/수리',    title: '보일러 시공 보고서',      unit: '현장',     stage: '시공' },
    ]
  },
  {
    id: 'auto',
    label: '🚗 자동차/장비',
    items: [
      { id: 'repair',     label: '자동차 정비',         title: '차량 정비 보고서',        unit: '차량',     stage: '정비' },
      { id: 'detailing',  label: '광택/디테일링',       title: '광택 작업 보고서',        unit: '차량',     stage: '작업' },
      { id: 'tinting',    label: '썬팅',                title: '썬팅 시공 보고서',        unit: '차량',     stage: '시공' },
      { id: 'paint_car',  label: '자동차 도색',         title: '도색 작업 보고서',        unit: '차량',     stage: '도색' },
      { id: 'engine',     label: '엔진룸 청소',         title: '엔진룸 청소 보고서',      unit: '차량',     stage: '청소' },
      { id: 'headlight',  label: '헤드라이트 복원',     title: '헤드라이트 복원 보고서',  unit: '차량',     stage: '복원' },
      { id: 'wheel',      label: '휠 복원/광택',        title: '휠 복원 보고서',          unit: '차량',     stage: '복원' },
      { id: 'heavy',      label: '중장비/농기계 정비',  title: '장비 정비 보고서',        unit: '장비',     stage: '정비' },
    ]
  },
  {
    id: 'realestate',
    label: '🏠 부동산/임대',
    items: [
      { id: 'movein_chk', label: '원룸/빌라 입퇴실 점검', title: '입퇴실 점검 보고서',    unit: '호수',     stage: '점검' },
      { id: 'mgmt',       label: '아파트/빌라 관리',    title: '시설 점검 보고서',        unit: '구역',     stage: '점검' },
      { id: 'broker',     label: '부동산 중개 사진',    title: '매물 사진 보고서',        unit: '매물',     stage: '점검' },
      { id: 'airbnb',     label: '에어비앤비 청소',     title: '숙소 청소 보고서',        unit: '객실',     stage: '청소' },
      { id: 'deposit',    label: '임대 보증금 산정',    title: '보증금 산정 보고서',      unit: '호수',     stage: '점검' },
    ]
  },
  {
    id: 'building',
    label: '🏗️ 건축/공사',
    items: [
      { id: 'repair_b',   label: '건물 보수',           title: '건물 보수 보고서',        unit: '구역',     stage: '보수' },
      { id: 'leak',       label: '누수 탐지/수리',      title: '누수 수리 보고서',        unit: '위치',     stage: '수리' },
      { id: 'crack',      label: '균열 보수',           title: '균열 보수 보고서',        unit: '위치',     stage: '보수' },
      { id: 'demol',      label: '철거',                title: '철거 작업 보고서',        unit: '구역',     stage: '철거' },
      { id: 'safety',     label: '안전 점검',           title: '안전 점검 보고서',        unit: '구역',     stage: '점검' },
      { id: 'insulation', label: '단열 시공',           title: '단열 시공 보고서',        unit: '구역',     stage: '시공' },
    ]
  },
  {
    id: 'insurance',
    label: '📋 보험/감정',
    items: [
      { id: 'auto_loss',  label: '차량 손해사정',       title: '차량 손해 조사 보고서',   unit: '차량',     stage: '조사' },
      { id: 'home_loss',  label: '주택 손해사정',       title: '주택 손해 조사 보고서',   unit: '구역',     stage: '조사' },
      { id: 'fire',       label: '화재 피해 조사',      title: '화재 조사 보고서',        unit: '구역',     stage: '조사' },
      { id: 'flood',      label: '침수 피해 조사',      title: '침수 조사 보고서',        unit: '구역',     stage: '조사' },
      { id: 'leak_loss',  label: '누수 피해 조사',      title: '누수 조사 보고서',        unit: '위치',     stage: '조사' },
      { id: 'theft',      label: '도난 피해',           title: '도난 조사 보고서',        unit: '품목',     stage: '조사' },
      { id: 'appraise',   label: '부동산 감정평가',     title: '감정평가 보고서',         unit: '매물',     stage: '평가' },
    ]
  },
  {
    id: 'farm',
    label: '🌾 농업/시설',
    items: [
      { id: 'pesticide',  label: '병해충 방제',         title: '방제 작업 보고서',        unit: '구역',     stage: '방제' },
      { id: 'orchard',    label: '과수원 작업',         title: '과수원 작업 보고서',      unit: '구역',     stage: '작업' },
      { id: 'greenhouse', label: '시설하우스 점검',     title: '하우스 점검 보고서',      unit: '동',       stage: '점검' },
      { id: 'spray',      label: '농약 살포',           title: '농약 살포 보고서',        unit: '구역',     stage: '살포' },
    ]
  },
  {
    id: 'service',
    label: '✨ 기타 서비스',
    items: [
      { id: 'laundry',    label: '세탁(이불/소파)',     title: '세탁 작업 보고서',        unit: '품목',     stage: '세탁' },
      { id: 'moving',     label: '포장이사 작업',       title: '이사 작업 보고서',        unit: '품목',     stage: '작업' },
      { id: 'water',      label: '정수기/공기청정기',   title: '필터 교체 보고서',        unit: '제품',     stage: '교체' },
      { id: 'appliance',  label: '가전 수리',           title: '가전 수리 보고서',        unit: '제품',     stage: '수리' },
      { id: 'computer',   label: '컴퓨터 출장 수리',    title: 'PC 수리 보고서',          unit: 'PC',       stage: '수리' },
      { id: 'pet',        label: '펫 그루밍/케어',      title: '펫 케어 보고서',          unit: '펫',       stage: '케어' },
      { id: 'errand',     label: '청소 대행/심부름',    title: '대행 작업 보고서',        unit: '건',       stage: '대행' },
    ]
  },
  {
    id: 'public',
    label: '🏛️ 공공/관리',
    items: [
      { id: 'public_chk', label: '지자체 시설 점검',    title: '시설 점검 보고서',        unit: '시설',     stage: '점검' },
      { id: 'park',       label: '공원 관리',           title: '공원 관리 보고서',        unit: '구역',     stage: '관리' },
      { id: 'road',       label: '도로/가로등 보수',    title: '도로 보수 보고서',        unit: '위치',     stage: '보수' },
      { id: 'school',     label: '학교 시설 관리',      title: '학교 시설 보고서',        unit: '구역',     stage: '관리' },
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
