---
layout      : concept
title       : 실무 환경의 Entity Resolution 파이프라인과 도구와 운영
date        : 2026-07-13 00:00:00 +0900
updated     : 2026-07-13 00:00:00 +0900
tag         : data-architecture entity-resolution record-linkage mdm data-integration
toc         : true
comment     : true
latex       : true
status      : draft
public      : true
parent      : [[/data-architect]]
confidence  : high
relations:
  - { type: extends, target: concept/data-architect/08_record_linkage_basics }
  - { type: references, target: concept/data-architect/09_privacy_preserving_matching }
  - { type: references, target: concept/data-architect/07_ontology_core_concepts }
---

* TOC
{:toc}

> **Entity Resolution(ER, 개체 해소)**은 서로 다른 소스에 흩어진 레코드 중 같은 실세계 개체를 가리키는 것들을 찾아 하나로 묶는 작업이다. 이론적 토대 — Fellegi-Sunter, blocking, survivorship — 는 [[/data-architect/08_record_linkage_basics]]에, 확률 추정과 프라이버시 보존은 [[/data-architect/09_privacy_preserving_matching]]에 있다. 이 글은 그 이론을 **실제 프로덕션 환경에서 하나의 시스템으로 어떻게 짓고 굴리는가**를 다룬다 — 파이프라인 아키텍처, 도구 선택, incremental·실시간 처리, 그리고 운영에서 실제로 터지는 함정들.

이론은 앞의 두 글을 전제로 한다. 이 글은 "그래서 어떻게 만드나"에 집중한다. 등장하는 데이터·스키마·키 이름은 설명용 가상 예시다.

---

## ER이 실무에서 필요해지는 자리

ER은 학술적 문제가 아니라 거의 모든 데이터 통합의 길목에서 튀어나오는 실무 문제다. 공통 키가 깨끗하면 조인으로 끝나지만, 조직·시스템·시간을 가로지르는 순간 키가 무너진다.

| 상황 | 왜 ER이 필요한가 |
|------|----------------|
| Customer 360 / MDM | CRM·주문·앱·콜센터에 흩어진 한 고객을 단일 프로파일로 |
| 중복 제거(dedup) | 회원 가입 시 이미 있는 사람이 오타·다른 이메일로 재가입 |
| KYC·AML·사기 탐지 | 제재 리스트·과거 사기 계정과 신규 가입자 대조 |
| M&A·시스템 통합 | 두 회사 고객 DB 병합, 겹치는 고객 식별 |
| GDPR DSAR·삭제권 | "이 사람의 모든 데이터를 찾아라" — 흩어진 레코드 전부를 개체로 묶어야 대응 가능 |
| 제품·공급사 카탈로그 | 같은 상품이 SKU·표기 다르게 여러 번 등록됨 |

공통점은 하나다 — **신뢰할 수 있는 공통 식별자가 없고, 있어도 오염됐다.** ER은 그 오염을 뚫고 "같은 것"을 복원하는 인프라다. resolve된 결과는 곧 온톨로지의 살아있는 엔티티가 된다([[/data-architect/07_ontology_core_concepts]]).

---

## 시스템으로서의 ER 파이프라인

08편이 blocking→scoring→clustering→survivorship의 골격을 세웠다. 실무 시스템은 그 앞뒤로 **표준화**와 **서빙**이 붙는다. 이 두 단계가 실전 성패의 절반을 가른다.

```
원본 소스들 (CRM, 주문, 앱, 외부 데이터)
   │
   ▼  [1. Standardization]  ── 정규화·파싱·클렌징  ★대부분의 정확도가 여기서 결정
표준화된 레코드
   │
   ▼  [2. Blocking]         ── 비교 후보 쌍 생성 (n² 회피)
후보 쌍
   │
   ▼  [3. Pairwise Scoring] ── Fellegi-Sunter 등으로 매치 가중치 W
매치된 쌍 (엣지)
   │
   ▼  [4. Clustering]       ── 엣지를 개체 클러스터로  ★over-merge 위험 지점
개체 클러스터
   │
   ▼  [5. Survivorship]     ── 클러스터당 골든 레코드 1개
골든 레코드 + 클러스터
   │
   ▼  [6. Serving]          ── 안정적 entity_id 부여, xref 테이블로 서빙
downstream (분석, 앱, 온톨로지)
```

### 1. Standardization — 가장 저평가된 단계

실무에서 매치율을 가장 크게 움직이는 건 정교한 모델이 아니라 **입력 정규화**다. 같은 값이 표기만 다르면 아무리 좋은 스코어러도 놓친다.

