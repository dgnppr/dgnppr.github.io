# 디자이너 스펙 — 지식 그래프 모달 카테고리 패널 개선

## 1. 요약

카테고리 패널을 **우측 사이드(width:190px)** → **모달 하단 footer**로 이동시키고,
각 카테고리 아이템을 **태그 칩(pill)** 형태로 재설계한다. 그래프 영역(`__graph`)이 가로 전체를 차지해 더 넓어진다.

블로그 디자인 시스템 토큰(`--color-surface`, `--color-border`, `--color-text-*`)을 사용해
검색 모달(`_site-menu-bar.scss`)과 시각적 일관성을 유지한다.

---

## 2. 레이아웃 변경

### 2-1. 모달 본문 구조 변경

기존(`row` 분할):
```
.kg-modal__body (flex row)
  ├── .kg-modal__graph (flex:1)
  └── .kg-modal__panel (width:190px, border-left)   ← 제거
```

변경(`column` 적층):
```
.kg-modal (flex column)
  ├── .kg-modal__header   (검색 + 닫기, 기존 유지)
  ├── .kg-modal__body     → .kg-modal__graph 만 포함 (flex:1, 가로 full)
  └── .kg-modal__footer   ← 신규: 카테고리 칩 영역 (하단 고정)
```

- `__body`는 그래프 전용 컨테이너가 되며 `flex:1`로 남은 높이를 모두 차지한다.
- `__footer`는 `flex-shrink:0`, 상단 구분선(`border-top`), 칩이 많으면 가로로 `flex-wrap`.

### 2-2. footer 영역 스펙

| 속성 | 값 |
|------|-----|
| padding | `10px 14px` (header와 동일 수평 패딩) |
| border-top | `1px solid var(--color-border-subtle)` |
| background | `var(--color-surface)` (모달 배경과 동일) |
| flex-shrink | `0` |
| max-height | `120px` + `overflow-y:auto` (칩 많을 때 대비) |
| scrollbar | 숨김 (`scrollbar-width:none`, `::-webkit-scrollbar{display:none}`) |

footer 내부:
- `.kg-modal__footer-row` — `display:flex`, `align-items:center`, `gap:10px`
  - `.kg-modal__panel-title` (라벨 "카테고리") — 기존 클래스 재활용, `flex-shrink:0`
  - `.kg-modal__groups` (칩 컨테이너) — `display:flex; flex-wrap:wrap; gap:6px; flex:1`
  - `.kg-modal__stats` — 우측 끝 정렬(`margin-left:auto`), 기존 클래스 재활용, `border-top`/`margin-top` 제거

---

## 3. 카테고리 아이템 — 태그 칩(pill) 스타일

### 3-1. HTML 구조 (knowledge-graph.js 변경 명세)

기존 (line 360~365):
```js
var item = document.createElement('label');
item.className = 'gp-item';
item.innerHTML = '<input type="checkbox" checked data-cat="' + cat + '">' +
    '<span class="gp-dot" style="background:' + catColor(cat) + '"></span>' +
    '<span class="gp-name">' + cat + '</span>' +
    '<span class="gp-count">' + catGroups[cat].length + '</span>';
```

변경 후 (체크박스는 유지하되 `.sr-only`로 접근성 확보, label은 button-like pill):
```js
var item = document.createElement('label');
item.className = 'gp-chip';            // gp-item → gp-chip
item.innerHTML = '<input type="checkbox" checked data-cat="' + cat + '" class="gp-chip__input">' +
    '<span class="gp-chip__dot" style="background:' + catColor(cat) + '"></span>' +
    '<span class="gp-chip__name">' + cat + '</span>' +
    '<span class="gp-chip__count">' + catGroups[cat].length + '</span>';
```

- `change` 이벤트 핸들러(line 367~379)와 `groupsEl.appendChild` 로직은 그대로 유지.
- 셀렉터 `input` 은 그대로 `item.querySelector('input')` 사용 가능 (변경 불필요).

### 3-2. 칩 스타일 (.gp-chip)

| 속성 | 값 |
|------|-----|
| display | `inline-flex` |
| align-items | `center` |
| gap | `6px` |
| padding | `4px 10px` |
| border | `1px solid var(--color-border)` |
| border-radius | `999px` (pill) |
| background | `var(--color-surface)` |
| cursor | `pointer` |
| font-size | `0.78rem` |
| line-height | `1` |
| user-select | `none` |
| transition | `opacity 0.15s ease, border-color 0.15s ease, background 0.15s ease` |

`:hover` (체크 상태일 때만 강조):
- `border-color: var(--color-interactive)`

### 3-3. 체크 상태 표현 (체크박스 hidden, label 클래스 토글 없이 `:has()` 사용)

체크박스를 시각적으로 숨기되 접근성을 위해 DOM에는 유지:
```scss
.gp-chip__input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
    pointer-events: none;
}
```

상태별 스타일은 `:has()` 셀렉터로 처리 (별도 JS 클래스 토글 불필요):

