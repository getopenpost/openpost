package platform

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/gif"
	"io"
	"net"
	"net/http"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestBuildBlueskyFacetsTrimsTrailingPunctuation(t *testing.T) {
	facets := buildBlueskyFacets("see https://example.com/path.", nil)
	require.Len(t, facets, 1)
	requireFacet(t, facets, 4, 28, "app.bsky.richtext.facet#link", "uri", "https://example.com/path")
}

func TestBuildBlueskyFacetsSkipsMalformedMentionDIDs(t *testing.T) {
	facets := buildBlueskyFacets("hi @user.bsky.social", map[string]interface{}{
		"mention_dids": "user.bsky.social=not-a-did",
	})
	require.Empty(t, facets)
}

func TestBuildBlueskyPostRecordRejectsExternalCardWithMedia(t *testing.T) {
	adapter := NewBlueskyAdapter("")
	_, err := adapter.buildPostRecord("did:plc:openpost", &PublishRequest{
		Content:          "image and card",
		PlatformMediaIDs: []string{`{"$type":"blob","mimeType":"image/jpeg","size":1000}`},
		Settings: map[string]interface{}{
			"link_url": "https://example.com/path",
		},
	}, fixedBlueskyTime())

	require.ErrorContains(t, err, "bluesky external link cards cannot be combined with media")
}

func fixedBlueskyTime() time.Time {
	return time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
}

func requireFacet(t *testing.T, facets []map[string]interface{}, byteStart, byteEnd int, featureType, key, value string) {
	t.Helper()
	for _, facet := range facets {
		index := facet["index"].(map[string]int)
		if index["byteStart"] != byteStart || index["byteEnd"] != byteEnd {
			continue
		}
		features := facet["features"].([]map[string]string)
		require.Len(t, features, 1)
		require.Equal(t, featureType, features[0]["$type"])
		require.Equal(t, value, features[0][key])
		return
	}
	require.Failf(t, "facet not found", "missing facet %d-%d in %#v", byteStart, byteEnd, facets)
}

type resolverFunc func(context.Context, string) ([]net.IPAddr, error)

func (fn resolverFunc) LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error) {
	return fn(ctx, host)
}

func stubBlueskyResolution(t *testing.T, responses map[string]string, calls *int) {
	t.Helper()

	originalClient := httpClient
	originalOverride := blueskyPDSClientOverride
	originalResolver := blueskyPDSDNSResolver
	t.Cleanup(func() {
		httpClient = originalClient
		blueskyPDSClientOverride = originalOverride
		blueskyPDSDNSResolver = originalResolver
	})

	blueskyPDSDNSResolver = resolverFunc(func(_ context.Context, host string) ([]net.IPAddr, error) {
		if host == "private.example" {
			return []net.IPAddr{{IP: net.ParseIP("10.0.0.5")}}, nil
		}
		return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
	})
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if calls != nil {
			*calls++
		}
		body, ok := responses[req.URL.String()]
		if !ok {
			return &http.Response{StatusCode: http.StatusNotFound, Body: io.NopCloser(strings.NewReader("{}")), Request: req}, nil
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Request: req}, nil
	})}
	blueskyPDSClientOverride = httpClient
}

func blueskyDIDDocument(did, handle, endpoint string) string {
	alsoKnownAs := ""
	if handle != "" {
		alsoKnownAs = `,"alsoKnownAs":["at://` + handle + `"]`
	}
	return `{"id":"` + did + `"` + alsoKnownAs + `,"service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"` + endpoint + `"}]}`
}

func TestResolvedBlueskyAdapterRevalidatesPDSBeforeSendingCredentials(t *testing.T) {
	stubBlueskyResolution(t, nil, nil)
	blueskyPDSDNSResolver = resolverFunc(func(_ context.Context, _ string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("10.0.0.5")}}, nil
	})
	adapter := NewResolvedBlueskyAdapter("https://private.example")

	did, handle, accessToken, refreshToken, expiresIn, err := adapter.CreateSession(t.Context(), "alice.example", "app-password")
	require.ErrorContains(t, err, "private or local address")
	require.Empty(t, did)
	require.Empty(t, handle)
	require.Empty(t, accessToken)
	require.Empty(t, refreshToken)
	require.Zero(t, expiresIn)
}

