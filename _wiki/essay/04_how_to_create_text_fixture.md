---
layout  : wiki
title   : Test Fixture 어떻게 생성해야 할까
summary :
date    : 2024-01-29 00:00:00 +0900
updated : 2024-01-29 00:00:00 +0900
tag     : essay test java
toc     : true
comment : true
public  : false
parent  : [[/essay]]
latex   : true
---
* TOC
{:toc}

## 서론

필자는 테스트 코드에 대해서 많은 고민을 하는 편이다. 
테스트 코드는 어플리케이션의 신뢰성을 보장해주는 중요한 요소임에 동시에 문서의 역할도 한다. 
테스트 코드를 보면서 어플리케이션의 동작을 이해할 수 있기 때문이다.

<br>

테스트 코드에서 테스트를 수행할 때 항상 고민이 되는 부분은 테스트 데이터를 어떻게 생성해야 할까이다.
앞에서 언급했듯 테스트는 문서의 역할도 하기 때문에 테스트 메서드 하나에 테스트의 목적과 역할을 명확하게 드러내야 한다.
테스트 데이터를 생성하는 방법에 따라 테스트 메서드의 의도가 드러나지 않을 수 있다.

<br>

어떠한 이유로 테스트에 필요한 데이터가 너무 많거나, 테스트 픽스쳐를 생성하는데 너무 많은 시간이 소요되는 경우가 있다.
이러한 경우 때문에 테스트 픽스쳐를 별도의 클래스에 정의하고, 테스트 메서드에서는 테스트 픽스쳐를 생성하는 메서드를 호출하는 방법을 사용하기도 한다.
하지만 테스트 메서드 안에서 테스트 픽스쳐를 생성하지 않기 때문에 테스트 픽스쳐의 생성 과정을 이해하기 어려울 수 있다. 
이것으로 인해 온전히 테스트 메서드 하나로서 문서의 역할을 하지 못할 수 있다.

<br>

모든 테스트 픽스쳐를 테스트 메서드에 정의하는 것은 불필요하게 많은 코드를 작성하게 할 수 있고, 테스트 메서드 자체가 길어질 수도 있다.
따라서 적절하게 테스트 픽스쳐를 생성하는 방법에 대해서 고민하게 되었고, 이 글을 통해서 좀 더 효율적으로 테스트 픽스쳐를 만들어보고자 한다.

<br><br><br>

## 테스트 메서드 안에서 정의하기

<br><br><br>

## 테스트 메서드 외부로 추출하기

<br><br><br>

## Object Mother 패턴 적용하기

<br><br><br>

## 라이브러리 사용하기

### Fixture Monkey

<br>

### JavaFaker

<br><br><br>

## 나의 생각

<br><br><br>

## Ref

- https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/ctx-management.html
- https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/ctx-management/caching.html
- https://www.baeldung.com/java-faker
- https://velog.io/@langoustine/%EC%98%A4%EB%B8%8C%EC%A0%9D%ED%8A%B8%EB%A7%88%EB%8D%94%ED%8C%A8%ED%84%B4%EB%8F%84%EC%9E%85%EA%B8%B0-%EA%B7%BC%EB%8D%B0Enum%EC%9D%84%EA%B3%81%EB%93%A4%EC%9D%B8
- https://naver.github.io/fixture-monkey/
- https://www.instancio.org/
- https://velog.io/@langoustine/Test-Fixture
- https://jojoldu.tistory.com/611
- https://deview.kr/2021/sessions/417
- https://toss.tech/article/how-to-manage-test-dependency-in-gradle