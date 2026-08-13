#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

warning_count=0

warn() {
  printf 'WARN  %s\n' "$*"
  warning_count=$((warning_count + 1))
}

pass() {
  printf 'OK    %s\n' "$*"
}

printf 'OpenPost development doctor\n\n'

available_kb="$(df -Pk "$repo_root" | awk 'NR == 2 { print $4 }')"
available_gb=$((available_kb / 1024 / 1024))
if ((available_kb < 10 * 1024 * 1024)); then
  warn "Only ${available_gb} GiB is free; long verification and release work should start with at least 10 GiB."
else
  pass "${available_gb} GiB of disk space is free."
fi

status="$(git status --short)"
if [[ -n "$status" ]]; then
  changed_count="$(printf '%s\n' "$status" | wc -l | tr -d ' ')"
  warn "The worktree has ${changed_count} changed or untracked path(s); audit them before staging or releasing."
else
  pass "The worktree is clean."
fi

branch="$(git branch --show-current)"
if upstream="$(git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null)"; then
  read -r ahead behind < <(git rev-list --left-right --count "HEAD...${upstream}")
  if ((ahead > 0 || behind > 0)); then
    warn "${branch:-detached HEAD} is ${ahead} commit(s) ahead and ${behind} behind ${upstream}."
  else
    pass "${branch:-detached HEAD} matches ${upstream}."
  fi
else
  warn "${branch:-detached HEAD} has no configured upstream."
fi

worktree_paths="$(git worktree list --porcelain | awk '/^worktree / { print substr($0, 10) }')"
worktree_count="$(printf '%s\n' "$worktree_paths" | awk 'NF { count++ } END { print count + 0 }')"
if ((worktree_count > 1)); then
  warn "${worktree_count} linked worktrees are registered; remove completed temporary worktrees after verifying their branches."
  printf '%s\n' "$worktree_paths" | sed 's/^/      /'
else
  pass "No extra linked worktrees are registered."
fi

prunable_worktrees="$(git worktree prune --dry-run --verbose 2>&1 || true)"
if [[ -n "$prunable_worktrees" ]]; then
  warn "Prunable worktree metadata exists:"
  printf '%s\n' "$prunable_worktrees" | sed 's/^/      /'
fi

common_git_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
shared_root="$(dirname "$common_git_dir")"
shared_state="${shared_root}/.devenv/state"
pass "Linked worktree dependency caches resolve to ${shared_state}."

if browser_path="$(
  bun --eval \
    'import { chromium } from "@playwright/test"; process.stdout.write(chromium.executablePath())' \
    2>/dev/null
)"; then
  if [[ -x "$browser_path" ]]; then
    pass "Pinned Playwright Chromium is installed."
  else
    warn "Pinned Playwright Chromium is missing; run devenv shell -- install."
  fi
else
  warn "Playwright is unavailable; run devenv shell -- install."
fi

for command in devenv go bun git; do
  if command -v "$command" >/dev/null 2>&1; then
    pass "$command is available."
  else
    warn "$command is unavailable."
  fi
done

printf '\n'
if ((warning_count > 0)); then
  printf 'Doctor finished with %d warning(s).\n' "$warning_count"
else
  printf 'Doctor finished cleanly.\n'
fi
