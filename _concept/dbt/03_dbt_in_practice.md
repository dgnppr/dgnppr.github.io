---
layout      : concept
title       : dbt 실전 프로젝트 구조와 배포 파이프라인
date        : 2026-07-01 00:00:00 +0900
updated     : 2026-07-01 00:00:00 +0900
tag         : dbt project-structure ci-cd orchestration data-engineering
toc         : true
comment     : true
latex       : true
status      : draft
public      : true
parent      : [[/dbt]]
confidence  : high
relations:
  - { type: extends, target: concept/dbt/02_dbt_advanced }
  - { type: references, target: concept/dbt/01_dbt_core_features }
---

{% raw %}
* TOC
{:toc}

## 문제: dbt는 쉽게 시작하지만, 쉽게 무너진다

`dbt run` 한 줄로 첫 모델을 만드는 건 10분이면 된다. 문제는 그다음이다. 모델이 30개를 넘고, 팀원이 두세 명 붙고, 프로덕션 데이터에 손을 대기 시작하는 순간 세 가지가 동시에 터진다.

- **구조 붕괴** — `models/` 아래에 `orders.sql`, `orders_v2.sql`, `orders_final.sql`이 평평하게 쌓인다. 어떤 게 소스에 가깝고 어떤 게 최종인지 파일 이름만으로 알 수 없다.
- **환경 오염** — 로컬에서 돌린 `dbt run`이 프로덕션 스키마를 덮어쓴다. dev/prod 경계가 없기 때문이다.
- **검증 부재** — PR을 머지하기 전에 모델이 빌드되는지, 테스트가 통과하는지 자동으로 확인할 방법이 없다. 배포는 "누군가 로컬에서 돌려봤다"에 의존한다.

이 글은 dbt Core 1.x를 실무에 얹을 때의 다섯 축 — **프로젝트 구조 / 환경 분리 / CI/CD / 오케스트레이션 / 문서화** — 을 실제 트리와 설정으로 다룬다. state/defer의 내부 메커니즘과 컨트랙트는 [[/dbt/02_dbt_advanced]]에서, 테스트·소스 정의 기본기는 [[/dbt/01_dbt_core_features]]에서, 운영 함정과 비용 튜닝은 [[/dbt/04_dbt_operational_knowhow]]에서 다룬다. 여기서는 "어떻게 배치하고 배포하는가"에 집중한다.

## 레이어드 프로젝트 구조: staging / intermediate / marts

dbt Labs가 권장하는 3계층 컨벤션은 각 모델이 **파이프라인의 어느 위치에 있는지를 폴더와 파일 이름으로 강제**하는 방식이다. 정답이라서가 아니라, 규칙이 명시적이면 새 팀원이 파일 이름만 보고 흐름을 읽을 수 있기 때문이다.

| 계층 | 접두사 | 책임 | 물화(materialization) 기본 |
|------|--------|------|------|
| `staging` | `stg_` | 소스 1:1 매핑. 컬럼 rename/타입 캐스팅/가벼운 정제만. 조인·집계 금지 | `view` |
| `intermediate` | `int_` | staging을 조합하는 중간 단계. 재사용되는 조인/전처리 로직 | `view` 또는 `ephemeral` |
| `marts` | `fct_` / `dim_` | 비즈니스가 소비하는 최종 엔티티. 팩트·디멘션 | `table` 또는 `incremental` |

핵심 규칙: **staging은 소스당 하나, marts는 비즈니스 개념당 하나.** intermediate는 "이 로직이 두 곳 이상에서 반복될 때"만 만든다. 없어도 되면 안 만드는 게 낫다.

디렉토리 트리는 이렇게 잡는다.

