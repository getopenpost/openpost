package handlers

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/stretchr/testify/require"
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
