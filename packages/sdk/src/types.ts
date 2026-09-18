// Hand-written shapes for the SDK v1 surface. They mirror the wire format
// used by the Go CLI client and the OpenAPI schemas, using loose records for
// provider-specific settings so new providers never break the SDK build.

export type ContentProfile =
  | "short_text"
  | "thread"
  | "link_share"
  | "image_post"
  | "carousel"
  | "story"
  | "short_video"
  | "long_video";

export type PublicationStatus =
  | "draft"
  | "ready"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed";

export type RenditionStatus =
  | "draft"
  | "ready"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed";

export type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface PublicationMediaInput {
  media_id: string;
  role?: string;
  alt_text?: string;
}

export interface RenditionInput {
  social_account_id: string;
  profile?: string;
  body?: string;
  title?: string;
  description?: string;
  settings?: Record<string, unknown>;
  media?: PublicationMediaInput[];
}

export interface CreatePublicationInput {
  workspace_id: string;
  title: string;
  content_profile: string;
  source_text: string;
  intent?: string;
  creation_preset?: string;
  source_url?: string;
  goal?: string;
  audience?: string;
  scheduled_at?: string;
  random_delay_minutes?: number;
  metadata?: Record<string, unknown>;
  social_account_ids?: string[];
  media?: PublicationMediaInput[];
  renditions?: RenditionInput[];
}

export interface UpdatePublicationInput {
  expected_revision: number;
  force?: boolean;
  title?: string;
  content_profile?: string;
  source_text?: string;
  source_url?: string;
  goal?: string;
  audience?: string;
  scheduled_at?: string | null;
  clear_schedule?: boolean;
  random_delay_minutes?: number;
  metadata?: Record<string, unknown>;
  renditions?: RenditionInput[];
}

export interface ListPublicationsQuery {
  workspace_id?: string;
  status?: string;
  activity_bucket?: string;
  content_profile?: string;
  platform?: string;
  calendar_from?: string;
  calendar_before?: string;
  limit?: number;
  offset?: number;
}

export interface Rendition {
  id: string;
  social_account_id: string;
  platform: string;
  profile: string;
  body: string;
  title: string;
  description: string;
  settings: Record<string, unknown>;
  status: string;
  external_id?: string;
  external_url?: string;
  error_message?: string;
  error_kind?: string;
  error_code?: string;
  error_http_status?: number;
  error_retryable?: boolean;
}

export interface Publication {
  id: string;
  workspace_id: string;
  created_by: string;
  title: string;
  intent: string;
  content_profile: string;
  source_text: string;
  source_url?: string;
  goal?: string;
  audience?: string;
  metadata?: Record<string, unknown>;
  status: PublicationStatus;
  revision: number;
  scheduled_at?: string;
  actual_run_at?: string;
  created_at: string;
  updated_at: string;
  renditions: Rendition[];
}

export interface ValidationIssue {
  severity: string;
  code: string;
  message: string;
  provider?: string;
  profile?: string;
  field?: string;
}

export interface PublicationValidation {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface PublicationAction {
  message: string;
  job_id?: string;
  revision?: number;
}

export interface PublicationEvent {
  id: string;
  workspace_id: string;
  publication_id: string;
  rendition_id?: string;
  type: string;
  status: string;
  message: string;
  metadata: Record<string, unknown>;
  idempotency_key?: string;
  created_at: string;
}

export interface SocialAccount {
  id: string;
  platform: string;
  display_name?: string;
  username?: string;
  status?: string;
  [key: string]: unknown;
}

export interface ProviderInfo {
  platform: string;
  display_name?: string;
  [key: string]: unknown;
}

export interface DestinationOptions {
  [key: string]: unknown;
}

export interface SocialSet {
  id: string;
  workspace_id: string;
  name?: string;
  [key: string]: unknown;
}

export interface MediaItem {
  id: string;
  workspace_id: string;
  mime_type: string;
  size: number;
  original_filename: string;
  alt_text?: string;
  url?: string;
  thumbnail_url?: string;
  processing_status?: string;
  [key: string]: unknown;
}

export interface MediaPage {
  media: MediaItem[];
  total: number;
}

export interface MediaUploadResult {
  id: string;
  mime_type: string;
  url: string;
  size: number;
  deduped?: boolean;
  alt_text?: string;
  original_filename?: string;
  processing_status?: string;
  [key: string]: unknown;
}

export interface Job {
  id: string;
  type: string;
  status: JobStatus;
  run_at?: string;
  attempts?: number;
  max_attempts?: number;
  last_error?: string;
  [key: string]: unknown;
}

export interface ListJobsQuery {
  workspace_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface Workspace {
  id: string;
  name: string;
  created_at?: string;
}

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
}
