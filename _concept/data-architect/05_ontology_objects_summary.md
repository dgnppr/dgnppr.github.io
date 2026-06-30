---
layout      : concept
title       : 팔란티어 온톨로지 Objects · Properties · Links · Actions
date        : 2026-06-22 00:00:00 +0900
updated     : 2026-06-22 00:00:00 +0900
tag         : palantir foundry ontology data-architect
toc         : true
comment     : true
latex       : true
status      : complete
public      : true
parent      : [[/data-architect]]
confidence  : high
---

* TOC
{:toc}

## 개요

팔란티어 Foundry의 **온톨로지(Ontology)**는 기업의 실세계 개체(entity)와 운영 개념을 코드가 아닌 **비즈니스 언어로 모델링**하는 의미 계층이다.  
데이터 파이프라인 위에 "무엇이 존재하고, 어떻게 연결되며, 어떤 행동을 할 수 있는가"를 선언적으로 정의한다.

엔지니어가 파이프라인을 만들고, 분석가·운영자·AI 에이전트(AIP)는 온톨로지를 통해 동일한 세계 모델을 공유한다.

> **도메인 예시**: 이 문서 전체에서 **항공사 운영** 도메인을 일관된 예시로 사용한다.  
> `Flight`(항공편), `Aircraft`(항공기), `CrewMember`(승무원), `Airport`(공항), `Passenger`(승객)가 주요 Object Type이다.

---

## 1. Object Type (오브젝트 타입)

### 개념

온톨로지의 **핵심 단위**. 실세계의 명사(noun)에 해당한다.  
"항공기", "직원", "주문", "공장" 같은 비즈니스 개체 범주를 정의한다.

### 구성 요소

| 요소 | 설명 |
|------|------|
| **Primary Key** | 각 오브젝트 인스턴스를 고유하게 식별하는 필드 |
| **Display Name** | 사람이 읽는 이름 (예: `Employee`, `Flight`) |
| **Description** | 이 타입이 무엇을 나타내는지 서술 |
| **Data Source** | 기반 데이터셋 (Foundry Dataset, Marketplace 등) |
| **Title Property** | 오브젝트 인스턴스를 대표하는 표시 프로퍼티 |

### Object vs Object Type

- **Object Type**: 범주의 정의 — `Flight` (설계도, "항공편이란 무엇인가")
- **Object (Instance)**: 실제 개체 — `KE001` (2026-06-29 인천→뉴욕 편)

### 예시

```
Object Type: Flight
  Primary Key : flightId          (예: "KE001-20260629")
  Display Name: "Flight"
  Description : 특정 날짜에 운항하는 항공편 단위
  Data Source : ri.foundry.dataset.flights_master
  Title Prop  : flightNumber      (UI에 "KE001"로 표시)

Object Type: Aircraft
  Primary Key : tailNumber        (예: "HL7700")
  Description : 실제 항공기 기체 단위
  Title Prop  : tailNumber

Object Type: CrewMember
  Primary Key : employeeId        (예: "EMP-20481")
  Description : 운항에 배치되는 승무원 (기장, 부기장, 객실 승무원)
  Title Prop  : name
```

운항 관리자는 `Flight` 오브젝트를 열면 "어떤 기체(Aircraft)가 배정됐고, 누가(CrewMember) 탑승하며, 어느 공항(Airport)에서 출발하는지"를 한 화면에서 볼 수 있다.

---

## 2. Property (프로퍼티)

### 개념

Object Type에 속하는 **속성(attribute)**. 각 오브젝트 인스턴스가 갖는 값.

### 프로퍼티 타입

| 유형 | 설명 | 예시 |
|------|------|------|
| **Scalar** | 단일 값 | `string`, `integer`, `double`, `boolean`, `timestamp`, `date` |
| **Array** | 동일 타입 값의 목록 | `string[]`, `integer[]` |
| **Struct** | 중첩 구조 | `{ city: string, lat: double, lon: double }` |
| **Attachment** | 파일 첨부 참조 | PDF, 이미지 등 |
| **Marking** | 보안·접근 제어 메타데이터 | NEED TO KNOW, CONFIDENTIAL |

### 프로퍼티 가시성

| 레벨 | 설명 |
|------|------|
| `NORMAL` | 기본. 모든 API·UI에서 노출 |
| `SENSITIVE` | 민감 데이터. 명시적 접근 시에만 반환 |
| `INTERNAL` | 내부 연산용. 외부 노출 안 함 |

### Derived Property (파생 프로퍼티)

다른 프로퍼티나 Link를 기반으로 계산되는 값. 저장되지 않고 쿼리 시 실시간 계산된다.

