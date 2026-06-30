---
name: ontology
description: "DRAGONAPPEAR 위키·ADR·온톨로지 그래프를 통합 관리한다. /ontology 로 호출. 모든 엔티티 타입(concept/insight/problem/tool/event/adr) 조회·작성, 시맨틱 탐색, 관계 그래프, 의사결정 컨텍스트 소환을 지원한다."
argument-hint: "related|find|get|entities|decision <args> | doc list|search|find|query|read|write [type] <args>"
allowed-tools: mcp__dgnppr-ontology__*, Bash
---

# Ontology Skill

`dgnppr-ontology` MCP를 통해 모든 엔티티 타입의 문서 관리 및 온톨로지 그래프 탐색을 통합 제공한다.

## 엔티티 타입

| type | 디렉토리 | 설명 |
|------|---------|------|
| `concept` | `_concept/` | 기술 개념·위키 |
| `insight` | `_insight/` | 인사이트·분석 |
| `problem` | `_problem/` | 문제 정의·해결 |
| `tool` | `_tool/` | 도구·라이브러리 |
| `event` | `_event/` | 이벤트·회고 |
| `adr` | `_adr/` | Architecture Decision Records |

## MCP 연결 확인

**먼저 `mcp__dgnppr-ontology__*` 도구가 이 세션에 등록돼 있는지 확인한다.** 없으면 아래를 안내한다:

```
dgnppr-ontology MCP 서버가 연결되지 않았습니다.
새 Claude Code 세션을 열고, 승인 프롬프트에서 Y를 누르세요.
확인: claude mcp list
```

## 명령 라우팅

`$ARGUMENTS`에 따라 아래 도구를 호출한다:

### 문서 관리 (`doc *`)

| 입력 | 도구 | 설명 |
|------|------|------|
| `doc list [type]` | `doc_list` | 전체 또는 타입별 문서 목록 |
| `doc search <query> [type]` | `doc_search` | 키워드 검색 (BM25, 제목+본문) |
| `doc find <query> [type]` | `doc_find` | 임베딩 유사도 검색 — 목록 반환 |
| `doc query <query> [type]` | `doc_query` | 임베딩 검색 후 본문 반환 (질문 응답용) |
| `doc read <type> <path>` | `doc_read` | 특정 문서 읽기 |
| `doc write <type> <path>` | `doc_write` | 문서 작성/수정 |

type 생략 시 모든 엔티티 타입을 대상으로 동작한다.

### 온톨로지 그래프

| 입력 | 도구 | 설명 |
|------|------|------|
| `related <query>` | `ontology_related(query: ...)` | 텍스트 기준 related 탐색 |
| `related id:<id>` | `ontology_related(id: ...)` | 엔티티 기준 related 탐색 |
| `find <query>` | `ontology_find(query: ...)` | 임베딩 유사도 검색 (flat 리스트) |
| `get <id>` | `ontology_get(id: ...)` | 노드 메타 + 전체 본문 |
| `entities [type]` | `ontology_entities(type: ...)` | 엔티티 목록 |
| `entities <query>` | `ontology_entities(query: ...)` | 시맨틱 검색으로 엔티티 탐색 |
| `decision <id>` | `ontology_decision_context(id: ...)` | 과거 유사 결정 소환 (id) |
| `decision <query>` | `ontology_decision_context(query: ...)` | 텍스트로 ADR 찾아 컨텍스트 소환 |
| `gaps [type]` | `ontology_gaps(type: ...)` | 그래프 gap 분석 — 고립 노드·미작성 참조·액션 기회 |
| `act <id> <action>` | `ontology_act(id: ..., action: ...)` | gap을 메우는 문서 blueprint 생성 |
| `neighborhood <id>` | `ontology_neighborhood(id: ...)` | N-hop 그래프 워크 — 이웃 노드 + 추론 엣지 |
| `neighborhood <id> content` | `ontology_neighborhood(id: ..., include_content: true)` | 이웃 노드 전체 본문 포함 |
| `debt` | `ontology_debt()` | 지식 부채 — 미작성 참조 개념·만료 문서·미커버 태그·콘텐츠 언급 미작성 |
| `landscape` | `ontology_landscape()` | 지식 지형도 — 카테고리별 밀도·강점·취약 클러스터 |
| `contradictions` | `ontology_contradictions()` | 모순 탐지 — confidence 충돌·만료 참조·좀비 ADR |
| `next` | `ontology_next()` | learning_pressure top N — 지금 공부할 것 |
| `questions id:<id>` | `questions(id: ...)` | 소크라테스 엔진 — 문서 본문 기반 미답변 질문 생성 + data/questions.json 저장 (LLM) |
| `answered id:<id>` | `answered(id: ...)` | 질문 완료 처리 (전체) — unanswered_bonus 감소 |
| `answered id:<id> index:<n>` | `answered(id: ..., index: n)` | n번째 질문만 완료 처리 |
| `studied id:<id>` | `studied(id: ...)` | 오늘 학습 기록 추가 → study_decay 반영 |
| `discover` | `discover()` | 글 전체 LLM 분석 — 부족한 개념 + 써야 할 문서 추천 |
| `blindspot` | `blindspot()` | 내 지식 맹점 분석 — 아직 다루지 않은 인접 영역 5개 추천 (LLM) |
| `blindspot query:<q>` | `blindspot(query: ...)` | 특정 주제 주변의 맹점만 탐색 (LLM) |
| `eval id:<id>` | `ontology_eval(id: ...)` | 문서 이해 깊이 LLM 평가 → depth-cache.json 저장 → learning_pressure 반영 |
| `eval id:<id> force:true` | `ontology_eval(id: ..., force: true)` | 캐시 무시하고 재평가 |
| 인자 없음 | `ontology_entities()` | 전체 엔티티 목록 |

