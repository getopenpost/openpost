---
name: agent-workflow
description: Coordinate substantial OpenPost features, refactors, or multi-ticket work. Use when scope, module boundaries, or dependencies need to be recorded for implementation. Small, explicit changes go directly to implementation and scoped verification.
---

# OpenPost Agent Workflow

Follow the user's authorized scope through implementation and verification. Use the branches below only when the task needs them. Approval requirements live in `AGENTS.md`; routine planning and test placement do not add approval gates.

1. **Establish scope.** Inspect the worktree, `docs/agents/repository-map.md`, and the owning code. Recall relevant Hindsight decisions and verify them against current sources. Read the matching Vikunja task when one exists. Continue when the requested outcome, affected surfaces, and verification boundary are clear. Ask only about unresolved choices that change the outcome, compatibility, or authorization. Use `grilling` only for a requested design interview.
2. **Record substantial work.** Create or update the internal Vikunja task with the outcome, acceptance criteria, exclusions, affected interfaces, and verification. Record migrations and rollback needs when applicable. Split only work that needs independent execution, and record real blocking dependencies. Existing user authorization covers routine specification and ticketing; seek input on new product or compatibility decisions. Use available `codebase-design` guidance when a module boundary is unsettled.
3. **Implement through the owner.** Work on an unblocked slice. Keep relevant context and resume in the current task unless a separate context is needed. Follow the repository's regression-test contract, choosing the public boundary from acceptance criteria and existing tests. Run focused checks after meaningful changes. Persistence and migration changes need evidence from a clean database or equivalent fresh state.
4. **Review and verify.** Review the candidate against the request and repository standards. Use the available `code-review` skill for substantial changes or an explicit review request; review small changes locally. Fix supported findings, then check the affected behavior. Complete the scoped root gates and exercise the user-visible path where applicable. Repeat checks only for new edits, failures, or unresolved risks.
5. **Deliver.** Follow `AGENTS.md` for changelogs, commits, pushes, and production approval. Record commands and outcomes in the Vikunja task. Leave unrelated findings as separate tasks. Report the result and any remaining blocker. Hand off only when another context or person must continue unfinished work.

Skills supplied by the agent environment may live outside this checkout. Read their actual instructions before use; this workflow does not assume a specific review protocol or require local copies of global skills. If a context service is unavailable, report the limitation and continue work that current code and the user request establish. Keep internal task state in Vikunja.

Run `bun run check -- agents` when changing this workflow or its checker. `docs/agents/triage-labels.md` maps public GitHub intake labels; it does not configure private Vikunja work.
