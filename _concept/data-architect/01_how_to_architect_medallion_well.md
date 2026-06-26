---
layout  : concept
title   : ERP 업그레이드가 새벽 3시에 GMV를 0으로 만들었다
date    : 2026-06-22 00:00:00 +0900
updated : 2026-06-24 00:00:00 +0900
tag     : data-architect design-pattern data-architecture 
toc     : true
comment : true
public  : true
parent  : [[/data-architect]]
latex   : true
status  : complete
show-diagram: true
relations:
  - { type: extends, target: /concept/data-architect/00_what_is_medaliion_architecture }
confidence     : medium
---
* TOC
{:toc}

> [[/data-architect/00_what_is_medaliion_architecture]] 에서 Medallion을 Bronze·Silver·Gold 세 계층으로 설명했다. 이 글은 그 구조가 왜 필요한지를 실제 장애에서 거꾸로 읽는다.

---

## 인시던트

2025년 3월 14일 새벽 2시 30분. 마켓온 ERP 팀이 버전 업그레이드를 배포했다.

변경 내용은 단순했다. 주문 상태 코드 체계를 1자리에서 2자리로 확장한 것이었다.

```
이전: 'C' (Completed), 'P' (Partial), 'X' (Cancelled)
이후: 'CM' (Completed), 'PA' (Partial), 'CX' (Cancelled)
```

새벽 2시 30분 이후 ERP에서 들어오는 모든 주문의 `order_status`는 `'CM'`이었다.

오전 9시 15분. 데이터팀 슬랙에 알람이 쏟아졌다.

> `[GMV-ALERT] 일별 GMV 0원 감지 — 2025-03-14 | 전일 대비 -100% | 임계값: -30%`

대시보드를 열었다. 당일 매출이 0원이었다. 실제 주문은 들어오고 있었다. 결제도 정상이었다. 데이터만 0이었다.

문제를 찾는 데 23분이 걸렸다.

```sql
-- Gold 레이어 GMV 쿼리
SELECT DATE(order_date) AS dt, SUM(order_amount) AS daily_gmv
FROM `marketeon.bronze.erp_orders`
WHERE order_status = 'C'   -- ← 새벽 2시 30분부터 'CM'으로 바뀜
GROUP BY 1;
```

`WHERE order_status = 'C'`가 47개 쿼리에 있었다. 새벽 2시 30분부터 오전 9시 38분까지 6시간 8분 동안 마켓온의 모든 GMV 지표는 0이었다.

그 사이 세 가지 일이 벌어졌다.

첫째, 마케팅 자동화 시스템이 GMV 0에 반응해 당일 광고 예산을 40% 삭감했다. 이미 노출된 광고에 대한 입찰가가 낮아졌고, 오전 피크 타임 트래픽 일부를 경쟁사에 넘겼다.

둘째, 재무팀이 일별 정산 보고서를 GMV 0으로 발송했다. 수신자 중 일부는 장애를 인지하지 못한 채 보고서를 상위에 전달했다.

셋째, 이탈 예측 모델이 당일 구매 피처를 0으로 학습했다. 이 배치는 오전 6시에 돌았고, 복구 후에도 해당 날의 학습 결과는 남았다.

오전 9시 38분에 47개 쿼리를 `'CM'`으로 수정하는 데 1시간 12분이 걸렸다.

포스트모텀을 돌렸다. 문제는 세 군데에 있었다.

---

## 해부: 세 가지가 동시에 없었다

### 1. Status 정규화 레이어 없음 — 소스의 언어가 그대로 Gold까지 내려왔다

`order_status = 'C'`는 마켓온의 언어가 아니라 ERP 벤더의 언어였다. ERP가 코드 체계를 바꿀 권리는 ERP에 있다. 하지만 그 변경이 47개의 분석 쿼리를 동시에 망가뜨릴 이유는 없었다.

소스의 상태 코드를 비즈니스 의미(`is_completed: BOOL`)로 번역하는 레이어가 없었다. Bronze에서 Gold까지 `order_status STRING`이 그대로 흘렀다.

```sql
-- 47개 쿼리가 각자 다른 방식으로 status를 해석했다
WHERE order_status = 'C'                          -- 32개
WHERE order_status IN ('C', 'CM')                 -- 9개  ← 누군가 예견함
WHERE SUBSTR(order_status, 1, 1) = 'C'            -- 4개  ← 자체 방어
WHERE order_status NOT IN ('X', 'P')              -- 2개  ← 완전히 다른 해석
```

같은 "완료 주문"을 47개 쿼리가 네 가지 방식으로 정의하고 있었다. 장애 전에는 모두 같은 숫자를 냈으니 문제가 드러나지 않았다.

### 2. Bronze → Gold 직접 연결 — 완충 레이어가 없었다

