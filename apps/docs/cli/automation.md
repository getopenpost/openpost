# Automate the CLI

You can use the CLI in CI, cron, and deploy jobs without a browser. Create an API token in OpenPost, then pass it through an environment variable or standard input.

## Environment

| Variable                    | Purpose                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `OPENPOST_TOKEN`            | API token for use without a browser.                                                             |
| `OPENPOST_INSTANCE`         | Default OpenPost instance URL.                                                                   |
| `OPENPOST_WORKSPACE`        | Default workspace ID or name.                                                                    |
| `OPENPOST_OUTPUT_JSON=true` | Default JSON output for scripts. You can also set `output = "json"` in the selected CLI profile. |
| `OPENPOST_PROFILE`          | Selects a named CLI profile.                                                                     |

Useful flags:

| Flag                     | Purpose                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `--yes`                  | Skip confirmation prompts.                                                                            |
| `--json`                 | Print machine-readable JSON for one command.                                                          |
| `--accounts <selectors>` | Select accounts by ID, short name, or social network. Omit it for a draft with no accounts.           |
| `--schedule next-slot`   | Use the next available posting schedule slot instead of posting immediately or choosing a fixed time. |

For repeat jobs, always set `--accounts` and `--schedule next-slot`. `next-slot` uses the posting schedule for the selected workspace.

`--json` only changes the output. Commands that delete data or create many items still need `--yes` when no person can answer the prompt.

## GitHub Actions Example

```yaml
name: Daily Build Summary

on:
  schedule:
    - cron: "0 17 * * 1-5"

jobs:
  post-summary:
    runs-on: ubuntu-latest
    env:
      OPENPOST_INSTANCE: ${{ secrets.OPENPOST_INSTANCE }}
      OPENPOST_TOKEN: ${{ secrets.OPENPOST_TOKEN }}
      OPENPOST_WORKSPACE: ${{ secrets.OPENPOST_WORKSPACE }}
      OPENPOST_OUTPUT_JSON: "true"
    steps:
      - name: Install OpenPost CLI
        run: curl -fsSL https://raw.githubusercontent.com/getopenpost/openpost/main/scripts/install-cli.sh | sh

      - name: Post summary
        run: |
          openpost post create \
            --content "Daily build completed for ${GITHUB_REPOSITORY}@${GITHUB_SHA}" \
            --accounts x \
            --schedule next-slot \
            --yes \
            --json
```

See every command and flag in the [CLI Reference](/reference/cli).
