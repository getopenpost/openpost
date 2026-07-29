package handlers

import (
	dbexpr "github.com/openpost/backend/internal/database"
	"github.com/uptrace/bun"
)

func jobPayloadTextExpr(db *bun.DB, key string) string {
	return dbexpr.JSONTextExpr(db, "payload", key)
}

func aliasedJobPayloadTextExpr(db *bun.DB, alias string, key string) string {
	return dbexpr.JSONTextExpr(db, alias+".payload", key)
}

func publishPostJobPostIDWhere(db *bun.DB) string {
	return "type = ? AND " + jobPayloadTextExpr(db, postIDKey) + " = ?"
}

func publishPublicationJobPublicationIDWhere(db *bun.DB) string {
	return "type = ? AND " + jobPayloadTextExpr(db, "publication_id") + " = ?"
}

func primaryPublishPublicationJobWhere(db *bun.DB) string {
	actionExpr := jobPayloadTextExpr(db, "action")
	return publishPublicationJobPublicationIDWhere(db) + " AND (" + actionExpr + " IS NULL OR " + actionExpr + " = '')"
}
