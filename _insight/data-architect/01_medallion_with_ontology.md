---
layout  : insight
title   : 메달리언 위에 온톨로지를 얹다
date    : 2026-06-29 00:00:00 +0900
updated : 2026-06-29 00:00:00 +0900
tag     : data-architecture data-engineering medallion ontology
toc     : true
comment : true
latex   : true
status  : writing
public  : true
confidence: medium
parent  : [[/data-architect]]
relations:
  - { type: extends, target: concept/data-architect/03_medallion_advanced_patterns }
  - { type: extends, target: concept/data-architect/04_what_is_ontology }
  - { type: references, target: concept/data-architect/06_how_to_implement_ontology }
  - { type: references, target: insight/data-architect/00_ontology_core_examples }
---
* TOC
{:toc}

> 두 시리즈가 같은 회사를 다뤘다. [[/data-architect/00_what_is_medaliion_architecture]]부터 [[/data-architect/03_medallion_advanced_patterns]]까지는 마켓온의 데이터가 Bronze·Silver·Gold를 거쳐 *깨끗해지는* 이야기였고, [[/data-architect/04_what_is_ontology]]부터 [[/data-architect/07_ontology_core_concepts]]까지는 같은 마켓온의 데이터가 *의미를 갖는* 이야기였다. 이 글은 두 이야기가 사실 한 스택의 아래층과 위층이라는 것을 보인다.

메달리언은 행(行)을 신뢰 가능하게 만든다. 온톨로지는 그 행이 가리키는 세계를 신뢰 가능하게 만든다. 그리고 결정적으로 — **온톨로지는 메달리언을 대체하지 않는다. 메달리언의 Silver 위에 올라탄다.** 이 글의 주장은 그 적층 지점이 정확히 어디인지, 왜 거기인지, 그리고 메달리언의 패턴들이 어떻게 온톨로지의 구조로 다시 태어나는지다.

---

## 같은 회사, 두 사건, 두 층

마켓온에는 두 번의 유명한 사고가 있었다. 둘 다 데이터 사고였고, 둘 다 새벽에 시작됐다. 그런데 해결책이 살았던 층이 달랐다.

**첫 번째 사고** — [[/data-architect/01_how_to_architect_medallion_well]]. ERP가 주문 상태 코드를 `'C'`에서 `'CM'`으로 바꾼 새벽, 47개 쿼리가 동시에 깨지며 GMV가 0이 됐다. 진짜 원인은 코드 변경이 아니라 그 변경을 흡수할 레이어의 부재였다. 답은 Silver였다 — 소스의 언어(`'C'`, `'CM'`)를 비즈니스의 언어(`is_completed`)로 번역하는 한 곳.

**두 번째 사고** — [[/data-architect/06_how_to_implement_ontology]]. 이탈 모델이 VIP K씨를 위험군으로 분류해 쿠폰을 쐈지만, K씨는 이틀 전 오프라인 매장에서 51만 원을 결제한 충성 고객이었다. CRM의 `U-29182`와 POS의 `M-00991`이 같은 사람이라는 걸 어떤 시스템도 몰랐다. 답은 온톨로지였다 — `canonical_id`, `placed` 링크, 그리고 `action_def` 게이트.

두 사고를 나란히 두면 경계가 드러난다.

| | 1차 사고 (ERP 'CM') | 2차 사고 (K씨 채널전환) |
|--|---------------------|------------------------|
| 깨진 것 | 행의 *값*이 잘못 해석됨 | 행이 *누구를* 가리키는지 모름 |
| 부재한 것 | 소스→비즈니스 번역 레이어 | 엔티티·관계·행위 모델 |
| 해결 층 | **Silver** (메달리언) | **온톨로지** (Silver 위) |
| 한 줄 | 행을 신뢰 가능하게 | 세계를 신뢰 가능하게 |

1차 사고는 메달리언이 막을 수 있었다. 2차 사고는 메달리언만으로는 막을 수 없었다. **신뢰 가능한 행이 신뢰 가능한 세계는 아니기 때문이다.** 그 간극이 이 글의 출발점이다.

---

## 메달리언이 멈추는 곳

[[/data-architect/01_how_to_architect_medallion_well]]의 Silver는 훌륭하게 작동했다. `marketeon.silver.orders`는 ERP·CRM·POS의 주문을 정제하고, `is_completed BOOL`로 상태를 표준화하고, `canonical_customer_id`로 고객을 통합한 신뢰 가능한 단일 출처다.

