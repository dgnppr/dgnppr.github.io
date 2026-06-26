#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";
import { execSync, spawn } from "child_process";

const ROOT       = path.join(import.meta.dirname, "..");
const GRAPH_FILE = path.join(ROOT, "data/ontology-graph.json");

const ENTITY_DIRS = {
  concept: path.join(ROOT, "_concept"),
  insight: path.join(ROOT, "_insight"),
  problem: path.join(ROOT, "_problem"),
  tool:    path.join(ROOT, "_tool"),
  event:   path.join(ROOT, "_event"),
  adr:     path.join(ROOT, "_adr"),
};
const ALL_TYPES  = Object.keys(ENTITY_DIRS);

// generate-local-embeddings.js와 동일한 entity_type 매핑
const QDRANT_ENTITY_TYPE = { concept: "concept", insight: "insight", problem: "problem", tool: "tool", event: "event" };

// ontology-schema.json에서 action 정의 로드 (SSOT)
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, "data/ontology-schema.json"), "utf-8"));
const ACTION_TYPES = SCHEMA.action_types ?? {};

// ontology 타입 → doc_write 타입 매핑
const ONTOLOGY_TO_DOCTYPE = { concept: "concept", insight: "insight", problem: "problem", tool: "tool", event: "event", adr: "adr" };

const INFERENCE_RULES = SCHEMA.inference_rules ?? [];

// ── LLM 호출 헬퍼 ─────────────────────────────────────────────────────────────
// .env: LLM_BACKEND=lmstudio|anthropic|ollama
//   lmstudio: LM_STUDIO_BASE_URL, LM_STUDIO_MODEL
//   anthropic: ANTHROPIC_API_KEY, LLM_MODEL
//   ollama:    OLLAMA_URL, LLM_MODEL
async function callLLM(prompt, { maxTokens = 2048 } = {}) {
  const backend = process.env.LLM_BACKEND
    ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "ollama");

  if (backend === "lmstudio") {
    const baseUrl = process.env.LM_STUDIO_BASE_URL ?? "http://localhost:1234/v1";
    const model   = process.env.LM_STUDIO_MODEL;
    if (!model) throw new Error("LM_STUDIO_MODEL 환경변수 필요");
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        stream: false,
      }),
    });
    if (!resp.ok) throw new Error(`LM Studio 오류: ${resp.statusText}`);
    const data = await resp.json();
    return data.choices?.[0]?.message?.content ?? "";
  }

  if (backend === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY 환경변수 필요");
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: process.env.LLM_MODEL ?? "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });
    return msg.content[0]?.text ?? "";
  }

  // Ollama
  const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
  const resp = await fetch(`${ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.LLM_MODEL ?? "llama3.2",
      messages: [{ role: "user", content: prompt }],
      stream: false,
    }),
  });
  if (!resp.ok) throw new Error(`Ollama 오류: ${resp.statusText}`);
  const data = await resp.json();
  return data.message?.content ?? "";
}

// ── Re-rank 상수 ──────────────────────────────────────────────────────────────

// relation type별 직접 엣지 가중치 (0~0.15)
const EDGE_WEIGHTS = {
  extends:       0.15,
  implements:    0.15,
  motivates:     0.12,
  "learned-from":0.12,
  "caused-by":   0.10,
  supersedes:    0.10,
  "part-of":     0.08,
  "used-in":     0.08,
  references:    0.06,
  involves:      0.05,
  contradicts:   0.04,
};

// anchor type → candidate type → 타입 친화도 보너스 (0~0.05)
// 예: ADR 작성 컨텍스트에선 problem이 더 관련성 높음
const TYPE_AFFINITY = {
  adr:     { problem: 0.05, concept: 0.04, insight: 0.03, tool: 0.01, event: 0.00, adr: 0.02 },
  problem: { insight: 0.05, adr: 0.04, event: 0.04, concept: 0.02, tool: 0.01, problem: 0.02 },
  insight: { problem: 0.05, event: 0.04, concept: 0.03, adr: 0.02, tool: 0.00, insight: 0.02 },
  event:   { insight: 0.05, problem: 0.04, adr: 0.03, concept: 0.01, tool: 0.00, event: 0.02 },
  concept: { concept: 0.04, tool: 0.03, insight: 0.02, adr: 0.01, problem: 0.01, event: 0.00 },
  tool:    { concept: 0.04, adr: 0.03, insight: 0.02, problem: 0.01, event: 0.00, tool: 0.02 },
};

// confidence → score multiplier
const CONFIDENCE_WEIGHT = { high: 1.10, medium: 1.00, low: 0.85 };

// valid_from/valid_to 기준 현재 유효 여부 판단
function isValid(node) {
  const today = new Date().toISOString().slice(0, 10);
  if (node.valid_from && today < node.valid_from) return false;
  if (node.valid_to   && today > node.valid_to)   return false;
  return true;
}

// 노드에 validity 메타 첨부 (valid_from/valid_to가 있는 경우만)
function attachValidity(node) {
  if (!node) return node;
  const out = { ...node };
  if (node.valid_from || node.valid_to) {
    out.valid = isValid(node);
  }
  return out;
}

// tag 전체 분포에서 희소성 계산용 캐시
let _tagFreqCache = null;
function getTagFrequencies(graph) {
  if (_tagFreqCache) return _tagFreqCache;
  const freq = {};
  for (const n of Object.values(graph.nodes)) {
    for (const t of (n.tags ?? [])) freq[t] = (freq[t] ?? 0) + 1;
  }
  _tagFreqCache = freq;
  return freq;
}

// ── 온톨로지 그래프 유틸리티 ────────────────────────────────────────────────────

// 선언된 엣지에서 이행 추론 엣지 생성
function inferEdges(edges) {
  const inferred = [];
  for (const rule of INFERENCE_RULES) {
    const [rel1, rel2] = rule.chain;
    for (const e1 of edges) {
      if (e1.type !== rel1) continue;
      for (const e2 of edges) {
        if (e2.type !== rel2 || e1.to !== e2.from || e1.from === e2.to) continue;
        inferred.push({ from: e1.from, to: e2.to, type: rule.infers, weight: rule.weight, inferred: true, via: [e1.type, e2.type] });
      }
    }
  }
  return inferred;
}

// BFS 그래프 워크: id → {score, hop, path}
function graphWalk(graph, anchorId, hops = 2, withInferred = true) {
  const allEdges = withInferred ? [...graph.edges, ...inferEdges(graph.edges)] : graph.edges;
  const visited  = new Map(); // id → {score, hop, path}
  const queue    = [{ id: anchorId, hop: 0, score: 1.0, path: [] }];
  const seen     = new Set([anchorId]);

  while (queue.length) {
    const { id, hop, score, path } = queue.shift();
    if (hop > 0) visited.set(id, { score, hop, path: [...path] });
    if (hop >= hops) continue;

    for (const e of allEdges) {
      let nextId, edgeType = e.type, direction;
      if (e.from === id) { nextId = e.to;   direction = "outbound"; }
      else if (e.to === id) { nextId = e.from; direction = "inbound"; }
      else continue;
      if (seen.has(nextId)) continue;
      seen.add(nextId);

      const baseWeight = e.inferred ? (e.weight ?? 0.05) : (EDGE_WEIGHTS[edgeType] ?? 0.05);
      const hopDecay   = hop === 0 ? 1.0 : 0.55;
      const dirBonus   = direction === "inbound" ? 1.2 : 1.0;

      queue.push({
        id: nextId, hop: hop + 1,
        score: score * baseWeight * hopDecay * dirBonus,
        path: [...path, { from: id, to: nextId, type: edgeType, direction, inferred: e.inferred ?? false }],
      });
    }
  }
  return visited;
}

// .env 우선, process.env는 fallback
const _env = path.join(ROOT, ".env");
if (fs.existsSync(_env)) {
  for (const line of fs.readFileSync(_env, "utf-8").split("\n")) {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const BACKEND    = process.env.EMBEDDING_BACKEND;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { meta: {}, body: content };
  const meta = {};
  for (const line of match[1].split("\n")) {
    const [key, ...rest] = line.split(":");
    if (key && rest.length) meta[key.trim()] = rest.join(":").trim();
  }
  return { meta, body: content.slice(match[0].length).trim() };
}

function formatDate(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 00:00:00 +0900`;
}

let _ai;
async function embedQuery(text) {
  if (!BACKEND) throw new Error("EMBEDDING_BACKEND 환경변수 필요 (vertexai | ollama)");
  if (BACKEND === "ollama") {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "bge-m3", prompt: text }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    return (await res.json()).embedding;
  }
  if (!_ai) {
    const { GoogleGenAI } = await import("@google/genai");
    _ai = new GoogleGenAI({ vertexai: true, project: process.env.GOOGLE_PROJECT_ID, location: process.env.GOOGLE_LOCATION || "asia-northeast3" });
  }
  const r = await _ai.models.embedContent({ model: "text-embedding-004", contents: text, config: { outputDimensionality: 768 } });
  const emb = r.embeddings?.[0]?.values ?? r.embedding?.values;
  if (!emb) throw new Error("임베딩 응답 형식 오류");
  return emb;
}

async function qdrantSearch(collection, vector, limit = 20, filter = null) {
  const body = { vector, limit, with_payload: true };
  if (filter) body.filter = filter;
  const res = await fetch(`${QDRANT_URL}/collections/${collection}/points/search`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return [];
  return (await res.json()).result ?? [];
}

function collectFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...collectFiles(fullPath));
    else if (entry.name.endsWith(".md")) results.push(path.relative(dir, fullPath));
  }
  return results;
}

function loadGraph() {
  if (!fs.existsSync(GRAPH_FILE)) return { nodes: {}, edges: [] };
  return JSON.parse(fs.readFileSync(GRAPH_FILE, "utf-8"));
}

function resolveTypes(type) {
  if (!type || type === "all") return ALL_TYPES;
  if (ENTITY_DIRS[type]) return [type];
  return ALL_TYPES;
}

// ── Frontmatter builder ──────────────────────────────────────────────────────

