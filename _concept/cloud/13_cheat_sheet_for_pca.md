---
layout      : concept
title       : GCP Professional Cloud Architect 시험 치트시트
date        : 2026-07-07 00:00:00 +0900
updated     : 2026-07-07 00:00:00 +0900
tag         : cloud gcp pca certification cheat-sheet
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
  - { type: references, target: /concept/cloud/06_compute_for_pca }
  - { type: references, target: /concept/cloud/07_load_balancing_and_connectivity_for_pca }
  - { type: references, target: /concept/cloud/08_databases_and_storage_for_pca }
  - { type: references, target: /concept/cloud/09_security_for_pca }
  - { type: references, target: /concept/cloud/10_migration_and_dr_for_pca }
  - { type: references, target: /concept/cloud/11_operations_and_cost_for_pca }
  - { type: references, target: /concept/cloud/12_genai_for_pca }
  - { type: references, target: /concept/cloud/14_case_altostrat_media_for_pca }
  - { type: references, target: /concept/cloud/15_case_cymbal_retail_for_pca }
  - { type: references, target: /concept/cloud/16_case_ehr_healthcare_for_pca }
  - { type: references, target: /concept/cloud/17_case_knightmotives_automotive_for_pca }
---

* TOC
{:toc}

> 시험 전날·직전 30분에 훑는 **단일 치트시트**다. [[/concept/cloud/00_pca_study_plan]]이 배점·도메인 지도라면, 이 문서는 그 아래 심화 문서(03~12)를 **의사결정 표 + 키워드→서비스 매핑**으로 압축한 것이다. 설명은 심화 문서에 있고, 여기엔 "무엇을 고르는가"만 남긴다. 서비스 명칭은 현행(2026) 기준이며 최근 리네이밍(Cloud Run functions, 새 LB 명칭)을 반영한다.

---

## 0. 채점 렌즈 — 답이 갈릴 때 기준

- **Well-Architected 6기둥이 채점 기준이다.** 답이 애매하면 → *가장 안전·안정·비용효율·운영가능·확장가능한* 선택이 정답. 화려한 최신 서비스가 아니라 "표준 관행"이 정답인 경우가 많다.
- **Google이 관리하는 것 > 내가 관리하는 것.** 동급이면 managed·serverless가 정답(운영 우수성).
- **최소 권한 · 최소 노출.** IAM·네트워크·키에서 "가장 넓게 열린 선택지"는 거의 항상 오답.
- **케이스 문항은 암기가 아니라 매핑.** 요구사항 키워드(지연·컴플라이언스·예산·SLA·글로벌·성장)를 추출 → 서비스로 연결.
- **"이미 X를 쓰는 중"이면 마이그레이션 마찰 최소화**가 정답 방향(예: 온프레 Oracle → 리프트 우선, 재작성은 후순위).

---

## 1. 컴퓨트 선택 — 결정 트리

| 요구사항 신호 | 선택 | 이유 |
|------|------|------|
| OS 완전 제어·특정 커널·GPU/TPU 직접·기존 라이선스(BYOL)·리프트&시프트 | **Compute Engine** | IaaS 최대 자유도 |
| 기존 VMware 그대로 이전(재작성 없이) | **Google Cloud VMware Engine** | vSphere 그대로 |
| 쿠버네티스·마이크로서비스·이식성·복잡한 오케스트레이션·서비스메시 | **GKE** | 기본 **Autopilot**, 노드 세밀 제어 필요 시 Standard |
| 상태 없는 컨테이너·HTTP·0으로 스케일·이벤트 구동·빠른 배포 | **Cloud Run** | 서버리스 컨테이너, 사용량 과금 |
| 이벤트 글루·경량 함수(Pub/Sub·GCS 트리거) | **Cloud Run functions** (구 Cloud Functions) | FaaS |
| 대량 배치·HPC·큐 기반 잡 | **Batch** (또는 GKE) | 잡 스케줄링 |

**컴퓨트 비용 레버 (섹션 2·4 단골):**

| 상황 | 레버 |
|------|------|
| 중단 견디는 배치·스테이트리스 | **Spot VM** (최대 ~60-91%↓, 선점 가능) |
| 예측 가능한 상시 워크로드 | **CUD**(committed use, 1/3년 약정) |
| CE 상시 실행(약정 없이) | **SUD**(sustained use, 자동 할인) |
| 오버프로비저닝 | 커스텀 머신 타입 + **Active Assist 추천**으로 right-size |

