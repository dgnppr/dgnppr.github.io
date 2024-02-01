---
layout  : wiki
title   : 롬복 꼭 사용해야 하는가
summary : 
date    : 2023-12-21 00:00:00 +0900
updated : 2023-12-21 00:00:00 +0900
tag     : essay java
toc     : true
comment : true
public  : true
parent  : [[/essay]]
latex   : true
---
* TOC
{:toc}

## 글을 쓰게 된 계기

처음 자바를 배우고, 개발을 시작할 때 롬복이라는 것을 알게 되었고 편하기 때문에 프로젝트 세팅할 때 무조건 깔고 시작했다. 

하지만 롬복은 내가 인지하지 못하는 사이에 문제를 일으킬 수 있다는 것을 여러 코드에서 경험하게 되었다.

본 글에서 어떤 점들이 문제를 일으킬 수 있는지 알아보고, 나의 생각을 정리해보려고 한다.

우선 롬복이라는 것이 어떻게 동작하는지 알아보자.

<br><br><br>

## 롬복 동작 과정

- 어노테이션 기반으로 각종 보일러플레이트(getter, setter 그외 기타 등등)를 만들어준다.
- 컴파일 시점에 AST`를 수정하여 코드를 생성한다.
  - 컴파일 과정은 크게 `Parse and Enter` -> `Annotation Processing` -> `Analyse and Generate`로 나뉜다
  - 컴파일 시점에서 주석을 처리하는 단계에서 어노테이션 프로세서가 호출된다
  - 어노테이션 프로세서는 소스를 수정해서 새로운 소스로 생성하는 작업을 수행한다
  - 새로운 소스로 생성되면 다시 `Parse and Enter`-> `Annotation Processing` -> `Analyse and Generate` 순으로 작업이 이루어진다
    - 새로운 소스 파일이 생성되지 않을때까지 위 프로세스가 반복된다
  - `Analyse and Generate` 단계에서 컴파일러가 1단계에서 생성된 AST에서 바이트 코드를 생성한다
- 롬복은 기존 어노테이션 프로세서처럼 새로운 소스 파일을 생성하지 않고 기존 클래스를 수정한다.
  - **즉, AST를 수정함으로써 새로운 메서드(getter,setter 등)을 생성하거나 기존 메서드에 코드를 삽입한다.**

요약하면, 롬복은 컴파일 시점에 새로운 소스 파일을 생성하지 않고 코드를 삽입한다.

<br><br><br>

## 롬복 Pitfall

이제부터 롬복에서 발생할 수 있는 의도치 않은 문제들을 알아보자.

### `@AllArgsConstructor`, `@RequiredArgsConstructor`

```java
@AllArgsConstructor
public class Person {
    private int age;
    private int num;

    public static void main(String[] args) {
        new Person(20, 1);
    }
}
```

`@AllArgsConstructor`, `@RequiredArgsConstructor` 를 사용하면 생성자를 만들어주기 때문에 정말 편하다.

바이트코드를 보면 아래와 같이 필드가 선언된 순서대로 생성자가 생성된 것을 확인할 수 있다.
 (Person.num -> Person.age)

```java
  public <init>(II)V
    // parameter final  num
    // parameter final  age
   L0
    LINENUMBER 5 L0
    ALOAD 0
    INVOKESPECIAL java/lang/Object.<init> ()V
    ALOAD 0
    ILOAD 1
    PUTFIELD me/dgpr/lombok/Person.num : I
    ALOAD 0
    ILOAD 2
    PUTFIELD me/dgpr/lombok/Person.age : I
    RETURN
   L1
    LOCALVARIABLE this Lme/dgpr/lombok/Person; L0 L1 0
    LOCALVARIABLE num I L0 L1 1
    LOCALVARIABLE age I L0 L1 2
    MAXSTACK = 2
    MAXLOCALS = 3
```

만약에 이렇게 짜여진 코드에서 아래처럼 필드 선언 순서 변경한다고 가정해보자.

```Java
@AllArgsConstructor
public class Person {
    private int num;
    private int age;
    
    public static void main(String[] args) {
        new Person(20, 1);
    }
}
```

위 코드는 컴파일 에러가 발생하지 않는다. 왜냐하면 롬복이 개발자가 인식하지 못하는 사이에 생성자 파라미터 순서를 필드 선언에 맞춰 생성자를 생성해준다.

```java
  public <init>(II)V
    // parameter final  age
    // parameter final  num
   L0
    LINENUMBER 5 L0
    ALOAD 0
    INVOKESPECIAL java/lang/Object.<init> ()V
    ALOAD 0
    ILOAD 1
    PUTFIELD me/dgpr/lombok/Person.age : I
    ALOAD 0
    ILOAD 2
    PUTFIELD me/dgpr/lombok/Person.num : I
    RETURN
   L1
    LOCALVARIABLE this Lme/dgpr/lombok/Person; L0 L1 0
    LOCALVARIABLE age I L0 L1 1
    LOCALVARIABLE num I L0 L1 2
    MAXSTACK = 2
    MAXLOCALS = 3
