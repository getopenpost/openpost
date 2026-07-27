---
layout: home

hero:
  name: OpenPost
  text: The publishing layer between AI agents and your social accounts.
  tagline: Let an agent prepare a base post and destination-specific renditions. Review the result in OpenPost, then schedule it through one visible queue.
  image:
    src: /assets/brand/logo-docs.svg
    alt: OpenPost logo
  actions:
    - theme: brand
      text: Use the managed app
      link: https://app.openpost.social
    - theme: alt
      text: Self-host OpenPost
      link: /guide/quickstart
    - theme: alt
      text: Agent workflow
      link: /usage/agent-assisted-publishing

features:
  - title: Provider-aware renditions
    details: Keep one campaign source while adapting copy, media, format, and settings for each account.
  - title: Review in the web app
    details: Inspect every destination and edit the result before you approve scheduling or publication.
  - title: Read and mutation boundary
    details: Use mcp:read for server-enforced inspection, then grant mcp:full only when the agent must change or publish work.
  - title: Visible publishing queue
    details: Follow scheduled, published, failed, and retry state instead of handing work to an opaque automation.
  - title: Revocable access
    details: Limit MCP tokens to one workspace, inspect recent activity, and revoke a client from Settings.
  - title: Compact self-hosting
    details: Run the same AGPL product as one binary or container with SQLite and no required Redis service.
---

::: info Managed or self-hosted
Managed publishing starts at €6/month. Registration can create one bootstrap workspace before checkout, but connecting accounts, uploading media, scheduling, publishing, and other provider writes require an active or Polar-trialing subscription. There is no automatic hosted free tier or trial. Self-hosted OpenPost has no software subscription.
:::

<p>
  <img
    src="/assets/screenshots/main-dark.png"
    alt="OpenPost main dashboard"
    style="width: 100%; max-width: 1200px; border-radius: 16px; border: 1px solid var(--vp-c-divider);"
  >
</p>

## Install in a minute

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
New to OpenPost? Read the [agent-assisted publishing workflow](/usage/agent-assisted-publishing), [watch the product demo](https://youtu.be/_mZf3HzQaN8), or start with the [self-hosting quickstart](/guide/quickstart).
:::

## Choose the right docs

- **[User-facing docs](/usage/)** cover the web app, CLI, and MCP workflows for drafting posts, adapting platform renditions, scheduling posts, and automating OpenPost as a product user.
- **[Self-hosting docs](/self-hosting/)** cover installation, configuration, provider app setup, media/database storage, backups, upgrades, and troubleshooting for operators.
- **[Developer docs](/development/)** cover architecture, API reference, backend/frontend internals, platform adapters, MCP implementation, billing infrastructure, testing, and the production-readiness plan.

## More ways to use OpenPost

- Use the [CLI](/cli/) for terminal workflows, cron jobs, and CI automation.
- Connect an assistant through [MCP](/mcp/) for agentic drafting, rendition, and scheduling workflows.
- Rehearse a campaign with the public [OpenPost Launch Kit](https://github.com/rodrgds/openpost/tree/main/launch-kit).
- Install the [Android app](/installation/android) from the APK shipped with each GitHub release.