func TestResolveBlueskyComposerReferencesUsesCompleteHandlesAndByteFacets(t *testing.T) {
	originalClient := httpClient
	t.Cleanup(func() { httpClient = originalClient })

	resolvedHandles := []string{}
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		handle := req.URL.Query().Get("handle")
		resolvedHandles = append(resolvedHandles, handle)
		return jsonResponse(req, `{"did":"did:plc:`+strings.ReplaceAll(handle, ".", "-")+`"}`), nil
	})}

	adapter := NewBlueskyAdapter("")
	request := &PublishRequest{
		Content:  "👅💦 @mercurykitsune.bsky.social and @anielde.bsky.social",
		Settings: map[string]interface{}{},
	}
	require.NoError(t, adapter.resolveBlueskyComposerReferences(t.Context(), "token", request))
	require.Equal(t, []string{"mercurykitsune.bsky.social", "anielde.bsky.social"}, resolvedHandles)

	encoded, ok := request.Settings["mention_dids"].(string)
	require.True(t, ok)
	var mentions map[string]string
	require.NoError(t, json.Unmarshal([]byte(encoded), &mentions))
	require.Contains(t, mentions, "mercurykitsune.bsky.social")
	require.Contains(t, mentions, "anielde.bsky.social")

	facets := buildBlueskyFacets(request.Content, request.Settings)
	requireFacet(t, facets, 9, 36, "app.bsky.richtext.facet#mention", "did", mentions["mercurykitsune.bsky.social"])
	requireFacet(t, facets, 41, 61, "app.bsky.richtext.facet#mention", "did", mentions["anielde.bsky.social"])
}

