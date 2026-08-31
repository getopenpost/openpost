# OpenPost domain migration checklist

> **Temporary working document.** Track the migration in Vikunja task `OPENPOST-109`. Delete this file in the final migration commit, after every exit gate at the end of this file passes.

This checklist moves the public OpenPost identity from `openpost.social` to `openpo.st` without breaking existing users, clients, provider grants, or published media.

## Domain map

| Surface                     | Current                 | Replacement       | Cutover rule                                                                                               |
| --------------------------- | ----------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| Marketing and legal         | `openpost.social`       | `openpo.st`       | Switch canonicals, then redirect the old host path-for-path.                                               |
| Documentation               | `docs.openpost.social`  | `docs.openpo.st`  | Switch canonicals, then redirect the old host path-for-path.                                               |
| Hosted app, API, OAuth, MCP | `app.openpost.social`   | `app.openpo.st`   | Serve both hosts. Do not redirect the old API or OAuth host until every compatibility item is resolved.    |
| Public media                | `media.openpost.social` | `media.openpo.st` | Keep both R2 custom domains available while old publications and provider jobs can reference the old host. |
| Browser telemetry proxy     | `cool.openpost.social`  | `cool.openpo.st`  | Keep both PostHog proxies available until old browser bundles and clients have aged out.                   |
| Hosted email                | `hello@openpost.social` | `hello@openpo.st` | Create and verify the new address first. Keep the old address as a receiving alias.                        |

`admin.openpost.social` and `e.openpost.social` occur only as test values. They do not need DNS records. Replace them with the new domain or neutral `.example` values when their tests are updated. The `openpost.dev` values in the n8n package are stale package metadata, not another live migration source.

## Current prepared state

- [x] `openpo.st` is attached to Cloudflare Pages project `openpost-marketing`.
- [x] `docs.openpo.st` is attached to Cloudflare Pages project `openpost-docs`.
- [x] `media.openpo.st` is attached to the existing `openpost` R2 bucket.
- [x] R2 CORS permits `PUT` from `https://app.openpost.social` and `https://app.openpo.st`.
- [x] `cool.openpo.st` is a valid second PostHog managed reverse proxy.
- [x] The new Cloudflare zone uses site-owned `robots.txt`, leaves crawler and AI blocking disabled, and has email obfuscation disabled.
- [x] The new marketing, docs, media, and PostHog aliases were tested without changing canonical URLs or adding redirects.
- [x] Cloudflare reports the `openpo.st` Pages custom domain, ownership, and certificate validation as active.

## Migration guardrails

- [ ] Record the exact OpenPost repository revision, Nix configuration revision, Pages deployment IDs, server image digest, DNS snapshot, and rollback owner before each production mutation.
- [ ] Keep `openpost.social` canonical until the reviewed repository revision and the matching app deployment are ready for one coordinated cutover.
- [ ] Add new callbacks, origins, domains, and aliases before removing old ones wherever the external service supports coexistence.
- [ ] Preserve provider client IDs and secrets unless a provider forces a new application. Existing connected-account grants belong to those applications.
- [ ] Keep the old app, API, MCP, webhook, media, and telemetry hosts functional through the compatibility window. Browser redirects are not a substitute for API compatibility.
- [ ] Keep both domains registered through every compatibility window. Verify registrar lock, auto-renewal, payment method, contact email, nameservers, and the earliest permitted cancellation date for `openpost.social` and `openpo.st`.
- [ ] Keep secrets and external API responses out of Git. Store operational evidence outside the repository.
- [ ] Mark an item `N/A` only with a note in `OPENPOST-109` naming the checked system and why it does not apply.

## 1. Freeze the migration contract

- [ ] Confirm the final public map in the table above, including whether `hello@openpo.st` is the only new public address or whether `support@openpo.st` is also required.
- [ ] Choose and record the compatibility duration for each old host. Marketing and docs can redirect after cutover. App, API, MCP, media, telemetry, email, and webhooks need a longer measured window.
- [ ] Inventory active web sessions, passkeys, CLI profiles, mobile installs, n8n credentials, MCP clients, organization OIDC providers, provider applications, and pending Paddle checkouts that can still name the old host.
- [ ] Decide the user notice and support path for reauthentication, passkey reenrollment, and client URL changes.
- [ ] Create narrow Vikunja subtasks for Cloudflare, Hosted deployment, repository contracts, provider consoles, email, registries, public profiles, cutover, and post-cutover monitoring. Record real blocking edges.
- [ ] Define rollback triggers for login, OAuth connection, publishing, billing, email, media fetch, MCP, telemetry, search indexing, and deployment revision mismatches.

