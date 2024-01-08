---
layout  : wiki
title   : URL Shortener 서비스 설계
summary :
date    : 2024-01-07 00:00:00 +0900
updated : 2024-01-07 00:00:00 +0900
tag     : level-2 leaf system-design
toc     : true
comment : true
public  : true
parent  : [[/system-design]]
latex   : true
---
* TOC
{:toc}

## 서론

긴 URL을 짧은 URL로 변환하여 리디렉션해주는 서비스을 설계하는 글을 작성해보려고 한다.

해당 주제는 가상 면접 사례로 배우는 대규모 시스템 설계 기초를 참고하였다.

글 후반부에는 요구 사항을 추가하여 설계된 서비스를 고도화 해보려고 한다.

<br><br><br>

## 요구사항

요구사항은 아래와 같다.

- 매일 1억개의 Shorten URL 생성할 수 있어야 함
  - 숫자(0~9), 영문자(a~z, A~Z)로 구성되어야 함
  - Shorten URL은 짧으면 짧을수록 좋음
- Shorten URL은 삭제하거나 업데이트할 수 없음 
- 생성된 URL로 접속하면 원래 URL로 리다이렉트 되어야 함
- 높은 가용성(A), 장애 감내(P)를 보장해야함
- Scalable 해야함

### 높은 가용성과 장애 감내의 차이

높은 가용성은 서비스 중단이 허용되는 최소의 시간이 존재한다. 예를 들어, 99.9%의 가용성을 보장한다면, 1년 중 8시간 45분의 서비스 중단이 허용된다.
반면, 장애 감내는 서비스 중단이 허용되지 않는다. 하드웨어, 소프트웨어 등 결함이 발생하더라도 다른 부분이 자동으로 역할을 대체하여(백업, 복제 등) 서비스가 정상적으로 작동해야 함을 의미한다. 

**2개의 차이는 서비스 중단(다운타임)이 허용되는지 여부이다.**

<br><br><br>

## 개략적 추정

매일 1억개의 Shorten URL을 생성할 수 있어야하고, 서비스를 10년간 운영한다고 가정해보자.

쓰기 연산과 읽기 연산의 비율은 10:1로 가정한다.

이를 통해 아래와 같이 연산 속도와 저장 용량을 추정할 수 있다.

- 초당 쓰기 연산: 1억 / (24 * 3600) = 1157
- 초당 읽기 연산: 1157 * 10 = 11570
- 최소 저장 용량: 3650억 *  100bytes = 36.5TB
  - 생성된 URL 개수: 1억 * 365 * 10 = 3650억 개
  - 축약 전 URL 길이: 100bytes


<br><br><br>

## API 엔드포인트 설계

- URL 단축용 엔드포인트: `POST /api/v1/shorten`
  - 요청 바디: `{ "url": "https://en.wikipedia.org/wiki/system_design" }`
- URL 리디렉션 엔드포인트: `GET /api/v1/{shortenUrl}`
  - 원래의 URL로 302 응답 코드로 반환

<br><br><br>

## 상세 설계

### 데이터베이스 선택

10년간 서비스를 저장하기 위해서 필요한 최소 저장 용량은 36.5TB이다.

이 많은 데이터를 휘발성 메모리에 저장할 수 없기 때문에 영속성을 제공하는 데이터베이스에 저장해야 한다.

이는 하나의 서버로는 저장할 수 없는 양이다. 초반에는 RDB, NoSQL 모두 읽기 성능이 크게 차이가 없겠지만 데이터가 쌓였을 때 샤딩 작업이 필요할 것이다.    

쓰기 연산보다 읽기 연산이 월등하게 많다는 점, HA와 FT를 보장해야 한다는 점, Scalable 해야 한다는 점, 샤딩 작업이 필요하다는 점을 고려하여 NoSQL 데이터베이스를 선택한다.

<br>

### 데이터 모델링

데이터베이스에 저장할 데이터는 아래와 같다.

- Shorten URL(Unique Key)
- Original URL

### 쓰기 전략

`URL`을 단축하는 방법이 서비스의 핵심이다.

URL을 짧은 URL로 단축 알고리즘에 대해서 생각을 해봐야한다.

해시함수(ex: CRC32, MD5, SHA-1) 또는 압축 알고리즘(ex: Base64, LZW, Huffman)을 사용하여 shortURL을 생성할 수 있다.

해시와 압축 알고리즘을 비교해보면

| 해시 함수                   | 압축                                      |
|-------------------------|-----------------------------------------|
| 단축 URL의 길이를 고정시킬 수 있다   | 단축 URL의 길이가 가변적이다. 원래 URL이 길어지면 같이 길어진다 |
| 유일성을 보장하는 ID 생성기가 필요치 않음 | 유일성 보장 ID 생성기가 필요하다                     |
| 충돌 처리가 필요하다             | 유일성이 보장되므로 충돌 처리가 필요하지 않다               |
| 다음 shortURL을 유추할 수 없다   | 다음 shortURL을 유추할 수 있다                   |

<br>
초당 1157개의 쓰기 연산을 처리해야 하는데, 해시함수를 사용할 경우 충돌이 발생할 가능성이 있다. 해시 함수의 경우 유니크를 보장하기 위해서 DB에 쿼리를 날려야 하고 이 과정이 DB에 부하가 발생할 수 있고, 충돌 발생 시 핸들링하는 전략을 세워야하고, 응답 시간을 늦어질 수 있다. 따라서 압축 알고리즘을 사용하는 것이 적합하다.

