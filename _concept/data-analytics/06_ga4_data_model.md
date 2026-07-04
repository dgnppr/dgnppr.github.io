---
layout      : concept
title       : GA4 데이터 모델
date        : 2026-07-04 00:00:00 +0900
updated     : 2026-07-04 00:00:00 +0900
tag         : ga4 analytics event-model bigquery attribution data-analytics
toc         : true
comment     : true
latex       : true
status      : complete
public      : true
parent      : [[/data-analytics]]
confidence  : high
valid_from  : 2026-07-04
relations:
  - { type: references, target: concept/data-analytics/02_event_tracking_design }
  - { type: references, target: concept/data-analytics/03_metrics_framework }
---

* TOC
{:toc}

GA4(Google Analytics 4)의 데이터가 어떻게 생겼는지 — 무엇이 기록되고, 어떤 단위로 묶이고, 어디서 근사되는지를 정리한다. GA4 분석의 오독은 대부분 도구 사용법이 아니라 데이터 모델에 대한 오해에서 나온다.

## 이벤트 기반 모델

GA4의 유일한 수집 단위는 **이벤트**다. UA(Universal Analytics)가 페이지뷰·트랜잭션·소셜 등 히트 타입을 구분하고 세션을 수집의 중심에 뒀던 것과 달리, GA4에서는 페이지 조회(`page_view`), 세션 시작(`session_start`), 구매(`purchase`) 전부가 동일한 구조의 이벤트다.

이벤트의 구조는 단순하다:

```
event
├── event_name        # 이벤트 이름 (예: purchase)
├── event_timestamp   # 발생 시각 (UTC 마이크로초)
├── event_params[]    # key-value 파라미터 배열
└── (컨텍스트)         # user_pseudo_id, device, geo, traffic_source 등
```

세션·유저 단위 지표는 전부 이 이벤트 스트림에서 **파생**된다. "세션 수"는 저장된 값이 아니라 `session_start` 이벤트와 세션 파라미터로 재구성되는 값이라는 점이 모델 이해의 출발점이다.

### 이벤트의 4가지 계층

| 계층 | 수집 주체 | 예 |
|------|----------|-----|
| 자동 수집(automatically collected) | SDK/gtag가 무조건 수집 | `first_visit`, `session_start`, `user_engagement` |
| 향상된 측정(enhanced measurement) | 웹 스트림 설정 토글로 수집 | `scroll`, `click`(outbound), `file_download`, `video_start` |
| 추천 이벤트(recommended) | 개발자가 구현하되 Google이 이름·파라미터 스펙을 정의 | `login`, `purchase`, `add_to_cart` |
| 커스텀 이벤트(custom) | 개발자가 이름·파라미터 자유 정의 | `apply_coupon_clicked` |

추천 이벤트는 이름 규약을 지켜야 GA4의 내장 보고서·전환 모델링·광고 연동이 동작한다. 같은 의미를 커스텀 이름으로 만들면 수집은 되지만 제품 기능과 연결되지 않는다.

향상된 측정은 토글 하나로 이벤트가 생기고 사라지는 계층이라는 점이 중요하다. 누가 콘솔에서 `scroll` 토글을 끄면 코드 배포 없이 시계열이 끊긴다 — 수집 변경 이력 관리 대상에 콘솔 설정도 포함해야 하는 이유다.

### 커스텀 디멘션 등록제

커스텀 파라미터는 수집만으로는 UI 보고서에 나타나지 않는다. **커스텀 디멘션/메트릭으로 등록**해야 하고, 등록 이전 데이터는 소급되지 않는다. 반면 BigQuery export에는 등록 여부와 무관하게 수집 시점부터 전부 들어간다. "UI에는 6월부터만 보이는데 BQ에는 3월부터 있다"는 상황은 이 구조의 자연스러운 결과다.

## 수집 파이프라인

데이터가 property에 도달하는 경로는 네 갈래이고, 각각 시맨틱이 다르다.

