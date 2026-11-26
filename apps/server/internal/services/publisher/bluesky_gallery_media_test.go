package publisher

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"net"
	"os"
	"testing"
	"testing/iotest"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/providerlimits"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/stretchr/testify/require"
)

func blueskyGalleryStoredMedia(count int) []models.MediaAttachment {
	media := make([]models.MediaAttachment, count)
	for i := range media {
		media[i] = models.MediaAttachment{
			ID:       fmt.Sprintf("image-%d", i),
			MimeType: "image/png",
			FilePath: fmt.Sprintf("image-%d.png", i),
			Width:    32,
			Height:   17,
		}
	}
	return media
}

func blueskyGalleryPNG(t *testing.T) []byte {
	t.Helper()
	var encoded bytes.Buffer
	require.NoError(t, png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 32, 17))))
	return encoded.Bytes()
}

func blueskyGalleryFixtureStorage(data []byte, opened *[]string) func(context.Context, string) (io.ReadCloser, error) {
	return func(_ context.Context, key string) (io.ReadCloser, error) {
		if opened != nil {
			*opened = append(*opened, key)
		}
		return io.NopCloser(bytes.NewReader(data)), nil
	}
}

func TestBlueskyGalleryPreflightChecksEveryObjectAndRecoversLegacyDimensions(t *testing.T) {
	imageBytes := blueskyGalleryPNG(t)
	for _, count := range []int{5, 10} {
		t.Run(fmt.Sprintf("%d images", count), func(t *testing.T) {
			media := blueskyGalleryStoredMedia(count)
			media[2].Width, media[2].Height = 0, 0
			var opened []string
			err := checkBlueskyGalleryMedia(t.Context(), media, blueskyGalleryFixtureStorage(imageBytes, &opened))
			require.NoError(t, err)
			require.Len(t, opened, count, "metadata must never bypass stored-object verification")
			for i := range media {
				require.Equal(t, fmt.Sprintf("image-%d.png", i), opened[i])
				require.Equal(t, 32, media[i].Width)
				require.Equal(t, 17, media[i].Height)
				require.Equal(t, int64(len(imageBytes)), media[i].Size)
			}
		})
	}
}

func TestBlueskyGalleryPreflightVerifiesJPEGAndPreservesLegacyImages(t *testing.T) {
	var encoded bytes.Buffer
	require.NoError(t, jpeg.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 15, 23)), nil))
	pngBytes := blueskyGalleryPNG(t)
	media := blueskyGalleryStoredMedia(5)
	media[4].MimeType = "image/jpeg"
	media[4].FilePath = "photo.jpg"
	media[4].Width, media[4].Height = 0, 0
	err := checkBlueskyGalleryMedia(t.Context(), media, func(_ context.Context, key string) (io.ReadCloser, error) {
		if key == "photo.jpg" {
			return io.NopCloser(bytes.NewReader(encoded.Bytes())), nil
		}
		return io.NopCloser(bytes.NewReader(pngBytes)), nil
	})
	require.NoError(t, err)
	require.Equal(t, 15, media[4].Width)
	require.Equal(t, 23, media[4].Height)

	for _, count := range []int{1, 4} {
		legacy := blueskyGalleryStoredMedia(count)
		legacy[0].Width, legacy[0].Height = 0, 0
		require.NoError(t, checkBlueskyGalleryMedia(t.Context(), legacy, nil),
			"pre-existing 1-4 image posts must not acquire mandatory storage reads")
	}
}

