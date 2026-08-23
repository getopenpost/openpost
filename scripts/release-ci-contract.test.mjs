import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { expectedReleaseAssets } from "./release-assets.mjs";

const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const release = readFileSync(".github/workflows/release.yml", "utf8");
const cacheContract = readFileSync(".github/workflows/cache-contract.yml", "utf8");
const dockerfile = readFileSync("docker/Dockerfile", "utf8");
const imageEvidence = readFileSync("scripts/image-evidence.mjs", "utf8");
const localRelease = readFileSync("scripts/release.mjs", "utf8");
const marketingPlaywright = readFileSync("playwright.config.ts", "utf8");
const frontendCacheProof = readFileSync("scripts/verify-frontend-build-cache.mjs", "utf8");
const smoke = readFileSync("scripts/smoke-production-image.sh", "utf8");
const releaseAssetUpload = readFileSync("scripts/release-asset-upload.sh", "utf8");
const n8nPackageRelease = readFileSync("scripts/n8n-package-release.mjs", "utf8");
const dependabot = readFileSync(".github/dependabot.yml", "utf8");
const workflows = readdirSync(".github/workflows", { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(?:ya?ml)$/u.test(entry.name))
  .map((entry) => ({
    name: entry.name,
    source: readFileSync(`.github/workflows/${entry.name}`, "utf8"),
  }));

function workflowJob(workflow, jobName) {
  const escapedName = jobName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const start = new RegExp(`^  ${escapedName}:\\s*$`, "mu").exec(workflow);
  assert.ok(start, `workflow job ${jobName} must exist`);
  const remainder = workflow.slice(start.index + start[0].length);
  const next = /^  [a-zA-Z0-9_-]+:\s*$/mu.exec(remainder);
  return workflow.slice(
    start.index,
    next ? start.index + start[0].length + next.index : workflow.length,
  );
}

function assertJobNeeds(job, dependencies) {
  const preSteps = job.slice(0, job.indexOf("\n    steps:\n"));
  for (const dependency of dependencies) {
    assert.match(preSteps, new RegExp(`\\b${dependency}\\b`, "u"));
  }
}

function matrixTargets(job) {
  return [
    ...job.matchAll(/- \{ os: ([a-z]+), arch: ([a-z0-9]+), runner: [^,]+, ext: "([^"]*)" \}/gu),
  ].map((match) => match.slice(1));
}

function assertPinnedExternalActions(workflowSources) {
  const actionLine = /^\s*(?:-\s+)?uses:\s+([^\s#]+)(?:\s+#\s*(.*?))?\s*$/gmu;
  let actionCount = 0;
  for (const workflow of workflowSources) {
    for (const match of workflow.source.matchAll(actionLine)) {
      const [, target, version] = match;
      if (target.startsWith("./")) continue;
      actionCount += 1;
      assert.match(
        target,
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.\/-]+)?@[a-f0-9]{40}$/u,
        `${workflow.name} has a mutable or non-commit action reference: ${target}`,
      );
      assert.match(
        version ?? "",
        /^v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u,
        `${workflow.name} must document the release tag beside ${target}`,
      );
    }
  }
  assert.ok(actionCount > 0);
}

function assertFailureAtomicReleaseWorkflow(workflow) {
  const prepare = workflowJob(workflow, "prepare-draft");
  const binaries = workflowJob(workflow, "build-binaries");
  const cli = workflowJob(workflow, "build-cli");
  const android = workflowJob(workflow, "build-android");
  const promote = workflowJob(workflow, "promote-image");
  const deploy = workflowJob(workflow, "deploy-production");
  const publishN8n = workflowJob(workflow, "publish-n8n");
  const publish = workflowJob(workflow, "publish-release");

  const workflowAssets = [
    "release-manifest.json",
    "openpost-image-evidence.json",
    "openpost-image.spdx.json",
    "openpost-image-trivy.json",
    ...matrixTargets(binaries).map(
      ([os, architecture, extension]) => `openpost-server-${os}-${architecture}${extension}`,
    ),
    ...matrixTargets(cli).flatMap(([os, architecture, extension]) => [
      `openpost-cli-${os}-${architecture}${extension}`,
      `openpost-mcp-${os}-${architecture}${extension}`,
    ]),
    "openpost-app-android.apk",
  ];
  assert.deepEqual([...workflowAssets].sort(), [...expectedReleaseAssets].sort());

  assertJobNeeds(prepare, ["verify-candidate"]);
  assert.match(prepare, /gh release view "\$GITHUB_REF_NAME"[\s\S]*--json databaseId/u);
  assert.match(prepare, /if ! fetch_release; then/u);
  assert.match(prepare, /gh api "repos\/\$\{GITHUB_REPOSITORY\}\/releases\/\$\{release_id\}"/u);
  assert.match(prepare, /gh release create[\s\S]*--draft\s/u);
  assert.doesNotMatch(workflow, /releases\/tags\/\$\{GITHUB_REF_NAME\}/u);
  const prepareValidation = prepare.indexOf("release-lifecycle.mjs verify");
  const evidenceUpload = prepare.indexOf("gh release upload");
  assert.ok(prepareValidation >= 0 && prepareValidation < evidenceUpload);
  assert.doesNotMatch(prepare, /--draft=false/u);

  for (const job of [binaries, cli, android]) {
    assertJobNeeds(job, ["verify-candidate", "prepare-draft"]);
    assert.match(job, /bash scripts\/release-asset-upload\.sh/u);
  }

  assert.match(releaseAssetUpload, /for attempt in \$\(seq 1 20\)/u);
  assert.match(releaseAssetUpload, /gh release view/u);
  assert.match(releaseAssetUpload, /expected_state=\$'true\\tfalse\\t'/u);
  assert.match(releaseAssetUpload, /for attempt in \$\(seq 1 5\)/u);
  assert.match(releaseAssetUpload, /gh release upload/u);

  assertJobNeeds(promote, [
    "verify-candidate",
    "prepare-draft",
    "build-binaries",
    "build-cli",
    "build-android",
  ]);
  assert.match(promote, /permissions:\s+contents: write\s+packages: write/u);
  const completeDraft = promote.indexOf("--phase complete-draft");
  const registryWrite = promote.indexOf("docker buildx imagetools create");
  assert.ok(completeDraft >= 0 && completeDraft < registryWrite);

  assertJobNeeds(deploy, ["promote-image"]);
  assert.match(deploy, /\/api\/v1\/ready/u);
  assert.match(deploy, /\/api\/v1\/version/u);

  assertJobNeeds(publishN8n, ["deploy-production"]);
  assert.match(publishN8n, /permissions:\s+contents: read\s+id-token: write/u);
  assert.match(publishN8n, /n8n-package-release\.mjs publish/u);
  assert.match(n8nPackageRelease, /"publish", tarball, "--access", "public", "--provenance"/u);
  assert.match(publishN8n, /scan-community-package@0\.32\.0/u);
  assert.match(publishN8n, /has passed all security checks/u);
  assert.match(publishN8n, /verify-published-n8n-package\.mjs/u);
  assert.doesNotMatch(publishN8n, /NPM_TOKEN|NODE_AUTH_TOKEN|_authToken/u);

  assertJobNeeds(publish, [
    "prepare-draft",
    "build-binaries",
    "build-cli",
    "build-android",
    "promote-image",
    "deploy-production",
    "publish-n8n",
  ]);
  const exactAssetCheck = publish.indexOf("--phase complete-draft");
  const publicEdit = publish.indexOf("gh release edit");
  const publishedCheck = publish.indexOf("--to published");
  assert.ok(exactAssetCheck >= 0 && exactAssetCheck < publicEdit && publicEdit < publishedCheck);
  assert.match(publish, /--draft=false/u);
  assert.match(
    publish,
    /release-lifecycle\.mjs transition[\s\S]*--from complete-draft[\s\S]*--to published/u,
  );

  const outsidePublish = workflow.replace(publish, "");
  assert.doesNotMatch(outsidePublish, /--draft=false|gh release edit/u);
  assert.equal(workflow.match(/gh release create/g)?.length, 1);
  assert.doesNotMatch(workflow, /softprops\/action-gh-release|gh release delete/u);
  assert.equal(n8nPackageRelease.match(/"publish", tarball/g)?.length, 1);
}

test("only the candidate image job can write packages", () => {
  const jobsStart = ci.indexOf("\njobs:\n");
  const imageStart = ci.indexOf("\n  image:\n", jobsStart);
  const nextJob = ci.indexOf("\n  release-candidate:\n", imageStart);

  assert.ok(jobsStart > 0 && imageStart > jobsStart && nextJob > imageStart);
  assert.doesNotMatch(ci.slice(0, jobsStart), /packages:\s*write/);
  assert.match(
    ci.slice(imageStart, nextJob),
    /permissions:\n\s+contents: read\n\s+packages: write/,
  );
  assert.equal(ci.match(/packages:\s*write/g)?.length, 1);
  assert.match(release, /\npermissions: \{\}\n\njobs:\n/);
});

test("maintained workflows pin every external action and receive weekly updates", () => {
  assertPinnedExternalActions(workflows);
  assert.match(
    dependabot,
    /package-ecosystem: github-actions[\s\S]*directory: \/[\s\S]*interval: weekly/u,
  );
});

test("native Android CI provisions the complete SDK before building", () => {
  const android = workflowJob(ci, "android");
  const sdkSetup = android.indexOf("android-actions/setup-android@");
  const candidateBuild = android.indexOf("bun run build:android:candidate");

  assert.ok(sdkSetup >= 0 && sdkSetup < candidateBuild);
  assert.match(android, /android-actions\/setup-android@[a-f0-9]{40} # v4\.0\.1/u);
  for (const sdkPackage of [
    "platform-tools",
    "platforms;android-36",
    "build-tools;36.0.0",
    "ndk;27.1.12297006",
    "cmake;3.22.1",
  ]) {
    assert.ok(android.includes(sdkPackage), `Android CI must install ${sdkPackage}`);
  }
  assert.doesNotMatch(android, /run: sdkmanager/u);
});

test("tag releases stay draft until every artifact, promotion, and deployment succeeds", () => {
  assertFailureAtomicReleaseWorkflow(release);
});

test("contract checks reject a mutable action or premature public release", () => {
  const mutableWorkflows = workflows.map((workflow, index) => ({
    ...workflow,
    source: index === 0 ? workflow.source.replace(/@[a-f0-9]{40}/u, "@v4") : workflow.source,
  }));
  assert.throws(
    () => assertPinnedExternalActions(mutableWorkflows),
    /mutable or non-commit action reference/u,
  );

  const prematureRelease = release.replace("--draft \\", "--draft=false \\");
  assert.notEqual(prematureRelease, release);
  assert.throws(() => assertFailureAtomicReleaseWorkflow(prematureRelease));
});

test("candidate CI embeds one stable version and exact-revision manifest", () => {
  assert.match(
    ci,
    /release-manifest\.mjs create[\s\S]*--changelog CHANGELOG\.md[\s\S]*--latest-tag[\s\S]*--revision "\$GITHUB_SHA"/,
  );
  assert.match(ci, /image:[\s\S]*fetch-depth: 0[\s\S]*--latest-tag/);
  assert.match(
    ci,
    /name: release-manifest-\$\{\{ github\.sha \}\}-\$\{\{ github\.run_attempt \}\}/,
  );
  assert.match(ci, /--build-arg VERSION="\$\{\{ steps\.manifest\.outputs\.version \}\}"/);
  assert.match(ci, /--build-arg COMMIT="\$GITHUB_SHA"/);
  assert.match(ci, /--build-arg RELEASE_MANIFEST_B64=/);
  assert.doesNotMatch(ci, /VERSION="candidate-/);

  assert.match(dockerfile, /COPY --from=backend-builder \/app\/release-manifest\.json/);
  assert.match(dockerfile, /org\.opencontainers\.image\.version="\$\{VERSION\}"/);
  assert.match(dockerfile, /org\.opencontainers\.image\.revision="\$\{COMMIT\}"/);
  assert.match(dockerfile, /sha256sum -c -/);
  assert.match(dockerfile, /\.version' release-manifest\.json\)" = "\$\{VERSION\}"/);
  assert.match(smoke, /running_version/);
  assert.match(smoke, /verify-image-release-manifest\.sh/);
  assert.match(ci, /name: frontend-public-\$\{\{ github\.sha \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(release, /candidate_artifact:[\s\S]*frontend_artifact:/);
  assert.match(release, /frontend_artifact:[\s\S]*android_artifact:/);
  assert.match(
    release,
    /ci-artifacts\.mjs resolve[\s\S]*--prefix "release-manifest-\$\{GITHUB_SHA\}-"[\s\S]*ci-artifacts\.mjs resolve[\s\S]*--prefix "frontend-public-\$\{GITHUB_SHA\}-"/,
  );
  assert.match(release, /--name "\$CANDIDATE_ARTIFACT"/);
  assert.match(release, /--name "\$FRONTEND_ARTIFACT"/);
  assert.match(release, /--prefix "android-unsigned-\$\{GITHUB_SHA\}-"/);
  const android = workflowJob(release, "build-android");
  assert.match(android, /sha256sum --check openpost-app-android-unsigned\.sha256/);
  assert.match(android, /apksigner[\s\S]*sign[\s\S]*apksigner[\s\S]*verify/);
  assert.match(android, /Refuse to publish an unsigned Android application[\s\S]*exit 1/);
  assert.doesNotMatch(
    android,
    /cp candidate-android\/openpost-app-android-unsigned\.apk openpost-app-android\.apk/,
  );
  assert.doesNotMatch(android, /frontend\/android/);
  assert.doesNotMatch(release, /CI_RUN_ATTEMPT|ci_run_attempt/);
  assert.match(
    localRelease,
    /resolveRunArtifact\([\s\S]*prefix: `release-manifest-\$\{revision\}-`/,
  );
  assert.doesNotMatch(ci, /overwrite: true/);
});

test("n8n CI enforces package versions on pull requests and direct main pushes", () => {
  const n8n = workflowJob(ci, "n8n");
  assert.match(n8n, /github\.event\.pull_request\.base\.sha/u);
  assert.match(n8n, /github\.event\.before/u);
  assert.match(n8n, /n8n-package-release\.mjs check-version/u);
});

test("CI builds web surfaces once and browser jobs consume those artifacts", () => {
  const frontend = workflowJob(ci, "frontend-build");
  const marketing = workflowJob(ci, "marketing-build");
  const docs = workflowJob(ci, "docs-build");
  const appBrowser = workflowJob(ci, "browser-app");
  const marketingBrowser = workflowJob(ci, "browser-marketing");
  const docsBrowser = workflowJob(ci, "browser-docs");
  const image = workflowJob(ci, "image");

  assert.match(frontend, /name: frontend-public-/);
  assert.ok(
    frontend.indexOf("playwright install --with-deps chromium") <
      frontend.indexOf("bun run test -- frontend"),
  );
  assert.match(marketing, /name: marketing-static-/);
  assert.match(docs, /name: docs-static-/);
  for (const [job, artifact] of [
    [appBrowser, "frontend-public-"],
    [marketingBrowser, "marketing-static-"],
    [docsBrowser, "docs-static-"],
  ]) {
    assert.ok(job.indexOf("oven-sh/setup-bun@") < job.indexOf("ci-artifacts.mjs resolve"));
    assert.ok(job.indexOf("ci-artifacts.mjs resolve") < job.indexOf("actions/download-artifact@"));
    assert.match(job, /actions\/download-artifact@/);
    assert.match(job, new RegExp(artifact, "u"));
    assert.match(job, /OPENPOST_E2E_PREBUILT: "1"/);
  }
  assertJobNeeds(image, ["frontend-build"]);
  assert.match(image, /--build-context frontend_artifact=backend\/cmd\/openpost\/public/);
  assert.match(marketingPlaywright, /wrangler pages dev dist/u);
  assert.match(marketingPlaywright, /workers:\s*process\.env\.CI\s*\?\s*1\s*:\s*undefined/u);
});

test("CI invokes repository timing helpers portably", () => {
  const invocations = ci.match(/bash scripts\/ci-timing-summary\.sh/gmu) ?? [];
  assert.equal(invocations.length, 8);
  assert.doesNotMatch(ci, /run: scripts\/ci-timing-summary\.sh/u);
});

test("cache equivalence is conditional in CI and independently scheduled", () => {
  const cacheJob = workflowJob(ci, "cache-contract");
  assert.match(cacheJob, /needs\.plan\.outputs\.cache_contract == 'true'/);
  assert.match(cacheJob, /bun run check -- frontend-build-cache/);
  assert.match(cacheContract, /schedule:[\s\S]*cron:/);
  assert.match(cacheContract, /workflow_dispatch:/);
  assert.match(cacheContract, /bun run check -- frontend-build-cache/);
  assert.doesNotMatch(frontendCacheProof, /turbo\(\[\.\.\.common, "--force"\]\)/u);
  for (const generatedInlangPath of [".gitignore", ".meta.json", "README.md", "cache"]) {
    assert.ok(frontendCacheProof.includes(`frontend/project.inlang/${generatedInlangPath}`));
  }
});

test("CI does not persist cumulative Turbo filesystem caches", () => {
  for (const jobName of ["frontend-build", "marketing-build", "docs-build"]) {
    const job = workflowJob(ci, jobName);
    assert.doesNotMatch(job, /path:\s*\.turbo\/cache/u);
    assert.doesNotMatch(job, /TURBO_FORCE:/u);
  }
});

test("non-build CI jobs omit immutable editor assets from partial checkouts", () => {
  for (const jobName of [
    "plan",
    "backend-lint",
    "frontend-quality",
    "backend",
    "backend-race",
    "marketing-build",
    "docs-build",
    "browser-app",
    "browser-marketing",
    "browser-docs",
    "security",
    "cli",
    "image",
  ]) {
    const job = workflowJob(ci, jobName);
    assert.match(job, /sparse-checkout-cone-mode: false/u, jobName);
    for (const directory of ["image-editor-models"]) {
      assert.match(job, new RegExp(`!/frontend/static/${directory}/`, "u"), jobName);
    }
  }

  for (const jobName of ["policy", "frontend-build", "cache-contract", "android"]) {
    assert.doesNotMatch(workflowJob(ci, jobName), /!\/frontend\/static\/video-editor-models\//u);
  }
});

test("ordinary release preparation delegates exhaustive correctness to candidate CI", () => {
  const prepareStart = localRelease.indexOf("async function prepare(");
  const promoteStart = localRelease.indexOf("async function promote(");
  const prepare = localRelease.slice(prepareStart, promoteStart);
  assert.match(prepare, /checkReleaseContracts\(\)/);
  assert.doesNotMatch(prepare, /await check\(\)|devenv[\s\S]*verify/);
  assert.match(prepare, /await waitForCI\(revision\)/);
  const boundedCheck = localRelease.slice(
    localRelease.indexOf("async function check()"),
    localRelease.indexOf("async function checkFull()"),
  );
  assert.match(boundedCheck, /run\(\["bun", "run", "check"\]\)/);
  assert.match(
    boundedCheck,
    /await runParallel\(\[[\s\S]*\["bun", "run", "lint"\][\s\S]*\["bun", "scripts\/tasks\.mjs", "test", "--non-browser"\]/,
  );
  assert.doesNotMatch(boundedCheck, /devenv|docker|race|security/);
  assert.match(localRelease, /async function checkFull\(\)[\s\S]*"test", "--", "e2e-app"/);
});

test("promotion verifies metadata before pinning the verified digest", () => {
  const verifyPosition = release.indexOf("bun scripts/release-manifest.mjs verify");
  const promotePosition = release.indexOf("promote-image:");
  assert.ok(verifyPosition >= 0 && verifyPosition < promotePosition);
  assert.match(release, /--version "\$GITHUB_REF_NAME"[\s\S]*--revision "\$GITHUB_SHA"/);
  assert.match(release, /image="\$\{repository\}@\$\{digest\}"[\s\S]*docker pull "\$image"/);
  assert.match(ci, /openpost-image-evidence\.json/);
  assert.match(
    imageEvidence,
    /release_manifest_sha256[\s\S]*sbom_sha256[\s\S]*vulnerability_report_sha256/,
  );
  assert.match(ci, /image-evidence\.mjs create/);
  assert.match(release, /image-evidence\.mjs verify/);
  assert.match(release, /verified_digest[\s\S]*"\$verified_digest" == "\$CANDIDATE_DIGEST"/);
  assert.match(release, /source_image="\$\{REGISTRY\}\/\$\{IMAGE_NAME\}@\$\{SOURCE_DIGEST\}"/);
  assert.match(release, /--prefer-index=false/);
  assert.match(release, /\[\[ "\$promoted_digest" == "\$SOURCE_DIGEST" \]\]/);

  const localManifestCheck = localRelease.indexOf(
    "await verifyCandidateManifest(ciRun, tag, revision)",
  );
  const localTagPush = localRelease.indexOf('run(["git", "push", "origin", tag]');
  assert.ok(localManifestCheck >= 0 && localManifestCheck < localTagPush);
  assert.match(localRelease, /expectedVersion: version,[\s\S]*expectedRevision: revision/);
});

test("deployment proof requires readiness, the public stable version, and exact revision", () => {
  assert.match(
    release,
    /"\$revision" == "\$GITHUB_SHA" && "\$version" == "\$GITHUB_REF_NAME" && "\$readiness" == ready && "\$database" == ok/,
  );
  assert.match(release, /\/api\/v1\/ready/);
  assert.match(release, /deploy-production:[\s\S]*timeout-minutes: 10/);
  assert.match(
    release,
    /curl --fail --silent --connect-timeout 2 --max-time 5 https:\/\/app\.openpost\.social\/api\/v1\/ready/,
  );
  assert.match(smoke, /--connect-timeout 1 --max-time 2/);
  assert.doesNotMatch(release, /\[\[ "\$revision" == "\$GITHUB_SHA" \]\] && exit 0/);
  assert.match(localRelease, /info\.version === version && info\.revision === revision/);
});
