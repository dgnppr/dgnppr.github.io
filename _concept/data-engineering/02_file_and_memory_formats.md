---
layout      : concept
title       : 파일과 메모리 형식 (CSV·Parquet·Avro·Arrow)
date        : 2026-08-01 00:00:00 +0900
updated     : 2026-08-01 00:00:00 +0900
tag         : parquet file-format data-engineering
toc         : true
comment     : true
latex       : true
status      : complete
public      : true
parent      : [[/data-engineering]]
confidence  : high
valid_from  : 2026-08-19
relations:
  - { type: references, target: /concept/data-engineering/01_lakehouse_table_formats }
  - { type: references, target: /concept/spark/00_what_is_pyspark }
---

* TOC
{:toc}

## 글을 쓰게 된 계기

데이터를 어떤 형식으로 저장할지 이야기할 때 Parquet, Avro, Arrow가 같은 층위에 놓인 선택지처럼 언급되는 경우를 자주 보았다. 나도 한동안 그렇게 이해했고, 그러다 보니 "Arrow가 Parquet보다 빠르면 그냥 Arrow로 저장하면 되지 않나" 같은 질문에서 막혔다.

정리해보니 이 형식들은 애초에 서로 다른 두 가지 질문에 답하고 있었다. 하나는 디스크나 네트워크로 데이터를 어떻게 내보낼 것인가이고, 다른 하나는 메모리에서 데이터를 어떻게 계산할 것인가이다. 앞쪽은 파일 크기와 I/O가 성능을 지배하고, 뒤쪽은 CPU 캐시와 명령어가 지배한다. 목표가 다르니 설계도 다를 수밖에 없다.

여기에 행 지향이냐 열 지향이냐 하는 축이 하나 더 붙는다. 이 두 축을 놓고 보면 각 형식이 왜 그렇게 생겼는지가 대체로 설명된다.

- 디스크·전송을 맡는 행 지향: CSV, JSON, Avro
- 디스크·전송을 맡는 열 지향: Parquet, ORC
- 메모리를 맡는 열 지향: Arrow

이 글에서는 각 형식이 무엇을 최적화하려고 그런 물리 구조를 갖게 되었는지 알아볼 것이다. 앞 글에서 다룬 [테이블 포맷](/concept/data-engineering/01_lakehouse_table_formats)은 이 계층 위에 얹히는 메타데이터이므로, Iceberg 테이블 안에 실제로 놓이는 데이터 파일은 여기서 다루는 Parquet다.

<br><br><br>

## 예제 데이터

설명이 추상적으로 흐르지 않도록 글 전체에서 같은 데이터를 쓰겠다. 주문 이벤트 네 행이다.

| order_id | country | amount | ts |
|---|---|---|---|
| 1001 | KR | 12000 | 2026-08-19T10:00:00 |
| 1002 | KR | 8500 | 2026-08-19T10:00:03 |
| 1003 | JP | 30000 | 2026-08-19T10:00:07 |
| 1004 | KR | 12000 | 2026-08-19T10:00:11 |

<br><br><br>

## CSV

```
order_id,country,amount,ts
1001,KR,12000,2026-08-19T10:00:00
1002,KR,8500,2026-08-19T10:00:03
...
```

CSV가 아직 널리 쓰이는 이유는 기술적으로 우수해서가 아니라 인터페이스 역할을 하기 때문이다. 엑셀과 구글 스프레드시트가 열고, 거의 모든 BI 도구가 받아들이고, 사람이 텍스트 에디터로 직접 확인할 수 있다. 데이터를 비기술 사용자에게 넘겨야 할 때 CSV보다 마찰이 적은 형식은 아직 없다. 이 용도라면 다른 형식을 고민할 필요가 없다.

문제가 되는 것은 이것을 파이프라인 중간 형식으로 쓸 때다.

