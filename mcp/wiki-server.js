#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";

const WIKI_DIR       = path.join(import.meta.dirname, "..", "_wiki");
const EMBEDDINGS_FILE = path.join(import.meta.dirname, "..", "data", "embeddings.json");
const BACKEND        = process.env.EMBEDDING_BACKEND;
const OLLAMA_URL     = process.env.OLLAMA_URL || "http://localhost:11434";

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

function buildFrontmatter(args, existingMeta = null) {
  const now = formatDate(new Date());
  const date = existingMeta?.date ?? now;
  const category = args.path.includes("/") ? args.path.split("/")[0] : "";

  return [
    "---",
    `layout  : wiki`,
    `title   : ${args.title}`,
    `date    : ${date}`,
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

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

let _ai;
async function embedQuery(text) {
  if (!BACKEND) throw new Error("EMBEDDING_BACKEND 환경변수가 설정되지 않았습니다 (vertexai | ollama)");

  if (BACKEND === "ollama") {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "bge-m3", prompt: text }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
    const json = await res.json();
    return json.embedding;
  }

  if (!_ai) {
    const { GoogleGenAI } = await import("@google/genai");
    _ai = new GoogleGenAI({
      vertexai: true,
      project: process.env.GOOGLE_PROJECT_ID,
      location: process.env.GOOGLE_LOCATION || "asia-northeast3",
    });
  }
  const response = await _ai.models.embedContent({
    model: "text-embedding-004",
    contents: text,
    config: { outputDimensionality: 768 },
  });
  const emb = response.embeddings?.[0]?.values ?? response.embedding?.values;
  if (!emb) throw new Error("Vertex AI 임베딩 응답 형식 오류");
  return emb;
}

function collectWikiFiles(dir, base = WIKI_DIR) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectWikiFiles(fullPath, base));
    } else if (entry.name.endsWith(".md")) {
      results.push(path.relative(base, fullPath));
    }
  }
  return results;
}

const server = new Server(
  { name: "dgnppr-wiki", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
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
        properties: {
          path: {
            type: "string",
            description: "위키 파일 경로 (예: llm/00_what_is_transformers.md)",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "wiki_search",
      description: "위키 전체에서 키워드를 검색한다. 제목과 본문 모두 검색.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "검색할 키워드" },
        },
        required: ["query"],
      },
    },
    {
      name: "wiki_find",
      description: "위키에서 문서를 검색해 관련도 순 목록을 반환한다. 다중 키워드(공백 구분) 지원. 제목 3점, 태그 2점, 본문 출현당 1점으로 채점.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "검색 키워드 (공백으로 구분해 다중 입력 가능)" },
        },
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
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "wiki_list") {
    const files = collectWikiFiles(WIKI_DIR);
    const pages = files.map((f) => {
      const content = fs.readFileSync(path.join(WIKI_DIR, f), "utf-8");
      const { meta } = parseFrontmatter(content);
      return { path: f, title: meta.title || f, tags: meta.tag || "" };
    });
    return { content: [{ type: "text", text: JSON.stringify(pages, null, 2) }] };
  }

  if (name === "wiki_read") {
    const filePath = path.join(WIKI_DIR, args.path);
    if (!filePath.startsWith(WIKI_DIR)) {
      return { content: [{ type: "text", text: "잘못된 경로입니다." }], isError: true };
    }
    if (!fs.existsSync(filePath)) {
      return { content: [{ type: "text", text: `파일을 찾을 수 없습니다: ${args.path}` }], isError: true };
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return { content: [{ type: "text", text: content }] };
  }

  if (name === "wiki_search") {
    const query = args.query.toLowerCase();
    const files = collectWikiFiles(WIKI_DIR);
    const results = [];

    for (const f of files) {
      const content = fs.readFileSync(path.join(WIKI_DIR, f), "utf-8");
      const { meta, body } = parseFrontmatter(content);
      const title = (meta.title || f).toLowerCase();
      const bodyLower = body.toLowerCase();

      if (title.includes(query) || bodyLower.includes(query)) {
        const idx = bodyLower.indexOf(query);
        const snippet =
          idx >= 0
            ? body.slice(Math.max(0, idx - 80), idx + 160).replace(/\n+/g, " ")
            : "";
        results.push({ path: f, title: meta.title || f, snippet });
      }
    }

    return {
      content: [
        {
          type: "text",
          text: results.length
            ? JSON.stringify(results, null, 2)
            : `'${args.query}'에 대한 결과가 없습니다.`,
        },
      ],
    };
  }

  if (name === "wiki_find" || name === "wiki_query") {
    if (!fs.existsSync(EMBEDDINGS_FILE)) {
      return { content: [{ type: "text", text: "임베딩 캐시가 없습니다. generate-embeddings.js를 먼저 실행하세요." }], isError: true };
    }
    const cache = JSON.parse(fs.readFileSync(EMBEDDINGS_FILE, "utf-8"));

    let queryVec;
    try {
      queryVec = await embedQuery(args.query);
    } catch (e) {
      return { content: [{ type: "text", text: `임베딩 오류: ${e.message}` }], isError: true };
    }

    const files = collectWikiFiles(WIKI_DIR);
    const scored = files
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
        const content = fs.readFileSync(path.join(WIKI_DIR, f), "utf-8");
        const { meta } = parseFrontmatter(content);
        return { path: f, title: meta.title || f, tags: meta.tag || "", score: +score.toFixed(3) };
      });
      return {
        content: [{
          type: "text",
          text: results.length
            ? JSON.stringify(results, null, 2)
            : `'${args.query}'에 대한 문서를 찾을 수 없습니다.`,
        }],
      };
    }

    if (name === "wiki_query") {
      const limit = args.limit ?? 3;
      const top = scored.slice(0, limit);
      if (!top.length) {
        return { content: [{ type: "text", text: `'${args.query}'에 대한 위키 내용을 찾을 수 없습니다.` }] };
      }
      const output = top.map(({ f, score }) => {
        const content = fs.readFileSync(path.join(WIKI_DIR, f), "utf-8");
        const { meta, body } = parseFrontmatter(content);
        return `# ${meta.title || f}\n경로: ${f} | 유사도: ${score.toFixed(3)}\n태그: ${meta.tag || "(없음)"}\n\n${body}`;
      }).join("\n\n---\n\n");
      return { content: [{ type: "text", text: output }] };
    }
  }

  if (name === "wiki_write") {
    const filePath = path.resolve(WIKI_DIR, args.path);
    if (!filePath.startsWith(WIKI_DIR + path.sep) && filePath !== WIKI_DIR) {
      return { content: [{ type: "text", text: "잘못된 경로입니다." }], isError: true };
    }
    if (!args.path.endsWith(".md")) {
      return { content: [{ type: "text", text: ".md 파일만 쓸 수 있습니다." }], isError: true };
    }

    const existingMeta = fs.existsSync(filePath)
      ? parseFrontmatter(fs.readFileSync(filePath, "utf-8")).meta
      : null;

    const frontmatter = buildFrontmatter(args, existingMeta);
    const file = `${frontmatter}\n\n${args.body.trim()}\n`;

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, file, "utf-8");
    return { content: [{ type: "text", text: `저장 완료: ${args.path}` }] };
  }

  return { content: [{ type: "text", text: `알 수 없는 도구: ${name}` }], isError: true };
});

const transport = new StdioServerTransport();
await server.connect(transport);
