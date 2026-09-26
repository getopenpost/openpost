import { pdfPreviewAssets } from "./pdf-assets.ts";
import { playwright } from "@vitest/browser-playwright";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  plugins: [svelte(), pdfPreviewAssets()],
  // Discover the page-shell icon before browser tests start, avoiding a mid-run reload.
  optimizeDeps: { include: ["@lucide/svelte/icons/globe"] },
  test: {
    browser: {
      enabled: true,
      provider: playwright({
        launchOptions: chromiumExecutablePath
          ? { executablePath: chromiumExecutablePath }
          : undefined,
      }),
      instances: [{ browser: "chromium", headless: true }],
    },
    expect: { requireAssertions: true },
    include: ["src/**/*.svelte.{test,spec}.{js,ts}"],
  },
});
