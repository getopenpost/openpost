package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/drafts"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/uptrace/bun"
)

const (
	publicationHistoryLifecycleRank = 3
	publicationHistoryEditRank      = 2
	publicationHistoryCreationRank  = 1
)

type publicationHistoryCursor struct {
	Timestamp time.Time
	Rank      int
	ID        string
}

type publicationHistoryItem struct {
	response PublicationLifecycleEventResponse
	rank     int
	sortID   string
	actorID  string
}

type publicationHistoryAuthorization struct {
	BatchID             string
	ActorUserID         string
	ActorOrigin         string
	ActorClientName     string
	Action              string
	PolicyMode          string
	PublicationRevision int
	ScheduledAt         time.Time
	DestinationCount    int
}

func (h *PublicationHandler) listPublicationHistory(
	ctx context.Context,
	publication *models.Publication,
	limit int,
	cursorValue string,
) ([]PublicationLifecycleEventResponse, string, bool, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	cursor, err := parseOptionalPublicationHistoryCursor(cursorValue)
	if err != nil {
		return nil, "", false, err
	}
	items, err := h.loadPublicationHistoryItems(ctx, publication, limit, cursor)
	if err != nil {
		return nil, "", false, err
	}
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	body := make([]PublicationLifecycleEventResponse, 0, len(items))
	for _, item := range items {
		body = append(body, item.response)
	}
	nextCursor := ""
	if hasMore && len(items) > 0 {
		nextCursor = encodePublicationHistoryCursor(items[len(items)-1])
	}
	return body, nextCursor, hasMore, nil
}

func parseOptionalPublicationHistoryCursor(value string) (*publicationHistoryCursor, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}
	parsed, err := parsePublicationHistoryCursor(value)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func (h *PublicationHandler) loadPublicationHistoryItems(
	ctx context.Context,
	publication *models.Publication,
	limit int,
	cursor *publicationHistoryCursor,
) ([]publicationHistoryItem, error) {
	lifecycleItems, err := h.loadLifecycleHistoryItems(ctx, publication, limit+1, cursor)
	if err != nil {
		return nil, err
	}
	editItems, err := h.loadEditHistoryItems(ctx, publication, limit+1, cursor)
	if err != nil {
		return nil, err
	}
	items := make([]publicationHistoryItem, 0, len(lifecycleItems)+len(editItems)+1)
	items = append(items, lifecycleItems...)
	items = append(items, editItems...)
	created := publicationCreationHistoryItem(publication)
	if historyItemIsAfterCursor(created, cursor) {
		items = append(items, created)
	}
	actorNames, err := h.loadPublicationHistoryActorNames(ctx, items)
	if err != nil {
		return nil, err
	}
	for index := range items {
		if name := actorNames[items[index].actorID]; items[index].response.Actor.Kind == "user" && name != "" {
			items[index].response.Actor.Name = name
		}
	}
	sort.Slice(items, func(left, right int) bool {
		return publicationHistoryItemBefore(items[left], items[right])
	})
	return items, nil
}

func publicationCreationHistoryItem(publication *models.Publication) publicationHistoryItem {
	return publicationHistoryItem{
		response: PublicationLifecycleEventResponse{
			ID:            "created:" + publication.ID,
			WorkspaceID:   publication.WorkspaceID,
			PublicationID: publication.ID,
			Type:          "created",
			Status:        lifecycle.StatusSucceeded,
			Summary:       "Publication created",
			Actor:         PublicationLifecycleActor{Kind: "user"},
			Revision:      1,
			CreatedAt:     publication.CreatedAt.UTC().Format(time.RFC3339Nano),
		},
		rank:    publicationHistoryCreationRank,
		sortID:  publication.ID,
		actorID: publication.CreatedByID,
	}
}

