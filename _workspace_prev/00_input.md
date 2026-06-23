# 요청: 지식 그래프 모달 디자인 개선 + /map 페이지 대체

## 작업 유형
UI 개선 (포스트 작성 없음)

## 문제 정의
- wiki 포스트 페이지 미니 지식 그래프 헤더의 expand 버튼을 누르면 전체 지식 그래프 모달이 열림
- 모달 우측 카테고리 패널 디자인이 이상함 → 개선 필요
- 사용자가 기존 `/map` 페이지를 이 모달로 완전히 대체하길 원함

## 모달 현재 구조
```
[모달 오버레이 — position:fixed, inset:0, var(--color-overlay), backdrop-filter:blur(4px)]
  └── [.kg-modal — 92vw×85vh, border-radius:14px, flex column]
        ├── [.kg-modal__header — 검색 입력 + 닫기 버튼]
        └── [.kg-modal__body — flex row]
              ├── [.kg-modal__graph — flex:1, D3 그래프]
              └── [.kg-modal__panel — width:190px, 카테고리 목록]
```

## 카테고리 패널 현재 HTML (JS 생성)
```html
<label class="gp-item">
  <input type="checkbox" checked data-cat="jpa">
  <span class="gp-dot" style="background:#22c55e"></span>
  <span class="gp-name">jpa</span>
  <span class="gp-count">8</span>
</label>
```
현재 스타일: `_sass/_layout.scss`의 `.kg-modal__panel`, `.kg-modal__groups`, 기존 gp-item 스타일

## 참고: 검색 모달 패턴 (일관성 유지 기준)
- 파일: `_includes/searchbox.html`, `_sass/_site-menu-bar.scss`
- 오버레이: `var(--color-overlay)`, `backdrop-filter:blur(3px)`, z-index:1000
- 카드: `var(--color-surface)`, `border-radius:12px`, `var(--shadow-card)`
- 전환: `opacity + visibility` 패턴

## /map 대체 계획
- 현재: `/map` → 전체 페이지 지식 그래프 (`map.html`)
- 목표: 헤더의 map 링크를 클릭하면 모달 오픈 트리거
- 또는: 모달을 전역 컴포넌트화하여 어느 페이지에서도 열 수 있게
- `_includes/header.html` 에서 map 링크 수정 필요

## 관련 파일
- `_sass/_layout.scss` — .kg-modal* 스타일 (하단에 위치)
- `_sass/_site-menu-bar.scss` — 검색 모달 패턴 참고
- `_layouts/wiki.html` — expand 버튼, 모달 HTML, KG init 스크립트
- `map.html` — 현재 /map 페이지
- `_includes/header.html` — 헤더 map 링크
- `js/knowledge-graph.js` — window.KnowledgeGraph.init(opts) 노출됨

## 목표
1. 카테고리 패널 디자인 개선 (태그 칩 스타일 또는 토글 버튼 스타일)
2. /map 헤더 링크 → 모달 트리거로 변경
3. 모달을 wiki 페이지 전용이 아닌 전역 컴포넌트로 이동
