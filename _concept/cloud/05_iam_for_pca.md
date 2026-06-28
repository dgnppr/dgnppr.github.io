---
layout  : concept
title   : Google Cloud IAM 권한 모델 설계 결정
date    : 2026-06-28 00:00:00 +0900
updated : 2026-06-28 00:00:00 +0900
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

> "팀원 전체에게 Editor를 줬는데 왜 감사에서 걸리죠?" — 기본 역할(Basic Role)의 과잉 권한이 IAM 문제의 시작점이다. 이 글은 역할 3종 선택과 정책 상속이 PCA 시험 IAM 파트의 핵심임을 보이고, **"누가(Principal) 무엇을(Role) 어디서(Resource) 할 수 있는가"라는 의사결정 구조**로 모든 IAM 문제를 풀 수 있음을 보인다. 이 글은 PCA 준비 시리즈 4편이다.

---

## 도입 — IAM은 세 질문의 교차점

GCP의 모든 리소스 접근은 IAM이 결정한다. IAM 정책은 단순하다 — **"Principal이 Resource에 Role을 가진다"**. 그러나 그 단순함 안에 PCA가 파는 함정이 있다: 정책 상속은 누적이고 취소가 안 되며, 역할은 3종이 목적이 다르고, Org Policy는 IAM과는 다른 레이어에서 작동한다.

PCA 시험의 IAM 문제는 세 패턴이다 — ① 역할 유형 선택(Basic vs Predefined vs Custom), ② 계층 상속 트랩, ③ Org Policy vs IAM 구분. 각 패턴의 판단 기준을 손에 쥐는 것이 이 글의 목표다.

<div class="callout-note">
이 글의 지도: 기본 모델(Principal·Role·Policy) → 역할 3종 → 리소스 계층과 상속 → Service Account → Org Policy vs IAM → IAM Conditions → 시험 공략 → 퀴즈. 각 축은 "함정 → 판단 기준 → 결론"으로 닫는다.
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
GCE 기본 SA(Default Compute SA)는 생성 시 <code>roles/editor</code>를 자동으로 가진다. VM에 SA를 별도 지정하지 않으면 이 기본 SA가 쓰인다 — 즉, 모든 VM이 Editor 권한을 가지는 상태. <strong>프로덕션에서 반드시 최소 권한 SA로 교체</strong>해야 한다.
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
| VM·Pod에서 키 파일 없이 GCP API | **SA + 메타데이터 서버 / Workload Identity** |
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
| 영구 바인딩 vs 조건부 접근 | 조건 있으면=IAM Conditions |

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
| (D) | GCE 기본 SA는 `roles/editor` 자동 부여 — 과다 권한. 최소 권한 원칙 위반 |

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

## 마무리

처음의 질문 — "Editor를 줬는데 왜 감사에서 걸리죠?" — 는 Basic Role의 과잉 권한을 모르는 데서 온다. IAM의 세 판단은 단순하다 — **역할은 Predefined 먼저, 상속은 누적이므로 최소한 높은 레벨에, 환경 제약은 Org Policy**.

<div class="callout-tip">
IAM 문제 = "누가(Principal) / 어디에(Resource 레벨) / 어떤 역할(Predefined·Custom)". 거기에 "환경 전체 제약(Org Policy)"과 "조건부 접근(Conditions)"이 더해진다.
</div>

시험 직전에 훑을 **함정 6쌍**:

| 혼동 쌍 | 핵심 구분선 |
|---------|------------|
| Basic vs Predefined vs Custom | Basic=금지 / Predefined=1순위 / Custom=정밀 제어 |
| IAM vs Org Policy | IAM=누가 / Org Policy=무엇을(환경 제약, Owner도 우회 불가) |
| 정책 상속 방향 | 상속은 누적 — 상위 역할은 하위에서 취소 불가 |
| SA 키 vs 키 없는 인증 | 키=유출 위험 / GCE SA 연결·WI=키 없는 메타데이터 서버 인증 |
| IAM Conditions vs Org Policy | Conditions=특정 Principal 조건부 접근 / Org Policy=환경 전체 제약 |
| GCE 기본 SA | 자동 생성 + `roles/editor` — 프로덕션에서 반드시 최소 권한 SA로 교체 |

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
