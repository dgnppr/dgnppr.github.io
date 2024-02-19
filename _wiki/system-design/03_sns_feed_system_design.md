---
layout  : wiki
title   : SNS 피드 시스템 디자인
summary :
date    : 2024-02-15 00:00:00 +0900
updated : 2024-02-15 00:00:00 +0900
tag     : system-design
toc     : true
comment : true
public  : true
parent  : [[/system-design]]
latex   : true
---
* TOC
{:toc}

## 요구사항

- 기능
  - 웹, 모바일 모두 지원한다.
  - 사용자가 팔로우한 사람의 새로운 포스팅을 최신순으로 보여준다.
  - 사용자는 피드에 새로운 포스팅을 추가할 수 있다.
- 1억 DAU
- 포스팅은 텍스트, 이미지, 비디오 등의 미디어 파일로 구성

<br><br><br>

## 개략적 추정

- 쓰기/읽기 요청
  - 포스팅 쓰기 평균 1건/일/사용자 -> 10,000,000 / (60 * 60 * 24) = 115.7 per second
  - 포스팅 읽기 평균 100건/일/사용자 -> 10,000,000 * 100 / (60 * 60 * 24) = 1,157 per second
  - 팔로우 평균 100명/사용자

- 포스팅 저장 공간
  - 텍스트 평균 크기 = 1KB, 이미지 평균 크기 = 1MB, 비디오 평균 크기 = 10MB
  - 포스팅 미디어 비율 예상 = 이미지 80%, 비디오 19%, 텍스트 1%
  - 일 평균 포스팅 저장 용량 = (1KB * 0.01 + 1MB * 0.8 + 10MB * 0.19) * 10,000,000 = 약 3TB
  - 년 평균 포스팅 저장 용량 = 3TB * 365 = 1PB

- 대역폭
  - 포스팅 쓰기 대역폭 = 115.7/s * 3MB = 347.1MB/s


<br><br><br>

## 개략적 설계

### 데이터 모델

![Screenshot 2024-02-17 at 22 54 55](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/0e8065df-ba48-42ff-b217-61025814e3d0)

사용자, 팔로우, 포스팅 테이블로 구성되어있다. 팔로우 테이블에는 누가 누구를 팔로우하고 있는지 저장한다. 포스팅 테이블에는 포스트 미디어 데이터를 저장한다.

<br>

### 포스팅 쓰기

![Screenshot 2024-02-17 at 22 50 59](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/1c5cd9c5-aefa-4029-9bb0-8be0f7092f35)

<br>

```http
POST /v1/feeds
Content-Type: application/json
Authorization: Bearer {access_token}

{
  "media": [
    {
      "type": "image",
      "url": "https://example.com/1.jpg"
    },
    {
      "type": "image",
      "url": "https://example.com/2.jpg"
    },
    {
      "type": "video",
      "url": "https://example.com/1.mp4"
    }
  ],
  "text": ""
}
```

사용자가 포스팅을 쓰면 포스팅 저장 서비스에서 새로운 포스팅을 DB와 캐시에 저장한다. 그리고 팔로워에게 알림을 보낸다.

### 포스팅 읽기

![Screenshot 2024-02-17 at 22 53 16](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/4f7a44b9-ea93-4d9d-a035-1c47d107bf67)

<br>

```http
GET /v1/feeds
Content-Type: application/json
Authorization: Bearer {access_token}
```

<br>

사용자는 자신이 팔로우한 사람들의 포스팅을 최신 순으로 볼 수 있다. 포스팅 저장 서비스에서 캐시에 저장된 포스팅을 가져와서 사용자에게 보여준다.


<br><br><br>

## 상세 설계

<br>

### 읽기 작업 최적화

새로운 포스팅을 저장할 때 포스팅 테이블만 업데이트하고, 피드 읽기 요청이 왔을 때 
아래처럼 팔로워가 자신이 팔로우하는 사람들의 포스팅을 조회하는 쿼리를 매 팔로워의 요청마다 실행한다고 가정해보자
```sql
SELECT post.*, user.*
FROM post 
JOIN user ON post.sender_id = user.id
JOIN follow ON follow.followee_id = user.id
WHERE follow.follower_id = {user_id}
```

