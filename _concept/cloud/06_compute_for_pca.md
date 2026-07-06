---
layout  : concept
title   : Google Cloud 컴퓨트 옵션 선택 결정
date    : 2026-06-30 00:00:00 +0900
updated : 2026-07-06 00:00:00 +0900
tag     : cloud gcp compute engine cloudrun pca
toc     : true
comment : true
latex   : false
status  : complete
public  : true
parent  : [[/cloud]]
confidence     : high
valid_from     : 2026-06-30
relations:
  - { type: references, target: /concept/cloud/04_gke_for_pca }
---

* TOC
{:toc}

> PCA 시험에서 컴퓨트 문제는 "어떤 서비스가 좋은가"를 묻지 않는다. 묻는 것은 항상 **요구사항을 서비스로 매핑하는 의사결정**이다 — 상태를 유지하는가, 실행이 얼마나 오래 걸리는가, 운영 부담을 얼마나 질 것인가, 다른 클라우드로 옮겨야 하는가, 비용 모델은 무엇인가. 같은 컨테이너라도 "초당 요청을 받는 웹"이면 Cloud Run이고 "GPU·DaemonSet이 필요한 플랫폼"이면 GKE다. 이 글은 PCA 준비 시리즈에서 컴퓨트 축을 다루며, 서비스별 기능을 나열하기보다 **요구사항 → 선택 기준 → 결론**의 결정 회로를 만든다.

---

## 도입 — 컴퓨트 선택은 5개 축의 교차점

GCP 컴퓨트는 추상화 수준에 따라 한 줄로 늘어선다.

```
더 많은 제어 ◄─────────────────────────────────────► 더 적은 운영
Compute Engine   GKE        Cloud Run / App Engine Flex   App Engine Std / Cloud Run functions
(VM)             (컨테이너   (서버리스 컨테이너)            (서버리스 PaaS·함수)
                  오케스트레이션)
```

왼쪽으로 갈수록 인프라 제어권이 크고 운영 책임도 크다. 오른쪽으로 갈수록 Google이 더 많이 떠맡고 사용자는 코드에 집중한다. PCA 시험은 이 스펙트럼 어디에 요구사항을 떨어뜨릴지를 묻는다.

판단은 다섯 개 축으로 분해된다.

| 축 | 핵심 질문 |
|------|----------|
| **상태(State)** | 인스턴스가 로컬 디스크·세션 상태를 유지해야 하는가, 무상태인가 |
| **실행 시간(Runtime)** | 요청-응답(수 초)인가, 장시간 배치(수 시간)인가, 상시 가동인가 |
| **운영 부담(Ops)** | OS 패치·스케일링·가용성을 누가 책임지는가 |
| **포팅성(Portability)** | 다른 클라우드·온프렘으로 옮길 수 있어야 하는가 (컨테이너·표준 런타임) |
| **비용 모델(Cost)** | 사용한 만큼(요청·vCPU초)인가, 프로비저닝한 만큼(VM 시간)인가 |

<div class="callout-note">
이 글의 지도: 컴퓨트 스펙트럼 정신모델 → Compute Engine(머신 패밀리·Spot·CUD·SUD·sole-tenant) → Google Cloud VMware Engine → MIG와 오토스케일링 → VM Manager(패치 관리) → Cloud Run → Cloud Run functions → 서버리스 네트워킹 → App Engine → <strong>최종 의사결정 표(VM vs 컨테이너 vs 서버리스)</strong> → 시험 공략 → 퀴즈. 각 축은 "요구사항 → 선택 기준 → 결론"으로 닫는다. GKE의 내부 심화는 <a href="#">04_gke_for_pca</a>에 있고 여기서는 "언제 GKE인가"만 다룬다.
</div>

---

## Compute Engine — 머신 패밀리 선택

Compute Engine은 가장 낮은 추상화다. OS·런타임·스케일링·패치를 사용자가 책임진다(다만 패치·인벤토리·구성은 뒤에서 다룰 **VM Manager**로 중앙 자동화할 수 있다). 그 대가로 거의 모든 것을 제어한다 — 커널, GPU, 로컬 SSD, 특정 라이선스. 첫 번째 결정은 **머신 패밀리**다.

### 머신 패밀리 분류

머신 타입은 `e2-standard-4`처럼 `패밀리-타입-vCPU수` 형식이다. 패밀리는 워크로드 성격에 따라 세 갈래로 나뉜다.

| 분류 | 패밀리(대표) | vCPU:메모리 성격 | 대표 용도 |
|------|------------|----------------|----------|
| **범용(General-purpose)** | E2, N2, N2D, N1, **T2D(x86)·T2A(Arm)**, C4/N4(최신) | 균형 잡힌 비율 | 웹 서버, 앱 서버, 소규모 DB, 대부분의 일반 워크로드 |
| **컴퓨트 최적화(Compute-optimized)** | C3, C2, C2D | 코어당 고성능, 높은 클럭 | HPC, 게임 서버, 단일 스레드 성능이 중요한 연산 |
| **메모리 최적화(Memory-optimized)** | M1, M2, M3 | vCPU 대비 매우 큰 메모리 | 인메모리 DB(SAP HANA), 대용량 인메모리 분석 |
| **가속기 최적화(Accelerator)** | A2, A3, G2 | **GPU 부착** | ML 학습·추론, GPU 렌더링 |

<div class="callout-warning">
가속기 패밀리(A2·A3·G2)는 <strong>GPU가 부착된 머신</strong>이다. <strong>TPU는 이 머신 패밀리에 붙지 않는다</strong> — TPU는 별도의 Cloud TPU 제품이며, 대규모 AI 학습을 위한 통합 인프라(AI Hypercomputer)의 일부다. 시험에서 "TPU"가 보이면 가속기 머신 패밀리가 아니라 Cloud TPU를 떠올려야 한다. TPU·대규모 AI 학습 인프라는 <a href="#">12_genai_for_pca</a>에서 다룬다.
</div>

범용 패밀리 안에서도 성격이 갈린다.

| 패밀리 | 특징 | 언제 |
|--------|------|------|
| **E2** | 비용 최적화. 가격이 가장 낮음 | 비용에 민감한 일반 워크로드, 개발·테스트 |
| **N2 / N2D** | 균형형. N2=Intel, N2D=AMD EPYC | 안정적인 성능이 필요한 프로덕션 범용 |
| **T2D (Tau, x86)** | 스케일아웃 최적화. **x86(AMD EPYC)**. 코어당 가격 대비 성능 우수 | 수평 확장형 x86 워크로드(스케일아웃 웹·마이크로서비스) |
| **T2A (Tau, Arm)** | 스케일아웃 최적화. **Arm(Ampere Altra)** 기반 | Arm 네이티브로 빌드된 워크로드(가격 대비 성능, Arm 컨테이너) |
| **C3** | 최신 Intel(Sapphire Rapids). 일관된 고성능 | 성능 일관성이 중요한 최신 워크로드 |

<div class="callout-warning">
T2D와 T2A는 같은 Tau 계열이지만 <strong>CPU 아키텍처가 다르다</strong>. T2D는 <strong>x86(AMD)</strong>, T2A는 <strong>Arm(Ampere)</strong>다. Arm은 바이너리·컨테이너 이미지가 Arm용으로 빌드돼 있어야 동작한다 — x86 이미지를 그대로 못 올린다. "Arm 네이티브로 빌드한 워크로드", "Arm 기반에서 가격 대비 성능을 보겠다"가 T2A의 시그니처다. 멀티아키텍처 빌드가 준비되지 않았다면 T2D(x86)가 안전하다.
</div>

<div class="callout-warning">
패밀리마다 <strong>지원하는 할인·기능이 다르다</strong>. 대표적으로 <strong>E2는 Sustained Use Discount가 적용되지 않는다</strong>(이미 낮은 가격으로 책정). 또한 일부 패밀리는 로컬 SSD·특정 CUD 유형에 제약이 있다. 시험에서 "비용 최적화"라는 키워드만 보고 무조건 E2를 고르면 함정에 빠질 수 있다 — SUD를 함께 활용할 수 있는 N2 계열이 장기 가동에서는 더 저렴해지는 경우가 있다.
</div>

**커스텀 머신 타입**: 사전 정의 타입이 맞지 않으면 vCPU와 메모리를 직접 조합한다. "워크로드가 vCPU는 적게 쓰는데 메모리만 많이 필요"하면 표준 타입은 낭비다 — 커스텀으로 메모리만 키운다.

**결론**: 일반 워크로드·비용 민감 → **E2**. 안정적 프로덕션 범용 → **N2/N2D**. 스케일아웃 → **Tau(T2D)**. 코어당 고성능 HPC → **C3/C2**. 큰 메모리(SAP HANA 등) → **M 계열**. GPU → **A 계열**. 리소스 비율이 어긋나면 → **커스텀 머신 타입**.

---

## Compute Engine — 할인 모델

PCA에서 비용 최적화 문제의 절반이 이 네 가지다. 각각이 적용되는 조건이 다르다.

### Spot VM — 선점형 인스턴스

Spot VM은 Google의 여유 용량을 매우 큰 할인(흔히 정상 가격 대비 큰 폭)으로 제공하되, **Google이 용량을 회수할 때 언제든 선점(preempt)·종료**할 수 있다. 종료 직전 짧은 통지(약 30초 수준)와 함께 종료된다.

<div class="compare-grid">
<div class="compare-col" markdown="1">

**Preemptible VM (구형)**

- 최대 수명 **24시간** — 24시간 후 강제 종료
- 고정된 할인율
- 레거시 모델

</div>
<div class="compare-col" markdown="1">

**Spot VM (현행·권장)**

- **24시간 제한 없음** — 선점되기 전까지 무기한 실행 가능
- 동적 가격(시장 상황 반영)
- Preemptible의 기능을 모두 포함하는 상위 모델

