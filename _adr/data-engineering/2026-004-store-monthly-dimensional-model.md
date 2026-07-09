---
layout     : adr
title      : 소스 리스트를 스타 스키마로 분해하는 절차
date       : 2026-07-07 00:00:00 +0900
updated    : 2026-07-07 00:00:00 +0900
tag        : dimensional-modeling star-schema scd2 grain data-engineering
status     : proposed
deciders   : https://www.linkedin.com/in/dgpr
public     : false
confidence : medium
relations:
  - { type: references, target: adr/data-engineering/2026-001-data-mart-checklist }
  - { type: references, target: adr/data-engineering/2026-003-backfill-checklist }
  - { type: references, target: concept/data-architect/00_what_is_medaliion_architecture }
---

* TOC
{:toc}

## Context

매장 KPI 대시보드를 위해 20여 개 소스 테이블(RM001C·CM501C·RMA32T·AC761M·ZFIT9300·CM231T·ANLC/ANEP·CE31000/41000·GG_DE_BLK_DETAIL·GG_DE_XY_RIV·CS316S·EI502S·SC011M·EI714C + 수기 시트)을 받았다. 이 리스트를 어떻게 모델로 만드느냐가 대시보드의 수명을 결정한다.

먼저 역할을 못 박는다. **데이터를 수집·표준화·정제하는 일은 데이터 엔지니어의 책임이다.** 반면 **그 데이터로 어떤 대시보드를 만드느냐는 전적으로 소비자의 목적에 종속된다.** 이 구분이 중요한 이유는 방어적이어서가 아니라 모델링 순서를 규정하기 때문이다 — 소비자 목적(누가·무엇을·어떤 의사결정에 쓰는가)이 확정되기 전에 화면부터 만들면, 요구가 바뀔 때마다 마트가 아니라 화면 뒤의 모델까지 뒤집힌다. "제가 다 알아서 만들겠습니다"가 아니라 "목적을 정해 주셔야 정확히 만들 수 있습니다"가 올바른 계약이다(→ 대시보드 성격 확정은 §8 단계적 오픈의 전제).

기술적 함정은 세 가지다. 첫째, 소스 리스트를 **1:1로 복제**하면 대시보드가 raw 테이블 20개를 직접 조인하게 되고, 조인 카디널리티·집계 수준이 화면마다 제각각으로 흔들린다. 둘째, 한 소스에 **성격이 다른 컬럼이 뒤섞여** 있다 — AC761M은 임차유형(느리게 변하는 속성)과 월 렌트비(월별 수치)를 한 테이블에 담고 있고, ANLC/ANEP는 매장이 아니라 **자산 건** 단위다. 성격을 구분하지 않고 그레인에 억지로 붙이면 이중계산과 비가법 롤업이 반드시 터진다. 셋째, 전환율·객단가·평효율 같은 **파생값을 저장**하면 분모·분자가 재적재될 때 저장된 값과 어긋난다.

이 ADR은 이 소스 리스트를 스타 스키마로 분해하는 **재사용 가능한 6단계 절차**를 표준으로 고정하고, 그 절차를 매장 KPI 도메인에 적용한 결과 모델을 기록한다. 절차 자체가 자산이다 — 다음 도메인이 와도 같은 순서로 적용한다.

## Decision

1. **코어 그레인은 매장×월(store × month)로 고정한다.** 대시보드의 한 행은 하나의 (store_id, month) 조합이다. 서브 그레인(품목중분류·모델·성별연령)은 별도 팩트로 분리한다.
2. **소스 1:1 복제가 아니라 성격별 재조합**을 원칙으로 한다. 각 소스를 dim(느린 속성)·fct(월별 수치)·event-fct(발생 건)·snapshot(외부 환경)의 네 성격으로 분류하고, 한 소스가 두 성격을 가지면 쪼갠다.
3. **아래 6단계 모델링 절차를 표준으로 삼는다:** 그레인 고정 → 소스 성격 4분류 → dim(SCD/1:N 결정) → fct(가법성/파생/grain 전개 결정) → 세로형 판단 → mart 단일화. 이 순서를 지키면 모델이 저절로 도출된다.
4. **파생지표는 저장하지 않는다.** 전환율·객단가·평효율·경과개월·인당매출은 메트릭 레이어(뷰/BI 정의)에서 계산한다.
5. **대시보드는 `mart_store_monthly` 단일 와이드 테이블만 조회한다.** BI 도구가 raw fct를 조인하지 않는다.
6. **미확정 사항은 임의로 확정하지 않고 `[TBD]`로 태깅한다**(§10). SCD 범위·재무 정합·스냅샷 주기·내방객 출처는 소비자 목적·재무팀 합의가 있어야 확정된다.

