# Posting with the CLI

Use `openpost post` for single posts, `openpost media` for uploads, and `openpost thread` for multi-post markdown threads.

## Choose Accounts

Use `--accounts` to select destinations by account ID, slug, or platform:

```sh
openpost post create --accounts x,linkedin --content 'Shipping today.'
```

If `--accounts` is omitted, `post create` and `thread create` create drafts with
no destinations. Add destinations later from the web composer or update command.

## Create a Scheduled Post

```sh
openpost post create --accounts x --content 'Shipping the first CLI release today.' --schedule 'tomorrow 2pm'
```

You can also schedule with an RFC3339 timestamp:

```sh
openpost post create --accounts x --file launch.md --schedule '2026-06-15T09:00:00+01:00'
```

Use the next available workspace posting slot:

```sh
openpost post create --accounts x --content 'Shipping today.' --schedule next-slot
openpost thread create launch.md --accounts x,linkedin --schedule next-slot
```

## Attach Media

Upload media first, then pass the returned media ID to the post command:

```sh
openpost media upload ./image.png --alt 'Product screenshot showing the new queue view'
openpost post create --accounts x --content 'New queue view is live.' --media <id> --schedule 'next monday 9am'
```

View destination-specific renditions alongside the shared post source, or replace
source media on an existing post. Pass an empty `--media` value to clear it:

```sh
openpost post view <post-id>
openpost post update <post-id> --media <id> --media <second-id>
openpost post update <post-id> --media ''
```

## Rich Publications

Use `openpost publication create` for post types that need explicit provider
fields, video details, link metadata, or capability validation.

```sh
openpost publication create --profile link_share --accounts linkedin --url https://openpost.social --content 'Launch notes'
openpost publication create --profile short_video --accounts youtube,tiktok --video-title 'Short title' --video-description 'YouTube description' --caption 'TikTok caption' --media ./short.mp4
openpost publication create --profile long_video --accounts youtube --video-title 'Full walkthrough' --video-description 'Long-form description' --privacy private --media ./walkthrough.mp4 --schedule next-slot
openpost publication schedule pub_123 --at 'tomorrow 9am'
```

Edit source fields, replace account-specific outputs, queue replies, and moderate supported provider comments with the same publication command group:

```sh
openpost publication update pub_123 --title 'Final launch' --schedule 'Friday 10am'
openpost publication renditions pub_123 --file ./renditions.json
openpost publication reply rendition_123 --body 'Follow-up'
openpost publication comments rendition_123
openpost publication reply-comment '<opaque-comment-id>' --body 'Thanks!'
openpost publication hide-comment '<opaque-comment-id>'
openpost publication delete-comment '<opaque-comment-id>' --confirm
```

`renditions.json` is an array of the same typed rendition objects accepted by the publication API: each item targets a `social_account_id` and can set `profile`, `body`, `title`, `description`, provider `settings`, and ordered `media`.

## Create a Thread

Create `launch.md` with front matter and `---` separators:

```md
---
accounts: x,linkedin
schedule: tomorrow 2pm
---

We shipped the OpenPost CLI today.

---

It supports browser login, device mode for SSH hosts, and token-based automation.

---

Install it from the latest GitHub release and run:

openpost auth login <instance>
```

Then create the thread:

```sh
openpost thread create launch.md
```

## JSON Output

Automation can pass a token through the environment and request JSON output:

```sh
OPENPOST_TOKEN=op_cli_... openpost post list --json
```

## Relative Schedule

| Input                              | Resolution                                                                |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `now`                              | The next one-minute boundary, so the publish worker can pick it up.       |
| `draft`                            | No scheduled time; the post remains a draft.                              |
| `next-slot` / `next slot` / `slot` | The next available posting schedule slot from the server.                 |
| `2pm`                              | Today at 14:00 if still in the future, otherwise tomorrow at 14:00.       |
| `tomorrow 2pm`                     | Tomorrow at 14:00 in the resolved workspace/profile/local timezone.       |
| `in 3 hours`                       | Three hours after the command runs.                                       |
| `next monday 9am`                  | The next Monday after today at 09:00.                                     |
| `2026-06-15T09:00:00+01:00`        | The exact RFC3339 instant with the supplied offset.                       |
| `2026-06-15 09:00`                 | The local date and time in the resolved workspace/profile/local timezone. |

`today` or `tomorrow` without a time is rejected so scheduled posts do not land at an accidental default time.
