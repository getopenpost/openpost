# Upgrades

OpenPost follows SemVer from `v1.27.9`. Read the [release notes](https://github.com/rodrgds/openpost/releases/latest) before every upgrade. A major version can require operator action; minor and patch releases remain backward compatible.

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
- If the instance has exactly one existing account, the upgrade will promote that account to instance admin automatically.
- If you want to lock down signups after setup, set `OPENPOST_DISABLE_REGISTRATIONS=true` before or after the upgrade and restart OpenPost.
- Check `/api/v1/ready`
- Inspect the scheduled queue and recent logs

Historical releases before `v1.27.9` used an inconsistent release sequence. The corrected version is newer even though it follows the same `v1` compatibility line. The `v1.27.8` tag failed preflight and did not produce a GitHub release or production deployment.
