---
layout  : wiki
title   : 알람 하나로 온톨로지 전체를 훑어보기
date    : 2026-06-23 00:00:00 +0900
updated : 2026-06-23 00:00:00 +0900
tag     : data-architecture data-engineering ontology 
toc     : true
comment : true
latex   : true
status  : complete
public  : true
show-diagram: true
parent  : [[/data-architect]]
relations:
  - { type: extends, target: /wiki/data-architect/04_what_is_ontology }
confidence     : medium
---

> [[/data-architect/04_what_is_ontology]] 에서 온톨로지를 **객체(명사)·링크(관계)·액션(동사)** 세 계층과, 그 위에 올라타는 **시간(Dynamic)** 차원으로 설명했다. 이 글은 그 모든 개념이 하나의 사건 안에서 어떻게 맞물리는지를 끝까지 파고든다.

---

## 인시던트

2024년 12월 10일 오전 9시. 슬랙에 알람이 떴다.

> `[CHURN-ALERT] VIP 고객 이탈 위험 — K씨 (user_id: U-29182) | 이탈 확률 0.87 | 마지막 구매: 2024-09-15`

이탈 예측 모델이 K씨를 위험군으로 분류했다. CS 자동화 시스템이 즉시 2만원 쿠폰 발송 액션을 실행했다. K씨는 쿠폰을 받고 당일 오후 웹에서 주문했다. 지표상으로는 이탈 방어 성공.

다음 날 데이터팀이 오프라인 로그를 뒤졌다.

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

알람이 뜨기 이틀 전, K씨는 오프라인 매장에서 51만 원을 결제했다. 이탈하지 않은 VIP에게 불필요한 쿠폰이 발송됐고, K씨는 자신이 이탈 위험군으로 분류됐다는 사실을 쿠폰으로 간접적으로 알게 됐다.

포스트모텀을 돌렸다. 문제는 네 군데에 있었다.

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

모델 카드에는 `last_purchase_at: 마지막 구매일`이라고만 적혀 있었다. 웹 기준인지 전채널 기준인지, 주문 접수 기준인지 결제 완료 기준인지. 이 모호함이 묵인된 채 3년이 흘렀다. 그리고 이 정의가 언제 누가 왜 만들었는지, 중간에 바뀐 적은 없는지 추적할 방법이 없었다.

---

## 잠깐 — 시맨틱 레이어로 해결됐을까?

포스트모텀 회의에서 누군가 물었다. "우리 dbt semantic layer에 GMV metric이 있는데, 그게 이 문제를 막았어야 하지 않나요?"

답은 **아니다**.

마켓온에는 이미 잘 만들어진 시맨틱 레이어가 있었다. `customer_gmv_90d`는 이렇게 정의돼 있었다.

```yaml
# dbt/models/metrics/customer_gmv_90d.yml
metrics:
  - name: customer_gmv_90d
    label: "고객 90일 GMV"
    model: ref('fct_orders')
    calculation_method: sum
    expression: amount
    timestamp: order_date
    time_grains: [day, week, month]
    dimensions: [user_id, channel, tier]
    filters:
      - field: status
        operator: '='
        value: 'completed'
```

이 metric은 "고객 GMV를 어떻게 측정하는가"를 정확하게 정의한다. 마케팅과 재무가 서로 다른 GMV를 계산하지 않도록 막아준다. 훌륭한 도구다.

하지만 K씨 문제에는 답이 없다. `user_id`가 K씨를 완전하게 대표하지 않기 때문이다. metric이 아무리 정밀해도, 측정 **대상**이 불완전하면 측정값도 불완전하다.

이것이 [[/data-architect/04_what_is_ontology]]에서 설명한 시맨틱 레이어와 온톨로지의 층위 차이다.

> **시맨틱 레이어**: "K씨의 GMV를 *어떻게 측정하는가*"를 정의한다.  
> **온톨로지**: "K씨가 *무엇이고*, 무엇과 *연결되며*, 무슨 *행동이 가능한가*"를 정의한다.