이 절차는 그레인이 확정되기 전 SQL 작성을 금지한다(→ 2026-001 데이터 마트 체크리스트와 동일 원칙). 그레인 전에 쓴 SQL은 대부분 버려진다.

---

## 1. 그레인 고정 — 모든 판단의 기준

그레인은 "이 테이블의 한 행이 무엇을 세는가"다. 이것을 먼저 못 박아야 이후 모든 소스를 "이건 이 그레인에 어떻게 붙는가"로 분류할 수 있다. 그레인이 모호하면 집계·조인·중복 제거의 모든 판단이 흔들린다.

- [ ] **코어 그레인 문장을 한 줄로 썼다.** "한 행은 하나의 (store_id, month)의 매장 월간 실적이다." 이 문장을 테이블 description(스키마 메타데이터)에 그대로 박는다 — 위키가 아니라 테이블에.
- [ ] **서브 그레인을 코어와 섞지 않았다.** 서브 질문(품목별·모델별·인구통계별)은 각각 별도 그레인이다:

| 그레인 | 팩트 | 한 행의 의미 |
|--------|------|-------------|
| 매장×월 | `fct_store_pnl_monthly`, `fct_store_traffic_monthly`, `fct_target_monthly` | 매장의 월간 손익·트래픽·목표 |
| 매장×월×품목중분류 | `fct_store_category_monthly` | 매장의 월간 품목중분류별 판매 |
| 매장×월×모델 | `fct_store_model_monthly` | 매장의 월간 모델별 실판 |
| 매장×월×성별×연령 | `fct_store_demography_monthly` | 매장의 월간 회원 인구통계별 구매 |
| 매장×리뉴얼 건 | `fct_renewal_event` | 리뉴얼 1건(월 그레인 아님) |
| 매장×자산 건 | `fct_store_asset` | 투자 자산 1건(월 그레인 아님) |
| 매장×기준월(스냅샷) | `snp_trade_area`, `snp_competition` | 외부 환경 관측 시점 |

- [ ] **유니크 키를 확정하고 테스트로 강제했다.** 복합 그레인이면 조합 유니크 테스트를 쓴다. 유니크 테스트 없는 팩트는 미완성이다.

```yaml
# schema.yml (dbt / Dataform assertion 동치)
models:
  - name: fct_store_pnl_monthly
    description: "한 행은 하나의 (store_id, month)의 매장 월간 손익이다."
    tests:
      - dbt_utils.unique_combination_of_columns:
          combination_of_columns: [store_id, month]
```

## 2. 소스를 4가지 성격으로 분류

받은 리스트를 하나씩 보며 네 성격으로 나눈다. **한 소스가 두 성격을 가지면 쪼개서 각각 보낸다** — 이것이 "1:1 복제가 아닌 성격별 재조합"의 핵심이다.

