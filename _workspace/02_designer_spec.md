# Designer Spec: /wiki/index/ 카드/피드 리디자인

## 1. 목표 요약

`#document-list` 영역을 깔끔한 카드/피드 형태로 리디자인한다. 각 카드는 **제목 + 날짜 + 하위 문서 수 badge**를 노출하고, 호버 시 visual feedback과 다크모드 완전 대응을 제공한다. 기존 `.home-feed` / 태그 페이지(`#tag-collection`)의 시각 언어(system font, slate 메타 컬러, 0.9rem 타이틀)와 일관성을 유지한다.

---

## 2. category.js HTML 구조 개선안

기존 인라인 `style="float: right;"`와 `<span>` 직접 삽입 방식을 시맨틱 클래스 구조로 교체한다. **클래스명은 `wiki-card-*` 네임스페이스로 신규 도입** (기존 `.post-list`/`.post-item`/`.post-link`는 태그 페이지와 공유되므로 충돌 방지).

### 변경 전 (현재 `category.js`)

```js
const title = `<span>${data.title}</span>`
const date = `<div style="float: right;">${updated}</div>`;
const subDoc = (data.children && data.children.length > 0)
  ? `<div class="post-sub-document"> ▸ 하위 문서: ${data.children.length} 개</div>` : '';
const html = `<a href="${data.url}" class="post-link">${title}${date}${subDoc}</a>`;
```

### 변경 후 (요청)

리스트 컨테이너 (현재 L25):

```js
document.getElementById('document-list').innerHTML =
  `<ul class="wiki-card-list">${html}</ul>`;
```

아이템 placeholder (현재 L23):

```js
html += `<li id="child-document-${i}" class="wiki-card-item"></li>`;
```

카드 내부 (현재 L51~60):

```js
const count = (data.children && data.children.length > 0) ? data.children.length : 0;
const badge = count > 0
  ? `<span class="wiki-card-badge" aria-label="하위 문서 ${count}개">${count}</span>`
  : '';

const html =
  `<a href="${data.url}" class="wiki-card-link">` +
    `<div class="wiki-card-main">` +
      `<span class="wiki-card-title">${data.title}</span>` +
      badge +
    `</div>` +
    `<time class="wiki-card-date" datetime="${updated}">${updated}</time>` +
  `</a>`;
document.getElementById(`child-document-${i}`).innerHTML = html;
```

> 인라인 `style` 전면 제거. badge는 "N 개" 텍스트 대신 숫자만 노출하고 의미는 CSS `::before`(↳) + `aria-label`로 보강. `<time>` 시맨틱 태그로 접근성 향상.

### 최종 DOM 구조

```html
<ul class="wiki-card-list">
  <li class="wiki-card-item">
    <a href="..." class="wiki-card-link">
      <div class="wiki-card-main">
        <span class="wiki-card-title">문서 제목</span>
        <span class="wiki-card-badge" aria-label="하위 문서 3개">3</span>
      </div>
      <time class="wiki-card-date" datetime="2026-06-20">2026-06-20</time>
    </a>
  </li>
</ul>
```

---

## 3. 기존 SCSS 정리 (Frontend 작업 지시)

`_sass/_layout.scss:99-107`의 아래 블록은 **제거**한다 (신규 클래스로 대체):

```scss
#document-list .post-list { list-style: none; padding: 0; margin: 0; }
#document-list .post-item { border-bottom: none; }
```

신규 스타일은 **`_sass/_index.scss` 하단에 추가**(홈 피드와 동일 계열이라 응집도 높음). `main.scss`에 이미 `@import`되어 있으므로 추가 import 불필요.

---

## 4. SCSS 명세 (라이트)

> 변수: `$theme-color: #47146C`(딥 퍼플). 홈/태그 페이지는 호버 강조에 블루(`#1d4ed8`, `#669DFD`)를 써왔으므로 **호버 텍스트 강조는 블루 유지**, 카드 좌측 액센트만 테마 퍼플을 절제해서 사용한다.

### 4-1. 리스트 & 아이템

```scss
.wiki-card-list {
    list-style: none;
    padding: 0;
    margin: 0 0 1rem;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.wiki-card-item {
    // gap으로 간격 처리 — 마진/보더 없음
}
```

### 4-2. 카드 링크 (본체)

```scss
.wiki-card-link {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    background: #fff;
    border: 1px solid #eef0f4;
    border-left: 3px solid transparent;
    border-radius: 8px;
    text-decoration: none;
    transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;

    &:link, &:visited {
        color: inherit;
    }

    &:hover {
        background: #f8f9fc;
        border-left-color: $theme-color;   // 좌측 퍼플 액센트 점등
        transform: translateX(2px);

        .wiki-card-title {
            color: #1d4ed8;                 // 홈/태그 페이지와 동일 블루 강조
        }
    }

    &:focus-visible {
        outline: 2px solid #1d4ed8;
        outline-offset: 2px;
    }
}
```

### 4-3. 제목 + 메인 영역

```scss
.wiki-card-main {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;                           // ellipsis 동작 보장
}

.wiki-card-title {
    font-size: 0.92rem;
    font-weight: 500;
    color: #1F303C;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 0.15s ease;
}
```

