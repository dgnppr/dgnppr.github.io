---
layout  : concept
title   : GCP Professional Cloud Architect 시험 가이드 분석
date    : 2026-06-30 00:00:00 +0900
updated : 2026-06-30 00:00:00 +0900
tag     : cloud gcp pca certification exam-guide
toc     : true
comment : true
latex   : false
status  : complete
public  : true
parent  : [[/cloud]]
confidence     : high
valid_from     : 2026-06-30
relations:
  - { type: references, target: /concept/cloud/06_compute_for_pca }
  - { type: references, target: /concept/cloud/03_vpc_for_pca }
  - { type: references, target: /concept/cloud/04_gke_for_pca }
  - { type: references, target: /concept/cloud/05_iam_for_pca }
  - { type: references, target: /concept/cloud/07_load_balancing_and_connectivity_for_pca }
  - { type: references, target: /concept/cloud/08_databases_and_storage_for_pca }
  - { type: references, target: /concept/cloud/09_security_for_pca }
  - { type: references, target: /concept/cloud/10_migration_and_dr_for_pca }
  - { type: references, target: /concept/cloud/11_operations_and_cost_for_pca }
  - { type: references, target: /concept/cloud/12_genai_for_pca }
---

* TOC
{:toc}

> 공식 시험 가이드(Professional Cloud Architect Certification exam guide)를 도메인별 배점·세부 목표·출제 형태로 정리한다. 출처는 Google이 배포하는 공식 PDF 가이드이며, 6개 섹션의 배점은 가이드에 명시된 수치 그대로다. 각 섹션을 cloud 카테고리의 도메인 문서로 연결한다.

---

## 시험 개요

Professional Cloud Architect는 Google Cloud로 견고·안전·확장 가능·비용 효율적·고가용·유연한 솔루션을 설계·구축·운영하는 역할을 검증한다. 가이드가 명시하는 핵심 전제 두 가지를 먼저 못박는다.

- **Well-Architected Framework가 핵심 요구사항이다.** 6개 기둥 — **운영 우수성(operational excellence), 보안(security), 안정성(reliability), 성능 최적화(performance optimization), 비용 최적화(cost optimization), 지속가능성(sustainability)** — 이 시험 목표 전반에 암묵적·명시적으로 녹아 있다. 모든 설계 의사결정의 기준선이다.
- **케이스 스터디 기반 문항이 있다.** 일부 문항은 가상의 비즈니스를 묘사하는 케이스 스터디를 참조한다. 여러 케이스가 Google Cloud 생성형 AI 솔루션으로 실제 과제를 푼다는 설정을 포함한다.

### 케이스 스터디 (공식 4종)

가이드에 명시된 현재 케이스는 다음과 같다. 이전 세대 케이스(TerramEarth·Mountkirk Games·HRL 등)는 가이드에서 빠졌다.

- **Altostrat Media**
- **Cymbal Retail**
- **EHR Healthcare**
- **KnightMotives Automotive**

> 가이드 PDF 자체는 문항 수·시험 시간을 명시하지 않는다. 이 문서는 가이드에 적힌 배점·목표·고려사항만 정리하며, 그 외 수치는 다루지 않는다.

---

## 배점 한눈에 보기

가이드에 명시된 6개 섹션과 배점이다. 합은 100%다.

| 섹션 | 제목 | 배점 |
|------|------|------|
| 1 | Designing and planning a cloud solution architecture | **~25%** |
| 2 | Managing and provisioning a cloud solution infrastructure | **~17.5%** |
| 3 | Designing for security and compliance | **~17.5%** |
| 4 | Analyzing and optimizing technical and business processes | **~15%** |
| 5 | Managing implementation | **~12.5%** |
| 6 | Ensuring solution and operations excellence | **~12.5%** |

배점만 보면 **설계·계획(섹션 1)이 단일 최대 비중**이고, 그다음이 **프로비저닝(2)과 보안·컴플라이언스(3)가 동률**이다. 섹션 1~3을 합치면 **60%**로, 시험의 무게중심은 "요구사항을 받아 아키텍처를 설계하고, 그것을 안전하게 프로비저닝하는" 능력에 있다.

