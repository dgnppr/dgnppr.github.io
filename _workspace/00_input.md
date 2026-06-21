# 요청: 블로그 기능 전면 구현

## 구현 목록

1. **sitemap.xml** — jekyll-sitemap 플러그인 적용
2. **포스트 이전/다음 네비게이션** — post + wiki 레이아웃 양쪽에 이전/다음 글 링크
3. **Wiki Tooltip 호버 카드** — 본문에서 wiki 링크에 마우스 오버 시 summaries.json 기반 요약 팝업
4. **선수지식 맵** — parent: front matter 활용해 "먼저 읽어야 할 글" 시각화
5. **지식 그래프 뇌(Brain) UI** — knowledge-graph.js를 뇌 모양으로 리디자인

## 현재 인프라

- `data/summaries.json` — AI 요약 데이터 (각 문서의 summary 포함)
- `data/related.json` — 연관 관계 데이터
- `js/knowledge-graph.js` — 기존 지식 그래프 (D3.js 기반 추정)
- `js/autolink.js` — 자동 링크 생성
- `_layouts/post.html`, `wiki.html` — 레이아웃 파일
- `_config.yml` — jekyll-paginate, jekyll-gist 이미 설정됨

## 스택 제약

- Jekyll + LibSass (NOT Dart Sass, `@import`만 사용)
- Vanilla JS (no bundler, no ES modules)
- GitHub Pages 배포

## 우선순위

sitemap → 이전/다음 네비 → Wiki Tooltip → 선수지식 맵 → 뇌 모양 그래프
