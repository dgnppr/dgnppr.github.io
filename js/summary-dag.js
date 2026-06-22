/**
 * summary-dag.js — D3 기반 요약 방향 그래프 렌더러
 *
 * 입력: { nodes: [{id, label, type}], edges: [{from, to, label?, bidirectional?}] }
 * type: 'root' | 'step' | 'decision' | 'end'   (없으면 'step')
 * bidirectional: true → 양방향 화살표 (↔)
 */
(function () {
    'use strict';

    var FONT   = "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, sans-serif";
    var FS     = 11.5;
    var NODE_H = 30;
    var HGAP   = 14;
    var VGAP   = 42;
    var PAD_X  = 14;
    var MIN_W  = 64;
    var MAX_W  = 132;
    var MAX_LABEL = 14; // chars per line before wrapping

    // ── Text measurement ──────────────────────────────────────────────────────
    var _mc = (function () {
        try { return document.createElement('canvas').getContext('2d'); } catch (e) { return null; }
    })();
    function tw(text) {
        if (!_mc) return text.length * 7.5;
        _mc.font = FS + 'px ' + FONT;
        return _mc.measureText(text).width;
    }

    // ── Label → 1~2 lines ────────────────────────────────────────────────────
    function wrapLabel(label) {
        label = (label || '').trim();
        if (!label) return [''];
        if (label.length <= MAX_LABEL) return [label];
        // prefer space split near midpoint
        var mid = Math.ceil(label.length / 2);
        var sp  = label.lastIndexOf(' ', mid);
        var cut = (sp > 0) ? sp : mid;
        var l1  = label.substring(0, cut).trim();
        var l2  = label.substring(cut).trim();
        if (l2.length > MAX_LABEL + 1) l2 = l2.substring(0, MAX_LABEL) + '…';
        return [l1, l2];
    }

    // ── Node bounding-box ────────────────────────────────────────────────────
    function boxOf(node) {
        var lines = wrapLabel(node.label);
        var mw    = Math.max.apply(null, lines.map(tw));
        var w     = Math.max(MIN_W, Math.min(MAX_W, mw + PAD_X * 2));
        var h     = lines.length > 1 ? NODE_H + 12 : NODE_H;
        return { lines: lines, w: w, h: h };
    }

    // ── Topological-layer layout ──────────────────────────────────────────────
    function computeLayout(data, cw) {
        var nodes  = JSON.parse(JSON.stringify(data.nodes || []));
        var edges  = (data.edges || []).slice();
        if (!nodes.length) return null;

        nodes.forEach(function (n) {
            var b = boxOf(n);
            n._w = b.w; n._h = b.h; n._lines = b.lines;
        });

        var inDeg = {}, outAdj = {};
        nodes.forEach(function (n) { inDeg[n.id] = 0; outAdj[n.id] = []; });
        edges.forEach(function (e) {
            if (inDeg[e.to]  !== undefined) inDeg[e.to]++;
            if (outAdj[e.from]) outAdj[e.from].push(e.to);
        });

        // longest-path layering (BFS)
        var layer = {};
        var queue = nodes.filter(function (n) { return inDeg[n.id] === 0; }).map(function (n) { return n.id; });
        if (!queue.length) { layer[nodes[0].id] = 0; queue = [nodes[0].id]; }
        queue.forEach(function (id) { if (layer[id] === undefined) layer[id] = 0; });

        for (var qi = 0; qi < queue.length; qi++) {
            var cur = queue[qi];
            (outAdj[cur] || []).forEach(function (nx) {
                var nl = (layer[cur] || 0) + 1;
                if (layer[nx] === undefined) { layer[nx] = nl; queue.push(nx); }
                else if (layer[nx] < nl)       layer[nx] = nl;
            });
        }
        nodes.forEach(function (n) { if (layer[n.id] === undefined) layer[n.id] = 0; });

        var maxL   = Math.max.apply(null, nodes.map(function (n) { return layer[n.id]; }));
        var layers = [];
        for (var i = 0; i <= maxL; i++) layers.push([]);
        nodes.forEach(function (n) { layers[layer[n.id]].push(n); });

        // assign x, y
        var W   = cw || 560;
        var pos = {};
        var cumY = 0;

        layers.forEach(function (ln) {
            var layerH = Math.max.apply(null, ln.map(function (n) { return n._h; }));
            var totalW = ln.reduce(function (s, n) { return s + n._w + HGAP; }, -HGAP);
            var x = Math.max(6, (W - totalW) / 2);
            ln.forEach(function (n) {
                pos[n.id] = { x: x + n._w / 2, y: cumY + layerH / 2 };
                x += n._w + HGAP;
            });
            cumY += layerH + VGAP;
        });

        var svgH = cumY - VGAP + 16;

        return {
            nodes: nodes.map(function (n) { return Object.assign({}, n, pos[n.id]); }),
            edges: edges,
            w: W,
            h: svgH,
        };
    }

    // ── Theme ─────────────────────────────────────────────────────────────────
    function theme() {
        var dark = document.documentElement.classList.contains('dark-mode');
        return dark ? {
            root:     { fill: '#1e3f6e', stroke: '#3b6fad', text: '#dbeafe', r: 99, fw: 600 },
            step:     { fill: '#172540', stroke: '#2e5280', text: '#93c5fd', r: 5,  fw: 400 },
            decision: { fill: '#152038', stroke: '#2a4a72', text: '#7fb3e8', r: 0,  fw: 400 },
            end:      { fill: '#1a3058', stroke: '#4a82b8', text: '#bfdbfe', r: 5,  fw: 500 },
            edge:     '#3b6fad',
            arrow:    '#5590cc',
            edgeAlpha: 0.65,
            edgeLabelBg: '#172540',
        } : {
            root:     { fill: '#1e4080', stroke: '#1e4080', text: '#eff6ff', r: 99, fw: 600 },
            step:     { fill: '#eff6ff', stroke: '#bfdbfe', text: '#1e40af', r: 5,  fw: 400 },
            decision: { fill: '#dbeafe', stroke: '#93c5fd', text: '#1e3a8a', r: 0,  fw: 400 },
            end:      { fill: '#dbeafe', stroke: '#3b82f6', text: '#1e3a8a', r: 5,  fw: 600 },
            edge:     '#93c5fd',
            arrow:    '#3b82f6',
            edgeAlpha: 0.8,
            edgeLabelBg: '#eff6ff',
        };
    }

    // ── Render ────────────────────────────────────────────────────────────────
    function render(container, data) {
        if (typeof d3 === 'undefined') return false;
        if (!data || !(data.nodes || []).length) return false;

        var cw     = container.getBoundingClientRect().width || 560;
        var layout = computeLayout(data, cw);
        if (!layout) return false;

        var t = theme();
        container.innerHTML = '';

        var svg = d3.select(container).append('svg')
            .attr('width', '100%')
            .attr('viewBox', '0 0 ' + layout.w + ' ' + layout.h)
            .style('overflow', 'visible')
            .style('display', 'block')
            .style('font-family', FONT);

        // ── defs ──────────────────────────────────────────────────────────────
        var defs  = svg.append('defs');
        var uid   = Math.random() * 1e6 | 0;
        var mid   = 'dag-a-'  + uid;  // 정방향 화살표 (marker-end)
        var revId = 'dag-ar-' + uid;  // 역방향 화살표 (marker-start, 양방향용)

        defs.append('marker')
            .attr('id', mid)
            .attr('viewBox', '0 0 8 8')
            .attr('refX', 7).attr('refY', 4)
            .attr('markerWidth', 6).attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path').attr('d', 'M0.5,1 L7,4 L0.5,7 Z').attr('fill', t.arrow);

        // 역방향: 팁이 x=1 (왼쪽), refX=1 → 팁이 path start에 위치
        // orient=auto 시 marker +x = 경로 진행 방향 → 팁(-x)이 역방향 = 출발 노드 내부로 ↓
        defs.append('marker')
            .attr('id', revId)
            .attr('viewBox', '0 0 8 8')
            .attr('refX', 1).attr('refY', 4)
            .attr('markerWidth', 6).attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path').attr('d', 'M7.5,1 L1,4 L7.5,7 Z').attr('fill', t.arrow);

        var fid = 'dag-sh-' + (Math.random() * 1e6 | 0);
        var flt = defs.append('filter').attr('id', fid)
            .attr('x', '-20%').attr('y', '-20%').attr('width', '140%').attr('height', '140%');
        flt.append('feDropShadow')
            .attr('dx', 0).attr('dy', 1).attr('stdDeviation', 1.5)
            .attr('flood-opacity', 0.06);

        // ── position map ──────────────────────────────────────────────────────
        var pmap = {};
        layout.nodes.forEach(function (n) { pmap[n.id] = n; });

        // ── edges ─────────────────────────────────────────────────────────────
        var eG = svg.append('g');
        layout.edges.forEach(function (e) {
            var s = pmap[e.from], d = pmap[e.to];
            if (!s || !d) return;

            var bidir = !!e.bidirectional;

            // 양방향 엣지는 출발 쪽에도 화살촉이 생기므로 path 시작점을 5px 더 멀리
            var sx  = s.x, sy = s.y + s._h / 2 + (bidir ? 5 : 0);
            var dx  = d.x, dy = d.y - d._h / 2 - 4;
            var mcy = (sy + dy) / 2;

            var p = eG.append('path')
                .attr('d', 'M' + sx + ',' + sy +
                    ' C' + sx + ',' + mcy +
                    ' ' + dx + ',' + mcy +
                    ' ' + dx + ',' + dy)
                .attr('fill', 'none')
                .attr('stroke', t.edge)
                .attr('stroke-width', bidir ? 1.8 : 1.5)
                .attr('stroke-opacity', t.edgeAlpha)
                .attr('marker-end', 'url(#' + mid + ')');

            if (bidir) {
                p.attr('marker-start', 'url(#' + revId + ')');
            }

            if (e.label) {
                var lw = tw(e.label) + 8;
                var mx = (sx + dx) / 2, my = mcy - 4;
                eG.append('rect')
                    .attr('x', mx - lw / 2).attr('y', my - 9)
                    .attr('width', lw).attr('height', 14).attr('rx', 3)
                    .attr('fill', t.edgeLabelBg)
                    .attr('stroke', t.edge).attr('stroke-width', 0.7).attr('stroke-opacity', 0.35);
                eG.append('text')
                    .attr('x', mx).attr('y', my)
                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                    .attr('font-size', 10).attr('fill', t.edge)
                    .text(e.label);
            }
        });

        // ── nodes ─────────────────────────────────────────────────────────────
        layout.nodes.forEach(function (n) {
            var type  = n.type || 'step';
            var style = t[type] || t.step;
            var hw    = n._w / 2, hh = n._h / 2;

            var g = svg.append('g')
                .attr('transform', 'translate(' + n.x + ',' + n.y + ')');

            if (type === 'decision') {
                g.append('polygon')
                    .attr('points', [
                        '0,' + (-hh),
                        hw + ',0',
                        '0,' + hh,
                        (-hw) + ',0',
                    ].join(' '))
                    .attr('fill', style.fill)
                    .attr('stroke', style.stroke)
                    .attr('stroke-width', 1.2)
                    .attr('filter', 'url(#' + fid + ')');
            } else {
                g.append('rect')
                    .attr('x', -hw).attr('y', -hh)
                    .attr('width', n._w).attr('height', n._h)
                    .attr('rx', style.r !== undefined ? style.r : 6)
                    .attr('fill', style.fill)
                    .attr('stroke', style.stroke)
                    .attr('stroke-width', 1.2)
                    .attr('filter', 'url(#' + fid + ')');
            }

            // text
            if (n._lines.length > 1) {
                var txt = g.append('text').attr('text-anchor', 'middle');
                n._lines.forEach(function (line, i) {
                    txt.append('tspan')
                        .attr('x', 0)
                        .attr('dy', i === 0 ? '-6px' : '13px')
                        .attr('font-size', FS)
                        .attr('fill', style.text)
                        .attr('font-weight', style.fw)
                        .text(line);
                });
            } else {
                g.append('text')
                    .attr('text-anchor', 'middle')
                    .attr('dominant-baseline', 'central')
                    .attr('font-size', FS)
                    .attr('fill', style.text)
                    .attr('font-weight', style.fw)
                    .text(n._lines[0]);
            }
        });

        return true;
    }

    window.SummaryDAG = { render: render };
})();
