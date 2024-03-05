// 스크롤을 감지하여 버튼 표시 함수
function scrollFunction() {
    // 현재 스크롤 위치를 가져옵니다.
    var scrollTop = document.documentElement.scrollTop || document.body.scrollTop;

    // 전체 문서의 높이를 가져옵니다.
    var scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight;

    // 뷰포트의 높이를 가져옵니다.
    var clientHeight = document.documentElement.clientHeight || window.innerHeight;

    // 스크롤 위치를 퍼센트로 계산합니다.
    var scrolledPercentage = (scrollTop / (scrollHeight - clientHeight)) * 100;

    // 특정 퍼센트 이상 스크롤되었는지 확인합니다. (예: 70%)
    if (scrolledPercentage > 80) {
        document.getElementById("topBtn").style.display = "block";
    } else {
        document.getElementById("topBtn").style.display = "none";
    }
}

// 스크롤 이벤트 리스너를 추가합니다.
window.addEventListener('scroll', scrollFunction);

// 사용자를 페이지 상단으로 스크롤하는 함수
function topFunction() {
    // 부드러운 스크롤을 위해 다음 옵션을 사용합니다.
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 페이지 로드 시 버튼의 초기 상태를 결정합니다.
document.addEventListener('DOMContentLoaded', scrollFunction);
