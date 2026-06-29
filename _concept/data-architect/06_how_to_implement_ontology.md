---
layout      : concept
title       : 알람 케이스로 온톨로지 훑어보기
date        : 2026-06-23 00:00:00 +0900
updated     : 2026-06-29 00:00:00 +0900
tag         : data-architecture data-engineering ontology palantir
toc         : true
comment     : true
latex       : true
status      : complete
public      : true
parent      : [[/data-architect]]
confidence  : high
relations:
  - { type: extends, target: concept/data-architect/04_what_is_ontology }
  - { type: implements, target: concept/data-architect/05_ontology_objects_summary }
---

> [[/data-architect/04_what_is_ontology]] 에서 온톨로지를 **객체(명사)·링크(관계)·액션(동사)** 세 계층과, 그 위에 올라타는 **시간(Dynamic)** 차원으로 설명했다. 이 글은 가상의 B2C 이커머스 케이스를 통해, 그 개념들이 실제 데이터 문제 안에서 어떻게 맞물리는지를 보여준다.

---

## 팔란티어 온톨로지 언어로 읽는 이 글

이 글에서 BigQuery SQL로 구현하는 것들은 팔란티어 파운드리의 온톨로지 언어로 부르면 다음과 같다. 두 언어를 나란히 두면 개념이 더 또렷해진다.

| 이 글의 BigQuery 구현 | 팔란티어 온톨로지 개념 | 역할 |
|----------------------|---------------------|------|
| `customers` 테이블 + `canonical_id` | **Object Type** + Primary Key | 비즈니스 개체의 정의와 식별 |
| `customer_identity` 매핑 | Entity Resolution | 여러 소스 ID → 하나의 Object |
| `display_name`, `created_at` | **Property** (Scalar) | 개체가 갖는 값 |
| `days_since_last_purchase` | **Derived Property** | 런타임 계산값 (저장 안 함) |
| `links` 테이블 (`placed`) | **Link Type** | 객체 간 관계 |
| `prop_def` 테이블 | Property Definition (SCD2) | 정의에 이력을 붙임 |
| `action_def` + precondition | **Action Type** (Parameters + Validation Rules) | 허용된 행위의 계약 |
| `action_log` | Action 실행 이력 + **Dynamic Layer** 피드백 소스 |
| 847명 집합 쿼리 | **Object Set** | 조건을 만족하는 객체 컬렉션 |
| 에이전트 쿼리 인터페이스 | Ontology API | 행위자가 온톨로지를 호출하는 방법 |

---

## 케이스 설정: 마켓온

이 글에서 사용하는 사례는 가상의 B2C 이커머스 서비스 **마켓온**이다. 온라인(CRM)과 오프라인(POS) 두 채널을 운영하며, ML 기반 이탈 예측 모델과 CS 쿠폰 자동화 시스템을 갖추고 있다.

| 시스템 | 역할 | 고객 식별자 |
|--------|------|-----------|
| CRM | 웹/앱 주문·회원 관리 | `user_id` (예: `U-29182`) |
| POS | 오프라인 매장 결제 | `member_no` (예: `M-00991`) |
| 이탈 예측 모델 | CRM 데이터 기반 이탈 확률 산출 | CRM `user_id` 기준 |
| CS 자동화 | 이탈 확률 임계값 초과 시 쿠폰 자동 발송 | — |

## 시나리오: 이탈 오분류

이 케이스의 대표적인 오류 패턴이다.

이탈 예측 모델이 VIP 고객 K씨(`user_id: U-29182`, 이탈 확률 0.87)를 위험군으로 분류했고, CS 자동화 시스템이 2만원 쿠폰을 즉시 발송했다. K씨는 쿠폰을 받아 당일 웹에서 주문했다. 지표상으로는 이탈 방어 성공처럼 보인다.

오프라인 채널을 조회하면 다른 그림이 나온다.

```sql
SELECT purchase_date, amount, store_name
FROM `marketeon.pos.purchases`
WHERE member_no = 'M-00991'
ORDER BY purchase_date DESC LIMIT 3;
```

```
purchase_date | amount  | store_name
2024-12-08    | 512,000 | 강남점
2024-11-21    |  89,000 | 강남점
2024-10-14    | 234,000 | 홍대점
```

이틀 전 오프라인 매장에서 51만 원을 결제한 상태였다. 이탈이 아닌 채널 전환이었다.