</div>
</div>

두 모델의 **공통 제약**이 시험 포인트다.

- **언제든 종료**될 수 있다 (가용성 보장 없음, SLA 없음).
- **라이브 마이그레이션 없음** — 유지보수 시 종료된다.
- 종료 시 짧은 통지만 주어진다. 이 통지에 shutdown 스크립트를 걸어 체크포인트를 저장하는 패턴이 표준이다.

<div class="callout-warning">
가장 자주 나오는 함정 두 가지. ① <strong>Spot/Preemptible은 stateful·항상 가용해야 하는 워크로드에 부적합</strong>하다 — 결제 처리, 단일 인스턴스 DB 등에 쓰면 안 된다. ② 둘의 결정적 차이는 <strong>Preemptible은 24시간 강제 종료가 있고 Spot은 없다</strong>는 것. "중단을 견디지만 24시간보다 오래 실행되어야 한다"면 Spot이 정답이고 Preemptible은 오답이다.
</div>

**적합한 워크로드**: 내결함성 있는 배치 처리, 분산 렌더링, CI 빌드, 분석 잡(작업이 다른 노드로 재시도 가능), 체크포인트가 가능한 ML 학습.

### Committed Use Discounts (CUD) — 약정 할인

1년 또는 3년 사용을 약정하고 큰 폭의 할인을 받는다. 두 종류가 있고, 이 둘의 구분이 시험에 나온다.

| CUD 유형 | 약정 대상 | 유연성 | 적용 범위 |
|----------|----------|--------|----------|
| **Resource-based CUD** | 특정 리전의 특정 vCPU·메모리 양 | 낮음(머신 타입·리전에 묶임) | 해당 리전의 해당 리소스 사용에만 |
| **Flexible(Spend-based) CUD** | 시간당 **지출 금액**($/hr) | 높음(머신 패밀리·리전 넘나듦) | 약정 지출 한도까지 폭넓게 |

- **Resource-based**: "이 리전에서 N2 vCPU 100개를 3년간 쓰겠다"는 식. 사용 패턴이 안정적이고 머신 타입이 고정일 때 할인 폭이 가장 크다. 단, 약정한 리소스를 다 못 쓰거나 다른 패밀리로 옮기면 손해다.
- **Flexible CUD**: "시간당 $10을 컴퓨트에 쓰겠다"는 식. 머신 패밀리나 리전을 바꿔도 약정이 따라온다. 유연성이 큰 대신 할인 폭은 보통 resource-based보다 작다.

<div class="callout-tip">
선택 기준: 워크로드가 <strong>안정적이고 머신 타입이 고정</strong>이면 resource-based(할인 최대화). 워크로드 구성이 <strong>바뀔 여지가 있거나 여러 패밀리를 섞어 쓰면</strong> flexible(유연성 우선). CUD는 1년·3년 모두 가능하고, 3년 약정이 할인 폭이 더 크다.
</div>

### Sustained Use Discounts (SUD) — 지속 사용 할인

**자동으로** 적용되는 할인이다. 약정도, 설정도 필요 없다. 특정 머신 패밀리(N1·N2·N2D·C2 등)를 한 달 중 상당 비율 이상 가동하면 사용량이 늘수록 단가가 자동으로 내려간다.

- **약정 불필요** — 그냥 오래 켜두면 적용된다.
- **E2와 Tau(T2D) 등 일부 패밀리에는 적용되지 않는다** (E2는 이미 낮은 가격).
- CUD와 비교하면 SUD는 "약정 없는 자동 할인", CUD는 "약정 기반 더 큰 할인"이다.

### 네 가지 할인 정리

| 할인 | 약정 | 적용 방식 | 핵심 트레이드오프 |
|------|------|----------|------------------|
| **Spot/Preemptible** | 없음 | 즉시(가장 큰 할인) | 언제든 선점·종료, 가용성 없음 |
| **SUD** | 없음 | 자동(오래 켜두면) | 패밀리 제약(E2 미적용), 할인 폭 보통 |
| **Resource-based CUD** | 1·3년, 리소스 고정 | 청구서 할인 | 가장 큰 안정 할인, 유연성 낮음 |
| **Flexible CUD** | 1·3년, 지출 고정 | 청구서 할인 | 패밀리·리전 유연, 할인 폭 다소 작음 |

**결론**: 중단 견디는 배치 → **Spot**. 항상 켜둘 안정 워크로드, 머신 타입 고정 → **Resource-based CUD**. 구성이 변할 수 있는 장기 워크로드 → **Flexible CUD**. 별도 노력 없이 받는 기본 할인 → **SUD(자동)**. 이 넷은 배타적이지 않고 (예: CUD + SUD) 조합될 수 있다.

---

## Compute Engine — Sole-tenant 노드

기본적으로 VM은 다른 고객의 VM과 물리 서버를 공유한다(멀티테넌트). **Sole-tenant node**는 물리 서버 한 대를 **당신의 VM 전용**으로 잡는다 — 다른 고객의 워크로드가 같은 하드웨어에 올라오지 않는다.

용도는 두 가지로 좁다.

| 용도 | 설명 |
|------|------|
| **라이선스(BYOL)** | 물리 코어·소켓 단위로 과금되는 소프트웨어 라이선스(일부 상용 OS·DB)를 가져올 때. 물리 서버 단위 가시성이 있어야 코어 기반 라이선스를 준수할 수 있다 |
| **컴플라이언스·격리** | 규제·보안상 물리적 격리(하드웨어를 타 고객과 공유 금지)가 요구될 때 |

<div class="callout-warning">
시험에서 "물리 서버 단위 라이선스를 GCP로 가져와야 한다(bring-your-own-license)" 또는 "규정상 물리적으로 격리된 전용 하드웨어가 필요하다"가 나오면 답은 <strong>sole-tenant node</strong>다. 단순 성능·비용 최적화가 목적이면 sole-tenant가 아니다 — 오히려 더 비싸다.
</div>

**결론**: 물리 단위 라이선스 준수(BYOL)·물리적 격리 컴플라이언스 → **sole-tenant node**. 그 외에는 불필요.

---

## Google Cloud VMware Engine — VMware 자산 리프트앤시프트

온프렘에 이미 vSphere로 돌아가는 대규모 VMware 워크로드가 있고, 이를 **재작성·재플랫폼 없이 빠르게** GCP로 옮겨야 할 때가 있다. 컨테이너화·서버리스 전환은 시간이 걸리고, 일부 워크로드는 애초에 재작성이 불가능하다(상용 어플라이언스, 손댈 수 없는 레거시). 이때가 **Google Cloud VMware Engine(GCVE)**다.

GCVE는 Google이 운영하는 베어메탈 인프라 위에 **완전한 VMware 스택(vSphere·vCenter·vSAN·NSX)을 관리형으로** 올려준다. 사용자는 익숙한 vCenter로 기존과 동일하게 VM을 운영하고, 온프렘 VM을 거의 변경 없이 그대로 이전한다.

| 항목 | 설명 |
|------|------|
| **마이그레이션 방식** | 기존 VMware VM을 **리프트앤시프트**(재작성·재플랫폼 없이 그대로 이전) |
| **운영 인터페이스** | 기존 **vSphere/vCenter 도구·프로세스 유지** — 운영팀 재교육 최소 |
| **관리 범위** | Google이 하드웨어·하이퍼바이저 스택을 관리(관리형 VMware) |
| **GCP 연동** | 같은 VPC 네트워크로 BigQuery·Cloud Storage 등 네이티브 서비스와 연결 |

<div class="callout-tip">
시험 신호어: <strong>"기존 VMware/vSphere를 그대로"</strong>, <strong>"재플랫폼 없이 빠르게 이전"</strong>, "vSphere 운영을 유지하면서", "대규모 VMware 자산을 단기간에 클라우드로". 이 조합이 보이면 Compute Engine으로의 재구축이 아니라 <strong>Google Cloud VMware Engine</strong>이다.
</div>

<div class="callout-warning">
함정 구분: GCVE는 <strong>마이그레이션·운영 연속성</strong>이 목적이지 비용 최적화나 클라우드 네이티브 현대화가 목적이 아니다. "장기적으로 컨테이너·서버리스로 현대화하라"는 요구면 GKE/Cloud Run이고, "지금 당장 vSphere 자산을 변경 없이 옮겨야 한다"는 요구면 GCVE다. 둘은 보통 단계로 이어진다(먼저 GCVE로 이전 → 이후 점진적 현대화).
</div>

**결론**: 대규모 VMware/vSphere 자산을 재작성 없이 빠르게 이전 + vSphere 운영 유지 → **Google Cloud VMware Engine**. 클라우드 네이티브 현대화가 1차 목표면 그 대상은 GKE·Cloud Run.

---

## MIG와 오토스케일링 — VM에 탄력성 입히기

단일 VM은 죽으면 끝이고 트래픽이 늘면 수동으로 늘려야 한다. **Managed Instance Group(MIG)**은 동일한 **인스턴스 템플릿**으로 VM 집합을 만들어 자동 복구·자동 확장·롤링 업데이트를 제공한다. "VM 기반인데 가용성과 탄력성이 필요"하면 MIG가 출발점이다.

### MIG의 네 기능

| 기능 | 설명 |
|------|------|
| **자동 복구(Autohealing)** | health check가 실패한 인스턴스를 자동으로 재생성 |
| **오토스케일링** | 부하에 따라 인스턴스 수를 자동 증감 |
| **롤링 업데이트** | 새 템플릿으로 인스턴스를 점진적으로 교체(canary·surge 설정) |
| **로드 밸런싱 연동** | LB의 백엔드로 등록되어 트래픽 분산 |

### Stateless MIG vs Stateful MIG

