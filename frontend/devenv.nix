{
  config,
  pkgs,
  lib,
  ...
}:
let
  chromiumRuntimeInputs = if pkgs.stdenv.hostPlatform.isLinux then [ pkgs.chromium ] else [ ];
  chromiumEnvironment =
    if pkgs.stdenv.hostPlatform.isLinux then
      ''export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="${lib.getExe pkgs.chromium}"''
    else
      "";
  eslint-wrapper = pkgs.writeShellApplication {
    name = "eslint-wrapper";
    runtimeInputs = [
      pkgs.nodejs_22
      pkgs.pnpm
    ];
    text = ''
      # Cap V8 heap at 1GB to keep the runner's OOM in check on
      # small-memory hosts (3–4GB). The default Node heap is ~1.7GB
      # and svelte-check / vite / paraglide will reliably OOM it.
      export NODE_OPTIONS="--max-old-space-size=1024"
      cd "${config.git.root}"
      pnpm --filter @openpost/web lint
    '';
  };
  svelte-check-wrapper = pkgs.writeShellApplication {
    name = "svelte-check-wrapper";
    runtimeInputs = [
      pkgs.nodejs_22
      pkgs.pnpm
    ];
    text = ''
      # Cap V8 heap at 1GB to keep the runner's OOM in check on
      # small-memory hosts (3–4GB). The default Node heap is ~1.7GB
      # and svelte-check / vite / paraglide will reliably OOM it.
      export NODE_OPTIONS="--max-old-space-size=1024"
      cd "${config.git.root}"
      pnpm --filter @openpost/web check
    '';
  };
  vitest-wrapper = pkgs.writeShellApplication {
    name = "vitest-wrapper";
    runtimeInputs = [
      pkgs.nodejs_22
      pkgs.pnpm
    ]
    ++ chromiumRuntimeInputs;
    text = ''
      # Cap V8 heap at 1GB to keep the runner's OOM in check on
      # small-memory hosts (3–4GB). The default Node heap is ~1.7GB
      # and svelte-check / vite / paraglide will reliably OOM it.
      export NODE_OPTIONS="--max-old-space-size=1024"
      ${chromiumEnvironment}
      cd "${config.git.root}"
      # Run tests only if test files exist, otherwise skip silently
      if find frontend/src \( -name "*.test.ts" -o -name "*.spec.ts" \) 2>/dev/null | grep -q .; then
        pnpm --filter @openpost/web test
      else
        echo "No test files found, skipping tests..."
        exit 0
      fi
    '';
  };
  frontend-build-wrapper = pkgs.writeShellApplication {
    name = "frontend-build-wrapper";
    runtimeInputs = [
      pkgs.nodejs_22
      pkgs.pnpm
    ];
    text = ''
      # The production bundle now needs slightly more than 1.5GB while
      # adapter-static finalizes the client output. Keep a bounded heap for
      # small-memory hosts, but leave enough headroom for release builds.
      export NODE_OPTIONS="--max-old-space-size=2048"
      cd "${config.git.root}"
      pnpm --filter @openpost/web build
      mkdir -p "${config.git.root}/backend/cmd/openpost/public"
      touch "${config.git.root}/backend/cmd/openpost/public/.gitkeep"
    '';
  };
in
{
  # JavaScript workspace support
  languages.javascript = {
    enable = true;
    pnpm.enable = true;
  };

  # Scripts for frontend development
  scripts = {
    frontend-dev.exec = ''
      cd "${config.git.root}"
      pnpm --filter @openpost/web dev
    '';

    frontend-build.exec = ''
      ${lib.getExe frontend-build-wrapper}
    '';

    frontend-test.exec = ''
      ${lib.getExe vitest-wrapper}
    '';

    frontend-check.exec = ''
      ${lib.getExe svelte-check-wrapper}
    '';

    frontend-lint.exec = ''
      ${lib.getExe eslint-wrapper}
    '';

    frontend-format.exec = ''
      cd "${config.git.root}"
      pnpm --filter @openpost/web format
    '';
  };
}
