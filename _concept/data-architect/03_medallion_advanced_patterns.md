---
layout  : concept
title   : 메달리언 실전 패턴과 안티패턴 SQL로 고도화하기
date    : 2026-06-25 00:00:00 +0900
updated : 2026-06-25 00:00:00 +0900
tag     : data-architect data-architecture design-pattern medallion
toc     : true
comment : true
public  : true
parent  : [[/data-architect]]
latex   : true
status  : complete
show-diagram: true
relations:
  - { type: extends, target: /concept/data-architect/02_how_to_architect_medallion_well }
  - { type: extends, target: /concept/data-architect/01_how_to_architect_medallion_well }
confidence     : medium
---
* TOC
{:toc}

> [[/data-architect/02_how_to_architect_medallion_well]]은 *어느 레이어에 둘지* 판단하는 룰북이었고, 그 끝에서 패턴과 안티패턴을 표 두 장으로 요약하고 멈췄다. 이 글은 그 표의 각 행을 실행 가능한 SQL로 펼친다.

룰을 안다고 구현이 따라오지는 않는다. "변하는 차원은 Silver"라는 룰을 알아도, 막상 `valid_from`/`valid_to` 행을 어떤 `MERGE`로 마감하는지 모르면 매번 처음부터 발명한다. 패턴에 이름이 붙어 있으면 다시 발명하지 않는다.

이 글은 두 가지를 손에 쥐여 준다. 앞쪽 다섯 패턴은 "언제·어떻게 꺼내 쓰는가"를, 뒤쪽 다섯 안티패턴은 "증상으로 자기 코드에서 알아보는 법"을. 도메인 예시는 01편의 마켓온(marketeon) 멀티소스 주문과 02편의 카드 결제를 그대로 이어 쓴다.

<div class="callout-note">
패턴은 레이어 룰의 <strong>실행체</strong>이고, 안티패턴은 그 룰이 무너지는 <strong>구체적 형태</strong>다. 둘은 같은 룰의 양면이다.
</div>

---

## 실전 패턴 — 반복해서 꺼내 쓰는 다섯 형태

02편이 패턴을 한 줄 요약(L188)으로 던졌다면, 여기서는 각 패턴을 SQL 템플릿으로 펼친다. 먼저 다섯 패턴의 시그니처다.

| 패턴 | 무엇을 해결 | 핵심 처방 |
|------|-------------|-----------|
| Write-Audit-Publish | 검증 전 Gold가 노출됨 | staging 검증 후에만 스왑 |
| SCD Type 2 | 변하는 차원이 덮여 과거가 소실 | `valid_from`/`valid_to` 이력 행 |
| Late-Arriving Data | 늦은 이벤트가 누락되거나 전체 재처리 | `event_at` 기준 파티션만 MERGE |
| Identity Resolution | 다소스 고객이 N명으로 중복 | `canonical_id` 매핑 통합 |
| Gold 2-Tier | 지표 정의가 마트마다 표류 | metric(원자) + mart(조립) |

다섯 모두 02편의 어떤 룰이 구현되는 자리다. WAP는 "계약을 어긴 데이터는 다음 층으로 못 넘어간다"(02편 L251)의 Gold 진입 버전이고, SCD2와 Identity Resolution은 "무엇인가는 Silver"(룰 B)·"엔티티 통합 조인은 Silver"(룰 D)의 정식 구현이다. 하나씩 본다.

### Write-Audit-Publish — Gold 오염을 막는 원자적 교체

집계 결과를 Gold에 바로 덮어쓰면, 검증이 실패하는 순간 이미 오염된 숫자가 대시보드에 노출된 뒤다. Write-Audit-Publish(WAP)는 그 순서를 뒤집는다. 먼저 staging에 **Write**하고, 그 위에서 **Audit**(검증)하고, 통과한 경우에만 **Publish**(원자적 교체)한다. 마켓온 일별 GMV 마트를 예로 든다.

