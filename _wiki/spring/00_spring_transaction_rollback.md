---
layout  : wiki
title   : SpringBoot 트랜잭션 롤백 마크 정리
summary :
date    : 2024-01-19 00:00:00 +0900
updated : 2024-01-19 00:00:00 +0900
tag     : spring-boot
toc     : true
comment : true
public  : true
parent  : [[/spring]]
latex   : true
---
* TOC
{:toc}

## 글 작성 계기

프로젝트를 진행하면서 `@Transactional`이 달린 메서드에서 호출하는 내부 메서드에서 발생시키는 `RuntimeException` 예외를 잡았는데, 롤백이 되는 것을 보았다.
예외를 잡으면 롤백이 되지 않아야 하지 않나? 라고 생각했었다. 이슈에 대한 여러 글을 찾아보았고, 그 내용을 정리하고자 글을 작성하게 되었다.

<br><br><br>

## @Transactional

우선 스프링이 제공하는 `@Transactional`을 가볍게 짚고 넘어가자.


스프링 트랜잭션은 AOP 기반 프록시로 동작한다. 즉, `@Transactional`이 달린 메서드는 프록시 객체에서 호출되어 동작한다.

<br>

![Screenshot 2024-01-19 at 01 58 23](https://github.com/dragonappear/dragonappear.github.io/assets/89398909/f44fb94a-ee44-4fae-be99-f34508bf55c7)

`@Transactional`은 기본적으로 `RuntimeException`을 롤백 대상으로 삼는다.

<br>

![Screenshot 2024-01-19 at 01 56 13](https://github.com/dragonappear/dragonappear.github.io/assets/89398909/aeb316a2-54a7-4204-aa7b-008589240c6b)

![Screenshot 2024-01-19 at 01 56 03](https://github.com/dragonappear/dragonappear.github.io/assets/89398909/133930ab-ab99-4f13-b3a3-39efcb84c572)

`@Transactional`의 기본 전파(`propagation`)는 `REQUIRED`이다.
트랜잭션이 없으면 새로운 트랜잭션을 생성하고, 트랜잭션이 있으면 기존 트랜잭션에 참여한다.

<br><br><br>

## 트랜잭션 롤백 마크


<br><br><br>

## Ref

- https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/annotation/Transactional.html
- https://docs.spring.io/spring-framework/reference/data-access/transaction/strategies.html
- https://techblog.woowahan.com/2606/
- https://velog.io/@eastperson/Transactional-%EC%83%81%ED%99%A9%EB%B3%84-commit-rollback-%EC%A0%84%EB%9E%B5