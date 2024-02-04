---
layout  : wiki
title   : 전략 패턴을 언제, 어떻게 사용할 것인가
summary :
date    : 2024-01-31 00:00:00 +0900
updated : 2024-01-31 00:00:00 +0900
tag     : design-pattern
toc     : true
comment : true
public  : true
parent  : [[/essay]]
latex   : true
---
* TOC
{:toc}

## 전략 패턴이란

![Screenshot 2024-02-04 at 10 20 06@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/1db0e2a3-c072-404b-aa9b-8c729de38881)

- 전략 패턴에 참여하는 객체는 클라이언트, 컨텍스트, 전략이다.
- **바뀌지 않는 부분은 컨텍스트,바뀌는 부분은 전략으로 만든다.**
- 컨텍스트는 전략 인터페이스에 의존하게 하고, 런타임에 컨텍스트에 전략 구현체를 주입하여, 컨텍스트가 전략을 실행하게 한다.
- 요약하면, **컨텍스트에서 런타임에 전략을 주입받아 실행하는 것이 전략 패턴이다.**

<br>

> GoF 디자인 패턴에서의 전략 패턴 정의
> - 동일 계열의 알고리즘 군을 정의하고, 각각의 알고리즘을 캡슐화하여, 이들이 상호 교환 가능하도록 만든다.
> - 알고리즘을 사용하는 클라이언트와 독립적으로 알고리즘을 동적으로 다양하게 변경할 수 있게 한다.

<br>

코드로 살펴보면 아래와 같은 패턴이다.

```java
// 전략(변경되는 알고리즘)
interface Strategy {
    void operation();
}

interface StrategyImplA implements Strategy {
    public void operation(){};
}

interface StrategyImplB implements Strategy {
    public void operation(){};
}

// 컨텍스트(전략을 사용하는 객체)
class Context {
    private Strategy strategy;

    public void setStrategy(Strategy strategy) {
        this.strategy = strategy;
    }

    public void invoke() {
        strategy.operation();
    }
}

// 클라이언트
class Client {
    public static void main(String[] args) {
        Context context = new Context(); // 1. 컨텍스트 생성
        context.setStrategy(new StrategyImplA()); // 2. 전략 주입
        context.invoke(); // 3. 전략 실행
    }
}
```

<br><br><br>

## 언제 사용하면 좋을까?

정의에서 봤듯이, **바뀌는 부분과 바뀌지 않는 부분이 명확하게 구분될 때 전략 패턴을 사용하는 것이 좋다.** 좀 더 구체적인 상황을 살펴보면 아래와 같다.

- 알고리즘이 런타임에 교체될 필요가 있을때
- 알고리즘이 노출되어서는 안 되는 데이터에 액세스 하거나 데이터를 활용할 때 (캡슐화)

<br>

### 런타임에 알고리즘을 바꿔서 실행해야할 때

필자는 좀 더 넓은 의미에서 전략 패턴에 대해서 예시를 들고자 한다.
해당 예시는 정의에 부합하는 예시는 아니다. 

하지만, 전략 패턴을 사용하는 것이 좋은 예시라고 생각해서 가져왔다.

**집중해서 봐야할 부분은 바뀌는 부분(전략)을 런타임에 바꿔서 컨텍스트를 실행하는 것이다**

<br>

![Screenshot 2024-02-04 at 10 43 27](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/94bc173f-7ad1-486b-b7eb-51c69e4309c4)

위 사진은 블라인드(직장인 커뮤니티) 웹 메인 페이지이고, 카테고리 별로 게시글을 보여준다.

바뀌는 부분과 바뀌지 않는 부분은 아래와 같을 것이다 (구체적인 내부 API 로직은 차치하자)

- 바뀌는 부분(전략) = SQL
- 바뀌지 않는 부분(컨텍스트) = 게시글을 가져오는 로직

게시글을 저장소에서 가져오는 로직을 3-레이어 아키텍처로 간단하게 아래 그림과 같이 구성할 수 있을 것이다.

<img src="https://github.com/dgnppr/dgnppr.github.io/assets/89398909/2ffef07d-3332-4a1a-b6e3-02e05d7bf5f0" height="600">

```sql
SELECT *
FROM posts
WHERE category = #Strategy (eg. '아시안컵', '연말정산' 등등)
```

<br>

- 클라이언트 = 컨트롤러
- 컨텍스트 = 비즈니스
- 전략 = SQL