## 2. Cloudflare and DNS

### New zone readiness

- [ ] Export a fresh read-only inventory of both zones: DNS, Pages domains, SSL/TLS mode, certificates, DNSSEC, HTTPS settings, HSTS, cache, WAF, bot settings, redirects, transform rules, cache rules, Workers routes, and R2 custom domains.
- [ ] Compare every intentional setting between the zones. Record deliberate differences instead of cloning account-specific verification or mail records.
- [ ] Confirm Universal SSL and custom certificates cover `openpo.st`, `docs.openpo.st`, `media.openpo.st`, `cool.openpo.st`, and later `app.openpo.st`.
- [ ] Verify no restrictive CAA record prevents Pages, R2, PostHog, or Caddy certificate issuance.
- [ ] Enable and verify DNSSEC for `openpo.st` if it is part of the final zone policy, including registrar DS propagation.

### App DNS and Caddy dependency

- [ ] Add `app.openpo.st` as a second Caddy virtual host in `/Users/rgo/.config/home/modules/services/caddy/default.nix`, serving the same OpenPost origin with the same security headers.
- [ ] Rebuild the VPS through `rebuild --vps` so Caddy is listening for the new host before public DNS points to it.
- [ ] Create the `app.openpo.st` DNS record with the same proxy mode and origin target policy as the current app record, then verify Caddy obtains and serves the new certificate.
- [ ] Verify `GET /api/v1/health`, `/api/v1/ready`, `/api/v1/version`, the app shell, API requests, WebSocket or streaming paths, and MCP over the new host while runtime canonicals still use the old host.
- [ ] Keep `app.openpost.social` proxying the same backend. Do not turn it into a blanket redirect.

### Edge behavior and redirects

- [ ] Change `cloudflare/edge-plan.json` and `scripts/cloudflare-edge-plan.mjs` ownership so Markdown negotiation, redirects, transforms, response headers, and cache variation target the new marketing and docs hosts.
- [ ] Prevent the edge tooling from accepting the wrong zone ID for a rendered hostname. A zone-name mismatch must fail before writes.
- [ ] Prepare reviewed redirect behavior for `openpost.social/*` to `openpo.st/*`, preserving path and query.
- [ ] Prepare reviewed redirect behavior for `docs.openpost.social/*` to `docs.openpo.st/*`, preserving path, query, and docs trailing-slash semantics.
- [ ] Keep explicit `.md` files, `llms.txt`, `llms-full.txt`, assets, sitemaps, `.well-known` resources, and real 404 behavior correct on the new hosts.
- [ ] Keep `media.openpost.social` as an R2 custom domain during the compatibility window instead of redirecting provider media fetches.
- [ ] Keep `cool.openpost.social` valid until no deployed browser bundle or supported client uses it.
- [ ] Capture and review Cloudflare forward and rollback plans before applying edge rules. Keep the evidence outside Git.

## 3. Email and domain verification

### PurelyMail

- [ ] Add `openpo.st` to PurelyMail before publishing mail DNS.
- [ ] Create `hello@openpo.st`, plus `support@openpo.st` if selected in the migration contract.
- [ ] Configure the new PurelyMail ownership proof, MX, SPF, all required DKIM selectors, and DMARC record from values issued for `openpo.st`.
- [ ] Keep `hello@openpost.social` receiving mail and forward or alias it to the new mailbox.
- [ ] Send inbound and outbound tests and verify SPF, DKIM, DMARC alignment, From, Reply-To, bounce handling, and replies.
- [ ] Update `OPENPOST_SUPPORT_EMAIL`, `OPENPOST_EMAIL_FROM`, `OPENPOST_SMTP_USERNAME`, and `OPENPOST_SMTP_FROM` in the Nix-owned Hosted configuration only after the new mailbox passes delivery tests.
- [ ] If the new SMTP username does not share the old mailbox credential, provision and test its password, update the SOPS value consumed through `OPENPOST_SMTP_PASSWORD_FILE`, and deploy the username and password together.
- [ ] Test registration verification, password reset, invitations, notification email, and daily digest links after the app public URL changes.

