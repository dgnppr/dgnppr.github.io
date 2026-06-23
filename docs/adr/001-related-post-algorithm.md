# ADR-001: 연관 포스트 추천 알고리즘 설계

- **Status**: Accepted
- **Date**: 2026-06-23
- **Deciders**: @dgnppr

---

## Context

블로그 포스트와 위키 문서 간 연관 콘텐츠를 자동으로 추천해야 한다. 수동 관리는 포스트 수 증가에 비례해 유지 비용이 올라가므로, 콘텐츠 기반 자동 생성이 필요하다.

---

## Decision

**Hybrid retrieval + adaptive Z-score filtering** 방식을 채택한다.

### 스코어링 구조

```
score = s·semantic + k·keyword + t·tag + bonus
      (capped at 1.0)
```

| 신호 | 설명 | 가중치 (grid search 결과) |
|------|------|--------------------------|
| semantic | Gemini text-embedding-004 코사인 유사도, min-max 정규화 | 0.5 |
| keyword  | BM25(max(a→b, b→a)), p99 정규화 | 0.0 |
| tag      | Jaccard 계수 (intersection / union) | 0.5 |
| bonus    | 같은 카테고리 +0.02, 제목 공통 토큰 +0.01×min(n,3) | — |

### 필터링

1. **하드 필터**: 본문 100자 미만 문서 쌍 제외
2. **Z-score per-doc**: 각 문서 기준 scored 쌍만으로 mean/std 계산, threshold = mean + 1σ
3. **MIN_SCORE**: 0.50 (전역 하한, Z-score 통과 후 적용)

### 임베딩 입력

```
title + summary + body[:1500]  (총 2000자 상한)
```

앞쪽에 signal-dense 메타데이터 배치 — text-embedding-004는 입력 초반에 가중치 집중.

### 캐시 전략

`data/embeddings.json`에 MD5(입력 텍스트) 기반 증분 캐시. 내용 변경 시에만 재임베딩.  
임베딩 성공 즉시 디스크 기록 — 중간 중단 시 손실 최소화.

---

## Considered Alternatives

### A. 코사인 유사도만 사용

가장 단순한 방법. 짧은 포스트에서 semantic만으로는 같은 카테고리 내 비관련 글도 높은 점수를 받는 문제가 발생. tag/keyword 신호 없이 전역 MIN_SCORE 설정이 어렵다.

### B. TF-IDF 기반 키워드 유사도만 사용

의미적으로 유사하지만 어휘가 다른 글(e.g., "Virtual Thread" vs "경량 스레드")을 연결하지 못한다. 임베딩 없이는 동의어/개념 수준 매칭 불가.

### C. 전처리 없는 BM25 + 코사인 단순 합산

BM25는 짧은 포스트(평균 수백 토큰)에서 IDF 분포가 불균형하게 된다. p99 정규화 없이 합산하면 outlier 1개가 keyword 신호 전체를 왜곡한다. 채택하지 않음.

---

## Consequences

### Positive

- **precision@5 = 100%** (corpus 내 존재하는 positive pair 기준, false positive 0개)
- grid search로 가중치를 자동 튜닝 — eval.json 보강 시 더 정밀한 최적화 가능
- 증분 캐시로 API 비용 최소화 (변경 문서만 재임베딩)

### Negative / Risks

- **BM25 가중치 = 0**: 현재 corpus(24개)에서는 어휘 중첩이 희소해 기여 없음. corpus가 수백 개 규모로 성장하면 재튜닝 필요.
- **고립 포스트 문제**: 같은 주제 문서가 corpus에 없으면 연관 포스트 미출력. 콘텐츠 gap이 없어야 추천이 유효.
- **score > 1.0 방어**: bonus 가산으로 정규화 범위를 초과하는 문제는 `Math.min(..., 1.0)` cap으로 처리.
- **eval.json 유지 비용**: 새 포스트 추가 시 stale slug 가능성. stale 자동 감지 로직으로 보완.

---

## Evaluation

`data/eval.json`에 positive / negative pair를 명시하고 스크립트 실행 시 자동 측정.

| 지표 | 기준 | 현재 값 |
|------|------|---------|
| precision@5 | corpus 내 존재 쌍 기준 | 100% (5/5) |
| false positive | 0 | 0 |
| stale slug | 자동 감지 + 경고 | — |

> eval.json에 음성(expected=false) 쌍이 부족하면 false positive를 측정할 수 없다. 포스트 10개 추가마다 eval 보강 권장.

---

## Implementation

- **Script**: `scripts/generate-embeddings.js`
- **Cache**: `data/embeddings.json`
- **Output**: `data/related.json`
- **Eval**: `data/eval.json`
- **Model**: `text-embedding-004` via Vertex AI (`asia-northeast3`)
- **Trigger**: 수동 실행 (`node scripts/generate-embeddings.js [--force]`)
