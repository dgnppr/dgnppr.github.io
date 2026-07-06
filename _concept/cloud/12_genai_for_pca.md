---
layout  : concept
title   : Google Cloud GenAI 아키텍처 설계 결정
date    : 2026-06-30 00:00:00 +0900
updated : 2026-07-06 00:00:00 +0900
tag     : cloud gcp genai gemini
toc     : true
comment : true
latex   : false
status  : complete
public  : true
parent  : [[/cloud]]
confidence     : medium
valid_from     : 2026-06-30
relations:
  - { type: references, target: /concept/cloud/09_security_for_pca }
---

* TOC
{:toc}

> 최근 개정으로 PCA 시험에 생성형 AI(GenAI)가 깊게 들어왔다. 공식 시험 가이드는 GenAI를 여러 섹션에 흩뿌려 둔다 — **1.2 Gemini Cloud Assist, 1.3 AI/ML 솔루션(Gemini LLM·Agent Builder·Model Garden·Gemini 모델·AI Hypercomputer), 2.4 Gemini Enterprise Agent Platform로 엔드투엔드 ML 워크플로, 2.5 사전 구축 AI API, 3.1 Securing AI(Model Armor·Sensitive Data Protection)**. 시험은 모델 학습법을 묻지 않는다 — **"이 요구사항에 RAG인가 파인튜닝인가", "Gemini를 어떤 경로로 호출하나", "이 GenAI 워크로드의 데이터 경계를 무엇으로 막나"** 같은 아키텍트의 선택을 묻는다. 이 글은 가이드가 명시한 GenAI 빌딩블록을 "요구사항 → 선택 기준 → 결론" 구조로 정리한다. 빠르게 변하는 영역이라 제품명·기능명은 역할 중심으로 다루고 세부 스펙은 단정하지 않는다. PCA 준비 시리즈 GenAI 편이다.

---

## 도입 — 아키텍트가 GenAI에서 답해야 할 질문

GenAI 파트에서 PCA가 묻는 것은 모델의 내부가 아니라 **통합 결정**이다. 핵심 질문은 네 갈래로 압축된다.

1. **무엇으로 만드나** — 직접 모델을 호스팅하나, 관리형 API를 부르나, 검색·챗봇은 로우코드 빌더로 가나.
2. **모델을 어떻게 맞추나** — 프롬프트로 충분한가, RAG로 외부 지식을 붙이나, 파인튜닝까지 가나.
3. **답을 어떻게 신뢰하나** — 환각을 어떻게 줄이나(grounding), 출력을 어떻게 검증하나.
4. **어떻게 안전하게 두나** — 데이터가 어디로 나가나, 누가 모델을 부르나, 경계를 무엇으로 막나.

이 네 질문의 답이 곧 시험 정답의 형태다. 암기가 아니라 판단을 묻기 때문에, 각 섹션은 "함정 → 판단 기준 → 결론"으로 닫는다.

<div class="callout-note">
이 글의 지도: 플랫폼 표면(Vertex AI / Gemini Enterprise Agent Platform) → Gemini 모델군 → Model Garden·AI Hypercomputer(모델 선택·대규모 서빙) → Agent Platform 사전 구축 솔루션(Google AI API·NotebookLM) → RAG와 grounding → 파인튜닝 vs RAG 결정 → Securing AI(Model Armor·Sensitive Data Protection) → Gemini Cloud Assist → 시험 공략 → 퀴즈.
</div>

<div class="callout-warning">
이 영역은 제품명·기능명이 자주 바뀐다. 예컨대 "Vertex AI Search and Conversation"은 "Agent Builder", 다시 "Gemini Enterprise Agent Platform" 계열로, "PaLM"은 "Gemini"로, "Cloud DLP"는 "Sensitive Data Protection"으로 재편됐다. 시험·실무 모두 <strong>개별 기능명보다 역할(검색·grounding·엔드포인트·경계 보호·출력 안전)로 기억</strong>하는 편이 안전하다. 이 글의 confidence가 medium인 이유다. 다만 가이드에 명시된 명칭(Gemini Cloud Assist·AI Hypercomputer·Model Armor·Sensitive Data Protection)은 시험에 그 이름으로 등장할 수 있으니 역할과 함께 외운다.
</div>

<div class="callout-warning">
<strong>응시 시점 주의 — Vertex AI → Gemini Enterprise Agent Platform 전환 중</strong>. Google은 2026-04-22(Cloud Next 2026)에 <strong>Vertex AI를 Gemini Enterprise Agent Platform으로 개명·확장</strong>한다고 발표했고, 공식 인증 페이지 상단에는 "이 시험이 곧 Vertex AI에서 Gemini Enterprise Agent Platform으로의 전환을 반영하도록 업데이트된다"는 배너가 걸려 있다(2026-07 확인). 즉 <strong>지금은 과도기</strong>다 — 응시하는 회차에 따라 문항의 제품명이 "Vertex AI"일 수도, "Gemini Enterprise Agent Platform"일 수도 있다. 대응법은 하나다: <strong>둘을 같은 것으로 보고 역할로 매핑</strong>하라. 이 글도 표면 이름을 "Vertex AI(현 Gemini Enterprise Agent Platform으로 전환 중)"로 병기한다. 새 플랫폼은 모델 선택·구축(Model Garden·Gemini)에 더해 에이전트 통합·오케스트레이션·거버넌스(ADK·Agent Studio·Agent Engine·200+ 모델·영속 메모리)를 한데 묶는 방향으로 진화한다 — 세부 구성명은 버전에 따라 다를 수 있으니 단정하지 말고 "관리형 ML/에이전트 통합 표면"이라는 역할로 기억한다.
</div>

---

## Vertex AI — GenAI의 통합 표면

### 정신모델

Vertex AI는 GCP의 **관리형 ML/GenAI 플랫폼**이다. 아키텍트 관점에서 Vertex AI는 "여러 GenAI 빌딩블록을 IAM·네트워킹·로깅이라는 GCP 공통 거버넌스 아래로 모은 단일 표면"으로 보면 된다. 모델을 직접 부르든, 검색을 붙이든, 에이전트를 만들든 같은 프로젝트·같은 IAM·같은 VPC 경계 안에서 작동한다는 점이 핵심이다.

아키텍트가 알아야 할 구성요소는 다음 정도다.

| 구성요소 | 아키텍트가 보는 책임 | 시험에서의 신호어 |
|---------|---------------------|------------------|
| **Vertex AI Studio** | 프롬프트 설계·테스트, 모델 빠른 실험(콘솔 UI) | "프롬프트를 빠르게 시험", "프로토타이핑" |
| **Model Garden** | 1st/3rd party·오픈 모델 카탈로그, 모델 선택 진입점 | "어떤 모델을 고르나", "오픈 모델 카탈로그" |
| **Endpoint(엔드포인트)** | 모델을 배포해 온라인 예측을 받는 관리형 서빙 지점 | "모델을 배포", "온라인 예측", "오토스케일" |
| **Pipelines** | ML 워크플로우(전처리·학습·평가·배포) 오케스트레이션 | "재현 가능한 ML 워크플로우", "MLOps" |
| **Vertex AI Vector Search** | 임베딩 기반 ANN 벡터 검색(RAG의 검색기) | "유사도 검색", "임베딩", "RAG의 retrieval" |
| **Feature Store / Model Registry** | 피처·모델 버전 거버넌스 | "모델 버전 관리", "거버넌스" |

### 엔드포인트 — 배포 결정의 축