나쁜 쪽은 검증과 게시가 한 문장에 묶여 있다. `CREATE OR REPLACE`가 실행되는 순간 결과가 곧 운영 테이블이므로, 검증할 틈이 없다.

```sql
-- ✗ 검증 없이 곧장 게시 → 음수 합계가 그대로 대시보드에 노출
CREATE OR REPLACE TABLE `proj.gold.daily_gmv` AS
SELECT
  DATE(completed_at) AS dt,
  SUM(amount)        AS gmv
FROM `proj.silver.orders`
WHERE is_completed = TRUE
GROUP BY dt;
```

좋은 쪽은 세 단계를 분리한다. staging 테이블에 먼저 쌓고, `ASSERT`로 계약을 검증하고, 통과한 뒤에만 운영 테이블로 교체한다. 검증이 실패하면 `ASSERT`가 스크립트를 멈추므로 Publish 단계에 도달하지 못한다 — Gold는 직전 정상 상태를 유지한다.

```sql
-- ✓ (1) Write: staging에 먼저 적재
CREATE OR REPLACE TABLE `proj.gold._staging_daily_gmv` AS
SELECT
  DATE(completed_at) AS dt,
  SUM(amount)        AS gmv
FROM `proj.silver.orders`
WHERE is_completed = TRUE
GROUP BY dt;

-- ✓ (2) Audit: 계약 위반이 하나라도 있으면 여기서 중단
ASSERT (
  SELECT COUNT(*) FROM `proj.gold._staging_daily_gmv`
  WHERE gmv < 0 OR dt IS NULL
) = 0 AS 'WAP audit 실패 — 음수 GMV 또는 NULL 날짜, publish 중단';

-- ✓ (3) Publish: 검증 통과 후에만 운영 테이블로 교체
CREATE OR REPLACE TABLE `proj.gold.daily_gmv` AS
SELECT * FROM `proj.gold._staging_daily_gmv`;
```

<div class="callout-note">
Gold는 직접 덮어쓰지 않는다 — <strong>Write</strong> → <strong>Audit</strong> → <strong>Publish</strong>. 검증 게이트를 게시 앞에 둔다.
</div>

이것은 02편의 fail-fast 정책(L266)을 Gold 진입 경계에 적용한 형태다. 02편이 "위반 시 즉시 중단"을 원칙으로 말했다면, WAP는 그 중단 지점을 "운영 테이블 교체 직전"으로 못박는다.

### SCD Type 2 — 천천히 변하는 차원의 이력 관리

고객 등급이나 상품 카테고리처럼 시간에 따라 변하는 속성을 Type 1로 덮어쓰면 과거 사실이 소실된다. 마켓온 고객이 6월에 VIP가 됐다고 해서, 5월 매출까지 VIP 등급으로 귀속되면 정산이 틀어진다. "구매 시점의 등급"으로 집계하려면 등급 변경을 덮지 말고 이력 행으로 쌓아야 한다 — 천천히 변하는 차원(Slowly Changing Dimension, SCD) Type 2다.

나쁜 쪽은 `UPDATE`로 현재 등급을 덮는다. 변경 전 등급이 어느 기간 유효했는지는 어디에도 남지 않는다.

```sql
-- ✗ 과거 등급이 영구 소실 → 5월 매출이 6월 등급으로 잘못 귀속
UPDATE `proj.silver.dim_customer`
SET grade = 'VIP'
WHERE customer_id = 'C-1024';
```

좋은 쪽은 단일 `MERGE`로 두 가지를 한 번에 한다. 등급이 바뀐 기존 current 행은 `valid_to`를 찍어 마감하고(`is_current = FALSE`), 새 등급 행을 별도로 삽입한다. BigQuery `MERGE`는 `WHEN MATCHED`에서 한 행만 수정할 수 있으므로, 마감과 삽입을 한 문장에 담을 때는 신규 행 삽입을 `WHEN NOT MATCHED BY TARGET`으로 분리하는 형태가 표준이다.

