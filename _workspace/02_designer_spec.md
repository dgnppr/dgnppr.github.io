# Designer Spec: TOP 버튼 → Scroll Progress Ring + Smart Action Widget

## 0. 범위 결정 (MVP)

TPO Brief의 권장 MVP를 채택한다: **P0(1 진행률 ring, 2 조기 TOP) + P1(4 공유)**.
- P1-3(섹션 점프)은 데스크탑 TOC와 기능 중복 + H2 `id` 검증 의존성이 있어 **이번 디자인에서는 펼침 슬롯만 예약**하고 비주얼은 공유 액션 우선.
- 기존 `#topBtn` button 태그는 **유지**하되, ring SVG를 담기 위해 `<div id="topWidget">` 래퍼로 감싼다. `top.js` 호환을 위해 `#topBtn` ID와 `topFunction()`/`scrollFunction()` 시그니처는 보존한다.

핵심 변경 3가지:
1. 원형 버튼 테두리를 **SVG progress ring**으로 교체 (텍스트 "Top" → ↑ 아이콘)
2. 등장 임계값 **80% → 첫 1 viewport(약 1×innerHeight)** 로 완화
3. 표시 전환을 `display:none/block` → **`.is-visible` 클래스 + opacity/scale 트랜지션** 으로 교체

---

## 1. 컴포넌트 구조 (HTML — `_includes/footer.html`)

### 변경 전
```html
<button onclick="topFunction()" id="topBtn">Top</button>
```

### 변경 후
```html
<div id="topWidget" class="top-widget" aria-hidden="true">
  <!-- 펼침 보조 액션 (P1: 공유). 기본 숨김, 위젯 hover/focus 시 노출 -->
  <div class="top-widget__actions">
    <button type="button"
            class="top-widget__action"
            id="shareBtn"
            aria-label="이 글 공유하기">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"
              d="M18 8a3 3 0 1 0-2.83-4M6 12a3 3 0 1 0 0 .01M18 16a3 3 0 1 0-2.83 4M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>
      </svg>
    </button>
  </div>

  <!-- 메인 TOP 버튼 + progress ring. #topBtn / topFunction() 유지 -->
  <button type="button"
          onclick="topFunction()"
          id="topBtn"
          class="top-widget__top"
          aria-label="맨 위로 이동 (읽은 비율 0%)">
    <svg class="top-widget__ring" viewBox="0 0 44 44" width="44" height="44"
         aria-hidden="true" focusable="false">
      <circle class="top-widget__ring-track" cx="22" cy="22" r="20"/>
      <circle class="top-widget__ring-fill"  cx="22" cy="22" r="20"/>
    </svg>
    <svg class="top-widget__arrow" viewBox="0 0 24 24" width="20" height="20"
         aria-hidden="true" focusable="false">
      <path fill="none" stroke="currentColor" stroke-width="2.2"
            stroke-linecap="round" stroke-linejoin="round"
            d="M12 19V5M5 12l7-7 7 7"/>
    </svg>
  </button>
</div>
```

> 기존 `#topBtn` ID·`onclick="topFunction()"` 유지로 `top.js` 회귀 없음. ring/arrow는 SVG로 토큰 `currentColor` 상속. 공유 버튼은 P1 — JS 미구현 시 마크업만 두고 `display:none` 처리 가능(JS에서 토글).

---

## 2. 비주얼 스펙

| 항목 | 값 | 토큰/비고 |
|------|-----|-----------|
| 위젯 컨테이너 | `position: fixed; right: 20px; bottom: 20px; z-index: 99` | safe-area 보정 추가 |
| TOP 버튼 크기 | 44 × 44px | 터치 타깃 최소 44px(WCAG 2.5.5) |
| ring viewBox | `0 0 44 44`, `r=20`, `cx/cy=22` | stroke 2px → 외경 44px |
| ring track stroke | 3px, `var(--color-border)` | 미진행 트랙 |
| ring fill stroke | 3px, `var(--color-interactive)` | 진행분 |
| 표면(배경) | `var(--color-surface)` | 버튼 원형 배경 |
| border-radius | `50%` | 완전 원형 |
| 그림자 | `0 4px 14px rgba(0,0,0,0.15)` (light) / `0 4px 14px rgba(0,0,0,0.45)` (dark) | `--shadow-card`는 너무 강함(64px) → 전용 약식 그림자 |
| 화살표 아이콘 | 20px, `var(--color-text-primary)` → hover 시 `var(--color-interactive)` | stroke `currentColor` |
| 공유 액션 버튼 | 40 × 40px, `var(--color-surface)` 배경, `1px solid var(--color-border)` | 펼침 시 노출 |

