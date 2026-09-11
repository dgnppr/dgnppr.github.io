---
layout  : concept
title   : Unity Catalog로 데이터 거버넌스 잡기
date    : 2026-09-03 00:00:00 +0900
updated : 2026-09-03 00:00:00 +0900
tag     : databricks unity-catalog governance spark
toc     : true
comment : true
latex   : false
status  : draft
public  : true
parent  : [[/databricks]]
confidence     : medium
valid_from     : 2026-09-11
relations:
  - { type: references, target: /concept/databricks/01_databricks_intro }
  - { type: references, target: /concept/databricks/02_delta_lake_transaction_log }
  - { type: references, target: /concept/databricks/03_spark_cluster_types }
---

* TOC
{:toc}

## 1. Unity Catalog 이전엔 뭐가 문제였나

Unity Catalog가 나오기 전 Databricks는 워크스페이스마다 Hive Metastore를 하나씩 따로 뒀다. 워크스페이스 A의 `sales.orders`와 워크스페이스 B의 `sales.orders`는 이름만 같을 뿐 완전히 다른 메타스토어에 등록된, 서로 존재조차 모르는 테이블이었다.

권한도 테이블 단위로 세밀하게 못 걸었다. 클러스터 접근 권한으로 뭉뚱그려 막는 정도가 한계였고, 컬럼 하나만 마스킹하거나 사용자별로 다른 행만 보여주는 건 애초에 지원하지 않았다. 누가 어떤 테이블을 언제 조회했는지 추적하려면 클러스터 로그를 직접 뒤져야 했다.

Unity Catalog는 이 세 가지를 한 번에 해결하려는 계층이다. 워크스페이스를 넘나드는 하나의 메타스토어, 테이블/컬럼/행 단위 권한, 자동 계보(lineage) 추적.

## 2. 3-Level Namespace

Hive Metastore 시절엔 `schema.table` 두 단계였다. Unity Catalog는 여기에 catalog를 한 단계 더 얹는다.

```sql
SELECT * FROM prod.sales.orders;
--         └──┘  └──┘  └────┘
--       catalog schema  table
```

catalog는 보통 환경(`dev`/`staging`/`prod`)이나 사업부 단위로 나눈다. 같은 이름의 스키마와 테이블이 `dev.sales.orders`와 `prod.sales.orders`로 완전히 격리되면서도 하나의 메타스토어 안에서 공존한다. 계정 전체에 메타스토어는 보통 리전당 하나만 두고, 그 아래 여러 워크스페이스가 이 메타스토어 하나를 같이 참조한다. 그래서 워크스페이스가 달라도 `prod.sales.orders`는 어디서 봐도 같은 테이블이다.

## 3. 계층 구조와 securable object

메타스토어 아래로 catalog, schema, 그리고 테이블/뷰/볼륨/함수가 순서대로 걸린다. 이 각각을 Unity Catalog는 securable object라고 부르고, 전부 독립적으로 권한을 걸 수 있는 대상이다.

```
metastore
 └── catalog (prod)
      └── schema (sales)
           ├── table (orders)
           ├── view (orders_summary)
           ├── volume (raw_files)
           └── function (calc_discount)
```

VOLUME은 DBFS 마운트를 대체하는 개념이다. 정형 테이블이 아닌 파일(이미지, PDF, 모델 체크포인트 등)을 다룰 때, 예전엔 `/dbfs/mnt/...` 경로로 마운트해서 썼는데 이 마운트 방식은 Unity Catalog 권한 체계 밖에 있어서 거버넌스 사각지대였다. VOLUME은 같은 GRANT 문법으로 파일 접근 권한을 걸 수 있어서 이 사각지대를 메운다.

```sql
CREATE VOLUME prod.sales.raw_files;
-- 경로: /Volumes/prod/sales/raw_files/...
```

## 4. 권한은 계단식으로 쌓인다

가장 자주 헷갈리는 부분이다. 테이블에 SELECT 권한을 줬다고 그 사용자가 바로 조회할 수 있는 게 아니다.

```sql
GRANT SELECT ON TABLE prod.sales.orders TO `analytics_team`;
```

이것만 실행하면 `analytics_team`은 여전히 조회를 못 한다. Unity Catalog는 파일시스템처럼 하위 권한을 자동으로 상속하지 않는다. catalog와 schema 각각에 대해 "이 경로를 지나가도 된다"는 USE 권한을 따로 줘야 한다.

```sql
GRANT USE CATALOG ON CATALOG prod TO `analytics_team`;
GRANT USE SCHEMA ON SCHEMA prod.sales TO `analytics_team`;
GRANT SELECT ON TABLE prod.sales.orders TO `analytics_team`;
```

