# Quickstart

This is the fastest path to a working OpenPost instance.

If you prefer not to use Docker, jump to [Single Binary](/installation/binary).

The published image and maintained Dockerfile support `linux/amd64` only. Other host architectures need amd64 emulation. A native image requires a downstream Dockerfile/source change and complete runtime validation.

## 1. Create `docker-compose.yml`

```yaml
services:
  openpost:
    image: ghcr.io/getopenpost/openpost:latest
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

volumes:
  openpost_data:
```

## 2. Create `.env`

From the repository root, copy the safe deployment example:

```bash
cp .env.example .env
```

Set fresh values for the two required secrets, then set `OPENPOST_APP_URL`, `OPENPOST_PUBLIC_URL`, and `OPENPOST_MEDIA_URL` for the URL where users will actually reach the app. For a local evaluation, `http://localhost:8080` is fine.

Start with Bluesky if you want the easiest first platform: it does not need a server-side OAuth app. Add other platform settings later.

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
3. Connect your first social account.
4. Create a post, choose a time a few minutes ahead, then choose **Schedule**.
5. Confirm the post appears in Activity as scheduled, then wait for it to go live.

## 7. Recommended first platform

Start with **Bluesky** if you want the fastest first check:

1. In Bluesky, open Settings and create an app password.
2. In OpenPost, go to Accounts and connect Bluesky with your handle and app password.
3. Publish or schedule a short text post first.

## What success looks like

- You see the registration or login screen on first load.
- After signing in, OpenPost opens the workspace-aware app shell.
- The Social accounts screen shows your connected account.
- The editor lets you pick that account.
- The Activity screen shows the scheduled post, then later shows it as published.

## HTTPS note

`http://localhost:8080` is fine for a local test. Before you set up OAuth for real accounts, put OpenPost behind HTTPS with a real domain and update `OPENPOST_APP_URL`, `OPENPOST_PUBLIC_URL`, and `OPENPOST_MEDIA_URL`. X, LinkedIn, and Threads need exact callback addresses. Passkeys need HTTPS. Threads, Facebook, Instagram, and some TikTok flows need public media links.

If you want to close self-service signups after setup, set `OPENPOST_DISABLE_REGISTRATIONS=true` and restart OpenPost. The first account is still allowed on a brand-new instance even when that flag is enabled.

## Next steps

- [Docker Compose details](/installation/docker-compose)
- [Single binary install](/installation/binary)
- [Environment variables](/configuration/environment-variables)
- [Platform setup](/providers/)
