#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";

const ROOT         = path.join(import.meta.dirname, "..");
const GRAPH_FILE   = path.join(ROOT, "data/ontology-graph.json");
const EMB_CONCEPT  = path.join(ROOT, "data/embeddings.json");
const EMB_DECISION = path.join(ROOT, "data/adr-embeddings.json");
const BACKEND      = process.env.EMBEDDING_BACKEND;
const OLLAMA_URL   = process.env.OLLAMA_URL || "http://localhost:11434";

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
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

function loadGraph() {
  if (!fs.existsSync(GRAPH_FILE)) return { nodes: {}, edges: [] };
  return JSON.parse(fs.readFileSync(GRAPH_FILE, "utf-8"));
}

function loadEmbeddings() {
  const m = new Map();
  if (fs.existsSync(EMB_CONCEPT)) {
    for (const [slug, v] of Object.entries(JSON.parse(fs.readFileSync(EMB_CONCEPT, "utf-8"))))
      if (v?.embedding) m.set(`concept/${slug}`, v.embedding);
  }
  if (fs.existsSync(EMB_DECISION)) {
    for (const [slug, v] of Object.entries(JSON.parse(fs.readFileSync(EMB_DECISION, "utf-8"))))
      if (v?.embedding) m.set(`decision/${slug}`, v.embedding);
  }
  return m;
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
          type:   { type: "string", description: "decision | concept (생략 시 전체)" },
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
        properties: { id: { type: "string", description: "예: decision/2024-001-use-kafka" } },
        required: ["id"],
      },
    },
    {
      name: "ontology_related",
      description: "엔티티의 관계(엣지)를 탐색한다. rel_type과 방향으로 필터링 가능.",
      inputSchema: {
        type: "object",
        properties: {
          id:        { type: "string", description: "엔티티 ID" },
          rel_type:  { type: "string", description: "implements | references | extends | supersedes | motivates | contradicts | involves" },
          direction: { type: "string", description: "from | to | both (기본: both)" },
        },
        required: ["id"],
      },
    },
    {
      name: "ontology_find",
      description: "임베딩 유사도로 관련 엔티티를 검색한다. type으로 범위 제한 가능.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "검색 쿼리" },
          type:  { type: "string", description: "decision | concept (생략 시 전체)" },
          limit: { type: "number", description: "최대 반환 수 (기본 10)" },
        },
        required: ["query"],
      },
    },
    {
      name: "ontology_decision_context",
      description: "ADR 결정의 전체 컨텍스트: 본문 + 유사 과거 결정 + 그래프 관계. 새 ADR 작성 시 과거 결정 소환용.",
      inputSchema: {
        type: "object",
        properties: {
          id:    { type: "string", description: "decision 엔티티 ID (예: decision/2024-001-use-kafka)" },
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
    const dir = args.direction ?? "both";
    let edges = graph.edges.filter(e =>
      ((dir === "from" || dir === "both") && e.from === args.id) ||
      ((dir === "to"   || dir === "both") && e.to   === args.id)
    );
    if (args.rel_type) edges = edges.filter(e => e.type === args.rel_type);
    const result = edges.map(e => {
      const peerId = e.from === args.id ? e.to : e.from;
      return { edge: e, node: graph.nodes[peerId] ?? { id: peerId, title: "(unknown)" } };
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }

  if (name === "ontology_find") {
    if (!fs.existsSync(EMB_CONCEPT) && !fs.existsSync(EMB_DECISION))
      return { content: [{ type: "text", text: "임베딩 캐시 없음. generate-embeddings.js / generate-adr-embeddings.js 먼저 실행하세요." }], isError: true };
    let queryVec;
    try { queryVec = await embedQuery(args.query); }
    catch (e) { return { content: [{ type: "text", text: `임베딩 오류: ${e.message}` }], isError: true }; }

    const embs = loadEmbeddings();
    const scored = [];
    for (const [id, emb] of embs) {
      if (args.type && !id.startsWith(args.type + "/")) continue;
      const node = graph.nodes[id];
      if (!node) continue;
      scored.push({ id, score: cosine(queryVec, emb), title: node.title, type: node.type, status: node.status, tags: node.tags });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, args.limit ?? 10).map(s => ({ ...s, score: +s.score.toFixed(3) }));
    return { content: [{ type: "text", text: top.length ? JSON.stringify(top, null, 2) : `'${args.query}' 관련 항목 없음` }] };
  }

  if (name === "ontology_decision_context") {
    const node = graph.nodes[args.id];
    if (!node || node.type !== "decision")
      return { content: [{ type: "text", text: `decision 엔티티 아님: ${args.id}` }], isError: true };

    const fp = path.join(ROOT, node.path);
    const content = fs.existsSync(fp) ? fs.readFileSync(fp, "utf-8") : "(파일 없음)";
    const related = graph.edges
      .filter(e => e.from === args.id || e.to === args.id)
      .map(e => ({ ...e, peer: graph.nodes[e.from === args.id ? e.to : e.from] ?? { id: e.from === args.id ? e.to : e.from } }));

    let similar = [];
    if (fs.existsSync(EMB_DECISION)) {
      try {
        const queryVec = await embedQuery(content.slice(0, 2000));
        const embs = loadEmbeddings();
        const scored = [];
        for (const [id, emb] of embs) {
          if (!id.startsWith("decision/") || id === args.id) continue;
          const n = graph.nodes[id];
          if (!n) continue;
          scored.push({ id, score: cosine(queryVec, emb), title: n.title, status: n.status });
        }
        scored.sort((a, b) => b.score - a.score);
        similar = scored.slice(0, args.limit ?? 5).map(s => ({ ...s, score: +s.score.toFixed(3) }));
      } catch { /* 임베딩 불가 시 유사 결정 생략 */ }
    }

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
