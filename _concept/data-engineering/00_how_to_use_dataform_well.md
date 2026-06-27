---
layout  : concept
title   : Dataform을 잘 사용하는 방법
date    : 2026-06-26 00:00:00 +0900
updated : 2026-06-26 00:00:00 +0900
tag     : dataform bigquery sql data-engineering
toc     : true
comment : true
latex   : true
status  : draft
public  : true
parent  : [[/data-engineering]]
relations:
  - { type: references, target: /concept/data-architect/00_what_is_medaliion_architecture }
confidence     : medium
valid_from     : 2026-06-26
---

## 개요

Dataform은 BigQuery 위에서 SQL 기반 데이터 파이프라인을 관리하는 도구다. dbt와 유사하지만 Google Cloud에 완전 통합되어 있어 BigQuery 환경에서는 더 자연스러운 선택이다. 단순히 SQL을 실행하는 것을 넘어, 의존성 관리·테스트·문서화·스케줄링을 코드로 다룰 수 있다.

핵심 가치는 세 가지다:
- **선언적 의존성**: DAG를 직접 그리지 않고 `ref()`만으로 실행 순서가 결정된다
- **환경 분리 내장**: dev/prod 분기를 SQL 레벨에서 처리한다
- **BigQuery 네이티브**: 파티셔닝, 클러스터링, 슬롯 설정이 config 블록에서 직접 제어된다

---

## 핵심 개념

### SQLX 파일 구조

Dataform의 기본 단위는 `.sqlx` 파일이다. 하나의 파일이 하나의 테이블/뷰를 정의한다.

```sql
-- definitions/mart/user_summary.sqlx
config {
  type: "table",
  schema: "mart",
  description: "사용자별 주문 요약",
  tags: ["daily", "mart"],
  bigquery: {
    partitionBy: "date",
    clusterBy: ["user_id"],
    requirePartitionFilter: true
  }
}

SELECT
  u.user_id,
  DATE(o.created_at) AS date,
  COUNT(o.order_id)  AS order_count,
  SUM(o.amount)      AS total_amount
FROM ${ref("staging", "stg_users")} u
LEFT JOIN ${ref("staging", "stg_orders")} o USING (user_id)
GROUP BY 1, 2
```

### type 선택 기준

| type | 언제 쓰나 | 비용 특성 |
|------|----------|----------|
| `table` | 집계/변환 결과를 물리적으로 저장할 때 | 저장 비용 O, 쿼리 비용 최소 |
| `incremental` | 대용량 테이블을 매일 append/upsert할 때 | 증분 처리로 스캔량 절감 |
| `view` | 변환 로직만 저장하고 쿼리마다 실행해도 될 때 | 저장 비용 X, 쿼리마다 원천 스캔 |
| `assertion` | 데이터 품질 검증 (실패 시 파이프라인 중단) | — |
| `operations` | DDL/DML 등 임의 SQL 실행 | — |

`view`는 단순해 보이지만 downstream에서 여러 번 참조되면 동일 원천을 반복 스캔해 비용이 누적된다. 중간 집계 결과는 `table`로 물리화하는 것이 안전하다.

### ref()로 의존성 선언

`${ref("schema", "table_name")}` 또는 `${ref("table_name")}`으로 다른 테이블을 참조하면 Dataform이 자동으로 실행 순서를 결정한다. 직접 테이블 이름을 하드코딩하지 않는다.

```sql
-- 같은 schema 내 참조
FROM ${ref("stg_orders")}

-- 다른 schema 참조
FROM ${ref("staging", "stg_orders")}

-- 환경별로 schema가 달라져도 ref()는 항상 올바른 테이블을 가리킨다
```

`resolve()`는 `ref()`와 달리 의존성 그래프에 등록하지 않고 테이블 경로만 반환한다. 외부 테이블이나 raw 원천을 경로만 참조할 때 쓴다.

```sql
-- 의존성 없이 경로만 필요할 때
FROM ${resolve("raw_data", "external_events")}
```

