package publicationbuilder

import (
	"context"
	"encoding/json"
	"log/slog"
	"slices"
	"strings"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/screenshottemplates"
)

// VisualRenderer turns a planned visual recipe (a screenshot template or a
// meme) into ready workspace media. Rendering is a server capability so
// headless builds from Workflows and MCP finish with their image.
type VisualRenderer interface {
	RenderVisual(ctx context.Context, workspaceID, userID string, document screenshottemplates.ScreenshotTemplateDocument) (models.MediaAttachment, error)
}

// SetVisualRenderer binds the renderer used when a commit still has planned
// visual documents. Without one, those drafts keep typed image requirements.
func (application *Application) SetVisualRenderer(renderer VisualRenderer) {
	application.visuals = renderer
}

// renderPlannedVisuals replaces each planned visual document with rendered
// media. A failed render keeps the draft's image requirement so a person can
// still finish it; only cancellation stops the commit.
func (application *Application) renderPlannedVisuals(ctx context.Context, workspaceID, userID string, request *persistedBuildRequest, result *BuildResult) error {
	if application.visuals == nil {
		return nil
	}
	rendered := map[string]models.MediaAttachment{}
	for index := range result.Destinations {
		document := result.Destinations[index].Media.Document
		if document == nil {
			continue
		}
		key, err := json.Marshal(document)
		if err != nil {
			continue
		}
		media, ok := rendered[string(key)]
		if !ok {
			media, err = application.visuals.RenderVisual(ctx, workspaceID, userID, *document)
			if err != nil {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				slog.WarnContext(ctx, "Planned visual could not be rendered; the draft keeps its image requirement",
					"workspace_id", workspaceID, "template_id", document.TemplateID, "error", err)
				continue
			}
			rendered[string(key)] = media
		}
		useRenderedVisual(request, result, index, media)
	}
	return nil
}

// useRenderedVisual makes rendered media the destination's publishable source.
func useRenderedVisual(request *persistedBuildRequest, result *BuildResult, destination int, media models.MediaAttachment) {
	plan := &result.Destinations[destination].Media
	plan.Treatment, plan.SourceRef, plan.TemplateID, plan.Document = "use_source", "media:"+media.ID, "", nil
	if index := slices.IndexFunc(request.Assets, func(existing BuildAsset) bool { return existing.MediaID == media.ID }); index >= 0 {
		request.Assets[index].Role = "artifact"
		request.Assets[index].MayPublish = true
	} else {
		request.Assets = append(request.Assets, BuildAsset{MediaID: media.ID, Role: "artifact", MayPublish: true})
	}
	if !slices.ContainsFunc(result.Sources, func(source ResolvedSource) bool { return source.ID == plan.SourceRef }) {
		result.Sources = append(result.Sources, ResolvedSource{ID: plan.SourceRef, Kind: "image", Label: "Generated visual", Publishable: true, MIMEType: strings.TrimSpace(media.MimeType)})
	}
}