### 예시

**`Flight` Object Type의 프로퍼티 목록:**

```
flightNumber    : string       (NORMAL)   — "KE001"
status          : string       (NORMAL)   — "ON_TIME" | "DELAYED" | "CANCELLED"
scheduledDepart : timestamp    (NORMAL)   — 2026-06-29T09:00:00+09:00
actualDepart    : timestamp    (NORMAL)   — 2026-06-29T09:34:00+09:00
delayMinutes    : integer      (NORMAL)   — 34  ← actualDepart - scheduledDepart로 파생 가능
passengerCount  : integer      (NORMAL)   — 312
fuelLoadKg      : double       (INTERNAL) — 운항 연산 내부용, UI 비노출
crewSalaryData  : double       (SENSITIVE)— 인사팀만 접근 가능
route           : struct       (NORMAL)   — { origin: "ICN", destination: "JFK", distanceKm: 11050 }
flightPlan      : Attachment   (NORMAL)   — 운항 계획서 PDF
```

**Derived Property 예시 — `delayMinutes`:**

```python
# scheduledDepart, actualDepart 두 프로퍼티로 런타임 계산
delay_minutes = (actual_depart - scheduled_depart).total_seconds() / 60
```

저장 공간을 쓰지 않고, 원본 timestamp가 수정되면 즉시 반영된다.

---

## 3. Link Type (링크 타입)

### 개념

두 Object Type 사이의 **관계(relationship)**를 정의한다. 관계형 DB의 foreign key와 유사하지만, 비즈니스 의미를 명시적으로 담는다.

### 카디널리티

| 유형 | 의미 | 예시 |
|------|------|------|
| **ONE_TO_ONE** | 1:1 | 직원 ↔ 사원증 |
| **ONE_TO_MANY** | 1:N | 부서 → 직원들 |
| **MANY_TO_MANY** | N:M | 항공편 ↔ 탑승객들 |

### 방향성

Link Type은 **양방향** 이름을 각각 갖는다:

```
Flight --[hasCrew]--> CrewMember
CrewMember --[assignedTo]--> Flight
```

`hasCrew` / `assignedTo` 가 서로 역방향 링크.

### Link vs Relation (차이)

- **Link Type**: 온톨로지에 선언된 구조적 관계 (스키마 수준)
- **Relations/edges**: 그래프 DB 내 실제 인스턴스 간 엣지 (데이터 수준)

### 예시

항공사 도메인의 Link Type 전체 선언:

```
[Flight] --[operatedBy / operates]--> [Aircraft]
  카디널리티: MANY_TO_ONE
  의미: 한 편의 항공편은 하나의 기체로 운항한다.
        한 기체는 여러 항공편에 사용될 수 있다.

[Flight] --[hasCrew / assignedTo]--> [CrewMember]
  카디널리티: MANY_TO_MANY
  의미: 항공편에는 여러 승무원이 배치된다.
        승무원은 여러 항공편에 배정될 수 있다.

[Flight] --[departsFrom / originFlights]--> [Airport]
  카디널리티: MANY_TO_ONE
  의미: 항공편은 하나의 출발 공항을 갖는다.

[Flight] --[arrivesAt / destinationFlights]--> [Airport]
  카디널리티: MANY_TO_ONE

[Flight] --[carriesPassenger / bookedOn]--> [Passenger]
  카디널리티: MANY_TO_MANY
  의미: 항공편에는 여러 승객이 탑승한다.
```

**실제 활용:** 운항 통제실에서 `KE001`을 클릭하면,  
`hasCrew` 링크로 배정된 승무원 명단을, `operatedBy` 링크로 기체 정보를,  
`departsFrom` 링크로 게이트 정보를 즉시 탐색할 수 있다.

---

## 4. Action Type (액션 타입)

### 개념

온톨로지 오브젝트를 **수정·생성·삭제하는 비즈니스 연산**. 단순 CRUD가 아닌 비즈니스 행위(verb)를 코드화한다.

"항공편 지연 처리", "주문 취소", "직원 부서 이동" 같은 운영 동작을 정의한다.

### 구성 요소

| 요소 | 설명 |
|------|------|
| **Parameters** | 액션 실행에 필요한 입력값 |
| **Validation Rules** | 실행 전 사전 검증 (guard conditions) |
| **Effects** | 실행 결과 — 오브젝트 생성/수정/삭제 |
| **Notifications** | 실행 후 트리거되는 알림·웹훅 |
| **Logic (Functions)** | TypeScript 함수로 복잡한 비즈니스 로직 구현 가능 |

### 액션 효과 유형

