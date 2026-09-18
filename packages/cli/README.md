# @getopenpost/cli

Run the OpenPost CLI and MCP proxy without installing Go or downloading release archives by hand. The `openpost` and `openpost-mcp` commands resolve a verified prebuilt binary from the OpenPost GitHub release and exec it with your arguments.

```bash
npm install -g @getopenpost/cli
openpost --help
openpost auth login https://app.openpo.st
openpost publication create --help
```

`openpost-mcp` exposes the same release's MCP proxy for agents and coding tools.

## How resolution works

1. `OPENPOST_CLI_BIN` (or `OPENPOST_MCP_BIN` for the proxy) points at an exact binary. Nothing is downloaded.
2. Otherwise the wrapper downloads `openpost-cli-<os>-<arch>` from a version-shaped GitHub release tag into `~/.cache/openpost/cli/<tag>/` (override the root with `OPENPOST_CLI_DIR`; the tag segment always applies), verifies its detached `.sha256` checksum, installs it atomically, and records the verified hash beside it.
3. Every later run re-verifies the cached binary against the recorded hash before executing it. A tampered, replaced, or symlinked cache forces a fresh verified download instead of running.
4. The child process inherits stdio, so interactive login, prompts, and TTY output behave like the native binary. Its exit code passes through unchanged.

Supported targets match the release matrix: `linux-x64`, `linux-arm64`, `darwin-arm64`, `win32-x64`.

## Environment

| Variable                        | Effect                                                                    |
| ------------------------------- | ------------------------------------------------------------------------- |
| `OPENPOST_CLI_TAG`              | GitHub release tag to install (default: pinned in `package.json`)         |
| `OPENPOST_CLI_DIR`              | Binary cache directory                                                    |
| `OPENPOST_CLI_BIN`              | Exact `openpost` binary path, skips download                              |
| `OPENPOST_MCP_BIN`              | Exact `openpost-mcp` binary path, skips download                          |
| `OPENPOST_CLI_ALLOW_UNVERIFIED` | `1` installs from releases that predate checksum assets (not recommended) |

Checksum verification fails closed: a mismatch or a missing `.sha256` asset aborts the install with a clear error. Releases that predate checksum assets need `OPENPOST_CLI_ALLOW_UNVERIFIED=1` or, better, a newer release tag. The bypass prints a loud warning to stderr every time it is used, so check CI logs for it.

## Versioning

The wrapper version is independent of the OpenPost app version. The `openpost.releaseTag` field in `package.json` pins the CLI release it installs by default; bump both together when picking up a new CLI. `openpost version` always reports the installed binary version.

## License

MIT. See [LICENSE](./LICENSE).
