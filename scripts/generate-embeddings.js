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
const TOP_N        = 5;
const MODEL        = 'text-embedding-004';
const DIMS         = 256; // outputDimensionality: 768→256으로 축소 (3배 파일 감소, 품질 손실 미미)
const Z_SIGMA      = 1.0;  // 각 글 기준 mean + Z_SIGMA * std 이상인 연결만 포함
const TAG_BONUS    = 0.03; // 공유 태그 1개당 점수 증폭 (score × (1 + TAG_BONUS × 공유태그수))
const TAG_PENALTY  = 0.90; // 공유 태그가 없을 때 점수 감소 배율

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

// ── 파일 수집 ─────────────────────────────────────────────────
function collectMarkdown(dir, type, results) {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(function (f) {
        var full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) {
            collectMarkdown(full, type, results);
        } else if (f.endsWith('.md') && !f.startsWith('_') && f !== 'README.md') {
            results.push({ path: full, type: type });
        }
    });
}

var files = [];
collectMarkdown(path.join(ROOT, '_wiki'),  'wiki',  files);
collectMarkdown(path.join(ROOT, '_posts'), 'blog', files);
console.log('총 ' + files.length + '개 파일 발견' + (FORCE ? ' (--force: 전체 재계산)' : ''));

// ── 슬러그 / URL 계산 ──────────────────────────────────────────
function slugFromPath(p, type) {
    if (type === 'wiki') return p.replace(/.*\/_wiki\//, '').replace(/\.md$/, '');
    return p.replace(/.*\/_posts\//, '').replace(/\.md$/, '');
}

function urlFromPath(p, type, fm) {
    if (type === 'wiki') {
        return p.replace(/.*\/_wiki/, '/wiki').replace(/\.md$/, '');
    }
    // blog: /blog/YYYY/MM/DD/slug (date from frontmatter)
    if (fm && fm.date) {
        var d = fm.date.slice(0, 10).replace(/-/g, '/');
        var base = path.basename(p, '.md').replace(/^\d{4}-\d{2}-\d{2}-/, '');
        return '/blog/' + d + '/' + base;
    }
    return p.replace(/.*\/_posts/, '/blog').replace(/\.md$/, '');
}

// ── 파싱 ──────────────────────────────────────────────────────
function parseFrontmatter(content) {
    var m = content.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return {};
    var obj = {};
    m[1].split('\n').forEach(function (line) {
        var r = /^\s*([^:]+):\s*(.+)\s*$/.exec(line);
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

// ── 코사인 유사도 ─────────────────────────────────────────────
function cosine(a, b) {
    var dot = 0, na = 0, nb = 0;
    for (var i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na  += a[i] * a[i];
        nb  += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// ── Vertex AI 클라이언트 ───────────────────────────────────────
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

async function embed(text) {
    await initClient();
    var response = await ai.models.embedContent({
        model: MODEL,
        contents: text,
        config: { outputDimensionality: DIMS },
    });
    // @google/genai v2 응답 구조 방어적 처리
    var emb = (response.embeddings && response.embeddings[0] && response.embeddings[0].values)
           || (response.embedding  && response.embedding.values);
    if (!emb) throw new Error('임베딩 응답 형식 오류: ' + JSON.stringify(Object.keys(response)));
    return emb;
}

// ── 메인 ──────────────────────────────────────────────────────
async function main() {
    var cache = {};
    if (fs.existsSync(CACHE_FILE)) {
        try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (e) {}
    }

    var docs       = [];
    var cacheUpdated = false;

    for (var i = 0; i < files.length; i++) {
        var file    = files[i];
        var content = fs.readFileSync(file.path, 'utf8');
        var fm      = parseFrontmatter(content);

        if (fm.public === 'false') continue;

        var slug  = slugFromPath(file.path, file.type);
        var url   = urlFromPath(file.path, file.type, fm);
        var body  = extractBody(content);
        var text  = [fm.title || '', fm.summary || '', body].filter(Boolean).join('\n').slice(0, 2000);
        var hash  = crypto.createHash('md5').update(text).digest('hex');

        var cached = cache[slug];

        var tags = fm.tag ? fm.tag.split(/\s+/).filter(Boolean) : [];

        if (!FORCE && cached && cached.hash === hash && cached.embedding.length === DIMS) {
            process.stdout.write('[캐시] ' + slug + '\n');
            docs.push({ slug: slug, url: url, title: fm.title || slug, tags: tags, embedding: cached.embedding });
            continue;
        }

        if (text.trim().length < 50) {
            process.stdout.write('[건너뜀] ' + slug + ' (내용 부족)\n');
            continue;
        }

        try {
            process.stdout.write('[임베딩] ' + slug + '... ');
            var embedding = await embed(text);
            cache[slug]   = { hash: hash, embedding: embedding };
            cacheUpdated  = true;
            docs.push({ slug: slug, url: url, title: fm.title || slug, tags: tags, embedding: embedding });
            process.stdout.write('완료 (' + embedding.length + '차원)\n');
            // 캐시를 매번 중간 저장 (중단 시 손실 방지)
            fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
            await new Promise(function (r) { setTimeout(r, 200); });
        } catch (e) {
            process.stdout.write('오류: ' + e.message + '\n');
        }
    }

    // ── 코사인 유사도 → related.json ──────────────────────────
    console.log('\n[유사도 계산] ' + docs.length + '개 문서...');
    var related = {};

    docs.forEach(function (doc) {
        var scores = docs
            .filter(function (d) { return d.slug !== doc.slug; })
            .map(function (d) {
                var base     = cosine(doc.embedding, d.embedding);
                var shared   = (doc.tags || []).filter(function (t) { return (d.tags || []).indexOf(t) !== -1; }).length;
                var adjusted = shared > 0 ? base * (1 + TAG_BONUS * shared) : base * TAG_PENALTY;
                return { slug: d.slug, title: d.title, url: d.url, score: adjusted };
            });

        var mean = scores.reduce(function (s, r) { return s + r.score; }, 0) / scores.length;
        var std  = Math.sqrt(scores.reduce(function (s, r) { return s + Math.pow(r.score - mean, 2); }, 0) / scores.length);
        var threshold = mean + Z_SIGMA * std;

        var scored = scores
            .filter(function (r) { return r.score >= threshold; })
            .sort(function (a, b) { return b.score - a.score; })
            .slice(0, TOP_N)
            .map(function (r) { return { slug: r.slug, title: r.title, url: r.url, score: +r.score.toFixed(3) }; });

        if (scored.length > 0) related[doc.slug] = scored;
    });

    fs.writeFileSync(RELATED_FILE, JSON.stringify(related));
    console.log('[저장] data/related.json (' + Object.keys(related).length + '개 항목)');

    if (cacheUpdated) {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
        console.log('[저장] data/embeddings.json (캐시 업데이트)');
    }

    console.log('\n완료!');
}

main().catch(function (e) { console.error(e); process.exit(1); });
