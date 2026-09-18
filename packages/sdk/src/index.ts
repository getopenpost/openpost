import { HttpClient, type OpenPostClientOptions } from "./client.js";
import { OpenPostError } from "./errors.js";
import { Accounts } from "./resources/accounts.js";
import { Jobs } from "./resources/jobs.js";
import { Media } from "./resources/media.js";
import { Publications } from "./resources/publications.js";
import { SocialSets } from "./resources/social-sets.js";
import { Workspaces } from "./resources/workspaces.js";

export interface OpenPostOptions extends OpenPostClientOptions {
  // Default workspace used by resource helpers that accept an optional
  // workspace id. Falls back to OPENPOST_WORKSPACE_ID, then OPENPOST_WORKSPACE
  // to match the Go CLI environment.
  workspaceId?: string;
}

function env(name: string): string | undefined {
  try {
    const value = globalThis.process?.env?.[name];
    return value && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export class OpenPost {
  readonly workspaces: Workspaces;
  readonly accounts: Accounts;
  readonly socialSets: SocialSets;
  readonly publications: Publications;
  readonly media: Media;
  readonly jobs: Jobs;

  private readonly defaultWorkspaceId: string | undefined;

  constructor(options: OpenPostOptions = {}) {
    const http = new HttpClient(options);
    this.workspaces = new Workspaces(http);
    this.accounts = new Accounts(http);
    this.socialSets = new SocialSets(http);
    this.publications = new Publications(http);
    this.media = new Media(http);
    this.jobs = new Jobs(http);
    this.defaultWorkspaceId =
      options.workspaceId ?? env("OPENPOST_WORKSPACE_ID") ?? env("OPENPOST_WORKSPACE");
  }

  // workspaceId returns the configured default workspace or throws a
  // missing_config error naming the environment variable.
  workspaceId(override?: string): string {
    const value = override ?? this.defaultWorkspaceId;
    if (!value) {
      throw new OpenPostError(
        "Missing workspace id. Pass workspaceId or set OPENPOST_WORKSPACE_ID.",
        { code: "missing_config" },
      );
    }
    return value;
  }
}

export { HttpClient } from "./client.js";
export type { OpenPostClientOptions } from "./client.js";
export { OpenPostError } from "./errors.js";
export type { OpenPostErrorCode } from "./errors.js";
export type { PublicationSegmentInput, RenditionSegmentInput } from "./types.js";
export { SDK_VERSION } from "./version.js";
export type {
  ContentProfile,
  CreatePublicationInput,
  DestinationOption,
  DestinationOptionGroups,
  Job,
  JobStatus,
  ListJobsQuery,
  ListPublicationsQuery,
  MediaItem,
  MediaPage,
  MediaUploadResult,
  ProviderInfo,
  ProviderReadiness,
  Publication,
  PublicationAction,
  PublicationEvent,
  PublicationStatus,
  PublicationValidation,
  Rendition,
  RenditionInput,
  RenditionStatus,
  SocialAccount,
  SocialSet,
  UpdatePublicationInput,
  ValidationIssue,
  WaitOptions,
  Workspace,
} from "./types.js";
export type { MediaAssetKind, MediaSource, UploadMediaInput } from "./resources/media.js";
