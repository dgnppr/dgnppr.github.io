---
layout  : concept
title   : Google Cloud 데이터베이스와 스토리지 선택 결정
date    : 2026-06-30 00:00:00 +0900
updated : 2026-07-06 00:00:00 +0900
tag     : cloud gcp database storage spanner bigtable pca
toc     : true
comment : true
latex   : false
status  : complete
public  : true
parent  : [[/cloud]]
relations:
  - { type: references, target: /concept/cloud/00_pca_study_plan }
  - { type: references, target: /concept/cloud/05_iam_for_pca }
  - { type: references, target: /concept/cloud/09_security_for_pca }
  - { type: references, target: /concept/cloud/10_migration_and_dr_for_pca }
confidence     : high
valid_from     : 2026-06-30
---

* TOC
{:toc}

> PCA의 데이터베이스·스토리지 문제는 거의 전부 한 형식이다 — "이런 요구사항이 있다, 어떤 서비스를 고를 것인가". 즉 묻는 본질은 **요구사항(일관성·확장성·지연·글로벌 분산·데이터 모델·비용)을 서비스 특성에 매핑하는 능력**이다. 이 글은 GCP의 7개 데이터베이스와 Cloud Storage를 "요구사항 → 선택 기준 → 결론"의 결정 구조로 정리한다. 이 글은 PCA 준비 시리즈 7편이다.

---

## 도입 — DB 문제는 결정 트리다

PCA 시험의 데이터베이스 문제는 깊은 내부 동작을 묻지 않는다. 대신 시나리오를 던지고 **가장 적합한 서비스 하나**를 고르게 한다. 함정은 두 가지다 — ① 정답에 가까워 보이지만 한 가지 요구사항(예: 글로벌 강일관성, 트랜잭션, 밀리초 지연)을 충족하지 못하는 오답, ② 정답이지만 비용·복잡도가 과한 오버킬(예: 단일 리전이면 충분한데 Spanner를 고르는 것).

따라서 모든 DB 문제는 다음 축을 순서대로 묻는 결정 트리로 환원된다.

```
1. 데이터 모델이 관계형(테이블·조인·트랜잭션)인가, 비관계형인가?
2. 관계형이면 — 단일 리전으로 충분한가, 글로벌 수평 확장 + 강일관성이 필요한가?
3. 비관계형이면 — 와이드컬럼 고처리량(시계열/IoT)인가, 문서형(모바일/실시간)인가?
4. 분석(집계·스캔 중심)인가, 운영(OLTP, 단건 조회·갱신)인가?
5. 캐시·세션 같은 인메모리 계층이 필요한가?
```

<div class="callout-note">
이 글의 지도: 결정 트리 한눈 표 → 관계형(Cloud SQL · AlloyDB · Spanner) → NoSQL(Bigtable · Firestore) → 캐시(Memorystore) → BigQuery 경계 → Cloud Storage(object) → Filestore(file) → 데이터 처리 솔루션 선택 → 백업·복구 → DB 보안 → 시험 공략 → 퀴즈. 각 절은 "요구사항 → 선택 기준 → 결론"으로 닫는다.
</div>

---

## 한눈에 보는 결정 표

먼저 전체 지형을 한 표로 압축한다. 세부는 이후 절에서 푼다.

| 서비스 | 데이터 모델 | 일관성 | 확장 방식 | 트랜잭션 | 대표 용도 | 시험 신호어 |
|--------|-----------|--------|----------|---------|----------|-----------|
| **Cloud SQL** | 관계형(MySQL/PG/SQL Server) | 강(단일 인스턴스) | 수직(+읽기 복제본) | 완전 ACID | 표준 OLTP 웹앱, 기존 DB 마이그레이션 | "MySQL/PostgreSQL", "관리형 RDB", "리프트 앤 시프트" |
| **AlloyDB** | 관계형(PostgreSQL 호환) | 강 | 수직 + 읽기 풀 | 완전 ACID | 고성능 PostgreSQL, HTAP(트랜잭션+분석) | "PostgreSQL인데 더 빠르게", "트랜잭션 + 분석 동시" |
| **Spanner** | 관계형(SQL) | **글로벌 강일관성** | **수평(무제한)** | 완전 ACID, 글로벌 | 글로벌 금융·재고, 무중단 수평 확장 | "글로벌", "강일관성 + 수평 확장", "99.999%" |
| **Bigtable** | 와이드컬럼 NoSQL | 단일 클러스터 강 / 멀티 결과적 | **수평** | **단일 행만** | 시계열, IoT, 모니터링, 고처리량 | "수백만 QPS", "시계열/IoT", "한 자릿수 ms", "페타바이트" |
| **Firestore** | 문서 NoSQL | 강 | 자동 수평 | ACID(문서·다문서) | 모바일/웹, 실시간 동기화, 서버리스 백엔드 | "모바일", "실시간 리스너", "오프라인 동기화" |
| **Memorystore** | 키-값(인메모리) | — | 수직/수평(엔진별) | — | 캐시, 세션, 리더보드 | "캐시", "지연 줄이기", "Redis/Memcached" |
| **BigQuery** | 분석 컬럼 저장 | — | 서버리스 | — | 데이터 웨어하우스, 대규모 분석 | "분석", "집계", "BI", "페타바이트 쿼리" |

<div class="callout-warning">
시험에서 가장 흔한 오답 패턴은 두 가지다. (1) 단일 리전이면 Cloud SQL/AlloyDB로 충분한데 <strong>Spanner</strong>를 고르게 유도(비용 오버킬), (2) 트랜잭션·조인이 필요한데 <strong>Bigtable</strong>을 고르게 유도(데이터 모델 부적합). "글로벌 강일관성 + 수평 확장"이 명시되지 않았다면 Spanner는 의심하라.
</div>

---

## 관계형 1 — Cloud SQL

### 무엇인가

MySQL, PostgreSQL, SQL Server를 관리형으로 제공하는 서비스다. 패치·백업·복제·장애 조치를 GCP가 운영한다. **단일 리전** 서비스이며, 기존 관계형 DB를 거의 그대로 옮기는 가장 표준적인 선택지다.

### 가용성 — HA 구성

Cloud SQL의 고가용성(HA)은 **같은 리전 내 다른 존(zone)에 동기 복제되는 대기(standby) 인스턴스**로 구현된다. 주(primary) 인스턴스 장애 시 자동으로 standby로 장애 조치(failover)된다.

<div class="callout-warning">
HA standby는 <strong>같은 리전의 다른 존</strong>에 있다. 즉 Cloud SQL HA는 <strong>존 장애</strong>를 막지만 <strong>리전 전체 장애</strong>는 막지 못한다. 리전 장애 대비는 별도의 <strong>교차 리전(cross-region) 읽기 복제본</strong>을 두고 재해 시 승격(promote)하는 방식으로 설계한다.
</div>

### 읽기 확장 — 읽기 복제본(Read Replica)

읽기 부하가 큰 경우 읽기 복제본을 추가한다. 복제본은 읽기 쿼리만 처리하며, 교차 리전에도 둘 수 있다.

| 구성 | 목적 | 핵심 |
|------|------|------|
| **HA(standby)** | 가용성(자동 장애 조치) | 동기 복제, 같은 리전 다른 존, 읽기 트래픽 안 받음 |
| **읽기 복제본** | 읽기 확장 / DR | 비동기 복제, 교차 리전 가능, 수동 승격으로 DR에 활용 |

<div class="callout-warning">
시험 함정: "읽기 복제본으로 고가용성을 확보한다"는 <strong>부정확</strong>하다. 읽기 복제본은 비동기이고 자동 장애 조치가 없다 — 가용성은 HA 구성이, 읽기 확장은 읽기 복제본이 담당한다. 둘은 목적이 다르다.
</div>

### 한계

- **쓰기 수평 확장 불가**: 쓰기는 단일 주 인스턴스가 처리한다. 머신을 키우는 수직 확장이 전부다. 쓰기 처리량이 단일 인스턴스 한계를 넘으면 Spanner를 고려한다.
- 인스턴스 크기·스토리지·연결 수에 상한이 있다.

**결론**: 표준 관계형 워크로드, 기존 MySQL/PostgreSQL/SQL Server 마이그레이션, 단일 리전 OLTP의 1순위. 글로벌 분산이나 쓰기 수평 확장이 필요해지는 순간 후보에서 빠진다.

---

## 관계형 2 — AlloyDB

### 무엇인가

PostgreSQL과 **호환**되는 완전 관리형 데이터베이스다. 표준 Cloud SQL for PostgreSQL보다 높은 성능을 목표로 설계됐고, **트랜잭션(OLTP)과 분석(OLAP)을 한 DB에서** 처리하는 HTAP 성격이 핵심 차별점이다.

### 선택 기준