마켓온의 데이터 파이프라인은 이렇게 생겼었다.

```
ERP → bronze.erp_orders → (47개 쿼리) → Gold 마트
CRM → bronze.crm_orders → (23개 쿼리) → Gold 마트
POS → bronze.pos_purchases → (18개 쿼리) → Gold 마트
```

소스 시스템 3개에서 Gold 마트까지 총 88개의 직접 연결이 있었다. 소스 하나가 바뀌면 그 소스에 연결된 모든 Gold 쿼리가 동시에 영향받았다.

장애 복구 시 88개 쿼리를 모두 점검해야 했다. 그 중 72개가 영향 범위에 들어왔다.

### 3. DQ 모니터링 없음 — 6시간 8분 동안 침묵했다

`'CM'`이라는 미지의 status 코드가 Bronze에 처음 들어온 시각은 새벽 2시 32분이었다. 오전 9시 15분에 GMV 0 알람이 떴으니, 탐지까지 6시간 43분이 걸렸다.

Bronze에 `'CM'`이 들어오는 순간 "알 수 없는 status 코드 감지"라는 알람이 떴어야 했다. 하지만 Bronze 레이어에는 어떤 assertion도 없었다. 데이터는 그대로 흘렀고, 이상은 결과가 0이 되어서야 드러났다.

---

## 잠깐 — Bronze 레이어만 있으면 됐을까?

포스트모텀 회의에서 누군가 물었다. "Bronze 테이블을 raw로 쓰면 되는 거 아닌가요? 이건 그냥 Gold 쿼리를 잘못 짠 거잖아요."

답은 **아니다**.

Bronze 테이블은 이미 있었다. `marketeon.bronze.erp_orders`는 ERP 데이터를 그대로 담는 raw 테이블이었다. 문제는 Bronze가 있어도 Gold가 Bronze를 직접 참조했다는 것이다.

Bronze는 "소스 데이터를 안전하게 보관한다"는 목적을 달성했다. 하지만 그것만으로는 소스 언어(`'C'`, `'CM'`)를 비즈니스 언어(`is_completed`)로 번역하는 일을 막을 수 없다. 번역은 어딘가에서 반드시 일어난다. Bronze-Gold 구조에서 그 번역은 Gold 쿼리 47개 안에 흩어져 있었다.

> **Bronze만으로는 소스 변경을 흡수할 수 없다.** 번역을 한 곳에 모으려면 Silver가 필요하다.

---

## Medallion 설계

포스트모텀 이후 데이터팀이 설계한 것은 쿼리 수정이 아니었다. 세 가지 부재를 각각 채우는 레이어 구조였다.

### Bronze: 소스를 그대로 보관한다

Bronze의 규칙은 하나다. **소스 데이터를 변환 없이 보관한다.** ERP가 `'C'`를 보내면 `'C'`를 담고, `'CM'`을 보내면 `'CM'`을 담는다.

```sql
CREATE TABLE `marketeon.bronze.erp_orders` (
  _ingested_at    TIMESTAMP NOT NULL,   -- 적재 시각 (감사 추적)
  _source_file    STRING,               -- 원본 파일명 또는 CDC 오프셋
  order_id        STRING    NOT NULL,
  user_id         STRING,
  order_status    STRING    NOT NULL,   -- ERP 원본 코드, 변환 없음
  order_amount    INT64,
  order_date      DATE      NOT NULL
)
PARTITION BY order_date
CLUSTER BY order_status;
```

Bronze에는 비즈니스 로직이 없다. `WHERE order_status = 'C'` 같은 필터도 없다. 재처리할 때 소스 파일만 있으면 Bronze를 완전히 재구성할 수 있다.

### Silver: 소스의 언어를 비즈니스의 언어로 번역한다

Silver는 번역 레이어다. 정규화, 소스 통합, DQ assertion이 모두 여기서 일어난다.

```sql
CREATE TABLE `marketeon.silver.orders` (
  order_id            STRING    NOT NULL,
  source_system       STRING    NOT NULL,   -- 'erp' | 'crm' | 'pos'
  source_order_id     STRING    NOT NULL,
  canonical_customer_id STRING,
  amount              INT64     NOT NULL,
  is_completed        BOOL,                 -- NULL = 미분류 (알람 트리거)
  is_cancelled        BOOL,
  completed_at        TIMESTAMP,
  _silver_loaded_at   TIMESTAMP NOT NULL,
  _source_status_raw  STRING    NOT NULL    -- 감사 추적용 원본 코드 보존
)
PARTITION BY DATE(completed_at)
CLUSTER BY source_system, is_completed;
```

ERP Bronze → Silver 변환. ERP 벤더 코드가 바뀌어도 이 `CASE WHEN` 한 군데만 수정하면 된다.

