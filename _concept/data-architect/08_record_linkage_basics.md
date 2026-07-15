---
layout      : concept
title       : 레코드 링키지 기초 Fellegi-Sunter와 Blocking과 Survivorship
date        : 2026-06-30 00:00:00 +0900
updated     : 2026-06-30 00:00:00 +0900
tag         : data-architecture entity-resolution record-linkage mdm
toc         : true
comment     : true
latex       : true
status      : draft
public      : true
parent      : [[/data-architect]]
confidence  : high
relations:
  - { type: references, target: concept/data-architect/04_what_is_ontology }
  - { type: references, target: concept/data-architect/07_ontology_core_concepts }
---

* TOC
{:toc}

> 서로 다른 소스에 흩어진 레코드 중 같은 실세계 개체를 가리키는 것들을 식별해 묶는 작업을 **레코드 링키지(record linkage)** 또는 **개체 해소(entity resolution)**라 한다. 이 글은 그 세 가지 토대 — 확률적 매칭의 고전 이론인 **Fellegi-Sunter**, 스케일을 가능하게 하는 **Blocking**, 묶은 뒤 하나의 정답 레코드를 만드는 **Survivorship** — 를 정리한다.

이 글은 record linkage 학습의 1편이다. 확률·프라이버시 보존 매칭의 심화는 [[/data-architect/09_privacy_preserving_matching]]에서 다룬다. 등장하는 데이터·키 이름은 설명용 가상 예시다.

---

## 도입 — 왜 조인이 아니라 매칭인가

공통 키가 깨끗하면 그냥 조인하면 된다. 문제는 현실의 소스가 그렇지 않다는 것이다.

| 소스 A | 소스 B | 같은 사람? |
|--------|--------|-----------|
| `홍길동, 1990-01-02, 서울시 강남구` | `홍길동, 1990-01-02, 서울 강남` | 거의 확실 |
| `김민수, 010-1234-5678` | `김민수, 010-1234-5678` (오타로 `김민서`) | 아마도 |
| `이영희, 1985` | `이영희, 1986` | 불확실 |

키가 없거나, 있어도 오타·표기 변형·결측이 섞인다. 그래서 "같다/다르다"의 이진 조인이 아니라, **"같을 확률"을 추정하는 매칭** 문제가 된다. 이 확률을 형식화한 것이 Fellegi-Sunter 모델이다.

---

## Fellegi-Sunter 모델

Ivan Fellegi와 Alan Sunter가 1969년에 발표한 확률적 레코드 링키지의 표준 이론이다. 핵심 아이디어는 단순하다 — **두 레코드를 필드별로 비교해 "일치 패턴"을 만들고, 그 패턴이 진짜 매치에서 나올 가능성과 비매치에서 나올 가능성의 비를 가중치로 더한다.**

### 비교 벡터

두 레코드 쌍 $(a, b)$에 대해, 각 필드 $i$의 일치 여부를 비교 벡터 $\gamma = (\gamma_1, \dots, \gamma_K)$로 표현한다. 가장 단순하게는 $\gamma_i \in \lbrace \text{일치}, \text{불일치} \rbrace$다.

### m 확률과 u 확률

각 필드에 두 확률을 정의한다.

| 기호 | 정의 | 직관 |
|------|------|------|
| $m_i$ | $P(\text{필드 } i \text{ 일치} \mid \text{진짜 매치 } M)$ | 같은 사람인데 이 필드가 일치할 확률. 오타·결측 때문에 1이 아니다 |
| $u_i$ | $P(\text{필드 } i \text{ 일치} \mid \text{비매치 } U)$ | 다른 사람인데 우연히 이 필드가 일치할 확률 |

$u_i$의 직관이 중요하다. 값의 종류가 많은 필드일수록 우연히 일치할 확률이 낮다. 균등 분포한 $N$개 값을 가진 필드면 $u_i \approx 1/N$이다. 그래서 **생년월일·전화번호가 일치하면 강한 증거**(작은 $u$), **성별이 일치하면 약한 증거**($u \approx 0.5$)다.

### 매치 가중치

각 필드의 기여를 로그 우도비(log-likelihood ratio)로 정의한다.

$$
w_i =
\begin{cases}
\log_2 \dfrac{m_i}{u_i} & \text{필드 } i \text{ 일치} \\[2mm]
\log_2 \dfrac{1 - m_i}{1 - u_i} & \text{필드 } i \text{ 불일치}
\end{cases}
$$

