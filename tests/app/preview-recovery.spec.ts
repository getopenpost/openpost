import { expect, test } from "@playwright/test";

for (const colorScheme of ["light"] as const) {
  test(`an invalid preview link uses the active ${colorScheme} recovery theme`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/preview");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
    const recover = page.getByRole("link", { name: "Open composer", exact: true });
    await expect(recover).toBeVisible();
    await expect
      .poll(() => recover.evaluate((link) => getComputedStyle(link, "::before").content))
      .not.toBe("none");
    expect(await recover.evaluate((link) => getComputedStyle(link, "::before").maskImage)).not.toBe(
      "none",
    );
    await expect
      .poll(() =>
        page.getByRole("heading", { level: 1 }).evaluate((heading) => {
          const probe = document.createElement("div");
          probe.style.color = "var(--card-foreground)";
          heading.parentElement!.append(probe);
          const matches = getComputedStyle(heading).color === getComputedStyle(probe).color;
          probe.remove();
          return matches;
        }),
      )
      .toBe(true);
    await recover.focus();
    await expect(recover).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  });
}
