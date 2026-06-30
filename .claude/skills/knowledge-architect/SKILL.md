---
name: knowledge-architect
description: "DRAGONAPPEAR 데이터 지식 그래프 기반으로 글을 기획한다. ontology_gaps/next/landscape로 빈틈을 찾아 주제를 정하고, 새 글의 컬렉션·카테고리·slug·parent·연결관계·아웃라인을 담은 00_brief.md를 작성한다. 데이터 엔지니어링·클라우드 글의 기획·주제선정·구조설계·아웃라인 작업, 그리고 '무엇을 쓸지 정해줘'·'주제 추천'·'다음 글'·'기획 수정'·'아웃라인 다시' 같은 후속 요청에도 반드시 사용."
---

# Knowledge Architect Skill

글을 그래프의 노드로 기획한다. 출력은 단 하나, `_workspace/00_brief.md`. 다운스트림 전원이 이걸 단일 출처로 삼는다.

## 작업 순서

### 1. 그래프 진단
온톨로지 MCP로 현 그래프를 읽는다(이게 일반 블로그 기획과의 차이다):
- `ontology_gaps` — 빠진 노드·끊긴 엣지. 가장 가치 있는 글감.
- `ontology_next` — 시스템이 제안하는 다음 글 후보.
- `ontology_landscape` — 카테고리별 노드 분포·밀도.

사용자가 주제를 줬으면 그 주제 주변을 `ontology_related id:{근접노드}`로 살펴 맥락을 잡는다. MCP가 막히면 `_concept`/`_insight` 등 디렉토리를 grep해 수동 탐색하고 브리프에 명시한다.

### 2. 주제 확정 + 컬렉션 선택
한 글은 **하나의 질문**에 답한다. 두 질문이면 두 노드로 쪼갠다. 컬렉션은 인식론적 유형으로 고른다:

| 글의 성격 | 컬렉션 |
|----------|--------|
| "X란 무엇인가 / 어떻게 동작하나" 개념·위키 | `concept` |
| "X vs Y / 왜 중요한가 / 경험적 통찰·관점" | `insight` |
| "이런 문제를 이렇게 풀었다" | `problem` |
| "도구 X 쓰는 법" | `tool` |
| 회고·사건 기록 | `event` |
| 아키텍처 의사결정 기록 | `adr` |

### 3. 배치 + slug 결정
- `category`는 기존 것을 재사용한다(예: `data-architect`, `cloud`). 새 category는 꼭 필요할 때만.
- 파일: `_{collection}/{category}/{NNNN_slug}.md`. `NNNN`은 해당 디렉토리의 다음 번호(디렉토리를 확인해 충돌 회피). `slug`은 영문 snake_case.
- `parent`: `[[/{category}]]`.

### 4. 연결 설계 (자산화의 핵심)
`ontology_related id:{이 글과 가까운 노드} mode:hybrid`로 이웃을 찾는다. 결과의 `layer`를 본다:
- `graph` = 이미 선언된 관계, `semantic` = 아직 안 이은 잠재 연결(= 새 글이 이을 후보).

최소 1개 이상의 `relations`를 설계한다. 이을 곳이 없으면 글을 막지 말고, 먼저 부모 concept을 만들자고 제안하거나 parent만 두고 editor가 보강하도록 메모한다. 관계 타입은 의미로 고른다(extends=확장, references=참조, implements=구현, part-of=구성요소, motivates=problem이 유발, learned-from=event에서 학습).

### 5. 리서치 판정
`research_required`:
- `true` — 버전·가격·벤치마크·한도·외부 사실 비교가 글의 핵심.
- `false` — 순수 개념·아키텍처 원리. 자주 쓰는 흐름을 가볍게 유지하려 기본은 보수적으로 false.

### 6. `_workspace/00_brief.md` 작성
에이전트 정의의 출력 골격을 그대로 채운다. 배치·연결·핵심 질문은 **확정적으로** 적는다(흔들리면 글 전체가 흔들린다). SME·research 요청 절에 무엇이 필요한지 구체적으로 적는다.

## 산출물 기준
- 컬렉션·category·파일 경로·parent가 모두 확정됨
- `relations` 최소 1개(또는 "보류 + 사유")
- 핵심 질문 한 문장이 명확함
- `research_required`가 근거와 함께 결정됨
- SME 요청이 "무슨 코드·아키텍처·트레이드오프"인지 구체적임

## 후속/부분 재실행
`00_brief.md`가 이미 있으면 전체 재작성하지 말고 요청된 부분만 갱신한다. 발행본 개선이면 `doc_read`로 기존 노드를 읽고 추가할 연결·섹션만 설계한다.