시맨틱 레이어는 측정 계약(metric contract)이다. 온톨로지는 그 아래 레이어다. `user_id`가 K씨의 전부인지 아닌지를 아는 것이 온톨로지의 일이다. K씨의 온라인·오프라인 구매를 하나로 묶고 나서야 시맨틱 레이어의 GMV metric이 올바른 숫자를 낸다.

둘은 경쟁이 아니라 층위다. 온톨로지 위에 시맨틱 레이어가 올라간다.

---

## 온톨로지 설계

포스트모텀 이후 데이터팀이 제안한 것은 새 모델이나 더 나은 피처 엔지니어링이 아니었다. 네 가지 부재를 각각 채우는 설계였다.

### Entity + Identity: K씨를 하나로

Customer는 소스 시스템의 ID가 아니라 실체(사람)다. `CUST-029182`라는 canonical ID를 발급하고, 소스 ID들을 매핑한다.

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

적재는 3단계다.

**Step 1 — CRM을 시드로 canonical entity 생성.** `GENERATE_UUID()` 결과를 같은 트랜잭션에서 바로 참조할 수 없으므로 임시 테이블에 먼저 확보한다.

```sql
CREATE TEMP TABLE _crm_seed AS
SELECT user_id, name, created_at, GENERATE_UUID() AS canonical_id
FROM `marketeon.crm.users`;

INSERT INTO `marketeon.ontology.customers` (canonical_id, display_name, created_at)
SELECT canonical_id, name, created_at
FROM _crm_seed;
```

**Step 2 — CRM → canonical 매핑 등록.** `_crm_seed`에 UUID가 이미 있으므로 안전하게 조인할 수 있다.

```sql
INSERT INTO `marketeon.ontology.customer_identity`
  (source_system, source_id, canonical_id, match_rule, confidence, matched_at)
SELECT 'crm', user_id, canonical_id, 'seed', 1.0, CURRENT_TIMESTAMP()
FROM _crm_seed;
```

**Step 3 — POS → canonical 매핑 등록.** CRM canonical_id가 이미 `customer_identity`에 있으므로 이메일 매칭으로 연결한다.

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

### Link: 구매를 관계로 표현한다

Order도 엔티티다. K씨와 주문 사이에는 **"구매했다(placed)"** 는 링크가 있다.

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

CRM·POS 주문을 각각 Order 엔티티로 적재하고, canonical_id 기준의 `placed` 링크를 생성한다.

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

-- POS 주문 — 같은 links 테이블에, 같은 rel_type으로
INSERT INTO `marketeon.ontology.links`
  (id, rel_type, source_type, source_id, target_type, target_id, valid_from)
SELECT
  GENERATE_UUID(), 'placed', 'customer', ci.canonical_id,
  'order', CONCAT('ORD-pos-', p.receipt_no), TIMESTAMP(p.purchase_date)
FROM `marketeon.pos.purchases` p
JOIN `marketeon.ontology.customer_identity` ci
  ON ci.source_id = p.member_no AND ci.source_system = 'pos';