---

## 레이어 구조

Medallion Architecture를 Dataform 디렉토리 구조에 그대로 매핑한다.

```
definitions/
  sources/        # 원천 선언 (선택적, 외부 테이블 문서화)
  staging/        # 원천 → 정제 (1:1 변환, 타입 캐스팅, 컬럼 표준화)
  intermediate/   # 복잡한 비즈니스 로직 중간 단계 (재사용 단위)
  mart/           # 최종 비즈니스 뷰 (BI 도구 연결 대상)
  assertions/     # 데이터 품질 검증
includes/         # 공유 JS 함수/상수
```

레이어 간 규칙:
- `staging` → 원천 테이블만 `ref` (다른 staging 참조 금지)
- `intermediate` → `staging`만 `ref`
- `mart` → `staging` 또는 `intermediate`만 `ref`, 원천 직접 참조 금지
- 같은 레이어 내 순환 참조 금지

레이어 경계를 어기는 순간 의존성 그래프가 복잡해지고 재사용이 불가능해진다. 리뷰 단계에서 `ref()`가 레이어를 건너뛰는지 확인하는 습관이 중요하다.

---

## Incremental 테이블 심화

### 기본 패턴

대용량 이벤트 테이블을 매번 full scan하면 비용이 급증한다. `incremental` 타입과 `when(incremental(), ...)` 필터를 조합한다.

```sql
config {
  type: "incremental",
  uniqueKey: ["event_id"],
  bigquery: {
    partitionBy: "event_date",
    clusterBy: ["user_id", "event_type"]
  }
}

SELECT
  event_id,
  DATE(event_at) AS event_date,
  user_id,
  event_type
FROM ${ref("raw", "events")}

${ when(incremental(), `WHERE event_at >= (SELECT MAX(event_at) FROM ${self()})`) }
```

- `uniqueKey` 설정 시 → MERGE (upsert), 미설정 시 → INSERT ONLY
- `${self()}`로 현재 테이블 자신을 참조해 워터마크 계산

### Late Arriving Data 처리

이벤트가 지연 도착하는 경우 단순 MAX 워터마크는 데이터를 놓친다. 안전 마진을 설정한다.

```sql
${ when(incremental(), `
  WHERE event_at >= TIMESTAMP_SUB(
    (SELECT MAX(event_at) FROM ${self()}),
    INTERVAL 3 HOUR  -- 최대 지연 허용 시간
  )
`) }
```

단, 이 경우 `uniqueKey`가 없으면 중복 행이 생긴다. late arriving 처리를 허용하려면 반드시 `uniqueKey`를 선언해야 한다.

### 복수 워터마크 컬럼

이벤트 생성 시점(`created_at`)과 업데이트 시점(`updated_at`) 모두를 추적해야 할 때:

```sql
${ when(incremental(), `
  WHERE updated_at >= (
    SELECT COALESCE(MAX(updated_at), TIMESTAMP('2020-01-01'))
    FROM ${self()}
  )
`) }
```

`COALESCE`로 테이블이 비어 있는 첫 실행을 안전하게 처리한다.

### Partition 기반 incremental (비용 최적화)

워터마크 서브쿼리 자체도 비용이 발생한다. 파티션 날짜를 기준으로 필터링하면 쿼리 비용을 추가로 줄인다.

```sql
config {
  type: "incremental",
  uniqueKey: ["event_id"],
  bigquery: { partitionBy: "event_date" }
}

SELECT
  event_id,
  DATE(event_at) AS event_date,
  user_id,
  event_type,
  CURRENT_TIMESTAMP() AS _ingested_at
FROM ${ref("raw", "events")}

${ when(incremental(), `
  WHERE event_date >= DATE_SUB(
    (SELECT MAX(event_date) FROM ${self()}),
    INTERVAL 3 DAY  -- 파티션 단위 안전 마진
  )
`) }
```

파티션 필터는 BigQuery의 partition pruning을 활성화해 스캔 비용이 날짜 범위에 비례한다.

