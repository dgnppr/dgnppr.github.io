/* 햄버거 "글 추천" — 지식 그래프 연결 수(degree)로 가중한 랜덤 추천.
 * 순수 랜덤이 아니라 연결이 많은(=허브) 글일수록 뽑힐 확률이 높다.
 * degree 0(고립) 글은 후보에서 제외. 현재 보고 있는 글도 제외. */
(function () {
    var btn = document.getElementById('nav-recommend');
    if (!btn) return;

    var cache = null;      // { candidates: [{id, weight}] }
    var loading = false;

    function currentId() {
        return (location.pathname || '').replace(/^\/+|\/+$/g, '');
    }

    function build(graph) {
        var deg = {};
        (graph.edges || []).forEach(function (e) {
            if (e.from) deg[e.from] = (deg[e.from] || 0) + 1;
            if (e.to)   deg[e.to]   = (deg[e.to]   || 0) + 1;
        });
        var nodes = graph.nodes || {};
        var candidates = [];
        Object.keys(nodes).forEach(function (id) {
            var d = deg[id] || 0;
            if (d < 1) return;                 // 고립 노드 제외
            candidates.push({ id: id, weight: d + 1 });
        });
        return { candidates: candidates };
    }

    /* 가중 랜덤: 연결 수 큰 글일수록 확률↑ */
    function pick(candidates, excludeId) {
        var pool = candidates.filter(function (c) { return c.id !== excludeId; });
        if (!pool.length) pool = candidates;
        if (!pool.length) return null;
        var total = pool.reduce(function (s, c) { return s + c.weight; }, 0);
        var r = Math.random() * total;
        for (var i = 0; i < pool.length; i++) {
            r -= pool[i].weight;
            if (r <= 0) return pool[i];
        }
        return pool[pool.length - 1];
    }

    function go() {
        var chosen = pick(cache.candidates, currentId());
        if (chosen) location.href = '/' + chosen.id + '/';
    }

    btn.addEventListener('click', function () {
        var dd = document.getElementById('nav-dropdown');
        if (dd) dd.classList.remove('is-open');

        if (cache) { go(); return; }
        if (loading) return;
        loading = true;
        btn.classList.add('is-loading');
        fetch('/data/ontology-graph.json')
            .then(function (r) { return r.json(); })
            .then(function (g) { cache = build(g); go(); })
            .catch(function () { /* 실패 시 무시 */ })
            .then(function () { loading = false; btn.classList.remove('is-loading'); });
    });
})();
