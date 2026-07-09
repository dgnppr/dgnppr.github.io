---
layout      : concept
title       : CS231n 리뷰 — 선형 분류기에서 CNN까지, 이미지 인식의 뼈대
date        : 2026-07-09 00:00:00 +0900
updated     : 2026-07-09 00:00:00 +0900
tag         : ai deep-learning cnn cs231n computer-vision
toc         : true
comment     : true
latex       : true
status      : complete
public      : true
parent      : [[/ai]]
confidence  : high
relations:
  - { type: references, target: concept/ai/00_ilya_recommended_papers }
---

> [일리야 추천 27선](/ai/00_ilya_recommended_papers) 1번. CS231n은 논문이 아니라 스탠퍼드 강의(Fei-Fei Li·Andrej Karpathy·Justin Johnson)다. "이미지를 어떻게 분류하나"라는 질문 하나를 **선형 분류기 → 손실 → 최적화 → 신경망 → backprop → CNN**으로 끝까지 밀고 가는 자료라서 목록 맨 앞에 있다. 이 문서는 그 흐름을 시스템/데이터 하는 사람 머릿속 개념에 붙여 정리한다.

이 하나만 잡으면 뒤에 나올 26편의 공통 문법(파라미터를 손실로 평가하고 gradient로 깎는다)이 전부 읽힌다. **앞부분(1~10)은 흐름을 잡는 입문, 뒷부분(11~14)은 네 배경(연산·비용·시스템)이 직접 보상받는 심화다.**

---

## 1. 문제: 왜 고양이를 `if`로 못 짜나

이미지 분류는 "이 사진이 고양이냐 개냐"를 맞추는 것이다. 문제는 **명시적 규칙으로 짤 수 없다**는 점이다. 고양이를 "삼각형 귀 두 개 + 수염"으로 정의해봤자 조명·각도·품종·가림에 다 깨진다. 픽셀 값(숫자 배열)과 "고양이"라는 의미 사이의 간극을 **semantic gap**이라 부른다.

그래서 방향을 튼다. 규칙을 사람이 쓰는 대신, **라벨 달린 데이터를 잔뜩 주고 규칙을 학습시킨다**(data-driven approach). 너에게 익숙한 프레임으로: 하드코딩된 비즈니스 로직 대신 학습 파이프라인을 태우는 것이다. 그래서 처음부터 데이터를 `train / validation / test`로 쪼갠다 — 이건 네가 이미 아는 그 split 맞다.

이미지 하나는 그냥 숫자 텐서다. CIFAR-10 기준 한 장이 $32\times32\times3 = 3072$개 숫자(가로·세로·RGB 채널). 모델 입장에서 입력은 3072차원 벡터일 뿐이다.

## 2. 가장 단순한 모델: 선형 분류기 (score function)

제일 단순한 모델부터 간다. 입력 벡터 $x$(3072차원)에 가중치 행렬 $W$를 곱해 클래스별 점수를 낸다:

$$s = Wx + b$$

CIFAR-10은 10개 클래스니까 $W$는 $10 \times 3072$ 행렬, $b$는 10차원. 결과 $s$는 10개 점수 — "고양이 점수 3.2, 개 점수 5.1..." 식이다. 가장 높은 점수의 클래스로 찍는다.

직관: $W$의 각 행은 그 클래스의 **템플릿**이다. "고양이 행"과 이미지 벡터의 내적이 크면 고양이일 확률이 높다. 이건 네가 아는 행렬-벡터 곱, 그 이상도 이하도 아니다. 문제는 이게 너무 단순해서(선형이라) 한 클래스에 템플릿 하나밖에 못 갖는다 — 앉은 고양이와 누운 고양이를 동시에 잘 잡지 못한다. 이 한계가 뒤에서 신경망을 부른다.

## 3. 얼마나 틀렸나: 손실 함수 (loss)

$W$가 좋은지 나쁜지 **숫자 하나로 측정**해야 개선할 수 있다. 그 숫자가 손실(loss)이다. 낮을수록 좋다. 두 가지가 표준이다:

- **Multiclass SVM (hinge) loss**: 정답 점수가 오답 점수보다 최소 margin만큼 높으면 손실 0, 아니면 부족한 만큼 벌점. $L_i = \sum_{j \neq y_i} \max(0,\ s_j - s_{y_i} + 1)$
- **Softmax (cross-entropy) loss**: 점수를 확률로 바꾼 뒤 정답 확률에 $-\log$. $L_i = -\log\frac{e^{s_{y_i}}}{\sum_j e^{s_j}}$

지금 이 공식을 외울 필요는 없다. 핵심 한 줄만: **loss는 "현재 파라미터가 데이터에 대해 얼마나 나쁜가"를 스칼라로 압축한 목적 함수**다. 최적화가 깎아야 할 대상. 여기에 파라미터가 너무 커지지 않게 하는 **regularization** 항($\lambda \|W\|^2$)을 더한다 — 과적합 방지용 penalty이자, "설명이 단순한 모델을 선호한다"는 [6번(MDL·압축)](/ai/00_ilya_recommended_papers) 계열과 곧장 이어지는 지점이다.

## 4. 어떻게 개선하나: 경사하강법 (optimization)

loss를 $W$로 낮추는 게 목표다. loss를 파라미터에 대해 미분한 **gradient**($\nabla_W L$)는 "loss가 가장 가파르게 커지는 방향"이다. 그 반대로 한 걸음 가면 loss가 준다:

$$W \leftarrow W - \eta \nabla_W L$$

$\eta$는 learning rate(보폭). 이게 경사하강법(gradient descent) 전부다. 시스템 하는 사람 직관으로는 **파라미터 공간에서 손실 지형을 따라 내려가는 반복 최적화** — hill climbing의 하강 버전이다.

현실에선 데이터가 수백만 장이라 매 스텝에 전부 쓰지 않고, **mini-batch**(예: 256장)만 뽑아 gradient를 근사한다. 이게 **SGD(Stochastic Gradient Descent)**. 배치는 정확도-비용 트레이드오프 노브다. 정확한 gradient는 비싸니 표본으로 친다 — 네가 큰 테이블에서 정확한 집계 대신 샘플링으로 근사하는 것과 같은 감각이다.

## 5. 신경망: 선형을 쌓고 사이에 비선형을 끼운다

선형 분류기의 한계를 어떻게 넘나. 그냥 층을 쌓으면 될 것 같지만 — $W_2(W_1 x)$는 결국 하나의 행렬 $W_3 x$로 접힌다. **선형을 아무리 쌓아도 선형**이다.

그래서 층 사이에 **비선형 activation**을 끼운다. 대표가 ReLU: $\max(0, x)$. 음수는 0으로, 양수는 그대로. 이 단순한 꺾임 하나가 모델에 표현력을 준다:

$$s = W_2 \cdot \max(0,\ W_1 x)$$

이제 클래스마다 여러 개의 중간 특징을 조합할 수 있다(고양이의 여러 자세를 각기 다른 hidden unit이 담당). 층을 깊게 쌓을수록 표현력이 커지고, 그게 "deep" learning이다.

## 6. Backpropagation: DAG를 거꾸로 타는 미분

깊어지면 gradient를 손으로 못 구한다. 여기가 시스템 하는 사람이 제일 편하게 받아들일 부분이다.

계산을 **computational graph**(연산 노드들의 DAG)로 본다. 입력 → 곱 → 덧셈 → ReLU → loss까지 데이터가 forward로 흐른다. gradient는 이 DAG를 **역방향(reverse topological order)으로 한 번 훑으며** chain rule로 곱해 나간다. 각 노드는 자기 **local gradient**만 알면 되고, 뒤에서 온 gradient에 그걸 곱해 앞으로 넘긴다. 이게 **reverse-mode automatic differentiation**, 통칭 backprop이다.

핵심은: 이건 마법이 아니라 **DAG 위의 chain rule + 캐싱**이다. forward에서 중간값을 저장해두고 backward에서 재사용하는, 딱 dynamic programming 구조. 네가 dependency graph를 위상정렬해 역방향으로 값을 전파해본 적 있다면 이미 아는 패턴이다. PyTorch/TensorFlow의 autograd가 하는 일이 정확히 이거고, 손으로 미분을 안 짜도 되는 이유다.

## 7. 왜 CNN인가: fully-connected의 파라미터 폭발

이제 이미지로 돌아온다. 위 신경망을 이미지에 그대로 쓰면(fully-connected, 모든 픽셀을 모든 뉴런에 연결) 두 가지가 터진다:

1. **파라미터 폭발**: $200\times200\times3 = 120{,}000$차원 입력을 뉴런 1000개에 완전 연결하면 첫 층만 $1.2$억 개 가중치다. 메모리·연산·과적합 전부 감당 불가.
2. **공간 구조 무시**: 픽셀을 1D로 flatten하는 순간 "옆 픽셀끼리 관련 있다"는 정보가 사라진다. 이미지의 국소성(locality)을 버리는 셈.

**Convolution**이 둘 다 푼다. 핵심 아이디어 세 개:

- **Local connectivity**: 뉴런이 이미지 전체가 아니라 작은 창(예: $5\times5$)만 본다. 신호처리의 커널/스텐실이 이미지를 훑는 그림 그대로다.
- **Parameter sharing (weight sharing)**: **같은 필터를 모든 위치에 재사용**한다. $5\times5\times3$ 필터 하나 = 가중치 75개 + bias 1개. 이 75개를 이미지 전역에 슬라이딩하며 쓴다. 120,000개 대신 75개 — 이건 네가 아는 **파라미터 공유를 통한 압축**이다. 한 번 배운 "엣지 검출기"를 이미지 아무 데서나 재사용하는 것.
- **Translation invariance**: 왼쪽 위 고양이든 오른쪽 아래 고양이든 같은 필터가 잡는다. 위치가 바뀌어도 특징이 옮겨갈 뿐.

필터 여러 개를 쓰면 각각 다른 특징(수직 엣지, 색 대비, 질감...)을 뽑아 여러 장의 **feature map**을 만든다.

## 8. CNN의 구성 블록

CNN은 몇 가지 층을 레고처럼 쌓는다:

- **Conv layer**: 필터를 슬라이딩해 feature map 생성 (특징 추출)
- **ReLU**: 비선형 (5번과 동일)
- **Pooling** (보통 max pooling): 공간 해상도를 줄여 다운샘플링. $2\times2$ 영역에서 최댓값만 남긴다 → 계산량↓, 작은 위치 변화에 둔감해짐
- **Fully-connected**: 마지막에 뽑힌 특징들을 모아 최종 클래스 점수로

깊이가 만드는 **feature hierarchy**가 CNN의 핵심 통찰이다: 앞쪽 층은 엣지·색 같은 저수준 특징을, 뒤쪽 층은 그것들을 조합해 눈·바퀴 같은 고수준 개념을 잡는다. 사람이 특징을 설계(hand-crafted feature)하지 않고 **데이터에서 특징 계층을 스스로 학습**한다는 것 — 이게 딥러닝이 고전 컴퓨터 비전을 갈아치운 이유다. [2번 AlexNet](/ai/00_ilya_recommended_papers)이 2012년 ImageNet(약 120만 장, 1000 클래스)에서 이걸 실증하며 판을 뒤집었다.

## 9. 학습 실무: 여기가 진짜 어렵다

모델 구조보다 **학습을 굴러가게 만드는 것**이 실전의 대부분이다. CS231n 후반부가 여기에 집중한다. 데이터 하는 사람에겐 데이터 품질·검증 감각이 그대로 이어진다:

- **Overfitting vs generalization**: train은 잘 맞는데 test에서 무너지는 것. validation set으로 감시한다 (네가 아는 그 개념).
- **Regularization**: weight decay($L_2$), **dropout**(학습 중 뉴런을 랜덤하게 꺼서 특정 경로 의존 방지), **data augmentation**(뒤집기·크롭으로 데이터 뻥튀기)
- **Batch Normalization**: 층 입력 분포를 정규화해 학습을 안정·가속
- **Hyperparameter 튜닝**: learning rate가 가장 중요. 너무 크면 발산, 너무 작으면 안 내려감. weight 초기화, batch size도 노브.

한 줄 요약: 모델을 만드는 것보다 **과적합을 막고 최적화를 안정시키는 게 실전 난이도의 대부분**이다.

## 10. 정리 — 왜 이게 출발점인가

CS231n의 자산은 CNN 지식 자체보다 **모든 딥러닝에 공통인 사고 틀**이다:

1. 모델은 파라미터를 가진 함수다 (score function)
2. 손실은 그 파라미터가 얼마나 나쁜지의 스칼라다 (loss)
3. gradient로 손실을 깎는다 (optimization)
4. gradient는 computational graph를 거꾸로 타서 자동으로 구한다 (backprop)
5. 구조에 도메인 가정을 넣으면(이미지엔 convolution) 파라미터가 줄고 성능이 는다 (inductive bias)

**한계도 분명하다.** CS231n은 CNN·컴퓨터 비전 중심이고 Transformer([12번](/ai/00_ilya_recommended_papers)) 이전 시대 자료다. 최신 아키텍처(ViT, LLM)는 직접 안 다룬다. 하지만 위 1~5번 문법은 Transformer에도, LLM에도 **글자 그대로 똑같이** 적용된다. Attention은 3번의 loss·4번의 optimization·6번의 backprop 위에 얹힌 새로운 5번(inductive bias)일 뿐이다. 그래서 이걸 먼저 잡으라는 것이다.

---

# 심화 — 여기부터는 연산·비용·시스템의 언어로

앞의 10개 섹션이 "무엇을/왜"라면, 아래 4개는 "정확히 어떻게, 얼마의 비용으로"다. 데이터 레이아웃·연산량·수치 안정성처럼 네가 이미 잘 다루는 축으로 CNN을 다시 본다.

## 11. Convolution의 실제 연산: 크기 공식, cost model, im2col → GEMM

**출력 크기 공식.** 입력 한 변 $W$, 필터 $F$, padding $P$, stride $S$일 때 출력 한 변은

$$\left\lfloor \frac{W - F + 2P}{S} \right\rfloor + 1$$

이 값이 정수로 안 떨어지면 그 조합은 못 쓴다(구현이 에러 내거나 잘라먹음). `same` 패딩은 출력=입력이 되도록 $P$를 맞춘 것($S=1$이면 $P=(F-1)/2$), `valid`는 $P=0$.

**파라미터 수와 FLOPs — conv layer의 cost model.** 입력 채널 $C_{in}$, 필터 개수(=출력 채널) $C_{out}$, 커널 $F\times F$일 때:

- 파라미터 수 $= (F \cdot F \cdot C_{in} + 1)\cdot C_{out}$ — **공간 크기와 무관**하다(weight sharing 덕분). 이게 FC와의 결정적 차이.
- 연산량(MAC) $= H_{out}\cdot W_{out}\cdot C_{out} \cdot (F\cdot F\cdot C_{in})$ — 출력 원소 하나당 $F^2 C_{in}$번 곱셈-누산.

예: 입력 $32\times32\times3$, 필터 $5\times5$, $C_{out}=10$, $S=1$, `same`($P=2$) → 출력 $32\times32\times10$.
- 파라미터 $=(5\cdot5\cdot3+1)\cdot10 = 760$개.
- 연산 $=32\cdot32\cdot10\cdot(5\cdot5\cdot3) = 10{,}240\cdot75 \approx 0.77\text{M MAC}$.

여기서 감을 하나 챙겨라: conv는 **파라미터는 적은데(760) 연산은 많다(0.77M)**. 즉 compute-bound다. FC는 반대로 파라미터가 폭발한다(memory/대역폭-bound). 모델의 어디를 최적화할지는 이 두 축을 따로 봐야 한다 — DB에서 CPU-bound 쿼리와 IO-bound 쿼리를 구분해 튜닝하는 것과 똑같은 사고다.

**im2col: convolution을 GEMM으로 lowering.** GPU가 세상에서 제일 잘하는 건 큰 matrix multiply(GEMM)다. 그래서 conv를 곧이곧대로 슬라이딩 루프로 돌리지 않고, **matmul로 바꿔서** cuDNN/BLAS의 최적화된 GEMM 커널에 태운다:

1. 각 출력 위치가 보는 $F\times F\times C_{in}$ 패치를 **한 행(또는 열)로 펼친다** → 출력 위치가 $H_{out}W_{out}$개면 $(H_{out}W_{out}) \times (F^2 C_{in})$ 행렬이 나온다. 이 펼치는 연산이 **im2col**.
2. 필터 $C_{out}$개를 $(F^2 C_{in}) \times C_{out}$ 행렬로 놓는다.
3. 둘을 곱하면(GEMM) $(H_{out}W_{out}) \times C_{out}$ → reshape하면 출력 feature map.

