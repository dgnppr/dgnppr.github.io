#!/usr/bin/env node
/**
 * AI 다이어그램 생성기 (JSON DAG)
 *
 * 실행 방법 — LM Studio (로컬):
 *   [LM_STUDIO_BASE_URL=http://localhost:1234/v1] \
 *   [LM_STUDIO_MODEL=local-model] \
 *   node scripts/generate-diagrams.js
 *
 * - 이미 생성된 다이어그램은 건너뜀 (캐시)
 * - 마크다운 내용 기반 단방향 그래프(DAG) JSON 자동 생성
 * - --force 플래그로 전체 재생성
 */
'use strict';
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// .env 로더 (shell 환경변수 우선)
(function loadEnv() {
    var p = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(p)) return;
    fs.readFileSync(p, 'utf8').split('\n').forEach(function (line) {
        var m = /^\s*([^#=\s][^=]*?)\s*=\s*(.*?)\s*$/.exec(line);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
})();

var BACKEND      = process.env.LLM_BACKEND || 'lmstudio'; // 'lmstudio' | 'vertexai'
var LM_BASE_URL  = (process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234/v1').replace(/\/$/, '');
var LM_MODEL     = process.env.LM_STUDIO_MODEL || 'gemma-4-12b-coder-fable5-composer2.5-v1';
var GCP_PROJECT  = process.env.GOOGLE_PROJECT_ID;
var GCP_LOCATION = process.env.GOOGLE_LOCATION || 'asia-northeast3';
var GCP_CREDS    = process.env.GOOGLE_APPLICATION_CREDENTIALS;
var FORCE        = process.argv.includes('--force');

if (BACKEND === 'vertexai' && (!GCP_CREDS || !GCP_PROJECT)) {
    console.error('[오류] vertexai 백엔드에 필요한 환경 변수를 설정하세요:');
    console.error('  GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json');
    console.error('  GOOGLE_PROJECT_ID=my-project');
    process.exit(1);
}

var backendLabel = BACKEND === 'vertexai'
    ? 'Vertex AI — gemini-2.5-flash (' + GCP_LOCATION + ')'
    : 'LM Studio — ' + LM_MODEL + ' (' + LM_BASE_URL + ')';
console.log('[백엔드] ' + backendLabel);

const ROOT           = path.join(__dirname, '..');
const DIAGRAMS_FILE  = path.join(ROOT, 'data/diagrams.json');
const DIAGRAM_DIR    = path.join(ROOT, 'data/diagrams');

if (!fs.existsSync(DIAGRAM_DIR)) {
    fs.mkdirSync(DIAGRAM_DIR, { recursive: true });
}

// ── 프롬프트 ───────────────────────────────────────────────────
function buildPrompt(title, body) {
    return [
        '# 역할',
        '기술 블로그 포스트의 핵심 서사를 방향 그래프로 압축하는 AI.',
        '독자가 그래프만 보고도 "이 글의 핵심 관계가 뭔지" 바로 알 수 있어야 한다.',
        '',
        '# 출력 형식',
        '아래 JSON 스키마만 반환. 마크다운 펜스(```), 제목, 설명, 주석 일절 금지.',
        '',
        '{',
        '  "nodes": [',
        '    { "id": "n1", "label": "레이블", "type": "root|step|decision|end" }',
        '  ],',
        '  "edges": [',
        '    { "from": "n1", "to": "n2" },',
        '    { "from": "n2", "to": "n3", "bidirectional": true, "label": "선택적 레이블" }',
        '  ]',
        '}',
        '',
        '# 노드 타입',
        '- root: 시작점 또는 핵심 주제 (1개 권장)',
        '- step: 일반 과정·항목 (기본값)',
        '- decision: 분기점·선택 (조건이 있을 때)',
        '- end: 최종 결론·결과',
        '',
        '# 엣지 타입 — 핵심 규칙',
        '기술 블로그의 개념들은 대부분 서로 영향을 주고받는다.',
        '아래 패턴이 글에 등장하면 반드시 bidirectional:true를 사용하라.',
        '',
        '## 반드시 양방향으로 표현해야 하는 패턴',
        '1. 트레이드오프: "A를 얻으면 B를 잃는다" → A ↔ B',
        '   예) 성능 ↔ 일관성, 캐시 적중률 ↔ 메모리 사용, 단순함 ↔ 유연성',
        '2. 상호 의존: "A는 B를 필요로 하고 B도 A를 필요로 한다"',
        '   예) 프로듀서 ↔ 컨슈머, 클라이언트 ↔ 서버, Lock ↔ 트랜잭션',
        '3. 피드백 루프: "A가 B를 유발하고 B가 다시 A에 영향을 준다"',
        '   예) 트래픽 증가 ↔ 레이턴시 증가, 장애 ↔ 재시도 폭증',
        '4. 비교·대안: "A 대신 B, B 대신 A를 선택할 수 있다"',
        '   예) 낙관적 잠금 ↔ 비관적 잠금, 동기 ↔ 비동기',
        '',
        '## 단방향만 쓰는 경우',
        '- 시간 순서가 명확한 단계 (A 이후에만 B 가능)',
        '- 원인 → 결과 (역방향 흐름이 없을 때)',
        '',
        '# 규칙',
        '- 노드 수: 5~9개',
        '- label: 14자 이내, 핵심 단어만',
        '- 양방향 엣지 1~3개를 적극 활용하여 관계의 복잡성을 표현할 것',
        '- 글의 핵심 흐름을 담기 어려우면 빈 JSON {"nodes":[],"edges":[]} 반환',
        '',
        '# 예시 1 — 문제 해결형',
        '{',
        '  "nodes": [',
        '    {"id":"n1","label":"API 타임아웃","type":"root"},',
        '    {"id":"n2","label":"Kafka 랙 폭증","type":"step"},',
        '    {"id":"n3","label":"Convoy Effect","type":"step"},',
        '    {"id":"n4","label":"해결책 선택","type":"decision"},',
        '    {"id":"n5","label":"Circuit Breaker","type":"step"},',
        '    {"id":"n6","label":"장애 격리 성공","type":"end"}',
        '  ],',
        '  "edges": [',
        '    {"from":"n1","to":"n2"},',
        '    {"from":"n2","to":"n3"},',
        '    {"from":"n3","to":"n4"},',
        '    {"from":"n4","to":"n5"},',
        '    {"from":"n5","to":"n6"}',
        '  ]',
        '}',
        '',
        '# 예시 2 — 개념 설명형 (분기)',
        '{',
        '  "nodes": [',
        '    {"id":"n1","label":"Entity 조회","type":"root"},',
        '    {"id":"n2","label":"스냅샷 생성","type":"step"},',
        '    {"id":"n3","label":"트랜잭션 종료","type":"step"},',
        '    {"id":"n4","label":"변경 감지","type":"decision"},',
        '    {"id":"n5","label":"UPDATE 자동 실행","type":"end"},',
        '    {"id":"n6","label":"쿼리 생략","type":"end"}',
        '  ],',
        '  "edges": [',
        '    {"from":"n1","to":"n2"},',
        '    {"from":"n2","to":"n3"},',
        '    {"from":"n3","to":"n4"},',
        '    {"from":"n4","to":"n5","label":"변경 있음"},',
        '    {"from":"n4","to":"n6","label":"변경 없음"}',
        '  ]',
        '}',
        '',
        '# 예시 3 — 트레이드오프형 (양방향 엣지 사용)',
        '{',
        '  "nodes": [',
        '    {"id":"n1","label":"싱글 스레드","type":"root"},',
        '    {"id":"n2","label":"동시성 보장","type":"end"},',
        '    {"id":"n3","label":"높은 처리량 한계","type":"step"},',
        '    {"id":"n4","label":"I/O 멀티플렉싱","type":"step"},',
        '    {"id":"n5","label":"서브 스레드 분리","type":"end"}',
        '  ],',
        '  "edges": [',
        '    {"from":"n1","to":"n2"},',
        '    {"from":"n1","to":"n3"},',
        '    {"from":"n2","to":"n3","bidirectional":true},',
        '    {"from":"n3","to":"n4"},',
        '    {"from":"n4","to":"n5"}',
        '  ]',
        '}',
        '',
        '---',
        '',
        '제목: ' + title,
        '',
        '내용:',
        body,
    ].join('\n');
}

// ── LLM 클라이언트 ────────────────────────────────────────────
var _vertexAi;
async function generateDiagram(title, body) {
    var prompt = buildPrompt(title, body);
    var raw;

    if (BACKEND === 'vertexai') {
        if (!_vertexAi) {
            var { GoogleGenAI } = require('@google/genai');
            _vertexAi = new GoogleGenAI({ vertexai: true, project: GCP_PROJECT, location: GCP_LOCATION });
        }
        var response = await _vertexAi.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { maxOutputTokens: 1000, temperature: 0.4, topP: 0.9, thinkingConfig: { thinkingBudget: 0 } },
        });
        raw = (response.text || '').trim();
    } else {
        // lmstudio (OpenAI-compatible)
        var res = await fetch(LM_BASE_URL + '/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: LM_MODEL,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 4096,
                temperature: 0.4,
                top_p: 0.9,
            }),
        });
        if (!res.ok) throw new Error('LM Studio HTTP ' + res.status + ': ' + await res.text());
        var data = await res.json();
        var msg  = data.choices?.[0]?.message;
        raw = msg?.content || extractJsonFromThinking(msg?.reasoning_content || '');
    }

    // strip markdown fences if LLM added them
    return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

