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

	"github.com/openpost/backend/internal/textutil"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
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
	OwnerID              string `bun:"owner_id"`
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

var settingMediaKeys = []string{"caption_media_id", "cover_media_id", "thumbnail_media_id"}

// snapshotInputs holds every row a set of rendition snapshots reads. Loading
// them per publication keeps locked enqueue transactions to a fixed number of
// queries instead of one per segment and setting media key.
type snapshotInputs struct {
	publication    models.Publication
	renditions     map[string]models.Rendition
	accounts       map[string]models.SocialAccount
	segments       map[string][]models.RenditionSegment
	segmentMedia   map[string][]renditionMediaRow
	renditionMedia map[string][]renditionMediaRow
	settingMedia   map[string]models.MediaAttachment
}

func SnapshotForRendition(ctx context.Context, db bun.IDB, publicationID, renditionID string) (Snapshot, error) {
	inputs, err := loadSnapshotInputs(ctx, db, publicationID, []string{renditionID})
	if err != nil {
		return Snapshot{}, err
	}
	return inputs.snapshot(renditionID)
}

// snapshotsForRenditions returns snapshots in the requested order from one
// batched read of the publication's authorship.
func snapshotsForRenditions(ctx context.Context, db bun.IDB, publicationID string, renditionIDs []string) ([]Snapshot, error) {
	inputs, err := loadSnapshotInputs(ctx, db, publicationID, renditionIDs)
	if err != nil {
		return nil, err
	}
	snapshots := make([]Snapshot, 0, len(renditionIDs))
	for _, renditionID := range renditionIDs {
		snapshot, err := inputs.snapshot(renditionID)
		if err != nil {
			return nil, err
		}
		snapshots = append(snapshots, snapshot)
	}
	return snapshots, nil
}

//nolint:gocyclo // Each authorship table is read once for the whole rendition set.
func loadSnapshotInputs(ctx context.Context, db bun.IDB, publicationID string, renditionIDs []string) (*snapshotInputs, error) {
	inputs := &snapshotInputs{
		renditions:   map[string]models.Rendition{},
		accounts:     map[string]models.SocialAccount{},
		segments:     map[string][]models.RenditionSegment{},
		settingMedia: map[string]models.MediaAttachment{},
	}
	if err := db.NewSelect().Model(&inputs.publication).Where("id = ?", publicationID).Scan(ctx); err != nil {
		return nil, fmt.Errorf("load authorization publication: %w", err)
	}
	ids := uniqueStrings(renditionIDs)
	if len(ids) == 0 {
		return inputs, nil
	}
	var renditions []models.Rendition
	if err := db.NewSelect().Model(&renditions).
		Where("id IN (?) AND publication_id = ?", bun.List(ids), inputs.publication.ID).
		Scan(ctx); err != nil {
		return nil, fmt.Errorf("load authorization rendition: %w", err)
	}
	accountIDs := make([]string, 0, len(renditions))
	for _, rendition := range renditions {
		inputs.renditions[rendition.ID] = rendition
		accountIDs = append(accountIDs, rendition.SocialAccountID)
	}
	for _, id := range ids {
		if _, ok := inputs.renditions[id]; !ok {
			return nil, fmt.Errorf("load authorization rendition: %w", sql.ErrNoRows)
		}
	}
	var accounts []models.SocialAccount
	if err := db.NewSelect().Model(&accounts).
		Where("id IN (?) AND workspace_id = ?", bun.List(uniqueStrings(accountIDs)), inputs.publication.WorkspaceID).
		Scan(ctx); err != nil {
		return nil, fmt.Errorf("load authorization account: %w", err)
	}
	for _, account := range accounts {
		inputs.accounts[account.ID] = account
	}
	for _, rendition := range renditions {
		if _, ok := inputs.accounts[rendition.SocialAccountID]; !ok {
			return nil, fmt.Errorf("load authorization account: %w", sql.ErrNoRows)
		}
	}

	var segments []models.RenditionSegment
	err := db.NewSelect().Model(&segments).
		Where("rendition_id IN (?)", bun.List(ids)).
		Order("rendition_id ASC", "position ASC", "id ASC").
		Scan(ctx)
	if err != nil && !missingTable(err) {
		return nil, fmt.Errorf("load authorization segments: %w", err)
	}
	segmentIDs := make([]string, 0, len(segments))
	for _, segment := range segments {
		inputs.segments[segment.RenditionID] = append(inputs.segments[segment.RenditionID], segment)
		segmentIDs = append(segmentIDs, segment.ID)
	}
	legacyIDs := make([]string, 0, len(ids))
	for _, id := range ids {
		if len(inputs.segments[id]) == 0 {
			legacyIDs = append(legacyIDs, id)
		}
	}
	if inputs.renditionMedia, err = loadMediaRows(ctx, db, mediaRelation{
		table: "rendition_media", owner: "rendition_id", settings: "'{}'", label: "rendition media",
	}, legacyIDs); err != nil {
		return nil, err
	}
	if inputs.segmentMedia, err = loadMediaRows(ctx, db, mediaRelation{
		table: "rendition_segment_media", owner: "rendition_segment_id", settings: "relation.settings_json", label: "segment media",
	}, segmentIDs); err != nil {
		return nil, err
	}

	settingMediaIDs := []string{}
	for _, rendition := range renditions {
		settings, err := decodeSettingMedia(rendition.SettingsJSON)
		if err != nil {
			// The per-rendition projection reports the decode error in order.
			continue
		}
		for _, key := range settingMediaKeys {
			if mediaID := settingMediaID(settings, key); mediaID != "" {
				settingMediaIDs = append(settingMediaIDs, mediaID)
			}
		}
	}
	if len(settingMediaIDs) > 0 {
		var media []models.MediaAttachment
		if err := db.NewSelect().Model(&media).
			Where("id IN (?) AND workspace_id = ?", bun.List(uniqueStrings(settingMediaIDs)), inputs.publication.WorkspaceID).
			Scan(ctx); err != nil {
			return nil, fmt.Errorf("load authorization setting media: %w", err)
		}
		for _, item := range media {
			inputs.settingMedia[item.ID] = item
		}
	}
	return inputs, nil
}

