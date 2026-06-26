# DRAGONAPPEAR 지식 온톨로지

> **목표: 모르는 것을 찾아서 거기로 나를 이끌어라**

지식을 잘 정리하는 것만으로는 부족하다. 진짜 목적은 **내가 아직 모르는 것을 발견하고, 거기에 집중하도록 강제하는 것**이다.

이 시스템은 지식 그래프를 분석해 지금 당신이 가장 공부해야 할 개념을 계산하고, 소크라테스식 질문으로 이해의 빈 곳을 드러낸다.

---

## 핵심 개념: `learning_pressure`

```
learning_pressure = importance × (1 - depth)
```

| 변수 | 계산 방법 |
|------|---------|
| `importance` | inbound 참조 수 × 2 + (outbound 있으면 +1) |
| `depth` | confidence 40% + status 40% + 연결 밀도 20% |

**많은 곳에서 참조되지만 (`importance` 높음) 아직 제대로 이해하지 못한 개념 (`depth` 낮음)** 이 높은 `learning_pressure`를 가진다.

문서를 만들고 `make ontology`를 실행할 때마다 모든 노드의 `learning_pressure`가 재계산된다.

---

## 지식 성장 도구 (Knowledge Growth Engine)

### `ontology_next` — 지금 당장 공부해야 할 것

`learning_pressure` 기준으로 공부 우선순위 top N을 반환한다.

```
/ontology next          # top 5 (기본)
/ontology next limit:10
/ontology next type:concept
```

반환 항목: rank, 제목, learning_pressure 수치, **왜 지금 이걸 봐야 하는지**.

### `ontology_questions` — 소크라테스 엔진

문서 본문을 LLM이 읽고, **문서에 이미 답이 있는 질문은 제외**한 채 당신이 아직 답하지 못한 질문만 생성한다.

```
/ontology questions id:concept/java/00_what_is_java_virtual_thread
/ontology questions id:concept/X count:10
```

- 엣지 케이스, 실패 조건, 스케일 문제, 인접 개념과의 충돌을 파고드는 질문
- 각 질문에 "왜 이게 중요한가" 한 줄 부연
- `ANTHROPIC_API_KEY` 환경변수 필요

### `ontology_landscape` — 지식 지형도

내가 뭘 깊게 알고 뭐가 얕은지 전체 지형을 보여준다.

```
/ontology landscape
```

- 카테고리별 강점·취약 클러스터
- 고립 비율, 연결률
- `strength_score` 낮은 클러스터 = 지금 투자해야 할 영역

### `ontology_debt` — 지식 부채

여러 문서에서 언급하지만 실제로 작성하지 않은 개념을 탐지한다.

```
/ontology debt
/ontology debt min_refs:3   # 3회 이상 참조된 것만
```

- `missing_concept`: 엣지 target이지만 노드 없음 — 가장 긴급한 부채
- `expired`: `valid_to`가 지난 문서, 아직 참조 중이면 위험
- `uncovered_topic`: 고빈도 태그인데 전용 개념 문서 없음

### `ontology_contradictions` — 모순 탐지

그래프 내 충돌과 불일치를 찾는다.

```
/ontology contradictions
```

- `confidence_conflict`: 같은 카테고리·태그인데 confidence가 high vs low
- `stale_reference`: 만료된 문서를 여전히 참조 중
- `superseded_but_active`: 대체됐는데 아직 `accepted` 상태인 ADR

---

## 루틴 패턴

```
# 공부 시작 전 — 지금 뭘 봐야 하나
/ontology next

# 개념 이해 확인 — 내가 모르는 게 뭔가
/ontology questions id:<개념-id>

# 주기적 건강 점검
/ontology landscape
/ontology debt
/ontology contradictions

# 문서 작성 후 항상
make ontology
```

---

## 레포지토리 구조

```
dgnppr.github.io/
│
├── 콘텐츠 (엔티티 타입별)
│   ├── _wiki/          → concept    기술 개념
│   ├── _insight/       → insight    경험에서 추출한 단일 명제
│   ├── _problem/       → problem    만난 문제 + 근본 원인
│   ├── _tool/          → tool       도구·라이브러리 평가
│   ├── _event/         → event      회고·사건·마일스톤
│   └── _adr/           → adr        Architecture Decision Records
│
├── data/
│   ├── ontology-schema.json     엔티티 타입 + relation 타입 정의 (SSOT)
│   └── ontology-graph.json      빌드 결과물 — 노드(learning_pressure 포함) + 엣지
│
├── scripts/
│   ├── generate-ontology.js         문서 → 그래프 + learning_pressure 계산
│   └── validate-frontmatter.js      커밋 전 frontmatter 검증
│
└── mcp/
    └── ontology-server.js       통합 MCP 서버 (doc_* + ontology_* 12개 도구)
```

---

