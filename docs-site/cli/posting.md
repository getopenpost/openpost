---
description: Create posts, threads, account-specific renditions, schedules, and media attachments from the OpenPost CLI.
---

# Posting with the CLI

Use `openpost post` for quick post drafts, `openpost thread` for markdown threads, `openpost publication` for account-specific renditions and formats, and `openpost media` for attachments. Drafts from all three creation commands open in the unified publication composer.

## Check Account Support

Check account setup and supported post types before you publish:

```sh
openpost provider readiness --json
openpost provider capabilities --provider youtube --content-profile long_video --json
```

## Choose Accounts

Use `--accounts` to select accounts by ID, short name, or social network:

```sh
openpost post create --accounts x,linkedin --content 'Shipping today.'
```

If `--accounts` is omitted, `post create` and `thread create` make drafts with
no accounts. Add accounts later from the web editor or update command.

## Schedule Posts

Natural language and RFC3339 are supported:

```sh
openpost post create --accounts x --content 'Shipping today.' --schedule 'tomorrow 2pm'
openpost post create --accounts x --file launch.md --schedule '2026-06-15T09:00:00+01:00'
```

Use the next available workspace posting slot:

```sh
openpost post create --accounts x --content 'Shipping today.' --schedule next-slot
openpost thread create launch.md --accounts x,linkedin --schedule next-slot
```

## Attach Media

Upload media first, then pass the returned media ID to a post command:

```sh
openpost media upload ./image.png --alt 'Product screenshot'
openpost post create --accounts x --content 'New queue view is live.' --media <id> --schedule 'next monday 9am'
```

`--media` also accepts a local file path and uploads it before creating the post.

Inspect storage and usage, update alt text, or delete an unused item:

```sh
openpost media storage
openpost media usage <media-id>
openpost media update <media-id> --alt 'Revised product screenshot'
openpost media delete <media-id>
```

## Create Threads

Create a markdown file with optional front matter and `---` separators:

```md
---
accounts: x,linkedin
schedule: next-slot
---

We shipped the OpenPost CLI today.

---

It supports browser login, device mode for SSH hosts, token-based automation, and next-slot scheduling.
```

Then create the thread:

```sh
openpost thread create launch.md
```

## Other Post Types

Use `openpost publication create` for Stories, short videos, long videos, link posts, and other posts that need extra settings.

```sh
openpost publication create --content-profile link_share --accounts linkedin --url https://openpost.social --content 'Launch notes'
openpost publication create --content-profile short_video --accounts youtube,tiktok --video-title 'Short title' --video-description 'YouTube description' --caption 'TikTok caption' --media ./short.mp4
openpost publication create --content-profile long_video --accounts youtube --video-title 'Full walkthrough' --video-description 'Long-form description' --privacy private --media ./walkthrough.mp4 --schedule next-slot
openpost publication schedule pub_123 --at 'tomorrow 9am'
```

Check the post before you schedule or publish it:

```sh
openpost publication validate pub_123 --json
openpost publication publish-now pub_123
```

## Manage Posting Slots

Posting slots use the workspace timezone and `0=Sunday` through `6=Saturday`:

```sh
openpost schedule list
openpost schedule create --day 1 --hour 9 --minute 30 --label Morning
openpost schedule next
```

`openpost schedule suggest --posts-per-day 2` creates fourteen active slots, so it asks for confirmation.

## Schedule Inputs

| Input                              | Resolution                                                                |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `now`                              | The start of the next minute.                                             |
| `draft`                            | No scheduled time; the post remains a draft.                              |
| `next-slot` / `next slot` / `slot` | The next available posting schedule slot from the server.                 |
| `2pm`                              | Today at 14:00 if still in the future, otherwise tomorrow at 14:00.       |
| `tomorrow 2pm`                     | Tomorrow at 14:00 in the resolved workspace/profile/local timezone.       |
| `in 3 hours`                       | Three hours after the command runs.                                       |
| `next monday 9am`                  | The next Monday after today at 09:00.                                     |
| `2026-06-15T09:00:00+01:00`        | The exact RFC3339 instant with the supplied offset.                       |
| `2026-06-15 09:00`                 | The local date and time in the resolved workspace/profile/local timezone. |

`today` or `tomorrow` without a time is rejected so scheduled posts do not land at an accidental default time.
