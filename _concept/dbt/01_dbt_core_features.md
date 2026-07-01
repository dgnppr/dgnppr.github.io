---
layout      : concept
title       : dbt 소스 테스트 스냅샷 증분 모델 다루기
date        : 2026-07-01 00:00:00 +0900
updated     : 2026-07-01 00:00:00 +0900
tag         : dbt testing snapshot incremental jinja data-engineering
toc         : true
comment     : true
latex       : true
status      : draft
public      : true
parent      : [[/dbt]]
confidence  : high
relations:
  - { type: extends, target: concept/dbt/00_what_is_dbt }
---

{% raw %}
* TOC
{:toc}

## 이 문서의 자리

초급 문서 [[/dbt/00_what_is_dbt]]에서 dbt의 실행 모델, `ref()`, materialization(view/table), 컴파일 개념을 다뤘다. 이 문서는 그 위에서 **운영 가능한 dbt 프로젝트**를 만드는 여섯 축을 다룬다: 소스 선언, 테스트, 스냅샷, 시드, 증분 모델의 기초, 그리고 이 모든 것을 떠받치는 Jinja.

증분 전략의 구체적 비교(append/merge/delete+insert/insert_overwrite), 매크로 심화, 모델 컨트랙트는 [[/dbt/02_dbt_advanced]] 소관이다. 여기서는 "무엇이고 왜 쓰는가"까지만 간다.

기준 버전은 dbt Core 1.x다. 어댑터(dbt-bigquery, dbt-snowflake 등)에 따라 세부 동작이 갈리는 지점은 그때그때 명시한다.

## source() — 원천 테이블을 프로젝트 안으로 선언한다

`ref()`는 dbt가 만든 모델을 가리킨다. 하지만 파이프라인의 맨 앞에는 dbt가 만들지 않은 테이블이 있다. Fivetran이 적재한 raw 스키마, 이벤트 로그, 외부 시스템이 밀어넣은 테이블. 이걸 모델 SQL에 `raw.public.orders`처럼 하드코딩하면 두 가지를 잃는다: **계보(lineage) 추적**과 **한 곳에서 이름을 바꿀 능력**.

`source`는 이 원천 테이블들을 YAML로 선언하고 `{{ source() }}`로 참조하게 한다.

```yaml
# models/staging/_sources.yml
version: 2

sources:
  - name: raw            # 논리 소스 그룹 이름
    database: analytics  # BigQuery면 project, Snowflake면 database
    schema: public       # 실제 스키마(dataset)
    tables:
      - name: orders
      - name: customers
        identifier: cust_v2   # 실제 물리 테이블명이 다르면 identifier로 매핑
```

모델에서는 이렇게 참조한다.

```sql
-- models/staging/stg_orders.sql
select
    id            as order_id,
    customer_id,
    status,
    created_at
from {{ source('raw', 'orders') }}
```

`{{ source('raw', 'orders') }}`는 컴파일 시 `analytics.public.orders`로 치환된다. 이렇게 하면 원천 테이블이 계보 그래프의 시작 노드로 등록되고, 물리 위치가 바뀌어도 YAML 한 곳만 고치면 된다.

**컨벤션:** source를 모델에서 직접 여기저기 쓰지 않는다. `stg_*` staging 모델에서만 source를 참조하고, 하위 모델은 staging을 `ref()`한다. source 참조 지점을 프로젝트 경계 한 겹으로 몰아두는 규율이다.

### source freshness — 원천이 멈췄는지 감시한다

모델이 아무리 정확해도 원천 적재가 멈추면 어제 데이터로 오늘 리포트를 만든다. dbt는 원천의 **신선도(freshness)**를 검사하는 기능을 내장한다.

```yaml
sources:
  - name: raw
    database: analytics
    schema: public
    tables:
      - name: orders
        loaded_at_field: created_at   # 신선도 판정에 쓸 타임스탬프 컬럼
        freshness:
          warn_after:  {count: 12, period: hour}
          error_after: {count: 24, period: hour}
```

```bash
dbt source freshness
```

이 명령은 각 테이블에서 `max(loaded_at_field)`를 조회해 "가장 최근 데이터가 얼마나 오래됐는지"를 계산한다. `warn_after`를 넘으면 warn, `error_after`를 넘으면 error로 종료한다. CI나 스케줄러에서 이 종료 코드를 잡아 알림을 보내면 **적재 지연을 모델 실패보다 먼저** 잡는다.

