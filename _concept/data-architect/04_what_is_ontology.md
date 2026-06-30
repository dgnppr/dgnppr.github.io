---
layout      : concept
title       : 온톨로지는 데이터가 아니라 합의를 설계한다
date        : 2026-05-27 00:00:00 +0900
updated     : 2026-06-29 00:00:00 +0900
tag         : data-architecture data-engineering ontology palantir
toc         : true
comment     : true
latex       : true
status      : writing
public      : true
parent      : [[/data-architect]]
confidence  : high
relations:
  - { type: extends, target: concept/data-architect/03_medallion_advanced_patterns }
  - { type: references, target: concept/data-architect/05_ontology_objects_summary }
---

> 시맨틱 웹의 실패에서 AI 에이전트의 월드모델까지, 데이터 아키텍트의 시선으로 다시 읽는 온톨로지

대부분의 조직은 데이터가 부족하지 않다. **합의된 의미**가 부족할 뿐이다.

"활성 고객이 몇 명인가"라는 한 문장에 마케팅과 재무가 다른 숫자를 들고 회의에 들어온다. 이건 파이프라인의 결함이 아니다. 같은 단어가 부서마다 다른 세계를 가리키고 있다는 증상이다. 우리는 이 병을 인프라로 덮으려 한다 — 더 많은 테이블, 더 많은 마트, 더 많은 대시보드. 정작 필요한 건 "우리 조직이 세계를 어떻게 보기로 약속했는가"에 대한 단 하나의 형식화된 답인데도.

온톨로지는 바로 그 답이다. 이 글의 주장은 이것이다. **온톨로지는 또 하나의 데이터 모델이 아니라, 조직의 의미에 대한 합의를 코드로 적은 것이다.** 그리고 LLM 시대에 들어, 이 합의는 갑자기 "있으면 좋은 것"에서 "가장 값진 인프라"로 격상됐다.

---

## 1. 진짜 병은 '의미의 드리프트'다

스타 스키마와 ERD는 한 시대의 위대한 발명이었다. 하지만 그것들이 푼 문제는 **저장과 질의**였지 **의미**가 아니었다. 전통적인 웨어하우스+BI 스택은 엔티티 간의 관계를 외래키와 조인으로 표현하고, 정작 "이 숫자가 무엇을 뜻하는가"는 대시보드와 SQL 주석으로 밀어낸다.

그 결과 의미는 코드 곳곳과 분석가의 머릿속(tribal knowledge)에 흩어진다. 분석가 A는 활성 고객을 90일로, B는 180일로 쓴다. 시간이 지나면 정의는 서로 갈라진다. 이것을 **의미의 드리프트(semantic drift)** 라고 부른다. 지표 자체가 틀린 게 아니라, 같은 이름의 지표가 서로 다른 정의를 가리키는 것이다. 데이터 거버넌스가 회의 때마다 무너지는 원인은 여기에 있다.

온톨로지는 데이터를 더 깔끔하게 저장하려는 시도가 아니다. 이 드리프트를 멈추려는 시도다.

---

## 2. 계속 돌아오는 아이디어

온톨로지는 IT 유행어이기 전에 철학 용어였다. 아리스토텔레스의 범주론, "존재하는 것은 무엇이며 어떻게 분류되는가"를 다루는 존재론. 이 질문이 정보과학으로 넘어오며 같은 형태로 반복해서 부활한다.

- **지식 표현(KR)의 시대**: 1980~90년대, CYC 프로젝트와 기술논리(description logics)는 세계의 상식을 형식 논리로 적으려 했다.
- **시맨틱 웹**: 2001년 팀 버너스리는 기계가 의미를 이해하는 웹을 제안했다. RDF·OWL·SPARQL은 지적으로 아름다웠다. 그리고 기업 현장에서는 대체로 실패했다.

