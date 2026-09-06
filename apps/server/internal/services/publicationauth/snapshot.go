package publicationauth

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/providerpolicy"
	"github.com/uptrace/bun"
)

const hashPrefix = "sha256:"

type Snapshot struct {
	WorkspaceID         string
	PublicationRevision int
	SocialAccountID     string
	TargetKey           string
	ContentHash         string
	MediaHash           string
	SettingsHash        string
	ProviderPolicyMode  string
}

type contentFingerprint struct {
	Version       int                         `json:"version"`
	Profile       string                      `json:"profile"`
	OutputProfile string                      `json:"output_profile"`
	Segments      []contentSegmentFingerprint `json:"segments"`
}

type contentSegmentFingerprint struct {
	Position    int    `json:"position"`
	Body        string `json:"body"`
	Title       string `json:"title"`
	Description string `json:"description"`
	URL         string `json:"url"`
}

type settingsFingerprint struct {
	Version     int                   `json:"version"`
	Destination json.RawMessage       `json:"destination"`
	Segments    []segmentSettingsHash `json:"segments"`
}

type segmentSettingsHash struct {
	Position int             `json:"position"`
	Settings json.RawMessage `json:"settings"`
}

type mediaFingerprint struct {
	Version int                    `json:"version"`
	Items   []mediaItemFingerprint `json:"items"`
}

type mediaItemFingerprint struct {
	SegmentPosition      int             `json:"segment_position"`
	DisplayOrder         int             `json:"display_order"`
	Role                 string          `json:"role"`
	MediaID              string          `json:"media_id"`
	FileHash             string          `json:"file_hash"`
	MimeType             string          `json:"mime_type"`
	Size                 int64           `json:"size"`
	OriginalFilename     string          `json:"original_filename"`
	AltText              string          `json:"alt_text"`
	ThumbnailTimestampMS int             `json:"thumbnail_timestamp_ms"`
	Settings             json.RawMessage `json:"settings"`
}

type renditionMediaRow struct {
	DisplayOrder         int    `bun:"display_order"`
	Role                 string `bun:"role"`
	AltText              string `bun:"alt_text"`
	ThumbnailTimestampMS int    `bun:"thumbnail_timestamp_ms"`
	SettingsJSON         string `bun:"settings_json"`
	MediaID              string `bun:"media_id"`
	FileHash             string `bun:"file_hash"`
	MimeType             string `bun:"mime_type"`
	Size                 int64  `bun:"size"`
	OriginalFilename     string `bun:"original_filename"`
	DefaultAltText       string `bun:"default_alt_text"`
}

func SnapshotForRendition(ctx context.Context, db bun.IDB, publicationID, renditionID string) (Snapshot, error) {
	var publication models.Publication
	if err := db.NewSelect().Model(&publication).Where("id = ?", publicationID).Scan(ctx); err != nil {
		return Snapshot{}, fmt.Errorf("load authorization publication: %w", err)
	}
	var rendition models.Rendition
	if err := db.NewSelect().Model(&rendition).
		Where("id = ? AND publication_id = ?", renditionID, publication.ID).
		Scan(ctx); err != nil {
		return Snapshot{}, fmt.Errorf("load authorization rendition: %w", err)
	}
	var account models.SocialAccount
	if err := db.NewSelect().Model(&account).
		Where("id = ? AND workspace_id = ?", rendition.SocialAccountID, publication.WorkspaceID).
		Scan(ctx); err != nil {
		return Snapshot{}, fmt.Errorf("load authorization account: %w", err)
	}

	content, settings, media, err := renditionFingerprintParts(ctx, db, publication, rendition)
	if err != nil {
		return Snapshot{}, err
	}
	contentHash, err := hashCanonical("publication-content-v1", content)
	if err != nil {
		return Snapshot{}, err
	}
	settingsHash, err := hashCanonical("publication-settings-v1", settings)
	if err != nil {
		return Snapshot{}, err
	}
	mediaHash, err := hashCanonical("publication-media-v1", media)
	if err != nil {
		return Snapshot{}, err
	}
	capability, found := capabilities.FindOutput(account.Platform, rendition.OutputProfile)
	if !found {
		capability, found = capabilities.Find(account.Platform, rendition.Profile)
	}
	if !found {
		capability = capabilities.Capability{
			Provider: account.Platform, Profile: rendition.Profile, OutputProfile: rendition.OutputProfile,
		}
	}
	settingsMap := map[string]any{}
	if err := json.Unmarshal([]byte(rendition.SettingsJSON), &settingsMap); err != nil {
		return Snapshot{}, fmt.Errorf("decode provider policy settings: %w", err)
	}
	return Snapshot{
		WorkspaceID:         publication.WorkspaceID,
		PublicationRevision: publication.Revision,
		SocialAccountID:     rendition.SocialAccountID,
		TargetKey:           RenditionTargetKey(rendition, account),
		ContentHash:         contentHash,
		MediaHash:           mediaHash,
		SettingsHash:        settingsHash,
		ProviderPolicyMode:  providerpolicy.Mode(account, capability, settingsMap),
	}, nil
}