- **PostgreSQL 호환을 유지하면서** Cloud SQL의 성능 한계를 넘어야 할 때.
- 트랜잭션 워크로드에 더해 **분석 쿼리(집계·스캔)** 를 같은 데이터에서 빠르게 돌려야 할 때. AlloyDB는 컬럼형 가속 엔진을 내장해 분석 쿼리를 가속한다.
- 컴퓨트와 스토리지가 분리되어, 읽기 풀(read pool)로 읽기를 수평 확장할 수 있다.

| 비교 | Cloud SQL for PostgreSQL | AlloyDB |
|------|--------------------------|---------|
| 호환성 | PostgreSQL | PostgreSQL 호환 |
| 성능 목표 | 표준 | 고성능(특히 분석·대규모) |
| 분석 가속 | 없음 | 컬럼형 엔진 내장(HTAP) |
| 글로벌 분산 | 없음 | 없음(리전 단위) |

<div class="callout-warning">
AlloyDB도 <strong>글로벌 강일관성·무제한 수평 쓰기 확장은 제공하지 않는다</strong>. "PostgreSQL인데 더 빠르고 분석도 같이"가 신호어다. "글로벌"이 나오면 AlloyDB가 아니라 Spanner다.
</div>

<div class="callout-note">
성능 수치 주의: Google은 AlloyDB의 컬럼형 엔진이 표준 PostgreSQL 대비 분석 쿼리를 "최대 100배" 빠르게 처리한다고 밝히지만, 이는 <strong>벤더(Google) 자체 벤치마크·특정 조건</strong>의 수치다. 시험은 배수를 묻지 않는다 — 외워야 할 것은 "AlloyDB = PostgreSQL 호환 + OLTP·OLAP 혼합(HTAP) 가속"이라는 <strong>포지셔닝</strong>이지 특정 배수가 아니다.
</div>

**결론**: PostgreSQL 호환 + 고성능 + 트랜잭션·분석 혼합(HTAP)이면 AlloyDB. Cloud SQL과 Spanner 사이의 자리를 메운다.

---

## 관계형 3 — Cloud Spanner

### 무엇인가

**글로벌 분산, 수평 확장, 강일관성**을 동시에 제공하는 관계형 데이터베이스다. 전통적으로 양립하기 어려운 "관계형 + 수평 확장 + 강한 일관성"을 함께 제공하는 것이 핵심 가치다. SQL을 지원하고 완전한 ACID 트랜잭션을 글로벌 범위에서 보장한다.

### 선택 기준 — 세 조건이 함께일 때만

Spanner는 다음이 **동시에** 요구될 때의 정답이다.

1. **관계형 + 강한 트랜잭션 일관성**이 필요하다.
2. **단일 인스턴스의 한계를 넘는 수평 확장**(쓰기 포함)이 필요하다.
3. 종종 **여러 리전에 걸친 글로벌 분산**과 높은 가용성 SLA가 필요하다.

| 가용성 구성 | 대표 SLA |
|------------|---------|
| 멀티 리전 | 99.999% |
| 단일 리전 | 99.99% |

<div class="callout-warning">
Spanner의 가장 큰 함정은 <strong>비용</strong>이다. 최소 프로비저닝 단위(노드/프로세싱 유닛)부터 비용이 발생하며, 작은 워크로드에는 과한 선택이다. "글로벌 강일관성 + 수평 확장"이 명시되지 않은 단일 리전 OLTP에 Spanner를 고르면 오버킬 오답이다. 반대로 그 세 조건이 모두 나오면 Cloud SQL·AlloyDB는 답이 될 수 없다.
</div>

### 언제 Spanner이고 언제 아닌가

| 시나리오 | 정답 | 이유 |
|----------|------|------|
| 전 세계 사용자 대상 글로벌 재고/금융 원장, 강일관성 필수 | **Spanner** | 글로벌 + 강일관성 + 수평 확장 |
| 단일 리전 전자상거래 백엔드, 트래픽 보통 | Cloud SQL / AlloyDB | 글로벌·수평 확장 요구 없음 |
| 쓰기 처리량이 단일 인스턴스 한계를 초과, 무중단 확장 필요 | **Spanner** | 수평 쓰기 확장 |
| 분석 웨어하우스 | BigQuery | OLTP가 아님 |

**결론**: "글로벌 + 강일관성 + 수평 확장" 세 단어가 함께 보이면 Spanner. 하나라도 빠지고 단일 리전으로 충분하면 Cloud SQL/AlloyDB가 비용 면에서 정답.

---

## NoSQL 1 — Bigtable

### 무엇인가

**와이드컬럼(wide-column) NoSQL**이다. 한 자릿수 밀리초 지연으로 매우 높은 읽기·쓰기 처리량을 페타바이트 규모까지 제공한다. HBase API와 호환된다.

### 선택 기준

- **시계열, IoT 센서, 모니터링·지표, 금융 틱 데이터** 등 대량의 단순 키 기반 데이터를 고처리량으로 쓰고 읽을 때.
- 데이터가 크고(대략 1TB 이상) 처리량이 핵심일 때. 작은 데이터셋에는 비용·운영이 과하다.

### 한계 — 시험 함정 집중 구역

<div class="callout-warning">
Bigtable의 결정적 제약: <strong>단일 행(row) 단위 원자성만</strong> 보장한다. 여러 행에 걸친 ACID 트랜잭션, SQL <strong>조인</strong>, 복잡한 쿼리, 보조 인덱스(secondary index) 같은 관계형 기능이 <strong>없다</strong>. "트랜잭션", "조인", "여러 테이블 관계"가 나오면 Bigtable은 오답이다.
</div>

또한 성능은 **행 키(row key) 설계**에 달려 있다. 순차 증가하는 키(타임스탬프 선두 등)는 특정 노드에 부하가 몰리는 **핫스팟(hotspotting)** 을 만든다. 키에 해시 접두사를 붙이거나 필드 순서를 바꿔 부하를 분산한다.

```
# 핫스팟을 유발하는 행 키 (시간 선두 → 같은 시점 쓰기가 한 노드에 집중)
20260630T120000#sensor-42

# 부하 분산형 행 키 (디바이스 ID 선두 → 디바이스별로 분산)
sensor-42#20260630T120000
```

일관성: 단일 클러스터 라우팅에서는 강일관성, 여러 클러스터에 복제하는 멀티 클러스터 구성에서는 기본적으로 결과적 일관성(eventual consistency)이다.

**결론**: 고처리량·저지연·대용량의 단순 키 액세스(시계열/IoT/모니터링)면 Bigtable. 트랜잭션·조인·복잡 쿼리가 필요하면 절대 아니다.

---

## NoSQL 2 — Firestore

### 무엇인가

**문서(document) 기반 NoSQL**이다. 컬렉션-문서 모델을 쓰고, 모바일·웹 SDK, **실시간 리스너**, **오프라인 동기화**를 기본 제공한다. 자동으로 확장되며 강일관성과 ACID 트랜잭션을 지원한다.

### 선택 기준

- **모바일/웹 앱의 백엔드**로, 클라이언트가 데이터 변경을 실시간으로 구독하거나 오프라인 상태에서도 동작해야 할 때.
- 서버리스·이벤트 기반 아키텍처에서 빠르게 시작하고 자동 확장이 필요할 때.

### Native 모드 vs Datastore 모드

Firestore는 데이터베이스 생성 시 두 모드 중 하나를 고른다. **한 번 정하면 변경할 수 없다.**

| 구분 | Native 모드 | Datastore 모드 |
|------|------------|---------------|
| 대상 | 모바일/웹 클라이언트 | 서버 백엔드 |
| 실시간 리스너 | 있음 | 없음 |
| 오프라인 동기화 SDK | 있음 | 없음 |
| 계보 | 신규 앱의 표준 모드 | 구 Cloud Datastore의 후속(기존 Datastore와 API 호환) |
| 일관성 | 강일관성 | 강일관성 |

<div class="callout-warning">
시험 함정: <strong>새 모바일/실시간 앱</strong>이면 Firestore <strong>Native 모드</strong>. <strong>기존 App Engine/Datastore 서버 워크로드</strong>이거나 실시간·모바일 SDK가 필요 없는 서버 백엔드면 <strong>Datastore 모드</strong>. 두 모드는 한 프로젝트의 한 데이터베이스에서 동시에 쓸 수 없고, 생성 후 전환 불가다.
</div>

### 한계

- 관계형 조인이 없고, 쿼리에 제약이 있다(인덱스 기반, 복잡한 집계 제한).
- 초고처리량 시계열 같은 워크로드는 Bigtable이 더 적합하다.

**결론**: 모바일/웹 + 실시간/오프라인 + 문서 모델이면 Firestore Native. 서버 전용·기존 Datastore면 Datastore 모드.

---

## NoSQL 정리 — Bigtable vs Firestore

