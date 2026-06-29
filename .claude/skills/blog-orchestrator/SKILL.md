---
name: blog-orchestrator
description: "DRAGONAPPEAR 테크 블로그 팀(TPO + 디자이너 + 프론트엔드)을 조율하는 오케스트레이터. '새 포스트 써줘', '블로그 글 작성', '포스트 기획부터 작성까지', '팀으로 작업', '블로그 작업 시작' 등 전체 워크플로우가 필요한 요청 시 반드시 이 스킬을 사용. 재실행, 포스트 수정, 팀 재구성 요청에도 사용."
---

# Blog Orchestrator

DRAGONAPPEAR 기술 블로그 팀을 조율하여 포스트 기획부터 작성까지 전체 워크플로우를 실행한다.

## 실행 모드: 에이전트 팀 (파이프라인 패턴)

## 에이전트 구성

| 팀원 | 에이전트 파일 | 역할 | 출력 |
|------|------------|------|------|
| blog-tpo | agents/blog-tpo.md | 콘텐츠 전략, 아웃라인 | `_workspace/01_tpo_brief.md` |
| blog-designer | agents/blog-designer.md | 포맷 설계, UX 스펙 | `_workspace/02_designer_spec.md` |
| blog-frontend | agents/blog-frontend.md | 포스트 작성, 구현 | 실제 파일 |

## 워크플로우

### Phase 0: 컨텍스트 확인

1. `_workspace/` 존재 여부 확인
2. 실행 모드 결정:
   - **`_workspace/` 미존재** → 초기 실행, Phase 1로 진행
   - **`_workspace/` 존재 + 부분 수정 요청** → 해당 에이전트만 재호출, 기존 파일 참조
   - **`_workspace/` 존재 + 새 주제** → `_workspace/`를 `_workspace_prev/`로 이동 후 Phase 1 진행

### Phase 1: 준비

1. 사용자 입력 분석:
   - 요청 유형: 새 포스트 / UI 개선 / 기능 구현
   - 주제 또는 키워드 파악
   - 포스트 유형 파악 (튜토리얼 / 분석 / 회고 등)
2. `_workspace/` 디렉토리 생성
3. 사용자 입력을 `_workspace/00_input.md`에 저장

### Phase 2: 팀 구성

```
TeamCreate(
  team_name: "blog-team",
  members: [
    {
      name: "blog-tpo",
      agent_type: "blog-tpo",
      model: "opus",
      prompt: "DRAGONAPPEAR 기술 블로그 TPO입니다. blog-tpo 스킬을 사용해 _workspace/00_input.md를 읽고 포스트 기획을 시작하세요. 완성 후 blog-designer에게 알리세요."
    },
    {
      name: "blog-designer",
      agent_type: "blog-designer",
      model: "opus",
      prompt: "DRAGONAPPEAR 기술 블로그 UI/UX 디자이너입니다. blog-designer 스킬을 사용해 blog-tpo의 알림을 받으면 _workspace/01_tpo_brief.md를 읽고 포맷 스펙을 작성하세요. 완성 후 blog-frontend에게 알리세요."
    },
    {
      name: "blog-frontend",
      agent_type: "blog-frontend",
      model: "opus",
      prompt: "DRAGONAPPEAR 기술 블로그 프론트엔드 개발자입니다. blog-frontend 스킬을 사용해 blog-designer의 알림을 받으면 _workspace/의 브리핑과 스펙을 읽고 실제 포스트를 작성하거나 기능을 구현하세요."
    }
  ]
)
```

### Phase 3: 작업 등록

```
TaskCreate(tasks: [
  { title: "포스트 기획 및 아웃라인 작성", assignee: "blog-tpo",
    description: "_workspace/00_input.md 기반으로 TPO Brief 작성 → _workspace/01_tpo_brief.md" },
  { title: "포맷 스펙 및 UX 가이드라인 작성", assignee: "blog-designer",
    description: "TPO Brief 기반으로 Designer Spec 작성 → _workspace/02_designer_spec.md",
    depends_on: ["포스트 기획 및 아웃라인 작성"] },
  { title: "포스트 작성 및 구현", assignee: "blog-frontend",
    description: "TPO Brief + Designer Spec 기반으로 실제 마크다운 파일 생성",
    depends_on: ["포맷 스펙 및 UX 가이드라인 작성"] }
])
```

### Phase 4: 팀 모니터링

팀원들이 SendMessage로 자체 조율한다. 파이프라인:
```
blog-tpo → (완성 알림) → blog-designer → (완성 알림) → blog-frontend
```

모든 작업 완료 후 오케스트레이터가 결과를 확인하고 사용자에게 보고한다.

## 에러 핸들링

- **에이전트 실패 시**: 해당 에이전트만 재호출, 기존 `_workspace/` 파일 유지
- **데이터 불일치**: `node generateData.js` 재실행
- **상충 내용**: 양쪽 관점을 병기하고 사용자에게 결정 요청

## UI 개선 전용 플로우

요청이 UI/디자인 개선인 경우 (포스트 작성 불필요):
1. blog-designer만 단독 실행 (blog-tpo 건너뜀)
2. Designer Spec 작성 후 blog-frontend에게 전달
3. Frontend가 Jekyll/SCSS/JS 구현

## 테스트 시나리오

**정상 흐름**: "JVM GC 알고리즘 비교 분석 포스트 써줘"
→ TPO가 아웃라인 작성 → Designer가 포맷 스펙 작성 → Frontend가 `_wiki/jvm/` 하위에 파일 생성

**에러 흐름**: Frontend가 빌드 오류 발생 시
→ Liquid 문법 재확인 → front matter YAML 검증 → `generateData.js` 재실행
