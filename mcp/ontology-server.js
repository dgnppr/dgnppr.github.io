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
  wiki:    path.join(ROOT, "_wiki"),
  insight: path.join(ROOT, "_insight"),
  problem: path.join(ROOT, "_problem"),
  tool:    path.join(ROOT, "_tool"),
  event:   path.join(ROOT, "_event"),
  adr:     path.join(ROOT, "_adr"),
};
const ALL_TYPES  = Object.keys(ENTITY_DIRS);

// generate-local-embeddings.js와 동일한 entity_type 매핑
const QDRANT_ENTITY_TYPE = { wiki: "concept", insight: "insight", problem: "problem", tool: "tool", event: "event" };

// ontology-schema.json에서 action 정의 로드 (SSOT)
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, "data/ontology-schema.json"), "utf-8"));
const ACTION_TYPES = SCHEMA.action_types ?? {};

// ontology 타입 → doc_write 타입 매핑
const ONTOLOGY_TO_DOCTYPE = { concept: "wiki", insight: "insight", problem: "problem", tool: "tool", event: "event", adr: "adr" };

const INFERENCE_RULES = SCHEMA.inference_rules ?? [];

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
    ? ["relations:", ...args.relations.map(r => `  - type: ${r.type}\n    target: ${r.target}`)]
    : [];
  if (type === "adr") {
    return [
      "---",
      `layout    : adr`,
      `title     : ${args.title}`,
      `date      : ${existingMeta?.date ?? now}`,
      `updated   : ${now}`,
      `tag       : ${args.tag ?? ""}`,
      `status    : ${args.status ?? "proposed"}`,
      `deciders  : ${args.deciders ?? ""}`,
      `public    : false`,
      ...relLines,
      "---",
    ].join("\n");
  }
  const category = args.path.includes("/") ? args.path.split("/")[0] : "";
  return [
    "---",
    `layout  : ${type}`,
    `title   : ${args.title}`,
    `date    : ${existingMeta?.date ?? now}`,
    `updated : ${now}`,
    `tag     : ${args.tag ?? ""}`,
    `toc     : true`,
    `comment : true`,
    `latex   : true`,
    `status  : ${args.status ?? "draft"}`,
    `public  : ${args.public ?? true}`,
    ...(category ? [`parent  : [[/${category}]]`] : []),
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
          type: { type: "string", description: "wiki | insight | problem | tool | event | adr | all (기본: all)" },
        },
      },
    },
    {
      name: "doc_read",
      description: "문서를 읽는다. doc_list에서 반환된 path를 사용.",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", description: "wiki | insight | problem | tool | event | adr" },
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
          type:  { type: "string", description: "wiki | insight | problem | tool | event | adr | all (기본: all)" },
        },
        required: ["query"],
      },
    },
    {
      name: "doc_find",
      description: "임베딩 유사도 기반으로 관련 문서 목록을 반환한다. wiki 계열은 파일 캐시, adr은 Qdrant 사용.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "검색 키워드 또는 질문" },
          type:  { type: "string", description: "wiki | insight | problem | tool | event | adr | all (기본: all)" },
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
          type:  { type: "string", description: "wiki | insight | problem | tool | event | adr | all (기본: all)" },
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
          type:     { type: "string", description: "wiki | insight | problem | tool | event | adr" },
          path:     { type: "string", description: "파일 경로 (예: llm/01_attention.md 또는 2024-001-use-kafka.md)" },
          title:    { type: "string", description: "문서 제목" },
          body:     { type: "string", description: "본문 내용 (frontmatter 제외)" },
          tag:      { type: "string", description: "태그 (공백 구분, 선택)" },
          status:   { type: "string", description: "wiki 계열: draft|writing|complete / adr: proposed|accepted|deprecated|superseded" },
          public:   { type: "boolean", description: "공개 여부 (wiki 계열 전용, 기본: true)" },
          deciders:  { type: "string", description: "결정 참여자 (adr 전용, 선택)" },
          relations: { type: "array", description: "그래프 관계 (ontology_act 결과를 그대로 전달)", items: { type: "object", properties: { type: { type: "string" }, target: { type: "string" } }, required: ["type", "target"] } },
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

    // Qdrant 검색: wiki 컬렉션 (wiki/insight/problem/tool/event) + adr 컬렉션
    const searches = [];
    const wikiTypes = types.filter((t) => QDRANT_ENTITY_TYPE[t]);
    const hasAdr    = types.includes("adr");

    if (wikiTypes.length) {
      const filter = wikiTypes.length < Object.keys(QDRANT_ENTITY_TYPE).length
        ? { should: wikiTypes.map((t) => ({ key: "entity_type", match: { value: QDRANT_ENTITY_TYPE[t] } })) }
        : null;
      searches.push(qdrantSearch("wiki", queryVec, limit * 3, filter).then((hits) =>
        hits.map((h) => ({
          type: Object.keys(QDRANT_ENTITY_TYPE).find((k) => QDRANT_ENTITY_TYPE[k] === h.payload.entity_type) || "wiki",
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
    const WIKI_ENTITY_TYPES = new Set(["concept", "insight", "problem", "tool", "event"]);
    if (args.query) {
      let queryVec;
      try { queryVec = await embedQuery(args.query); }
      catch (e) { return { content: [{ type: "text", text: `임베딩 오류: ${e.message}` }], isError: true }; }

      const cols = args.type === "adr"
        ? [{ col: "adr",  type: "adr" }]
        : args.type && WIKI_ENTITY_TYPES.has(args.type)
        ? [{ col: "wiki", type: args.type }]
        : [{ col: "wiki", type: null }, { col: "adr", type: "adr" }];

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
      const [wikiHits, adrHits] = await Promise.all([
        qdrantSearch("wiki", queryVec, candidateLimit).then(hits =>
          hits.map(h => ({ id: `${h.payload.entity_type || "concept"}/${h.payload.slug}`, score: h.score, payload: h.payload }))
        ),
        qdrantSearch("adr", queryVec, candidateLimit).then(hits =>
          hits.map(h => ({ id: `adr/${h.payload.slug}`, score: h.score, payload: h.payload }))
        ),
      ]);
      for (const hit of [...wikiHits, ...adrHits]) {
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

    const WIKI_ENTITY_TYPES = new Set(["concept", "insight", "problem", "tool", "event"]);
    const collections = args.type === "adr"
      ? [{ col: "adr", type: "adr" }]
      : args.type && WIKI_ENTITY_TYPES.has(args.type)
      ? [{ col: "wiki", type: args.type }]
      : [{ col: "wiki", type: null }, { col: "adr", type: "adr" }];

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
        gaps.push({
          priority: "high",
          gap_type: "orphan",
          node: { id, type: node.type, title: node.title, status: node.status },
          suggested_actions: defaultActions,
          action: "link",
          reason: "관계 없는 고립 노드",
        });
      }
    }

    // 3. action opportunities (type-specific)
    for (const [id, node] of Object.entries(graph.nodes)) {
      const outbound = graph.edges.filter(e => e.from === id);
      const inbound  = graph.edges.filter(e => e.to   === id);

      // adr without motivating problem
      if (node.type === "adr" && !inbound.some(e => e.type === "motivates")) {
        gaps.push({ priority: "medium", gap_type: "action_opportunity", node: { id, type: node.type, title: node.title }, action: "motivate", reason: "이 ADR에 연결된 problem 없음" });
      }
      // adr older than 2 years
      if (node.type === "adr" && node.date && node.status === "accepted") {
        const daysOld = (Date.now() - new Date(node.date).getTime()) / 86400000;
        if (daysOld > 730) gaps.push({ priority: "low", gap_type: "action_opportunity", node: { id, type: node.type, title: node.title }, action: "review", reason: `작성 후 ${Math.floor(daysOld / 365)}년 이상 경과 — 재검토 필요` });
      }
      // insight without grounding
      if (node.type === "insight" && !outbound.some(e => e.type === "learned-from")) {
        gaps.push({ priority: "medium", gap_type: "action_opportunity", node: { id, type: node.type, title: node.title }, action: "ground", reason: "이 insight의 출처 event/problem 없음" });
      }
      // problem without resolution
      if (node.type === "problem" && !outbound.some(e => e.type === "motivates")) {
        gaps.push({ priority: "medium", gap_type: "action_opportunity", node: { id, type: node.type, title: node.title }, action: "resolve", reason: "이 problem의 해결 결정 없음" });
      }
      // event without extracted insight
      if (node.type === "event" && !inbound.some(e => e.type === "learned-from")) {
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
      const dir      = ENTITY_DIRS[docType] ?? ENTITY_DIRS.wiki;
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

  return { content: [{ type: "text", text: `알 수 없는 도구: ${name}` }], isError: true };
});

const transport = new StdioServerTransport();
await server.connect(transport);
