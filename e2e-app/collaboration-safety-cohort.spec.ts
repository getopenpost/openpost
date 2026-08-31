import { expect, test, type Page } from "@playwright/test";
import { expectNoSeriousAccessibilityViolations } from "./accessibility";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const scenarios = [
  {
    name: "desktop English light",
    width: 1280,
    height: 900,
    locale: "en",
    theme: "light",
    digestTime: "10:15",
    labels: {
      frequency: "Post published · Email frequency",
      daily: "Daily",
      digestTime: "Daily digest time",
      timezone: "Timezone",
      save: "Save preferences",
      activeMutes: "Active mutes",
      account: "All workspaces",
      workspaceSuffix: "only",
      workspaceFirst: true,
      mutedUntil: "Optional email paused until ",
      muteScope: "Mute scope",
      muteEndTime: "End time",
      startMute: "Start mute",
      endMute: "End now",
      transactional: "Workspace invitation · Email frequency",
      immediate: "Immediate",
    },
  },
  {
    name: "phone English dark",
    width: 390,
    height: 844,
    locale: "en",
    theme: "dark",
    digestTime: "11:30",
    labels: {
      frequency: "Post published · Email frequency",
      daily: "Daily",
      digestTime: "Daily digest time",
      timezone: "Timezone",
      save: "Save preferences",
      activeMutes: "Active mutes",
      account: "All workspaces",
      workspaceSuffix: "only",
      workspaceFirst: true,
      mutedUntil: "Optional email paused until ",
      muteScope: "Mute scope",
      muteEndTime: "End time",
      startMute: "Start mute",
      endMute: "End now",
      transactional: "Workspace invitation · Email frequency",
      immediate: "Immediate",
    },
  },
  {
    name: "compact phone Portuguese light",
    width: 320,
    height: 760,
    locale: "pt",
    theme: "light",
    digestTime: "12:45",
    labels: {
      frequency: "Publicação publicada · Frequência de email",
      daily: "Diário",
      digestTime: "Hora do resumo diário",
      timezone: "Fuso horário",
      save: "Guardar preferências",
      activeMutes: "Silêncios ativos",
      account: "Todos os espaços de trabalho",
      workspaceSuffix: "Apenas",
      workspaceFirst: false,
      mutedUntil: "Emails opcionais pausados até ",
      muteScope: "Âmbito do silêncio",
      muteEndTime: "Hora de fim",
      startMute: "Iniciar silêncio",
      endMute: "Terminar agora",
      transactional: "Convite para espaço de trabalho · Frequência de email",
      immediate: "Imediato",
    },
  },
] as const;