세 문장이 다 있어야 조회가 된다. 실무에서 "분명 SELECT 권한을 줬는데 왜 조회가 안 되냐"는 문의가 나오면 열에 아홉은 USE CATALOG나 USE SCHEMA를 빼먹은 경우다. 권한을 그룹 단위로 묶고, 새 스키마를 만들 때마다 그 그룹에 USE SCHEMA를 자동으로 얹는 스크립트를 워크플로우에 넣어두는 게 이 문제를 근본적으로 없애는 방법이다.

## 5. Row Filter와 Column Mask

컬럼 하나를 특정 역할만 못 보게 하거나, 사용자 소속에 따라 보이는 행 자체를 다르게 하고 싶을 때 쓴다. 둘 다 SQL 함수로 로직을 정의하고, 그 함수를 테이블에 매단다.

```sql
CREATE FUNCTION prod.sales.mask_email(email STRING)
RETURNS STRING
RETURN CASE
  WHEN is_account_group_member('pii_readers') THEN email
  ELSE '***MASKED***'
END;

ALTER TABLE prod.sales.customers
  ALTER COLUMN email SET MASK prod.sales.mask_email;
```

```sql
CREATE FUNCTION prod.sales.region_filter(region STRING)
RETURNS BOOLEAN
RETURN region = current_user_region() OR is_account_group_member('global_admin');

ALTER TABLE prod.sales.orders
  SET ROW FILTER prod.sales.region_filter ON (region);
```

같은 `SELECT * FROM prod.sales.customers`를 실행해도 `pii_readers` 그룹이 아니면 email 컬럼이 마스킹된 값으로 나온다. 같은 `orders` 테이블을 조회해도 사용자 지역에 따라 보이는 행이 갈린다. 애플리케이션 코드는 한 줄도 안 바뀌고, 뷰를 따로 만들 필요도 없다.

이 함수는 매 쿼리, 매 행마다 평가된다. 로직이 무거우면(예: 외부 API 호출이나 복잡한 서브쿼리) 대용량 스캔에서 눈에 띄게 느려질 수 있다. 마스킹 함수는 되도록 단순한 조건 분기로 유지하는 게 좋다.

## 6. Storage Credential과 External Location

Unity Catalog 테이블이 실제로 어느 클라우드 스토리지에 데이터를 쓰는지는 별도로 등록해야 한다. 이 등록이 Storage Credential과 External Location 두 단계로 나뉜다.

Storage Credential은 Databricks가 클라우드 스토리지에 접근할 때 쓸 자격 증명이다(AWS면 IAM Role, Azure면 Managed Identity, GCP면 서비스 계정).

```sql
CREATE STORAGE CREDENTIAL prod_cred
  WITH (AWS_IAM_ROLE = 'arn:aws:iam::123456789012:role/uc-prod-access');
```

External Location은 이 자격 증명을 특정 클라우드 경로에 묶는다.

```sql
CREATE EXTERNAL LOCATION prod_bucket
  URL 's3://my-company-prod-data/'
  WITH (STORAGE CREDENTIAL prod_cred);
```

이 둘을 만들었다고 아무나 그 경로에 접근할 수 있는 게 아니다. External Location 자체에도 GRANT를 걸어야 하고, 클라우드 쪽에서도 그 IAM Role이 Databricks 계정을 신뢰하도록 trust policy를 맞춰줘야 한다(Databricks 계정 ID와 external ID를 조건으로 건 assume-role 정책). 이 신뢰 관계 설정이 안 맞으면 Storage Credential을 아무리 잘 만들어도 `AccessDenied`만 반복해서 나온다. 클라우드 콘솔의 IAM 설정과 Databricks 쪽 설정이 항상 쌍으로 맞아야 하는 지점이다.

## 7. Lineage는 공짜로 따라온다

Delta 테이블이 다른 Delta 테이블에서 어떻게 만들어졌는지, Unity Catalog는 코드를 따로 심지 않아도 쿼리 실행 이력에서 자동으로 추적한다.

```python
# gold_customer_summary가 silver_orders에서 나왔다는 관계는
# 이 코드를 실행하는 순간 Unity Catalog가 자동으로 기록한다
spark.table("prod.sales.silver_orders") \
    .groupBy("customer_id").sum("amount") \
    .write.saveAsTable("prod.sales.gold_customer_summary")
```

Catalog Explorer에서 테이블을 열면 Lineage 탭에 상류(upstream)/하류(downstream) 테이블이 그래프로 뜬다. 시스템 테이블로도 조회할 수 있다.

```sql
SELECT source_table_full_name, target_table_full_name
FROM system.access.table_lineage
WHERE target_table_full_name = 'prod.sales.gold_customer_summary';
```