### Verification records

- [ ] Add and verify `openpo.st` in the GitHub organization, then publish the exact GitHub-issued TXT record. Keep the old domain verified during the compatibility window.
- [ ] Add the new Google Search Console domain property, then publish the exact Google-issued verification record.
- [ ] Add the new TikTok website and media domain or URL-prefix verification records from the TikTok developer console. Do not reuse the old token without confirmation.
- [ ] Audit Bing Webmaster Tools and any other search or ownership service in use. Add service-issued records or mark the service `N/A` in `OPENPOST-109`.
- [ ] If the official Bluesky handle is domain-based, publish the required `_atproto` record for the existing DID before changing the handle. Verify the DID remains unchanged.

## 4. Hosted application compatibility

### Authentication and sessions

- [ ] Treat existing browser sessions as host-bound. Verify the new host gives a clear sign-in path instead of appearing to lose data.
- [ ] Plan passkey migration explicitly. Passkeys registered for `app.openpost.social` cannot authenticate for the unrelated RP ID `app.openpo.st`. Ensure affected users have a password, Google login, or another recovery path, notify them, and test reenrollment on the new host.
- [ ] Verify session cookies, CSRF protection, SameSite behavior, CORS, redirects, return paths, logout, password reset, email verification, invitations, and legal acceptance on both app hosts.
- [ ] Update and test the WebAuthn RP ID derived from `OPENPOST_PUBLIC_URL`.
- [ ] Add `https://app.openpo.st` to every required browser origin or CORS allowlist while retaining the old origin during compatibility.

### OIDC and SSO

- [ ] Add `https://app.openpo.st/api/v1/auth/oidc/google/callback` to the Google login OAuth client before changing `OPENPOST_PUBLIC_URL`.
- [ ] Inventory every organization-managed OIDC provider. For each provider, register its new callback URL and back-channel logout URL shown by OpenPost.
- [ ] Test Google sign-up, Google sign-in, linking Google to an existing account, organization OIDC, PKCE, logout, and error return paths.
- [ ] Keep the old OIDC callbacks registered until old login attempts and supported clients have expired.

### MCP, CLI, mobile, and other clients

- [ ] Verify whether MCP dynamic client registrations, authorization codes, access tokens, refresh tokens, and resource/issuer claims remain usable through the old host after the canonical issuer changes.
- [ ] Make the MCP compatibility choice a cutover blocker. Either implement and test an explicit allowlist for both old and new resource audiences and metadata during the compatibility window, or require reconnection before cutover and state that old-audience MCP credentials will be invalidated.
- [ ] Require MCP clients to reconnect to `https://app.openpo.st/mcp` where issuer or resource binding prevents transparent reuse.
- [ ] Keep `https://app.openpost.social/mcp` serving valid metadata and requests through the compatibility window.
- [ ] Decide whether the CLI should migrate a profile whose instance is exactly `https://app.openpost.social`, or document the explicit `instance add/use` command. Never rewrite self-hosted profiles.
- [ ] Update the mobile Hosted default and add a one-time migration for the exact stored Hosted URL. Preserve the API token and verify the migrated install still reaches the same account and workspace.
- [ ] Keep old mobile releases functional through `app.openpost.social`.
- [ ] Update n8n defaults and docs for new credentials while keeping old user-entered Base URLs functional.

### Durable data and links

- [ ] Confirm connected social-account tokens, provider application rows, scheduled Publications, Renditions, jobs, webhook ledgers, and media keys need no database rewrite.
- [ ] Inventory stored absolute URLs. Migrate only records whose semantics require the new canonical host, with a backup and a reversible migration.
- [ ] Recheck stored media public-readiness state after switching the configured public media base URL.
- [ ] Verify public profile canonicals and shared profile links on both app hosts.
- [ ] Verify existing checkout attempts, invitation links, reset links, email-verification links, and OAuth state created before cutover still complete through the old host.

## 5. Social provider dashboards

Add the new value before removing the old value whenever a console supports more than one callback or domain. After each provider change, connect a fresh test account and run the relevant provider-readiness checks.

