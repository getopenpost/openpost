#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  pnpm release:prod "feat: describe shipped change"
  scripts/release-prod.sh "fix: describe shipped change"

Stages all OpenPost changes, commits them if needed, pushes main, creates the
next SemVer tag from Conventional Commits, and waits for GitHub Build and
Release to deploy rgo-vps.

Environment:
  COMMIT_MESSAGE   Commit message when no positional message is passed.
  PUBLIC_READY_URL Public readiness URL. Default: https://app.openpost.social/api/v1/ready
  BRANCH           Branch to push. Default: current branch
  RELEASE_WORKFLOW GitHub Actions workflow name. Default: Build and Release
  RELEASE_BUMP     Raise the inferred bump: minor or major
  RELEASE_VERSION  Use an exact greater stable version, for version-line corrections
USAGE
}

die() {
  printf 'release-prod: %s\n' "$*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

run() {
  printf '\n==> %s\n' "$*"
  "$@"
}

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

need git
need gh
need jq
need curl
need node

commit_message="${1:-${COMMIT_MESSAGE:-}}"
public_ready_url="${PUBLIC_READY_URL:-https://app.openpost.social/api/v1/ready}"
release_workflow="${RELEASE_WORKFLOW:-Build and Release}"
branch="${BRANCH:-$(git branch --show-current)}"

[[ -n "$branch" ]] || die "could not determine current branch"
[[ "$branch" == "main" ]] || die "refusing to release from '$branch'; set BRANCH=$branch if this is intentional"

run git fetch origin "$branch" --tags

repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
latest_tag="$(git tag --list 'v*' --sort=-v:refname | head -n 1)"
[[ -n "$latest_tag" ]] || die "no v* tags found"

if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  [[ -n "$commit_message" ]] || die "uncommitted changes need a commit message"
  run git add -A
  run git commit -m "$commit_message"
else
  printf 'release-prod: no uncommitted OpenPost changes to commit\n'
fi

head_tag="$(git tag --points-at HEAD --list 'v*' --sort=-v:refname | head -n 1)"
create_tag=false
if [[ -n "$head_tag" ]]; then
  tag="$head_tag"
  printf 'release-prod: HEAD is already tagged as %s\n' "$tag"
else
  latest_tag="$(git tag --list 'v*' --sort=-v:refname | head -n 1)"
  tag="$(node scripts/next-release-version.mjs "$latest_tag")"
  printf 'release-prod: %s -> %s\n' "$latest_tag" "$tag"
  create_tag=true
fi

run git push origin "$branch"

if [[ "$create_tag" == true ]]; then
  run git tag "$tag"
fi

if git ls-remote --exit-code --tags origin "refs/tags/${tag}" >/dev/null 2>&1; then
  printf 'release-prod: tag %s already exists on origin\n' "$tag"
else
  run git push origin "$tag"
fi

printf '\n==> Waiting for GitHub release workflow for %s\n' "$tag"
run_id=""
for _ in $(seq 1 60); do
  run_json="$(
    gh run list \
      --repo "$repo" \
      --workflow "$release_workflow" \
      --limit 20 \
      --json databaseId,headBranch,headSha,status,conclusion,url \
      | jq -r --arg tag "$tag" '.[] | select(.headBranch == $tag) | @json' \
      | head -n 1
  )"
  if [[ -n "$run_json" ]]; then
    run_id="$(jq -r .databaseId <<<"$run_json")"
    break
  fi
  sleep 5
done

[[ -n "$run_id" ]] || die "release workflow did not appear for $tag"
run gh run watch "$run_id" --repo "$repo" --exit-status || {
  gh run view "$run_id" --repo "$repo" --json url,conclusion,jobs
  die "release workflow failed for $tag; fix forward with a new SemVer tag"
}

release_url="$(gh release view "$tag" --repo "$repo" --json url --jq .url)"
printf '\n==> Release published: %s\n' "$release_url"

printf '\n==> Checking public readiness\n'
curl -fsS "$public_ready_url"
printf '\n\nrelease-prod: shipped %s to prod\n' "$tag"