```sql
-- ✓ 기존 current 행 마감 + 신규 이력 행 삽입
MERGE `proj.silver.dim_customer` T
USING (
  SELECT
    customer_id,
    grade,
    effective_at
  FROM `proj.silver._staged_customer_grade`
) S
ON  T.customer_id = S.customer_id
AND T.is_current = TRUE
AND T.grade != S.grade                       -- 등급이 실제로 바뀐 행만
WHEN MATCHED THEN
  UPDATE SET
    T.valid_to    = S.effective_at,          -- 기존 행 유효기간 마감
    T.is_current  = FALSE
WHEN NOT MATCHED BY TARGET THEN
  INSERT (customer_id, grade, valid_from, valid_to, is_current)
  VALUES (S.customer_id, S.grade, S.effective_at, TIMESTAMP('9999-12-31'), TRUE);
```

팩트를 조인할 때는 거래 시각을 유효기간에 맞춘다. 이 한 줄이 "구매 시점의 등급"을 보장한다.

```sql
-- ✓ 거래 시점에 유효했던 등급으로 귀속
SELECT
  f.order_id,
  d.grade,                                   -- 구매 당시 등급
  f.amount
FROM `proj.silver.orders` f
JOIN `proj.silver.dim_customer` d
  ON  f.canonical_customer_id = d.customer_id
  AND f.completed_at >= d.valid_from
  AND f.completed_at <  d.valid_to;          -- 거래 시각이 유효기간 안
```

이력 행은 "이 고객이 그때 어떤 등급이었는가"라는 사실이므로 02편 룰 B("무엇인가는 Silver", L77)에 따라 Silver에 둔다. 집계는 그 위에서 Gold가 센다.

### Late-Arriving Data — 파티션 재처리 없이 늦은 이벤트 흡수

`event_at`은 이틀 전인데 `_ingested_at`은 오늘인 이벤트가 있다. POS 오프라인 단말이 네트워크 복구 후 밀린 거래를 한꺼번에 올리는 경우다. 이미 닫힌 과거 파티션을 통째로 다시 만들면 비용이 폭발하고, 오늘 파티션에만 넣으면 그제 GMV가 영구히 누락된다. 답은 `event_at`이 가리키는 파티션만 골라 `MERGE`로 갱신하는 것이다.

나쁜 쪽은 적재일 기준으로 오늘 파티션에만 적재한다. 늦게 온 이벤트의 매출은 발생일에 잡히지 않는다.

```sql
-- ✗ 적재일 기준 적재 → 그제 발생한 거래가 그제 GMV에 안 잡힘
INSERT INTO `proj.silver.orders` (order_id, amount, completed_at, _ingested_at)
SELECT order_id, amount, event_at, CURRENT_TIMESTAMP()
FROM `proj.bronze.pos_purchases`
WHERE DATE(_ingested_at) = CURRENT_DATE();
```

좋은 쪽은 `event_at`으로 영향받은 파티션을 식별하고, 그 파티션만 키 기반 `MERGE`로 갱신한다. `MERGE`이므로 같은 이벤트가 다시 와도 멱등하다 — 이미 들어온 거래는 건너뛴다.

```sql
-- ✓ event_at 기준 타깃 파티션만 MERGE (멱등)
MERGE `proj.silver.orders` T
USING (
  SELECT order_id, amount, event_at
  FROM `proj.bronze.pos_purchases`
  WHERE DATE(_ingested_at) = CURRENT_DATE()
    -- grace window: event_at이 최근 3일 안인 것만 흡수 (수치는 예시, 도메인 의존)
    AND event_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 3 DAY)
) S
ON T.order_id = S.order_id                   -- 키 일치 = 이미 들어온 거래
WHEN NOT MATCHED THEN
  INSERT (order_id, amount, completed_at)
  VALUES (S.order_id, S.amount, S.event_at); -- 발생일 파티션에 정확히 안착
```

