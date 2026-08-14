# Cloudflare public edge plan

The public-surface operator owns the optional edge-selected Markdown rules for
`openpost.social` and `docs.openpost.social`. The explicit `.md` files remain the
primary interface. A normal marketing or documentation build generates those
files and never reads Cloudflare credentials or changes a zone.

## Repository contract

`cloudflare/edge-plan.json` records the two zones, execution order, credential
names, and Cloudflare Free limits. `scripts/cloudflare-edge-plan.mjs` derives
every eligible path from `marketingRouteManifest` and `docsPageCatalog`. Run:

```sh
bun scripts/cloudflare-edge-plan.mjs render --output /tmp/openpost-edge-plan.json
```

Review the rendered digest, path sets, expressions, actions, origin-header
counts, and rule counts. The generator fails before any API request if a phase
exceeds 10 Free-plan Single Redirect, Transform, or Cache Rules, if a Pages
`_headers` file would exceed 100 rules, or if a rule expression exceeds 4,096
characters. Each public build also rejects a `_headers` line over 2,000
characters. The generated plan uses this Cloudflare execution order:

1. `http_request_dynamic_redirect` canonicalizes known routes and preserves the
   query string.
2. `http_request_transform` selects an explicit Markdown artifact only for a
   canonical `GET` or `HEAD` request with one case-folded `Accept` value equal
   to `text/markdown` after removing surrounding spaces and tabs. Mixed,
   weighted, wildcard, parameterized, truncated, and internally spaced values
   do not qualify.
3. `http_request_cache_settings` enables `Vary` handling for `Accept` on every
   canonical `GET` and `HEAD`, with only `text/html` and `text/markdown`
   normalization. It covers HTML requests as well as exact Markdown requests so
   the first cached representation cannot become a shared, non-varying entry.
4. `http_response_headers_transform` sets the selected response to
   `text/markdown; charset=utf-8` and returns `Vary: Accept`.

Cloudflare evaluates cache variance from the origin response. The public builds
therefore generate `Vary: Accept` for every catalogue-owned canonical HTML path
and the explicit `/*.md` artifacts in their Pages `_headers` files. The response
transform keeps the selected client response explicit; it does not replace the
origin header required by the Cache Rule.

The exact catalogue membership leaves `.md` URLs, assets, `llms.txt`,
`llms-full.txt`, other machine resources, and unknown paths outside the rules.
Marketing canonical paths omit a trailing slash. Documentation section indexes
require one. Query strings pass through redirects and path-only rewrites.

## Credentials

For inspection, create a temporary API token restricted to these two zones with
only Dynamic URL Redirects Read, Zone Transform Rules Read, and Cache Settings
Read. For apply or rollback, replace those with the three matching Write
permissions. Supply the token and exact zone IDs in the operator shell:

```sh
export OPENPOST_CLOUDFLARE_EDGE_API_TOKEN='...'
export OPENPOST_CLOUDFLARE_MARKETING_ZONE_ID='...'
export OPENPOST_CLOUDFLARE_DOCUMENTATION_ZONE_ID='...'
```

Do not put these values in repository files, shell history, CI variables used
by ordinary builds, command arguments, or evidence. Revoke the temporary token
after the operation. The commands report logical zone names and environment
variable names, never token or zone-ID values.

## Inspect and apply

Inspection performs only Rulesets API `GET` requests:

```sh
bun scripts/cloudflare-edge-plan.mjs inspect > /tmp/openpost-edge-inspection.json
```

Review every current and desired phase. Exit status `2` means an unmanaged rule
occupies a phase owned by this plan. Resolve that ownership explicitly; apply
stops on every reported conflict.

Render again immediately before applying and copy its digest. Use a new,
operator-owned evidence directory:

```sh
bun scripts/cloudflare-edge-plan.mjs apply \
  --confirm 'sha256:REVIEWED_DIGEST' \
  --evidence /secure/operator-evidence/openpost-edge-YYYYMMDD
```

Apply validates the plan before inspection, captures `before.json`, re-reads all
eight phase entry points before the first write, and compares each changed phase
again immediately before its update. Any new rule or version stops the apply.
It writes each phase's complete mutable description and rule list. Stable rule refs make
an unchanged apply a no-op. It records `after.json`, checks that every phase now
matches the reviewed plan, and writes a reviewable `rollback-plan.json`. If a
later phase update or the final inspection fails, it checks each applied phase
before restoring it and records `failure.json`. Recovery skips a phase that no
longer matches the applied state so it cannot overwrite concurrent operator
work. Treat every skipped restore or API error as an incident and use the
captured evidence to reconcile the current state before choosing a next step.

## Roll back

Read the complete rollback file before execution. Confirm its own digest, not
the forward-plan digest:

```sh
bun scripts/cloudflare-edge-plan.mjs rollback \
  --file /secure/operator-evidence/openpost-edge-YYYYMMDD/rollback-plan.json \
  --confirm 'sha256:REVIEWED_ROLLBACK_DIGEST'
```

The rollback file contains only phases changed by apply. Before any write, the
command checks that every phase still matches its captured applied state. It
checks each phase's version again immediately before restoring it. Any later
operator change stops rollback instead of overwriting that work. If a phase did
not exist before apply, rollback restores an empty phase entry point. Inspect
again and retain the before, after, rollback, command output, and
exact repository revision in the private operator record.

## Live acceptance

Use Cloudflare Trace for both hosts before enabling traffic and after apply.
Confirm the Single Redirect runs before URL Rewrite, Cache Rules see the
canonical request and `Accept`, and response-header transformation occurs after
cache configuration. Then check:

- canonical HTML `GET` and `HEAD` stay HTML for missing, mixed, weighted,
  wildcard, parameterized, repeated, or non-Markdown `Accept` values;
- exactly `Accept: text/markdown` selects the corresponding checked-in `.md`
  artifact without changing the visible canonical URL;
- trailing-slash redirects preserve query strings, and explicit `.md`, assets,
  machine resources, and unknown paths do not redirect or rewrite;
- first HTML and Markdown requests create separate cache entries, then repeated
  requests hit the matching representation without crossing content types.

Cloudflare Trace is the rule-order evidence. Response headers and repeated
requests are the cache-order evidence. Record both hosts, `GET` and `HEAD`, one
ordinary page, the root, and one documentation section index.

Review Cloudflare AI Crawl Control within 24 hours of the first apply and within
24 hours of every later edge-plan or crawler-policy change. Record whether
verified AI crawlers receive the intended public access, whether any crawler is
blocked or allowed, and the next named owner and review time. AI Crawl Control
does not replace the route, representation, cache, or Trace checks above.
