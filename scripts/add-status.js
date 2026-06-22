#!/usr/bin/env node
/**
 * 모든 위키/포스트 파일에 status: complete 추가
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

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
collectMarkdown(path.join(ROOT, '_wiki'), files);
collectMarkdown(path.join(ROOT, '_posts'), files);
console.log('처리 중: ' + files.length + '개 파일');

files.forEach(filePath => {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/^---([\s\S]*?)---/);
    if (!match) return;

    const frontMatter = match[1];
    if (frontMatter.includes('status')) return;

    const body = content.substring(match[0].length);
    const newContent = '---' + frontMatter.trimEnd() + '\nstatus  : complete\n---' + body;
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log('[완료] ' + path.relative(ROOT, filePath));
});

console.log('\n완료!');
