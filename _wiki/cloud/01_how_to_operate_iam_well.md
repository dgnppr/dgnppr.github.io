---
layout  : wiki
title   : 클라우드 서비스 계정 관리 철칙
date    : 2026-06-20 00:00:00 +0900
updated : 2026-06-20 00:00:00 +0900
tag     : cloud gcp iam security
toc     : true
comment : true
latex   : true
status  : complete
show-diagram : true
public  : true
parent  : [[/cloud]]
---

> AWS·GCP 어느 쪽을 쓰든 서비스 계정 관리의 원칙은 같다. 침해 시 **블래스트 레디어스를 최소화**하는 것. 각 철칙 아래 양 플랫폼 구현을 나란히 적는다.

---

## 철칙 1 — 사람과 서비스 계정을 분리한다

애플리케이션에 사람 계정 자격증명을 넣으면 안 된다. 사람 계정 키는 로테이션이 어렵고, 퇴사 시 즉시 회수도 안 된다.

| | AWS | GCP |
|--|-----|-----|
| 사람 | IAM User → 콘솔/CLI 용도만 | Google Workspace 계정 |
| 서비스 | IAM Role (키 없음) | Service Account |
| 금지 | 코드/환경변수에 `AWS_ACCESS_KEY_ID` | SA JSON 키 파일을 코드에 |

---

## 철칙 2 — 키 없이 운영한다 (Keyless)

키 파일이 없으면 유출도 없다. 플랫폼 네이티브 자격증명 체계를 쓴다.

**AWS — 환경별 Keyless 설정**

```
EC2           → Instance Profile (Metadata Service)
ECS / Fargate → Task Role
Lambda        → Execution Role
GitHub Actions → OIDC Provider + AssumeRoleWithWebIdentity
로컬 개발      → aws sso login (AWS IAM Identity Center)
```

**GCP — 서비스 계정 키 발급 자체를 막는다**

조직 정책으로 키 생성을 비활성화한다.

```
constraints/iam.disableServiceAccountKeyCreation = true
```

```
GCE / GKE Pod → Metadata Server가 자동 토큰 발급
GitHub Actions → Workload Identity Federation
로컬 개발      → gcloud auth application-default login
```

<div class="callout-warning">
GCP SA JSON 키는 만료가 없다. 발급한 순간 평생 유효한 비밀번호다. 조직 정책으로 발급을 막고, 이미 발급된 키는 <code>gcloud iam service-accounts keys list</code>로 전수 조회해 폐기한다.
</div>

---

## 철칙 3 — 워크로드마다 전용 계정을 만든다

하나의 계정을 여러 서비스가 공유하면, 하나가 침해되면 전체가 뚫린다.

**AWS**

```
# 나쁜 예: 모든 Lambda가 같은 역할
lambda-common-role (S3 Full + DynamoDB Full + SES + ...)

# 좋은 예: Lambda마다 필요한 것만
prod-user-api-role       → DynamoDB:GetItem, PutItem (users 테이블만)
prod-email-sender-role   → SES:SendEmail
prod-report-exporter-role → S3:GetObject (reports 버킷만)
```

**GCP**

```
api-server@project.iam.gserviceaccount.com       → roles/datastore.user
email-worker@project.iam.gserviceaccount.com     → roles/iam.serviceAccountTokenCreator (SMTP 위임)
bq-exporter@project.iam.gserviceaccount.com      → roles/bigquery.dataViewer (특정 데이터셋)
```

---

## 철칙 4 — 최소 권한으로 시작한다

"일단 넓게 주고 나중에 좁힌다"는 없다. 항상 최소로 시작하고, 실제 오류가 나면 추가한다.

**AWS — 리소스 범위까지 좁힌다**

```json
{
  "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:PutObject"],
  "Resource": "arn:aws:s3:::prod-uploads/*"
}
```

`"Resource": "*"` + `"Action": "s3:*"` 조합은 금지. `Deny`로 막는 것보다 `Allow` 범위를 좁히는 게 우선이다.

**GCP — 사전 정의 역할보다 커스텀 역할**

```bash
# 사전 정의 역할은 과도하게 넓은 경우가 많다
# roles/storage.objectAdmin 대신:
gcloud iam roles create bqExporterRole \
  --project=my-project \
  --permissions="bigquery.datasets.get,bigquery.tables.getData,bigquery.jobs.create"
```

---

## 철칙 5 — 그룹으로 관리한다

