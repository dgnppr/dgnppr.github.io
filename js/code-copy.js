(function () {
    function init() {
        document.querySelectorAll('div.highlight').forEach(function (block) {
            var btn = document.createElement('button');
            btn.className = 'code-copy-btn';
            btn.setAttribute('aria-label', '코드 복사');
            btn.innerHTML = '<i class="far fa-copy"></i>';
            block.appendChild(btn);

            btn.addEventListener('click', function () {
                var code = block.querySelector('pre code') || block.querySelector('pre');
                if (!code) return;
                var text = code.innerText;

                function showCopied() {
                    btn.innerHTML = '<i class="fas fa-check"></i>';
                    btn.classList.add('copied');
                    setTimeout(function () {
                        btn.innerHTML = '<i class="far fa-copy"></i>';
                        btn.classList.remove('copied');
                    }, 1500);
                }

                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(showCopied).catch(function () {});
                } else {
                    var ta = document.createElement('textarea');
                    ta.value = text;
                    ta.style.cssText = 'position:fixed;opacity:0';
                    document.body.appendChild(ta);
                    ta.select();
                    try { document.execCommand('copy'); showCopied(); } catch (e) {}
                    document.body.removeChild(ta);
                }
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
