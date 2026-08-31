import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

test("local and CI scans cover history without printing candidates", () => {
  assert.match(scanner, /gitleaks git/u);
  assert.match(scanner, /--full-history --all --diff-filter=tuxdb/u);
  assert.match(scanner, /base_revision\.\.\$head_revision/u);
  assert.equal(scanner.match(/--redact=100/gu)?.length, 1);
  assert.match(scanner, /--verbose/u);
  assert.match(scanner, /--is-shallow-repository/u);
  assert.match(config, /targetRules = \["generic-api-key"\]/u);
  assert.match(config, /condition = "AND"/u);
  assert.match(config, /audio-eq-panel\\\.svelte/u);
  assert.match(devenv, /pkgs\.gitleaks/u);
  assert.match(tasks, /"secret-scan"/u);
});

test("current-file scan includes tracked edits and excludes ignored files", async () => {
  const repository = await mkdtemp(path.join(tmpdir(), "openpost-secret-scan-test-"));
  const fakeBin = path.join(repository, "fake-bin");
  const logPath = path.join(repository, "gitleaks.log");

  try {
    await mkdir(path.join(repository, "scripts"));
    await mkdir(fakeBin);
    await writeFile(path.join(repository, "scripts", "scan-secrets.sh"), scanner);
    await chmod(path.join(repository, "scripts", "scan-secrets.sh"), 0o755);
    await writeFile(path.join(repository, ".gitleaks.toml"), config);
    await writeFile(path.join(repository, ".gitignore"), ".ignored/\n");
    await writeFile(path.join(repository, "tracked.txt"), "committed content\n");
    await writeFile(path.join(repository, "deleted.txt"), "deleted content\n");
    await writeFile(path.join(repository, "shadow"), "tracked file\n");
    await writeFile(
      path.join(fakeBin, "gitleaks"),
      `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  version)
    printf '8.30.1\\n'
    ;;
  git)
    printf 'git\\n' >> "$OPENPOST_TEST_GITLEAKS_LOG"
    ;;
  dir)
    target="\${@: -1}"
    test "$(cat "$target/tracked.txt")" = "working tree content"
    test ! -e "$target/.ignored/secret.txt"
    test ! -e "$target/deleted.txt"
    test ! -e "$target/shadow"
    printf 'dir\\n' >> "$OPENPOST_TEST_GITLEAKS_LOG"
    ;;
  *)
    exit 90
    ;;
esac
`,
    );
    await chmod(path.join(fakeBin, "gitleaks"), 0o755);

    execFileSync("git", ["init", "--quiet"], { cwd: repository });
    execFileSync("git", ["add", "."], { cwd: repository });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=OpenPost Test",
        "-c",
        "user.email=test@openpost.local",
        "commit",
        "--quiet",
        "-m",
        "fixture",
      ],
      { cwd: repository },
    );

    await writeFile(path.join(repository, "tracked.txt"), "working tree content\n");
    await unlink(path.join(repository, "deleted.txt"));
    await unlink(path.join(repository, "shadow"));
    await mkdir(path.join(repository, "shadow"));
    await writeFile(path.join(repository, "shadow", "untracked.txt"), "untracked content\n");
    await mkdir(path.join(repository, ".ignored"));
    await writeFile(path.join(repository, ".ignored", "secret.txt"), "ignored secret\n");

    execFileSync("bash", ["scripts/scan-secrets.sh"], {
      cwd: repository,
      env: {
        ...process.env,
        OPENPOST_TEST_GITLEAKS_LOG: logPath,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      },
      stdio: "ignore",
    });

    assert.equal(await readFile(logPath, "utf8"), "git\ndir\n");
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});