주의할 점 두 가지. `loaded_at_field`는 "레코드가 적재된 시각"에 가까워야 한다. 비즈니스 이벤트 시각(주문 발생 시각)과 적재 시각이 크게 다르면 신선도 판정이 왜곡된다. 그리고 이 검사는 매번 원천에 `max()` 쿼리를 날리므로, 큰 테이블에서는 파티션 컬럼을 `loaded_at_field`로 쓰거나 `filter`를 걸어 풀스캔을 피한다.

## 테스트 — 데이터 계약을 코드로 강제한다

dbt 테스트는 "이 조건을 위반하는 행을 반환하는 SELECT 쿼리"다. 반환 행이 0이면 통과, 1행 이상이면 실패. 이 단순한 규약이 두 종류의 테스트를 만든다.

### Generic test 4종

가장 많이 쓰는 내장 generic test는 넷이다. 컬럼 밑에 이름만 적으면 dbt가 검증 쿼리를 생성한다.

| 테스트 | 검증하는 것 | 흔한 용도 |
|--------|-------------|-----------|
| `unique` | 컬럼 값에 중복이 없음 | PK, 자연키 |
| `not_null` | NULL이 없음 | 필수 컬럼 |
| `accepted_values` | 값이 지정한 목록 안에 있음 | status, type 같은 enum |
| `relationships` | 값이 다른 테이블의 컬럼에 존재함 (참조 무결성) | FK |

`schema.yml`에 이렇게 붙인다.

```yaml
# models/marts/_models.yml
version: 2

models:
  - name: dim_orders
    columns:
      - name: order_id
        tests:
          - unique
          - not_null
      - name: status
        tests:
          - accepted_values:
              values: ['pending', 'paid', 'shipped', 'cancelled']
      - name: customer_id
        tests:
          - not_null
          - relationships:
              to: ref('dim_customers')
              field: customer_id
```

```bash
dbt test                          # 전체 테스트
dbt test --select dim_orders      # 특정 모델만
dbt build --select dim_orders     # run + test를 의존성 순서로 함께
```

`dbt build`는 각 모델을 만든 뒤 곧바로 그 모델의 테스트를 돌리고, 실패하면 하위 모델 실행을 막는다. 오염된 데이터가 downstream으로 번지는 걸 끊는 실행 방식이라 프로덕션에서는 `run`+`test` 분리보다 `build`를 선호한다.

`unique` + `not_null` 조합은 실질적으로 PK 제약을 표현한다. 대부분의 분석용 웨어하우스(BigQuery, 과거의 Redshift 등)는 PK 제약을 강제하지 않으므로, dbt 테스트가 사실상 유일한 무결성 방어선이 되는 경우가 많다.

### Singular test — 임의의 SQL로 검증

generic test로 표현 안 되는 규칙은 `tests/` 디렉터리에 SQL 파일 하나로 쓴다. "위반 행을 SELECT" 규약만 지키면 된다.

```sql
-- tests/assert_no_future_orders.sql
-- 미래 시각으로 찍힌 주문은 없어야 한다
select order_id, created_at
from {{ ref('dim_orders') }}
where created_at > current_timestamp()
```

```sql
-- tests/assert_order_total_matches_lines.sql
-- 주문 합계가 라인아이템 합과 일치해야 한다
with order_sum as (
    select order_id, sum(amount) as line_total
    from {{ ref('fct_order_lines') }}
    group by 1
)
select o.order_id, o.total, s.line_total
from {{ ref('dim_orders') }} o
join order_sum s using (order_id)
where o.total != s.line_total
```

정리하면: **행 단위 컬럼 규칙은 generic, 여러 테이블에 걸친 비즈니스 규칙은 singular.**

> **한계 정직하게:** dbt 테스트는 웨어하우스에 실제 쿼리를 던진다. 테이블이 크고 테스트가 많으면 CI 비용과 시간이 늘어난다. 값비싼 테스트에는 `config(severity='warn')`로 경고만 내거나, `where` 옵션으로 최근 파티션만 검사하는 식으로 범위를 좁힌다. 또한 dbt 테스트는 **웨어하우스에 이미 적재된 데이터**만 검증한다. 적재 이전 단계의 품질은 소관 밖이다.