이 케이스에서 드러나는 문제는 네 가지다.

---

## 해부: 네 가지가 동시에 없었다

### 1. Identity 부재 — K씨가 두 사람이었다

CRM의 `U-29182`와 POS의 `M-00991`이 같은 사람이라는 사실을 어떤 시스템도 알지 못했다. 이탈 모델은 CRM 회원 테이블만 학습했다.

### 2. Link 부재 — 구매가 관계가 아니라 이벤트였다

모델이 계산한 `last_purchase_at`은 `crm.orders.MAX(order_date)`였다. "K씨가 구매한 주문들 중 가장 최근"이 아니라 "CRM에서 user_id = U-29182인 주문들 중 가장 최근"이었다. POS 주문은 이 조인 바깥에 있었다.

```sql
-- 모델이 본 피처
SELECT MAX(order_date) AS last_purchase_at
FROM `marketeon.crm.orders`
WHERE user_id = 'U-29182';
-- 결과: 2024-09-15  ← 틀림
```

### 3. Action Guard 부재 — 쿠폰이 조건 없이 날아갔다

CS 자동화 시스템은 이탈 확률이 임계값을 넘으면 쿠폰 발송 함수를 바로 호출했다. "이 고객에게 지금 쿠폰을 발송해도 되는가"를 묻는 게이트가 없었다. 허용된 행위의 범위가 코드 안에 묻혀 있었고, 누구도 그 범위를 데이터로 볼 수 없었다.

### 4. Definition 부재 — "마지막 구매"의 의미가 어디에도 적혀 있지 않았다

모델 카드에는 `last_purchase_at: 마지막 구매일`이라고만 적혀 있었다. 웹 기준인지 전채널 기준인지, 주문 접수 기준인지 결제 완료 기준인지. 이 모호함이 묵인된 채 3년이 흘렀다.

---

## 잠깐 — 시맨틱 레이어로 해결됐을까?

이 케이스에서 자주 나오는 질문이 있다. "dbt semantic layer에 GMV metric이 있었는데, 그게 이 문제를 막을 수 있지 않았나?"

답은 **아니다**.

마켓온에는 이미 잘 만들어진 시맨틱 레이어가 있었다. `customer_gmv_90d`는 이렇게 정의돼 있었다.

```yaml
metrics:
  - name: customer_gmv_90d
    model: ref('fct_orders')
    calculation_method: sum
    expression: amount
    timestamp: order_date
    dimensions: [user_id, channel, tier]
    filters:
      - field: status
        operator: '='
        value: 'completed'
```

이 metric은 "고객 GMV를 *어떻게 측정하는가*"를 정확하게 정의한다. 훌륭한 도구다. 하지만 K씨 문제에는 답이 없다. `user_id`가 K씨를 완전하게 대표하지 않기 때문이다.

> **시맨틱 레이어**: "K씨의 GMV를 *어떻게 측정하는가*"를 정의한다.  
> **온톨로지**: "K씨가 *무엇이고*, 무엇과 *연결되며*, 무슨 *행동이 가능한가*"를 정의한다.

둘은 경쟁이 아니라 층위다. 온톨로지 위에 시맨틱 레이어가 올라간다.

---

## 온톨로지 설계

이 케이스에 대한 설계적 답변은 새 모델이나 더 나은 피처 엔지니어링이 아니다. 네 가지 부재를 각각 채우는 온톨로지 설계다.

---

### Object Type + Identity: K씨를 하나로

**팔란티어 온톨로지 언어로:** Customer는 **Object Type**이다. `canonical_id`가 Primary Key, `display_name`이 Title Property다.

```
Object Type: Customer
  Primary Key  : canonical_id  (예: "CUST-029182")
  Title Prop   : display_name  (예: "권지혜")
  Description  : 채널 무관하게 동일 실체를 가리키는 고객 단위
  Data Source  : customer_identity 매핑을 통해 CRM·POS 통합
```

Customer는 소스 시스템의 ID가 아니라 실체(사람)다. 시스템 구현은 다음과 같다.

```sql
CREATE TABLE `marketeon.ontology.customers` (
  canonical_id  STRING    NOT NULL,
  display_name  STRING,
  created_at    TIMESTAMP NOT NULL
);

CREATE TABLE `marketeon.ontology.customer_identity` (
  source_system   STRING    NOT NULL,
  source_id       STRING    NOT NULL,
  canonical_id    STRING    NOT NULL,
  match_rule      STRING    NOT NULL,
  confidence      FLOAT64   NOT NULL,
  matched_at      TIMESTAMP NOT NULL
);
```

