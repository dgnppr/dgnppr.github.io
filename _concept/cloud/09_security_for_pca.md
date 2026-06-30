---
layout  : concept
title   : Google Cloud 보안 서비스 설계 결정
date    : 2026-06-30 00:00:00 +0900
updated : 2026-06-30 00:00:00 +0900
tag     : cloud gcp security kms vpcsc iap pca
toc     : true
comment : true
latex   : false
status  : complete
public  : true
parent  : [[/cloud]]
confidence     : high
valid_from     : 2026-06-30
relations:
  - { type: references, target: /concept/cloud/05_iam_for_pca }
---

* TOC
{:toc}

> "데이터는 이미 암호화되는데 왜 KMS를 또 쓰죠?", "IAM으로 권한을 막았는데 VPC-SC가 왜 필요하죠?" — PCA 보안 문제의 본질은 **레이어 구분**이다. 키를 누가 소유·통제하느냐(KMS), 비밀값을 어디에 두느냐(Secret Manager), 데이터가 경계 밖으로 나가는 것을 어떻게 막느냐(VPC-SC), 누가 어떤 맥락에서 앱에 접근하느냐(IAP), 그 모든 설정을 어떻게 한눈에 감시하느냐(SCC). 이 글은 IAM 권한 모델([[/concept/cloud/05_iam_for_pca]])과 **별개의 레이어**로 동작하는 GCP 보안 서비스들을 "요구사항 → 선택 기준 → 결론"으로 정리한다. PCA 준비 시리즈 9편이다.

---

## 도입 — 보안은 여러 레이어의 합

GCP 보안 문제에서 가장 많이 틀리는 이유는 한 레이어로 다른 레이어의 일을 하려 들기 때문이다. IAM은 "누가 권한을 가지는가"를 정하지만, 그 권한을 가진 자가 **탈취된 자격증명으로 외부에서** 호출하는 것은 막지 못한다. 그것은 VPC-SC의 일이다. 데이터는 기본적으로 암호화되지만, 그 암호화 키를 **고객이 통제**해야 하는 컴플라이언스 요구는 KMS의 일이다.

PCA 보안 파트는 다섯 축이다.

| 축 | 질문 | 서비스 |
|----|------|--------|
| 키 통제 | 암호화 키를 누가 소유·관리하는가 | **Cloud KMS** (CMEK / CSEK / EKM) |
| 비밀 관리 | API 키·패스워드를 어디에 안전하게 두는가 | **Secret Manager** |
| 데이터 유출 방지 | 데이터가 신뢰 경계 밖으로 나가는 것을 어떻게 막는가 | **VPC Service Controls** |
| 컨텍스트 접근 | 누가 어떤 맥락에서 앱에 접근하는가 (VPN 없이) | **Identity-Aware Proxy** |
| 가시성·탐지 | 잘못된 설정·위협을 어떻게 한눈에 보는가 | **Security Command Center** |

여기에 워크로드 무결성(Shielded VM), 환경 제약(Org Policy), 기본 암호화(at rest / in transit)가 보조로 붙는다.

<div class="callout-note">
이 글의 지도: 기본 암호화 → Cloud KMS(CMEK/CSEK/EKM) → Secret Manager → VPC-SC(+계층형 방화벽) → IAP(+Context-Aware Access) → SCC → 소프트웨어 공급망 보안 → Shielded VM·Org Policy → <strong>컴플라이언스 설계(규제 매핑·데이터 주권·Sensitive Data Protection·인증·감사)</strong> → 시험 공략 → 퀴즈. 각 축은 "요구사항 → 판단 기준 → 결론"으로 닫는다. IAM 역할·SA·리소스 계층은 <a href="#">05_iam_for_pca</a>에 있고 여기서는 중복 서술하지 않는다.
</div>

---

## 기본 암호화 — 아무것도 안 해도 암호화된다

먼저 출발점을 못 박는다. **GCP의 모든 데이터는 기본적으로 암호화된다.**

| 상태 | 기본 동작 |
|------|----------|
| **저장 데이터(at rest)** | 사용자가 아무 설정을 하지 않아도 AES-256 수준으로 자동 암호화. 키는 Google이 관리(Google-managed) |
| **전송 데이터(in transit)** | 사용자↔Google은 TLS. Google 데이터센터 내부 네트워크 구간도 암호화 |

즉 "데이터를 암호화하라"는 요구만으로는 **추가 작업이 필요 없다**. KMS가 필요해지는 순간은 다음과 같이 한 단계 더 들어갈 때다.

| 요구사항이 이렇게 강해지면 | 필요한 것 |
|---------------------------|-----------|
| "데이터를 암호화하라" | 기본값으로 충족 (Google-managed). 추가 작업 없음 |
| "**우리가 키를 관리·로테이션·폐기**할 수 있어야 한다" | **CMEK** (Cloud KMS) |
| "키 자체를 Google이 저장조차 하면 안 된다" | **CSEK** 또는 **Cloud EKM** |
| "키를 **Google 외부**의 우리 시스템에 둬야 한다(데이터 주권)" | **Cloud EKM** |

<div class="callout-warning">
시험 함정: "저장 데이터를 암호화하라"라는 단순 요구에 CMEK를 고르면 과잉 설계다. 기본 암호화로 충분하다. CMEK·CSEK·EKM은 <strong>"키 통제권을 고객이 가져야 한다"</strong>는 키워드가 나올 때 비로소 필요하다.
</div>

**결론**: 암호화 자체는 기본 제공. 차이를 만드는 것은 "키를 누가 소유·통제하는가"다.

---

## Cloud KMS — 키 통제권의 스펙트럼

### 봉투 암호화(Envelope Encryption) 모델

KMS를 이해하려면 봉투 암호화를 먼저 본다. 데이터는 **DEK(Data Encryption Key)**로 암호화되고, 그 DEK는 다시 **KEK(Key Encryption Key)**로 암호화된다.

```
평문 데이터 → [DEK로 암호화] → 암호문
DEK         → [KEK로 암호화] → 래핑된 DEK (암호문 옆에 저장)
KEK         → Cloud KMS 안에 존재 (밖으로 나오지 않음)
```

CMEK는 이 **KEK를 고객이 통제하는 KMS 키로 지정**하는 것이다. KEK는 KMS 밖으로 나오지 않으므로, 키를 비활성화하면 DEK를 풀 수 없고 → 데이터에 접근할 수 없게 된다. "키 폐기로 데이터를 즉시 접근 불가로 만들 수 있는가"라는 요구가 CMEK의 핵심 가치다.

### 키 계층 — Key Ring · Key · Key Version

```
프로젝트
  └── Key Ring (위치 고정, 예: asia-northeast3)
        └── Key (CryptoKey, 예: bigquery-key)
              └── Key Version (실제 키 머티리얼, v1·v2·v3 …)
```

| 요소 | 특징 |
|------|------|
| **Key Ring** | 키를 묶는 논리 그룹. **위치(location)는 생성 후 변경 불가**. 키 링·키는 한번 만들면 **삭제할 수 없다**(이름이 영구 점유됨) |
| **Key (CryptoKey)** | 로테이션·접근 정책의 단위. 목적(암호화/복호화, 서명 등) 지정 |
| **Key Version** | 실제 키 머티리얼. 로테이션하면 새 버전이 primary가 되고, 이전 버전은 복호화용으로 유지 |

<div class="callout-warning">
시험 함정: Key Ring과 Key는 <strong>삭제 불가</strong>다(이름이 영구 점유). 삭제할 수 있는 것은 Key <strong>Version</strong>이며, 그것도 즉시 삭제가 아니라 <strong>예약 폐기(scheduled for destruction)</strong> 상태로 들어가 일정 대기 기간 후 파기된다(대기 기간 동안 복구 가능). 따라서 "키를 잘못 만들었으니 지우자"는 시나리오는 성립하지 않는다 — 새 키를 만들고 IAM·로테이션으로 관리한다.
</div>

### 로테이션

대칭 키(symmetric encryption)는 **자동 로테이션 주기**를 설정할 수 있다(예: 90일마다). 로테이션이 일어나면 새 버전이 primary가 되어 이후 암호화는 새 버전으로, 기존 암호문 복호화는 해당 버전으로 처리된다. 비대칭 키(서명·비대칭 복호화)는 자동 로테이션을 지원하지 않아 수동 관리한다.

```bash
# 자동 로테이션 주기 설정 (대칭 키)
gcloud kms keys create bigquery-key \
  --location=asia-northeast3 \
  --keyring=data-keyring \
  --purpose=encryption \
  --rotation-period=90d \
  --next-rotation-time=2026-09-30T00:00:00Z
```

### 보호 수준(Protection Level) — 키가 어디서 보호되는가

| 보호 수준 | 키가 사는 곳 | 컴플라이언스 의미 |
|-----------|-------------|------------------|
| **SOFTWARE** | Google 인프라(소프트웨어) | 일반 CMEK 요구 |
| **HSM** (Cloud HSM) | Google이 운영하는 **FIPS 140-2 Level 3** 검증 하드웨어 보안 모듈 | "HSM 보호 키" 규제 요구 시 |
| **EXTERNAL / EXTERNAL_VPC** (Cloud EKM) | **Google 외부**의 서드파티 키 관리 시스템 | 데이터 주권, "키를 Google이 보관하면 안 됨" |