| 질문 | Bigtable | Firestore |
|------|----------|-----------|
| 데이터 모델 | 와이드컬럼(키-행) | 문서(컬렉션-문서) |
| 강점 | 초고처리량·저지연·페타바이트 | 모바일/웹·실시간·오프라인 |
| 트랜잭션 | 단일 행만 | 문서·다문서 ACID |
| 대표 워크로드 | 시계열·IoT·모니터링 | 앱 백엔드·실시간 동기화 |
| 작은 데이터 | 부적합(오버킬) | 적합 |

---

## 캐시 — Memorystore

### 무엇인가

관리형 인메모리 데이터 스토어로 **Redis**와 **Memcached** 엔진을 제공한다. 주 용도는 캐싱, 세션 저장, 리더보드/순위, 일시적 고속 조회다. 영구 저장소가 아니라 **다른 DB 앞단의 속도 계층**이다.

| 엔진 | 특징 | 적합 |
|------|------|------|
| **Redis** | 풍부한 자료구조, 영속화 옵션, 복제 기반 HA | 세션·리더보드·pub/sub·HA 캐시 |
| **Memcached** | 단순 키-값, 수평 확장 용이 | 단순·대규모 분산 캐시 |

<div class="callout-warning">
Memorystore는 <strong>주(primary) 데이터 저장소가 아니다</strong>. "데이터를 영구 보관"이 요구사항이면 캐시가 아니라 DB를 골라야 한다. "지연을 줄여라", "반복 조회를 빠르게", "DB 부하를 낮춰라"가 캐시 신호어다.
</div>

**결론**: 읽기 지연 단축·반복 조회 가속·세션 저장이면 Memorystore. 풍부한 자료구조/HA가 필요하면 Redis, 단순 분산 캐시면 Memcached.

---

## BigQuery — 경계만

BigQuery는 **서버리스 데이터 웨어하우스**다. 본 시리즈 응시자의 강점 영역이므로 여기서는 **DB와의 경계만** 짚는다.

BigQuery를 고르는 단 하나의 기준: **대규모 데이터에 대한 분석(집계·스캔·조인·BI)이 목적이고, 단건의 저지연 조회·고빈도 갱신이 아닌 경우.** 즉 OLAP이지 OLTP가 아니다. "데이터 웨어하우스", "수년치 로그 분석", "애드혹 SQL 분석", "BI 대시보드"가 신호어다.

<div class="callout-warning">
경계 함정: 애플리케이션의 <strong>실시간 단건 조회·갱신(OLTP)</strong>을 BigQuery로 처리하려 하면 오답이다 — 그건 Cloud SQL/Spanner/Firestore의 일이다. 반대로 운영 DB에서 <strong>대규모 분석 집계</strong>를 직접 돌려 부하를 주는 것도 오답이며, 그 경계가 BigQuery의 자리다.
</div>

---

## Cloud Storage — 객체 스토리지

여기서부터는 스토리지다. Cloud Storage는 **객체(object) 스토리지**로, 파일을 버킷(bucket)에 저장한다. 모든 스토리지 클래스가 동일한 API·내구성·처리량·밀리초 단위 접근 지연을 제공하며, **차이는 비용 구조(저장 단가 vs 액세스 비용)와 최소 저장 기간뿐**이라는 점이 핵심이다.

### 스토리지 클래스

| 클래스 | 액세스 빈도(목표) | 최소 저장 기간 | 저장 단가 | 액세스/검색 비용 |
|--------|------------------|---------------|----------|-----------------|
| **Standard** | 빈번(핫 데이터) | 없음 | 가장 높음 | 가장 낮음 |
| **Nearline** | 월 1회 정도 | 30일 | 중간 | 있음 |
| **Coldline** | 분기 1회 정도 | 90일 | 낮음 | 더 높음 |
| **Archive** | 연 1회 정도(장기 보관) | 365일 | 가장 낮음 | 가장 높음 |

<div class="callout-warning">
핵심 오해: "Coldline/Archive는 느리다"는 <strong>틀리다</strong>. 모든 클래스가 동일한 밀리초 접근 지연과 동일한 내구성을 가진다. 차이는 (1) GB당 저장 단가, (2) 데이터 검색·액세스 시 부과되는 비용, (3) 최소 저장 기간이다. 액세스가 드물수록 저장은 싸지만 꺼낼 때 비싸진다. 또한 최소 저장 기간 전에 삭제·전환하면 조기 삭제 요금이 부과된다 — Archive에 넣고 한 달 만에 지우면 손해다.
</div>

선택 기준은 **액세스 빈도**다.

```
자주 접근 → Standard
월 단위 접근 → Nearline
분기 단위 접근 → Coldline
연 단위 이하, 장기 규제 보관 → Archive
```

### 라이프사이클 정책

객체의 나이·조건에 따라 **클래스 전환(SetStorageClass)** 또는 **삭제(Delete)** 를 자동 수행하는 규칙이다. 비용 최적화의 핵심 도구다.

```json
{
  "lifecycle": {
    "rule": [
      {
        "action": { "type": "SetStorageClass", "storageClass": "NEARLINE" },
        "condition": { "age": 30 }
      },
      {
        "action": { "type": "SetStorageClass", "storageClass": "COLDLINE" },
        "condition": { "age": 90 }
      },
      {
        "action": { "type": "SetStorageClass", "storageClass": "ARCHIVE" },
        "condition": { "age": 365 }
      },
      {
        "action": { "type": "Delete" },
        "condition": { "age": 2555 }
      }
    ]
  }
}
```

위 규칙은 "30일 후 Nearline, 90일 후 Coldline, 1년 후 Archive, 7년 후 삭제"를 자동화한다. 조건에는 `age`, `createdBefore`, `numNewerVersions`(버전 관리와 연동), `matchesStorageClass` 등이 있다.

<div class="callout-note">
액세스 패턴을 예측하기 어렵다면 <strong>Autoclass</strong>를 쓸 수 있다. Autoclass는 객체별 액세스 패턴에 따라 클래스를 자동 전환해, 라이프사이클 규칙을 수작업으로 짜지 않아도 비용을 최적화한다. "액세스 패턴을 모른다/예측 불가"가 신호어다.
</div>

### 위치 타입 — region / dual-region / multi-region

버킷 생성 시 위치 타입을 고른다. **가용성·지연·비용**의 트레이드오프다.

| 위치 타입 | 데이터 위치 | 지오 이중화 | 가용성 | 지연/비용 | 적합 |
|-----------|-----------|------------|--------|----------|------|
| **Region** | 단일 리전 | 없음 | 표준 SLA | 가장 낮은 지연·가장 낮은 비용 | 컴퓨트와 같은 리전, 데이터 지역성 요구 |
| **Dual-region** | 지정한 두 리전 | 있음 | 높음 | 두 리전 모두에서 낮은 지연 | 두 리전 액티브, 리전 장애 대비 + 성능 |
| **Multi-region** | 넓은 지리 영역(예: US/EU/ASIA) | 있음(광범위) | 가장 높음 | 서빙에 유리, 비용 높음 | 전 세계 콘텐츠 서빙, 최고 가용성 |

<div class="callout-warning">
트레이드오프 함정: <strong>region</strong>은 컴퓨트와 같은 리전에 둘 때 지연·비용이 가장 유리하지만 리전 장애에 취약하다. <strong>dual-region/multi-region</strong>은 지오 이중화로 가용성이 높지만 비용이 더 든다. "데이터가 컴퓨트와 같은 리전에 있어야 한다/특정 국가에 머물러야 한다"면 region, "리전 장애에도 무중단 + 두 리전에서 빠르게"면 dual-region, "전 세계 사용자에게 콘텐츠 서빙"이면 multi-region.
</div>

dual-region은 **turbo replication** 옵션으로 더 빠른 복제(낮은 RPO 목표)를 설정할 수 있다 — 강한 DR 요구가 있을 때.

### 버전 관리(Object Versioning)

활성화하면 객체를 덮어쓰거나 삭제할 때 **이전 버전(noncurrent version)** 을 보존한다. 실수 삭제·덮어쓰기로부터 복구할 수 있다. 단, 오래된 버전이 쌓이면 저장 비용이 늘므로 라이프사이클의 `numNewerVersions` 조건으로 오래된 버전을 정리한다.

### 보존(Retention)과 객체 락

규제·컴플라이언스 보관 요구의 도구다.

| 메커니즘 | 효과 |
|----------|------|
| **버킷 보존 정책(retention policy)** | 객체를 일정 기간 동안 삭제·수정 불가로 강제(WORM) |
| **보존 정책 락(lock)** | 보존 정책을 영구 고정 — 기간 단축·해제 불가 |
| **객체 홀드(hold)** | 개별 객체에 임시 홀드(event-based/temporary), 해제 전까지 삭제 불가 |

<div class="callout-warning">
보존 정책을 <strong>lock</strong>하면 되돌릴 수 없다 — 보존 기간을 줄이거나 정책을 제거할 수 없고, 버킷은 기간이 남은 객체가 있으면 삭제도 불가하다. "법적/규제상 N년간 변경·삭제 불가로 보관"(WORM, 컴플라이언스) 요구면 보존 정책 + 락이 정답이다. 잘못 걸면 영구이므로 신중히.
</div>