## snapshot — 변하는 원천을 SCD Type 2로 박제한다

원천 테이블의 대부분은 **덮어쓰기**된다. `customers.status`가 `active`에서 `churned`로 바뀌면 이전 값은 사라진다. "이 고객이 언제까지 active였나"를 나중에 알 방법이 없다. 이 이력을 dbt가 스스로 쌓아주는 기능이 snapshot이며, 데이터 모델링 용어로 **SCD Type 2**(변경 이력을 새 행으로 보존)를 구현한다.

```sql
-- snapshots/customers_snapshot.sql
{% snapshot customers_snapshot %}

{{
    config(
        target_schema='snapshots',
        unique_key='customer_id',
        strategy='timestamp',
        updated_at='updated_at'
    )
}}

select * from {{ source('raw', 'customers') }}

{% endsnapshot %}
```

```bash
dbt snapshot
```

`dbt snapshot`을 돌릴 때마다 dbt는 원천의 현재 상태와 스냅샷 테이블의 최신 행을 비교한다. 변경이 감지되면 이전 행을 닫고(만료 처리) 새 행을 추가한다. dbt는 다음 메타 컬럼을 자동으로 붙인다.

| 컬럼 | 의미 |
|------|------|
| `dbt_scd_id` | 각 이력 행의 고유 해시 |
| `dbt_valid_from` | 이 버전이 유효해진 시각 |
| `dbt_valid_to` | 이 버전이 만료된 시각 (현재 유효한 행은 NULL) |
| `dbt_updated_at` | 스냅샷이 이 행을 기록한 시각 |

"어느 시점의 값이었나"는 이렇게 조회한다.

```sql
-- 2026-03-01 시점에 유효했던 고객 상태
select customer_id, status
from {{ ref('customers_snapshot') }}
where dbt_valid_from <= '2026-03-01'
  and (dbt_valid_to > '2026-03-01' or dbt_valid_to is null)
```

### timestamp vs check 전략

변경을 감지하는 방식이 두 가지다.

| 전략 | 감지 방법 | 요구 조건 | 트레이드오프 |
|------|-----------|-----------|--------------|
| `timestamp` | `updated_at` 컬럼이 이전보다 커졌는가 | 신뢰할 수 있는 갱신 타임스탬프 필요 | 가볍고 정확. 단, 타임스탬프가 갱신 없이 바뀌거나 갱신돼도 안 바뀌면 이력이 어긋남 |
| `check` | 지정한 컬럼들의 값이 하나라도 달라졌는가 | 타임스탬프 불필요 | 타임스탬프 없어도 됨. 대신 매번 컬럼 값 비교, `check_cols='all'`은 컬럼 추가에 취약 |

```sql
-- check 전략: 지정 컬럼이 바뀌면 새 버전
{{
    config(
        target_schema='snapshots',
        unique_key='customer_id',
        strategy='check',
        check_cols=['status', 'plan', 'email']
    )
}}
```

`updated_at`을 신뢰할 수 있으면 `timestamp`가 정답이다. 그런 컬럼이 없을 때만 `check`를 쓰되, 감시할 컬럼을 명시적으로 나열하는 편이 `check_cols='all'`보다 안전하다.

> **운영 주의:** snapshot 테이블은 원천의 append-only 이력이다. 잘못 돌리거나 삭제 후 재생성하면 과거 이력이 통째로 사라진다. 다른 모델과 달리 `--full-refresh`로 함부로 재빌드하면 안 되는 자산으로 취급한다. 실행 주기도 원천 변경보다 촘촘해야 그 사이 발생한 중간 상태 변화를 놓치지 않는다(스냅샷은 실행 시점의 상태만 포착하므로, 실행 간격 사이에 두 번 바뀌면 중간값은 기록되지 않는다).

## seed — CSV를 버전 관리되는 테이블로

`seed`는 프로젝트의 `seeds/` 폴더에 있는 CSV를 웨어하우스 테이블로 적재하는 기능이다.

```
seeds/country_codes.csv
```

```csv
code,country_name,region
KR,South Korea,APAC
US,United States,NA
DE,Germany,EMEA
```

```bash
dbt seed
```

이후 `{{ ref('country_codes') }}`로 여느 모델처럼 참조한다. 타입을 명시하려면 YAML로 지정한다.

