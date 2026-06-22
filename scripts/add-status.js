#!/usr/bin/env node
/**
 * 모든 위키/포스트 파일에 status: complete 추가
 */
'use strict';
const fs = require('fs');
const path = require('path');

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
collectMarkdown('_wiki', files);
collectMarkdown('_posts', files);

console.log('처리 중: ' + files.length + '개 파일');

files.forEach(function (filePath) {
    var content = fs.readFileSync(filePath, 'utf8');

    // frontmatter 추출
    var match = content.match(/^---([\s\S]*?)---/);
    if (!match) return;

    var frontMatter = match[1];
    var body = content.substring(match[0].length);

    // status 있는지 확인
    if (frontMatter.includes('status')) {
        // 이미 있으면 건너뜀
        return;
    }

    // status 추가 (마지막 --- 전에)
    var newFrontMatter = frontMatter.trimEnd() + '\nstatus  : complete';
    var newContent = '---' + newFrontMatter + '\n---' + body;

    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log('[완료] ' + path.relative('.', filePath));
});

console.log('\n✅ 완료!');
