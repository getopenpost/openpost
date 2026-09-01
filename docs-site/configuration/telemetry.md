# Product telemetry and error tracking

OpenPost can send privacy-limited product, service, website, documentation, and error events to PostHog. The Hosted service enables this integration. Self-hosted installations leave it disabled unless their operator explicitly configures an operator-owned PostHog project.

OpenPost uses both PostHog SDKs because they observe different facts:

- `posthog-js` records browser page views, explicit product interactions, and sanitized browser failures.
- `posthog-go` records authoritative server outcomes, background-job failures, and sanitized backend exceptions.

Do not record the same outcome in both layers. Browser events describe intent, such as `publication publish requested`; server events describe confirmed outcomes, such as `rendition published`.

The production first-use funnel uses these ordered events:

1. `signup started` — browser submission intent
2. `signup completed` — server account creation
3. `plan confirmed` — server purchase confirmation
4. `workspace created` — server first Workspace creation
5. `checkout completed` — server confirmation of the consumed successful checkout return
6. `destination connected` — server claim of the first connected destination
7. `first composition started` — browser confirmation after the server accepts the first meaningful composition claim
8. `workspace activated` — server exactly-once Activation transition

The browser must not duplicate authoritative server outcomes. Funnel events accept only the properties declared in the shared browser and backend telemetry catalogues. Unknown event names, unknown properties, email addresses, secret-bearing URLs, and credential-shaped values are rejected before enqueue.

## Privacy boundary

The shared browser client has four states:

- **Undecided:** no optional browser telemetry is sent.
- **Persistent:** after the visitor allows analytics cookies, PostHog keeps first-party identity and sessions across OpenPost sibling subdomains. The signed-in app identifies the browser only with the opaque OpenPost user ID. PostHog derives country and bot signals before discarding raw client IP.
- **Cookieless:** after the visitor continues without analytics cookies, PostHog receives limited personless events with daily server-hashed identity, memory-only state, no geography, and no reliable multi-day retention.
- **Off:** no optional browser telemetry or browser correlation headers are sent. Do Not Track and Global Privacy Control force this state.

The preference is separate from mandatory policy acknowledgement and can be changed from **Analytics choices** in each browser surface. The Hosted service shares that choice through a first-party `openpost_analytics` cookie scoped to `.openpo.st`. Self-hosted deployments use a host-only cookie. Changing from an initialized mode clears the current origin's PostHog state and reloads; another sibling origin clears its own local state when it next loads.

Autocapture, session replay, surveys, console capture, network timing and bodies, heatmaps, dead-click capture, and automatic exception capture are disabled. OpenPost records manual page views and matching page leaves. It records CLS, FCP, INP, and LCP without element attribution. Persistent marketing and documentation events remain anonymous until a user signs into the app. Cookieless events always remain personless.

Backend product and service telemetry is a separate observation boundary. It records authoritative outcomes with opaque identifiers and keeps Go SDK GeoIP disabled. Browser analytics choices do not suppress these backend events, and cookieless browser requests do not send correlation headers that could join them to service outcomes.

Do not add email addresses, names, usernames, post text, media, request bodies, credentials, query strings, or raw URLs to events or exceptions. Use route templates, stable object IDs, status codes, release identity, and enumerated failure types. A PostHog project token is write-only and may be exposed to the browser; a personal API key must remain in CI secret storage.

`first composition started` is emitted only after the server atomically accepts the first meaningful composition for a Workspace. Its browser property allowlist contains only `signal`, with one of `text`, `media`, or `content_mode`. It excludes authored content, prompts, captions, media URLs, identity data, provider handles, destination identifiers, and secret-bearing URLs. Opening or focusing the composer, selecting a destination, and saving an empty draft do not emit it.

Before enabling telemetry, configure the PostHog project to:

- use stateful cookieless server hashing for the cookieless browser mode;
- derive approved country and bot properties for persistent browser events, then discard raw client IP;
- remove city, region, latitude, longitude, postal code, and accuracy-radius properties after enrichment;
- retain events for no more than 12 months;
- keep broad autocapture, automatic browser exception capture, replay, heatmaps, surveys, dead clicks, console capture, and network payload capture disabled;
- enable Web Vitals for CLS, FCP, INP, and LCP while leaving network timing and element attribution disabled;
- use the EU Cloud project when operating the official Hosted service.

Changing that boundary requires a privacy review and a matching policy update before deployment.

## App and backend configuration