그런데 그 Silver 행을 손에 쥐고도 답할 수 없는 질문이 세 가지 있다.

```text
silver.orders 한 행:
  order_id            = "ORD-erp-90021"
  canonical_customer_id = "CUST-029182"   ← 통합은 됐다
  amount              = 512000
  is_completed        = TRUE              ← 표준화는 됐다
  completed_at        = 2024-12-08

  Q1. 이 customer는 "무엇"인가?       → 행은 안다. 그런데 customer는 테이블이 아니다.
  Q2. 이 customer는 무엇과 연결되는가? → 다른 채널 주문, 쿠폰, 등급 변화는 어디에?
  Q3. 이 customer에게 무엇이 허용되는가? → 쿠폰을 쏴도 되나? 누가 결정하나?
```

Silver는 **행을 정합**시킨다. 하지만 **엔티티를 모델링**하지는 않는다. `canonical_customer_id`는 같은 사람을 한 키로 묶었지만, 그 키가 가리키는 *Customer라는 개념*, 그 Customer가 주문과 맺는 *placed라는 관계*, 그 Customer에게 허용된 *issue_churn_coupon이라는 행위* — 이 셋은 Silver 스키마 어디에도 없다.

[[/data-architect/04_what_is_ontology]]의 언어로 말하면, Silver에는 **명사는 흩어져 있고, 동사와 시간은 없다.** 이것이 메달리언이 멈추는 정확한 지점이다. 그리고 온톨로지가 시작하는 지점이기도 하다.

> Silver는 "이 행은 믿을 수 있다"까지 책임진다. "이 행이 가리키는 K씨는 누구이고 무엇을 할 수 있는가"는 그 위 레이어의 일이다.

---

## 결합 아키텍처 — 온톨로지는 Silver 위, Gold 옆에 선다

핵심 질문은 하나다. **온톨로지를 메달리언 스택의 어디에 끼우는가?** 답은 Bronze도 Gold도 아닌 **Silver 바로 위**다. 전체 그림은 이렇다.

```text
                          소비 · 행위자
        ┌──────────────┬───────────────┬───────────────┐
        │   BI·리포트    │   AI 에이전트   │    운영 앱      │
        └──────▲───────┴───────▲───────┴───────▲───────┘
   ════════════╪═══════════════╪═══════════════╪══════════  소비 표면
        metric layer       Object Set       Action 실행
       (gold.metric_gmv)  (VIP 847명 집합)  (issue_churn_coupon)
   ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
   ║                  ONTOLOGY LAYER (의미 · 운동 · 시간)        ║
   ║   Object Type ·  Property  ·  Link Type ·  Action Type   ║
   ║   customers     last_purchase  placed      action_def    ║
   ║   customer_identity  prop_def  links        action_log   ║
   ┄┄┄┄┄┄┄┄┄┄▲┄┄┄┄┄┄┄┄┄┄┄┄▲┄┄┄┄┄┄┄┄┄┄┄┄▲┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
              │            │             │
   ───────────┼────────────┼─────────────┼──────────────────  Silver (정제)
        canonical_customer_id · is_completed · _source_status_raw
                           ▲
   ────────────────────────┼─────────────────────────────────  Bronze (원본)
        erp_orders · crm_orders · pos_purchases  (원본 코드 보존)
                           ▲
                    소스 시스템 (ERP · CRM · POS)
```

세 가지가 이 그림의 전부다.

1. **온톨로지는 Silver를 먹고 산다.** Object의 Primary Key(`canonical_id`)는 Silver의 entity resolution 결과(`canonical_customer_id`)다. Property 값(`is_completed`)은 Silver의 표준화 결과다. 온톨로지는 Bronze의 원본 코드(`'CM'`)를 절대 직접 보지 않는다 — 그건 Silver가 흡수한다.

2. **온톨로지는 Gold 아래, Gold 옆에 동시에 선다.** Gold의 metric layer(`metric_gmv`)는 이제 Silver를 직접 집계하는 대신, 온톨로지의 Derived Property(`last_purchase_at` via `placed`)를 집계한다. metric은 온톨로지 *위*의 소비 표면이 된다.

