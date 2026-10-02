package handlers

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"hash/crc32"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/stretchr/testify/require"
)

func TestMediaUploadRejectsActiveContent(t *testing.T) {
	for _, payload := range []struct{ name, content string }{
		{"html", "<!doctype html><script>document.title='executed'</script>"},
		{"xml", `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><script>document.title='executed'</script></html>`},
	} {
		for _, transport := range []string{"session", "session-dedup", "multipart", "batch", "stream"} {
			t.Run(payload.name+"/"+transport, func(t *testing.T) {
				if transport == "stream" {
					assertMCPUploadRejected(t, payload.content, "HTML and XML")
					return
				}
				storage := newFakeDirectUploadStorage()
				srv := newMediaDirectUploadTestServer(t, storage, entitlements.NewSelfHostedService())
				if transport == "session" || transport == "session-dedup" {
					if transport == "session-dedup" {
						hash := sha256.Sum256([]byte(payload.content))
						_, err := srv.db.NewInsert().Model(&models.MediaAttachment{ID: "old", WorkspaceID: "ws-1", FilePath: "old.bin", FileHash: hex.EncodeToString(hash[:]), AssetKind: "library", MimeType: "text/html", ProcessingStatus: "ready"}).Exec(t.Context())
						require.NoError(t, err)
					}
					id := srv.createUploadSession(t, "proof.bin", "application/octet-stream", int64(len(payload.content)))
					storage.objects[id+".bin"] = []byte(payload.content)
					response := srv.postJSON(t, "/api/v1/media/upload-session/"+id+"/complete", map[string]any{"workspace_id": "ws-1"})
					require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
					return
				}
				var body bytes.Buffer
				writer := multipart.NewWriter(&body)
				require.NoError(t, writer.WriteField("workspace_id", "ws-1"))
				field, path := "file", "/api/v1/media/upload"
				if transport == "batch" {
					field, path = "files", "/api/v1/media/batch-upload"
				}
				part, err := writer.CreatePart(textproto.MIMEHeader{"Content-Disposition": {`form-data; name="` + field + `"; filename="proof.bin"`}, "Content-Type": {"application/octet-stream"}})
				require.NoError(t, err)
				_, err = part.Write([]byte(payload.content))
				require.NoError(t, err)
				require.NoError(t, writer.Close())
				req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, &body)
				req.Header.Set("Authorization", "Bearer web-token")
				req.Header.Set("Content-Type", writer.FormDataContentType())
				response := httptest.NewRecorder()
				srv.echo.ServeHTTP(response, req)
				if transport == "batch" {
					var result struct {
						Uploaded []json.RawMessage `json:"uploaded"`
						Errors   []string          `json:"errors"`
					}
					require.Equal(t, http.StatusOK, response.Code)
					require.NoError(t, json.Unmarshal(response.Body.Bytes(), &result))
					require.Empty(t, result.Uploaded)
					require.Len(t, result.Errors, 1)
				} else {
					require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
				}
				require.Empty(t, storage.objects)
			})
		}
	}
}

func TestStoredMediaCannotRenderActiveDocuments(t *testing.T) {
	for index, mimeType := range []string{"text/html; charset=utf-8", "application/xhtml+xml", "image/svg+xml", "text/xml", "application/xml", "application/pdf", "application/octet-stream", "", "text/javascript", "text/css", "text/plain", "image/example+xml", "image/unknown"} {
		t.Run(strconv.Itoa(index), func(t *testing.T) {
			storage := newFakeDirectUploadStorage()
			srv := newMediaDirectUploadTestServer(t, storage, entitlements.NewSelfHostedService())
			content := []byte("<!doctype html><script>document.title='executed'</script>")
			storage.objects["legacy.html"] = content
			_, err := srv.db.NewInsert().Model(&models.MediaAttachment{ID: "legacy", WorkspaceID: "ws-1", FilePath: "legacy.html", MimeType: mimeType, OriginalFilename: "proof.html", ProcessingStatus: "ready"}).Exec(t.Context())
			require.NoError(t, err)
			req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/media/legacy", nil)
			req.Header.Set("Authorization", "Bearer web-token")
			response := httptest.NewRecorder()
			srv.echo.ServeHTTP(response, req)
			require.Equal(t, http.StatusOK, response.Code, response.Body.String())
			require.Equal(t, content, response.Body.Bytes())
			require.Equal(t, "application/octet-stream", response.Header().Get("Content-Type"))
			require.Contains(t, response.Header().Get("Content-Disposition"), "attachment")
			require.Equal(t, "nosniff", response.Header().Get("X-Content-Type-Options"))
			require.Contains(t, response.Header().Get("Content-Security-Policy"), "sandbox")
		})
	}
}