Set these values in the process environment or in **Settings → Instance → Configuration**. Configuration changes take effect after restart.

```dotenv
OPENPOST_TELEMETRY_ENABLED=true
OPENPOST_POSTHOG_PROJECT_TOKEN=phc_operator_owned_project_token
OPENPOST_POSTHOG_API_HOST=https://eu.i.posthog.com
OPENPOST_POSTHOG_BROWSER_HOST=https://cool.openpo.st
OPENPOST_POSTHOG_UI_HOST=https://eu.posthog.com
OPENPOST_TELEMETRY_ENVIRONMENT=production
```

`OPENPOST_POSTHOG_API_HOST` is the direct server-side ingestion endpoint. `OPENPOST_POSTHOG_BROWSER_HOST` may be a first-party reverse proxy. Cloud mode defaults to the Hosted service `https://cool.openpo.st` proxy; self-hosted deployments fall back to the direct API host unless the operator sets a proxy. A browser proxy must forward PostHog ingestion and static asset paths, support `GET` and `POST`, preserve the client connection metadata needed for the approved PostHog country and bot transformations, and avoid forwarding OpenPost `Cookie`, `Authorization`, and unnecessary `Referer` headers. Keep `OPENPOST_POSTHOG_UI_HOST` set to the real PostHog UI host.

The browser reads its safe runtime configuration from `GET /api/v1/telemetry/config`. This lets one static OpenPost bundle work in the Hosted service and in self-hosted installations without compiling the Hosted service token into every binary.

## Marketing and documentation

The marketing and documentation sites are separate static builds. Give both builds the same production project and environment as the app:

```dotenv
VITE_POSTHOG_PROJECT_TOKEN=phc_operator_owned_project_token
VITE_POSTHOG_API_HOST=https://cool.openpo.st
VITE_POSTHOG_UI_HOST=https://eu.posthog.com
VITE_OPENPOST_ENVIRONMENT=production
VITE_OPENPOST_VERSION=3.4.0
VITE_OPENPOST_REVISION=<git-revision>
```

Use one PostHog production project across the app, backend, marketing site, and documentation so acquisition and product adoption can be analyzed together. Use separate projects for development and staging. Every event includes a stable `surface` and environment so queries can still separate them. Production public-site builds stop with an error when the project token, exact Hosted service proxy host, or EU UI host is missing.

The browser rewrites PostHog-owned page lifecycle and Web Vitals URL properties to the route template already captured by OpenPost. It removes query strings, fragments, raw dynamic route values, referrer paths, page titles, resource entries, and element attribution before delivery. Every browser event carries `analytics_mode` so reports can separate persistent identities from daily cookieless hashes.

## Source maps

Production source-map upload is opt-in in CI. Set `POSTHOG_SOURCEMAPS_ENABLED=1`, then provide `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, `POSTHOG_UI_HOST`, and a release identity through `OPENPOST_RELEASE_VERSION` or `GITHUB_SHA`. The personal API key is a CI secret and must never use a `VITE_` prefix. Builds upload hidden source maps and delete them from the deployed output after upload.

## Shutdown and delivery

OpenPost creates one backend PostHog client at startup and closes it during graceful shutdown so queued events can drain. Event delivery is best-effort and must never decide authorization, billing access, publication state, or job success. Keep business records in the OpenPost database; telemetry is an observation layer, not a source of truth.

## Production funnel verification

An operator with an authenticated PostHog MCP connection creates or updates the saved `OpenPost first-use Activation` funnel in the production project. The funnel uses the ordered event list above, filters to `environment = production`, and excludes marked smoke events so verification does not change product metrics.

After changing the journey catalogue or production PostHog configuration, use PostHog MCP to inspect the saved definition and query the result. Send one personless sequence of all eight events through the project's browser-safe ingestion token with a random `distinct_id`, `openpost_smoke = true`, and `$process_person_profile = false`. Confirm through PostHog MCP that the exact smoke identity reaches all eight ordered steps, then retain the insight link, verification time, and smoke ID with the change record. This operator flow uses MCP OAuth for project access and does not require a PostHog personal API key in GitHub Actions.

See PostHog's [data-collection controls](https://posthog.com/docs/privacy/data-collection), [Go SDK guide](https://posthog.com/docs/libraries/go), [proxy guide](https://posthog.com/docs/advanced/proxy), and [GDPR guidance](https://posthog.com/docs/privacy/gdpr-compliance) for provider-side setup.
