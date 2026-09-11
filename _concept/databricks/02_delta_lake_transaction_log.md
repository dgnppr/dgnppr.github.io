---
layout  : concept
title   : Delta Lake 트랜잭션 로그 동작 원리
date    : 2026-08-28 00:00:00 +0900
updated : 2026-08-28 00:00:00 +0900
tag     : databricks delta-lake spark
toc     : true
comment : true
latex   : false
status  : draft
public  : true
parent  : [[/databricks]]
confidence     : medium
valid_from     : 2026-09-10
relations:
  - { type: references, target: /concept/databricks/01_databricks_intro }
---

* TOC
{:toc}

## 1. Delta 테이블의 실체

폴더 하나다.

```
/mytable/
  ├── part-0001.parquet
  ├── part-0002.parquet
  └── _delta_log/
      ├── 00000000000000000000.json
      ├── 00000000000000000001.json
      └── ...
```

데이터는 그냥 Parquet. Delta를 Delta답게 만드는 건 _delta_log 폴더 하나뿐이다.

## 2. _delta_log가 하는 일

INSERT/UPDATE/DELETE/MERGE가 일어날 때마다 기존 파일을 고치는 게 아니라(불변이니까), 이번에 어떤 파일을 추가하고 어떤 파일을 뺐는지 적은 JSON 커밋을 하나씩 쌓는다.

각 JSON에는 add(추가된 파일), remove(제거 표시, 실제 삭제는 아님), metaData(스키마), commitInfo 같은 액션이 들어있다.

현재 테이블 상태는 결국 버전 0부터 최신까지 이 JSON들을 순서대로 재생한 결과다. RDBMS의 WAL이랑 개념이 같다.

## 3. ACID는 어디서 나오나

Atomicity는 커밋 JSON 파일 하나를 쓰는 연산 자체가 원자적이라는 데서 온다. 다 못 쓰면 그 트랜잭션은 없던 일이 된다.

Consistency는 커밋 전 스키마 검증.

Isolation은 두 프로세스가 같은 버전 번호로 동시에 커밋하려 들면 하나만 성공하고 나머지는 재시도하는 optimistic concurrency control.

Durability는 그냥 클라우드 스토리지에 물리적으로 쓰였다는 사실.

## 4. Time Travel이 공짜인 이유

과거 버전을 보고 싶으면 그 버전까지 JSON만 재생하면 된다. 스냅샷을 따로 저장해두는 게 아니라 로그 자체가 스냅샷의 원천이라 그렇다.

```sql
SELECT * FROM mytable VERSION AS OF 5;
SELECT * FROM mytable TIMESTAMP AS OF '2026-09-01';
```

## 5. 체크포인트

버전이 수만 개 쌓이면 매번 처음부터 재생하는 게 느려진다. 그래서 10개 커밋마다 자동으로 체크포인트(현재 상태를 요약한 Parquet)를 만들어두고, 읽을 때는 가장 가까운 체크포인트와 그 이후 JSON만 재생한다.

## 6. 유지보수 명령어 세 개

OPTIMIZE는 작은 파일들을 큰 파일로 합친다(compaction). 작은 파일이 많으면 읽기 성능이 떨어진다.

ZORDER BY (col)는 특정 컬럼 기준으로 데이터를 물리적으로 정렬해서 WHERE 필터 성능을 올린다.

VACUUM은 remove로 표시되고 더 이상 어떤 버전에서도 안 쓰이는 오래된 파일을 실제로 지운다. 기본 보관 기간은 7일이고, 이 기간보다 짧게 돌리면 아직 Time Travel이나 동시 실행 중인 다른 트랜잭션이 참조하고 있는 파일이 날아갈 수 있다. 스트리밍 Job이 오래된 체크포인트에서 재시작하려는 시점에 VACUUM이 그 사이 파일을 이미 지워버렸다면, 그 Job은 파일을 못 찾아 실패한다. 운영 중 VACUUM 스케줄을 짤 때 실제로 부딪히는 문제다.

## 7. 스키마 강제랑 스키마 진화

