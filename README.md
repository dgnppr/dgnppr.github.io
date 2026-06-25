# DRAGONAPPEAR 기술 블로그 + 개인 지식 온톨로지

Jekyll 기반 기술 블로그이자 개인 지식 베이스. 단순 위키를 넘어 엔티티 타입·관계 그래프·벡터 검색이 결합된 온톨로지 구조로 운영된다.

---

## 레포지토리 구조

```
dgnppr.github.io/
│
├── 콘텐츠 디렉토리 (엔티티 타입별)
│   ├── _wiki/          → concept    기술 개념 위키
│   ├── _insight/       → insight    경험에서 추출한 단일 명제
│   ├── _problem/       → problem    만난 문제 / 근본 원인 / 영향
│   ├── _tool/          → tool       도구·라이브러리 평가
│   ├── _event/         → event      회고·사건·마일스톤
│   ├── _adr/           → adr        Architecture Decision Records
│   └── _posts/                      공개 블로그 포스트
│
├── data/
│   ├── ontology-schema.json     엔티티 타입 + relation 타입 정의 (SSOT)
│   ├── ontology-graph.json      빌드 결과물 — 노드 + 엣지
│   ├── embeddings.json          GitHub Pages용 파일 기반 임베딩 캐시
│   └── related.json             브라우저 사이드 연관 문서
│
├── scripts/
│   ├── generate-ontology.js         문서 → 그래프 빌드
│   ├── generate-local-embeddings.js 전체 문서 → Qdrant (로컬 전용)
│   ├── generate-embeddings.js       wiki → embeddings.json (GitHub Pages)
│   ├── generate-summaries.js        AI 요약 생성
│   └── generate-diagrams.js         AI 다이어그램 생성
│
└── mcp/
    └── ontology-server.js       통합 MCP 서버 (doc_* 6개 + ontology_* 5개)
```

---

## 온톨로지 구조

### 엔티티 타입

`data/ontology-schema.json`이 SSOT. 6가지 엔티티 타입으로 지식을 분류한다.

| type | 디렉토리 | layout | 설명 |
|------|---------|--------|------|
| `concept` | `_wiki/` | `wiki` | 기술 개념·지식 — 가장 기본 단위 |
| `insight` | `_insight/` | `insight` | 경험에서 추출한 단일 명제. 반박 가능한 형태로 작성 |
| `problem` | `_problem/` | `problem` | 만난 문제 — 근본 원인·컨텍스트·영향 기록 |
| `tool` | `_tool/` | `tool` | 도구·라이브러리 — 사용 경험·평가·트레이드오프 |
| `event` | `_event/` | `event` | 회고·사건·마일스톤 — 시간 맥락이 있는 기록 |
| `adr` | `_adr/` | `adr` | Architecture Decision Records — `public: false` |

### Relation 타입

문서 frontmatter의 `relations` 필드로 엔티티 간 방향 그래프를 구성한다.

| type | 의미 | 주로 쓰는 방향 |
|------|------|--------------|
| `extends` | 개념을 확장·심화함 | concept → concept |
| `references` | 참조·인용함 | 어디서든 |
| `implements` | 구현·실현함 | tool/adr → concept |
| `supersedes` | 이전 결정을 대체함 | adr → adr |
| `motivates` | 이 문제가 결정을 유발함 | problem → adr |
| `caused-by` | 이 사건이 원인에 의해 발생 | event/problem → problem/tool |
| `learned-from` | 이 사건에서 이 insight를 배움 | insight → event/problem |
| `contradicts` | 충돌·모순됨 | — |
| `involves` | 이 엔티티를 포함함 | — |
| `part-of` | 상위 concept의 구성 요소임 | — |
| `used-in` | 이 tool/concept이 사용됨 | tool → concept |

### 문서 frontmatter

**concept / insight / problem / tool / event 공통:**

```yaml
---
layout  : wiki          # 각 타입명으로 변경 (insight, problem, tool, event)
title   : 제목
date    : 2026-01-01 00:00:00 +0900
updated : 2026-01-01 00:00:00 +0900
tag     : tag1 tag2
toc     : true
comment : true
status  : draft         # draft | writing | complete
public  : true
parent  : [[/category]]
relations:
  - { type: extends,      target: concept/data-architect/00_medallion }
  - { type: learned-from, target: event/retrospect/03_2024_march }
---
```

**adr:**