| 대상 | 표준화 작업 |
|------|-----------|
| 이름 | 유니코드 정규화(NFC), 공백·대소문자 통일, 별칭·약칭 사전(`Bob`→`Robert`) |
| 주소 | 주소 파서로 구조화(도/시/구/도로명), 표준 주소 DB 매핑 |
| 전화·이메일 | E.164 정규화, 이메일 소문자화·플러스태그 제거 |
| 날짜 | 단일 포맷·타임존 통일 |
| 결측·플레이스홀더 | `"NULL"`, `"999-9999"`, `"test@test.com"` 같은 쓰레기값 제거 |

<div class="callout-info">
경험칙: <strong>모델을 튜닝하기 전에 표준화부터 조인다.</strong> 정규화가 부실하면 blocking에서 진짜 매치가 다른 블록으로 흩어지고, 그건 뒤의 어떤 스코어러도 복구할 수 없다. 플레이스홀더값(공용 이메일, 더미 전화)은 오히려 <strong>과대 병합</strong>을 유발하므로 반드시 걸러야 한다.
</div>

### 2~3. Blocking과 Scoring — 실무 관점

이론은 08편에 있다. 실무에서 중요한 건 두 가지다.

- **멀티패스 blocking이 기본값**이다. 단일 블로킹 키는 그 키에 오타가 있으면 매치를 통째로 놓친다. `(우편번호+이름 첫글자) OR (전화 뒷4자리) OR (이메일)`처럼 여러 규칙을 OR로 묶어 서로의 사각지대를 덮는다.
- **scorer는 해석 가능성 우선**이다. 딥러닝 ER도 있지만 프로덕션 기본값은 여전히 Fellegi-Sunter 계열이다 — 왜 두 레코드가 병합됐는지 감사할 수 있고, 라벨 없이 EM으로 학습되며, 규제 대응이 가능하기 때문이다.

---

## Clustering — 실무에서 가장 위험한 단계

pairwise scoring은 "쌍"을 판정한다. 그런데 최종 산출물은 "쌍"이 아니라 "개체 그룹"이다. 매치된 쌍을 엣지로 보고 그래프의 **연결 요소(connected component)**로 묶는 게 가장 흔한 방법이다.

여기에 실무의 대표적 사고가 숨어 있다 — **이행적 과대 병합(transitive over-merge)**.

```
A ── 매치 ── B ── 매치 ── C
```

A와 B가 매치, B와 C가 매치지만 **A와 C는 남남**일 수 있다. 연결 요소는 이 셋을 통째로 한 개체로 묶는다. `B`가 흔한 이름·공용 이메일 같은 약한 허브면, 수천 개 레코드가 하나의 거대 클러스터로 붕괴한다. 실무에서 "한 고객에 10만 건이 붙은 클러스터"는 거의 항상 이 문제다.

```python
# Spark GraphFrames: 매치 엣지 → 연결 요소로 클러스터링
from graphframes import GraphFrame

# vertices: 레코드, edges: scoring이 match로 판정한 쌍
g = GraphFrame(records_df, matched_pairs_df)
clusters = g.connectedComponents()   # component 컬럼 = 클러스터 ID
# 주의: 약한 엣지 하나가 두 큰 클러스터를 붙여버릴 수 있다
```

### 과대 병합을 막는 실무 기법

| 기법 | 아이디어 |
|------|---------|
| 임계값 상향 | clustering에 쓰는 엣지는 pairwise 임계값을 보수적으로 |
| 그래프 가지치기 | 약한 엣지(낮은 $W$) 제거 후 연결 요소 |
| Correlation / hierarchical clustering | 단순 transitive closure 대신 클러스터 내부 응집도까지 고려 |
| Community detection | 거대 컴포넌트를 하위 커뮤니티로 분해해 약한 다리 절단 |
| 병합 상한·검토 큐 | 클러스터 크기가 임계 초과 시 자동 병합 대신 사람 검토로 |

<div class="callout-info">
설계 원칙: <strong>과소 병합(놓친 매치)은 나중에 잡을 수 있지만, 과대 병합은 사고다.</strong> 두 고객이 잘못 합쳐지면 한 사람이 남의 주문·결제 정보를 보게 된다. 그래서 clustering 단계는 재현율보다 정밀도를 보수적으로 잡고, 애매한 병합은 검토 큐로 흘린다.
</div>

---

## 도구 선택

직접 짤지, 오픈소스를 쓸지, 매니지드/상용을 살지가 실무의 첫 갈림길이다.

