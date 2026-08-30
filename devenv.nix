{
  pkgs,
  config,
  lib,
  ...
}:

{
  dotenv.enable = true;

  packages = [
    pkgs.git
    pkgs.curl
    pkgs.jq
    pkgs.ripgrep
    pkgs.sqlite
    pkgs.ffmpeg
    pkgs.wget
    pkgs.docker
    pkgs.actionlint
    pkgs.gitleaks
  ];

  # Keep dependency/build caches with the checkout so a durable NAS clone can
  # be resumed after a Hermes reboot without relying on /tmp or global state.
  # enterShell remaps linked worktrees to the primary checkout's same state
  # directory so temporary worktrees do not duplicate multi-gigabyte caches.
  env.GOCACHE = "${config.git.root}/.devenv/state/go-build";
  env.GOMODCACHE = "${config.git.root}/.devenv/state/go-mod";
  # The module files pin the security-patched Go point release. Let the go
  # command fetch that toolchain when nixpkgs trails the upstream patch.
  env.GOTOOLCHAIN = lib.mkForce "auto";
  env.BUN_INSTALL_CACHE_DIR = "${config.git.root}/.devenv/state/bun-cache";

  scripts = {
    clean.exec = ''
      cd "${config.git.root}"
      rm -rf backend/openpost frontend/.svelte-kit
      rm -f backend/*.db
    '';

    install.exec = ''
      cd "${config.git.root}"
      bun install --frozen-lockfile
      bun run browser:install
      (cd backend && go mod download)
      (cd cli && go mod download)
    '';

    cache-status.exec = ''
      echo "Go build cache: $GOCACHE"
      du -sh "$GOCACHE" 2>/dev/null || true

      echo "Go module cache: $GOMODCACHE"
      du -sh "$GOMODCACHE" 2>/dev/null || true

      echo "Bun package cache: $BUN_INSTALL_CACHE_DIR"
      du -sh "$BUN_INSTALL_CACHE_DIR" 2>/dev/null || true

      turbo_cache_dir="''${OPENPOST_TURBO_CACHE_DIR:-''${XDG_CACHE_HOME:-$HOME/.cache}/openpost/turbo}"
      echo "Turbo task cache: $turbo_cache_dir"
      du -sh "$turbo_cache_dir" 2>/dev/null || true

      echo "Embedded frontend: ${config.git.root}/backend/cmd/openpost/public"
      du -sh "${config.git.root}/backend/cmd/openpost/public" 2>/dev/null || true
    '';

    cache-prune.exec = ''
      cd "${config.git.root}"
      bun scripts/turbo-cache.mjs prune

      max_mib="''${OPENPOST_GO_CACHE_MAX_MIB:-4096}"
      if ! [[ "$max_mib" =~ ^[1-9][0-9]*$ ]]; then
        echo "OPENPOST_GO_CACHE_MAX_MIB must be a positive integer; received: $max_mib" >&2
        exit 1
      fi

      state_dir="$(dirname "$GOCACHE")"
      stamp="$state_dir/go-cache-size-check.timestamp"
      now="$(date +%s)"
      last="$(cat "$stamp" 2>/dev/null || echo 0)"

      # Scanning a very large cache is itself expensive, so check at most once
      # per day unless OPENPOST_GO_CACHE_FORCE_CHECK=1 is set.
      if [ "''${OPENPOST_GO_CACHE_FORCE_CHECK:-0}" != 1 ] && (( now - last < 86400 )); then
        exit 0
      fi

      mkdir -p "$state_dir"
      size_mib="$(du -sm "$GOCACHE" 2>/dev/null | cut -f1 || echo 0)"
      if (( size_mib > max_mib )); then
        echo "Go build cache is ''${size_mib} MiB; maximum is ''${max_mib} MiB."
        echo "Pruning Go build cache..."
        go clean -cache
      fi
      printf '%s\n' "$now" > "$stamp"
    '';

    docker-cache-status.exec = ''
      docker system df
    '';

    docker-cache-prune.exec = ''
      maximum="''${OPENPOST_DOCKER_CACHE_MAX_STORAGE:-20gb}"
      minimum_free="''${OPENPOST_DOCKER_MIN_FREE_SPACE:-20gb}"
      docker buildx prune --all --force \
        --max-used-space "$maximum" \
        --min-free-space "$minimum_free"
    '';

    setup.exec = ''
      cd "${config.git.root}"
      install
      if (umask 077; set -o noclobber; cat backend/.env.example > backend/.env) 2>/dev/null; then
        echo "Created backend/.env; edit it with local credentials as needed"
      else
        echo "backend/.env already exists; left unchanged"
      fi
    '';

    docker-build.exec = ''
      cd "${config.git.root}"
      image_platform="$(jq -er '.supported_platforms | if length == 1 then .[0] else error("docker-build requires exactly one supported platform") end' docker/image-policy.json)"
      bun run build -- frontend
      docker build --platform "$image_platform" --build-context frontend_artifact=backend/cmd/openpost/public -t openpost:latest -f docker/Dockerfile .
    '';

    docker-run.exec = ''
      docker run -d -p 8080:8080 --name openpost openpost:latest
    '';

    doctor.exec = ''
      cd "${config.git.root}"
      bun run doctor
    '';

    secret-scan.exec = ''
      cd "${config.git.root}"
      bash scripts/scan-secrets.sh "$@"
    '';
  };

  enterShell = ''
    # Linked worktrees share the primary checkout's durable dependency caches.
    # Standalone clones still use their own .devenv/state directory.
    openpost_common_git_dir="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
    if [ -n "$openpost_common_git_dir" ]; then
      openpost_shared_root="$(dirname "$openpost_common_git_dir")"
      export GOCACHE="$openpost_shared_root/.devenv/state/go-build"
      export GOMODCACHE="$openpost_shared_root/.devenv/state/go-mod"
      export GOPATH="$openpost_shared_root/.devenv/state/go"
      export BUN_INSTALL_CACHE_DIR="$openpost_shared_root/.devenv/state/bun-cache"
    fi

    echo ""
    echo "  OpenPost Development Environment"
    echo "  --------------------------------"
    echo "  Go:     $(go version 2>/dev/null || echo 'not installed')"
    echo "  Bun:    $(bun --version 2>/dev/null || echo 'not installed')"
    echo ""
    echo "  Root tasks: bun run doctor|dev|format|format:check|lint|check|test|build|verify"
    echo "  Add -- frontend|backend|cli|marketing|docs to target one surface."
    echo ""
    echo "  Environment utilities:"
    echo "    install      - Install locked Bun and Go dependencies"
    echo "    setup        - Frozen install and create backend/.env if missing"
    echo "    cache-status - Report project cache and embedded frontend sizes"
    echo "    cache-prune  - Enforce bounded Turbo and persistent Go build caches"
    echo "    docker-cache-status - Report Docker image, volume, and build-cache sizes"
    echo "    docker-cache-prune  - Bound unused Docker build cache without deleting volumes"
    echo "    secret-scan         - Scan current files and candidate Git history for secrets"
    echo ""

    # Install tracked fast local gates. Broader verification stays explicit.
    if hooks_dir="$(git rev-parse --git-path hooks 2>/dev/null)"; then
      mkdir -p "$hooks_dir"
      source="scripts/changed-files-check.sh"
      for hook in pre-commit pre-push; do
        [ -f "$source" ] || continue
        dest="$hooks_dir/$hook"
        if [ ! -f "$dest" ] || ! cmp -s "$source" "$dest"; then
          cp "$source" "$dest" 2>/dev/null ||
            echo "  Warning: could not refresh $dest; tracked hook remains available"
        fi
        if [ -f "$dest" ] && [ ! -x "$dest" ]; then
          chmod +x "$dest" 2>/dev/null ||
            echo "  Warning: $dest exists but is not executable"
        fi
      done
    fi

    cache-prune
  '';

  enterTest = ''
    go version
    bun --version
    git --version
  '';
}
