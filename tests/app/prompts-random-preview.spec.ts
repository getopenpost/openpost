import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Random reveals an idea and only an explicit New post authors its example", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  const auth = await registerUser(request, `random-prompt-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Random prompt preview");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const postsURL = `/api/v1/publications?workspace_id=${workspace.id}`;
  const errors: string[] = [];
  const writes: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (req) => {
    if (req.url().includes("/api/v1/") && !["GET", "HEAD"].includes(req.method()))
      writes.push(`${req.method()} ${new URL(req.url()).pathname}`);
  });
  await authenticatePage(page, auth.token);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/prompts");
  let selected: { text: string; example: string } | undefined;
  try {
    for (const width of [1280, 390, 320]) {
      for (const scheme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme });
        await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
        await page.reload();
        const random = page.getByRole("button", { name: "Random", exact: true });
        const response = page.waitForResponse(
          (res) => new URL(res.url()).pathname === "/api/v1/prompts/random",
        );
        await random.focus();
        await page.keyboard.press("Enter");
        const chosen = await response;
        expect(chosen.ok()).toBe(true);
        selected = await chosen.json();
        await expect(page).toHaveURL(/\/prompts$/);
        const preview = page.getByRole("region", { name: "Writing prompt", exact: true });
        await expect(preview.getByText(selected!.text, { exact: true })).toBeVisible();
        await expect(preview.getByText(selected!.example, { exact: true })).toBeVisible();
        await expect(preview.getByRole("button", { name: "New post", exact: true })).toBeVisible();
        await expect(random).toBeFocused();
        await expect(preview).toBeInViewport();
        await page.screenshot({ path: testInfo.outputPath(`random-${width}-${scheme}.png`) });
        expect(await (await request.get(postsURL, { headers })).json()).toEqual([]);
        expect(writes).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
          false,
        );
      }
    }
    const categoriesResponse = await request.get("/api/v1/prompts/categories", { headers });
    expect(categoriesResponse.ok()).toBe(true);
    const { categories } = await categoriesResponse.json();
    const category = categories[0];
    await page.getByRole("button", { name: "All categories", exact: true }).click();
    await page.getByRole("option", { name: category, exact: true }).click();
    await expect(page.getByRole("region", { name: "Writing prompt", exact: true })).toHaveCount(0);
    const filteredResponse = page.waitForResponse((res) => {
      const url = new URL(res.url());
      return (
        url.pathname === "/api/v1/prompts/random" && url.searchParams.get("category") === category
      );
    });
    await page.getByRole("button", { name: "Random", exact: true }).click();
    const filtered = await filteredResponse;
    expect(filtered.ok()).toBe(true);
    selected = await filtered.json();
    await expect(
      page
        .getByRole("region", { name: "Writing prompt", exact: true })
        .getByText(selected!.text, { exact: true }),
    ).toBeVisible();
    expect(await (await request.get(postsURL, { headers })).json()).toEqual([]);
    expect(writes).toEqual([]);
    const author = page
      .getByRole("region", { name: "Writing prompt", exact: true })
      .getByRole("button", { name: "New post", exact: true });
    await author.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "Post text", exact: true })).toHaveValue(
      selected!.example,
    );
    await expect
      .poll(async () => (await (await request.get(postsURL, { headers })).json()).length)
      .toBe(1);
    const [post] = await (await request.get(postsURL, { headers })).json();
    expect(post.status).toBe("draft");
    expect(post.source_text).toBe(selected!.example);
    expect(errors).toEqual([]);
  } finally {
    const posts = await request.get(postsURL, { headers });
    const evidence = testInfo.outputPath("retained-public-posts.json");
    writeFileSync(
      evidence,
      JSON.stringify({ url: page.url(), posts: await posts.json(), writes, errors }, null, 2),
    );
    await testInfo.attach("retained-public-posts", {
      path: evidence,
      contentType: "application/json",
    });
  }
});
