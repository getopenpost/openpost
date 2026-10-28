import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const helper = new URL("./ci-setup-tools.sh", import.meta.url).pathname;

function setup(t, mode) {
  const directory = mkdtempSync(path.join(tmpdir(), "ci-tools-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const commands = {
    ffmpeg: `
      echo "encode $*" >> "$LOG"
      if [ "$MODE" != ready ] && [ ! -e "$STATE" ]; then
        echo 'fixture codec unavailable' >&2
        exit 1
      fi
      [ "$MODE" != broken ] || exit 1
      for output do :; done
      touch "$output"
    `,
    ffprobe: `
      echo "probe $*" >> "$LOG"
      [ "$MODE" != probe-broken ] || exit 1
      [ "$MODE" != wrong-codec ] || { echo unexpected; exit 0; }
      case "$*" in
        *mp4*) printf 'h264\\naac\\n' ;;
        *vp9*) printf 'vp9\\nopus\\n' ;;
        *) printf 'vp8\\nopus\\n' ;;
      esac
    `,
    sudo: `
      echo "apt $*" >> "$LOG"
      [ "$MODE" != apt-fails ] || { echo 'mirror unavailable' >&2; exit 42; }
      touch "$STATE"
    `,
    timeout: `
      echo "bounded $*" >> "$LOG"
      shift 2
      [ "$MODE" != timeout ] || { echo 'setup deadline exceeded' >&2; exit 124; }
      exec "$@"
    `,
  };
  for (const [name, body] of Object.entries(commands)) {
    const file = path.join(directory, name);
    writeFileSync(file, `#!/bin/bash\nset -eu\n${body}\n`);
    chmodSync(file, 0o755);
  }
  const log = path.join(directory, "commands");
  writeFileSync(log, "");
  const result = spawnSync("bash", [helper, "media"], {
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      MODE: mode,
      LOG: log,
      STATE: path.join(directory, "installed"),
    },
    encoding: "utf8",
    timeout: 10_000,
  });
  return { ...result, log: readFileSync(log, "utf8") };
}

test("checks every fixture format before reusing media tools", (t) => {
  const result = setup(t, "ready");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.log, /encode .*libx264/u);
  assert.match(result.log, /encode .*libvpx /u);
  assert.match(result.log, /encode .*libvpx-vp9/u);
  for (const extension of ["mp4", "webm", "vp9.webm"]) {
    assert.ok(
      result.log
        .split("\n")
        .some((line) => line.startsWith("probe ") && line.endsWith(`/fixture.${extension}`)),
      extension,
    );
  }
  assert.doesNotMatch(result.log, /apt /u);
});

test("unusable installed tools trigger bounded apt and are checked again", (t) => {
  const result = setup(t, "fallback");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.log, /apt .*update/u);
  assert.match(result.log, /apt .*install .*ffmpeg/u);
  assert.match(result.log, /bounded .*180s sudo/u);
  assert.ok(result.log.lastIndexOf("probe ") > result.log.lastIndexOf("apt "));
});

for (const [mode, diagnostic] of [
  ["apt-fails", /mirror unavailable/u],
  ["broken", /Media tools remain unusable/u],
  ["probe-broken", /Media tools remain unusable/u],
  ["wrong-codec", /Media tools remain unusable/u],
  ["timeout", /setup deadline exceeded/u],
]) {
  test(`setup fails visibly instead of allowing tests to proceed: ${mode}`, (t) => {
    const result = setup(t, mode);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, diagnostic);
  });
}