MIG는 기본적으로 **stateless(무상태)**를 전제한다 — 모든 인스턴스가 동일한 템플릿에서 나온 교체 가능한 소모품이라, 죽으면 새 인스턴스로 갈아끼워도 아무것도 잃지 않는다. 웹·API·스케일아웃 워커의 표준 형태다.

그런데 인스턴스마다 **고유한 상태**(특정 영구 디스크, 고정 인스턴스 이름, 고정 내부 IP)를 지녀야 하는 워크로드가 있다. 이때는 **stateful MIG**를 쓴다 — stateful 구성(stateful policy / per-instance config)으로 각 인스턴스의 디스크·이름·IP를 보존한다. 자동 복구나 업데이트로 인스턴스가 재생성돼도 그 상태가 새 인스턴스에 다시 붙는다.

| 구분 | Stateless MIG | Stateful MIG |
|------|--------------|--------------|
| 인스턴스 성격 | 교체 가능한 소모품 | 고유 상태 보존(디스크·이름·IP) |
| 대표 워크로드 | 무상태 웹·API·스케일아웃 워커 | 상태 있는 레거시 앱, 특정 디스크에 묶인 클러스터 노드 |
| autohealing·업데이트 | 그냥 새 인스턴스로 교체 | 상태를 새 인스턴스에 다시 부착 |

<div class="callout-warning">
함정: "MIG는 무상태 전용"이라고 단정하면 틀린다. 인스턴스별 영구 디스크·고정 이름을 <strong>보존해야 하는</strong> 요구가 나오면 답은 stateful MIG다. 다만 대다수 오토스케일 웹 워크로드는 stateless가 정석이며, 무상태로 재설계할 수 있으면 그쪽이 운영이 단순하다. "상태를 보존해야 한다"는 명시가 있을 때만 stateful을 고른다.
</div>

### 오토스케일링 신호

MIG 오토스케일러는 네 종류의 신호로 인스턴스 수를 조절한다.

| 신호 | 기준 | 용도 |
|------|------|------|
| **CPU 사용률** | 평균 CPU 목표치(예: 60%) | 가장 기본. CPU 바운드 워크로드 |
| **로드 밸런싱 처리 용량** | LB 백엔드의 서빙 용량 사용률 | HTTP(S) LB 뒤의 웹 서버 |
| **Cloud Monitoring 커스텀 메트릭** | 임의 지표(큐 길이, 초당 요청 등) | CPU로 표현 안 되는 부하(예: Pub/Sub 대기 메시지) |
| **스케줄 기반** | 시간표(예: 매일 09시 증설) | 예측 가능한 주기적 트래픽 |

<div class="callout-tip">
"트래픽이 CPU와 무관하게 큐 적체로 늘어난다"면 CPU 기반이 아니라 <strong>커스텀 메트릭(Cloud Monitoring) 기반 오토스케일링</strong>이다. "매일 정해진 시간에 부하가 예측된다"면 <strong>스케줄 기반</strong>을 함께 건다. CPU 기반만이 정답인 줄 알면 함정에 걸린다.
</div>

### Regional MIG vs Zonal MIG

가용성 설계의 핵심 선택이다.

| 구성 | 분산 | 가용성 | 권장 |
|------|------|--------|------|
| **Zonal MIG** | 단일 존 | 존 장애 시 전체 다운 | 단순·비프로덕션 |
| **Regional MIG** | 리전 내 여러 존에 분산 | **단일 존 장애를 견딤** | 프로덕션 기본 |

<div class="callout-warning">
프로덕션 고가용성 요구가 있으면 거의 항상 <strong>Regional MIG</strong>다. 인스턴스가 여러 존에 자동 분산되어 한 존이 죽어도 다른 존에서 서비스가 유지된다. "고가용성"이라는 키워드가 보이면 Zonal이 아니라 Regional을 의심하라.
</div>

### Health Check — autohealing과 LB는 다르다

health check는 두 곳에서 쓰이며 목적이 다르다. 이걸 혼동하면 안 된다.

| health check 위치 | 실패 시 동작 |
|------------------|------------|
| **MIG autohealing health check** | 인스턴스를 **재생성**(VM 자체가 죽었다고 판단) |
| **로드 밸런서 health check** | 트래픽만 **제외**(VM은 살려둠, 일시적 비정상으로 판단) |

autohealing health check는 보수적으로 설정한다 — 너무 민감하면 잠깐 느린 인스턴스를 계속 재생성해 오히려 불안정해진다.

**결론**: VM 기반에 탄력성·가용성이 필요하면 → **MIG**. 프로덕션 HA → **Regional MIG**. 부하 성격에 맞는 오토스케일 신호 선택(CPU / LB 용량 / 커스텀 메트릭 / 스케줄). autohealing은 "재생성", LB health check는 "트래픽 제외".

---

## VM Manager — VM 패치·인벤토리·구성 관리

Compute Engine에서 "OS 패치는 사용자 책임"이라는 말은 **수동으로 하라**는 뜻이 아니다. GCP는 VM 플릿의 패치·인벤토리·구성을 중앙에서 다루는 **VM Manager** 도구 모음을 제공한다. "수백 대 VM의 패치 규정 준수를 어떻게 관리하느냐"가 요구사항이면 직접 SSH로 도는 게 아니라 VM Manager다.

VM Manager는 세 기능으로 나뉜다.

| 기능 | 역할 |
|------|------|
| **OS Patch Management** | 패치 **스케줄**로 배포를 예약하고, 어떤 VM이 패치되었는지 **규정 준수(compliance) 리포트**를 보고, 패치 배포를 중앙에서 실행 |
| **OS Inventory Management** | 각 VM의 설치된 패키지·OS 버전 등 **인벤토리 데이터 수집·조회** |
| **OS Configuration Management(OS Config)** | 원하는 소프트웨어·구성 상태를 **선언적으로 정의**하고 VM에 적용·유지 |

동작 전제는 대상 VM에 **OS Config 에이전트**가 있고 적절한 권한이 부여되어야 한다는 것이다.

<div class="callout-tip">
시험 신호어: "여러 VM의 <strong>패치를 스케줄링</strong>하고 <strong>패치 규정 준수를 리포트</strong>해야 한다", "VM 플릿의 설치 패키지·OS 버전을 한눈에 봐야 한다". 직접 스크립트·SSH가 아니라 <strong>VM Manager(OS Patch Management / OS Inventory / OS Config)</strong>가 답이다.
</div>

**결론**: Compute Engine의 OS 패치·인벤토리·구성을 중앙에서 자동화·규정 준수 관리 → **VM Manager**. 서버리스(Cloud Run·App Engine)는 애초에 OS 패치가 플랫폼 책임이라 이 도구가 필요 없다.

---

## Cloud Run — 서버리스 컨테이너

Cloud Run은 **컨테이너 이미지**를 받아 서버리스로 실행한다. 인프라(서버·스케일링·패치)는 전혀 보이지 않는다. 컨테이너를 쓰므로 **포팅성**이 좋고(어디서든 빌드한 이미지를 그대로), 사용한 만큼만 과금하며(요청 없으면 0으로 축소 가능), 자동으로 확장된다. "컨테이너인데 Kubernetes 운영 부담은 지기 싫다"의 표준 답이다.

### 핵심 개념

**동시성(Concurrency)**: 한 인스턴스가 동시에 처리하는 요청 수다. Cloud Run은 인스턴스당 **여러 요청을 동시 처리**할 수 있다(기본값이 1보다 큼, 상한 설정 가능). 이것이 함수형 FaaS와의 큰 차이다 — 함수형 모델은 전통적으로 인스턴스당 1요청에 가깝다.

<div class="callout-tip">
동시성을 높이면 같은 인스턴스가 더 많은 요청을 받아 <strong>인스턴스 수와 비용이 줄고 콜드스타트가 덜 발생</strong>한다. 단, 애플리케이션이 동시 요청에 안전(thread-safe)해야 하고, 요청당 메모리·CPU가 큰 워크로드는 동시성을 낮춰야 한다. 동시성 1로 두면 FaaS처럼 요청당 인스턴스가 된다.
</div>

**콜드스타트(Cold start)**: 인스턴스가 0으로 축소된 상태에서 첫 요청이 오면 컨테이너를 새로 띄우느라 지연이 생긴다. 

**최소 인스턴스(Min instances)**: 유휴 인스턴스를 항상 일정 수 유지해 콜드스타트를 없앤다. 단, 유휴 인스턴스도 과금되므로 "scale-to-zero의 비용 0" 이점을 일부 포기한다 — 지연 민감 서비스와 비용의 트레이드오프다.

### Cloud Run Services vs Jobs

같은 Cloud Run이지만 실행 모델이 다르다. 시험 포인트다.

<div class="compare-grid">
<div class="compare-col" markdown="1">

**Cloud Run Services**

- **요청 기반**(HTTP/이벤트) — 들어오는 요청을 처리
- 요청 수에 따라 자동 확장, 무요청 시 0으로 축소
- 장기 실행 서버형(웹 API, 백엔드)
- 요청-응답 모델, 요청 처리 시간 제한이 있음

</div>
<div class="compare-col" markdown="1">

**Cloud Run Jobs**

- **실행 후 완료(run-to-completion)** — 작업을 끝내고 종료
- HTTP 엔드포인트 없음. 배치·일회성·예약 작업
- 병렬 태스크로 분할 실행 가능(배열 작업)
- "데이터 마이그레이션", "야간 배치"처럼 끝이 있는 작업

</div>
</div>

<div class="callout-warning">
"HTTP 요청을 받는 서비스"인지 "실행되어 끝나는 배치 작업"인지로 갈린다. 야간 ETL, DB 마이그레이션, 일회성 처리는 <strong>Jobs</strong>. 요청을 받는 API·웹은 <strong>Services</strong>. 또한 Cloud Run에는 <strong>요청 처리 시간 상한</strong>이 있어 무한정 도는 워크로드에는 맞지 않는다 — 매우 긴 연속 처리는 GKE나 Compute Engine을 본다.
</div>