→ 심화: [[/concept/cloud/06_compute_for_pca]] · [[/concept/cloud/04_gke_for_pca]]

---

## 2. 스토리지·DB 선택 — 매트릭스

| 데이터 성격 | 선택 |
|------|------|
| 비정형 객체(이미지·백업·로그·데이터레이크) | **Cloud Storage** |
| 파일 공유(NFS/SMB) | **Filestore** |
| VM 블록 디스크 | **Persistent Disk / Hyperdisk** |
| 관계형 OLTP, 리전 규모, MySQL/Postgres/SQLServer | **Cloud SQL** |
| 관계형인데 **글로벌·수평확장·강한 일관성·99.999%** | **Spanner** |
| NoSQL 초고쓰기·저지연(<10ms)·시계열·IoT·대규모 | **Bigtable** |
| NoSQL 문서형·모바일/웹·서버리스·오프라인 동기화 | **Firestore** |
| 인메모리 캐시(세션·DB 부하 완화) | **Memorystore** (Redis/Memcached) |
| 분석 DW·SQL·페타바이트·서버리스 | **BigQuery** |

**Cloud Storage 클래스 (라이프사이클 문항):**

| 접근 빈도 | 클래스 | 최소 저장기간 |
|------|------|------|
| 상시 | Standard | — |
| 월 1회 미만 | Nearline | 30일 |
| 분기 1회 미만 | Coldline | 90일 |
| 연 1회 미만·아카이브 | Archive | 365일 |

→ 라이프사이클 정책으로 자동 강등, 접근 예측 어려우면 **Autoclass**. 심화: [[/concept/cloud/08_databases_and_storage_for_pca]]

---

## 3. 네트워킹 — LB·하이브리드·프라이빗 접근

**로드밸런서 선택 (신 명칭):**

| 트래픽 | LB |
|------|------|
| 글로벌 L7 HTTP(S), Anycast, CDN·Cloud Armor 결합 | **Global external Application LB** |
| 리전 L7 HTTP(S) | **Regional external Application LB** |
| 글로벌 L4 TCP/SSL 프록시 | **Global external proxy Network LB** |
| 리전 L4 pass-through, **클라이언트 IP 보존**, UDP | **External passthrough Network LB** |
| 내부 L7 | **Internal Application LB** |
| 내부 L4 | **Internal passthrough Network LB** |

**하이브리드 연결 선택:**

| 요구 | 선택 | 대역/SLA |
|------|------|------|
| 빠르게·암호화·인터넷 경유·저대역 | **HA VPN** | 99.99% |
| 전용 사설·초고대역·코로케이션 | **Dedicated Interconnect** | 10/100 Gbps |
| 사설이나 파트너 경유·중대역 | **Partner Interconnect** | 50 Mbps~50 Gbps |
| VPC↔VPC 연결 | **VPC Peering**(비이행) / **Network Connectivity Center**(허브-스포크·이행) |

**프라이빗 접근 / 격리:**

| 목표 | 서비스 |
|------|------|
| VM에서 외부 IP 없이 Google API 접근 | **Private Google Access** |
| 관리형 서비스·게시자에 사설 접근 | **Private Service Connect (PSC)** |
| 여러 프로젝트가 네트워크 공유·중앙 관리 | **Shared VPC** |
| 데이터 유출 경계 | **VPC Service Controls** (→ 4장) |

→ 심화: [[/concept/cloud/03_vpc_for_pca]] · [[/concept/cloud/07_load_balancing_and_connectivity_for_pca]]

---

## 4. IAM & 보안 — 통제 매핑

**IAM 골격:**

- 계층: **조직 > 폴더 > 프로젝트 > 리소스**. 정책은 상속·합집합(allow), **Deny 정책이 우선**.
- 역할: **Basic(owner/editor/viewer) 지양** → **Predefined(최소권한)** → 필요 시 Custom.
- 서비스 계정: **키 만들지 마라**. 순서 = ① SA 리소스에 부착 → ② **impersonation(SA 가장)** → ③ 외부 워크로드는 **Workload Identity Federation**. GKE는 **Workload Identity**.
- **직무 분리(SoD):** KMS 키 admin ≠ 키 사용자, 로그 열람 ≠ 로그 설정.

**"이 문제엔 이 통제" 매핑 (섹션 3 핵심):**