---

## 3. Scroll Progress Ring 비주얼 스펙

SVG 두 개의 `<circle>` 중첩. 진행률은 **`stroke-dashoffset`** 으로 표현.

- 반지름 `r = 20` → 둘레 `C = 2πr ≈ 125.66`
- `stroke-dasharray: 125.66`(= C) 고정
- `stroke-dashoffset: C × (1 - p)` , `p`는 0~1 진행률 (`scrolledPercentage / 100`)
  - p=0 → offset 125.66 (빈 ring)
  - p=1 → offset 0 (꽉 찬 ring)
- 시작점을 12시 방향으로: `.top-widget__ring { transform: rotate(-90deg); transform-origin: 50% 50%; }`
- fill 진행은 시계방향

```scss
.top-widget__ring-track,
.top-widget__ring-fill {
    fill: none;
    stroke-width: 3;
}
.top-widget__ring-track { stroke: var(--color-border); }
.top-widget__ring-fill {
    stroke: var(--color-interactive);
    stroke-linecap: round;
    stroke-dasharray: 125.66;          // 2π·20
    stroke-dashoffset: 125.66;         // 초기 0%
    transition: stroke-dashoffset 0.1s linear;  // rAF 갱신과 함께 미세 보간
}
```

> JS는 `ringFill.style.strokeDashoffset = (125.66 * (1 - p)).toFixed(2)` 로 갱신. `aria-label`도 `맨 위로 이동 (읽은 비율 N%)` 으로 동기 갱신(섹션 8).

---

## 4. 상태 정의

| 상태 | 트리거 | 비주얼 |
|------|--------|--------|
| **숨김** | 스크롤 < 1 viewport | `opacity:0; transform: translateY(8px) scale(0.9); pointer-events:none`, `aria-hidden="true"` |
| **등장** | 스크롤 ≥ 1 viewport | `.is-visible`: `opacity:1; transform: translateY(0) scale(1)`, fade+scale 200ms |
| **hover** (위젯) | 마우스 진입 | TOP 버튼 배경 `--color-surface-hover`, 화살표 색 `--color-interactive`, 공유 액션 펼침(`.top-widget__actions` 노출) |
| **active** | 클릭 순간 | TOP 버튼 `transform: scale(0.92)` (95ms) |
| **focus-visible** | 키보드 포커스 | `outline: 2px solid var(--color-accent); outline-offset: 2px` (기존 패턴 재활용) |

> 표시 토글은 **클래스 기반**으로 전환. `top.js`의 `style.display = "block/none"` 코드를 `classList.toggle("is-visible", ...)` 로 교체해야 fade/scale 트랜지션이 동작한다(섹션 8, Frontend 작업).

---

## 5. 다크/라이트 모드 토큰

| 요소 | Light | Dark | 토큰 |
|------|-------|------|------|
| 버튼 배경 | `#fff` | `#1E1F22` | `var(--color-surface)` |
| ring track | `#d0d0d0` | `#636e72` | `var(--color-border)` |
| ring fill | `#1d4ed8` | `#669DFD` | `var(--color-interactive)` |
| 화살표 기본 | text-primary | `#F5F5F5` | `var(--color-text-primary)` |
| 화살표 hover | `#1d4ed8` | `#669DFD` | `var(--color-interactive)` |
| 그림자 | `rgba(0,0,0,0.15)` | `rgba(0,0,0,0.45)` | `html.dark-mode` 분기 |

> 전부 CSS custom property로 처리 → 토큰 cascade로 자동 모드 전환. 하드코딩 색상 금지(TPO 원칙 5). 그림자만 `html.dark-mode .top-widget__top` 으로 명시 오버라이드.

---

## 6. 애니메이션 스펙