## 동작 방식

### doc write
`$ARGUMENTS`에서 타입과 경로를 추출한다. 없으면 사용자에게 묻는다.

**제목 규칙:** 단문 명사구 또는 질문형(예: "이벤트 트래킹 설계", "왜 레디스를 싱글 스레드로 만들었을까"). 부제·구분자 금지 — em dash(`—`) 금지, 콜론(`:`)은 **무인용 YAML frontmatter `title` 파싱을 깨뜨려 빌드 에러를 내므로 절대 금지**. 제목 하나로 끝낸다.

**concept/insight/problem/tool/event** frontmatter 자동 조립:
```yaml
layout      : <type>
title       : <제목>
date        : <오늘날짜> 00:00:00 +0900  # 기존 파일이면 보존
updated     : <오늘날짜> 00:00:00 +0900
tag         : <태그>
toc         : true
comment     : true
latex       : true
status      : draft                       # draft | writing | complete
public      : true
parent      : [[/<카테고리>]]             # 경로에 카테고리 있을 때만
confidence  : medium                      # high | medium | low (insight 필수, 전 타입 권장)
valid_from  : <YYYY-MM-DD>               # 버전·시점 의존 문서에 사용 (선택)
valid_to    : <YYYY-MM-DD>               # 만료 예정 문서에 사용 (선택)
actions     : [...]                       # 허용 액션 오버라이드 (선택, 없으면 타입 기본값)
relations:                                # 그래프 엣지 (선택)
  - { type: <관계타입>, target: <엔티티ID> }
```

**adr** frontmatter 자동 조립:
```yaml
layout     : adr
title      : <제목>
date       : <오늘날짜> 00:00:00 +0900  # 기존 파일이면 보존
updated    : <오늘날짜> 00:00:00 +0900
tag        : <태그>
status     : proposed                    # proposed | accepted | deprecated | superseded
deciders   : <결정자>
public     : false
valid_from : <YYYY-MM-DD>              # 결정 적용일 (선택)
valid_to   : <YYYY-MM-DD>              # 결정 만료 예정일 (선택)
supersedes : <엔티티ID>                # 대체하는 이전 ADR (선택)
actions    : [...]                      # 허용 액션 오버라이드 (선택)
relations:                              # 그래프 엣지 (선택)
  - { type: <관계타입>, target: <엔티티ID> }
```

**confidence 기준:**
- `high`: 공식 스펙, 검증된 구현, 재현 가능한 측정 기반
- `medium`: 경험적 관찰, 합리적 추론 (반례 가능성 있음) — insight 기본값
- `low`: 가설, 직관, 미검증 아이디어

기존 파일 수정 시 `doc_read`로 먼저 읽은 뒤 `updated`만 갱신하고 저장한다.

경로 규칙:
- concept/insight/problem/tool/event: `<카테고리>/<NN_slug>.md`
- adr: `YYYY-NNN-<slug>.md` (예: `2024-001-use-kafka.md`)

### doc find / doc query
모두 Qdrant 사용 (로컬 전용, `make qdrant-up` 필요):
- **concept/insight/problem/tool/event** → `wiki` 컬렉션 (entity_type 필터 적용)
- **adr** → `adr` 컬렉션
- **type 생략 (all)** → 양쪽 동시 검색, 유사도 통합 정렬