아키텍트가 가장 자주 마주하는 결정은 **"모델을 어떻게 서빙하나"**다. Vertex AI 엔드포인트는 모델을 배포하면 관리형 인프라 위에서 온라인 예측을 처리하고, 트래픽 분할(여러 모델 버전에 % 분배)과 오토스케일을 제공한다. 직접 GKE에 모델 서버를 띄우는 것과의 트레이드오프가 시험 포인트다.

<div class="compare-grid">
<div class="compare-col" markdown="1">

**관리형 호출 (Gemini API on Vertex AI)**

- 모델을 호스팅하지 않고 API만 호출
- 인프라 0, 사용량 과금
- GenAI 앱의 기본 출발점

**언제**: 파운데이션 모델을 그대로 쓸 때. 대부분의 GenAI 시나리오.

</div>
<div class="compare-col" markdown="1">

**전용 엔드포인트 (모델 배포)**

- 오픈/커스텀 모델을 엔드포인트에 배포
- 전용 가속기(GPU/TPU) 점유, 상시 비용
- 버전 트래픽 분할·격리 가능

**언제**: 오픈 모델을 직접 서빙하거나, 격리·전용 용량·커스텀 모델이 필요할 때.

</div>
</div>

**결론**: "파운데이션 모델을 그대로 쓴다"면 관리형 API 호출이 기본값이고, "특정 오픈/커스텀 모델을 전용으로 서빙·격리한다"면 엔드포인트 배포다. 시험에서 "인프라 운영 부담 최소화"가 신호어면 관리형 호출, "전용 용량·버전 격리·특정 모델 직접 서빙"이면 엔드포인트로 매핑한다.

<div class="callout-warning">
파이프라인·엔드포인트·학습 디테일에 너무 깊이 들어가지 말 것. PCA는 아키텍트 시험이라 <strong>"무엇을 언제 고르나"</strong>를 묻지, 하이퍼파라미터·분산학습 구성을 묻지 않는다. ML 운영 디테일은 ML Engineer 자격증의 영역이다.
</div>

---

## Gemini 모델군 — GCP에서의 위치

Gemini는 Google의 멀티모달 파운데이션 모델군이며, GCP에서는 **Vertex AI를 통해 접근**하는 것이 엔터프라이즈 표준 경로다. 아키텍트가 기억할 것은 모델 버전 이름이 아니라 세 가지 성질이다.

- **멀티모달**: 텍스트뿐 아니라 이미지·문서·(모델·버전에 따라) 오디오·비디오 등을 입력으로 받을 수 있다. "PDF·이미지·텍스트를 한 번에 다룬다"가 신호어면 멀티모달 모델 매핑.
- **모델 등급(tier) 트레이드오프**: 같은 세대 안에서도 더 강력하지만 비싼 모델과, 더 빠르고 저렴한 경량 모델이 함께 제공되는 경우가 일반적이다. 정확한 등급명은 버전마다 다르므로 단정하지 않는다.
- **접근 경로 두 갈래**: 같은 Gemini라도 소비자용 경로와 엔터프라이즈용 경로가 갈린다. 이 구분이 시험·실무 모두에서 함정이다.

<div class="callout-warning">
<strong>Gemini API(소비자/개발자용, AI Studio·Google AI 경로) vs Vertex AI의 Gemini(엔터프라이즈용)</strong>를 혼동하면 안 된다. 데이터 거버넌스·VPC-SC·IAM·리전 통제·감사 로깅 같은 엔터프라이즈 통제가 필요하면 답은 항상 <strong>Vertex AI 경로</strong>다. "엔터프라이즈 데이터 거버넌스가 필요하다"는 신호어가 보이면 소비자용 API 키 경로가 아니라 Vertex AI로 매핑한다.
</div>

| 요구사항 | 선택 | 이유 |
|---------|------|------|
| 멀티모달 입력(이미지+텍스트+문서) | Gemini 멀티모달 모델 | 단일 모델로 모달리티 통합 처리 |
| 빠르고 저렴한 대량 처리 | 경량 등급 모델 | 비용·지연 우선, 정확도 요구 낮음 |
| 복잡한 추론·고품질 | 상위 등급 모델 | 정확도 우선, 비용 감내 |
| 엔터프라이즈 거버넌스 필요 | Vertex AI 경로의 Gemini | IAM·VPC-SC·감사 통합 |

**결론**: Gemini 문제는 "멀티모달이 필요한가 / 비용·지연 vs 품질 어디에 무게를 두나 / 엔터프라이즈 통제가 필요한가"의 세 축으로 푼다. 엔터프라이즈 맥락의 PCA 문제에서는 거의 항상 Vertex AI 경로가 정답 쪽이다.

---

## ML 제품 사다리 — ML 전문성 수준으로 제품 고르기

PCA GenAI 파트에서 가장 자주 나오는 결정 유형은 "이 요구사항에 **어느 ML 제품**이 맞나"다. Google의 ML 제품군은 **팀의 ML 전문성과 요구되는 커스터마이즈 수준**을 축으로 사다리처럼 배열된다. 위로 갈수록 손이 덜 가고, 아래로 갈수록 통제권이 커지지만 ML 인력·운영 부담이 커진다. 시험은 "표준 작업인가 / 자체 데이터로 맞춰야 하나 / 밑바닥부터 학습해야 하나"를 물어 이 사다리의 어느 칸인지를 고르게 한다.

| ML 전문성 수준 | 정답 제품 | 무엇을 하나 | 신호어 |
|---------------|----------|------------|--------|
| **없음 — 표준 인지 작업** | 사전학습 API (Vision·Speech·Translation·Natural Language) | Google이 학습한 모델을 API 호출 한 번으로 사용, 학습 데이터 불필요 | "표준 이미지 라벨·OCR", "음성↔텍스트", "번역", "감성·엔티티 추출" |
| **낮음 — 자체 데이터, 코드 최소** | AutoML (Vertex AI) | 라벨링된 자체 데이터를 올리면 GCP가 모델을 자동 학습, 코드 거의 없음 | "우리 데이터로 분류/예측인데 ML 팀이 없다", "라벨은 있는데 모델을 못 짠다" |
| **높음 — 완전 통제** | 커스텀 학습 (Vertex AI Training + GPU/TPU) | 자체 프레임워크(TF·PyTorch)로 모델 코드·학습 루프를 직접 작성 | "자체 아키텍처·손실함수", "완전한 통제", "대규모 분산 학습" |
| **생성형/파운데이션 활용** | Gemini 모델 호출 (Vertex AI / 현 Gemini Enterprise Agent Platform) | 파운데이션 모델을 API로 호출, 필요 시 RAG·파인튜닝으로 보강 | "생성·요약·챗봇·멀티모달", "파운데이션 모델 그대로" |

### 판단 기준

- **작업이 표준 인지 작업(이미지·음성·번역·기본 NLP)인가** → 학습 없이 **사전학습 API**. 여기서 AutoML·커스텀 학습을 고르면 오버킬이다.
- **자체 라벨 데이터로 맞춰야 하는데 ML 인력이 얇은가** → **AutoML**. "우리 데이터인데 코드는 못 짠다"의 정답 칸.
- **모델 아키텍처·학습 과정을 완전히 통제해야 하는가** → **커스텀 학습**(GPU/TPU). ML 팀이 있고 표준 API로 안 될 때만.
- **생성·요약·대화·멀티모달인가** → **Gemini 모델 호출**. 지식 주입이 필요하면 RAG, 스타일·행동 고정이 필요하면 파인튜닝을 얹는다.

