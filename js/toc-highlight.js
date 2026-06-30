document.addEventListener('DOMContentLoaded', function() {
(function() {
    const TOC_ID = '#markdown-toc';
    const ACTIVE_CLASS = 'active-toc';
    const SCROLL_OFFSET = 80;
    const TOC_MIN_SPACE = 240; // px available to the right of content

    const tocEl = document.querySelector(TOC_ID);
    if (!tocEl) return;

    const contentEl = document.querySelector('.post-content');
    if (!contentEl) return;

    function updateTocVisibility() {
        var rect = contentEl.getBoundingClientRect();
        var spaceRight = window.innerWidth - rect.right;
        if (spaceRight >= TOC_MIN_SPACE) {
            tocEl.classList.add('toc-visible');
            tocEl.style.left = (rect.right + 16) + 'px';
        } else {
            tocEl.classList.remove('toc-visible');
        }
    }

    updateTocVisibility();
    if (window.ResizeObserver) {
        new ResizeObserver(updateTocVisibility).observe(contentEl);
    }
    window.addEventListener('resize', updateTocVisibility, { passive: true });

    const tocMap = {};
    tocEl.querySelectorAll('a').forEach(n => {
        const idStr = n.id.replace(/^markdown-toc-/, '');
        tocMap[idStr] = n;
    });

    const headings = contentEl.querySelectorAll('h1, h2, h3, h4, h5, h6');

    const deActivate = () => {
        tocEl.querySelectorAll('.' + ACTIVE_CLASS)
            .forEach(n => n.classList.remove(ACTIVE_CLASS));
    };

    // 현재 항목이 속한 최상위(h2) 섹션만 펼친다
    const expandSectionFor = (anchor) => {
        if (!anchor) return;
        let li = anchor.closest('li');
        while (li && li.parentElement !== tocEl) {
            li = li.parentElement.closest('li');
        }
        if (!li || li.classList.contains('toc-expanded')) return;
        Array.from(tocEl.children).forEach(el => el.classList.remove('toc-expanded'));
        li.classList.add('toc-expanded');
    };

    const activate = (target) => {
        if (!target) return;
        target.classList.add(ACTIVE_CLASS);
        expandSectionFor(target);
        // TOC 내에서 active 항목이 보이도록 스크롤
        var tocRect = tocEl.getBoundingClientRect();
        var itemRect = target.getBoundingClientRect();
        if (itemRect.bottom > tocRect.bottom) {
            tocEl.scrollTop += itemRect.bottom - tocRect.bottom + 8;
        } else if (itemRect.top < tocRect.top) {
            tocEl.scrollTop -= tocRect.top - itemRect.top + 8;
        }
    };

    const findCurrentHeading = () => {
        let current = headings[0];
        for (let i = 0; i < headings.length; i++) {
            if (headings[i].getBoundingClientRect().top - SCROLL_OFFSET <= 0) {
                current = headings[i];
            } else {
                break;
            }
        }
        return current;
    };

    let activeHeadingId = null;
    const syncActive = () => {
        const currentHeading = findCurrentHeading();
        if (!currentHeading || currentHeading.id === activeHeadingId) return;

        deActivate();
        activate(tocMap[currentHeading.id]);
        activeHeadingId = currentHeading.id;
    };
    window.addEventListener('scroll', syncActive, { passive: true });

    // 초기 로드 시 현재 위치 섹션을 펼쳐 둔다
    syncActive();
})();
});