- 타입이 없다. 모든 값이 문자열이므로 `007`이 `7`이 되고, 날짜인지 문자열인지는 읽는 쪽이 추측한다. 타입 추론은 보통 파일 앞부분 일부만 보고 결정하기 때문에 뒤에서 예외적인 값이 나오면 조용히 깨지거나 컬럼 전체가 문자열로 떨어진다.
- 스키마가 없다. 컬럼이 추가되거나 순서가 바뀌어도 파일 자체는 아무것도 알려주지 않는다. 헤더 한 줄이 계약의 전부다.
- 파싱이 비싸다. 텍스트를 숫자로 변환하는 비용이 생각보다 크고, 수십 GB 규모의 CSV를 읽는 잡은 대체로 파싱에서 병목이 잡힌다.
- 압축을 해도 열 단위가 아니다. gzip으로 감싸면 크기는 줄지만 gzip은 분할이 안 되기 때문에 10GB짜리 gzip CSV 하나는 Spark에서 태스크 하나로 읽힌다. 병렬성이 사라진다.
- 필요한 컬럼만 읽을 수 없다. `amount` 하나를 보려고 해도 파일 전체를 읽고 파싱해야 한다.
- 인용 규칙이 표준화되어 있지 않다. 값 안에 쉼표나 따옴표가 들어가면 도구마다 처리가 갈리고, 특히 값 안에 개행이 들어가면 "한 줄이 한 레코드"라는 전제가 깨진다. 그래서 파일을 바이트 오프셋으로 안전하게 쪼개는 것조차 어려워진다.

즉 CSV는 데이터가 시스템 밖으로 나갈 때 쓰는 형식이고, 시스템 안에서 저장하고 계산하는 용도로는 적합하지 않다.

<br><br><br>

## 행 지향과 열 지향

나머지 형식들의 차이는 결국 이 배치 방식에서 갈린다. 위 네 행을 실제 바이트 순서로 늘어놓으면 두 방식이 이렇게 달라진다.

행 지향은 한 레코드의 모든 필드를 붙여 놓는다.

```
[1001, KR, 12000, 10:00:00][1002, KR, 8500, 10:00:03][1003, JP, 30000, 10:00:07][1004, KR, 12000, 10:00:11]
```

열 지향은 같은 컬럼의 값을 붙여 놓는다.

```
order_id: [1001, 1002, 1003, 1004]
country : [KR, KR, JP, KR]
amount  : [12000, 8500, 30000, 12000]
ts      : [10:00:00, 10:00:03, 10:00:07, 10:00:11]
```

행 지향에서는 레코드 하나를 통째로 쓰거나 읽는 비용이 싸다. 반면 열 지향에서는 다음과 같은 이점이 생긴다.

- 필요한 컬럼만 읽을 수 있다. `amount`만 조회하면 `amount` 블록만 읽으면 되므로, 컬럼 100개 중 3개만 쓰는 분석 쿼리에서 I/O가 수십 배 줄어든다. 이를 projection pushdown이라 한다.
- 압축이 잘 된다. 같은 컬럼에는 같은 타입의 비슷한 값이 모이기 때문이다. `[KR, KR, JP, KR]`은 사전 인코딩으로 사전 `{0:KR, 1:JP}`와 인덱스 `[0,0,1,0]`이 되지만, 타입이 섞여 있는 행 지향 바이트열에는 이런 규칙성이 없다.
- CPU 효율이 좋다. 같은 타입 값이 연속으로 놓이면 캐시 적중률이 올라가고, SIMD 명령으로 여러 값을 한 번에 처리할 수 있다.

대가도 분명하다. 열 지향에서 레코드 하나를 쓰려면 컬럼 수만큼 떨어진 위치에 나누어 써야 한다. 그래서 열 지향은 한 번에 많이 쓰고 많이 읽는 배치 분석에 맞고, 한 건씩 흘려보내는 스트리밍에는 맞지 않는다. 뒤에서 볼 Avro가 여전히 행 지향인 이유가 여기에 있다.

<br><br><br>

## Apache Parquet

