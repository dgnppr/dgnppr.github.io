---
layout      : concept
title       : GCP에서 데이터 거버넌스 구축하기
date        : 2026-07-17 00:00:00 +0900
updated     : 2026-07-17 00:00:00 +0900
tag         : data-governance gcp bigquery dataplex iam terraform vpc-sc cmek hands-on
toc         : true
comment     : true
latex       : true
status      : draft
public      : true
parent      : [[/data-governance]]
confidence  : medium
relations:
  - { type: extends, target: /concept/data-governance/00_what_is_data_governance }
  - { type: references, target: /concept/data-governance/01_metadata_management }
  - { type: references, target: /concept/data-governance/02_data_quality_and_contracts }
  - { type: references, target: /concept/data-governance/03_data_lifecycle_and_deletion }
  - { type: references, target: /concept/cloud/01_how_to_operate_iam_well }
---

* TOC
{:toc}

## 문서의 정책을 코드로 내리는 실습

[[/data-governance/00_what_is_data_governance]]부터 [[/data-governance/03_data_lifecycle_and_deletion]]까지는 거버넌스가 무엇을 결정하는 체계인지를 다뤘다. 이번 글은 그 결정들을 GCP 위에서 실제로 코드와 설정으로 내리는 실습이다. 기준 사례는 하나로 고정한다. 분석 조직이 쓸 데이터 플랫폼을 새 GCP 환경에 세우는 경우다. raw 적재, curated 정제, mart 서빙의 3계층이고, 소스에는 개인정보가 섞여 있다. 진행 순서는 경계 설계, 메타데이터 강제, 분류와 접근 제어, 품질 게이트, 계보 수확, 보존 집행, 비용 귀속이고, 마지막에 이 순서를 기존 환경에 소급 적용할 때의 변형을 다룬다.

미리 말해 둘 것이 있다. 여기 나오는 서비스 이름은 GCP 것이지만, 각 단계에서 하는 일의 성격은 어느 스택에서든 같다. 그래서 매 절의 끝에 "무엇을 쓰든 남는 핵심"을 한 문장으로 적는다. 그리고 이 글은 잘 되는 경로만큼 집행이 새는 구멍을 비중 있게 다룬다. 컬럼 차단이 파생 테이블에서 증발하는 문제, BI 서비스 계정이 사용 기록을 가리는 문제, time travel이 삭제 완료 시점을 미루는 문제 같은 것들이다. 기능을 켜는 것만으로는 집행이 완성되지 않고, 각 기능의 보호 범위가 어디서 끝나는지까지 알아야 설정이 실효를 갖기 때문이다.

## 경계를 먼저 긋는다

첫 작업은 테이블 생성이 아니라 프로젝트 경계 설계다. GCP에서 프로젝트는 IAM, 과금, 감사 로그, 쿼터가 귀속되는 단위라서, 프로젝트를 어떻게 쪼개느냐가 이후 모든 접근 제어의 해상도를 결정한다. 기준 사례에서는 폴더 하나 아래 계층별로 `dp-raw-prod`, `dp-curated-prod`, `dp-mart-prod`를 나누고, 개발용으로 같은 구조의 `-dev` 세트를 하나 더 둔다. 여기에 하나를 더 얹는 것이 실무의 요령인데, taxonomy·품질 결과·감사 로그 싱크·모니터링처럼 거버넌스 자체의 산출물을 담는 `dp-governance` 프로젝트를 별도로 두는 것이다. 통제 장치가 통제 대상과 같은 프로젝트에 살면, 데이터 프로젝트의 관리자가 자기 통제 장치를 수정할 수 있게 되어 직무 분리가 무너진다. 감사 로그와 taxonomy는 데이터 팀이 아니라 플랫폼(또는 보안) 경계 안에 있어야 한다.

프로젝트를 나눌 때 알아야 할 IAM의 구조적 성질이 하나 있다. GCP의 allow 정책은 계층을 따라 내려가며 합산만 된다. 조직에서 준 권한을 프로젝트에서 뺄 수 없고, 폴더에서 준 권한을 데이터셋에서 뺄 수 없다. 상위에서 넓게 준 권한은 하위의 어떤 설정으로도 좁혀지지 않는다는 뜻이고, 그래서 상속 계층의 위쪽일수록 부여를 아껴야 한다. 최근에는 deny 정책으로 특정 권한을 명시적으로 차단하는 경로가 생겼지만 지원 범위가 서비스별로 다르므로(적용 전 확인이 필요하다), 기본 설계는 여전히 "위는 좁게, 아래에서 더한다"로 가는 것이 안전하다.

