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
const MIN_SCORE    = 0.70; // 절대 하한선 — z-score 통과해도 이 값 미만이면 차단
const TAG_BONUS    = 0.03; // 공유 태그 1개당 증폭
const TAG_PENALTY  = 0.90; // 공유 태그 없을 때 감소
const CAT_BONUS    = 0.05; // 같은 카테고리 보너스
const TITLE_BONUS  = 0.02; // 제목 공유 키워드 1개당 보너스
const LEN_THRESHOLD  = 300;  // 짧은 글 기준 (본문 chars)
const LEN_THRESHOLD2 = 100;  // 매우 짧은 글 기준
const LEN_PENALTY_FACTOR  = 0.90; // 300자 미만 패널티
const LEN_PENALTY_FACTOR2 = 0.50; // 100자 미만 패널티
const DATE_BONUS   = 1.02; // 90일 이내 발행 보너스
const DATE_PENALTY = 0.98; // 365일 이상 차이 패널티
const BM25_K1      = 1.5;  // BM25 term frequency saturation
const BM25_B       = 0.75; // BM25 length normalization
const BM25_WEIGHT  = 0.15; // BM25 기여 비중 (최대 +15% 보정)

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
            docs.push({ slug: slug, url: url, title: fm.title || slug, tags: tags, embedding: cached.embedding, body: body, bodyLen: body.length, date: fm.date || fm.updated || null, type: file.type });
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
            docs.push({ slug: slug, url: url, title: fm.title || slug, tags: tags, embedding: embedding, body: body, bodyLen: body.length, date: fm.date || fm.updated || null, type: file.type });
            process.stdout.write('완료 (' + embedding.length + '차원)\n');
            // 캐시를 매번 중간 저장 (중단 시 손실 방지)
            fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
            await new Promise(function (r) { setTimeout(r, 200); });
        } catch (e) {
            process.stdout.write('오류: ' + e.message + '\n');
        }
    }

    // ── 스코어링 ──────────────────────────────────────────────
    console.log('\n[유사도 계산] ' + docs.length + '개 문서...');

    // ── BM25 인덱스 구축 ──────────────────────────────────────
    function tokenize(text) {
        return (text || '').toLowerCase()
            .replace(/[^\w가-힣]/g, ' ')
            .split(/\s+/)
            .filter(function (w) { return w.length >= 2; });
    }
    var tfMap = {}, dfMap = {};
    docs.forEach(function (doc) {
        var tokens = tokenize(doc.body || '');
        doc._dl = tokens.length;
        tfMap[doc.slug] = {};
        var seen = {};
        tokens.forEach(function (t) {
            tfMap[doc.slug][t] = (tfMap[doc.slug][t] || 0) + 1;
            if (!seen[t]) { dfMap[t] = (dfMap[t] || 0) + 1; seen[t] = true; }
        });
    });
    var avgdl = docs.reduce(function (s, d) { return s + d._dl; }, 0) / docs.length;

    function bm25(qSlug, tSlug) {
        var qTf = tfMap[qSlug] || {}, tTf = tfMap[tSlug] || {};
        var dl = (tfMap[tSlug] && docs.find(function (d) { return d.slug === tSlug; })._dl) || 0;
        var s = 0;
        Object.keys(qTf).forEach(function (t) {
            var f = tTf[t] || 0;
            if (!f) return;
            var idf = Math.log((docs.length - (dfMap[t] || 0) + 0.5) / ((dfMap[t] || 0) + 0.5) + 1);
            s += idf * f * (BM25_K1 + 1) / (f + BM25_K1 * (1 - BM25_B + BM25_B * dl / avgdl));
        });
        return s;
    }

    // ── 헬퍼 ─────────────────────────────────────────────────
    function categoryOf(slug, type) { return type === 'wiki' ? slug.split('/')[0] : 'blog'; }
    function titleToks(title) {
        return (title || '').toLowerCase().replace(/[^\w가-힣]/g, ' ').split(/\s+/).filter(function (w) { return w.length >= 2; });
    }

    // ── BM25 전체 쌍 계산 (정규화용 최댓값 탐색) ─────────────
    var bm25Raw = {}, bm25Max = 0;
    for (var pi = 0; pi < docs.length; pi++) {
        for (var pj = pi + 1; pj < docs.length; pj++) {
            var pKey = [docs[pi].slug, docs[pj].slug].sort().join('|||');
            var bRaw = (bm25(docs[pi].slug, docs[pj].slug) + bm25(docs[pj].slug, docs[pi].slug)) / 2;
            bm25Raw[pKey] = bRaw;
            if (bRaw > bm25Max) bm25Max = bRaw;
        }
    }

    // ── Pairwise 점수 (대칭, 양방향 평균) ────────────────────
    var pairScores = {};
    for (var i = 0; i < docs.length; i++) {
        for (var j = i + 1; j < docs.length; j++) {
            var a = docs[i], b = docs[j];
            var key = [a.slug, b.slug].sort().join('|||');

            // 1. 임베딩 코사인 유사도
            var score = cosine(a.embedding, b.embedding);

            // 2. 태그 보너스/패널티
            var sharedTags = (a.tags || []).filter(function (t) { return (b.tags || []).indexOf(t) !== -1; }).length;
            score = sharedTags > 0 ? score * (1 + TAG_BONUS * sharedTags) : score * TAG_PENALTY;

            // 3. 카테고리 보너스
            if (categoryOf(a.slug, a.type) === categoryOf(b.slug, b.type)) score *= (1 + CAT_BONUS);

            // 4. 제목 키워드 overlap
            var aToks = titleToks(a.title), bToks = titleToks(b.title);
            var sharedTitle = aToks.filter(function (w) { return bToks.indexOf(w) !== -1; }).length;
            if (sharedTitle > 0) score *= (1 + TITLE_BONUS * sharedTitle);

            // 5. 글 길이 패널티
            var minLen = Math.min(a.bodyLen || 0, b.bodyLen || 0);
            if (minLen < LEN_THRESHOLD2) score *= LEN_PENALTY_FACTOR2;
            else if (minLen < LEN_THRESHOLD) score *= LEN_PENALTY_FACTOR;

            // 6. 발행 시기 근접도
            if (a.date && b.date) {
                var daysDiff = Math.abs(new Date(a.date) - new Date(b.date)) / 86400000;
                score *= daysDiff < 90 ? DATE_BONUS : daysDiff > 365 ? DATE_PENALTY : 1;
            }

            // 7. BM25 보정 (정규화 후 최대 +15%)
            var bNorm = bm25Max > 0 ? (bm25Raw[key] || 0) / bm25Max : 0;
            score *= (1 + BM25_WEIGHT * bNorm);

            pairScores[key] = score;
        }
    }

    // ── Z-score per doc → related.json ────────────────────────
    var related = {};
    docs.forEach(function (doc) {
        var scores = docs
            .filter(function (d) { return d.slug !== doc.slug; })
            .map(function (d) {
                var key = [doc.slug, d.slug].sort().join('|||');
                return { slug: d.slug, title: d.title, url: d.url, score: pairScores[key] || 0 };
            });

        var mean = scores.reduce(function (s, r) { return s + r.score; }, 0) / scores.length;
        var std  = Math.sqrt(scores.reduce(function (s, r) { return s + Math.pow(r.score - mean, 2); }, 0) / scores.length);
        var threshold = mean + Z_SIGMA * std;

        var scored = scores
            .filter(function (r) { return r.score >= threshold && r.score >= MIN_SCORE; })
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
