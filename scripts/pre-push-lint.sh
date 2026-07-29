#!/usr/bin/env bash
# Pre-push gate: runs a fast local lint subset before branch pushes.
#
# This is intentionally redundant with the pre-commit hooks (which
# only fire on staged files matching the hook's `files` regex) and
# with the CI workflow. The point is to catch likely failures on the
# developer's machine without running the full check/test/build matrix
# on every push.
#
# Installed automatically by devenv on shell entry. See devenv.nix
# `enterShell` and AGENTS.md for the rationale.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

is_tag_only_push() {
  local saw_ref=0
  local local_ref="" local_sha="" remote_ref="" remote_sha=""

  while IFS=" " read -r local_ref local_sha remote_ref remote_sha || [ -n "$local_ref$local_sha$remote_ref$remote_sha" ]; do
    saw_ref=1
    case "$remote_ref" in
      refs/tags/*) ;;
      *) return 1 ;;
    esac
  done

  [ "$saw_ref" -eq 1 ]
}

# Skip when explicitly disabled. The release workflow sets this when
# pushing the tag for a release that has already been CI-gated.
if [ "${OPENPOST_SKIP_PRE_PUSH_LINT:-0}" = "1" ]; then
  echo "pre-push-lint: skipped (OPENPOST_SKIP_PRE_PUSH_LINT=1)"
  exit 0
fi

# Skip tag-only pushes: the release workflow already gated the commit
# being tagged with the same lint suite. Git passes pushed refs on stdin,
# not through the remote URL argument.
if is_tag_only_push; then
  echo "pre-push-lint: tag push detected, skipping (CI already gated)"
  exit 0
fi

echo "pre-push-lint: running fast lint gate..."

denv_lint() {
  if command -v devenv >/dev/null 2>&1; then
    devenv shell --quiet -- bash -c 'backend-format-check && backend-lint && frontend-lint'
  else
    # Fallback: run the underlying commands directly. Used when the
    # developer hasn't entered the devenv shell (e.g. CI machines).
    (
      unformatted=$(cd backend && find . -path './.devenv' -prune -o -type f -name '*.go' -exec gofmt -l {} +)
      if [ -n "$unformatted" ]; then
        echo "$unformatted"
        exit 1
      fi

      (cd backend && golangci-lint run ./...)
      pnpm --filter @openpost/web lint
    )
  fi
}

if ! denv_lint; then
  echo ""
  echo "pre-push-lint: FAILED. Fix the issues above, then push again."
  echo "Bypass with: OPENPOST_SKIP_PRE_PUSH_LINT=1 git push"
  exit 1
fi

echo "pre-push-lint: OK"
