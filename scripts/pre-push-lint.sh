#!/usr/bin/env bash
# Pre-push gate: checks formatting only for files in the pushed range.
#
# Installed automatically by devenv on shell entry. See devenv.nix
# `enterShell` and AGENTS.md for the rationale.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

push_lines="$(cat)"

is_tag_only_push() {
  local saw_ref=0
  local local_ref="" local_sha="" remote_ref="" remote_sha=""

  while IFS=" " read -r local_ref local_sha remote_ref remote_sha || [ -n "$local_ref$local_sha$remote_ref$remote_sha" ]; do
    saw_ref=1
    case "$remote_ref" in
      refs/tags/*) ;;
      *) return 1 ;;
    esac
  done <<< "$push_lines"

  [ "$saw_ref" -eq 1 ]
}

is_deletion_only_push() {
  local saw_ref=0
  local local_ref="" local_sha="" remote_ref="" remote_sha=""
  local zero="0000000000000000000000000000000000000000"
  while IFS=" " read -r local_ref local_sha remote_ref remote_sha || [ -n "$local_ref$local_sha$remote_ref$remote_sha" ]; do
    [ -n "$local_ref$local_sha$remote_ref$remote_sha" ] || continue
    saw_ref=1
    [ "$local_sha" = "$zero" ] || return 1
  done <<< "$push_lines"
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

if is_deletion_only_push; then
  echo "pre-push-lint: deletion-only push detected, skipping"
  exit 0
fi

echo "pre-push-lint: checking changed-file formatting..."

denv_lint() {
  local local_ref="" local_sha="" remote_ref="" remote_sha=""
  local zero="0000000000000000000000000000000000000000"
  local range="" file=""
  local -a changed=() go_files=() root_prettier_files=() frontend_prettier_files=() marketing_prettier_files=()

  while IFS=" " read -r local_ref local_sha remote_ref remote_sha || [ -n "$local_ref$local_sha$remote_ref$remote_sha" ]; do
    [ -n "$local_ref$local_sha$remote_ref$remote_sha" ] || continue
    [ "$local_sha" != "$zero" ] || continue
    if [ "$remote_sha" = "$zero" ]; then
      range="$(git merge-base "$local_sha" "origin/main" 2>/dev/null || git rev-list --max-parents=0 "$local_sha" | tail -1)..$local_sha"
    else
      range="$remote_sha..$local_sha"
    fi
    while IFS= read -r file; do
      [ -n "$file" ] && changed+=("$file")
    done < <(git diff --name-only --diff-filter=ACMR "$range")
  done <<< "$push_lines"

  for file in "${changed[@]-}"; do
    [ -n "$file" ] || continue
    [ -f "$file" ] || continue
    case "$file" in
      backend/*.go|backend/**/*.go|cli/*.go|cli/**/*.go) go_files+=("$file") ;;
    esac
    case "$file" in
      frontend/*)
        case "$file" in
          *.js|*.mjs|*.cjs|*.ts|*.svelte|*.json|*.css|*.md|*.yml|*.yaml)
            frontend_prettier_files+=("${file#frontend/}")
            ;;
        esac
        ;;
      marketing-site/*)
        case "$file" in
          *.js|*.mjs|*.cjs|*.ts|*.svelte|*.json|*.css|*.md|*.yml|*.yaml)
            marketing_prettier_files+=("../$file")
            ;;
        esac
        ;;
      *.js|*.mjs|*.cjs|*.ts|*.svelte|*.json|*.css|*.md|*.yml|*.yaml)
        root_prettier_files+=("$file")
        ;;
    esac
  done

  if [ -n "${go_files[*]-}" ]; then
    local unformatted
    unformatted="$(gofmt -l "${go_files[@]}")"
    [ -z "$unformatted" ] || { printf '%s\n' "$unformatted"; return 1; }
  fi
  if [ -n "${root_prettier_files[*]-}" ]; then
    bunx prettier --check "${root_prettier_files[@]}"
  fi
  if [ -n "${frontend_prettier_files[*]-}" ]; then
    (cd frontend && bunx prettier --check "${frontend_prettier_files[@]}")
  fi
  if [ -n "${marketing_prettier_files[*]-}" ]; then
    (cd frontend && bunx prettier --config .prettierrc --check "${marketing_prettier_files[@]}")
  fi
}

if ! denv_lint; then
  echo ""
  echo "pre-push-lint: FAILED. Fix the issues above, then push again."
  echo "Bypass with: OPENPOST_SKIP_PRE_PUSH_LINT=1 git push"
  exit 1
fi

echo "pre-push-lint: OK"
