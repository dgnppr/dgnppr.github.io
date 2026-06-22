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
const MODEL        = 'gemini-2.5-flash';

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
        '기술 블로그 포스트의 핵심 서사를 Mermaid 다이어그램 하나로 압축하는 AI.',
        '독자가 다이어그램만 보고도 "이 글의 핵심이 뭔지" 바로 알 수 있어야 한다.',
        '',
        '# 출력 형식',
        'Mermaid 코드만 반환. 마크다운 펜스(```), 제목, 설명, JSON 일절 금지.',
        '',
        '# 글 유형별 최적 형식',
        '',
        '## 문제 해결형 (트러블슈팅·적용기·삽질기)',
        '→ flowchart TD: 문제 발생 → 원인 분석 → 해결 과정 → 결과',
        '→ stateDiagram-v2: 시스템 상태 변화가 핵심일 때',
        '',
        '## 개념 설명형 (원리·동작 방식·비교)',
        '→ mindmap: 개념 간 관계·계층 구조 표현',
        '→ flowchart LR: 데이터·요청 흐름 표현',
        '',
        '## 회고·에세이형 (경험·생각 정리)',
        '→ mindmap: 핵심 인사이트와 관련 개념 연결',
        '→ timeline: 시간 순 경험 변화가 핵심일 때',
        '',
        '## 시스템 설계형 (아키텍처·설계 결정)',
        '→ flowchart TD: 컴포넌트와 데이터 흐름',
        '→ sequenceDiagram: 서비스 간 상호작용이 핵심일 때',
        '',
        '# 규칙',
        '- 노드/항목 레이블: 20자 이내, 핵심 단어만',
        '- 한글·영문 혼용 허용 (기술 용어는 영문)',
        '- 노드 수: 6~12개 (mindmap은 루트 포함 12개 이내)',
        '- 인과 관계나 흐름이 있으면 화살표로 명시',
        '- 다이어그램이 글의 핵심을 담기 어려우면 빈 줄("") 반환',
        '',
        '# Few-shot 예시',
        '',
        '## 예시 1 — 문제 해결형 (Circuit Breaker 적용기)',
        '### Output',
        'flowchart TD',
        '    A[제휴사 API 타임아웃] --> B[Kafka 컨슈머 랙 폭증]',
        '    B --> C[Convoy Effect]',
        '    C --> D[정상 제휴사도 지연]',
        '    D --> E{해결책}',
        '    E --> F[Circuit Breaker 도입]',
        '    F --> G[CLOSED → OPEN → HALF-OPEN]',
        '    G --> H[장애 격리 성공]',
        '',
        '## 예시 2 — 개념 설명형 (JPA Dirty Checking)',
        '### Output',
        'flowchart LR',
        '    A[Entity 조회] --> B[1차 캐시 저장]',
        '    B --> C[스냅샷 생성]',
        '    C --> D[트랜잭션 종료]',
        '    D --> E[스냅샷 비교]',
        '    E -->|변경 감지| F[UPDATE 쿼리 자동 실행]',
        '    E -->|변경 없음| G[쿼리 생략]',
        '',
        '## 예시 3 — 회고형 (연간 회고)',
        '### Output',
        'mindmap',
        '  root((2024 회고))',
        '    성장',
        '      시스템 설계 학습',
        '      팀 협업 경험',
        '    도전',
        '      레거시 개선',
        '      장애 대응',
        '    다음 목표',
        '      오픈소스 기여',
        '      글쓰기 습관',
        '',
        '---',
        '',
        '제목: ' + title,
        '',
        '내용:',
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
            thinkingConfig: { thinkingBudget: 0 },
        },
    });
    if (!response.text) {
        var candidate = response.candidates && response.candidates[0];
        process.stderr.write(
            '[빈응답] finishReason=' + (candidate && candidate.finishReason) +
            ' promptFeedback=' + JSON.stringify(response.promptFeedback) +
            ' safetyRatings=' + JSON.stringify(candidate && candidate.safetyRatings) + '\n'
        );
    }
    return (response.text || '').trim();
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
            var diagram = await generateDiagram(title || slug, body);

            // 빈 다이어그램은 건너뜀
            if (!diagram || diagram.trim() === '') {
                process.stdout.write('생략 (다이어그램 불가)\n');
                failed++;
                continue;
            }

            results[slug] = diagram;
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
