/* 엔티티 페이지 관계 렌더 — ontology-graph.json 1회 fetch로
 *  (1) 관련 글(outbound, 관계유형 라벨)  (2) 백링크(inbound "이 문서를 참조하는 문서")
 *  (3) 모순(contradicts) 배지+목록  을 렌더한다.
 * 그래프에 노드가 없거나 엣지가 없으면 related.json(임베딩)으로 폴백. */
(function () {
    var slugEl = document.getElementById('thisName');
    if (!slugEl) return;
    var slug = slugEl.value;
    if (!slug) return;

    var TYPE_URL_PREFIX = {
        concept: '/concept/', insight: '/insight/', problem: '/problem/',
        tool: '/tool/', event: '/event/', adr: '/adr/'
    };
    var REL_LABEL = {
        extends: '확장', implements: '구현', 'part-of': '구성요소', supersedes: '대체',
        motivates: '동기', 'caused-by': '원인', 'learned-from': '교훈', references: '참조',
        contradicts: '상충', involves: '관여', 'used-in': '활용처', related: '관련'
    };

    function urlOf(n) {
        return n.url || (TYPE_URL_PREFIX[n.type] || '/concept/') + n.id.replace(/^[^\/]+\//, '') + '/';
    }
    function esc(s) {
        var d = document.createElement('div');
        d.textContent = (s == null) ? '' : String(s);
        return d.innerHTML;
    }
    function relLabel(t) {
        if (!t) return '';
        return REL_LABEL[t] || REL_LABEL[t.replace(/_/g, '-')] || t;  // 언더스코어/하이픈 변형 허용
    }
    function itemHTML(it) {
        var badge = it.relType
            ? '<span class="rel-badge rel-badge--' + it.relType.replace(/_/g, '-') + '">' + esc(relLabel(it.relType)) + '</span>'
            : '';
        return '<a class="related-posts__item" href="' + it.url + '">' +
            '<span class="related-posts__title">' + esc(it.title) + '</span>' + badge + '</a>';
    }

    function renderList(containerId, heading, items, extraClass) {
        var box = document.getElementById(containerId);
        if (!box || !items.length) return;
        box.innerHTML = '<section class="related-posts ' + (extraClass || '') + '">' +
            '<h3 class="related-posts__heading">' + heading + '</h3>' +
            '<div class="related-posts__list">' + items.map(itemHTML).join('') + '</div></section>';
    }

    function embeddingsRelated() {
        fetch('/data/related.json').then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                if (!data) return;
                var items = (data[slug] || []).map(function (r) { return { url: r.url, title: r.title }; });
                renderList('related-posts-container', '관련 글', items);
            }).catch(function () {});
    }

    fetch('/data/ontology-graph.json').then(function (r) { return r.ok ? r.json() : null; })
        .then(function (graph) {
            if (!graph || !graph.nodes) { embeddingsRelated(); return; }
            var nodes = graph.nodes;
            var focal = nodes[slug] || Object.keys(nodes).map(function (k) { return nodes[k]; })
                .find(function (n) { return n && n.id && n.id.replace(/^[^\/]+\//, '') === slug; });
            if (!focal) { embeddingsRelated(); return; }

            var fid = focal.id;
            var out = [], inb = [], seen = {};
            (graph.edges || []).forEach(function (e) {
                var isOut = e.from === fid, isIn = e.to === fid;
                if (!isOut && !isIn) return;
                var otherId = isOut ? e.to : e.from;
                var n = nodes[otherId];
                if (!n) return;
                var item = { url: urlOf(n), title: n.title || otherId, type: n.type, relType: e.type };
                if (isOut) {
                    if (!seen['o:' + otherId + e.type]) { out.push(item); seen['o:' + otherId + e.type] = 1; }
                } else {
                    if (!seen['i:' + otherId + e.type]) { inb.push(item); seen['i:' + otherId + e.type] = 1; }
                }
            });

            if (!out.length && !inb.length) { embeddingsRelated(); return; }
            renderList('related-posts-container', '관련 글', out);
            renderList('backlinks-container', '이 문서를 참조하는 문서', inb, 'backlinks');
            if (!out.length) embeddingsRelated();  // outbound 없으면 임베딩으로 관련글 보강
        }).catch(function () { embeddingsRelated(); });
})();
