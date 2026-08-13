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
      pkgs.bun
    ];
    text = ''
      # The editor and composer program now exceeds a 1GB heap during the
      # type-aware ESLint pass. Keep the heap bounded for small runners while
      # leaving enough room for the complete frontend lint graph.
      export NODE_OPTIONS="--max-old-space-size=2048"
      cd "${config.git.root}"
      bun run --filter @openpost/web lint
    '';
  };
  svelte-check-wrapper = pkgs.writeShellApplication {
    name = "svelte-check-wrapper";
    runtimeInputs = [
      pkgs.nodejs_22
      pkgs.bun
    ];
    text = ''
      # The full Svelte program now needs more than 1GB while loading its
      # generated types. Keep the heap bounded, but leave enough headroom
      # for the release validation gate.
      export NODE_OPTIONS="--max-old-space-size=2048"
      cd "${config.git.root}"
      bun run --filter @openpost/web check
    '';
  };
  vitest-wrapper = pkgs.writeShellApplication {
    name = "vitest-wrapper";
    runtimeInputs = [
      pkgs.nodejs_22
      pkgs.bun
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
      if [ -n "$(find frontend/src \( -name "*.test.ts" -o -name "*.spec.ts" \) -print -quit 2>/dev/null)" ]; then
        bun run --filter @openpost/web test
      else
        echo "No test files found, skipping tests..."
        exit 0
      fi
    '';
  };
  vitest-server-wrapper = pkgs.writeShellApplication {
    name = "vitest-server-wrapper";
    runtimeInputs = [
      pkgs.nodejs_22
      pkgs.bun
    ];
    text = ''
      export NODE_OPTIONS="--max-old-space-size=1024"
      cd "${config.git.root}"
      bun run --filter @openpost/web test:unit:server
    '';
  };
  frontend-build-wrapper = pkgs.writeShellApplication {
    name = "frontend-build-wrapper";
    runtimeInputs = [
      pkgs.nodejs_22
      pkgs.bun
    ];
    text = ''
      cd "${config.git.root}"
      bun run frontend:build
    '';
  };
in
{
  # JavaScript workspace support
  languages.javascript = {
    enable = true;
    bun.enable = true;
  };

  # Scripts for frontend development
  scripts = {
    frontend-dev.exec = ''
      cd "${config.git.root}"
      bun run --filter @openpost/web dev
    '';

    frontend-build.exec = ''
      ${lib.getExe frontend-build-wrapper}
    '';

    frontend-test.exec = ''
      ${lib.getExe vitest-wrapper}
    '';

    frontend-unit-test.exec = ''
      ${lib.getExe vitest-server-wrapper}
    '';

    frontend-check.exec = ''
      ${lib.getExe svelte-check-wrapper}
    '';

    frontend-lint.exec = ''
      ${lib.getExe eslint-wrapper}
    '';

    frontend-format.exec = ''
      cd "${config.git.root}"
      bun run --filter @openpost/web format
    '';
  };
}