func renditionFingerprintParts(
	ctx context.Context,
	db bun.IDB,
	publication models.Publication,
	rendition models.Rendition,
) (contentFingerprint, settingsFingerprint, mediaFingerprint, error) {
	destinationSettings, err := canonicalJSON(rendition.SettingsJSON)
	if err != nil {
		return contentFingerprint{}, settingsFingerprint{}, mediaFingerprint{}, fmt.Errorf("canonicalize destination settings: %w", err)
	}
	content := contentFingerprint{Version: 1, Profile: rendition.Profile, OutputProfile: rendition.OutputProfile, Segments: []contentSegmentFingerprint{}}
	settings := settingsFingerprint{Version: 1, Destination: destinationSettings, Segments: []segmentSettingsHash{}}
	media := mediaFingerprint{Version: 1, Items: []mediaItemFingerprint{}}

	var segments []models.RenditionSegment
	err = db.NewSelect().Model(&segments).
		Where("rendition_id = ?", rendition.ID).
		Order("position ASC", "id ASC").
		Scan(ctx)
	if err != nil && !missingTable(err) {
		return content, settings, media, fmt.Errorf("load authorization segments: %w", err)
	}
	if len(segments) == 0 {
		content.Segments = append(content.Segments, contentSegmentFingerprint{
			Position:    0,
			Body:        rendition.Body,
			Title:       firstNonEmpty(rendition.Title, publication.Title),
			Description: rendition.Description,
		})
		rows, rowErr := loadRenditionMediaRows(ctx, db, rendition.ID)
		if rowErr != nil {
			return content, settings, media, rowErr
		}
		items, itemErr := mediaItemsFromRows(rows, 0)
		if itemErr != nil {
			return content, settings, media, itemErr
		}
		media.Items = append(media.Items, items...)
	} else {
		for _, segment := range segments {
			content.Segments = append(content.Segments, contentSegmentFingerprint{
				Position:    segment.Position,
				Body:        segment.Body,
				Title:       firstNonEmpty(segment.Title, rendition.Title, publication.Title),
				Description: firstNonEmpty(segment.Description, rendition.Description),
				URL:         segment.URL,
			})
			segmentSettings, settingsErr := canonicalJSON(segment.SettingsJSON)
			if settingsErr != nil {
				return content, settings, media, fmt.Errorf("canonicalize segment settings: %w", settingsErr)
			}
			settings.Segments = append(settings.Segments, segmentSettingsHash{Position: segment.Position, Settings: segmentSettings})
			rows, rowErr := loadRenditionSegmentMediaRows(ctx, db, segment.ID)
			if rowErr != nil {
				return content, settings, media, rowErr
			}
			items, itemErr := mediaItemsFromRows(rows, segment.Position)
			if itemErr != nil {
				return content, settings, media, itemErr
			}
			media.Items = append(media.Items, items...)
		}
	}
	settingItems, err := loadSettingMediaItems(ctx, db, publication.WorkspaceID, rendition.SettingsJSON, media.Items)
	if err != nil {
		return content, settings, media, err
	}
	media.Items = append(media.Items, settingItems...)
	return content, settings, media, nil
}

func loadRenditionMediaRows(ctx context.Context, db bun.IDB, renditionID string) ([]renditionMediaRow, error) {
	var rows []renditionMediaRow
	err := db.NewSelect().
		TableExpr("rendition_media AS relation").
		ColumnExpr("relation.display_order, relation.role, relation.alt_text, relation.thumbnail_timestamp_ms, '{}' AS settings_json").
		ColumnExpr("media.id AS media_id, media.file_hash, media.mime_type, media.size, media.original_filename, media.alt_text AS default_alt_text").
		Join("JOIN media_attachments AS media ON media.id = relation.media_id").
		Where("relation.rendition_id = ?", renditionID).
		OrderExpr("relation.display_order ASC, media.id ASC").
		Scan(ctx, &rows)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("load authorization rendition media: %w", err)
	}
	return rows, nil
}

func loadRenditionSegmentMediaRows(ctx context.Context, db bun.IDB, segmentID string) ([]renditionMediaRow, error) {
	var rows []renditionMediaRow
	err := db.NewSelect().
		TableExpr("rendition_segment_media AS relation").
		ColumnExpr("relation.display_order, relation.role, relation.alt_text, relation.thumbnail_timestamp_ms, relation.settings_json").
		ColumnExpr("media.id AS media_id, media.file_hash, media.mime_type, media.size, media.original_filename, media.alt_text AS default_alt_text").
		Join("JOIN media_attachments AS media ON media.id = relation.media_id").
		Where("relation.rendition_segment_id = ?", segmentID).
		OrderExpr("relation.display_order ASC, media.id ASC").
		Scan(ctx, &rows)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("load authorization segment media: %w", err)
	}
	return rows, nil
}