### 4-4. 하위 문서 수 badge (태그 페이지 `.tag-count` 패턴 차용)

```scss
.wiki-card-badge {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 6px;
    background: #eef2ff;
    border-radius: 9px;
    font-size: 0.7rem;
    font-weight: 600;
    color: $theme-color;
    line-height: 1;

    &::before {
        content: "↳";
        margin-right: 3px;
        font-size: 0.65rem;
        opacity: 0.7;
    }
}
```

### 4-5. 날짜

```scss
.wiki-card-date {
    flex-shrink: 0;
    font-size: 0.78rem;
    color: #94a3b8;
    white-space: nowrap;
}
```

---

## 5. 다크모드 명세 (필수)

> **중요 제약**: `_sass/_theme.scss:60-62`에 `html.dark-mode :not(pre):not(code):not(code *) { color: ... !important; }` 전역 규칙이 존재한다. 다크모드에서 **글자색을 지정하려면 반드시 `!important`** 를 붙여야 전역 규칙을 이긴다. 배경/보더는 `!important` 불필요.

```scss
html.dark-mode {
    .wiki-card-link {
        background: #232428;
        border-color: #303136;
        border-left-color: transparent;

        &:hover {
            background: #2a2b30;
            border-left-color: #669DFD;     // 다크모드 액센트는 블루(퍼플은 어두워 대비 부족)

            .wiki-card-title {
                color: #669DFD !important;
            }
        }
    }

    .wiki-card-title {
        color: #F5F5F5 !important;
    }

    .wiki-card-date {
        color: #6b7685 !important;
    }

    .wiki-card-badge {
        background: #1a2a40;
        color: #93c5fd !important;
    }
}
```

---

## 6. 모바일 반응형

기본 레이아웃이 이미 모바일 친화적(flex + ellipsis). `@media (max-width: 800px)` 미세 조정:

```scss
@media (max-width: 800px) {
    .wiki-card-link {
        padding: 11px 12px;
        gap: 8px;
    }
    .wiki-card-title { font-size: 0.9rem; }
    .wiki-card-date  { font-size: 0.74rem; }
}
```

- 제목이 길면 ellipsis로 잘리고 날짜/badge는 우측 고정 → 375px에서도 줄바꿈 없이 한 줄 유지.
- 카드 패딩 포함 터치 타겟 높이 약 44px 충족(WCAG 2.5.5).

---

## 7. 접근성 (WCAG AA)

| 항목 | 처리 |
|------|------|
| 색 대비 | 제목 `#1F303C` on `#fff` ≈ 13:1 ✓ / 다크 `#F5F5F5` on `#232428` ≈ 14:1 ✓ |
| badge 의미 전달 | 시각은 `↳N`, 스크린리더는 JS `aria-label="하위 문서 N개"` 부여 |
| 시맨틱 | `<time datetime>` 사용, 링크는 `<a>` 유지 |
| 포커스 | `.wiki-card-link:focus-visible`에 outline 명시(섹션 4-2) |
| prefers-reduced-motion | 아래 규칙 추가 |

```scss
@media (prefers-reduced-motion: reduce) {
    .wiki-card-link {
        transition: none;
        &:hover { transform: none; }
    }
}
```

---

## 8. UI 변경 요청 요약 (Frontend 작업 목록)

| 항목 | 파일 | 변경 | 이유 |
|------|------|------|------|
| HTML 구조 교체 | `js/category.js` (L23,25,51-60) | `wiki-card-*` 시맨틱 구조로 재작성, 인라인 style 제거 | 카드 레이아웃 + 접근성 |
| 구 스타일 제거 | `_sass/_layout.scss:99-107` | `#document-list .post-list/.post-item` 블록 삭제 | 신규 클래스로 대체 |
| 신규 카드 스타일 | `_sass/_index.scss` 하단 | 섹션 4 SCSS 추가 | 홈 피드와 응집 |
| 다크모드 | `_sass/_index.scss` 하단 | 섹션 5 SCSS 추가 (`!important` 필수) | 전역 color 규칙 우회 |
| 반응형/접근성 | 동상 | 섹션 6·7 미디어쿼리 추가 | 모바일/WCAG |
| 빌드 검증 | — | `bundle exec jekyll build` 성공 확인 | 배포 가능 상태 |

---

## 9. 디자인 토큰

| 토큰 | 라이트 | 다크 | 용도 |
|------|--------|------|------|
| Card BG | `#fff` | `#232428` | 카드 배경 |
| Card Border | `#eef0f4` | `#303136` | 카드 테두리 |
| Accent (hover) | `$theme-color` `#47146C` | `#669DFD` | 좌측 액센트 |
| Title | `#1F303C` | `#F5F5F5` | 제목 |
| Title Hover | `#1d4ed8` | `#669DFD` | 제목 강조 |
| Date | `#94a3b8` | `#6b7685` | 날짜 메타 |
| Badge BG / FG | `#eef2ff` / `#47146C` | `#1a2a40` / `#93c5fd` | 하위 문서 수 |