이 lineage는 Spark 잡을 통해 쓰인 경우에만 잡힌다. 외부 도구가 JDBC로 직접 데이터를 밀어 넣거나 `COPY INTO` 밖의 경로로 파일을 얹으면 그 경로는 계보 그래프에 안 남는다. "이 테이블이 어디서 왔는지 안 보인다"는 문제가 생기면 그 데이터가 Spark 쓰기 경로를 안 거쳤을 가능성부터 확인한다.

## 8. 감사 로그로 누가 뭘 봤는지 추적하기

권한을 아무리 세밀하게 걸어도, 누가 언제 무엇을 했는지 기록이 안 남으면 사고가 난 뒤에 원인을 못 찾는다. Unity Catalog는 모든 접근을 시스템 테이블에 쌓는다.

```sql
SELECT event_time, user_identity.email, action_name, request_params
FROM system.access.audit
WHERE request_params.full_name_arg = 'prod.sales.customers'
  AND event_time > current_timestamp() - INTERVAL 7 DAYS
ORDER BY event_time DESC;
```

`action_name`에 `getTable`, `deleteTable`, `updatePermissions` 같은 값이 찍히기 때문에, 특정 테이블 권한이 누구에 의해 언제 바뀌었는지도 그대로 조회된다. 개인정보가 걸린 테이블은 이 감사 로그 조회 자체를 대시보드로 만들어서 주기적으로 이상 접근 패턴(예: 평소 안 쓰던 계정이 새벽에 대량 조회)을 확인하는 용도로 쓴다.

## 9. Hive Metastore에서 넘어올 때 생기는 일

기존에 Hive Metastore로 운영하던 테이블을 Unity Catalog로 옮길 때, 그냥 새 catalog에 같은 이름으로 테이블을 다시 만들면 안 된다. 데이터를 다시 복사하는 건 낭비고, 원본과 물리적으로 분리돼서 두 테이블이 따로 논다.

Delta 테이블이면 `SYNC`로 메타데이터만 등록하고 실제 파일은 그대로 참조하게 할 수 있다.

```sql
SYNC TABLE prod.sales.orders FROM hive_metastore.sales.orders;
```

이건 파일을 복사하지 않고 기존 파일 위치를 가리키는 새 Unity Catalog 테이블 항목을 만드는 것이다. 문제는 원본이 managed table이 아니라 external table(경로가 사람이 지정한 임의 위치)인 경우, 그 경로에 대한 External Location이 먼저 등록돼 있어야 `SYNC`가 성공한다는 점이다. 마이그레이션 순서를 Storage Credential/External Location부터 잡지 않고 테이블 이관부터 시도하면 중간에 막힌다.

`hive_metastore`라는 이름의 catalog는 Unity Catalog 안에서 레거시 메타스토어를 그대로 보여주는 특수한 카탈로그다. 여기엔 Unity Catalog의 권한 모델(GRANT/row filter/lineage)이 전혀 적용되지 않는다. 마이그레이션이 덜 끝난 과도기에는 어떤 테이블이 `hive_metastore.*`에 남아 있고 어떤 게 넘어갔는지 헷갈리기 쉬운데, 이걸 추적하려면 `SHOW TABLES IN hive_metastore.<schema>`로 남은 테이블을 주기적으로 확인하는 수밖에 없다.

## 10. Delta Sharing으로 조직 밖에 데이터 내주기

파트너사에 데이터를 넘겨야 하는데, 파일을 복사해서 S3 버킷을 따로 만들어주거나 정기적으로 CSV를 이메일로 보내는 방식은 데이터가 최신 상태로 유지가 안 되고 보안 통제도 느슨해진다. Delta Sharing은 파일을 복사하지 않고 원본 Delta 테이블을 그대로 읽기 권한만 내주는 오픈 프로토콜이다.

```sql
CREATE SHARE partner_share;
ALTER SHARE partner_share ADD TABLE prod.sales.orders;

CREATE RECIPIENT partner_co USING ID '<partner의 sharing identifier>';
GRANT SELECT ON SHARE partner_share TO RECIPIENT partner_co;
```

받는 쪽이 Databricks 사용자가 아니어도 된다. Delta Sharing 커넥터가 있는 Pandas, Spark, PowerBI 어디서든 이 공유를 그대로 읽을 수 있다. 원본 테이블이 갱신되면 받는 쪽도 새로 쿼리하는 순간 최신 데이터를 본다. 대신 공유 범위를 테이블 단위로만 잘게 쪼개지 않으면, 파트너에게 필요 이상으로 넓은 스키마를 통째로 내주는 실수를 하기 쉽다. 공유할 컬럼만 뽑은 뷰를 만들어서 그 뷰를 공유하는 편이 안전하다.