### 균일 버킷 수준 액세스(Uniform Bucket-Level Access)

Cloud Storage 접근 제어에는 두 방식이 있다.

| 방식 | 설명 |
|------|------|
| **Fine-grained(세분화)** | IAM + 객체별 ACL 병행 — 객체 단위 권한 가능하나 관리 복잡 |
| **Uniform(균일)** | ACL 비활성화, **IAM만** 사용 — 일관·단순·권장 |

<div class="callout-tip">
균일 버킷 수준 액세스를 켜면 객체 ACL이 비활성화되고 버킷의 모든 객체에 IAM 정책이 일관되게 적용된다. 권한 모델이 단순해지고 감사가 쉬워져 <strong>권장</strong>된다. "ACL과 IAM이 섞여 권한 추적이 어렵다"는 문제의 해법이 균일 액세스다. (IAM 일반 모델은 시리즈 IAM 편 참고.)
</div>

**결론**: 클래스는 액세스 빈도로, 라이프사이클로 자동 전환·삭제, 위치는 가용성·지연·비용 트레이드오프로, 컴플라이언스 보관은 보존 정책+락, 접근은 균일 액세스(IAM 단일화)로.

<div class="callout-note">
온프레미스나 다른 클라우드에서 Cloud Storage로 데이터를 <strong>옮기는</strong> 일(Storage Transfer Service · Transfer Appliance · <code>gsutil/gcloud storage</code>)은 스토리지 <em>선택</em>이 아니라 <em>이전</em>의 문제다. 전송 도구 선택은 [[/concept/cloud/10_migration_and_dr_for_pca]]에서 다룬다.
</div>

---

## Filestore — 공유 파일 스토리지

가이드 1.3은 스토리지를 **object / file / databases** 세 축으로 나눈다. 앞 절의 Cloud Storage가 object, 앞의 데이터베이스들이 databases라면, 남은 **file** 축이 Filestore다. PCA에서 자주 빠뜨리는 지점이다.

### 무엇인가

**관리형 NFS(Network File System)** 파일 서버다. 여러 클라이언트가 **같은 파일시스템을 동시에 마운트**해 표준 POSIX 파일 인터페이스로 읽고 쓴다. GKE Pod이나 Compute Engine VM에 NFS 볼륨으로 붙인다.

세 스토리지 유형은 인터페이스가 근본적으로 다르다.

| 유형 | 서비스 | 인터페이스 | 동시 마운트 | 대표 용도 |
|------|--------|-----------|------------|----------|
| **Object** | Cloud Storage | HTTP API(버킷·객체) | — (API 접근) | 비정형 파일, 백업, 데이터 레이크, 정적 콘텐츠 |
| **File** | **Filestore** | **NFS(POSIX 파일·디렉터리)** | **여러 VM/Pod 동시** | 공유 파일시스템, 레거시 앱, HPC, GKE 공유 볼륨 |
| **Block** | Persistent Disk / Hyperdisk | 블록 디바이스(VM에 디스크로 부착) | 보통 단일 VM(읽기 공유 한정) | VM 부트·데이터 디스크, 단일 인스턴스 스토리지 |

<div class="callout-note">
블록 스토리지의 차세대는 <strong>Hyperdisk</strong>다. Persistent Disk의 후속으로, 핵심 개념은 <strong>IOPS·처리량을 용량과 독립적으로 프로비저닝</strong>한다는 것 — 작은 볼륨에도 높은 성능을 붙이거나, 큰 볼륨에 성능을 아껴 비용을 조정할 수 있다. 워크로드 성격(균형/처리량/고성능)에 맞춰 타입을 고른다. 시험에서는 정확한 타입명·한도 수치보다 <strong>"성능과 용량을 따로 조절하는 차세대 블록 스토리지"</strong>라는 포지셔닝 수준으로 잡으면 충분하다(타입별 세부 한도는 리전·머신 유형에 따라 다르다).
</div>

### 선택 기준

- **여러 VM/컨테이너가 같은 파일을 공유**해야 할 때. Persistent Disk는 보통 한 VM에 붙고(쓰기), Cloud Storage는 파일시스템이 아니라 객체 API다. "여러 인스턴스가 하나의 파일시스템을 마운트"는 Filestore의 신호다.
- **NFS를 전제로 한 레거시 애플리케이션의 리프트 앤 시프트**. 온프레미스에서 NFS 공유에 의존하던 앱을 코드 수정 없이 옮길 때.
- **HPC·렌더링·미디어 처리**처럼 다수 노드가 공유 작업 디렉터리를 쓰는 워크로드.
- **GKE/Compute의 공유 영속 볼륨**(ReadWriteMany 성격).

티어는 성능·가용성·용량 범위로 나뉜다(기본형부터 존·엔터프라이즈급 가용성까지). 정확한 티어명·성능 수치는 버전에 따라 달라지므로 시험에서는 *"공유 NFS가 필요한가, 더 높은 성능/가용성이 필요한가"* 수준으로 판단하면 충분하다.

<div class="callout-warning">
혼동 함정: <strong>"여러 VM이 같은 데이터에 접근"</strong>이라는 문구만으로 Cloud Storage를 고르면 안 된다. 그 데이터가 <strong>POSIX 파일시스템</strong>으로 마운트되어야 하면(앱이 파일 경로로 읽고 씀, NFS 의존) Filestore다. 객체 API로 충분하면 Cloud Storage가 더 싸다. 반대로 단일 VM 전용 디스크면 Persistent Disk다.
</div>

**결론**: NFS·공유 파일시스템·여러 VM 동시 마운트·NFS 의존 레거시 이전이면 Filestore. 객체 API면 Cloud Storage, 단일 VM 블록 디스크면 Persistent Disk.

---

## 데이터 처리 솔루션 선택

가이드 1.3의 "choosing data processing solutions"다. 깊은 내부 동작이 아니라 **워크로드 성격(배치/스트리밍, 관리형/이전) → 서비스 매핑**을 묻는다. 결정 표 하나로 정리한다.

| 워크로드 | 1순위 서비스 | 성격 | 신호어 |
|----------|-------------|------|--------|
| 배치 — 기존 Hadoop/Spark 이전 | **Dataproc** | 관리형 Hadoop/Spark 클러스터(기존 잡 그대로) | "Spark/Hadoop", "기존 클러스터 이전", "Hive/Pig" |
| 배치·스트리밍 통합 — 신규 파이프라인 | **Dataflow** | 서버리스 Apache Beam(오토스케일, 클러스터 관리 없음) | "Apache Beam", "서버리스 스트리밍/배치", "ETL 신규 구축" |
| 이벤트 수집·메시지 버스 | **Pub/Sub** | 글로벌 관리형 메시징(스트리밍 인입 전단) | "이벤트 인입", "디커플링", "메시지 큐", "초당 수백만 이벤트" |
| 워크플로 오케스트레이션 | **Cloud Composer** | 관리형 Airflow(DAG로 잡 스케줄·의존성) | "워크플로", "DAG", "Airflow", "파이프라인 스케줄링" |
| 대규모 분석·웨어하우스 | **BigQuery** | 서버리스 분석(SQL 집계·스캔) | "데이터 웨어하우스", "애드혹 SQL 분석", "BI" |

두 축으로 압축하면 다음과 같다.

- **관리형 vs 자체 운영**: 클러스터를 직접 운영·튜닝할 이유가 없으면 서버리스(Dataflow/BigQuery)가 운영 부담이 가장 낮다. 단 **기존 Spark/Hadoop 자산을 그대로 옮기는** 경우는 Dataproc이 자연스럽다(코드 재작성 회피).
- **배치 vs 스트리밍**: 경계 없는 실시간 스트림은 Dataflow(+ 인입은 Pub/Sub), 주기적 대량 처리는 Dataproc 또는 Dataflow 배치 모드. 잡들의 순서·의존성·재시도를 엮는 것은 Composer의 일이지 연산 엔진의 일이 아니다.

<div class="callout-warning">
역할 혼동 주의: <strong>Pub/Sub은 처리 엔진이 아니라 전송·버퍼링 계층</strong>이고, <strong>Composer는 연산하지 않고 오케스트레이션만</strong> 한다. "스트리밍 데이터를 받아 변환·집계"는 Pub/Sub(인입) + Dataflow(처리)의 조합이지 Pub/Sub 단독이 아니다. "기존 Spark 잡을 최소 변경으로 클라우드에서"는 Dataflow가 아니라 Dataproc이다(Beam으로 재작성 불필요).
</div>

---

## 백업과 복구

