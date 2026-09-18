import type { HttpClient } from "../client.js";
import type {
  DestinationOptionGroups,
  ProviderInfo,
  ProviderReadiness,
  SocialAccount,
} from "../types.js";

export class Accounts {
  constructor(private readonly http: HttpClient) {}

  async list(workspaceId: string): Promise<SocialAccount[]> {
    return (await this.http.get("/api/v1/accounts", {
      query: { workspace_id: workspaceId },
    })) as SocialAccount[];
  }

  async providers(): Promise<ProviderInfo[]> {
    return (await this.http.get("/api/v1/accounts/providers")) as ProviderInfo[];
  }

  async readiness(workspaceId: string): Promise<ProviderReadiness[]> {
    const page = (await this.http.get("/api/v1/provider-readiness", {
      query: { workspace_id: workspaceId },
    })) as { providers?: ProviderReadiness[] };
    return page.providers ?? [];
  }

  // Destination options describe the per-account publishing settings form:
  // regions, languages, and provider-specific toggles. Resolve these before
  // constructing rendition settings for an account.
  async destinationOptions(
    accountId: string,
    query: { region_code?: string; language?: string } = {},
  ): Promise<DestinationOptionGroups> {
    const page = (await this.http.get(
      `/api/v1/accounts/${encodeURIComponent(accountId)}/destination-options`,
      {
        query: { region_code: query.region_code, language: query.language },
      },
    )) as { options?: DestinationOptionGroups };
    return page.options ?? {};
  }
}
