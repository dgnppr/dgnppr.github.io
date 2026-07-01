---
layout      : concept
title       : dbt 증분 전략과 매크로 컨트랙트 심화
date        : 2026-07-01 00:00:00 +0900
updated     : 2026-07-01 00:00:00 +0900
tag         : dbt incremental macro contract state-defer data-engineering
toc         : true
comment     : true
latex       : true
status      : draft
public      : true
parent      : [[/dbt]]
confidence  : high
relations:
  - { type: extends, target: concept/dbt/01_dbt_core_features }
  - { type: references, target: concept/dbt/00_what_is_dbt }
---

{% raw %}
* TOC
{:toc}

## 이 문서의 위치

dbt의 기본기 — `ref`/`source`, 4대 materialization, `is_incremental()`을 이용한 증분 기초, `dbt test`, jinja 기초 — 는 초급 [[/dbt/00_what_is_dbt]]와 중급 [[/dbt/01_dbt_core_features]]에서 다뤘다. 이 문서는 그 위에서, **운영 규모에서 실제로 문제를 일으키는 지점**만 파고든다: 증분 전략의 내부 동작과 어댑터별 차이, 재사용 매크로와 패키지, 스키마 계약(contract), 그리고 `state`/`defer`를 이용한 선택적 실행이다. CI/CD 파이프라인 구성과 배포 운영의 구체는 [[/dbt/03_dbt_in_practice]]로 넘긴다.

기준은 dbt Core 1.x다. 증분 전략과 제약(constraint)은 어댑터마다 지원 범위가 다르므로, 각 절에서 어댑터를 명시한다.

## 증분 전략: 문제 정의

증분 모델의 목적은 "매번 전체를 다시 만들지 않는 것"이다. 하지만 "새 데이터만 넣는다"는 문장 하나에 네 가지 다른 SQL 의미가 숨어 있다.

- 원본에 **수정·삭제가 없고** append-only인가, 아니면 늦게 도착한 이벤트가 과거 행을 갱신하는가?
- 중복이 발생할 수 있는가? 발생한다면 무엇을 키로 dedup하는가?
- 웨어하우스가 파티션·클러스터로 물리 분할돼 있어서, **파티션 단위 교체**가 행 단위 병합보다 싼가?

이 세 질문의 답이 곧 증분 전략의 선택이다. dbt는 `incremental_strategy` config로 이를 노출한다.

```sql

{{
  config(
    materialized='incremental',
    incremental_strategy='merge',
    unique_key='event_id',
    on_schema_change='append_new_columns'
  )
}}

select * from {{ ref('stg_events') }}
{% if is_incremental() %}
  where event_ts >= (select max(event_ts) from {{ this }})
{% endif %}

```

`is_incremental()`이 true인 조건은 (1) 대상 테이블이 이미 존재하고, (2) `--full-refresh` 플래그가 없으며, (3) 모델이 `incremental`로 구성돼 있을 때다. 이 세 조건 중 하나라도 어긋나면 dbt는 전체 재빌드(`create or replace`)로 되돌아간다.

## 네 가지 증분 전략 비교

dbt는 증분 모델을 **임시 테이블(또는 CTE)에 델타를 만들고, 그것을 대상 테이블에 반영**하는 2단계로 처리한다. 전략은 이 "반영" 단계가 무엇을 하느냐를 정한다.

| 전략 | 반영 동작 | `unique_key` | dedup/갱신 | 주 적합 상황 |
|------|-----------|--------------|------------|--------------|
| `append` | 델타를 그대로 `insert` | 불필요 | 없음(중복 그대로 쌓임) | append-only 로그, 원본에 수정 없음 |
| `merge` | `MERGE`로 매치되면 update, 아니면 insert | 필요(사실상) | 갱신·중복제거 됨 | upsert, 늦게 도착한 갱신 |
| `delete+insert` | 키 매치 행을 delete 후 insert | 필요 | 갱신됨(원자성 약함) | MERGE 미지원/비효율 어댑터 |
| `insert_overwrite` | 델타가 건드린 **파티션 전체**를 교체 | 불필요(파티션이 키) | 파티션 단위 재계산 | 파티션 테이블의 배치 재처리 |

어댑터별 기본값과 지원은 다르다. 확정적으로 단정하기 어려운 조합이 있으므로, 실제 사용 전에 해당 어댑터 문서를 확인하는 것을 전제로 대략의 지형만 정리한다.

