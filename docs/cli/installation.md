# OpenPost CLI Installation

Install the OpenPost CLI when you want to manage a running OpenPost instance from a terminal or automation job.

## Quickstart

```sh
curl -fsSL https://raw.githubusercontent.com/rodrgds/openpost/main/scripts/install-cli.sh | sh
openpost auth login https://openpost.example.com
openpost workspace list
```

Install the desktop MCP stdio proxy at the same time when you want to connect Claude, Cursor, Codex, or another local MCP client:

```sh
curl -fsSL https://raw.githubusercontent.com/rodrgds/openpost/main/scripts/install-cli.sh | sh -s -- --with-mcp
openpost-mcp --profile local
```

Verify the installed binary:

```sh
openpost --version
```

## Install with curl

The installer supports Linux on `amd64` and `arm64`, and macOS on Apple Silicon (`arm64`). It downloads the matching `openpost-cli-*` binary from the latest GitHub release and installs it as `openpost`. Pass `--with-mcp` or set `OPENPOST_INSTALL_MCP=1` to also install the matching `openpost-mcp-*` asset as `openpost-mcp`.

```sh
curl -fsSL https://raw.githubusercontent.com/rodrgds/openpost/main/scripts/install-cli.sh | sh
```

Non-root installs go to `$HOME/.local/bin/openpost`. Root installs go to `/usr/local/bin/openpost`.

## Install with Go

Use `go install` if you already have Go 1.25 or newer:

```sh
go install github.com/openpost/cli/cmd/openpost@latest
```

Add `$(go env GOPATH)/bin` to your `PATH` if it is not already there.

## Build from source

Clone the repository and build the CLI module directly:

```sh
git clone https://github.com/rodrgds/openpost.git
cd openpost
devenv shell -- bash -lc 'cd cli && go build -ldflags="-s -w" -o ../openpost ./cmd/openpost'
```

Release binaries are published at:

```text
https://github.com/rodrgds/openpost/releases/latest
```