기본은 엄격하다. 쓰려는 데이터 스키마가 테이블이랑 안 맞으면 쓰기가 실패한다. Bronze에 쓰레기 데이터가 섞이는 걸 막아주는 안전장치다.

일부러 스키마를 바꾸고 싶으면 옵션을 켜야 한다.

```python
(df.write.format("delta")
   .option("mergeSchema", "true")
   .mode("append")
   .save("/mytable"))
```

```sql
ALTER TABLE mytable ADD COLUMNS (new_col STRING);
```

소스에 새 필드가 추가됐는데 파이프라인이 실패한다면 십중팔구 mergeSchema를 안 켠 거다.

## 8. MERGE INTO

Bronze에서 Silver로 갈 때 제일 흔한 패턴이다. 있으면 업데이트, 없으면 삽입.

```sql
MERGE INTO silver_table AS target
USING bronze_updates AS source
ON target.id = source.id
WHEN MATCHED THEN UPDATE SET *
WHEN NOT MATCHED THEN INSERT *
WHEN NOT MATCHED BY SOURCE THEN DELETE
```

내부적으로는 영향받은 파일만 새로 써서 add/remove로 커밋한다. 테이블 전체를 다시 쓰는 게 아니다.

## 9. Change Data Feed

MERGE/UPDATE/DELETE로 테이블이 바뀔 때마다 CDF를 켜두면 어떤 행이 insert/update/delete 됐는지 따로 조회할 수 있다.

```sql
ALTER TABLE mytable SET TBLPROPERTIES (delta.enableChangeDataFeed = true);
```

```python
spark.read.format("delta") \
  .option("readChangeFeed", "true") \
  .option("startingVersion", 5) \
  .table("mytable")
```

Silver에서 Gold로 갈 때 전체 재계산 없이 바뀐 행만 반영하는 증분 처리에 쓴다. Structured Streaming이랑 묶으면 사실상 CDC 파이프라인이 된다.

## 10. Liquid Clustering

ZORDER는 돌릴 때마다 전체 재정렬이 필요하고 키를 나중에 바꾸기 어렵다. Liquid Clustering은 이걸 대체하는 최신 기능이다.

```sql
CREATE TABLE mytable (...) CLUSTER BY (event_date, user_id);
```

디렉터리를 안 나누면서도 물리적으로 군집화하고, 클러스터링 키를 나중에 바꿀 수 있고, 증분으로 유지돼서 매번 전체 재작업이 필요 없다. 최신 버전 기준 문제라면 파티션 컬럼보다 이쪽이 답인 경우가 늘고 있다.

## 11. 제약조건이랑 Generated Column

```sql
ALTER TABLE mytable ADD CONSTRAINT valid_amount CHECK (amount >= 0);

CREATE TABLE events (
  event_ts TIMESTAMP,
  event_date DATE GENERATED ALWAYS AS (CAST(event_ts AS DATE))
);
```

CHECK는 위반하면 쓰기 자체를 거부한다. Generated Column은 다른 컬럼에서 자동 계산되는 컬럼이고, 파티셔닝이나 클러스터링 키로 많이 쓴다.

## 12. DESCRIBE HISTORY랑 RESTORE

```sql
-- 버전 이력 전체 확인
DESCRIBE HISTORY mytable;

-- 잘못된 배치가 들어갔을 때 이전 버전으로 되돌리기
RESTORE TABLE mytable TO VERSION AS OF 12;
-- 또는
RESTORE TABLE mytable TO TIMESTAMP AS OF '2026-09-01 09:00:00';
```

RESTORE는 물리적으로 데이터를 지우고 되돌리는 게 아니라, 되돌아갈 시점의 파일 목록으로 새 커밋을 하나 추가하는 것이다. 그래서 RESTORE를 실행해도 버전 번호는 계속 앞으로 증가한다. 과거로 돌아간 게 아니라 "과거 상태와 같은 새 버전"이 하나 생기는 것이다.

## 13. VACUUM 보관 기간 강제로 줄이기

```sql
VACUUM mytable RETAIN 24 HOURS;
-- 기본 설정에서는 에러: 최소 보관 기간(168시간=7일) 미만은 거부된다
```

강제로 짧게 돌리려면 안전장치를 꺼야 한다.

