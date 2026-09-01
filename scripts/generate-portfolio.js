#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const YAML = require('yamljs');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, '_portfolio');
const OUTPUT = path.join(ROOT, 'data', 'portfolio.json');

function readFrontMatter(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const match = raw.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) throw new Error(`${filePath}: front matter가 없습니다.`);
    return YAML.parse(match[1]);
}

function main() {
    const projects = fs.readdirSync(SOURCE)
        .filter((name) => name.endsWith('.md'))
        .map((name) => {
            const metadata = readFrontMatter(path.join(SOURCE, name));
            const slug = name.replace(/\.md$/, '');
            return {
                slug,
                url: `/work/${slug}/`,
                title: metadata.title || slug,
                summary: metadata.summary || '',
                company: metadata.company || '',
                period: metadata.period || '',
                role: metadata.role || '',
                category: metadata.category || 'other',
                categoryLabel: metadata.category_label || metadata.category || 'Other',
                order: Number(metadata.order) || 999,
                public: metadata.public === true,
                result: metadata.result || '',
                stack: Array.isArray(metadata.stack) ? metadata.stack : [],
                outcomes: Array.isArray(metadata.outcomes) ? metadata.outcomes : [],
            };
        })
        .filter((project) => project.public)
        .sort((a, b) => a.order - b.order);

    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, JSON.stringify(projects, null, 2) + '\n');
    console.log(`[portfolio] ${projects.length}개 프로젝트 → data/portfolio.json`);
}

main();