가용성(HA)과 백업은 자주 섞이지만 푸는 문제가 다르다. **HA는 인프라 장애 시에도 서비스가 계속 뜨게** 하고, **백업은 데이터가 손상·삭제·오변경된 과거 시점으로 되돌리게** 한다. HA standby가 있어도 잘못된 `DELETE`가 복제되면 양쪽 다 망가진다 — 그때 살리는 것이 백업이다.

<div class="callout-warning">
핵심 구분: <strong>HA(가용성) ≠ 백업(시점 복구)</strong>. 동기 복제·자동 장애 조치는 <em>하드웨어/존 장애</em>를 막지만, <em>논리적 손상(실수 삭제·잘못된 마이그레이션·랜섬웨어)</em>은 막지 못한다. "특정 시점으로 되돌리기", "실수로 삭제한 데이터 복구"는 HA가 아니라 백업·PITR의 신호어다.
</div>

| 서비스 | 백업·복구 메커니즘 | 시점 복구(PITR) |
|--------|-------------------|----------------|
| **Cloud SQL** | 자동 백업(스케줄) + 온디맨드 백업 | 트랜잭션 로그 기반 **PITR**로 임의 시점 복원 |
| **Spanner** | 백업(같은 인스턴스 내) / 내보내기(export) | 일정 기간 내 과거 버전 조회·복원 |
| **BigQuery** | **타임 트래블**(기본 7일, 과거 시점 테이블 조회) + 테이블 **스냅숏** | 타임 트래블 윈도 내 시점 복원 |
| **Firestore** | 관리형 백업·내보내기/가져오기 | 관리형 PITR(설정 시) |
| **Cloud Storage** | **객체 버전 관리**(이전 버전 보존) | 버전 복원으로 사실상 시점 복구 |

정확한 보존 기간·윈도 길이는 설정과 버전에 따라 다르므로(예: BigQuery 타임 트래블 윈도는 조정 가능), 시험에서는 *"어느 서비스가 PITR/시점 복구를 제공하는가"* 수준으로 잡으면 된다.

<div class="callout-note">
리전 단위 재해(DR)와 RTO/RPO 설계, 교차 리전 복제·승격 전략은 [[/concept/cloud/10_migration_and_dr_for_pca]]에서 별도로 다룬다. 이 절은 "데이터 자체를 과거로 되돌리는" 백업에 한정한다.
</div>

---

## 데이터베이스 보안 최소 정리

DB 선택 문제에 보안 요구가 한 줄 섞여 나오는 경우가 있다. 상세는 [[/concept/cloud/09_security_for_pca]]에서 다루고, 여기서는 DB 맥락에서 자주 묻는 세 가지만 짚는다.

- **암호화**: 모든 관리형 DB·스토리지는 **기본적으로 저장 시 암호화**된다(Google 관리 키). 규제상 키를 직접 통제해야 하면 **CMEK**(Cloud KMS의 고객 관리 키)를 쓴다. "암호화 키를 우리가 관리·회전해야 한다"가 CMEK 신호어다.
- **인증·인가**: 비밀번호 대신 **IAM 데이터베이스 인증**(Cloud SQL/AlloyDB 등)으로 IAM 주체에 DB 접근을 매핑하면 자격 증명 관리가 단순해지고 감사가 쉬워진다.
- **네트워크 격리**: **Private IP**(공인 IP 없이 VPC 내부에서만 접근)와 **VPC Service Controls**(서비스 경계로 데이터 유출 방지)로 노출 면을 줄인다. "DB가 인터넷에 노출되면 안 된다"면 Private IP다.

---

## 공식 케이스 스터디 접점 — DB·스토리지 관점

PCA 시험의 4개 공식 케이스 스터디 중 셋이 DB·스토리지 결정을 직접 요구한다. 케이스 문항은 "이 회사의 이 요구사항에 어떤 데이터 서비스를 쓸 것인가"를 묻는다 — 앞서 익힌 결정 트리를 케이스 요구사항에 그대로 얹으면 된다.

| 케이스 | 도메인 요구사항 | DB·스토리지 결정 | 왜 |
|--------|----------------|------------------|----|
| **EHR Healthcare** | 멀티병원 EHR SaaS, HIPAA 규제, 멀티리전 99.99% 가용성, 저장·전송 암호화, 전 접근 감사 | 관계형(환자·진료 기록) → 리전 장애 대비 **교차 리전 읽기 복제본 + 승격**(또는 글로벌 강일관성 필수 시 **Spanner**), **CMEK**(규제 키 통제), 백업·PITR, 로그·백업 객체는 라이프사이클로 보관 | 규제형 관계형 데이터가 핵심. 암호화 키 통제(HIPAA) = CMEK, 감사 = 접근 로깅 |
| **TerramEarth** | 중장비 텔레메트리(운행 차량 수백만 대), IoT 대량 수집, 예지정비 ML, 딜러 API | 시계열 저지연 쓰기 = **Bigtable**(차량ID+타임스탬프 행 키), 분석·집계 = **BigQuery**, 배치 업로드 원천 = **Cloud Storage**, 수집 버퍼 = Pub/Sub → Dataflow | 대량 시계열은 Bigtable, 웨어하우스 분석은 BigQuery — 둘의 경계가 정확히 이 케이스의 함정 |
| **Mountkirk Games** | 모바일 멀티플레이어, 글로벌 동시 출시, 저지연 멀티플레이, 관리형 DB, 실시간 분석 | 글로벌 리더보드·게임 상태 강일관성 = **Spanner**(상황별 **Firestore**), 실시간 분석 = Pub/Sub + Dataflow → **BigQuery** | "글로벌 + 강일관성"이 명시되면 Spanner. 이벤트 분석 경로는 BigQuery로 분리 |

<div class="callout-warning">
케이스 함정: TerramEarth에서 "대량 텔레메트리를 저장·분석"이라는 문구만 보고 <strong>모두 BigQuery</strong>로 몰면 안 된다. 차량이 밀리초 단위로 쏟아내는 <strong>저지연 대량 쓰기·키 기반 조회</strong>는 Bigtable의 일이고, 그 위에서 <strong>애드혹 집계·ML 피처</strong>를 뽑는 것이 BigQuery다. 반대로 Mountkirk의 "글로벌 리더보드 강일관성"을 Bigtable로 풀려는 것도 오답 — 다행 트랜잭션·강일관성이 필요하면 Spanner다.
</div>

<div class="callout-note">
케이스 스터디는 현행 시험에 <strong>여전히 포함</strong>된다(4개 케이스, 케이스별 여러 문항). 다만 케이스 원문의 세부 수치(차량 대수 등)는 버전에 따라 갱신되므로, 이 표는 <em>요구사항 → 서비스 매핑의 골격</em>으로만 쓰고 숫자 암기는 하지 않는다. EHR의 보안·규제 접점(CMEK·VPC-SC)은 [[/concept/cloud/09_security_for_pca]], 마이그레이션 접점은 [[/concept/cloud/10_migration_and_dr_for_pca]]와 이어진다.
</div>

---

## 시험장에서 — 요구사항 신호어 매핑

### 데이터베이스 선택형

| 요구사항 신호어 | 정답 |
|----------------|------|
| MySQL/PostgreSQL/SQL Server 관리형, 기존 DB 마이그레이션 | **Cloud SQL** |
| PostgreSQL 호환 + 고성능 + 트랜잭션·분석 혼합(HTAP) | **AlloyDB** |
| 글로벌 + 강일관성 + 수평 확장(쓰기 포함), 99.999% | **Spanner** |
| 시계열·IoT·모니터링, 수백만 QPS, 한 자릿수 ms, 페타바이트 | **Bigtable** |
| 모바일/웹, 실시간 리스너, 오프라인 동기화, 문서 모델 | **Firestore (Native)** |
| 기존 App Engine/Datastore 서버 백엔드 | **Firestore (Datastore 모드)** |
| 캐시·세션·지연 단축, DB 부하 경감 | **Memorystore** |
| 대규모 분석·집계·BI·데이터 웨어하우스 | **BigQuery** |

### 스토리지 선택형

| 요구사항 신호어 | 정답 |
|----------------|------|
| 여러 VM/Pod이 같은 파일시스템 동시 마운트, NFS, 공유 파일 공간, NFS 의존 레거시 이전 | **Filestore** |
| 단일 VM 부트·데이터 디스크(블록) | **Persistent Disk / Hyperdisk** |
| 자주 접근하는 핫 데이터 | **Standard** |
| 월/분기 단위 접근, 백업 | **Nearline / Coldline** |
| 연 단위 이하, 장기 규제 보관 | **Archive** |
| 나이 기준 자동 클래스 전환·삭제 | **라이프사이클 정책** |
| 액세스 패턴 예측 불가 → 자동 최적화 | **Autoclass** |
| 컴퓨트와 같은 리전, 데이터 지역성, 최저 비용 | **region 버킷** |
| 리전 장애 대비 + 두 리전 저지연 | **dual-region (필요시 turbo replication)** |
| 전 세계 콘텐츠 서빙, 최고 가용성 | **multi-region 버킷** |
| 실수 삭제·덮어쓰기 복구 | **객체 버전 관리** |
| 규제상 N년 변경·삭제 불가(WORM) | **보존 정책 + 락** |
| ACL/IAM 혼재로 권한 추적 곤란 | **균일 버킷 수준 액세스(IAM 단일화)** |