왜 실패했나. 세 가지다. 첫째, **열린 세계 가정(open-world assumption)** — "누구나 무엇에 대해 무엇이든 말할 수 있다"는 전제는 학술적으로 우아하지만 기업의 폐쇄적·규범적 현실과 맞지 않았다. 둘째, **막대한 선행 형식화 비용** — 한 줄의 가치를 보기 전에 온 세계를 온톨로지로 적어야 했다. 셋째, **경제적 강제력의 부재** — 안 해도 당장 망하지 않았다.

그런데도 이 아이디어는 죽지 않는다. 근저의 욕구 — "조직이 공유하는 의미" — 가 사라진 적이 없기 때문이다. 실패한 것은 구현이지 문제의식이 아니었다. 지금의 부활은 그 문제의식이 마침내 경제적 강제력을 만난 결과다.

---

## 3. 시맨틱 레이어는 온톨로지가 아니다

이 구분을 흐리면 글 전체가 흐려진다. 그래서 가장 먼저 못을 박는다.

요즘 "시맨틱 레이어"가 다시 뜨거운 주제다. dbt Semantic Layer(MetricFlow), Cube, LookML, Snowflake Semantic Views, Databricks의 메트릭. 이들의 임무는 분명하다. **마케팅과 재무가 각자 고객획득비용을 계산해도 같은 숫자가 나오게 하는 것.** 지표를 한 번 정의하면 BI·노트북·리버스 ETL·임베디드 분석이 그 정의를 상속한다. 정의가 흩어져 드리프트하던 문제를 정면으로 푼다. 훌륭한 진전이고, 2026년 들어 dbt Labs와 Fivetran이 합병하고 Open Semantic Interchange(OSI)라는 벤더 중립 표준이 등장하면서 이 계층은 인프라급으로 수렴하고 있다.

하지만 시맨틱 레이어에는 **경계**가 있다. 그것은 "고객 매출을 *어떻게 측정하는가*"를 다룬다. 온톨로지는 그보다 한 층 아래, "고객이란 *무엇이고*, 무엇과 *어떻게 연결되며*, 그 위에서 무슨 *행동이 가능한가*"를 다룬다. 업계의 표현을 빌리면 이렇게 갈린다.

> **온톨로지는 "고객"의 의미를 정의하고, 시맨틱 레이어는 "고객 매출"을 측정하는 방법을 정의한다.**

전자는 지식 표현(knowledge representation)이고, 후자는 지표 계약(metric contract)이다. 둘은 경쟁이 아니라 층위가 다르다. 대부분의 조직은 분석 일관성을 위해 시맨틱 레이어로 시작하고, AI 유스케이스가 더 풍부한 맥락 — 엔티티, 관계, 행동 — 을 요구하기 시작할 때 그 아래에 온톨로지를 깐다. dbt가 온톨로지를 대체하느냐는 질문의 정답은 간결하다. 전혀 아니다. 둘은 보완재다.

---

## 4. 온톨로지의 해부 — 의미·운동·시간

온톨로지를 가장 명료하게 해부한 것은 Palantir의 3계층 모델이다. 나는 이 프레임이 마케팅 용어를 넘어 실제 아키텍처 원리라고 본다.

**① 의미 계층(Semantic).** 객체(objects), 속성(properties), 링크(links). 세계에 무엇이 존재하고 어떻게 관계 맺는가. 이것이 **명사**다.

예를 들어 항공사 운영 도메인을 온톨로지로 적으면 다음과 같다.

```
Object Type: Flight        — 특정 날짜에 운항하는 항공편 단위
  Properties:
    flightNumber  : string     "KE001"
    status        : string     "ON_TIME" | "DELAYED" | "CANCELLED"
    scheduledDepart: timestamp 2026-06-29T09:00:00+09:00
    delayMinutes  : integer    (파생: actualDepart - scheduledDepart)

Object Type: CrewMember    — 운항에 배치되는 승무원
Object Type: Airport       — 출발·도착 공항

Link Type: Flight --[hasCrew / assignedTo]--> CrewMember   (MANY_TO_MANY)
Link Type: Flight --[departsFrom / originFlights]--> Airport (MANY_TO_ONE)
```