**결론**: CMEK = KMS에 둔 KEK를 고객이 관리. 키 링/키는 삭제 불가, 버전만 예약 폐기. 대칭 키만 자동 로테이션. HSM이 필요한지(FIPS Level 3), 외부 보관이 필요한지(EKM)는 규제 키워드로 판별.

### CMEK vs CSEK vs Google-managed — 책임 경계가 시험의 핵심

이 셋의 차이는 **"키를 누가 저장하고 누가 관리하느냐"의 책임 경계**다. PCA에서 가장 자주 혼동된다.

| 항목 | Google-managed | CMEK (Customer-Managed) | CSEK (Customer-Supplied) |
|------|---------------|-------------------------|--------------------------|
| 키 생성 | Google | **고객**(KMS에서 생성) | **고객**(외부에서 생성, raw key) |
| 키 저장 | Google | **Google KMS에 저장** | **Google이 저장 안 함**(작업 시 메모리에만) |
| 키 관리(로테이션·폐기·접근정책) | Google | **고객** | **고객**(전적으로) |
| 설정 난이도 | 없음(기본) | 중간(KMS 구성) | 높음(매 요청에 키 제공) |
| 키 분실 시 | 해당 없음 | KMS에서 복구·관리 | **데이터 영구 복구 불가** |
| 지원 범위 | 전 서비스 | 다수 서비스(BigQuery·GCS·Compute·Pub/Sub 등) | **제한적**(주로 Compute Engine 디스크·이미지, Cloud Storage) |

<div class="compare-grid">
<div class="compare-col" markdown="1">

**CMEK를 고르는 신호**

- "키 로테이션 정책을 우리가 정해야 한다"
- "특정 시점에 키를 비활성화해 데이터 접근을 막아야 한다"
- "키에 대한 IAM 접근을 감사해야 한다"
- 키 관리는 우리가, **운영은 Google KMS에 맡겨도 됨**

</div>
<div class="compare-col" markdown="1">

**CSEK를 고르는 신호**

- "키를 **Google이 저장조차** 하면 안 된다"
- 키 머티리얼을 우리가 매 요청에 직접 제공
- Google은 작업 중에만 메모리에서 사용, 디스크에 저장 안 함
- **키를 잃으면 데이터는 끝** — 책임 전적으로 고객

</div>
</div>

<div class="callout-warning">
시험 함정: CSEK는 <strong>모든 서비스가 지원하지 않는다</strong>. 주로 Compute Engine(영구 디스크·커스텀 이미지)과 Cloud Storage에서만 쓸 수 있다. "BigQuery 데이터를 CSEK로 암호화"는 함정 보기일 수 있다 — BigQuery는 CMEK를 쓴다. 또한 CSEK는 키 분실 시 <strong>Google이 복구를 도와줄 수 없다</strong>는 책임 경계가 핵심이다.
</div>

### Cloud EKM — 키를 Google 밖에 둔다

Cloud External Key Manager(EKM)는 키를 **Google 외부의 서드파티 키 관리 파트너 시스템**에 두고, GCP는 외부 키로 암호화/복호화를 호출만 한다. 키 머티리얼은 외부 시스템을 떠나지 않는다.

| 요구사항 | 답 |
|----------|-----|
| "키를 클라우드 제공자(Google) 밖에서 보유해야 한다(데이터 주권/규제)" | **Cloud EKM** |
| "키 접근에 외부 정당성(Key Access Justifications)을 검증하고 싶다" | EKM + Key Access Justifications |
| "FIPS 140-2 Level 3 HSM이면 충분하다(Google 운영)" | **Cloud HSM**(EKM 불필요) |

**결론(KMS 의사결정)**:

```
키 통제가 필요 없다 → Google-managed (기본)
키 관리를 우리가, 저장은 Google KMS여도 OK → CMEK
  └ HSM(FIPS L3) 규제 → CMEK + Cloud HSM 보호수준
Google이 키를 저장조차 하면 안 됨
  ├ GCE 디스크/GCS 한정, 키 직접 제공 → CSEK
  └ 외부 KMS에 키 보관(데이터 주권) → Cloud EKM
```

---

## Secret Manager — 비밀값의 단일 저장소

### 무엇을 푸는가

API 키, DB 패스워드, OAuth 클라이언트 시크릿, 인증서 같은 **비밀값**을 코드·환경변수·설정 파일에 하드코딩하지 않고 중앙에서 안전하게 저장·버전 관리·접근 제어하는 서비스다.

| 비밀값을 두는 곳 | 문제 |
|------------------|------|
| 코드에 하드코딩 | Git 히스토리에 영구 노출, 로테이션하려면 재배포 |
| 환경변수 / `.env` 파일 | 프로세스·이미지·로그에 노출, 접근 감사 불가 |
| **Secret Manager** | IAM 접근 제어, 버전 관리, 감사 로깅, 코드와 분리 |

### 구조 — 시크릿과 버전

```
Secret (예: db-password)
  ├── Version 1 (disabled)
  ├── Version 2 (enabled)
  └── Version 3 (enabled, "latest")
```

각 시크릿은 여러 **버전**을 가진다. 애플리케이션은 특정 버전 번호 또는 `latest`를 참조해 값을 읽는다. 로테이션 시 새 버전을 추가하고 이전 버전을 비활성화하면 롤백도 가능하다.

```bash
# 시크릿 생성 + 첫 버전 추가
echo -n "s3cr3t-p@ss" | gcloud secrets create db-password \
  --replication-policy=automatic \
  --data-file=-

# 새 버전 추가(로테이션)
echo -n "n3w-s3cr3t" | gcloud secrets versions add db-password --data-file=-

# 애플리케이션에서 최신 값 읽기
gcloud secrets versions access latest --secret=db-password
```

### 핵심 속성

| 속성 | 내용 |
|------|------|
| **IAM 통합** | `roles/secretmanager.secretAccessor`(읽기), `secretVersionManager`(버전 관리) 등으로 **시크릿 단위** 접근 제어 |
| **복제(Replication)** | `automatic`(Google이 다중 리전 자동) 또는 `user-managed`(허용 리전 직접 지정 — 데이터 거주 요구 시) |
| **CMEK 지원** | 시크릿 페이로드 암호화 키를 CMEK로 지정 가능 |
| **감사 로깅** | 누가 언제 어떤 시크릿에 접근했는지 Cloud Audit Logs에 기록 |
| **로테이션 알림** | 로테이션 주기를 설정하면 Pub/Sub로 알림 발송 — 단, **실제 값 교체 로직은 사용자 책임** |

<div class="callout-warning">
시험 함정: Secret Manager의 "로테이션"은 <strong>알림(Pub/Sub)까지만 자동</strong>이다. 새 시크릿 값을 만들어 버전으로 추가하는 동작은 사용자가 구현한다(예: Cloud Function). "Secret Manager가 패스워드를 자동으로 바꿔준다"는 보기는 정확하지 않다. 자동 비밀 교체까지 필요하면 해당 서비스의 내장 로테이션(예: 일부 DB의 관리형 자격증명)이나 커스텀 로직과 결합한다.
</div>

<div class="callout-warning">
KMS vs Secret Manager 혼동: <strong>KMS는 "키"를 다루고 키 머티리얼을 밖으로 내보내지 않는다</strong>(암호화/복호화 연산을 KMS가 수행). <strong>Secret Manager는 "비밀값 자체"를 저장하고 읽을 때 그 값을 돌려준다</strong>. "암호화 키 관리" → KMS, "API 키·패스워드 저장" → Secret Manager.
</div>

**결론**: 비밀값은 Secret Manager에 — 코드·환경변수 하드코딩을 대체한다. 접근은 IAM(secretAccessor)으로 시크릿 단위 제어, 버전으로 로테이션·롤백, 데이터 거주는 user-managed 복제로. 키(KEK)는 KMS, 비밀값은 Secret Manager.

---

## VPC Service Controls — 데이터 유출 경계

### 무엇을 푸는가 — IAM이 못 막는 것

IAM은 "권한이 있는가"를 확인하지만, **권한 있는 자격증명이 신뢰 경계 밖에서 쓰이는 것**은 막지 못한다. 다음 시나리오를 IAM만으로는 막을 수 없다.

- 직원의 SA 키가 유출되어 **외부 인터넷에서** BigQuery 데이터를 덤프
- 권한 있는 내부자가 회사 데이터를 **자신의 개인 GCS 버킷**으로 복사(exfiltration)
- 잘못 구성된 IAM으로 데이터가 외부 프로젝트로 새어 나감

VPC Service Controls(VPC-SC)는 GCP **관리형 서비스(BigQuery·GCS 등)의 API 데이터 평면 주위에 서비스 경계(perimeter)**를 둘러, 경계 밖으로의 데이터 이동을 차단한다.

### 작동 모델

```
┌─────────── Service Perimeter ───────────┐
│  Project A (BigQuery)   Project B (GCS)  │
│        ▲                      ▲          │
│        │ 경계 안 호출 허용     │          │
└────────┼──────────────────────┼──────────┘
         │ 경계 밖 호출 차단      ✗
   외부 인터넷 / 다른 프로젝트 (유효한 IAM이어도 차단)
```

