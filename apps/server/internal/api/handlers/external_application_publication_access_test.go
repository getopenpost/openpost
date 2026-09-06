package handlers

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	publicationservice "github.com/openpost/backend/internal/services/publications"
	"github.com/stretchr/testify/require"
)

func TestExternalApplicationPublicationActionsRequireEveryDestinationGrant(t *testing.T) {
	t.Parallel()
	db := createHandlerTestDB(t, (*models.Rendition)(nil), (*models.ExternalAppAccountGrant)(nil))
	ctx := context.WithValue(t.Context(), middleware.InstallationIDKey, "installation-1")
	handler := NewPublicationHandler(db, nil, nil)
	_, err := db.NewInsert().Model(&[]models.Rendition{
		{ID: "rendition-1", PublicationID: "publication-1", SocialAccountID: "account-1", TargetKey: "x:account-1"},
		{ID: "rendition-2", PublicationID: "publication-1", SocialAccountID: "account-2", TargetKey: "x:account-2"},
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.ExternalAppAccountGrant{InstallationID: "installation-1", WorkspaceID: "workspace-1", SocialAccountID: "account-1"}).Exec(ctx)
	require.NoError(t, err)

	err = handler.requireExternalPublicationAccounts(ctx, "publication-1")
	require.Error(t, err)

	_, err = db.NewInsert().Model(&models.ExternalAppAccountGrant{InstallationID: "installation-1", WorkspaceID: "workspace-1", SocialAccountID: "account-2"}).Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, handler.requireExternalPublicationAccounts(ctx, "publication-1"))
}

func TestExternalApplicationPublicationReadsHideUngrantedDestinations(t *testing.T) {
	t.Parallel()
	db := createHandlerTestDB(t, (*models.ExternalAppAccountGrant)(nil))
	ctx := context.WithValue(t.Context(), middleware.InstallationIDKey, "installation-1")
	handler := NewPublicationHandler(db, nil, nil)
	_, err := db.NewInsert().Model(&models.ExternalAppAccountGrant{InstallationID: "installation-1", WorkspaceID: "workspace-1", SocialAccountID: "account-1"}).Exec(ctx)
	require.NoError(t, err)
	publication := publicationservice.PublicationResponse{
		WorkspaceID: "workspace-1",
		Renditions: []publicationservice.RenditionResponse{
			{ID: "rendition-1", SocialAccountID: "account-1"},
			{ID: "rendition-2", SocialAccountID: "account-2"},
		},
	}

	require.NoError(t, handler.filterExternalPublicationRenditions(ctx, &publication))
	require.Len(t, publication.Renditions, 1)
	require.Equal(t, "account-1", publication.Renditions[0].SocialAccountID)
}

func TestExternalApplicationScheduleFieldsRequireScheduleOrCancelScope(t *testing.T) {
	t.Parallel()
	ctx := context.WithValue(t.Context(), middleware.InstallationIDKey, "installation-1")
	ctx = context.WithValue(ctx, middleware.DelegatedScopesKey, "drafts:write")
	require.Error(t, requireExternalDelegatedScope(ctx, "publications:schedule"))
	require.Error(t, requireExternalDelegatedScope(ctx, "publications:cancel"))

	ctx = context.WithValue(ctx, middleware.DelegatedScopesKey, "drafts:write publications:schedule publications:cancel")
	require.NoError(t, requireExternalDelegatedScope(ctx, "publications:schedule"))
	require.NoError(t, requireExternalDelegatedScope(ctx, "publications:cancel"))
}
