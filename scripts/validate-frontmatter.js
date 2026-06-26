#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');

// ── 타입별 필수 필드 ────────────────────────────────────────────────────────

const REQUIRED = {
  concept: ['layout', 'title', 'date', 'updated', 'tag', 'toc', 'comment', 'latex', 'status', 'public', 'confidence'],
  insight: ['layout', 'title', 'date', 'updated', 'tag', 'toc', 'comment', 'latex', 'status', 'public', 'confidence'],
  problem: ['layout', 'title', 'date', 'updated', 'tag', 'toc', 'comment', 'latex', 'status', 'public', 'confidence'],
  tool:    ['layout', 'title', 'date', 'updated', 'tag', 'toc', 'comment', 'latex', 'status', 'public', 'confidence'],
  event:   ['layout', 'title', 'date', 'updated', 'tag', 'toc', 'comment', 'latex', 'status', 'public', 'confidence'],
  adr:     ['layout', 'title', 'date', 'updated', 'tag', 'status', 'deciders', 'public', 'confidence'],
};

const COLLECTION_MAP = {
  '_concept': 'concept',
  '_insight': 'insight',
  '_problem': 'problem',
  '_tool':    'tool',
  '_event':   'event',
  '_adr':     'adr',
};

const MAX_TAGS = 5;

const VALID_RELATION_TYPES = new Set([
  'extends', 'implements', 'references', 'supersedes',
  'motivated_by', 'resolves', 'learned_from', 'applied_to', 'related',
]);

// ── frontmatter 파싱 ────────────────────────────────────────────────────────

function parseFrontmatter(src) {
  const match = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const meta = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\S+?)\s*:\s*(.*)/);
    if (m) meta[m[1]] = m[2].trim();
  }
  return meta;
}

function parseRelationTypes(src) {
  const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  if (!fm) return [];
  const block = fm.match(/^relations:\s*\n((?:[ \t]+-[^\n]*\n?)*)/m)?.[1];
  if (!block) return [];
  return block.split('\n')
    .map(l => l.match(/type:\s*([^,}\s]+)/)?.[1])
    .filter(Boolean);
}

// ── 파일 하나 검증 ──────────────────────────────────────────────────────────

function validateFile(filePath) {
  const errors = [];

  // 컬렉션 타입 결정 (절대경로·상대경로 모두 처리)
  const rel    = filePath.replace(/\\/g, '/');
  const relFromRepo = rel.replace(/^.*\/((_concept|_insight|_problem|_tool|_event|_adr)\/)/, '$1');
  const prefix = relFromRepo.match(/^(_concept|_insight|_problem|_tool|_event|_adr)\//)?.[1];
  if (!prefix) return [];   // 대상 외 파일

  const type = COLLECTION_MAP[prefix];

  // _concept/*.md (카테고리 인덱스 페이지): frontmatter 검증 제외
  const parts = relFromRepo.split('/');
  if (prefix === '_concept' && parts.length === 2) return [];

  let src;
  try { src = fs.readFileSync(filePath, 'utf8'); }
  catch { return [`${rel}: 파일을 읽을 수 없음`]; }

  const meta = parseFrontmatter(src);
  if (!meta) {
    errors.push(`${rel}: frontmatter 없음`);
    return errors;
  }

  // 필수 필드 검사
  for (const field of REQUIRED[type]) {
    if (!(field in meta) || meta[field] === '') {
      errors.push(`${rel}: '${field}' 필드 누락`);
    }
  }

  // relations 타입 검사
  for (const t of parseRelationTypes(src)) {
    if (!VALID_RELATION_TYPES.has(t)) {
      errors.push(`${rel}: relations에 잘못된 타입 '${t}' — 허용: ${[...VALID_RELATION_TYPES].join(', ')}`);
    }
  }

  // tag 개수 검사
  if ('tag' in meta) {
    const count = meta.tag.trim() === '' ? 0 : meta.tag.trim().split(/\s+/).length;
    if (count > MAX_TAGS) {
      errors.push(`${rel}: tag ${count}개 — 최대 ${MAX_TAGS}개`);
    }
  }

  return errors;
}

// ── 전체 디렉토리 재귀 수집 ────────────────────────────────────────────────

const COLLECTIONS = ['_concept', '_insight', '_problem', '_tool', '_event', '_adr'];

function collectMarkdown(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectMarkdown(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

// ── 진입점 ──────────────────────────────────────────────────────────────────

const repo = path.resolve(__dirname, '..');
let files = process.argv.slice(2);

// 인수 없으면 모든 컬렉션 전체 스캔
if (!files.length) {
  for (const col of COLLECTIONS) {
    collectMarkdown(path.join(repo, col), files);
  }
}

const allErrors = [];

for (const f of files) {
  const abs = path.isAbsolute(f) ? f : path.join(repo, f);
  allErrors.push(...validateFile(abs).map(e => `  ✗ ${e}`));
}

if (allErrors.length) {
  console.error('\n[frontmatter 검증 실패]');
  console.error(allErrors.join('\n'));
  console.error('\n커밋이 차단됩니다. 위 항목을 수정하세요.\n');
  process.exit(1);
}

console.log(`  ✓ frontmatter 검증 통과 (${files.length}개 파일)`);
