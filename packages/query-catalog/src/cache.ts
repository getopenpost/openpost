import type { QueryClient } from "@tanstack/query-core";
import type { Publication } from "./api";
import { openPostQueryKeys } from "./keys";

type QueryDataCache = Pick<QueryClient, "setQueryData">;

export function seedPublicationDetail(
  client: QueryDataCache,
  publication: Publication,
  expectedWorkspaceId = publication.workspace_id,
): Publication {
  if (publication.workspace_id !== expectedWorkspaceId) {
    throw new Error("Publication Workspace does not match its query key");
  }
  client.setQueryData(
    openPostQueryKeys.publications.detail(expectedWorkspaceId, publication.id),
    publication,
  );
  return publication;
}
