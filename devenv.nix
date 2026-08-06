{
  pkgs,
  config,
  lib,
  ...
}:

{
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
    doctor.exec = ''
      cd "${config.git.root}"
      bash scripts/dev-doctor.sh
    '';

    app.exec = ''
      cd "${config.git.root}"
      frontend-dev &
      FRONTEND_PID=$!

      cleanup() {
        kill "$FRONTEND_PID" 2>/dev/null || true
        wait "$FRONTEND_PID" 2>/dev/null || true
      }
      trap cleanup EXIT INT TERM

      backend-run
    '';

    dev.exec = ''
      app
    '';

    docs.exec = ''
      cd "${config.git.root}"
      bun run --filter @openpost/docs docs:dev
    '';

    build.exec = ''
      cd "${config.git.root}"
      frontend-build &&
      bun run marketing:build &&
      bun run docs:build &&
      backend-build &&
      (cd cli && go build -buildvcs=false ./...)
    '';

    docs-build.exec = ''
      cd "${config.git.root}"
      bun run --filter @openpost/docs docs:build
    '';

    check.exec = ''
      cd "${config.git.root}"
      bun run check:docs &&
      bun run check:release-version &&
      bun run check:changelog &&
      bun run check:social-images &&
      bun run check:ui-consistency &&
      workflow-check &&
      frontend-check &&
      bun run --filter @openpost/site check &&
      bun run check:contracts
    '';

    lint.exec = ''
      cd "${config.git.root}"
      backend-format-check &&
      backend-lint &&
      frontend-lint &&
      (cd cli && golangci-lint run)
    '';

    test.exec = ''
      cd "${config.git.root}"
      backend-test &&
      frontend-test &&
      bun run --filter @openpost/video-project test &&
      (cd cli && go test ./...)
    '';

    verify.exec = ''
      cd "${config.git.root}"
      check && lint && test-all && build
    '';

    security.exec = ''
      cd "${config.git.root}"
      scripts/security-check.sh
    '';

    workflow-check.exec = ''
      cd "${config.git.root}"
      actionlint -color
    '';

    backend-check.exec = ''
      backend-format-check && backend-lint
    '';

    backend-verify.exec = ''
      backend-check && backend-test && backend-build
    '';

    backend-security.exec = ''
      cd "${config.git.root}/backend"
      go run golang.org/x/vuln/cmd/govulncheck@v1.6.0 -tags dev ./...
    '';

    cli-security.exec = ''
      cd "${config.git.root}/cli"
      go run golang.org/x/vuln/cmd/govulncheck@v1.6.0 ./...
    '';

    frontend-security.exec = ''
      cd "${config.git.root}"
      scripts/bun-audit.sh
    '';

    frontend-verify.exec = ''
      frontend-lint && frontend-check && frontend-test && frontend-build
    '';

    # Compatibility alias for existing local workflows.
    test-all.exec = ''
      backend-test &&
      frontend-test &&
      bun run --filter @openpost/video-project test &&
      (cd cli && go test ./...)
    '';

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

      echo "Embedded frontend: ${config.git.root}/backend/cmd/openpost/public"
      du -sh "${config.git.root}/backend/cmd/openpost/public" 2>/dev/null || true
    '';

    cache-prune.exec = ''
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
      docker build -t openpost:latest -f docker/Dockerfile .
    '';

    docker-run.exec = ''
      docker run -d -p 8080:8080 --name openpost openpost:latest
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
    echo "  Commands:"
    echo "    doctor       - Check disk, worktrees, Git, browser, and tool readiness"
    echo "    install      - Install locked Bun and Go dependencies"
    echo "    setup        - Frozen install and create backend/.env if missing"
    echo "    dev          - Start frontend and backend dev servers"
    echo "    docs         - Start the VitePress docs site"
    echo "    check        - Run type and generated-contract checks"
    echo "    lint         - Run backend and frontend lint checks"
    echo "    test         - Run backend and frontend tests"
    echo "    build        - Build the frontend and backend binary"
    echo "    verify       - Run check, lint, test, and build"
    echo "    security     - Scan Go call paths and production JS dependencies"
    echo "    cache-status - Report project cache and embedded frontend sizes"
    echo "    cache-prune  - Enforce the bounded persistent Go build cache"
    echo "    docker-cache-status - Report Docker image, volume, and build-cache sizes"
    echo "    docker-cache-prune  - Bound unused Docker build cache without deleting volumes"
    echo "    backend-*    - Targeted backend commands"
    echo "    frontend-*   - Targeted frontend commands"
    echo ""

    # Install the tracked fast pre-push lint gate. Full verification stays
    # explicit and CI-gated.
    if [ -d .git ] && [ -f scripts/pre-push-lint.sh ]; then
      dest=.git/hooks/pre-push
      mkdir -p .git/hooks
      if [ ! -f "$dest" ] || ! cmp -s scripts/pre-push-lint.sh "$dest"; then
        cp scripts/pre-push-lint.sh "$dest" 2>/dev/null ||
          echo "  Warning: could not refresh $dest; tracked hook remains available"
      fi
      if [ -f "$dest" ] && [ ! -x "$dest" ]; then
        chmod +x "$dest" 2>/dev/null ||
          echo "  Warning: $dest exists but is not executable"
      fi
    fi

    cache-prune
  '';

  enterTest = ''
    go version
    bun --version
    git --version
  '';
}
