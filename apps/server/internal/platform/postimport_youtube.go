package platform

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

type nativeYouTubeCursor struct {
	Uploads   string `json:"uploads"`
	PageToken string `json:"page_token"`
}

func (y *YouTubeAdapter) NativePostSupport() NativePostSupport {
	return nativePostSupport("https://www.googleapis.com/auth/youtube.readonly")
}
func (y *YouTubeAdapter) ResolveAccountNativePostSupport(input NativePostAccountContext) NativePostSupport {
	// Google grants either the read-only scope or a superset used for publishing.
	for _, scope := range strings.Fields(input.GrantedScopes) {
		if scope == "https://www.googleapis.com/auth/youtube" || scope == "https://www.googleapis.com/auth/youtube.force-ssl" || scope == "https://www.googleapis.com/auth/youtube.readonly" {
			return nativePostSupport()
		}
	}
	return y.NativePostSupport()
}
func (y *YouTubeAdapter) NativePostReadCost(input NativePostRequest) int {
	if input.Cursor == "" {
		return 3
	}
	return 2
}
func (y *YouTubeAdapter) ListNativePosts(ctx context.Context, token string, input NativePostRequest) (NativePostPage, error) {
	if input.AccountID == "" {
		return NativePostPage{}, NewNativePostError(NativePostFailed, "missing_channel", 0)
	}
	cursor, err := y.nativeUploadsCursor(ctx, token, input)
	if err != nil {
		return NativePostPage{}, err
	}
	query := url.Values{"part": {"contentDetails"}, "playlistId": {cursor.Uploads}, "maxResults": {strconv.Itoa(nativePostPageSize(input, y.NativePostSupport()))}}
	if cursor.PageToken != "" {
		query.Set("pageToken", cursor.PageToken)
	}
	playlist, err := DoBearerJSON[struct {
		Items []struct {
			ContentDetails struct {
				VideoID string `json:"videoId"`
			} `json:"contentDetails"`
		} `json:"items"`
		NextPageToken string `json:"nextPageToken"`
	}](ctx, http.MethodGet, youtubeAPIBaseURL+"/playlistItems?"+query.Encode(), token, nil, "native uploads")
	if err != nil {
		return NativePostPage{}, classifyNativePostError(err)
	}
	next := ""
	if playlist.NextPageToken != "" {
		cursor.PageToken = playlist.NextPageToken
		encoded, marshalErr := json.Marshal(cursor)
		if marshalErr != nil {
			return NativePostPage{}, NewNativePostError(NativePostFailed, "invalid_cursor", 0)
		}
		next = base64.RawURLEncoding.EncodeToString(encoded)
	}
	page, err := nativePostContinuation(next, input.Cursor)
	if err != nil {
		return page, err
	}
	ids := []string{}
	for _, item := range playlist.Items {
		if item.ContentDetails.VideoID != "" {
			ids = append(ids, item.ContentDetails.VideoID)
		}
	}
	if len(ids) == 0 {
		return page, nil
	}
	videos, err := DoBearerJSON[struct {
		Items []nativeYouTubeVideo `json:"items"`
	}](ctx, http.MethodGet, youtubeAPIBaseURL+"/videos?"+url.Values{"part": {"snippet,status"}, "id": {strings.Join(ids, ",")}}.Encode(), token, nil, "native video details")
	if err != nil {
		return NativePostPage{}, classifyNativePostError(err)
	}
	for _, video := range videos.Items {
		if !video.isPublishedBy(input.AccountID) {
			continue
		}
		// Playlist insertion time is not a video's publication time. The videos
		// resource also handles older uploads made public after activation.
		appendNativePost(&page, input, NativePostItem{ProviderPostID: video.ID, Title: video.Snippet.Title, Text: video.Snippet.Description, PublishedAt: nativePostTime(video.Snippet.PublishedAt), ExternalURL: youtubeContentURL(video.ID)})
	}
	return page, nil
}

func (y *YouTubeAdapter) nativeUploadsCursor(ctx context.Context, token string, input NativePostRequest) (nativeYouTubeCursor, error) {
	cursor := nativeYouTubeCursor{}
	if input.Cursor != "" {
		data, err := base64.RawURLEncoding.DecodeString(input.Cursor)
		if err != nil || json.Unmarshal(data, &cursor) != nil || cursor.Uploads == "" || cursor.PageToken == "" {
			return nativeYouTubeCursor{}, NewNativePostError(NativePostFailed, "invalid_cursor", 0)
		}
	} else {
		channels, err := DoBearerJSON[struct {
			Items []struct {
				ID             string `json:"id"`
				ContentDetails struct {
					RelatedPlaylists struct {
						Uploads string `json:"uploads"`
					} `json:"relatedPlaylists"`
				} `json:"contentDetails"`
			} `json:"items"`
		}](ctx, http.MethodGet, youtubeAPIBaseURL+"/channels?"+url.Values{"part": {"contentDetails"}, "id": {input.AccountID}}.Encode(), token, nil, "native uploads playlist")
		if err != nil {
			return nativeYouTubeCursor{}, classifyNativePostError(err)
		}
		for _, channel := range channels.Items {
			if channel.ID == input.AccountID {
				cursor.Uploads = channel.ContentDetails.RelatedPlaylists.Uploads
			}
		}
		if cursor.Uploads == "" {
			return nativeYouTubeCursor{}, NewNativePostError(NativePostPermissionRequired, "channel_unavailable", 0)
		}
	}
	return cursor, nil
}

type nativeYouTubeVideo struct {
	ID      string `json:"id"`
	Snippet struct {
		ChannelID   string `json:"channelId"`
		Title       string `json:"title"`
		Description string `json:"description"`
		PublishedAt string `json:"publishedAt"`
	} `json:"snippet"`
	Status struct {
		PrivacyStatus string `json:"privacyStatus"`
		UploadStatus  string `json:"uploadStatus"`
	} `json:"status"`
}

func (video nativeYouTubeVideo) isPublishedBy(channelID string) bool {
	return video.Snippet.ChannelID == channelID && video.Status.PrivacyStatus == "public" && video.Status.UploadStatus == "processed"
}