| 도구 | 유형 | 특징 | 적합한 상황 |
|------|------|------|-----------|
| **Splink** | OSS (Python) | Fellegi-Sunter + EM, Spark·DuckDB·Athena 백엔드, 해석 가능·시각화 강력 | 대규모 배치, 감사 가능성 필요, 라벨 부족 |
| **Zingg** | OSS (Spark) | ML 기반, active learning으로 라벨 수집, Spark 네이티브 | Spark 스택, 학습 데이터 만들 여력 |
| **dedupe** (Python) | OSS 라이브러리 | active learning + 로지스틱 회귀, 소규모에 간편 | 단일 노드, 중소 데이터셋 |
| **Spark + GraphFrames** | DIY | scoring은 직접, clustering은 connectedComponents | 완전한 제어 필요, 팀 역량 있음 |
| **AWS Entity Resolution** | 매니지드 | 규칙·ML·provider 기반 매칭, 관리 부담 최소 | AWS 스택, 운영 인력 최소화 |
| **Senzing** | 상용 엔진 | 실시간 ER API, 증분 처리 내장 | 저지연·실시간, 스트리밍 유입 |
| **Informatica / Reltio / Tamr** | 상용 MDM | 거버넌스·steward UI·survivorship 규칙 엔진 포함 | 엔터프라이즈 MDM, 데이터 스튜어드 조직 |

<div class="callout-info">
GCP·BigQuery 스택은 AWS Entity Resolution 같은 브랜드 매니지드 ER이 없어, 보통 <strong>Dataproc 위 Splink</strong>나 BigQuery SQL로 직접 구축한다. 선택 기준은 "실시간이 필요한가", "감사·거버넌스가 필요한가", "라벨이 있는가", "운영 인력이 있는가" 네 축이다.
</div>

---

## Batch vs Incremental — 실무에서 진짜 어려운 부분

교과서 ER은 "데이터셋 하나를 한 번 resolve"한다. 프로덕션은 다르다 — **매일 새 레코드가 들어오고, resolve 결과를 downstream이 계속 참조한다.** 여기서 두 개의 어려운 요구가 충돌한다.

1. 새 데이터가 와도 매번 전체를 재계산할 수 없다(비용).
2. downstream이 참조하는 `entity_id`는 **안정적**이어야 한다 — 어제 `E-123`이던 고객이 오늘 `E-987`로 바뀌면 조인·리포트·모델이 다 깨진다.

### 안정적 entity_id와 xref 테이블

핵심 산출물은 골든 레코드 자체가 아니라 **원본 레코드 ↔ 안정적 entity_id를 잇는 교차참조(xref) 테이블**이다. downstream은 항상 이 매핑을 통해 개체에 접근한다.

```sql
-- xref: 원본 레코드와 안정적 개체 ID의 매핑 (버전 이력 포함)
CREATE TABLE entity_xref (
  source_system   STRING,       -- 'crm', 'orders', 'app'
  source_record_id STRING,      -- 소스의 원본 PK
  entity_id       STRING,       -- 안정적 개체 ID (한 번 부여되면 유지)
  match_score     FLOAT,        -- 이 배정의 신뢰도
  valid_from      TIMESTAMP,    -- SCD2: 언제부터 이 개체에 속했나
  valid_to        TIMESTAMP,    -- 재배정되면 이전 행을 닫는다
  is_current      BOOLEAN
);
```

`entity_id`는 클러스터 순번이 아니라 **surrogate key**(예: UUID)로 발급하고, 한 번 부여되면 클러스터가 재계산돼도 최대한 승계한다. 재계산으로 클러스터가 바뀌면 xref에 새 SCD2 행을 추가해 이력을 남긴다.

### Incremental 매칭 전략

새 레코드가 들어올 때 전체를 다시 돌리지 않고, **기존 클러스터에 신규만 매칭**한다.

| 단계 | 처리 |
|------|------|
| 신규 유입 | 표준화 후 blocking으로 기존 골든 레코드 후보 조회 |
| 매칭 | 신규 ↔ 기존 개체 pairwise scoring |
| 배정 | 매치되면 기존 `entity_id` 승계, 아니면 새 `entity_id` 발급 |
| 주기적 full re-resolve | 누적 드리프트 교정을 위해 저빈도(예: 주간)로 전체 재계산 |

### Merge/Split — 개체가 합쳐지고 쪼개질 때

incremental ER의 진짜 난제는 병합과 분할이다.

- **Merge**: 나중에 들어온 레코드가 지금까지 별개였던 두 개체를 잇는 다리가 된다 → 두 `entity_id`를 하나로 합쳐야 하고, 사라지는 ID를 참조하던 downstream을 처리해야 한다(tombstone + 리다이렉트 매핑).
- **Split**: 과거의 과대 병합이 발견돼 한 개체를 둘로 쪼개야 한다 → 어느 원본 레코드가 어느 쪽으로 가는지, 이력을 어떻게 보존하는지가 문제.

<div class="callout-info">
그래서 ER은 "한 번 실행하는 잡"이 아니라 <strong>상태를 가진 서비스</strong>로 설계해야 한다. entity_id의 생성·병합·분할 이벤트를 로그로 남기고, downstream이 ID 변경을 구독하거나 리다이렉트 매핑으로 흡수하게 만든다. 이 상태 관리를 내장한 것이 Senzing 같은 실시간 엔진의 값어치다.
</div>

