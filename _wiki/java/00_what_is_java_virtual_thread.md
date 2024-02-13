---
layout  : wiki
title   : JDK 21 Virtual Thread를 알아보자
summary :
date    : 2024-02-13 00:00:00 +0900
updated : 2024-02-13 00:00:00 +0900
tag     : os java
toc     : true
comment : true
public  : true
parent  : [[/java]]
latex   : true
---
* TOC
{:toc}

## 등장 배경

![Screenshot 2024-02-13 at 13 41 41](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/0f7ad51a-2013-4c5e-82b8-ab557bb62bd3)

기존 자바의 스레드 모델은 `OS 스레드`를 1:1로 래핑한 `Platform` 쓰레드를 사용하고 있다.
이 모델은 `OS 스레드`를 사용하는 것이기 때문에, 생성 개수가 제한적이고, `OS 스레드`를 생성하고 관리하는데 비용이 많이 들어가는데다가, `OS 스레드`의 수가 많아지면 `Context Switching` 비용이 많이 들어가는 문제가 있었다.
이 때문에 어플리케이션에서는 쓰레드풀을 사용하여 스레드를 관리했다.

<br>

기존 자바 스레드 모델은 처리량과 I/O 처리에 있어서 한계가 있었다. 
기본적인 웹 요청 처리 방식은 하나의 요청에 하나의 스레드가 된다. 높은 처리량이 필요한 시스템에서는 스레드가 더 많이 필요하지만, OS 스레드의 생성 개수 제약으로 인해 스레드를 무한히 늘릴 수 없다.
또한, 플랫폼 쓰레드에서는 I/O 작업을 처리할 때 블로킹이 되는데, CPU 사용 시간보다 I/O 대기 시간이 더 길어지는 경우가 많다.
webflux를 도입하여 논블로킹으로 다른 작업을 처리할 수 있으나 코드를 작성하고 이해하는 비용이 높을 뿐만 아니라, JDBC 등의 라이브러리가 reactive 지원을 하지 않으면 동기적으로 작동하는 것과 동일하게 된다.

<br>

상술된 문제를 해결하기 위해 `Project Loom`에서는 `Virtual Thread`를 개발하였고, 이를 `JDK 21`에서 사용할 수 있게 되었다.

<br><br><br>

## 특징

![Screenshot 2024-02-13 at 13 49 09](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/bd2d1f31-8e8c-4cd9-86a2-ff5e647b3c00)

JVM 내에서 사용하는 쓰레드에서 플랫폼 쓰레드(Carrier 쓰레드) 말고도 가상 쓰레드가 추가된 것을 볼 수 있다. 캐리어 쓰레드 위에서 여러 가상 쓰레드가 번갈아가며 실행된다.

플랫폼 쓰레드와 가상 쓰레드의 차이를 보면 아래와 같다.

|                        | 플랫폼 쓰레드                 | 가상 쓰레드      |
|------------------------|-------------------------|-------------|
| metadata size          | 약 2kb(os별 상이)           | 200~300B    |
| memory                 | 미리 할당된 stack 사용         | 필요시 heap 사용 |
| context switching cost | 1~10us(매핑된 os 스레드에서 발생) | ns          |

<br>

가상 쓰레드가 플랫폼 쓰레드보다 작은 메모리를 사용하고, 필요시에만 메모리를 할당받아 사용한다. 또한, 가상 쓰레드는 컨텍스트 스위칭 비용이 플랫폼 쓰레드보다 적다.

<br><br><br>

## 사용법

### 코드 예제

![Screenshot 2024-02-13 at 14 06 27@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/bd70f121-97ad-42d2-b866-6c69fd80fd22)

![Screenshot 2024-02-13 at 14 06 45@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/e07c57e4-1e76-43d5-ad04-5e84a8f6022b)

<br>

### SpringBoot(MVC) 적용법 (3.2 이상)

```yaml
spring:
  threads:
    virtual:
      enable: true
```

스프링부트 3.2 이상에서는 `spring.threads.virtual.enable`을 `true`로 설정하면 가상 쓰레드를 사용할 수 있다.

<br>

### SpringBoot(MVC) 적용법 (3.x)

![Screenshot 2024-02-13 at 14 15 01@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/ef03dfb5-9247-4453-a85e-28b63b8c6335)

<br><br><br>

## 동작 원리

가상 쓰레드가 도입된 이유는 처리량을 높이고, I/O 처리를 더 효율적으로 하기 위함이라고 상술하였다. 내부적으로 디버깅을 통해 어떻게 동작하는지 알아보자.

<br>

### 가상 스레드 내부 구조

