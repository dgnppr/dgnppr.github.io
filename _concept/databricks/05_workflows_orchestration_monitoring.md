---
layout  : concept
title   : Databricks Workflows로 여러 태스크 오케스트레이션하고 모니터링하기
date    : 2026-09-05 00:00:00 +0900
updated : 2026-09-05 00:00:00 +0900
tag     : databricks workflows jobs monitoring
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

## 1. 노트북 하나짜리 Job으로는 부족해지는 시점

파이프라인이 Bronze 적재 하나뿐이면 노트북 하나를 스케줄에 물리면 끝난다. 문제는 Silver 변환이 Bronze 적재 완료를 기다려야 하고, Gold 집계는 Silver를 기다려야 하고, 실패했을 때 어디서부터 재시도할지가 갈리기 시작하는 순간이다. 노트북 안에서 `dbutils.notebook.run()`으로 다른 노트북을 순차 호출하는 방식도 되긴 하지만, 이건 호출한 노트북이 죽으면 전체가 통째로 죽고, 실패한 단계만 골라 재실행하는 것도 안 된다.

Databricks Workflows(Jobs)는 이 의존성 자체를 태스크 그래프로 선언한다. 태스크마다 성공/실패가 따로 기록되고, 실패한 태스크만 다시 돌릴 수 있다.

## 2. 태스크 의존성으로 DAG 만들기

```json
{
  "tasks": [
    { "task_key": "bronze_ingest", "notebook_task": { "notebook_path": "/pipelines/bronze" } },
    { "task_key": "silver_transform", "depends_on": [{ "task_key": "bronze_ingest" }],
      "notebook_task": { "notebook_path": "/pipelines/silver" } },
    { "task_key": "gold_aggregate", "depends_on": [{ "task_key": "silver_transform" }],
      "notebook_task": { "notebook_path": "/pipelines/gold" } }
  ]
}
```

`depends_on`이 없는 태스크는 병렬로 바로 시작한다. 하나의 태스크가 여러 태스크에 의존할 수도 있고(팬인), 여러 태스크가 하나에 의존할 수도 있다(팬아웃). Gold 집계가 두 개의 서로 다른 Silver 테이블을 조인해서 만들어진다면, `gold_aggregate`가 `silver_orders`와 `silver_customers` 둘 다를 `depends_on`으로 걸면 된다.

## 3. 태스크 타입은 노트북만이 아니다

`notebook_task` 말고도 여러 타입이 있고, 실제 운영 파이프라인은 이걸 섞어서 쓴다.

`python_wheel_task`는 패키징된 Python 라이브러리의 엔트리포인트를 직접 호출한다. 노트북이 아니라 일반 Python 패키지로 배포된 코드를 그대로 Job에 태울 수 있다. `sql_task`는 노트북 없이 SQL 쿼리나 대시보드 갱신만 실행한다. `dbt_task`는 dbt 프로젝트의 `dbt run`을 Job 안에서 그대로 돌린다. `run_job_task`는 다른 Job을 태스크로 호출한다. 팀마다 따로 관리하는 Job을 상위 오케스트레이션 Job에서 순서대로 부를 때 쓴다. `condition_task`는 분기다. 이전 태스크의 값이나 파라미터를 조건으로 두고 참/거짓에 따라 다음 태스크를 갈라 태운다. `for_each_task`는 같은 태스크를 리스트의 원소마다 병렬로 반복 실행한다. 매장별로 같은 변환을 돌려야 하는데 매장 수가 매번 바뀐다면, 매장 목록을 파라미터로 받아 `for_each_task`로 팬아웃하는 게 태스크를 매장 수만큼 하드코딩하는 것보다 낫다.

## 4. Task Values로 태스크 사이에 값 넘기기

의존 관계만으로는 부족하다. Bronze 태스크가 이번에 몇 건을 적재했는지 알아야 Silver 태스크가 그 값을 근거로 분기하고 싶을 때가 있다.

```python
# bronze_ingest 태스크 안에서
row_count = df.count()
dbutils.jobs.taskValues.set(key="ingested_rows", value=row_count)
```

```python
# silver_transform 태스크 안에서
count = dbutils.jobs.taskValues.get(taskKey="bronze_ingest", key="ingested_rows", default=0)
if count == 0:
    dbutils.notebook.exit("no new rows, skipping silver transform")
```