경계를 그었으면 폴더 수준에 조직 정책(organization policy)을 걸어 상속시킨다. 데이터 플랫폼에서 실효가 큰 것을 꼽으면, 회사 도메인 밖 계정에 IAM을 부여할 수 없게 하는 도메인 제한 공유(`iam.allowedPolicyMemberDomains`), 유출 사고의 단골 원인인 서비스 계정 키 파일 생성을 막는 `iam.disableServiceAccountKeyCreation`(키 파일 대신 workload identity와 임시 토큰을 쓰게 강제하는 효과가 있다), 리소스가 허용 리전 밖에 만들어지지 않게 하는 `gcp.resourceLocations`다. 셋 다 "하면 안 된다"를 교육이 아니라 API 거부로 만드는 장치다.

권한 부여 경로가 IAM으로 다 막히지 않는 위협이 하나 남는다. 정당한 권한을 가진 계정(또는 탈취된 자격 증명)이 데이터를 조직 밖 프로젝트로 복사해 나가는 반출이다. `bq cp`나 `EXPORT DATA`는 권한만 있으면 목적지를 가리지 않는다. 이것을 막는 층이 VPC Service Controls다. BigQuery와 GCS를 서비스 경계(perimeter) 안에 넣으면 경계 밖 프로젝트·인터넷으로의 API 수준 반출이 차단된다. 다만 VPC-SC는 도입 마찰이 큰 도구다. 외부 SaaS 연동, 파트너 공유, Composer의 관리형 리소스까지 전부 ingress/egress 규칙으로 뚫어 줘야 하므로, 처음부터 enforced로 켜지 말고 dry-run 모드로 수 주간 위반 로그를 관찰해 규칙을 만든 뒤 전환하는 것이 정석이다. 개인정보를 다루는 플랫폼이라면 이 마찰을 지불할 가치가 있다. 접근 제어는 "누가 읽는가"를 통제하지만 반출 통제는 "읽은 것이 어디까지 가는가"를 통제하고, 이 둘은 대체재가 아니다.

권한은 처음부터 두 가지 규칙으로 못 박는다. 개인에게 직접 부여하지 않고 Google 그룹에만 부여한다. 그리고 콘솔에서 손으로 부여하지 않고 Terraform으로만 부여한다.

```hcl
resource "google_bigquery_dataset" "mart_growth" {
  project    = "dp-mart-prod"
  dataset_id = "mart_growth"
  labels = {
    owner = "growth-data"
    tier  = "gold"
    pii   = "none"
  }
}

resource "google_bigquery_dataset_iam_member" "analysts" {
  project    = "dp-mart-prod"
  dataset_id = google_bigquery_dataset.mart_growth.dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = "group:analysts@example.com"
}
```

이 두 규칙의 효과는 편의가 아니라 거버넌스다. 권한 변경이 전부 PR로 들어오므로 "누가 왜 이 접근을 얻었는가"가 리뷰 기록으로 남고, 감사 때 IAM 현황을 코드 저장소에서 재구성할 수 있다. 그룹은 인사 시스템과 동기화해 두면 퇴사·이동 시 권한 회수가 자동으로 따라온다. 이때 Terraform 자체가 새로운 특권 경로가 된다는 점을 놓치면 안 된다. state 버킷과 CI의 배포 서비스 계정은 사실상 전 데이터셋의 관리자이므로, state 버킷 접근과 CI 파이프라인 수정 권한은 IAM 부여만큼 좁게 관리해야 한다. IaC를 도입하면 권한 관리 문제가 사라지는 것이 아니라 "IaC를 관리할 권한" 문제로 치환된다.

파이프라인 쪽도 같은 원칙이다. 서비스 계정을 파이프라인 단위로 쪼개서(적재용, 변환용, 서빙용) 각각 필요한 데이터셋에만 붙이면, 자격 증명 하나가 탈취됐을 때의 피해 반경이 그 파이프라인이 만지는 범위로 줄어든다. 서비스 계정 간 impersonation을 쓰는 경우 감사 로그의 위임 체인(delegation info)까지 봐야 실제 행위자를 추적할 수 있다는 것도 함께 적어 둔다. 세부적인 역할 설계는 [[/cloud/01_how_to_operate_iam_well]]에서 다뤘으므로 여기서는 반복하지 않는다.

무엇을 쓰든 남는 핵심. 권한·비용·오너십이 귀속될 경계를 데이터보다 먼저 설계하고, 통제 장치는 통제 대상과 다른 경계에 두고, 금지 사항은 상위 계층 정책으로 상속시키고, 접근 통제와 반출 통제를 별개 층으로 취급한다. AWS라면 계정 분리·SCP·VPC 엔드포인트 정책이, Databricks라면 워크스페이스·Unity Catalog 경계가 같은 역할을 한다.

## 오너 없는 테이블은 만들 수 없게 한다

위 Terraform에서 `labels`에 owner, tier, pii를 넣은 것은 장식이 아니다. [[/data-governance/01_metadata_management]]에서 비즈니스 메타데이터는 사람이 채우는 수밖에 없고, 자발적 입력에 맡기면 채워지지 않는다고 했다. GCP에서 이를 강제하는 가장 값싼 지점이 Terraform CI다. plan 결과를 정책 검사기(Conftest 같은 OPA 계열이 흔하다)에 통과시켜, 필수 라벨이 빠진 리소스는 머지 자체를 거부한다.

