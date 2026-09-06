import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const script = join(dirname(fileURLToPath(import.meta.url)), "changed-files-check.sh");
const repositoryRoot = dirname(dirname(script));
const fixtures = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

function run(command, args, cwd, options = {}) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    input: options.input,
  });
}

function git(cwd, ...args) {
  const result = run("git", args, cwd);
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "openpost-changed-files-check-"));
  fixtures.push(cwd);
  git(cwd, "init", "--initial-branch=main");
  git(cwd, "config", "user.email", "test@openpost.local");
  git(cwd, "config", "user.name", "OpenPost test");
  writeFileSync(join(cwd, "tracked.txt"), "base\n");
  writeFileSync(join(cwd, "staged.txt"), "base\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "fixture");
  return cwd;
}

function formatterEnv(cwd) {
  const bin = join(cwd, "test-bin");
  mkdirSync(bin);
  const bunx = join(bin, "bunx");
  const oxfmt = join(repositoryRoot, "node_modules", ".bin", "oxfmt");
  writeFileSync(
    bunx,
    `#!/usr/bin/env bash\n[ "$1" = oxfmt ] || exit 2\nshift\nexec ${JSON.stringify(oxfmt)} "$@"\n`,
  );
  chmodSync(bunx, 0o755);
  return { PATH: `${bin}:${process.env.PATH}` };
}

