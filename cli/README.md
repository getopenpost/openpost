# OpenPost CLI

Command-line client for a running OpenPost instance.

## Build

From the repository root:

```sh
devenv shell -- bash -lc 'cd cli && go build ./cmd/openpost'
```

The binary is written to `cli/openpost`.

## Install

During development, install into your Go bin directory:

```sh
devenv shell -- bash -lc 'cd cli && go install ./cmd/openpost'
devenv shell -- bash -lc 'cd cli && go install ./cmd/openpost-mcp'
```

Add `$(go env GOPATH)/bin` to your `PATH` if it is not already there.

## Quickstart

Add an instance profile:

```sh
openpost instance add local http://localhost:8080
openpost instance use local
openpost instance health
```

Log in with the browser device flow:

```sh
openpost auth login http://localhost:8080
```

For headless shells, print the verification URL and code without opening a browser:

```sh
openpost auth login http://localhost:8080 --device
```

For automation, pass an existing API token through stdin:

```sh
printf '%s\n' "$OPENPOST_TOKEN" | openpost auth login http://localhost:8080 --with-token
```

Select a workspace:

```sh
openpost workspace list
openpost workspace use personal
```

## Account and media commands

List, rename, and disconnect connected social accounts:

```sh
openpost account list
openpost account list --platform x
openpost account rename x --slug main-x
openpost account disconnect <account-id> --yes
```

New accounts are connected in the OpenPost web UI at `<instance>/accounts`.
The CLI does not have a `connect` subcommand by design: provider credentials
live on the server, and the web UI is the only place to authorize a new social
account. Running `account list` against a workspace with no accounts prints
the instance's `/accounts` URL so the path is discoverable.

Upload and list workspace media:

```sh
openpost media upload ./image.png --alt "Product screenshot"
openpost media list --limit 25
```

`openpost post view <id>` includes destination-specific renditions. Replace source
attachments with repeatable or comma-separated `--media` values on `post update`,
or use `--media ''` to clear them.

## Account targeting

Use `account list` to see account IDs, slugs, and platform selectors. Pass
`--accounts` when a post, thread, or publication should have destinations. If
`--accounts` is omitted, the item is created as a draft with no destinations.

## Posting

Create a draft:

```sh
openpost post create --content "Hello from OpenPost" --accounts x --workspace personal
openpost post create --content "Draft without destinations yet"
```

Schedule a post with natural language or RFC3339:

```sh
openpost post create --content "Launch note" --accounts x,linkedin --schedule "tomorrow 2pm"
openpost post create --content "Launch note" --accounts x --schedule 2026-06-20T14:00:00Z
```

Use the next available posting slot from the workspace schedule:

```sh
openpost post create --content "Launch note" --accounts x --schedule next-slot
openpost thread create ./thread.md --accounts x,linkedin --schedule next-slot
```

List and inspect posts:

```sh
openpost post list --status scheduled --limit 20
openpost post view <post-id>
```

Create a thread from markdown segments separated by `---` lines:

```sh
openpost thread create ./thread.md --accounts x --schedule "next monday 9am"
```

## Rich publications

Use `publication create` for platform-specific post types and media workflows:

```sh
openpost publication create --content-profile link_share --accounts linkedin --url https://openpost.social --content "Launch notes"
openpost publication create --content-profile short_video --accounts youtube,tiktok --video-title "Short title" --video-description "YouTube description" --caption "TikTok caption" --media ./short.mp4
openpost publication create --content-profile long_video --accounts youtube --video-title "Full walkthrough" --video-description "Long-form description" --privacy private --media ./walkthrough.mp4 --schedule next-slot
openpost publication schedule pub_123 --at "tomorrow 9am"
```

Continue the same publication lifecycle without dropping to raw HTTP:

```sh
openpost publication update pub_123 --title "Final launch" --schedule "Friday 10am"
openpost publication renditions pub_123 --file ./renditions.json
openpost publication reply rendition_123 --body "Follow-up" --at "tomorrow 9am"
openpost publication comments rendition_123
openpost publication reply-comment '<opaque-comment-id>' --body "Thanks!"
openpost publication hide-comment '<opaque-comment-id>'
openpost publication delete-comment '<opaque-comment-id>' --confirm
```

## Billing

Inspect or start hosted billing flows for the active workspace:

```sh
openpost billing status
openpost billing checkout founder
openpost billing portal
```

Useful diagnostics:

```sh
openpost auth status
openpost instance diagnostics --deployment docker-compose --provider youtube --logs-file ./openpost.log --json
openpost auth token list
openpost completion bash
openpost --version
```

## MCP stdio proxy

`openpost-mcp` lets desktop MCP clients talk to the same authenticated remote
`/mcp` endpoint using the active CLI profile and token. Configure an instance
and log in with `openpost` first, then point the MCP client at:

```sh
curl -fsSL https://raw.githubusercontent.com/rodrgds/openpost/main/scripts/install-cli.sh | sh -s -- --with-mcp
openpost auth login https://your-openpost-host.example
openpost-mcp --profile local
```

You can also pass `--instance` and `--token` directly for automation.

The proxy writes standard newline-delimited MCP JSON on stdout, accepts the same
format on stdin, and keeps legacy `Content-Length` framing for older desktop
clients. It also forwards the protocol version negotiated during initialization
to the remote Streamable HTTP endpoint.