### X

- [ ] Add `https://app.openpo.st/api/v1/accounts/x/callback` to the production X application.
- [ ] Update the application website, terms, and privacy URLs to `openpo.st`.
- [ ] Verify OAuth 1.0a connection, reconnect, text publish, media upload, analytics, inbox, comments, and token reuse for an existing account.

### Mastodon

- [ ] Correct the existing Hosted `MASTODON_REDIRECT_URI` mismatch instead of copying it. The backend has no `/api/v1/accounts/mastodon/callback` route.
- [ ] Choose and test one supported flow:
  - OOB mode uses `urn:ietf:wg:oauth:2.0:oob`, followed by `POST /api/v1/accounts/mastodon/exchange`.
  - Redirect mode uses the browser route `https://app.openpo.st/accounts/mastodon/callback`, without `/api/v1`, after confirming the target Mastodon application supports it.
- [ ] Inventory configured `MASTODON_SERVERS` applications and dynamically registered instance applications.
- [ ] Register or update `https://app.openpo.st/accounts/mastodon/callback` only where the selected instance application uses redirect mode.
- [ ] Update the application website from `openpost.social` to `openpo.st` for new registrations without invalidating existing client IDs or tokens.
- [ ] Verify an existing grant, a new connection, code exchange, publish, media, analytics, inbox, comments, and Grow on representative instances.

### LinkedIn

- [ ] Add `https://app.openpo.st/api/v1/accounts/linkedin/callback` to the production LinkedIn application.
- [ ] Update application website, company association, privacy, and terms URLs.
- [ ] Verify personal profile and Organization Page selection, publish, media, comments, analytics, and existing grants.

### Meta: Threads, Facebook, and Instagram

- [ ] Inventory whether Threads, Facebook, and Instagram use one Meta application or separate applications.
- [ ] Add these valid OAuth redirect URIs to the correct applications:
  - [ ] `https://app.openpo.st/api/v1/accounts/threads/callback`
  - [ ] `https://app.openpo.st/api/v1/accounts/facebook/callback`
  - [ ] `https://app.openpo.st/api/v1/accounts/instagram/callback`
- [ ] Add `openpo.st` and `app.openpo.st` to App Domains and update the website, privacy, terms, data-deletion, and other policy URLs used by each application.
- [ ] Confirm Meta can fetch representative images and videos from `media.openpo.st` without authentication, blocked user agents, redirects, or wrong content types.
- [ ] Verify Threads publish and replies, Facebook Page selection and publishing, Instagram professional-account selection and publishing, Stories or Reels where supported, comments, inbox, analytics, and existing grants.

### TikTok

- [ ] Add `https://app.openpo.st/api/v1/accounts/tiktok/callback` to the production TikTok application.
- [ ] Update website, privacy, terms, and Content Posting API configuration.
- [ ] Verify `media.openpo.st` as the pull-from-URL domain or prefix before changing the runtime media base URL.
- [ ] Verify new OAuth, existing grants, Direct Post video, inbox upload, photo post, and analytics.

### Google login and YouTube

- [ ] Inventory whether Google login and YouTube use the same OAuth client or separate clients.
- [ ] Add `https://app.openpo.st/api/v1/accounts/youtube/callback` to the YouTube OAuth client.
- [ ] Add the Google login callback listed in the OIDC section and `https://app.openpo.st` as an authorized origin if that client requires one.
- [ ] Add `openpo.st` to the OAuth consent screen authorized domains and update homepage, privacy, and terms URLs.
- [ ] Verify consent-screen approval remains valid, then test Google login, YouTube channel selection, upload, thumbnail, playlist settings, comments, analytics, and existing refresh tokens.

### Bluesky and Discord

- [ ] Update the official Bluesky profile website and domain handle if used. Verify followers and the account DID are preserved.
- [ ] Verify Bluesky app-password connections and publishing are unaffected because no OpenPost OAuth application is involved.
- [ ] Update the official Discord server profile, welcome text, bot or application website fields, and public links that name the old domain.
- [ ] Verify existing incoming Discord webhooks still publish, since their URLs belong to Discord and should not be rewritten.

### Provider launch gate

