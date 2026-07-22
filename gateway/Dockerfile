# AEGIS Go enforcement gateway with embedded OPA.
# Multi-stage: build with pinned Go, run on distroless-ish minimal base.
FROM golang:1.22-bookworm AS build
WORKDIR /src

# Cache deps first.
COPY gateway/go.mod gateway/go.sum* ./gateway/
WORKDIR /src/gateway
RUN go mod download || true

# Copy source.
WORKDIR /src
COPY gateway/ ./gateway/

# Single source of truth: copy the authoritative policy into the embed path so the
# gateway's compiled bundle always matches policies/authz.rego.
COPY policies/authz.rego ./gateway/internal/policy/bundle/authz.rego

WORKDIR /src/gateway
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/gateway ./cmd/gateway

# --- runtime ---
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/gateway /gateway
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/gateway"]
