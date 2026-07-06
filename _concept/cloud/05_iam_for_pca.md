---
layout  : concept
title   : Google Cloud IAM 권한 모델 설계 결정
date    : 2026-06-28 00:00:00 +0900
updated : 2026-07-06 00:00:00 +0900
tag     : cloud gcp iam security
toc     : true
comment : true
latex   : false
status  : complete
public  : true
parent  : [[/cloud]]
relations:
  - { type: references, target: /concept/cloud/01_how_to_operate_iam_well }
confidence     : medium
valid_from     : 2026-06-28
---

* TOC
{:toc}

> "팀원 전체에게 Editor를 줬는데 왜 감사에서 걸리죠?" — 기본 역할(Basic Role)의 과잉 권한이 IAM 문제의 시작점이다. 이 글은 역할 3종 선택과 정책 상속이 PCA 시험 IAM 파트의 핵심임을 보이고, **"누가(Principal) 무엇을(Role) 어디서(Resource) 할 수 있는가"라는 의사결정 구조**로 모든 IAM 문제를 풀 수 있음을 보인다. 이 글은 PCA 준비 시리즈 4편이다.

---

## 도입 — IAM은 세 질문의 교차점

GCP의 모든 리소스 접근은 IAM이 결정한다. IAM 정책은 단순하다 — **"Principal이 Resource에 Role을 가진다"**. 그러나 그 단순함 안에 PCA가 파는 함정이 있다: 정책 상속은 누적이고 취소가 안 되며, 역할은 3종이 목적이 다르고, Org Policy는 IAM과는 다른 레이어에서 작동한다.

PCA 시험의 IAM 문제는 세 패턴이다 — ① 역할 유형 선택(Basic vs Predefined vs Custom), ② 계층 상속 트랩, ③ Org Policy vs IAM 구분. 각 패턴의 판단 기준을 손에 쥐는 것이 이 글의 목표다.

<div class="callout-note">
이 글의 지도: 기본 모델(Principal·Role·Policy) → 역할 3종 → 리소스 계층과 상속 → Service Account → Workload Identity Federation → Workforce Identity Federation → 직무 분리(SoD) → Org Policy vs IAM → 권한 상한 3계층(Org Policy·IAM Deny·PAB) → IAM Conditions → 케이스 스터디 접점 → 시험 공략 → 퀴즈. 각 축은 "함정 → 판단 기준 → 결론"으로 닫는다.
</div>

---

## 기본 모델 — Principal · Role · Resource

### IAM의 세 요소

**Principal(주체)**: 누구에게 권한을 부여하는가.

| Principal 유형 | 설명 |
|---------------|------|
| Google Account | 개인 구글 계정 (user@gmail.com) |
| Service Account | 기계 신원 (애플리케이션·VM) |
| Google Group | 멤버 전체에 일괄 적용 |
| Workspace/Cloud Identity Domain | 도메인 전체 |
| `allUsers` | 인터넷 전체 (공개) |
| `allAuthenticatedUsers` | 구글 계정이 있는 모든 사용자 |

**Role(역할)**: 무엇을 할 수 있는가 — 권한(permission)의 묶음이다. 개별 권한(`storage.objects.get`)을 직접 부여하지 않고 역할(`roles/storage.objectViewer`)을 통해 부여한다.

**Policy Binding**: `Principal + Role + Resource`의 결합. IAM 정책은 이 바인딩의 목록이다.

```json
{
  "bindings": [
    {
      "role": "roles/storage.objectViewer",
      "members": ["user:dev@company.com", "group:engineers@company.com"]
    }
  ]
}
```

**결론**: IAM = "누가(Principal) 무엇을(Role) 리소스에서 할 수 있는가"의 바인딩. 이 구조를 이해하면 모든 IAM 문제는 "올바른 Principal·Role·Resource 레벨을 고르는 문제"가 된다.

---

## 역할 3종 — 시험의 핵심 판단

세 역할 유형은 목적이 다르다. 선택 기준이 시험에서 가장 자주 나온다.

<div class="compare-grid">
<div class="compare-col" markdown="1">

**Basic Role (기본 역할)**

`Owner` / `Editor` / `Viewer`

- 수천 개 서비스의 권한을 통째로 포함
- `Editor`: 대부분의 리소스 생성·수정 가능
- 프로덕션에서 **절대 사용하지 말 것**
- 감사·컴플라이언스 즉시 위반

**언제 허용되는가**: 개발·실험 환경에서만, 그것도 임시로.

</div>
<div class="compare-col" markdown="1">

**Predefined Role (사전 정의 역할)**

`roles/storage.objectViewer`, `roles/bigquery.dataEditor` 등

- GCP가 서비스별로 관리
- 최소 권한 원칙에 맞게 세분화
- 권한 목록은 GCP가 업데이트 (새 기능 추가 시 자동 반영)
- **대부분의 케이스에서 1순위 선택**

</div>
</div>

**Custom Role (커스텀 역할)**

조직이 직접 권한 목록을 정의한다. Predefined로 최소 권한을 충족할 수 없을 때 사용한다.

- 특정 권한 조합을 **정밀하게** 제어해야 할 때
- Predefined 역할이 필요 권한보다 넓을 때
- 특정 권한의 **조합을 금지**해야 할 때 (컴플라이언스 요구)
- 단점: 조직이 직접 권한 목록 유지 관리 필요 (새 GCP 기능 자동 반영 안 됨)

```bash
gcloud iam roles create customBqReader \
  --project=my-project \
  --title="Custom BQ Reader" \
  --permissions=bigquery.datasets.get,bigquery.tables.getData,bigquery.jobs.create
```

<div class="callout-warning">
"감사팀이 특정 권한 조합을 금지하라 했다" → Custom Role. "서비스 X의 읽기만 허용하라" → 먼저 Predefined에서 찾아라. Predefined에 맞는 것이 있으면 Custom을 만들 필요 없다.
</div>

**결론**: Basic = 금지(프로덕션), Predefined = 1순위, Custom = Predefined로 충족 안 될 때.

---

## 리소스 계층과 정책 상속 — 함정 1순위

### 리소스 계층

GCP 리소스는 4단계 계층을 가진다.

```
조직(Organization)
  └── 폴더(Folder)
        └── 프로젝트(Project)
              └── 리소스(GCS 버킷, VM, 등)
```

IAM 정책은 **어느 레벨에든** 부여할 수 있다. 상위 레벨의 정책은 하위 레벨로 **상속**된다.

### 정책 상속은 누적(Additive)이다

이것이 가장 큰 함정이다.

<div class="callout-warning">
IAM 정책 상속은 <strong>누적(additive)</strong>이다. 상위에서 부여된 권한은 하위에서 <strong>취소(revoke)할 수 없다</strong>. 조직 레벨의 <code>roles/storage.admin</code>을 받은 Principal은 프로젝트 레벨에서 <code>roles/storage.viewer</code>만 부여해도 storage.admin을 유지한다.
</div>

```
조직: user@company.com → roles/storage.admin  ← 상속됨
  └── 프로젝트 A: user@company.com → roles/storage.viewer ← 추가만 됨
```

프로젝트 A에서 user는 `storage.admin + storage.viewer` = 결과적으로 **storage.admin** 수준의 권한을 갖는다. 프로젝트에서 하위 역할을 부여해도 상위 역할이 사라지지 않는다.

**최소 권한 원칙 적용**: 상위 계층에 역할을 부여할수록 영향 범위가 넓어진다. 역할은 **필요한 가장 낮은 레벨**에 부여한다.

<details>
<summary>심화 — IAM Deny: 예외적 거부 정책 (검증 필요)</summary>
<div markdown="1">

Google이 IAM Deny를 출시하면서 "하위에서 상위 권한 취소 불가"에 예외가 생겼다.

**IAM Deny**: 특정 Principal의 특정 권한을 명시적으로 거부(deny)하는 정책. IAM Allow(기존 바인딩)보다 우선한다.