| 경로 | 대상 | 특성 |
|------|------|------|
| gtag.js / GTM | 웹 | 브라우저에서 `/g/collect` 엔드포인트로 전송. 여러 이벤트를 하나의 요청으로 배칭, 이탈 시 `sendBeacon` 사용 |
| Firebase SDK | 앱 | 디바이스에 이벤트를 모았다가 주기적으로 배치 업로드. 오프라인 발생분은 나중에 도착(late hit의 주요 원인) |
| Measurement Protocol | 서버 | HTTP POST로 직접 전송. 환불·오프라인 전환 등 서버 사이드 보완용. 클라이언트가 만든 `client_id`/`ga_session_id`와 정합시키는 책임은 구현자에게 있고, 자동 수집 이벤트·트래픽 소스가 붙지 않는다 |
| Server-side GTM | 웹/앱 | 클라이언트 → 자체 서버 컨테이너 → GA4로 프록시. 광고 차단기 영향 완화, 1st-party 도메인 수집, PII 필터링 지점 확보 |

앱의 배치 업로드와 오프라인 큐 때문에 **앱 스트림은 웹보다 이벤트 도착 지연 분포가 훨씬 길다.** 웹·앱 통합 property의 "어제" 데이터가 웹만 있는 property보다 오래 출렁이는 이유다.

## 식별자 체계

GA4는 세 겹의 식별자를 갖는다.

| 식별자 | 단위 | 특성 |
|--------|------|------|
| `user_pseudo_id` | 브라우저·디바이스(앱 인스턴스) | 웹은 `_ga` 쿠키의 client_id, 앱은 앱 인스턴스 ID. 쿠키 삭제, ITP 만료, 앱 재설치로 리셋 |
| User-ID (`user_id`) | 로그인 사용자 | 개발자가 직접 심는 값. 로그인 시점부터만 존재 |
| Google signals | 구글 계정 | 광고 개인화 동의 사용자의 크로스 디바이스 신호. 원본 데이터 접근 불가 |

UI의 "Users"가 어떤 식별자 기준인지는 property의 **reporting identity** 설정에 따라 달라진다:

- **device-based**: `user_pseudo_id`만 사용
- **observed**: User-ID > Google signals > device ID 순으로 있는 것 사용
- **blended**: observed + 없으면 모델링(behavioral modeling)으로 추정 통합

같은 데이터라도 이 설정만 바꾸면 유저 수가 달라진다. BigQuery export에는 `user_pseudo_id`와 (심었다면) `user_id`만 있고 Google signals·모델링 기반 통합은 반영되지 않는다 — UI와 BQ의 유저 수가 다른 구조적 이유 중 하나다.

`user_pseudo_id`는 사람이 아니라 브라우저를 센다. 쿠키 수명 제한(Safari ITP 등) 아래에서는 같은 사람이 주기적으로 새 유저로 집계되므로, 디바이스 기준 유저 수는 실제 사람 수의 상한이 아니라 **부풀려진 근사치**다. 역으로 User-ID 기준 분석은 로그인 이전 행동이 연결되지 않는 반쪽 데이터다. "유저"라는 단어를 쓸 때마다 어느 식별자 기준인지 명시하는 것이 GA4 분석의 기본 규율이다.

## 세션

GA4의 세션은 `session_start` 이벤트와 두 개의 이벤트 파라미터로 표현된다:

- `ga_session_id` — **세션 시작 시각의 Unix epoch 초**다. 즉 ID이면서 동시에 세션 시작 시각 정보다. 다만 같은 property 안에서 유니크하지 않다 — 같은 초에 시작한 세션은 값이 같다. 유니크 세션 키는 `(user_pseudo_id, ga_session_id)` 조합이다.
- `ga_session_number` — 해당 사용자의 몇 번째 세션인지. 리텐션·재방문 분석에 바로 쓸 수 있다.

UA와 다른 점 세 가지가 실무에서 중요하다:

1. **자정에 세션이 끊기지 않는다.** UA는 자정마다 세션을 분리했다.
2. **세션 중 캠페인 소스가 바뀌어도 새 세션이 생기지 않는다.** UA는 소스 변경 시 세션을 새로 시작했다. 같은 트래픽이라도 GA4의 세션 수가 UA보다 적게 나오는 이유다.
3. 세션 타임아웃 기본값은 30분(조정 가능)이다.

### 참여(engagement) 파생 지표

