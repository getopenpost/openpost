# Upgrades

OpenPost uses SemVer. Read the [release notes](https://github.com/getopenpost/openpost/releases/latest) before every upgrade. A major version can require changes to your setup. Minor and patch releases stay compatible.

## Docker Compose

```bash
docker compose pull
docker compose run --rm openpost ./openpost migrate
docker compose up -d
docker compose logs -f openpost
```

The default `all` role also applies migrations for one-container self-hosting.
Running the explicit command first makes the release phase visible and is
required when `web` and `worker` run as separate processes.

## Checklist

- Read the changelog
- Back up the database, media, and secrets together
- Pull the new image or binary
- Restart OpenPost
- If you want to lock down signups after setup, set `OPENPOST_DISABLE_REGISTRATIONS=true` before or after the upgrade and restart OpenPost.
- Check `/api/v1/ready`
- Check scheduled posts, Activity, and recent logs

## Optional account features after upgrade

Direct messages, Comments and replies, Analytics, and Grow are optional and per connected account. New accounts start with each feature off. Manage supported features in the Account details drawer under **Settings → Workspace → Social accounts**. Existing accounts keep their current behavior: previous Inbox opt-ins become Direct messages choices, current Analytics and Engagement behavior remains enabled, Grow becomes enabled only where OpenPost already has stored Grow sync state, and other accounts receive explicit off choices.
