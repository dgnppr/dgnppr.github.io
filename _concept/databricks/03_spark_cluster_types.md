---
layout  : concept
title   : Spark 클러스터 종류
date    : 2026-09-01 00:00:00 +0900
updated : 2026-09-01 00:00:00 +0900
tag     : databricks spark cluster
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
  - { type: references, target: /concept/databricks/02_delta_lake_transaction_log }
---

* TOC
{:toc}

## 1. 클러스터 = 드라이버 + 워커

Spark 클러스터는 VM 묶음이다. 드라이버 노드가 코드를 해석하고 작업을 스케줄링하고(1대), 워커 노드가 실제 연산을 돌린다(N대, autoscaling 대상). 노트북 하나가 클러스터 하나에 붙어서 실행된다.

## 2. All-Purpose Cluster vs Job Cluster

| | All-Purpose Cluster | Job Cluster |
|---|---|---|
| 생성 시점 | 수동으로 만들어 계속 켜둠 | Job 실행 시작할 때 자동 생성, 끝나면 자동 종료 |
| 용도 | 노트북으로 탐색·개발 | 스케줄된 프로덕션 파이프라인 |
| 공유 | 여러 사람이 같이 붙어 쓸 수 있음 | 그 실행 하나 전용 |
| 비용 | idle 시간도 과금될 수 있어 비쌈 | DBU 단가 자체가 낮고 안 쓰면 존재하지 않으니 저렴 |

운영 파이프라인은 거의 항상 Job Cluster를 쓴다. All-Purpose Cluster를 프로덕션 스케줄에 그대로 물려두면 그 클러스터가 켜져 있는 내내 idle 시간까지 과금되고, 여러 Job이 한 클러스터를 공유하면 한 Job이 메모리를 다 먹어서 다른 Job이 실패하는 noisy neighbor 문제도 생긴다.

## 3. 클러스터 접근 모드

Unity Catalog가 나온 이후로 중요해진 개념이다. Single User는 한 명 전용이라 뭐든 되지만 격리가 없다. Shared는 여러 명이 붙어 쓰되 Unity Catalog 권한으로 사용자별 데이터 격리가 되는 대신, 프로세스 격리 오버헤드 때문에 RDD API 같은 일부 기능이 막힌다.

거버넌스가 강조된 문제에서는 Shared 모드가 답인 경우가 많다.

## 4. Autoscaling

워커 수를 min~max로 지정하면 부하에 따라 자동으로 늘고 준다. 피크 때만 자원을 늘려서 비용을 아낄 수 있다.

다만 스트리밍은 스케일 조정 자체에 재분배 비용이 들어서, 처리량이 안정적이면 고정 크기 클러스터가 더 나을 때도 많다.

## 5. Cluster Pools

클러스터를 새로 만들 때마다 VM 프로비저닝에 몇 분씩 걸린다. Pool은 미리 대기 상태로 VM을 띄워두고 Job Cluster가 여기서 즉시 빌려 쓰고 반납하는 방식이다. 자주 뜨고 죽는 Job Cluster의 콜드 스타트를 줄여준다.

## 6. Cluster Policy

관리자가 "이 팀은 이 인스턴스 타입, 이 워커 수까지만" 하고 제약을 거는 템플릿. 비용 통제와 거버넌스가 목적이고, 일반 사용자는 정책이 허용하는 범위 안에서만 설정을 건드릴 수 있다.

## 7. Photon

Databricks가 만든 C++ 기반 벡터화 쿼리 엔진. 기존 JVM 기반 실행 엔진을 대체해서 SQL/DataFrame 연산이 훨씬 빨라진다. 클러스터 만들 때 체크박스 하나로 켤 수 있고, UDF처럼 Photon이 못 뚫는 연산은 기존 엔진으로 자동 폴백된다.

## 8. DBU 감 잡기