### Full Refresh 트리거

스키마 변경이나 로직 수정 후에는 반드시 `--full-refresh` 실행이 필요하다. 이를 자동화하려면 `workflow_settings.yaml`에서 수동 trigger를 명시하거나 Terraform으로 관리한다.

```bash
# 특정 테이블만 full refresh
dataform run --actions mart.events_summary --full-refresh

# 특정 태그 전체 full refresh
dataform run --tags mart --full-refresh
```

---

## Partitioning & Clustering 전략

### 파티션 설계 원칙

BigQuery에서 파티션은 비용과 직결된다. 파티션 컬럼 선택 기준:

1. **시간 기반 파티션이 기본**: `DATE`, `TIMESTAMP`, `DATETIME` 컬럼 → `partitionBy: "event_date"`
2. **Ingestion time 파티션**: 원천에 시간 컬럼이 없을 때 → `partitionBy: "_PARTITIONTIME"`
3. **Integer range 파티션**: 카테고리가 숫자 ID로 고정된 경우 → `partitionBy: { field: "region_id", range: { start: 0, end: 100, interval: 1 } }`

```sql
config {
  type: "table",
  bigquery: {
    partitionBy: "event_date",
    requirePartitionFilter: true  -- 파티션 필터 없는 쿼리 차단 (비용 보호)
  }
}
```

`requirePartitionFilter: true`는 실수로 전체 테이블을 스캔하는 쿼리를 차단한다. 대용량 mart 테이블에는 기본으로 설정한다.

### 클러스터링 전략

파티션 내에서 자주 필터링·조인되는 컬럼을 클러스터 키로 지정한다. 최대 4개 컬럼, 카디널리티가 높은 순으로 나열한다.

```sql
bigquery: {
  partitionBy: "event_date",
  clusterBy: ["user_id", "event_type", "platform"]
}
```

클러스터링은 쿼리 패턴에 따라 효과가 달라진다. `WHERE user_id = X AND event_type = Y` 형태의 필터가 많다면 `["user_id", "event_type"]` 순서로 정렬하는 것이 최적이다.

---

## Assertion 심화

### 빌트인 assertion

```sql
config {
  type: "table",
  assertions: {
    nonNull: ["user_id", "date", "order_count"],
    uniqueKey: ["user_id", "date"],
    rowConditions: [
      "total_amount >= 0",
      "order_count > 0",
      "order_count <= 10000"  -- 이상치 상한선
    ]
  }
}
```

### 커스텀 assertion: 레퍼런스 무결성

```sql
-- assertions/assert_orphan_orders.sqlx
config {
  type: "assertion",
  tags: ["daily", "critical"],
  dependOnDeclaration: true
}

-- user_id가 users 테이블에 없는 고아 주문 감지
SELECT o.order_id, o.user_id
FROM ${ref("mart", "orders")} o
LEFT JOIN ${ref("mart", "users")} u USING (user_id)
WHERE u.user_id IS NULL
```

### 크로스 테이블 합계 검증

```sql
-- assertions/assert_revenue_reconcile.sqlx
config {
  type: "assertion",
  tags: ["daily", "finance"]
}

-- 주문 합계와 결제 합계 불일치 감지 (허용 오차 1%)
SELECT
  o.total_revenue   AS orders_total,
  p.total_revenue   AS payments_total,
  ABS(o.total_revenue - p.total_revenue) / o.total_revenue AS diff_ratio
FROM (
  SELECT SUM(amount) AS total_revenue
  FROM ${ref("mart", "orders")}
  WHERE order_date = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
) o
CROSS JOIN (
  SELECT SUM(amount) AS total_revenue
  FROM ${ref("mart", "payments")}
  WHERE payment_date = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
) p
WHERE ABS(o.total_revenue - p.total_revenue) / o.total_revenue > 0.01
```

### Volume assertion: 갑작스러운 데이터 감소 감지

