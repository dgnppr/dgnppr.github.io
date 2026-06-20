(function () {
    function sendGiscusTheme(isDark) {
        var frame = document.querySelector('iframe.giscus-frame');
        if (!frame) return;
        frame.contentWindow.postMessage(
            { giscus: { setConfig: { theme: isDark ? 'dark' : 'light' } } },
            'https://giscus.app'
        );
    }

    function applyTheme(isDark) {
        document.documentElement.classList.toggle('dark-mode', isDark);
        sendGiscusTheme(isDark);
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
            var isDark = !document.documentElement.classList.contains('dark-mode');
            applyTheme(isDark);
            localStorage.setItem('theme', isDark ? 'dark-mode' : '');
        });
    }

    init();
})();