```text
models/
├── staging/
│   ├── stripe/
│   │   ├── _stripe__sources.yml      # source() 정의
│   │   ├── _stripe__models.yml       # stg 모델 description/test
│   │   ├── stg_stripe__payments.sql
│   │   └── stg_stripe__customers.sql
│   └── salesforce/
│       ├── _salesforce__sources.yml
│       ├── _salesforce__models.yml
│       └── stg_salesforce__accounts.sql
├── intermediate/
│   └── finance/
│       ├── _int_finance__models.yml
│       └── int_payments_pivoted_to_orders.sql
└── marts/
    ├── finance/
    │   ├── _finance__models.yml
    │   ├── fct_orders.sql
    │   └── dim_customers.sql
    └── marketing/
        ├── _marketing__models.yml
        └── fct_attribution.sql
```

`.yml` 배치 컨벤션 세 가지가 실무 가독성을 좌우한다.

- **소스 정의(`_..__sources.yml`)와 모델 정의(`_..__models.yml`)를 분리**한다. 소스는 외부 테이블, 모델은 dbt가 만드는 산출물이라 성격이 다르다.
- **`.yml`을 모델 파일 옆, 폴더 단위로 쪼갠다.** 프로젝트 루트에 `schema.yml` 하나로 몰면 수백 줄짜리 병목이 된다.
- 언더스코어 접두사(`_`)를 붙이면 파일 목록에서 설정 파일이 위로 모여 눈에 잘 띈다.

### `dbt_project.yml`의 폴더별 config

계층 컨벤션은 파일 이름만으로는 강제되지 않는다. `dbt_project.yml`에서 폴더별로 물화·스키마·태그를 선언해 **디렉토리 = 규칙**을 코드화한다.

```yaml
# dbt_project.yml
name: analytics
version: "1.0.0"
config-version: 2
profile: analytics

models:
  analytics:
    staging:
      +materialized: view
      +schema: staging          # 최종 스키마 접미사 (아래 generate_schema_name 참고)
      +tags: ["staging"]
    intermediate:
      +materialized: ephemeral
      +tags: ["intermediate"]
    marts:
      +materialized: table
      +schema: marts
      finance:
        +tags: ["finance", "daily"]
      marketing:
        +tags: ["marketing"]
```

`+` 접두사는 dbt config 키를 의미하고, 하위 폴더 설정이 상위를 오버라이드한다. 개별 모델에서 `{{ config(materialized='incremental') }}`로 다시 덮을 수 있어, "폴더 기본값 + 모델 예외"의 2단 구조가 된다.

## 환경 분리: dev / prod를 물리적으로 가른다

dbt에서 환경 분리의 최소 단위는 **target**이다. `profiles.yml`에 target별로 접속 정보와 목적지 스키마/데이터셋을 정의하고, `dbt run --target prod`처럼 실행 시점에 선택한다.

```yaml
# ~/.dbt/profiles.yml  (또는 프로젝트 루트, DBT_PROFILES_DIR로 지정)
analytics:
  target: dev                    # 기본 target — 실수로 prod를 치는 걸 방지
  outputs:
    dev:
      type: bigquery
      method: oauth
      project: my-gcp-dev
      dataset: dbt_dragonappear  # 개발자별 개인 스키마
      threads: 4
    prod:
      type: bigquery
      method: service-account
      keyfile: "{{ env_var('DBT_GCP_KEYFILE') }}"
      project: my-gcp-prod
      dataset: analytics         # 공용 프로덕션 스키마
      threads: 8
```

핵심 원칙 세 가지.

1. **`target: dev`를 기본값으로.** prod를 명시적으로 지정해야만 프로덕션에 쓰이도록 한다. 기본값이 prod이면 사고는 시간 문제다.
2. **개발자마다 개인 dataset.** dev의 `dataset`을 `dbt_<이름>`으로 두면 팀원끼리 서로의 빌드를 덮어쓰지 않는다.
3. **자격증명은 파일에 박지 않는다.** `env_var()`로 주입한다. `profiles.yml`은 절대 커밋하지 않거나, 커밋하되 비밀값은 전부 환경변수로 뺀다.

