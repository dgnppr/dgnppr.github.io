---
name: data-eng-sme
description: "데이터 엔지니어링·클라우드 글의 기술 깊이를 만든다. GCP(BigQuery/Dataflow/Pub-Sub/Composer)와 OSS 데이터 스택(Spark/Airflow/Kafka/Flink/dbt/Iceberg)의 아키텍처·실행 가능한 코드·트레이드오프·실제 스키마를 02_sme_notes.md에 작성한다. AWS/Snowflake/Databricks는 비교용. 기술노트·코드예제·아키텍처·스키마 작업, 그리고 '기술 보강'·'코드 추가'·'아키텍처 다시'·'성능/비용 분석'·'트레이드오프' 후속 요청에도 반드시 사용."
---

# Data Engineering SME Skill

글의 기술적 신뢰도를 책임진다. 추상적 설명이 아니라 **돌아가는 코드 + 정직한 트레이드오프**. 출력은 `_workspace/02_sme_notes.md`.

## 작업 순서

### 1. 입력 파악
`_workspace/00_brief.md`(필수)와 `_workspace/01_research.md`(있으면)를 읽는다. 핵심 질문·아웃라인·SME 요청과, 검증된 사실/UNVERIFIED 목록을 확인한다.

### 2. 스택 선택 + 참조 로드
주제에 맞는 참조를 **조건부로** 읽는다(컨텍스트 절약):
- GCP 주제(BigQuery/Dataflow/Pub-Sub/Composer) → `references/gcp.md`
- OSS 스택(Spark/Airflow/Kafka/Flink/dbt/Iceberg) → `references/oss-data-stack.md`
- AWS/Snowflake/Databricks는 비교·대안 제시용으로만.

### 3. 아키텍처 설계
데이터 흐름을 `mermaid`/ascii로 그리고 각 컴포넌트 책임을 적는다. 수집→저장→처리→서빙 경계를 분명히.

### 4. 코드 예제 작성
복붙해서 돌아가는 수준으로. 언어 관용구를 지킨다:
- Python: PEP8, 4 spaces, type hint, 단일 책임 함수.
- SQL(BigQuery): 키워드 대문자, CTE 우선, 서브쿼리 지양. **무거운 쿼리 전 `LIMIT 10` 검증 쿼리를 먼저** 보인다.
- Airflow: 멱등성 1원칙(언제 재실행돼도 같은 결과), 오케스트레이션은 얇게.
- 코드블록엔 언어 식별자 필수(```python, ```sql, ```hcl).
- 풀스캔·셔플·스몰파일·핫파티션 등 함정을 코드 옆 주석으로 경고.

### 5. 트레이드오프 + 스키마
- 모든 선택에 "왜 A이고 B가 아닌가"를 표로. GCP가 주력이어도 AWS/Snowflake가 나은 경우는 그렇다고 적는다(공정한 비교).
- 실제 DDL/DAG/config를 보인다(가짜 예제 금지).

### 6. 온톨로지 접점 (해당 시)
데이터 모델을 그래프 관점(엔티티·관계·행위)과 잇는다. 이 블로그의 정체성. editor의 relations 설계에 직접 쓰인다.

### 7. `_workspace/02_sme_notes.md` 작성
에이전트 정의의 출력 골격(아키텍처/코드/트레이드오프/스키마/온톨로지 접점/writer 메모)을 채운다.

## 사실 정확성 규칙
- `01_research.md`의 검증된 수치·버전을 쓴다. UNVERIFIED는 "대략"·"버전에 따라"로 헤지하거나 일반 원리로 우회. **없는 숫자를 지어내지 않는다.**
- 못 돌려본 코드는 "미실행 — 개념 예시"로 표시. 의심되면 `Bash`로 문법을 가능한 만큼 확인.

## 산출물 기준
- 아키텍처 다이어그램 + 컴포넌트 책임
- 돌아가는 코드(언어 식별자 + 함정 경고)
- 트레이드오프 표(공정한 비교)
- 현실적 스키마/설정
- 성능·비용 함정이 미리 표시됨

## 후속/부분 재실행
`02_sme_notes.md`가 있으면 요청된 섹션만 갱신한다. 검증된 코드는 임의로 다시 쓰지 않는다.