```rego
deny[msg] {
  input.resource_type == "google_bigquery_dataset"
  not input.values.labels.owner
  msg := sprintf("%s: owner 라벨이 없어 생성할 수 없습니다", [input.name])
}
```

여기서 라벨과 카탈로그 메타데이터의 역할 분담을 정확히 해 둘 필요가 있다. GCP 라벨은 소문자 제한이 있는 단순 문자열 키-값이고 스키마도 검증도 없다. 대신 billing export와 `INFORMATION_SCHEMA`에서 바로 조인되므로 비용 귀속과 자동화 규칙의 키로는 라벨이 맞다. 반면 "이 테이블의 SLA는 무엇이고 어느 용어집 항목과 연결되는가" 같은 구조화된 비즈니스 메타데이터는 라벨로 감당이 안 되고, Dataplex 카탈로그의 aspect(구 tag template 계열의 후신으로, 스키마와 필수 필드 검증을 가진 메타데이터 구조체다)로 붙인다. 요약하면 기계가 조인할 것은 라벨에, 사람이 읽고 검색할 것은 aspect에 넣고, 둘 다 생성 경로에서 강제한다. 이 구분 없이 모든 것을 라벨에 욱여넣으면 라벨 키가 수십 개로 늘어나며 관리 불능이 된다.

강제는 생성 경로에 걸었지만, 우회는 언제나 생긴다. 급한 김에 콘솔에서 만든 데이터셋, 노트북에서 `CREATE TABLE`로 만든 중간 산출물이 그렇다. 그래서 강제 옆에 감시를 한 쌍으로 붙인다. 감시는 두 종류가 필요하다. 하나는 메타데이터 드리프트로, `INFORMATION_SCHEMA`에서 라벨 없는 데이터셋을 주기적으로 골라내 생성자에게 알림을 보내는 스케줄 쿼리다.

```sql
SELECT s.schema_name
FROM `dp-mart-prod.region-us`.INFORMATION_SCHEMA.SCHEMATA s
LEFT JOIN `dp-mart-prod.region-us`.INFORMATION_SCHEMA.SCHEMATA_OPTIONS o
  ON s.schema_name = o.schema_name AND o.option_name = 'labels'
WHERE o.option_value IS NULL OR o.option_value NOT LIKE '%owner%';
```

다른 하나는 구성 드리프트다. 누군가 콘솔에서 IAM을 직접 고치면 코드와 실제가 어긋나는데, 이것은 스케줄된 `terraform plan -detailed-exitcode`가 잡는다. plan에 diff가 있다는 것 자체가 "코드 밖에서 변경이 있었다"는 알림이고, 주기적 apply로 원복하는 조직도 있다. 원복까지 갈지는 조직 선택이지만, 최소한 diff 알림은 있어야 "Terraform으로만 부여한다"는 규칙이 검증 가능한 문장이 된다.

카탈로그 쪽은 반대로 자동에 맡긴다. Dataplex 카탈로그는 BigQuery의 테이블·스키마 같은 기술 메타데이터를 자동으로 수집하므로, 사람이 할 일은 검색 인벤토리를 만드는 것이 아니라 위에서 강제한 메타데이터가 검색 결과에 노출되게 두는 것뿐이다. 테이블과 컬럼의 `description`도 같은 원리로 다룬다. dbt를 쓴다면 모델 yml의 description이 `persist_docs` 설정으로 BigQuery까지 내려가므로, 문서는 코드 옆에 두면서 카탈로그도 채워진다. 자동으로 모이는 것은 자동에 맡기고, 자동으로 안 모이는 것만 생성 시점에 강제한다는 분업이다.

무엇을 쓰든 남는 핵심. 메타데이터 문제의 답은 카탈로그 도입이 아니라 리소스 생성 경로에 필수 입력을 심는 것이고, 그 옆에 메타데이터 드리프트와 구성 드리프트 감시를 한 쌍으로 둔다. 기계가 조인할 메타데이터와 사람이 읽을 메타데이터는 저장 위치를 다르게 가져간다.

## 분류 태그가 실제로 읽기를 막게 한다

소스에 섞여 들어온 개인정보를 다룰 차례다. GCP에서 컬럼 수준 분류는 taxonomy와 policy tag로 한다. 절차는 세 단계다. `dp-governance` 프로젝트에 taxonomy를 만들고 그 안에 `pii-high`, `pii-low` 같은 태그를 정의한다. 태그를 컬럼 스키마에 부착한다. 태그별로 읽을 수 있는 그룹(Fine-Grained Reader)을 부여한다. taxonomy는 계층 구조를 지원해서 상위 태그에 준 읽기 권한이 하위 태그로 상속되므로, 권한은 상위에서 넓게 주지 말고 말단 태그에 줘야 의도치 않은 상속을 피한다. 등급 수는 서너 개를 넘기지 않는다. 부착하는 사람이 10초 안에 판단 못 하는 체계는 현장에서 죽는다. 분류 체계 설계 자체는 [[/data-governance/05_data_classification_and_access_control]]에서 따로 다룬다.