func TestMediaUploadSessionRejectsActiveDeclarations(t *testing.T) {
	for index, contentType := range []string{"Text/HTML; charset=utf-8", "application/xhtml+xml", "image/svg+xml; charset=utf-8", "text/xml", "application/xml", "application/example+xml"} {
		t.Run(strconv.Itoa(index), func(t *testing.T) {
			storage := newFakeDirectUploadStorage()
			srv := newMediaDirectUploadTestServer(t, storage, entitlements.NewSelfHostedService())
			response := srv.postJSON(t, "/api/v1/media/upload-session", map[string]any{"workspace_id": "ws-1", "filename": "proof.bin", "mime_type": contentType, "size": 10})
			require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
			require.Zero(t, storage.sessions)
		})
	}
}

func assertMCPUploadRejected(t *testing.T, content, expected string) {
	t.Helper()
	srv := newMCPTestServer(t)
	srv.handler.auth = mcpScopeAuthenticator{"mcp-token": {UserID: "user-1", Scope: "mcp:full", WorkspaceID: "ws-1", SessionID: "session-1", ClientID: "client-1"}}
	response := srv.request(t, "mcp-token", map[string]any{"jsonrpc": "2.0", "id": "ticket", "method": "tools/call", "params": map[string]any{"name": mcpToolCreateTicket, "arguments": map[string]any{"workspace_id": "ws-1", "filename": "proof.bin", "mime_type": "application/octet-stream", "size": len(content)}}})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var ticket struct {
		Result struct {
			Meta struct {
				Upload struct {
					Headers map[string]string `json:"headers"`
				} `json:"upload"`
			} `json:"_meta"`
		} `json:"result"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &ticket))
	authorization := ticket.Result.Meta.Upload.Headers["Authorization"]
	require.NotEmpty(t, authorization)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPut, "/mcp/media-upload", bytes.NewBufferString(content))
	req.Header.Set("Authorization", authorization)
	req.Header.Set("Content-Type", "application/octet-stream")
	result := httptest.NewRecorder()
	srv.echo.ServeHTTP(result, req)
	require.Equal(t, http.StatusBadRequest, result.Code, result.Body.String())
	require.Contains(t, result.Body.String(), expected)
	count, err := srv.db.NewSelect().Model((*models.MediaAttachment)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}

func TestStoredPassiveMediaKeepsInlineContentType(t *testing.T) {
	for _, contentType := range []string{"image/png", "video/mp4", "audio/ogg; codecs=opus", "font/woff2", "application/x-font-ttf"} {
		t.Run(contentType, func(t *testing.T) {
			storage := newFakeDirectUploadStorage()
			srv := newMediaDirectUploadTestServer(t, storage, entitlements.NewSelfHostedService())
			storage.objects["passive.bin"] = []byte("passive media")
			_, err := srv.db.NewInsert().Model(&models.MediaAttachment{ID: "passive", WorkspaceID: "ws-1", FilePath: "passive.bin", MimeType: contentType, ProcessingStatus: "ready"}).Exec(t.Context())
			require.NoError(t, err)
			req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/media/passive", nil)
			req.Header.Set("Authorization", "Bearer web-token")
			response := httptest.NewRecorder()
			srv.echo.ServeHTTP(response, req)
			require.Equal(t, http.StatusOK, response.Code)
			require.Equal(t, "passive media", response.Body.String())
			require.Equal(t, contentType, response.Header().Get("Content-Type"))
			require.Empty(t, response.Header().Get("Content-Disposition"))
			policy := response.Header().Get("Content-Security-Policy")
			require.Contains(t, policy, "sandbox allow-same-origin;")
			require.Contains(t, policy, "media-src 'self'")
			require.NotContains(t, policy, "allow-scripts")
			require.Equal(t, "nosniff", response.Header().Get("X-Content-Type-Options"))
		})
	}
}

func TestMediaUploadRequiresDecodedImagePixels(t *testing.T) {
	var valid bytes.Buffer
	require.NoError(t, png.Encode(&valid, image.NewRGBA(image.Rect(0, 0, 2, 2))))
	var jpegData, gifData bytes.Buffer
	require.NoError(t, jpeg.Encode(&jpegData, image.NewRGBA(image.Rect(0, 0, 2, 2)), nil))
	frame := image.NewPaletted(image.Rect(0, 0, 2, 2), color.Palette{color.Black, color.White})
	require.NoError(t, gif.EncodeAll(&gifData, &gif.GIF{Image: []*image.Paletted{frame, frame}, Delay: []int{1, 1}}))
	webpData, err := os.ReadFile("testdata/admission.webp")
	require.NoError(t, err)
	oversized := append([]byte(nil), valid.Bytes()...)
	binary.BigEndian.PutUint32(oversized[16:20], 100000)
	binary.BigEndian.PutUint32(oversized[20:24], 100000)
	binary.BigEndian.PutUint32(oversized[29:33], crc32.ChecksumIEEE(oversized[12:29]))
	for _, payload := range []struct {
		name      string
		content   []byte
		valid     bool
		errorText string
	}{
		{"signature", append([]byte("\x89PNG\r\n\x1a\n"), []byte("This signature has no pixels")...), false, "image file could not be decoded"},
		{"truncated", valid.Bytes()[:len(valid.Bytes())-20], false, "image file could not be decoded"},
		{"validPNG", valid.Bytes(), true, ""},
		{"validJPEGwrongExtension", jpegData.Bytes(), true, ""},
		{"validAnimatedGIF", gifData.Bytes(), true, ""},
		{"validWebP", webpData, true, ""},
		{"oversized", oversized, false, "image cannot exceed"},
	} {
		transports := []string{"session", "multipart", "batch"}
		if !payload.valid {
			transports = append(transports, "stream")
		}
		for _, transport := range transports {
			t.Run(payload.name+"/"+transport, func(t *testing.T) {
				if transport == "stream" {
					assertMCPUploadRejected(t, string(payload.content), payload.errorText)
					return
				}
				storage := newFakeDirectUploadStorage()
				srv := newMediaDirectUploadTestServer(t, storage, entitlements.NewSelfHostedService())
				var response *httptest.ResponseRecorder
				if transport == "session" {
					id := srv.createUploadSession(t, "pixels.png", "image/png", int64(len(payload.content)))
					storage.objects[id+".png"] = payload.content
					response = srv.postJSON(t, "/api/v1/media/upload-session/"+id+"/complete", map[string]any{"workspace_id": "ws-1"})
				} else {
					var body bytes.Buffer
					writer := multipart.NewWriter(&body)
					require.NoError(t, writer.WriteField("workspace_id", "ws-1"))
					field, path := "file", "/api/v1/media/upload"
					if transport == "batch" {
						field, path = "files", "/api/v1/media/batch-upload"
					}
					part, err := writer.CreatePart(textproto.MIMEHeader{"Content-Disposition": {`form-data; name="` + field + `"; filename="pixels.png"`}, "Content-Type": {"image/png"}})
					require.NoError(t, err)
					_, err = part.Write(payload.content)
					require.NoError(t, err)
					require.NoError(t, writer.Close())
					req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, &body)
					req.Header.Set("Authorization", "Bearer web-token")
					req.Header.Set("Content-Type", writer.FormDataContentType())
					response = httptest.NewRecorder()
					srv.echo.ServeHTTP(response, req)
				}
				switch {
				case payload.valid:
					require.Equal(t, http.StatusOK, response.Code, response.Body.String())
				case transport == "batch":
					require.Equal(t, http.StatusOK, response.Code, response.Body.String())
					require.Contains(t, response.Body.String(), payload.errorText)
				default:
					require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
					require.Contains(t, response.Body.String(), payload.errorText)
				}
				ready, err := srv.db.NewSelect().Model((*models.MediaAttachment)(nil)).Where("processing_status = ?", "ready").Count(t.Context())
				require.NoError(t, err)
				if payload.valid {
					require.Equal(t, 1, ready)
					var media models.MediaAttachment
					require.NoError(t, srv.db.NewSelect().Model(&media).Where("processing_status = ?", "ready").Scan(t.Context()))
					require.Equal(t, 2, media.Width)
					require.Equal(t, 2, media.Height)
					require.Equal(t, payload.content, storage.objects[filepath.Base(media.FilePath)])
				} else {
					require.Zero(t, ready)
					require.Empty(t, storage.objects)
				}
			})
		}
	}
}

func TestMediaUploadSessionDoesNotReuseCorruptReadyImage(t *testing.T) {
	content := []byte("\x89PNG\r\n\x1a\nno image pixels")
	hash := sha256.Sum256(content)
	storage := newFakeDirectUploadStorage()
	storage.objects["legacy.png"] = content
	srv := newMediaDirectUploadTestServer(t, storage, entitlements.NewSelfHostedService())
	_, err := srv.db.NewInsert().Model(&models.MediaAttachment{ID: "legacy", WorkspaceID: "ws-1", FilePath: "legacy.png", FileHash: hex.EncodeToString(hash[:]), Size: int64(len(content)), AssetKind: "library", MimeType: "image/png", ProcessingStatus: "ready"}).Exec(t.Context())
	require.NoError(t, err)
	response := srv.postJSON(t, "/api/v1/media/upload-session", map[string]any{"workspace_id": "ws-1", "filename": "pixels.png", "mime_type": "image/png", "size": len(content), "client_sha256": hex.EncodeToString(hash[:])})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var result struct {
		Deduped bool   `json:"deduped"`
		MediaID string `json:"media_id"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &result))
	require.False(t, result.Deduped)
	require.NotEqual(t, "legacy", result.MediaID)
}