func (h *PublicationHandler) loadLifecycleHistoryItems(
	ctx context.Context,
	publication *models.Publication,
	limit int,
	cursor *publicationHistoryCursor,
) ([]publicationHistoryItem, error) {
	var events []models.PublicationLifecycleEvent
	query := h.db.NewSelect().
		Model(&events).
		Where("workspace_id = ?", publication.WorkspaceID).
		Where("publication_id = ?", publication.ID).
		Order("created_at DESC", "id DESC").
		Limit(limit)
	query = applyStringPublicationHistoryCursor(
		query,
		"created_at",
		"id",
		publicationHistoryLifecycleRank,
		cursor,
	)
	if err := query.Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) || isMissingPublicationHistoryTable(err) {
			return nil, nil
		}
		return nil, err
	}
	authorizations, err := h.loadHistoryAuthorizations(ctx, events)
	if err != nil {
		return nil, err
	}
	renditions, err := h.loadHistoryRenditions(ctx, events)
	if err != nil {
		return nil, err
	}
	items := make([]publicationHistoryItem, 0, len(events))
	for _, event := range events {
		metadata := publicationHistoryMetadata(event.MetadataJSON)
		authorization := authorizations[historyMetadataString(metadata, "authorization_batch_id")]
		response := sanitizedLifecycleEvent(event, metadata, authorization, renditions[event.RenditionID])
		items = append(items, publicationHistoryItem{
			response: response,
			rank:     publicationHistoryLifecycleRank,
			sortID:   event.ID,
			actorID:  authorization.ActorUserID,
		})
	}
	return items, nil
}

func (h *PublicationHandler) loadEditHistoryItems(
	ctx context.Context,
	publication *models.Publication,
	limit int,
	cursor *publicationHistoryCursor,
) ([]publicationHistoryItem, error) {
	var changes []models.DraftRevisionChange
	query := h.db.NewSelect().
		Model(&changes).
		Where("aggregate_type = ?", drafts.AggregatePublication).
		Where("aggregate_id = ?", publication.ID).
		Order("created_at DESC", "revision DESC").
		Limit(limit)
	query = applyRevisionPublicationHistoryCursor(query, publicationHistoryEditRank, cursor)
	if err := query.Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) || isMissingPublicationHistoryTable(err) {
			return nil, nil
		}
		return nil, err
	}
	items := make([]publicationHistoryItem, 0, len(changes))
	for _, change := range changes {
		var domains []string
		_ = json.Unmarshal([]byte(change.ChangedDomains), &domains)
		domains = drafts.UniqueDomains(domains)
		eventType, summary := "edited", "Publication updated"
		if len(domains) == 1 && domains[0] == "schedule" {
			eventType, summary = "schedule_changed", "Schedule updated"
		}
		items = append(items, publicationHistoryItem{
			response: PublicationLifecycleEventResponse{
				ID:             fmt.Sprintf("edit:%s:%d", publication.ID, change.Revision),
				WorkspaceID:    publication.WorkspaceID,
				PublicationID:  publication.ID,
				Type:           eventType,
				Status:         lifecycle.StatusSucceeded,
				Summary:        summary,
				Actor:          PublicationLifecycleActor{Kind: "user"},
				ChangedDomains: domains,
				Revision:       change.Revision,
				CreatedAt:      change.CreatedAt.UTC().Format(time.RFC3339Nano),
			},
			rank:    publicationHistoryEditRank,
			sortID:  strconv.Itoa(change.Revision),
			actorID: change.ChangedBy,
		})
	}
	return items, nil
}

