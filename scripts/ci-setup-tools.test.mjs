import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const helper = new URL("./ci-setup-tools.sh", import.meta.url).pathname;

function setup(t, mode, { architecture = "amd64", distro = "Ubuntu", codename = "noble" } = {}) {
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
      sources=""
      for argument do
        case "$argument" in Dir::Etc::sourcelist=*) sources="\${argument#*=}" ;; esac
      done
      if [ "$MODE" = runner-mirror-timeout ] && [ -z "$sources" ]; then
        echo 'Azure package mirror exceeded setup deadline' >&2
        exit 124
      fi
      if [ -n "$sources" ]; then cat "$sources" >> "$LOG"; fi
      touch "$STATE"
    `,
    lsb_release: `
      case "$*" in -is) echo "$TEST_DISTRO" ;; -cs) echo "$TEST_CODENAME" ;; *) exit 2 ;; esac
    `,
    dpkg: `
      [ "$*" = --print-architecture ] || exit 2
      echo "$TEST_ARCHITECTURE"
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
      TEST_DISTRO: distro,
      TEST_CODENAME: codename,
      TEST_ARCHITECTURE: architecture,
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
  assert.match(result.log, /apt -n env DEBIAN_FRONTEND=noninteractive apt-get .*install .*ffmpeg/u);
  assert.match(result.log, /bounded .*180s sudo/u);
  assert.ok(result.log.lastIndexOf("probe ") > result.log.lastIndexOf("apt "));
});

test("a slow runner mirror is bypassed by isolated signed Ubuntu HTTPS sources", (t) => {
  const result = setup(t, "runner-mirror-timeout");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.log, /Dir::Etc::sourceparts=-/u);
  assert.match(result.log, /URIs: https:\/\/archive\.ubuntu\.com\/ubuntu/u);
  assert.match(result.log, /URIs: https:\/\/security\.ubuntu\.com\/ubuntu/u);
  assert.match(result.log, /Suites: noble noble-updates noble-backports/u);
  assert.match(result.log, /Suites: noble-security/u);
  assert.match(result.log, /Signed-By: \/usr\/share\/keyrings\/ubuntu-archive-keyring\.gpg/u);
  assert.doesNotMatch(result.log, /allow-unauthenticated|trusted=yes|Verify-Peer=false/u);
  assert.ok(result.log.lastIndexOf("probe ") > result.log.lastIndexOf("apt "));
});

test("ARM runners keep using the signed official Ubuntu ports archive", (t) => {
  const result = setup(t, "fallback", { architecture: "arm64" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.log, /URIs: https:\/\/ports\.ubuntu\.com\/ubuntu-ports/u);
  assert.doesNotMatch(result.log, /URIs: https:\/\/(archive|security)\.ubuntu\.com/u);
});

for (const [options, diagnostic] of [
  [{ distro: "Debian" }, /requires an Ubuntu runner/u],
  [{ codename: "noble invalid" }, /Invalid Ubuntu release codename/u],
]) {
  test(`invalid runner identity cannot select package sources: ${JSON.stringify(options)}`, (t) => {
    const result = setup(t, "fallback", options);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, diagnostic);
    assert.doesNotMatch(result.log, /apt /u);
  });
}

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
