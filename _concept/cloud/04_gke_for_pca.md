---
layout  : concept
title   : Google Cloud GKE 컨테이너 오케스트레이션 설계 결정
date    : 2026-06-28 00:00:00 +0900
updated : 2026-06-28 00:00:00 +0900
tag     : cloud gcp gke kubernetes container
toc     : true
comment : true
latex   : false
status  : complete
public  : true
parent  : [[/cloud]]
confidence     : medium
valid_from     : 2026-06-28
---

* TOC
{:toc}

> Autopilot은 노드 운영 부담을 줄이지만 GPU·DaemonSet 호스트 접근 등 특정 워크로드에는 제약이 있다. 따라서 Standard와 Autopilot 선택이 GKE 설계의 시작점이며, **PCA 시험의 GKE 문제는 결국 "어떤 모드·구성이 요구사항에 맞는가"라는 의사결정**이다. 이 글은 PCA 준비 시리즈 3편으로, VPC(1편) 위에 컨테이너 오케스트레이션을 쌓는다.

---

## 도입 — 모드 선택이 모든 것을 결정한다

GKE는 단순한 "Kubernetes as a Service"가 아니다. **Standard**와 **Autopilot** 두 모드는 노드 관리의 책임 경계가 다르고, 그 경계에서 허용되는 것과 금지되는 것이 갈린다. GPU, DaemonSet, 특정 노드 구성, 비용 모델 — 모두 이 선택에 종속된다.

PCA 시험의 GKE 문제는 세 가지 패턴으로 나온다 — ① Standard vs Autopilot 선택, ② 네트워킹과 프라이빗 클러스터 구성, ③ 확장성 도구(HPA/VPA/CA) 선택. 각 패턴의 결정 기준을 손에 쥐는 것이 이 글의 목표다.

<div class="callout-note">
이 글의 지도: 아키텍처 정신모델 → Standard vs Autopilot → 클러스터 네트워킹(VPC-native·프라이빗) → 확장성(HPA·VPA·CA) → 보안(Workload Identity) → 시험 공략 → 퀴즈. 각 축은 "요구사항 → 선택 기준 → 결론"으로 닫는다.
</div>

---

## 아키텍처 정신모델 — 제어 평면과 데이터 평면

### Control Plane과 Data Plane

GKE 클러스터는 두 레이어로 나뉜다.

- **Control Plane**: API Server, etcd, Scheduler, Controller Manager. GCP가 완전 관리한다. 사용자는 직접 접근할 수 없고 `kubectl` 또는 API로만 상호작용한다. 비용은 클러스터당 고정 과금(Standard) 또는 포함(Autopilot).
- **Data Plane**: 실제 워크로드가 돌아가는 **노드(VM)**. Standard에서는 사용자가 직접 관리한다. Autopilot에서는 Google이 관리하며 노드가 직접 노출되지 않는다.

이 분리가 Standard/Autopilot 선택의 핵심이다 — Data Plane(노드)을 **누가 소유하느냐**의 차이다.

### VPC-native 클러스터와 Alias IP

GKE에서 가장 중요한 네트워킹 설계 결정이다. 클러스터 생성 시 두 방식 중 하나를 고른다.

<div class="compare-grid">
<div class="compare-col" markdown="1">

**Routes-based (구형)**

- Pod IP: 노드 IP의 확장(static route)
- Pod는 VPC의 1급 시민이 **아님**
- 최대 노드 수 1,000개 제한
- VPC Service Controls·PSC와 호환 안 됨

</div>
<div class="compare-col" markdown="1">

**VPC-native / Alias IP (권장)**

- Pod IP: 서브넷 Secondary Range에서 할당
- Pod가 VPC의 1급 시민 — 다른 VPC 리소스가 Pod IP로 직접 접근 가능
- Private Google Access·VPC-SC·PSC 완전 지원
- 서브넷에 **Secondary Range 2개** 필요 (Pod용, Service용)

</div>
</div>

<div class="callout-warning">
Secondary Range는 자동 생성되지 않는다. 서브넷에 <strong>Pod용 range + Service용 range</strong>를 사전에 할당해야 한다. CIDR 설계 시 GKE 노드 수 × Pod 밀도(기본 110 pods/node)를 고려해 넉넉히 잡는다.
</div>

