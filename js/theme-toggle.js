(function () {
    function applyTheme(isDark) {
        document.body.classList.toggle('dark-mode', isDark);
    }

    function init() {
        var stored = localStorage.getItem('theme');
        var isDark = stored !== null
            ? stored === 'dark-mode'
            : window.matchMedia('(prefers-color-scheme: dark)').matches;
        applyTheme(isDark);
    }

    var btn = document.getElementById('theme-toggle');
    if (btn) {
        btn.addEventListener('click', function () {
            var isDark = !document.body.classList.contains('dark-mode');
            applyTheme(isDark);
            localStorage.setItem('theme', isDark ? 'dark-mode' : '');
        });
    }

    init();
})();
