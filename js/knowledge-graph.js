(function () {
    'use strict';

    var container = document.getElementById('knowledge-graph');
    if (!container || typeof d3 === 'undefined') return;

    // ─── Theme tokens ───────────────────────────────────────────
    function isDark() { return document.documentElement.classList.contains('dark-mode'); }
    var THEME = {
        dark:  { bg: '#0d1117', bgGrad: '#1a1f2e', link: 'rgba(255,255,255,0.07)', linkDim: 'rgba(255,255,255,0.02)', nodeStroke: '#0d1117', label: '#94a3b8', labelActive: '#ffffff' },
        light: { bg: '#f8fafc', bgGrad: '#e8f0fe', link: 'rgba(0,0,0,0.10)',       linkDim: 'rgba(0,0,0,0.02)',       nodeStroke: '#f8fafc', label: '#475569', labelActive: '#0f172a' },
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
        if (type === 'tag')  return '_tag';
        if (type === 'blog') return 'blog';
        var m = url.match(/^\/wiki\/([^\/]+)/);
        return m ? m[1] : 'default';
    }

    // ─── Constants ──────────────────────────────────────────────
    var DIM_OPACITY  = 0.05;
    var LABEL_NORMAL = 0.8;
    var TAG_COLOR    = '#94a3b8'; // fallback (tag nodes use dominant-category color)

    function colorAlpha(hex, a) {
        var r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }
    function tagLinkStroke(l, a) {
        var src = l.source, tgt = l.target;
        var tn = (src && src.isTag) ? src : (tgt && tgt.isTag) ? tgt : null;
        return tn ? colorAlpha(tn.color, a) : null;
    }

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
        var nodeMap    = {};  // slug → node
        var tagByTitle = {};  // tag title → node
        var nodes      = [];

        searchIndex.forEach(function (page) {
            // 인덱스/카테고리 페이지 제외: /wiki/[단일세그먼트] 형태
            if (page.type === 'wiki' && /^\/wiki\/[^\/]+\/?$/.test(page.url)) return;

            var isTag  = page.type === 'tag';
            var slug   = isTag
                ? '__tag__/' + page.title                              // 태그 고유 키
                : page.url.replace(/^\/(wiki|posts|blog)\//, '');

            var cat = getCategory(page.url, page.type);
            var n = {
                id:     slug,
                slug:   slug,
                title:  page.title,
                url:    page.url,
                type:   page.type || 'wiki',
                cat:    cat,
                tags:   page.tags || [],
                degree: 0,
                isTag:  isTag,
            };
            nodes.push(n);
            nodeMap[slug] = n;
            if (isTag) tagByTitle[page.title] = n;
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

        // related.json 기반 컨텐츠 ↔ 컨텐츠 엣지
        Object.keys(related).forEach(function (src) {
            var sNode = nodeMap[src];
            if (!sNode) return;
            (related[src] || []).forEach(function (rel) { addLink(src, rel.slug); });
        });

        // 컨텐츠 ↔ 태그 엣지 (tags 배열 기반)
        nodes.forEach(function (n) {
            if (n.isTag) return;
            (n.tags || []).forEach(function (tag) {
                var tagNode = tagByTitle[tag];
                if (tagNode) addLink(n.slug, tagNode.slug);
            });
        });

        // ── Category groups & cluster centroids ─────────────────
        var catGroups = {};
        nodes.forEach(function (n) { if (!catGroups[n.cat]) catGroups[n.cat] = []; catGroups[n.cat].push(n); });
        var cats = Object.keys(catGroups).sort(function (a, b) { return catGroups[b].length - catGroups[a].length; });

        // 태그 클러스터는 중앙에, 나머지는 외곽 원에 배치
        var clusterR = Math.min(W, H) * 0.34;
        var catCenters = {};
        var contentCats = cats.filter(function (c) { return c !== '_tag'; });
        contentCats.forEach(function (cat, i) {
            var angle = (i / contentCats.length) * 2 * Math.PI - Math.PI / 2;
            catCenters[cat] = { x: W / 2 + clusterR * Math.cos(angle), y: H / 2 + clusterR * Math.sin(angle) };
        });
        catCenters['_tag'] = { x: W / 2, y: H / 2 }; // 태그 노드는 중앙

        // ── Node radius ─────────────────────────────────────────
        function nodeR(n) {
            if (n.isTag) return Math.max(5, Math.min(14, 4 + Math.sqrt(n.degree) * 2.2));
            var base = 4 + Math.sqrt(n.degree) * 3.2;
            if (n.type === 'blog') base += 2;
            return Math.max(4, Math.min(20, base));
        }

        // ── Simulation ──────────────────────────────────────────
        var sim = d3.forceSimulation(nodes)
            .force('link',      d3.forceLink(links).id(function (d) { return d.id; }).distance(function (l) {
                // 태그-컨텐츠 엣지는 짧게
                var s = l.source.isTag || l.target.isTag;
                return s ? 55 : 85;
            }).strength(0.35))
            .force('charge',    d3.forceManyBody().strength(-200).distanceMax(450))
            .force('collision', d3.forceCollide().radius(function (d) { return nodeR(d) + 10; }))
            .force('clusterX',  d3.forceX().strength(0.15).x(function (d) { return (catCenters[d.cat] || {x: W/2}).x; }))
            .force('clusterY',  d3.forceY().strength(0.15).y(function (d) { return (catCenters[d.cat] || {y: H/2}).y; }));

        // ── Draw layers ─────────────────────────────────────────
        var linkG  = g.append('g');
        var nodeG  = g.append('g');
        var labelG = g.append('g');

        // Links
        var linkEl = linkG.selectAll('line').data(links).join('line')
            .attr('stroke', function (l) { return tagLinkStroke(l, 0.22) || t().link; })
            .attr('stroke-width', 1);

        // Content nodes (circles)
        var contentNodes = nodes.filter(function (n) { return !n.isTag; });
        var tagNodes     = nodes.filter(function (n) { return n.isTag; });

        // 태그 노드 색상: 연결된 컨텐츠 노드의 dominant category 색상
        tagNodes.forEach(function (tn) {
            var catCount = {};
            (adj[tn.slug] || new Set()).forEach(function (nbSlug) {
                var nb = nodeMap[nbSlug];
                if (nb && !nb.isTag) catCount[nb.cat] = (catCount[nb.cat] || 0) + 1;
            });
            var keys = Object.keys(catCount);
            tn.color = keys.length
                ? catColor(keys.reduce(function (a, b) { return catCount[b] > catCount[a] ? b : a; }))
                : TAG_COLOR;
        });

        var contentEl = nodeG.selectAll('circle.content-node').data(contentNodes).join('circle')
            .classed('content-node', true)
            .attr('r', nodeR)
            .attr('fill', function (d) { return catColor(d.cat); })
            .attr('stroke', t().nodeStroke).attr('stroke-width', 1.5)
            .style('cursor', 'pointer');

        // Tag nodes (ring style — color matches dominant connected category)
        var tagEl = nodeG.selectAll('circle.tag-node').data(tagNodes).join('circle')
            .classed('tag-node', true)
            .attr('r', nodeR)
            .attr('fill', 'none')
            .attr('stroke', function (d) { return d.color; }).attr('stroke-width', 2)
            .style('cursor', 'pointer');

        // Combine for shared behavior
        var nodeEl = nodeG.selectAll('circle');

        // Labels
        var labelEl = labelG.selectAll('text').data(nodes).join('text')
            .text(function (d) {
                var tx = d.title.replace(/^[""]|[""]$/g, '');
                return d.isTag ? '#' + tx : (tx.length > 16 ? tx.slice(0, 16) + '…' : tx);
            })
            .attr('font-size', function (d) { return d.isTag ? '8px' : '9px'; })
            .attr('font-family', 'system-ui, -apple-system, sans-serif')
            .attr('fill', function (d) { return d.isTag ? d.color : t().label; })
            .attr('opacity', function (d) { return d.isTag ? 0.7 : LABEL_NORMAL; })
            .attr('dy', 3)
            .style('pointer-events', 'none').style('user-select', 'none');

        // ── Hover interaction ────────────────────────────────────
        var activeSlug = null, resetTimer;

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
                        if (sid === d.slug || tid === d.slug) return d.color || catColor(d.cat);
                        return th.linkDim;
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
                   .attr('fill', function (n) {
                       if (n.slug === d.slug) return th.labelActive;
                       return n.isTag ? n.color : th.label;
                   })
                   .attr('font-size', function (n) { return n.slug === d.slug ? '11px' : (n.isTag ? '8px' : '9px'); });

            var tagList = d.isTag ? [] : d.tags.slice(0, 4).map(function (tx) { return '#' + tx; });
            tooltip.classed('is-visible', true)
                .html('<strong>' + (d.isTag ? '#' : '') + d.title + '</strong><span>' +
                    (d.isTag ? '태그' : d.cat) + ' · ' + d.degree + '개 연결' +
                    (tagList.length ? '<br>' + tagList.join(' ') : '') + '</span>');
        }

        function reset() {
            clearTimeout(resetTimer);
            resetTimer = setTimeout(function () {
                activeSlug = null;
                var th = t();
                nodeEl.attr('opacity', 1).attr('r', nodeR);
                linkEl.attr('stroke', function (l) { return tagLinkStroke(l, 0.22) || th.link; })
                      .attr('stroke-width', 1).attr('opacity', 1);
                labelEl.attr('opacity', function (d) { return d.isTag ? 0.7 : LABEL_NORMAL; })
                       .attr('fill', function (d) { return d.isTag ? d.color : th.label; })
                       .attr('font-size', function (d) { return d.isTag ? '8px' : '9px'; });
                tooltip.classed('is-visible', false);
            }, 80);
        }

        nodeEl
            .on('mouseenter', function (e, d) { highlight(d); tooltip.style('left', (e.clientX + 14) + 'px').style('top', (e.clientY - 10) + 'px'); })
            .on('mousemove',  function (e)    { tooltip.style('left', (e.clientX + 14) + 'px').style('top', (e.clientY - 10) + 'px'); })
            .on('mouseleave', reset)
            .on('click', function (e, d) { window.location.href = d.url; });

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
        var contentCount = nodes.filter(function (n) { return !n.isTag; }).length;
        var tagCount     = tagNodes.length;
        if (statsEl) statsEl.textContent = contentCount + '개 노드 · ' + tagCount + '개 태그 · ' + links.length + '개 연결';

        if (groupsEl) {
            cats.forEach(function (cat) {
                var item = document.createElement('label');
                item.className = 'gp-item';
                var displayName = cat === '_tag' ? '# 태그' : cat;
                item.innerHTML = '<input type="checkbox" checked data-cat="' + cat + '">' +
                    '<span class="gp-dot" style="background:' + catColor(cat) + ';' + (cat === '_tag' ? 'border:2px solid #f0abfc;background:transparent;box-sizing:border-box;' : '') + '"></span>' +
                    '<span class="gp-name">' + displayName + '</span>' +
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
                var q = e.target.value.toLowerCase().trim();
                var th = t();
                if (!q) {
                    nodeEl.attr('opacity', 1).attr('r', nodeR);
                    labelEl.attr('opacity', function (d) { return d.isTag ? 0.7 : LABEL_NORMAL; })
                           .attr('fill', function (d) { return d.isTag ? d.color : th.label; })
                           .attr('font-size', function (d) { return d.isTag ? '8px' : '9px'; });
                    linkEl.attr('opacity', 1);
                    return;
                }
                var matchSlug = function (d) {
                    return d.title.toLowerCase().includes(q) || (d.isTag && ('#' + d.title).includes(q));
                };
                nodeEl.attr('opacity', function (d) { return matchSlug(d) ? 1 : DIM_OPACITY; })
                      .attr('r', function (d) { return matchSlug(d) ? nodeR(d) * 1.4 : nodeR(d); });
                labelEl.attr('opacity', function (d) { return matchSlug(d) ? 1 : 0; })
                       .attr('fill', function (d) { return matchSlug(d) ? th.labelActive : (d.isTag ? d.color : th.label); })
                       .attr('font-size', function (d) { return matchSlug(d) ? '11px' : (d.isTag ? '8px' : '9px'); });
                linkEl.attr('opacity', 0.04);
            });
        }

        // ── Theme switch sync ────────────────────────────────────
        new MutationObserver(function () {
            var th = t();
            applyTheme();
            container.style.background = th.bg;
            contentEl.attr('stroke', th.nodeStroke);
            linkEl.attr('stroke', function (l) { return tagLinkStroke(l, 0.22) || th.link; });
            labelEl.attr('fill', function (d) { return d.isTag ? d.color : th.label; });
        }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

        window.addEventListener('resize', function () {
            W = container.clientWidth; H = container.clientHeight;
            svg.attr('width', W).attr('height', H);
            svg.select('rect').attr('width', W).attr('height', H);
        });

    }).catch(function (e) { console.error('graph error:', e); });
})();
