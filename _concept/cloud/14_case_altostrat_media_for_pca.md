---
layout      : concept
title       : PCA 케이스 스터디 Altostrat Media (미디어 GenAI·하이브리드 GKE)
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
  - { type: references, target: /concept/cloud/07_load_balancing_and_connectivity_for_pca }
  - { type: references, target: /concept/cloud/08_databases_and_storage_for_pca }
  - { type: references, target: /concept/cloud/09_security_for_pca }
  - { type: references, target: /concept/cloud/10_migration_and_dr_for_pca }
  - { type: references, target: /concept/cloud/11_operations_and_cost_for_pca }
  - { type: references, target: /concept/cloud/12_genai_for_pca }
---

* TOC
{:toc}

> [Altostrat Media 공식 케이스](https://services.google.com/fh/files/misc/v6.1_pca_altostrat_media_case_study_english.pdf)(v6.1) 딥다이브. 시험 일부 문항은 이 케이스를 참조한다. 이 문서는 **요구사항 → 키워드 → GCP 서비스** 매핑 + 레퍼런스 아키텍처 + 오답 함정을 정리한다. 케이스 사실은 원문 그대로, 서비스 매핑은 [[/concept/cloud/00_pca_study_plan]]의 채점 렌즈(Well-Architected 6기둥)에 따른 표준 판단이며 근거는 심화 문서로 링크한다. 4종 중 **GenAI + 하이브리드 GKE**가 주제인 케이스다.

---

## 케이스 한눈에

- **회사:** 팟캐스트·인터뷰·뉴스·다큐 등 방대한 오디오·비디오 콘텐츠를 가진 미디어 기업.
- **솔루션 컨셉:** Google Cloud **생성형 AI**로 콘텐츠 관리·사용자 경험 현대화 — 개인화 추천, 자연어 상호작용, 셀프서비스 지원. 동시에 동적 가격·타깃 마케팅·개인화 추천으로 매출 성장.
- **기존 환경:** **GKE**(콘텐츠 관리·전송 플랫폼), **Cloud Storage**(미디어 라이브러리), **BigQuery**(주 DW), **Cloud Run functions**(트랜스코딩·메타데이터 추출·추천의 이벤트 구동 실행). 일부 **온프레 레거시**(콘텐츠 수집·아카이브) — 곧 GCP 이전 예정. 인증은 **Google Identity + 서드파티 IdP**. 관측은 **Cloud Monitoring + Prometheus**, 알림은 이메일.
- **Exec 한 줄:** "생성형 AI로 콘텐츠 전략 혁신. **신뢰성과 비용 관리가 우리의 최우선순위**."

> **핵심 판단 축:** 이미 GCP(GKE/GCS/BigQuery/Cloud Run functions)를 쓰는 케이스다. 정답은 **재구축이 아니라 기존 스택 위에 GenAI를 얹기**다. Exec가 **신뢰성·비용을 명시적 최우선**으로 못박았으므로, 답이 갈리면 "가장 화려한 모델"이 아니라 관리형·비용효율 선택이 정답.

---

## 기존 환경 → 시사점

| 현재 | 신호 | GCP 방향 |
|------|------|---------|
| GKE로 콘텐츠 플랫폼 운영 | 이미 컨테이너 성숙 | 유지·확장. 온프레까지 확장 요구 → **GKE Enterprise(Fleet)** |
| 미디어 라이브러리 = Cloud Storage | 대용량·비정형·비용 이슈 | 클래스/lifecycle, 예측 불가 시 **Autoclass** |
| BigQuery = 주 DW | 인사이트 분석 기반 이미 존재 | 트렌드 분석·추천 학습 데이터로 재활용, **BigQuery ML** |
| Cloud Run functions로 트랜스코딩·메타데이터 | 서버리스 이벤트 파이프라인 | GenAI 메타데이터 추출로 확장 |
| 온프레 레거시(수집·아카이브), 곧 이전 | 마이그레이션 대상 존재 | 이전까지 **하이브리드 연결**, 이후 modernize |
| Prometheus + Cloud Monitoring 혼재, 이메일 알림 | 관측 분산 | **Cloud Observability**로 중앙화, SLO 기반 알림 |

---

## 비즈니스 요구사항 → 서비스 매핑

| # | 요구사항(원문 요지) | GCP 서비스 | 근거 |
|---|------|-----------|------|
| 1 | 모든 환경(GCP+온프레) 운영 워크플로 신뢰성·속도↑ | **GKE Enterprise(Fleet)** + **Cloud Deploy** + **Config Sync** | 하이브리드 일관 배포·정책 |
| 2 | 인프라 관리 단순화·빠른 앱 배포 | **GKE Autopilot** + **Cloud Build/Cloud Deploy** + **Artifact Registry** | 노드 운영 제거·CD 파이프라인 |
| 3 | 미디어 스토리지 비용 최적화(+HA·확장) | **Cloud Storage Autoclass** + lifecycle + 멀티리전 | 접근 패턴 예측 어려운 미디어 |
| 4 | 자연어 상호작용 + 24/7 지원 | **Vertex AI Agent Builder / Conversational Agents**(Gemini) | 대화형 셀프서비스 |
| 5 | 미디어 콘텐츠 요약 자동 생성 | **Gemini 멀티모달**(Vertex AI) + Speech-to-Text 전사 | 오디오·비디오 요약 |
| 6 | NLP+CV로 리치 메타데이터 추출 | **Video Intelligence·Vision·Speech-to-Text·Natural Language API** (또는 Gemini 멀티모달) | 라벨·전사·엔티티 |
| 7 | 부적절 콘텐츠 탐지·필터 | **Video Intelligence(explicit content)** + **Model Armor** + **Sensitive Data Protection** | 미디어 자체 vs LLM I/O 구분 |
| 8 | 콘텐츠 트렌드·인사이트 분석 | **BigQuery + BigQuery ML / Vertex AI** | 기존 DW 재활용 |
| 9 | 데이터 기반 콘텐츠 전략 결정 | **BigQuery + Looker** | 대시보드·리포트 |

## 기술 요구사항 → 서비스 매핑

| # | 요구사항 | GCP 서비스 | 왜 |
|---|------|-----------|-----|
| 1 | 컨테이너 CI/CD 현대화 + 중앙 관리 | **Cloud Build·Cloud Deploy·Artifact Registry·GKE Fleet** | 중앙 릴리스·플릿 관리 |
| 2 | 안전·고성능 하이브리드 연결(수집용) | **Dedicated/Partner Interconnect** (또는 HA VPN) | 대용량 미디어 수집 대역 |
| 3 | 온프레·클라우드 양쪽 확장 k8s | **GKE Enterprise(Anthos, on-prem 포함)** + Fleet | "both on-prem and cloud" = 단일 GKE로 부족 |
| 4 | 증가하는 미디어 볼륨 스토리지 비용 최적화 | **Autoclass·스토리지 클래스·lifecycle** | 자동 강등 |
| 5 | 유해 콘텐츠 AI 탐지 설계 | **Video Intelligence** + **Model Armor** | 콘텐츠 안전 |
| 6 | AI 감사가능·설명가능 | **Vertex AI Explainable AI·Model Cards·Cloud Audit Logs** | "auditable and explainable" 명시 |
| 7 | LLM+대화형 AI 개인화·바이럴 | **Vertex AI·Gemini·Vertex AI Search(RAG grounding)** | 개인화 추천 grounding |
| 8 | NLU 고급 챗봇 | **Conversational Agents(Dialogflow CX)/Agent Builder** | 자연어 이해 |
| 9 | 다양한 미디어 자동 요약 | **Gemini** | 멀티모달 요약 |

---

## 레퍼런스 아키텍처

```
[온프레 레거시 수집/아카이브] --Interconnect/HA VPN--> [VPC]
                                                        │
   글로벌 사용자 → Global external App LB + Cloud CDN → GKE Enterprise (Fleet)
                                                        │  ├ 콘텐츠 전송/웹
                                                        │  └ Config Sync(정책)
                          Cloud Storage(미디어, Autoclass) ─┐
                          Cloud Run functions(트랜스코딩·메타)│
                                                            ▼
   GenAI 계층: Vertex AI(Gemini) ── Agent Builder(대화)   Vertex AI Search(추천 grounding)
              Video Intelligence/Vision/Speech(메타·유해탐지)  Model Armor(LLM I/O 안전)
                                                            ▼
   분석: BigQuery(DW) + BigQuery ML → Looker(전략 리포트)
   운영: Cloud Observability(중앙 SLO·알림)  보안: IAM·CMEK·Audit Logs
```

- **CI/CD:** Cloud Build → Artifact Registry → Cloud Deploy → GKE Fleet(온프레 포함) 롤아웃. [[/concept/cloud/04_gke_for_pca]]
- **엣지:** Global external Application LB + Cloud CDN으로 글로벌 지연·부하 처리. [[/concept/cloud/07_load_balancing_and_connectivity_for_pca]]

---

## 예상 출제 각도

- **"미디어 라이브러리 스토리지 비용을 접근빈도 예측 없이 최적화"** → **Autoclass**. 수동 lifecycle은 접근 패턴을 알 때. [[/concept/cloud/08_databases_and_storage_for_pca]]
- **"온프레 + GKE를 한 방식으로 관리·정책 적용"** → **GKE Enterprise / Fleet + Config Sync**(Anthos). 단일 GKE 클러스터로 답하면 부족.
- **"동영상에서 부적절 장면 탐지"** → **Video Intelligence API(explicit content)**. LLM 응답 안전은 **Model Armor** — 둘을 혼동시키는 함정.
- **"AI 결정을 설명·감사 가능하게"** → **Explainable AI + Model Cards**, 감사는 **Cloud Audit Logs**. [[/concept/cloud/12_genai_for_pca]]
- **"24/7 자연어 지원·개인화 추천"** → **Agent Builder/Conversational Agents** + **Vertex AI Search**로 자사 콘텐츠 grounding(RAG).
- **"메타데이터 추출(NLP+CV 동시)"** → 전용 API 조합(Video Intelligence/Vision/Speech/NL) 또는 단일 **Gemini 멀티모달**. "하나로"면 Gemini.

## 함정 / 오답 패턴

- Exec가 **신뢰성·비용 최우선** 명시 → 가장 비싼 최신 구성이 늘 정답은 아니다. 관리형·서버리스·Autopilot이 채점 렌즈에 부합.
- 이미 GKE/GCS/BigQuery 사용 → **"새로 구축/다른 스택으로 교체" 선택지는 오답** 신호.
- **hybrid k8s를 GKE로만 답하면 감점** → 온프레 포함은 **GKE Enterprise/Anthos**.
- **유해 콘텐츠 = 무조건 Model Armor** 로 답하는 함정 → 미디어(비디오) 탐지는 **Video Intelligence**, LLM 프롬프트/응답 안전이 **Model Armor**.
- 요약·추천을 별도 커스텀 모델 학습으로? → **Gemini/Vertex AI 관리형**이 비용·운영 렌즈에서 우선.

---

## 시험 직전 체크

- Autoclass = 접근 패턴 모를 때 스토리지 자동 최적화.
- GKE Enterprise/Fleet/Config Sync = 온프레+클라우드 통합 관리.
- Video Intelligence(미디어 안전) ↔ Model Armor(LLM 안전) 구분.
- Explainable AI + Model Cards = 감사·설명가능 AI.
- Agent Builder + Vertex AI Search = 대화형 + RAG grounding.

→ 매핑 근거: [[/concept/cloud/12_genai_for_pca]] · [[/concept/cloud/04_gke_for_pca]] · [[/concept/cloud/08_databases_and_storage_for_pca]] · [[/concept/cloud/07_load_balancing_and_connectivity_for_pca]] · 도메인 지도 [[/concept/cloud/00_pca_study_plan]]
