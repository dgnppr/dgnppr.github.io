---
layout: portfolio
title: 준실시간 커머스 변경 동기화
summary: 상품·주문·클레임 변경을 외부 파트너와 순서·정합성을 지키며 동기화하는 이벤트 기반 파이프라인을 운영했습니다.
company: 교보문고
period: 2024.03 — 2025.04
role: Software Engineer
category: realtime
category_label: Real-time Systems
order: 3
public: true
result: 일 50만 이벤트 · SLA 5분
stack: [Java, Kafka, Spring Boot, PostgreSQL, Redis]
outcomes:
  - 상품 상태 100만 건 이상과 일 50만 건의 비즈니스 이벤트를 처리했습니다.
  - 5분 SLA 안에서 FIFO와 Exactly-once 보장을 고려한 변경 동기화를 운영했습니다.
---

## 문제

상품·주문·클레임 데이터의 변경은 여러 파트너 시스템과 빠르게 동기화되어야 했고, 중복·순서 역전·부분 실패가 발생해도 데이터 정합성을 유지해야 했습니다.

## 담당한 설계

- Java·Kafka·Spring Boot 기반으로 상품, 주문, 클레임 변경 이벤트의 처리 흐름을 운영했습니다.
- OLTP 트랜잭션 안에 outbox를 기록하고 별도 relay가 Kafka로 발행하는 transactional outbox 패턴을 적용했습니다.
- 파트너별 처리 특성을 고려해 순서 보장, 중복 처리, 재시도 경로를 설계했습니다.
- PostgreSQL·Redis를 포함한 운영 환경에서 장애 시 복구와 재처리가 가능한 흐름을 유지했습니다.

## 결과와 운영 원칙

동기화 성공 여부만 보지 않고, 변경의 순서와 재처리 가능성까지 운영 계약으로 다뤘습니다. 파트너별 내부 연동 규격과 운영 식별 정보는 공개하지 않습니다.
