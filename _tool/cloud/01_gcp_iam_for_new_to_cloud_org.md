---
layout      : tool
title       : 클라우드가 처음인 조직에서 GCP IAM 잘 관리하기
date        : 2026-07-07 00:00:00 +0900
updated     : 2026-07-07 00:00:00 +0900
tag         : cloud gcp iam governance least-privilege
toc         : true
comment     : true
latex       : true
status      : complete
public      : true
parent      : [[/cloud]]
confidence  : high
relations:
  - { type: references, target: concept/cloud/01_how_to_operate_iam_well }
  - { type: references, target: concept/cloud/02_authenticate_gcp_without_service_accounts }
---

* TOC
{:toc}

> IAM 기술 원칙(최소 권한·그룹·키리스·감사)은 [클라우드 서비스 계정 관리 철칙](/concept/cloud/01_how_to_operate_iam_well)에 정리돼 있다. 이 문서는 그 원칙을 **아는 것과 별개의 문제** — 클라우드 운영 경험이 없는 조직이 GCP IAM을 처음부터 망치지 않게 까는 **순서와 성숙도별 도입 경로**를 다룬다. 원칙은 저 문서에, 여기서는 "무엇을 먼저, 무엇을 아직 하지 말 것인가"에.

## 미성숙 조직이 IAM을 망치는 6가지 실패 패턴

경험 없는 조직의 실패는 기술 지식 부족이 아니라 **순서와 소유권 부재**에서 온다. 거의 항상 아래로 시작한다.

| 실패 패턴 | 왜 생기나 | 나중에 치르는 비용 |
|-----------|-----------|-------------------|
| 아무도 IAM을 소유하지 않음 | "일단 되게" 급하니까 | 권한 요청마다 즉흥 대응 → 일관성 붕괴 |
| 급하니까 `Owner`/`Editor`를 뿌림 | basic role이 제일 간단해서 | 전원이 결제·삭제 권한 보유, 회수 불가능 |
| 개인 Gmail로 접근 | 조직(Organization) 노드가 없어서 | 퇴사자 접근 차단 불가, 감사 대상 불명 |
| SA JSON 키를 Slack·이메일로 공유 | 키리스를 몰라서 | 만료 없는 비밀번호가 채팅 로그에 영구 잔존 |
| 리소스 계층 없이 프로젝트 난립 | 계층을 나중에 생각 | 폴더로 묶어 정책 걸기가 사후엔 매우 어려움 |
| predefined 대신 basic role로 즉답 | 어떤 predefined인지 찾기 귀찮아서 | 최소 권한 원칙이 첫날부터 무너짐 |

핵심 진단: **이 조직에 필요한 건 고급 기능이 아니라 되돌리기 어려운 것부터 순서대로 까는 것**이다. custom role·IAM Conditions·VPC-SC를 미성숙 조직에 얹으면 운영을 못 해서 오히려 우회(shadow IT)가 생긴다.

## 0. 가장 먼저 — 리소스 계층을 세운다 (되돌리기 가장 어려움)

GCP IAM의 진짜 도구는 role이 아니라 **리소스 계층(resource hierarchy)**이다. 상위 노드의 정책이 하위로 **상속**되므로, 계층을 먼저 세워야 정책을 한 곳에서 건다. 프로젝트부터 막 만들면 나중에 폴더로 묶어 조직 정책을 거는 일이 매우 번거로워진다.

```
Organization (회사 = Cloud Identity/Workspace 도메인)
├── Folder: prod
│   ├── Project: shop-prod
│   └── Project: data-prod
└── Folder: nonprod
    ├── Project: shop-dev
    └── Project: sandbox
        (상위에 건 IAM 바인딩·조직 정책이 아래로 상속된다)
```

- [ ] **Cloud Identity(무료) 또는 Workspace로 Organization 노드를 확보했다.** 이게 없으면 개인 Gmail 프로젝트만 떠다니고, 조직 정책·도메인 제한을 걸 상위 노드 자체가 없다.
- [ ] **폴더는 최소로 시작했다.** 미성숙 조직은 `prod` / `nonprod` 2개면 충분하다. 팀별·환경별 세분화는 Walk 단계에서. 폴더를 처음부터 10개 만들면 관리 대상만 늘고 상속 이점은 못 쓴다.
- [ ] **`prod` 폴더에 강한 정책, `nonprod`에 느슨한 정책**을 거는 구조로 잡았다. 상속 덕분에 프로젝트가 늘어도 정책은 폴더 2곳에서만 관리된다.

## 1. 사람은 그룹으로만 — 개인에게 직접 부여 금지