이 세팅이 끝나면 분류는 문서가 아니라 동작이 된다.

```
SELECT email FROM `dp-curated-prod.crm.users`;
-- Access Denied: User does not have permission to access
-- column crm.users.email which has a policy tag
```

완전 차단이 과하면 태그에 데이터 마스킹 규칙을 걸어 권한 없는 사용자에게는 변형된 값이 보이게 한다. 마스킹 방식은 요건에 따라 고른다. 해시(SHA-256)는 원문을 감추면서 같은 입력이 같은 출력이 되므로 조인 키와 `COUNT(DISTINCT)`가 살아 있고, NULL 치환이나 기본값 치환은 존재 자체를 지우고, 뒤 네 자리 노출 같은 부분 마스킹은 CS 검증 용도에 맞는다. 분석가 대부분에게 해시 마스킹을 기본으로 주고 원문이 필요한 소수(CS 조회, 규제 보고)에만 Fine-Grained Reader를 주는 구성이 실무 균형점이 되는 경우가 많다. 단, 결정적 해시는 입력 공간이 좁은 값(전화번호, 생년월일)에 대해 전수 대입으로 역산될 수 있다. 이 약점과 대응(키 있는 해시)은 05에서 자세히 다루는데, GCP의 관리형 마스킹을 쓸지 변환 단계에서 직접 키 있는 가명화를 할지는 이 위협 모델을 보고 결정해야 한다.

여기까지가 기능의 동작이고, 다음은 이 집행이 새는 지점이다. 컬럼 수준 보안은 쿼리 시점에 원본 컬럼에 대해 집행된다. 그런데 데이터 플랫폼의 일상은 파생이다. Fine-Grained Reader 권한을 가진 변환 파이프라인이 `CREATE TABLE AS SELECT`로 만든 결과 테이블에는 원본의 policy tag가 자동으로 따라가지 않는다. 태그는 원본에 남고, 값은 태그 없는 사본으로 흘러간 것이다. 컬럼 차단을 원본에만 걸어 놓고 안심하는 조직의 실제 노출면은 태그 없는 파생 테이블들이다. 대응은 두 방향을 병행하는 것이다. 구조적으로는 [[/data-governance/03_data_lifecycle_and_deletion]]의 PII 격리 설계로 민감 컬럼이 파생 경로에 아예 흘러가지 않게 만들고(마스킹된 값이나 대리 키만 하류로 보낸다), 탐지적으로는 계보를 따라 태그를 전파하거나 Sensitive Data Protection(구 DLP) 스캔을 파생 데이터셋에도 주기적으로 돌려 태그 누락을 잡는다. SDP 스캔은 전체 테이블이 아니라 표본 추출로 돌려 비용을 잡고, 탐지 결과는 자동 태깅이 아니라 태그 후보로 사람 확정 큐에 넣는 것이 오탐 관리에 낫다.

내보내기도 같은 성질의 구멍이다. 원문 읽기 권한이 있는 사용자의 `EXPORT DATA`나 클라이언트 추출에는 마스킹이 없다. 컬럼 수준 보안의 보호 범위는 "권한 없는 사용자의 쿼리"까지고, 권한 있는 사용자가 만든 사본부터는 앞 절의 반출 통제(VPC-SC)와 05의 수명 관리 문제로 넘어간다. 각 통제의 보호 범위가 어디서 끝나는지를 문장으로 적어 두는 것이 거버넌스 문서에서 가장 값어치 있는 부분이다.

무엇을 쓰든 남는 핵심. 분류는 태그가 실제 거부·마스킹을 일으킬 때만 유지되는데, 그 집행은 원본에서만 성립하고 파생·내보내기에서 증발한다. 그래서 컬럼 차단은 격리 설계·태그 전파·주기 스캔과 한 세트로만 완성된다. Lake Formation의 태그 기반 제어든 Unity Catalog의 마스킹이든 이 파생 전파 문제는 똑같이 물어야 한다.

## 검사 실패가 배포를 멈추게 한다

품질 검사는 [[/data-governance/02_data_quality_and_contracts]]의 원칙을 그대로 가져온다. 검사 결과가 사람 눈이 아니라 파이프라인의 제어 흐름에 연결되어야 한다는 것이다. GCP에서 게이트를 걸 지점은 셋이다.

