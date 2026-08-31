---
layout: home

hero:
  name: OpenPost
  text: Turn what you are building into destination-ready content.
  tagline: Create, adapt, schedule, and track work from one workspace.
  image:
    src: /assets/brand/logo-docs.svg
    alt: OpenPost logo
  actions:
    - theme: brand
      text: Read the user guide
      link: /usage/
    - theme: alt
      text: Start 14-day trial
      link: https://app.openpost.social/register?plan=founder&billing_period=monthly

features:
  - title: Use OpenPost
    details: Connect accounts, create destination versions, schedule publications, and review results.
    link: /usage/
  - title: Connect a provider
    details: See setup steps, supported formats, account requirements, and current limitations.
    link: /providers/
  - title: Automate with CLI or MCP
    details: Use the same workspace and authorization boundaries from scripts and AI tools.
    link: /cli/
  - title: Self-host OpenPost
    details: Install, configure, back up, upgrade, and operate your own deployment.
    link: /self-hosting/
  - title: Build with the API
    details: Read the HTTP contract, authentication model, and development guides.
    link: /development/api-reference
  - title: Learn the core concepts
    details: Understand Publications, Renditions, destinations, schedules, and publishing state.
    link: /guide/concepts
---

The all-in-one content team for solo founders, from first draft to every destination.

::: info Hosted service plans
See the [canonical Hosted service pricing](https://openpost.social/pricing) for current plans, trial terms, and limits. Self-hosting is a separate operator-run deployment.
:::

Provider access and available formats still depend on account type, permissions, review, and current provider support.

<p>
  <img
    src="/assets/screenshots/main-dark.png"
    alt="OpenPost main dashboard"
    style="width: 100%; max-width: 1200px; border-radius: 16px; border: 1px solid var(--vp-c-divider);"
  >
</p>

## Installation

For the authoritative Docker Compose example and deployment steps, see [Docker Compose](/installation/docker-compose).

::: tip
New to OpenPost? Read the [user guide](/usage/), [watch the product demo](https://youtu.be/_mZf3HzQaN8), or follow the [self-hosting quickstart](/guide/quickstart).
:::

## Choose the right docs

- **[User docs](/usage/)** cover the web app, CLI, and MCP. Learn how to connect accounts, write account versions, schedule posts, track results, use OpenPost Image Editor, and manage replies.
- **[Self-hosting docs](/self-hosting/)** cover setup, social app keys, storage, backups, upgrades, and fixes.
- **[Developer docs](/development/)** cover the code, API, tests, platform links, billing, MCP, and releases.

## More ways to use OpenPost

- Use the [CLI](/cli/) from a terminal, scheduled script, or CI job.
- Connect an AI tool through [MCP](/mcp/) to read, draft, or schedule with the access you grant.
- Test an AI-assisted campaign with the public [OpenPost Launch Kit](https://github.com/getopenpost/openpost/tree/main/launch-kit).
- Install the [Android app](/installation/android) from the APK shipped with each GitHub release.
