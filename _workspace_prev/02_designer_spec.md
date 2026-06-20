# 02. Designer Spec — 보라색 하드코딩 색상 중립화

## 0. 배경 & 원칙

- 사이트 `$theme-color = #47146C` (보라). 변수 참조는 **건드리지 않음**.
- 태그 pill(`_tag.scss`)은 이미 blue 계열로 교체됨 → **변경 없음**.
- 남은 하드코딩 보라(hex)와 `:visited` 색상이 일관성을 깨고 있음.
- 사용자 핵심 불만: **링크 방문 후 보라색으로 변함** → visited는 보라 제거, 회색으로 미묘하게만 구분.

### 색상 팔레트 (대체 기준)

| 토큰 | hex | 용도 |
|------|-----|------|
| Slate Visited (라이트) | `#7a8290` | 라이트모드 visited 링크 — 본문 글자색(`#4D5667`)보다 살짝 muted |
| Slate Visited (다크) | `#9aa3b2` | 다크모드 visited 링크 |
| Blue Link (다크) | `#669DFD` | 다크모드 일반 링크 (사이트 기존 blue 재사용) |
| Blue Badge | `#669DFD` | index 배지 (기존 type-wiki와 통일) |
| Neutral Highlight BG | `#dbeafe` | `.link-checked` 배경 (blue-100, 기존 태그 톤 재사용) |
| Neutral Highlight FG | `#1e3a8a` | `.link-checked` 글자 (blue-900) |
| Faint Gray Hover | `#f5f5f5` | 메뉴 hover 배경 (보라 틴트 제거) |

> 회색 계열은 slate(`#64748b`~`#94a3b8`) 톤으로 통일하여 기존 blue 태그 시스템과 충돌하지 않게 함.

---

## 1. 변경 대상 (파일별)

### _base.scss
| 위치(line) | 현재 값 | 대체 값 | 용도 |
|---|---|---|---|
| 38 | `#6b5a78` (muted plum) | `#7a8290` | 라이트모드 `a:visited` — 보라 제거, slate-gray |
| 156 | `#BA55D3` (orchid) | `#dbeafe` | `.link-checked` 배경 — blue-100 |
| 155 | `#FFFFFF` | `#1e3a8a` | `.link-checked` 글자 — blue-900 (배경이 밝아져 대비 확보) |
| 160 | `#FFFFFF` | `#1e3a8a` | `.link-checked:visited` 글자 — 동일 |

> 주석 `/* muted plum — visited 상태 */` → `/* slate — visited 상태 */`로 갱신.

### _theme.scss
| 위치(line) | 현재 값 | 대체 값 | 용도 |
|---|---|---|---|
| 145 | `#C9A6E8` (light purple) | `#669DFD` | 다크모드 `.post-content a` 일반 링크 — 사이트 blue |
| 148 | `#9d8aab` (plum-gray) | `#9aa3b2` | 다크모드 `.post-content a:visited` — slate-gray |

> 주석 `/* muted plum-gray — visited 구분용 */` → `/* slate-gray — visited 구분용 */`.

### _site-menu-bar.scss
| 위치(line) | 현재 값 | 대체 값 | 용도 |
|---|---|---|---|
| 168 | `#f8f6ff` (violet tint) | `#f5f5f5` | 검색 결과 항목 hover 배경 — 중립 회색 |
| 182 | `#a78bfa` (violet) | `#669DFD` | `.search-result-type.type-index` 배지 — blue 통일 |

---

## 2. 변경하지 않는 것 (의도적 보존)

| 파일/위치 | 값 | 이유 |
|---|---|---|
| 전 파일 `$theme-color` 참조 | `#47146C` | 변수 — 지침상 보존 |
| `_base.scss:35` `a:link` | `$theme-color` | 변수 참조 (하드코딩 아님) |
| `_tag.scss` 전체 | blue 계열 | 이미 교체 완료 |
| `_code.scss:44,57,78` | `#C586C0`,`#CC99CD` 등 | **VSCode Dark+ 신택스 하이라이트 토큰** — 키워드/연산자 색. 에디터 친숙도 유지 위해 보존 (out-of-scope) |

> `_code.scss`의 보라는 코드 가독성/에디터 일관성 목적이며 링크·UI 보라와 성격이 다름. 변경 시 키워드 색이 어색해지므로 제외.

---

## 3. 검증 체크리스트 (Frontend 인계)

- [ ] 라이트/다크 모드 모두에서 방문한 링크가 **보라가 아닌 회색**으로 표시
- [ ] visited 색이 일반 링크와 구분되되 과하지 않음 (미묘한 muted)
- [ ] `.link-checked` 배경 변경 후 글자 대비 WCAG AA(`#1e3a8a` on `#dbeafe` ≈ 8:1 통과)
- [ ] 다크모드 본문 링크 `#669DFD` 대비 확인 (다크 배경 `#1E1F22` 대비 AA 통과)
- [ ] index 배지(`type-index`)가 type-wiki(`#669DFD`)와 동일 톤 — 의도된 통일인지 확인. 구분 필요 시 `#82b782`(green) 등 대안 검토
- [ ] 검색 결과 hover 배경에 보라 틴트 사라짐
- [ ] 사이트 전역에서 `#6b5a78`,`#BA55D3`,`#C9A6E8`,`#9d8aab`,`#a78bfa`,`#f8f6ff` 잔존 grep 0건
