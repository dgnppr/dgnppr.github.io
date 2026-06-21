# Designer Spec: 코드 블록 Mac 창 스타일

## 0. 목표

블록 코드(fenced code block)에 macOS 터미널/에디터 창 스타일을 적용한다.
- 상단 헤더 바 + 좌측 트래픽 라이트 3개(빨강 `#FF5F57` / 노랑 `#FFBD2E` / 초록 `#28C840`)
- 창처럼 보이는 라운드 코너 + 헤더/본문 분리 + 미세 그림자
- 라이트/다크 모드 각각 색상 명세
- **인라인 코드(`code`)에는 영향 없음** — 헤더는 블록 래퍼에만 부착
- 마크업(Liquid) 수정 없이 **순수 SCSS**로 구현 (Rouge 출력 DOM에 가상요소 부착)

---

## 1. 현재 DOM 구조 (Kramdown + Rouge)

`_config.yml`: `markdown: kramdown`, `syntax_highlighter: rouge` (line_numbers 미사용).
Rouge 기본 출력은 다음과 같다:

```
div.highlight
  └ pre.highlight
      └ code
          └ span.k / span.s / ...   (하이라이트 토큰)
```

- **블록 코드** = `div.highlight` 가 래퍼 → 여기에 헤더를 붙인다.
- **인라인 코드** = `code.language-plaintext.highlighter-rouge` (래퍼 없음) → 영향 없음.

### 현재 `_code.scss` 구조 (변경 전 파악)

| selector | 역할 | 현 상태 |
|----------|------|---------|
| `code` (L7) | 인라인 코드 | `--color-surface-code` 배경, padding 2/4, radius 5 |
| `pre` (L20) | 블록 코드 본문 | 하드코딩 `#1E1E1E` 배경, `#3F3F46` 보더 — **다크 고정** |
| `pre code` (L29) | 블록 내부 code | 배경/색 `$default-font-color`로 덮어씀 |
| `div.highlight` (L35) | 블록 래퍼 | font-size 0.9em, line-height 1.6 만 지정 |
| `.highlight .xx` (L41~) | 토큰 색상 | VS Code Dark 팔레트 하드코딩 |

**핵심 사실**: 코드창은 라이트/다크 모두 다크 배경(`#1E1E1E`)으로 고정되어 있다. → 본 스펙은 **코드창을 항상 다크로 유지(A안)** 하고 **Mac 헤더만 모드별 대응**한다. 토큰 팔레트 분기는 별도 작업(§7).

---

## 2. Mac 창 스타일 레이아웃

```
┌─────────────────────────────────┐
│  ● ● ●                           │  ← 헤더 바 (높이 36px)
├─────────────────────────────────┤
│  $ code line 1                   │  ← pre 본문 (다크)
│    code line 2                   │
└─────────────────────────────────┘
```

| 항목 | 값 |
|------|-----|
| 컨테이너(`div.highlight`) | `border-radius: 10px`, `overflow: hidden`, `1px` 보더, 미세 그림자, `position: relative` |
| 헤더 바 높이 | `36px` (데스크탑) / `30px` (모바일) |
| 트래픽 라이트 지름 | `12px` (데스크탑) / `10px` (모바일) |
| 원 간격 | `8px` |
| 헤더 좌측 패딩 | `16px` |

### 헤더 구현 방식 — 마크업 무수정

추가 마크업이 불가능하므로 `div.highlight::before` 단일 가상요소에 **multiple `radial-gradient`** 로 헤더 바 + 트래픽 라이트 3개를 한 번에 그린다.

```scss
div.highlight::before {
  content: "";
  display: block;
  height: 36px;
  background:
    radial-gradient(circle 6px at 22px 18px, #FF5F57 98%, transparent 100%),
    radial-gradient(circle 6px at 42px 18px, #FFBD2E 98%, transparent 100%),
    radial-gradient(circle 6px at 62px 18px, #28C840 98%, transparent 100%),
    var(--code-header-bg);
  background-repeat: no-repeat;
  border-bottom: 1px solid var(--code-header-border);
}
```

