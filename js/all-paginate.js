/* All Documents 목록 — 클라이언트 검색·정렬·페이지당 개수·페이지네이션.
 * 목록은 서버에서 전부 렌더됨. JS로 필터→정렬→한 페이지분만 표시.
 * 페이지는 URL 해시(#page=N)에 저장 → 뒤로가기/공유 지원. */
(function () {
    var PER_PAGE = 5;

    function init() {
        var list   = document.querySelector('.home-feed');
        var pager  = document.getElementById('all-pager');
        if (!list || !pager) return;

        var search      = document.getElementById('feed-search');
        var searchWrap  = document.getElementById('feed-search-wrap');
        var searchBtn   = document.getElementById('feed-search-toggle');
        var sortWrap    = document.getElementById('feed-sort-wrap');
        var sortBtn     = document.getElementById('feed-sort-toggle');
        var sortMenu    = document.getElementById('feed-sort-menu');
        var perWrap     = document.getElementById('feed-perpage-wrap');
        var perBtn      = document.getElementById('feed-perpage-toggle');
        var perMenu     = document.getElementById('feed-perpage-menu');
        var perLabel    = document.getElementById('feed-perpage-label');
        var countEl     = document.getElementById('feed-count');
        var emptyEl     = document.getElementById('feed-empty');
        var curSort     = 'date-desc';

        var all = Array.prototype.slice.call(list.querySelectorAll('.home-feed-item'));
        var view = all.slice();          // 현재 필터+정렬된 목록
        var pages = 1;

        function clamp(p) { return Math.min(Math.max(1, p), pages); }

        function readPage() {
            var m = (location.hash || '').match(/page=(\d+)/);
            return clamp(m ? parseInt(m[1], 10) : 1);
        }

        function matches(it, q) {
            if (!q) return true;
            var t = it.getAttribute('data-title') || '';
            var g = it.getAttribute('data-tags') || '';
            return (t + ' ' + g).indexOf(q) !== -1;
        }

        var SORTS = {
            'date-desc':  function (a, b) { return cmp(b, a, 'data-date'); },
            'date-asc':   function (a, b) { return cmp(a, b, 'data-date'); },
            'title-asc':  function (a, b) { return cmp(a, b, 'data-title'); },
            'title-desc': function (a, b) { return cmp(b, a, 'data-title'); }
        };
        function cmp(a, b, attr) {
            var x = a.getAttribute(attr) || '', y = b.getAttribute(attr) || '';
            return x.localeCompare(y);
        }

        /* 검색+정렬 재계산 후 DOM 재배치. 페이지는 호출자가 지정. */
        function rebuild(page, scroll) {
            var q = (search && search.value || '').trim().toLowerCase();
            var sortFn = SORTS[curSort] || SORTS['date-desc'];

            view = all.filter(function (it) { return matches(it, q); });
            view.sort(sortFn);

            /* 정렬 순서대로 DOM 재배치 (필터 아웃 항목은 뒤로) */
            view.forEach(function (it) { list.appendChild(it); });
            all.forEach(function (it) {
                if (view.indexOf(it) === -1) list.appendChild(it);
            });

            pages = Math.max(1, Math.ceil(view.length / PER_PAGE));
            if (countEl) countEl.textContent = view.length + '개 문서';
            if (emptyEl) emptyEl.hidden = view.length !== 0;
            go(page, scroll);
        }

        function show(page) {
            page = clamp(page);
            all.forEach(function (it) { it.style.display = 'none'; });
            var start = (page - 1) * PER_PAGE, end = start + PER_PAGE;
            view.slice(start, end).forEach(function (it) { it.style.display = ''; });
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
                el.type = 'button';
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

        var debounce;
        if (search) {
            search.addEventListener('input', function () {
                clearTimeout(debounce);
                debounce = setTimeout(function () { rebuild(1, false); }, 150);
            });
        }

        /* 검색 아이콘 토글 — 열면 입력 노출·포커스, 비어서 닫으면 숨김 */
        function openSearch(open) {
            if (!searchWrap) return;
            searchWrap.classList.toggle('is-open', open);
            if (searchBtn) searchBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (open && search) search.focus();
        }
        if (searchBtn) {
            searchBtn.addEventListener('click', function () {
                openSearch(!searchWrap.classList.contains('is-open'));
            });
        }
        if (search) {
            search.addEventListener('blur', function () {
                if (!search.value.trim()) openSearch(false);
            });
            search.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') { search.value = ''; rebuild(1, false); openSearch(false); }
            });
        }

        /* 정렬 아이콘 → 드롭다운 메뉴 */
        function openSort(open) {
            if (!sortMenu) return;
            sortMenu.hidden = !open;
            if (sortBtn) sortBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
        function markSort() {
            if (!sortMenu) return;
            sortMenu.querySelectorAll('[data-sort]').forEach(function (b) {
                b.setAttribute('aria-checked', b.getAttribute('data-sort') === curSort ? 'true' : 'false');
            });
        }
        if (sortBtn) {
            sortBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                openSort(sortMenu.hidden);
            });
        }
        if (sortMenu) {
            sortMenu.addEventListener('click', function (e) {
                var b = e.target.closest('[data-sort]');
                if (!b) return;
                curSort = b.getAttribute('data-sort');
                markSort();
                openSort(false);
                rebuild(1, true);
            });
        }
        document.addEventListener('click', function (e) {
            if (sortWrap && !sortWrap.contains(e.target)) openSort(false);
        });
        markSort();

        /* 페이지당 개수 아이콘 → 드롭다운 (5 / 10 / 50) */
        function openPer(open) {
            if (!perMenu) return;
            perMenu.hidden = !open;
            if (perBtn) perBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
        function markPer() {
            if (perLabel) perLabel.textContent = String(PER_PAGE);
            if (perBtn) perBtn.setAttribute('aria-label', '페이지당 ' + PER_PAGE + '개');
            if (!perMenu) return;
            perMenu.querySelectorAll('[data-per]').forEach(function (b) {
                b.setAttribute('aria-checked', parseInt(b.getAttribute('data-per'), 10) === PER_PAGE ? 'true' : 'false');
            });
        }
        if (perBtn) {
            perBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                openPer(perMenu.hidden);
            });
        }
        if (perMenu) {
            perMenu.addEventListener('click', function (e) {
                var b = e.target.closest('[data-per]');
                if (!b) return;
                PER_PAGE = parseInt(b.getAttribute('data-per'), 10) || 5;
                markPer();
                openPer(false);
                rebuild(1, true);
            });
        }
        document.addEventListener('click', function (e) {
            if (perWrap && !perWrap.contains(e.target)) openPer(false);
        });
        markPer();

        window.addEventListener('hashchange', function () { show(readPage()); });

        rebuild(readPage(), false);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
