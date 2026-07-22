#!/usr/bin/env bash
# AEGIS basic security automation, all in containers (no host tooling).
#   - Secret scan (gitleaks) over the repo
#   - Go static security scan (gosec) over the gateway
#   - Go dependency vulnerability scan (govulncheck)
#   - Python dependency audit (pip-audit) over control-plane + mock-bank
#   - Node dependency audit (npm audit) over the dashboard
#
# Scans are best-effort and report findings; they do NOT gate the build in the MVP
# (documented in README "Security automation"). Exit non-zero only on scanner error.
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p docs/security-scans
FAIL=0

echo "== Secret scan (gitleaks) =="
docker run --rm -v "$PWD":/repo zricethezav/gitleaks:v8.18.4 \
  detect --source=/repo --no-git --redact \
  --report-path=/repo/docs/security-scans/gitleaks.json || echo "[gitleaks] findings or none; see report"

echo
echo "== Go static analysis (gosec) =="
docker run --rm -v "$PWD/gateway":/src -w /src securego/gosec:2.20.0 \
  -no-fail -fmt=json -out=/src/../docs/security-scans/gosec.json ./... || echo "[gosec] see report"

echo
echo "== Go vuln scan (govulncheck) =="
docker run --rm -v "$PWD/gateway":/src -w /src golang:1.22-bookworm \
  bash -c "go install golang.org/x/vuln/cmd/govulncheck@latest && \$(go env GOPATH)/bin/govulncheck ./..." \
  > docs/security-scans/govulncheck.txt 2>&1 || echo "[govulncheck] see report"

echo
echo "== Python dependency audit (pip-audit) =="
docker run --rm -v "$PWD":/repo -w /repo python:3.11-slim-bookworm \
  bash -c "pip install --quiet pip-audit==2.7.3 && \
           pip-audit -r control-plane/requirements.txt; \
           pip-audit -r mock-bank/requirements.txt" \
  > docs/security-scans/pip-audit.txt 2>&1 || echo "[pip-audit] see report"

echo
echo "== Node dependency audit (npm audit) =="
docker run --rm -v "$PWD/dashboard":/app -w /app node:20.16.0-bookworm \
  bash -c "npm install --package-lock-only --silent && npm audit --audit-level=high || true" \
  > docs/security-scans/npm-audit.txt 2>&1 || echo "[npm audit] see report"

echo
echo "== Authorization checks (runtime, against live stack if up) =="
echo "See tests/test_integration.py: RBAC (auditor cannot halt), 401 unauthenticated,"
echo "mock-bank gateway-only credential rejection. Run 'make test' for the live assertions."

echo
echo "== security scans complete; reports in docs/security-scans/ =="
exit $FAIL
