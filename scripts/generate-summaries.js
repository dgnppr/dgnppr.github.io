#!/usr/bin/env node
/**
 * 위키/포스트 AI 요약 생성기
 *
 * 실행 방법 — LM Studio (로컬):
 *   [LM_STUDIO_BASE_URL=http://localhost:1234/v1] \
 *   [LM_STUDIO_MODEL=local-model] \
 *   node scripts/generate-summaries.js
 *
 * - 내용 hash 기반 캐시 (수정 시 자동 재생성, 삭제 시 stale 항목 제거)
 * - 내용이 100자 미만인 파일은 건너뜀
 * - --force 플래그로 전체 재생성
 */
'use strict';
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// .env 로더 (shell 환경변수 우선)
(function loadEnv() {
    const p = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(p)) return;
    fs.readFileSync(p, 'utf8').split('\n').forEach(line => {
        const m = /^\s*([^#=\s][^=]*?)\s*=\s*(.*?)\s*$/.exec(line);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
})();

const BACKEND      = process.env.LLM_BACKEND || 'lmstudio'; // 'lmstudio' | 'vertexai'
const LM_BASE_URL  = (process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234/v1').replace(/\/$/, '');
const LM_MODEL     = process.env.LM_STUDIO_MODEL || 'gemma-4-12b-coder-fable5-composer2.5-v1';
const GCP_PROJECT  = process.env.GOOGLE_PROJECT_ID;
const GCP_LOCATION = process.env.GOOGLE_LOCATION || 'asia-northeast3';
const GCP_CREDS    = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const FORCE        = process.argv.includes('--force');

if (BACKEND === 'vertexai' && (!GCP_CREDS || !GCP_PROJECT)) {
    console.error('[오류] vertexai 백엔드에 필요한 환경 변수를 설정하세요:');
    console.error('  GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json');
    console.error('  GOOGLE_PROJECT_ID=my-project');
    process.exit(1);
}

const backendLabel = BACKEND === 'vertexai'
    ? 'Vertex AI — gemini-2.5-flash (' + GCP_LOCATION + ')'
    : 'LM Studio — ' + LM_MODEL + ' (' + LM_BASE_URL + ')';
console.log('[백엔드] ' + backendLabel);

const ROOT                = path.join(__dirname, '..');
const SUMMARIES_FILE      = path.join(ROOT, 'data/summaries.json');
const SUMMARIES_HASH_FILE = path.join(ROOT, 'data/summaries-hashes.json');

// thinking 모델: reasoning_content에서 최종 한국어 요약만 추출
function extractKoreanSummary(thinking) {
    // 패턴 1: "Draft 2 ... Korean): 한국어 텍스트" 형태
    const draft = thinking.match(/Draft\s*2[^:]*:\*?\s*([가-힯][^*\n]{50,})/);
    if (draft) return draft[1].trim();

    // 패턴 2: "Sentence 1/2/3 ...: 한국어" 라벨 분리형 → 이어붙이기
    const sentences = [...thinking.matchAll(/Sentence\s*\d[^:]*:\*?\s*([가-힯][^*\n]+)/g)];
    if (sentences.length >= 2) return sentences.map(s => s[1].trim()).join(' ');

    // 패턴 3: 마지막 한국어 단락 (Length Check 이전)
    const beforeCheck = thinking.split(/Length Check|Character Count/i)[0];
    const blocks = beforeCheck.split(/\n{2,}/);
    const korean = blocks.filter(b => (b.match(/[가-힯]/g) || []).length > 20);
    return korean.pop()?.replace(/^[*\s]+|[*\s]+$/g, '').trim() || '';
}

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

let _vertexAi;
async function generateSummary(title, body) {
    const prompt = buildPrompt(title, body);

    if (BACKEND === 'vertexai') {
        if (!_vertexAi) {
            const { GoogleGenAI } = require('@google/genai');
            _vertexAi = new GoogleGenAI({ vertexai: true, project: GCP_PROJECT, location: GCP_LOCATION });
        }
        const response = await _vertexAi.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { maxOutputTokens: 600, temperature: 0.45, topP: 0.9, thinkingConfig: { thinkingBudget: 0 } },
        });
        if (!response.text) throw new Error('모델이 빈 응답을 반환했습니다.');
        return response.text.trim();
    }

    // lmstudio (OpenAI-compatible)
    const res = await fetch(LM_BASE_URL + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: LM_MODEL,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 4096,
            temperature: 0.45,
            top_p: 0.9,
        }),
    });
    if (!res.ok) throw new Error('LM Studio HTTP ' + res.status + ': ' + await res.text());
    const data = await res.json();
    const msg  = data.choices?.[0]?.message;
    const text = msg?.content || extractKoreanSummary(msg?.reasoning_content || '');
    if (!text) {
        process.stderr.write('[raw] ' + JSON.stringify(data).slice(0, 500) + '\n');
        throw new Error('모델이 빈 응답을 반환했습니다.');
    }
    return text.trim();
}