첫째, 적재 전이다. 소스에서 오는 데이터가 계약과 다르면 웨어하우스에 들어오기 전에 막는다. Pub/Sub 스키마 검증, 적재 잡의 스키마 드리프트 검사가 이 지점이고, dbt를 쓴다면 model contract(`enforced: true`)로 모델의 산출 스키마 자체를 빌드 시점에 검증할 수 있다. 02에서 말한 데이터 계약의 집행 지점이다.

둘째, 변환 후 공개 전이다. 여기서 실무 수준을 가르는 것이 Write-Audit-Publish 패턴이다. 변환 결과를 소비자가 보는 테이블에 바로 쓰지 않고 스테이징 데이터셋에 쓴 뒤, 검사를 통과하면 그때 공개 위치로 승격한다. BigQuery에서는 승격을 뷰 전환이나 table clone(제로 카피라 대형 테이블도 승격 비용이 없다)으로 구현할 수 있다. 이 패턴이 없으면 "검사 실패가 하류를 멈춘다"가 실제로는 "불량 데이터가 이미 서빙되는 중에 알림이 온다"가 된다. dbt test를 쓴다면 severity를 구분해서 error는 승격 차단, warn은 기록만 하게 하고, `store_failures`로 실패 행을 테이블에 남겨 두면 사고 조사가 "쿼리 다시 돌려 보기"가 아니라 실패 표본 조회로 줄어든다.

셋째, 서빙 중이다. 게이트는 배포 시점의 상태만 보증하므로, 서빙 중인 테이블의 신선도·볼륨 이상은 별도 감시가 필요하다. dbt 밖에서 적재되는 테이블에는 Dataplex의 데이터 품질 스캔을 스케줄로 걸고, 규칙은 02의 다섯 차원과 같은 어휘로 선언한다.

```yaml
rules:
  - column: status
    nonNullExpectation: {}
  - column: status
    setExpectation:
      values: [PAID, REFUNDED, PARTIALLY_REFUNDED, CANCELLED]
```

검사가 실패했을 때 누구에게 가는지도 설정의 일부다. 스캔 결과를 BigQuery로 내보내고 실패 알림을 owner 라벨의 팀 채널로 라우팅하면, 첫 절에서 강제한 메타데이터가 사고 대응 경로로 회수된다. 알림 라우팅에 오너 정보가 없으면 모든 품질 알림이 플랫폼 팀 채널 하나에 쌓이고, 몇 주 안에 아무도 안 보는 채널이 된다. 결과 테이블은 집계 대상이기도 하다. 데이터셋별 통과율을 tier 라벨과 조인하면 "gold 등급인데 검사가 하나도 없는 테이블" 같은 거버넌스 부채 목록이 쿼리 한 번으로 나온다.

무엇을 쓰든 남는 핵심. 게이트는 적재 전·공개 전·서빙 중의 세 지점에 걸고, 공개 전 게이트는 Write-Audit-Publish로 구현해야 "멈춘다"가 사실이 된다. 검사 실패는 반드시 오너에게 귀속시킨다.

## 계보와 사용 기록은 로그에서 수확한다

계보를 사람이 그리게 하면 유지되지 않는다는 것이 01의 결론이었다. GCP에서 계보는 실행 로그의 부산물로 얻는다. Dataplex의 lineage를 켜면 BigQuery에서 실행된 쿼리로부터 테이블 수준 계보가 자동 수집되고 Composer·Dataflow 연동도 제공된다. 한계도 알고 써야 한다. 자동 수집의 기본 단위는 테이블 수준이라, 삭제 요청 대응이나 태그 전파에 필요한 컬럼 수준 계보는 별도 문제다. dbt manifest의 모델 의존성과 SQL 파서(sqlglot 계열) 기반의 컬럼 계보 추출을 결합해 메꾸는 것이 현재의 현실적인 조합이고, 이 영역은 도구 성숙도가 빠르게 변하므로 단정하지 않는다.

접근 기록은 감사 로그에서 나온다. 데이터 접근 감사 로그(Data Access audit logs)를 로그 싱크로 `dp-governance`의 BigQuery 데이터셋에 적재해 두면 "누가 언제 어느 테이블을 읽었는가"가 쿼리 대상이 된다. 이 로그의 BigQuery 항목(BigQueryAuditMetadata)에는 잡이 참조한 테이블 목록이 구조화되어 들어 있어서, 유출 조사에서 "그 컬럼이 든 테이블을 지난달에 읽은 계정 목록"을 뽑는 원천이 된다. 볼륨이 크므로 싱크 대상 테이블은 일자 파티션과 보존 만료를 걸어 두고, 민감 데이터를 다루는 순간부터 이 싱크는 선택이 아니라 전제다.

당장 오늘부터 쓸 수 있는 가장 값싼 도구는 `INFORMATION_SCHEMA`다.

