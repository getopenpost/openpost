package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

const (
	editorRevisionUnknownActor = "Workspace member"
	editorMediaQueryChunkSize  = 200
	editorRevisionDefaultLimit = 50
)

type editorRevisionCursor struct {
	CreatedAt time.Time
	ID        string
}

type editorRevisionCursorPayload struct {
	CreatedAt string `json:"created_at"`
	ID        string `json:"id"`
}

func encodeEditorRevisionCursor(createdAt time.Time, id string) string {
	payload, _ := json.Marshal(editorRevisionCursorPayload{
		CreatedAt: createdAt.UTC().Format(time.RFC3339Nano),
		ID:        id,
	})
	return base64.RawURLEncoding.EncodeToString(payload)
}

func decodeEditorRevisionCursor(value string) (editorRevisionCursor, error) {
	if strings.TrimSpace(value) == "" {
		return editorRevisionCursor{}, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil || len(decoded) > 512 {
		return editorRevisionCursor{}, errors.New("invalid editor revision cursor")
	}
	var payload editorRevisionCursorPayload
	if err := json.Unmarshal(decoded, &payload); err != nil || strings.TrimSpace(payload.ID) == "" {
		return editorRevisionCursor{}, errors.New("invalid editor revision cursor")
	}
	createdAt, err := time.Parse(time.RFC3339Nano, payload.CreatedAt)
	if err != nil {
		return editorRevisionCursor{}, errors.New("invalid editor revision cursor")
	}
	return editorRevisionCursor{CreatedAt: createdAt.UTC(), ID: payload.ID}, nil
}

func editorRevisionLimit(value int) int {
	if value <= 0 {
		return editorRevisionDefaultLimit
	}
	return min(value, 100)
}

// EditorRevisionActor is deliberately privacy-limited. Revision history needs
// enough identity to explain who changed a shared document without exposing a
// user ID, email address, or profile details.
type EditorRevisionActor struct {
	Name          string `json:"name"`
	IsCurrentUser bool   `json:"is_current_user"`
}

// reviveEditorMediaReferences restores media that is still durable but has
// entered Trash. Callers must validate ownership and processing state first,
// and must call this inside the same transaction as the editor-head CAS.
func reviveEditorMediaReferences(
	ctx context.Context,
	tx bun.Tx,
	workspaceID string,
	mediaIDs []string,
	now time.Time,
) error {
	set := make(map[string]struct{}, len(mediaIDs))
	for _, mediaID := range mediaIDs {
		if mediaID = strings.TrimSpace(mediaID); mediaID != "" {
			set[mediaID] = struct{}{}
		}
	}
	ids := make([]string, 0, len(set))
	for mediaID := range set {
		ids = append(ids, mediaID)
	}
	for start := 0; start < len(ids); start += editorMediaQueryChunkSize {
		end := min(start+editorMediaQueryChunkSize, len(ids))
		if _, err := tx.NewUpdate().Model((*models.MediaAttachment)(nil)).
			Set("trashed_at = NULL").
			Set("purge_after = NULL").
			Set("trash_reason = ''").
			Set("last_used_at = ?", now).
			Where("workspace_id = ?", workspaceID).
			Where("id IN (?)", bun.List(ids[start:end])).
			Where("trashed_at IS NOT NULL").
			Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func loadEditorRevisionActors(
	ctx context.Context,
	db bun.IDB,
	userIDs []string,
	currentUserID string,
) (map[string]EditorRevisionActor, error) {
	uniqueIDs := make(map[string]struct{}, len(userIDs))
	for _, userID := range userIDs {
		uniqueIDs[userID] = struct{}{}
	}
	actors := make(map[string]EditorRevisionActor, len(uniqueIDs))
	for userID := range uniqueIDs {
		actors[userID] = EditorRevisionActor{
			Name:          editorRevisionUnknownActor,
			IsCurrentUser: userID != "" && userID == currentUserID,
		}
	}
	if len(uniqueIDs) == 0 {
		return actors, nil
	}

	ids := make([]string, 0, len(uniqueIDs))
	for userID := range uniqueIDs {
		if userID != "" {
			ids = append(ids, userID)
		}
	}
	if len(ids) == 0 {
		return actors, nil
	}

	var users []models.User
	if err := db.NewSelect().Model(&users).
		Column("id", "display_name").
		Where("id IN (?)", bun.List(ids)).
		Scan(ctx); err != nil {
		return nil, err
	}
	for _, user := range users {
		actor := actors[user.ID]
		if name := strings.TrimSpace(user.DisplayName); name != "" {
			actor.Name = name
		}
		actors[user.ID] = actor
	}
	return actors, nil
}

func editorRevisionActor(
	actors map[string]EditorRevisionActor,
	userID string,
	currentUserID string,
) EditorRevisionActor {
	if actor, ok := actors[userID]; ok {
		return actor
	}
	return EditorRevisionActor{
		Name:          editorRevisionUnknownActor,
		IsCurrentUser: userID != "" && userID == currentUserID,
	}
}

func allEditorMediaBelongToWorkspace(
	ctx context.Context,
	db bun.IDB,
	workspaceID string,
	mediaIDs []string,
	requiredProcessingStatus string,
) (bool, error) {
	set := make(map[string]struct{}, len(mediaIDs))
	for _, mediaID := range mediaIDs {
		if mediaID = strings.TrimSpace(mediaID); mediaID != "" {
			set[mediaID] = struct{}{}
		}
	}
	ids := make([]string, 0, len(set))
	for mediaID := range set {
		ids = append(ids, mediaID)
	}
	for start := 0; start < len(ids); start += editorMediaQueryChunkSize {
		end := min(start+editorMediaQueryChunkSize, len(ids))
		query := db.NewSelect().Model((*models.MediaAttachment)(nil)).
			Where("workspace_id = ?", workspaceID).
			Where("id IN (?)", bun.List(ids[start:end]))
		if requiredProcessingStatus != "" {
			query = query.Where("processing_status = ?", requiredProcessingStatus)
		}
		count, err := query.Count(ctx)
		if err != nil {
			return false, err
		}
		if count != end-start {
			return false, nil
		}
	}
	return true, nil
}
