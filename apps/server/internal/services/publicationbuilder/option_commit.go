package publicationbuilder

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"slices"
	"strings"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/screenshottemplates"
	"github.com/uptrace/bun"
)

var ErrInvalidOption = errors.New("invalid post option changes")

type OptionMedia struct {
	AccountID string `json:"account_id"`
	MediaID   string `json:"media_id"`
}

type OptionEdit struct {
	AccountID string                                          `json:"account_id"`
	Segments  []SegmentPlan                                   `json:"segments" minItems:"1" maxItems:"25"`
	Document  *screenshottemplates.ScreenshotTemplateDocument `json:"document,omitempty"`
}

// CommitOption explicitly chooses one alternative. Rendering is a client
// capability; missing renders remain typed image requirements in a saved draft.
func (application *Application) CommitOption(ctx context.Context, userID, buildID, optionID string, expectedRevision int, media []OptionMedia, edits []OptionEdit, publications PublicationApplication) (Build, error) {
	build, err := application.Get(ctx, userID, buildID)
	if err != nil {
		return Build{}, err
	}
	if build.Result == nil {
		return Build{}, ErrBuildNotReady
	}
	if build.Result.SelectedOptionID != "" {
		if build.Result.SelectedOptionID != optionID {
			return Build{}, ErrBuildNotReady
		}
		return application.Commit(ctx, userID, buildID, publications)
	}
	if build.State != BuildStateReady {
		return Build{}, ErrBuildNotReady
	}
	if build.Revision != expectedRevision {
		return Build{}, ErrBuildNotReady
	}
	index := slices.IndexFunc(build.Result.Options, func(option PostOption) bool { return option.ID == optionID })
	if index < 0 {
		return Build{}, ErrInvalidOption
	}
	selected := build.Result.Options[index].Result()
	selected.Sources = build.Result.Sources
	selected.Options = build.Result.Options
	selected.SelectedOptionID = optionID
	if err := applyOptionEdits(&selected, optionValidationInput(build), edits); err != nil {
		return Build{}, errors.Join(ErrInvalidOption, err)
	}
	if err := application.validateOptionImages(ctx, build.WorkspaceID, selected.Destinations); err != nil {
		return Build{}, err
	}
	record, request, err := application.loadOptionRequest(ctx, userID, buildID, build.Revision)
	if err != nil {
		return Build{}, err
	}
	if err := application.applyRenderedOptionMedia(ctx, build.WorkspaceID, &request, &selected, media); err != nil {
		return Build{}, err
	}
	if err := application.validateCommitSourceMedia(ctx, build.WorkspaceID, selectedSourceMediaIDs(request.Assets, selected)); err != nil {
		return Build{}, err
	}
	if err := application.recordOptionSelection(ctx, record, request, selected); err != nil {
		return Build{}, err
	}
	return application.Commit(ctx, userID, buildID, publications)
}

func applyOptionEdits(result *BuildResult, input BuildInput, edits []OptionEdit) error {
	seen := map[string]bool{}
	for _, edit := range edits {
		index := slices.IndexFunc(result.Destinations, func(destination DestinationPlan) bool { return destination.AccountID == edit.AccountID })
		if index < 0 || seen[edit.AccountID] {
			return errors.New("unknown or repeated edited destination")
		}
		seen[edit.AccountID] = true
		plan := &result.Destinations[index]
		plan.Segments = edit.Segments
		if err := applyOptionDocumentEdit(&plan.Media, edit.Document); err != nil {
			return err
		}
		account := slices.IndexFunc(input.Destinations, func(destination Destination) bool { return destination.AccountID == edit.AccountID })
		if account < 0 {
			return errors.New("edited account is unavailable")
		}
		policy, _ := policyFor(plan.Platform)
		if err := validateDestinationPlan(*plan, input.Destinations[account], policy, sourceReferenceCatalogFor(input)); err != nil {
			return err
		}
	}
	if len(result.Destinations) > 0 && len(result.Destinations[0].Segments) > 0 {
		result.CanonicalText = result.Destinations[0].Segments[0].Body
	}
	return nil
}