func sanitizedLifecycleEvent(
	event models.PublicationLifecycleEvent,
	metadata map[string]any,
	authorization publicationHistoryAuthorization,
	rendition models.Rendition,
) PublicationLifecycleEventResponse {
	eventType := strings.TrimSpace(event.Type)
	status := normalizedLifecycleStatus(event.Status)
	actor := PublicationLifecycleActor{Kind: "system"}
	if eventType == lifecycle.EventAuthorizationConfirmed {
		actor.Origin = publicationFirstNonEmpty(authorization.ActorOrigin, historyMetadataString(metadata, "actor_origin"))
		actor.Name = authorization.ActorClientName
		if authorization.ActorUserID != "" && (actor.Origin == "browser" || actor.Origin == "legacy") {
			actor.Kind = "user"
		} else {
			actor.Kind = "automation"
		}
	}
	response := PublicationLifecycleEventResponse{
		ID:            event.ID,
		WorkspaceID:   event.WorkspaceID,
		PublicationID: event.PublicationID,
		RenditionID:   event.RenditionID,
		Type:          eventType,
		Status:        status,
		Summary:       lifecycleSummary(eventType, authorization.PolicyMode),
		Actor:         actor,
		Platform: publicationFirstNonEmpty(
			historyMetadataString(metadata, "platform"),
			historyMetadataString(metadata, "provider"),
		),
		Revision:         authorizationRevision(authorization, metadata),
		DestinationCount: authorizationDestinationCount(authorization, metadata),
		CreatedAt:        event.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
	if !authorization.ScheduledAt.IsZero() {
		response.ScheduledAt = authorization.ScheduledAt.UTC().Format(time.RFC3339Nano)
	}
	if eventType == lifecycle.EventFailed || status == lifecycle.StatusFailed {
		response.Error = &PublicationLifecycleError{
			Message:    safeCurrentRenditionError(rendition),
			Kind:       historyMetadataString(metadata, "error_kind"),
			Code:       historyMetadataString(metadata, "error_code"),
			HTTPStatus: historyMetadataInt(metadata, "http_status"),
			Retryable:  historyMetadataBool(metadata, "retryable"),
			Action:     rendition.ErrorAction,
		}
	}
	return response
}

// publicationLifecycleEventResponse keeps non-HTTP consumers on the same
// permission-safe representation. The HTTP history path enriches actors and
// current rendition errors when those records are available.
func publicationLifecycleEventResponse(event models.PublicationLifecycleEvent) PublicationLifecycleEventResponse {
	return sanitizedLifecycleEvent(
		event,
		publicationHistoryMetadata(event.MetadataJSON),
		publicationHistoryAuthorization{},
		models.Rendition{},
	)
}

func lifecycleSummary(eventType, policyMode string) string {
	switch eventType {
	case lifecycle.EventUploadStarted:
		return "Media upload started"
	case lifecycle.EventUploadResumed:
		return "Media upload resumed"
	case lifecycle.EventProviderProcessing:
		return "Provider delivery started"
	case lifecycle.EventPublished:
		return "Published to provider"
	case lifecycle.EventFailed:
		return "Provider delivery failed"
	case lifecycle.EventRetried:
		return "Delivery retry started"
	case lifecycle.EventAuthorizationConfirmed:
		switch policyMode {
		case "scheduled", "legacy_scheduled":
			return "Schedule confirmed"
		case "retry":
			return "Retry confirmed"
		default:
			return "Publish action confirmed"
		}
	case lifecycle.EventCommentActionSucceeded:
		return "Comment action completed"
	case lifecycle.EventModerationActionFailed:
		return "Comment action failed"
	case "repost":
		return "Repost activity"
	case "archived":
		return "Publication archived"
	case "deleted":
		return "Publication deleted"
	default:
		return "Publication activity"
	}
}

func normalizedLifecycleStatus(status string) string {
	switch status {
	case lifecycle.StatusStarted, lifecycle.StatusSucceeded, lifecycle.StatusFailed:
		return status
	default:
		return lifecycle.StatusInfo
	}
}

func (h *PublicationHandler) loadHistoryAuthorizations(
	ctx context.Context,
	events []models.PublicationLifecycleEvent,
) (map[string]publicationHistoryAuthorization, error) {
	batchIDs := make([]string, 0)
	for _, event := range events {
		if event.Type != lifecycle.EventAuthorizationConfirmed {
			continue
		}
		metadata := publicationHistoryMetadata(event.MetadataJSON)
		if batchID := historyMetadataString(metadata, "authorization_batch_id"); batchID != "" {
			batchIDs = append(batchIDs, batchID)
		}
	}
	batchIDs = uniqueNonEmpty(batchIDs)
	if len(batchIDs) == 0 {
		return map[string]publicationHistoryAuthorization{}, nil
	}
	var rows []struct {
		BatchID             string    `bun:"batch_id"`
		ActorUserID         string    `bun:"actor_user_id"`
		ActorOrigin         string    `bun:"actor_origin"`
		ActorClientName     string    `bun:"actor_client_name"`
		Action              string    `bun:"action"`
		PolicyMode          string    `bun:"policy_mode"`
		PublicationRevision int       `bun:"publication_revision"`
		ScheduledAt         time.Time `bun:"scheduled_at"`
		DestinationCount    int       `bun:"destination_count"`
	}
	err := h.db.NewSelect().
		TableExpr("publication_authorizations AS authorization").
		ColumnExpr("authorization.batch_id").
		ColumnExpr("MIN(authorization.actor_user_id) AS actor_user_id").
		ColumnExpr("MIN(authorization.actor_origin) AS actor_origin").
		ColumnExpr("MIN(authorization.actor_client_name) AS actor_client_name").
		ColumnExpr("MIN(authorization.action) AS action").
		ColumnExpr("MIN(authorization.policy_mode) AS policy_mode").
		ColumnExpr("MAX(authorization.publication_revision) AS publication_revision").
		ColumnExpr("MIN(authorization.scheduled_at) AS scheduled_at").
		ColumnExpr("COUNT(*) AS destination_count").
		Where("authorization.batch_id IN (?)", bun.List(batchIDs)).
		Group("authorization.batch_id").
		Scan(ctx, &rows)
	if err != nil {
		if isMissingPublicationHistoryTable(err) {
			return map[string]publicationHistoryAuthorization{}, nil
		}
		return nil, err
	}
	out := make(map[string]publicationHistoryAuthorization, len(rows))
	for _, row := range rows {
		out[row.BatchID] = publicationHistoryAuthorization{
			BatchID: row.BatchID, ActorUserID: row.ActorUserID, ActorOrigin: row.ActorOrigin,
			ActorClientName: row.ActorClientName, Action: row.Action, PolicyMode: row.PolicyMode,
			PublicationRevision: row.PublicationRevision, ScheduledAt: row.ScheduledAt,
			DestinationCount: row.DestinationCount,
		}
	}
	return out, nil
}

func (h *PublicationHandler) loadHistoryRenditions(
	ctx context.Context,
	events []models.PublicationLifecycleEvent,
) (map[string]models.Rendition, error) {
	ids := make([]string, 0, len(events))
	for _, event := range events {
		if event.RenditionID != "" {
			ids = append(ids, event.RenditionID)
		}
	}
	ids = uniqueNonEmpty(ids)
	if len(ids) == 0 {
		return map[string]models.Rendition{}, nil
	}
	var rows []models.Rendition
	if err := h.db.NewSelect().Model(&rows).Where("id IN (?)", bun.List(ids)).Scan(ctx); err != nil {
		if isMissingPublicationHistoryTable(err) {
			return map[string]models.Rendition{}, nil
		}
		return nil, err
	}
	out := make(map[string]models.Rendition, len(rows))
	for _, row := range rows {
		out[row.ID] = row
	}
	return out, nil
}

func (h *PublicationHandler) loadPublicationHistoryActorNames(
	ctx context.Context,
	items []publicationHistoryItem,
) (map[string]string, error) {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		if item.actorID != "" {
			ids = append(ids, item.actorID)
		}
	}
	ids = uniqueNonEmpty(ids)
	if len(ids) == 0 {
		return map[string]string{}, nil
	}
	var users []models.User
	if err := h.db.NewSelect().Model(&users).Where("id IN (?)", bun.List(ids)).Scan(ctx); err != nil {
		if isMissingPublicationHistoryTable(err) {
			return map[string]string{}, nil
		}
		return nil, err
	}
	out := make(map[string]string, len(users))
	for _, user := range users {
		out[user.ID] = publicationFirstNonEmpty(strings.TrimSpace(user.DisplayName), strings.TrimSpace(user.Username))
	}
	return out, nil
}

