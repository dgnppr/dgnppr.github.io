---
layout  : wiki
title   : Test Fixture 어떻게 생성해야 할까
summary :
date    : 2024-01-29 00:00:00 +0900
updated : 2024-01-29 00:00:00 +0900
tag     : essay test java
toc     : true
comment : true
public  : true
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
(그래서 필자는 `@Before` 즉, 테스트 실행하기 전에 데이터를 셋업하는 코드 사용을 지양한다.)

<br>

어떠한 이유로 테스트에 필요한 데이터가 너무 많거나, 테스트 픽스쳐를 생성하는데 너무 많은 시간이 소요되는 경우가 있다.
이러한 경우 때문에 테스트 픽스쳐를 별도의 클래스에 정의하고, 테스트 메서드에서는 테스트 픽스쳐를 생성하는 메서드를 호출하는 방법을 사용하기도 한다.
하지만 테스트 메서드 안에서 테스트 픽스쳐를 생성하지 않기 때문에 테스트 픽스쳐의 생성 과정을 이해하기 어렵게 만들 수 있다. 
이것으로 인해 온전히 테스트 메서드 하나로서 문서의 역할을 하지 못할 수 있다.

<br>

모든 테스트 픽스쳐를 테스트 메서드에 정의하는 것은 불필요하게 많은 코드를 작성하게 할 수 있고, 테스트 메서드 자체가 길어질 수도 있다.
따라서 적절하게 테스트 픽스쳐를 생성하는 방법에 대해서 고민하게 되었고, 이 글을 통해서 좀 더 효율적으로 테스트 픽스쳐를 만들어보고자 한다.

<br><br><br>

## 테스트 메서드 안에서 정의하기

테스트 메서드 안에서 테스트 픽스쳐를 정의하는 방법은 가장 간단하고 직관적이다. 
코드를 처음 본 사람도 금방 이해할 수 있다.

예를 들어, 은행에 송금을 하는 메서드를 테스트하는 경우를 생각해보자. 코드는 아래와 같다.
테스트를 위한 코드이고, 실제로 동작하는 코드는 아니다. (코드가 논리적으로 안맞거나 오류가 많아도 무시하기 바란다.)

```java
// 은행 계좌
public record BankAccount(
    String accountNumber, 
    String bankCode) {
}

// 은행으로 송금을 수행하는 인터페이스
public interface TransferBankUseCase {
    Result invoke(BankAccount from, BankAccount to, long amount);

    interface Result {

        record Success(long transferHistoryId) implements Result {
        }

        record Failure(Throwable throwable) implements Result {
        }
    }
}

// 은행 송금 인터페이스 구현체
public class TransferBank implements TransferBankUseCase {

    private final TransferHistoryRepository transferHistoryRepository;
    private final EmailPort emailPort;
    private final BankPort bankPort;

    public TransferBank(TransferHistoryRepository transferHistoryRepository, EmailPort emailPort, BankPort bankPort) {
        this.transferHistoryRepository = transferHistoryRepository;
        this.emailPort = emailPort;
        this.bankPort = bankPort;
    }

    @Override
    public Result invoke(BankAccount from, BankAccount to, long amount) {

        // 동일 계좌로 송금할 수 없음
        if (from.bankCode().equals(to.bankCode()) && from.accountNumber().equals(to.accountNumber())) {
            return new Failure(new RuntimeException("동일 계좌로 송금할 수 없음"));
        }

        // FROM 계좌의 잔액이 충분한지 검사
        var balanceOfFromBankAccount = bankPort.getBalance(from.bankCode(), from.accountNumber());
        if (balanceOfFromBankAccount < amount) {
            return new Failure(new RuntimeException("잔액 부족"));
        }

        // TO 계좌로 송금액만큼 입금
        var response = bankPort.deposit(to.bankCode(), to.accountNumber(), amount);
        if (response.isSuccess()) {
            TransferHistory transferHistory = transferHistoryRepository.save(
                    new TransferHistory(
                            System.currentTimeMillis(),
                            from.bankCode(),
                            from.accountNumber(),
                            to.bankCode(),
                            to.accountNumber(),
                            amount
                    )
            );

            emailPort.sendEmail("송금 완료");
            return new Result.Success(transferHistory.getId());
        }

        return new Failure(new RuntimeException("송금 실패"));
    }
}

// 테스트 코드
@ExtendWith(MockitoExtension.class)
@DisplayNameGeneration(DisplayNameGenerator.ReplaceUnderscores.class)
class TransferBankTest {

    @Mock
    BankPort bankPort;

    @Mock
    EmailPort emailPort;

    @InjectMocks
    TransferBank sut;

    @Test
    void 동일_계좌로_송금할_경우_실패한다() {
        //Arrange
        BankAccount fromAccount = new BankAccount("accountNumber1", "bankCode1");
        BankAccount toAccount = new BankAccount("accountNumber1", "bankCode1");
        long amount = 100_000L;

        //Act
        Result result = sut.invoke(fromAccount, toAccount, amount);

        //Assert
        assertThat(result).isInstanceOf(Failure.class);
        Failure failure = (Failure) result;
        assertThat(failure.throwable()).isInstanceOf(RuntimeException.class)
                .hasMessage("동일 계좌로 송금할 수 없음");
    }
}
```