```sql
INSERT INTO `marketeon.silver.orders`
SELECT
  CONCAT('ORD-erp-', b.order_id)              AS order_id,
  'erp'                                         AS source_system,
  b.order_id                                    AS source_order_id,
  ci.canonical_id                               AS canonical_customer_id,
  COALESCE(b.order_amount, 0)                   AS amount,
  CASE
    WHEN b.order_status IN ('C', 'CM', 'COMP')     THEN TRUE
    WHEN b.order_status IN ('X', 'CX', 'CANCEL')   THEN FALSE
    WHEN b.order_status IN ('P', 'PA', 'PARTIAL')   THEN FALSE
    ELSE NULL   -- ← 미지 코드: DQ 알람 트리거
  END                                               AS is_completed,
  CASE
    WHEN b.order_status IN ('X', 'CX', 'CANCEL')   THEN TRUE
    ELSE FALSE
  END                                               AS is_cancelled,
  TIMESTAMP(b.order_date)                           AS completed_at,
  CURRENT_TIMESTAMP()                               AS _silver_loaded_at,
  b.order_status                                    AS _source_status_raw
FROM `marketeon.bronze.erp_orders` b
LEFT JOIN `marketeon.ontology.customer_identity` ci
  ON ci.source_id = b.user_id AND ci.source_system = 'erp'
WHERE DATE(b._ingested_at) = CURRENT_DATE();
```

**DQ assertion** — Silver 적재 직후 실행한다.

```sql
DECLARE unknown_ratio FLOAT64;

SET unknown_ratio = (
  SELECT COUNTIF(is_completed IS NULL) / COUNT(*)
  FROM `marketeon.silver.orders`
  WHERE DATE(_silver_loaded_at) = CURRENT_DATE()
    AND source_system = 'erp'
);

IF unknown_ratio > 0.001 THEN
  CALL `marketeon.utils.raise_alert`(
    'silver_dq_unknown_status',
    FORMAT('ERP unknown status ratio %.2f%% — check bronze.erp_orders._source_status_raw',
           unknown_ratio * 100)
  );
END IF;
```

이 assertion이 새벽 2시 32분에 발동했다면 장애 탐지는 6시간 43분이 아닌 2분이었다.

### Gold: Silver만 본다

Gold의 규칙: **Silver만 참조한다.** Bronze는 보이지 않는다.

```sql
CREATE TABLE `marketeon.gold.daily_gmv` AS
SELECT
  DATE(completed_at)                    AS dt,
  source_system,
  SUM(amount)                           AS gmv,
  COUNT(*)                              AS order_count,
  COUNT(DISTINCT canonical_customer_id) AS unique_customers
FROM `marketeon.silver.orders`
WHERE is_completed = TRUE
GROUP BY 1, 2;
```

`WHERE is_completed = TRUE`. ERP 벤더 코드가 무엇이든 Gold는 관계없다. 그것은 Silver의 일이다.

전채널 GMV도 쿼리 하나로 해결된다.

```sql
SELECT
  dt,
  SUM(gmv)                                       AS total_gmv,
  SUM(IF(source_system = 'erp', gmv, 0))         AS erp_gmv,
  SUM(IF(source_system = 'crm', gmv, 0))         AS crm_gmv,
  SUM(IF(source_system = 'pos', gmv, 0))         AS pos_gmv
FROM `marketeon.gold.daily_gmv`
GROUP BY 1
ORDER BY 1 DESC;
```

---

## 재현: Medallion이 있었다면

**새벽 2시 32분 — ERP `'CM'` 코드가 Bronze에 도착**

Bronze는 그대로 적재한다. `order_status = 'CM'`. 변환 없음.

**새벽 2시 34분 — Silver 변환 실행**

`CASE WHEN`이 `'CM'`을 만난다. `IN ('C', 'CM', 'COMP')` — `TRUE`. `is_completed = TRUE`.
Gold는 아무 영향을 받지 않는다.

만약 `'CM'`이 `CASE WHEN`에 없었다면:

```
_source_status_raw | is_completed
CM                 | NULL          ← DQ assertion 발동
```

**새벽 2시 34분 — DQ assertion이 울린다**

```
[DQ-ALERT] silver_dq_unknown_status
ERP unknown status ratio 100.00% — check bronze.erp_orders._source_status_raw
새로운 status 코드 감지: 'CM' (1,847건)
```

데이터팀이 다음 날 오전에 여유 있게 `CASE WHEN`에 `'CM'`을 추가한다. Silver 재처리, Gold 자동 갱신. 광고 예산은 삭감되지 않았다. 재무 보고서는 정상이었다. 모델 학습도 영향받지 않았다.

---

## 파급: Silver가 가능하게 만든 것

**"어떤 ERP 상태 코드가 지금 들어오고 있는가?"**