| 어댑터 | 기본 전략 | 지원(대략) | 비고 |
|--------|-----------|------------|------|
| BigQuery | `merge` | `merge`, `insert_overwrite` | `insert_overwrite`는 파티션 교체에 강함 |
| Snowflake | `merge` | `merge`, `delete+insert`, `append` | MERGE에 마이크로파티션 프루닝 활용 |
| Spark (Delta/Iceberg/Hudi) | `append` | `append`, `merge`, `insert_overwrite` | `merge`는 트랜잭션 지원 파일포맷 필요 |
| Redshift/Postgres | `append`/`delete+insert` | `append`, `delete+insert`, (신버전) `merge` | MERGE 지원은 버전 의존 |

### merge의 함정: 무엇을 갱신하는가

`merge`는 편리하지만 비용이 크다. 대상 테이블과 델타를 `unique_key`로 조인하므로, **키 조건이 파티션·클러스터 프루닝을 타지 못하면 대상 테이블 전체를 스캔**한다. 여기서 `incremental_predicates`가 개입한다.

```sql

{{
  config(
    materialized='incremental',
    incremental_strategy='merge',
    unique_key='event_id',
    partition_by={'field': 'event_date', 'data_type': 'date'},
    incremental_predicates=[
      "DBT_INTERNAL_DEST.event_date >= dateadd(day, -3, current_date)"
    ]
  )
}}

```

`incremental_predicates`는 MERGE의 `ON` 절에 추가 조건으로 붙는다(위 BigQuery/Snowflake식 예시). 대상 테이블 쪽에 파티션 필터를 걸어 스캔 범위를 최근 3일로 잘라내는 것이 핵심이다. 이걸 빼면 매일 배치가 수년치 파티션을 병합 대상으로 훑는다 — 함정 1순위다.

또한 기본 `merge`는 매치된 행의 **모든 컬럼**을 update한다. 특정 컬럼만 갱신하려면 `merge_update_columns`, 반대로 특정 컬럼을 보존하려면 `merge_exclude_columns`를 쓴다. `created_at` 같은 최초 적재 시각을 보존할 때 유용하다.

### insert_overwrite: 파티션이 곧 트랜잭션 경계

`insert_overwrite`는 행 단위 병합 대신, 델타가 포함하는 파티션 값 집합을 구하고 그 파티션들을 통째로 교체한다. BigQuery에서는 파티션 테이블에 대해 이 전략이 특히 효과적이다. `unique_key`가 필요 없다 — 파티션 자체가 재처리 단위이기 때문이다.

```sql

{{
  config(
    materialized='incremental',
    incremental_strategy='insert_overwrite',
    partition_by={'field': 'event_date', 'data_type': 'date'}
  )
}}

select event_date, user_id, count(*) as events
from {{ ref('stg_events') }}
{% if is_incremental() %}
  where event_date in ({{ dbt.date_range_last_n_days(3) }})  -- 재처리할 파티션만
{% endif %}
group by 1, 2

```

주의할 점: 이 전략은 **델타에 등장한 파티션은 원본 전체 기준으로 다시 계산돼야 한다**. 위 예시처럼 집계 모델이라면, 최근 3일 파티션에 대해 그 날짜의 모든 행을 재집계해서 파티션을 덮어야 정확하다. 델타에 든 행만 집계하면 파티션이 부분 결과로 덮여 손실이 난다. `merge`와 `insert_overwrite`의 정확성 조건이 다른 이유가 여기 있다.

## 늦게 도착한 데이터와 lookback

증분의 워터마크를 `max(event_ts)`로 잡으면, **워터마크보다 이전 타임스탬프를 가진 채 나중에 도착한 행**은 영원히 누락된다. 이벤트 파이프라인에서 흔한 문제다.

해법은 워터마크에서 일정 구간을 되짚는 **lookback**이다.

```sql

{% if is_incremental() %}
  where event_ts >= (
    select dateadd(day, -{{ var('lookback_days', 3) }}, max(event_ts))
    from {{ this }}
  )
{% endif %}

```

lookback을 3일로 잡으면, 최근 3일 안에 뒤늦게 도착한 이벤트는 다시 델타에 포함된다. 단 이 방식은 **중복을 만들 수 있으므로** `append`와는 어울리지 않는다. `merge`(unique_key로 dedup)나 `insert_overwrite`(파티션 재계산)와 함께 써야 한다. lookback 창을 얼마로 잡을지는 원본 지연의 실측 분포로 정해야 하며, 임의의 큰 값은 매 배치 비용을 그대로 키운다.