func TestBlueskyGalleryPreflightRejectsMissingCorruptOrInconsistentObjects(t *testing.T) {
	pngBytes := blueskyGalleryPNG(t)
	for _, test := range []struct {
		name    string
		change  func([]models.MediaAttachment)
		payload []byte
		openErr error
		want    string
	}{
		{"missing stored object despite known dimensions", nil, nil, errors.New("private storage detail"), "cannot be opened"},
		{"corrupt stored object despite known dimensions", nil, []byte("not an image"), nil, "invalid image header"},
		{"truncated image", nil, pngBytes[:len(pngBytes)-12], nil, "corrupt or truncated"},
		{"MIME mismatch", func(m []models.MediaAttachment) { m[2].MimeType = "image/jpeg" }, pngBytes, nil, "MIME/content mismatch"},
		{"metadata width mismatch", func(m []models.MediaAttachment) { m[2].Width = 31 }, pngBytes, nil, "do not match recorded metadata"},
		{"metadata height mismatch", func(m []models.MediaAttachment) { m[2].Height = 18 }, pngBytes, nil, "do not match recorded metadata"},
		{"stored size mismatch", func(m []models.MediaAttachment) { m[2].Size = 12345 }, pngBytes, nil, "size does not match"},
		{"empty object", nil, nil, nil, "stored object is empty"},
		{"over limit", nil, bytes.Repeat([]byte{0}, providerlimits.BlueskyImageMaxBytes+1), nil, "exceeds 2000000"},
	} {
		t.Run(test.name, func(t *testing.T) {
			media := blueskyGalleryStoredMedia(5)
			if test.change != nil {
				test.change(media)
			}
			payload := test.payload
			if payload == nil && test.openErr == nil && test.name != "empty object" {
				payload = pngBytes
			}
			err := checkBlueskyGalleryMedia(t.Context(), media, func(_ context.Context, key string) (io.ReadCloser, error) {
				if key == media[2].FilePath {
					if test.openErr != nil {
						return nil, test.openErr
					}
					return io.NopCloser(bytes.NewReader(payload)), nil
				}
				return io.NopCloser(bytes.NewReader(pngBytes)), nil
			})
			require.ErrorContains(t, err, test.want)
			require.NotContains(t, err.Error(), "private storage detail")
		})
	}
}

func TestBlueskyGalleryPreflightEnforcesActualByteBoundary(t *testing.T) {
	pngBytes := blueskyGalleryPNG(t)
	for _, size := range []int{providerlimits.BlueskyImageMaxBytes - 1, providerlimits.BlueskyImageMaxBytes, providerlimits.BlueskyImageMaxBytes + 1} {
		t.Run(fmt.Sprintf("%d bytes", size), func(t *testing.T) {
			media := blueskyGalleryStoredMedia(5)
			data := append(append([]byte(nil), pngBytes...), bytes.Repeat([]byte{0}, size-len(pngBytes))...)
			media[0].Size = int64(size)
			err := checkBlueskyGalleryMedia(t.Context(), media, func(_ context.Context, key string) (io.ReadCloser, error) {
				if key == "image-0.png" {
					return io.NopCloser(bytes.NewReader(data)), nil
				}
				return io.NopCloser(bytes.NewReader(pngBytes)), nil
			})
			if size > providerlimits.BlueskyImageMaxBytes {
				require.ErrorContains(t, err, "exceeds 2000000")
			} else {
				require.NoError(t, err)
				require.Equal(t, int64(size), media[0].Size)
			}
		})
	}
}