func publicationHistoryMetadata(value string) map[string]any {
	metadata := map[string]any{}
	_ = json.Unmarshal([]byte(value), &metadata)
	return metadata
}

func historyMetadataString(metadata map[string]any, key string) string {
	value, _ := metadata[key].(string)
	return strings.TrimSpace(value)
}

func historyMetadataBool(metadata map[string]any, key string) bool {
	value, _ := metadata[key].(bool)
	return value
}

func historyMetadataInt(metadata map[string]any, key string) int {
	switch value := metadata[key].(type) {
	case float64:
		return int(value)
	case int:
		return value
	default:
		return 0
	}
}

func authorizationRevision(authorization publicationHistoryAuthorization, metadata map[string]any) int {
	if authorization.PublicationRevision > 0 {
		return authorization.PublicationRevision
	}
	if revision := historyMetadataInt(metadata, "publication_revision"); revision > 0 {
		return revision
	}
	return 0
}

func authorizationDestinationCount(authorization publicationHistoryAuthorization, metadata map[string]any) int {
	if authorization.DestinationCount > 0 {
		return authorization.DestinationCount
	}
	return historyMetadataInt(metadata, "destination_count")
}

func safeCurrentRenditionError(rendition models.Rendition) string {
	if rendition.Status != models.RenditionStatusFailed {
		return ""
	}
	return strings.TrimSpace(rendition.ErrorMessage)
}