| 소스 | 성격 | 대상 테이블 | 비고 |
|------|------|------------|------|
| RM001C (매장ID·지점명·오픈년월) | dim | `dim_store` | 경과개월수는 저장 안 함(파생, §4.2) |
| CM501C (지사·시도·시군구) | dim | `dim_store` | 지역 속성 |
| RMA32T (영업면적·층수·층별면적) | dim + 1:N | `dim_store`(총면적·층수) + `dim_store_floor`(층별) | 1:N은 분리(§3) |
| AC761M (임차유형 · 월 렌트비/임관비/임차관리비) | **dim + fct** | `dim_store`(임차유형) + `fct_store_pnl_monthly`(비용) | 한 소스 두 성격 → 쪼갬 |
| ZFIT9300 (테넌트수익·순수임관비) | fct | `fct_store_pnl_monthly` | 순수임관비 = A-B, 파생이면 저장 재검토 |
| CM231T (매장 총원) | fct(semi-additive) | `fct_store_pnl_monthly` | 시점 인원, 시간축 합산 불가(§4.1) |
| ANLC/ANEP (투자비·월 감가·종료년월) | **event-fct → 전개** | `fct_store_asset` → 월 전개 → pnl | 자산 그레인, 월로 못 붙임(§4.3) |
| CE31000/CE41000 (영업이익·EBITDA) | fct(확정치) | `fct_store_pnl_monthly` | 이중계산 주의(§6) |
| GG_DE_BLK_DETAIL (인구·세대·소득) | snapshot | `snp_trade_area` | 갱신 주기 월 아님 [TBD] |
| GG_DE_XY_RIV (경쟁사 점포수) | snapshot(세로형) | `snp_competition` | 경쟁유형 세로형(§5) |
| CS316S (구매자수·회원·성별·연령·품목) | fct(서브 grain) | `fct_store_category_monthly`, `fct_store_demography_monthly`, 매장전체 구매자수 별도 | 비가법, 롤업 금지(§4.1) |
| EI502S (점×모델 실판금액·수량) | fct(서브 grain) | `fct_store_model_monthly` | 평균판매가는 파생(§4.2) |
| SC011M (브랜드·모델·상품 마스터) | dim | `dim_product` | EI714C와 결합 |
| EI714C (부문·팀·품목·64품목·중분류) | dim | `dim_product` | 계층 평탄화 |
| 수기 traffic (내방객·구매건수) | fct | `fct_store_traffic_monthly` | 2차 오픈 [TBD] |
| 수기 target (목표 지표) | fct(세로형) | `fct_target_monthly` | 지표 세로형(§5) |
| 수기 renewal (투자기준·오픈시기) | event-fct | `fct_renewal_event` + `dim_renewal_type` | 이벤트성 |

## 3. 디멘션 — SCD와 1:N 두 가지만 결정한다

### 3.1 SCD2 여부 — "과거를 지금 값으로 볼 것인가, 당시 값으로 볼 것인가"

리뉴얼 전후 평효율 비교가 대시보드 목적에 있으면, 리뉴얼로 바뀌는 속성(영업면적·임차유형·Store Format)은 **당시 값**으로 봐야 한다. 이력을 안 남기고 최신값으로 덮으면, 3월 매출을 6월에 확장된 면적으로 나눠 평효율이 왜곡된다. 따라서 이 속성들은 **SCD2**로 관리한다.

- [ ] **surrogate key를 도입했다.** 자연키 `store_id`는 SCD2에서 여러 버전 행을 가지므로 팩트의 조인 키가 될 수 없다. 버전마다 유일한 `store_sk`를 발급하고, 팩트는 **이벤트 시점에 유효했던 store_sk**를 참조한다.
- [ ] **최신값 조회는 `is_current` 플래그로 단순화했다.** SCD2 컬럼: `store_sk`(PK), `store_id`(자연키), `valid_from`, `valid_to`, `is_current`.
- [ ] **최신값으로 덮어도 되는 속성은 SCD1으로 남겼다.** 지점명 표기 변경 같은 건 이력이 무의미하다 — SCD2로 만들면 버전만 늘고 분석 가치는 없다.

```sql
-- Point-in-time 조인: 월말 시점에 유효했던 매장 버전을 붙인다 (as-of join)
SELECT
  f.store_id,
  f.month,
  f.net_sales_krw,
  d.sales_area_pyeong,          -- 그 달에 유효했던 영업면적 (리뉴얼 전/후 정확)
  d.lease_type
FROM `proj.mart.fct_store_pnl_monthly` f
JOIN `proj.dim.dim_store` d
  ON  f.store_id = d.store_id
  AND LAST_DAY(PARSE_DATE('%Y%m', f.month)) BETWEEN d.valid_from AND d.valid_to
-- is_current로 조인하면 과거 매출도 현재 면적으로 나눠 평효율이 왜곡된다. 반드시 as-of.
```

### 3.2 1:N 처리 — 억지로 넣지 않는다

- [ ] **층별면적(RMA32T)처럼 매장당 여러 행인 속성은 `dim_store`에 넣지 않았다.** `dim_store`에 넣으면 매장이 층 수만큼 중복되고 팩트 조인이 fan-out된다. 별도 `dim_store_floor`(store_id + floor_no)로 분리한다. **대시보드가 층별을 안 쓰면** `dim_store`에는 총면적·층수만 두고 층별은 만들지 않는다.

### 3.3 conformed dimension

- [ ] **`dim_store`·`dim_product`는 모든 팩트가 공유하는 conformed dimension으로 설계했다.** 팩트마다 매장 속성을 복제하지 않는다 — 한 곳에서 정의하고 모든 팩트가 참조한다.

