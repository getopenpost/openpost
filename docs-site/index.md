---
layout: home

hero:
  name: OpenPost
  text: Turn what you are building into content. Publish it everywhere.
  tagline: The all-in-one content team for solo founders, from first draft to every destination.
  image:
    src: /assets/brand/logo-docs.svg
    alt: OpenPost logo
  actions:
    - theme: brand
      text: Use the managed app
      link: https://app.openpost.social
    - theme: alt
      text: Read the user guide
      link: /usage/

features:
  - title: Start with what you are building
    details: Turn a launch, product update, lesson, or idea into one shared draft.
  - title: Calendar and clear status
    details: See scheduled, published, failed, and retryable posts in the app.
  - title: Analytics and replies
    details: Track available account and post results, reply to comments, and use the inbox for supported accounts.
  - title: Media and Studio
    details: Reuse saved media or make still images and carousel pages in OpenPost Studio.
  - title: API, CLI, and MCP
    details: Use OpenPost from scripts and AI tools without sharing your social account keys.
  - title: One product workflow
    details: Plan, create, adapt, schedule, and track every destination in one place.
---

::: info Managed plans
Managed plans start at $15 per month. Every plan includes a card-required 14-day trial. OpenPost shows the renewal price and date before you start, and you can cancel from billing settings before the first charge.
:::

<p>
  <img
    src="/assets/screenshots/main-dark.png"
    alt="OpenPost main dashboard"
    style="width: 100%; max-width: 1200px; border-radius: 16px; border: 1px solid var(--vp-c-divider);"
  >
</p>

## Docker Compose example

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

::: tip
New to OpenPost? Read the [user guide](/usage/), [watch the product demo](https://youtu.be/_mZf3HzQaN8), or follow the [self-hosting quickstart](/guide/quickstart).
:::

## Choose the right docs

- **[User docs](/usage/)** cover the web app, CLI, and MCP. Learn how to connect accounts, write account versions, schedule posts, track results, use Studio, and manage replies.
- **[Self-hosting docs](/self-hosting/)** cover setup, social app keys, storage, backups, upgrades, and fixes.
- **[Developer docs](/development/)** cover the code, API, tests, platform links, billing, MCP, and releases.

## More ways to use OpenPost

- Use the [CLI](/cli/) from a terminal, scheduled script, or CI job.
- Connect an AI tool through [MCP](/mcp/) to read, draft, or schedule with the access you grant.
- Test an AI-assisted campaign with the public [OpenPost Launch Kit](https://github.com/rodrgds/openpost/tree/main/launch-kit).
- Install the [Android app](/installation/android) from the APK shipped with each GitHub release.
