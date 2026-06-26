# Ontology MCP 사용 가이드

Claude Code에서 `/ontology` 스킬로 지식 그래프를 탐색하고 관리하는 가이드.

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

### 지식 분석 (Knowledge Intelligence)

```
/ontology landscape        # 지식 지형도 — 카테고리별 밀도·강점·취약 클러스터
/ontology debt             # 지식 부채 — 미작성 참조 개념·만료 문서·미커버 태그
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

## 지식 분석 상세

### `landscape` — 지식 지형도

내가 뭘 깊게 알고 뭐가 얕은지 한눈에 보여준다.

```
/ontology landscape
```

반환 항목:
- `overview`: 전체 노드 수, 엣지 수, 고립 비율, 연결률
- `strongest_cluster`: 가장 밀도 높은 카테고리
- `shallowest_cluster`: 노드는 많은데 연결이 약한 카테고리
- `clusters`: 카테고리별 `total`, `isolated`, `internal_edges`, `high_confidence`, `strength_score`

### `debt` — 지식 부채

여러 문서에서 언급하는데 실제로 안 쓴 개념을 탐지한다.

```
/ontology debt             # 기본 (min_refs=2)
/ontology debt min_refs:3  # 3회 이상 참조된 것만
```

탐지 항목:
- `missing_concept`: 엣지 target이지만 노드 없는 ID (ref_count ≥ min_refs)
- `expired`: `valid_to`가 지난 문서 — 아직 참조 중이면 high priority
- `uncovered_topic`: 고빈도 태그인데 전용 concept 문서 없음

### `contradictions` — 모순 탐지

그래프 내 충돌과 불일치를 찾는다.

```
/ontology contradictions
```

탐지 항목:
- `explicit_contradiction`: `contradicts` 엣지가 선언된 쌍
- `confidence_conflict`: 같은 카테고리·같은 태그인데 confidence가 high vs low
- `stale_reference`: 만료된 문서를 여전히 참조하는 경우
- `superseded_but_active`: supersedes 엣지가 있는데 status가 아직 `accepted`인 ADR

---

## 시나리오별 사용법

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
# 아침 — 그래프 상태 파악
/ontology landscape
/ontology debt

# 글 쓰기 전 — 중복 확인 + 맥락 수집
/ontology doc find "<주제>"
/ontology related "<주제>"

# ADR 작성 전
/ontology decision "<주제>"

# 작성 후 — 항상
make ontology

# 주기적
/ontology contradictions
make local-embeddings
```
