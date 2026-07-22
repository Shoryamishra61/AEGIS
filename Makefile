# AEGIS one-command orchestration. Docker-only; no host Go/Python/Node required.
# Usage examples:
#   make up            # build + start the full stack (one command)
#   make demo          # run the agent simulator scenarios against the live stack
#   make test          # run the full pytest suite (integration + concurrency + chaos)
#   make unit          # run gateway Go unit tests + OPA policy tests in containers
#   make perf          # run the performance harness (writes docs/benchmark-results)
#   make scan          # run security scans (secret / dependency / static) in containers
#   make verify        # end-to-end: up -> unit -> test -> demo
#   make logs          # tail stack logs
#   make down          # stop and remove the stack (keeps volumes)
#   make clean         # down + remove volumes (full reset)

COMPOSE = docker compose

.PHONY: up down clean logs ps demo test unit perf scan verify

up:
	$(COMPOSE) up --build -d
	@echo "AEGIS stack starting. Dashboard: http://localhost:5173  Control: http://localhost:8000  Gateway: http://localhost:8080"

down:
	$(COMPOSE) down

clean:
	$(COMPOSE) down -v

logs:
	$(COMPOSE) logs -f

ps:
	$(COMPOSE) ps

demo:
	$(COMPOSE) --profile demo run --rm simulator

test:
	$(COMPOSE) --profile test run --rm --build tests

perf:
	mkdir -p docs/benchmark-results
	$(COMPOSE) --profile perf run --rm --build perf

unit:
	bash scripts/unit.sh

scan:
	bash scripts/scan.sh

verify: up
	$(MAKE) unit
	$(MAKE) test
	$(MAKE) demo
	@echo "=== AEGIS verify complete ==="