```

이제 `last_purchase_at`은 컬럼이 아니다. **"K씨가 placed 링크로 연결된 모든 Order 중 가장 최근의 completed_at"** 이다.

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

새 채널이 추가될 때는 Order 엔티티와 placed 링크만 추가하면 된다. `last_purchase_at` 계산 로직은 건드리지 않는다.

---

### Property Definition: 정의를 코드로, 이력을 남긴다

[[/data-architect/04_what_is_ontology]]에서 "의미의 SCD2"를 이야기했다. 사실 데이터가 아니라 *정의* 자체에 `valid_from`과 `valid_to`가 붙는 것. 이것을 여기서 실체화한다.

```sql
CREATE TABLE `marketeon.ontology.prop_def` (
  prop_name     STRING    NOT NULL,
  entity_type   STRING    NOT NULL,
  description   STRING    NOT NULL,   -- 의미의 공식 정의
  computation   STRING,               -- 어떻게 계산하는가 (선택)
  data_type     STRING    NOT NULL,
  is_pii        BOOL      NOT NULL,
  valid_from    TIMESTAMP NOT NULL,
  valid_to      TIMESTAMP,            -- NULL = 현재 유효
  changed_by    STRING    NOT NULL,
  change_note   STRING                -- 왜 바뀌었나
)
CLUSTER BY entity_type, prop_name;
```

인시던트 전후로 `last_purchase_at`의 정의가 각각 등록된다.

```sql
-- 인시던트 전: 웹 기준 (3년간 암묵적으로 유지됐던 정의를 소급 등록)
INSERT INTO `marketeon.ontology.prop_def` VALUES (
  'last_purchase_at', 'customer',
  'CRM(웹/앱) 기준 마지막 주문 완료 시점. 오프라인 채널 제외.',
  'MAX(crm.orders.order_date) WHERE status=completed',
  'timestamp', FALSE,
  TIMESTAMP '2021-03-01', TIMESTAMP '2024-12-10 08:59:59',
  'data-team', '초기 정의. 오프라인 데이터 미통합 상태'
);

-- 인시던트 후: 전채널 기준으로 변경
INSERT INTO `marketeon.ontology.prop_def` VALUES (
  'last_purchase_at', 'customer',
  '전채널(CRM+POS+마켓플레이스) 기준 마지막 구매 완료 시점. Customer→placed→Order 링크 기준.',
  'MAX(orders.completed_at) WHERE customer PLACED order',
  'timestamp', FALSE,
  TIMESTAMP '2024-12-11 00:00:00', NULL,
  'data-team', '인시던트 #INC-241210 대응. 채널 전환 고객 오분류 방지.'
);
```

이제 세 가지 질문에 답할 수 있다.

**"지금 last_purchase_at은 무엇을 의미하는가?"**
```sql
SELECT description, computation
FROM `marketeon.ontology.prop_def`
WHERE prop_name = 'last_purchase_at' AND entity_type = 'customer'
  AND valid_to IS NULL;
-- '전채널(CRM+POS+마켓플레이스) 기준 마지막 구매 완료 시점'
```

**"인시던트 전날 last_purchase_at의 정의는 무엇이었는가?"**
```sql
SELECT description, changed_by, change_note
FROM `marketeon.ontology.prop_def`
WHERE prop_name = 'last_purchase_at' AND entity_type = 'customer'
  AND valid_from <= TIMESTAMP '2024-12-09'
  AND (valid_to IS NULL OR valid_to > TIMESTAMP '2024-12-09');
-- 'CRM(웹/앱) 기준 마지막 주문 완료 시점. 오프라인 채널 제외.'
```

**"정의가 몇 번 바뀌었고 각각 왜 바뀌었는가?"**
```sql
SELECT valid_from, valid_to, description, change_note
FROM `marketeon.ontology.prop_def`
WHERE prop_name = 'last_purchase_at' AND entity_type = 'customer'
ORDER BY valid_from;
```

3개월 뒤 이탈 모델 정확도가 개선됐을 때, 그 원인이 이 정의 변경임을 `change_note`의 인시던트 번호로 추적할 수 있다. 이것이 데이터 거버넌스가 코드가 아닌 데이터로 관리될 때 생기는 일이다.

---

### Action: 쿠폰 발송에 게이트를 단다

쿠폰 발송은 고객 객체에 가해지는 **행위(action)** 다. 허용 조건과 허용 주체를 데이터로 표현한다.

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
        "error":    "미사용 쿠폰 보유 중 — 중복 발송 방지"
      }
    ]
  }',
  'received',   -- 성공 시 Customer → received → Coupon 링크 생성
  CURRENT_TIMESTAMP(), NULL
);
```

