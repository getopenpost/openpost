import { expect, test } from "bun:test";

import { releaseWorkflowProblems } from "./check-release-workflows.mjs";

const upload = (name) => ({ uses: "actions/upload-artifact@pinned", with: { name } });
const resolve = (prefix) => ({
  run: `bun scripts/ci-artifacts.mjs resolve --repository "$GITHUB_REPOSITORY" --run-id "$GITHUB_RUN_ID" --prefix "${prefix}"`,
});

function fixtures() {
  const ci = {
    jobs: {
      plan: { outputs: { image: "${{ steps.plan.outputs.image }}" }, steps: [] },
      build: {
        needs: "plan",
        if: "needs.plan.outputs.image == 'true'",
        steps: [
          upload("frontend-public-${{ github.sha }}-${{ github.run_attempt }}"),
          upload(
            "image-platform-digest-${{ github.sha }}-${{ matrix.arch }}-${{ github.run_attempt }}",
          ),
        ],
      },
      browser: {
        needs: ["plan", "build"],
        steps: [
          resolve("frontend-public-${GITHUB_SHA}-"),
          resolve("image-platform-digest-${GITHUB_SHA}-${arch}-"),
        ],
      },
    },
  };
  const release = {
    permissions: {},
    jobs: {
      setup: {
        permissions: { contents: "write" },
        outputs: { run: "${{ steps.ci.outputs.run }}" },
        steps: [
          {
            run: [
              'resolve() {\n  bun scripts/ci-artifacts.mjs resolve --run-id "$CI_RUN_ID" --prefix "$1"\n}',
              'frontend="$(resolve "frontend-public-${GITHUB_SHA}-")"',
              'gh release create "$GITHUB_REF_NAME" --draft',
            ].join("\n"),
          },
        ],
      },
      binaries: {
        needs: "setup",
        "runs-on": "${{ matrix.runner }}",
        strategy: { matrix: { include: [{ runner: "ubuntu-latest" }] } },
        permissions: { contents: "write" },
        steps: [{ run: 'bash scripts/release-asset-upload.sh "$ASSET"' }],
      },
      promote: {
        needs: ["setup", "binaries"],
        permissions: { contents: "write" },
        env: { RUN: "${{ needs.setup.outputs.run }}" },
        steps: [{ run: 'gh release view "$GITHUB_REF_NAME" --json databaseId' }],
      },
      "publish-release": {
        needs: ["setup", "promote"],
        permissions: { contents: "write" },
        steps: [{ run: "gh release edit --draft=false" }],
      },
      announce: {
        needs: "publish-release",
        permissions: { contents: "read" },
        steps: [{ run: 'gh release view "$GITHUB_REF_NAME" --json body' }],
      },
    },
  };
  return { ci, release };
}

test("consistent CI and release workflows pass", () => {
  expect(releaseWorkflowProblems(fixtures())).toEqual([]);
});

test("draft release access before publication requires contents write", () => {
  const workflows = fixtures();
  workflows.release.jobs.promote.permissions = { contents: "read", packages: "write" };
  delete workflows.release.jobs.binaries.permissions;
  expect(releaseWorkflowProblems(workflows)).toEqual([
    "release.yml binaries reads or writes the draft release before publication without contents: write",
    "release.yml promote reads or writes the draft release before publication without contents: write",
  ]);
});

test("resolved artifact prefixes need an upstream or main CI upload", () => {
  const workflows = fixtures();
  workflows.ci.jobs.browser.needs = ["plan"];
  workflows.release.jobs.setup.steps[0].run +=
    '\nandroid="$(resolve "android-unsigned-${GITHUB_SHA}-")"';
  expect(releaseWorkflowProblems(workflows)).toEqual([
    "ci.yml browser resolves artifact prefix frontend-public-<sha>-, which no upstream job uploads",
    "ci.yml browser resolves artifact prefix image-platform-digest-<sha>-*-, which no upstream job uploads",
    "release.yml setup resolves artifact prefix android-unsigned-<sha>-, which no upstream job uploads",
  ]);
});

test("needs outputs must be declared by a direct need", () => {
  const workflows = fixtures();
  workflows.ci.jobs.browser.if = "needs.plan.outputs.application == 'true'";
  workflows.release.jobs["publish-release"].env = { RUN: "${{ needs.binaries.outputs.digest }}" };
  expect(releaseWorkflowProblems(workflows)).toEqual([
    "ci.yml browser reads needs.plan.outputs.application, which plan does not declare",
    "release.yml publish-release reads needs.binaries.outputs.digest without needing binaries",
  ]);
});

test("a macOS runner cannot gate release publication", () => {
  const workflows = fixtures();
  workflows.release.jobs.binaries.strategy.matrix.include.push({ runner: "macos-latest" });
  expect(releaseWorkflowProblems(workflows)).toEqual([
    "release.yml binaries puts a macOS runner on the publication path",
  ]);
});
