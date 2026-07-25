# Upgrades

## Docker Compose

```bash
docker compose pull
docker compose up -d
docker compose logs -f openpost
```

## Checklist

- Read the changelog
- Back up `/data`
- Pull the new image or binary
- Restart OpenPost
- If the instance has exactly one existing account, the upgrade will promote that account to instance admin automatically.
- If you want to lock down signups after setup, set `OPENPOST_DISABLE_REGISTRATIONS=true` before or after the upgrade and restart OpenPost.
- Check `/api/v1/ready`
- Inspect the scheduled queue and recent logs