### 데이터 처리·백업 선택형

| 요구사항 신호어 | 정답 |
|----------------|------|
| 기존 Spark/Hadoop 잡을 최소 변경으로 이전 | **Dataproc** |
| 서버리스 배치·스트리밍 통합 ETL(Apache Beam) | **Dataflow** |
| 이벤트 인입·메시지 버스·디커플링 | **Pub/Sub** |
| 워크플로 스케줄·의존성(DAG, Airflow) | **Cloud Composer** |
| 대규모 분석·집계·BI 웨어하우스 | **BigQuery** |
| 임의 시점으로 DB 복원(실수 삭제 복구) | **Cloud SQL PITR / BigQuery 타임 트래블 등** |
| DB 암호화 키를 직접 관리·회전 | **CMEK(Cloud KMS)** |
| DB를 인터넷에 노출하지 않음 | **Private IP / VPC-SC** |

### 혼동 쌍 — 시험 직전 점검

| 혼동 쌍 | 핵심 구분선 |
|---------|------------|
| Cloud SQL vs Spanner | 단일 리전 OLTP=Cloud SQL / 글로벌+수평+강일관성=Spanner |
| AlloyDB vs Spanner | PostgreSQL 호환·HTAP·리전=AlloyDB / 글로벌·수평=Spanner |
| Bigtable vs Firestore | 와이드컬럼 고처리량 시계열=Bigtable / 문서·모바일·실시간=Firestore |
| Bigtable vs Cloud SQL | 트랜잭션·조인 필요하면 Bigtable 아님(=관계형) |
| Firestore Native vs Datastore 모드 | 모바일·실시간=Native / 서버 백엔드=Datastore (생성 후 전환 불가) |
| HA standby vs 읽기 복제본 | 가용성(자동 장애조치)=HA / 읽기 확장·DR=읽기 복제본 |
| Coldline/Archive "느림" 오해 | 지연·내구성 동일, 차이는 비용·최소 저장 기간 |
| 보존 정책 락 | 영구 — 단축·해제 불가, 신중히 |
| Filestore vs Cloud Storage | POSIX 파일시스템 마운트·NFS=Filestore / 객체 API=Cloud Storage |
| Filestore vs Persistent Disk | 여러 VM 공유 파일시스템=Filestore / 단일 VM 블록 디스크=PD |
| Dataproc vs Dataflow | 기존 Spark/Hadoop 이전=Dataproc / 서버리스 신규 Beam=Dataflow |
| HA vs 백업 | 인프라 장애 무중단=HA / 논리적 손상·시점 복구=백업·PITR |

---

## 실전 퀴즈 — 핵심 개념 검증

---

**Q1. 글로벌 강일관성 vs 오버킬**

전 세계 사용자를 대상으로 하는 결제 원장 시스템을 설계한다. 요구사항은 ① 여러 대륙에 분산된 사용자에게 서비스, ② 모든 거래에 강한 일관성(읽은 잔액이 항상 최신), ③ 트래픽 증가에 따른 무중단 수평 확장(쓰기 포함), ④ SQL 기반 관계형 모델이다. 가장 적합한 서비스는?

- (A) Cloud SQL for PostgreSQL HA + 교차 리전 읽기 복제본
- (B) Cloud Spanner 멀티 리전 구성
- (C) AlloyDB 읽기 풀 구성
- (D) Bigtable 멀티 클러스터 복제

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

"글로벌 분산 + 강일관성 + 수평 쓰기 확장 + 관계형" 네 조건이 모두 명시됐다. 이 조합을 동시에 만족하는 서비스는 Spanner뿐이다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | Cloud SQL은 쓰기를 단일 주 인스턴스가 처리 — 수평 쓰기 확장 불가. 교차 리전 복제본은 비동기라 강일관성 아님 |
| (C) | AlloyDB는 리전 단위 — 글로벌 분산·수평 쓰기 확장 미제공 |
| (D) | Bigtable은 관계형·SQL·다행 트랜잭션 부적합. 멀티 클러스터는 기본 결과적 일관성 |

</div>
</details>

---

**Q2. Bigtable 부적합 판별**

전자상거래 주문 시스템을 만든다. 주문은 고객·상품·결제 테이블을 **조인**해 조회되고, 한 주문 처리에서 재고 차감과 결제 기록이 **하나의 트랜잭션으로 원자적으로** 커밋되어야 한다. 누군가 "고처리량을 위해 Bigtable을 쓰자"고 제안했다. 평가로 옳은 것은?

- (A) 적절하다 — Bigtable은 페타바이트 규모 고처리량을 제공하므로 주문 시스템에 이상적이다.
- (B) 부적절하다 — Bigtable은 다중 행/테이블 ACID 트랜잭션과 조인을 지원하지 않는다. 관계형(Cloud SQL/Spanner)이 맞다.
- (C) 적절하다 — 행 키를 잘 설계하면 조인과 트랜잭션이 가능하다.
- (D) 부적절하다 — Bigtable은 지연이 높아 주문 처리에 느리다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

Bigtable은 **단일 행 원자성만** 보장하며 SQL 조인·다중 행 트랜잭션·보조 인덱스가 없다. "조인 + 다중 테이블 단일 트랜잭션"은 관계형의 영역이다 — 단일 리전이면 Cloud SQL, 글로벌·수평 확장까지면 Spanner.

(C)는 틀렸다 — 행 키 설계는 핫스팟·성능 문제를 풀지, 조인·트랜잭션 기능을 만들어주지 않는다. (D)는 이유가 틀렸다 — Bigtable의 지연은 오히려 낮다. 부적합의 진짜 이유는 데이터 모델/트랜잭션이다.

</div>
</details>

---

**Q3. Firestore 모드 선택**

새 모바일 앱의 백엔드를 만든다. 사용자가 협업 편집하는 문서를 **실시간으로 동기화**하고, 네트워크가 끊겨도 **오프라인에서 동작**하다가 재연결 시 자동 병합되어야 한다. 가장 적합한 선택은?

- (A) Firestore Native 모드
- (B) Firestore Datastore 모드
- (C) Cloud SQL + 클라이언트 폴링
- (D) Bigtable + 앱 측 동기화 로직

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (A)**

실시간 리스너 + 오프라인 동기화 + 모바일 SDK는 Firestore **Native 모드**의 핵심 기능이다.

| 선택지 | 문제점 |
|--------|--------|
| (B) | Datastore 모드는 서버 백엔드용 — 실시간 리스너·오프라인 모바일 SDK 미제공 |
| (C) | 폴링은 실시간이 아니고 오프라인 동기화도 직접 구현해야 함 |
| (D) | Bigtable은 문서 모델·실시간 동기화·오프라인 SDK 부적합 |

신호어: "모바일", "실시간 동기화", "오프라인" → Firestore Native.

</div>
</details>

---

**Q4. 스토리지 클래스 + 라이프사이클**

규제상 거래 로그를 7년 보관해야 한다. 로그는 생성 후 30일간은 가끔 조회되고, 그 이후로는 거의 조회되지 않으며 1년이 지나면 감사 목적의 장기 보관만 남는다. 비용을 최소화하는 구성은?

- (A) 전부 Standard에 두고 7년 후 삭제한다.
- (B) 라이프사이클로 30일 후 Nearline, 365일 후 Archive로 전환하고 7년(2555일) 후 삭제한다.
- (C) 생성 즉시 Archive에 저장한다.
- (D) Memorystore에 캐시한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

액세스 빈도가 시간에 따라 떨어지므로 라이프사이클로 단계적 전환이 비용 최적이다 — 초기 30일 가끔 조회는 Nearline(월 단위 액세스), 1년 후 장기 보관은 Archive, 7년 후 자동 삭제.

| 선택지 | 문제점 |
|--------|--------|
| (A) | Standard 유지가 가장 비싼 저장. 콜드 데이터에 부적합 |
| (C) | 초기 30일 조회가 있는데 Archive는 액세스/검색 비용이 가장 높고 최소 저장 기간(365일) 제약 — 초기엔 손해 |
| (D) | Memorystore는 캐시(휘발성 속도 계층)이지 장기 보관소가 아님 |

추가로, 7년간 변경·삭제가 금지되는 WORM 요구가 있다면 **보존 정책 + 락**을 함께 건다.

</div>
</details>

---

**Q5. 버킷 위치 타입 트레이드오프**

분석 파이프라인의 원천 데이터를 Cloud Storage에 둔다. 데이터는 특정 리전의 Dataproc/Compute 클러스터에서만 처리되고, 데이터 지역성 규정상 해당 국가 밖으로 나가면 안 되며, 비용은 최소화해야 한다. 적합한 위치 타입은?