워터마크를 `_ingested_at`이 아닌 `event_at`에 grace window를 더해 잡는 것이 핵심이다. grace window를 3일로 둘지 7일로 둘지는 단말의 오프라인 지속 시간에 달렸으므로 도메인마다 다르다. 이것은 02편의 증분 처리·하이워터마크(L167)를 늦은 데이터까지 견디도록 심화한 형태이고, 멱등 `MERGE`(02편 L149)가 전제다.

### Identity Resolution — 소스별 키를 canonical_id로

같은 사람이 ERP에서는 `user_id`, CRM에서는 `member_no`, POS에서는 전화번호 해시로 들어온다. 각 마트가 소스 키로 따로 세면 한 고객이 셋으로 카운트되어 `COUNT(DISTINCT)`가 과대 집계된다. Silver에서 소스별 키를 하나의 `canonical_customer_id`로 통합해야 한다. 01편에 등장한 `ontology.customer_identity` 매핑(01편 L190)이 어떻게 채워지는지가 여기다.

나쁜 쪽은 통합 없이 소스 키로 센다. 같은 고객이 소스마다 다른 키를 가지므로 셋으로 분리된다.

```sql
-- ✗ 소스 키로 직접 카운트 → 한 고객이 3명으로 과대 집계
SELECT COUNT(DISTINCT user_id) AS customers
FROM `proj.bronze.erp_orders`;
```

좋은 쪽은 두 단계다. 먼저 결정적 매칭(이메일·전화 해시 같은 확실한 식별자 일치)으로 매핑 테이블을 `MERGE`로 유지하고, Silver는 그 매핑을 `LEFT JOIN`해 canonical 키를 붙인다.

```sql
-- ✓ (1) 결정적 매칭으로 canonical 매핑 유지
MERGE `proj.silver.customer_identity_map` T
USING (
  SELECT source_system, source_id, email_hash
  FROM `proj.bronze.erp_orders`
  WHERE email_hash IS NOT NULL
) S
ON T.source_system = S.source_system AND T.source_id = S.source_id
WHEN NOT MATCHED THEN
  INSERT (source_system, source_id, canonical_id)
  VALUES (
    S.source_system,
    S.source_id,
    -- 같은 email_hash는 같은 canonical_id로 결정적 부여
    TO_HEX(SHA256(S.email_hash))
  );

-- ✓ (2) Silver는 매핑을 LEFT JOIN해 canonical 키 부착
SELECT
  b.order_id,
  m.canonical_id AS canonical_customer_id,
  b.amount
FROM `proj.bronze.erp_orders` b
LEFT JOIN `proj.silver.customer_identity_map` m
  ON m.source_system = 'erp' AND m.source_id = b.user_id;
```

이 글은 결정적 매칭에 한정한다. 이름·주소 유사도로 추정하는 확률적(fuzzy)·ML 매칭은 정밀도·재현율 트레이드오프와 검수 루프가 따로 필요한 별도 주제다. 결정적 매칭만으로도 02편 룰 D("엔티티 통합 조인은 Silver", L81)의 정식 구현은 완성된다.

### Gold 2-Tier — Metric Layer와 Mart Layer 분리

Gold를 한 덩어리로 두면 부서마다 `SUM(amount)`를 제각각 정의하면서 같은 "GMV"가 마트마다 미묘하게 달라진다. Gold를 둘로 쪼갠다. **Metric Layer**는 `daily_gmv`, `cancel_count` 같은 원자 지표를 단일 정의로 두고, **Mart Layer**는 그 metric을 조합만 한다. 지표 정의가 한 곳에만 살아 있으므로 표류하지 않는다.

나쁜 쪽은 각 부서 마트가 Silver에서 직접 집계한다. 마케팅 마트와 재무 마트가 GMV를 따로 정의하는 순간 둘의 수치는 반드시 갈라진다.

