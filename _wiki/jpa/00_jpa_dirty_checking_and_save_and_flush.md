---
layout  : wiki
title   : JPA Dirty Checking, saveAndFlush()
summary :
date    : 2024-02-16 00:00:00 +0900
updated : 2024-02-16 00:00:00 +0900
tag     : spring-boot jpa
toc     : true
comment : true
public  : false
parent  : [[/jpa]]
latex   : true
---
* TOC
{:toc}

## 서론

<br><br><br>

## 구성 환경

- JDK
- Spring Boot
- JPA

<br><br><br>

## 더티 체킹

- 성능 이슈
- 예측하지 못한 데이터베이스 쓰기 작업
- 코드 명확성 저하
- 트랜잭션 관리 복잡성
- 테스트 어려움


<br><br><br>


## save(), saveAndFlush()

<br><br><br>

  
## Ref

- https://medium.com/jpa-java-persistence-api-guide/dirty-checking-magic-in-hibernate-how-it-works-and-why-its-important-3cdb422dc4d4
- https://jojoldu.tistory.com/415
- https://vladmihalcea.com/the-anatomy-of-hibernate-dirty-checking/
- https://brunch.co.kr/@purpledev/32
- https://docs.jboss.org/hibernate/orm/6.4/introduction/html_single/Hibernate_Introduction.html
- https://thorben-janssen.com/6-performance-pitfalls-when-using-spring-data-jpa/#Pitfall_2_Calling_the_saveAndFlush_method_to_persist_updates
- https://velog.io/@wisepine/JPA-%EC%82%AC%EC%9A%A9-%EC%8B%9C-19%EA%B0%80%EC%A7%80-Tip