| Effect | 설명 |
|--------|------|
| `CREATE_OBJECT` | 새 오브젝트 인스턴스 생성 |
| `MODIFY_OBJECT` | 기존 오브젝트 프로퍼티 수정 |
| `DELETE_OBJECT` | 오브젝트 삭제 |
| `CREATE_LINK` | 두 오브젝트 사이 링크 생성 |
| `DELETE_LINK` | 링크 제거 |

### 예시 1 — 단순 액션: 항공편 지연 처리

```
Action Type : delayFlight

Parameters:
  flight         : ObjectType<Flight>   — 대상 항공편
  delayMinutes   : integer              — 지연 시간(분)
  reason         : string               — 지연 사유 ("Weather", "Technical", ...)
  notifyPassengers: boolean             — 승객 SMS 발송 여부

Validation Rules:
  - flight.status != "CANCELLED"        (취소된 편은 지연 처리 불가)
  - delayMinutes > 0                    (양수여야 함)
  - delayMinutes <= 1440               (24시간 초과 불가)

Effects:
  MODIFY_OBJECT flight:
    status         → "DELAYED"
    actualDepart   → scheduledDepart + delayMinutes
    delayReason    → reason

Notifications:
  → 운항 통제 채널 웹훅
  → notifyPassengers == true 이면 SMS 발송 트리거
```

### 예시 2 — 복합 액션: 승무원 교체

```
Action Type : reassignCrew

Parameters:
  flight      : ObjectType<Flight>
  removeCrew  : ObjectType<CrewMember>
  addCrew     : ObjectType<CrewMember>

Validation Rules:
  - removeCrew가 실제로 flight.hasCrew에 존재해야 함
  - addCrew가 해당 시간대에 다른 비행 배정이 없어야 함  ← 복잡한 검증

Effects:
  DELETE_LINK flight --[hasCrew]--> removeCrew
  CREATE_LINK flight --[hasCrew]--> addCrew
  MODIFY_OBJECT addCrew:
    lastAssignedFlight → flight.flightId
```

### Function-backed Action

검증 로직이 복잡할 때 Foundry Functions(TypeScript)로 구현:

```typescript
export const reassignCrew = action({
  parameters: {
    flight: Objects.Flight,
    removeCrew: Objects.CrewMember,
    addCrew: Objects.CrewMember,
  },
  run: async (ctx, params) => {
    // addCrew의 다른 배정 확인
    const conflicts = await params.addCrew.links.assignedTo
      .where(f => f.scheduledDepart.overlaps(params.flight.scheduledDepart))
      .count();

    if (conflicts > 0) {
      throw new ActionValidationError("해당 승무원은 동 시간대에 다른 편에 배정되어 있습니다.");
    }

    ctx.deleteLink(params.flight, "hasCrew", params.removeCrew);
    ctx.createLink(params.flight, "hasCrew", params.addCrew);
    ctx.update(params.addCrew, { lastAssignedFlight: params.flight.flightId });
  },
});
```

---

## 5. Interface (인터페이스)

### 개념

여러 Object Type이 공유하는 **공통 프로퍼티 계약**. 다형성(polymorphism)을 온톨로지 수준에서 구현한다.

인터페이스를 구현하는 Object Type은 선언된 프로퍼티를 반드시 보유해야 한다.

### 예시

항공사 도메인의 두 인터페이스:

**`Locatable` — 실시간 위치를 갖는 모든 오브젝트:**

```
Interface: Locatable
  Properties:
    latitude    : double      — WGS84 위도
    longitude   : double      — WGS84 경도
    lastLocatedAt: timestamp  — 마지막 위치 갱신 시각

Implemented by:
  - Aircraft   (비행 중 실시간 위치)
  - GroundVehicle (공항 지상 차량)
  - Cargo      (화물 추적)
```

**`Schedulable` — 스케줄을 갖는 모든 오브젝트:**

```
Interface: Schedulable
  Properties:
    scheduledStart : timestamp
    scheduledEnd   : timestamp
    actualStart    : timestamp (nullable)
    status         : string    — "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"

Implemented by:
  - Flight
  - MaintenanceJob  (기체 정비)
  - CrewShift       (승무원 근무)
```

**활용:** `Schedulable` 인터페이스로 쿼리하면 Flight, MaintenanceJob, CrewShift를 단일 API 호출로 조회할 수 있다. 운항 현황 대시보드가 세 타입을 동일한 타임라인 컴포넌트에서 렌더링 가능.

---

## 6. Search Around (서치어라운드)

### 개념

특정 오브젝트에서 **Link를 따라 관련 오브젝트를 탐색**하는 기능.  
UI(Slate, Workshop)와 API 모두에서 사용된다.