3. **Action은 메달리언에 없던 완전히 새로운 축이다.** Bronze·Silver·Gold는 모두 *읽기* 파이프라인이다. `issue_churn_coupon` 같은 Action은 세계를 *바꾼다*. 이 운동(kinetic) 계층은 메달리언 어디에도 대응물이 없다 — 온톨로지가 더하는 순수한 증분이다.

메달리언과 온톨로지의 구조를 한 줄씩 대응시키면 결합 지점이 분명해진다.

| 메달리언 산출물 | 온톨로지 구조 | 결합 방식 |
|----------------|--------------|----------|
| Silver `canonical_customer_id` | Object Type Primary Key | Silver ER 결과가 곧 Object의 식별자 |
| Silver `is_completed` (표준화 값) | Property (Scalar) | Silver 표준화 결과가 Property 값 |
| Silver 다채널 통합 행 | Link Type (`placed`) | 통합된 행들을 관계로 재구성 |
| Gold metric layer | metric on Derived Property | Gold가 온톨로지 위에서 집계 |
| (대응물 없음) | Action Type (Kinetic) | 온톨로지가 더하는 새 축 |
| Bronze 보존 → 재처리 | Dynamic Loop (action_log → feature) | 재처리 루프가 의사결정 루프로 확장 |

---

## Silver가 온톨로지의 기반이다

결합의 첫 번째 자리는 **동일성**이다. [[/data-architect/03_medallion_advanced_patterns]]의 Identity Resolution 패턴과 [[/data-architect/06_how_to_implement_ontology]]의 Object Type은 사실 같은 작업의 두 이름이다.

03편은 다소스 고객을 `canonical_id`로 통합하는 일을 *Silver 패턴*으로 불렀다.

```sql
-- 03편 Identity Resolution: Silver에서 결정적 매칭으로 canonical 부여
MERGE `marketeon.silver.customer_identity_map` T
USING (
  SELECT source_system, source_id, email_hash
  FROM `marketeon.bronze.erp_orders`
  WHERE email_hash IS NOT NULL
) S
ON T.source_system = S.source_system AND T.source_id = S.source_id
WHEN NOT MATCHED THEN
  INSERT (source_system, source_id, canonical_id)
  VALUES (S.source_system, S.source_id, TO_HEX(SHA256(S.email_hash)));
```

06편은 *똑같은 매핑*을 온톨로지의 Object Type + Entity Resolution으로 불렀다.

```sql
-- 06편 Object Type: 같은 매핑이 온톨로지 식별자 테이블이 된다
CREATE TABLE `marketeon.ontology.customer_identity` (
  source_system   STRING    NOT NULL,
  source_id       STRING    NOT NULL,
  canonical_id    STRING    NOT NULL,   -- ← Silver의 canonical_customer_id와 동일 키
  match_rule      STRING    NOT NULL,
  confidence      FLOAT64   NOT NULL,
  matched_at      TIMESTAMP NOT NULL
);
```

두 테이블의 `canonical_id`는 **같은 값**이다. 01편 Silver 변환이 `ci.canonical_id`를 `LEFT JOIN`으로 붙였던 그 매핑(`marketeon.ontology.customer_identity`)이, 06편에서 온톨로지 Object의 Primary Key 소스가 된다. 즉 메달리언 시리즈와 온톨로지 시리즈는 *코드 레벨에서 이미 같은 테이블을 공유하고 있었다.*

결합 아키텍처에서 이 관계를 명시적으로 못 박는다.

```text
Bronze: 소스별 raw ID
   erp.user_id="29182"  crm.member_no="M-00991"  pos.phone_hash="a3f.."
        │                      │                       │
        ▼  (Silver Identity Resolution = 온톨로지 Entity Resolution)
   ┌─────────────────────────────────────────────────────────┐
   │  canonical_id = "CUST-029182"                            │  ← 단 하나의 키
   └─────────────────────────────────────────────────────────┘
        │                                          │
        ▼ Silver 행에 부착                          ▼ Object Type Primary Key
   silver.orders.canonical_customer_id      ontology.customers.canonical_id
        (행을 정합)                              (개념을 식별)
```

여기서 [[/data-architect/00_ontology_core_examples]]가 1번 축에서 못 박은 경고가 그대로 살아난다 — entity resolution은 끝나는 배치가 아니라 멈추지 않는 운영이다. 메달리언 관점에서 보면 이것은 **Silver 재처리가 곧 온톨로지 Object 재생성**이라는 뜻이다. Silver의 ER 품질이 흔들리면 그 위 온톨로지 전체가 흔들린다.

