# 요청: visited 링크 색상 개선

## 요청 유형
UI 개선 (포스트 작성 불필요) — `_sass/_base.scss` + `_sass/_theme.scss` 수정

## 문제
현재 visited 링크 색상이 너무 파스텔하여 테크 블로그 분위기와 맞지 않음.

## 현재 상태
- `a:visited` (라이트모드): `#8c8c9e` — 파스텔 슬레이트 그레이, 너무 연함
- `body.dark-mode .post-content a:visited`: `#8899b0` — 파스텔 블루그레이, 너무 연함

## 테마 컨텍스트
- `$theme-color`: `#47146C` (다크 퍼플) — 브랜드 메인 컬러
- `a:link` (라이트모드): `#47146C`
- `body.dark-mode .post-content a:link`: `#C9A6E8` (라이트 퍼플)
- 전체 톤: 다크 퍼플 기반, 전문적이고 밀도 있는 테크 블로그

## 목표
- visited 링크를 파스텔하지 않게 — 테크 블로그에 어울리는 묵직한 톤
- 읽은 상태를 명확히 구분하되 촌스럽지 않게
- 라이트/다크 모드 모두 개선

## 수정 대상 파일
- `_sass/_base.scss` — `a:visited { color: ... }` 전역 규칙
- `_sass/_theme.scss` — `body.dark-mode .post-content a:visited { color: ... }`