<div class="callout-warning">
시험의 핵심 함정: <strong>VPC-SC는 IAM과 별개의 레이어</strong>다. IAM 권한이 완벽해도 요청이 경계 밖에서 오면 차단된다. 반대로 VPC-SC만으로는 권한 부여가 안 된다 — 둘 다 통과해야 접근된다. "IAM으로 막았으니 VPC-SC는 불필요"는 틀렸다. IAM=권한, VPC-SC=경계(데이터 유출 방지).
</div>

<div class="callout-warning">
또 다른 혼동: <strong>VPC-SC ≠ 방화벽(Firewall)</strong>. 방화벽은 L3/L4 네트워크 트래픽(VM 간 통신)을 제어한다. VPC-SC는 <strong>관리형 서비스 API(데이터 평면)</strong> 접근을 제어한다. "GCS·BigQuery로의 데이터 유출을 막아라" → VPC-SC, "VM 간 포트를 막아라" → 방화벽.
</div>

### 계층형 방화벽 정책 — 조직·폴더에서 내리꽂는 방화벽

방화벽이 L3/L4를 제어한다는 점은 위 callout에서 정리했다. 그런데 방화벽 규칙을 **프로젝트마다 따로 관리**하면, 어떤 팀이 실수로 `0.0.0.0/0` SSH를 열어도 조직 차원에서 막을 방법이 없다. **계층형 방화벽 정책(Hierarchical Firewall Policy)**은 이 강제력을 **조직·폴더 레벨**로 끌어올린다.

```
Organization  ── 방화벽 정책(예: 모든 인바운드 SSH 22 deny) ──┐ 먼저 평가
  └── Folder   ── 방화벽 정책(예: 사내 IP 대역만 allow) ──────┤
        └── Project (VPC 방화벽 규칙 / 네트워크 방화벽 정책) ──┘ 마지막 평가
```

평가는 **위에서 아래로** 진행되고, 상위에서 `allow`/`deny`로 결정나면 거기서 끝난다. 상위 정책은 하위가 덮어쓸 수 없다 — 조직 baseline을 **하위 프로젝트가 무력화하지 못하게** 강제하는 것이 핵심 가치다.

| 액션 | 효과 |
|------|------|
| `allow` / `deny` | 이 레벨에서 트래픽을 즉시 허용/차단하고 평가 종료 |
| **`goto_next`** | 이 규칙은 판단을 내리지 않고 **다음(하위) 레벨로 평가를 위임** — "조직은 큰 틀만 정하고 세부는 폴더/프로젝트에 맡긴다"는 위임 패턴 |

<div class="callout-warning">
시험 함정: 계층형 방화벽은 <strong>VPC 방화벽 규칙보다 먼저</strong> 평가되며 상위가 우선한다. "프로젝트 관리자가 무엇을 열어도 조직 차원에서 특정 포트를 막아라"는 요구는 프로젝트 VPC 방화벽이 아니라 <strong>조직/폴더 계층형 방화벽 정책</strong>이다. <code>goto_next</code>는 "막지도 열지도 않고 하위로 넘긴다"는 의미임을 기억한다. 이것은 데이터 평면을 다루는 VPC-SC와는 또 다른, L3/L4 네트워크 레이어의 <strong>상위 강제</strong> 장치다.
</div>

### 구성 요소

| 요소 | 역할 |
|------|------|
| **Service Perimeter** | 보호할 프로젝트·서비스의 집합. 경계 안 리소스끼리는 자유롭게 통신, 밖과는 차단 |
| **Access Level** (Access Context Manager) | 경계 접근을 허용할 **조건**(IP 범위, 기기 정책, 사용자 신원, 지역) |
| **Ingress 규칙** | 경계 **밖→안** 접근을 선별 허용(어떤 source가 어떤 서비스/메서드에) |
| **Egress 규칙** | 경계 **안→밖** 접근을 선별 허용(예: 협력사 프로젝트로의 통제된 반출) |
| **Dry-run 모드** | 실제 차단 없이 위반을 로그로만 — 운영 적용 전 영향 분석 |

```
요구: "데이터 분석가는 회사 VPN(특정 IP 대역)에서만 BigQuery에 접근, 그 외 차단"
→ Service Perimeter(BigQuery 포함) + Access Level(허용 IP 대역)
→ Access Level을 만족하는 요청만 경계 진입 허용
```

### 언제 도입하나

| 상황 | VPC-SC 도입 여부 |
|------|------------------|
| 규제 데이터(PII, 의료, 금융)를 다루고 유출 방지가 컴플라이언스 요구 | **도입** |
| "자격증명이 유출돼도 외부에서 데이터를 못 빼가게" | **도입** |
| 내부자의 무단 데이터 반출 차단 | **도입** |
| 소규모·단일 프로젝트, 외부 노출 없음 | 보통 불필요(운영 복잡성↑) |

<div class="callout-note">
도입 팁: VPC-SC는 잘못 구성하면 정상 워크로드까지 차단해 장애를 낸다. 항상 <strong>dry-run 모드</strong>로 먼저 위반을 관찰하고 ingress/egress 규칙을 다듬은 뒤 enforce로 전환하는 것이 권장 패턴이다.
</div>

**결론**: VPC-SC = 관리형 서비스 데이터 평면 주위의 경계로 **데이터 유출(exfiltration) 방지**. IAM·방화벽과 다른 레이어. Access Level로 접근 조건, ingress/egress로 통제된 교차 접근. 규제 데이터·자격증명 유출 대비가 키워드.

---

## Identity-Aware Proxy — VPN 없는 컨텍스트 접근

### 무엇을 푸는가 — 제로 트러스트(BeyondCorp)

전통적 모델은 "네트워크 안에 있으면 신뢰"(VPN)다. 문제는 VPN에 한번 들어오면 내부 전체에 노출되고, 기기 상태·사용자 맥락을 따지지 않는다는 것이다.

IAP는 Google의 **제로 트러스트** 모델(개념어 **BeyondCorp**)을 구현한다 — **네트워크 위치가 아니라 사용자 신원 + 컨텍스트(기기, IP, 시간)**로 매 요청을 인가한다. VPN 없이 인터넷 어디서든, 그러나 정책을 만족할 때만 애플리케이션·VM에 접근한다.

<div class="callout-note">
제품명 정리: 과거 "BeyondCorp Enterprise"로 불리던 제로 트러스트 접근 제품군은 <strong>Chrome Enterprise Premium</strong>으로 리브랜딩됐다. <strong>BeyondCorp는 여전히 유효한 개념어</strong>(Google이 사내에 적용한 제로 트러스트 아키텍처)이지만, 현행 제품을 가리킬 때는 Chrome Enterprise Premium이라고 부른다. IAP·Context-Aware Access는 이 제품군이 제공하는 접근 제어 메커니즘이다.
</div>

```
사용자 → [IAP: 신원 + 컨텍스트 검증] → 애플리케이션 / VM
              (IAM: roles/iap.*)
         조건 불충족 → 차단 (네트워크 안에 있어도)
```

### 두 가지 사용 형태

| 형태 | 대상 | 동작 |
|------|------|------|
| **IAP for Web (HTTPS)** | App Engine, Cloud Run, GKE/GCE 뒤의 웹 앱 | **HTTPS 부하 분산기(L7) 앞단**에서 인증. `roles/iap.httpsResourceAccessor` 보유자만 통과 |
| **IAP TCP forwarding** | VM의 SSH/RDP | **외부 IP 없는 VM**에 SSH/RDP. `roles/iap.tunnelResourceAccessor` |

### 핵심 포인트

<div class="callout-warning">
시험 함정: IAP for Web은 <strong>L7(HTTPS 부하 분산기) 앞단</strong>에서 동작한다. 즉 웹 앱에 IAP를 적용하려면 외부 HTTPS LB가 전제다. 또한 백엔드는 IAP가 우회되는 것을 막기 위해 IAP가 추가한 <strong>서명된 JWT 헤더(<code>X-Goog-IAP-JWT-Assertion</code>)를 검증</strong>해야 한다. 검증을 안 하면 LB를 우회한 직접 호출에 취약하다.
</div>

| 요구사항 | 답 |
|----------|-----|
| "VPN 없이 내부 웹 앱을 안전하게 외부에서 접근" | **IAP for Web** |
| "외부 IP 없는 VM에 SSH 하고 싶다(점프 호스트·VPN 없이)" | **IAP TCP forwarding** |
| "회사 관리 기기에서만, 특정 지역에서만 접근 허용" | IAP + **Access Context Manager**(Access Level) |
| "L3/L4 네트워크 트래픽 자체 차단" | 방화벽(IAP 아님) |

IAP는 Access Context Manager의 Access Level과 결합해 "기기 정책·IP·지역" 같은 컨텍스트 조건을 더한다(VPC-SC와 같은 Access Level 인프라를 공유).

### Context-Aware Access — 콘솔·API까지 컨텍스트 조건

IAP가 **앱 앞단(L7)**에서 인증을 거는 것이라면, **Context-Aware Access(컨텍스트 인식 액세스)**는 같은 컨텍스트 조건을 **Google Cloud 콘솔·API·SaaS 앱 접근**으로까지 넓힌 정책 모델이다. 기기 상태(회사 관리 기기 여부·암호화·OS 버전), 출발지 IP, 지역 같은 신호를 **Access Context Manager의 Access Level**로 정의하고, 그 레벨을 만족하지 않는 요청은 신원이 유효해도 막는다.

