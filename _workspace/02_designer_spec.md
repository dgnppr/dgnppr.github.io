# Designer Spec: 3D Knowledge Graph (Three.js)

> 2D `js/knowledge-graph.js`의 동작(살아있는 D3 force sim, gentle float FLOAT_ALPHA=0.003, 드래그→따라옴→놓으면 float, 클릭→엣지 catColor 하이라이트+비연결 dim, 배경 클릭→해제)을 **그대로 유지**하고 Z축 공간감만 더한다. 태그 없음. 카테고리 10 + 문서 25.
> 좌표계: D3 sim은 x/y만 계산 → z는 노드 타입별 고정값 + float로 부여. CAT_COLOR 팔레트 유지.

## 1. 노드 크기 (sphere 반경, world units ≈ px)
| 종류 | 반경 | 비고 |
|------|------|------|
| 카테고리 | `12` | degree 무관 고정, 큰 구체 |
| 문서 | `5 + sqrt(degree)*1.5`, clamp `[5, 9]` | 작은 구체 |
| segments | `24×24` (cat) / `16×16` (doc), 모바일 `16/12` | |

## 2. Z축 분포 (Three.js units, sim x/y는 ±400 범위)
- 카테고리: 전면 레이어 `z ∈ [+40, +90]` — 인덱스 결정적 분산 `40 + (i % 5)*12`
- 문서: 후면 레이어 `z ∈ [-110, -20]` — `slug` 해시 기반 결정적, 소속 카테고리보다 항상 뒤
- 레이어 간 최소 갭 `100` → 카테고리가 "앞에 떠 있는" 원근감

## 3. 공간감 연출
- **Fog**: `THREE.Fog(bg, 320, 920)` — near 320 페이드 시작, far 920 소멸 (후면 깊이감)
- **Camera**: `PerspectiveCamera(fov 55, near 1, far 2000)`, 초기 `position (0, 60, 560)`, `lookAt(0,0,-30)` — 약 7° 하향 틸트
- **OrbitControls**: `enableDamping(0.08)`, `autoRotate 0.25`(유휴 6s 후), `minDistance 260 / maxDistance 900`
- **조명**: `AmbientLight(0xffffff, 0.55)` + `DirectionalLight(0xffffff, 0.8)` at `(120,200,300)` + 중앙 `PointLight(accent, 0.4)`

## 4. 라벨 (CSS2DRenderer, `.kg3d-label`)
| | font-size / weight | color (dark / light) | background |
|---|---|---|---|
| 카테고리 `--cat` | `12px / 700` | `#ffffff` / `#0f172a` | dark `rgba(13,17,23,.55)` · light `rgba(248,250,252,.65)`, round 4px, pad `1px 5px` |
| 문서 `--doc` | `9.5px / 500` | `#cbd5e1` / `#475569` | none (text-shadow only) |
- **text-shadow**: `0 0 4px {bg}, 0 0 8px {bg}` ({bg}=dark `#0d1117` / light `#f8fafc`) — 모든 깊이서 가독
- depth 페이드: fog far 근처 라벨 `opacity→0.25`, 화면 뒤(occluded) `opacity 0.4`

## 5. 하이라이트 (노드 클릭 시)
- 선택 노드: scale `×1.5`, emissiveIntensity `0.9`, 글로우 스프라이트 on
- 이웃 노드: opacity `1.0` 유지, 라벨 표시
- 비연결 노드: opacity → **`0.06`** (DIM_OPACITY), 라벨 `opacity 0`
- 엣지: 연결 = `catColor`(선택 노드 카테고리), 비연결 = dim
- 배경 클릭: 전체 복원 + autoRotate 재개

## 6. 글로우 (Sprite, additive blending)
- 스프라이트 크기 = 노드 반경 `×2.6`
- opacity: 평상시 `0.12`(cat) / `0.0`(doc), 선택 `0.55`, 이웃 `0.18`
- 색상 = `catColor`; 라이트 테마에선 opacity `×0.6`

## 7. 부유 애니메이션 (gentle float, sim 위에 가산)
- amplitude: 카테고리 `[2, 4]`, 문서 `[3, 6]` units (sin 합성, x/y/z 독립 위상)
- speed: `[0.0003, 0.0008]` rad/ms (노드별 인덱스 위상 오프셋)
- sim `alphaTarget = FLOAT_ALPHA(0.003)` 유지 → 살아있는 미동, 드래그 시 `0.3` restart 후 복귀

## 8. 링크 (LineSegments)
| 상태 | dark | light |
|------|------|-------|
| default opacity | `0.22` | `0.13` |
| highlighted | `catColor`, opacity `0.9`, width `2` | 동일 |
| dim opacity | `0.03` | `0.02` |
- 3D 직선(곡선 불필요), 기본 width 1, fog로 후면 링크 자연 감쇠
