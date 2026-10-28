# Publication mentions

Mention selections are authored text plus stable provider identities. Editors are adapters: web uses Tiptap's minimal paragraph, text, break, history and mention schema; native uses EnrichedTextInput. Neither HTML nor editor document JSON is publication state. Formatting is outside the current schema.

## Stored contract

Canonical segment `settings.mentions` and independent rendition segment `settings.mentions` contain version 1 metadata. Joined rendition `source_overrides[].mentions` belongs beside that source's `body_override`. Native joined captions use the first rendition segment's `settings.caption_mentions`: `{ "field": "description", "body": "Hi @alice", "mentions": { "version": 1, "spans": [] } }` (`video_description` for Facebook). This whole-caption text and metadata are independent of source overrides. Reads, readiness and provider dispatch project its selected Workspace mappings through the shared publication source owner. Empty spans explicitly remove tagging. Reset clears the native caption setting and sets `caption_mentions: null`, restoring the joined sources without changing their edits or selections.

```json
{
  "version": 1,
  "spans": [
    {
      "start": 3,
      "end": 9,
      "text": "@alice",
      "target": {
        "provider": "bluesky",
        "kind": "person",
        "id": "did:plc:ewvi7nxzyoun6zhxrhs64oiz"
      }
    }
  ]
}
```

This example annotates `Hi @alice`. Ranges are half-open UTF-8 byte offsets, never JavaScript UTF-16 offsets. Every range must match its text, end on Unicode boundaries, and remain ordered and nonoverlapping. A field supports at most 50 selected mentions. Provider identity includes authority for Mastodon. LinkedIn currently accepts organization URNs, not unrestricted member lookup.

Missing metadata retains legacy provider behavior. Explicit `spans: []` removes selected tagging while keeping text. Bluesky automatic handle detection remains available for legacy text, including legacy sources in a joined output. A literal qualified Mastodon address can itself mention an account because the provider parses it.

## Inheritance and compatibility

Text and its annotations inherit together. Detaching text snapshots its selected identities; relinking restores canonical text and annotations. Missing source overrides inherit, an explicit empty body omits that source, and legacy whole-output overrides remain whole-output edits. Joined projection trims and separates sources using the existing publication owner, then remaps byte ranges.

Plain clients can update unannotated text normally. On annotated text, unchanged content preserves selections. Safe surrounding edits shift ranges; an unambiguous unchanged label can retain identity after a rewrite. Removing occurrences of a duplicated selected label is ambiguous even if a prefix or suffix still matches. Ambiguous or changed labels require explicit annotations and fail atomically instead of silently retargeting a mention. Canonical-only updates refresh inherited destination text. Older independent variants without an explicit override acquire one before canonical annotations can be inherited. Replacing independent variants must retain their annotated segment authorship. Use structured segment input to intentionally edit selected identities. An unchanged rendition text projection echoed without an explicit override retains its previous authored text and inheritance before annotation preservation runs.

An identity-only change advances the publication authorship revision. Provider encodings do not. The publisher resolves every segment before any write, freezes its generated projection in the provider-write plan, and excludes caller-supplied `authored_mentions` settings. Poll and link projection retain their existing owners.

## Discovery and delivery

`GET /accounts/{account_id}/mentions?query=...` requires account read access in the active Workspace. Discovery uses that account's current grant. Permission, rate-limit and upstream failures remain distinct from a successful empty result. Lookup does not publish anything.

- Bluesky search returns stable DIDs. Delivery emits UTF-8 facets without resolving a selected mutable handle again.
- Mastodon search runs on the connected instance. Selection records instance authority, account ID and qualified address. Delivery checks that the selected ID still owns that address before writing.
- LinkedIn lookup uses an exact company page vanity name, where the application and grant allow organization lookup. Delivery emits native organization markup only from validated selections, preserving ordinary escaping and hashtags elsewhere.

The same lookup owner serves MCP `lookup_mentions`, CLI `account mentions`, SDK `accounts.lookupMentions`, web and mobile. REST and MCP publication mutations accept the same structured segments. CLI `post` and `publication` commands accept `--segments-file`; SDK publication types include the metadata. Body-only compatibility is enforced by the server, including clients that have not adopted the editor.

## Editor behavior

Reusable Workspace mentions use a `workspace` / `profile` target whose `profiles` array snapshots explicit network text and optional native identities. The saved library is discovery state, not a delivery-time dependency. Editing or deleting its entry never rewrites an inserted snapshot. Plain mappings and unmapped fallbacks contain no native identity. Mastodon native mappings remain scoped to their connected authority. Nested profiles are rejected.

`posttext.ForDestination` and `postTextForDestination` replace only selected byte ranges. The server applies that projection through `publicationsource.DeliveryText` to response text, validation, text-card rendering, and fenced provider-write plans. Stored canonical and rendition authorship remains unchanged, including inherited text and explicit independent overrides. Joined sources resolve through their existing source decisions before projection. Legacy auto-mention windows shift with the replaced text.

Workspace library reads and mutations use `/workspaces/{workspace_id}/mentions` with the existing Workspace reader/editor boundary. Native shared editors can insert saved entries; entry management uses the web composer. Web bare `@` shows saved entries and Add mention. Account-specific search keeps its two-character minimum and shows a prompt before the first search. Empty or failed searches do not capture vertical caret movement. The editor latches keyboard focus on entry, so pointer typing never acquires a focus outline merely by matching `:focus-visible`.

Selecting a suggestion inserts text and identity together. Editing inside a token removes its identity; undo restores both. Copying selected text retains structured identities where the destination accepts the provider and authority. Invalid or cross-network structured paste is rejected visibly. Ordinary text paste stays text. Identity is never inferred across networks from a matching display name.

Web keeps exact blank lines, image paste, direction detection, keyboard suggestions and undo. Native keeps plain text as the exact newline authority while decoding its private HTML projection. Opening an editor without edits preserves inheritance. The native dependency patch preserves quoted labels, escapes HTML attributes, and exposes the actual editable iOS text view to accessibility; suggestions reserve space above the keyboard. Native HTML accepts identities already read or selected by the actor in the same Workspace; unknown identities cannot enter through clipboard attributes.

## Verification boundaries

HTTP and MCP tests exercise real draft persistence, safe legacy edits, revision changes, authorization and atomic rejection. Provider tests inspect outgoing HTTP payloads and Mastodon's identity fence. CLI tests cover canonical attachment updates without rewriting independent annotated variants. Browser tests exercise lookup recovery, keyboard selection, UTF-8 shifts, undo, structured copying and real save/reload across thread parts. Native tests cover its private projection and existing thread/media save owners; simulator checks exercise the compiled editor against an isolated server. Provider search is simulated for UI checks; no live provider publication is implied.
