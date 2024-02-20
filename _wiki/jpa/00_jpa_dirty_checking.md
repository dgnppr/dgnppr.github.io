---
layout  : wiki
title   : JPA Dirty Checking 어떻게 동작할까
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
영속성 컨택스트 내부에서 어떻게 동작하길래 이런 기능을 제공하는지 궁금해서 이번 글을 작성하게 되었다.
이번 글에서는 `EntityManager`에서 어떤 식으로 더티 체킹을 하는지 디버거를 통해 알아보고, 더티 체킹의 단점에 대해서 정리하고자 한다.

<br><br><br>

## JPA 주요 객체 정리

우선 더티 체킹의 동작에 앞서 JPA 주요 개념을 정리하고, 더티 체킹의 동작을 알아보자.

<br>

### EntityManager

`EntityManager`는 `Entity`의 영속성을 관리하는 인터페이스이다. `EntityManager`는 내부에서 `PersistenceContext`를 가지고 있으며, 이 객체를 통해 `Entity`의
영속성을 관리한다.

![Screenshot 2024-02-19 at 19 29 03](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/ecca7512-39d8-4497-83c4-4e110fd2821d)

`SessionImpl`은 `EntityManager`의 구현체이다. 위 코드를 보면 내부에 `private transient StatefulPersistenceContext persistenceContext;`가
존재하는 것을 확인할 수 있다.
`PersistenceContext`는 다음절에서 하술하겠다.

<br>

![Screenshot 2024-02-19 at 19 09 07](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/819fed32-6670-4f14-b96a-aaa984db9c58)

`SpringBoot`에서 `jpa`를 사용할 경우 `PlatformTransactionManager` 구현체 `JpaTransactionManager`를 사용한다.
그리고 `JpaTransactionManager`에서는 `JpaTransactionObject`라는 `TransactionObject`를 가지고 있는 것을 위 코드에서 확인할 수 있다.

<br>

![Screenshot 2024-02-19 at 19 11 00](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/42fe4e3b-cde9-4352-bc90-0783ed8a2bae)

`JpaTransactionObject` 내부에는 `EntityManagerHolder`가 존재하고, `EntityManagerHolder`는 `EntityManager`를 가지고 있다.
**같은 트랜잭션으로 동작하는 서비스 객체는 같은 `JpaTransactionObject` 즉, 동기화된 트랜잭션을 가지기 때문에 같은 `EntityManager`를 사용한다.**

<br>

그렇다면 다른 트랜잭션(eg. `@Transactional(propagation = Propagation.REQUIRES_NEW`))에서 동작할 경우 다른 `EntityManager`를 사용할까?
`ServiceA`가 `ServiceB`를 호출할 때, `ServiceB`는 `@Transactional(propagation = Propagation.REQUIRES_NEW)`로 동작한다고 가정하자.

<br>

**`ServiceA` 트랜잭션 시작 시**
![Screenshot 2024-02-19 at 19 32 26](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/df53973f-20bf-4a80-ab7e-4b5b6262bdca)

<br>

**`ServiceB` 트랜잭션 시작 시**
![Screenshot 2024-02-19 at 19 33 11](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/59a8ab9e-9f2c-4161-b547-f1a6865778f8)

<br>

다른 트랜잭션에서 동작하기 때문에 서로 다른 `txObject`를 가지고, 내부에서 서로 다른 `EntityManager`를 사용한다. **당연한 소리겠지만 다른 트랜잭션에서는 서로
다른 `PersistenceContext`를 가지고 있다.**

<br><br><br>

### PersistenceContext

![Screenshot 2024-02-19 at 19 48 46](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/4e2e7c47-13b5-46bf-bc9e-be750a4566ff)

`PersistenceContext` 구현체 `StatefulPersistenceContext` 내부 코드를 보면 `HashMap`을 사용하여 `Entity`를 관리한다.

<br>

