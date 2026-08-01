#!/usr/bin/env bash

set -euo pipefail

readonly max_attempts=4

for ((attempt = 1; attempt <= max_attempts; attempt++)); do
  if nix-env --quiet -j8 -iA cachix -f https://cachix.org/api/v1/install; then
    exit 0
  fi

  if ((attempt == max_attempts)); then
    echo "::error::Cachix installation failed after ${max_attempts} attempts."
    exit 1
  fi

  delay_seconds=$((attempt * 5))
  echo "::warning::Cachix installation attempt ${attempt} failed; retrying in ${delay_seconds} seconds."
  sleep "${delay_seconds}"
done
