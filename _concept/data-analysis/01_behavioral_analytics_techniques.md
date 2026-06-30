---
layout      : concept
title       : 행동 데이터 분석 핵심 기법 5가지
date        : 2026-06-29 00:00:00 +0900
updated     : 2026-06-29 00:00:00 +0900
tag         : data-analysis cohort retention ab-test rfm path-analysis analytics
toc         : true
comment     : true
latex       : true
status      : complete
public      : true
parent      : [[/data-analysis]]
confidence  : high
---

사용자 행동을 분석하는 기법은 각자 대답하는 질문이 다르다. 어떤 기법을 쓰느냐보다 어떤 질문에 답해야 하는가를 먼저 정해야 한다.

---

## 기법 선택 지도

| 질문 | 기법 |
|---|---|
| 한 번 온 사람이 다시 왔나? | 리텐션 분석 |
| 어떤 집단이 더 건강한가? | 코호트 분석 |
| 어떤 사람이 핵심 사용자인가? | RFM 세그멘테이션 |
| 이 변화가 진짜 효과가 있었나? | A/B 테스트 |
| 사용자가 실제로 걷는 경로는? | 경로 분석 |

---

## 1. 리텐션 분석 (Retention Analysis)

### 무엇을 보는가

리텐션은 "한번 온 사람이 다시 왔는가"를 시간축으로 추적한다. 단일 세션 안의 행동이 아니라, 세션 간 재방문 패턴을 다룬다.

### 세 가지 리텐션 정의

| 유형 | 정의 | 언제 쓰나 |
|---|---|---|
| **N-Day** | 첫 방문 N일 후 정확히 그날 재방문 | 날마다 쓰는 앱 (소셜, 뉴스) |
| **Unbounded** | 첫 방문 N일 이후 언제라도 재방문 | 느린 주기 서비스 (e커머스, B2B) |
| **Rolling** | 최근 N일 내 재방문 | 주간/월간 DAU 지표 |

**N-Day 리텐션이 흔히 틀리는 이유**: "Day 7 retention 30%"를 보고 "70%가 이탈"이라고 읽는 함정. Day 7 방문자는 Day 8~30에 재방문할 수 있다. N-Day는 각 날의 스냅샷이지, 이탈 선고가 아니다.

### 리텐션 곡선의 형태

정상적인 리텐션 곡선은 초반 급감 후 안정(flatten)된다.

```
100% ─┐
      │\
      │  \
      │    \___________  ← flattening point (빠를수록 좋다)
0%  ──┴──────────────────→ Day N
```

- **곡선이 수평 구간에 진입하지 않고 0으로 수렴** → 제품이 habit을 형성하지 못하는 신호
- **초반 급감이 매우 가파름** → 온보딩/첫 경험 문제
- **특정 시점에 반등** → 알림, 마케팅 등 외부 개입 → 자연 리텐션과 분리해서 봐야 함

### 실전 구현

```sql
-- Day N 리텐션 기본 패턴
WITH first_visit AS (
  SELECT user_id, MIN(DATE(event_time)) AS cohort_date
  FROM events
  WHERE event_name = 'session_start'
  GROUP BY user_id
),
return_visits AS (
  SELECT e.user_id, DATE(e.event_time) AS visit_date
  FROM events e
  WHERE e.event_name = 'session_start'
)
SELECT
  f.cohort_date,
  DATE_DIFF(r.visit_date, f.cohort_date, DAY) AS day_n,
  COUNT(DISTINCT r.user_id) AS retained_users,
  COUNT(DISTINCT f.user_id) AS cohort_size,
  COUNT(DISTINCT r.user_id) / COUNT(DISTINCT f.user_id) AS retention_rate
FROM first_visit f
LEFT JOIN return_visits r ON f.user_id = r.user_id
  AND r.visit_date > f.cohort_date  -- 첫날 제외
GROUP BY 1, 2
ORDER BY 1, 2
```

> **규칙**: `LEFT JOIN`을 쓰지 않으면 재방문한 사람만 분모에 남는다. 분모는 항상 첫 방문 전체 cohort여야 한다.

### 체크리스트

- "재방문"의 정의가 명확한가? (세션 시작? 특정 행동?)
- N-Day인지 Unbounded인지 명시했는가?
- 분모는 해당 cohort의 전체 첫 방문자인가?
- 마케팅/알림 개입일을 별도로 표시하고 있는가?