```yaml
# seeds/_seeds.yml
version: 2
seeds:
  - name: country_codes
    config:
      column_types:
        code: varchar(2)
```

**언제 쓰나 / 언제 안 쓰나**를 명확히 하는 게 핵심이다.

| seed가 맞는 경우 | seed가 틀린 경우 |
|------------------|------------------|
| 손으로 관리하는 소량의 매핑/룩업 (국가코드, 상태코드 한글명) | 실데이터, 사실 테이블 |
| Git으로 변경 이력을 남기고 싶은 정적 참조표 | 수천 행 이상, 자주 바뀌는 데이터 |
| 코드 리뷰로 변경을 통제하고 싶은 기준 정보 | 민감정보(CSV가 곧 평문 저장소) |

기준선: **사람이 편집하는, 작고, 자주 안 바뀌는 표**만 seed다. seed는 적재 도구가 아니라 버전 관리되는 참조 데이터 수단이다. 대량/실데이터를 seed에 넣으면 Git 리포지토리가 데이터 저장소로 오염되고 `dbt seed`가 느려진다.

## incremental 모델 — 기초 개념

view/table materialization은 매 실행마다 대상 테이블을 처음부터 다시 만든다. 원천이 수억 행이고 매일 몇백만 행만 늘어난다면, 전체 재빌드는 비용과 시간을 낭비한다. `incremental` materialization은 **새로 들어온/바뀐 행만 골라 기존 테이블에 반영**한다.

```sql
-- models/marts/fct_events.sql
{{
    config(
        materialized='incremental',
        unique_key='event_id'
    )
}}

select
    event_id,
    user_id,
    event_type,
    created_at
from {{ source('raw', 'events') }}

{% if is_incremental() %}
    -- 첫 full-refresh 때는 이 블록이 빠진 채로 전체를 만든다.
    -- 이후 실행에서는 이미 적재된 최신 시각 이후 데이터만 읽는다.
    where created_at > (select max(created_at) from {{ this }})
{% endif %}
```

세 가지 구성요소의 의미만 잡으면 된다.

| 요소 | 무엇인가 | 왜 필요한가 |
|------|----------|-------------|
| `is_incremental()` | 이번 실행이 증분 실행인지 반환하는 매크로. 테이블이 이미 존재하고 `--full-refresh`가 아닐 때 `true` | 첫 빌드(전체)와 이후 빌드(증분)의 SQL을 갈라 쓰기 위함 |
| `{{ this }}` | **지금 만들고 있는 이 모델 자신**의 물리 참조 | 이미 적재된 데이터의 경계(예: `max(created_at)`)를 알아내 그 이후만 읽기 위함 |
| `unique_key` | 행을 식별하는 키 | 같은 키가 다시 들어오면 중복 추가 대신 갱신하도록. 지연 도착·수정된 레코드를 안전하게 처리 |

동작 흐름은 이렇다. 첫 실행에서는 테이블이 없으니 `is_incremental()`이 `false`가 되어 `where` 블록 없이 전체를 적재한다. 이후 실행에서는 `true`가 되어 `{{ this }}`의 `max(created_at)` 이후 행만 읽어 반영한다. `unique_key`가 있으면 dbt는 새 데이터 중 기존 키와 겹치는 행을 갱신하고 새 키는 추가한다.

> **함정 두 가지.** (1) `where created_at > max(...)` 경계는 등호와 지연 도착에 취약하다. 경계 시각에 걸친 행을 놓치거나 중복시키기 쉬워 보통 약간의 lookback window(예: 최근 3일 재처리)를 둔다. (2) `unique_key`를 안 주면 dbt는 갱신 없이 append만 한다 — 같은 레코드가 재적재되면 중복이 쌓인다.

이 갱신을 **실제로 어떻게** 수행하는가 — append로 그냥 붙이는지, merge로 upsert하는지, delete+insert로 파티션을 갈아끼우는지, BigQuery의 insert_overwrite로 파티션 단위 교체를 하는지 — 이 `incremental_strategy` 선택과 어댑터별 비교는 [[/dbt/02_dbt_advanced]]에서 다룬다. 여기서는 "증분이 무엇이고 왜 쓰는가"까지다.

## Jinja 기초 — dbt SQL이 프로그래밍 가능한 이유

