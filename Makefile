# ----------------------------------------
# Jekyll Local Server Makefile
# ----------------------------------------

export PATH := $(HOME)/.local/share/mise/shims:$(PATH)

PORT    := 4000
HOST    := 127.0.0.1

# 기본 help
.PHONY: help
help:
	@echo "Usage:"
	@echo "  make install    - bundle install (의존성 설치)"
	@echo "  make start      - 포그라운드 서버 실행 (docker compose)"
	@echo "  make back       - 백그라운드 서버 실행 (docker compose -d)"
	@echo "  make stop       - 서버 종료"
	@echo "  make restart    - 서버 재시작"
	@echo "  make status     - 서버 상태 확인"
	@echo "  make clean      - 빌드 캐시 정리"
	@echo ""
	@echo "Data generation:"
	@echo "  make add-status          - status: complete 추가 (누락된 파일만)"
	@echo "  make stats               - 글쓰기 통계 생성 (월별, 카테고리, 상태)"
	@echo "  make diagrams            - AI 다이어그램 생성 (Vertex AI)"
	@echo "  make diagrams-force      - 모든 다이어그램 강제 재생성"
	@echo "  make summaries           - AI 요약 생성 (캐시 있으면 스킵)"
	@echo "  make summaries-force     - 모든 요약 강제 재생성"
	@echo "  make embeddings            - 임베딩 기반 related.json 생성 (.env EMBEDDING_BACKEND 사용)"
	@echo "  make embeddings-force      - 모든 임베딩 강제 재생성"
	@echo "  make embeddings-bm25       - BM25+Tag 오프라인 related.json (API 없음, CI 동일)"
	@echo "  make local-embeddings    - 전체 문서 Qdrant 인덱싱 (wiki/insight/problem/tool/event/adr)"
	@echo "  make local-embeddings-force - 강제 재인덱싱"
	@echo "  make ontology            - 온톨로지 그래프 재생성 (data/ontology-graph.json)"
	@echo ""
	@echo "Qdrant (로컬 벡터 스토어):"
	@echo "  make qdrant-up     - Qdrant 컨테이너 시작"
	@echo "  make qdrant-down   - Qdrant 컨테이너 중지"
	@echo "  make qdrant-status - Qdrant 상태 확인"
	@echo ""
	@echo "MCP server (ontology):"
	@echo "  make mcp-start   - MCP 서버 포그라운드 실행 (수동 테스트용)"
	@echo "  make mcp-back    - MCP 서버 백그라운드 실행"
	@echo "  make mcp-stop    - MCP 서버 종료"
	@echo "  make mcp-log     - MCP 서버 로그 tail"
	@echo "  make mcp-restart - MCP 서버 재시작"
	@echo "  make mcp-status  - MCP 서버 상태 확인"
	@echo "  make mcp-test    - MCP 서버 동작 확인"
	@echo ""
	@echo "/ontology 스킬 명령:"
	@echo "  doc list [type]            - 문서 목록 (type: concept|insight|problem|tool|event|adr)"
	@echo "  doc search <query> [type]  - 키워드 검색"
	@echo "  doc find <query> [type]    - 임베딩 유사도 검색 (Qdrant)"
	@echo "  doc query <query> [type]   - 임베딩 검색 후 본문 반환"
	@echo "  doc read <type> <path>     - 특정 문서 읽기"
	@echo "  doc write <type> <path>    - 문서 작성/수정"
	@echo "  related <query|id:...>     - hybrid 탐색 (그래프+임베딩, 전체 타입)"
	@echo "  related id:<id> mode:graph - 순수 온톨로지 워크"
	@echo "  neighborhood <id> [content]- N-hop 그래프 워크 + 이행 추론 엣지"
	@echo "  find <query>               - 임베딩 유사도 flat 리스트"
	@echo "  get <entity-id>            - 노드 메타 + 전체 본문 + 관계"
	@echo "  entities [type|query]      - 엔티티 목록 또는 시맨틱 검색"
	@echo "  decision <id|query>        - ADR 컨텍스트 (유사 과거 결정 포함)"
	@echo "  gaps [type]                - 그래프 gap 분석 (고립·미작성·동기없는 ADR)"
	@echo "  act <id> <action>          - gap → doc_write blueprint 생성"
	@echo "  Entity ID: concept/<dir>/<file> | insight/<dir>/<file> | adr/<dir>/<file>"
	@echo "  Actions: extend|implement|challenge|deepen|ground|motivate|resolve|extract|review|supersede"

# ----------------------------------------
# 의존성 설치
# ----------------------------------------
.PHONY: install
install:
	mise exec -- bundle install

# ----------------------------------------
# 데이터 생성
# ----------------------------------------
.PHONY: data
data:
	node generateData.js

# ----------------------------------------
# 상태 필드 추가
# ----------------------------------------
.PHONY: add-status
add-status:
	node scripts/add-status.js

# ----------------------------------------
# 글쓰기 통계 생성
# ----------------------------------------
.PHONY: stats
stats:
	node scripts/generate-writing-stats.js

# ----------------------------------------
# AI 다이어그램 생성 (Vertex AI)
# ----------------------------------------
.PHONY: diagrams diagrams-force
diagrams:
	@set -a && . ./.env && set +a && node scripts/generate-diagrams.js

diagrams-force:
	@set -a && . ./.env && set +a && node scripts/generate-diagrams.js --force

# ----------------------------------------
# AI 요약 생성
# ----------------------------------------
.PHONY: summaries summaries-force
summaries:
	@set -a && . ./.env && set +a && node scripts/generate-summaries.js

