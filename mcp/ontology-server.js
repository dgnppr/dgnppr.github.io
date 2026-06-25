#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";

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
          deciders: { type: "string", description: "결정 참여자 (adr 전용, 선택)" },
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
      description: "텍스트 또는 엔티티 ID 기준으로 전체 엔티티 타입(concept/insight/problem/tool/event/adr)을 탐색한다. Qdrant ANN + 태그·그래프 시그널 re-rank. 결과는 entity_type별로 그룹핑해 반환한다.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "검색할 텍스트 (query 또는 id 중 하나 필수)" },
          id:    { type: "string", description: "기준 엔티티 ID — 본문을 쿼리로 사용하고 graph 시그널도 활성화됨" },
          limit: { type: "number", description: "타입당 최대 수 (기본 5)" },
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
    return { content: [{ type: "text", text: `저장 완료: [${args.type}] ${args.path}` }] };
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
    return { content: [{ type: "text", text: JSON.stringify({ ...node, relations, content }, null, 2) }] };
  }

  // ── ontology_related ───────────────────────────────────────────────────────
  if (name === "ontology_related") {
    if (!args.query && !args.id)
      return { content: [{ type: "text", text: "query 또는 id 중 하나 필수" }], isError: true };

    const graph = loadGraph();
    let queryText = args.query ?? "";
    let anchorTags = [];
    if (args.id) {
      const anchor = graph.nodes[args.id];
      if (!anchor) return { content: [{ type: "text", text: `엔티티 없음: ${args.id}` }], isError: true };
      const fp = path.join(ROOT, anchor.path);
      queryText = fs.existsSync(fp)
        ? fs.readFileSync(fp, "utf-8").replace(/^---[\s\S]*?---\n/, "").slice(0, 2000)
        : anchor.title;
      anchorTags = anchor.tags ?? [];
    }

    let queryVec;
    try { queryVec = await embedQuery(queryText); }
    catch (e) { return { content: [{ type: "text", text: `임베딩 오류: ${e.message}` }], isError: true }; }

    const edgeMap = new Map(); // id → {type, direction}
    if (args.id) {
      for (const e of graph.edges) {
        if (e.from === args.id) edgeMap.set(e.to,   { type: e.type, direction: "outbound" });
        if (e.to   === args.id) edgeMap.set(e.from, { type: e.type, direction: "inbound"  });
      }
    }

    const limit = args.limit ?? 5;
    const candidateLimit = limit * 10;

    // anchor node 메타 (타입, 날짜)
    const anchorNode = args.id ? graph.nodes[args.id] : null;
    const anchorType = anchorNode?.type ?? null;
    const tagFreq    = getTagFrequencies(graph);
    const totalNodes = Object.keys(graph.nodes).length || 1;

    // 2-hop 이웃 맵 구성: id → best edge weight (직접 엣지의 절반)
    const hop2Map = new Map();
    if (args.id) {
      for (const [neighborId] of edgeMap) {
        for (const e of graph.edges) {
          const nextId = e.from === neighborId ? e.to
                       : e.to   === neighborId ? e.from
                       : null;
          if (!nextId || nextId === args.id || edgeMap.has(nextId)) continue;
          const w = (EDGE_WEIGHTS[e.type] ?? 0.05) * 0.45; // 2-hop은 직접 엣지의 45%
          if ((hop2Map.get(nextId) ?? 0) < w) hop2Map.set(nextId, w);
        }
      }
    }

    const [wikiHits, adrHits] = await Promise.all([
      qdrantSearch("wiki", queryVec, candidateLimit).then(hits =>
        hits.map(h => ({ id: `${h.payload.entity_type || "concept"}/${h.payload.slug}`, score: h.score, payload: h.payload }))
      ),
      qdrantSearch("adr", queryVec, candidateLimit).then(hits =>
        hits.map(h => ({ id: `adr/${h.payload.slug}`, score: h.score, payload: h.payload }))
      ),
    ]);

    const rerank = (candidate) => {
      const node      = graph.nodes[candidate.id];
      const candType  = candidate.payload.entity_type || "concept";
      const nodeTags  = node?.tags ?? (candidate.payload.tag ? candidate.payload.tag.split(/\s+/).filter(Boolean) : []);

      // 1) Semantic (Qdrant cosine)
      const sem = candidate.score;

      // 2) Tag similarity — IDF 가중 Jaccard (희소 태그 = 더 강한 신호)
      const inter    = anchorTags.filter(t => nodeTags.includes(t));
      const unionSet = new Set([...anchorTags, ...nodeTags]);
      const idfSum   = inter.reduce((s, t) => s + Math.log((totalNodes + 1) / ((tagFreq[t] ?? 0) + 1)), 0);
      const idfNorm  = unionSet.size > 0 ? idfSum / (unionSet.size * Math.log(totalNodes + 1)) : 0;
      const tag      = Math.min(idfNorm, 1);

      // 3) Direct edge (typed weight, direction-aware)
      const edgeInfo     = edgeMap.get(candidate.id);
      const edgeWeight   = edgeInfo ? (EDGE_WEIGHTS[edgeInfo.type] ?? 0.05) : 0;
      // inbound(이쪽이 날 참조) vs outbound(내가 이쪽 참조) — inbound가 더 강한 신호
      const edgeBonus    = edgeInfo?.direction === "inbound" ? edgeWeight * 1.2 : edgeWeight;

      // 4) 2-hop transitive
      const hop2 = hop2Map.get(candidate.id) ?? 0;

      // 5) Entity type affinity (anchor type 기준)
      const affinity = anchorType ? (TYPE_AFFINITY[anchorType]?.[candType] ?? 0) : 0;

      // 6) Recency (최근 2년 이내 완성 문서 미세 가산, 최대 0.03)
      let recency = 0;
      const dateStr = node?.date ?? candidate.payload.date;
      if (dateStr) {
        const daysAgo = (Date.now() - new Date(dateStr).getTime()) / 86400000;
        const isComplete = (node?.status ?? candidate.payload.status) === "complete";
        recency = isComplete ? Math.exp(-daysAgo / 730) * 0.03 : 0;
      }

      // 최종 점수 (합계 최대 ~1.0)
      const score = +(
        sem      * 0.52 +
        tag      * 0.18 +
        Math.min(edgeBonus, 0.18) +   // direct edge, 상한 0.18
        Math.min(hop2,      0.08) +   // 2-hop, 상한 0.08
        affinity                   +  // 0~0.05
        recency                       // 0~0.03
      ).toFixed(3);

      return {
        id:      candidate.id,
        type:    candType,
        title:   node?.title ?? candidate.payload.title,
        status:  node?.status ?? candidate.payload.status ?? "",
        score,
        signals: {
          semantic:    +sem.toFixed(3),
          tag_idf:     +tag.toFixed(3),
          shared_tags: inter,
          ...(edgeInfo  ? { direct_edge: { type: edgeInfo.type, direction: edgeInfo.direction, weight: +edgeBonus.toFixed(3) } } : {}),
          ...(hop2 > 0  ? { hop2_weight: +hop2.toFixed(3) } : {}),
          ...(affinity  ? { type_affinity: affinity } : {}),
          ...(recency   ? { recency: +recency.toFixed(3) } : {}),
        },
      };
    };

    // entity_type별 그룹핑
    const allCandidates = [...wikiHits, ...adrHits]
      .filter(c => c.id !== args.id)
      .map(rerank)
      .sort((a, b) => b.score - a.score);

    const grouped = {};
    for (const item of allCandidates) {
      if (!grouped[item.type]) grouped[item.type] = [];
      if (grouped[item.type].length < limit) grouped[item.type].push(item);
    }

    return {
      content: [{ type: "text", text: JSON.stringify(grouped, null, 2) }],
    };
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

  return { content: [{ type: "text", text: `알 수 없는 도구: ${name}` }], isError: true };
});

const transport = new StdioServerTransport();
await server.connect(transport);