| 정의 위치 | 무엇을 거나 |
|-----------|------------|
| **Access Level** (Access Context Manager) | 허용 조건의 단위 — IP 범위, 기기 정책, 지역, 시간. VPC-SC·IAP·Context-Aware Access가 **공유** |
| **IAP** | 위 조건을 **개별 앱/VM 앞단(L7)**에서 강제 — 앱 접근의 게이트 |
| **Context-Aware Access** | 위 조건을 **콘솔·API·앱 접근 전반**에 적용 — Chrome Enterprise Premium 제품군이 제공 |

<div class="callout-warning">
시험 함정: IAP와 Context-Aware Access를 구분한다. <strong>"웹 앱 앞단에서 신원으로 인증"은 IAP</strong>, <strong>"회사 관리 기기·특정 위치에서만 콘솔·API·앱에 접근 허용"은 Context-Aware Access</strong>다. 둘 다 같은 Access Level을 쓰지만, IAP는 L7 앱 게이트, Context-Aware Access는 접근 정책 전반을 가리킨다. 현행 제품명은 BeyondCorp Enterprise가 아니라 <strong>Chrome Enterprise Premium</strong>임도 기억한다.
</div>

| 요구사항 | 답 |
|----------|-----|
| "회사 관리 기기에서만, 특정 지역에서만 Cloud Console·API 접근 허용" | **Context-Aware Access** + Access Level |
| "VPN 없이 내부 웹 앱을 신원 기반으로 접근" | **IAP for Web** |
| "기기·위치 조건은 어디에 정의하나" | **Access Context Manager(Access Level)** — IAP·VPC-SC와 공유 |

**결론**: IAP = 네트워크가 아닌 신원+컨텍스트 기반 접근(제로 트러스트 = BeyondCorp). 웹은 HTTPS LB 앞 L7, VM은 TCP forwarding으로 외부 IP·VPN 제거, 백엔드는 JWT 헤더 검증 필수. 같은 컨텍스트 조건을 콘솔·API까지 넓히면 **Context-Aware Access**(Chrome Enterprise Premium), 조건의 정의는 **Access Level**에 둔다.

---

## Security Command Center — 보안 가시성과 탐지

### 무엇을 푸는가

개별 서비스 설정을 일일이 점검하는 대신, **조직 전체의 자산 인벤토리·잘못된 설정·취약점·위협을 단일 콘솔**에서 보는 보안 관제 플랫폼이다.

| 기능 영역 | 내용 |
|-----------|------|
| **자산 인벤토리** | 조직 내 모든 리소스(프로젝트·VM·버킷 등) 발견·추적 |
| **취약점 탐지** | 잘못된 설정(공개 버킷, 과도한 방화벽 등), 웹 앱 취약점 스캔 |
| **위협 탐지** | 비정상 행위·악성 활동 실시간 탐지(상위 티어) |
| **컴플라이언스** | CIS·PCI DSS 등 표준 대비 준수 현황 리포트(상위 티어) |

### 티어 차이 — 시험 단골

| 항목 | Standard | Premium | Enterprise |
|------|----------|---------|------------|
| 비용 | 무료 | 유료 | 유료(상위) |
| 자산 인벤토리·검색 | O | O | O |
| Security Health Analytics(설정 오류 스캔) | 일부(기본) | **전체** | 전체 |
| Web Security Scanner | 제한적 | 전체(관리형 스캔) | 전체 |
| **Event Threat Detection**(로그 기반 위협) | X | **O** | O |
| **Container/VM Threat Detection** | X | **O** | O |
| 컴플라이언스 리포트(CIS/PCI 등) | X | **O** | O |
| 공격 경로 시뮬레이션 | X | O | O |
| **멀티클라우드(AWS·Azure)·SIEM/SOAR** | X | X | **O** |

<div class="callout-warning">
시험 함정 정리: <strong>위협 탐지(Event/Container/VM Threat Detection)와 컴플라이언스 리포트는 Premium 이상</strong>이다. Standard는 무료지만 자산 인벤토리와 기본 설정 점검 중심이다. "실시간 위협 탐지·CIS 컴플라이언스 대시보드가 필요하다" → 최소 <strong>Premium</strong>. "AWS·Azure까지 포함한 멀티클라우드 + SIEM/SOAR 통합" → <strong>Enterprise</strong>.
</div>

| 요구사항 | 티어 |
|----------|------|
| 조직 자산 파악 + 기본 설정 오류만 무료로 | **Standard** |
| 위협 탐지 + CIS/PCI 컴플라이언스 + 단일 클라우드(GCP) | **Premium** |
| 멀티클라우드 + 보안 운영(SIEM/SOAR) 통합 | **Enterprise** |

**결론**: SCC = 보안 가시성의 단일 창. 위협 탐지·컴플라이언스는 Premium, 멀티클라우드·SecOps는 Enterprise, 인벤토리·기본 점검은 Standard(무료).

---

## 소프트웨어 공급망 보안 — 검증된 이미지만 배포

지금까지의 서비스가 "실행 중인 자산"을 지켰다면, **공급망 보안은 그 자산이 어떻게 만들어져 배포되는가**를 지킨다. 컨테이너 이미지에 누군가 악성 코드를 심거나, 서명되지 않은 이미지가 프로덕션에 올라가거나, 취약한 OSS 의존성이 섞여 들어오는 것을 막는 레이어다.

### Binary Authorization — 신뢰된 이미지만 배포 허용

**Binary Authorization**은 배포 시점(deploy-time) 통제다. **GKE·Cloud Run**에 배포되는 컨테이너 이미지가 정책에서 요구하는 **서명(attestation)을 갖췄는지** 검증하고, 통과한 이미지만 실행을 허용한다.

```
이미지 빌드 → 취약점 스캔 통과 → [서명자가 attestation 서명]
배포 요청 → Binary Authorization 정책 검사
  ├─ 요구된 attestation 있음 → 배포 허용
  └─ 서명 없음/위조 → 배포 차단 (deny)
```

| 구성 요소 | 역할 |
|-----------|------|
| **Policy** | "어떤 attestor의 서명을 요구할지" 정의. 위반 시 차단(enforce) 또는 로그만(dry-run) |
| **Attestor** | 이미지가 특정 검사(예: 취약점 스캔 통과, CI 빌드)를 거쳤음을 보증하는 서명자 |
| **Attestation** | 특정 이미지 다이제스트에 대한 서명된 보증서 |

<div class="callout-warning">
시험 신호어: <strong>"검증된/신뢰된 이미지만 배포"</strong>, <strong>"공급망 무결성"</strong>, "서명되지 않은 컨테이너의 프로덕션 배포 차단" → <strong>Binary Authorization</strong>. 이미지 다이제스트(태그가 아닌 불변 해시)로 정책을 강제한다.
</div>

### Artifact Analysis — 취약점 스캔

**Artifact Analysis**(구 Container Analysis)는 **Artifact Registry**에 올라온 컨테이너 이미지·언어 패키지를 스캔해 알려진 취약점(CVE)을 찾는다. 푸시 시 자동 스캔(on-push)과, 이미 등록된 이미지에 대한 지속 분석(continuous analysis)을 제공한다. 이 스캔 결과를 Binary Authorization의 attestation 조건으로 연결하면 "취약점 있으면 배포 불가" 파이프라인이 된다.

### SLSA · Assured OSS — 프레임워크와 큐레이션된 OSS

| 항목 | 무엇인가 |
|------|---------|
| **SLSA** (Supply-chain Levels for Software Artifacts) | 빌드·출처(provenance) 무결성을 단계(Level)로 정의한 **업계 프레임워크**. "빌드가 변조되지 않았고 출처가 검증됐는가"를 등급화. 특정 GCP 제품이 아니라 지향점이며, Cloud Build·Binary Authorization으로 단계를 충족해 간다 |
| **Assured OSS** (Assured Open Source Software) | Google이 자사 파이프라인에서 **스캔·검증·서명한 OSS 패키지**(Java·Python 등)를 그대로 제공. 외부에서 받은 의존성의 공급망 위험을 줄인다 |

<div class="callout-note">
공급망 보안 요약: <strong>"무엇을 배포할지 게이트"는 Binary Authorization</strong>, <strong>"이미지에 취약점이 있나"는 Artifact Analysis</strong>, <strong>"무결성 등급 기준"은 SLSA</strong>, <strong>"검증된 OSS 의존성"은 Assured OSS</strong>. 이들은 데이터 평면(VPC-SC)이나 실행 무결성(Shielded VM)과 다른, <strong>빌드→배포 경로의 무결성</strong> 레이어다.
</div>

**결론**: 공급망 보안 = "배포되는 코드를 신뢰할 수 있는가". Binary Authorization으로 서명된 이미지만 GKE/Cloud Run에 올리고, Artifact Analysis로 취약점을 걸러 그 결과를 attestation으로 연결하며, SLSA를 목표 등급으로 삼고, Assured OSS로 의존성 위험을 낮춘다.

---

## 보조 서비스 — Shielded VM · Org Policy · 전송 보안

### Shielded VM — 부팅·런타임 무결성

Shielded VM은 부팅 단계 공격(루트킷·부트킷)으로부터 VM 무결성을 보호한다.