```json
{
  "name": "deny-storage-delete",
  "denyRules": [{
    "deniedPrincipals": ["user:intern@company.com"],
    "deniedPermissions": ["storage.googleapis.com/objects.delete"]
  }]
}
```

단, IAM Deny는 **개별 권한(permission) 레벨**에서 작동하며 역할 전체를 취소하는 것이 아니다. 운영 복잡성이 늘어나기 때문에 남발하지 않는 것이 권장된다. 공식 문서로 현재 GA 여부와 제약을 확인 권장.

</div>
</details>

**결론**: 정책 상속은 누적. 상위 역할 부여 시 모든 하위 리소스에 영향. 역할은 필요한 가장 낮은 레벨에 최소 범위로.

---

## Service Account — 기계 신원 관리

사람이 아닌 **애플리케이션·VM·서비스**가 GCP API를 호출할 때 쓰는 신원이다.

### SA 유형

| 유형 | 관리 주체 | 예시 |
|------|---------|------|
| **User-managed SA** | 사용자 생성·관리 | `my-app@project.iam.gserviceaccount.com` |
| **Google-managed SA** | GCP 자동 생성 | App Engine 기본 SA, GCE 기본 SA |
| **Default SA** | 프로젝트 자동 생성 | `project-number-compute@developer.gserviceaccount.com` |

<div class="callout-warning">
GCE 기본 SA(Default Compute SA)는 생성 시 <code>roles/editor</code>를 자동으로 가진다. VM에 SA를 별도 지정하지 않으면 이 기본 SA가 쓰인다 — 즉, 모든 VM이 Editor 권한을 가지는 상태. <strong>프로덕션에서 반드시 최소 권한 SA로 교체</strong>해야 한다.<br><br>
단, 이 "자동 editor 부여"는 환경에 따라 다르다 — 2024년경 이후 새로 만들어진 조직에서는 <code>iam.automaticIamGrantsForDefaultServiceAccounts</code> 조직 정책이 기본 적용되어 기본 SA에 <code>roles/editor</code>가 자동으로 붙지 않을 수 있다. 시험은 여전히 "기본 SA = editor = 과다 권한" 프레임으로 출제되지만, 실제 운영 환경에서는 이 조직 정책 적용 여부를 먼저 확인하라.
</div>

### SA Impersonation (SA 가장)

SA 키 파일 없이 다른 SA의 권한을 임시로 빌리는 방법이다. `roles/iam.serviceAccountTokenCreator`를 가진 Principal이 대상 SA의 토큰을 생성할 수 있다.

```bash
gcloud storage ls \
  --impersonate-service-account=target-sa@project.iam.gserviceaccount.com
```

**언제 쓰는가**: CI/CD 파이프라인, 배포 자동화, 감사 목적 일시 접근 등 키 파일 없이 SA 권한이 필요한 경우.

### SA 키 파일 — 최후의 수단

SA 키 파일(JSON)은 유출 시 영구적 자격증명이 된다. GCP는 다음 순서로 대안을 우선한다.

```
Workload Identity (GKE) / 메타데이터 서버 (GCE)
    ↓ 불가능할 때
SA Impersonation
    ↓ 불가능할 때
SA 키 파일 (최후의 수단)
```

**결론**: SA = 기계 신원. GCE 기본 SA는 Editor — 반드시 교체. 키 파일은 최후의 수단.

---

## Workload Identity Federation — 키 없는 외부 연합

앞의 폴백 사다리에서 "GKE Workload Identity"가 나왔다. 그런데 PCA에는 이름이 비슷하지만 **다른 문제를 푸는** 기능이 하나 더 있다 — Workload Identity Federation(WIF). 둘은 시험에서 가장 흔히 뒤섞이는 쌍이다.

### 두 기능은 무엇을 푸는가

- **GKE Workload Identity**: GKE **클러스터 안**의 Kubernetes 워크로드(Pod)가 GCP API를 호출할 때, K8s SA를 GCP SA에 매핑해 SA 키 없이 인증한다. 무대는 GCP 내부(GKE)다.
- **Workload Identity Federation(WIF)**: GCP **밖**의 워크로드(AWS·Azure 워크로드, GitHub Actions, 온프레미스 OIDC 앱 등)가 자기 IdP가 발급한 토큰을 들고 와, SA 키 파일 없이 GCP에 접근한다. 무대는 외부 클라우드/CI다.

<div class="compare-grid">
<div class="compare-col" markdown="1">

**GKE Workload Identity**

클러스터 내부 워크로드용

- 주체: 클러스터의 Kubernetes SA(KSA)
- 매핑: KSA ↔ GCP SA
- 무대: **GCP 내부**(GKE)
- 신호어: "GKE Pod가 키 없이 GCP API"

</div>
<div class="compare-col" markdown="1">

**Workload Identity Federation**

외부·멀티클라우드 워크로드용

- 주체: 외부 IdP(AWS/Azure/OIDC/GitHub)
- 매핑: 외부 신원 ↔ GCP SA(또는 직접 리소스 접근)
- 무대: **GCP 외부**
- 신호어: "외부/멀티클라우드 워크로드가 SA 키 없이", "키리스 연합"

</div>
</div>

### WIF 작동 방식

WIF는 **Workload Identity Pool**과 그 안의 **Provider**를 만들어, 외부 IdP의 토큰을 신뢰하도록 설정한다. 외부 워크로드는 자기 IdP 토큰을 GCP STS에 제출하고, GCP는 이를 단기(short-lived) 액세스 토큰으로 교환해 준다. SA 키 파일(영구 자격증명)이 사라지는 것이 핵심 이득이다.

```
외부 워크로드(예: GitHub Actions)
  → 자기 IdP의 OIDC 토큰 발급
  → GCP STS에 토큰 제출 (Workload Identity Pool/Provider가 신뢰)
  → 단기 GCP 액세스 토큰으로 교환
  → (필요 시 대상 SA를 impersonate) → GCP 리소스 접근
```

```bash
# 개념 예시(미실행) — GitHub Actions용 OIDC Provider 등록
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global \
  --workload-identity-pool=ci-pool \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository"
```

<div class="callout-warning">
함정: WIF Provider의 <strong>attribute mapping/condition을 느슨하게</strong> 두면(예: 특정 리포지토리·브랜치 조건 없이 issuer만 신뢰) 외부의 의도치 않은 주체가 SA를 가장할 수 있다. 신뢰 경계를 <code>attribute.repository</code> 등으로 좁혀라.
</div>

**결론**: GCP **내부** GKE Pod 키리스 인증 → GKE Workload Identity. GCP **외부**(AWS/Azure/GitHub 등) 워크로드가 SA 키 없이 접근 → Workload Identity Federation. "외부", "멀티클라우드", "키리스 연합"이 보이면 WIF다.

---

## Workforce Identity Federation — 사람의 외부 SSO

이름이 한 글자 차이라 시험이 노리는 마지막 함정이 남았다 — **Work*load* Identity Federation(WIF)**과 **Work*force* Identity Federation**. 앞 절의 WIF는 **머신·앱·CI/CD**(비인간 워크로드)를 위한 것이었다. Workforce Identity Federation은 **사람**을 위한 것이다.

### 무엇을 푸는가

Workforce Identity Federation은 회사가 이미 쓰는 외부 IdP(Microsoft Entra ID, AD FS, Okta, Ping 등 OIDC/SAML 2.0)의 **직원 신원**으로 GCP 콘솔·`gcloud`·`gsutil`에 로그인하게 한다. 직원마다 Cloud Identity/Workspace 계정을 새로 만들어 동기화하지 않고, 기존 회사 SSO를 그대로 GCP 접근에 쓰는 것이 핵심 이득이다.

<div class="compare-grid">
<div class="compare-col" markdown="1">

**Workload Identity Federation**

비인간(machine) 신원