describe("changed-files-check", () => {
  test("checks unstaged, staged, and untracked files in worktree mode", () => {
    const cwd = fixture();
    writeFileSync(join(cwd, "tracked.txt"), "changed\n");
    writeFileSync(join(cwd, "staged.txt"), "staged\n");
    git(cwd, "add", "staged.txt");
    writeFileSync(join(cwd, "untracked.txt"), "new\n");

    const result = run("bash", [script], cwd);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("changed-files-check: OK (3 changed files)");
  });

  test("checks only index changes in staged mode", () => {
    const cwd = fixture();
    writeFileSync(join(cwd, "tracked.txt"), "unstaged\n");
    writeFileSync(join(cwd, "staged.txt"), "staged\n");
    git(cwd, "add", "staged.txt");
    writeFileSync(join(cwd, "untracked.txt"), "new\n");

    const result = run("bash", [script, "--staged"], cwd);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("changed-files-check: OK (1 changed files)");
  });

  test("checks files between the remote and local revisions in pushed-range mode", () => {
    const cwd = fixture();
    const remoteSha = git(cwd, "rev-parse", "HEAD");
    writeFileSync(join(cwd, "tracked.txt"), "pushed\n");
    git(cwd, "add", "tracked.txt");
    git(cwd, "commit", "-m", "pushed change");
    const localSha = git(cwd, "rev-parse", "HEAD");
    const input = `refs/heads/topic ${localSha} refs/heads/topic ${remoteSha}\n`;

    const result = run("bash", [script, "--pushed-range"], cwd, { input });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("changed-files-check: OK (1 changed files)");
  });

  test("uses staged mode when installed as the pre-commit hook", () => {
    const cwd = fixture();
    writeFileSync(join(cwd, "tracked.txt"), "unstaged\n");
    writeFileSync(join(cwd, "staged.txt"), "staged\n");
    git(cwd, "add", "staged.txt");
    writeFileSync(join(cwd, "untracked.txt"), "<<<<<<< unresolved\n");
    const hook = join(cwd, ".git", "hooks", "pre-commit");
    copyFileSync(script, hook);

    const result = run("bash", [hook], cwd);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("changed-files-check: OK (1 changed files)");
  });

  test("uses pushed-range mode when installed as the pre-push hook", () => {
    const cwd = fixture();
    const remoteSha = git(cwd, "rev-parse", "HEAD");
    writeFileSync(join(cwd, "tracked.txt"), "pushed\n");
    git(cwd, "add", "tracked.txt");
    git(cwd, "commit", "-m", "pushed change");
    const localSha = git(cwd, "rev-parse", "HEAD");
    const hook = join(cwd, ".git", "hooks", "pre-push");
    copyFileSync(script, hook);
    const input = `refs/heads/topic ${localSha} refs/heads/topic ${remoteSha}\n`;

    const result = run("bash", [hook, "origin", "unused"], cwd, { input });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("changed-files-check: OK (1 changed files)");
  });

  test("allows an explicit pre-push bypass", () => {
    const cwd = fixture();

    const result = run("bash", [script, "--pushed-range"], cwd, {
      env: { OPENPOST_SKIP_PUSH_CHECK: "1" },
      input: "not a valid ref line\n",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("OPENPOST_SKIP_PUSH_CHECK=1");
  });

  test("skips tag-only and deletion-only pushes", () => {
    const cwd = fixture();
    const sha = git(cwd, "rev-parse", "HEAD");
    const zero = "0000000000000000000000000000000000000000";

    const tag = run("bash", [script, "--pushed-range"], cwd, {
      input: `refs/tags/v1 ${sha} refs/tags/v1 ${zero}\n`,
    });
    const deletion = run("bash", [script, "--pushed-range"], cwd, {
      input: `delete ${zero} refs/heads/old ${sha}\n`,
    });

    expect(tag.status, tag.stderr).toBe(0);
    expect(tag.stdout).toContain("tag push detected, skipping");
    expect(deletion.status, deletion.stderr).toBe(0);
    expect(deletion.stdout).toContain("deletion-only push detected, skipping");
  });

  test("rejects whitespace errors and unresolved conflict markers", () => {
    const whitespace = fixture();
    writeFileSync(join(whitespace, "tracked.txt"), "trailing space \n");
    const whitespaceResult = run("bash", [script], whitespace);

    const conflict = fixture();
    writeFileSync(join(conflict, "conflict.txt"), "<<<<<<< unresolved\n");
    const conflictResult = run("bash", [script], conflict);

    expect(whitespaceResult.status).not.toBe(0);
    expect(whitespaceResult.stdout + whitespaceResult.stderr).toContain("trailing whitespace");
    expect(conflictResult.status).not.toBe(0);
    expect(conflictResult.stderr).toContain("unresolved conflict marker in conflict.txt");
  });

  test("rejects invalid shell syntax and unformatted Go", () => {
    const shell = fixture();
    writeFileSync(join(shell, "broken.sh"), "if true; then\n");
    const shellResult = run("bash", [script], shell);

    const go = fixture();
    writeFileSync(join(go, "broken.go"), "package broken\nfunc broken(){println(1)}\n");
    const goResult = run("bash", [script], go);

    expect(shellResult.status).not.toBe(0);
    expect(shellResult.stderr).toContain("syntax error");
    expect(goResult.status).not.toBe(0);
    expect(goResult.stdout).toContain("broken.go");
  });

  test("rejects invalid Nix syntax", () => {
    const cwd = fixture();
    writeFileSync(join(cwd, "broken.nix"), "{ value = ; }\n");

    const result = run("bash", [script], cwd);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("syntax error");
  });

  test("rejects unformatted source and malformed Svelte", () => {
    const source = fixture();
    writeFileSync(join(source, "unformatted.js"), "const value={answer:42};\n");
    const sourceResult = run("bash", [script], source, { env: formatterEnv(source) });

    const svelte = fixture();
    mkdirSync(join(svelte, "apps/web"), { recursive: true });
    writeFileSync(join(svelte, "apps/web", ".oxfmtrc.json"), '{\n  "svelte": {}\n}\n');
    writeFileSync(join(svelte, "apps/web", "broken.svelte"), "{#if true}<div>{/each}\n");
    const svelteResult = run("bash", [script], svelte, { env: formatterEnv(svelte) });

    expect(sourceResult.status).not.toBe(0);
    expect(sourceResult.stdout + sourceResult.stderr).toContain("unformatted.js");
    expect(svelteResult.status).not.toBe(0);
    expect(svelteResult.stderr).toContain("CompileError: Unexpected block closing tag");
  });
});
