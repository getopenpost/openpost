package encryptionrotation

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/platform"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/uptrace/bun"
)

const rotationBatchSize = 100

type Result struct {
	ScannedCiphertexts           int `json:"scanned_ciphertexts"`
	RotatedCiphertexts           int `json:"rotated_ciphertexts"`
	VerifiedCiphertexts          int `json:"verified_ciphertexts"`
	DeletedExpiredXOAuthRequests int `json:"deleted_expired_x_oauth_requests"`
}

type columnTarget struct {
	table       string
	primaryKeys []string
	columns     []string
}

var columnTargets = []columnTarget{
	{table: "users", primaryKeys: []string{"id"}, columns: []string{"totp_secret_encrypted"}},
	{table: "identity_providers", primaryKeys: []string{"id"}, columns: []string{"client_secret_encrypted"}},
	{table: "oidc_auth_requests", primaryKeys: []string{"id"}, columns: []string{"pkce_verifier_encrypted"}},
	{table: "oidc_native_handoffs", primaryKeys: []string{"id"}, columns: []string{"token_encrypted"}},
	{table: "mastodon_instances", primaryKeys: []string{"id"}, columns: []string{"client_secret_encrypted"}},
	{table: "provider_apps", primaryKeys: []string{"id"}, columns: []string{"client_secret_encrypted"}},
	{table: "instance_settings", primaryKeys: []string{"key"}, columns: []string{"value_encrypted"}},
	{table: "ai_prompt_overrides", primaryKeys: []string{"key"}, columns: []string{"value_encrypted"}},
	{table: "oauth_grants", primaryKeys: []string{"id"}, columns: []string{"access_token_encrypted", "refresh_token_encrypted"}},
	{table: "social_accounts", primaryKeys: []string{"id"}, columns: []string{"access_token_encrypted", "refresh_token_encrypted"}},
	{table: "oauth_account_selections", primaryKeys: []string{"id"}, columns: []string{"access_token_encrypted", "refresh_token_encrypted"}},
	{table: "rendition_media_deliveries", primaryKeys: []string{"rendition_id", "media_id"}, columns: []string{"session_state_encrypted"}},
}

type jsonTarget struct {
	table     string
	typeValue string
	field     string
}

var jsonTargets = []jsonTarget{
	{table: "auth_challenges", typeValue: "totp_setup", field: "secret_encrypted"},
	{table: "jobs", typeValue: jobregistry.TypeNotificationEmail, field: "accept_url_encrypted"},
}

type encryptedRow struct {
	primaryKeys []string
	ciphertexts [][]byte
}

type jsonRow struct {
	id      string
	payload string
}

type queryExecutor interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

// Rotate rewrites every maintained ciphertext in bounded compare-and-swap
// batches, then authenticates a complete current-key verification pass.
func Rotate(ctx context.Context, db *bun.DB, encryptor *servicecrypto.TokenEncryptor) (Result, error) {
	var result Result
	deleted, err := deleteExpiredXOAuthRequests(
		ctx,
		db,
		time.Now().UTC().Add(-platform.XOAuthRequestLifetime),
	)
	if err != nil {
		return Result{}, err
	}
	result.DeletedExpiredXOAuthRequests = deleted
	if err := verifyNoXOAuthRequests(ctx, db); err != nil {
		return Result{}, err
	}
	for _, target := range columnTargets {
		if err := rotateColumnTarget(ctx, db, encryptor, target, &result); err != nil {
			return Result{}, err
		}
	}
	for _, target := range jsonTargets {
		if err := rotateJSONTarget(ctx, db, encryptor, target, &result); err != nil {
			return Result{}, err
		}
	}

	verified, err := Verify(ctx, db, encryptor)
	if err != nil {
		return Result{}, err
	}
	result.VerifiedCiphertexts = verified
	return result, nil
}

