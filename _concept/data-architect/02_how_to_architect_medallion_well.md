---
layout  : concept
title   : 메달리언 레이어 무엇을 어디에 둘 것인가
date    : 2026-06-25 00:00:00 +0900
updated : 2026-06-25 00:00:00 +0900
tag     : data-architect data-architecture design-pattern medallion
toc     : true
comment : true
public  : true
parent  : [[/data-architect]]
latex   : true
status  : complete
show-diagram: true
relations:
  - { type: extends, target: /concept/data-architect/00_what_is_medaliion_architecture }
  - { type: extends, target: /concept/data-architect/01_how_to_architect_medallion_well }
confidence     : medium
---
* TOC
{:toc}

> [[/data-architect/00_what_is_medaliion_architecture]]에서 레이어가 무엇인지, [[/data-architect/01_how_to_architect_medallion_well]]에서 소스 변경을 흡수하지 못한 사고를 봤다. 레이어가 무엇인지는 안다. 문제는 매번 *어느 레이어에 둘지* 판단해야 한다는 것이다.

이 글은 그 판단을 위한 룰북이다. 정의는 다시 설명하지 않는다. 대신 세 가지 질문에 답한다.

- 이 변환은 Silver인가 Gold인가?
- 이 검증은 어느 경계에 두는가?
- 이 중복은 허용인가, 안티패턴인가?

00편이 지도고 01편이 한 번의 사고 기록이라면, 이 글은 매일 꺼내 보는 설계 결정 기준서다.

---

## 레이어 책임 경계 — 판단 기준

경계가 모호할 때 비용은 조용히 쌓인다. 같은 변환이 두 곳에 생기고, 숫자가 갈라지고, 소스 하나가 바뀌면 어디까지 손대야 하는지 아무도 모른다. 경계를 가르는 룰이 필요하다.

### Bronze에 둘 것 — 복원 가능성 기준

Bronze 판단 기준은 하나의 질문으로 압축된다.

<div class="callout-note">
소스를 못 받았을 때 이 정보를 복원할 수 있는가? — 복원 불가능한 적재 메타데이터만 Bronze에 두고, 변환은 절대 두지 않는다.
</div>

`_ingested_at`, `_source_file`, `batch_id`는 소스를 다시 받아도 복원되지 않는다. "이 행이 언제, 어떤 파일로 들어왔는가"는 적재 순간에만 알 수 있는 사실이기 때문이다. 그래서 Bronze에 둔다. 반대로 변환은 소스만 있으면 언제든 다시 만들 수 있으므로, Bronze에 두는 순간 재처리 복원력만 잃는다.

그런데 Bronze에서 진짜 문제는 "무엇을 두는가"보다 "어떻게 적재하는가"에서 더 자주 터진다. 카드사 결제 데이터를 예로 들어 보자. 카드사 FTP 원장 파일(`landing.card_transactions_raw`)을 받아 `bronze.card_transactions`에 적재하는데, 네트워크 장애로 같은 배치 파일이 두 번 전송됐다. `append`로 적재했다면 같은 거래가 두 벌 쌓인다 — 그 위에서 집계하는 모든 지표가 두 배로 부풀어 오른다.

```sql
-- ✗ 재시도 시 중복 누적
INSERT INTO `proj.bronze.card_transactions`
SELECT *, CURRENT_TIMESTAMP() AS _ingested_at
FROM `proj.landing.card_transactions_raw`;
```

`MERGE`는 키로 맞춰 멱등하게 동작하므로, 같은 배치를 다시 돌려도 이미 들어온 거래는 건너뛴다.

```sql
-- ✓ 같은 배치 재시도 → 동일 결과
MERGE `proj.bronze.card_transactions` T
USING (
  SELECT *, @batch_id AS _batch_id, CURRENT_TIMESTAMP() AS _ingested_at
  FROM `proj.landing.card_transactions_raw`
  WHERE _batch_id = @batch_id
) S
ON T.txn_id = S.txn_id AND T._batch_id = S._batch_id
WHEN NOT MATCHED THEN
  INSERT (txn_id, card_no, amount, status, txn_at, _batch_id, _ingested_at)
  VALUES (S.txn_id, S.card_no, S.amount, S.status, S.txn_at, S._batch_id, S._ingested_at);
```

