---
layout      : concept
title       : 이벤트 트래킹 설계
date        : 2026-06-29 00:00:00 +0900
updated     : 2026-06-29 00:00:00 +0900
tag         : data-analytics event-tracking
toc         : true
comment     : true
latex       : true
status      : complete
public      : true
parent      : [[/data-analytics]]
confidence  : high
relations:
  - { type: extends, target: concept/data-analytics/01_behavioral_analytics_techniques }
---

* TOC
{:toc}

리텐션, 코호트, RFM, A/B 테스트, 경로 분석 — 이 모든 기법은 이벤트 데이터 위에 서 있다. 이벤트가 잘못 설계되면 분석 기법이 아무리 정교해도 결론을 신뢰할 수 없다. 잘못 설계된 이벤트 스키마는 사후 변경 비용이 크기 때문에, 이벤트 설계는 분석 신뢰성의 전제다.

---

## 이벤트란 무엇인가

이벤트는 **특정 시점에 발생한 사실의 기록**이다. 사용자가 버튼을 눌렀다, 페이지를 봤다, 결제를 완료했다 — 이 사실들이 각각 하나의 이벤트다.

이벤트의 본질적인 속성은 두 가지다:
- **불변성**: 이미 발생한 사실이므로 수정할 수 없다 (append-only)
- **원자성**: 하나의 이벤트는 하나의 사실만 담는다

이 두 속성이 무너지는 순간 이벤트 데이터 전체의 신뢰성이 흔들린다.

---

## 이벤트의 세 가지 유형

| 유형 | 정의 | 예시 |
|---|---|---|
| **Screen View** | 화면/페이지 진입 | `screen_viewed`, `page_viewed` |
| **User Action** | 사용자가 직접 발생시킨 행동 | `button_clicked`, `search_performed`, `item_added_to_cart` |
| **System Event** | 시스템이 자동으로 발생시킨 사건 | `notification_received`, `session_timeout`, `payment_processed` |

분류가 중요한 이유: **Screen View는 노출 데이터**, **User Action은 의도 데이터**다. 두 유형을 섞으면 "봤는가"와 "행동했는가"를 구분할 수 없게 된다.

### 실제 이벤트 데이터 샘플 (배달 앱)

주문 완료 이벤트가 실제로 어떻게 생겼는지 보면 스키마 설계 의도가 명확해진다.

```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "event_name": "order_completed",
  "event_time": "2026-06-29T14:32:10.123Z",
  "received_at": "2026-06-29T14:32:11.045Z",
  "user_id": "usr_12345",
  "anonymous_id": "anon_abc9f3e2",
  "session_id": "sess_d4e5f6a7",
  "platform": "ios",
  "device_type": "mobile",
  "app_version": "5.2.1",
  "country": "KR",
  "properties": {
    "order_id": "ord_99887766",
    "restaurant_id": "rst_4521",
    "restaurant_name": "맛있는 치킨",
    "category": "치킨",
    "order_amount": 22000,
    "delivery_fee": 3000,
    "coupon_discount": 2000,
    "final_amount": 23000,
    "payment_method": "kakao_pay",
    "items": [
      { "item_id": "itm_001", "item_name": "후라이드 치킨", "qty": 1, "price": 18000 },
      { "item_id": "itm_002", "item_name": "콜라 1.5L",    "qty": 1, "price": 2000  },
      { "item_id": "itm_003", "item_name": "양념소스",      "qty": 2, "price": 1000  }
    ],
    "source": "home_banner",
    "is_reorder": false,
    "estimated_delivery_min": 35
  }
}
```

주목할 설계 결정:
- `event_time`과 `received_at`이 약 1초 차이 → 네트워크 지연. 클라이언트 시계가 틀렸을 때 구분 기준이 된다
- `order_amount`(음식값 합계)와 `final_amount`(배달비 포함, 쿠폰 적용 후)를 분리 → 합쳐서 저장하면 나중에 쿠폰 효과나 배달비 민감도를 분석할 수 없다
- `items` 배열을 JSON에 넣음 → 주문 단위 분석은 `properties` 파싱, 전체 통계는 컬럼 기준으로 집계 가능

---

## 이벤트 스키마 설계

### 표준 스키마 (BigQuery 기준)

