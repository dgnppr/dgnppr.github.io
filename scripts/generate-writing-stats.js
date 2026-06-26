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

const ROOT       = path.join(__dirname, '..');
const STATS_FILE = path.join(ROOT, 'data/writing-stats.json');

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
collectMarkdown(path.join(ROOT, '_concept'),  files);
collectMarkdown(path.join(ROOT, '_posts'),   files);
collectMarkdown(path.join(ROOT, '_insight'), files);
collectMarkdown(path.join(ROOT, '_problem'), files);
collectMarkdown(path.join(ROOT, '_tool'),    files);
collectMarkdown(path.join(ROOT, '_event'),   files);
collectMarkdown(path.join(ROOT, '_adr'),     files);
console.log('[수집] 총 ' + files.length + '개 파일 발견');

const conceptDir = path.join(ROOT, '_concept');
const categories = fs.existsSync(conceptDir)
    ? fs.readdirSync(conceptDir).filter(item =>
        fs.statSync(path.join(conceptDir, item)).isDirectory() && !item.startsWith('_'))
    : [];

const categoryRegex = categories.length > 0
    ? new RegExp('_concept\\/(' + categories.join('|') + ')\\/')
    : /_concept\/([^/]+)\//;

console.log('[카테고리] ' + categories.join(', '));

function extractFrontMatter(content) {
    const m = content.match(/^---([\s\S]*?)---/);
    return m ? m[1] : '';
}

function parseYaml(yaml) {
    const result = {};
    yaml.split('\n').forEach(line => {
        const match = line.match(/^(\w+)\s*:\s*(.*)$/);
        if (match) {
            result[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
        }
    });
    return result;
}

function getCategoryFromPath(filePath) {
    if (filePath.includes('/_concept/')) {
        const match = filePath.match(categoryRegex);
        return match ? match[1] : 'other';
    }
    const entityMatch = filePath.match(/\/_?(insight|problem|tool|event|adr)\//);
    return entityMatch ? entityMatch[1] : 'other';
}

const stats = {
    total: 0,
    byMonth: {},
    byStatus: {},
    byCategory: {},
    posts: [],
};

files.forEach(filePath => {
    const content = fs.readFileSync(filePath, 'utf8');
    const meta = parseYaml(extractFrontMatter(content));

    if (!meta.date || meta.public !== 'true') return;

    const date = new Date(meta.date);
    const yearMonth = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
    const status   = meta.status || 'unknown';
    const category = getCategoryFromPath(filePath);
    const title    = meta.title || path.basename(filePath);

    if (!stats.byMonth[yearMonth]) stats.byMonth[yearMonth] = { count: 0, posts: [] };
    stats.byMonth[yearMonth].count++;
    stats.byMonth[yearMonth].posts.push({ title, category, status });

    stats.byStatus[status]   = (stats.byStatus[status]   || 0) + 1;
    stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
    stats.total++;
    stats.posts.push({ title, date: meta.date, status, category });
});

stats.posts.sort((a, b) => new Date(b.date) - new Date(a.date));

const sortedByMonth = {};
Object.keys(stats.byMonth).sort().reverse().forEach(m => { sortedByMonth[m] = stats.byMonth[m]; });
stats.byMonth = sortedByMonth;

fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
console.log('[완료] ' + STATS_FILE + ' 생성');
console.log('  - 총 포스트: ' + stats.total + '개');
console.log('  - 상태별: ' + JSON.stringify(stats.byStatus));
console.log('  - 카테고리별: ' + JSON.stringify(stats.byCategory));