`preconditions.basis: "all_channels"` 한 줄이 "마지막 구매를 전채널로 계산하라"는 의미를 액션 정의에 못 박는다. 이 정의가 `prop_def`의 `last_purchase_at` 정의와 연결된다. 의미가 코드가 아닌 데이터에 있다.

액션 실행기는 링크 그래프를 순회해 precondition을 검사한다.

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
  status        STRING    NOT NULL,   -- 'completed' | 'blocked' | 'failed'
  block_reason  STRING,
  executed_at   TIMESTAMP NOT NULL
)
PARTITION BY DATE(executed_at)
CLUSTER BY target_id, action_name;
```

액션이 성공하면 `Customer → received → Coupon` 링크도 생성된다. 링크가 액션의 효과를 그래프에 기록하는 방법이다.

---

## 재현: 온톨로지가 있었다면

같은 날 K씨에게 일어났을 일을 단계별로 추적한다.

1. **이탈 모델이 피처를 계산한다** → links 테이블 순회 → `last_purchase_at = 2024-12-08` (이틀 전) → 이탈 확률 0.12 → **알람 없음**

만약 모델이 그래도 알람을 올렸다면:

2. **CS 자동화가 `issue_churn_coupon` 요청** → `allowed_callers` 확인 통과 → precondition 체크 → `days_since_purchase = 2` → **게이트 차단**

3. **`action_log`에 `status = 'blocked'`, `block_reason = '최근 90일 내 구매 이력 있음 (전채널 기준)'` 기록**

K씨는 쿠폰을 받지 않았다. 그리고 이 blocked 기록은 사라지지 않는다.

---

## Dynamic Layer: 결정이 다시 데이터가 된다

[[/data-architect/04_what_is_ontology]]에서 Palantir의 3계층 중 **Dynamic Layer**를 "내려진 의사결정이 다시 데이터로 되먹임되는 층"이라고 설명했다. 이 케이스에서 그것이 실제로 일어난다.

K씨의 blocked 기록은 `action_log`에 쌓였다. 그리고 같은 패턴이 다른 고객들에게서도 반복됐다.

```sql
-- 90일 내에 이탈 알람이 왔지만 전채널 구매 이력으로 blocked된 고객
SELECT
  target_id                                          AS canonical_id,
  COUNT(*)                                           AS alert_blocked_count,
  MIN(executed_at)                                   AS first_blocked_at,
  MAX(executed_at)                                   AS last_blocked_at
FROM `marketeon.ontology.action_log`
WHERE action_name   = 'issue_churn_coupon'
  AND status        = 'blocked'
  AND block_reason LIKE '%구매 이력 있음%'
  AND executed_at  >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
GROUP BY 1
HAVING alert_blocked_count >= 2;
```

이 쿼리가 반환한 고객은 847명이었다. 이탈 모델이 반복적으로 틀린 고객들. 이들의 공통점을 분석하면 **채널 전환 패턴**이 나왔다 — 웹 구매 빈도가 떨어지는 동시에 POS 링크가 늘고 있었다.

이 패턴을 새 피처로 모델에 추가했다.

```sql
-- 새 피처: 채널 전환 신호 (action_log에서 파생)
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

이것이 Dynamic Layer다. **결정(blocked action) → 기록(action_log) → 학습(new feature) → 더 나은 결정.** 이 루프가 돌기 시작했다. 온톨로지가 없었다면 blocked 기록이 남지 않았을 것이고, 루프도 없었을 것이다.

[[/data-architect/04_what_is_ontology]]에서 "대시보드는 답을 보여주고, 온톨로지는 그 답으로 세계를 바꾼다"고 했다. `action_log`가 그 메커니즘이다.

---

## 에이전트 월드모델

인시던트 이후 마켓온은 AI 추천 에이전트를 새로 구축했다. 이전 에이전트가 실패한 이유가 "K씨의 불완전한 세계관"이었으므로, 새 에이전트에게는 온톨로지를 세계관으로 제공했다.

