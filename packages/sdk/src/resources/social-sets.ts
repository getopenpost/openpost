import type { HttpClient } from "../client.js";
import type { SocialSet } from "../types.js";

export class SocialSets {
  constructor(private readonly http: HttpClient) {}

  async list(workspaceId: string): Promise<SocialSet[]> {
    return (await this.http.get("/api/v1/social-sets", {
      query: { workspace_id: workspaceId },
    })) as SocialSet[];
  }

  async get(id: string): Promise<SocialSet> {
    return (await this.http.get(`/api/v1/social-sets/${encodeURIComponent(id)}`)) as SocialSet;
  }

  // resolveSettings expands a Social Set into the account-resolved defaults
  // used for new publications. Copy the result into renditions; explicit post
  // values win and existing publications are never rewritten.
  async resolveSettings(input: Record<string, unknown>): Promise<unknown> {
    return await this.http.post("/api/v1/social-sets/resolve-settings", input);
  }
}
