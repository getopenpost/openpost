package drafts

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

const (
	AggregatePublication = "publication"
	AggregateTextPost    = "text_post"
	ConflictCode         = "draft_revision_conflict"
)

var ErrRevisionConflict = errors.New("draft revision conflict")

type ConflictMetadata struct {
	AggregateType    string   `json:"aggregate_type"`
	AggregateID      string   `json:"aggregate_id"`
	ExpectedRevision int      `json:"expected_revision"`
	CurrentRevision  int      `json:"current_revision"`
	Status           string   `json:"status"`
	Title            string   `json:"title,omitempty"`
	UpdatedAt        string   `json:"updated_at,omitempty"`
	ChangedByName    string   `json:"changed_by_name,omitempty"`
	ChangedDomains   []string `json:"changed_domains"`
}

// ConflictError follows RFC 9457 while adding a stable machine code and safe
// editor metadata. It deliberately excludes draft text and media details.
type ConflictError struct {
	Type     string           `json:"type,omitempty"`
	Title    string           `json:"title"`
	Status   int              `json:"status"`
	Detail   string           `json:"detail"`
	Code     string           `json:"code"`
	Conflict ConflictMetadata `json:"conflict"`
}

func (e *ConflictError) Error() string  { return e.Detail }
func (e *ConflictError) GetStatus() int { return e.Status }
func (e *ConflictError) ContentType(contentType string) string {
	if contentType == "application/json" {
		return "application/problem+json"
	}
	return contentType
}

func NewConflictError(metadata ConflictMetadata) error {
	metadata.ChangedDomains = UniqueDomains(metadata.ChangedDomains)
	return &ConflictError{
		Type:     "https://openpost.social/problems/draft-revision-conflict",
		Title:    "Draft changed elsewhere",
		Status:   http.StatusConflict,
		Detail:   "This draft changed after the editor loaded it. Reload the saved version, overwrite it, or save these edits as a copy.",
		Code:     ConflictCode,
		Conflict: metadata,
	}
}

func RequireExpectedRevision(expected int) error {
	if expected < 1 {
		return huma.Error400BadRequest("expected_revision must be at least 1")
	}
	return nil
}

func RecordChange(
	ctx context.Context,
	db bun.IDB,
	aggregateType string,
	aggregateID string,
	revision int,
	domains []string,
	userID string,
	now time.Time,
) error {
	domainsJSON, err := json.Marshal(UniqueDomains(domains))
	if err != nil {
		return err
	}
	row := &models.DraftRevisionChange{
		AggregateType:  aggregateType,
		AggregateID:    aggregateID,
		Revision:       revision,
		ChangedDomains: string(domainsJSON),
		ChangedBy:      userID,
		CreatedAt:      now.UTC(),
	}
	_, err = db.NewInsert().Model(row).Exec(ctx)
	return err
}

func ChangedDomainsSince(
	ctx context.Context,
	db bun.IDB,
	aggregateType string,
	aggregateID string,
	revision int,
) ([]string, error) {
	var rows []models.DraftRevisionChange
	if err := db.NewSelect().
		Model(&rows).
		Where("aggregate_type = ? AND aggregate_id = ? AND revision > ?", aggregateType, aggregateID, revision).
		Order("revision ASC").
		Scan(ctx); err != nil {
		return nil, err
	}
	var domains []string
	for _, row := range rows {
		var item []string
		if json.Unmarshal([]byte(row.ChangedDomains), &item) == nil {
			domains = append(domains, item...)
		}
	}
	return UniqueDomains(domains), nil
}

// LatestEditorName returns only the user-facing identity needed to explain a
// conflict. It never includes draft contents or unrelated workspace data.
func LatestEditorName(
	ctx context.Context,
	db bun.IDB,
	aggregateType string,
	aggregateID string,
	revision int,
) (string, error) {
	var change models.DraftRevisionChange
	err := db.NewSelect().
		Model(&change).
		Where("aggregate_type = ? AND aggregate_id = ? AND revision > ?", aggregateType, aggregateID, revision).
		Order("revision DESC").
		Limit(1).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) || isMissingOptionalTable(err) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(change.ChangedBy) == "" {
		return "", nil
	}
	var user models.User
	err = db.NewSelect().Model(&user).Where("id = ?", change.ChangedBy).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) || isMissingOptionalTable(err) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if name := strings.TrimSpace(user.DisplayName); name != "" {
		return name, nil
	}
	return strings.TrimSpace(user.Email), nil
}

func isMissingOptionalTable(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such table") || strings.Contains(message, "does not exist")
}

func UniqueDomains(domains []string) []string {
	clean := make([]string, 0, len(domains))
	for _, domain := range domains {
		domain = strings.TrimSpace(domain)
		if domain != "" && !slices.Contains(clean, domain) {
			clean = append(clean, domain)
		}
	}
	sort.Strings(clean)
	return clean
}
