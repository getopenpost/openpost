package handlers

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestProviderReadinessCertificationIntentRequiresUnscopedInstanceAdmin(t *testing.T) {
	t.Parallel()
	db := createHandlerTestDB(t, (*models.User)(nil))
	_, err := db.NewInsert().Model(&models.User{
		ID: "admin-1", Email: "admin@example.com", IsAdmin: true,
		CreatedAt: time.Now().UTC(),
	}).Exec(t.Context())
	require.NoError(t, err)

	production, err := providerReadinessExecutionIntent(t.Context(), db, "")
	require.NoError(t, err)
	require.Equal(t, providerreadiness.ExecutionIntentProduction, production)

	adminContext := context.WithValue(t.Context(), middleware.UserIDKey, "admin-1")
	intent, err := providerReadinessExecutionIntent(
		adminContext,
		db,
		string(providerreadiness.ExecutionIntentCertificationTest),
	)
	require.NoError(t, err)
	require.Equal(t, providerreadiness.ExecutionIntentCertificationTest, intent)

	scopedContext := context.WithValue(adminContext, middleware.WorkspaceIDKey, "workspace-1")
	_, err = providerReadinessExecutionIntent(
		scopedContext,
		db,
		string(providerreadiness.ExecutionIntentCertificationTest),
	)
	require.Error(t, err)
}

func TestInsertPublicationJobCarriesCertificationIntentToTheWorker(t *testing.T) {
	t.Parallel()
	db := createHandlerTestDB(t, (*models.Job)(nil))
	var jobID string
	err := db.RunInTx(t.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
		var insertErr error
		jobID, insertErr = insertPublicationJobTx(
			ctx,
			tx,
			"publication-1",
			"rendition-1",
			"authorization-batch-1",
			time.Now().UTC(),
			providerreadiness.ExecutionIntentCertificationTest,
		)
		return insertErr
	})
	require.NoError(t, err)

	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("id = ?", jobID).Scan(t.Context()))
	var payload map[string]string
	require.NoError(t, json.Unmarshal([]byte(job.Payload), &payload))
	require.Equal(t, "certification_test", payload["readiness_intent"])
	require.Equal(t, "publication-1", payload["publication_id"])
	require.Equal(t, "rendition-1", payload["rendition_id"])
}

func TestPublicationSchedulingFailsClosedWithoutReadinessService(t *testing.T) {
	t.Parallel()
	handler := &PublicationHandler{}
	err := handler.requirePublicationReadiness(
		t.Context(), "publication-1", providerreadiness.OperationPublishScheduled,
		providerreadiness.ExecutionIntentProduction,
	)
	var notReady *providerreadiness.NotReadyError
	require.ErrorAs(t, err, &notReady)
	require.Equal(t, providerreadiness.EffectiveStateDegraded, notReady.Decision.State)
	require.False(t, notReady.Decision.Publishable)
}

func TestPublicationSchedulingRechecksReadinessAfterPreTransactionMutation(t *testing.T) {
	db := createHandlerTestDB(
		t,
		(*models.Publication)(nil),
		(*models.SocialAccount)(nil),
		(*models.MediaAttachment)(nil),
		(*models.RenditionMedia)(nil),
		(*models.Job)(nil),
		(*models.ProviderApprovalReview)(nil),
		(*models.ProviderCertificationRun)(nil),
		(*models.ProviderCertificationCheck)(nil),
		(*models.ProviderRuntimeControlEvent)(nil),
	)
	now := time.Now().UTC().Truncate(time.Microsecond)
	_, err := db.NewInsert().Model(&models.OAuthGrant{
		ID: "grant-linkedin", WorkspaceID: "workspace-1", Provider: capabilities.ProviderLinkedIn,
		AccessTokenEnc: []byte("encrypted"), GrantedScopes: "w_member_social w_organization_social",
		ValidationStatus: "valid", ValidatedAt: now.Add(-time.Minute),
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "account-linkedin", WorkspaceID: "workspace-1", Slug: "linkedin-person",
		Platform: capabilities.ProviderLinkedIn, AccountID: "person-1", OAuthGrantID: "grant-linkedin",
		AccessTokenEnc: []byte("encrypted"), GrantedScopes: "w_member_social w_organization_social",
		CapabilityState: `{"linkedin_account_type":"person"}`, IsActive: true, CreatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID: "publication-readiness-race", WorkspaceID: "workspace-1", CreatedByID: "user-1",
		Title: "Exact policy", ContentProfile: models.ContentProfileShortText,
		SourceText:    "Do not queue after the account policy changes",
		SourceContent: "Do not queue after the account policy changes",
		Status:        models.PublicationStatusDraft, MetadataJSON: "{}", ReleasePlanJSON: "{}",
		CreatedAt: now, UpdatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{
		ID: "rendition-readiness-race", PublicationID: "publication-readiness-race",
		SocialAccountID: "account-linkedin", Platform: capabilities.ProviderLinkedIn,
		Profile: models.ContentProfileShortText, OutputProfile: "linkedin.post",
		Body: "Do not queue after the account policy changes", SettingsJSON: "{}",
		Status: models.RenditionStatusDraft, CreatedAt: now, UpdatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	catalog, err := providerreadiness.NewConfigurationCatalog(providerreadiness.RuntimeApps(
		[]platform.AppConfig{{Provider: capabilities.ProviderLinkedIn, ClientID: "linkedin-client"}},
		providerreadiness.ConfigurationSourceEnvironment,
		providerreadiness.ProviderEnvironmentDevelopment,
	))
	require.NoError(t, err)
	repository := providerreadiness.NewRepository(db)
	readiness := providerreadiness.NewService(repository, providerreadiness.ServiceOptions{
		Configurations: catalog, DefaultControl: providerreadiness.RuntimeControlStateEnabled,
	})
	require.NoError(t, repository.AppendRuntimeControl(t.Context(), providerreadiness.RuntimeControlEvent{
		ID: "disable-linkedin-organization",
		Selector: providerreadiness.RuntimeControlSelector{
			Provider: capabilities.ProviderLinkedIn, PolicyMode: "linkedin.organization",
		},
		Control: providerreadiness.RuntimeControl{
			State: providerreadiness.RuntimeControlStateDisabled, ReasonCode: "organization_incident",
		},
		StartsAt: now.Add(-time.Hour), OperatorRef: "operator:sha256:test", CreatedAt: now,
	}))
	handler := &PublicationHandler{db: db, readiness: readiness}
	handler.beforeQueueTransaction = func(ctx context.Context) error {
		_, updateErr := db.NewUpdate().Model((*models.SocialAccount)(nil)).
			Set("capability_state_json = ?", `{"linkedin_account_type":"organization"}`).
			Where("id = ?", "account-linkedin").Exec(ctx)
		return updateErr
	}

	_, err = handler.queuePublicationNow(t.Context(), "publication-readiness-race")
	var notReady *providerreadiness.NotReadyError
	require.ErrorAs(t, err, &notReady)
	require.Equal(t, providerreadiness.EffectiveStateDisabled, notReady.Decision.State)
	jobCount, err := db.NewSelect().Model((*models.Job)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, jobCount)
	receiptCount, err := db.NewSelect().Model((*models.PublicationAuthorization)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, receiptCount)
}
