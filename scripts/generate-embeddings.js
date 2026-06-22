#!/usr/bin/env node
/**
 * 임베딩 기반 연관 포스트 생성기
 *
 * Gemini text-embedding-004 로 각 글의 의미 벡터를 생성하고,
 * 코사인 유사도 상위 5개를 data/related.json 으로 덮어씁니다.
 *
 * 실행:
 *   GOOGLE_APPLICATION_CREDENTIALS=resource/credentials/credentials.json \
 *   GOOGLE_PROJECT_ID=himart-cdp \
 *   [GOOGLE_LOCATION=asia-northeast3] \
 *   node scripts/generate-embeddings.js
 *
 * - 임베딩 캐시: data/embeddings.json (내용 변경 시에만 재계산)
 * - --force: 전체 재계산
 */
'use strict';
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const GCP_PROJECT  = process.env.GOOGLE_PROJECT_ID;
const GCP_LOCATION = process.env.GOOGLE_LOCATION || 'asia-northeast3';
const GCP_CREDS    = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const FORCE        = process.argv.includes('--force');

const MODEL  = 'text-embedding-004';
const DIMS   = 256;
const TOP_N  = 5;

const Z_SIGMA   = 1.0;
const MIN_SCORE = 0.70;

const TAG_BONUS    = 0.03;
const TAG_PENALTY  = 0.90;
const CAT_BONUS    = 0.05;
const TITLE_BONUS  = 0.02;

const LEN_THRESHOLD        = 300;
const LEN_THRESHOLD2       = 100;
const LEN_PENALTY_FACTOR   = 0.90;
const LEN_PENALTY_FACTOR2  = 0.50;

const DATE_BONUS    = 1.02;
const DATE_PENALTY  = 0.98;

const BM25_K1     = 1.5;
const BM25_B      = 0.75;
const BM25_WEIGHT = 0.15;

if (!GCP_CREDS || !GCP_PROJECT) {
    console.error('[오류] 환경 변수를 설정하세요:');
    console.error('  GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json');
    console.error('  GOOGLE_PROJECT_ID=my-project');
    process.exit(1);
}

console.log('[백엔드] Vertex AI — ' + MODEL + ' (' + GCP_LOCATION + ')');

const ROOT         = path.join(__dirname, '..');
const CACHE_FILE   = path.join(ROOT, 'data/embeddings.json');
const RELATED_FILE = path.join(ROOT, 'data/related.json');

// ── 유틸리티 ──────────────────────────────────────────────────

function collectMarkdown(dir, type, results) {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(f => {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) {
            collectMarkdown(full, type, results);
        } else if (f.endsWith('.md') && !f.startsWith('_') && f !== 'README.md') {
            results.push({ path: full, type });
        }
    });
}

