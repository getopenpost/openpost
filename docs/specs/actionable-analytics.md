# Actionable analytics

## Purpose

Help a founder decide what to make next, which account needs attention, and whether their publishing is earning attention. Retain the current Analytics surface and OpenPost's design system. Web and native mobile consume the same server calculations and query catalogue.

## Measurement contract

- Add a projected **Visibility** metric. Select one lifetime count per published output: prefer post impressions when available, otherwise content/video views. YouTube always uses video views; thumbnail, card and ad impressions never contribute. Preserve the underlying views/impressions values and measurement metadata. A measured zero remains available; missing data stays missing.
- Explain Visibility as platform-reported content displays or video plays, including repeats, rather than unique people or completed reads. Expose the contributing provider metric and coverage.
- `summary.visibility` is a `MetricSummary`; `content[].visibility` is an optional `{value, metric, basis}` with metric `views|impressions` and basis `post_displays|content_views|video_views`. `publications[].visibility` is a `MetricSummary`. `trends.visibility` follows existing stored snapshot delta semantics, without mixing measurement sources or periods across a delta.
- `visibility_breakdown` contains `{platform, metric, basis, value, measured}` over the full filtered population. Summaries, rankings, account performance and takeaways never depend on the loaded page.
- `performance` contains one row per relevant account: `account_id`, `platform`, `username`, optional `avatar_url`, `published` (output count), `publication_count` (distinct posts), `visibility`, `engagement` (both MetricSummary), optional `followers`, optional `follower_delta`, and `status`. Retain historical output accounts where relevant. Account selection scopes every reported content aggregate and action.
- `highlights` contains at most five distinct posts, represented by their strongest measured output for the selected sort. A duplicate cross-post must not consume several top-post positions. Unknown measurements never outrank measured zero.
- Support `visibility` as an additive content sort, retaining existing `views`, `engagement` and `newest` API compatibility. Original metrics remain inspectable.
- Date filters select **posts published in the chosen period**; their lifetime outcome totals must not be labelled as events received only during that period. Follower changes and daily snapshot changes retain their separate measurement meaning. Do not infer sales, causation, unique audiences or population benchmarks.

## Actions

Add `takeaways` as a server-derived list of at most three evidence-backed actions. A takeaway contains `kind` (`repurpose_post|restore_measurements`), `account_id`, `platform`, `username`, optional `reference`, `value`, optional `baseline`, `measured_count`, `comparison_sample`, and `reason`.

- A repurpose candidate must beat its own account's comparable engagement baseline with sufficient measured history (at least three comparable outputs; a real positive improvement, not an all-zero sample). Use immutable stored snapshots and preserve measurement-period compatibility. Include the source reference and numeric evidence. Do not claim it caused growth or guarantee a repeat result. Hand off through the existing repurpose owner, creating no post until the user continues.
- A measurement recovery action identifies a connected account with an actionable collection/authentication failure. Link to the existing account/connection settings. Unsupported providers alone are not a broken connection. Avoid multiple identical recovery cards.
- Prefer a useful empty explanation to fabricated advice. Use deterministic calculations; no classifier or LLM is required for these decisions.

## Web and native UX

Keep date and account controls mounted through loading and failures. Add month-to-date and last-month presets through one shared UTC helper, retaining custom and all-time ranges. Show distinct post count prominently and output count as secondary context.

Lead with available takeaways, then a compact summary, the visibility/engagement/follower chart, account performance, and ranked post performance. Account rows drill into the existing account filter. Post actions open the native post or the existing repurpose handoff. Show coverage with an inspectable explanation of unmeasured accounts/outputs and provider definitions. Use appropriate native controls and layouts instead of a squeezed desktop table.

Retain export, refresh, paging, source links, read-only permissions, offline/cached state, localization and existing recovery paths. No generic posting-frequency targets, cross-customer benchmarks, automatic reposting, new paid AI dependency or pretend YouTube thumbnail data.

## Verification

Exercise provider selection, double-count prevention, measured zero, missing values, compatible deltas, complete-population ranking, account filtering, retired accounts, and evidence eligibility at their owning boundaries. Regenerate API contracts. Check web desktop/390/320 widths in light/dark, keyboard and touch, plus native type/source checks and the available native visual harness. Keep local, committed and deployed evidence distinct.