summaries-force:
	@set -a && . ./.env && set +a && node scripts/generate-summaries.js --force

# ----------------------------------------
# 임베딩 생성 (related.json 폴백용)
# ----------------------------------------
.PHONY: embeddings embeddings-force embeddings-bm25
embeddings:
	@set -a && . ./.env && set +a && node scripts/generate-embeddings.js

embeddings-force:
	@set -a && . ./.env && set +a && node scripts/generate-embeddings.js --force

embeddings-bm25:
	EMBEDDING_BACKEND=bm25 node scripts/generate-embeddings.js

# ----------------------------------------
# 온톨로지 그래프 생성
# ----------------------------------------
.PHONY: ontology
ontology:
	node scripts/generate-ontology.js

# ----------------------------------------
# 임베딩 생성
# ----------------------------------------
.PHONY: local-embeddings local-embeddings-force

# 로컬 전용: 전체 문서 → Qdrant (wiki + adr 컬렉션)
local-embeddings:
	@set -a && . ./.env && set +a && node scripts/generate-local-embeddings.js

local-embeddings-force:
	@set -a && . ./.env && set +a && node scripts/generate-local-embeddings.js --force

# ----------------------------------------
# Qdrant (로컬 벡터 스토어)
# ----------------------------------------
.PHONY: qdrant-up qdrant-down qdrant-status
qdrant-up:
	@docker compose up qdrant -d
	@echo "Qdrant 시작 — http://localhost:6333"
	@until curl -sf http://localhost:6333/healthz > /dev/null; do sleep 0.5; done

qdrant-down:
	docker compose stop qdrant

qdrant-status:
	@curl -sf http://localhost:6333/healthz && echo "Qdrant 실행 중" || echo "Qdrant 중지됨"

# ----------------------------------------
# 변경된 문서 자동 감지 → 데이터 재생성
# ----------------------------------------
.PHONY: auto-generate
auto-generate:
	@CHANGED=$$(git diff --name-only HEAD; git diff --cached --name-only; git ls-files --others --exclude-standard); \
	DOC_CHANGED=$$(echo "$$CHANGED" | grep -E '^(_wiki|_adr|_insight|_problem|_tool|_event|_posts)/'); \
	if [ -n "$$DOC_CHANGED" ]; then \
		CF=$$(echo "$$DOC_CHANGED" | tr '\n' ':' | sed 's/:$$//'); \
		echo "[auto] 변경 파일: $$CF"; \
		set -a && . ./.env && set +a; \
		$(MAKE) local-embeddings; \
		CHANGED_FILES="$$CF" node scripts/generate-diagrams.js || true; \
		CHANGED_FILES="$$CF" node scripts/generate-summaries.js || true; \
		node scripts/generate-ontology.js; \
	else \
		echo "[auto] 변경된 문서 없음 — 데이터 생성 스킵"; \
	fi

# ----------------------------------------
# 서버 (docker compose)
# ----------------------------------------
.PHONY: start back stop restart status
start: data ontology
	docker compose up

back: data ontology
	docker compose up -d
	@echo "서버 시작 — http://$(HOST):$(PORT)"

stop:
	docker compose stop

restart: clean data auto-generate
	docker compose restart

status:
	@docker compose ps

# ----------------------------------------
# 빌드 캐시 정리
# ----------------------------------------
.PHONY: clean
clean:
	rm -rf _site .jekyll-cache .sass-cache
	@echo "Cleaned."

# ----------------------------------------
# MCP server (ontology)
# ----------------------------------------
MCP_BIN = mcp/ontology-server.js
MCP_PID = .mcp-ontology.pid
MCP_LOG = .mcp-ontology.log

.PHONY: mcp-start mcp-back mcp-stop mcp-restart mcp-status mcp-log mcp-test

mcp-start:
	@echo "MCP ontology server 시작 (Ctrl+C로 종료)"
	node $(MCP_BIN)

mcp-back:
	@if [ -f $(MCP_PID) ] && kill -0 "$$(cat $(MCP_PID))" 2>/dev/null; then \
		echo "이미 실행 중 (PID: $$(cat $(MCP_PID)))"; \
	else \
		node $(MCP_BIN) >> $(MCP_LOG) 2>&1 & echo $$! > $(MCP_PID); \
		echo "MCP ontology 백그라운드 시작 (PID: $$(cat $(MCP_PID)), 로그: $(MCP_LOG))"; \
	fi

mcp-stop:
	@if [ -f $(MCP_PID) ] && kill -0 "$$(cat $(MCP_PID))" 2>/dev/null; then \
		kill "$$(cat $(MCP_PID))" && rm $(MCP_PID) && echo "MCP ontology 종료"; \
	else \
		rm -f $(MCP_PID) && echo "실행 중인 MCP ontology 서버 없음"; \
	fi

mcp-restart: mcp-stop mcp-back

mcp-status:
	@if [ -f $(MCP_PID) ] && kill -0 "$$(cat $(MCP_PID))" 2>/dev/null; then \
		echo "MCP ontology 실행 중 (PID: $$(cat $(MCP_PID)))"; \
	else \
		echo "MCP ontology 중지됨"; \
	fi

mcp-log:
	@tail -f $(MCP_LOG)

mcp-test:
	@echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}' \
		| node $(MCP_BIN) | head -1 | node -e \
		"process.stdin.on('data',d=>{const r=JSON.parse(d);console.log('서버명:',r.result?.serverInfo?.name,'버전:',r.result?.serverInfo?.version)})"