에이전트는 raw 테이블을 직접 조회하지 않는다. 대신 두 가지 인터페이스만 쓴다.

**인터페이스 1: 허용된 동사 목록**

```sql
-- 에이전트가 'customer' 타입에 실행할 수 있는 액션 조회
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

에이전트는 이 네 가지만 알고 있다. `delete_customer`, `export_pii`, `change_email`은 `allowed_callers`에 `agent:recommendation`이 없어서 보이지 않는다. 에이전트가 **존재하지 않는 동사를 만들어내는 환각**이 구조적으로 막힌다.

**인터페이스 2: 링크 그래프를 통한 고객 이해**

에이전트가 "K씨에게 지금 실행 가능한 액션은 무엇인가?"를 물을 때, 온톨로지를 통해 K씨의 세계를 읽는다.

```sql
-- 에이전트: K씨의 현재 상태를 링크 그래프에서 읽는다
WITH customer_state AS (
  SELECT
    -- placed 링크로 구매 이력
    (SELECT MAX(o.completed_at)
     FROM `marketeon.ontology.links` l
     JOIN `marketeon.ontology.orders` o ON o.canonical_id = l.target_id
     WHERE l.source_id = 'CUST-029182' AND l.rel_type = 'placed'
       AND l.valid_to IS NULL)                        AS last_purchase_at,

    -- received 링크로 미사용 쿠폰 수
    (SELECT COUNT(*)
     FROM `marketeon.ontology.links` l
     JOIN `marketeon.ontology.coupons` c ON c.canonical_id = l.target_id
     WHERE l.source_id = 'CUST-029182' AND l.rel_type = 'received'
       AND c.used_at IS NULL AND l.valid_to IS NULL)  AS active_coupon_count
)
SELECT
  ad.action_name,
  ad.description,
  CASE ad.action_name
    WHEN 'issue_churn_coupon'
      THEN TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), cs.last_purchase_at, DAY) >= 90
           AND cs.active_coupon_count = 0
    WHEN 'upgrade_tier'
      THEN (SELECT SUM(o.amount)
            FROM `marketeon.ontology.links` l
            JOIN `marketeon.ontology.orders` o ON o.canonical_id = l.target_id
            WHERE l.source_id = 'CUST-029182' AND l.rel_type = 'placed'
              AND o.completed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 365 DAY)
           ) >= 3000000
    ELSE TRUE
  END AS executable
FROM `marketeon.ontology.action_def` ad, customer_state cs
WHERE ad.target_entity_type = 'customer'
  AND 'agent:recommendation' IN UNNEST(ad.allowed_callers)
  AND ad.valid_to IS NULL;
```

```
action_name            | description              | executable
issue_churn_coupon     | 이탈 방어 쿠폰 발송       | FALSE   ← 이틀 전 구매 있음
issue_birthday_coupon  | 생일 쿠폰 발송            | FALSE   ← 생일 아님
recommend_product      | 상품 추천 발송            | TRUE
upgrade_tier           | 등급 상향                 | TRUE    ← 연 GMV 300만 달성
```

에이전트는 이 결과를 받아 `recommend_product`와 `upgrade_tier`만 실행한다. K씨의 테이블 스키마를 몰라도, 소스 시스템이 몇 개인지 몰라도, 링크 그래프 위에 올라탄 추상화가 K씨의 세계를 전달한다.

이것이 [[/data-architect/04_what_is_ontology]]에서 말한 **"에이전트의 월드모델"** 이다. 테이블 1,000개의 스키마 대신 객체·관계·허용된 행동으로 압축된 지도. 환각이 줄고 행동이 통제 가능해진다.

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
ts                   | event                      | status    | block_reason
2024-08-02 10:11:00  | link.placed.order          | created   |
2024-09-15 14:30:00  | link.placed.order          | created   |
2024-10-14 16:45:00  | link.placed.order          | created   |
2024-11-21 11:20:00  | link.placed.order          | created   |
2024-12-08 14:23:00  | link.placed.order          | created   |
2024-12-10 09:02:00  | issue_churn_coupon         | blocked   | 최근 90일 내 구매 이력 있음
2024-12-10 09:05:00  | upgrade_tier               | completed |
2024-12-10 09:05:00  | link.received.coupon       | created   |   ← upgrade 혜택 쿠폰
```