<div class="callout-note">
Silver의 entity resolution 품질 = 온톨로지 모델 품질의 상한. 04편 §5가 "모델의 품질은 정확히 그 키의 품질만큼이다"라고 한 그 키를, 메달리언에서는 Silver가 만든다. 온톨로지를 잘 지으려면 먼저 Silver를 잘 지어야 한다.
</div>

---

## 메달리언 패턴이 온톨로지 구조가 된다

동일성 하나만 겹치는 게 아니다. [[/data-architect/03_medallion_advanced_patterns]]가 SQL로 굳힌 패턴들이 거의 그대로 온톨로지 구조로 다시 태어난다. 같은 메커니즘, 다른 대상이다.

### SCD2 두 번 — 데이터의 SCD2와 의미의 SCD2

03편의 시그니처 패턴은 SCD Type 2였다 — 변하는 차원을 덮지 않고 `valid_from`/`valid_to` 이력 행으로 쌓는 것. 대상은 *데이터*였다(고객 등급).

```sql
-- 03편: 데이터의 SCD2 — 등급 변경을 이력으로
MERGE `marketeon.silver.dim_customer` T
USING (...) S
ON T.customer_id = S.customer_id AND T.is_current = TRUE AND T.grade != S.grade
WHEN MATCHED THEN UPDATE SET T.valid_to = S.effective_at, T.is_current = FALSE
WHEN NOT MATCHED BY TARGET THEN
  INSERT (...) VALUES (..., S.effective_at, TIMESTAMP('9999-12-31'), TRUE);
```

06편의 `prop_def`는 *완전히 같은 메커니즘*을 *정의*에 적용한다 — [[/data-architect/04_what_is_ontology]] §6이 "의미의 SCD2"라 부른 것.

```sql
-- 06편: 의미의 SCD2 — 정의 변경을 이력으로
INSERT INTO `marketeon.ontology.prop_def` VALUES (
  'last_purchase_at', 'customer',
  '전채널(CRM+POS) 기준 마지막 구매 완료 시점.',
  'MAX(orders.completed_at) WHERE customer PLACED order',
  'timestamp', FALSE,
  TIMESTAMP '2024-12-11 00:00:00', NULL,   -- valid_from / valid_to
  'data-team', '채널 전환 오분류 대응. 전채널 기준으로 재정의.'
);
```

같은 `valid_from`/`valid_to` 두 컬럼이, 한쪽에서는 "K씨가 *그때* VIP였는가"(데이터)를, 다른 쪽에서는 "그때 last_purchase_at의 *정의가* 무엇이었는가"(의미)를 보존한다. 결합 스택에서는 둘이 **동시에** 돈다.

```text
데이터의 SCD2 (Silver dim)          의미의 SCD2 (ontology prop_def)
─────────────────────────          ──────────────────────────────
"구매 시점 K씨의 등급은?"            "그 시점 last_purchase_at의 정의는?"
  grade=GOLD  [~2024-06]              v1: CRM 단독  [~2024-12-10]
  grade=VIP   [2024-06~]              v2: 전채널    [2024-12-11~]
        │                                    │
        └──────────┬─────────────────────────┘
                   ▼
        둘 다 살아 있어야 "as-of 재현"이 가능하다:
        그 시점의 정의로 · 그 시점의 데이터를
```

[[/data-architect/00_ontology_core_examples]]가 4번 축에서 경고한 함정이 여기서 두 배가 된다. *과거였던 것*과 *틀린 것*을 섞지 말라는 규칙이, 데이터 SCD2(오래된 등급 ≠ 틀린 등급)와 의미 SCD2(과거 정의 ≠ 틀린 정의) 양쪽에 똑같이 적용된다.

### DQ 계약이 Action Guard가 된다

[[/data-architect/02_how_to_architect_medallion_well]]는 레이어 경계를 *데이터 계약(data contract)의 검증 지점*으로 봤다. "계약을 어긴 데이터는 다음 층으로 넘어가지 못한다." 06편의 Action validation은 같은 원리를 *행위*에 적용한 것이다. "계약을 어긴 행위는 실행되지 못한다."

