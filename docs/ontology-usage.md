# Frontmatter 온톨로지 필드 레퍼런스

문서 frontmatter에 추가하는 온톨로지 관련 필드들이다.
`node scripts/generate-ontology.js` 실행 시 그래프 노드·엣지로 변환된다.

---

## 필드 한눈에 보기

| 필드 | 적용 타입 | 값 | 효과 |
|------|-----------|-----|------|
| `relations` | 모든 타입 | 아래 참고 | 그래프 엣지 생성 |
| `confidence` | 모든 타입 (insight 필수) | `high` \| `medium` \| `low` | 검색 재순위화 신호 |
| `valid_from` | 모든 타입 | `YYYY-MM-DD` | 시점 컨텍스트 |
| `valid_to` | 모든 타입 | `YYYY-MM-DD` | 만료 마킹 |
| `supersedes` | adr | 엔티티 ID | 대체 엣지 자동 생성 |
| `actions` | 모든 타입 | 액션 배열 | 타입 기본값 오버라이드 |

---

## `relations` — 명시적 관계 선언

그래프 엣지를 직접 선언한다. 타입, 방향, 대상을 명시한다.

```yaml
relations:
  - { type: <관계타입>, target: <대상 경로 또는 엔티티 ID> }
```

### 관계 타입

| type | 의미 | 주 사용처 |
|------|------|-----------|
| `extends` | 이 문서가 대상을 확장·심화함 | concept → concept |
| `implements` | 이 문서가 대상 개념을 실제 적용함 | adr/tool → concept |
| `references` | 이 문서가 대상을 참조·인용함 | 모든 타입 |
| `supersedes` | 이 문서가 대상을 대체함 | adr → adr |
| `motivated_by` | 이 결정/인사이트의 동기가 대상임 | adr/insight → problem |
| `resolves` | 이 문서가 대상 문제를 해결함 | adr/insight → problem |
| `learned_from` | 이 인사이트가 대상 이벤트에서 도출됨 | insight → event |
| `applied_to` | 이 개념·도구가 대상에 적용됨 | tool/concept → adr |
| `related` | 방향 없는 느슨한 연관 | 모든 타입 |

### target 값 형식

```yaml
# 엔티티 ID — 타입/카테고리/파일명
concept/data-architect/00_what_is_medaliion_architecture
insight/essay/01_why_redis_single_threaded
adr/security/2026-06-24-002-gcp-key-management-status

# URL 경로 — generate-ontology.js가 내부적으로 ID로 정규화
/wiki/cloud/01_how_to_operate_iam_well
/insight/essay/00_is_lombok_necessary
```

### 예시

```yaml
# _wiki/data-architect/05_how_to_implement_ontology.md
relations:
  - { type: extends, target: concept/data-architect/04_what_is_ontology }
  - { type: references, target: concept/data-architect/06_ontology_core_concepts }

# _adr/security/2026-06-24-002-gcp-key-management-status.md
relations:
  - { type: references, target: concept/cloud/01_how_to_operate_iam_well }
  - { type: motivated_by, target: problem/security/00_gcp_key_exposure }

# _insight/essay/01_why_redis_single_threaded.md
relations:
  - { type: references, target: concept/java/00_what_is_java_virtual_thread }
  - { type: learned_from, target: event/retrospect/00_2023_year_retrospect }
```

---

## `confidence` — 주장 신뢰도

이 문서의 내용에 대한 저자 확신 수준. **insight에 필수**, 다른 타입에도 권장.

```yaml
confidence: high   # high | medium | low
```

| 값 | 기준 | 예시 |
|----|------|------|
| `high` | 공식 스펙, 검증된 구현, 재현 가능한 측정 기반 | JEP, Hibernate 문서, GoF 패턴 |
| `medium` | 경험적 관찰, 합리적 추론 — 반례 가능성 있음 | GCP 운영 가이드, 툴 사용법, LLM 아키텍처 |
| `low` | 가설, 직관, 아직 검증 전 | 실험적 접근, 미검증 아이디어 |

```yaml
confidence  : high    # Java virtual thread — JEP 444 공식 스펙
confidence  : medium  # Medallion 적용 가이드 — 경험 기반
confidence  : low     # 새 데이터 파이프라인 설계 아이디어 — 검증 전
```

---

## `valid_from` / `valid_to` — 유효 기간

기술·정책이 버전에 민감하거나 시점 컨텍스트가 중요한 문서에 사용.
`date`(작성일)과 다르게, **내용이 유효한 실제 기간**을 나타낸다.

```yaml
valid_from : 2025-06-25   # YYYY-MM-DD
valid_to   : 2026-12-31   # 생략 시 현재까지 유효
```

- **모든 타입 적용 가능** — cloud, tool, adr 등 버전·시점 의존 문서에 적극 사용
- `valid_to`가 지나면 `ontology_debt` / `ontology_contradictions`에서 만료로 감지됨

```yaml
# GCP IAM 실천 가이드 (2026-06 기준 작성)
valid_from : 2026-06-20

# 한시적 ADR (계약 만료 예정)
valid_from : 2026-01-01
valid_to   : 2026-12-31
```

---

## `supersedes` — 대체 선언 (ADR 전용)

이 ADR이 이전 결정을 대체할 때 사용. `relations`에 `supersedes` 타입 없이도
이 필드 하나로 **자동으로 그래프 엣지가 생성**된다.

```yaml
supersedes : adr/architecture/2025-001-old-decision
```

`relations`의 `supersedes`와 병행 선언하면 중복 엣지 없이 처리된다.

---

## `actions` — 허용 액션 오버라이드

`ontology_gaps` 제안과 `ontology_act` 실행을 이 목록으로 제한한다.
없으면 `data/ontology-schema.json`의 타입별 기본값이 사용된다.

```yaml
actions : [challenge, ground]
```

**타입별 기본값 (`data/ontology-schema.json` 기준):**

| 타입 | 기본 actions |
|------|-------------|
| concept | extend, implement, challenge, deepen |
| insight | challenge, ground, extend |
| problem | motivate, resolve, extract |
| tool | implement, extend, compare |
| event | extract, retrospect |
| adr | motivate, implement, review, supersede |

```yaml
# 회고 문서 — insight 추출 안 할 것, retrospect만 허용
actions : [retrospect]

# ADR 가이드 문서 — supersede/implement는 의미 없음
actions : [motivate, review]
```

**기본값으로 충분하면 생략한다.**
