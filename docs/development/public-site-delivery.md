# Public-site artifact delivery

Marketing owns `/` and documentation owns `/docs`. The public artifact contract
job composes their canonical outputs, builds only a missing component, and seals
one candidate before running the independent rebuild and route proofs. Successful
main pushes and complete stable-tag qualification retain `public-site-qualified-SHA-ATTEMPT` for 90 days.

The public-site delivery workflow consumes that exact artifact after successful
main or stable-tag CI whose source is on main. It checks repository, workflow, event, source, producer attempt and
configuration identity. Partial reruns may reuse a prior successful producer;
a newer failed producer cannot be hidden by an older artifact. A CI run without a
public candidate has nothing to deploy.

Release bookkeeping changes only `CHANGELOG.md` and consumed fragments, so CI
skips it. Delivery builds that exact recording commit through the existing public
build graph, preserving revision metadata. Recording-only pushes check all output
contracts once; independent forced rebuilds remain in core CI and manual
qualification, where compiler or generator changes can occur. Mixed code/content pushes use CI's
producer instead. The generated OpenAPI, media limits and CLI reference share a
content-addressed cache that validates every restored output. Generator source,
configuration, module inputs, toolchain and actual Go/embed dependencies invalidate
it. Deployment run IDs and revisions do not enter these version-independent
generators. Runtime artifact revisions remain part of their build inputs.

## Configuration and cutover

Provision repository secret `CLOUDFLARE_API_TOKEN` with Pages Edit for the owning
account, and variable `CLOUDFLARE_ACCOUNT_ID`. The token belongs only to the deploy
job. Public PostHog configuration and source-map settings must match the producer;
secret values never enter manifests. Missing or changed configuration fails closed.

Automatic delivery is enabled by repository variable
`OPENPOST_PUBLIC_SITE_DELIVERY_ENABLED=true`. Keep it disabled until preview,
browser symbolication, production and rollback checks pass. Disable Cloudflare's
automatic Git builds after cutover so hosting uploads CI's bytes without rebuilding.
Cloudflare documents this workflow for existing
[Git-integrated projects](https://developers.cloudflare.com/pages/configuration/git-integration/).

Dispatch `Public site delivery` on main with `delivery=preview` to qualify and
upload an immutable preview. `delivery=production` publishes those same retained
bytes to the production branch. `delivery=retain` only retains them. The consumer
verifies all file hashes and never installs or compiles the product. HTTP proof
checks representative marketing, docs, changelog, discovery and asset boundaries;
it does not download thousands of unchanged assets. Use the existing
`public-deployment-proof.mjs` operational acceptance for full header, redirect and
Cloudflare deployment metadata proof.

Production delivery rejects an artifact older than, or unrelated to, the current
production revision. Delivery runs serialize. An explicit rollback bypasses the
ancestry check but preserves all integrity and configuration checks.

## Rollback

Record the successful delivery run ID, original full source SHA and manifest
digest. Dispatch with all three `rollback_run`, `rollback_source` and
`rollback_digest`, plus `delivery=preview` or `production`. The workflow downloads
that run's retained artifact without rebuilding, verifies its trusted workflow
provenance, source, digest and current configuration, then uploads and checks it.
Expired artifacts or incompatible configuration require a newly qualified build.
Rollback restores the original content, including its changelog.

## Release scheduling

When tag CI cannot reuse completed qualification, its plan enables all core gates.
A separate job then cancels only active main push CI for the identical SHA in the
same workflow. Stable tag CI owns the replacement public candidate and delivery
accepts it only after successful complete qualification and a main-ancestry check.
Prerelease tags do not cancel main work. PRs, other sources, manual audits and unrelated workflows remain
independent. Tag qualification remains complete; this removes competition between
two copies of the same work rather than reducing coverage.