일치하면 양(+)의 가중치(증거 추가), 불일치하면 음(−)의 가중치(증거 차감)다. 필드들이 조건부 독립이라 가정하면 총 가중치는 그냥 합이다.

$$
W = \sum_{i=1}^{K} w_i
$$

이 $W$가 두 레코드가 같을 가능성의 점수다. 클수록 매치 쪽 증거가 강하다.

### 두 임계값

Fellegi-Sunter는 단일 컷이 아니라 **두 개의 임계값** $T_\lambda < T_\mu$로 세 영역을 만든다.

| 영역 | 판정 |
|------|------|
| $W \ge T_\mu$ | 자동 링크(match) |
| $T_\lambda < W < T_\mu$ | 보류 — 사람이 검토(clerical review) |
| $W \le T_\lambda$ | 자동 비링크(non-match) |

이 모델은 주어진 오류율 상한(허위 매치율·허위 비매치율) 아래에서 clerical review 영역을 **최소화하는 것이 최적**임을 증명했다. 즉 "확실한 건 자동으로, 애매한 것만 사람에게"가 이론적으로 정당화된다.

### m, u를 어떻게 구하나

- **라벨된 학습 데이터가 있으면** 매치/비매치 쌍에서 직접 빈도로 추정한다.
- **없으면 EM 알고리즘**으로 추정한다. 매치 여부를 잠재 변수로 두고 $m_i, u_i$와 매치 비율을 반복 갱신한다. 라벨 없이 동작하는 것이 실무에서 핵심이다 — 이 부분은 [[/data-architect/09_privacy_preserving_matching]]에서 다룬다.

<div class="callout-info">
Fellegi-Sunter가 오래된 이론이지만 여전히 표준인 이유는, 현대 도구(예: Splink)가 정확히 이 m/u + EM 구조를 그대로 구현하기 때문이다. 딥러닝 기반 ER도 등장했지만, 해석 가능성·라벨 없는 학습·감사 가능성 때문에 확률적 링키지가 여전히 프로덕션의 기본값이다.
</div>

---

## Blocking — 스케일을 위한 설계

Fellegi-Sunter는 "한 쌍을 어떻게 점수 매기나"를 푼다. 그런데 쌍이 너무 많다.

두 파일 크기가 각각 $n$이면 비교할 쌍은 $n \times n$, 한 파일 안에서 중복 제거는 $\binom{n}{2} \approx n^2/2$다. 100만 레코드면 약 **5,000억 쌍**이다. 전수 비교는 불가능하다.

**Blocking**은 비교 후보를 줄이는 기법이다. 같은 **블로킹 키**를 가진 레코드끼리만 비교한다. 핵심은 이것이 **정확도가 아니라 스케일을 위한 설계**라는 점이다 — 진짜 매치는 같은 블록에 들어간다고 가정하고, 블록 간 비교를 통째로 버린다.

### 대표 기법

| 기법 | 아이디어 | 특징 |
|------|---------|------|
| Standard blocking | 블로킹 키(예: 우편번호)가 같은 레코드를 한 블록으로 | 단순·빠름. 키 필드에 오타 있으면 매치를 놓침 |
| Sorted Neighborhood (SNM) | 정렬 키로 전체 정렬 후 고정 크기 윈도우를 슬라이딩 | 경계의 오타에 강함. 윈도우 크기가 트레이드오프 |
| q-gram / suffix | 문자열을 부분 문자열로 쪼개 여러 블록에 중복 배치 | 오타 내성 높음. 블록 수 증가 |
| Canopy clustering | 싼 유사도로 느슨한 캐노피를 만들고 그 안에서 정밀 비교 | 겹치는 클러스터 허용 |

### 평가 지표

블로킹 키 설계는 두 힘의 줄다리기다 — 후보를 많이 줄이되, 진짜 매치를 놓치지 말 것.

| 지표 | 정의 | 의미 |
|------|------|------|
| Reduction Ratio (RR) | $1 - \dfrac{\text{블로킹 후 쌍 수}}{\text{전체 쌍 수}}$ | 얼마나 줄였나 (높을수록 좋음) |
| Pairs Completeness (PC) | $\dfrac{\text{블록 안에 든 진짜 매치 수}}{\text{전체 진짜 매치 수}}$ | 진짜 매치를 얼마나 보존했나 (재현율) |
| Pairs Quality (PQ) | $\dfrac{\text{블록 안 진짜 매치 수}}{\text{블록 안 전체 쌍 수}}$ | 후보의 순도 (정밀도) |

