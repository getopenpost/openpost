# Docker Compose Reference

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
      - OPENPOST_MEDIA_URL=https://openpost.example.com/media
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

For Docker, Podman, or NixOS-managed secrets, mount the secret files and use file-backed variables:

```yaml
environment:
  - OPENPOST_JWT_SECRET_FILE=/run/secrets/openpost-jwt-secret
  - OPENPOST_ENCRYPTION_KEY_FILE=/run/secrets/openpost-encryption-key
  - OPENPOST_DATABASE_URL_FILE=/run/secrets/openpost-database-url
```

Leave the direct variables unset when the `_FILE` variants should be used.

The published image supports `linux/amd64` only. See [Container Image Support and Assurance](/operations/container-image) for architecture, probe, SBOM, and scan policy.
