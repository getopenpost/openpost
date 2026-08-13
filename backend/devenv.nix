{
  pkgs,
  lib,
  config,
  ...
}:

let
  goToolchain = pkgs.go_1_26;

  backend-gofmt-check = pkgs.writeShellApplication {
    name = "backend-gofmt-check";
    runtimeInputs = [ goToolchain pkgs.findutils pkgs.gnumake ];
    text = ''
      export GOROOT="${goToolchain}/share/go"
      cd "${config.git.root}/backend"
      unformatted=$(find . -path './.devenv' -prune -o -type f -name '*.go' -exec gofmt -l {} +)
      if [ -n "$unformatted" ]; then
        echo "$unformatted"
        exit 1
      fi
    '';
  };

  backend-golangci-lint = pkgs.writeShellApplication {
    name = "backend-golangci-lint";
    runtimeInputs = [ goToolchain pkgs.golangci-lint pkgs.gnumake ];
    text = ''
      export GOROOT="${goToolchain}/share/go"
      mkdir -p "${config.git.root}/backend/cmd/openpost/public"
      touch "${config.git.root}/backend/cmd/openpost/public/.gitkeep"
      cd "${config.git.root}/backend"
      golangci-lint run --build-tags dev ./...
    '';
  };

  backend-go-test = pkgs.writeShellApplication {
    name = "backend-go-test";
    runtimeInputs = [ goToolchain pkgs.gnumake ];
    text = ''
      export GOROOT="${goToolchain}/share/go"
      cd "${config.git.root}/backend"
      go test -tags dev ./...
    '';
  };

  cli-gofmt-check = pkgs.writeShellApplication {
    name = "cli-gofmt-check";
    runtimeInputs = [ goToolchain pkgs.findutils pkgs.gnumake ];
    text = ''
      export GOROOT="${goToolchain}/share/go"
      cd "${config.git.root}/cli"
      unformatted=$(find . -path './.devenv' -prune -o -type f -name '*.go' -exec gofmt -l {} +)
      if [ -n "$unformatted" ]; then
        echo "$unformatted"
        exit 1
      fi
    '';
  };

  cli-golangci-lint = pkgs.writeShellApplication {
    name = "cli-golangci-lint";
    runtimeInputs = [ goToolchain pkgs.golangci-lint pkgs.gnumake ];
    text = ''
      export GOROOT="${goToolchain}/share/go"
      cd "${config.git.root}/cli"
      golangci-lint run ./...
    '';
  };

  cli-go-test = pkgs.writeShellApplication {
    name = "cli-go-test";
    runtimeInputs = [ goToolchain pkgs.gnumake ];
    text = ''
      export GOROOT="${goToolchain}/share/go"
      cd "${config.git.root}/cli"
      go test ./...
    '';
  };
in

{
  # Go language support
  languages.go = {
    enable = true;
    package = goToolchain;
  };

  # Additional packages for backend development
  packages = [
    pkgs.golangci-lint
    pkgs.gotools
    pkgs.sqlc
  ];

  # Scripts for backend development
  scripts = {
    backend-run.exec = ''
      cd "${config.git.root}/backend" && go run -tags dev ./cmd/openpost
    '';

    backend-build.exec = ''
      release_state="$(mktemp -d "${config.git.root}/.devenv/state/release-go.XXXXXX")"
      trap 'rm -rf "$release_state"' EXIT
      mkdir -p "$release_state/cache" "$release_state/tmp"
      build_commit="$(git -C "${config.git.root}" rev-parse HEAD)"
      if ! git -C "${config.git.root}" diff --quiet ||
         ! git -C "${config.git.root}" diff --cached --quiet; then
        build_commit="$build_commit-dirty"
      fi
      cd "${config.git.root}/backend" &&
        GOCACHE="$release_state/cache" GOTMPDIR="$release_state/tmp" \
          go build -buildvcs=false -ldflags="-X main.commit=$build_commit" -o openpost ./cmd/openpost
    '';

    backend-test.exec = ''
      ${lib.getExe backend-go-test}
    '';

    backend-format-check.exec = ''
      ${lib.getExe backend-gofmt-check}
    '';

    backend-lint.exec = ''
      ${lib.getExe backend-golangci-lint}
    '';

    cli-format-check.exec = ''
      ${lib.getExe cli-gofmt-check}
    '';

    cli-lint.exec = ''
      ${lib.getExe cli-golangci-lint}
    '';

    cli-test.exec = ''
      ${lib.getExe cli-go-test}
    '';

    cli-build.exec = ''
      cd "${config.git.root}/cli" && go build ./...
    '';
  };
}