### related
`ontology_related`는 **하이브리드 탐색** — 그래프 1순위, 임베딩으로 미연결 보완:

| mode | 동작 |
|------|------|
| `hybrid` (기본) | 그래프 워크 우선 + Qdrant로 미연결 발견 |
| `graph` | 순수 온톨로지 워크만 (Qdrant 없음) |
| `semantic` | Qdrant 유사도만 (그래프 없음) |

결과에 `layer` 필드 포함: `"both"` | `"graph"` | `"semantic"`
- `"graph"` = 내가 선언한 관계
- `"semantic"` = 아직 연결 안 한 잠재 연결 → `ontology_act`로 편입 가능

```
/ontology related id:concept/X              # hybrid (기본)
/ontology related id:concept/X mode:graph   # 온톨로지만
```

### neighborhood
순수 그래프 워크. 선언된 엣지 + 이행 추론 엣지(extends→extends 등) 포함.
`include_content`로 이웃 노드 본문까지 읽기 가능 (서브그래프 전체 읽기).

```
/ontology neighborhood concept/X            # 메타만
/ontology neighborhood concept/X content    # 본문 포함
```

### decision
새 ADR 작성 전에 `decision <query>`로 유사 과거 결정을 먼저 소환한다.

## 엔티티 ID 형식

```
{type}/{디렉토리}/{파일명}

예시:
  concept/data-engineering/00_what_is_medallion_architecture
  insight/essay/00_is_lombok
  adr/architecture/2024-001-test-adr
```

ID를 모를 때는 `entities` 또는 `find`로 먼저 조회한다.

## 액션 플라이휠

그래프를 분석해 행동하고, 그 결과를 다시 그래프로 자산화하는 사이클:

```
ontology_gaps → 무엇이 빠졌나
ontology_act  → blueprint 생성 (doc_write_args 포함)
doc_write     → 문서 작성
make ontology → 그래프 갱신
→ 반복
```

### 액션 타입

| action | 적용 타입 | 결과물 | 관계 | gap 조건 |
|--------|---------|--------|------|---------|
| `extend` | concept·tool·insight | concept | extends | outbound extends 없음 |
| `implement` | concept·adr | adr | implements | implements 엣지 없음 |
| `challenge` | insight·concept | insight | contradicts | contradicts 엣지 없음 |
| `deepen` | concept | concept | part-of | part-of inbound 없음 |
| `ground` | insight | event | learned-from | 출처 event 없음 |
| `motivate` | adr | problem | motivates | motivates inbound 없음 |
| `resolve` | problem | adr | motivates | 해결 결정 없음 |
| `extract` | event·problem | insight | learned-from | insight 미추출 |
| `review` | adr | adr | supersedes | 작성 후 2년 이상 |
| `supersede` | adr | adr | supersedes | deprecated 상태 |

### 예시 흐름

```
/ontology gaps adr               # ADR에 동기 없는 것 탐색
/ontology act adr/X motivate     # problem blueprint 생성
/ontology doc write problem ...  # blueprint의 doc_write_args 전달
make ontology                    # 그래프에 새 노드+엣지 추가
```

### frontmatter actions 오버라이드

문서별로 허용 액션을 제한할 수 있다 (entity type default_actions 덮어씀):
```yaml
actions:
  - extend
  - challenge
```

## 그래프 갱신

문서 추가/수정 후:
```bash
make ontology   # data/ontology-graph.json 재생성
```

## Relation Types

`doc write` 시 frontmatter에 relations를 명시하면 그래프 엣지로 연결된다:

| type | 의미 |
|------|------|
| `implements` | 해당 concept/adr을 구현함 |
| `references` | 해당 문서를 참조함 |
| `extends` | 해당 concept을 확장함 |
| `supersedes` | 해당 ADR을 대체함 |
| `motivates` | 해당 problem이 이 결정을 유발함 |
| `contradicts` | 해당 문서와 충돌함 |
| `involves` | 해당 엔티티를 포함함 |
| `caused-by` | 해당 event/problem에 의해 발생함 |
| `learned-from` | 해당 event/problem에서 학습함 |
| `part-of` | 해당 concept의 구성 요소임 |
| `used-in` | 해당 프로젝트/concept에 사용됨 |

```yaml
relations:
  - type: implements
    target: concept/data-engineering/00_what_is_medallion_architecture
  - type: learned-from
    target: event/2024-incident-data-loss
  - type: supersedes
    target: adr/2023-001-old-decision
```
