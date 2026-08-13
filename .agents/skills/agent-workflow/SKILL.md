---
name: agent-workflow
description: Route substantial OpenPost feature, refactor, or multi-ticket work through discovery, specification, ticketing, implementation, review, QA follow-ups, and optional handoff. Use when a request is ambiguous, spans modules, needs an issue/spec, or should continue across fresh agent contexts; skip the full flow for tiny well-scoped fixes.
---

# OpenPost Agent Workflow

Use the lightest branch that keeps the work correct. A tiny, explicit fix can go straight to implementation and targeted verification.

1. Pull context. Read `CONTEXT.md`, `docs/agents/repository-map.md`, `docs/agents/issue-tracker.md`, and the relevant ADRs or design decisions. Verify current paths and symbols before planning.
2. Resolve ambiguity with `grilling`. Finish only when the decision frontier is empty and the user confirms the shared understanding. For already precise requests, preserve that precision and continue.
3. Preserve module shape with `to-spec`, using `codebase-design` when the public seam or module boundary is unsettled. Explore current code before specifying it: a spec must describe the system that exists, not become a substitute for reading it. Before ticketing, review the generated spec with the user at least for acceptance criteria, exclusions, migrations and compatibility, module interfaces, verification, and operational or rollback effects. The conversation is not proof that its summary preserved every decision.
4. After the user approves the spec, use `to-tickets`. Create narrow vertical tracer bullets, record genuine blocking edges, and size each ticket for one fresh context. For each ticket, record expected change surfaces—Go packages, Svelte routes or shared components, database objects, API or generated contracts, provider behavior, and public docs/assets where relevant. Parallelize only tickets whose surfaces and invariants do not conflict. Do not publish or mutate tracker state without the authority required by `docs/agents/issue-tracker.md`.
5. Implement one unblocked ticket in a fresh context with `implement`. Re-read only that ticket, its direct dependencies, the repository map, domain glossary, relevant decisions, recent commits, and live code; do not preload every full backlog item. Use `tdd` at the public seams agreed in the spec, one red-green slice at a time. Confirm red failed because the intended behavior was missing—not because of an import, typo, or broken fixture.
6. Keep feedback targeted: run the closest test, typecheck, and lint families during the ticket; use broader gates once at the end in proportion to risk. Record exact commands and outcomes. Persistence or migration work must also pass from a clean database or equivalent fresh state.
7. Review from a fresh context with `code-review`, comparing a fixed point on both Standards and Spec axes. Then exercise the user-visible acceptance path manually or in the browser where applicable; passing tests and type checks are not proof that the integrated flow works. QA findings that are outside the ticket become new tickets with their own scope, surfaces, and blocking edges; keep the current ticket bounded.
8. Use `handoff` only when another context or human must continue unfinished work. Otherwise close with verified results and remaining tickets.

Tracker labels and live setup are configured in `docs/agents/triage-labels.md`. Run `bun run agents:doctor` before tracker-driven workflow work.
