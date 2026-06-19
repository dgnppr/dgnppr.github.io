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