func TestBlueskyGalleryPreflightRejectsUnsupportedMediaBeforeObjectAccess(t *testing.T) {
	for _, test := range []struct {
		name  string
		media []models.MediaAttachment
		want  string
	}{
		{"too many images", blueskyGalleryStoredMedia(11), "up to 10"},
		{"gallery with GIF", func() []models.MediaAttachment {
			m := blueskyGalleryStoredMedia(5)
			m[2].MimeType = "image/gif"
			return m
		}(), "only one gif"},
		{"images with GIF", func() []models.MediaAttachment {
			m := blueskyGalleryStoredMedia(4)
			m[0].MimeType = "image/gif"
			return m
		}(), "only one gif"},
		{"unsupported image", func() []models.MediaAttachment {
			m := blueskyGalleryStoredMedia(5)
			m[2].MimeType = "image/heic"
			return m
		}(), "JPEG, PNG, WebP"},
		{"video before image", func() []models.MediaAttachment {
			m := blueskyGalleryStoredMedia(2)
			m[0].MimeType = "video/mp4"
			return m
		}(), "mixing video"},
		{"video after image", func() []models.MediaAttachment {
			m := blueskyGalleryStoredMedia(2)
			m[1].MimeType = "video/mp4"
			return m
		}(), "mixing video"},
		{"multiple videos", []models.MediaAttachment{{MimeType: "video/mp4"}, {MimeType: "video/mp4"}}, "mixing video"},
		{"unsupported video", []models.MediaAttachment{{MimeType: "video/quicktime"}}, "single MP4"},
	} {
		t.Run(test.name, func(t *testing.T) {
			openCalls := 0
			err := checkBlueskyGalleryMedia(t.Context(), test.media, func(context.Context, string) (io.ReadCloser, error) {
				openCalls++
				return nil, errors.New("unexpected storage read")
			})
			require.ErrorContains(t, err, test.want)
			require.Zero(t, openCalls)
		})
	}
	require.NoError(t, checkBlueskyGalleryMedia(t.Context(), []models.MediaAttachment{{MimeType: "video/mp4"}}, nil))
	require.NoError(t, checkBlueskyGalleryMedia(t.Context(), []models.MediaAttachment{{MimeType: "image/gif", Size: 5_000_000}}, nil))
}

func TestBlueskyGalleryPreflightRespectsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := checkBlueskyGalleryMedia(ctx, blueskyGalleryStoredMedia(5), blueskyGalleryFixtureStorage(blueskyGalleryPNG(t), nil))
	require.ErrorIs(t, err, context.Canceled)
}

func TestBlueskyGalleryPreflightKeepsTransientStorageFailuresRetryable(t *testing.T) {
	timeout := &net.OpError{Op: "dial", Net: "tcp", Err: os.ErrDeadlineExceeded}
	for name, test := range map[string]struct {
		open    func(context.Context, string) (io.ReadCloser, error)
		message string
	}{
		"open": {func(context.Context, string) (io.ReadCloser, error) { return nil, timeout }, "stored object cannot be opened"},
		"read": {func(context.Context, string) (io.ReadCloser, error) {
			return io.NopCloser(iotest.ErrReader(timeout)), nil
		}, "stored object cannot be read"},
	} {
		t.Run(name, func(t *testing.T) {
			err := checkBlueskyGalleryMedia(t.Context(), blueskyGalleryStoredMedia(5), test.open)
			require.ErrorContains(t, err, test.message)
			require.NotContains(t, err.Error(), "dial tcp")
			require.Equal(t, FailureNetwork, ClassifyFailure(err).Kind)
		})
	}

	missing := func(context.Context, string) (io.ReadCloser, error) { return nil, os.ErrNotExist }
	err := checkBlueskyGalleryMedia(t.Context(), blueskyGalleryStoredMedia(5), missing)
	require.NotEqual(t, FailureNetwork, ClassifyFailure(err).Kind)
}

func TestBlueskyGalleryPreflightFailsWithoutStorage(t *testing.T) {
	require.ErrorContains(t,
		checkBlueskyGalleryMedia(t.Context(), blueskyGalleryStoredMedia(5), nil),
		"stored object is unavailable")
}

func TestBlueskyGalleryPreflightReadsRealLocalStorageAndFailsOnDeletedObject(t *testing.T) {
	storage := mediastore.NewLocalStorage(t.TempDir(), "/media")
	imageBytes := blueskyGalleryPNG(t)
	media := blueskyGalleryStoredMedia(5)
	for i := range media {
		path, err := storage.Save(t.Context(), media[i].FilePath, bytes.NewReader(imageBytes))
		require.NoError(t, err)
		media[i].FilePath = path
	}
	require.NoError(t, checkBlueskyGalleryMedia(t.Context(), media, storage.Open))
	require.NoError(t, os.Remove(media[4].FilePath))
	require.ErrorContains(t, checkBlueskyGalleryMedia(t.Context(), media, storage.Open), "cannot be opened")
}
