# 작업 요청: TOP 버튼 UX/기능 개선 + 디자인 리뉴얼

## 요청 유형
UI 개선 + 기능 확장 (기획 → 디자인 → 구현 풀 파이프라인)

## 현재 상태

### HTML (`_includes/footer.html`)
```html
<button onclick="topFunction()" id="topBtn">Top</button>
```

### JS (`/js/top.js`)
- 80% 스크롤 시 버튼 표시
- 클릭 시 `window.scrollTo({ top: 0, behavior: 'smooth' })`
- 스크롤 퍼센티지 계산 로직 있음 (`scrolledPercentage` 변수 존재)

### CSS (`_sass/_base.scss` — `#topBtn`)
- `position: fixed; bottom: 20px; right: 20px; z-index: 99`
- `border-radius: 50%; width: 50px; height: 50px`
- `background-color: var(--color-surface-hover)`
- `color: var(--color-text-primary)`
- 단순 원형 버튼, 텍스트 "Top"만 표시

## 개선 목표
단순 "맨 위로" 버튼에서 블로그 독자를 위한 스마트 보조 UI로 발전.
기획자, 디자이너, 개발자 세 관점에서 UX를 재정의하고 구현할 것.

## 기술 제약
- Jekyll 정적 사이트 (빌드: `bundle exec jekyll build`)
- SCSS (CSS custom properties 기반 다크/라이트 모드, `html.dark-mode` 클래스)
- Vanilla JS (jQuery 사용 가능, `$` 전역)
- 수정 대상 파일: `js/top.js`, `_sass/_base.scss`, `_includes/footer.html`
- 기존 `#topBtn` ID 유지 (top.js 호환)
- `prefers-reduced-motion` 존중
- 모바일 반응형 필수

## 디자인 토큰 참고
```
--color-interactive: #1d4ed8 (light) / #669DFD (dark)
--color-surface: #FFFFFF (light) / #1E1F22 (dark)
--color-surface-hover: #f8f8fb (light) / rgba(255,255,255,0.04) (dark)
--color-border: #d0d0d0 (light) / #636e72 (dark)
--color-text-primary: rgba(0,0,0,0.84) (light) / #F5F5F5 (dark)
--color-text-tertiary: #8A93A5
--color-accent: #669DFD
```