<div class="callout-warning">
<strong>시험 함정 — 사다리의 칸을 헷갈리게 하는 선택지</strong>. "이미지에서 텍스트를 추출한다" 같은 표준 작업에 AutoML Vision이나 커스텀 학습을 붙이는 선택지가 함정으로 나온다. 표준 작업이면 <strong>사전학습 API가 정답</strong>이고, 나머지는 불필요한 비용·운영을 얹는 오답이다. 반대로 "우리 회사 특유의 결함 유형을 분류해야 하는데 ML 엔지니어가 없다"면 사전학습 API로는 부족하고 <strong>AutoML</strong>이 정답이다. 규칙: <strong>표준이면 위 칸(API), 자체 데이터+얇은 인력이면 AutoML, 완전 통제면 커스텀 학습</strong>. 필요 이상으로 아래 칸을 고르지 말 것.
</div>

**결론**: ML 제품 문제는 "표준이냐 / 자체 데이터냐 / 밑바닥 통제냐 / 생성형이냐"의 네 칸으로 분해된다. 요구사항이 명시적으로 커스터마이즈·통제를 요구하지 않으면 항상 더 위 칸(관리형)이 정답 쪽이다.

---

## Model Garden — 모델 선택의 진입점

Model Garden은 Vertex AI 안의 **모델 카탈로그**다. 아키텍트가 "어떤 모델을 쓸까"를 결정하는 출발점이며, 여기에 1st party(Google의 Gemini 계열 등), 3rd party 파트너 모델, 오픈 모델(예: 공개 가중치 모델군)이 함께 노출된다.

### 모델 출처별 선택 기준

| 모델 종류 | 장점 | 비용·제약 | 언제 고르나 |
|----------|------|----------|------------|
| **1st party (Gemini 등)** | 최신 멀티모달·관리형 API, GCP 통합 깊음 | 사용량 과금, 모델 내부 통제 제한 | 일반적 GenAI 앱의 기본값 |
| **3rd party 파트너 모델** | 특정 작업 특화·라이선스 다양성 | 파트너 약관·과금 모델 상이 | 특정 벤더 모델이 요구될 때 |
| **오픈 모델(공개 가중치)** | 자체 호스팅·커스터마이즈·격리 가능 | 엔드포인트 운영·가속기 비용 본인 부담 | 데이터 격리·온프렘 유사 통제·커스텀 학습 필요 |

**결론**: Model Garden 문제의 핵심은 **"관리형 vs 자체 호스팅"의 트레이드오프**다. "운영 부담 최소·최신 모델"이면 1st party 관리형, "모델·가중치에 대한 완전한 통제·격리·커스터마이즈"가 요구사항이면 오픈 모델을 엔드포인트에 직접 배포한다. 시험에서 "데이터를 외부 모델 제공자에게 보낼 수 없다 + 모델을 커스터마이즈해야 한다"가 동시에 나오면 오픈 모델 자체 배포 쪽으로 기운다.

---

## AI Hypercomputer — 대규모 학습·서빙 인프라

가이드 2.4가 명시하는 항목이다. **AI Hypercomputer**는 GPU·TPU·고성능 네트워킹·스토리지를 묶어 **대규모 ML/AI 학습과 서빙**을 위해 최적화한 통합 슈퍼컴퓨팅 아키텍처다. 아키텍트 관점에서 기억할 것은 디테일이 아니라 **언제 이 레이어가 답인가**이다.

| 요구사항 | 매핑 |
|---------|------|
| 파운데이션 모델 그대로 API 호출 | 관리형 Gemini API (Hypercomputer 불필요) |
| 자체 오픈 모델 소규모 서빙 | Vertex AI 전용 엔드포인트(GPU) |
| **대규모 모델 학습·파인튜닝, 대량 GPU/TPU, 소비 모델 최적화** | **AI Hypercomputer** |

### 소비 모델 — 가속기를 어떻게 사다 쓰나

AI Hypercomputer 비용 최적화의 핵심은 **가속기 용량을 어떤 소비(consumption) 모델로 확보하느냐**다. 워크로드의 긴급도·예측가능성·중단 허용 여부로 가른다.

| 소비 모델 | 성격 | 언제 |
|----------|------|------|
| **On-demand** | 즉시 확보, 단가 가장 높음, 보장 없음 | 짧고 예측 어려운 워크로드, 검증·실험 |
| **예약(Reservation) / CUD** | 용량을 미리 예약·약정해 할인, 가용성 보장 | 장기·상시 학습/서빙, 예측 가능한 정상 수요 |
| **Spot** | 잉여 용량을 큰 할인가로, 선점(중단)될 수 있음 | 중단·재시작 견디는 배치 학습, 비용 최우선 |
| **DWS (Dynamic Workload Scheduler)** | 필요한 가속기 용량을 큐잉해 확보되면 일괄 시작 | 대량 가속기를 한꺼번에 써야 하는 학습 잡, 즉시성보다 확보가 중요 |

판단 기준: **중단을 견디고 비용이 최우선이면 Spot, 상시·예측 가능한 수요면 예약/CUD, 대량 가속기를 모아 한 번에 돌려야 하면 DWS, 그 외 짧고 불확실하면 on-demand**다.

<div class="callout-warning">
시험에서 "대규모 모델을 직접 학습/파인튜닝한다", "수천 개 가속기(GPU/TPU)를 효율적으로 묶어야 한다", "학습·서빙 비용을 소비 모델(on-demand/예약/Spot/DWS)로 최적화한다"가 신호어면 AI Hypercomputer 쪽이다. 반대로 "파운데이션 모델을 그대로 쓴다"면 이 레이어는 오버킬이며 관리형 API가 정답이다. GPU/TPU·대규모 학습은 ML Engineer 영역과 겹치지만, PCA는 <strong>"이 워크로드에 전용 학습 인프라가 필요한가"라는 선택</strong>까지만 묻는다.
</div>

---

## Gemini Enterprise Agent Platform — 사전 구축 솔루션과 AI API

가이드 2.4·2.5가 다루는 영역이다. 직접 RAG 파이프라인을 코드로 짜는 대신, GCP는 **검색·챗봇·에이전트·ML 워크플로를 빠르게 구축하는 관리형 빌더와 API**를 제공한다. 제품 계열은 "Vertex AI Search and Conversation" → "Agent Builder" → "Gemini Enterprise Agent Platform"으로 재편돼 왔으나, 아키텍트가 기억할 역할은 안정적이다.

| 빌딩블록 | 역할 | 전형적 시나리오 |
|---------|------|----------------|
| **Search (엔터프라이즈 검색)** | 사내 문서·데이터에 대한 검색 + grounding된 답변 | "사내 위키·매뉴얼에 자연어 질의" |
| **Conversation / 챗봇** | 대화형 어시스턴트, FAQ·고객지원 봇 | "고객 지원 챗봇을 빠르게" |
| **AI Agents (에이전트)** | 도구 호출·다단계 작업 수행 에이전트 | "여러 시스템을 호출하는 업무 자동화" |
| **NotebookLM** | 문서 기반 요약·질의 어시스턴트 | "업로드한 자료에 근거한 분석·요약" |

### 데이터 통합 준비 — 에이전트에 사내 데이터를 연결한다

가이드 2.4가 명시하는 항목이다. 관리형 검색·에이전트는 **연결할 데이터가 준비돼 있어야** 작동한다. 사내 데이터를 에이전트/검색에 붙이는 준비 단계는 다음과 같다.

