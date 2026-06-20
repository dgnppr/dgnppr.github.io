# 02. Design Spec — 홈화면 리디자인

> 입력: `00_input.md`, `01_tpo_brief.md`, 현재 스타일(`_sass/_base.scss`·`_theme.scss`·`_layout.scss`·`_index.scss`), 구조(`index.html`·`_layouts/home.html`·`_includes/header.html`)
> 대상 구현자: blog-frontend
> 데이터 검증 완료(§0) — 추측 아님, 실제 frontmatter 확인 결과 반영

---

## 0. 데이터 검증 결과 (TPO 6항 응답)

`_wiki/` 실제 frontmatter를 확인했다.

| 항목 | 확인 결과 | 결정 |
|------|-----------|------|
| `parent` | `parent: [[/jvm]]` 형식. **항상 존재**하나 `[[/x]]` 위키링크 파싱 필요. 디렉터리와 불일치 사례 있음(예: `database/*.md`에 `parent: [[/essay]]`, `springboot/` 디렉터리에 `parent: [[/spring-boot]]`) | **카테고리 소스로 부적합** — 파싱 비용 + 불일치 |
| `tag` | `tag: spring-boot transaction code-analysis` (공백 구분 다중값). public 문서 25개 중 **현재 공란 0개**이나 TPO 경고대로 fallback 필수 | 보조 신호로만 |
| **디렉터리(URL path)** | permalink `/wiki/:path/` → URL 1번째 세그먼트가 항상 카테고리. 14개 디렉터리(`ai-agent`,`java`,`jpa`,`jvm`,`kafka`,`msa`,`system-design`,`data-engineering`,`database`,`design-pattern`,`code-architecture`,`springboot`,`essay`,`retrospect`)가 TPO 4(D) 목록과 정확히 일치 | **카테고리 배지 소스로 채택** — 항상 존재, 파싱 불필요, fallback 안전 |
| `summary` | 대부분 공란 확인 | **요약 미노출** (TPO 6.2 권고 수용) |

→ **카테고리 배지는 `doc.url`에서 디렉터리 세그먼트를 추출**해 표시한다. frontmatter 의존을 피해 "빈 값으로 깨짐"을 원천 차단.

---

## 1. 핵심 결정 (TPO 명시 요청 응답)

### (D) 카테고리 색인 — **불포함 (이번 범위 제외)**
TPO 4(D) 우선순위 MEDIUM, 디자이너 판단 위임. **상단 별도 카테고리 칩 색인 섹션은 넣지 않는다.**
- **이유 1 (스캔성):** TPO 3항 — 홈의 1순위 목적은 "최신성 전달"이며 핵심 경로는 A(최근 글 클릭, 70%). 상단에 14개 칩 색인을 깔면 above-the-fold를 잠식해 최근 글 노출이 밀린다.
- **이유 2 (여정 B 대체 충족):** 카테고리 탐색(여정 B)은 **각 피드 항목의 카테고리 배지**로 충족한다. 배지 자체를 `/wiki/{category}/` 색인 링크로 만들면 별도 색인 섹션 없이 동일한 탐색 경로 + 내부 링크 밀도(SEO 7항)를 확보한다.
- **이유 3 (범위):** TPO 9항 "카테고리 페이지 리디자인 제외"와 정합. 색인 섹션 추가는 별도 작업으로 분리 권고.

> 향후 색인 섹션이 필요하면 피드 상단 `.cat-index` 칩 리스트로 확장 가능(스펙 §7 확장 노트). 이번엔 배지로 갈음.

### above-the-fold 노출 항목 수 — **목표 7개 (모바일 375px 기준)**
TPO 4항 이탈 방지 기준 "5~7개". 행 높이를 역산해 모바일 첫 화면에 **최소 7개 항목**이 스크롤 없이 들어오도록 행 밀도를 설계한다(§4 계산 근거). 전체 렌더 항목 수는 현행 **30개 유지**(TPO 5(B), 6.3 필터 보존).

---

## 2. 레이아웃 후보 평가

| 후보 | 장점 | 단점 | 판정 |
|------|------|------|------|
| A. 카드 그리드 | 임팩트 | 썸네일·요약 없음(§0) → 빈 카드, 여백 과다로 above-the-fold 7개 확보 불가 | 기각 |
| **B. 구분선 리스트 + 카테고리 배지** | 텍스트 중심 최적, 고밀도(7개 충족), 배지로 맥락·탐색 동시 | 임팩트 낮음 → 타이포·hover로 보완 | **채택** |
| C. 타임라인 | 날짜 흐름 강조 | 연/월 그룹핑 Liquid 복잡, 날짜 중복, 밀도↓ | 보류 |
| D. 테이블 | 정렬 명확 | 모바일 반응형 취약, 375px 깨짐 | 기각 |