// thinking 모델: reasoning_content에서 nodes/edges JSON 블록만 추출
function extractJsonFromThinking(text) {
    var lastJson = '';
    var depth = 0;
    var start = -1;
    for (var i = 0; i < text.length; i++) {
        if (text[i] === '{') {
            if (depth === 0) start = i;
            depth++;
        } else if (text[i] === '}') {
            depth--;
            if (depth === 0 && start !== -1) {
                var candidate = text.slice(start, i + 1);
                if (candidate.includes('"nodes"') && candidate.includes('"edges"')) {
                    lastJson = candidate;
                }
                start = -1;
            }
        }
    }
    return lastJson;
}

function parseAndValidate(raw) {
    if (!raw) return null;
    var obj;
    try { obj = JSON.parse(raw); } catch (e) { return null; }
    if (!obj || !Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) return null;
    if (!obj.nodes.length) return null;
    // basic sanity: every edge references existing node ids
    var ids = new Set(obj.nodes.map(function (n) { return n.id; }));
    obj.edges = obj.edges.filter(function (e) { return ids.has(e.from) && ids.has(e.to); });
    return obj;
}

// ── 파일 수집 ─────────────────────────────────────────────────
function collectMarkdown(dir, results) {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(function (f) {
        var full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) {
            collectMarkdown(full, results);
        } else if (f.endsWith('.md') && !f.startsWith('_') && f !== 'README.md') {
            results.push(full);
        }
    });
}

