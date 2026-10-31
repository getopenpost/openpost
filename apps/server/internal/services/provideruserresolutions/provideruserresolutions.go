// Package provideruserresolutions caches provider handle-to-user-ID
// resolutions per workspace. Platform adapters stay database-free, so the
// durable cache lives in this service and callers inject their provider's
// lookup.
package provideruserresolutions

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

// Lookup resolves handles to provider user IDs. It receives only the uncached
// handles, keyed by their normalized form, and must fail when a handle cannot
// be resolved.
type Lookup func(ctx context.Context, handles []string) (map[string]string, error)

type Service struct {
	db *bun.DB
}

func NewService(db *bun.DB) *Service {
	return &Service{db: db}
}

// NormalizeHandle trims a provider handle, strips its leading @ and
// lowercases it for matching. It does not change anything else.
func NormalizeHandle(value string) string {
	return strings.ToLower(strings.TrimPrefix(strings.TrimSpace(value), "@"))
}

// Resolve returns normalized handle -> provider user ID for every handle.
// Cached handles skip the lookup; misses go through the lookup once,
// successful lookups are upserted, and a lookup failure fails the whole
// batch so callers never publish with partial resolutions.
func (s *Service) Resolve(ctx context.Context, workspaceID, provider string, handles []string, lookup Lookup) (map[string]string, error) {
	normalized := make([]string, 0, len(handles))
	seen := make(map[string]struct{}, len(handles))
	for _, handle := range handles {
		value := NormalizeHandle(handle)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		normalized = append(normalized, value)
	}
	resolved := make(map[string]string, len(normalized))
	if len(normalized) == 0 {
		return resolved, nil
	}
	var cached []models.ProviderUserResolution
	if err := s.db.NewSelect().Model(&cached).
		Where("workspace_id = ?", workspaceID).
		Where("provider = ?", provider).
		Where("handle IN (?)", bun.List(normalized)).
		Scan(ctx); err != nil {
		return nil, fmt.Errorf("loading cached %s user resolutions: %w", provider, err)
	}
	for _, row := range cached {
		resolved[row.Handle] = row.ProviderUserID
	}
	missing := make([]string, 0, len(normalized))
	for _, handle := range normalized {
		if _, ok := resolved[handle]; !ok {
			missing = append(missing, handle)
		}
	}
	if len(missing) == 0 {
		return resolved, nil
	}
	lookedUp, err := lookup(ctx, missing)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	for _, handle := range missing {
		userID := lookedUp[handle]
		if strings.TrimSpace(userID) == "" {
			return nil, fmt.Errorf("%s user @%s could not be resolved", provider, handle)
		}
		resolved[handle] = userID
		row := models.ProviderUserResolution{
			ID: uuid.NewString(), WorkspaceID: workspaceID, Provider: provider,
			Handle: handle, ProviderUserID: userID,
			ResolvedAt: now, CreatedAt: now, UpdatedAt: now,
		}
		if _, err := s.db.NewInsert().Model(&row).
			On("CONFLICT (provider, workspace_id, handle) DO UPDATE SET provider_user_id = EXCLUDED.provider_user_id, resolved_at = EXCLUDED.resolved_at, updated_at = EXCLUDED.updated_at").
			Exec(ctx); err != nil {
			return nil, fmt.Errorf("storing %s user resolution for @%s: %w", provider, handle, err)
		}
	}
	return resolved, nil
}
