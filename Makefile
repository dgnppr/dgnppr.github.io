# ----------------------------------------
# Jekyll Local Server Makefile
# ----------------------------------------

PORT       := 4000
HOST       := 127.0.0.1
PID        := $(shell lsof -ti :$(PORT))
BUNDLE_CMD := bundle exec jekyll serve --host $(HOST) --port $(PORT)
PROJECT    := blog

# 기본 help
.PHONY: help
help:
	@echo "Usage:"
	@echo "  make start      - Start Jekyll server on port $(PORT)"
	@echo "  make stop       - Stop Jekyll server (port $(PORT))"
	@echo "  make restart    - Restart Jekyll server"
	@echo "  make status     - Check if Jekyll server is running"
	@echo "  make clean      - Clean _site and tmp files"

# ----------------------------------------
# 실행
# ----------------------------------------
.PHONY: start
start:
	@if [ -n "$(PID)" ]; then \
		echo "⚠️  Jekyll already running on port $(PORT) (PID: $(PID))"; \
	else \
		echo "🚀 Starting Jekyll server on http://$(HOST):$(PORT)..."; \
		nohup $(BUNDLE_CMD) >/tmp/jekyll_$(PROJECT).log 2>&1 & \
		sleep 2; \
		echo "✅ Started. Log: /tmp/jekyll_$(PROJECT).log"; \
	fi

# ----------------------------------------
# 종료
# ----------------------------------------
.PHONY: stop
stop:
	@if [ -n "$(PID)" ]; then \
		echo "🛑 Stopping Jekyll (PID: $(PID))..."; \
		kill -9 $(PID); \
		echo "✅ Stopped."; \
	else \
		echo "ℹ️  No Jekyll process found on port $(PORT)."; \
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
		echo "✅ Jekyll running (PID: $(PID)) on port $(PORT)"; \
	else \
		echo "❌ Jekyll not running on port $(PORT)"; \
	fi

# ----------------------------------------
# 빌드 캐시 정리
# ----------------------------------------
.PHONY: clean
clean:
	@echo "🧹 Cleaning build artifacts..."
	rm -rf _site .jekyll-cache .sass-cache
	@echo "✅ Cleaned."