| 구성 요소 | 역할 |
|-----------|------|
| **Secure Boot** | 서명된 부팅 컴포넌트만 실행 허용 |
| **vTPM** (가상 TPM) | 부팅 측정값 저장, 키·무결성 검증 |
| **Integrity Monitoring** | 기준 대비 부팅 상태 변경을 탐지·경보 |

> 참고로 **Confidential VM**은 다른 개념이다 — 사용 중(in-use) 메모리까지 암호화(AMD SEV 등)해 "처리 중 데이터" 기밀성을 보호한다. "부팅 무결성" → Shielded VM, "메모리(사용 중) 암호화" → Confidential VM.

### Organization Policy — 보안 관점 제약

Org Policy 자체는 [[/concept/cloud/05_iam_for_pca]]에서 다뤘다(IAM과 다른 레이어, 환경 제약). 보안 설계에서 자주 쓰이는 보안 관련 constraint만 짚는다.

| Constraint | 효과 |
|-----------|------|
| `gcp.restrictNonCmekServices` | 특정 서비스에서 **CMEK 사용 강제**(기본 키 금지) |
| `gcp.restrictCmekCryptoKeyProjects` | CMEK 키를 허용된 프로젝트의 것만 사용 |
| `compute.requireShieldedVm` | 모든 VM을 **Shielded VM으로 강제** |
| `compute.vmExternalIpAccess` | VM 외부 IP 할당 제한(공격 표면 축소) |
| `iam.allowedPolicyMemberDomains` | IAM 바인딩 허용 도메인 제한(외부 계정 차단) |
| `gcp.resourceLocations` | 리소스 생성 리전 제한(데이터 거주) |

### 전송 보안

- 사용자↔Google API: 기본 TLS.
- 인터넷 노출 앱: HTTPS 부하 분산기 + Google-managed SSL 인증서 또는 Certificate Manager.
- L7 위협(SQLi·XSS·DDoS): **Cloud Armor**(WAF·보안 정책).

**결론**: Shielded VM=부팅 무결성(메모리 암호화는 Confidential VM). Org Policy로 CMEK·Shielded VM 강제 등 보안 baseline을 환경 수준에서 못 박는다.

---

## 컴플라이언스 설계 — 규제에서 통제로

앞 절들이 "어떤 위협을 어느 레이어로 막는가"였다면, 컴플라이언스는 거꾸로 **"이 규제가 요구하는 통제를 어떤 GCP 기능으로 만족시키는가"**다. 시험에서 컴플라이언스 문제는 거의 항상 **규제 이름 → 통제 → 서비스** 매핑으로 나온다. 보안 서비스들을 다시 끌어오되, 이번엔 규제 요구가 출발점이다.

### 법규·규제 매핑 — 규제는 통제 목표로 온다

규제는 직접 "BigQuery를 써라"라고 말하지 않는다. **접근 통제·암호화·감사·데이터 거주·유출 방지** 같은 통제 목표를 요구하고, 우리가 그것을 GCP 서비스로 번역한다.

| 규제 | 무엇을 다루나 | 핵심 요구 | 대응 GCP 통제 |
|------|---------------|-----------|---------------|
| **HIPAA** | 미국 의료정보(PHI) | 접근 통제·암호화·감사·최소 권한 | BAA 체결 + IAM 최소권한 + CMEK + **VPC-SC**(유출 방지) + Cloud Audit Logs |
| **GDPR** | EU 개인정보·프라이버시 | 데이터 거주·삭제권·처리 최소화 | `resourceLocations`(EU 리전 고정) + **Sensitive Data Protection**(PII 식별·de-id) + 감사 로그 |
| **COPPA** | 미국 아동(13세 미만) 정보 | 아동 데이터 수집·취급 제한 | Sensitive Data Protection으로 식별·마스킹 + 접근 통제·감사 |
| **PCI DSS** | 신용카드(결제) 정보 | 카드번호 격리·암호화·접근 추적 | Sensitive Data Protection(카드번호 탐지·토큰화) + VPC-SC + CMEK + 감사 |
| **데이터 소유권/거주** | 데이터가 어느 관할에 있나 | 특정 국가·리전 내 보관 | `resourceLocations` + **Assured Workloads** + Cloud **EKM** |

<div class="callout-warning">
시험 함정: 규제 이름만 보고 단일 서비스를 고르면 틀린다. 컴플라이언스는 거의 항상 <strong>여러 레이어의 조합</strong>이다(예: HIPAA = 권한 + 암호화 + 경계 + 감사). 또한 GCP가 HIPAA·PCI 같은 규제를 "지원한다"는 것은 <strong>고객이 통제를 올바로 구성했을 때</strong> 성립한다 — 클라우드가 자동으로 준수해 주지 않는다(공동 책임 모델, 아래).
</div>

### 데이터 주권과 거주 — 데이터를 어디에 둘 것인가

**데이터 거주(residency)**는 "데이터가 물리적으로 어느 리전에 저장되는가", **데이터 주권(sovereignty)**은 한발 더 나아가 "그 데이터에 대한 통제권(키·접근)이 특정 관할 밖으로 나가지 않는가"다.

| 요구 강도 | 통제 |
|-----------|------|
| "데이터를 특정 리전에만 저장" | Org Policy `gcp.resourceLocations`로 리소스 생성 리전 제한 |
| "암호화 키를 클라우드 밖 우리 시스템에 둬 주권 강화" | **Cloud EKM**(키가 Google 밖, 위 KMS 절 참조) |
| "데이터 거주 + 운영진 접근 제한 + 규제 패키지를 한 번에" | **Assured Workloads** |

**Assured Workloads**는 데이터 거주, 지원 인력의 접근 위치 제한, 규제별(예: FedRAMP, 특정 EU 요건) 통제를 **폴더 단위로 강제·검증**해 주는 제품이다. "리전 고정 + 인력 접근 통제 + 규제 준수 환경을 묶어서" 요구하면 개별 Org Policy 나열이 아니라 Assured Workloads가 답이다.

<div class="callout-note">
구분: <strong>거주는 "어디 저장하나"(resourceLocations)</strong>, <strong>주권은 "통제권이 누구에게"(EKM·인력 접근 제한)</strong>, <strong>Assured Workloads는 둘을 규제 패키지로 묶은 강제 장치</strong>. 단순 리전 고정은 Org Policy 하나로 충분하고, Assured Workloads는 그보다 무거운 규제 환경에 쓴다.
</div>

### 상업적 민감정보 — Sensitive Data Protection

신용카드번호·주민번호·이메일 같은 **PII/민감정보**가 데이터셋 어디에 흩어져 있는지조차 모르는 것이 현실의 출발점이다. **Sensitive Data Protection**(구 Cloud DLP)은 이 데이터를 **탐지·분류·비식별(de-identify)**한다.

| 단계 | 무엇을 하나 |
|------|-------------|
| **탐지(inspect)** | 150종 이상의 infoType 탐지기로 카드번호·주민번호·이메일·전화 등을 스캔. BigQuery·GCS·데이터스트림 대상 |
| **분류** | 어떤 컬럼·파일에 어떤 민감 유형이 얼마나 있는지 프로파일링 |
| **비식별(de-identify)** | 발견한 값을 **마스킹·토큰화·redaction·날짜 이동·버킷화**로 가린다 |

비식별 기법의 핵심 차이:

| 기법 | 동작 | 가역성 |
|------|------|--------|
| **마스킹(masking)** | `4111-****-****-1111`처럼 일부를 가림 | 비가역(원복 불가) |
| **토큰화(tokenization, 형식보존 암호화)** | 값을 토큰으로 치환, 형식은 유지 | **가역**(키로 원복 가능 — 결제 후 재대조 등) |
| **redaction** | 값을 통째로 제거 | 비가역 |

<div class="callout-warning">
시험 신호어: <strong>"민감정보가 어디 있는지 찾아 분류"</strong>, <strong>"PII를 마스킹/토큰화"</strong>, "분석은 하되 원본 카드번호는 노출하지 않기" → <strong>Sensitive Data Protection(구 Cloud DLP)</strong>. KMS(키)·Secret Manager(비밀값)와 혼동하지 않는다 — 이건 <strong>데이터 안의 민감 패턴</strong>을 다룬다. "원복이 필요하면 토큰화, 영구 가림이면 마스킹/redaction"으로 기법을 가른다.
</div>

### 산업 인증과 공동 책임 모델

GCP는 **SOC 2 / SOC 1·3, ISO 27001(및 27017·27018), FedRAMP, PCI DSS, HIPAA** 등 다수의 인증·증명을 보유한다(증빙은 Compliance Reports Manager에서 받는다). 하지만 인증은 **"인프라 계층"에 대한 것**이고, 그 위에 올린 워크로드의 설정·데이터·접근은 고객 몫이다.

```
공동 책임(Shared Responsibility)
  Google 책임 ──  물리 보안, 하드웨어, 하이퍼바이저, 기반 서비스의 인증
  ───────────────────────────────────────────────────────
  고객 책임  ──  IAM 구성, 암호화 키 선택(CMEK), VPC-SC 경계,
                 데이터 분류·de-id, 감사 로그 활성화, OS·앱 패치
```

<div class="callout-warning">
시험 함정: "GCP가 ISO 27001 인증이 있으니 우리 서비스도 자동으로 준수된다"는 <strong>틀린 명제</strong>다. 인증은 클라우드 기반 계층을 보증할 뿐, 고객이 IAM·암호화·경계·감사를 올바로 구성해야 워크로드가 준수된다. "누구의 책임인가" 문제는 거의 항상 <strong>설정·데이터·접근 = 고객</strong>이다.
</div>