- **참여 세션(engaged session)**: 10초 이상 지속, 또는 전환 이벤트 발생, 또는 2회 이상의 page_view/screen_view 중 하나를 만족한 세션. BQ에서는 `session_engaged` 파라미터로 판정한다.
- **engagement rate** = 참여 세션 / 전체 세션. **이탈률(bounce rate) = 1 - engagement rate**로 재정의됐다. UA의 "단일 히트 세션 비율"과 정의가 다르므로 수치 비교가 성립하지 않는다.
- **참여 시간**: `user_engagement` 이벤트의 `engagement_time_msec` 파라미터 누적으로 계산한다. 페이지 체류 시간을 "다음 히트와의 시간차"로 근사하던 UA 방식보다 실측에 가깝다(포그라운드 시간 기준).
- **Active User**: 참여 세션이 있었거나 `first_visit`/`first_open`이 발생한 유저. UI의 기본 "Users"가 이것이다.

## 스코프

파라미터·디멘션에는 스코프가 있고, 스코프가 다른 값을 섞으면 무의미한 숫자가 나온다.

| 스코프 | 저장 위치 | 예 |
|--------|----------|-----|
| event | `event_params` | 페이지 경로, 검색어 |
| user | `user_properties` | 멤버십 등급, 실험 그룹 |
| session | 세션 파라미터에서 파생 | 세션 소스/매체 |
| item | `items[]` 배열 | 상품 ID, 가격, 수량 |

전자상거래 이벤트(`purchase`, `add_to_cart` 등)의 상품 정보는 이벤트 파라미터가 아니라 **`items` 배열**에 들어간다. 이벤트 레벨 지표(`ecommerce.purchase_revenue`)와 아이템 레벨 지표(`items.item_revenue`)가 별도로 존재하고, items를 UNNEST한 뒤 이벤트 레벨 값을 집계하면 아이템 수만큼 곱해진 숫자가 나온다 — GA4 전자상거래 분석의 대표적 fan-out 사고다.

`user_properties`는 설정 시점 이후의 이벤트에 붙는 **현재값**이다. 과거 이벤트에 소급되지 않고, BQ에도 이벤트 발생 시점에 유효했던 값이 박제된다. 시점별 속성이 필요한 분석에는 오히려 유리하고, "현재 등급 기준 과거 행동" 분석에는 별도 조인이 필요하다.

## 트래픽 소스와 어트리뷰션

GA4에는 트래픽 소스가 **세 가지 스코프로 따로 존재**하며, BigQuery export에서 서로 다른 필드 그룹에 들어간다. 어트리뷰션 분석 오류의 대부분이 이 셋의 혼동에서 나온다.

| 스코프 | BQ 필드 | 의미 |
|--------|---------|------|
| user | `traffic_source.*` | 그 유저의 **최초 획득(first touch)** 소스. 이후 절대 바뀌지 않음 |
| event | `collected_traffic_source.*` | 해당 이벤트 수집 시점의 utm/gclid 원본 값 |
| session | `session_traffic_source_last_click.*` | 세션의 last-click 기준 소스(교차 채널·수동/자동 태깅 통합) |

주의점:

- `traffic_source.*`를 세션 소스로 착각하고 채널 성과를 집계하는 것이 가장 흔한 실수다. 그 유저가 3년 전 어떤 채널로 왔는지가 나올 뿐이다.
- **UI의 전환 어트리뷰션 기본값은 데이터 기반(DDA, data-driven attribution)**이다. last click 규칙이 아니라 모델이 전환 기여를 채널에 배분하므로, BQ에서 last-click으로 직접 계산한 채널별 전환수와 UI 숫자는 원리적으로 다르다.
- 채널 그룹(Organic Search, Paid Social 등)은 source/medium 원본값 위에 Google이 정의한 분류 규칙을 얹은 파생 차원이다. BQ에는 그룹핑 결과가 없으므로(원본 source/medium만 있음) 같은 분류가 필요하면 규칙을 직접 구현해야 한다.
- Google Ads 자동 태깅(gclid)은 UI에서는 캠페인 정보로 풀리지만 BQ에서는 gclid 문자열만 온다. 캠페인 단위 분석은 Google Ads 데이터와 별도 조인이 필요하다.

## Property 구조와 데이터 스트림

