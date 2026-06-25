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
	@echo "  make add-status       - status: complete 추가 (누락된 파일만)"
	@echo "  make stats            - 글쓰기 통계 생성 (월별, 카테고리, 상태)"
	@echo "  make diagrams         - AI 다이어그램 생성 (Vertex AI)"
	@echo "  make diagrams-force   - 모든 다이어그램 강제 재생성"
	@echo "  make summaries        - AI 요약 생성 (캐시 있으면 스킵)"
	@echo "  make summaries-force  - 모든 요약 강제 재생성"
	@echo "  make embeddings           - 위키 임베딩 생성 → related.json (GitHub Pages용)"
	@echo "  make embeddings-force     - 위키 임베딩 강제 재계산"
	@echo "  make adr-embeddings       - ADR 임베딩 → Qdrant + adr-related.json (로컬 전용)"
	@echo "  make adr-embeddings-force - ADR 임베딩 강제 재계산"
	@echo "  make ontology             - 온톨로지 그래프 재생성 (data/ontology-graph.json)"
	@echo ""
	@echo "Qdrant (로컬 벡터 스토어):"
	@echo "  make adr-db-up     - Qdrant 컨테이너 시작"
	@echo "  make adr-db-down   - Qdrant 컨테이너 중지"
	@echo "  make adr-db-status - Qdrant 상태 확인"
	@echo ""
	@echo "MCP servers (wiki / adr / ontology):"
	@echo "  make mcp-start   [SERVER=wiki] - MCP 서버 포그라운드 실행 (수동 테스트용)"
	@echo "  make mcp-back    [SERVER=wiki] - MCP 서버 백그라운드 실행"
	@echo "  make mcp-stop    [SERVER=wiki] - MCP 서버 종료"
	@echo "  make mcp-log     [SERVER=wiki] - MCP 서버 로그 tail"
	@echo "  make mcp-restart [SERVER=wiki] - MCP 서버 재시작"
	@echo "  make mcp-status  [SERVER=wiki] - MCP 서버 상태 확인"
	@echo "  make mcp-test    [SERVER=wiki] - MCP 서버 동작 확인"
	@echo "  make mcp-back-all              - 모든 MCP 서버 백그라운드 실행"
	@echo "  make mcp-stop-all              - 모든 MCP 서버 종료"
	@echo "  make mcp-status-all            - 모든 MCP 서버 상태 확인"
	@echo ""
	@echo "Ontology MCP tools (/ontology 스킬):"
	@echo "  related <query>          - 쿼리 텍스트로 관련 ADR + wiki 탐색"
	@echo "  related id:<entity-id>   - 엔티티 본문 기준으로 관련 탐색"
	@echo "  find <query>             - 임베딩 유사도 flat 리스트"
	@echo "  get <entity-id>          - 노드 메타 + 전체 본문"
	@echo "  entities [type]          - 전체 목록 (type: adr | concept)"
	@echo "  entities <query>         - 시맨틱 검색으로 엔티티 탐색"
	@echo "  decision <entity-id>     - ADR 전체 컨텍스트 (id로 조회)"
	@echo "  decision <query>         - ADR 전체 컨텍스트 (텍스트로 자동 선택)"
	@echo "  Entity ID format: adr/<dir>/<file> | concept/<dir>/<file>"

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
# 온톨로지 그래프 생성
# ----------------------------------------
.PHONY: ontology
ontology:
	node scripts/generate-ontology.js

# ----------------------------------------
# 임베딩 기반 연관 포스트 생성
# ----------------------------------------
.PHONY: embeddings embeddings-force adr-embeddings adr-embeddings-force

# GitHub Pages용: 파일 기반 related.json만 생성
embeddings:
	@set -a && . ./.env && set +a && node scripts/generate-embeddings.js

embeddings-force:
	@set -a && . ./.env && set +a && node scripts/generate-embeddings.js --force

# 로컬 전용: ADR 임베딩 → Qdrant + data/adr-related.json
adr-embeddings:
	docker compose --profile tools run --rm adr-embeddings node scripts/generate-adr-embeddings.js