var files = [];
collectMarkdown(path.join(ROOT, '_concept'),  files);
collectMarkdown(path.join(ROOT, '_insight'), files);
collectMarkdown(path.join(ROOT, '_problem'), files);
collectMarkdown(path.join(ROOT, '_tool'),    files);
collectMarkdown(path.join(ROOT, '_event'),   files);
collectMarkdown(path.join(ROOT, '_adr'),     files);
console.log('총 ' + files.length + '개 파일 발견' + (FORCE ? ' (--force: 전체 재생성)' : ''));

function slugFromPath(p) {
    return p
        .replace(/.*\/_concept\//, '')
        .replace(/.*\/_insight\//, '')
        .replace(/.*\/_problem\//, '')
        .replace(/.*\/_tool\//, '')
        .replace(/.*\/_event\//, '')
        .replace(/.*\/_adr\//, '')
        .replace(/\.md$/, '');
}

function extractFrontMatter(content) {
    var m = content.match(/^---([\s\S]*?)---/);
    return m ? m[1] : '';
}

function extractTitle(content) {
    var m = content.match(/^title\s*[:\s]+(.+)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

function extractBody(content) {
    // front matter 제거
    var body = content.replace(/^---[\s\S]*?---\n/, '');
    // 기존 다이어그램 제거
    body = body.replace(/<!-- diagram start -->[\s\S]*?<!-- diagram end -->\n*/g, '');
    return body
        .replace(/```[\s\S]*?```/g, '')           // 코드블록
        .replace(/`[^`]+`/g, '')                  // 인라인 코드
        .replace(/!\[.*?\]\(.*?\)/g, '')          // 이미지
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // 링크 → 텍스트
        .replace(/\[\[.*?\]\]/g, '')              // 위키 링크
        .replace(/#+\s/g, '')                     // 헤딩 마커
        .replace(/[*_~]/g, '')                    // 마크다운 기호
        .replace(/\{[^}]+\}/g, '')                // kramdown 속성
        .replace(/<[^>]+>/g, '')                  // HTML 태그
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, 4000);
}

// ── 메인 ──────────────────────────────────────────────────────
async function main() {
    var cache = {};
    if (fs.existsSync(DIAGRAMS_FILE)) {
        try { cache = JSON.parse(fs.readFileSync(DIAGRAMS_FILE, 'utf8')); } catch (e) {}
    }

    var results   = Object.assign({}, cache);
    var generated = 0;
    var skipped   = 0;
    var failed    = 0;

    for (var i = 0; i < files.length; i++) {
        var filePath = files[i];
        var slug     = slugFromPath(filePath);

        var content = fs.readFileSync(filePath, 'utf8');
        var hash    = crypto.createHash('md5').update(content).digest('hex');

        if (!FORCE && results[slug] && results[slug].hash === hash) {
            skipped++;
            process.stdout.write('[캐시] ' + slug + '\n');
            continue;
        }

        if (!/^show-diagram\s*:\s*true/m.test(content)) {
            process.stdout.write('[건너뜀] ' + slug + ' (show-diagram 없음)\n');
            continue;
        }

        var title   = extractTitle(content);
        var body    = extractBody(content);

        if (body.length < 150) {
            process.stdout.write('[건너뜀] ' + slug + ' (내용 부족)\n');
            continue;
        }

        try {
            process.stdout.write('[생성] ' + slug + '... ');
            var raw = await generateDiagram(title || slug, body);
            var diagram = parseAndValidate(raw);

            if (!diagram) {
                process.stdout.write('생략 (파싱 실패 또는 빈 그래프)\n');
                if (raw) process.stderr.write('[raw] ' + raw.substring(0, 200) + '\n');
                failed++;
                continue;
            }

            results[slug] = { hash: hash, nodes: diagram.nodes, edges: diagram.edges };
            generated++;
            process.stdout.write('완료 (' + diagram.nodes.length + '노드, ' + diagram.edges.length + '엣지)\n');
            fs.writeFileSync(DIAGRAMS_FILE, JSON.stringify(results, null, 2));
        } catch (e) {
            var cause = e.cause ? ' (' + e.cause.message + ')' : '';
            process.stdout.write('오류: ' + e.message + cause + '\n');
            failed++;
        }
    }

    // 삭제된 파일의 stale 항목 제거
    var validSlugs = new Set(files.map(slugFromPath));
    var removed = 0;
    Object.keys(results).forEach(function (k) {
        if (!validSlugs.has(k)) { delete results[k]; removed++; }
    });
    if (removed) process.stdout.write('[정리] stale 항목 ' + removed + '개 제거\n');

    fs.writeFileSync(DIAGRAMS_FILE, JSON.stringify(results, null, 2));
    console.log('\n완료: ' + generated + '개 생성, ' + skipped + '개 캐시, ' + failed + '개 실패');
}

main().catch(function (e) { console.error(e); process.exit(1); });