## 4. 팩트 — 가법성·파생·grain 전개 세 가지를 결정한다

### 4.1 가법성(additivity) — 측정값마다 집계 규칙을 메타데이터로 명시

측정값을 세 부류로 나누고, **차원별로 어떤 집계함수가 허용되는가**를 컬럼 메타에 박는다. 이걸 안 하면 BI 사용자가 semi-additive 값을 시간축으로 합산해 틀린 숫자를 만든다.

| 부류 | 예시 | 시간축 | 매장축 | 허용 집계 |
|------|------|--------|--------|-----------|
| **additive** | 실판금액·판매수량·렌트비·감가상각비 | ✅ SUM | ✅ SUM | 모든 차원 SUM |
| **semi-additive** | 매장 총원(CM231T)·순수임관비 잔액·기말 재고 | ❌ | ✅ SUM | 시간축은 AVG/LAST, 타 축은 SUM |
| **non-additive** | 전환율·객단가·구매자수(고객 중복) | ❌ | ❌ | 원천값에서 재계산만 |

- [ ] **비가법(non-additive) 측정값은 상위 그레인을 하위에서 롤업하지 않았다.** `fct_store_category_monthly`의 품목중분류별 `buyer_cnt`를 SUM해도 **매장 전체 구매자수가 아니다** — 한 고객이 여러 품목을 사면 중복 카운트된다. 매장 전체 구매자수는 CS316S에서 **별도로** 받아 매장×월 그레인에 따로 적재한다.

```sql
-- 롤업 금지 검증: 품목별 합 != 매장 전체 (같으면 오히려 소스가 이상한 것)
SELECT
  c.store_id, c.month,
  SUM(c.buyer_cnt)          AS sum_of_category,   -- 롤업 (틀린 값)
  t.total_buyer_cnt                               AS store_total       -- 원천 (맞는 값)
FROM `proj.mart.fct_store_category_monthly` c
JOIN `proj.mart.fct_store_buyer_monthly`    t USING (store_id, month)
GROUP BY c.store_id, c.month, t.total_buyer_cnt
HAVING sum_of_category = t.total_buyer_cnt;   -- 이 행이 나오면 중복 없는 소스라는 뜻 → 재확인
```

### 4.2 파생 vs 저장 — 두 값의 조합은 저장하지 않는다

두 측정값의 비/곱으로 나오는 값은 전부 메트릭 레이어에서 계산한다. 저장하면 분모·분자가 재적재될 때 저장된 파생값과 어긋나고, 어느 쪽이 맞는지 알 수 없게 된다.

| 파생지표 | 정의 | 저장 안 함 |
|----------|------|-----------|
| 전환율 | 구매건수 / 내방객수 | 메트릭 레이어 |
| 객단가 | 실판매출 / 구매건수 | 메트릭 레이어 |
| 평효율 | 실판매출 / 영업면적(as-of) | 메트릭 레이어 |
| 경과개월 | 기준월 − 오픈년월 | 메트릭 레이어(매월 자동 증가) |
| 인당매출 | 실판매출 / 매장총원 | 메트릭 레이어 |
| 모델 평균판매가 | 실판금액 / 판매수량 | `fct_store_model_monthly`에서 파생 — **수기 접수 불필요** |

- [ ] **경과개월·평균판매가는 저장 컬럼에서 제거했다.** 특히 경과개월을 저장하면 매월 배치로 갱신해야 하고, 한 번 놓치면 틀린 값이 박제된다.

### 4.3 grain 불일치 소스 전개 — 원본 보존 후 뷰에서 전개

ANLC/ANEP는 매장×월이 아니라 **자산 건** 단위다(투자비·감가 시작~종료년월). 월 그레인에 바로 못 붙인다.

- [ ] **자산 그레인을 원본 그대로 보존했다.** `fct_store_asset`(자산 1건 = 1행: 투자비·감가 시작월·종료월).
- [ ] **월 감가는 뷰/모델에서 전개해 pnl에 합류시켰다.** 자산의 감가 기간을 월로 펼쳐 `fct_store_pnl_monthly`에 합산한다.