유일성을 보장하는 ID를 생성하는 ID 생성기를 사용하고, 생성된 ID를 압축 알고리즘을 사용하여 단축 URL을 생성한다. 이렇게 함으로써, DB에 부하를 줄일 수 있고 응답 시간을 빠르게 할 수 있다. 
하지만, ID를 생성해야 하기 때문에 ID를 생성하는 ID 생성기가 필요하다는 단점이 있다.

쓰기 연산에 대한 시퀀스를 그려보면 아래와 같다.

![Screenshot 2024-01-08 at 13 24 27](https://github.com/dragonappear/dragonappear.github.io/assets/89398909/3ce2c32c-b8f5-4aa1-8ca0-9431a9741c10)

<br>

### ID 생성 로직

ID 생성기에서 유일성이 보장된 ID를 생성해줘야한다. **ID 생성기에서 가장 중요한 것은 Scalable ,유일성 보장, DB 독립적, 빠르게 생성해줘야 한다는 것이다.**

- UUID
- Snowflake

위 두가지 방법으로 ID를 생성할 수 있는데, UUID는 128bit의 길이를 가지고 있고, Snowflake는 64bit의 길이를 가지고 있다. 길이에 따라 shortURL의 길어지기 때문에 Snowflake를 사용하는 것이 적합하다.
UUID는 길이가 길기 때문에 16bytes이기 때문에 저장 공간 차원에서 Snowflake를 사용하는 것에 비해 비효율적이며, UUID는 랜덤하게 생성되기 때문에 DB에 쿼리를 날려서 유니크를 보장해야 하고, Snowflake는 시퀀스를 사용하기 때문에 DB에 쿼리를 날릴 필요가 없다.

여러가지 관점에서 Snowflake를 사용하는 것이 적합하다.

Snowflake는 8bytes로 구성되어 있고, Scalable, 유일성 보장, DB 독립적, 빠르게 생성해야한다는 요구사항을 만족한다.

1비트(사인 비트) + 타임스탬프(41비트) + 데이터센터 ID(5비트) + 워커 ID(5비트) + 시퀀스(12비트)로 구성되어 있다.

타임스탬프는 41비트로 구성되어 있기 때문에 69년간 사용할 수 있다. 2039년까지 사용할 수 있기 때문에, 10년간 사용할 수 있는 서비스에는 적합하다.

<br>

### 읽기 전략

![Screenshot 2024-01-08 at 13 34 16](https://github.com/dragonappear/dragonappear.github.io/assets/89398909/b27804b5-1e78-4788-abca-eff2d7248357)

부하 분산을 위해서 로드밸런서, 디스크 I/O 비용을 줄이기 위해서 인메모리 캐시 서버를 도입하였다.

인메모리 캐시 서버에는 Redis, Memcached가 있다. Redis는 Memcached의 캐시 기능에 저장소의 개념이 추가된 것으로 볼 수 있는데 Redis 만의 특성 때문에 응답 속도가 균일하지 않을 수 있고(메모리 압축), 장애(RDB로 인한 메모리 이슈)가 발생할 여지가 있다.

캐시 서버에 저장할 데이터 모델이 Key-Value로 저장할 수 있기 때문에 특별한 상황이 아니라면 List, Hash, Set, Sorted Set 등 다양한 자료구조를 사용할 필요가 없어보인다.

클러스터링을 통해 확장할 수 있어야 하는데, Redis 와 Memcached 모두 클러스터링을 지원한다.

여러가지 조건을 따져봤을 때 Memcached를 사용하는 것이 적합하다.

<br><br><br>

## 장애 상황

장애가 발생할 수 있는 상황을 생각해보자. 

### Cache 서버 장애 및 핸들링

캐시에 장애가 나면 일차적으로 어떤 상황이 발생하고 어떻게 예방해야할까?

캐시에 장애가 나면 아래와 같은 상황이 발생할 수 있다.

- 캐시 서버에 저장된 데이터가 모두 사라진다.
- 캐시 서버에 저장된 데이터가 모두 사라지기 때문에, 캐시 서버에 저장된 데이터를 읽어오기 위해서 DB에 쿼리를 날려야 한다.
- 일시적으로 DB에 트래픽이 튀기 때문에 DB에 부하가 발생한다.
- DB에 부하가 발생하기 때문에 DB에 장애가 발생할 수 있다.
- DB에 장애가 발생하면 서비스가 중단될 수 있다.

캐시 서버에서 발생한 장애가 서비스 중단으로 이어질 수 있다. 캐시를 도입하면 부하를 줄일 수 있지만, 그만큼 위험 요소도 존재한다. 

**이를 위해서 캐시 서버에 장애가 발생하더라도 서비스가 중단되지 않도록 하기 위해서 클러스터링하여야 한다.**

<br>

### Database 서버 장애 및 핸들링

데이터베이스에 장애가 나면 일차적으로 어떤 상황이 발생하게될까?

<br><br><br>
  
## 추가 요구 사항 - Shorten URL 만료 + 삭제

<br><br><br>

## 추가 요구 사항 - Shorten URL 통계

<br><br><br>

## 참고