- [ ] **Google Group으로만 역할을 부여했다.** `gcp-prod-viewers@`, `gcp-billing-admins@`, `gcp-shop-developers@`. 온보딩=그룹 추가, 오프보딩=그룹 제거. 개인에게 직접 붙이면 퇴사 때 모든 프로젝트를 뒤져야 한다(원칙 상세 → [철칙 5](/concept/cloud/01_how_to_operate_iam_well)).

```bash
# 그룹에 폴더 수준 권한 (개인이 아니라 그룹에)
gcloud resource-manager folders add-iam-policy-binding FOLDER_ID \
  --member="group:gcp-shop-developers@company.com" \
  --role="roles/container.developer"
```

## 2. 역할은 predefined로 시작 — basic role 금지, custom role은 나중

- [ ] **basic role(`roles/owner`·`roles/editor`·`roles/viewer`)을 사람·SA에 부여하지 않았다.** basic role은 수백 개 권한 묶음이라 "무엇을 할 수 있는지" 아무도 모른다. `roles/editor`는 결제 빼고 거의 다 된다 — 미성숙 조직이 가장 흔히 저지르는 실수.
- [ ] **predefined role로 충분히 좁게 시작했다.** `roles/container.developer`, `roles/bigquery.dataViewer`, `roles/logging.viewer`처럼 서비스별 predefined면 초기엔 충분하다. **custom role은 Run 단계로 미룬다** — 커스텀 역할 운영(권한 목록 유지·리뷰)은 성숙한 팀도 부담이다. 없는 조직에 강요하면 오히려 basic role로 후퇴한다.
- [ ] **`roles/owner`는 조직 관리자 극소수 + break-glass 계정에만** 남겼다(§4).

## 3. 조직 정책(Org Policy)으로 바닥에 안전망을 깐다 — 레버리지 최고

미성숙 조직은 사람이 실수한다. **실수해도 막히도록** 조직 노드에 가드레일을 건다. 조직 정책은 상속되므로 한 번 걸면 모든 프로젝트에 적용된다. 처음 깔아야 할 최소 세트:

| 제약(constraint) | 효과 | 우선순위 |
|------------------|------|----------|
| `iam.disableServiceAccountKeyCreation` | SA 키 생성 원천 차단 → Slack 유출 불가 | 필수 |
| `iam.allowedPolicyMemberDomains` | 외부 도메인(개인 gmail) 공유 차단 | 필수 |
| `iam.automaticIamGrantsForDefaultServiceAccounts` | 기본 SA에 `Editor` 자동 부여 차단 | 필수 |
| `storage.uniformBucketLevelAccess` | 버킷 ACL 혼란 제거, IAM으로 통일 | 권장 |
| `compute.requireOsLogin` | SSH 키 난립 대신 IAM 기반 로그인 | 권장 |
| `gcp.resourceLocations` | 데이터 저장 리전 강제(규제 대비) | 선택 |

```bash
# 조직 전체에 SA 키 생성 차단 (boolean 제약)
gcloud resource-manager org-policies enable-enforce \
  iam.disableServiceAccountKeyCreation \
  --organization=ORGANIZATION_ID

# 우리 도메인 밖으로의 IAM 공유 차단 (list 제약: Cloud Identity 고객 ID 필요)
gcloud resource-manager org-policies allow \
  iam.allowedPolicyMemberDomains \
  C0xxxxxxxx \
  --organization=ORGANIZATION_ID
```

<div class="callout-warning">
`iam.allowedPolicyMemberDomains`를 걸면 외부 파트너·개인 계정 공유가 즉시 막힌다. 이미 외부 협업이 있다면 예외 도메인을 먼저 목록에 넣고 적용한다 — 안 그러면 운영 중인 접근이 끊긴다.
</div>

## 4. break-glass 관리자를 분리한다

- [ ] **일상 업무 계정은 `roles/owner`·Organization Admin이 아니다.** 최고 권한은 **비상용(break-glass) 계정**에만 둔다: 하드웨어 보안 키 2FA, 평소 미사용, 로그인 시 알림, 자격증명은 오프라인 봉인 보관.
- [ ] **세 종류 관리자를 구분했다.** ① Organization Admin(계층·정책), ② 프로젝트 Owner(비상용만), ③ **Billing Account Administrator(결제)** — 결제 권한은 리소스 권한과 반드시 분리한다. 미성숙 조직은 이 셋을 한 계정에 몰아 두는데, 그 계정이 뚫리면 회사 전체가 넘어간다.

## 5. 감사는 사람이 아니라 도구가 하게 한다

미성숙 조직은 정기 수동 리뷰를 **못 한다**(안 한다). 자동 도구에 맡기고 분기 1회 클릭만 한다.

