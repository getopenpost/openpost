package publicationauth

import (
	"context"
	"strings"
)

type actorContextKey struct{}

const (
	OriginBrowser = "browser"
	OriginAPI     = "api"
	OriginMCP     = "mcp"
	OriginCLI     = "cli"
	OriginWorker  = "worker"
	OriginLegacy  = "legacy"
)

// Actor identifies the principal that confirmed an outward-facing write. IDs
// are internal references only; bearer values and credential material never
// enter this structure.
type Actor struct {
	Origin     string
	UserID     string
	SessionID  string
	TokenID    string
	ClientID   string
	ClientName string
}

func (actor Actor) normalized() Actor {
	actor.Origin = strings.ToLower(strings.TrimSpace(actor.Origin))
	actor.UserID = strings.TrimSpace(actor.UserID)
	actor.SessionID = strings.TrimSpace(actor.SessionID)
	actor.TokenID = strings.TrimSpace(actor.TokenID)
	actor.ClientID = strings.TrimSpace(actor.ClientID)
	actor.ClientName = strings.TrimSpace(actor.ClientName)
	return actor
}

func (actor Actor) valid() bool {
	switch actor.Origin {
	case OriginBrowser:
		return actor.UserID != "" && actor.SessionID != ""
	case OriginAPI, OriginCLI:
		return actor.UserID != "" && actor.TokenID != ""
	case OriginMCP:
		return actor.UserID != "" && (actor.TokenID != "" || actor.SessionID != "")
	case OriginWorker, OriginLegacy:
		return actor.UserID != ""
	default:
		return false
	}
}

func WithActor(ctx context.Context, actor Actor) context.Context {
	return context.WithValue(ctx, actorContextKey{}, actor.normalized())
}

func ActorFromContext(ctx context.Context) (Actor, bool) {
	actor, ok := ctx.Value(actorContextKey{}).(Actor)
	actor = actor.normalized()
	return actor, ok && actor.valid()
}