lookback으로도 못 잡는 지연(창을 넘긴 데이터, 하드 딜리트, 스키마 대변경)은 주기적 `--full-refresh`로 정정한다. full-refresh는 위에서 말한 세 조건 중 "플래그 없음"을 깨서 전체 재빌드를 강제한다.

## on_schema_change: 델타의 컬럼이 바뀌면

원본에 컬럼이 추가/삭제되면 증분 반영 시 스키마가 어긋난다. `on_schema_change`가 이 정책을 정한다.

| 값 | 동작 |
|----|------|
| `ignore` (기본) | 대상 스키마 유지, 새 컬럼 무시 |
| `fail` | 스키마 불일치 시 실행 실패 |
| `append_new_columns` | 새 컬럼을 대상에 추가(기존 행은 null) |
| `sync_all_columns` | 추가+삭제 모두 반영 |

`sync_all_columns`는 편리하지만 컬럼 삭제까지 자동 반영하므로, 원본의 일시적 스키마 변동이 데이터 손실로 이어질 수 있다. 스키마 계약이 중요한 모델에서는 뒤에 나오는 **contract**로 아예 계약 위반을 빌드 타임에 막는 편이 낫다.

## 매크로 심화와 패키지

매크로는 jinja로 SQL을 생성하는 재사용 함수다. 기초는 중급 문서에서 다뤘고, 여기서는 **재사용 단위로 뽑아내는 기준**과 패키지 활용을 본다.

반복되는 SQL 표현이 있고, 그것이 (1) 여러 모델에 나타나며 (2) 로직 변경 시 한 곳에서 바꿔야 한다면 매크로로 뽑는다. 예: 통화 정규화.

```sql

-- macros/to_usd.sql
{% macro to_usd(amount_col, currency_col) %}
  case {{ currency_col }}
    when 'USD' then {{ amount_col }}
    when 'EUR' then {{ amount_col }} * 1.08
    else null
  end
{% endmacro %}

```

### 패키지: packages.yml과 dbt deps

바퀴를 다시 발명하지 않는다. `dbt_utils`, `dbt_expectations`, `codegen` 등은 검증된 매크로 모음이다.

```yaml
# packages.yml
packages:
  - package: dbt-labs/dbt_utils
    version: [">=1.0.0", "<2.0.0"]
  - package: calogica/dbt_expectations
    version: [">=0.10.0", "<0.11.0"]
```

`dbt deps`로 `dbt_packages/`에 설치한다. 버전은 위처럼 범위로 고정해 재현성을 확보한다. 설치 후 `{{ dbt_utils.star() }}`, `{{ dbt_utils.date_spine() }}` 같은 매크로와, `dbt_utils.equal_rowcount` 같은 generic test를 바로 쓸 수 있다.

### 커스텀 generic test 매크로

`test_`로 시작하는 매크로(또는 `tests/generic/`의 test 블록)는 스키마 YAML에서 재사용 가능한 테스트가 된다. 반환은 "실패 행을 찾는 쿼리"다 — 결과 행이 있으면 실패로 본다.

```sql

-- tests/generic/test_positive_value.sql
{% test positive_value(model, column_name) %}
select {{ column_name }}
from {{ model }}
where {{ column_name }} <= 0
{% endtest %}

```

```yaml
# models/schema.yml
models:
  - name: fct_orders
    columns:
      - name: amount
        tests:
          - positive_value
          - dbt_utils.accepted_range:
              min_value: 0
```

핵심은 "실패의 정의를 SQL로 표현한다"이다. 정상 데이터에서 0행을 반환하도록 쿼리를 짜는 것이 test 매크로의 계약이다.

## hooks와 grants

hook은 모델 실행 전후에 임의 SQL을 끼워 넣는다.

| hook | 실행 시점 | 대표 용도 |
|------|-----------|-----------|
| `pre-hook` | 모델 빌드 직전 | 세션 설정, 임시 인덱스 |
| `post-hook` | 모델 빌드 직후 | grant, 인덱스 생성, 분석용 통계 갱신 |
| `on-run-start` / `on-run-end` | 전체 실행 전/후 | 감사 로그, 알림 |

```sql

{{
  config(
    post_hook="grant select on {{ this }} to role reporter"
  )
}}

```

