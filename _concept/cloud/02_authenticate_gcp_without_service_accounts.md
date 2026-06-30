---
layout  : concept
title   : SA 키 없이 GCP 인증하기
date    : 2026-06-25 00:00:00 +0900
updated : 2026-06-25 00:00:00 +0900
tag     : cloud gcp iam security
toc     : true
comment : true
latex   : true
show-diagram : true
status  : complete
public  : true
parent  : [[/cloud]]
relations:
  - { type: extends, target: /concept/cloud/01_how_to_operate_iam_well }
confidence     : medium
valid_from     : 2026-06-25
---

* TOC
{:toc}

## 핵심 개념 — ADC (Application Default Credentials)

GCP SDK·라이브러리는 자격증명을 아래 순서로 탐색한다.

```
1. GOOGLE_APPLICATION_CREDENTIALS 환경변수 → SA JSON 파일  ← 조직 정책으로 금지
2. gcloud auth application-default login   → 사람 계정      ← 로컬 개발
3. GCE/GKE Metadata Server                 → 연결된 SA       ← 해당 없음
4. Workload Identity Federation credential → OIDC 토큰       ← GitLab CI
```

**1번을 막고, 로컬은 2번, CI/CD는 4번을 쓴다.**

---

## 조직 정책 — SA 키 발급 자체를 막는다

```bash
# SA 키 생성 차단
gcloud org-policies set-policy - <<'EOF'
name: organizations/ORG_ID/policies/iam.disableServiceAccountKeyCreation
spec:
  rules:
    - enforce: true
EOF

# SA 키 업로드도 차단
gcloud org-policies set-policy - <<'EOF'
name: organizations/ORG_ID/policies/iam.disableServiceAccountKeyUpload
spec:
  rules:
    - enforce: true
EOF
```

이미 발급된 키 전수 조회 후 폐기한다.

```bash
gcloud iam service-accounts list --project=PROJECT_ID --format="value(email)" | \
  while read sa; do
    echo "=== $sa ===";
    gcloud iam service-accounts keys list --iam-account="$sa" \
      --managed-by=user --format="table(name,validAfterTime,validBeforeTime)";
  done
```

---

## 로컬 개발 — 사람 계정으로 ADC 설정

개발자 개인 Google Workspace 계정으로 ADC를 설정한다. SA JSON 키 배포가 필요 없다.

```bash
# 1. gcloud CLI 자체 인증
gcloud auth login

# 2. SDK·라이브러리(Python, Go 등)용 ADC 설정
gcloud auth application-default login
# → ~/.config/gcloud/application_default_credentials.json 생성
# → 사람 계정 OAuth 토큰 (1시간 만료 + 자동 갱신, 퇴사 시 즉시 무효화)

# 3. quota를 개발 프로젝트에 귀속 (필수)
gcloud auth application-default set-quota-project dev-PROJECT_ID

# 4. 확인
gcloud auth application-default print-access-token
```

<div class="callout-warning">
<code>gcloud auth login</code>과 <code>gcloud auth application-default login</code>은 다르다. 전자는 <code>gcloud</code> CLI 명령어 자체의 인증, 후자는 코드(SDK)의 ADC다. 둘 다 설정해야 한다.
</div>

**온보딩 스크립트에 포함:**

```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project dev-PROJECT_ID
gcloud auth application-default set-quota-project dev-PROJECT_ID
```

---

## GitLab CI — Workload Identity Federation (OIDC)

GitLab CI는 잡(job)마다 OIDC 토큰(`id_tokens`)을 발급할 수 있다. 이 토큰으로 GCP STS에 임시 자격증명을 교환한다. SA JSON 키 불필요.

```
GitLab CI job
  → OIDC 토큰 발급 (id_tokens)
    → GCP STS 교환
      → 임시 access token
        → GCP API 호출
```

### 사전 세팅 (최초 1회, GCP 콘솔 or gcloud)

```bash
# 1. WIF Pool 생성
gcloud iam workload-identity-pools create gitlab-pool \
  --location=global \
  --project=PROJECT_ID \
  --display-name="GitLab CI Pool"

# 2. GitLab OIDC Provider 등록
#    gitlab.com 사용 시 issuer-uri는 https://gitlab.com
#    self-hosted GitLab은 해당 도메인으로 변경
gcloud iam workload-identity-pools providers create-oidc gitlab-provider \
  --location=global \
  --workload-identity-pool=gitlab-pool \
  --issuer-uri="https://gitlab.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.project_path=assertion.project_path,attribute.ref=assertion.ref,attribute.ref_type=assertion.ref_type" \
  --attribute-condition="assertion.namespace_path == 'YOUR_GITLAB_GROUP'"

# Provider 전체 이름 확인 (CI 변수에 붙여넣을 값)
gcloud iam workload-identity-pools providers describe gitlab-provider \
  --location=global \
  --workload-identity-pool=gitlab-pool \
  --project=PROJECT_ID \
  --format="value(name)"
# → projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/gitlab-pool/providers/gitlab-provider
```

### 방식 A: SA 경유 (권한을 SA별로 분리)

```bash
# SA 생성 + 권한 부여
gcloud iam service-accounts create gitlab-ci-bq \
  --project=PROJECT_ID

gcloud projects add-iam-policy-binding PROJECT_ID \
  --role=roles/bigquery.dataViewer \
  --member="serviceAccount:gitlab-ci-bq@PROJECT_ID.iam.gserviceaccount.com"

# 해당 GitLab 프로젝트가 이 SA로 교환할 수 있도록 허용
gcloud iam service-accounts add-iam-policy-binding \
  gitlab-ci-bq@PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/gitlab-pool/attribute.project_path/YOUR_GROUP/YOUR_PROJECT"
```

