# GCP 데이터 스택 작성 가이드

GCP 주제 포스트를 작성할 때 참조한다. 핵심 서비스별 실무 패턴·코드·함정.

## BigQuery

**모델링·성능**
- 파티셔닝(날짜/정수 범위) + 클러스터링을 함께 설계 — 파티션이 스캔량을, 클러스터링이 블록 프루닝을 줄인다
- `SELECT *` 금지: 컬럼형 저장이라 읽는 컬럼만 과금된다
- 슬롯(on-demand vs. capacity/reservation) 트레이드오프: 예측 가능 워크로드는 reservation이 비용 안정적

```sql
-- 파티션 + 클러스터 테이블 생성
CREATE TABLE `proj.ds.events`
PARTITION BY DATE(event_ts)
CLUSTER BY user_id, event_type
AS SELECT * FROM `proj.ds.raw_events`;
```

**비용 함정**
- 파티션 필터 없는 쿼리는 전체 스캔 → `require_partition_filter = true`로 강제
- 스트리밍 인서트는 비싸다 — 배치 로드(`bq load`)나 Storage Write API를 우선 검토

## Dataflow (Apache Beam)

- 스트리밍/배치 통합 모델 — 윈도잉, 워터마크, 트리거 개념을 정확히 설명할 것
- 오토스케일링과 Streaming Engine을 켜면 워커 상태가 백엔드로 분리돼 재조정 비용↓
- 핫키 문제: `GroupByKey` 전에 키 분포를 점검, 필요 시 키 솔팅

## Pub/Sub

- at-least-once 기본 — 멱등 처리 또는 dedup(메시지 ordering key / exactly-once 구독) 설계 필요
- 구독 유형: pull vs. push vs. BigQuery 구독(직접 적재)
- 백로그·ack deadline·dead-letter 토픽을 운영 관점에서 다룰 것

## Cloud Composer (Airflow)

- 관리형 Airflow — 환경 버전, GKE 기반 비용, DAG 직렬화 주의
- 무거운 연산은 오퍼레이터 내에서 하지 말고 Dataflow/BigQuery로 위임(thin orchestration)

## 비교 관점 (포스트에 자주 등장)

| 작업 | GCP 네이티브 | OSS 대안 | 선택 기준 |
|------|------------|---------|----------|
| 배치 변환 | Dataflow / BigQuery | Spark on Dataproc | SQL 중심이면 BigQuery, 복잡 로직이면 Spark |
| 오케스트레이션 | Composer | self-managed Airflow | 운영부담 최소화 vs. 커스터마이징 |
| 스트리밍 | Dataflow + Pub/Sub | Flink + Kafka | 관리형 vs. 저지연·세밀제어 |