권한 부여는 hook 대신 **`grants` config**로 선언적으로 관리하는 편이 낫다. dbt가 현재 권한과 비교해 필요한 grant/revoke만 적용한다(어댑터 지원 범위 내에서).

```sql

{{
  config(
    grants={'select': ['role_reporter', 'role_analyst']}
  )
}}

```

hook과 달리 `grants`는 멱등적이고, `copy_grants` 등 재빌드 시 권한 유실 문제를 어댑터 수준에서 다룬다. 명령형 grant hook은 재빌드마다 중복 실행되고 실패 시 롤백이 애매하다 — 선언형을 우선한다.

## model contracts와 constraints

증분 모델의 스키마 표류, 다운스트림 계약 파기는 운영 사고의 단골이다. **contract**는 모델의 출력 스키마를 YAML에 명시하고, dbt가 빌드 타임에 그 계약을 강제하게 만든다.

```yaml
# models/marts/schema.yml
models:
  - name: fct_orders
    config:
      contract:
        enforced: true
    columns:
      - name: order_id
        data_type: int64
        constraints:
          - type: not_null
          - type: primary_key
      - name: amount
        data_type: numeric
        constraints:
          - type: not_null
      - name: currency
        data_type: string
```

`contract.enforced: true`이면 dbt는 모델 SQL의 실제 출력 타입이 선언된 `data_type`과 다르거나 컬럼이 빠지면 **빌드를 실패**시킨다. 이것이 계약의 1차 가치다: 스키마 변경이 조용히 다운스트림을 깨는 대신, 빌드에서 큰 소리로 멈춘다.

주의할 점은 **constraint의 실제 강제 여부는 플랫폼마다 다르다**는 것이다.

| constraint | 강제 정도(대략) |
|------------|----------------|
| `not_null` | BigQuery/Snowflake 등에서 실제 강제되는 경우가 많음 |
| `primary_key`/`unique` | 다수 웨어하우스에서 **정보성(informational)**, 물리 강제 안 됨 |
| `foreign_key` | 대체로 정보성 |
| `check` | 어댑터 지원 시 강제(Postgres 등), 아닌 경우 무시 |

즉 `primary_key` constraint를 걸어도 웨어하우스가 유일성을 물리적으로 보장하지 않는 경우가 흔하다. 실제 유일성 검증은 여전히 `unique` **test**의 몫이다. contract는 "타입·존재·not_null 계약"을 빌드 타임에 잠그는 도구이고, test는 "값의 품질"을 런타임에 확인하는 도구다 — 둘은 대체가 아니라 보완이다.

### model versions

계약이 있으면 스키마를 바꿀 때 다운스트림을 한 번에 깨지 않고 **버전으로 병행**할 수 있다.

```yaml
models:
  - name: fct_orders
    latest_version: 2
    versions:
      - v: 1
        # 구 스키마 (deprecated 예정)
      - v: 2
        columns:
          - name: order_id
            data_type: int64
```

`{{ ref('fct_orders', v=1) }}`로 특정 버전을 참조한다. 소비자가 v2로 이전할 때까지 v1을 유지하고, 이전이 끝나면 v1을 제거한다. 계약 없는 모델에서는 버전 관리의 의미가 약하다 — contract와 versions는 짝으로 쓴다.

## exposures와 metrics

**exposure**는 dbt 모델을 소비하는 외부 자산(BI 대시보드, ML 파이프라인 등)을 그래프에 등록한다. 데이터 자체는 만들지 않지만, lineage를 dbt 밖 소비처까지 연장한다.

```yaml
# models/exposures.yml
exposures:
  - name: revenue_dashboard
    type: dashboard
    maturity: high
    url: https://bi.example.com/dash/42
    depends_on:
      - ref('fct_orders')
    owner:
      name: Data Team
      email: data@example.com
```

이 등록의 실질 이득은 두 가지다. `dbt docs`의 lineage에 소비처가 나타나 영향 분석이 가능해지고, 뒤에 나올 `state:modified`와 결합해 **"이 대시보드가 의존하는 모델만"** 선택 실행할 수 있다(`--select +exposure:revenue_dashboard`).

metrics(시맨틱 레이어)는 dbt에서 지표 정의를 표준화하는 기능이지만, 구현·패키징이 버전에 따라 크게 달라져 왔다. 여기서는 존재만 짚고, 채택 시 사용 중인 dbt 버전의 시맨틱 레이어 문서를 기준으로 확인하는 것을 권한다 — 이 문서에서 특정 문법을 단정하지 않는다.

