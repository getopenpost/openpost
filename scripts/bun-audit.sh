#!/usr/bin/env bash
set -euo pipefail

# Bun 1.3.11 includes workspace devDependencies in a production audit. These
# reviewed advisories are confined to the docs/dev-server, lint, i18n, and
# Android asset-generation toolchains; none of those packages ship in the Go
# image or static sites. Keep the exceptions explicit so every new advisory
# still fails the release gate, and remove them as the upstream tools move to
# patched major versions.
bun audit --prod --audit-level low \
  --ignore GHSA-3ppc-4f35-3m26 \
  --ignore GHSA-7r86-cg39-jmmj \
  --ignore GHSA-23c5-xmqv-rm74 \
  --ignore GHSA-mh99-v99m-4gvg \
  --ignore GHSA-rgw5-rvv9-x895 \
  --ignore GHSA-3jxr-9vmj-r5cp \
  --ignore GHSA-v6wh-96g9-6wx3 \
  --ignore GHSA-4w7w-66w2-5vf9 \
  --ignore GHSA-fx2h-pf6j-xcff \
  --ignore GHSA-67mh-4wv8-2f99 \
  --ignore GHSA-w5hq-g745-h8pq