- 대상: **앱·서비스·CI/CD**(GitHub Actions, AWS/Azure 워크로드, 온프렘 서비스)
- 교환 결과: 단기 액세스 토큰(→ SA impersonate 또는 직접 리소스)
- 목적: **SA 키 파일 제거**
- 신호어: "외부 워크로드", "CI 파이프라인", "멀티클라우드 앱이 키 없이"

</div>
<div class="compare-col" markdown="1">

**Workforce Identity Federation**

인간(human) 신원

- 대상: **직원·사용자**(회사 SSO 사용자)
- 교환 결과: 콘솔/`gcloud` 로그인 세션
- 목적: **기존 IdP로 GCP 콘솔 접근**(계정 중복 생성 회피)
- 신호어: "직원이 기존 IdP/SSO로 콘솔 로그인", "Okta/Entra ID로 GCP 접근"

</div>
</div>

<div class="callout-warning">
세 개를 한 축에 세워라 — <strong>사람이냐 기계냐</strong>, <strong>GCP 내부냐 외부냐</strong>가 판별선이다.
<br><br>
① <strong>GKE Workload Identity</strong>: 기계 · GCP <strong>내부</strong>(클러스터 Pod).<br>
② <strong>Workload Identity Federation</strong>: 기계 · GCP <strong>외부</strong>(CI/타클라우드 앱).<br>
③ <strong>Workforce Identity Federation</strong>: <strong>사람</strong> · 외부 IdP로 콘솔·gcloud 로그인.
<br><br>
지문에 "직원/사용자가 로그인"이 있으면 Work<strong>force</strong>, "앱/워크로드/파이프라인이 접근"이면 Work<strong>load</strong>다. "load = 부하 = 기계가 지는 일"로 외우면 헷갈리지 않는다.
</div>

### 사람 vs 워크로드 — 판별 표

| 신호어 | 정답 | 왜 |
|--------|------|-----|
| "직원이 기존 Okta/Entra ID 계정으로 콘솔 로그인" | **Workforce Identity Federation** | 사람 + 외부 IdP + 콘솔 접근 |
| "GitHub Actions/온프렘 앱이 SA 키 없이 GCS 접근" | **Workload Identity Federation** | 기계 + 외부 + 키리스 |
| "GKE Pod가 SA 키 없이 BigQuery 접근" | **GKE Workload Identity** | 기계 + GCP 내부(클러스터) |
| "직원 수천 명을 Cloud Identity에 동기화하지 않고 GCP 접근 허용" | **Workforce Identity Federation** | 계정 중복 없이 인간 SSO |

**결론**: `force`=사람(콘솔 SSO), `load`=기계(키리스 워크로드). 지문의 주체가 **로그인하는 직원**인지 **호출하는 앱**인지만 가리면 답이 갈린다.

---

## 직무 분리 (Separation of Duties)

최소 권한이 "각자에게 필요한 만큼만"이라면, 직무 분리(SoD)는 "**위험한 권한 조합이 한 주체에 모이지 않게**"다. 한 사람이 변경을 만들고 스스로 승인까지 하면 내부 통제가 무너진다. PCA·보안 문제는 "권한 분리", "한 사람이 모두 할 수 없게", "관리자와 사용자를 나눠라" 같은 신호어로 이 원칙을 묻는다.

### 분리해야 하는 대표 조합

| 분리 대상 | 한쪽 역할 | 다른쪽 역할 | 합쳐지면 위험 |
|----------|----------|------------|--------------|
| 키 관리 ≠ 키 사용 | `roles/cloudkms.admin` (키 생성·회전·정책) | `roles/cloudkms.cryptoKeyEncrypterDecrypter` (암복호화 사용) | 키를 관리하는 사람이 데이터까지 복호화 |
| 배포 ≠ 승인 | 배포 실행 권한 | 변경 승인 권한 | 자기 변경을 자기가 승인(self-approval) |
| 빌링 ≠ 리소스 | `roles/billing.admin` | `roles/owner`·리소스 admin | 비용 통제와 리소스 생성이 한 손에 |
| 로그 관리 ≠ 로그 운영 | 로그 라우팅·삭제 권한 | 일반 운영 권한 | 흔적을 남기는 사람이 흔적을 지움 |

<div class="callout-note">
KMS가 SoD의 교과서 예시다. <code>cloudkms.admin</code>은 키 라이프사이클(생성·회전·파기·IAM 설정)을 다루지만 <strong>암복호화 자체는 못 한다</strong>. 실제 데이터를 암복호화하는 권한은 <code>cryptoKeyEncrypterDecrypter</code>다. 두 역할을 다른 주체(또는 다른 그룹)에 부여하면 "키를 쥔 사람"과 "데이터를 푸는 사람"이 분리된다.
</div>

### GCP에서 SoD를 강제하는 수단

- **역할을 다른 그룹·주체에 분배**: 가장 기본. 위험 조합의 두 역할을 서로 다른 Google Group에 부여하고 사람을 한쪽에만 넣는다.
- **Custom Role로 금지 조합 배제**: Predefined가 위험 권한 둘을 같이 품으면, 한쪽을 뺀 Custom Role을 만든다(Q1 참조).
- **IAM Conditions로 분리**: 승인·배포 동작을 시간·리소스 조건으로 갈라 같은 사람이 동시에 못 하게 한다.
- **상위 계층 점검**: 상속은 누적이므로(앞 절), 조직·폴더 레벨의 광범위 역할이 SoD를 무력화하지 않는지 먼저 확인한다.

<div class="callout-warning">
SoD 설계 시 가장 흔한 실수: 프로젝트 레벨에서 깔끔히 분리해 놓고, 조직 레벨에 <code>roles/owner</code>나 <code>roles/editor</code>를 받은 주체가 있어 두 권한을 모두 상속받는 경우. 분리는 <strong>모든 계층을 합산한 유효 권한</strong> 기준으로 검증해야 한다.
</div>

**결론**: 최소 권한 = "얼마나". 직무 분리 = "어떤 조합이 한 사람에게 모이면 안 되는가". "권한 분리"·"한 사람이 모두 못 하게"가 보이면 위험 조합을 서로 다른 주체로 나누고, 필요하면 Custom Role로 금지 조합을 배제한다.

---

## Org Policy vs IAM — 다른 레이어

PCA에서 가장 많이 틀리는 개념 쌍이다.

<div class="compare-grid">
<div class="compare-col" markdown="1">

**IAM**

"**누가** 무엇을 할 수 있는가"

- Principal과 Role의 바인딩
- 특정 사람/SA에게 특정 서비스 접근 허용
- 예: "infra팀만 VPC를 만들 수 있다"
- 해제 가능 (바인딩 제거)

</div>
<div class="compare-col" markdown="1">

**Org Policy**

"**무엇이** 허용/금지되는가 (환경 제약)"

- IAM 권한과 무관하게 리소스 동작을 제한
- 조직 전체에 강제 적용 (IAM 우회 불가)
- 예: "어떤 프로젝트도 VM에 외부 IP를 달 수 없다"
- `Owner`도 Org Policy를 위반하는 리소스는 생성 불가

</div>
</div>

### Org Policy 제약(Constraints) 유형

| 유형 | 설명 | 예시 |
|------|------|------|
| **Boolean** | 기능 활성화/비활성화 | `constraints/compute.disableSerialPortAccess` |
| **List** | 허용·거부 값 목록 | `constraints/compute.vmExternalIpAccess` (허용 IP 목록) |

**자주 나오는 Constraints**

| Constraint | 효과 |
|-----------|------|
| `compute.vmExternalIpAccess` | VM 외부 IP 허용 범위 제한 |
| `compute.restrictCloudSQLInstances` | 허용된 Cloud SQL 인스턴스만 생성 |
| `iam.allowedPolicyMemberDomains` | IAM 바인딩에 허용되는 도메인 제한 |
| `gcp.resourceLocations` | 리소스 생성 허용 리전 제한 |
| `compute.requireOsLogin` | OS Login 강제 |

