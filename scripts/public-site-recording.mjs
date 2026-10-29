#!/usr/bin/env node
import { spawnSync } from "node:child_process";

// Bookkeeping may bypass core CI only when the entire push changes content.
// Unknown, rewritten, initial or empty ranges cannot establish that guarantee.
export function isRecordingPush(root, before, head) {
  if (![before, head].every((sha) => /^[a-f0-9]{40}$/u.test(sha || "") && !/^0+$/u.test(sha)))
    return false;
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 30000 });
    if (result.status !== 0) throw new Error("Unknown push history");
    return result.stdout;
  };
  try {
    git("merge-base", "--is-ancestor", before, head);
    const files = git("diff", "--no-renames", "--name-only", "-z", before, head)
      .split("\0")
      .filter(Boolean);
    return (
      files.length > 0 &&
      files.every((file) => file === "CHANGELOG.md" || file.startsWith("changes/"))
    );
  } catch {
    return false;
  }
}
if (import.meta.main) console.log(isRecordingPush(process.cwd(), process.argv[2], process.argv[3]));
