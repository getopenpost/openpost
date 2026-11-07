{
  pkgs,
  config,
  lib,
  ...
}:

# Go, Bun and Chromium come from apps/server and apps/web. Toolchain caches use
# their per-user defaults, so every worktree shares them without remapping.
let
  root = config.git.root;
  # Each checkout gets its own ports, hostnames and dev database, so parallel
  # worktrees can run `devenv up` side by side.
  worktreeId = builtins.substring 0 12 (builtins.hashString "sha256" (toString root));
  appHost = "openpost-${worktreeId}.localhost";
  backendPort = toString config.processes.backend.ports.http.value;
  state = "${root}/.devenv/state/dev";
in
{
  dotenv.enable = true;

  packages = [
    pkgs.actionlint
    pkgs.ffmpeg
    pkgs.gifsicle
    pkgs.gitleaks
    pkgs.jq
    pkgs.ripgrep
    pkgs.sqlite
    pkgs.uv
  ];

  # go.mod pins the patched Go release; fetch it when nixpkgs trails.
  env.GOTOOLCHAIN = lib.mkForce "auto";

  process.proxy.enable = true;
  processes = {
    backend = {
      ports.http.allocate = 8080;
      proxy.hostname = "openpost-api-${worktreeId}.localhost";
      env = {
        OPENPOST_PORT = backendPort;
        OPENPOST_APP_URL = "http://${appHost}";
        OPENPOST_PUBLIC_URL = "http://${appHost}";
        OPENPOST_DATABASE_URL = "";
        OPENPOST_DATABASE_URL_FILE = "";
        DATABASE_URL = "";
        DATABASE_URL_FILE = "";
        OPENPOST_DATABASE_PATH = "file:${state}/openpost.db?cache=shared&mode=rwc";
        OPENPOST_STORAGE_DRIVER = "local";
        OPENPOST_MEDIA_PATH = "${state}/media";
      };
      exec = ''
        mkdir -p "${state}"
        cd "${root}/apps/server"
        exec go run -tags dev ./cmd/openpost
      '';
    };
    frontend = {
      ports.http.allocate = 5173;
      proxy.hostname = appHost;
      env.OPENPOST_DEV_BACKEND_URL = "http://127.0.0.1:${backendPort}";
      exec = ''
        cd "${root}/apps/web"
        exec bun run dev --host 127.0.0.1 --port ${toString config.processes.frontend.ports.http.value} --strictPort
      '';
    };
  };

  scripts.setup.exec = ''
    cd "${root}"
    bun install --frozen-lockfile
    bun run browser:install
    if (umask 077; set -o noclobber; cat apps/server/.env.example > apps/server/.env) 2>/dev/null; then
      echo "Created apps/server/.env; edit it with local credentials as needed"
    fi
  '';

  # The hook script selects its mode from its own name, so install copies.
  enterShell = ''
    if hooks="$(git rev-parse --git-path hooks 2>/dev/null)"; then
      for hook in pre-commit pre-push; do
        cmp -s scripts/changed-files-check.sh "$hooks/$hook" 2>/dev/null ||
          { mkdir -p "$hooks" && install -m 755 scripts/changed-files-check.sh "$hooks/$hook"; } 2>/dev/null || true
      done
    fi
  '';

  enterTest = ''
    go version
    bun --version
  '';
}
