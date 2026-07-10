---
layout      : concept
title       : Lakehouse 테이블 포맷 — Iceberg·Delta·Hudi
date        : 2026-07-10 00:00:00 +0900
updated     : 2026-07-10 00:00:00 +0900
tag         : lakehouse iceberg delta-lake hudi data-engineering
toc         : true
comment     : true
latex       : true
status      : complete
public      : true
parent      : [[/data-engineering]]
confidence  : medium
valid_from  : 2026-07-10
relations:
  - { type: references, target: /concept/data-architect/00_what_is_medaliion_architecture }
  - { type: references, target: /concept/spark/00_what_is_pyspark }
---

* TOC
{:toc}

## 개요

**테이블 포맷(table format)은 object storage 위의 파일 더미를 "테이블"로 만들어 주는 메타데이터 계층이다.** Iceberg·Delta·Hudi는 모두 이 계층이다.

먼저 용어를 분리하자. 자주 뒤섞인다.

| 계층 | 정체 | 예시 |
|------|------|------|
| 파일 포맷(file format) | 한 파일 안에서 컬럼·압축·인코딩을 정의 | Parquet, ORC, Avro |
| 테이블 포맷(table format) | 여러 파일을 하나의 트랜잭션 단위(테이블)로 묶는 메타데이터 | **Iceberg, Delta, Hudi** |
| 카탈로그(catalog) | 테이블 이름 → 현재 메타데이터 위치를 가리키는 포인터 | Hive Metastore, Glue, REST catalog, Unity |

Iceberg·Delta·Hudi는 **Parquet를 대체하지 않는다.** 데이터는 여전히 Parquet(대부분)로 저장되고, 그 위에 "어떤 파일들이 지금 이 테이블에 속하는가"를 기록하는 메타데이터가 얹힌다.

## 왜 필요한가 — data lake의 한계

data lake는 S3/GCS 같은 object storage에 Parquet 파일을 쌓는 구조다. `s3://bucket/orders/dt=2026-07-10/part-0001.parquet` 식으로. 쿼리 엔진은 "이 디렉토리 아래 파일 전부"를 테이블로 본다(Hive 방식). 이 단순함이 곧 한계다.

- **원자성 없음.** 파일을 여러 개 쓰는 도중 잡이 죽으면, 반쯤 쓰인 파일이 그대로 쿼리에 노출된다. "커밋"이라는 개념이 없다.
- **동시 쓰기 충돌.** 두 잡이 같은 파티션을 덮어쓰면 한쪽이 조용히 사라진다. 격리(isolation) 보장이 없다.
- **행 단위 수정·삭제가 사실상 불가능.** GDPR 삭제 요청 하나 처리하려고 파티션 전체를 다시 쓴다. CDC upsert도 마찬가지.
- **쿼리 플래닝이 느리고 부정확.** "디렉토리 리스팅"으로 파일을 찾는데, object storage의 LIST는 느리고 과거엔 eventually consistent였다. 파일 수가 수백만이면 플래닝만 몇 분.
- **스키마 진화가 위험.** 컬럼 이름/순서/타입 변경 시, 파일 포맷 레벨에서 안전 장치가 없어 조용히 깨진다.
- **과거 스냅샷을 볼 수 없다.** 덮어쓰면 이전 상태는 사라진다. 재현·감사·롤백 불가.

세 테이블 포맷은 전부 이 목록을 겨냥해 태어났다. 해결 수단이 **메타데이터/로그 계층**이다.

## 공통 메커니즘 — 셋 다 같은 뼈대다

세부는 다르지만 핵심 아이디어는 동일하다. 이걸 먼저 잡으면 세 포맷의 차이는 "구현 선택"으로 읽힌다.

