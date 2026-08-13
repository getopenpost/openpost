# Docker Compose

Docker Compose is the recommended installation path for long-running OpenPost deployments.

## Prerequisites

- Docker Engine
- Docker Compose
- A writable persistent volume or bind mount for `/data`

The published image and maintained Dockerfile support `linux/amd64` only. On another host architecture, use amd64 emulation. A native image requires a downstream Dockerfile/source change and complete runtime validation. See [Container Image Support and Assurance](/operations/container-image).

## Create `docker-compose.yml`

```yaml
services:
  openpost:
    image: ghcr.io/rodrgds/openpost:latest
    platform: linux/amd64
    container_name: openpost
    restart: unless-stopped
    env_file:
      - .env
    ports:
      - "8080:8080"
    volumes:
      - openpost_data:/data
    environment:
      - OPENPOST_PORT=8080
      - OPENPOST_DATABASE_PATH=/data/db/openpost.db
      - OPENPOST_MEDIA_PATH=/data/media
    # Keep container health on liveness. Gate traffic and rollouts on /api/v1/ready.
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8080/api/v1/health"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 10s

volumes:
  openpost_data:
```

## Create `.env`

From the repository root:

```bash
cp .env.example .env
```

If you only copied the Compose file, create `.env` manually and set at least:

- `OPENPOST_JWT_SECRET`
- `OPENPOST_ENCRYPTION_KEY`
- `OPENPOST_APP_URL`
- `OPENPOST_PUBLIC_URL`
- `OPENPOST_MEDIA_URL`
- Provider credentials for the networks you want to enable

For local testing, `http://localhost:8080` is fine for the public URL values. In production, use your real HTTPS origin.

## Generate secrets

```bash
openssl rand -base64 32
```

Generate one value for `OPENPOST_JWT_SECRET` and another for `OPENPOST_ENCRYPTION_KEY`.

Optional hardening after setup:

- `OPENPOST_DISABLE_REGISTRATIONS=true` to block new self-service signups after the first admin account has been created

## Start OpenPost

```bash
docker compose up -d
```

## Check readiness

```bash
curl http://localhost:8080/api/v1/ready
```

Expected response:

```json
{"status":"ready","database":"ok"}
```

The container health check uses `/api/v1/health`; this explicit readiness check also proves that the database is available. See [Health Checks](/operations/health-checks).

## Where data is stored

- Database: `/data/db/openpost.db`
- Media: `/data/media`

Do not store either on ephemeral container storage.

## Upgrade flow

```bash
docker compose pull
docker compose up -d
docker compose logs -f openpost
```

## Production warnings

- Put OpenPost behind HTTPS before enabling OAuth in production.
- Set `OPENPOST_APP_URL`, `OPENPOST_PUBLIC_URL`, and `OPENPOST_MEDIA_URL` to public URLs.
- Back up both the SQLite database and media directory.

## Next steps

- [Reverse proxy](/installation/reverse-proxy)
- [Production checklist](/configuration/production-checklist)
- [Provider setup](/providers/overview)