type mediaRelation struct {
	table, owner, settings, label string
}

// loadMediaRows reads one media relation for many owners, ordered per owner
// exactly as the former single-owner query was.
func loadMediaRows(ctx context.Context, db bun.IDB, relation mediaRelation, ownerIDs []string) (map[string][]renditionMediaRow, error) {
	out := map[string][]renditionMediaRow{}
	if len(ownerIDs) == 0 {
		return out, nil
	}
	var rows []renditionMediaRow
	err := db.NewSelect().
		TableExpr(relation.table+" AS relation").
		ColumnExpr("relation."+relation.owner+" AS owner_id, relation.display_order, relation.role, relation.alt_text, relation.thumbnail_timestamp_ms, "+relation.settings+" AS settings_json").
		ColumnExpr("media.id AS media_id, media.file_hash, media.mime_type, media.size, media.original_filename, media.alt_text AS default_alt_text").
		Join("JOIN media_attachments AS media ON media.id = relation.media_id").
		Where("relation."+relation.owner+" IN (?)", bun.List(ownerIDs)).
		OrderExpr("relation."+relation.owner+" ASC, relation.display_order ASC, media.id ASC").
		Scan(ctx, &rows)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("load authorization %s: %w", relation.label, err)
	}
	for _, row := range rows {
		out[row.OwnerID] = append(out[row.OwnerID], row)
	}
	return out, nil
}

func (inputs *snapshotInputs) snapshot(renditionID string) (Snapshot, error) {
	rendition, ok := inputs.renditions[renditionID]
	if !ok {
		return Snapshot{}, fmt.Errorf("load authorization rendition: %w", sql.ErrNoRows)
	}
	account, ok := inputs.accounts[rendition.SocialAccountID]
	if !ok {
		return Snapshot{}, fmt.Errorf("load authorization account: %w", sql.ErrNoRows)
	}
	content, settings, media, err := inputs.fingerprintParts(rendition)
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
		WorkspaceID:         inputs.publication.WorkspaceID,
		PublicationRevision: inputs.publication.Revision,
		SocialAccountID:     rendition.SocialAccountID,
		TargetKey:           RenditionTargetKey(rendition, account),
		ContentHash:         contentHash,
		MediaHash:           mediaHash,
		SettingsHash:        settingsHash,
		ProviderPolicyMode:  providerpolicy.Mode(account, capability, settingsMap),
	}, nil
}

