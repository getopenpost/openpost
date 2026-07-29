# Upgrades

OpenPost uses SemVer. Read the [release notes](https://github.com/rodrgds/openpost/releases/latest) before every upgrade. A major version can require changes to your setup. Minor and patch releases stay compatible.

## Docker Compose

```bash
docker compose pull
docker compose up -d
docker compose logs -f openpost
```

## Checklist

- Read the changelog
- Back up the database, media, and secrets together
- Pull the new image or binary
- Restart OpenPost
- If you want to lock down signups after setup, set `OPENPOST_DISABLE_REGISTRATIONS=true` before or after the upgrade and restart OpenPost.
- Check `/api/v1/ready`
- Check scheduled posts, Activity, and recent logs
