import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

async function mcpTool(
  request: APIRequestContext,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, any>> {
  const response = await request.post("/mcp", {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "tools/call",
      params: { name, arguments: args },
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as {
    error?: { message?: string };
    result?: { structuredContent?: Record<string, any> };
  };
  expect(payload.error, payload.error?.message).toBeUndefined();
  expect(payload.result?.structuredContent).toBeDefined();
  return payload.result!.structuredContent!;
}

async function mcpPreview(
  request: APIRequestContext,
  token: string,
  args: Record<string, unknown>,
  name = "preview_render",
): Promise<{
  receipt: Record<string, any>;
  image: { type: string; mimeType: string; data: string };
}> {
  const response = await request.post("/mcp", {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "tools/call",
      params: { name, arguments: args },
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.error).toBeUndefined();
  expect(
    payload.result.structuredContent.request.status,
    JSON.stringify(payload.result.structuredContent.request.error),
  ).toBe("completed");
  const image = payload.result.content.find((entry: { type: string }) => entry.type === "image");
  expect(image?.mimeType).toBe("image/jpeg");
  expect(Buffer.from(image.data, "base64").subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  return { receipt: payload.result.structuredContent.request, image };
}

function testToneWAV(): Buffer {
  const sampleRate = 48_000;
  const sampleCount = sampleRate;
  const wav = Buffer.alloc(44 + sampleCount * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    wav.writeInt16LE(
      Math.round(Math.sin((index * Math.PI * 2 * 440) / sampleRate) * 6000),
      44 + index * 2,
    );
  }
  return wav;
}

test("MCP edits the open Video Editor live with retry and stale revision protection", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  const auth = await registerUser(request, `editor-agent-video-${randomUUID()}@example.com`);
  const workspace = (await createWorkspace(request, auth.token, "Video agent")) as { id: string };
  const tokenResponse = await request.post("/api/v1/api-tokens", {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: { name: "Editor agent", scope: "mcp:full", workspace_id: workspace.id },
  });
  expect(tokenResponse.ok()).toBeTruthy();
  const token = ((await tokenResponse.json()) as { token: string }).token;
  await authenticatePage(page, auth.token);
  await page.goto("/video-editor");
  await page.getByRole("button", { name: "Open Video Editor", exact: true }).click();
  await expect(page.locator(".video-editor-theme")).toHaveAttribute(
    "data-agent-status",
    "connected",
  );
  await page.screenshot({ path: testInfo.outputPath("video-before-light.png") });
  const projectId = new URL(page.url()).pathname.split("/").at(-1)!;

  const sessions = await mcpTool(request, token, "editor_sessions", { workspace_id: workspace.id });
  const session = sessions.sessions.find(
    (entry: { project_id: string }) => entry.project_id === projectId,
  );
  expect(session?.id).toBeTruthy();
  expect(session).not.toHaveProperty("epoch");
  const scope = { workspace_id: workspace.id, session_id: session.id };
  const library = await mcpTool(request, token, "media_library", scope);
  expect(library.request.result.media_count).toBe(0);
  const before = await mcpTool(request, token, "editor_context", scope);
  expect(before.request.status, JSON.stringify(before.request.error)).toBe("completed");
  const revision = before.request.result.revision as string;
  const key = randomUUID();
  const editArgs = {
    ...scope,
    project_id: projectId,
    expected_revision: revision,
    request_id: key,
    actions: [{ kind: "text.add", value: { text: "Agent live title", frame: 0 } }],
  };
  const edit = await mcpTool(request, token, "video_edit", editArgs);
  expect(edit.request.status, JSON.stringify(edit.request.error)).toBe("completed");
  expect(edit.request.result.status).toBe("committed");
  const retry = await mcpTool(request, token, "video_edit", editArgs);
  expect(retry.request.id).toBe(edit.request.id);

  const timeline = await mcpTool(request, token, "timeline_inspect", scope);
  expect(
    timeline.request.result.items.filter(
      (item: { text?: string }) => item.text === "Agent live title",
    ),
  ).toHaveLength(1);
  await expect(page.getByText("Agent live title", { exact: true }).first()).toBeVisible();

  const preview = await mcpPreview(request, token, {
    ...scope,
    project_id: projectId,
    expected_revision: edit.request.result.after_revision,
    frame: 0,
  });
  expect(preview.receipt.result.provenance).toContain("composited export renderer");
  const revealed = await mcpTool(request, token, "editor_reveal", {
    ...scope,
    project_id: projectId,
    expected_revision: edit.request.result.after_revision,
    frame: 1,
    item_id: edit.request.result.changed_ids[0],
  });
  expect(revealed.request.result.view_state_only).toBe(true);
  expect(revealed.request.result.playhead_frame).toBe(1);

  const stale = await mcpTool(request, token, "video_edit", {
    ...editArgs,
    request_id: randomUUID(),
  });
  expect(stale.request.status).toBe("failed");
  expect(stale.request.error.code).toBe("stale_revision");

  const history = await mcpTool(request, token, "editor_history_inspect", scope);
  expect(history.request.result.can_undo_agent_change).toBe(true);
  const undo = await mcpTool(request, token, "editor_history_undo", {
    ...scope,
    project_id: projectId,
    expected_revision: edit.request.result.after_revision,
    request_id: randomUUID(),
  });
  expect(undo.request.result.status).toBe("undone");
  const afterUndo = await mcpTool(request, token, "timeline_inspect", scope);
  expect(
    afterUndo.request.result.items.some(
      (item: { text?: string }) => item.text === "Agent live title",
    ),
  ).toBe(false);
  const redo = await mcpTool(request, token, "editor_history_redo", {
    ...scope,
    project_id: projectId,
    expected_revision: undo.request.result.after_revision,
    request_id: randomUUID(),
  });
  expect(redo.request.result.status).toBe("redone");
  const styled = await mcpTool(request, token, "video_edit", {
    ...scope,
    project_id: projectId,
    expected_revision: redo.request.result.after_revision,
    request_id: randomUUID(),
    actions: [
      {
        kind: "text.style",
        target_id: edit.request.result.changed_ids[0],
        value: { color: "#ff0000", font_size: 48 },
      },
    ],
  });
  expect(styled.request.result.status, JSON.stringify(styled.request.error)).toBe("committed");

  const bytes = (
    await readFile(
      fileURLToPath(new URL("./fixtures/product-screenshots/lisbon-tram.png", import.meta.url)),
    )
  ).toString("base64");
  await page.evaluate(async (encoded) => {
    const root = await navigator.storage.getDirectory();
    const imports = await root.getDirectoryHandle("test-imports", { create: true });
    const handle = await imports.getFileHandle("lisbon-tram.png", { create: true });
    const writable = await handle.createWritable();
    await writable.write(Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)));
    await writable.close();
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: async () => [handle],
    });
  }, bytes);
  await page.getByRole("button", { name: "Import media", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await mcpTool(request, token, "media_library", scope)).request.result.media?.[0]
          ?.preparation_status,
    )
    .toBe("ready");
  const imported = await mcpTool(request, token, "media_library", scope);
  const mediaID = imported.request.result.media[0].media_id;
  const source = await mcpPreview(
    request,
    token,
    { ...scope, media_id: mediaID, time_seconds: 0 },
    "media_frame",
  );
  expect(source.receipt.result.provenance).toContain("source media frame");
  const analysis = await mcpTool(request, token, "media_analysis_status", {
    ...scope,
    media_id: mediaID,
  });
  expect(analysis.request.status, JSON.stringify(analysis.request.error)).toBe("completed");
  expect(analysis.request.result.status).toBe("unsupported");
  const rejectedAnalysis = await mcpTool(request, token, "media_analyze", {
    ...scope,
    project_id: projectId,
    expected_revision: imported.request.result.revision,
    media_id: mediaID,
  });
  expect(rejectedAnalysis.request.error.code).toBe("unsupported");
  const videoBytes = (
    await readFile(fileURLToPath(new URL("../../assets/demos/video-editor.mp4", import.meta.url)))
  ).toString("base64");
  await page.evaluate(async (encoded) => {
    const root = await navigator.storage.getDirectory();
    const imports = await root.getDirectoryHandle("test-imports", { create: true });
    const handle = await imports.getFileHandle("video-editor.mp4", { create: true });
    const writable = await handle.createWritable();
    await writable.write(Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)));
    await writable.close();
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: async () => [handle],
    });
  }, videoBytes);
  await page.getByRole("button", { name: "Import media", exact: true }).click();
  await expect
    .poll(async () => {
      const library = await mcpTool(request, token, "media_library", scope);
      return library.request.result.media.find(
        (entry: { file_name: string }) => entry.file_name === "video-editor.mp4",
      )?.preparation_status;
    })
    .toBe("ready");
  const withVideo = await mcpTool(request, token, "media_library", scope);
  const videoSource = withVideo.request.result.media.find(
    (entry: { file_name: string }) => entry.file_name === "video-editor.mp4",
  );
  expect(videoSource.duration_seconds).toBeGreaterThan(0);
  const visualStatus = await mcpTool(request, token, "scene_analysis_status", {
    ...scope,
    media_id: videoSource.media_id,
  });
  expect(visualStatus.request.result.media_id).toBe(videoSource.media_id);
  const visualSearch = await mcpTool(request, token, "scene_search", {
    ...scope,
    query: "a tram on a street",
    media_id: videoSource.media_id,
  });
  expect(visualSearch.request.result.ranker).toBe("keyword_fuzzy");
  if (visualStatus.request.result.status === "unavailable") {
    expect(visualSearch.request.result.missing_analysis_media_ids).toContain(videoSource.media_id);
    const visualInspect = await mcpTool(request, token, "scene_inspect", {
      ...scope,
      media_id: videoSource.media_id,
    });
    expect(visualInspect.request.result.coverage).toBe("not_analyzed");
  }
  const speechCoverage = await mcpTool(request, token, "media_search", {
    ...scope,
    query: "an untranscribed phrase",
  });
  expect(
    speechCoverage.request.result.coverage.some(
      (entry: { media_id: string; status: string }) =>
        entry.media_id === videoSource.media_id && entry.status !== "transcribed",
    ),
  ).toBe(true);
  const storyboard = await mcpPreview(
    request,
    token,
    {
      ...scope,
      media_id: videoSource.media_id,
      samples: 3,
    },
    "media_storyboard",
  );
  expect(storyboard.receipt.result.frames).toHaveLength(3);
  expect(
    storyboard.receipt.result.frames.every(
      (frame: { status: string }) => frame.status === "decoded",
    ),
  ).toBe(true);
  expect(
    storyboard.receipt.result.frames.every(
      (frame: { requested_time_seconds: number; source_time_seconds: number }) =>
        Number.isFinite(frame.requested_time_seconds) && Number.isFinite(frame.source_time_seconds),
    ),
  ).toBe(true);
  expect(storyboard.receipt.result.provenance).toContain("source frames");
  const tone = testToneWAV().toString("base64");
  await page.evaluate(async (encoded) => {
    const root = await navigator.storage.getDirectory();
    const imports = await root.getDirectoryHandle("test-imports", { create: true });
    const handle = await imports.getFileHandle("tone.wav", { create: true });
    const writable = await handle.createWritable();
    await writable.write(Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)));
    await writable.close();
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: async () => [handle],
    });
  }, tone);
  await page.getByRole("button", { name: "Import media", exact: true }).click();
  await expect
    .poll(async () => {
      const library = await mcpTool(request, token, "media_library", scope);
      return library.request.result.media.find(
        (entry: { file_name: string }) => entry.file_name === "tone.wav",
      )?.preparation_status;
    })
    .toBe("ready");
  const withTone = await mcpTool(request, token, "media_library", scope);
  const toneID = withTone.request.result.media.find(
    (entry: { file_name: string }) => entry.file_name === "tone.wav",
  ).media_id;
  const beforeAudio = await mcpTool(request, token, "timeline_inspect", scope);
  const audioTrack = beforeAudio.request.result.tracks.find(
    (entry: { kind: string }) => entry.kind === "audio",
  );
  expect(audioTrack?.id).toBeTruthy();
  const insertedAudio = await mcpTool(request, token, "video_edit", {
    ...scope,
    project_id: projectId,
    expected_revision: beforeAudio.request.result.revision,
    request_id: randomUUID(),
    actions: [
      { kind: "media.insert", value: { media_id: toneID, frame: 0, track_id: audioTrack.id } },
    ],
  });
  expect(insertedAudio.request.result.status).toBe("committed");
  const audioResponse = await request.post("/mcp", {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "tools/call",
      params: {
        name: "preview_audio",
        arguments: {
          ...scope,
          project_id: projectId,
          expected_revision: insertedAudio.request.result.after_revision,
          start_frame: 0,
          end_frame: 30,
        },
      },
    },
  });
  expect(audioResponse.ok()).toBeTruthy();
  let audioPayload = await audioResponse.json();
  expect(audioPayload.error).toBeUndefined();
  if (["queued", "leased"].includes(audioPayload.result.structuredContent.request.status)) {
    const requestID = audioPayload.result.structuredContent.request.id;
    await expect
      .poll(
        async () => {
          const statusResponse = await request.post("/mcp", {
            headers: { Authorization: `Bearer ${token}` },
            data: {
              jsonrpc: "2.0",
              id: randomUUID(),
              method: "tools/call",
              params: {
                name: "editor_work_status",
                arguments: { workspace_id: workspace.id, request_id: requestID },
              },
            },
          });
          expect(statusResponse.ok()).toBeTruthy();
          audioPayload = await statusResponse.json();
          return audioPayload.result.structuredContent.request.status;
        },
        { timeout: 30_000 },
      )
      .toBe("completed");
  }
  expect(
    audioPayload.result.structuredContent.request.status,
    JSON.stringify(audioPayload.result.structuredContent.request.error),
  ).toBe("completed");
  const audioBlock = audioPayload.result.content.find(
    (entry: { type: string }) => entry.type === "audio",
  );
  expect(audioBlock?.mimeType).toBe("audio/wav");
  const mixedAudio = Buffer.from(audioBlock.data, "base64");
  expect(mixedAudio.toString("ascii", 0, 4)).toBe("RIFF");
  expect(mixedAudio.toString("ascii", 8, 12)).toBe("WAVE");
  expect(mixedAudio.length).toBeGreaterThan(1000);
  const dataChunk = mixedAudio.indexOf(Buffer.from("data"));
  expect(dataChunk).toBeGreaterThan(0);
  const sampleStart = dataChunk + 8;
  const sampleEnd = Math.min(
    mixedAudio.length,
    sampleStart + mixedAudio.readUInt32LE(dataChunk + 4),
  );
  let peak = 0;
  for (let offset = sampleStart; offset + 1 < sampleEnd; offset += 2) {
    peak = Math.max(peak, Math.abs(mixedAudio.readInt16LE(offset)));
  }
  expect(peak).toBeGreaterThan(1000);
  const current = await mcpTool(request, token, "editor_context", scope);
  const graphics = await mcpTool(request, token, "video_edit", {
    ...scope,
    project_id: projectId,
    expected_revision: current.request.result.revision,
    request_id: randomUUID(),
    actions: [
      { kind: "shape.add", value: { kind: "ellipse", frame: 20 } },
      { kind: "marker.add", value: { frame: 20 } },
      {
        kind: "captions.import_srt",
        value: { srt: "1\n00:00:00,000 --> 00:00:01,000\nHello caption\n" },
      },
      {
        kind: "effect.add",
        target_id: edit.request.result.changed_ids[0],
        value: { kind: "brightness" },
      },
    ],
  });
  expect(graphics.request.result.status, JSON.stringify(graphics.request.error)).toBe("committed");
  const withCaptions = await mcpTool(request, token, "timeline_inspect", scope);
  const subtitle = withCaptions.request.result.items.find(
    (entry: { type: string }) => entry.type === "subtitle",
  );
  expect(subtitle?.id).toBeTruthy();
  const titleWithEffect = await mcpTool(request, token, "timeline_inspect", {
    ...scope,
    item_id: edit.request.result.changed_ids[0],
  });
  expect(
    titleWithEffect.request.result.items[0].effects.some(
      (entry: { type: string }) => entry.type === "brightness",
    ),
  ).toBe(true);
  const captions = await mcpTool(request, token, "timeline_inspect", {
    ...scope,
    item_id: subtitle.id,
  });
  const cueID = captions.request.result.items[0].cues[0].id;
  const correctedCaption = await mcpTool(request, token, "video_edit", {
    ...scope,
    project_id: projectId,
    expected_revision: graphics.request.result.after_revision,
    request_id: randomUUID(),
    actions: [
      {
        kind: "caption.set",
        target_id: subtitle.id,
        value: { cue_id: cueID, text: "Corrected caption" },
      },
    ],
  });
  expect(
    correctedCaption.request.result.status,
    JSON.stringify(correctedCaption.request.error),
  ).toBe("committed");
  const videoExport = await mcpTool(request, token, "export_start", {
    ...scope,
    project_id: projectId,
    expected_revision: correctedCaption.request.result.after_revision,
    request_id: randomUUID(),
    format: "webm",
  });
  expect(videoExport.request.status, JSON.stringify(videoExport.request.error)).toBe("completed");
  const videoExportID = videoExport.request.result.id;
  await expect
    .poll(
      async () => {
        const status = await mcpTool(request, token, "export_status", {
          ...scope,
          project_id: projectId,
          export_id: videoExportID,
        });
        return status.request.result.status;
      },
      { timeout: 90_000 },
    )
    .toBe("completed");
  const savedVideo = await mcpTool(request, token, "export_status", {
    ...scope,
    project_id: projectId,
    export_id: videoExportID,
  });
  expect(savedVideo.request.result.result.file_name).toMatch(/\.webm$/);
  expect(savedVideo.request.result.result.file_size).toBeGreaterThan(0);
  expect(savedVideo.request.result.revision).toBe(correctedCaption.request.result.after_revision);
  const duplicate = await mcpTool(request, token, "video_edit", {
    ...scope,
    project_id: projectId,
    expected_revision: correctedCaption.request.result.after_revision,
    request_id: randomUUID(),
    actions: [
      {
        kind: "clip.duplicate",
        target_id: edit.request.result.changed_ids[0],
        value: { include_linked: false, placement: "after" },
      },
    ],
  });
  expect(duplicate.request.result.status, JSON.stringify(duplicate.request.error)).toBe(
    "committed",
  );
  const duplicateID = duplicate.request.result.changed_ids[0];
  expect(duplicateID).not.toBe(edit.request.result.changed_ids[0]);
  const ripple = await mcpTool(request, token, "video_edit", {
    ...scope,
    project_id: projectId,
    expected_revision: duplicate.request.result.after_revision,
    request_id: randomUUID(),
    actions: [
      {
        kind: "clip.ripple_remove",
        target_id: duplicateID,
        value: { include_linked: false },
      },
    ],
  });
  expect(ripple.request.result.status, JSON.stringify(ripple.request.error)).toBe("committed");
  expect(ripple.request.result.changed_ids).toContain(duplicateID);
  const afterRipple = await mcpTool(request, token, "timeline_inspect", scope);
  expect(
    afterRipple.request.result.items.some((entry: { id: string }) => entry.id === duplicateID),
  ).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("video-after-light.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.locator('span[role="status"]').filter({ hasText: "Agent connected" }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("video-phone-390-light.png") });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.screenshot({ path: testInfo.outputPath("video-phone-320-light.png") });
  await page.evaluate(() => localStorage.setItem("mode-watcher-mode", "dark"));
  await page.reload();
  await expect(page.locator(".video-editor-theme")).toHaveAttribute(
    "data-agent-status",
    "connected",
  );
  await page.screenshot({ path: testInfo.outputPath("video-phone-320-dark.png") });
});