adr-embeddings-force:
	docker compose --profile tools run --rm adr-embeddings node scripts/generate-adr-embeddings.js --force

# ----------------------------------------
# Qdrant (ADR 벡터 스토어)
# ----------------------------------------
.PHONY: adr-db-up adr-db-down adr-db-status
adr-db-up:
	@docker compose up qdrant -d
	@echo "Qdrant 시작 — http://localhost:6333"
	@until curl -sf http://localhost:6333/healthz > /dev/null; do sleep 0.5; done

adr-db-down:
	docker compose stop qdrant

adr-db-status:
	@curl -sf http://localhost:6333/healthz && echo "Qdrant 실행 중" || echo "Qdrant 중지됨"

# ----------------------------------------
# 변경된 문서 자동 감지 → 데이터 재생성
# ----------------------------------------
.PHONY: auto-generate
auto-generate:
	@CHANGED=$$(git diff --name-only HEAD; git diff --cached --name-only; git ls-files --others --exclude-standard); \
	DOC_CHANGED=$$(echo "$$CHANGED" | grep -E '^(_wiki|_adr|_posts)/'); \
	if [ -n "$$DOC_CHANGED" ]; then \
		CF=$$(echo "$$DOC_CHANGED" | tr '\n' ':' | sed 's/:$$//'); \
		echo "[auto] 변경 파일: $$CF"; \
		set -a && . ./.env && set +a; \
		$(MAKE) adr-embeddings; \
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
# MCP servers (wiki / adr / ontology)
# ----------------------------------------
SERVER      ?= wiki
MCP_BIN      = mcp/$(SERVER)-server.js
MCP_PID      = .mcp-$(SERVER).pid
MCP_LOG      = .mcp-$(SERVER).log
MCP_SERVERS := wiki adr ontology

.PHONY: mcp-start mcp-back mcp-stop mcp-restart mcp-status mcp-log mcp-test \
        mcp-back-all mcp-stop-all mcp-status-all

mcp-start:
	@echo "MCP $(SERVER) server 시작 (Ctrl+C로 종료)"
	node $(MCP_BIN)

mcp-back:
	@if [ -f $(MCP_PID) ] && kill -0 "$$(cat $(MCP_PID))" 2>/dev/null; then \
		echo "이미 실행 중 (PID: $$(cat $(MCP_PID)))"; \
	else \
		node $(MCP_BIN) >> $(MCP_LOG) 2>&1 & echo $$! > $(MCP_PID); \
		echo "MCP $(SERVER) 백그라운드 시작 (PID: $$(cat $(MCP_PID)), 로그: $(MCP_LOG))"; \
	fi

mcp-stop:
	@if [ -f $(MCP_PID) ] && kill -0 "$$(cat $(MCP_PID))" 2>/dev/null; then \
		kill "$$(cat $(MCP_PID))" && rm $(MCP_PID) && echo "MCP $(SERVER) 종료"; \
	else \
		rm -f $(MCP_PID) && echo "실행 중인 MCP $(SERVER) 서버 없음"; \
	fi

mcp-restart: mcp-stop mcp-back

mcp-status:
	@if [ -f $(MCP_PID) ] && kill -0 "$$(cat $(MCP_PID))" 2>/dev/null; then \
		echo "MCP $(SERVER) 실행 중 (PID: $$(cat $(MCP_PID)))"; \
	else \
		echo "MCP $(SERVER) 중지됨"; \
	fi

mcp-log:
	@tail -f $(MCP_LOG)

mcp-back-all:
	@for s in $(MCP_SERVERS); do $(MAKE) mcp-back SERVER=$$s; done

mcp-stop-all:
	@for s in $(MCP_SERVERS); do $(MAKE) mcp-stop SERVER=$$s; done

mcp-status-all:
	@for s in $(MCP_SERVERS); do $(MAKE) mcp-status SERVER=$$s; done

mcp-test:
	@echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}' \
		| node $(MCP_BIN) | head -1 | node -e \
		"process.stdin.on('data',d=>{const r=JSON.parse(d);console.log('서버명:',r.result?.serverInfo?.name,'버전:',r.result?.serverInfo?.version)})"