func mediaItemsFromRows(rows []renditionMediaRow, segmentPosition int) ([]mediaItemFingerprint, error) {
	items := make([]mediaItemFingerprint, 0, len(rows))
	for _, row := range rows {
		settings, err := canonicalJSON(row.SettingsJSON)
		if err != nil {
			return nil, fmt.Errorf("canonicalize media settings: %w", err)
		}
		items = append(items, mediaItemFingerprint{
			SegmentPosition: segmentPosition, DisplayOrder: row.DisplayOrder, Role: row.Role,
			MediaID: row.MediaID, FileHash: row.FileHash, MimeType: row.MimeType, Size: row.Size,
			OriginalFilename: row.OriginalFilename, AltText: firstNonEmpty(row.AltText, row.DefaultAltText),
			ThumbnailTimestampMS: row.ThumbnailTimestampMS, Settings: settings,
		})
	}
	return items, nil
}

func loadSettingMediaItems(
	ctx context.Context,
	db bun.IDB,
	workspaceID, settingsJSON string,
	existing []mediaItemFingerprint,
) ([]mediaItemFingerprint, error) {
	settings := map[string]any{}
	if strings.TrimSpace(settingsJSON) != "" {
		if err := json.Unmarshal([]byte(settingsJSON), &settings); err != nil {
			return nil, fmt.Errorf("decode setting media: %w", err)
		}
	}
	seen := make(map[string]bool, len(existing))
	for _, item := range existing {
		seen[item.MediaID] = true
	}
	keys := []string{"caption_media_id", "cover_media_id", "thumbnail_media_id"}
	out := make([]mediaItemFingerprint, 0, len(keys))
	for order, key := range keys {
		mediaID, _ := settings[key].(string)
		mediaID = strings.TrimSpace(mediaID)
		if mediaID == "" || strings.HasPrefix(mediaID, "http://") || strings.HasPrefix(mediaID, "https://") || seen[mediaID] {
			continue
		}
		var media models.MediaAttachment
		if err := db.NewSelect().Model(&media).
			Where("id = ? AND workspace_id = ?", mediaID, workspaceID).
			Scan(ctx); err != nil {
			return nil, fmt.Errorf("load authorization %s: %w", key, err)
		}
		out = append(out, mediaItemFingerprint{
			SegmentPosition: -1, DisplayOrder: order, Role: "setting:" + key,
			MediaID: media.ID, FileHash: media.FileHash, MimeType: media.MimeType,
			Size: media.Size, OriginalFilename: media.OriginalFilename,
			AltText: media.AltText, Settings: json.RawMessage(`{}`),
		})
		seen[mediaID] = true
	}
	return out, nil
}

func TargetKey(account models.SocialAccount) string {
	if account.Platform == "mastodon" {
		return "mastodon:" + account.InstanceURL
	}
	return account.Platform
}

// RenditionTargetKey keeps upgraded and fresh renditions exact while retaining
// a safe fallback for legacy fixtures and databases created before migration 088.
func RenditionTargetKey(rendition models.Rendition, account models.SocialAccount) string {
	if target := strings.TrimSpace(rendition.TargetKey); target != "" {
		return target
	}
	return TargetKey(account)
}

func hashCanonical(domain string, value any) (string, error) {
	payload, err := json.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("encode %s fingerprint: %w", domain, err)
	}
	hash := sha256.New()
	_, _ = io.WriteString(hash, domain)
	_, _ = hash.Write([]byte{0})
	_, _ = hash.Write(payload)
	return hashPrefix + hex.EncodeToString(hash.Sum(nil)), nil
}

func HashExplicit(domain string, value any) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("encode %s explicit value: %w", domain, err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var normalized any
	if err := decoder.Decode(&normalized); err != nil {
		return "", fmt.Errorf("normalize %s explicit value: %w", domain, err)
	}
	return hashCanonical(domain, normalized)
}

func canonicalJSON(raw string) (json.RawMessage, error) {
	if strings.TrimSpace(raw) == "" {
		return json.RawMessage(`{}`), nil
	}
	decoder := json.NewDecoder(bytes.NewBufferString(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(value)
	return json.RawMessage(encoded), err
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var extra any
	err := decoder.Decode(&extra)
	if errors.Is(err, io.EOF) {
		return nil
	}
	if err == nil {
		return fmt.Errorf("multiple JSON values")
	}
	return err
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func missingTable(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such table") ||
		(strings.Contains(message, "relation") && strings.Contains(message, "does not exist"))
}

func sortReceipts(receipts []models.PublicationAuthorization) {
	sort.Slice(receipts, func(i, j int) bool {
		if receipts[i].RenditionID == receipts[j].RenditionID {
			return receipts[i].ID < receipts[j].ID
		}
		return receipts[i].RenditionID < receipts[j].RenditionID
	})
}
