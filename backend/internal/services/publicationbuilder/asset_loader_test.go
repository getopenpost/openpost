package publicationbuilder

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"io"
	"testing"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

type builderAssetStorage struct {
	data map[string][]byte
}

func (storage builderAssetStorage) Driver() string { return "test" }
func (storage builderAssetStorage) Save(context.Context, string, io.Reader) (string, error) {
	return "", errors.New("unexpected save")
}
func (storage builderAssetStorage) Delete(context.Context, string) error {
	return errors.New("unexpected delete")
}
func (storage builderAssetStorage) GetURL(string) string { return "" }
func (storage builderAssetStorage) Open(_ context.Context, id string) (io.ReadCloser, error) {
	data, ok := storage.data[id]
	if !ok {
		return nil, errors.New("missing object")
	}
	return io.NopCloser(bytes.NewReader(data)), nil
}

func TestMediaAssetLoaderPreservesSourceOrderAndModalities(t *testing.T) {
	db := newBuilderAssetTestDB(t)
	rows := []models.MediaAttachment{
		{ID: "image", WorkspaceID: "workspace-1", FilePath: "image-key", MimeType: "image/png", ProcessingStatus: "ready", Size: 5, OriginalFilename: "proof.png", AltText: "A deletion summary"},
		{ID: "audio", WorkspaceID: "workspace-1", FilePath: "audio-key", MimeType: "audio/mpeg", ProcessingStatus: "ready", Size: 5, OriginalFilename: "note.mp3", DurationMS: 4_200},
		{ID: "video", WorkspaceID: "workspace-1", FilePath: "video-key", MimeType: "video/mp4", ProcessingStatus: "ready", Size: 4, OriginalFilename: "demo.mp4", Width: 1080, Height: 1920},
		{ID: "document", WorkspaceID: "workspace-1", FilePath: "document-key", MimeType: "application/pdf", ProcessingStatus: "ready", Size: 4, OriginalFilename: "../brief.pdf"},
	}
	_, err := db.NewInsert().Model(&rows).Exec(t.Context())
	require.NoError(t, err)
	loader := NewMediaAssetLoader(db, builderAssetStorage{data: map[string][]byte{
		"image-key": []byte("image"), "audio-key": []byte("audio"),
		"video-key": []byte("clip"), "document-key": []byte("%PDF"),
	}})

	loaded, err := loader.Load(t.Context(), "workspace-1", []BuildAsset{
		{MediaID: "video", Role: "artifact", MayPublish: true},
		{MediaID: "document", Role: "evidence"},
		{MediaID: "image", Role: "evidence"},
		{MediaID: "audio", Role: "context"},
	})
	require.NoError(t, err)
	require.Equal(t, []string{"media:video", "media:document", "media:image", "media:audio"}, []string{
		loaded.Sources[0].ID, loaded.Sources[1].ID, loaded.Sources[2].ID, loaded.Sources[3].ID,
	})
	require.Contains(t, loaded.Sources[0].Text, "approved for publication")
	require.True(t, loaded.Sources[0].Publishable)
	require.False(t, loaded.Sources[1].Publishable)
	require.Equal(t, []string{"video/mp4", "application/pdf", "image/png", "audio/mpeg"}, []string{
		loaded.Sources[0].MIMEType, loaded.Sources[1].MIMEType, loaded.Sources[2].MIMEType, loaded.Sources[3].MIMEType,
	})
	require.Len(t, loaded.Parts, 4)
	require.Equal(t, []string{"media:video", "media:document", "media:image", "media:audio"}, []string{
		loaded.Parts[0].SourceID, loaded.Parts[1].SourceID, loaded.Parts[2].SourceID, loaded.Parts[3].SourceID,
	})
	require.NotNil(t, loaded.Parts[0].Video)
	require.NotNil(t, loaded.Parts[1].File)
	require.Equal(t, "brief.pdf", loaded.Parts[1].File.Filename)
	require.NotNil(t, loaded.Parts[2].Image)
	require.NotNil(t, loaded.Parts[3].Audio)
	require.Empty(t, loaded.Images)
	require.Empty(t, loaded.Files)
	require.Empty(t, loaded.Audio)
	require.Empty(t, loaded.Videos)
}

func TestMediaAssetLoaderRejectsWorkspaceCrossingAndOversizedBytes(t *testing.T) {
	db := newBuilderAssetTestDB(t)
	rows := []models.MediaAttachment{
		{ID: "outside", WorkspaceID: "workspace-2", FilePath: "outside", MimeType: "image/png", ProcessingStatus: "ready", Size: 1},
		{ID: "first", WorkspaceID: "workspace-1", FilePath: "first", MimeType: "text/plain", ProcessingStatus: "ready", Size: 1},
		{ID: "large", WorkspaceID: "workspace-1", FilePath: "large", MimeType: "application/pdf", ProcessingStatus: "ready", Size: 1},
	}
	_, err := db.NewInsert().Model(&rows).Exec(t.Context())
	require.NoError(t, err)
	loader := NewMediaAssetLoader(db, builderAssetStorage{data: map[string][]byte{
		"outside": []byte("x"),
		"first":   []byte("x"),
		"large":   bytes.Repeat([]byte("x"), int(maxBuilderDocumentBytes)+1),
	}})

	_, err = loader.Load(t.Context(), "workspace-1", []BuildAsset{{MediaID: "outside"}})
	require.ErrorContains(t, errors.Unwrap(err), "outside the Workspace")
	_, err = loader.Load(t.Context(), "workspace-1", []BuildAsset{{MediaID: "large"}})
	require.ErrorContains(t, errors.Unwrap(err), "size limit")
	_, err = loader.Load(t.Context(), "workspace-1", []BuildAsset{{MediaID: "first"}, {MediaID: "large"}})
	require.EqualError(t, err, "selected asset 2 is unavailable")
	require.ErrorContains(t, errors.Unwrap(err), "size limit")
}

func newBuilderAssetTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqlDB, err := sql.Open("sqlite3", "file:"+t.Name()+"?mode=memory&cache=shared")
	require.NoError(t, err)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	_, err = db.NewCreateTable().Model((*models.MediaAttachment)(nil)).Exec(context.Background())
	require.NoError(t, err)
	return db
}