요청마다(런타임) 비즈니스 레이어(컨텍스트)에서 SQL(알고리즘)를 바꾸어서 쿼리를 날릴 것이다.

<br>

### 알고리즘을 캡슐화해야할 때

아래 예제는 결제 관련 예제이다.

```java
// 결제 전략 인터페이스
public interface PaymentStrategy {
    void processPayment(double amount);
}

// 신용카드 결제 전략
public class CreditCardStrategy implements PaymentStrategy {
    @Override
    public void processPayment(double amount) {
        // 신용카드 결제 처리 로직
    }
}

// PayPal 결제 전략
public class PayPalStrategy implements PaymentStrategy {
    @Override
    public void processPayment(double amount) {
        // PayPal 결제 처리 로직
    }
}

// 결제를 처리하는 컨텍스트 클래스
public class PaymentContext {
    private PaymentStrategy strategy;

    public void setPaymentStrategy(PaymentStrategy strategy) {
        this.strategy = strategy;
    }

    public void processPayment(double amount) {
        strategy.processPayment(amount);
    }
}

// 클라이언트
public class PaymentClient {
    public static void main(String[] args) {
        PaymentContext context = new PaymentContext();

        // 신용카드로 결제
        context.setPaymentStrategy(new CreditCardStrategy());
        context.processPayment(100.0);

        // PayPal로 결제 방식 변경
        context.setPaymentStrategy(new PayPalStrategy());
        context.processPayment(200.0);
    }
}
```

결제 모듈을 고객사에게 제공해야 한다고 가정해보자. 
위와 같이 고객사에게 결제 로직을 코드를 캡슐화하여 제공할 수 있다.

<br><br><br>

## 어떻게 사용해야할까?

전략 패턴을 사용하는 것은 간단하다.

1. 전략과 컨텍스트를 구분한다.
2. 전략 인터페이스를 만든다.
3. 전략 구현체를 만든다.
4. 클라이언트에서 런타임에 컨텍스트에 전략을 주입한다.

<br><br><br>

## 전략 패턴 사용 고민 상황

아래와 같은 고민이 들 수 있다.

- 전략 패턴 구현체(알고리즘)이 엄청나게 많다면 전략 패턴을 사용하는 것이 좋을까? 
- 알고리즘이 많지 않고 자주 변경되지 않아도 매번 새로운 구현체를 생성하는게 좋을까?

알고리즘이 많다면 시스템 복잡도를 높이고 유지보수성이 떨어질 수 있다. 
이러한 상황이라면 팩토리 패턴과 같은 다른 디자인 패턴을 결합해서 사용하는 것을 고려해보면 좋다.
객체 생성을 캡슐화하여, 생성 로직을 한 곳에서 관리하는 것이다. 이렇게 되면 새로운 전략이 추가되더라도, 생성 로직만 수정하면 된다.

```java
// 팩토리 패턴
public class PaymentFactory {
    private HashMap<String, PaymentStrategy> strategies;
    
    public PaymentFactory() {
        strategies = new HashMap<>();
        strategies.put("credit", new CreditCardStrategy());
        strategies.put("paypal", new PayPalStrategy());
    }

    public PaymentStrategy getPaymentStrategy(String type) {
        return strategies.get(type);
    }
}
```

<br>

알고리즘이 많지 않고 자주 변경되지 않는다면 전략 패턴 도입이 오히려 복잡도를 높일 수 있다.
전략 패턴 대신에 조건문을 사용하거나 싱글톤을 통해 다양한 알고리즘을 구현할 수 있다.

```java
public class PaymentProcessor {
    public void processPayment(String paymentType, double amount) {
        if (paymentType.equals("CREDIT_CARD")) {
            processCreditCardPayment(amount);
        } else if (paymentType.equals("PAYPAL")) {
            processPayPalPayment(amount);
        } else {
            throw new IllegalArgumentException("Unknown payment type");
        }
    }

    private void processCreditCardPayment(double amount) {
        // 신용카드 결제 처리 로직
        System.out.println("Processing credit card payment: " + amount);
    }

    private void processPayPalPayment(double amount) {
        // PayPal 결제 처리 로직
        System.out.println("Processing PayPal payment: " + amount);
    }
}
```

<br><br><br>

## 오픈 소스에서 사용되는 전략 패턴

### Java

`java.util.Comparator` 인터페이스는 전략 패턴을 사용한다.