```sql
-- 02·03편: 행에 대한 계약 (fail-fast)
ASSERT (
  SELECT COUNT(*) FROM `marketeon.silver.orders`
  WHERE DATE(completed_at) = CURRENT_DATE()
    AND (amount < 0 OR is_completed IS NULL)
) = 0 AS 'Silver DQ 위반 — Gold 갱신 중단';

-- 06편: 행위에 대한 계약 (action guard)
SELECT NOT (m.days_since_purchase < 90 OR a.cnt > 0) AS can_execute
FROM customer_metrics m, active_coupons a;
-- can_execute=FALSE → issue_churn_coupon 차단, action_log에 block_reason 기록
```

둘은 같은 문장의 두 시제다 — 하나는 데이터가 *다음 단계로 흐르기 전에*, 하나는 행위가 *세계를 바꾸기 전에* 계약을 검사한다. 결합 스택에서 DQ 게이트는 두 종류가 된다.

| 계약 위치 | 무엇을 막나 | 메달리언/온톨로지 | 실패 시 |
|-----------|------------|-------------------|---------|
| Silver 적재 후 | 나쁜 *행* | 메달리언 DQ | Gold 갱신 중단 (fail-fast) |
| Gold 진입 직전 (WAP) | 검증 안 된 *집계* | 메달리언 WAP | publish 중단 |
| Action 실행 직전 | 허용 안 된 *행위* | 온톨로지 guard | action 차단 + 로그 |

세 게이트가 한 스택 위에 수직으로 늘어선다. 행도, 집계도, 행위도 계약 없이는 다음으로 넘어가지 못한다.

### Late-Arriving와 링크의 시간

03편의 Late-Arriving Data 패턴은 `event_at` 기준으로 늦은 이벤트를 흡수했다. 온톨로지에서 `links` 테이블은 `valid_from`을 가진다 — 관계 자체가 시간을 갖는다. 늦게 도착한 POS 주문은 Silver에서 `event_at` 파티션에 안착하고(메달리언), 그 위에서 `placed` 링크가 `valid_from = event_at`으로 생성된다(온톨로지). 시간의 일관성이 두 레이어를 관통한다.

---

## Gold를 다시 본다 — metric은 온톨로지 위에서 산다

결합 스택에서 Gold의 의미가 미묘하게 바뀐다. 순수 메달리언에서 Gold는 Silver를 직접 집계했다.

```sql
-- 순수 메달리언 Gold: Silver를 직접 집계
CREATE OR REPLACE TABLE `marketeon.gold.daily_gmv` AS
SELECT DATE(completed_at) AS dt, source_system, SUM(amount) AS gmv
FROM `marketeon.silver.orders`
WHERE is_completed = TRUE
GROUP BY 1, 2;
```

이 쿼리는 1차 사고를 막는다('CM'을 Silver가 흡수했으므로). 하지만 2차 사고는 못 막는다 — `source_system`별로 GMV를 나눠도, K씨의 CRM GMV와 POS GMV가 *같은 사람의 것*이라는 사실은 여기 없다. Gold가 Silver 위에서 집계하는 한, 집계의 단위는 여전히 *행*이지 *엔티티*가 아니다.

결합 스택에서 Gold metric layer는 온톨로지의 Derived Property 위에서 집계한다.

```sql
-- 결합 Gold metric: 온톨로지 placed 링크 위에서 집계 (엔티티 단위)
CREATE OR REPLACE TABLE `marketeon.gold.metric_customer_gmv_90d` AS
SELECT
  l.source_id                          AS canonical_id,   -- 행이 아니라 사람
  SUM(o.amount)                        AS gmv_90d,
  MAX(o.completed_at)                  AS last_purchase_at -- 전채널 Derived Property
FROM `marketeon.ontology.links` l
JOIN `marketeon.ontology.orders` o ON o.canonical_id = l.target_id
WHERE l.rel_type = 'placed'
  AND l.valid_to IS NULL
  AND o.completed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
GROUP BY 1;
-- CUST-029182 | 835,000 | 2024-12-08  ← 전채널 합산, 이틀 전
```

이것이 03편 Gold 2-Tier(metric/mart 분리)와 [[/data-architect/04_what_is_ontology]] §3의 시맨틱 레이어 구분을 하나로 묶는다. 수직 적층은 이렇게 완성된다.