- [ ] Run `openpost provider readiness --json` after the Hosted deployment.
- [ ] Re-run local and live certification for every provider/format whose callback, public media URL, app metadata, or approval was changed.
- [ ] Run `bun run check -- provider-certification` and keep public claims no stronger than current evidence.

## 6. Billing, telemetry, AI, and other external services

### Paddle

- [ ] Add or move the Paddle notification destination to `https://app.openpo.st/api/v1/billing/paddle/webhook` without creating a period where no valid destination exists.
- [ ] Confirm whether editing the destination preserves its webhook secret. If the secret changes, update SOPS and deploy the new secret in the same controlled operation.
- [ ] Update approved/default website domains in Paddle if the client token or checkout settings enforce them.
- [ ] Change `OPENPOST_PADDLE_CHECKOUT_RETURN_URL` to `https://app.openpo.st/checkout?status=success` only after the new app host works.
- [ ] Test checkout creation, inline checkout, success return, signed webhook verification, idempotency, subscription reconciliation, customer portal, payment recovery, cancellation, and a checkout started before cutover.

### PostHog

- [ ] Change the Hosted browser proxy to `https://cool.openpo.st` in the owning runtime configuration and GitHub Actions variable `POSTHOG_BROWSER_HOST`.
- [ ] Inventory `VITE_POSTHOG_API_HOST` in the `openpost-marketing` and `openpost-docs` Cloudflare Pages production environments and every applicable preview environment.
- [ ] Coordinate the repository check and Pages environment change so neither project is left undeployable. Use a reviewed transition that accepts both proxies, deploy it, update Pages to `https://cool.openpo.st`, verify both Pages builds, then require only the new proxy.
- [ ] Update the repository default and telemetry documentation from `cool.openpost.social` to `cool.openpo.st`.
- [ ] Verify PostHog static assets, event ingestion, session replay if enabled, source-map uploads, environments, and live events from `openpo.st`, `docs.openpo.st`, and `app.openpo.st`.
- [ ] Keep `cool.openpost.social` valid until no supported deployed bundle sends events there.

### OpenRouter and remaining SaaS

- [ ] Change the OpenRouter HTTP referer and any OpenRouter application metadata to `https://openpo.st`.
- [ ] Audit every GitHub secret, variable, environment, webhook, and third-party integration for URL, origin, callback, webhook, contact email, or allowed-domain fields. Record each checked system or `N/A` in `OPENPOST-109`.
- [ ] Audit uptime monitors, status pages, vulnerability scanners, backup checks, log alerts, analytics, support tooling, and password-manager records for the old domain.

## 7. Repository changes

Change authoritative sources first, then regenerate outputs. Do not hand-edit generated contracts or embedded builds.

### Runtime and contracts

- [ ] Update Hosted defaults and public contract URLs in `backend/internal/config/config.go`, `backend/internal/api/openapi.go`, `backend/internal/ai/openrouter.go`, and their tests.
- [ ] Review `backend/internal/services/drafts/revisions.go`. Its old-domain problem type is a protocol identifier. Preserve it or treat a change as a compatibility decision, not a text replacement.
- [ ] Review Mastodon application website and callback configuration, including tests and Hosted overrides.
- [ ] Update legal manifest sources in `packages/legal-policy/src/manifest.json`, then regenerate `backend/internal/legalpolicy/manifest_generated.go` through `scripts/legal-policy-manifest.mjs`.
- [ ] Decide whether a URL-only legal move changes policy versions. Preserve historical legal records unless the legal-policy contract explicitly requires new canonical URLs.
- [ ] Update OpenAPI server, contact, and legal URLs, then regenerate `frontend/openapi.json` and `packages/n8n-nodes-openpost/generated/selectedContract.ts` through the contract workflow.
- [ ] Update public profile, billing, media, CORS, callback, and app-origin tests to assert the new canonical values. Use neutral `.example` values for tests that only exercise arbitrary origins.

### Marketing and docs

