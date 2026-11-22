import { defineConfig } from "@playwright/test";

import appConfig from "../app/playwright.config";

// Product screenshots and README demos are deliberate captures, not tests.
// They reuse the application suite's servers and browser, one worker at a time.
export default defineConfig({
  ...appConfig,
  testDir: ".",
  testMatch: "*.spec.ts",
  testIgnore: undefined,
  fullyParallel: false,
  workers: 1,
});
