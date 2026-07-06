---
layout  : concept
title   : Google Cloud GKE 컨테이너 오케스트레이션 설계 결정
date    : 2026-06-28 00:00:00 +0900
updated : 2026-07-06 00:00:00 +0900
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
이 글의 지도: 아키텍처 정신모델 → Standard vs Autopilot → 클러스터 네트워킹(VPC-native·프라이빗) → 확장성(HPA·VPA·CA) → 보안(Workload Identity Federation) → GKE Enterprise(멀티클러스터·fleet) → 케이스 스터디 접점 → 시험 공략 → 퀴즈. 각 축은 "요구사항 → 선택 기준 → 결론"으로 닫는다.
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

### 2026 업데이트 — Autopilot의 진화와 경계 흐려짐

Autopilot은 "전용 Autopilot 클러스터"라는 고정된 모드에서 벗어나는 방향으로 움직였다. 시험 준비 관점에서 두 가지 변화를 알아둔다.

- **Container-optimized compute (컨테이너 최적화 컴퓨트)**: GKE 1.32.3-gke.1927002 이상 Autopilot에 도입된 컴퓨트 클래스. Pod의 리소스 요청을 **실행 중에 동적으로 리사이즈**하고, Pod 스케줄링을 대폭 앞당긴다(Google 자체 측정 기준 최대 약 7배 빠름 — 벤더 수치이므로 조건부로 이해). 예전 Autopilot의 "Pod마다 노드를 새로 띄우느라 스케일아웃이 느리다"는 인상을 완화하는 기능이다.
- **Standard 클러스터에서 Autopilot 워크로드 사용**: 2026년부터 전용 Autopilot 클러스터가 아니어도 자격이 되는 GKE 클러스터에서 Autopilot식 컨테이너 최적화 컴퓨트·운영 편의를 워크로드 단위로 쓸 수 있게 확장됐다. 즉 "클러스터 전체 = Autopilot" 대 "클러스터 전체 = Standard"라는 이분법이 **워크로드 단위 선택**으로 유연해졌다.

<div class="callout-warning">
시험 함정: 위 변화가 있어도 <strong>모드 선택의 근본 트레이드오프(노드 소유·호스트 접근·GPU 커스텀·과금 모델)는 그대로다.</strong> "hostPID DaemonSet이 필요하다", "커스텀 OS 이미지가 필요하다" 같은 요구는 여전히 <strong>Standard</strong>로 간다. 2026 업데이트를 근거로 "이제 Autopilot에서 뭐든 된다"고 고르면 오답이다. 신기능은 <strong>운영 편의·스케줄링 속도·워크로드 단위 유연성</strong>을 개선할 뿐, 호스트 네임스페이스 접근 같은 보안 제약을 없애지 않는다.
</div>

**결론**: 2026 기준으로 "Autopilot이냐 Standard냐"는 클러스터 수준 결정에서 **워크로드 수준 결정**으로 이동 중이다. 그러나 시험 판단 기준(호스트 접근·GPU 커스텀 → Standard)은 불변이다.

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

### Workload Identity Federation for GKE — 키 없는 인증

Pod에서 GCP API(BigQuery, GCS 등)를 호출할 때 **서비스 계정 키 파일을 사용하지 않는** 방법이다. PCA에서 "Pod가 GCS에 접근, 보안팀이 키 파일 금지"가 나오면 정답은 Workload Identity Federation for GKE다.

<div class="callout-note">
명칭 정리: 예전에 GKE 문서·시험 문항에서 "Workload Identity"로 부르던 GKE 파드용 기능은 현재 <strong>Workload Identity Federation for GKE</strong>가 공식 명칭이다. IAM 쪽의 <strong>Workload Identity Federation</strong>(온프렘/타클라우드·CI/CD 워크로드가 키 없이 GCP 접근)과 이름이 닮았지만 <strong>범위가 다르다</strong> — 전자는 "GKE 파드→GCP", 후자는 "외부 워크로드→GCP". 시험 지문이 "GKE 파드"를 말하면 Federation for GKE, "온프렘/다른 클라우드 앱"을 말하면 IAM의 Workload Identity Federation이다.
</div>

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