```sql
SELECT user_email, COUNT(*) AS query_count
FROM `dp-mart-prod.region-us`.INFORMATION_SCHEMA.JOBS
WHERE creation_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
  AND EXISTS (
    SELECT 1 FROM UNNEST(referenced_tables) t
    WHERE t.table_id = 'daily_signups'
  )
GROUP BY user_email
ORDER BY query_count DESC;
```

이 쿼리는 스키마 변경 영향 범위, [[/data-governance/03_data_lifecycle_and_deletion]]의 폐기 후보(90일 조회 0건), 민감 컬럼의 실사용자 규모에 동시에 답한다. 다만 이 결과를 읽을 때 반드시 보정해야 할 사각지대가 있다. BI 도구가 공용 서비스 계정으로 쿼리하는 구성(Looker Studio에서 소유자 자격 증명으로 공유된 대시보드가 전형이다)에서는 `user_email`이 전부 그 서비스 계정 하나로 찍힌다. 대시보드 뒤의 수백 명 소비자가 사용 기록에서 한 명으로 뭉개지는 것이다. 이 상태에서 "조회 0건이니 폐기"를 실행하면 살아 있는 대시보드의 원천을 지우게 된다. 대응은 BI 도구를 뷰어 자격 증명 모드로 돌리거나, 그것이 안 되면 BI 도구 쪽 사용 로그를 별도로 수집해 조인하는 것이다. 사용 기록 기반 의사결정을 하기 전에, 사용 기록이 최종 소비자를 보고 있는지부터 검증해야 한다.

무엇을 쓰든 남는 핵심. 계보와 사용 통계는 실행 기록의 부산물로 수확하되, 수확물의 해상도(테이블 수준인가 컬럼 수준인가)와 사각지대(서비스 계정 뒤의 실사용자)를 알고 써야 한다. 로그가 안 보는 곳에서 내린 폐기·영향도 판단은 로그가 없는 것보다 위험하다.

## 보존 숫자를 스토리지 설정에 옮긴다

[[/data-governance/03_data_lifecycle_and_deletion]]의 보존 정책을 집행 계층에 내린다. 원칙은 하나다. 정책 문서에 적힌 기한과 스토리지에 설정된 기한이 같은 코드에서 나와야 한다.

```hcl
resource "google_bigquery_dataset" "raw_events" {
  project    = "dp-raw-prod"
  dataset_id = "raw_events"
  default_partition_expiration_ms = 34560000000  # 400일
}

resource "google_storage_bucket" "landing" {
  name     = "dp-raw-prod-landing"
  location = "US"
  lifecycle_rule {
    condition { age = 400 }
    action    { type = "Delete" }
  }
}
```

데이터셋 기본값으로 걸어 두면 그 아래 새로 생기는 파티션 테이블이 만료를 상속하므로 테이블마다 기억할 필요가 없다. 세부 의미는 정확히 알아야 한다. 파티션 만료는 파티션의 기준 시각(컬럼 파티셔닝이면 그 컬럼 값, 적재 시각 파티셔닝이면 적재 시각) 기준으로 계산되므로, 과거 날짜를 백필하면 적재 직후에 만료 대상이 될 수 있다. 백필이 잦은 테이블이라면 파티셔닝 기준과 만료 정책을 함께 설계해야 사고가 없다.

삭제의 완료 시점 계산에는 눈에 안 보이는 잔존이 세 겹 있다. 첫째, time travel이다. 삭제·만료된 데이터는 기본 7일(데이터셋별로 2~7일 조정 가능) 동안 복구 가능하게 유지된다. 둘째, 그 뒤에 fail-safe 기간이 추가로 붙는다. 이 구간은 사용자가 접근할 수 없고 지원 요청으로만 복구되지만 물리적으로는 남아 있는 상태다. 셋째, 백업·스냅샷은 자체 보존 주기를 따른다. 그래서 개인정보 삭제 기한을 약정할 때는 "DELETE 실행일"이 아니라 "실행일 + time travel + fail-safe + 백업 순환"이 완료 시점이고, 이 합계가 법정 기한을 넘으면 구조를 바꿔야 한다. 구조를 바꾸는 방법이 03에서 다룬 crypto-shredding이다. 데이터셋을 CMEK(고객 관리 키)로 암호화해 두면 키 버전 폐기로 잔존 사본 전체를 한 번에 무력화하는 경로가 열린다. 단 CMEK는 키 관리 실수가 곧 데이터 전손이라는 반대 방향 리스크를 만들므로, 키 폐기에는 IAM 부여보다 무거운 승인 절차를 걸어야 한다.

한 가지 더, time travel 창은 비용과도 얽힌다. 뒤 절에서 말할 물리 스토리지 과금을 선택하면 time travel·fail-safe 구간의 바이트도 과금에 잡히므로, 변경이 많은 테이블에서 time travel 창을 7일로 넓게 잡는 결정은 보존 정책이면서 동시에 비용 결정이다. 보존 창 설정 하나가 규제 대응과 청구서 양쪽에 걸쳐 있다는 것을 알면, 이 값을 팀 임의 설정이 아니라 거버넌스 표준으로 관리해야 하는 이유가 분명해진다.