func MediaRequirement(plan MediaPlan) map[string]any {
	kind := ""
	if plan.Treatment == "attach_video" {
		kind = "video"
	}
	if plan.Treatment == "attach_image" || plan.Document != nil {
		kind = "image"
	}
	if kind == "" {
		return nil
	}
	requirement := map[string]any{"kind": kind, "brief": plan.Brief}
	if plan.Document != nil {
		requirement["document"] = plan.Document
	}
	return requirement
}

func optionValidationInput(build Build) BuildInput {
	input := build.Input
	if build.Result != nil {
		for _, source := range build.Result.Sources {
			if !slices.ContainsFunc(input.Sources, func(existing SourceMaterial) bool { return existing.ID == source.ID }) {
				input.Sources = append(input.Sources, SourceMaterial{ID: source.ID, Kind: source.Kind, Label: source.Label, MIMEType: source.MIMEType, Publishable: source.Publishable})
			}
		}
	}
	return input
}

// SaveOption retains author edits without choosing or publishing an alternative.
func (application *Application) SaveOption(ctx context.Context, userID, buildID, optionID string, revision int, edits []OptionEdit) (Build, error) {
	build, err := application.Get(ctx, userID, buildID)
	if err != nil {
		return Build{}, err
	}
	if build.State != BuildStateReady || build.Result == nil || build.Result.SelectedOptionID != "" {
		return Build{}, ErrBuildNotReady
	}
	index := slices.IndexFunc(build.Result.Options, func(option PostOption) bool { return option.ID == optionID })
	if index < 0 {
		return Build{}, ErrInvalidOption
	}
	if build.Revision != revision {
		if build.Revision == revision+1 && optionEditsMatch(build.Result.Options[index], edits) {
			return build, nil
		}
		return Build{}, ErrBuildNotReady
	}

	edited := build.Result.Options[index].Result()
	if err := applyOptionEdits(&edited, optionValidationInput(build), edits); err != nil {
		return Build{}, errors.Join(ErrInvalidOption, err)
	}
	if err := application.validateOptionImages(ctx, build.WorkspaceID, edited.Destinations); err != nil {
		return Build{}, err
	}
	option := &build.Result.Options[index]
	option.CanonicalText, option.Destinations = edited.CanonicalText, edited.Destinations
	encoded, err := json.Marshal(build.Result)
	if err != nil {
		return Build{}, err
	}
	updated, err := application.db.NewUpdate().Model((*BuildRecord)(nil)).Set("result_json = ?", string(encoded)).Set("revision = revision + 1").Set("updated_at = ?", application.now().UTC()).Where("id = ? AND created_by_id = ? AND state = ? AND phase = ? AND revision = ?", buildID, userID, BuildStateReady, BuildPhaseReady, revision).Exec(ctx)
	if err != nil {
		return Build{}, err
	}
	count, err := updated.RowsAffected()
	if err != nil {
		return Build{}, err
	}
	if count != 1 {
		return Build{}, ErrBuildNotReady
	}
	return application.Get(ctx, userID, buildID)
}

func (application *Application) validateOptionImages(ctx context.Context, workspaceID string, plans []DestinationPlan) error {
	ids := []string{}
	for _, plan := range plans {
		if plan.Media.Document != nil {
			ids = append(ids, screenshottemplates.MediaIDs(*plan.Media.Document)...)
		}
	}
	slices.Sort(ids)
	ids = slices.Compact(ids)
	if len(ids) == 0 {
		return nil
	}
	count, err := application.db.NewSelect().Model((*models.MediaAttachment)(nil)).Where("workspace_id = ? AND id IN (?) AND processing_status = ? AND trashed_at IS NULL AND mime_type LIKE ?", workspaceID, bun.List(ids), "ready", "image/%").Count(ctx)
	if err != nil {
		return err
	}
	if count != int64(len(ids)) {
		return ErrBuildSourceUnavailable
	}
	return nil
}