`taskValues`는 노트북 리턴값 하나만 넘기는 `dbutils.notebook.exit()`보다 유연하다. 여러 키를 따로 저장하고, 뒤에 오는 어떤 태스크에서든 `taskKey`로 지정해서 꺼내 쓸 수 있다. 다만 이 값은 태스크 실행이 끝난 뒤 잠깐 유지되는 것이지 영구 저장소가 아니다. 다음 Job 실행에서 지난 실행 값을 참조하고 싶으면 Delta 테이블에 따로 적재해야 한다.

## 5. 재시도와 타임아웃

```json
{
  "task_key": "silver_transform",
  "max_retries": 2,
  "min_retry_interval_millis": 60000,
  "retry_on_timeout": true,
  "timeout_seconds": 3600
}
```

일시적인 네트워크 오류나 클라우드 스토리지 스로틀링으로 실패하는 태스크는 재시도 몇 번으로 대부분 해결된다. 문제는 `min_retry_interval_millis` 없이 재시도 간격을 0으로 두면, 원인이 스로틀링일 때 재시도가 오히려 같은 스로틀링을 더 자주 건드려서 계속 실패하는 역효과가 난다. 재시도 간격을 최소 분 단위로 두는 게 스로틀링성 실패에는 맞다. `timeout_seconds`는 태스크가 멈춘 것도 아니고 끝난 것도 아닌 채로 무한정 도는 상황(예: 브로드캐스트 조인 크기 오판으로 셔플이 끝없이 도는 경우)에 강제 종료하는 안전장치다. 이 값이 없으면 잘못된 쿼리 플랜 하나가 다음 스케줄까지 클러스터를 붙잡고 있을 수 있다.

## 6. Repair Run으로 실패한 태스크만 다시 돌리기

Gold 집계 태스크만 실패하고 Bronze/Silver는 이미 성공했는데, Job을 처음부터 다시 돌리면 이미 끝난 단계까지 다시 실행하느라 시간과 비용이 낭비된다.

```bash
databricks jobs run-now --job-id 12345 --repair-run
```

Repair Run은 실패했거나 건너뛴 태스크만 골라 재실행하고, 성공한 태스크의 결과는 그대로 둔다. 이게 되려면 각 태스크가 멱등적이어야 한다. Silver 태스크가 `MERGE INTO`처럼 재실행해도 같은 결과가 나오는 방식으로 짜여 있어야지, `INSERT`로 매번 새 행을 덧붙이는 방식이면 Repair Run으로 같은 배치를 두 번 적재하게 된다. Workflows의 재실행 편의성은 결국 태스크 하나하나가 멱등적으로 짜여 있다는 전제 위에서만 작동한다.

## 7. Job Parameter로 실행마다 다른 값 주입하기

```json
{
  "parameters": [
    { "name": "run_date", "default": "{{job.trigger.time.iso_date}}" }
  ]
}
```

```python
run_date = dbutils.widgets.get("run_date")
```

같은 Job 정의를 매일 다른 날짜로 돌리거나, 수동으로 특정 날짜를 지정해서 백필을 돌릴 때 이 파라미터를 바꿔서 실행한다. `{{job.trigger.time.iso_date}}` 같은 동적 값 참조를 기본값으로 걸어두면, 스케줄 실행일 땐 자동으로 오늘 날짜가 들어가고 수동 실행일 땐 사람이 다른 값을 넣어 특정 날짜만 다시 돌릴 수 있다.

## 8. 실패 알림 라우팅

```json
{
  "email_notifications": {
    "on_failure": ["data-eng-oncall@company.com"]
  },
  "webhook_notifications": {
    "on_failure": [{ "id": "<slack-webhook-id>" }]
  }
}
```

이메일 알림은 사람이 메일함을 안 보면 그대로 묻힌다. 실제 온콜 대응이 걸린 파이프라인은 webhook으로 Slack이나 PagerDuty에 바로 꽂는다. 알림을 Job 레벨(`on_failure`)에만 걸어두면 어떤 태스크가 실패했는지는 알림 본문에서 태스크 키를 봐야 알 수 있다. 여러 태스크로 이루어진 큰 Job일수록, 어느 태스크가 죽었는지 한눈에 보이도록 알림 채널을 태스크 성격별로 나눠 구성하는 게 사고 대응 속도에 실질적으로 영향을 준다.

## 9. job_cluster_key로 Job Cluster 재사용하기