function collectMarkdown(dir, results) {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(f => {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) {
            collectMarkdown(full, results);
        } else if (f.endsWith('.md') && !f.startsWith('_') && f !== 'README.md') {
            results.push(full);
        }
    });
}

const files = [];
collectMarkdown(path.join(ROOT, '_wiki'),    files);
collectMarkdown(path.join(ROOT, '_insight'), files);
collectMarkdown(path.join(ROOT, '_problem'), files);
collectMarkdown(path.join(ROOT, '_tool'),    files);
collectMarkdown(path.join(ROOT, '_event'),   files);
collectMarkdown(path.join(ROOT, '_adr'),     files);
console.log('총 ' + files.length + '개 파일 발견' + (FORCE ? ' (--force: 전체 재생성)' : ''));

function slugFromPath(p) {
    return p
        .replace(/.*\/_wiki\//, '')
        .replace(/.*\/_posts\//, '')
        .replace(/.*\/_insight\//, '')
        .replace(/.*\/_problem\//, '')
        .replace(/.*\/_tool\//, '')
        .replace(/.*\/_event\//, '')
        .replace(/.*\/_adr\//, '')
        .replace(/\.md$/, '');
}

function extractTitle(content) {
    const m = content.match(/^title\s*[:\s]+(.+)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

function extractBody(content) {
    return content
        .replace(/^---[\s\S]*?---\n/, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`]+`/g, '')
        .replace(/!\[.*?\]\(.*?\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\[\[.*?\]\]/g, '')
        .replace(/#+\s/g, '')
        .replace(/[*_~]/g, '')
        .replace(/\{[^}]+\}/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, 3000);
}

async function main() {
    let results   = {};
    let hashCache = {};
    if (fs.existsSync(SUMMARIES_FILE))      try { results   = JSON.parse(fs.readFileSync(SUMMARIES_FILE, 'utf8'));      } catch (e) {}
    if (fs.existsSync(SUMMARIES_HASH_FILE)) try { hashCache = JSON.parse(fs.readFileSync(SUMMARIES_HASH_FILE, 'utf8')); } catch (e) {}

    let generated = 0;
    let skipped   = 0;

    for (const filePath of files) {
        const slug    = slugFromPath(filePath);
        const content = fs.readFileSync(filePath, 'utf8');
        const hash    = crypto.createHash('md5').update(content).digest('hex');

        if (!FORCE && results[slug] && hashCache[slug] === hash) {
            skipped++;
            process.stdout.write('[캐시] ' + slug + '\n');
            continue;
        }

        const title = extractTitle(content);
        const body  = extractBody(content);

        if (body.length < 100) {
            process.stdout.write('[건너뜀] ' + slug + ' (내용 부족)\n');
            continue;
        }

        try {
            process.stdout.write('[생성] ' + slug + '... ');
            const summary   = await generateSummary(title || slug, body);
            results[slug]   = summary;
            hashCache[slug] = hash;
            generated++;
            process.stdout.write('완료 (' + summary.length + '자)\n');
            fs.writeFileSync(SUMMARIES_FILE,      JSON.stringify(results,   null, 2));
            fs.writeFileSync(SUMMARIES_HASH_FILE, JSON.stringify(hashCache, null, 2));
        } catch (e) {
            const cause = e.cause ? ' (' + e.cause.message + ')' : '';
            process.stdout.write('오류: ' + e.message + cause + '\n');
        }
    }

    const validSlugs = new Set(files.map(slugFromPath));
    let removed = 0;
    Object.keys(results).forEach(k => {
        if (!validSlugs.has(k)) { delete results[k]; delete hashCache[k]; removed++; }
    });
    if (removed) process.stdout.write('[정리] stale 항목 ' + removed + '개 제거\n');

    fs.writeFileSync(SUMMARIES_FILE,      JSON.stringify(results,   null, 2));
    fs.writeFileSync(SUMMARIES_HASH_FILE, JSON.stringify(hashCache, null, 2));
    console.log('\n완료: ' + generated + '개 생성, ' + skipped + '개 캐시 사용');
}

main().catch(e => { console.error(e); process.exit(1); });
