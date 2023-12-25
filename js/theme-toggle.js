// 이 파일은 문서 로드가 완료되면 실행됩니다.

// 다크모드 상태를 설정하거나 제거하는 함수
function applyTheme(theme) {
    const body = document.body;
    const themeToggle = document.getElementById('theme-toggle');
    const lightIcon = themeToggle.querySelector('.light-icon');
    const darkIcon = themeToggle.querySelector('.dark-icon');

    // 페이지에 이미 적용된 테마를 중복 적용하지 않습니다.
    if (theme === 'dark-mode' && !body.classList.contains('dark-mode')) {
        body.classList.add('dark-mode');
        lightIcon.style.display = 'none';
        darkIcon.style.display = 'block';
    } else if (theme !== 'dark-mode' && body.classList.contains('dark-mode')) {
        body.classList.remove('dark-mode');
        lightIcon.style.display = 'block';
        darkIcon.style.display = 'none';
    }
}

// 로컬 스토리지에서 테마를 로드하고 적용하는 함수
function loadTheme() {
    const currentTheme = localStorage.getItem('theme') || '';
    applyTheme(currentTheme);
}

// 토글 버튼 클릭 이벤트 리스너를 추가하는 함수
function setupThemeToggleButton() {
    const themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle) {
        console.error('The theme-toggle button was not found.');
        return;
    }

    themeToggle.addEventListener('click', () => {
        const isDarkMode = document.body.classList.contains('dark-mode');
        const newTheme = isDarkMode ? '' : 'dark-mode';

        // 테마 적용
        applyTheme(newTheme);
        // 새 테마를 로컬 스토리지에 저장
        localStorage.setItem('theme', newTheme);
    });
}

// 문서 로딩 완료 시 함수 호출
document.addEventListener('DOMContentLoaded', (event) => {
    loadTheme();
    setupThemeToggleButton();
});