| 단계 | 하는 일 | 신호어 |
|------|---------|--------|
| **데이터 커넥터 구성** | 정형(BigQuery·Cloud SQL 등)·비정형(GCS 문서·웹사이트 등) 소스를 에이전트 플랫폼에 연결 | "사내 데이터 소스를 에이전트에 연결" |
| **데이터스토어(datastore) 구성** | 연결한 소스를 검색 대상으로 묶는 논리적 저장소를 만들고 인덱싱 | "데이터스토어 준비", "검색 대상 인덱싱" |
| **RAG 검색 대상화** | 인덱싱된 데이터스토어를 Search/Conversation·에이전트의 grounding 소스로 지정 | "사내 문서에 근거한 답변" |

관리형 빌더에서 **데이터 커넥터 → 데이터스토어 → 인덱싱**은 뒤에 나오는 직접 RAG 조립의 **청킹 → 임베딩 → Vector Search 인덱스**에 대응한다. 즉 관리형 경로는 RAG의 retrieval 준비 과정을 패키지로 감싼 것이다. 시험에서 "사내 데이터 소스를 에이전트에 연결한다 / 데이터스토어를 준비한다"가 신호어면, 직접 임베딩 파이프라인을 짜는 대신 **Agent Platform의 데이터 커넥터·데이터스토어**로 매핑한다.

### Agent Platform Pipelines — ML 라이프사이클 오케스트레이션

가이드 2.4가 함께 명시하는 항목이다. **Agent Platform Pipelines**는 데이터 전처리·학습·평가·배포로 이어지는 **ML 라이프사이클을 자동화·오케스트레이션**하는 도구다. 각 단계를 컴포넌트로 정의해 재현 가능한 워크플로로 묶고, 재실행·스케줄·산출물 추적을 제공한다. 시험에서 "재현 가능한 ML 워크플로", "MLOps 자동화", "전처리·학습·배포를 파이프라인으로"가 신호어면 이쪽이다.

<div class="callout-note">
<strong>Vertex AI Pipelines와의 관계</strong>: 둘은 같은 계열의 ML 워크플로 오케스트레이션 도구다. 아키텍트 관점에서는 개별 제품명보다 <strong>"ML 라이프사이클을 코드로 정의된 재현 가능한 파이프라인으로 자동화한다"</strong>는 역할로 기억하면 된다. 단발성 호출이 아니라 반복·스케줄·추적이 필요한 ML 워크플로의 오케스트레이션 레이어다.
</div>

### 사전 구축 Google AI API

가이드 2.5는 사전 구축 AI API를 작업별로 구분할 것을 요구한다. 직접 모델을 다루지 않고 **특정 인지(perception) 작업을 API 한 번으로 해결**하는 경우다.

| API | 작업 | 신호어 |
|-----|------|--------|
| Search | 엔터프라이즈 검색 + grounding된 답변 | "사내 문서 검색", "엔터프라이즈 검색" |
| Conversation | 대화형 어시스턴트·챗봇 | "고객 지원 챗봇", "대화형 봇" |
| Vision | 이미지 분석(라벨·OCR·객체) | "이미지에서 텍스트·객체 추출" |
| Image | 이미지 생성·편집 | "이미지 생성" |
| Video | 비디오 분석 | "영상 콘텐츠 분석" |
| Audio (Speech) | STT/TTS | "음성↔텍스트 변환" |

**결론**: "표준 인지 작업(이미지·음성·영상 분석)을 빠르게"면 사전 구축 API, "사내 문서 검색·챗봇을 로우코드로"면 Agent Platform의 Search/Conversation, "직접 모델을 골라 커스텀 앱"이면 Model Garden + Gemini API로 매핑한다.

### 빌드 vs 바이 결정

핵심 트레이드오프는 **"관리형 빌더로 빠르게 vs 직접 RAG를 조립해 통제권 확보"**다.

<div class="compare-grid">
<div class="compare-col" markdown="1">

**관리형 빌더 (Agent Builder 계열)**

- 데이터 커넥터·검색·grounding이 패키지로 제공
- 로우코드, 빠른 출시
- 세밀한 retrieval 로직 통제는 제한적

**언제**: 표준적 사내 검색·챗봇을 빠르게, MLOps 인력 적을 때.

</div>
<div class="compare-col" markdown="1">

**직접 RAG 조립 (Vector Search + Gemini)**

- 임베딩·청킹·retrieval·프롬프트를 직접 설계
- 완전한 통제, 커스텀 랭킹·필터 가능
- 구현·운영 부담 큼

**언제**: 비표준 retrieval, 정밀 통제, 특수 도메인 요구일 때.

</div>
</div>

**결론**: "빠른 출시 + 표준 검색/챗봇 + 운영 부담 최소"가 신호어면 Agent Builder 계열 관리형 빌더, "retrieval 로직을 세밀하게 통제해야 한다"면 Vector Search 기반 직접 RAG다.

---

## RAG — 외부 지식을 붙이는 표준 패턴

### 왜 RAG인가

파운데이션 모델은 학습 시점 이후의 지식이나 조직 내부 비공개 문서를 모른다. 그대로 물으면 **환각(hallucination)**이 난다. RAG(Retrieval-Augmented Generation)는 "질문과 관련된 문서를 먼저 검색해 프롬프트에 넣고, 모델은 그 근거 위에서 답하게" 하는 패턴이다. 모델 가중치를 건드리지 않고 최신·비공개 지식을 주입한다.

### GCP에서의 구현 요소

```text
[문서 소스]  →  [청킹]  →  [임베딩 모델]  →  [Vector Search 인덱스]
                                                      │
사용자 질문 → [임베딩] → [유사도 검색(top-k)] ─────────┘
                                  │
                     관련 청크 + 질문 → [Gemini] → grounded 답변
```

각 컴포넌트의 책임:

| 단계 | GCP 구성요소 | 책임 |
|------|-------------|------|
| 임베딩 | Vertex AI 임베딩 모델 | 텍스트를 벡터로 변환 |
| 벡터 저장·검색 | **Vertex AI Vector Search** | ANN(근사 최근접) 유사도 검색, top-k 반환 |
| 생성 | Gemini (Vertex AI) | 검색된 근거 위에서 답 생성 |
| 근거 부착 | **Grounding** | 답을 검색 결과·신뢰 소스에 결부, 출처 표시 |

<div class="callout-note">
<strong>Grounding</strong>은 RAG 답변을 신뢰 가능한 소스(사내 데이터, 또는 웹 검색 등)에 결부시켜 환각을 줄이고 출처를 제시하는 메커니즘이다. 시험에서 <strong>"환각을 줄여야 한다 / 답의 근거를 제시해야 한다"</strong>가 신호어면 grounding(그리고 그 토대인 RAG)으로 매핑한다.
</div>

<div class="callout-warning">
RAG는 만능이 아니다. 검색 품질이 나쁘면(청킹·임베딩·top-k가 부적절하면) 모델은 잘못된 근거 위에서 자신 있게 틀린 답을 한다. "RAG를 붙였는데 정확도가 안 오른다"의 흔한 원인은 모델이 아니라 <strong>retrieval 단계</strong>다. 아키텍트는 RAG를 "모델 문제"가 아니라 "검색 + 생성 파이프라인 문제"로 봐야 한다.
</div>

---

## RAG vs 파인튜닝 vs 프롬프트 — 시험의 단골 함정