[Parquet](https://parquet.apache.org/)는 열 지향 파일 포맷이고, 지금 데이터 도구들 사이에서 공용 저장 형식 역할을 하고 있다. Spark, BigQuery, Trino, DuckDB, pandas, Polars 어디서 쓰고 어디서 읽어도 통한다.

### 내부 구조

Parquet는 파일을 통째로 컬럼별로 자르지 않는다. 먼저 행 방향으로 자른 다음, 그 안에서 컬럼별로 자른다.

```
파일
 ├─ Row Group 0  (예: 128MB 분량의 행 묶음)
 │    ├─ Column Chunk: order_id
 │    │    ├─ Page 0 (헤더 + 인코딩된 값들)
 │    │    └─ Page 1
 │    ├─ Column Chunk: country
 │    ├─ Column Chunk: amount
 │    └─ Column Chunk: ts
 ├─ Row Group 1
 └─ Footer   ← 스키마 + 각 Row Group / Column Chunk의 메타데이터
```

파일 끝의 footer에 스키마와 함께 각 Column Chunk의 오프셋, 컬럼별 min/max 값, null 개수가 들어 있다. 읽는 쪽은 footer만 먼저 읽고 어느 오프셋의 어느 바이트를 읽을지 결정한다. 그래서 두 가지가 가능해진다.

- 필요한 Column Chunk의 오프셋만 읽는다.
- 통계를 보고 읽지 않아도 되는 Row Group을 건너뛴다. 예를 들어 `WHERE amount > 50000` 조건에서 어떤 Row Group의 `amount` 최댓값이 30000이면 그 Row Group은 아예 열지 않는다. 이것을 predicate pushdown 또는 data skipping이라 부른다.

Row Group 크기가 튜닝 지점이 된다. 크게 잡으면 압축률과 스캔 효율이 좋아지지만 통계의 해상도가 떨어져 건너뛸 수 있는 범위가 줄고, 쓰는 쪽 메모리 사용량이 늘어난다. 작게 잡으면 그 반대가 된다. 보통 수십에서 수백 MB 사이를 쓴다.

### 인코딩

Parquet 파일이 작은 것은 snappy나 zstd 같은 범용 압축 이전에 컬럼별 인코딩이 먼저 적용되기 때문이다.

- 사전 인코딩(dictionary encoding)은 카디널리티가 낮은 컬럼에 쓴다. `country: [KR, KR, JP, KR]`이 사전 `{0:KR, 1:JP}`와 인덱스 `[0,0,1,0]`으로 바뀐다.
- RLE와 비트 패킹은 반복되는 값을 접고 필요한 비트 수만 사용한다. 위 인덱스는 값이 0과 1뿐이므로 2비트로 표현된다.
- 델타 인코딩은 증가하는 값에 쓴다. `ts`처럼 단조 증가하는 타임스탬프는 값 자체가 아니라 이전 값과의 차이를 저장한다.

이 때문에 파일을 쓸 때의 정렬 순서가 압축률과 data skipping 효율에 직접 영향을 준다. 필터 조건으로 자주 쓰는 컬럼을 기준으로 정렬해서 쓰면 각 Row Group의 min/max 범위가 좁아지므로 건너뛸 수 있는 Row Group이 늘어난다.

### 예제 코드

```python
import pyarrow as pa
import pyarrow.csv as pcsv
import pyarrow.parquet as pq

# pyarrow의 CSV 리더는 멀티스레드로 파싱하므로 pandas보다 빠르다
table = pcsv.read_csv("orders.csv")

pq.write_table(
    table, "orders.parquet",
    compression="zstd",        # snappy는 빠르고, zstd는 압축률과 속도가 균형, gzip은 느리다
    row_group_size=1_000_000,  # 행 기준. 컬럼 수와 폭에 맞춰 조정한다
)

# 필요한 컬럼과 조건만 지정하면 파일 전체를 읽지 않는다
filtered = pq.read_table(
    "orders.parquet",
    columns=["country", "amount"],
    filters=[("amount", ">", 10000)],
)
print(filtered.num_rows)
```

### ORC와의 관계

[Apache ORC](https://orc.apache.org/)도 같은 문제를 푸는 열 지향 포맷이다. Hive 생태계에서 나왔고, Parquet의 Row Group에 해당하는 단위를 stripe라고 부른다. 내부 구조와 그로부터 얻는 이점은 Parquet와 거의 같다.

실무에서 갈리는 지점은 기술보다 생태계다. Parquet는 Spark, Python, 클라우드 웨어하우스 전반에서 기본값으로 쓰이고, ORC는 Hive와 Trino 계열에서 강하며 ACID Hive 테이블과 잘 맞는다. 새로 시작한다면 특별한 이유가 없는 한 Parquet를 고르면 되고, 성능 차이는 워크로드와 튜닝에 묻히는 수준이다.

<br><br><br>

## Apache Avro

[Avro](https://avro.apache.org/)는 방향이 반대다. 행 지향 이진 형식이고, 강점은 압축률이 아니라 스키마 처리에 있다.

### 스키마가 형식의 일부다

Avro 파일은 헤더에 JSON 스키마를 직접 담는다. 파일이 자기 자신을 설명하는 구조다.

```json
{
  "type": "record",
  "name": "Order",
  "fields": [
    {"name": "order_id", "type": "long"},
    {"name": "country",  "type": "string"},
    {"name": "amount",   "type": "long"},
    {"name": "ts",       "type": {"type": "long", "logicalType": "timestamp-millis"}}
  ]
}
```

값은 필드 이름 없이 스키마에 정의된 순서대로 이진으로 기록된다. JSON처럼 키를 매 레코드마다 반복하지 않으므로 크기가 작고 파싱도 싸다.

### 스키마 진화

Avro는 쓰는 쪽의 스키마와 읽는 쪽의 스키마를 분리한다. 읽는 쪽이 자기 스키마를 가지고 와서 파일에 기록된 쓰기 스키마와 대조하며 변환해서 읽는데, 이를 schema resolution이라 한다. 여기서 두 방향의 호환성이 나온다.

기본값이 있는 필드를 추가하면, 예전 데이터를 읽는 새 리더가 그 필드를 기본값으로 채운다. 반대로 기본값이 있는 필드를 삭제하면, 새 데이터를 읽는 예전 리더가 그 필드를 무시한다.

이것이 중요한 이유는 Kafka 같은 환경에서 프로듀서와 컨슈머가 따로 배포된다는 점이다. 프로듀서가 필드를 하나 추가했다고 모든 컨슈머를 동시에 재배포할 수는 없다. Avro와 Schema Registry를 함께 쓰면 스키마는 레지스트리에 등록되고 메시지에는 스키마 ID만 실리는데, 레지스트리가 등록 시점에 호환성 규칙을 검사하기 때문에 호환되지 않는 스키마 변경은 배포 전에 막힌다.

Parquet도 컬럼 추가와 삭제 수준의 스키마 진화를 지원하지만, 규칙이 이만큼 명시적이지 않고 레코드 단위 전송에 맞춰져 있지도 않다.

### 어디에 쓰는가

Kafka 메시지 페이로드, 레코드를 한 건씩 append하는 로그성 쓰기, 컬럼 일부가 아니라 레코드 전체를 소비하는 경우에 적합하다.

반대로 분석 스캔에는 쓰지 않는 편이 좋다. 행 지향이라 필요한 컬럼만 읽을 수 없고 압축률도 Parquet에 미치지 못한다. 그래서 실무에서는 Kafka로 Avro를 흘려보내고 랜딩 영역에 그대로 쌓아둔 다음, 배치로 Parquet으로 변환해 테이블 포맷에 올리는 구성을 많이 쓴다.

<br><br><br>

## Apache Arrow

Arrow에서는 축이 바뀐다. Arrow는 파일 포맷이 아니라 인메모리 컬럼 형식의 표준이고, 목표가 작게 저장하는 것이 아니라 CPU가 빠르게 계산하고 프로세스 사이에 복사 없이 전달하는 것이다.

### Parquet를 메모리에 그대로 쓸 수 없는 이유

Parquet는 인코딩된 상태로 저장되어 있다. 사전 인코딩과 비트 패킹으로 눌려 있으므로 값 하나를 꺼내려 해도 디코딩이 필요하고, 값의 물리적 폭이 일정하지 않아서 i번째 값을 오프셋 계산만으로 집을 수 없다. 저장에 유리한 표현과 계산에 유리한 표현이 서로 다른 것이다.

Arrow는 계산 쪽을 택했고, 그 결과 다음과 같은 배치를 쓴다.

- 고정폭 타입은 고정폭 그대로 둔다. int64 컬럼은 8바이트씩 연속된 버퍼이므로 i번째 값의 위치가 `base + 8*i`로 바로 계산된다.
- null은 값 버퍼를 건드리지 않고 별도의 validity bitmap으로 관리한다. 행당 1비트를 쓴다.
- 문자열처럼 길이가 변하는 타입은 오프셋 버퍼와 데이터 버퍼로 나눈다. 오프셋만 보면 i번째 값의 시작과 끝을 알 수 있다.

이런 배치 덕분에 `SUM(amount)` 같은 연산이 SIMD로 여러 값을 한 번에 처리하고 캐시 라인을 낭비 없이 채울 수 있다.

### 복사 없는 전달

Arrow의 또 다른 목적은 직렬화 비용을 없애는 것이다. 전통적으로 pandas에서 Spark로, Python에서 JVM으로, 한 프로세스에서 다른 프로세스로 데이터를 넘기려면 매번 직렬화와 역직렬화를 거쳤고, 대용량에서는 이 변환이 실제 계산보다 비싼 경우가 많았다.

Arrow는 메모리 표현 자체가 표준이므로 같은 바이트 배치를 그대로 넘기면 되고 변환이 필요하지 않다. 이 표현을 파일이나 스트림으로 그대로 기록한 것이 Arrow IPC이고, gRPC 기반으로 네트워크 전송을 담당하는 것이 Arrow Flight다. Flight는 ODBC나 JDBC에 비해 대량 결과를 전송할 때 훨씬 빠르다.

```python
import pyarrow as pa
import pyarrow.parquet as pq

# Parquet를 읽은 결과가 곧 Arrow Table이다
table = pq.read_table("orders.parquet")

# pandas로 넘기기. Arrow 백엔드를 쓰면 복사 없이 참조로 간다
df = table.to_pandas(types_mapper=pa.ArrowDtype)

# Polars로 넘기기. 같은 Arrow 버퍼를 공유하므로 변환 비용이 없다
import polars as pl
pdf = pl.from_arrow(table)

# DuckDB로 넘기기. Arrow Table을 그대로 SQL로 질의할 수 있다
import duckdb
duckdb.sql("SELECT country, sum(amount) FROM table GROUP BY 1").show()
```

### Arrow 위에 서 있는 도구들

pandas는 2.0부터 Arrow를 선택적 백엔드로 쓸 수 있다. `dtype_backend="pyarrow"`를 지정하면 문자열 메모리 사용량과 null 처리가 개선되지만, 기본값은 여전히 NumPy 기반이다.

Polars와 Rust의 DataFusion은 처음부터 Arrow를 기반으로 설계되었고, DuckDB도 Arrow를 일급 인터페이스로 지원한다. PySpark의 경우 pandas UDF와 `toPandas()`가 JVM과 Python 사이 전송에 Arrow를 쓴다.

그래서 pandas에서 뽑은 데이터를 Polars로 넘기고 DuckDB로 질의하는 흐름이 복사 없이 이어진다. Arrow의 실질적인 가치는 개별 도구의 속도보다 도구 사이의 마찰을 없앤 데 있다고 보는 편이 맞다.

<br><br><br>

## Parquet와 Arrow의 관계

두 형식을 경쟁 관계로 보는 오해가 흔한데, 둘은 같은 사람들이 만들었고 역할을 의도적으로 나눈 것이다.

| | Parquet | Arrow |
|---|---|---|
| 사는 곳 | 디스크, object storage | 메모리 |
| 최적화 대상 | 파일 크기, I/O | CPU 사이클, 캐시, 전송 |
| 표현 | 인코딩·압축된 상태 | 압축하지 않고 고정폭 유지 |
| 크기 | 작다 | 크다. 원시 데이터보다 커질 수도 있다 |
| 임의 접근 | 디코딩 필요 | 오프셋 계산으로 바로 접근 |
| 수명 | 영속 | 프로세스 수명 |

일반적인 흐름은 이렇게 이어진다.

```
S3의 Parquet  ──읽기·디코딩──▶  메모리의 Arrow  ──연산──▶  Arrow  ──인코딩·쓰기──▶  Parquet
```

작은 파일로 저장하고 필요한 부분만 스캔하는 일은 Parquet가 맡고, 실제 계산과 프로세스 사이 전달은 Arrow가 맡는다. Arrow가 메모리를 많이 쓰는 것은 결함이 아니라 이 역할 분담에서 나온 설계 결과다.

<br><br><br>

## 어떤 것을 선택할까

| 상황 | 선택 |
|---|---|
| 비기술 사용자에게 데이터를 전달 | CSV |
| 데이터 레이크 저장과 분석 스캔 | Parquet (Hive·Trino 레거시라면 ORC도 고려) |
| Kafka 메시지, 스키마 계약이 중요한 스트리밍 | Avro + Schema Registry |
| 레코드 단위 append 로그 | Avro |
| 프로세스나 언어 사이의 대량 데이터 전달 | Arrow IPC, Arrow Flight |
| 인메모리 분석 엔진의 연산 표현 | Arrow |
| ACID, time travel, 동시 쓰기가 필요한 테이블 | Parquet + 테이블 포맷 |

<br><br><br>

## 주의할 점

- Parquet 파일은 수정할 수 없다. 행 하나를 고치려면 파일을 다시 써야 한다. UPDATE, DELETE, upsert가 필요하다면 파일 포맷 수준에서는 답이 없고 [테이블 포맷](/concept/data-engineering/01_lakehouse_table_formats)이 필요하다.
- 스트리밍에서 Parquet를 자주 쓰면 작은 파일이 많이 생긴다. footer 읽기와 메타데이터 오버헤드가 데이터보다 커지면서 열 지향의 이점이 사라지므로 주기적인 compaction이 필요하다.
- Arrow는 메모리를 많이 쓴다. 압축하지 않고 고정폭을 유지하는 것이 설계 의도이므로 원시 데이터보다 커질 수 있다. 가용 메모리보다 데이터가 크면 Arrow 표현을 그대로 들고 있는 방식은 실패하고, 청크 단위로 나누어 처리해야 한다.
- 타입 매핑은 형식 경계에서 자주 새는 부분이다. 타임스탬프 정밀도, 시간대 유무, decimal 정밀도, unsigned 정수, 중첩 타입은 Parquet, Avro, Arrow, 그리고 각 엔진 사이에서 미묘하게 다르게 처리된다. 특히 나노초 타임스탬프와 unsigned 타입은 엔진별 지원 범위가 갈리므로 경계를 넘길 때는 스키마를 명시하는 편이 안전하다.
- 압축 코덱 선택은 실제로 트레이드오프가 있다. snappy는 빠르지만 덜 줄이고, zstd는 압축률과 속도가 균형을 이루고, gzip은 잘 줄이지만 느리다. 재압축이 CPU 병목이 되는 잡도 있다.
- Parquet를 쓴다고 항상 빠른 것은 아니다. 컬럼을 전부 읽는 쿼리, 카디널리티가 높아 사전 인코딩이 효과가 없는 컬럼, 정렬이 안 되어 min/max 범위가 넓은 파일에서는 이점이 크게 줄어든다. 정렬과 파티셔닝, Row Group 크기 같은 파일 레이아웃이 포맷 선택만큼 중요하다.
- Arrow와 Arrow IPC를 구분해야 한다. Arrow는 메모리 표현 표준이고 IPC와 Feather는 그것을 파일로 떨어뜨린 것이다. IPC 파일은 압축이 약하고 목적이 다르므로 장기 저장 형식으로 쓰지 않는 것이 좋다. 장기 저장은 Parquet가 맡는다.

<br><br><br>

## 정리하면서

처음의 질문으로 돌아가면, Arrow가 Parquet보다 빠르다고 해서 Arrow로 저장하면 되는 것이 아니었다. 두 형식은 각각 다른 비용을 줄이려고 만들어졌고, 저장 형식으로서의 Arrow는 애초에 목표가 아니었기 때문이다.

정리하면 CSV는 시스템 밖으로 나갈 때 쓰는 형식이고, 시스템 안의 저장은 Parquet가, 레코드 단위 전송과 스키마 계약은 Avro가, 메모리에서의 계산과 도구 사이 전달은 Arrow가 맡는다. 열 지향이 압축과 스캔에서 유리한 대신 레코드 단위 쓰기를 포기했다는 점, 그리고 저장에 좋은 표현과 계산에 좋은 표현이 다르다는 점이 이 구분을 만든 원인이다.

그리고 수정과 동시 쓰기, time travel이 필요해지는 지점부터는 파일 포맷이 답할 수 있는 범위를 넘어간다. 그때부터는 테이블 포맷의 영역이고, 그 내용은 [앞 글](/concept/data-engineering/01_lakehouse_table_formats)에서 다루었다.
