# Product telemetry and error tracking

OpenPost can send privacy-limited product, service, website, documentation, and error events to PostHog. The managed OpenPost service enables this integration. Self-hosted installations leave it disabled unless their operator explicitly configures an operator-owned PostHog project.

OpenPost uses both PostHog SDKs because they observe different facts:

- `posthog-js` records browser page views, explicit product interactions, and sanitized browser failures.
- `posthog-go` records authoritative server outcomes, background-job failures, and sanitized backend exceptions.

Do not record the same outcome in both layers. Browser events describe intent, such as `publication publish requested`; server events describe confirmed outcomes, such as `rendition published`.

## Privacy boundary

The shared browser client uses cookieless mode and memory-only persistence. Autocapture, session replay, surveys, console capture, network bodies, heatmaps, and automatic exception capture are disabled. Public marketing and documentation events stay anonymous and personless. The signed-in app identifies a person only with the opaque OpenPost user ID; the backend uses the same ID.

Do not add email addresses, names, usernames, post text, media, request bodies, credentials, query strings, or raw URLs to events or exceptions. Use route templates, stable object IDs, status codes, release identity, and enumerated failure types. A PostHog project token is write-only and may be exposed to the browser; a personal API key must remain in CI secret storage.

Before enabling telemetry, configure the PostHog project to:

- use cookieless server hashing;
- disable IP capture;
- retain events for no more than 12 months;
- keep session replay and automatic browser exception capture disabled;
- use the EU Cloud project when operating the official managed service.

Changing that boundary requires a privacy review and a matching policy update before deployment.

## App and backend configuration

Set these values in the process environment or in **Settings → Instance → Configuration**. Configuration changes take effect after restart.

```dotenv
OPENPOST_TELEMETRY_ENABLED=true
OPENPOST_POSTHOG_PROJECT_TOKEN=phc_operator_owned_project_token
OPENPOST_POSTHOG_API_HOST=https://eu.i.posthog.com
OPENPOST_POSTHOG_BROWSER_HOST=https://telemetry.example.com
OPENPOST_POSTHOG_UI_HOST=https://eu.posthog.com
OPENPOST_TELEMETRY_ENVIRONMENT=production
```

`OPENPOST_POSTHOG_API_HOST` is the direct server-side ingestion endpoint. `OPENPOST_POSTHOG_BROWSER_HOST` may be a first-party reverse proxy. A browser proxy must forward PostHog ingestion and static asset paths, support `GET` and `POST`, and allow large session-recording requests even though OpenPost currently disables replay. Keep `OPENPOST_POSTHOG_UI_HOST` set to the real PostHog UI host.

The browser reads its safe runtime configuration from `GET /api/v1/telemetry/config`. This lets one static OpenPost bundle work in the managed service and in self-hosted installations without compiling the managed-service token into every binary.

## Marketing and documentation

The marketing and documentation sites are separate static builds. Give both builds the same production project and environment as the app:

```dotenv
VITE_POSTHOG_PROJECT_TOKEN=phc_operator_owned_project_token
VITE_POSTHOG_API_HOST=https://telemetry.example.com
VITE_POSTHOG_UI_HOST=https://eu.posthog.com
VITE_OPENPOST_ENVIRONMENT=production
VITE_OPENPOST_VERSION=3.4.0
VITE_OPENPOST_REVISION=<git-revision>
```

Use one PostHog production project across the app, backend, marketing site, and documentation so acquisition and product adoption can be analyzed together. Use separate projects for development and staging. Every event includes a stable `surface` and environment so queries can still separate them.

## Source maps

Production source-map upload is opt-in in CI. Set `POSTHOG_SOURCEMAPS_ENABLED=1`, then provide `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, `POSTHOG_UI_HOST`, and a release identity through `OPENPOST_RELEASE_VERSION` or `GITHUB_SHA`. The personal API key is a CI secret and must never use a `VITE_` prefix. Builds upload hidden source maps and delete them from the deployed output after upload.

## Shutdown and delivery

OpenPost creates one backend PostHog client at startup and closes it during graceful shutdown so queued events can drain. Event delivery is best-effort and must never decide authorization, billing access, publication state, or job success. Keep business records in the OpenPost database; telemetry is an observation layer, not a source of truth.

See PostHog's [data-collection controls](https://posthog.com/docs/privacy/data-collection), [Go SDK guide](https://posthog.com/docs/libraries/go), [proxy guide](https://posthog.com/docs/advanced/proxy), and [GDPR guidance](https://posthog.com/docs/privacy/gdpr-compliance) for provider-side setup.
