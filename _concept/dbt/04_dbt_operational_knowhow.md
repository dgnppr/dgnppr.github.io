---
layout      : concept
title       : dbt 운영 노하우 함정과 성능 비용 회피
date        : 2026-07-01 00:00:00 +0900
updated     : 2026-07-01 00:00:00 +0900
tag         : dbt performance cost pitfalls data-engineering
toc         : true
comment     : true
latex       : true
status      : draft
public      : true
parent      : [[/dbt]]
confidence  : medium
relations:
  - { type: extends, target: concept/dbt/03_dbt_in_practice }
  - { type: references, target: concept/dbt/02_dbt_advanced }
---

{% raw %}
* TOC
{:toc}

## 이 문서의 범위

이 글은 dbt의 **함정 카탈로그**다. 증분 모델·materialization·테스트·CI 같은 기능 자체의 정의와 기초 사용법은 다루지 않는다. 그건 이미 다음에 있다.

- 증분 전략·컨트랙트·스냅샷 등 고급 기능: `[[/dbt/02_dbt_advanced]]`
- 프로젝트 구조·CI·오케스트레이션 활용: `[[/dbt/03_dbt_in_practice]]`
- 테스트·증분 기초: `[[/dbt/01_dbt_core_features]]`

여기서는 "이미 알고 쓰는데 프로덕션에서 터지는" 것들만 **증상 → 원인 → 조치** 구조로 정리한다. 기준은 dbt Core 1.x다. 비용은 어댑터마다 과금 모델이 다르므로(BigQuery는 스캔 바이트, Snowflake는 웨어하우스 가동 시간) 절대 수치보다 **원리와 방향**을 적는다. 벤치마크 숫자는 환경(데이터량·클러스터링·웨어하우스 크기·동시성)에 따라 크게 달라지므로 단정하지 않는다.

## 증분 모델: 가장 많이 터지는 곳

증분 모델(`materialized='incremental'`)은 dbt에서 비용을 가장 크게 좌우하지만, 조용히 데이터를 손상시키는 함정도 가장 많다.

### 함정 1 — 늦게 도착한 데이터(late-arriving) 유실

**증상.** 소스에는 있는 레코드가 마트 테이블엔 빠져 있다. 재집계해도 안 채워진다.

**원인.** 증분 필터를 이벤트 시각(`event_time`) 기준으로 잡아서, 처리 시점 이후에 도착한 과거 데이터가 필터 밖으로 밀려난다.

```sql
-- 위험: event_time 기준. 3일 전 이벤트가 오늘 도착하면 영원히 누락
{% if is_incremental() %}
WHERE event_time > (SELECT MAX(event_time) FROM {{ this }})
{% endif %}
```

**조치.** ① 처리 시각과 이벤트 시각을 분리하고, 워터마크는 적재 시각(`_loaded_at`) 기준으로 잡되 ② 룩백 윈도우로 과거 구간을 겹쳐 재처리한다. 중복은 아래 `unique_key`가 흡수한다.

```sql
-- 안전: 적재 시각 워터마크 + 3일 룩백 재처리
{% if is_incremental() %}
WHERE _loaded_at > (
  SELECT DATE_SUB(MAX(_loaded_at), INTERVAL 3 DAY) FROM {{ this }}
)
{% endif %}
```

룩백 윈도우는 공짜가 아니다. 창이 넓을수록 매 실행 스캔·머지 비용이 는다. "SLA상 데이터가 얼마나 늦게 오는가"로 정하고, 무한정 넓히지 않는다. 근본 지연이 크면 증분 대신 파티션 교체 방식을 고려한다.

### 함정 2 — `unique_key` 누락으로 중복 누적

**증상.** 실행할수록 행이 늘어난다. 룩백을 켰더니 중복이 폭증한다.

**원인.** `unique_key`가 없으면 dbt는 조건에 맞는 행을 **append**만 한다. 룩백으로 같은 구간을 다시 읽으면 그대로 두 번 들어간다.

**조치.** 자연키 또는 대리키를 `unique_key`로 지정한다. 복합키는 리스트로 준다(어댑터가 지원할 때). 단일 컬럼만 지원하는 상황이면 해시 대리키를 만든다.

```sql
{{ config(
    materialized='incremental',
    incremental_strategy='merge',
    unique_key=['user_id', 'event_date']
) }}
```

`unique_key`를 넣으면 전략이 `append`에서 `merge`(또는 `delete+insert`)로 바뀐다는 점을 기억한다. 정확성은 얻지만 비용 구조가 달라진다(함정 4).

