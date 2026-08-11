# Pinned Bun supplies the package manager without replacing Node for external
# executable shebangs in the frontend build.
FROM oven/bun:1.3.11-alpine@sha256:7ed9f74c326d1c260abe247ac423ccbf5ac92af62bb442d515d1f92f21e8ea9b AS bun-toolchain

# Build stage for frontend. Vite and SvelteKit run on this real Node runtime;
# Bun continues to own the frozen install, lockfile, and package scripts.
FROM node:24.19.0-alpine3.24@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS frontend-builder

COPY --from=bun-toolchain /usr/local/bin/bun /usr/local/bin/bun
RUN test "$(command -v node)" = "/usr/local/bin/node" && \
    node --version && bun --version

WORKDIR /app

# Copy workspace manifests first for dependency caching.
COPY package.json bun.lock bunfig.toml turbo.json ./
COPY frontend/package.json ./frontend/
COPY docs-site/package.json ./docs-site/
COPY marketing-site/package.json ./marketing-site/
COPY packages/changelog/package.json ./packages/changelog/
COPY packages/legal-policy/package.json ./packages/legal-policy/
COPY packages/social-images/package.json ./packages/social-images/
COPY packages/social-preview/package.json ./packages/social-preview/
COPY packages/telemetry/package.json ./packages/telemetry/
COPY packages/video-project/package.json ./packages/video-project/
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --filter @openpost/web

COPY frontend/ ./frontend/
COPY packages/social-preview/ ./packages/social-preview/
COPY packages/telemetry/ ./packages/telemetry/
COPY packages/video-project/ ./packages/video-project/
COPY assets/ ./assets/
COPY scripts/asset-surfaces.mjs scripts/asset-surfaces.ts scripts/sync-assets.mjs scripts/frontend-vite-build.mjs scripts/generate-app-route-manifest.mjs scripts/precompress-static.mjs scripts/posthog-source-maps.ts ./scripts/
RUN bun run --filter @openpost/web build

# Build stage for backend
FROM golang:1.26.5-alpine@sha256:0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2 AS backend-builder

ARG VERSION=dev
ARG COMMIT=unknown
ARG RELEASE_MANIFEST_B64=""
ARG RELEASE_MANIFEST_SHA256=""

RUN apk add --no-cache gcc jq musl-dev sqlite-dev

WORKDIR /app

COPY backend/go.mod backend/go.sum ./backend/
RUN --mount=type=cache,target=/go/pkg/mod \
    cd backend && go mod download

COPY backend/ ./backend/
COPY provider-certification/public-claims.json ./provider-certification/public-claims.json
# Package the frontend-owned build output at the backend embed boundary.
COPY --from=frontend-builder /app/frontend/build ./backend/cmd/openpost/public

RUN provider_claims_sha256="$(sha256sum provider-certification/public-claims.json | cut -d ' ' -f1)" && \
    provider_claim_count="$(jq -er '.claims | length' provider-certification/public-claims.json)" && \
    if [ -n "${RELEASE_MANIFEST_B64}" ]; then \
      printf '%s' "${RELEASE_MANIFEST_B64}" | base64 -d > release-manifest.json; \
      printf '%s  %s\n' "${RELEASE_MANIFEST_SHA256}" release-manifest.json | sha256sum -c -; \
    else \
      jq -n \
        --arg version "${VERSION}" \
        --arg revision "${COMMIT}" \
        --arg provider_claims_sha256 "sha256:${provider_claims_sha256}" \
        --argjson provider_claim_count "${provider_claim_count}" \
        '{schema_version: 2, version: $version, revision: $revision, provider_claims: {schema_version: 1, manifest_sha256: $provider_claims_sha256, claim_count: $provider_claim_count}}' > release-manifest.json; \
    fi && \
    test "$(jq -er '.schema_version' release-manifest.json)" = 2 && \
    test "$(jq -er '.version' release-manifest.json)" = "${VERSION}" && \
    test "$(jq -er '.revision' release-manifest.json)" = "${COMMIT}" && \
    test "$(jq -er '.provider_claims.schema_version' release-manifest.json)" = 1 && \
    test "$(jq -er '.provider_claims.manifest_sha256' release-manifest.json)" = "sha256:${provider_claims_sha256}" && \
    test "$(jq -er '.provider_claims.claim_count' release-manifest.json)" = "${provider_claim_count}"

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    cd backend && CGO_ENABLED=1 GOOS=linux go build -buildvcs=false -ldflags="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT}" -o openpost ./cmd/openpost

# Runtime stage. Keep this exact reference aligned with docker/image-policy.json.
FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS runtime

ARG TARGETARCH
RUN test "${TARGETARCH}" = "amd64" || { \
      echo "OpenPost's published container supports linux/amd64 only; received ${TARGETARCH:-unknown}." >&2; \
      exit 1; \
    }

ARG VERSION=dev
ARG COMMIT=unknown
ARG RELEASE_MANIFEST_SHA256=""
LABEL org.opencontainers.image.title="OpenPost" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${COMMIT}" \
      org.opencontainers.image.source="https://github.com/rodrgds/openpost" \
      org.opencontainers.image.base.name="docker.io/library/alpine:3.24.1" \
      org.opencontainers.image.base.digest="sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b" \
      io.openpost.release-manifest.sha256="${RELEASE_MANIFEST_SHA256}"

RUN apk add --no-cache ca-certificates ffmpeg tzdata sqlite

RUN adduser -D -u 1000 openpost

WORKDIR /app

COPY --from=backend-builder /app/backend/openpost .
COPY --from=backend-builder /app/release-manifest.json ./release-manifest.json

RUN mkdir -p /data/media /data/db && chown -R openpost:openpost /data

USER openpost

ENV OPENPOST_PORT=8080
ENV OPENPOST_EDITION=selfhost
ENV OPENPOST_DATABASE_DRIVER=sqlite
ENV OPENPOST_DATABASE_PATH=/data/db/openpost.db
ENV OPENPOST_STORAGE_DRIVER=local
ENV OPENPOST_MEDIA_PATH=/data/media

EXPOSE 8080

# Container health is process liveness. Traffic and rollout gates use /ready.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/api/v1/health || exit 1

CMD ["./openpost"]