**결론**: GCP API 접근 = **Workload Identity Federation for GKE**(키 파일 없이). 이미지 신뢰성 강제 = **Binary Authorization**. 두 도구는 목적이 다르다.

---

## GKE Enterprise — 멀티클러스터·fleet 관리

단일 클러스터를 넘어 **여러 클러스터를 하나의 논리 단위로 묶어 관리**해야 하는 요구가 나오면 GKE Enterprise edition(구 Anthos)이 시야에 들어온다. PCA는 세부 과금보다 "언제 이 계층이 필요한가"를 묻는다.

<div class="callout-note">
GKE에는 두 edition이 있다. <strong>Standard edition</strong>은 지금까지 다룬 단일 클러스터 오케스트레이션이다. <strong>Enterprise edition</strong>은 그 위에 <strong>fleet(플릿) 기반 멀티클러스터 관리 계층</strong>을 얹는다. Enterprise의 정식 기능 구성·과금은 리전·릴리스에 따라 달라질 수 있어 이 노트에서 수치로 단정하지 않는다 — 시험에서는 "여러 클러스터·여러 리전·여러 환경을 일관되게 관리"라는 <strong>요구의 형태</strong>로 식별한다.
</div>

### fleet가 푸는 문제

**Fleet**는 여러 GKE 클러스터(리전·프로젝트·때로는 다른 클라우드/온프렘에 걸친)를 하나의 그룹으로 묶는 논리 단위다. fleet에 묶이면 아래를 클러스터마다 따로가 아니라 **집합 전체에 걸쳐** 다룬다.

| 기능(fleet 계층) | 푸는 문제 | 단일 클러스터로는? |
|------------------|-----------|--------------------|
| **Multi-cluster Services / Gateway** | 여러 클러스터에 흩어진 서비스를 클러스터 경계를 넘어 발견·라우팅 | 클러스터 하나 안에서만 가능 |
| **Config Management (Config Sync)** | 정책·설정을 Git에서 여러 클러스터에 일관 적용(GitOps) | 클러스터마다 수동 반복 |
| **Policy Controller** | 조직 정책(예: 특정 이미지 레지스트리만 허용)을 fleet 전체에 강제 | 클러스터별 개별 설정 |
| **Cloud Service Mesh** | 멀티클러스터 서비스 메시(mTLS·트래픽 관리·관측성) | 단일 클러스터 메시로 한정 |
| **Fleet-wide 관측성** | 여러 클러스터를 하나의 대시보드로 | 클러스터별 개별 확인 |

### 시험에서 GKE Enterprise를 고르는 신호

<div class="callout-warning">
함정 구분: "고가용성 K8s API"만 필요하면 <strong>Regional 클러스터</strong>로 충분하다 — GKE Enterprise가 아니다. Enterprise를 부르는 것은 <strong>클러스터가 여러 개</strong>일 때다. 지문에 "여러 리전에 걸친 다수 클러스터를 일관된 정책으로 관리", "온프렘/멀티클라우드까지 통합 관리", "클러스터 간 서비스 메시", "GitOps로 fleet 전체 설정 동기화"가 나오면 GKE Enterprise / fleet를 본다. 단일 클러스터 HA 문제에 Enterprise를 고르면 과잉 설계 오답이다.
</div>

**결론**: 단일 클러스터 HA = **Regional 클러스터**. **여러 클러스터를 하나로** 관리(멀티리전·멀티클라우드·GitOps 정책·멀티클러스터 메시) = **GKE Enterprise(fleet)**.

---

## 케이스 스터디 접점 — Mountkirk Games · Helicopter Racing League

