# Scheduling

OpenPost saves scheduled posts in its database, so they survive a server restart. The same saved record keeps the shared content, account versions, media, time, and status.

## Plan from Calendar

Calendar has month and week views. Filter it by workspace, platform, and status:

- **Scheduled** items show when they should run and can be moved.
- **Published** items show when they ran and cannot be moved.

Select an empty future day to start a post with that date and time. On desktop, drag a scheduled item to another future day or time. On a phone or tablet, open the item and use its time controls.

Calendar, Activity, and the side planner show the same posts. Each text post, thread, Story, short video, or video appears once and opens in the right editor.

## Choose a time in the composer

The composer interprets dates and times in the workspace timezone. You can:

- choose an exact future date and time;
- request the next free slot from the workspace posting schedule;
- save a time while the post stays a draft; or
- choose **Schedule**, which checks the post and saves the posting job.

The publication time applies to every destination by default. To stagger delivery, open a destination tab, expand **Advanced delivery**, and set its schedule override. OpenPost keeps the publication grouped in Calendar and Activity while each rendition runs at its own time and records its own result.

After you schedule or submit, the composer keeps a result for each destination on screen. It identifies destinations that succeeded, remain pending, failed, or need review. Use **Retry destination** only when OpenPost offers it, or open **View publication** to inspect the complete delivery state before another action.

For API, CLI, and MCP users: setting `scheduled_at` on a draft does not schedule it by itself. The schedule action creates the required destination jobs and marks the publication and renditions as scheduled. Clearing the schedule returns them to draft, removes destination schedule overrides, and keeps old success and error history.

The schedule and immediate-publish HTTP responses include `publication_id` and `renditions`. Each rendition carries the canonical destination status and delivery evidence instead of inheriting one aggregate action result.

Configure the workspace timezone and week start in **Settings → Workspace → General**. Manage reusable posting slots and the optional natural posting delay in **Settings → Workspace → Posting schedule**.

## Delivery and recovery

OpenPost runs saved jobs from its database, so scheduled posts survive restarts without Redis. SQLite is the self-hosted default. The hosted service uses PostgreSQL.

Open a Publication to inspect every destination Rendition separately. Each destination keeps one exact outcome: queued, submitted, processing at the provider, scheduled at the provider, live, rejected, awaiting reconciliation, or requiring manual resolution. The detail includes the latest attempt time and safe normalized failure code when one is available. OpenPost does not store or display raw provider responses because they can include sensitive data.

**Retry destination** appears only after the provider write is known to be safe to repeat. OpenPost does not offer retry after an ambiguous write because another send could create a duplicate. It checks supported providers first; when it cannot reconcile the result, use **Review destination** to inspect the connected account and confirm the provider result before taking another action.

Use **Activity** to see drafts and scheduled, published, or failed posts. Activity and Publication detail use the same state, provider-attempt evidence, reconciliation timing, and safe recovery action for each exact account and target.

Publication history records when each lifecycle event occurred and names its destination. It also separates that occurrence from the latest effective destination outcome. When a later provider attempt replaces an older failure, the older event remains in the timeline as an earlier outcome and cannot look current. Retry and manual-review controls follow the latest effective outcome, not the historical event.

## What to watch

- Keep the workspace timezone correct before creating schedules.
- OpenPost checks platform limits and account access again when you schedule or publish.
- A platform outage can leave an account failed or waiting for another try. Check Activity instead of assuming the post went live.
