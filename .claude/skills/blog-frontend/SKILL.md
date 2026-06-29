---
name: blog-frontend
description: "테크 블로그 포스트 작성 및 Jekyll 구현 스킬. 마크다운 포스트 생성, Jekyll 템플릿/Sass 수정, JS 기능 구현을 수행한다. '포스트 작성', '글 써줘', '구현해줘', '템플릿 수정', 'CSS 추가', Jekyll 관련 작업 시 반드시 이 스킬을 사용. 포스트 수정, 스타일 보완, 기능 추가 요청에도 사용."
---

# Blog Frontend Skill

DRAGONAPPEAR 기술 블로그의 포스트 작성과 Jekyll 구현을 담당한다.

## 스택 정보

- **SSG**: Jekyll 4.1.x + Liquid 템플릿
- **마크다운**: kramdown (GFM 입력)
- **스타일**: SCSS (`_sass/` 디렉토리)
- **JS**: 바닐라 JS (`js/` 디렉토리)
- **데이터**: `generateData.js`로 `data/` 생성

## 포스트 작성 작업 순서

### 1. 브리핑 파일 읽기

- `_workspace/01_tpo_brief.md` — 아웃라인 및 기술 내용
- `_workspace/02_designer_spec.md` — 마크다운 템플릿 및 포맷 가이드

### 2. 파일 생성

**위키 포스트** (`_wiki/{category}/{NNNN_slug}.md`):
```yaml
---
layout  : wiki
title   : {제목}
summary : {한 줄 요약}
date    : {YYYY-MM-DD} 00:00:00 +0900
updated : {YYYY-MM-DD} 00:00:00 +0900
tag     : {태그1} {태그2}
public  : true
parent  : {부모 카테고리 slug}
latex   : false
---
```

**블로그 포스트** (`_posts/YYYY-MM-DD-{slug}.md`):
```yaml
---
layout  : document
title   : {제목}
summary : {한 줄 요약}
date    : {YYYY-MM-DD} 00:00:00 +0900
updated : {YYYY-MM-DD} 00:00:00 +0900
tag     : {태그1} {태그2}
public  : true
---
```

### 3. 콘텐츠 작성 기준

- TOC는 위키 포스트에 `* TOC\n{:toc}` 형식으로 추가
- 코드블록 언어 식별자 필수: ` ```java `, ` ```kotlin `, ` ```sql ` 등
- 기술 용어는 한국어(영어) 병기: "가상 스레드(Virtual Thread)"
- 문장은 능동형, 현재 시제 유지
- 각 H2 섹션은 최소 3단락 이상

### 4. 데이터 동기화

포스트 파일 생성 후 반드시 실행:
```bash
node generateData.js
```

## Jekyll 구현 작업 순서

### 템플릿/스타일 변경 시

1. `_layouts/`, `_includes/` 관련 파일 읽기
2. 기존 패턴 파악 후 최소한의 변경
3. `_sass/` 수정 시 기존 변수(`$theme-color` 등) 재사용
4. 신규 SCSS는 기존 파일에 섹션 추가 (새 파일 최소화)

### 검증

- `node generateData.js` 실행 → 에러 없음 확인
- Jekyll 빌드 오류가 없는지 Liquid 문법 재확인

## 주의 사항

- `generateData.js`는 `_wiki/`와 `_posts/`의 front matter를 파싱한다 — YAML 형식 정확히 준수
- `parent` 필드는 부모 카테고리의 slug (파일명, 확장자 제외)
- `tag`는 공백 구분, 기존 `data/tag_count.json` 태그 우선 사용