PCA 시험은 4개 공식 케이스 스터디에서 문항을 낸다. GKE와 직접 맞닿는 두 케이스의 요구사항 → 설계 결정을 정리한다.

### Mountkirk Games — 글로벌 게임 플랫폼의 GKE 배포

모바일 멀티플레이어 세션형 게임을 **글로벌 동시 출시**하고, 저지연 멀티플레이·오토스케일·실시간 분석을 요구하는 케이스다. GKE가 컴퓨트 기반으로 명시된다.

| 케이스 요구사항 | GKE 설계 결정 | 이유 |
|-----------------|---------------|------|
| 글로벌 저지연 멀티플레이 | **멀티리전 배포**(리전별 Regional 클러스터) + Global external Application LB | 플레이어를 가까운 리전으로 anycast 라우팅 |
| 예측 불가한 트래픽 급증(출시·이벤트) | **HPA**(replica) + **Cluster Autoscaler**(노드), 필요 시 NAP | Pod 수·노드 수를 자동으로 확장 |
| 운영 인력 최소화 | **Autopilot**(또는 워크로드별 컨테이너 최적화 컴퓨트) 검토 | 노드 관리 위임, 급증 시 스케줄링 속도 |
| 실시간 분석 파이프라인 | 게임 이벤트 → Pub/Sub → Dataflow → BigQuery | GKE는 게임 서버, 분석은 관리형 스트리밍으로 분리 |
| 글로벌 상태·리더보드 강한 일관성 | **Spanner**(GKE 외부 관리형 DB) | 리전 간 강한 일관성이 필요할 때. 요구가 없으면 과잉 |

<div class="callout-warning">
케이스 함정: 게임 서버를 GKE에 올린다고 <strong>상태·리더보드까지 GKE 안에 두지 않는다.</strong> "리전 간 강한 일관성"이 명시되면 Spanner, 문서형 실시간 동기화면 Firestore로 <strong>상태를 외부 관리형 DB에 위임</strong>한다. GKE StatefulSet으로 글로벌 강한 일관성을 직접 구현하려 드는 선택지는 오답 유도다.
</div>

### Helicopter Racing League (HRL) — 스트리밍·ML 서빙

글로벌 스트리밍 방송과 **실시간 경기 예측(ML)**, 지연 최소화, 예측 정확도 향상을 요구하는 케이스다. GKE는 GPU 기반 ML 서빙·인코딩 워크로드의 후보다.

| 케이스 요구사항 | 설계 결정 | GKE 관점 |
|-----------------|-----------|----------|
| 글로벌 콘텐츠 배포·지연 최소화 | Global external Application LB + Cloud CDN / Media CDN | GKE 백엔드 앞단에 CDN·글로벌 LB |
| 실시간 경기 예측(ML 추론) | **GKE Standard + GPU 노드 풀** 또는 Vertex AI 서빙 | 커스텀 GPU·컨테이너 제어가 필요하면 GKE Standard |
| 예측 정확도 향상(모델 학습) | Vertex AI training(+ GPU/TPU) | 대량 학습은 GKE보다 관리형 학습이 흔한 정답 |
| 시청자 급증 대응 | HPA + Cluster Autoscaler(GPU 포함 NAP) | 추론 파드·GPU 노드 자동 확장 |

<div class="callout-warning">
케이스 함정: HRL에서 <strong>GPU가 걸리면 Autopilot이 아니라 Standard</strong>다(커스텀 GPU 노드 풀·드라이버 DaemonSet). 또 "대량 모델 <strong>학습</strong>"과 "실시간 <strong>추론 서빙</strong>"을 구분하라 — 학습은 Vertex AI training이 흔한 정답, GKE는 커스텀 추론 서빙·인코딩처럼 컨테이너/GPU 제어가 필요한 쪽에 배치한다.
</div>