```yaml
# .gitlab-ci.yml
variables:
  GCP_PROJECT_ID: "my-project"
  WIF_PROVIDER: "projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/gitlab-pool/providers/gitlab-provider"
  SERVICE_ACCOUNT: "gitlab-ci-bq@PROJECT_ID.iam.gserviceaccount.com"

.gcp_auth:
  id_tokens:
    GCP_TOKEN:
      aud: "https://iam.googleapis.com/$WIF_PROVIDER"

query-job:
  extends: .gcp_auth
  script:
    # OIDC 토큰을 파일로 저장
    - echo "$GCP_TOKEN" > /tmp/gcp_oidc_token

    # external_account credential config 생성 (ADC가 읽는 형식)
    - |
      gcloud iam workload-identity-pools create-cred-config \
        "$WIF_PROVIDER" \
        --service-account="$SERVICE_ACCOUNT" \
        --credential-source-file="/tmp/gcp_oidc_token" \
        --credential-source-type=text \
        --output-file="$CI_PROJECT_DIR/gcp_creds.json"

    # ADC로 등록
    - export GOOGLE_APPLICATION_CREDENTIALS="$CI_PROJECT_DIR/gcp_creds.json"
    - gcloud auth login --cred-file="$CI_PROJECT_DIR/gcp_creds.json" --quiet
    - gcloud config set project "$GCP_PROJECT_ID"

    # 이후 gcloud·SDK 모두 이 자격증명 사용
    - bq query --use_legacy_sql=false 'SELECT ...'
```

### 방식 B: SA 없이 직접 역할 부여

```bash
# SA 없이, GitLab 프로젝트 identity에 직접 역할 부여
gcloud projects add-iam-policy-binding PROJECT_ID \
  --role=roles/bigquery.dataViewer \
  --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/gitlab-pool/attribute.project_path/YOUR_GROUP/YOUR_PROJECT"
```

```yaml
# .gitlab-ci.yml
variables:
  WIF_PROVIDER: "projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/gitlab-pool/providers/gitlab-provider"

.gcp_auth:
  id_tokens:
    GCP_TOKEN:
      aud: "https://iam.googleapis.com/$WIF_PROVIDER"

query-job:
  extends: .gcp_auth
  script:
    - echo "$GCP_TOKEN" > /tmp/gcp_oidc_token
    - |
      gcloud iam workload-identity-pools create-cred-config \
        "$WIF_PROVIDER" \
        --credential-source-file="/tmp/gcp_oidc_token" \
        --credential-source-type=text \
        --output-file="$CI_PROJECT_DIR/gcp_creds.json"
        # --service-account 없음
    - export GOOGLE_APPLICATION_CREDENTIALS="$CI_PROJECT_DIR/gcp_creds.json"
    - gcloud auth login --cred-file="$CI_PROJECT_DIR/gcp_creds.json" --quiet
```

<div class="callout-info">
방식 A는 SA별로 권한을 분리할 수 있어 프로젝트가 여럿일 때 명확하다. 방식 B는 SA 관리 포인트가 없지만 프로젝트 수준 IAM이 넓어질 수 있다.
</div>

### 개발계 vs 운영계 분리 — ref(브랜치)로 제한

Provider `attribute-condition`에 브랜치 조건을 추가하거나, SA별로 허용 ref를 다르게 설정한다.

```bash
# 운영계 SA — main 브랜치 job만 교환 허용
gcloud iam service-accounts add-iam-policy-binding \
  gitlab-ci-prod@PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/gitlab-pool/attribute.project_path/YOUR_GROUP/YOUR_PROJECT" \
  --condition="expression=attribute.ref=='refs/heads/main',title=main-only"

# 개발계 SA — 모든 ref 허용
gcloud iam service-accounts add-iam-policy-binding \
  gitlab-ci-dev@dev-PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/gitlab-pool/attribute.project_path/YOUR_GROUP/YOUR_PROJECT"
```

```yaml
# .gitlab-ci.yml
deploy-dev:
  extends: .gcp_auth
  variables:
    SERVICE_ACCOUNT: "gitlab-ci-dev@dev-PROJECT_ID.iam.gserviceaccount.com"
  script:
    - # ... cred config 생성 후 dev 환경 작업

deploy-prod:
  extends: .gcp_auth
  variables:
    SERVICE_ACCOUNT: "gitlab-ci-prod@prod-PROJECT_ID.iam.gserviceaccount.com"
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
  script:
    - # ... cred config 생성 후 prod 환경 작업
```

---

## 환경별 정리

| 환경 | 인증 방식 | SA JSON 키 필요? |
|------|-----------|:---:|
| 로컬 개발 | `gcloud auth application-default login` (사람 계정) | ❌ |
| GitLab CI 개발계 | WIF + OIDC (`id_tokens`) | ❌ |
| GitLab CI 운영계 | WIF + OIDC (main 브랜치 IAM 조건) | ❌ |

---

## 참고

- [[/cloud/01_how_to_operate_iam_well]] — 서비스 계정 관리 8가지 철칙
- [GCP 공식: Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation)
- [GitLab 공식: ID tokens](https://docs.gitlab.com/ee/ci/secrets/id_token_authentication.html)
- [GitLab 공식: GCP WIF 연동](https://docs.gitlab.com/ee/ci/cloud_services/google_cloud/)