test("MCP edits a layered image through the open design controller", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  const auth = await registerUser(request, `editor-agent-image-${randomUUID()}@example.com`);
  const workspace = (await createWorkspace(request, auth.token, "Image agent")) as { id: string };
  const tokenResponse = await request.post("/api/v1/api-tokens", {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: { name: "Image agent", scope: "mcp:full", workspace_id: workspace.id },
  });
  expect(tokenResponse.ok()).toBeTruthy();
  const token = ((await tokenResponse.json()) as { token: string }).token;
  await authenticatePage(page, auth.token);
  await page.goto(`/image-editor/new?workspace=${workspace.id}`);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
  await expect(page.getByTestId("image-editor-shell")).toHaveAttribute(
    "data-agent-status",
    "connected",
  );
  await page.screenshot({ path: testInfo.outputPath("image-before-light.png") });
  const projectId = new URL(page.url()).pathname.split("/").at(-1)!;

  const sessions = await mcpTool(request, token, "editor_sessions", { workspace_id: workspace.id });
  const session = sessions.sessions.find(
    (entry: { project_id: string }) => entry.project_id === projectId,
  );
  expect(session?.id).toBeTruthy();
  const scope = { workspace_id: workspace.id, session_id: session.id };
  const before = await mcpTool(request, token, "editor_context", scope);
  const revision = before.request.result.revision as string;
  const pageID = before.request.result.active_page_id as string;
  const edit = await mcpTool(request, token, "image_edit", {
    ...scope,
    project_id: projectId,
    expected_revision: revision,
    request_id: randomUUID(),
    actions: [{ kind: "text.add", value: { page_id: pageID, text: "Agent image title" } }],
  });
  expect(edit.request.status, JSON.stringify(edit.request.error)).toBe("completed");
  expect(edit.request.result.status).toBe("committed");
  const inspected = await mcpTool(request, token, "image_inspect", scope);
  expect(
    inspected.request.result.pages[0].layers.some(
      (layer: { text?: string }) => layer.text === "Agent image title",
    ),
  ).toBe(true);

  const preview = await mcpPreview(request, token, {
    ...scope,
    project_id: projectId,
    expected_revision: edit.request.result.after_revision,
    page_id: pageID,
  });
  expect(preview.receipt.result.provenance).toContain("static export renderer");
  const revealed = await mcpTool(request, token, "editor_reveal", {
    ...scope,
    project_id: projectId,
    expected_revision: edit.request.result.after_revision,
    page_id: pageID,
    layer_id: edit.request.result.changed_ids[0],
  });
  expect(revealed.request.result.view_state_only).toBe(true);

  const styled = await mcpTool(request, token, "image_edit", {
    ...scope,
    project_id: projectId,
    expected_revision: edit.request.result.after_revision,
    request_id: randomUUID(),
    actions: [
      {
        kind: "text.style",
        target_id: edit.request.result.changed_ids[0],
        value: { page_id: pageID, color: "#ff0000", font_size: 48 },
      },
      { kind: "shape.add", value: { page_id: pageID, kind: "ellipse" } },
    ],
  });
  expect(styled.request.result.status, JSON.stringify(styled.request.error)).toBe("committed");
  expect(styled.request.result.changed_ids).toHaveLength(2);

  const failedBatch = await mcpTool(request, token, "image_edit", {
    ...scope,
    project_id: projectId,
    expected_revision: styled.request.result.after_revision,
    request_id: randomUUID(),
    actions: [
      {
        kind: "layer.rename",
        target_id: edit.request.result.changed_ids[0],
        value: { page_id: pageID, name: "Should roll back" },
      },
      { kind: "layer.delete", target_id: "missing-layer", value: { page_id: pageID } },
    ],
  });
  expect(failedBatch.request.status).toBe("failed");
  const afterFailure = await mcpTool(request, token, "image_inspect", {
    ...scope,
    page_id: pageID,
    layer_id: edit.request.result.changed_ids[0],
  });
  expect(afterFailure.request.result.pages[0].layers[0].name).not.toBe("Should roll back");
  expect(afterFailure.request.result.revision).toBe(styled.request.result.after_revision);

  const undo = await mcpTool(request, token, "editor_history_undo", {
    ...scope,
    project_id: projectId,
    expected_revision: styled.request.result.after_revision,
    request_id: randomUUID(),
  });
  expect(undo.request.result.status).toBe("undone");
  const afterUndo = await mcpTool(request, token, "image_inspect", { ...scope, page_id: pageID });
  expect(
    afterUndo.request.result.pages[0].layers.some(
      (layer: { id: string }) => layer.id === styled.request.result.changed_ids[1],
    ),
  ).toBe(false);

  const upload = await request.post("/api/v1/media/upload", {
    headers: { Authorization: `Bearer ${auth.token}` },
    multipart: {
      workspace_id: workspace.id,
      file: {
        name: "agent-source.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZkAAAAASUVORK5CYII=",
          "base64",
        ),
      },
    },
  });
  expect(upload.ok(), await upload.text()).toBe(true);
  const sourceMedia = await upload.json();
  const inserted = await mcpTool(request, token, "image_edit", {
    ...scope,
    project_id: projectId,
    expected_revision: undo.request.result.after_revision,
    request_id: randomUUID(),
    actions: [{ kind: "image.add", value: { page_id: pageID, media_id: sourceMedia.id } }],
  });
  expect(inserted.request.result.status, JSON.stringify(inserted.request.error)).toBe("committed");
  const imageLayer = await mcpTool(request, token, "image_inspect", {
    ...scope,
    page_id: pageID,
    layer_id: inserted.request.result.changed_ids[0],
  });
  expect(imageLayer.request.result.pages[0].layers[0].image.media_id).toBe(sourceMedia.id);
  await expect
    .poll(
      async () =>
        (await mcpTool(request, token, "editor_context", scope)).request.result.save_state,
    )
    .toBe("saved");
  const beforeGrade = await mcpTool(request, token, "editor_context", scope);
  expect(beforeGrade.request.result.revision).toBe(inserted.request.result.after_revision);
  const grade = await mcpTool(request, token, "image_edit", {
    ...scope,
    project_id: projectId,
    expected_revision: beforeGrade.request.result.revision,
    request_id: randomUUID(),
    actions: [
      {
        kind: "grade.set",
        target_id: inserted.request.result.changed_ids[0],
        value: { page_id: pageID, scope: "layer", field: "brightness", amount: 0.2 },
      },
      {
        kind: "grade.set",
        target_id: pageID,
        value: { page_id: pageID, scope: "page", field: "contrast", amount: 0.1 },
      },
    ],
  });
  expect(grade.request.result.status, JSON.stringify(grade.request.error)).toBe("committed");
  const beforeGroup = await mcpTool(request, token, "editor_context", scope);
  const grouped = await mcpTool(request, token, "image_edit", {
    ...scope,
    project_id: projectId,
    expected_revision: beforeGroup.request.result.revision,
    request_id: randomUUID(),
    actions: [
      {
        kind: "layer.group",
        value: {
          page_id: pageID,
          layer_ids: [edit.request.result.changed_ids[0], inserted.request.result.changed_ids[0]],
        },
      },
    ],
  });
  expect(grouped.request.result.status, JSON.stringify(grouped.request.error)).toBe("committed");
  const groupedLayer = await mcpTool(request, token, "image_inspect", {
    ...scope,
    page_id: pageID,
    layer_id: grouped.request.result.changed_ids[0],
  });
  expect(groupedLayer.request.result.pages[0].layers[0].type).toBe("group");
  await expect
    .poll(
      async () =>
        (await mcpTool(request, token, "editor_context", scope)).request.result.save_state,
    )
    .toBe("saved");
  const beforeImageExport = await mcpTool(request, token, "editor_context", scope);
  const imageExport = await mcpTool(request, token, "export_start", {
    ...scope,
    project_id: projectId,
    expected_revision: beforeImageExport.request.result.revision,
    request_id: randomUUID(),
    format: "png",
    page_id: pageID,
  });
  expect(imageExport.request.status, JSON.stringify(imageExport.request.error)).toBe("completed");
  const imageExportID = imageExport.request.result.id;
  await expect
    .poll(
      async () => {
        const status = await mcpTool(request, token, "export_status", {
          ...scope,
          project_id: projectId,
          export_id: imageExportID,
        });
        return status.request.result.status;
      },
      { timeout: 30_000 },
    )
    .toBe("completed");
  const savedImage = await mcpTool(request, token, "export_status", {
    ...scope,
    project_id: projectId,
    export_id: imageExportID,
  });
  expect(savedImage.request.result.result.media_id).toBeTruthy();
  expect(savedImage.request.result.result.file_size).toBeGreaterThan(0);
  expect(savedImage.request.result.revision).toBe(beforeImageExport.request.result.revision);
  const exportedImage = await page.request.get(
    `/media/${savedImage.request.result.result.media_id}`,
  );
  expect(exportedImage.ok()).toBe(true);
  expect((await exportedImage.body()).subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  await page.screenshot({ path: testInfo.outputPath("image-after-light.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.locator('span[role="status"]').filter({ hasText: "Agent connected" }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("image-phone-390-light.png") });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.screenshot({ path: testInfo.outputPath("image-phone-320-light.png") });
  await page.evaluate(() => localStorage.setItem("mode-watcher-mode", "dark"));
  await page.reload();
  await expect(page.getByTestId("image-editor-shell")).toHaveAttribute(
    "data-agent-status",
    "connected",
  );
  await page.screenshot({ path: testInfo.outputPath("image-phone-320-dark.png") });
});
