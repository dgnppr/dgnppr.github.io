function initMermaidDeeplinks() {
    var headings = Array.from(document.querySelectorAll(
        '.post-content h1, .post-content h2, .post-content h3, .post-content h4, .post-content h5'
    ));
    if (!headings.length) return;

    function norm(text) {
        return (text || '').toLowerCase()
            .replace(/\s+/g, '')
            .replace(/[^\w가-힣]/g, '');
    }

    document.querySelectorAll('.mermaid-diagram svg').forEach(function(svgEl) {
        // Mermaid v10: nodes have class 'node', label in .nodeLabel or <text>
        svgEl.querySelectorAll('.node').forEach(function(nodeEl) {
            var labelEl = nodeEl.querySelector('.nodeLabel, .label, text');
            if (!labelEl) return;
            var nodeText = norm(labelEl.textContent);
            if (nodeText.length < 2) return;

            var matched = headings.find(function(h) {
                var hText = norm(h.textContent);
                return hText === nodeText || hText.includes(nodeText) || nodeText.includes(hText);
            });
            if (!matched) return;

            nodeEl.style.cursor = 'pointer';
            nodeEl.setAttribute('title', '↓ ' + matched.textContent.trim());
            nodeEl.addEventListener('click', function(e) {
                e.stopPropagation();
                matched.scrollIntoView({ behavior: 'smooth', block: 'start' });
                // 잠깐 하이라이트
                var prev = matched.style.background;
                matched.style.transition = 'background 0.3s';
                matched.style.background = 'rgba(37,99,235,0.1)';
                setTimeout(function() {
                    matched.style.background = prev;
                    setTimeout(function() { matched.style.transition = ''; }, 300);
                }, 900);
            });
        });
    });
}
