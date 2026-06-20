(function() {
  document.addEventListener('DOMContentLoaded', function() {
    var slug = document.getElementById('thisName') && document.getElementById('thisName').value;
    if (!slug) return;
    var ctaEl = document.getElementById('reading-cta');
    if (!ctaEl) return;

    function renderCTA(title, url, label) {
      ctaEl.innerHTML =
        '<div class="reading-cta__inner">' +
        '<span class="reading-cta__label">' + label + '</span>' +
        '<a class="reading-cta__link" href="' + url + '">' + title + ' →</a>' +
        '</div>';
      ctaEl.classList.add('is-visible');
    }

    function tryLoad() {
      // 1. 시리즈 다음 글 우선
      fetch('/data/series.json')
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          if (data) {
            var found = null;
            Object.keys(data).forEach(function(name) {
              data[name].forEach(function(item, idx) {
                if (item.slug === slug && idx < data[name].length - 1) {
                  found = { title: data[name][idx + 1].title, url: data[name][idx + 1].url, label: '시리즈 다음 글' };
                }
              });
            });
            if (found) { renderCTA(found.title, found.url, found.label); return; }
          }

        }).catch(function() {});
    }

    // IntersectionObserver로 댓글 영역 진입 시 로드
    var target = document.getElementById('related-posts-container') || document.querySelector('.post-content');
    if (!target) return;
    var observer = new IntersectionObserver(function(entries) {
      if (entries[0].isIntersecting) {
        observer.disconnect();
        tryLoad();
      }
    }, { threshold: 0.5 });
    observer.observe(target);
  });
})();