| 대상 | duration | easing |
|------|----------|--------|
| 등장 fade+scale | 200ms | `cubic-bezier(0.16, 1, 0.3, 1)` |
| ring 진행 보간 | 100ms | `linear` |
| hover 배경/색 | 150ms | `ease` |
| active scale | 95ms | `ease-out` |
| 공유 액션 펼침 | 200ms | `cubic-bezier(0.16, 1, 0.3, 1)` |

`prefers-reduced-motion` 처리:
```scss
@media (prefers-reduced-motion: reduce) {
    .top-widget,
    .top-widget__top,
    .top-widget__ring-fill,
    .top-widget__actions {
        transition: none !important;
    }
}
```
- ring fill 트랜지션 제거 → offset이 즉시 점프(애니메이션 없음, 값 자체는 정확).
- JS: `topFunction()`은 `prefers-reduced-motion` 시 `behavior:'auto'` 로 분기(섹션 8).

---

## 7. 모바일 반응형 (`@media (max-width: 800px)`)

```scss
@media (max-width: 800px) {
    .top-widget {
        right: max(14px, env(safe-area-inset-right));
        bottom: max(14px, env(safe-area-inset-bottom));
    }
    .top-widget__top { width: 48px; height: 48px; }   // 터치 타깃 ↑
    .top-widget__ring { width: 48px; height: 48px; }
}
```
- 모바일은 터치 타깃을 48px로 확대(엄지 도달성).
- safe-area-inset으로 노치/홈인디케이터 영역 회피.
- 펼침 액션은 **위쪽 방향**(`flex-direction: column-reverse` 또는 actions를 top 버튼 위에 배치) — 하단 safe-area 침범 방지.
- 데스크탑 TOC가 있는 `wiki.html`/`post.html`에서도 위젯은 진행률+TOP만 노출되므로 중복 없음(섹션 점프 미포함).

---

## 8. 접근성 (WCAG AA)

| 항목 | 처리 |
|------|------|
| TOP 버튼 라벨 | `aria-label="맨 위로 이동 (읽은 비율 N%)"` — JS가 진행률과 동기 갱신 |
| 공유 버튼 라벨 | `aria-label="이 글 공유하기"` |
| ring/arrow SVG | `aria-hidden="true" focusable="false"` (장식 요소) |
| 위젯 컨테이너 | 숨김 상태 `aria-hidden="true"`, 등장 시 `false` 로 토글 |
| 키보드 | 두 버튼 모두 `<button>` → Tab 포커스 가능, Enter/Space 동작 |
| 포커스 표시 | `:focus-visible` outline (섹션 4) |
| 색 대비 | ring fill `#1d4ed8` on `#fff` ≈ 5.9:1, 화살표 text-primary ≈ 13:1 — AA 충족 |
| reduced-motion | 애니메이션·smooth scroll 비활성(섹션 6) |
| role | 기본 `button` 시맨틱으로 충분, 추가 role 불요 |

---

## 9. UI 변경 요청 (Frontend 작업 목록)

| # | 항목 | 파일 | 변경 |
|---|------|------|------|
| 1 | HTML 구조 교체 | `_includes/footer.html` | `#topBtn` 단일 button → `#topWidget` 래퍼 + ring SVG + arrow + 공유 액션(섹션 1) |
| 2 | 구 스타일 제거 | `_sass/_base.scss:230-266` | 기존 `#topBtn` 블록 삭제 |
| 3 | 신규 위젯 스타일 | `_sass/_base.scss` 하단 | `.top-widget*` SCSS 추가(섹션 2~7) |
| 4 | 표시 토글 교체 | `js/top.js` | `style.display` → `classList.toggle('is-visible', ...)` + `aria-hidden` 동기 |
| 5 | 임계값 완화 | `js/top.js` | `> 80` → `scrollTop > window.innerHeight` (첫 1 viewport) |
| 6 | ring 갱신 | `js/top.js` | `scrolledPercentage` → `ringFill.strokeDashoffset` 갱신, `aria-label` 동기, **rAF/throttle** 적용(현 raw scroll 개선) |
| 7 | reduced-motion 스크롤 | `js/top.js` | `topFunction()`에서 matchMedia 분기 → `behavior:'auto'` |
| 8 | 공유 동작(P1) | `js/top.js` | `#shareBtn`: `navigator.share` 지원 시 네이티브, 미지원 시 클립보드 복사 fallback |
| 9 | 빌드 검증 | — | `bundle exec jekyll build` 성공 + 다크/라이트·375px 확인 |