- (A) multi-region 버킷(예: US)
- (B) dual-region 버킷
- (C) 컴퓨트와 동일한 region 버킷
- (D) 여러 region에 복제본을 수동으로 복사

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (C)**

처리 클러스터와 **같은 단일 region** 버킷이 지연·비용에서 최적이고, 데이터가 그 리전(국가) 안에 머물러 지역성 규정도 만족한다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | multi-region은 넓은 지리 영역에 분산 — 데이터 지역성 위반 가능, 비용도 높음 |
| (B) | dual-region은 가용성↑이지만 두 리전에 분산되어 비용↑, 단일 리전 요구·최저 비용과 어긋남 |
| (D) | 수동 복사는 운영 부담·일관성 문제. 필요하면 dual/multi-region 기능을 쓰지 손수 복사하지 않음 |

리전 장애 대비가 추가 요구로 나왔다면 그때 dual-region을 고려한다. 여기서는 지역성 + 최저 비용이 우선이다.

</div>
</details>

---

**Q6. 공유 파일시스템 vs 객체 스토리지**

온프레미스에서 운영하던 미디어 처리 애플리케이션을 GCP로 옮긴다. 이 앱은 **NFS 마운트 경로에 파일을 읽고 쓰도록** 작성됐고, 처리량을 위해 **여러 Compute Engine VM이 같은 작업 디렉터리를 동시에** 읽고 쓴다. 코드는 가능한 한 수정하지 않으려 한다. 가장 적합한 스토리지는?

- (A) Cloud Storage 버킷에 객체로 저장하고 앱이 객체 API를 호출하도록 고친다.
- (B) Filestore 인스턴스를 만들어 모든 VM에 NFS로 마운트한다.
- (C) 각 VM에 Persistent Disk를 붙인다.
- (D) Memorystore에 파일을 캐시한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

"NFS 경로로 읽고 씀 + 여러 VM 동시 공유 + 코드 미수정"은 관리형 NFS인 **Filestore**의 정확한 신호다. 모든 VM이 같은 파일시스템을 마운트한다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | 객체 API로 바꾸려면 앱 코드를 고쳐야 함 — "코드 미수정" 위반. 파일시스템 시맨틱도 다름 |
| (C) | Persistent Disk는 보통 단일 VM에 쓰기 부착 — 여러 VM 동시 공유 파일시스템에 부적합 |
| (D) | Memorystore는 인메모리 캐시이지 파일시스템·영구 저장소가 아님 |

신호어: "NFS", "여러 VM이 같은 파일시스템 마운트", "리프트 앤 시프트" → Filestore.

</div>
</details>

---

**Q7. TerramEarth — 시계열 수집 vs 분석 경계**

중장비 제조사가 전 세계 운행 차량에서 초당 대량의 텔레메트리(차량 ID + 타임스탬프 + 센서값)를 수집한다. 요구사항은 ① 밀리초 단위 저지연으로 대량 쓰기를 흡수, ② 차량 ID로 최근 데이터를 빠르게 조회, ③ 이후 별도로 페타바이트 규모 애드혹 SQL 분석과 예지정비 ML 피처 생성. 수집·저장 계층으로 가장 적합한 것은?

- (A) 모든 텔레메트리를 BigQuery에 직접 스트리밍하고 조회·분석을 모두 BigQuery로 처리한다.
- (B) Bigtable에 차량 ID를 선두로 한 행 키로 저장하고, 분석은 별도로 BigQuery에서 수행한다.
- (C) Cloud SQL에 차량별 테이블로 저장한다.
- (D) Firestore에 차량 문서로 저장하고 실시간 리스너로 분석한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

"밀리초 저지연 + 대량 쓰기 + 키(차량 ID) 기반 조회 + 시계열"은 Bigtable의 정확한 신호다. 페타바이트 애드혹 SQL 분석·ML 피처는 성격이 다른 작업이므로 BigQuery로 분리한다 — 이 이원화가 TerramEarth 케이스의 핵심 설계다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | BigQuery는 분석(OLAP)용 — 대량 저지연 단건 쓰기·키 조회를 주 운영 경로로 쓰기엔 부적합. 분석 전용으로만 둔다 |
| (C) | Cloud SQL은 단일 인스턴스 쓰기 한계 — 수백만 차량 시계열의 고처리량 쓰기를 감당 못 함 |
| (D) | Firestore는 모바일·실시간 문서용. 대규모 시계열 수집·분석에 부적합 |

함정은 "저장·분석"을 한 서비스로 몰려는 (A)다. 수집=Bigtable, 분석=BigQuery로 경계를 나눠야 한다.

</div>
</details>

---

**Q8. Mountkirk — 글로벌 강일관성 게임 상태**

글로벌 동시 출시하는 모바일 멀티플레이어 게임의 백엔드를 설계한다. 전 세계 플레이어가 공유하는 **단일 글로벌 리더보드**와 게임 상태는 ① 여러 리전에서 읽고 쓰며, ② 항상 강한 일관성(누구나 같은 순위를 봄)이 필요하고, ③ 관계형 스키마와 트랜잭션으로 점수를 갱신하며, ④ 플레이어 증가에 무중단 수평 확장되어야 한다. 가장 적합한 것은?

- (A) 각 리전에 독립 Cloud SQL을 두고 애플리케이션이 병합한다.
- (B) Cloud Spanner 멀티 리전 구성
- (C) Bigtable 멀티 클러스터 복제
- (D) Memorystore Redis로 리더보드를 관리한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

"글로벌 + 강일관성 + 관계형·트랜잭션 + 수평 확장" 네 조건이 함께다 — Spanner의 정의역이다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | 리전별 독립 Cloud SQL은 글로벌 강일관성이 깨짐. 앱 측 병합은 일관성·복잡도 문제 |
| (C) | Bigtable 멀티 클러스터는 기본 결과적 일관성이고 다행 트랜잭션·관계형이 아님 |
| (D) | Memorystore는 캐시(속도 계층)이지 강일관성 영구 저장소가 아님 — 리더보드 캐시로 앞단에 둘 수는 있으나 원천 저장소는 아님 |

(D)는 그럴듯한 함정이다 — 리더보드는 Redis로 흔히 캐싱하지만, "강일관성 영구 게임 상태"의 원천은 Spanner이고 Memorystore는 그 앞의 캐시일 뿐이다.

</div>
</details>

---

**Q9. EHR Healthcare — 규제 관계형 + 키 통제 + 리전 장애**

병원 EHR SaaS를 GCP로 옮긴다. ① 환자·진료 기록은 관계형이고, ② HIPAA에 따라 저장 데이터 암호화 키를 조직이 직접 관리·회전·감사해야 하며, ③ 리전 전체 장애 시에도 데이터를 복구할 수 있어야 한다(멀티리전 가용성 목표). 데이터 계층 설계로 가장 적절한 것은?

- (A) Cloud SQL(관계형) + Google 기본 암호화 + 단일 리전 HA만 구성
- (B) Cloud SQL/Spanner(관계형) + CMEK(Cloud KMS 고객 관리 키) + 교차 리전 복제/멀티리전 구성
- (C) Bigtable + CSEK + 단일 리전
- (D) Firestore + CMEK + 단일 리전

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

세 요구를 각각 매핑한다 — 관계형은 Cloud SQL(글로벌 강일관성 요구 시 Spanner), "키를 직접 관리·회전·감사"는 **CMEK**, "리전 장애 대비"는 교차 리전 복제본(Cloud SQL)이나 멀티리전(Spanner)이다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | Google 기본 암호화는 키를 고객이 회전·감사할 수 없어 HIPAA 키 통제 요구 미충족. 단일 리전 HA는 리전 장애를 못 막음 |
| (C) | Bigtable은 관계형 EHR 기록에 부적합. 단일 리전은 리전 장애 대비 안 됨 |
| (D) | Firestore는 관계형 트랜잭션·조인 중심 EHR 스키마에 부적합. 단일 리전 한계 |

함정: HA(존 장애)와 리전 장애 대비(교차 리전)를 혼동하지 말 것. "리전 전체 장애 복구"는 교차 리전 복제/멀티리전이 답이다.

</div>
</details>

---

**Q10. HTAP — AlloyDB vs 분리 아키텍처**

PostgreSQL로 운영 중인 서비스가 있다. 트랜잭션 처리와 동시에, **같은 최신 데이터에 대해** 대시보드용 분석 집계 쿼리를 낮은 지연으로 돌려야 하는데, Cloud SQL for PostgreSQL에서 분석 쿼리가 트랜잭션 성능을 갉아먹는다. PostgreSQL 호환은 유지하려 한다. 가장 적합한 선택은?

