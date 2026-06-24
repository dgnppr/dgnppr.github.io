#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";

const ROOT       = path.join(import.meta.dirname, "..");
const GRAPH_FILE = path.join(ROOT, "data/ontology-graph.json");

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

// concept → wiki collection, adr → adr collection
const COLLECTION = { concept: "wiki", adr: "adr" };

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

async function qdrantSearch(collection, vector, limit = 20) {
  const res = await fetch(`${QDRANT_URL}/collections/${collection}/points/search`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vector, limit, with_payload: true }),
  });
  if (!res.ok) return [];
  return (await res.json()).result ?? [];
}

function loadGraph() {
  if (!fs.existsSync(GRAPH_FILE)) return { nodes: {}, edges: [] };
  return JSON.parse(fs.readFileSync(GRAPH_FILE, "utf-8"));
}

const server = new Server(
  { name: "dgnppr-ontology", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "ontology_entities",
      description: "온톨로지 그래프에서 엔티티 목록을 반환한다. type/status/tag로 필터링 가능.",
      inputSchema: {
        type: "object",
        properties: {
          type:   { type: "string", description: "adr | concept (생략 시 전체)" },
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
      description: "텍스트 또는 엔티티 ID 기준으로 adr·wiki 양쪽을 탐색한다. Qdrant ANN(candidate gen) + 태그·그래프 시그널(re-rank). 결과는 { related_adrs, related_wiki } 두 그룹으로 반환한다. ADR 기준이면 관련 ADR + 연관 wiki, wiki 기준이면 관련 wiki + 연관 ADR.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "검색할 텍스트 (query 또는 id 중 하나 필수)" },
          id:    { type: "string", description: "기준 엔티티 ID — 본문을 쿼리로 사용하고 graph 시그널도 활성화됨" },
          limit: { type: "number", description: "그룹당 최대 수 (기본 5)" },
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
          type:  { type: "string", description: "adr | concept (생략 시 전체)" },
          limit: { type: "number", description: "최대 반환 수 (기본 10)" },
        },
        required: ["query"],
      },
    },
    {
      name: "ontology_decision_context",
      description: "ADR 결정의 전체 컨텍스트: 본문 + 유사 과거 결정(Qdrant) + 그래프 관계. 새 ADR 작성 시 과거 결정 소환용.",
      inputSchema: {
        type: "object",
        properties: {
          id:    { type: "string", description: "adr 엔티티 ID (예: adr/architecture/2024-001-use-kafka)" },
          limit: { type: "number", description: "유사 결정 최대 수 (기본 5)" },
        },
        required: ["id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const graph = loadGraph();

  if (name === "ontology_entities") {
    let nodes = Object.values(graph.nodes);
    if (args.type)   nodes = nodes.filter(n => n.type === args.type);
    if (args.status) nodes = nodes.filter(n => n.status === args.status);
    if (args.tag)    nodes = nodes.filter(n => n.tags?.includes(args.tag));
    const result = nodes.slice(0, args.limit ?? 50)
      .map(({ id, type, title, status, tags, date }) => ({ id, type, title, status, tags, date }));
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }

  if (name === "ontology_get") {
    const node = graph.nodes[args.id];
    if (!node) return { content: [{ type: "text", text: `엔티티 없음: ${args.id}` }], isError: true };
    const fp = path.join(ROOT, node.path);
    const content = fs.existsSync(fp) ? fs.readFileSync(fp, "utf-8") : "(파일 없음)";
    const relations = graph.edges.filter(e => e.from === args.id || e.to === args.id);
    return { content: [{ type: "text", text: JSON.stringify({ ...node, relations, content }, null, 2) }] };
  }

  if (name === "ontology_related") {
    if (!args.query && !args.id)
      return { content: [{ type: "text", text: "query 또는 id 중 하나 필수" }], isError: true };

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

    const edgeMap = new Map();
    if (args.id) {
      for (const e of graph.edges) {
        if (e.from === args.id) edgeMap.set(e.to,   e.type);
        if (e.to   === args.id) edgeMap.set(e.from, e.type);
      }
    }

    // ponytail: always search both collections — ADR gets related_adrs+related_wiki, wiki gets the reverse
    const limit = args.limit ?? 5;
    const candidateLimit = limit * 5;
    const [wikiHits, adrHits] = await Promise.all([
      qdrantSearch("wiki", queryVec, candidateLimit).then(hits =>
        hits.map(h => ({ id: `concept/${h.payload.slug}`, score: h.score, payload: h.payload }))
      ),
      qdrantSearch("adr", queryVec, candidateLimit).then(hits =>
        hits.map(h => ({ id: `adr/${h.payload.slug}`, score: h.score, payload: h.payload }))
      ),
    ]);

    const rerank = (candidates) => candidates
      .filter(c => c.id !== args.id)
      .map(c => {
        const node     = graph.nodes[c.id];
        const nodeTags = node?.tags ?? (c.payload.tag ? c.payload.tag.split(/\s+/).filter(Boolean) : []);
        const inter    = anchorTags.filter(t => nodeTags.includes(t));
        const unionLen = new Set([...anchorTags, ...nodeTags]).size;
        const tag      = unionLen > 0 ? inter.length / unionLen : 0;
        const edge     = edgeMap.get(c.id) ?? null;
        return {
          id:      c.id,
          title:   node?.title ?? c.payload.title,
          status:  node?.status ?? c.payload.status ?? "",
          score:   +(c.score * 0.7 + tag * 0.2 + (edge ? 0.1 : 0)).toFixed(3),
          signals: { semantic: +c.score.toFixed(3), shared_tags: inter, ...(edge ? { graph_edge: edge } : {}) },
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          related_adrs: rerank(adrHits),
          related_wiki: rerank(wikiHits),
        }, null, 2),
      }],
    };
  }

  if (name === "ontology_find") {
    let queryVec;
    try { queryVec = await embedQuery(args.query); }
    catch (e) { return { content: [{ type: "text", text: `임베딩 오류: ${e.message}` }], isError: true }; }

    const collections = args.type
      ? [{ col: COLLECTION[args.type], type: args.type }]
      : [{ col: "wiki", type: "concept" }, { col: "adr", type: "adr" }];

    const hits = (
      await Promise.all(collections.map(({ col, type }) =>
        qdrantSearch(col, queryVec, args.limit ?? 10).then(results =>
          results.map(h => ({
            id:     `${type}/${h.payload.slug}`,
            title:  h.payload.title,
            type,
            status: h.payload.status ?? "",
            tags:   h.payload.tag ?? "",
            score:  +h.score.toFixed(3),
          }))
        )
      ))
    ).flat().sort((a, b) => b.score - a.score).slice(0, args.limit ?? 10);

    return { content: [{ type: "text", text: hits.length ? JSON.stringify(hits, null, 2) : `'${args.query}' 관련 항목 없음` }] };
  }

  if (name === "ontology_decision_context") {
    const node = graph.nodes[args.id];
    if (!node || node.type !== "adr")
      return { content: [{ type: "text", text: `adr 엔티티 아님: ${args.id}` }], isError: true };

    const fp = path.join(ROOT, node.path);
    const content = fs.existsSync(fp) ? fs.readFileSync(fp, "utf-8") : "(파일 없음)";
    const related = graph.edges
      .filter(e => e.from === args.id || e.to === args.id)
      .map(e => ({ ...e, peer: graph.nodes[e.from === args.id ? e.to : e.from] ?? { id: e.from === args.id ? e.to : e.from } }));

    let similar = [];
    try {
      const queryVec = await embedQuery(content.replace(/^---[\s\S]*?---\n/, "").slice(0, 2000));
      const slug = args.id.replace(/^adr\//, "");
      similar = (await qdrantSearch("adr", queryVec, (args.limit ?? 5) + 1))
        .filter(h => h.payload.slug !== slug)
        .slice(0, args.limit ?? 5)
        .map(h => ({ id: `adr/${h.payload.slug}`, title: h.payload.title, status: h.payload.status, score: +h.score.toFixed(3) }));
    } catch { /* 임베딩 불가 시 유사 결정 생략 */ }

    const out = [
      `# ${node.title}`,
      `\n## 메타\n${JSON.stringify({ id: args.id, status: node.status, tags: node.tags, date: node.date }, null, 2)}`,
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