---

## 2. 코호트 분석 (Cohort Analysis)

### 리텐션과의 차이

리텐션은 "돌아왔나"를 본다. 코호트 분석은 **"어떤 집단이 더 잘 돌아오나"**를 본다. 코호트(집단)를 정의하는 기준이 핵심이다.

### 코호트 정의 두 가지

| 종류 | 예시 | 쓰임새 |
|---|---|---|
| **획득 코호트** | 2025년 1월 가입자, 2025년 2월 가입자 | 제품/마케팅 변화의 시계열 효과 |
| **행동 코호트** | 첫 주문을 완료한 사람 vs. 장바구니만 담은 사람 | 특정 행동의 예측력 확인 |

### 코호트 히트맵 읽는 법

```
코호트   D0    D1    D7    D30
Jan 25  100%  45%   22%   12%
Feb 25  100%  48%   25%   15%  ← 개선 신호
Mar 25  100%  51%   28%   17%
```

- **수직으로 보기**: 같은 Day N에서 코호트가 개선되고 있다면 제품이 발전하는 증거
- **수평으로 보기**: 특정 코호트의 리텐션 곡선 형태
- **대각선으로 보기**: 같은 캘린더 날짜를 서로 다른 코호트가 어떻게 보내는지 (계절성 분리)

### 행동 코호트의 실전 예시

"첫 구매를 7일 이내에 한 사람"이 30일 리텐션에 어떤 영향을 미치는지 보고 싶다면:

```sql
WITH first_purchase_cohort AS (
  SELECT
    user_id,
    MIN(order_date) AS first_order_date,
    DATE_DIFF(MIN(order_date), signup_date, DAY) AS days_to_first_purchase
  FROM orders o
  JOIN users u USING (user_id)
  GROUP BY user_id, signup_date
)
SELECT
  CASE WHEN days_to_first_purchase <= 7 THEN 'early_buyer'
       WHEN days_to_first_purchase <= 30 THEN 'late_buyer'
       ELSE 'never_bought' END AS cohort,
  -- 이후 30일 리텐션 로직
  ...
```

> **주의**: 행동 코호트는 생존 편향에 주의해야 한다. "30일 이내 구매자"를 코호트로 삼으면, 그 30일을 살아남은 사람만 포함된다. 비교 대조군을 같은 시간 조건으로 맞춰야 한다.

---

## 3. RFM 세그멘테이션

### 무엇인가

RFM은 사용자를 세 축으로 측정해 세그먼트를 나누는 기법이다:

- **R**ecency: 마지막 행동이 얼마나 최근인가
- **F**requency: 얼마나 자주 행동하는가
- **M**onetary: 얼마나 많이 지불했는가

특정 세션이나 이벤트가 아니라 **사용자의 전체 이력**으로 "이 사람이 어떤 사람인가"를 분류한다.

### 구현

```sql
WITH rfm_raw AS (
  SELECT
    user_id,
    DATE_DIFF(CURRENT_DATE(), MAX(order_date), DAY) AS recency,
    COUNT(DISTINCT order_id) AS frequency,
    SUM(order_amount) AS monetary
  FROM orders
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
  GROUP BY user_id
),
rfm_scored AS (
  SELECT
    user_id,
    NTILE(5) OVER (ORDER BY recency DESC)   AS r_score,  -- 낮을수록 최근
    NTILE(5) OVER (ORDER BY frequency ASC)  AS f_score,
    NTILE(5) OVER (ORDER BY monetary ASC)   AS m_score
  FROM rfm_raw
)
SELECT
  user_id,
  r_score, f_score, m_score,
  CASE
    WHEN r_score >= 4 AND f_score >= 4 THEN 'Champions'
    WHEN r_score >= 3 AND f_score >= 3 THEN 'Loyal'
    WHEN r_score >= 4 AND f_score <= 2 THEN 'New Customer'
    WHEN r_score <= 2 AND f_score >= 3 THEN 'At Risk'
    WHEN r_score <= 2 AND f_score <= 2 THEN 'Lost'
    ELSE 'Potential'
  END AS segment
FROM rfm_scored
```

### 세그먼트별 액션

