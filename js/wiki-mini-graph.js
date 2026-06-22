(function () {
    'use strict';

    var nameEl = document.getElementById('thisName');
    if (!nameEl || typeof d3 === 'undefined') return;

    var currentSlug = nameEl.value;
    if (!currentSlug) return;

    var container = document.getElementById('wiki-mini-graph');
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
    var tip = document.createElement('div');
    tip.style.cssText = [
        'position:fixed', 'z-index:9999', 'pointer-events:none',
        'opacity:0', 'transition:opacity 0.13s ease',
        'background:var(--color-surface)',
        'border:1px solid var(--color-border)',
        'border-radius:8px', 'padding:9px 12px',
        'max-width:220px',
        'box-shadow:0 4px 18px rgba(0,0,0,0.13)',
        'font-family:system-ui,-apple-system,sans-serif',
    ].join(';');
    document.body.appendChild(tip);

    function showTip(e, d, summaries, scoreBySlug) {
        var cleanTitle = d.title.replace(/^[""""]|[""""]$/g, '');
        var score = !d.isCurrent ? scoreBySlug[d.slug] : undefined;
        var scoreHtml = score !== undefined
            ? '<div style="font-size:0.72rem;color:var(--color-text-secondary);margin-top:2px">유사도 <b>' + score.toFixed(3) + '</b></div>'
            : '';
        var sum = (summaries[d.slug] || summaries[d.id] || '').trim();
        var sumHtml = sum
            ? '<div style="font-size:0.73rem;color:var(--color-text-secondary);margin-top:4px;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical">' + sum + '</div>'
            : '';
        tip.innerHTML =
            '<div style="font-size:0.82rem;font-weight:600;color:var(--color-text-heading)">' + cleanTitle + '</div>' +
            scoreHtml +
            sumHtml;
        positionTip(e);
        tip.style.opacity = '1';
    }
    function positionTip(e) {
        var x = Math.min(e.clientX + 14, window.innerWidth - 235);
        var y = e.clientY - 10;
        tip.style.left = x + 'px';
        tip.style.top  = y + 'px';
    }
    function hideTip() { tip.style.opacity = '0'; }

    // ── Load data ────────────────────────────────────────────────
    Promise.all([
        fetch('/data/related.json').then(function (r) { return r.json(); }),
        fetch('/data/summaries.json').then(function (r) { return r.json(); }).catch(function () { return {}; }),
    ]).then(function (results) {
        var related   = results[0];
        var summaries = results[1];

        var relatedEntries = related[currentSlug] || [];
        if (relatedEntries.length === 0) { hideGraph(); return; }

        // slug → score (현재 글 기준)
        var scoreBySlug = {};
        relatedEntries.forEach(function (r) {
            if (r.score !== undefined) scoreBySlug[r.slug] = r.score;
        });
        // related 노드끼리의 cross-score
        relatedEntries.forEach(function (r) {
            (related[r.slug] || []).forEach(function (rr) {
                if (rr.score !== undefined) {
                    var key = [r.slug, rr.slug].sort().join('|||');
                    if (!scoreBySlug[key]) scoreBySlug[key] = rr.score;
                }
            });
        });

        // ── 현재 페이지 제목 ──────────────────────────────────────
        var selfTitle = (function () {
            var h1 = document.querySelector('h1');
            if (h1) return h1.textContent.trim();
            return document.title.split(' - ')[0].trim() || currentSlug;
        })();
        var selfUrl = window.location.pathname;

        // ── 노드 구성: self + related ─────────────────────────────
        var nodeMap = {};
        var nodes = [];

        var selfNode = { id: currentSlug, slug: currentSlug, title: selfTitle, url: selfUrl, isCurrent: true, degree: 0 };
        nodeMap[currentSlug] = selfNode;
        nodes.push(selfNode);

        relatedEntries.forEach(function (r) {
            var n = { id: r.slug, slug: r.slug, title: r.title, url: r.url, isCurrent: false, degree: 0 };
            nodeMap[r.slug] = n;
            nodes.push(n);
        });

        // ── 링크 구성 ─────────────────────────────────────────────
        // self ↔ 각 related 노드
        // related 노드끼리도 related.json에서 교차 확인
        var seen = new Set(), links = [], adj = {};

        function addLink(aSlug, bSlug, score) {
            var key = [aSlug, bSlug].sort().join('|||');
            if (seen.has(key)) return;
            if (!nodeMap[aSlug] || !nodeMap[bSlug]) return;
            seen.add(key);
            links.push({ source: aSlug, target: bSlug, score: score });
            nodeMap[aSlug].degree++;
            nodeMap[bSlug].degree++;
            if (!adj[aSlug]) adj[aSlug] = new Set();
            if (!adj[bSlug]) adj[bSlug] = new Set();
            adj[aSlug].add(bSlug);
            adj[bSlug].add(aSlug);
        }

        // self → related
        relatedEntries.forEach(function (r) { addLink(currentSlug, r.slug, scoreBySlug[r.slug]); });

        // related 노드 간 교차 연결
        relatedEntries.forEach(function (r) {
            var rRelated = related[r.slug] || [];
            rRelated.forEach(function (rr) {
                if (nodeMap[rr.slug]) {
                    var crossKey = [r.slug, rr.slug].sort().join('|||');
                    addLink(r.slug, rr.slug, scoreBySlug[crossKey]);
                }
            });
        });

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
            .text(function (d) { return d.score !== undefined ? d.score.toFixed(3) : ''; })
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
                var tx = d.title.replace(/^[""""]|[""""]$/g, '');
                return tx.length > 12 ? tx.slice(0, 12) + '…' : tx;
            })
            .attr('font-size', function (d) { return d.isCurrent ? '11px' : '10px'; })
            .attr('font-weight', function (d) { return d.isCurrent ? '700' : '400'; })
            .attr('font-family', 'system-ui,-apple-system,sans-serif')
            .attr('fill', function (d) { return d.isCurrent ? th().labelActive : th().label; })
            .attr('dy', 3)
            .style('pointer-events', 'none').style('user-select', 'none');

        // ── Drag ─────────────────────────────────────────────────
        nodeEl.call(d3.drag()
            .on('start', function (e, d) {
                e.sourceEvent.stopPropagation();
                if (!e.active) sim.alphaTarget(0.3).restart();
                d.fx = d.x; d.fy = d.y;
            })
            .on('drag',  function (e, d) { d.fx = e.x; d.fy = e.y; })
            .on('end',   function (e, d) {
                if (!e.active) sim.alphaTarget(FLOAT_ALPHA);
                if (!d.isCurrent) { d.fx = null; d.fy = null; }
            })
        );

        // ── Hover & click ────────────────────────────────────────
        var activeSlug = null;

        function highlightNode(d) {
            nodeEl.attr('opacity', function (n) {
                return n.slug === d.slug || (adj[d.slug] && adj[d.slug].has(n.slug)) ? 1 : 0.25;
            });
            haloEl.attr('opacity', function (n) {
                return n.slug === d.slug ? 0.28 : n.isCurrent ? 0.25 : 0.03;
            });
            linkEl
                .attr('opacity', function (l) {
                    var s = l.source.slug || l.source, tgt = l.target.slug || l.target;
                    return (s === d.slug || tgt === d.slug) ? 1 : 0.05;
                })
                .attr('stroke', function (l) {
                    var s = l.source.slug || l.source, tgt = l.target.slug || l.target;
                    return (s === d.slug || tgt === d.slug) ? COLOR_CURRENT : th().link;
                })
                .attr('stroke-width', function (l) {
                    var s = l.source.slug || l.source, tgt = l.target.slug || l.target;
                    return (s === d.slug || tgt === d.slug) ? 1.8 : 0.9;
                });
            linkScoreEl
                .attr('opacity', function (l) {
                    var s = l.source.slug || l.source, tgt = l.target.slug || l.target;
                    return (s === d.slug || tgt === d.slug) ? 1 : 0;
                })
                .attr('fill', COLOR_CURRENT);
        }

        function resetHighlight() {
            nodeEl.attr('opacity', function (d) { return d.isCurrent ? 1 : 0.8; });
            haloEl.attr('opacity', function (d) { return d.isCurrent ? 0.25 : 0.08; });
            linkEl.attr('stroke', th().link).attr('stroke-width', 0.9).attr('opacity', 1);
            linkScoreEl.attr('opacity', 0);
        }

        nodeEl
            .on('mouseenter', function (e, d) { highlightNode(d); })
            .on('mouseleave', function (e, d) {
                if (activeSlug !== d.slug) resetHighlight();
                else highlightNode(d);
            })
            .on('click', function (e, d) {
                e.stopPropagation();
                if (activeSlug === d.slug) {
                    hideTip();
                    activeSlug = null;
                    resetHighlight();
                    if (!d.isCurrent) window.location.href = d.url;
                } else {
                    activeSlug = d.slug;
                    showTip(e, d, summaries, scoreBySlug);
                    highlightNode(d);
                }
            });

        document.addEventListener('click', function () {
            if (activeSlug) { hideTip(); activeSlug = null; resetHighlight(); }
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
        var wrap = document.getElementById('wiki-mini-graph-wrap');
        if (wrap) wrap.style.display = 'none';
    }
})();
