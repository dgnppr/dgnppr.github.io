---
layout      : concept
title       : 사용자 행동 분석 프레임워크 설계
date        : 2026-06-30 00:00:00 +0900
updated     : 2026-06-30 00:00:00 +0900
tag         : data-analysis behavior-analytics framework identity-resolution omnichannel event-tracking cdp bigquery
toc         : true
comment     : true
latex       : true
status      : complete
public      : true
parent      : [[/data-analysis]]
confidence  : medium
relations:
  - { type: extends, target: concept/data-analysis/02_event_tracking_design }
  - { type: references, target: concept/data-analysis/00_how_to_design_funnel }
  - { type: references, target: concept/data-analysis/01_behavioral_analytics_techniques }
  - { type: references, target: concept/data-analysis/03_metrics_framework }
---

## 문제 정의

리테일 분석에서 반복되는 케이스 하나로 시작한다. 한 사용자가 앱에서 운동화를 검색하고, 매장에 들러 같은 운동화를 신어본 뒤, 며칠 후 웹에서 결제했다. 분석 시스템은 이 구매를 "웹 직접 유입"으로 집계한다. 검색을 일으킨 앱도, 결정에 기여한 매장 체험도 기여 분석에 잡히지 않는다. 결과적으로 매장 체험의 ROI가 0으로 보이고, 다음 분기 예산 배분이 왜곡된다.

이건 분석 기법의 문제가 아니다. 리텐션 공식이나 퍼널 쿼리가 틀린 게 아니라, **한 사람의 행동이 채널별로 분리된 데이터 저장소에 흩어져 있어 애초에 연결할 수 없는** 구조적 문제다. 개별 기법을 정교하게 다듬어도 풀리지 않는다.

이 글은 채널과 무관하게 한 사용자의 행동을 하나의 흐름으로 분석하는 **프레임워크**를 5개 레이어로 정리한다. 온·오프라인 통합을 기준 케이스로 잡는데, 통합 상황에서 프레임워크의 모든 취약점이 드러나기 때문이다.

---

## 왜 단일 기법이 아니라 프레임워크인가

기존 자산들의 역할을 먼저 정리한다.

| 글 | 다루는 것 | 전제 |
|---|---|---|
| [핵심 기법 5가지](/concept/data-analysis/01_behavioral_analytics_techniques) | 리텐션·코호트·RFM·경로 분석 | 정제된 행동 데이터가 이미 있음 |
| [이벤트 트래킹 설계](/concept/data-analysis/02_event_tracking_design) | 그 데이터를 만드는 스키마 | 단일 채널 가정 |
| [퍼널 설계](/concept/data-analysis/00_how_to_design_funnel) | 단계별로 보는 법 | 사용자 식별이 됨 |
| [지표 체계](/concept/data-analysis/03_metrics_framework) | 무엇을 측정할지 | 측정 대상이 통합돼 있음 |

넷 다 옳지만 서로의 전제를 공유하지 않는다. 프레임워크는 이들을 하나의 수직 스택으로 쌓아 "원천 행동 → 정제된 이벤트 → 세션 → 지표 → 분석"의 흐름이 끊기지 않게 만드는 구조다. 스택의 최하단, 가장 자주 실패하는 지점이 **정체성(identity)** 이다.

| 레이어 | 질문 | 핵심 산출물 |
|---|---|---|
| **L1 Identity** | 이 행동은 누구의 것인가? | `unified_user_id` |
| **L2 Event** | 무슨 일이 언제 일어났는가? | 채널 통합 이벤트 스키마 |
| **L3 Session** | 어디서 어디까지가 한 맥락인가? | 크로스채널 여정 |
| **L4 Metric** | 무엇을 좋다고 볼 것인가? | NSM·가드레일 지표 |
| **L5 Analysis** | 무엇을 바꿀 것인가? | 퍼널·코호트·기여 |

아래부터 위로 쌓는다. **L1이 틀리면 위 네 층이 전부 잘못된 집계를 만든다.**

---

## L1. Identity

온라인은 비교적 단순하다. 비로그인 사용자에게 `anonymous_id`(쿠키·디바이스 ID)를 부여하고 로그인 시 `user_id`와 묶는다. 오프라인은 다르다. 매장 방문자에게는 쿠키가 없으므로, 이 사람을 온라인의 동일인과 연결할 신호가 따로 필요하다.

연결 신호는 두 종류다.

| 방식 | 신호 | 신뢰도 | 예시 |
|---|---|---|---|
| 확정적(deterministic) | 로그인, 멤버십 번호, 카드 해시, 전화번호 | 높음 | 매장 멤버십 적립 → `user_id` 연결 |
| 확률적(probabilistic) | 동일 와이파이·위치, 시간 근접, 디바이스 핑거프린트 | 낮음 | 매장 와이파이 MAC ↔ 앱 디바이스 ID 추정 |