```sql
CREATE TABLE IF NOT EXISTS `project.dataset.events` (
  -- 식별자
  event_id        STRING NOT NULL,     -- UUID, 중복 제거 기준
  event_name      STRING NOT NULL,     -- 이벤트 이름 (네이밍 컨벤션 참고)
  event_time      TIMESTAMP NOT NULL,  -- 클라이언트 발생 시각
  received_at     TIMESTAMP NOT NULL,  -- 서버 수신 시각

  -- 사용자
  user_id         STRING,              -- 로그인 사용자 (nullable)
  anonymous_id    STRING NOT NULL,     -- 비로그인 포함 모든 사용자

  -- 세션
  session_id      STRING NOT NULL,

  -- 환경
  platform        STRING,              -- ios | android | web
  device_type     STRING,              -- mobile | tablet | desktop
  app_version     STRING,
  os_version      STRING,
  country         STRING,
  language        STRING,

  -- 이벤트별 데이터
  properties      JSON                 -- 이벤트 특화 프로퍼티
)
PARTITION BY DATE(event_time)
CLUSTER BY event_name, user_id;
```

### 공통 프로퍼티 vs 이벤트 특화 프로퍼티

| 구분 | 저장 위치 | 설명 |
|---|---|---|
| 공통 프로퍼티 | 컬럼으로 분리 | 모든 이벤트에 공통 — `user_id`, `session_id`, `platform` |
| 이벤트 특화 프로퍼티 | `properties` JSON | 특정 이벤트에만 있는 값 — `product_id`, `search_query`, `payment_amount` |

공통 프로퍼티를 JSON에 묻어두면 쿼리할 때마다 JSON 파싱이 필요하다. 자주 쓰는 필드는 반드시 컬럼으로 분리한다.

---

## 네이밍 컨벤션

### `<object>_<action>` 패턴

```
✓ product_viewed      ← 명사_과거형동사
✓ cart_item_added
✓ order_completed
✓ search_performed

✗ viewProduct         ← camelCase
✗ click_button        ← 너무 모호, 어떤 버튼?
✗ page_view           ← 현재형 (과거형 통일)
✗ purchase            ← 동사만 (목적어 없음)
```

**왜 과거형인가**: 이벤트는 이미 발생한 사실의 기록이다. `order_completed`는 "주문이 완료됐다"는 사실을 담고, `order_complete`는 상태처럼 읽힌다.

### 계층 구조가 있는 이벤트

단계가 있는 플로우는 이름에 계층을 반영한다:

```
checkout_started
checkout_step_viewed        (properties: { step: "address" | "payment" | "review" })
checkout_step_completed
checkout_order_completed
checkout_order_failed
```

이렇게 하면 `event_name LIKE 'checkout_%'`만으로 결제 플로우 전체를 조회할 수 있다.

---

## 트래킹 플랜

트래킹 플랜은 **어떤 이벤트를 언제, 어디서, 어떤 프로퍼티와 함께 수집할지 정의한 문서**다. 코드보다 먼저 작성하고, 분석팀·개발팀·기획팀이 공유한다.

### 트래킹 플랜 최소 항목

| 항목 | 설명 | 예시 |
|---|---|---|
| `event_name` | 표준 네이밍에 맞는 이름 | `product_viewed` |
| `trigger` | 어떤 상황에서 발생하는가 | 상품 상세 페이지 진입 시 |
| `properties` | 이벤트에 포함할 필드 목록 | `product_id`, `product_name`, `category`, `price` |
| `platform` | 어느 플랫폼에서 수집하는가 | iOS, Android, Web |
| `owner` | 담당 팀/개발자 | 커머스팀 |
| `status` | 구현 상태 | `planned` / `implemented` / `deprecated` |

```markdown
## product_viewed

**트리거**: 상품 상세 페이지(PDP)에 진입했을 때
**플랫폼**: iOS, Android, Web

| 프로퍼티 | 타입 | 필수 | 설명 |
|---|---|---|---|
| product_id | STRING | ✓ | 상품 고유 ID |
| product_name | STRING | ✓ | 상품명 |
| category | STRING | ✓ | 1단계 카테고리 |
| subcategory | STRING | — | 2단계 카테고리 |
| price | FLOAT | ✓ | 노출 가격 (할인 적용 후) |
| source | STRING | ✓ | 유입 경로 (search, home, recommendation) |
```

### 실제 트래킹 플랜 — 배달 앱 주문 플로우

배달 앱의 홈 → 음식점 → 주문 완료 플로우를 트래킹 플랜으로 정리하면:

| 이벤트 | 트리거 | 핵심 프로퍼티 |
|---|---|---|
| `restaurant_list_viewed` | 음식점 목록 화면 진입 | `sort_by`, `filter_category`, `location_type` |
| `restaurant_detail_viewed` | 음식점 상세 화면 진입 | `restaurant_id`, `source` (list/search/banner) |
| `menu_item_viewed` | 메뉴 상세 팝업 오픈 | `restaurant_id`, `item_id`, `price` |
| `cart_item_added` | 메뉴 담기 탭 | `item_id`, `qty`, `price`, `cart_total` |
| `order_checkout_started` | 주문하기 버튼 탭 | `cart_total`, `item_count`, `restaurant_id` |
| `order_checkout_step_viewed` | 결제 단계 화면 진입 | `step` (address/payment/review) |
| `order_completed` | 주문 서버 응답 성공 | `order_id`, `final_amount`, `payment_method`, `items[]` |
| `order_failed` | 주문 서버 응답 실패 | `order_id`, `error_code`, `payment_method` |

이 8개 이벤트만으로 전체 주문 퍼널을 완전히 추적할 수 있다. 퍼널 단계별 이탈율 쿼리:

```sql
WITH funnel AS (
  SELECT
    session_id,
    MAX(CASE WHEN event_name = 'restaurant_list_viewed'   THEN 1 ELSE 0 END) AS step1,
    MAX(CASE WHEN event_name = 'restaurant_detail_viewed' THEN 1 ELSE 0 END) AS step2,
    MAX(CASE WHEN event_name = 'cart_item_added'          THEN 1 ELSE 0 END) AS step3,
    MAX(CASE WHEN event_name = 'order_checkout_started'   THEN 1 ELSE 0 END) AS step4,
    MAX(CASE WHEN event_name = 'order_completed'          THEN 1 ELSE 0 END) AS step5
  FROM events
  WHERE DATE(event_time) = CURRENT_DATE() - 1
  GROUP BY session_id
)
SELECT
  SUM(step1)                              AS list_view,
  SUM(step2)                              AS detail_view,
  SUM(step3)                              AS cart_add,
  SUM(step4)                              AS checkout_start,
  SUM(step5)                              AS order_done,
  ROUND(SUM(step2) / NULLIF(SUM(step1), 0), 3) AS list_to_detail,
  ROUND(SUM(step3) / NULLIF(SUM(step2), 0), 3) AS detail_to_cart,
  ROUND(SUM(step4) / NULLIF(SUM(step3), 0), 3) AS cart_to_checkout,
  ROUND(SUM(step5) / NULLIF(SUM(step4), 0), 3) AS checkout_to_done
FROM funnel
```

실제 이 쿼리에서 `detail_to_cart`가 갑자기 전날 대비 30% 낮아졌다면, `menu_item_viewed` 볼륨도 같이 줄었는지 확인한다. 트래킹 코드 누락인지, 실제 UX 문제인지 구분하는 첫 번째 체크포인트다.

---

## 흔한 실수 7가지

### 1. 클라이언트 시각을 event_time으로만 사용

클라이언트 시계는 틀릴 수 있다. 사용자 기기 시각이 과거 또는 미래로 설정돼 있으면 이벤트 순서가 뒤집힌다.

**해결**: `event_time`(클라이언트)과 `received_at`(서버)을 모두 저장한다. 분석에는 `received_at` 기준을 기본으로 쓰되, 오프라인 이벤트는 `event_time` 기준으로 별도 처리한다.

### 2. 중복 이벤트 미처리

네트워크 재시도, 클라이언트 재전송으로 같은 이벤트가 여러 번 들어온다.

```sql
-- 중복 제거: event_id 기준 dedup
SELECT *
FROM events
WHERE TRUE
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY event_id
  ORDER BY received_at ASC
) = 1
```

`event_id`는 클라이언트에서 UUID로 생성한다. 서버에서 생성하면 재전송 시 다른 ID가 붙는다.

### 3. 프로퍼티 타입 불일치

같은 `price` 필드가 어떤 이벤트에서는 `"9900"` (string), 다른 이벤트에서는 `9900` (number)으로 들어온다.

**해결**: 트래킹 플랜에 타입을 명시하고, 수집 시 스키마 검증을 넣는다.

### 4. PII(개인식별정보) 프로퍼티 포함

