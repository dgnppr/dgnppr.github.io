(function () {
  var TARGETS = 'p, h1, h2, h3, h4, li, pre, blockquote, table';
  var DIM_OPACITY = '0.15';
  var active = false;
  var current = null;
  var btn = null;

  function getArticle() {
    return document.querySelector('.post-content');
  }

  function getElements() {
    var article = getArticle();
    return article ? Array.from(article.querySelectorAll(TARGETS)) : [];
  }

  function dimAll() {
    getElements().forEach(function (el) {
      el.style.transition = 'opacity 0.2s ease';
      el.style.opacity = DIM_OPACITY;
    });
  }

  function undimAll() {
    getElements().forEach(function (el) {
      el.style.transition = '';
      el.style.opacity = '';
    });
    current = null;
  }

  function focusEl(el) {
    if (current === el) return;
    current = el;
    getElements().forEach(function (e) {
      e.style.opacity = e === el ? '1' : DIM_OPACITY;
    });
  }

  function onMouseMove(e) {
    if (!active) return;
    var el = e.target.closest(TARGETS);
    if (el && getArticle().contains(el)) focusEl(el);
  }

  function enable() {
    dimAll();
    getArticle().addEventListener('mousemove', onMouseMove);
  }

  function disable() {
    undimAll();
    var article = getArticle();
    if (article) article.removeEventListener('mousemove', onMouseMove);
  }

  function toggle() {
    active = !active;
    btn.classList.toggle('focus-reading-btn--active', active);
    btn.setAttribute('aria-pressed', String(active));
    btn.title = active ? '포커스 리딩 끄기' : '포커스 리딩';
    if (active) enable(); else disable();
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!getArticle()) return;

    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'top-widget__action focus-reading-btn';
    btn.title = '포커스 리딩';
    btn.setAttribute('aria-label', '포커스 리딩');
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/></svg>';
    btn.addEventListener('click', toggle);

    var sharePanel = document.querySelector('#topWidget .top-widget__share-panel');
    if (sharePanel) sharePanel.before(btn);
    else {
        var widget = document.getElementById('topWidget');
        if (widget) widget.prepend(btn);
    }
  });
})();
