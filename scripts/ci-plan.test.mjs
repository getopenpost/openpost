import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { planCI } from "./ci-plan.mjs";
import { readReleaseSurfaceManifest } from "./release-surfaces.mjs";

const manifest = readReleaseSurfaceManifest();

test("changed files route to their CI paths", () => {
  const cases = [
    {
      name: "marketing illustrations and provenance rebuild the public site",
      files: ["assets/marketing/paper-plane.webp", "assets/marketing/paper-plane.webp.json"],
      on: ["marketing"],
      off: ["application", "frontend", "backend", "documentation", "image", "android"],
    },
    {
      name: "social artwork stays outside application builds",
      files: ["assets/social/openpost/banners/x-paper.png"],
      on: ["marketing"],
      off: ["application", "frontend", "backend", "documentation", "image", "android"],
    },
    {
      name: "shared product assets rebuild their consumers",
      files: ["assets/brand/icon.svg"],
      on: ["application", "frontend", "marketing", "documentation", "image"],
      off: ["backend", "android"],
    },
    {
      name: "documentation-only changes",
      files: ["apps/docs/guide.md"],
      on: ["documentation"],
      off: ["backend", "frontend", "marketing", "image", "android"],
    },
    {
      name: "documentation catalogue changes",
      files: ["packages/social-images/src/docs-catalog.js"],
      on: ["documentation", "marketing"],
      off: [],
    },
    {
      name: "shared Agent-readable generator changes",
      files: ["scripts/generate-agent-surfaces.mjs"],
      on: ["documentation", "marketing"],
      off: [],
    },
    {
      name: "frontend changes",
      files: ["apps/web/src/routes/+page.svelte"],
      on: ["application", "frontend", "image"],
      off: ["android", "backend"],
    },
    {
      name: "standalone mobile changes",
      files: ["apps/mobile/src/app/(tabs)/drafts.tsx"],
      on: ["android"],
      off: ["frontend", "image"],
    },
    {
      name: "mobile API contract changes",
      files: ["apps/web/openapi.json"],
      on: ["android"],
      off: [],
    },
    {
      name: "shared Query packages",
      files: ["packages/api-contract/src/schema.d.ts", "packages/query-catalog/src/options.ts"],
      on: ["frontend", "android"],
      off: [],
    },
    {
      name: "shared native dithering",
      files: ["packages/dither/src/paint.ts"],
      on: ["android", "frontend"],
      off: [],
    },
    {
      name: "n8n package changes",
      files: ["packages/n8n-nodes-openpost/README.md"],
      on: ["n8n"],
      off: [],
    },
    {
      name: "selected automation generator changes",
      files: ["scripts/generate-selected-automation-contract.mjs"],
      on: ["n8n"],
      off: [],
    },
    {
      name: "SDK changes",
      files: ["packages/sdk/src/index.ts"],
      on: ["npm"],
      off: ["n8n"],
    },
    {
      name: "CLI wrapper changes",
      files: ["packages/cli/src/resolve.ts"],
      on: ["npm"],
      off: ["n8n"],
    },
    {
      name: "shared npm release script changes",
      files: ["scripts/npm-package-release.mjs"],
      on: ["npm"],
      off: [],
    },
    {
      name: "npm payload gate changes",
      files: ["scripts/check-npm-package-build.mjs"],
      on: ["npm"],
      off: [],
    },
    {
      name: "changelog entries do not force the complete matrix",
      files: ["changes/476.md"],
      on: [],
      off: [
        "application",
        "backend",
        "frontend",
        "marketing",
        "documentation",
        "cli",
        "n8n",
        "npm",
        "security",
        "image",
        "android",
      ],
    },
    {
      name: "a changelog entry beside a documentation change stays on the documentation path",
      files: ["apps/docs/content/docs/guides/publishing.mdx", "changes/476.md"],
      on: ["documentation"],
      off: [
        "application",
        "backend",
        "frontend",
        "marketing",
        "cli",
        "n8n",
        "npm",
        "security",
        "image",
        "android",
      ],
    },
  ];
  for (const { name, files, on, off } of cases) {
    const plan = planCI(files, manifest);
    for (const job of on) assert.equal(plan[job], true, `${name}: ${job}`);
    for (const job of off) assert.equal(plan[job], false, `${name}: ${job}`);
  }
});

test("delivery changes fail closed to the complete matrix", () => {
  const plan = planCI([".github/workflows/ci.yml"], manifest);
  assert.deepEqual(plan, {
    application: true,
    backend: true,
    frontend: true,
    marketing: true,
    documentation: true,
    cli: true,
    n8n: true,
    npm: true,
    security: true,
    image: true,
    android: true,
    cache_contract: false,
  });
});

test("main candidates always run the complete matrix", () => {
  const plan = planCI([], manifest, { full: true });
  assert.ok(
    Object.entries(plan)
      .filter(([name]) => name !== "cache_contract")
      .every(([, enabled]) => enabled),
  );
  assert.equal(plan.cache_contract, false);
});