```sql
-- ✗ 마트마다 GMV를 직접 정의 → 정의가 갈라짐 (Metric Cannibalism의 토양)
CREATE OR REPLACE TABLE `proj.gold.mart_marketing` AS
SELECT DATE(completed_at) AS dt, SUM(amount) AS gmv   -- 마케팅의 GMV 정의
FROM `proj.silver.orders`
WHERE is_completed = TRUE
GROUP BY dt;
```

좋은 쪽은 GMV를 metric layer 한 곳에서만 정의하고, 모든 마트가 그것을 참조한다. GMV 정의가 바뀌면 metric 한 테이블만 고치면 모든 마트가 따라온다.

```sql
-- ✓ (1) Metric Layer: GMV를 단 한 번 정의
CREATE OR REPLACE TABLE `proj.gold.metric_gmv` AS
SELECT
  DATE(completed_at) AS dt,
  source_system,
  SUM(amount)        AS gmv                   -- 전사 단일 GMV 정의
FROM `proj.silver.orders`
WHERE is_completed = TRUE
GROUP BY dt, source_system;

-- ✓ (2) Mart Layer: metric을 참조해 조립만
CREATE OR REPLACE TABLE `proj.gold.mart_marketing` AS
SELECT dt, SUM(gmv) AS total_gmv             -- 재정의 없이 metric 조합
FROM `proj.gold.metric_gmv`
GROUP BY dt;
```

이것은 02편 안티패턴 "로직 표류"(L202)의 구조적 처방이다. 02편이 "Gold 2단 분할"로 이름만 붙였던 것을, 여기서 metric/mart 두 테이블로 구현했다. 뒤에 나올 안티패턴 두 개(Fan-out Gold, Metric Cannibalism)가 바로 이 분리가 없을 때 자라는 잡초다.

패턴으로 흐름을 다스렸으니, 이제 그 패턴이 없을 때 자기 코드에 돋는 증상들을 본다.

---

## 안티패턴 — 증상으로 자기 코드에서 잡아내기

안티패턴은 정의보다 증상으로 외우는 게 쓸모 있다. 대시보드에서 본 이상 현상을 단서로 자기 파이프라인을 거꾸로 의심할 수 있기 때문이다. 다섯 안티패턴의 시그니처다.

| 안티패턴 | 증상 | 처방 |
|----------|------|------|
| Timestamp Trap | 매출이 자정마다 줄었다 채워짐 | 지표는 `event_at`으로 |
| Schema Evolution Blindness | 신규 코드가 알람 없이 NULL로 흐름 | 진입 검증 + 미지 비율 ASSERT |
| Backfill Ambiguity | 백필 후 매출이 두 배 | 백필도 MERGE로 멱등 |
| Fan-out Gold | 비슷한 마트가 수십 개로 증식 | metric 게이트로 조립 강제 |
| Metric Cannibalism | 같은 GMV가 마트마다 1~2% 다름 | metric layer로 정의 단일화 |

다섯 중 앞의 셋은 *흐름*이 깨지는 형태(시간·스키마·재적재)이고, 뒤의 둘은 *Gold 구조*가 무너지는 형태다. 특히 Fan-out과 Cannibalism은 자주 혼동되므로 마지막에 따로 가른다. 각 항목은 증상 → 나쁜 SQL → 좋은 SQL → 한 줄 처방으로 읽는다.

### Timestamp Trap — _ingested_at vs event_at 혼용

어제 매출이 자정 직후 갑자기 줄었다가 다음 날 채워지는 현상이 반복된다. 집계 날짜가 실제 거래일이 아니라 적재일을 가리키고 있기 때문이다. 자정을 넘겨 적재된 어제 거래가 오늘 매출로 새는 것이다.