PCA GenAI 파트에서 가장 자주 나오는 선택이다. **무엇을 언제 쓰나**를 표로 손에 쥔다.

| 기법 | 무엇을 해결 | 비용·부담 | 언제 |
|------|-----------|----------|------|
| **프롬프트 엔지니어링 / few-shot** | 출력 형식·톤·간단한 작업 조정 | 가장 저렴, 즉시 | 기본 출발점. 모델이 이미 아는 것을 끌어내기 |
| **RAG** | 최신·비공개·자주 바뀌는 **지식** 주입 | 검색 인프라(Vector Search) 운영 | 사실 기반 답·출처 필요·지식이 자주 바뀜 |
| **파인튜닝** | 특정 **스타일·행동·도메인 어투**를 모델에 각인 | 학습 데이터·학습 비용·재학습 부담 | 형식·행동이 일관돼야 하고 지식이 안정적일 때 |

### 판단 기준

- **지식이 자주 바뀌거나 출처가 필요한가** → **RAG**. 파인튜닝은 새 지식이 생길 때마다 재학습해야 하므로 부적합하다.
- **답의 형식·스타일·도메인 어투를 일관되게 만들고 싶은가** → **파인튜닝**. RAG는 지식은 주입해도 모델의 행동 양식은 바꾸지 못한다.
- **간단한 작업·형식 조정인가** → 먼저 **프롬프트**. 비용 0에 가까운 1차 시도.

<div class="callout-warning">
<strong>시험 함정</strong>: "사내 문서가 매주 업데이트되는데 챗봇이 항상 최신 답을 해야 한다" → 정답은 RAG. 여기서 파인튜닝을 고르면 오답이다(매번 재학습은 비현실적). 반대로 "특정 법률 문서 어투로 일관되게 답해야 한다 + 지식은 고정" → 파인튜닝 쪽. 핵심 구분은 <strong>"바뀌는 지식 = RAG / 고정된 행동·스타일 = 파인튜닝"</strong>이다.
</div>

**결론**: 의사결정 순서는 프롬프트 → RAG → 파인튜닝(→ 둘의 조합)이다. 비용·운영 부담이 낮은 쪽부터 시도하고, "지식이냐 행동이냐"로 RAG와 파인튜닝을 가른다.

---

## Securing AI / Responsible AI — 아키텍트의 핵심 책임

GenAI 워크로드는 일반 워크로드의 보안에 더해 **데이터가 모델로 흘러간다**는 고유 위험을 갖는다. 프롬프트에 민감정보가 실리고, 출력이 안전하지 않을 수 있고, 검색 인덱스에 비공개 문서가 들어간다. PCA는 이 경계를 무엇으로 막는지를 묻는다.

### 데이터 경계 — VPC-SC가 핵심

<div class="callout-note">
GenAI 워크로드에서 <strong>가장 중요한 시험 신호어는 "데이터 유출(exfiltration) 방지" / "데이터가 경계를 넘으면 안 된다"</strong>이다. 정답은 거의 항상 <strong>VPC Service Controls(VPC-SC)</strong>로, Vertex AI를 포함한 GCP API들을 서비스 경계(perimeter) 안에 가두어 경계 밖으로의 데이터 이동을 차단한다. IAM(누가 호출하나)과는 다른 레이어(데이터가 어디로 나가나)임을 구분해야 한다.
</div>

| 통제 레이어 | 무엇을 막나 | GCP 메커니즘 |
|------------|-----------|-------------|
| **인증·인가** | 누가 모델·엔드포인트를 호출하나 | IAM (최소권한 역할), Service Account |
| **데이터 경계** | 데이터가 경계 밖으로 새나 | **VPC Service Controls** |
| **네트워크 경로** | 트래픽이 공인망을 타나 | Private Google Access / Private endpoints |
| **저장·전송 암호화** | 미사용·전송 중 데이터 보호 | 기본 암호화, 필요 시 **CMEK** |
| **감사** | 누가 언제 무엇을 했나 | Cloud Audit Logs |

### IAM — GenAI에 대한 최소권한

GenAI 워크로드도 IAM 원칙은 동일하다. 모델 호출·엔드포인트·Vector Search·데이터 소스 각각에 **최소권한 사전정의 역할**을 부여하고, 애플리케이션은 사용자 자격증명이 아니라 **Service Account**로 호출한다. Basic Role(Owner/Editor)을 GenAI 서비스 계정에 주는 것은 금물이다(IAM 편 참조).

### 프롬프트·출력 안전 — Model Armor와 Sensitive Data Protection

가이드 3.1은 Securing AI의 예시로 **Model Armor, Sensitive Data Protection, secure model deployment**를 명시한다. 두 제품의 역할을 분리해 기억한다.

| 제품 | 역할 | 신호어 |
|------|------|--------|
| **Model Armor** | 프롬프트·응답을 검사하는 LLM 안전 필터. 주 역할은 프롬프트 인젝션·유해/부적절 출력 차단. PII 탐지·마스킹은 단독 기능이라기보다 Sensitive Data Protection과 함께 거는 영역 | "프롬프트 인젝션 방어", "유해 출력 차단", "LLM 가드레일" |
| **Sensitive Data Protection** (구 Cloud DLP) | 데이터에서 PII·민감정보를 탐지·분류·de-identify(마스킹·토큰화) | "PII 탐지·마스킹", "민감정보 스캔" |

- **입력(프롬프트) 안전**: Model Armor로 프롬프트 인젝션·악성 입력을 거르고, Sensitive Data Protection으로 프롬프트에 실리는 PII를 사전 탐지·마스킹한다.
- **출력 안전**: Model Armor + 모델 자체 안전성 설정(safety settings)으로 유해·부적절 콘텐츠를 필터링하고, grounding으로 사실성을 보강한다.
- **안전한 모델 배포(secure model deployment)**: 전용 엔드포인트를 VPC-SC 경계·Private access 안에 두고, 최소권한 IAM·CMEK를 적용해 배포한다.
- **모델 거버넌스**: Model Registry로 모델 버전을 추적하고, 어떤 모델이 프로덕션에 있는지·누가 승인했는지를 관리한다.

### Responsible AI 원칙 (아키텍트 관점)

Google의 책임 AI 원칙은 시험에서 세부 조항보다 **"설계에 반영해야 할 비기능 요구"**로 등장한다. 아키텍트가 잡아야 할 축:

| 원칙 축 | 설계 반영 |
|--------|-----------|
| 공정성·편향 | 평가 데이터·모니터링으로 편향 점검 |
| 투명성·설명가능성 | 출처 표시(grounding), 의사결정 로깅 |
| 프라이버시 | DLP·CMEK·VPC-SC로 데이터 보호 |
| 안전·보안 | 출력 필터, 안전 설정, 휴먼 인 더 루프 |
| 책임성 | 감사 로그, 모델 거버넌스, 승인 절차 |

<div class="callout-warning">
<strong>시험 함정</strong>: "규제 산업(금융·의료)에서 GenAI를 도입하는데 데이터가 GCP 경계를 절대 벗어나면 안 된다" → VPC-SC + Vertex AI 경로 + (필요 시) CMEK + Private access의 조합. 여기서 "소비자용 Gemini API 키로 호출"을 고르면 오답이다 — 거버넌스 통제가 안 걸린다. 규제 맥락이면 항상 <strong>Vertex AI 경로 + 경계 통제</strong>로 매핑한다.
</div>

