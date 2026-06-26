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
# 예시
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
- `valid_to`가 지나면 그래프에서 만료 상태로 마킹됨

```yaml
# 예시: GCP IAM 실천 가이드 (2026-06 기준 작성)
valid_from : 2026-06-20

# 예시: 한시적 ADR (계약 만료 예정)
valid_from : 2026-01-01
valid_to   : 2026-12-31

# 예시: 미팅 결과 문서 (특정 시점 스냅샷)
valid_from : 2025-06-25
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

`/ontology act` 명령에서 이 문서에 적용 가능한 액션을 제한하거나 확장한다.
없으면 `ontology-schema.json`의 타입별 기본값이 사용된다.

```yaml
actions : [challenge, resolve, review]
```

**타입별 기본값:**

| 타입 | 기본 actions |
|------|-------------|
| concept (wiki) | extend, implement, challenge, deepen |
| insight | challenge, ground, extend |
| problem | resolve, motivate, reference |
| tool | implement, reference, review |
| event | extract, reflect, reference |
| adr | motivate, implement, review, supersede |

**오버라이드가 필요한 경우:**

```yaml
# ADR 가이드 문서 — supersede/implement는 의미 없음
actions : [motivate, review]

# proposed 상태 ADR — resolve 액션 명시적 추가
actions : [challenge, resolve, review, supersede]
```

**기본값으로 충분하면 생략한다.**

---

# /ontology 사용 가이드

Claude Code에서 `/ontology` 스킬로 지식 그래프를 탐색하고 문서를 작성하는 실용 가이드.

---

## 시작 전 체크리스트

```bash
make qdrant-up            # Qdrant 컨테이너 시작 (Docker 필요)
make local-embeddings     # 전체 문서 인덱싱 (최초 또는 문서 대량 추가 후)
make ontology             # 그래프 빌드 (문서 수정 후 항상)
```

MCP 연결 확인:
```
claude mcp list           # dgnppr-ontology 항목이 있어야 함
```

---

## 엔티티 ID 형식

모든 탐색·액션 명령은 엔티티 ID를 기준으로 동작한다.

```
{entity_type}/{카테고리}/{파일명(확장자 제외)}

