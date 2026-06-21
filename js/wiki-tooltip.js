(function () {
    'use strict';

    var summaries = null;
    var tooltip = null;
    var hideTimer = null;
    var DELAY_SHOW = 120;
    var DELAY_HIDE = 180;

    function createTooltip() {
        var el = document.createElement('div');
        el.id = 'wiki-hover-tooltip';
        el.setAttribute('role', 'tooltip');
        document.body.appendChild(el);
        return el;
    }

    function slugFromHref(href) {
        return href.replace(/^\/wiki\//, '').replace(/\/$/, '');
    }

    function show(anchor, slug) {
        clearTimeout(hideTimer);
        var text = summaries[slug];
        if (!text) return;

        if (!tooltip) tooltip = createTooltip();

        tooltip.innerHTML =
            '<div class="wtt-title">' + (anchor.textContent.trim() || slug) + '</div>' +
            '<p class="wtt-body">' + text + '</p>' +
            '<span class="wtt-hint">클릭해서 이동 →</span>';

        tooltip.classList.add('wtt-visible');

        positionTooltip(anchor);
    }

    function positionTooltip(anchor) {
        if (!tooltip) return;
        var rect = anchor.getBoundingClientRect();
        var gap = 8;
        var ttW = 280;

        var left = rect.left + window.scrollX;
        var top  = rect.bottom + window.scrollY + gap;

        if (left + ttW > window.innerWidth - 16) {
            left = window.innerWidth - ttW - 16;
        }
        if (left < 8) left = 8;

        tooltip.style.left = left + 'px';
        tooltip.style.top  = top + 'px';
        tooltip.style.width = ttW + 'px';
    }

    function hide() {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(function () {
            if (tooltip) tooltip.classList.remove('wtt-visible');
        }, DELAY_HIDE);
    }

    function attachHandlers() {
        var anchors = document.querySelectorAll('a[href^="/wiki/"]');
        anchors.forEach(function (a) {
            var href = a.getAttribute('href');
            var slug = slugFromHref(href);
            if (!summaries[slug]) return;

            var showTimer;
            a.addEventListener('mouseenter', function () {
                clearTimeout(showTimer);
                showTimer = setTimeout(function () { show(a, slug); }, DELAY_SHOW);
            });
            a.addEventListener('mouseleave', function () {
                clearTimeout(showTimer);
                hide();
            });
            a.addEventListener('focus', function () { show(a, slug); });
            a.addEventListener('blur', hide);
        });
    }

    function init() {
        fetch('/data/summaries.json')
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                if (!data) return;
                summaries = data;
                attachHandlers();
            })
            .catch(function () {});
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