![Screenshot 2024-02-13 at 14 21 15@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/67ccd427-9651-47cb-abea-141c34c1a717)

가상 쓰레드는 내부에 `scheduler`라는 `ForkJoinPool`을 사용한다. `ForkJoinPool`은 `carrier thread`(`platform thread`)의 쓰레드풀 역할을 하고, 가상 쓰레드의 작업 스케줄링을 담당한다.

<br>

![Screenshot 2024-02-13 at 14 24 21@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/982c0569-b50b-4160-bbc0-41760c18166e)

또한 가상 쓰레드는 내부에 `carrierThread`를 가지고 있다. `carrierThread`는 실제로 작업을 수행하는 `platform thread`이고, 내부에 `workQueue`를 가지고 있다.

그리고 `runContinuation`이라는 가상 쓰레드의 실제 작업 내용(Runnable)을 가지고 있다.

<br>

### 가상 스레드 컨텍스트 스위칭

![Screenshot 2024-02-13 at 14 49 48](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/5f60c888-94e7-40fe-ab23-97dc0de6c4b3)

1. 가상 스레드가 실행되면, 가상 쓰레드의 작업(`runContinuation`)이 `ForkJoinPool`의 `workQueue`에 들어간다(push).
2. `Work Queue`에 있는 `runContinuation`들은 `forkJoinPool`에 의해 `work stealing` 방식으로 `carrier thread`에 할당되고, 처리된다.
3. 처리되던 `runContinuation`들이 I/O, Sleep 으로 인해 인터럽트나 작업 완료시, `work queue`에서 pop 되어 park 과정을 통해 다시 힙 메모리로 되돌아간다.

`park`, `unpark`를 통해 가상 쓰레드가 컨택스트 스위칭 하는 형태로 동작하는 것을 볼 수 있다.


<br>

### unpark(unmount)

**`VirtualThread.unpark()`**
![Screenshot 2024-02-13 at 14 58 55@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/8f59a316-aeac-4adc-a6bb-e6eac87d9089)

![Screenshot 2024-02-13 at 15 01 57@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/84dd8cc0-dd94-409d-a62a-0a51b67eba70)

`submitRunContinuation()` 메서드를 통해 `scheduler`에게 작업을 넘겨주고, 실행되는 것을 볼 수 있다. 이렇게 실행된 `runContinuation`은 `work queue`에 push 되어, 스케줄링 되어 실행된다.

<br>

### park(mount)

![Screenshot 2024-02-13 at 15 06 24@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/b10b187d-0969-4031-9534-9fd24cd9be84)

![Screenshot 2024-02-13 at 15 07 27@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/2b02b596-7894-45d5-9edd-c7d75d1886c9)

![Screenshot 2024-02-13 at 15 09 03@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/bfd5faab-e887-4e53-9d02-34949dc35961)

carrier thread 에서 실행되는 가상 스레드를 `unmount()` 하는 동작을 볼 수 있다. `unmount`된 가상 쓰레드는 `work queue`에서 `pop` 된다.

<br>

### I/O에서 park

![Screenshot 2024-02-13 at 15 13 44@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/567e158a-2a13-43a5-a706-b271f3e6e38f)

JDK 21에서 `NIOSocketImpl.park` 메서드 내부를 보면 가상 쓰레드 판단하여, 현재 스레드가 가상 스레드이면 `Poller.poll`를 통해 내부적으로 가상 스레드의 `park`를 수행하여 컨텍스트 스위칭이 가능해진다.

<br>

### Sleep에서 park

![Screenshot 2024-02-13 at 15 18 32@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/d7921148-f81b-4c4c-99ae-cc3ab3c9aace)

![Screenshot 2024-02-13 at 15 19 25@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/3113556f-4736-43cc-a8ec-558f2b15684c)

<br>

### 요약

가상 쓰레드는 `scheduler`에 의해 `work stealing` 방식으로 `carrier thread`에 할당되어 실행된다.
`carrier thread` 에서 실행 중인 가상 쓰레드가 IO, Sleep 등으로 인해 블로킹되면, `work queue`에서 `pop`되어 `park`된다.

<br><br><br>

## 성능 비교

성능 비교는 아래 레퍼런스를 참고하였다.

