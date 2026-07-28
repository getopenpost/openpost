package database

import (
	"fmt"
	"regexp"
	"strconv"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

var (
	safeSQLIdentifierExpr = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$`)
	safeJSONKeyExpr       = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	safeTimeOffsetExpr    = regexp.MustCompile(`^[+-][0-9]{2}:[0-9]{2}$`)
)

func JSONTextExpr(db *bun.DB, column, key string) string {
	return JSONTextExprForDialect(db.Dialect().Name(), column, key)
}

func JSONTextExprForDialect(name dialect.Name, column, key string) string {
	if !safeSQLIdentifierExpr.MatchString(column) {
		panic(fmt.Sprintf("unsafe SQL column expression %q", column))
	}
	if !safeJSONKeyExpr.MatchString(key) {
		panic(fmt.Sprintf("unsafe JSON key %q", key))
	}

	if name == dialect.PG {
		return fmt.Sprintf("(%s::jsonb ->> '%s')", column, key)
	}
	return fmt.Sprintf("json_extract(%s, '$.%s')", column, key)
}

func DateExpr(db *bun.DB, column, offset string) string {
	return DateExprForDialect(db.Dialect().Name(), column, offset)
}

func DateExprForDialect(name dialect.Name, column, offset string) string {
	if !safeSQLIdentifierExpr.MatchString(column) {
		panic(fmt.Sprintf("unsafe SQL column expression %q", column))
	}
	if offset == "" {
		return fmt.Sprintf("DATE(%s)", column)
	}
	if !safeTimeOffsetExpr.MatchString(offset) {
		panic(fmt.Sprintf("unsafe time offset %q", offset))
	}

	if name == dialect.PG {
		return fmt.Sprintf("DATE(%s + (%d * INTERVAL '1 minute'))", column, timeOffsetMinutes(offset))
	}
	return fmt.Sprintf("DATE(datetime(%s, '%s'))", column, offset)
}

func timeOffsetMinutes(offset string) int {
	hours, _ := strconv.Atoi(offset[1:3])
	minutes, _ := strconv.Atoi(offset[4:6])
	total := hours*60 + minutes
	if offset[0] == '-' {
		return -total
	}
	return total
}
