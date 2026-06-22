#!/usr/bin/env node
/**
 * 글쓰기 페이스 분석 (월별, 주제별, 상태별)
 *
 * 실행:
 *   node scripts/generate-writing-stats.js
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT        = path.join(__dirname, '..');
const STATS_FILE  = path.join(ROOT, 'data/writing-stats.json');

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
console.log('[수집] 총 ' + files.length + '개 파일 발견');

// ── 동적 카테고리 목록 생성 ────────────────────────────────
// _wiki의 1단계 디렉토리를 자동으로 스캔
var categories = [];
if (fs.existsSync(path.join(ROOT, '_wiki'))) {
    fs.readdirSync(path.join(ROOT, '_wiki')).forEach(function(item) {
        var itemPath = path.join(ROOT, '_wiki', item);
        if (fs.statSync(itemPath).isDirectory() && !item.startsWith('_')) {
            categories.push(item);
        }
    });
}
var categoryRegex = categories.length > 0
    ? new RegExp('_wiki\/(' + categories.join('|') + ')\\/')
    : /_wiki\/([^\/]+)\//;  // 폴백
console.log('[카테고리] ' + categories.join(', '));

// ── 프론트매터 파싱 ────────────────────────────────────────
function extractFrontMatter(content) {
    var m = content.match(/^---([\s\S]*?)---/);
    return m ? m[1] : '';
}

function parseYaml(yaml) {
    var result = {};
    yaml.split('\n').forEach(function(line) {
        var match = line.match(/^(\w+)\s*:\s*(.*)$/);
        if (match) {
            var key = match[1].trim();
            var val = match[2].trim().replace(/^["']|["']$/g, '');
            result[key] = val;
        }
    });
    return result;
}

function getCategoryFromPath(filePath) {
    // 동적으로 생성된 정규식으로 카테고리 판별
    var match = filePath.match(categoryRegex);
    return match ? match[1] : 'other';
}

// ── 통계 계산 ──────────────────────────────────────────────
var stats = {
    total: 0,
    byMonth: {},      // { "2024-01": { count: 5, posts: [...] } }
    byStatus: {},     // { "complete": 15, "draft": 2 }
    byCategory: {},   // { "jpa": 10, "kafka": 8 }
    posts: []         // 전체 포스트 목록
};

files.forEach(function(filePath) {
    var content = fs.readFileSync(filePath, 'utf8');
    var yaml = extractFrontMatter(content);
    var meta = parseYaml(yaml);

    if (!meta.date || !meta.public || meta.public !== 'true') {
        return;
    }

    var date = new Date(meta.date);
    var yearMonth = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
    var status = meta.status || 'unknown';
    var category = getCategoryFromPath(filePath);
    var title = meta.title || path.basename(filePath);

    // 월별 통계
    if (!stats.byMonth[yearMonth]) {
        stats.byMonth[yearMonth] = { count: 0, posts: [] };
    }
    stats.byMonth[yearMonth].count++;
    stats.byMonth[yearMonth].posts.push({
        title: title,
        category: category,
        status: status
    });

    // 상태별 통계
    if (!stats.byStatus[status]) {
        stats.byStatus[status] = 0;
    }
    stats.byStatus[status]++;

    // 카테고리별 통계
    if (!stats.byCategory[category]) {
        stats.byCategory[category] = 0;
    }
    stats.byCategory[category]++;

    stats.total++;
    stats.posts.push({
        title: title,
        date: meta.date,
        status: status,
        category: category
    });
});

// 날짜순 정렬
stats.posts.sort(function(a, b) {
    return new Date(b.date) - new Date(a.date);
});

// 월별 키 정렬
var sortedMonths = Object.keys(stats.byMonth).sort().reverse();
var sorted = {};
sortedMonths.forEach(function(m) {
    sorted[m] = stats.byMonth[m];
});
stats.byMonth = sorted;

fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
console.log('[완료] ' + STATS_FILE + ' 생성');
console.log('  - 총 포스트: ' + stats.total + '개');
console.log('  - 상태별: ' + JSON.stringify(stats.byStatus));
console.log('  - 카테고리별: ' + JSON.stringify(stats.byCategory));
