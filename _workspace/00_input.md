# 요청: 모바일 플로팅 위젯 UX 개선

## 문제
모바일 화면에서 우하단 플로팅 위젯(top-widget)이 화면을 너무 많이 차지함.

## 현재 구조
```
[공유패널(수평 펼침)] [공유버튼] [그래프버튼] [TOP버튼]
```

- 공유패널 열릴 때: 3개 아이템 × 36px + gap = ~120px
- 버튼 3개: ~120px + gap
- 합계: 모바일 375px 화면의 ~72% 차지

## 관련 파일
- `_includes/footer.html` — top-widget HTML
- `_sass/_base.scss` — top-widget SCSS (line 235~358)

## 스택 제약
- Jekyll + LibSass (NOT Dart Sass, `@import`만 사용)
- Vanilla JS (no bundler, no ES modules)
- 기존 데스크탑 동작 유지

## 요청
모바일에서 플로팅 버튼들이 화면을 덜 차지하도록 UX를 개선할 것.