- [ ] Update the canonical marketing, app, docs, and support values in `marketing-site/src/routes/_marketing.ts` and `packages/social-images/src/index.js`.
- [ ] Update canonical tags, Open Graph and social metadata, JSON-LD IDs, sitemaps, robots, alternate Markdown links, changelog feed links, visible domain text, UTM sources, OG rendering, and social image packages.
- [ ] Preserve Atom entry identity semantics. Changing every historical entry ID can replay the full changelog to subscribers. Record and test the chosen stable-ID behavior.
- [ ] Update `marketing-site/static/_headers`, `auth.md`, `.well-known/api-catalog`, `.well-known/integrations.json`, `.well-known/mcp/server-card.json`, and the static 404 page from their owning sources.
- [ ] Update `scripts/generate-agent-surfaces.mjs`, agent-surface tests, discovery origins, `llms.txt`, `llms-full.txt`, Markdown mirrors, and no-JavaScript evidence.
- [ ] Preserve and verify the intended `Content-Signal` headers on the new marketing and docs hosts.
- [ ] Update docs navigation, docs robots and sitemap origins, Hosted topology, telemetry, billing, MCP, editor links, installation notes, and callback examples.
- [ ] Update `docs/operations/cloudflare-edge-plan.md` for the new owning zone, new hosts, redirect ownership, proof commands, and rollback.
- [ ] Regenerate `docs-site/.generated/openpost-nix-module.md` from the updated external Nix source through `scripts/sync-docs-external.mjs`.
- [ ] Update marketing and docs E2E expectations, routing checks, metadata checks, and public deployment proof host allowlists.

### App, clients, packages, and public material

- [ ] Update frontend fallback legal, pricing, documentation, and checkout links.
- [ ] Update `mobile/src/lib/server.ts`, its comments and tests, and the exact-old-Hosted-URL migration.
- [ ] Update CLI documentation and any examples that use the old public domain. Keep arbitrary URL parser fixtures neutral.
- [ ] Update `server.json`, bump its registry version as required, and update `scripts/check-mcp-registry.mjs` and tests.
- [ ] Replace stale `openpost.dev` n8n homepage, documentation, placeholder, default base URL, error example, and support email values with `openpo.st` values.
- [ ] Update the n8n README, package metadata, credentials UI, tests, and generated contract.
- [ ] Update `README.md`, `CONTRIBUTING.md`, `ROADMAP.md`, `skills/openpost-cli/SKILL.md`, connector examples, launch kit, listings, social captions, generated SVGs, brand OG assets, and any visible domain embedded in media.
- [ ] Update `.github/workflows/release.yml`, `scripts/release.mjs`, deployment probes, release-message links, and every revision-proof assertion.
- [ ] Regenerate the embedded frontend under `backend/cmd/openpost/public` through the normal build instead of editing its hashed assets.
- [ ] Preserve historical `CHANGELOG.md` statements that describe the former domain. Update only links that are meant to resolve to current documentation.
- [ ] Add the required `changes/<issue>.md` entry for the user-visible domain migration.

### Repository closure scan

- [ ] Review every tracked occurrence, not only source files:

  ```sh
  git grep -n -I -i -E 'openpost\.social|openpost\.dev'
  ```

- [ ] Classify every remaining old-domain occurrence as one of: compatibility route, stable protocol identifier, immutable historical record, migration documentation, or defect.
- [ ] Register time-bounded compatibility surfaces in `compatibility-surfaces.json` when they have a planned retirement.
- [ ] Remove every unclassified occurrence. Generated outputs must agree with their sources.
- [ ] Search untracked deployment source and external configuration too:

  ```sh
  rg -n --hidden -i 'openpost\.social|openpost\.dev' /Users/rgo/.config/home --glob '!**/.git/**'
  ```

## 8. Nix-owned Hosted deployment

- [ ] In `/Users/rgo/.config/home/modules/services/openpost/default.nix`, change the canonical domain to `app.openpo.st` and update app/public URL, CORS, provider callbacks, legal URLs, media base URL secret, Paddle return URL, PostHog proxy, support email, and SMTP identity as applicable.
- [ ] Inspect the effective `OPENPOST_PROVIDER_APPS_FILE`, `OPENPOST_PROVIDER_APPS`, and legacy provider variables. Update every explicit old-domain `redirect_uri`; changing `OPENPOST_APP_URL` only updates callbacks that were derived rather than supplied.
- [ ] Update `/Users/rgo/.config/home/modules/services/caddy/default.nix` so both app hosts serve the application. Keep the old `openpost.rgo.pt` redirect aimed at the chosen canonical app host.
- [ ] Update `/Users/rgo/.config/home/modules/hosting/deployments/default.nix` public readiness, version, rollout, and rollback probes to prove the new canonical host while also checking old-host compatibility.
- [ ] Update the SOPS-owned R2 public base URL and any other domain-bearing secret values without exposing plaintext.
- [ ] Run `nixfmt` on changed Nix files, `statix check .`, and `nix flake check --no-build --all-systems --impure`.
- [ ] Rebuild with `rebuild --vps` and verify the exact activated Nix revision before deploying the matching OpenPost application revision.

