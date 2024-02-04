---
layout  : wiki
title   : 알림 시스템 디자인 with AWS
summary :
date    : 2024-01-30 00:00:00 +0900
updated : 2024-01-30 00:00:00 +0900
tag     : system-design
toc     : true
comment : true
public  : true
parent  : [[/system-design]]
latex   : true
---
* TOC
{:toc}

## 인트로

최신 뉴스, 제품 업데이트, 이벤트, 변경 사항 등 사용자에게 알림을 보내는 것은 어플리케이션 개발을 넘어서서 비즈니스 전략의 중요한 부분이다.
알림은 인앱 메시지, 이메일, SMS, 모바일 푸시 알림 등 다양한 형태로 전달될 수 있다.
하루에 천만건 이상의 알림을 처리하는 대규모 알림 시스템을 AWS 서비스를 이용하여 디자인해보겠다.

<br><br><br>

## 요구사항

- 알림 지원
  - 푸시 알림(iOS, AOS, 랩톱/데스크톱)
  - SMS
  - 이메일
- 연성 실시간 시스템(Soft real-time)
  - 알림 전송 지연 시간은 10초 이내
- 알림 비활성화
  - 사용자가 알림을 비활성화할 수 있어야 한다.
- 알림 전송 클라이언트
  - 알림을 전송하는 클라이언트는 다양할 수 있다.
- 알림 저장
  - 분석을 위해 데이터 저장소에 알림을 저장해야 한다.
- 알림 분석
  - 푸시 알림이 성공적으로 전송되었는지 확인할 수 있어야 한다.

<br><br><br>

## 개략적 추정

- 일일 알림 전송량
  - 푸시 알림 = 천만건
  - SMS = 백만건
  - 이메일 = 오백만건
- 데이터 크기
  - 모바일
    - 평균 크기 = 1KB
    - 일 평균 크기 = 1KB * 10,000,000 = 10GB
  - SMS
    - 평균 크기 = 약 160바이트
    - 일 평균 크기 = 160B * 1,000,000 = 160MB
  - 이메일
    - 평균 크기 = 100KB(텍스트와 이미지 포함)
    - 일 평균 크기 = 100KB * 5,000,000 = 500GB
- 일 평균 저장 용량 = 10GB + 160MB + 500GB = 510GB
  - 10년 저장 용량 = 510GB * 365 * 10 = 1.8PB

<br><br><br>

## 개략적 설계

알림을 

<br><br><br>

## 상세 설계

<br><br><br>

## 추가적인 상황

### 쓰기 연산 증가

<br>

### 벌크성 알림 전송

<br>

### 알림 우선순위 설정

<br>

### Pull 메커니즘 도입

<br>

### 알림 트레이스

<br><br><br>

## 참고

- https://product.kyobobook.co.kr/detail/S000001033116
- https://www.youtube.com/watch?v=CmTO68I2HSc
- https://d2.naver.com/helloworld/1022966
- https://netflixtechblog.com/rapid-event-notification-system-at-netflix-6deb1d2b57d1
- https://netflixtechblog.com/building-a-cross-platform-in-app-messaging-orchestration-service-86ba614f92d8
- https://engineering.linecorp.com/ko/blog/LINE-integrated-notification-center-from-redis-to-mongodb
- https://discord.com/blog/building-delightful-notifications-using-ml
- https://slack.engineering/how-slack-built-shared-channels/
- https://slack.engineering/tracing-notifications/