```yaml
---
layout    : adr
title     : 제목
date      : 2026-01-01 00:00:00 +0900
updated   : 2026-01-01 00:00:00 +0900
tag       : tag1 tag2
status    : proposed    # proposed | accepted | deprecated | superseded
deciders  : dragonappear
public    : false
relations:
  - { type: supersedes, target: adr/2023-001-old-decision }
  - { type: motivates,  target: problem/infra/00_gcp_key_leak }
---
```

**`relations.target` 형식:** `{entity_type}/{dir}/{filename}` (확장자 제외)
- `concept/data-architect/00_what_is_medallion`
- `insight/essay/01_why_redis_single_threaded`
- `adr/security/2026-001-use-workload-identity`

> **참고:** 기존 문서에서 `/wiki/foo/bar` 형식으로 작성된 target은 `generate-ontology.js`가 자동으로 `concept/foo/bar`로 정규화한다.

---

## 빌드 파이프라인

### 데이터 생성 흐름

```
문서 작성 (frontmatter relations 포함)
    │
    ├─ make ontology           → data/ontology-graph.json
    │                            (노드: entity, 엣지: relation)
    │
    ├─ make local-embeddings   → Qdrant (로컬, MCP 전용)
    │   ├─ wiki  컬렉션: concept/insight/problem/tool/event
    │   └─ adr   컬렉션: adr
    │
    └─ make embeddings         → data/embeddings.json + data/related.json
                                 (GitHub Pages 브라우저 사이드)
```

### Makefile 주요 명령

```bash
# 서버
make start                # 포그라운드 (data + ontology 자동 빌드)
make back                 # 백그라운드
make stop / restart

# 데이터 생성
make ontology             # 그래프 재생성 (문서 수정 후 항상 실행)
make local-embeddings     # 전체 → Qdrant 인덱싱 (로컬)
make local-embeddings-force  # 강제 재인덱싱
make embeddings           # GitHub Pages용
make summaries            # AI 요약
make diagrams             # AI 다이어그램

# Qdrant
make qdrant-up            # Qdrant 컨테이너 시작
make qdrant-down
make qdrant-status

# MCP
make mcp-start            # 포그라운드 테스트
make mcp-back / mcp-stop / mcp-restart
make mcp-test             # 서버 동작 확인
```

### 로컬 실행 사전 조건

```bash
make qdrant-up            # Qdrant 시작 (Docker 필요)
make local-embeddings     # 전체 문서 인덱싱 (최초 1회, 이후 변경분만)
make ontology             # 그래프 빌드
```

---

## MCP 서버 (`dgnppr-ontology`)

Claude Code에 `~/.claude.json`으로 등록된 단일 MCP 서버. 11개 도구 제공.

### `doc_*` — 문서 CRUD (파일시스템 직접)

| 도구 | 설명 |
|------|------|
| `doc_list [type]` | 전체 또는 타입별 문서 목록 |
| `doc_read type path` | 특정 문서 읽기 |
| `doc_search query [type]` | 키워드 검색 (제목+본문 BM25) |
| `doc_find query [type]` | 임베딩 유사도 검색 → 목록 반환 |
| `doc_query query [type]` | 임베딩 검색 → 본문 반환 (RAG용) |
| `doc_write type path ...` | 문서 작성·수정 (frontmatter 자동 조립) |

`type` 생략 시 전체 엔티티 타입 대상. `doc_find`/`doc_query`는 Qdrant 사용.

### `ontology_*` — 그래프 탐색 (Qdrant + 그래프)

| 도구 | 설명 |
|------|------|
| `ontology_entities [type\|query]` | 엔티티 목록 또는 시맨틱 검색 |
| `ontology_get id` | 노드 메타 + 전체 본문 + 관계 |
| `ontology_related query\|id` | 전체 타입 탐색 → entity_type별 그룹핑 반환 |
| `ontology_find query [type]` | Qdrant 유사도 flat 리스트 |
| `ontology_decision_context id\|query` | ADR 전체 컨텍스트 (과거 유사 결정 포함) |

`ontology_related` re-rank: `semantic×0.52 + idf_tag×0.18 + typed_edge(~0.18) + 2hop(~0.08) + type_affinity(~0.05) + recency(~0.03)`

### `/ontology` 스킬 사용 예시