블로킹 키가 너무 거칠면(예: 성별) 블록이 거대해 RR이 낮고, 너무 빡빡하면(예: 전체 주소 문자열) 오타 하나에 진짜 매치를 놓쳐 PC가 떨어진다. 그래서 **여러 블로킹 키를 OR로 결합**(multi-pass blocking)해 한 키에서 놓친 쌍을 다른 키가 잡게 하는 것이 일반적이다.

---

## Survivorship — 묶은 뒤 하나의 정답 만들기

매칭이 끝나면 "이 레코드들은 같은 사람"이라는 클러스터가 생긴다. 같은 개체로 판정된 레코드들을 연결 요소(connected component)로 묶으면 한 클러스터가 한 개체다. 그다음 질문은 **"그래서 이 사람의 진짜 이름·주소·생일은 무엇인가"**이다. 소스마다 값이 다를 수 있기 때문이다.

이 단계를 **Survivorship**이라 하고, 만들어진 단일 레코드를 **골든 레코드(golden record)**라 한다. MDM(Master Data Management)의 핵심 개념이다.

### 충돌하는 속성에서 살아남는 값 고르기

survivorship은 보통 **속성별로** 규칙을 정한다 — 이름은 이 규칙, 주소는 저 규칙.

| 규칙 | 살아남는 값 | 적합한 경우 |
|------|------------|-----------|
| Most recent | 가장 최근에 갱신된 값 | 주소·연락처처럼 변하는 속성 |
| Source priority | 신뢰도 높은 소스의 값 | 공식 등록 소스 vs 사용자 입력 |
| Most complete | 결측 아닌 값 | 한쪽만 채워진 필드 |
| Most frequent | 여러 소스에서 다수결 | 표기 변형이 많은 필드 |
| Longest / most specific | 가장 상세한 값 | `서울` vs `서울시 강남구` |

규칙이 충돌하면 우선순위로 푼다(예: source priority가 most recent보다 우선). 이 우선순위 결정이 곧 데이터 거버넌스의 핵심 설계 지점이다.

<div class="callout-info">
survivorship 규칙은 한 번 정하고 끝이 아니라 <strong>이력으로 남겨야</strong> 한다. 어떤 소스의 어떤 값이 언제 골든 레코드로 채택됐는지를 SCD2로 보존하면, 나중에 "왜 이 고객 주소가 이렇게 됐나"를 추적할 수 있다. resolve된 골든 레코드가 곧 온톨로지의 살아있는 엔티티가 된다 → [[/data-architect/07_ontology_core_concepts]].
</div>

---

## 전체 파이프라인으로 잇기

세 토대가 하나의 흐름으로 연결된다.

```
원본 레코드들
   │
   ▼  [Blocking]  ── 비교 후보 쌍만 생성 (n² → 다룰 수 있는 크기)
비교 후보 쌍
   │
   ▼  [Fellegi-Sunter]  ── 쌍마다 매치 가중치 W 계산, 임계값으로 판정
매치된 쌍
   │
   ▼  [Connected Components]  ── 같은 개체끼리 클러스터링
개체 클러스터
   │
   ▼  [Survivorship]  ── 클러스터마다 골든 레코드 1개 생성
골든 레코드 (= 온톨로지 엔티티)
```

이 순서가 record linkage의 표준 골격이다. blocking이 스케일을 만들고, Fellegi-Sunter가 판정을 만들고, survivorship이 최종 자산을 만든다.

---

## 정리

- 키가 깨끗하면 조인, 더러우면 **매칭** — "같을 확률"을 추정하는 문제다.
- **Fellegi-Sunter**: 필드별 $m/u$ 확률로 매치 가중치 $W = \sum \log_2(\cdot)$를 만들고, 두 임계값으로 자동 링크·보류·비링크를 가른다. $m, u$는 라벨 또는 EM으로 추정한다.
- **Blocking**: 정확도가 아니라 **스케일**을 위한 설계. $n^2$ 쌍을 줄이되 진짜 매치는 보존한다. RR·PC·PQ로 평가하고, 멀티패스로 보완한다.
- **Survivorship**: 묶은 클러스터에서 속성별 규칙으로 골든 레코드를 만든다. 우선순위 결정이 거버넌스의 핵심이고, 이력 보존이 추적성을 만든다.
- 다음 편([[/data-architect/09_privacy_preserving_matching]]): EM으로 라벨 없이 학습하기, 유사도 함수, 그리고 PII 없이 조직 간·익명 데이터를 잇는 프라이버시 보존 매칭.
