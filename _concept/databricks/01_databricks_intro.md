---
layout  : concept
title   : Databricks Lakehouse와 핵심 용어
date    : 2026-08-26 00:00:00 +0900
updated : 2026-08-26 00:00:00 +0900
tag     : databricks spark lakehouse certification
toc     : true
comment : true
latex   : false
status  : draft
public  : true
parent  : [[/databricks]]
confidence     : medium
valid_from     : 2026-09-10
---

* TOC
{:toc}

## 1. Databricks가 뭐냐

Spark 만든 사람들이 만든 회사이자 플랫폼. AWS/Azure/GCP 위에 올라가서 돌아가고, 데이터 엔지니어링·ML·SQL 분석·스트리밍을 한 곳에서 다 하게 해준다.

한마디로 "Spark 클러스터 + 노트북 + 스토리지"를 관리형으로 파는 곳. 인프라 세팅 안 해도 클릭 몇 번이면 Spark 클러스터가 뜬다.

## 2. Lakehouse는 왜 나온 개념인가

원래 데이터 저장은 두 갈래로 나뉘어 있었다. Data Lake는 아무 파일이나 싼 값에 쌓아두는 방식이라 유연하지만 스키마도 없고 품질 관리가 안 된다. Data Warehouse는 정형 테이블에 SQL 트랜잭션까지 보장되지만 비싸고 비정형 데이터는 못 다룬다.

Lakehouse는 이 둘을 합쳐보자는 아이디어다. Lake만큼 싸게 저장하면서 Warehouse처럼 트랜잭션과 스키마를 보장한다. 이걸 실제로 가능하게 하는 기술이 Delta Lake고, Databricks가 이 개념 자체를 만든 회사다.

## 3. 자주 나오는 용어들

Workspace는 로그인하면 보이는 작업 공간. 노트북, 클러스터, Job이 다 여기 모여 있다.

Cluster는 코드가 실제로 도는 서버 묶음.

Notebook은 Jupyter 비슷한 실행 환경.

DBFS는 클러스터에서 보는 분산 파일 시스템. 실제로는 S3 같은 클라우드 스토리지를 감싼 것.

Delta Lake는 Parquet 파일에 트랜잭션 로그를 얹어 ACID랑 타임트래블을 가능하게 한 스토리지 포맷.

Job은 노트북/스크립트를 스케줄대로 돌리는 단위. Airflow의 task랑 비슷하다.

Unity Catalog는 테이블·컬럼 단위 권한을 관리하는 거버넌스 레이어.

## 4. 실무에서 마주치는 축들

Databricks를 운영하면서 실제로 부딪히는 건 이 정도로 나뉜다. Spark로 배치/스트리밍 파이프라인을 짜는 것, Delta Lake를 OPTIMIZE/ZORDER/VACUUM으로 유지보수하는 것, Workflows로 여러 노트북·Job을 의존성 있게 오케스트레이션하는 것, medallion architecture로 데이터를 단계별로 정제하는 것, Unity Catalog로 테이블·컬럼 단위 권한을 통제하는 것, 그리고 이 전체를 테스트하고 CI/CD로 배포하는 것.

이 중 아무거나 하나만 잘해서는 안 되고, 결국 파이프라인 하나에 이 축들이 전부 얽힌다. Bronze 적재는 스트리밍/Auto Loader로, Silver 변환은 Delta MERGE로, Gold 집계는 스케줄된 Job으로, 전체 배포는 Asset Bundles로 묶이는 식이다.

## 5. Medallion Architecture

원본 → Bronze(raw 그대로) → Silver(정제·조인) → Gold(집계, BI용).

거의 모든 파이프라인이 이 3단 구조를 따른다. 뒤에 나오는 내용 대부분 이 그림 위에 얹힌다고 보면 된다.

## 6. 컴퓨팅도 종류가 갈린다

화면에서 컴퓨팅을 만들 때 세 가지 중 하나를 고르게 된다.

All-Purpose/Job Cluster는 노드를 직접 관리하는 진짜 Spark 클러스터. 노트북 개발이나 스케줄 파이프라인에 쓴다.