## 9. GitHub, registries, packages, and public profiles

### GitHub

- [ ] Change the `getopenpost/openpost` repository homepage to `https://openpo.st`.
- [ ] Change the `getopenpost` organization website to `https://openpo.st` and its public email to `hello@openpo.st`.
- [ ] Verify `openpo.st` for the organization before removing `openpost.social` verification.
- [ ] Update the repository social preview image if it contains `openpost.social`.
- [ ] Audit the organization profile repository, pinned repositories, Discussions, issue forms, templates, release text, webhooks, Actions environments, variables, and secrets for old links.

### MCP and n8n registries

- [ ] Publish the updated MCP `server.json` entry for `https://app.openpo.st/mcp` and verify the registry resolves the new endpoint and metadata.
- [ ] Update the existing awesome-remote-MCP listing or submit a replacement change for the new endpoint.
- [ ] Publish an updated `@getopenpost/n8n-nodes-openpost` version through the trusted-publisher workflow after the exact new server revision is live.
- [ ] Verify npm metadata, provenance, signatures, clean install, n8n credential defaults, and a real workflow against `app.openpo.st`.
- [ ] Update any n8n community-node directory or verification listing that stores the old website or docs URL.

### Official social profiles

For each official account below, update the website, bio, link-in-bio destination, contact email, pinned post, profile metadata, and platform-owned business profile. If no account exists, record `N/A` in `OPENPOST-109`.

- [ ] X
- [ ] Mastodon
- [ ] Bluesky
- [ ] LinkedIn company page
- [ ] Threads
- [ ] Facebook Page
- [ ] Instagram
- [ ] TikTok
- [ ] YouTube channel
- [ ] Discord server

- [ ] Update Product Hunt, startup directories, app directories, package directories, and launch listings that contain the old website.
- [ ] Update public posts or documents only when they are editable current references. Do not rewrite immutable historical posts merely to hide the old domain.

## 10. Canonical cutover sequence

- [ ] Confirm new DNS, TLS, app alias, email, provider callbacks, Paddle webhook, media fetch, and recovery login paths are ready.
- [ ] Merge and push the reviewed OpenPost repository revision. Let the Git-backed Pages projects deploy it. Do not upload local Pages builds.
- [ ] Deploy the reviewed Nix configuration and exact server image revision.
- [ ] Verify `/api/v1/version` and `/api/v1/ready` on both app hosts before switching public discovery.
- [ ] Switch runtime `OPENPOST_APP_URL` and `OPENPOST_PUBLIC_URL` to `https://app.openpo.st`, media to `https://media.openpo.st`, browser telemetry to `https://cool.openpo.st`, and legal/support/email values to the new domain.
- [ ] Confirm OpenAPI, OAuth metadata, MCP metadata, WebAuthn RP ID, OIDC callbacks, email links, checkout returns, and public profile canonicals now advertise the new domain.
- [ ] Make `openpo.st` and `docs.openpo.st` canonical in Pages output, sitemaps, robots, feeds, metadata, agent surfaces, and headers.
- [ ] Apply reviewed old-marketing and old-docs redirects only after the new canonical deployments pass live proof.
- [ ] Update GitHub, registries, provider app display metadata, and official profile links after the canonical sites are live.
- [ ] Leave old app/API/MCP, media, PostHog, email, callback, and webhook compatibility in place for the recorded window.

## 11. Verification and monitoring

### Product and security

- [ ] Test registration, password login, Google login, passkey recovery and reenrollment, logout, password reset, email verification, invitations, legal acceptance, checkout, portal, and public profiles.
- [ ] Test one existing and one new connection for each OAuth provider, plus Bluesky app password and Discord webhook connections.
- [ ] Test immediate and scheduled text, image, video, carousel or thread publishing where supported, plus media provider fetches from the new R2 host.
- [ ] Test analytics, comments, replies, inbox, Grow, account refresh, token refresh, and provider reconnect where supported.
- [ ] Test API bearer tokens, CLI profiles, MCP OAuth, mobile migration, and n8n credentials from both new and supported old endpoints.
- [ ] Confirm no secret, session, authorization code, or bearer token is sent to a different origin by a redirect.

