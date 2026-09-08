import { expect, test } from "@playwright/test";

for (const scenario of [
  { name: "system dark", system: "dark", saved: null, expected: "dark" },
  { name: "saved dark", system: "light", saved: "dark", expected: "dark" },
  { name: "saved light", system: "dark", saved: "light", expected: "light" },
  { name: "system light", system: "light", saved: "system", expected: "light" },
  { name: "invalid preference", system: "dark", saved: "invalid", expected: "dark" },
  { name: "unavailable storage", system: "dark", saved: "blocked", expected: "dark" },
] as const) {
  test(`${scenario.name} paints before app downloads on entry and reload`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scenario.system });
    await page.addInitScript((saved) => {
      if (saved === "blocked") {
        Object.defineProperty(window, "localStorage", {
          get() {
            throw new Error("Storage unavailable");
          },
        });
        return;
      }
      if (saved !== null) localStorage.setItem("mode-watcher-mode", saved);
    }, scenario.saved);
    // Keep the real document but withhold all external startup resources.
    await page.route("**/*", (route) =>
      route.request().resourceType() === "document" ? route.continue() : route.abort(),
    );
    for (const navigation of [() => page.goto("/login"), () => page.reload()]) {
      await navigation();
      await expect(page.locator("html")).toHaveCSS("color-scheme", scenario.expected);
      const background = await page.locator("html").evaluate((root) => {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d")!;
        context.fillStyle = getComputedStyle(root).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data];
      });
      expect(background[3]).toBe(255);
      if (scenario.expected === "dark")
        expect(Math.max(...background.slice(0, 3))).toBeLessThan(50);
      else expect(Math.min(...background.slice(0, 3))).toBeGreaterThan(240);
    }
  });
}

test("saved dark appearance stays dark while the app starts", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    localStorage.setItem("mode-watcher-mode", "dark");
    const samples: string[] = [];
    Object.assign(window, { startupSchemes: samples });
    const sample = () => {
      samples.push(getComputedStyle(document.documentElement).colorScheme);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.route("**/*.js", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.continue();
  });
  for (const navigation of [() => page.goto("/login"), () => page.reload()]) {
    await navigation();
    await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeVisible();
    const schemes = await page.evaluate(
      () => (window as Window & { startupSchemes: string[] }).startupSchemes,
    );
    expect(schemes.length).toBeGreaterThan(0);
    expect([...new Set(schemes)]).toEqual(["dark"]);
  }
});
