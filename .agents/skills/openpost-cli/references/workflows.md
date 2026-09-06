# OpenPost CLI workflows

Use live `--help` output if a flag in this reference differs from the installed CLI.

## Inspect the target

```sh
openpost instance diagnostics --json
openpost workspace list --json
openpost account list --json
openpost provider readiness --json
```

Select a different target without changing the saved profile:

```sh
openpost --instance https://app.example.com --workspace workspace-id account list --json
```

## Manage provider context

```sh
openpost provider list --json
openpost provider readiness --workspace workspace-id --json
openpost provider capabilities --provider youtube --json
openpost provider capabilities --provider tiktok --content-profile short_video --json
```

Readiness reports setup and account blockers. Capabilities report supported profiles, media shapes, text limits, and provider settings.

## Create and edit text posts

Create a draft:

```sh
openpost post create \
  --accounts main-x,company-linkedin \
  --content 'Release notes are ready.' \
  --json
```

Attach an existing media ID or upload a local file in the same command:

```sh
openpost post create \
  --accounts main-x \
  --content 'The new queue is live.' \
  --media media-id \
  --json

openpost post create \
  --accounts main-x \
  --content 'The new queue is live.' \
  --media ./queue.png \
  --media-alt 'OpenPost queue screen' \
  --json
```

Update and verify:

```sh
openpost post update post-id --content 'Revised copy.' --json
openpost post view post-id --json
```

The CLI loads the current draft revision before an update. If the server reports a revision conflict, reload and reconcile instead of forcing a stale write.

Schedule at an exact instant or the next configured slot:

```sh
openpost post create \
  --accounts main-x \
  --content 'Scheduled update.' \
  --schedule '2026-08-03T09:00:00+01:00' \
  --json

openpost post create \
  --accounts main-x \
  --content 'Use the next free slot.' \
  --schedule next-slot \
  --json
```

Use `post update <id> --schedule draft` to clear a queued schedule.

## Create a Markdown thread

The file needs at least two non-empty posts separated by a line containing only `---`:

```md
First post.

---

Second post.
```

Create a draft or schedule it:

```sh
openpost thread create ./thread.md --accounts main-x --json
openpost thread create ./thread.md --accounts main-x --schedule next-slot --json
```

The file may start with optional front matter containing `workspace`, `accounts`, `schedule`, and `random_delay`.

## Create format-first publications

Profiles:

- `short_text`
- `thread`
- `link_share`
- `image_post`
- `carousel`
- `story`
- `short_video`
- `long_video`

Inspect capabilities for every target provider before filling provider-specific fields.

Link share:

```sh
openpost publication create \
  --content-profile link_share \
  --accounts company-linkedin \
  --url https://example.com/release \
  --content 'Release notes' \
  --json
```

Short video for mixed providers:

```sh
openpost publication create \
  --content-profile short_video \
  --accounts youtube-shorts,tiktok-main \
  --video-title 'Launch demo' \
  --video-description 'A short product walkthrough.' \
  --caption 'A short product walkthrough.' \
  --media ./launch.mp4 \
  --json
```

Long YouTube video:

```sh
openpost publication create \
  --content-profile long_video \
  --accounts youtube-main \
  --video-title 'Full walkthrough' \
  --video-description 'Complete product walkthrough.' \
  --privacy private \
  --media ./walkthrough.mp4 \
  --json
```

Validate, then schedule or publish:

```sh
openpost publication validate publication-id --json
openpost publication schedule publication-id --at '2026-08-03T09:00:00+01:00' --json
openpost publication publish-now publication-id --json
```

Replace destination-specific renditions with a JSON array:

```sh
openpost publication renditions publication-id --file ./renditions.json --json
```

Run `openpost publication renditions --help` and inspect `provider capabilities` before constructing provider settings.

## Manage media

```sh
openpost media upload ./image.png --alt 'Descriptive alt text' --json
openpost media list --limit 100 --json
openpost media update media-id --alt 'Revised alt text' --json
openpost media usage media-id --json
openpost media storage --json
openpost media delete media-id --yes --json
```

Check usage before deletion. OpenPost rejects deletion while media is used by an editable draft, design, template, or brand kit.

## Manage reusable schedule slots

List slots and find the next free time:

```sh
openpost schedule list --json
openpost schedule next --json
```

Create or edit a workspace-local weekly slot. Days use `0=Sunday` through `6=Saturday`:

```sh
openpost schedule create --day 1 --hour 9 --minute 30 --label Morning --json
openpost schedule update schedule-id --hour 10 --minute 0 --json
openpost schedule update schedule-id --inactive --json
```

Create a suggested seven-day schedule only when the user asked for it. This adds `7 × posts-per-day` slots:

```sh
openpost schedule suggest --posts-per-day 2 --yes --json
```

Delete one exact slot:

```sh
openpost schedule delete schedule-id --yes --json
```

## Inspect and recover publication activity

```sh
openpost publication view publication-id --json
openpost publication events publication-id --json
openpost jobs list --json
```

Retry one failed and retryable destination:

```sh
openpost publication retry publication-id account-id --json
```

Do not retry a failure that requires account reconnection or a content change.

Delete one saved rendition or an editable publication only after explicit authorization:

```sh
openpost publication delete-rendition publication-id account-id --confirm --json
openpost publication delete publication-id --confirm --json
```

## Read and moderate comments

```sh
openpost publication comments rendition-id --json
openpost publication reply-comment comment-id --body 'Thanks for the feedback.' --json
openpost publication hide-comment comment-id --json
openpost publication delete-comment comment-id --json
```

Use only actions marked supported in the comment data. Replies and moderation change the provider's remote state.
