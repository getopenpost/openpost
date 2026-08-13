# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Description                              | Color    |
| -------------------------- | -------------------- | ---------------------------------------- | -------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  | `fbca04` |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information | `d876e3` |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  | `0e8a16` |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            | `1d76db` |
| `wontfix`                  | `wontfix`            | Will not be actioned                     | `ffffff` |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

This table is configuration, not proof that the labels exist on GitHub. Run `bun run agents:doctor` to validate the local workflow files and, when GitHub CLI access is available, compare this configuration with live labels. The doctor is read-only; missing labels are reported with explicit `gh label create` commands for a maintainer to review and run.

Edit the tracker-label column, description, and color together when the repository vocabulary changes.
