import { HttpClient } from "../client.js";
import { OpenPostError } from "../errors.js";
import type { MediaPage, MediaUploadResult } from "../types.js";

export type MediaSource =
  | "upload"
  | "camera"
  | "image_editor_export"
  | "image_editor_edit"
  | "background_removal"
  | "stock_import"
  | "meme_generator"
  | "video_editor_source"
  | "video_editor_export";

export type MediaAssetKind =
  | "library"
  | "brand_asset"
  | "brand_font"
  | "design_preview"
  | "template_preview"
  | "project_asset";

export interface UploadMediaInput {
  workspaceId: string;
  file: Uint8Array | ArrayBuffer | Blob;
  filename: string;
  mimeType: string;
  altText?: string;
  source?: MediaSource;
  assetKind?: MediaAssetKind;
  retentionClass?: "library" | "temporary";
  tagId?: string;
  parentMediaId?: string;
  designDocumentId?: string;
  designPageId?: string;
  projectAssetId?: string;
  clientSha256?: string;
}

interface UploadSession {
  media_id: string;
  deduped: boolean;
  complete_url: string;
  upload: {
    method: string;
    url: string;
    headers: Record<string, string>;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// parseUploadSession enforces the upload-session response contract before
// any field is dereferenced: an empty or malformed payload becomes a typed
// SDK error instead of a TypeError deep in the upload flow.
function parseUploadSession(payload: unknown): UploadSession {
  const problem = "Media upload session response did not match the API contract.";
  if (!isRecord(payload))
    throw new OpenPostError(problem, { code: "validation", details: payload });
  const upload = payload["upload"];
  const valid =
    typeof payload["media_id"] === "string" &&
    typeof payload["deduped"] === "boolean" &&
    typeof payload["complete_url"] === "string" &&
    isRecord(upload) &&
    typeof upload["method"] === "string" &&
    typeof upload["url"] === "string";
  if (!valid) throw new OpenPostError(problem, { code: "validation", details: payload });
  const headers = isRecord(upload["headers"]) ? upload["headers"] : {};
  return {
    media_id: payload["media_id"] as string,
    deduped: payload["deduped"] as boolean,
    complete_url: payload["complete_url"] as string,
    upload: {
      method: upload["method"] as string,
      url: upload["url"] as string,
      headers: Object.fromEntries(
        Object.entries(headers).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
    },
  };
}

export class Media {
  constructor(private readonly http: HttpClient) {}

  async list(workspaceId: string, limit?: number): Promise<MediaPage> {
    const page = (await this.http.get("/api/v1/media", {
      query: { workspace_id: workspaceId, limit },
    })) as MediaPage;
    return { media: page.media ?? [], total: page.total ?? 0 };
  }

  async remove(id: string): Promise<void> {
    await this.http.delete(`/api/v1/media/${encodeURIComponent(id)}`);
  }

  // upload hides the three-step session flow: reserve the media row, PUT the
  // bytes to the storage target, then complete the row. External storage
  // targets never receive the API token; internal targets reuse it.
  async upload(input: UploadMediaInput): Promise<MediaUploadResult> {
    const size = HttpClient.sizeOf(input.file);
    const sessionPayload = await this.http.post("/api/v1/media/upload-session", {
      workspace_id: input.workspaceId,
      filename: input.filename,
      mime_type: input.mimeType,
      size,
      source: input.source ?? "upload",
      asset_kind: input.assetKind ?? "library",
      retention_class: input.retentionClass ?? "library",
      ...(input.altText ? { alt_text: input.altText } : {}),
      ...(input.tagId ? { tag_id: input.tagId } : {}),
      ...(input.parentMediaId ? { parent_media_id: input.parentMediaId } : {}),
      ...(input.designDocumentId ? { design_document_id: input.designDocumentId } : {}),
      ...(input.designPageId ? { design_page_id: input.designPageId } : {}),
      ...(input.projectAssetId ? { project_asset_id: input.projectAssetId } : {}),
      ...(input.clientSha256 ? { client_sha256: input.clientSha256 } : {}),
    });
    const session = parseUploadSession(sessionPayload);

    if (session.deduped) {
      return {
        id: session.media_id,
        mime_type: input.mimeType,
        url: `/media/${session.media_id}`,
        size,
        deduped: true,
        alt_text: input.altText ?? "",
        original_filename: input.filename,
      };
    }

    const target = session.upload.url;
    const external = target.startsWith("http");
    await this.http.putBytes(external ? target : this.http.buildUrl(target), input.file, {
      method: session.upload.method || "PUT",
      headers: session.upload.headers ?? {},
      mimeType: input.mimeType,
      // Relative targets are OpenPost API routes behind bearer auth;
      // absolute targets are presigned storage URLs that must not see it.
      auth: !external,
    });

    // complete_url arrives as an API path; post() prefixes the base URL and
    // HttpClient.buildUrl also passes absolute storage URLs through untouched.
    return (await this.http.post(session.complete_url, {
      workspace_id: input.workspaceId,
    })) as MediaUploadResult;
  }

  async usage(id: string): Promise<unknown> {
    return await this.http.get(`/api/v1/media/${encodeURIComponent(id)}/usage`);
  }
}
