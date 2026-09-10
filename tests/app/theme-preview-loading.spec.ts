import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Dither loading previews preserve unknown progress and reduced motion", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  const { token } = await registerUser(request, `dither-loading-${Date.now()}@example.com`);
  const workspace = await createWorkspace(request, token, "Dither loading");
  const created = await request.post("/api/v1/themes", {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      organization_id: workspace.organization_id,
      name: "Dither loading",
      duplicate_built_in_id: "dither",
    },
  });
  expect(created.ok()).toBe(true);
  await authenticatePage(page, token);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/settings?tab=appearance");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Preview scene", exact: true }).click();
  await page.getByRole("option", { name: "Loading state", exact: true }).click();
  await expect(page.getByRole("listbox")).toBeHidden();
  const preview = page.getByTestId("theme-preview");
  await expect(preview).toHaveAttribute("aria-busy", "false");
  for (const scheme of ["Light", "Dark"]) {
    await page.getByRole("button", { name: "Preview color scheme", exact: true }).click();
    await page.getByRole("option", { name: scheme, exact: true }).click();
    await expect
      .poll(() =>
        preview.evaluate((frame) => frame.contentDocument?.documentElement.dataset.themeScheme),
      )
      .toBe(scheme.toLowerCase());
    const state = await preview.evaluate((frame) => {
      const doc = frame.contentDocument!;
      const fill = doc.querySelector('[data-slot="progress-fill"]')!;
      const skeleton = doc.querySelector('[data-slot="skeleton"]')!;
      return {
        percent: doc.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"),
        progressMotion: frame.contentWindow!.getComputedStyle(fill).animationName,
        skeletonMotion: frame.contentWindow!.getComputedStyle(skeleton, "::after").animationName,
        texture: frame.contentWindow!.getComputedStyle(fill, "::after").maskImage,
      };
    });
    expect(state.percent).toBeNull();
    expect(state.progressMotion).toBe("none");
    expect(state.skeletonMotion).toBe("none");
    expect(state.texture).toContain("data:image/svg+xml");
    await preview.screenshot({
      path: `.impeccable/review/dither-default/loading-${scheme.toLowerCase()}.png`,
      animations: "disabled",
    });
  }
  await page.getByRole("button", { name: "Preview viewport", exact: true }).click();
  await page.getByRole("option", { name: "390px", exact: true }).click();
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(preview).toHaveCSS("width", "390px");
});
