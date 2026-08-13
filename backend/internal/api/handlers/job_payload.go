package handlers

import (
	"fmt"

	dbexpr "github.com/openpost/backend/internal/database"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

func jobPayloadTextExpr(db *bun.DB, key string) string {
	return dbexpr.JSONTextExpr(db, "payload", key)
}

func aliasedJobPayloadTextExpr(db *bun.DB, alias string, key string) string {
	return dbexpr.JSONTextExpr(db, alias+".payload", key)
}

// safeAliasedJobPayloadTextExpr is reserved for compatibility reads of old
// job rows, whose payload predates the scope_id invariant and may be malformed.
// Current mutation paths use scope_id and never depend on this expression.
func safeAliasedJobPayloadTextExpr(db *bun.DB, alias string, key string) string {
	expr := aliasedJobPayloadTextExpr(db, alias, key)
	if db.Dialect().Name() == dialect.PG {
		return fmt.Sprintf("openpost_safe_json_text(%s.payload, '%s')", alias, key)
	}
	return fmt.Sprintf("(CASE WHEN json_valid(%s.payload) THEN %s ELSE NULL END)", alias, expr)
}

func publishPostJobPostIDWhere(_ *bun.DB) string {
	return "type = ? AND scope_id = ?"
}

func publishPublicationJobPublicationIDWhere(_ *bun.DB) string {
	return "type = ? AND scope_id = ?"
}

func primaryPublishPublicationJobWhere(db *bun.DB) string {
	actionExpr := jobPayloadTextExpr(db, "action")
	return publishPublicationJobPublicationIDWhere(db) + " AND (" + actionExpr + " IS NULL OR " + actionExpr + " = '')"
}

func replyPublishPublicationJobWhere(db *bun.DB) string {
	actionExpr := jobPayloadTextExpr(db, "action")
	return publishPublicationJobPublicationIDWhere(db) + " AND " + actionExpr + " = 'reply'"
}