K씨의 이메일이 CRM과 POS 모두 `kwon.jihye@gmail.com`이었다. 이메일 정규화 매칭으로 `U-29182`와 `M-00991`을 `CUST-029182` 하나에 연결한다.

**적재 3단계:**

**Step 1** — CRM을 시드로 canonical entity 생성.

```sql
CREATE TEMP TABLE _crm_seed AS
SELECT user_id, name, created_at, GENERATE_UUID() AS canonical_id
FROM `marketeon.crm.users`;

INSERT INTO `marketeon.ontology.customers` (canonical_id, display_name, created_at)
SELECT canonical_id, name, created_at FROM _crm_seed;
```

**Step 2** — CRM → canonical 매핑 등록.

```sql
INSERT INTO `marketeon.ontology.customer_identity`
  (source_system, source_id, canonical_id, match_rule, confidence, matched_at)
SELECT 'crm', user_id, canonical_id, 'seed', 1.0, CURRENT_TIMESTAMP()
FROM _crm_seed;
```

**Step 3** — POS → canonical 매핑 등록 (이메일 매칭).

```sql
INSERT INTO `marketeon.ontology.customer_identity`
SELECT
  'pos', p.member_no, ci.canonical_id, 'email_exact', 1.0, CURRENT_TIMESTAMP()
FROM `marketeon.pos.members` p
JOIN `marketeon.crm.users` c
  ON LOWER(TRIM(p.email)) = LOWER(TRIM(c.email))
JOIN `marketeon.ontology.customer_identity` ci
  ON ci.source_id = c.user_id AND ci.source_system = 'crm';
```

---

### Link Type: 구매를 관계로 표현한다

**팔란티어 온톨로지 언어로:** Customer와 Order 사이에 **Link Type**이 있다.

```
Link Type: placed / placedBy
  Source       : Customer  (MANY)
  Target       : Order     (MANY)
  카디널리티   : MANY_TO_MANY (한 고객이 여러 주문, 한 주문은 하나의 고객)
  Forward Name : placed    (Customer → Order: "K씨가 place한 주문들")
  Reverse Name : placedBy  (Order → Customer: "이 주문을 place한 고객")
  의미         : 고객이 주문을 생성한 행위. 채널 무관.
```

Order도 엔티티다. 시스템 구현:

```sql
CREATE TABLE `marketeon.ontology.orders` (
  canonical_id   STRING    NOT NULL,
  source_system  STRING    NOT NULL,
  source_id      STRING    NOT NULL,
  amount         FLOAT64   NOT NULL,
  completed_at   TIMESTAMP NOT NULL
);

CREATE TABLE `marketeon.ontology.links` (
  id              STRING    NOT NULL,
  rel_type        STRING    NOT NULL,
  source_type     STRING    NOT NULL,
  source_id       STRING    NOT NULL,
  target_type     STRING    NOT NULL,
  target_id       STRING    NOT NULL,
  props           JSON,
  valid_from      TIMESTAMP NOT NULL,
  valid_to        TIMESTAMP
)
PARTITION BY DATE(valid_from)
CLUSTER BY rel_type, source_id;
```

CRM·POS 주문을 각각 Order 오브젝트로 적재하고, canonical_id 기준의 `placed` 링크를 생성한다.

```sql
-- CRM 주문
INSERT INTO `marketeon.ontology.links`
  (id, rel_type, source_type, source_id, target_type, target_id, valid_from)
SELECT
  GENERATE_UUID(), 'placed', 'customer', ci.canonical_id,
  'order', CONCAT('ORD-crm-', o.order_id), TIMESTAMP(o.order_date)
FROM `marketeon.crm.orders` o
JOIN `marketeon.ontology.customer_identity` ci
  ON ci.source_id = o.user_id AND ci.source_system = 'crm'
WHERE o.status = 'completed';

-- POS 주문 — 같은 links 테이블, 같은 rel_type
INSERT INTO `marketeon.ontology.links`
  (id, rel_type, source_type, source_id, target_type, target_id, valid_from)
SELECT
  GENERATE_UUID(), 'placed', 'customer', ci.canonical_id,
  'order', CONCAT('ORD-pos-', p.receipt_no), TIMESTAMP(p.purchase_date)
FROM `marketeon.pos.purchases` p
JOIN `marketeon.ontology.customer_identity` ci
  ON ci.source_id = p.member_no AND ci.source_system = 'pos';
```

