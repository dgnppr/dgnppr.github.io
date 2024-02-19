---
layout  : wiki
title   : JPA Dirty Checking 동작 해부하기
summary :
date    : 2024-02-18 00:00:00 +0900
updated : 2024-02-18 00:00:00 +0900
tag     : spring-boot jpa
toc     : true
comment : true
public  : true
parent  : [[/jpa]]
latex   : true
---
* TOC
{:toc}

## 본 글에 앞서

`JPA`에서 `Entity`의 변경을 감지하고 쓰기 쿼리를 날리는 것을 더티 체킹이라고 한다. 
이번 글에서는 `EntityManager`에서 어떤 식으로 더티 체킹을 하는지 디버거를 통해 알아보고, 더티 체킹의 단점과 대안에 대해서 정리해보고자 한다.

우선 더티 체킹의 동작에 앞서 JPA 주요 개념을 정리하고, 더티 체킹의 동작을 알아보자.

<br><br><br>

## JPA 주요 개념

### EntityManager, EntityManagerFactory

- 같은 트랜잭션이면 같은 엔티티 매니저인지 확인
- 다른 트랜잭션이면 다른 엔티티 매니저인지 확인

<br>

### PersistenceContext

- 같은 트랜잭션이면 같은 영속성 컨텍스트인지 확인
- 다른 트랜잭션이면 다른 영속성 컨텍스트인지 확인

<br>

### Entity Status

<br><br><br>

## Dirty Checking 동작

<br><br><br>

## 더티 체킹 장점/단점

- 성능 이슈
- 예측하지 못한 데이터베이스 쓰기 작업
- 코드 명확성 저하
- 트랜잭션 관리 복잡성
- 테스트 어려움

<br><br><br>

## 업데이트 명시하기

save(), saveAndFlush()

<br><br><br>

## 필자의 생각

<br><br><br>
  
## Ref

- https://medium.com/jpa-java-persistence-api-guide/dirty-checking-magic-in-hibernate-how-it-works-and-why-its-important-3cdb422dc4d4
- https://jojoldu.tistory.com/415
- https://vladmihalcea.com/the-anatomy-of-hibernate-dirty-checking/
- https://brunch.co.kr/@purpledev/32
- https://docs.jboss.org/hibernate/orm/6.4/introduction/html_single/Hibernate_Introduction.html
- https://thorben-janssen.com/6-performance-pitfalls-when-using-spring-data-jpa/#Pitfall_2_Calling_the_saveAndFlush_method_to_persist_updates
- https://velog.io/@wisepine/JPA-%EC%82%AC%EC%9A%A9-%EC%8B%9C-19%EA%B0%80%EC%A7%80-Tip