| 도구 | 용도 | 미성숙 조직 사용법 |
|------|------|-------------------|
| IAM Recommender | 90일 미사용 권한 축소 추천 | 분기 1회 추천 목록 확인 후 적용 |
| Policy Analyzer | "누가 이 권한을 갖고 있나" 조회 | 사고 시 영향 범위 파악 |
| Policy Troubleshooter | "왜 접근되나/안 되나" 디버깅 | 권한 문의 대응(추측 대신 조회) |
| Cloud Audit Logs | Admin Activity(기본 on) + Data Access(선택 on) | 로그 버킷으로 라우팅만 걸어둠 |

```bash
# 접근 문의가 오면 추측하지 말고 조회한다 — "왜 이 계정이 이 버킷에 접근되나"
gcloud policy-troubleshoot iam \
  //cloudresourcemanager.googleapis.com/projects/PROJECT_ID \
  --principal-email=user@company.com \
  --permission=storage.objects.get
```

IAM Recommender로 과도한 권한을 좁히는 명령은 [철칙 7](/concept/cloud/01_how_to_operate_iam_well)에 있다 — 중복이라 여기서는 생략한다.

## 6. 성숙도별 도입 로드맵 — 한 번에 다 하지 마라

가장 중요한 판단: **조직의 운영 역량에 맞는 것만 켠다.** Run 단계 기능을 Crawl 조직에 얹으면 운영 실패 → 우회 → 오히려 더 위험해진다.

| 단계 | 켜는 것 | 아직 안 켜는 것 |
|------|---------|-----------------|
| **Crawl** (첫 1개월) | 조직 노드, `prod`/`nonprod` 폴더, 그룹 3~4개, predefined role, 조직 정책 3개(§3 필수), break-glass 계정, 결제 권한 분리 | custom role, IAM Conditions, VPC-SC, WIF |
| **Walk** (1분기) | SA 워크로드별 분리, [키리스(WIF)](/concept/cloud/02_authenticate_gcp_without_service_accounts)로 키 제거, IAM Recommender 분기 리뷰, Audit Log 라우팅 | VPC-SC, IAM as code 전면화 |
| **Run** (성숙 후) | custom role, IAM Conditions(시간·리소스 조건), VPC Service Controls, Terraform으로 IAM as code, 자동 접근 리뷰 | — |

<div class="callout-info">
순서를 뒤집지 마라. custom role·Conditions·VPC-SC는 <b>강력하지만 운영 부담이 크다</b>. 이걸 감당할 인력·프로세스가 없는 조직에 먼저 깔면, 담당자가 손대기 무서워 basic role로 후퇴하거나 콘솔에서 몰래 권한을 푼다. Crawl의 조직 정책 3개가 Run의 VPC-SC보다 이 조직엔 훨씬 값지다.
</div>

## 안티패턴 → 교정

| 안티패턴 | 교정 |
|----------|------|
| 급하니까 `roles/editor` 부여 | 서비스별 predefined role. `editor`는 감사 불가능한 블랙박스 |
| 개인 Gmail로 프로젝트 접근 | Cloud Identity 조직 노드 + 그룹. 퇴사 시 그룹에서만 제거 |
| SA 키를 채팅으로 공유 | `disableServiceAccountKeyCreation` + WIF. 키 자체를 없앤다 |
| 프로젝트를 계층 없이 생성 | 폴더 먼저, 정책은 폴더에서 상속 |
| Owner 계정으로 일상 업무 | break-glass 분리, 일상은 최소 권한 |
| 사람이 분기마다 수동 권한 리뷰(→ 안 함) | IAM Recommender에 위임, 클릭만 |
| custom role부터 도입 | Crawl은 predefined, custom은 Run 단계 |

## 요약

| 순서 | 핵심 | 미성숙 조직 포인트 |
|------|------|-------------------|
| 0 | 리소스 계층 | 되돌리기 가장 어렵다 — 프로젝트보다 폴더 먼저 |
| 1 | 그룹 기반 | 개인 부여 금지, 온·오프보딩은 그룹만 |
| 2 | predefined role | basic role 금지, custom은 나중 |
| 3 | 조직 정책 3개 | 실수해도 막히는 안전망 — 레버리지 최고 |
| 4 | break-glass | 최고 권한·결제는 일상 계정과 분리 |
| 5 | 자동 감사 | 사람이 못 하니 도구에 위임 |
| 6 | 성숙도 로드맵 | Run 기능을 Crawl 조직에 얹지 마라 |

한 문장으로: **되돌리기 어려운 것(계층·조직 정책)부터 깔고, 운영 부담이 큰 것(custom role·VPC-SC)은 조직이 감당할 수 있을 때 켠다.**