**결정: B — 불렛 제거 + 행 구분선 리스트 + 제목/카테고리 배지/날짜 정보 계층.**
근거: §0에서 요약·썸네일 부재 확정 → 카드는 빈 슬롯만 남음. 고밀도 행 리스트가 above-the-fold 7개(§1) 및 스캔성(TPO 3) 요구에 부합. 카테고리 배지로 여정 B까지 흡수.

---

## 3. 마크업 스펙 (`index.html`)

Liquid `for`·필터·조건은 보존(TPO 6.3, 8). 카테고리는 `doc.url`의 디렉터리 세그먼트에서 추출.

```liquid
---
layout: home
adsense: false
regenerate: true
---

<div class="home">
    <h1 class="home-heading">최근 문서</h1>
    <ul class="doc-list">
        {% assign documents = site.wiki | sort: 'updated' | reverse %}
        {% for doc in documents limit: 30 %}
        {% if doc.public == true and doc.title != 'wiki' and doc.layout != 'category' %}
            {%comment%} URL: /wiki/{category}/{slug}/ → 2번째 세그먼트가 카테고리 {%endcomment%}
            {% assign url_parts = doc.url | split: '/' %}
            {% assign category = url_parts[2] %}
        <li class="doc-item">
            <a class="doc-link" href="{{ doc.url | prepend: site.baseurl }}">
                <span class="doc-main">
                    {% if category and category != '' %}
                    <span class="doc-cat">{{ category }}</span>
                    {% endif %}
                    <span class="doc-title">{{ doc.title }}</span>
                </span>
                <time class="doc-date" datetime="{{ doc.updated | date_to_xmlschema }}">{{ doc.updated | date: "%Y.%m.%d" }}</time>
            </a>
        </li>
        {% endif %}
        {% endfor %}
    </ul>
    <div class="home-footer">
        {% assign count = site.wiki | where: "public", true | where_exp: "item", "item.layout != 'category'" | size %}
        <a class="view-all" href="/recent/">전체 문서 보기 ({{ count }})</a>
    </div>
</div>
{% include createLink.html %}
```

변경 요점:
1. 클래스 네임스페이스: `post-list`/`post-item`/`post-meta`/`post-link` → `doc-*`. 포스트 스타일 오염 방지 + archive/recent 회귀 분리(TPO 6.4 — 두 페이지가 같은 home 레이아웃이나 `.post-list`를 안 건드리므로 회귀 위험 제거).
2. 카테고리 배지: `doc.url | split: '/'`의 인덱스 2(=디렉터리). frontmatter 무의존 → **빈 값 fallback 자동**(if 가드). 배지는 텍스트 라벨(링크 아님, §1 D 경량화). *프론트엔드 재량으로 `href="/wiki/{{ category }}/"` 부여 시 여정 B 강화 가능 — 권고하나 선택.*
3. 날짜 `%b %d, %Y` → `%Y.%m.%d` (한국어 사이트 수치형, tabular 정렬 안정).
4. `<time datetime>` 시맨틱(TPO 7 접근성).
5. 상단 `<h1>` 경량 섹션 제목(TPO 5A LOW — 1줄 수준).
6. 하단 `.indent`+`<h3>` → `.home-footer > .view-all` 보조 톤 텍스트 링크(TPO 5C: 1차 액션 아님 명확화). 카운트 유지(신뢰 신호).

> **검증 1건 (프론트엔드 빌드 시 확인):** `doc.url` 형식이 `/wiki/{category}/{slug}/`인지 1개 항목 렌더로 확인. 만약 `permalink`가 달라 세그먼트 인덱스가 다르면 `url_parts[2]` 인덱스만 조정. (config상 `permalink: /:collection/:path/` → `/wiki/...` 확정적이나 split 후 leading 빈 문자열 때문에 인덱스 2가 카테고리)

---

## 4. SCSS 스펙 (`_sass/_index.scss`)

기존 `.blog-face`·`.indent`·`.contact`·`.home`는 유지. `.doc-*`·`.home-heading`·`.home-footer`·`.view-all` 신규 추가.

