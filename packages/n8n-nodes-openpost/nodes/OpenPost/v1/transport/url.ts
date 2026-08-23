import type { INode } from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";

const urlValidationNode = {
  name: "OpenPost",
  type: "openPost",
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
} as unknown as INode;

export function normalizeOpenPostBaseUrl(input: unknown): string {
  const raw = String(input ?? "").trim();
  if (!raw) throw urlError("Enter your OpenPost origin, for example https://app.openpost.dev.");
  if (!/^https?:\/\//i.test(raw)) {
    throw urlError("OpenPost Base URL must include http:// or https://.");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw urlError("OpenPost Base URL is not a valid URL.");
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname === "/api" || pathname === "/api/v1") {
    throw urlError("Enter the OpenPost origin without /api or /api/v1.");
  }
  if (pathname && pathname !== "/") {
    throw urlError("Enter only the OpenPost origin, not an API path.");
  }

  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function openPostApiUrl(baseUrl: string, apiPath: string): string {
  const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  return `${normalizeOpenPostBaseUrl(baseUrl)}/api/v1${path}`;
}

function urlError(message: string): NodeOperationError {
  return new NodeOperationError(urlValidationNode, message);
}