테스트에 필요한 픽스쳐는 은행 계좌 두 개와 송금액이다. 
이와 같이 픽스쳐가 간단한 경우에는 테스트 메서드 안에 픽스쳐를 작성하는 것이 테스트 전반적인 컨택스트를 이해하기 쉽게 해준다.

은행 계좌에 들어있는 필드가 현재는 2개이다. 하지만, 실제로는 은행 계좌에는 아래와 같이 더 많은 필드가 있을 것이다.

```java
// 은행 계좌
public record BankAccount(
    String accountNumber,
    String bankCode,
    String accountHolderName,
    BigDecimal balance,
    String currency,
    String accountType,
    String branchCode,
    String country,
    LocalDateTime createdAt
) {
}
```

```java
@Test
    void 동일_계좌로_송금할_경우_실패한다() {
        //Arrange
        BankAccount fromAccount = new BankAccount(
                "1234567890",
                "ABC123",
                "홍길동",
                BigDecimal.valueOf(100000.00),
                "KRW",
                "저축 계좌",
                "001",
                "대한민국",
                LocalDateTime.now()
        );

        BankAccount toAccount = new BankAccount(
                "1234567890",
                "ABC123",
                "홍길동",
                BigDecimal.valueOf(100000.00),
                "KRW",
                "저축 계좌",
                "001",
                "대한민국",
                LocalDateTime.now()
        );

        long amount = 100_000L;

        //Act
        Result result = sut.invoke(fromAccount, toAccount, amount);

        //Assert
        assertThat(result).isInstanceOf(Failure.class);
        Failure failure = (Failure) result;
        assertThat(failure.throwable()).isInstanceOf(RuntimeException.class)
                .hasMessage("동일 계좌로 송금할 수 없음");
    }
```

해당 테스트 메서드는 비교적 간단해서 stub 같은 것도 없고, 빌더로 만들지도 않고, 테스트 픽스쳐 개수도 적어서 필드 추가를 해도 길지는 않다.

하지만 만약에 테스트에 필요한 계좌 개수가 4개라면 혹은 그 이상이라면 코드가 엄청 길어질 것이다. 그리고 은행 계좌는 다른 테스트에서도 반복적으로 사용될 것이고 테스트 메서드마다 계좌를 생성하는 코드가 중복될 것이다.

테스트 픽스쳐 생성을 테스트 메서드에서 추출해보자.

<br><br><br>

## 테스트 메서드 외부로 추출하기

### Private 팩토리 메서드 사용하기

```java
@Test
    void 동일_계좌로_송금할_경우_실패한다() {
        //Arrange
        BankAccount fromAccount = createBankAccount("1234567890", "ABC123");
        BankAccount toAccount = createBankAccount("1234567890", "ABC123");
        long amount = 100_000L;

        //Act
        Result result = sut.invoke(fromAccount, toAccount, amount);

        //Assert
        assertThat(result).isInstanceOf(Failure.class);
        Failure failure = (Failure) result;
        assertThat(failure.throwable()).isInstanceOf(RuntimeException.class)
                .hasMessage("동일 계좌로 송금할 수 없음");
    }

    private BankAccount createBankAccount(String accountNumber, String bankCode) {
        return new BankAccount(accountNumber,
                bankCode,
                null,
                null,
                null,
                null,
                null,
                null,
                null);
    }
```

**테스트의 의도를 알 수 있도록 테스트에 사용되는 값만 설정하고, 테스트에 필요하지 않은 값들은 기본값들로 구성했다.**
테스트 컨텍스트에 알맞음과 동시에 주입해줘야 하는 값들을 기본값으로 넣어줌으로써, 테스트 메서드의 의도를 명확하게 드러내는 것을 볼 수 있다.

<br>

### 팩토리 클래스 사용하기

은행 계좌같은 경우는 시스템 이곳 저곳 테스트에서 반복적으로 사용될 것이다.
은행 계좌가 필요한 모든 테스트 클래스마다 내부 팩토리 메서드를 생성하는 것은 중복 코드를 만들 것이다.

아예 별도의 팩토리 클래스로 빼서 사용하는 것도 좋은 방법이다.

