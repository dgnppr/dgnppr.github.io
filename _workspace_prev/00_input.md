# 작업 요청

## 유형
UI 개선 — 색상 시스템 정비

## 요청 내용
1. 전체 SCSS에서 보라색 계열 색상을 제거하고 일관된 컬러 시스템으로 교체
2. 방문한 링크(:visited) 보라색 제거 — 현재 링크 클릭 후 보라색으로 변해서 불편함
3. 텍스트 색상 전반 조정 — 보라색 계열이 어울리지 않음

## 대상 파일
- `/Users/yh.yoon/private/dgnppr.github.io/_sass/` 내 모든 SCSS 파일
- `_base.scss`, `_theme.scss`, `_layout.scss`, `_index.scss`, `_tag.scss` 등

## 참고 사항
- 사이트 테마 컬러($theme-color)는 현재 보라색(#47146C) — 이미 태그 pill 등은 파란색으로 교체됨
- 변경 금지: $theme-color 변수 자체 (사이트 전체 브랜드 컬러이므로 유지)
- 변경 대상: 하드코딩된 보라색 hex 값들, :visited 링크 색상