```

바이트 코드의 생성자 파라미터 순서를 보면 `age`가 먼저 선언되어 있고, `num`이 그 다음에 선언되어 있다.

클라이언트 코드는 아무런 문제가 없지만, 개발자가 의도하지 않은 생성자로 객체를 생성하는 문제가 발생한다.


### `@EqualsAndHashCode`

Mutable 객체에 아무 파라미터 없는 `@EqualsAndHashCode`를 사용하면 문제가 발생한다.

```java
@EqualsAndHashCode
public class Person {
    private int num;
    private int age;

    public Person(int num, int age) {
        this.num = num;
        this.age = age;
    }

    public void setNum(int num) {
        this.num = num;
    }

    public static void main(String[] args) {
        Person person = new Person(1, 20);

        Set<Person> persons = new HashSet<>();
        persons.add(person);

        System.out.println("변경 전 : " + persons.contains(person)); // true

        person.setNum(2);
        System.out.println("변경 후 : " + persons.contains(person)); // false
    }
}
```

동일한 객체임에도 `Set`에 저장한 뒤에 필드 값을 변경하면 `hashcode`가 변경되기 때문에 `Set`에 저장된 객체를 찾을 수 없다.


### `@Data`

![Screenshot 2024-01-01 at 01 43 45@2x](https://github.com/dragonappear/dragonappear.github.io/assets/89398909/2e797105-a5b1-4443-a730-fccd3080c130)
    
- `@Data`는 `@ToString`, `@EqualsAndHashCode`, `@Getter`, `@Setter`, `@RequiredArgsConstructor`를 한꺼번에 사용하는 어노테이션이다.
- `@Data`를 사용하면 `@RequiredArgsConstructor`, `@EqualsAndHashCode`를 사용하는 것과 동일한 문제가 발생한다.

<br>

### `@Value`

![Screenshot 2024-01-01 at 01 46 30@2x](https://github.com/dragonappear/dragonappear.github.io/assets/89398909/5ddd0fa3-6071-4895-b5ee-7b98f6a2ed7d)


- `@Value`는 Immutable 클래스를 만들어주는 조합 애노테이션이지만 이 또한 `@EqualsAndHashCode`, `@AllArgsConstructor` 를 포함한다. 
- `@EqualsAndHashCode`는 불변 클래스라 큰 문제가 안되지만 `@AllArgsConstructor`가 문제가 된다.

### `@Builder`

빌더 또한 `@AllArgsConstructor`를 포함한다.

### `ToString()`

순환 참조 문제

### `ToString()`, `EqualsAndHashCode()`

필드명 지정시 오타 문제

<br><br><br>

## 나의 생각

롬복을 사용하면 정말 편리하지만, 개발자가 의도하지 않은 문제가 발생할 수 있다. 
머릿속으로 롬복의 주의 사항을 알고 있어도, 사람이기 때문에 실수를 할 수 있다. 그래서 앞으로 나는 개인 프로젝트에서 롬복 사용을 하지 않으려고 한다. 

요즘은 `IDEA`에서 왠만한 코드(getter, setter, equalsHashCode 등)는 지원을 해주기 때문에 롬복을 사용하지 않아도 불편함이 크지 않다.
보통 DTO 클래스에 어노테이션을 붙여서 코드를 작성했는데, 이것도 레코드를 사용하면 롬복이 필요없게 된다.

<br><br><br>

## lombok.config 어노테이션 사용금지 및 각종 설정

정말 롬복을 사용하고 싶다면, 설정 파일에서 문제를 일으킬 수 있는 어노테이션을 사용하지 못하도록 설정할 수 있다.

프로젝트 최상단 디렉토리에 `loombok.config` 파일을 생성하고 아래와 같이 설정하면 어노테이션 사용을 금지할 수 있다.

```properties
config.stopBubbling = true
lombok.data.flagUsage=error
lombok.value.flagUsage=error
lombok.val.flagUsage=error
lombok.var.flagUsage=error
lombok.nonNull.flagUsage=error
lombok.allArgsConstructor.flagUsage=error
lombok.requiredArgsConstructor.flagUsage=error
lombok.cleanup.flagUsage=error
lombok.sneakyThrows.flagUsage=error
lombok.synchronized.flagUsage=error
# experimental 전체 금지
lombok.experimental.flagUsage=error
```

위와 같이 지정하면 `@Data`, `@Value`, `@NonNull`, `@AllArgsConstructor`, `@RequiredArgsConstructor` 등의 어노테이션을 사용하면 컴파일 에러가 발생한다.

<br><br><br>

## Ref

- http://projectlombok.org/
- https://kwonnam.pe.kr/wiki/java/lombok
- https://notatube.blogspot.com/2010/11/project-lombok-trick-explained.html
- https://www.happykoo.net/@happykoo/posts/256
