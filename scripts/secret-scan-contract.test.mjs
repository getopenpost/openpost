import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [workflow, scanner, config, devenv, tasks] = await Promise.all([
  readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
  readFile(new URL("./scan-secrets.sh", import.meta.url), "utf8"),
  readFile(new URL("../.gitleaks.toml", import.meta.url), "utf8"),
  readFile(new URL("../devenv.nix", import.meta.url), "utf8"),
  readFile(new URL("./tasks.mjs", import.meta.url), "utf8"),
]);

test("policy CI verifies the pinned scanner before a candidate-history scan", () => {
  const policyJob = workflow.slice(
    workflow.indexOf("  policy:\n"),
    workflow.indexOf("  backend-lint:\n"),
  );
  assert.match(policyJob, /fetch-depth: 0/u);
  assert.match(workflow, /GITLEAKS_VERSION: "8\.30\.1"/u);
  assert.match(workflow, /GITLEAKS_LINUX_X64_SHA256: "[0-9a-f]{64}"/u);
  assert.match(policyJob, /sha256sum --check --status/u);
  assert.match(policyJob, /OPENPOST_SECRET_SCAN_BASE/u);
  assert.match(policyJob, /OPENPOST_SECRET_SCAN_HEAD/u);
  assert.match(policyJob, /bun run check -- policy/u);
});

test("local and CI scans cover history and current files without printing candidates", () => {
  assert.match(scanner, /gitleaks git/u);
  assert.match(scanner, /--full-history --all --diff-filter=tuxdb/u);
  assert.match(scanner, /base_revision\.\.\$head_revision/u);
  assert.match(scanner, /gitleaks dir/u);
  assert.equal(scanner.match(/--redact=100/gu)?.length, 1);
  assert.match(scanner, /--verbose/u);
  assert.match(scanner, /--is-shallow-repository/u);
  assert.match(config, /targetRules = \["generic-api-key"\]/u);
  assert.match(config, /condition = "AND"/u);
  assert.match(config, /audio-eq-panel\\\.svelte/u);
  assert.match(devenv, /pkgs\.gitleaks/u);
  assert.match(tasks, /"secret-scan"/u);
});
