---
layout      : concept
title       : 어트리뷰션 개념과 마트 설계
date        : 2026-07-05 00:00:00 +0900
updated     : 2026-07-05 00:00:00 +0900
tag         : attribution marketing-analytics data-mart data-analytics
toc         : true
comment     : true
latex       : true
status      : complete
public      : true
parent      : [[/data-analytics]]
confidence  : high
relations:
  - { type: references, target: concept/data-analytics/07_acquisition_analysis }
  - { type: references, target: concept/data-analytics/06_ga4_data_model }
  - { type: references, target: adr/data-engineering/2026-001-data-mart-checklist }
---

* TOC
{:toc}

어트리뷰션(attribution)이 무엇인지 정리하고, 이를 데이터 마트로 어떻게 만드는지를 다룬다. 획득 분석([[07_acquisition_analysis]])에서 "어느 채널이 데려왔는가"를 계산하는 기반이 이 마트다.

## 어트리뷰션이 무엇인가

유저는 전환(구매·가입)에 도달하기 전에 여러 접점을 거친다. 검색 광고를 클릭하고, 며칠 뒤 이메일을 열고, 마지막에 브랜드명을 검색해서 들어와 구매하는 식이다. 이때 "이 전환은 어느 채널의 성과인가"라는 질문에는 관측만으로 정해지는 답이 없다. 세 접점이 모두 관여했기 때문이다.

**어트리뷰션은 이 질문에 답하기 위해 기여를 배분하는 규칙이다.** 핵심은 "규칙"이라는 점이다 — 사실의 측정이 아니라 합의된 배분 방식이므로, 규칙을 바꾸면 채널 성과 숫자도 바뀐다. 어트리뷰션 수치를 읽을 때 항상 "어떤 규칙의 결과인가"를 함께 봐야 하는 이유다.

어트리뷰션 규칙은 세 가지 요소로 구성된다.

| 구성 요소 | 결정할 것 | 예 |
|----------|----------|-----|
| 접점(touchpoint) 인정 범위 | 무엇을 접점으로 볼 것인가 | 클릭만 인정 / 노출(view)도 인정 |
| 윈도우(window) | 전환 전 얼마까지의 접점을 인정할 것인가 | 클릭 후 7일, 노출 후 1일 |
| 배분 모델(model) | 인정된 접점들에 기여를 어떻게 나눌 것인가 | 아래 표 |

## 배분 모델의 종류

유저 여정이 "① 검색 광고 클릭 → ② 이메일 클릭 → ③ 브랜드 검색 → 전환(10만 원)"일 때, 모델별 배분은 이렇게 달라진다.

| 모델 | 규칙 | ① 검색광고 | ② 이메일 | ③ 브랜드검색 |
|------|------|-----------|---------|-------------|
| Last click | 마지막 접점에 100% | 0 | 0 | 100,000 |
| Last non-direct | direct를 제외한 마지막 접점에 100% | 0 | 0 | 100,000 |
| First click | 첫 접점에 100% | 100,000 | 0 | 0 |
| Linear | 균등 배분 | 33,333 | 33,333 | 33,333 |
| Time decay | 전환에 가까울수록 가중 | 20,000 | 30,000 | 50,000 |
| Position-based | 처음·마지막 40%씩, 중간 20% | 40,000 | 20,000 | 40,000 |
| Data-driven (DDA) | 모델이 접점별 기여도를 추정해 배분 | 모델 산출값 | " | " |

어떤 모델이 "맞다"는 없다. 각 모델은 관점이다 — last click은 전환 직전의 마무리 역할을, first click은 처음 데려온 발견 역할을 크게 본다. 실무에서 흔한 구성은 **운영 기본값 하나(last non-direct 또는 DDA)를 정하되, first touch를 함께 저장해서 두 관점을 비교**하는 것이다.

DDA는 GA4 등의 기본값인데, 배분 로직이 공개되지 않는 블랙박스라는 특성이 있다. 재현 가능한 숫자가 필요한 분석에는 규칙 기반 모델을 자체 계산하는 편이 낫다.

## 스코프 구분

어트리뷰션에는 "무엇의 소스인가"라는 스코프 구분이 있다. GA4 데이터 모델([[06_ga4_data_model]])의 세 필드가 정확히 이 구분이다.

