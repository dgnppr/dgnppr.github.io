document.addEventListener("DOMContentLoaded", function () {
  const progressBar = document.getElementById("myBar");
  let isScrolling;

  function updateProgressBar() {
    // document.documentElement.scrollHeight 대신 document.body.scrollHeight 사용
    const scrollHeight = document.body.scrollHeight - window.innerHeight;
    const scrolled = (window.scrollY / scrollHeight) * 100;
    progressBar.style.width = scrolled + "%";
  }

  window.addEventListener("scroll", function () {
    window.cancelAnimationFrame(isScrolling);
    isScrolling = window.requestAnimationFrame(updateProgressBar);
  }, { passive: true });
});
