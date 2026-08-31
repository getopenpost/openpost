# Post to Publication migration

This page is for API clients and automation maintainers moving from the legacy Post model to Publications.

Post HTTP routes, post-named MCP tools, and the legacy Post authoring model are retired. Publication is the only authoring record for API and automation work.

## What changed

- The `posts`, `post_destinations`, `post_media`, `post_variants`, and `thread_drafts` tables are removed after the legacy backfill completes and no Post rows or pending `publish_post` Jobs remain.
- Post HTTP routes and the post-named MCP tools (`create_draft`, `list_drafts`, `update_draft`, `set_post_renditions`, `schedule_post`, `schedule_draft`, `get_post_status`, `list_scheduled_posts`, `cancel_post`) are removed.
- During an old-database upgrade, immutable `legacy_post` and `legacy_post_variant` records map migrated IDs to Publications. They are migration data only and do not expose a browser or HTTP compatibility route.
- Historical migration files remain so an older database can upgrade in place. They translate legacy rows and non-terminal publishing Jobs into Publications, Renditions, and authorization receipts before the final schema drops the legacy tables.

## Field mapping

| Legacy Post field                       | Publication replacement                                       |
| --------------------------------------- | ------------------------------------------------------------- |
| `id`                                    | `publication_id`, then call `/publications/{id}`.             |
| `content`                               | `source_text` and the first segment `body`.                   |
| `thread_draft` or `/posts/thread` items | `creation_preset: "thread"` with one segment per thread item. |
| `social_account_ids`                    | One Rendition per destination `social_account_id`.            |
| `media_ids`                             | Segment or Rendition `media` entries.                         |
| Post variants                           | Publication Renditions.                                       |
| `scheduled_at`                          | `POST /publications/{id}/schedule` after the draft is saved.  |
| `random_delay_minutes`                  | Publication `random_delay_minutes`.                           |
| `status`                                | Publication lifecycle status plus each Rendition status.      |

## Route mapping

| Removed surface                | Replacement                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `POST /posts`                  | `POST /publications`, then `POST /publications/{id}/schedule` when scheduling.     |
| `GET /posts`                   | `GET /publications`.                                                               |
| `GET /posts/{id}`              | Use the migrated `publication_id`, then `GET /publications/{id}`.                  |
| `PATCH /posts/{id}`            | `PUT /publications/{id}` or schedule and cancel endpoints.                         |
| `DELETE /posts/{id}`           | `DELETE /publications/{id}` with `expected_revision`.                              |
| `POST /posts/draft`            | `POST /publications`.                                                              |
| `PUT /posts/{id}/draft`        | `PUT /publications/{id}`.                                                          |
| `/posts/{id}/variants`         | `GET /publications/{id}` and `PUT /publications/{id}/renditions`.                  |
| `GET /posts/schedule-overview` | `GET /publications` with `calendar_from` and `calendar_before`, then group by day. |

## CLI and MCP

The CLI keeps the friendly `openpost post` and `openpost thread` command names, but every command creates, reads, and mutates Publications and Renditions through the canonical API. Use the returned Publication IDs in scripts.

MCP exposes canonical Publication tools only: `create_publication`, `list_publications`, `get_publication`, `update_publication`, `set_publication_renditions`, `reply_to_rendition`, `validate_publication`, `schedule_publication`, `cancel_publication`, `publish_publication_now`, and `list_publication_events`.
