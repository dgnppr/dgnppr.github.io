---
layout  : wiki
title   : 제네릭 - Producer Extends, Consumer Super
summary :
date    : 2024-03-24 00:00:00 +0900
updated : 2024-03-24 00:00:00 +0900
tag     : java
toc     : true
comment : true
public  : true
parent  : [[/java]]
latex   : true
---

* TOC
{:toc}

## 서론

이펙티브 자바 3 에디션의 5장 제네릭 아이템 31(한정적 와일드카드를 사용해 API 유연성을 높이라)를 읽고 실무에서 언제, 어떻게 활용하면 좋을까에 대한 생각을 정리하고자 글을 작성하게 되었습니다.

<br><br><br>

## 한정적 와일드카드 타입을 사용하여 API 유연성 높히기

<br>

```java
public class Stack<E> {

    private List<E> list = new ArrayList<>();

    public void pushAll(Iterable<E> src) {
        for (E e : src) {
            push(e);
        }
    }

    public void push(E e) {
        list.add(e);
    }
}

```

간단하게 `Stack`의 `public API`은 위와 같습니다. 아래와 같이 `Stack`에 일련의 원소를 스택에 넣는 메서드를 작성해본다고 해봅시다.

```java
 public void pushAll(Iterable<E> src) {
    for (E e : src) {
        stack.push(e);
    }
}
```

`src`의 원소 타입과 `Stack`의 원소 타입이 일치하면 별 문제가 없습니다. 하지만, `Stack`을 `Number`로 선언하고, `src`의 원소 타입이 `Integer`라면 어떻게 될까요?
`Integer`은 `Number`의 하위 타입이기 때문에 잘 들어가지 않을까 싶지만, 매개변수화 타입은 **불공변이기 때문에** 아래와 같이 컴파일 에러가 발생합니다.

> 불공변 예시: `List<String>`은 `List<Object>`의 하위 타입이 아닙니다. 그 이유는 `List<String>`이 `List<Object>`가 하는 일을 제대로 수행하지 못하기 때문입니다. (리스코프 치환원칙을 위배)

<br>

```java
@Test
void pushAllTest() {
  Stack<Number> stack = new Stack<>();
  List<Integer> integers = Arrays.asList(1, 2, 3, 4);

  stack.pushAll(integers); // Compile Error
}
```

```java
StackTest. java:7: error: incompatible types: Iterable<Integer>
cannot be converted to Iterable<Number> numberStack.pushAll(integers);
```

<br>

자바는 이런 상황에 대처할 수 있는 **한정적 와일드카드** 이라는 특별한 매개변수화 타입을 지원합니다. 
`Iterable<? extends E> src`를 통해 `pushAll`의 입력 매개변수 타입은 `E`의 `Iterable`이 아닌 `E`의 하위 타입의 `Iterable`이어야 하도록 한정하여 타입을 안전하고 깔끔하게 사용할 수 있게 됩니다.

그렇다면 이제 `Stack`안의 모든 원소를 다른 컬렉션으로 아래와 같이 옮겨 담아봅시다.

```java
public void popAll(Collection<E> dst) {
    while(!isEmpty()){
        dst.add(pop());
    }
}
```

<br>

이번에도 원소 타입이 동일하다면 문제없이 동작합니다. 하지만 아래와 같이 타입이 다르다면 위에서의 예외와 비슷한 예외가 발생하게 됩니다.

```java
Stack<Number> numberStack = new Stack<>();
Collection<Object> objects = ...;
numberStack.popAll(objects);
```

<br>

이번에도 위에서 와일드카드 타입을 사용한 것처럼 `Collection<? super E> dst`로 문제를 해결할 수 있습니다. `extends`가 아닌 `super`를 사용하여 소비자(Consumer) 매개변수에 와일드카드 타입을 사용합니다.
이제 `Stack`과 클라이언트 코드 코드 모두 깔끔하게 컴파일이 가능해집니다.

<br>

**유연성을 극대화하려면 원소의 생산자나 소비자용 입력 매개변수에 와일드카드 타입을 사용해야 합니다.**

<br><br><br>

## PECS(producer-extends, consumer-super) 공식

입력 매개변수가 생산자와 소비자 역할을 동시에 한다면 와일드카드 타입을 사용해도 좋을 게 없습니다. 왜냐하면 타입을 정확히 지정해야 하는 상황이기 때문입니다.
만약 생산자, 소비자 둘 중 하나의 역할을 수행한다면 `PECS(producer-extends, consumer-super)` 공식을 적용하여 와일드카드 타입을 사용하여 타입 문제를 해결할 수 있습니다.

