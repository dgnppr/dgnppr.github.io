---
layout  : wiki
title   : System.currentTimeMillis() 정말 정확할까
summary :
date    : 2023-12-31 00:00:00 +0900
updated : 2023-12-31 00:00:00 +0900
tag     : level-2 leaf essay os java
toc     : true
comment : true
public  : true
parent  : [[/essay]]
latex   : true
---
* TOC
{:toc}

## 요약 및 글을 쓰게 된 계기

### 요약

- `System.currentTimeMillis()`는 시스템 콜을 호출하여 `OS`에서 제공하는 시계를 사용한다.
- 호스트는 하드웨어 타이머로 시간을 카운트하고, 여러가지 방법으로 시간을 재조정하며 시간을 동기화한다.
- 컴퓨터에서 시간은 오차가 발생할 수 있고, 이를 줄이기 위해서는 비싸고 복잡한 방법이 필요하다. 

### 글을 쓰게 된 계기

선착순 이벤트, UUID 등 시간을 활용한 시스템을 개발하는 경우가 많다. 

진행 중인 프로젝트에서 `Java`의 `System.currentTimeMillis()`를 사용하고 있는데, 정말 어디서나 정확한 시간일까라는 생각이 들었다.
왜냐하면 서버가 서로 다른 호스트나 컨테이너에 띄워질 경우에 시간이 다른 경우가 발생하면 데이터 정합성이 깨지기 때문이다.

<br><br><br>

## currentTimeMillis()

언어 차원에서 제공하는 시간 측정 방법이 정확한지, 어떤 방식으로 시간을 측정하는지 궁금해져서 찾아보았다.