**결론**: GenAI 보안 문제는 레이어로 분해한다 — "누가 호출하나(IAM) / 데이터가 어디로 나가나(VPC-SC) / 경로는 사설인가(Private access) / 암호화 키는 누가 통제하나(CMEK) / 추적되나(Audit Logs) / 프롬프트·출력은 안전한가(Model Armor·Sensitive Data Protection)". 신호어가 "데이터 유출 방지"면 VPC-SC가 1순위 정답이다.

---

## Gemini Cloud Assist — 아키텍트를 돕는 AI

가이드 1.2(기술 요구사항 설계)와 5.1(구현 관리)에 모두 등장한다. **Gemini Cloud Assist**는 GCP 콘솔·워크플로에 통합된 AI 어시스턴트로, 아키텍처 설계·리소스 구성·트러블슈팅·비용 최적화를 자연어로 보조한다. 여기서 GenAI는 "내가 만드는 솔루션"이 아니라 "GCP를 운영·설계하는 나를 돕는 도구"라는 점이 다른 항목과의 차이다.

시험 관점에서는 **"클라우드 설계·운영·문제 해결을 AI 보조로 가속한다"**는 맥락의 신호어로 등장한다. 모델을 직접 다루는 Vertex AI·Agent Platform과 혼동하지 않는다 — Gemini Cloud Assist는 **GCP 플랫폼 자체를 다루는 보조 도구**다.

---

## 케이스 스터디 접점 — GenAI/ML이 걸리는 두 케이스

PCA 시험은 4개 공식 케이스 스터디(EHR Healthcare · Helicopter Racing League · Mountkirk Games · TerramEarth)를 포함하며, 케이스당 약 5문항이 붙는다(v6.1 케이스 기준, 2026-07 확인). GenAI/ML이 정면으로 걸리는 케이스는 **Helicopter Racing League(HRL)**와 **TerramEarth**다. 두 케이스는 "요구사항 → ML 설계 결정"을 묻는 단골이므로, 위에서 정리한 사다리·RAG·서빙 결정이 어떻게 케이스 문장에 대응하는지 미리 맞춰 둔다.

<div class="callout-note">
케이스 세부 수치(스트리밍 규모·차량 대수 등)는 회차마다 v6.1 원문으로 재확인하라. 아래 표는 요구사항 문장의 <strong>유형 → 설계 결정</strong> 매핑에 집중한다.
</div>

### Helicopter Racing League (HRL) — 실시간 예측·콘텐츠 ML

HRL은 글로벌 스트리밍 사업자로, **경기 결과·시청 관련 실시간 예측 정확도 향상**과 **저지연 글로벌 콘텐츠 배포**가 핵심 요구다. GenAI/ML 관점의 신호어와 정답:

| 요구사항 문장(유형) | 설계 결정 | 왜 |
|--------------------|----------|-----|
| "예측 모델의 정확도를 높이고 싶다" | Vertex AI(현 전환 중) 커스텀 학습 + GPU, 또는 파운데이션 모델 활용 | 자체 예측 워크로드 — 사다리의 커스텀 학습/모델 칸 |
| "예측을 시청자에게 저지연으로 제공" | 예측 결과 서빙을 사용자에 가까운 **리전에 배포** + 전용 엔드포인트(GPU) | 에지/지역 추론으로 지연 최소화 |
| "콘텐츠를 전 세계에 낮은 지연으로 배포" | Global external Application LB + Cloud CDN / Media CDN | ML이 아닌 배포 계층(07 LB 편과 연결) |
| "예측·추천 파이프라인을 재현 가능하게 운영" | Vertex AI Pipelines(= Agent Platform Pipelines 계열) | MLOps 오케스트레이션 |

**요지**: HRL은 "예측 정확도 + 저지연 서빙"이 세트다. 정확도는 **모델 학습/선택**, 저지연은 **리전 배포·엔드포인트**로 분리해서 답한다. "정확도를 높이려면 무엇?"에 CDN을 고르면 계층을 헷갈린 오답이다.

### TerramEarth — IoT 텔레메트리·예지 정비 ML

TerramEarth는 중장비 제조사로, **운행 차량의 텔레메트리를 수집·분석해 예지 정비(predictive maintenance)** 를 실현하는 것이 핵심이다. 데이터 파이프라인과 ML이 함께 걸린다:

| 요구사항 문장(유형) | 설계 결정 | 왜 |
|--------------------|----------|-----|
| "차량 텔레메트리를 대량 실시간 수집" | Pub/Sub(수집) → Dataflow(처리) | 스트리밍 수집·처리 표준 조합 |
| "차량ID+타임스탬프 시계열을 저지연 저장" | **Bigtable** | 키 기반 대량 시계열 쓰기(08 DB 편과 연결) |
| "고장을 사전 예측하는 ML" | Vertex AI(전환 중) 예지 정비 모델 — 자체 데이터 학습 | 자체 라벨 데이터 → AutoML 또는 커스텀 학습 |
| "예측·분석 결과를 웨어하우스에서 분석" | BigQuery | 분석 계층 |
| "딜러에게 예측 결과를 API로 제공" | Apigee(딜러 API) | ML이 아닌 API 관리 계층 |

**요지**: TerramEarth의 ML은 "자체 텔레메트리로 학습하는 예지 정비"다. ML 인력·통제 요구가 명시되면 **커스텀 학습**, 자체 데이터인데 인력이 얇으면 **AutoML**로 사다리를 탄다. 여기서 사전학습 API(Vision/Speech 등)를 고르면 도메인 특화 예측을 표준 API로 대체하려는 오답이다.

---

## 온톨로지 접점

이 글의 데이터 모델은 그래프 관점에서 다음과 닿는다.

- **엔티티**: `Model`(Gemini·오픈 모델), `Endpoint`(서빙 지점), `VectorIndex`(검색기), `DataSource`(grounding 소스), `ServicePerimeter`(VPC-SC 경계).
- **관계**: `Endpoint —serves→ Model`, `RAGApp —retrieves_from→ VectorIndex`, `Answer —grounded_in→ DataSource`, `Perimeter —protects→ {Vertex AI, VectorIndex, DataSource}`, `ServiceAccount —invokes→ Endpoint`.
- **행위**: `embed`(임베딩 생성), `retrieve`(유사 문서 검색), `generate`(생성), `ground`(근거 부착), `audit`(감사 기록).

GenAI 보안 결정은 이 그래프에서 **`Perimeter —protects→`** 관계와 **`ServiceAccount —invokes→`** 관계의 설계 문제로 환원된다. 보안 편(09)의 경계·IAM 그래프와 직접 연결된다.

---

## 시험 공략 요약

신호어 → 정답 매핑으로 압축한다.

