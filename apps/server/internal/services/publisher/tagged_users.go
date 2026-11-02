package publisher

import (
	"context"
	"fmt"
	"strings"

	"github.com/openpost/backend/internal/platform"
)

// taggedUserResolver is implemented by platform adapters that can resolve
// tagged-user handles to provider user IDs.
type taggedUserResolver interface {
	ResolveTaggedUsernames(ctx context.Context, accessToken string, handles []string) (map[string]string, error)
}

// resolveRenditionTaggedUsers resolves non-numeric tagged-user entries for X
// renditions before dispatch. It rewrites only the in-memory request copy:
// req.MediaSettings is rebuilt with resolved numeric IDs and nothing is
// persisted, so stored authorship and publication revision comparison never
// see provider user IDs. A handle that cannot be resolved fails the rendition
// so it is never published with partial tags.
func (s *Service) resolveRenditionTaggedUsers(ctx context.Context, workspaceID string, provider platform.Publisher, token string, req *platform.PublishRequest) error {
	entries := platform.XTaggedUserEntries(req.MediaSettings)
	handles := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !platform.IsXUserID(entry) {
			handles = append(handles, platform.NormalizeXHandle(entry))
		}
	}
	if len(handles) == 0 {
		return nil
	}
	resolver, ok := provider.(taggedUserResolver)
	if !ok {
		return fmt.Errorf("x tagged users %s cannot be resolved to user IDs by this publisher; use X user IDs", strings.Join(handles, ", "))
	}
	resolved, err := s.userResolutions.Resolve(ctx, workspaceID, "x", handles, func(resolveCtx context.Context, missing []string) (map[string]string, error) {
		reservation, err := s.reserveTaggedUserLookupCost(resolveCtx, workspaceID, int64(len(missing)))
		if err != nil {
			return nil, err
		}
		resolved, lookupErr := resolver.ResolveTaggedUsernames(resolveCtx, token, missing)
		s.settleTaggedUserLookupCost(resolveCtx, reservation, lookupErr)
		return resolved, lookupErr
	})
	if err != nil {
		// The "required" wording classifies this as a validation failure so
		// the rendition fails closed instead of publishing partial tags.
		return fmt.Errorf("resolving x tagged users: %w; an X user ID or a handle X recognizes is required for every tagged user", err)
	}
	rewritten := make([]map[string]interface{}, len(req.MediaSettings))
	for index, settings := range req.MediaSettings {
		itemSettings := make(map[string]interface{}, len(settings))
		for key, value := range settings {
			itemSettings[key] = value
		}
		if raw, ok := itemSettings["tagged_users"].(string); ok && raw != "" {
			resolvedIDs, err := resolvedTaggedUserIDs([]map[string]interface{}{itemSettings}, resolved)
			if err != nil {
				return err
			}
			itemSettings["tagged_users"] = strings.Join(resolvedIDs, ",")
		}
		rewritten[index] = itemSettings
	}
	req.MediaSettings = rewritten
	return nil
}

// resolvedTaggedUserIDs maps one media item's authored tagged-user entries to
// numeric X user IDs, preserving authored order and keeping numeric entries
// unchanged.
func resolvedTaggedUserIDs(itemSettings []map[string]interface{}, resolved map[string]string) ([]string, error) {
	entries := platform.XTaggedUserEntries(itemSettings)
	ids := make([]string, 0, len(entries))
	for _, entry := range entries {
		if platform.IsXUserID(entry) {
			ids = append(ids, entry)
			continue
		}
		userID, ok := resolved[platform.NormalizeXHandle(entry)]
		if !ok {
			return nil, fmt.Errorf("x tagged user %q could not be resolved to a user ID", entry)
		}
		ids = append(ids, userID)
	}
	return ids, nil
}
