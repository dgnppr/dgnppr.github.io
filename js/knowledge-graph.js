(function () {
    'use strict';

    var container = document.getElementById('knowledge-graph');
    if (!container || typeof d3 === 'undefined') return;

    // ─── Theme tokens ───────────────────────────────────────────
    function isDark() { return document.documentElement.classList.contains('dark-mode'); }
    var THEME = {
        dark:  { bg: '#0d1117', bgGrad: '#1a1f2e', link: 'rgba(255,255,255,0.22)', linkDim: 'rgba(255,255,255,0.02)', nodeStroke: '#0d1117', label: '#94a3b8', labelActive: '#ffffff' },
        light: { bg: '#f8fafc', bgGrad: '#e8f0fe', link: 'rgba(0,0,0,0.13)',       linkDim: 'rgba(0,0,0,0.02)',       nodeStroke: '#f8fafc', label: '#475569', labelActive: '#0f172a' },
    };
    function t() { return isDark() ? THEME.dark : THEME.light; }

    // ─── Category → color ────────────────────────────────────────
    var CAT_COLOR = {
        'ai-agent':          '#8b5cf6',
        'database':          '#0ea5e9',
        'design-pattern':    '#10b981',
        'essay':             '#f97316',
        'java':              '#ef4444',
        'jpa':               '#22c55e',
        'jvm':               '#eab308',
        'kafka':             '#ec4899',
        'msa':               '#3b82f6',
        'spring-boot':       '#14b8a6',
        'springboot':        '#14b8a6',
        'system-design':     '#84cc16',
        'retrospect':        '#a855f7',
        'code-architecture': '#f43f5e',
        'reference':         '#64748b',
        'data-engineering':  '#d946ef',
        'blog':              '#f59e0b',
    };
    var DEFAULT_COLOR = '#64748b';
    function catColor(cat) { return CAT_COLOR[cat] || DEFAULT_COLOR; }

    function getCategory(url, type) {
        if (type === 'blog') return 'blog';
        var m = url.match(/^\/wiki\/([^\/]+)/);
        return m ? m[1] : 'default';
    }

    // ─── Constants ──────────────────────────────────────────────
    var DIM_OPACITY  = 0.05;
    var LABEL_NORMAL = 0.8;

    // ─── Canvas ─────────────────────────────────────────────────
    var W = container.clientWidth;
    var H = container.clientHeight;

    function applyTheme() {
        var th = t();
        container.style.background = th.bg;
        gradStop0.attr('stop-color', th.bgGrad);
        gradStop1.attr('stop-color', th.bg);
    }

    var svg = d3.select(container).append('svg').attr('width', W).attr('height', H);
    var defs = svg.append('defs');
    var grad = defs.append('radialGradient').attr('id', 'bg-grad').attr('cx', '50%').attr('cy', '50%').attr('r', '65%');
    var gradStop0 = grad.append('stop').attr('offset', '0%').attr('stop-opacity', 0.5);
    var gradStop1 = grad.append('stop').attr('offset', '100%').attr('stop-opacity', 0);
    svg.append('rect').attr('width', W).attr('height', H).attr('fill', 'url(#bg-grad)');

    var g = svg.append('g');
    var zoom = d3.zoom().scaleExtent([0.04, 10]).on('zoom', function (e) { g.attr('transform', e.transform); });
    svg.call(zoom);
    svg.call(zoom.transform, d3.zoomIdentity.translate(W / 2, H / 2).scale(0.7).translate(-W / 2, -H / 2));
    applyTheme();

    // ─── Tooltip ────────────────────────────────────────────────
    var tooltip = d3.select(container).append('div').attr('class', 'graph-tooltip');

    // ─── Panel refs ─────────────────────────────────────────────
    var panel      = document.getElementById('graph-panel');
    var searchEl   = panel && panel.querySelector('#graph-search');
    var groupsEl   = panel && panel.querySelector('#graph-groups');
    var statsEl    = panel && panel.querySelector('#graph-stats');
    var hiddenCats = new Set();

    // ─── Load data ──────────────────────────────────────────────
    Promise.all([
        fetch('/data/search-index.json').then(function (r) { return r.json(); }),
        fetch('/data/related.json').then(function (r) { return r.json(); }),
    ]).then(function (results) {
        var searchIndex = results[0];
        var related     = results[1];

        // ── Build nodes ─────────────────────────────────────────
        var nodeMap = {};
        var nodes   = [];

        searchIndex.forEach(function (page) {
            // 태그 페이지 제외
            if (page.type === 'tag') return;
            // 단일세그먼트 인덱스/카테고리 페이지 제외
            if (page.type === 'wiki' && /^\/wiki\/[^\/]+\/?$/.test(page.url)) return;

            var slug = page.url.replace(/^\/(wiki|posts|blog)\//, '');
            var cat  = getCategory(page.url, page.type);
            var n = {
                id:     slug,
                slug:   slug,
                title:  page.title,
                url:    page.url,
                type:   page.type || 'wiki',
                cat:    cat,
                tags:   page.tags || [],
                degree: 0,
            };
            nodes.push(n);
            nodeMap[slug] = n;
        });

        // ── Build links + adjacency ─────────────────────────────
        var seen = new Set();
        var links = [];
        var adj   = {};

        function addLink(aSlug, bSlug) {
            var key = [aSlug, bSlug].sort().join('|||');
            if (seen.has(key)) return;
            seen.add(key);
            var aNode = nodeMap[aSlug], bNode = nodeMap[bSlug];
            if (!aNode || !bNode) return;
            links.push({ source: aSlug, target: bSlug });
            aNode.degree++;
            bNode.degree++;
            if (!adj[aSlug]) adj[aSlug] = new Set();
            if (!adj[bSlug]) adj[bSlug] = new Set();
            adj[aSlug].add(bSlug);
            adj[bSlug].add(aSlug);
        }

        Object.keys(related).forEach(function (src) {
            var sNode = nodeMap[src];
            if (!sNode) return;
            (related[src] || []).forEach(function (rel) { addLink(src, rel.slug); });
        });

        // ── Category groups & cluster centroids ─────────────────
        var catGroups = {};
        nodes.forEach(function (n) { if (!catGroups[n.cat]) catGroups[n.cat] = []; catGroups[n.cat].push(n); });
        var cats = Object.keys(catGroups).sort(function (a, b) { return catGroups[b].length - catGroups[a].length; });

        var clusterR = Math.min(W, H) * 0.34;
        var catCenters = {};
        cats.forEach(function (cat, i) {
            var angle = (i / cats.length) * 2 * Math.PI - Math.PI / 2;
            catCenters[cat] = { x: W / 2 + clusterR * Math.cos(angle), y: H / 2 + clusterR * Math.sin(angle) };
        });

        // ── Node radius ─────────────────────────────────────────
        function nodeR(n) {
            var base = 4 + Math.sqrt(n.degree) * 3.2;
            if (n.type === 'blog') base += 2;
            return Math.max(4, Math.min(20, base));
        }

        // ── Simulation ──────────────────────────────────────────
        var sim = d3.forceSimulation(nodes)
            .force('link',      d3.forceLink(links).id(function (d) { return d.id; }).distance(85).strength(0.35))
            .force('charge',    d3.forceManyBody().strength(-200).distanceMax(450))
            .force('collision', d3.forceCollide().radius(function (d) { return nodeR(d) + 10; }))
            .force('clusterX',  d3.forceX().strength(0.15).x(function (d) { return (catCenters[d.cat] || {x: W/2}).x; }))
            .force('clusterY',  d3.forceY().strength(0.15).y(function (d) { return (catCenters[d.cat] || {y: H/2}).y; }));

        // ── Draw layers ─────────────────────────────────────────
        var linkG  = g.append('g');
        var nodeG  = g.append('g');
        var labelG = g.append('g');

        var linkEl = linkG.selectAll('line').data(links).join('line')
            .attr('stroke', t().link)
            .attr('stroke-width', 1);

        var nodeEl = nodeG.selectAll('circle').data(nodes).join('circle')
            .attr('r', nodeR)
            .attr('fill', function (d) { return catColor(d.cat); })
            .attr('stroke', t().nodeStroke).attr('stroke-width', 1.5)
            .style('cursor', 'pointer');

        var labelEl = labelG.selectAll('text').data(nodes).join('text')
            .text(function (d) {
                var tx = d.title.replace(/^[""]|[""]$/g, '');
                return tx.length > 16 ? tx.slice(0, 16) + '…' : tx;
            })
            .attr('font-size', '9px')
            .attr('font-family', 'system-ui, -apple-system, sans-serif')
            .attr('fill', t().label)
            .attr('opacity', LABEL_NORMAL)
            .attr('dy', 3)
            .style('pointer-events', 'none').style('user-select', 'none');

        // ── Hover interaction ────────────────────────────────────
        var activeSlug = null, resetTimer;
        var isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

        function highlight(d) {
            if (activeSlug === d.slug) return;
            activeSlug = d.slug;
            clearTimeout(resetTimer);
            var neighbors = adj[d.slug] || new Set();
            var th = t();

            nodeEl.attr('opacity', function (n) { return n.slug === d.slug || neighbors.has(n.slug) ? 1 : DIM_OPACITY; })
                  .attr('r', function (n) { return n.slug === d.slug ? nodeR(n) * 1.5 : nodeR(n); });

            linkEl.attr('stroke', function (l) {
                        var sid = l.source.slug || l.source, tid = l.target.slug || l.target;
                        return (sid === d.slug || tid === d.slug) ? catColor(d.cat) : th.linkDim;
                    })
                  .attr('stroke-width', function (l) {
                        var sid = l.source.slug || l.source, tid = l.target.slug || l.target;
                        return (sid === d.slug || tid === d.slug) ? 2 : 1;
                    })
                  .attr('opacity', function (l) {
                        var sid = l.source.slug || l.source, tid = l.target.slug || l.target;
                        return (sid === d.slug || tid === d.slug) ? 1 : 0.04;
                    });

            labelEl.attr('opacity', function (n) { return n.slug === d.slug || neighbors.has(n.slug) ? 1 : 0; })
                   .attr('fill', function (n) { return n.slug === d.slug ? th.labelActive : th.label; })
                   .attr('font-size', function (n) { return n.slug === d.slug ? '11px' : '9px'; });

            var tagList = d.tags.slice(0, 4).map(function (tx) { return '#' + tx; });
            tooltip.classed('is-visible', true)
                .html('<strong>' + d.title + '</strong><span>' +
                    d.cat + ' · ' + d.degree + '개 연결' +
                    (tagList.length ? '<br>' + tagList.join(' ') : '') + '</span>');
        }

        function reset() {
            clearTimeout(resetTimer);
            resetTimer = setTimeout(function () {
                activeSlug = null;
                var th = t();
                nodeEl.attr('opacity', 1).attr('r', nodeR);
                linkEl.attr('stroke', th.link).attr('stroke-width', 1).attr('opacity', 1);
                labelEl.attr('opacity', LABEL_NORMAL).attr('fill', th.label).attr('font-size', '9px');
                tooltip.classed('is-visible', false);
            }, 80);
        }

        nodeEl
            .on('mouseenter', function (e, d) {
                if (isTouchDevice) return;
                highlight(d);
                tooltip.style('left', (e.clientX + 14) + 'px').style('top', (e.clientY - 10) + 'px');
            })
            .on('mousemove', function (e) {
                if (isTouchDevice) return;
                tooltip.style('left', (e.clientX + 14) + 'px').style('top', (e.clientY - 10) + 'px');
            })
            .on('mouseleave', function () { if (!isTouchDevice) reset(); })
            .on('click', function (e, d) {
                if (isTouchDevice) {
                    if (activeSlug !== d.slug) {
                        e.stopPropagation();
                        clearTimeout(resetTimer);
                        highlight(d);
                        var cx = e.clientX || (e.touches && e.touches[0] && e.touches[0].clientX) || window.innerWidth / 2;
                        var cy = e.clientY || (e.touches && e.touches[0] && e.touches[0].clientY) || 120;
                        tooltip.style('left', Math.min(cx + 14, window.innerWidth - 180) + 'px')
                               .style('top', Math.max(70, cy - 60) + 'px')
                               .style('transform', 'none');
                    } else {
                        window.location.href = d.url;
                    }
                } else {
                    window.location.href = d.url;
                }
            });

        // 전체 노드가 화면에 들어오도록 줌 아웃
        function zoomToFit() {
            var pad = 50;
            var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            nodes.forEach(function (n) {
                if (n.x == null) return;
                if (n.x < x0) x0 = n.x; if (n.x > x1) x1 = n.x;
                if (n.y < y0) y0 = n.y; if (n.y > y1) y1 = n.y;
            });
            if (x0 === Infinity) return;
            var bW = x1 - x0 || 1, bH = y1 - y0 || 1;
            var scale = Math.min((W - pad * 2) / bW, (H - pad * 2) / bH, 1.2);
            var tx = W / 2 - scale * (x0 + bW / 2);
            var ty = H / 2 - scale * (y0 + bH / 2);
            svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
        }

        // 모바일: 배경 탭 시 하이라이트 해제 + 전체 그래프 보기
        svg.on('click', function (e) {
            if (!isTouchDevice) return;
            var tag = e.target.tagName;
            if (tag === 'circle' || tag === 'text') return;
            if (activeSlug) {
                reset();
                zoomToFit();
            }
        });

        nodeEl.call(d3.drag()
            .on('start', function (e, d) { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
            .on('drag',  function (e, d) { d.fx = e.x; d.fy = e.y; })
            .on('end',   function (e, d) { if (!e.active) sim.alphaTarget(0); })
        );

        sim.on('tick', function () {
            linkEl.attr('x1', function (d) { return d.source.x; }).attr('y1', function (d) { return d.source.y; })
                  .attr('x2', function (d) { return d.target.x; }).attr('y2', function (d) { return d.target.y; });
            nodeEl.attr('cx', function (d) { return d.x; }).attr('cy', function (d) { return d.y; });
            labelEl.attr('x', function (d) { return d.x + nodeR(d) + 3; }).attr('y', function (d) { return d.y; });
        });

        // ── Side panel ──────────────────────────────────────────
        if (statsEl) statsEl.textContent = nodes.length + '개 노드 · ' + links.length + '개 연결';

        if (groupsEl) {
            cats.forEach(function (cat) {
                var item = document.createElement('label');
                item.className = 'gp-item';
                item.innerHTML = '<input type="checkbox" checked data-cat="' + cat + '">' +
                    '<span class="gp-dot" style="background:' + catColor(cat) + '"></span>' +
                    '<span class="gp-name">' + cat + '</span>' +
                    '<span class="gp-count">' + catGroups[cat].length + '</span>';
                groupsEl.appendChild(item);
                item.querySelector('input').addEventListener('change', function (e) {
                    if (e.target.checked) hiddenCats.delete(cat); else hiddenCats.add(cat);
                    nodeEl.attr('display', function (d) { return hiddenCats.has(d.cat) ? 'none' : null; });
                    labelEl.attr('display', function (d) { return hiddenCats.has(d.cat) ? 'none' : null; });
                });
            });
        }

        if (searchEl) {
            searchEl.addEventListener('input', function (e) {
                // reset() 타이머가 검색 상태를 덮어쓰지 않도록 취소
                clearTimeout(resetTimer);
                activeSlug = null;
                var q = e.target.value.toLowerCase().trim();
                var th = t();
                if (!q) {
                    nodeEl.attr('opacity', 1).attr('r', nodeR);
                    labelEl.attr('opacity', LABEL_NORMAL).attr('fill', th.label).attr('font-size', '9px');
                    linkEl.attr('stroke', th.link).attr('stroke-width', 1).attr('opacity', 1);
                    tooltip.classed('is-visible', false);
                    return;
                }
                var match = function (d) { return d.title.toLowerCase().includes(q); };
                nodeEl.attr('opacity', function (d) { return match(d) ? 1 : DIM_OPACITY; })
                      .attr('r', function (d) { return match(d) ? nodeR(d) * 1.4 : nodeR(d); });
                labelEl.attr('opacity', function (d) { return match(d) ? 1 : 0; })
                       .attr('fill', function (d) { return match(d) ? th.labelActive : th.label; })
                       .attr('font-size', function (d) { return match(d) ? '11px' : '9px'; });
                linkEl.attr('stroke', th.link).attr('stroke-width', 1).attr('opacity', 0.06);
            });
        }

        // ── Theme switch sync ────────────────────────────────────
        new MutationObserver(function () {
            var th = t();
            applyTheme();
            container.style.background = th.bg;
            nodeEl.attr('stroke', th.nodeStroke);
            linkEl.attr('stroke', th.link);
            labelEl.attr('fill', th.label);
        }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

        // bfcache 복귀 시 드래그/하이라이트 상태 초기화 (모바일 "다른 노드 선택 불가" 버그 수정)
        window.addEventListener('pageshow', function (e) {
            if (!e.persisted) return;
            nodes.forEach(function (n) { n.fx = null; n.fy = null; });
            activeSlug = null;
            clearTimeout(resetTimer);
            var th = t();
            nodeEl.attr('opacity', 1).attr('r', nodeR);
            linkEl.attr('stroke', th.link).attr('stroke-width', 1).attr('opacity', 1);
            labelEl.attr('opacity', LABEL_NORMAL).attr('fill', th.label).attr('font-size', '9px');
            tooltip.classed('is-visible', false);
            sim.alpha(0.1).restart();
        });

        window.addEventListener('resize', function () {
            W = container.clientWidth; H = container.clientHeight;
            svg.attr('width', W).attr('height', H);
            svg.select('rect').attr('width', W).attr('height', H);
        });

    }).catch(function (e) { console.error('graph error:', e); });
})();
