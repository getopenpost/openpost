import type { ScreenshotDocument } from "@openpost/query-catalog";
import { api, errorMessage } from "../api/client";

export type RenderedVisual = { document: ScreenshotDocument };
export type TemplatePreview = { base64: string; width: number; height: number };
export type ExportVisual = () => Promise<RenderedVisual>;

export async function previewMeme(
  workspaceId: string,
  document: ScreenshotDocument,
  signal: AbortSignal,
): Promise<string> {
  if (!document.meme) throw new Error("This post has no meme recipe.");
  const result = await api().POST("/memes/preview", {
    signal,
    body: {
      workspace_id: workspaceId,
      template_id: document.meme.template_id,
      captions: document.meme.captions,
      overlay_media_ids: document.meme.overlay_media_ids,
      format: "png",
    },
  });
  if (result.error || !result.data)
    throw new Error(
      await errorMessage(result.response, "Could not render this meme", result.error),
    );
  return result.data.data_base64;
}

export async function previewTemplate(
  workspaceId: string,
  document: ScreenshotDocument,
  signal: AbortSignal,
): Promise<TemplatePreview> {
  const result = await api().POST("/screenshot-templates/previews", {
    signal,
    body: { workspace_id: workspaceId, document, scale: 2 },
  });
  if (result.error || !result.data)
    throw new Error(
      await errorMessage(result.response, "Could not render this visual", result.error),
    );
  return {
    base64: result.data.data_base64,
    width: result.data.width,
    height: result.data.height,
  };
}

export async function saveIdeateVisual(
  workspaceId: string,
  visual: RenderedVisual,
  altText: string,
  stillCurrent: () => boolean,
): Promise<string> {
  const client = api();
  const check = () => {
    if (!stillCurrent()) throw new Error("Your Workspace or session changed.");
  };
  check();
  const recipe = await client.POST("/screenshot-templates/designs", {
    body: { workspace_id: workspaceId, document: visual.document },
  });
  check();
  if (recipe.error || !recipe.data)
    throw new Error(
      await errorMessage(recipe.response, "Could not save the editable visual", recipe.error),
    );
  // The server renders and saves every visual, memes included, at publishing size.
  const exported = await client.POST("/screenshot-templates/designs/{id}/exports", {
    params: { path: { id: recipe.data.id } },
    body: altText.trim()
      ? { revision: recipe.data.revision, alt_text: altText.trim() }
      : { revision: recipe.data.revision },
  });
  check();
  if (exported.error || !exported.data)
    throw new Error(
      await errorMessage(exported.response, "Could not save this visual", exported.error),
    );
  const mediaId = exported.data.media?.id;
  if (!mediaId) throw new Error("Could not save this visual");
  return mediaId;
}