[kakao tech meet 발표 영상](https://youtu.be/vQP6Rs-ywlQ?t=1205)를 참고하였다.

![Screenshot 2024-02-13 at 15 38 05](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/8d2760f6-4be1-417b-be30-b4838caa4b14)

IO 바운드 작업에서는 가상 스레드가 플랫폼 스레드 방식보다 더 좋은 TPS를 보여준다. 하지만 항상 좋은 성능을 보여주는 것은 아니다.
기존 플랫폼 스레드 방식으로 동작하는 톰캣의 경우, 가용 쓰레드가 없으면 톰캣 스레드풀 워크 큐에 넣고 대기한다. 
가상 스레드로 동작할 경우에는 throughput을 모두 소화하게 되는데, 이 때 DB 커넥션을 가져올 때 DB 커넥션 수를 넘어서는 경우 타임아웃이 발생할 수 있는 상황이 발생할 수 있다.

CPU 바운드 작업에서는 플랫폼 스레드가 더 나은 성능을 보여준다. 
가상 스레드도 결국에는 플랫폼 스레드 위에서 동작하는데, CPU 바운드 작업에서는 플랫폼 스레드 사용 비용 뿐만 아니라 가상 스레드 생성 및 스케줄링 비용까지 포함되기 때문이다.
<br><br><br>

## 언제 사용하면 좋을까?

**컨텍스트 스위칭이 빈번할 때(eg. I/O 바운드 작업) 사용하는 것이 좋다.** CPU 바운드 작업에는 오히려 플랫폼 스레드를 사용하는 것보다 비효율적이다.

Spring MVC 기반이면 편리하게 사용 가능하다. 단, 여러가지 라이브러리들이 가상 스레드를 지원하지 않을 수 있고, 엣지케이스(eg. DB 커넥션 풀 등)에 대해서 생각해야한다.

<br><br><br>

## 주의사항

<br>

### ThreadPool

**Virtual Thread를 리소스(eg.OS 쓰레드 등)라고 생각하지 말고, 하나의 task 라고 생각하자. task 별로 virtual 쓰레드가 할당된다고 생각하자.**
즉, 값싼 일회용품이라고 생각하면 된다. 생성 비용이 작기 때문에 스레드풀을 만드는 행위 자체가 비효율적일 수 있다. 필요할 때 생성하고, GC에 맡기자.

<br>

### ThreadLocal

**Virtual Thread는 힙을 사용하기 때문에, Platform 쓰레드를 사용할 때처럼 공유를 위해 ThreadLocal을 사용하면 메모리 사용이 늘어남을 인지하고 있어야 한다.**

<br>

### Pinning

**`synchroinzed`이나 `parallelStream` 혹은 네이티브 메서드 사용시 `Virutal Thead`에 매핑된 `Carrier Thread`가 블로킹 될 수 있다 (이를 `Pinning이`라고 함).**
가상 스레드가 `carrier thread`에 park 될 수 없는 상태가 되어버려서, 사용 중인 내부 라이브러리나 코드가 해당 키워드를 사용하지 않는지 확인해야 한다.
블로킹을 피하기 위해 `ReentrantLock`을 사용하자.

```java
private static final ReentrantLock lock = new ReentrantLock();

    // Synchronized 사용 (pinning 발생)
    public synchronized String accessResource() {
        return "Resource";
    }

    // ReentrantLock 사용 (pinning 발생 X)
    public String accessResourceWithLock() {
        lock.lock();
        try {
            return "Resource";
        } finally {
            lock.unlock();
        }
    }
```

<br><br><br>

## 정리

**가상 스레드는 도입한다고 무조건 처리량이 높아지는 것은 아니다.** 

특정 상황(I/O 바운드 작업 등)에 대해서는 더 좋은 성능을 보여주지만, 항상 좋은 성능을 보여주는 것은 아니다. 따라서, 가상 스레드를 도입할 때에는 어플리케이션의 특성에 맞게 사용해야 한다.

그리고 가상 스레드는 결국에 플랫폼 쓰레드 위에서 동작하기 때문에 플랫폼 쓰레드가 blocking 되는 상황을 주의해야 한다. 외부 라이브러리에서 blocking 상태를 만드는지 확인하면서 사용해야 한다.

<br><br><br>


## 참고

- [Oracle Docs - Virtual Threads](https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html#GUID-DC4306FC-D6C1-4BCC-AECE-48C32C1A8DAA)
- [java official video - Java 21 new feature: Virtual Threads ](https://www.youtube.com/watch?v=5E0LU85EnTI)
- [kakao tech meet - JDK 21의 신기능 Virtual Thread 알아보기](https://www.youtube.com/watch?v=vQP6Rs-ywlQ)
- [우아한 기술블로그 - Java의 미래, Virtual Thread](https://techblog.woowahan.com/15398/)
- [Virtual Thread란 무엇일까? (1)](https://findstar.pe.kr/2023/04/17/java-virtual-threads-1/)
- [[10분 테코톡] 푸우의 Tomcat Thread Pool](https://www.youtube.com/watch?v=prniILbdOYA)