**케이스 적용**: "조직 내 모든 프로젝트에서 VM에 외부 IP 할당 금지" → Org Policy (`constraints/compute.vmExternalIpAccess`를 빈 목록으로 설정). IAM으로 `compute.instances.create`를 제한해도 다른 사람이 외부 IP를 달 수 있다 — Org Policy만이 환경 수준에서 강제할 수 있다.

<div class="callout-warning">
Org Policy는 <strong>IAM을 우회한다</strong>. <code>roles/owner</code>를 가진 사용자도 Org Policy 제약을 위반하는 리소스는 생성할 수 없다. "누가 하느냐"와 무관하게 "무엇을 할 수 있느냐"를 환경 수준에서 막는다.
</div>

**결론**: 특정 사람을 제한 → **IAM**. 환경 전체에서 특정 동작 금지 → **Org Policy**.

---

## 권한 상한의 3계층 — Org Policy · IAM Deny · PAB

앞에서 IAM Allow(바인딩)는 **누적**이고 하위에서 취소가 안 된다고 했다. 그렇다면 "이미 넓게 부여된 권한을 어떻게 조인가"라는 질문이 남는다. GCP는 Allow와 **별개로 작동하는 상한/차단 레이어**를 셋 준비해 두었고, 셋의 목적이 달라 시험이 즐겨 섞는다.

<div class="callout-note">
평가 순서로 외우면 편하다. 요청이 들어오면 대략 <strong>Org Policy(리소스 동작 가능한가) → PAB(이 주체가 이 리소스에 손댈 수 있는가, 상한) → IAM Deny(이 권한이 명시적으로 거부됐나) → IAM Allow(허용 바인딩이 있나)</strong> 순으로 걸러진다. Deny와 상한 계층은 <strong>Allow보다 우선</strong>한다 — 아무리 Owner라도 위 셋 중 하나에 걸리면 막힌다.
</div>

<div class="compare-grid">
<div class="compare-col" markdown="1">

**Org Policy (조직 정책)**

"**리소스가 무엇을 할 수 있나**"

- 대상: **리소스 구성**(외부 IP, 리전, 도메인 등)
- 단위: constraint(Boolean/List)
- 주체와 무관 — 환경 전체 제약
- 예: "어떤 VM도 외부 IP 불가"

</div>
<div class="compare-col" markdown="1">

**IAM Deny (거부 정책)**

"**이 주체의 이 권한을 막는다**"

- 대상: **Principal + permission**
- 단위: 개별 permission(`storage.googleapis.com/objects.delete`)
- Allow보다 우선하는 명시적 거부
- 예: "인턴은 객체 삭제 불가"

</div>
</div>

**Principal Access Boundary (PAB)**

세 번째 레이어는 **PAB**다. IAM Deny가 "이 권한을 막는다"라면, PAB는 **"이 주체가 애초에 손댈 수 있는 리소스의 최대 범위"**를 정한다 — 주체별 권한 **상한(ceiling)**이다. 조직·폴더·프로젝트 어디까지를 이 주체가 접근할 수 있는지 경계를 긋고, 그 밖은 Allow 바인딩이 아무리 붙어도 무효가 된다. 특히 **연합 신원(Workforce/Workload Identity Federation)** 같이 외부에서 들어오는 주체의 폭주를 상한으로 눌러 두는 데 쓴다.

<div class="callout-warning">
PAB는 <strong>enforcement version</strong>이라는 개념을 가지며, 최신 <strong>enforcement version 3</strong>에서 경계 밖 접근 차단이 강화됐다(특정 권한까지 상한에서 배제 가능). 다만 PAB의 지원 범위·enforcement version별 세부 동작은 GA 단계에서 계속 진화 중이므로, 실제 설계 전 최신 <a href="https://cloud.google.com/iam/docs/principal-access-boundary-policies">공식 PAB 문서</a>로 현행 제약을 확인하라. 시험 관점에서 외울 핵심은 <strong>"PAB = 주체(특히 연합 신원)의 권한 상한, Allow보다 우선"</strong>이다.
</div>

### 세 레이어 판별 표

| 요구사항 신호어 | 정답 레이어 | 왜 |
|----------------|------------|-----|
| "조직 내 모든 리소스가 특정 동작(외부 IP·리전) 못 하게" | **Org Policy** | 리소스 구성 제약, 주체 무관 |
| "특정 사용자/SA의 특정 권한 하나만 콕 집어 거부" | **IAM Deny** | Principal+permission 단위 명시 거부 |
| "이 (연합) 주체가 접근 가능한 리소스 범위 자체를 상한으로 제한" | **PAB** | 주체별 접근 경계(ceiling) |
| "특정 팀에게만 서비스 접근 허용" | **IAM Allow(바인딩)** | 허용 부여 — 상한/거부가 아님 |

<div class="callout-warning">
가장 흔한 함정: "권한을 <strong>제한</strong>한다"는 지문에 반사적으로 IAM 바인딩 제거를 고르는 것. 바인딩 제거는 <strong>그 한 곳</strong>의 Allow만 없앨 뿐, 상위 상속·다른 바인딩은 그대로다. "전 계층에서 못 하게", "누가 오든 상한", "명시적 거부"가 보이면 Allow가 아니라 <strong>Org Policy / PAB / Deny</strong> 중 하나다.
</div>

**결론**: Allow는 "줄 수 있나", 나머지 셋은 "막는다". **Org Policy=리소스 동작 제약, IAM Deny=주체의 특정 권한 거부, PAB=주체의 접근 범위 상한**. 셋 다 Allow를 이긴다.

---

## IAM Conditions — 문맥 기반 접근 제어

일반 IAM 바인딩은 항상 적용된다. IAM Conditions를 추가하면 **조건이 충족될 때만** 역할이 유효해진다.

조건 속성:

| 속성 | 설명 | 예시 |
|------|------|------|
| `request.time` | 요청 시각 | 특정 날짜·시간 범위만 허용 |
| `resource.name` | 리소스 이름 | 특정 버킷·프로젝트만 허용 |
| `resource.type` | 리소스 유형 | Cloud Storage만 허용 |
| `request.auth.access_levels` | Access Context Manager | 특정 네트워크·기기에서만 허용 |

**케이스 — 분기 감사 접근**: 외부 감사팀이 분기마다 30일간만 BigQuery에 읽기 접근해야 한다.

```
조건: request.time이 2026-07-01 ~ 2026-07-31 사이일 때만 유효
```

Conditions를 쓰면 기간이 끝나면 자동으로 접근이 차단된다. 수동으로 바인딩을 제거할 필요가 없다.

**결론**: 시간·리소스·맥락 기반 조건부 접근 = **IAM Conditions**. 항상 유효한 바인딩보다 안전하다.

---

## 시험장에서 — 문제 유형별 공략

### 아키텍처 설계형

| 요구사항 키워드 | 정답 |
|----------------|------|
| 프로덕션에서 최소 권한 역할 | **Predefined** (먼저 탐색), 없으면 **Custom** |
| 특정 권한 조합 제어·컴플라이언스 | **Custom Role** |
| 조직 전체 특정 동작 금지 | **Org Policy (constraints)** |
| 특정 사람만 특정 서비스 접근 | **IAM 바인딩** |
| VM에서 키 파일 없이 GCP API | **SA 연결 + 메타데이터 서버** |
| GKE Pod에서 키 파일 없이 GCP API | **GKE Workload Identity** (KSA↔GCP SA) |
| 외부·멀티클라우드 워크로드(AWS/Azure/GitHub)가 SA 키 없이 GCP | **Workload Identity Federation** |
| 직원이 기존 IdP(Okta/Entra ID)로 콘솔·gcloud 로그인 | **Workforce Identity Federation** |
| 특정 주체(연합 신원 포함)의 접근 범위 자체를 상한으로 제한 | **Principal Access Boundary (PAB)** |
| 특정 Principal의 특정 권한 하나를 명시적으로 거부 | **IAM Deny 정책** |
| 위험 권한 조합이 한 주체에 모이지 않게 | **직무 분리** — 역할을 다른 그룹에 분배 / 금지 조합은 Custom Role |
| 일시적·조건부 접근 | **IAM Conditions (request.time)** |

