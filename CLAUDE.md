# DRAGONAPPEAR 기술 블로그

데이터 엔지니어링·클라우드 중심 기술 블로그. 글은 단순 포스트가 아니라 **온톨로지 그래프의 노드**다 — 6개 컬렉션(`concept`/`insight`/`problem`/`tool`/`event`/`adr`)에 살고, `relations:` frontmatter와 MCP 서버(`mcp/ontology-server.js`)로 연결된다. 그래프 갱신: `make ontology`.

## 하네스: 데이터 지식 스튜디오 (5인 에이전트 팀)

**목표:** 그래프 기반 기획 → 사실 검증 → 기술 심화 → 서사적 집필 → 발행+그래프 연결까지 한 흐름으로, 데이터 엔지니어링·클라우드 글을 **연결된 지식 자산**으로 생산한다. 온톨로지를 워크플로우에 Full-flywheel로 결합한다(`ontology_gaps`로 주제 → 발행 시 `relations` 자동 연결 → `make ontology` → 다음 글 제안).

**트리거:** 글 작성·블로그 기획·데이터 엔지니어링/클라우드 글·BigQuery/Spark/Airflow/Iceberg 글·온톨로지 글·발행·주제 추천, 그리고 후속(다시 실행·부분 수정·보완·다음 글) 요청 시 `studio-orchestrator` 스킬을 사용하라. 단순 질문·즉답 가능한 요청은 직접 응답. 그래프 직접 조회·수동 작성은 `ontology` 스킬(`/ontology`).

**팀:** architect(기획·연결) → researcher(검증, 조건부) ∥ sme(기술 심화) → writer(집필) → editor(발행·그래프 배선·QA). 상세는 `.claude/agents/`, `.claude/skills/`.

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-06-19 | 초기 구성 | 전체 | 테크 블로그 작성 팀 구성 요청 |
| 2026-06-29 | data-engineer(GCP/OSS SME) + tech-blogger 추가, blog-frontend 구현 전담 분리 | 구 blog-* 팀 | 데이터 엔지니어링 도메인 SME·글쓰기 역할 추가 |
| 2026-06-30 | **세계적 팀으로 재구성** — 5인 데이터 지식 스튜디오(knowledge-architect/research-analyst/data-eng-sme/technical-writer/ontology-editor)로 교체. 온톨로지 Full-flywheel 결합, research-analyst(사실검증) 신설, design+frontend를 editor로 통합. 구 blog-tpo/blog-designer/blog-frontend/tech-blogger/data-engineer 대체. SME references(gcp/oss-data-stack)·`ontology` 스킬 재사용 | 전체 | "세계적인 팀" 재구성 요청 |
