# 구글 플레이 구독 결제 연동 (RevenueCat) 가이드

앱 코드는 이미 연동해 두었습니다. 아래 **설정 3곳(RevenueCat · Play 콘솔 · 코드 상수)** 만 채우고 재빌드하면 실제 결제가 됩니다.
결제는 **앱(안드로이드)에서만** 동작합니다. 웹/PWA에서는 "문의로 수동 등급" 안내가 뜹니다.

---

## 0. 준비물
- Google Play Console 개발자 계정(이미 있음)
- RevenueCat 계정(무료로 가입: https://app.revenuecat.com )
- 앱이 Play Console에 등록되어 있어야 함(내부 테스트 트랙이라도 OK)

---

## 1. Play Console에서 구독 상품 4개 만들기
Play Console → 해당 앱 → **수익 창출 → 상품 → 구독** 에서 **구독 4개**를 만듭니다.
각 구독마다 **상품 ID**와 **기본 요금제(base plan)** · 가격을 설정합니다.

| 플랜 | 권장 상품 ID | 가격(월) |
|---|---|---|
| 팀원 | `manager_lite_monthly` | 4,900원 |
| 베이직 | `manager_basic_monthly` | 9,900원 |
| 프로 | `manager_pro_monthly` | 19,900원 |
| 마스터 | `manager_master_monthly` | 49,900원 |

- 상품 ID는 **한 번 정하면 못 바꿉니다.** 위 ID를 그대로 쓰면 코드 수정이 필요 없습니다.
- 각 구독을 **활성화**하고, 기본 요금제도 **활성화**하세요.
- (테스트를 위해) Play Console → 설정 → **라이선스 테스터**에 본인 지메일을 추가하면 실제 결제 없이 테스트됩니다.

---

## 2. RevenueCat 설정
### 2-1. 프로젝트 + 앱 연결
1. RevenueCat → **Create new project**.
2. 프로젝트에 **Play Store 앱 추가** → 패키지명 입력.
3. **Service Account** 연결: Google Cloud에서 서비스 계정 JSON 키를 만들어 업로드하고, Play Console에서 그 서비스 계정에 **재무 데이터 보기 / 주문 관리** 권한을 부여합니다. (RevenueCat 화면의 안내를 그대로 따르면 됩니다.)

### 2-2. Products(상품) 가져오기
- RevenueCat → **Products** → Play에서 만든 구독 4개를 Import/추가합니다. (상품 ID가 위와 동일해야 함)

### 2-3. Entitlements(자격) 만들기 — **중요**
- RevenueCat → **Entitlements** 에서 4개 생성: 식별자를 정확히 **`lite` / `basic` / `pro` / `master`** 로.
- 각 Entitlement에 해당 상품을 연결:
  - `lite` ← `manager_lite_monthly`
  - `basic` ← `manager_basic_monthly`
  - `pro` ← `manager_pro_monthly`
  - `master` ← `manager_master_monthly`
- (원하면 상위 플랜이 하위 기능도 포함하도록 상품을 여러 Entitlement에 연결해도 됩니다. 코드는 master > pro > basic > lite 순으로 가장 높은 것을 적용합니다.)

### 2-4. Offering(진열) 만들기
- RevenueCat → **Offerings** → `default` 오퍼링에 위 4개 상품을 **Package**로 추가합니다.
- 코드가 `current` 오퍼링의 패키지에서 상품 ID로 찾습니다.

### 2-5. API 키
- RevenueCat → **Project settings → API keys** → **Google용 공개 키**(`goog_...`)를 복사.

---

## 3. 코드 상수 채우기
`www/js/billing.js` 상단의 3개 상수를 채웁니다.

```js
var RC_API_KEY = 'goog_여기에_복사한_키';
var PLAN_PRODUCTS = {
  lite:   'manager_lite_monthly',
  basic:  'manager_basic_monthly',
  pro:    'manager_pro_monthly',
  master: 'manager_master_monthly'
};
var PLAN_ENTITLEMENTS = { lite: 'lite', basic: 'basic', pro: 'pro', master: 'master' };
```

- Play 상품 ID를 다른 이름으로 만들었다면 `PLAN_PRODUCTS` 값을 그 ID로 바꾸세요.
- Entitlement 식별자를 다르게 만들었다면 `PLAN_ENTITLEMENTS` 값을 맞추세요.

---

## 4. 플러그인 설치 + 빌드
프로젝트 루트(안드로이드 프로젝트 폴더)에서:

```bash
npm install @revenuecat/purchases-capacitor
npx cap sync
```

그다음 Android Studio에서 재빌드 → 내부 테스트로 업로드/설치.

> 참고: 이 앱은 번들러 없이 `<script>`로 JS를 불러옵니다. billing.js는 RevenueCat 플러그인을
> `window.Purchases` 또는 `Capacitor.Plugins.Purchases`(자동 등록)로 찾습니다. `npx cap sync` 후
> 크롬 원격 디버깅 콘솔에서 `Capacitor.Plugins` 에 Purchases가 보이는지 한 번 확인하세요.
> 만약 결제 호출이 안 되면 알려주세요 — 플러그인 로딩 방식만 살짝 조정하면 됩니다.

---

## 5. 동작 방식(참고)
- 앱 실행 시 `Billing.init()` 이 RevenueCat을 초기화하고, 로그인 사용자(uid)와 연결합니다.
- 설정 → ⭐구독 → **요금제 보기**에서 각 플랜의 **"구독하기"** 버튼 → 구글 결제창 → 완료.
- 결제 완료/복원 시 활성 **Entitlement**를 읽어 `Subs.setBillingPlan()` 으로 플랜을 반영합니다.
  즉, **결제 상태가 곧 플랜**입니다(별도 서버 없이). 관리자(admin)·수동 지정·쿠폰은 그대로 병행됩니다.
- "구매 복원", "구독 관리"(플레이 구독 페이지) 링크도 요금제 창에 있습니다.

---

## 6. 테스트 체크리스트
- [ ] Play 구독 4개 + 기본요금제 활성화, 상품 ID 확인
- [ ] RevenueCat: 서비스계정 연결 · Products · Entitlements(lite/basic/pro/master) · default Offering
- [ ] billing.js 에 API 키/상품ID/entitlement 입력
- [ ] `npm i @revenuecat/purchases-capacitor` → `npx cap sync` → 재빌드
- [ ] 라이선스 테스터 계정으로 내부 테스트에서 구독 → 자동으로 플랜 반영되는지 확인
- [ ] "구매 복원" 동작 확인
- [ ] **팀원 플랜**: 초대 코드로 팀 **참여**는 되고, 팀 **만들기**는 막히는지 확인
- [ ] **팀원 플랜**: AI 일정등록/글작성이 무료 지급분(일정 30·글 5)만 쓰이는지 확인

문의: bsc500327@gmail.com
