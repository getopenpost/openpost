import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { load } from "js-yaml";

const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const release = readFileSync(".github/workflows/release.yml", "utf8");
const workflows = readdirSync(".github/workflows", { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(?:ya?ml)$/u.test(entry.name))
  .map((entry) => ({
    name: entry.name,
    source: readFileSync(`.github/workflows/${entry.name}`, "utf8"),
  }));

function workflowStepScript(workflow, jobName, stepName) {
  const step = load(workflow).jobs[jobName].steps.find((step) => step.name === stepName);
  assert.ok(step?.run, `workflow step ${stepName} must have a command`);
  return step.run;
}

function writeMobileIdentity(directory, version, versionCode) {
  writeFileSync(
    path.join(directory, "apps/mobile", "app.json"),
    `${JSON.stringify({ expo: { version, android: { versionCode } } })}\n`,
  );
  writeFileSync(
    path.join(directory, "apps/mobile", "package.json"),
    `${JSON.stringify({ name: "mobile", version })}\n`,
  );
}

test("only the image CI job can write packages", () => {
  const jobs = load(ci).jobs;
  assert.deepEqual(
    Object.entries(jobs)
      .filter(([, job]) => job.permissions?.packages === "write")
      .map(([id]) => id),
    ["image"],
  );
});

for (const legacyLayout of [false, true]) {
  test(`a second tag compares against the existing release tag (legacy layout: ${legacyLayout})`, () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openpost-release-tags-"));
    try {
      mkdirSync(path.join(directory, "apps/mobile"), { recursive: true });
      mkdirSync(path.join(directory, "scripts"));
      copyFileSync(
        "scripts/mobile-release.mjs",
        path.join(directory, "scripts", "mobile-release.mjs"),
      );
      const git = (...args) => {
        const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
      };
      git("init");
      git("config", "user.email", "release-test@openpost.local");
      git("config", "user.name", "OpenPost Release Test");
      writeMobileIdentity(directory, "0.2.0", 2);
      git("add", ".");
      git("commit", "-m", "old release");
      git("tag", "v4.14.0");
      writeMobileIdentity(directory, "0.2.1", 3);
      git("add", ".");
      git("commit", "-m", "current release");
      if (legacyLayout) {
        git("mv", "apps/mobile", "mobile");
        git("commit", "--amend", "--no-edit");
      }
      git("tag", "v4.15.0");
      git("tag", "v4.15.1");
      assert.deepEqual(readdirSync(path.join(directory, ".git", "refs", "tags")).sort(), [
        "v4.14.0",
        "v4.15.0",
        "v4.15.1",
      ]);

      if (legacyLayout) {
        mkdirSync(path.join(directory, "apps"), { recursive: true });
        renameSync(path.join(directory, "mobile"), path.join(directory, "apps/mobile"));
      }
      const result = spawnSync(
        "bash",
        [
          "--noprofile",
          "--norc",
          "-e",
          "-o",
          "pipefail",
          "-c",
          workflowStepScript(release, "verify-candidate", "Require a new Android release identity"),
        ],
        {
          cwd: directory,
          encoding: "utf8",
          env: { ...process.env, GITHUB_REF_NAME: "v4.15.1" },
        },
      );
      assert.notEqual(result.status, 0);
      assert.equal(
        JSON.parse(readFileSync(path.join(directory, "previous-release-app.json"), "utf8")).expo
          .android.versionCode,
        3,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("external workflow actions are pinned to immutable commits", () => {
  const actionLine = /^\s*(?:-\s+)?uses:\s+([^\s#]+)/gmu;
  let externalActions = 0;

  for (const workflow of workflows) {
    for (const match of workflow.source.matchAll(actionLine)) {
      const target = match[1];
      if (target.startsWith("./")) continue;
      externalActions += 1;
      assert.match(
        target,
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.\/-]+)?@[a-f0-9]{40}$/u,
        `${workflow.name} has a mutable action reference: ${target}`,
      );
    }
  }

  assert.ok(externalActions > 0);
});

for (const [job, step, prefixes] of [
  ["build-binaries", "Build binary", ["server"]],
  ["build-cli", "Build CLI binaries", ["cli", "mcp"]],
]) {
  test(`${job} places every binary where the upload command expects it`, () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openpost-release-output-"));
    try {
      mkdirSync(path.join(directory, "apps/server"), { recursive: true });
      mkdirSync(path.join(directory, "apps/cli"), { recursive: true });
      mkdirSync(path.join(directory, "bin"));
      const go = path.join(directory, "bin/go");
      writeFileSync(
        go,
        '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = "-o" ]; then shift; printf binary > "$1"; exit; fi\n  shift\ndone\nexit 1\n',
      );
      chmodSync(go, 0o755);
      for (const matrix of load(release).jobs[job].strategy.matrix.include) {
        const command = workflowStepScript(release, job, step).replace(
          /\$\{\{ matrix\.(\w+) \}\}/gu,
          (_, key) => matrix[key],
        );
        const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", command], {
          cwd: directory,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${directory}/bin:${process.env.PATH}`,
            GITHUB_REF_NAME: "v4.0.0",
            GITHUB_SHA: "a".repeat(40),
          },
        });
        assert.equal(result.status, 0, result.stderr);
        for (const prefix of prefixes) {
          const name = `openpost-${prefix}-${matrix.os}-${matrix.arch}${matrix.ext}`;
          assert.ok(
            existsSync(path.join(directory, name)),
            `upload cannot find ${name} in the repository root`,
          );
        }
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("image promotion requires the downloaded digest and matching OCI identity", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "openpost-release-image-"));
  const revision = "a".repeat(40);
  const digest = `sha256:${"b".repeat(64)}`;
  try {
    mkdirSync(path.join(directory, "bin"));
    mkdirSync(path.join(directory, "tested-image"));
    // Stand in for remote Actions and registry I/O while executing the workflow's shell.
    for (const [name, command] of Object.entries({
      gh: "#!/bin/sh\nexit 0\n",
      docker: `#!/bin/sh
case "$1" in
  login) cat >/dev/null ;;
  pull) printf '%s' "$2" > pulled-image ;;
  inspect)
    case "$3" in
      *image.version*) printf '%s' "$TEST_IMAGE_VERSION" ;;
      *image.revision*) printf '%s' "$TEST_IMAGE_REVISION" ;;
      *) exit 1 ;;
    esac ;;
  *) exit 1 ;;
esac
`,
    })) {
      const file = path.join(directory, "bin", name);
      writeFileSync(file, command);
      chmodSync(file, 0o755);
    }
    for (const [imageDigest, imageVersion, imageRevision, succeeds] of [
      [digest, "v4.0.0", revision, true],
      [digest, "v3.9.0", revision, false],
      [digest, "v4.0.0", "c".repeat(40), false],
      ["latest", "v4.0.0", revision, false],
    ]) {
      writeFileSync(path.join(directory, "tested-image/image-digest.txt"), `${imageDigest}\n`);
      const output = path.join(directory, "output");
      writeFileSync(output, "");
      const result = spawnSync(
        "bash",
        [
          "-e",
          "-o",
          "pipefail",
          "-c",
          workflowStepScript(release, "verify-candidate", "Verify the tested image"),
        ],
        {
          cwd: directory,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${directory}/bin:${process.env.PATH}`,
            GH_TOKEN: "test",
            GITHUB_ACTOR: "test",
            GITHUB_REPOSITORY: "getopenpost/openpost",
            CI_RUN_ID: "1",
            IMAGE_ARTIFACT: "test",
            REGISTRY: "ghcr.io",
            IMAGE_NAME: "getopenpost/openpost",
            GITHUB_REF_NAME: "v4.0.0",
            GITHUB_SHA: revision,
            GITHUB_OUTPUT: output,
            TEST_IMAGE_VERSION: imageVersion,
            TEST_IMAGE_REVISION: imageRevision,
          },
        },
      );
      assert.equal(result.status === 0, succeeds, result.stderr);
      assert.equal(readFileSync(output, "utf8"), succeeds ? `digest=${digest}\n` : "");
      if (succeeds)
        assert.equal(
          readFileSync(path.join(directory, "pulled-image"), "utf8"),
          `ghcr.io/getopenpost/openpost@${digest}`,
        );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