- (A) 데이터를 BigQuery로 실시간 복제하고 분석은 BigQuery에서만 한다.
- (B) AlloyDB로 이전한다(컬럼형 엔진으로 트랜잭션·분석 혼합 가속).
- (C) Spanner로 이전한다.
- (D) Cloud SQL 읽기 복제본을 늘려 분석을 복제본에서 돌린다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

"PostgreSQL 호환 유지 + 같은 데이터에 트랜잭션·분석 혼합(HTAP) + 분석 지연 낮게"는 AlloyDB의 컬럼형 가속 엔진이 겨냥하는 지점이다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | BigQuery로 분리하면 "같은 최신 데이터"의 실시간성·트랜잭션 일관성이 약해지고, 별도 파이프라인 운영 부담이 늘어남. HTAP 요구엔 과함 |
| (C) | Spanner는 글로벌·수평 확장용 — 여기선 글로벌·수평 요구가 없고 PostgreSQL 호환·HTAP 가속이 초점 |
| (D) | 읽기 복제본은 비동기 지연이 있고 컬럼형 분석 가속이 없어 무거운 집계엔 여전히 비효율 |

주의: AlloyDB의 분석 가속 "배수"는 벤더 벤치마크 수치이므로 시험에서 외울 대상이 아니다. 외울 것은 "PostgreSQL + HTAP = AlloyDB" 포지셔닝이다.

</div>
</details>

---

**Q11. Autoclass vs 라이프사이클 — 예측 불가 액세스**

여러 팀이 버킷 하나에 다양한 데이터를 올리는데, 객체별 향후 액세스 패턴을 **예측할 수 없다.** 어떤 것은 자주, 어떤 것은 거의 안 쓰인다. 비용을 자동 최적화하되 팀마다 규칙을 손으로 짜는 부담을 없애려 한다. 가장 적합한 것은?

- (A) 모든 객체를 나이 30/90/365일 기준으로 전환하는 단일 라이프사이클 규칙을 적용한다.
- (B) 버킷에 Autoclass를 켠다.
- (C) 모두 Coldline에 저장한다.
- (D) 모두 Standard에 두고 수동으로 분기마다 검토해 옮긴다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

"액세스 패턴 예측 불가 + 객체별로 제각각 + 규칙 수작업 회피"는 **Autoclass**의 정확한 신호다. Autoclass는 객체별 실제 액세스에 따라 클래스를 자동 전환한다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | 나이 기반 라이프사이클은 "시간이 지나면 무조건 콜드"라는 <em>예측 가능한</em> 패턴에 맞다. 자주 쓰이는 객체까지 나이만으로 콜드 전환하면 액세스 비용이 되레 늘 수 있음 |
| (C) | 자주 쓰이는 객체까지 Coldline이면 액세스·검색 비용 폭증 |
| (D) | 수동 검토는 운영 부담 — 자동화 요구에 어긋남 |

핵심 구분: 나이로 예측되는 콜드다운 = 라이프사이클, 객체별 예측 불가 = Autoclass.

</div>
</details>

---

**Q12. dual-region + Turbo Replication — DR 목표**

두 리전에서 동시에 서비스하는 애플리케이션이 Cloud Storage를 쓴다. 리전 장애가 나도 데이터 손실을 최소화(낮은 RPO)해야 하고, 두 리전 모두에서 낮은 지연으로 접근해야 한다. 가장 적합한 구성은?

- (A) 단일 region 버킷 + 애플리케이션이 두 번째 리전에 수동 복사
- (B) dual-region 버킷 + Turbo Replication
- (C) multi-region 버킷(예: US)
- (D) Coldline 클래스로 두 리전에 각각 저장

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

"지정한 두 리전 액티브 + 낮은 지연 + 리전 장애 대비 + 낮은 RPO"는 dual-region의 자리이고, **Turbo Replication**이 복제 속도를 높여 RPO 목표를 강화한다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | 수동 복사는 일관성·지연·운영 부담 문제. 관리형 지오 이중화 기능을 쓰는 게 정석 |
| (C) | multi-region은 넓은 지리 영역에 분산 — 두 특정 리전을 지정해 낮은 지연·명확한 RPO를 원할 땐 dual-region이 더 맞고, 데이터 지역성 통제도 유리 |
| (D) | 스토리지 <em>클래스</em>(Coldline)는 액세스 비용 축이지 <em>위치</em>(가용성·복제) 축이 아님. 질문의 축을 잘못 짚음 |

주의: 클래스(액세스 빈도)와 위치 타입(가용성·복제)은 다른 축이다. DR·RPO는 위치 타입 + Turbo Replication의 문제다.

</div>
</details>

---

## 마무리

DB·스토리지 문제는 결국 한 동작이다 — **요구사항 키워드를 서비스 특성에 매핑**하는 것. 관계형이냐 비관계형이냐로 갈라지고, 관계형은 "단일 리전이면 Cloud SQL/AlloyDB, 글로벌+수평+강일관성이면 Spanner"로, 비관계형은 "고처리량 시계열이면 Bigtable, 모바일·실시간이면 Firestore"로 닫힌다. 캐시는 Memorystore, 분석은 BigQuery가 경계 밖에서 받친다.

<div class="callout-tip">
DB 문제의 첫 질문은 항상 같다 — "관계형인가, 그리고 글로벌 강일관성·수평 확장이 정말 필요한가". 둘째 질문은 "이게 트랜잭션·조인을 요구하는가(=Bigtable 배제)". 스토리지는 "액세스 빈도(클래스) / 가용성·지역성(위치) / 보관 규제(보존·락) / 권한 단순화(균일 액세스)"의 네 축.
</div>

가장 자주 나오는 오답은 **Spanner 오버킬**과 **Bigtable 데이터 모델 오용**이다. 단일 리전으로 충분하면 Spanner를 의심하고, 트랜잭션·조인이 보이면 Bigtable을 지워라.

---

## 참고

- [[/cloud]] — Google PCA 준비 시리즈 인덱스
- [[/concept/cloud/00_pca_study_plan]] — 12일 학습 계획(이 글은 7월 3일 DB·스토리지 분량)
- [[/concept/cloud/05_iam_for_pca]] — IAM(균일 버킷 수준 액세스의 IAM 모델 전제)
- [[/concept/cloud/09_security_for_pca]] — CMEK·IAM DB 인증·Private IP·VPC-SC 상세
- [[/concept/cloud/10_migration_and_dr_for_pca]] — 데이터 전송 도구·DR·RTO/RPO 설계
- Google Cloud, [*Cloud SQL overview*](https://cloud.google.com/sql/docs/introduction) — 엔진·HA·읽기 복제본
- Google Cloud, [*AlloyDB for PostgreSQL overview*](https://cloud.google.com/alloydb/docs/overview) — PostgreSQL 호환·컬럼형 가속
- Google Cloud, [*Cloud Spanner overview*](https://cloud.google.com/spanner/docs/overview) — 글로벌 강일관성·수평 확장
- Google Cloud, [*Bigtable overview*](https://cloud.google.com/bigtable/docs/overview) — 와이드컬럼·행 키·핫스팟
- Google Cloud, [*Firestore — Native vs Datastore mode*](https://cloud.google.com/firestore/docs/firestore-or-datastore) — 모드 선택
- Google Cloud, [*Memorystore*](https://cloud.google.com/memorystore/docs) — Redis·Memcached
- Google Cloud, [*Filestore overview*](https://cloud.google.com/filestore/docs/overview) — 관리형 NFS·티어·마운트
- Google Cloud, [*Storage options*](https://cloud.google.com/compute/docs/disks) — object·file·block 비교(Persistent Disk·Filestore·Cloud Storage)
- Google Cloud, [*Dataflow*](https://cloud.google.com/dataflow/docs) / [*Dataproc*](https://cloud.google.com/dataproc/docs) / [*Pub/Sub*](https://cloud.google.com/pubsub/docs) / [*Cloud Composer*](https://cloud.google.com/composer/docs) — 데이터 처리·오케스트레이션
- Google Cloud, [*Cloud SQL backups & PITR*](https://cloud.google.com/sql/docs/mysql/backup-recovery/pitr) — 자동 백업·시점 복구
- Google Cloud, [*BigQuery time travel*](https://cloud.google.com/bigquery/docs/time-travel) — 타임 트래블·스냅숏
- Google Cloud, [*Storage classes*](https://cloud.google.com/storage/docs/storage-classes) — Standard·Nearline·Coldline·Archive
- Google Cloud, [*Object Lifecycle Management*](https://cloud.google.com/storage/docs/lifecycle) — 전환·삭제 규칙
- Google Cloud, [*Bucket locations*](https://cloud.google.com/storage/docs/locations) — region·dual-region·multi-region
- Google Cloud, [*Retention policies and Bucket Lock*](https://cloud.google.com/storage/docs/bucket-lock) — 보존·WORM
- Google Cloud, [*Uniform bucket-level access*](https://cloud.google.com/storage/docs/uniform-bucket-level-access) — ACL 비활성화·IAM 단일화
