import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const docsConfigPath = new URL(
  "../docs-site/.vitepress/config.ts",
  import.meta.url,
);
const docsThemePath = new URL(
  "../docs-site/.vitepress/theme/index.ts",
  import.meta.url,
);

describe("documentation telemetry", () => {
  test("uses the shared PostHog client without a legacy Umami script", async () => {
    const [config, theme] = await Promise.all([
      readFile(docsConfigPath, "utf8"),
      readFile(docsThemePath, "utf8"),
    ]);

    expect(config).not.toContain("analytics.rgo.pt");
    expect(config.toLowerCase()).not.toContain("umami");
    expect(theme).toContain("configureTelemetry");
    expect(theme).toContain("surface: 'docs'");
  });
});