```java
// 테스트 픽스쳐 팩토리 클래스
public final class BankAccountFactory {
    public static BankAccount createBankAccount(String accountNumber, String bankCode) {
        return new BankAccount(accountNumber,
                bankCode,
                null,
                null,
                null,
                null,
                null,
                null,
                null);
    }
}


// 테스트 클래스
@ExtendWith(MockitoExtension.class)
@DisplayNameGeneration(DisplayNameGenerator.ReplaceUnderscores.class)
class TransferBankTest {

    @Mock
    BankPort bankPort;

    @Mock
    EmailPort emailPort;

    @InjectMocks
    TransferBank sut;

    @Test
    void 동일_계좌로_송금할_경우_실패한다() {
        //Arrange
        BankAccount fromAccount = BankAccountFactory.createBankAccount("1234567890", "ABC123");
        BankAccount toAccount = BankAccountFactory.createBankAccount("1234567890", "ABC123");
        long amount = 100_000L;

        //Act
        Result result = sut.invoke(fromAccount, toAccount, amount);

        //Assert
        assertThat(result).isInstanceOf(Failure.class);
        Failure failure = (Failure) result;
        assertThat(failure.throwable()).isInstanceOf(RuntimeException.class)
                .hasMessage("동일 계좌로 송금할 수 없음");
    }
}
```

테스트 클래스에서 외부 클래스로 의존성이 생기기는 시스템 전반에 걸쳐서 중복 코드를 줄여줄 것이다.

하지만 이 방법도 문제가 있다. 픽스쳐에 필요한 파라미터가 많고, 팩토리 클래스에 테스트 픽스쳐를 생성하는 메서드가 많아지면, 팩토리 클래스가 너무 커질 수 있다.

**테스트 픽스쳐를 생성할 때 빌더 패턴으로 생성하고, 팩토리 클래스에서 생성하는 픽스쳐에 필요한 파라미터 개수를 제한하는 것이 좋을 것 같다.**

### Enum Fixture 생성하기

테스트 픽스쳐를 생성하는 방법 중에 Enum을 사용하는 방법도 있다. 정말로 자주 사용되는 좀 더 정확하게 변경되지 않는 테스트 픽스쳐가 종종 필요한 상황이 생긴다.
~~개발자란 누구인가! 게으른 것을 좋아하는 사람이다! 좀 더 게을러질 수 있도록 만들어보자!~~

예를 들어, 반복적으로 '1234'라는 은행코드와 '1234567890' 계좌번호인 은행 계좌가 필요한 경우가 있다고 가정해보자.

```java
public enum BankAccountTexture {

    INSTANCE("1234567890", "123");

    private final String accountNumber;
    private final String bankCode;

    BankAccountTexture(String accountNumber, String bankCode) {
        this.accountNumber = accountNumber;
        this.bankCode = bankCode;
    }

    public BankAccount createBankAccount() {
        return new BankAccount(accountNumber,
                bankCode,
                null,
                null,
                null,
                null,
                null,
                null,
                null);
    }
}

@Test
    void 동일_계좌로_송금할_경우_실패한다() {
        //Arrange
        BankAccount fromAccount = BankAccountFixture.INSTANCE.createBankAccount();
        BankAccount toAccount = BankAccountFixture.INSTANCE.createBankAccount();
        long amount = 100_000L;

        //Act
        Result result = sut.invoke(fromAccount, toAccount, amount);

        //Assert
        assertThat(result).isInstanceOf(Failure.class);
        Failure failure = (Failure) result;
        assertThat(failure.throwable()).isInstanceOf(RuntimeException.class)
                .hasMessage("동일 계좌로 송금할 수 없음");
    }
```

상기 코드 같이 테스트 픽스쳐를 Enum으로 만들어서 사용하면, 테스트 픽스쳐의 파라미터를 정하는 코드가 테스트 메서드에서 완전히 사라지게 된다.

<br>

### Factory 클래스와 Enum Fixture 함께 사용하기

Enum과 Factory 클래스를 함께 사용하면 좀 더 깔끔하게 만들 수 있다.

```java
public enum BankAccountFixture {

    INSTANCE("1234567890", "123");

    private final String accountNumber;
    private final String bankCode;

    BankAccountFixture(String accountNumber, String bankCode) {
        this.accountNumber = accountNumber;
        this.bankCode = bankCode;
    }

    public BankAccount createBankAccount() {
        return BankAccountFactory.createBankAccount(accountNumber, bankCode);
    }
}
```

개인적으로 필자는 이 방법을 선호한다.

<br><br><br>

## 라이브러리 사용하기

### [Fixture Monkey](https://naver.github.io/fixture-monkey/)

```kotlin
implementation("com.navercorp.fixturemonkey:fixture-monkey:1.0.13")
```