---

## 섹션 1 — 설계·계획 (~25%)

단일 최대 비중. 비즈니스/기술 요구사항을 받아 네트워크·스토리지·컴퓨트를 선택하고, 마이그레이션을 계획하고, 미래 개선을 그리는 능력. 가이드의 세부 목표(1.1~1.5)는 다음과 같다.

- **1.1 비즈니스 요구사항을 만족하는 인프라 설계** — 비즈니스 유스케이스·제품 전략, 기능/비기능 요구사항 식별, 사업연속성 계획(BCP), 비용 최적화, 애플리케이션 설계 지원, 외부 시스템 통합 패턴, 데이터 이동, 설계 트레이드오프, 워크로드 처분 전략(build/buy/modify/deprecate), 성공 지표(KPI·ROI·메트릭), 보안·컴플라이언스, 관측성
- **1.2 기술 요구사항을 만족하는 인프라 설계** — Well-Architected Framework 숙지, 고가용성·장애조치 설계, 자원 유연성, 성장 대응 확장성, 성능·지연, **Gemini Cloud Assist**, 백업·복구
- **1.3 네트워크·스토리지·컴퓨트 자원 설계** — 온프레미스/멀티클라우드 통합, **Google Cloud AI/ML 솔루션(Gemini LLM, Agent Builder, Model Garden, Gemini 모델, AI Hypercomputer)**, 클라우드 네이티브 네트워킹(VPC·peering·방화벽·LB·라우팅·컨테이너 네트워킹·Shared VPC·Private Service Connect), 데이터 처리 솔루션 선택, 스토리지 타입 선택(객체/파일/DB), 컴퓨트 needs를 플랫폼 제품(GKE·Cloud Run·Cloud Run functions)에 매핑, 컴퓨트 자원 선택(Spot VM·커스텀 머신 타입·특수 워크로드)
- **1.4 마이그레이션 계획 수립** — 기존 시스템 통합, 시스템/데이터 평가·이전(**Google Cloud Migration Center**), 마이그레이션 방법론·워크로드 테스트·네트워크/의존성 계획, 소프트웨어 라이선스·재무 영향
- **1.5 미래 솔루션 개선 구상** — 클라우드/기술 발전, 비즈니스 니즈 변화, 클라우드 우선 설계 접근

**출제 형태(목표 기반 정리):** 케이스 스터디의 요구사항(컴플라이언스·지연·예산·SLA·성장)을 읽고 "어떤 서비스·구성이 맞는가"를 고르는 통합 설계 문항이 핵심. 컴퓨트([[/concept/cloud/06_compute_for_pca]], [[/concept/cloud/04_gke_for_pca]]) · 스토리지/DB([[/concept/cloud/08_databases_and_storage_for_pca]]) · 네트워킹([[/concept/cloud/03_vpc_for_pca]]) · 마이그레이션([[/concept/cloud/10_migration_and_dr_for_pca]]) · AI/ML([[/concept/cloud/12_genai_for_pca]])이 모두 이 섹션에서 교차한다.

---

## 섹션 2 — 관리·프로비저닝 (~17.5%)

설계를 실제 구성으로 옮기는 능력. 네트워크 토폴로지·스토리지·컴퓨트를 구성하고, **Gemini Enterprise Agent Platform로 ML 워크플로**를 다룬다.

- **2.1 네트워크 토폴로지 구성** — 온프레미스 확장(하이브리드 네트워킹), 멀티클라우드/Google Cloud 간 통신 확장, 보안 보호(침입 방지·접근 제어·방화벽), VPC 설계·로드밸런싱(클라우드·인터넷·cloud-adjacent 접근)
- **2.2 개별 스토리지 시스템 구성** — 스토리지 할당, 데이터 처리·컴퓨트 프로비저닝, 보안·접근 관리, 데이터 전송·지연 구성, 데이터 보존·라이프사이클 관리, 데이터 성장 계획, 데이터 보호(백업·복구)
- **2.3 컴퓨트 시스템 구성** — 컴퓨트 프로비저닝, 변동성 구성(spot vs standard), 컴퓨트용 클라우드 네이티브 네트워크 구성(Compute Engine·GKE·서버리스 네트워킹·Google Cloud VMware Engine), 인프라 오케스트레이션·자원 구성·패치 관리, 컨테이너 오케스트레이션, 서버리스 컴퓨팅
- **2.4 Gemini Enterprise Agent Platform로 엔드투엔드 ML 워크플로** — Agent Platform Pipelines로 ML 라이프사이클 자동화, Agent Platform 데이터 통합 준비, **AI Hypercomputer**(GPU/TPU를 모델 학습·서빙에 통합, 소비 모델 최적화, 대규모 학습)
- **2.5 Agent Platform로 사전 구축 솔루션·API 구성** — Google AI API 구분(Search·Conversation·Vision·Image·Video·Audio), Gemini Enterprise 기능 통합(AI Agents·NotebookLM), Model Garden 모델 통합

