---
layout  : concept
title   : 올바른 Funnel 설계의 7가지 조건
date    : 2026-06-01 00:00:00 +0900
updated : 2026-06-01 00:00:00 +0900
tag     : data-analysis funnel analytics
toc     : true
comment : true
latex   : true
status  : complete
public  : true
parent  : [[/data-analysis]]
relations:
  - { type: references, target: /concept/data-architect/00_what_is_medaliion_architecture }
confidence     : medium
---

* TOC
{:toc}

funnel을 설계할 때 흔히 "단계를 늘어놓으면 된다"고 생각하기 쉽다. 하지만 각 조건 중 하나라도 어기면 전환율 숫자 자체가 의미를 잃는다. 아래 7가지는 funnel이 수학적으로 성립하기 위한 필요조건이다.

## 1. 단일 Grain — 한 funnel = 한 분석 단위

모든 단계가 같은 단위로 세어져야 한다 — 전부 session이거나, 전부 user이거나, 전부 item이거나.

단계 도중에 단위가 바뀌면 전환율이 의미를 잃는다. step1~3은 session 행동인데 "추천 상품 구매"는 item 질문이라면, 둘을 한 테이블에 섞는 순간 funnel이 깨진다.

> **규칙**: funnel을 세우기 전 "이건 무슨 단위를 세는 funnel인가"를 한 문장으로 정의한다.

## 2. 중첩(Nesting) — step N+1 ⊆ step N

funnel의 정의이다. 다음 단계 모집단은 반드시 이전 단계의 부분집합이어야 한다. 이게 성립해야 `step(N+1) / step(N)`이 "이전 단계 도달자 중 다음으로 간 비율"이라는 확률로 읽힌다.

"step3 > step2 가능", "step5 > step4 의도됨"이라고 적는 순간 그건 funnel이 아니다.

> **구현 규칙**: 각 단계를 `이 단계 조건 AND 직전 단계 충족`으로 cumulative하게 정의한다. 단순 OR flag(`has_X`)들을 나란히 두는 것으로는 절대 안 된다.

## 3. 단조성(Monotonicity) — 자연히 줄어듦

nesting이 성립하면 count는 단조 감소해야 정상이다 (`step1 ≥ step2 ≥ … ≥ stepN`).

중간이 늘어난다면 둘 중 하나다:
- nesting이 깨졌거나 (2번 위반)
- 데이터 공백

> **규칙**: 단조성 위반은 funnel 정의나 데이터를 고쳐야한다.

## 4. 일관된 Attribution Lane

단계마다 귀속 기준이 같아야 한다.

step1~3은 "AI 추천 경로"(strict, `item_list_id` 기반)인데 step4~5는 "세션 내 아무거나"(context-agnostic)로 바뀌면, 같은 funnel인데 측정 대상이 도중에 바뀐 것이다. 이 지점에서 전환율 비교의 기준이 어긋난다.

> **규칙**: strict면 끝까지 strict, broad면 끝까지 broad. 섞어야 한다면 두 개의 funnel로 분리한다.

## 5. 시간 순서 — 단계 = 진행

step 번호가 실제 시간/인과 순서를 반영해야 한다.

"step4 search가 step1 list보다 먼저 일어난다"면, 그건 순서가 아니라 배열 인덱스다. 시간 순서가 없으면 funnel이 아니다.

> **규칙**: 순서 정보가 없으면 그건 funnel이 아니라 flag 집합(OR set)이거나 ordinal 깊이 지표(ENUM)다.

## 6. 단계 = 상호배타 OR 명시적 누적

두 표현 방식 중 하나를 골라 일관되게 써야 한다.

| 방식 | 정의 | 특징 |
|---|---|---|
| **누적형(cumulative)** | stepN = "N단계까지 도달" | count 단조 감소, 전환율 funnel용 (대부분의 funnel) |
| **배타형(exclusive/deepest)** | 각 세션을 "가장 깊이 도달한 단계 하나"에만 배정 | 분포 합계 = 100% (ENUM, abandon flag) |

두 방식을 섞으면 단계 정의가 무효가 된다. `abandon` 설계가 대표적인 위반 사례다 — `checkout_abandon ⊂ cart_abandon` (`begin_checkout`은 `add_to_cart` 전제)인데 병렬 flag처럼 정의하면, "cart 이탈"과 "checkout 이탈"을 배타 단계로 읽을 때 틀린다.

> **배타형 구현 규칙**:
> ```
> cart_abandon     = ATC AND NOT begin_checkout AND NOT purchase
> checkout_abandon = begin_checkout AND NOT purchase
> ```
> 다음 단계를 명시적으로 빼야 진짜 배타가 된다.

## 7. 명시적 분모와 모집단 정의

"전환율 X%"는 분모 없이는 무의미하다. 각 단계가 "무엇 대비"인지 못 박아야 한다.

- **step-to-step**: 직전 단계 대비
- **overall**: 최초 모집단(step0) 대비

그리고 funnel의 시작 모집단(분모 0단계)이 뭔지 — 전체 세션? entry 세션? — 이게 안 정해지면 같은 funnel을 두 사람이 다른 숫자로 본다.

> **규칙**: entry predicate를 broad / narrow 이중으로 정의하는 순간 분모 불일치가 발생한다. 분모는 단 하나로 고정한다.

---

## 체크리스트

funnel을 설계하거나 리뷰할 때 아래를 순서대로 확인한다.

- 모든 단계의 grain이 동일한가?
- 각 단계가 `이 단계 조건 AND 직전 단계`로 cumulative하게 정의되어 있는가?
- count가 단조 감소하는가? 위반 시 원인을 규명했는가?
- attribution 기준이 첫 단계부터 마지막 단계까지 일관한가?
- step 번호가 시간/인과 순서를 반영하는가?
- 누적형/배타형 중 하나를 일관되게 선택했는가?
- 분모(step0 모집단)가 명시적으로 정의되어 있는가?