function buildFrontmatter(type, args, existingMeta = null) {
  const now = formatDate(new Date());
  const relLines = args.relations?.length
    ? ["relations:", ...args.relations.map(r => `  - { type: ${r.type}, target: ${r.target} }`)]
    : [];
  const actionsLine = args.actions?.length
    ? [`actions    : [${args.actions.join(", ")}]`]
    : [];
  if (type === "adr") {
    return [
      "---",
      `layout     : adr`,
      `title      : ${args.title}`,
      `date       : ${existingMeta?.date ?? now}`,
      `updated    : ${now}`,
      `tag        : ${args.tag ?? ""}`,
      `status     : ${args.status ?? "proposed"}`,
      `deciders   : ${args.deciders ?? ""}`,
      `public     : false`,
      ...(args.valid_from ? [`valid_from : ${args.valid_from}`] : []),
      ...(args.valid_to   ? [`valid_to   : ${args.valid_to}`]   : []),
      ...(args.supersedes ? [`supersedes : ${args.supersedes}`] : []),
      ...actionsLine,
      ...relLines,
      "---",
    ].join("\n");
  }
  const category = args.path.includes("/") ? args.path.split("/")[0] : "";
  const confidence = args.confidence ?? (type === "insight" ? "medium" : null);
  return [
    "---",
    `layout      : ${type}`,
    `title       : ${args.title}`,
    `date        : ${existingMeta?.date ?? now}`,
    `updated     : ${now}`,
    `tag         : ${args.tag ?? ""}`,
    `toc         : true`,
    `comment     : true`,
    `latex       : true`,
    `status      : ${args.status ?? "draft"}`,
    `public      : ${args.public ?? true}`,
    ...(category    ? [`parent      : [[/${category}]]`]    : []),
    ...(confidence  ? [`confidence  : ${confidence}`]       : []),
    ...(args.valid_from ? [`valid_from  : ${args.valid_from}`] : []),
    ...(args.valid_to   ? [`valid_to    : ${args.valid_to}`]   : []),
    ...actionsLine,
    ...relLines,
    "---",
  ].join("\n");
}

