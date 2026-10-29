import { expect, test } from "bun:test";
import { distributionPlan } from "./release-distribution-plan.mjs";

test("selects independent packages and shared build inputs", () => {
  expect(distributionPlan(["apps/server/main.go", "scripts/release-notes.mjs"])).toEqual({
    sdk: false,
    n8n: false,
    cli: false,
  });
  expect(distributionPlan(["packages/sdk/src/index.ts"])).toEqual({
    sdk: true,
    n8n: false,
    cli: false,
  });
  expect(distributionPlan(["packages/n8n-nodes-openpost/nodes/a.ts"])).toEqual({
    sdk: false,
    n8n: true,
    cli: false,
  });
  expect(distributionPlan(["apps/cli/cmd/openpost/main.go"])).toEqual({
    sdk: false,
    n8n: false,
    cli: true,
  });
  expect(distributionPlan(["bun.lock"])).toEqual({ sdk: true, n8n: true, cli: false });
  expect(distributionPlan(["apps/web/openapi.json"])).toEqual({ sdk: true, n8n: true, cli: true });
});

test("mobile inputs include every declared local package and dependency lock", async () => {
  const { mobileChanged, mobileReleasePaths } = await import("./release-distribution-plan.mjs");
  const manifest = await Bun.file("apps/mobile/package.json").json();
  for (const value of Object.values({ ...manifest.dependencies, ...manifest.devDependencies })) {
    if (value.startsWith("file:../../packages/"))
      expect(mobileReleasePaths).toContain(value.slice("file:../../".length));
  }
  for (const input of [...mobileReleasePaths, "packages/platform-text/src/text.ts"])
    expect(mobileChanged([input])).toBe(true);
  expect(mobileChanged([".github/workflows/release.yml", "apps/server/main.go"])).toBe(false);
});
