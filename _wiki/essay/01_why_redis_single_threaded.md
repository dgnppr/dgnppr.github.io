---
layout  : wiki
title   : 왜 레디스를 싱글 스레드로 만들었을까
summary :
date    : 2023-12-24 00:00:00 +0900
updated : 2023-12-24 00:00:00 +0900
tag     : essay redis os
toc     : true
comment : true
public  : true
parent  : [[/essay]]
latex   : true
---

* TOC
{:toc}

## 글을 쓰게 된 계기

레디스는 초당 100,00 QPS 이상 처리가 가능하다고 한다. 왜 멀티쓰레드가 아닌 싱글 스레드로 개발을 했고, 어떻게 이런 성능을 낼 수 있었을까?

Redis 개발자인 Salvatore Sanfilippo가 왜 싱글 스레드로 개발했는지에 대한 Git 커밋 및 인터뷰는 찾지 못했지만 그의 관점이
담긴 [인터뷰](https://venturebeat.com/dev/redis-creator)를 찾아봤다.
아래 대답에서 어떤 관점에서 싱글 스레드로 개발했는지 알 수 있었다.

> I’m very focused on keeping it small, I don’t have a good reputation for being open-minded with new features. I’m
> extremely conservative. Otherwise, after seven years of contributions, if I accepted most of them, it would be huge at
> this point. So people are happy about this point. However, there are also people who are concerned, because half of the
> community shares my opinion about keeping things extremely simple. It’s the point of view of the programmer who believes
> in [the system] not being able to cope with complexity. That’s my point of view and the point of view of many other
> programmers at the moment. People are realizing that complex systems — you can make whatever effort to make them work,
> but they have lots of unexpected side effects when you’re in production and you start to mix one complex system with
> another complex system. They fail in ways that you could never imagine. To keep things simple is good. The community is
> worried about modules starting some trend of complexity in Redis.

<br>

인터뷰 전문을 보았을 때 그는 레디스를 작고 간단하게 유지하고 싶어하고 그는 레디스가 복잡한 시스템이 되는 것을 원하지 않는다고 한다.

캐시 서버를 만든 엄청난 실력자가 오로지 심플하게 만들고 싶어서 싱글 쓰레드로 만들었을까? 기대치 성능이 안나와도 심플하게 만들고 싶어서 싱글 쓰레드로 만들었을까?

나는 그것은 아닐 것이라고 생각한다.

본 글에서 이제 어떻게 싱글 스레드임에도 빠르게 동작할 수 있는지 알아보려고 한다.

<br><br><br>

## 싱글 스레드인 이유

- 쉬운 구현 (멀티스레드에서 발생하는 동기화 문제를 해결할 필요가 없다.)
- 동시성 보장 (이벤트 루프 패턴을 통해 동시성을 구현하였고, 컨텍스트 스위치가 없다.)
- **CPU 는 병목 현상이 아니다.
  ** [병목 현상은 Memory, Network Bound 이다.](https://redis.io/docs/get-started/faq/#how-can-redis-use-multiple-cpus-or-cores)
- 쉬운 배포 (한 개의 코어만 있어도 사용 가능하기 때문이다.)

![Screenshot 2024-01-23 at 14 01 31](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/02c3687d-0da2-4026-b1ea-ae43ad6264c5)

레디스는 이벤트 루프를 사용하여 `Request`를 처리한다. 즉, 실제 명령에 대한 `Task`는 커널 레벨에서 `Multiplexing` 을 통해 처리하여 동시성을 보장한다.
요약하면 유저 레벨에서는 싱글 스레드로 동작하고, 커널 레벨에서 멀티플렉싱을 통해 동시성을 보장한다.

```c++
void aeMain(aeEventLoop *eventLoop) {
    eventLoop->stop = 0;
    while (!eventLoop->stop) {
        aeProcessEvents(eventLoop, AE_ALL_EVENTS|
                                   AE_CALL_BEFORE_SLEEP|
                                   AE_CALL_AFTER_SLEEP);
    }
}
```

`Redis`의 메인 이벤트 루프는 `aeMain()` 함수에서 구현되고, 해당 함수에서 이벤트 루프를 돌면서 `aeProcessEvents()` 함수를 호출하면서 사용자의 요청을 처리한다.
보면 알 수 있듯이 컨텍스트 스위치 없이 메인 스레드에서 이벤트 루프를 `busy waiting`을 하고 있음을 볼 수 있다.

<br><br><br>

## 메인 스레드

메인 스레드에서 실행하는 `main()` [메서드](https://github.com/redis/redis/blob/unstable/src/server.c#L6886C18-L6886C18)를 보자.

```c++
int main(int argc, char **argv) {
    struct timeval tv;
    int j;
    char config_from_stdin = 0;
    
    ...
    ...
    ...

    initServer();
    if (background || server.pidfile) createPidFile();
    if (server.set_proc_title) redisSetProcTitle(NULL);
    redisAsciiArt();
    checkTcpBacklogSettings();
    if (server.cluster_enabled) {
        clusterInit();
    }
    if (!server.sentinel_mode) {
        moduleInitModulesSystemLast();
        moduleLoadFromQueue();
    }
    ACLLoadUsersAtStartup();
    initListeners();
    if (server.cluster_enabled) {
        clusterInitLast();
    }
    InitServerLast();

    aeMain(server.el);
    aeDeleteEventLoop(server.el);
    
    return 0;
}
```

- 각종 초기화(서버 구성, 모듈, 로그 등)
- 데몬 프로세스 실행
- 센티널 설정
- 시스템 검사
- 서버 초기화(PID 파일 생성, 리스너 초기화, ACL 로딩, 클러스터 등)
- 그외 기타 등등

각종 초기화를 거쳐서 메인 이벤트 루프를 실행한다.

<br><br><br>

## 서브 스레드

레디스가 하나의 스레드만 있을까? 그것은 아니다.

```sh
ps -ef | grep redis
```

레디스가 동작하는 환경에서 프로세스를 조회해보면 하나의 스레드만 동작하지 않는 것을 확인할 수 있다.

```c++
static char* bio_worker_title[] = {
    "bio_close_file",
    "bio_aof",
    "bio_lazy_free",
};

#define BIO_WORKER_NUM (sizeof(bio_worker_title) / sizeof(*bio_worker_title))

static pthread_t bio_threads[BIO_WORKER_NUM];
```

위와 같이 3개의 백그라운드 I/O 서브 스레드를 사용함을 알 수 있다.

- `bio_close_file`: 파일을 닫는 스레드
- `bio_aof`: `AOF`를 처리하는 스레드
- `bio_lazy_free`: 메모리를 해제하는 스레드 (레디스는 큰 객체를 삭제할 때 즉시 삭제하는 대신 지연 삭제를 사용한다.)

> Redis DEL operations are normally blocking, so if you send Redis “DEL mykey” and your key happens to have 50 million
> objects, the server will block for seconds without serving anything in the meantime.

메모리 해제 실행 시 블로킹 현상으로 인한 장애 현상을 해결하기 위해

> "Non blocking DEL and FLUSHALL/FLUSHDB" There is a new command called UNLINK that just deletes a key reference in the
> database, and does the actual clean up of the allocations in a separated thread

`UNLINK`, `FLUSHALL`, `FLUSHDB` 명령어가 4.0 버전부터 추가되었고, 이를 처리하기 위한 `lazy_free` 스레드가 추가되었다.

![Screenshot 2024-01-23 at 14 05 21](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/2b912bbc-8263-460d-8520-3b0f61f37a80)

위 그림은 싱글 쓰레드 형식의 이벤트 루프 방식이다.

<br>

![Screenshot 2024-01-23 at 14 11 05](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/dd453be0-c24c-4baf-ace2-33c57678bf6b)

아래 그림은 I/O 작업을 위한 멀티 쓰레드가 도입된 버전 6.0이다. 멀티 스레드는 네트워크 데이터 read, write, parsing 을 담당하고 명령어 실행(`ProcessCommand`)은 메인 스레드에서
담당하기 때문에 레디스의 `Atomic` 특성을 유지한다.
이렇게 네트워크 처리를 위한 멀티 스레드가 도입된 것을 보면 "CPU 는 병목 현상이 아니다." 라는 레디스의 주장을 뒷받침해준다.

<br><br><br>

## 나의 생각 및 요약

### 나의 생각

레디스가 싱글 스레드로도 높은 QPS를 보일 수 있는 이유는 레디스가 적용되는 범위와 자료구조 덕분이라고 생각한다. 레디스는 인메모리 기반이기 때문에 다른 RDB의 고려사항(디스크 I/O 기타 등등 )보다 현저하게
적다고 생각한다. 그래서 네트워크, 메모리가 병목점이라고 보는 것 같다.

나는 레디스가 멀티 스레드로 동작한다면 지금보다도 훨씬 높은 성능을 보일 것 같다. 물론 동기화, 메모리 이슈(`RDB`, 단편화, 압축 등)가 발생하겠지만, 메모리에 저장되는 자료구조(ex: 해시테이블 등)는
비교적 간단하고, 메모리 접근이 매우 빠르고, 낮은 경합이 이뤄질 것이라고 보기 때문에
동기화를 처리하는 디메리트보다 성능 개선이 더 메리트를 가질 것이라고 생각한다.

멀티 쓰레드를 사용하게 되면 메모리 사용량이 증가할텐데, 이 부분에서 레디스에서 고민이 되지 않을까 싶다. 메모리를 최대한 활용하기 위해서 쓰레드풀을 사용하고 메모리를 효율적으로 사용하는 자료 구조를 사용하면 좋을
것 같다.
쓰레드풀으로 쓰레드 생성 비용을 줄이고, 링 버퍼와 같은 자료구조를 사용하여 고정 크기의 버퍼에 데이터를 저장하여 메모리 단편화을 줄이면서 메모리를 관리하면 좋을 것 같다.

네트워크 처리를 위해 레디스에 멀티 쓰레드가 도입되어서 더 빠른 성능을 제공하는 것처럼 명령어를 처리하는 쓰레드를 멀티 쓰레딩한다면 더 빠른 성능을 제공할 수 있지 않을까 싶다.

<br><br><br>

### 요약

많은 현대 서버에서는 멀티 스레드를 통해 서빙하는데, 스레드 간 동기화 및 컨텍스트 스위치 비용은 비싸다. 레디스는 이러한 비용을 줄이기 위해 싱글 스레드로 동작한다. 왜냐하면 속도 병목 현상의 원인을 CPU가
아니라 Memory, Network 이라고 판단했기 때문이다.
단일 스레드로 동작하는 이벤트 루프를 통해서 성능을 높혔고, 레디스의 주요 명령어는 `O(1)`의 시간 복잡도로 매우 빠르게 동작하고, Atomic 하게 유지함으로써 레디스는 현재 매우 인기 있는 캐시 솔루션이
되었다고 생각한다.

<br><br><br>

## 기타

레디스는 싱글 스레드로 동작하는 것이 마음에 들지 않는 사람들이 멀티 스레드로
동작하는 `KeyDB`([A Multithreaded Fork of Redis That’s 5X Faster Than Redis](https://docs.keydb.dev/blog/2019/10/07/blog-post/))
를 만들었다고 한다.
`KeyDB` 사 벤치마크 결과 5배 빠르다고 하는데 멀티스레드 이벤트 루프 실행, 핵심 데이터 구조 최적화 등 멀티스레딩 작업과 최적화 작업을 통해서 성능을 높혔다고 한다.

<br><br><br>

## 참고

- https://redis.com/blog/diving-into-redis-6/
- https://redis.com/blog/making-redis-concurrent-with-modules/
- https://redis.io/docs/get-started/faq/
- https://github.com/redis/redis/tree/unstable/src
- https://medium.com/@jychen7/sharing-redis-single-thread-vs-multi-threads-5870bd44d153
- https://medium.com/@john_63123/redis-should-be-multi-threaded-e28319cab744
- https://charsyam.wordpress.com/2020/05/05/%EC%9E%85-%EA%B0%9C%EB%B0%9C-redis-6-0-threadedio%EB%A5%BC-%EC%95%8C%EC%95%84%EB%B3%B4%EC%9E%90/
- https://www.youtube.com/watch?v=5TRFpFBccQM