1. **데이터 파일은 불변(immutable)이다.** 한번 쓴 Parquet는 절대 수정하지 않는다. 수정·삭제는 "새 파일을 쓰고 메타데이터에서 옛 파일을 제외"하는 방식으로 표현한다.
2. **메타데이터가 '지금 이 테이블 = 이 파일 집합'을 정의한다.** 테이블 상태 = 메타데이터가 가리키는 파일들의 합. 디렉토리 리스팅이 아니라 메타데이터를 읽는다.
3. **커밋 = 메타데이터 포인터의 원자적 교체(atomic swap).** 새 상태를 통째로 만든 뒤, 최상위 포인터 하나만 원자적으로 바꾼다. 이 스왑이 성공하면 커밋, 실패하면 없던 일. 이것이 ACID의 A를 만든다.
4. **격리는 낙관적 동시성 제어(OCC)로.** 각 writer는 "내가 읽은 버전"을 기억하고, 커밋 직전에 "그 사이 남이 바꿨나"를 확인한다. 바뀌었으면 충돌 → 재시도. 스냅샷 격리(snapshot isolation)를 준다.
5. **각 커밋이 스냅샷을 남긴다 → time travel.** 옛 메타데이터를 지우지 않으므로 "버전 N 시점의 테이블"을 그대로 조회할 수 있다.

즉 셋 다 **"불변 파일 + 로그/메타데이터 + 원자적 포인터 스왑 + OCC"**라는 같은 문법을 쓴다. 차이는 (1) 메타데이터를 어떻게 표현하는가, (2) 수정을 즉시 반영(read 최적화)할지 나중에 반영(write 최적화)할지다.

## 핵심 축 — Copy-on-Write vs Merge-on-Read

이 하나가 세 포맷을 관통하는 가장 중요한 튜닝 축이다. "행 하나를 수정할 때 무엇을 다시 쓰는가"의 문제다.

**Copy-on-Write (CoW).** 수정 대상 행이 든 데이터 파일을 통째로 다시 쓴다. 새 파일에 "수정본"이 들어가고 옛 파일은 메타데이터에서 빠진다.
- 읽기: 빠르다. 읽을 때 할 일이 없다. 파일이 곧 최신 상태.
- 쓰기: 비싸다. 한 행 고치려고 128MB 파일을 다시 쓴다. **쓰기 증폭(write amplification)**.
- 적합: 읽기 잦고 쓰기 드문 배치 테이블.

**Merge-on-Read (MoR).** 수정을 "델타(delta)/삭제(delete) 파일"에 따로 적어 둔다. 원본은 안 건드린다. 읽을 때 base 파일 + delta 파일을 병합해서 최종 상태를 만든다.
- 쓰기: 빠르다. 작은 delta만 append.
- 읽기: 느려질 수 있다. 매번 병합 비용. delta가 쌓이면 더 느려진다.
- 필수: **compaction**(주기적으로 base+delta를 합쳐 새 base로 만듦). 안 하면 읽기 성능이 계속 나빠진다.
- 적합: 쓰기(특히 upsert/streaming) 잦은 테이블.

세 포맷 다 두 모드를 지원하지만 **기본 성향이 다르다**: Delta는 CoW 지향(→ deletion vector로 MoR 보강), Iceberg는 v2에서 MoR(delete file) 도입, Hudi는 처음부터 MoR/upsert를 위해 설계됐다.

## Apache Iceberg

Netflix에서 Ryan Blue가 시작(대규모 분석 테이블의 Hive 한계 극복 목적), 지금은 Apache top-level 프로젝트. **엔진 중립성과 깨끗한 스펙**이 정체성이다.

### 메타데이터 구조 — 포인터 트리

Iceberg의 메타데이터는 4단 트리다. 최상위 포인터 하나만 바꾸면 커밋이 끝난다.

```
catalog
  └─▶ metadata.json         (테이블 메타데이터: 스키마·파티션 스펙·스냅샷 목록)
         └─▶ manifest list   (스냅샷 하나 = manifest 파일들의 목록 + 파티션 통계)
                └─▶ manifest  (data 파일들의 목록 + 컬럼별 min/max 통계)
                       └─▶ data files (Parquet/ORC/Avro)
```