**CPU 할당**: Cloud Run은 기본적으로 요청을 처리하는 동안만 CPU를 할당한다(요청 밖 백그라운드 작업은 멈춤). 백그라운드 처리가 필요하면 "CPU always-on" 설정을 쓴다. "요청이 끝난 뒤에도 비동기 작업을 해야 하는데 멈춘다"면 이 설정을 의심한다.

**결론**: 무상태 컨테이너 + 요청 기반 + 운영 최소화 + 포팅성 → **Cloud Run Services**. 끝이 있는 배치·일회성 작업 → **Cloud Run Jobs**. 지연 민감하면 **min instances**로 콜드스타트 제거(비용 트레이드오프). 동시성 튜닝으로 인스턴스 수·비용 조절.

---

## Cloud Run functions — 이벤트 트리거 함수

예전 **Cloud Functions(2세대, 2nd gen)**는 **2024년 8월** Cloud Run 산하로 통합되며 **Cloud Run functions**로 개명됐다(시험·문서에서 아직 둘 다 마주칠 수 있으므로 같은 것으로 본다). 기존 2세대 함수는 자동으로 Cloud Run functions로 전환되고, 기존 API·gcloud·Terraform(Gen2) 경로는 계속 지원되며 가격·쿼터가 Cloud Run과 통합됐다. 1세대(1st gen) 함수는 자체 가격·쿼터로 별도 유지된다. 소스 코드(함수 한 덩어리)를 올리면 플랫폼이 빌드·실행하며, **이벤트나 HTTP 요청에 반응**하는 가장 작은 서버리스 단위다. 컨테이너 이미지를 직접 다루지 않고 함수 코드만 올린다는 점이 Cloud Run Services와의 출발점 차이다.

### 트리거 모델

| 트리거 | 설명 |
|--------|------|
| **HTTP 트리거** | HTTP(S) 엔드포인트로 직접 호출 |
| **이벤트 트리거** | **Eventarc**를 통해 다양한 소스의 이벤트에 반응(예: Cloud Storage 객체 생성, Pub/Sub 메시지 발행, Firestore 변경 등) |
| **Pub/Sub 트리거** | Pub/Sub 토픽에 메시지가 들어오면 함수 실행(비동기 메시지 처리) |

<div class="callout-tip">
시험 시그니처: <strong>"파일이 Cloud Storage에 업로드되면"</strong>, <strong>"Pub/Sub 메시지가 도착하면"</strong> 같은 <strong>단일 이벤트에 반응하는 짧은 코드</strong>는 Cloud Run functions다. 여러 소스의 이벤트를 표준 방식으로 연결할 때 그 배선이 <strong>Eventarc</strong>다.
</div>

<div class="callout-warning">
함정: 함수에는 <strong>실행 시간 상한(타임아웃)</strong>이 있어 오래 도는 처리에는 맞지 않는다. 또한 함수는 코드 한 덩어리 단위라, 복잡한 의존성·임의 컨테이너·여러 엔드포인트를 가진 서비스에는 Cloud Run Services가 낫다.
</div>

### Cloud Run과의 관계

Cloud Run functions는 내부적으로 **Cloud Run 위에서 동작**한다 — 함수 소스를 컨테이너로 빌드해 Cloud Run에서 실행하는 형태로 통합되었다. 따라서 동시성·min instances 같은 Cloud Run 개념을 일부 공유하지만, **추상화 수준이 다르다**: functions는 "이벤트에 반응하는 함수 코드", Cloud Run Services는 "직접 만든 컨테이너 이미지"다.

| 구분 | Cloud Run functions | Cloud Run Services |
|------|--------------------|--------------------|
| 배포 단위 | 함수 코드 | 컨테이너 이미지 |
| 주 용도 | 단일 이벤트/HTTP 트리거 | 임의 웹·API·백엔드 |
| 컨테이너 자유도 | 낮음(플랫폼이 빌드) | 높음(임의 이미지) |

**결론**: 단일 이벤트(Storage·Pub/Sub)·HTTP에 반응하는 짧은 함수 → **Cloud Run functions**. 임의 컨테이너·복잡한 서비스 → **Cloud Run Services**. 둘은 같은 Cloud Run 기반 위에 추상화 수준만 다르다.

---

## 서버리스 네트워킹 — VPC 내부 리소스 접근

서버리스(Cloud Run·Cloud Run functions)는 기본적으로 Google 관리 네트워크에서 실행되며, **VPC 내부의 비공개 리소스에 직접 접근하지 못한다**. "Cloud Run이 Cloud SQL의 **private IP**에 붙어야 한다", "VPC 안의 내부 서비스를 호출해야 한다"가 요구사항이면 서버리스를 VPC에 연결하는 두 가지 방법 중 하나가 답이다.

### VPC 연결 — 두 가지 egress 경로

<div class="compare-grid">
<div class="compare-col" markdown="1">

**Serverless VPC Access connector**

- VPC에 **커넥터 리소스를 별도 프로비저닝**(자체 서브넷·인스턴스)
- 서버리스에서 나가는 트래픽이 커넥터를 거쳐 VPC로 진입
- 오래된·안정적인 방식. 커넥터 자체의 처리량·비용을 관리

</div>
<div class="compare-col" markdown="1">

**Direct VPC egress**

- 별도 커넥터 인스턴스 **없이** 서비스가 VPC 서브넷에 직접 egress
- 커넥터 관리 오버헤드·홉이 줄어듦(더 단순·확장적)
- VPC 서브넷에서 IP 범위를 확보해 직접 연결

</div>
</div>

둘 다 목적은 같다 — 서버리스가 VPC 안의 비공개 리소스(Cloud SQL private IP, 내부 LB 뒤 서비스, VPC 내 VM 등)에 닿게 한다. Direct VPC egress가 더 새로운·단순한 경로지만, 선택지는 처리량·서브넷 IP 가용성·운영 단순성의 트레이드오프다.

### Ingress — 누가 호출할 수 있는가

egress(나가는 방향)와 별개로, **ingress 설정**은 서비스를 누가 호출할 수 있는지를 제어한다.

| ingress 설정 | 호출 허용 범위 |
|-------------|--------------|
| **all** | 인터넷 포함 모든 곳에서 호출 가능(공개) |
| **internal** | 같은 VPC·VPC SC 경계·일부 내부 경로에서만 호출 가능(외부 차단) |
| **internal + Cloud Load Balancing** | 내부 트래픽 + 지정한 외부 HTTP(S) LB 경유 트래픽만 허용 |

<div class="callout-tip">
방향을 헷갈리지 말 것. <strong>egress(VPC Access connector / Direct VPC egress)</strong> = 서버리스가 <strong>VPC 안으로 나가서</strong> 내부 리소스에 접근. <strong>ingress(all/internal/internal+LB)</strong> = <strong>누가 서버리스를 호출</strong>하느냐. "Cloud SQL private IP 접근"은 egress 문제, "이 서비스를 내부에서만 노출"은 ingress 문제다.
</div>

<div class="callout-warning">
자주 나오는 시그니처: <strong>"서버리스(Cloud Run)가 VPC 내부 리소스(예: Cloud SQL private IP)에 접근해야 한다"</strong> → Serverless VPC Access connector 또는 Direct VPC egress. <strong>"서비스를 외부에 노출하지 않고 내부 전용으로 두라"</strong> → ingress를 internal(또는 internal + LB)로.
</div>

**결론**: 서버리스 → VPC 비공개 리소스 접근(egress) = **Serverless VPC Access connector** 또는 **Direct VPC egress**(후자가 더 단순·신규 권장). 서비스 노출 범위 제어(ingress) = **all / internal / internal+LB**. egress와 ingress는 독립적으로 설정한다.

---

## App Engine — Standard vs Flexible

App Engine은 GCP의 원조 PaaS다. 코드를 올리면 플랫폼이 실행·확장한다. 두 환경의 차이가 시험에 자주 나온다.

<div class="compare-grid">
<div class="compare-col" markdown="1">

**Standard 환경**

- 샌드박스에서 실행. **지원 언어 런타임이 정해져 있음**(특정 버전의 Python·Java·Go·Node.js·PHP·Ruby 등)
- **0으로 축소 가능**(scale to zero) — 트래픽 없으면 인스턴스 0
- 빠른 시작·빠른 확장(급증 트래픽에 강함)
- 샌드박스 제약: 임의 바이너리·일부 시스템 호출 제한

</div>
<div class="compare-col" markdown="1">

**Flexible 환경**

- **컨테이너(Docker)** 위에서 실행 — 임의 런타임·언어·바이너리 가능
- Compute Engine VM 위에서 돌며 **최소 1 인스턴스**(0으로 축소 안 됨)
- 시작·확장이 상대적으로 느림(VM 기반)
- SSH 접근 등 더 넓은 제어, 커스텀 의존성 자유

</div>
</div>

<div class="callout-warning">
함정 두 개. ① <strong>Standard는 지원 언어 런타임이 제한적</strong>이다 — 목록에 없는 언어·임의 네이티브 의존성이 필요하면 Standard로 안 된다(Flexible 또는 Cloud Run). ② <strong>Flexible은 scale to zero가 안 된다</strong> — 항상 최소 1 인스턴스가 떠 있어 트래픽이 없어도 과금된다. "트래픽 없을 때 비용 0"이 요구사항이면 Flexible은 오답이다(Standard 또는 Cloud Run).
</div>

오늘날 Flexible의 많은 사용 사례는 Cloud Run으로 대체된다 — 둘 다 컨테이너 기반이지만 Cloud Run이 더 빠른 확장·scale to zero·요청 기반 과금을 제공한다. 시험에서 "컨테이너 + 서버리스 + scale to zero + 포팅성"이면 Cloud Run을 우선 본다.

