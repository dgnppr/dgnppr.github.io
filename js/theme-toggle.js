(function() {
    // 다크모드 상태를 설정하거나 제거하는 함수
    function applyTheme(theme) {
        const body = document.body;
        const themeToggle = document.getElementById('theme-toggle');
        const lightIcon = themeToggle ? themeToggle.querySelector('.light-icon') : null;
        const darkIcon = themeToggle ? themeToggle.querySelector('.dark-icon') : null;

        if (theme === 'dark-mode' && !body.classList.contains('dark-mode')) {
            body.classList.add('dark-mode');
            if (lightIcon && darkIcon) {
                lightIcon.style.display = 'none';
                darkIcon.style.display = 'block';
            }
        } else if (theme !== 'dark-mode' && body.classList.contains('dark-mode')) {
            body.classList.remove('dark-mode');
            if (lightIcon && darkIcon) {
                lightIcon.style.display = 'block';
                darkIcon.style.display = 'none';
            }
        }
    }

    // 시스템 설정을 확인하고 초기 테마를 적용하는 함수
    function initializeTheme() {
        const prefersDarkScheme = window.matchMedia('(prefers-color-scheme: dark)');
        const currentTheme = localStorage.getItem('theme') || (prefersDarkScheme.matches ? 'dark-mode' : '');
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
            applyTheme(newTheme);
            localStorage.setItem('theme', newTheme);
        });
    }

    // 시스템 설정에 따른 초기 테마 적용
    initializeTheme();

    // `DOMContentLoaded` 이벤트가 이미 발생했는지 검사하고, 필요한 설정을 진행합니다.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupThemeToggleButton);
    } else {
        setupThemeToggleButton();
    }
})();