### 함정 3 — full-refresh를 잊어 스키마 드리프트

**증상.** 모델 SQL에 컬럼을 추가했는데 프로덕션 테이블엔 새 컬럼이 안 생긴다. 혹은 `column X not found` 에러가 난다.

**원인.** 증분 모델은 기존 테이블에 이어붙이므로 **DDL 변경이 자동 전파되지 않는다.** 기본 `on_schema_change='ignore'`는 새 컬럼을 조용히 버린다.

**조치.** 두 축으로 관리한다.

| 상황 | 조치 |
|------|------|
| 컬럼 추가만 | `on_schema_change='append_new_columns'`로 신규 컬럼만 반영 |
| 타입 변경·컬럼 삭제·로직 재계산 | `dbt run --full-refresh -s my_model` 로 재빌드 |
| 반복 방지 | CI에서 모델 diff 시 full-refresh 필요 여부를 리뷰 체크리스트로 |

`on_schema_change`는 어댑터·전략에 따라 지원 범위가 다르다. 타입 변경까지 자동으로 처리되길 기대하지 말고, 파괴적 변경은 명시적 full-refresh로 처리한다.

### 함정 4 — `merge` 비용 폭증

**증상.** 증분인데도 매 실행 비용이 full-refresh에 육박한다.

**원인.** `merge`는 타깃 테이블 전체를 대상으로 매칭할 수 있다. `unique_key`만 지정하고 파티션 프루닝 조건을 안 주면, BigQuery는 타깃 전체 파티션을 스캔하고 Snowflake는 큰 마이크로파티션 재작성을 한다.

**조치.** 머지의 매칭 범위를 파티션으로 좁힌다.

```sql
-- BigQuery: incremental_predicates로 머지 대상 파티션 한정
{{ config(
    materialized='incremental',
    incremental_strategy='merge',
    unique_key='event_id',
    partition_by={'field': 'event_date', 'data_type': 'date'},
    incremental_predicates=[
      "DBT_INTERNAL_DEST.event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 3 DAY)"
    ]
) }}
```

| 어댑터 | 폭증 지점 | 완화 |
|--------|-----------|------|
| BigQuery | 타깃 파티션 풀스캔(스캔 바이트 과금) | `incremental_predicates`로 파티션 프루닝, `partition_by` 필수 |
| Snowflake | 머지 시 마이크로파티션 재작성(웨어하우스 가동 시간) | 클러스터링 키 정렬, 룩백 최소화, `delete+insert`와 비교 |

BigQuery에서 소스가 이미 파티션·클러스터되어 있어도, **머지 조건에 파티션 컬럼이 없으면 프루닝이 안 된다.** 조건절이 아니라 `incremental_predicates`(또는 `merge_update_columns`)로 명시해야 한다.

## Materialization 오선택

정의는 다른 글에 있으니, 여기서는 **잘못 고르면 나는 비용 손해**만 본다.

### 함정 — 대형 로직을 view로 둬서 매 쿼리 재계산

**증상.** BI 대시보드가 느리다. 같은 무거운 조인이 조회할 때마다 다시 돈다.

**원인.** view는 저장하지 않고 쿼리 시점에 정의를 펼쳐 실행한다. 조회가 잦은 무거운 변환을 view로 두면 그 비용을 **읽는 쪽이 매번** 낸다.

### 함정 — 작고 거의 안 변하는 걸 table로 만들어 낭비

**증상.** 스토리지·빌드 시간이 자잘한 룩업 테이블들로 불어난다.

**원인.** 수백 행짜리 코드 매핑을 table로 물질화하면 매 `dbt run`마다 재작성한다.

**선택 기준.**

| 유형 | 권장 | 이유 |
|------|------|------|
| 얇은 스테이징(1:1 리네이밍·캐스팅) | `view` / `ephemeral` | 저장 불필요, 하류에서 프루닝됨 |
| 조회 잦은 무거운 변환·마트 | `table` | 읽기 비용을 빌드 시 1회로 고정 |
| 크고 append 성격의 팩트 | `incremental` | 전체 재계산 회피 |
| 작고 자주 참조되는 중간 로직 | `ephemeral` | 별도 오브젝트 없이 CTE로 인라인 |

`ephemeral`은 상류 CTE로 인라인되므로 오브젝트가 안 생겨 깔끔하지만, 여러 하류에서 참조하면 **매번 재컴파일·재계산**되고 컴파일된 SQL이 비대해져 디버깅이 어렵다. 3곳 이상에서 재사용되고 로직이 무거우면 `table`이 낫다.

