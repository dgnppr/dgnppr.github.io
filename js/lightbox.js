(function() {
  if (document.getElementById('lb-overlay')) return;
  var overlay = document.createElement('div');
  overlay.id = 'lb-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '이미지 확대 보기');
  var img = document.createElement('img');
  img.id = 'lb-img';
  img.setAttribute('alt', '');
  var closeBtn = document.createElement('button');
  closeBtn.id = 'lb-close';
  closeBtn.setAttribute('aria-label', '닫기');
  closeBtn.innerHTML = '&times;';
  overlay.appendChild(img);
  overlay.appendChild(closeBtn);
  document.body.appendChild(overlay);

  function open(src, alt) {
    img.src = src;
    img.alt = alt || '';
    overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    closeBtn.focus();
  }
  function close() {
    overlay.classList.remove('is-open');
    document.body.style.overflow = '';
    img.src = '';
  }
  overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && overlay.classList.contains('is-open')) close();
  });

  document.addEventListener('DOMContentLoaded', function() {
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) overlay.classList.add('no-motion');
    document.querySelectorAll('.post-content img').forEach(function(el) {
      el.style.cursor = 'zoom-in';
      el.addEventListener('click', function() { open(el.src, el.alt); });
    });
  });
})();