무엇을 쓰든 남는 핵심. 보존은 저장 계층에 선언해 두는 설정이어야 하고 그 선언이 IaC에 있어야 정책 변경이 리뷰를 거친다. 삭제 완료 시점은 엔진의 복구 창과 백업 순환을 전부 합산해 계산하고, 그 합계가 기한을 넘으면 crypto-shredding으로 구조를 바꾼다.

## 비용 귀속도 거버넌스다

비용은 보통 거버넌스 논의에서 빠지지만, 실무에서는 정리 인센티브의 원천이라 넣는 편이 낫다. 청구 데이터 내보내기(billing export)를 BigQuery로 켜면 앞에서 강제한 라벨별로 스토리지·컴퓨트 비용이 쪼개지고, "이 마트의 월 유지비"가 오너 팀 앞으로 청구서처럼 나온다.

컴퓨트 쪽은 잡 단위 귀속이 필요하다. `INFORMATION_SCHEMA.JOBS`의 `total_bytes_billed`를 집계하되, 사용자 축만으로는 부족하다. 파이프라인 비용은 전부 서비스 계정으로 찍히기 때문이다. 그래서 잡에 라벨을 심는다. dbt는 설정으로 잡 라벨에 모델·프로젝트 정보를 실어 보낼 수 있어서, 이걸 켜 두면 "모델별 월간 슬롯 비용"이 집계 가능해지고, 리팩터링 대상 선정이 감이 아니라 쿼리가 된다.

```sql
SELECT l.value AS dbt_model,
       ROUND(SUM(total_bytes_billed) / POW(1024, 4), 2) AS tib_billed
FROM `dp-mart-prod.region-us`.INFORMATION_SCHEMA.JOBS, UNNEST(labels) l
WHERE creation_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
  AND l.key = 'dbt_model_name'
GROUP BY dbt_model
ORDER BY tib_billed DESC;
```

방어 장치도 몇 가지 층이 있다. 잡 단위로는 `maximum_bytes_billed`를 걸어 풀스캔 사고를 잡에서 차단하고(dbt profile에 박아 두면 전 모델에 적용된다), 사용자 단위로는 일일 쿼리 바이트 커스텀 쿼터로 폭주를 막고, 조직 단위로는 온디맨드와 용량 예약(reservation) 사이의 선택이 있다. 예약으로 가면 비용이 예측 가능해지는 대신 슬롯 경합이라는 새 거버넌스 문제(어느 팀 워크로드가 슬롯을 점유하는가)가 생기므로, 워크로드별 reservation 분리와 우선순위가 표준의 일부가 된다. 스토리지 쪽은 데이터셋별 논리/물리 과금 선택이 있는데, 압축이 잘 되는 데이터는 물리 과금이 크게 싸지만 위에서 말했듯 time travel 바이트가 포함되므로, 대략 압축률과 변경률을 놓고 데이터셋 단위로 판단할 일이다.

효과는 두 방향이다. 03의 안 쓰는 테이블 폐기가 "언젠가 할 일"에서 "이번 분기 비용 절감 항목"으로 바뀌고, 고비용 쿼리는 사전 차단된다. 거버넌스 규칙에 협조를 요청하는 것보다 비용이 자기 팀에 귀속되게 만드는 쪽이 행동을 빨리 바꾼다.

무엇을 쓰든 남는 핵심. 비용 귀속의 해상도는 라벨 설계가 결정한다. 사람 축(사용자), 시스템 축(잡 라벨), 자원 축(리소스 라벨)을 처음부터 맞춰 두면 비용이 거버넌스의 집행 도구가 된다.

## 기존 환경에 소급 적용하기

여기까지는 새 환경이라 순서가 깨끗했다. 이미 수백 개 테이블이 돌아가는 환경이라면 같은 순서로 못 간다. 전수 조사로 시작하면 라벨링 백로그만 쌓이다 동력이 죽는 것이 정해진 코스다. 현실적인 순서는 거의 역순이다.

먼저 로그 수확부터 켠다. lineage, 감사 로그 싱크, `INFORMATION_SCHEMA` 스케줄 쿼리는 기존 테이블을 하나도 안 건드리고 켤 수 있고, 켜는 순간부터 "무엇이 중요하고 무엇이 죽어 있는가"라는 지도가 생긴다. 다음으로 그 지도에서 상위를 친다. 사용량 상위 테이블과 PII 포함 테이블(SDP 표본 스캔으로 찾는다)에만 owner·tier·pii를 채운다. 전체의 1~2할이지만 리스크와 가치의 대부분이 여기 있다. 그다음에 신규 생성 경로에 강제를 건다. 기존 테이블은 유예하되 새로 만드는 것은 이 글의 규칙을 따르게 하면, 시간이 지날수록 정리된 영역이 자연히 넓어진다. 마지막으로 롱테일은 폐기 사이클로 줄인다. 90일 조회 0건 목록을 분기마다 돌려 롱테일 자체를 없애는 것이 롱테일을 라벨링하는 것보다 싸다.

