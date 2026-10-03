#!/usr/bin/env bash
set -euo pipefail

# Bun 1.3.11 includes workspace devDependencies in a production audit. These
# reviewed advisories are confined to the docs/dev-server, lint, i18n, n8n
# development, and Android asset-generation toolchains; none of those packages
# ship in the Go image, static sites, or n8n package. Keep the exceptions
# explicit so every new advisory still fails the release gate, and remove them
# as the upstream tools move to patched major versions.
# GHSA-vwc7-r8mq-g2x9 has no patched adm-zip release. It is used only by
# onnxruntime-node's native binary installer; browser Transformers uses its web
# export, and the production Go image contains no Node packages or installer.
# Remove this exception when adm-zip publishes a fix.
# The advisory endpoint occasionally times out from CI runners; retry a
# few times before failing the gate.
# GHSA-vfj7-8cjw-p6xm has no patched npm release. Permit only the exact
# upstream depth-bound patch, verified across every installed Braces copy.
# Remove this admission when a fixed upstream release replaces the patch.
bun "$(dirname "${BASH_SOURCE[0]}")/check-braces-security-patch.mjs"
attempt=1
while [ "$attempt" -le 3 ]; do
  if bun audit --prod --audit-level low \
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
  --ignore GHSA-w5hq-g745-h8pq \
  --ignore GHSA-528h-pc64-c93x \
  --ignore GHSA-vwc7-r8mq-g2x9 \
  --ignore GHSA-vfj7-8cjw-p6xm
  then
    break
  fi
  attempt=$((attempt + 1))
  sleep 15
done
[ "$attempt" -le 3 ]