| 상태 | 셀렉터 | 스타일 |
|------|--------|--------|
| 체크(활성) | `.gp-chip:has(.gp-chip__input:checked)` | `opacity:1` (기본) |
| 언체크(비활성) | `.gp-chip:has(.gp-chip__input:not(:checked))` | `opacity:0.4; border-style:dashed` |

> `:has()`는 모든 모던 브라우저(2024+) 지원. Jekyll 정적 블로그 + 데스크탑/모바일 최신 브라우저 대상이므로 안전.
> fallback이 필요하면 frontend가 JS에서 `item.classList.toggle('is-off', !checked)`를 추가하고 `.gp-chip.is-off` 로 대체 가능.

### 3-4. 칩 내부 요소

`.gp-chip__dot`:
- `width:8px; height:8px; border-radius:50%; flex-shrink:0;`
- 배경색은 인라인 스타일(`catColor`)로 주입됨 — 유지.

`.gp-chip__name`:
- `color: var(--color-text-primary); font-weight:500;`
- `white-space:nowrap;`

`.gp-chip__count`:
- `font-size:0.68rem;`
- `color: var(--color-text-tertiary);`
- `background: var(--color-surface-muted);`
- `border-radius:999px; padding:1px 6px; line-height:1.4;`
- `flex-shrink:0;`

### 3-5. focus 접근성 (키보드 탐색)

체크박스가 숨겨져 있으므로 포커스 링을 칩에 표시:
```scss
.gp-chip:has(.gp-chip__input:focus-visible) {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
}
```

---

## 4. 그래프 영역 변경

- `.kg-modal__graph`: 기존 스타일 유지. footer가 column으로 분리되므로 자동으로 가로 full-width가 됨.
- 우측 `border-left` 제거됨(패널 삭제로 자연 소멸).

---

## 5. 다크 모드

모든 색상이 `--color-*` 토큰 기반이라 다크 모드 자동 대응.
검증 포인트:
- 언체크 칩의 `opacity:0.4`가 다크 배경에서도 충분히 구분되는지 — `border-style:dashed`가 보조 신호 역할.
- `--color-surface-muted`(다크: `#2b2d30`) 위 count 뱃지 가독성 확인.

---

## 6. 모바일 반응형 (max-width: 600px 제안)

| 속성 | 데스크탑 | 모바일 |
|------|----------|--------|
| `.kg-modal__footer` max-height | 120px | 90px |
| `.gp-chip` font-size | 0.78rem | 0.72rem |
| `.gp-chip` padding | 4px 10px | 3px 8px |
| `.kg-modal__panel-title` | 표시 | 표시 유지(짧으므로) |
| `.kg-modal__stats` | 우측 정렬 | `flex-basis:100%`로 줄바꿈 허용 가능 |

`prefers-reduced-motion`: 기존 `.kg-modal-overlay, .kg-modal` 규칙에 더해 `.gp-chip { transition:none }`도 포함 권장.

---

## 7. SCSS 변경 요약 (`_sass/_layout.scss`)

### 제거/수정
- `&__panel` (width:190px, border-left) — **제거**
- `&__body` — `overflow:hidden` 유지하되 자식이 graph 하나뿐
- `&__panel-title`, `&__groups`, `&__stats` — footer-row 내부용으로 조정 (위 2-2 참고)

### 신규 추가
- `&__footer`, `&__footer-row`
- `.gp-chip` 및 `.gp-chip__input / __dot / __name / __count`
- `:has()` 기반 상태/포커스 규칙

---

## 8. JS 변경 요약 (`js/knowledge-graph.js`)

- line 358~381 패널 생성 블록의 클래스명만 `gp-item` → `gp-chip` 체계로 변경 (3-1 참고).
- `change` 핸들러, `appendChild`, 그래프 토글 로직은 **변경 없음**.
- `groupsEl` 컨테이너 자체는 footer 내부 `.kg-modal__groups`로 이동(HTML 마크업 위치 변경, JS 참조 ID 동일).

---

## 9. HTML 마크업 변경 (`_layouts/wiki.html` 모달 구조)

`__panel`을 `__body` 밖으로 빼서 `__footer`로 재배치:

```html
<div class="kg-modal">
  <div class="kg-modal__header"> ... 검색 + 닫기 ... </div>
  <div class="kg-modal__body">
    <div class="kg-modal__graph" id="graph-canvas"></div>
  </div>
  <div class="kg-modal__footer">
    <div class="kg-modal__footer-row">
      <span class="kg-modal__panel-title">카테고리</span>
      <div class="kg-modal__groups" id="graph-groups"></div>
      <span class="kg-modal__stats" id="graph-stats"></span>
    </div>
  </div>
</div>
```

(검색 input id `graph-search`는 header에 그대로 둠 — JS 참조 동일.)

---

## 10. 구현 우선순위

1. SCSS: `__footer` 레이아웃 + `.gp-chip` 칩 스타일 (7번)
2. HTML: wiki.html 모달 구조 재배치 (9번)
3. JS: 클래스명 변경 (8번)
4. 다크/모바일 검증 (5,6번)
