# Container image

OpenPost publishes a **`linux/amd64`** container. ARM64 hosts need amd64 emulation. See [Single Binary](/installation/binary) and [CLI Installation](/cli/installation) for other download architectures.

## Build and security checks

The [Dockerfile](https://github.com/getopenpost/openpost/blob/main/deploy/docker/Dockerfile) owns the pinned Go and Alpine images, runtime packages, and container health check. CI supplies the frontend it already built and tested, so the image embeds the same files.

Before publishing an image, CI:

- starts OpenPost with a fresh persistent database and checks health and readiness before and after a restart;
- exercises SQLite, FFmpeg, and FFprobe inside the image;
- checks the OCI version and revision labels against the running server;
- generates an SPDX software bill of materials and a full vulnerability report;
- blocks fixable high and critical vulnerabilities.

Scan reports remain in the GitHub Actions run for 14 days. They include lower-severity and unfixed findings. A passing scan does not mean an image has no vulnerabilities.

## Releases

Tag CI builds the release image with the tag and full Git SHA. The release workflow downloads its registry digest from that successful CI run, checks its OCI labels, and promotes that digest without rebuilding. Production must report the same tag and SHA at `/api/v1/version` and pass `/api/v1/ready`.

GitHub release assets contain installable binaries and the signed Android APK. Internal build metadata and scan reports stay in Actions.

## Health and readiness

The container health check calls `/api/v1/health` to check that the HTTP process is alive. Traffic and deployment checks use the database-backed `/api/v1/ready`. See [Health Checks](/operations/health-checks).

## Updating the image

Dependabot checks the Docker directory weekly. Review Alpine's [release support dates](https://www.alpinelinux.org/releases/), update the Dockerfile, and run the image build, smoke test, and vulnerability scan. Scanner versions and severity settings live in `.github/workflows/ci.yml`.

Standalone server binaries need `ffmpeg` and `ffprobe` on the host for media operations. They are bundled in the container and supplied by Devenv for local development.