- 계층은 계정 → property → **데이터 스트림**(웹 / iOS / Android)이다. UA의 view(보기)는 없다 — 필터된 view로 하던 일(내부 트래픽 제외 등)은 property 설정이나 분석 쿼리 단에서 해야 한다.
- 웹 스트림(gtag/GTM)과 앱 스트림(Firebase SDK)은 자동 수집 이벤트 목록·세션 처리·식별자 특성·도착 지연이 다르다. 하나의 property에 웹·앱을 합치면 크로스 플랫폼 분석이 가능해지는 대신, 스트림 간 시맨틱 차이를 안은 합산 숫자를 보게 된다.
- 내부 트래픽 제외는 IP 규칙으로 `traffic_type=internal` 파라미터를 붙인 뒤 데이터 필터로 제외하는 2단계 구조다. 필터는 **적용 시점 이후만** 영향을 주고 소급 삭제되지 않는다.

## 처리와 보관

- 이벤트는 수집 후 처리까지 **24~48시간** 걸린다. 당일 데이터는 잠정치다.
- **데이터 보관(retention) 설정은 탐색(Explorations) 보고서에만 적용된다.** 무료 property 기본 2개월, 최대 14개월. 표준 보고서는 사전 집계 테이블 기반이라 보관 기간과 무관하게 조회된다. "탐색에서는 작년 데이터가 안 나오는데 표준 보고서에는 나온다"는 이 구조 때문이다.
- 원본 이벤트 수준 데이터를 기간 제한 없이 보존하려면 BigQuery export가 사실상 유일한 수단이다. **export는 연동 시점부터만 쌓인다** — property 개설과 동시에 연동하는 것이 소급 불가능한 결정이다.

## BigQuery Export

GA4의 원본 이벤트를 그대로 받을 수 있는 공식 경로다(UA 시절 유료 GA360 전용이었던 것이 무료화됐다).

### 테이블과 갱신

- 일별 `events_YYYYMMDD` + 당일 잠정 `events_intraday_YYYYMMDD`(streaming export 활성 시). 일별 테이블은 생성 후에도 late hit 반영으로 **최대 72시간까지 갱신**될 수 있다. GA4 export를 소스로 쓰는 파이프라인은 lookback 재처리가 필수다.
- 날짜별 **샤딩 테이블**(파티션 테이블이 아님)이므로 기간 조회는 와일드카드 + `_TABLE_SUFFIX`로 한다.

### 스키마 구조

이벤트 1행이며, 주요 컬럼 그룹은 다음과 같다:

| 컬럼 그룹 | 내용 |
|----------|------|
| `event_*` | `event_date`, `event_timestamp`, `event_name`, `event_params[]`, `event_bundle_sequence_id` |
| `user_*` | `user_pseudo_id`, `user_id`, `user_properties[]`, `user_first_touch_timestamp`, `user_ltv` |
| `device`, `geo`, `app_info`, `platform` | 디바이스·지역·앱 버전 컨텍스트 |
| `traffic_source` | user-scoped 최초 획득 소스 |
| `collected_traffic_source` | event-scoped 수집 시점 소스 |
| `session_traffic_source_last_click` | session-scoped last-click 소스 |
| `ecommerce`, `items[]` | 이벤트 레벨 커머스 지표, 아이템 배열 |
| `privacy_info` | 동의 상태(`analytics_storage`, `ads_storage`, `uses_transient_token`) |

주의해야 할 필드 시맨틱:

- **`event_date`는 property 타임존 기준, `event_timestamp`는 UTC 마이크로초다.** 같은 행 안에서 기준이 다르다. `event_date`로 집계하면 UI와 맞고, `event_timestamp`를 UTC로 자르면 UI와 어긋난다. 어느 쪽이든 하나로 통일하고 명시해야 한다.
- `event_params`, `user_properties`는 key-value 구조체 배열이라 `UNNEST`로 전개한다. 값은 `string_value / int_value / float_value / double_value` 중 하나에 들어간다.
- `event_bundle_sequence_id`는 같은 업로드 배치를 묶는 ID다. 완전 중복 이벤트 dedup의 보조 키로 쓸 수 있다(재전송 시 중복 유입 가능).