### 감사 — Cloud Audit Logs와 Access Transparency

컴플라이언스의 마지막 축은 **"누가 언제 무엇을 했는가를 증명"**하는 감사다.

#### Cloud Audit Logs 4종

| 로그 종류 | 무엇을 기록 | 기본 활성/비용 |
|-----------|-------------|----------------|
| **Admin Activity** | 리소스 생성·변경·IAM 정책 변경 등 관리 작업 | 항상 켜짐·무료, 끌 수 없음 |
| **Data Access** | 데이터 읽기/쓰기 등 데이터 평면 접근 | **기본 꺼짐**(BigQuery 등 일부 예외)·활성화 시 과금 가능 |
| **System Event** | Google 시스템이 자동 수행한 작업(예: 자동 마이그레이션) | 항상 켜짐·무료 |
| **Policy Denied** | 보안 정책 위반으로 **거부된** 접근(예: VPC-SC 차단) | 자동 기록·무료 |

<div class="callout-warning">
시험 단골: <strong>Data Access 로그만 기본 비활성</strong>이며 명시적으로 켜야 한다(BigQuery 데이터 접근은 예외적으로 기록됨). "민감 데이터셋에 누가 접근했는지 추적하라"는 요구는 <strong>Data Access 감사 로그 활성화</strong>다 — 켜지 않으면 기록이 없다. 나머지 3종은 항상 켜져 있고 끌 수 없다.
</div>

#### 보존과 내보내기

기본 보존 기간은 로그 종류·버킷 설정에 따라 다르며(Admin Activity는 비교적 길게, Data Access는 짧게 보관되는 경향), 규제가 **장기 보존**을 요구하면 **로그 싱크(sink)**로 내보낸다.

| 목적지 | 용도 |
|--------|------|
| **Cloud Storage** | 장기·저비용 보존(컴플라이언스 아카이브), 버킷 잠금으로 변조 방지 |
| **BigQuery** | 감사 로그에 대한 SQL 분석·리포트 |
| **Pub/Sub** | 외부 SIEM·실시간 처리로 스트리밍 |

#### Access Transparency

**Cloud Audit Logs가 "고객(우리)의 행위"를 기록**한다면, **Access Transparency는 "Google 지원 인력이 우리 콘텐츠에 접근한 행위"**를 기록한다. 둘은 주체가 다르다.

<div class="callout-note">
구분: <strong>"우리 직원·서비스가 무엇을 했나" → Cloud Audit Logs</strong>, <strong>"Google 측이 우리 데이터에 접근했나" → Access Transparency</strong>. 더 나아가 그런 Google 접근을 <strong>사전 승인</strong>받게 하려면 <strong>Access Approval</strong>을 함께 쓴다. 데이터 주권·규제 환경에서 "클라우드 운영자의 접근까지 가시화·통제"하라는 요구의 답이다.
</div>

**결론(컴플라이언스)**: 규제는 통제 목표를 주고, 우리가 서비스로 번역한다 — 거주는 `resourceLocations`/Assured Workloads, 주권은 EKM, 민감정보는 Sensitive Data Protection(탐지·de-id), 증명은 Cloud Audit Logs(특히 Data Access는 직접 켠다)·로그 싱크·Access Transparency. 인증은 인프라 계층 보증일 뿐, 설정·데이터·접근은 공동 책임의 고객 몫이다.

---

## 온톨로지 접점 — 데이터 거버넌스 그래프

이 보안 서비스들은 데이터 거버넌스 온톨로지에서 다음 관계로 연결된다.

- **Key**(KMS 키) —`protects`→ **Dataset/Bucket/Disk**(데이터 자산): CMEK 키와 보호 대상의 관계는 "키 폐기 → 자산 접근 불가"라는 행위 가능성을 표현한다.
- **Secret** —`grants_access_to`→ **Service**(외부 시스템): 비밀값은 어떤 시스템에 대한 접근 자격을 나타내는 엔티티다.
- **Service Perimeter** —`encloses`→ **Project/Service**: 경계는 데이터 자산들을 묶는 신뢰 영역 노드.
- **Access Level** —`conditions`→ **(VPC-SC 경계, IAP 리소스)**: 동일한 조건 엔티티가 두 서비스에 재사용된다(Access Context Manager 공유).

컴플라이언스 축을 더하면 그래프가 확장된다.

- **Regulation**(HIPAA·GDPR·PCI DSS 등) —`requires`→ **Control**(암호화·경계·감사·de-id): 규제 노드가 통제 목표를 요구하고, 통제는 다시 위 서비스 노드로 `satisfied_by` 연결된다.
- **Sensitive Data Protection** —`classifies`→ **Dataset/Column**: 민감 데이터 패턴을 데이터 자산에 라벨링하는 행위, de-identify는 `transforms`로 표현.
- **Attestation**(Binary Authorization) —`vouches_for`→ **Image** —`deployed_to`→ **GKE/Cloud Run**: 공급망 무결성을 빌드→배포 경로의 엣지로 표현.
- **Audit Log** —`records`→ **(Principal, Action, Resource)**: 감사 로그는 IAM 그래프의 행위를 시간축으로 관측한 이벤트 노드.

즉 "키–비밀–경계–조건"은 데이터 자산 노드 주위를 감싸는 **거버넌스 레이어 서브그래프**를 이루고, "규제–통제–서비스"와 "이미지–서명–배포"가 그 위에 겹친다. IAM([[/concept/cloud/05_iam_for_pca]])의 "Principal–Role–Resource" 그래프와 직교(orthogonal)하게 교차한다.

---

## 시험 공략 요약

### 레이어 판별 — "이건 누구 일인가"

| 요구사항 키워드 | 정답 서비스 | 레이어 |
|----------------|-------------|--------|
| "데이터를 암호화하라"(단순) | 기본 암호화(추가 작업 없음) | at-rest 기본 |
| "키를 우리가 관리·로테이션·폐기" | **CMEK** (Cloud KMS) | 키 통제 |
| "키를 Google이 저장하면 안 됨, GCE/GCS" | **CSEK** | 키 통제 |
| "키를 Google 밖 우리 시스템에"(데이터 주권) | **Cloud EKM** | 키 통제 |
| "FIPS 140-2 Level 3 HSM" | **Cloud HSM**(CMEK 보호수준) | 키 통제 |
| "API 키·패스워드를 안전하게 저장" | **Secret Manager** | 비밀 관리 |
| "자격증명 유출돼도 외부 데이터 반출 차단" | **VPC-SC** | 데이터 경계 |
| "VPN 없이 내부 웹앱 접근, 컨텍스트 기반" | **IAP for Web** | 앱 접근 |
| "외부 IP 없는 VM에 SSH" | **IAP TCP forwarding** | 앱 접근 |
| "조직 위협 탐지 + CIS 컴플라이언스" | **SCC Premium** | 가시성·탐지 |
| "멀티클라우드 + SIEM/SOAR" | **SCC Enterprise** | 가시성·탐지 |
| "VM 부팅 무결성(루트킷 방지)" | **Shielded VM** | 워크로드 무결성 |
| "사용 중(메모리) 데이터 암호화" | **Confidential VM** | 워크로드 무결성 |
| "조직/폴더에서 프로젝트 위로 방화벽 강제" | **계층형 방화벽 정책**(goto_next) | 네트워크 상위 강제 |
| "검증된/서명된 이미지만 GKE·Cloud Run 배포" | **Binary Authorization** | 공급망 무결성 |
| "Artifact Registry 이미지 취약점 스캔" | **Artifact Analysis** | 공급망 무결성 |
| "관리 기기·위치로 콘솔·API 접근 제한" | **Context-Aware Access**(Chrome Enterprise Premium) | 컨텍스트 접근 |
| "데이터를 특정 리전에만 저장" | Org Policy **`resourceLocations`** | 데이터 거주 |
| "거주+인력 접근 제한+규제 패키지 묶음" | **Assured Workloads** | 컴플라이언스 |
| "PII·카드번호 탐지·마스킹·토큰화" | **Sensitive Data Protection**(구 DLP) | 민감정보 |
| "누가 데이터셋에 접근했는지 추적" | **Data Access 감사 로그**(직접 활성화) | 감사 |
| "Google 인력의 우리 데이터 접근 가시화" | **Access Transparency**(+Access Approval) | 감사 |

### 혼동 쌍 — 시험 직전 점검