**결론**: 신규 클러스터는 **VPC-native**가 유일한 선택이다. VPC-SC·PSC 요구가 있으면 필수이고, Routes-based는 레거시 마이그레이션 경우에만 마주친다.

---

## Standard vs Autopilot — 시험의 첫 번째 분기점

이 선택이 GKE 파트의 절반이다. 요구사항 키워드를 보고 즉시 판단할 수 있어야 한다.

### 운영 모델 비교

| 항목 | Standard | Autopilot |
|------|----------|-----------|
| 노드 관리 주체 | **사용자** (노드 풀 직접 설계) | **Google** (노드 불가시) |
| 과금 모델 | 노드(VM) 시간당 과금 | **Pod 리소스 요청** 기준 과금 |
| GPU / TPU | ✅ 모든 가속기 타입 지원 | ⚠️ 제한된 GPU 타입만 지원 |
| DaemonSet (호스트 접근) | ✅ hostPID/hostNetwork 가능 | ❌ 보안 제한 (호스트 네임스페이스 불가) |
| 커스텀 OS 이미지 | ✅ 가능 | ❌ 불가 |
| 노드 SSH | ✅ 가능 | ❌ 불가 |
| Cluster Autoscaler | 사용자가 설정 | 내장 (자동) |
| 보안 기본값 | 사용자 설정 필요 | 강화된 기본값 적용 |
| 최소 Pod 리소스 요청 | 없음 | 최소값 강제 (0.25 vCPU, 0.5 GB) |

### 언제 Standard인가, 언제 Autopilot인가

```
요구사항 확인
    │
    ├── GPU/TPU 커스텀 구성 필요?  ──────────→ Standard
    ├── DaemonSet이 호스트 접근 필요?  ──────→ Standard
    ├── 커스텀 OS 이미지·노드 SSH 필요?  ────→ Standard
    ├── 노드 레벨 비용 최적화(spot pool)?  ──→ Standard
    │
    ├── 노드 관리 없이 Pod만 정의하고 싶다?  → Autopilot
    ├── 실제 사용 리소스만큼 과금 원함?  ────→ Autopilot
    └── 보안 기본값 강화가 우선?  ───────────→ Autopilot
```

<div class="callout-warning">
Autopilot에서 Pod 리소스 요청을 낮게 잡으면 <strong>최소값으로 자동 상향</strong>된다. "컨테이너를 100개 띄웠는데 과금이 예상보다 훨씬 많다"는 Autopilot 최소 리소스 강제 때문인 경우가 많다. Autopilot = 편리함과 최소 리소스 보장의 트레이드오프.
</div>

**결론**: GPU·DaemonSet 호스트 접근·커스텀 인프라 → **Standard**. 운영 부담 최소화·보안 강화 기본값 → **Autopilot**. 시험에서 "GPU 학습 워크로드"나 "커스텀 DaemonSet"이 나오면 Standard다.

---

## 클러스터 네트워킹

### 클러스터 내부 통신 — Service 유형

Pod끼리는 직접 IP로 통신할 수 있지만, 안정적인 엔드포인트를 위해 **Service**를 쓴다.

| Service 유형 | 노출 범위 | 용도 |
|-------------|----------|------|
| **ClusterIP** | 클러스터 내부 전용 | 백엔드 간 내부 통신 |
| **NodePort** | 각 노드의 외부 IP:Port | 개발·테스트 (프로덕션 비권장) |
| **LoadBalancer** | 외부 LB IP | 외부 트래픽 수신 (L4) |
| **Ingress** | HTTP(S) LB + 경로 라우팅 | L7 라우팅, TLS termination |

> 시험 패턴: "HTTP 트래픽을 경로별로 다른 Service로 라우팅"은 **Ingress**(HTTP(S) Load Balancer). "TCP/UDP 외부 노출"은 **LoadBalancer Service**.

### 프라이빗 클러스터

"외부 IP 없는 노드"와 "control plane 공개 여부"는 **독립적으로** 설정한다.

| 구성 | 노드 외부 IP | Control Plane 엔드포인트 | 사용 케이스 |
|------|------------|----------------------|------------|
| Public 클러스터 | 있음 | 공개 인터넷 | 개발·실험 |
| Private nodes + Public endpoint (authorized networks) | **없음** | 공개이나 특정 CIDR만 허용 | 노드 격리 + kubectl은 인터넷에서 허용 |
| Private nodes + Private endpoint | **없음** | **VPC 내부만** | 최고 보안 — 온프렘 VPN/Interconnect로만 접근 |

