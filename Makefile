# ----------------------------------------
# Jekyll Local Server Makefile
# ----------------------------------------

export PATH := $(HOME)/.local/share/mise/shims:$(PATH)

PORT       := 4000
HOST       := 127.0.0.1
PID        := $(shell lsof -ti :$(PORT))
BUNDLE_CMD := bundle exec jekyll serve --host $(HOST) --port $(PORT)
PROJECT    := blog
LOG        := .localhost.log
PID_FILE   := .localhost.pid

# 기본 help
.PHONY: help
help:
	@echo "Usage:"
	@echo "  make install    - bundle install (의존성 설치)"
	@echo "  make start      - 포그라운드 서버 실행 (증분 빌드)"
	@echo "  make watch      - 변경 감지 서버 실행"
	@echo "  make inc        - bundle update 후 증분 빌드 서버 실행"
	@echo "  make back       - 백그라운드 서버 실행 (로그: $(LOG))"
	@echo "  make docker     - Docker로 서버 실행"
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
	@echo "  make embeddings       - 임베딩 기반 연관 포스트 생성 (캐시 있으면 스킵)"
	@echo "  make embeddings-force - 모든 임베딩 강제 재계산"
	@echo ""
	@echo "MCP wiki server:"
	@echo "  make mcp-start   - MCP 서버 포그라운드 실행 (수동 테스트용)"
	@echo "  make mcp-back    - MCP 서버 백그라운드 실행"
	@echo "  make mcp-stop    - MCP 서버 종료"
	@echo "  make mcp-restart - MCP 서버 재시작"
	@echo "  make mcp-status  - MCP 서버 상태 확인"
	@echo "  make mcp-test    - MCP 서버 동작 확인"

# ----------------------------------------
# 의존성 설치
# ----------------------------------------
.PHONY: install
install:
	bundle install

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
# 임베딩 기반 연관 포스트 생성
# ----------------------------------------
.PHONY: embeddings embeddings-force
embeddings:
	@set -a && . ./.env && set +a && node scripts/generate-embeddings.js

embeddings-force:
	@set -a && . ./.env && set +a && node scripts/generate-embeddings.js --force

# ----------------------------------------
# 포그라운드 실행 (증분 빌드)
# ----------------------------------------
.PHONY: start
start: data
	@if [ -n "$(PID)" ]; then \
		echo "Jekyll already running on port $(PORT) (PID: $(PID))"; \
	else \
		$(BUNDLE_CMD) --incremental --trace; \
	fi

# ----------------------------------------
# 변경 감지 서버
# ----------------------------------------
.PHONY: watch
watch: data
	$(BUNDLE_CMD) --watch

# ----------------------------------------
# bundle update 후 증분 빌드
# ----------------------------------------
.PHONY: inc
inc:
	bundle update && bundle install
	node generateData.js
	$(BUNDLE_CMD) --incremental --trace

# ----------------------------------------
# 백그라운드 실행
# ----------------------------------------
.PHONY: back
back:
	bundle update && bundle install
	node generateData.js
	$(BUNDLE_CMD) --incremental --trace >> $(LOG) 2>&1 &
	@pgrep -f 'jekyll serve' > $(PID_FILE)
	@echo "Server started. Log: $(LOG), PID: $(PID_FILE)"

# ----------------------------------------
# Docker 실행
# ----------------------------------------
.PHONY: docker
docker: data
	docker compose up

# ----------------------------------------
# 종료
# ----------------------------------------
.PHONY: stop
stop:
	@if [ -f $(PID_FILE) ]; then \
		kill "$$(cat $(PID_FILE))" && rm $(PID_FILE) && echo "Server stopped."; \
	elif [ -n "$(PID)" ]; then \
		kill -9 $(PID) && echo "Server stopped (PID: $(PID))."; \
	else \
		echo "No running Jekyll server found on port $(PORT)."; \
	fi

# ----------------------------------------
# 재시작
# ----------------------------------------
.PHONY: restart
restart: stop start

# ----------------------------------------
# 상태 확인
# ----------------------------------------
.PHONY: status
status:
	@if [ -n "$(PID)" ]; then \
		echo "Jekyll running (PID: $(PID)) on port $(PORT)"; \
	else \
		echo "Jekyll not running on port $(PORT)"; \
	fi

# ----------------------------------------
# 빌드 캐시 정리
# ----------------------------------------
.PHONY: clean
clean:
	rm -rf _site .jekyll-cache .sass-cache
	@echo "Cleaned."

# ----------------------------------------
# MCP wiki server
# ----------------------------------------
MCP_SERVER  := mcp/wiki-server.js
MCP_PID     := .mcp.pid
MCP_LOG     := .mcp.log

.PHONY: mcp-start mcp-back mcp-stop mcp-restart mcp-status mcp-test

mcp-start:
	@echo "MCP wiki server 시작 (Ctrl+C로 종료)"
	node $(MCP_SERVER)

mcp-back:
	@if [ -f $(MCP_PID) ] && kill -0 "$$(cat $(MCP_PID))" 2>/dev/null; then \
		echo "이미 실행 중 (PID: $$(cat $(MCP_PID)))"; \
	else \
		node $(MCP_SERVER) >> $(MCP_LOG) 2>&1 & echo $$! > $(MCP_PID); \
		echo "MCP 서버 백그라운드 시작 (PID: $$(cat $(MCP_PID)), 로그: $(MCP_LOG))"; \
	fi

mcp-stop:
	@if [ -f $(MCP_PID) ] && kill -0 "$$(cat $(MCP_PID))" 2>/dev/null; then \
		kill "$$(cat $(MCP_PID))" && rm $(MCP_PID) && echo "MCP 서버 종료"; \
	else \
		rm -f $(MCP_PID) && echo "실행 중인 MCP 서버 없음"; \
	fi

mcp-restart: mcp-stop mcp-back

mcp-status:
	@if [ -f $(MCP_PID) ] && kill -0 "$$(cat $(MCP_PID))" 2>/dev/null; then \
		echo "MCP 서버 실행 중 (PID: $$(cat $(MCP_PID)))"; \
	else \
		echo "MCP 서버 중지됨"; \
	fi

mcp-test:
	@echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}' \
		| node $(MCP_SERVER) | head -1 | node -e \
		"process.stdin.on('data',d=>{const r=JSON.parse(d);console.log('서버명:',r.result?.serverInfo?.name,'버전:',r.result?.serverInfo?.version)})"