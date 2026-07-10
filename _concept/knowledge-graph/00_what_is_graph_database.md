---
layout      : concept
title       : 그래프 데이터베이스는 조인이 아니라 탐색이다
date        : 2026-07-10 00:00:00 +0900
updated     : 2026-07-10 00:00:00 +0900
tag         : graph-database rdf data-engineering
toc         : true
comment     : true
latex       : true
status      : draft
public      : true
parent      : [[/knowledge-graph]]
confidence  : medium
relations:
  - { type: references, target: concept/data-architect/07_ontology_core_concepts }
---

* TOC
{:toc}

> 관계형 DB에서 "친구의 친구의 친구"를 묻는 순간 조인이 폭발한다. 그래프 데이터베이스는 이 문제를 저장 구조 자체로 푼다.

## 문제 정의 — 조인은 관계를 다시 계산한다

소셜 서비스에서 이런 질문을 받았다고 하자. **"내가 팔로우하는 사람들이 팔로우하지만, 나는 아직 안 따르는 계정 상위 10명."** 추천 피드의 핵심 로직이다.

관계형 스키마는 보통 이렇게 생겼다.

```sql
CREATE TABLE users  (id BIGINT PRIMARY KEY, name TEXT);
CREATE TABLE follows(follower_id BIGINT, followee_id BIGINT,
                     PRIMARY KEY (follower_id, followee_id));
```

2-hop 질의는 `follows`를 자기 자신과 조인한다.

```sql
SELECT f2.followee_id, COUNT(*) AS mutuals
FROM   follows f1
JOIN   follows f2 ON f1.followee_id = f2.follower_id
WHERE  f1.follower_id = :me
  AND  f2.followee_id <> :me
  AND  NOT EXISTS (SELECT 1 FROM follows f3
                   WHERE f3.follower_id = :me AND f3.followee_id = f2.followee_id)
GROUP  BY f2.followee_id
ORDER  BY mutuals DESC
LIMIT  10;
```

여기까지는 인덱스가 버텨준다. 문제는 **hop이 늘어날 때**다. "친구의 친구의 친구"(3-hop)는 조인이 하나 더 붙고, 각 조인은 대략 평균 차수(degree)만큼 행을 곱한다. 평균 팔로우 200명이면 3-hop 후보는 이론상 200³ = 8백만 경로. 관계형 옵티마이저는 매 hop마다 **인덱스를 다시 뒤져 관계를 재계산**한다. 관계는 테이블에 저장돼 있지만, "누가 누구와 연결됐는가"는 질의 시점에 매번 조립된다.

핵심은 이것이다. 관계형 모델에서 관계는 **값의 일치**(외래키 = 기본키)로 표현되고, 그 일치를 확인하려면 매번 조회가 필요하다. hop이 깊어질수록 이 비용은 데이터 전체 크기에 끌려 올라간다.

---

## 핵심 아이디어 — index-free adjacency

그래프 데이터베이스의 성능은 하나의 설계 결정에서 나온다. **index-free adjacency**(인덱스 없는 인접성).

노드를 저장할 때, 그 노드가 연결된 이웃 노드들의 **물리적 포인터를 노드 레코드 안에 직접 들고 있다.** 관계를 조회로 찾는 게 아니라, 이미 손에 쥐고 있는 참조를 따라가기만 한다.

결과적으로 탐색 한 걸음의 비용이 **전체 데이터 크기와 무관**해진다. 노드가 1만 개든 100억 개든, "이 노드의 이웃"으로 가는 비용은 그 노드의 차수에만 비례한다 — O(전체) 가 아니라 O(로컬 차수). 관계형에서 hop마다 붙던 조인 비용이 그래프에서는 포인터 역참조로 바뀐다.

트레이드오프도 여기서 나온다.

- **읽기(탐색)**: 깊은 연결 질의에서 압도적으로 빠르다. hop 수가 성능을 지배하지, 데이터 크기가 아니다.
- **쓰기**: 엣지를 만들 때 양쪽 노드의 인접 리스트를 갱신해야 한다. 관계형의 단순 INSERT보다 손이 더 간다.
- **집계 스캔**: "전체 사용자의 평균 나이" 같은 전량 스캔·집계는 그래프의 강점이 아니다. 이건 컬럼나(columnar) 웨어하우스의 영역이다.

그래프 DB는 **깊게 연결된 데이터를 탐색**하는 워크로드에 특화된 도구지, 관계형의 상위호환이 아니다.

---

## 두 가지 모델 — Property Graph vs RDF

"그래프 데이터베이스"는 사실 서로 다른 두 계보를 뭉뚱그린 말이다.

### Labeled Property Graph (LPG)

노드와 엣지 둘 다 **레이블과 속성(key-value)** 을 가진다.

```
(:User {name:'유현', joined:2019})-[:FOLLOWS {since:2021}]->(:User {name:'미소'})
```

엣지 자체가 `since:2021` 같은 속성을 품을 수 있다는 게 특징이다. 엔진: **Neo4j, Memgraph, TigerGraph, Amazon Neptune, JanusGraph**. 질의어: **Cypher**(Neo4j·openCypher), **Gremlin**(Apache TinkerPop), 그리고 2024년 표준화된 **GQL**.

### RDF Triplestore

모든 사실을 **(주어, 술어, 목적어) 삼항(triple)** 으로 쪼갠다.

```
<유현> <follows> <미소> .
<유현> <joinedYear> "2019" .
```

노드·술어를 전역 식별자 **IRI**로 표기해 서로 다른 데이터셋을 이어붙일 수 있고(Linked Data), **OWL** 스키마로 추론(inference)을 돌릴 수 있다. 엔진: **Apache Jena, GraphDB, Stardog, Blazegraph, Virtuoso**. 질의어: **SPARQL**.