이메일, 전화번호, 이름이 `properties`에 실수로 들어가는 경우.

**해결**: 수집 파이프라인에 PII 탐지 필터를 추가한다. 최소한 이벤트 스키마 리뷰 프로세스에 보안 검토를 포함한다.

### 5. 하나의 이벤트에 여러 사실 담기

```
✗ checkout_step_viewed_and_completed  ← 두 가지 사실
✓ checkout_step_viewed
✓ checkout_step_completed             ← 각각 분리
```

하나의 이벤트에 여러 사실을 담으면 집계가 모호해진다.

### 6. 이벤트 이름 중간에 바꾸기

`button_clicked` → `cta_clicked`으로 이름을 바꾸면 기간별 비교가 불가능해진다.

**해결**: 기존 이벤트는 `deprecated` 처리하고, 새 이름의 이벤트를 병행 수집한다. 완전히 전환한 후 deprecated 이벤트 수집을 중단한다.

**실제 사례**: 한 팀이 `click_order_button`을 더 명확한 `order_checkout_started`로 변경했다. 변경 자체는 맞는 결정이었지만 병행 수집 없이 즉시 교체하면서 시계열 그래프에 3월 10일부터 데이터가 끊겼다. 이후 월간 리포트에서 "3월 체크아웃 이탈 급증"으로 오독됐다.

이름 변경 전후를 합산하는 뷰를 반드시 만든다:

```sql
-- 이름 변경 전후를 합산하는 호환 쿼리
-- click_order_button: ~2026-03-14 (deprecated)
-- order_checkout_started: 2026-03-10~ (4일 병행 수집 후 전환)
SELECT
  DATE(event_time) AS date,
  COUNT(*)         AS checkout_started
FROM events
WHERE event_name IN ('click_order_button', 'order_checkout_started')
GROUP BY 1
ORDER BY 1
```

### 7. 세션 ID 없이 수집

세션 ID가 없으면 경로 분석, 세션별 집계, 퍼널 분석이 불가능하다. 세션 ID는 이벤트 스키마의 필수 필드다.

---

## 데이터 품질 검증

### 볼륨 모니터링

```sql
-- 이벤트별 시간당 볼륨 추이 (급감/급증 탐지)
SELECT
  event_name,
  DATE_TRUNC(received_at, HOUR) AS hour,
  COUNT(*) AS event_count
FROM events
WHERE received_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
GROUP BY 1, 2
ORDER BY 1, 2
```

볼륨이 평소 대비 50% 이상 급감하면 클라이언트 트래킹 코드가 누락됐을 가능성이 높다.

### 필수 필드 누락 탐지

```sql
-- 필수 프로퍼티 누락 이벤트 비율
SELECT
  event_name,
  COUNTIF(JSON_VALUE(properties, '$.product_id') IS NULL) AS missing_product_id,
  COUNT(*) AS total,
  COUNTIF(JSON_VALUE(properties, '$.product_id') IS NULL) / COUNT(*) AS missing_rate
FROM events
WHERE event_name = 'product_viewed'
  AND DATE(received_at) = CURRENT_DATE() - 1
GROUP BY 1
```

### 중복 이벤트 비율

```sql
SELECT
  COUNT(*) AS total_events,
  COUNT(DISTINCT event_id) AS unique_events,
  1 - COUNT(DISTINCT event_id) / COUNT(*) AS duplicate_rate
FROM events
WHERE DATE(received_at) = CURRENT_DATE() - 1
```

---

## 전체 체크리스트

**스키마 설계**
- `event_id` (UUID)로 중복 제거 가능한가?
- `event_time`과 `received_at`을 모두 저장하는가?
- `user_id`와 `anonymous_id`를 분리했는가?
- `session_id`를 포함하는가?
- `properties`에 PII가 포함되지 않는가?

**네이밍**
- `<object>_<action>` 패턴을 따르는가?
- 동사는 과거형인가?
- 계층이 있는 플로우는 prefix를 공유하는가?

**트래킹 플랜**
- 모든 이벤트에 trigger 조건이 명시됐는가?
- 프로퍼티 타입이 명시됐는가?
- 필수/선택 구분이 명시됐는가?
- 담당자가 지정됐는가?

**운영**
- 볼륨 모니터링이 있는가?
- 스키마 변경 프로세스(deprecated → 신규 병행 수집 → 전환)가 있는가?
- PII 탐지 필터가 파이프라인에 포함됐는가?
