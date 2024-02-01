---
layout  : wiki
title   : SpringBoot with JPA 트랜잭션 롤백 마크
summary :
date    : 2024-01-25 00:00:00 +0900
updated : 2024-01-25 00:00:00 +0900
tag     : springboot transaction jpa
toc     : true
comment : true
public  : true
parent  : [[/springboot]]
latex   : true
---
* TOC
{:toc}

## 글 작성 계기

프로젝트를 진행하면서 `@Transactional`이 달린 메서드에서 호출하는 내부 메서드에서 발생시키는 `RuntimeException` 예외를 잡았는데, 롤백이 되는 것을 보았다.
예외를 잡으면 롤백이 되지 않아야 하지 않나? 라고 생각했었다. 이슈에 대한 여러 글을 찾아보았고, 그 내용을 정리하고자 글을 작성하게 되었다.

<br>

동기화되는 트랜잭션에 대해서 롤백 마킹이 되는 과정과 롤백 마킹이 되었을 때 발생하는 예외에 대해서 로그를 통해 알아보자. 그리고 롤백 마킹을 우회하는 방법에 대해서도 알아보자. 
우선 롤백 마킹 처리에 앞서 스프링 트랜잭션에 대해서 간단하게 알아보자.

<br><br><br>

## 스프링 트랜잭션

![Screenshot 2024-02-02 at 01 21 26](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/8897113c-ec7c-4a44-88d7-cc5bd2b98461)

위 그림을 보면 트랜잭션이 시작되고 종료되는 과정을 볼 수 있다.

트랜잭션을 담당하는 핵심 인터페이스는 `PlatformTransactionManager`이다. `PlatformTransactionManager`의 `commit` 메서드와 `rollback` 메서드에 따라 트랜잭션의 커밋과 롤백이 결정된다.
코드와 함께 해당 인터페이스를 하술하겠다.

<br>

스프링은 트랜잭션을 처리하고 싶은 클래스나 메서드에 `@Transactional`을 달면 위에 그림처럼 트랜잭션을 처리해준다.

간단하게 `@Transactional`의 속성에 대해서 알아보자. [공식 문서](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/annotation/Transactional.html)를 참고하였다.