![Screenshot 2024-02-04 at 12 06 51@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/72f97c33-405c-458f-9c4e-ba59f043928e)

![Screenshot 2024-02-04 at 12 07 01@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/4dc5e960-b3ed-4809-8b89-af7e73edbbfa)

<br>

```java
class Main {
    public static void main(String[] args) {
        List<String> list = new ArrayList<>();
        list.add("A");
        list.add("C");
        list.add("B");

        // 정렬 전략을 주입
        list.sort(new Comparator<String>() {
            @Override
            public int compare(String o1, String o2) {
                return o1.compareTo(o2);
            }
        });

        System.out.println(list); // [A, B, C]
    }
}
```

<br>

### Spring Security

`ProviderManager`(컨텍스트)는 `AuthenticationProvider`(전략)를 사용하여 인증을 처리한다.

![Screenshot 2024-02-04 at 11 50 09@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/8c10e2cc-4fd6-4507-ba9d-99bd0e467305)

생성자로 `providers`를 주입받고, `providers`를 순회하면서 `authenticate`를 호출한다.

![Screenshot 2024-02-04 at 11 50 26@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/274462bd-f8c4-433b-822e-f79015cc3631)

<br><br><br>

## 템플릿 메서드 패턴과의 차이

- **전략 패턴은 합성, 템플릿 메서드 패턴은 상속**을 통해 알고리즘을 변경한다.
- 전략 패턴은 인터페이스 합성을 통해 클라이언트와 객체 간의 결합도를 낮출 수 있는 반면, 템플릿 메서드 패턴에서는 부모/자식 관계이기 때문에 더 밀접하게 결합한다.
- 전략 패턴은 알고리즘 전체를 교체할 수 있지만, 템플릿 메서드 패턴은 알고리즘의 일부만을 교체할 수 있다.

**단일 상속만을 지원하는 자바에서 템플릿 메서드 패턴은 상속 제한이 있을 수 밖에 없고, 컨텍스트에서 다양한 전략이 필요로 하다면 인터페이스 합성을 통해 전략 패턴을 사용하는 것이 좋다.**

<br><br><br>

## 템플릿 콜백 패턴과의 차이

전략 패턴은 별도의 전략 클래스가 필요하지만, 템플릿 콜백 패턴은 별도의 구현체가 필요하지 않다. 전략을 사용하는 메서드에 매개변수 값으로 전략 로직을 넘겨 주기만 하면된다.

> 전략 패턴 예시

```java
// 전략
interface Strategy {
    int operation(int x, int y);
}

class ConcreteStrategyA implements Strategy {
    public void operation(int x, int y) {
       return x + y; 
    }
}

class ConcreteStrategyB implements Strategy {
    public void operation(int x, int y) {
       return x - y; 
    }
}

// 컨텍스트
class Context {
    public int executeStrategy(Strategy strategy, int x, int y) {
        return strategy.operation(x, y);
    }
}

// 클라이언트
class Client {
    public static void main(String[] args) {
        Context context = new Context();
        context.executeStrategy(new ConcreteStrategyA(), 3, 4); // 7
        context.executeStrategy(new ConcreteStrategyB(), 3, 4); // -1
    }
}
```

<br>

> 템플릿 콜백 패턴 예시

```java
// 콜백
interface Callback {
    int execute(int x, int y);
}

// 템플릿
class Template {
    public int execute(Callback callback, int x, int y) {
        return callback.execute(x, y);
    }
}

// 클라이언트
class Client {
    public static void main(String[] args) {
        Template template = new Template();
        template.execute((x, y) -> x + y, 3, 4); // 7
        template.execute((x, y) -> x - y, 3, 4); // -1
    }
}
```

<br><br><br>

## 참고

- https://product.kyobobook.co.kr/detail/S000000935358
- https://inpa.tistory.com/entry/GOF-%F0%9F%92%A0-%EC%A0%84%EB%9E%B5Strategy-%ED%8C%A8%ED%84%B4-%EC%A0%9C%EB%8C%80%EB%A1%9C-%EB%B0%B0%EC%9B%8C%EB%B3%B4%EC%9E%90
- https://inpa.tistory.com/entry/GOF-%F0%9F%92%A0-Template-Callback-%EB%B3%80%ED%98%95-%ED%8C%A8%ED%84%B4-%EC%95%8C%EC%95%84%EB%B3%B4%EA%B8%B0
- https://engineering.linecorp.com/ko/blog/templete-method-pattern