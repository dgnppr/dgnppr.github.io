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
  closeBtn.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><line x1="3" y1="3" x2="13" y2="13"/><line x1="13" y1="3" x2="3" y2="13"/></svg>';
  var container = document.createElement('div');
  container.id = 'lb-container';
  container.appendChild(img);
  container.appendChild(closeBtn);
  overlay.appendChild(container);
  document.body.appendChild(overlay);

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    overlay.classList.add('no-motion');
  }

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

  // 이벤트 위임 — DOMContentLoaded 타이밍·<a> 안 이미지 모두 처리
  document.addEventListener('click', function(e) {
    var el = e.target;
    if (!el || el.tagName !== 'IMG') return;
    if (!el.closest || !el.closest('.post-content')) return;
    e.preventDefault();
    open(el.src, el.alt);
  });
})();
