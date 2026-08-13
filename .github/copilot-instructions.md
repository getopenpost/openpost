# Copilot Instructions

Read and follow [`AGENTS.md`](../AGENTS.md) before changing this repository. It
owns the development workflow and architecture rules. For product or interface
work, also read:

- [`PRODUCT.md`](../PRODUCT.md) for the current audience, product model, and
  scope;
- [`DESIGN.md`](../DESIGN.md) for the current brand, tokens, typography, layout,
  and interaction direction.

Treat those files and the implemented shared components as authoritative. Do
not maintain a second design manifesto here.

Keep these invariants in mind:

- OpenPost is founder-first, with the managed app as the primary path and
  self-hosting as a supported option.
- The authenticated application is compact and task-focused. Public surfaces
  can be more expressive and spacious, while remaining factual, responsive,
  accessible, and complete in both themes.
- Use Svelte 5 runes and the shared UI primitives described in `AGENTS.md`.
- Source provider lists and totals from the provider catalog and current
  readiness evidence. Never copy a static provider count into product guidance.
- Verify product, plan, provider, security, and deployment claims against the
  current code or an official source before publishing them.