| 문제 | 통제 |
|------|------|
| BigQuery/GCS에서 **데이터 반출 차단** | **VPC Service Controls**(경계) |
| VPN 없이 컨텍스트 인식 원격 접근·협력사 | **IAP** + **Access Context Manager** (Chrome Enterprise Premium / BeyondCorp) |
| 키를 코드/키파일 없이 외부 ID로 | **Workload Identity Federation** |
| 컴플라이언스로 **키를 내가 관리** | **CMEK (Cloud KMS)**; 외부 HSM/KMS는 **Cloud EKM**; 클라이언트 제공은 CSEK |
| 비밀번호·토큰·API 키 저장 | **Secret Manager** |
| PII 발견·분류·마스킹 | **Sensitive Data Protection (DLP)** |
| 조직 전역 가드레일(외부 IP 금지 등) | **Organization Policy Service** |
| L7 DDoS·WAF·지역 차단 | **Cloud Armor** |
| 중앙 보안 태세·취약점·위협 | **Security Command Center** |
| LLM 프롬프트/응답 안전(신규) | **Model Armor** |

→ 심화: [[/concept/cloud/05_iam_for_pca]] · [[/concept/cloud/09_security_for_pca]]

---

## 5. 마이그레이션 & DR

**마이그레이션 도구:**

| 대상 | 도구 |
|------|------|
| 평가·인벤토리·TCO | **Migration Center** |
| VM 리프트&시프트 | **Migrate to Virtual Machines** |
| DB 이관(동종/이종) | **Database Migration Service** |
| 대용량 온라인 전송 | **Storage Transfer Service** |
| 오프라인 페타바이트 | **Transfer Appliance** |
| DW 데이터 | **BigQuery Data Transfer Service** |

**6R 전략:** Rehost(리프트) · Replatform(살짝 개조) · Refactor/Rearchitect(재작성) · Repurchase(SaaS 전환) · Retire · Retain. → 시험은 대개 **속도·마찰 최소 = Rehost 우선**, 클라우드 네이티브 이점 요구 시 Refactor.

**DR 패턴 (RTO/RPO ↔ 비용 트레이드오프):**

| 패턴 | RTO/RPO | 비용 |
|------|------|------|
| Backup & Restore | 높음(시간~일) | 최저 |
| Cold standby | 중 | 낮음 |
| Warm / Pilot light | 낮음 | 중 |
| Hot / Active-active(멀티리전) | 최저(≈0) | 최고 |

도구: **Backup and DR Service**, PD 스냅샷, Spanner/GCS 멀티리전, 크로스리전 복제. → 심화: [[/concept/cloud/10_migration_and_dr_for_pca]]

---

## 6. 운영·구현·비용 (섹션 4·5·6)

**관측성·신뢰성:**

- **SLI**(측정값) → **SLO**(목표) → **Error Budget**(초과 시 릴리스 동결). 100% 가용성 목표는 오답.
- **Google Cloud Observability**: Monitoring·Logging·Trace·Profiler·Error Reporting.
- 배포 전략: **Rolling**(기본) · **Blue-Green**(즉시 롤백) · **Canary**(점진 검증). GKE 배포 파이프라인은 **Cloud Deploy**.
- 신뢰성 검증 목적 구분: **부하 테스트**(용량) · **카오스 엔지니어링**(장애 내성) · **침투 테스트**(보안).

**구현 도구:**

| 필요 | 도구 |
|------|------|
| API 게이트웨이·수익화·레이트리밋·협력사 노출 | **Apigee** |
| 인프라 코드화(멀티클라우드·상태 관리) | **Terraform** |
| CLI | **gcloud · gcloud storage(구 gsutil) · bq** |
| 로컬 테스트 | **Cloud Emulators** (Bigtable·Spanner·Pub/Sub·Firestore) |
| 아키텍처·운영 자연어 보조(신규) | **Gemini Cloud Assist** |

**비용 최적화 레버:** CUD·SUD·Spot · right-sizing 추천 · 예산·알림 · 스토리지 클래스/라이프사이클 · BigQuery(온디맨드 vs 슬롯 예약) · **CapEx→OpEx** 관점. → 심화: [[/concept/cloud/11_operations_and_cost_for_pca]]

---

## 7. GenAI — 아키텍트 관점 (신규 비중↑)

