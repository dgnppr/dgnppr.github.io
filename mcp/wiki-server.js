#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";

const WIKI_DIR = path.join(import.meta.dirname, "..", "_wiki");

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