**above-the-fold 7개 역산:** 모바일 뷰포트 375×667, 헤더+`<h1>` ≈ 160px → 가용 ≈ 507px. 507 / 7 ≈ 72px/행. 배지+제목 2줄 가능성 고려해 행 목표 높이 ≈ 64~70px(`padding 13px` + 본문 ~38px). 제목 1줄 항목은 더 들어옴 → 7개 충족.

```scss
/* ── 홈 섹션 제목 (경량) ── */
.home-heading {
    font-size: clamp(1.4rem, 2.4vw, 1.7rem);
    font-weight: 700;
    color: #1F303C;
    margin: 0.4em 0 0.2em;
    padding-bottom: 0.4em;
    border-bottom: 1px solid #ECECEC;
}

/* ── 문서 리스트 ── */
.doc-list {
    list-style: none;   /* 불렛 제거 (TPO 8) */
    margin: 0;
    padding: 0;
}

.doc-item {
    border-bottom: 1px solid #ECECEC;
    &:last-child { border-bottom: none; }
}

.doc-link {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
    padding: 13px 8px;
    text-decoration: none;
    border-radius: 6px;
    transition: background-color 0.15s ease;

    &:hover,
    &:focus-visible {
        background-color: #F5F2F8;   /* theme-color(#47146C) 옅은 틴트 */
        outline: none;
    }
    &:focus-visible {
        box-shadow: inset 0 0 0 2px $theme-color;   /* 키보드 포커스 가시화 (WCAG AA, TPO 8) */
    }
    &:hover .doc-title,
    &:focus-visible .doc-title { color: $theme-color; }
}

.doc-main {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px 8px;
    flex: 1 1 auto;
    min-width: 0;
}

/* ── 카테고리 배지 ── */
.doc-cat {
    flex: 0 0 auto;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: $theme-color;
    background: #F0E9F5;
    padding: 1px 7px;
    border-radius: 10px;
    white-space: nowrap;
    text-transform: lowercase;
}

.doc-title {
    font-size: 1.0rem;
    font-weight: 500;
    line-height: 1.45;
    color: #24303B;
    transition: color 0.15s ease;
}

.doc-date {
    flex: 0 0 auto;
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
    color: #9AA3AF;
    white-space: nowrap;
}

/* ── 하단 CTA (보조 톤) ── */
.home-footer {
    margin-top: 24px;
    text-align: center;
}
.view-all {
    display: inline-block;
    padding: 8px 18px;
    font-size: 0.9rem;
    font-weight: 500;
    color: $theme-color;
    text-decoration: none;
    border: 1px solid #E0D6E8;
    border-radius: 20px;
    transition: background-color 0.15s ease, border-color 0.15s ease;

    &:hover { background-color: #F5F2F8; border-color: $theme-color; }
}

/* ── 모바일: 좁은 화면 제목/날짜 세로 분리 ── */
@media (max-width: 420px) {
    .doc-link { flex-direction: column; align-items: flex-start; gap: 4px; }
    .doc-date { font-size: 0.76rem; }
}
```

> `prefers-reduced-motion` 대응: 모든 transition은 색/배경뿐(레이아웃 이동 없음)이라 모션 민감 사용자에게 무해. 별도 미디어쿼리 불요. (design rule 충족)

---

## 5. 다크모드 스펙 (`_sass/_theme.scss` 말미 추가)

전역 `html.dark-mode :not(pre):not(code):not(code *){ color ... !important }`가 텍스트색을 강제하므로, 강조/서브/배지 구분은 `!important`로 명시 오버라이드.

```scss
/* ── 홈 리스트 다크모드 ── */
html.dark-mode .home-heading {
    color: var(--text-color) !important;   /* #F5F5F5 */
    border-bottom-color: #33363B;
}
html.dark-mode .doc-item { border-bottom-color: #2C2F33; }
html.dark-mode .doc-link:hover,
html.dark-mode .doc-link:focus-visible { background-color: #26282C; }
html.dark-mode .doc-link:focus-visible { box-shadow: inset 0 0 0 2px #93c5fd; }

html.dark-mode .doc-title { color: var(--text-color) !important; }
html.dark-mode .doc-link:hover .doc-title,
html.dark-mode .doc-link:focus-visible .doc-title {
    color: #93c5fd !important;   /* 다크 링크 강조색과 통일 (post-content a:link) */
}
html.dark-mode .doc-date { color: var(--text-sub-color) !important; }   /* #A9A9A9 */

html.dark-mode .doc-cat {
    color: #93c5fd !important;
    background: #23303F;   /* 블루 계열 옅은 다크 배경 */
}
html.dark-mode .view-all {
    color: #93c5fd !important;
    border-color: #2E3A47;
}
html.dark-mode .view-all:hover { background-color: #26282C; border-color: #93c5fd; }
```

