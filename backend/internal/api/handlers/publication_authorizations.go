package handlers

import (
	"context"
	"strings"

	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/publicationauth"
)

const openPostCLIClientID = "openpost-cli"

func publicationAuthorizationActor(ctx context.Context, fallbackUserID string) publicationauth.Actor {
	if actor, ok := publicationauth.ActorFromContext(ctx); ok {
		return actor
	}

	userID := strings.TrimSpace(middleware.GetUserID(ctx))
	if userID == "" {
		userID = strings.TrimSpace(fallbackUserID)
	}
	sessionID := strings.TrimSpace(middleware.GetSessionID(ctx))
	tokenID := strings.TrimSpace(middleware.GetTokenID(ctx))
	clientID := strings.TrimSpace(middleware.GetClientID(ctx))
	clientName := strings.TrimSpace(middleware.GetClientName(ctx))

	switch {
	case sessionID != "":
		return publicationauth.Actor{
			Origin:    publicationauth.OriginBrowser,
			UserID:    userID,
			SessionID: sessionID,
		}
	case tokenID != "":
		origin := publicationauth.OriginAPI
		userAgent := strings.ToLower(strings.TrimSpace(middleware.GetUserAgent(ctx)))
		if clientID == openPostCLIClientID || strings.HasPrefix(userAgent, openPostCLIClientID+"/") {
			origin = publicationauth.OriginCLI
		}
		return publicationauth.Actor{
			Origin:     origin,
			UserID:     userID,
			TokenID:    tokenID,
			ClientID:   clientID,
			ClientName: clientName,
		}
	default:
		// Old internal callers and pre-session JWTs cannot supply a stronger
		// identity. Label them explicitly instead of inventing a session or token.
		return publicationauth.Actor{Origin: publicationauth.OriginLegacy, UserID: userID}
	}
}
