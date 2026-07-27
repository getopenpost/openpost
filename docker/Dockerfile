# Build stage for frontend
FROM node:22-alpine AS frontend-builder

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

# Copy workspace manifests first for dependency caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY frontend/package.json ./frontend/
RUN pnpm install --frozen-lockfile --filter @openpost/web...

COPY frontend/ ./frontend/
COPY assets/ ./assets/
COPY scripts/ ./scripts/
RUN mkdir -p backend/cmd/openpost/public && pnpm --filter @openpost/web build

# Build stage for backend
FROM golang:1.26.5-alpine AS backend-builder

ARG VERSION=dev

RUN apk add --no-cache gcc musl-dev sqlite-dev

WORKDIR /app

COPY backend/go.mod backend/go.sum ./backend/
RUN cd backend && go mod download

COPY backend/ ./backend/
# Copy frontend build output from the correct location
COPY --from=frontend-builder /app/backend/cmd/openpost/public ./backend/cmd/openpost/public

RUN cd backend && CGO_ENABLED=1 GOOS=linux go build -a -installsuffix cgo -ldflags="-s -w -X main.version=${VERSION}" -o openpost ./cmd/openpost

# Runtime stage
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata sqlite

RUN adduser -D -u 1000 openpost

WORKDIR /app

COPY --from=backend-builder /app/backend/openpost .

RUN mkdir -p /data/media /data/db && chown -R openpost:openpost /data

USER openpost

ENV OPENPOST_PORT=8080
ENV OPENPOST_EDITION=selfhost
ENV OPENPOST_DATABASE_DRIVER=sqlite
ENV OPENPOST_DATABASE_PATH=/data/db/openpost.db
ENV OPENPOST_STORAGE_DRIVER=local
ENV OPENPOST_MEDIA_PATH=/data/media

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/api/v1/health || exit 1

CMD ["./openpost"]