<div class="callout-warning">
"Public endpoint + authorized networks"는 control plane이 여전히 <strong>공개 인터넷에 노출</strong>된다. IP를 제한할 뿐이다. "인터넷에서 control plane 접근 완전 불가"가 요구사항이면 반드시 <strong>Private endpoint</strong>여야 한다.
</div>

Private endpoint 클러스터에서 kubectl 접근은 **Cloud Shell, Bastion Host, VPN/Interconnect 경유** 중 하나를 쓴다.

**결론**: 노드 격리 = Private nodes, control plane 완전 격리 = Private endpoint. 둘은 독립 설정이다.

---

## 확장성과 가용성

세 도구가 각각 다른 레이어를 다룬다. 혼동하면 바로 오답이다.

### Pod 확장 — HPA와 VPA

<div class="compare-grid">
<div class="compare-col" markdown="1">

**HPA — 수평 Pod 오토스케일러**

- **Pod 수(replica)**를 자동 조절
- 기준: CPU 사용률, 메모리, 커스텀 메트릭(Pub/Sub 큐 길이 등)
- 트래픽 급증 → replica 3→15개
- 빠른 스케일아웃

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  minReplicas: 3
  maxReplicas: 15
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

</div>
<div class="compare-col" markdown="1">

**VPA — 수직 Pod 오토스케일러**

- **Pod의 CPU/메모리 request**를 자동 조절
- 과다 설정된 리소스 요청 최적화
- 스케줄링 효율·비용 절감 목적
- ⚠️ 같은 메트릭에 HPA+VPA **동시 적용 불가**

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
spec:
  updatePolicy:
    updateMode: "Auto"  # Off/Initial/Recreate/Auto
```

VPA의 `Auto` 모드는 Pod를 재시작해 새 request로 적용한다 — 무중단이 필요하면 `Initial`(신규 Pod만 적용).

</div>
</div>

### 노드 확장 — Cluster Autoscaler와 NAP

**Cluster Autoscaler(CA)**: Standard 클러스터에서 **노드 수**를 자동 조절한다. Pod가 Pending 상태(리소스 부족)면 노드를 추가하고, 오랫동안 유휴 상태인 노드는 제거한다.

**Node Auto Provisioning(NAP)**: CA의 확장. 기존 노드 풀로 Pod 요구를 충족할 수 없을 때 **적합한 기계 타입의 새 노드 풀**을 자동 생성한다. GPU가 갑자기 필요한 워크로드에 유용하다.

| 도구 | 조절 대상 | 트리거 |
|------|----------|-------|
| HPA | Pod replica 수 | CPU/메모리/커스텀 메트릭 |
| VPA | Pod resource request | 실제 사용량 vs 요청량 편차 |
| Cluster Autoscaler | 노드 수 | Pending Pod 존재 / 노드 유휴 |
| NAP | 노드 풀 생성 | 기존 풀로 충족 불가한 Pod |

### 가용성 — Regional vs Zonal 클러스터

| 구성 | Control Plane | 노드 분산 | SLA |
|------|-------------|---------|-----|
| **Zonal** | 단일 존 | 단일 존 | 낮음 |
| **Multi-zonal** | 단일 존 | 여러 존 | 노드 장애 견딤 |
| **Regional** | 3개 존 (각 복제) | 여러 존 | Control Plane 포함 HA |

> "Control Plane 업그레이드 중에도 API가 가용해야 한다" → **Regional 클러스터**. Control Plane이 3존에 분산되어 있어 단일 존 장애·업그레이드에도 API Server가 가용 상태를 유지한다.

**결론**: 확장은 HPA(Pod 수) → VPA(Pod 크기) → CA(노드 수) 순서로 필요를 채운다. HA는 Regional 클러스터.

---

## 보안

### Workload Identity — 키 없는 인증

Pod에서 GCP API(BigQuery, GCS 등)를 호출할 때 **서비스 계정 키 파일을 사용하지 않는** 방법이다. PCA에서 "Pod가 GCS에 접근, 보안팀이 키 파일 금지"가 나오면 정답은 Workload Identity다.

**작동 원리**: Kubernetes ServiceAccount(KSA)를 Google Service Account(GSA)에 매핑한다. Pod가 GCP API를 호출하면 GKE 메타데이터 서버가 자동으로 GSA 토큰을 제공한다. 키 파일 없음, 유출 위험 없음.

```bash
# 1. Workload Identity 활성화 (클러스터)
gcloud container clusters update my-cluster \
  --workload-pool=PROJECT_ID.svc.id.goog