> RDF·IRI·OWL·property의 개념적 경계는 [[/data-architect/07_ontology_core_concepts]] 에서 Wikidata(`Q42`, `P31`) 사례로 정리했다. 이 글은 그 개념들이 **저장·질의 엔진**으로 어떻게 구현되는지를 다룬다.

### 비교

| | Property Graph (LPG) | RDF Triplestore |
|--|---------------------|-----------------|
| 최소 단위 | 노드·엣지(+속성) | triple (S, P, O) |
| 엣지 속성 | 일급 지원 | reification 필요 (번거로움) |
| 식별자 | 로컬 (엔진 내부 id) | 전역 IRI |
| 표준 질의어 | Cypher / Gremlin / GQL(2024) | SPARQL (W3C) |
| 추론 | 없음 — 명시 탐색 | OWL/RDFS 추론 지원 |
| 강점 | 개발자 친화·엣지 모델링 | 표준·연결·상호운용 |
| 대표 용도 | 추천·사기탐지·앱 백엔드 | 지식 통합·시맨틱 웹·공공 데이터 |

실무 감각으로는, **한 조직 안에서 앱을 빠르게 만들 거면 LPG, 여러 출처를 표준으로 잇고 추론이 필요하면 RDF**다. 대부분의 애플리케이션 그래프는 LPG로 간다.

---

## 질의어 맛보기 — 같은 질문, 세 언어

앞의 "친구의 친구 중 내가 안 따르는 사람"을 각 언어로.

**Cypher** — 패턴을 ASCII 아트처럼 그린다.

```cypher
MATCH (me:User {name:'유현'})-[:FOLLOWS]->()-[:FOLLOWS]->(fof:User)
WHERE NOT (me)-[:FOLLOWS]->(fof) AND fof <> me
RETURN fof.name, count(*) AS mutuals
ORDER BY mutuals DESC LIMIT 10;
```

`(me)-[:FOLLOWS]->()-[:FOLLOWS]->(fof)` 이 한 줄이 관계형의 self-join 두 번을 대체한다. 관계가 값 일치가 아니라 **경로 패턴**으로 표현된다는 게 핵심이다.

**SPARQL** — triple 패턴 매칭.

```sparql
SELECT ?fof (COUNT(*) AS ?mutuals) WHERE {
  :유현 :follows ?mid . ?mid :follows ?fof .
  FILTER NOT EXISTS { :유현 :follows ?fof }
  FILTER (?fof != :유현)
} GROUP BY ?fof ORDER BY DESC(?mutuals) LIMIT 10
```

**GQL** — 2024년 4월 ISO/IEC 39075로 제정됐다. SQL 이후 40년 만에 나온 새 ISO 데이터베이스 질의 표준이며, 문법은 Cypher와 거의 같다. 벤더별로 갈라졌던 property graph 질의어가 표준으로 수렴하는 신호다.

가변 깊이 탐색(`*1..3` 같은 표기로 1~3 hop)이 한 줄로 표현되는 것도 그래프 질의어의 공통 강점이다. 관계형에서는 재귀 CTE로만 흉내 낼 수 있고, 그마저 깊어지면 급격히 느려진다.

---

## 언제 쓰고, 언제 쓰지 말 것인가

그래프 DB를 도입할 이유:

- **다단계 관계 탐색이 질의의 본질**일 때 — 추천, 사기 탐지 링(ring), 네트워크 영향 분석, 계보(lineage), 권한 그래프.
- **스키마가 자주 바뀌고 관계 종류가 늘어날** 때 — 새 관계 타입을 엣지로 추가하면 되지, 조인 테이블을 새로 안 만든다.
- **경로 자체가 답**일 때 — "A와 B는 몇 다리 건너 연결되는가", "이 거래에서 자금은 어떤 경로로 흘렀는가".

쓰지 말아야 할 신호:

- 워크로드가 **대량 집계·스캔** 중심 — 컬럼나 웨어하우스(BigQuery, Snowflake)가 맞다.
- 관계가 **얕고 고정적**(대부분 1-hop 조인) — 관계형으로 충분하다. 그래프는 운영 복잡도만 늘린다.
- **supernode 문제** — 수백만 엣지가 몰린 초고차수 노드(예: 팔로워 천만 셀럽)를 지나는 탐색은 그래프에서도 느리다. index-free adjacency의 이점이 차수에 비례하는 비용에 잡아먹힌다. 파티셔닝·분산도 이 지점에서 어려워진다.

그래프 DB는 "연결이 곧 도메인의 본질"인 곳에서 빛나고, 그렇지 않은 곳에서는 관계형·컬럼나보다 나을 게 없다. 도구의 문제가 아니라 **데이터의 모양**에 대한 판단이다.

---

## 이 블로그 자체가 작은 그래프 DB다

추상적으로 들린다면 지금 읽고 있는 이 블로그가 예시다. 모든 글은 frontmatter에 `relations:` 를 선언한다 — 이 글도 위에서 `07_ontology_core_concepts` 를 `references` 로 가리켰다. 빌드 시 `make ontology` 가 이 선언들을 모아 `data/ontology-graph.json`(노드+엣지)으로 굽고, MCP 서버가 그 위를 탐색한다.

`ontology_related`, `neighborhood` 같은 탐색은 정확히 **엣지를 포인터처럼 따라가는** index-free adjacency의 축소판이다. 글이 늘어나도 "이 글의 이웃"을 찾는 비용은 전체 글 수가 아니라 그 글이 선언한 관계 수에만 비례한다. 지식 그래프를 그래프 DB 위에 올린다는 게 무슨 뜻인지는 [[/knowledge-graph/01_what_is_knowledge_graph]] 에서 이어간다.
