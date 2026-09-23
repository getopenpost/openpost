### Added

- TypeScript SDK: structured retry dispositions on every error (`never`, `after-delay`, `after-reconnect`, `reconcile-first`), JSON serialization, and a new `ambiguous` code for requests that may have executed. Drive retry buttons and automation from `disposition`, not the boolean alone.
- TypeScript SDK: per-rendition outcome helpers. `describeRendition` requires the provider native id before reporting `published` and maps unprovable rows to `unknown`; `summarizePublication` reports `pending`, `complete`, or `partial`.
- TypeScript SDK: a deterministic `@getopenpost/sdk/testing` mock with scenario-driven publish behavior (`immediate-success`, `processing-then-success`, `mixed-success-failure`, `rate-limited`, `reconnect-required`, `ambiguous-accept`), an `advance()` latch, operation history, and reset. The subpath is separate from the root import so production bundles never carry it.
- TypeScript SDK: a bounded `iterateOffsetPages` helper for offset-paged lists with `maxPages` and `maxItems` guards.