test("release tags prove the full core candidate while distributions follow the supplied diff", () => {
  const serverOnly = planCI(["apps/server/internal/api/handlers/foo.go"], manifest, {
    release: true,
  });
  assert.deepEqual(serverOnly, {
    application: true,
    backend: true,
    frontend: true,
    marketing: false,
    documentation: false,
    cli: false,
    n8n: false,
    npm: false,
    security: true,
    image: true,
    android: false,
    cache_contract: false,
  });

  const mobile = planCI(["apps/mobile/src/app/(tabs)/drafts.tsx"], manifest, {
    release: true,
  });
  assert.equal(mobile.android, true);
  assert.equal(mobile.backend, true);
  assert.equal(mobile.image, true);

  // A canceled server run followed by a release-only commit cannot hide
  // missing core proof: core gates run even when the diff is release-only.
  const releaseOnly = planCI(["CHANGELOG.md"], manifest, { release: true });
  assert.equal(releaseOnly.backend, true);
  assert.equal(releaseOnly.frontend, true);
  assert.equal(releaseOnly.security, true);
});

test("proven tags rebuild only the versioned image and refresh advisories", () => {
  const serverOnly = planCI(["apps/server/internal/api/handlers/foo.go"], manifest, {
    reuse: true,
  });
  assert.deepEqual(serverOnly, {
    application: false,
    backend: false,
    frontend: false,
    marketing: false,
    documentation: false,
    cli: false,
    n8n: false,
    npm: false,
    security: true,
    image: true,
    android: false,
    cache_contract: false,
  });

  // The proven Android build is relayed, never rebuilt, when mobile shipped.
  const mobile = planCI(["apps/mobile/src/app/(tabs)/drafts.tsx"], manifest, { reuse: true });
  assert.equal(mobile.android, true);
  assert.equal(mobile.backend, false);
});

test("package selection follows consumers rather than every package selecting the web app", () => {
  for (const name of ["sdk", "cli", "n8n-nodes-openpost", "social-images"]) {
    const plan = planCI([`packages/${name}/src/index.ts`], manifest);
    assert.equal(plan.frontend, false, name);
    assert.equal(plan.application, false, name);
    assert.equal(plan.image, false, name);
  }
  const shared = planCI(["packages/dither/src/index.ts"], manifest);
  assert.equal(shared.frontend, true);
  assert.equal(shared.android, true);
  assert.equal(shared.marketing, true);
  assert.equal(shared.documentation, true);
  const native = planCI(["packages/telemetry/src/index.ts"], manifest);
  assert.equal(native.android, true);
});

test("unknown packages fail closed for application consumers", () => {
  const plan = planCI(["packages/not-yet-registered/src/index.ts"], manifest);
  for (const key of ["frontend", "android", "application", "image", "marketing", "documentation"])
    assert.equal(plan[key], true, key);
});

test("package selection follows transitive consumers and fails closed when metadata disappears", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "openpost-ci-consumers-"));
  const writePackage = (name, data) => {
    mkdirSync(path.join(directory, name), { recursive: true });
    writeFileSync(path.join(directory, name, "package.json"), JSON.stringify(data));
  };
  try {
    writePackage("packages/core", { name: "@openpost/core" });
    writePackage("packages/ui", {
      name: "@openpost/ui",
      dependencies: { "@openpost/core": "workspace:*" },
    });
    writePackage("apps/web", { name: "web", dependencies: { "@openpost/ui": "workspace:*" } });
    for (const app of ["mobile", "marketing", "docs"]) writePackage(`apps/${app}`, { name: app });
    const files = ["packages/core/src/index.ts"];
    const selected = planCI(files, manifest, { repositoryRoot: directory });
    assert.equal(selected.frontend, true);
    assert.equal(selected.android, false);
    assert.equal(selected.marketing, false);
    assert.equal(selected.documentation, false);
    rmSync(path.join(directory, "packages/ui/package.json"));
    const fallback = planCI(files, manifest, { repositoryRoot: directory });
    for (const key of ["frontend", "android", "application", "image", "marketing", "documentation"])
      assert.equal(fallback[key], true, key);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("nightly release qualification covers every surface even without changed files", () => {
  const plan = planCI([], manifest, { release: true, full: true });
  for (const [name, selected] of Object.entries(plan)) {
    if (name !== "cache_contract") assert.equal(selected, true, name);
  }
});

test("backend changes retain the application build and browser qualification", () => {
  const plan = planCI(["apps/server/internal/services/publication/store.go"], manifest);
  assert.equal(plan.backend, true);
  assert.equal(plan.application, true);
  assert.equal(plan.image, true);
});

test("shared editor and web library changes include their real consumers", () => {
  const editor = planCI(["packages/editor-shared/src/workspace.ts"], manifest);
  assert.equal(editor.frontend, true);
  const library = planCI(["apps/web/src/lib/components/button.svelte"], manifest);
  assert.equal(library.marketing, true);
});