<div class="callout-note">
<strong>시험에서 App Engine의 위치(레거시 관점).</strong> App Engine은 GCP 최초의 서버리스 PaaS로, 신규 설계의 기본값 자리를 Cloud Run·Cloud Run functions에 내준 지 오래다. 그래서 시험에서 App Engine은 <strong>둘 중 하나로</strong> 등장한다: ① <strong>정답</strong> — "지원 런타임으로 충분 + scale to zero + 급증 트래픽에 빠른 확장"처럼 Standard의 시그니처가 뚜렷할 때, ② <strong>함정 선택지</strong> — 요구가 "임의 컨테이너·포팅성·요청 과금"으로 Cloud Run을 가리키는데 Flexible을 그럴듯하게 끼워 넣을 때. 신규 컨테이너 서버리스는 Cloud Run이 기본값이라는 사실을 기준선으로 두면, App Engine이 정답인지 미끼인지 구분하기 쉽다.
</div>

**결론**: 지원 런타임으로 충분 + scale to zero 필요 → **App Engine Standard**. 임의 런타임·커스텀 바이너리 필요하지만 컨테이너 오케스트레이션은 과함 → **Flexible**(단 최소 1 인스턴스). 신규 컨테이너 서버리스 워크로드는 대체로 **Cloud Run**이 더 적합.

---

## 컴퓨트 선택 기준 — 최종 의사결정

시험의 핵심이다. VM(Compute Engine) vs 컨테이너(GKE) vs 서버리스(Cloud Run / App Engine / Cloud Run functions)를 요구사항으로 매핑한다.

### 다섯 축 기준 매핑 표

| 요구사항 | Compute Engine (VM) | GKE (컨테이너) | Cloud Run | App Engine Std | Cloud Run functions |
|----------|:---:|:---:|:---:|:---:|:---:|
| **상태 유지(stateful 로컬 디스크·세션)** | ✅ 강함(영구 디스크) | ✅ StatefulSet·PV | ⚠️ 무상태 전제 | ⚠️ 무상태 전제 | ❌ 무상태 |
| **장시간 실행(수 시간 연속)** | ✅ 무제한 | ✅ 무제한 | ⚠️ 요청 처리 시간 상한 / Jobs로 배치 | ⚠️ 제한적 | ❌ 짧은 실행 |
| **운영 부담 최소화** | ❌ OS·패치 직접 | ⚠️ 클러스터 운영(Autopilot로 완화) | ✅ 거의 없음 | ✅ 거의 없음 | ✅ 거의 없음 |
| **포팅성(컨테이너·이식)** | ⚠️ 이미지화 필요 | ✅ K8s 표준 | ✅ 컨테이너 표준 | ❌ 플랫폼 종속 | ❌ 플랫폼 종속 |
| **비용 모델** | 프로비저닝(VM 시간) | 노드 시간 / Pod 리소스 | 사용량(요청·vCPU초, 0 축소) | 사용량(0 축소) | 호출당(0 축소) |
| **세밀한 제어(GPU·커널·DaemonSet)** | ✅ 최대 | ✅ 높음 | ❌ 낮음 | ❌ 없음 | ❌ 없음 |

### 결정 흐름

```
요구사항 확인
    │
    ├── 커널·특정 OS·GPU 드라이버·sole-tenant·라이선스 BYOL 필요?
    │        └──→ Compute Engine (VM). 탄력성 필요하면 MIG
    │
    ├── 컨테이너 오케스트레이션(다수 컨테이너·서비스 메시·GPU 노드풀·
    │   DaemonSet·복잡한 스케줄링·멀티클라우드 K8s) 필요?
    │        └──→ GKE  (Autopilot로 운영 부담 완화, 상세는 04_gke_for_pca)
    │
    ├── 무상태 컨테이너 + 요청 기반 + 운영 최소화 + 포팅성?
    │        └──→ Cloud Run (Services). 배치·일회성이면 Cloud Run Jobs
    │
    ├── 지원 런타임으로 충분 + scale to zero + 빠른 확장?
    │        └──→ App Engine Standard
    │
    └── 단일 이벤트 트리거(파일 업로드·Pub/Sub 메시지)에 반응하는
        짧은 함수?
             └──→ Cloud Run functions
```

### 서비스별 결정 시그니처(시험 키워드)

| 요구사항 키워드 | 정답 |
|----------------|------|
| GPU 커스텀 구성, 커널 접근, 특정 OS | **Compute Engine** (또는 GKE Standard 노드풀) |
| 물리 단위 라이선스 BYOL, 물리적 격리 | **Compute Engine + sole-tenant node** |
| VM 기반 + 고가용성 + 오토스케일 | **Regional MIG** |
| VM 인스턴스별 고정 이름·디스크·IP 보존 + autohealing | **Stateful MIG** |
| 다수 컨테이너·서비스 메시·복잡한 오케스트레이션·멀티클라우드 K8s | **GKE** |
| K8s 운영 부담 줄이되 컨테이너 오케스트레이션 유지 | **GKE Autopilot** |
| 무상태 컨테이너 웹/API + 운영 최소 + scale to zero + 포팅성 | **Cloud Run (Services)** |
| 컨테이너 배치/일회성/예약 작업(끝이 있음) | **Cloud Run Jobs** |
| 표준 런타임 웹앱 + scale to zero + 급증 트래픽 | **App Engine Standard** |
| 임의 런타임·커스텀 바이너리, 컨테이너지만 K8s는 과함 | **App Engine Flexible** 또는 **Cloud Run** |
| 단일 이벤트(Storage·Pub/Sub) 트리거 짧은 코드 | **Cloud Run functions** |
| 중단 견디는 배치 + 최대 비용 절감 | **Compute Engine + Spot VM** (또는 GKE Spot 노드풀) |
| 기존 VMware/vSphere를 재플랫폼 없이 빠르게 이전 | **Google Cloud VMware Engine(GCVE)** |
| 다수 VM의 패치 스케줄·규정 준수 리포트·인벤토리 | **VM Manager(OS Patch Management)** |
| 서버리스(Cloud Run)가 VPC 비공개 리소스(Cloud SQL private IP) 접근 | **Serverless VPC Access connector / Direct VPC egress** |
| 서버리스 서비스를 외부 비노출·내부 전용으로 | **ingress = internal (또는 internal + LB)** |

<div class="callout-tip">
서버리스 3형제 구분: <strong>Cloud Run functions</strong>=단일 이벤트 트리거 함수(가장 작은 단위), <strong>Cloud Run</strong>=임의 컨테이너 서버리스(언어·의존성 자유, 포팅성), <strong>App Engine Standard</strong>=지원 런타임 한정 PaaS. 신규 설계에서 "컨테이너 + 서버리스"면 Cloud Run이 기본값이다.
</div>

**결론**: 제어가 필요할수록 왼쪽(VM·GKE), 운영을 덜고 싶을수록 오른쪽(Cloud Run·App Engine·Cloud Run functions). 상태·실행시간·운영부담·포팅성·비용모델 다섯 축으로 요구사항을 분해해 가장 오른쪽(가장 적은 운영)에서 요구사항을 만족하는 서비스를 고르는 것이 일반 원칙이다.

---

## 공식 케이스 스터디로 본 컴퓨트 결정

PCA 시험의 케이스 스터디 문항은 위 결정 회로를 **구체적 요구사항 문장**에 적용하는 연습이다. 컴퓨트 축과 직접 맞닿는 두 케이스를 짚는다.

### Mountkirk Games — 글로벌 세션형 멀티플레이어 게임

핵심 요구사항: 모바일 멀티플레이어 게임을 **글로벌 동시 출시**, 저지연 멀티플레이 세션, 오토스케일, 실시간 분석. 게임 서버는 컨테이너 기반으로 운영한다.

| 요구사항 조각 | 컴퓨트 결정 | 왜 |
|--------------|-----------|-----|
| 컨테이너 기반 게임 서버 + 오토스케일 + 세밀한 스케줄링 | **GKE(멀티리전/리전 클러스터)** | 게임 서버는 세션·네트워크·노드풀 제어가 필요 — 서버리스보다 오케스트레이션이 정석. 상세는 04_gke_for_pca |
| 저지연 세션을 위한 고성능 컴퓨트 | **컴퓨트 최적화 머신(C 계열) 노드풀** | 코어당 성능·낮은 지연이 중요한 게임 서버 성격 |
| 트래픽 급증(출시·이벤트)에 탄력 대응 | **오토스케일링**(GKE HPA/노드 오토스케일, 또는 VM이면 Regional MIG) | 예측 어려운 급증 → 부하 신호 기반 확장 |
| 비용 민감한 배치·분석 워커 | **Spot(GKE Spot 노드풀 / Spot VM)** | 중단 견디는 처리에 최저가 |

> 데이터 계층(Spanner·Pub/Sub·Dataflow·BigQuery)은 08·11 노트 소관이고, 여기서는 게임 서버의 **컴퓨트 런타임 선택**만 본다. 신호어 "컨테이너 게임 서버 + 멀티리전 + 오토스케일"이면 Cloud Run이 아니라 **GKE**가 기본값이다(세션·스테이트·노드 제어).

### TerramEarth — 차량 텔레메트리 배치·분석

핵심 요구사항: 전 세계 운행 차량의 텔레메트리를 수집·처리하고, 딜러 API를 제공하며, 데이터 처리 파이프라인을 현대화한다. 여기서 컴퓨트 축과 닿는 지점은 **배치 처리 워크로드**와 **이벤트 반응 처리**다.