SQL에서는 `flights.tail_num = aircraft.reg_no`라는 조인 조건이 외래키로 표현된다. 온톨로지에서는 `Flight --[operatedBy]--> Aircraft`라는 **이름이 있는 관계**로 표현된다. 관계에 비즈니스 의미를 담는 것이 핵심이다.

**② 운동 계층(Kinetic).** 액션(actions)과 함수(functions). 거버넌스 아래에서 세계를 *바꾸는* 행위. 이것이 **동사**다.

```
Action Type: delayFlight
  Parameters  : flight, delayMinutes, reason, notifyPassengers
  Validation  : status != "CANCELLED", delayMinutes > 0
  Effects     : MODIFY_OBJECT flight { status → "DELAYED", actualDepart → ... }
  Notification: 운항 통제 채널 웹훅 + 승객 SMS

Action Type: reassignCrew
  Parameters  : flight, removeCrew, addCrew
  Validation  : addCrew가 해당 시간대 다른 편에 미배정
  Effects     : DELETE_LINK + CREATE_LINK (flight ↔ crew)
```

액션이 중요한 이유는 단순히 데이터를 쓰기(writeback) 때문이 아니다. **누가, 언제, 어떤 검증 아래, 어떤 변경을 허용하는가**를 온톨로지 계층에서 선언하기 때문이다. 앱 코드 5곳이 각자 `UPDATE` 문을 날리는 것과 근본적으로 다르다.

**③ 동역학 계층(Dynamic).** 시뮬레이션, AI, 폐루프(closed-loop). 모델이 시간 속에서 진화하고, 내려진 의사결정이 다시 데이터로 되먹임되는 층.

시맨틱 레이어와 온톨로지를 가르는 결정적 차이가 여기서 드러난다. **온톨로지에는 동사(kinetic)와 시간(dynamic)이 있다.** 대시보드는 답을 *보여주고*, 온톨로지는 그 답으로 세계를 *바꾼다*. dashboards가 아니라 decisions.

> 각 구성 요소(Object, Property, Link, Action, Interface, Object Set)의 상세 스펙과 코드 예시는 [[05_ontology_objects_summary]] 참고.

---

## 5. 가장 지루하고, 가장 중요한 것: 동일성

화려한 다이어그램 뒤에 아무도 블로그에 쓰지 않는 80%가 있다. **동일성 해소(entity resolution).**

이 회원번호와 저 GA `client_id`가 같은 사람인가? 통합된 `customer_key`는 어떻게 확정되는가? 온톨로지의 객체는 결국 여러 소스를 표준 키로 묶은 결과이고, **모델의 품질은 정확히 그 키의 품질만큼이다.** 아무리 우아한 객체-링크 그래프를 그려도, identity가 흔들리면 그 위의 모든 것이 흔들린다.

항공사 예시로 돌아오면: `Flight`의 Primary Key를 `flightNumber`(예: "KE001")로 잡으면 날짜마다 중복이다. `flightId = flightNumber + date`로 합성하면 코드 배리에이션(KE001 vs KE 001)이 충돌한다. 좋은 온톨로지는 이 문제를 모델링 단계에서 명시적으로 다루고, DQ 게이트로 단단히 잠근다.

이 작업이 지루하다는 사실이야말로, 대부분의 "온톨로지 도입"이 데모에서 멈추는 이유다.

---

## 6. 의미의 거버넌스 — 정의에도 이력이 있다

온톨로지의 가장 깊은 가치는 다이어그램도, 셀프서비스도 아니다. **단어의 뜻에 대한, 버전 관리된 제도적 기억**이다.

"활성 고객 = 90일"이라는 정의를 어느 분기에 60일로 바꿨다고 하자. 평범한 조직에서는 누군가의 SQL 한 줄이 조용히 바뀌고, 과거 리포트는 영원히 재현 불가능해진다. 온톨로지에서는 정의 자체가 코드(definition-as-code)이고, 그 변경이 이력으로 남는다. 나는 이걸 **의미의 SCD2** 라고 부른다 — 사실 데이터가 아니라 *정의*에 `valid_from` / `valid_to`가 붙는 것이다.

