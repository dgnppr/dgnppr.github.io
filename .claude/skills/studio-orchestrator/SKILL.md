---
name: studio-orchestrator
description: "DRAGONAPPEAR 데이터 지식 스튜디오(5인 에이전트 팀)를 조율해 데이터 엔지니어링·클라우드 기술 글을 기획→리서치→기술심화→집필→발행+그래프연결까지 한 흐름으로 만든다. '글 써줘'·'포스트 작성'·'블로그 기획'·'BigQuery/Spark/Airflow 글'·'클라우드 글'·'온톨로지 글'·'새 글'·'주제 추천'·'발행해' 요청 시 사용. 후속: '다시 실행'·'재실행'·'업데이트'·'부분 수정'·'보완'·'이전 결과 개선'·'다음 글'에도 반드시 이 스킬을 사용. 단순 질문·즉답 가능한 요청은 직접 응답."
---

# Data Knowledge Studio Orchestrator

데이터 엔지니어링·클라우드 글을 **고립된 포스트가 아니라 연결된 지식 자산**으로 만드는 5인 팀의 지휘자. 한 글이 그래프의 빈틈을 메우고 기존 노드와 이어질 때까지 책임진다.

## 실행 모드: 에이전트 팀 (파이프라인 + 팬아웃)

```
knowledge-architect ──→ research-analyst ─┐   (research는 brief 판정 시에만)
   (00_brief)            (01_research)     ├─→ technical-writer ──→ ontology-editor
                     └─→ data-eng-sme ─────┘    (03_draft)          (엔티티 파일 + 그래프 + 04_report)
                          (02_sme_notes)
```

> 런타임 주: 이 환경은 `TeamCreate`가 아니라 **`Agent`(named) + `run_in_background` + `SendMessage` + `TaskCreate/TaskUpdate/TaskGet`**로 팀을 실현한다. 파일(_workspace) = 신뢰 가능한 백본, 메시지·태스크 = 조율 레이어. 모든 Agent 호출에 `model: "opus"`.

## 에이전트 구성

| 팀원 | agent_type | 역할 | 스킬 | 출력 |
|------|-----------|------|------|------|
| architect | knowledge-architect | 그래프 기반 기획·배치·연결 설계 | knowledge-architect | `_workspace/00_brief.md` |
| researcher | research-analyst | 외부 사실 검증(조건부) | research-analyst | `_workspace/01_research.md` |
| sme | data-eng-sme | 아키텍처·코드·트레이드오프 | data-eng-sme | `_workspace/02_sme_notes.md` |
| writer | technical-writer | 서사적 본문 | technical-writer | `_workspace/03_draft.md` |
| editor | ontology-editor | 발행·그래프 배선·QA·플라이휠 | ontology-editor | 엔티티 파일 + 그래프 + `_workspace/04_publish_report.md` |

## 워크플로우

### Phase 0: 컨텍스트 확인 (후속 작업 지원)
1. `_workspace/` 존재 여부 확인.
2. 실행 모드 결정:
   - **미존재** → 초기 실행. Phase 1.
   - **존재 + 부분 수정 요청**(예: "톤만 다시", "relations 보강") → 부분 재실행. 해당 단계 에이전트만 재호출하고 기존 산출물 중 대상만 덮어쓴다.
   - **존재 + 새 주제** → 새 실행. 기존 `_workspace/`를 `_workspace_prev/`로 이동 후 Phase 1.

### Phase 1: 준비
1. 사용자 입력 분석 — 주제가 명시됐는지, 아니면 그래프 gap에서 위임받을지.
2. `_workspace/` 준비(새 실행이면 기존 것을 `_workspace_prev/`로 이동).
3. 사용자 입력을 `_workspace/00_input.md`에 저장(주제·요구·제약).

### Phase 2: 기획 (architect)
1. `architect`를 스폰:
   ```
   Agent(subagent_type:"knowledge-architect", name:"architect", model:"opus",
         run_in_background:true,
         prompt:"DRAGONAPPEAR 지식 아키텍트입니다. knowledge-architect 스킬을 사용해 _workspace/00_input.md를 읽고(없으면 ontology_gaps로 주제 위임) 00_brief.md를 작성하세요. 완료 시 리더에게 알리세요.")
   ```
2. `_workspace/00_brief.md`가 생길 때까지 대기(파일 게이트).
3. brief의 `research_required`를 읽어 다음 단계 분기를 정한다.