| 요구사항 조각 | 컴퓨트 결정 | 왜 |
|--------------|-----------|-----|
| 대량 배치 데이터 처리(끝이 있는 잡), 비용 민감 | **Compute Engine + Spot VM** 또는 **GKE Spot 노드풀** | 내결함성 배치는 선점을 견디므로 최저가. 24h보다 길면 Preemptible이 아니라 Spot |
| 컨테이너화된 일회성/예약 배치 잡 | **Cloud Run Jobs** | HTTP 없는 run-to-completion 배치를 서버리스로 |
| "파일이 Cloud Storage에 올라오면 처리 시작"(딜러 배치 업로드) | **Cloud Run functions**(Storage/Eventarc 트리거) | 단일 이벤트 반응 짧은 처리의 시그니처 |
| 딜러용 API 백엔드(무상태, 요청 기반) | **Cloud Run Services** | 무상태 컨테이너 웹·API + scale to zero + 운영 최소 |

<div class="callout-warning">
케이스 함정: TerramEarth처럼 "배치 + 이벤트 + API"가 섞이면 <strong>하나의 서비스로 다 덮으려는</strong> 오답이 유혹한다. 배치(끝 있음)는 Cloud Run Jobs / Spot VM, 이벤트 반응(파일 도착·메시지)은 Cloud Run functions, 상시 요청 API는 Cloud Run Services — <strong>워크로드 성격별로 다른 컴퓨트</strong>가 정석이다. 반대로 Mountkirk의 게임 서버를 "서버리스로 단순화"하려 Cloud Run을 고르는 것도 함정 — 세션·저지연·노드 제어 요구가 GKE를 가리킨다.
</div>

---

## 시험장에서 — 빠른 판별

### 비교선택형 — 혼동 쌍

| 질문 | 판별 |
|------|------|
| Spot vs Preemptible | 둘 다 선점·종료 가능. **Preemptible=24h 강제 종료, Spot=24h 제한 없음** |
| Resource-based vs Flexible CUD | resource=리소스 고정(할인 최대, 유연성 낮음) / flexible=지출 고정(유연, 할인 다소 작음) |
| SUD vs CUD | SUD=약정 없는 자동 할인 / CUD=1·3년 약정 더 큰 할인 |
| Zonal vs Regional MIG | HA면 **Regional**(여러 존 분산) |
| autohealing HC vs LB HC | autohealing=**재생성** / LB=**트래픽만 제외** |
| Cloud Run Services vs Jobs | Services=요청 기반 서버 / Jobs=실행 후 완료 배치 |
| App Engine Standard vs Flexible | Standard=런타임 제한+scale to zero / Flexible=임의 런타임+최소 1 인스턴스 |
| Cloud Run vs App Engine Flexible | 둘 다 컨테이너. Cloud Run=scale to zero·요청 과금 / Flexible=최소 1 인스턴스 |
| Cloud Run vs Cloud Run functions | Run=임의 컨테이너 / functions=단일 이벤트 트리거 함수 |

### 트러블슈팅형

| 증상 | 점검 사항 |
|------|----------|
| 배치 VM이 24시간마다 죽는다 | Preemptible 사용 중 — 24h보다 길어야 하면 Spot으로 |
| Cloud Run 비용이 예상보다 높다 | min instances 설정으로 유휴 인스턴스 상시 과금 중인가 |
| Cloud Run에서 요청 종료 후 백그라운드 작업이 멈춘다 | CPU가 요청 중에만 할당됨 — CPU always-on 필요 |
| App Engine에 트래픽 없는데 과금된다 | Flexible 환경(최소 1 인스턴스) — scale to zero면 Standard |
| 비용 최적화로 E2 골랐는데 SUD가 안 잡힌다 | E2는 SUD 미적용 패밀리 |
| 한 존 장애에 MIG 전체가 다운 | Zonal MIG — Regional MIG로 |

---

## 실전 퀴즈 — 핵심 개념 검증

---

**Q1. Spot vs Preemptible — 실행 시간 제약**

내결함성 있는 분산 데이터 처리 잡이 있다. 작업은 중단되어도 다른 워커로 재시도되므로 인스턴스 선점을 견딘다. 하지만 전체 처리는 보통 **30시간** 이상 연속으로 돌아야 하며, 비용을 최대한 낮춰야 한다. 가장 적합한 옵션은?

- (A) Preemptible VM — 가장 큰 할인을 제공한다.
- (B) Spot VM — 선점을 견디면서도 24시간 제한이 없다.
- (C) 온디맨드 N2 + Resource-based CUD — 안정적이다.
- (D) Sole-tenant node — 전용 하드웨어로 성능이 보장된다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

핵심은 두 조건이다 — ① 선점을 견딘다(=Spot/Preemptible 후보), ② 30시간 이상 연속 실행이 필요하다. **Preemptible은 최대 24시간 후 강제 종료**되므로 30시간 연속 가동이 불가능하다. **Spot VM은 24시간 제한이 없어** 선점되기 전까지 무기한 실행되며, Preemptible과 동급의 큰 할인을 받는다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | Preemptible은 24h 강제 종료 — 30h 워크로드에 부적합 |
| (C) | 동작은 하지만 Spot 대비 비용 최적화가 약함(요구사항은 최저 비용) |
| (D) | sole-tenant는 비용 최적화가 아니라 오히려 더 비싸고, 라이선스·격리 용도 |

"중단은 견디지만 24시간보다 오래"가 Spot의 정확한 시그니처다.

</div>
</details>

---

**Q2. CUD 유형 선택 — 변화하는 워크로드**

기업이 컴퓨트에 장기 약정 할인을 받으려 한다. 향후 1~3년간 컴퓨트 지출 규모는 안정적으로 유지될 전망이나, **사용하는 머신 패밀리와 리전이 프로젝트마다 자주 바뀌고** 앞으로도 변할 예정이다. 가장 적합한 약정은?

- (A) Resource-based CUD — 특정 리전의 특정 vCPU·메모리에 약정한다.
- (B) Flexible(spend-based) CUD — 시간당 지출 금액에 약정한다.
- (C) Sustained Use Discount만 사용한다.
- (D) Spot VM으로 전환한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

요구사항의 핵심은 "지출 규모는 안정적이지만 **머신 패밀리·리전이 자주 바뀐다**"이다. **Flexible CUD는 지출 금액($/hr)에 약정**하므로 어떤 패밀리·리전을 쓰든 약정이 따라온다. Resource-based는 특정 리소스에 묶여 패밀리·리전을 바꾸면 할인이 적용되지 않는다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | 리소스 고정 약정 — 패밀리·리전이 자주 바뀌면 약정이 낭비됨 |
| (C) | SUD는 자동 할인이지만 약정 기반 CUD보다 할인 폭이 작고 "장기 약정 할인"이라는 요구를 충분히 못 채움 |
| (D) | Spot은 약정 할인이 아니라 선점형. 안정적 가동 워크로드에 부적합 |

resource-based가 할인 폭은 크지만 유연성이 핵심 요구사항이면 flexible이다.

</div>
</details>

---

**Q3. 컴퓨트 서비스 매핑 — 무상태 컨테이너 웹**

스타트업이 무상태(stateless) HTTP API를 컨테이너로 패키징했다. 요구사항: ① 트래픽이 없으면 비용이 0이어야 한다(scale to zero), ② Kubernetes 클러스터를 운영할 인력이 없다, ③ 추후 다른 클라우드로 옮길 수 있도록 컨테이너 표준을 유지한다, ④ 트래픽 급증 시 자동 확장. 가장 적합한 서비스는?

- (A) GKE Autopilot — 컨테이너를 가장 잘 다룬다.
- (B) Cloud Run (Services) — 서버리스 컨테이너로 네 요구를 모두 만족한다.
- (C) App Engine Flexible — 컨테이너를 지원한다.
- (D) Compute Engine MIG — 오토스케일링으로 트래픽에 대응한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

네 요구사항을 매핑한다.

| 요구사항 | Cloud Run 충족 |
|---------|---------------|
| scale to zero(무트래픽 비용 0) | ✅ 0으로 축소 |
| K8s 운영 불필요 | ✅ 서버리스, 클러스터 없음 |
| 컨테이너 표준(포팅성) | ✅ 임의 컨테이너 이미지 |
| 자동 확장 | ✅ 요청 기반 자동 확장 |

| 선택지 | 문제점 |
|--------|--------|
| (A) | GKE는 클러스터 운영 부담이 있음(Autopilot도 K8s 개념·운영 필요). "운영 인력 없음"에 과함 |
| (C) | App Engine Flexible은 **scale to zero 불가**(최소 1 인스턴스) — 요구 ① 위반 |
| (D) | MIG는 VM 기반 — 컨테이너 포팅성·scale to zero·운영 최소화 측면에서 Cloud Run보다 약함 |

"무상태 컨테이너 + scale to zero + 운영 최소 + 포팅성"은 Cloud Run의 정확한 시그니처다.

</div>
</details>

---

**Q4. MIG 가용성과 오토스케일 신호**

VM 기반 백엔드가 HTTP(S) 로드 밸런서 뒤에 있다. 요구사항: ① 단일 존 장애가 발생해도 서비스가 유지되어야 한다, ② 부하는 CPU가 아니라 **백엔드가 처리하는 초당 요청 수**에 비례해 늘어난다. 올바른 구성은?

- (A) Zonal MIG + CPU 사용률 기반 오토스케일링
- (B) Regional MIG + 로드 밸런싱 처리 용량(serving capacity) 기반 오토스케일링
- (C) Regional MIG + 스케줄 기반 오토스케일링
- (D) Zonal MIG + 커스텀 메트릭 기반 오토스케일링

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

두 요구사항을 각각 매핑한다.

| 요구사항 | 충족 |
|---------|------|
| 단일 존 장애 견딤(HA) | **Regional MIG**(여러 존 분산) — Zonal은 존 장애에 전체 다운 |
| 초당 요청 수에 비례한 확장 + HTTP(S) LB 뒤 | **LB 처리 용량 기반 오토스케일링** |

