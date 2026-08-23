import type {
  IDataObject,
  IExecuteFunctions,
  IHttpRequestOptions,
  IN8nHttpFullResponse,
} from "n8n-workflow";

import { openPostApiRequest } from "../transport/openPostApiRequest";
import { openPostApiUrl } from "../transport/url";

export type BinaryUploadInput = {
  baseUrl: string;
  itemIndex: number;
  executionId: string;
  workspaceId: string;
  binaryPropertyName: string;
  fileName?: string;
  mimeType?: string;
  altText?: string;
  retentionClass?: string;
  assetKind?: string;
  idempotencyKey: string;
};

export async function uploadBinaryMedia(
  context: IExecuteFunctions,
  input: BinaryUploadInput,
): Promise<unknown> {
  const item = context.getInputData()[input.itemIndex];
  const binary = item.binary?.[input.binaryPropertyName];
  if (!binary)
    throw new Error(`Input item has no binary property named ${input.binaryPropertyName}.`);

  const buffer = await context.helpers.getBinaryDataBuffer(
    input.itemIndex,
    input.binaryPropertyName,
  );
  const filename = input.fileName || binary.fileName || "openpost-upload";
  const mimeType = input.mimeType || binary.mimeType || "application/octet-stream";
  const sessionBody: IDataObject = {
    workspace_id: input.workspaceId,
    filename,
    mime_type: mimeType,
    size: buffer.length,
    source: "upload",
    asset_kind: input.assetKind || "library",
    retention_class: input.retentionClass || "library",
  };
  if (input.altText) sessionBody.alt_text = input.altText;

  const session = await openPostApiRequest(
    context,
    {
      method: "POST",
      url: openPostApiUrl(input.baseUrl, "/media/upload-session"),
      headers: {
        Accept: "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: sessionBody,
      json: true,
      returnFullResponse: true,
    },
    { idempotency: "required" },
  );

  const sessionBodyResult = session.body as MediaUploadSession;
  if (sessionBodyResult.deduped) return sessionBodyResult;

  const upload = sessionBodyResult.upload;
  if (!upload?.url) throw new Error("OpenPost did not return an upload target.");

  const uploadOptions: IHttpRequestOptions = {
    method: (upload.method || "PUT") as IHttpRequestOptions["method"],
    url: upload.url,
    headers: upload.headers ?? {},
    body: buffer,
    returnFullResponse: true,
    json: false,
    sendCredentialsOnCrossOriginRedirect: false,
  };
  await context.helpers.httpRequest(uploadOptions);

  const completePath =
    sessionBodyResult.complete_url ||
    `/media/upload-session/${encodeURIComponent(sessionBodyResult.media_id)}/complete`;
  const completeUrl = completePath.startsWith("http")
    ? completePath
    : openPostApiUrl(input.baseUrl, completePath.replace(/^\/api\/v1/, ""));
  const complete = (await openPostApiRequest(
    context,
    {
      method: "POST",
      url: completeUrl,
      headers: {
        Accept: "application/json",
        "Idempotency-Key": `${input.idempotencyKey}:complete`,
      },
      body: { workspace_id: input.workspaceId },
      json: true,
      returnFullResponse: true,
    },
    { idempotency: "required" },
  )) as IN8nHttpFullResponse;
  return complete.body;
}

type MediaUploadSession = {
  media_id: string;
  complete_url: string;
  deduped: boolean;
  upload: {
    method: string;
    url: string;
    headers: IDataObject;
  };
};
