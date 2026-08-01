import { expect, test } from "@playwright/test";

test("docs homepage routes readers to distinct doc audiences", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Choose the right docs" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "watch the product demo" }),
  ).toHaveAttribute("href", "https://youtu.be/_mZf3HzQaN8");
  await expect(
    page.getByRole("link", { name: "User docs", exact: true }),
  ).toHaveAttribute("href", "/usage/");
  await expect(
    page.getByRole("link", { name: "Self-hosting docs" }),
  ).toHaveAttribute("href", "/self-hosting/");
  await expect(
    page.getByRole("link", { name: "Developer docs" }).last(),
  ).toHaveAttribute("href", "/development/");
});

test("user docs stay focused on product workflows", async ({ page }) => {
  await page.goto("/usage/");
  const main = page.locator("main");

  await expect(main.locator("h1")).toContainText("User Docs");
  await expect(main.getByRole("heading", { name: "Web app" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "CLI" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "MCP" })).toBeVisible();
  await expect(
    main.getByRole("heading", { name: "Where not to look" }),
  ).toBeVisible();
  await expect(
    main.getByRole("link", { name: "watch the OpenPost product demo" }),
  ).toHaveAttribute("href", "https://youtu.be/_mZf3HzQaN8");
  await expect(
    main.getByRole("link", { name: "Self-Hosting" }),
  ).toHaveAttribute("href", "/self-hosting/");
  await expect(
    main.getByRole("link", { name: "Developer Docs" }),
  ).toHaveAttribute("href", "/development/");
});

test("self-hosting docs are operator-facing", async ({ page }) => {
  await page.goto("/self-hosting/");
  const main = page.locator("main");

  await expect(main.locator("h1")).toContainText("Self-Hosting Docs");
  await expect(
    main.getByText("These pages assume that you manage the server.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(main.getByRole("heading", { name: "Install" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Configure" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Operate" })).toBeVisible();
  await expect(main.getByRole("link", { name: "User Docs" })).toHaveAttribute(
    "href",
    "/usage/",
  );
  await expect(
    main.getByRole("link", { name: "Developer Docs" }),
  ).toHaveAttribute("href", "/development/");
  await expect(
    main.getByRole("link", { name: "Provider Troubleshooting" }),
  ).toHaveAttribute("href", "/providers/troubleshooting");
});

test("provider troubleshooting docs stay operator-facing", async ({ page }) => {
  await page.goto("/providers/troubleshooting");
  const main = page.locator("main");

  await expect(main.locator("h1")).toContainText("Provider Troubleshooting");
  await expect(
    main.getByRole("heading", { name: "First Checks" }),
  ).toBeVisible();
  await expect(main.getByRole("heading", { name: "X" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "YouTube" })).toBeVisible();
  await expect(
    main.getByText(
      "It also includes the last 100 log lines with private data removed.",
      {
        exact: false,
      },
    ),
  ).toBeVisible();
});

test("developer docs are contributor-facing", async ({ page }) => {
  await page.goto("/development/");
  const main = page.locator("main");

  await expect(main.locator("h1")).toContainText("Developer Docs");
  await expect(
    main.getByText("They can assume repository access"),
  ).toBeVisible();
  await expect(
    main.getByRole("heading", { name: "Backend and API" }),
  ).toBeVisible();
  await expect(
    main.getByRole("heading", { name: "Frontend, MCP, and launch work" }),
  ).toBeVisible();
  await expect(
    main.getByRole("link", { name: "MCP and ChatGPT App" }),
  ).toHaveAttribute("href", "/development/mcp");
  await expect(main.getByRole("link", { name: "User Docs" })).toHaveAttribute(
    "href",
    "/usage/",
  );
  await expect(
    main.getByRole("link", { name: "Self-Hosting Docs" }),
  ).toHaveAttribute("href", "/self-hosting/");
});