| 선택지 | 문제점 |
|--------|--------|
| (A) | Zonal은 HA 위반. CPU 기반은 요청량 기반 부하와 어긋남 |
| (C) | Regional은 맞지만 스케줄 기반은 "예측 가능한 주기" 용도 — 요청량 비례가 아님 |
| (D) | Zonal은 HA 위반. 커스텀 메트릭도 가능하나 LB 뒤 요청량 기반은 LB 용량 신호가 정석 |

HA = Regional, LB 뒤 요청량 = LB 처리 용량 신호.

</div>
</details>

---

**Q5. App Engine 환경 선택 — 런타임 제약**

팀이 App Engine에 앱을 배포하려 한다. 앱은 App Engine Standard가 지원하지 않는 시스템 라이브러리에 의존하는 **커스텀 네이티브 바이너리**를 포함한다. 동시에 팀은 컨테이너 오케스트레이션(GKE)을 운영할 의사가 없다. 가능한 선택은?

- (A) App Engine Standard — 모든 언어·바이너리를 지원한다.
- (B) App Engine Flexible 또는 Cloud Run — 둘 다 임의 컨테이너·바이너리를 실행할 수 있다.
- (C) GKE Standard — 커스텀 바이너리는 K8s에서만 가능하다.
- (D) Cloud Run functions — 이벤트 트리거로 바이너리를 실행한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

핵심 제약은 "App Engine **Standard가 지원하지 않는** 커스텀 네이티브 바이너리"다. Standard는 샌드박스 + 지원 런타임 제한이 있어 임의 바이너리를 못 돌린다. **임의 런타임·바이너리가 필요하면 컨테이너 기반인 App Engine Flexible 또는 Cloud Run**이다. 둘 다 K8s 클러스터 운영이 필요 없다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | Standard는 런타임·샌드박스 제약 — 커스텀 네이티브 바이너리 불가 |
| (C) | 커스텀 바이너리가 "K8s에서만" 가능하다는 것은 틀림. 컨테이너 서버리스(Cloud Run)로도 됨. 게다가 팀은 GKE 운영 의사 없음 |
| (D) | Cloud Run functions는 단일 이벤트 트리거 함수 모델 — 일반 앱 + 커스텀 바이너리 호스팅 용도가 아님 |

Standard의 런타임 제약을 만나면 → Flexible 또는 Cloud Run(둘 다 컨테이너). 신규라면 scale to zero·요청 과금 이점이 있는 Cloud Run이 더 자주 정답이다.

</div>
</details>

---

**Q6. 서버리스 네트워킹 — VPC 비공개 리소스 접근**

Cloud Run 서비스가 **Cloud SQL 인스턴스의 private IP**로 접속해야 한다. 이 Cloud SQL은 공인 IP가 없고 VPC 내부에서만 접근 가능하다. 동시에 이 Cloud Run 서비스는 **인터넷에 노출하지 않고 내부에서만** 호출되어야 한다. 올바른 구성은?

- (A) ingress를 all로 두고 Cloud SQL에 공인 IP를 부여한다.
- (B) Direct VPC egress(또는 Serverless VPC Access connector)로 VPC에 연결하고, ingress를 internal로 설정한다.
- (C) Cloud Run을 Compute Engine으로 옮긴다 — 서버리스는 VPC에 접근할 수 없다.
- (D) min instances를 늘려 VPC 접근을 활성화한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

두 요구사항은 방향이 다르다. ① "Cloud SQL **private IP** 접근"은 서버리스가 **VPC 안으로 나가는(egress)** 문제 → **Direct VPC egress** 또는 **Serverless VPC Access connector**로 VPC에 연결한다. ② "내부에서만 호출"은 **누가 서비스를 호출하느냐(ingress)** 문제 → **ingress를 internal**로 설정한다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | private IP 접근 요구를 우회해 공인 IP로 노출 — 보안 요구(내부 전용·비공개) 위반 |
| (C) | 서버리스도 VPC connector/Direct egress로 VPC 내부에 접근 가능. 전제가 틀림 |
| (D) | min instances는 콜드스타트·가용성 설정이지 VPC 연결과 무관 |

egress(VPC 연결)와 ingress(노출 범위)는 독립적으로 설정한다는 점이 핵심이다.

</div>
</details>

---

**Q7. VMware 자산 마이그레이션**

기업이 온프렘 데이터센터에서 **수백 대의 VMware vSphere VM**을 운영 중이다. 일부는 재작성이 불가능한 상용 어플라이언스이고, 운영팀은 기존 vCenter 기반 프로세스를 유지하길 원한다. 요구사항은 "**재플랫폼 없이 단기간에** GCP로 이전"이다. 가장 적합한 선택은?

- (A) 모든 VM을 컨테이너화해 GKE로 이전한다.
- (B) Google Cloud VMware Engine(GCVE)으로 리프트앤시프트한다.
- (C) 각 VM을 Cloud Run으로 재작성한다.
- (D) Compute Engine에 VM을 하나씩 수동으로 재구축한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

신호어가 명확하다 — "기존 vSphere", "재플랫폼 없이", "단기간에", "vCenter 운영 유지". **GCVE는 완전한 VMware 스택을 관리형으로 제공**해 온프렘 VM을 거의 변경 없이 그대로 이전(리프트앤시프트)하고, 운영팀은 익숙한 vCenter를 그대로 쓴다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | 컨테이너화는 재작성·재플랫폼 — "재플랫폼 없이 단기간"에 위배. 재작성 불가 어플라이언스도 있음 |
| (C) | Cloud Run 재작성은 대규모 현대화 프로젝트 — 단기 이전 요구와 상반 |
| (D) | 수백 대를 수동 재구축은 느리고 vSphere 운영 연속성을 깨뜨림 |

"VMware/vSphere를 그대로 빠르게" = GCVE. 현대화는 이전 이후의 별도 단계로 간다.

</div>
</details>

---

**Q8. Stateful vs Stateless MIG — 상태 보존 요구**

레거시 애플리케이션을 Compute Engine으로 옮긴다. 앱의 각 인스턴스는 **고정된 인스턴스 이름과 특정 영구 디스크**에 묶여 있어, 인스턴스가 재생성되더라도 그 이름·디스크가 보존되어야 정상 동작한다. 동시에 자동 복구(autohealing)와 가용성은 유지하고 싶다. 올바른 구성은?

- (A) Stateless MIG — 모든 인스턴스를 동일 템플릿으로 교체 가능하게 둔다.
- (B) Stateful MIG — per-instance config로 디스크·이름을 보존한다.
- (C) 단일 Compute Engine 인스턴스 — 상태가 있으니 MIG를 쓰지 않는다.
- (D) Cloud Run — 컨테이너로 옮기면 상태 문제가 사라진다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

핵심은 "각 인스턴스가 **고정 이름·특정 디스크를 보존**해야 한다"이다. 기본 stateless MIG는 인스턴스를 교체 가능한 소모품으로 다뤄 재생성 시 그 상태를 잃는다. **stateful MIG**는 stateful policy / per-instance config로 인스턴스별 디스크·이름·IP를 보존하면서도 autohealing·가용성은 그대로 제공한다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | stateless는 재생성 시 인스턴스별 상태를 보존하지 않음 — 요구 위반 |
| (C) | 단일 인스턴스는 autohealing·가용성을 잃음. MIG는 stateful로 상태를 보존할 수 있으므로 포기할 이유가 없음 |
| (D) | 컨테이너화(재작성)는 요구에 없고, Cloud Run은 무상태 전제 — 인스턴스별 디스크·이름 보존 요구와 상반 |

"MIG는 무상태 전용"이라는 통념이 함정이다. 상태 보존이 명시되면 stateful MIG.

</div>
</details>

---

**Q9. Mountkirk Games — 컨테이너 게임 서버 런타임**

모바일 멀티플레이어 게임을 **글로벌 동시 출시**한다. 게임 서버는 컨테이너로 패키징돼 있고, 저지연 세션·세밀한 노드 스케줄링·멀티리전 배포·트래픽 급증 시 오토스케일이 필요하다. 게임 서버의 컴퓨트 런타임으로 가장 적합한 것은?

- (A) Cloud Run Services — 컨테이너 서버리스로 운영을 최소화한다.
- (B) GKE(멀티리전 클러스터) — 세션·노드풀·스케줄링을 제어하며 오토스케일한다.
- (C) App Engine Standard — scale to zero로 비용을 절감한다.
- (D) Cloud Run functions — 이벤트마다 게임 세션을 처리한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

게임 서버는 **저지연 세션 상태, 노드풀·스케줄링 제어, 멀티리전 배포**를 요구한다 — 이는 컨테이너 오케스트레이션(GKE)의 영역이다. Mountkirk 케이스가 GKE 기반 게임 서버를 전제하는 이유다. Cloud Run은 무상태 요청-응답에 최적이라 지속 세션·세밀한 네트워크/노드 제어가 필요한 게임 서버에는 맞지 않는다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | Cloud Run은 무상태 요청 기반 — 저지연 지속 세션·노드 제어 요구에 부적합 |
| (C) | App Engine Standard는 런타임 제약·플랫폼 종속. 컨테이너 게임 서버·노드 제어에 맞지 않음 |
| (D) | functions는 단일 이벤트 트리거 짧은 함수 — 지속 게임 세션 서버가 아님 |

"컨테이너 게임 서버 + 멀티리전 + 세션·노드 제어" = GKE. 서버리스로 단순화하려는 유혹이 함정이다.

</div>
</details>

---

**Q10. TerramEarth — 이벤트 기반 배치 업로드 처리**

딜러가 매일 차량 데이터 파일을 **Cloud Storage 버킷에 업로드**한다. 파일이 도착할 때마다 짧은 검증·변환 코드를 실행해 다운스트림 파이프라인으로 넘겨야 한다. 처리 로직은 수십 초 내에 끝나고, 운영 부담은 최소화하고 싶다. 가장 적합한 것은?

