---
layout  : wiki
title   : 알림 서비스 시스템 디자인
summary :
date    : 2024-01-30 00:00:00 +0900
updated : 2024-02-05 00:00:00 +0900
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

### 알림 provider

<img src="https://github.com/dgnppr/dgnppr.github.io/assets/89398909/860bd71f-f64a-44d5-862c-25d5340dca2b" height="600">

위 그림처럼 각기의 단말기(iOS,AOS, SMS, 이메일)는 알림 Provider가 다르기 때문에 알림 메커니즘이 다르다.

- iOS = APNS
- AOS = FCM
- SMS = Twilio, Nexmo 등
- 이메일 = SendGrid, Mailgun 등

<br>

### 알림 대상 정보 수집

![Screenshot 2024-02-05 at 00 26 15@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/3f8629bf-2cde-4f9e-86f1-328a6f04bf1b)

알림을 보내려면 클라이언트 단말기 정보를 알아야할 것이다.
이를 위해서 클라이언트가 앱을 설치할 때나 계정을 생성할 때 단말기나 사용자 정보를 수집한다.

![Screenshot 2024-02-05 at 00 29 52@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/6b16d3ae-5bfb-4ca5-8384-e9fbdc57bca8)

추가로, 사용자가 알림을 받을지 여부를 설정할 수 있도록 해야한다.
알림 타입 별 혹은 단말기 별로 알림을 받을지 여부를 설정할 수 있도록 해야한다.

- `user` 테이블에 `notification_enabled` 필드를 추가할 수 있다. 
  - 추가로 알림 타입 별로 지정할 경우 `update_notification_enabled`와 같이 추가할 수 있다.
- `device` 테이블에 `notification_enabled` 필드를 추가한다

<br>

### 비동기 병렬 알림 전송

![Screenshot 2024-02-05 at 03 48 33@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/5c01fd1e-7d59-4d4c-82cd-ff7c8af80f5f)

알림 서버는 컨테이너 기반으로 동작하는 서버리스를 사용하여 알림을 전송한다. 
서버 인스턴스 관리나 스케일링을 신경쓰지 않아도 되고 이벤트 기반으로 동작하게 구성하여 요청에 따라 독립적으로 실행할 수 있다는 장점이 있다.

데이터 저장소로 ElasticCache를 사용하여 클라이언트 및 디바이스 정보를 캐싱하고, DynamoDB를 사용하여 클라이언트 및 디바이스 정보를 저장한다.

멀티 메시지 큐를 도입하여 비동기 병렬 알림 전송이 되도록 구성했다.
알림 타입마다 데이터 전송 모델이 다르기 때문에, 별도의 SQS 큐를 사용하여 각각의 알림을 전송하도록 구성했다.
타입별로 분리하여 전송하면 메시지 처리가 용이해지고, 타입별로 다른 처리 로직을 적용할 수 있다. 
각 큐가 독립적으로 스케일링될 수 있어, 특정 알림에 대한 트래픽 증가가 다른 알림 큐에 영향을 미치지 않게할 수 있고 각 큐에 대한 모니터링과 알림을 설정할 수 있다.

람다로 알림 provider 에게 알림을 전송하도록 구성했다. SQS 큐에 메시지가 들어오면 람다가 실행되어 알림을 전송한다.

<br>

### 알림 전송 API

알림 서버 주소를 `https://api.internal.dgpr.com`이라고 가정했을때, `https://api.internal.dgpr.com/v1/notifications`로 알림을 전송한다.

```json
{
  "userId": "-",
  "notificationId": "-",
  "serviceType": "-",
  "categoryType": "-",
  "notificationType": "-",
  "templateType": "-",
  "notificationInfo": {
    "title": "새로운 계정 활동 알림",
    "content": "여러분의 계정에 새로운 활동이 있습니다."
  },
  "metadata": {
    "deviceInfo": "iOS",
    "sendTime": "2024-02-05T12:00:00Z"
  }
}
```

훨씬 복잡하게 구성되겠지만 간단하게 위와 같이 전송할 수 있다. 디바이스 정보와 같은 메타데이터는 정책에 따라 달라질 수 있다.
클라이언트에서 위와 같이 정해서 보내줄 수도 있고, 알림 서버에서 사용자 정보와 디바이스 정보를 가져와서 알림이 켜져있으면 큐로 보내는 방식으로 구현할 수 도 있다.