```text
       ┌─────────────────────────────────────────┐
   3   │  Mart Layer  (부서별 조립)                 │  "얼마인가"의 조립
       ├─────────────────────────────────────────┤
   2   │  Metric Layer  (지표 단일 정의)            │  "얼마인가"의 정의 = 시맨틱 레이어
       ├═════════════════════════════════════════┤
   1   │  Ontology  (Object·Link·Action·prop_def)  │  "무엇·연결·행위"의 정의
       ├─────────────────────────────────────────┤
   0   │  Silver  (정제·표준화·canonical 통합)       │  "신뢰 가능한 행"
       └─────────────────────────────────────────┘
```

04편이 "온톨로지는 *고객*의 의미를, 시맨틱 레이어는 *고객 매출*의 측정을 정의한다"고 갈랐던 그 두 층이, 결합 스택에서는 Gold metric layer(2)와 ontology layer(1)로 물리적 자리를 얻는다. 둘은 경쟁이 아니라 위아래다 — 04편이 "보완재"라 한 것의 아키텍처적 실체다.

---

## 동역학 — 재처리 루프가 의사결정 루프로 확장된다

메달리언의 가장 깊은 가치 중 하나는 *재처리 가능성*이었다(00편 핵심 원칙 2). Bronze에 원본이 살아 있으므로 로직이 바뀌면 Silver·Gold를 다시 만들 수 있다. 온톨로지의 가장 깊은 가치 중 하나는 *Dynamic Loop*다(06편) — 내려진 결정이 다시 데이터가 되어 더 나은 결정으로 되먹임된다.

결합 스택에서 이 둘이 하나의 큰 순환으로 이어진다.

```text
   ┌──────────────────────────────────────────────────────────────┐
   │                                                                │
   ▼                                                                │
 소스 시스템 ──▶ Bronze ──▶ Silver ──▶ Ontology ──▶ Action 실행/차단 │
 (ERP/CRM/POS)   원본보존   표준화·ER   Object·Link   issue_coupon     │
                                          │           (blocked)       │
                                          ▼                           │
                                    action_log  ────────────────────┐ │
                                    (결정의 기록)                     │ │
                                          │                          │ │
                                          ▼                          │ │
                              "847명 채널전환 신호" 피처 ◀────────────┘ │
                                          │                            │
                                          └─▶ 다음 Silver 적재의 입력 ──┘
                                              (결정이 다시 데이터로)
```

K씨의 `blocked` 기록(온톨로지 Dynamic Layer)이 `action_log`에 쌓이고, 847명의 같은 패턴이 채널 전환 신호라는 새 피처가 되고, 그 피처가 *다시 Silver 적재의 입력*이 되어 모델을 고친다. 메달리언의 단방향 흐름(Bronze→Gold)이 온톨로지의 Action을 만나 *닫힌 고리*가 된다.

여기서 메달리언의 멱등성 원칙(00편 핵심 원칙 4)이 결정적으로 중요해진다. Action이 데이터를 되먹이는 순간, `action_log`는 새로운 소스가 된다. 이 소스도 Bronze→Silver를 거쳐야 하고, 03편의 Backfill Ambiguity 안티패턴(백필 시 `MERGE`로 멱등)이 그대로 적용된다. 의사결정 루프가 멱등하지 않으면, 한 번의 재처리가 결정 기록을 두 배로 부풀린다.

<div class="callout-warning">
온톨로지의 Action이 쓰는 데이터(action_log, 생성된 Coupon, received 링크)도 결국 메달리언을 다시 통과해야 한다. Dynamic Loop는 메달리언의 멱등 재처리 위에서만 안전하다 — 결정이 데이터가 되는 순간, 그 데이터에도 Bronze 보존·MERGE 멱등·event_at 기준이 똑같이 요구된다.
</div>

---

## 에이전트 — 스택의 머리

결합 스택의 맨 위에는 AI 에이전트가 앉는다. [[/data-architect/04_what_is_ontology]] §7과 06편이 보였듯, 에이전트는 Bronze의 테이블 1,000개 스키마를 보지 않는다. 온톨로지가 주는 객체·관계·허용된 행위만 본다.

```text
 에이전트: "오늘 이탈 위험 VIP 중 쿠폰 보낼 수 있는 사람?"
     │
     │ (raw 테이블 접근 없음)
     ▼
 Object Set: Customer.where(tier="VIP").where(days_since_purchase > 60)
     │  └─ Derived Property는 placed 링크 위에서 전채널 계산 (K씨 같은 오분류 차단)
     ▼
 Action 후보: action_def에서 allowed_callers='agent:recommendation' 필터
     │  └─ issue_churn_coupon의 guard가 days_since_purchase>=90 검사 → 대부분 차단
     ▼
 허용된 동사만 실행 (존재하지 않는 동사 환각 = 구조적 차단)
```