concept/data-engineering/00_what_is_medallion_architecture
insight/essay/00_is_lombok
problem/infra/00_gcp_key_leak
tool/observability/00_opentelemetry
event/retrospect/2024-q4-incident
adr/security/2026-001-use-workload-identity
```

ID를 모를 때: `/ontology entities` 또는 `/ontology find <키워드>`

---

## 명령 레퍼런스

### 문서 탐색

```
/ontology doc list                      # 전체 문서 목록
/ontology doc list insight              # insight 타입만
/ontology doc search "JVM GC"           # 키워드 검색 (제목+본문 BM25)
/ontology doc search "캐시" wiki        # 타입 제한 키워드 검색
/ontology doc find "분산 트랜잭션"       # 임베딩 유사도 — 목록 반환
/ontology doc find "레디스" adr         # 타입 제한 유사도 검색
/ontology doc query "JVM 힙 튜닝 방법"  # 유사 문서 본문 읽고 답변
/ontology doc read wiki data-engineering/00_what_is_medallion.md
```

### 그래프 탐색

```
/ontology related "분산 트랜잭션"                        # hybrid (기본)
/ontology related id:concept/java/00_virtual_thread      # 그래프+임베딩 hybrid
/ontology related id:concept/X mode:graph                # 순수 온톨로지 워크만
/ontology related id:concept/X mode:semantic             # Qdrant 유사도만
/ontology neighborhood concept/java/00_virtual_thread    # N-hop 그래프 워크 (메타)
/ontology neighborhood concept/X content                 # 이웃 노드 본문 포함
/ontology find "메시지 큐"
/ontology get concept/data-engineering/00_what_is_medallion_architecture
/ontology entities                      # 전체 엔티티 목록
/ontology entities problem              # problem 타입 목록
/ontology entities "GCP 인증"           # 시맨틱 검색
/ontology decision "메시지 큐 선택"     # 유사 ADR 소환
/ontology decision adr/arch/2024-001-use-kafka
```

### 문서 작성

```
/ontology doc write concept database/01_mysql_index.md
/ontology doc write insight essay/05_why_explicit_over_implicit.md
/ontology doc write adr security/2026-002-rotate-service-account.md
```

---

## 시나리오별 사용법

### 1. 새 개념 문서 쓰기 전 — 이미 있는지 확인

```
/ontology doc find "멱등성 설계"
/ontology doc search "idempotent"
```

겹치는 게 없으면 작성:
```
/ontology doc write concept distributed-system/03_idempotency.md
```

작성 후 그래프 갱신:
```bash
make ontology
make local-embeddings   # Qdrant 갱신도 필요하면
```

---

### 2. 특정 개념 주변 지식 읽기

```
/ontology get concept/data-engineering/00_what_is_medallion_architecture
```

→ 본문 + 연결된 모든 relation 반환

**그래프 워크로 이웃 탐색** (선언된 관계 + 이행 추론):
```
/ontology neighborhood concept/data-engineering/00_what_is_medallion_architecture
```

→ 직접 이웃 / 2-hop / 추론 엣지 구분해서 반환. `has_inferred: true`인 노드는 이행 규칙으로 연결된 것.

서브그래프 전체 읽기 (내용 포함):
```
/ontology neighborhood concept/X content
```

→ 이웃 노드 본문까지 반환. 주제 클러스터 전체를 한 번에 읽을 때 사용.

**하이브리드 탐색** (그래프 + 임베딩):
```
/ontology related id:concept/data-engineering/00_what_is_medallion_architecture
```

→ `layer: "graph"` = 내가 선언한 관계, `layer: "semantic"` = 아직 연결 안 한 잠재 연결
→ `"semantic"` 항목은 `ontology_act`로 그래프에 편입할 후보

---

### 3. ADR 작성 전 — 과거 결정 소환

```
/ontology decision "서비스 계정 인증 방식"
```

→ 가장 유사한 ADR 본문 + 그래프 관계 + 유사 과거 결정 목록 반환

내용 확인 후 새 ADR 작성:
```
/ontology doc write adr security/2026-002-use-workload-identity.md
```

---

### 4. 액션 플라이휠 — gap 찾고 채우기

**Step 1: gap 탐색**

```
/ontology gaps              # 전체 (critical → high → medium → low)
/ontology gaps adr          # ADR gap만
/ontology gaps insight      # insight gap만
```

gap 종류:
- `critical` — referenced-but-missing: 참조하는 문서가 아직 없음
- `high` — orphan: 관계 없는 고립 노드
- `medium` — motivate/ground/resolve: 타입별 빠진 연결
- `low` — extract/review: 미추출 insight, 오래된 ADR

**Step 2: blueprint 생성**

gap 결과에서 `action`과 `node.id` 확인 후:

```
/ontology act adr/security/2026-001-gcp-key motivate
```

→ 반환값:
```json
{
  "action": "motivate",
  "creates": "problem",
  "doc_write_args": {
    "type": "problem",
    "path": "security/00_motivate_2026-001-gcp-key.md",
    "title": "[motivate] GCP Key Leak ADR",
    "relations": [{ "type": "motivates", "target": "adr/security/2026-001-gcp-key" }]
  }
}
```

**Step 3: 작성**

```
/ontology doc write problem security/00_gcp_key_exposure_risk.md
```

`doc_write_args`의 내용을 그대로 쓰되 `body`를 채운다. `relations`는 자동으로 frontmatter에 포함.

**Step 4: 그래프 갱신**

```bash
make ontology
```

→ 새 노드 + 엣지가 그래프에 추가됨. 다시 `/ontology gaps`로 순환.

---

### 5. insight에 출처 달기 (ground)

insight가 어디서 나온 건지 출처 event가 없는 경우:

```
/ontology gaps insight
# → ground gap 발견

/ontology act insight/essay/00_is_lombok ground
# → event blueprint 반환

/ontology doc write event retrospect/2024-q2-lombok-incident.md
# → 작성 완료 후:
make ontology
# → insight 문서에 learned-from 관계 수동 추가 필요 (ground는 방향 역전)
```

---

## 액션 타입 빠른 참조

| action | 언제 | 결과 |
|--------|------|------|
| `extend` | 이 개념을 더 깊게 | 새 concept |
| `implement` | 이걸 실제로 어떻게 | 새 adr |
| `challenge` | 이 주장에 반박 | 새 insight |
| `deepen` | 하위 개념 추가 | 새 concept |
| `ground` | 이 insight의 출처 | 새 event |
| `motivate` | 이 ADR의 동기 | 새 problem |
| `resolve` | 이 problem의 해결 | 새 adr |
| `extract` | 이 event에서 배운 것 | 새 insight |
| `review` | 오래된 ADR 재검토 | 새 adr |
| `supersede` | 이 ADR 대체 | 새 adr |

---

## 자주 쓰는 패턴

```
# 아침 루틴 — 그래프 상태 파악
/ontology gaps

# 글 쓰기 전 — 중복 확인 + 연관 맥락 수집
/ontology doc find "<주제>"
/ontology related "<주제>"

# ADR 작성 전 — 과거 결정 확인
/ontology decision "<주제>"

# 작성 후 — 항상
make ontology

# 주기적 — 전체 재인덱싱
make local-embeddings
```
