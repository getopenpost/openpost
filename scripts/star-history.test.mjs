import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const workflow = readFileSync(".github/workflows/readme-assets.yml", "utf8");
const probe = workflow
  .match(/- name: Check for new stars[\s\S]*?run: \|\n((?: {10}[^\n]*\n)+)/)?.[1]
  .replace(/^ {10}/gm, "");

for (const [name, previous, current, expected] of [
  ["unchanged stars skip the update", "42", "42", "changed=false\n"],
  ["lost stars skip the update", "42", "41", "changed=false\n"],
  ["new stars update the chart", "42", "43", "changed=true\ncount=43\n"],
  ["first run establishes a baseline", null, "42", "changed=true\ncount=42\n"],
]) {
  test(name, () => {
    assert.ok(probe, "workflow must check stars before rendering");
    const dir = mkdtempSync(join(tmpdir(), "star-history-test-"));
    try {
      mkdirSync(join(dir, "assets/star-history"), { recursive: true });
      if (previous !== null) writeFileSync(join(dir, "assets/star-history/.star-count"), previous);
      const output = join(dir, "output");
      execFileSync(
        "bash",
        ["-e", "-o", "pipefail", "-c", `gh() { printf '%s\\n' "$TEST_STAR_COUNT"; }\n${probe}`],
        {
          cwd: dir,
          env: {
            ...process.env,
            TEST_STAR_COUNT: current,
            GITHUB_OUTPUT: output,
          },
        },
      );
      assert.equal(readFileSync(output, "utf8"), expected);
      if (previous !== null) {
        assert.equal(readFileSync(join(dir, "assets/star-history/.star-count"), "utf8"), previous);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
