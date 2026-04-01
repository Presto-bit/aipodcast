.PHONY: up down logs web orchestrator worker-ai worker-media worker-ai-simple worker-media-simple install-deps test-api-key-strip test-fallback-tag dev-infra dev-api dev-web dev-start complete-dev dev-worker-ai dev-worker-media dev dev-apps dev-install ci cleanup-outputs migrate-json-to-pg migrate-sessions-to-redis migrate-db retention-maintenance check-data-consistency

ci:
	@test -d apps/web/node_modules || (echo "请先: make dev-install"; exit 1)
	@cd apps/web && npx tsc --noEmit
	@$(MAKE) install-deps
	@cd services/orchestrator && ../../.venv-ai-native/bin/python -m pytest tests/ -q

# 本机 venv 与编排器/worker 共用同一套 pip 依赖（见 requirements.txt）
install-deps:
	@test -f requirements.txt || (echo "请在仓库根目录执行 make install-deps"; exit 1)
	@PY_BIN=$${PYTHON_BIN:-}; \
	if [ -z "$$PY_BIN" ]; then \
	  if command -v python3.12 >/dev/null 2>&1; then \
	    PY_BIN=python3.12; \
	  elif command -v python3.13 >/dev/null 2>&1; then \
	    PY_BIN=python3.13; \
	  elif command -v python3 >/dev/null 2>&1; then \
	    PY_BIN=python3; \
	  else \
	    echo "未找到可用 Python，请先安装 Python 3.12 或 3.13"; \
	    exit 1; \
	  fi; \
	fi; \
	if [ -x .venv-ai-native/bin/python ]; then \
	  VENV_MM=$$(.venv-ai-native/bin/python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"); \
	  if [ "$$VENV_MM" = "3.14" ]; then \
	    echo "检测到 .venv-ai-native 使用 Python 3.14（当前依赖不兼容），将重建为 $$PY_BIN"; \
	    rm -rf .venv-ai-native; \
	  fi; \
	fi; \
	if [ ! -x .venv-ai-native/bin/python ]; then \
	  $$PY_BIN -m venv .venv-ai-native; \
	fi
	@.venv-ai-native/bin/pip install -r requirements.txt

# ---------- 热重载开发：仅 Docker 跑 PG/Redis/MinIO，应用在本机跑 ----------
# 一键：make dev-install && make dev
# 分步：make dev-infra → make dev-apps（或 make dev-api / make dev-web 分两个终端）
# .env.ai-native 中 DB_HOST/REDIS_URL/OBJECT_ENDPOINT 与 ORCHESTRATOR_URL 见 .env.ai-native.example
dev-install:
	@test -f package.json
	@test -f apps/web/package.json || (echo "请在仓库根目录执行 make dev-install"; exit 1)
	npm install
	@test -d apps/web/node_modules || (cd apps/web && npm install)
	@$(MAKE) install-deps

dev-infra:
	@docker info >/dev/null 2>&1 || (echo "Docker 未运行：请先启动 Docker Desktop。"; exit 1)
	docker compose -f docker-compose.ai-native.yml --env-file .env.ai-native up -d postgres redis minio

# 同时起编排器（--reload）+ Next dev（需已 make dev-install；基础设施需已运行或见 make dev）
dev-apps:
	@test -d node_modules/concurrently || npm install
	npm run dev

# 一键：起基础设施 + 本机 api + web 热重载（Ctrl+C 会结束 api/web；Docker 服务仍运行）
dev:
	@test -f apps/web/package.json || (echo "请在仓库根目录执行 make dev（需要 apps/web）"; exit 1)
	@test -f .env.ai-native || (echo "缺少 .env.ai-native，请先: cp .env.ai-native.example .env.ai-native"; exit 1)
	@test -d apps/web/node_modules || (echo "请先执行: make dev-install  或在 apps/web 下 npm install"; exit 1)
	@test -d node_modules/concurrently || npm install
	@docker info >/dev/null 2>&1 || (echo "Docker 未运行：请先启动 Docker Desktop（或 Docker 守护进程），再执行 make dev。"; exit 1)
	docker compose -f docker-compose.ai-native.yml --env-file .env.ai-native up -d postgres redis minio
	npm run dev

dev-api:
	bash scripts/dev-api.sh

dev-web:
	npm run dev --prefix "$(CURDIR)/apps/web"

# 释放 8008 后执行 make dev，并在 macOS 上约 8s 后自动打开浏览器（见 scripts/dev-start.sh）
dev-start:
	bash scripts/dev-start.sh

# 首次/完整：install-deps + dev-install + make dev（见 scripts/complete-dev.sh；缺 .env 时会复制并提示先编辑）
complete-dev:
	bash scripts/complete-dev.sh

dev-worker-ai:
	python3 workers/ai-worker/worker.py

dev-worker-media:
	python3 workers/media-worker/worker.py

up:
	docker compose -f docker-compose.ai-native.yml --env-file .env.ai-native up -d --build

down:
	docker compose -f docker-compose.ai-native.yml down

logs:
	docker compose -f docker-compose.ai-native.yml logs -f --tail=200

web:
	docker compose -f docker-compose.ai-native.yml logs -f --tail=200 web

orchestrator:
	docker compose -f docker-compose.ai-native.yml logs -f --tail=200 orchestrator

worker-ai:
	docker compose -f docker-compose.ai-native.yml logs -f --tail=200 ai-worker

worker-media:
	docker compose -f docker-compose.ai-native.yml logs -f --tail=200 media-worker

worker-ai-simple:
	RQ_WORKER_MODE=simple docker compose -f docker-compose.ai-native.yml --env-file .env.ai-native up -d ai-worker

worker-media-simple:
	RQ_WORKER_MODE=simple docker compose -f docker-compose.ai-native.yml --env-file .env.ai-native up -d media-worker

test-api-key-strip:
	./.venv-ai-native/bin/python scripts/integration_test_api_key_strip.py

# 暂停 Docker ai-worker，避免与脚本内 burst worker 抢同一队列（否则旧镜像会先消费任务导致断言失败）
test-fallback-tag:
	-docker compose -f docker-compose.ai-native.yml --env-file .env.ai-native stop ai-worker
	./.venv-ai-native/bin/python scripts/integration_test_fallback_tag.py
	-docker compose -f docker-compose.ai-native.yml --env-file .env.ai-native start ai-worker

# 清理可再生成的 outputs 产物；默认预览 7 天前文件
# 用法：make cleanup-outputs DAYS=30 DRY_RUN=0
cleanup-outputs:
	@DAYS_VAL=$${DAYS:-7}; \
	DRY_VAL=$${DRY_RUN:-1}; \
	if [ "$$DRY_VAL" = "0" ]; then \
	  ./.venv-ai-native/bin/python scripts/cleanup_outputs.py --days $$DAYS_VAL; \
	else \
	  ./.venv-ai-native/bin/python scripts/cleanup_outputs.py --days $$DAYS_VAL --dry-run; \
	fi

# 迁移 JSON（data）到 PostgreSQL；默认 dry-run
# 用法：make migrate-json-to-pg DRY_RUN=0 PHONE=18101383358
migrate-json-to-pg:
	@DRY_VAL=$${DRY_RUN:-1}; \
	PHONE_VAL=$${PHONE:-}; \
	if [ "$$DRY_VAL" = "0" ]; then \
	  if [ -n "$$PHONE_VAL" ]; then \
	    ./.venv-ai-native/bin/python scripts/migrate_json_to_pg.py --phone "$$PHONE_VAL"; \
	  else \
	    ./.venv-ai-native/bin/python scripts/migrate_json_to_pg.py; \
	  fi; \
	else \
	  if [ -n "$$PHONE_VAL" ]; then \
	    ./.venv-ai-native/bin/python scripts/migrate_json_to_pg.py --dry-run --phone "$$PHONE_VAL"; \
	  else \
	    ./.venv-ai-native/bin/python scripts/migrate_json_to_pg.py --dry-run; \
	  fi; \
	fi

# 迁移文件会话到 Redis；默认 dry-run
# 用法：make migrate-sessions-to-redis DRY_RUN=0
migrate-sessions-to-redis:
	@DRY_VAL=$${DRY_RUN:-1}; \
	if [ "$$DRY_VAL" = "0" ]; then \
	  ./.venv-ai-native/bin/python scripts/migrate_sessions_to_redis.py; \
	else \
	  ./.venv-ai-native/bin/python scripts/migrate_sessions_to_redis.py --dry-run; \
	fi

# SQL migration 主入口（按 infra/postgres/init 文件名顺序执行）
migrate-db:
	./.venv-ai-native/bin/python scripts/apply_sql_migrations.py

# 数据保留与归档维护（默认 dry-run）
# 用法：make retention-maintenance DRY_RUN=0
retention-maintenance:
	@DRY_VAL=$${DRY_RUN:-1}; \
	if [ "$$DRY_VAL" = "0" ]; then \
	  ./.venv-ai-native/bin/python scripts/data_retention_maintenance.py; \
	else \
	  ./.venv-ai-native/bin/python scripts/data_retention_maintenance.py --dry-run; \
	fi

# 数据一致性巡检（默认非严格模式）
# 用法：make check-data-consistency STRICT=1 PHONE=18101383358 LIMIT=500
check-data-consistency:
	@STRICT_VAL=$${STRICT:-0}; \
	PHONE_VAL=$${PHONE:-}; \
	LIMIT_VAL=$${LIMIT:-500}; \
	ARGS="--limit $$LIMIT_VAL"; \
	if [ "$$STRICT_VAL" = "1" ]; then ARGS="$$ARGS --strict"; fi; \
	if [ -n "$$PHONE_VAL" ]; then ARGS="$$ARGS --phone $$PHONE_VAL"; fi; \
	./.venv-ai-native/bin/python scripts/check_data_consistency.py $$ARGS