**결론**: Mountkirk = GKE 멀티리전 + 오토스케일 + 상태는 Spanner/Firestore로 외부화. HRL = GKE Standard + GPU 추론 서빙 + 글로벌 LB/CDN, 학습은 Vertex AI로 위임.

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
| 기존 노드 풀로 불가한 Pod (예: GPU) 위한 노드 풀 자동 생성 | **Node Auto Provisioning** |
| GKE 파드가 키 파일 없이 GCP API 접근 | **Workload Identity Federation for GKE** |
| 온프렘/타클라우드 앱이 키 없이 GCP 접근 | **(IAM) Workload Identity Federation** |
| 미서명 이미지 배포 차단 | **Binary Authorization** |
| 여러 리전·다수 클러스터를 일관 정책으로 관리 | **GKE Enterprise (fleet)** |
| 클러스터 간 서비스 발견·라우팅 / 멀티클러스터 메시 | **fleet + Multi-cluster Services / Cloud Service Mesh** |
| GitOps로 여러 클러스터 설정 동기화 | **Config Sync (Config Management)** |
| Pod 스케줄링을 빠르게·실행 중 리소스 리사이즈 | **Autopilot container-optimized compute** |
| 단일 클러스터 K8s API HA | **Regional 클러스터** (Enterprise 아님) |

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

**Q6. Mountkirk Games — 글로벌 게임 상태 저장**

Mountkirk Games는 모바일 멀티플레이어 게임을 GKE에 배포하고 여러 리전에서 동시 서비스한다. 플레이어의 글로벌 리더보드와 세션 상태는 **모든 리전에서 강한 일관성(strong consistency)**으로 읽고 써야 한다. 게임 서버 자체는 이미 GKE 멀티리전 클러스터에 있다. 상태 저장에 가장 적합한 것은?

- (A) 각 리전 GKE 클러스터에 StatefulSet으로 데이터베이스를 직접 운영하고 애플리케이션에서 리전 간 복제를 구현한다.
- (B) Cloud Spanner에 리더보드·세션 상태를 저장한다.
- (C) 리전마다 별도 Cloud SQL 인스턴스를 두고 읽기 복제본으로 동기화한다.
- (D) Firestore에 저장하면 리전 간 강한 일관성 리더보드가 자동으로 보장된다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

"리전 간 강한 일관성 + 수평 확장 관계형"은 Spanner의 정확한 포지션이다. 게임 서버는 GKE에 두더라도 **글로벌 상태는 관리형 DB로 외부화**하는 것이 케이스 스터디의 정석이다.

| 선택지 | 오답 이유 |
|--------|----------|
| (A) | GKE StatefulSet으로 리전 간 강한 일관성을 직접 구현 = 막대한 운영 부담·정합성 위험. 관리형 DB가 있는데 재발명 |
| (C) | Cloud SQL 읽기 복제본은 비동기 — 리전 간 **강한 일관성 아님**. 쓰기는 단일 리전 |
| (D) | Firestore는 문서형 실시간 동기화엔 강하지만, "리전 간 강한 일관성 리더보드"를 자동 보장한다는 서술은 과장 함정 |

핵심: GKE는 컴퓨트, 글로벌 강한 일관성 상태는 Spanner.

</div>
</details>

---

**Q7. GKE Enterprise vs Regional 클러스터**

한 기업이 3개 리전에 각각 GKE 클러스터를 운영한다. 요구사항:
- 모든 클러스터에 "승인된 컨테이너 레지스트리의 이미지만 배포 가능" 정책을 **일관되게 강제**
- 설정 변경을 Git에 커밋하면 세 클러스터에 자동 반영(GitOps)
- 세 클러스터에 흩어진 서비스를 클러스터 경계를 넘어 서로 호출

가장 적합한 접근은?

