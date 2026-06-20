(function() {
  var palette = null;
  var input = null;
  var list = null;
  var searchIndex = null;
  var fuseCmd = null;
  var activeIdx = -1;

  function init() {
    if (palette) return;
    palette = document.createElement('div');
    palette.id = 'cmd-palette';
    palette.setAttribute('role', 'dialog');
    palette.setAttribute('aria-modal', 'true');
    palette.setAttribute('aria-label', '명령 팔레트');
    palette.innerHTML =
      '<div class="cmd-backdrop"></div>' +
      '<div class="cmd-modal">' +
        '<div class="cmd-input-wrap">' +
          '<svg class="cmd-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
          '<input id="cmd-input" class="cmd-input" type="text" placeholder="검색하거나 이동..." autocomplete="off" spellcheck="false">' +
          '<kbd class="cmd-esc">ESC</kbd>' +
        '</div>' +
        '<ul id="cmd-list" class="cmd-list" role="listbox"></ul>' +
      '</div>';
    document.body.appendChild(palette);
    input = document.getElementById('cmd-input');
    list = document.getElementById('cmd-list');
    document.querySelector('.cmd-backdrop').addEventListener('click', close);
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKey);
  }

  var QUICK_ACTIONS = [
    { label: '홈으로 이동', icon: '🏠', url: '/' },
    { label: 'Topics 페이지', icon: '📚', url: '/topics/' },
    { label: '태그 목록', icon: '🏷️', url: '/tags/' },
    { label: '다크모드 전환', icon: '🌙', action: 'toggle-dark' },
  ];

  function getItems(q) {
    if (!q) return QUICK_ACTIONS.map(function(a) { return { type: 'action', label: a.label, icon: a.icon, url: a.url, action: a.action }; });
    var results = [];
    if (fuseCmd) {
      fuseCmd.search(q, { limit: 6 }).forEach(function(r) {
        results.push({ type: 'page', label: r.item.title, sub: r.item.url, url: r.item.url });
      });
    }
    QUICK_ACTIONS.filter(function(a) { return a.label.toLowerCase().indexOf(q.toLowerCase()) !== -1; })
      .forEach(function(a) { results.push({ type: 'action', label: a.label, icon: a.icon, url: a.url, action: a.action }); });
    return results;
  }

  function renderList(items) {
    activeIdx = -1;
    list.innerHTML = items.map(function(item, i) {
      return '<li class="cmd-item" role="option" data-idx="' + i + '">' +
        (item.icon ? '<span class="cmd-item-icon">' + item.icon + '</span>' : '<span class="cmd-item-icon cmd-item-icon--page">↗</span>') +
        '<span class="cmd-item-text">' +
          '<span class="cmd-item-label">' + item.label + '</span>' +
          (item.sub ? '<span class="cmd-item-sub">' + item.sub + '</span>' : '') +
        '</span>' +
        '</li>';
    }).join('');
    list.querySelectorAll('.cmd-item').forEach(function(el) {
      el.addEventListener('click', function() { execItem(items[parseInt(el.dataset.idx)]); });
      el.addEventListener('mouseenter', function() { setActive(parseInt(el.dataset.idx)); });
    });
  }

  function setActive(idx) {
    list.querySelectorAll('.cmd-item').forEach(function(el, i) {
      el.classList.toggle('is-active', i === idx);
    });
    activeIdx = idx;
  }

  function execItem(item) {
    if (!item) return;
    if (item.action === 'toggle-dark') {
      document.documentElement.classList.toggle('dark-mode');
      var isDark = document.documentElement.classList.contains('dark-mode');
      localStorage.setItem('theme', isDark ? 'dark-mode' : 'light-mode');
      close(); return;
    }
    if (item.url) { window.location.href = item.url; }
    close();
  }

  function onInput() {
    var q = input.value.trim();
    renderList(getItems(q));
  }

  function onKey(e) {
    var items = list.querySelectorAll('.cmd-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(activeIdx + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(activeIdx - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      var el = list.querySelector('.cmd-item.is-active');
      if (el) el.click();
    }
    else if (e.key === 'Escape') { close(); }
  }

  function open() {
    init();
    if (!searchIndex) {
      fetch('/data/search-index.json')
        .then(function(r) { return r.json(); })
        .then(function(data) {
          searchIndex = data.filter(function(d) { return d.type !== 'tag'; });
          if (window.Fuse) fuseCmd = new Fuse(searchIndex, { keys: [{ name: 'title', weight: 2 }, { name: 'tags', weight: 1 }], threshold: 0.35 });
        }).catch(function() {});
    }
    palette.classList.add('is-open');
    renderList(getItems(''));
    setTimeout(function() { input.focus(); }, 50);
  }

  function close() {
    if (!palette) return;
    palette.classList.remove('is-open');
    input.value = '';
  }

  document.addEventListener('keydown', function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      palette && palette.classList.contains('is-open') ? close() : open();
    }
  });

  window.__openCommandPalette = open;
})();