SQL Warehouse는 Spark 클러스터가 아니라 SQL 전용 컴퓨팅. BI 대시보드 쿼리용으로 시작이 빠르고 Photon이 기본으로 붙는다.

Serverless는 노드 개수나 타입을 아예 신경 안 써도 되는 옵션. Databricks가 알아서 프로비저닝한다.

분석가가 대시보드만 본다면 SQL Warehouse, 엔지니어가 노트북으로 파이프라인을 짠다면 클러스터, 이런 식으로 워크로드 성격에 맞춰 고른다.

## 7. 노트북에서 언어 섞어 쓰기

기본 언어가 Python이어도 셀 앞에 매직 커맨드를 붙이면 셀 단위로 언어를 바꿀 수 있다.

%python, %sql, %scala, %r, %md(마크다운), %fs(DBFS 명령), %sh(드라이버에서 셸 명령).

Python 셀에서 만든 DataFrame을 createOrReplaceTempView로 등록하면 바로 아래 %sql 셀에서 조회할 수 있다. 이 전환이 노트북 UX의 핵심이다.

## 8. Git 연동

노트북은 Repos 기능으로 Git 저장소랑 바로 연동된다. .py/.sql 파일이 커밋 단위로 관리되고 브랜치 전환도 워크스페이스 안에서 된다. 프로덕션 파이프라인은 보통 특정 브랜치의 특정 커밋을 Job이 실행하도록 짜서 재현성을 맞춘다.

## 9. Medallion 파이프라인 실제 코드

5장에서 말한 Bronze → Silver → Gold를 실제로 짜면 이렇게 된다.

```python
# Bronze: 원본 그대로 적재, 변환 없음
raw_df = spark.read.format("json").load("/mnt/raw/orders/")

(raw_df.write
    .format("delta")
    .mode("append")
    .saveAsTable("bronze.orders"))

# Silver: 타입 캐스팅, 중복 제거, 이상치 제거
from pyspark.sql.functions import col, to_timestamp

silver_df = (spark.table("bronze.orders")
    .withColumn("order_ts", to_timestamp(col("order_ts")))
    .dropDuplicates(["order_id"])
    .filter(col("amount") > 0))

(silver_df.write
    .format("delta")
    .mode("overwrite")
    .option("overwriteSchema", "true")
    .saveAsTable("silver.orders"))

# Gold: 집계, BI에서 바로 쓸 형태
from pyspark.sql.functions import sum as _sum, count

gold_df = (spark.table("silver.orders")
    .groupBy("customer_id")
    .agg(_sum("amount").alias("total_amount"),
         count("*").alias("order_count")))

(gold_df.write
    .format("delta")
    .mode("overwrite")
    .saveAsTable("gold.customer_summary"))
```

## 10. 임시 뷰의 스코프

노트북 셀은 언어가 달라도 같은 SparkSession을 공유한다. 하지만 Python 변수 자체가 언어 간에 넘어가는 건 아니라서, Python 셀에서 만든 DataFrame을 `%sql` 셀에서 바로 참조할 수는 없다. `createOrReplaceTempView`로 임시 뷰를 등록해야 SQL 쪽에서 이름으로 찾을 수 있다.

```python
df.createOrReplaceTempView("orders_view")
```

```sql
%sql
SELECT * FROM orders_view;
```

이 임시 뷰는 `createOrReplaceTempView`로 만들면 세션 로컬이라 노트북(정확히는 그 노트북이 붙은 SparkSession)이 죽으면 같이 사라진다. 여러 노트북이나 여러 사용자가 같은 뷰를 봐야 하면 `createOrReplaceGlobalTempView`를 쓰는데, 이건 `global_temp` 데이터베이스 아래 등록돼서 조회할 때 `global_temp.orders_view`처럼 접두사를 붙여야 한다. 실무에서는 세션 로컬 뷰로 충분한 경우가 대부분이다. 노트북 간 데이터 공유가 진짜 필요하면 임시 뷰보다는 아예 Delta 테이블로 물리화하는 쪽이 재현성과 디버깅 측면에서 낫다. 임시 뷰는 죽으면 흔적도 없이 사라지지만 테이블은 남는다.