Databricks 비용은 클라우드 인프라 비용(VM)이랑 DBU 비용(소프트웨어 라이선스)을 더한 것이다. DBU 단가는 클러스터 종류(대체로 All-Purpose > Job > SQL Warehouse 순으로 비쌈)랑 워크로드 타입마다 다르다. 비용 최적화 문제가 나오면 일단 더 싼 클러스터 타입으로 바꿀 수 있는지부터 의심하면 된다.

## 9. 인스턴스 타입 고르는 감

셔플이 많은 조인·집계는 메모리 비중 높은 타입, 단순 필터·변환은 코어 수 위주 저렴한 타입, ML 학습은 GPU 인스턴스, Delta 캐시를 많이 쓰면 로컬 SSD 넉넉한 타입을 고른다.

드라이버는 보통 워커보다 한 단계 넉넉하게 준다. 결과 수집, 브로드캐스트 변수 배포, 쿼리 플래닝을 드라이버가 담당해서 워커보다 메모리 부족으로 죽기 쉽다(Driver OOM).

## 10. Spot 인스턴스

워커는 Spot 인스턴스로 띄워서 비용을 크게 줄일 수 있다. 대신 클라우드가 언제든 회수할 수 있고, 회수되면 그 워커가 하던 작업은 재시도된다.

드라이버는 절대 Spot으로 두지 않는다. 드라이버가 죽으면 Job 전체가 죽는다. 워커는 Spot, 드라이버는 On-Demand로 섞는 게 표준 패턴이다.

## 11. Serverless

Job Cluster도 결국 몇 대, 어떤 타입인지 사람이 정해야 한다. Serverless Compute는 이 결정을 Databricks한테 넘기는 것이다. 코드만 제출하면 인프라 사이징은 알아서 한다. 콜드 스타트가 거의 없어서 즉시 실행돼야 하는 애드혹 쿼리에 잘 맞는다. 대신 인스턴스 타입 제어권은 포기해야 한다.

## 12. 스트리밍이랑 클러스터

Structured Streaming Job은 보통 Job Cluster를 계속 켜둔 채로 돌린다. Autoscaling을 켜도 트리거마다 노드 수가 바뀌면 재분배 비용이 드니까, 처리량이 안정적인 스트림은 고정 크기 클러스터가 더 예측 가능하다.

Trigger.AvailableNow로 배치처럼 한 번에 몰아 처리하고 끄면, 스트리밍 코드를 배치 비용 구조로 돌리는 것도 가능하다.

## 13. Job 클러스터를 Jobs API JSON으로 정의하기

Databricks Workflows에서 Job Cluster는 태스크 안에 `new_cluster`로 인라인 정의한다.

```json
{
  "tasks": [
    {
      "task_key": "silver_transform",
      "notebook_task": {
        "notebook_path": "/Repos/prod/pipelines/silver_orders"
      },
      "new_cluster": {
        "spark_version": "15.4.x-scala2.12",
        "node_type_id": "i3.xlarge",
        "driver_node_type_id": "i3.xlarge",
        "num_workers": 4,
        "aws_attributes": {
          "availability": "SPOT_WITH_FALLBACK",
          "first_on_demand": 1
        },
        "spark_conf": {
          "spark.databricks.delta.optimizeWrite.enabled": "true"
        }
      }
    }
  ]
}
```

`first_on_demand: 1`은 드라이버를 포함한 첫 1대는 On-Demand로 고정하고 나머지 워커부터 Spot을 섞겠다는 뜻이다. 10장에서 말한 "드라이버는 Spot 금지" 원칙이 실제 설정값으로 이렇게 나타난다.

## 14. Auto Loader 스트리밍 인제스천 코드

```python
(spark.readStream
    .format("cloudFiles")
    .option("cloudFiles.format", "json")
    .option("cloudFiles.schemaLocation", "/mnt/checkpoints/orders/schema")
    .load("/mnt/raw/orders/")
  .writeStream
    .format("delta")
    .option("checkpointLocation", "/mnt/checkpoints/orders/")
    .trigger(availableNow=True)
    .table("bronze.orders"))
```