- (A) 각 클러스터를 Regional 클러스터로 만들면 세 요구사항이 자동으로 충족된다.
- (B) GKE Enterprise edition으로 세 클러스터를 fleet에 등록하고 Policy Controller·Config Sync·Multi-cluster Services를 사용한다.
- (C) 클러스터마다 Binary Authorization을 개별 설정하고, 설정은 각 팀이 수동으로 맞춘다.
- (D) 세 클러스터를 하나의 거대한 Regional 클러스터로 통합한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

세 요구는 모두 **멀티클러스터 관리** 문제다. fleet 기반 GKE Enterprise가 정확히 이 계층을 제공한다 — Policy Controller(정책 강제), Config Sync(GitOps 동기화), Multi-cluster Services(클러스터 간 서비스 발견).

| 선택지 | 오답 이유 |
|--------|----------|
| (A) | Regional 클러스터는 **단일 클러스터 HA**만 해결. 여러 클러스터에 걸친 정책·GitOps·서비스 발견과 무관 |
| (C) | 클러스터별 수동 설정은 "일관되게 강제"·"자동 반영" 요구에 정면 배치. 드리프트 발생 |
| (D) | 3개 리전 클러스터를 하나로 통합 불가(클러스터는 단일 리전). 리전 격리 목적도 훼손 |

함정 핵심: **단일 클러스터 HA(Regional) ≠ 멀티클러스터 관리(GKE Enterprise/fleet).**

</div>
</details>

---

**Q8. Autopilot 2026 업데이트의 한계**

팀이 GKE Autopilot의 최신 container-optimized compute를 쓰면서 "이제 노드 관리 없이 대부분의 워크로드가 된다"고 기대한다. 그런데 보안 에이전트를 **`hostNetwork: true` DaemonSet**으로 모든 노드에 배포해야 한다는 요구가 새로 생겼다. 올바른 판단은?

- (A) container-optimized compute가 도입되었으므로 Autopilot에서 hostNetwork DaemonSet도 이제 실행된다.
- (B) hostNetwork DaemonSet은 Autopilot의 보안 제약에 걸리므로, 이 워크로드는 Standard(또는 호스트 접근이 허용되는 구성)로 가야 한다.
- (C) Autopilot 워크로드를 Standard 클러스터에서도 쓸 수 있게 되었으므로 hostNetwork 제약도 사라졌다.
- (D) Pod 리소스 요청을 최소값 이상으로 올리면 hostNetwork 제약이 해제된다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

2026 업데이트(container-optimized compute, Autopilot 워크로드 in Standard)는 **스케줄링 속도·워크로드 단위 유연성**을 개선할 뿐, Autopilot의 근본 보안 제약인 **호스트 네임스페이스 접근 금지**(hostPID/hostNetwork/hostIPC)를 없애지 않는다.

| 선택지 | 오답 이유 |
|--------|----------|
| (A) | container-optimized compute는 리사이즈·스케줄링 기능. 호스트 접근 제약과 무관 |
| (C) | "Autopilot 워크로드를 Standard에서 사용"은 컴퓨트/운영 편의 확장이지 보안 제약 해제가 아님 |
| (D) | 최소 리소스 요청은 과금·스케줄링 이슈. hostNetwork 허용과 전혀 무관 |

신기능에 현혹돼 근본 트레이드오프를 잊게 만드는 함정. **호스트 접근이 필요하면 여전히 Standard.**

</div>
</details>

---

**Q9. 두 개의 "Workload Identity Federation" 구분**

다음 두 시나리오에 각각 맞는 것을 고르라.

① GKE 클러스터의 Pod가 서비스 계정 키 파일 없이 BigQuery에 접근해야 한다.
② 온프렘 데이터센터에서 도는 CI/CD 러너가 서비스 계정 키를 배포하지 않고 GCP의 Artifact Registry에 푸시해야 한다.

- (A) ① Workload Identity Federation for GKE, ② (IAM) Workload Identity Federation
- (B) ① (IAM) Workload Identity Federation, ② Workload Identity Federation for GKE
- (C) ① Workforce Identity Federation, ② Workload Identity Federation for GKE
- (D) 둘 다 서비스 계정 키를 Secret Manager에 저장해야 한다

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (A)**

