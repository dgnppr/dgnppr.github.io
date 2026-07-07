---
layout      : concept
title       : PCA 케이스 스터디 Cymbal Retail (커머스 GenAI·카탈로그·대화형)
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
  - { type: references, target: /concept/cloud/04_gke_for_pca }
  - { type: references, target: /concept/cloud/08_databases_and_storage_for_pca }
  - { type: references, target: /concept/cloud/09_security_for_pca }
  - { type: references, target: /concept/cloud/10_migration_and_dr_for_pca }
  - { type: references, target: /concept/cloud/12_genai_for_pca }
---

* TOC
{:toc}

> [Cymbal Retail 공식 케이스](https://services.google.com/fh/files/misc/v6.1_pca_cymbal_retail_case_study_english.pdf)(v6.1) 딥다이브. **커머스 GenAI**가 주제 — 카탈로그 자동 보강, 대화형 커머스(상품 탐색), 기술 스택 현대화. 요구사항 → 서비스 매핑, 레퍼런스 아키텍처, 함정을 정리한다. 매핑은 [[/concept/cloud/00_pca_study_plan]]의 채점 렌즈에 따른 표준 판단이며 근거는 심화 문서로 링크.

---

## 케이스 한눈에

- **회사:** 급성장 중인 온라인 리테일러. 여러 리테일 하위 버티컬에 걸친 방대한 상품 카탈로그 관리가 상시 과제.
- **솔루션 컨셉(3대 축):**
  1. **카탈로그·콘텐츠 보강** — 공급사 정보로부터 gen AI가 상품 속성·설명·이미지 생성. 수작업·오류 감소, 전 채널 일관성.
  2. **대화형 커머스 + 상품 탐색** — 웹/모바일에 AI 가상 에이전트 통합, 자연어 대화로 개인화 쇼핑. Google Cloud **Discovery AI**로 요청 처리·관련 상품 검색.
  3. **기술 스택 현대화** — 클라우드 인프라, 안전·효율 데이터 처리, 서드파티 통합, 선제적 모니터링·보안.
- **기존 환경:** 온프레+클라우드 혼재. DB 다종(**MySQL·MS SQL Server·Redis·MongoDB**). **Kubernetes** 클러스터. 레거시 파일 기반 통합(**SFTP·ETL 배치**). 관계형 DB를 직접 질의하는 **커스텀 웹앱**. **IVR**(콜 라우팅). **콜센터 상담원**이 수동 주문 입력. 모니터링은 **Grafana·Nagios·Elastic**.
- **현 문제:** 수작업 느리고 오류多, 데이터 사일로로 고객 여정 통합 뷰 부재, 신기술 통합 난이도.
- **Exec 한 줄:** "Generative AI for Digital Commerce로 효율·고객경험·매출 성장. 운영비↓, 상품 온보딩 속도↑, 정보 정확성·일관성↑, 대화형 커머스, 발견성↑ → 전환율·매출↑."

> **핵심 판단 축:** 순수 인프라 케이스가 아니라 **커머스 특화 GenAI 제품**을 매핑하는 케이스다. 일반 Vertex AI만이 아니라 **상품 검색은 Vertex AI Search for commerce(구 Discovery AI/Retail API)**, **이미지 생성/편집은 Imagen**, **속성 생성은 Gemini 멀티모달**을 정확히 구분해야 한다. 카드·PII 취급 → **PCI DSS·Sensitive Data Protection** 컴플라이언스가 붙는다.

---

## 기존 환경 → 시사점

| 현재 | 신호 | GCP 방향 |
|------|------|---------|
| MySQL·MS SQL Server·Redis·MongoDB | 관계형 다종 + NoSQL | Cloud SQL(MySQL·SQL Server), Memorystore(Redis), MongoDB→Atlas/self-managed. **DMS**로 이관 |
| Kubernetes 클러스터 | 컨테이너 자산 | **GKE**로 이전(Autopilot) |
| 레거시 SFTP·ETL 배치 통합 | 파일 기반 사일로 | **Storage Transfer·Cloud Data Fusion·Dataflow·Pub/Sub**로 현대화 |
| 관계형 DB 직접 질의 웹앱(이름·카테고리) | 검색 품질 낮음 | **Vertex AI Search for commerce**(시맨틱·개인화) |
| IVR + 상담원 수동 주문 | 콜센터 비용 | **Conversational Agents**로 셀프서비스·주문 자동화 |
| Grafana·Nagios·Elastic | 관측 분산 | **Cloud Observability** 중앙화 |
| 온프레+클라우드 혼재 | 하이브리드 | Interconnect/VPN, 점진 마이그레이션 |

---

## 비즈니스 요구사항 → 서비스 매핑

| # | 요구사항 | GCP 서비스 | 근거 |
|---|------|-----------|------|
| 1 | 상품 카탈로그 보강 자동화(오류·수작업↓) | **Gemini 멀티모달**(속성·설명) + **Imagen**(이미지) | 공급사 텍스트·이미지 입력 |
| 2 | 상품 발견성 향상(검색 적합성) | **Vertex AI Search for commerce** | 시맨틱·리테일 특화 |
| 3 | 고객 인게이지먼트↑ | **Conversational Agents**(대화형) | 개인화 쇼핑 대화 |
| 4 | 판매 전환↑ | **Recommendations AI / Vertex AI Search(commerce)** | 개인화 추천 |
| 5 | 비용↓(콜센터·데이터센터) | 대화형 셀프서비스 + **클라우드 마이그레이션(서버리스)** | 인건비·호스팅비 절감 |

## 기술 요구사항 → 서비스 매핑

| # | 요구사항 | GCP 서비스 | 왜 |
|---|------|-----------|-----|
| 1 | 공급사 데이터(제목·설명·이미지)에서 속성 생성 | **Gemini 멀티모달**(Vertex AI) | 카테고리·기존 구조 정합 |
| 2 | 이미지 생성·보정(색상 변형·배경 변경·텍스트 오버레이) | **Imagen**(Vertex AI, product image editing) | base image → 변형 |
| 3 | 자연어 상품 탐색 자동화 | **Vertex AI Search for commerce** | NL 요청 → 관련 상품 |
| 4 | 확장성·성능(대형 카탈로그·성장) | 관리형(GKE Autopilot·서버리스)·Vertex AI | 스케일 |
| 5 | Human-in-the-Loop 검토 UI(승인/거부/수정) | **Cloud Run 커스텀 앱** + 워크플로 + Firestore/Cloud SQL | 게시 전 리뷰 |
| 6 | 데이터 보안·컴플라이언스(카드·PII) | **Sensitive Data Protection(DLP)** + **CMEK** + **VPC-SC** + (PCI DSS) | 민감정보 처리 |

---

## 레퍼런스 아키텍처

```
공급사 데이터(텍스트·이미지) → Cloud Storage
        │
        ▼  카탈로그 보강 파이프라인
   Gemini(속성·설명) + Imagen(이미지 변형) → HITL 리뷰 UI(Cloud Run) → 카탈로그 DB(Cloud SQL/Firestore)
        │                                                                       │
        ▼                                                                       ▼
고객 웹/모바일 → Conversational Agents(대화) → Vertex AI Search for commerce(상품 탐색·추천)
        │
   주문/결제 → PCI DSS 범위: Sensitive Data Protection(토큰화) · CMEK · VPC-SC 경계
   관측: Cloud Observability   컴퓨트: GKE Autopilot   레거시 통합: Data Fusion/Dataflow/Pub-Sub
```

- **HITL이 명시 요구** → gen AI 산출물을 사람이 승인/거부/수정하는 UI를 반드시 아키텍처에 포함. 자동 게시로 답하면 오답.
- **데이터 현대화** → SFTP·ETL 배치를 Dataflow/Pub/Sub/Data Fusion로 대체, 사일로 해소. [[/concept/cloud/08_databases_and_storage_for_pca]]

---

## 예상 출제 각도

- **"공급사 이미지에서 상품 속성·설명 생성"** → **Gemini 멀티모달**. 일반 Vision API만으론 생성 불가.
- **"기존 이미지로 색상 변형·배경 교체"** → **Imagen**(생성·편집). 분류·라벨은 Vision, 생성은 Imagen.
- **"자연어로 상품 검색·추천"** → **Vertex AI Search for commerce**(구 Discovery AI). 일반 Vertex AI Search와 구분 — 커머스 특화.
- **"콜센터 비용 절감 + 셀프서비스"** → **Conversational Agents**(IVR 대체·주문 자동화).
- **"gen AI 산출물 품질 보증"** → **Human-in-the-Loop 리뷰 UI**(승인 후 게시).
- **"카드·PII 안전 처리"** → **Sensitive Data Protection(마스킹·토큰화)** + **CMEK** + **VPC-SC**, PCI DSS 준수. [[/concept/cloud/09_security_for_pca]]

## 함정 / 오답 패턴

- **모든 AI를 "Vertex AI"로 뭉뚱그리면 감점** → 검색은 Search for commerce, 이미지는 Imagen, 속성은 Gemini로 특정.
- **HITL 요구를 무시하고 자동 게시** → 명시적 기술 요구 위반.
- **레거시 SFTP/ETL을 그대로 유지** → "현대화" 요구 → 관리형 데이터 파이프라인으로 대체.
- **MongoDB를 Cloud SQL로** → Cloud SQL은 MySQL/PostgreSQL/SQL Server만. MongoDB는 Atlas/self-managed.
- **PII/카드 처리에 DLP·경계 통제 누락** → 컴플라이언스 미충족.

---

## 시험 직전 체크

- 속성·설명 생성 = **Gemini 멀티모달** / 이미지 생성·편집 = **Imagen** / 상품 검색·추천 = **Vertex AI Search for commerce**.
- 대화형 커머스 = **Conversational Agents**(IVR·콜센터 대체).
- gen AI 산출물 = **HITL 리뷰 UI** 필수.
- 카드·PII = **Sensitive Data Protection + CMEK + VPC-SC**(PCI DSS).
- 레거시 파일 통합 현대화 = **Dataflow/Pub-Sub/Data Fusion**.

→ 매핑 근거: [[/concept/cloud/12_genai_for_pca]] · [[/concept/cloud/09_security_for_pca]] · [[/concept/cloud/08_databases_and_storage_for_pca]] · 도메인 지도 [[/concept/cloud/00_pca_study_plan]]
