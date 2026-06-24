#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";

const ADR_DIR    = path.join(import.meta.dirname, "..", "_adr");
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const COLLECTION = "adr";
const MODEL      = "bge-m3";

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

  return [
    "---",
    `layout    : adr`,
    `title     : ${args.title}`,
    `date      : ${date}`,
    `updated   : ${now}`,
    `tag       : ${args.tag ?? ""}`,
    `status    : ${args.status ?? "proposed"}`,
    `deciders  : ${args.deciders ?? ""}`,
    `public    : false`,
    "---",
  ].join("\n");
}

async function embedQuery(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt: text }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  const { embedding } = await res.json();
  if (!embedding) throw new Error("Ollama 임베딩 응답 형식 오류");
  return embedding;
}

async function qdrantSearch(vector, limit) {
  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION}/points/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vector, limit, with_payload: true }),
  });
  if (!res.ok) throw new Error(`Qdrant HTTP ${res.status}: ${await res.text()}`);
  const { result } = await res.json();
  return result ?? [];
}

function collectAdrFiles(dir, base = ADR_DIR) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectAdrFiles(fullPath, base));
    } else if (entry.name.endsWith(".md")) {
      results.push(path.relative(base, fullPath));
    }
  }
  return results;
}

const server = new Server(
  { name: "dgnppr-adr", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
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
        properties: {
          path: {
            type: "string",
            description: "ADR 파일 경로 (예: 2024-001-use-kafka.md)",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "adr_search",
      description: "ADR 전체에서 키워드를 검색한다. 제목과 본문 모두 검색.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "검색할 키워드" },
        },
        required: ["query"],
      },
    },
    {
      name: "adr_find",
      description: "ADR에서 임베딩 기반으로 관련 문서를 검색한다. 시맨틱 유사도 순으로 반환.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "검색 질문 또는 키워드" },
        },
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
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "adr_list") {
    const files = collectAdrFiles(ADR_DIR);
    const pages = files.map((f) => {
      const content = fs.readFileSync(path.join(ADR_DIR, f), "utf-8");
      const { meta } = parseFrontmatter(content);
      return {
        path: f,
        title: meta.title || f,
        status: meta.status || "",
        deciders: meta.deciders || "",
        tags: meta.tag || "",
        date: meta.date || "",
      };
    });
    return { content: [{ type: "text", text: JSON.stringify(pages, null, 2) }] };
  }

  if (name === "adr_read") {
    const filePath = path.join(ADR_DIR, args.path);
    if (!filePath.startsWith(ADR_DIR)) {
      return { content: [{ type: "text", text: "잘못된 경로입니다." }], isError: true };
    }
    if (!fs.existsSync(filePath)) {
      return { content: [{ type: "text", text: `파일을 찾을 수 없습니다: ${args.path}` }], isError: true };
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return { content: [{ type: "text", text: content }] };
  }

  if (name === "adr_search") {
    const query = args.query.toLowerCase();
    const files = collectAdrFiles(ADR_DIR);
    const results = [];

    for (const f of files) {
      const content = fs.readFileSync(path.join(ADR_DIR, f), "utf-8");
      const { meta, body } = parseFrontmatter(content);
      const title = (meta.title || f).toLowerCase();
      const bodyLower = body.toLowerCase();

      if (title.includes(query) || bodyLower.includes(query)) {
        const idx = bodyLower.indexOf(query);
        const snippet = idx >= 0
          ? body.slice(Math.max(0, idx - 80), idx + 160).replace(/\n+/g, " ")
          : "";
        results.push({ path: f, title: meta.title || f, status: meta.status || "", snippet });
      }
    }

    return {
      content: [{
        type: "text",
        text: results.length
          ? JSON.stringify(results, null, 2)
          : `'${args.query}'에 대한 결과가 없습니다.`,
      }],
    };
  }

  if (name === "adr_find" || name === "adr_query") {
    let queryVec;
    try {
      queryVec = await embedQuery(args.query);
    } catch (e) {
      return { content: [{ type: "text", text: `임베딩 오류: ${e.message}` }], isError: true };
    }

    let hits;
    try {
      const limit = name === "adr_find" ? 10 : (args.limit ?? 3);
      hits = await qdrantSearch(queryVec, limit);
    } catch (e) {
      return { content: [{ type: "text", text: `Qdrant 오류: ${e.message}` }], isError: true };
    }

    if (!hits.length) {
      return { content: [{ type: "text", text: `'${args.query}'에 대한 ADR을 찾을 수 없습니다.` }] };
    }

    if (name === "adr_find") {
      const results = hits.map(({ payload, score }) => ({
        path:   payload.slug + ".md",
        title:  payload.title,
        status: payload.status,
        tags:   payload.tag,
        score:  +score.toFixed(3),
      }));
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }

    if (name === "adr_query") {
      const output = hits.map(({ payload, score }) => {
        const filePath = path.join(ADR_DIR, payload.slug + ".md");
        if (!fs.existsSync(filePath)) return null;
        const content = fs.readFileSync(filePath, "utf-8");
        const { meta, body } = parseFrontmatter(content);
        return `# ${meta.title || payload.slug}\n경로: ${payload.slug}.md | 유사도: ${score.toFixed(3)} | 상태: ${meta.status || "unknown"}\n태그: ${meta.tag || "(없음)"} | 결정자: ${meta.deciders || "(없음)"}\n\n${body}`;
      }).filter(Boolean).join("\n\n---\n\n");
      return { content: [{ type: "text", text: output }] };
    }
  }

  if (name === "adr_write") {
    const filePath = path.resolve(ADR_DIR, args.path);
    if (!filePath.startsWith(ADR_DIR + path.sep) && filePath !== ADR_DIR) {
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