func (application *Application) applyRenderedOptionMedia(ctx context.Context, workspaceID string, request *persistedBuildRequest, selected *BuildResult, media []OptionMedia) error {
	accounts := map[string]bool{}
	for _, item := range media {
		if accounts[item.AccountID] {
			return errors.New("repeated rendered media account")
		}
		accounts[item.AccountID] = true
		destination := slices.IndexFunc(selected.Destinations, func(plan DestinationPlan) bool { return plan.AccountID == item.AccountID })
		if destination < 0 || selected.Destinations[destination].Media.Document == nil {
			return errors.New("rendered media requires a planned visual document")
		}
		var asset models.MediaAttachment
		if err := application.db.NewSelect().Model(&asset).Where("id = ? AND workspace_id = ?", item.MediaID, workspaceID).Scan(ctx); err != nil {
			return ErrBuildSourceUnavailable
		}
		if !strings.HasPrefix(asset.MimeType, "image/") {
			return ErrBuildSourceUnavailable
		}
		plan := &selected.Destinations[destination].Media
		plan.Treatment, plan.SourceRef, plan.TemplateID, plan.Document = "use_source", "media:"+item.MediaID, "", nil
		if index := slices.IndexFunc(request.Assets, func(existing BuildAsset) bool { return existing.MediaID == item.MediaID }); index >= 0 {
			request.Assets[index].Role = "artifact"
			request.Assets[index].MayPublish = true
		} else {
			request.Assets = append(request.Assets, BuildAsset{MediaID: item.MediaID, Role: "artifact", MayPublish: true})
		}
		selected.Sources = append(selected.Sources, ResolvedSource{ID: plan.SourceRef, Kind: "image", Label: "Generated visual", Publishable: true, MIMEType: asset.MimeType})
	}
	return nil
}

func applyOptionDocumentEdit(media *MediaPlan, document *screenshottemplates.ScreenshotTemplateDocument) error {
	if document != nil {
		if media.Document == nil || media.Document.TemplateID != document.TemplateID {
			return errors.New("edited visual must keep the selected family")
		}
		if err := screenshottemplates.Validate(*document); err != nil {
			return err
		}
		if document.Meme != nil && (media.Document.Meme == nil || document.Meme.TemplateID != media.Document.Meme.TemplateID || len(document.Meme.Captions) != len(media.Document.Meme.Captions)) {
			return errors.New("edited meme must keep the selected template and field count")
		}
		media.Document = document
	}
	return nil
}

func (application *Application) recordOptionSelection(ctx context.Context, record BuildRecord, request persistedBuildRequest, selected BuildResult) error {
	resultJSON, err := json.Marshal(selected)
	if err != nil {
		return err
	}
	requestJSON, err := json.Marshal(request)
	if err != nil {
		return err
	}
	updated, err := application.db.NewUpdate().Model((*BuildRecord)(nil)).
		Set("result_json = ?", string(resultJSON)).Set("request_json = ?", string(requestJSON)).Set("revision = revision + 1").
		Where("id = ? AND created_by_id = ? AND state = ? AND phase = ? AND revision = ?", record.ID, record.CreatedByID, BuildStateReady, BuildPhaseReady, record.Revision).Exec(ctx)
	if err != nil {
		return err
	}
	count, err := updated.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return ErrBuildNotReady
	}
	return nil
}

func (application *Application) loadOptionRequest(ctx context.Context, userID, buildID string, revision int) (BuildRecord, persistedBuildRequest, error) {
	var record BuildRecord
	if err := application.db.NewSelect().Model(&record).Where("id = ? AND created_by_id = ?", buildID, userID).Scan(ctx); err != nil {
		return BuildRecord{}, persistedBuildRequest{}, err
	}
	var request persistedBuildRequest
	if err := decodeStoredJSON(record.RequestJSON, &request); err != nil {
		return BuildRecord{}, persistedBuildRequest{}, err
	}
	if record.Revision != revision {
		return BuildRecord{}, persistedBuildRequest{}, ErrBuildNotReady
	}
	return record, request, nil
}

// An exact replay after a lost response is a read, never a stale overwrite.
func optionEditsMatch(option PostOption, edits []OptionEdit) bool {
	for _, edit := range edits {
		index := slices.IndexFunc(option.Destinations, func(plan DestinationPlan) bool { return plan.AccountID == edit.AccountID })
		if index < 0 {
			return false
		}
		plan := option.Destinations[index]
		if !reflect.DeepEqual(plan.Segments, edit.Segments) || (edit.Document != nil && !reflect.DeepEqual(plan.Media.Document, edit.Document)) {
			return false
		}
	}
	return true
}
