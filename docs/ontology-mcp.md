# Ontology MCP 사용 가이드

Claude Code에서 `/ontology` 스킬로 지식 그래프를 탐색하고, 내가 모르는 것을 찾아내는 가이드.

---

## 도구 한눈에 보기

### 지식 성장 — "내가 모르는 것을 찾아서 거기로 이끌어라"

| 명령 | 도구 | 역할 | LLM |
|------|------|------|-----|
| `/ontology next` | `ontology_next` | learning_pressure 기준 지금 공부할 개념 top N | ✗ |
| `/ontology questions id:<id>` | `questions` | 문서 본문 읽고 내가 답 못하는 질문 생성 + 저장 | ✅ |
| `/ontology answered id:<id>` | `answered` | 질문 답변 완료 처리 (단일 또는 전체) | ✗ |
| `/ontology studied id:<id>` | `studied` | 학습 기록 추가 → study_decay 반영 | ✗ |
| `/ontology discover` | `discover` | 글 전체 분석 → 심화할 문서 + 새로 쓸 문서 추천 | ✅ |
| `/ontology blindspot` | `blindspot` | 지식 전체 분석 → 아직 다루지 않은 인접 영역 추천 | ✅ |
| `/ontology blindspot query:<q>` | `blindspot` | 특정 주제 주변의 맹점만 탐색 | ✅ |
| `/ontology eval id:<id>` | `ontology_eval` | 문서 이해 깊이 LLM 평가 → learning_pressure 반영 | ✅ |

### 지식 분석 — "지금 상태가 어떤가"

| 명령 | 도구 | 역할 |
|------|------|------|
| `/ontology landscape` | `ontology_landscape` | 카테고리별 밀도·강점·취약 클러스터 지형도 |
| `/ontology debt` | `ontology_debt` | 미작성 참조 개념, 본문 언급 미작성 용어, 만료 문서 |
| `/ontology contradictions` | `ontology_contradictions` | confidence 충돌, 만료 참조, 좀비 ADR |
| `/ontology gaps` | `ontology_gaps` | 고립 노드, 액션 기회 |

### 그래프 탐색 — "이 개념과 뭐가 연결돼 있나"

| 명령 | 도구 | 역할 |
|------|------|------|
| `/ontology related <query\|id>` | `ontology_related` | 관련 문서 탐색 (그래프+임베딩 hybrid) |
| `/ontology neighborhood <id>` | `ontology_neighborhood` | N-hop 그래프 워크 |
| `/ontology get <id>` | `ontology_get` | 노드 메타 + 본문 + 관계 전체 |
| `/ontology find <query>` | `ontology_find` | 임베딩 유사도 검색 |
| `/ontology decision <query>` | `ontology_decision_context` | 과거 유사 ADR 소환 |
| `/ontology entities [type]` | `ontology_entities` | 엔티티 목록 |

### 문서 액션 — "빈 곳을 채운다"

| 명령 | 도구 | 역할 |
|------|------|------|
| `/ontology act <id> <action>` | `ontology_act` | gap → 문서 blueprint 생성 |
| `/ontology doc write <type> <path>` | `doc_write` | 문서 작성·수정 |
| `/ontology doc list/search/find/query/read` | `doc_*` | 문서 CRUD |

---

## 시작 전 체크리스트

```bash
make qdrant-up            # Qdrant 컨테이너 시작 (Docker 필요)
make local-embeddings     # 전체 문서 인덱싱 (최초 또는 문서 대량 추가 후)
make ontology             # 그래프 빌드 (문서 수정 후 항상)
```

MCP 연결 확인:
```bash
claude mcp list           # dgnppr-ontology 항목이 있어야 함
```

### LLM 백엔드 설정 (`questions` / `discover` 사용 시)

`.env`에 아래 중 하나를 설정한다:

```env
# LM Studio (로컬)
LLM_BACKEND=lmstudio
LM_STUDIO_BASE_URL=http://localhost:1234/v1
LM_STUDIO_MODEL=<모델명>

# Ollama (로컬)
LLM_BACKEND=ollama
OLLAMA_URL=http://localhost:11434
LLM_MODEL=llama3.2

# Anthropic
LLM_BACKEND=anthropic
ANTHROPIC_API_KEY=sk-ant-...
LLM_MODEL=claude-haiku-4-5-20251001
```

