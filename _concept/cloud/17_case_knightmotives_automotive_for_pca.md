---
layout      : concept
title       : PCA 케이스 스터디 KnightMotives Automotive (자율주행·데이터 수익화·EU 규제)
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
  - { type: references, target: /concept/cloud/08_databases_and_storage_for_pca }
  - { type: references, target: /concept/cloud/09_security_for_pca }
  - { type: references, target: /concept/cloud/10_migration_and_dr_for_pca }
  - { type: references, target: /concept/cloud/11_operations_and_cost_for_pca }
  - { type: references, target: /concept/cloud/12_genai_for_pca }
---

* TOC
{:toc}

> [KnightMotives Automotive 공식 케이스](https://services.google.com/fh/files/misc/v6.1_pca_knightmotives_automotive_case_study_english.pdf)(v6.1) 딥다이브. 4종 중 **가장 넓은 케이스** — 자율주행 AI, 메인프레임/ERP 현대화, 데이터 수익화, EU 데이터 주권, 보안(과거 침해), 엣지/원격 연결이 얽힌다. 요구사항 → 서비스 매핑, 레퍼런스 아키텍처, 함정을 정리. 근거는 심화 문서로 링크.

---

## 케이스 한눈에

- **회사:** **자율주행 차량** 제조사. BEV·하이브리드·ICE 생산. BEV는 in-vehicle 경험 진전, **하이브리드·ICE는 구식**이라 평가·판매 하락. **5년 내 전 모델 소비자 경험 현대화** 목표. AI로 in-vehicle·구매·정비 경험 혁신. 온라인 주문·build-to-order 불안정, 딜러 관계 악화 → 딜러/정비/영업 툴 개선 필요.
- **솔루션 컨셉:** "차 제조 → **자동차 경험** 창출"로 전환. 전 모델 일관 경험, AI 기능, **데이터 수익화**로 신규 매출, 디지털 차별화, 정비·영업 툴 개선.
- **기존 환경:** IT는 대부분 **온프레**(+일부 클라우드). 공급망은 **구식 메인프레임**, **ERP도 구식** → 프로모션·딜러 할인 어려움. 딜러는 신장비 예산 없음. **다중 코드베이스·기술부채**(하위호환). **공장 네트워크·시골 차량 연결**이 난제.
- **비즈니스 요구:** 운전자 개인화 관계, 전 모델 일관 경험, **build-to-order** 투명성, **기업 데이터 수익화**(현 AI 인프라 obsolete·데이터 사일로), **보안 최우선(과거 침해 이력)**, **EU 데이터 보호(GDPR) 특히 자율주행**, 유리한 규제 지역부터 완전자율 투자, 인력 업스킬·소통.
- **Exec 한 줄(CEO Michael Knight):** 방대한 데이터(주행·도로·행동·충돌안전)로 안전 강화·생명 구제, 전 모델 일관된 KnightMotives 경험. "우리 AI는 국가 안전 통계를 상회한다."

> **핵심 판단 축:** 이 케이스는 **여러 도메인이 한꺼번에** 나온다. 답을 고를 때 요구사항의 명시 제약을 축으로 잡아라 — **메인프레임/ERP = 현대화(Mainframe Modernization)**, **데이터 수익화 = Analytics Hub**, **EU 자율주행 = 데이터 주권(Assured Workloads/Sovereign Controls)**, **과거 침해 = 포괄 보안 프레임워크(SCC 등)**, **시골 차량·실시간 AI = 엣지·인제스트**, **자율주행 학습·시뮬레이션 = AI Hypercomputer**.

---

## 기존 환경 → 시사점

| 현재 | 신호 | GCP 방향 |
|------|------|---------|
| 대부분 온프레 + 일부 클라우드 | 하이브리드 | 점진 마이그레이션, **하이브리드 클라우드 전략** 명시 요구 |
| 공급망 = 구식 **메인프레임** | 현대화 대상 | **Mainframe Modernization**(Dual Run/G4, Assessment Tool) |
| **ERP 구식**(프로모션·할인 난이도) | 민첩성 저하 | 현대화 또는 교체, API化(Apigee) |
| 다중 코드베이스·기술부채 | 파편화 | 일관 플랫폼·표준화 |
| 데이터 **사일로**, AI 인프라 **obsolete** | 활용 불가 | **BigQuery + Dataplex**(거버넌스) + **Vertex AI** |
| 공장·시골 차량 **연결 난제** | 엣지·저연결 | **Google Distributed Cloud Edge** + Pub/Sub 인제스트, 네트워크 업그레이드(Interconnect/NCC) |
| 과거 **데이터 침해** | 보안 취약 | **SCC + IAM 최소권한 + VPC-SC + Cloud Armor** |

---

## 비즈니스 요구사항 → 서비스 매핑

| # | 요구사항 | GCP 서비스 | 근거 |
|---|------|-----------|------|
| 1 | 운전자 개인화 관계·전 모델 일관 경험 | **Vertex AI(Gemini)** + CRM 통합 | AI in-vehicle·개인화 |
| 2 | build-to-order 투명성(딜러·고객) | **Cloud Run/GKE 앱** + **Apigee**(딜러 API) | 신뢰성·데이터 제공 |
| 3 | **기업 데이터 수익화** | **Analytics Hub**(BigQuery 데이터 교환·리스팅) + Dataplex | 데이터 상품화 |
| 4 | **보안 최우선(과거 침해)** | **Security Command Center + IAM + VPC-SC + Cloud Armor** | 포괄 보안 프레임워크 |
| 5 | **EU 데이터 보호(GDPR·자율주행)** | **Assured Workloads(EU) + Sovereign Controls + CMEK/EKM + 데이터 residency** | 데이터 주권 |
| 6 | 유리한 규제 지역부터 완전자율 | 리전 선택 + 규정준수 통제 | 규제 환경 대응 |
| 7 | 인력 업스킬·비즈-테크 소통 | (비기술) 변화 관리·교육 | 조직 관점 문항 |

## 기술 요구사항 → 서비스 매핑

| # | 요구사항 | GCP 서비스 | 왜 |
|---|------|-----------|-----|
| 1 | 전 모델 일관 in-vehicle UX + AI, 실시간·시골 연결 | **Google Distributed Cloud Edge** + Pub/Sub + Vertex AI | 저지연 엣지 추론·데이터 전송 |
| 2 | 공장↔HQ 네트워크 업그레이드 | **Dedicated Interconnect + Network Connectivity Center** | 대역·이행 연결 |
| 3 | IT 인프라 현대화(하이브리드, 레거시 교체) | **Mainframe Modernization + Migrate to VMs + 하이브리드 네트워킹** | 메인프레임·ERP 현대화 |
| 4 | 자율주행 개발·테스트(AI/ML, **시뮬레이션**, 규정) | **AI Hypercomputer(GPU/TPU) + GKE + Vertex AI + Cloud Storage(센서)** | 대규모 학습·시뮬 |
| 5 | 데이터 수익화·인사이트(플랫폼·보안·확장 AI/ML) | **BigQuery + Analytics Hub + Dataplex + Vertex AI** | 관리·공유·분석 |
| 6 | 보안·리스크(프레임워크·IR·교육) | **SCC + Cloud Armor + IAM + VPC-SC** + 사고대응 | 침해 재발 방지 |
| 7 | 딜러·고객 경험(build-to-order·딜러툴·CRM) | **GKE/Cloud Run + Apigee + CRM 통합** | 안정 주문·툴 |

---

## 레퍼런스 아키텍처

```
차량 텔레메트리(주행·도로·충돌) ── GDC Edge(엣지 추론) ── Pub/Sub ── Dataflow ── BigQuery
    (시골 저연결 대응)                                                         │
공장 ── Dedicated Interconnect + NCC ── [VPC] ── HQ                            ▼
                                                                    Dataplex(거버넌스)
레거시: 메인프레임 → Mainframe Modernization(Dual Run)   ERP → 현대화/API(Apigee)
                                                                    │
자율주행: AI Hypercomputer(GPU/TPU) + GKE + Cloud Storage(센서) + Vertex AI(학습·시뮬)
데이터 수익화: BigQuery → Analytics Hub(데이터 교환·리스팅) → 외부 구독자
딜러/고객: Cloud Run/GKE(build-to-order) + Apigee(딜러 API) + CRM
보안·주권: SCC + IAM + VPC-SC + Cloud Armor + Assured Workloads(EU) + CMEK/EKM
```

- **EU 자율주행 데이터** → **Assured Workloads**로 리전·인력·암호화 통제, 필요 시 **Cloud EKM**(외부 키). [[/concept/cloud/09_security_for_pca]]
- **데이터 수익화의 핵심 서비스는 Analytics Hub** — BigQuery 데이터를 exchange/listing으로 외부에 안전 공유·구독. 원시 export가 아님.

---

## 예상 출제 각도

- **"구식 메인프레임(공급망) 현대화"** → **Mainframe Modernization**(Dual Run/G4, Assessment Tool). 단순 lift로 답하면 부족.
- **"기업 데이터를 외부에 안전하게 공유·수익화"** → **Analytics Hub**(BigQuery). VPC-SC/IAM만으론 "공유·수익화" 미충족.
- **"EU 자율주행 데이터 규제 준수·데이터 주권"** → **Assured Workloads(EU) + Sovereign Controls + CMEK/EKM**. [[/concept/cloud/09_security_for_pca]]
- **"과거 침해 → 포괄 보안 태세"** → **Security Command Center**(취약점·위협 중앙) + 최소권한 IAM + VPC-SC.
- **"시골·실시간 차량 AI, 저연결"** → **Google Distributed Cloud Edge**(엣지 추론) + Pub/Sub 인제스트.
- **"자율주행 대규모 학습·시뮬레이션"** → **AI Hypercomputer(GPU/TPU)** + GKE + Vertex AI. [[/concept/cloud/12_genai_for_pca]]
- **"공장↔HQ 대역·이행 연결"** → **Dedicated Interconnect + NCC**. [[/concept/cloud/03_vpc_for_pca]]
- **"불안정한 build-to-order·딜러 API"** → **Apigee**(API 관리·안정) + GKE/Cloud Run.

## 함정 / 오답 패턴

- **데이터 수익화를 BigQuery export/공개 데이터셋으로** → 정답은 **Analytics Hub**(거버넌스된 교환).
- **EU 규제를 VPC-SC만으로** → 데이터 주권·residency는 **Assured Workloads/Sovereign Controls** 영역.
- **메인프레임을 Migrate to VMs로** → 메인프레임은 **전용 Mainframe Modernization** 경로.
- **시골 연결을 일반 리전 서비스로** → 저연결·실시간은 **엣지(GDC Edge)**.
- **자율주행 학습을 표준 VM으로** → 대규모는 **AI Hypercomputer(TPU/GPU)**.
- **"보안"을 단일 서비스로** → 과거 침해 → **SCC 중심 다층 프레임워크 + 사고대응(IR) + 교육**(조직 요소 포함).
- 조직 요구(업스킬·소통)는 비기술 문항 — **가장 표준적 변화·이해관계자 관리**가 정답. [[/concept/cloud/11_operations_and_cost_for_pca]]

---

## 시험 직전 체크

- 메인프레임 = **Mainframe Modernization(Dual Run)** / ERP = 현대화·API(Apigee).
- 데이터 수익화 = **Analytics Hub** / 거버넌스 = **Dataplex**.
- EU 자율주행 주권 = **Assured Workloads + Sovereign Controls + CMEK/EKM**.
- 과거 침해 = **Security Command Center + VPC-SC + IAM + Cloud Armor + IR**.
- 시골·실시간 = **GDC Edge + Pub/Sub** / 자율주행 학습·시뮬 = **AI Hypercomputer + Vertex AI**.
- 공장↔HQ = **Dedicated Interconnect + NCC**.

→ 매핑 근거: [[/concept/cloud/12_genai_for_pca]] · [[/concept/cloud/09_security_for_pca]] · [[/concept/cloud/10_migration_and_dr_for_pca]] · [[/concept/cloud/03_vpc_for_pca]] · 도메인 지도 [[/concept/cloud/00_pca_study_plan]]
