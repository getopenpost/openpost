# Container Image Support and Assurance

The published OpenPost container image supports **`linux/amd64` only**. The CI candidate build names that platform explicitly and restart-smokes that same image before it can be published. The maintained Dockerfile rejects non-amd64 targets. An ARM64 host must use amd64 emulation; a native ARM64 image requires an explicit downstream Dockerfile/source change and its own complete runtime smoke proof. OpenPost does not currently publish or claim support for a `linux/arm64` image.

This limit applies to the container image, not every release artifact. See [Single Binary](/installation/binary) and [CLI Installation](/cli/installation) for the architectures available for those artifacts.

## Runtime base

[`docker/image-policy.json`](https://github.com/rodrgds/openpost/blob/main/docker/image-policy.json) records the exact Go backend-builder and runtime base references, the runtime support review, the supported image platform, probe paths, and scanner versions. CI builds the canonical frontend once with the repository-pinned Bun and Node versions, tests and retains that directory, then supplies those exact bytes to the Dockerfile as a named BuildKit context. The Dockerfile pins its remaining image inputs by digest and labels the final image with its shipped Alpine base identity.

Alpine's [release-branch table](https://www.alpinelinux.org/releases/) is the source for support dates. Dependabot checks the Docker directory every week. A maintainer still reviews each update, updates the policy record when the base identity changes, and requires the complete candidate image gate before merge or release.

## Candidate evidence

Candidate CI performs these checks against the final `linux/amd64` image:

- starts OpenPost on a clean persistent database volume;
- checks `/api/v1/health`, database-backed `/api/v1/ready`, and the image's OCI health status before and after a container restart;
- runs SQLite plus a small FFmpeg/FFprobe media operation inside the runtime image;
- verifies the embedded release manifest, OCI version, and exact revision;
- generates an SPDX JSON software bill of materials (SBOM);
- records the full final-image vulnerability report, including lower-severity and currently unfixed findings, with the scanner version pinned in the image policy;
- separately blocks fixable `HIGH` and `CRITICAL` findings.

CI retains the manifest, SBOM, and full report as a diagnostic artifact before the blocking scan, so maintainers can inspect a failed vulnerability gate without publishing the image. After a successful gate, the candidate artifact binds the registry digest to hashes of the exact release manifest, SPDX SBOM, and full JSON scan report. The tag workflow pulls that recorded digest rather than resolving the mutable SHA tag again. The release manifest, digest evidence, SBOM, and report are attached to the GitHub release draft. They become public only after every release artifact is present and image promotion, deployment, and hosted readiness have succeeded. A successful gate is evidence for that exact image and scanner database at that time. It is not a claim that the image has no vulnerabilities: the report retains non-blocking findings, and the gate does not fail on findings that the scanner marks as having no available fix.

## Probe ownership

The image's OCI health check calls `/api/v1/health`. This proves that the HTTP process is alive without turning a database outage into a container restart loop. Traffic gates, deployment rollouts, and dependency-aware monitors call `/api/v1/ready`, which returns `503` when the database probe fails. See [Health Checks](/operations/health-checks) for the complete operator policy.

## Updating the policy

When the runtime base or scanner changes:

1. Check the upstream lifecycle and release notes.
2. Update the exact Dockerfile reference and `docker/image-policy.json` together.
3. Run `bun run check:image-policy` and the normal repository checks.
4. Build and restart-smoke the production image on the declared platform.
5. Require candidate CI to generate the SBOM and pass the final-image scan before publishing.

Do not describe a routine base update as an exploit remediation unless a specific exploitable condition has been established.