이제 `last_purchase_at`은 컬럼이 아니다. **"K씨가 `placed` 링크로 연결된 모든 Order 중 가장 최근의 `completed_at`"** — 이것이 팔란티어에서 말하는 **Derived Property**다.

```sql
SELECT
  l.source_id         AS canonical_id,
  MAX(o.completed_at) AS last_purchase_at,
  SUM(o.amount)       AS gmv_90d
FROM `marketeon.ontology.links` l
JOIN `marketeon.ontology.orders` o ON o.canonical_id = l.target_id
WHERE l.rel_type = 'placed'
  AND l.valid_to IS NULL
  AND o.completed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
GROUP BY 1;
```

```
canonical_id  | last_purchase_at     | gmv_90d
CUST-029182   | 2024-12-08 14:23:00  | 835,000   ← 이틀 전, 83만원
```

새 채널이 추가될 때는 Order 오브젝트와 `placed` 링크만 추가한다. `last_purchase_at` 계산 로직은 건드리지 않는다.

---

### Property Types & Definition: 정의를 코드로, 이력을 남긴다

**팔란티어 온톨로지 언어로:** Customer Object Type의 프로퍼티는 타입별로 분류된다.

```
Customer Object Type의 프로퍼티:
  canonical_id       : string    (Scalar, NORMAL)    — Primary Key
  display_name       : string    (Scalar, NORMAL)    — Title Property
  tier               : string    (Scalar, NORMAL)    — "VIP" | "GOLD" | "SILVER"
  created_at         : timestamp (Scalar, NORMAL)
  pii_email          : string    (Scalar, SENSITIVE) — 명시적 접근 시에만 반환
  last_purchase_at   : timestamp (Derived)           — placed 링크 탐색으로 런타임 계산
  days_since_purchase: integer   (Derived)           — TIMESTAMP_DIFF(NOW, last_purchase_at)
  gmv_90d            : double    (Derived)           — 90일 placed 링크 합산
```

Derived Property는 저장하지 않고 쿼리 시점에 계산된다. 원본 데이터가 바뀌면 즉시 반영된다.

[[/data-architect/04_what_is_ontology]]에서 "의미의 SCD2"를 이야기했다 — 사실 데이터가 아니라 *정의* 자체에 `valid_from`과 `valid_to`가 붙는 것. 이것을 `prop_def` 테이블로 실체화한다.

```sql
CREATE TABLE `marketeon.ontology.prop_def` (
  prop_name     STRING    NOT NULL,
  entity_type   STRING    NOT NULL,
  description   STRING    NOT NULL,
  computation   STRING,
  data_type     STRING    NOT NULL,
  is_pii        BOOL      NOT NULL,
  valid_from    TIMESTAMP NOT NULL,
  valid_to      TIMESTAMP,
  changed_by    STRING    NOT NULL,
  change_note   STRING
)
CLUSTER BY entity_type, prop_name;
```

인시던트 전후로 `last_purchase_at`의 정의가 버전 관리된다.

```sql
-- v1: 웹 기준 (CRM 단독)
INSERT INTO `marketeon.ontology.prop_def` VALUES (
  'last_purchase_at', 'customer',
  'CRM(웹/앱) 기준 마지막 주문 완료 시점. 오프라인 채널 제외.',
  'MAX(crm.orders.order_date) WHERE status=completed',
  'timestamp', FALSE,
  TIMESTAMP '2021-03-01', TIMESTAMP '2024-12-10 08:59:59',
  'data-team', '초기 정의. 오프라인 데이터 미통합 상태'
);

-- v2: 전채널 기준 (CRM+POS)
INSERT INTO `marketeon.ontology.prop_def` VALUES (
  'last_purchase_at', 'customer',
  '전채널(CRM+POS+마켓플레이스) 기준 마지막 구매 완료 시점. Customer→placed→Order 링크 기준.',
  'MAX(orders.completed_at) WHERE customer PLACED order',
  'timestamp', FALSE,
  TIMESTAMP '2024-12-11 00:00:00', NULL,
  'data-team', '채널 전환 오분류 대응. 전채널 기준으로 재정의.'
);
```

이제 세 가지 질문에 답할 수 있다.