설계 원칙은 **확정적 신호를 최대한 확보해 확률적 추정 의존도를 낮추는 것**이다. 멤버십 적립 유도 UX, QR 영수증, 앱 결제 연동이 분석 인프라의 일부인 이유다. 확률적 매칭은 오탐(false merge)이 한 번 발생하면 두 사용자의 행동이 한 사람으로 병합되며, 사후 분리가 매우 어렵다.

ID 연결은 append-only 엣지 로그로 관리한다.

```sql
-- identity_edges: 관측된 ID 연결 로그
CREATE TABLE `project.dataset.identity_edges` (
  edge_id        STRING NOT NULL,
  id_type_a      STRING NOT NULL,   -- anonymous_id | user_id | membership_no | card_hash | phone_hash
  id_value_a     STRING NOT NULL,
  id_type_b      STRING NOT NULL,
  id_value_b     STRING NOT NULL,
  match_type     STRING NOT NULL,   -- deterministic | probabilistic
  confidence     FLOAT64 NOT NULL,  -- 1.0=확정, <1.0=추정
  observed_at    TIMESTAMP NOT NULL,
  source         STRING             -- app_login | pos_membership | wifi_match ...
)
PARTITION BY DATE(observed_at);
```

이 엣지를 연결 요소(connected component)로 묶으면 `unified_user_id`가 나온다. 실무에서는 **확정적 엣지만 사용하는 보수적 그래프**와 **확률적 엣지까지 포함한 공격적 그래프**를 둘 다 만들고, 분석 성격에 따라 신뢰도 임계값을 선택하게 한다. 매출 정산처럼 오차가 허용되지 않는 분석은 확정적 그래프만 사용한다.

> ⚠️ ID 통합은 개인정보 처리의 핵심 지점이다. `card_hash`·`phone_hash`는 단방향 해시로만 저장하고 원문은 보관하지 않는다. 통합 행위 자체가 동의 범위 내인지 법무·보안 검토를 선행한다. [이벤트 트래킹의 PII 원칙](/concept/data-analysis/02_event_tracking_design)이 그대로 적용된다.

---

## L2. Event — 채널을 차원으로 흡수

[이벤트 트래킹 설계](/concept/data-analysis/02_event_tracking_design)의 표준 스키마를 재사용하되, 두 가지를 추가한다. (1) `channel`을 일급 차원으로 두고, (2) 식별자를 L1의 `unified_user_id`로 채운다. 온라인·오프라인 이벤트가 같은 테이블·같은 형태로 적재되는 것이 핵심이다.

```json
{
  "event_id": "8f14e45f-...",
  "event_name": "product_tried_on",
  "event_time": "2026-06-30T12:14:03Z",
  "received_at": "2026-06-30T19:02:51Z",
  "channel": "offline_store",
  "channel_detail": "store_gangnam_02",
  "unified_user_id": "uid_77abf2",
  "user_id": "usr_12345",
  "anonymous_id": null,
  "session_id": "sess_offline_99x",
  "properties": {
    "product_id": "sku_9981",
    "interaction_type": "fitting",
    "staff_assisted": true,
    "dwell_seconds": 420
  }
}
```

온라인의 `product_viewed`와 오프라인의 `product_tried_on`은 동일 의미 층위의 행동이다 — 둘 다 "관심의 행동적 표현"이다. 네이밍 컨벤션(`<object>_<action>`, 과거형)을 채널 무관하게 통일하면 `event_name LIKE 'product_%'` 한 줄로 온·오프라인 상품 관심을 함께 집계할 수 있다.

수집 경로는 채널마다 다르지만 도착 형태는 동일해야 한다.

| 채널 | 원천 | 수집 방식 | 지연 |
|---|---|---|---|
| `online_app` / `online_web` | SDK | 실시간 스트림 | 초 |
| `offline_store` | POS, 키오스크, 직원 태블릿 | 배치 | 분~시간 |
| `call_center` | CRM/상담 로그 | 배치 | 시간 |
| `offline_sensor` | 와이파이·비콘·카메라 카운터 | 배치 | 시간 |

---

## L3. Session — 시간이 어긋난 행동 잇기

온·오프라인의 가장 까다로운 차이가 여기서 드러난다. 온라인 이벤트는 발생 즉시 도착하지만, 오프라인 이벤트는 배치로 수 시간 늦게 도착한다. [02에서 `event_time`(실제 발생)과 `received_at`(도착)을 분리한 설계](/concept/data-analysis/02_event_tracking_design)가 여기서 결정적이다 — **크로스채널 세션은 반드시 `event_time` 기준으로 정렬**해야 한다. `received_at`으로 순서를 매기면 "매장 방문이 앱 검색보다 먼저"인 시간 역전이 발생한다.

세션 단위도 두 층으로 나눈다.

- **마이크로 세션**: 채널 내 연속 활동 (앱 30분 비활동 룰, 매장 1회 방문)
- **여정(journey)**: 한 사용자가 하나의 목표(구매)를 향해 채널을 넘나든 전체 — 며칠에 걸칠 수 있음