![Screenshot 2024-01-19 at 01 58 23](https://github.com/dragonappear/dragonappear.github.io/assets/89398909/f44fb94a-ee44-4fae-be99-f34508bf55c7)

`@Transactional`은 기본적으로 `RuntimeException`을 롤백 대상으로 삼는다.

<br>

![Screenshot 2024-01-19 at 01 56 13](https://github.com/dragonappear/dragonappear.github.io/assets/89398909/aeb316a2-54a7-4204-aa7b-008589240c6b)

![Screenshot 2024-01-19 at 01 56 03](https://github.com/dragonappear/dragonappear.github.io/assets/89398909/133930ab-ab99-4f13-b3a3-39efcb84c572)

`@Transactional`의 기본 전파(`propagation`)는 `REQUIRED`이다.
트랜잭션이 없으면 새로운 트랜잭션을 생성하고, 트랜잭션이 있으면 기존 트랜잭션에 참여한다.

<br><br><br>

## 트랜잭션 롤백 마킹 과정

로그를 따라서 트랜잭션 롤백 마킹 과정을 알아볼 것이다. 테스트 코드는 아래와 같다.

<br>

### 테스트 코드

```java
@RestController
public class TestController {

    private final OuterService outerService;

    public TestController(OuterService outerService) {
        this.outerService = outerService;
    }

    @GetMapping("/test")
    public ResponseEntity<String> test() {
        outerService.outerMethod();
        return ResponseEntity.ok("pass");
    }
}

@Service
@Transactional
public class OuterService {

    private final Logger logger = LoggerFactory.getLogger(OuterService.class);
    private final InnerService innerService;

    public OuterService(InnerService innerService) {
        this.innerService = innerService;
    }

    public void outerMethod() {
        try {
            innerService.innerMethodThrowingRuntimeException();
        } catch (RuntimeException exception) {
            logger.warn("OuterService caught exception: {}", exception.getMessage());
        }
    }
}

@Service
@Transactional
public class InnerService {

    private final PersonRepository personRepository;

    public InnerService(PersonRepository personRepository) {
        this.personRepository = personRepository;
    }

    public void innerMethodThrowingRuntimeException() {
        personRepository.save(new PersonEntity("name"));
        throw new RuntimeException("innerMethodThrowingRuntimeException");
    }
}
```

`TestController`에서 `OuterService.outerMethod`를 호출하면 `InnerService.innerMethodThrowingRuntimeException`에서 발생시킨 `RuntimeException`을 잡아서 로그를 남긴다. 
예상대로라면  `outerMethod`에서 `RuntimeException`을 잡았기 때문에 롤백이 되지 않고 정상 응답(`hello`)을 해야한다.

하지만, 아래와 같이 롤백 처리가 된다.

![Screenshot 2024-02-02 at 01 27 03@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/aad98dda-478d-4726-86b5-7700ce2c83a4)

로그를 보면 `UnexpectedRollbackException` 예외가 `AbstractPlatformTransactionManager`에서 터졌다. (`AbstractPlatformTransactionManager`는 `PlatformTransactionManager`의 구현체이다.)

<br>

### 롤백 마킹 처리 과정

<br>

#### TransactionAspectSupport.invokeWithinTransaction

아래 코드를 보면 `org.springframework.transaction.interceptor.TransactionAspectSupport`의 `invokeWithinTransaction` 메서드에서 `invocation`(`InnerService.innerMethodThrowingRuntimeException`)을 실행하고, 예외를 잡는 것을 볼 수 있다.

<br>

즉, `TransactionAspectSupport`에서 실제 객체인 `invocation`을 실행하고, 예외가 발생하면 예외를 잡아서 롤백 처리를 한다.

![Screenshot 2024-02-02 at 01 38 05@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/5d32be4d-f9f0-4a4e-be70-60405d371c75)

![Screenshot 2024-02-02 at 01 39 41@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/43e9a608-6a67-45a0-a5f1-0303a8de080f)

`invocation`은 내부 메서드인 `InnerService.innerMethodThrowingRuntimeException`이고, `TransactionManager.rollback`를 호출하는 것을 볼 수 있다.

<br>

#### AbstractPlatformTransactionManager.rollback

![Screenshot 2024-02-02 at 01 42 59@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/7ee37e6b-a433-4f68-9204-8919c6f4389d)

`AbstractPlatformTransactionManager`의 `rollback` 메서드를 보면 트랜잭션이 종료되었는지 확인한 후, 내부 메서드인 `processRollback`이 실행되는 것을 볼 수 있다. 
**`processRollback` 메서드에서 `transactionStatus`를 `setRollbackOnly`로 아래와 같이 마킹한다.** 

![Screenshot 2024-02-02 at 01 58 44](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/66fd5a41-4f42-4954-aed8-70ac098a484c)

<br>

#### JpaTransactionManager.doSetRollbackOnly

마킹 처리가 되는 과정을 좀 더 자세하게 보자. 필자의 경우 JPA를 사용하고 있기 때문에 `JpaTransactionManager`가 호출된다.

![Screenshot 2024-02-02 at 02 05 46](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/6e0c9cbf-aead-4318-ab09-9965c9f1dab1)

<br>

#### JpaTransactionManager.setRollbackOnly

![Screenshot 2024-02-02 at 02 08 40](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/c4be72e1-099c-41b8-94b1-185571b62e52)

`JPA`의 `entity manager`가 관리하는 `transaction`(`TranscationImpl`)에 롤백 마킹을 한다.

<br>

#### TranscationImpl.setRollbackOnly

![Screenshot 2024-02-02 at 02 12 43@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/70b8782e-3983-400c-881d-e353f382b88b)

트랜잭션 AOP 유틸 클래스에서 JPA 엔티티 매니저가 관리하는 트랜잭션에 롤백 마크 처리가 되는 과정을 볼 수 있었다.

이제 `OuterService`에서 `RuntimeException`을 잡아도 롤백이 되는 이유를 알아보자.

<br><br>

### 롤백 마킹이 되었을 때 예외가 발생하는 이유

`outerMethod`에서는 `RuntimeException`을 잡았는데, 왜 예외가 발생할까?

<br>

#### TransactionStatus.isGlobalRollbackOnly

우선 `outerMethod`는 예외를 잡아서 정상적으로 실행되기 때문에 `AbstractPlatformTransactionManager`의 `processCommit` 메서드가 호출된다.

![Screenshot 2024-02-02 at 02 17 29@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/1d9c0794-9d2c-4a89-8d57-7c1cf0135e97)

하지만 내부에서 `TransactionStatus`가 롤백 마킹 처리되었는지 확인하는 코드를 볼 수 있다. 
내부 메서드인 `innerMethodThrowingRuntimeException`에서 발생시킨 `RuntimeException`을 잡아서 롤백 마킹을 했기 때문에 `TransactionStatus`가 롤백 마킹이 되었다.

<br>

#### DefaultTransactionStatus.isGlobalRollbackOnly

공유되는 트랜잭션 상태에서 rollbackOnly가 되었는지 확인하는 것을 볼 수 있다.

![Screenshot 2024-02-02 at 02 20 05@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/3a4f16bc-15c6-49f9-a4fe-b437503a2502)

<br>

#### JpaTransactionManager.isRollbackOnly

`InnerService.innerMethodThrowingRuntimeException`에서 발생시킨 `RuntimeException`을 잡아서 롤백 마킹을 했기 때문에 `isRollbackOnly`는 `true`를 반환한다.

![Screenshot 2024-02-02 at 02 20 39@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/986f5873-bfbf-4d27-b4b0-545eb534376e)

<br>

#### UnexpectedRollbackException

![Screenshot 2024-02-02 at 02 26 05@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/b2d606ad-bd62-44d4-9602-2913d5923a0d)

롤백 마킹이 되었기 때문에 `UnexpectedRollbackException` 예외가 발생한다.

<br><br><br>

## 글로벌 전역 롤백 마킹 처리

예상과는 다르게 롤백 마킹이 되었기 때문에 `UnexpectedRollbackException` 예외가 발생했다. 
그렇다면 어떻게 내가 예상한대로 롤백 마킹이 되지 않게 할 수 있을까?

**핵심은 내부 메서드에서 참여 중인 `TransactionStatus`가 롤백 마킹이 되지 않도록 하는 것이다.**

<br>

### 1. 내부 메서드는 트랜잭션을 참여하지 않는다.

가장 간단하게는 내부 메서드에서 외부 메서드의 트랜잭션에 참여하지 않도록 하면 된다.

<br>

### 2. 내부 메서드에서 예외를 처리하도록 한다.

내부 메서드에서 예외를 잡아서 처리하면 롤백 마킹이 되지 않을 것이다.

```java
@Service
@Transactional
public class InnerService {

    private final Logger logger = LoggerFactory.getLogger(InnerService.class);
    private final PersonRepository personRepository;

    public InnerService(PersonRepository personRepository) {
        this.personRepository = personRepository;
    }

    public void innerMethodThrowingRuntimeException() {
        personRepository.save(new PersonEntity("name"));
        try {
            throw new RuntimeException("innerMethodThrowingRuntimeException");
        } catch (RuntimeException ex) {
            logger.warn("InnerService caught exception: {}", ex.getMessage());
        }
    }
}
```

이런 식으로 처리하면 롤백 마킹 처리가 되지 않는다.

<br>

### 3. 내부 메서드에서 새로운 트랜잭션으로 시작한다.

외부 메서드와 내부 메서드에서 처리하는 트랜잭션을 다르게 설정한다.

```java
@Service
public class InnerService {

    private final Logger logger = LoggerFactory.getLogger(InnerService.class);
    private final PersonRepository personRepository;

    public InnerService(PersonRepository personRepository) {
        this.personRepository = personRepository;
    }

    @Transactional(Transactional.TxType.REQUIRES_NEW)
    public void innerMethodThrowingRuntimeException() {
        personRepository.save(new PersonEntity("name"));
        throw new RuntimeException("innerMethodThrowingRuntimeException");
    }
}
```

<br><br><br>

## 요약

- 스프링 트랜잭션은 `TransactionStatus`를 통해 트랜잭션의 상태(`rollbackMark`)를 관리한다.
- 롤백 마킹을 우회하려면 트랜잭션 내에서 롤백 마킹이 되지 않도록 하거나, 다른 트랜잭션에서 동작하도록 하여야 한다.

<br><br><br>

## Ref

- https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/annotation/Transactional.html
- https://docs.spring.io/spring-framework/reference/data-access/transaction/strategies.html
- https://techblog.woowahan.com/2606/
- https://velog.io/@eastperson/Transactional-%EC%83%81%ED%99%A9%EB%B3%84-commit-rollback-%EC%A0%84%EB%9E%B5