| 분리 축 | dev | prod | 비고 |
|---------|-----|------|------|
| project/database | 별도 dev 프로젝트 권장 | prod 프로젝트 | 완전 격리하려면 project 자체를 분리 |
| dataset/schema | `dbt_<user>` | `analytics` | 최소한 스키마는 반드시 분리 |
| 인증 | 개인 oauth | 서비스 계정 | prod는 사람 계정 의존 금지 |
| threads | 낮게(4) | 높게(8+) | prod는 처리량, dev는 비용/체감속도 |

### `generate_schema_name` 커스터마이징

dbt의 기본 `generate_schema_name` 동작은 직관적이지 않다. **커스텀 스키마를 지정하면 `<target_schema>_<custom_schema>` 형태로 이어붙인다.** 즉 위 예시에서 prod의 `dataset: analytics` + 모델 `+schema: marts` 조합은 실제로는 `analytics_marts`가 된다.

이 접두사 결합이 싫다면 매크로를 오버라이드한다. 아래는 "prod에서만 접미사를 쓰고, dev에서는 전부 개인 dataset에 몰아넣는" 흔한 패턴이다.

```sql
-- macros/generate_schema_name.sql
{% macro generate_schema_name(custom_schema_name, node) -%}
    {%- set default_schema = target.schema -%}
    {%- if target.name == 'prod' and custom_schema_name is not none -%}
        {{ custom_schema_name | trim }}
    {%- else -%}
        {{ default_schema }}
    {%- endif -%}
{%- endmacro %}
```

이렇게 하면 prod는 `staging`/`marts`로 깔끔히 나뉘고, dev는 모든 모델이 `dbt_dragonappear` 한 곳에 모여 개발이 편해진다. 어느 쪽이 맞는지는 조직 규칙에 달렸다 — 중요한 건 **동작을 정확히 이해하고 명시적으로 정하는 것**이다. 기본 동작을 모른 채 두면 프로덕션에 예상치 못한 스키마 이름이 생긴다.

## CI/CD: PR마다 자동으로 빌드하고 테스트한다

dbt는 SQL이지만 결국 코드다. 코드 리뷰 워크플로우에 얹으려면 **PR이 열릴 때마다 변경된 모델이 실제로 빌드되고 테스트를 통과하는지**를 자동으로 검증해야 한다. 이것이 dbt CI의 최소 목표다.

가장 단순한 형태는 PR마다 전체를 빌드하는 것이다.

```yaml
# .github/workflows/dbt_ci.yml
name: dbt CI
on:
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    env:
      DBT_PROFILES_DIR: ./
      DBT_GCP_KEYFILE: ${{ secrets.DBT_GCP_KEYFILE_CI }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - name: Install dbt
        run: pip install dbt-bigquery==1.7.*
      - name: dbt deps
        run: dbt deps
      - name: dbt build (CI target)
        run: dbt build --target ci --fail-fast
```

`dbt build`는 **모델·테스트·시드·스냅샷을 DAG 순서대로 한 번에** 실행한다. `run` 다음 `test`를 따로 부르는 것보다 낫다 — 모델이 빌드된 직후 그 모델의 테스트가 즉시 돌아, 하류 모델이 오염된 데이터 위에서 빌드되는 걸 막는다.

CI target은 PR별로 격리된 스키마에 쓰도록 잡는다. `+schema`를 PR 번호나 브랜치로 동적 생성하면 병렬 PR이 서로를 덮지 않는다.

### 전체 빌드의 한계와 Slim CI

전체 빌드 CI는 모델이 수백 개가 되면 느리고 비싸다. 컬럼 하나 고친 PR에 전 파이프라인을 돌리는 건 낭비다. 해법은 **변경분과 그 하류만 빌드**하는 Slim CI다.

```yaml
      - name: Slim CI build
        run: |
          dbt build \
            --select state:modified+ \
            --defer \
            --state ./prod-artifacts \
            --target ci
```

