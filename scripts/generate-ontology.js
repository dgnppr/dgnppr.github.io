#!/usr/bin/env node
'use strict';
const fs   = require('fs');
const path = require('path');
const YAML = require('yamljs');

const ROOT   = path.join(__dirname, '..');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/ontology-schema.json'), 'utf8'));
const OUT    = path.join(ROOT, 'data/ontology-graph.json');

function loadJSON(file) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')); } catch { return {}; }
}
const questionsDB  = loadJSON('data/questions.json');
const studyLog     = loadJSON('data/study-log.json');
const depthCache   = loadJSON('data/depth-cache.json');

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
// /concept/foo/bar → concept/foo/bar
// /insight/foo     → insight/foo
// /event/foo       → event/foo  등
const URL_TO_TYPE = { concept: 'concept', wiki: 'concept', insight: 'insight', problem: 'problem', tool: 'tool', event: 'event', adr: 'adr' };
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
    if (meta.public === false) continue;
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
    // per-document action override (entity type의 default_actions를 덮어씀)
    if (meta.actions)     node.actions     = Array.isArray(meta.actions) ? meta.actions : String(meta.actions).split(/\s+/).filter(Boolean);
    nodes[id] = node;
    const rels = Array.isArray(meta.relations) ? meta.relations : [];
    for (const r of rels) {
      if (r?.type && r?.target) edges.push({ from: id, to: normalizeTarget(r.target), type: r.type });
    }
    // supersedes frontmatter → 자동 엣지 생성 (relations 없이도)
    if (meta.supersedes) {
      const supersedesTarget = normalizeTarget(String(meta.supersedes));
      const alreadyDeclared = rels.some(r => r?.type === 'supersedes' && normalizeTarget(r.target) === supersedesTarget);
      if (!alreadyDeclared) {
        edges.push({ from: id, to: supersedesTarget, type: 'supersedes' });
      }
    }
  }
}

