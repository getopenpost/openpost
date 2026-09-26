## Fixed

Repaired the `lint:oxlint` gate, which was failing on 24 anti-slop errors across 11 browser regression test files. Every `as` assertion now carries a `SAFETY:` comment stating the checked invariant, the four render-helper `Record<string, unknown>` props are typed as owner-derived `Partial<ComponentProps<typeof ...>>`, and the curves `middleOutput` helper takes the typed mock-call tuple instead of `unknown`.