```sql
SET spark.databricks.delta.retentionDurationCheck.enabled = false;
VACUUM mytable RETAIN 24 HOURS;
```

`retentionDurationCheck`를 끄면 동작은 하지만, 아직 참조 중인 파일이 지워질 위험을 감수하는 것이다. 개발 환경에서 디스크를 빨리 비우고 싶어서 이 설정을 끄는 경우가 종종 있는데, 그 설정이 세션 레벨이 아니라 실수로 클러스터 기본 설정에 박혀서 프로덕션까지 따라가는 사고가 난다. 필요한 순간에만 세션 단위로 켜고 바로 끄는 게 안전하다.

## 14. 동시 쓰기가 충돌하면 생기는 일

3장에서 말한 optimistic concurrency control은 "충돌하면 재시도"라고 뭉뚱그렸는데, 실제로는 충돌 종류에 따라 재시도가 되는 경우와 무조건 실패하는 경우가 갈린다.

두 트랜잭션이 서로 겹치지 않는 파티션/파일에 쓰기만 했다면 Delta는 둘 다 성공시킨다(파일 목록만 병합하면 되니까). 하지만 트랜잭션 A가 읽은 파일을 트랜잭션 B가 이미 지웠다면(예: 둘 다 같은 행을 동시에 UPDATE), A는 `ConcurrentAppendException`이나 `ConcurrentDeleteReadException` 같은 예외로 실패한다. 이건 자동 재시도가 안 되고, 클라이언트가 처음부터 다시 시도해야 한다.

```python
from delta.exceptions import ConcurrentAppendException

for attempt in range(3):
    try:
        spark.sql("MERGE INTO t USING src ON t.id = src.id WHEN MATCHED THEN UPDATE SET *")
        break
    except ConcurrentAppendException:
        if attempt == 2:
            raise
```

같은 테이블에 여러 Job이 동시에 MERGE를 거는 구조라면 이 예외를 안 잡고 방치하면 그 배치는 조용히 실패한 채로 다음 스케줄까지 아무도 모른다. 파티션을 나눠서 MERGE 대상을 겹치지 않게 설계하거나, 재시도 로직을 명시적으로 넣는 게 실제로 필요하다.

## 15. Lakeflow Declarative Pipelines(구 DLT)로 선언형 파이프라인

지금까지 본 Bronze/Silver/Gold 코드는 "어떻게(how) 처리할지"를 다 직접 쓴 명령형 코드다. Lakeflow Declarative Pipelines(옛 이름 Delta Live Tables)는 "무엇을(what) 만들지"만 선언하면 의존성 그래프, 재시도, 증분 처리를 플랫폼이 알아서 관리해준다.

```python
import dlt
from pyspark.sql.functions import col

@dlt.table(comment="원본 주문 데이터")
def bronze_orders():
    return spark.readStream.format("cloudFiles") \
        .option("cloudFiles.format", "json") \
        .load("/mnt/raw/orders/")

@dlt.table
@dlt.expect_or_drop("valid_amount", "amount > 0")   # 데이터 품질 제약: 위반 행은 드롭
def silver_orders():
    return dlt.read_stream("bronze_orders").dropDuplicates(["order_id"])

@dlt.table
def gold_customer_summary():
    return (dlt.read("silver_orders")
        .groupBy("customer_id")
        .agg({"amount": "sum"}))
```

`@dlt.expect_or_drop`, `@dlt.expect_or_fail`, `@dlt.expect`(경고만) 세 가지로 데이터 품질 게이트 강도를 조절한다. 테이블 간 의존성(`bronze_orders` → `silver_orders` → `gold_customer_summary`)은 함수 안에서 `dlt.read`/`dlt.read_stream`으로 다른 테이블을 참조하는 순간 자동으로 DAG가 그려진다. Airflow처럼 태스크 순서를 손으로 안 정해도 된다.

## 16. APPLY CHANGES INTO로 SCD Type 1/2 자동화하기

CDC 소스(예: 소스 DB의 변경 로그)를 Silver 테이블에 반영할 때, Slowly Changing Dimension을 직접 MERGE 문으로 짜는 건 번거롭고 실수하기 쉽다. Lakeflow Declarative Pipelines는 이걸 선언 하나로 처리한다.

