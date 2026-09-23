import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { load } from "js-yaml";

import { planCI } from "./ci-plan.mjs";
import { selectPublishedStableRelease } from "./published-release-tag.mjs";
import { readReleaseSurfaceManifest } from "./release-surfaces.mjs";

const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const release = readFileSync(".github/workflows/release.yml", "utf8");
const screenshotRefresh = readFileSync(".github/workflows/screenshot-refresh.yml", "utf8");
const releaseScript = readFileSync("scripts/release.mjs", "utf8");
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

test("release candidate requires every independent CI job", () => {
  const jobs = load(ci).jobs;
  assert.deepEqual(
    [...jobs["release-candidate"].needs].sort(),
    Object.keys(jobs)
      .filter((job) => job !== "release-candidate")
      .sort(),
  );
});

test("n8n recovery dispatch keeps app deployment out of the job graph", () => {
  const workflow = load(release);
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.package.options, ["n8n"]);
  assert.equal(workflow.jobs["verify-candidate"].if, "github.event_name == 'push'");
  assert.equal(
    workflow.jobs["publish-n8n"].if,
    "!cancelled() && (needs.promote-image.result == 'success' || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.package == 'n8n'))",
  );
  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (name === "verify-candidate" || name === "publish-n8n") continue;
    assert.ok(job.needs, `${name} must remain downstream of the release gate`);
    assert.ok(!job.if?.includes("always()"), `${name} must not run after skipped needs`);
  }
});

test("tag release candidates schedule the application browser suite", () => {
  const browserApp = load(ci).jobs["browser-app"];
  assert.equal(browserApp.if, "needs.plan.outputs.application == 'true'");
});

test("tag n8n version checks use the last published release as their base", () => {
  const step = load(ci).jobs.n8n.steps.find(
    (step) => step.name === "Require a package version increase for publishable changes",
  );
  assert.equal(step.env.EVENT_NAME, "${{ github.event_name }}");
  assert.equal(step.env.GH_TOKEN, "${{ github.token }}");
  assert.equal(
    step.env.BASE_SHA,
    "${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event.before }}",
  );
  assert.match(step.run, /GITHUB_REF.*refs\/tags/u);
  assert.match(step.run, /published-release-tag\.mjs --exclude "\$GITHUB_REF_NAME"/u);
  assert.match(step.run, /check-version --base "\$BASE_SHA" --head "\$GITHUB_SHA"/u);
});

test("failed tags do not hide distribution changes from the next candidate", () => {
  const baseline = selectPublishedStableRelease(
    [
      [
        {
          tag_name: "v5.2.1",
          draft: false,
          prerelease: false,
          published_at: "2026-09-20T12:00:00Z",
        },
        {
          tag_name: "v5.2.0",
          draft: true,
          prerelease: false,
          published_at: null,
        },
        {
          tag_name: "v5.1.2",
          draft: false,
          prerelease: false,
          published_at: "2026-09-19T12:00:00Z",
        },
      ],
    ],
    "v5.2.1",
  );
  assert.equal(baseline, "v5.1.2");

  const plan = planCI(
    ["apps/mobile/src/release-fix.ts", "apps/marketing/src/routes/tools/+page.svelte"],
    readReleaseSurfaceManifest(),
    { release: true },
  );
  assert.equal(plan.android, true);
  assert.equal(plan.marketing, true);

  const planStep = workflowStepScript(
    ci,
    "plan",
    "Plan from the fail-closed release surface registry",
  );
  assert.match(planStep, /published-release-tag\.mjs --exclude "\$tag_name"/u);
  assert.doesNotMatch(planStep, /git tag --list/u);

  const identityStep = workflowStepScript(
    release,
    "verify-candidate",
    "Require a release-valid Android identity",
  );
  assert.match(identityStep, /published-release-tag\.mjs --exclude "\$GITHUB_REF_NAME"/u);
  assert.match(releaseScript, /checkReleaseMobileIdentity\(publishedStableReleaseTag\(\)\)/u);
});

test("the marketing build checks out its canonical immutable frontend assets", () => {
  const checkout = load(ci).jobs["marketing-build"].steps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  assert.ok(checkout);
  assert.doesNotMatch(
    checkout.with?.["sparse-checkout"] ?? "",
    /!\/apps\/web\/static\/image-editor-models\//u,
  );
});

test("the screenshot refresh checks out its canonical immutable frontend assets", () => {
  const checkout = load(screenshotRefresh).jobs.refresh.steps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  assert.ok(checkout);
  assert.doesNotMatch(
    checkout.with?.["sparse-checkout"] ?? "",
    /!\/apps\/web\/static\/image-editor-models\//u,
  );
});

