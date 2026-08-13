package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

func TestProviderReadinessCertificationMigrationSQLite(t *testing.T) {
	sqlDB, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	_, err = db.ExecContext(t.Context(), "PRAGMA foreign_keys=ON")
	require.NoError(t, err)
	exerciseProviderReadinessCertificationMigration(t, db)
}

func TestProviderReadinessCertificationMigrationPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}
	adminSQLDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	adminSQLDB.SetMaxOpenConns(2)
	adminDB := bun.NewDB(adminSQLDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, adminDB.Close()) })
	require.NoError(t, adminDB.PingContext(t.Context()))
	schema := fmt.Sprintf("provider_readiness_077_%d", time.Now().UnixNano())
	_, err := adminDB.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := adminDB.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
	})

	scopedSQLDB := sql.OpenDB(pgdriver.NewConnector(
		pgdriver.WithDSN(dsn),
		pgdriver.WithConnParams(map[string]any{"search_path": schema}),
	))
	scopedSQLDB.SetMaxOpenConns(16)
	db := bun.NewDB(scopedSQLDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(t.Context()))
	exerciseProviderReadinessCertificationMigration(t, db)
	exerciseProviderReadinessConcurrentControls(t, db)
}

func exerciseProviderReadinessConcurrentControls(t *testing.T, db *bun.DB) {
	t.Helper()
	repository := providerreadiness.NewRepository(db)
	now := time.Now().UTC().Truncate(time.Microsecond)
	subject := providerreadiness.Subject{
		Provider: "x", AppFingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		DeploymentEnvironment: providerreadiness.DeploymentEnvironmentProduction,
		ProviderEnvironment:   providerreadiness.ProviderEnvironmentProduction,
		AccountKind:           "standard", OutputProfile: "x.post",
		Operation: providerreadiness.OperationPublishImmediate, PolicyMode: "immediate",
	}
	const eventCount = 32
	errorsByIndex := make([]error, eventCount)
	start := make(chan struct{})
	var wait sync.WaitGroup
	for index := 0; index < eventCount; index++ {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			<-start
			state := providerreadiness.RuntimeControlStateEnabled
			if index == eventCount-1 {
				state = providerreadiness.RuntimeControlStateDisabled
			}
			errorsByIndex[index] = repository.AppendRuntimeControl(context.Background(), providerreadiness.RuntimeControlEvent{
				ID: fmt.Sprintf("postgres-control-%02d", index),
				Selector: providerreadiness.RuntimeControlSelector{
					Provider: subject.Provider, AppFingerprint: subject.AppFingerprint,
				},
				Control: providerreadiness.RuntimeControl{
					State: state, ReasonCode: fmt.Sprintf("postgres_concurrent_%02d", index),
				},
				StartsAt: now.Add(-time.Hour), OperatorRef: "operator:sha256:postgres",
				CreatedAt: now.Add(time.Duration(index) * time.Second),
			})
		}(index)
	}
	close(start)
	wait.Wait()
	for index, err := range errorsByIndex {
		require.NoErrorf(t, err, "append concurrent control %d", index)
	}
	control, err := repository.EffectiveRuntimeControl(t.Context(), subject, now.Add(time.Hour))
	require.NoError(t, err)
	require.Equal(t, providerreadiness.RuntimeControlStateDisabled, control.State)
	require.Equal(t, "postgres_concurrent_31", control.ReasonCode)
}

