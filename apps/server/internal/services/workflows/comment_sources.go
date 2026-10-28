package workflows

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"time"
	"unicode"

	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

// Read canonical Inbox inventory. Provider discovery and retries stay in the
// engagement collector; opening or polling a workflow never fetches comments.
func (s *Service) commentItems(ctx context.Context, workspaceID string, source Source, since time.Time, record *workflowRecord) ([]SourceItem, error) {
	var rows []models.EngagementItem
	query := s.db.NewSelect().Model(&rows).Where("workspace_id = ? AND kind = ? AND is_ours = ? AND deleted_at IS NULL AND hidden = ?", workspaceID, "comment", false, false).
		Where("social_account_id IN (?)", bun.List(source.AccountIDs)).Where("remote_created_at >= ?", since).
		Where("created_at >= ?", since).Where("NOT EXISTS (SELECT 1 FROM engagement_automation_optouts o WHERE o.social_account_id = engagement_item.social_account_id AND o.author_remote_id = engagement_item.author_remote_id)").Limit(maxSourceItems)
	if record == nil {
		query = query.Order("created_at DESC", "id DESC")
	} else {
		query = query.Order("created_at ASC", "id ASC")
	}
	if len(source.RenditionIDs) > 0 || len(source.PostIDs) > 0 {
		query = query.WhereGroup(" AND ", func(q *bun.SelectQuery) *bun.SelectQuery {
			if len(source.RenditionIDs) > 0 {
				q = q.WhereOr("rendition_id IN (?)", bun.List(source.RenditionIDs))
			}
			if len(source.PostIDs) > 0 {
				q = q.WhereOr("conversation_remote_id IN (?) OR rendition_id IN (SELECT id FROM renditions WHERE external_id IN (?))", bun.List(source.PostIDs), bun.List(source.PostIDs))
			}
			return q
		})
	}
	if source.TopLevelOnly {
		query = query.Where("parent_remote_id = ''")
	}
	if record != nil {
		query = query.Where("NOT EXISTS (SELECT 1 FROM workflow_events e WHERE e.workflow_id = ? AND e.source_fingerprint = ? AND e.event_key = engagement_item.id)", record.ID, record.SourceFingerprint)
	}
	if err := query.Scan(ctx); err != nil {
		return nil, err
	}
	items := make([]SourceItem, 0, len(rows))
	for _, row := range rows {
		excluded := !commentKeywordMatches(row.Body, source.Keywords, source.MatchMode) || (len(source.ExcludedKeywords) > 0 && commentKeywordMatches(row.Body, source.ExcludedKeywords, source.MatchMode))
		if excluded && record == nil {
			continue
		}
		items = append(items, SourceItem{Excluded: excluded, ID: row.ID, EngagementID: row.ID, AccountID: row.SocialAccountID, RenditionID: row.RenditionID, Body: row.Body, Title: row.AuthorName, AuthorName: row.AuthorName, Platform: row.Platform, CreatedAt: row.RemoteCreatedAt.UTC().Format(time.RFC3339)})
	}
	if record != nil {
		slices.Reverse(items)
	}
	return items, nil
}
func commentKeywordMatches(body string, keywords []string, mode string) bool {
	if len(keywords) == 0 {
		return true
	}
	body = strings.ToLower(strings.TrimSpace(body))
	for _, keyword := range keywords {
		keyword = strings.ToLower(strings.TrimSpace(keyword))
		if keyword == "" {
			continue
		}
		switch mode {
		case "exact":
			if body == keyword {
				return true
			}
		case "contains":
			if strings.Contains(body, keyword) {
				return true
			}
		default:
			if commentPhraseMatches(body, keyword) {
				return true
			}
		}
	}
	return false
}