---

## 평가와 운영

ER은 라벨이 거의 없어 "잘 되고 있나"를 재는 것 자체가 과제다.

### 무엇을 측정하나

| 관점 | 지표 | 주의점 |
|------|------|-------|
| Pairwise | 쌍 단위 precision·recall·F1 | 재현율은 blocking이 후보를 만들어준 쌍에 대해서만 계산됨 — blocking이 놓친 건 안 보임 |
| Cluster | 클러스터가 ground truth 개체와 얼마나 일치(예: 클러스터 순도·완전성) | 이행적 병합의 피해는 여기서만 드러남 |
| 운영 | 클러스터 크기 분포, 거대 클러스터 수, 검토 큐 적체 | 과대 병합·드리프트의 조기 경보 |

<div class="callout-info">
pairwise F1만 보면 함정에 빠진다 — blocking 단계에서 이미 후보에서 빠진 진짜 매치는 재현율 계산에 아예 안 들어온다. blocking의 <strong>Pairs Completeness</strong>(08편)를 따로 봐야 전체 재현율의 상한을 안다.
</div>

### Ground truth 만들기

- **clerical review 큐**: Fellegi-Sunter의 보류 구간(애매한 쌍)을 사람이 판정하고, 그 판정을 라벨로 축적한다 — 평가셋이자 재학습 데이터가 된다.
- **알려진 매치 심기**: 확실히 같은/다른 레코드 쌍을 소량 큐레이션해 회귀 테스트로 고정한다.

### 운영 모니터링

ER은 데이터 분포가 바뀌면 조용히 열화한다(신규 소스 유입, 표기 관습 변화). 그래서 매 실행마다 **클러스터 크기 분포**, **신규 병합·분할 수**, **검토 큐 유입률**을 추적하고, 거대 클러스터가 갑자기 생기면 배포 전 게이트로 막는다. 임계값은 코드로 버전 관리하고, 변경 시 평가셋으로 A/B 비교한다.

---

## 실무 함정 정리

| 함정 | 결과 | 대응 |
|------|------|------|
| 표준화 소홀 | 진짜 매치가 다른 블록으로 흩어져 영구 유실 | 모델보다 정규화 먼저 |
| 플레이스홀더값 방치 | 공용 이메일·더미 전화가 과대 병합 유발 | 쓰레기값 사전 제거 |
| 단일 blocking 키 | 그 키의 오타에 매치 전멸 | 멀티패스 OR blocking |
| 무비판적 connected components | 이행적 과대 병합, 거대 클러스터 | 임계값 상향·가지치기·병합 상한 |
| 불안정한 entity_id | downstream 조인·리포트 붕괴 | surrogate key + xref SCD2 |
| pairwise F1만 신뢰 | blocking이 놓친 매치가 안 보임 | cluster 지표 + Pairs Completeness 병행 |
| merge/split 미설계 | ID 재배정 시 참조 깨짐 | tombstone·리다이렉트·이벤트 로그 |
| 삭제권 대응 누락 | 병합된 개체에서 특정 소스만 삭제 불가 | xref로 소스별 기여를 추적 가능하게 |

---

## 정리

- ER은 학술 문제가 아니라 **거의 모든 데이터 통합의 길목**에서 나온다 — 공통 키가 없거나 오염됐을 때 "같은 것"을 복원하는 인프라다.
- 실무 파이프라인은 이론의 blocking→scoring→clustering→survivorship 앞뒤에 **표준화**와 **서빙**이 붙는다. 정확도의 절반은 표준화에서, 사고의 절반은 clustering에서 갈린다.
- **connected components의 이행적 과대 병합**이 대표 사고다. 과소 병합은 나중에 잡지만 과대 병합은 사고이므로, clustering은 정밀도를 보수적으로 잡는다.
- 도구는 Splink·Zingg·dedupe(OSS), AWS Entity Resolution(매니지드), Senzing·상용 MDM 중 "실시간·거버넌스·라벨·인력" 네 축으로 고른다.
- 프로덕션 ER은 잡이 아니라 **상태를 가진 서비스**다. 안정적 `entity_id`와 xref 테이블, incremental 매칭, merge/split 처리가 배치 ER과 실무 ER을 가른다.
- 평가는 pairwise F1만으로 부족하다 — cluster 지표와 blocking의 Pairs Completeness, 그리고 클러스터 크기 분포 모니터링을 함께 본다.
- 이론 복습: [[/data-architect/08_record_linkage_basics]](Fellegi-Sunter·blocking·survivorship), [[/data-architect/09_privacy_preserving_matching]](EM·유사도·PPRL).