| 세그먼트 | 특징 | 권장 액션 |
|---|---|---|
| Champions | R↑ F↑ M↑ | VIP 프로그램, 리뷰 요청 |
| Loyal | F↑ M↑ but R 보통 | 재방문 유인, 번들 오퍼 |
| At Risk | 과거 고빈도, 최근 감소 | 리텐션 캠페인, 이탈 원인 조사 |
| Lost | R↓ F↓ | 저비용 윈백 또는 포기 |
| New Customer | R↑ F↓ | 온보딩 강화, 첫 재구매 유도 |

### 흔한 실수

1. **분석 기간 고정하지 않기**: 1년치와 2년치를 섞으면 recency 기준이 달라진다. 항상 고정 윈도우를 명시한다.
2. **NTILE 경계 맹신**: NTILE은 분포를 균등하게 자를 뿐이다. "Top 20%"의 실제 행동 차이가 유의미한지 확인해야 한다.
3. **Monetary 0 포함**: 구매 이력이 없는 사용자를 포함할 건지 먼저 결정한다. 포함하면 세그먼트 의미가 희석된다.

---

## 4. A/B 테스트 (실험 설계)

### 관찰과 인과의 차이

리텐션·코호트·RFM은 **관찰**이다. A/B 테스트만이 **인과**를 말할 수 있다. "전환율이 올랐다"를 인과적으로 주장하려면 A/B 테스트가 필요하다.

### 필수 사전 체크: Sample Ratio Mismatch (SRM)

실험 시작 전 설계한 트래픽 비율(예: 50:50)과 실제 수집된 비율이 다르면, 나머지 지표는 신뢰할 수 없다. 결과를 보기 전에 SRM 먼저 확인한다.

```python
from scipy.stats import chi2_contingency
import numpy as np

# 기대: 50:50, 실제: control 10000, treatment 9500
observed = np.array([10000, 9500])
expected_ratio = np.array([0.5, 0.5])
n_total = observed.sum()
expected = expected_ratio * n_total

chi2, p_value, _, _ = chi2_contingency(
    np.array([observed, expected]).reshape(2, 2)
)
# p < 0.01 → SRM 존재, 실험 무효
```

**SRM 원인**: 봇 트래픽 차이, 할당 로직 버그, 캐시로 인한 노출 누락. SRM이 있으면 실험을 중단하고 원인을 먼저 제거해야 한다.

### Novelty Effect

새로운 UI를 보여주면 처음에는 클릭이 증가한다. 이게 진짜 효과인가, 새로움에 대한 반응인가를 구분해야 한다.

- **방법**: 실험 기간을 충분히 길게 (최소 2주) 가져가고, 시간대별 지표를 추적한다.
- **신호**: 초반에 treatment가 높다가 후반에 수렴하면 novelty effect 가능성이 높다.

### CUPED (Controlled-experiment Using Pre-Experiment Data)

같은 샘플 수로 검출력을 높이는 분산 감소 기법이다. 실험 전 데이터(pre-experiment covariate)를 활용해 결과 변수의 분산을 줄인다.

$$Y^{\text{cuped}} = Y - \theta \cdot (X - \bar{X})$$

여기서 $X$는 실험 전 같은 지표, $\theta = \text{Cov}(Y, X) / \text{Var}(X)$

CUPED를 적용하면 분산이 줄어 같은 효과 크기를 더 빠르게 검출할 수 있다. 특히 기저 분산이 높은 매출 지표에서 유효하다.

### 실험 설계 체크리스트

- 가설이 방향성 있게 명시되어 있는가? ("CTR이 높아질 것이다" O, "CTR이 변할 것이다" X)
- 샘플 사이즈 계산을 사전에 했는가? (power ≥ 0.8, α = 0.05)
- Primary metric과 guardrail metric이 구분되어 있는가?
- 분석 전에 SRM을 확인했는가?
- 실험 기간이 최소 완전한 주간 사이클(7일)을 포함하는가?
- 조기 종료(p-hacking)하지 않는가?

---

## 5. 경로 분석 (Path Analysis)

### 무엇인가

경로 분석은 **사용자가 실제로 어떤 순서로 움직이는지**를 데이터에서 발견한다. 미리 정해진 경로를 검증하는 게 아니라, 데이터로부터 경로 가설을 만드는 데 쓰인다.

### Top N 경로 분석