`state:modified+`는 "바뀐 모델과 그 하류 전부", `--defer --state`는 "안 바뀐 상위 모델은 프로덕션 산출물을 참조"하도록 한다. `state:modified`·`defer`의 동작 원리와 manifest 비교 메커니즘은 [[/dbt/02_dbt_advanced]]에서 상세히 다뤘다. 여기서 짚을 파이프라인 관점의 실무 포인트는 하나다 — **Slim CI는 프로덕션의 `manifest.json`(기준 상태)을 CI 러너가 가져올 수 있어야 성립한다.** 보통 prod 배포 잡이 아티팩트를 GCS에 업로드하고, CI 잡이 그걸 내려받아 `--state` 경로에 둔다.

| 방식 | 빌드 범위 | 속도/비용 | 전제 |
|------|-----------|-----------|------|
| 전체 빌드 | 모든 모델 | 느림·비쌈 | 없음. 가장 단순 |
| Slim CI | 변경분 + 하류 | 빠름·저렴 | prod manifest 아티팩트 필요 |

작은 프로젝트는 전체 빌드로 시작하고, 느려지기 시작하면 Slim CI로 옮기는 게 합리적이다. 처음부터 Slim CI를 깔면 아티팩트 관리 복잡도만 떠안는다.

## 오케스트레이션: 무엇을, 언제, 얼마나 돌릴지

CI가 "머지해도 되는가"를 본다면, 오케스트레이션은 "프로덕션에서 정기적으로 어떻게 돌릴 것인가"다. 두 가지 축이 있다 — **한 방에 다 돌릴지, 부분만 돌릴지**, 그리고 **무엇이 스케줄을 쥐는지**.

가장 단순한 프로덕션 실행은 하루 한 번 전체 빌드다.

```bash
dbt build --target prod
```

하지만 모든 모델의 신선도 요구가 같지는 않다. 마케팅 어트리뷰션은 시간당, 재무 마트는 일 단위여도 충분할 수 있다. 이때 **태그와 그래프 셀렉터**로 부분 실행한다.

```bash
# 특정 도메인만
dbt build --select tag:finance

# 특정 모델과 그 하류 전부 (+가 오른쪽)
dbt build --select fct_orders+

# 특정 모델의 상류 전부 (+가 왼쪽)
dbt build --select +fct_orders

# 상·하류 전부
dbt build --select +fct_orders+

# 특정 모델과 연결된 모든 노드 (@ = 하류 + 그 하류의 모든 상류)
dbt build --select @fct_orders
```

셀렉터 문법 요약.

| 표기 | 의미 |
|------|------|
| `model` | 그 모델만 |
| `model+` | 모델 + 하류 전부 |
| `+model` | 모델 + 상류 전부 |
| `+model+` | 상·하류 전부 |
| `@model` | 모델의 하류 + 그 하류들이 의존하는 모든 상류 |
| `tag:daily` | 태그가 붙은 모든 노드 |
| `path:models/marts` | 경로 하위 전부 |

### Airflow / Composer에 얹기

스케줄과 재시도·알림을 dbt cron에 맡길 수도 있지만, 이미 Airflow(GCP라면 Cloud Composer)를 쓴다면 오케스트레이션은 그쪽에 위임하는 게 낫다. 원칙은 **오케스트레이션은 얇게, 연산은 dbt(=웨어하우스)에 위임**이다.

```python
# dags/dbt_marts.py — 개념 예시(미실행)
from airflow import DAG
from airflow.operators.bash import BashOperator
import pendulum

DBT = "cd /opt/dbt/analytics && dbt"

with DAG(
    dag_id="dbt_daily_marts",
    schedule="0 6 * * *",              # 매일 06:00
    start_date=pendulum.datetime(2026, 1, 1, tz="Asia/Seoul"),
    catchup=False,
    default_args={"retries": 1},
) as dag:
    deps = BashOperator(task_id="dbt_deps", bash_command=f"{DBT} deps --target prod")
    build_staging = BashOperator(
        task_id="build_staging",
        bash_command=f"{DBT} build --select tag:staging --target prod",
    )
    build_finance = BashOperator(
        task_id="build_finance",
        bash_command=f"{DBT} build --select tag:finance --target prod",
    )
    deps >> build_staging >> build_finance
```