# 2. KSA ↔ GSA 연결
gcloud iam service-accounts add-iam-policy-binding \
  gsa@PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="serviceAccount:PROJECT_ID.svc.id.goog[NAMESPACE/KSA_NAME]"

# 3. KSA에 annotation 추가
kubectl annotate serviceaccount KSA_NAME \
  iam.gke.io/gcp-service-account=gsa@PROJECT_ID.iam.gserviceaccount.com
```

<div class="callout-warning">
Autopilot 클러스터는 Workload Identity가 <strong>항상 활성화</strong>된다 — 비활성화 불가. Standard에서는 클러스터 생성 시 또는 업데이트로 활성화해야 한다.
</div>

### Binary Authorization

컨테이너 이미지가 배포되려면 **신뢰할 수 있는 서명(attestation)**이 있어야 한다는 정책을 강제한다. CI/CD 파이프라인에서 서명을 붙이고, GKE가 배포 시 서명을 검증한다. "검증되지 않은 이미지의 배포를 차단"이 요구사항이면 Binary Authorization이다.

**결론**: GCP API 접근 = **Workload Identity**(키 파일 없이). 이미지 신뢰성 강제 = **Binary Authorization**. 두 도구는 목적이 다르다.

---

## 시험장에서 — 문제 유형별 공략

### 아키텍처 설계형

| 요구사항 키워드 | 정답 |
|----------------|------|
| GPU·커스텀 DaemonSet·노드 SSH | **Standard** |
| 노드 관리 없이 Pod 정의만·보안 기본값 강화 | **Autopilot** |
| Pod가 VPC 1급 시민·VPC-SC·PSC 연동 | **VPC-native 클러스터** |
| 노드 외부 IP 없음 | **Private nodes** |
| Control Plane 인터넷 완전 차단 | **Private endpoint** |
| Control Plane 포함 HA | **Regional 클러스터** |
| Pod 수평 확장 (트래픽·CPU 기준) | **HPA** |
| Pod 리소스 요청 최적화 | **VPA** |
| 노드 수 자동 조절 (Pending pod) | **Cluster Autoscaler** |
| 키 파일 없이 GCP API 접근 | **Workload Identity** |
| 미서명 이미지 배포 차단 | **Binary Authorization** |

### 트러블슈팅형

| 증상 | 점검 사항 |
|------|----------|
| Pod가 Pending 상태 | 리소스 부족? → CA가 노드 추가 중인가, CA 비활성화된 것은 아닌가 |
| Autopilot에서 DaemonSet 배포 실패 | hostPID/hostNetwork 사용 여부 확인 — Autopilot에서 금지 |
| Private endpoint 클러스터에서 kubectl 불통 | VPN/Cloud Shell/Bastion 경유인가, authorized networks에 내 IP가 있는가 |
| Workload Identity 설정 후에도 권한 오류 | KSA annotation, IAM 바인딩 양쪽 확인 |

---

## 실전 퀴즈 — 핵심 개념 검증

---

**Q1. Standard vs Autopilot — GPU 워크로드**

ML 팀이 GKE에 NVIDIA A100 GPU를 사용한 학습 워크로드를 배포하려 한다. GPU 드라이버 설치를 위해 `hostPID: true`가 설정된 DaemonSet이 필요하다. 가장 적합한 GKE 모드는?

- (A) Autopilot — Google이 GPU 드라이버를 자동으로 설치하므로 DaemonSet이 필요 없다.
- (B) Standard — GPU 노드 풀을 직접 구성하고 DaemonSet으로 드라이버를 설치할 수 있다.
- (C) Autopilot — Autopilot은 모든 NVIDIA GPU 타입을 완전히 지원한다.
- (D) Standard — Autopilot은 GPU를 전혀 지원하지 않으므로 Standard가 유일한 선택이다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

`hostPID: true` DaemonSet은 노드의 호스트 PID 네임스페이스에 접근한다. Autopilot은 보안 강화 기본값으로 **호스트 네임스페이스 접근(hostPID/hostNetwork/hostIPC)을 허용하지 않는다**. 이 제약이 있는 한 Autopilot에서 해당 DaemonSet을 실행할 수 없다.

Standard에서는 노드 풀을 직접 구성하고 DaemonSet의 호스트 접근도 허용할 수 있다.

| 선택지 | 오답 이유 |
|--------|----------|
| (A) | Autopilot이 일부 GPU를 지원하지만 `hostPID` DaemonSet은 불가 |
| (C) | 모든 NVIDIA GPU 타입을 완전 지원한다는 것은 과장 — 제한된 타입만 지원 |
| (D) | Autopilot이 GPU를 "전혀" 지원하지 않는다는 것은 틀림. 문제는 DaemonSet 제약 |

핵심은 GPU 지원 여부가 아니라 **`hostPID` DaemonSet 실행 가능 여부**다.

</div>
</details>

---

**Q2. Workload Identity vs 서비스 계정 키**

GKE Standard 클러스터의 Pod에서 Cloud Storage에 접근해야 한다. 보안팀이 "서비스 계정 키 파일을 컨테이너 이미지·환경 변수·파일 시스템에 포함하지 말 것"을 요구한다. 가장 적합한 방법은?

- (A) SA 키를 Secret Manager에 저장하고 Pod에서 API로 읽어온다.
- (B) Workload Identity를 구성해 Kubernetes ServiceAccount를 Google Service Account에 매핑한다.
- (C) 노드의 기본 SA에 `roles/storage.admin`을 부여하면 모든 Pod가 자동으로 GCS에 접근할 수 있다.
- (D) SA 키를 Kubernetes Secret으로 마운트하고 `GOOGLE_APPLICATION_CREDENTIALS`로 지정한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

Workload Identity는 키 파일 없이 Kubernetes SA를 Google SA에 매핑한다. Pod가 GCP API를 호출하면 GKE 메타데이터 서버가 자동으로 올바른 Google SA의 토큰을 제공한다. **키 파일이 존재하지 않으므로** 유출 위험이 없다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | 키 파일 자체가 Secret Manager에 존재 — 탈취 시 유효한 자격증명 |
| (C) | 노드 SA에 과다 권한, 클러스터의 모든 Pod가 동일 권한 → 최소 권한 위반 |
| (D) | Kubernetes Secret에 키 파일 존재 — etcd에 저장, 유출 위험 |

"키 파일 없음"이 핵심이다. Workload Identity는 키 파일 자체를 제거한다.

</div>
</details>

---

**Q3. 프라이빗 클러스터 구성**

금융 기업의 GKE 클러스터 요구사항:
- 노드는 외부 IP를 가지면 안 된다
- 개발팀은 회사 VPN을 통해서만 `kubectl`로 cluster API에 접근한다
- 인터넷에서 control plane에 직접 접근 불가

가장 적합한 프라이빗 클러스터 구성은?

- (A) Private nodes + Public endpoint (authorized networks로 VPN IP만 허용)
- (B) Private nodes + Private endpoint
- (C) Public nodes + Private endpoint
- (D) Private nodes + Public endpoint (authorized networks 없이)

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

세 가지 요구사항을 각각 매핑한다.

| 요구사항 | 충족 구성 |
|---------|---------|
| 노드 외부 IP 없음 | Private nodes |
| control plane 인터넷 접근 불가 | **Private endpoint** |
| VPN으로 kubectl 접근 | Private endpoint + VPC 내부 접근 경로 |

(A)가 함정이다. "Public endpoint + authorized networks"는 control plane 엔드포인트가 여전히 **공개 인터넷에 노출**된다 — IP를 제한할 뿐이지 인터넷에 노출된 상태다. "인터넷에서 직접 접근 불가" 요구사항을 충족하지 못한다.

Private endpoint 클러스터에서 kubectl은 VPN 또는 Cloud Shell(Project VPC와 피어링됨)로 접근한다.

</div>
</details>

---

**Q4. 오토스케일링 도구 선택**

다음 세 시나리오에 각각 적합한 도구를 고르라.

① 웹 API Pod가 트래픽 급증 시 CPU 사용률 기준으로 replica를 자동으로 늘려야 한다.
② ML 추론 Pod의 메모리 request가 실제 사용량보다 3배 높게 설정되어 노드 자원이 낭비된다.
③ 모든 Pod가 Pending 상태다. 현재 노드의 남은 리소스가 없어서다. (Standard 클러스터)

- (A) ① HPA, ② VPA, ③ Cluster Autoscaler
- (B) ① Cluster Autoscaler, ② HPA, ③ VPA
- (C) ① HPA, ② Cluster Autoscaler, ③ VPA
- (D) ① VPA, ② HPA, ③ Cluster Autoscaler

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (A)**

| 도구 | 역할 | 해당 시나리오 |
|------|------|-------------|
| **HPA** | Pod **수(replica)** 수평 확장. CPU/메모리/커스텀 메트릭 기준 | ① 트래픽·CPU 기반 replica 증가 |
| **VPA** | Pod **resource request** 수직 조정. 실제 사용량 기반 최적화 | ② 과다 설정된 메모리 request 축소 |
| **Cluster Autoscaler** | **노드 수** 조절. Pending Pod 발생 시 노드 추가 | ③ 리소스 부족으로 Pending된 Pod |

HPA와 VPA를 **같은 메트릭**에 동시 적용하면 충돌한다. CPU 기준으로 HPA가 replica를 늘리는 중에 VPA가 CPU request를 조정하면 HPA 계산이 틀어진다.

</div>
</details>

---

**Q5. VPC-native 클러스터 서브넷 설계**

팀이 GKE 클러스터를 배포하려 한다. 요구사항:
- Pod가 VPC 1급 시민으로 다른 GCE VM이 Pod IP로 직접 접근 가능해야 한다
- Private Service Connect로 Cloud SQL에 접근해야 한다
- 향후 VPC Service Controls 적용 예정

올바른 서브넷 설계는?

- (A) Primary range만 있는 서브넷으로 Routes-based 클러스터를 생성한다.
- (B) Primary range(VM IP용) + Secondary range 2개(Pod IP용, Service IP용) 서브넷으로 VPC-native 클러스터를 생성한다.
- (C) Primary range만 있는 서브넷으로 VPC-native 클러스터를 생성하면 Secondary range가 자동 할당된다.
- (D) Primary range + Secondary range 1개(Pod·Service IP 공유)로 VPC-native 클러스터를 생성한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

VPC-native 클러스터는 서브넷에 **Secondary range 2개**가 필요하다 — 하나는 Pod IP, 하나는 Service(ClusterIP) IP.

| 선택지 | 문제점 |
|--------|--------|
| (A) Routes-based | Pod가 VPC 1급 시민이 아님. PSC·VPC-SC 호환 불가 |
| (C) | Secondary range는 **자동 생성되지 않음**. 사전 명시 필요 |
| (D) | Pod range와 Service range는 **별도 range**여야 함. 공유 불가 |

Routes-based를 쓰면 PSC와 VPC Service Controls 연동이 불가능하기 때문에 요구사항 세 가지를 모두 충족하는 것은 VPC-native만 가능하다.

</div>
</details>

---

## 참고

- [[/cloud]] — Google PCA 준비 시리즈 인덱스
- [[/concept/cloud/03_vpc_for_pca]] — VPC 네트워킹 (VPC-native·Secondary Range 전제 조건)
- Google Cloud, [*GKE overview*](https://cloud.google.com/kubernetes-engine/docs/concepts/kubernetes-engine-overview) — Standard vs Autopilot 공식 비교
- Google Cloud, [*Autopilot overview*](https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview) — 제약·지원 목록
- Google Cloud, [*Private clusters*](https://cloud.google.com/kubernetes-engine/docs/concepts/private-cluster-concept) — Private nodes·endpoint 구성
- Google Cloud, [*Workload Identity*](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity) — KSA↔GSA 매핑 상세
- Google Cloud, [*HPA*](https://cloud.google.com/kubernetes-engine/docs/concepts/horizontalpodautoscaler) / [*VPA*](https://cloud.google.com/kubernetes-engine/docs/concepts/verticalpodautoscaler) / [*Cluster Autoscaler*](https://cloud.google.com/kubernetes-engine/docs/concepts/cluster-autoscaler) — 3종 오토스케일러 정밀 비교
