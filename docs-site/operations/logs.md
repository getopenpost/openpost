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

When a post fails, start with sign-in callback errors, media link failures, and social network errors.
