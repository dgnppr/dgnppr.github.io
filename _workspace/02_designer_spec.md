# Designer Spec — visited 링크 색상 개선

> 입력: `_workspace/00_input.md`
> 대상: `_sass/_base.scss` (라이트), `_sass/_theme.scss` (다크모드 오버라이드)
> 원칙: 브랜드 보라 패밀리(`$theme-color #47146C`) 유지. 신규 클래스 0개. 색상 값만 교체.

---

## 목표
파스텔한 visited 색상(`#8c8c9e`, `#8899b0`)을 테크 블로그 톤에 맞는 묵직한 보라 계열로 교체. 읽은 상태를 명확히 구분하되 브랜드 컬러와 같은 색상 패밀리를 유지한다.

## 선정 색상

| 모드 | 대상 | 기존 | 신규 | 색상명 |
|------|------|------|------|--------|
| Light | `a:visited` (`_sass/_base.scss:38`) | `#8c8c9e` | **`#6B4A7A`** | Muted Plum (묵직한 자두빛 보라) |
| Dark | `body.dark-mode .post-content a:visited` (`_sass/_theme.scss:148`) | `#8899b0` | **`#9E84B0`** | Dusty Mauve (탁한 모브) |

---

## 선택 근거

### Light mode — `#6B4A7A`
- **톤 방향**: `a:link`의 `$theme-color #47146C`(deep purple)와 동일 hue 패밀리. 명도를 올리고 채도를 낮춘 형제 색으로, "이미 읽음"을 시각적으로 전달하면서 브랜드 정체성 유지.
- **파스텔 탈피**: 기존 `#8c8c9e`는 회색에 가까운 무채색 파스텔이라 보라 테마와 단절됨. `#6B4A7A`는 보라 채도를 유지해 묵직하고 전문적.
- **대비비**:
  - 흰 배경 대비 **7.28:1** → WCAG AA(4.5:1) 통과, AAA(7:1)도 충족.
  - `a:link #47146C` 대비 **1.82:1** → 동일 hue 후보 중 link와 구분이 가장 명확.

### Dark mode — `#9E84B0`
- **톤 방향**: `a:link #C9A6E8`(light purple)에서 명도·채도를 낮춘 dusty mauve. 같은 violet 계열을 유지해 라이트와 일관된 "보라 패밀리" 경험.
- **파스텔 탈피**: 기존 `#8899b0`는 blue-gray라 보라 링크와 색상 패밀리가 어긋남. `#9E84B0`는 모브 톤으로 통일성 확보.
- **대비비**:
  - `#1E1F22` 배경 대비 **5.01:1** → WCAG AA 통과.
  - `a:link #C9A6E8` 대비 **1.58:1** → 밝은 링크 대비 충분히 가라앉아 visited 구분 명확.

---

## WCAG AA 검증 요약

| 색상 | 배경 | 대비비 | AA(4.5:1) | AAA(7:1) |
|------|------|--------|-----------|----------|
| `#6B4A7A` | `#FFFFFF` | 7.28 | 통과 | 통과 |
| `#9E84B0` | `#1E1F22` | 5.01 | 통과 | — |

> 두 색 모두 link 대비 명도가 충분히 떨어져 visited 상태가 한눈에 구분되며, 보라 hue를 유지해 테마 통일감 확보.

---

## SCSS 변경 명세 (Frontend 전달)

### 1. `_sass/_base.scss:37-39`
```scss
a:visited {
    color: #6B4A7A; /* Muted Plum — visited 상태, 브랜드 보라 패밀리 */
}
```

### 2. `_sass/_theme.scss:147-149`
```scss
body.dark-mode .post-content a:visited {
    color: #9E84B0 !important; /* Dusty Mauve — visited 구분, link #C9A6E8와 명확히 구분 */
}
```

---

## Frontend 구현 체크리스트
1. `_sass/_base.scss:38` 색상값 `#8c8c9e` → `#6B4A7A` 교체.
2. `_sass/_theme.scss:148` 색상값 `#8899b0` → `#9E84B0` 교체 (`!important` 유지).
3. 빌드 후 라이트/다크 양쪽에서 (a) visited 링크가 link와 명확히 구분되는지, (b) 파스텔하지 않고 보라 톤인지 확인.

## 변경 파일 요약

| 파일 | 변경 내용 |
|------|-----------|
| `_sass/_base.scss` | `a:visited` 색상 `#8c8c9e` → `#6B4A7A` |
| `_sass/_theme.scss` | `body.dark-mode .post-content a:visited` 색상 `#8899b0` → `#9E84B0` |

신규 CSS 클래스: **0개** (기존 선택자 색상값만 수정).