![Screenshot 2024-02-19 at 19 50 35](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/fdd5d705-4f37-43c2-960d-1a82bc2b6b7a)
`EntryKey`를 통해 엔티티를 보관하는 것을 볼 수 있다.

<br>

### Entity

`Entity`는 `PersistenceContext`에서 관리된다. `Entity`의 상태는 아래와 같다.

![Screenshot 2024-02-19 at 20 07 48](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/0af67f69-0448-4759-8dae-cf189e2d666e)

- `New`: `EntityManager.persist()`로 영속성 컨텍스트에 저장되지 않은 상태
- `Managed`: `EntityManager.find()`로 영속성 컨텍스트에 저장된 상태
- `Detached`: `EntityManager.detach()`로 영속성 컨텍스트에서 분리된 상태
- `Removed`: `EntityManager.remove()`로 영속성 컨텍스트에서 삭제된 상태

<br><br><br>

## Dirty Checking 동작

영속성 컨텍스트에서 관리되는 `Entity`의 필드에 변화가 있을 경우, 프로그래머는 `repository.save()`를 호출하지 않더라도 `Entity`의 변화를 데이터베이스에 반영할 수 있다.
이는 트랜잭션이 종료될 때 정확하게는 flush()가 호출될 때 `Entity`의 변화를 감지하여 데이터베이스에 반영하기 때문이다.

하이버네이트는 `managed` 상태의 엔티티 객체를 모두 체크한다. 엔티티가 영속성 컨텍스트에 적재될 때마다 엔티티 속성 값을 스냅샷으로 저장해두고, `flush()`가 호출될 때 이 스냅샷과 비교하여 변경된
속성을 찾아낸다.

![Screenshot 2024-02-20 at 01 52 24](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/7539efd9-273a-4333-8649-3db8e7e08587)

위 동작을 좀 더 구체적으로 보면

1. `SessionImpl`(= `EntityManager` 구현체)에서 `flush()`가 호출된다. `flush()`에서 이벤트 리스너 그룹에 있는 `DefaultFlushEventListener`를 호출한다.
2. `DefaultFlushEventListener`에서는 `this.flushEntities(event, persistenceContext)`를
   호출하여,  `DefaultFlushEntityEventListener`를 호출한다.
3. `DefaultFlushEntityEventListener`에서는 `persister.dirtyCheck()`를 호출하여 `Entity`의 변화를 감지한다.
4. `AbstractEntityPersister`에서는 `DirtyHelper.findDirty()`를 호출하여 변경된 속성을 찾아낸다.

`Dirty Checking`은 이벤트 기반으로 동작하고, `ActionQueue`에 정의된 쓰기 지연 SQL을 통해 `Entity`의 변화를 데이터베이스에 반영한다.


<br>

### DirtyHelper

아래 `DirtyHelper` 코드를 보면 `findDirty()`에서 `currentState`와 `previousState`를 하나하나 비교하여 변경된 속성을 찾아냄을 볼 수 있다.

![Screenshot 2024-02-20 at 02 08 04](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/2691b7c0-9c45-4713-b383-e702784ec7f2)


<br>

### DefaultFlushEntityEventListener

`DirtyCheck`를 하기 위해서는 snapshot을 가지고 있어야 한다. `DefaultFlushEntityEventListener`에서는 `persister`를 통해 `Entity`의 snapshot을
가져옴을 아래 코드에서 확인할 수 있다.

![Screenshot 2024-02-20 at 02 24 11](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/6a02242a-6b46-4f58-beeb-1ce5459fa266)

<br>

### DefaultFlushEventListener

`Session`에 정의된 즉, 쓰기 지연 SQL이 정의된 `ActionQueue`를 통해 `Entity`의 변화를 데이터베이스에 반영한다.

![Screenshot 2024-02-20 at 02 37 14](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/2370936b-ffcf-4300-b703-df5de3d3d78b)

![Screenshot 2024-02-20 at 02 39 09](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/e1b77449-722c-4984-a45c-50fcb3716c89)