## 11. Databricks Asset Bundles로 배포 자동화

노트북을 워크스페이스에서 손으로 클릭클릭 배포하는 건 개인 실습 수준이고, 실제 운영에서는 Databricks Asset Bundles(DAB)로 Job/클러스터/노트북 경로를 코드(YAML)로 정의하고 CI/CD 파이프라인에서 배포한다.

```yaml
# databricks.yml
bundle:
  name: orders_pipeline

targets:
  dev:
    workspace:
      host: https://dev-workspace.cloud.databricks.com
  prod:
    workspace:
      host: https://prod-workspace.cloud.databricks.com
    mode: production

resources:
  jobs:
    orders_etl:
      name: orders_etl_${bundle.target}
      tasks:
        - task_key: bronze_to_silver
          notebook_task:
            notebook_path: ./notebooks/silver_orders.py
          new_cluster:
            spark_version: 15.4.x-scala2.12
            node_type_id: i3.xlarge
            num_workers: 2
```

```bash
databricks bundle deploy --target prod
databricks bundle run orders_etl --target prod
```

`dev`/`prod` 타겟별로 워크스페이스와 클러스터 스펙을 다르게 가져가면서 같은 정의를 재사용하는 게 핵심이다. `dev`는 보통 개인 워크스페이스에 작은 클러스터로 붙고, `prod`는 `mode: production`을 줘서 소유권을 서비스 프린시펄로 강제하고 리소스 이름 충돌을 막는다. GitHub Actions 같은 CI에서 `databricks bundle deploy --target prod`를 머지 시점에 자동 실행하도록 묶으면 사람이 워크스페이스 UI에서 손으로 배포 버튼을 누르는 경로 자체를 없앨 수 있다. 노트북 개발과 프로덕션 파이프라인 운영 사이의 실질적인 경계선은 결국 이 지점이다.

## 12. PySpark 유닛 테스트

파이프라인 로직을 노트북 안에 다 몰아넣으면 테스트할 방법이 없다. 변환 함수를 노트북 밖 순수 함수로 빼야 로컬에서, 클러스터 없이, CI에서 돌릴 수 있다.

```python
# transforms.py
def clean_orders(df):
    return (df
        .dropDuplicates(["order_id"])
        .filter(df.amount > 0))
```

```python
# test_transforms.py
import pytest
from pyspark.sql import SparkSession
from transforms import clean_orders

@pytest.fixture(scope="session")
def spark():
    return SparkSession.builder.master("local[2]").getOrCreate()

def test_clean_orders_removes_duplicates_and_negative_amount(spark):
    input_df = spark.createDataFrame(
        [(1, 10.0), (1, 10.0), (2, -5.0)], ["order_id", "amount"]
    )
    result = clean_orders(input_df)
    assert result.count() == 1
```

로컬 `SparkSession.builder.master("local[2]")`로 클러스터 없이 CI 러너에서 돈다. Job Cluster를 매번 띄워서 테스트하는 건 몇 분씩 걸리고 DBU가 든다. 그래서 순수 변환 로직은 로컬 테스트로, `dbutils`나 Unity Catalog 접근처럼 클러스터 환경에 의존하는 코드만 별도의 통합 테스트로 실제 워크스페이스에서 돌리는 식으로 나눈다.

`dbutils`는 노트북 밖 순수 Python 환경에는 존재하지 않으므로, 함수가 `dbutils.widgets`나 `dbutils.fs`를 직접 참조하면 그 함수는 로컬 테스트가 불가능해진다. 그래서 `dbutils`가 필요한 부분은 함수 인자로 주입받게 설계하고, 테스트에서는 mock 객체를 넘긴다. DataFrame 두 개가 같은지 비교하는 건 `assertEqual`로는 안 되고(row 순서가 보장 안 됨), `chispa`나 `quinn` 같은 라이브러리의 `assert_df_equality`를 쓰거나, 정렬 후 `collect()`해서 비교하는 헬퍼를 직접 만든다.