`_batch_id`와 `_ingested_at`은 둘 다 복원 불가능한 적재 메타이므로 Bronze에 둘 자격이 있고, 동시에 멱등 MERGE의 키로도 쓰인다. (이 멱등성 원칙은 뒤의 "멱등성과 MERGE"에서 일반 형태로 다시 다룬다.)

### Silver와 Gold를 가르는 네 가지 룰

경계가 진짜 흐려지는 곳은 Silver와 Gold 사이다. 네 개의 룰이 거의 모든 경우를 가른다.

**룰 A — 소비처가 둘 이상이면 Silver, 하나뿐이면 Gold 후보.** 여러 마트가 같은 변환 결과를 본다면 Silver에 한 번 두고 공유한다. 소비처가 하나뿐이면 그 마트 안(Gold)에 둬도 된다. 재사용성 기준이다.

**룰 B — "무엇인가"는 Silver, "얼마인가"는 Gold.** 사실과 엔티티 정합("이 주문은 완료다", "이 둘은 같은 고객이다")은 Silver. 집계·지표·KPI("어제 매출이 얼마다")는 Gold.

**룰 C — 비즈니스 정의가 바뀔 때 함께 바뀌어야 하면 Gold.** 부서마다 다르게 정의되고 분기마다 바뀌는 로직은 Gold에 둔다. 정의 변동을 Silver가 떠안으면 모든 소비처가 흔들린다.

**룰 D — 조인이 엔티티 통합이면 Silver, 와이드 테이블 조립이면 Gold.** 흩어진 식별자를 하나로 묶는 조인은 Silver. 분석 편의를 위해 차원을 펼쳐 붙이는 조인은 Gold.

리드를 정했으니, 이 룰들을 실제 변환에 적용해 보자. 이것이 이 글의 시그니처 표다.

| 변환 예시 | B | S | G | 근거 |
|----------|:-:|:-:|:-:|------|
| 적재 시각 부착 | O | | | 복원 불가 메타 |
| 통화 환산(정합) | | O | | 사실 정합(B) |
| 결측 보정 | | O | | 엔티티 정합(B) |
| 세션화 | | O | | 사실 재구성(B) |
| 고객 식별자 통합 | | O | | 엔티티 통합(D) |
| 일별 누적합·KPI | | | O | "얼마"(B) |
| 부서별 마트 로직 | | | O | 정의 변동(C) |

빈칸은 "그 레이어에 두면 안 됨"이 아니라 "주 위치가 아님"을 뜻한다. B=Bronze, S=Silver, G=Gold, 괄호 안은 적용 룰이다.

앞의 카드 결제 시나리오에 룰 B를 적용해 보자. "이 결제가 취소됐는가"는 거래에 대한 **사실 정합**이다 — 카드사마다 다른 취소 코드(`CNCL`, `CNCL_REQ`)를 하나의 표준 상태로 통합하는 일은 "무엇인가"이므로 Silver다. 반면 "이번 달 취소율"은 그 사실 위에서 세는 **집계**이므로 "얼마인가", 곧 Gold다.

```sql
-- ✓ Silver: 취소 여부 표준화 (사실 — 룰 B: "무엇인가")
SELECT
  txn_id,
  CASE status
    WHEN 'CNCL' THEN 'cancelled'
    WHEN 'CNCL_REQ' THEN 'cancelled'   -- 카드사별 코드 통합
    WHEN 'APPR' THEN 'approved'
    ELSE 'unknown'
  END AS txn_status,
  amount
FROM `proj.bronze.card_transactions`;

-- ✓ Gold: 취소율 집계 (지표 — 룰 B: "얼마인가")
SELECT
  DATE(txn_at) AS dt,
  COUNTIF(txn_status = 'cancelled') / COUNT(*) AS cancel_rate
FROM `proj.silver.transactions`
GROUP BY dt;
```

룰 A도 같은 시나리오에서 갈린다. 카드번호 마스킹은 리스크팀과 마케팅팀이 **모두** 보는 변환이므로 Silver에 한 번 두고 공유한다(소비처 둘 이상). 반면 일별 VIP 지출 집계는 마케팅 마트 하나만 쓰므로 그 마트 안(Gold)에 둔다(소비처 하나).

경계를 정했으면, 다음은 그 경계를 *흐름*이 어기지 않게 하는 일이다.

---

## 레이어 간 데이터 흐름과 변환 원칙

