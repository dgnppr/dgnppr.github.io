#!/usr/bin/env node
'use strict';
const fs   = require('fs');
const path = require('path');
const YAML = require('yamljs');

const ROOT   = path.join(__dirname, '..');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/ontology-schema.json'), 'utf8'));
const OUT    = path.join(ROOT, 'data/ontology-graph.json');

function parseFm(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  try { return YAML.parse(m[1]) || {}; } catch { return {}; }
}

function walk(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, results);
    else if (e.name.endsWith('.md')) results.push(p);
  }
  return results;
}

// URL 경로 형식 → 온톨로지 ID 형식 정규화
// /wiki/foo/bar → concept/foo/bar
// /insight/foo  → insight/foo
// /event/foo    → event/foo  등
const URL_TO_TYPE = { wiki: 'concept', insight: 'insight', problem: 'problem', tool: 'tool', event: 'event', adr: 'adr' };
function normalizeTarget(target) {
  const m = String(target).match(/^\/?([^/]+)\/(.+)$/);
  if (!m) return target;
  const mapped = URL_TO_TYPE[m[1]];
  return mapped ? `${mapped}/${m[2]}` : target;
}

const nodes = {}, edges = [];

for (const [type, cfg] of Object.entries(SCHEMA.entity_types)) {
  const base = path.join(ROOT, cfg.dir);
  for (const fp of walk(base)) {
    const raw  = fs.readFileSync(fp, 'utf8');
    const meta = parseFm(raw);
    if (cfg.layout_filter && meta.layout !== cfg.layout_filter) continue;
    const slug = path.relative(base, fp).replace(/\.md$/, '');
    const id   = `${type}/${slug}`;
    const node = {
      id,
      type,
      title:  meta.title  || slug,
      path:   path.relative(ROOT, fp),
      status: meta.status || '',
      tags:   meta.tag ? String(meta.tag).split(/\s+/).filter(Boolean) : [],
      date:   meta.date ? String(meta.date).split(' ')[0] : '',
    };
    if (meta.valid_from)  node.valid_from  = String(meta.valid_from).split(' ')[0];
    if (meta.valid_to)    node.valid_to    = String(meta.valid_to).split(' ')[0];
    if (meta.confidence)  node.confidence  = String(meta.confidence);
    if (meta.supersedes)  node.supersedes  = String(meta.supersedes);
    nodes[id] = node;
    const rels = Array.isArray(meta.relations) ? meta.relations : [];
    for (const r of rels) {
      if (r?.type && r?.target) edges.push({ from: id, to: normalizeTarget(r.target), type: r.type });
    }
  }
}

// 엣지 무결성 검증 및 경고
const nodeIds = new Set(Object.keys(nodes));
let broken = 0;
for (const e of edges) {
  if (!nodeIds.has(e.to)) { broken++; console.warn(`[경고] 대상 노드 없음: ${e.from} → ${e.to} (${e.type})`); }
}

fs.writeFileSync(OUT, JSON.stringify({ nodes, edges }, null, 2));
console.log(`노드: ${Object.keys(nodes).length}개  엣지: ${edges.length}개 (깨진 엣지: ${broken}개) → data/ontology-graph.json`);