<br><br><br>

## 상세 설계

### 메시지 큐 장애 상황

알림 서버에서 메시지 큐로 이벤트를 발행할 때 메시지 큐에 장애가 발생하면 어떻게 해야할까?
이럴 경우에는 이벤트를 데이터베이스에 저장해두고, 메시지 큐가 복구되면 데이터베이스에 저장된 이벤트를 메시지 큐로 다시 발행하도록 구성할 수 있다.

![Screenshot 2024-02-05 at 03 50 19@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/14080874-2dcd-471f-975e-0b4dd28f88a8)

이벤트를 저장하는 데이터베이스는 어떤 것을 사용해야할까? `RDS`,`DynamoDB`,`SQS` 등을 사용할 수 있는데, `DynamoDB`를 사용하면 이벤트를 저장하고 검색할 수 있어서 좋을 것이다.
이유는 이벤트나 로그 같은 정보는 거의 변경되지 않고, 읽기 성능이 뛰어나며, 데이터 스키마를 유연하게 저장 가능하며, TTL 기능 등이 있기 때문이다.

알림 서버에서는 메시지 큐에 이벤트를 발행하고, 이벤트를 DB에 저장한다. 이벤트를 DB에 저장할 때 이벤트 발행 상태값(eg. 발행됨, 발행 실패)을 저장한다.
별도의 워커를 생성하거나 스케쥴러에서 저장된 이벤트 중 메시지 큐에 발행되지 않은 이벤트 상태를 쿼리하여 메시지 큐에 다시 발행하도록 구현한다.

<br>

### 알림 중복 전송 방지

알림을 중복해서 전송하는 것을 방지하기 위해서는 중복 전송을 방지하는 메커니즘이 필요하다.
간단하게 보내야 할 알림이 도착하면, 이벤트 ID를 조회하여 중복된 이벤트인지 확인하고, 중복된 이벤트라면 전송을 하지 않도록 구성할 수 있다.

![Screenshot 2024-02-05 at 04 04 52@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/e8737f00-feac-4f49-bdce-440578fdb6e6)

중복된 이벤트를 저장하는 공간으로 `DynamoDB`를 사용하여, 써드 파티로 요청하기 전에 중복된 이벤트인지 조회한 후 이미 전송된 데이터일 경우 전송하지 않도록 한다.
전송되지 않은 이벤트라면 DB에 저장한다. `DynamoDB` 말고도 `ElasticCache Redis`를 사용하여 핸들링하는 방법도 좋을 것 같다. 두 개의 저장소 모두 TTL 기능을 제공하기 때문에, 중복 이벤트를 저장하고 일정 시간이 지나면 자동으로 삭제할 수 있다.

<br>

### 알림 Provider 장애 상황

만약 알림 Provider 에서 장애가 발생한다면 어떻게 해야할까?

장애가 발생한 알림 이벤트를 재시도 전용 큐 혹은 이벤트 전송 저장소에 넣어서 재시도하는 방법이 있다.  
별도의 람다 또는 워커로 구성하여 전송되지 않은 이벤트를 주기적으로 조회하여 재시도하도록 구성할 수 있다.

<br>

### 우선순위 알림 전송
 
알림에도 우선순위가 있을 수 있다. 예를 들어, 도메인은 다르지만 긴급 재난 문자 같은 알림이 택배 배송 알림보다는 우선 순위가 높아야 할 것이다.

아쉽게도 `SQS`는 우선순위 큐를 지원하지 않는다. 그렇기 때문에 별도의 멀티 큐를 만들어서 우선순위를 구현할 수 있다.

![Screenshot 2024-02-05 at 04 29 55@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/b9aed651-3207-4f57-a02f-862bd04c483c)

이벤트 소스 매핑으로 SQS를 우선순위에 따라 polling해서 람다를 실행하도록 구성할 수 있다. 
[다음 공식 문서](https://docs.aws.amazon.com/ko_kr/lambda/latest/dg/invocation-eventsourcemapping.html)를 참고하였다.

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
- https://bravenewgeek.com/you-cannot-have-exactly-once-delivery/
- https://techblog.woowahan.com/7425/
- https://lucvandonkersgoed.com/2022/04/25/implement-the-priority-queue-pattern-with-sqs-and-lambda/