> `circle 6px` = 반지름 6px → 지름 12px. 중심 y=18px (헤더 36px 수직 중앙). x = 22/42/62 → 간격 20px (원 12 + gap 8), 좌측 여백 16px(원 중심 22 = 16 + 반지름 6).

---

## 3. 색상 명세 (라이트 / 다크)

### 트래픽 라이트 (양 모드 공통, SCSS에 직접 기입)

| 버튼 | HEX |
|------|-----|
| 닫기(빨강) | `#FF5F57` |
| 최소화(노랑) | `#FFBD2E` |
| 최대화(초록) | `#28C840` |

### 신규 토큰 — `css/main.scss` 의 `:root` / `html.dark-mode`

| 토큰 | 라이트 (`:root`) | 다크 (`html.dark-mode`) | 용도 |
|------|------------------|--------------------------|------|
| `--code-header-bg` | `#EAEAEB` | `#323233` | 헤더 바 배경 |
| `--code-header-border` | `#D8D8DA` | `#3F3F46` | 헤더 하단 구분선 |
| `--code-window-border` | `var(--color-border)` (`#d0d0d0`) | `#3F3F46` | 창 외곽선 |

> 코드 본문 배경(`#1E1E1E`)과 텍스트(`#fafafa`)는 기존 `_code.scss` 값 유지(A안). 헤더만 토큰으로 모드 전환.

---

## 4. SCSS 구현 가이드 (변경 Delta)

### 4.1 `css/main.scss` — 토큰 추가

`:root` 블록 끝(L54 `--color-overlay` 다음)에 추가:

```scss
    /* 코드창 Mac 스타일 — 트래픽 라이트는 _code.scss에서 직접 처리 */
    --code-header-bg:     #EAEAEB;
    --code-header-border: #D8D8DA;
    --code-window-border: var(--color-border);
```

`html.dark-mode` 블록 끝(L88 `--color-overlay` 다음)에 추가:

```scss
    --code-header-bg:     #323233;
    --code-header-border: #3F3F46;
    --code-window-border: #3F3F46;
```

### 4.2 `_code.scss` — 변경 Delta

| # | selector | 변경 |
|---|----------|------|
| 1 | `div.highlight` (L35) | `position: relative` 추가, `border-radius: 10px`, `overflow: hidden`, `border: 1px solid var(--code-window-border)`, `margin: 1.2em 0` 추가. (font-size/line-height 유지) |
| 2 | `div.highlight::before` | **신규** — §2 헤더 바 + 트래픽 라이트 |
| 3 | `pre` (L20) | **`border` 제거**(외곽선이 래퍼로 이동). `div.highlight` 하위 `pre`는 `margin: 0; border: 0; border-radius: 0` 로 한정. 배경/패딩/색은 유지 |
| 4 | `pre code` (L29) | 변경 없음 |
| 5 | `code` (L7, 인라인) | 변경 없음 — 헤더가 `div.highlight`에만 부착되므로 자동 격리 |

#### 구현 예시 (핵심)

```scss
div.highlight {
  position: relative;
  font-size: 0.9em;
  line-height: 1.6;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--code-window-border);
  margin: 1.2em 0;

  &::before {
    content: "";
    display: block;
    height: 36px;
    background:
      radial-gradient(circle 6px at 22px 18px, #FF5F57 98%, transparent 100%),
      radial-gradient(circle 6px at 42px 18px, #FFBD2E 98%, transparent 100%),
      radial-gradient(circle 6px at 62px 18px, #28C840 98%, transparent 100%),
      var(--code-header-bg);
    background-repeat: no-repeat;
    border-bottom: 1px solid var(--code-header-border);
  }

  pre {
    margin: 0;
    border: 0;
    border-radius: 0;
    /* 기존 padding 15px / background #1E1E1E / color #fafafa 유지 */
  }
}
```

> **주의**: 기존 `pre` 규칙(L20)의 `border: 1px solid #3F3F46` 줄을 삭제한다(외곽선 중복 방지). `div.highlight` 밖의 단독 `<pre>`(raw HTML, 드묾)는 기존 배경만 유지되고 헤더는 안 생긴다 — 의도된 동작.

