# OpenPost Roadmap

> Status: July 2026 - production-readiness branch.

OpenPost is becoming a production-ready self-hosted scheduler plus OpenPost Cloud. The shared core stays open and portable; hosted-only concerns such as secrets, provider credentials, deployment, and live-account verification stay in operations.

## Recently Landed

- Monorepo/Turborepo workspace with `frontend`, `docs-site`, and `marketing-site`.
- OpenPost Cloud landing page, SEO routes, tools, tips, blog, comparison pages, and pricing handoff.
- Cloud runtime primitives: edition mode, Postgres driver, S3-compatible media storage, direct S3 uploads, cloud-mode config validation, and portable database query fixes.
- Polar billing foundation: checkout, portal sessions, signed webhooks, local subscription snapshots, entitlement checks, usage counters, Settings billing UI, and CLI billing commands.
- MCP and ChatGPT-style app foundation: remote `/mcp`, stdio proxy, OAuth PKCE account linking, Apps SDK widget metadata, scoped MCP tokens, tool-call auditing, prompts, and scheduling/media/provider tools.
- Provider readiness work: provider app registry, database-backed provider credentials for operator tooling, account-provider discovery, and first slices for Facebook Pages, Instagram Business, TikTok, and YouTube.
- Production diagnostics: `/ready`, CLI `instance health`, redacted `instance diagnostics`, provider catalog snapshots, and billing usage snapshots.
- E2E coverage for marketing, docs audience separation, auth/onboarding, settings/billing/MCP activity, provider discovery, workspace switching, composer scheduling, media library, and app smoke flows.

## Current Launch Gates

1. **Hosted deploy verification**
   - Verify the real `openpost.social`, `docs.openpost.social`, and `app.openpost.social` paths.
   - Confirm the `rgo-vps` deployment config uses cloud mode, Postgres, S3/R2 media, Polar config, provider app registry, readiness probes, backups, and rollback notes.
   - Run at least one database/media/secrets restore drill before launch.

2. **Provider live-account certification**
   - Re-test OAuth, refresh, media validation, publish, retry, and quota behavior with real accounts for every enabled provider.
   - Keep Facebook, Instagram, TikTok, and YouTube in limited rollout until live account tests pass.
   - Keep public docs conservative when provider APIs, permissions, or review requirements are uncertain.

3. **Release hardening**
   - Keep Docker, binary, CLI, Android, frontend, docs, and marketing release paths reproducible.
   - Confirm release artifacts and docs match the current tag before publishing.
   - Continue running `devenv shell -- lint` before pushes and release tags.

4. **Operator support polish**
   - Keep `.env.example`, provider setup docs, backup/restore docs, production checklist, and CLI diagnostics aligned with runtime behavior.
   - Prefer support snapshots that are useful but never leak tokens, secrets, provider credentials, or private log payloads.

## Next Feature Work

- Finish live-provider follow-through: better provider-specific error messages, retry notes, and launch-status updates after real verification.
- Improve thread management for atomic updates to scheduled or failed thread chains.
- Finish pagination metadata for any remaining large lists that still only return bare arrays.
- Add analytics only after scheduling/provider reliability is boring; analytics is not a launch feature.
- Add optional writing assistance without making self-hosted OpenPost depend on one hosted AI provider.
- Continue Android/mobile polish after the web and hosted flows are stable.

## Documentation Boundaries

- **User docs**: using the web app, CLI, MCP, media, scheduling, workspaces, and provider accounts.
- **Self-hosting docs**: install, config, storage, backups, upgrades, provider credentials, reverse proxy, and operations.
- **Developer docs**: architecture, backend/frontend internals, API generation, platform adapters, billing, MCP implementation, tests, and release behavior.