**"지금 last_purchase_at은 무엇인가?"**
```sql
SELECT description, computation FROM `marketeon.ontology.prop_def`
WHERE prop_name = 'last_purchase_at' AND entity_type = 'customer' AND valid_to IS NULL;
```

**"인시던트 전날 정의는?"**
```sql
SELECT description, change_note FROM `marketeon.ontology.prop_def`
WHERE prop_name = 'last_purchase_at' AND entity_type = 'customer'
  AND valid_from <= TIMESTAMP '2024-12-09'
  AND (valid_to IS NULL OR valid_to > TIMESTAMP '2024-12-09');
```

**"정의가 몇 번 바뀌었고 각각 왜?"**
```sql
SELECT valid_from, valid_to, description, change_note
FROM `marketeon.ontology.prop_def`
WHERE prop_name = 'last_purchase_at' AND entity_type = 'customer'
ORDER BY valid_from;
```

---

### Action Type: 쿠폰 발송에 게이트를 단다

**팔란티어 온톨로지 언어로:** 쿠폰 발송은 Customer Object Type에 정의된 **Action Type**이다.

```
Action Type: issue_churn_coupon
  Target       : Customer
  Description  : 이탈 방어 목적 쿠폰 발송. 전채널 기준 90일 이상 미구매 고객 한정.

  Parameters:
    customer         : ObjectType<Customer>
    couponAmount     : integer              — 발송할 쿠폰 금액
    notifyChannel    : string               — "sms" | "push" | "email"

  Validation Rules:
    - days_since_last_purchase(all_channels) >= 90   → "최근 90일 내 구매 이력 있음 (전채널 기준)"
    - active_coupon_count == 0                       → "미사용 쿠폰 보유 중 — 중복 발송 방지"

  Effects:
    CREATE_OBJECT Coupon { amount, expires_at }
    CREATE_LINK   Customer --[received]--> Coupon

  Notifications:
    → 발송 성공 시 CS 대시보드 웹훅
    → notifyChannel에 따라 고객 알림 발송
```

```sql
CREATE TABLE `marketeon.ontology.action_def` (
  action_name           STRING        NOT NULL,
  target_entity_type    STRING        NOT NULL,
  description           STRING        NOT NULL,
  allowed_callers       ARRAY<STRING> NOT NULL,
  preconditions         JSON,
  creates_link          STRING,
  valid_from            TIMESTAMP     NOT NULL,
  valid_to              TIMESTAMP
);

INSERT INTO `marketeon.ontology.action_def` VALUES (
  'issue_churn_coupon', 'customer',
  '이탈 방어 목적 쿠폰 발송. 전채널 기준 90일 이상 미구매 고객 한정.',
  ['automation:churn-model', 'cs:human'],
  JSON '{
    "all": [
      {
        "metric":   "days_since_last_purchase",
        "operator": "gte",
        "value":    90,
        "basis":    "all_channels",
        "error":    "최근 90일 내 구매 이력 있음 (전채널 기준)"
      },
      {
        "metric":   "active_coupon_count",
        "operator": "eq",
        "value":    0,
        "error":    "미사용 쿠폰 보유 중"
      }
    ]
  }',
  'received',
  CURRENT_TIMESTAMP(), NULL
);
```

액션 실행기는 링크 그래프를 순회해 Validation Rule을 검사한다.

```sql
WITH customer_metrics AS (
  SELECT
    TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(o.completed_at), DAY) AS days_since_purchase
  FROM `marketeon.ontology.links` l
  JOIN `marketeon.ontology.orders` o ON o.canonical_id = l.target_id
  WHERE l.source_id = 'CUST-029182' AND l.rel_type = 'placed' AND l.valid_to IS NULL
),
active_coupons AS (
  SELECT COUNT(*) AS cnt
  FROM `marketeon.ontology.links` l
  JOIN `marketeon.ontology.coupons` c ON c.canonical_id = l.target_id
  WHERE l.source_id = 'CUST-029182' AND l.rel_type = 'received'
    AND c.used_at IS NULL AND l.valid_to IS NULL
)
SELECT
  NOT (m.days_since_purchase < 90 OR a.cnt > 0) AS can_execute,
  m.days_since_purchase,
  CASE
    WHEN m.days_since_purchase < 90 THEN '최근 90일 내 구매 이력 있음 (전채널 기준)'
    WHEN a.cnt > 0                  THEN '미사용 쿠폰 보유 중'
  END AS block_reason
FROM customer_metrics m, active_coupons a;
```