지금까지 나온 `{{ source() }}`, `{% if %}`, `{{ this }}`는 모두 Jinja다. dbt는 모델 SQL을 웨어하우스에 보내기 전에 Jinja로 렌더링(컴파일)한다. 컴파일 자체의 개념은 초급 문서 [[/dbt/00_what_is_dbt]]에서 다뤘으니, 여기서는 문법 요소만 정리한다.

### 두 가지 구분자

| 구문 | 이름 | 역할 | 예 |
|------|------|------|-----|
| `{{ ... }}` | expression | 값을 계산해 **SQL에 출력** | `{{ ref('x') }}`, `{{ var('start') }}` |
| `{% ... %}` | statement | 흐름 제어. **출력 없음** | `{% if %}`, `{% for %}`, `{% set %}` |
| `{# ... #}` | comment | 렌더링 시 제거되는 주석 | `{# 컴파일에도 안 남음 #}` |

핵심 구분: **`{{ }}`는 쓴다(출력), `{% %}`는 판단한다(제어).** `is_incremental()` 예제에서 `{% if %}`는 SQL을 만들지 않고 조건만 판단하고, 그 안의 `{{ this }}`가 실제 테이블명을 출력한다.

### 자주 쓰는 함수/변수

```sql
-- ref: 다른 모델 참조 (초급 문서 참고)
from {{ ref('stg_orders') }}

-- source: 원천 참조
from {{ source('raw', 'orders') }}

-- var: dbt_project.yml이나 --vars로 주입되는 변수
where created_at >= '{{ var("start_date", "2026-01-01") }}'
--   var('이름', '기본값') — 기본값을 주면 미지정 시 안전

-- config: 모델 설정을 SQL 안에서 지정
{{ config(materialized='table', tags=['daily']) }}
```

`var()`는 환경별로 값을 바꿔 실행할 때 쓴다.

```yaml
# dbt_project.yml
vars:
  start_date: '2026-01-01'
```

```bash
dbt run --vars '{"start_date": "2026-06-01"}'
```

`{% set %}`와 `{% for %}`로 반복 SQL을 생성할 수도 있다.

```sql
-- 여러 지표 컬럼을 반복으로 생성
{% set metrics = ['clicks', 'views', 'purchases'] %}

select
    user_id,
    {% for m in metrics %}
    sum({{ m }}) as total_{{ m }}{% if not loop.last %},{% endif %}
    {% endfor %}
from {{ ref('stg_events') }}
group by 1
```

`{% if not loop.last %},{% endif %}`는 마지막 항목 뒤에 쉼표를 안 붙이는 관용구다. Jinja로 SQL을 생성할 때 가장 흔한 실수가 이 쉼표 처리이므로 `compile`로 결과 SQL을 눈으로 확인하는 습관이 필요하다.

```bash
dbt compile --select fct_events
# target/compiled/ 아래에 렌더링된 실제 SQL이 남는다 — 반드시 확인
```

## 매크로 — 정의만

위 `{% for %}` 로직을 여러 모델에서 재사용하려면 함수로 빼야 한다. dbt에서 그 함수가 **매크로**다. `macros/` 폴더에 정의하고 `{{ }}`로 호출한다.

```sql
-- macros/cents_to_dollars.sql
{% macro cents_to_dollars(column_name, decimals=2) %}
    round({{ column_name }} / 100.0, {{ decimals }})
{% endmacro %}
```

```sql
-- 모델에서 호출
select
    order_id,
    {{ cents_to_dollars('amount_cents') }} as amount_usd
from {{ ref('stg_orders') }}
```

매크로는 "SQL 조각을 반환하는 Jinja 함수"다. 반복되는 표현식, 조건 로직, DDL 패턴을 한 곳으로 모은다. 사실 `is_incremental()`, `ref()`도 dbt와 어댑터가 제공하는 매크로다.

매크로의 심화 — 인자로 관계(relation) 받기, `dbt_utils` 같은 패키지 매크로 활용, `run_query`로 컴파일 시점에 웨어하우스를 조회하는 introspection, `{% materialization %}` 커스텀 — 은 [[/dbt/02_dbt_advanced]]에서 다룬다. 중급에서는 "반복되는 SQL은 매크로로 뺀다"는 정의까지 잡으면 충분하다.
{% endraw %}
