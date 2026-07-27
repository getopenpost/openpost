# Quickstart

This is the fastest path to a working OpenPost instance.

If you prefer not to use Docker, jump to [Single Binary](/installation/binary).

## 1. Create `docker-compose.yml`

```yaml
services:
  openpost:
    image: ghcr.io/rodrgds/openpost:latest
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

volumes:
  openpost_data:
```

## 2. Create `.env`

From the repository root, copy the safe deployment example:

```bash
cp .env.example .env
```

Set fresh values for the two required secrets, then set `OPENPOST_APP_URL`, `OPENPOST_PUBLIC_URL`, and `OPENPOST_MEDIA_URL` for the URL where users will actually reach the app. For a local evaluation, `http://localhost:8080` is fine.

Start with Bluesky if you want the easiest first provider: no server-side OAuth app is required. Add other provider env vars later as needed.

## 3. Generate secrets

```bash
openssl rand -base64 32
openssl rand -base64 32
```

Use one generated value for the JWT secret and the other for the encryption key.

::: warning
Do not use placeholder secrets in production.
:::

## 4. Start OpenPost

```bash
docker compose up -d
```

## 5. Open the app

Visit `http://localhost:8080`.

## 6. Finish first-run setup

1. Create your OpenPost account.
   The first account on the instance becomes the instance admin automatically.
2. Create or select a workspace.
3. Connect your first provider.
4. Create a post, choose a scheduled time a few minutes ahead, and save it.
5. Confirm the post appears in the activity view as scheduled, then wait for it to publish.

## 7. Recommended first provider

Start with **Bluesky** if you want the fastest validation path:

1. In Bluesky, open Settings and create an app password.
2. In OpenPost, go to Accounts and connect Bluesky with your handle and app password.
3. Publish or schedule a short text post first.

## What success looks like

- You see the registration or login screen on first load.
- After signing in, OpenPost opens the workspace-aware app shell.
- The Accounts screen shows your connected provider.
- The composer lets you pick that account as a destination.
- The Activity screen shows the scheduled post, then later shows it as published.

## HTTPS note

`http://localhost:8080` is fine for a local evaluation. Before configuring production OAuth callbacks, put OpenPost behind HTTPS with a real domain and update `OPENPOST_APP_URL`, `OPENPOST_PUBLIC_URL`, and `OPENPOST_MEDIA_URL`. That matters for X, LinkedIn, Threads callback validation, WebAuthn/passkeys, and Threads public media fetches.

If you want to close self-service signups after setup, set `OPENPOST_DISABLE_REGISTRATIONS=true` and restart OpenPost. The first account is still allowed on a brand-new instance even when that flag is enabled.

## Next steps

- [Docker Compose details](/installation/docker-compose)
- [Single binary install](/installation/binary)
- [Environment variables](/configuration/environment-variables)
- [Provider setup](/providers/overview)