```sql
-- 자산 grain → 월 grain 전개: 감가 기간을 월 시리즈로 펼친다
SELECT
  a.store_id,
  FORMAT_DATE('%Y%m', m)                          AS month,
  SUM(a.monthly_depreciation_krw)                 AS depreciation_krw
FROM `proj.mart.fct_store_asset` a,
  UNNEST(GENERATE_DATE_ARRAY(
    a.depr_start_date, a.depr_end_date, INTERVAL 1 MONTH)) AS m
GROUP BY a.store_id, month
-- 원본은 자산 grain으로 보존, 월 전개는 여기서. pnl에 저장하면 자산 정정 시 재전개 불가.
```

## 5. 세로형 vs 가로형 — 늘어날 값은 세로형

값의 **종류가 늘어날 수 있는 것**은 세로형(key-value, EAV)으로 둔다. 스키마 변경 없이 행 추가로 확장된다. **고정된 것**(성별 2개)은 가로 컬럼도 무방하다.

- [ ] **목표 지표는 세로형으로 설계했다.** `fct_target_monthly(store_id, month, target_type, target_value)`. 목표 지표가 내방객→구매건수→전환율→객단가로 늘어도 컬럼 추가가 아니라 행 추가로 흡수한다.
- [ ] **경쟁사는 세로형으로 설계했다.** `snp_competition(store_id, base_month, competitor_type, store_cnt)`. GG_DE_XY_RIV의 삼성스토어·하이P·전자L·대리점·할인점·백화점을 **컬럼 6개가 아니라** competitor_type 6행으로. 경쟁 유형이 추가돼도 스키마가 안 흔들린다.
- [ ] **성별처럼 폐쇄된 도메인은 가로형으로 뒀다.** `fct_store_demography_monthly`에서 성별×연령은 값이 고정이므로 세로형 강제가 과설계다.

## 6. 함정 — 모델링 단계에서 잡는다(운영에서 잡으면 늦다)

### 6.1 이중계산 — 확정치를 정(正)으로, 분해는 표시용으로만

CE31000의 매장별 영업이익에는 **렌트비·감가가 이미 반영돼 있을 가능성이 높다.** 그런데 AC761M(렌트비)·ANLC(감가)를 따로 받는다. mart에서 "영업이익 = 매출 − 각 비용 항목"으로 **재계산하면 렌트비·감가가 이중으로 빠진다.**

- [ ] **CE31000 확정치를 손익의 정(正)으로 쓰고, 개별 비용 항목은 분해 표시용으로만 두기로 [TBD] 결정 대기.** 재무팀에 "CE31000 영업이익에 어떤 비용이 이미 포함됐는가"를 확인해야 확정된다. 확인 전까지 mart에서 비용 항목을 합산해 영업이익을 재계산하지 않는다.

### 6.2 매장ID 표준화 — 단일 지점에서만 매핑

소스마다 매장 코드 체계가 다르면(RM001C vs CS316S vs 수기 시트), **staging 레이어 한 곳에서만** 표준 store_id로 매핑한다. 이후 레이어는 표준 ID만 쓴다. 매핑을 여러 곳에서 하면 한 곳만 놓쳐도 매장이 조용히 누락된다.

- [ ] **staging에 `stg_store_id_map` 단일 매핑 테이블을 두고, 매핑 실패(표준 ID 없는 소스 코드)를 assertion으로 감지했다.**

### 6.3 스냅샷 갱신 주기 불일치

상권(GG_DE_BLK_DETAIL)·경쟁사는 월이 아니라 분기/연 단위로 갱신될 가능성이 높다 [TBD]. 매장×월 팩트에 조인할 때 **가장 최근 유효 스냅샷을 as-of로** 붙인다. 없는 달을 NULL로 두거나 직전 스냅샷을 캐리포워드할지 소비자 목적에 따라 정한다.

## 7. mart 단일화 — 대시보드가 바라보는 유일한 계약

- [ ] **`mart_store_monthly` 하나로 통합했다.** = pnl + sales 집계 + traffic + target + 상권/경쟁 최신 스냅샷(as-of) 조인 + 파생지표(메트릭 레이어). 대시보드는 dim·fct를 직접 조인하지 않고 이 와이드 테이블만 조회한다.
- [ ] **아직 없는 소스(traffic/target)는 NULL 컬럼으로 자리를 잡아뒀다.** 수기 데이터가 나중에 들어와도 mart 스키마가 안 흔들린다. 이것이 단계적 오픈을 가능케 한다.
- [ ] **`mart_store_monthly`를 계약으로 문서화했다**(그레인·지표 정의·신선도·스키마 안정성 → 2026-001 마트 체크리스트 준수). 백필은 멱등하게(→ 2026-003 백필 체크리스트).

