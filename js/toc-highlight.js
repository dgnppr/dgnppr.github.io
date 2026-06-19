(function() {
    const TOC_ID = '#markdown-toc';
    const ACTIVE_CLASS = 'active-toc';
    const SCROLL_OFFSET = 80;

    const tocEl = document.querySelector(TOC_ID);
    if (!tocEl) return;

    const contentEl = document.querySelector('.post-content');
    if (!contentEl) return;

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

    const activate = (target) => {
        if (target) target.classList.add(ACTIVE_CLASS);
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
    window.addEventListener('scroll', function() {
        const currentHeading = findCurrentHeading();
        if (!currentHeading || currentHeading.id === activeHeadingId) return;

        deActivate();
        activate(tocMap[currentHeading.id]);
        activeHeadingId = currentHeading.id;
    }, { passive: true });
})();