> 신규 SCSS는 `_sass/_base.scss` 하단에 추가(기존 `#topBtn`이 거기 있었으므로 응집). `main.scss`에 이미 import됨 → 추가 import 불필요.

---

## 10. SCSS 구현 명세 (Frontend가 바로 사용)

```scss
/* === Scroll Progress Ring + Smart Action Widget === */
.top-widget {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 99;
    display: flex;
    flex-direction: column-reverse;   // 액션이 TOP 버튼 위로 펼쳐짐
    align-items: center;
    gap: 10px;
    opacity: 0;
    transform: translateY(8px) scale(0.9);
    pointer-events: none;
    transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1),
                transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);

    &.is-visible {
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: auto;
    }
}

.top-widget__top {
    position: relative;
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    outline: none;
    border-radius: 50%;
    background: var(--color-surface);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
    cursor: pointer;
    transition: background 0.15s ease, transform 0.095s ease-out;

    &:hover { background: var(--color-surface-hover); }
    &:active { transform: scale(0.92); }
    &:focus-visible {
        outline: 2px solid var(--color-accent);
        outline-offset: 2px;
    }
}

.top-widget__ring {
    position: absolute;
    inset: 0;
    transform: rotate(-90deg);
    transform-origin: 50% 50%;
}
.top-widget__ring-track,
.top-widget__ring-fill {
    fill: none;
    stroke-width: 3;
}
.top-widget__ring-track { stroke: var(--color-border); }
.top-widget__ring-fill {
    stroke: var(--color-interactive);
    stroke-linecap: round;
    stroke-dasharray: 125.66;
    stroke-dashoffset: 125.66;
    transition: stroke-dashoffset 0.1s linear;
}

.top-widget__arrow {
    position: relative;
    color: var(--color-text-primary);
    transition: color 0.15s ease;
}
.top-widget__top:hover .top-widget__arrow { color: var(--color-interactive); }

/* 펼침 액션 (P1: 공유) — 기본 숨김, 위젯 hover/focus-within 시 노출 */
.top-widget__actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    opacity: 0;
    transform: translateY(6px) scale(0.9);
    pointer-events: none;
    transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1),
                transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.top-widget:hover .top-widget__actions,
.top-widget:focus-within .top-widget__actions {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
}

.top-widget__action {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--color-border);
    border-radius: 50%;
    background: var(--color-surface);
    color: var(--color-text-primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;

    &:hover { background: var(--color-surface-hover); color: var(--color-interactive); }
    &:focus-visible {
        outline: 2px solid var(--color-accent);
        outline-offset: 2px;
    }
}

html.dark-mode {
    .top-widget__top   { box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45); }
    .top-widget__action { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4); }
}

@media (max-width: 800px) {
    .top-widget {
        right: max(14px, env(safe-area-inset-right));
        bottom: max(14px, env(safe-area-inset-bottom));
    }
    .top-widget__top,
    .top-widget__ring { width: 48px; height: 48px; }
}

@media (prefers-reduced-motion: reduce) {
    .top-widget,
    .top-widget__top,
    .top-widget__ring-fill,
    .top-widget__actions {
        transition: none !important;
    }
}
```

---

## 11. 디자인 토큰 요약

| 토큰 | Light | Dark | 용도 |
|------|-------|------|------|
| `--color-surface` | `#fff` | `#1E1F22` | 버튼 배경 |
| `--color-surface-hover` | `#f8f8fb` | `rgba(255,255,255,0.04)` | hover 배경 |
| `--color-border` | `#d0d0d0` | `#636e72` | ring track / 액션 보더 |
| `--color-interactive` | `#1d4ed8` | `#669DFD` | ring fill / hover 강조 |
| `--color-text-primary` | `rgba(0,0,0,0.84)` | `#F5F5F5` | 화살표 기본 |
| `--color-accent` | `#669DFD` | `#669DFD` | focus outline |
