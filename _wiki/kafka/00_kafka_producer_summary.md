---
layout  : wiki
title   : Kafka Producer Client 요약
summary :
date    : 2024-07-06 00:00:00 +0900
updated : 2024-07-06 00:00:00 +0900
tag     : kafka
toc     : true
comment : true
public  : true
parent  : [[/kafka]]
latex   : true
---
* TOC
{:toc}

# 글 시작에 앞서

현재 개발/운영하고 있는 프로젝트는 Event Driven Architecture 되어있다. 이벤트 스트리밍 플랫폼은 카프카를 사용하고 있다.
해당 프로젝트는 다양한 제휴사로 API를 호출하고 있는데, 비동기 병렬 처리(여러 카프카 컨슈머 서버)로 낮은 레이턴시를 보장하고 있다.
최근 외부 API에서 에러가 발생하여 카프카 에러를 경험하였다. 해당 에러는 처음 보았고, 이와 관련하여 카프카에 대해서 조금 더 알아보기 위해 레퍼런스를 보았다. 
해당 내용을 정리하고자 글을 작성하게 되었다. 

<br><br>

# 카프카 프로토콜

카프카는 TCP 위에서 동작하는 [자체 바이너리 프로토콜](https://kafka.apache.org/protocol.html#protocol_details) 사용한다. 이 바이너리 프로토콜을 적절히 구현한 프로듀서, 컨슈머를 클라이언트로 제공하며 카프카 프로듀서를 사용하여 데이터를 발행하고, 카프카 컨슈머를 사용하여 데이터를 구독한다.

<br><br>

# KafkaProducer 기본 구성 요소

![0ec97800-cd00-11ea-8f7d-e6f2df9ecc99](https://github.com/dgnppr/dgnppr/assets/89398909/f2ca1965-0527-4cd6-9285-599656ab64d6)

1. `KafkaProducer`
2. `RecordAccumulator`
3. `Sender`

사용자는 `KafkaProducer.send()`를 호출하여 `Record`를 전송한다.

사용자가 `KafkaProducer.send()`를 호출하면 `Record`가 바로 Broker로 전송되는 것이 아니라 `RecordAccumulator`로 적재된다.
`Broker`로 전송되는 것은 이후에 비동기적으로 이루어진다.

`KafkaProducer`는 별도의 `Sender Thread`를 생성한다. `Sender Thread`는 `RecordAccumulator`에 저장된 `Record`로 전송하는 역할을 한다.
그리고 `Broker`의 응답을 받아서 사용자가 `Record` 전송 시 설정한 콜백이 있으면 실행하고, `Broker`으로 부터 받은 응답 결과를 `Future`를 통해서 사용자에게 전달한다.


<br>

## 1. KafkaProducer.send()

send() 호출 시 전송할 Record와 전송 완료 후 실행할 콜백을 지정할 수 있다.
send()가 호출되면 Serialization -> Partitioning -> Compression 순으로 작업이 이루어지며 최종적으로 `RecordAccumulator`에 레코드가 적재된다.

![75d23700-ccd6-11ea-988c-d46b7046e448](https://github.com/dgnppr/dgnppr/assets/89398909/2874c052-757c-45c9-ab72-60e15d3d4dad)

`org.springframework.kafka:spring-kafka KafkaTemplate 코드 예시`
```java
ListenableFuture<SendResult<String, String>> future = kafkaTemplate.send(topic, key, jsonStr);
         
/* ListenableFuture.send.Callback */
future.addCallback(new ListenableFutureCallback<Object>() {
            
            /* 성공 */
            @Override
            public void onSuccess(Object result) {
                log.debug("Success = {}", result);
            }

            /* 실패 */
            @Override
            public void onFailure(Throwable ex) {
                log.error("Fail = {}", ex);
            }
});
```

<br>

### 1.a. Serialization

사용자로부터 전달된 Record의 Key,Value는 지정된 `Serializer`에 의해서 `Byte Array`로 변환된다.
`Serializer`는 `key.serializer, value.serializer` 설정값으로 지정하거나, `KafkaProducer` 생성 시 지정할 수 있다.

`예시 코드`
```java
 Properties props = new Properties();
 props.put("bootstrap.servers", "localhost:9092");
 props.put("acks", "all");
 props.put("key.serializer", "org.apache.kafka.common.serialization.StringSerializer");
 props.put("value.serializer", "org.apache.kafka.common.serialization.StringSerializer");

 Producer<String, String> producer = new KafkaProducer<>(props);
 for (int i = 0; i < 100; i++)
     producer.send(new ProducerRecord<String, String>("my-topic", Integer.toString(i), Integer.toString(i)));

 producer.close();
```

또는 `KafkaProducer` 생성 시에 직접 `Serializer` 객체를 생성해서 전달할 수 있다.

```java
Map<String, Object> props = Map.of(
    ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers
);

return new DefaultKafkaProducerFactory<>(props, new StringSerializer(), new StringSerializer());
```

<br>

### 1.b. Partitioning

카프카 토픽은 여러 개의 파티션으로 나뉘어 있는데, 사용자의 레코드는 지정된 Partitioner에 의해서 어떤 파티션으로 전송될지 정해진다.
**Partitioner는 기본적으로 Record를 받아서 Partition Number를 반환하는 역할을 한다.**
직접 Partitioner를 지정할 수 있으며, Partitioner를 지정하지 않으면 `org.apache.kafka.clients.producer.internals.DefaultPartitioner`가 사용된다.

Record 생성 시 파티션 지정이 가능하고, 파티션이 지정되어 있는 경우에는 파티셔너를 사용하지 않고 지정된 파티션으로 저장된다.
레코드에 지정된 파티션이 없는 경우 DefaultPartitioner는 아래와 같이 동작한다.

- Key 값이 있는 경우, Key의 hash 값을 사용해서 Partion을 할당한다.
- Key 값이 없는 경우 라운드 로빈 방식으로 파티션이 할당된다.

<br>

### 1.c. Compression

전송할 Record를 압축함으로써 네트워크 전송 비용도 줄일 수 있고 저장 비용도 줄일 수 있다.
레코드는 레코드 어뮬레이터에 저장될 때 바로 압출되어 저장된다. compression.type을 설정하여 압축 시 사용할 코덱을 지정할 수 있다.
아래 코덱을 사용할 수 있고 지정하지 않는 경우 디폴트값으로 none이 지정된다.

- gzip
- snappy
- lz4
- non

<br><br>

## 2. RecordAccumulator append()


<br>

# Reference

- https://kafka.apache.org/protocol.html
- https://d2.naver.com/helloworld/6560422