### 트러블슈팅형 — 정책 상속 체크리스트

| 점검 | 흔한 원인 |
|------|----------|
| "하위 프로젝트에서 역할을 제거했는데 권한이 남는다" | 상위(폴더·조직)에서 동일 Principal에게 역할 부여됨 |
| "Owner를 제거했는데 여전히 리소스를 만든다" | Org Policy가 아닌 IAM으로는 리소스 생성 동작 자체를 막을 수 없음 → Org Policy 필요 |
| "SA 키 없이도 GCP API 호출된다" | GCE 기본 SA 또는 Workload Identity로 자동 인증 중 |

### 비교선택형 — 혼동 쌍

| 질문 | 판별 |
|------|------|
| IAM vs Org Policy | IAM=누가 / Org Policy=무엇을 (환경 제약) |
| Basic vs Predefined vs Custom | Basic=금지 / Predefined=1순위 / Custom=정밀 제어 |
| SA 키 vs Workload Identity | 키=유출 위험 / WI=키 없는 인증(권장) |
| GKE Workload Identity vs WIF | GKE WI=GCP 내부 Pod / WIF=GCP 외부·멀티클라우드 연합 |
| 최소 권한 vs 직무 분리 | 최소 권한=얼마나 / SoD=위험 조합을 한 사람에 안 모음 |
| 영구 바인딩 vs 조건부 접근 | 조건 있으면=IAM Conditions |

---

## 케이스 스터디 접점 — IAM 관점

PCA 시험은 4개 공식 케이스 스터디(EHR Healthcare / Helicopter Racing League / Mountkirk Games / TerramEarth)에서 케이스당 여러 문항을 낸다. IAM은 그중 **규제·감사가 강한 EHR Healthcare**와 **파트너 접근·API 권한이 핵심인 TerramEarth**에서 특히 자주 묻는다.

### EHR Healthcare — 규제·최소권한·감사

멀티병원 EHR SaaS로 HIPAA를 요구하고, "**전 접근 감사 로깅**"과 통합 로깅·모니터링이 명시된 케이스다. IAM 관점에서 반복되는 요구→결정은 다음과 같다.

| 요구사항(케이스) | IAM 설계 결정 | 이유 |
|-----------------|--------------|------|
| HIPAA·최소 권한 준수 | **Predefined 우선, 필요 시 Custom Role**. Basic Role(Editor/Owner) 금지 | 규제 감사에서 과잉 권한은 즉시 지적 |
| 전 접근 감사 로깅 | **로그 관리 ≠ 로그 운영 직무 분리** + 로그 라우팅/삭제 권한 격리 | 흔적을 남기는 사람이 흔적을 못 지우게 |
| 키 관리 통제(저장 암호화) | **`cloudkms.admin` ≠ `cryptoKeyEncrypterDecrypter` 분리** | 키 관리자가 데이터까지 복호화 못 하게(SoD) |
| 온프렘 레거시·직원 접근 | 직원은 기존 IdP로 **Workforce Identity Federation**, 온프렘 앱은 **Workload Identity Federation** | 계정 중복·SA 키 없이 규제 경계 유지 |

<div class="callout-note">
EHR 유형 문항의 오답은 대개 "빠르니까 Editor 부여"·"기본 SA 그대로" 쪽이다. 규제 케이스에서는 <strong>최소 권한 + 직무 분리 + 감사 가능성</strong>이 세트로 정답을 만든다.
</div>

### TerramEarth — 파트너 접근·API 권한

중장비 제조사로 **500+ 딜러·100개국**이 데이터와 API에 접근하는 케이스다. "외부 파트너(딜러)에게 어떻게 권한을 주는가"가 IAM 초점이다.

| 요구사항(케이스) | IAM 설계 결정 | 이유 |
|-----------------|--------------|------|
| 수백 딜러의 API 접근 | 딜러 API는 **Apigee로 게이트**(API 키/OAuth), IAM은 백엔드 SA 최소 권한 | 외부 파트너를 IAM 바인딩에 직접 안 넣음 |
| 파트너 앱이 GCP 리소스에 프로그래매틱 접근 | 파트너 워크로드는 **Workload Identity Federation**(SA 키 배포 금지) | 외부에 장수명 SA 키를 뿌리지 않음 |
| 딜러별 접근 범위 제한 | **IAM Conditions**(리소스·속성) + 필요 시 **PAB로 연합 주체 상한** | 딜러가 자기 데이터 경계 밖으로 못 나가게 |
| 대량 외부 주체의 권한 폭주 방지 | **그룹 기반 부여 + 상한(PAB)** | 딜러마다 개별 바인딩은 관리 불가 |

<div class="callout-warning">
TerramEarth 함정: "딜러 수백 명에게 GCP 접근을 준다"에 <code>allUsers</code>·개별 SA 키·Editor를 고르면 오답이다. <strong>외부 파트너 = API 게이트(Apigee) + 키리스 연합(WIF) + 그룹/상한</strong>이 정답 골격이다.
</div>

**결론**: EHR는 "규제·최소권한·감사(SoD·CMEK·로그 분리)", TerramEarth는 "파트너·API 권한(Apigee·WIF·PAB 상한)". 케이스 지문의 규제 강도와 외부 주체 유무로 IAM 정답 축이 갈린다.

---

## 실전 퀴즈 — 핵심 개념 검증

---

**Q1. 역할 유형 선택 — 컴플라이언스 요구사항**

보안 감사에서 "프로덕션 프로젝트의 어떤 사용자도 `storage.objects.delete`와 `logging.logEntries.delete`를 동시에 가질 수 없다"는 요구사항이 나왔다. 현재 팀은 `roles/storage.admin`과 `roles/logging.admin`을 사용 중이다. 올바른 대응은?

- (A) Predefined 역할 목록에서 두 권한을 모두 포함하지 않는 조합을 찾아 교체한다.
- (B) Custom 역할을 만들어 각 구성원에게 필요한 권한만 포함시키고, 금지 조합이 한 사람에게 부여되지 않도록 설계한다.
- (C) Basic 역할 `Viewer`로 교체하면 삭제 권한이 없으므로 요구사항을 충족한다.
- (D) Org Policy의 `constraints/iam.disableServiceAccountCreation`으로 권한 조합을 제한한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

특정 권한 조합을 사람별로 정밀하게 제어하려면 **Custom 역할**이 필요하다. Predefined 역할은 GCP가 설계한 권한 묶음이며 조합 제어 단위가 아니다 — (A)는 Predefined에서 우연히 두 권한이 분리된 것을 찾는 방식이라 우연에 의존하고 향후 GCP가 역할을 업데이트하면 무너진다.

Custom 역할로 ① storage 역할에서 `storage.objects.delete`를 제외하거나, ② logging 역할에서 `logging.logEntries.delete`를 제외하는 방식으로 조합을 제어한다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | 권한 조합 제어가 아닌 우연한 분리에 의존 |
| (C) | `Viewer`는 Basic Role — 프로덕션 금지. 그리고 읽기 권한조차 과다 포함 가능 |
| (D) | 이 constraint는 SA 생성 비활성화 용도 — IAM 역할 권한 조합 제어와 무관 |

</div>
</details>

---

**Q2. 정책 상속 — 누적의 함정**

조직 구조가 다음과 같다.

- 조직: `user@company.com` → `roles/storage.admin` 바인딩
- 프로젝트 "prod-app": `user@company.com` → `roles/storage.viewer` 바인딩

`user@company.com`이 프로젝트 "prod-app"의 GCS 버킷에서 실질적으로 할 수 있는 것은?

