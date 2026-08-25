# AI-native composer

## Product contract

OpenPost turns one source idea into one normal draft Publication with explicit,
native Renditions. The builder sits before the composer. It does not replace the
composer, publish content, create a campaign object, or rewrite one generic post
to several character limits.

The default creation flow is:

```text
Idea and source material
  -> factual kernel and direction
  -> destination selection
  -> independent platform drafts
  -> source fidelity and voice review
  -> draft Publication and Renditions
  -> normal composer review
```

`/` has two modes. Builder is the default when AI is configured. Manual mounts
the existing composer without changing its behavior. Existing deep links,
editor returns, prompt handoffs, and active-draft recovery stay in Manual mode.

## Builder input

The fast path needs only an idea. Optional source material includes bounded text,
Markdown, public HTTP(S) pages, and stored workspace files supported by the AI
provider. Source assets remain evidence by default. The builder can attach one to
the Publication only after the user marks it as usable output media.

The user chooses candidate destinations directly or through a Social Set. A
Social Set remains provenance and a candidate snapshot. The builder may skip a
weak destination and must explain why. "Use every supported destination" turns
that recommendation off. Unsupported platforms never receive generic copied
content.

Direction stays compact and optional:

- outcome;
- audience;
- angle;
- one-build tone adjustment;
- media preference;
- destination policy.

Auto is valid for every field. These controls live in one sheet, not a wizard.

## Voice Profiles

A Voice Profile belongs to a Workspace and contains identity, point of view,
writing guidance, language, phrases to avoid, and representative examples.
Platform behavior never lives in the profile.

Effective voice resolves in this order:

1. explicit build override;
2. connected-account assignment;
3. Workspace default.

Every Workspace has one default profile. Missing account assignments mean
inheritance. Profile mutations use revisions. The last profile and an active
default cannot disappear without a replacement.

## Generation model

The durable build owns bounded source references, a voice snapshot, direction,
candidate destinations, progress, validated output, safe model metadata, and a
sanitized error. Background work may resume after a process restart. A repeated
request with the same idempotency key and fingerprint returns the same build.

Generation has three roles:

1. The director extracts facts, thesis, audience, outcome, angle, claims, route,
   destination recommendations, and the job media should do.
2. Platform adapters draft independently from the same facts and Voice Profile.
3. The reviewer removes facts invented by the generator and flags copied
   structure, voice drift, weak platform fit, and stock AI phrasing. It does not
   demand proof for user assertions, anecdotes, opinions, predictions, or parody.

All model output is strict, bounded JSON. Model-selected IDs and output profiles
must come from server-supplied allowlists. Raw prompts, provider bodies, source
content, voice examples, and drafts never enter logs or telemetry.

The initial native adapters are LinkedIn, X, Mastodon, Bluesky, and Threads. Each
owns its objective, content routes, distribution context, media role, and safety
notes. New platforms require a real adapter. There is no generic microblog
fallback and no virality score.

The policies stay separate in the generation prompt. LinkedIn owns its visible
opening, dominant reaction, evidence, and visual job. X owns artifact-first text,
standalone link context, thread discipline, and explicit rejection of ranking
folklore. Mastodon owns federated distribution, instance rules, precise hashtags,
visibility, and alt-text expectations. Bluesky owns Following, Discover, custom
feed signals, source attribution, and separate feed eligibility. Threads owns
original wording, topic context, sincere reply paths, media context, and author
follow-up advice. The reviewer receives the same policies and rejects a Rendition
that reads like another platform with a new character limit.

## Publication integration

The successful build commits through the shared Publication application:

- one draft Publication;
- a clean platform-neutral canonical segment;
- explicit destination Renditions;
- independent destination segments, output profiles, format locks, and media;
- the Social Set ID as provenance when used;
- Builder plan metadata that survives ordinary composer saves.

A destination may expand one canonical idea into several thread segments. Its
capability checks use the actual rendition segments, not the canonical segment
count. The builder never pads the canonical Publication with fake segments.
Before generation, the Builder uses the same live account-capability resolver as
the composer and freezes the effective text and media limits into every candidate
destination. X fails closed to standard limits unless fresh account capability
data confirms Basic, Premium, or Premium+. Mastodon uses the connected instance's
reported character, attachment, size, and MIME limits when available.

The worker only prepares a validated package. The UI first shows the route,
destination plan, and media choices. An authenticated commit
action creates the Publication and links it to the build after the user chooses
to review it in the composer. Repeating commit returns the same Publication.

The editable composer shows one compact, collapsible Builder summary with the
direction, effective voice, destination decisions, review notes, and media plan.
All normal save, schedule, publish, retry, media-editor, and delete flows
remain unchanged.

## Source and discovery safety

Public URL loading uses `netguard` for the first request, every redirect, and
dial-time DNS resolution. It blocks private, local, metadata, proxy, credential,
and custom-port targets. It accepts bounded HTML and plain text only.

Discover is a separate entry into the same builder. When web search is available,
it returns cited content opportunities based on the Voice Profile, selected
destinations, recent Publications, and current primary sources. A card contains
why it fits, several angles, a short hook, source links, and recommended platform
treatments. Choosing a card fills the normal Builder. Discover never creates or
publishes a post on its own and never labels stale model memory as a trend.
OpenPost loads every cited page through the same guarded public-source path before
showing an opportunity. Build from source uses only the evidence the user supplied;
live web research stays in Discover and never adds unrequested facts to a build.

## Media contract

The build selects a media job and returns a detailed brief. It can recommend no
media, a source artifact, annotation, a meme, a statement card, a carousel, a
concept image, or a video treatment. Costly generation waits for the user's
choice. Existing Meme Maker, Image Editor, Video Editor, Media library, and
destination media overrides remain the asset-producing seams.

Source-bound jobs name one exact source that the user allowed OpenPost to use.
`use_source` attaches that asset only to the Renditions that selected it.
`annotate_source` and `edit_existing_video` pass it to the right editor as input;
the raw input is not added to the draft beside the finished export. Ready build
results persist only a safe source index with IDs, kinds, labels, and publication
permission. Extracted page text and media bytes never enter that index.

## Acceptance bar

- One sentence can become a normal editable multi-destination draft.
- Source failures happen before model generation and identify the bad source.
- Foreign Workspace account, media, Voice Profile, and build IDs never reach AI.
- Selected native destinations receive structurally distinct drafts, not trims.
- Every claim records whether it came from supplied evidence, a user assertion,
  opinion, parody, or uncertainty already present in the source. Missing proof
  alone never creates a warning.
- Malformed output receives at most one repair and never creates a Publication.
- Build, commit, retry, cancel, and reload remain idempotent.
- Builder-created Publications round-trip through normal editing and scheduling.
- English and Portuguese copy, keyboard use, visible focus, reduced motion,
  light and dark themes, and 320 px/390 px/desktop layouts meet the app bar.