```sql
-- assertions/assert_daily_event_volume.sqlx
config {
  type: "assertion",
  tags: ["daily", "critical"]
}

-- 전일 대비 이벤트 수가 50% 이상 감소하면 실패
WITH today AS (
  SELECT COUNT(*) AS cnt
  FROM ${ref("staging", "stg_events")}
  WHERE event_date = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
),
yesterday AS (
  SELECT COUNT(*) AS cnt
  FROM ${ref("staging", "stg_events")}
  WHERE event_date = DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)
)
SELECT today.cnt, yesterday.cnt
FROM today, yesterday
WHERE today.cnt < yesterday.cnt * 0.5
```

---

## JavaScript 고급 패턴

### 동적 테이블 생성

여러 소스 테이블에 동일한 변환을 적용할 때:

```javascript
// includes/generate_staging.js
function generate_staging(config) {
  const { sourceSchema, sourceTable, columns, partitionBy } = config;
  
  return publish(`stg_${sourceTable}`, {
    type: "view",
    schema: "staging",
    tags: ["staging"],
    description: `Staging view for ${sourceSchema}.${sourceTable}`
  }).query(ctx => `
    SELECT
      ${columns.map(c => typeof c === 'string' ? c : `${c.expr} AS ${c.alias}`).join(',\n      ')}
    FROM \`${sourceSchema}.${sourceTable}\`
  `);
}

module.exports = { generate_staging };
```

```javascript
// definitions/staging/stg_events.js
const { generate_staging } = require("includes/generate_staging");

generate_staging({
  sourceSchema: "raw_data",
  sourceTable: "events",
  partitionBy: "event_date",
  columns: [
    "event_id",
    { expr: "TIMESTAMP(event_at)", alias: "event_at" },
    { expr: "DATE(event_at)", alias: "event_date" },
    "user_id",
    "LOWER(event_type) AS event_type"
  ]
});
```

### 공통 상수 및 설정 관리

```javascript
// includes/constants.js
const LOOKBACK_DAYS = {
  incremental: 3,
  mart: 30,
  archive: 365
};

const SCHEMAS = {
  staging: dataform.projectConfig.vars.env === "prod" ? "staging" : "staging_dev",
  mart:    dataform.projectConfig.vars.env === "prod" ? "mart"    : "mart_dev"
};

module.exports = { LOOKBACK_DAYS, SCHEMAS };
```

### 조건부 assertion 등록

```javascript
// definitions/mart/user_metrics.js
const isProd = dataform.projectConfig.vars.env === "prod";

publish("user_metrics", {
  type: "incremental",
  schema: "mart",
  assertions: isProd ? {
    nonNull: ["user_id", "metric_date"],
    uniqueKey: ["user_id", "metric_date"]
  } : {}  // dev에서는 assertion 생략해 실행 속도 향상
}).query(ctx => `
  SELECT ...
`);
```

---

## 환경 분리 심화

### workflow_settings.yaml 구조

```yaml
# workflow_settings.yaml
defaultProject: my-gcp-project
defaultLocation: asia-northeast3
defaultDataset: dataform
defaultAssertionDataset: dataform_assertions

vars:
  env: dev
  lookback_days: "7"
```

프로젝트별 `workflow_settings.yaml`을 환경마다 별도로 관리하거나, CI에서 `--vars` 플래그로 주입한다.

### SQLX 내 환경 분기 패턴

```sql
config {
  type: "incremental",
  schema: dataform.projectConfig.vars.env === "prod" ? "mart" : "mart_dev",
  bigquery: {
    partitionBy: "event_date"
  }
}

SELECT *
FROM ${ref("staging", "stg_events")}

${ when(incremental(), `
  WHERE event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL ${dataform.projectConfig.vars.lookback_days} DAY)
`) }
```

### 개발 환경 데이터 샘플링

```sql
config {
  type: "table",
  schema: dataform.projectConfig.vars.env === "prod" ? "mart" : "mart_dev"
}

SELECT *
FROM ${ref("staging", "stg_events")}