| 시험 신호어 | 정답 방향 |
|------------|----------|
| "엔터프라이즈 거버넌스 / 규제 산업" | Vertex AI 경로 (소비자용 API 아님) |
| "데이터 유출 방지 / 경계를 넘으면 안 됨" | **VPC Service Controls** |
| "환각을 줄여야 / 답의 근거·출처 필요" | RAG + **Grounding** |
| "지식이 자주 바뀜 / 최신 사내 문서 반영" | **RAG** (파인튜닝 아님) |
| "일관된 스타일·행동·도메인 어투 / 지식은 고정" | **파인튜닝** |
| "간단한 형식·톤 조정" | 프롬프트 엔지니어링 (1차 시도) |
| "유사도 검색 / 임베딩 기반 retrieval" | **Vertex AI Vector Search** |
| "빠른 사내 검색·챗봇 / 로우코드" | Gemini Enterprise Agent Platform (Search & Conversation) |
| "사내 데이터 소스를 에이전트에 연결 / 데이터스토어 준비" | Agent Platform 데이터 커넥터 + 데이터스토어 (인덱싱) |
| "재현 가능한 ML 워크플로 / MLOps 자동화" | Agent Platform Pipelines (= Vertex AI Pipelines 계열) |
| "이미지·음성·영상 인지 작업을 API로" | 사전 구축 Google AI API (Vision·Speech·Video) |
| "오픈 모델 자체 호스팅·커스터마이즈·격리" | Model Garden 오픈 모델 + 전용 엔드포인트 |
| "대규모 모델 학습·파인튜닝 / 대량 GPU·TPU" | **AI Hypercomputer** |
| "운영 부담 최소 + 파운데이션 모델 그대로" | 관리형 Gemini API 호출 |
| "멀티모달(이미지+텍스트+문서)" | Gemini 멀티모달 모델 |
| "표준 이미지·음성·번역·기본 NLP를 학습 없이" | 사전학습 API (Vision·Speech·Translation·NL) |
| "자체 라벨 데이터인데 ML 인력이 얇다" | **AutoML** (Vertex AI) |
| "모델 아키텍처·학습을 완전히 통제" | 커스텀 학습 (Vertex AI Training + GPU/TPU) |
| "HRL: 예측 정확도 향상" | 커스텀 학습/모델 (서빙과 분리) |
| "HRL: 예측을 저지연으로 시청자에게" | 리전 배포 + 전용 엔드포인트 (GPU) |
| "TerramEarth: 예지 정비 ML" | 자체 데이터 학습(AutoML/커스텀) — 사전학습 API 아님 |
| "프롬프트 인젝션·유해 출력 차단 / LLM 가드레일" | **Model Armor** |
| "PII 탐지·마스킹 / 민감정보 스캔" | **Sensitive Data Protection** (구 DLP) |
| "키를 직접 통제해야 함" | CMEK |
| "누가 모델을 호출하나" | IAM 최소권한 + Service Account |
| "GCP 설계·운영·트러블슈팅을 AI로 보조" | **Gemini Cloud Assist** |

핵심 사고틀: **요구사항을 읽고 → "지식이냐 행동이냐 / 관리형이냐 자체호스팅이냐 / 데이터가 어디로 나가나"로 분해 → 올바른 빌딩블록으로 매핑**. GenAI라고 특별할 게 없다. PCA의 다른 파트와 같은 "요구사항 → 프리미티브 매핑" 게임이다.

---

## 자가진단 퀴즈

**Q1.** 금융사가 사내 정책 문서(매주 갱신) 기반 Q&A 챗봇을 만든다. 답에는 출처가 표시돼야 하고, 데이터는 GCP 경계를 절대 벗어나면 안 된다. 어떤 조합이 적절한가?

<details markdown="1">
<summary>답</summary>
**Vertex AI 경로의 Gemini + RAG(Vertex AI Vector Search) + Grounding + VPC Service Controls**. 매주 갱신되는 지식이므로 파인튜닝이 아니라 RAG, 출처 표시는 grounding, 경계 이탈 방지는 VPC-SC다. 소비자용 Gemini API 키 경로를 고르면 거버넌스 통제가 안 걸려 오답.
</details>

**Q2.** "고객 지원 챗봇을 최소한의 코드와 운영 부담으로 빠르게 출시하고 싶다. retrieval 로직을 세밀하게 커스터마이즈할 필요는 없다." 무엇을 고르나?

<details markdown="1">
<summary>답</summary>
**Agent Builder / Vertex AI Search & Conversation 계열의 관리형 빌더**. 데이터 커넥터·검색·grounding이 패키지로 제공돼 로우코드로 빠르게 출시할 수 있다. 직접 Vector Search + Gemini로 RAG를 조립하는 것은 통제권은 크지만 운영 부담이 커서 이 요구사항엔 과하다.
</details>

**Q3.** 법률 문서 작성 보조 모델이 항상 특정 법률 어투와 출력 형식으로 일관되게 답하길 원한다. 참조 지식 자체는 거의 바뀌지 않는다. RAG인가 파인튜닝인가?

<details markdown="1">
<summary>답</summary>
**파인튜닝**. 요구사항이 "지식 주입"이 아니라 "일관된 스타일·행동"이고 지식이 고정적이므로 파인튜닝이 적합하다. 바뀌는 지식이었다면 RAG가 답이다. "바뀌는 지식 = RAG / 고정된 행동 = 파인튜닝".
</details>

**Q4.** 데이터 거버넌스상 외부 모델 제공자에게 데이터를 보낼 수 없고, 모델 가중치를 직접 커스터마이즈해야 한다. 어떤 모델 전략인가?

<details markdown="1">
<summary>답</summary>
**Model Garden의 오픈 모델(공개 가중치)을 Vertex AI 전용 엔드포인트에 배포**. 자체 호스팅으로 데이터 격리와 커스터마이즈가 가능하다. 관리형 1st party API는 운영은 편하지만 가중치 통제·격리 요구를 충족하지 못한다.
</details>

**Q5.** "RAG를 붙였는데도 챗봇이 자신 있게 틀린 답을 한다." 아키텍트가 가장 먼저 의심할 곳은?

<details markdown="1">
<summary>답</summary>
**retrieval 단계(청킹·임베딩·top-k·인덱스 품질)**. RAG의 정확도 문제는 보통 생성 모델이 아니라 검색기에서 온다. 잘못된 근거를 넣으면 모델은 그 위에서 틀린 답을 한다. 모델 교체·파인튜닝 이전에 검색 파이프라인을 점검하는 것이 순서다.
</details>

**Q6.** 사내 위키(GCS 문서)와 제품 카탈로그(BigQuery 테이블)를 모두 참조하는 관리형 검색 에이전트를 만들려 한다. 직접 임베딩 파이프라인을 짜기 전에 Agent Platform에서 먼저 준비해야 하는 것은?

<details markdown="1">
<summary>답</summary>
**데이터 커넥터로 두 소스(GCS 비정형 문서·BigQuery 정형 데이터)를 연결하고, 데이터스토어로 묶어 인덱싱**하는 것. 이 인덱싱된 데이터스토어가 에이전트/검색의 grounding 소스가 된다. 관리형 경로에서는 청킹·임베딩·벡터 인덱스를 직접 만들지 않고 데이터 커넥터 → 데이터스토어 단계가 그 retrieval 준비를 대신한다.
</details>

### 실전형 4지선다 (오답 해설 포함)

**Q7.** 물류 회사가 배송 사진에서 손상 여부를 판별하려 한다. "화물 파손"은 이 회사만의 도메인 라벨이고, 사내에 라벨링된 이미지 데이터셋은 있으나 ML 엔지니어는 없다. 가장 적절한 것은?

- (A) Vision API(사전학습)로 이미지 라벨을 추출한다
- (B) AutoML(Vertex AI)로 자체 라벨 데이터를 학습시킨다
- (C) 커스텀 학습으로 CNN을 직접 작성해 GPU에서 학습한다
- (D) Gemini 멀티모달 모델에 이미지를 넣어 프롬프트로만 판별한다

