(function() {
    function applyTheme(theme) {
        const body = document.body;
        const themeToggle = document.getElementById('theme-toggle');
        const lightIcon = themeToggle ? themeToggle.querySelector('.light-icon') : null;
        const darkIcon = themeToggle ? themeToggle.querySelector('.dark-icon') : null;

        body.classList.toggle('dark-mode', theme === 'dark-mode');
        if (lightIcon && darkIcon) {
            lightIcon.style.display = theme === 'dark-mode' ? 'none' : 'block';
            darkIcon.style.display = theme === 'dark-mode' ? 'block' : 'none';
        }
        toggleSlider(theme);
    }

    function initializeTheme() {
        const storedTheme = localStorage.getItem('theme');
        // 사용자가 명시적으로 선택한 테마가 없으면 시스템 설정 확인
        if (storedTheme === null) {
            const prefersDarkScheme = window.matchMedia('(prefers-color-scheme: dark)');
            applyTheme(prefersDarkScheme.matches ? 'dark-mode' : '');
        } else {
            // 저장된 사용자 선택 적용
            applyTheme(storedTheme);
        }
    }

    function toggleSlider(theme) {
        const sliderCircle = document.querySelector('.theme-toggle .slider-circle');
        // 'dark-mode'일 때 슬라이더의 위치를 변경
        if (theme === 'dark-mode') {
            sliderCircle.style.left = '22px'; // 슬라이더의 오른쪽 끝으로 이동
        } else {
            sliderCircle.style.left = '2px'; // 원래 위치로 이동
        }
    }


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
            // 사용자의 선택을 저장
            localStorage.setItem('theme', newTheme);
        });
    }

    initializeTheme();
    setupThemeToggleButton();
})();
