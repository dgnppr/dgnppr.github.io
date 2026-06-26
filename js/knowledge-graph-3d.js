// knowledge-graph-3d.js — Three.js 3D 지식 그래프
(function () {
    'use strict';

    /* ── 상수 ───────────────────────────────────────────────────── */
    var FLOAT_ALPHA  = 0.005;
    var WAVE_AMP     = 3;
    var WAVE_PERIOD  = 4000;
    var LABEL_NORMAL = 0.8;

    /* ── 동적 색상 시스템 ─────────────────────────────────────────
       entity type → CSS 변수(--color-entity-*)
       wiki 서브카테고리 → 이름 해시 → 팔레트
       테마 전환 시 캐시 초기화로 자동 반영
    ─────────────────────────────────────────────────────────────── */
    var _colorCache = {};
    function _strHash(s) {
        var h = 0;
        for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
        return h;
    }
    /*  colorKey 형식:
     *    "type"               → --color-entity-{type} CSS 변수
     *    "type:subcat"        → type 기준색 + subcat 해시로 hue ±35°, S/L 보정
     *    "type:subcat:file"   → 위에 추가로 file 해시로 hue ±15°, L 미세 보정
     *
     *  다크 배경(#060a14): L 0.55–0.82, S ≥ 0.75 으로 클램프 → 선명한 발광색
     *  라이트 배경(#f8fafc): L 0.38–0.65, S ≥ 0.65 으로 클램프 → 포화된 중간톤
     */
    function catColor(colorKey) {
        if (_colorCache[colorKey] !== undefined) return _colorCache[colorKey];
        var dark = isDark();
        var parts = colorKey.split(':');
        var baseType = parts[0], subcat = parts[1] || '', filename = parts[2] || '';
        var baseCss = getComputedStyle(document.documentElement)
            .getPropertyValue('--color-entity-' + baseType).trim();
        if (baseCss && subcat) {
            var base = new THREE.Color(baseCss);
            var hsl = { h: 0, s: 0, l: 0 };
            base.getHSL(hsl);
            /* Level 2: subcat → hue ±35°, S/L shift */
            var sh = _strHash(subcat);
            hsl.h = (((hsl.h + (((Math.abs(sh) % 15) - 7) * (35 / 360))) % 1) + 1) % 1;
            hsl.s = Math.max(0.65, Math.min(1.0, hsl.s + ((Math.abs(sh >> 6) % 3) - 1) * 0.08));
            hsl.l = hsl.l + ((Math.abs(sh >> 4) % 5) - 2) * 0.05;
            /* Level 3: filename → hue ±15°, L 미세 보정 */
            if (filename) {
                var fh = _strHash(filename);
                hsl.h = (((hsl.h + (((Math.abs(fh) % 7) - 3) * (15 / 360))) % 1) + 1) % 1;
                hsl.l = hsl.l + ((Math.abs(fh >> 3) % 3) - 1) * 0.06;
            }
            /* 배경 대비 클램프 */
            if (dark) {
                hsl.s = Math.max(0.75, hsl.s);
                hsl.l = Math.max(0.55, Math.min(0.82, hsl.l));
            } else {
                hsl.s = Math.max(0.65, hsl.s);
                hsl.l = Math.max(0.38, Math.min(0.65, hsl.l));
            }
            var c = '#' + new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l).getHexString();
            _colorCache[colorKey] = c;
            return c;
        }
        /* type 단독 — CSS 변수 그대로 반환 */
        if (baseCss) { _colorCache[colorKey] = baseCss; return baseCss; }
        /* fallback: 해시 → 고정 팔레트 */
        var FALLBACK = ['#3b82f6', '#8b5cf6', '#ef4444', '#22c55e', '#f97316', '#06b6d4'];
        var fc = FALLBACK[Math.abs(_strHash(colorKey)) % FALLBACK.length];
        _colorCache[colorKey] = fc;
        return fc;
    }
    function isDark() { return document.documentElement.classList.contains('dark-mode'); }
    function themedColor(colorKey) { return new THREE.Color(catColor(colorKey)); }
    /* ── CDN 로드 ───────────────────────────────────────────────── */
    function loadScript(src) {
        return new Promise(function (res, rej) {
            if (document.querySelector('script[src="' + src + '"]')) return res();
            var s = document.createElement('script');
            s.src = src; s.async = false;
            s.onload = res;
            s.onerror = function () { rej(new Error('load failed: ' + src)); };
            document.head.appendChild(s);
        });
    }
    var BASE = 'https://cdn.jsdelivr.net/npm/three@0.128.0';
    var _libsP = null;
    function ensureLibs() {
        if (_libsP) return _libsP;
        _libsP = loadScript(BASE + '/build/three.min.js')
            .then(function () { return loadScript(BASE + '/examples/js/controls/TrackballControls.js'); });
        return _libsP;
    }

    /* ── 글로우 스프라이트 텍스처 ──────────────────────────────── */
    var _glowTex = null;
    function glowTex() {
        if (_glowTex) return _glowTex;
        var cv = document.createElement('canvas'); cv.width = cv.height = 64;
        var ctx = cv.getContext('2d');
        var g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0,   'rgba(255,255,255,1)');
        g.addColorStop(0.4, 'rgba(255,255,255,0.3)');
        g.addColorStop(1,   'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
        _glowTex = new THREE.CanvasTexture(cv);
        return _glowTex;
    }

    /* ── 메인 초기화 ────────────────────────────────────────────── */
    function initGraph(opts) {
        var container = opts.container;
        if (!container || typeof d3 === 'undefined') return;

        var dark      = isDark();
        var bgHex     = dark ? 0x060a14 : 0xf8fafc;
        var bgStr     = dark ? '#060a14' : '#f8fafc';
        var focusSlug = opts.focusSlug || null;
        var miniMode  = opts.miniMode  || false;
        var W = container.clientWidth  || 800;
        var H = container.clientHeight || 500;

        /* ── 데이터 로드 ────────────────────────────────────────── */
        var TYPE_URL_PREFIX = {
            concept: '/wiki/', insight: '/insight/', problem: '/problem/',
            tool: '/tool/', event: '/event/', adr: '/adr/'
        };
        function buildNodeUrl(n) {
            if (n.url) return n.url;
            var prefix = TYPE_URL_PREFIX[n.type] || '/wiki/';
            return prefix + n.id.replace(/^[^\/]+\//, '') + '/';
        }

        Promise.all([
            fetch('/data/ontology-graph.json').then(function (r) { return r.json(); }),
            fetch('/data/related.json').then(function (r) { return r.json(); }).catch(function () { return {}; }),
        ]).then(function (results) {
        var graph = results[0], relatedData = results[1];
            /* ── 노드 빌드 ───────────────────────────────────── */
            var nodeMap = {}, nodes = [];
            Object.values(graph.nodes || {}).forEach(function (n) {
                if (!n || !n.id) return;
                var type     = n.type || 'concept';
                var idParts  = n.id.split('/');
                var subcat   = idParts[1] || '';
                var filename = idParts[2] || '';
                var node = {
                    id: n.id, slug: n.id, title: n.title || n.id,
                    url: buildNodeUrl(n), type: type,
                    cat: type, tags: n.tags || [],
                    colorKey: subcat ? (type + ':' + subcat + (filename ? ':' + filename : '')) : type,
                    summary: n.summary || '', degree: 0,
                };
                nodes.push(node);
                nodeMap[n.id] = node;
            });

            /* focusSlug 모드: 현재 노드 + 직접 연결된 이웃만 표시 */
            if (focusSlug) {
                var allEdges = graph.edges || [];
                /* type-prefix 없는 focusSlug 하위 호환 (e.g. "java/00_virtual_thread") */
                var focalNode = nodeMap[focusSlug] || Object.values(nodeMap).find(function (n) {
                    return n.id.replace(/^[^\/]+\//, '') === focusSlug;
                });
                var focalId = focalNode ? focalNode.id : focusSlug;
                focusSlug = focalId;
                var focalSet = new Set([focalId]);
                allEdges.forEach(function (e) {
                    if (e.from === focalId) focalSet.add(e.to);
                    if (e.to === focalId) focalSet.add(e.from);
                });
                nodes = nodes.filter(function (n) { return focalSet.has(n.id); });
                nodeMap = {};
                nodes.forEach(function (n) { nodeMap[n.id] = n; });
                /* 관련 노드 없으면 related.json 폴백, 그래도 없으면 위젯 숨김 */
                if (nodes.length <= 1) {
                    var rawSlug = opts.focusSlug || '';
                    var relItems = relatedData[rawSlug] || [];
                    if (relItems.length === 0) {
                        var wrap = container.closest('[id$="-wrap"]') || container.parentElement;
                        if (wrap) wrap.style.display = 'none';
                        return;
                    }
                    /* focal 노드가 nodeMap에 없으면 합성 노드 추가 */
                    if (!nodeMap[focalId]) {
                        var fn2 = { id: focalId, slug: focalId,
                            title: document.querySelector('h1') ? document.querySelector('h1').textContent.trim() : rawSlug,
                            url: window.location.pathname, type: 'concept', cat: 'concept',
                            colorKey: 'concept', tags: [], degree: 0 };
                        nodes.push(fn2); nodeMap[focalId] = fn2;
                    }
                    relItems.forEach(function (r) {
                        var rid = r.slug;
                        if (!nodeMap[rid]) {
                            var rn = { id: rid, slug: rid, title: r.title || rid,
                                url: r.url || ('/wiki/' + rid + '/'), type: 'concept', cat: 'concept',
                                colorKey: 'concept', tags: [], degree: 0 };
                            nodes.push(rn); nodeMap[rid] = rn;
                        }
                    });
                }
            }

            /* ── 링크 빌드 ──────────────────────────────────── */
            var seen = new Set(), links = [], adj = {};
            var REL_WEIGHT = {
                extends: 0.85, implements: 0.80, 'part-of': 0.75,
                supersedes: 0.70, motivates: 0.70, 'caused-by': 0.65,
                'learned-from': 0.65, references: 0.60, contradicts: 0.55,
                involves: 0.50, 'used-in': 0.55, related: 0.45,
            };

            function addLink(a, b, relType) {
                var key = [a, b].sort().join('|||');
                if (seen.has(key)) return;
                seen.add(key);
                var an = nodeMap[a], bn = nodeMap[b];
                if (!an || !bn) return;
                links.push({ source: a, target: b,
                    score: REL_WEIGHT[relType] || 0.5, relType: relType });
                an.degree++; bn.degree++;
                if (!adj[a]) adj[a] = new Set();
                if (!adj[b]) adj[b] = new Set();
                adj[a].add(b); adj[b].add(a);
            }
            (graph.edges || []).forEach(function (e) {
                addLink(e.from, e.to, e.type);
            });

            /* focusSlug 폴백: ontology 엣지 없는 미니 그래프에 related.json 엣지 주입 */
            if (focusSlug && links.length === 0) {
                var rawSlug2 = opts.focusSlug || '';
                (relatedData[rawSlug2] || []).forEach(function (r) {
                    addLink(focusSlug, r.slug, 'related');
                });
            }

            /* full 그래프 폴백: 고립 노드(연결 없음)에 related.json 엣지 주입 */
            if (!focusSlug) {
                /* related.json 키(subcat/filename) → 온톨로지 노드 full ID 역매핑 */
                var shortToId = {};
                nodes.forEach(function (n) {
                    shortToId[n.id.replace(/^[^\/]+\//, '')] = n.id;
                });
                nodes.forEach(function (n) {
                    if (n.degree > 0) return;
                    var shortSlug = n.id.replace(/^[^\/]+\//, '');
                    (relatedData[shortSlug] || []).forEach(function (r) {
                        var targetId = shortToId[r.slug] || r.slug;
                        addLink(n.id, targetId, 'related');
                    });
                });
            }

            /* ── 카테고리 클러스터 (2D 방식, 3D 좌표로 변환) ── */
            var catGroups = {};
            nodes.forEach(function (n) {
                if (!catGroups[n.cat]) catGroups[n.cat] = [];
                catGroups[n.cat].push(n);
            });
            var cats = Object.keys(catGroups).sort(function (a, b) {
                return catGroups[b].length - catGroups[a].length;
            });

            /* ── 파도 페이즈 초기값 ────────────────────────── */
            nodes.forEach(function (n, i) {
                n._wavePhaseX = (i / nodes.length) * Math.PI * 2;
                n._wavePhaseY = (i / nodes.length) * Math.PI * 2 + Math.PI * 0.5;
                n._wavePhaseZ = (i / nodes.length) * Math.PI * 2 + Math.PI;
            });

            /* ── 노드 반지름 ─────────────────────────────── */
            function nodeR(n) {
                var base = 4 + Math.sqrt(n.degree) * 3.2;
                if (n.type === 'blog') base += 2;
                return Math.max(4, Math.min(20, base));
            }

            /* ── Three.js 씬 구성 ─────────────────────────── */
            container.style.position = 'relative';
            container.style.backgroundColor = bgStr;
            if (!dark) {
                container.style.backgroundImage = 'radial-gradient(circle, rgba(100,116,139,0.30) 1.2px, transparent 1.2px)';
                container.style.backgroundSize = '28px 28px';
            }
            var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.setSize(W, H);
            renderer.setClearColor(0x000000, 0); /* 투명 — 배경은 CSS로 */
            container.appendChild(renderer.domElement);

            /* 라벨 오버레이 */
            var labelsEl = document.createElement('div');
            labelsEl.style.cssText =
                'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;';
            container.appendChild(labelsEl);

            var scene = new THREE.Scene();
            scene.fog = new THREE.Fog(bgHex, 700, 1800);
            scene.add(new THREE.AmbientLight(0xffffff, 0.35));
            var dLight = new THREE.DirectionalLight(0xffffff, 0.55);
            dLight.position.set(120, 200, 300); scene.add(dLight);

            /* ── 별 파티클 (다크모드 공간감) ────────────── */
            var starPoints = null;
            (function () {
                var count = 800;
                var pos   = new Float32Array(count * 3);
                for (var i = 0; i < count; i++) {
                    /* 구형 분포 — 노드 영역(~300) 바깥, 더 촘촘하게 */
                    var r     = 400 + Math.random() * 700;
                    var theta = Math.random() * Math.PI * 2;
                    var phi   = Math.acos(2 * Math.random() - 1);
                    pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
                    pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
                    pos[i * 3 + 2] = r * Math.cos(phi);
                }
                var geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
                starPoints = new THREE.Points(geo, new THREE.PointsMaterial({
                    color: 0xe0eaff,
                    size: 1.8,
                    sizeAttenuation: true,
                    transparent: true,
                    opacity: dark ? (miniMode ? 0.2 : 0.65) : 0,
                    depthWrite: false,
                }));
                scene.add(starPoints);
            }());

            /* 도트 격자는 CSS background로 처리 (applyTheme에서 갱신) */

            var FOV = 50;
            var camera = new THREE.PerspectiveCamera(FOV, W / H, 1, 2000);
            camera.position.set(60, 90, 370);
            camera.lookAt(0, 0, 0);

            /* ── 노드 메시 생성 ──────────────────────────── */
            var meshes = [], nodeById = {};
            var hiddenCats = new Set();

            nodes.forEach(function (n) {
                var r   = nodeR(n);
                var col = themedColor(n.colorKey || n.cat);

                var isFocal = focusSlug && n.slug === focusSlug;
                var visR = isFocal ? r * 2.2 : r * 1.5;

                var mesh = new THREE.Mesh(
                    new THREE.SphereGeometry(visR, 28, 28),
                    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.06 })
                );
                mesh.position.set(0, 0, n.z);

                /* 테두리: 살짝 큰 BackSide 구체 → 안쪽 면이 테두리로 보임 */
                var borderMesh = new THREE.Mesh(
                    new THREE.SphereGeometry(visR * 1.18, 20, 20),
                    new THREE.MeshBasicMaterial({ color: col, side: THREE.BackSide })
                );
                mesh.add(borderMesh);

                /* halo — 공간감 글로우 (최소한만) */
                var haloMesh = new THREE.Mesh(
                    new THREE.SphereGeometry(visR * 2.4, 14, 14),
                    new THREE.MeshBasicMaterial({
                        color: col, transparent: true, opacity: 0.07, depthWrite: false,
                    })
                );
                haloMesh.renderOrder = -1;
                mesh.add(haloMesh);

                /* 선택 시 강화되는 글로우 스프라이트 */
                var sprite = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: glowTex(), color: col, transparent: true,
                    depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
                }));
                sprite.scale.setScalar(visR * 5);
                mesh.add(sprite);

                /* 라벨 */
                var labelDiv = document.createElement('div');
                var txt = n.title.replace(/^[""]|[""]$/g, '');
                labelDiv.textContent = txt.length > 16 ? txt.slice(0, 16) + '…' : txt;
                labelDiv.style.cssText =
                    'position:absolute;pointer-events:none;white-space:nowrap;' +
                    'font-size:9px;font-family:system-ui,-apple-system,sans-serif;' +
                    'color:' + (dark ? '#94a3b8' : '#475569') + ';' +
                    'text-shadow:0 0 4px ' + bgStr + ',0 0 8px ' + bgStr + ';' +
                    'opacity:' + LABEL_NORMAL + ';';
                labelsEl.appendChild(labelDiv);

                mesh.userData = {
                    node: n, sprite: sprite, haloMesh: haloMesh, borderMesh: borderMesh,
                    labelDiv: labelDiv, r: visR, dimmed: false, selected: false, active: false,
                };
                scene.add(mesh);
                meshes.push(mesh);
                nodeById[n.id] = mesh;
                n._mesh = mesh;
            });

            /* ── 링크 생성 ───────────────────────────────── */
            var linkObjs = [];
            links.forEach(function (l) {
                var sId = l.source, tId = l.target;
                var sm = nodeById[sId], tm = nodeById[tId];
                if (!sm || !tm) return;
                var geo = new THREE.BufferGeometry();
                geo.setAttribute('position',
                    new THREE.Float32BufferAttribute(new Float32Array(6), 3));
                var mat = new THREE.LineBasicMaterial({
                    color: dark ? 0xffffff : 0x334155,
                    transparent: true,
                    opacity: dark ? 0.55 : 0.45,
                });
                var line = new THREE.Line(geo, mat);
                scene.add(line);

                /* 유사도 점수 레이블 */
                var scoreDiv = null;
                if (l.score !== undefined) {
                    scoreDiv = document.createElement('div');
                    scoreDiv.style.cssText =
                        'position:absolute;pointer-events:none;display:none;' +
                        'font-size:8px;font-weight:700;transform:translate(-50%,-50%);' +
                        'padding:1px 5px;border-radius:3px;white-space:nowrap;' +
                        (dark
                            ? 'color:#e2e8f0;background:rgba(13,17,23,0.88);border:1px solid rgba(51,65,85,0.5);'
                            : 'color:#334155;background:rgba(248,250,252,0.88);border:1px solid rgba(226,232,240,0.7);');
                    scoreDiv.textContent = l.relType || l.score.toFixed(2);
                    labelsEl.appendChild(scoreDiv);
                }
                linkObjs.push({ sId: sId, tId: tId, sm: sm, tm: tm,
                                line: line, mat: mat, connected: false, dimmed: false,
                                score: l.score, scoreDiv: scoreDiv });
            });

            /* ── D3 시뮬레이션 ──────────────────────────────── */
            /* 고정 기본 간격 — 노드 수 무관하게 가독성 유지, 카메라가 줌아웃으로 수용 */
            var idealDist = miniMode ? 110 : 80;

            /* ── 초기 위치: 피보나치 구면 배치 ──────────────
             *  황금각(golden angle) 배분으로 구면 위에 균등하게 분포.
             *  반지름 R = sqrt(N) × idealDist × 0.45 로 노드 수에 비례하되 컴팩트하게.
             */
            (function () {
                var N = nodes.length;
                var R = Math.max(80, Math.sqrt(N) * idealDist * 0.45);
                var golden = Math.PI * (1 + Math.sqrt(5)); // 황금각 × 2π
                nodes.forEach(function (n, i) {
                    var k   = i + 0.5;
                    var phi = Math.acos(1 - 2 * k / N);          // 위도
                    var th  = golden * k;                          // 경도
                    n.x = R * Math.sin(phi) * Math.cos(th);
                    n.y = R * Math.sin(phi) * Math.sin(th);
                    n.z = R * Math.cos(phi);
                });
            })();

            var sim = d3.forceSimulation(nodes)
                .force('link', d3.forceLink(links)
                    .id(function (d) { return d.id; })
                    /* idealDist 기준으로 score가 높을수록 가깝게, 낮을수록 멀게 */
                    .distance(function (d) {
                        var s = d.score || 0.7;
                        return idealDist * (1.8 - s * 0.8); /* score=1.0→idealDist, score=0.6→1.32*idealDist */
                    })
                    .strength(function (d) { return 0.15 + (d.score || 0.7) * 0.3; }))
                .force('charge',    d3.forceManyBody().strength(-(idealDist * idealDist * 0.09)).distanceMax(Math.max(350, idealDist * 5)))
                .force('collision', d3.forceCollide().radius(function (d) { return nodeR(d) + idealDist * 0.40; }))
                .force('centerX',   d3.forceX(0).strength(0.04))
                .force('centerY',   d3.forceY(0).strength(0.04))
                .alphaDecay(0.015)
                .alphaTarget(0)
                .stop();

            zoomToFit();
            sim.stop(); /* 구면 위치 고정 — 드래그 시에만 재시작 */

            /* ── 초기 카메라 zoom-to-fit (3D 구면 기준) ── */
            function zoomToFit() {
                var maxR = 1;
                nodes.forEach(function (n) {
                    var r = Math.sqrt(
                        (n.x || 0) * (n.x || 0) +
                        (n.y || 0) * (n.y || 0) +
                        (n.z || 0) * (n.z || 0)
                    );
                    if (r > maxR) maxR = r;
                });
                var fovHalfRad = FOV * 0.5 * Math.PI / 180;
                var z = maxR / Math.tan(fovHalfRad) * 1.25 + 80;
                camera.position.set(0, 0, Math.max(200, z));
                camera.lookAt(0, 0, 0);
                if (controls) {
                    controls.target.set(0, 0, 0);
                    controls.update();
                }
            }

            /* ── 배경 클릭 시 전체 노드 fit ────────────── */
            function zoomToFitCompact() {
                var maxR = 80;
                nodes.forEach(function (n) {
                    var nx = n.fx !== undefined ? n.fx : (n.x || 0);
                    var ny = n.fy !== undefined ? n.fy : (n.y || 0);
                    var r = Math.sqrt(nx * nx + ny * ny);
                    if (r > maxR) maxR = r;
                });
                maxR = Math.min(maxR, 420);
                var z = Math.max(320, maxR * 2.2 + 80);
                camera.position.set(60, 90, z);
                camera.lookAt(0, 0, 0);
                controls.target.set(0, 0, 0);
                controls.update();
            }

            /* ── 상태 ────────────────────────────────────── */
            var pinnedNode = null, activeNode = null, resetTimer = null, activeSearch = false;
            var lastInteract = 0, IDLE_MS = 2000;

            function highlight(n) {
                activeNode = n;
                clearTimeout(resetTimer);
                var nb = adj[n.slug] || new Set();
                var th = dark
                    ? { label: '#94a3b8', labelActive: '#ffffff' }
                    : { label: '#475569', labelActive: '#0f172a' };

                meshes.forEach(function (m) {
                    var mn = m.userData.node;
                    var isSel = mn.slug === n.slug;
                    var isNb  = nb.has(mn.slug);
                    m.userData.selected = isSel;
                    m.userData.dimmed   = !isSel && !isNb;
                    m.userData.active   = isSel || isNb;

                    /* 라벨 */
                    var div = m.userData.labelDiv;
                    if (div) {
                        var opa = (isSel || isNb) ? 1 : 0;
                        div._opa = opa;
                        div.style.opacity  = opa.toString();
                        div.style.color    = isSel ? th.labelActive : th.label;
                        div.style.fontSize = isSel ? '11px' : '9px';
                    }
                });

                linkObjs.forEach(function (lo) {
                    var conn = lo.sId === n.slug || lo.tId === n.slug;
                    lo.connected = conn;
                    lo.dimmed    = !conn;
                });

                showPreview(n);
            }

            function resetHighlight() {
                if (pinnedNode) return;
                clearTimeout(resetTimer);
                resetTimer = setTimeout(function () {
                    activeNode = null;
                    var th = dark ? { label: '#94a3b8' } : { label: '#475569' };
                    meshes.forEach(function (m) {
                        m.userData.selected = false;
                        m.userData.dimmed   = false;
                        m.userData.active   = false;
                        var div = m.userData.labelDiv;
                        if (div) {
                            div._opa = LABEL_NORMAL;
                            div.style.opacity  = LABEL_NORMAL.toString();
                            div.style.color    = th.label;
                            div.style.fontSize = '9px';
                        }
                    });
                    linkObjs.forEach(function (lo) { lo.connected = false; lo.dimmed = false; });
                    previewEl.classList.remove('is-visible');
                }, 80);
            }

            function pinNode(n) {
                pinnedNode = n;
                clearTimeout(resetTimer);
                activeNode = null;
                highlight(n);
            }

            /* ── 툴팁 (2D graph-tooltip 동일 스타일, position:fixed) ── */
            var previewEl = document.createElement('div');
            previewEl.className = 'graph-tooltip';
            previewEl.style.zIndex = '3200';
            document.body.appendChild(previewEl);

            function showPreview(n) {
                var title = n.title.replace(/^[""""]|[""""]$/g, '');
                previewEl.innerHTML = '<strong>' + title + '</strong>';
                previewEl.classList.add('is-visible');
            }

            /* ─────────────────────────────────────────────────────
               핵심: 내 이벤트 핸들러를 OrbitControls보다 먼저 등록.
               노드 히트 시 stopImmediatePropagation으로 OrbitControls 차단.
            ──────────────────────────────────────────────────────── */
            var ray       = new THREE.Raycaster();
            var ptr       = new THREE.Vector2(-9, -9);
            var dragPlane = new THREE.Plane();
            var dragMesh    = null;
            var isDragging  = false;
            var downAt      = null;
            var dragConnSet = null; // 드래그 중 연결 노드 slug set

            function setPtr(e) {
                var rc = renderer.domElement.getBoundingClientRect();
                ptr.x =  ((e.clientX - rc.left) / rc.width)  * 2 - 1;
                ptr.y = -((e.clientY - rc.top)  / rc.height) * 2 + 1;
            }

            renderer.domElement.addEventListener('pointerdown', onDown);
            renderer.domElement.addEventListener('pointermove', onMove);
            renderer.domElement.addEventListener('pointerup',   onUp);

            /* TrackballControls — 극점 제한 없는 자유 360° 회전 */
            var controls = new THREE.TrackballControls(camera, renderer.domElement);
            controls.rotateSpeed          = 2.0;
            controls.staticMoving         = false;
            controls.dynamicDampingFactor = 0.12;
            controls.minDistance          = 80;
            controls.maxDistance          = 4000;
            controls.noZoom               = true;  // 커스텀 wheel 줌으로 대체
            controls.noPan                = miniMode;
            controls.target.set(0, 0, 0);

            /* 마우스 위치 기준 줌 — OrbitControls 이후 등록으로 wheel 선점 */
            renderer.domElement.addEventListener('wheel', function (e) {
                e.preventDefault();
                var rect = renderer.domElement.getBoundingClientRect();
                var nx = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
                var ny = -((e.clientY - rect.top)  / rect.height) *  2 + 1;

                /* 마우스 아래의 월드 좌표 (현재 target 거리 기준) */
                var zoomRay = new THREE.Raycaster();
                zoomRay.setFromCamera(new THREE.Vector2(nx, ny), camera);
                var dist = camera.position.distanceTo(controls.target);
                var mouseWorld = zoomRay.ray.at(dist, new THREE.Vector3());

                /* 줌 배율 */
                var factor = e.deltaY > 0 ? 1.12 : (1 / 1.12);

                /* 카메라와 target 모두 mouseWorld 기준으로 스케일 */
                var camOff    = camera.position.clone().sub(mouseWorld).multiplyScalar(factor);
                var targetOff = controls.target.clone().sub(mouseWorld).multiplyScalar(factor);
                camera.position.copy(mouseWorld.clone().add(camOff));
                controls.target.copy(mouseWorld.clone().add(targetOff));

                /* min/max distance 강제 적용 */
                var newDist = camera.position.distanceTo(controls.target);
                if (newDist < controls.minDistance || newDist > controls.maxDistance) {
                    var clampedDist = Math.max(controls.minDistance, Math.min(controls.maxDistance, newDist));
                    var dir = camera.position.clone().sub(controls.target).normalize();
                    camera.position.copy(controls.target.clone().add(dir.multiplyScalar(clampedDist)));
                }
                controls.update();
            }, { passive: false });

            /* 모바일 핀치-투-줌 */
            var pinchDist0 = null;
            var pinchMid0  = null;
            renderer.domElement.addEventListener('touchstart', function (e) {
                if (e.touches.length === 2) {
                    var dx = e.touches[0].clientX - e.touches[1].clientX;
                    var dy = e.touches[0].clientY - e.touches[1].clientY;
                    pinchDist0 = Math.sqrt(dx * dx + dy * dy);
                    pinchMid0  = {
                        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                        y: (e.touches[0].clientY + e.touches[1].clientY) / 2
                    };
                } else {
                    pinchDist0 = null;
                    pinchMid0  = null;
                }
            }, { passive: true });

            renderer.domElement.addEventListener('touchmove', function (e) {
                if (e.touches.length !== 2 || pinchDist0 === null) return;
                e.preventDefault();
                var dx = e.touches[0].clientX - e.touches[1].clientX;
                var dy = e.touches[0].clientY - e.touches[1].clientY;
                var dist = Math.sqrt(dx * dx + dy * dy);
                var factor = pinchDist0 / dist;  /* >1 = zoom out, <1 = zoom in */
                pinchDist0 = dist;

                var rect = renderer.domElement.getBoundingClientRect();
                var nx = ((pinchMid0.x - rect.left) / rect.width)  *  2 - 1;
                var ny = -((pinchMid0.y - rect.top)  / rect.height) *  2 + 1;

                var zoomRay = new THREE.Raycaster();
                zoomRay.setFromCamera(new THREE.Vector2(nx, ny), camera);
                var d = camera.position.distanceTo(controls.target);
                var midWorld = zoomRay.ray.at(d, new THREE.Vector3());

                var camOff    = camera.position.clone().sub(midWorld).multiplyScalar(factor);
                var targetOff = controls.target.clone().sub(midWorld).multiplyScalar(factor);
                camera.position.copy(midWorld.clone().add(camOff));
                controls.target.copy(midWorld.clone().add(targetOff));

                var newDist = camera.position.distanceTo(controls.target);
                if (newDist < controls.minDistance || newDist > controls.maxDistance) {
                    var clampedDist = Math.max(controls.minDistance, Math.min(controls.maxDistance, newDist));
                    var dir = camera.position.clone().sub(controls.target).normalize();
                    camera.position.copy(controls.target.clone().add(dir.multiplyScalar(clampedDist)));
                }
                controls.update();
            }, { passive: false });

            renderer.domElement.addEventListener('touchend', function (e) {
                if (e.touches.length < 2) {
                    pinchDist0 = null;
                    pinchMid0  = null;
                }
            }, { passive: true });

            function onDown(e) {
                if (e.button !== 0) return;
                lastInteract = performance.now();
                setPtr(e);
                camera.updateMatrixWorld();
                ray.setFromCamera(ptr, camera);
                downAt = { x: e.clientX, y: e.clientY, t: Date.now() };

                var visibleMeshes = meshes.filter(function (m) { return m.visible; });
                var hits = ray.intersectObjects(visibleMeshes, false);
                if (!hits.length) return;

                /* 노드 히트 기록만 — 차단은 드래그 임계 초과 시까지 보류
                   → OrbitControls도 함께 회전 시작하지만, 드래그 확정 시 controls.enabled=false로 전환 */
                dragMesh  = hits[0].object;
                isDragging = false;
                dragPlane.setFromNormalAndCoplanarPoint(
                    camera.getWorldDirection(new THREE.Vector3()),
                    dragMesh.position
                );
            }

            function onMove(e) {
                lastInteract = performance.now();
                setPtr(e);
                if (dragMesh) {
                    /* 3px 이상 이동 시 노드 드래그 확정 → OrbitControls 비활성 */
                    if (!isDragging && downAt) {
                        var dx = Math.abs(e.clientX - downAt.x);
                        var dy = Math.abs(e.clientY - downAt.y);
                        if (dx > 3 || dy > 3) {
                            isDragging = true;
                            controls.enabled = false;
                            var dn = dragMesh.userData.node;
                            dn.fx = dn.x; dn.fy = dn.y; dn.fz = dn.z;
                            /* BFS로 전이적 연결 노드 전체 수집 */
                            dragConnSet = (function (startSlug) {
                                var visited = new Set();
                                var frontier = new Set([startSlug]);
                                for (var hop = 0; hop < 2; hop++) {
                                    var next = new Set();
                                    frontier.forEach(function (s) {
                                        if (!visited.has(s)) {
                                            visited.add(s);
                                            (adj[s] || new Set()).forEach(function (n) { if (!visited.has(n)) next.add(n); });
                                        }
                                    });
                                    frontier = next;
                                }
                                visited.delete(startSlug);
                                return visited;
                            })(dn.slug);
                            /* 연결 노드 fx/fy/fz 해제 → 링크 힘으로 3D 공간에서 자유롭게 따라오게 */
                            dragConnSet.forEach(function (s) {
                                var nb = nodeMap[s];
                                if (nb) { nb.fx = undefined; nb.fy = undefined; nb.fz = undefined; }
                            });
                            /* charge 제거(반발 차단), 링크 최대 강화 */
                            sim.force('charge').strength(0);
                            sim.force('link').strength(1.0);
                            sim.alphaTarget(0.25).restart();
                        }
                    }
                    if (isDragging) {
                        camera.updateMatrixWorld();
                        ray.setFromCamera(ptr, camera);
                        var pt = new THREE.Vector3();
                        if (ray.ray.intersectPlane(dragPlane, pt)) {
                            var dn2 = dragMesh.userData.node;
                            var prevZ = dn2.fz !== undefined ? dn2.fz : dn2.z;
                            var dz = pt.z - prevZ;
                            dn2.fx = pt.x; dn2.fy = pt.y; dn2.fz = pt.z;
                            /* connected nodes Z 전파 — D3는 2D이므로 Z는 수동으로 따라오게 */
                            if (dragConnSet && Math.abs(dz) > 0.5) {
                                dragConnSet.forEach(function (s) {
                                    var nb = nodeMap[s];
                                    if (nb) nb.z += dz * 0.5;
                                });
                            }
                        }
                    }
                    return;
                }
                camera.updateMatrixWorld();
                ray.setFromCamera(ptr, camera);
                var visibleMeshes = meshes.filter(function (m) { return m.visible; });
                renderer.domElement.style.cursor =
                    ray.intersectObjects(visibleMeshes, false).length ? 'pointer' : 'grab';
            }

            function doReset() {
                pinnedNode = null; clearTimeout(resetTimer); activeNode = null;
                meshes.forEach(function (m) {
                    m.userData.selected = false; m.userData.dimmed = false; m.userData.active = false;
                    if (m.userData.labelDiv) {
                        m.userData.labelDiv._opa = LABEL_NORMAL;
                        m.userData.labelDiv.style.opacity  = LABEL_NORMAL.toString();
                        m.userData.labelDiv.style.fontSize = '9px';
                    }
                });
                linkObjs.forEach(function (lo) { lo.connected = false; lo.dimmed = false; });
                activeSearch = false;
                previewEl.classList.remove('is-visible');
            }

            function onUp(e) {
                controls.enabled = true; // 노드 드래그 종료 시 항상 복원

                if (dragMesh) {
                    if (!isDragging) {
                        /* 순수 클릭 → pinNode 또는 페이지 이동 (sim 상태 그대로) */
                        var cn = dragMesh.userData.node;
                        dragMesh = null; isDragging = false; downAt = null;
                        if (pinnedNode && pinnedNode.slug === cn.slug) {
                            window.location.href = cn.url;
                        } else {
                            pinNode(cn);
                        }
                        return;
                    }

                    /* 드래그 종료: 연결 노드를 현재 위치에 pin → 원복 방지 */
                    if (dragConnSet) {
                        dragConnSet.forEach(function (s) {
                            var nb = nodeMap[s];
                            if (nb) { nb.fx = nb.x; nb.fy = nb.y; nb.fz = nb.z; }
                        });
                        dragConnSet = null;
                    }
                    /* 힘 원복 후 자연 감쇠 → 정지 */
                    sim.force('charge').strength(-180);
                    sim.force('link').strength(function (d) { return 0.2 + (d.score || 0.7) * 0.35; });
                    sim.alphaTarget(0).alpha(0.15);
                    dragMesh = null; isDragging = false; downAt = null;
                    return;
                }

                /* 배경 클릭 판정 */
                if (!downAt) return;
                var moved = Math.abs(e.clientX - downAt.x) + Math.abs(e.clientY - downAt.y);
                var dt    = Date.now() - downAt.t;
                var nowT  = Date.now();
                downAt = null;
                if (moved > 6 || dt > 400) return;

                var wasPinned = pinnedNode !== null;
                doReset();
                if (!wasPinned) zoomToFitCompact();
            }

            /* ── 카테고리 패널 ───────────────────────────── */
            var groupsEl = opts.groups;
            if (groupsEl) {
                cats.forEach(function (cat) {
                    var item = document.createElement('label');
                    item.className = 'gp-chip';
                    item.innerHTML =
                        '<input type="checkbox" checked data-cat="' + cat + '" class="gp-chip__input">' +
                        '<span class="gp-chip__dot" style="background:' + catColor(cat) + '"></span>' +
                        '<span class="gp-chip__name">' + cat + '</span>' +
                        '<span class="gp-chip__count">' + catGroups[cat].length + '</span>';
                    groupsEl.appendChild(item);
                    item.querySelector('input').addEventListener('change', function (ev) {
                        if (ev.target.checked) hiddenCats.delete(cat);
                        else hiddenCats.add(cat);
                        meshes.forEach(function (m) {
                            m.visible = !hiddenCats.has(m.userData.node.cat);
                            if (m.userData.labelDiv)
                                m.userData.labelDiv.style.display = m.visible ? '' : 'none';
                        });
                        linkObjs.forEach(function (lo) {
                            lo.line.visible =
                                !hiddenCats.has(lo.sm.userData.node.cat) &&
                                !hiddenCats.has(lo.tm.userData.node.cat);
                        });
                    });
                });
            }

            if (opts.stats) {
                opts.stats.textContent = nodes.length + '개 노드 · ' + links.length + '개 연결';
            }

            /* ── 검색 ───────────────────────────────────── */
            if (opts.search) {
                opts.search.addEventListener('input', function () {
                    var q = this.value.toLowerCase().trim();
                    pinnedNode = null; clearTimeout(resetTimer); activeNode = null;
                    activeSearch = q.length > 0;
                    if (!q) {
                        meshes.forEach(function (m) {
                            m.userData.dimmed   = false;
                            m.userData.selected = false;
                            if (m.userData.labelDiv) {
                                m.userData.labelDiv._opa = LABEL_NORMAL;
                                m.userData.labelDiv.style.opacity  = LABEL_NORMAL.toString();
                                m.userData.labelDiv.style.fontSize = '9px';
                            }
                        });
                        linkObjs.forEach(function (lo) { lo.connected = false; lo.dimmed = false; });
                        previewEl.classList.remove('is-visible');
                        return;
                    }
                    function match(n) {
                        return n.title.toLowerCase().includes(q) ||
                               (n.tags || []).some(function (tg) { return tg.toLowerCase().includes(q); });
                    }
                    meshes.forEach(function (m) {
                        var ok = match(m.userData.node);
                        var opa = ok ? 1 : 0;
                        m.userData.dimmed   = !ok;
                        m.userData.selected = false;
                        if (m.userData.labelDiv) {
                            m.userData.labelDiv._opa = opa;
                            m.userData.labelDiv.style.opacity  = opa.toString();
                            m.userData.labelDiv.style.fontSize = ok ? '11px' : '9px';
                        }
                    });
                    linkObjs.forEach(function (lo) { lo.connected = false; lo.dimmed = true; });
                });
            }

            /* ── 다크모드 감지 + 전체 재테마 ─────────────── */
            function applyTheme() {
                _colorCache = {}; // CSS 변수 재로드
                dark = isDark();
                var bgStr2 = dark ? '#060a14' : '#f8fafc';

                if (scene.fog) scene.fog.color.set(dark ? 0x060a14 : 0xf8fafc);
                if (starPoints) {
                    starPoints.material.color.set(0xe0eaff);
                    starPoints.material.opacity = dark ? (miniMode ? 0.2 : 0.65) : 0;
                }
                container.style.backgroundColor = bgStr2;
                container.style.backgroundImage = dark
                    ? 'none'
                    : 'radial-gradient(circle, rgba(100,116,139,0.30) 1.2px, transparent 1.2px)';
                container.style.backgroundSize = dark ? '' : '28px 28px';

                /* 노드 재색상 */
                meshes.forEach(function (m) {
                    var col = themedColor(m.userData.node.colorKey || m.userData.node.cat);
                    m.material.color.set(col);
                    if (m.userData.borderMesh) m.userData.borderMesh.material.color.set(col);
                    if (m.userData.haloMesh)   m.userData.haloMesh.material.color.set(col);
                    m.userData.sprite.material.color.set(col);
                    var div = m.userData.labelDiv;
                    if (div) {
                        div.style.color      = dark ? '#94a3b8' : '#475569';
                        div.style.textShadow = '0 0 4px ' + bgStr2 + ',0 0 8px ' + bgStr2;
                    }
                });

                /* 스코어 div 재색상 */
                linkObjs.forEach(function (lo) {
                    if (!lo.scoreDiv) return;
                    if (dark) {
                        lo.scoreDiv.style.color      = '#e2e8f0';
                        lo.scoreDiv.style.background = 'rgba(13,17,23,0.88)';
                        lo.scoreDiv.style.borderColor = 'rgba(51,65,85,0.5)';
                    } else {
                        lo.scoreDiv.style.color      = '#334155';
                        lo.scoreDiv.style.background = 'rgba(248,250,252,0.88)';
                        lo.scoreDiv.style.borderColor = 'rgba(226,232,240,0.7)';
                    }
                });
            }
            new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

            /* ── 라벨 screen-projection ─────────────────── */
            var projV2 = new THREE.Vector3();
            function projectLabels() {
                var cw = renderer.domElement.clientWidth;
                var ch = renderer.domElement.clientHeight;
                meshes.forEach(function (m) {
                    var ud  = m.userData;
                    var div = ud.labelDiv;
                    if (!div || !m.visible) return;

                    /* 숨김 처리 */
                    if (ud.dimmed && !ud.selected && !ud.active) {
                        div.style.display = 'none'; return;
                    }

                    projV2.copy(m.position).applyMatrix4(camera.matrixWorldInverse);
                    if (projV2.z > -1) { div.style.display = 'none'; return; }

                    projV2.copy(m.position).project(camera);
                    var sx = (projV2.x  * 0.5 + 0.5) * cw;
                    var sy = (-projV2.y * 0.5 + 0.5) * ch;
                    if (sx < 8 || sx > cw - 8 || sy < 8 || sy > ch - 8) {
                        div.style.display = 'none'; return;
                    }

                    /* fog-based opacity (div._opa = 기준값, fog는 가산 감쇠) */
                    var dist = camera.position.distanceTo(m.position);
                    var fog  = Math.max(0, Math.min(1, (dist - 700) / 1100));
                    var baseOpa = div._opa !== undefined ? div._opa : LABEL_NORMAL;
                    var finalOpa = baseOpa * (1 - fog * 0.6);

                    div.style.display   = '';
                    div.style.left      = sx + 'px';
                    div.style.top       = (sy - ud.r - 4) + 'px';
                    div.style.transform = 'translate(-50%,-100%)';
                    div.style.opacity   = finalOpa.toFixed(2);
                });
            }

            /* ── 애니메이션 루프 ─────────────────────────── */
            var running = true;
            var _projPV = new THREE.Vector3();

            function animate() {
                if (!running) return;
                requestAnimationFrame(animate);

                var now = performance.now();
                var waveT = now / WAVE_PERIOD * 2 * Math.PI;
                var beingDragged = isDragging && dragMesh ? dragMesh.userData.node : null;
                var cw = renderer.domElement.clientWidth;
                var ch = renderer.domElement.clientHeight;

                meshes.forEach(function (m) {
                    var ud = m.userData, n = ud.node;
                    var wox = Math.sin(waveT + n._wavePhaseX) * WAVE_AMP * 0.5;
                    var woy = Math.sin(waveT + n._wavePhaseY) * WAVE_AMP;

                    if (n === beingDragged) {
                        m.position.x = n.fx !== undefined ? n.fx : (n.x || 0);
                        m.position.y = n.fy !== undefined ? n.fy : (n.y || 0);
                        m.position.z = n.fz !== undefined ? n.fz : n.z;
                    } else {
                        m.position.x = (n.x || 0) + wox;
                        m.position.y = (n.y || 0) + woy;
                        /* 드래그 후에도 fz 유지 (3D 위치 보존) */
                        m.position.z = (n.fz !== undefined ? n.fz : n.z) + Math.sin(waveT * 0.4 + n._wavePhaseZ) * 4;
                    }

                    var dim = ud.dimmed, sel = ud.selected;
                    var hidden = dim && (pinnedNode || activeSearch);
                    /* 내부 구체: 극도로 투명 (유리 질감 힌트) */
                    m.material.opacity = hidden ? 0 : 0.06;
                    m.scale.setScalar(sel ? 1.3 : 1.0);
                    /* 테두리: 항상 solid (pinned+dim만 숨김) */
                    if (ud.borderMesh) {
                        ud.borderMesh.material.transparent = hidden;
                        ud.borderMesh.material.opacity = hidden ? 0 : 1;
                    }
                    /* halo: 아주 희미하게만 */
                    if (ud.haloMesh) {
                        ud.haloMesh.material.opacity = hidden ? 0 : (sel ? 0.28 : 0.07);
                    }
                    ud.sprite.material.opacity = hidden ? 0 : (sel ? 0.55 : 0);
                });

                var pinnedCatCol = pinnedNode ? catColor(pinnedNode.cat) : null;

                linkObjs.forEach(function (lo) {
                    if (!lo.line.visible) return;
                    var sp  = lo.sm.position, tp = lo.tm.position;
                    var arr = lo.line.geometry.attributes.position.array;
                    arr[0] = sp.x; arr[1] = sp.y; arr[2] = sp.z;
                    arr[3] = tp.x; arr[4] = tp.y; arr[5] = tp.z;
                    lo.line.geometry.attributes.position.needsUpdate = true;

                    var mat = lo.mat, d2 = dark;
                    if (lo.connected) {
                        /* 선택된 노드의 catColor로 엣지 하이라이트 */
                        mat.color.setStyle(pinnedCatCol || catColor(lo.sm.userData.node.cat));
                        mat.opacity = 1; mat.linewidth = 2;

                        /* 유사도 점수 레이블 위치 갱신 */
                        if (lo.scoreDiv) {
                            _projPV.set((sp.x + tp.x) / 2, (sp.y + tp.y) / 2, (sp.z + tp.z) / 2).project(camera);
                            var smx = (_projPV.x * 0.5 + 0.5) * cw;
                            var smy = (-_projPV.y * 0.5 + 0.5) * ch;
                            lo.scoreDiv.style.display = '';
                            lo.scoreDiv.style.left    = smx + 'px';
                            lo.scoreDiv.style.top     = smy + 'px';
                            if (pinnedCatCol) lo.scoreDiv.style.color = pinnedCatCol;
                        }
                    } else {
                        if (lo.scoreDiv) lo.scoreDiv.style.display = 'none';
                        mat.color.set(d2 ? 0xffffff : 0x334155);
                        /* pinned 상태면 비연결 링크 완전 숨김 */
                        mat.opacity = (pinnedNode && lo.dimmed) ? 0 : (lo.dimmed ? 0.04 : (d2 ? 0.55 : 0.45));
                    }
                });

                /* 프리뷰 카드 — 노드 따라 이동, 연결 노드 안 가리는 방향 선택 */
                if (pinnedNode) updatePreviewPos();

                /* 자동 회전 — miniMode: 항상, 메인: idle 3초 후 */
                var shouldRotate = isDragging ? false
                    : miniMode ? true
                    : (!pinnedNode && (now - lastInteract > IDLE_MS));
                if (shouldRotate) {
                    var _a = miniMode ? 0.004 : 0.003;
                    var _px = camera.position.x - controls.target.x;
                    var _pz = camera.position.z - controls.target.z;
                    var _c = Math.cos(_a), _s = Math.sin(_a);
                    camera.position.x = controls.target.x + _c * _px + _s * _pz;
                    camera.position.z = controls.target.z - _s * _px + _c * _pz;
                    camera.lookAt(controls.target);
                }
                controls.update();
                renderer.render(scene, camera);
                projectLabels();
            }

            /* ── 프리뷰 위치 스마트 배치 ─────────────────── */
            function viewportOf(mesh) {
                var rect = renderer.domElement.getBoundingClientRect();
                _projPV.copy(mesh.position).project(camera);
                return {
                    x: (_projPV.x * 0.5 + 0.5) * rect.width  + rect.left,
                    y: (-_projPV.y * 0.5 + 0.5) * rect.height + rect.top,
                };
            }

            function updatePreviewPos() {
                var m = nodeById[pinnedNode.slug];
                if (!m) return;
                var vw    = window.innerWidth, vh = window.innerHeight;
                var sp    = viewportOf(m);
                var tipW  = previewEl.offsetWidth  || 240;
                var tipH  = previewEl.offsetHeight || 80;
                var gap   = Math.max(12, m.userData.r + 6);
                var pad   = 8;

                /* 이웃 노드 뷰포트 위치 */
                var nbPos = [];
                (adj[pinnedNode.slug] || new Set()).forEach(function (s) {
                    var nm = nodeById[s];
                    if (nm && nm.visible) nbPos.push(viewportOf(nm));
                });

                /* 4방향 후보 */
                var candidates = [
                    { l: sp.x + gap,            tp: sp.y - tipH / 2 },
                    { l: sp.x - tipW - gap,     tp: sp.y - tipH / 2 },
                    { l: sp.x - tipW / 2,       tp: sp.y + gap       },
                    { l: sp.x - tipW / 2,       tp: sp.y - tipH - gap },
                ];

                function overlapScore(c) {
                    var cx = c.l + tipW / 2, cy = c.tp + tipH / 2, sc = 0;
                    nbPos.forEach(function (nb) {
                        var dx = Math.abs(nb.x - cx), dy = Math.abs(nb.y - cy);
                        if (dx < tipW / 2 + 30 && dy < tipH / 2 + 30) sc++;
                    });
                    if (c.l < pad || c.l + tipW > vw - pad) sc += 5;
                    if (c.tp < pad || c.tp + tipH > vh - pad) sc += 5;
                    return sc;
                }

                var best = candidates.reduce(function (prev, cur) {
                    return overlapScore(cur) < overlapScore(prev) ? cur : prev;
                });

                previewEl.style.left = Math.max(pad, Math.min(best.l,  vw - tipW - pad)) + 'px';
                previewEl.style.top  = Math.max(pad, Math.min(best.tp, vh - tipH - pad)) + 'px';
            }
            animate();

            /* ── 리사이즈 ─────────────────────────────── */
            function onResize() {
                W = container.clientWidth; H = container.clientHeight;
                camera.aspect = W / H; camera.updateProjectionMatrix();
                renderer.setSize(W, H);
                controls.handleResize();
            }
            window.addEventListener('resize', onResize);

            /* ── dispose ─────────────────────────────── */
            var _dispose = function () {
                running = false; sim.stop(); clearTimeout(resetTimer);
                previewEl.classList.remove('is-visible');
                window.removeEventListener('resize', onResize);
                if (labelsEl.parentNode)  labelsEl.remove();
                if (previewEl.parentNode) previewEl.remove();
                linkObjs.forEach(function (lo) { if (lo.scoreDiv && lo.scoreDiv.parentNode) lo.scoreDiv.remove(); });
                renderer.dispose();
            };
            container._kg3dDispose = _dispose;

        }).catch(function (e) { console.error('[kg3d] data error:', e); });
    }

    /* ── 공개 API ─────────────────────────────────────────────────── */
    window.KnowledgeGraph3D = {
        init: function (opts) {
            if (!opts || !opts.container) return;
            var c = opts.container;
            if (c._kg3dDispose) { c._kg3dDispose(); delete c._kg3dDispose; }
            ensureLibs().then(function () { initGraph(opts); })
                .catch(function (e) { console.error('[kg3d] lib error:', e); });
        },
    };

})();