## state와 defer: 바뀐 것만 실행하기

프로젝트가 수백 모델로 커지면 "매번 전부 빌드"는 불가능해진다. dbt는 **직전 실행의 산출물(manifest)** 을 기준으로, 무엇이 바뀌었는지 비교하는 `state` 셀렉터를 제공한다.

핵심은 이전 실행의 `manifest.json`을 어딘가에 보관해 두고, 그것을 `--state` 경로로 지정하는 것이다.

```bash
# 이전 실행 아티팩트를 prod-artifacts/ 에 보관해 뒀다고 가정
dbt build --select "state:modified+" --state ./prod-artifacts
```

`state:modified`는 이전 manifest 대비 코드/구성/계약이 바뀐 모델을 고른다. 뒤의 `+`는 그 다운스트림까지 포함해, 변경의 영향 범위를 함께 재빌드한다는 뜻이다.

| 셀렉터 | 의미 |
|--------|------|
| `state:modified` | 바뀐 노드 |
| `state:new` | 이전 manifest에 없던 노드 |
| `state:modified+` | 바뀐 노드 + 하위 의존 |
| `+state:modified` | 바뀐 노드 + 상위 의존 |

### defer: 없는 upstream은 운영 것을 빌린다

`state:modified`만 빌드하면, 그 모델이 참조하는 **바뀌지 않은 upstream 모델은 개발 스키마에 존재하지 않는다.** `--defer`는 이 문제를 푼다: 현재 환경에 없는 `ref` 대상은 `--state`의 manifest가 가리키는 **다른 환경(보통 운영)의 테이블로 해석**한다.

```bash
dbt build \
  --select "state:modified+" \
  --defer --state ./prod-artifacts
```

이렇게 하면 바뀐 모델과 그 하위만 개발 스키마에 새로 만들고, 바뀌지 않은 upstream은 운영 테이블을 그대로 읽는다. 개발 스키마에 전체 그래프를 복제할 필요가 없어진다.

이 두 기능(`state:modified` + `defer`)의 조합이 흔히 말하는 **slim CI**의 토대다: PR에서 바뀐 모델과 그 영향권만 빌드·테스트하면 되므로, CI 시간이 프로젝트 크기가 아니라 변경 크기에 비례하게 된다. 다만 이것이 성립하려면 "신뢰할 수 있는 이전 manifest를 어떻게 저장·주입하느냐"라는 운영 문제가 남는다. 아티팩트 보관, 브랜치 전략, CI 러너 구성 같은 실전 배선은 이 문서의 경계를 넘으므로 [[/dbt/03_dbt_in_practice]]에서 다룬다.

## 경계: 커스텀 materialization

증분 전략이나 표준 materialization으로 표현되지 않는 물리화 로직(예: 특수한 스냅샷, 외부 시스템 export)이 필요하면 **커스텀 materialization**을 직접 작성할 수 있다. `{% materialization name, adapter='...' %}` 블록으로 정의하며, dbt의 relation 생성·교체 로직을 손으로 짜는 일이다. 강력하지만 유지보수 부담이 크고, 대부분의 요구는 표준 전략 + hook + 매크로로 충분하다. 이 문서에서는 존재만 짚고 깊이는 다루지 않는다.

## 정리: 무엇을 언제 쓰나

| 문제 | 도구 |
|------|------|
| append-only 로그 적재 | `append` |
| 늦게 도착하는 upsert | `merge` + `unique_key` + `incremental_predicates` + lookback |
| 파티션 테이블 배치 재처리 | `insert_overwrite` + 파티션 전체 재계산 |
| 반복 SQL 로직 제거 | 매크로 / `dbt_utils` |
| 값 품질 검증 | generic test 매크로 |
| 스키마·타입 계약 잠그기 | contract `enforced` + constraints |
| 스키마 무중단 전환 | model versions |
| 변경분만 CI 빌드 | `state:modified+` + `defer` |

고급 dbt의 공통 원리는 하나다: **매번 전체를 다시 하지 않으면서 정확성을 유지하기.** 증분 전략은 데이터 반영에서, contract는 스키마에서, `state`/`defer`는 실행 그래프에서 각각 그 원리를 구현한다. 셋 다 "생략의 조건"을 명시적으로 관리하는 도구이며, 그 조건을 틀리게 잡으면 조용한 데이터 손실로 돌아온다는 점도 공통이다.
{% endraw %}