## SELECT *, 불필요한 CTE, 과중첩

### 함정 — `SELECT *` 남발로 스캔·전파 비용 증가

**증상.** 상류 소스에 컬럼 하나 추가했더니 하류 모델 스캔 바이트가 늘고, 예상 못 한 컬럼이 마트까지 흘러간다.

**원인.** 컬럼 지향 웨어하우스(BigQuery/Snowflake)는 **읽은 컬럼만큼 과금**한다. `SELECT *`는 안 쓰는 컬럼까지 읽고, 스키마 변화를 전파한다.

**조치.** 스테이징에서 필요한 컬럼만 명시적으로 고른다. 넓은 소스는 `dbt_utils.star`로 제외 컬럼만 빼되, 남용하면 오히려 의도가 흐려지니 마트에 가까울수록 명시 컬럼을 쓴다.

### 함정 — 중첩 CTE가 컴파일·플랜을 무겁게

**증상.** 컴파일된 SQL이 수백 줄이고, 쿼리 플래너가 느려지거나 옵티마이저가 프루닝을 놓친다.

**원인.** dbt의 `ref()`/`ephemeral`은 CTE로 펼쳐진다. 모델을 너무 잘게 쪼개 `ephemeral`로 엮으면 최종 쿼리에 CTE가 겹겹이 쌓인다. 대부분의 엔진은 CTE를 인라인하지만, 깊은 중첩은 프루닝·조인 순서 추정을 어렵게 한다.

**조치.** CTE는 "이름으로 읽히는 단계" 용도로만 쓰고, 재사용·무거운 노드는 물질화해 플래너에 경계를 준다. 컴파일 결과(`target/compiled/...`)를 실제로 열어 스캔 바이트를 dry-run으로 확인하는 습관을 들인다.

```bash
# BigQuery: 컴파일 후 dry-run으로 예상 스캔 바이트 확인 (실제 과금 없음)
dbt compile -s my_model
bq query --dry_run --use_legacy_sql=false < target/compiled/proj/models/my_model.sql
```

## 비용: 어댑터별로 다르게 새어나간다

과금 모델이 다르므로 최적화 방향도 다르다.

| 축 | BigQuery (스캔 바이트) | Snowflake (웨어하우스 가동 시간) |
|----|----------------------|-------------------------------|
| 지배 비용 | 읽은 바이트 | 웨어하우스 켜져 있는 시간 × 크기 |
| 1순위 레버 | 파티셔닝·클러스터링으로 스캔 축소 | 웨어하우스 크기·자동 서스펜드·동시성 |
| dbt에서 | `config`의 `partition_by`/`cluster_by` | `snowflake_warehouse` 모델별 지정 |
| full-refresh 위험 | 전체 재스캔 = 큰 청구 | 큰 웨어하우스 장시간 가동 |

### BigQuery: 파티셔닝·클러스터링을 config로 강제

```sql
{{ config(
    materialized='incremental',
    partition_by={
      'field': 'event_date', 'data_type': 'date',
      'granularity': 'day'
    },
    cluster_by=['tenant_id', 'event_type'],
    require_partition_filter=true
) }}
```

`require_partition_filter=true`는 하류에서 파티션 필터 없는 풀스캔 쿼리를 **에러로 막는다.** 핫파티션(특정 날짜에 데이터 쏠림)이 있으면 클러스터링으로 완화하되, 파티션 자체가 과도하게 많아지면(예: 초 단위 파티셔닝) 메타데이터 오버헤드가 커지니 granularity를 데이터량에 맞춘다.

### Snowflake: 웨어하우스와 full-refresh 예약

- 무거운 마트만 큰 웨어하우스로, 나머지는 작은 것으로 분리한다. dbt는 모델별로 `snowflake_warehouse`를 줄 수 있다.
- 자동 서스펜드를 짧게 잡아 아이들 과금을 줄인다.
- **불필요한 full-refresh 예약이 가장 흔한 낭비다.** 스케줄러에 `--full-refresh`를 상시 켜두면 증분의 의미가 사라진다. full-refresh는 스키마 변경 시에만, 별도 잡으로 분리한다.

```yaml
# 위험: 매일 새벽 잡이 상시 full-refresh — 증분 무력화
# dbt run --full-refresh   ← 스케줄에서 이 플래그를 상시로 두지 말 것
```