test("container candidates run and publish on native amd64 and arm64 runners", () => {
  const jobs = load(ci).jobs;
  const image = jobs.image;
  assert.deepEqual(image.strategy.matrix.include, [
    { arch: "amd64", runner: "ubuntu-latest" },
    { arch: "arm64", runner: "ubuntu-24.04-arm" },
  ]);
  assert.equal(image["runs-on"], "${{ matrix.runner }}");
  const build = workflowStepScript(ci, "image", "Build the candidate once");
  assert.match(build, /--platform "linux\/\$\{\{ matrix\.arch \}\}"/u);
  assert.match(build, /smoke-production-image\.sh[^\n]+"\$\{\{ matrix\.arch \}\}"/u);
  const publish = workflowStepScript(
    ci,
    "image",
    "Publish the validated candidate and record its digest",
  );
  assert.match(publish, /imagetools inspect --raw/u);
  assert.match(publish, /platform\.architecture == \$architecture/u);

  const index = jobs["image-index"];
  assert.deepEqual(index.needs, ["plan", "image"]);
  const resolve = workflowStepScript(
    ci,
    "image-index",
    "Resolve the successful platform artifacts",
  );
  assert.match(resolve, /image-platform-digest-\$\{GITHUB_SHA\}-amd64-/u);
  assert.match(resolve, /image-platform-digest-\$\{GITHUB_SHA\}-arm64-/u);
  assert.match(
    workflowStepScript(ci, "image-index", "Publish the multi-architecture candidate"),
    /imagetools create/u,
  );
});

test("the exhaustive local image check uses the host's supported architecture", () => {
  assert.match(releaseScript, /\{ arm64: "arm64", x64: "amd64" \}\[process\.arch\]/u);
  assert.match(releaseScript, /`linux\/\$\{imageArchitecture\}`/u);
  assert.match(
    releaseScript,
    /smoke-production-image\.sh", image, revision, "", imageArchitecture/u,
  );
});

test("only container image CI jobs can write packages", () => {
  const jobs = load(ci).jobs;
  assert.deepEqual(
    Object.entries(jobs)
      .filter(([, job]) => job.permissions?.packages === "write")
      .map(([id]) => id),
    ["image", "image-index"],
  );
});