상기 절 `Stack` 예에서 `pushAll`의 `src` 매개변수는 `Stack`이 사용할 E 인스턴스를 생산하므로 `Producer`로 볼 수 있고, `popAll`의 `dst` 매개변수는 `Stack`으로부터 원소를 소비하므로 `Consumer`로 볼 수 있습니다.
왜 이렇게 사용해야 할까를 잠시 생각해보면, 생산자 입장에서는 원소와 동일하거나 하위 타입으로 생산해야 타입 예외가 발생하지 않고, 소비자 입장에서는 원소가 자신의 원소의 타입과 동일하거나 하위 타입이여야 타입 예외가 발생하지 않기 때문입니다.

`PECS` 공식을 사용하여 받아들여야 할 매개변수는 받고, 거절할 매개변수는 거절하는 작업이 알아서 이뤄지게 됩니다.

> 반환 타입에서 한정적 와일드 타입을 사용하면 클라이언트 코드에서도 와일드카드 타입을 사용해야 하기 때문에 사용하지 맙시다. 클라이언트 코드에서 와일드카드 타입을 신경써야 한다면 문제가 있을 가능성이 생깁니다.

<br><br><br>

## 복잡한 PECS 예시

<br>

```java
public static <E extends Comparable<E>> E max(List<E> list)
```

`List`에서 최대값을 반환하는 `max` 메서드입니다. 여기에 `PECS`를 적용하여 와일드카드 타입을 사용하면 아래와 같습니다.

```java
public static <E extends Comparable<? super E>> E max(List<? extends E> list)
```

- `List<? extends E> list`
  - 최대값 E 생산자 `list`
- `<E extends Comparable<? super E>>`
  - 원래 선언에서는 `E`가 `Comparable<E>`를 확장한다고 정의했는데, 이 때 `Comparable<E>`는 `E` 인스턴스를 소비하기 때문에 `Comparable<? super E>`로 대체하였습니다.
  - `Comparable`는 언제나 소비자이므로, `super`를 사용하는 것이 낫습니다.

<br>

```java
public static <E extends Comparable<? super E>> E max(List<? extends E> list)
```

를 보면 꽤 복잡하게 느껴질 수 있습니다. '이렇게까지 만들 필요가 있을까?' 라고 생각해보면 아래 예시를 보면 만들 필요가 있다고 대답할 수 있습니다.

```java
List<ScheduledFuture<?>> scheduleFutures = ...;
```

수정 전의 `max` 메서드는 상기 리스트를 처리할 수 없습니다. **그 이유는 `ScheduledFuture`는 `Comparable<ScheduledFuture>`를 구현하지 않았기 때문입니다.**

![Screenshot 2024-03-24 at 23 15 20](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/4931203d-1665-498f-97c0-d8979ca96d65)

위 관계를 보면 `ScheduledFuture` 인스턴스는 다른 `ScheduledFuture` 인스턴스 뿐만 아니라 `Delayed` 인스턴스와도 비교할 수 있게 됩니다.  수정 전 `max` 메서드는 이 리스트를 거부하게 됩니다.

<br><br><br>

## 와일드카드 타입 vs 타입 매개변수

```java
public static <E> void swap(List<E> list, int i, int j);
public static void swap(List<?> list, int i, int j);
```

어떤 선언이 더 나을까요?

`public API`라면 간단한 두 번째가 더 낫습니다. 어떤 리스트든 이 메서드에 넘기면 명시한 인덱스의 원소들을 교환해주면 되고, 신경 써야 할 타입 매개변수도 없기 때문입니다.
**메서드 선언에 타입 매개변수가 한 번만 나오면 와일드카드로 대체하여 사용하는 것이 좋습니다.** 한정적 타입 매개변수라면 한정적 와일드 카드로, 비한정적 매개변수라면 비한정적 와일드 카드로 변경해주면 됩니다.

`public static void swap(List<?> list, int i, int j);` 의 경우  `List<?>`에는 `null` 외에는 어떤 값을 넣을 수 없는데, 이러한 경우 형변환이나 로 타입을 사용하는 대신에 와일드카드 타입의 실제 타입을 알려주는 메서드 헬퍼를 사용하여 활용할 수 있습니다.

```java
public static void swap(List<?> list, int i, int j){
  swapHelper(list,i,j);
}

public static <E> void swapHelper(List<E> list, int i, int j){
  list.set(i, list.set(j, list.get(i)));
}
```

<br><br><br>

## 정리

- 제네릭을 사용하여 public API를 제공할 때는 한정적 와일드카드 타입을 사용하여 API 유연성 높힌다.
- Producer-extends, Consumer-super 공식
- 메서드 선언에 타입 매개변수가 한 번만 나오면 와일드카드로 대체하여 사용하자.
