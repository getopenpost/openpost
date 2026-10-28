package engagement

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/openpost/backend/internal/inboxactivity"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/inboxchanges"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/uptrace/bun"
)

// RefreshFromWebhook queues only stored posts belonging to the receiving
// account. A bounded fallback covers provider events that omit a post ID.
func (s *Service) RefreshFromWebhook(ctx context.Context, accountID string, change json.RawMessage) error {
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).Where("id=? AND is_active=?", accountID, true).Scan(ctx); err != nil {
		return err
	}
	if !s.isEngagementEnabled(ctx, account.ID) {
		return nil
	}
	var payload struct {
		Field string `json:"field"`
		Value struct {
			ID     string `json:"id"`
			PostID string `json:"post_id"`
			Media  struct {
				ID string `json:"id"`
			} `json:"media"`
		} `json:"value"`
	}
	if err := json.Unmarshal(change, &payload); err != nil {
		return err
	}
	postID := strings.TrimSpace(payload.Value.PostID)
	if postID == "" {
		postID = payload.Value.Media.ID
	}
	var renditions []models.Rendition
	query := s.db.NewSelect().Model(&renditions).Where("social_account_id=? AND status=? AND external_id<>''", account.ID, models.RenditionStatusPublished).Order("updated_at DESC").Limit(10)
	if postID != "" {
		query = query.Where("external_id=?", postID)
	}
	if err := query.Scan(ctx); err != nil {
		return err
	}
	if len(renditions) == 0 && externalInstagramComment(account, payload.Field, postID, payload.Value.ID) {
		return s.hydrateWebhookComment(ctx, account, postID, payload.Value.ID)
	}

	for _, r := range renditions {
		payload, _ := json.Marshal(subjectJob{ID: r.ID})
		if _, err := s.enqueue(ctx, account.WorkspaceID, JobTypeEngagementSync, string(payload), s.now()); err != nil {
			return err
		}
	}
	return nil
}

// appendEngagementChange is called inside the same mutation transaction.
func appendEngagementChange(ctx context.Context, tx bun.IDB, item models.EngagementItem) error {
	return inboxchanges.Append(ctx, tx, item.WorkspaceID, inboxchanges.Change{Kind: "engagement", EngagementID: item.ID, Deleted: !item.DeletedAt.IsZero()})
}

func externalInstagramComment(account models.SocialAccount, field, postID, commentID string) bool {
	return account.Platform == "instagram" && field == "comments" && postID != "" && commentID != ""
}
func (s *Service) hydrateWebhookComment(ctx context.Context, account models.SocialAccount, postID, commentID string) error {
	reader, ok := s.adapter(account).(platform.InstagramWebhookCommentReader)
	if !ok {
		return nil
	}
	authority, err := s.loadActivityAuthority(ctx, s.db, account.ID)
	if err != nil {
		return err
	}
	token, err := s.tokenSource.GetValidAccessToken(ctx, account.ID)
	if err != nil {
		return err
	}
	comment, permalink, err := reader.ReadWebhookComment(ctx, token, account.AccountID, commentID, postID)
	if err != nil {
		return err
	}
	return s.persistWebhookComment(ctx, account, authority, comment, permalink, postID)
}

func (s *Service) persistWebhookComment(ctx context.Context, account models.SocialAccount, authority activityAuthority, comment platform.Comment, permalink, postID string) error {
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(ctx, tx, account.WorkspaceID); err != nil {
			return err
		}
		current, err := s.loadActivityAuthority(ctx, tx, account.ID)
		if err != nil {
			return err
		}
		if current.Account.OAuthGrantID != authority.Account.OAuthGrantID || !current.GrantConsentedAt.Equal(authority.GrantConsentedAt) || !current.FeatureDecidedAt.Equal(authority.FeatureDecidedAt) || current.Account.GrantedScopes != authority.Account.GrantedScopes {
			return errActivityChanged
		}
		item, isNew, err := persistEngagementComment(ctx, tx, models.Rendition{}, account, comment, s.now())
		if err != nil {
			return err
		}
		if item.ID == "" {
			return nil
		}
		subject := inboxactivity.EngagementSubject{Kind: "comment", RemoteID: postID, URL: safeExternalURL(permalink)}
		raw, err := json.Marshal(subject)
		if err != nil {
			return err
		}
		item.SubjectJSON = string(raw)
		if err := saveEngagementItem(ctx, tx, item); err != nil {
			return err
		}
		if isNew && s.notifications != nil {
			return s.notifyAccountActivity(ctx, tx, account, item)
		}
		return nil
	})
}