---

## 6. 정보 계층 & 가독성 가이드라인

1. **3계층 (TPO 5B 정합):** 제목(1차, 500 weight `#24303B`) > 카테고리 배지(2차 맥락, 0.7rem 칩) + 날짜(2차 서브, 0.8rem muted). 시선 흐름: 배지(맥락 진입)→제목(판단)→날짜(최신성).
2. **above-the-fold 7개:** §4 행 밀도 역산 충족. 제목 짧은 항목은 더 노출.
3. **터치 타깃:** `padding 13px` → 행 ≈ 64px+, iOS HIG 44px 초과.
4. **전체 행 클릭 + 키보드 포커스:** `<a>`가 행 전체 감쌈, `:focus-visible` inset ring로 키보드 가시화(TPO 8 WCAG AA).
5. **날짜 안정성:** `tabular-nums` + `%Y.%m.%d` 고정폭 → 우측 정렬 자릿수 흔들림 없음.
6. **빈 값 fallback:** 카테고리는 URL 파생이라 거의 항상 존재하나, `{% if category %}` 가드로 공란 시 배지 미렌더(제목만 표시) — 깨짐 없음(TPO 6.1, 8).
7. **대비:** 라이트 제목 `#24303B`/`#FFF` ≈ 12:1, 배지 `#47146C`/`#F0E9F5` ≈ 8:1, 날짜 `#9AA3AF`(보조 정보 예외). 다크 제목 `#F5F5F5`/`#1E1F22` ≈ 15:1, 다크 hover/배지 `#93c5fd`/`#1E1F22` ≈ 8:1. (다크 강조색은 사이트 링크 톤 `post-content a:link: #93c5fd`와 통일)

---

## 7. 변경 파일 요약

| 파일 | 변경 |
|------|------|
| `index.html` | 마크업 교체(§3). Liquid 루프·필터 보존, 카테고리 URL 파생, 클래스 `doc-*` |
| `_sass/_index.scss` | `.home-heading`·`.doc-*`·`.doc-cat`·`.home-footer`·`.view-all` 추가. 기존 클래스 유지(§4) |
| `_sass/_theme.scss` | 홈 리스트 다크모드 오버라이드 추가(§5) |

> 신규 색상 변수 도입 없음 — `$theme-color`, `--text-color`, `--text-sub-color` 재활용. 하드코딩 hex는 구분선/배지 배경/틴트 등 보조 톤 한정.
> **(D) 미채택 확장 노트:** 향후 카테고리 색인 필요 시 `.doc-list` 위에 `.cat-index`(14개 칩, `/wiki/{cat}/` 링크) 섹션을 추가하면 됨. 본 스펙 배지 스타일(`.doc-cat`) 재활용 가능.

---

## 8. 빌드 검증 체크리스트 (프론트엔드 인계 — TPO 8 정합)

- [ ] `bundle exec jekyll build` 무에러
- [ ] **`doc.url` 형식 확인** → 카테고리 세그먼트 인덱스(`url_parts[2]`) 정확성 (1개 항목 렌더 검증)
- [ ] 불렛 마커 완전 제거 (TPO 8)
- [ ] 카테고리 배지: 14개 디렉터리명 정상 표시, 공란 항목은 제목만(fallback)
- [ ] 라이트모드: 행 구분선·hover 틴트·제목색 전환 동작
- [ ] 다크모드 토글: 제목/배지/날짜/CTA 대비 정상 (TPO 8)
- [ ] **375px**: above-the-fold 5~7개 항목 노출, 레이아웃 깨짐 없음 (TPO 4·8)
- [ ] 420px 이하: 제목 긴 항목 세로 스택 확인
- [ ] 키보드 Tab 포커스 ring 가시 (WCAG AA, TPO 8)
- [ ] 날짜 우측 정렬 자릿수 안정
- [ ] **archive/recent 회귀** — `.post-list` 미변경이므로 영향 없어야 함 (TPO 6.4)
- [ ] "전체 문서 보기 (N)" → `/recent/` 이동, 카운트 정상
