---
name: openpost-cli
description: Operate a running OpenPost instance through the openpost CLI. Use for authentication and profile setup; workspace, account, provider, media, schedule, job, and billing inspection; creating or editing text posts, threads, and format-first publications; scheduling or publishing content; checking lifecycle events; recovering failed destinations; and comment replies or moderation. Prefer this skill when terminal or scripted OpenPost work is requested. It is not needed when an OpenPost MCP connector is already being used.
---

# OpenPost CLI

Use the `openpost` executable as an external client of a running OpenPost instance. Keep the instance, workspace, destination accounts, content, and publish time explicit.

## Start safely

1. Confirm the CLI exists:

   ```sh
   command -v openpost
   openpost version
   ```

   If it is missing, stop and point to `https://docs.openpost.social/cli/installation`. Do not install software unless the user asked.

2. Inspect context before a workspace-scoped action:

   ```sh
   openpost instance diagnostics --json
   openpost auth status --json
   openpost workspace list --json
   ```

3. Pass `--profile`, `--instance`, or `--workspace` when the saved context is absent or ambiguous. Prefer the stored keyring token or `OPENPOST_TOKEN`; do not put a token in command output, logs, files, or chat.

4. Use `--json` for reads and automation. Parse IDs and status from JSON instead of scraping tables.

5. When syntax may have changed, run `openpost help` or `openpost <group> <command> --help`. Treat live help as the command source of truth.

## Choose the authoring path

- Use `openpost post` for the text-and-thread composer: short text, text with media, and editable drafts.
- Use `openpost thread create` when the source is a Markdown file containing two or more `---`-separated posts.
- Use `openpost publication` for format-first content: link shares, image posts, carousels, stories, short video, long video, and provider-specific output fields.
- Inspect `openpost provider readiness --json` before a new provider workflow. Inspect `openpost provider capabilities --provider <key> --json` before choosing a publication profile or provider setting.

Read [references/workflows.md](references/workflows.md) for exact command patterns and format selection.

## Apply mutations deliberately

- Default to creating a draft when the user did not ask to schedule or publish.
- Treat scheduling, publishing, retrying a rendition, replying, hiding or deleting a comment, disconnecting an account, generating schedule slots, and deletion as state-changing actions. Perform them only when the request authorizes that effect.
- Before a publish or schedule action, resolve the exact instance, workspace, destination accounts, content, media, and RFC3339 time or named next slot.
- Use account slugs as human-friendly `--accounts` selectors. Use exact account IDs for rendition retry or deletion.
- Add alt text during upload or with `openpost media update`.
- Run `openpost publication validate <id> --json` before publishing a format-first publication.
- Pass `--yes` only when the user already authorized the command's confirmation. Pass `--confirm` only for the exact publication or rendition the user asked to delete.
- Never add `--force` automatically after a revision conflict. Reload the post or publication, show the conflict, and retry only after reconciling the saved version with the requested edits.

## Verify the outcome

After a mutation, inspect the returned ID and current server state:

```sh
openpost post view <post-id> --json
openpost publication view <publication-id> --json
openpost publication events <publication-id> --json
openpost jobs list --json
```

Do not describe `scheduled` as `published`. For queued work, report the object ID, job ID when present, schedule time, and current status. For partial or failed publication, inspect rendition failure fields and lifecycle events before retrying.

## Handle common failures

- `401` or auth required: run `openpost auth status --json`; do not expose or regenerate credentials without user direction.
- Workspace not found or ambiguous: run `openpost workspace list --json`, then pass an exact ID with `--workspace`.
- Account selector ambiguous: run `openpost account list --json`, then use a unique slug or ID.
- Provider validation failure: inspect readiness, capabilities, media metadata, and publication validation output; fix the stated blocker.
- Revision conflict: reload with `post view` or `publication view`; do not replay stale data.
- Media deletion blocked: run `openpost media usage <media-id> --json` and report the references.
- No next slot: inspect `openpost schedule list --json`; do not invent a time.