사용자에게 직접 역할/정책을 붙이면 온보딩·오프보딩 때마다 모든 리소스를 찾아다녀야 한다.

**AWS**

```
IAM Group: engineers-backend
  └── 정책: AllowECSReadOnly, AllowCloudWatchLogs

사용자 → Group에 추가/제거만
```

AWS IAM Identity Center(SSO)를 쓴다면 Permission Set으로 계정 간 권한을 한 곳에서 관리한다.

**GCP**

```
Google Group: backend-engineers@company.com
  └── 역할: roles/container.viewer, roles/logging.viewer (프로젝트 수준)

신규 입사 → Group 멤버십 추가만
퇴사      → Group 멤버십 제거만
```

---

## 철칙 6 — 권한 경계로 위임 범위를 제한한다

개발팀이 스스로 역할을 만들 수 있게 허용하되, 그 역할이 넘어갈 수 없는 상한선을 설정한다.

**AWS — Permissions Boundary**

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:*", "dynamodb:*"],
    "Resource": "*"
  }]
}
```

이 Boundary를 붙인 역할은 S3·DynamoDB 이외 서비스는 어떤 정책을 붙여도 접근 불가.

**GCP — IAM Conditions**

```
조건: resource.name.startsWith("projects/_/buckets/dev-")
→ dev- 버킷에만 권한 적용
```

시간 기반 조건도 가능하다:

```
조건: request.time < timestamp("2026-12-31T00:00:00Z")
→ 계약직·파트너 계정에 만료일 설정
```

---

## 철칙 7 — 감사 로그를 활성화하고 정기적으로 정리한다

**AWS 감사 도구**

| 도구 | 용도 |
|------|------|
| CloudTrail | 모든 API 호출 로그 (S3로 집계) |
| IAM Access Advisor | 역할·사용자별 마지막 서비스 접근일 |
| IAM Access Analyzer | 외부에 노출된 리소스 자동 탐지 |

```bash
# 90일 이상 미사용 역할 찾기
aws iam generate-service-last-accessed-details --arn arn:aws:iam::ACCOUNT:role/ROLE
aws iam get-service-last-accessed-details --job-id JOB_ID
```

**GCP 감사 도구**

| 도구 | 용도 |
|------|------|
| Cloud Audit Logs | Admin Activity + Data Access 분리 로깅 |
| IAM Recommender | 90일 미사용 권한 자동 축소 추천 |
| Policy Analyzer | 특정 퍼미션을 가진 계정 목록 조회 |

```bash
# IAM Recommender로 과도한 권한 조회
gcloud recommender recommendations list \
  --recommender=google.iam.policy.Recommender \
  --project=my-project \
  --location=global
```

**정기 검토 주기:** 90일마다 미사용 서비스 계정·역할을 비활성화 → 30일 후 삭제.

---

## 철칙 8 — 네이밍 컨벤션을 지킨다

이름이 없으면 감사 시 어떤 계정이 무슨 용도인지 모른다.

**AWS IAM Role 패턴**

```
<env>-<service>-<purpose>-role

prod-api-lambda-role
staging-batch-s3-writer-role
shared-github-actions-oidc-role
```

**GCP Service Account 패턴**

```
<service>-<purpose>@<project-id>.iam.gserviceaccount.com

api-bq-reader@my-prod-123.iam.gserviceaccount.com
batch-gcs-writer@my-prod-123.iam.gserviceaccount.com
github-actions-deployer@my-prod-123.iam.gserviceaccount.com
```

Description 필드에 용도, 담당팀, 리뷰 예정일을 반드시 기록한다.

---

## 요약

| 철칙 | 핵심 |
|------|------|
| 사람/서비스 분리 | 코드에 사람 계정 자격증명 절대 금지 |
| Keyless | SA JSON 키·IAM Access Key 발급 자체를 막는다 |
| 워크로드별 전용 계정 | 공유 계정은 블래스트 레디어스를 키운다 |
| 최소 권한 | 넓게 주고 좁히는 건 없다, 처음부터 좁게 |
| 그룹 기반 관리 | 사용자에게 직접 붙이지 않는다 |
| 권한 경계 | 위임 범위에 상한선을 설정한다 |
| 감사 + 정기 정리 | 90일 주기로 미사용 계정·권한 제거 |
| 네이밍 컨벤션 | 이름으로 목적·환경·소유팀을 알 수 있어야 한다 |
