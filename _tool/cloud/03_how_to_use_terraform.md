---
layout  : tool
title   : Terraform으로 인프라를 코드로 관리하기
date    : 2026-06-25 00:00:00 +0900
updated : 2026-06-25 00:00:00 +0900
tag     : cloud terraform iac gcp
toc     : true
comment : true
latex   : true
status  : writing
public  : true
parent  : [[/cloud]]
relations:
  - { type: implements, target: /wiki/cloud/01_vpc_for_pca }
  - { type: references, target: /wiki/cloud/01_how_to_operate_iam_well }
---

## Terraform이란

Terraform은 HashiCorp이 만든 **Infrastructure as Code(IaC)** 도구다.
클라우드 리소스(VM, 네트워크, DB, IAM 등)를 HCL(HashiCorp Configuration Language)로 선언하고,
`terraform apply` 한 번으로 실제 인프라를 만든다.

```
코드 선언 → Plan(변경 예측) → Apply(실제 반영) → State(현재 상태 추적)
```

**왜 Terraform인가**

| 비교 | 직접 콘솔 | 스크립트(gcloud/aws cli) | Terraform |
|------|-----------|--------------------------|-----------|
| 반복성 | 수동 | 가능 | 선언적 |
| 변경 감지 | 없음 | 없음 | Plan으로 Diff 확인 |
| 멀티 클라우드 | 불가 | 클라우드별 작성 | 단일 문법 |
| 상태 관리 | 없음 | 없음 | State 파일 |

---

## 핵심 개념

### Provider

클라우드 벤더와 통신하는 플러그인이다.

```hcl
terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = "my-project-id"
  region  = "asia-northeast3"
}
```

### Resource

실제로 생성할 인프라 단위다. `resource "<타입>" "<이름>"` 형태로 선언한다.

```hcl
resource "google_storage_bucket" "data_lake" {
  name     = "my-data-lake-bucket"
  location = "ASIA-NORTHEAST3"

  uniform_bucket_level_access = true

  lifecycle_rule {
    condition {
      age = 90
    }
    action {
      type = "Delete"
    }
  }
}
```

### State

Terraform은 `.tfstate` 파일에 현재 인프라 상태를 저장한다.
`plan` 실행 시 State와 실제 클라우드 상태를 비교해 변경 사항을 계산한다.

> **절대로 .tfstate를 git에 커밋하지 말 것.** 시크릿이 평문으로 포함될 수 있다.

### Variables & Outputs

```hcl
# 입력 변수
variable "project_id" {
  type        = string
  description = "GCP Project ID"
}

variable "environment" {
  type    = string
  default = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment는 dev, staging, prod 중 하나여야 합니다."
  }
}

# 출력값 — 다른 모듈이나 사용자에게 공개
output "bucket_url" {
  value = google_storage_bucket.data_lake.url
}
```

변수 값 주입 방법:

```bash
# 커맨드라인
terraform apply -var="project_id=my-project"

# .tfvars 파일
terraform apply -var-file="prod.tfvars"

# 환경변수 (TF_VAR_ 접두사)
export TF_VAR_project_id="my-project"
```

### Locals

반복되는 값이나 표현식을 한 곳에서 관리한다.

```hcl
locals {
  common_labels = {
    env     = var.environment
    team    = "data-platform"
    managed = "terraform"
  }

  bucket_name = "${var.project_id}-${var.environment}-data-lake"
}

resource "google_storage_bucket" "data_lake" {
  name   = local.bucket_name
  labels = local.common_labels
}
```

---

## 기본 워크플로우

```bash
# 1. 초기화 — provider 플러그인 다운로드
terraform init

# 2. 형식 정리
terraform fmt

# 3. 검증 — 문법 오류 체크
terraform validate

# 4. 변경 계획 확인 (읽기 전용)
terraform plan

# 5. 실제 적용
terraform apply

# 6. 특정 리소스만 삭제
terraform destroy -target=google_storage_bucket.data_lake

# 7. 전체 삭제
terraform destroy
```

`plan` 출력 기호:

| 기호 | 의미 |
|------|------|
| `+` | 생성 |
| `-` | 삭제 |
| `~` | 수정 |
| `-/+` | 재생성 (삭제 후 생성) |

---

## 데이터 소스 (Data Sources)