- 커밋은 새 `metadata.json`을 쓰고 **카탈로그가 가리키는 포인터를 원자적으로 교체**하는 것으로 끝난다.
- 쿼리 플래닝 때 디렉토리 리스팅을 안 한다. manifest의 파티션·컬럼 통계로 **읽을 파일을 메타데이터만 보고 가지치기(pruning)**한다. 파일 수백만이어도 빠르다.

### hidden partitioning — Iceberg만의 강점

Hive에서는 `WHERE dt = '2026-07-10'`처럼 파티션 컬럼을 쿼리가 직접 알아야 파티션 프루닝이 된다. Iceberg는 **파티션 변환(transform)을 메타데이터에 저장**한다.

```sql
-- ts(timestamp)를 day 단위로 파티션. 물리 컬럼 'dt'를 따로 안 만든다
CREATE TABLE db.events (id bigint, ts timestamp, payload string)
USING iceberg
PARTITIONED BY (day(ts));

-- 사용자는 파티션을 몰라도 됨. ts로만 필터해도 day 파티션이 프루닝됨
SELECT * FROM db.events WHERE ts >= '2026-07-10';
```

여기에 **파티션 진화(partition evolution)**가 붙는다. `day(ts)` → `hour(ts)`로 파티션 전략을 바꿔도 **과거 데이터를 다시 쓰지 않는다.** 옛 데이터는 옛 스펙, 새 데이터는 새 스펙으로 각각 프루닝된다. 세 포맷 중 이걸 스펙 레벨에서 지원하는 건 Iceberg가 유일하다.

### 스키마 진화 — 컬럼 ID 기반

컬럼을 이름이 아니라 **내부 ID**로 추적한다. 그래서 add/drop/rename/reorder/타입 확장이 파일 재작성 없이 안전하다. 컬럼 이름을 바꿔도 옛 파일의 데이터가 엉키지 않는다.

### 행 단위 수정 (format v2)

- **spec v2**에서 delete file 도입 → MoR. position delete(어느 파일 몇 번째 행) / equality delete(키 = 값) 두 종류.
- CoW도 여전히 선택 가능(엔진 설정으로 `copy-on-write` / `merge-on-read` 지정).
- **spec v3**은 deletion vector, 새 타입(variant 등), row lineage 등을 추가하는 방향으로 진행 중이다(2026 기준 확산 단계). 버전별 기능은 사용하는 엔진의 지원 범위를 확인해야 한다. — *이 문단은 시점 의존, 확신도 medium*

### 카탈로그 — REST catalog가 판을 바꿨다

Iceberg는 카탈로그 구현을 여럿 지원한다(Hive, JDBC, Glue, Nessie...). 그중 **REST catalog 스펙**이 중요하다. 카탈로그를 HTTP API로 표준화해서, 엔진이 벤더별 카탈로그 구현에 묶이지 않고 어떤 Iceberg 카탈로그와도 붙을 수 있게 했다. 뒤의 "수렴" 절에서 다시 다룬다.

**엔진 지원:** Spark, Flink, Trino, Presto, Dremio, Snowflake, BigQuery(BigLake), Athena 등 가장 넓다.

## Delta Lake

Databricks가 만들고 Linux Foundation으로 오픈소스화. **Spark/Databricks 생태계 안에서의 완성도**가 강점이다.

### 메타데이터 구조 — 순차 트랜잭션 로그

Delta는 트리가 아니라 **순차 로그**다. 테이블 디렉토리 안 `_delta_log/`에 커밋이 번호순으로 쌓인다.

```
_delta_log/
  00000000000000000000.json    (커밋 0: add file A, add file B)
  00000000000000000001.json    (커밋 1: remove A, add C)
  ...
  00000000000000000010.checkpoint.parquet   (10개 커밋을 접은 스냅샷)
  _last_checkpoint
data files: part-0001.parquet, part-0002.parquet ...
```