레이어를 잘 나눠도 데이터가 흐르는 방식이 어긋나면 경계는 무너진다. 흐름에는 세 가지 원칙이 있다.

### 단방향 의존성

의존성은 항상 한 방향으로만 흘러야 한다. Gold의 결과를 Silver가 다시 참조하는 순간 순환이 생기고, 무엇을 먼저 돌려야 하는지 알 수 없어진다.

```text
정상:    Bronze → Silver → Gold

스파게티: Bronze → Silver → Gold
                  ↑__________↓   ← 역참조 = 순환
```

순환은 재처리 순서를 비결정적으로 만든다. 어느 쪽을 먼저 갱신해도 다른 쪽이 옛 값을 본다.

### 변환 위치 단일화

> 같은 변환이 두 레이어에 보이면, 둘 중 하나는 틀린 위치다.

같은 표준화나 같은 집계가 Silver와 Gold 양쪽에 나타나면 정의가 갈라진다. 처음엔 같은 값을 내다가, 한쪽만 수정되는 순간 두 숫자가 어긋난다. 변환은 한 곳에만 둔다.

### 멱등성과 MERGE

재처리에 강하려면 같은 입력을 두 번 넣어도 결과가 같아야 한다. `append`는 중복을 쌓지만, `MERGE`는 키로 맞춰 멱등하게 동작한다.

```sql
MERGE `proj.bronze.events` T
USING `proj.landing.events` S
ON  T.event_id = S.event_id
AND T._ingested_at = S._ingested_at
WHEN NOT MATCHED THEN
  INSERT (event_id, payload, _ingested_at)
  VALUES (S.event_id, S.payload, S._ingested_at);
```

`WHEN NOT MATCHED THEN INSERT`만 두면 이미 들어온 행은 건너뛴다. 같은 배치를 다시 돌려도 아무 일도 일어나지 않는다.

### 증분 처리와 전체 재처리

매번 전부 다시 만들면 비용이 감당되지 않는다. 바뀐 부분만 처리하는 증분과, 통째로 다시 만드는 전체 재처리 중 하나를 고른다. 증분의 기준점은 마지막으로 처리한 지점을 가리키는 하이워터마크(high-watermark)다.

| 기준 | 증분 | 전체 재처리 |
|------|------|------------|
| 워터마크 | `_ingested_at` 하이워터마크 | 불필요 |
| 비용·지연 | 낮음 | 높음 |
| 멱등 보장 | MERGE 키 필요 | 자연 멱등 |
| 적합 상황 | 대용량·고빈도 | 로직 변경·소량 |

대용량·고빈도 파이프라인은 증분, 로직을 바꿔 과거까지 다시 만들어야 할 땐 전체 재처리다.

원칙을 알았으니, 이 원칙이 깨지는 구체적인 방식 — 패턴과 안티패턴을 본다.

---

## 실전 패턴과 안티패턴

설계 원칙보다 자주 마주치는 것은, 그 원칙이 지켜지거나 무너지는 구체적인 형태다. 이름을 붙여 카탈로그로 만들면 자기 코드에서 알아볼 수 있다.

먼저 반복해서 쓸 만한 패턴들이다.

| 패턴 | 무엇을 해결 | 핵심 처방 |
|------|-------------|-----------|
| Quarantine | 나쁜 데이터가 흐름을 막음 | 격리 테이블로 분리, 흐름 유지 |
| Staging/Landing 분리 | 적재와 보존이 혼재 | landing → bronze 2단 |
| Gold 2단 분할 | 지표 정의 표류 | metric(원자) + mart(조립) |
| Conformed Dimension | 차원 정의 불일치 | 여러 Silver가 공유하는 표준 차원 |

**Conformed Dimension**은 Kimball 차원 모델링 용어로, 여러 팩트 테이블·데이터 마트에서 **동일하게 해석되는 공유 차원**이다. 같은 `날짜`·`고객` 차원을 마트마다 따로 만들면 정의가 갈라지므로, 표준 차원 하나를 만들어 공유한다.

이번엔 거꾸로, 자기 코드에서 찾아내야 할 안티패턴들이다. "증상"을 현상 묘사형으로 적었으니 자가진단에 쓰면 된다.

