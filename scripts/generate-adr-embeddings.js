#!/usr/bin/env node
/**
 * ADR 임베딩 생성기 — Qdrant 벡터 스토어
 *
 * 사전 준비: docker compose up qdrant -d
 *
 * 실행:
 *   [OLLAMA_URL=http://localhost:11434] \
 *   [QDRANT_URL=http://localhost:6333] \
 *   node scripts/generate-adr-embeddings.js [--force]
 */
'use strict';
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const FORCE      = process.argv.includes('--force');
const MODEL      = 'bge-m3';
const DIMS       = 1024;
const COLLECTION      = 'adr';
const WIKI_COLLECTION = 'wiki';

const ROOT      = path.join(__dirname, '..');
const ADR_DIR   = path.join(ROOT, '_adr');
const WIKI_DIR  = path.join(ROOT, '_wiki');
const POSTS_DIR = path.join(ROOT, '_posts');

function collectMarkdown(dir, results = []) {
    if (!fs.existsSync(dir)) return results;
    for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) collectMarkdown(full, results);
        else if (f.endsWith('.md')) results.push(full);
    }
    return results;
}

function slugFromPath(p) {
    return path.relative(ADR_DIR, p).replace(/\.md$/, '');
}

// Qdrant point ID: slug → UUID v4 형식 (MD5 기반)
function slugToId(slug) {
    const h = crypto.createHash('md5').update(slug).digest('hex');
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}

