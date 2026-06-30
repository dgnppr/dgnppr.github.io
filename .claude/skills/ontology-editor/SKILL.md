---
name: ontology-editor
description: "초안을 올바른 Jekyll 엔티티 파일(_collection/category/NNNN_slug.md)로 발행하고, front matter와 relations를 채워 그래프에 연결하고, make ontology로 그래프를 재생성하고, 죽은 링크·frontmatter 오류를 QA한다. 발행·그래프배선·품질검증 작업, 그리고 '발행해'·'퍼블리시'·'그래프 연결'·'relations 추가'·'make ontology'·'QA'·'죽은 링크 확인'·'다시 발행' 후속 요청에도 반드시 사용. 발행 후 ontology_act로 다음 글을 제안한다."
---

# Ontology Editor Skill

글을 실제 파일로 내보내고 그래프에 묶는 마지막 관문이자 품질 게이트. 출력은 실제 엔티티 파일 + 갱신된 그래프 + `_workspace/04_publish_report.md`.

## 작업 순서

### 1. 배치 확정
`00_brief.md`에서 `collection`·`category`·`slug`·`parent`를 읽는다. `_{collection}/{category}/` 디렉토리를 확인해 `NNNN` 번호 충돌을 피하고 다음 번호를 정한다.

### 2. front matter 작성
에이전트 정의의 front matter 표준을 채운다. 컬렉션별 필수 필드를 빠뜨리지 않는다:
- 모든 글: `layout`(=collection), `title`, `date`, `updated`, `tag`(공백 구분), `public: true`, `parent`.
- insight/분석: `confidence`(low·medium·high) 추가.
- `latex`는 수식이 있으면 true. `toc`는 긴 글이면 true(본문 `<!-- toc -->`를 `{:toc}` 패턴으로 변환).

### 3. relations 검증 (핵심 QA — 죽은 엣지 금지)
brief의 intended relations와 본문 위키링크(`[[/...]]`)를 모은다. **각 target이 실재하는지** `doc_find`/`ontology_get` 또는 파일 존재로 검증한다:
- 존재함 → `relations`에 확정.
- 없음 → 넣지 않고 `04_publish_report.md`에 "보류: target 없음 — architect 확인 필요"로 기록하고 `knowledge-architect`에게 알린다.

이건 "관계가 있는가"가 아니라 **선언한 관계 ↔ 실재 노드의 경계면 정합성** 검증이다. 죽은 엣지는 그래프를 오염시킨다.

### 4. 발행
- **MCP 우선:** `doc_write`로 발행해 그래프 일관성을 보장한다(인자: type/category/slug/frontmatter/body).
- **폴백:** MCP가 막히면 파일을 `_{collection}/{category}/{NNNN_slug}.md`에 직접 쓴다.
- writer의 산문·SME의 코드는 **보존**한다. 헤더 레벨·코드 언어 식별자·TOC 마커 변환 같은 포맷만 손본다.

### 5. 그래프 재생성
```bash
make ontology      # data/ontology-graph.json 재생성
make frontmatter   # frontmatter 검증 (가능 시)
```
파일만 쓰고 재생성을 빠뜨리면 그래프가 글을 모른다. **발행 = 파일 + 그래프 갱신, 한 세트.**

### 6. QA 체크리스트 (교차 검증)
- [ ] frontmatter 필수 필드 모두 존재(layout이 기대하는 계약)
- [ ] `relations` target 전부 실재(죽은 엣지 0)
- [ ] `parent` 카테고리 실재
- [ ] 본문 위키링크가 relations와 모순 없음
- [ ] 코드블록 언어 식별자 존재
- [ ] `make ontology` 성공, 새 노드가 그래프에 나타남
- [ ] slug 번호 충돌 없음

### 7. 플라이휠 가동
`ontology_act`/`ontology_gaps`로 이 노드에서 파생될 다음 글 1~2개를 제안해 `04_publish_report.md`에 적는다(extend/implement/challenge/deepen 등). 그래프를 분석→행동→자산화하는 사이클을 잇는다.

## 산출물 기준
- 올바른 경로의 엔티티 파일(표준 frontmatter)
- 죽은 엣지 0 — 모든 relation target 검증됨
- `data/ontology-graph.json` 갱신됨(또는 실패 시 명시)
- `04_publish_report.md`: 발행 경로 + 확정 relations + QA 결과 + 다음 글 제안

## 에러 핸들링
- `make ontology` 실패 → 보고하고 파일은 유지하되 "그래프 미반영" 명시(정합성 문제를 숨기지 않음).
- frontmatter 검증 실패 → 누락 필드 채워 재시도.

## 후속/부분 재실행
발행본 수정이면 기존 파일을 읽고 본문/relations만 갱신, `updated` 날짜 변경, `make ontology` 재실행.
