# Docker Run

`docker run` is useful for quick testing. For persistent long-running installs, prefer [Docker Compose](/installation/docker-compose).

The published image supports `linux/amd64` only. The explicit `--platform` below prevents the host architecture from being mistaken for published support. See [Container Image Support and Assurance](/operations/container-image).

```bash
docker volume create openpost_data

docker run -d \
  --platform linux/amd64 \
  --name openpost \
  --restart unless-stopped \
  -p 8080:8080 \
  --mount source=openpost_data,target=/data \
  --env-file .env \
  -e OPENPOST_DATABASE_PATH=/data/db/openpost.db \
  -e OPENPOST_MEDIA_PATH=/data/media \
  -e OPENPOST_MEDIA_URL=http://localhost:8080/media \
  ghcr.io/rodrgds/openpost:latest
```

Use the same `.env` guidance as the Compose setup.