- 각 JSON 커밋은 `add`/`remove` **액션의 목록**이다. 테이블 상태 = 로그를 처음부터 replay한 결과.
- 로그가 길어지면 replay가 느려지므로 주기적으로 **checkpoint**(Parquet)로 접는다. 읽을 땐 마지막 checkpoint + 이후 JSON만 replay.
- 커밋 = `N.json` 파일을 **"이미 있으면 실패(put-if-absent)"** 방식으로 생성. 이 원자성이 관건인데, S3는 오래 이 연산이 없어서 과거엔 DynamoDB 락으로 우회했다(S3가 조건부 쓰기를 지원하며 상황 개선). GCS/ADLS는 네이티브 지원.

### 최적화 기능

- **`OPTIMIZE`**: 작은 파일들을 합쳐 읽기 성능을 올린다(small file 문제 대응).
- **Z-ordering**: 여러 컬럼을 다차원 정렬해 data skipping 효율↑.
- **deletion vector**: 행 삭제/수정 시 파일을 통째로 재작성하지 않고 "이 행은 죽었다"는 벡터만 기록 → MoR 스타일. CoW의 쓰기 증폭을 완화.
- **liquid clustering**: 파티션/Z-order를 대체하는 신형 클러스터링. 파티션 컬럼 사전 선택 부담을 줄인다.
- **`VACUUM`**: 참조 안 되는 옛 데이터 파일을 물리 삭제(단, 이걸 하면 그만큼 time travel 범위가 줄어든다 — 주의).

### 행 단위 수정

```sql
-- upsert의 표준. CDC 반영에 흔히 쓴다
MERGE INTO target t
USING source s ON t.id = s.id
WHEN MATCHED THEN UPDATE SET *
WHEN NOT MATCHED THEN INSERT *;

-- time travel
SELECT * FROM target VERSION AS OF 5;
SELECT * FROM target TIMESTAMP AS OF '2026-07-01';
```

기본은 CoW. deletion vector를 켜면 MoR처럼 동작한다.

### 상호운용 — UniForm

Delta의 개방 전략이 **UniForm**이다. Delta로 쓰면서 **Iceberg(및 Hudi) 메타데이터를 함께 생성**해, Iceberg 리더가 같은 데이터를 읽게 한다. Iceberg로의 시장 수렴에 대한 Delta 진영의 대응이다. 엔진 접근성은 델타-rs(Rust)·Delta Kernel로 Spark 밖에서도 넓히는 중.

## Apache Hudi

Uber에서 시작(**H**adoop **U**pserts **D**eletes and **I**ncrementals). **스트리밍 인제스트·upsert·증분 처리**가 태생적 목적이다. 셋 중 "write-heavy / near-real-time"에 가장 특화됐다.

### 타임라인과 레코드 인덱스

- 테이블 디렉토리의 `.hoodie/`에 **timeline**(instant들: commit, deltacommit, compaction, clean...)이 쌓인다. Delta 로그와 개념이 비슷하다.
- 결정적 차이는 **record-level index**다. 각 레코드에 **record key**를 두고, key → 어느 파일에 있는지를 인덱스(bloom / simple / HBase / record-level index)로 관리한다. 그래서 **upsert가 빠르다**: 업데이트할 레코드가 어느 파일에 있는지 전체 스캔 없이 찾는다. Iceberg·Delta에는 없는 개념.

### 테이블 타입 — COW / MOR를 테이블 속성으로

Hudi는 CoW/MoR를 쿼리마다가 아니라 **테이블 타입**으로 고정한다.

- **Copy-on-Write 테이블**: base 파일만. 읽기 최적, 쓰기 비쌈.
- **Merge-on-Read 테이블**: base 파일 + row 기반 **log(delta) 파일**. 쓰기가 빠르고, compaction으로 주기적으로 병합.
  - 쿼리 타입이 갈린다: **snapshot query**(base+log 병합, 최신), **read-optimized query**(base만, 빠르지만 최근 delta 누락), **incremental query**.