이미 존재하는 리소스를 Terraform으로 참조할 때 사용한다. 리소스를 **생성하지 않는다**.

```hcl
# 이미 존재하는 VPC를 참조
data "google_compute_network" "shared_vpc" {
  name    = "shared-vpc"
  project = "network-host-project"
}

resource "google_compute_subnetwork" "app_subnet" {
  name          = "app-subnet"
  network       = data.google_compute_network.shared_vpc.id
  ip_cidr_range = "10.0.1.0/24"
  region        = "asia-northeast3"
}
```

---

## 모듈 (Modules)

코드를 재사용 단위로 묶는다. 디렉토리 하나가 모듈 하나다.

```
project/
├── main.tf
├── variables.tf
├── outputs.tf
└── modules/
    └── gcs_bucket/
        ├── main.tf
        ├── variables.tf
        └── outputs.tf
```

모듈 정의 (`modules/gcs_bucket/main.tf`):

```hcl
variable "name" { type = string }
variable "location" {
  type    = string
  default = "ASIA-NORTHEAST3"
}
variable "labels" {
  type    = map(string)
  default = {}
}

resource "google_storage_bucket" "this" {
  name                        = var.name
  location                    = var.location
  labels                      = var.labels
  uniform_bucket_level_access = true
  force_destroy               = false
}

output "id"  { value = google_storage_bucket.this.id }
output "url" { value = google_storage_bucket.this.url }
```

루트에서 모듈 호출:

```hcl
module "raw_bucket" {
  source   = "./modules/gcs_bucket"
  name     = "my-project-raw"
  location = "ASIA-NORTHEAST3"
  labels   = local.common_labels
}

module "curated_bucket" {
  source = "./modules/gcs_bucket"
  name   = "my-project-curated"
  labels = local.common_labels
}

# 모듈 output 참조
output "raw_bucket_url" {
  value = module.raw_bucket.url
}
```

---

## Remote State (원격 상태 관리)

팀 협업 시 State를 GCS나 S3에 저장한다. **로컬 .tfstate는 팀 작업에 사용하지 말 것.**

```hcl
terraform {
  backend "gcs" {
    bucket = "my-terraform-state-bucket"
    prefix = "prod/network"
  }
}
```

다른 Terraform 코드의 State를 참조:

```hcl
# network 팀이 만든 VPC ID를 app 팀에서 읽어올 때
data "terraform_remote_state" "network" {
  backend = "gcs"
  config = {
    bucket = "my-terraform-state-bucket"
    prefix = "prod/network"
  }
}

# network State의 output 참조
resource "google_compute_subnetwork" "app" {
  network = data.terraform_remote_state.network.outputs.vpc_id
  # ...
}
```

---

## Lifecycle 규칙

리소스 생성/삭제 동작을 제어한다.

```hcl
resource "google_bigquery_dataset" "analytics" {
  dataset_id = "analytics"

  lifecycle {
    # 실수로 삭제 명령 날려도 무시
    prevent_destroy = true

    # 이 어트리뷰트 변경은 무시 (자동 태그 변경 등)
    ignore_changes = [labels]

    # 교체 시 새 리소스를 먼저 만들고 삭제 (다운타임 최소화)
    create_before_destroy = true
  }
}
```

---

## for_each와 count — 반복 리소스

```hcl
# count: 숫자 기반 반복
resource "google_bigquery_dataset" "env_dataset" {
  count      = length(var.environments)
  dataset_id = var.environments[count.index]
}

# for_each: map/set 기반 반복 (권장)
variable "buckets" {
  type = map(object({
    location    = string
    storage_class = string
  }))
  default = {
    raw = {
      location      = "ASIA-NORTHEAST3"
      storage_class = "STANDARD"
    }
    archive = {
      location      = "ASIA-NORTHEAST3"
      storage_class = "COLDLINE"
    }
  }
}

resource "google_storage_bucket" "multi" {
  for_each = var.buckets

  name          = "my-project-${each.key}"
  location      = each.value.location
  storage_class = each.value.storage_class
}
```

---

## depends_on — 명시적 의존성

Terraform은 리소스 간 참조를 자동으로 감지하지만, 암묵적 의존성이 있을 때는 명시해야 한다.

