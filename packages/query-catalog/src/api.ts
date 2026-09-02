import type { components } from "@openpost/api-contract";
import type { ActivityPublicationBucket, QueryPage } from "./keys";

export type Publication = components["schemas"]["PublicationResponse"];
export type Workspace = components["schemas"]["WorkspaceResponse"];
export type CapabilityCatalog = components["schemas"]["CapabilitiesOutputBody"];
export type SocialAccount = components["schemas"]["AccountResponse"];
export type SocialSet = components["schemas"]["SocialSetResponse"];
export type Job = components["schemas"]["JobResponse"];

export interface QueryPageResult<T> {
  items: T[];
  total: number;
  nextCursor: string;
}

export interface OpenPostQueryAPI {
  listWorkspaces(signal: AbortSignal): Promise<Workspace[]>;
  getPublication(
    workspaceId: string,
    publicationId: string,
    signal: AbortSignal,
  ): Promise<Publication>;
  listActivityPublications(
    workspaceId: string,
    bucket: ActivityPublicationBucket,
    page: QueryPage,
    signal: AbortSignal,
  ): Promise<QueryPageResult<Publication>>;
  listCalendarPublications(
    workspaceId: string,
    range: PublicationCalendarRange,
    signal: AbortSignal,
  ): Promise<Publication[]>;
  listFailedJobs(
    workspaceId: string,
    page: QueryPage,
    signal: AbortSignal,
  ): Promise<QueryPageResult<Job>>;
  listAccounts(workspaceId: string, signal: AbortSignal): Promise<SocialAccount[]>;
  listSocialSets(workspaceId: string, signal: AbortSignal): Promise<SocialSet[]>;
  getCapabilities(signal: AbortSignal): Promise<CapabilityCatalog>;
}

export interface PublicationCalendarRange {
  readonly from: string;
  readonly before: string;
  readonly limit: number;
}