```sql
-- 구매 기준 직전 14일의 크로스채널 여정 재구성
WITH ordered AS (
  SELECT
    unified_user_id, event_name, channel, event_time
  FROM `project.dataset.events`
  WHERE event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 14 DAY)
)
SELECT
  unified_user_id,
  STRING_AGG(
    CONCAT(channel, ':', event_name),
    ' → ' ORDER BY event_time          -- 도착시각이 아닌 발생시각 기준
  ) AS journey_path
FROM ordered
GROUP BY unified_user_id
HAVING LOGICAL_OR(event_name = 'order_completed');
```

결과는 `online_app:product_searched → offline_store:product_tried_on → online_web:order_completed` 형태의 채널 횡단 경로다. 문제 정의에서 "웹 직접 유입"으로 집계되던 구매가 이 단계에서 채널 횡단 경로로 재구성된다.

---

## L4 · L5. Metric과 Analysis

L1~L3이 서면 [지표 체계](/concept/data-analysis/03_metrics_framework)와 [핵심 기법](/concept/data-analysis/01_behavioral_analytics_techniques)을 채널 차원에 얹어 그대로 적용한다. 통합 전에는 불가능했던 분석들이 가능해진다.

**크로스채널 퍼널** — [퍼널 설계](/concept/data-analysis/00_how_to_design_funnel)의 단계를 채널 무관 행동으로 정의한다.

```sql
SELECT
  COUNT(DISTINCT IF(step='search', unified_user_id, NULL)) AS searched,
  COUNT(DISTINCT IF(step='try',    unified_user_id, NULL)) AS tried,   -- 온라인 조회 + 매장 피팅
  COUNT(DISTINCT IF(step='buy',    unified_user_id, NULL)) AS bought
FROM (
  SELECT unified_user_id,
    CASE
      WHEN event_name = 'product_searched'                     THEN 'search'
      WHEN event_name IN ('product_viewed','product_tried_on') THEN 'try'
      WHEN event_name = 'order_completed'                      THEN 'buy'
    END AS step
  FROM `project.dataset.events`
  WHERE DATE(event_time) >= CURRENT_DATE() - 14
);
```

**채널 기여 분석** — 문제 정의의 직접 해법. 매장 피팅을 거친 구매와 거치지 않은 구매의 전환율·객단가를 비교하면, "웹 직접 유입"에 묻혀 있던 매장 기여가 정량화된다.

**채널 전환 행렬** — 사용자가 주로 어느 채널에서 어느 채널로 이동하는지(앱→매장 vs 매장→웹)를 보면 옴니채널 UX의 단절 지점이 드러난다.

지표 설계 원칙도 동일하다. 북극성 지표(NSM)는 채널 합산으로 정의하되, 한 채널을 죽여 다른 채널을 살리는 풍선효과를 막기 위해 **채널별 가드레일 지표**를 함께 둔다.

---

## 구축 순서

프레임워크를 한 번에 세우려는 시도는 대부분 L1에서 실패한다. 권장 순서는 아래부터다.

1. **L2를 한 채널에서만** — 온라인 이벤트 스키마를 [02 기준](/concept/data-analysis/02_event_tracking_design)으로 정립. 여기가 부실하면 위가 흔들린다.
2. **L1 확정적 연결만** — 로그인·멤버십 같은 확실한 신호로 ID 그래프 시작. 확률적 매칭은 후순위.
3. **두 번째 채널을 동일 L2 스키마로 흡수** — 새 테이블이 아니라 `channel` 차원으로 통합.
4. **L3 여정 재구성** — `event_time` 기준.
5. **L4·L5를 채널 차원에 적용.**

각 단계는 [02의 데이터 품질 검증](/concept/data-analysis/02_event_tracking_design)(볼륨·누락·중복 모니터링)을 통과한 뒤 다음으로 넘어간다.

---

## 한계

- **확률적 ID 매칭은 본질적으로 오차가 있다.** 정확도를 높일 수는 있어도 0 오차는 불가능하다. 정산·법적 책임이 걸린 분석에는 확정적 그래프만 쓴다.
- **오프라인 행동의 해상도가 낮다.** 앱은 스크롤·체류까지 잡지만 매장은 "방문/구매" 수준에 그치기 쉽다. 센서를 늘리면 해상도는 오르지만 비용·프라이버시 부담이 함께 증가한다.
- **이 프레임워크는 인프라 결정이 아니다.** L1~L5는 *무엇을 어떤 형태로 둘 것인가*를 정의할 뿐, 스트림이냐 배치냐·어떤 저장소냐는 별개의 [아키텍처 결정](/concept/data-architect/00_what_is_medaliion_architecture)이다.
- **confidence: medium.** 레이어 구조와 identity-first 원칙은 옴니채널 분석에서 반복 검증된 패턴이지만, 채널 구성·확률 매칭 임계값·여정 윈도우는 도메인마다 다르다. 그대로 복제하지 말고 자신의 채널 구성에 맞춰 조정한다.