### 예시

운항 통제실에서 `KE001` 편에 문제가 생겼을 때 Search Around로 영향 범위를 즉시 파악:

```
Flight: KE001 (ICN→JFK, 2026-06-29)
  │
  ├─[operatedBy]──→ Aircraft: HL7700 (Boeing 777-300ER)
  │                    └─ 다음 배정 편: KE002 (JFK→ICN, 익일) ← 연쇄 영향 파악
  │
  ├─[hasCrew]─────→ CrewMember: 김기장, 이부기장, 박승무원 외 11명
  │                    └─ 각자의 다음 배정 편도 탐색 가능
  │
  ├─[departsFrom]─→ Airport: ICN (인천국제공항)
  │                    └─ 현재 날씨, 게이트 상황 조회
  │
  └─[carriesPassenger]→ Passenger: 312명
                         └─ 환승 일정 있는 승객 필터링 가능
```

`KE001`이 2시간 지연되면:  
1. `HL7700`의 다음 편(`KE002`)도 지연 가능성 확인  
2. 환승 마감 시간이 촉박한 승객 자동 식별  
3. 승무원 중 비행 시간 규정 초과 위험 승무원 플래그

모두 Search Around 한 번으로 연결.

---

## 7. Object Set (오브젝트 셋)

### 개념

조건을 만족하는 오브젝트 인스턴스의 **집합(collection)**. 필터, 검색, Link 탐색 결과로 생성된다.  
Object Set은 지연 평가(lazy evaluation)되어 실제 쿼리 시점에 실행된다.

| 생성 방법 | 설명 |
|---------|------|
| 필터 기반 | 프로퍼티 조건으로 필터 |
| 전체 타입 | 특정 Object Type 전체 |
| Search Around | Link 탐색 결과 |
| 집합 연산 | 교집합, 합집합, 차집합 |

### 예시

```python
from foundry import FoundryClient
from ontology import Flight, Airport, CrewMember

client = FoundryClient(...)

# 1. 필터 기반 — 현재 지연 중인 장거리 항공편
delayed_longhaul = (
    client.ontology.objects.Flight
    .where(Flight.status.eq("DELAYED"))
    .where(Flight.route.distanceKm.gt(8000))
)
# → Object Set (아직 쿼리 실행 안 됨)

# 2. Search Around 결과 — ICN 공항 출발 항공편
icn = client.ontology.objects.Airport.get("ICN")
icn_departures = icn.links.originFlights  # Object Set<Flight>

# 3. 교집합 — ICN 출발이면서 지연 중인 장거리 편
icn_delayed_longhaul = icn_departures.intersect(delayed_longhaul)

# 4. 실제 실행 — 여기서 쿼리가 발생
for flight in icn_delayed_longhaul.take(50):
    print(flight.flightNumber, flight.delayMinutes)

# 5. 집계
count = icn_delayed_longhaul.count()
avg_delay = icn_delayed_longhaul.aggregate(Flight.delayMinutes.avg())
```

**지연 평가의 장점:** 위 `.where()` 체인은 실제로 `take()` / `count()` 호출 전까지 실행되지 않는다.  
즉, `icn_delayed_longhaul`을 변수로 전달해서 여러 곳에서 재사용해도 중복 쿼리가 없다.

---

## 8. Ontology API

온톨로지를 **REST / TypeScript SDK / Python SDK**로 조회·조작할 수 있다.

### 예시 — Python SDK 전체 흐름

```python
from foundry import FoundryClient
from ontology import Flight, CrewMember

client = FoundryClient(auth=token, hostname="my-instance.palantirfoundry.com")

# ── 단건 조회 ──────────────────────────────────────
flight = client.ontology.objects.Flight.get("KE001-20260629")
print(flight.status)          # "DELAYED"
print(flight.delayMinutes)    # 34  (Derived Property)

# ── 필터 조회 ──────────────────────────────────────
tomorrow_departures = (
    client.ontology.objects.Flight
    .where(Flight.scheduledDepart.gte("2026-06-30T00:00:00Z"))
    .where(Flight.scheduledDepart.lt("2026-07-01T00:00:00Z"))
    .where(Flight.status.ne("CANCELLED"))
    .order_by(Flight.scheduledDepart.asc())
    .take(200)
)

# ── Link 탐색 ──────────────────────────────────────
crew_members = flight.links.hasCrew.list()
for crew in crew_members:
    print(crew.name, crew.role)   # "김기장 CAPTAIN"

# ── 액션 실행 ──────────────────────────────────────
client.ontology.actions.delayFlight(
    flight=flight,
    delayMinutes=60,
    reason="Weather",
    notifyPassengers=True,
)

# ── 재조회로 변경 확인 ──────────────────────────────
updated = client.ontology.objects.Flight.get("KE001-20260629")
print(updated.status)         # "DELAYED"
print(updated.delayMinutes)   # 60
```