`trigger(availableNow=True)`가 12장에서 말한 "스트리밍을 배치처럼 돌리는" 실제 문법이다. Job Cluster가 이 코드를 실행하면 밀린 새 파일을 다 처리하고 나서 스스로 종료한다. 그래서 상시 클러스터가 필요 없는 Job Cluster랑 궁합이 좋다.

## 15. Auto Loader가 재시작에도 안전한 이유

`trigger(availableNow=True)`로 Job Cluster를 30분마다 띄웠다 내리는 구성에서 걱정되는 건 "중간에 죽으면 파일을 두 번 처리하거나 빼먹지 않을까"다.

Auto Loader는 `cloudFiles.schemaLocation`과 `checkpointLocation` 두 곳에 상태를 쓴다. 어떤 파일을 이미 처리했는지는 체크포인트의 RocksDB 기반 파일 목록(또는 클라우드 알림 기반이면 큐 오프셋)에 기록되고, 이 기록은 각 파일이 Delta 테이블에 커밋된 것과 같은 트랜잭션 경계 안에서 갱신된다. 그래서 Job이 파일을 읽다가 중간에 죽어도, 재시작하면 마지막으로 성공적으로 커밋된 지점부터 이어서 처리한다. 같은 파일을 두 번 Delta에 쓰는 일은 없다.

체크포인트 디렉터리를 실수로 지우거나 다른 파이프라인과 공유하면 이 보장이 깨진다. 파일 하나에 스트림 하나, 체크포인트 경로도 하나로 1:1을 지키는 게 원칙이다.

## 16. AQE와 셔플 튜닝

Adaptive Query Execution(AQE)은 쿼리를 실행하다가 실제 셔플 데이터 크기를 보고 실행 계획을 런타임에 다시 짜는 기능이다. Databricks Runtime에서는 기본 켜져 있다.

```python
spark.conf.get("spark.sql.adaptive.enabled")               # True (기본값)
spark.conf.get("spark.sql.adaptive.coalescePartitions.enabled")  # True
```

`coalescePartitions`는 셔플 후 파티션이 너무 잘게 쪼개졌을 때 자동으로 합쳐서 작은 파일/작은 태스크가 남발되는 걸 막는다. 예전처럼 `spark.sql.shuffle.partitions`를 200으로 고정해놓고 데이터 크기에 안 맞아 고생하던 문제를 AQE가 상당 부분 해결해준다. 그래도 데이터가 극단적으로 크거나 작으면 이 값을 수동으로 조정해야 할 때가 있다.

## 17. 브로드캐스트 조인과 스큐 조인 처리

작은 테이블과 큰 테이블을 조인할 때, 작은 쪽을 모든 워커에 통째로 복사해서 셔플 자체를 없애는 게 브로드캐스트 조인이다.

```python
from pyspark.sql.functions import broadcast

result = big_df.join(broadcast(small_df), "customer_id")
```

```python
spark.conf.get("spark.sql.autoBroadcastJoinThreshold")   # 기본 10MB, -1이면 비활성화
```

기본 임계값(10MB)보다 작은 테이블은 힌트 없이도 자동으로 브로드캐스트된다. 문제는 큰 테이블끼리 조인인데 특정 키 값에 데이터가 몰려있는 스큐(skew) 상황이다. 이때는 AQE의 `skewJoin` 최적화가 스큐가 심한 파티션만 자동으로 잘게 쪼개서 처리한다.

```python
spark.conf.get("spark.sql.adaptive.skewJoin.enabled")   # True (기본값)
```

Spark UI에서 특정 태스크 하나만 나머지보다 몇 배 오래 걸리고 있다면 스큐부터 의심한다. AQE의 `skewJoin`은 자동으로 큰 파티션을 잘라주지만 항상 되는 건 아니고, 조인 키 자체가 심하게 편중된 경우(예: `customer_id`가 NULL이거나 특정 값 하나에 전체의 절반이 몰림)에는 salting을 직접 걸어야 한다. 조인 키에 랜덤 접미사를 붙여 인위적으로 파티션을 쪼개는 방식이다.