| 스코프 | 뜻 | GA4 필드 |
|--------|-----|---------|
| user | 그 유저를 처음 데려온 채널 (first touch, 이후 불변) | `traffic_source.*` |
| session | 그 세션을 시작시킨 채널 | `session_traffic_source_last_click.*` |
| event(전환) | 그 전환에 기여한 채널 (배분 모델 적용 대상) | 어트리뷰션 리포트 |

채널 분석 오류의 상당수가 스코프 혼동에서 나온다. 유저 스코프(first touch)로 이번 달 캠페인 성과를 평가하면, 3년 전에 데려온 채널이 이번 달 매출의 공을 가져간다.

## 어트리뷰션이 답하지 못하는 것

- **인과가 아니다.** "그 광고가 없었어도 왔을 유저"를 구분하지 못한다. 이 질문은 홀드아웃 테스트(광고를 끈 그룹과의 비교)로만 답할 수 있다. 어트리뷰션은 예산 배분의 운영 지표로 쓰고, 큰 예산의 검증은 증분 측정으로 한다([[07_acquisition_analysis]]).
- **식별자의 한계를 넘지 못한다.** 접점과 전환을 같은 유저로 묶을 수 있어야 배분이 가능하다. 크로스 디바이스(폰에서 광고 보고 PC에서 구매), 쿠키 제한, 앱 추적 제한(ATT)으로 묶지 못한 여정은 direct나 오가닉으로 새어 나간다. direct 비율의 증가는 대개 채널 성과가 아니라 식별 실패의 신호다.

## 마트로 어떻게 만드는가

설계 원칙은 하나다: **사실(접점)과 해석(배분 결과)을 분리해서 저장한다.** 어트리뷰션은 규칙의 결과이므로 규칙이 바뀔 수 있고, 바뀌었을 때 원본은 그대로 두고 배분 결과만 다시 계산할 수 있어야 한다. (일반 원칙은 [[2026-001-data-mart-checklist]] 참고.)

### 테이블 1. 접점 원장 — `fct_touchpoint`

그레인: **접점 1행**. 규칙 적용 전의 사실만 담는다.

| 컬럼 | 설명 | 어디에 쓰이나 |
|------|------|-------------|
| touchpoint_id | 접점 식별자 | 배분 결과에서 참조 |
| user_id | 유저 (식별 가능한 수준에서) | 여정 묶기 |
| touched_at | 접점 시각 | 윈도우 판정, 순서 |
| channel, source, medium, campaign | 정규화된 채널 정보 | 배분 축 |
| touch_type | click / impression | 접점 인정 범위 적용 |
| raw_utm | 원본 UTM (정규화 전) | 규약 위반 추적, 재처리 |

채널 정규화(대소문자, 표기 통일)는 여기서 한 번만 한다. 원본 UTM을 함께 남겨두면 정규화 규칙이 바뀌어도 재처리할 수 있다.

### 테이블 2. 전환 원장 — `fct_conversion`

그레인: **전환 1행**. 전환 마트([[09_conversion_analysis]])의 `fct_order`를 그대로 쓰거나, 전환 유형이 여럿이면(구매·가입·구독) 통합 뷰를 둔다. 필요한 컬럼: conversion_id, user_id, converted_at, conversion_type, value.

### 테이블 3. 배분 결과 팩트 — `fct_attributed_conversion`

그레인: **전환 × 기여 접점 1행**. 여기가 어트리뷰션 마트의 본체다.

| 컬럼 | 설명 | 어디에 쓰이나 |
|------|------|-------------|
| conversion_id | 전환 | 원장 참조 |
| touchpoint_id | 기여 접점 (없으면 NULL) | " |
| channel, campaign | 접점의 채널 (비정규화 복사) | 집계 편의 |
| credit | 기여 비율 (0~1) | 배분 |
| attributed_value | value × credit | 채널별 매출 기여 |
| model | last_click / first_click / linear ... | 모델 병존 |
| window_days | 적용 윈도우 | 규칙 명시 |
| rule_version | 규칙 버전 | 규칙 변경 이력 |

이 구조의 장점:

- **한 전환에 여러 모델의 결과를 병존시킬 수 있다.** last click과 first click을 같은 테이블에서 `model` 필터로 비교한다.
- **규칙이 바뀌면 이 테이블만 다시 만든다.** 접점·전환 원장은 그대로다.
- **품질 테스트가 명확하다.** 전환·모델별 `SUM(credit) = 1.0` 검증, 그리고 접점을 못 찾은 전환은 버리지 않고 `channel = 'direct/unattributed'` 행으로 남긴다 — 채널별 합계가 전체 전환과 일치해야 새는 곳을 발견할 수 있다.