```java
@ExtendWith(MockitoExtension.class)
@DisplayNameGeneration(DisplayNameGenerator.ReplaceUnderscores.class)
class TransferBankTest {

    FixtureMonkey fm = FixtureMonkey.builder()
            .objectIntrospector(ConstructorPropertiesArbitraryIntrospector.INSTANCE)
            .build();

    @Mock
    BankPort bankPort;

    @Mock
    EmailPort emailPort;

    @InjectMocks
    TransferBank sut;

    @Test
    void 동일_계좌로_송금할_경우_실패한다() {
        //Arrange
        BankAccount fromAccount = fm.giveMeBuilder(BankAccount.class)
                .set(javaGetter(BankAccount::accountNumber), "1234567890")
                .set(javaGetter(BankAccount::bankCode), "1234")
                .sample();

        BankAccount toAccount = fm.giveMeBuilder(BankAccount.class)
                .set(javaGetter(BankAccount::accountNumber), "1234567890")
                .set(javaGetter(BankAccount::bankCode), "1234")
                .sample();

        long amount = 100_000L;

        //Act
        Result result = sut.invoke(fromAccount, toAccount, amount);

        //Assert
        assertThat(result).isInstanceOf(Failure.class);
        Failure failure = (Failure) result;
        assertThat(failure.throwable()).isInstanceOf(RuntimeException.class)
                .hasMessage("동일 계좌로 송금할 수 없음");
    }

}
```

공식 문서를 보고 사용해보니, 테스트 픽스쳐를 생성하는데 매우 편리한 것 같다.
네이버에서 만든 라이브러리로, [deview 영상](https://deview.kr/2021/sessions/417)을 봤는데, 아주 훌륭하다..
~~나도 이런 라이브러리 얼른 만들고싶다.~~

<br>

### [Instancio](https://github.com/instancio/instancio)

```kotlin
testImplementation("org.instancio:instancio-junit:4.1.0")
```

```java
BankAccount fromAccount = Instancio.create(BankAccount.class);
BankAccount toAccount = Instancio.create(BankAccount.class);
```

![Screenshot 2024-02-02 at 14 49 49@2x](https://github.com/dgnppr/dgnppr.github.io/assets/89398909/514b9f1f-ca77-4dd2-bfc1-28051f83a92c)

이런식으로 텍스트 픽스쳐를 생성할 수 있는데, 픽스쳐에 있는 필드들이 모두 랜덤하게 생성된다.

이런식으로 랜덤하게 생성된 픽스쳐를 사용하면, 테스트 데이터를 생성하는데 시간이 많이 소요되는 경우에 유용할 것이다.

```java
@Test
    void 동일_계좌로_송금할_경우_실패한다() {
        //Arrange
        BankAccount fromAccount = Instancio.of(BankAccount.class)
                .generate(field(BankAccount::accountNumber), gen -> gen.oneOf("1234567890"))
                .generate(field(BankAccount::bankCode), gen -> gen.oneOf("1234"))
                .create();

        BankAccount toAccount = Instancio.of(BankAccount.class)
                .generate(field(BankAccount::accountNumber), gen -> gen.oneOf("1234567890"))
                .generate(field(BankAccount::bankCode), gen -> gen.oneOf("1234"))
                .create();
        
        long amount = 100_000L;

        //Act
        Result result = sut.invoke(fromAccount, toAccount, amount);

        //Assert
        assertThat(result).isInstanceOf(Failure.class);
    }
```

이런식으로 커스텀하게 지정할 수도 있다.

```java
Model<Person> simpsons = Instancio.of(Person.class)
    .set(field(Person::getLastName), "Simpson")
    .set(field(Address::getCity), "Springfield")
    .generate(field(Person::getAge), gen -> gen.ints().range(40, 50))
    .toModel();

Person homer = Instancio.of(simpsons)
    .set(field(Person::getFirstName), "Homer")
    .create();

Person marge = Instancio.of(simpsons)
    .set(field(Person::getFirstName), "Marge")
    .create();
```

템플릿을 따로 만들어서 사용할 수도 있는데, 재사용성에 있어서 매우 좋은 것 같다. 

<br><br><br>

## 필자의 생각

왠만하면 의존성 없이 테스트 메서드 안에 테스트 픽스쳐를 정의하는 것이 좋다고 생각한다.
그것이 어렵다면 테스트 픽스쳐 생성 로직을 내부 메서드 -> 외부 메서드 순으로 리팩토링하고,
그것마저도 관리가 어려워진다면 FixtureMonkey와 같은 라이브러리를 사용하는 것이 좋을 것 같다.

<br><br><br>

## 참고

- https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/ctx-management.html
- https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/ctx-management/caching.html
- https://www.baeldung.com/java-faker
- https://deview.kr/2021/sessions/417
- https://jojoldu.tistory.com/611
- https://toss.tech/article/how-to-manage-test-dependency-in-gradle