### 증분 쿼리 (incremental query) — Hudi의 킬러 기능

"커밋 T 이후 바뀐 레코드만" 뽑아낼 수 있다. 전체 재스캔 없이 변경분만 downstream으로 흘려보내는 **증분 ETL/CDC 파이프라인**의 핵심이다.

```python
# Spark로 Hudi MoR 테이블에 upsert
(df.write.format("hudi")
   .option("hoodie.table.name", "orders")
   .option("hoodie.datasource.write.table.type", "MERGE_ON_READ")
   .option("hoodie.datasource.write.recordkey.field", "order_id")
   .option("hoodie.datasource.write.precombine.field", "updated_at")  # 같은 키 충돌 시 최신 선택
   .option("hoodie.datasource.write.operation", "upsert")
   .mode("append").save("s3://bucket/orders"))

# 증분 조회: 특정 커밋 이후 변경분만
(spark.read.format("hudi")
   .option("hoodie.datasource.query.type", "incremental")
   .option("hoodie.datasource.read.begin.instanttime", "20260701000000")
   .load("s3://bucket/orders"))
```

### 테이블 서비스

compaction·clustering·cleaning·indexing을 **inline(쓰기와 함께) 또는 async(별도)**로 돌린다. 유연하지만 운영 튜닝 포인트가 셋 중 가장 많다 — 강력함의 대가로 복잡도가 높다.

## 비교 정리

| 축 | Iceberg | Delta Lake | Hudi |
|----|---------|-----------|------|
| 출신 | Netflix / Apache | Databricks / LF | Uber / Apache |
| 설계 편향 | 대규모 분석, 엔진 중립 | Spark 생태계 완성도 | 스트리밍 upsert·증분 |
| 메타데이터 | 포인터 트리(manifest) | 순차 로그 + checkpoint | 타임라인 + **레코드 인덱스** |
| 커밋 원자성 | 카탈로그 포인터 스왑 | 로그 파일 put-if-absent | 타임라인 instant |
| 기본 쓰기 모드 | v2에서 MoR 도입 | CoW(+ deletion vector) | COW/MoR 테이블 타입 |
| upsert 성능 | 보통 | MERGE로 양호 | **최상**(record index) |
| 파티션 진화 | **지원(고유)** | liquid clustering으로 대체 | clustering |
| 증분 쿼리 | 제한적 | CDF(change data feed) | **네이티브** |
| 스키마 진화 | 컬럼 ID 기반(견고) | 지원 | 지원 |
| 엔진 폭 | **가장 넓음** | Spark 중심(확대 중) | Spark/Flink 중심 |
| 운영 복잡도 | 중 | 낮음(관리형 강함) | 높음 |

## 무엇을 선택할까

- **여러 엔진에서 읽고, 벤더에 묶이기 싫고, 초대형 테이블이며, 파티션 전략이 바뀔 수 있다 → Iceberg.** 2026 현재 업계 수렴점이기도 하다(다음 절).
- **Databricks/Spark에 이미 깊이 들어가 있고, 그 안에서 최상의 UX·성능(liquid clustering, 관리형 OPTIMIZE)을 원한다 → Delta.**
- **CDC/스트리밍 upsert가 워크로드의 중심이고, 증분 쿼리와 레코드 단위 인덱싱이 필요하며, near-real-time이 목표다 → Hudi.**

현실적으로 순수 배치 분석 테이블이라면 셋 중 무엇이든 요구를 충족한다. 선택을 가르는 건 대개 **(1) 어느 엔진/카탈로그 생태계에 있는가, (2) 워크로드가 read-heavy인가 write/upsert-heavy인가** 두 가지다.

## 수렴 흐름 (2026 시점)

