document.addEventListener("DOMContentLoaded", function () {
  // 프로그래스 바 엘리먼트
  const progressBar = document.getElementById("myBar");

  // window 객체가 스크롤될 경우
  // window 스크롤 이벤트 감지 및 콜백 셋팅
  window.addEventListener("scroll", function () {
    // window의 스크롤 진행도 계산
    const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
    const scrolled = (window.scrollY / scrollHeight) * 100;

    // 계산된 스크롤 진행도를 CSS로 표현
    progressBar.style.width = scrolled + "%";
  });
});