-- dev에서는 최근 7일 데이터만, prod는 전체
${ when(dataform.projectConfig.vars.env !== "prod", `
  WHERE event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
`) }
```

---

## Pre/Post Operations

테이블 생성 전후에 DDL을 실행해야 할 때 사용한다.

```sql
config {
  type: "table",
  schema: "mart",
  preOps: [`
    -- 이전 실행의 임시 테이블 정리
    DROP TABLE IF EXISTS \`mart.user_summary_temp\`
  `],
  postOps: [`
    -- 권한 부여
    GRANT SELECT ON TABLE \`mart.user_summary\` TO 'group:data-analysts@company.com'
  `, `
    -- 파티션 통계 갱신
    CALL BQ.REFRESH_MATERIALIZED_VIEW('mart.user_summary_mv')
  `]
}

SELECT ...
```

---

## 태그 전략

태그는 선택적 실행의 기본 단위다. 설계를 미리 잡지 않으면 나중에 정리가 어렵다.

```
빈도 태그: daily, hourly, weekly, monthly
레이어 태그: staging, intermediate, mart
도메인 태그: user, order, payment, product, marketing
품질 태그: assertion, critical, finance
환경 태그: full-refresh (수동 트리거 대상)
```

태그 조합으로 실행 범위를 제어한다:

```bash
# 특정 태그만 실행
dataform run --tags daily --tags mart

# 특정 테이블과 그 upstream만
dataform run --actions mart.user_summary --include-deps

# 특정 테이블과 그 downstream만
dataform run --actions staging.stg_orders --include-dependents

# 태그 제외
dataform run --tags daily --excluded-tags full-refresh
```

---

## CI/CD 통합

### GitHub Actions: PR 검증

```yaml
# .github/workflows/dataform-ci.yml
name: Dataform CI

on:
  pull_request:
    paths:
      - 'definitions/**'
      - 'includes/**'
      - 'workflow_settings.yaml'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Dataform CLI
        run: npm install -g @dataform/cli

      - name: Authenticate GCP
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      # 컴파일만 실행해서 SQL 문법 오류, 순환 참조 감지
      - name: Compile (dry run)
        run: dataform compile --vars env=dev

      # dev 환경에서 변경된 테이블만 실행
      - name: Run changed tables
        run: |
          CHANGED=$(git diff --name-only origin/main...HEAD -- definitions/ | \
            grep '.sqlx' | \
            sed 's|definitions/||; s|.sqlx||; s|/|.|')
          if [ -n "$CHANGED" ]; then
            dataform run --vars env=ci --actions $CHANGED --include-deps
          fi
```

### 프로덕션 배포 워크플로

```yaml
# .github/workflows/dataform-deploy.yml
name: Dataform Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - name: Compile
        run: dataform compile --vars env=prod

      - name: Run assertions only (사전 검증)
        run: dataform run --tags assertion --vars env=prod

      - name: Full pipeline run
        run: dataform run --vars env=prod
```

---

## 고급 SQL 패턴

### Slowly Changing Dimension Type 2 (SCD2)

사용자 속성의 변경 이력을 추적하는 패턴:

```sql
-- definitions/mart/dim_users_scd2.sqlx
config {
  type: "incremental",
  uniqueKey: ["user_id", "valid_from"],
  bigquery: {
    partitionBy: "valid_from",
    clusterBy: ["user_id"]
  }
}

WITH source AS (
  SELECT
    user_id,
    email,
    tier,
    updated_at AS valid_from,
    LEAD(updated_at) OVER (PARTITION BY user_id ORDER BY updated_at) AS valid_to
  FROM ${ref("staging", "stg_user_history")}
),
current_snapshot AS (
  SELECT user_id, MAX(valid_from) AS last_valid_from
  FROM ${self()}
  GROUP BY user_id
)
SELECT
  s.user_id,
  s.email,
  s.tier,
  s.valid_from,
  COALESCE(s.valid_to, TIMESTAMP('9999-12-31')) AS valid_to,
  s.valid_to IS NULL AS is_current
