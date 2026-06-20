# 작업 요청: /wiki/index/ 페이지 디자인 개선

## 요청 유형
UI 개선 (포스트 작성 아님)

## 현재 구조
- layout: category → document.html → default.html
- `category.js`가 `#document-list`에 동적 렌더링
- 렌더링 HTML 구조:
  ```html
  <div id="document-list">
    <ul class="post-list">
      <li id="child-document-N" class="post-item">
        <a href="..." class="post-link">
          <span>title</span>
          <div style="float: right;">YYYY-MM-DD</div>
          <div class="post-sub-document"> ▸ 하위 문서: N 개</div>
        </a>
      </li>
    </ul>
  </div>
  ```
- 현재 CSS: list-style: none, border 없음 (이전 세션에서 적용)
- `category.js`는 JS 파일로 동적 렌더링 (HTML/Liquid 템플릿 직접 수정 불가)

## 목표
- 깔끔하고 모던한 카드/피드 형태로 리디자인
- 각 항목: 문서 제목 + 날짜 + 하위 문서 수 badge
- 호버 시 visual feedback
- 다크 모드 완전 지원
- Jekyll 정적 사이트, 순수 SCSS/JS (프레임워크 없음)

## 제약
- `category.js`의 JS 로직(fetch, DOM 구조) 수정 가능하나 기존 `.post-list / .post-item / .post-link` 클래스명은 변경해도 됨
- `_sass/` SCSS 파일 수정 주요 대상
- JS에서 HTML 구조를 개선하려면 `category.js` 수정 가능
- 빌드: `bundle exec jekyll build` 성공 필수

## 참고 파일
- `js/category.js`
- `_layouts/category.html`
- `_layouts/document.html`
- `_sass/_tag.scss` (태그 페이지 문서 목록 참고)
- `_sass/_index.scss` (홈 피드 참고)
- `_sass/_layout.scss`