// Verify authenticates every nonempty maintained ciphertext with the current
// primary key. A successful result is the gate for removing previous keys.
func Verify(ctx context.Context, db *bun.DB, encryptor *servicecrypto.TokenEncryptor) (int, error) {
	if err := verifyNoXOAuthRequests(ctx, db); err != nil {
		return 0, err
	}
	verified := 0
	for _, target := range columnTargets {
		count, err := verifyColumnTarget(ctx, db, encryptor, target)
		if err != nil {
			return 0, err
		}
		verified += count
	}
	for _, target := range jsonTargets {
		count, err := verifyJSONTarget(ctx, db, encryptor, target)
		if err != nil {
			return 0, err
		}
		verified += count
	}
	return verified, nil
}

func deleteExpiredXOAuthRequests(ctx context.Context, db *bun.DB, cutoff time.Time) (int, error) {
	deleted := 0
	for {
		result, err := db.ExecContext(
			ctx,
			`DELETE FROM "x_oauth_request_tokens"
WHERE "request_token" IN (
	SELECT "request_token"
	FROM "x_oauth_request_tokens"
	WHERE "created_at" < ?
	ORDER BY "request_token"
	LIMIT ?
)`,
			cutoff,
			rotationBatchSize,
		)
		if err != nil {
			return 0, fmt.Errorf("delete expired X OAuth requests: %w", err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return 0, fmt.Errorf("inspect expired X OAuth request deletion: %w", err)
		}
		deleted += int(affected)
		if affected < rotationBatchSize {
			return deleted, nil
		}
	}
}

func verifyNoXOAuthRequests(ctx context.Context, db *bun.DB) error {
	var count int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM "x_oauth_request_tokens"`).Scan(&count); err != nil {
		return fmt.Errorf("count X OAuth request secrets: %w", err)
	}
	if count > 0 {
		return fmt.Errorf("%d X OAuth request secret rows remain; keep writers stopped for the full request lifetime", count)
	}
	return nil
}

func rotateColumnTarget(
	ctx context.Context,
	db *bun.DB,
	encryptor *servicecrypto.TokenEncryptor,
	target columnTarget,
	result *Result,
) error {
	return rotateInBatches(
		ctx,
		db,
		[]string(nil),
		func(loadCtx context.Context, executor queryExecutor, cursor []string) ([]encryptedRow, error) {
			return loadColumnBatch(loadCtx, executor, target, cursor)
		},
		func(rotateCtx context.Context, executor queryExecutor, row encryptedRow) (int, int, error) {
			return rotateColumnRow(rotateCtx, executor, encryptor, target, row)
		},
		func(row encryptedRow) []string { return row.primaryKeys },
		result,
	)
}

func rotateInBatches[Row any, Cursor any](
	ctx context.Context,
	db *bun.DB,
	cursor Cursor,
	load func(context.Context, queryExecutor, Cursor) ([]Row, error),
	rotate func(context.Context, queryExecutor, Row) (int, int, error),
	advance func(Row) Cursor,
	result *Result,
) error {
	for {
		var batch []Row
		batchScanned := 0
		batchRotated := 0
		err := db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			var err error
			batch, err = load(txCtx, tx, cursor)
			if err != nil {
				return err
			}
			for _, row := range batch {
				rotated, scanned, rotateErr := rotate(txCtx, tx, row)
				if rotateErr != nil {
					return rotateErr
				}
				batchScanned += scanned
				batchRotated += rotated
			}
			return nil
		})
		if err != nil {
			return err
		}
		result.ScannedCiphertexts += batchScanned
		result.RotatedCiphertexts += batchRotated
		if len(batch) == 0 {
			return nil
		}
		cursor = advance(batch[len(batch)-1])
	}
}

func loadColumnBatch(ctx context.Context, db queryExecutor, target columnTarget, cursor []string) ([]encryptedRow, error) {
	selected := append(append([]string{}, target.primaryKeys...), target.columns...)
	query := fmt.Sprintf(
		"SELECT %s FROM %s",
		joinIdentifiers(selected),
		quoteIdentifier(target.table),
	)
	arguments := make([]any, 0, 3)
	if len(cursor) > 0 {
		predicate, cursorArguments := cursorPredicate(target.primaryKeys, cursor)
		query += " WHERE " + predicate
		arguments = append(arguments, cursorArguments...)
	}
	query += " ORDER BY " + joinIdentifiers(target.primaryKeys) + " LIMIT ?"
	arguments = append(arguments, rotationBatchSize)

	rows, err := db.QueryContext(ctx, query, arguments...)
	if err != nil {
		return nil, fmt.Errorf("scan %s encrypted values: %w", target.table, err)
	}
	defer rows.Close()

	batch := make([]encryptedRow, 0, rotationBatchSize)
	for rows.Next() {
		row := encryptedRow{
			primaryKeys: make([]string, len(target.primaryKeys)),
			ciphertexts: make([][]byte, len(target.columns)),
		}
		destinations := make([]any, 0, len(selected))
		for index := range row.primaryKeys {
			destinations = append(destinations, &row.primaryKeys[index])
		}
		for index := range row.ciphertexts {
			destinations = append(destinations, &row.ciphertexts[index])
		}
		if err := rows.Scan(destinations...); err != nil {
			return nil, fmt.Errorf("scan %s encrypted row: %w", target.table, err)
		}
		batch = append(batch, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scan %s encrypted rows: %w", target.table, err)
	}
	return batch, nil
}

func rotateColumnRow(
	ctx context.Context,
	db queryExecutor,
	encryptor *servicecrypto.TokenEncryptor,
	target columnTarget,
	row encryptedRow,
) (rotated, scanned int, err error) {
	replacements, changed, scanned, err := prepareColumnReplacements(encryptor, target, row)
	if err != nil {
		return 0, 0, err
	}
	rotated, err = updateColumnRow(ctx, db, target, row, replacements, changed)
	return rotated, scanned, err
}

func prepareColumnReplacements(
	encryptor *servicecrypto.TokenEncryptor,
	target columnTarget,
	row encryptedRow,
) (replacements [][]byte, changed []bool, scanned int, err error) {
	replacements = make([][]byte, len(row.ciphertexts))
	changed = make([]bool, len(row.ciphertexts))
	for index, ciphertext := range row.ciphertexts {
		if len(ciphertext) == 0 {
			continue
		}
		scanned++
		if encryptor.VerifyCurrentCiphertext(ciphertext) == nil {
			continue
		}
		plaintext, decryptErr := encryptor.Decrypt(ciphertext)
		if decryptErr != nil {
			return nil, nil, 0, fmt.Errorf("%s.%s: decrypt ciphertext: %w", target.table, target.columns[index], decryptErr)
		}
		replacements[index], err = encryptor.Encrypt(plaintext)
		if err != nil {
			return nil, nil, 0, fmt.Errorf("%s.%s: encrypt ciphertext: %w", target.table, target.columns[index], err)
		}
		changed[index] = true
	}
	return replacements, changed, scanned, nil
}

func updateColumnRow(
	ctx context.Context,
	db queryExecutor,
	target columnTarget,
	row encryptedRow,
	replacements [][]byte,
	changed []bool,
) (int, error) {
	setClauses := make([]string, 0, len(target.columns))
	arguments := make([]any, 0, len(target.columns)*2+len(target.primaryKeys))
	for index, column := range target.columns {
		if !changed[index] {
			continue
		}
		setClauses = append(setClauses, quoteIdentifier(column)+" = ?")
		arguments = append(arguments, replacements[index])
	}
	if len(setClauses) == 0 {
		return 0, nil
	}

	whereClauses := make([]string, 0, len(target.primaryKeys)+len(target.columns))
	for index, primaryKey := range target.primaryKeys {
		whereClauses = append(whereClauses, quoteIdentifier(primaryKey)+" = ?")
		arguments = append(arguments, row.primaryKeys[index])
	}
	for index, column := range target.columns {
		if row.ciphertexts[index] == nil {
			whereClauses = append(whereClauses, quoteIdentifier(column)+" IS NULL")
			continue
		}
		whereClauses = append(whereClauses, quoteIdentifier(column)+" = ?")
		arguments = append(arguments, row.ciphertexts[index])
	}
	query := fmt.Sprintf(
		"UPDATE %s SET %s WHERE %s",
		quoteIdentifier(target.table),
		strings.Join(setClauses, ", "),
		strings.Join(whereClauses, " AND "),
	)
	updateResult, err := db.ExecContext(ctx, query, arguments...)
	if err != nil {
		return 0, fmt.Errorf("update %s encrypted values: %w", target.table, err)
	}
	affected, err := updateResult.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("inspect %s encrypted update: %w", target.table, err)
	}
	if affected == 0 {
		return 0, nil
	}
	if affected != 1 {
		return 0, fmt.Errorf("update %s encrypted values affected %d rows", target.table, affected)
	}
	rotated := 0
	for _, wasChanged := range changed {
		if wasChanged {
			rotated++
		}
	}
	return rotated, nil
}

func rotateJSONTarget(
	ctx context.Context,
	db *bun.DB,
	encryptor *servicecrypto.TokenEncryptor,
	target jsonTarget,
	result *Result,
) error {
	return rotateInBatches(
		ctx,
		db,
		"",
		func(loadCtx context.Context, executor queryExecutor, cursor string) ([]jsonRow, error) {
			return loadJSONBatch(loadCtx, executor, target, cursor)
		},
		func(rotateCtx context.Context, executor queryExecutor, row jsonRow) (int, int, error) {
			return rotateJSONRow(rotateCtx, executor, encryptor, target, row)
		},
		func(row jsonRow) string { return row.id },
		result,
	)
}

func loadJSONBatch(ctx context.Context, db queryExecutor, target jsonTarget, cursor string) ([]jsonRow, error) {
	query := fmt.Sprintf(
		"SELECT id, payload FROM %s WHERE type = ? AND id > ? ORDER BY id LIMIT ?",
		quoteIdentifier(target.table),
	)
	rows, err := db.QueryContext(ctx, query, target.typeValue, cursor, rotationBatchSize)
	if err != nil {
		return nil, fmt.Errorf("scan %s encrypted payloads: %w", target.table, err)
	}
	defer rows.Close()

	batch := make([]jsonRow, 0, rotationBatchSize)
	for rows.Next() {
		var row jsonRow
		if err := rows.Scan(&row.id, &row.payload); err != nil {
			return nil, fmt.Errorf("scan %s encrypted payload: %w", target.table, err)
		}
		batch = append(batch, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scan %s encrypted payloads: %w", target.table, err)
	}
	return batch, nil
}

func rotateJSONRow(
	ctx context.Context,
	db queryExecutor,
	encryptor *servicecrypto.TokenEncryptor,
	target jsonTarget,
	row jsonRow,
) (rotated, scanned int, err error) {
	values, ciphertext, present, err := encryptedJSONField(row.payload, target.field)
	if err != nil {
		return 0, 0, fmt.Errorf("%s.payload.%s: decode ciphertext: %w", target.table, target.field, err)
	}
	if !present || len(ciphertext) == 0 {
		return 0, 0, nil
	}
	scanned = 1
	if encryptor.VerifyCurrentCiphertext(ciphertext) == nil {
		return 0, scanned, nil
	}
	plaintext, err := encryptor.Decrypt(ciphertext)
	if err != nil {
		return 0, 0, fmt.Errorf("%s.payload.%s: decrypt ciphertext: %w", target.table, target.field, err)
	}
	replacement, err := encryptor.Encrypt(plaintext)
	if err != nil {
		return 0, 0, fmt.Errorf("%s.payload.%s: encrypt ciphertext: %w", target.table, target.field, err)
	}
	values[target.field], err = json.Marshal(replacement)
	if err != nil {
		return 0, 0, fmt.Errorf("%s.payload.%s: encode ciphertext: %w", target.table, target.field, err)
	}
	payload, err := json.Marshal(values)
	if err != nil {
		return 0, 0, fmt.Errorf("%s.payload: encode payload: %w", target.table, err)
	}
	updateResult, err := db.ExecContext(
		ctx,
		"UPDATE "+quoteIdentifier(target.table)+" SET payload = ? WHERE id = ? AND payload = ?",
		string(payload),
		row.id,
		row.payload,
	)
	if err != nil {
		return 0, 0, fmt.Errorf("update %s encrypted payload: %w", target.table, err)
	}
	affected, err := updateResult.RowsAffected()
	if err != nil {
		return 0, 0, fmt.Errorf("inspect %s encrypted payload update: %w", target.table, err)
	}
	if affected == 0 {
		return 0, scanned, nil
	}
	if affected != 1 {
		return 0, 0, fmt.Errorf("update %s encrypted payload affected %d rows", target.table, affected)
	}
	return 1, scanned, nil
}

func encryptedJSONField(payload, field string) (map[string]json.RawMessage, []byte, bool, error) {
	var values map[string]json.RawMessage
	if err := json.Unmarshal([]byte(payload), &values); err != nil {
		return nil, nil, false, err
	}
	raw, present := values[field]
	if !present || string(raw) == "null" {
		return values, nil, false, nil
	}
	var ciphertext []byte
	if err := json.Unmarshal(raw, &ciphertext); err != nil {
		return nil, nil, false, err
	}
	return values, ciphertext, true, nil
}

func verifyColumnTarget(
	ctx context.Context,
	db *bun.DB,
	encryptor *servicecrypto.TokenEncryptor,
	target columnTarget,
) (int, error) {
	verified := 0
	var cursor []string
	for {
		batch, err := loadColumnBatch(ctx, db, target, cursor)
		if err != nil {
			return 0, err
		}
		if len(batch) == 0 {
			return verified, nil
		}
		for _, row := range batch {
			for index, ciphertext := range row.ciphertexts {
				if len(ciphertext) == 0 {
					continue
				}
				if err := encryptor.VerifyCurrentCiphertext(ciphertext); err != nil {
					return 0, fmt.Errorf("%s.%s: verify current ciphertext: %w", target.table, target.columns[index], err)
				}
				verified++
			}
		}
		cursor = batch[len(batch)-1].primaryKeys
	}
}

func verifyJSONTarget(
	ctx context.Context,
	db *bun.DB,
	encryptor *servicecrypto.TokenEncryptor,
	target jsonTarget,
) (int, error) {
	verified := 0
	cursor := ""
	for {
		batch, err := loadJSONBatch(ctx, db, target, cursor)
		if err != nil {
			return 0, err
		}
		if len(batch) == 0 {
			return verified, nil
		}
		for _, row := range batch {
			_, ciphertext, present, err := encryptedJSONField(row.payload, target.field)
			if err != nil {
				return 0, fmt.Errorf("%s.payload.%s: decode ciphertext: %w", target.table, target.field, err)
			}
			if !present || len(ciphertext) == 0 {
				continue
			}
			if err := encryptor.VerifyCurrentCiphertext(ciphertext); err != nil {
				return 0, fmt.Errorf("%s.payload.%s: verify current ciphertext: %w", target.table, target.field, err)
			}
			verified++
		}
		cursor = batch[len(batch)-1].id
	}
}

func cursorPredicate(primaryKeys, cursor []string) (string, []any) {
	if len(primaryKeys) == 1 {
		return quoteIdentifier(primaryKeys[0]) + " > ?", []any{cursor[0]}
	}
	return fmt.Sprintf(
		"(%s > ? OR (%s = ? AND %s > ?))",
		quoteIdentifier(primaryKeys[0]),
		quoteIdentifier(primaryKeys[0]),
		quoteIdentifier(primaryKeys[1]),
	), []any{cursor[0], cursor[0], cursor[1]}
}

func quoteIdentifier(identifier string) string {
	return `"` + strings.ReplaceAll(identifier, `"`, `""`) + `"`
}

func joinIdentifiers(identifiers []string) string {
	quoted := make([]string, len(identifiers))
	for index, identifier := range identifiers {
		quoted[index] = quoteIdentifier(identifier)
	}
	return strings.Join(quoted, ", ")
}
