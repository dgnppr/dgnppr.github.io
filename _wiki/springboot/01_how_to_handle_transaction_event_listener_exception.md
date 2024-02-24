---
layout  : wiki
title   : "@TransactionalEventListener 예외처리 어떻게 해야할까" 
summary :
date    : 2024-02-21 00:00:00 +0900
updated : 2024-02-24 00:00:00 +0900
tag     : spring-boot code-analysis
toc     : true
comment : true
public  : true
parent  : [[/spring-boot]]
latex   : true
---
* TOC
{:toc}

## 본 글에 앞서

`Spring`에서 트랜잭션 관련 이벤트를 처리하는 방법에는 [`@TransactionalEventListener`](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/event/TransactionalEventListener.html)가 있다.
이 어노테이션은 [`@EventListener`](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/context/event/EventListener.html)와 비슷해 보이지만, `TransactionalEventListener`는 더 복잡하게 동작한다.
이번 글에서는 이 두 어노테이션의 동작 과정과 `@TransactionalEventListener` 예외 처리에 대해 알아보고자 한다.

> 관련 코드는 모두 [여기](https://github.com/dgnppr/java-spring-workspace/commit/bd83099ecc53f926b4dda760c9b631f5e3682c7e)에서 확인할 수 있다.

<br><br><br>

## @EventListener

우선 `@EventListener`가 어떻게 동작하는지 간단하게 살펴보자.

<br>

```java
// 이벤트
public record MyEvent(
        Long id
) {

}

// 이벤트 발행자
@Service
public class MyService {

    private final MyRepository myRepository;
    private final ApplicationEventPublisher publisher;

    public MyService(
            final MyRepository myRepository,
            final ApplicationEventPublisher publisher
    ) {
        this.myRepository = myRepository;
        this.publisher = publisher;
    }

    @Transactional
    public Long createMyEntity() {
        var myId = myRepository.save(new MyEntity()).getId();
        publisher.publishEvent(new MyEvent(myId));
        return myId;
    }
}


// 이벤트 리스너 A
@Component
public class MyEventListenerA {

    private static final Logger log = LoggerFactory.getLogger(MyEventListenerA.class);

    @EventListener
    public void handleMyEvent(MyEvent event) {
        log.info("MyEventListener A Received event: {}", event);
    }
}

// 이벤트 리스너 B
@Component
public class MyEventListenerB {

    private static final Logger log = LoggerFactory.getLogger(MyEventListenerB.class);

    @EventListener
    public void handleMyEvent(MyEvent event) {
        log.info("MyEventListener B Received event: {}", event);
    }
}
```

위 코드와 같이 동작할 때, `MyService`에서 `MyEvent`를 발행하면, `MyEventListenerA`와 `MyEventListenerB`가 이벤트를 구독하여 처리한다.
`@EventListener`가 붙은 메서드는 `ApplicationEventPublisher`에 의해 발행된 이벤트를 구독하여 처리한다.

`MyService`가 호출되면 아래와 같이 로그가 찍힌다.


```sh
MyEventListener A Received event: MyEvent[id=1]
MyEventListener B Received event: MyEvent[id=1]
```

<br>

좀 더 간략화해보면 아래 그림과 같다.

![Screenshot 2024-02-23 at 17 56 08](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/af9ad62c-a821-4212-98ef-60d77430c94c)

스프링 빈으로 등록된 [`ApplicationEventPublisher`](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/context/ApplicationEventPublisher.html)에 이벤트를 발행하고, 
`@EventListener`가 붙은 메서드들이 이벤트를 구독하여 처리하는 방식으로 동작한다.
**`ApplicationEventMulicaster`는 모든 일치하는 리스너에게 이벤트에게 알림을 전송한다.**

<br>


기본적으로 `event publisher`는 동기적으로 동작한다.
이벤트 리스너를 사용한다는 것은 이벤트를 발행하는 객체와 이벤트를 처리하는 객체를 분리하는 것이다.
즉, 동기화된 작업 셋을 분리하기 위한 목적이기 때문에, 비동기로 실행시키는 경우가 많다.
이러한 경우 `@Async`를 사용하거나 또는 `ApplicationEventMulticaster`에 별도의 `executor`를 설정하여 비동기로 실행할 수 있다.

```java
// @Async를 사용하여 비동기로 실행하는 방법
@Component
public class MyEventListenerA {

    private static final Logger log = LoggerFactory.getLogger(MyEventListenerA.class);

    @Async("threadPoolTaskExecutor") // Async로 설정한 executor 이름을 명시 또는 AsyncConfigurer 구현체를 사용하여 설정
    @EventListener
    public void handleMyEvent(MyEvent event) {
        log.info("MyEventListener A Received event: {}", event);
    }
}

@EnableAsync
@Configuration
public class AsyncConfig implements AsyncConfigurer {

    private static final Logger log = LoggerFactory.getLogger(AsyncConfig.class);

    @Override
    public Executor getAsyncExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        int processors = Runtime.getRuntime().availableProcessors();

        log.info("Initializing async executor");
        executor.setCorePoolSize(processors);
        executor.setMaxPoolSize(processors * 2);
        executor.setQueueCapacity(50);
        executor.setKeepAliveSeconds(60);
        executor.setThreadNamePrefix("AsyncExecutor-");
        executor.initialize();

        return executor;
    }
}


// Custom ApplicationEventMulticaster를 사용하여 비동기로 실행하는 방법
@Configuration
public class AsynchronousSpringEventsConfig {

    @Bean(name = "applicationEventMulticaster")
    public ApplicationEventMulticaster simpleApplicationEventMulticaster() {
        SimpleApplicationEventMulticaster eventMulticaster =
          new SimpleApplicationEventMulticaster();
        
        eventMulticaster.setTaskExecutor(new SimpleAsyncTaskExecutor());
        return eventMulticaster;
    }
}
```


<br><br><br>

## @TransactionalEventListener

`@TransactionalEventListener`는 `@EventListener`와 비슷해 보이지만, 동작 방식이 다르다.

<br>

![Screenshot 2024-02-23 at 20 53 42](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/1b211b19-42ce-48d3-b484-84ee8706c6c0)

- **`@TransactionalEventListener`는 트랜잭션 내에서 동작하고, [`TransactionPhase`](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/event/TransactionPhase.html)에 따라 호출되는 이벤트 리스너이다.**
- **트랜잭션 내에서 발행된 이벤트가 아니면, fallbackExecution()을 명시적으로 활성화하지 않은 경우, 이벤트를 처리하지 않는다.** 
- `Event`가 발행되면 `TransactionApplicationListenerMethodAdapter`에 의해서 해당 이벤트가 트랜잭션의 지정된 단계(`TransactionPhase`)에 따라 호출된다.


<br>

### TransactionPhase

![Screenshot 2024-02-23 at 20 06 25](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/2fe3758c-7c59-4072-a2e7-ae1adc1f05c2)

트랜잭션 단계는 총 4개로 구성됨을 볼 수 있다.

- `BEFORE_COMMIT`: 트랜잭션이 커밋되기 전에 호출된다.
- `AFTER_COMMIT`: 트랜잭션이 커밋된 후에 호출된다.
- `AFTER_ROLLBACK`: 트랜잭션이 롤백된 후에 호출된다.
- `AFTER_COMPLETION`: 트랜잭션이 완료된 후에 호출된다. **커밋, 롤백 상관없이 실행시킬 phase**

<br>

![Screenshot 2024-02-23 at 20 03 50](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/4a3f1277-b71f-42bb-8cd6-09b3eb8ca9c4)

디폴트 값은 `AFTER_COMMIT`이다. **`fallbackExecution()`을 명시적으로 활성화하지 않은 경우, 트랜잭션이 진행 중이 아닌 경우 이벤트를 처리하지 않는다**

<br>

### TransactionSynchronization 등록

![Screenshot 2024-02-24 at 20 11 19](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/2b624968-869a-4a2d-be97-14a9997e421a)

<br>

**트랜잭션에서 이벤트가 발행되면 일련의 과정을 통해 `TransactionSynchronizationManager`에서 이벤트를 등록한다.** 

<br>

`ApplicationEventMulticaster`
![Screenshot 2024-02-24 at 01 31 21@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/224e4124-c8b3-46fc-97ed-4f5a5bdf5cef)

`TranscationalApplicationListenerMethodAdapter`
![Screenshot 2024-02-24 at 01 32 30@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/bde03e36-c3da-4b41-8df7-a8dbade6bf18)

`TransactionalApplicationListenerSynchronization`
![Screenshot 2024-02-24 at 01 34 58@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/88482973-a846-4beb-b00f-0fc4e0bac4d6)

<br>

### TransactionSynchronization 호출

![Screenshot 2024-02-24 at 00 54 42](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/345c1c16-66d1-46f9-aa6f-d291b0f65276)

<br>

- 트랜잭션이 커밋될 때, `AbstractionPlatformTxManager`에 정의된 `trigger*` 메서드 시리즈들이 실행되고 `TransactionSynchronizationUtils`에 `invoke*` 메서드 시리즈들이 실행된다.
- `triggerAfterCompletion()`을 실행할 때 현재 트랜잭션에 등록된 `TransactionSynchronization` 객체들을 조회하여 `TranscationSynchronizationUtils.invokeAfterCompletion()`을 실행한다.
  - **스프링은 트랜잭션 커밋 시 등록된 모든 `TransactionSynchronization`를 순회하면서 `beforeCommit`, `afterCompletion` 메서드를 실행하는 것을 아래 코드에서 볼 수 있다.**
  - `TransactionSynchronization` 객체 내부에는 이벤트 리스너, 이벤트 객체가 저장되어 있다. (`TransactionSynchronization` 인터페이스는 트랜잭션 커밋 전후(`beforeCommit`, `afterCompletion`) 작업을 실행한다.)

<br>

![Screenshot 2024-02-24 at 01 05 42@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/68be9307-fb96-4184-8973-4698988ff2d1)
![Screenshot 2024-02-24 at 01 05 22@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/56bcfc82-117e-4202-8314-08a4b070989d)

<br>

- `TransactionSynchronizationUtils`에서 전달받은 `TransactionSynchronization` 객체 리스트를 순회하면서 이벤트를 처리하도록 한다.

<br>

![Screenshot 2024-02-23 at 20 32 06](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/f6370622-12ce-4385-aaac-b6c22017dd80)

<br>

### TransactionSynchronization 인터페이스 메서드

#### beforeCommit(), afterCommit()

![Screenshot 2024-02-24 at 01 42 40](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/7c1de267-1459-4b92-bfd9-eb8858b7794c)

[공식 문서](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/support/TransactionSynchronization.html)를 보면 `beforeCommit()`, `afterCommit()`는 `caller`로 예외가 전파됨을 볼 수 있다.

<br>

#### beforeCompletion(), afterCompletion()

![Screenshot 2024-02-24 at 01 44 09](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/de988619-f39d-468a-b9ff-bab023f030e6)

반면에 `beforeCompletion()`, `afterCompletion()`의 경우 로깅만 찍고 전파는 되지 않음을 볼 수 있다.

![Screenshot 2024-02-24 at 01 51 12@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/7da8125a-9aae-4f60-9d1c-3e5384720c87)

<br>

`TransactionSynchronization`를 호출하는 `TransactionSynchronizationUtils`에서 발생한 예외를 잡고 에러 로그만 남기는 것을 볼 수 있다.

`@TransactionalEventListener`를 사용할 때는 `TransactionPhase` 디폴트 값이 `AFTER_COMMIT`인데, 
`PlatformSynchorization`의 `afterCommit()`은 없고 `afterCompletion()`에서 `TransactionPhase`를 처리하도록 구현되어있다.

<br>

![Screenshot 2024-02-24 at 10 26 27](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/ac930020-288a-4685-9d43-4a4e752987ea)

더 정확히 말하자면 `afterCommit()`이 정의되어 있는 `TransactionSynchronization`는 `afterCommit`을 `default` 메서드로 실행하고, 메서드 바디에는 아무것도 구현되이 있지 않다.

<br>


왜 이렇게 만들었을까?

스프링에서 기본적으로 사용하는 `TransactionSynchronization` 구현체는 모든 `after` 구체 동작을 `afterCompletion`에서 처리하도록 구현하였다. 뿐만 아니라, 예외 전파에 있어서 `afterCompletion`에서는 예외를 먹어버린다.
사용자가 구현한 `TransactionSynchronization`을 `afterCommit`할 때는 `afterCompletion`에서 처리하도록 하여 확장성을 높이려고 한걸까?

~~왜 이렇게 설계한건지는 모르겠지만..~~ `afterCommit`을 사용하려면 `TransactionSynchronization`를 상속받아 `afterCommit`을 구현해야한다.

<br><br><br>

## TransactionSynchronization 예외 전파하기

`afterCommit`, `afterRollback` , `afterCompletion`은 `afterCompletion`에서 처리되기 때문에, 예외를 전파하려면 `afterCompletion`에서 예외를 던져야한다.
위에서 `TransactionSynchronizationUtils`가  `afterCompletion` 예외를 잡아서 `log.error()`만 찍는 것을 볼 수 있다.

그렇다면 예외를 던지고 싶을 때는 어떻게 해야할까?

<br>

### @Async + CustomAsyncExceptionHandler 사용

트랜잭션은 thread-bound 이기 때문에, `@Async`를 사용하여 다른 스레드를 할당하여 비동기로 실행시키면, 트랜잭션에서 벗어나고, 예외를 caller 에게서 완전히 분리시킬 수 있다.
즉, caller 스레드와 다른 스레드에서 이벤트 로직을 실행시키고, 로직을 실행하던 도중 발생한 예외는 `SimpleAsyncUncaughtExceptionHandler`에 의해 처리된다.

```java
@Async
@Component
public class MyTxEventListenerAfterCommit {

    private static final Logger log = LoggerFactory.getLogger(MyTxEventListenerAfterCommit.class);

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handleMyEvent(MyEvent event) {
        log.info("MyTxEventListener AFTER_COMMIT Received event: {}", event);
        throw new RuntimeException("MyTxEventListener AFTER_COMMIT");
    }
}
```

이벤트를 처리하는 로직에서 예외를 던지면, `SimpleAsyncUncaughtExceptionHandler`에 의해 처리된다.

<br>

![Screenshot 2024-02-24 at 20 39 40](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/39e7e43b-f6d2-4a31-b194-d924c66e092d)

<br>

발생할 예외를 잡아서 처리해야한다면 `AsyncExceptionHandler`를 정의하여 예외를 핸들링할 수 있다.

```java
// 커스텀 AsyncExceptionHandler 생성
public class CustomAsyncExceptionHandler implements AsyncUncaughtExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(CustomAsyncExceptionHandler.class);

    @Override
    public void handleUncaughtException(Throwable throwable, Method method, Object... obj) {
        log.info("CustomAsyncExceptionHandler:: {} 예외 처리", throwable.getMessage());
    }
}

// 커스텀 AsyncExceptionHandler 정의
@EnableAsync
@Configuration
public class AsyncConfig implements AsyncConfigurer {

    private static final Logger log = LoggerFactory.getLogger(AsyncConfig.class);

    @Override
    public Executor getAsyncExecutor() {
        return new SimpleAsyncTaskExecutor();
    }

    @Override
    public AsyncUncaughtExceptionHandler getAsyncUncaughtExceptionHandler() {
        return new CustomAsyncExceptionHandler();
    }
}
```

위와 같이 커스텀 `AsyncExceptionHandler`를 정의하고, `@Async`를 사용하여 비동기로 실행시키면, 예외를 잡아서 처리할 수 있다.

![Screenshot 2024-02-24 at 20 44 50](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/12e4d34d-7d22-4442-b271-86bb44223d78)

<br>

### CustomTransactionalApplicationListenerSynchronization 사용

```java
// CustomTransactionalApplicationListenerMethodAdapter 
if (TransactionSynchronizationManager.isSynchronizationActive() && 
  TransactionSynchronizationManager.isActualTransactionActive()
) {
    // CustomTransactionalApplicationListenerSynchronization 등록
    TransactionSynchronizationManager.registerSynchronization(new CustomTransactionalApplicationListenerSynchronization<>(event, this,superClassCallback));

} else if (superClassAnnotation.fallbackExecution()) {
    if (superClassAnnotation.phase() == TransactionPhase.AFTER_ROLLBACK && logger.isWarnEnabled()) {
      logger.warn("Processing {} as a fallback execution on AFTER_ROLLBACK phase",event);
    }
    processEvent(event);
    
} else {
    if (logger.isDebugEnabled()) {
      logger.debug("No transaction is active - skipping {}", event);
    }
}


// CustomTransactionalApplicationListenerSynchronization
@Override
public void afterCommit() {
  // afterCommit 설정 -> caller로 예외 전파
  if (listener.getTransactionPhase() == TransactionPhase.AFTER_COMMIT) {
    processEventWithCallbacks();
  }
}
```

<br><br><br>

## 정리

이번글에서는 스프링의 `@EventListener`, `@TransactionEventListener`이 어떤식으로 동작하는지 알아보고, 각 컴포넌트의 대해서 코드를 보며 분석하였다.

`@TransactionEventListener`이 실행될 때 `TransactionPhase`에 따라 호출되는 것을 보았는데, `afterCompletion`의 경우에는 예외를 먹어버리는 것을 볼 수 있었다.
예외를 전파할 것이라면 `TransactionalApplicationListenerSynchronization`를 새로운 구현체로 등록해줘서 예외를 던지게 할 수 있다.

**`TransactionSynchronization.afterCompletion`에서 예외를 먹어버리는 것을 항상 인지하고 있어야한다.**

<br><br><br>
  
## Ref

- https://docs.oracle.com/cd/E23095_01/Platform.93/ATGProgGuide/html/s1204transactionsynchronization01.html
- https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/context/event/EventListener.html
- https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/event/TransactionalEventListener.html
- https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/support/TransactionSynchronization.html
- https://www.baeldung.com/spring-events
- https://lenditkr.github.io/spring/transactional-event-listener/index.html
- https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-decl-explained.html