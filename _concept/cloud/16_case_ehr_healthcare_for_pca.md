---
layout      : concept
title       : PCA 케이스 스터디 EHR Healthcare (하이브리드·컨테이너·규제)
date        : 2026-07-07 00:00:00 +0900
updated     : 2026-07-07 00:00:00 +0900
tag         : cloud gcp pca certification case-study
toc         : true
comment     : true
latex       : true
status      : complete
public      : true
parent      : [[/cloud]]
confidence  : high
valid_from  : 2026-07-07
relations:
  - { type: references, target: /concept/cloud/00_pca_study_plan }
  - { type: references, target: /concept/cloud/03_vpc_for_pca }
  - { type: references, target: /concept/cloud/04_gke_for_pca }
  - { type: references, target: /concept/cloud/05_iam_for_pca }
  - { type: references, target: /concept/cloud/07_load_balancing_and_connectivity_for_pca }
  - { type: references, target: /concept/cloud/08_databases_and_storage_for_pca }
  - { type: references, target: /concept/cloud/09_security_for_pca }
  - { type: references, target: /concept/cloud/10_migration_and_dr_for_pca }
  - { type: references, target: /concept/cloud/11_operations_and_cost_for_pca }
---

* TOC
{:toc}

> [EHR Healthcare 공식 케이스](https://services.google.com/fh/files/misc/v6.1_pca_ehr_healthcare_case_study_english.pdf)(v6.1) 딥다이브. 4종 중 **정통 인프라 케이스** — colocation 탈출, 하이브리드 연결, 컨테이너 플릿, 헬스케어 규제, 관측성. GenAI 비중이 낮고 네트워킹·DB·마이그레이션·보안이 촘촘하다. 요구사항 → 서비스 매핑, 레퍼런스 아키텍처, 함정을 정리한다. 근거는 심화 문서로 링크.

---

## 케이스 한눈에

- **회사:** 의료 산업용 **전자건강기록(EHR) SaaS** 공급사. 다국적 병원·의원·보험사에 SaaS로 제공.
- **솔루션 컨셉:** 헬스케어·보험 급변으로 **기하급수 성장**. 환경 확장, DR 계획 개선, 빠른 지속배포(CD)가 필요. **Google Cloud로 colocation 대체 결정.**
- **기존 환경:** 다중 **colocation** 호스팅, **한 DC 리스 만료 임박**. 고객대면 웹앱 다수 **컨테이너화 → Kubernetes 클러스터群**. DB 혼재(**MySQL·MS SQL Server·Redis·MongoDB**). 온프레 **레거시 file/API 통합(보험사)** — 수년 내 교체 예정, **지금은 이전 계획 없음**. 사용자는 **Microsoft Active Directory**. 모니터링은 오픈소스 혼재, **알림은 이메일이라 자주 무시됨**.
- **Exec 한 줄:** 온프레는 훈련·중복 환경·장애 대응에 큰 비용. 장애 다수가 오설정·용량부족·불일치 모니터링 탓. **확장·복원력 있는 단일 일관 플랫폼**을 원한다.

> **핵심 판단 축:** "이미 X를 쓰는 중" 신호가 강하다. **DC 리스 만료 임박 → 속도·마찰 최소(리프트&시프트) 우선**, **보험사 레거시는 이전 계획 없음 → 하이브리드로 연결 유지**, **AD 유지 → 페더레이션**, **알림 무시 → 의미있는 SLO 알림**. 규제(의료) → 키 관리·경계·감사.

---

## 기존 환경 → 시사점

| 현재 | 신호 | GCP 방향 |
|------|------|---------|
| 다중 colocation, **한 DC 리스 만료 임박** | 시간 압박 | **Migrate to Virtual Machines**(rehost) 우선, 재작성 후순위. **Migration Center**로 평가·TCO |
| 웹앱 컨테이너화 → k8s 클러스터群 | 컨테이너 성숙 | **GKE** + **Fleet/Config Sync**로 다중 클러스터 일관 관리 |
| MySQL·MS SQL Server | 관리형 가능 | **Cloud SQL**(MySQL·SQL Server), 이관은 **DMS** |
| Redis | 캐시 | **Memorystore for Redis** |
| MongoDB | 관리형 없음 | **MongoDB Atlas(파트너)** 또는 GKE/CE self-managed |
| 온프레 레거시 보험사 통합, **이전 계획 없음** | 유지 대상 | **하이브리드 연결**(Interconnect/VPN), 표준화는 Apigee |
| Microsoft AD 사용자 | ID 소스 유지 | **Cloud Identity + AD 페더레이션**(GCDS/AD FS) 또는 **Managed Microsoft AD** |
| 오픈소스 모니터링, 이메일 알림 무시 | 관측 실패 | **Cloud Observability** 중앙화 + **SLO 기반 알림** |

---

## 비즈니스 요구사항 → 서비스 매핑

| # | 요구사항 | GCP 서비스 | 근거 |
|---|------|-----------|------|
| 1 | 신규 보험사 빠른 온보딩 | **Apigee**(API 표준화) + **Terraform**(IaC) + Pub/Sub·Dataflow | 반복 인터페이스 자동화 |
| 2 | 고객대면 **최소 99.9% 가용성** | 리전(멀티존) **GKE** + **Cloud SQL HA** + 글로벌 LB | 존 장애 견딤 |
| 3 | 중앙 가시성·선제 조치(성능·사용량) | **Cloud Monitoring/Logging** + SLO·알림 | "알림 무시" 문제 해결 |
| 4 | 헬스케어 트렌드 인사이트 | **BigQuery + BigQuery ML / Vertex AI** | 분석·예측 |
| 5 | 모든 고객 **지연 감소** | **Global external Application LB + Cloud CDN**, 멀티리전 | 글로벌 근접 |
| 6 | **규제 준수** | **CMEK(Cloud KMS)** + **VPC-SC** + **Assured Workloads** + **Cloud Audit Logs** | 의료 데이터 통제 |
| 7 | 인프라 관리비용↓ | 관리형·서버리스·오토스케일 | 운영 우수성 |
| 8 | 제공자 데이터로 예측·리포트 | **BigQuery ML + Looker + Vertex AI** | 산업 트렌드 리포트 |

## 기술 요구사항 → 서비스 매핑

| # | 요구사항 | GCP 서비스 | 왜 |
|---|------|-----------|-----|
| 1 | 레거시 인터페이스 유지 + **온프레·클라우드 양쪽** 연결 | 하이브리드 네트워킹(**HA VPN/Interconnect**) + **Network Connectivity Center**(이행 라우팅) | 온프레·타 클라우드 동시 |
| 2 | 컨테이너 앱 일관 관리 | **GKE Fleet + Config Sync**(GKE Enterprise) | 표준 배포·정책 |
| 3 | **안전·고성능** 온프레↔GCP 연결 | **Dedicated Interconnect** | "high-performance" → VPN보다 전용 |
| 4 | 일관 로깅·보존·모니터·알림 | **Cloud Logging**(log buckets·retention) + **Monitoring** | 규제 로그 보존 |
| 5 | 다중 컨테이너 환경 관리 | **GKE Fleet + Anthos Config Management** | 멀티 환경 |
| 6 | 동적 확장·신규 환경 프로비저닝 | **Terraform(IaC)** + GKE autoscaling(HPA·Cluster Autoscaler) | 환경 자동 생성 |
| 7 | 신규 제공자 데이터 수집·처리 인터페이스 | **Pub/Sub + Dataflow + Apigee**(또는 Data Fusion) | 인제스트 파이프라인 |

---

## 레퍼런스 아키텍처

```
[온프레 colocation]                         [보험사 레거시 file/API — 유지]
   │ Migrate to VMs / GKE 이전                    │ (이전 계획 없음)
   ▼                                              ▼
 ── Dedicated Interconnect + HA VPN ── [VPC / Shared VPC] ── NCC(허브-스포크, 이행)
                                          │
   글로벌 환자/보험사 → Global external App LB + Cloud CDN → GKE(멀티존 리전, Fleet)
                                          │   ├ 고객대면 컨테이너 앱(99.9%)
                                          │   └ Config Sync(정책 일관)
        Cloud SQL(MySQL·SQL Server, HA)  Memorystore(Redis)  MongoDB(Atlas)
                                          │
   ID: Cloud Identity ↔ Microsoft AD 페더레이션 (또는 Managed AD)
   데이터: Pub/Sub→Dataflow→BigQuery(+BQML) → Looker(트렌드 리포트)
   보안: IAM 최소권한 · CMEK(KMS) · VPC-SC 경계 · Audit Logs · Assured Workloads
   운영: Cloud Observability(중앙 SLO·의미있는 알림)  DR: 멀티리전·백업
```

- **DR:** Exec가 "DR 계획 개선" 요구 → RTO/RPO에 맞춘 패턴 선택(멀티리전 warm/hot vs backup&restore). [[/concept/cloud/10_migration_and_dr_for_pca]]

---

## 예상 출제 각도

- **"한 DC 리스 만료 임박, 가장 빠르게 이전"** → **Migrate to Virtual Machines(rehost)**. 재작성(refactor)은 시간 압박에 부적합.
- **"MySQL·SQL Server를 관리형으로"** → **Cloud SQL**. **MongoDB는 Cloud SQL 아님** → Atlas/self-managed. Redis → **Memorystore**.
- **"Microsoft AD 유지하며 GCP 접근"** → **Cloud Identity + AD 페더레이션**(GCDS/AD FS) 또는 **Managed Microsoft AD**. [[/concept/cloud/05_iam_for_pca]]
- **"온프레↔GCP 안전·고성능"** → **Dedicated Interconnect**(VPN은 "빠른 암호화"일 때). [[/concept/cloud/07_load_balancing_and_connectivity_for_pca]]
- **"온프레 + 타 클라우드 동시 연결·이행 라우팅"** → **Network Connectivity Center**(VPC Peering은 비이행). [[/concept/cloud/03_vpc_for_pca]]
- **"글로벌 고객 지연 감소"** → **Global external Application LB + Cloud CDN**.
- **"규제 준수·키 직접 관리·유출 방지"** → **CMEK**, 경계 **VPC-SC**, 규제 워크로드 **Assured Workloads**. [[/concept/cloud/09_security_for_pca]]
- **"알림이 무시되는 문제"** → **SLO 기반 의미있는 알림** + 중앙 Observability. [[/concept/cloud/11_operations_and_cost_for_pca]]

## 함정 / 오답 패턴

- **MongoDB를 Cloud SQL로** → Cloud SQL은 MySQL/PostgreSQL/SQL Server 전용. 대표 함정.
- **보험사 레거시를 "이전/재작성"으로** → 원문 "이전 계획 없음" → **하이브리드 연결 유지**가 정답.
- **리스 만료를 refactor로** → 시간 압박 → **rehost 우선**.
- **온프레 연결을 무조건 HA VPN** → "high-performance" 명시 → **Interconnect**.
- **100% 가용성** → 요구는 99.9%, error budget 개념. 과설계는 비용 렌즈 위반.
- **다중 GKE 클러스터를 개별 관리** → **Fleet/Config Sync**로 일관 관리.

---

## 시험 직전 체크

- DC 리스 만료 = **Migrate to VMs(rehost)** / 평가 = Migration Center.
- DB: MySQL·SQL Server→Cloud SQL, Redis→Memorystore, **MongoDB→Atlas/self-managed**.
- AD 유지 = **Cloud Identity 페더레이션 / Managed Microsoft AD**.
- 고성능 하이브리드 = **Dedicated Interconnect**, 이행 라우팅 = **NCC**.
- 규제 = **CMEK + VPC-SC + Assured Workloads + Audit Logs**.
- 관측/알림 = **Cloud Observability + SLO 알림**.

→ 매핑 근거: [[/concept/cloud/03_vpc_for_pca]] · [[/concept/cloud/07_load_balancing_and_connectivity_for_pca]] · [[/concept/cloud/08_databases_and_storage_for_pca]] · [[/concept/cloud/05_iam_for_pca]] · [[/concept/cloud/10_migration_and_dr_for_pca]] · 도메인 지도 [[/concept/cloud/00_pca_study_plan]]