## 8. 단계적 오픈 — 소비자 목적 확정과 연동

대시보드 성격(대표 현황용 vs 공식 KPI)이 정해지지 않으면 화면을 만들지 않는다(→ Context의 역할 구분). 성격에 따라 합의 절차·지표 오너 지정 여부가 달라진다.

- **1차:** 손익/판매(자동화 소스만). `fct_store_pnl_monthly` + `fct_store_category_monthly`로 매장×월 손익·판매를 오픈. 수기 없이 가능.
- **2차:** 내방객/전환율/목표대비. 수기 traffic/target을 §7의 NULL 자리에 끼워 넣음. 내방객 출처(시스템 vs 수기 제출)와 제출 담당자·기한이 확정돼야 전환율·객단가·평효율 산출 가능 [TBD].

## 9. 6단계 절차 요약(재사용 프레임)

```
grain 고정 → 소스 성격 4분류 → dim(SCD/1:N) → fct(가법성/파생/grain전개) → 세로형 판단 → mart 단일화
```

이 순서는 매장 KPI에만 쓰는 것이 아니다. 새 도메인이 오면 같은 순서로 적용한다 — 그레인부터 못 박고, 소스를 네 성격으로 분류하고, dim에서 SCD·1:N을, fct에서 가법성·파생·grain 전개를 결정하고, 늘어날 값은 세로형으로, 마지막에 mart 하나로 모은다.

## 10. 미결정 사항 [TBD]

임의로 확정하지 않는다. 소비자 목적·재무팀 합의·소스 확인이 있어야 정해진다.

- [ ] **`dim_store` SCD2 범위** — 어떤 속성까지 이력을 남기나(최소 영업면적·임차유형·Store Format 권장). 소비자가 리뉴얼 전후 비교를 쓰는지에 종속.
- [ ] **CE31000 재무 정합** — 영업이익에 렌트비·감가가 이미 포함됐는가. 재무팀 확인 전 비용 재계산 금지(§6.1).
- [ ] **스냅샷 갱신 주기** — 상권·경쟁사 데이터의 실제 갱신 주기와 as-of 캐리포워드 정책(§6.3).
- [ ] **내방객 데이터 출처** — 시스템 유무. 없으면 매월 수기 제출 담당자·기한 지정(§8 2차 전제).
- [ ] **순수임관비 저장 여부** — A−B가 파생이면 저장 대신 계산(§4.2 기준 적용 검토).

## Consequences

**얻는 것**
- 대시보드가 `mart_store_monthly` 단일 테이블만 보므로, 소스 20개의 변경이 화면까지 전파되지 않는다(staging/dim/fct가 흡수).
- 파생지표를 저장하지 않아 분모·분자 재적재 시 값이 어긋나지 않는다.
- SCD2 + as-of 조인으로 리뉴얼 전후 평효율 비교가 왜곡 없이 가능하다.
- 세로형 설계로 목표 지표·경쟁사 유형 추가가 스키마 변경 없이 흡수된다.
- 6단계 절차가 재사용 프레임으로 남아 다음 도메인에 그대로 적용된다.

**치르는 비용**
- SCD2 + surrogate key + as-of 조인은 최신값 덮어쓰기보다 구현·쿼리가 복잡하다. 리뉴얼 전후 비교가 목적이 아니면 과설계다.
- 메트릭 레이어(파생 계산)를 BI와 SQL 양쪽이 아니라 한 곳에 두는 규율이 필요하다 — 지키지 않으면 정의가 두 곳으로 갈린다.
- 자산 감가 월 전개는 뷰 재계산 비용이 있다. 대신 자산 정정 시 재전개가 자유롭다.

**되돌리기 어려운 결정**
- 코어 그레인(매장×월). 대시보드가 매장×주 등 다른 그레인을 요구하면 상당한 재작업. 소비자 목적 확정이 선행되는 이유.

**미해결**
- §10의 TBD가 확정되기 전까지 이 ADR은 `proposed` 상태다. 1차 오픈(손익/판매)은 TBD와 무관하게 진행 가능하나, 2차(traffic/target)와 재무 지표는 TBD 확정이 전제다.
