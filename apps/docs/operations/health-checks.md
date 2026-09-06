# Health Checks

OpenPost exposes separate liveness and readiness endpoints.

## Liveness

```txt
GET /api/v1/health
```

Expected response:

```json
{ "status": "ok" }
```

Use this endpoint when you only need to know whether the HTTP process is alive. The published image's OCI health check and the maintained Compose file use it so a database outage does not turn into a container restart loop.

Docker Engine records this result as container health. The Compose `restart: unless-stopped` policy reacts when the process exits; it does not restart a running container solely because the health check reports `unhealthy`. An orchestrator or external watchdog may choose to act on that state.

## Readiness

```txt
GET /api/v1/ready
```

Expected response:

```json
{ "status": "ready", "database": "ok" }
```

An S3-backed instance also reports its required object store:

```json
{ "status": "ready", "database": "ok", "storage": "ok" }
```

Use this endpoint for load-balancer traffic admission, deploy rollouts, and external uptime probes that should fail when a required data-plane dependency is unavailable. It returns `503` when OpenPost cannot run a database probe or the configured S3 bucket fails its bounded capability check.

Compose does not remove traffic when readiness fails by itself. Configure the reverse proxy, load balancer, deploy hook, or monitor that owns traffic to call this endpoint.

For Kubernetes-style orchestration, use `/api/v1/health` as the liveness probe and `/api/v1/ready` as the readiness probe. A failed liveness probe may restart the process. A failed readiness probe should stop new traffic without assuming that a restart can repair the database dependency.

## CLI check

The CLI can check the same public instance from an operator shell:

```bash
openpost instance health
```

Use this for deploy validation and operator smoke checks. The command checks
both liveness and readiness, and exits non-zero if either probe fails.

For remote scripts, point the active CLI profile at the public app URL first:

```bash
openpost instance add production https://app.openpost.example
openpost instance use production
openpost instance health --json
```

You can also avoid saved state and pass the instance URL directly:

```bash
openpost instance health --instance https://app.openpost.example --json
```

The JSON output is useful for logs and monitors because it includes the checked
instance URL, liveness result, readiness result, and database readiness status.

For support snapshots, use diagnostics:

```bash
openpost instance diagnostics \
  --instance https://app.openpost.example \
  --deployment docker-compose \
  --provider youtube \
  --logs-file ./openpost.log \
  --json
```

Diagnostics includes the CLI version, OS/architecture, profile, instance URL,
config paths, liveness/readiness/database status, token presence/source, and
authenticated user/workspace counts when a token is available. With a token, it
also includes account-provider readiness counts, the requested provider status
when `--provider` is set, and billing plan/usage state for the active workspace
when one is selected. Optional `--deployment`, `--provider`, and `--logs-file`
fields capture the deployment method, provider being tested, and a redacted
last-100-line log tail. It never prints raw API tokens or server secrets.

## Recommended probes

- Container or orchestrator liveness: `GET /api/v1/health`
- Load-balancer traffic readiness: `GET /api/v1/ready`
- Deploy rollout readiness: `GET /api/v1/ready`
- External uptime monitor: `GET /api/v1/ready`
- Operator smoke from a shell: `openpost instance health`
- Support snapshot from a shell: `openpost instance diagnostics --deployment <method> --provider <provider> --logs-file <path> --json`
- Mobile app instance setup: the app validates `/api/v1/ready` before saving the instance URL.