| 목적 | 서비스 |
|------|------|
| 아키텍처·운영·트러블슈팅 AI 보조 | **Gemini Cloud Assist** |
| 에이전트·RAG·앱 구축 | **Vertex AI / Agent Builder / Agent Platform** |
| 모델 카탈로그·오픈 모델 배포 | **Model Garden** |
| 대규모 학습·서빙 인프라(GPU/TPU) | **AI Hypercomputer** |
| LLM 입출력 안전·프롬프트 인젝션 방어 | **Model Armor** |
| AI 파이프라인 내 PII 처리 | **Sensitive Data Protection** |

→ 심화: [[/concept/cloud/12_genai_for_pca]]

---

## 8. 키워드 → 서비스 함정 매핑 (직전 암기용)

문항 속 이 표현이 보이면 이 답을 먼저 의심한다.

| 지문 키워드 | 정답 후보 |
|------|------|
| "글로벌·강한 일관성·수평확장 관계형" | **Spanner** |
| "초저지연·초고쓰기·시계열·IoT 텔레메트리" | **Bigtable** |
| "모바일 앱·오프라인 동기화·문서형" | **Firestore** |
| "DB 부하 완화·세션 캐시" | **Memorystore** |
| "페타바이트 분석·SQL·서버리스 DW" | **BigQuery** |
| "VPN 없이 협력사/재택 컨텍스트 접근" | **IAP + Chrome Enterprise Premium** |
| "BigQuery/GCS 데이터 반출 차단" | **VPC Service Controls** |
| "컴플라이언스로 암호화 키 직접 관리" | **CMEK(KMS)**, 외부는 **EKM** |
| "SA 키 없이 외부/온프레 워크로드 인증" | **Workload Identity Federation** |
| "빠르게 VM 그대로 옮김" | **Migrate to VMs** |
| "VMware 그대로" | **Google Cloud VMware Engine** |
| "중단 견디는 최저가 배치 컴퓨트" | **Spot VM** |
| "예측 가능 상시 워크로드 할인" | **CUD** |
| "협력사에 API 노출·수익화·쿼터" | **Apigee** |
| "10Gbps 전용 사설 하이브리드" | **Dedicated Interconnect** |
| "빠른 암호화 하이브리드 99.99%" | **HA VPN** |
| "0으로 스케일되는 상태없는 컨테이너" | **Cloud Run** |
| "조직 전역 강제 정책(외부 IP 금지 등)" | **Organization Policy** |
| "민감정보 스캔·마스킹" | **Sensitive Data Protection** |
| "중앙 보안 태세·위협 대시보드" | **Security Command Center** |
| "L7 DDoS·WAF" | **Cloud Armor** |

---

## 9. 자주 틀리는 함정 (오답 유도 패턴)

- **Basic role를 정답으로 고르면 대개 오답** — 최소권한 원칙 위반.
- **SA 키 발급·다운로드가 답이면 의심** — WIF/impersonation이 정답.
- **VPC Peering은 이행(transitive)되지 않는다** — 3자 연결은 NCC(허브-스포크).
- **passthrough LB만 클라이언트 IP 보존** — 프록시 LB는 못 함.
- **VPC Service Controls는 "반출 방지(경계)", IAM은 "권한"** — 둘을 혼동 유도.
- **CMEK ≠ CSEK ≠ EKM** — 각각 KMS 관리 / 클라이언트 제공 / 외부 KMS.
- **Cloud SQL은 리전, 글로벌 강한 일관성 요구 시 Spanner** — 규모로 갈린다.
- **100% SLO·"장애 절대 없음"은 항상 오답** — error budget 개념.
- **가장 비싼 멀티리전 active-active가 늘 정답은 아니다** — RTO/RPO 요구가 낮으면 backup&restore가 비용 정답.
- **"이미 온프레 대량 데이터"면 재작성보다 리프트/전송 도구 우선** — 마찰 최소.

---

> 이 치트시트는 심화 문서의 결론만 모은 인덱스다. 특정 항목이 흔들리면 해당 `[[...]]` 링크로 들어가 근거를 확인하라. 케이스 스터디 4종은 이 매핑을 요구사항에 적용하는 연습으로 대비한다 — 케이스별 딥다이브: [[/concept/cloud/14_case_altostrat_media_for_pca]] · [[/concept/cloud/15_case_cymbal_retail_for_pca]] · [[/concept/cloud/16_case_ehr_healthcare_for_pca]] · [[/concept/cloud/17_case_knightmotives_automotive_for_pca]]. 목록·성격은 [[/concept/cloud/00_pca_study_plan]] 참조.
