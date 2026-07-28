# Logs

## Docker Compose

```bash
docker compose logs -f openpost
```

## Docker

```bash
docker logs -f openpost
```

## systemd

```bash
journalctl -u openpost -f
```

Start with auth callback errors, media fetch failures, and provider API responses when debugging publishing.