![](https://github.com/dragonappear/dragonappear.github.io/assets/89398909/21bfa163-f76f-4427-9bbc-e07b1b162036)

코드를 보니 C 언어로 구현되어 있고, 주석을 보니 운영체제 시간에 의존한다고 적혀져있다.

![](https://github.com/dragonappear/dragonappear.github.io/assets/89398909/3e44299e-3416-4c71-ace1-dea78fcacb75)

`System.currentTimeMillis()` 에서 호출하는 native 구현체를 [깃허브](https://github.com/openjdk/jdk/blob/32d80e2caf6063b58128bd5f3dc87b276f3bd0cb/src/hotspot/os/posix/os_posix.cpp#L1382)에서 찾아봤는데
`javaTimeMills()` 함수에서 `clock_gettime` 이라는 시스템 콜을 호출하여 `jlong`으로 반환하는 것을 볼 수 있다. 즉, `clock_gettime` 시스템 콜을 호출하여 시간을 가져오고, 밀리세컨드로 반환한다.

<br><br><br>

## clock_gettime()

![Screenshot 2023-12-31 at 03 28 22](https://github.com/dragonappear/dragonappear.github.io/assets/89398909/b08b38d3-4331-4faf-834e-f6ada0a719d1)

[리눅스 공식 문서](https://linux.die.net/man/3/clock_gettime)에서 발췌한 내용이다.

커널에서는 `CLOCK_REALTIME`, `CLOCK_MONOTONIC`, `CLOCK_PROCESS_CPUTIME_ID`, `CLOCK_THREAD_CPUTIME_ID` 등의 시계를 제공하는데,

![Screenshot 2023-12-31 at 03 32 17](https://github.com/dragonappear/dragonappear.github.io/assets/89398909/d036a94f-760a-4060-8138-571992a15234)

`clock_gettime`은 `CLOCK_REALTIME` 시계(실제 시간을 (즉 벽시계 시간을) 재는 설정 가능한 시스템 전역 클럭)를 사용한다. 그러면 `CLOCK_REALTIME` 시계는 어떻게 동작할까?  

<br><br><br>

## CLOCK_REALTIME

- Epoch(1970년 1월 1일 0시 0분 0초) 이후의 시간을 초 및 나노초 단위로 추적하기 위해 컴퓨터에서 사용되는 **클록**이고, 쉽게 벽시계라고 생각하면 된다.
  - 실제 시간을 나타내고, 시간을 연속적인 단방향으로 항상 증가한다.
  - 시스템 관리자가 수동으로 시계를 변경할 수 있다.
- [NTP(Network Time Protocol)](https://en.wikipedia.org/wiki/Network_Time_Protocol) 또는 [adjtime(3)](https://docs.oracle.com/cd/E86824_01/html/E54765/adjtime-2.html)과 같은 점진적인 조정에 의해 영향을 받는다.
  - `NTP`는 요약하면 네트워크 기반 시계 동기화 프로토콜이고, 교차 알고리즘을 사용하여 시간 서버를 선택하여 시간을 동기화한다.
  - `adjtime(3)`은 시스템의 시간이 실제 시간과 일치하지 않을 수 있는데, 이를 보정하는 시스템 콜이다.

<br>

### 동작

1. 컴퓨터가 부팅되면, 운영체제는 RTC(Real Time Clock)를 읽어서 `CLOCK_REALTIME` 초기화
2. 시스템 타이머가 일정한 주기로 클록 인터럽트를 발생시킨다.
3. 커널은 클록 인터럽트를 받아서 `CLOCK_REALTIME` 시계를 증가시킨다. (타이머카운터를 증가시킴)
4. `NTP`, `adjtime(3)`에 의해 `CLOCK_REALTIME` 시계를 정기적으로 조정

> 시스템 타이머 인터럽트 발생 동작
> 1. 타이머 하드웨어(메인보드에 내장된 별도의 하드웨어): 타이밍 크리스탈에 의해 구동된다.
> 2. 카운트 다운: 타이머는 설정된 시간 간격마다 카운트다운 수행
> 3. 인터럽트 생성: 카운트다운이 완료될 때 마다 타이머는 시스템에 인터럽트 신호 전송
> 4. 시간 업데이트: 커널은 인터럽트를 받아서 시간(`CLOCK_REALTIME`)을 업데이트

<br><br><br>

### RTC(Real Time Clock)

- 독립적인 실시간 클록 하드웨어
- 보통 메인보드에 탑재되어 있음
- 독립적인 배터리에 의해 전원이 공급되기 때문에 컴퓨터 전원이 꺼져도 시간을 증가시킨다
- 타이밍 크리스탈(주파수로 진동)로 시간 계산

> 타이밍 크리스탈은 일정한 주파수로 진동하여 시간을 측정하는데, 외부 요인에 영향을 않는한 일정하게 유지된다.
> 그러나 노화, 온도, 전압, 노이즈 등 외부 요인에 의해 주파수가 변동되기 때문에, 이를 보정하기 위해 NTP와 같은 프로토콜을 사용한다.

<br><br><br>

## `CLOCK_REALTIME`이 정확한 시간이라고 할 수 있을까?

나는 `CLOCK_REALTIME`이 정확한 시간이라고 할 수 없다고 생각한다.

- 시스템 관리자가 수동으로 시계를 변경할 수 있다는 점
- `CLOCK_REALTIME` 시계를 조정하는 `NTP`, `adjtime(3)`의 정확도가 높지 않을 수 있다는 점
- 타이밍 크리스탈의 주파수가 일정하지 않을 수 있다는 점
- 클럭 인터럽트 발생 주기가 일정하지 않을 수 있다는 점
- 인터럽트를 처리하는 속도에도 차이가 있을 수 있다는 점

`CLOCK_REALTIME`이 정확한 시간이 아니라면, 정확한 시간을 어떻게 측정할 수 있을까?

나는 문제가 발생하는 주요 부분은 타이머의 주파수가 변경될 수 있다는 점과 외부 요인(네트워크)에 의존한다는 점으로 본다.

원자의 진동 주파수는 매우 안정적이라서 원자의 진동 주파수를 타이머로 사용하면 어떨까?

~~찾아보니 원자 시계는 매우 비싸고, 크고, 전력 소모가 많다고 하여 휴대용 장치에는 적합하지 않다고 한다. `NTP` 서버 시간도 원자 시계를 기반으로 한다.~~

일반적인 어플리케이션에는 `CLOCK_REALTIME`이 완벽하지는 않지만 어느정도 신뢰할 수 있는 시간이라고 할 수 있지만, 초정밀 시간이 필요한 경우에는 `CLOCK_REALTIME`을 사용하는 것이 적합하지 않다고 생각한다.

<br><br><br>

## 자바 시간 API

자바에서 정밀한 시간을 사용할 때 아래 3가지 API를 사용할 수 있다.

- `System.currentTimeMillis()` = 시스템 시간 참조
- `System.nanoTime()` = 기준 시점에서 경과 시간 측정 (시스템 시간과 무관)
- `Instant.now()` = 시스템 시간 참조

`System.nanoTime()`는 시스템 시간과 무관하게 경과 시간을 측정한다. 이는 성능 측정 등에서 유용하게 사용된다.

### System.currentTimeMillis() vs Instant.now()

`System.currentTimeMillis()`와 `Instant.now()` 모두 시스템 시간을 기반으로 하기 때문에 근본적으로 동일한 정확도를 가진다. 둘 다 운영 체제의 시스템 시간을 기반으로 하지만, `Instant.now()`는 시간 처리(추가적인 시간 연산이나 시간대)을 제공할 수 있다.

`System.currentTimeMillis()`는 객체 생성 없이 빠르게 시간을 얻을 수 있으므로 성능 면에서 이점이 있고, `Instant.now()`는 시간 처리 기능을 제공하며, `java.time` 패키지의 다른 클래스와 잘 통합된다.

성능 측정에는 `System.nanoTime()`, 시간 처리에는 `Instant.now()`, 간단하게 시간만 측정한다고 하면 `System.currentTimeMillis()`를 사용하는 것이 좋을 것 같다.

<br><br><br>

## 클라우드 시간 동기화

프로그래밍 언어에서 현재 시간(UTC)을 구하려면 호스트 OS에 의존적이고, 호스트 OS는 하드웨어 타이머에 의존적이고, 타이머는 호스트마다 오차가 발생할 수 있다. 오차가 발생하게 되면 분산 시스템에서 시간이라는 중요한 데이터가 일치하지 않게 된다.
그러면 분산 시스템에서 시간을 동기화하는 방법은 어떤 것이 있을까?

`PTP` 프로토콜이나 `GPS` 시계를 사용하여 동기화를 할 수 있다고 하는데 이는 OS 단에서 시간을 동기화하는 방법이고 실행 중인 모든 서버에 접속해서 적용하는 것은 쉽지 않을 것이라고 본다. 나에게는 실질적으로 시간을 동기화해주는 자동화 도구가 필요하다.

나는 클라우드 환경에 서버를 배포하는데, 그러면 클라우드 플랫폼 차원에서 시계 동기화를 어떤식으로 관리하는지 궁금해졌다. 클라우드 환경에서 여기서는 `AWS`를 예로 들겠다. `AWS`에서는 어떤 식으로 시계 정확도 관리를 하는지 찾아보았다. 

[EC2](https://aws.amazon.com/ko/blogs/mt/manage-amazon-ec2-instance-clock-accuracy-using-amazon-time-sync-service-and-amazon-cloudwatch-part-1/) 나
[Fargate](https://aws.amazon.com/ko/about-aws/whats-new/2021/09/monitoring-clock-aws-fargate-amazon-ecs/)  둘 다 `AWS Time Sync Service`를 제공하여 클럭 정확도를 측정하고 클럭 오차 범위를 제공한다고 한다.
`AWS Time Sync Service` 에서는 `NTP`나 `PTP`로 시간을 동기화한다고 하는데 `PTP`의 경우 지원되는 인스턴스가 제한적인데, 로컬 `PTP` 하드웨어 시계를 제공한다고 하는데 아마 원자 시계처럼 매우 정밀한 시계를 사용하여 지원하는 것 같다.
[공식 문서](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/set-time.html)에서 인스턴스를 `AWS Time Sync Service`로 동기화하는 방법을 볼 수 있다.

살펴보니 클라우드에서도 시간 동기화 프로토콜을 사용하는데, 오차 범위가 발생하는 것으로 보인다. 어느 정도 오차 범위를 감수해야 하는 부분인 것 같다..

<br><br><br>

## 결론

- `Java`의 `System.currentTimeMillis()`는 `clock_gettime` 시스템 콜을 호출하여 `CLOCK_REALTIME` 시계를 사용한다.
- `CLOCK_REALTIME`은 OS와 하드웨어 따라 달라질 수 있다. **분산 시스템에서 같은 코드라도 서로 다른 시간을 반환할 수 있다.**
  - 여러가지 요인에 의해 `CLOCK_REALTIME` 시계는 초정밀 시간을 요구하는 어플리케이션에는 적합하지 않다.
- AWS 환경에서는 `NTP` 프로토콜을 사용하여 시간 동기화를 제공한다.

<br><br><br>

## 참고

- https://github.com/openjdk/jdk
- https://linux.die.net/man/3/clock_gettime
- https://www.ibm.com/docs/ko/aix/7.3?topic=c-clock-getres-clock-gettime-clock-settime-subroutine
- https://www.baeldung.com/linux/timekeeping-clocks
- https://en.wikipedia.org/wiki/Network_Time_Protocol
- https://docs.oracle.com/cd/E86824_01/html/E54765/adjtime-2.html
- https://aws.amazon.com/ko/blogs/korea/keeping-time-with-amazon-time-sync-service/
- https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/set-time.html