여기서 메달리언과 온톨로지의 결합이 마지막 의미를 갖는다. 에이전트가 신뢰할 수 있는 행동을 하려면, 그 아래 모든 층이 신뢰 가능해야 한다 — Bronze가 원본을 보존하고(추적성), Silver가 표준화하고(1차 사고 방지), 온톨로지가 entity·link·action을 모델링하고(2차 사고 방지), 그제서야 에이전트는 K씨를 *완전하게* 본다. **에이전트의 월드모델은 메달리언 스택 전체의 신뢰도 위에 선다.**

---

## 결합 안티패턴 — 잘못 끼우는 네 가지

온톨로지를 메달리언에 끼울 때 자리를 틀리면 두 아키텍처의 장점이 동시에 무너진다. [[/data-architect/03_medallion_advanced_patterns]]와 [[/data-architect/00_ontology_core_examples]]의 안티패턴 형식을 빌려 결합 고유의 실패를 줄 세운다.

### 안티패턴 1 — Bronze 위에 온톨로지 얹기

표준화를 건너뛰고 raw 위에 Object를 세우면, 소스의 언어가 온톨로지로 새어든다. ERP의 `'CM'`이 그대로 Object Property가 되고, 1차 사고가 온톨로지 층에서 재발한다.

```sql
-- ✗ Bronze 직결: 소스 코드가 Object property로 새어듦
SELECT order_id, order_status AS status   -- 'C'? 'CM'? 'COMP'? 표준화 안 됨
FROM `marketeon.bronze.erp_orders`;

-- ✓ Silver를 먹고 산다: 표준화된 값만 Object property로
SELECT order_id, is_completed             -- BOOL, 소스 무관
FROM `marketeon.silver.orders`;
```

**온톨로지는 Silver 위에 선다 — Bronze가 아니라.**

### 안티패턴 2 — Gold(집계) 위에 온톨로지 얹기

반대 실수. 이미 집계된 Gold 위에 온톨로지를 세우면, 행 단위 entity·link가 사라진 뒤다. `daily_gmv`에는 K씨가 없다 — 날짜와 채널만 있다. 집계 후에는 동일성을 복원할 수 없다.

**온톨로지는 Silver 위, Gold 아래에 선다 — 집계되기 전 엔티티가 살아 있는 층.**

### 안티패턴 3 — 온톨로지를 메달리언과 분리된 프로젝트로

[[/data-architect/04_what_is_ontology]] §8의 최상위 실패 모드(프로젝트 취급)가 결합 맥락에서 더 날카로워진다. 온톨로지를 Silver와 동기화하지 않으면, Silver가 재처리될 때 온톨로지가 *옛 세계*를 가리킨다. 메달리언의 재처리 가능성이 온톨로지를 배신한다.

```text
✗ 분리:   Silver 재처리 → canonical 키 변경 → 온톨로지는 모름 → links 고아 발생
✓ 결합:   Silver 재처리 ⇒ 온톨로지 Object/Link 재생성 (같은 파이프라인 DAG)
```

**Silver 재처리와 온톨로지 재생성은 한 DAG여야 한다.**

### 안티패턴 4 — 두 SCD2를 하나로 뭉개기

데이터의 SCD2(등급 이력)와 의미의 SCD2(정의 이력)를 같은 테이블·같은 멘탈모델로 다루면, "K씨가 그때 VIP였나"와 "그때 VIP의 정의가 뭐였나"가 섞인다. 둘은 다른 축이다 — 하나는 사실의 시간, 하나는 정의의 시간.

**데이터의 시간과 정의의 시간은 분리해 보존한다.**

| 안티패턴 | 증상 | 처방 |
|----------|------|------|
| Bronze 직결 | 소스 코드가 Object property에 노출 | 온톨로지는 Silver 위에 |
| Gold 직결 | Object에서 동일성이 사라짐 | 온톨로지는 Gold 아래에 |
| 분리된 프로젝트 | Silver 재처리 후 link 고아 | 재처리를 한 DAG로 |
| SCD2 뭉개기 | 사실 시간과 정의 시간 혼동 | 두 SCD2 분리 보존 |

---

## 한계

