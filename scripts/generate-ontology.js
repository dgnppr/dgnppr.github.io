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

const nodes = {}, edges = [];

for (const [type, cfg] of Object.entries(SCHEMA.entity_types)) {
  const base = path.join(ROOT, cfg.dir);
  for (const fp of walk(base)) {
    const raw  = fs.readFileSync(fp, 'utf8');
    const meta = parseFm(raw);
    if (cfg.layout_filter && meta.layout !== cfg.layout_filter) continue;
    const slug = path.relative(base, fp).replace(/\.md$/, '');
    const id   = `${type}/${slug}`;
    nodes[id] = {
      id,
      type,
      title:  meta.title  || slug,
      path:   path.relative(ROOT, fp),
      status: meta.status || '',
      tags:   meta.tag ? String(meta.tag).split(/\s+/).filter(Boolean) : [],
      date:   meta.date ? String(meta.date).split(' ')[0] : '',
    };
    const rels = Array.isArray(meta.relations) ? meta.relations : [];
    for (const r of rels) {
      if (r?.type && r?.target) edges.push({ from: id, to: String(r.target), type: r.type });
    }
  }
}

fs.writeFileSync(OUT, JSON.stringify({ nodes, edges }, null, 2));
console.log(`노드: ${Object.keys(nodes).length}개  엣지: ${edges.length}개 → data/ontology-graph.json`);