func exerciseProviderReadinessCertificationMigration(t *testing.T, db *bun.DB) {
	t.Helper()
	ctx := t.Context()
	_, err := db.ExecContext(ctx, `CREATE TABLE schema_migrations (
		version BIGINT PRIMARY KEY, applied_at BIGINT NOT NULL
	)`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `CREATE TABLE publication_authorizations (id TEXT PRIMARY KEY)`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `CREATE TABLE x_oauth_request_tokens (request_token TEXT PRIMARY KEY)`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `CREATE TABLE oauth_account_selections (id TEXT PRIMARY KEY)`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO x_oauth_request_tokens (request_token) VALUES ('legacy-x-state')`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO oauth_account_selections (id) VALUES ('legacy-selection')`)
	require.NoError(t, err)

	raw, err := migrationFiles.ReadFile("077_provider_readiness_certification.sql")
	require.NoError(t, err)
	item := migration{
		version: 77,
		name:    "077_provider_readiness_certification.sql",
		sql:     normalizeMigrationSQL(db.Dialect().Name(), string(raw)),
	}
	require.NoError(t, prepareMigration(ctx, db, item))
	for _, assertion := range []struct {
		table  string
		column string
	}{
		{table: "publication_authorizations", column: "provider_policy_mode"},
		{table: "publication_authorizations", column: "execution_intent"},
		{table: "x_oauth_request_tokens", column: "execution_intent"},
		{table: "oauth_account_selections", column: "execution_intent"},
	} {
		present, columnErr := migrationColumnExists(ctx, db, assertion.table, assertion.column)
		require.NoError(t, columnErr)
		require.Truef(t, present, "077 prepare did not add %s.%s", assertion.table, assertion.column)
	}
	var legacyXIntent, legacySelectionIntent string
	require.NoError(t, db.NewRaw(`SELECT execution_intent FROM x_oauth_request_tokens WHERE request_token = 'legacy-x-state'`).Scan(ctx, &legacyXIntent))
	require.NoError(t, db.NewRaw(`SELECT execution_intent FROM oauth_account_selections WHERE id = 'legacy-selection'`).Scan(ctx, &legacySelectionIntent))
	require.Empty(t, legacyXIntent, "legacy request tokens must fail closed rather than inherit production intent")
	require.Empty(t, legacySelectionIntent, "legacy account selections must fail closed rather than inherit production intent")
	require.NoError(t, runMigration(ctx, db, item))
	require.NoError(t, ensureProviderReadinessSchema(ctx, db))
	require.NoError(t, ensureProviderReadinessSchema(ctx, db), "finalization must remain idempotent")
	_, err = db.ExecContext(ctx, `INSERT INTO publication_authorizations (id) VALUES ('production-receipt')`)
	require.NoError(t, err)
	var executionIntent, providerPolicyMode string
	require.NoError(t, db.NewRaw(`SELECT execution_intent, provider_policy_mode FROM publication_authorizations WHERE id = 'production-receipt'`).Scan(ctx, &executionIntent, &providerPolicyMode))
	require.Equal(t, "production", executionIntent)
	require.Equal(t, "provider.unspecified", providerPolicyMode)
	_, err = db.ExecContext(ctx, `INSERT INTO publication_authorizations (id, execution_intent) VALUES ('invalid-receipt', 'bypass')`)
	require.Error(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO publication_authorizations (id, provider_policy_mode) VALUES ('invalid-policy-receipt', '')`)
	require.Error(t, err)

	now := time.Now().UTC().Truncate(time.Microsecond)
	appFingerprint := "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	instanceFingerprint := "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	subjectDigest := "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
	contractDigest := "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
	_, err = db.ExecContext(ctx, `INSERT INTO provider_approval_reviews (
		id, provider, app_fingerprint, provider_environment,
		instance_fingerprint, approval_state, approval_tier, source_url,
		reviewed_at, expires_at, operator_ref, created_at
	) VALUES (?, 'mastodon', ?, 'production', ?, 'approved', 'standard',
		'https://docs.joinmastodon.org/spec/oauth/', ?, ?, 'operator:sha256:reviewer', ?)`,
		"review-1", appFingerprint, instanceFingerprint, now.Add(-time.Hour), now.Add(30*24*time.Hour), now)
	require.NoError(t, err)
	assertProviderReadinessApprovalBinding(t, db, now, appFingerprint, instanceFingerprint, contractDigest)

	_, err = db.ExecContext(ctx, `INSERT INTO provider_certification_runs (
		id, approval_review_id, evidence_kind, subject_digest, provider,
		app_fingerprint, deployment_environment, provider_environment,
		instance_fingerprint, account_kind, account_reference_hash, output_profile, operation,
		policy_mode, tested_revision, contract_digest, approval_state_at_test,
		approval_tier_at_test, required_scopes_json, granted_scopes_json,
		operator_ref, tested_at, expires_at, created_at
	) VALUES (?, 'review-1', 'live', ?, 'mastodon', ?, 'production',
		'production', ?, 'user', ?, 'short_text', 'publish_immediate', 'default',
		'0123456789abcdef0123456789abcdef01234567', ?, 'approved', 'standard',
		'[]', '[]', 'operator:sha256:runner', ?, ?, ?)`,
		"run-1", subjectDigest, appFingerprint, instanceFingerprint,
		"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
		contractDigest, now, now.Add(7*24*time.Hour), now)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, `INSERT INTO provider_certification_checks (
		id, certification_run_id, kind, outcome, error_class,
		not_applicable_reason, external_reference_hash, completed_at, created_at
	) VALUES (?, 'run-1', 'publish_immediate', 'passed', '', '', ?, ?, ?)`,
		"check-1", "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", now, now)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO provider_certification_checks (
		id, certification_run_id, kind, outcome, error_class,
		not_applicable_reason, external_reference_hash, completed_at, created_at
	) VALUES (?, 'run-1', 'final_result', 'passed', '', '', '', ?, ?)`,
		"check-empty-result", now, now)
	require.Error(t, err, "a passed provider result must include a one-way external reference")

	_, err = db.ExecContext(ctx, `INSERT INTO provider_runtime_control_events (
		id, provider, state, reason_code, starts_at, operator_ref, created_at
	) VALUES (?, 'mastodon', 'enabled', 'certification_enabled', ?, 'operator:sha256:reviewer', ?)`,
		"control-1", now, now)
	require.NoError(t, err)

	assertProviderReadinessTablesAppendOnly(t, db)

	_, err = db.ExecContext(ctx, `INSERT INTO provider_certification_runs (
		id, approval_review_id, evidence_kind, subject_digest, provider,
		app_fingerprint, deployment_environment, provider_environment,
		instance_fingerprint, account_kind, account_reference_hash, output_profile, operation,
		policy_mode, tested_revision, contract_digest, approval_state_at_test,
		approval_tier_at_test, required_scopes_json, granted_scopes_json,
		operator_ref, tested_at, expires_at
	) VALUES ('run-wrong-review', 'review-1', 'live', ?, 'mastodon', ?,
		'production', 'production', '', 'user', ?, 'short_text', 'publish_immediate',
		'default', '0123456789abcdef0123456789abcdef01234567', ?, 'approved',
		'standard', '[]', '[]', 'operator:sha256:runner', ?, ?)`,
		subjectDigest, appFingerprint,
		"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
		contractDigest, now, now.Add(24*time.Hour))
	require.Error(t, err, "certification must reference an approval for the exact app and instance")

	_, err = db.ExecContext(ctx, `INSERT INTO provider_certification_checks (
		id, certification_run_id, kind, outcome, error_class,
		not_applicable_reason, completed_at
	) VALUES ('check-invalid', 'run-1', 'refresh', 'failed', '', '', ?)`, now)
	require.Error(t, err, "a failed check must include a safe error class")
}