`LLM_BACKEND` 미설정 시: `ANTHROPIC_API_KEY` 있으면 anthropic, 없으면 ollama로 자동 전환.

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
/ontology doc find "분산 트랜잭션"       # 임베딩 유사도 — 목록 반환
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
```

### 지식 성장 (Knowledge Growth Engine)

```
/ontology next             # learning_pressure top 5 — 지금 공부할 것
/ontology next limit:10    # top 10
/ontology next type:concept

/ontology questions id:<엔티티ID>        # 소크라테스 질문 생성 + data/questions.json 저장 (LLM)
/ontology questions id:<엔티티ID> count:10

/ontology answered id:<엔티티ID>         # 모든 질문 완료 처리
/ontology answered id:<엔티티ID> index:2 # 인덱스 2번 질문만 완료

/ontology studied id:<엔티티ID>          # 오늘 학습 기록 추가 → study_decay 감소

/ontology discover         # 글 전체 LLM 분석 — 부족한 개념 + 써야 할 문서 추천
/ontology discover limit:15

/ontology blindspot                     # 전체 지식 기반 맹점 분석 (LLM)
/ontology blindspot query:"JVM GC"     # JVM GC 주변 맹점만 집중 탐색

/ontology eval id:<엔티티ID>             # 문서 이해 깊이 LLM 평가 → depth-cache.json 저장
/ontology eval id:<엔티티ID> force:true  # 캐시 무시하고 재평가
```

### 지식 분석 (Knowledge Intelligence)

```
/ontology landscape        # 지식 지형도 — 카테고리별 밀도·강점·취약 클러스터
/ontology debt             # 지식 부채 — 미작성 참조·만료 문서·본문 언급 미작성
/ontology debt min_refs:3
/ontology contradictions   # 모순 탐지 — confidence 충돌·만료 참조·좀비 ADR
/ontology gaps             # 그래프 gap — 고립 노드·액션 기회
/ontology gaps adr         # ADR gap만
```

### 문서 작성

```
/ontology doc write concept database/01_mysql_index.md
/ontology doc write insight essay/05_why_explicit_over_implicit.md
/ontology doc write adr security/2026-002-rotate-service-account.md
/ontology act adr/X motivate    # gap → blueprint 생성
```

---

## 지식 성장 도구 상세

### `next` — 지금 공부해야 할 것

`learning_pressure` 기준 top N을 반환한다.

```
/ontology next
```

반환 항목:
- `rank`: 순위
- `title`: 문서 제목
- `learning_pressure`: 수치 (높을수록 긴급)
- `importance`: 다른 문서들의 참조 수
- `depth`: 이해 깊이 합산 점수
- `why`: 왜 지금 이걸 봐야 하는지

**특성:** frontmatter(`confidence`, `status`)에 일부 의존. 깊이 이해한 문서는 `confidence: high`/`status: complete`로 올려야 정확해진다.

---

## `learning_pressure` 계산 원리

`make ontology` 실행 시 모든 노드에 자동 계산된다. **frontmatter뿐 아니라 글 본문·학습 이력·미답변 질문까지 4개 신호를 통합**한다.

```
learning_pressure = importance × (1 - depth) × study_decay + unanswered_bonus
```

### importance — 얼마나 많은 것이 이 개념에 의존하는가

```
importance = (inbound 참조 수) × 2 + (outbound 참조 있으면 +1)
```

| 상황 | importance |
|------|-----------|
| 아무도 참조 안 함 | 0 |
| 내가 다른 문서 참조만 함 | 1 |
| 1개 문서가 나를 참조 | 2 |
| 3개 문서가 나를 참조 + 나도 참조 있음 | 7 |

### depth — 4개 신호의 혼합 (0 ~ 1)

LLM 평가(`ontology_eval`) 유무에 따라 가중치가 달라진다:

**LLM 평가 없을 때:**
```
depth = confidence_score × 0.25
      + status_score     × 0.25
      + density          × 0.15
      + content_depth    × 0.35