태스크마다 `new_cluster`를 따로 정의하면 태스크 수만큼 클러스터가 뜨고 내려간다. 태스크 사이에 클러스터를 공유하고 싶으면 `job_clusters`에 한 번 정의하고 각 태스크가 `job_cluster_key`로 참조한다.

```json
{
  "job_clusters": [
    { "job_cluster_key": "shared_cluster",
      "new_cluster": { "spark_version": "15.4.x-scala2.12", "num_workers": 4 } }
  ],
  "tasks": [
    { "task_key": "silver_transform", "job_cluster_key": "shared_cluster", "notebook_task": {...} },
    { "task_key": "gold_aggregate", "job_cluster_key": "shared_cluster", "notebook_task": {...} }
  ]
}
```

클러스터 하나를 공유하면 프로비저닝 시간이 한 번만 들어서 전체 실행 시간이 짧아진다. 대신 한 태스크가 메모리를 과하게 먹으면 같은 클러스터를 쓰는 다른 태스크까지 영향을 받는다. 태스크 성격이 크게 다르면(작은 룩업 쿼리 하나와 대용량 셔플 조인을 같은 Job 안에 같이 둘 때) 클러스터를 나누는 편이 격리 측면에서 낫다.

## 10. 시스템 테이블로 Job 실행 이력 조회하기

Job 실행 성공률이나 평균 소요 시간을 매번 UI에서 하나씩 확인하는 건 파이프라인이 몇 개만 넘어가도 안 된다. Unity Catalog가 활성화된 계정은 Job 실행 이력도 시스템 테이블로 조회할 수 있다.

```sql
SELECT job_id, run_id, result_state, period_start_time, period_end_time
FROM system.lakeflow.job_run_timeline
WHERE period_start_time > current_timestamp() - INTERVAL 7 DAYS
  AND result_state = 'FAILED';
```

실패율이 높은 Job이나 실행 시간이 점점 길어지는 Job을 이 테이블 하나로 추려낼 수 있다. 정확한 스키마와 테이블명은 Databricks Runtime 버전에 따라 바뀔 수 있어서, 실제로 쓰기 전에는 `SHOW TABLES IN system.lakeflow`로 계정에서 실제 노출되는 테이블명부터 확인하는 게 안전하다. 이 시스템 테이블 자체도 Unity Catalog의 securable object라서, `system` catalog에 대한 `USE CATALOG`/`USE SCHEMA` 권한이 없으면 조회가 막힌다는 점은 4장에서 다룬 권한 계단식 상속 문제와 똑같이 적용된다.

## 11. Cluster Event Log로 "왜 죽었는지" 추적하기

Job 실행이 실패했을 때 노트북 셀 에러 메시지만 보고는 원인을 못 찾는 경우가 있다. 클러스터 자체가 스팟 회수로 워커를 잃었거나, 오토스케일링이 과부하 상태에서 응답을 못 해서 전체가 타임아웃된 경우다. 이런 건 Job 실행 로그가 아니라 클러스터의 Event Log에 남는다.

Cluster 상세 화면의 Event Log 탭에서 `NODE_LOST`, `DRIVER_NOT_RESPONDING`, `AUTOSCALING_STATS_REPORT` 같은 이벤트를 보면, 코드 문제가 아니라 인프라 문제였다는 걸 구분할 수 있다. 3장에서 다룬 Spot 워커 회수가 실제로 파이프라인을 죽인 경우, 애플리케이션 로그만 봐서는 "태스크가 갑자기 사라졌다"로만 보이고, Event Log를 봐야 회수 이벤트와 실패 시각이 일치하는 걸 확인할 수 있다.

## 12. 알림에서 대시보드로 넘어가야 반복되는 실패가 잡힌다

같은 Job이 매주 한 번씩 타임아웃으로 실패하는데 매번 사람이 Repair Run만 눌러서 넘긴다면, 그건 알림 체계가 아니라 파이프라인 설계가 문제라는 신호다. `system.lakeflow.job_run_timeline`을 실행 시간 추이로 시각화해두면, 실행 시간이 서서히 늘어나다 타임아웃 임계값을 넘기는 패턴(대체로 소스 데이터량 증가나 OPTIMIZE 누락으로 인한 작은 파일 누적)을 장애가 터지기 전에 미리 잡을 수 있다. 실패 알림은 사고 대응용이고, 실행 이력 대시보드는 사고를 예방하는 용도라는 점에서 둘의 목적이 다르다.
