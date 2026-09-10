---
layout  : concept
title   : Databricks Lakehouse와 핵심 용어
date    : 2026-09-05 00:00:00 +0900
updated : 2026-09-05 00:00:00 +0900
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

## 4. 시험 범위 대충 훑기

Spark로 배치/스트리밍 파이프라인 짜는 것, Delta Lake 최적화(OPTIMIZE/ZORDER/VACUUM), Workflows로 오케스트레이션, medallion architecture로 데이터 모델링, Unity Catalog 보안·거버넌스, 테스트/CI-CD까지 묶어서 묻는다.

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

## 10. 시험 유형 맛보기

> 노트북의 Python 셀에서 만든 DataFrame `df`를 바로 아래 `%sql` 셀에서 조회하려고 한다. 다음 중 필요한 작업은?
>
> A. `df.toSQL()`을 호출한다
> B. `df.createOrReplaceTempView("orders_view")`를 실행한 뒤 `%sql` 셀에서 `SELECT * FROM orders_view`
> C. `spark.sql(df)`로 감싼다
> D. `%python`과 `%sql`은 같은 세션을 공유하므로 아무 작업도 필요 없다
>
> 정답 B. 노트북 셀은 언어가 달라도 같은 SparkSession을 공유하지만, Python 변수 자체는 언어 간에 안 넘어간다. `createOrReplaceTempView`로 임시 뷰를 등록해야 다른 언어 셀에서 SQL로 접근할 수 있다.

## 11. Databricks Asset Bundles로 배포 자동화

노트북을 워크스페이스에서 손으로 클릭클릭 배포하는 건 개인 실습 수준이고, 실제 운영에서는 **Databricks Asset Bundles(DAB)** 로 Job/클러스터/노트북 경로를 코드(YAML)로 정의하고 CI/CD 파이프라인에서 배포한다.

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

`dev`/`prod` 타겟별로 워크스페이스와 클러스터 스펙을 다르게 가져가면서 같은 정의를 재사용하는 게 핵심이다. Professional 시험은 "노트북을 어떻게 운영 환경까지 안전하게 승격시키는가"를 이 DAB 개념으로 묻는다.

## 12. PySpark 유닛 테스트

파이프라인 로직을 노트북 안에 다 몰아넣지 않고, 변환 함수를 따로 빼서 테스트 가능하게 만드는 게 Professional 시험에서 요구하는 태도다.

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

로컬 `SparkSession.builder.master("local[2]")`로 클러스터 없이 CI 러너에서 돈다. Job Cluster를 매번 띄워서 테스트하는 건 느리고 비싸다 — 그래서 순수 변환 로직은 로컬 테스트로, 통합 테스트만 실제 클러스터에서 돌리는 식으로 나눈다.

## 13. 시험 유형 맛보기

> 팀에서 `dev`, `staging`, `prod` 세 워크스페이스에 같은 파이프라인을 배포하되 클러스터 크기와 스케줄만 다르게 가져가고 싶다. 코드 중복 없이 이걸 구성하는 가장 적절한 방법은?
>
> A. 워크스페이스마다 노트북을 복사해서 각각 수정한다
> B. Databricks Asset Bundles에서 `targets`별로 오버라이드하고 하나의 정의를 공유한다
> C. 워크스페이스마다 별도 Git 저장소를 만든다
> D. All-Purpose Cluster 하나를 세 워크스페이스가 공유하도록 설정한다
>
> 정답 B. DAB의 `targets`는 같은 리소스 정의를 환경별로 오버라이드하는 표준 메커니즘이다. 노트북 복사(A)는 유지보수 지옥, 클러스터 공유(D)는 워크스페이스 간 격리 원칙에 애초에 안 맞는다.
