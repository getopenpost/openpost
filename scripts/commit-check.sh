#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

declare -A seen=()
declare -a files=() go_files=() shell_files=() nix_files=()
declare -a root_prettier=() frontend_prettier=() marketing_prettier=()

add_file() {
  local file="$1"
  [ -n "$file" ] || return
  [ -f "$file" ] || return
  [ -z "${seen[$file]+x}" ] || return 0
  seen["$file"]=1
  files+=("$file")
}

if [ "${OPENPOST_COMMIT_CHECK_STAGED_ONLY:-0}" = 1 ]; then
  while IFS= read -r -d '' file; do add_file "$file"; done < <(
    git diff --cached --name-only --diff-filter=ACMR -z
  )
else
  while IFS= read -r -d '' file; do add_file "$file"; done < <(
    git diff --name-only --diff-filter=ACMR -z
    git diff --cached --name-only --diff-filter=ACMR -z
    git ls-files --others --exclude-standard -z
  )
fi

if [ "${#files[@]}" -eq 0 ]; then
  echo "commit-check: no changed files"
  exit 0
fi

if [ "${OPENPOST_COMMIT_CHECK_STAGED_ONLY:-0}" = 1 ]; then
  git diff --cached --check
else
  git diff --check
  git diff --cached --check
fi

for file in "${files[@]}"; do
  if LC_ALL=C grep -nE '^(<<<<<<<|=======|>>>>>>>)' "$file" >/dev/null; then
    echo "commit-check: unresolved conflict marker in $file" >&2
    exit 1
  fi

  case "$file" in
    *.go) go_files+=("$file") ;;
    *.sh) shell_files+=("$file") ;;
    *.nix) nix_files+=("$file") ;;
  esac

  case "$file" in
    frontend/*)
      case "$file" in
        *.js|*.mjs|*.cjs|*.ts|*.svelte|*.json|*.css|*.md|*.yml|*.yaml)
          frontend_prettier+=("${file#frontend/}")
          ;;
      esac
      ;;
    marketing-site/*)
      case "$file" in
        *.js|*.mjs|*.cjs|*.ts|*.svelte|*.json|*.css|*.md|*.yml|*.yaml)
          marketing_prettier+=("../$file")
          ;;
      esac
      ;;
    *.js|*.mjs|*.cjs|*.ts|*.svelte|*.json|*.css|*.md|*.yml|*.yaml)
      root_prettier+=("$file")
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
if [ "${#root_prettier[@]}" -gt 0 ]; then
  (bunx prettier --check "${root_prettier[@]}") &
  jobs+=("$!")
fi
if [ "${#frontend_prettier[@]}" -gt 0 ]; then
  (cd frontend && bunx prettier --check "${frontend_prettier[@]}") &
  jobs+=("$!")
fi
if [ "${#marketing_prettier[@]}" -gt 0 ]; then
  (cd frontend && bunx prettier --config .prettierrc --check "${marketing_prettier[@]}") &
  jobs+=("$!")
fi

failed=0
for job in "${jobs[@]}"; do
  wait "$job" || failed=1
done
[ "$failed" -eq 0 ] || exit 1

echo "commit-check: OK (${#files[@]} changed files)"
