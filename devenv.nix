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
    pkgs.wget
    pkgs.docker
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
  env.npm_config_store_dir = "${config.git.root}/.devenv/state/pnpm-store";

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
      pnpm --filter @openpost/docs docs:dev
    '';

    build.exec = ''
      cd "${config.git.root}"
      frontend-build && backend-build && (cd cli && go build ./...)
    '';

    docs-build.exec = ''
      cd "${config.git.root}"
      pnpm --filter @openpost/docs docs:build
    '';

    check.exec = ''
      cd "${config.git.root}"
      pnpm run check:docs &&
      pnpm run check:release-version &&
      frontend-check &&
      pnpm --filter @openpost/site check &&
      pnpm run check:contracts
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
      backend-test && frontend-test && (cd cli && go test ./...)
    '';

    verify.exec = ''
      cd "${config.git.root}"
      check && lint && test-all && build
    '';

    security.exec = ''
      cd "${config.git.root}"
      scripts/security-check.sh
    '';

    backend-check.exec = ''
      backend-format-check && backend-lint
    '';

    backend-verify.exec = ''
      backend-check && backend-test && backend-build
    '';

    backend-security.exec = ''
      cd "${config.git.root}/backend"
      go run golang.org/x/vuln/cmd/govulncheck@v1.6.0 ./...
    '';

    cli-security.exec = ''
      cd "${config.git.root}/cli"
      go run golang.org/x/vuln/cmd/govulncheck@v1.6.0 ./...
    '';

    frontend-security.exec = ''
      cd "${config.git.root}"
      pnpm audit --prod --audit-level low
    '';

    frontend-verify.exec = ''
      frontend-lint && frontend-check && frontend-test && frontend-build
    '';

    # Compatibility alias for existing local workflows.
    test-all.exec = ''
      backend-test && frontend-test && (cd cli && go test ./...)
    '';

    clean.exec = ''
      cd "${config.git.root}"
      rm -rf backend/openpost frontend/.svelte-kit
      rm -f backend/*.db
    '';

    install.exec = ''
      cd "${config.git.root}"
      pnpm install --frozen-lockfile
      pnpm run browser:install
      (cd backend && go mod download)
      (cd cli && go mod download)
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
      export npm_config_store_dir="$openpost_shared_root/.devenv/state/pnpm-store"
    fi

    echo ""
    echo "  OpenPost Development Environment"
    echo "  --------------------------------"
    echo "  Go:     $(go version 2>/dev/null || echo 'not installed')"
    echo "  pnpm:   $(pnpm --version 2>/dev/null || echo 'not installed')"
    echo ""
    echo "  Commands:"
    echo "    doctor       - Check disk, worktrees, Git, browser, and tool readiness"
    echo "    install      - Install locked pnpm and Go dependencies"
    echo "    setup        - Frozen install and create backend/.env if missing"
    echo "    dev          - Start frontend and backend dev servers"
    echo "    docs         - Start the VitePress docs site"
    echo "    check        - Run type and generated-contract checks"
    echo "    lint         - Run backend and frontend lint checks"
    echo "    test         - Run backend and frontend tests"
    echo "    build        - Build the frontend and backend binary"
    echo "    verify       - Run check, lint, test, and build"
    echo "    security     - Scan Go call paths and production JS dependencies"
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
  '';

  enterTest = ''
    go version
    pnpm --version
    git --version
  '';
}
