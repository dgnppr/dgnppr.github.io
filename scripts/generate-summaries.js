#!/usr/bin/env node
/**
 * 위키/포스트 AI 요약 생성기
 *
 * 실행 방법 — Google Gemini Vertex AI (서비스 계정):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *   GOOGLE_PROJECT_ID=my-project \
 *   [GOOGLE_LOCATION=asia-northeast3] \
 *   node scripts/generate-summaries.js
 *
 * - 이미 생성된 슬러그는 건너뜀 (캐시)
 * - 내용이 100자 미만인 파일은 건너뜀
 * - 500ms 딜레이로 레이트 리밋 방지
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
const SUMMARIES_FILE = path.join(ROOT, 'data/summaries.json');

// ── 프롬프트 ───────────────────────────────────────────────────
function buildPrompt(title, body) {
    return [
        '# 역할',
        '기술 블로그 포스트 요약 AI. 독자가 3초 안에 이 글의 가치를 판단할 수 있도록,',
        '핵심 기술 개념과 실질적 인사이트를 간결하게 전달한다.',
        '',
        '# 출력 형식',
        '3~4문장, 200~280자. 요약 텍스트만 반환. JSON, 마크다운, 주석 일절 금지.',
        '',
        '# 작성 규칙',
        '- 첫 문장: 이 글이 다루는 기술적 문제 또는 질문을 구체적으로 서술',
        '- 중간 문장: 핵심 메커니즘, 원인 분석, 또는 해결 접근법',
        '- 마지막 문장: 독자가 얻는 실질적 인사이트 또는 실무 적용 포인트',
        '- 기술 용어(JVM, JPA, Circuit Breaker, Kafka 등)는 번역 없이 그대로 사용',
        '- 한국어만 사용. 영어 설명·번역 금지',
        '',
        '# 절대 금지',
        '- "이 글은", "이 포스트는", "작성자는", "저자는" 같은 메타 표현',
        '- "설명합니다", "다루고 있습니다", "소개합니다" 같은 메타 동사',
        '- "독자는", "개발자는" 같은 주체 명시',
        '- 단순 목차 나열 (A, B, C를 설명... 형태)',
        '- 80자 이하 초단 요약',
        '',
        '# 예시',
        '',
        '## Bad (메타 표현, 나열)',
        '"이 글은 JPA Dirty Checking에 대해 설명합니다. Dirty Checking의 개념과 동작 원리를',
        '다루고 있으며, 개발자들이 알아야 할 사용법을 소개합니다."',
        '',
        '## Good (구체적 문제 → 메커니즘 → 인사이트)',
        '"JPA의 Dirty Checking은 PersistenceContext가 엔티티 스냅샷을 관리해 트랜잭션',
        '종료 시 변경된 필드를 자동으로 UPDATE 쿼리로 반영하는 메커니즘이다. 영속성 컨텍스트',
        '밖의 Detached 엔티티나 벌크 업데이트 시에는 적용되지 않아 변경이 누락될 수 있다.',
        'save() 없이도 동작하는 편의성 이면에 이 경계를 정확히 이해해야 불필요한 UPDATE와',
        '성능 이슈를 예방할 수 있다."',
        '',
        '## Bad (80자 초단 → 금지)',
        '"JPA Dirty Checking 동작 원리와 사용 시 주의점을 다룬다."',
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

async function generateSummary(title, body) {
    await initClient();
    var response = await ai.models.generateContent({
        model: MODEL,
        contents: buildPrompt(title, body),
        config: {
            maxOutputTokens: 600,
            temperature: 0.45,
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
        throw new Error('모델이 빈 응답을 반환했습니다.');
    }
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

function extractTitle(content) {
    var m = content.match(/^title\s*[:\s]+(.+)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

function extractBody(content) {
    // front matter 제거
    var body = content.replace(/^---[\s\S]*?---\n/, '');
    return body
        .replace(/```[\s\S]*?```/g, '')           // 코드블록
        .replace(/`[^`]+`/g, '')                  // 인라인 코드
        .replace(/!\[.*?\]\(.*?\)/g, '')           // 이미지
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // 링크 → 텍스트
        .replace(/\[\[.*?\]\]/g, '')               // 위키 링크
        .replace(/#+\s/g, '')                      // 헤딩 마커
        .replace(/[*_~]/g, '')                     // 마크다운 기호
        .replace(/\{[^}]+\}/g, '')                 // kramdown 속성
        .replace(/<[^>]+>/g, '')                   // HTML 태그
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, 3000);
}

// ── 메인 ──────────────────────────────────────────────────────
async function main() {
    var cache = {};
    if (fs.existsSync(SUMMARIES_FILE)) {
        try { cache = JSON.parse(fs.readFileSync(SUMMARIES_FILE, 'utf8')); } catch (e) {}
    }

    var results   = Object.assign({}, cache);
    var generated = 0;
    var skipped   = 0;

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

        if (body.length < 100) {
            process.stdout.write('[건너뜀] ' + slug + ' (내용 부족)\n');
            continue;
        }

        try {
            process.stdout.write('[생성] ' + slug + '... ');
            var summary = await generateSummary(title || slug, body);
            results[slug] = summary;
            generated++;
            process.stdout.write('완료 (' + summary.length + '자)\n');
            fs.writeFileSync(SUMMARIES_FILE, JSON.stringify(results, null, 2));
            await new Promise(function (r) { setTimeout(r, 500); });
        } catch (e) {
            process.stdout.write('오류: ' + e.message + '\n');
        }
    }

    fs.writeFileSync(SUMMARIES_FILE, JSON.stringify(results, null, 2));
    console.log('\n완료: ' + generated + '개 생성, ' + skipped + '개 캐시 사용');
}

main().catch(function (e) { console.error(e); process.exit(1); });