### 관용구 SQL

파라미터 추출과 세션 키:

```sql
WITH base AS (
  SELECT
    user_pseudo_id,
    CONCAT(user_pseudo_id, '-',
      (SELECT value.int_value FROM UNNEST(event_params)
        WHERE key = 'ga_session_id')) AS session_key,
    event_name,
    event_date,  -- property 타임존 기준
    TIMESTAMP_MICROS(event_timestamp) AS event_ts_utc,
    (SELECT value.string_value FROM UNNEST(event_params)
      WHERE key = 'page_location') AS page_location
  FROM `project.analytics_XXXXXX.events_*`
  WHERE _TABLE_SUFFIX BETWEEN '20260601' AND '20260630'
)
SELECT event_date, COUNT(DISTINCT session_key) AS sessions
FROM base
GROUP BY event_date
ORDER BY event_date
```

- `_TABLE_SUFFIX` 필터가 없으면 전체 기간 풀스캔이다. GA4 export 비용 사고의 1순위 원인.
- 파라미터 추출 서브쿼리는 반복되므로, 실무에서는 staging 모델(dbt 등)에서 자주 쓰는 파라미터를 컬럼으로 평탄화(flatten)한 테이블을 한 층 두고 그 위에서 분석하는 구조가 표준이다. 원본을 매번 UNNEST하는 조직은 쿼리 비용과 실수 확률을 같이 지불한다.

items fan-out을 피하는 패턴:

```sql
-- 이벤트 레벨 지표는 UNNEST 전에
SELECT event_date, SUM(ecommerce.purchase_revenue) AS revenue
FROM `project.analytics_XXXXXX.events_*`
WHERE _TABLE_SUFFIX = '20260704' AND event_name = 'purchase'
GROUP BY event_date;

-- 아이템 레벨 지표는 UNNEST 후 items 필드로
SELECT item.item_id, SUM(item.item_revenue) AS item_revenue
FROM `project.analytics_XXXXXX.events_*`, UNNEST(items) AS item
WHERE _TABLE_SUFFIX = '20260704' AND event_name = 'purchase'
GROUP BY item.item_id;
```

### 한도와 비용

- 무료 property의 daily export는 **일 100만 이벤트 한도**가 있다(초과 시 export 중단 통보·제한). streaming export는 이벤트 수 한도 대신 BigQuery 스토리지·삽입 비용이 든다.
- **UI와 불일치는 정상이다**: UI의 유저 수는 HLL++ 근사 + reporting identity 통합 + (동의 모드 시) 행동 모델링이 반영된 값이고, BQ는 `user_pseudo_id` exact count다. 같아지는 것이 오히려 이상하다.

## 근사와 모델링이 개입하는 지점

GA4 숫자에는 정확한 카운트가 아닌 값이 체계적으로 섞여 있다. 어디서 섞이는지 알아야 숫자의 신뢰 구간을 판단할 수 있다.

| 지점 | 내용 |
|------|------|
| 카디널리티 근사 | 유저 수 등 distinct count는 HLL++ 근사 |
| 샘플링 | 탐색 보고서가 쿼리당 이벤트 한도(표준 1,000만) 초과 시 표본 추출 |
| thresholding | Google signals 활성 시 소수 사용자 행 숨김 — `(data)` 표시 |
| (other) 행 | 고카디널리티 차원이 한도 초과 시 뭉개짐 |
| 행동 모델링 | Consent Mode에서 동의 거부 트래픽을 모델로 추정해 UI 숫자에 합산 |
| 데이터 기반 어트리뷰션 | 전환 기여를 규칙(last click)이 아니라 모델로 배분 |
| 키 이벤트 카운팅 | 전환(key event) 수는 세션당 1회가 아니라 발생 건수 기준(UA 목표와 다름) |

### Consent Mode와 privacy_info

Consent Mode는 동의 상태 신호(`analytics_storage`, `ad_storage`, `ad_user_data`, `ad_personalization`)에 따라 수집 동작을 바꾼다. `analytics_storage` 거부 시에도 쿠키 없는 익명 핑(cookieless ping)은 전송될 수 있고, Google은 이를 재료로 행동 모델링을 한다. BQ export의 `privacy_info` 필드로 행별 동의 상태를 볼 수 있으며, **모델링된 데이터는 BQ에 오지 않는다.** 동의 거부율이 높은 시장(EU)일수록 UI(모델링 포함)와 BQ(관측치만)의 간극이 커진다.