```
# 문서 작성
/ontology doc write insight essay/05_new_finding.md

# 탐색
/ontology doc list insight
/ontology doc search "JVM GC" wiki
/ontology doc find "캐시 무효화 전략"       # 유사 문서 목록
/ontology doc query "레디스 스레드 모델"    # 본문 읽고 답변

# 그래프 탐색
/ontology related "분산 트랜잭션"           # 전체 타입 관련 문서
/ontology related id:concept/java/00_virtual_thread
/ontology get adr/security/2026-001-gcp-key
/ontology entities problem                  # problem 타입 전체 목록
/ontology decision "메시지 큐 선택"         # 새 ADR 작성 전 과거 결정 소환
```

---

## 액션 시스템 — 그래프 → 행동 → 그래프

지식 그래프를 단순 조회가 아니라 **다음 행동의 출발점**으로 쓰는 구조.

### 플라이휠

```
ontology_gaps   → gap 발견 (고립·미작성·동기 없는 ADR 등)
ontology_act    → blueprint 생성 (doc_write에 바로 전달 가능한 인자 포함)
doc_write       → 문서 작성 (relations 자동 포함)
make ontology   → 그래프에 새 노드+엣지 추가
→ 반복
```

### 액션 타입 (ontology-schema.json SSOT)

| action | 적용 타입 | 결과물 | 연결 relation | gap 조건 |
|--------|---------|--------|-------------|---------|
| `extend` | concept·tool·insight | concept | extends | outbound extends 없음 |
| `implement` | concept·adr | adr | implements | implements 엣지 없음 |
| `challenge` | insight·concept | insight | contradicts | contradicts 없음 |
| `deepen` | concept | concept | part-of | part-of inbound 없음 |
| `ground` | insight | event | learned-from | 출처 event 없음 |
| `motivate` | adr | problem | motivates | motivates inbound 없음 |
| `resolve` | problem | adr | motivates | 해결 결정 없음 |
| `extract` | event·problem | insight | learned-from | insight 미추출 |
| `review` | adr | adr | supersedes | 2년 이상 경과 |
| `supersede` | adr | adr | supersedes | deprecated 상태 |

### 사용 예

```
# gap 탐색
/ontology gaps              # 전체
/ontology gaps adr          # ADR만

# blueprint 생성 → 작성
/ontology act adr/security/2026-001-gcp-key motivate
→ doc_write_args 반환 → body 채워 doc_write 호출

# 그래프 갱신
make ontology
make local-embeddings
```

### frontmatter actions 오버라이드

entity type의 `default_actions`를 문서별로 제한:
```yaml
actions:
  - extend
  - challenge
```

---

## 로컬 개발 환경 설정

### 의존성

- Ruby (mise로 관리)
- Node.js
- Docker (Qdrant용)
- Ollama (`bge-m3` 모델, 로컬 임베딩용)

### 초기 설정

```bash
make install              # bundle install
npm install               # Node 의존성
make qdrant-up            # Qdrant 시작
make local-embeddings     # Qdrant 인덱싱
make ontology             # 그래프 빌드
make start                # 서버 시작 (http://localhost:4000)
```

### `.env` 설정 (Vertex AI 임베딩 사용 시)

```env
GOOGLE_APPLICATION_CREDENTIALS=resource/credentials/credentials.json
GOOGLE_PROJECT_ID=your-project-id
GOOGLE_LOCATION=asia-northeast3
EMBEDDING_BACKEND=vertexai   # 또는 ollama
QDRANT_URL=http://localhost:6333
OLLAMA_URL=http://localhost:11434
```

---

## 문서 작성 가이드

### 새 문서 작성 (MCP 사용)

```
/ontology doc write concept database/01_mysql_index_deep_dive.md
```

MCP 서버가 frontmatter를 자동 조립하고 올바른 디렉토리에 저장.

### 직접 작성

1. 해당 타입 디렉토리에 `.md` 파일 생성
2. frontmatter 작성 (위 템플릿 참고)
3. `relations` 필드로 연관 문서 연결
4. `make ontology` 실행 — 그래프 갱신
5. 로컬 임베딩 갱신이 필요하면 `make local-embeddings`

### 파일명 규칙

- concept/insight/problem/tool/event: `<카테고리>/<NN_slug>.md`
  - 예: `data-architect/05_how_to_implement_ontology.md`
- adr: `YYYY-NNN-<slug>.md`
  - 예: `security/2026-001-use-workload-identity.md`