**출제 형태:** 설계가 아니라 "구성"을 묻는다. 어떤 LB·하이브리드 연결을 어떻게 구성하는가([[/concept/cloud/07_load_balancing_and_connectivity_for_pca]]), spot/standard·오케스트레이션 선택([[/concept/cloud/06_compute_for_pca]]), 스토리지 라이프사이클([[/concept/cloud/08_databases_and_storage_for_pca]]), GenAI 워크로드 구성([[/concept/cloud/12_genai_for_pca]]).

---

## 섹션 3 — 보안·컴플라이언스 (~17.5%)

섹션 2와 동률. 보안 설계와 규제 준수 설계로 나뉜다.

- **3.1 보안 설계** — IAM, 리소스 계층(조직·폴더·프로젝트), 데이터 보안(키 관리·암호화·시크릿 관리), 직무 분리(separation of duties), 보안 통제(감사·VPC Service Controls·컨텍스트 인식 액세스·조직 정책·계층형 방화벽 정책), **Cloud KMS로 CMEK 관리**, 보안 원격 접근(Identity-Aware Proxy·서비스 계정 가장·Chrome Enterprise Premium·Workload Identity Federation), 소프트웨어 공급망 보안, **AI 보안(Model Armor·Sensitive Data Protection·안전한 모델 배포)**
- **3.2 컴플라이언스 설계** — 법규(의료기록·아동·데이터 프라이버시·소유권·데이터 주권), 상업적 요구(신용카드·PII 등 민감정보 취급), 산업 인증(SOC 2 등), 감사(로그 포함)

**출제 형태:** "유출을 어떻게 막는가", "어떤 키 관리가 컴플라이언스를 만족하는가", "VPN 없이 어떻게 안전하게 접근하는가" 같은 통제 선택 문항. IAM 권한 모델([[/concept/cloud/05_iam_for_pca]])과 KMS·VPC-SC·IAP·SCC 등 보안 서비스([[/concept/cloud/09_security_for_pca]])가 핵심. 케이스(EHR Healthcare의 의료 프라이버시, Cymbal Retail의 카드/PII)와 직결된다.

---

## 섹션 4 — 프로세스 분석·최적화 (~15%)

기술 프로세스와 비즈니스 프로세스를 분석·정의·최적화한다. 순수 제품 지식보다 운영·조직·비용 관점.

- **4.1 기술 프로세스 분석·정의** — SDLC, CI/CD, 트러블슈팅·근본원인분석(RCA) 베스트프랙티스, 소프트웨어·인프라 테스트·검증, 서비스 카탈로그·프로비저닝, **재해복구(DR)**
- **4.2 비즈니스 프로세스 분석·정의** — 이해관계자 관리(영향·촉진), 변경 관리, 팀 역량 평가, 의사결정 프로세스, 고객 성공 관리, **비용/자원 최적화(CapEx/OpEx)**, 사업연속성

**출제 형태:** DR 패턴·RTO/RPO 선택([[/concept/cloud/10_migration_and_dr_for_pca]]), 비용 최적화 전략([[/concept/cloud/11_operations_and_cost_for_pca]]), 그리고 조직·변경 관리 같은 비기술 의사결정. 후자는 "정답이 가장 안전·표준적 운영 관행"인 경우가 많다.

---

## 섹션 5 — 구현 관리 (~12.5%)

