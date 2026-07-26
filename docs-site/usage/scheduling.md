# Scheduling

Scheduling is a core OpenPost workflow.

## Core ideas

- Posts are stored in the configured OpenPost database. SQLite is the self-hosted default; Postgres is supported for cloud/hosted deployments.
- Background jobs make publishing durable across restarts.
- Posting schedules help spread publishing across time slots.

## What to watch

- Failed jobs need operator attention.
- Timezone expectations should be consistent inside each workspace.
- Provider outages can leave posts in failed or retry-needed states.
