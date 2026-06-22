# 임베딩 기반 연관 포스트 — 설계 결정 기록

## 배경

기존 지식 그래프는 태그 기반으로 연결을 만들었다. 같은 태그를 가진 글끼리만 연결되므로 의미적으로 유사한 글이 태그가 다르면 연결되지 않는 문제가 있었다. 이를 개선하기 위해 임베딩 기반 유사도로 전환했다.

---

## 모델 선택

**Gemini `text-embedding-004` via Vertex AI**

- 한국어 포함 다국어 지원
- `outputDimensionality` 파라미터로 차원 축소 가능 (API 레벨 지원)
- Vertex AI SA 키 이미 보유

### 차원 결정

| 차원 | 파일 크기 (23개 글) | 비고 |
|------|-------------------|------|
| 768 | ~499KB | 기본값 |
| 128 | ~83KB | 품질 손실 우려 |
| **256** | **~164KB** | **선택** |

128은 품질 저하 가능성이 있어 256으로 확정했다. 글 수가 늘어도 캐시 구조 덕분에 증분 계산만 발생한다.

---

## 스코어링 파이프라인

`scripts/generate-embeddings.js`에서 7개 요소를 조합해 최종 점수를 산출한다.

```
최종 점수 = (임베딩 코사인 × 태그 × 카테고리 × 제목 × 길이 × 날짜) × (1 + BM25_WEIGHT × BM25정규화)
```

### 요소별 상세

| # | 요소 | 방식 | 상수 |
|---|------|------|------|
| 1 | 임베딩 코사인 유사도 | 기준값 | — |
| 2 | 태그 보너스 | 공유 태그 1개당 ×(1 + 0.03) | `TAG_BONUS = 0.03` |
| 3 | 태그 패널티 | 공유 태그 없으면 ×0.90 | `TAG_PENALTY = 0.90` |
| 4 | 카테고리 보너스 | 같은 카테고리(URL 첫 세그먼트)면 ×1.05 | `CAT_BONUS = 0.05` |
| 5 | 제목 키워드 overlap | 공유 키워드 1개당 ×(1 + 0.02) | `TITLE_BONUS = 0.02` |
| 6 | 글 길이 패널티 | 100자 미만 ×0.50, 300자 미만 ×0.90 | `LEN_THRESHOLD = 300` |
| 7 | 발행 시기 근접도 | 90일 이내 ×1.02, 365일 이상 ×0.98 | `DATE_BONUS/PENALTY` |
| 8 | BM25 exact keyword | 최대 +15% 보정 (정규화 후) | `BM25_WEIGHT = 0.15` |

**점수가 1.0을 초과할 수 있다.** 코사인 기반에 보너스를 곱셈으로 쌓기 때문이다. z-score 필터는 절댓값이 아닌 분포 기준으로 동작하므로 문제없다.

**스코어링은 Pairwise 대칭으로 계산한다.** A→B와 B→A를 별도로 계산하지 않고, 하나의 점수를 양방향에서 공유한다. 현재 수식이 대칭적이므로 결과는 동일하되, 구조를 명시적으로 대칭으로 잡아 향후 비대칭 요소 추가 시 혼선을 방지한다.

---

## 임계값 전략

### z-score 단독의 한계

z-score per-article은 "이 글의 유사도 분포에서 상위 몇 %냐"를 본다. 완전히 상대적이라서, 모든 유사도가 낮은 고립 글도 "그나마 덜 어색한" 글과 강제로 연결된다.

```
LLM 글 예시:
  유사도 분포: [0.42, 0.43, 0.45, 0.46, 0.48, 0.52, 0.55]
  mean=0.47, std=0.04 → threshold=0.51
  → 0.52, 0.55 통과 → 실제로는 관련 없는 글과 연결
```

### 채택 전략: z-score + 절대 하한선

```js
const Z_SIGMA   = 1.0;   // 각 글 기준 mean + 1σ 이상
const MIN_SCORE = 0.70;  // 절대 하한선

scores.filter(r => r.score >= threshold && r.score >= MIN_SCORE)
```

- **z-score**: 글마다 자기 분포 기준으로 "유독 강한 관계"만 선택 (자기보정)
- **MIN_SCORE**: 절댓값이 너무 낮으면 z-score를 통과해도 차단

`MIN_SCORE = 0.70` 근거: 현재 코퍼스에서 "의미 있는 연결"의 최솟값이 0.74 수준이었고, 0.70은 여유 마진을 포함한 보수적 하한선이다.

---

## 캐싱 구조

```
data/
  embeddings.json   # 캐시: { slug: { hash: md5, embedding: float[] } }
  related.json      # 출력: { slug: [{ slug, title, url, score }] }
```

- 내용 변경 시(`md5` 불일치)만 API 호출
- `DIMS` 변경 시 자동 재계산 (`cached.embedding.length === DIMS` 검사)
- `--force` 플래그로 전체 강제 재계산 가능

---

## 상수 현황 (2026-06-22 기준)

```js
const TOP_N              = 5;
const DIMS               = 256;
const Z_SIGMA            = 1.0;
const MIN_SCORE          = 0.70;
const TAG_BONUS          = 0.03;
const TAG_PENALTY        = 0.90;
const CAT_BONUS          = 0.05;
const TITLE_BONUS        = 0.02;
const LEN_THRESHOLD      = 300;
const LEN_THRESHOLD2     = 100;
const LEN_PENALTY_FACTOR = 0.90;
const LEN_PENALTY_FACTOR2= 0.50;
const DATE_BONUS         = 1.02;
const DATE_PENALTY       = 0.98;
const BM25_K1            = 1.5;
const BM25_B             = 0.75;
const BM25_WEIGHT        = 0.15;
```

---

## 실행

```bash
make embeddings        # 캐시 활용 (변경 글만 재계산)
make embeddings-force  # 전체 강제 재계산
```

pre-commit hook에 연동되어 있어 `_wiki/` 또는 `_posts/` 아래 `.md` 파일이 스테이징되면 자동 실행된다.
