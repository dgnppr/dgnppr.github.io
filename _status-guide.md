# Post Status Guide

## Status Options

### `complete`
- 포스트가 완성되었고, 내용이 정확하고 최신 정보를 담고 있음
- 별도의 수정 계획이 없음

### `needs-update`
- 포스트의 정보가 부분적으로 오래됨
- 기술 업데이트, 버전 변경, 더 나은 실무 방식 등이 반영 필요
- 예: "Spring Boot 2.x를 다루지만 3.x가 나왔음"

### `deepen`
- 포스트 주제를 더 깊이 있게 다루고 싶음
- 현재 내용은 정확하지만, 심화 내용 추가 계획
- 예: "Kafka 기본만 다루지만, 성능 최적화까지 넓히고 싶음"

### `wip`
- 작성 중인 포스트
- 아직 완성되지 않음

### `draft`
- 초안 단계
- 검토 필요

## Usage

```yaml
---
title: JPA 트랜잭션
status: complete
note: Spring Boot 3.x 기준, 최신 정보 반영됨
---
```

또는

```yaml
status: needs-update
note: 다음 업데이트: Kafka 3.0 성능 개선 사항 추가
```
