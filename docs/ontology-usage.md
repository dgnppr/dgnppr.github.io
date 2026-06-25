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
