import type { IDataObject, ILoadOptionsFunctions, INodeListSearchResult } from "n8n-workflow";

import { openPostApiUrl } from "../transport/url";

type SearchItem = {
  id?: string;
  name?: string;
  title?: string;
  slug?: string;
  platform?: string;
  account_username?: string;
};

export const listSearch = {
  async searchWorkspaces(
    this: ILoadOptionsFunctions,
    filter?: string,
  ): Promise<INodeListSearchResult> {
    const items = await requestList.call(this, "/workspaces", {}, "");
    return toResults(items, filter, (item) => String(item.name ?? item.id ?? ""));
  },

  async searchAccounts(
    this: ILoadOptionsFunctions,
    filter?: string,
  ): Promise<INodeListSearchResult> {
    const workspaceId = currentLocatorValue(this.getCurrentNodeParameter("workspaceId"));
    const items = await requestList.call(
      this,
      "/accounts",
      workspaceId ? { workspace_id: workspaceId } : {},
      "",
    );
    return toResults(items, filter, (item) =>
      [item.platform, item.account_username || item.slug || item.id].filter(Boolean).join(" - "),
    );
  },

  async searchPublications(
    this: ILoadOptionsFunctions,
    filter?: string,
    paginationToken?: string,
  ): Promise<INodeListSearchResult> {
    const workspaceId = currentLocatorValue(this.getCurrentNodeParameter("workspaceId"));
    const response = await requestFull.call(this, "/publications", {
      ...(workspaceId ? { workspace_id: workspaceId } : {}),
      ...(paginationToken ? { cursor: String(paginationToken) } : {}),
      limit: 50,
    });
    return {
      ...toResults(Array.isArray(response.body) ? response.body : [], filter, (item) =>
        String(item.title || item.id || ""),
      ),
      paginationToken: header(response.headers, "X-Next-Cursor") || undefined,
    };
  },

  async searchSocialSets(
    this: ILoadOptionsFunctions,
    filter?: string,
  ): Promise<INodeListSearchResult> {
    const workspaceId = currentLocatorValue(this.getCurrentNodeParameter("workspaceId"));
    const items = await requestList.call(
      this,
      "/social-sets",
      workspaceId ? { workspace_id: workspaceId } : {},
      "",
    );
    return toResults(items, filter, (item) => String(item.name ?? item.id ?? ""));
  },
};

async function requestList(
  this: ILoadOptionsFunctions,
  apiPath: string,
  qs: IDataObject,
  bodyPath: string,
): Promise<SearchItem[]> {
  const response = await requestFull.call(this, apiPath, qs);
  const body = bodyPath ? getPath(response.body, bodyPath) : response.body;
  return Array.isArray(body) ? (body as SearchItem[]) : [];
}

async function requestFull(this: ILoadOptionsFunctions, apiPath: string, qs: IDataObject) {
  const credentials = await this.getCredentials<{ baseUrl: string }>("openPostApi");
  return (await this.helpers.httpRequestWithAuthentication.call(this, "openPostApi", {
    method: "GET",
    url: openPostApiUrl(credentials.baseUrl, apiPath),
    qs,
    json: true,
    returnFullResponse: true,
  })) as { body: unknown; headers?: Record<string, unknown> };
}

function toResults(
  items: SearchItem[],
  filter: string | undefined,
  label: (item: SearchItem) => string,
): INodeListSearchResult {
  const needle = String(filter ?? "").toLowerCase();
  return {
    results: items
      .filter(
        (item) =>
          !needle ||
          label(item).toLowerCase().includes(needle) ||
          String(item.id ?? "")
            .toLowerCase()
            .includes(needle),
      )
      .map((item) => ({ name: label(item), value: String(item.id ?? "") })),
  };
}

function currentLocatorValue(value: unknown): string {
  if (value && typeof value === "object" && "value" in value)
    return String((value as { value?: unknown }).value ?? "");
  return String(value ?? "");
}

function header(headers: Record<string, unknown> | undefined, name: string): string {
  if (!headers) return "";
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  if (!entry) return "";
  return Array.isArray(entry[1]) ? String(entry[1][0] ?? "") : String(entry[1] ?? "");
}

function getPath(value: unknown, bodyPath: string): unknown {
  return bodyPath.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}
