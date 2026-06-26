(function () {
    'use strict';

    var nameEl = document.getElementById('thisName');
    if (!nameEl || typeof d3 === 'undefined') return;

    var currentSlug = nameEl.value;
    if (!currentSlug) return;

    var container = document.getElementById('concept-mini-graph');
    if (!container) return;

    // ── Theme ────────────────────────────────────────────────────
    function isDark() { return document.documentElement.classList.contains('dark-mode'); }
    var THEME = {
        dark:  { link: 'rgba(102,157,253,0.22)', nodeStroke: '#1e1f22', label: '#94a3b8', labelActive: '#e2e8f0' },
        light: { link: 'rgba(59,130,246,0.20)',  nodeStroke: '#f8fafc', label: '#64748b', labelActive: '#1e3a8a' },
    };
    function th() { return isDark() ? THEME.dark : THEME.light; }

    var COLOR_CURRENT  = '#669DFD';
    var COLOR_NODE     = '#3b82f6';
    var COLOR_NODE_DIM = '#93c5fd';

    // ── Tooltip ──────────────────────────────────────────────────
    var tip = d3.select(document.body).append('div').attr('class', 'graph-tooltip');
    function hideTip() { tip.classed('is-visible', false); }

    // ── Load data ────────────────────────────────────────────────
    Promise.all([
        fetch('/data/ontology-graph.json').then(function (r) { return r.json(); }),
        fetch('/data/summaries.json').then(function (r) { return r.json(); }).catch(function () { return {}; }),
        fetch('/data/related.json').then(function (r) { return r.json(); }).catch(function () { return {}; }),
    ]).then(function (results) {
        var graph       = results[0];
        var summaries   = results[1];
        var relatedData = results[2];

        // URL 생성 (knowledge-graph-3d.js와 동일 로직)
        var TYPE_URL_PREFIX = {
            concept: '/concept/', insight: '/insight/', problem: '/problem/',
            tool: '/tool/', event: '/event/', adr: '/adr/'
        };
        function buildNodeUrl(n) {
            if (n.url) return n.url;
            var prefix = TYPE_URL_PREFIX[n.type] || '/concept/';
            return prefix + n.id.replace(/^[^\/]+\//, '') + '/';
        }

        // ── 현재 페이지 제목/URL (폴백에서도 공통 사용) ──────────
        var selfTitle = (function () {
            var h1 = document.querySelector('h1');
            if (h1) return h1.textContent.trim();
            return document.title.split(' - ')[0].trim() || currentSlug;
        })();

        // ── 노드/링크 공유 변수 ────────────────────────────────────
        var nodeMap = {}, nodes = [], seen = new Set(), links = [], adj = {};
        var scoreByNodeId = {};

        function addLink(aId, bId, score, relType) {
            var key = [aId, bId].sort().join('|||');
            if (seen.has(key)) return;
            if (!nodeMap[aId] || !nodeMap[bId]) return;
            seen.add(key);
            links.push({ source: aId, target: bId, score: score, relType: relType });
            nodeMap[aId].degree++;
            nodeMap[bId].degree++;
            if (!adj[aId]) adj[aId] = new Set();
            if (!adj[bId]) adj[bId] = new Set();
            adj[aId].add(bId);
            adj[bId].add(aId);
        }

        // ── 온톨로지 경로 ─────────────────────────────────────────
        var focalNode = (graph.nodes || {})[currentSlug] ||
            Object.values(graph.nodes || {}).find(function (n) {
                return n && n.id && n.id.replace(/^[^\/]+\//, '') === currentSlug;
            });
        var directEdges = focalNode
            ? (graph.edges || []).filter(function (e) {
                return e.from === focalNode.id || e.to === focalNode.id;
              })
            : [];

        if (focalNode && directEdges.length > 0) {
            // ── 온톨로지 기반 ─────────────────────────────────────
            var focalId = focalNode.id;
            var selfUrl = focalNode.url || window.location.pathname;

            directEdges.forEach(function (e) {
                var otherId = e.from === focalId ? e.to : e.from;
                scoreByNodeId[otherId] = e.weight !== undefined ? e.weight : 0.5;
            });

            var selfNode = { id: focalId, slug: focalId, title: selfTitle, url: selfUrl, isCurrent: true, degree: 0 };
            nodeMap[focalId] = selfNode;
            nodes.push(selfNode);

            directEdges.forEach(function (e) {
                var otherId = e.from === focalId ? e.to : e.from;
                if (nodeMap[otherId]) return;
                var n = (graph.nodes || {})[otherId];
                if (!n) return;
                nodeMap[otherId] = { id: otherId, slug: otherId, title: n.title || otherId, url: buildNodeUrl(n), isCurrent: false, degree: 0 };
                nodes.push(nodeMap[otherId]);
            });

            (graph.edges || []).forEach(function (e) {
                if (nodeMap[e.from] && nodeMap[e.to]) {
                    addLink(e.from, e.to, e.weight !== undefined ? e.weight : 0.5, e.type);
                }
            });
        } else {
            // ── related.json 폴백 ─────────────────────────────────
            var relatedItems = relatedData[currentSlug] || [];
            if (!relatedItems.length) { hideGraph(); return; }

            var selfNode = { id: currentSlug, slug: currentSlug, title: selfTitle, url: window.location.pathname, isCurrent: true, degree: 0 };
            nodeMap[currentSlug] = selfNode;
            nodes.push(selfNode);

            relatedItems.forEach(function (r) {
                if (nodeMap[r.slug]) return;
                nodeMap[r.slug] = { id: r.slug, slug: r.slug, title: r.title, url: r.url, isCurrent: false, degree: 0 };
                nodes.push(nodeMap[r.slug]);
                scoreByNodeId[r.slug] = r.score || 0.5;
            });

            relatedItems.forEach(function (r) {
                addLink(currentSlug, r.slug, r.score || 0.5, null);
            });
        }

        if (nodes.length < 2) { hideGraph(); return; }

        // ── SVG setup ────────────────────────────────────────────
        var W = container.clientWidth || 600;
        var H = 240;
        container.style.width = '100%';
        container.style.height = H + 'px';

        var svg = d3.select(container).append('svg')
            .attr('width', '100%').attr('height', H)
            .style('cursor', 'grab');

        var defs = svg.append('defs');
        var glowF = defs.append('filter').attr('id', 'mg-glow')
            .attr('x', '-60%').attr('y', '-60%').attr('width', '220%').attr('height', '220%');
        glowF.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', 2.5).attr('result', 'blur');
        var fmg = glowF.append('feMerge');
        fmg.append('feMergeNode').attr('in', 'blur');
        fmg.append('feMergeNode').attr('in', 'SourceGraphic');

        var g = svg.append('g');

        var zoom = d3.zoom()
            .scaleExtent([0.4, 3])
            .translateExtent([[-W * 0.4, -H * 0.4], [W * 1.4, H * 1.4]])
            .on('zoom', function (e) {
                g.attr('transform', e.transform);
                svg.style('cursor', e.sourceEvent && e.sourceEvent.buttons ? 'grabbing' : 'grab');
            });
        svg.call(zoom).on('dblclick.zoom', null);

        function nodeR(n) {
            var base = n.isCurrent ? 12 : 6 + Math.sqrt(n.degree) * 2;
            return Math.max(5, Math.min(n.isCurrent ? 15 : 12, base));
        }

        // ── Wave float animation ─────────────────────────────────
        var WAVE_AMP    = 2.5;
        var WAVE_PERIOD = 4000;
        var _waveNow    = 0;
        nodes.forEach(function (n, i) {
            n._wavePhaseX = (i / nodes.length) * Math.PI * 2;
            n._wavePhaseY = (i / nodes.length) * Math.PI * 2 + Math.PI * 0.5;
        });
        function waveOff(n) {
            if (n.isCurrent) return { x: 0, y: 0 };
            var t2 = _waveNow / WAVE_PERIOD * 2 * Math.PI;
            return {
                x: Math.sin(t2 + n._wavePhaseX) * WAVE_AMP * 0.5,
                y: Math.sin(t2 + n._wavePhaseY) * WAVE_AMP,
            };
        }

        // ── Simulation ───────────────────────────────────────────
        var FLOAT_ALPHA = 0.005;
        var sim = d3.forceSimulation(nodes)
            .force('link',      d3.forceLink(links).id(function (d) { return d.id; }).distance(90).strength(0.3))
            .force('charge',    d3.forceManyBody().strength(-280).distanceMax(400))
            .force('collision', d3.forceCollide().radius(function (d) { return nodeR(d) + 14; }))
            .force('centerX',   d3.forceX(W / 2).strength(0.04))
            .force('centerY',   d3.forceY(H / 2).strength(0.05))
            .alphaDecay(0.015)
            .alphaTarget(FLOAT_ALPHA);

        var cur = nodeMap[currentSlug];
        if (cur) { cur.fx = W / 2; cur.fy = H / 2; }

        // ── Curved links ─────────────────────────────────────────
        var linkEl = g.selectAll('path.mg-link').data(links).join('path')
            .attr('class', 'mg-link').attr('fill', 'none')
            .attr('stroke', th().link).attr('stroke-width', 0.9);

        var linkScoreEl = g.selectAll('text.mg-link-score').data(links).join('text')
            .attr('class', 'mg-link-score')
            .text(function (d) { return d.relType || (d.score !== undefined ? d.score.toFixed(2) : ''); })
            .attr('font-size', '8px')
            .attr('font-family', 'system-ui,-apple-system,sans-serif')
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .attr('fill', th().label)
            .attr('stroke', isDark() ? '#0d1117' : '#f8fafc')
            .attr('stroke-width', 2.5)
            .style('paint-order', 'stroke fill')
            .attr('opacity', 0)
            .style('pointer-events', 'none').style('user-select', 'none');

        function lp(d) {
            var sx = d.source.x || 0, sy = d.source.y || 0;
            var tx = d.target.x || 0, ty = d.target.y || 0;
            var mx = (sx + tx) / 2, my = (sy + ty) / 2;
            var dx = tx - sx, dy = ty - sy, len = Math.sqrt(dx*dx + dy*dy) || 1;
            var c = Math.min(len * 0.18, 16);
            return 'M' + sx.toFixed(1) + ',' + sy.toFixed(1) +
                   ' Q' + (mx - dy/len*c).toFixed(1) + ',' + (my + dx/len*c).toFixed(1) +
                   ' ' + tx.toFixed(1) + ',' + ty.toFixed(1);
        }

        // ── Halos ────────────────────────────────────────────────
        var haloEl = g.selectAll('circle.mg-halo').data(nodes).join('circle')
            .attr('class', 'mg-halo')
            .attr('r', function (d) { return nodeR(d) * (d.isCurrent ? 2.5 : 1.8); })
            .attr('fill', function (d) { return d.isCurrent ? COLOR_CURRENT : COLOR_NODE; })
            .attr('opacity', function (d) { return d.isCurrent ? 0.25 : 0.08; })
            .style('pointer-events', 'none');

        // ── Nodes ────────────────────────────────────────────────
        var nodeEl = g.selectAll('circle.mg-node').data(nodes).join('circle')
            .attr('class', 'mg-node')
            .attr('r', nodeR)
            .attr('fill', function (d) { return d.isCurrent ? COLOR_CURRENT : COLOR_NODE_DIM; })
            .attr('stroke', function (d) { return d.isCurrent ? COLOR_CURRENT : COLOR_NODE; })
            .attr('stroke-width', function (d) { return d.isCurrent ? 2.5 : 1.2; })
            .attr('filter', 'url(#mg-glow)')
            .attr('opacity', function (d) { return d.isCurrent ? 1 : 0.8; })
            .style('cursor', 'pointer');

        var labelEl = g.selectAll('text.mg-label').data(nodes).join('text')
            .attr('class', 'mg-label')
            .text(function (d) {
                var tx = d.title.replace(/^[""„‟]|[""„‟]$/g, '');
                return tx.length > 12 ? tx.slice(0, 12) + '…' : tx;
            })
            .attr('font-size', function (d) { return d.isCurrent ? '11px' : '10px'; })
            .attr('font-weight', function (d) { return d.isCurrent ? '700' : '400'; })
            .attr('font-family', 'system-ui,-apple-system,sans-serif')
            .attr('fill', function (d) { return d.isCurrent ? th().labelActive : th().label; })
            .attr('dy', 3)
            .style('pointer-events', 'none').style('user-select', 'none');

        // ── Drag ─────────────────────────────────────────────────
        function getConnectedNodes(startSlug) {
            var visited = new Set(), queue = [startSlug];
            while (queue.length) {
                var slug = queue.shift();
                if (visited.has(slug)) continue;
                visited.add(slug);
                (adj[slug] || new Set()).forEach(function (n) { if (!visited.has(n)) queue.push(n); });
            }
            visited.delete(startSlug);
            return visited;
        }

        nodeEl.call(d3.drag()
            .on('start', function (e, d) {
                e.sourceEvent.stopPropagation();
                if (!e.active) sim.alphaTarget(0.3).restart();
                d.fx = d.x; d.fy = d.y;
                d._dragGroup = getConnectedNodes(d.slug);
                d._dragGroup.forEach(function (nSlug) {
                    var nb = nodeMap[nSlug];
                    if (nb) { nb.fx = null; nb.fy = null; }
                });
                sim.force('charge').strength(0);
                sim.force('centerX').strength(0.015);
                sim.force('centerY').strength(0.02);
                sim.force('link').strength(0.9);
            })
            .on('drag', function (e, d) {
                /* 노드가 그래프 영역을 크게 벗어나지 않도록 클램프 */
                d.fx = Math.max(-W * 0.15, Math.min(W * 1.15, e.x));
                d.fy = Math.max(-H * 0.15, Math.min(H * 1.15, e.y));
            })
            .on('end',   function (e, d) {
                if (!e.active) sim.alphaTarget(FLOAT_ALPHA);
                if (!d.isCurrent) { d.fx = null; d.fy = null; }
                sim.force('charge').strength(-280);
                sim.force('centerX').strength(0.04);
                sim.force('centerY').strength(0.05);
                sim.force('link').strength(0.3);
                d._dragGroup = null;
            })
        );

        // ── Tooltip positioning (clamped to container, avoids nodes) ─
        function positionTip(n) {
            var tr   = d3.zoomTransform(svg.node());
            var rect = container.getBoundingClientRect();
            var wo   = waveOff(n);
            var cx   = tr.applyX(n.x + wo.x) + rect.left;
            var cy   = tr.applyY(n.y + wo.y) + rect.top;
            var tipW = tip.node().offsetWidth  || 240;
            var tipH = tip.node().offsetHeight || 80;
            var pad  = 6;
            var gap  = Math.max(10, nodeR(n) * tr.k + 4);

            var minL = rect.left + pad, maxL = rect.right  - tipW - pad;
            var minT = rect.top  + pad, maxT = rect.bottom - tipH - pad;

            // 모든 노드의 화면 위치 수집
            var nodePositions = nodes.map(function (nd) {
                var nwo = waveOff(nd);
                return {
                    x: tr.applyX(nd.x + nwo.x) + rect.left,
                    y: tr.applyY(nd.y + nwo.y) + rect.top,
                    r: nodeR(nd) * tr.k,
                };
            });

            function overlapsAnyNode(l, t) {
                for (var i = 0; i < nodePositions.length; i++) {
                    var p = nodePositions[i];
                    var clx = Math.max(l, Math.min(p.x, l + tipW));
                    var cly = Math.max(t, Math.min(p.y, t + tipH));
                    var dx = p.x - clx, dy = p.y - cly;
                    if (dx * dx + dy * dy < p.r * p.r) return true;
                }
                return false;
            }

            var candidates = [
                { l: cx + gap,        tp: cy - tipH / 2 },
                { l: cx - tipW - gap, tp: cy - tipH / 2 },
                { l: cx - tipW / 2,   tp: cy + gap       },
                { l: cx - tipW / 2,   tp: cy - tipH - gap },
            ];

            var best = null;
            for (var i = 0; i < candidates.length; i++) {
                var cl = Math.max(minL, Math.min(candidates[i].l,  maxL));
                var ct = Math.max(minT, Math.min(candidates[i].tp, maxT));
                if (!overlapsAnyNode(cl, ct)) { best = { l: cl, t: ct }; break; }
                if (!best) best = { l: cl, t: ct };
            }
            tip.style('left', best.l + 'px').style('top', best.t + 'px').style('transform', 'none');
        }

        // ── Hover & click ────────────────────────────────────────
        var activeSlug = null, pinnedSlug = null;

        function highlightNode(d) {
            var neighbors = adj[d.slug] || new Set();
            function isHighlighted(slug) { return slug === d.slug || neighbors.has(slug); }
            function isConnected(l) {
                var s = l.source.slug || l.source, tgt = l.target.slug || l.target;
                return isHighlighted(s) && isHighlighted(tgt);
            }
            function isDirectLink(l) {
                var s = l.source.slug || l.source, tgt = l.target.slug || l.target;
                return s === d.slug || tgt === d.slug;
            }

            nodeEl.attr('opacity', function (n) {
                return isHighlighted(n.slug) ? 1 : 0.25;
            });
            haloEl.attr('opacity', function (n) {
                return n.slug === d.slug ? 0.28 : neighbors.has(n.slug) ? 0.12 : 0.03;
            });
            linkEl
                .attr('opacity', function (l) { return isConnected(l) ? 1 : 0.05; })
                .attr('stroke', function (l) { return isDirectLink(l) ? COLOR_CURRENT : th().link; })
                .attr('stroke-width', function (l) { return isDirectLink(l) ? 1.8 : 0.9; });
            linkScoreEl
                .attr('opacity', function (l) { return isDirectLink(l) ? 1 : 0; })
                .attr('fill', COLOR_CURRENT);
        }

        function resetHighlight() {
            nodeEl.attr('opacity', function (d) { return d.isCurrent ? 1 : 0.8; });
            haloEl.attr('opacity', function (d) { return d.isCurrent ? 0.25 : 0.08; });
            linkEl.attr('stroke', th().link).attr('stroke-width', 0.9).attr('opacity', 1);
            linkScoreEl.attr('opacity', 0);
        }

        function pinNode(d, summaries, scoreByNodeId) {
            pinnedSlug = d.slug;
            activeSlug = d.slug;
            highlightNode(d);

            var cleanTitle = d.title.replace(/^[""„‟]|[""„‟]$/g, '');
            var score = !d.isCurrent ? scoreByNodeId[d.slug] : undefined;
            var scoreHtml = score !== undefined
                ? '<div class="kg-tip-summary">가중치 <b>' + score.toFixed(2) + '</b></div>'
                : '';
            var sum = (summaries[d.slug] || summaries[d.id] || '').trim();
            var sumHtml = sum
                ? '<div class="kg-tip-summary">' + sum.slice(0, 120) + (sum.length > 120 ? '…' : '') + '</div>'
                : '';
            tip.html('<strong>' + cleanTitle + '</strong>' + scoreHtml + sumHtml)
               .classed('is-visible', true);
            positionTip(d);
        }

        nodeEl
            .on('mouseenter', function (e, d) { if (!pinnedSlug) highlightNode(d); })
            .on('mouseleave', function (e, d) { if (!pinnedSlug) resetHighlight(); })
            .on('click', function (e, d) {
                e.stopPropagation();
                if (pinnedSlug === d.slug) {
                    if (!d.isCurrent) window.location.href = d.url;
                } else {
                    pinNode(d, summaries, scoreByNodeId);
                }
            });

        document.addEventListener('click', function () {
            if (pinnedSlug) { hideTip(); pinnedSlug = null; activeSlug = null; resetHighlight(); }
        });

        // ── Tick ─────────────────────────────────────────────────
        function mgLinkMid(d) {
            var so = waveOff(d.source), to2 = waveOff(d.target);
            var sx = (d.source.x || 0) + so.x, sy = (d.source.y || 0) + so.y;
            var ex = (d.target.x || 0) + to2.x, ey = (d.target.y || 0) + to2.y;
            var mx = (sx + ex) / 2, my = (sy + ey) / 2;
            var dx = ex - sx, dy = ey - sy, len = Math.sqrt(dx*dx + dy*dy) || 1;
            var c = Math.min(len * 0.18, 16);
            return { x: mx - dy / len * c * 0.5, y: my + dx / len * c * 0.5 };
        }

        sim.on('tick', function () {
            _waveNow = performance.now();

            if (pinnedSlug && nodeMap[pinnedSlug]) positionTip(nodeMap[pinnedSlug]);

            linkEl.attr('d', function (d) {
                var so = waveOff(d.source), to2 = waveOff(d.target);
                var sx = (d.source.x || 0) + so.x, sy = (d.source.y || 0) + so.y;
                var tx = (d.target.x || 0) + to2.x, ty = (d.target.y || 0) + to2.y;
                var mx = (sx + tx) / 2, my = (sy + ty) / 2;
                var dx = tx - sx, dy = ty - sy, len = Math.sqrt(dx*dx + dy*dy) || 1;
                var c = Math.min(len * 0.18, 16);
                return 'M' + sx.toFixed(1) + ',' + sy.toFixed(1) +
                       ' Q' + (mx - dy/len*c).toFixed(1) + ',' + (my + dx/len*c).toFixed(1) +
                       ' ' + tx.toFixed(1) + ',' + ty.toFixed(1);
            });
            linkScoreEl
                .attr('x', function (d) { return mgLinkMid(d).x; })
                .attr('y', function (d) { return mgLinkMid(d).y; });
            haloEl.attr('cx', function (d) { var o = waveOff(d); return d.x + o.x; })
                  .attr('cy', function (d) { var o = waveOff(d); return d.y + o.y; });
            nodeEl.attr('cx', function (d) { var o = waveOff(d); return d.x + o.x; })
                  .attr('cy', function (d) { var o = waveOff(d); return d.y + o.y; });
            labelEl
                .attr('x', function (d) { var o = waveOff(d); return d.x + o.x + nodeR(d) + 3; })
                .attr('y', function (d) { var o = waveOff(d); return d.y + o.y; });
        });

        // ── Theme sync ───────────────────────────────────────────
        new MutationObserver(function () {
            var t = th();
            linkEl.attr('stroke', t.link);
            nodeEl.attr('stroke', function (d) { return d.isCurrent ? COLOR_CURRENT : COLOR_NODE; });
            labelEl.attr('fill', function (d) { return d.isCurrent ? t.labelActive : t.label; });
        }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    }).catch(function () { hideGraph(); });

    function hideGraph() {
        var wrap = document.getElementById('concept-mini-graph-wrap');
        if (wrap) wrap.style.display = 'none';
    }
})();
