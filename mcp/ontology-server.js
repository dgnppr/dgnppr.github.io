#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";

const ROOT            = path.join(import.meta.dirname, "..");
const GRAPH_FILE      = path.join(ROOT, "data/ontology-graph.json");
const EMBEDDINGS_FILE = path.join(ROOT, "data/embeddings.json");
const WIKI_DIR        = path.join(ROOT, "_wiki");
const ADR_DIR         = path.join(ROOT, "_adr");

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

const WIKI_ENTITY_TYPES = new Set(["concept", "insight", "problem", "tool", "event"]);

// ── Shared helpers ──────────────────────────────────────────────────────────

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

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
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

async function qdrantSearch(collection, vector, limit = 20) {
  const res = await fetch(`${QDRANT_URL}/collections/${collection}/points/search`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vector, limit, with_payload: true }),
  });
  if (!res.ok) return [];
  return (await res.json()).result ?? [];
}

function collectFiles(dir) {
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

// ── Frontmatter builders ────────────────────────────────────────────────────

function buildWikiFrontmatter(args, existingMeta = null) {
  const now = formatDate(new Date());
  const category = args.path.includes("/") ? args.path.split("/")[0] : "";
  return [
    "---",
    `layout  : wiki`,
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

function buildAdrFrontmatter(args, existingMeta = null) {
  const now = formatDate(new Date());
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

// ── Server ──────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "dgnppr-ontology", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // ── Wiki ──
    {
      name: "wiki_list",
      description: "위키의 모든 페이지 목록을 반환한다. 카테고리와 파일명 포함.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "wiki_read",
      description: "위키 페이지를 읽는다. 경로는 wiki_list에서 반환된 값을 사용.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "위키 파일 경로 (예: llm/00_what_is_transformers.md)" } },
        required: ["path"],
      },
    },
    {
      name: "wiki_search",
      description: "위키 전체에서 키워드를 검색한다. 제목과 본문 모두 검색.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "검색할 키워드" } },
        required: ["query"],
      },
    },
    {
      name: "wiki_find",
      description: "위키에서 임베딩 유사도 기반으로 관련 문서를 반환한다. 관련도 순 목록.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "검색 키워드 또는 질문" } },
        required: ["query"],
      },
    },
    {
      name: "wiki_query",
      description: "위키에서 질문과 관련된 문서의 전체 본문을 반환한다. Claude가 내용을 읽고 사용자 질문에 답하는 용도.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "검색할 질문 또는 키워드" },
          limit: { type: "number", description: "반환할 최대 문서 수 (기본: 3)" },
        },
        required: ["query"],
      },
    },
    {
      name: "wiki_write",
      description: "위키 페이지를 생성하거나 수정한다. frontmatter는 서버가 자동 조립한다. 기존 파일 수정 시 date는 보존되고 updated만 갱신된다.",
      inputSchema: {
        type: "object",
        properties: {
          path:   { type: "string", description: "위키 파일 경로 (예: llm/01_attention.md)" },
          title:  { type: "string", description: "페이지 제목" },
          body:   { type: "string", description: "본문 내용 (frontmatter 제외)" },
          tag:    { type: "string", description: "태그 (공백 구분, 선택)" },
          status: { type: "string", description: "상태: draft | writing | complete (기본: draft)" },
          public: { type: "boolean", description: "공개 여부 (기본: true)" },
        },
        required: ["path", "title", "body"],
      },
    },
    // ── ADR ──
    {
      name: "adr_list",
      description: "모든 ADR 목록을 반환한다. 파일명, 제목, 상태, 결정자 포함.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "adr_read",
      description: "ADR 문서를 읽는다. 경로는 adr_list에서 반환된 값을 사용.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "ADR 파일 경로 (예: 2024-001-use-kafka.md)" } },
        required: ["path"],
      },
    },
    {
      name: "adr_search",
      description: "ADR 전체에서 키워드를 검색한다. 제목과 본문 모두 검색.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "검색할 키워드" } },
        required: ["query"],
      },
    },
    {
      name: "adr_find",
      description: "ADR에서 임베딩 기반으로 관련 문서를 검색한다. 시맨틱 유사도 순으로 반환.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "검색 질문 또는 키워드" } },
        required: ["query"],
      },
    },
    {
      name: "adr_query",
      description: "ADR에서 질문과 관련된 문서의 전체 본문을 반환한다. Claude가 내용을 읽고 답하는 용도.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "검색할 질문 또는 키워드" },
          limit: { type: "number", description: "반환할 최대 문서 수 (기본: 3)" },
        },
        required: ["query"],
      },
    },
    {
      name: "adr_write",
      description: "ADR 문서를 생성하거나 수정한다. frontmatter는 서버가 자동 조립한다. 기존 파일 수정 시 date는 보존되고 updated만 갱신된다.",
      inputSchema: {
        type: "object",
        properties: {
          path:     { type: "string", description: "ADR 파일 경로 (예: 2024-001-use-kafka.md)" },
          title:    { type: "string", description: "ADR 제목" },
          body:     { type: "string", description: "본문 내용 (frontmatter 제외)" },
          tag:      { type: "string", description: "태그 (공백 구분, 선택)" },
          status:   { type: "string", description: "상태: proposed | accepted | deprecated | superseded (기본: proposed)" },
          deciders: { type: "string", description: "결정 참여자 (공백 구분, 선택)" },
        },
        required: ["path", "title", "body"],
      },
    },
    // ── Ontology ──
    {
      name: "ontology_entities",
      description: "온톨로지 그래프에서 엔티티 목록을 반환한다. query가 있으면 임베딩 기반 시맨틱 검색, 없으면 type/status/tag 필터 목록.",
      inputSchema: {
        type: "object",
        properties: {
          query:  { type: "string", description: "시맨틱 검색 쿼리 (주면 임베딩 기반, 생략 시 전체 목록)" },
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
      description: "텍스트 또는 엔티티 ID 기준으로 adr·wiki 양쪽을 탐색한다. Qdrant ANN(candidate gen) + 태그·그래프 시그널(re-rank). 결과는 { related_adrs, related_wiki } 두 그룹으로 반환한다.",
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

  // ── wiki_list ──────────────────────────────────────────────────────────────
  if (name === "wiki_list") {
    const pages = collectFiles(WIKI_DIR).map((f) => {
      const { meta } = parseFrontmatter(fs.readFileSync(path.join(WIKI_DIR, f), "utf-8"));
      return { path: f, title: meta.title || f, tags: meta.tag || "" };
    });
    return { content: [{ type: "text", text: JSON.stringify(pages, null, 2) }] };
  }

  // ── wiki_read ──────────────────────────────────────────────────────────────
  if (name === "wiki_read") {
    const filePath = path.join(WIKI_DIR, args.path);
    if (!filePath.startsWith(WIKI_DIR))
      return { content: [{ type: "text", text: "잘못된 경로입니다." }], isError: true };
    if (!fs.existsSync(filePath))
      return { content: [{ type: "text", text: `파일을 찾을 수 없습니다: ${args.path}` }], isError: true };
    return { content: [{ type: "text", text: fs.readFileSync(filePath, "utf-8") }] };
  }

  // ── wiki_search ────────────────────────────────────────────────────────────
  if (name === "wiki_search") {
    const query = args.query.toLowerCase();
    const results = [];
    for (const f of collectFiles(WIKI_DIR)) {
      const content = fs.readFileSync(path.join(WIKI_DIR, f), "utf-8");
      const { meta, body } = parseFrontmatter(content);
      const title = (meta.title || f).toLowerCase();
      const bodyLower = body.toLowerCase();
      if (title.includes(query) || bodyLower.includes(query)) {
        const idx = bodyLower.indexOf(query);
        const snippet = idx >= 0 ? body.slice(Math.max(0, idx - 80), idx + 160).replace(/\n+/g, " ") : "";
        results.push({ path: f, title: meta.title || f, snippet });
      }
    }
    return {
      content: [{ type: "text", text: results.length ? JSON.stringify(results, null, 2) : `'${args.query}'에 대한 결과가 없습니다.` }],
    };
  }

  // ── wiki_find / wiki_query ─────────────────────────────────────────────────
  if (name === "wiki_find" || name === "wiki_query") {
    if (!fs.existsSync(EMBEDDINGS_FILE))
      return { content: [{ type: "text", text: "임베딩 캐시가 없습니다. generate-embeddings.js를 먼저 실행하세요." }], isError: true };
    const cache = JSON.parse(fs.readFileSync(EMBEDDINGS_FILE, "utf-8"));

    let queryVec;
    try { queryVec = await embedQuery(args.query); }
    catch (e) { return { content: [{ type: "text", text: `임베딩 오류: ${e.message}` }], isError: true }; }

    const scored = collectFiles(WIKI_DIR)
      .map((f) => {
        const slug = f.replace(/\.md$/, "");
        const cached = cache[slug];
        if (!cached) return null;
        return { f, score: cosine(queryVec, cached.embedding) };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    if (name === "wiki_find") {
      const results = scored.slice(0, 10).map(({ f, score }) => {
        const { meta } = parseFrontmatter(fs.readFileSync(path.join(WIKI_DIR, f), "utf-8"));
        return { path: f, title: meta.title || f, tags: meta.tag || "", score: +score.toFixed(3) };
      });
      return {
        content: [{ type: "text", text: results.length ? JSON.stringify(results, null, 2) : `'${args.query}'에 대한 문서를 찾을 수 없습니다.` }],
      };
    }

    const limit = args.limit ?? 3;
    if (!scored.length)
      return { content: [{ type: "text", text: `'${args.query}'에 대한 위키 내용을 찾을 수 없습니다.` }] };
    const output = scored.slice(0, limit).map(({ f, score }) => {
      const content = fs.readFileSync(path.join(WIKI_DIR, f), "utf-8");
      const { meta, body } = parseFrontmatter(content);
      return `# ${meta.title || f}\n경로: ${f} | 유사도: ${score.toFixed(3)}\n태그: ${meta.tag || "(없음)"}\n\n${body}`;
    }).join("\n\n---\n\n");
    return { content: [{ type: "text", text: output }] };
  }

  // ── wiki_write ─────────────────────────────────────────────────────────────
  if (name === "wiki_write") {
    const filePath = path.resolve(WIKI_DIR, args.path);
    if (!filePath.startsWith(WIKI_DIR + path.sep) && filePath !== WIKI_DIR)
      return { content: [{ type: "text", text: "잘못된 경로입니다." }], isError: true };
    if (!args.path.endsWith(".md"))
      return { content: [{ type: "text", text: ".md 파일만 쓸 수 있습니다." }], isError: true };
    const existingMeta = fs.existsSync(filePath) ? parseFrontmatter(fs.readFileSync(filePath, "utf-8")).meta : null;
    const file = `${buildWikiFrontmatter(args, existingMeta)}\n\n${args.body.trim()}\n`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, file, "utf-8");
    return { content: [{ type: "text", text: `저장 완료: ${args.path}` }] };
  }

  // ── adr_list ───────────────────────────────────────────────────────────────
  if (name === "adr_list") {
    const pages = collectFiles(ADR_DIR).map((f) => {
      const { meta } = parseFrontmatter(fs.readFileSync(path.join(ADR_DIR, f), "utf-8"));
      return { path: f, title: meta.title || f, status: meta.status || "", deciders: meta.deciders || "", tags: meta.tag || "", date: meta.date || "" };
    });
    return { content: [{ type: "text", text: JSON.stringify(pages, null, 2) }] };
  }

  // ── adr_read ───────────────────────────────────────────────────────────────
  if (name === "adr_read") {
    const filePath = path.join(ADR_DIR, args.path);
    if (!filePath.startsWith(ADR_DIR))
      return { content: [{ type: "text", text: "잘못된 경로입니다." }], isError: true };
    if (!fs.existsSync(filePath))
      return { content: [{ type: "text", text: `파일을 찾을 수 없습니다: ${args.path}` }], isError: true };
    return { content: [{ type: "text", text: fs.readFileSync(filePath, "utf-8") }] };
  }

  // ── adr_search ─────────────────────────────────────────────────────────────
  if (name === "adr_search") {
    const query = args.query.toLowerCase();
    const results = [];
    for (const f of collectFiles(ADR_DIR)) {
      const content = fs.readFileSync(path.join(ADR_DIR, f), "utf-8");
      const { meta, body } = parseFrontmatter(content);
      const title = (meta.title || f).toLowerCase();
      const bodyLower = body.toLowerCase();
      if (title.includes(query) || bodyLower.includes(query)) {
        const idx = bodyLower.indexOf(query);
        const snippet = idx >= 0 ? body.slice(Math.max(0, idx - 80), idx + 160).replace(/\n+/g, " ") : "";
        results.push({ path: f, title: meta.title || f, status: meta.status || "", snippet });
      }
    }
    return {
      content: [{ type: "text", text: results.length ? JSON.stringify(results, null, 2) : `'${args.query}'에 대한 결과가 없습니다.` }],
    };
  }

  // ── adr_find / adr_query ───────────────────────────────────────────────────
  if (name === "adr_find" || name === "adr_query") {
    let queryVec;
    try { queryVec = await embedQuery(args.query); }
    catch (e) { return { content: [{ type: "text", text: `임베딩 오류: ${e.message}` }], isError: true }; }

    let hits;
    try { hits = await qdrantSearch("adr", queryVec, name === "adr_find" ? 10 : (args.limit ?? 3)); }
    catch (e) { return { content: [{ type: "text", text: `Qdrant 오류: ${e.message}` }], isError: true }; }

    if (!hits.length)
      return { content: [{ type: "text", text: `'${args.query}'에 대한 ADR을 찾을 수 없습니다.` }] };

    if (name === "adr_find") {
      const results = hits.map(({ payload, score }) => ({
        path: payload.slug + ".md", title: payload.title, status: payload.status, tags: payload.tag, score: +score.toFixed(3),
      }));
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }

    const output = hits.map(({ payload, score }) => {
      const filePath = path.join(ADR_DIR, payload.slug + ".md");
      if (!fs.existsSync(filePath)) return null;
      const { meta, body } = parseFrontmatter(fs.readFileSync(filePath, "utf-8"));
      return `# ${meta.title || payload.slug}\n경로: ${payload.slug}.md | 유사도: ${score.toFixed(3)} | 상태: ${meta.status || "unknown"}\n태그: ${meta.tag || "(없음)"} | 결정자: ${meta.deciders || "(없음)"}\n\n${body}`;
    }).filter(Boolean).join("\n\n---\n\n");
    return { content: [{ type: "text", text: output }] };
  }

  // ── adr_write ──────────────────────────────────────────────────────────────
  if (name === "adr_write") {
    const filePath = path.resolve(ADR_DIR, args.path);
    if (!filePath.startsWith(ADR_DIR + path.sep) && filePath !== ADR_DIR)
      return { content: [{ type: "text", text: "잘못된 경로입니다." }], isError: true };
    if (!args.path.endsWith(".md"))
      return { content: [{ type: "text", text: ".md 파일만 쓸 수 있습니다." }], isError: true };
    const existingMeta = fs.existsSync(filePath) ? parseFrontmatter(fs.readFileSync(filePath, "utf-8")).meta : null;
    const file = `${buildAdrFrontmatter(args, existingMeta)}\n\n${args.body.trim()}\n`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, file, "utf-8");
    return { content: [{ type: "text", text: `저장 완료: ${args.path}` }] };
  }

  // ── ontology_entities ──────────────────────────────────────────────────────
  if (name === "ontology_entities") {
    const graph = loadGraph();
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

    const edgeMap = new Map();
    if (args.id) {
      for (const e of graph.edges) {
        if (e.from === args.id) edgeMap.set(e.to,   e.type);
        if (e.to   === args.id) edgeMap.set(e.from, e.type);
      }
    }

    // ponytail: always search both collections
    const limit = args.limit ?? 5;
    const candidateLimit = limit * 5;
    const [wikiHits, adrHits] = await Promise.all([
      qdrantSearch("wiki", queryVec, candidateLimit).then(hits =>
        hits.map(h => ({ id: `${h.payload.entity_type || "concept"}/${h.payload.slug}`, score: h.score, payload: h.payload }))
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
      content: [{ type: "text", text: JSON.stringify({ related_adrs: rerank(adrHits), related_wiki: rerank(wikiHits) }, null, 2) }],
    };
  }

  // ── ontology_find ──────────────────────────────────────────────────────────
  if (name === "ontology_find") {
    let queryVec;
    try { queryVec = await embedQuery(args.query); }
    catch (e) { return { content: [{ type: "text", text: `임베딩 오류: ${e.message}` }], isError: true }; }

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
