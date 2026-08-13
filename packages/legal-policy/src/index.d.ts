export type LegalPolicyDocument = Readonly<{
  version: string;
  effective_date: string;
  url: string;
  requires_acceptance: boolean;
}>;

export declare const legalPolicy: Readonly<{
  schema_version: 1;
  terms: LegalPolicyDocument;
  privacy: LegalPolicyDocument;
  refunds: LegalPolicyDocument;
}>;

export type ManagedServiceStore = Readonly<{
  id: string;
  name: string;
  provider: string;
  location: string;
  data: string;
  retention: string;
  protection: string;
}>;

export type ManagedServiceProvider = Readonly<{
  id: string;
  name: string;
  role:
    | "subprocessor"
    | "independent_controller_and_processor"
    | "independent_service_provider"
    | "user_requested_source";
  use:
    | "required"
    | "purchase_triggered"
    | "feature_triggered"
    | "feedback_triggered";
  purpose: string;
  data: string;
  location: string;
  transfer: string;
  source_urls: readonly string[];
}>;

export type DirectedRecipient = Readonly<{
  name: string;
  purpose: string;
  data: string;
  location: string;
  source_url: string;
}>;

export declare const managedService: Readonly<{
  schema_version: 1;
  reviewed_on: string;
  next_review_on: string;
  contact: string;
  change_notice: string;
  stores: readonly ManagedServiceStore[];
  providers: readonly ManagedServiceProvider[];
  directed_recipients: readonly DirectedRecipient[];
  human_access: Readonly<{
    scope: string;
    authentication: string;
    routine_access: string;
    support_access: string;
    approval: string;
    logging: string;
    emergency: string;
    review_and_revocation: string;
  }>;
}>;

export type ManagedRetentionEntry = Readonly<{
  id: string;
  category: string;
  owner: string;
  purpose: string;
  includes: string;
  duration: string;
  deletion_trigger: string;
  exceptions: string;
  evidence: readonly string[];
}>;

export type BrowserStorageTechnology =
  | "cookie"
  | "localStorage"
  | "sessionStorage"
  | "IndexedDB"
  | "OPFS"
  | "Cache Storage";

export type BrowserStorageEntry = Readonly<{
  id: string;
  technology: BrowserStorageTechnology;
  owner: string;
  identifier_kind: "exact" | "prefix";
  identifier: string;
  purpose: string;
  scope: string;
  duration: string;
  necessity: "strictly_necessary" | "functional";
  source_refs: readonly string[];
}>;

export declare const privacyInventory: Readonly<{
  schema_version: 1;
  reviewed_on: string;
  next_review_on: string;
  summary_notice: string;
  summary_points: readonly string[];
  managed_retention: readonly ManagedRetentionEntry[];
  browser_storage: readonly BrowserStorageEntry[];
}>;

export type LegalPolicyKey = "terms" | "privacy" | "refunds";

export type LegalChangeHistoryEntry = Readonly<{
  document: LegalPolicyKey;
  version: string;
  effective_date: string;
  url: string;
  changes: readonly string[];
}>;

export declare const legalChangeHistory: Readonly<{
  schema_version: 1;
  reviewed_on: string;
  scope: string;
  entries: readonly LegalChangeHistoryEntry[];
}>;

export type SecurityControl = Readonly<{
  id: string;
  control: string;
  application: string;
  managed_service: string;
  self_hosted_operator: string;
  customer_or_provider: string;
  evidence: readonly string[];
}>;

export type SecurityIncidentHistoryEntry = Readonly<{
  id: string;
  date: string;
  summary: string;
  scope: string;
  customer_action: string;
  remediation_status: string;
  updated_on: string;
}>;

export declare const securityAssurance: Readonly<{
  schema_version: 1;
  reviewed_on: string;
  next_review_on: string;
  assurance_boundary: Readonly<{
    statement: string;
    published_certifications: readonly string[];
    published_independent_reports: readonly string[];
  }>;
  incident_history: Readonly<{
    status: "no_public_entries" | "entries_published";
    statement: string;
    publication_commitment: string;
    entries: readonly SecurityIncidentHistoryEntry[];
  }>;
  control_matrix: readonly SecurityControl[];
}>;

export declare function formatLegalDate(value: string, locale?: string): string;

export declare function formatPolicyEffectiveDate(
  policy: LegalPolicyDocument,
  locale?: string,
): string;