```sql
-- ✗ 적재일로 매출을 가름 → 거래일과 어긋남
SELECT DATE(_ingested_at) AS dt, SUM(amount) AS gmv
FROM `proj.silver.orders`
GROUP BY dt;

-- ✓ 비즈니스 지표는 발생 시각(completed_at)으로 집계
SELECT DATE(completed_at) AS dt, SUM(amount) AS gmv
FROM `proj.silver.orders`
GROUP BY dt;
```

`_ingested_at`은 운영 모니터링(적재 지연·freshness)에만 쓰고, 매출 같은 비즈니스 지표는 `event_at`/`completed_at`으로 센다. 컬럼 명명 규약(`_` 접두사 = 적재 메타)을 지키면 둘을 헷갈릴 일이 줄어든다.

**모든 비즈니스 지표는 적재 시각이 아니라 사건 발생 시각으로 집계한다.**

### Schema Evolution Blindness — 변경이 NULL로 조용히 흘러듦

신규 상태 코드나 컬럼이 들어와도 알람이 없다. 어느 날 지표가 슬그머니 틀어져 있고, 원인을 찾으면 며칠 전부터 미지 코드가 `ELSE NULL`로 조용히 흐르고 있었다. 01편 마켓온 `'CM'` 사고가 바로 이 일반형이다.

```sql
-- ✗ 미지 코드가 NULL로 흘러도 무알람
SELECT
  CASE order_status
    WHEN 'C' THEN TRUE
    WHEN 'X' THEN FALSE
    ELSE NULL              -- 신규 'CM'이 조용히 NULL
  END AS is_completed
FROM `proj.bronze.erp_orders`;
```

좋은 쪽은 미분류 비율을 측정해 임계를 넘으면 `ASSERT`로 막는다. NULL이 흐르는 것 자체를 계약 위반으로 본다.

```sql
-- ✓ 미지 코드 비율이 임계를 넘으면 진입 차단
ASSERT (
  SELECT COUNTIF(is_completed IS NULL) / COUNT(*)
  FROM `proj.silver._staged_orders`
  WHERE source_system = 'erp'
) <= 0.001 AS 'ERP 미분류 status 비율 초과 — 신규 코드 유입 의심';
```

이것은 01편의 DQ assertion(01편 L196)을 진입 경계에 둔 형태다. 02편이 "스키마 검사는 진입 경계"(L256)라 했던 그 자리다.

**스키마 변경은 감지하지 못하면 일어나지 않은 것이 아니라, 조용히 틀린 것이다.**

### Backfill Ambiguity — 백필 시 멱등성 붕괴로 이중 적재

백필을 한 번 더 돌렸더니 매출이 두 배가 됐다. `COUNT`가 부풀어 오르고 어느 숫자가 진짜인지 알 수 없다. 백필을 `INSERT ... SELECT`로 짠 탓에, 기존 행 위에 같은 데이터가 다시 쌓인 것이다.

```sql
-- ✗ 백필 INSERT → 기존 행 위에 중복 누적
INSERT INTO `proj.silver.orders` (order_id, amount, completed_at)
SELECT order_id, amount, event_at
FROM `proj.bronze.erp_orders`
WHERE DATE(event_at) BETWEEN '2026-06-01' AND '2026-06-07';

-- ✓ 백필도 키 기반 MERGE → 몇 번을 돌려도 동일 결과
MERGE `proj.silver.orders` T
USING (
  SELECT order_id, amount, event_at
  FROM `proj.bronze.erp_orders`
  WHERE DATE(event_at) BETWEEN '2026-06-01' AND '2026-06-07'
) S
ON T.order_id = S.order_id                   -- 키로 기존 행 식별
WHEN NOT MATCHED THEN
  INSERT (order_id, amount, completed_at)
  VALUES (S.order_id, S.amount, S.event_at);
```

백필은 멱등성의 예외가 아니라 가장 위험한 케이스다. 평소 증분 적재는 새 데이터만 다루지만, 백필은 이미 적재된 과거 구간을 다시 건드리므로 멱등하지 않으면 곧장 중복이 된다(02편 L149 멱등성).