FROM source s

${ when(incremental(), `
  LEFT JOIN current_snapshot c USING (user_id)
  WHERE s.valid_from > COALESCE(c.last_valid_from, TIMESTAMP('2000-01-01'))
`) }
```

### 중복 제거 (Deduplication)

원천 데이터의 중복을 staging에서 제거하는 표준 패턴:

```sql
-- definitions/staging/stg_events.sqlx
config {
  type: "view",
  schema: "staging"
}

WITH deduped AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY event_id
      ORDER BY ingested_at DESC  -- 가장 최근 레코드만 유지
    ) AS rn
  FROM ${resolve("raw_data", "events")}
)
SELECT
  event_id,
  TIMESTAMP(event_at) AS event_at,
  DATE(event_at)      AS event_date,
  user_id,
  LOWER(TRIM(event_type)) AS event_type
FROM deduped
WHERE rn = 1
```

### 동적 피벗 (Pivot)

이벤트 타입별 카운트를 컬럼으로 변환:

```sql
-- definitions/mart/user_event_pivot.sqlx
config {
  type: "table",
  schema: "mart",
  bigquery: { partitionBy: "event_date" }
}

SELECT
  user_id,
  event_date,
  COUNTIF(event_type = 'page_view')    AS page_view_count,
  COUNTIF(event_type = 'add_to_cart')  AS add_to_cart_count,
  COUNTIF(event_type = 'purchase')     AS purchase_count,
  COUNTIF(event_type = 'refund')       AS refund_count
FROM ${ref("staging", "stg_events")}
GROUP BY 1, 2
```

---

## 운영 모니터링

### 실행 이력 조회

Dataform 실행 이력은 BigQuery의 `INFORMATION_SCHEMA`로 추적할 수 있다.

```sql
-- 최근 7일 실행 비용 분석
SELECT
  job_id,
  creation_time,
  query,
  total_bytes_processed / POW(1024, 3) AS gb_processed,
  total_bytes_processed / POW(1024, 3) * 5 / 1024 AS estimated_cost_usd,
  destination_table.table_id AS target_table
FROM `region-asia-northeast3`.INFORMATION_SCHEMA.JOBS
WHERE
  creation_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
  AND user_email LIKE '%dataform%'  -- Dataform SA 계정 필터
  AND error_result IS NOT NULL      -- 실패한 잡만
ORDER BY creation_time DESC
```

### Assertion 실패 이력 추적

```sql
-- 최근 assertion 실패 현황
SELECT
  table_id,
  COUNT(*) AS fail_count,
  MAX(creation_time) AS last_fail_time
FROM `dataform_assertions.INFORMATION_SCHEMA.TABLE_STORAGE`
WHERE total_rows > 0  -- assertion 결과에 행이 있으면 실패
GROUP BY 1
ORDER BY fail_count DESC
```

### 테이블별 데이터 신선도 모니터링

```sql
-- definitions/mart/data_freshness_monitor.sqlx
config {
  type: "table",
  schema: "monitoring",
  tags: ["hourly", "monitoring"]
}

SELECT
  'mart.user_summary'         AS table_name,
  MAX(date)                   AS latest_partition,
  DATE_DIFF(CURRENT_DATE(), MAX(date), DAY) AS staleness_days
FROM ${ref("mart", "user_summary")}

UNION ALL

SELECT
  'mart.orders',
  MAX(order_date),
  DATE_DIFF(CURRENT_DATE(), MAX(order_date), DAY)
