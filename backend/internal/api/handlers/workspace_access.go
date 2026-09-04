package handlers

import (
	"context"

	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

func workspaceActor(ctx context.Context, userID string) workspaceaccess.ActorFacts {
	return workspaceaccess.ActorFacts{
		UserID:                 userID,
		SessionID:              middleware.GetSessionID(ctx),
		TokenID:                middleware.GetTokenID(ctx),
		ClientID:               middleware.GetClientID(ctx),
		CredentialWorkspaceID:  middleware.GetWorkspaceID(ctx),
		ExternalInstallationID: middleware.GetInstallationID(ctx),
	}
}

func workspaceDecision(ctx context.Context, db bun.IDB, workspaceID, userID string, level workspaceaccess.Level) (workspaceaccess.Decision, error) {
	return workspaceaccess.NewAuthorizer(db).Authorize(ctx, workspaceID, workspaceActor(ctx, userID), level)
}

func workspaceReadAllowed(ctx context.Context, db bun.IDB, workspaceID, userID string) (bool, error) {
	decision, err := workspaceDecision(ctx, db, workspaceID, userID, workspaceaccess.LevelRead)
	return decision.Allowed, err
}

func workspaceEditAllowed(ctx context.Context, db bun.IDB, workspaceID, userID string) (bool, error) {
	decision, err := workspaceDecision(ctx, db, workspaceID, userID, workspaceaccess.LevelEdit)
	return decision.Allowed, err
}

func workspaceAdminAllowed(ctx context.Context, db bun.IDB, workspaceID, userID string) (bool, error) {
	decision, err := workspaceDecision(ctx, db, workspaceID, userID, workspaceaccess.LevelAdminister)
	return decision.Allowed, err
}

func workspaceRole(ctx context.Context, db bun.IDB, workspaceID, userID string) (string, bool, error) {
	decision, err := workspaceDecision(ctx, db, workspaceID, userID, workspaceaccess.LevelRead)
	if err != nil || !decision.Allowed {
		return "", false, err
	}
	return decision.Role, true, nil
}