<details markdown="1">
<summary>답</summary>
**정답 (B)**. 도메인 특유의 라벨("화물 파손")을 자체 데이터로 학습해야 하고 ML 인력이 얇다 — ML 사다리에서 AutoML 칸이다.
(A) 오답: Vision API는 표준 라벨/OCR용이라 회사 고유의 파손 유형을 알지 못한다.
(C) 오답: 커스텀 학습은 통제권은 크지만 ML 엔지니어가 없다는 제약과 정면충돌한다(불필요한 부담).
(D) 오답: 파운데이션 모델 프롬프트만으로는 도메인 라벨 정확도·일관성을 보장하기 어렵고, 라벨 데이터가 이미 있는 상황에서 학습 자산을 버리는 선택이다.
</details>

**Q8.** 규제 대상 의료 기관이 사내 임상 가이드라인(월 단위 개정) 기반 Q&A 어시스턴트를 만든다. 답에는 근거 문서가 표시돼야 하고, 프롬프트·문서가 GCP 서비스 경계를 벗어나면 안 된다. 최적 조합은?

- (A) 소비자용 Gemini API 키 + 가이드라인으로 파인튜닝
- (B) Vertex AI 경로 Gemini + RAG(Vector Search) + Grounding + VPC Service Controls
- (C) Vertex AI 경로 Gemini + 월 1회 파인튜닝 + IAM 최소권한
- (D) AutoML 텍스트 분류 + Cloud Armor

<details markdown="1">
<summary>답</summary>
**정답 (B)**. 자주 바뀌는 지식은 RAG, 근거 표시는 Grounding, 경계 이탈 방지는 VPC-SC, 엔터프라이즈 거버넌스는 Vertex AI 경로다.
(A) 오답: 소비자용 API 키는 VPC-SC·감사 등 거버넌스 통제가 안 걸리고, 월 개정 지식에 파인튜닝은 재학습 부담이 비현실적이다.
(C) 오답: Vertex AI 경로는 맞지만 월 1회 파인튜닝은 "자주 바뀌는 지식 = RAG" 원칙에 어긋난다 — 함정 선택지.
(D) 오답: AutoML 분류는 Q&A·근거 표시 요구와 무관하고, Cloud Armor는 엣지 WAF라 데이터 경계 통제(VPC-SC)와 레이어가 다르다.
</details>

**Q9.** HRL이 "경기 예측 모델의 정확도를 높이고, 그 예측을 전 세계 시청자에게 최소 지연으로 전달"하려 한다. 아키텍트의 설계로 가장 적절한 것은?

- (A) 예측은 단일 리전에서 학습·서빙하고, 예측 JSON을 Cloud CDN으로 캐싱해 전 세계 배포
- (B) 정확도는 모델 학습(커스텀 학습/GPU)으로, 저지연 서빙은 사용자 인근 리전 배포+전용 엔드포인트로 분리 설계
- (C) 정확도·지연 모두 Global external Application LB로 해결
- (D) 예측을 사전학습 Translation API로 전처리해 지연을 줄인다

<details markdown="1">
<summary>답</summary>
**정답 (B)**. HRL 문제는 "정확도(모델 계층) + 저지연(서빙·배포 계층)"이 세트이며, 두 계층을 분리해 각각의 프리미티브로 답한다.
(A) 오답: 예측 결과를 CDN 캐싱하면 실시간 예측이 신선하지 않게 되고, 정확도 향상 요구에는 답하지 못한다.
(C) 오답: LB/CDN은 배포 지연을 줄이지만 모델 정확도와는 무관한 계층이다 — 계층 혼동 함정.
(D) 오답: Translation API는 번역용으로 예측 지연과 아무 상관이 없다.
</details>

**Q10.** 애플리케이션이 Vertex AI 엔드포인트와 Vector Search를 호출한다. 보안 검토에서 "데이터가 조직 경계 밖으로 유출되지 않도록 하라"와 "애플리케이션이 사용자 자격증명이 아니라 최소권한으로 호출하라"는 두 요구가 나왔다. 각각의 정답 레이어는?

- (A) 유출 방지=IAM 커스텀 역할, 최소권한 호출=VPC Service Controls
- (B) 유출 방지=Cloud Armor, 최소권한 호출=Service Account
- (C) 유출 방지=VPC Service Controls, 최소권한 호출=Service Account + 최소권한 IAM 역할
- (D) 유출 방지=CMEK, 최소권한 호출=Basic Role(Editor)

<details markdown="1">
<summary>답</summary>
**정답 (C)**. "데이터가 경계를 넘으면 안 됨"은 VPC-SC(데이터 경계 레이어), "누가 어떤 권한으로 호출하나"는 Service Account + 최소권한 사전정의/커스텀 역할(IAM 레이어)이다.
(A) 오답: 두 레이어를 뒤바꿨다 — IAM은 "누가"이고 VPC-SC는 "데이터가 어디로"다.
(B) 오답: Cloud Armor는 엣지 WAF/DDoS라 데이터 유출 경계 통제가 아니다.
(D) 오답: CMEK는 암호화 키 통제이지 경계 통제가 아니며, Editor 같은 Basic Role을 서비스 계정에 주는 것은 최소권한 위반이다.
</details>

**Q11.** 회사가 콜센터 녹취를 텍스트로 변환한 뒤, 통화의 감정과 핵심 엔티티를 추출하려 한다. 표준 작업이고 자체 학습 데이터는 없다. 가장 비용·운영 효율적인 것은?

- (A) Speech-to-Text API로 전사 → Natural Language API로 감정·엔티티 추출
- (B) AutoML로 음성 인식 모델과 감정 분류 모델을 각각 학습
- (C) 커스텀 학습으로 STT·NLU 모델을 직접 구축
- (D) Vertex AI Vector Search로 통화를 임베딩해 유사도 분석

<details markdown="1">
<summary>답</summary>
**정답 (A)**. 전사(STT)와 감정·엔티티 추출은 모두 표준 인지 작업이라 사전학습 API 두 개의 조합이 정답이다 — ML 사다리 최상단 칸.
(B) 오답: 표준 작업에 AutoML 학습은 불필요한 데이터·비용을 요구하는 오버킬이고, 애초에 자체 학습 데이터가 없다.
(C) 오답: 커스텀 학습은 더 큰 오버킬이다.
(D) 오답: Vector Search는 유사도 검색용으로 감정·엔티티 추출이라는 요구와 맞지 않는다.
</details>

**Q12.** TerramEarth가 "차량 텔레메트리로 부품 고장을 사전 예측하는 예지 정비"를 구축한다. 회사에는 텔레메트리 라벨 데이터와 ML 팀이 있으며, 모델 아키텍처를 자사 도메인에 맞게 완전히 통제하려 한다. 모델 학습 전략은?

- (A) Vision API로 부품 이미지를 분석
- (B) 사전학습 Natural Language API로 로그를 분류
- (C) Vertex AI 커스텀 학습(GPU/TPU)으로 예지 정비 모델을 직접 구축
- (D) 소비자용 Gemini API에 텔레메트리를 프롬프트로 넣어 예측

<details markdown="1">
<summary>답</summary>
**정답 (C)**. 자체 라벨 데이터 + ML 팀 + 완전한 모델 통제 요구 — ML 사다리의 커스텀 학습 칸이다. (인력이 얇았다면 AutoML이 답이었을 것이다.)
(A)·(B) 오답: 표준 인지 API는 도메인 특화 시계열 예지 정비를 다루지 못한다 — 사다리 칸 혼동 함정.
(D) 오답: 소비자용 Gemini API는 엔터프라이즈 거버넌스가 없고, 프롬프트만으로 시계열 고장 예측의 정확도·재현성을 보장할 수 없으며 보유한 학습 자산을 낭비한다.
</details>