test("Daily preferences and overlapping Mutes remain one operable settings journey", async ({
  page,
  request,
}, testInfo) => {
  test.slow();
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `collaboration-safety-${unique}@example.com`);
  const workspace = (await createWorkspace(request, auth.token, `Safety cohort ${unique}`)) as {
    id: string;
    name: string;
  };
  const headers = { Authorization: `Bearer ${auth.token}` };
  const muteEndInstants = ["2035-08-16T21:45:00Z", "2035-08-16T21:15:00Z"];
  for (const mute of [
    { scope: "account", ends_at: muteEndInstants[0] },
    {
      scope: "workspace",
      workspace_id: workspace.id,
      ends_at: muteEndInstants[1],
    },
  ]) {
    const response = await request.post("/api/v1/notifications/mutes", {
      headers,
      data: mute,
    });
    expect(response.ok()).toBe(true);
  }

  const savedRequests: Array<{ digest_time: string; digest_timezone: string }> = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/v1/notifications/preferences" &&
      request.method() === "PUT"
    ) {
      const body = request.postDataJSON() as {
        digest_time: string;
        digest_timezone: string;
      };
      savedRequests.push(body);
    }
  });
  await authenticatePage(page, auth.token);
  await page.addInitScript((currentWorkspace) => {
    localStorage.setItem("openpost_current_workspace", JSON.stringify(currentWorkspace));
  }, workspace);
  await page.goto("/");

  for (const scenario of scenarios) {
    await test.step(scenario.name, async () => {
      await page.setViewportSize({
        width: scenario.width,
        height: scenario.height,
      });
      await setPresentation(page, scenario.locale, scenario.theme);
      await page.goto(`/settings?tab=notifications&workspace=${workspace.id}`);
      const activeMutes = page.getByRole("list", {
        name: scenario.labels.activeMutes,
      });
      await expect(activeMutes.getByText(scenario.labels.account, { exact: true })).toBeVisible();
      await expect(
        activeMutes.getByText(workspaceMuteLabel(scenario, workspace.name), { exact: true }),
      ).toBeVisible();
      const renderedEndTimes = await page.evaluate((endsAt) => {
        const formatter = new Intl.DateTimeFormat(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
        });
        return endsAt.map((end) => formatter.format(new Date(end)));
      }, muteEndInstants);
      for (const endTime of renderedEndTimes) {
        await expect(
          activeMutes.getByText(`${scenario.labels.mutedUntil}${endTime}.`, { exact: true }),
        ).toBeVisible();
      }

      const frequency = page.getByRole("button", {
        name: scenario.labels.frequency,
      });
      await frequency.focus();
      await expect(frequency).toBeFocused();
      await frequency.press("Enter");
      await expect(
        page.getByRole("option", { name: scenario.labels.daily, exact: true }),
      ).toBeVisible();
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await expect(frequency).toContainText(scenario.labels.daily);

      const digestTime = page.getByLabel(scenario.labels.digestTime);
      const digestTimezone = page.getByLabel(scenario.labels.timezone, {
        exact: true,
      });
      await digestTime.fill(scenario.digestTime);
      await digestTimezone.fill("Europe/Lisbon");

      const transactional = page.getByRole("button", {
        name: scenario.labels.transactional,
      });
      await expect(transactional).toBeDisabled();
      await expect(transactional).toContainText(scenario.labels.immediate);

      const save = page.getByRole("button", { name: scenario.labels.save });
      await save.scrollIntoViewIfNeeded();
      await expect(save).toBeInViewport();
      await save.focus();
      await expect(save).toBeFocused();
      await save.press("Enter");
      await expect.poll(() => savedRequests.at(-1)?.digest_time).toBe(scenario.digestTime);
      expect(savedRequests.at(-1)?.digest_timezone).toBe("Europe/Lisbon");
      await expect(save).toBeDisabled();

      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await expectNoSeriousAccessibilityViolations(page);
      await page.screenshot({
        path: testInfo.outputPath(`collaboration-safety-${scenario.width}-${scenario.locale}.png`),
        fullPage: true,
      });
    });
  }

  const finalScenario = scenarios.at(-1)!;
  const finalMutes = page.getByRole("list", { name: finalScenario.labels.activeMutes });
  const workspaceMute = finalMutes
    .getByRole("listitem")
    .filter({ hasText: workspaceMuteLabel(finalScenario, workspace.name) });
  const endMute = workspaceMute.getByRole("button", { name: finalScenario.labels.endMute });
  await endMute.focus();
  await expect(endMute).toBeFocused();
  await endMute.press("Enter");
  await expect(workspaceMute).toHaveCount(0);

  const muteScope = page.getByLabel(finalScenario.labels.muteScope);
  await muteScope.focus();
  await expect(muteScope).toBeFocused();
  await muteScope.press("Enter");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.getByLabel(finalScenario.labels.muteEndTime).fill("2035-08-17T12:00");
  const startMute = page.getByRole("button", { name: finalScenario.labels.startMute });
  await startMute.focus();
  await expect(startMute).toBeFocused();
  await startMute.press("Enter");
  await expect(
    finalMutes.getByText(workspaceMuteLabel(finalScenario, workspace.name), { exact: true }),
  ).toBeVisible();

  expect(savedRequests).toHaveLength(scenarios.length);
  expect(errors).toEqual([]);
});

async function setPresentation(page: Page, locale: "en" | "pt", theme: "light" | "dark") {
  await page.context().addCookies([
    {
      name: "PARAGLIDE_LOCALE",
      value: locale,
      domain: "127.0.0.1",
      path: "/",
      sameSite: "Lax",
    },
  ]);
  await page.evaluate((selectedTheme) => {
    localStorage.setItem("mode-watcher-mode", selectedTheme);
  }, theme);
}

function workspaceMuteLabel(scenario: (typeof scenarios)[number], workspaceName: string): string {
  return scenario.labels.workspaceFirst
    ? `${workspaceName} ${scenario.labels.workspaceSuffix}`
    : `${scenario.labels.workspaceSuffix} ${workspaceName}`;
}
