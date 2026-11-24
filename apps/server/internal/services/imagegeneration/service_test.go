package imagegeneration

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"testing"
	"time"

	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/aiusage"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
)

type imageProvider struct {
	calls       int
	submitError error
	charge      *int64
	content     []byte
	failed      bool
}

func (p *imageProvider) SubmitImage(context.Context, ai.ImageRequest) (string, error) {
	p.calls++
	return "fal-receipt", p.submitError
}
func (p *imageProvider) ImageStatus(context.Context, string, string) (ai.ImageStatus, error) {
	return ai.ImageStatus{State: "completed", Failed: p.failed}, nil
}
func (p *imageProvider) ImageResult(context.Context, string, string) ([]byte, error) {
	return p.content, nil
}
func (p *imageProvider) ImageCost(context.Context, string, string) (*int64, error) {
	return p.charge, nil
}

type imageImporter struct {
	db    *bun.DB
	fail  bool
	calls int
}

func (i *imageImporter) ImportGeneratedImage(ctx context.Context, input MediaImport) (models.MediaAttachment, error) {
	i.calls++
	if i.fail {
		return models.MediaAttachment{}, errors.New("storage unavailable")
	}
	media := models.MediaAttachment{ID: "result", WorkspaceID: input.WorkspaceID, FilePath: "result.png", MimeType: "image/png", Width: 2, Height: 2, Size: int64(len(input.Content)), AssetKind: "library", ProcessingStatus: "ready"}
	_, err := i.db.NewInsert().Model(&media).On("CONFLICT DO NOTHING").Exec(ctx)
	return media, err
}
func testImageService(t *testing.T) (*Service, *imageProvider, *imageImporter, workspaceaccess.ActorFacts) {
	t.Helper()
	connection, err := sql.Open(sqliteshim.ShimName, ":memory:")
	require.NoError(t, err)
	db := bun.NewDB(connection, sqlitedialect.New())
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, database.CreateSchema(db))
	for _, model := range []any{&models.User{ID: "user", Email: "user@example.test"}, &models.User{ID: "other", Email: "other@example.test"}, &models.Workspace{ID: "ws", OrganizationID: "org", Name: "Workspace"}, &models.Workspace{ID: "foreign", OrganizationID: "foreign-org", Name: "Other"}, &models.WorkspaceMember{UserID: "user", WorkspaceID: "ws", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive}, &models.WorkspaceMember{UserID: "other", WorkspaceID: "ws", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive}} {
		_, err = db.NewInsert().Model(model).Exec(t.Context())
		require.NoError(t, err)
	}
	content := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	content.Set(0, 0, color.NRGBA{255, 0, 0, 255})
	data, err := pngBytes(content)
	require.NoError(t, err)
	provider := &imageProvider{content: data}
	importer := &imageImporter{db: db}
	return New(db, provider, mediastore.NewLocalStorage(t.TempDir(), "/media"), importer), provider, importer, workspaceaccess.ActorFacts{UserID: "user", SessionID: "session"}
}
func imageRequest() ImageGenerationRequest {
	return ImageGenerationRequest{WorkspaceID: "ws", ProjectID: "project", PageID: "page", Operation: "generate", Prompt: "A red square", Model: ai.DefaultImageModel, Quality: "high", Size: "square_hd", Background: "auto"}
}
func runPayload(id string) string {
	encoded, _ := json.Marshal(map[string]string{"run_id": id})
	return string(encoded)
}

