---
layout  : wiki
title   : MySQL 서버 설정
summary : 
date    : 2023-12-19 18:00:00 +0900
updated : 2023-12-19 18:00:00 +0900
tag     : database mysql
toc     : true
comment : true
public  : true
parent  : [[/database]]
latex   : true
---
* TOC
{:toc}

## InnoDB

### 버퍼풀 크기

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