| 혼동 쌍 | 핵심 구분선 |
|---------|------------|
| CMEK vs CSEK | CMEK=Google KMS에 키 저장(고객 관리) / CSEK=Google 저장 안 함, 키 직접 제공, 분실 시 데이터 끝, GCE·GCS 한정 |
| CMEK vs EKM | CMEK=Google KMS 내부 / EKM=Google 외부 서드파티 KMS(데이터 주권) |
| KMS vs Secret Manager | KMS=키(키 머티리얼 안 나옴, 연산 수행) / Secret Manager=비밀값 자체 저장·반환 |
| IAM vs VPC-SC | IAM=권한(누가) / VPC-SC=경계(데이터 유출 방지), 둘은 별개 레이어 — 둘 다 통과해야 |
| VPC-SC vs 방화벽 | VPC-SC=관리형 서비스 API(데이터 평면) / 방화벽=L3/L4 네트워크 트래픽 |
| IAP vs VPN | IAP=신원+컨텍스트(제로 트러스트), 웹은 L7 앞단·VM은 TCP forwarding / VPN=네트워크 위치 신뢰 |
| SCC Standard vs Premium | Standard=무료·인벤토리·기본 점검 / Premium=위협 탐지·컴플라이언스 |
| Shielded VM vs Confidential VM | Shielded=부팅 무결성 / Confidential=메모리(사용 중) 암호화 |
| Key Ring/Key 삭제 | 삭제 불가(이름 영구 점유) — 삭제 가능한 것은 Key **Version**(예약 폐기) |
| VPC-SC vs 계층형 방화벽 | VPC-SC=관리형 서비스 데이터 평면 경계 / 계층형 방화벽=조직·폴더에서 L3/L4를 상위 강제(goto_next로 위임) |
| IAP vs Context-Aware Access | IAP=웹 앱 L7 앞단 인증 / Context-Aware Access=콘솔·API·앱 접근에 기기·위치 조건(둘 다 같은 Access Level 공유) |
| Binary Authorization vs Artifact Analysis | Binary Auth=배포 게이트(서명된 이미지만) / Artifact Analysis=이미지 취약점 스캔(게이트의 입력) |
| KMS/Secret Manager vs Sensitive Data Protection | KMS=키, Secret Manager=비밀값 / Sensitive Data Protection=데이터 안의 PII 패턴 탐지·de-id |
| 데이터 거주 vs 주권 | 거주=어디 저장(`resourceLocations`) / 주권=통제권 누구에게(EKM·인력 접근), 묶음=Assured Workloads |
| Audit Logs vs Access Transparency | Audit Logs=우리(고객)의 행위 / Access Transparency=Google 인력의 우리 데이터 접근 |
| Data Access 로그 | 4종 중 유일하게 기본 비활성 — 명시적 활성화 필요(BigQuery 데이터 접근은 예외) |

---

## 실전 퀴즈 — 핵심 개념 검증

---

**Q1. 키 관리 — 책임 경계 선택**

금융 규제 기관이 요구한다 — "암호화 키를 클라우드 제공자(Google)가 어떤 형태로도 저장·보유해서는 안 되며, 키는 우리가 운영하는 키 관리 시스템에 둬야 한다." BigQuery에 저장된 데이터를 이 조건으로 보호해야 한다. 올바른 선택은?

- (A) CMEK — Cloud KMS에 키를 만들고 자동 로테이션을 설정한다.
- (B) CSEK — 매 요청에 raw 키를 직접 제공한다.
- (C) Cloud EKM — 외부 키 관리 시스템에 키를 두고 GCP가 외부 키로 암복호화를 호출한다.
- (D) Google-managed 키 + Org Policy로 접근 제한.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (C)**

"Google이 키를 저장조차 하면 안 되고, 키는 우리 외부 시스템에" = **Cloud EKM**. 키 머티리얼이 외부 KMS를 떠나지 않고, GCP는 호출만 한다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | CMEK는 키를 **Google KMS에 저장**한다 — "Google 저장 금지" 위반 |
| (B) | CSEK는 Google이 영구 저장은 안 하지만 **BigQuery는 CSEK 미지원**(주로 GCE 디스크·GCS). 게다가 "외부 시스템에 둔다"는 EKM의 정의에 더 부합 |
| (D) | Google-managed는 키 통제권이 Google에 있음 — 정면 위반 |

</div>
</details>

---

**Q2. KMS 키 라이프사이클 — 잘못 만든 키**

운영자가 실수로 잘못된 위치(location)에 Key Ring과 Key를 만들었다. 깨끗하게 정리하려 한다. 가능한 것은?

- (A) Key Ring을 삭제하고 올바른 위치에 다시 만든다.
- (B) Key를 삭제하고 같은 이름으로 다시 만든다.
- (C) Key Ring·Key는 삭제할 수 없다. 올바른 위치에 새 Key Ring/Key를 만들고, 기존 것은 Key Version을 비활성화/예약 폐기해 사용 중단한다.
- (D) Key Ring의 location을 올바른 값으로 변경한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (C)**

Cloud KMS에서 **Key Ring과 Key는 삭제할 수 없다**(이름이 영구 점유됨). location은 생성 후 **변경 불가**다. 정리할 수 있는 단위는 Key **Version**이며, 그것도 예약 폐기(scheduled for destruction) 상태로 대기 후 파기된다.

따라서 (A)(B)는 불가능, (D)도 불가능. 운영상으로는 새 키를 만들고 기존 키는 버전 비활성화로 사용 중단하는 것이 정답이다. 이 때문에 키 네이밍은 처음부터 신중해야 한다.

</div>
</details>

---

**Q3. IAM으로 못 막는 위협 — 레이어 선택**

PII를 담은 BigQuery 데이터셋이 있다. 보안팀의 우려 — "내부자 또는 유출된 SA 키를 가진 공격자가, **유효한 IAM 권한을 그대로 가진 채** 회사 외부에서 데이터를 자신의 GCS 버킷으로 반출할 수 있다." IAM 권한 설정은 이미 최소 권한으로 되어 있다. 추가로 필요한 것은?

- (A) IAM 역할을 더 세분화한 Custom Role로 교체한다.
- (B) VPC Service Controls로 서비스 경계를 만들고 Access Level로 회사 네트워크에서만 접근을 허용한다.
- (C) 방화벽 규칙으로 외부 IP로의 트래픽을 차단한다.
- (D) Cloud KMS의 CMEK로 데이터셋을 암호화한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

핵심은 "**유효한 IAM 권한을 가진 채**"라는 문구다 — IAM은 권한이 있으니 통과시킨다. 이 유출(exfiltration)을 막는 것은 IAM과 별개 레이어인 **VPC-SC**다. 경계를 만들고 Access Level로 신뢰 네트워크에서만 접근을 허용하면, 외부에서 온 요청은 권한이 있어도 차단된다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | 권한을 아무리 세분화해도 "권한 있는 자의 외부 반출"은 권한 문제가 아님 |
| (C) | 방화벽은 L3/L4 네트워크 트래픽 — BigQuery·GCS API 데이터 평면 접근을 막지 못함 |
| (D) | CMEK는 키 통제이지 경계 밖 반출을 막는 메커니즘이 아님(권한 있으면 복호화됨) |

</div>
</details>

---

**Q4. VPN 없는 접근 — IAP 적용**

레거시 내부 웹 애플리케이션(GCE 인스턴스 그룹에서 구동)을 직원들이 재택에서 접근해야 한다. 요구 — VPN을 쓰지 않고, 회사가 관리하는 신원으로만 접근하며, 향후 기기·지역 조건을 추가할 수 있어야 한다. 가장 적합한 설계는?

- (A) 인스턴스에 외부 IP를 부여하고 방화벽으로 직원 집 IP를 허용한다.
- (B) HTTPS 부하 분산기 앞에 IAP를 활성화하고 `roles/iap.httpsResourceAccessor`로 접근을 제어하며, Access Context Manager로 컨텍스트 조건을 더한다.
- (C) Cloud VPN을 구성해 직원 기기를 VPC에 연결한다.
- (D) Secret Manager에 앱 비밀번호를 두고 직원에게 공유한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

"VPN 없이, 신원 기반, 컨텍스트 확장 가능" = **IAP for Web**(BeyondCorp). 웹 앱이므로 **HTTPS 부하 분산기(L7) 앞단**에서 IAP가 인증하고, IAM 역할(`iap.httpsResourceAccessor`)로 접근을 제어한다. 기기·지역 조건은 Access Context Manager의 Access Level로 추가한다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | 외부 IP + IP 화이트리스트는 신원/컨텍스트 기반이 아니고 IP는 위조·변동에 취약 |
| (C) | VPN을 쓰지 말라는 요구에 정면 위배 |
| (D) | 공유 비밀번호는 신원 기반 접근 제어가 아님 |

주의: IAP for Web은 L7 LB가 전제이며, 백엔드는 IAP의 서명 JWT 헤더를 검증해 우회를 막아야 한다.

</div>
</details>

---

**Q5. SCC 티어 선택**

조직이 다음을 원한다 — ① 실시간 위협 탐지(악성 활동·비정상 행위), ② CIS·PCI DSS 컴플라이언스 대시보드, ③ 대상은 GCP 단일 클라우드. 비용은 합리적 범위에서. 어떤 SCC 티어가 최소 요구를 충족하는가?

- (A) Standard — 무료이므로 충분하다.
- (B) Premium — 위협 탐지와 컴플라이언스 리포트를 포함한다.
- (C) Enterprise — 모든 기능을 포함하므로 항상 이것을 고른다.
- (D) SCC가 아니라 Cloud Logging 알림으로 구현한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

위협 탐지(Event/Container/VM Threat Detection)와 컴플라이언스 리포트(CIS·PCI 등)는 **Premium 이상**에서 제공된다. 대상이 GCP 단일 클라우드이므로 멀티클라우드·SIEM/SOAR가 필요한 **Enterprise까지는 불필요**하다 — "비용 합리적" 요구를 고려하면 과잉이다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | Standard는 자산 인벤토리·기본 설정 점검 중심 — 위협 탐지·컴플라이언스 미포함 |
| (C) | Enterprise는 멀티클라우드·SecOps용 — 단일 GCP에는 과잉 비용 |
| (D) | 직접 로깅으로 위협 탐지 룰을 다 구현하는 것은 SCC Premium의 관리형 탐지를 재발명 |