// ── 콘텐츠 기반 용어 추출 ────────────────────────────────────────────────────
// 본문의 backtick / bold 용어를 추출해 노드에 mentioned_terms 저장
// 2개 이상 문서에서 언급됐지만 독립 노드 없는 용어 → content_mentioned_concepts
const STOP_WORDS = new Set([
  'true', 'false', 'null', 'undefined', 'the', 'and', 'or', 'in', 'to', 'a', 'an',
  'is', 'it', 'of', 'for', 'with', 'on', 'at', 'by', 'as', 'if', 'be', 'this',
  'that', 'from', 'are', 'was', 'not', 'but', 'we', 'you', 'do', 'can',
]);
function extractTerms(body) {
  // 펜스드 코드 블록 제거 (``` ... ```)
  const stripped = body.replace(/```[\s\S]*?```/g, '');
  const terms = new Set();
  // 인라인 backtick: 짧고 단순한 식별자
  for (const m of stripped.matchAll(/`([^`\n]{2,30})`/g)) {
    const t = m[1].trim();
    if (
      t.length >= 2 &&
      !STOP_WORDS.has(t.toLowerCase()) &&
      !/^\d/.test(t) &&                   // 숫자로 시작 → 예시 ID
      !t.includes('.') &&                  // 네임스페이스 → 코드 예시
      !t.includes('_') &&                  // snake_case → 코드 식별자
      !/[A-Z]-\d/.test(t) &&              // U-29182 같은 ID 패턴
      !/^[A-Z][A-Z0-9]+$/.test(t)         // 전부 대문자 → 상수/약어
    ) terms.add(t);
  }
  // bold: 2~25자 일반 용어
  for (const m of stripped.matchAll(/\*\*([^*\n]{2,25})\*\*/g)) {
    const t = m[1].trim();
    if (
      t.length >= 2 &&
      !STOP_WORDS.has(t.toLowerCase()) &&
      !/^\d/.test(t) &&
      !t.includes('.')
    ) terms.add(t);
  }
  return [...terms];
}

// ── A: 콘텐츠 기반 depth 점수 ────────────────────────────────────────────────
// frontmatter 없이 본문 내용만으로 이해 깊이를 추정한다
const DEPTH_KEYWORDS = ['실패', '한계', '단점', '주의', '예외', '오류', '에러', '문제점',
  '하지만', '그러나', '단,', '경고', 'edge case', '엣지 케이스', '대안', '트레이드오프'];
function contentDepthScore(body) {
  if (!body || body.length < 100) return 0;
  let score = 0;
  // 길이: 1000자 이상이면 0.25
  score += Math.min(body.length / 1000, 1) * 0.25;
  // 코드 블록 존재: 0.2
  if (/```[\s\S]+?```/.test(body)) score += 0.20;
  // 실패/한계/주의 키워드: 3개 이상이면 0.25
  const kwHits = DEPTH_KEYWORDS.filter(kw => body.includes(kw)).length;
  score += Math.min(kwHits / 3, 1) * 0.25;
  // 외부 링크: 0.15
  if (/https?:\/\//.test(body)) score += 0.15;
  // 헤딩 3개 이상: 0.15
  score += Math.min((body.match(/^#{1,4} /gm) || []).length / 3, 1) * 0.15;
  return Math.round(Math.min(score, 1) * 100) / 100;
}

const termFreq = {};
for (const [id, node] of Object.entries(nodes)) {
  try {
    const raw  = fs.readFileSync(path.join(ROOT, node.path), 'utf8');
    const body = raw.replace(/^---[\s\S]*?---\n/, '').trim();
    const terms = extractTerms(body);
    node.mentioned_terms  = terms;
    node.content_depth    = contentDepthScore(body);
    for (const t of terms) {
      if (!termFreq[t]) termFreq[t] = [];
      termFreq[t].push(id);
    }
  } catch { node.mentioned_terms = []; node.content_depth = 0; }
}

// 노드 타이틀 집합 (소문자 정규화, 비교용)
const nodeTitleSet = new Set(Object.values(nodes).map(n => n.title.toLowerCase().trim()));

const contentMentioned = [];
for (const [term, mentionedBy] of Object.entries(termFreq)) {
  const unique = [...new Set(mentionedBy)];
  if (unique.length >= 2 && !nodeTitleSet.has(term.toLowerCase())) {
    contentMentioned.push({ term, count: unique.length, mentioned_by: unique });
  }
}
contentMentioned.sort((a, b) => b.count - a.count);

// 엣지 무결성 검증 및 경고
const nodeIds = new Set(Object.keys(nodes));
let broken = 0;
for (const e of edges) {
  if (!nodeIds.has(e.to)) { broken++; console.warn(`[경고] 대상 노드 없음: ${e.from} → ${e.to} (${e.type})`); }
}

// ── learning_pressure 계산 ────────────────────────────────────────────────
// importance     : 얼마나 많은 것이 이 노드에 의존하는가
// depth          : 얼마나 깊게 이해하고 있는가 (A + E 신호 통합)
// study_decay    : 최근 공부한 것은 일시적으로 낮춤 (C)
// unanswered_bonus: 미답 질문이 있으면 압력 추가 (B)
// learning_pressure = importance × (1 - depth) × study_decay + unanswered_bonus
const inboundCount  = {};
const outboundCount = {};
for (const e of edges) {
  if (nodeIds.has(e.to))   inboundCount[e.to]   = (inboundCount[e.to]   ?? 0) + 1;
  if (nodeIds.has(e.from)) outboundCount[e.from] = (outboundCount[e.from] ?? 0) + 1;
}

const CONF_SCORE   = { high: 1.0, medium: 0.6, low: 0.2 };
const STATUS_SCORE = { complete: 1.0, writing: 0.6, draft: 0.2 };
const today = new Date();

for (const [id, node] of Object.entries(nodes)) {
  const inb  = inboundCount[id]  ?? 0;
  const outb = outboundCount[id] ?? 0;

  // importance: inbound 참조가 핵심 신호
  const importance = inb * 2 + (outb > 0 ? 1 : 0);

  // A: 콘텐츠 depth (본문 분석, 0~1)
  const contentDepth  = node.content_depth ?? 0;

  // E: LLM 평가 depth (있으면 우선 사용, 0~1)
  const llmDepth      = depthCache[id]?.score ?? null;

  // frontmatter signals
  const confScore     = CONF_SCORE[node.confidence]   ?? 0.3;
  const statusScore   = STATUS_SCORE[node.status]      ?? 0.3;
  const density       = Math.min(inb + outb, 6) / 6;

  // depth 혼합: LLM depth 있으면 가중치 높임
  const depth = llmDepth !== null
    ? confScore * 0.15 + statusScore * 0.15 + density * 0.1 + contentDepth * 0.25 + llmDepth * 0.35
    : confScore * 0.25 + statusScore * 0.25 + density * 0.15 + contentDepth * 0.35;

  // C: 학습 기록 decay — 최근 공부할수록 pressure 낮춤
  const studyEntry    = studyLog[id];
  const lastStudied   = studyEntry?.last_studied;
  const daysSince     = lastStudied
    ? Math.floor((today - new Date(lastStudied)) / 86400000)
    : null;
  // 방금 공부 → 0.2, 30일 이상 → 1.0
  const studyDecay    = daysSince !== null ? Math.max(0.2, Math.min(1, daysSince / 30)) : 1.0;

  // B: 미답 질문 보너스
  const unanswered    = (questionsDB[id]?.questions ?? []).filter(q => !q.answered).length;
  const unansweredBonus = Math.min(unanswered * 0.5, 2.0);

  const basePressure  = importance * (1 - depth) * studyDecay;

  node.importance          = importance;
  node.depth               = Math.round(depth * 100) / 100;
  node.content_depth       = contentDepth;
  if (llmDepth !== null)   node.llm_depth = llmDepth;
  if (studyEntry) {
    node.last_studied      = lastStudied;
    node.study_count       = studyEntry.study_count ?? 0;
  }
  node.unanswered_questions = unanswered;
  node.learning_pressure   = Math.round((basePressure + unansweredBonus) * 100) / 100;
}

fs.writeFileSync(OUT, JSON.stringify({ nodes, edges, content_mentioned_concepts: contentMentioned }, null, 2));
console.log(`노드: ${Object.keys(nodes).length}개  엣지: ${edges.length}개 (깨진 엣지: ${broken}개)  콘텐츠 언급 미작성 개념: ${contentMentioned.length}개 → data/ontology-graph.json`);