FROM ${ref("mart", "orders")}
```

---

## 비용 최적화 체크리스트

### 테이블 설계 관점

- **파티션 필터 강제**: `requirePartitionFilter: true` — 전체 스캔 쿼리를 차단
- **클러스터 키 순서**: WHERE 절에서 자주 사용하는 순서로 최대 4개
- **`view` 남발 주의**: downstream 참조가 많은 중간 집계는 `table`로 물리화
- **`incremental` 비용 비교**: full-refresh 비용 vs 증분 처리 비용 + 관리 복잡도

### 쿼리 작성 관점

- **SELECT \*** 금지: 필요한 컬럼만 명시
- **파티션 pruning 활용**: 날짜 필터가 파티션 컬럼을 직접 사용하는지 확인
- **CROSS JOIN 최소화**: 불필요한 카르테시안 곱 방지
- **서브쿼리 vs CTE**: BigQuery는 CTE가 캐시되지 않으므로 반복 참조 시 임시 테이블 고려

### 운영 관점

- **dev 환경 샘플링**: `WHERE event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)` 패턴
- **불필요한 assertion 범위 제거**: CI에서는 critical 태그만 실행
- **슬롯 예약**: 예측 가능한 워크로드는 Flex Slots보다 예약 슬롯이 저렴

---

## 흔한 실수와 해결

| 실수 | 증상 | 해결 |
|------|------|------|
| 원천 테이블 직접 하드코딩 | 환경 전환 시 테이블 못 찾음 | `ref()` 또는 `resolve()` 사용 |
| incremental 워터마크 없음 | 매일 전체 데이터 중복 적재 | `when(incremental(), ...)` 추가 |
| uniqueKey 누락 | upsert 아닌 insert → 중복 행 | config에 `uniqueKey` 명시 |
| late arriving data 미처리 | 지연 이벤트 누락 | 안전 마진 INTERVAL 추가 |
| assertion 없이 배포 | 데이터 품질 이슈 뒤늦게 발견 | `nonNull` + `uniqueKey` 최소 선언 |
| 모든 테이블 `table` 타입 | 불필요한 갱신 비용 | 중간 단계는 `view` 검토 |
| `view` 다중 참조 | 동일 원천 반복 스캔으로 비용 누적 | 집계 결과는 `table`로 물리화 |
| 레이어 경계 무시 | mart → raw 직접 참조 → 의존성 복잡화 | 레이어 규칙 + 코드 리뷰 |
| `--full-refresh` 미검증 | 스키마 변경 후 파이프라인 중단 | PR마다 full-refresh 실행 확인 |
| dev/prod 환경 혼용 | dev 실행이 prod 테이블 덮어씀 | `vars.env` 분기 필수 |
| `requirePartitionFilter` 미설정 | 개발자 실수로 전체 스캔 → 과금 | mart 테이블 전체에 기본 적용 |

---

## 체크리스트

새 테이블 추가 전 확인:

**설계**
- [ ] 어느 레이어에 속하는가? (staging / intermediate / mart)
- [ ] `ref()`로만 upstream 참조하는가? (레이어 경계 준수)
- [ ] `view`보다 `table`이 적합한 이유가 있는가? (downstream 참조 횟수)

**Incremental**
- [ ] incremental이 필요한가? (일별 append + 대용량)
- [ ] 워터마크 컬럼이 명확한가?
- [ ] late arriving data 안전 마진이 설정되어 있는가?
- [ ] `uniqueKey`가 선언되어 있는가?
- [ ] `--full-refresh` 실행 결과를 검증했는가?

**BigQuery 최적화**
- [ ] 파티션 컬럼이 설정되어 있는가?
- [ ] `requirePartitionFilter`가 활성화되어 있는가? (mart)
- [ ] 클러스터 키가 쿼리 패턴과 일치하는가?

**품질**
- [ ] assertion이 선언되어 있는가? (최소 nonNull + uniqueKey)
- [ ] volume assertion이 필요한가? (critical 테이블)
- [ ] 레퍼런스 무결성 assertion이 필요한가?

**운영**
- [ ] 태그가 올바르게 붙었는가? (빈도 + 레이어 + 도메인)
- [ ] 환경 분기 로직이 올바른가? (`vars.env`)
- [ ] dev 환경에서 샘플링이 적용되어 있는가?

---

## 관련 문서

- [[/data-engineering]] — 데이터 엔지니어링 개요