```sql
SELECT
  _source_status_raw,
  COUNT(*)                         AS total_count,
  COUNTIF(is_completed IS NULL)    AS unknown_count,
  MIN(_silver_loaded_at)           AS first_seen,
  MAX(_silver_loaded_at)           AS last_seen
FROM `marketeon.silver.orders`
WHERE source_system = 'erp'
GROUP BY 1
ORDER BY total_count DESC;
```

```
_source_status_raw | total_count | unknown_count | first_seen
CM                 | 1,284,930   | 0             | 2025-03-14 02:32:00
C                  |   891,204   | 0             | 2023-08-01 00:00:00
PA                 |    34,871   | 34,871        | 2025-03-14 02:32:00  ← 아직 미분류
CX                 |    28,440   | 0             | 2025-03-14 02:32:00
```

`'PA'`가 아직 `CASE WHEN`에 없다는 사실이 드러난다. Bronze-Gold 구조였다면 이것도 조용히 흘렀을 것이다.

**"재처리 범위가 어디까지인가?"**

```sql
SELECT
  DATE(completed_at)     AS silver_partition,
  COUNT(*)               AS row_count,
  SUM(amount)            AS affected_gmv
FROM `marketeon.silver.orders`
WHERE source_system = 'erp'
  AND DATE(_silver_loaded_at) = '2025-03-14'
GROUP BY 1;
```

ERP Bronze만 재적재하면 되고, CRM과 POS Silver는 건드리지 않는다. Gold는 Silver 재처리 후 자동으로 따라온다. Bronze-Gold 구조에서는 88개 쿼리 의존성 그래프를 수작업으로 추적해야 했다.

---

## 한계

**Silver 변환 로직이 새로운 단일 장애점이 된다.** Bronze-Gold 구조에서 47개에 분산됐던 위험이 Silver 변환 하나에 집중된다. 이 집중이 장점이기도 하고 위험이기도 하다. Silver 변환이 잘못되면 전체 Gold에 전파된다. 변환 로직에 대한 테스트와 리뷰가 기존보다 엄격해야 한다.

**레이어가 늘어나면 지연도 늘어난다.** Bronze 적재 → Silver 변환 → Gold 집계. 파이프라인이 3단계를 거치므로 준실시간 요구 사항에서는 각 레이어의 지연이 누적된다.

**DQ assertion이 파이프라인을 멈추면 그게 또 다른 장애다.** "알람은 울리되 파이프라인은 계속 진행, 단 unknown은 quarantine 테이블로 분리"하는 전략이 필요한 경우도 있다.

```sql
-- quarantine 패턴: 미지 코드를 흘리지 않고 격리
INSERT INTO `marketeon.silver.orders_quarantine`
SELECT *, 'unknown_status' AS quarantine_reason
FROM `marketeon.bronze.erp_orders`
WHERE order_status NOT IN ('C', 'CM', 'COMP', 'X', 'CX', 'CANCEL', 'P', 'PA', 'PARTIAL')
  AND DATE(_ingested_at) = CURRENT_DATE();
```

---

## 에필로그

마켓온의 장애는 `'C'`가 `'CM'`으로 바뀐 것이 원인이 아니었다. 진짜 원인은 그 변경을 흡수할 레이어가 없었다는 것이다.

| 부재 | 문제 | Medallion 해결 |
|------|------|------|
| Status 정규화 없음 | 47개 쿼리가 각자 status를 해석 | Silver `CASE WHEN` 한 군데 수정 |
| Bronze → Gold 직접 연결 | 소스 변경이 Gold 전체를 동시에 파괴 | Silver가 소스 변경을 흡수 |
| DQ 모니터링 없음 | 6시간 43분 무감지 | Silver 적재 시 미지 코드 즉시 알람 |

Silver가 생기자 이전에 묻지 못했던 질문이 가능해졌다. "현재 ERP에서 어떤 상태 코드가 들어오고 있는가?" "재처리 범위가 어디까지인가?" 이 질문들은 Bronze-Gold 구조에서는 88개 쿼리 의존성 그래프를 손으로 따라가야 답이 나왔다.

> 소스 시스템이 바뀌는 건 막을 수 없다. 그 변경이 Gold에 도달하는 것을 막는 것이 Silver의 일이다.

---

## 참고

- [[/data-architect/00_what_is_medaliion_architecture]] — Bronze·Silver·Gold 각 계층의 책임과 핵심 원칙
- Databricks, *What is the Medallion Lakehouse Architecture?* — Bronze·Silver·Gold 레이어의 원형 정의
- Kleppmann, *Designing Data-Intensive Applications* (O'Reilly 2017) — 소스 시스템 스키마 진화(schema evolution)가 파이프라인에 미치는 영향