여기서 두 갈래의 트레이드오프가 있다.

| 방식 | 장점 | 비용 | 언제 |
|------|------|------|------|
| dbt 태스크 1개 (`dbt build`) | Airflow DAG이 단순. DAG 순서는 dbt가 관리 | 실패 시 어느 모델에서 죽었는지 재실행 입도가 거칠다 | 모델 수가 적고 전체가 한 신선도 |
| 태그/셀렉터로 태스크 분할 | 실패 지점만 재실행. 도메인별 스케줄 | Airflow DAG과 dbt DAG의 이중 관리. 경계를 수동으로 맞춰야 함 | 도메인별 신선도가 다르고 재시도 입도가 중요할 때 |

Airflow 관점의 대원칙은 **멱등성**이다. 태스크는 언제 재실행돼도 같은 결과를 내야 한다. `dbt build`는 `table` 물화라면 멱등적이지만, `incremental` 모델은 재실행 시 중복 적재 위험이 있으므로 `unique_key`와 병합 전략을 반드시 검증한다(증분 모델의 함정은 [[/dbt/04_dbt_operational_knowhow]]).

> dbt DAG을 태스크 단위로 자동 펼치고 싶다면 `astronomer-cosmos` 같은 도구가 dbt manifest를 파싱해 모델별 Airflow 태스크를 생성해준다. 단, DAG 파싱 비용과 의존성이 늘어난다 — 태그 분할로 충분한지 먼저 따진다.

## 문서화: 코드 옆에 붙는 살아있는 카탈로그

dbt 문서의 강점은 **문서가 코드와 같은 저장소·같은 PR에 산다**는 점이다. 별도 위키가 코드와 어긋나는 문제를 구조적으로 줄인다.

```bash
dbt docs generate    # manifest + catalog 생성 → target/ 에 산출
dbt docs serve       # 로컬 웹서버로 DAG 그래프 + 문서 렌더링
```

`dbt docs generate`는 웨어하우스에서 각 릴레이션의 컬럼·타입을 조회해 `catalog.json`을 만들고, 모델 description과 결합한다. 결과물은 컬럼 레벨 lineage 그래프를 포함한 정적 사이트다. 이걸 CI에서 생성해 GCS 정적 호스팅이나 사내 페이지로 배포하면 팀 공용 카탈로그가 된다.

description은 `.yml`에 적는다.

```yaml
# models/marts/finance/_finance__models.yml
version: 2
models:
  - name: fct_orders
    description: >
      주문 1건 = 1행인 팩트 테이블. 결제 완료 기준이며 취소 주문은 제외.
      grain: order_id.
    columns:
      - name: order_id
        description: 주문 고유 식별자 (grain).
        tests: [unique, not_null]
      - name: customer_id
        description: dim_customers 참조 외래키.
        tests:
          - relationships:
              to: ref('dim_customers')
              field: customer_id
```

### `persist_docs`로 웨어하우스까지 문서를 밀어넣기

`dbt docs`의 description은 기본적으로 dbt 문서 사이트에만 존재한다. **웨어하우스 콘솔에서도(BigQuery 테이블/컬럼 설명) 보이게 하려면 `persist_docs`를 켠다.** BigQuery를 직접 여는 분석가에게 특히 유용하다.

```yaml
# dbt_project.yml
models:
  analytics:
    +persist_docs:
      relation: true
      columns: true
```

이러면 `dbt run` 시 테이블·컬럼 description이 BigQuery 메타데이터로 반영된다. dbt를 안 쓰는 소비자도 카탈로그의 혜택을 받는다.

### exposures: 하류 소비를 그래프에 편입

dbt의 lineage는 기본적으로 소스→모델까지만 안다. **모델이 어떤 대시보드·ML 파이프라인·역-ETL로 흘러가는지**는 `exposures`로 명시한다.