위 예로: im2col 행렬은 $1024 \times 75$, 필터 행렬 $75 \times 10$, 곱하면 $1024\times10$. **트레이드오프는 메모리다.** 원본 입력은 $32\cdot32\cdot3=3072$ 값인데 im2col 행렬은 $1024\cdot75=76{,}800$ 값 — 겹치는 패치를 중복 저장해 약 25배로 부푼다. "연산을 GEMM 한 방으로 단순화하는 대가로 메모리를 쓴다"는 전형적 space-time 트레이드오프. 이 중복이 싫으면 **Winograd**(작은 필터에서 곱셈 수를 줄임)나 **FFT 기반 conv**(큰 필터에서 유리) 같은 대안 알고리즘을 쓴다. cuDNN이 입력 크기 보고 이 중에서 자동 선택한다.

## 12. Backprop이 실제로 계산하는 것: softmax+CE의 gradient가 왜 $p - y$인가

6번에서 backprop을 "DAG 역순 chain rule"이라고 했다. 그게 구체적으로 뭘 뱉는지 가장 흔한 케이스(softmax + cross-entropy)로 손으로 따라가 보면, 결과가 놀랄 만큼 깔끔하다.

softmax $p_k = \dfrac{e^{s_k}}{\sum_j e^{s_j}}$, 손실 $L = -\log p_y$ (정답 클래스 $y$). 점수 $s_k$에 대한 gradient를 구하면:

$$\frac{\partial L}{\partial s_k} = p_k - \mathbb{1}[k = y] \quad\Rightarrow\quad \nabla_s L = p - y$$

즉 **예측 확률분포 $p$ 에서 정답 원핫 $y$ 를 뺀 것**. gradient가 곧 "예측 − 정답", 순수한 **error signal(residual)**이다. 제어 시스템의 error feedback, 또는 예측값과 실측값의 잔차를 되먹이는 것과 정확히 같은 모양이다.

이게 왜 실무적으로 중요하냐:
- backprop의 **첫 스텝**이 이 $p-y$이고, 여기서 나온 신호가 앞 층들로 chain rule을 타고 흘러간다. 출발점이 이렇게 단순해서 전체가 안정적으로 흐른다.
- 그래서 프레임워크는 softmax와 cross-entropy를 **따로 두지 않고 하나로 fuse**한다(`CrossEntropyLoss`가 내부에서 logits를 받는 이유). $\log$와 $\exp$를 분리하면 $e^{s}$에서 overflow가 나지만, 합쳐서 **log-sum-exp trick**($\log\sum e^{s_j} = m + \log\sum e^{s_j - m}$, $m=\max s$)으로 계산하면 수치적으로 안전하다. 수치 안정성을 위해 연산을 재배치하는 것 — 부동소수점 다뤄본 사람이면 익숙한 그 감각이다.

## 13. 깊이의 벽: vanishing gradient와 그걸 뚫은 것들

"층을 깊게 쌓을수록 좋다"고 5·8번에서 말했지만, 실제로 2015년 전까지 아주 깊은 망은 **학습이 안 됐다**. 이유는 backprop의 구조 자체에 있다.

chain rule은 층별 Jacobian의 **연쇄 곱**이다. 각 층의 gradient 크기가 평균적으로 1보다 작으면, $L$개 층을 거치며 $(<1)^L$로 **지수적으로 소멸**한다(vanishing gradient) — 앞쪽 층은 신호를 거의 못 받아 학습이 정체된다. 1보다 크면 반대로 폭발(exploding). sigmoid/tanh는 양 끝에서 기울기가 0에 붙는(saturating) 구간이 있어 이 문제가 특히 심했고, **ReLU**가 표준이 된 실질적 이유가 여기 있다(양수 구간 gradient가 정확히 1이라 소멸이 덜하다).

이 벽을 뚫은 세 가지, 그리고 그게 다음 논문으로 이어지는 지점:

- **가중치 초기화 (Xavier / He)**: 층을 통과해도 activation과 gradient의 분산이 유지되도록 초기 스케일을 맞춘다. ReLU엔 He init($\text{Var}(W)=2/n_{in}$). "초기 조건을 잘못 주면 시스템이 발산한다"는, 네게 익숙한 이야기.
- **Batch Normalization (9번)**: 각 층 입력을 정규화해 loss 지형을 매끄럽게 만들고 더 큰 learning rate를 허용한다.
- **Residual connection**: 층을 $y = F(x) + x$로 바꿔, gradient가 identity shortcut을 통해 **우회해서 그대로 흘러가게** 한다. 곱의 연쇄에 덧셈 경로를 뚫어 소멸을 막는 것. 이게 [3번 ResNet](/ai/00_ilya_recommended_papers)이 100층 이상을 학습 가능하게 만든 핵심이고, [4번 Identity Mappings](/ai/00_ilya_recommended_papers)는 "왜 하필 identity shortcut이 최적인가"를 더 파고든 후속이다. 즉 리스트의 1→3→4번은 **"깊이의 벽과 그 돌파"라는 한 줄기 이야기**다.

## 14. 최적화의 실제: SGD의 실패 모드와 receptive field

4번의 vanilla SGD는 교과서적 출발점이고, 실무에선 그 한계를 메운 변형을 쓴다.

- **SGD의 실패 모드**: loss 지형이 방향마다 곡률이 크게 다르면(ill-conditioned) 좁은 골짜기를 지그재그로 튕기며 느리게 내려간다. 또 고차원에선 최솟값보다 **saddle point**(어떤 방향은 오르막, 어떤 방향은 내리막)가 훨씬 많아 gradient가 0 근처에서 정체된다.
- **Momentum**: 과거 gradient를 속도로 누적해 관성을 준다. $v \leftarrow \mu v - \eta\nabla$, $W \leftarrow W + v$. 일관된 방향은 가속되고 튐은 상쇄된다 — noisy 신호에 저역통과 필터를 건 것.
- **Adam**: 파라미터마다 gradient의 1차·2차 moment를 추정해 **개별 learning rate를 자동 조절**한다. 튜닝 부담이 적어 실무 기본값으로 자주 쓴다(대신 일반화가 SGD+momentum보다 살짝 나쁠 때도 있어 최종 성능 짤 땐 비교한다).
- **Learning rate schedule**: 초반 warmup(작게 시작해 키움) 후 cosine decay로 줄이는 패턴이 흔하다. LR이 단일 최중요 hyperparameter인 이유는, 이게 안정성(발산)과 속도(정체) 사이의 직접적인 노브라서다.

마지막으로 CNN 설계 감각 하나 — **receptive field**. 깊은 층의 뉴런 하나가 원본 입력에서 실제로 "보는" 영역의 크기다. 큰 영역을 보려고 큰 필터($7\times7$)를 한 번 쓰는 대신, **작은 필터($3\times3$)를 여러 겹 쌓으면** 같은 receptive field를 더 적은 파라미터로 + 비선형을 더 많이 끼워서 얻는다. $3\times3$ 두 겹 = $5\times5$ 한 겹의 receptive field(채널쌍당 파라미터 $2\times9=18$ vs $25$), 세 겹 = $7\times7$. 이게 VGG 이후 "작은 필터를 깊게"가 표준이 된 이유이자, 스케일링([18번](/ai/00_ilya_recommended_papers))에서 깊이·너비를 어떻게 늘릴지의 출발 감각이다.

---

**심화 요약**: convolution은 weight sharing으로 파라미터를 죽이는 대신 연산이 많은 compute-bound 연산이고(11), 실제 실행은 im2col로 GEMM에 태워 메모리를 대가로 속도를 얻으며(11), backprop이 뱉는 gradient는 결국 "예측 − 정답"이라는 error signal이고(12), 깊이의 벽(vanishing gradient)은 init·BN·residual로 뚫렸으며(13) — 이 residual 이야기가 곧 리스트의 3·4번이다. 최적화는 SGD를 momentum·Adam·LR schedule로 보강하고, 구조 설계는 receptive field로 파라미터 효율을 잡는다(14).

다음 감 잡을 순서: 이미지의 convolution 대신 **시간/순서**를 다루는 [순차 모델(RNN/LSTM)](/ai/00_ilya_recommended_papers)로 넘어가면, 같은 뼈대(loss·gradient·backprop) 위에서 "기억"이라는 새 문제가 어떻게 붙는지, 그리고 vanishing gradient가 시간 축에서 왜 더 고약해지는지 보인다.