## 테스트 운영: 정확성과 실행 시간의 균형

### 함정 — 과도한 테스트로 CI·프로덕션이 느려짐

**증상.** 모델보다 테스트가 오래 걸린다. 모든 컬럼에 `not_null`·`unique`를 걸어 놓았다.

**원인.** 테스트도 각각 하나의 쿼리다. 웨어하우스에서는 그대로 스캔·컴퓨트 비용이다. 큰 팩트 테이블에 `unique`(전체 정렬·집계)를 매번 돌리면 비싸다.

**조치.**

| 조치 | 효과 |
|------|------|
| 키 무결성은 소스/스테이징 한 곳에서만 검증 | 하류 중복 테스트 제거 |
| 큰 테이블 `unique` 대신 증분 구간만 검증하는 커스텀 테스트 | 스캔량 축소 |
| `--select` + `state:modified`로 변경분만 테스트 | CI 시간 단축 |

### 함정 — severity를 구분 안 해 파이프라인이 멈추거나 방치됨

**증상.** 사소한 이상치 하나로 전체 배포가 실패하거나, 반대로 중요한 위반이 조용히 묻힌다.

**원인.** 모든 테스트가 기본 `error`이거나, 반대로 다 `warn`이다.

**조치.** severity를 데이터 계약의 강도에 맞춘다.

```yaml
models:
  - name: fct_orders
    columns:
      - name: order_id
        tests:
          - not_null:
              config: { severity: error }        # 계약 위반 = 중단
          - unique:
              config: { severity: error }
      - name: discount_rate
        tests:
          - dbt_utils.accepted_range:
              min_value: 0
              max_value: 1
              config:
                severity: warn                    # 이상치 = 경고
                warn_if: ">10"                    # 10건 초과부터 경고
                error_if: ">100"                  # 100건 초과면 중단
```

### `store_failures`로 디버깅 시간 회수

실패 행을 테이블로 남겨 원인 추적을 빠르게 한다. 단, 실패 테이블도 스토리지를 쓰므로 만료·스키마를 관리한다.

```yaml
tests:
  my_project:
    +store_failures: true
    +schema: dbt_test_failures   # 실패 저장 전용 스키마로 격리
```

## Jinja·매크로 함정

### 함정 — 과한 메타프로그래밍으로 가독성 붕괴

**증상.** 매크로가 매크로를 호출하고, 최종 SQL이 어떻게 생성되는지 아무도 모른다. 리뷰가 불가능하다.

**원인.** DRY를 과신해 SQL을 Jinja로 추상화했다. dbt는 코드 생성기이므로 추상화가 늘수록 **디버깅 대상이 SQL이 아니라 컴파일 로직**이 된다.

**조치.** "3번 반복되면 매크로"를 기준으로 삼되, 생성된 SQL은 항상 `dbt compile`로 확인 가능해야 한다. 로직 분기가 많은 곳은 매크로보다 명시적 SQL이 유지보수에 낫다.

### 함정 — 컴파일 시점 vs 실행 시점 혼동

**증상.** `run_query`로 가져온 값이 기대와 다르거나, `dbt compile`에서는 되는데 첫 실행에서 깨진다.

**원인.** Jinja는 **컴파일 시점**에 평가된다. `run_query`나 `adapter.get_relation`은 그 시점의 웨어하우스 상태를 읽으므로, 아직 존재하지 않는 테이블을 참조하면 실패한다.

```sql
-- 위험: 파싱 시점에 테이블이 없으면 컴파일 자체가 실패
{% set cols = run_query("SELECT * FROM " ~ ref('upstream') ~ " LIMIT 0") %}

-- 안전: execute 플래그로 파싱 단계에서는 건너뜀
{% if execute %}
  {% set results = run_query(my_intro_query) %}
{% endif %}
```

`{% if execute %}` 가드는 dbt가 그래프를 파싱하는 단계(테이블 미존재 가능)와 실제 실행 단계를 구분하는 표준 패턴이다.

## DAG·모델 설계 함정

dbt는 순환 의존을 컴파일 단계에서 막는다. 문제는 순환이 아니라 **구조의 밀도**다.

### 함정 — fan-out 폭주

**증상.** 스테이징 모델 하나를 바꾸면 수십 개가 재빌드된다.

**원인.** 공통 스테이징에 너무 많은 마트가 직접 매달려 있다. 중간 계층이 없어 변경 영향이 그대로 퍼진다.