| 안티패턴 | 증상 | 처방 |
|----------|------|------|
| Bronze 오염 | 재처리할 원본이 사라짐 | 변환을 Silver로 |
| 로직 표류 | 같은 KPI 숫자가 마트마다 다름 | Gold 2단 분할 |
| 스파게티 DAG | 레이어 간 양방향 참조 순환 | 단방향 강제 |
| 과잉 계층화 | 소비처 1개에 4계층 | 계층 축소 |
| God-Silver | 집계가 Silver로 새어듦 | 경계 룰 B 적용 |

특히 **God-Silver**는 "여기까지 온 김에 집계도 해두자"는 유혹에서 시작된다. 룰 B("얼마인가는 Gold")를 어기는 순간 Gold 경계가 무너지고, 집계 정의가 Silver에 박혀 모든 소비처가 그것에 묶인다.

카드 결제 파이프라인에서 가장 흔히 밟는 안티패턴은 **Bronze 오염**이다. 적재 단계에서 음수 금액(`-1` 같은 오류 데이터)을 미리 걸러내고 싶은 유혹이 강하다. 하지만 Bronze에서 필터링하면 원본이 영구 소실되고, 나중에 "왜 우리 건수가 카드사 원장과 다른가"라는 정산 분쟁이 터졌을 때 복원할 근거가 사라진다.

```sql
-- ✗ Bronze에서 필터 → 원본 소실, 원장 대조 불가
INSERT INTO `proj.bronze.card_transactions`
SELECT * FROM `proj.landing.card_transactions_raw`
WHERE amount > 0;   -- 음수 원본이 영구 소실됨

-- ✓ Bronze는 전량 보존, 음수 격리는 Silver에서
INSERT INTO `proj.bronze.card_transactions`
SELECT * FROM `proj.landing.card_transactions_raw`;  -- 전량 보존

INSERT INTO `proj.silver.transactions_quarantine`
SELECT *, 'negative_amount' AS _reason
FROM `proj.bronze.card_transactions`
WHERE amount < 0;
```

또 하나는 **스파게티 DAG**의 변종 — Gold가 Silver를 건너뛰고 Bronze를 직접 참조하는 경우다. 리스크 리포트가 표준화를 우회해 `bronze.card_transactions`의 원본 `status`를 직접 집계하면, 카드사가 status 코드 체계를 바꾸는 날 리포트 전체가 조용히 깨진다. Silver가 흡수했어야 할 소스 변경이 Gold까지 그대로 새어 나오기 때문이다.

```sql
-- ✗ Gold가 Bronze 직접 참조 (Silver 우회)
SELECT status, COUNT(*) AS cnt
FROM `proj.bronze.card_transactions`   -- ← 표준화 안 된 원본 코드
WHERE DATE(txn_at) = CURRENT_DATE()
GROUP BY status;

-- ✓ Gold는 Silver만 참조 (표준화 완료된 상태)
SELECT txn_status, COUNT(*) AS cnt
FROM `proj.silver.transactions`
WHERE DATE(txn_at) = CURRENT_DATE()
GROUP BY txn_status;
```

패턴으로 흐름을 다스렸다면, 마지막은 그 흐름이 나쁜 데이터를 통과시키지 않게 막는 일이다.

---

## 데이터 품질 보장 전략 — 계약으로서의 경계

DQ를 "검사 모음"으로 보면 검사가 흩어진다. 레이어 경계를 **데이터 계약(data contract)의 검증 지점**으로 보면, 어떤 검사를 어디에 둘지가 분명해진다.

> 레이어 경계는 곧 데이터 계약이다. 계약을 어긴 데이터는 다음 층으로 넘어가지 못한다.

검사 유형마다 자연스러운 경계가 있다.

| 검사 유형 | 어느 경계 | 예시 |
|-----------|-----------|------|
| 스키마 | 진입(Bronze 전) | 컬럼·타입 |
| 완전성 | Silver 적재 후 | null·중복 |
| 유효성 | Silver | 도메인·범위 |
| 정합성 | Silver | 참조 무결성 |
| 적시성 | 경계 공통 | freshness |
| 분포 | Gold 전 | 이상 탐지 |

검사가 실패했을 때의 정책도 둘로 갈린다. 멈출 것인가, 격리하고 흘릴 것인가.

| 정책 | fail-fast | warn-and-quarantine |
|------|-----------|---------------------|
| 동작 | 위반 시 즉시 중단 | 위반 행만 격리, 나머지 진행 |
| 지키는 것 | 정확성 | 가용성 |
| 위험 | 정상 데이터까지 멈춤 | 격리 테이블 방치 |
| 적합 | 핵심 지표(매출) | 부가 지표 |