- (A) `roles/storage.viewer`만 적용 — 프로젝트 레벨 정책이 상위를 덮어쓴다.
- (B) `roles/storage.admin` + `roles/storage.viewer` 모두 적용 — 상속은 누적이므로 storage.admin 권한이 포함된다.
- (C) 아무것도 못함 — 같은 리소스에 두 역할이 충돌하면 더 제한적인 쪽이 적용된다.
- (D) `roles/storage.admin`만 적용 — 상위 역할이 하위 역할을 덮어쓴다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

IAM 정책 상속은 **누적(additive)**이다. 상위 계층에서 부여된 권한은 하위에서 취소할 수 없다.

조직 레벨의 `storage.admin`이 프로젝트 "prod-app"으로 상속된다. 프로젝트 레벨의 `storage.viewer`는 **추가**될 뿐이다. 결과적으로 user는 `storage.admin + storage.viewer` = 사실상 **storage.admin** 수준의 권한을 갖는다.

이것이 "최소 권한을 주려고 프로젝트에 Viewer만 바인딩했는데 여전히 삭제가 된다"는 현상의 원인이다. 조직 레벨의 강한 역할을 먼저 제거하지 않으면 하위에서 약한 역할을 줘도 의미가 없다.

(A)(C)는 "덮어쓰기" 또는 "충돌 시 제한적인 쪽"이라는 존재하지 않는 동작을 전제한다.

</div>
</details>

---

**Q3. Org Policy vs IAM 선택**

CISO가 두 요구사항을 제시했다.

- ① 조직 내 모든 프로젝트에서 VM에 외부 IP를 할당하는 것을 금지한다.
- ② 인프라팀(`infra@company.com`)만 프로젝트에 새로운 VPC를 생성할 수 있다.

각 요구사항에 맞는 도구 조합은?

- (A) ① Org Policy (`constraints/compute.vmExternalIpAccess`), ② IAM (`roles/compute.networkAdmin`을 인프라팀에만 부여)
- (B) ① IAM (모든 사용자에서 `compute.instances.setMetadata` 제거), ② Org Policy
- (C) ① IAM Deny (외부 IP 할당 권한 거부), ② Org Policy
- (D) 둘 다 Org Policy로 처리한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (A)**

| 요구사항 | 레이어 | 이유 |
|---------|-------|------|
| ① VM 외부 IP 금지 (전원, 전 프로젝트) | **Org Policy** | "무엇을" — 환경 수준 동작 제한. IAM 권한 유무와 무관하게 강제. `Owner`도 위반 불가 |
| ② 특정 팀만 VPC 생성 | **IAM** | "누가" — 인프라팀에게만 `compute.networks.create` 권한 포함 역할 부여 |

(B)는 IAM으로 ①을 해결하려 한다. 그러나 IAM은 "누가 할 수 있는가"이며 모든 사람에게서 권한을 제거하는 것은 관리 불가능하고, 새 계정 생성 시마다 반복해야 한다. Org Policy가 적합하다.

(D)는 ②를 Org Policy로 처리하려 한다. Org Policy는 특정 Principal을 지정하는 도구가 아니다.

</div>
</details>

---

**Q4. Service Account 보안 — 최소 위험 선택**

GCE VM에서 BigQuery에 읽기 전용 쿼리를 실행해야 한다. 다음 중 보안 위험이 가장 낮은 방법은?

- (A) SA 키 파일을 VM의 `/etc/sa-key.json`에 저장하고 `GOOGLE_APPLICATION_CREDENTIALS` 환경변수로 지정한다.
- (B) `roles/bigquery.dataViewer`가 부여된 User-managed SA를 VM에 연결(attach)한다. 키 파일은 사용하지 않는다.
- (C) SA 키를 Secret Manager에 저장하고 VM에서 Secret Manager API로 가져온다.
- (D) GCE 기본 SA를 그대로 쓴다. 기본 SA는 BigQuery 접근 권한을 이미 포함한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

GCE VM에 SA를 직접 연결하면 VM이 **인스턴스 메타데이터 서버**를 통해 자동으로 SA 토큰을 받는다. 키 파일이 없으므로 유출 위험이 없다. 최소 권한 역할(`bigquery.dataViewer`)로 제한한다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | 파일 시스템에 키 노출 — 서버 침해 시 영구 자격증명 탈취 |
| (C) | Secret Manager에서 키를 가져와도 키 파일 자체가 존재하고 메모리에 적재됨 |
| (D) | GCE 기본 SA는 (조직 정책으로 차단되지 않은 한) `roles/editor`를 자동 부여 — 과다 권한. 최소 권한 원칙 위반 |

"키 없는 인증"과 "최소 권한 SA"의 조합이 (B)다.

</div>
</details>

---

**Q5. IAM Conditions — 시간 기반 접근 제어**

외부 감사팀(`audit@external.com`)이 매 분기 감사 기간(30일)에만 BigQuery 데이터에 읽기 접근해야 한다. 감사 기간 외에는 자동으로 접근이 차단되어야 하며, 수동 관리 오류를 최소화해야 한다.

가장 적합한 구현은?

- (A) 분기마다 수동으로 IAM 바인딩을 추가하고 감사 후 제거한다.
- (B) `request.time` 속성을 사용한 IAM Conditions로 시간 범위 조건이 포함된 바인딩을 설정한다.
- (C) Org Policy의 `constraints/iam.allowedPolicyMemberDomains`로 `external.com` 도메인을 감사 기간에만 허용한다.
- (D) VPC Service Controls의 Access Level에 시간 조건을 설정해 BigQuery 접근을 제한한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

IAM Conditions의 `request.time` 속성을 사용하면 특정 날짜·시간 범위에만 역할이 유효하다. 조건이 만족되지 않으면 바인딩이 자동으로 무효화된다 — 수동 제거 불필요.

```
조건: "2026-10-01T00:00:00Z" <= request.time < "2026-10-31T23:59:59Z"
```

| 선택지 | 문제점 |
|--------|--------|
| (A) | 수동 관리 — 제거를 잊으면 영구 접근. 요구사항(수동 오류 최소화) 위반 |
| (C) | 이 constraint는 IAM 바인딩에 허용되는 **도메인**을 제한하는 용도. 시간 제한 기능 없음 |
| (D) | VPC-SC Access Level은 네트워크 경계 기반 리소스 접근 제어이며, IAM 역할의 시간 제한과는 다른 레이어 |

"자동으로 차단, 수동 관리 없음" → **IAM Conditions**.

</div>
</details>

---

**Q6. 외부 워크로드 인증 — 키리스 연합**

GitHub Actions 파이프라인에서 GCS 버킷에 아티팩트를 업로드해야 한다. 보안팀은 "장수명 SA 키 파일을 CI 시스템에 저장하지 말 것"을 요구한다. 가장 적합한 방법은?

- (A) GKE Workload Identity를 설정해 GitHub Actions가 Kubernetes SA로 인증하게 한다.
- (B) Workload Identity Federation으로 GitHub의 OIDC Provider를 Workload Identity Pool에 등록하고, 리포지토리 조건으로 신뢰 범위를 좁힌 뒤 단기 토큰으로 GCS에 접근한다.
- (C) SA 키 파일을 만들어 GitHub Actions Secret에 저장하고 워크플로우에서 주입한다.
- (D) `allUsers`에게 `roles/storage.objectCreator`를 부여해 인증 없이 업로드한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

GitHub Actions는 GCP **외부** 워크로드다. 외부 IdP(GitHub의 OIDC)가 발급한 토큰을 SA 키 없이 GCP에 연합하는 기능이 **Workload Identity Federation**이다. Provider에 `attribute.repository` 등 조건을 걸어 특정 리포지토리·브랜치만 신뢰하도록 범위를 좁힌다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | GKE Workload Identity는 GKE **클러스터 내부** Pod용. 외부 CI에는 해당 없음 — 이름이 비슷한 다른 기능 |
| (C) | 장수명 키 파일을 CI에 저장 — 보안팀 요구사항 정면 위반 |
| (D) | 인터넷 전체 공개 — 심각한 보안 사고 |