공통 패턴: **모델링·근사는 UI에 반영되고 BigQuery export에는 반영되지 않는다.** 재현 가능하고 감사 가능한 숫자가 필요하면 BQ 기준, Google 생태계(광고 최적화)와 정합이 필요하면 UI 기준이라는 역할 분담이 성립한다.

## 한도 요약 (표준 vs GA360)

| 항목 | 표준(무료) | GA360 |
|------|-----------|-------|
| 이벤트당 파라미터 | 25개 | 100개 |
| 이벤트 이름 길이 / 파라미터 값 길이 | 40자 / 100자 | 동일 |
| user property | 25개, 값 36자 | 100개 |
| 커스텀 디멘션(event-scoped) | 50개 | 125개 |
| 커스텀 디멘션(user-scoped) | 25개 | 100개 |
| 데이터 보관(탐색) | 최대 14개월 | 최대 50개월 |
| 탐색 샘플링 한도 | 쿼리당 1,000만 이벤트 | 10억 이벤트 |
| BQ daily export | 일 100만 이벤트 | 수십억 규모 |

수치는 작성 시점 기준이며 Google이 수시로 조정한다.

## UA와의 차이 요약

| 항목 | UA | GA4 |
|------|----|----|
| 수집 단위 | 히트 타입(pageview, event, ...) + 세션 중심 | 단일 이벤트 모델 |
| 세션 | 자정·캠페인 변경 시 분리 | 분리 없음, 30분 타임아웃 |
| 유저 지표 기본 | Total Users | Active Users |
| 이탈률 | 단일 히트 세션 비율 | 1 - engagement rate |
| 체류 시간 | 다음 히트와의 시간차 근사 | `engagement_time_msec` 실측 누적 |
| 전환 카운트 | 세션당 1회 | 발생 건수 |
| view(보기) | 있음 | 없음(스트림 구조) |
| 원본 데이터 접근 | GA360 전용 | BigQuery export 무료 제공 |
| 커스텀 차원 | 소급 불가, 스코프 4종 | 소급 불가, 등록제 + 스코프 4종 |

## 흔한 분석 안티패턴

1. **`ga_session_id` 단독으로 세션 조인·카운트** — epoch 초라서 유저 간 충돌한다. 반드시 `user_pseudo_id`와 조합.
2. **items UNNEST 후 이벤트 레벨 지표 집계** — 아이템 수만큼 fan-out된 매출이 나온다.
3. **`traffic_source.*`로 채널 성과 분석** — first touch 소스다. 세션 소스는 `session_traffic_source_last_click`.
4. **`event_timestamp`를 UTC로 잘라 UI 일별 숫자와 대조** — UI는 property 타임존, `event_date`와 맞춰야 한다.
5. **`_TABLE_SUFFIX` 없이 `events_*` 조회** — 전체 기간 풀스캔 비용.
6. **어제 확정 대시보드** — late hit 72시간, 앱 오프라인 업로드를 무시한 잠정치 위의 의사결정.
7. **UI 유저 수와 BQ `COUNT(DISTINCT user_pseudo_id)` 일치를 기대** — 근사·identity 통합·모델링 때문에 구조적으로 다르다.

## 한계

- 이 문서의 한도 수치는 작성 시점의 표준(무료) property 기준이다. Google이 수시로 조정하며, GA360(유료)은 한도가 다르다.
- GA4의 수집은 클라이언트 환경(광고 차단기, 쿠키 정책, 동의 상태)에 종속된다. 데이터 모델을 완전히 이해해도 "수집되지 않은 이벤트"는 복원할 수 없다 — 전수 데이터가 필요한 도메인(정산, 매출 확정)은 처음부터 서버 데이터를 쓴다.
- 채널 그룹핑·DDA·행동 모델링의 내부 규칙은 비공개다. UI 파생 차원을 BQ에서 완전히 재현하는 것은 원리적으로 불가능하며, 근사 재현까지만 가능하다.
