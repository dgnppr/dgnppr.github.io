---
layout      : concept
title       : 일리야 서츠케버 추천 AI 핵심 논문 27선
date        : 2026-07-09 00:00:00 +0900
updated     : 2026-07-09 00:00:00 +0900
tag         : ai deep-learning reading-list transformer
toc         : true
comment     : true
latex       : true
status      : complete
public      : true
parent      : [[/ai]]
confidence  : high
---

일리야 서츠케버(Ilya Sutskever)가 존 카맥(John Carmack)에게 추천했다고 알려진 AI 핵심 논문 목록. 원래 30편, 현재 정리된 건 27편. 아래 순서는 **컴퓨터 비전 → 순차 모델 → 어텐션/트랜스포머 → 메모리·관계 → 스케일링 → 정보이론·복잡성 → 생성·보편지능**으로 이어지는 현대 AI 발전 흐름 그대로다. 위에서부터 하나씩 읽으면 된다.

> **한 줄 지도**: CNN은 공간을 읽고, RNN/LSTM은 시간을 기억하고, attention은 필요한 정보를 찾고, Transformer는 그걸 병렬화하고, GNN/Relation/Memory는 객체의 관계를 계산하고, scaling/infra는 그걸 크게 훈련하고, MDL/Kolmogorov/complexity는 왜 학습이 결국 압축과 일반화의 문제인지 알려준다.

출처: [30papers.com](https://30papers.com/) · [GeekNews](https://news.hada.io/topic?id=31224) · [Hacker News](https://news.ycombinator.com/item?id=48819608)

---

## 1. 컴퓨터 비전 · 합성곱 신경망

- [CS231n: Convolutional Neural Networks for Visual Recognition](https://cs231n.github.io/) — 선형 분류기부터 심층 이미지 인식까지, CNN 입문 강의 노트
- [ImageNet Classification with Deep CNNs (AlexNet)](https://papers.nips.cc/paper/2012/hash/c399862d3b9d6b76c8436e924a68c45b-Abstract.html) — ImageNet 대회를 압도하며 현대 딥러닝 시대를 연 논문
- [Deep Residual Learning for Image Recognition (ResNet)](https://arxiv.org/abs/1512.03385) — 잔차 연결로 수백 층 심층망 학습을 가능케 함
- [Identity Mappings in Deep Residual Networks](https://arxiv.org/abs/1603.05027) — 항등 shortcut이 왜 통하는지 분석, pre-activation block 제안
- [Multi-Scale Context Aggregation by Dilated Convolutions](https://arxiv.org/abs/1511.07122) — 해상도 손실 없이 수용 영역을 넓히는 dilated convolution

## 2. 순차 모델 · 장기 의존성

- [The Unreasonable Effectiveness of Recurrent Neural Networks](https://karpathy.github.io/2015/05/21/rnn-effectiveness/) — 문자 단위 RNN 텍스트 생성으로 순차 모델링의 가능성을 보인 글
- [Understanding LSTM Networks](https://colah.github.io/posts/2015-08-Understanding-LSTMs/) — LSTM 게이트 구조와 정보 흐름을 그림으로 설명한 입문 자료
- [Recurrent Neural Network Regularization](https://arxiv.org/abs/1409.2329) — non-recurrent connection에만 dropout을 적용하는 정규화
- [Order Matters: Sequence to Sequence for Sets](https://arxiv.org/abs/1511.06391) — 순서 없는 집합 데이터를 seq2seq로 다룰 때 순서가 미치는 영향

## 3. 어텐션 · 트랜스포머

- [Neural Machine Translation by Jointly Learning to Align and Translate](https://arxiv.org/abs/1409.0473) — 고정 벡터 대신 원문 단어를 직접 참조하는 어텐션 도입
- [Pointer Networks](https://arxiv.org/abs/1506.03134) — 출력이 입력 위치를 가리키는 구조, 조합 최적화에 적합
- [Attention Is All You Need](https://arxiv.org/abs/1706.03762) — recurrence를 없애고 self-attention만으로 처리하는 Transformer
- [The Annotated Transformer](https://nlp.seas.harvard.edu/annotated-transformer/) — Transformer 논문을 실행 가능한 코드로 줄 단위 해설

## 4. 메모리 · 관계 추론 · 그래프

- [Neural Turing Machines](https://arxiv.org/abs/1410.5401) — 미분 가능한 attention으로 외부 메모리를 읽고 쓰는 모델
- [A Simple Neural Network Module for Relational Reasoning](https://arxiv.org/abs/1706.01427) — 객체 쌍 관계를 추론하는 relation network 모듈
- [Relational Recurrent Neural Networks](https://arxiv.org/abs/1806.01822) — self-attention 기반 메모리로 시간에 따른 관계 추론
- [Neural Message Passing for Quantum Chemistry](https://arxiv.org/abs/1704.01212) — GNN을 message passing으로 통합, 분자 성질 예측

## 5. 대규모 학습 · 스케일링 법칙

- [Scaling Laws for Neural Language Models](https://arxiv.org/abs/2001.08361) — loss가 모델·데이터·연산량에 대해 power law로 감소함을 측정
- [GPipe: Efficient Training of Giant Neural Networks using Pipeline Parallelism](https://arxiv.org/abs/1811.06965) — pipeline parallelism으로 거대 모델을 여러 장치에 분산 학습
- [Deep Speech 2: End-to-End Speech Recognition in English and Mandarin](https://arxiv.org/abs/1512.02595) — CTC 기반 end-to-end 음성 인식, 다국어 확장

## 6. 정보이론 · 압축 · 복잡성

- [Keeping Neural Networks Simple by Minimizing the Description Length of the Weights](https://www.cs.toronto.edu/~hinton/absps/colt93.pdf) — 일반화를 가중치의 설명 길이(비트 수)와 연결한 초기 연구
- [A Tutorial Introduction to the Minimum Description Length Principle](https://arxiv.org/abs/math/0406077) — 학습을 데이터를 가장 짧게 설명하는 모델 탐색으로 해석
- Kolmogorov Complexity — 문자열을 만드는 최단 프로그램의 길이, description length의 형식적 기반 *(정본 URL 불확실, 링크 생략)*
- [The First Law of Complexodynamics](https://scottaaronson.blog/?p=762) — 닫힌 시스템에서 복잡성이 증가 후 감소하는 이유 탐구
- [Quantifying the Rise and Fall of Complexity in Closed Systems: The Coffee Automaton](https://arxiv.org/abs/1405.6903) — 커피·크림 혼합을 셀룰러 오토마타로 모델링한 복잡성 정량화

## 7. 생성 모델 · 보편적 지능

- [Variational Lossy Autoencoder](https://arxiv.org/abs/1611.02731) — VAE + autoregressive decoder, latent가 보존할 정보를 제어
- [Machine Super Intelligence](http://www.vetta.org/documents/Machine_Super_Intelligence.pdf) — 기계 지능의 보편적 측정을 제안한 Shane Legg 박사 논문