```

**LLM 평가 있을 때 (더 정확):**
```
depth = confidence_score × 0.15
      + status_score     × 0.15
      + density          × 0.10
      + content_depth    × 0.25
      + llm_depth        × 0.35   ← /ontology eval 결과
```

| 신호 | 수집 방법 | 범위 |
|------|---------|------|
| `confidence_score` | frontmatter `confidence` 필드 | high=1.0, medium=0.6, low=0.2 |
| `status_score` | frontmatter `status` 필드 | complete=1.0, writing=0.6, draft=0.2 |
| `density` | (inbound+outbound, 최대 6) ÷ 6 | 0 ~ 1.0 |
| `content_depth` | 본문 길이·코드블록·실패키워드·외부링크·헤딩 정적 분석 | 0 ~ 1.0 |
| `llm_depth` | `/ontology eval` → `depth-cache.json` 캐시 | 0 ~ 1.0 |

**`content_depth` 분석 기준:**
- 본문 1000자 이상: +0.25
- 코드 블록 존재: +0.20
- 실패/한계/주의 키워드 3개+: +0.25
- 외부 링크 존재: +0.15
- 헤딩 3개+: +0.15

### C: study_decay — 최근 학습일수록 일시 감소

```
study_decay = max(0.2, min(1.0, days_since_last_study / 30))
```

- `/ontology studied` 실행 직후: 0.2 (pressure 80% 감소)
- 30일 경과: 1.0 (원래대로)
- 기록 없음: 1.0

### B: unanswered_bonus — 미답변 질문이 쌓이면 압력 증가

```
unanswered_bonus = min(unanswered_questions × 0.5, 2.0)
```

- `/ontology questions`로 생성된 질문 중 미답변(`answered: false`) 수
- 4개 미답변 시: +2.0 (상한)
- `/ontology answered`로 처리하면 감소

### 계산 예시

**상황:** 3개 문서가 참조, `confidence: medium`, `status: draft`, 엣지 4개, LLM 평가 없음, 미답변 질문 2개

```
importance      = 3×2 + 1        = 7
content_depth   = 본문 길이+코드  ≈ 0.45  (정적 분석)
density         = 4/6            = 0.67
depth           = 0.6×0.25 + 0.2×0.25 + 0.67×0.15 + 0.45×0.35
                = 0.15 + 0.05 + 0.10 + 0.158      = 0.46
study_decay     = 기록 없음       = 1.0
unanswered_bonus = 2 × 0.5       = 1.0
learning_pressure = 7×(1-0.46)×1.0 + 1.0 = 4.78
```

**`/ontology eval` 후 score=4 (→ llm_depth=0.75):**

```
depth           = 0.6×0.15 + 0.2×0.15 + 0.67×0.10 + 0.45×0.25 + 0.75×0.35
                = 0.09 + 0.03 + 0.067 + 0.113 + 0.263 = 0.56