```
can_execute | days_since_purchase | block_reason
FALSE       | 2                   | 최근 90일 내 구매 이력 있음 (전채널 기준)
```

모든 실행 시도는 결과와 무관하게 로그에 남는다.

```sql
CREATE TABLE `marketeon.ontology.action_log` (
  id            STRING    NOT NULL,
  action_name   STRING    NOT NULL,
  target_id     STRING    NOT NULL,
  caller        STRING    NOT NULL,
  params        JSON,
  status        STRING    NOT NULL,
  block_reason  STRING,
  executed_at   TIMESTAMP NOT NULL
)
PARTITION BY DATE(executed_at)
CLUSTER BY target_id, action_name;
```

액션이 성공하면 `Customer → received → Coupon` 링크도 생성된다. **액션의 Effect가 그래프에 기록되는 방법**이다.

---

## 재현: 온톨로지가 있었다면

같은 날 K씨에게 일어났을 일:

1. **이탈 모델이 피처를 계산한다** → links 테이블 순회 → `last_purchase_at = 2024-12-08` (이틀 전) → 이탈 확률 0.12 → **알람 없음**

만약 모델이 그래도 알람을 올렸다면:

2. **CS 자동화가 `issue_churn_coupon` 요청** → precondition 체크 → `days_since_purchase = 2` → **Validation Rule 차단**

3. **`action_log`에 `status = 'blocked'`, `block_reason = '최근 90일 내 구매 이력 있음 (전채널 기준)'` 기록**

K씨는 쿠폰을 받지 않았다. 그리고 이 blocked 기록은 사라지지 않는다.

---

## Dynamic Layer: 결정이 다시 데이터가 된다

[[/data-architect/04_what_is_ontology]]에서 Palantir의 3계층 중 **Dynamic Layer**를 "내려진 의사결정이 다시 데이터로 되먹임되는 층"이라고 설명했다. 이 케이스에서 그것이 실제로 일어난다.

K씨의 blocked 기록은 `action_log`에 쌓였다. 같은 패턴이 다른 고객들에게서도 반복됐다.

```sql
SELECT
  target_id                                          AS canonical_id,
  COUNT(*)                                           AS alert_blocked_count
FROM `marketeon.ontology.action_log`
WHERE action_name   = 'issue_churn_coupon'
  AND status        = 'blocked'
  AND block_reason LIKE '%구매 이력 있음%'
  AND executed_at  >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
GROUP BY 1
HAVING alert_blocked_count >= 2;
```

이 쿼리가 반환한 고객은 847명이었다. 이것이 팔란티어에서 말하는 **Object Set** — "조건을 만족하는 오브젝트 인스턴스의 집합" — 이다. 847명이라는 숫자가 아니라, "이탈 알람이 2회 이상 blocked된 고객들"이라는 **의미 있는 집합**이다.

이들의 공통점을 분석하면 **채널 전환 패턴**이 나왔다 — 웹 구매 빈도가 떨어지는 동시에 POS 링크가 늘고 있었다. 이 패턴을 새 피처로 모델에 추가했다.

```sql
SELECT
  target_id                                            AS canonical_id,
  COUNTIF(status = 'blocked'
    AND block_reason LIKE '%구매 이력 있음%'
    AND executed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
  )                                                    AS cross_channel_signal_90d
FROM `marketeon.ontology.action_log`
WHERE action_name = 'issue_churn_coupon'
GROUP BY 1;
```

이제 모델은 `cross_channel_signal_90d > 0`인 고객을 이탈이 아닌 채널 전환으로 분류한다.

**결정(blocked action) → 기록(action_log) → 학습(new feature) → 더 나은 결정.** 온톨로지가 없었다면 blocked 기록이 남지 않았을 것이고, 루프도 없었을 것이다.

---

## 에이전트 월드모델

온톨로지 위에 AI 추천 에이전트를 구성하는 경우를 보자. 에이전트는 raw 테이블을 직접 조회하지 않는다. 두 가지 인터페이스만 쓴다.

**인터페이스 1: 허용된 Action Type 목록 (Ontology API)**

```sql
SELECT action_name, description, preconditions
FROM `marketeon.ontology.action_def`
WHERE target_entity_type = 'customer'
  AND 'agent:recommendation' IN UNNEST(allowed_callers)
  AND valid_to IS NULL;
```

