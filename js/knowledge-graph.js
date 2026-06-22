(function () {
    'use strict';

    // ─── Shared constants ───────────────────────────────────────
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
        'llm':               '#818cf8',
    };
    var DEFAULT_COLOR = '#64748b';
    function catColor(cat) { return CAT_COLOR[cat] || DEFAULT_COLOR; }

    function getCategory(url, type) {
        if (type === 'blog') return 'blog';
        var m = url.match(/^\/wiki\/([^\/]+)/);
        return m ? m[1] : 'default';
    }

    var DIM_OPACITY  = 0.05;
    var LABEL_NORMAL = 0.8;

    // ─── Main init ───────────────────────────────────────────────
    function initKnowledgeGraph(opts) {
        opts = opts || {};
        var container = opts.container || document.getElementById('knowledge-graph');
        if (!container || typeof d3 === 'undefined') return;

        var W = container.clientWidth;
        var H = container.clientHeight;

        // Unique IDs per instance to avoid SVG filter conflicts
        var uid = container.id || ('kg-' + (window._kgUidSeq = (window._kgUidSeq || 0) + 1));
        var bgGradId       = 'bg-grad-' + uid;
        var glowId         = 'node-glow-' + uid;
        var glowActiveId   = 'node-glow-active-' + uid;

        // ─── SVG + background ───────────────────────────────────────
        var svg = d3.select(container).append('svg').attr('width', W).attr('height', H);
        var defs = svg.append('defs');

        var grad = defs.append('radialGradient').attr('id', bgGradId).attr('cx', '50%').attr('cy', '50%').attr('r', '65%');
        var gradStop0 = grad.append('stop').attr('offset', '0%').attr('stop-opacity', 0.5);
        var gradStop1 = grad.append('stop').attr('offset', '100%').attr('stop-opacity', 0);

        var glowFilter = defs.append('filter').attr('id', glowId)
            .attr('x', '-60%').attr('y', '-60%').attr('width', '220%').attr('height', '220%');
        glowFilter.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', 2.5).attr('result', 'blur');
        var fm1 = glowFilter.append('feMerge');
        fm1.append('feMergeNode').attr('in', 'blur');
        fm1.append('feMergeNode').attr('in', 'SourceGraphic');

        var glowActive = defs.append('filter').attr('id', glowActiveId)
            .attr('x', '-80%').attr('y', '-80%').attr('width', '260%').attr('height', '260%');
        glowActive.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', 5).attr('result', 'blur');
        var fm2 = glowActive.append('feMerge');
        fm2.append('feMergeNode').attr('in', 'blur');
        fm2.append('feMergeNode').attr('in', 'SourceGraphic');

        svg.append('rect').attr('width', W).attr('height', H).attr('fill', 'url(#' + bgGradId + ')');

        function applyTheme() {
            var th = t();
            container.style.background = th.bg;
            gradStop0.attr('stop-color', th.bgGrad);
            gradStop1.attr('stop-color', th.bg);
        }
        applyTheme();

        var g = svg.append('g');
        var zoom = d3.zoom().scaleExtent([0.04, 10]).on('zoom', function (e) { g.attr('transform', e.transform); });
        svg.call(zoom);
        // 초기 transform은 zoomToFit이 자동 처리

        // ─── Tooltip ────────────────────────────────────────────────
        var tooltip = d3.select(document.body).append('div').attr('class', 'graph-tooltip');

        // ─── Panel refs ─────────────────────────────────────────────
        var panel      = opts.panel !== undefined ? opts.panel : document.getElementById('graph-panel');
        var searchEl   = opts.search  !== undefined ? opts.search  : (panel && panel.querySelector('#graph-search'));
        var groupsEl   = opts.groups  !== undefined ? opts.groups  : (panel && panel.querySelector('#graph-groups'));
        var statsEl    = opts.stats   !== undefined ? opts.stats   : (panel && panel.querySelector('#graph-stats'));
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
                if (page.type === 'tag') return;
                if (page.type === 'wiki' && /^\/wiki\/[^\/]+\/?$/.test(page.url)) return;

                var slug = page.url.replace(/^\/(wiki|posts|blog)\//, '');
                var cat  = getCategory(page.url, page.type);
                var n = {
                    id: slug, slug: slug, title: page.title,
                    url: page.url, type: page.type || 'wiki',
                    cat: cat, tags: page.tags || [], summary: page.summary || '', degree: 0,
                };
                nodes.push(n);
                nodeMap[slug] = n;
            });

            // ── Build links ─────────────────────────────────────────
            var seen = new Set(), links = [], adj = {};

            function addLink(aSlug, bSlug) {
                var key = [aSlug, bSlug].sort().join('|||');
                if (seen.has(key)) return;
                seen.add(key);
                var an = nodeMap[aSlug], bn = nodeMap[bSlug];
                if (!an || !bn) return;
                links.push({ source: aSlug, target: bSlug });
                an.degree++; bn.degree++;
                if (!adj[aSlug]) adj[aSlug] = new Set();
                if (!adj[bSlug]) adj[bSlug] = new Set();
                adj[aSlug].add(bSlug); adj[bSlug].add(aSlug);
            }

            var scoreMap = {};
            Object.keys(related).forEach(function (src) {
                (related[src] || []).forEach(function (rel) {
                    addLink(src, rel.slug);
                    if (rel.score !== undefined) {
                        var key = [src, rel.slug].sort().join('|||');
                        if (!scoreMap[key]) scoreMap[key] = rel.score;
                    }
                });
            });
            links.forEach(function (l) {
                l.score = scoreMap[[l.source, l.target].sort().join('|||')];
            });

            // ── Category cluster centroids (circular) ───────────────
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

            // ── Wave float animation ────────────────────────────────
            var WAVE_AMP    = 3;
            var WAVE_PERIOD = 4000;
            var _waveNow    = 0;
            nodes.forEach(function (n, i) {
                n._wavePhaseX = (i / nodes.length) * Math.PI * 2;
                n._wavePhaseY = (i / nodes.length) * Math.PI * 2 + Math.PI * 0.5;
            });
            function waveOff(n) {
                var t2 = _waveNow / WAVE_PERIOD * 2 * Math.PI;
                return {
                    x: Math.sin(t2 + n._wavePhaseX) * WAVE_AMP * 0.5,
                    y: Math.sin(t2 + n._wavePhaseY) * WAVE_AMP,
                };
            }

            // ── Simulation ──────────────────────────────────────────
            var FLOAT_ALPHA = 0.005;
            var sim = d3.forceSimulation(nodes)
                .force('link',      d3.forceLink(links).id(function (d) { return d.id; }).distance(85).strength(0.35))
                .force('charge',    d3.forceManyBody().strength(-200).distanceMax(450))
                .force('collision', d3.forceCollide().radius(function (d) { return nodeR(d) + 10; }))
                .force('clusterX',  d3.forceX().strength(0.15).x(function (d) { return (catCenters[d.cat] || { x: W / 2 }).x; }))
                .force('clusterY',  d3.forceY().strength(0.15).y(function (d) { return (catCenters[d.cat] || { y: H / 2 }).y; }))
                .alphaDecay(0.015)
                .alphaTarget(FLOAT_ALPHA)
                .stop();

            // ── Draw layers ─────────────────────────────────────────
            var linkG      = g.append('g');
            var linkLabelG = g.append('g');
            var nodeG      = g.append('g');
            var labelG     = g.append('g');

            var linkEl = linkG.selectAll('path').data(links).join('path')
                .attr('fill', 'none')
                .attr('stroke', t().link)
                .attr('stroke-width', 1);

            var linkLabelEl = linkLabelG.selectAll('text.link-score').data(links).join('text')
                .attr('class', 'link-score')
                .text(function (d) { return d.score !== undefined ? d.score.toFixed(3) : ''; })
                .attr('font-size', '8px')
                .attr('font-family', 'system-ui,-apple-system,sans-serif')
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'middle')
                .attr('fill', t().label)
                .attr('stroke', t().bg)
                .attr('stroke-width', 2.5)
                .style('paint-order', 'stroke fill')
                .attr('opacity', 0)
                .style('pointer-events', 'none').style('user-select', 'none');

            function linkMid(d) {
                var so = waveOff(d.source), to2 = waveOff(d.target);
                var sx = (d.source.x || 0) + so.x, sy = (d.source.y || 0) + so.y;
                var ex = (d.target.x || 0) + to2.x, ey = (d.target.y || 0) + to2.y;
                var mx = (sx + ex) / 2, my = (sy + ey) / 2;
                var dx = ex - sx, dy = ey - sy, len = Math.sqrt(dx*dx + dy*dy) || 1;
                var curve = Math.min(len * 0.18, 22);
                return { x: mx - dy / len * curve * 0.5, y: my + dx / len * curve * 0.5 };
            }

            function linkPath(d) {
                var so = waveOff(d.source), to2 = waveOff(d.target);
                var sx = (d.source.x || 0) + so.x, sy = (d.source.y || 0) + so.y;
                var tx = (d.target.x || 0) + to2.x, ty = (d.target.y || 0) + to2.y;
                var mx = (sx + tx) / 2, my = (sy + ty) / 2;
                var dx = tx - sx, dy = ty - sy;
                var len = Math.sqrt(dx * dx + dy * dy) || 1;
                var curve = Math.min(len * 0.18, 22);
                var cpx = mx - dy / len * curve;
                var cpy = my + dx / len * curve;
                return 'M' + sx.toFixed(1) + ',' + sy.toFixed(1) +
                       ' Q' + cpx.toFixed(1) + ',' + cpy.toFixed(1) +
                       ' ' + tx.toFixed(1) + ',' + ty.toFixed(1);
            }

            var haloEl = nodeG.selectAll('circle.halo').data(nodes).join('circle')
                .attr('class', 'halo')
                .attr('r', function (d) { return nodeR(d) * 2; })
                .attr('fill', function (d) { return catColor(d.cat); })
                .attr('opacity', 0.08)
                .style('pointer-events', 'none');

            var nodeEl = nodeG.selectAll('circle.node').data(nodes).join('circle')
                .attr('class', 'node')
                .attr('r', nodeR)
                .attr('fill', function (d) { return catColor(d.cat); })
                .attr('stroke', t().nodeStroke).attr('stroke-width', 1.5)
                .attr('filter', 'url(#' + glowId + ')')
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
            var activeSlug = null, pinnedSlug = null, resetTimer;
            var isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

            function highlight(d) {
                if (activeSlug === d.slug) return;
                activeSlug = d.slug;
                clearTimeout(resetTimer);
                var neighbors = adj[d.slug] || new Set();
                var th = t();

                haloEl.attr('opacity', function (n) {
                    return n.slug === d.slug ? 0.30 : neighbors.has(n.slug) ? 0.12 : 0.02;
                }).attr('r', function (n) {
                    return n.slug === d.slug ? nodeR(n) * 3 : nodeR(n) * 2;
                });

                nodeEl.attr('opacity', function (n) { return n.slug === d.slug || neighbors.has(n.slug) ? 1 : DIM_OPACITY; })
                      .attr('r', function (n) { return n.slug === d.slug ? nodeR(n) * 1.5 : nodeR(n); })
                      .attr('filter', function (n) { return n.slug === d.slug ? 'url(#' + glowActiveId + ')' : 'url(#' + glowId + ')'; });

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

                linkLabelEl
                    .attr('opacity', function (l) {
                        var sid = l.source.slug || l.source, tid = l.target.slug || l.target;
                        return (sid === d.slug || tid === d.slug) ? 1 : 0;
                    })
                    .attr('fill', function (l) {
                        var sid = l.source.slug || l.source, tid = l.target.slug || l.target;
                        return (sid === d.slug || tid === d.slug) ? catColor(d.cat) : th.label;
                    })
                    .attr('stroke', th.bg);

                var tagList = d.tags.slice(0, 4).map(function (tx) { return '#' + tx; });
                var nScores = [];
                neighbors.forEach(function (nSlug) {
                    var s = scoreMap[[d.slug, nSlug].sort().join('|||')];
                    if (s !== undefined) nScores.push(s);
                });
                var avgScore = nScores.length
                    ? (nScores.reduce(function (a, b) { return a + b; }, 0) / nScores.length)
                    : null;
                var scoreText = avgScore !== null ? ' · avg <b>' + avgScore.toFixed(3) + '</b>' : '';
                tooltip.classed('is-visible', true)
                    .html('<strong>' + d.title + '</strong><span>' +
                        d.cat + ' · ' + d.degree + '개 연결' + scoreText +
                        (tagList.length ? '<br>' + tagList.join(' ') : '') + '</span>');
            }

            function reset() {
                if (pinnedSlug) return;
                clearTimeout(resetTimer);
                resetTimer = setTimeout(function () {
                    activeSlug = null;
                    var th = t();
                    haloEl.attr('opacity', 0.08).attr('r', function (d) { return nodeR(d) * 2; });
                    nodeEl.attr('opacity', 1).attr('r', nodeR).attr('filter', 'url(#' + glowId + ')');
                    linkEl.attr('stroke', th.link).attr('stroke-width', 1).attr('opacity', 1);
                    labelEl.attr('opacity', LABEL_NORMAL).attr('fill', th.label).attr('font-size', '9px');
                    linkLabelEl.attr('opacity', 0);
                    tooltip.classed('is-visible', false);
                }, 80);
            }

            function pinNode(d) {
                pinnedSlug = d.slug;
                clearTimeout(resetTimer);
                activeSlug = null;
                highlight(d);

                var cleanTitle = d.title.replace(/^[""""]|[""""]$/g, '');
                var summaryHtml = d.summary
                    ? '<div class="kg-tip-summary">' + d.summary.slice(0, 100) + (d.summary.length > 100 ? '…' : '') + '</div>'
                    : '';
                tooltip.classed('is-visible', true)
                    .html('<strong>' + cleanTitle + '</strong>' + summaryHtml);

                // Position near the node's actual screen position
                var tr = d3.zoomTransform(svg.node());
                var rect = container.getBoundingClientRect();
                var sx = tr.applyX(d.x) + rect.left;
                var sy = tr.applyY(d.y) + rect.top;
                var tipW = 240;
                var tipH = tooltip.node().offsetHeight || 80;
                var left = sx + 14;
                if (left + tipW > window.innerWidth - 8) left = sx - tipW - 14;
                var top = sy - tipH / 2;
                if (top < 8) top = 8;
                if (top + tipH > window.innerHeight - 8) top = window.innerHeight - tipH - 8;
                tooltip.style('left', left + 'px').style('top', top + 'px').style('transform', 'none');
            }

            nodeEl
                .on('click', function (e, d) {
                    if (pinnedSlug === d.slug) {
                        window.location.href = d.url;
                    } else {
                        e.stopPropagation();
                        pinNode(d);
                    }
                });

            function zoomToFit(duration) {
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
                svg.transition().duration(duration !== undefined ? duration : 500)
                    .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
            }

            svg.on('click', function (e) {
                var tag = e.target.tagName;
                if (tag === 'circle' || tag === 'text') return;
                pinnedSlug = null;
                clearTimeout(resetTimer);
                activeSlug = null;
                var th = t();
                haloEl.attr('opacity', 0.08).attr('r', function (d) { return nodeR(d) * 2; });
                nodeEl.attr('opacity', 1).attr('r', nodeR).attr('filter', 'url(#' + glowId + ')');
                linkEl.attr('stroke', th.link).attr('stroke-width', 1).attr('opacity', 1);
                labelEl.attr('opacity', LABEL_NORMAL).attr('fill', th.label).attr('font-size', '9px');
                linkLabelEl.attr('opacity', 0);
                tooltip.classed('is-visible', false);
                zoomToFit();
            });

            nodeEl.call(d3.drag()
                .on('start', function (e, d) { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
                .on('drag',  function (e, d) { d.fx = e.x; d.fy = e.y; })
                .on('end',   function (e, d) { if (!e.active) sim.alphaTarget(FLOAT_ALPHA); })
            );

            function renderPositions() {
                _waveNow = performance.now();
                linkEl.attr('d', linkPath);
                linkLabelEl
                    .attr('x', function (d) { return linkMid(d).x; })
                    .attr('y', function (d) { return linkMid(d).y; });
                haloEl.attr('cx', function (d) { var o = waveOff(d); return d.x + o.x; })
                      .attr('cy', function (d) { var o = waveOff(d); return d.y + o.y; });
                nodeEl.attr('cx', function (d) { var o = waveOff(d); return d.x + o.x; })
                      .attr('cy', function (d) { var o = waveOff(d); return d.y + o.y; });
                labelEl.attr('x', function (d) { var o = waveOff(d); return d.x + o.x + nodeR(d) + 3; })
                        .attr('y', function (d) { var o = waveOff(d); return d.y + o.y; });
            }

            // 300틱 사전 수렴 후 즉시 fit, 그 다음 gentle float 재시작
            sim.tick(300);
            renderPositions();
            zoomToFit(0);
            sim.on('tick', renderPositions).restart();

            if (statsEl) statsEl.textContent = nodes.length + '개 노드 · ' + links.length + '개 연결';

            if (groupsEl) {
                cats.forEach(function (cat) {
                    var item = document.createElement('label');
                    item.className = 'gp-chip';
                    item.innerHTML = '<input type="checkbox" checked data-cat="' + cat + '" class="gp-chip__input">' +
                        '<span class="gp-chip__dot" style="background:' + catColor(cat) + '"></span>' +
                        '<span class="gp-chip__name">' + cat + '</span>' +
                        '<span class="gp-chip__count">' + catGroups[cat].length + '</span>';
                    groupsEl.appendChild(item);
                    item.querySelector('input').addEventListener('change', function (e) {
                        if (e.target.checked) hiddenCats.delete(cat); else hiddenCats.add(cat);
                        haloEl.attr('display', function (d) { return hiddenCats.has(d.cat) ? 'none' : null; });
                        nodeEl.attr('display', function (d) { return hiddenCats.has(d.cat) ? 'none' : null; });
                        labelEl.attr('display', function (d) { return hiddenCats.has(d.cat) ? 'none' : null; });
                        linkEl.attr('display', function (l) {
                            var sid = l.source.slug || l.source;
                            var tid = l.target.slug || l.target;
                            var sNode = nodeMap[sid] || {};
                            var tNode = nodeMap[tid] || {};
                            return (hiddenCats.has(sNode.cat) || hiddenCats.has(tNode.cat)) ? 'none' : null;
                        });
                    });
                });
            }

            if (searchEl) {
                searchEl.addEventListener('input', function (e) {
                    clearTimeout(resetTimer);
                    activeSlug = null;
                    pinnedSlug = null;
                    var q = e.target.value.toLowerCase().trim();
                    var th = t();
                    if (!q) {
                        haloEl.attr('opacity', 0.08).attr('r', function (d) { return nodeR(d) * 2; });
                        nodeEl.attr('opacity', 1).attr('r', nodeR).attr('filter', 'url(#' + glowId + ')');
                        labelEl.attr('opacity', LABEL_NORMAL).attr('fill', th.label).attr('font-size', '9px');
                        linkEl.attr('stroke', th.link).attr('stroke-width', 1).attr('opacity', 1);
                        tooltip.classed('is-visible', false);
                        return;
                    }
                    var match = function (d) {
                        return d.title.toLowerCase().includes(q) ||
                               d.tags.some(function (tg) { return tg.toLowerCase().includes(q); });
                    };
                    haloEl.attr('opacity', function (d) { return match(d) ? 0.28 : 0.02; });
                    nodeEl.attr('opacity', function (d) { return match(d) ? 1 : DIM_OPACITY; })
                          .attr('r', function (d) { return match(d) ? nodeR(d) * 1.4 : nodeR(d); })
                          .attr('filter', function (d) { return match(d) ? 'url(#' + glowActiveId + ')' : 'url(#' + glowId + ')'; });
                    labelEl.attr('opacity', function (d) { return match(d) ? 1 : 0; })
                           .attr('fill', function (d) { return match(d) ? th.labelActive : th.label; })
                           .attr('font-size', function (d) { return match(d) ? '11px' : '9px'; });
                    linkEl.attr('stroke', th.link).attr('stroke-width', 1).attr('opacity', 0.06);
                });
            }

            new MutationObserver(function () {
                var th = t();
                applyTheme();
                nodeEl.attr('stroke', th.nodeStroke).attr('filter', 'url(#' + glowId + ')');
                linkEl.attr('stroke', th.link);
                labelEl.attr('fill', th.label);
            }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

            window.addEventListener('pageshow', function (e) {
                if (!e.persisted) return;
                nodes.forEach(function (n) { n.fx = null; n.fy = null; });
                activeSlug = null;
                clearTimeout(resetTimer);
                reset();
                sim.alpha(0.1).restart();
            });

            window.addEventListener('resize', function () {
                W = container.clientWidth; H = container.clientHeight;
                svg.attr('width', W).attr('height', H);
                svg.select('rect').attr('width', W).attr('height', H);
            });

            document.addEventListener('click', function (e) {
                if (!pinnedSlug) return;
                if (container.contains(e.target)) return;
                pinnedSlug = null;
                tooltip.classed('is-visible', false);
            });

        }).catch(function (e) { console.error('graph error:', e); });
    }

    // ─── Export ─────────────────────────────────────────────────
    window.KnowledgeGraph = window.KnowledgeGraph || {};
    window.KnowledgeGraph.init = initKnowledgeGraph;

    // Auto-init for standalone graph page (map.html)
    if (document.getElementById('knowledge-graph')) {
        initKnowledgeGraph();
    }
})();
