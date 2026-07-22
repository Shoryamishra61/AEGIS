#!/usr/bin/env bash
# AEGIS unit tests in throwaway containers (no host Go/OPA needed).
#   1) Gateway Go unit tests (action, reason, policy, ...)
#   2) OPA Rego policy tests (14 cases)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Go unit tests (golang:1.22-bookworm) =="
docker run --rm -v "$PWD/gateway":/src -w /src golang:1.22-bookworm \
  bash -c "go vet ./... && go test ./... -count=1"

echo
echo "== OPA policy tests (openpolicyagent/opa:0.68.0) =="
docker run --rm -v "$PWD/policies":/policies openpolicyagent/opa:0.68.0 \
  test -v /policies

echo
echo "== unit tests OK =="