이름이 닮은 두 기능의 **범위**가 핵심이다.

| 기능 | 대상 | 시나리오 |
|------|------|----------|
| **Workload Identity Federation for GKE** | GKE 파드 → GCP API (KSA↔GSA 매핑) | ① 클러스터 내부 Pod |
| **(IAM) Workload Identity Federation** | 외부 워크로드(온프렘·타클라우드·CI/CD) → GCP, 단기 자격 교환 | ② 온프렘 CI/CD 러너 |

| 선택지 | 오답 이유 |
|--------|----------|
| (B) | ①②를 뒤바꿈 — GKE 파드에 외부용 federation을 붙일 이유 없음 |
| (C) | Workforce Identity Federation은 **사람**(직원 SSO→콘솔·gcloud)용. 머신 워크로드 아님 |
| (D) | 두 기능 모두 키 파일 자체를 제거하는 것이 목적 — Secret Manager에 키를 두는 것은 반대 방향 |

셋(Workforce / Workload Federation / Federation for GKE)을 헷갈리지 말 것: 사람 / 외부 워크로드 / GKE 파드.

</div>
</details>

---

**Q10. Helicopter Racing League — GPU 추론 서빙**

HRL은 실시간 경기 예측을 위해 **커스텀 GPU 추론 컨테이너**를 GKE에 배포한다. NVIDIA GPU 노드 풀과 드라이버 설치용 DaemonSet이 필요하고, 시청자 급증 시 GPU 노드까지 자동 확장되어야 한다. 가장 적합한 구성은?

- (A) Autopilot 클러스터 + HPA. Autopilot이 GPU와 드라이버를 자동 관리하므로 노드 풀이 필요 없다.
- (B) Standard 클러스터 + GPU 노드 풀 + 드라이버 DaemonSet + HPA(추론 Pod) + Cluster Autoscaler/NAP(GPU 노드).
- (C) Standard 클러스터에 GPU 노드 풀을 고정 크기로 두고 오토스케일 없이 최대치로 상시 운영한다.
- (D) 추론을 GKE 대신 전부 Vertex AI training으로 옮긴다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

커스텀 GPU 노드 풀 + 드라이버 DaemonSet이 필요하므로 **Standard**다. 확장은 두 레이어로 나뉜다 — 추론 Pod 수는 **HPA**, GPU 노드 수는 **Cluster Autoscaler**(기존 GPU 풀로 부족하면 **NAP**가 적합한 GPU 노드 풀을 생성).

| 선택지 | 오답 이유 |
|--------|----------|
| (A) | GPU 드라이버 DaemonSet(호스트 접근) 요구가 있으면 Autopilot 부적합. "노드 풀 불필요"도 이 요구와 배치 |
| (C) | 고정 최대 크기 상시 운영은 GPU 비용 낭비 — "자동 확장" 요구 위반 |
| (D) | Vertex AI **training**은 모델 학습용. 여기 요구는 실시간 **추론 서빙**이며 커스텀 GPU 컨테이너 제어가 명시됨 |

학습(Vertex AI training) vs 실시간 추론 서빙(커스텀 GPU면 GKE Standard)을 구분하는 것이 핵심.

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
- Google Cloud, [*Gateway API*](https://cloud.google.com/kubernetes-engine/docs/concepts/gateway-api) — Ingress 후속 표준(GKE 1.24+, Autopilot·Standard)
- Google Cloud, [*Fleet management overview*](https://cloud.google.com/kubernetes-engine/fleet-management/docs) — GKE Enterprise·멀티클러스터·fleet
- Google Cloud, [*Professional Cloud Architect — case studies*](https://cloud.google.com/learn/certification/guides/professional-cloud-architect) — Mountkirk Games·Helicopter Racing League 공식 케이스
