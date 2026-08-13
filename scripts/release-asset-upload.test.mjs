import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("draft discovery and transient asset upload failures are retried", () => {
  const directory = mkdtempSync(join(tmpdir(), "openpost-release-upload-"));
  const fakeGh = join(directory, "gh");
  const calls = join(directory, "calls");

  writeFileSync(
    fakeGh,
    `#!/usr/bin/env bash
set -euo pipefail
calls="${calls}"
if [[ "$1 $2" == "release view" ]]; then
  count="$(grep -c '^view$' "$calls" 2>/dev/null || true)"
  echo view >> "$calls"
  if [[ "$count" -lt 2 ]]; then
    exit 1
  fi
  printf 'true\\tfalse\\tv9.9.9\\n'
  exit 0
fi
if [[ "$1 $2" == "release upload" ]]; then
  count="$(grep -c '^upload' "$calls" 2>/dev/null || true)"
  printf 'upload %s\\n' "$*" >> "$calls"
  if [[ "$count" -lt 1 ]]; then
    exit 1
  fi
  exit 0
fi
exit 2
`,
  );
  chmodSync(fakeGh, 0o755);

  try {
    const result = spawnSync(
      "bash",
      [
        "scripts/release-asset-upload.sh",
        "openpost-cli-linux-arm64",
        "openpost-mcp-linux-arm64",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          GH_TOKEN: "test-token",
          GITHUB_REF_NAME: "v9.9.9",
          GITHUB_REPOSITORY: "openpost/test",
          OPENPOST_RELEASE_ASSET_RETRY_DELAY_SECONDS: "0",
          PATH: `${directory}:${process.env.PATH}`,
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const log = readFileSync(calls, "utf8");
    assert.equal(log.match(/^view$/gmu)?.length, 3);
    assert.equal(log.match(/^upload /gmu)?.length, 2);
    assert.match(log, /openpost-cli-linux-arm64/u);
    assert.match(log, /openpost-mcp-linux-arm64/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a hung asset upload is terminated and retried", () => {
  const directory = mkdtempSync(join(tmpdir(), "openpost-release-upload-"));
  const fakeGh = join(directory, "gh");
  const calls = join(directory, "calls");

  writeFileSync(
    fakeGh,
    `#!/usr/bin/env bash
set -euo pipefail
calls="${calls}"
if [[ "$1 $2" == "release view" ]]; then
  printf 'true\\tfalse\\tv9.9.9\\n'
  exit 0
fi
if [[ "$1 $2" == "release upload" ]]; then
  count="$(grep -c '^upload$' "$calls" 2>/dev/null || true)"
  echo upload >> "$calls"
  if [[ "$count" -lt 1 ]]; then
    sleep 30
  fi
  exit 0
fi
exit 2
`,
  );
  chmodSync(fakeGh, 0o755);

  try {
    const result = spawnSync(
      "bash",
      ["scripts/release-asset-upload.sh", "openpost-server-windows-amd64.exe"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          GH_TOKEN: "test-token",
          GITHUB_REF_NAME: "v9.9.9",
          GITHUB_REPOSITORY: "openpost/test",
          OPENPOST_RELEASE_ASSET_RETRY_DELAY_SECONDS: "0",
          OPENPOST_RELEASE_ASSET_UPLOAD_TIMEOUT_SECONDS: "1",
          PATH: `${directory}:${process.env.PATH}`,
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(calls, "utf8").match(/^upload$/gmu)?.length, 2);
    assert.match(result.stderr, /timed out after 1 seconds/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
