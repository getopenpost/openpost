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

  env = {
    # go.mod pins the patched Go release; fetch it when nixpkgs trails.
    GOTOOLCHAIN = lib.mkForce "auto";
    # devenv keeps GOPATH per checkout; share downloaded modules across worktrees.
    GOMODCACHE = "${builtins.getEnv "HOME"}/go/pkg/mod";
  };

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

  # `devenv up --profile hosted` adds the Hosted data plane: PostgreSQL and
  # S3-compatible storage on ports allocated per checkout. Then run
  # `bash scripts/test-hosted-data-plane.sh`.
  profiles.hosted.module =
    { config, ... }:
    {
      services.postgres = {
        enable = true;
        listen_addresses = "127.0.0.1";
        initialDatabases = [
          {
            name = "openpost";
            user = "openpost";
            pass = "openpost";
          }
        ];
      };
      services.rustfs.enable = true;
      env = {
        OPENPOST_TEST_POSTGRES_URL = "postgres://openpost:openpost@127.0.0.1:${toString config.env.PGPORT}/openpost?sslmode=disable";
        OPENPOST_TEST_S3_ENDPOINT = "http://127.0.0.1:${toString config.env.RUSTFS_PORT}";
        OPENPOST_TEST_S3_REGION = "us-east-1";
        OPENPOST_TEST_S3_ACCESS_KEY_ID = config.env.RUSTFS_ACCESS_KEY;
        OPENPOST_TEST_S3_SECRET_ACCESS_KEY = config.env.RUSTFS_SECRET_KEY;
        OPENPOST_TEST_S3_BUCKET = "openpost-dev";
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