```
action_name            | description
issue_churn_coupon     | 이탈 방어 쿠폰 발송 (조건: 90일 미구매)
issue_birthday_coupon  | 생일 쿠폰 발송
recommend_product      | 상품 추천 발송
upgrade_tier           | 등급 상향 (조건: 연 GMV 기준 달성)
```

에이전트는 이 네 가지만 안다. `delete_customer`, `export_pii`는 `allowed_callers`에 없어 보이지 않는다. **에이전트가 존재하지 않는 동사를 만들어내는 환각이 구조적으로 차단된다.**

**인터페이스 2: Link 탐색을 통한 Object 상태 조회**

```sql
WITH customer_state AS (
  SELECT
    (SELECT MAX(o.completed_at)
     FROM `marketeon.ontology.links` l
     JOIN `marketeon.ontology.orders` o ON o.canonical_id = l.target_id
     WHERE l.source_id = 'CUST-029182' AND l.rel_type = 'placed'
       AND l.valid_to IS NULL)                        AS last_purchase_at,
    (SELECT COUNT(*)
     FROM `marketeon.ontology.links` l
     JOIN `marketeon.ontology.coupons` c ON c.canonical_id = l.target_id
     WHERE l.source_id = 'CUST-029182' AND l.rel_type = 'received'
       AND c.used_at IS NULL AND l.valid_to IS NULL)  AS active_coupon_count
)
SELECT
  ad.action_name,
  CASE ad.action_name
    WHEN 'issue_churn_coupon'
      THEN TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), cs.last_purchase_at, DAY) >= 90
           AND cs.active_coupon_count = 0
    ELSE TRUE
  END AS executable
FROM `marketeon.ontology.action_def` ad, customer_state cs
WHERE ad.target_entity_type = 'customer'
  AND 'agent:recommendation' IN UNNEST(ad.allowed_callers)
  AND ad.valid_to IS NULL;
```

```
action_name            | executable
issue_churn_coupon     | FALSE   ← 이틀 전 구매 있음
issue_birthday_coupon  | FALSE   ← 생일 아님
recommend_product      | TRUE
upgrade_tier           | TRUE    ← 연 GMV 300만 달성
```

[[/data-architect/04_what_is_ontology]]에서 "테이블 1,000개의 스키마 대신 객체·관계·허용된 행동으로 압축된 지도"라 한 것이 이 두 인터페이스다.

---

## 온톨로지 설계 원칙

이 글에서 구현한 것들을 [[/data-architect/05_ontology_objects_summary]]의 설계 원칙과 대조하면 다음과 같다.

| 원칙 | 이 글에서 | 나쁜 예 (인시던트 전) |
|------|---------|---------------------|
| **Object Type은 명사** | `Customer`, `Order` — 비즈니스 개체 | `U-29182`, `M-00991` — 시스템 ID |
| **Link는 의미를 담는다** | `placed` — "고객이 주문을 생성한 행위" | FK join `user_id = order.user_id` — 의미 없는 조인 |
| **Derived Property 분리** | `last_purchase_at` 런타임 계산 | `last_purchase_at` 컬럼 저장 → 채널 누락 |
| **Action은 비즈니스 이벤트** | `issue_churn_coupon` + 사전 검증 | 함수 직접 호출 + 사후 후회 |
| **검증은 Action 안에** | `action_def.preconditions` | 앱 코드 각자 조건 분기 |
| **정의는 코드(Definition-as-Code)** | `prop_def` + `valid_from`/`valid_to` | 모델 카드 주석 한 줄 |

---

## 파급: 링크 그래프가 가능하게 만든 질문

세 계층 + 시간 + 에이전트가 연결되자 이전에 물을 수 없었던 질문들이 생겼다.

**"채널 전환"과 "진짜 이탈"을 구분한다.**

```sql
SELECT
  l.source_id                                                                    AS canonical_id,
  COUNTIF(o.source_system = 'crm'
    AND o.completed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY))  AS web_orders_90d,
  COUNTIF(o.source_system = 'pos'
    AND o.completed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY))  AS pos_orders_90d
FROM `marketeon.ontology.links` l
JOIN `marketeon.ontology.orders` o ON o.canonical_id = l.target_id
WHERE l.rel_type = 'placed' AND l.valid_to IS NULL
GROUP BY 1
HAVING web_orders_90d = 0 AND pos_orders_90d > 0;
```