```sql
WITH page_sequence AS (
  SELECT
    session_id,
    page_name,
    ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY event_time) AS step_num
  FROM pageview_events
),
paths AS (
  SELECT
    session_id,
    STRING_AGG(page_name, ' → ' ORDER BY step_num) AS path
  FROM page_sequence
  WHERE step_num <= 5  -- 최대 5단계
  GROUP BY session_id
)
SELECT
  path,
  COUNT(*) AS session_count,
  COUNT(*) / SUM(COUNT(*)) OVER () AS path_share
FROM paths
GROUP BY path
ORDER BY session_count DESC
LIMIT 20
```

이걸로 "구매 완료 세션의 30%가 홈 → 검색 → PDP → 장바구니 → 결제 순서를 밟는다"와 같은 사실을 발견할 수 있다.

### 산키 다이어그램(Sankey Diagram)

경로 분석 결과를 시각화할 때 산키 다이어그램을 쓴다. 흐름의 두께가 볼륨을 나타내서 "어디서 어디로 얼마나 갔나"를 직관적으로 보여준다.

- **좋은 사례**: 어떤 페이지가 "목적지" 역할을 하는지, 어떤 페이지가 "경유지"인지 구분
- **나쁜 사례**: 경로 수가 너무 많아 스파게티가 됨 → 상위 5~10개 경로만 추출하거나, 페이지를 카테고리로 묶어야 함

### 이탈 전 경로 분석

"구매 직전에 포기한 사람들이 어디서 왔나"를 역방향으로 추적:

```sql
-- 결제 포기 직전 3단계를 추출
WITH cart_abandons AS (
  SELECT session_id
  FROM session_events
  WHERE reached_cart = 1 AND completed_purchase = 0
),
pre_abandon_path AS (
  SELECT
    p.session_id,
    STRING_AGG(p.page_name, ' → ' ORDER BY p.event_time DESC LIMIT 3) AS last_3_pages
  FROM pageview_events p
  JOIN cart_abandons ca USING (session_id)
  GROUP BY p.session_id
)
SELECT last_3_pages, COUNT(*) AS cnt
FROM pre_abandon_path
GROUP BY 1
ORDER BY 2 DESC
```

이 결과에서 "배송비 안내 페이지 → 결제 포기" 패턴이 많다면 배송비 노출 방식이 문제일 수 있다.

### 경로 분석의 한계

경로 분석은 상관을 보여줄 뿐이다. "이 경로를 탄 사람이 구매율이 높다"가 "이 경로를 만들면 구매율이 오른다"를 의미하지 않는다. 인과 검증은 A/B 테스트가 해야 한다.

---

## 기법 간 연결 흐름

분석 기법들은 독립적으로 쓰이지 않는다. 하나의 발견이 다음 질문을 만든다:

```
경로 분석 → "검색 → PDP 경로의 구매율이 높다"는 패턴 발견
     ↓
코호트 분석 → 검색 경로를 탄 집단의 리텐션이 실제로 더 좋은가 확인
     ↓
A/B 테스트 → 검색 기능을 개선했을 때 진짜로 효과가 있는지 인과 검증
     ↓
RFM 세그멘테이션 → 개선된 검색으로 유입된 사람들이 장기적으로 어떤 세그먼트가 되는가
     ↓
리텐션 분석 → 해당 세그먼트의 리텐션 곡선이 안정 구간에 진입하는가
```

---

## 전체 체크리스트

**리텐션**
- 리텐션 정의(N-Day / Unbounded / Rolling)를 명시했는가?
- 분모는 항상 cohort 전체인가?
- 마케팅 개입 시점을 분리해서 보고 있는가?

**코호트**
- 획득 코호트인가, 행동 코호트인가?
- 행동 코호트는 생존 편향 보정을 했는가?
- 수직(시계열 개선), 수평(개별 리텐션 형태) 두 방향 모두 읽었는가?

**RFM**
- 분석 기간 윈도우를 고정했는가?
- Monetary 0인 사용자 처리 방침을 결정했는가?
- NTILE 경계가 의미 있는 행동 차이를 만드는지 확인했는가?

**A/B 테스트**
- SRM 확인을 결과 분석 전에 했는가?
- 샘플 사이즈 계산을 사전에 했는가?
- Novelty effect를 배제할 만큼 충분한 기간을 운영했는가?
- Primary metric과 guardrail metric을 사전에 정의했는가?

**경로 분석**
- 경로 수를 상위 N개 또는 카테고리 묶음으로 제한했는가?
- 발견한 패턴은 상관임을 인지하고 있는가?
- 인과 검증은 A/B 테스트로 이어지는가?
