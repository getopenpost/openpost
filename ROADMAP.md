# OpenPost Roadmap

> Status: July 2026.

OpenPost is a social publishing product with a managed service and a self-hosted option. The hosted service manages its own secrets, social app keys, deployment, and live account tests.

## Recently Landed

- Monorepo/Turborepo workspace with `frontend`, `docs-site`, and `marketing-site`.
- OpenPost marketing site with product, platform, pricing, security, open-source, tools, and comparison pages.
- Hosted service support: edition mode, PostgreSQL, S3-compatible media, direct uploads, hosted-mode checks, and database fixes.
- Whop billing: embedded checkout, memberships, signed webhooks, local subscription snapshots, entitlement checks, usage counters, billing management, and CLI billing commands.
- MCP and ChatGPT-style app base: remote `/mcp`, local proxy, OAuth PKCE account linking, Apps SDK widget details, limited MCP tokens, tool-call history, prompts, and tools for schedules, media, and social networks.
- Platform setup and publishing for Facebook Pages, Instagram Business and Creator accounts, TikTok, and YouTube, plus operator tools for social app keys and account discovery.
- Production diagnostics: `/ready`, CLI `instance health`, redacted `instance diagnostics`, provider catalog snapshots, and billing usage snapshots.
- Platform analytics with saved account and post results, background updates, 7/30/90-day views, and clear access errors.
- Comments, moderation, personal alerts, and opt-in inbox collection for supported accounts.
- Discord webhook publishing with text, files, reply links, scheduling, and deletion.
- OpenPost Studio for local or workspace still-image designs, templates, brand items, background removal, and media export.
- E2E coverage for marketing, docs audience separation, auth/onboarding, settings/billing/MCP activity, provider discovery, workspace switching, composer scheduling, media library, and app smoke flows.

## Current Priorities

1. **Hosted operations**
   - Keep `openpost.social`, `docs.openpost.social`, and `app.openpost.social` independently monitored and verified after changes.
   - Keep the managed deployment on cloud mode, Postgres, S3/R2 media, Whop billing, readiness probes, backups, and tested recovery.
   - Repeat database, media, and secrets restore drills as the hosted data model changes.

2. **Provider live-account verification**
   - Re-test OAuth, token refresh, media checks, publishing, retries, and API limits with real accounts for every enabled social network.
   - Keep fact checks, API limit notes, access needs, and live-test notes with each social network and post type.
   - Do not use maturity labels as a substitute for current account-specific readiness.

3. **Release reliability**
   - Keep Docker, binary, CLI, Android, frontend, docs, and marketing release paths reproducible.
   - Confirm release artifacts and docs match the current tag before publishing.
   - Follow SemVer from the latest release tag and base each version change on Conventional Commits.
   - Continue running `devenv shell -- verify` before release tags.

4. **Operator support polish**
   - Keep `.env.example`, provider setup docs, backup/restore docs, production checklist, and CLI diagnostics aligned with runtime behavior.
   - Prefer support snapshots that are useful but never leak tokens, secrets, provider credentials, or private log payloads.

## Next Work

- Finish live-provider follow-through: better provider-specific error messages, retry notes, and launch-status updates after real verification.
- Improve thread management for atomic updates to scheduled or failed thread chains.
- Add page details to any large API lists that still return one plain array.
- Verify analytics counters and permissions with live accounts, then expand coverage only where providers expose stable, approved reads.
- Add optional writing assistance without making self-hosted OpenPost depend on one hosted AI provider.
- Continue Android/mobile polish after the web and hosted flows are stable.

## Documentation Boundaries

- **User docs**: using the web app, CLI, MCP, media, scheduling, workspaces, and provider accounts.
- **Self-hosting docs**: install, config, storage, backups, upgrades, provider credentials, reverse proxy, and operations.
- **Developer docs**: architecture, backend/frontend internals, API generation, platform adapters, billing, MCP implementation, tests, and release behavior.