func applyStringPublicationHistoryCursor(
	query *bun.SelectQuery,
	timestampColumn string,
	idColumn string,
	rank int,
	cursor *publicationHistoryCursor,
) *bun.SelectQuery {
	if cursor == nil {
		return query
	}
	switch {
	case rank > cursor.Rank:
		return query.Where(timestampColumn+" < ?", cursor.Timestamp)
	case rank < cursor.Rank:
		return query.Where(timestampColumn+" <= ?", cursor.Timestamp)
	default:
		return query.Where(
			"("+timestampColumn+" < ? OR ("+timestampColumn+" = ? AND "+idColumn+" < ?))",
			cursor.Timestamp,
			cursor.Timestamp,
			cursor.ID,
		)
	}
}

func applyRevisionPublicationHistoryCursor(
	query *bun.SelectQuery,
	rank int,
	cursor *publicationHistoryCursor,
) *bun.SelectQuery {
	if cursor == nil {
		return query
	}
	switch {
	case rank > cursor.Rank:
		return query.Where("created_at < ?", cursor.Timestamp)
	case rank < cursor.Rank:
		return query.Where("created_at <= ?", cursor.Timestamp)
	default:
		revision, err := strconv.Atoi(cursor.ID)
		if err != nil {
			return query.Where("created_at < ?", cursor.Timestamp)
		}
		return query.Where(
			"(created_at < ? OR (created_at = ? AND revision < ?))",
			cursor.Timestamp,
			cursor.Timestamp,
			revision,
		)
	}
}

func historyItemIsAfterCursor(item publicationHistoryItem, cursor *publicationHistoryCursor) bool {
	if cursor == nil {
		return true
	}
	createdAt, err := time.Parse(time.RFC3339Nano, item.response.CreatedAt)
	if err != nil {
		return false
	}
	if createdAt.Before(cursor.Timestamp) {
		return true
	}
	if createdAt.After(cursor.Timestamp) {
		return false
	}
	if item.rank != cursor.Rank {
		return item.rank < cursor.Rank
	}
	if item.rank == publicationHistoryEditRank {
		itemRevision, _ := strconv.Atoi(item.sortID)
		cursorRevision, _ := strconv.Atoi(cursor.ID)
		return itemRevision < cursorRevision
	}
	return item.sortID < cursor.ID
}

func publicationHistoryItemBefore(left, right publicationHistoryItem) bool {
	leftTime, _ := time.Parse(time.RFC3339Nano, left.response.CreatedAt)
	rightTime, _ := time.Parse(time.RFC3339Nano, right.response.CreatedAt)
	if !leftTime.Equal(rightTime) {
		return leftTime.After(rightTime)
	}
	if left.rank != right.rank {
		return left.rank > right.rank
	}
	if left.rank == publicationHistoryEditRank {
		leftRevision, _ := strconv.Atoi(left.sortID)
		rightRevision, _ := strconv.Atoi(right.sortID)
		return leftRevision > rightRevision
	}
	return left.sortID > right.sortID
}

func encodePublicationHistoryCursor(item publicationHistoryItem) string {
	return item.response.CreatedAt + "|" + strconv.Itoa(item.rank) + "|" + item.sortID
}

func parsePublicationHistoryCursor(value string) (publicationHistoryCursor, error) {
	parts := strings.SplitN(strings.TrimSpace(value), "|", 3)
	if len(parts) != 3 || parts[2] == "" {
		return publicationHistoryCursor{}, errInvalidHistoryCursor
	}
	timestamp, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return publicationHistoryCursor{}, errInvalidHistoryCursor
	}
	rank, err := strconv.Atoi(parts[1])
	if err != nil || rank < publicationHistoryCreationRank || rank > publicationHistoryLifecycleRank {
		return publicationHistoryCursor{}, errInvalidHistoryCursor
	}
	return publicationHistoryCursor{Timestamp: timestamp.UTC(), Rank: rank, ID: parts[2]}, nil
}

func isMissingPublicationHistoryTable(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such table") || strings.Contains(message, "does not exist")
}