### TypeScript SDK (Foundry Functions 내부)

```typescript
import { Objects, Actions } from "@foundry/ontology-runtime";

// 지연 30분 이상인 항공편 승무원 전체 조회
const delayedFlights = Objects.Flight
  .where(f => f.delayMinutes.greaterThan(30));

for await (const flight of delayedFlights) {
  const crew = await flight.hasCrew.all();
  crew.forEach(c => console.log(`${flight.flightNumber}: ${c.name}`));
}
```

---

## 9. AIP와 온톨로지

**AIP(AI Platform)**는 온톨로지를 LLM의 도구(tool)로 노출한다.  
에이전트가 온톨로지를 통해 실시간 데이터를 조회하고, Action을 실행할 수 있다.

온톨로지가 없으면 LLM은 날것의 DB 스키마를 이해해야 하지만,  
온톨로지가 있으면 **비즈니스 언어로 정의된 인터페이스**를 그대로 사용한다.

### 예시 — AIP 에이전트 실행 흐름

```
운항 통제사: "오늘 ICN 출발편 중 지연 30분 이상인 건들 뽑아서
              환승 승객이 있으면 연결편 리스크 알려줘"

AIP Agent:
  Step 1. 쿼리
    → objects.Flight
        .where(departsFrom == "ICN")
        .where(scheduledDepart.isToday())
        .where(delayMinutes >= 30)
      결과: [KE001(지연 60분), KE723(지연 45분)]

  Step 2. 승객 탐색 (Search Around)
    → KE001.links.carriesPassenger
        .where(hasConnectingFlight == true)
      결과: 23명 환승 승객, 이 중 7명 연결편 마감 위험

  Step 3. 요약 반환
    "KE001(60분 지연): 환승 승객 23명 중 7명 연결편 위험.
     JL096(도쿄행) 연결 승객 5명이 가장 촉박합니다.
     delayFlight 액션을 실행하거나 lounge 이동을 안내하시겠습니까?"

  Step 4. 운항 통제사 승인 → 액션 실행
    → actions.notifyTransitPassengers(flight=KE001, urgencyLevel="HIGH")
```

**핵심:** AIP 에이전트는 SQL을 모른다. 온톨로지가 제공하는 비즈니스 개념과 Action만 사용한다.

---

## 10. 온톨로지 설계 원칙

### 원칙과 반례

| 원칙 | 좋은 예 | 나쁜 예 |
|------|--------|--------|
| **Object Type은 명사** | `Flight`, `CrewMember` | `FlightDelayHandler` (동사) |
| **Action은 비즈니스 이벤트** | `delayFlight` (운항 지연 처리) | `updateFlightStatus` (DB 업데이트 느낌) |
| **Link는 의미를 담는다** | `hasPilot` (기장만 연결) | `hasCrew` + 필터로 기장 구분 (의미 손실) |
| **Interface로 공통 추출** | `Schedulable` 인터페이스 | 각 타입에 `scheduledStart` 중복 선언 |
| **검증은 Action 안에** | Action validation rule에서 규정 시간 초과 검사 | 앱 코드 5곳에서 각자 검사 |
| **비즈니스 언어 우선** | `delayMinutes`, `status` | `col_delay_min`, `flt_stat_cd` |

### 온톨로지가 없을 때 vs 있을 때

```
온톨로지 없음:
  앱 A: SELECT * FROM flights WHERE status = 'DLY'
  앱 B: SELECT * FROM flight_ops WHERE delay_flag = 1
  AIP : (DB 스키마 학습 필요, 앱마다 다름)
  → 각 앱이 DB 스키마를 직접 해석. 스키마 변경 시 모두 수정.

온톨로지 있음:
  앱 A, B, AIP 모두: objects.Flight.where(status.eq("DELAYED"))
  → 스키마가 바뀌어도 온톨로지 매핑만 수정하면 앱은 무변경.
```

---

## 참고

- 팔란티어 Foundry 온톨로지는 **그래프 DB + 스키마 레지스트리 + API 게이트웨이**를 통합한 의미 계층이다.
- 데이터가 바뀌어도 온톨로지 모델이 유지되면 앱·AI 에이전트는 재작성 없이 동작한다.
- Marketplace를 통해 사전 정의된 Industry 온톨로지 모델(물류, 국방, 금융 등)을 가져올 수 있다.