"외부·멀티클라우드 워크로드 + SA 키 없이" → **Workload Identity Federation**.

</div>
</details>

---

**Q7. 직무 분리 — KMS 키 통제**

규정 준수 감사에서 "암호화 키를 관리(생성·회전·파기)하는 담당자가 그 키로 보호된 데이터를 직접 복호화할 수 없어야 한다"는 요구가 나왔다. 올바른 IAM 설계는?

- (A) 키 관리자와 데이터 사용자 모두에게 `roles/cloudkms.admin`을 부여한다.
- (B) 키 관리 담당 그룹에는 `roles/cloudkms.admin`을, 데이터 처리 담당 그룹에는 `roles/cloudkms.cryptoKeyEncrypterDecrypter`를 부여하고, 두 그룹의 구성원이 겹치지 않게 한다.
- (C) 모두에게 `roles/owner`를 부여하되 IAM Conditions로 시간을 제한한다.
- (D) Org Policy로 KMS 키 생성을 비활성화한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

이것이 직무 분리(SoD)의 교과서 사례다. `roles/cloudkms.admin`은 키 라이프사이클을 다루지만 **암복호화 자체는 못 한다**. 실제 복호화 권한은 `roles/cloudkms.cryptoKeyEncrypterDecrypter`다. 두 역할을 서로 다른 그룹에 부여하고 구성원이 겹치지 않게 하면 "키를 관리하는 사람"과 "데이터를 푸는 사람"이 분리된다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | `cloudkms.admin`만으로는 복호화가 안 되지만, 같은 주체에 두 역할을 다 주면 분리가 무너짐 — 분리 자체를 안 함 |
| (C) | `roles/owner`는 Basic Role(과다 권한)이고, 시간 제한은 직무 분리가 아니다 |
| (D) | 키 생성을 막으면 키 자체를 못 쓴다 — 요구사항(분리)과 무관 |

단, 상속은 누적이므로(앞 절) 조직·폴더 레벨에서 두 그룹 중 한쪽이 광범위 역할을 상속받지 않는지 **유효 권한 합산** 기준으로 검증해야 한다.

</div>
</details>

---

**Q8. Workforce vs Workload Identity Federation — 사람 vs 기계**

한 회사가 두 가지를 요구한다. ① 직원 수천 명이 회사의 기존 **Okta** 계정으로 GCP 콘솔과 `gcloud`에 로그인해야 한다(Cloud Identity에 계정을 중복 생성하고 싶지 않다). ② **온프레미스 배치 애플리케이션**이 SA 키 파일 없이 GCS에 접근해야 한다. 각각에 맞는 것은?

- (A) ① Workforce Identity Federation, ② Workload Identity Federation
- (B) ① Workload Identity Federation, ② Workforce Identity Federation
- (C) 둘 다 Workforce Identity Federation
- (D) ① Cloud Identity 디렉터리 동기화, ② SA 키를 Secret Manager에 저장

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (A)**

판별선은 **주체가 사람인가 기계인가**다. ①은 **직원(사람)**이 외부 IdP로 콘솔에 로그인 → Work**force** Identity Federation. ②는 **애플리케이션(기계)**이 키 없이 접근 → Work**load** Identity Federation.

| 선택지 | 문제점 |
|--------|--------|
| (B) | force/load를 반대로 매핑 — 사람↔기계가 뒤집힘 |
| (C) | ②의 주체는 앱(워크로드)이므로 Workforce가 아니다 |
| (D) | ①의 디렉터리 동기화는 "계정 중복 생성 회피" 요구와 상충, ②는 키 파일을 다시 만드는 것이라 "키 없이" 요구 위반 |

"load = 부하 = 기계가 지는 일"로 외운다.

</div>
</details>

---

**Q9. 권한 상한 3계층 — Deny vs Org Policy vs PAB**

보안팀이 요구한다. "**특정 인턴 계정**이 프로덕션 프로젝트에서 `storage.objects.delete` 권한을 **절대** 갖지 못하게 하라. 이 계정은 상위 폴더에서 `roles/storage.admin`을 상속받고 있어 프로젝트에서 바인딩을 지워도 삭제 권한이 남는다." 가장 정확한 대응은?

- (A) 프로젝트 레벨에서 인턴의 `roles/storage.admin` 바인딩을 제거한다.
- (B) 인턴 계정을 대상으로 `storage.googleapis.com/objects.delete`를 거부하는 **IAM Deny 정책**을 설정한다.
- (C) Org Policy `constraints/storage.uniformBucketLevelAccess`를 활성화한다.
- (D) 프로젝트에 `roles/storage.viewer`를 추가로 부여해 권한을 낮춘다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

"상속받은 권한을 특정 주체+특정 permission 단위로 확실히 막는다" → **IAM Deny 정책**. Deny는 Allow보다 우선하므로 상위 폴더에서 상속된 `storage.admin`이 있어도 `objects.delete`만 콕 집어 차단한다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | 프로젝트 바인딩을 지워도 **상위 폴더 상속**이 남는다 — 문제 지문이 이미 이 함정을 명시 |
| (C) | 이 constraint는 버킷 균일 접근 제어용 — 특정 주체의 삭제 권한과 무관 |
| (D) | 상속은 누적 — viewer를 더해도 admin이 사라지지 않음(Q2 원리) |

만약 요구가 "이 주체가 접근할 수 있는 **리소스 범위 자체**를 상한으로 좁혀라"였다면 **PAB**가, "모든 프로젝트에서 특정 **리소스 동작**을 막아라"였다면 **Org Policy**가 답이 된다. 세 레이어의 단위(권한/범위/동작)를 구분하라.

</div>
</details>

---

**Q10. Principal Access Boundary — 연합 주체 상한**

외부 파트너의 CI 시스템이 **Workload Identity Federation**으로 GCP에 연합돼 있다. 보안팀은 "이 연합 주체가 설령 실수로 넓은 역할을 바인딩받더라도, **오직 지정한 프로젝트의 리소스 범위 밖으로는 절대 접근할 수 없게** 상한을 강제하라"고 요구한다. 가장 적합한 것은?

- (A) 파트너 SA에 `roles/viewer`만 부여한다.
- (B) **Principal Access Boundary(PAB) 정책**으로 해당 연합 주체의 접근 가능 리소스 경계를 지정 프로젝트로 제한한다.
- (C) IAM Conditions에 `resource.name` 조건을 걸어 프로젝트를 제한한다.
- (D) VPC Service Controls 경계로 프로젝트를 감싼다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

"주체가 무엇을 바인딩받든 접근 범위의 **상한(ceiling)**을 강제한다" → **PAB**. PAB는 Allow 바인딩보다 우선하는 주체별 경계라, 실수로 넓은 역할이 붙어도 경계 밖은 무효가 된다. 특히 연합 신원의 폭주 제어가 대표 용도다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | Allow 바인딩은 언제든 넓어질 수 있음 — "설령 넓은 역할을 받아도" 요구를 못 지킴 |
| (C) | IAM Conditions는 **개별 바인딩**에 붙는 조건 — 다른 바인딩이 추가되면 그건 조건 없이 유효. 주체 전체 상한이 아님 |
| (D) | VPC-SC는 **데이터 exfiltration용 서비스 경계**(네트워크·API 레이어)이지 IAM 권한 상한이 아니다 |

PAB의 enforcement version 등 세부는 진화 중이므로 실제 적용 전 공식 문서로 현행 제약을 확인한다.

</div>
</details>

---

**Q11. EHR Healthcare 케이스 — 규제·감사 IAM**