learning_pressure = 7×(1-0.56)×1.0 + 1.0 = 4.08
```

**`/ontology studied` 직후 (study_decay=0.2):**

```
learning_pressure = 7×(1-0.56)×0.2 + 1.0 = 1.62
```

### learning_pressure를 낮추는 방법

| 방법 | 도구 | 효과 |
|------|------|------|
| 글을 깊이 이해하고 LLM 평가 | `/ontology eval` | `llm_depth` → depth 상승 |
| 질문에 답변 완료 | `/ontology answered` | `unanswered_bonus` 감소 |
| 오늘 학습 기록 | `/ontology studied` | `study_decay` 감소 |
| `confidence` 올리기 | frontmatter 수정 + `make ontology` | `confidence_score` 상승 |
| `status` 갱신 | frontmatter 수정 + `make ontology` | `status_score` 상승 |
| 관련 개념 연결 | `relations` 추가 + `make ontology` | `density` 상승 |

---

### `questions` — 소크라테스 엔진 (LLM)

문서 본문을 LLM이 읽고, **문서에 이미 답이 있는 질문은 제외**한 채 이해의 구멍을 드러낸다. 생성된 질문은 `data/questions.json`에 저장되어 미답변 질문이 `learning_pressure`에 가산된다.

```
/ontology questions id:concept/data-architect/04_what_is_ontology
```

반환 항목:
- `questions`: `[{ question, why, answered, answered_at }]` 배열

**동작 방식:**
1. 파일 본문 읽기 (frontmatter 제거)
2. 연결된 엣지 목록 컨텍스트로 포함
3. LLM 생성 → `data/questions.json` 저장 (이전에 답변 완료된 질문은 보존)
4. `make ontology` 시 미답변 질문 수가 `unanswered_bonus`로 `learning_pressure`에 가산

**LLM 백엔드:** `.env`의 `LLM_BACKEND` 사용.

---

### `answered` — 질문 답변 완료 처리

`questions`로 생성된 질문을 완료 처리한다. `make ontology` 실행 시 `unanswered_bonus`가 감소해 `learning_pressure`가 낮아진다.

```
/ontology answered id:concept/java/00_what_is_java_virtual_thread          # 전체 완료
/ontology answered id:concept/java/00_what_is_java_virtual_thread index:1  # 1번 질문만
```

반환: `marked`(처리 수), `remaining_unanswered`(남은 미답변 수)

---

### `studied` — 학습 기록 추가

오늘 이 문서를 공부했다고 기록한다. `data/study-log.json`에 저장되며, `make ontology` 시 `study_decay`가 반영돼 `learning_pressure`가 일시적으로 낮아진다.

```
/ontology studied id:concept/data-architect/04_what_is_ontology
```

- 학습 직후: `study_decay = 0.2` (pressure 80% 감소)
- 30일 경과: `study_decay = 1.0` (pressure 원래대로 복귀)
- 공부 이력 최근 30회 보존

---

### `discover` — 글 전체 LLM 분석 (LLM)

상위 N개 문서 본문을 LLM이 읽고, frontmatter와 무관하게 실제 내용 기반으로 추천한다.

```
/ontology discover
```

반환 항목:
- `deepen`: 이미 있는 문서인데 내용이 얕거나 핵심이 빠진 것 3개
  - `title`, `why` (글 내용 근거), `what` (구체적으로 보완할 내용)
- `write_new`: 여러 글에서 언급되지만 독립 문서가 없는 개념 3개
  - `title`, `type`, `why`, `connects_to`
- `content_mentioned_concepts`: 본문 정적 분석으로 발견된 미작성 용어 목록

**`next`와 차이점:**
- `next` = 수치 기반 우선순위 (빠름, LLM 없음)
- `discover` = 내용 기반 추천 (느림, LLM 필요, 더 맥락적)

---

### `blindspot` — 지식 맹점 분석 (LLM)

내가 다루는 전체 문서 목록을 LLM에게 보여주고, **아직 한 번도 다루지 않은 인접 영역**을 추천한다.

```
/ontology blindspot                      # 전체 지식 기반 맹점 분석
/ontology blindspot query:"JVM GC"      # JVM GC 주변 맹점만 집중 탐색
/ontology blindspot query:"데이터 파이프라인"
```

`query` 없음: 전체 문서를 분석해 가장 인접한 미탐색 영역 추천.  
`query` 있음: 해당 주제와 연관된 맹점에 LLM이 집중 — 더 구체적인 추천이 나온다.

반환 항목 (5개):
- `query`: 입력한 쿼리 (없으면 null)
- `area`: 탐색해야 할 영역
- `why`: 현재 지식과의 논리적 연결점
- `starter_question`: 이 영역을 시작하는 첫 질문
- `related_existing`: 현재 문서 중 연결될 것들

**`discover`와 차이점:**
- `discover` = 기존 문서를 더 깊게 or 누락된 하위 개념
- `blindspot` = 완전히 새로운 인접 영역 — 내가 모르는 것 자체를 모르는 것을 찾음

---

### `ontology_eval` — 문서 이해 깊이 LLM 평가 (LLM)

문서 본문을 LLM이 읽고 이해 깊이를 1~5점으로 평가한다. 결과는 `data/depth-cache.json`에 캐시되며 `make ontology` 시 `learning_pressure` 계산에 반영된다.

```
/ontology eval id:concept/java/00_what_is_java_virtual_thread
/ontology eval id:concept/java/00_what_is_java_virtual_thread force:true   # 재평가
```

반환 항목:
- `score_1_to_5`: LLM 평가 점수
- `score`: 정규화 값 (0~1, `learning_pressure` 계산에 사용)
- `reason`: 평가 근거 한 줄
- `missing`: 가장 부족한 것
- `cached`: 캐시 사용 여부

**평가 기준:**
| 점수 | 의미 |
|------|------|
| 1 | 정의만 있음 — 예시·적용·한계 없음 |
| 2 | 기본 개념 있지만 얕음 |
| 3 | 적용 예시 있고 어느 정도 설명됨 |
| 4 | 실패 사례·한계·엣지 케이스 포함 |
| 5 | 깊은 이해 — 트레이드오프·대안·실전 경험 명확 |

**캐시 무효화:** 문서 본문이 변경되면 자동으로 재평가 대상 (본문 길이+끝 20자 기반 hash).

---

## 지식 분석 도구 상세

### `landscape` — 지식 지형도

```
/ontology landscape
```

반환 항목:
- `overview`: 전체 노드 수, 엣지 수, 고립 비율, 연결률
- `strongest_cluster`: 가장 밀도 높은 카테고리
- `shallowest_cluster`: 노드는 많은데 연결이 약한 카테고리
- `clusters`: 카테고리별 `total`, `isolated`, `internal_edges`, `high_confidence`, `strength_score`

### `debt` — 지식 부채

```
/ontology debt             # 기본 (min_refs=2)
/ontology debt min_refs:3
```

탐지 항목:

| type | 탐지 방식 | 의미 |
|------|---------|------|
| `missing_concept` | `relations` 엣지 대상이지만 노드 없음 | 다른 문서에서 참조했지만 안 씀 |
| `content_mentioned` | 본문 backtick/bold에서 2회+ 등장 | 글에서 자주 쓰는데 독립 문서 없음 |
| `expired` | `valid_to` 지남 | 만료됐는데 여전히 참조 중 |
| `uncovered_topic` | 고빈도 태그인데 concept 문서 없음 | 태그는 쓰는데 개념 정리 없음 |

`content_mentioned`는 frontmatter 선언 없이 **글 본문에서 자동 탐지**된다. `make ontology` 실행 시 갱신.

### `contradictions` — 모순 탐지

```
/ontology contradictions
```

탐지 항목:
- `explicit_contradiction`: `contradicts` 엣지가 선언된 쌍
- `confidence_conflict`: 같은 카테고리·태그인데 confidence가 high vs low
- `stale_reference`: 만료된 문서를 여전히 참조하는 경우
- `superseded_but_active`: supersedes 엣지가 있는데 status가 아직 `accepted`인 ADR

---

## 시나리오별 사용법

### 지금 뭘 공부해야 할지 모를 때

```
/ontology next              # 수치 기반 — 빠른 우선순위
/ontology discover          # 내용 기반 — 맥락 있는 추천
```

### 특정 개념을 제대로 이해하고 있는지 확인

```
/ontology questions id:<id>
```

질문에 답 못하면 거기가 실제 구멍.

### 글 쓰기 전

```
/ontology doc find "<주제>"     # 이미 있는지 확인
/ontology related "<주제>"      # 연관 맥락 수집
```

### ADR 작성 전

```
/ontology decision "<주제>"     # 과거 유사 결정 소환
/ontology doc write adr security/2026-002-xxx.md
```

### 그래프 gap 채우기

```
/ontology gaps                  # critical → high → medium → low 순
/ontology act <id> <action>     # blueprint 생성
/ontology doc write <type> <path>
make ontology
```

### 지식 건강 점검

```
/ontology landscape             # 강점·취약 클러스터 파악
/ontology debt                  # 미작성 개념 확인
/ontology contradictions        # 충돌·만료 감지
```

---

## 액션 타입 참조

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

## 루틴 패턴

```
# 공부 시작 전 — 지금 뭘 봐야 하나
/ontology next

# 개념 이해 확인
/ontology questions id:<id>

# 글 쓰기 전
/ontology doc find "<주제>"
/ontology related "<주제>"

# ADR 작성 전
/ontology decision "<주제>"

# 작성 후 항상
make ontology

# 주기적
/ontology discover
/ontology landscape
/ontology debt
/ontology contradictions
make local-embeddings
```