function parseFrontmatter(content) {
    const m = content.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return {};
    return Object.fromEntries(
        m[1].split('\n')
            .map(l => /^\s*([^:]+):\s*(.+)\s*$/.exec(l))
            .filter(Boolean)
            .map(r => [r[1].trim(), r[2].trim().replace(/^["']|["']$/g, '')])
    );
}

function extractText(content, fm) {
    const body = content
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
    return [fm.title || '', fm.status || '', body].filter(Boolean).join('\n').slice(0, 2000);
}

async function embedText(text) {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, prompt: text }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
    const { embedding } = await res.json();
    if (!embedding) throw new Error('임베딩 응답 형식 오류');
    return embedding;
}

async function qdrant(method, endpoint, body) {
    const res = await fetch(`${QDRANT_URL}${endpoint}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Qdrant ${method} ${endpoint} → HTTP ${res.status}: ${await res.text()}`);
    return res.json();
}

// ── Wiki/Post 헬퍼 ────────────────────────────────────────────

function collectWikiDocs() {
    const results = [];
    function walk(dir, type) {
        if (!fs.existsSync(dir)) return;
        for (const f of fs.readdirSync(dir)) {
            const full = path.join(dir, f);
            if (fs.statSync(full).isDirectory()) walk(full, type);
            else if (f.endsWith('.md') && !f.startsWith('_') && f !== 'README.md') {
                results.push({ path: full, type });
            }
        }
    }
    walk(WIKI_DIR, 'wiki');
    walk(POSTS_DIR, 'post');
    return results;
}

function slugFromWikiPath(p, type) {
    if (type === 'wiki') return p.replace(/.*\/_wiki\//, '').replace(/\.md$/, '');
    return p.replace(/.*\/_posts\//, '').replace(/\.md$/, '');
}

function urlFromWikiPath(p, type, fm) {
    if (type === 'wiki') return p.replace(/.*\/_wiki/, '/wiki').replace(/\.md$/, '/');
    if (fm && fm.date) {
        const d    = fm.date.slice(0, 10).split('-').join('/');
        const base = path.basename(p, '.md').replace(/^\d{4}-\d{2}-\d{2}-/, '');
        return '/blog/' + d + '/' + base + '/';
    }
    return p.replace(/.*\/_posts/, '/blog').replace(/\.md$/, '/');
}

function slugToIdWiki(slug) {
    const h = crypto.createHash('md5').update('wiki:' + slug).digest('hex');
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}

async function ensureCollection() {
    try {
        await qdrant('GET', `/collections/${COLLECTION}`);
        if (FORCE) {
            await qdrant('DELETE', `/collections/${COLLECTION}`);
            console.log('[Qdrant] 컬렉션 삭제 (--force)');
            throw new Error('recreate');
        }
    } catch (e) {
        if (e.message !== 'recreate' && !e.message.includes('404') && !e.message.includes('HTTP 404')) throw e;
        await qdrant('PUT', `/collections/${COLLECTION}`, {
            vectors: { size: DIMS, distance: 'Cosine' },
        });
        console.log('[Qdrant] 컬렉션 생성');
    }
}

async function existingSlugs() {
    const result = await qdrant('POST', `/collections/${COLLECTION}/points/scroll`, {
        with_payload: ['slug'],
        limit: 10000,
    });
    return new Map(
        (result.result?.points || []).map(p => [p.payload.slug, p.id])
    );
}

async function main() {
    console.log(`[백엔드] Ollama — ${MODEL} (${OLLAMA_URL})`);
    console.log(`[벡터 스토어] Qdrant (${QDRANT_URL})`);

    await ensureCollection();

    const files = collectMarkdown(ADR_DIR);
    console.log(`총 ${files.length}개 ADR 파일 발견${FORCE ? ' (--force: 전체 재계산)' : ''}`);

    const stored = FORCE ? new Map() : await existingSlugs();
    const validSlugs = new Set();

    for (const filePath of files) {
        const content = fs.readFileSync(filePath, 'utf8');
        const fm      = parseFrontmatter(content);
        const slug    = slugFromPath(filePath);
        const text    = extractText(content, fm);
        const hash    = crypto.createHash('md5').update(text).digest('hex');

        validSlugs.add(slug);

        if (text.trim().length < 50) {
            console.log(`[건너뜀] ${slug} (내용 부족)`);
            continue;
        }

        // 이미 저장된 경우 hash로 변경 여부 확인
        if (!FORCE && stored.has(slug)) {
            const point = await qdrant('GET', `/collections/${COLLECTION}/points/${slugToId(slug)}`);
            if (point.result?.payload?.hash === hash) {
                console.log(`[캐시] ${slug}`);
                continue;
            }
        }

        try {
            process.stdout.write(`[임베딩] ${slug}... `);
            const vector = await embedText(text);
            await qdrant('PUT', `/collections/${COLLECTION}/points`, {
                points: [{
                    id:      slugToId(slug),
                    vector,
                    payload: { slug, title: fm.title || slug, status: fm.status || '', tag: fm.tag || '', hash },
                }],
            });
            process.stdout.write(`완료\n`);
            await new Promise(r => setTimeout(r, 100));
        } catch (e) {
            process.stdout.write(`오류: ${e.message}\n`);
        }
    }

    // stale 포인트 삭제
    const stale = [...stored.keys()].filter(s => !validSlugs.has(s));
    if (stale.length > 0) {
        await qdrant('POST', `/collections/${COLLECTION}/points/delete`, {
            points: stale.map(slugToId),
        });
        console.log(`[삭제] stale ${stale.length}개`);
    }

    // wiki/post Qdrant 인덱싱 (브라우저 런타임 검색용)
    await indexWikiDocs();

    console.log('\n완료!');
}

async function indexWikiDocs() {
    // wiki 컬렉션 확인/생성
    try {
        await qdrant('GET', `/collections/${WIKI_COLLECTION}`);
        if (FORCE) {
            await qdrant('DELETE', `/collections/${WIKI_COLLECTION}`);
            console.log('[Qdrant] wiki 컬렉션 삭제 (--force)');
            throw new Error('recreate');
        }
    } catch (e) {
        if (e.message !== 'recreate' && !e.message.includes('404') && !e.message.includes('HTTP 404')) throw e;
        await qdrant('PUT', `/collections/${WIKI_COLLECTION}`, {
            vectors: { size: DIMS, distance: 'Cosine' },
        });
        console.log('[Qdrant] wiki 컬렉션 생성');
    }

    const docs = collectWikiDocs();
    console.log(`\n[Wiki] ${docs.length}개 문서 인덱싱 중...`);

    const wikiStored = FORCE ? new Map() : await (async () => {
        const result = await qdrant('POST', `/collections/${WIKI_COLLECTION}/points/scroll`, {
            with_payload: ['slug'], limit: 10000,
        });
        return new Map((result.result?.points || []).map(p => [p.payload.slug, p.id]));
    })();

    for (const { path: filePath, type } of docs) {
        const content = fs.readFileSync(filePath, 'utf8');
        const fm      = parseFrontmatter(content);
        if (fm.public === 'false' || fm.layout === 'category') continue;

        const slug = slugFromWikiPath(filePath, type);
        const url  = urlFromWikiPath(filePath, type, fm);
        const text = extractText(content, fm);
        const hash = crypto.createHash('md5').update(text).digest('hex');

        if (text.trim().length < 50) continue;

        if (!FORCE && wikiStored.has(slug)) {
            const point = await qdrant('GET', `/collections/${WIKI_COLLECTION}/points/${slugToIdWiki(slug)}`).catch(() => null);
            if (point?.result?.payload?.hash === hash) {
                console.log(`[Wiki 캐시] ${slug}`);
                continue;
            }
        }

        try {
            process.stdout.write(`[Wiki 임베딩] ${slug}... `);
            const vector = await embedText(text);
            await qdrant('PUT', `/collections/${WIKI_COLLECTION}/points`, {
                points: [{
                    id: slugToIdWiki(slug),
                    vector,
                    payload: { slug, title: fm.title || slug, url, type, tag: fm.tag || '', hash },
                }],
            });
            process.stdout.write(`완료\n`);
            await new Promise(r => setTimeout(r, 100));
        } catch (e) {
            process.stdout.write(`오류: ${e.message}\n`);
        }
    }
}

main().catch(e => { console.error(e); process.exit(1); });