**모든 재적재는 멱등이어야 하며, 백필은 그 원칙이 가장 먼저 깨지는 자리다.**

### Fan-out Gold — Gold 마트의 폭발적 증식

마트 수가 수십 개로 불어나고, 요청이 올 때마다 비슷한 와이드 마트가 새로 생긴다. 각 마트가 Silver에서 처음부터 집계를 조립하기 때문에 지표 정의가 마트 수만큼 파편화된다.

```sql
-- ✗ 요청마다 Silver에서 새 와이드 마트를 처음부터 조립
CREATE OR REPLACE TABLE `proj.gold.mart_sales_v7_finance` AS
SELECT DATE(completed_at) AS dt, source_system, SUM(amount) AS gmv, COUNT(*) AS cnt
FROM `proj.silver.orders`
WHERE is_completed = TRUE
GROUP BY dt, source_system;

-- ✓ 공유 metric을 참조해 마트는 조립만 (Gold 2-Tier)
CREATE OR REPLACE TABLE `proj.gold.mart_finance` AS
SELECT dt, source_system, gmv
FROM `proj.gold.metric_gmv`;                  -- 이미 정의된 metric 재사용
```

처방은 Gold 2-Tier 패턴이다. 신규 마트를 만들기 전에 "이 지표가 metric layer에 이미 있는가"를 확인하는 게이트를 둔다. 있으면 조립만 하고, 없으면 metric을 먼저 추가한다.

**마트를 새로 만들기 전에 metric layer를 먼저 본다 — 조립은 허용, 재정의는 금지.**

### Metric Cannibalism — 같은 지표가 미묘하게 다르게 여러 곳에

"GMV"가 마트마다 1~2% 다르다. 회의에서 어느 숫자가 맞는지 논쟁이 벌어진다. 파보면 마트 A는 취소 거래를 포함하고 마트 B는 제외하는데, 둘 다 컬럼 이름은 `gmv`다.

```sql
-- ✗ 같은 이름, 다른 정의 — 취소 포함 여부가 마트마다 다름
-- 마트 A
SELECT dt, SUM(amount) AS gmv FROM `proj.silver.orders` GROUP BY dt;
-- 마트 B
SELECT dt, SUM(amount) AS gmv FROM `proj.silver.orders`
WHERE is_cancelled = FALSE GROUP BY dt;       -- 취소 제외 — 하지만 이름은 같은 gmv

-- ✓ metric layer에 정의를 단일화하고 메타를 명시
CREATE OR REPLACE TABLE `proj.gold.metric_gmv` AS
SELECT
  DATE(completed_at) AS dt,
  SUM(amount)        AS gmv,                  -- 정의: 완료 거래, 취소 제외
  FALSE              AS includes_cancelled    -- 정의 메타를 컬럼으로 고정
FROM `proj.silver.orders`
WHERE is_completed = TRUE AND is_cancelled = FALSE
GROUP BY dt;
```

처방은 metric layer로 정의를 단일화하고, "취소 포함 여부" 같은 정의 메타를 컬럼이나 문서로 못박는 것이다. 02편 체크리스트의 "이 지표 정의가 이미 다른 Gold에 존재하는가"(L316)를 능동적으로 적용하는 자리다.

Fan-out Gold와 혼동하기 쉬우므로 한 번 가른다. 둘은 같은 뿌리(Gold 2-Tier 부재)에서 자라지만 증상의 축이 다르다.

| 구분 | Fan-out Gold | Metric Cannibalism |
|:----:|------|------|
| 깨지는 축 | 마트의 *수* | 지표의 *정의* |
| 증상 | 비슷한 마트가 계속 늘어남 | 같은 지표 숫자가 갈라짐 |
| 처방 | 조립 강제(metric 재사용) | 정의 단일화(metric 하나) |