**레이어가 하나 더 늘어난다 = 지연이 더 쌓인다.** 메달리언의 한계(00편: 계층마다 지연 누적)에 온톨로지 변환이 한 단계 더해진다. Bronze→Silver→Ontology→Gold. 준실시간 요구에서는 Object/Link 재생성 비용을 따로 계산해야 한다.

**온톨로지 품질은 Silver 품질에 묶인다.** 앞서 못 박았듯 entity resolution의 상한이 Silver에 있다. Silver의 `canonical_id`가 K씨를 둘로 나누면, 그 위 온톨로지·Gold metric·에이전트가 전부 둘로 본다. 결합은 신뢰를 적층하지만, 동시에 *불신도 적층*한다.

**두 SCD2의 운영 복잡도.** 데이터 이력과 정의 이력을 동시에 굴리는 것은 단일 SCD2보다 운영 부담이 크다. as-of 재현 쿼리는 두 시간 축을 동시에 맞춰야 한다.

**합의는 여전히 기술 바깥에 있다.** 06편 한계의 재확인. `prop_def`에 전채널 정의를 등록하는 데 하루, 조직이 "전채널 기준"에 동의하는 데 두 달이 걸렸다. 메달리언이 행을 깨끗이 만들고 온톨로지가 의미를 형식화해도, 그 의미에 대한 *합의*는 회의실의 일이다.

---

## 에필로그

마켓온의 두 사건은 한 회사의 다른 높이에서 일어났다. ERP `'CM'`은 Silver가 막았어야 했고, K씨 채널전환은 온톨로지가 막았어야 했다. 둘을 따로 읽으면 별개의 교훈이지만, 한 스택으로 겹쳐 읽으면 하나의 문장이 된다.

> 메달리언은 데이터가 깨끗한지를 묻고, 온톨로지는 그 데이터가 무엇을 뜻하는지를 묻는다. 신뢰는 아래에서 위로 쌓인다 — 원본의 보존에서, 행의 표준화로, 엔티티의 모델링으로, 행위의 거버넌스로.

온톨로지는 메달리언을 대체하지 않는다. Silver가 끝나는 곳에서 시작한다. 그리고 그 위에 metric이, 그 위에 에이전트가 선다. 한 층이라도 거짓말을 하면 위층 전부가 거짓말을 한다. 그래서 결합 아키텍처의 규칙은 단순하다 — **각 층은 바로 아래 층만 믿고, 자기 책임만큼만 변환한다.**

[[/data-architect/00_ontology_core_examples]]가 다음 자리로 "온톨로지 정렬과 연합"을 예고했다. 결합 스택의 다음 질문도 거기서 만난다 — 두 회사가 각자의 메달리언+온톨로지 스택을 가졌을 때, 한쪽의 `CUST-029182`와 다른 쪽의 고객을 어떻게 잇는가. 신뢰의 적층을 조직 경계 너머로 확장하는 일이다.

---

## 참고

- [[/data-architect/00_what_is_medaliion_architecture]] — Bronze·Silver·Gold 각 계층의 책임과 핵심 원칙(재처리·멱등·단일 출처)
- [[/data-architect/01_how_to_architect_medallion_well]] — ERP 'C'→'CM' 사고와 Silver의 번역 책임, `marketeon.ontology.customer_identity`의 첫 등장
- [[/data-architect/02_how_to_architect_medallion_well]] — 레이어 경계 판단 룰북과 데이터 계약으로서의 DQ
- [[/data-architect/03_medallion_advanced_patterns]] — SCD2·Identity Resolution·WAP·Gold 2-Tier·Late-Arriving의 SQL 구현
- [[/data-architect/04_what_is_ontology]] — 온톨로지 3계층(Semantic·Kinetic·Dynamic), 시맨틱 레이어와의 구분, 의미의 SCD2
- [[/data-architect/06_how_to_implement_ontology]] — 마켓온 K씨 케이스, Object·Link·prop_def·action_def·action_log의 BigQuery 구현, Dynamic Loop
- [[/data-architect/00_ontology_core_examples]] — 온톨로지 안티패턴 ↔ 베스트 프랙티스 도감, "한 번 잘 만들고 방치"의 변주
- Databricks, *What is the Medallion Lakehouse Architecture?* — 레이어 원형 정의
- Palantir, *Foundry Ontology overview* — Semantic·Kinetic·Dynamic과 온톨로지를 인프라로 운영하는 모델