### Phase 3: 리서치 ∥ 기술 심화 (researcher ∥ sme)
**실행 방식:** 팬아웃 — 두 에이전트를 background로 동시에 띄운다.

1. `sme` 스폰(항상): `_workspace/00_brief.md`(+ 있으면 `01_research.md`)를 읽고 `02_sme_notes.md` 작성, 완료 시 `writer`에게 통지.
2. `research_required: true`일 때만 `researcher` 스폰: `00_brief.md`의 검증 요청을 처리해 `01_research.md` 작성. **researcher → sme**로 SendMessage하여 검증 사실을 코드·아키텍처에 반영하게 한다.
3. `TaskCreate`로 의존성 등록(예: writer 작업은 `depends_on:[sme(, researcher)]`).
4. 대기: `02_sme_notes.md`(필수)와 `01_research.md`(해당 시)가 모두 생길 때까지.

### Phase 4: 집필 (writer)
1. `writer` 스폰: `00_brief.md` + `02_sme_notes.md`(+ `01_research.md`)를 읽고 `03_draft.md`(본문만) 작성.
2. writer가 `[[SME 보강 필요: ...]]` 플레이스홀더를 남기면 → 리더가 `sme`를 해당 공백만 재호출(부메랑 보강)한 뒤 writer 재개.
3. `_workspace/03_draft.md` 생성까지 대기.

### Phase 5: 발행 + 그래프 (editor)
1. `editor` 스폰: `00_brief.md` + `03_draft.md`로 엔티티 파일을 발행, `relations` target 검증, `make ontology` 실행, QA, `04_publish_report.md` 작성.
2. editor가 "보류: target 없음"을 보고하면 → `architect`에게 해당 부모/이웃 노드를 먼저 만들지 확인(SendMessage). 사용자에게도 선택을 제시.
3. 엔티티 파일 + 갱신된 `data/ontology-graph.json` + `04_publish_report.md` 확인.

### Phase 6: 정리 + 진화
1. 팀원 종료, `_workspace/` 보존(사후 검증·감사).
2. `04_publish_report.md`의 **다음 글 제안**(플라이휠)을 사용자에게 보여준다.
3. 피드백 요청: "결과에서 고칠 부분이 있나요? 팀 구성·워크플로우에 바꾸고 싶은 점이 있나요?" 피드백은 CLAUDE.md 변경 이력에 반영.

## 데이터 전달 프로토콜
- **파일 기반(백본):** `_workspace/{NN}_{artifact}.md`. 모든 단계 산출물은 파일로. 리더는 파일 존재로 단계 게이트를 판정(메시지 유실에 강건).
- **태스크 기반(조율):** `TaskCreate`로 의존성·진행 추적, `TaskGet`으로 모니터링.
- **메시지 기반(소통):** 같이 도는 에이전트 간(researcher↔sme) 실시간 전달, 리더의 부메랑 보강 지시.
- 최종 산출물(엔티티 파일)만 컬렉션 경로에, 중간물은 `_workspace/`에 보존.

## 에러 핸들링
- **에이전트 1회 실패 → 1회 재시도.** 재실패 시 그 산출물 없이 진행하되 `04_publish_report.md`에 누락을 명시(흐름을 막지 않음).
- **MCP/그래프 재생성 실패** → 파일은 유지, "그래프 미반영" 명시. 정합성 문제를 숨기지 않는다.
- **죽은 relation target** → editor가 넣지 않고 보류 보고. architect 확인 루프.
- **상충 사실** → 삭제하지 않고 출처 병기(researcher 원칙).

## 테스트 시나리오

**정상 흐름 (개념 글, research 불필요):**
입력 "Iceberg의 hidden partitioning이 왜 중요한가" → architect가 `concept/data-architect`에 배치, `research_required:false`, 기존 medallion 노드에 `extends` 연결 설계 → sme가 파티셔닝 함정·코드 작성 → writer가 장면형 본문 → editor가 `_concept/data-architect/NNNN_iceberg_hidden_partitioning.md` 발행 + relations 검증 + `make ontology` + 다음 글로 "Iceberg vs Hudi" 제안.

**에러 흐름 (죽은 엣지):**
brief가 아직 없는 `concept/cloud/05_xxx`에 `extends`를 걸도록 설계 → editor가 target 부재 감지 → relations에서 제외, "보류" 보고 → architect에게 부모 노드 선작성 여부 확인 → 사용자 선택에 따라 부모 먼저 발행 후 관계 보강. 글 발행 자체는 막지 않음.
