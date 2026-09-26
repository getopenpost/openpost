package postimport

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/openpost/backend/internal/jobregistry"
)

type syncPayload struct {
	WorkspaceID     string `json:"workspace_id"`
	SocialAccountID string `json:"social_account_id"`
}

// HandleJob routes durable post-import jobs. Each execution runs one bounded
// cycle; the stored cursor resumes the next cycle, so an interrupted job
// never duplicates committed pages.
func (s *Service) HandleJob(ctx context.Context, jobType, payload string) error {
	switch jobType {
	case jobregistry.TypePostImportSync:
		var input syncPayload
		if err := json.Unmarshal([]byte(payload), &input); err != nil {
			return fmt.Errorf("decode post import sync payload: %w", err)
		}
		input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
		input.SocialAccountID = strings.TrimSpace(input.SocialAccountID)
		if input.WorkspaceID == "" || input.SocialAccountID == "" {
			return fmt.Errorf("workspace_id and social_account_id are required for post import sync")
		}
		return s.SyncAccount(ctx, input.WorkspaceID, input.SocialAccountID)
	default:
		return fmt.Errorf("unsupported post import job type %q", jobType)
	}
}
