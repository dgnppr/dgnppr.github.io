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

    // 사용자의 선택 또는 시스템 설정에 따라 초기 테마를 적용하는 함수
    function initializeTheme() {
        const storedTheme = localStorage.getItem('theme');
        const prefersDarkScheme = window.matchMedia('(prefers-color-scheme: dark)');
        const defaultTheme = prefersDarkScheme.matches ? 'dark-mode' : '';

        // 사용자가 테마를 명시적으로 선택한 경우, 그 선택을 우선적으로 적용
        if (storedTheme) {
            applyTheme(storedTheme);
        } else {
            applyTheme(defaultTheme);
            // 사용자가 테마를 선택하지 않았다면, 시스템 설정을 기반으로 테마를 적용하고 저장
            localStorage.setItem('theme', defaultTheme);
        }
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

    // 초기화
    initializeTheme();
    setupThemeToggleButton();
})();