function slugFromPath(p, type) {
    if (type === 'wiki') return p.replace(/.*\/_wiki\//, '').replace(/\.md$/, '');
    return p.replace(/.*\/_posts\//, '').replace(/\.md$/, '');
}

function urlFromPath(p, type, fm) {
    if (type === 'wiki') return p.replace(/.*\/_wiki/, '/wiki').replace(/\.md$/, '');
    if (fm && fm.date) {
        const d    = fm.date.slice(0, 10).replace(/-/g, '/');
        const base = path.basename(p, '.md').replace(/^\d{4}-\d{2}-\d{2}-/, '');
        return '/blog/' + d + '/' + base;
    }
    return p.replace(/.*\/_posts/, '/blog').replace(/\.md$/, '');
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
        .replace(/\[\[.*?\]\]/g, '')
        .replace(/#+\s/g, '')
        .replace(/[*_~]/g, '')
        .replace(/\{[^}]+\}/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1500);
}

function cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na  += a[i] * a[i];
        nb  += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function tokenize(text) {
    return (text || '').toLowerCase()
        .replace(/[^\w가-힣]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 2);
}

function categoryOf(slug, type) {
    return type === 'wiki' ? slug.split('/')[0] : 'blog';
}

function titleToks(title) {
    return (title || '').toLowerCase()
        .replace(/[^\w가-힣]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 2);
}

// ── Vertex AI 클라이언트 ───────────────────────────────────────

let ai;
async function initClient() {
    if (ai) return;
    const { GoogleGenAI } = require('@google/genai');
    ai = new GoogleGenAI({ vertexai: true, project: GCP_PROJECT, location: GCP_LOCATION });
}

async function embed(text) {
    await initClient();
    const response = await ai.models.embedContent({
        model: MODEL,
        contents: text,
        config: { outputDimensionality: DIMS },
    });
    const emb = (response.embeddings && response.embeddings[0] && response.embeddings[0].values)
             || (response.embedding  && response.embedding.values);
    if (!emb) throw new Error('임베딩 응답 형식 오류: ' + JSON.stringify(Object.keys(response)));
    return emb;
}

// ── 메인 ──────────────────────────────────────────────────────

const files = [];
collectMarkdown(path.join(ROOT, '_wiki'),  'wiki', files);
collectMarkdown(path.join(ROOT, '_posts'), 'blog', files);
console.log('총 ' + files.length + '개 파일 발견' + (FORCE ? ' (--force: 전체 재계산)' : ''));

async function main() {
    let cache = {};
    if (fs.existsSync(CACHE_FILE)) try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (e) {}

    const docs       = [];
    let cacheUpdated = false;

    for (const file of files) {
        const content = fs.readFileSync(file.path, 'utf8');
        const fm      = parseFrontmatter(content);

        if (fm.public === 'false') continue;

        const slug  = slugFromPath(file.path, file.type);
        const url   = urlFromPath(file.path, file.type, fm);
        const body  = extractBody(content);
        const text  = [fm.title || '', fm.summary || '', body].filter(Boolean).join('\n').slice(0, 2000);
        const hash  = crypto.createHash('md5').update(text).digest('hex');
        const tags  = fm.tag ? fm.tag.split(/\s+/).filter(Boolean) : [];
        const cached = cache[slug];

        if (!FORCE && cached && cached.hash === hash && cached.embedding.length === DIMS) {
            process.stdout.write('[캐시] ' + slug + '\n');
            docs.push({ slug, url, title: fm.title || slug, tags, embedding: cached.embedding, body, bodyLen: body.length, date: fm.date || fm.updated || null, type: file.type });
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
            docs.push({ slug, url, title: fm.title || slug, tags, embedding, body, bodyLen: body.length, date: fm.date || fm.updated || null, type: file.type });
            process.stdout.write('완료 (' + embedding.length + '차원)\n');
            fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
            await new Promise(r => setTimeout(r, 200));
        } catch (e) {
            process.stdout.write('오류: ' + e.message + '\n');
        }
    }

    console.log('\n[유사도 계산] ' + docs.length + '개 문서...');

    // ── BM25 인덱스 구축 ──────────────────────────────────────
    const tfMap = {}, dfMap = {}, dlMap = {};
    docs.forEach(doc => {
        const tokens = tokenize(doc.body || '');
        dlMap[doc.slug] = tokens.length;
        tfMap[doc.slug] = {};
        const seen = {};
        tokens.forEach(t => {
            tfMap[doc.slug][t] = (tfMap[doc.slug][t] || 0) + 1;
            if (!seen[t]) { dfMap[t] = (dfMap[t] || 0) + 1; seen[t] = true; }
        });
    });
    const avgdl = docs.reduce((s, d) => s + dlMap[d.slug], 0) / docs.length;

    function bm25(qSlug, tSlug) {
        const qTf = tfMap[qSlug] || {};
        const tTf = tfMap[tSlug] || {};
        const dl  = dlMap[tSlug] || 0;
        let s = 0;
        Object.keys(qTf).forEach(t => {
            const f = tTf[t] || 0;
            if (!f) return;
            const idf = Math.log((docs.length - (dfMap[t] || 0) + 0.5) / ((dfMap[t] || 0) + 0.5) + 1);
            s += idf * f * (BM25_K1 + 1) / (f + BM25_K1 * (1 - BM25_B + BM25_B * dl / avgdl));
        });
        return s;
    }

    // ── BM25 전체 쌍 계산 ─────────────────────────────────────
    const bm25Raw = {};
    let bm25Max   = 0;
    for (let i = 0; i < docs.length; i++) {
        for (let j = i + 1; j < docs.length; j++) {
            const key  = [docs[i].slug, docs[j].slug].sort().join('|||');
            const bRaw = (bm25(docs[i].slug, docs[j].slug) + bm25(docs[j].slug, docs[i].slug)) / 2;
            bm25Raw[key] = bRaw;
            if (bRaw > bm25Max) bm25Max = bRaw;
        }
    }

    // ── Pairwise 점수 ─────────────────────────────────────────
    const pairScores = {};
    for (let i = 0; i < docs.length; i++) {
        for (let j = i + 1; j < docs.length; j++) {
            const a   = docs[i], b = docs[j];
            const key = [a.slug, b.slug].sort().join('|||');

            let score = cosine(a.embedding, b.embedding);

            const sharedTags = (a.tags || []).filter(t => (b.tags || []).indexOf(t) !== -1).length;
            score = sharedTags > 0 ? score * (1 + TAG_BONUS * sharedTags) : score * TAG_PENALTY;

            if (categoryOf(a.slug, a.type) === categoryOf(b.slug, b.type)) score *= (1 + CAT_BONUS);

            const aToks = titleToks(a.title), bToks = titleToks(b.title);
            const sharedTitle = aToks.filter(w => bToks.indexOf(w) !== -1).length;
            if (sharedTitle > 0) score *= (1 + TITLE_BONUS * sharedTitle);

            const minLen = Math.min(a.bodyLen || 0, b.bodyLen || 0);
            if (minLen < LEN_THRESHOLD2)     score *= LEN_PENALTY_FACTOR2;
            else if (minLen < LEN_THRESHOLD) score *= LEN_PENALTY_FACTOR;

            if (a.date && b.date) {
                const daysDiff = Math.abs(new Date(a.date) - new Date(b.date)) / 86400000;
                score *= daysDiff < 90 ? DATE_BONUS : daysDiff > 365 ? DATE_PENALTY : 1;
            }

            const bNorm = bm25Max > 0 ? (bm25Raw[key] || 0) / bm25Max : 0;
            score *= (1 + BM25_WEIGHT * bNorm);

            pairScores[key] = score;
        }
    }

    // ── Z-score per doc → related.json ────────────────────────
    const related = {};
    docs.forEach(doc => {
        const scores = docs
            .filter(d => d.slug !== doc.slug)
            .map(d => {
                const key = [doc.slug, d.slug].sort().join('|||');
                return { slug: d.slug, title: d.title, url: d.url, score: pairScores[key] || 0 };
            });

        const mean = scores.reduce((s, r) => s + r.score, 0) / scores.length;
        const std  = Math.sqrt(scores.reduce((s, r) => s + Math.pow(r.score - mean, 2), 0) / scores.length);
        const threshold = mean + Z_SIGMA * std;

        const scored = scores
            .filter(r => r.score >= threshold && r.score >= MIN_SCORE)
            .sort((a, b) => b.score - a.score)
            .slice(0, TOP_N)
            .map(r => ({ slug: r.slug, title: r.title, url: r.url, score: +r.score.toFixed(3) }));

        if (scored.length > 0) related[doc.slug] = scored;
    });

    fs.writeFileSync(RELATED_FILE, JSON.stringify(related));
    console.log('[저장] data/related.json (' + Object.keys(related).length + '개 항목)');

    const validSlugs = new Set(files.map(f => slugFromPath(f.path, f.type)));
    Object.keys(cache).forEach(k => {
        if (!validSlugs.has(k)) { delete cache[k]; cacheUpdated = true; }
    });

    if (cacheUpdated) {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
        console.log('[저장] data/embeddings.json (캐시 업데이트)');
    }

    console.log('\n완료!');
}

main().catch(e => { console.error(e); process.exit(1); });