// ── Server ───────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "dgnppr-ontology", version: "3.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // ── Unified doc tools ──
    {
      name: "doc_list",
      description: "지정한 타입(또는 전체)의 문서 목록을 반환한다. type 생략 시 모든 엔티티 타입 포함.",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", description: "concept | insight | problem | tool | event | adr | all (기본: all)" },
        },
      },
    },
    {
      name: "doc_read",
      description: "문서를 읽는다. doc_list에서 반환된 path를 사용.",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", description: "concept | insight | problem | tool | event | adr" },
          path: { type: "string", description: "파일 경로 (예: llm/00_what_is_transformers.md)" },
        },
        required: ["type", "path"],
      },
    },
    {
      name: "doc_search",
      description: "문서 전체 또는 특정 타입에서 키워드를 검색한다. 제목과 본문 모두 검색.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "검색할 키워드" },
          type:  { type: "string", description: "concept | insight | problem | tool | event | adr | all (기본: all)" },
        },
        required: ["query"],
      },
    },
    {
      name: "doc_find",
      description: "임베딩 유사도 기반으로 관련 문서 목록을 반환한다. concept 계열은 파일 캐시, adr은 Qdrant 사용.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "검색 키워드 또는 질문" },
          type:  { type: "string", description: "concept | insight | problem | tool | event | adr | all (기본: all)" },
          limit: { type: "number", description: "최대 반환 수 (기본: 10)" },
        },
        required: ["query"],
      },
    },
    {
      name: "doc_query",
      description: "임베딩 검색으로 관련 문서의 전체 본문을 반환한다. Claude가 내용을 읽고 질문에 답하는 용도.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "검색할 질문 또는 키워드" },
          type:  { type: "string", description: "concept | insight | problem | tool | event | adr | all (기본: all)" },
          limit: { type: "number", description: "반환할 최대 문서 수 (기본: 3)" },
        },
        required: ["query"],
      },
    },
    {
      name: "doc_write",
      description: "문서를 생성하거나 수정한다. frontmatter는 서버가 자동 조립한다. 기존 파일 수정 시 date 보존, updated 갱신.",
      inputSchema: {
        type: "object",
        properties: {
          type:     { type: "string", description: "concept | insight | problem | tool | event | adr" },
          path:     { type: "string", description: "파일 경로 (예: llm/01_attention.md 또는 2024-001-use-kafka.md)" },
          title:    { type: "string", description: "문서 제목" },
          body:     { type: "string", description: "본문 내용 (frontmatter 제외)" },
          tag:      { type: "string", description: "태그 (공백 구분, 선택)" },
          status:   { type: "string", description: "concept 계열: draft|writing|complete / adr: proposed|accepted|deprecated|superseded" },
          public:   { type: "boolean", description: "공개 여부 (concept 계열 전용, 기본: true)" },
          deciders:  { type: "string", description: "결정 참여자 (adr 전용, 선택)" },
          confidence: { type: "string", description: "신뢰도: high | medium | low (insight 필수, 전 타입 권장)" },
          valid_from: { type: "string", description: "유효 시작일 YYYY-MM-DD (버전·시점 의존 문서에 사용)" },
          valid_to:   { type: "string", description: "유효 종료일 YYYY-MM-DD (만료 예정 문서에 사용)" },
          supersedes: { type: "string", description: "대체하는 이전 ADR 엔티티 ID (adr 전용)" },
          actions:    { type: "array", items: { type: "string" }, description: "허용 액션 오버라이드. 없으면 타입 기본값 사용" },
          relations:  { type: "array", description: "그래프 관계 (ontology_act 결과를 그대로 전달)", items: { type: "object", properties: { type: { type: "string" }, target: { type: "string" } }, required: ["type", "target"] } },
        },
        required: ["type", "path", "title", "body"],
      },
    },
    // ── Ontology tools ──
    {
      name: "ontology_entities",
      description: "온톨로지 그래프에서 엔티티 목록을 반환한다. query가 있으면 임베딩 기반 시맨틱 검색, 없으면 type/status/tag 필터 목록.",
      inputSchema: {
        type: "object",
        properties: {
          query:  { type: "string", description: "시맨틱 검색 쿼리 (생략 시 전체 목록)" },
          type:   { type: "string", description: "adr | concept | insight | problem | tool | event (생략 시 전체)" },
          status: { type: "string", description: "상태 필터 (예: accepted, complete)" },
          tag:    { type: "string", description: "태그 필터" },
          limit:  { type: "number", description: "최대 반환 수 (기본 50)" },
        },
      },
    },
    {
      name: "ontology_get",
      description: "엔티티 ID로 노드 메타데이터와 전체 내용을 반환한다.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "예: adr/architecture/2024-001-use-kafka" } },
        required: ["id"],
      },
    },
    {
      name: "ontology_related",
      description: "텍스트 또는 엔티티 ID 기준으로 관련 엔티티를 탐색한다. mode: hybrid(기본)=그래프 워크 우선+임베딩 보완, graph=순수 온톨로지 워크, semantic=Qdrant 유사도만. 결과는 entity_type별 그룹핑.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "검색할 텍스트 (query 또는 id 중 하나 필수)" },
          id:    { type: "string", description: "기준 엔티티 ID — 본문을 쿼리로 사용하고 graph 시그널도 활성화됨" },
          limit: { type: "number", description: "타입당 최대 수 (기본 5)" },
          mode: { type: "string", description: "graph | semantic | hybrid (기본: hybrid). graph=순수 그래프 워크, semantic=Qdrant만, hybrid=그래프 우선+임베딩 보완" },
        },
      },
    },
    {
      name: "ontology_find",
      description: "Qdrant 유사도 검색으로 관련 엔티티를 반환한다. type으로 범위 제한 가능.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "검색 쿼리" },
          type:  { type: "string", description: "adr | concept | insight | problem | tool | event (생략 시 전체)" },
          limit: { type: "number", description: "최대 반환 수 (기본 10)" },
        },
        required: ["query"],
      },
    },
    {
      name: "ontology_decision_context",
      description: "ADR 결정의 전체 컨텍스트: 본문 + 유사 과거 결정(Qdrant) + 그래프 관계. 새 ADR 작성 시 과거 결정 소환용. id 또는 query 중 하나 필수.",
      inputSchema: {
        type: "object",
        properties: {
          id:    { type: "string", description: "adr 엔티티 ID (예: adr/architecture/2024-001-use-kafka)" },
          query: { type: "string", description: "텍스트로 ADR을 찾을 때 사용 — 가장 유사한 ADR을 자동 선택" },
          limit: { type: "number", description: "유사 결정 최대 수 (기본 5)" },
        },
      },
    },
    {
      name: "ontology_neighborhood",
      description: "엔티티 ID 기준으로 N-hop 이웃 노드를 순수 그래프 워크로 탐색한다. 선언된 엣지 + 추론 엣지(이행 규칙) 포함. include_content=true면 각 노드의 전체 본문도 반환.",
      inputSchema: {
        type: "object",
        properties: {
          id:              { type: "string",  description: "기준 엔티티 ID" },
          hops:            { type: "number",  description: "탐색 깊이 (기본 2)" },
          include_content: { type: "boolean", description: "각 노드 본문 포함 여부 (기본 false)" },
          limit:           { type: "number",  description: "최대 반환 수 (기본 20)" },
        },
        required: ["id"],
      },
    },
    {
      name: "ontology_gaps",
      description: "온톨로지 그래프의 gap을 분석한다: 고립 노드, referenced-but-missing 문서, 타입별 액션 기회(motivate/ground/resolve/extract/review). 그래프를 행동으로 전환하는 시작점.",
      inputSchema: {
        type: "object",
        properties: {
          type:  { type: "string", description: "특정 엔티티 타입으로 필터 (adr|concept|insight|problem|tool|event, 생략 시 전체)" },
          limit: { type: "number", description: "최대 반환 수 (기본 20)" },
        },
      },
    },
    {
      name: "ontology_act",
      description: "엔티티 ID와 액션 타입으로 새 문서 blueprint를 생성한다. doc_write에 바로 전달 가능한 인자 구조를 반환. 액션: extend|implement|challenge|deepen|ground|motivate|resolve|extract|review|supersede",
      inputSchema: {
        type: "object",
        properties: {
          id:     { type: "string", description: "액션을 적용할 엔티티 ID (예: concept/data-engineering/00_medallion)" },
          action: { type: "string", description: "수행할 액션 타입 (extend|implement|challenge|deepen|ground|motivate|resolve|extract|review|supersede)" },
          title:  { type: "string", description: "생성할 문서 제목 (생략 시 자동 추론)" },
        },
        required: ["id", "action"],
      },
    },
    {
      name: "ontology_next",
      description: "learning_pressure 기준으로 지금 당장 공부해야 할 개념 top N을 반환한다. 중요한데 이해가 얕은 순서.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "반환 수 (기본 5)" },
          type:  { type: "string", description: "특정 타입으로 필터 (생략 시 전체)" },
        },
      },
    },
    {
      name: "questions",
      description: "특정 문서를 LLM이 읽고 소크라테스식 질문을 생성한다. 문서에 이미 답이 있는 질문은 제외 — 진짜 이해의 구멍을 드러낸다. .env의 LLM_BACKEND 사용.",
      inputSchema: {
        type: "object",
        properties: {
          id:    { type: "string", description: "질문을 생성할 엔티티 ID" },
          count: { type: "number", description: "생성할 질문 수 (기본 5)" },
        },
        required: ["id"],
      },
    },
    {
      name: "discover",
      description: "내 글 전체를 LLM으로 분석해 지금 가장 부족한 개념과 다음에 써야 할 문서를 추천한다. frontmatter가 아닌 실제 글 내용 기반. .env의 LLM_BACKEND 사용.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "분석할 상위 문서 수 (기본 10)" },
        },
      },
    },
    {
      name: "answered",
      description: "questions로 생성된 질문을 답변 완료로 표시한다. 인덱스 미지정 시 전체 완료 처리.",
      inputSchema: {
        type: "object",
        properties: {
          id:    { type: "string", description: "엔티티 ID" },
          index: { type: "number", description: "완료할 질문 인덱스 (0부터, 생략 시 전체)" },
        },
        required: ["id"],
      },
    },
    {
      name: "studied",
      description: "개념을 공부했음을 기록한다. learning_pressure에 study decay가 적용돼 일시적으로 낮아진다. make ontology 실행 시 반영.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "공부한 엔티티 ID" },
        },
        required: ["id"],
      },
    },
    {
      name: "blindspot",
      description: "내 글 전체를 LLM이 분석해 전혀 다루지 않은 인접 영역을 추천한다. query를 주면 그 주제 주변의 맹점만 탐색. .env의 LLM_BACKEND 사용.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "탐색 주제 키워드 (생략 시 전체 지식 맹점 분석)" },
        },
      },
    },
    {
      name: "ontology_eval",
      description: "특정 문서의 이해 깊이를 LLM이 0~1로 평가한다. 결과는 depth-cache.json에 캐시되어 learning_pressure 계산에 반영된다. make ontology 후 적용. .env의 LLM_BACKEND 사용.",
      inputSchema: {
        type: "object",
        properties: {
          id:    { type: "string", description: "평가할 엔티티 ID" },
          force: { type: "boolean", description: "캐시 무시하고 재평가 (기본 false)" },
        },
        required: ["id"],
      },
    },
    {
      name: "ontology_debt",
      description: "지식 부채를 탐지한다: 여러 문서에서 참조되지만 미작성된 개념, 만료된 문서, 자주 쓰이는 태그인데 전용 문서가 없는 영역.",
      inputSchema: {
        type: "object",
        properties: {
          min_refs: { type: "number", description: "최소 참조 횟수 임계값 (기본 2)" },
          limit:    { type: "number", description: "최대 반환 수 (기본 20)" },
        },
      },
    },
    {
      name: "ontology_landscape",
      description: "지식 지형도를 분석한다: 카테고리별 밀도·신뢰도·연결성, 강점 영역, 넓지만 얕은 영역, 참조만 되고 미작성된 영역을 한눈에 보여준다.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "ontology_contradictions",
      description: "지식 그래프 내 모순을 탐지한다: 명시적 contradicts 엣지, 같은 카테고리 내 confidence 충돌, 만료 후에도 참조되는 노드, supersede 됐지만 여전히 accepted 상태인 ADR.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "최대 반환 수 (기본 20)" },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  // ── doc_list ───────────────────────────────────────────────────────────────
  if (name === "doc_list") {
    const types = resolveTypes(args.type);
    const pages = types.flatMap((type) =>
      collectFiles(ENTITY_DIRS[type]).map((f) => {
        const { meta } = parseFrontmatter(fs.readFileSync(path.join(ENTITY_DIRS[type], f), "utf-8"));
        const entry = { type, path: f, title: meta.title || f, tags: meta.tag || "" };
        if (type === "adr") { entry.status = meta.status || ""; entry.deciders = meta.deciders || ""; }
        return entry;
      })
    );
    return { content: [{ type: "text", text: JSON.stringify(pages, null, 2) }] };
  }

  // ── doc_read ───────────────────────────────────────────────────────────────
  if (name === "doc_read") {
    const dir = ENTITY_DIRS[args.type];
    if (!dir) return { content: [{ type: "text", text: `알 수 없는 타입: ${args.type}` }], isError: true };
    const filePath = path.join(dir, args.path);
    if (!filePath.startsWith(dir))
      return { content: [{ type: "text", text: "잘못된 경로입니다." }], isError: true };
    if (!fs.existsSync(filePath))
      return { content: [{ type: "text", text: `파일을 찾을 수 없습니다: ${args.path}` }], isError: true };
    return { content: [{ type: "text", text: fs.readFileSync(filePath, "utf-8") }] };
  }

  // ── doc_search ─────────────────────────────────────────────────────────────
  if (name === "doc_search") {
    const query = args.query.toLowerCase();
    const types = resolveTypes(args.type);
    const results = [];
    for (const type of types) {
      for (const f of collectFiles(ENTITY_DIRS[type])) {
        const content = fs.readFileSync(path.join(ENTITY_DIRS[type], f), "utf-8");
        const { meta, body } = parseFrontmatter(content);
        const title = (meta.title || f).toLowerCase();
        const bodyLower = body.toLowerCase();
        if (title.includes(query) || bodyLower.includes(query)) {
          const idx = bodyLower.indexOf(query);
          const snippet = idx >= 0 ? body.slice(Math.max(0, idx - 80), idx + 160).replace(/\n+/g, " ") : "";
          const entry = { type, path: f, title: meta.title || f, snippet };
          if (type === "adr") entry.status = meta.status || "";
          results.push(entry);
        }
      }
    }
    return {
      content: [{ type: "text", text: results.length ? JSON.stringify(results, null, 2) : `'${args.query}'에 대한 결과가 없습니다.` }],
    };
  }

  // ── doc_find / doc_query ───────────────────────────────────────────────────
  if (name === "doc_find" || name === "doc_query") {
    const types = resolveTypes(args.type);
    const limit = args.limit ?? (name === "doc_find" ? 10 : 3);

    let queryVec;
    try { queryVec = await embedQuery(args.query); }
    catch (e) { return { content: [{ type: "text", text: `임베딩 오류: ${e.message}` }], isError: true }; }

    // Qdrant 검색: concept 컬렉션 (concept/insight/problem/tool/event) + adr 컬렉션
    const searches = [];
    const conceptTypes = types.filter((t) => QDRANT_ENTITY_TYPE[t]);
    const hasAdr       = types.includes("adr");

    if (conceptTypes.length) {
      const filter = conceptTypes.length < Object.keys(QDRANT_ENTITY_TYPE).length
        ? { should: conceptTypes.map((t) => ({ key: "entity_type", match: { value: QDRANT_ENTITY_TYPE[t] } })) }
        : null;
      searches.push(qdrantSearch("concept", queryVec, limit * 3, filter).then((hits) =>
        hits.map((h) => ({
          type: Object.keys(QDRANT_ENTITY_TYPE).find((k) => QDRANT_ENTITY_TYPE[k] === h.payload.entity_type) || "concept",
          f: h.payload.slug + ".md",
          score: h.score,
          payload: h.payload,
        }))
      ));
    }
    if (hasAdr) {
      searches.push(qdrantSearch("adr", queryVec, limit * 3).then((hits) =>
        hits.map((h) => ({ type: "adr", f: h.payload.slug + ".md", score: h.score, payload: h.payload }))
      ));
    }

    const allResults = (await Promise.all(searches)).flat().sort((a, b) => b.score - a.score);

    if (name === "doc_find") {
      const out = allResults.slice(0, limit).map(({ type, f, score, payload }) => ({
        type, path: f, title: payload.title, status: payload.status ?? "", tags: payload.tag ?? "", score: +score.toFixed(3),
      }));
      return { content: [{ type: "text", text: out.length ? JSON.stringify(out, null, 2) : `'${args.query}'에 대한 문서를 찾을 수 없습니다.` }] };
    }

    if (!allResults.length)
      return { content: [{ type: "text", text: `'${args.query}'에 대한 내용을 찾을 수 없습니다.` }] };

    const output = allResults.slice(0, limit).map(({ type, f, score, payload }) => {
      const filePath = path.join(ENTITY_DIRS[type], f);
      if (!fs.existsSync(filePath)) return null;
      const { meta, body } = parseFrontmatter(fs.readFileSync(filePath, "utf-8"));
      const statusPart = type === "adr" ? ` | 상태: ${meta.status || "unknown"}` : "";
      return `# [${type}] ${meta.title || f}\n경로: ${f} | 유사도: ${score.toFixed(3)}${statusPart}\n태그: ${meta.tag || "(없음)"}\n\n${body}`;
    }).filter(Boolean).join("\n\n---\n\n");
    return { content: [{ type: "text", text: output }] };
  }

  // ── doc_write ──────────────────────────────────────────────────────────────
  if (name === "doc_write") {
    const dir = ENTITY_DIRS[args.type];
    if (!dir) return { content: [{ type: "text", text: `알 수 없는 타입: ${args.type}` }], isError: true };
    if (!args.path.endsWith(".md"))
      return { content: [{ type: "text", text: ".md 파일만 쓸 수 있습니다." }], isError: true };
    const filePath = path.resolve(dir, args.path);
    if (!filePath.startsWith(dir + path.sep) && filePath !== dir)
      return { content: [{ type: "text", text: "잘못된 경로입니다." }], isError: true };
    const existingMeta = fs.existsSync(filePath) ? parseFrontmatter(fs.readFileSync(filePath, "utf-8")).meta : null;
    const file = `${buildFrontmatter(args.type, args, existingMeta)}\n\n${args.body.trim()}\n`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, file, "utf-8");

    // 그래프 즉시 재생성 (빠름)
    let syncMsg = "";
    try {
      execSync(`node ${path.join(ROOT, "scripts/generate-ontology.js")}`, { cwd: ROOT, timeout: 15000 });
      _tagFreqCache = null; // 인메모리 캐시 무효화
      syncMsg = " | 그래프 재생성 완료";
    } catch (e) {
      syncMsg = ` | 그래프 재생성 실패: ${e.message.slice(0, 120)}`;
    }

    // 임베딩 백그라운드 업데이트 (느림 — Ollama/VertexAI 필요)
    spawn("node", [path.join(ROOT, "scripts/generate-local-embeddings.js")], {
      cwd: ROOT, detached: true, stdio: "ignore",
      env: { ...process.env },
    }).unref();

    return { content: [{ type: "text", text: `저장 완료: [${args.type}] ${args.path}${syncMsg} | 임베딩 백그라운드 업데이트 중` }] };
  }

  // ── ontology_entities ──────────────────────────────────────────────────────
  if (name === "ontology_entities") {
    const graph = loadGraph();
    const CONCEPT_ENTITY_TYPES = new Set(["concept", "insight", "problem", "tool", "event"]);
    if (args.query) {
      let queryVec;
      try { queryVec = await embedQuery(args.query); }
      catch (e) { return { content: [{ type: "text", text: `임베딩 오류: ${e.message}` }], isError: true }; }

      const cols = args.type === "adr"
        ? [{ col: "adr",  type: "adr" }]
        : args.type && CONCEPT_ENTITY_TYPES.has(args.type)
        ? [{ col: "concept", type: args.type }]
        : [{ col: "concept", type: null }, { col: "adr", type: "adr" }];

      const hits = (await Promise.all(
        cols.map(({ col, type }) =>
          qdrantSearch(col, queryVec, args.limit ?? 50).then(rs =>
            rs.map(h => ({ id: `${h.payload.entity_type || type || "concept"}/${h.payload.slug}`, score: h.score }))
          )
        )
      )).flat().sort((a, b) => b.score - a.score).slice(0, args.limit ?? 50);

      const result = hits.map(({ id, score }) => {
        const n = graph.nodes[id];
        if (!n) return null;
        if (args.type   && n.type   !== args.type)   return null;
        if (args.status && n.status !== args.status) return null;
        if (args.tag    && !n.tags?.includes(args.tag)) return null;
        return { id: n.id, type: n.type, title: n.title, status: n.status, tags: n.tags, date: n.date, score: +score.toFixed(3) };
      }).filter(Boolean);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    let nodes = Object.values(graph.nodes);
    if (args.type)   nodes = nodes.filter(n => n.type === args.type);
    if (args.status) nodes = nodes.filter(n => n.status === args.status);
    if (args.tag)    nodes = nodes.filter(n => n.tags?.includes(args.tag));
    const result = nodes.slice(0, args.limit ?? 50)
      .map(({ id, type, title, status, tags, date }) => ({ id, type, title, status, tags, date }));
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }

  // ── ontology_get ───────────────────────────────────────────────────────────
  if (name === "ontology_get") {
    const graph = loadGraph();
    const node = graph.nodes[args.id];
    if (!node) return { content: [{ type: "text", text: `엔티티 없음: ${args.id}` }], isError: true };
    const fp = path.join(ROOT, node.path);
    const content = fs.existsSync(fp) ? fs.readFileSync(fp, "utf-8") : "(파일 없음)";
    const relations = graph.edges.filter(e => e.from === args.id || e.to === args.id);
    return { content: [{ type: "text", text: JSON.stringify({ ...attachValidity(node), relations, content }, null, 2) }] };
  }

  // ── ontology_related ───────────────────────────────────────────────────────
  if (name === "ontology_related") {
    if (!args.query && !args.id)
      return { content: [{ type: "text", text: "query 또는 id 중 하나 필수" }], isError: true };

    const graph   = loadGraph();
    const mode    = args.mode ?? "hybrid";
    const limit   = args.limit ?? 5;

    // anchor 설정
    let queryText = args.query ?? "";
    let anchorTags = [];
    if (args.id) {
      const anchor = graph.nodes[args.id];
      if (!anchor) return { content: [{ type: "text", text: `엔티티 없음: ${args.id}` }], isError: true };
      const fp = path.join(ROOT, anchor.path);
      queryText  = fs.existsSync(fp)
        ? fs.readFileSync(fp, "utf-8").replace(/^---[\s\S]*?---\n/, "").slice(0, 2000)
        : anchor.title;
      anchorTags = anchor.tags ?? [];
    }

    const anchorNode = args.id ? graph.nodes[args.id] : null;
    const anchorType = anchorNode?.type ?? null;
    const tagFreq    = getTagFrequencies(graph);
    const totalNodes = Object.keys(graph.nodes).length || 1;

    // ── Graph layer ──────────────────────────────────────────────────────────
    let graphMap = new Map(); // id → {score, hop, path}
    if (args.id) graphMap = graphWalk(graph, args.id, 2, true);
    const maxGraphScore = Math.max(...[...graphMap.values()].map(v => v.score), 1e-9);

    // ── Semantic layer ────────────────────────────────────────────────────────
    const semanticMap = new Map(); // id → {score, payload}
    if (mode !== "graph") {
      let queryVec;
      try { queryVec = await embedQuery(queryText); }
      catch (e) { return { content: [{ type: "text", text: `임베딩 오류: ${e.message}` }], isError: true }; }

      const candidateLimit = limit * 12;
      const [conceptHits, adrHits] = await Promise.all([
        qdrantSearch("concept", queryVec, candidateLimit).then(hits =>
          hits.map(h => ({ id: `${h.payload.entity_type || "concept"}/${h.payload.slug}`, score: h.score, payload: h.payload }))
        ),
        qdrantSearch("adr", queryVec, candidateLimit).then(hits =>
          hits.map(h => ({ id: `adr/${h.payload.slug}`, score: h.score, payload: h.payload }))
        ),
      ]);
      for (const hit of [...conceptHits, ...adrHits]) {
        if (hit.id !== args.id) semanticMap.set(hit.id, { score: hit.score, payload: hit.payload });
      }
    }

    // ── Hybrid merge ─────────────────────────────────────────────────────────
    const allIds = new Set([...graphMap.keys(), ...semanticMap.keys()]);
    allIds.delete(args.id);

    const candidates = [...allIds].map(id => {
      const g       = graphMap.get(id);
      const s       = semanticMap.get(id);
      const node    = graph.nodes[id];
      const gNorm   = g ? g.score / maxGraphScore : 0;
      const sSem    = s ? s.score : 0;
      const candType = node?.type ?? s?.payload?.entity_type ?? "concept";

      // IDF tag similarity (semantic layer용)
      const nodeTags = node?.tags ?? (s?.payload?.tag ? String(s.payload.tag).split(/\s+/).filter(Boolean) : []);
      const inter    = anchorTags.filter(t => nodeTags.includes(t));
      const unionSet = new Set([...anchorTags, ...nodeTags]);
      const idfSum   = inter.reduce((sum, t) => sum + Math.log((totalNodes + 1) / ((tagFreq[t] ?? 0) + 1)), 0);
      const tagScore = unionSet.size > 0 ? Math.min(idfSum / (unionSet.size * Math.log(totalNodes + 1)), 1) : 0;

      // type affinity
      const affinity = anchorType ? (TYPE_AFFINITY[anchorType]?.[candType] ?? 0) : 0;

      // confidence multiplier (노드에 confidence 필드가 있는 경우 가중치 적용)
      const confidenceKey = node?.confidence ?? "medium";
      const confMultiplier = CONFIDENCE_WEIGHT[confidenceKey] ?? 1.00;

      let finalScore;
      if (mode === "graph")    finalScore = (gNorm + affinity) * confMultiplier;
      else if (mode === "semantic") finalScore = (sSem * 0.70 + tagScore * 0.18 + affinity) * confMultiplier;
      else {
        // hybrid: 그래프 우선, 임베딩은 미연결 발견용
        if (g && s) finalScore = (gNorm * 0.55 + sSem * 0.35 + tagScore * 0.05 + affinity) * confMultiplier;
        else if (g) finalScore = (gNorm * 0.80 + tagScore * 0.05 + affinity) * confMultiplier;
        else        finalScore = (sSem  * 0.45 + tagScore * 0.10 + affinity) * confMultiplier; // undiscovered
      }

      return {
        id,
        type:   candType,
        title:  node?.title ?? s?.payload?.title ?? id,
        status: node?.status ?? s?.payload?.status ?? "",
        score:  +finalScore.toFixed(3),
        layer:  g && s ? "both" : g ? "graph" : "semantic",
        ...(node?.valid_from || node?.valid_to ? { valid: isValid(node) } : {}),
        ...(node?.confidence ? { confidence: node.confidence } : {}),
        signals: {
          ...(g ? { graph: { hop: g.hop, normalized: +gNorm.toFixed(3), path: g.path } } : {}),
          ...(s ? { semantic: +sSem.toFixed(3) } : {}),
          ...(inter.length ? { shared_tags: inter } : {}),
          ...(affinity     ? { type_affinity: affinity } : {}),
          ...(g?.path?.some(p => p.inferred) ? { has_inferred_edge: true } : {}),
        },
      };
    }).sort((a, b) => b.score - a.score);

    // entity_type별 그룹핑
    const grouped = {};
    for (const item of candidates) {
      if (!grouped[item.type]) grouped[item.type] = [];
      if (grouped[item.type].length < limit) grouped[item.type].push(item);
    }

    return { content: [{ type: "text", text: JSON.stringify({ mode, ...grouped }, null, 2) }] };
  }

  // ── ontology_find ──────────────────────────────────────────────────────────
  if (name === "ontology_find") {
    let queryVec;
    try { queryVec = await embedQuery(args.query); }
    catch (e) { return { content: [{ type: "text", text: `임베딩 오류: ${e.message}` }], isError: true }; }

    const CONCEPT_ENTITY_TYPES = new Set(["concept", "insight", "problem", "tool", "event"]);
    const collections = args.type === "adr"
      ? [{ col: "adr", type: "adr" }]
      : args.type && CONCEPT_ENTITY_TYPES.has(args.type)
      ? [{ col: "concept", type: args.type }]
      : [{ col: "concept", type: null }, { col: "adr", type: "adr" }];

    const hits = (await Promise.all(collections.map(({ col, type }) =>
      qdrantSearch(col, queryVec, args.limit ?? 10).then(results =>
        results.map(h => {
          const resolvedType = h.payload.entity_type || type || "concept";
          return { id: `${resolvedType}/${h.payload.slug}`, title: h.payload.title, type: resolvedType, status: h.payload.status ?? "", tags: h.payload.tag ?? "", score: +h.score.toFixed(3) };
        })
      )
    ))).flat()
      .filter(h => !args.type || h.type === args.type)
      .sort((a, b) => b.score - a.score)
      .slice(0, args.limit ?? 10);

    return { content: [{ type: "text", text: hits.length ? JSON.stringify(hits, null, 2) : `'${args.query}' 관련 항목 없음` }] };
  }

  // ── ontology_decision_context ──────────────────────────────────────────────
  if (name === "ontology_decision_context") {
    if (!args.id && !args.query)
      return { content: [{ type: "text", text: "id 또는 query 중 하나 필수" }], isError: true };

    const graph = loadGraph();
    let nodeId = args.id;
    if (!nodeId) {
      let qVec;
      try { qVec = await embedQuery(args.query); }
      catch (e) { return { content: [{ type: "text", text: `임베딩 오류: ${e.message}` }], isError: true }; }
      const hits = await qdrantSearch("adr", qVec, 1);
      if (!hits.length) return { content: [{ type: "text", text: `'${args.query}' 관련 ADR 없음` }] };
      nodeId = `adr/${hits[0].payload.slug}`;
    }

    const node = graph.nodes[nodeId];
    if (!node || node.type !== "adr")
      return { content: [{ type: "text", text: `adr 엔티티 아님: ${nodeId}` }], isError: true };

    const fp = path.join(ROOT, node.path);
    const content = fs.existsSync(fp) ? fs.readFileSync(fp, "utf-8") : "(파일 없음)";
    const related = graph.edges
      .filter(e => e.from === nodeId || e.to === nodeId)
      .map(e => ({ ...e, peer: graph.nodes[e.from === nodeId ? e.to : e.from] ?? { id: e.from === nodeId ? e.to : e.from } }));

    let similar = [];
    try {
      const queryVec = await embedQuery(content.replace(/^---[\s\S]*?---\n/, "").slice(0, 2000));
      const slug = nodeId.replace(/^adr\//, "");
      similar = (await qdrantSearch("adr", queryVec, (args.limit ?? 5) + 1))
        .filter(h => h.payload.slug !== slug)
        .slice(0, args.limit ?? 5)
        .map(h => ({ id: `adr/${h.payload.slug}`, title: h.payload.title, status: h.payload.status, score: +h.score.toFixed(3) }));
    } catch { /* 임베딩 불가 시 유사 결정 생략 */ }

    const out = [
      `# ${node.title}`,
      `\n## 메타\n${JSON.stringify({ id: nodeId, status: node.status, tags: node.tags, date: node.date }, null, 2)}`,
      `\n## 그래프 관계\n${JSON.stringify(related, null, 2)}`,
      `\n## 유사 과거 결정\n${JSON.stringify(similar, null, 2)}`,
      `\n## 전체 내용\n${content}`,
    ].join("\n");
    return { content: [{ type: "text", text: out }] };
  }

  // ── ontology_gaps ──────────────────────────────────────────────────────────
  if (name === "ontology_gaps") {
    const graph = loadGraph();
    const nodeIds = new Set(Object.keys(graph.nodes));
    const gaps = [];

    // 1. referenced-but-missing (broken edges)
    for (const e of graph.edges) {
      if (!nodeIds.has(e.to)) {
        gaps.push({
          priority: "critical",
          gap_type: "missing_target",
          from_id: e.from,
          from_title: graph.nodes[e.from]?.title ?? e.from,
          missing_id: e.to,
          relation: e.type,
          action: "write",
          reason: `${e.from} → ${e.to} (${e.type}) 참조하지만 문서 없음`,
        });
      }
    }

    // 2. orphan nodes (no edges)
    const connectedIds = new Set(graph.edges.flatMap(e => [e.from, e.to]));
    for (const [id, node] of Object.entries(graph.nodes)) {
      if (!connectedIds.has(id)) {
        const defaultActions = SCHEMA.entity_types[node.type]?.default_actions ?? [];
        // node.actions (frontmatter override) 있으면 그것만, 없으면 타입 기본값
        const suggestedActions = node.actions?.length ? node.actions : defaultActions;
        gaps.push({
          priority: "high",
          gap_type: "orphan",
          node: { id, type: node.type, title: node.title, status: node.status },
          suggested_actions: suggestedActions,
          action: "link",
          reason: "관계 없는 고립 노드",
        });
      }
    }

    // 허용 액션 확인 헬퍼: node.actions 오버라이드 있으면 그것 기준, 없으면 항상 허용
    const actionAllowed = (node, action) => !node.actions?.length || node.actions.includes(action);

    // 3. action opportunities (type-specific)
    for (const [id, node] of Object.entries(graph.nodes)) {
      const outbound = graph.edges.filter(e => e.from === id);
      const inbound  = graph.edges.filter(e => e.to   === id);

      // adr without motivating problem
      if (node.type === "adr" && actionAllowed(node, "motivate") && !inbound.some(e => e.type === "motivates")) {
        gaps.push({ priority: "medium", gap_type: "action_opportunity", node: { id, type: node.type, title: node.title }, action: "motivate", reason: "이 ADR에 연결된 problem 없음" });
      }
      // adr older than 2 years
      if (node.type === "adr" && actionAllowed(node, "review") && node.date && node.status === "accepted") {
        const daysOld = (Date.now() - new Date(node.date).getTime()) / 86400000;
        if (daysOld > 730) gaps.push({ priority: "low", gap_type: "action_opportunity", node: { id, type: node.type, title: node.title }, action: "review", reason: `작성 후 ${Math.floor(daysOld / 365)}년 이상 경과 — 재검토 필요` });
      }
      // insight without grounding
      if (node.type === "insight" && actionAllowed(node, "ground") && !outbound.some(e => e.type === "learned-from")) {
        gaps.push({ priority: "medium", gap_type: "action_opportunity", node: { id, type: node.type, title: node.title }, action: "ground", reason: "이 insight의 출처 event/problem 없음" });
      }
      // problem without resolution
      if (node.type === "problem" && actionAllowed(node, "resolve") && !outbound.some(e => e.type === "motivates")) {
        gaps.push({ priority: "medium", gap_type: "action_opportunity", node: { id, type: node.type, title: node.title }, action: "resolve", reason: "이 problem의 해결 결정 없음" });
      }
      // event without extracted insight
      if (node.type === "event" && actionAllowed(node, "extract") && !inbound.some(e => e.type === "learned-from")) {
        gaps.push({ priority: "low", gap_type: "action_opportunity", node: { id, type: node.type, title: node.title }, action: "extract", reason: "이 event에서 insight 미추출" });
      }
    }

    // filter + sort
    let result = args.type ? gaps.filter(g => (g.node?.type ?? g.from_id?.split("/")[0]) === args.type) : gaps;
    const ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
    result.sort((a, b) => (ORDER[a.priority] ?? 4) - (ORDER[b.priority] ?? 4));
    return { content: [{ type: "text", text: JSON.stringify(result.slice(0, args.limit ?? 20), null, 2) }] };
  }

  // ── ontology_act ───────────────────────────────────────────────────────────
  if (name === "ontology_act") {
    const graph = loadGraph();
    const node = graph.nodes[args.id];
    if (!node) return { content: [{ type: "text", text: `엔티티 없음: ${args.id}` }], isError: true };

    const actionDef = ACTION_TYPES[args.action];
    if (!actionDef) return { content: [{ type: "text", text: `알 수 없는 action: ${args.action}. 사용 가능: ${Object.keys(ACTION_TYPES).join(", ")}` }], isError: true };
    if (!actionDef.valid_on.includes(node.type)) return { content: [{ type: "text", text: `${args.action}은 ${node.type}에 적용 불가. 유효: ${actionDef.valid_on.join(", ")}` }], isError: true };
    // frontmatter actions 오버라이드 확인
    if (node.actions?.length && !node.actions.includes(args.action)) {
      return { content: [{ type: "text", text: `${args.id}의 frontmatter actions가 [${node.actions.join(", ")}]로 제한됨 — ${args.action} 불허` }], isError: true };
    }

    const creates    = actionDef.creates;
    const relation   = actionDef.relation;
    const docType    = ONTOLOGY_TO_DOCTYPE[creates] ?? creates;
    const now        = new Date();
    const year       = now.getFullYear();

    // 앵커에서 카테고리 추출
    const anchorParts    = args.id.split("/");
    const anchorCategory = anchorParts.length > 2 ? anchorParts.slice(1, -1).join("/") : "general";

    let suggestedPath, suggestedTitle;
    if (creates === "adr") {
      const adrFiles = collectFiles(ENTITY_DIRS.adr);
      const maxNum   = adrFiles.reduce((mx, f) => { const m = path.basename(f).match(/(\d{3})[^/]*\.md$/); return m ? Math.max(mx, parseInt(m[1])) : mx; }, 0);
      const nextNum  = String(maxNum + 1).padStart(3, "0");
      const slugBase = args.title ? args.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") : `${args.action}-${anchorParts[anchorParts.length - 1]}`;
      suggestedPath  = `${anchorCategory}/${year}-${nextNum}-${slugBase}.md`;
      suggestedTitle = args.title ?? `[${args.action}] ${node.title}`;
    } else {
      const dir      = ENTITY_DIRS[docType] ?? ENTITY_DIRS.concept;
      const catFiles = collectFiles(dir).filter(f => f.startsWith(anchorCategory + "/"));
      const maxNum   = catFiles.reduce((mx, f) => { const m = path.basename(f).match(/^(\d+)/); return m ? Math.max(mx, parseInt(m[1])) : mx; }, -1);
      const nextNum  = String(maxNum + 1).padStart(2, "0");
      const slugBase = args.title ? args.title.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") : `${args.action}_${anchorParts[anchorParts.length - 1]}`;
      suggestedPath  = `${anchorCategory}/${nextNum}_${slugBase}.md`;
      suggestedTitle = args.title ?? `[${args.action}] ${node.title}`;
    }

    // ground 액션은 관계 방향이 반대 (anchor insight가 new event를 learned-from)
    const needsAnchorUpdate = args.action === "ground";
    const relations = needsAnchorUpdate ? [] : [{ type: relation, target: args.id }];

    const docWriteArgs = {
      type:      docType,
      path:      suggestedPath,
      title:     suggestedTitle,
      body:      `## 개요\n\n> ${actionDef.description}: [${node.title}](/${args.id})\n\n## 내용\n\n`,
      tag:       node.tags?.join(" ") ?? "",
      status:    creates === "adr" ? "proposed" : "draft",
      ...(relations.length ? { relations } : {}),
    };

    const out = {
      action:       args.action,
      description:  actionDef.description,
      anchor:       { id: args.id, type: node.type, title: node.title },
      creates,
      relation:     relations.length ? relation : null,
      doc_write_args: docWriteArgs,
      next_steps: [
        "1. doc_write_args의 body를 채워 doc_write 호출",
        "2. make ontology  — 그래프 갱신",
        "3. make local-embeddings  — Qdrant 갱신",
        ...(needsAnchorUpdate ? [`4. ${args.id} 문서에 learned-from: <new-event-id> relation 추가 후 make ontology`] : []),
      ],
    };
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
  }

  // ── ontology_neighborhood ──────────────────────────────────────────────────
  if (name === "ontology_neighborhood") {
    const graph = loadGraph();
    const node  = graph.nodes[args.id];
    if (!node) return { content: [{ type: "text", text: `엔티티 없음: ${args.id}` }], isError: true };

    const hops   = args.hops  ?? 2;
    const limit  = args.limit ?? 20;
    const walkResult = graphWalk(graph, args.id, hops, true);

    const maxScore = Math.max(...[...walkResult.values()].map(v => v.score), 1e-9);

    const neighbors = [...walkResult.entries()]
      .map(([id, { score, hop, path: ePath }]) => {
        const n    = graph.nodes[id];
        const item = {
          id,
          type:     n?.type ?? "unknown",
          title:    n?.title ?? id,
          status:   n?.status ?? "",
          hop,
          score:    +(score / maxScore).toFixed(3),
          relation_path: ePath,
          has_inferred:  ePath.some(p => p.inferred),
        };
        if (args.include_content && n?.path) {
          const fp = path.join(ROOT, n.path);
          if (fs.existsSync(fp)) item.content = fs.readFileSync(fp, "utf-8");
        }
        return item;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const directCount   = neighbors.filter(n => n.hop === 1 && !n.has_inferred).length;
    const hop2Count     = neighbors.filter(n => n.hop === 2 && !n.has_inferred).length;
    const inferredCount = neighbors.filter(n => n.has_inferred).length;

    return { content: [{ type: "text", text: JSON.stringify({
      anchor:    { id: args.id, type: node.type, title: node.title, tags: node.tags },
      neighbors,
      summary:   `직접 ${directCount}개, 2-hop ${hop2Count}개, 추론 ${inferredCount}개 (총 ${neighbors.length}개)`,
    }, null, 2) }] };
  }

  // ── ontology_next ──────────────────────────────────────────────────────────
  if (name === "ontology_next") {
    const graph = loadGraph();
    let nodes = Object.entries(graph.nodes);
    if (args.type) nodes = nodes.filter(([, n]) => n.type === args.type);

    const inboundEdges = {};
    for (const e of graph.edges) {
      if (!inboundEdges[e.to]) inboundEdges[e.to] = [];
      inboundEdges[e.to].push(e.from);
    }

    const ranked = nodes
      .filter(([, n]) => (n.learning_pressure ?? 0) > 0)
      .sort(([, a], [, b]) => (b.learning_pressure ?? 0) - (a.learning_pressure ?? 0))
      .slice(0, args.limit ?? 5)
      .map(([id, node]) => {
        const referencedBy = inboundEdges[id] ?? [];
        const why = [];
        if (referencedBy.length > 0) why.push(`${referencedBy.length}개 문서가 참조 중 (${referencedBy.slice(0, 2).join(", ")}${referencedBy.length > 2 ? " 외" : ""})`);
        if (!node.confidence || node.confidence === "low") why.push("confidence 낮음 — 검증 필요");
        if (!node.status || node.status === "draft") why.push("아직 draft 상태");
        const outb = graph.edges.filter(e => e.from === id).length;
        if (outb === 0 && referencedBy.length === 0) why.push("그래프에서 고립");
        return {
          rank: null,
          id,
          title: node.title,
          type: node.type,
          learning_pressure: node.learning_pressure,
          importance: node.importance,
          depth: node.depth,
          confidence: node.confidence ?? "none",
          status: node.status ?? "none",
          why,
          suggested_action: node.actions?.length ? node.actions[0] : (SCHEMA.entity_types[node.type]?.default_actions?.[0] ?? "extend"),
        };
      });

    ranked.forEach((r, i) => { r.rank = i + 1; });
    return { content: [{ type: "text", text: JSON.stringify({ top: ranked, message: `지금 당신이 가장 공부해야 할 개념 top ${ranked.length}` }, null, 2) }] };
  }

  // ── questions ──────────────────────────────────────────────────────────────
  if (name === "questions") {
    const graph = loadGraph();
    const node = graph.nodes[args.id];
    if (!node) return { content: [{ type: "text", text: `엔티티 없음: ${args.id}` }], isError: true };

    const filePath = path.join(ROOT, node.path);
    let content;
    try { content = fs.readFileSync(filePath, "utf-8"); }
    catch { return { content: [{ type: "text", text: `파일 읽기 실패: ${node.path}` }], isError: true }; }

    const body = content.replace(/^---[\s\S]*?---\n/, "").trim();
    if (!body) return { content: [{ type: "text", text: "본문 없음 — 내용을 먼저 작성하세요" }], isError: true };

    const connected = graph.edges
      .filter(e => e.from === args.id || e.to === args.id)
      .map(e => e.from === args.id ? `→ ${e.to} (${e.type})` : `← ${e.from} (${e.type})`);

    const prompt = `다음은 기술 지식 문서입니다.

제목: ${node.title}
타입: ${node.type}
연결된 개념: ${connected.length ? connected.join(", ") : "없음"}

본문:
${body.slice(0, 3000)}

이 문서를 읽은 사람이 진짜 깊이 이해하려면 반드시 물어봐야 할 질문 ${args.count ?? 5}개를 생성하세요.

규칙:
- 문서에 이미 답이 있는 질문은 제외
- 엣지 케이스, 실패 조건, 스케일 문제, 인접 개념과의 충돌을 파고드는 질문
- 각 질문에 "왜 이게 중요한가" 한 줄 부연
- JSON 배열로만 반환: [{"question": "...", "why": "..."}]`;

    try {
      const text = await callLLM(prompt, { maxTokens: 1024 });
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      const questions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

      // B: questions.json에 영속화
      const qFile = path.join(ROOT, "data/questions.json");
      let qDB = {};
      try { qDB = JSON.parse(fs.readFileSync(qFile, "utf-8")); } catch {}
      const now = new Date().toISOString().slice(0, 10);
      const existing = (qDB[args.id]?.questions ?? []).filter(q => q.answered);
      qDB[args.id] = {
        generated_at: now,
        questions: [
          ...existing,
          ...questions.map(q => ({ ...q, answered: false, answered_at: null })),
        ],
      };
      fs.writeFileSync(qFile, JSON.stringify(qDB, null, 2));

      return { content: [{ type: "text", text: JSON.stringify({
        id: args.id, title: node.title, learning_pressure: node.learning_pressure,
        questions,
        saved: true,
        tip: "답변 완료 시: /ontology answered id:<id> 또는 index:<n>",
      }, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `LLM 호출 실패: ${e.message}` }], isError: true };
    }
  }

  // ── ontology_debt ──────────────────────────────────────────────────────────
  if (name === "ontology_debt") {
    const graph = loadGraph();
    const today = new Date().toISOString().slice(0, 10);
    const minRefs = args.min_refs ?? 2;
    const debts = [];

    // 1. referenced-but-missing: 엣지 대상이지만 노드 없는 ID
    const missingTargets = {};
    for (const e of graph.edges) {
      if (!graph.nodes[e.to]) {
        missingTargets[e.to] = (missingTargets[e.to] ?? []);
        missingTargets[e.to].push(e.from);
      }
    }
    for (const [id, fromIds] of Object.entries(missingTargets)) {
      if (fromIds.length >= minRefs) {
        debts.push({
          type: "missing_concept",
          priority: fromIds.length >= 4 ? "critical" : fromIds.length >= 3 ? "high" : "medium",
          id,
          ref_count: fromIds.length,
          referenced_by: fromIds,
          reason: `${fromIds.length}개 문서에서 참조되지만 미작성`,
          action: "write",
        });
      }
    }

    // 2. 만료된 노드 (valid_to < today)
    for (const [id, node] of Object.entries(graph.nodes)) {
      if (node.valid_to && node.valid_to < today) {
        const inbound = graph.edges.filter(e => e.to === id).length;
        debts.push({
          type: "expired",
          priority: inbound > 0 ? "high" : "medium",
          id,
          title: node.title,
          valid_to: node.valid_to,
          still_referenced_by: inbound,
          reason: `${node.valid_to} 만료, 아직 ${inbound}개 문서에서 참조 중`,
          action: "review",
        });
      }
    }

    // 3. 고빈도 태그인데 전용 concept 문서 없는 영역
    const tagCount = {};
    for (const node of Object.values(graph.nodes)) {
      for (const tag of (node.tags ?? [])) {
        tagCount[tag] = (tagCount[tag] ?? 0) + 1;
      }
    }
    const coveredTags = new Set(
      Object.values(graph.nodes).flatMap(n => n.tags ?? [])
        .filter(tag => Object.entries(graph.nodes).some(([id, n]) => n.type === "concept" && (n.tags ?? []).includes(tag)))
    );
    // 태그별 concept 노드 존재 여부 체크
    const conceptTagSet = new Set(
      Object.values(graph.nodes).filter(n => n.type === "concept").flatMap(n => n.tags ?? [])
    );
    for (const [tag, count] of Object.entries(tagCount)) {
      if (count >= minRefs && !conceptTagSet.has(tag)) {
        debts.push({
          type: "uncovered_topic",
          priority: count >= 5 ? "high" : "medium",
          tag,
          ref_count: count,
          reason: `태그 '${tag}'가 ${count}개 문서에 쓰이지만 전용 concept 없음`,
          action: "write",
        });
      }
    }

    // 4. 미답 질문 (B: questions.json)
    let qDB = {};
    try { qDB = JSON.parse(fs.readFileSync(path.join(ROOT, "data/questions.json"), "utf-8")); } catch {}
    for (const [nodeId, data] of Object.entries(qDB)) {
      const unanswered = (data.questions ?? []).filter(q => !q.answered);
      if (unanswered.length > 0 && graph.nodes[nodeId]) {
        debts.push({
          type: "unanswered_question",
          priority: unanswered.length >= 3 ? "high" : "medium",
          id: nodeId,
          title: graph.nodes[nodeId].title,
          unanswered_count: unanswered.length,
          generated_at: data.generated_at,
          questions: unanswered.map(q => q.question),
          reason: `${unanswered.length}개의 미답 질문`,
          action: "answer",
        });
      }
    }

    // 5. 콘텐츠 기반 언급 개념 (본문에서 반복 등장하지만 독립 문서 없는 용어)
    for (const item of (graph.content_mentioned_concepts ?? [])) {
      if (item.count >= minRefs) {
        debts.push({
          type: "content_mentioned",
          priority: item.count >= 5 ? "high" : "medium",
          term: item.term,
          mention_count: item.count,
          mentioned_by: item.mentioned_by,
          reason: `${item.count}개 문서 본문에서 언급되지만 독립 문서 없음`,
          action: "write",
        });
      }
    }

    const ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
    debts.sort((a, b) => (ORDER[a.priority] ?? 4) - (ORDER[b.priority] ?? 4));
    return { content: [{ type: "text", text: JSON.stringify(debts.slice(0, args.limit ?? 20), null, 2) }] };
  }

  // ── ontology_landscape ─────────────────────────────────────────────────────
  if (name === "ontology_landscape") {
    const graph = loadGraph();
    const connectedIds = new Set(graph.edges.flatMap(e => [e.from, e.to]));

    // 카테고리별 집계 (ID: type/category/slug → category = parts[1])
    const clusters = {};
    for (const [id, node] of Object.entries(graph.nodes)) {
      const parts = id.split("/");
      const category = parts.length >= 2 ? `${node.type}/${parts[1]}` : node.type;
      if (!clusters[category]) clusters[category] = { nodes: [], edges: 0, type: node.type };
      clusters[category].nodes.push({ id, ...node, connected: connectedIds.has(id) });
    }
    // 클러스터 내부 엣지 수
    for (const e of graph.edges) {
      const cat = (id) => { const p = id.split("/"); return p.length >= 2 ? `${graph.nodes[id]?.type}/${p[1]}` : graph.nodes[id]?.type; };
      const fc = cat(e.from), tc = cat(e.to);
      if (fc && fc === tc) clusters[fc].edges++;
    }

    const clusterSummaries = Object.entries(clusters).map(([cat, data]) => {
      const total = data.nodes.length;
      const isolated = data.nodes.filter(n => !n.connected).length;
      const confidences = data.nodes.map(n => n.confidence).filter(Boolean);
      const highConf = confidences.filter(c => c === "high").length;
      const statuses = data.nodes.reduce((acc, n) => { acc[n.status || "unknown"] = (acc[n.status || "unknown"] ?? 0) + 1; return acc; }, {});
      const density = total > 1 ? (data.edges / (total * (total - 1) / 2)).toFixed(2) : "0";
      const score = (total * 2) + (data.edges * 3) - (isolated * 2) + (highConf * 1);
      return { category: cat, type: data.type, total, isolated, internal_edges: data.edges, density: parseFloat(density), high_confidence: highConf, statuses, strength_score: score };
    }).sort((a, b) => b.strength_score - a.strength_score);

    const totalNodes = Object.keys(graph.nodes).length;
    const totalEdges = graph.edges.length;
    const totalIsolated = [...Object.keys(graph.nodes)].filter(id => !connectedIds.has(id)).length;

    const strongest = clusterSummaries[0];
    const shallowest = [...clusterSummaries].sort((a, b) => (b.total - b.isolated) - (a.total - a.isolated)).find(c => c.isolated > 0);

    const summary = {
      overview: {
        total_nodes: totalNodes,
        total_edges: totalEdges,
        isolated_nodes: totalIsolated,
        connection_rate: `${Math.round((1 - totalIsolated / totalNodes) * 100)}%`,
      },
      strongest_cluster: strongest ? { category: strongest.category, reason: `노드 ${strongest.total}개, 내부 엣지 ${strongest.internal_edges}개, high confidence ${strongest.high_confidence}개` } : null,
      shallowest_cluster: shallowest ? { category: shallowest.category, reason: `${shallowest.total}개 중 ${shallowest.isolated}개 고립 — 넓지만 연결 약함` } : null,
      clusters: clusterSummaries,
    };

    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  }

  // ── ontology_contradictions ────────────────────────────────────────────────
  if (name === "ontology_contradictions") {
    const graph = loadGraph();
    const today = new Date().toISOString().slice(0, 10);
    const contradictions = [];

    // 1. 명시적 contradicts 엣지
    for (const e of graph.edges.filter(e => e.type === "contradicts")) {
      const from = graph.nodes[e.from];
      const to   = graph.nodes[e.to];
      contradictions.push({
        type: "explicit_contradiction",
        priority: "high",
        from: { id: e.from, title: from?.title, confidence: from?.confidence },
        to:   { id: e.to,   title: to?.title,   confidence: to?.confidence },
        reason: "명시적 contradicts 엣지 선언",
      });
    }

    // 2. 같은 카테고리 내 confidence 충돌 (high vs low)
    const byCategory = {};
    for (const [id, node] of Object.entries(graph.nodes)) {
      if (!node.confidence) continue;
      const parts = id.split("/");
      const cat = parts.length >= 2 ? parts[1] : parts[0];
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push({ id, ...node });
    }
    for (const [cat, nodes] of Object.entries(byCategory)) {
      const highs = nodes.filter(n => n.confidence === "high");
      const lows  = nodes.filter(n => n.confidence === "low");
      for (const h of highs) {
        for (const l of lows) {
          // 태그 겹침이 있을 때만 (관련 주제일 가능성)
          const sharedTags = (h.tags ?? []).filter(t => (l.tags ?? []).includes(t));
          if (sharedTags.length > 0) {
            contradictions.push({
              type: "confidence_conflict",
              priority: "medium",
              high_confidence: { id: h.id, title: h.title },
              low_confidence:  { id: l.id,  title: l.title },
              shared_tags: sharedTags,
              reason: `같은 카테고리(${cat}), 같은 태그(${sharedTags.join(", ")})인데 confidence high vs low`,
            });
          }
        }
      }
    }

    // 3. 만료됐지만 여전히 참조되는 노드
    for (const [id, node] of Object.entries(graph.nodes)) {
      if (!node.valid_to || node.valid_to >= today) continue;
      const referencers = graph.edges.filter(e => e.to === id).map(e => e.from);
      if (referencers.length > 0) {
        contradictions.push({
          type: "stale_reference",
          priority: "medium",
          id,
          title: node.title,
          valid_to: node.valid_to,
          referenced_by: referencers,
          reason: `${node.valid_to} 만료된 문서를 ${referencers.length}개 문서가 여전히 참조`,
        });
      }
    }

    // 4. supersede 됐는데 아직 accepted 상태인 ADR
    const supersededIds = new Set(graph.edges.filter(e => e.type === "supersedes").map(e => e.to));
    for (const id of supersededIds) {
      const node = graph.nodes[id];
      if (node?.status === "accepted") {
        contradictions.push({
          type: "superseded_but_active",
          priority: "high",
          id,
          title: node.title,
          reason: "supersedes 엣지가 있지만 status가 여전히 accepted — deprecated로 변경 필요",
        });
      }
    }

    const ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
    contradictions.sort((a, b) => (ORDER[a.priority] ?? 4) - (ORDER[b.priority] ?? 4));
    return { content: [{ type: "text", text: JSON.stringify(contradictions.slice(0, args.limit ?? 20), null, 2) }] };
  }

  // ── discover ───────────────────────────────────────────────────────────────
  if (name === "discover") {
    const graph = loadGraph();
    const limit = args.limit ?? 10;

    // importance 순 상위 N개 문서 본문 수집
    const topNodes = Object.values(graph.nodes)
      .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
      .slice(0, limit);

    const docSummaries = [];
    for (const node of topNodes) {
      try {
        const raw = fs.readFileSync(path.join(ROOT, node.path), "utf-8");
        const body = raw.replace(/^---[\s\S]*?---\n/, "").trim().slice(0, 800);
        if (body) docSummaries.push(`[${node.type}] ${node.title} (lp=${node.learning_pressure ?? 0})\n${body}`);
      } catch { /* skip */ }
    }

    const contentMentioned = (graph.content_mentioned_concepts ?? []).slice(0, 15);

    const prompt = `다음은 한 개발자의 기술 지식 문서들입니다.

${docSummaries.join("\n\n---\n\n")}
${contentMentioned.length ? `\n여러 문서에서 반복 언급되지만 아직 독립 문서가 없는 용어:\n${contentMentioned.map(c => `- ${c.term} (${c.count}회, ${c.mentioned_by.slice(0, 2).join(", ")} 등)`).join("\n")}` : ""}

이 저자의 글을 분석해 아래 JSON만 반환하세요:
{
  "deepen": [{"id": "기존 문서 id", "title": "제목", "why": "왜 더 깊어야 하는지 — 글 내용 근거", "what": "구체적으로 보완해야 할 내용"}],
  "write_new": [{"title": "새로 써야 할 문서 제목", "type": "concept|insight|problem|tool|event", "why": "왜 이게 필요한가 — 글 내용 근거", "connects_to": ["연결될 기존 개념"]}]
}

규칙:
- deepen 3개: 이미 있는 문서인데 글 내용이 얕거나 핵심 측면이 빠진 것
- write_new 3개: 여러 글에서 언급되지만 독립 문서가 없는 개념
- frontmatter 값(confidence, status)이 아닌 실제 글 내용 기반 판단
- JSON만 반환`;

    try {
      const text = await callLLM(prompt, { maxTokens: 1500 });
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { deepen: [], write_new: [] };
      return { content: [{ type: "text", text: JSON.stringify({
        ...result,
        content_mentioned_concepts: contentMentioned.slice(0, 10),
        analyzed_docs: docSummaries.length,
      }, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `분석 실패: ${e.message}` }], isError: true };
    }
  }

  // ── answered ───────────────────────────────────────────────────────────────
  if (name === "answered") {
    const qFile = path.join(ROOT, "data/questions.json");
    let qDB = {};
    try { qDB = JSON.parse(fs.readFileSync(qFile, "utf-8")); } catch {}
    if (!qDB[args.id]) return { content: [{ type: "text", text: `질문 없음: ${args.id} — 먼저 /ontology questions 실행` }], isError: true };

    const now = new Date().toISOString().slice(0, 10);
    const qs = qDB[args.id].questions;
    if (args.index !== undefined) {
      if (!qs[args.index]) return { content: [{ type: "text", text: `인덱스 ${args.index} 없음 (총 ${qs.length}개)` }], isError: true };
      qs[args.index].answered = true;
      qs[args.index].answered_at = now;
    } else {
      qs.forEach(q => { q.answered = true; q.answered_at = now; });
    }
    fs.writeFileSync(qFile, JSON.stringify(qDB, null, 2));
    const remaining = qs.filter(q => !q.answered).length;
    return { content: [{ type: "text", text: JSON.stringify({
      id: args.id,
      marked: args.index !== undefined ? 1 : qs.length,
      remaining_unanswered: remaining,
      tip: remaining > 0 ? `${remaining}개 질문 남음 — make ontology 실행 시 learning_pressure 갱신` : "모든 질문 완료 — make ontology 실행",
    }, null, 2) }] };
  }

  // ── studied ────────────────────────────────────────────────────────────────
  if (name === "studied") {
    const graph = loadGraph();
    const node  = graph.nodes[args.id];
    if (!node) return { content: [{ type: "text", text: `엔티티 없음: ${args.id}` }], isError: true };

    const sFile = path.join(ROOT, "data/study-log.json");
    let sLog = {};
    try { sLog = JSON.parse(fs.readFileSync(sFile, "utf-8")); } catch {}
    const now   = new Date().toISOString().slice(0, 10);
    const entry = sLog[args.id] ?? { study_count: 0, history: [] };
    entry.study_count  += 1;
    entry.last_studied  = now;
    entry.history       = [now, ...(entry.history ?? [])].slice(0, 30);
    sLog[args.id] = entry;
    fs.writeFileSync(sFile, JSON.stringify(sLog, null, 2));

    return { content: [{ type: "text", text: JSON.stringify({
      id: args.id,
      title: node.title,
      study_count: entry.study_count,
      last_studied: now,
      current_lp: node.learning_pressure,
      tip: "make ontology 실행 시 study_decay 반영돼 learning_pressure 낮아짐",
    }, null, 2) }] };
  }

  // ── blindspot ──────────────────────────────────────────────────────────────
  if (name === "blindspot") {
    const graph = loadGraph();
    const allTopics = Object.values(graph.nodes)
      .map(n => `[${n.type}] ${n.title}${n.tags?.length ? ` (${n.tags.join(", ")})` : ""}`)
      .join("\n");

    const query = args.query?.trim();
    const focusClause = query
      ? `특히 "${query}" 주제와 연관된 맹점에 집중해서`
      : "이 개발자가 다루는 주제들 전반을 분석해";

    const prompt = `다음은 한 개발자의 기술 지식 문서 목록입니다:

${allTopics}

${focusClause}, 전혀 다루지 않았지만 이 지식 맥락에서 중요하고 인접한 기술/개념 영역 5개를 추천하세요.

JSON만 반환:
{
  "query": ${JSON.stringify(query ?? null)},
  "blindspots": [
    {
      "area": "탐색할 영역",
      "why": "왜 이 개발자에게 필요한가 — 현재 지식과의 연결점",
      "starter_question": "이 영역을 탐색하기 위한 첫 번째 질문",
      "related_existing": ["현재 문서 중 연결될 것들"]
    }
  ]
}

규칙:
- 현재 문서에 이미 있는 개념은 제외
- 현재 다루는 주제들과 논리적으로 인접한 것만
- 너무 광범위한 분야 금지 (예: "머신러닝 전반" 대신 "온라인 피처 스토어 설계")${query ? `\n- query "${query}" 관련 영역 우선` : ""}`;

    try {
      let result;
      for (let i = 0; i < 2 && !result; i++) {
        const text = await callLLM(prompt, { maxTokens: 1500 });
        const clean = text.replace(/```(?:json)?\n?/g, "").replace(/```/g, "");
        const m = clean.match(/\{[\s\S]*\}/);
        if (m) try { result = JSON.parse(m[0]); } catch {}
      }
      return { content: [{ type: "text", text: JSON.stringify(result ?? { blindspots: [] }, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `분석 실패: ${e.message}` }], isError: true };
    }
  }

  // ── ontology_eval ──────────────────────────────────────────────────────────
  if (name === "ontology_eval") {
    const graph = loadGraph();
    const node  = graph.nodes[args.id];
    if (!node) return { content: [{ type: "text", text: `엔티티 없음: ${args.id}` }], isError: true };

    const cacheFile = path.join(ROOT, "data/depth-cache.json");
    let cache = {};
    try { cache = JSON.parse(fs.readFileSync(cacheFile, "utf-8")); } catch {}

    // 파일 해시로 캐시 유효성 확인
    const filePath = path.join(ROOT, node.path);
    let content;
    try { content = fs.readFileSync(filePath, "utf-8"); }
    catch { return { content: [{ type: "text", text: `파일 읽기 실패: ${node.path}` }], isError: true }; }

    const body = content.replace(/^---[\s\S]*?---\n/, "").trim();
    const hash = body.length.toString(36) + body.slice(-20).replace(/\s/g, "");

    if (!args.force && cache[args.id]?.hash === hash) {
      return { content: [{ type: "text", text: JSON.stringify({ ...cache[args.id], cached: true }, null, 2) }] };
    }

    if (!body) return { content: [{ type: "text", text: "본문 없음" }], isError: true };

    const prompt = `다음 기술 문서의 이해 깊이를 평가하세요.

제목: ${node.title}
본문:
${body.slice(0, 3000)}

평가 기준:
- 1: 정의만 있음, 예시/적용/한계 없음
- 2: 기본 개념 있지만 얕음
- 3: 적용 예시 있고 어느 정도 설명됨
- 4: 실패 사례/한계/엣지 케이스 포함
- 5: 깊은 이해 — 트레이드오프, 대안, 실전 경험 명확

JSON만 반환:
{ "score_1_to_5": <숫자>, "reason": "<한 줄 근거>", "missing": "<가장 부족한 것>" }`;

    try {
      const text = await callLLM(prompt, { maxTokens: 300 });
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const raw = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      if (!raw) return { content: [{ type: "text", text: "파싱 실패" }], isError: true };

      const normalized = Math.round((raw.score_1_to_5 - 1) / 4 * 100) / 100; // 1~5 → 0~1
      const entry = {
        score: normalized,
        score_1_to_5: raw.score_1_to_5,
        reason: raw.reason,
        missing: raw.missing,
        evaluated_at: new Date().toISOString().slice(0, 10),
        hash,
      };
      cache[args.id] = entry;
      fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));

      return { content: [{ type: "text", text: JSON.stringify({
        id: args.id, title: node.title,
        ...entry, cached: false,
        tip: "make ontology 실행 시 learning_pressure에 반영됨",
      }, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `평가 실패: ${e.message}` }], isError: true };
    }
  }

  return { content: [{ type: "text", text: `알 수 없는 도구: ${name}` }], isError: true };
});

const transport = new StdioServerTransport();
await server.connect(transport);
