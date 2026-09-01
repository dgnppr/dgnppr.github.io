---
layout: portfolio
title: CDP 데이터 플랫폼 구축·운영
summary: 고객 데이터와 CRM 활용을 연결하는 데이터 계층을 설계하고, 운영 가능한 표준과 품질 검증 체계를 구축했습니다.
company: 롯데하이마트
period: 2025.04 — 현재
role: Data Engineer
category: data
category_label: Data Platform
order: 1
public: true
result: 6개 도메인 · 100+ 모델 운영
stack: [BigQuery, Dataform, Airflow, Pub/Sub, Braze]
outcomes:
  - BigQuery·Dataform 기반 메달리온 아키텍처로 6개 도메인, 100개 이상의 모델을 운영합니다.
  - 표준 계층과 소비 마트를 분리해 데이터 정의와 활용 경로를 명확히 했습니다.
---

## 문제

고객 데이터가 ERP·웹 분석·CRM 등 여러 시스템에 분산되어 있어, 분석과 캠페인 활용에서 같은 지표와 고객 상태를 신뢰하기 어려운 환경이었습니다. 모델을 만드는 것뿐 아니라 변경·품질·재처리까지 운영 가능한 구조가 필요했습니다.

## 담당한 설계

- BigQuery와 Dataform 기반의 메달리온 계층을 설계하고, 표준 데이터와 목적별 소비 마트를 분리했습니다.
- ERP 원천부터 GCS·BigQuery·Braze·Looker까지 이어지는 적재 및 활용 경로를 구성했습니다.
- 차원 이력 관리와 해시 기반 변경 감지, assertion을 결합해 변경과 품질 검증이 재현되도록 했습니다.
- GA·Amplitude 등 다중 소스 적재에는 파티션 단위의 멱등 처리와 파티션·클러스터링 최적화를 적용했습니다.

## 결과와 운영 원칙

데이터 모델의 수가 늘어나도 정의와 검증 기준이 흩어지지 않도록, 모델·테스트·메타데이터를 함께 운영했습니다. 공개 포트폴리오에서는 고객 식별 정보와 내부 지표 정의를 제외하고, 구조와 운영 원칙만 다룹니다.
