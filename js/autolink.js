(function () {
  const URL_PATTERN = /(?<!["\\'=<>])(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;

  function linkifyTextNode(node) {
    const text = node.nodeValue;
    URL_PATTERN.lastIndex = 0;
    if (!URL_PATTERN.test(text)) return;
    URL_PATTERN.lastIndex = 0;

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match;

    while ((match = URL_PATTERN.exec(text)) !== null) {
      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      const a = document.createElement('a');
      a.href = match[1];
      a.textContent = match[1];
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      fragment.appendChild(a);
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    node.parentNode.replaceChild(fragment, node);
  }

  function linkify(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const tag = node.parentElement?.tagName?.toLowerCase();
        if (['a', 'script', 'style', 'code', 'pre'].includes(tag)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    nodes.forEach(linkifyTextNode);
  }

  document.addEventListener('DOMContentLoaded', function () {
    const content = document.querySelector('article.post-content');
    if (content) linkify(content);
  });
})();
