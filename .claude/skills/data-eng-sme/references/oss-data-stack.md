# 오픈소스 데이터 스택 작성 가이드

Spark/Airflow/Kafka/Flink/dbt/Iceberg 주제 포스트 작성 시 참조한다.

## Apache Spark

- 셔플이 성능의 핵심 — `repartition`/`coalesce`, broadcast join, AQE(Adaptive Query Execution) 설명
- 데이터 스큐: salting, `spark.sql.adaptive.skewJoin.enabled`
- 파티션 수 = 병렬도. 작은 파일 문제는 쓰기 시 `coalesce`로 완화

```python
df = (spark.read.parquet("gs://bucket/events")
        .repartition("event_date")            # 셔플 파티션 키 정렬
        .join(broadcast(dim_users), "user_id")) # 작은 차원은 broadcast
```

## Apache Airflow

- 멱등성·재실행 가능성이 DAG 설계의 1원칙 — 태스크는 언제 재실행돼도 같은 결과
- `execution_date`/data interval 기반 백필 설계, 동적 태스크 매핑(`expand`)
- 오케스트레이션은 얇게 — 실제 연산은 Spark/BigQuery로 위임

## Apache Kafka

- 파티션 = 병렬·순서 단위. 키별 순서만 보장됨을 명확히
- consumer group 리밸런싱, lag 모니터링, exactly-once(트랜잭션/idempotent producer)
- 리텐션·압축(compaction) 토픽 구분

## Apache Flink

- 진짜 스트리밍(이벤트 단위) — 이벤트 타임 vs. 처리 타임, 워터마크, 상태 백엔드(RocksDB)
- 체크포인트/세이브포인트로 정확히-한-번 보장
- Flink vs. Spark Structured Streaming: 저지연·세밀한 상태 제어가 필요하면 Flink

## dbt

- ELT의 T — 웨어하우스 안에서 SQL로 변환, 모델 의존성 DAG
- materialization 전략: view / table / incremental / ephemeral
- 테스트(not_null, unique, relationships)와 문서화를 코드와 함께 다룰 것

```sql
-- models/marts/fct_orders.sql
{{ config(materialized='incremental', unique_key='order_id') }}
SELECT * FROM {{ ref('stg_orders') }}
{% if is_incremental() %}
WHERE updated_at > (SELECT max(updated_at) FROM {{ this }})
{% endif %}
```

## Apache Iceberg (레이크하우스)

- 테이블 포맷 — 스냅샷 격리, 타임트래블, 스키마/파티션 진화(hidden partitioning)
- ACID on object storage, 엔진 중립(Spark/Flink/Trino에서 동일 테이블)
- Hudi/Delta와 비교: 쓰기 패턴(CoW vs. MoR)과 엔진 호환성으로 선택

## 공통 트레이드오프 프레임

코드/아키텍처 설명 시 항상 다음 축으로 비교한다:
- **지연(latency)** vs. **처리량(throughput)**
- **비용** (컴퓨트·스토리지·운영 인건비)
- **운영 부담** (관리형 vs. self-managed)
- **일관성 보장** (at-least-once / exactly-once)
