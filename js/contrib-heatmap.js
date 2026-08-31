(function () {
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function monthDay(dateStr) {
    var d = new Date(dateStr + 'T00:00:00');
    var day = d.getDate();
    var suffix = 'th';
    if (day % 10 === 1 && day !== 11) suffix = 'st';
    else if (day % 10 === 2 && day !== 12) suffix = 'nd';
    else if (day % 10 === 3 && day !== 13) suffix = 'rd';
    return MONTHS[d.getMonth()] + ' ' + day + suffix;
  }

  function parsePosts(str) {
    if (!str) return [];
    return str.split('||').filter(Boolean).map(function (entry) {
      var idx = entry.lastIndexOf('|');
      return { title: entry.slice(0, idx), url: entry.slice(idx + 1) };
    });
  }

  function init() {
    var heatmap = document.querySelector('[data-contrib-heatmap]');
    if (!heatmap) return;

    var yearButtons = heatmap.querySelectorAll('[data-contrib-year-button]');

    var tooltip = document.createElement('div');
    tooltip.className = 'contrib-heatmap__tooltip';
    document.body.appendChild(tooltip);

    var popover = document.createElement('div');
    popover.className = 'contrib-heatmap__popover';
    document.body.appendChild(popover);

    var activeCell = null;

    function showTooltip(cell) {
      var count = cell.dataset.count;
      var label = monthDay(cell.dataset.date);
      tooltip.textContent = count === '0'
        ? 'No posts on ' + label + '.'
        : count + (count === '1' ? ' post' : ' posts') + ' on ' + label + '.';
      var r = cell.getBoundingClientRect();
      tooltip.style.left = (r.left + r.width / 2) + 'px';
      tooltip.style.top = (r.top - 8) + 'px';
      tooltip.classList.add('is-visible');
    }

    function hideTooltip() {
      tooltip.classList.remove('is-visible');
    }

    function hidePopover() {
      popover.classList.remove('is-visible');
      activeCell = null;
    }

    function showYear(year) {
      var panels = heatmap.querySelectorAll('[data-contrib-year]');
      panels.forEach(function (panel) {
        var isSelected = panel.dataset.contribYear === year;
        panel.hidden = !isSelected;
      });
      yearButtons.forEach(function (button) {
        button.setAttribute('aria-pressed', String(button.dataset.contribYearButton === year));
      });
      hideTooltip();
      hidePopover();
    }

    function showPopover(cell) {
      var posts = parsePosts(cell.dataset.posts);
      if (!posts.length) { hidePopover(); return; }

      popover.textContent = '';
      var dateEl = document.createElement('p');
      dateEl.className = 'contrib-heatmap__popover-date';
      dateEl.textContent = monthDay(cell.dataset.date);
      popover.appendChild(dateEl);
      posts.forEach(function (p) {
        var a = document.createElement('a');
        a.href = p.url;
        a.textContent = p.title;
        popover.appendChild(a);
      });

      var r = cell.getBoundingClientRect();
      var margin = 8;
      var half = popover.getBoundingClientRect().width / 2;
      var desiredLeft = r.left + r.width / 2;
      var left = Math.max(half + margin, Math.min(desiredLeft, window.innerWidth - half - margin));
      popover.style.left = left + 'px';
      popover.style.top = (r.bottom + 8) + 'px';
      popover.classList.add('is-visible');
      activeCell = cell;
    }

    heatmap.addEventListener('mouseover', function (e) {
      var cell = e.target.closest('.contrib-heatmap__cell[data-date]');
      if (cell) showTooltip(cell);
    });
    heatmap.addEventListener('mouseout', function (e) {
      var cell = e.target.closest('.contrib-heatmap__cell[data-date]');
      if (cell) hideTooltip();
    });
    heatmap.addEventListener('click', function (e) {
      var cell = e.target.closest('.contrib-heatmap__cell[data-date]');
      if (!cell) return;
      hideTooltip();
      if (activeCell === cell) {
        hidePopover();
      } else {
        showPopover(cell);
      }
    });
    document.addEventListener('click', function (e) {
      if (activeCell && !popover.contains(e.target) && !heatmap.contains(e.target)) hidePopover();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hidePopover();
    });

    yearButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        showYear(button.dataset.contribYearButton);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
