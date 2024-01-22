---
layout  : wiki
title   : MySQL 서버 변수 설정
summary : 
date    : 2023-12-19 00:00:00 +0900
updated : 2023-12-19 00:00:00 +0900
tag     : post database mysql
toc     : true
comment : true
public  : true
parent  : [[/database]]
latex   : true
---
* TOC
{:toc}

## InnoDB

### 버퍼풀 크기 조정(`innodb_buffer_pool_size`)

InnoDB 버퍼풀 크기 설정 변수로 버퍼풀 크기가 클수록 디스크 I/O가 줄어들고 성능이 향상된다. 
하지만 이 값이 너무 크면, MySQL 서버가 사용할 수 있는 메모리가 부족해져서 스왑이 발생하거나, MySQL 서버가 다운될 수 있다.

```SQL
SET GLOBAL innodb_buffer_pool_size = <크기>; -- 크기는 바이트 단위
SET GLOBAL innodb_buffer_pool_size = (1024 * 1024 * 1024 * 0.5); -- 사용 가능한 메모리의 50%를 버퍼풀 크기로 설정
```

일반적으로 사용 가능한 메모리의 50~80% 범위내에서 설정하기

<br>

### 로깅깅 매커니즘 조절 (`innodb_flush_log_at_trx_commit`)

트랜잭션이 커밋될 때 로그 버퍼의 내용을 디스크에 얼마나 자주 기록할지 결정한다.

```SQL
SET GLOBAL innodb_flush_log_at_trx_commit = 1; -- 안정성 중시
SET GLOBAL innodb_flush_log_at_trx_commit = 2; -- 성능 중시
```

- 값 1: 트랜잭션 커밋마다 로그를 플러시한다. 데이터의 안정성을 최대화하지만 성능에 부담을 준다.
- 값 2: 로그는 플러시되지 않고, 매 1초마다 OS 버퍼에만 기록된다. 

트랜잭션이 많은 시스템이면 값 2번을 사용해보자


<br>

### 데드락

동시 처리양이 많으면 데드락 감지 스레드 끄고, 데드락 잠금 대기 타임아웃 재설정하기

```SQL
SET GLOBAL innodb_deadlock_detect = OFF; -- 데드락 감지 스레드 끄기
SET GLOBAL innodb_lock_wait_timeout = 5; -- 기본값 50(초)보다 훨씬 낮은 시간으로 변경
```

데드락 감지 스레드를 사용한다면, MySQL 엔진에서 관리하는 테이블 레벨의 잠금도 감지하도록 설정하기

```SQL
SET GLOBAL innodb_table_locks = 1;
```

<br>