세 포맷의 경쟁은 "하나로 수렴"과 "번역으로 공존" 두 방향으로 흐르고 있다. — *이 절은 생태계 동향이라 시점 의존, 확신도 medium*

- **Iceberg REST catalog**가 사실상 표준 카탈로그 인터페이스로 자리 잡는 중. 엔진이 벤더 카탈로그에 종속되지 않게 한다.
- **Delta UniForm**: Delta로 쓰고 Iceberg로도 읽게 함(메타데이터 동시 생성).
- **Apache XTable**(옛 OneTable): Iceberg·Delta·Hudi **메타데이터를 서로 번역**. 데이터 파일은 그대로 두고 메타데이터만 변환해 세 포맷을 오간다.
- **벤더 정렬**: Databricks의 Tabular(Iceberg 상용화 회사) 인수, Snowflake의 Polaris(Iceberg REST catalog → Apache Polaris 오픈소스화) 등으로 시장 무게추가 Iceberg 쪽으로 기우는 신호가 뚜렷하다.

결론적으로 데이터 파일(Parquet)은 공통, 카탈로그는 REST로 표준화, 테이블 메타데이터는 XTable/UniForm으로 번역 가능해지는 방향이다. "포맷 하나에 올인"의 리스크가 예전보다 줄고 있다.

## 한계·주의

정직하게 짚을 것들.

- **small file 문제는 안 사라진다.** 스트리밍/잦은 커밋은 작은 파일을 양산한다. compaction/OPTIMIZE를 안 돌리면 읽기 성능이 계속 나빠진다. 세 포맷 공통.
- **메타데이터도 부풀어 오른다.** 커밋이 쌓이면 manifest/로그/타임라인이 커진다. Iceberg는 만료(expire snapshots), Delta는 VACUUM, Hudi는 clean으로 관리해야 하는데, 이걸 하면 **time travel 범위가 줄어든다.** 보존과 성능은 트레이드오프.
- **object storage의 커밋 원자성에 의존한다.** 특히 S3 위 Delta의 다중 writer는 역사적으로 외부 락(DynamoDB)이 필요했다. 스토리지의 조건부 쓰기 지원 여부를 확인해야 한다.
- **MoR는 공짜가 아니다.** 쓰기를 싸게 만든 대가를 읽기와 compaction 운영이 치른다. compaction을 게을리하면 읽기가 무너진다.
- **"오픈 포맷"과 "벤더 중립"은 다르다.** 포맷이 오픈소스여도 최상의 성능·기능이 특정 벤더 관리형에서만 나오는 경우가 많다. 카탈로그·관리형 서비스 레벨의 종속을 별도로 따져야 한다.
- **버전 스펙에 민감하다.** Iceberg v2/v3, Delta deletion vector, Hudi 인덱스 종류처럼 세부 기능은 **엔진 지원 범위**에 좌우된다. "포맷이 지원한다"와 "내 엔진이 그 기능을 읽고 쓴다"는 별개다.

## 정리

- Iceberg·Delta·Hudi는 Parquet를 대체하는 게 아니라 그 위에 **트랜잭션 메타데이터**를 얹어 파일 더미를 ACID 테이블로 만든다.
- 뼈대는 셋 다 같다: **불변 파일 + 메타데이터/로그 + 원자적 포인터 스왑 + OCC 스냅샷 격리 + time travel.**
- 가장 중요한 튜닝 축은 **CoW vs MoR** — 읽기를 싸게 할지 쓰기를 싸게 할지.
- 성향: **Iceberg**=엔진 중립·파티션 진화, **Delta**=Spark 생태계 완성도, **Hudi**=upsert·증분·스트리밍.
- 2026 현재 REST catalog·UniForm·XTable로 상호운용이 커지고, 무게추는 Iceberg로 기우는 신호가 강하다. 선택은 "어느 생태계에 있고, read-heavy인가 write-heavy인가"로 대개 갈린다.