Fan-out은 *양*의 문제, Cannibalism은 *질*의 문제다. 둘 다 metric layer를 세우면 같이 사라진다.

**같은 이름의 지표는 정의도 하나여야 한다 — 이름이 같고 정의가 다르면 그건 두 지표다.**

---

## 자가진단 체크리스트

02편이 *어느 레이어에 둘지*를 여섯 질문(02편 L311)으로 압축했다면, 여기서는 *패턴이 들어가 있고 안티패턴이 없는지*를 점검한다. 위에서부터 자기 파이프라인에 짚는다.

패턴 도입 점검:

- [ ] Gold 진입 직전에 검증 게이트(WAP)가 있는가? — *staging 검증 후에만 운영 테이블을 교체한다*
- [ ] 변하는 차원이 Type 1로 덮이고 있지 않은가? — *등급·카테고리는 `valid_from`/`valid_to` 이력 행으로*
- [ ] 늦게 도착한 이벤트가 `event_at` 기준으로 흡수되는가? — *적재일이 아니라 발생일 파티션에 MERGE*
- [ ] 다소스 고객이 `canonical_id`로 통합되는가? — *소스 키 직접 카운트는 과대 집계*
- [ ] metric layer가 mart layer와 분리돼 있는가? — *지표는 한 곳에서만 정의*

안티패턴 진단 점검:

- [ ] 비즈니스 지표가 `_ingested_at`으로 집계되고 있지 않은가? — *지표는 `event_at`/`completed_at`으로*
- [ ] 미지 코드 유입에 알람이 있는가? — *미분류 비율 임계를 ASSERT로 막는다*
- [ ] 백필이 `INSERT`가 아니라 `MERGE`인가? — *백필은 멱등성이 가장 먼저 깨지는 자리*
- [ ] 마트 신설 전 metric 확인 게이트가 있는가? — *조립은 허용, 재정의는 금지*
- [ ] 같은 지표가 두 곳에 다르게 정의돼 있지 않은가? — *이름이 같으면 정의도 하나여야 한다*

<div class="callout-info">
본문의 <code>ASSERT</code>, <code>MERGE</code>, WAP atomic swap, SCD2 / Late-Arriving <code>MERGE</code> 구문은 패턴을 표현하는 <strong>예시 도구</strong>이며 BigQuery 문법도 예시다. 버전별 정확한 동작과 트랜잭션 보장 범위, grace window 수치는 각자 환경의 공식 문서로 확인하라.
</div>

---

## 마무리

이 글은 02편의 레이어 룰을 실행 가능한 SQL로 구현했다. 다섯 패턴은 룰의 실행체이고, 다섯 안티패턴은 룰이 무너지는 구체적 형태다. 00편은 레이어 정의, 01편은 구조 부재로 인한 사고, 02편은 경계 판단 룰북을 다뤘다.

패턴과 안티패턴 다음 주제는 데이터 리니지와 거버넌스다. 데이터가 Bronze에서 Gold까지 어떤 변환을 거쳐 어디로 흘러갔는지 그 출처와 경로를 추적하고, 레이어를 넘나드는 흐름에 책임을 묶는 주제다(02편 L320 예고와 이어진다).

---

## 참고

- [[/data-architect/00_what_is_medaliion_architecture]] — Bronze·Silver·Gold 각 계층의 정의와 핵심 원칙
- [[/data-architect/01_how_to_architect_medallion_well]] — 소스 변경을 흡수하지 못한 실제 사고와 Silver의 역할
- [[/data-architect/02_how_to_architect_medallion_well]] — 레이어 경계 판단 룰북과 DQ 전략
- Kimball & Ross, *The Data Warehouse Toolkit* (Wiley) — SCD Type 2와 Conformed Dimension
- Databricks, *What is the Medallion Lakehouse Architecture?* — 레이어 원형 정의와 WAP 패턴