---

## 5. 모바일 반응형

```scss
@media (max-width: 480px) {
  div.highlight {
    border-radius: 8px;

    &::before {
      height: 30px;
      background:
        radial-gradient(circle 5px at 18px 15px, #FF5F57 98%, transparent 100%),
        radial-gradient(circle 5px at 36px 15px, #FFBD2E 98%, transparent 100%),
        radial-gradient(circle 5px at 54px 15px, #28C840 98%, transparent 100%),
        var(--code-header-bg);
      background-repeat: no-repeat;
    }
    pre { padding: 12px; }
    font-size: 0.82em;
  }
}
```

- 헤더 30px, 원 지름 10px(반지름 5px), 중심 y=15px, x=18/36/54(간격 18).
- **가로 스크롤**: `pre { overflow-x: auto }` 유지. 헤더는 `div.highlight`에 고정 → 본문만 스크롤되고 헤더는 함께 밀리지 않음(검증 항목).

---

## 6. 접근성 (WCAG AA)

| 항목 | 처리 |
|------|------|
| 트래픽 라이트 | 순수 장식(가상요소, 정보 전달 X) → 대비/스크린리더 대상 아님 |
| 코드 텍스트 대비 | `#fafafa` on `#1E1E1E` ≈ 16:1 — AA 충족 |
| 헤더 구분선 | 시각 보조용, 정보 아님 |
| reduced-motion | 정적 디자인, 애니메이션 없음 → 영향 없음 |
| 다크/라이트 토글 | 헤더 토큰 cascade로 자동 전환, 본문은 항상 다크(의도) |

---

## 7. Frontend 결정/후속 항목

1. **코드창 배경 정책 (기본 A안)**:
   - **A안(채택)**: 코드창 항상 다크, 헤더만 모드 대응. 구현 단순, 토큰 팔레트 무수정.
   - **B안(후속)**: 라이트 모드에서 밝은 코드창(`--code-window-bg: #FBFBFB`, text `#383A42`) + One Light 토큰 팔레트를 `html:not(.dark-mode) .highlight .xx`로 추가. 범위 큼 → 별도 티켓 권장.
2. **언어 라벨 표시**(예: 헤더 우측 `python`): 현재 스코프 제외. 추후 `::before` 우측 영역 or `data-lang` 활용 제안 가능.

---

## 8. 검증 체크리스트 (Frontend 인수 기준)

- [ ] 블록 코드 상단에 헤더 바 + 좌측 3색 원 노출
- [ ] 인라인 `code` 에는 헤더가 생기지 않음
- [ ] 라이트/다크 토글 시 헤더 배경/구분선 전환됨 (본문은 다크 유지)
- [ ] 긴 코드 가로 스크롤 시 헤더 고정(본문만 스크롤)
- [ ] 375~480px 폭에서 헤더/원 레이아웃 정상
- [ ] 라운드 코너로 헤더/본문 깔끔히 클리핑
- [ ] `bundle exec jekyll build` 경고/에러 없음

---

## 9. UI 변경 요청 요약 (Frontend 작업 목록)

| # | 파일 | 변경 |
|---|------|------|
| 1 | `css/main.scss` | `:root` + `html.dark-mode` 에 `--code-header-bg/border`, `--code-window-border` 토큰 추가 (§4.1) |
| 2 | `_sass/_code.scss` | `div.highlight` 에 창 스타일 + `::before` 헤더 추가, `pre` border/margin/radius 정리 (§4.2) |
| 3 | `_sass/_code.scss` | `@media (max-width: 480px)` 반응형 블록 추가 (§5) |
| 4 | — | `bundle exec jekyll build` + 다크/라이트·480px 확인 (§8) |

> `_code.scss`는 `main.scss`에 이미 import됨 → 추가 import 불필요. 트래픽 라이트 색은 모드 공통이므로 토큰화하지 않고 SCSS에 직접 기입.
