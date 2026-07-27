# Scheduling

OpenPost schedules canonical publications through a durable database-backed queue. A publication holds the shared source, destination renditions, media, schedule, and delivery state for every supported content mode.

## Plan from Calendar

Calendar has month and week views. Filter it by workspace, platform, and status:

- **Scheduled** items show their proposed run time and can be moved.
- **Published** items show their actual run time when it is available and stay locked as history.

Select an empty future day to create a publication with that date and time already filled in. On desktop, drag a scheduled item to another future day or time. On touch layouts, open the item and use its reschedule controls. Published items cannot be moved.

Calendar, Activity, and the sidebar planner all read the same publication inventory, so a text post, thread, Story, short video, or video appears once and opens in the composer that owns that content mode.

## Choose a time in the composer

The composer interprets dates and times in the workspace timezone. You can:

- choose an exact future date and time;
- request the next free slot from the workspace posting schedule;
- save a proposed time while the publication remains a draft; or
- schedule the publication, which validates it and creates the durable publishing job.

Setting `scheduled_at` on a draft does not queue it by itself. The schedule action creates the primary job and marks the publication and renditions as scheduled. Clearing the schedule returns them to draft without removing completed or failed job history.

Configure the workspace timezone, week start, reusable posting slots, and optional natural posting delay in **Settings → Workspace**.

## Delivery and recovery

The background worker claims jobs from the configured OpenPost database, so scheduled work survives application restarts without Redis. SQLite is the self-hosted default; Postgres is supported and required for hosted cloud mode.

Use **Activity** to inspect scheduled, published, failed, and draft publications. A failed destination keeps its provider error and recovery action. Retry only after correcting the account, content, quota, or provider issue shown there.

## What to watch

- Keep the workspace timezone correct before creating schedules.
- Provider limits and account capabilities are checked again when a publication is scheduled or published.
- Provider outages can leave destinations failed or waiting for retry; inspect Activity instead of assuming a queued job published.
