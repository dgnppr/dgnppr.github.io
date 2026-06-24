#!/usr/bin/env node
/**
 * ADR 임베딩 생성기
 *
 * 실행 (Vertex AI):
 *   GOOGLE_APPLICATION_CREDENTIALS=resource/credentials/credentials.json \
 *   GOOGLE_PROJECT_ID=my-project \
 *   node scripts/generate-adr-embeddings.js
 *
 * 실행 (Ollama):
 *   EMBEDDING_BACKEND=ollama \
 *   [OLLAMA_URL=http://localhost:11434] \
 *   node scripts/generate-adr-embeddings.js
 *
 * - 캐시: data/adr-embeddings.json (내용 변경 시에만 재계산)
 * - --force: 전체 재계산
 */
'use strict';
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const GCP_PROJECT  = process.env.GOOGLE_PROJECT_ID;
const GCP_LOCATION = process.env.GOOGLE_LOCATION || 'asia-northeast3';
const GCP_CREDS    = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const OLLAMA_URL   = process.env.OLLAMA_URL || 'http://localhost:11434';
const BACKEND      = process.env.EMBEDDING_BACKEND || 'vertexai';
const FORCE        = process.argv.includes('--force');

const MODEL = BACKEND === 'ollama' ? 'bge-m3' : 'text-embedding-004';
const DIMS  = BACKEND === 'ollama' ? 1024     : 768;

if (BACKEND === 'vertexai' && (!GCP_CREDS || !GCP_PROJECT)) {
    console.error('[오류] 환경 변수를 설정하세요:');
    console.error('  GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json');
    console.error('  GOOGLE_PROJECT_ID=my-project');
    process.exit(1);
}

const backendLabel = BACKEND === 'ollama'
    ? 'Ollama — ' + MODEL + ' (' + OLLAMA_URL + ')'
    : 'Vertex AI — ' + MODEL + ' (' + GCP_LOCATION + ')';
console.log('[백엔드] ' + backendLabel);

const ROOT       = path.join(__dirname, '..');
const ADR_DIR    = path.join(ROOT, '_adr');
const CACHE_FILE = path.join(ROOT, 'data/adr-embeddings.json');

function collectMarkdown(dir, results) {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(f => {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) {
            collectMarkdown(full, results);
        } else if (f.endsWith('.md')) {
            results.push(full);
        }
    });
}

function slugFromPath(p) {
    return p.replace(/.*\/_adr\//, '').replace(/\.md$/, '');
}

function parseFrontmatter(content) {
    const m = content.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return {};
    const obj = {};
    m[1].split('\n').forEach(line => {
        const r = /^\s*([^:]+):\s*(.+)\s*$/.exec(line);
        if (r) obj[r[1].trim()] = r[2].trim().replace(/^["']|["']$/g, '');
    });
    return obj;
}

function extractBody(content) {
    return content
        .replace(/^---[\s\S]*?---\n/, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`]+`/g, '')
        .replace(/!\[.*?\]\(.*?\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/#+\s/g, '')
        .replace(/[*_~]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1500);
}

let ai;
async function embed(text) {
    if (BACKEND === 'ollama') {
        const res = await fetch(OLLAMA_URL + '/api/embeddings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: MODEL, prompt: text }),
        });
        if (!res.ok) throw new Error('Ollama HTTP ' + res.status + ': ' + await res.text());
        const json = await res.json();
        if (!json.embedding) throw new Error('임베딩 응답 형식 오류');
        return json.embedding;
    }

    if (!ai) {
        const { GoogleGenAI } = require('@google/genai');
        ai = new GoogleGenAI({ vertexai: true, project: GCP_PROJECT, location: GCP_LOCATION });
    }
    const response = await ai.models.embedContent({
        model: MODEL,
        contents: text,
        config: { outputDimensionality: DIMS },
    });
    const emb = (response.embeddings && response.embeddings[0] && response.embeddings[0].values)
             || (response.embedding && response.embedding.values);
    if (!emb) throw new Error('임베딩 응답 형식 오류');
    return emb;
}

const files = [];
collectMarkdown(ADR_DIR, files);
console.log('총 ' + files.length + '개 ADR 파일 발견' + (FORCE ? ' (--force: 전체 재계산)' : ''));

async function main() {
    let cache = {};
    if (fs.existsSync(CACHE_FILE)) {
        try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (e) {}
    }

    let cacheUpdated = false;

    for (const filePath of files) {
        const content = fs.readFileSync(filePath, 'utf8');
        const fm      = parseFrontmatter(content);
        const slug    = slugFromPath(filePath);
        const body    = extractBody(content);
        const text    = [fm.title || '', fm.status || '', body].filter(Boolean).join('\n').slice(0, 2000);
        const hash    = crypto.createHash('md5').update(text).digest('hex');
        const cached  = cache[slug];

        if (!FORCE && cached && cached.hash === hash && cached.embedding.length === DIMS) {
            process.stdout.write('[캐시] ' + slug + '\n');
            continue;
        }

        if (text.trim().length < 50) {
            process.stdout.write('[건너뜀] ' + slug + ' (내용 부족)\n');
            continue;
        }

        try {
            process.stdout.write('[임베딩] ' + slug + '... ');
            const embedding = await embed(text);
            cache[slug]  = { hash, embedding };
            cacheUpdated = true;
            process.stdout.write('완료 (' + embedding.length + '차원)\n');
            fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
            await new Promise(r => setTimeout(r, 200));
        } catch (e) {
            process.stdout.write('오류: ' + e.message + '\n');
        }
    }

    // stale 항목 제거
    const validSlugs = new Set(files.map(f => slugFromPath(f)));
    Object.keys(cache).forEach(k => {
        if (!validSlugs.has(k)) { delete cache[k]; cacheUpdated = true; }
    });

    if (cacheUpdated) {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
        console.log('[저장] data/adr-embeddings.json');
    }

    console.log('\n완료!');
}

main().catch(e => { console.error(e); process.exit(1); });