```yaml
# 온톨로지 프로퍼티 정의 — 의미의 SCD2
activeCustomer:
  definition : "마지막 구매로부터 N일 이내 재구매 이력이 있는 고객"
  valid_from : 2024-01-01
  valid_to   : 2025-12-31
  threshold  : 90   # 일

activeCustomer:
  definition : 위와 동일
  valid_from : 2026-01-01
  threshold  : 60   # 분기 정책 변경
```

이것이 갖춰지면 조직은 분기마다 "그래서 활성 고객이 정확히 뭐였지?"를 재논쟁하지 않게 된다. 의미가 합의의 대상이자 감사의 대상이 되고, 데이터팀은 정의 분쟁의 중재자 역할에서 해방된다.

---

## 7. 왜 하필 지금인가 — 에이전트의 월드모델

오래된 아이디어가 부활한 진짜 동력은 LLM이다.

흥미롭게도 dbt가 2026년에 다시 돌린 벤치마크는 미묘한 결과를 보여준다. 모델이 좋아지면서, LLM에게 raw SQL을 직접 쓰게 하는 방식(text-to-SQL)이 구조화된 의미 모델을 거치는 방식과의 정확도 격차를 상당히 좁혔다. 다만 의미 계층은 **모델링된 범위 안에서는 결정론적 정확성**을 보장하고, 그 대가는 커버리지다. 즉 LLM이 점점 똑똑해질수록, 모델이 *못 쓰는* 쿼리를 막는 것보다 모델에게 *올바른 세계관*을 주는 것이 핵심이 된다.

그리고 세계관은 지표만으로 만들어지지 않는다. 에이전트는 "무엇이 존재하고, 무엇과 연결되며, 무슨 행동이 가능한가"를 알아야 한다. 그게 정확히 온톨로지가 주는 것이다. **온톨로지는 에이전트의 월드모델이 된다.**

구체적으로 보면 이렇다. 운항 통제사가 AIP 에이전트에게 말한다.

```
"오늘 인천 출발편 중 지연 30분 이상인 건들 뽑아서
 환승 승객이 있으면 연결편 리스크 알려줘"
```

에이전트는 SQL을 모른다. 온톨로지가 주는 개념만 쓴다.

```
Step 1. 오브젝트 조회
  Flight.where(departsFrom="ICN", scheduledDepart.isToday(), delayMinutes >= 30)
  → KE001(60분 지연), KE723(45분 지연)

Step 2. 링크 탐색 (Search Around)
  KE001.links.carriesPassenger.where(hasConnectingFlight=true)
  → 23명 환승, 이 중 7명 연결편 마감 위험

Step 3. 에이전트 응답
  "KE001(60분 지연): 환승 승객 23명 중 7명 연결편 위험.
   JL096(도쿄행) 연결 5명이 가장 촉박합니다.
   delayFlight 액션을 실행하거나 lounge 이동을 안내하시겠습니까?"

Step 4. 운항 통제사 승인 → 액션 실행
  actions.notifyTransitPassengers(flight=KE001, urgencyLevel="HIGH")
```

테이블 1,000개의 스키마를 던지는 대신 객체·관계·행동으로 압축된 지도를 주면, 환각은 줄고 행동은 통제 가능해진다. Palantir는 Ontology MCP를 통해 이 지도를 외부 AI 에이전트에도 노출한다. 에이전트가 마음대로 `UPDATE`를 날리는 게 아니라, 온톨로지가 허용한 동사(Action)만 호출한다. **운동 계층(kinetic)이 곧 AI 안전장치가 되는 셈이다.** 분석→의사결정→실행이라는 루프가, 사람만이 아니라 에이전트에게도 열린다.

---

## 8. 그늘 — 온톨로지가 실패하는 법

온톨로지는 자주 실패하고, 실패 양상은 거의 정해져 있다.