func TestImageGenerationPersistsReceiptAndReconcilesExactUsageAfterRecovery(t *testing.T) {
	s, provider, importer, actor := testImageService(t)
	run, err := s.Create(t.Context(), actor, "submission-1", imageRequest())
	require.NoError(t, err)
	replay, err := s.Create(t.Context(), actor, "submission-1", imageRequest())
	require.NoError(t, err)
	require.Equal(t, run.ID, replay.ID)
	changed := imageRequest()
	changed.Prompt = "Different"
	_, err = s.Create(t.Context(), actor, "submission-1", changed)
	require.ErrorIs(t, err, ErrConflict)
	payload := runPayload(run.ID)
	require.ErrorIs(t, s.HandleJob(t.Context(), payload), ErrPending)
	// Recreate the service as a process restart would, retaining only stored state.
	s = New(s.db, provider, s.storage, importer)
	importer.fail = true
	require.ErrorIs(t, s.HandleJob(t.Context(), payload), ErrPending)
	importer.fail = false
	require.ErrorIs(t, s.HandleJob(t.Context(), payload), ErrPending)
	completed, err := s.Get(t.Context(), actor, run.ID)
	require.NoError(t, err)
	require.Equal(t, "completed", completed.State)
	require.Equal(t, "result", completed.ResultMediaID)
	require.Nil(t, completed.CostMicrousd)
	charge := int64(12345)
	provider.charge = &charge
	require.NoError(t, s.HandleJob(t.Context(), payload))
	require.NoError(t, s.HandleJob(t.Context(), payload))
	require.Equal(t, 1, provider.calls)
	calls, err := aiusage.NewService(s.db).List(t.Context(), "ws", "user")
	require.NoError(t, err)
	require.Len(t, calls, 1)
	require.Equal(t, "fal", calls[0].Provider)
	require.Equal(t, "generate", calls[0].Operation)
	require.Equal(t, "fal-receipt", calls[0].ProviderRequestID)
	require.Equal(t, charge, *calls[0].CostMicrousd)
	require.Nil(t, calls[0].TotalTokens)
	_, err = s.Get(t.Context(), workspaceaccess.ActorFacts{UserID: "other", SessionID: "other-session"}, run.ID)
	require.ErrorIs(t, err, ErrNotFound)
}

func TestImageJobExhaustionReleasesActiveRunAndRetainsPaidBillingRecovery(t *testing.T) {
	s, provider, _, actor := testImageService(t)
	run, err := s.Create(t.Context(), actor, "failed-job-1", imageRequest())
	require.NoError(t, err)
	payload := runPayload(run.ID)
	require.ErrorIs(t, s.HandleJob(t.Context(), payload), ErrPending)
	require.NoError(t, s.db.RunInTx(t.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
		return s.MarkTerminalJobFailure(ctx, tx, payload)
	}))
	failed, err := s.Get(t.Context(), actor, run.ID)
	require.NoError(t, err)
	require.Equal(t, "failed", failed.State)
	require.Equal(t, "pending", failed.BillingState)
	require.NotEmpty(t, failed.ErrorMessage)
	charge := int64(7000)
	provider.charge = &charge
	require.NoError(t, s.HandleJob(t.Context(), payload))
	finished, err := s.Get(t.Context(), actor, run.ID)
	require.NoError(t, err)
	require.Equal(t, "reported", finished.BillingState)
	require.Equal(t, charge, *finished.CostMicrousd)
	require.Equal(t, 1, provider.calls)
}

func TestImageFillClipsReturnedPixelsAndRejectsInvalidMasks(t *testing.T) {
	mask := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 2; x++ {
			mask.SetNRGBA(x, y, color.NRGBA{A: 255})
		}
	}
	mask.SetNRGBA(1, 0, color.NRGBA{})
	encoded, err := pngBytes(mask)
	require.NoError(t, err)
	r := imageRequest()
	r.Operation = "fill"
	r.MaskPNG = base64.StdEncoding.EncodeToString(encoded)
	output := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 2; x++ {
			output.SetNRGBA(x, y, color.NRGBA{R: 255, A: 255})
		}
	}
	data, err := pngBytes(output)
	require.NoError(t, err)
	result, err := outputPNG(data, r)
	require.NoError(t, err)
	decoded, err := png.Decode(bytes.NewReader(result))
	require.NoError(t, err)
	inside := color.NRGBAModel.Convert(decoded.At(1, 0)).(color.NRGBA).A
	require.Equal(t, uint8(255), inside)
	for _, point := range []image.Point{{0, 0}, {0, 1}, {1, 1}} {
		_, _, _, alpha := decoded.At(point.X, point.Y).RGBA()
		require.Zero(t, alpha)
	}
	_, err = decodeMask(base64.StdEncoding.EncodeToString(data))
	require.ErrorIs(t, err, ErrInvalid)
}

func TestImageGenerationExpiredLeaseCannotOverwriteNewOwner(t *testing.T) {
	s, _, _, actor := testImageService(t)
	run, err := s.Create(t.Context(), actor, "submission-1", imageRequest())
	require.NoError(t, err)
	_, err = s.db.NewUpdate().Model((*record)(nil)).Set("lease_token = 'new-owner'").Set("lease_expires_at = ?", time.Now().Add(time.Minute)).Where("id = ?", run.ID).Exec(t.Context())
	require.NoError(t, err)
	require.ErrorIs(t, s.HandleJob(t.Context(), runPayload(run.ID)), ErrPending)
}