핵심 지표는 fail-fast, 부가 지표는 warn-and-quarantine처럼 **중요도에 따라 섞는다.** 예를 들어 환율의 적시성(freshness)이 깨지면 환산 결과가 통째로 틀어지므로 fail-fast가 맞고, 세션 길이 분포가 평소와 다른 정도는 격리해 두고 살펴봐도 된다.

카드 결제 파이프라인에서는 이 둘이 더 뚜렷하게 갈린다. 금융 규제상 음수 금액·중복 `txn_id`·미표준화 상태(`unknown`)는 정확성이 곧 컴플라이언스이므로 **즉시 차단(fail-fast)** 한다 — 위반이 하나라도 있으면 Gold 갱신 자체를 멈춘다. 반면 가맹점 분류 코드가 비어 있는 정도는 지표를 완전히 무효화하지는 않으므로, 해당 행만 **격리(quarantine)** 하고 나머지는 흘려보낸다.

```sql
-- Silver 적재 후 계약 검증
DECLARE violations INT64;
SET violations = (
  SELECT COUNT(*) FROM `proj.silver.transactions`
  WHERE DATE(txn_at) = CURRENT_DATE()
    AND (amount < 0 OR txn_status = 'unknown' OR txn_id IS NULL)
);

IF violations > 0 THEN
  -- ✓ 핵심 지표: fail-fast (금융 규제 준수)
  CALL `proj.utils.raise_alert`('silver_dq_violation',
    FORMAT('%d 건 DQ 계약 위반 — Gold 갱신 중단', violations));
END IF;

-- ✓ 부가 지표: quarantine (가맹점 미지 코드)
INSERT INTO `proj.silver.transactions_quarantine`
SELECT *, 'unknown_merchant' AS _reason, CURRENT_TIMESTAMP() AS _quarantined_at
FROM `proj.silver._staged`
WHERE merchant_category IS NULL;
```

스키마가 바뀌어 미지의 코드나 신규 컬럼이 들어오는 경우는 계약 위반으로 잡아 알람을 띄운다. 이때 검증 도구가 등장한다.

<div class="callout-info">
Great Expectations, dbt test, BigQuery <code>ASSERT</code> 등은 검증을 표현하는 <strong>예시 도구</strong>일 뿐이다. 버전별 동작과 정확한 문법은 각 도구의 공식 문서를 확인하라.
</div>

---

## 마무리 — 설계 결정 체크리스트

경계 판단을 한 장으로 압축하면 다음 여섯 질문이다. 변환을 추가하기 전에 위에서부터 하나씩 짚는다.

- [ ] 이 변환이 실패하면 원본에서 복원 가능한가? — *복원 불가능한 적재 메타만 Bronze*
- [ ] 소비처가 둘 이상인가? — *그렇다면 Silver*
- [ ] "무엇인가"가 아니라 "얼마인가"인가? — *집계·지표면 Gold*
- [ ] 비즈니스 정의가 바뀌면 이 코드도 바뀌어야 하는가? — *그렇다면 Gold*
- [ ] DAG 방향이 단방향(→)이고 역참조가 없는가? — *없어야 정상*
- [ ] 이 지표 정의가 이미 다른 Gold에 존재하는가? — *있다면 위치 통합*

세 편을 지나왔다. 00편은 레이어가 무엇인지 그린 지도였고, 01편은 그 구조가 없어 겪은 한 번의 사고 기록이었으며, 02편은 매일 경계를 판단할 때 꺼내는 룰북이다. 지도를 외우는 것과, 사고를 겪는 것과, 룰을 손에 익히는 것은 다른 일이다.

다음으로 다룰 것이 있다면 거버넌스와 데이터 리니지 — 레이어를 넘나드는 데이터의 출처와 흐름을 추적하는 일이다.

---

## 참고

- [[/data-architect/00_what_is_medaliion_architecture]] — Bronze·Silver·Gold 각 계층의 정의와 핵심 원칙
- [[/data-architect/01_how_to_architect_medallion_well]] — 소스 변경을 흡수하지 못한 실제 사고와 Silver의 역할
- Kimball & Ross, *The Data Warehouse Toolkit* (Wiley) — Conformed Dimension과 차원 모델링
- Databricks, *What is the Medallion Lakehouse Architecture?* — 레이어 원형 정의
