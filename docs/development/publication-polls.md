# Publication polls

A poll belongs to one canonical Publication segment, in `settings.poll`. The composer, HTTP API, CLI JSON payloads and workflows use that same value. No schema migration is needed; existing destination `poll_*` settings remain valid.

```json
{
  "question": "What should we build next?",
  "options": [
    { "id": "workflows", "text": "Workflows" },
    { "id": "analytics", "text": "Better analytics" }
  ],
  "duration_seconds": 86400,
  "multiple": false,
  "hide_totals": false,
  "destinations": {
    "account-x": { "mode": "native" },
    "account-bluesky": { "mode": "text" }
  }
}
```

Option IDs stay stable while editing and reordering. An option is one line; commas are part of its text. The question is separate from the introductory body. Duration is expressed in seconds; adapters receive their catalogued minutes, seconds or enum value. A provider without a duration setting keeps its own duration.

## Destination choices

| Mode     | Result                                                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `native` | Use the shared poll through the destination's supported poll settings.                                                        |
| `text`   | Append the shared question and numbered answers to the destination body.                                                      |
| `omit`   | Keep the destination body and exclude the poll.                                                                               |
| `custom` | Use the independent `poll` content object on this destination choice. It has the same content fields, without `destinations`. |
| `legacy` | Preserve existing destination `poll_*` settings. Used when adopting a shared poll into an older draft.                        |

Missing choices remain unresolved, including accounts added later. Drafts may save in that state; validation and delivery reject it. Choosing `text` or `omit` is a normal variant, not a warning. Removing a destination does not rewrite the remaining choices. Reopening or copying a Publication preserves the canonical poll and its choices.

Text and media overrides are independent from poll choices. The composer can materialize a text version into a body override for editing; that explicit action sets its poll mode to `omit` to prevent appending the same text again.

## Projection and validation

`services/publicationpoll` resolves the canonical value into provider body and settings without modifying authored data. The API materializes that output on create and update, including canonical-only edits. The publisher resolves again before the first provider write. Store authored body overrides separately from generated poll text; copying rendered text back as an override duplicates questions on the next save.

Native validation uses the provider catalogue, then account-resolved constraints. Do not truncate answers, change choices or silently fall back to text. LinkedIn receives its separate question and canonical duration enums; old `ONE_WEEK` and `TWO_WEEKS` inputs remain accepted and map to `SEVEN_DAYS` and `FOURTEEN_DAYS`. Pixelfed's unverified poll setting is unavailable to new shared native polls.

Each thread segment owns its poll. A destination that joins a thread may use explicit text or omit choices. It cannot carry native, custom or legacy polls across the join. Joined text versions append poll blocks in source order after the combined body. The preview follows the same order. The composer blocks conversion to one post when later segments contain shared polls, preserving their content for an explicit decision.

Removing the shared poll clears only generated poll text and settings. Independent legacy settings remain with their destination.

## Verification

- `publications_polls_test.go` exercises real HTTP persistence, canonical-only edits, custom and omitted choices, deletion, legacy preservation, and unresolved validation.
- `publicationpoll/poll_test.go` checks joined destination decisions.
- `linkedin_test.go` checks the outgoing poll payload, question, commas and duration aliases.
- `compose-preview.test.ts` checks per-segment options and comma preservation.
- `tests/app/composer-polls.spec.ts` checks editing, saving, reopening and editable text versions in both schemes at desktop, 390px and 320px. Provider readiness is a fixture; persistence uses the real API. It does not post to social networks.