### 배분 생성 예시 — last click

```sql
INSERT INTO fct_attributed_conversion
SELECT
  c.conversion_id,
  t.touchpoint_id,
  COALESCE(t.channel, 'direct/unattributed') AS channel,
  t.campaign,
  1.0                    AS credit,
  c.value                AS attributed_value,
  'last_click'           AS model,
  7                      AS window_days,
  'v3'                   AS rule_version
FROM fct_conversion c
LEFT JOIN fct_touchpoint t
  ON t.user_id = c.user_id
 AND t.touch_type = 'click'
 AND t.touched_at BETWEEN TIMESTAMP_SUB(c.converted_at, INTERVAL 7 DAY)
                      AND c.converted_at
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY c.conversion_id ORDER BY t.touched_at DESC) = 1
```

linear 모델이라면 마지막 한 건 대신 윈도우 내 전체 접점에 `1 / COUNT(*) OVER (PARTITION BY conversion_id)`를 credit으로 주면 된다. 모델 추가가 "쿼리 하나 추가"로 끝나는 구조가 목표다.

### 사용 예시 — 모델별 채널 성과 비교

```sql
SELECT
  channel,
  SUM(IF(model = 'last_click',  attributed_value, 0)) AS value_last_click,
  SUM(IF(model = 'first_click', attributed_value, 0)) AS value_first_click
FROM fct_attributed_conversion
WHERE DATE(converted_at) BETWEEN '2026-06-01' AND '2026-06-30'
GROUP BY channel
ORDER BY value_last_click DESC
```

두 컬럼의 차이가 큰 채널이 해석이 필요한 채널이다 — first click만 높은 채널은 발견 역할(상단 퍼널), last click만 높은 채널은 마무리 역할에 가깝다.

### 마트를 만들 때 중요한 것

- **지각 귀속을 lookback으로 처리한다.** 전환은 접점보다 늦게 일어나고, 윈도우가 7일이면 오늘 들어온 전환이 지난주 접점의 성과를 바꾼다. 배분 결과는 전환일 기준으로 파티셔닝하고, 최근 N일(윈도우 + 데이터 지연)을 매일 다시 계산한다.
- **규칙 변경은 rule_version을 올리고 재계산한다.** 버전 없이 덮어쓰면 과거 리포트와의 불일치를 설명할 수 없게 된다.
- **자기 유입을 접점에서 제외한다.** 결제 PG·본인인증 도메인에서의 복귀가 접점으로 잡히면 마지막 접점을 항상 PG가 가져간다. 접점 원장 적재 단계에서 제외 목록을 적용한다.
- **채널별 합계와 전체 전환의 일치를 테스트로 강제한다.** unattributed 버킷을 포함한 합이 전환 원장의 총계와 같아야 한다. 이 테스트가 없으면 배분에서 새는 전환을 발견하지 못한다.
- **식별자 통합 수준을 문서화한다.** user_id 매칭이 로그인 유저만 되는지, 디바이스 간 매핑이 있는지에 따라 이 마트의 정확도 상한이 정해진다. 마트 설명에 이 한계를 명시해야 소비자가 숫자를 과신하지 않는다.

## 체크리스트

- [ ] 접점 인정 범위(클릭/노출)·윈도우·모델이 문서화되어 있다
- [ ] 사실(접점 원장)과 해석(배분 결과)이 분리되어 있다
- [ ] 배분 결과에 model·window·rule_version 컬럼이 있다
- [ ] 전환·모델별 credit 합 = 1.0 테스트가 있다
- [ ] unattributed 버킷 포함 채널 합계 = 전체 전환 테스트가 있다
- [ ] 윈도우 + 지연만큼의 lookback 재계산이 있다
- [ ] PG·본인인증 등 자기 유입이 접점에서 제외된다
- [ ] UTM 정규화가 접점 원장 한 곳에서만 이루어지고 원본이 보존된다

## 한계

- 어트리뷰션 마트는 기여 배분까지만 책임진다. "광고를 늘리면 전환이 늘어나는가"라는 인과 질문은 홀드아웃·증분 측정의 영역이다.
- 식별자 제약(크로스 디바이스, 쿠키 제한)으로 묶지 못한 여정은 어떤 모델로도 복원되지 않는다. 프라이버시 규제가 강해질수록 이 마트의 커버리지는 줄어드는 방향이고, 집계 기반 방법(MMM)의 보완 필요성이 커진다.