```python
from pyspark.sql.functions import concat, lit, floor, rand

salted_big = big_df.withColumn(
    "salted_key", concat(col("customer_id"), lit("_"), (rand() * 10).cast("int"))
)
salted_small = small_df.withColumn(
    "salted_key", concat(col("customer_id"), lit("_"), explode(array(*[lit(i) for i in range(10)])))
)
result = salted_big.join(salted_small, "salted_key")
```

작은 쪽 테이블을 salt 값 개수만큼 복제(`explode`)해서 큰 쪽의 salted key와 맞춘 뒤 조인하는 방식이다. 코드가 지저분해지는 대신 편중된 키 하나가 파티션 하나를 독점하는 상황을 물리적으로 깬다.

## 18. Structured Streaming 워터마크·상태 집계

스트리밍에서 시간 윈도우 집계를 하려면 "언제까지 기다렸다가 그 윈도우를 확정할지"를 정해야 한다. 그게 워터마크다.

```python
from pyspark.sql.functions import window, col

(spark.readStream.table("bronze.events")
    .withWatermark("event_time", "10 minutes")
    .groupBy(window(col("event_time"), "5 minutes"), col("user_id"))
    .count()
    .writeStream
    .format("delta")
    .outputMode("append")
    .option("checkpointLocation", "/mnt/checkpoints/sessions/")
    .table("gold.user_5min_counts"))
```

`withWatermark("event_time", "10 minutes")`는 "이벤트 시간 기준으로 최대 10분 늦게 도착하는 데이터까지는 기다려준다"는 뜻이다. 10분이 지나면 그 윈도우는 확정되고 상태(state)에서 정리된다. 그래야 상태 저장소가 무한정 커지지 않는다.

`outputMode`는 세 가지다. `append`는 확정된 결과만 내보내고(워터마크 필수), `update`는 바뀐 집계만, `complete`는 전체 결과를 매번 다시 내보낸다(작은 집계에만 현실적).

체크포인트(`checkpointLocation`)는 상태 저장소와 처리한 오프셋을 함께 관리해서, Job이 죽었다 재시작해도 중복/누락 없이 이어서 처리하게 해준다. Structured Streaming이 exactly-once를 보장하는 메커니즘이 바로 이거다.

## 19. 워터마크보다 늦은 데이터는 그냥 버려진다

워터마크는 "이 시점까지는 기다려준다"는 약속이지, 그 이후 도착한 데이터를 어딘가에 따로 보관해주는 기능이 아니다. `withWatermark("event_time", "10 minutes")`로 설정한 상태에서 워터마크가 이미 지나간 윈도우에 속하는 이벤트가 뒤늦게 들어오면, 그 이벤트는 집계에 반영되지 않고 조용히 드롭된다. 에러도 안 나고 로그에도 잘 안 남아서, "왜 이 사용자 세션 카운트가 실제보다 적게 나오지"를 며칠 뒤에나 알아채는 경우가 흔하다.

이걸 확인하려면 드롭된 행 수를 직접 세야 한다.

```python
from pyspark.sql.functions import current_timestamp

late_events = (spark.readStream.table("bronze.events")
    .withWatermark("event_time", "10 minutes")
    .filter(col("event_time") < current_timestamp() - expr("INTERVAL 10 MINUTES")))
# 이 스트림을 별도 Delta 테이블(dead-letter 성격)로 따로 적재해서 얼마나 늦게 오는지 모니터링한다
```

상태 저장소 자체도 무한정 커지지 않는 이유는 워터마크가 지난 윈도우의 상태를 Spark가 명시적으로 정리(state cleanup)하기 때문이다. 이 상태는 기본적으로 executor 로컬 디스크에 RocksDB로 저장되는데(`spark.sql.streaming.stateStore.providerClass`), 윈도우 크기와 워터마크 유예 기간을 늘릴수록 정리 전까지 쌓이는 상태 크기도 커진다. 세션 윈도우가 많고 워터마크를 길게 잡는 파이프라인일수록 executor 디스크 용량을 넉넉히 잡아야 하는 이유다.