진행 상황은 스코어보드로 관리한다. 오너 라벨 커버리지, PII 스캔 커버리지, 품질 검사가 있는 gold 테이블 비율 같은 지표를 대시보드로 만들되, 테이블 개수가 아니라 쿼리량 가중으로 계산해야 한다. 아무도 안 쓰는 테이블 천 개를 라벨링해서 커버리지 90%를 만드는 것은 자기기만이고, 쿼리량 가중 커버리지는 그 속임수가 통하지 않는다. 지표 설계가 행동을 결정한다는 이 논점은 [[/data-governance/06_ownership_and_operating_model]]에서 다시 다룬다.

무엇을 쓰든 남는 핵심. 소급 적용은 전수 정리가 아니라 관측 먼저, 중요 자산 우선, 신규부터 차단, 롱테일은 폐기의 순서이고, 진척은 개수가 아니라 사용량 가중으로 잰다.

## 무엇을 쓰든 남는 것

단계를 GCP 구현과 분리해서 다시 적으면 이렇다.

| 단계 | GCP에서 한 일 | 옮겨 갈 핵심 |
|------|--------------|-------------|
| 경계 | 프로젝트·거버넌스 프로젝트 분리, 조직 정책 상속, VPC-SC, IaC 전용 부여 | 귀속 단위 먼저, 통제 장치는 별도 경계, 접근·반출 통제는 별개 층 |
| 메타데이터 | 필수 라벨 + aspect, CI 정책 검사, 이중 드리프트 감시 | 생성 경로 강제 + 우회 감시, 기계용·사람용 메타데이터 분리 |
| 분류·접근제어 | policy tag 차단·마스킹, SDP 스캔, 파생 태그 전파 | 집행은 원본에서만 성립, 격리·전파·스캔과 한 세트 |
| 품질 | 3중 게이트, Write-Audit-Publish, 오너 라우팅 | 공개 전 게이트가 있어야 "멈춘다"가 사실이 된다 |
| 계보·사용 | lineage + 감사 로그 싱크 + INFORMATION_SCHEMA | 로그 부산물로 수확하되 해상도와 사각지대를 안다 |
| 수명주기 | 만료 IaC 선언, time travel·fail-safe 합산, CMEK | 삭제 완료 시점은 복구 창까지 합산, 안 되면 키 폐기 |
| 비용 | billing export, 잡 라벨, bytes 상한·쿼터·예약 | 3축 라벨 설계가 비용을 집행 도구로 만든다 |
| 소급 적용 | 로그부터, 상위 자산 우선, 사용량 가중 스코어보드 | 관측·우선순위·차단, 진척은 사용량 가중으로 |

서비스 이름의 수명은 짧다. 이 글에서 카탈로그라고 부른 것만 해도 Data Catalog라는 독립 제품이었다가 Dataplex로 흡수됐고, tag template이 aspect로 바뀌었으며, 몇 년 뒤 명칭이 또 바뀌어도 이상하지 않다. 남는 것은 가운데 열이 아니라 오른쪽 열이다. 그리고 오른쪽 열의 절반은 "무엇을 켜는가"가 아니라 "켠 것이 어디서 새는가"에 대한 문장이라는 점이 이 글에서 가져갈 것의 요체다. 어떤 스택을 쓰든 집행 지점의 목록과 각 집행의 보호 범위가 끝나는 지점을 함께 말할 수 있으면, 그 환경의 거버넌스는 문서가 아니라 시스템이다.

## 한계

GCP 서비스, 특히 Dataplex 계열은 명칭과 기능 변화가 빠른 영역이다. 이 글의 설정과 명령은 2026년 중반 기준이고, deny 정책의 지원 범위·마스킹 규칙의 종류·lineage의 커버리지 같은 세부는 달라질 수 있으므로 실제 적용 전에 공식 문서를 확인해야 한다. VPC-SC와 CMEK는 도입 비용이 실질적이라 개인정보 취급 규모가 작은 조직에는 과할 수 있고, 서너 명이 쓰는 플랫폼이라면 경계 설계와 보존 만료 두 가지만 해도 대부분의 사고를 막는다.

그리고 이 글의 어떤 설정도 오너십을 대신하지 못한다. owner 라벨에 적힌 팀명이 실제로 질문에 답하고 장애에 대응하는 팀인지는 도구가 아니라 운영 모델의 문제다. 분류 체계와 접근 제어의 설계는 [[/data-governance/05_data_classification_and_access_control]]에서, 오너십과 운영 모델은 [[/data-governance/06_ownership_and_operating_model]]에서 이어서 다룬다.