```python
dlt.create_streaming_table("customers_silver")

dlt.apply_changes(
    target="customers_silver",
    source="customers_cdc_bronze",
    keys=["customer_id"],
    sequence_by="change_ts",
    apply_as_deletes="operation = 'DELETE'",
    except_column_list=["operation", "change_ts"],
    stored_as_scd_type=2   # 1이면 덮어쓰기, 2면 이력 보존(valid_from/valid_to 자동 생성)
)
```

`stored_as_scd_type=2`를 주면 `__START_AT`/`__END_AT` 컬럼이 자동으로 생겨서 "고객 주소가 언제부터 언제까지 어떤 값이었는지" 이력이 통째로 관리된다. 이걸 손으로 짜려면 이전 유효 레코드를 만료시키는 UPDATE와 새 레코드를 삽입하는 INSERT를 한 트랜잭션 안에서 순서대로 맞춰야 하고, `sequence_by` 없이 순서가 뒤바뀐 CDC 이벤트가 들어오면 이력이 꼬인다. `apply_changes`는 이 순서 보장과 late-arriving 이벤트 처리까지 내부적으로 맡아준다.

## 17. Deletion Vectors로 MERGE/DELETE 빠르게 만들기

Delta의 기본 동작은 "행 하나만 지워도 그 행이 속한 파일 전체를 다시 쓰는" 것이다. 파일이 크면 행 하나 지우려고 수백 MB를 다시 쓰는 셈이라 비효율적이다.

Deletion Vector를 켜면 삭제/업데이트된 행을 파일 재작성 없이 "이 파일의 이런 행들은 무효"라고 표시하는 별도의 작은 마스크 파일로 처리한다.

```sql
ALTER TABLE mytable SET TBLPROPERTIES ('delta.enableDeletionVectors' = 'true');

DELETE FROM mytable WHERE order_id = 12345;
-- 파일 전체 재작성 대신 deletion vector 파일 하나만 추가된다
```

읽을 때는 Parquet 파일 + 해당 deletion vector를 같이 적용해서 무효 처리된 행을 걸러낸다. 대신 이 상태가 계속 쌓이면 읽기 성능이 조금씩 떨어지므로, 주기적으로 `REORG TABLE ... APPLY (PURGE)`로 실제 파일에 반영(compaction)해줘야 한다. MERGE/UPDATE/DELETE가 잦은 대용량 테이블에서 쓰기 비용을 확 줄이는 최신 기능.

## 18. 새 기능을 켜면 옛날 리더가 못 읽는다

Deletion Vector, Liquid Clustering, Change Data Feed 같은 최신 기능은 전부 Delta 테이블의 프로토콜 버전을 올린다. 문제는 이게 하위 호환이 아니라는 점이다.

Deletion Vector를 켠 테이블은 reader protocol이 올라가서, 이 버전을 모르는 오래된 Delta 클라이언트(예: 구버전 OSS Delta Lake, 오래된 Spark 런타임, Delta 커넥터가 최신이 아닌 외부 도구)가 그 테이블을 읽으면 삭제된 것으로 표시된 행까지 그대로 보이거나 아예 읽기가 거부된다. Databricks Runtime 안에서만 쓰는 테이블이면 문제가 없지만, 같은 Delta 파일을 다른 엔진(예: 별도로 띄운 OSS Spark, Trino, 오래된 버전의 다른 플랫폼)이 직접 읽는 구조라면 얘기가 달라진다.

```sql
-- 테이블이 요구하는 프로토콜 버전 확인
DESCRIBE DETAIL mytable;
-- minReaderVersion / minWriterVersion 컬럼을 본다
```

새 기능을 켜기 전에 이 테이블을 읽는 다른 시스템이 있는지, 그 시스템이 새 프로토콜을 지원하는 버전인지부터 확인해야 한다. 사내에서만 도는 파이프라인이면 큰 문제가 아니지만, 외부 파트너나 레거시 BI 도구가 같은 Delta 파일을 직접 읽는 구조라면 기능을 켜는 순간 그쪽이 조용히 깨질 수 있다.
