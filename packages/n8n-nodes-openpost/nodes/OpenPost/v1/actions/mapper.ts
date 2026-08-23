import type { IDataObject, IHttpRequestOptions, INodeParameterResourceLocator } from "n8n-workflow";

import { generatedActionRequestMappers } from "./generated/requestMappers";
import { openPostApiUrl } from "../transport/url";

type GeneratedMapper = (typeof generatedActionRequestMappers)[number];

export type ParameterReader = {
  get(name: string, fallback?: unknown): unknown;
};

export type BuiltOpenPostRequest = {
  options: IHttpRequestOptions;
  mapper: GeneratedMapper;
};

export function findRequestMapper(resource: string, operation: string): GeneratedMapper {
  const mapper = generatedActionRequestMappers.find(
    (item) => item.actionKey === `${resource}.${operation}`,
  );
  if (!mapper) throw new Error(`Unsupported OpenPost action ${resource}.${operation}.`);
  return mapper;
}

export function buildOpenPostRequest(input: {
  baseUrl: string;
  mapper: GeneratedMapper;
  parameters: ParameterReader;
  itemIndex: number;
  executionId: string;
  cursor?: string;
}): BuiltOpenPostRequest {
  const qs: IDataObject = {};
  const body: IDataObject = {};
  let apiPath: string = input.mapper.path;

  for (const field of input.mapper.fields) {
    const rawValue = input.parameters.get(field.name, undefined);
    const value = normalizeNodeValue(rawValue);
    if (value === undefined || value === "") continue;
    if (field.location === "path") {
      apiPath = apiPath.replace(`{${field.apiName}}`, encodeURIComponent(String(value)));
    } else if (field.location === "query") {
      qs[field.apiName] = value as IDataObject[string];
    } else if (field.name === "advancedJson") {
      Object.assign(body, parseJsonObject(value, field.name));
    } else if (field.name === "renditionsJson") {
      body.renditions = parseJsonArray(value, field.name) as IDataObject[string];
    } else if (field.name === "accountIds") {
      body[field.apiName] = splitCommaList(value) as IDataObject[string];
    } else if (field.name === "mediaIds") {
      body.media = splitCommaList(value).map((id) => ({ id })) as IDataObject[string];
    } else {
      body[field.apiName] = value as IDataObject[string];
    }
  }

  if (input.cursor && input.mapper.pagination?.cursor_parameter) {
    qs[input.mapper.pagination.cursor_parameter] = input.cursor;
  }

  applyKnownPublicationBody(input.mapper.actionKey, body, input.parameters);

  const headers: IDataObject = { Accept: "application/json" };
  if (input.mapper.idempotency === "required") {
    headers["Idempotency-Key"] = idempotencyKey(
      input.parameters.get("idempotencyKey", ""),
      input.executionId,
      input.mapper.actionKey,
      input.itemIndex,
    );
  }

  const options: IHttpRequestOptions = {
    method: input.mapper.method as IHttpRequestOptions["method"],
    url: openPostApiUrl(input.baseUrl, apiPath),
    qs,
    headers,
    json: true,
    returnFullResponse: true,
    ignoreHttpStatusErrors: false,
  };
  if (
    ["POST", "PUT", "PATCH"].includes(input.mapper.method) &&
    (Object.keys(body).length > 0 || input.mapper.request.bodyRequired)
  ) {
    options.body = body;
  }
  return { options, mapper: input.mapper };
}

export function extractResult(
  body: unknown,
  result: { body_path?: string; id_path?: string; job_id_path?: string },
): unknown[] {
  const bodyPath = result.body_path;
  if (bodyPath === "") return Array.isArray(body) ? body : [];
  if (bodyPath) {
    const value = getPath(body, bodyPath);
    return Array.isArray(value) ? value : [];
  }
  return [body];
}

export function nextCursorFromHeaders(
  headers: Record<string, unknown> | undefined,
  headerName = "X-Next-Cursor",
): string {
  if (!headers) return "";
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === headerName.toLowerCase(),
  );
  if (!entry) return "";
  const value = entry[1];
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

export function shouldRetryOpenPost(input: {
  method: string;
  statusCode?: number;
  error?: unknown;
  idempotency: string;
}): boolean {
  if (!input.statusCode) return true;
  if (![429, 502, 503, 504].includes(input.statusCode)) return false;
  if (["GET", "HEAD"].includes(input.method)) return true;
  return input.idempotency === "required" || input.idempotency === "optional";
}

export function idempotencyKey(
  explicit: unknown,
  executionId: string,
  actionKey: string,
  itemIndex: number,
): string {
  const value = String(explicit ?? "").trim();
  if (value) return value;
  return `n8n:${executionId}:${actionKey}:${itemIndex}`;
}

export function normalizeNodeValue(value: unknown): unknown {
  if (isResourceLocator(value)) return value.value;
  return value;
}

function applyKnownPublicationBody(
  actionKey: string,
  body: IDataObject,
  parameters: ParameterReader,
) {
  if (actionKey === "publication.create") {
    copyParameter(body, parameters, "contentProfile", "content_profile");
    copyParameter(body, parameters, "sourceText", "source_text");
    copyParameter(body, parameters, "creationPreset", "creation_preset");
    copyParameter(body, parameters, "scheduledAt", "scheduled_at");
    copyParameter(body, parameters, "sourceUrl", "source_url");
    copyParameter(body, parameters, "randomDelayMinutes", "random_delay_minutes");
  }
  if (actionKey === "publication.update") {
    copyParameter(body, parameters, "expectedRevision", "expected_revision");
    copyParameter(body, parameters, "sourceText", "source_text");
    copyParameter(body, parameters, "scheduledAt", "scheduled_at");
  }
  if (
    [
      "publication.schedule",
      "publication.cancel",
      "publication.publishNow",
      "publication.setRenditions",
    ].includes(actionKey)
  ) {
    copyParameter(body, parameters, "expectedRevision", "expected_revision");
  }
}

function copyParameter(
  body: IDataObject,
  parameters: ParameterReader,
  parameterName: string,
  apiName: string,
) {
  const value = normalizeNodeValue(parameters.get(parameterName, undefined));
  if (value !== undefined && value !== "") body[apiName] = value as IDataObject[string];
}

function parseJsonObject(value: unknown, name: string): IDataObject {
  if (value && typeof value === "object") return value as IDataObject;
  const text = String(value ?? "").trim();
  if (!text) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(`${name} must be a JSON object.`);
  return parsed as IDataObject;
}

function parseJsonArray(value: unknown, name: string): unknown[] {
  if (Array.isArray(value)) return value;
  const text = String(value ?? "").trim();
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error(`${name} must be a JSON array.`);
  return parsed;
}

function splitCommaList(value: unknown): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isResourceLocator(value: unknown): value is INodeParameterResourceLocator {
  return Boolean(value && typeof value === "object" && "__rl" in value && "value" in value);
}

function getPath(value: unknown, bodyPath: string): unknown {
  return bodyPath.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}
