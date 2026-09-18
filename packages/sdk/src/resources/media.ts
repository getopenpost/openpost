import { HttpClient } from "../client.js";
import type { MediaPage, MediaUploadResult } from "../types.js";

export type MediaSource =
  | "upload"
  | "camera"
  | "image_editor_export"
  | "image_editor_edit"
  | "background_removal"
  | "stock_import"
  | "meme_generator"
  | "video_editor_source";

export interface UploadMediaInput {
  workspaceId: string;
  file: Uint8Array | ArrayBuffer | Blob;
  filename: string;
  mimeType: string;
  altText?: string;
  source?: MediaSource;
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
    const session = (await this.http.post("/api/v1/media/upload-session", {
      workspace_id: input.workspaceId,
      filename: input.filename,
      mime_type: input.mimeType,
      size,
      source: input.source ?? "upload",
      asset_kind: "library",
      retention_class: "library",
      ...(input.altText ? { alt_text: input.altText } : {}),
    })) as UploadSession;

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