**조치.** staging → intermediate → marts 계층을 두어 변경 파급을 흡수한다. `dbt ls --select stg_x+`로 하류 팬아웃을 주기적으로 점검한다.

### 함정 — 너무 잘게 쪼갬 vs 너무 뭉침

| 증상 | 원인 | 조치 |
|------|------|------|
| 모델 수백 개, 대부분 1:1 패스스루 | 과분할 | 얇은 리네이밍은 스테이징에 합치기, `ephemeral` 활용 |
| 한 모델이 수백 줄, 여러 도메인 혼재 | 과결합 | 도메인·grain 경계로 분리, 재사용 로직만 intermediate로 |

기준은 줄 수가 아니라 **재사용성과 grain**이다. 서로 다른 여러 마트가 참조하면 분리하고, 한 마트에서만 쓰면 인라인한다.

## CI 함정: state와 defer

Slim CI(변경분만 빌드)는 dbt 비용 절감의 핵심이지만 설정이 틀리면 조용히 오작동한다.

### 함정 — state 비교 대상이 잘못됨

**증상.** `state:modified`가 아무것도 안 잡거나, 매번 전부 빌드한다.

**원인.** 비교 기준이 되는 `manifest.json`(프로덕션 산출물)이 최신이 아니거나 경로가 틀렸다. state는 "지금 코드"와 "저장된 manifest"의 diff이므로, manifest가 낡으면 diff가 왜곡된다.

```bash
# 프로덕션 manifest를 아티팩트로 받아 그 대비 변경분만 빌드
dbt build --select "state:modified+" --state ./prod-artifacts
```

### 함정 — prod defer 미설정으로 CI가 전체 상류를 빌드

**증상.** PR 하나 테스트하는데 CI가 상류 모델까지 다 만든다. 느리고 비싸다.

**원인.** `--defer` 없이 변경 모델을 빌드하면 참조하는 상류가 CI 스키마에 없어 전부 다시 만든다.

**조치.** `--defer`로 미변경 상류는 **프로덕션 오브젝트를 참조**하고, 변경분만 CI에서 빌드한다.

```bash
dbt build \
  --select "state:modified+" \
  --defer --state ./prod-artifacts \
  --favor-state
```

| 설정 누락 | 결과 | 교정 |
|-----------|------|------|
| `--state` 경로 오류 | diff 무의미, 전체 빌드 | 프로덕션 manifest 아티팩트 파이프라인 고정 |
| `--defer` 없음 | 상류 전체 재빌드 | `--defer`로 prod 오브젝트 참조 |
| CI 스키마 미격리 | 동시 PR끼리 충돌 | PR별 임시 스키마(`generate_schema_name` 커스터마이즈) |

## 요약: 함정별 1순위 조치

| 영역 | 대표 함정 | 1순위 조치 |
|------|-----------|-----------|
| 증분 | 늦게 온 데이터 유실 | 적재 시각 워터마크 + 룩백, `unique_key` 필수 |
| 증분 | 머지 비용 폭증 | 파티션 프루닝(`incremental_predicates`) |
| Materialization | 무거운 view 재계산 | 조회 잦으면 `table`, 얇으면 `view`/`ephemeral` |
| 스캔 | `SELECT *` 전파 | 스테이징에서 컬럼 명시, dry-run 확인 |
| 비용 | 상시 full-refresh | 스키마 변경 시에만, 잡 분리 |
| 테스트 | 과다·무구분 severity | 키 검증 1곳, `warn`/`error` 분리, `store_failures` |
| Jinja | 컴파일/실행 시점 혼동 | `{% if execute %}` 가드 |
| DAG | fan-out | 계층 분리, `dbt ls`로 팬아웃 점검 |
| CI | state·defer 오설정 | prod manifest 고정 + `--defer` |

핵심 원칙 하나로 요약하면, **dbt는 비용을 옮기는 도구다.** view는 읽는 쪽으로, table은 빌드 쪽으로, 증분은 머지 쪽으로 비용을 옮긴다. 함정 대부분은 "어디로 비용을 옮겼는지" 모른 채 기본값을 쓴 결과다. 각 모델에서 비용이 언제 발생하고 누가 내는지를 `config`로 명시하는 것이 회피의 출발점이다. 구체적 증분 전략과 컨트랙트 설계는 `[[/dbt/02_dbt_advanced]]`, 프로젝트 구조와 오케스트레이션은 `[[/dbt/03_dbt_in_practice]]`에서 이어간다.
{% endraw %}
