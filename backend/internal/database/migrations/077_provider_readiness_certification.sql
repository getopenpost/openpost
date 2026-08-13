CREATE TABLE IF NOT EXISTS provider_approval_reviews (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    app_fingerprint TEXT NOT NULL,
    provider_environment TEXT NOT NULL,
    instance_fingerprint TEXT NOT NULL DEFAULT '',
    approval_state TEXT NOT NULL,
    approval_tier TEXT NOT NULL,
    source_url TEXT NOT NULL,
    reviewed_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    operator_ref TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT current_timestamp,
    CHECK (provider <> ''),
    CHECK (app_fingerprint LIKE 'sha256:%'),
    CHECK (instance_fingerprint = '' OR instance_fingerprint LIKE 'sha256:%'),
    CHECK (provider_environment IN ('development', 'sandbox', 'production')),
    CHECK (approval_state IN ('unknown', 'not_required', 'pending', 'trial', 'approved', 'restricted', 'revoked')),
    CHECK (approval_tier <> ''),
    CHECK (source_url LIKE 'https://%'),
    CHECK (expires_at > reviewed_at),
    CHECK (operator_ref <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_approval_reviews_certification_owner_idx
    ON provider_approval_reviews (
        id, provider, app_fingerprint, provider_environment,
        instance_fingerprint, approval_state, approval_tier
    );

CREATE INDEX IF NOT EXISTS provider_approval_reviews_subject_idx
    ON provider_approval_reviews (
        provider, app_fingerprint, provider_environment,
        instance_fingerprint, reviewed_at, created_at
    );

CREATE TABLE IF NOT EXISTS provider_certification_runs (
    id TEXT PRIMARY KEY,
    approval_review_id TEXT NOT NULL,
    evidence_kind TEXT NOT NULL,
    subject_digest TEXT NOT NULL,
    provider TEXT NOT NULL,
    app_fingerprint TEXT NOT NULL,
    deployment_environment TEXT NOT NULL,
    provider_environment TEXT NOT NULL,
    instance_fingerprint TEXT NOT NULL DEFAULT '',
    account_kind TEXT NOT NULL DEFAULT '',
    account_reference_hash TEXT NOT NULL DEFAULT '',
    output_profile TEXT NOT NULL DEFAULT '',
    operation TEXT NOT NULL,
    policy_mode TEXT NOT NULL,
    tested_revision TEXT NOT NULL,
    contract_digest TEXT NOT NULL,
    approval_state_at_test TEXT NOT NULL,
    approval_tier_at_test TEXT NOT NULL,
    required_scopes_json TEXT NOT NULL,
    granted_scopes_json TEXT NOT NULL,
    operator_ref TEXT NOT NULL,
    tested_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT current_timestamp,
    FOREIGN KEY (
        approval_review_id, provider, app_fingerprint, provider_environment,
        instance_fingerprint, approval_state_at_test, approval_tier_at_test
    ) REFERENCES provider_approval_reviews (
        id, provider, app_fingerprint, provider_environment,
        instance_fingerprint, approval_state, approval_tier
    ),
    CHECK (evidence_kind IN ('local', 'live')),
    CHECK (subject_digest LIKE 'sha256:%'),
    CHECK (provider <> ''),
    CHECK (app_fingerprint LIKE 'sha256:%'),
    CHECK (deployment_environment IN ('local', 'staging', 'production')),
    CHECK (provider_environment IN ('development', 'sandbox', 'production')),
    CHECK (instance_fingerprint = '' OR instance_fingerprint LIKE 'sha256:%'),
    CHECK (account_reference_hash = '' OR account_reference_hash LIKE 'sha256:%'),
    CHECK (evidence_kind <> 'live' OR account_reference_hash LIKE 'sha256:%'),
    CHECK (operation IN ('connect', 'publish_immediate', 'publish_scheduled', 'refresh', 'revoke')),
    CHECK (policy_mode <> ''),
    CHECK (length(tested_revision) = 40),
    CHECK (contract_digest LIKE 'sha256:%'),
    CHECK (approval_state_at_test IN ('unknown', 'not_required', 'pending', 'trial', 'approved', 'restricted', 'revoked')),
    CHECK (approval_tier_at_test <> ''),
    CHECK (required_scopes_json LIKE '[%'),
    CHECK (granted_scopes_json LIKE '[%'),
    CHECK (operator_ref <> ''),
    CHECK (expires_at > tested_at)
);

CREATE INDEX IF NOT EXISTS provider_certification_runs_subject_idx
    ON provider_certification_runs (
        provider, app_fingerprint, deployment_environment,
        provider_environment, instance_fingerprint, account_kind,
        output_profile, operation, policy_mode, evidence_kind,
        tested_at, created_at
    );

CREATE INDEX IF NOT EXISTS provider_certification_runs_live_account_idx
    ON provider_certification_runs (
        provider, app_fingerprint, deployment_environment,
        provider_environment, instance_fingerprint, account_kind,
        output_profile, operation, policy_mode, evidence_kind,
        account_reference_hash, tested_at, created_at
    );

CREATE INDEX IF NOT EXISTS provider_certification_runs_contract_idx
    ON provider_certification_runs (contract_digest, expires_at);

CREATE INDEX IF NOT EXISTS provider_certification_runs_approval_idx
    ON provider_certification_runs (approval_review_id);

CREATE TABLE IF NOT EXISTS provider_certification_checks (
    id TEXT PRIMARY KEY,
    certification_run_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    outcome TEXT NOT NULL,
    error_class TEXT NOT NULL DEFAULT '',
    not_applicable_reason TEXT NOT NULL DEFAULT '',
    external_reference_hash TEXT NOT NULL DEFAULT '',
    completed_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT current_timestamp,
    FOREIGN KEY (certification_run_id) REFERENCES provider_certification_runs(id),
    UNIQUE (certification_run_id, kind),
    CHECK (kind IN ('connect', 'authorization', 'publish_immediate', 'publish_scheduled', 'final_result', 'refresh', 'revoke')),
    CHECK (outcome IN ('passed', 'failed', 'not_applicable')),
    CHECK (external_reference_hash = '' OR external_reference_hash LIKE 'sha256:%'),
    CHECK (
        outcome <> 'passed' OR
        kind NOT IN ('publish_immediate', 'publish_scheduled', 'final_result') OR
        external_reference_hash LIKE 'sha256:%'
    ),
    CHECK (
        (outcome = 'passed' AND error_class = '' AND not_applicable_reason = '') OR
        (outcome = 'failed' AND error_class <> '' AND not_applicable_reason = '') OR
        (outcome = 'not_applicable' AND error_class = '' AND not_applicable_reason <> '')
    )
);

CREATE INDEX IF NOT EXISTS provider_certification_checks_run_idx
    ON provider_certification_checks (certification_run_id, kind);

CREATE TABLE IF NOT EXISTS provider_runtime_control_events (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    app_fingerprint TEXT NOT NULL DEFAULT '',
    deployment_environment TEXT NOT NULL DEFAULT '',
    provider_environment TEXT NOT NULL DEFAULT '',
    instance_fingerprint TEXT NOT NULL DEFAULT '',
    account_kind TEXT NOT NULL DEFAULT '',
    output_profile TEXT NOT NULL DEFAULT '',
    operation TEXT NOT NULL DEFAULT '',
    policy_mode TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    starts_at DATETIME NOT NULL,
    expires_at DATETIME,
    operator_ref TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT current_timestamp,
    CHECK (provider <> ''),
    CHECK (app_fingerprint = '' OR app_fingerprint LIKE 'sha256:%'),
    CHECK (deployment_environment IN ('', 'local', 'staging', 'production')),
    CHECK (provider_environment IN ('', 'development', 'sandbox', 'production')),
    CHECK (instance_fingerprint = '' OR instance_fingerprint LIKE 'sha256:%'),
    CHECK (operation IN ('', 'connect', 'publish_immediate', 'publish_scheduled', 'refresh', 'revoke')),
    CHECK (state IN ('enabled', 'degraded', 'disabled')),
    CHECK (reason_code <> ''),
    CHECK (expires_at IS NULL OR expires_at > starts_at),
    CHECK (operator_ref <> '')
);

CREATE INDEX IF NOT EXISTS provider_runtime_control_events_match_idx
    ON provider_runtime_control_events (
        provider, starts_at, created_at, app_fingerprint,
        deployment_environment, provider_environment, operation
    );
