#!/usr/bin/env node
/**
 * AI 다이어그램 생성기 (Mermaid)
 *
 * 실행 방법 — Google Gemini Vertex AI (서비스 계정):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *   GOOGLE_PROJECT_ID=my-project \
 *   [GOOGLE_LOCATION=asia-northeast3] \
 *   node scripts/generate-diagrams.js
 *
 * - 이미 생성된 다이어그램은 건너뜀 (캐시)
 * - 마크다운 내용 기반 Mermaid 시각화 자동 생성
 * - 포스트에 <!-- diagram --> 섹션으로 삽입
 * - --force 플래그로 전체 재생성
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const GCP_PROJECT  = process.env.GOOGLE_PROJECT_ID;
const GCP_LOCATION = process.env.GOOGLE_LOCATION || 'asia-northeast3';
const GCP_CREDS    = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const FORCE        = process.argv.includes('--force');
const MODEL        = 'gemini-2.5-flash-lite';

if (!GCP_CREDS || !GCP_PROJECT) {
    console.error('[오류] 환경 변수를 설정하세요:');
    console.error('  GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json');
    console.error('  GOOGLE_PROJECT_ID=my-project');
    process.exit(1);
}

console.log('[백엔드] Vertex AI — ' + MODEL + ' (' + GCP_LOCATION + ')');

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
        '기술 블로그의 복잡한 개념을 Mermaid 다이어그램으로 시각화하는 AI.',
        '텍스트에서 구조, 흐름, 관계를 추출해 명확한 다이어그램을 생성한다.',
        '',
        '# 출력 형식',
        'Mermaid 다이어그램 코드만 반환. 마크다운 펜스(```), 설명, JSON 일절 금지.',
        '',
        '# 선택 기준',
        '내용에 맞는 Mermaid 종류를 선택:',
        '  - 시간 순서, 단계, 호출 흐름 → sequenceDiagram',
        '  - 클래스/엔티티 관계 → graph LR (또는 TD)',
        '  - 상태 변화 → stateDiagram-v2',
        '  - 프로세스 흐름 → flowchart TD',
        '  - 계층 구조 → graph TD',
        '',
        '# 규칙',
        '- 제목은 명확하게 (예: "JPA 트랜잭션 흐름", "Kafka 메시지 처리")',
        '- 한글과 영문 섞임 허용 (기술용어는 영문 유지)',
        '- 노드/상태는 간결하게, 30자 이내',
        '- 주요 개념만 포함 (세부사항 제외)',
        '- 다이어그램이 타당하지 않으면 빈 줄 반환 ("") → 생성 스킵',
        '',
        '# 예시',
        '',
        '## Input (JPA 트랜잭션 내용)',
        '트랜잭션 시작 → SQL 실행 → Dirty Checking → 커밋 → 종료',
        '',
        '## Output',
        'sequenceDiagram',
        '    participant Client',
        '    participant JPA',
        '    participant DB',
        '    Client->>JPA: @Transactional',
        '    JPA->>JPA: PersistenceContext 생성',
        '    JPA->>DB: SQL 실행',
        '    JPA->>JPA: Dirty Checking',
        '    JPA->>DB: UPDATE 쿼리',
        '    JPA->>DB: COMMIT',
        '',
        '---',
        '',
        '제목: ' + title,
        '',
        '내용 (마크다운):',
        body,
    ].join('\n');
}

// ── Vertex AI 클라이언트 ────────────────────────────────────────
var ai;
async function initClient() {
    if (ai) return;
    var { GoogleGenAI } = require('@google/genai');
    ai = new GoogleGenAI({
        vertexai: true,
        project: GCP_PROJECT,
        location: GCP_LOCATION,
    });
}

async function generateDiagram(title, body) {
    await initClient();
    var response = await ai.models.generateContent({
        model: MODEL,
        contents: buildPrompt(title, body),
        config: {
            maxOutputTokens: 1000,
            temperature: 0.4,
            topP: 0.9,
        },
    });
    return response.text.trim();
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
collectMarkdown(path.join(ROOT, '_wiki'), files);
collectMarkdown(path.join(ROOT, '_posts'), files);
console.log('총 ' + files.length + '개 파일 발견' + (FORCE ? ' (--force: 전체 재생성)' : ''));

function slugFromPath(p) {
    return p.replace(/.*\/_wiki\//, '').replace(/.*\/_posts\//, '').replace(/\.md$/, '');
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

function insertDiagramToFile(filePath, diagram) {
    var content = fs.readFileSync(filePath, 'utf8');

    // front matter 이후에 다이어그램 섹션 삽입
    var frontMatterEnd = content.indexOf('---', 3) + 3;
    var afterFrontMatter = content.substring(frontMatterEnd);

    // 기존 다이어그램 제거
    afterFrontMatter = afterFrontMatter.replace(/<!-- diagram start -->[\s\S]*?<!-- diagram end -->\n*/g, '');

    var diagramBlock = '\n<!-- diagram start -->\n```mermaid\n' + diagram + '\n```\n<!-- diagram end -->\n';
    var newContent = content.substring(0, frontMatterEnd) + diagramBlock + afterFrontMatter;

    fs.writeFileSync(filePath, newContent, 'utf8');
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

        if (!FORCE && results[slug]) {
            skipped++;
            process.stdout.write('[캐시] ' + slug + '\n');
            continue;
        }

        var content = fs.readFileSync(filePath, 'utf8');
        var title   = extractTitle(content);
        var body    = extractBody(content);

        if (body.length < 150) {
            process.stdout.write('[건너뜀] ' + slug + ' (내용 부족)\n');
            continue;
        }

        try {
            process.stdout.write('[생성] ' + slug + '... ');
            var diagram = await generateDiagram(title || slug, body);

            // 빈 다이어그램은 건너뜀
            if (!diagram || diagram.trim() === '') {
                process.stdout.write('생략 (다이어그램 불가)\n');
                failed++;
                continue;
            }

            results[slug] = diagram;
            insertDiagramToFile(filePath, diagram);
            generated++;
            process.stdout.write('완료 (' + diagram.split('\n').length + '줄)\n');
            fs.writeFileSync(DIAGRAMS_FILE, JSON.stringify(results, null, 2));
            await new Promise(function (r) { setTimeout(r, 600); });
        } catch (e) {
            process.stdout.write('오류: ' + e.message + '\n');
            failed++;
        }
    }

    fs.writeFileSync(DIAGRAMS_FILE, JSON.stringify(results, null, 2));
    console.log('\n완료: ' + generated + '개 생성, ' + skipped + '개 캐시, ' + failed + '개 실패');
}

main().catch(function (e) { console.error(e); process.exit(1); });