// Resolve overlap before admitting work, so queue timing never decides which
// campaign answers. Explicit priority wins; equal priority uses older rules.
func (s *Service) commentWorkflowWins(ctx context.Context, db bun.IDB, current workflowRecord, itemID string) (bool, error) {
	var item models.EngagementItem
	if err := db.NewSelect().Model(&item).Where("id = ? AND workspace_id = ?", itemID, current.WorkspaceID).Scan(ctx); err != nil {
		return false, err
	}
	var candidates []workflowRecord
	if err := db.NewSelect().Model(&candidates).Where("workspace_id = ? AND enabled = ?", current.WorkspaceID, true).Order("created_at ASC", "id ASC").Limit(maxWorkflows).Scan(ctx); err != nil {
		return false, err
	}
	var own Definition
	if err := json.Unmarshal([]byte(current.PublishedJSON), &own); err != nil {
		return false, err
	}
	if !commentResponseSteps(own.Steps) {
		return true, nil
	}
	winner := ""
	priority := 101
	for _, candidate := range candidates {
		var def Definition
		if err := json.Unmarshal([]byte(candidate.PublishedJSON), &def); err != nil {
			return false, err
		}
		source := def.Source
		if !commentResponseSteps(def.Steps) {
			continue
		}
		matches, err := commentCandidateMatches(ctx, db, candidate, source, item)
		if err != nil {
			return false, err
		}
		if !matches {
			continue
		}

		p := source.Priority
		if p == 0 {
			p = 50
		}
		if p < priority {
			winner = candidate.ID
			priority = p
		}
	}
	return winner == current.ID, nil
}

func commentResponseSteps(steps []Step) bool {
	for _, step := range steps {
		if step.Kind == KindCommentReply || step.Kind == KindPrivateReply || step.Kind == KindCommentHandoff || commentResponseSteps(step.Then) || commentResponseSteps(step.Else) {
			return true
		}
	}
	return false
}

func commentPhraseMatches(body, keyword string) bool {
	words := strings.FieldsFunc(body, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsNumber(r) && r != '_' })
	phrase := strings.FieldsFunc(keyword, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsNumber(r) && r != '_' })
	if len(phrase) == 0 && strings.Contains(body, keyword) {
		return true
	}
	if len(phrase) > 0 && strings.Contains(" "+strings.Join(words, " ")+" ", " "+strings.Join(phrase, " ")+" ") {
		return true
	}
	return false
}

func commentCandidateMatches(ctx context.Context, db bun.IDB, candidate workflowRecord, source Source, item models.EngagementItem) (bool, error) {
	if source.Kind != "comment_received" || !slices.Contains(source.AccountIDs, item.SocialAccountID) || candidate.SourceStartedAt == nil || item.RemoteCreatedAt.Before(*candidate.SourceStartedAt) || item.CreatedAt.Before(*candidate.SourceStartedAt) {
		return false, nil
	}
	if source.TopLevelOnly && item.ParentRemoteID != "" {
		return false, nil
	}
	if matches, err := commentPostMatches(ctx, db, source, item); err != nil || !matches {
		return false, err
	}

	if !commentKeywordMatches(item.Body, source.Keywords, source.MatchMode) || (len(source.ExcludedKeywords) > 0 && commentKeywordMatches(item.Body, source.ExcludedKeywords, source.MatchMode)) {
		return false, nil
	}
	return true, nil
}

func commentPostMatches(ctx context.Context, db bun.IDB, source Source, item models.EngagementItem) (bool, error) {
	if len(source.RenditionIDs) == 0 && len(source.PostIDs) == 0 {
		return true, nil
	}

	match := slices.Contains(source.RenditionIDs, item.RenditionID) || slices.Contains(source.PostIDs, item.ConversationRemoteID)
	if !match && item.RenditionID != "" {
		var rendition models.Rendition
		if err := db.NewSelect().Model(&rendition).Where("id = ?", item.RenditionID).Scan(ctx); err != nil {
			return false, err
		}
		match = slices.Contains(source.PostIDs, rendition.ExternalID)
	}

	return match, nil
}
