(function () {
    'use strict';

    var nameEl = document.getElementById('thisName');
    var tagEl  = document.getElementById('thisTag');
    if (!nameEl || typeof d3 === 'undefined') return;

    var currentSlug = nameEl.value;
    // currentTag is the URL category segment (e.g. "springboot", "jpa")
    var currentTag  = (tagEl && tagEl.value) || (function () {
        var parts = window.location.pathname.split('/');
        return parts[2] || '';
    })();
    if (!currentSlug || !currentTag) return;

    var container = document.getElementById('wiki-mini-graph');
    var canvas    = document.getElementById('wiki-mini-graph-canvas');
    var toggle    = document.getElementById('wiki-mini-graph-toggle');
    var chevron   = document.getElementById('wiki-mini-graph-chevron');
    if (!container) return;

    // ── Collapse toggle ──────────────────────────────────────────
    if (toggle) {
        toggle.addEventListener('click', function () {
            var collapsed = canvas.classList.toggle('is-collapsed');
            if (chevron) chevron.classList.toggle('is-collapsed', collapsed);
        });
    }

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

    function showTip(e, d, summaries) {
        var cleanTitle = d.title.replace(/^[""""]|[""""]$/g, '');
        var sum = (summaries[d.slug] || summaries[d.id] || '').trim();
        var sumHtml = sum
            ? '<div style="font-size:0.73rem;color:var(--color-text-secondary);margin-top:4px;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical">' + sum + '</div>'
            : '';
        tip.innerHTML =
            '<div style="font-size:0.82rem;font-weight:600;color:var(--color-text-heading)">' + cleanTitle + '</div>' +
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
        fetch('/data/search-index.json').then(function (r) { return r.json(); }),
        fetch('/data/summaries.json').then(function (r) { return r.json(); }).catch(function () { return {}; }),
    ]).then(function (results) {
        var searchIndex = results[0];
        var summaries   = results[1];

        function isWikiPage(p) {
            if (p.type === 'tag') return false;
            if (!/^\/wiki\//.test(p.url)) return false;
            // Exclude category hub pages (/wiki/{one-segment}) unless it IS the current page
            if (/^\/wiki\/[^\/]+\/?$/.test(p.url) && toSlug(p.url) !== currentSlug) return false;
            return true;
        }
        function toSlug(url) {
            return url.replace(/^\/(wiki|posts|blog)\//, '').replace(/\/$/, '');
        }

        var selfEntry = searchIndex.find(function (p) { return toSlug(p.url) === currentSlug; });
        var selfTags  = selfEntry ? (selfEntry.tags || []) : [];

        // ── Level 1: same URL category ───────────────────────────
        var catNodes = searchIndex.filter(function (p) {
            if (!isWikiPage(p)) return false;
            var m = p.url.match(/^\/wiki\/([^\/]+)/);
            return m && m[1] === currentTag;
        });

        // ── Level 2: shared tags across wiki ─────────────────────
        if (catNodes.length < 2 && selfTags.length > 0) {
            catNodes = searchIndex.filter(function (p) {
                if (!isWikiPage(p)) return false;
                var slug = toSlug(p.url);
                if (slug === currentSlug) return true;
                return (p.tags || []).some(function (t) { return selfTags.indexOf(t) !== -1; });
            }).slice(0, 30);
        }

        // ── Level 3: any wiki pages (last resort) ────────────────
        if (catNodes.length < 2) {
            catNodes = searchIndex.filter(function (p) {
                return isWikiPage(p) && !/^\/wiki\/[^\/]+\/?$/.test(p.url);
            }).slice(0, 20);
            // always include self
            if (selfEntry && !catNodes.some(function (p) { return toSlug(p.url) === currentSlug; })) {
                catNodes.unshift(selfEntry);
            }
        }

        if (catNodes.length < 2) { hideGraph(); return; }

        // ── Build node map ────────────────────────────────────────
        var nodeMap = {};
        var nodes = catNodes.map(function (p) {
            var slug = toSlug(p.url);
            var n = {
                id: slug, slug: slug, title: p.title, url: p.url,
                isCurrent: slug === currentSlug,
                degree: 0,
                tags: Array.isArray(p.tags) ? p.tags : [],
            };
            nodeMap[slug] = n;
            return n;
        });

        // ── Links: shared tags ────────────────────────────────────
        var seen = new Set(), links = [], adj = {};
        for (var i = 0; i < nodes.length; i++) {
            for (var j = i + 1; j < nodes.length; j++) {
                var a = nodes[i], b = nodes[j];
                var shared = a.tags.some(function (t) { return b.tags.indexOf(t) !== -1; });
                if (!shared) continue;
                var key = [a.id, b.id].sort().join('|||');
                if (seen.has(key)) continue;
                seen.add(key);
                links.push({ source: a.id, target: b.id });
                a.degree++; b.degree++;
                if (!adj[a.id]) adj[a.id] = new Set();
                if (!adj[b.id]) adj[b.id] = new Set();
                adj[a.id].add(b.id);
                adj[b.id].add(a.id);
            }
        }

        // ── SVG setup ────────────────────────────────────────────
        var W = container.clientWidth || 600;
        var H = 180;
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
            var base = n.isCurrent ? 9 : 4 + Math.sqrt(n.degree) * 1.6;
            return Math.max(3.5, Math.min(n.isCurrent ? 12 : 9, base));
        }

        // ── Simulation ───────────────────────────────────────────
        var linkDist = links.length > nodes.length * 2 ? 40 : 55;
        var sim = d3.forceSimulation(nodes)
            .force('link',      d3.forceLink(links).id(function (d) { return d.id; }).distance(linkDist).strength(0.35))
            .force('charge',    d3.forceManyBody().strength(-100).distanceMax(200))
            .force('collision', d3.forceCollide().radius(function (d) { return nodeR(d) + 5; }))
            .force('centerX',   d3.forceX(W / 2).strength(0.06))
            .force('centerY',   d3.forceY(H / 2).strength(0.08));

        var cur = nodeMap[currentSlug];
        if (cur) { cur.fx = W / 2; cur.fy = H / 2; }

        // ── Curved links ─────────────────────────────────────────
        var linkEl = g.selectAll('path.mg-link').data(links).join('path')
            .attr('class', 'mg-link').attr('fill', 'none')
            .attr('stroke', th().link).attr('stroke-width', 0.9);

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
            .attr('font-size', function (d) { return d.isCurrent ? '9px' : '8px'; })
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
            .on('end',   function (e, d) { if (!e.active) sim.alphaTarget(0); })
        );

        // ── Hover & click ────────────────────────────────────────
        nodeEl
            .on('mouseenter', function (e, d) {
                showTip(e, d, summaries);
                nodeEl.attr('opacity', function (n) {
                    return n.slug === d.slug || (adj[d.slug] && adj[d.slug].has(n.slug)) ? 1 : 0.25;
                });
                haloEl.attr('opacity', function (n) {
                    return n.slug === d.slug ? 0.28 : n.isCurrent ? 0.25 : 0.03;
                });
                linkEl
                    .attr('opacity', function (l) {
                        var s = l.source.slug || l.source, t = l.target.slug || l.target;
                        return (s === d.slug || t === d.slug) ? 1 : 0.05;
                    })
                    .attr('stroke', function (l) {
                        var s = l.source.slug || l.source, t = l.target.slug || l.target;
                        return (s === d.slug || t === d.slug) ? COLOR_CURRENT : th().link;
                    })
                    .attr('stroke-width', function (l) {
                        var s = l.source.slug || l.source, t = l.target.slug || l.target;
                        return (s === d.slug || t === d.slug) ? 1.8 : 0.9;
                    });
            })
            .on('mousemove', function (e) { positionTip(e); })
            .on('mouseleave', function () {
                hideTip();
                nodeEl.attr('opacity', function (d) { return d.isCurrent ? 1 : 0.8; });
                haloEl.attr('opacity', function (d) { return d.isCurrent ? 0.25 : 0.08; });
                linkEl.attr('stroke', th().link).attr('stroke-width', 0.9).attr('opacity', 1);
            })
            .on('click', function (e, d) {
                if (!d.isCurrent) window.location.href = d.url;
            });

        // ── Tick ─────────────────────────────────────────────────
        sim.on('tick', function () {
            linkEl.attr('d', lp);
            haloEl.attr('cx', function (d) { return d.x; }).attr('cy', function (d) { return d.y; });
            nodeEl.attr('cx', function (d) { return d.x; }).attr('cy', function (d) { return d.y; });
            labelEl
                .attr('x', function (d) { return d.x + nodeR(d) + 3; })
                .attr('y', function (d) { return d.y; });
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
