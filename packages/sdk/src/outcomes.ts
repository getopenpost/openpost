import type { OpenPostRetryDisposition } from "./errors.js";
import type { Publication, Rendition } from "./types.js";

// Per-destination outcome states. `unknown` means OpenPost accepted the work
// but the SDK cannot prove the provider result: a `published` rendition
// without a native id, or a `failed` rendition with no error detail. Unknown
// outcomes must be reconciled (re-read the publication or check the
// provider), never blind-retried.
export type RenditionOutcomeState =
  | "draft"
  | "ready"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed"
  | "unknown";

export interface RenditionOutcome {
  state: RenditionOutcomeState;
  renditionId: string;
  socialAccountId: string;
  platform: string;
  externalId?: string;
  externalUrl?: string;
  errorMessage?: string;
  retryable: boolean;
  disposition: OpenPostRetryDisposition;
}

function failedDisposition(rendition: Rendition): {
  retryable: boolean;
  disposition: OpenPostRetryDisposition;
} {
  if (rendition.error_http_status === 401) {
    return { retryable: false, disposition: "after-reconnect" };
  }
  if (rendition.error_retryable) {
    return { retryable: true, disposition: "after-delay" };
  }
  return { retryable: false, disposition: "never" };
}

// describeRendition maps one rendition row to an exhaustive outcome. The
// switch covers every RenditionStatus, so a new server status fails the
// build here instead of silently falling through in automation.
export function describeRendition(rendition: Rendition): RenditionOutcome {
  const base = {
    renditionId: rendition.id,
    socialAccountId: rendition.social_account_id,
    platform: rendition.platform,
  };
  switch (rendition.status) {
    case "draft":
      return { ...base, state: "draft", retryable: false, disposition: "never" };
    case "ready":
      return { ...base, state: "ready", retryable: false, disposition: "never" };
    case "scheduled":
      return { ...base, state: "scheduled", retryable: false, disposition: "never" };
    case "publishing":
      return { ...base, state: "publishing", retryable: false, disposition: "never" };
    case "published": {
      if (rendition.external_id) {
        return {
          ...base,
          state: "published",
          externalId: rendition.external_id,
          ...(rendition.external_url !== undefined ? { externalUrl: rendition.external_url } : {}),
          retryable: false,
          disposition: "never",
        };
      }
      return {
        ...base,
        state: "unknown",
        retryable: false,
        disposition: "reconcile-first",
      };
    }
    case "failed": {
      if (!rendition.error_message && !rendition.error_code && !rendition.error_kind) {
        return {
          ...base,
          state: "unknown",
          retryable: false,
          disposition: "reconcile-first",
        };
      }
      return {
        ...base,
        state: "failed",
        ...(rendition.error_message !== undefined ? { errorMessage: rendition.error_message } : {}),
        ...failedDisposition(rendition),
      };
    }
    default: {
      const unreachable: never = rendition.status as never;
      throw new Error(`Unknown rendition status: ${String(unreachable)}`);
    }
  }
}

export type PublicationSummary = "pending" | "complete" | "partial";

export interface PublicationOutcomeSummary {
  status: PublicationSummary;
  total: number;
  published: number;
  failed: number;
  pending: number;
  unknown: number;
  outcomes: RenditionOutcome[];
}

// summarizePublication derives one aggregate from per-destination outcomes.
// Partial success is first-class: a publication with both live and failed
// renditions reports `partial`, never `failed` or `published`.
export function summarizePublication(publication: Publication): PublicationOutcomeSummary {
  const outcomes = publication.renditions.map(describeRendition);
  let published = 0;
  let failed = 0;
  let unknown = 0;
  for (const outcome of outcomes) {
    if (outcome.state === "published") published += 1;
    else if (outcome.state === "failed") failed += 1;
    else if (outcome.state === "unknown") unknown += 1;
  }
  const pending = outcomes.length - published - failed - unknown;
  const status: PublicationSummary =
    outcomes.length > 0 && published === outcomes.length
      ? "complete"
      : published > 0 || failed > 0 || unknown > 0
        ? "partial"
        : "pending";
  return {
    status,
    total: outcomes.length,
    published,
    failed,
    pending,
    unknown,
    outcomes,
  };
}
