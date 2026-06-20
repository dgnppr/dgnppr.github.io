(function() {
  document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('[class*="language-"]').forEach(function(wrapper) {
      var match = wrapper.className.match(/language-([a-zA-Z0-9_+#-]+)/);
      if (!match) return;
      var lang = match[1];
      if (lang === 'plaintext' || lang === 'text' || lang === 'mermaid') return;
      var highlight = wrapper.querySelector('.highlight');
      if (!highlight) return;
      var label = document.createElement('span');
      label.className = 'code-lang-label';
      label.textContent = lang.toUpperCase();
      highlight.appendChild(label);
    });
  });
})();