개발·운영 팀을 자문해 솔루션 배포를 성공시키고, Google Cloud를 프로그래밍 방식으로 다룬다.

- **5.1 배포 성공을 위한 자문** — 애플리케이션·인프라 배포, **API 관리 베스트프랙티스(Apigee)**, 테스트 프레임워크(load/unit/integration), 데이터·시스템 마이그레이션·관리 도구, Gemini Cloud Assist
- **5.2 Google Cloud 프로그래밍 방식 상호작용** — Cloud Shell Editor·Cloud Code·Cloud Shell Terminal, **Google Cloud SDK(gcloud·gsutil·bq)**, Cloud Emulators(Bigtable·Spanner·Pub/Sub·Firestore), **IaC(Terraform)**, Google API 접근 베스트프랙티스, API 클라이언트 라이브러리

**출제 형태:** "이 배포/통합에 어떤 도구·관행이 맞는가". Apigee(API 관리), Terraform/IaC, gcloud/bq, 에뮬레이터 용도 구분([[/concept/cloud/11_operations_and_cost_for_pca]]). 데이터 강점(bq·Bigtable/Spanner 에뮬레이터)이 직접 닿는 섹션.

---

## 섹션 6 — 운영 우수성 (~12.5%)

Well-Architected의 운영 우수성 기둥을 중심으로 관측·배포·신뢰성을 보장한다.

- **6.1** Well-Architected Framework 운영 우수성 기둥의 원칙·권고 이해
- **6.2 Google Cloud Observability 숙지** — 모니터링·로깅, 프로파일링·벤치마킹, 알림 전략
- **6.3** 배포·릴리스 관리
- **6.4** 배포된 솔루션 지원 보조
- **6.5** 품질 통제 수단 평가
- **6.6** 프로덕션 신뢰성 보장(카오스 엔지니어링·침투 테스트·부하 테스트)

**출제 형태:** SLO/SLI·알림 전략, 배포·릴리스 전략(blue-green/canary), 관측성 도구 선택([[/concept/cloud/11_operations_and_cost_for_pca]]). 신뢰성 검증 기법(부하/카오스/침투)의 목적 구분.

---

## 배점 기반 학습 우선순위

배점과 응시자 강점(PDE 보유, BigQuery·데이터 실무)을 곱해 시간 배분을 정한다.

| 우선순위 | 섹션 | 배점 | 응시자 기준 |
|---------|------|------|------------|
| 최우선 | 1 설계·계획 | 25% | 컴퓨트·네트워킹·마이그레이션이 약점 → 가장 많은 시간 |
| 높음 | 3 보안·컴플라이언스 | 17.5% | 아키텍트 고유 영역, IAM·KMS·VPC-SC 미숙 → 집중 |
| 높음 | 2 관리·프로비저닝 | 17.5% | 설계와 겹치나 "구성" 디테일 + GenAI 신규 범위 |
| 중간 | 4 프로세스 최적화 | 15% | DR·비용은 학습, 조직 관리 문항은 상식 |
| 보강 | 5 구현 관리 | 12.5% | bq·에뮬레이터는 강점, Apigee·Terraform 보강 |
| 보강 | 6 운영 우수성 | 12.5% | 관측·SLO·배포 전략 정리 |

- **신규 범위 주의:** 현재 가이드는 GenAI 비중이 크다 — Gemini Cloud Assist, AI Hypercomputer, Agent Platform/Pipelines, Model Garden, Model Armor, Sensitive Data Protection이 섹션 1·2·3에 흩어져 있다. 데이터 배경이 있어도 "아키텍트 관점의 GenAI 통합·보안"은 별도로 정리한다([[/concept/cloud/12_genai_for_pca]]).
- **Well-Architected 6기둥은 채점 렌즈다.** 답이 갈릴 때 "가장 안전·안정·비용효율적·운영 가능한 선택"이 정답인 경우가 많다.
- **케이스는 암기가 아니라 매핑이다.** 4종 케이스에서 요구사항(컴플라이언스·지연·예산·SLA·성장)을 추출해 서비스로 연결하는 연습을 한다. 실제 시험에서 일부 문항이 이 케이스를 참조한다.