### Public sites and crawlers

- [ ] Run marketing and docs builds and all relevant metadata, agent-surface, routing, sitemap, robots, no-JavaScript, and E2E checks.
- [ ] Run the Cloudflare edge plan inspection, render, prepare, reviewed apply, Trace checks, cache-variant tests, and rollback rehearsal for the new owning zone.
- [ ] Run `scripts/public-deployment-proof.mjs prove` against the exact clean revision, both successful Pages deployment details, the new live hosts, and a fresh 24-hour AI crawl snapshot.
- [ ] Verify `robots.txt`, `llms.txt`, `llms-full.txt`, Markdown mirrors, `.well-known` resources, OpenAPI, MCP discovery, canonicals, alternates, sitemaps, feeds, assets, real 404s, redirects, and query preservation.
- [ ] Submit `https://openpo.st/sitemap.xml` and `https://docs.openpo.st/sitemap.xml` to Google Search Console and Bing if used.
- [ ] Use URL inspection and live tests to confirm new pages are indexable and old marketing/docs URLs resolve to one permanent redirect with no chain.
- [ ] After both old and new properties are verified and redirects are live, submit Google Search Console Change of Address and Bing Site Move where available. Keep the old properties through the observation window.
- [ ] Rescrape representative links with Meta Sharing Debugger, LinkedIn Post Inspector, and any available X or other platform preview tool.

### Release gates

- [ ] Run focused gates while editing, then `bun run release -- check` on the stable candidate revision.
- [ ] Run `bun run verify` only if the final risk assessment requires the high-risk production-build proof.
- [ ] Run the UI and copy consistency review for every changed user-facing surface.
- [ ] Confirm the repository is clean except for intended migration changes and pre-existing unrelated work.

### Observation window

- [ ] Monitor both app hosts for readiness, version identity, TLS, HTTP errors, OAuth failures, passkey failures, webhook failures, media fetch errors, email bounces, billing reconciliation, MCP errors, and PostHog ingestion.
- [ ] Monitor new and old marketing/docs crawl traffic, indexing, redirect coverage, 404s, canonical selection, and sitemap processing.
- [ ] Compare provider success and failure rates before and after cutover. Roll back the canonical switch if a defined trigger fires.
- [ ] Record the end of each compatibility window with evidence that supported traffic has moved before removing an old endpoint.

## 12. Retirement and exit gate

- [ ] Retire old marketing and docs Pages custom domains only if redirect ownership has moved elsewhere and live redirects remain proven. Otherwise keep the domains attached to serve redirects.
- [ ] Remove `cool.openpost.social` only after old browser bundles no longer send supported traffic and the PostHog proxy limit is no longer needed.
- [ ] Remove `media.openpost.social` only after persisted links, queued jobs, provider fetches, public posts, and supported clients no longer need it. Keeping it indefinitely is acceptable if measured risk favors compatibility.
- [ ] Remove old provider callbacks only after no supported login or connection flow can originate from the old app host.
- [ ] Retire `app.openpost.social` only through a separate reviewed compatibility decision. If retained, document its supported behavior and monitoring owner.
- [ ] Keep `hello@openpost.social` as an alias for the recorded support period, then decide whether permanent receipt is cheaper and safer than retirement.
- [ ] Remove old Search Console, GitHub verification, and provider-domain records only after the corresponding old property is no longer needed.
- [ ] Confirm all durable documentation describes `openpo.st` as canonical and all intentional old-domain remnants are classified and owned.
- [ ] Confirm `OPENPOST-109` contains final revisions, deployment proof, external-system completion, residual compatibility surfaces, monitoring results, and rollback closure.
- [ ] Confirm no unchecked item remains in this file.
- [ ] **Delete `DOMAIN_MIGRATION.md` in the final migration commit.** Its deletion is the last checklist item and signals that the migration record has moved to durable code, documentation, compatibility contracts, and `OPENPOST-109`.