테스트 예제에서는 엔티티의 특정 필드 1개를 변경하는 예인데, update 쿼리가 1개만 발생하는 것을 확인할 수 있다.
그리고 `dirtyFields` 는 배열의 인덱스로 관리하는 것을 볼 수 있다.

<br>

### 요약

스냅샷을 기반으로 엔티티의 필드 하나하나를 비교하여 변경된 필드를 찾아내고, 쓰기 지연 `SQL`을 통해 데이터베이스에 반영한다.


<br><br><br>

## Dirty Checking 단점

영속성 컨텍스트에서 관리되는 엔티티의 변경을 감지해서 알아서 `SQL`을 생성해주는 더티 체킹은 개발자에게 많은 편의를 제공한다.
그럼에도 불구하고 더티 체킹은 몇 가지 단점을 가지고 있다.

- 성능 이슈
    - 영속성 컨텍스트에서 관리되는 엔티티의 수가 많아질수록 그리고 엔티티의 필드 수가 많아질수록 `Dirty Checking`에 리소스를 많이 사용된다.
    - 또한, 비교를 위해 스냅샷을 메모리에서 유지해야하므로 메모리 사용량이 증가한다.
- 예측하지 못한 데이터베이스 쓰기 작업
    - `Dirty Checking`은 트랜잭션이 종료될 때 `flush()`가 호출될 때 동작한다.
    - 이는 트랜잭션 범위가 넓어질수록 그리고 로직이 복잡해수록 개발자는 언제 `flush()`가 호출될지 예측하기 어려워질 수 있다.
- 코드 명확성 저하
    - `Dirty Checking`은 개발자가 `repository.save()`를 호출하지 않더라도 `Entity`의 변화를 데이터베이스에 반영한다.
    - `repository.save()`를 직접 명시하지 않고 엔티티의 속성 값을 변경시키기 때문에 엔티티의 변화 추적이 어렵다.
- 테스트 어려움
    - 객체가 아니라, 영속성 컨텍스트에 적재된 엔티티 객체가 변화되었음을 테스트해야 하므로, 테스트가 어려워진다.

<br><br><br>

## 필자의 생각

필자는 `Dirty Checking`보다는 `save()`, `saveAll()`, `saveAndFlush()` 등을 명시적으로 호출하는 것을 선호한다.
그 이유는 로직이 복잡해질수록 더티 체킹은 언제 쓰기 쿼리가 발생하는지 예측하기 어렵고, 테스트하기 어려워지기 때문이다.

`save()` 메서드 내부를 보면 영속성 컨텍스트에서 관리하는 엔티티인지 확인하는 과정이 추가적으로 발생하고, 최적화에서 손해를 볼 수 있다고 생각할 수 있다.
하지만 이보다 더 중요한 것은 명시적으로 코드를 작성함으로써 코드의 명확성을 높이고, 테스트하기 쉽게 만드는 것이여야 한다고 생각한다.

~~jpa 내부를 잘 알고 쓰면 뭐든 잘할 수 있겠지만.. 예측하기 어려운 것은 피해는 게 좋은 것 같다.~~

<br><br><br>

## Ref

- https://medium.com/jpa-java-persistence-api-guide/dirty-checking-magic-in-hibernate-how-it-works-and-why-its-important-3cdb422dc4d4
- https://jojoldu.tistory.com/415
- https://vladmihalcea.com/the-anatomy-of-hibernate-dirty-checking/
- https://brunch.co.kr/@purpledev/32
- https://docs.jboss.org/hibernate/orm/6.4/introduction/html_single/Hibernate_Introduction.html
- https://thorben-janssen.com/6-performance-pitfalls-when-using-spring-data-jpa/#Pitfall_2_Calling_the_saveAndFlush_method_to_persist_updates
- https://velog.io/@wisepine/JPA-%EC%82%AC%EC%9A%A9-%EC%8B%9C-19%EA%B0%80%EC%A7%80-Tip