## 온톨로지 frontmatter

**concept / insight / problem / tool / event:**

```yaml
---
layout      : wiki        # 각 타입명 (insight, problem, tool, event)
title       : 제목
date        : 2026-01-01 00:00:00 +0900
updated     : 2026-01-01 00:00:00 +0900
tag         : tag1 tag2
status      : draft       # draft | writing | complete
public      : true
confidence  : medium      # high | medium | low — learning_pressure 계산에 사용
valid_from  : 2026-01-01  # 버전·시점 의존 문서 (선택)
valid_to    : 2026-12-31  # 만료 예정일 — debt/contradictions에서 감지 (선택)
actions     : [extend, challenge]  # 허용 액션 오버라이드 (선택)
relations:
  - { type: extends,      target: concept/data-architect/00_medallion }
  - { type: learned_from, target: event/retrospect/00_2023_year_retrospect }
---
```

**adr:**

```yaml
---
layout      : adr
title       : 제목
status      : proposed    # proposed | accepted | deprecated | superseded
deciders    : dragonappear
public      : false
valid_from  : 2026-01-01
supersedes  : adr/architecture/2025-001-old-decision  # 자동 엣지 생성
relations:
  - { type: motivated_by, target: problem/security/00_gcp_key_exposure }
---
```

`confidence`가 높을수록 `depth`가 높아지고 `learning_pressure`가 낮아진다. 문서를 깊게 이해하고 `confidence: high`로 올리는 것 자체가 이 시스템의 목표다.

---

## Relation 타입

| type | 의미 |
|------|------|
| `extends` | 개념을 확장·심화함 |
| `implements` | 실제로 구현·적용함 |
| `references` | 참조·인용함 |
| `supersedes` | 이전 결정을 대체함 |
| `motivated_by` | 이 결정의 동기가 저 문제임 |
| `resolves` | 이 문서가 저 문제를 해결함 |
| `learned_from` | 이 insight가 저 event에서 도출됨 |
| `applied_to` | 이 concept/tool이 저 adr에 적용됨 |
| `related` | 느슨한 연관 |

---

## 빌드 파이프라인

```bash
make ontology             # 그래프 재생성 + learning_pressure 계산 (문서 수정 후 항상)
make local-embeddings     # 전체 → Qdrant 인덱싱
make start                # Jekyll 서버 시작 (http://localhost:4000)
make qdrant-up            # Qdrant 컨테이너 시작 (Docker 필요)
make validate             # frontmatter 유효성 검사
```

---

## 로컬 환경 설정

```bash
# 의존성: Ruby, Node.js, Docker, Ollama (bge-m3 모델)

make install              # bundle install
npm install
make qdrant-up
make local-embeddings
make ontology
make start
```

**`.env`:**

```env
ANTHROPIC_API_KEY=sk-ant-...         # ontology_questions 사용 시 필요
EMBEDDING_BACKEND=ollama             # 또는 vertexai
QDRANT_URL=http://localhost:6333
OLLAMA_URL=http://localhost:11434
```

---

## MCP 서버 전체 도구 목록

`dgnppr-ontology` — Claude Code에 등록된 단일 MCP 서버.

| 도구 | 설명 |
|------|------|
| `doc_list` | 문서 목록 |
| `doc_read` | 문서 읽기 |
| `doc_search` | BM25 키워드 검색 |
| `doc_find` | 임베딩 유사도 검색 (목록) |
| `doc_query` | 임베딩 검색 → 본문 반환 (RAG) |
| `doc_write` | 문서 작성·수정 |
| `ontology_entities` | 엔티티 목록·시맨틱 검색 |
| `ontology_get` | 노드 메타 + 본문 + 관계 |
| `ontology_related` | 연관 문서 탐색 (graph+semantic hybrid) |
| `ontology_find` | 임베딩 flat 검색 |
| `ontology_neighborhood` | N-hop 그래프 워크 |
| `ontology_decision_context` | ADR 컨텍스트 소환 |
| `ontology_gaps` | 그래프 gap — 고립·미작성·액션 기회 |
| `ontology_act` | gap → 문서 blueprint 생성 |
| **`ontology_next`** | **learning_pressure top N — 지금 공부할 것** |
| **`ontology_questions`** | **소크라테스 엔진 — 내가 모르는 질문 생성** |
| **`ontology_landscape`** | **지식 지형도 — 강점·취약 클러스터** |
| **`ontology_debt`** | **지식 부채 — 미작성 참조·만료 문서** |
| **`ontology_contradictions`** | **모순 탐지 — confidence 충돌·좀비 ADR** |

자세한 MCP 도구 레퍼런스: [`docs/ontology-mcp.md`](docs/ontology-mcp.md)  
frontmatter 필드 레퍼런스: [`docs/ontology-usage.md`](docs/ontology-usage.md)