가장 흔한 실패는 **온톨로지를 프로젝트로 취급하는 것**이다. 어느 플랫폼 팀이 몇 달에 걸쳐 고객·계정·거래·상품을 멋지게 모델링한다. 그런데 그 모델을 라이브 메타데이터에 연결하지 않는다. 신규 사업이 생기고, 인수로 시스템이 셋 늘고, 테이블이 폐기되어도 온톨로지는 모른다. 결국 그것은 *더 이상 존재하지 않는 비즈니스*를 모델링하게 된다.

두 번째는 **전체를 한 번에 모델링하려는 시도(boil the ocean)** — 첫 가치를 검증하기 전에 7개 도메인을 한꺼번에 모델링하려다 실패한다. 세 번째는 **과형식화** — 아무도 안 쓰는 정교한 분류 체계. 그리고 마지막으로, 작고 안정적이고 단일 팀이 쓰는 데이터라면 **애초에 온톨로지가 필요 없다.** 도구가 아니라 문제가 정당화해야 한다.

잘못된 설계의 냄새는 명확하다.

| 나쁜 예 | 좋은 예 | 이유 |
|--------|--------|------|
| Object Type: `FlightDelayHandler` | `Flight` + `delayFlight` Action | Object는 명사, 동사는 Action |
| Link: `hasCrew` + 앱 코드에서 `crewType == PILOT` 필터 | Link: `hasPilot` (기장 전용 링크) | 링크에 비즈니스 의미를 담아야 |
| `col_delay_min`, `flt_stat_cd` | `delayMinutes`, `status` | 비즈니스 언어 우선 |
| 각 앱 5곳에서 각자 지연 처리 검증 | Action validation rule 한 곳 | 검증은 온톨로지 계층에서 |

규칙은 하나다. **온톨로지는 프로젝트가 아니라 인프라로 취급될 때만 유효하게 유지된다.** 작게 시작해, 라이브 데이터에 묶고, 정의를 코드로 버전 관리하며, 가치를 증명하면서 키운다.

---

## 9. 정리

기술 스택의 관점에서 보면 온톨로지는 객체·링크·액션의 모음이다. 하지만 한 발 물러서면 그것은 훨씬 단순하고 훨씬 묵직한 무언가다. **조직이 자기 자신을 이해하는 방식을, 코드로 적은 것.**

우리는 테이블을 모델링한다고 믿지만, 좋은 온톨로지는 사실 *합의*를 모델링한다 — 우리가 세계를 어떻게 보기로 약속했는가에 대한. 그 합의가 흩어진 SQL과 부족 지식이 아니라 단 하나의 검증 가능한 모델에 살아 있을 때, 그리고 그 모델이 인간과 AI 에이전트가 공유하는 단일한 세계 지도가 될 때, 온톨로지는 더 이상 데이터 아키텍처의 한 계층이 아니다. 그것은 조직이 소유한 가장 값진 인프라가 된다.

> 의미는 한 곳에. 정의에는 이력을. 그리고 우리는 데이터가 아니라, 세계를 보는 방식을 설계한다.

---

## 참고 (References)

- Palantir, *The Ontology system / Foundry Ontology overview* — semantic·kinetic 요소와 3계층 구조
  https://www.palantir.com/docs/foundry/architecture-center/ontology-system
- Palantir, *Foundry platform summary for LLMs* — Ontology MCP와 에이전트 연동
  https://www.palantir.com/docs/foundry/getting-started/foundry-platform-summary-llm
- dbt Labs, *Semantic Layer vs. Text-to-SQL: 2026 Benchmark Update*
  https://docs.getdbt.com/blog/semantic-layer-vs-text-to-sql-2026
- Atlan, *Ontology vs. Semantic Layer: Differences & How to Choose (2026)* — OSI, 보완 관계
  https://atlan.com/know/ontology-vs-semantic-layer/
- DataHub, *Ontology vs. Semantic Layer: What's Missing* — '프로젝트가 아닌 인프라' 실패 모드
  https://datahub.com/blog/ontology-vs-semantic-layer/
