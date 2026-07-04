/* /all 문서 목록 클라이언트 페이지네이션 — 10개 단위.
 * 목록은 이미 전부 렌더되어 있고, JS로 한 페이지분만 표시한다.
 * 현재 페이지는 URL 해시(#page=N)에 저장 → 뒤로가기/공유 지원. */
(function () {
    var PER_PAGE = 10;

    function init() {
        var list  = document.querySelector('.home-feed');
        var pager = document.getElementById('all-pager');
        if (!list || !pager) return;

        var items = Array.prototype.slice.call(list.querySelectorAll('.home-feed-item'));
        var total = items.length;
        var pages = Math.max(1, Math.ceil(total / PER_PAGE));

        function clamp(p) { return Math.min(Math.max(1, p), pages); }

        function readPage() {
            var m = (location.hash || '').match(/page=(\d+)/);
            return clamp(m ? parseInt(m[1], 10) : 1);
        }

        function show(page) {
            var start = (page - 1) * PER_PAGE, end = start + PER_PAGE;
            items.forEach(function (it, i) {
                it.style.display = (i >= start && i < end) ? '' : 'none';
            });
            renderPager(page);
        }

        function go(page, scroll) {
            page = clamp(page);
            history.replaceState(null, '', '#page=' + page);
            show(page);
            if (scroll) {
                var y = list.getBoundingClientRect().top + window.pageYOffset - 80;
                window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
            }
        }

        function makeBtn(label, page, opts) {
            opts = opts || {};
            var inert = opts.current || opts.disabled;
            var el = document.createElement(inert ? 'span' : 'button');
            el.className = 'pager__btn' +
                (opts.nav ? ' pager__btn--nav' : '') +
                (opts.current ? ' is-current' : '') +
                (opts.disabled ? ' is-disabled' : '');
            el.textContent = label;
            if (!inert) {
                if (opts.type) el.type = 'button';
                el.addEventListener('click', function () { go(page, true); });
                el.setAttribute('aria-label', opts.aria || (label + ' 페이지'));
            }
            if (opts.current) el.setAttribute('aria-current', 'page');
            return el;
        }

        /* 5개씩 묶음(1~5, 6~10 …) + 처음/마지막 버튼 */
        var BLOCK = 5;
        function renderPager(cur) {
            pager.innerHTML = '';
            if (pages <= 1) { pager.style.display = 'none'; return; }
            pager.style.display = '';

            var blockStart = Math.floor((cur - 1) / BLOCK) * BLOCK + 1;
            var blockEnd = Math.min(blockStart + BLOCK - 1, pages);

            var prevBlock = blockStart - BLOCK;
            var nextBlock = blockStart + BLOCK;
            pager.appendChild(makeBtn('«', Math.max(1, prevBlock), { nav: true, disabled: blockStart === 1, aria: '이전 묶음' }));
            pager.appendChild(makeBtn('‹', cur - 1, { nav: true, disabled: cur === 1, aria: '이전 페이지' }));
            for (var p = blockStart; p <= blockEnd; p++) {
                pager.appendChild(makeBtn(String(p), p, { current: p === cur }));
            }
            pager.appendChild(makeBtn('›', cur + 1, { nav: true, disabled: cur === pages, aria: '다음 페이지' }));
            pager.appendChild(makeBtn('»', nextBlock, { nav: true, disabled: nextBlock > pages, aria: '다음 묶음' }));
        }

        window.addEventListener('hashchange', function () { show(readPage()); });
        show(readPage());
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