</div>
</details>

---

**Q6. 공급망 보안 — 검증된 이미지만 배포**

보안팀이 요구한다 — "GKE 클러스터에 배포되는 컨테이너 이미지는 반드시 우리 CI의 취약점 스캔을 통과해 **서명된 것만** 실행되어야 한다. 서명 없는 이미지의 프로덕션 배포를 차단하라." 무엇을 도입하는가?

- (A) Cloud Armor로 악성 트래픽을 차단한다.
- (B) Binary Authorization 정책을 enforce로 설정하고, 스캔 통과 attestation을 요구하는 attestor를 등록한다.
- (C) VPC Service Controls로 Artifact Registry 주위에 경계를 만든다.
- (D) Shielded VM으로 노드 부팅 무결성을 보장한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

"서명된 이미지만 배포, 미서명 배포 차단" = 배포 시점 게이트인 **Binary Authorization**. 취약점 스캔(Artifact Analysis) 결과를 attestation으로 연결하면 "스캔 통과 → 서명 → 배포 허용" 파이프라인이 된다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | Cloud Armor는 L7 트래픽 보호(WAF) — 배포 무결성과 무관 |
| (C) | VPC-SC는 데이터 평면 유출 방지 — 이미지 서명 검증을 하지 않음 |
| (D) | Shielded VM은 노드 **부팅** 무결성 — 어떤 이미지를 배포할지 게이트하지 않음 |

</div>
</details>

---

**Q7. 컴플라이언스 매핑 — 카드번호 취급**

결제 서비스가 PCI DSS 범위에 든다. 분석팀은 거래 데이터로 리포트를 만들어야 하지만 **원본 카드번호(PAN)가 분석 환경에 그대로 노출되면 안 된다**. 단, 결제 정산 단계에서는 원래 값으로 **되돌릴 수 있어야** 한다. 가장 적합한 설계는?

- (A) Cloud KMS로 데이터셋을 CMEK 암호화한다.
- (B) Sensitive Data Protection으로 카드번호를 탐지해 **마스킹(redaction)**한다.
- (C) Sensitive Data Protection으로 카드번호를 탐지해 **토큰화(형식보존, 가역)**한다.
- (D) Secret Manager에 카드번호를 저장한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (C)**

핵심 단서는 "**되돌릴 수 있어야 한다**"이다. 비식별 기법 중 **토큰화(형식보존 암호화)는 가역적**이라 키로 원본을 복원할 수 있어 정산 단계에 부합한다. 탐지·분류·de-id는 **Sensitive Data Protection(구 Cloud DLP)**의 일이다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | CMEK는 데이터셋 전체를 키로 암호화할 뿐, 컬럼 안의 카드번호를 "분석은 가능하되 가림" 처리하지 못함 |
| (B) | 마스킹/redaction은 **비가역** — "되돌릴 수 있어야" 요구에 위배 |
| (D) | Secret Manager는 API 키·패스워드 같은 비밀값 저장소 — 대량 거래 데이터의 PII 처리가 아님 |

</div>
</details>

---

**Q8. 감사 — 누가 데이터에 접근했나**

규제 감사를 앞두고 요구가 내려왔다 — "지난 분기 **누가 어떤 BigQuery 데이터셋의 데이터를 읽었는지** 증빙하고, 모든 감사 기록을 **7년간 변조 불가능하게 보존**하라." 어떻게 구성하는가?

- (A) Admin Activity 로그만 보면 데이터 읽기까지 다 나온다.
- (B) Data Access 감사 로그를 활성화하고, 로그 싱크로 Cloud Storage(버킷 잠금)로 내보내 장기 보존한다.
- (C) Access Transparency를 켜면 우리 직원의 데이터 접근이 기록된다.
- (D) SCC Standard의 자산 인벤토리로 접근 기록을 확인한다.

<details>
<summary>정답 및 해설</summary>
<div markdown="1">

**정답: (B)**

데이터 **읽기/쓰기**는 **Data Access 감사 로그**가 기록하며, 이 로그는 4종 중 유일하게 **기본 비활성**이라 명시적으로 켜야 한다. 장기·변조 불가 보존은 **로그 싱크 → Cloud Storage(버킷 잠금)**가 정석이다.

| 선택지 | 문제점 |
|--------|--------|
| (A) | Admin Activity는 관리 작업(설정·IAM 변경)만 — 데이터 읽기는 기록하지 않음 |
| (C) | Access Transparency는 **Google 인력**의 접근을 기록 — 우리 사용자의 데이터 접근이 아님 |
| (D) | SCC 자산 인벤토리는 리소스 목록 — "누가 읽었나"라는 행위 감사가 아님 |

</div>
</details>

---

## 마무리

처음의 두 질문에 답한다. "데이터는 이미 암호화되는데 왜 KMS?" — 기본 암호화는 키를 Google이 통제한다. CMEK/CSEK/EKM은 **키 통제권을 고객에게 옮기는 정도의 차이**다. "IAM으로 막았는데 왜 VPC-SC?" — IAM은 권한, VPC-SC는 **경계**다. 권한 있는 자격증명이 경계 밖에서 데이터를 빼가는 것은 다른 레이어가 막는다.

<div class="callout-tip">
보안 문제 풀이 = "이 요구는 어느 레이어인가" 판별. 키 통제(KMS) / 비밀(Secret Manager) / 데이터 경계(VPC-SC) / 네트워크 상위 강제(계층형 방화벽) / 앱·컨텍스트 접근(IAP·Context-Aware Access) / 가시성(SCC) / 공급망 무결성(Binary Authorization) / 워크로드 무결성(Shielded·Confidential VM) / 환경 제약(Org Policy) / 권한(IAM, 별도 글). 컴플라이언스는 그 위에서 "규제 → 통제 → 서비스(거주·주권·민감정보·인증·감사)"로 푼다. 한 레이어로 다른 레이어의 일을 시키지 마라.
</div>

---

## 참고

- [[/cloud]] — Google PCA 준비 시리즈 인덱스
- [[/concept/cloud/05_iam_for_pca]] — IAM 권한 모델(Principal·Role·Resource), Org Policy 기본, SA 관리 (이 글과 직교하는 권한 레이어)
- Google Cloud, [*Cloud KMS documentation*](https://cloud.google.com/kms/docs) — Key Ring·Key·Version, 보호 수준, 로테이션
- Google Cloud, [*Customer-managed encryption keys (CMEK)*](https://cloud.google.com/kms/docs/cmek) — CMEK 개념·지원 서비스
- Google Cloud, [*Customer-supplied encryption keys (CSEK)*](https://cloud.google.com/compute/docs/disks/customer-supplied-encryption) — CSEK 지원 범위·책임 경계
- Google Cloud, [*Cloud External Key Manager (EKM)*](https://cloud.google.com/kms/docs/ekm) — 외부 키 관리, 데이터 주권
- Google Cloud, [*Secret Manager documentation*](https://cloud.google.com/secret-manager/docs) — 시크릿·버전·복제·IAM
- Google Cloud, [*VPC Service Controls*](https://cloud.google.com/vpc-service-controls/docs/overview) — 서비스 경계·Access Level·ingress/egress
- Google Cloud, [*Identity-Aware Proxy*](https://cloud.google.com/iap/docs/concepts-overview) — IAP for Web·TCP forwarding, BeyondCorp
- Google Cloud, [*Security Command Center*](https://cloud.google.com/security-command-center/docs) — Standard·Premium·Enterprise 티어
- Google Cloud, [*Shielded VM*](https://cloud.google.com/security/products/shielded-vm) — Secure Boot·vTPM·Integrity Monitoring
- Google Cloud, [*Hierarchical firewall policies*](https://cloud.google.com/firewall/docs/firewall-policies-overview) — 조직·폴더 레벨 강제, goto_next 평가
- Google Cloud, [*Binary Authorization*](https://cloud.google.com/binary-authorization/docs) — 배포 시점 서명 검증, attestor·attestation
- Google Cloud, [*Artifact Analysis*](https://cloud.google.com/artifact-analysis/docs) — Artifact Registry 취약점 스캔
- Google Cloud, [*Context-aware access*](https://cloud.google.com/beyondcorp-enterprise/docs/context-aware-access) — Access Level 기반 접근, Chrome Enterprise Premium
- Google Cloud, [*Sensitive Data Protection (구 Cloud DLP)*](https://cloud.google.com/sensitive-data-protection/docs) — 탐지·분류·de-identify(마스킹·토큰화)
- Google Cloud, [*Assured Workloads*](https://cloud.google.com/assured-workloads/docs) — 데이터 거주·인력 접근 제한·규제 패키지
- Google Cloud, [*Cloud Audit Logs*](https://cloud.google.com/logging/docs/audit) — Admin Activity·Data Access·System Event·Policy Denied
- Google Cloud, [*Access Transparency*](https://cloud.google.com/assured-workloads/access-transparency/docs) — Google 인력 접근 로그(+Access Approval)
- Google Cloud, [*Compliance offerings*](https://cloud.google.com/security/compliance) — SOC·ISO·FedRAMP·PCI 인증, 공동 책임 모델
