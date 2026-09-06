#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

mode="worktree"
hook_mode=0
case "$(basename "$0")" in
  pre-commit)
    mode="staged"
    hook_mode=1
    ;;
  pre-push)
    mode="pushed-range"
    hook_mode=1
    ;;
esac

if [ "$hook_mode" -eq 0 ] && [ "$#" -gt 1 ]; then
  echo "Usage: scripts/changed-files-check.sh [--worktree|--staged|--pushed-range]" >&2
  exit 2
fi
if [ "$hook_mode" -eq 0 ] && [ "$#" -eq 1 ]; then
  case "$1" in
    --worktree) mode="worktree" ;;
    --staged) mode="staged" ;;
    --pushed-range) mode="pushed-range" ;;
    *)
      echo "Usage: scripts/changed-files-check.sh [--worktree|--staged|--pushed-range]" >&2
      exit 2
      ;;
  esac
fi

declare -A seen=()
declare -a files=() ranges=()
declare -a go_files=() shell_files=() nix_files=()
declare -a root_format=() frontend_format=() marketing_format=()

add_file() {
  local file="$1"
  [ -n "$file" ] || return
  [ -f "$file" ] || return
  [ -z "${seen[$file]+x}" ] || return 0
  seen["$file"]=1
  files+=("$file")
}

push_lines=""
if [ "$mode" = "pushed-range" ]; then
  push_lines="$(cat)"

  if [ "${OPENPOST_SKIP_PUSH_CHECK:-0}" = "1" ]; then
    echo "changed-files-check: push check skipped (OPENPOST_SKIP_PUSH_CHECK=1)"
    exit 0
  fi

  saw_ref=0
  tag_only=1
  deletion_only=1
  while IFS=" " read -r local_ref local_sha remote_ref remote_sha ||
    [ -n "$local_ref$local_sha$remote_ref$remote_sha" ]; do
    [ -n "$local_ref$local_sha$remote_ref$remote_sha" ] || continue
    saw_ref=1
    case "$remote_ref" in
      refs/tags/*) ;;
      *) tag_only=0 ;;
    esac
    [ "$local_sha" = "0000000000000000000000000000000000000000" ] || deletion_only=0
  done <<< "$push_lines"

  if [ "$saw_ref" -eq 1 ] && [ "$tag_only" -eq 1 ]; then
    echo "changed-files-check: tag push detected, skipping (CI already gated)"
    exit 0
  fi
  if [ "$saw_ref" -eq 1 ] && [ "$deletion_only" -eq 1 ]; then
    echo "changed-files-check: deletion-only push detected, skipping"
    exit 0
  fi
fi

case "$mode" in
  worktree)
    while IFS= read -r -d '' file; do add_file "$file"; done < <(
      git diff --name-only --diff-filter=ACMR -z
      git diff --cached --name-only --diff-filter=ACMR -z
      git ls-files --others --exclude-standard -z
    )
    ;;
  staged)
    while IFS= read -r -d '' file; do add_file "$file"; done < <(
      git diff --cached --name-only --diff-filter=ACMR -z
    )
    ;;
  pushed-range)
    zero="0000000000000000000000000000000000000000"
    while IFS=" " read -r local_ref local_sha remote_ref remote_sha ||
      [ -n "$local_ref$local_sha$remote_ref$remote_sha" ]; do
      [ -n "$local_ref$local_sha$remote_ref$remote_sha" ] || continue
      [ "$local_sha" != "$zero" ] || continue
      if [ "$remote_sha" = "$zero" ]; then
        base="$(git merge-base "$local_sha" origin/main 2>/dev/null || git rev-list --max-parents=0 "$local_sha" | tail -1)"
        range="$base..$local_sha"
      else
        range="$remote_sha..$local_sha"
      fi
      ranges+=("$range")
      while IFS= read -r -d '' file; do add_file "$file"; done < <(
        git diff --name-only --diff-filter=ACMR -z "$range"
      )
    done <<< "$push_lines"
    ;;
esac

if [ "${#files[@]}" -eq 0 ]; then
  echo "changed-files-check: no changed files"
  exit 0
fi

case "$mode" in
  worktree)
    git diff --check
    git diff --cached --check
    ;;
  staged) git diff --cached --check ;;
  pushed-range)
    for range in "${ranges[@]}"; do
      git diff --check "$range"
    done
    ;;
esac

for file in "${files[@]}"; do
  if LC_ALL=C grep -nE '^(<<<<<<<|=======|>>>>>>>)' "$file" >/dev/null; then
    echo "changed-files-check: unresolved conflict marker in $file" >&2
    exit 1
  fi

  case "$file" in
    *.go) go_files+=("$file") ;;
    *.sh) shell_files+=("$file") ;;
    *.nix) nix_files+=("$file") ;;
  esac

  case "$file" in
    apps/web/*)
      case "$file" in
        *.js | *.mjs | *.cjs | *.ts | *.svelte | *.json | *.css | *.md | *.yml | *.yaml)
          frontend_format+=("${file#apps/web/}")
          ;;
      esac
      ;;
    apps/marketing/*)
      case "$file" in
        *.js | *.mjs | *.cjs | *.ts | *.svelte | *.json | *.css | *.md | *.yml | *.yaml)
          marketing_format+=("$file")
          ;;
      esac
      ;;
    *.js | *.mjs | *.cjs | *.ts | *.svelte | *.json | *.css | *.md | *.yml | *.yaml)
      root_format+=("$file")
      ;;
  esac
done

jobs=()
if [ "${#go_files[@]}" -gt 0 ]; then
  (unformatted="$(gofmt -l "${go_files[@]}")"; [ -z "$unformatted" ] || { printf '%s\n' "$unformatted"; exit 1; }) &
  jobs+=("$!")
fi
if [ "${#shell_files[@]}" -gt 0 ]; then
  (bash -n "${shell_files[@]}") &
  jobs+=("$!")
fi
if [ "${#nix_files[@]}" -gt 0 ]; then
  (nix-instantiate --parse "${nix_files[@]}" >/dev/null) &
  jobs+=("$!")
fi
if [ "${#root_format[@]}" -gt 0 ]; then
  (bunx oxfmt --check "${root_format[@]}") &
  jobs+=("$!")
fi
if [ "${#frontend_format[@]}" -gt 0 ]; then
  (cd apps/web && bunx oxfmt --check "${frontend_format[@]}") &
  jobs+=("$!")
fi
if [ "${#marketing_format[@]}" -gt 0 ]; then
  (cd apps/marketing && bunx oxfmt --check "${marketing_format[@]#apps/marketing/}") &
  jobs+=("$!")
fi

failed=0
for job in "${jobs[@]}"; do
  wait "$job" || failed=1
done
if [ "$failed" -ne 0 ]; then
  if [ "$mode" = "pushed-range" ]; then
    echo "" >&2
    echo "changed-files-check: FAILED. Fix the issues above, then push again." >&2
    echo "Bypass with: OPENPOST_SKIP_PUSH_CHECK=1 git push" >&2
  fi
  exit 1
fi

echo "changed-files-check: OK (${#files[@]} changed files)"