이탈 위험 VIP로 분류됐던 고객의 34%가 실제로는 오프라인으로 채널을 옮긴 충성 고객이었다.

**K씨의 전체 타임라인 — 구매·액션·등급 변화를 한 뷰에서.**

```sql
SELECT executed_at AS ts, action_name AS event, status, block_reason
FROM `marketeon.ontology.action_log`
WHERE target_id = 'CUST-029182'
UNION ALL
SELECT valid_from, CONCAT('link.', rel_type, '.', target_type), 'created', NULL
FROM `marketeon.ontology.links`
WHERE source_id = 'CUST-029182'
ORDER BY ts;
```

```
ts                   | event                  | status    | block_reason
2024-12-08 14:23:00  | link.placed.order      | created   |
2024-12-10 09:02:00  | issue_churn_coupon     | blocked   | 최근 90일 내 구매 이력 있음
2024-12-10 09:05:00  | upgrade_tier           | completed |
2024-12-10 09:05:00  | link.received.coupon   | created   |   ← upgrade 혜택 쿠폰
```

---

## 한계

**Identity resolution은 끝나지 않는다.** 이메일 없는 POS 회원, 게스트 주문, 전화번호가 바뀐 고객. `confidence < 0.9`인 매핑은 주당 수백 건 쌓인다. 온톨로지를 도입한다는 건 entity resolution을 영원히 운영하겠다는 선언이다.

**정의 합의는 기술이 해결하지 않는다.** `prop_def`에 정의를 등록하는 것 자체는 하루면 됐다. 마케팅·재무·데이터팀이 "전채널 기준"에 동의하는 데 두 달이 걸렸다. 스키마는 합의를 *기록*하지 합의를 *만들어내지* 않는다.

**precondition이 코드를 완전히 대체하지는 못한다.** 복잡한 비즈니스 룰은 여전히 코드가 필요하다. JSON precondition은 계약(contract)이고, 이행은 코드의 일이다.

**Dynamic Loop가 작동하려면 action_log 품질이 담보돼야 한다.** blocked 기록이 부정확하면 그것을 피처로 쓴 모델도 부정확해진다.

---

## 에필로그

이 케이스에서 하나의 오분류 시나리오를 드릴다운하면 온톨로지의 다섯 개념이 모두 등장한다.

| 부재 | 팔란티어 개념 | 이 글의 구현 |
|------|------------|-----------|
| K씨가 두 시스템에 분리됨 | Object Type + Entity Resolution | `canonical_id` + `customer_identity` |
| 구매가 채널별로 분리됨 | Link Type | `placed` 링크로 전채널 통합 |
| `last_purchase_at` 의미 없음 | Property Definition (SCD2) | `prop_def` + `valid_from/to` |
| 쿠폰이 조건 없이 발송됨 | Action Type + Validation Rules | `action_def.preconditions` |
| blocked 기록이 허공에 사라짐 | Dynamic Layer | `action_log` → 피처 → 피드백 루프 |

그리고 다섯 개념이 맞물리자 여섯 번째가 자연스럽게 따라왔다. 에이전트에게 raw 테이블 대신 이 그래프를 주었을 때, 에이전트는 K씨의 세계를 이해하고 허용된 동사(Action Type)만 실행했다. **온톨로지가 에이전트의 월드모델이 된 것이다.**

> 모델이 틀린 게 아니었다. 모델이 본 K씨가 불완전했다. 온톨로지는 K씨를 완전하게 만드는 일이다.

---

## 참고

- [[/data-architect/04_what_is_ontology]] — 온톨로지의 개념과 아키텍처 원리: Semantic·Kinetic·Dynamic 3계층, 의미의 SCD2
- [[/data-architect/05_ontology_objects_summary]] — Object Type·Property·Link Type·Action Type·Interface·Object Set 전체 스펙
- Sculley et al., [*Hidden Technical Debt in Machine Learning Systems*](https://papers.nips.cc/paper/5656-hidden-technical-debt-in-machine-learning-systems) (NIPS 2015) — 피처 의미 드리프트가 ML 시스템에 미치는 영향
- Milner, [*Action calculi, or syntactic action structures*](https://link.springer.com/chapter/10.1007/3-540-57182-5_7) (MFCS 1993) — 행위(action)를 일급 시민으로 다루는 이론적 배경