// The adapter reached through a bluesky:<pds> key must build content identities
// on the same base the account stores, or discovery cannot match its renditions.
func TestBlueskyUnrepostOnlyIgnoresMissingRecord(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	tests := []struct {
		name    string
		status  int
		body    string
		wantErr bool
	}{
		{name: "missing record", status: http.StatusBadRequest, body: `{"error":"RecordNotFound"}`},
		{name: "unrelated not found", status: http.StatusNotFound, body: `{"error":"NotFound"}`, wantErr: true},
		{name: "other bad request", status: http.StatusBadRequest, body: `{"error":"InvalidRequest"}`, wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			requests := 0
			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				requests++
				return &http.Response{StatusCode: test.status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(test.body)), Request: req}, nil
			})}
			adapter := NewBlueskyAdapter(BlueskyDefaultPDSURL)
			err := adapter.Unrepost(t.Context(), "token", "did:plc:target", UnrepostRequest{
				RepostExternalID: `{"uri":"at://did:plc:target/app.bsky.feed.repost/record-key","cid":"cid"}`,
			})
			require.Equal(t, 1, requests)
			if test.wantErr {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestBuildBlueskyPostRecordEmbedsGIFAsVideoWithGIFPresentation(t *testing.T) {
	adapter := NewBlueskyAdapter("")
	blobJSON := `{"$type":"blob","ref":{"$link":"bafkreigifvideo"},"mimeType":"video/mp4","size":4096}`

	record, err := adapter.buildPostRecord("did:plc:openpost", &PublishRequest{
		Content:          "Animated reaction",
		PlatformMediaIDs: []string{blobJSON},
		MediaAltTexts:    []string{"Waving mascot"},
		Media:            []MediaItem{{ID: "gif-1", MimeType: "image/gif", Width: 480, Height: 270}},
	}, fixedBlueskyTime())
	require.NoError(t, err)

	embed, ok := record["embed"].(map[string]interface{})
	require.True(t, ok)
	require.Equal(t, "app.bsky.embed.video", embed["$type"])
	require.Equal(t, "gif", embed["presentation"])
	require.Equal(t, "Waving mascot", embed["alt"])
	require.Equal(t, map[string]int{"width": 480, "height": 270}, embed["aspectRatio"])

	// Regular video embeds do not carry presentation="gif".
	videoRecord, err := adapter.buildPostRecord("did:plc:openpost", &PublishRequest{
		Content:          "Clip",
		PlatformMediaIDs: []string{blobJSON},
		Media:            []MediaItem{{ID: "vid-1", MimeType: "video/mp4", Width: 1280, Height: 720}},
	}, fixedBlueskyTime())
	require.NoError(t, err)
	videoEmbed := videoRecord["embed"].(map[string]interface{})
	require.Equal(t, "app.bsky.embed.video", videoEmbed["$type"])
	require.NotContains(t, videoEmbed, "presentation")

	// Multiple attachments with a GIF are rejected.
	_, err = adapter.buildPostRecord("did:plc:openpost", &PublishRequest{
		Content:          "Too many",
		PlatformMediaIDs: []string{blobJSON, blobJSON},
		Media: []MediaItem{
			{ID: "gif-1", MimeType: "image/gif"},
			{ID: "img-1", MimeType: "image/jpeg"},
		},
	}, fixedBlueskyTime())
	require.ErrorContains(t, err, "only one gif")
}

func TestBlueskyUploadMediaConvertsGIFAndUploadsToVideoService(t *testing.T) {
	originalClient := httpClient
	originalConverter := blueskyGIFToMP4
	defer func() {
		httpClient = originalClient
		blueskyGIFToMP4 = originalConverter
	}()

	converted := false
	blueskyGIFToMP4 = func(_ context.Context, r io.Reader) ([]byte, error) {
		converted = true
		data, err := io.ReadAll(r)
		require.NoError(t, err)
		require.Equal(t, []byte("GIF89a"), data)
		return []byte("fake-mp4-bytes"), nil
	}

	uploadedContentType := ""
	uploadedBody := ""
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch {
		case strings.Contains(req.URL.Path, "com.atproto.server.getSession"):
			return jsonResponse(req, `{"did":"did:plc:openpost","emailConfirmed":true}`), nil
		case strings.Contains(req.URL.Path, "com.atproto.server.getServiceAuth"):
			return jsonResponse(req, `{"token":"video-service-token"}`), nil
		case req.URL.Host == "video.bsky.app" && strings.Contains(req.URL.Path, "app.bsky.video.uploadVideo"):
			uploadedContentType = req.Header.Get("Content-Type")
			body, err := io.ReadAll(req.Body)
			require.NoError(t, err)
			uploadedBody = string(body)
			return jsonResponse(req, `{"jobStatus":{"jobId":"job-1","state":"JOB_STATE_COMPLETED","blob":{"$type":"blob","ref":{"$link":"bafkreigifmp4"},"mimeType":"video/mp4","size":14}}}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewBlueskyAdapter(BlueskyDefaultPDSURL)
	blobJSON, err := adapter.UploadMedia(t.Context(), base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none"}`))+"."+base64.RawURLEncoding.EncodeToString([]byte(`{"aud":"did:web:bsky.social"}`))+".", "did:plc:openpost", "image/gif", bytes.NewReader([]byte("GIF89a")))
	require.NoError(t, err)
	require.True(t, converted)
	require.Equal(t, "video/mp4", uploadedContentType)
	require.Equal(t, "fake-mp4-bytes", uploadedBody)
	require.Contains(t, blobJSON, "bafkreigifmp4")
}

func TestConvertGIFToMP4ProducesMP4WithOddDimensions(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed in PATH")
	}
	palette := color.Palette{color.RGBA{R: 255, A: 255}, color.RGBA{B: 255, A: 255}}
	frame1 := image.NewPaletted(image.Rect(0, 0, 3, 3), palette)
	frame2 := image.NewPaletted(image.Rect(0, 0, 3, 3), palette)
	for i := range frame2.Pix {
		frame2.Pix[i] = 1
	}
	var buf bytes.Buffer
	require.NoError(t, gif.EncodeAll(&buf, &gif.GIF{
		Image: []*image.Paletted{frame1, frame2},
		Delay: []int{10, 10},
	}))

	mp4Data, err := convertGIFToMP4(t.Context(), &buf)
	require.NoError(t, err)
	require.NotEmpty(t, mp4Data)
	require.True(t, bytes.Contains(mp4Data, []byte("ftyp")), "expected valid MP4 ftyp header")
}