```hcl
resource "google_project_service" "bigquery" {
  service = "bigquery.googleapis.com"
}

resource "google_bigquery_dataset" "main" {
  dataset_id = "main"

  # API 활성화 후에 데이터셋 생성
  depends_on = [google_project_service.bigquery]
}
```

---

## Workspaces — 환경 분리

같은 코드로 dev/staging/prod 환경을 분리할 때 사용한다.
단, 규모가 커지면 **디렉토리 분리** 방식이 더 명확하다.

```bash
terraform workspace new dev
terraform workspace new prod

terraform workspace select dev
terraform apply -var-file="dev.tfvars"

terraform workspace select prod
terraform apply -var-file="prod.tfvars"
```

```hcl
# 현재 workspace 이름을 변수처럼 사용
resource "google_storage_bucket" "data" {
  name = "my-data-${terraform.workspace}"
}
```

---

## 실전 예제 — GCP 데이터 플랫폼 기초 인프라

```hcl
# variables.tf
variable "project_id" { type = string }
variable "region" {
  type    = string
  default = "asia-northeast3"
}
variable "environment" {
  type    = string
  default = "dev"
}

# locals.tf
locals {
  labels = {
    env     = var.environment
    team    = "data-platform"
    managed = "terraform"
  }
}

# main.tf
terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
  backend "gcs" {
    bucket = "terraform-state-my-project"
    prefix = "data-platform"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# API 활성화
resource "google_project_service" "apis" {
  for_each = toset([
    "bigquery.googleapis.com",
    "storage.googleapis.com",
    "dataflow.googleapis.com",
  ])
  service            = each.key
  disable_on_destroy = false
}

# GCS 버킷 레이어
resource "google_storage_bucket" "layers" {
  for_each = {
    raw     = { storage_class = "STANDARD", retention_days = 365 }
    refined = { storage_class = "STANDARD", retention_days = 180 }
    curated = { storage_class = "STANDARD", retention_days = 90  }
  }

  name          = "${var.project_id}-${each.key}-${var.environment}"
  location      = upper(var.region)
  storage_class = each.value.storage_class
  labels        = local.labels

  uniform_bucket_level_access = true

  lifecycle_rule {
    condition { age = each.value.retention_days }
    action    { type = "Delete" }
  }

  depends_on = [google_project_service.apis]
}

# BigQuery 데이터셋
resource "google_bigquery_dataset" "layers" {
  for_each = toset(["raw", "refined", "curated"])

  dataset_id  = "${each.key}_${replace(var.environment, "-", "_")}"
  location    = upper(var.region)
  labels      = local.labels
  description = "${each.key} layer dataset for ${var.environment}"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.apis]
}

# outputs.tf
output "bucket_names" {
  value = { for k, v in google_storage_bucket.layers : k => v.name }
}

output "dataset_ids" {
  value = { for k, v in google_bigquery_dataset.layers : k => v.dataset_id }
}
```

---

## 주요 명령어 치트시트

```bash
# 초기화 / 업그레이드
terraform init -upgrade

# 상태 확인
terraform show
terraform state list
terraform state show google_storage_bucket.data_lake

# 수동으로 State에 리소스 가져오기 (import)
terraform import google_storage_bucket.existing my-existing-bucket

# 특정 리소스만 plan/apply
terraform plan   -target=module.raw_bucket
terraform apply  -target=module.raw_bucket

# 자동 승인 (CI/CD)
terraform apply -auto-approve

# 그래프 시각화
terraform graph | dot -Tpng > graph.png
```

---

## 디렉토리 구조 권장 패턴

```
infra/
├── modules/              # 재사용 모듈
│   ├── gcs_bucket/
│   ├── bq_dataset/
│   └── vpc/
├── environments/
│   ├── dev/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── dev.tfvars
│   ├── staging/
│   └── prod/
└── shared/               # 환경 공통 리소스 (state bucket, shared VPC)
    └── main.tf
```

> 소규모는 workspace, 중대형은 디렉토리 분리. 환경별 State가 완전히 격리되어 `prod destroy`가 `dev`에 영향 안 준다.

---

## 참고

- [Terraform 공식 문서](https://developer.hashicorp.com/terraform/docs)
- [Google Provider 레퍼런스](https://registry.terraform.io/providers/hashicorp/google/latest/docs)
- [[/cloud]]