테이블의 크기가 커질수록 그리고 피드 읽기 요청 수가 많아질수록 이 쿼리는 느려질 것이다.
이처럼 쓰기 작업은 단순화되었지만, 읽기 작업에서 병목이 발생할 수 있다.
**피드를 읽는 요청이 포스트 쓰기 요청보다 많기 때문에 읽기 최적화 작업이 필요하다.**

<br>

이 문제를 해결하기 위해 팔로워의 피드를 미리 계산해두는 방법을 사용할 수 있다. 
예를 들어, `yong`을 `hyun`이 팔로우하고 있을때, `yong`이 새로운 포스팅을 쓰면 `hyun`의 피드 캐시에 새로운 포스팅을 추가하는 것이다.
캐시에 업데이트를 함으로써 피드를 읽는 작업이 훨씬 간단해진다.

![Screenshot 2024-02-17 at 23 11 30](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/60e5e38a-79a1-456d-8e65-87592aedcfb7)

`hyun`의 피드를 읽을때 피드 캐시에 저장된 `id` 값을 기준으로 포스팅을 읽어오기만 하면된다.

<br>

### 인플루언서

특정 사용자(eg. justin bieber)는 팔로워가 1억명을 넘는다. 이러한 사용자가 포스팅을 업데이트했을때 모든 팔로워의 피드를 업데이트하는 것은 상당히 비효율적이다.
따라서, **인플루언서의 쓰기 로드는 다른 방식으로 동작해야한다.**

우선 기존 데이터 모델을 아래와 사용자 테이블에 사용자가 인플루언서인지 나타내는 필드를 추가한다.

![Screenshot 2024-02-17 at 23 24 46](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/7dbd7253-ed84-407e-8822-2bf989a95fe1)
 
인플루언서가 아닌 사용자 `A`가 새로우 포스팅을 작성하면 `A`를 팔로우하는 팔로워들의 피드 캐시에 새로운 포스팅을 업데이트 해준다.
**인플루언서 `B`가 새로운 포스팅을 작성하면, 포스팅 테이블에 저장하고 추가적인 쓰기 작업은 수행하지 않는다.**

**사용자 `C`가 피드를 조회할 때는 `C`의 피드 캐시 조회 + `C`가 팔로우하는 인플루언서의 포스팅을 DB 쿼리하는 방식을 사용한다.**

간단하게 정리하면 아래와 같이 동작한다.

1. 사용자의 피드 캐시 조회
2. 사용자가 팔로우하는 인플루언서의 포스팅 DB 쿼리
3. 포스팅을 최신 순으로 정렬하여 사용자에게 응답

![Screenshot 2024-02-17 at 23 39 36](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/e8c1fbac-bc7f-40a7-bc15-b29038504c96)

<br>

### 캐시 구조

![Screenshot 2024-02-17 at 23 45 53](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/0539ed8f-a1dd-4ec8-9a3c-6f647a6fc2cb)

- 피드 캐시
  - 사용자마다 피드 리스트(포스팅 ID, 작성자 ID)를 저장한다.
- 사용자 정보 캐시
  - 사용자마다 팔로워 Set, 팔로잉 Set을 저장한다.
- 포스팅 캐시
  - 인플루언서가 작성한 포스팅과 일반 사용자가 작성한 포스팅을 구분하여 저장한다.

<br><br><br>

## 정리

읽기, 쓰기 워크로드에 따라 데이터 쓰기 전략이 달리질 수 있다.
일반적인 웹 애플리케이션에서는 쓰기 작업보다 읽기 작업이 많기 때문에 읽기 작업을 최적화하는 것이 중요하다.

<br><br>

## 참고

- https://d2.naver.com/helloworld/551588
- https://engineering.fb.com/2020/12/10/web/how-instagram-suggests-new-content/
- https://engineering.fb.com/2023/12/19/core-infra/how-meta-built-the-infrastructure-for-threads/
- https://nikhilgupta1.medium.com/instagram-system-design-f62772649f90
- https://www.youtube.com/watch?v=6QwqtdBx0oE
- https://www.youtube.com/watch?v=o5n85GRKuzk