---

## 한계

**Identity resolution은 끝나지 않는다.** 이메일 없는 POS 회원, 게스트 주문, 전화번호가 바뀐 고객. `confidence < 0.9`인 매핑은 주당 수백 건 쌓인다. 온톨로지를 도입한다는 건 entity resolution을 영원히 운영하겠다는 선언이다.

**정의 합의는 기술이 해결하지 않는다.** `prop_def`에 `last_purchase_at` 정의를 등록하는 것 자체는 하루면 됐다. 마케팅·재무·데이터팀이 "전채널 기준"에 동의하는 데 두 달이 걸렸다. 스키마는 합의를 *기록*하지 합의를 *만들어내지* 않는다.

**precondition이 코드를 완전히 대체하지는 못한다.** 복잡한 비즈니스 룰은 여전히 코드가 필요하다. JSON precondition은 계약(contract)이고, 이행은 코드의 일이다.

**Dynamic Loop가 작동하려면 action_log 품질이 담보돼야 한다.** blocked 기록이 부정확하면 그것을 피처로 쓴 모델도 부정확해진다. 쓰레기가 들어오면 쓰레기가 나간다.

---

## 에필로그

K씨의 알람은 2만원짜리 사건이었다. 드릴다운하자 온톨로지의 다섯 개념이 모두 모습을 드러냈다.

| 부재 | 개념 | 해결 |
|------|------|------|
| K씨가 두 시스템에 분리됨 | Entity + Identity | `canonical_id` + `customer_identity` |
| 구매가 채널별로 분리됨 | Link | `placed` 링크로 전채널 통합 |
| "마지막 구매"의 의미가 없음 | Property Definition (SCD2) | `prop_def`에 버전 관리된 정의 |
| 쿠폰이 조건 없이 발송됨 | Action (Kinetic Layer) | `action_def`의 precondition 게이트 |
| blocked 기록이 허공에 사라짐 | Dynamic Layer | `action_log` → 피처 → 모델 피드백 루프 |

그리고 다섯 개념이 맞물리자 여섯 번째가 자연스럽게 따라왔다. 에이전트에게 raw 테이블 대신 이 그래프를 주었을 때, 에이전트는 K씨의 세계를 이해하고 허용된 동사만 실행했다. 온톨로지가 **에이전트의 월드모델**이 된 것이다.

시맨틱 레이어는 이 여정에서 빠지지 않는다. GMV metric이 올바른 숫자를 내려면 그 아래에 올바른 K씨가 있어야 한다. 온톨로지는 그 아래 레이어다.

> 모델이 틀린 게 아니었다. 모델이 본 K씨가 불완전했다. 온톨로지는 K씨를 완전하게 만드는 일이다.

---

## 참고

- [[/data-architect/04_what_is_ontology]] — 온톨로지의 개념과 아키텍처 원리: Semantic·Kinetic·Dynamic 3계층
- Sculley et al., [*Hidden Technical Debt in Machine Learning Systems*](https://papers.nips.cc/paper/5656-hidden-technical-debt-in-machine-learning-systems) (NIPS 2015) — 피처 의미 드리프트가 ML 시스템에 미치는 영향
- Milner, [*Action calculi, or syntactic action structures*](https://link.springer.com/chapter/10.1007/3-540-57182-5_7) (MFCS 1993) — 행위(action)를 일급 시민으로 다루는 이론적 배경
