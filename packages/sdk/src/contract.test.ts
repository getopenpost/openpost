import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Every route the SDK calls must exist in the checked-in OpenAPI contract.
// OpenAPI paths are relative to the /api/v1 servers entry, while the SDK
// sends absolute /api/v1 paths, so the prefix is stripped before comparison.
const SDK_ROUTES: Array<[string, string]> = [
  ["GET", "/api/v1/workspaces"],
  ["POST", "/api/v1/workspaces"],
  ["GET", "/api/v1/accounts"],
  ["GET", "/api/v1/accounts/providers"],
  ["GET", "/api/v1/provider-readiness"],
  ["GET", "/api/v1/accounts/{account_id}/destination-options"],
  ["GET", "/api/v1/social-sets"],
  ["GET", "/api/v1/social-sets/{id}"],
  ["POST", "/api/v1/social-sets/resolve-settings"],
  ["GET", "/api/v1/publications"],
  ["POST", "/api/v1/publications"],
  ["GET", "/api/v1/publications/{id}"],
  ["PUT", "/api/v1/publications/{id}"],
  ["DELETE", "/api/v1/publications/{id}"],
  ["POST", "/api/v1/publications/{id}/validate"],
  ["POST", "/api/v1/publications/{id}/schedule"],
  ["POST", "/api/v1/publications/{id}/publish-now"],
  ["POST", "/api/v1/publications/{id}/cancel"],
  ["POST", "/api/v1/publications/{id}/retry-failed"],
  ["GET", "/api/v1/publications/{id}/events"],
  ["PUT", "/api/v1/publications/{id}/renditions"],
  ["DELETE", "/api/v1/publications/{id}/renditions/{account_id}"],
  ["POST", "/api/v1/publications/{id}/renditions/{account_id}/retry"],
  ["GET", "/api/v1/media"],
  ["DELETE", "/api/v1/media/{id}"],
  ["GET", "/api/v1/media/{id}/usage"],
  ["POST", "/api/v1/media/upload-session"],
  ["GET", "/api/v1/jobs"],
  ["GET", "/api/v1/jobs/{id}"],
];

function loadContract(): { paths: Record<string, Record<string, unknown>> } {
  const url = new URL("../../../apps/web/openapi.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as {
    paths: Record<string, Record<string, unknown>>;
  };
}

describe("SDK route contract", () => {
  it("covers only routes present in apps/web/openapi.json", () => {
    const contract = loadContract();
    for (const [method, route] of SDK_ROUTES) {
      const contractPath = route.replace(/^\/api\/v1/, "") || "/";
      const operations = contract.paths[contractPath];
      expect(operations, `${method} ${route}`).toBeDefined();
      expect(operations?.[method.toLowerCase()], `${method} ${route}`).toBeDefined();
    }
  });
});