func (inputs *snapshotInputs) fingerprintParts(
	rendition models.Rendition,
) (contentFingerprint, settingsFingerprint, mediaFingerprint, error) {
	publication := inputs.publication
	destinationSettings, err := canonicalJSON(rendition.SettingsJSON)
	if err != nil {
		return contentFingerprint{}, settingsFingerprint{}, mediaFingerprint{}, fmt.Errorf("canonicalize destination settings: %w", err)
	}
	content := contentFingerprint{Version: 1, Profile: rendition.Profile, OutputProfile: rendition.OutputProfile, Segments: []contentSegmentFingerprint{}}
	settings := settingsFingerprint{Version: 1, Destination: destinationSettings, Segments: []segmentSettingsHash{}}
	media := mediaFingerprint{Version: 1, Items: []mediaItemFingerprint{}}

	segments := inputs.segments[rendition.ID]
	if len(segments) == 0 {
		content.Segments = append(content.Segments, contentSegmentFingerprint{
			Position:    0,
			Body:        rendition.Body,
			Title:       textutil.FirstNonEmpty(rendition.Title, publication.Title),
			Description: rendition.Description,
		})
		items, itemErr := mediaItemsFromRows(inputs.renditionMedia[rendition.ID], 0)
		if itemErr != nil {
			return content, settings, media, itemErr
		}
		media.Items = append(media.Items, items...)
	} else {
		for _, segment := range segments {
			content.Segments = append(content.Segments, contentSegmentFingerprint{
				Position:    segment.Position,
				Body:        segment.Body,
				Title:       textutil.FirstNonEmpty(segment.Title, rendition.Title, publication.Title),
				Description: textutil.FirstNonEmpty(segment.Description, rendition.Description),
				URL:         segment.URL,
			})
			segmentSettings, settingsErr := canonicalJSON(segment.SettingsJSON)
			if settingsErr != nil {
				return content, settings, media, fmt.Errorf("canonicalize segment settings: %w", settingsErr)
			}
			settings.Segments = append(settings.Segments, segmentSettingsHash{Position: segment.Position, Settings: segmentSettings})
			items, itemErr := mediaItemsFromRows(inputs.segmentMedia[segment.ID], segment.Position)
			if itemErr != nil {
				return content, settings, media, itemErr
			}
			media.Items = append(media.Items, items...)
		}
	}
	settingItems, err := inputs.settingMediaItems(rendition.SettingsJSON, media.Items)
	if err != nil {
		return content, settings, media, err
	}
	media.Items = append(media.Items, settingItems...)
	return content, settings, media, nil
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
			OriginalFilename: row.OriginalFilename, AltText: textutil.FirstNonEmpty(row.AltText, row.DefaultAltText),
			ThumbnailTimestampMS: row.ThumbnailTimestampMS, Settings: settings,
		})
	}
	return items, nil
}

func decodeSettingMedia(settingsJSON string) (map[string]any, error) {
	settings := map[string]any{}
	if strings.TrimSpace(settingsJSON) != "" {
		if err := json.Unmarshal([]byte(settingsJSON), &settings); err != nil {
			return nil, fmt.Errorf("decode setting media: %w", err)
		}
	}
	return settings, nil
}

func settingMediaID(settings map[string]any, key string) string {
	mediaID, _ := settings[key].(string)
	mediaID = strings.TrimSpace(mediaID)
	if strings.HasPrefix(mediaID, "http://") || strings.HasPrefix(mediaID, "https://") {
		return ""
	}
	return mediaID
}

func (inputs *snapshotInputs) settingMediaItems(settingsJSON string, existing []mediaItemFingerprint) ([]mediaItemFingerprint, error) {
	settings, err := decodeSettingMedia(settingsJSON)
	if err != nil {
		return nil, err
	}
	seen := make(map[string]bool, len(existing))
	for _, item := range existing {
		seen[item.MediaID] = true
	}
	out := make([]mediaItemFingerprint, 0, len(settingMediaKeys))
	for order, key := range settingMediaKeys {
		mediaID := settingMediaID(settings, key)
		if mediaID == "" || seen[mediaID] {
			continue
		}
		media, ok := inputs.settingMedia[mediaID]
		if !ok {
			return nil, fmt.Errorf("load authorization %s: %w", key, sql.ErrNoRows)
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

func uniqueStrings(values []string) []string {
	out := make([]string, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		if seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func TargetKey(account models.SocialAccount) string {
	if platform.IsInstanceScopedProvider(account.Platform) {
		return account.Platform + ":" + account.InstanceURL
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