```yaml
# models/marts/finance/_finance__exposures.yml
version: 2
exposures:
  - name: finance_weekly_dashboard
    type: dashboard
    maturity: high
    url: https://looker.company.com/dashboards/42
    depends_on:
      - ref('fct_orders')
      - ref('dim_customers')
    owner:
      name: Finance Analytics
      email: finance@company.com
```

exposure를 정의하면 `dbt build --select +exposure:finance_weekly_dashboard`로 "이 대시보드가 의존하는 모든 것"을 한 번에 빌드할 수 있고, lineage 그래프에 소비 지점이 노드로 나타난다. **데이터 계약의 종착점을 문서화하는 장치**다.

## 관측: 실행 아티팩트를 데이터로 다룬다

dbt는 매 실행마다 `target/` 아래에 JSON 아티팩트를 남긴다. 이 파일들은 로그가 아니라 **구조화된 데이터**여서, 파이프라인의 상태를 프로그램으로 다룰 수 있게 해준다.

| 아티팩트 | 내용 | 활용 |
|----------|------|------|
| `manifest.json` | 프로젝트 전체 그래프(노드·의존성·설정) | Slim CI의 state 비교, lineage 분석, 문서 |
| `run_results.json` | 이번 실행의 노드별 상태·소요시간·행 수 | 실행 모니터링, 느린 모델 탐지, 실패 알림 |
| `catalog.json` | 웨어하우스에서 조회한 컬럼·타입 | `dbt docs`의 카탈로그 |

`run_results.json`을 파싱하면 실행 관측의 최소 형태가 나온다.

```python
# scripts/parse_run_results.py — 개념 예시(미실행)
import json

with open("target/run_results.json") as f:
    results = json.load(f)

for r in results["results"]:
    if r["status"] not in ("success", "pass"):
        print(f"FAILED  {r['unique_id']}  {r['status']}")
    elif r["execution_time"] > 60:            # 60초 초과 모델
        print(f"SLOW    {r['unique_id']}  {r['execution_time']:.1f}s")
```

이 패턴을 확장하면 실행 결과를 웨어하우스 테이블에 적재해 "매일 빌드 시간 추이", "가장 느린 모델 Top 10", "테스트 실패율" 같은 메타 대시보드를 만들 수 있다. `dbt_artifacts` 같은 패키지가 이 적재를 표준화해준다. 다만 어떤 메트릭을 추적하고 어떻게 비용으로 이어지는지 — 관측을 운영으로 전환하는 단계는 [[/dbt/04_dbt_operational_knowhow]]의 영역이다. 여기서는 "아티팩트가 데이터라는 사실"까지만 잡아둔다.

## 정리: 얹는 순서

한 번에 다 갖출 필요는 없다. 실무 도입은 대체로 이 순서가 자연스럽다.

1. **구조 먼저.** staging/intermediate/marts와 `.yml` 배치 컨벤션을 정하고 `dbt_project.yml`에 폴더별 config를 박는다. 나중에 바꾸면 리네이밍 비용이 크다.
2. **환경 분리.** `target: dev` 기본값, 개인 dataset, prod 서비스 계정. `generate_schema_name` 동작을 확인하고 명시적으로 정한다.
3. **CI.** PR마다 `dbt build`. 느려지면 Slim CI로.
4. **오케스트레이션.** `dbt build` 한 방으로 시작, 신선도가 갈리면 태그·셀렉터로 분할.
5. **문서화·관측.** description·`persist_docs`·exposures로 카탈로그를 만들고, 아티팩트를 데이터로 다룬다.

각 단계의 심화 — state/defer 내부와 컨트랙트는 [[/dbt/02_dbt_advanced]], 테스트·소스 기본기는 [[/dbt/01_dbt_core_features]], 운영 함정과 비용은 [[/dbt/04_dbt_operational_knowhow]]로 이어진다.
{% endraw %}