test("Android keeps its own cadence across core releases", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "openpost-release-tags-"));
  try {
    mkdirSync(path.join(directory, "apps/mobile"), { recursive: true });
    mkdirSync(path.join(directory, "scripts"));
    mkdirSync(path.join(directory, "bin"));
    copyFileSync(
      "scripts/mobile-release.mjs",
      path.join(directory, "scripts", "mobile-release.mjs"),
    );
    copyFileSync(
      "scripts/published-release-tag.mjs",
      path.join(directory, "scripts", "published-release-tag.mjs"),
    );
    const gh = path.join(directory, "bin/gh");
    writeFileSync(
      gh,
      '#!/bin/sh\nprintf \'[[{"tag_name":"v4.15.0","draft":false,"prerelease":false,"published_at":"2026-09-01T00:00:00Z"}]]\\n\'\n',
    );
    chmodSync(gh, 0o755);
    const git = (...args) => {
      const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    const runIdentityStep = (ref, sha) => {
      const output = path.join(directory, `step-output-${ref}.txt`);
      writeFileSync(output, "");
      const result = spawnSync(
        "bash",
        [
          "--noprofile",
          "--norc",
          "-e",
          "-o",
          "pipefail",
          "-c",
          workflowStepScript(
            release,
            "verify-candidate",
            "Require a release-valid Android identity",
          ),
        ],
        {
          cwd: directory,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${directory}/bin:${process.env.PATH}`,
            GITHUB_REF_NAME: ref,
            GITHUB_SHA: sha,
            GITHUB_OUTPUT: output,
          },
        },
      );
      const changed = readFileSync(output, "utf8")
        .split("\n")
        .find((line) => line.startsWith("changed="))
        ?.slice("changed=".length);
      return { status: result.status, stderr: result.stderr, changed };
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
    git("commit", "-m", "mobile release");
    git("tag", "v4.15.0");

    // A server-only release keeps the released identity and skips packaging.
    writeFileSync(path.join(directory, "notes.txt"), "server fix\n");
    git("add", ".");
    git("commit", "-m", "fix: server only");
    git("tag", "v4.15.1");
    const serverOnly = runIdentityStep("v4.15.1", "v4.15.1");
    assert.equal(serverOnly.status, 0, serverOnly.stderr);
    assert.equal(serverOnly.changed, "false");
    assert.equal(
      JSON.parse(readFileSync(path.join(directory, "previous-release-app.json"), "utf8")).expo
        .android.versionCode,
      3,
    );

    // A mobile change without an identity bump fails closed.
    mkdirSync(path.join(directory, "apps/mobile/src"), { recursive: true });
    writeFileSync(path.join(directory, "apps/mobile/src/unbumped.ts"), "export {}\n");
    git("add", ".");
    git("commit", "-m", "fix(mobile): unbumped change");
    git("tag", "v4.15.2");
    const unbumped = runIdentityStep("v4.15.2", "v4.15.2");
    assert.notEqual(unbumped.status, 0);
    assert.equal(unbumped.changed, "true");
    assert.equal(
      JSON.parse(readFileSync(path.join(directory, "previous-release-app.json"), "utf8")).expo
        .android.versionCode,
      3,
    );

    // A mobile change with a bumped identity releases again.
    writeMobileIdentity(directory, "0.2.2", 4);
    git("add", ".");
    git("commit", "-m", "feat(mobile): bumped change");
    git("tag", "v4.15.3");
    const bumped = runIdentityStep("v4.15.3", "v4.15.3");
    assert.equal(bumped.status, 0, bumped.stderr);
    assert.equal(bumped.changed, "true");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("server-only releases do not require an Android CI artifact", () => {
  const step = load(release).jobs["verify-candidate"].steps.find(
    (step) => step.name === "Resolve artifacts from their successful CI attempts",
  );
  assert.equal(step.env.MOBILE_CHANGED, "${{ steps.mobile.outputs.changed }}");
  assert.match(step.run, /android=""\nif \[\[ "\$MOBILE_CHANGED" == "true" \]\]; then/u);
  assert.match(step.run, /prefix "android-unsigned-\$\{GITHUB_SHA\}-"/u);
});

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
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?@[a-f0-9]{40}$/u,
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

// Four workflow subprocesses share CPU with the parallel release checks.
test(
  "image promotion requires both tested platform digests and matching OCI identity",
  { timeout: 30_000 },
  () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openpost-release-image-"));
    const revision = "a".repeat(40);
    const digest = `sha256:${"b".repeat(64)}`;
    const amd64Digest = `sha256:${"c".repeat(64)}`;
    const arm64Digest = `sha256:${"d".repeat(64)}`;
    try {
      mkdirSync(path.join(directory, "bin"));
      mkdirSync(path.join(directory, "tested-image"));
      // Stand in for remote Actions and registry I/O while executing the workflow's shell.
      for (const [name, command] of Object.entries({
        gh: "#!/bin/sh\nexit 0\n",
        docker: `#!/bin/sh
case "$1" in
  login) cat >/dev/null ;;
  buildx)
    [ "$2" = imagetools ] && [ "$3" = inspect ] && [ "$4" = --raw ] || exit 1
    printf '{"manifests":[{"digest":"%s","platform":{"os":"linux","architecture":"amd64"}},{"digest":"%s","platform":{"os":"linux","architecture":"arm64"}}]}' "$TEST_INDEX_AMD64_DIGEST" "$TEST_INDEX_ARM64_DIGEST" ;;
  pull) printf '%s\n' "$4" >> pulled-images ;;
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
      for (const [imageDigest, testedArm64Digest, imageVersion, imageRevision, succeeds] of [
        [digest, arm64Digest, "v4.0.0", revision, true],
        [digest, arm64Digest, "v3.9.0", revision, false],
        [digest, arm64Digest, "v4.0.0", "e".repeat(40), false],
        [digest, `sha256:${"f".repeat(64)}`, "v4.0.0", revision, false],
        ["latest", arm64Digest, "v4.0.0", revision, false],
      ]) {
        writeFileSync(path.join(directory, "tested-image/image-digest.txt"), `${imageDigest}\n`);
        writeFileSync(
          path.join(directory, "tested-image/image-linux-amd64-digest.txt"),
          `${amd64Digest}\n`,
        );
        writeFileSync(
          path.join(directory, "tested-image/image-linux-arm64-digest.txt"),
          `${testedArm64Digest}\n`,
        );
        rmSync(path.join(directory, "pulled-images"), { force: true });
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
              TEST_INDEX_AMD64_DIGEST: amd64Digest,
              TEST_INDEX_ARM64_DIGEST: arm64Digest,
            },
          },
        );
        assert.equal(
          result.status === 0,
          succeeds,
          `${result.stderr}\nimage=${imageDigest} arm64=${testedArm64Digest} version=${imageVersion} revision=${imageRevision}`,
        );
        assert.equal(readFileSync(output, "utf8"), succeeds ? `digest=${digest}\n` : "");
        if (succeeds)
          assert.equal(
            readFileSync(path.join(directory, "pulled-images"), "utf8"),
            `ghcr.io/getopenpost/openpost@${amd64Digest}\nghcr.io/getopenpost/openpost@${arm64Digest}\n`,
          );
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
