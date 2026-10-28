import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { expect, test } from "@playwright/test";
import { authenticatePage, composerDestinations, createWorkspace, registerUser } from "./helpers";

test("optimizes attachments automatically and fits one network while keeping both originals", async ({
  page,
  request,
}, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const auth = await registerUser(request, `image-preparation-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Image preparation");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const accounts = ["bluesky", "linkedin", "mastodon"].map((platform) => ({
    id: randomUUID(),
    platform,
  }));
  for (const account of accounts)
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${account.id}','${workspace.id}','prepare-${account.id}','${account.platform}','${account.id}','prepare',X'00',1);`,
    ]);
  const flat = await sharp({
    create: { width: 1000, height: 800, channels: 3, background: "#b74c05" },
  })
    .png({ compressionLevel: 0 })
    .toBuffer();
  const pixels = Buffer.alloc(1400 * 1100 * 3);
  let seed = 417;
  for (let index = 0; index < pixels.length; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels[index] = seed >>> 24;
  }
  const noisy = await sharp(pixels, { raw: { width: 1400, height: 1100, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const originals = [];
  for (const [index, buffer] of [flat, noisy].entries()) {
    const response = await request.post("/api/v1/media/upload", {
      headers,
      multipart: {
        workspace_id: workspace.id,
        alt_text: "",
        ...(index ? { source: "image_editor_edit", parent_media_id: originals[0].id } : {}),
        file: { name: index ? "detail.png" : "flat.png", mimeType: "image/png", buffer },
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    originals.push(await response.json());
  }
  const created = await request.post("/api/v1/publications", {
    headers,
    data: {
      workspace_id: workspace.id,
      title: "Prepared images",
      content_profile: "short_text",
      source_text: "Image preparation",
      segments: [{ body: "Image preparation" }],
      renditions: accounts.map((account) => ({ social_account_id: account.id })),
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const publication = await created.json();
  const read = async () =>
    await (await request.get(`/api/v1/publications/${publication.id}`, { headers })).json();
  // Stub only the external caption generation boundary; retain real attachment persistence.
  const captionRequests: string[] = [];
  let releaseFitCaption!: () => void;
  const fitCaptionHeld = new Promise<void>((resolve) => {
    releaseFitCaption = resolve;
  });
  await page.route("**/api/v1/media/*/alt-text/generate", async (route) => {
    captionRequests.push(route.request().url().split("/media/")[1].split("/")[0]);
    const first = captionRequests.length === 1;
    if (!first) await fitCaptionHeld;
    return route.fulfill({ json: { alt_text: first ? "Orange original" : "Fine color detail" } });
  });
  await authenticatePage(page, auth.token);
  await page.goto(`/publications/${publication.id}?workspace_id=${workspace.id}`);
  const add = async (filename: string) => {
    await page.getByRole("button", { name: "Add media", exact: true }).click();
    const picker = page.getByRole("dialog");
    await picker.getByRole("tab", { name: "Library", exact: true }).click();
    await picker.getByRole("button", { name: `Select ${filename}`, exact: true }).click();
    await picker.getByRole("button", { name: /^Add/ }).click();
  };
  const useOriginal = async (label: string) => {
    await page
      .getByTestId("composer-variant-toolbar")
      .getByRole("button", { name: "More", exact: true })
      .click();
    await page.getByRole("menuitem", { name: label, exact: true }).click();
  };
  await add("flat.png");
  await expect
    .poll(async () => (await read()).segments[0].media?.[0]?.id)
    .not.toBe(originals[0].id);
  await expect.poll(async () => (await read()).segments[0].media?.length).toBe(1);
  let detail = await read();
  const optimized = detail.segments[0].media[0];
  expect(optimized.size).toBeLessThan(originals[0].size);
  await expect
    .poll(async () => (await read()).segments[0].media[0].alt_text)
    .toBe("Orange original");
  expect(captionRequests).toContain(optimized.id);
  expect(captionRequests).not.toContain(originals[0].id);
  // Loading the original through a destination menu must keep resolving shared media,
  // even when the tab switches back to All while the request is held.
  await page.waitForLoadState("networkidle");
  await page.reload();
  await page.locator(`#composer-destination-${accounts[0].id}`).click();
  let releaseOriginal!: () => void;
  const originalHeld = new Promise<void>((resolve) => {
    releaseOriginal = resolve;
  });
  await page.route("**/api/v1/media/metadata?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("media_ids") !== originals[0].id)
      return route.continue();
    const response = await route.fetch();
    await originalHeld;
    await route.fulfill({ response });
  });
  const originalStarted = page.waitForRequest(
    (req) =>
      req.url().includes("/media/metadata?") &&
      new URL(req.url()).searchParams.get("media_ids") === originals[0].id,
  );
  const originalLoaded = page.waitForResponse(
    (res) =>
      res.url().includes("/media/metadata?") &&
      new URL(res.url()).searchParams.get("media_ids") === originals[0].id,
  );
  await useOriginal("Use original image 1");
  await originalStarted;
  await composerDestinations(page).getByRole("button", { name: "All", exact: true }).click();
  releaseOriginal();
  await (await originalLoaded).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect.poll(async () => (await read()).segments[0].media[0]?.id).toBe(originals[0].id);
  await page.unroute("**/api/v1/media/metadata?**");
  await expect.poll(async () => (await read()).segments[0].media[0]?.id).toBe(originals[0].id);
  await page.locator(`#composer-destination-${accounts[0].id}`).click();
  const captionStarted = page.waitForRequest("**/api/v1/media/*/alt-text/generate");
  await add("detail.png");
  await captionStarted;
  const fit = page.getByRole("button", { name: "Fit image 2 for Bluesky", exact: true });
  await expect(fit).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 1000 });
  await fit.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("before-fit.png"), fullPage: true });
  const preparation = page.waitForRequest(`**/api/v1/media/${originals[1].id}/prepare-image`);
  await fit.click();
  expect((await preparation).postDataJSON()).toMatchObject({
    account_id: accounts[0].id,
    output_profile: "bluesky.post",
  });
  await expect(
    page.getByText("Image fitted for this account. Original kept.", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const sky = (await read()).renditions.find(
        (r: { social_account_id: string }) => r.social_account_id === accounts[0].id,
      );
      return sky.segments[0].media.some(
        (m: { size: number; id: string }) => m.id !== originals[0].id && m.size <= 2_000_000,
      );
    })
    .toBe(true);
  detail = await read();
  const sky = detail.renditions.find(
    (r: { social_account_id: string }) => r.social_account_id === accounts[0].id,
  );
  const fitted = sky.segments[0].media.find((m: { id: string }) => m.id !== originals[0].id);
  releaseFitCaption();
  await expect
    .poll(
      async () =>
        (await read()).renditions
          .find((r: { social_account_id: string }) => r.social_account_id === accounts[0].id)
          .segments[0].media.find((m: { id: string }) => m.id === fitted.id)?.alt_text,
    )
    .toBe("Fine color detail");
  expect(detail.segments[0].media.map((m: { id: string }) => m.id)).toEqual([originals[0].id]);
  expect(
    detail.renditions
      .find((r: { social_account_id: string }) => r.social_account_id === accounts[1].id)
      .segments[0].media.map((m: { id: string }) => m.id),
  ).toEqual([originals[0].id]);
  const metadata = await (
    await request.get("/api/v1/media/metadata", {
      headers,
      params: { workspace_id: workspace.id, media_ids: fitted.id },
    })
  ).json();
  expect(metadata.media[0].parent_media_id).toBe(originals[1].id);
  for (const [index, bytes] of [flat, noisy].entries()) {
    const stored = await request.get(`/media/${originals[index].id}`, { headers });
    expect(stored.ok()).toBe(true);
    expect(await stored.body()).toEqual(bytes);
  }
  await page.waitForLoadState("networkidle");
  await page.reload();
  await page.locator(`#composer-destination-${accounts[0].id}`).click();
  await expect(
    page
      .getByTestId("composer-account-preview")
      .locator(`[data-composer-media-id="${fitted.id}"] img`),
  ).toHaveAttribute("alt", "Fine color detail");
  for (const colorScheme of ["light", "dark"] as const)
    for (const width of [1280, 390, 320]) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: info.outputPath(`after-fit-${width}-${colorScheme}.png`),
        fullPage: true,
      });
    }
  await useOriginal("Use original image 2");
  await expect
    .poll(async () =>
      (await read()).renditions
        .find((r: { social_account_id: string }) => r.social_account_id === accounts[0].id)
        .segments[0].media.map((m: { id: string }) => m.id),
    )
    .toEqual([originals[0].id, originals[1].id]);
  await composerDestinations(page).getByRole("button", { name: "All", exact: true }).click();
  expect((await read()).segments[0].media[0].alt_text).toBe("Orange original");
  // A relink is an authored decision, even when its effective IDs do not change.
  const staleCreated = await request.post("/api/v1/publications", {
    headers,
    data: {
      workspace_id: workspace.id,
      title: "Relink during fit",
      content_profile: "short_text",
      source_text: "Same attachment",
      segments: [{ body: "Same attachment", media: [{ media_id: originals[1].id }] }],
      renditions: accounts.map((account) => ({ social_account_id: account.id })),
    },
  });
  expect(staleCreated.ok(), await staleCreated.text()).toBe(true);
  const stalePost = await staleCreated.json();
  await page.goto(`/publications/${stalePost.id}?workspace_id=${workspace.id}`);
  await page.locator(`#composer-destination-${accounts[0].id}`).click();
  await page.getByRole("button", { name: "Shared content", exact: true }).click();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let preparationResponded!: () => void;
  const preparationDrained = new Promise<void>((resolve) => {
    preparationResponded = resolve;
  });
  await page.route(`**/api/v1/media/${originals[1].id}/optimize-image`, async (route) => {
    try {
      await held;
      await route.fulfill({ json: { optimized: false, media: originals[1] } });
    } finally {
      preparationResponded();
    }
  });
  const started = page.waitForRequest(`**/api/v1/media/${originals[1].id}/optimize-image`);
  const staleFit = page.getByRole("button", { name: "Fit image 1 for Bluesky", exact: true });
  await staleFit.click();
  await started;
  await page.getByRole("button", { name: "Shared content", exact: true }).click();
  release();
  await preparationDrained;
  await expect(staleFit).toBeEnabled();
  await expect
    .poll(async () => {
      const detail = await (
        await request.get(`/api/v1/publications/${stalePost.id}`, { headers })
      ).json();
      return detail.renditions.find(
        (r: { social_account_id: string }) => r.social_account_id === accounts[0].id,
      ).segments[0].media_inherited;
    })
    .toBe(true);
  // Preserve settings and a pending caption when restoring shared media.
  const blueBytes = await sharp({
    create: { width: 640, height: 360, channels: 3, background: "#4469a4" },
  })
    .png({ compressionLevel: 0 })
    .toBuffer();
  const blueUpload = await request.post("/api/v1/media/upload", {
    headers,
    multipart: {
      workspace_id: workspace.id,
      file: { name: "pending-blue.png", mimeType: "image/png", buffer: blueBytes },
    },
  });
  expect(blueUpload.ok(), await blueUpload.text()).toBe(true);
  const blueOriginal = await blueUpload.json();
  const blueCreated = await request.post("/api/v1/publications", {
    headers,
    data: {
      workspace_id: workspace.id,
      title: "Pending blue",
      content_profile: "short_text",
      source_text: "Pending blue",
      segments: [{ body: "Pending blue" }],
      renditions: accounts.map((a) => ({ social_account_id: a.id })),
    },
  });
  expect(blueCreated.ok(), await blueCreated.text()).toBe(true);
  const bluePost = await blueCreated.json();
  const readBlue = async () =>
    await (await request.get(`/api/v1/publications/${bluePost.id}`, { headers })).json();
  await page.unroute("**/api/v1/media/*/alt-text/generate");
  let releaseBlueCaption!: () => void;
  const blueHeld = new Promise<void>((resolve) => {
    releaseBlueCaption = resolve;
  });
  await page.route("**/api/v1/media/*/alt-text/generate", async (route) => {
    await blueHeld;
    await route.fulfill({ json: { alt_text: "Blue original" } });
  });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`/publications/${bluePost.id}?workspace_id=${workspace.id}`);
  await composerDestinations(page).getByRole("button", { name: "All", exact: true }).click();
  const blueCaptionStarted = page.waitForRequest("**/api/v1/media/*/alt-text/generate");
  await add("pending-blue.png");
  await blueCaptionStarted;
  await page.locator(`#composer-destination-${accounts[2].id}`).click();
  await page
    .getByTestId("composer-variant-toolbar")
    .getByRole("button", { name: "More", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Platform settings", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Focal point", exact: true })
    .fill("0.25,-0.5");
  await page.getByRole("dialog").getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page
      .getByTestId("composer-variant-toolbar")
      .getByRole("button", { name: "Shared content", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  // Restoring from a destination menu without per-account media still resolves shared media.
  await useOriginal("Use original image 1");
  await expect
    .poll(async () => (await readBlue()).segments[0].media?.[0]?.id)
    .toBe(blueOriginal.id);
  // A deliberate empty caption on one account must not stop captions for All or other accounts.
  await page.locator(`#composer-destination-${accounts[0].id}`).click();
  const blueTile = page
    .getByTestId("composer-account-preview")
    .locator(`[data-composer-media-id="${blueOriginal.id}"]`);
  await blueTile.getByRole("button", { name: "Generating alt text...", exact: true }).click();
  await blueTile
    .getByRole("textbox", { name: "Alt text", exact: true })
    .fill("Temporary description");
  await blueTile.getByRole("textbox", { name: "Alt text", exact: true }).fill("");
  await blueTile.getByRole("button", { name: "Done", exact: true }).click();
  releaseBlueCaption();
  await expect
    .poll(async () => (await readBlue()).segments[0].media?.[0]?.alt_text)
    .toBe("Blue original");
  await expect
    .poll(async () => {
      const detail = await readBlue();
      const sky = detail.renditions.find(
        (r: { social_account_id: string }) => r.social_account_id === accounts[0].id,
      );
      const mastodon = detail.renditions.find(
        (r: { social_account_id: string }) => r.social_account_id === accounts[2].id,
      );
      return {
        sky: sky.segments[0].media[0].alt_text ?? "",
        alt: mastodon.segments[0].media[0].alt_text,
        focal: mastodon.segments[0].media[0].settings?.focal_point,
      };
    })
    .toEqual({ sky: "", alt: "Blue original", focal: "0.25,-0.5" });
  expect(errors).toEqual([]);
});