EHR Healthcare가 HIPAA 준수를 위해 "**모든 리소스 접근이 감사 로깅되고, 로그를 관리·삭제하는 담당자와 일반 운영 담당자가 분리**되어야 한다"고 요구한다. 운영팀은 현재 전원 `roles/editor`를 갖고 있다. 가장 적합한 IAM 설계는?

- (A) 운영팀 전원에게 `roles/editor`를 유지하되 Cloud Audit Logs만 켠다.
- (B) 운영팀을 Predefined/Custom 최소 권한 역할로 낮추고, **로그 라우팅·삭제 권한을 별도 그룹으로 분리**해 일반 운영자와 겹치지 않게 한다.
- (C) 운영팀에게 `roles/logging.admin`을 추가로 부여해 로그를 직접 관리하게 한다.
- (D) Org Policy로 로그 삭제를 전역 비활성화한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

규제 케이스의 정답 골격은 **최소 권한 + 직무 분리**다. `editor`(Basic Role) 과잉 권한을 낮추고, "로그 관리 ≠ 로그 운영"을 서로 다른 그룹으로 갈라 흔적을 남기는 사람이 흔적을 못 지우게 한다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | `editor` 유지 = 과잉 권한 방치. 감사 로깅만으론 "권한 분리" 요구 미충족 |
| (C) | 운영자에게 로그 관리 권한을 더하면 **분리가 오히려 무너짐**(자기 흔적 삭제 가능) |
| (D) | 로그 삭제 전역 차단은 수명주기·비용 관리를 막는 과잉 조치 — 요구는 "담당자 분리"지 "전면 금지"가 아님 |

</div>
</details>

---

**Q12. TerramEarth 케이스 — 파트너 API 접근**

TerramEarth가 **500개 이상 딜러**의 애플리케이션에 차량 텔레메트리 API 접근을 열어야 한다. 보안팀은 "외부 파트너에게 **장수명 SA 키를 배포하지 말 것**, 딜러별 접근을 관리 가능하게 할 것"을 요구한다. 가장 적합한 접근은?

- (A) 딜러마다 SA를 만들고 키 파일을 발급해 전달한다.
- (B) 딜러 API는 **Apigee로 게이트**하고, 프로그래매틱 접근이 필요한 파트너 워크로드는 **Workload Identity Federation**으로 연합하며, 딜러를 **그룹으로 묶어** 권한을 부여한다.
- (C) `allAuthenticatedUsers`에게 `roles/bigquery.dataViewer`를 부여한다.
- (D) 딜러 전원을 Cloud Identity에 사용자로 생성하고 개별 IAM 바인딩을 부여한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

외부 파트너 접근의 정답 골격은 **API 게이트(Apigee) + 키리스 연합(WIF) + 그룹/상한**이다. 장수명 키 없이(WIF), 관리 가능하게(그룹·API 계층), 대량 외부 주체를 다룬다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | 장수명 SA 키를 외부에 배포 — 보안팀 요구 정면 위반 |
| (C) | `allAuthenticatedUsers`는 구글 계정 있는 **전 세계 누구나** — 딜러 한정이 아님, 심각한 노출 |
| (D) | 딜러 500+를 개별 계정·바인딩으로 관리하는 것은 확장 불가. 그룹/연합/API 계층이 정석 |

딜러별 세밀 제한이 더 필요하면 **IAM Conditions**나 연합 주체 상한(**PAB**)을 얹는다.

</div>
</details>

---

## 마무리

처음의 질문 — "Editor를 줬는데 왜 감사에서 걸리죠?" — 는 Basic Role의 과잉 권한을 모르는 데서 온다. IAM의 세 판단은 단순하다 — **역할은 Predefined 먼저, 상속은 누적이므로 최소한 높은 레벨에, 환경 제약은 Org Policy**.

<div class="callout-tip">
IAM 문제 = "누가(Principal) / 어디에(Resource 레벨) / 어떤 역할(Predefined·Custom)". 거기에 "환경 전체 제약(Org Policy)"과 "조건부 접근(Conditions)"이 더해진다.
</div>

시험 직전에 훑을 **함정 8쌍**:

| 혼동 쌍 | 핵심 구분선 |
|---------|------------|
| Basic vs Predefined vs Custom | Basic=금지 / Predefined=1순위 / Custom=정밀 제어 |
| IAM vs Org Policy | IAM=누가 / Org Policy=무엇을(환경 제약, Owner도 우회 불가) |
| 정책 상속 방향 | 상속은 누적 — 상위 역할은 하위에서 취소 불가 |
| SA 키 vs 키 없는 인증 | 키=유출 위험 / GCE SA 연결·WI=키 없는 메타데이터 서버 인증 |
| GKE Workload Identity vs WIF | GKE WI=GCP 내부 Pod 키리스 / WIF=GCP 외부·멀티클라우드 연합 |
| Workforce IF vs Workload IF | force=사람(콘솔 SSO) / load=기계(키리스 워크로드) |
| Org Policy vs IAM Deny vs PAB | Org Policy=리소스 동작 / Deny=주체의 특정 권한 거부 / PAB=주체 접근 범위 상한(셋 다 Allow보다 우선) |
| 최소 권한 vs 직무 분리 | 최소 권한=얼마나 / SoD=위험 조합을 한 주체에 안 모음(KMS admin≠encrypterDecrypter) |
| IAM Conditions vs Org Policy | Conditions=특정 Principal 조건부 접근 / Org Policy=환경 전체 제약 |
| GCE 기본 SA | 자동 생성 + `roles/editor`(조직 정책으로 차단되지 않은 한) — 프로덕션에서 반드시 최소 권한 SA로 교체 |

---

## 참고

- [[/cloud]] — Google PCA 준비 시리즈 인덱스
- [[/concept/cloud/03_vpc_for_pca]] — VPC (Shared VPC IAM 권한 모델 전제)
- Google Cloud, [*IAM overview*](https://cloud.google.com/iam/docs/overview) — Principal·Role·Policy 기본 모델
- Google Cloud, [*Understanding roles*](https://cloud.google.com/iam/docs/understanding-roles) — Basic·Predefined·Custom 역할 완전 목록
- Google Cloud, [*Resource hierarchy*](https://cloud.google.com/resource-manager/docs/cloud-platform-resource-hierarchy) — 조직·폴더·프로젝트 상속 모델
- Google Cloud, [*Service accounts*](https://cloud.google.com/iam/docs/service-account-overview) — 유형·키 관리·Best Practice
- Google Cloud, [*Org Policy overview*](https://cloud.google.com/resource-manager/docs/organization-policy/overview) — constraints 목록·Boolean·List 유형
- Google Cloud, [*IAM Conditions*](https://cloud.google.com/iam/docs/conditions-overview) — request.time·resource.name 속성
- Google Cloud, [*Workload Identity Federation*](https://cloud.google.com/iam/docs/workload-identity-federation) — 외부 IdP(AWS/Azure/OIDC) 기계 워크로드 키리스 연합
- Google Cloud, [*Workforce Identity Federation*](https://cloud.google.com/iam/docs/workforce-identity-federation) — 직원(사람)이 외부 IdP(Okta/Entra ID)로 콘솔·gcloud 로그인
- Google Cloud, [*GKE Workload Identity Federation for GKE*](https://cloud.google.com/kubernetes-engine/docs/concepts/workload-identity) — 클러스터 내 KSA↔GCP SA 매핑
- Google Cloud, [*Principal Access Boundary policies*](https://cloud.google.com/iam/docs/principal-access-boundary-policies) — 주체(연합 신원 포함) 접근 범위 상한, enforcement version
- Google Cloud, [*Deny policies*](https://cloud.google.com/iam/docs/deny-overview) — Principal+permission 단위 명시적 거부(Allow보다 우선)
- Google Cloud, [*Cloud KMS IAM roles*](https://cloud.google.com/kms/docs/reference/permissions-and-roles) — cloudkms.admin과 cryptoKeyEncrypterDecrypter 분리