func assertProviderReadinessApprovalBinding(
	t *testing.T,
	db *bun.DB,
	now time.Time,
	appFingerprint, instanceFingerprint, contractDigest string,
) {
	t.Helper()
	base := providerreadiness.CertificationEvidence{
		ID: "repository-approval-binding", Kind: providerreadiness.EvidenceKindLive,
		Subject: providerreadiness.Subject{
			Provider: "mastodon", AppFingerprint: appFingerprint,
			DeploymentEnvironment: providerreadiness.DeploymentEnvironmentProduction,
			ProviderEnvironment:   providerreadiness.ProviderEnvironmentProduction,
			InstanceFingerprint:   instanceFingerprint, AccountKind: "user",
			OutputProfile: "short_text", Operation: providerreadiness.OperationPublishImmediate,
			PolicyMode: "default",
		},
		AccountReferenceHash: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
		TestedRevision:       "0123456789abcdef0123456789abcdef01234567",
		ContractDigest:       contractDigest, TestedAt: now, ExpiresAt: now.Add(time.Hour),
		ApprovalStateAtTest: providerreadiness.ApprovalStateApproved, ApprovalTierAtTest: "standard",
		Checks: []providerreadiness.CheckResult{{
			Kind: providerreadiness.CheckConnect, Outcome: providerreadiness.CheckOutcomePassed, CompletedAt: now,
		}},
		OperatorRef: "operator:sha256:runner",
	}
	tests := []struct {
		name   string
		mutate func(*providerreadiness.CertificationEvidence)
	}{
		{name: "wrong-provider", mutate: func(value *providerreadiness.CertificationEvidence) {
			value.Subject.Provider = "x"
		}},
		{name: "wrong-app", mutate: func(value *providerreadiness.CertificationEvidence) {
			value.Subject.AppFingerprint = "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
		}},
		{name: "wrong-tier", mutate: func(value *providerreadiness.CertificationEvidence) {
			value.ApprovalTierAtTest = "trial"
		}},
		{name: "stale-review", mutate: func(value *providerreadiness.CertificationEvidence) {
			value.TestedAt = now.Add(31 * 24 * time.Hour)
			value.ExpiresAt = value.TestedAt.Add(time.Hour)
			value.Checks[0].CompletedAt = value.TestedAt
		}},
	}
	for index, test := range tests {
		candidate := base
		candidate.ID = fmt.Sprintf("repository-approval-binding-%d", index)
		candidate.Checks = append([]providerreadiness.CheckResult(nil), base.Checks...)
		test.mutate(&candidate)
		err := providerreadiness.NewRepository(db).AppendCertification(t.Context(), "review-1", candidate)
		require.Errorf(t, err, "%s evidence must not cross an immutable approval boundary", test.name)
	}
}

func assertProviderReadinessTablesAppendOnly(t *testing.T, db *bun.DB) {
	t.Helper()
	ctx := t.Context()
	fixtures := []struct {
		table string
		id    string
	}{
		{table: "provider_approval_reviews", id: "review-1"},
		{table: "provider_certification_runs", id: "run-1"},
		{table: "provider_certification_checks", id: "check-1"},
		{table: "provider_runtime_control_events", id: "control-1"},
	}
	for _, fixture := range fixtures {
		_, err := db.ExecContext(ctx, "UPDATE "+fixture.table+" SET id = id WHERE id = ?", fixture.id)
		require.ErrorContains(t, err, "append-only", fixture.table+" must reject updates")
		_, err = db.ExecContext(ctx, "DELETE FROM "+fixture.table+" WHERE id = ?", fixture.id)
		require.ErrorContains(t, err, "append-only", fixture.table+" must reject deletes")
	}
}
