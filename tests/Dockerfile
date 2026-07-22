# AEGIS test runner: pytest integration/e2e/concurrency/chaos + perf harness.
# Runs inside the aegis network against the live stack. Pinned deps, no host tooling.
FROM python:3.11-slim-bookworm
WORKDIR /work
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
COPY tests/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
# Simulator client (envelope builder + control helpers) is reused by the suite.
COPY simulator/ /sim/
COPY tests/ /tests/
WORKDIR /tests
# Default: run the full functional suite. Override CMD for perf/chaos-only runs.
CMD ["pytest", "-v", "--tb=short", "test_integration.py", "test_chaos.py"]