- (A) Compute Engine에 상시 폴링 데몬을 띄워 새 파일을 감시한다.
- (B) Cloud Run functions — Cloud Storage(Eventarc) 트리거로 파일 도착 시 실행한다.
- (C) Cloud Run Jobs — 예약된 배치로 하루 한 번 전체를 처리한다.
- (D) GKE CronJob — 클러스터에서 주기적으로 버킷을 스캔한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

시그니처가 명확하다 — "**파일이 Cloud Storage에 업로드되면**" + "짧은 처리" + "운영 최소화". 이는 **Cloud Run functions의 Storage/Eventarc 이벤트 트리거**의 정확한 용례다. 이벤트에 즉시 반응하고, 인프라를 전혀 관리하지 않으며, 짧은 실행에 최적이다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | 상시 폴링 데몬은 운영·비용 부담이 크고, 이벤트 반응이 아니라 폴링 — 운영 최소화 요구와 상반 |
| (C) | Jobs는 예약/일회성 배치 — "파일 도착 즉시" 이벤트 반응 요구와 어긋남(지연 발생) |
| (D) | GKE CronJob은 클러스터 운영 부담 + 폴링 스캔 — 이벤트 트리거 대비 과하고 지연 |

"객체 도착 → 짧은 코드"는 Cloud Run functions(Eventarc). 배치 스케줄(Jobs)과 이벤트 반응(functions)을 구분하라.

</div>
</details>

---

**Q11. App Engine Flexible 함정 — Cloud Run과의 구분**

신규 무상태 컨테이너 웹 서비스를 배포한다. 요구사항: 트래픽이 없을 때 **비용 0(scale to zero)**, 요청 기반 과금, 운영 최소화, 다른 클라우드로의 이식 가능성. 한 아키텍트가 "App Engine Flexible이 컨테이너를 지원하니 적합하다"고 제안했다. 가장 올바른 판단은?

- (A) App Engine Flexible이 맞다 — 컨테이너를 지원하므로 요구를 만족한다.
- (B) Cloud Run이 맞다 — Flexible은 scale to zero가 안 돼 무트래픽 시에도 과금된다.
- (C) App Engine Standard가 맞다 — 컨테이너 웹은 항상 Standard다.
- (D) GKE가 맞다 — 컨테이너는 무조건 Kubernetes로 운영한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

Flexible은 컨테이너를 지원하지만 **최소 1 인스턴스가 항상 떠 있어 scale to zero가 불가능**하다 — "무트래픽 시 비용 0" 요구를 정면으로 위반한다. 같은 컨테이너 기반이면서 scale to zero·요청 과금·운영 최소화·포팅성을 모두 만족하는 것은 **Cloud Run**이다. Flexible은 "컨테이너 지원"이라는 그럴듯한 근거로 끼워지는 전형적 함정 선택지다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | Flexible은 scale to zero 불가(최소 1 인스턴스) — 핵심 요구 위반 |
| (C) | Standard는 지원 런타임 샌드박스로 임의 컨테이너 이미지를 그대로 못 돌림 + 플랫폼 종속(포팅성 약함) |
| (D) | GKE는 클러스터 운영 부담 — "운영 최소화"에 과함 |

"컨테이너 + scale to zero + 포팅성 + 운영 최소"는 Cloud Run. Flexible의 "컨테이너 지원"에 낚이지 말 것.

</div>
</details>

---

**Q12. Cloud Run functions 개명·세대 구분**

인프라 리뷰 중 한 팀원이 "우리 이벤트 함수가 콘솔에서 **Cloud Run functions**로 표시되는데, 예전 문서엔 Cloud Functions로 돼 있다. 서비스가 사라졌거나 마이그레이션이 필요한 것 아니냐"고 묻는다. 가장 정확한 설명은?

- (A) Cloud Functions가 폐기됐으니 코드를 전부 Cloud Run Services로 재작성해야 한다.
- (B) 2024년 8월 Cloud Functions 2세대가 Cloud Run functions로 개명·통합된 것으로, 기존 Gen2 함수는 자동 전환되고 API·gcloud·Terraform 경로는 계속 지원된다.
- (C) Cloud Run functions는 완전히 다른 신제품이며 기존 함수와 호환되지 않는다.
- (D) 1세대·2세대 함수가 모두 App Engine으로 흡수되었다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

**2024년 8월**, Cloud Functions **2세대(2nd gen)**가 Cloud Run 산하로 통합되며 **Cloud Run functions**로 개명됐다. 기존 2세대 함수는 자동으로 전환되고, 기존 함수 API·gcloud·Terraform(Gen2) 경로는 계속 지원되며 가격·쿼터가 Cloud Run과 통합됐다. 즉 **명칭·통합 변화이지 폐기·재작성이 아니다**. 1세대(1st gen)는 자체 가격·쿼터로 별도 유지된다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | 폐기·재작성이 아님 — 개명·통합이며 기존 함수는 자동 전환 |
| (C) | 완전한 신제품·비호환이 아니라 기존 2세대의 개명·통합 |
| (D) | App Engine 흡수가 아니라 Cloud Run 산하 통합 |

시험·문서에서 "Cloud Functions"와 "Cloud Run functions"를 같은 것으로 보되, 신규 서술은 현행 명칭을 쓴다.

</div>
</details>

---

## 마무리

컴퓨트 문제의 정답은 "더 좋은 서비스"가 아니라 "요구사항에 맞는 추상화 수준"이다. 제어가 필요하면 왼쪽(Compute Engine·GKE), 운영을 덜고 싶으면 오른쪽(Cloud Run·App Engine·Cloud Run functions)으로 간다.

<div class="callout-tip">
컴퓨트 선택 = 다섯 축 분해 → 가장 오른쪽(가장 적은 운영 부담)에서 요구사항을 만족하는 서비스. 상태(stateful?)·실행시간(요청/배치/상시?)·운영부담·포팅성·비용모델. 비용 최적화는 그 위에 Spot(중단 견딤)·CUD(약정)·SUD(자동) 층을 얹는다.
</div>

시험 직전에 훑을 **함정 묶음**:

| 혼동 | 핵심 구분선 |
|------|------------|
| Spot vs Preemptible | Preemptible=24h 강제 종료 / Spot=제한 없음. 둘 다 선점 가능 |
| Resource vs Flexible CUD | resource=리소스 고정(할인↑) / flexible=지출 고정(유연) |
| SUD 미적용 패밀리 | E2 등은 SUD 미적용 — "비용 최적화=무조건 E2"는 함정 |
| sole-tenant 용도 | BYOL 물리 라이선스·물리적 격리 전용(성능·비용 최적화 아님) |
| Zonal vs Regional MIG | HA면 Regional |
| Stateless vs Stateful MIG | 상태 보존(디스크·이름·IP) 명시면 Stateful, 아니면 Stateless 정석 |
| autohealing vs LB health check | autohealing=재생성 / LB=트래픽 제외 |
| Cloud Run Services vs Jobs | Services=요청 서버 / Jobs=실행 후 완료 배치 |
| App Engine Standard vs Flexible | Standard=런타임 제한+scale to zero / Flexible=임의 런타임+최소 1 인스턴스 |
| Cloud Run vs Cloud Run functions | Run=임의 컨테이너 / functions=단일 이벤트 함수 |

---

## 참고

- [[/cloud]] — Google PCA 준비 시리즈 인덱스
- [[/concept/cloud/04_gke_for_pca]] — GKE 컨테이너 오케스트레이션 (이 글의 "언제 GKE인가"를 심화)
- [[/concept/cloud/12_genai_for_pca]] — Cloud TPU·AI Hypercomputer 등 대규모 AI 학습 인프라 (가속기 머신 패밀리에 붙지 않는 TPU를 다룸)
- Google Cloud, [*Machine families resource and comparison guide*](https://cloud.google.com/compute/docs/machine-resource) — E2·N2·C3·T2D·M 계열 비교
- Google Cloud, [*Spot VMs*](https://cloud.google.com/compute/docs/instances/spot) — Spot vs Preemptible 차이
- Google Cloud, [*Committed use discounts*](https://cloud.google.com/docs/cuds) — resource-based vs flexible
- Google Cloud, [*Sustained use discounts*](https://cloud.google.com/compute/docs/sustained-use-discounts) — 자동 할인·적용 패밀리
- Google Cloud, [*Sole-tenant nodes*](https://cloud.google.com/compute/docs/nodes/sole-tenant-nodes) — BYOL·격리
- Google Cloud, [*Managed instance groups*](https://cloud.google.com/compute/docs/instance-groups) — MIG·오토스케일링·autohealing·regional
- Google Cloud, [*Cloud Run overview*](https://cloud.google.com/run/docs/overview/what-is-cloud-run) — services·jobs·동시성·min instances
- Google Cloud, [*App Engine environments*](https://cloud.google.com/appengine/docs/the-appengine-environments) — Standard vs Flexible
- Google Cloud, [*Google Cloud VMware Engine*](https://cloud.google.com/vmware-engine/docs/overview) — 관리형 VMware 스택·리프트앤시프트
- Google Cloud, [*VM Manager*](https://cloud.google.com/compute/docs/vm-manager) — OS Patch Management·Inventory·OS Config
- Google Cloud, [*Cloud Run functions overview*](https://cloud.google.com/functions/docs/concepts/overview) — 이벤트/HTTP 트리거·Eventarc·Cloud Run 통합
- Google Cloud, [*Connect to a VPC network (Cloud Run)*](https://cloud.google.com/run/docs/configuring/connecting-vpc) — VPC Access connector·Direct VPC egress
- Google Cloud, [*Restricting ingress for Cloud Run*](https://cloud.google.com/run/docs/securing/ingress) — all/internal/internal+LB
