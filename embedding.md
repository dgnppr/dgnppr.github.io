# 임베딩 기반 연관 포스트 — 설계 결정 기록

## 배경

기존 지식 그래프는 태그 기반으로 연결을 만들었다. 같은 태그를 가진 글끼리만 연결되므로 의미적으로 유사한 글이 태그가 다르면 연결되지 않는 문제가 있었다. 이를 개선하기 위해 임베딩 기반 유사도로 전환했다.

---

## 모델 선택

`EMBEDDING_BACKEND` 환경변수로 백엔드를 전환할 수 있다.

| 백엔드 | 모델 | 차원 | 실행 조건 |
|--------|------|------|----------|
| `vertexai` (기본) | `text-embedding-004` | 768 | GCP 서비스 계정 필요 |
| `ollama` | `bge-m3` | 1024 | Ollama 로컬 서버 필요 |

두 백엔드의 캐시(`data/embeddings.json`)는 차원 수가 달라 자동으로 구분된다. 백엔드를 바꾸면 `cached.embedding.length !== DIMS` 검사에 걸려 전체 재계산이 발생한다.

### Vertex AI (`text-embedding-004`)

- 한국어 포함 다국어 지원
- `outputDimensionality` 파라미터로 차원 축소 가능

### Ollama (`bge-m3`)

- 로컬 실행 — API 비용 없음
- 한국어 포함 다국어 지원 (MTEB 다국어 상위권)
- 1024차원 고정

### 차원 결정 (vertexai)

| 차원 | 비고 |
|------|------|
| 128 | 품질 손실 우려 |
| 256 | 구버전 선택값 |
| **768** | **현재 선택** |

초기에는 파일 크기를 이유로 256을 선택했으나, 한국어 기술 문서에서 차원 압축 손실이 우려되어 768로 상향했다.

---

## 스코어링 파이프라인

`scripts/generate-embeddings.js`에서 **가중합** 방식으로 최종 점수를 산출한다.

```
score = 0.70 × semantic + 0.20 × keyword + 0.10 × tag
      + cat_bonus + title_bonus          (가산 소프트 보너스)
```

임계값(z-score + MIN_SCORE)을 통과한 글은 개수 제한 없이 전부 저장한다.

### 구성 요소

| # | 요소 | 방식 | 가중치/값 |
|---|------|------|----------|
| 1 | 임베딩 코사인 유사도 | 0~1 스케일 | `SEMANTIC_WEIGHT = 0.70` |
| 2 | BM25 키워드 점수 | p99 정규화 후 0~1 클리핑 | `KEYWORD_WEIGHT = 0.20` |
| 3 | 태그 overlap | Jaccard-like: 공유 수 / max(|A|, |B|) | `TAG_WEIGHT = 0.10` |
| 4 | 카테고리 보너스 | 같은 카테고리면 +0.02 (가산) | `CAT_BONUS_ADD = 0.02` |
| 5 | 제목 키워드 보너스 | 공유 키워드 1개당 +0.01, 최대 3개 (가산) | `TITLE_BONUS_ADD = 0.01` |

**하드 필터:** 두 문서 중 짧은 쪽 본문이 100자 미만이면 해당 쌍을 점수 계산에서 제외한다.

### 구 버전과의 비교

| 항목 | 구버전 | 현버전 |
|------|--------|--------|
| 점수 구조 | 7개 인자 곱셈 체인 | 3항 가중합 + 2가산 보너스 |
| 태그 없음 | ×0.90 패널티 | 패널티 없음 (보너스만 유지) |
| BM25 정규화 | global max | 99th percentile |
| 글 길이 처리 | ×0.50 / ×0.90 곱셈 패널티 | 하드 필터(100자 미만 쌍 제외) |
| 날짜 근접도 | ±2% 곱셈 보정 | 제거 |
| 임베딩 차원 | 256 | 768 |

---

## BM25 정규화

```js
// 구버전 — 아웃라이어 1개가 전체를 왜곡
const bNorm = bm25Raw[key] / bm25Max;

// 현버전 — 99th percentile 기준
const bm25Sorted = Object.values(bm25Raw).sort((a, b) => a - b);
const bm25P99    = bm25Sorted[Math.floor(bm25Sorted.length * 0.99)] || 1;
const bNorm      = Math.min((bm25Raw[key] || 0) / bm25P99, 1.0);
```

키워드가 극단적으로 겹치는 쌍 하나가 `max`를 잡으면 나머지 BM25 기여가 0에 수렴하는 문제를 방어한다.

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

---

## 평가

`data/eval.json`에 정답 쌍을 정의하고, 스크립트 실행 시 자동으로 precision@5를 출력한다.

```json
{
  "pairs": [
    { "a": "slug-a", "b": "slug-b", "expected": true },
    { "a": "slug-a", "b": "slug-c", "expected": false }
  ]
}
```

```
[평가] precision@5: 6/7 (85.7%)
[평가] 오탐(false positive): 0개
```

파라미터를 조정할 때마다 precision@5가 오르는지 확인하며 튜닝한다.

---

## 캐싱 구조

```
data/
  embeddings.json   # 캐시: { slug: { hash: md5, embedding: float[] } }
  related.json      # 출력: { slug: [{ slug, title, url, score }] }
  eval.json         # 평가셋: { pairs: [{ a, b, expected, note }] }
```

- 내용 변경 시(`md5` 불일치)만 API 호출
- `DIMS` 변경 시 자동 재계산 (`cached.embedding.length === DIMS` 검사)
- `--force` 플래그로 전체 강제 재계산 가능

---

## 상수 현황 (2026-06-23 기준)

```js
const DIMS            = 768;
const TOP_N           = 5;
const Z_SIGMA         = 1.0;
const MIN_SCORE       = 0.70;
const SEMANTIC_WEIGHT = 0.70;
const KEYWORD_WEIGHT  = 0.20;
const TAG_WEIGHT      = 0.10;
const CAT_BONUS_ADD   = 0.02;
const TITLE_BONUS_ADD = 0.01;
const LEN_MIN         = 100;
const BM25_K1         = 1.5;
const BM25_B          = 0.75;
```

---

## 실행

```bash
# Vertex AI (기본)
make embeddings        # 캐시 활용 (변경 글만 재계산)
make embeddings-force  # 전체 강제 재계산

# Ollama
ollama pull bge-m3
EMBEDDING_BACKEND=ollama node scripts/generate-embeddings.js
EMBEDDING_BACKEND=ollama node scripts/generate-embeddings.js --force
```

pre-commit hook에 연동되어 있어 `_wiki/` 또는 `_posts/` 아래 `.md` 파일이 스테이징되면 자동 실행된다. hook은 `EMBEDDING_BACKEND` 환경변수를 그대로 상속하므로 셸에서 export하면 반영된다.
