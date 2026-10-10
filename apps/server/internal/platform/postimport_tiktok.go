package platform

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func (t *TikTokAdapter) NativePostSupport() NativePostSupport {
	if !t.capabilities.Analytics && !t.capabilities.Discovery {
		return NativePostSupport{UnavailableReason: "TikTok imports require Display API access, which is disabled on this instance."}
	}
	support := nativePostSupport(tiktokScopeVideoList)
	support.MaxPageSize = 20
	return support
}
func (t *TikTokAdapter) ListNativePosts(ctx context.Context, token string, input NativePostRequest) (NativePostPage, error) {
	if !t.NativePostSupport().Supported {
		return NativePostPage{}, NewNativePostError(NativePostUnsupported, "display_api_disabled", 0)
	}
	payload := map[string]any{"max_count": nativePostPageSize(input, t.NativePostSupport())}
	if input.Cursor != "" {
		cursor, err := strconv.ParseInt(input.Cursor, 10, 64)
		if err != nil || cursor < 0 {
			return NativePostPage{}, NewNativePostError(NativePostFailed, "invalid_cursor", 0)
		}
		payload["cursor"] = cursor
	}
	result, err := DoBearerJSON[struct {
		Data struct {
			Videos []struct {
				ID          string `json:"id"`
				Title       string `json:"title"`
				Description string `json:"video_description"`
				CreateTime  int64  `json:"create_time"`
				ShareURL    string `json:"share_url"`
			} `json:"videos"`
			Cursor  int64 `json:"cursor"`
			HasMore bool  `json:"has_more"`
		} `json:"data"`
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}](ctx, http.MethodPost, "https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,create_time,share_url", token, payload, "native videos")
	if err != nil {
		return NativePostPage{}, classifyNativePostError(err)
	}
	if result.Error.Code != "ok" {
		status := http.StatusBadRequest
		if isTikTokScopeDeniedCode(result.Error.Code) || result.Error.Code == "access_token_invalid" {
			status = http.StatusForbidden
		}
		if result.Error.Code == "rate_limit_exceeded" {
			status = http.StatusTooManyRequests
		}
		return NativePostPage{}, classifyNativePostError(&HTTPError{StatusCode: status, Code: result.Error.Code})
	}
	next := ""
	if result.Data.HasMore {
		next = strconv.FormatInt(result.Data.Cursor, 10)
	}
	page, err := nativePostContinuation(next, input.Cursor)
	if err != nil {
		return page, err
	}
	for _, video := range result.Data.Videos {
		if video.CreateTime <= 0 {
			continue
		}
		published := time.Unix(video.CreateTime, 0).UTC()
		if !published.After(input.PublishedAfter) {
			page.NextCursor = ""
			page.Coverage = NativePostComplete
			continue
		}
		appendNativePost(&page, input, NativePostItem{ProviderPostID: video.ID, IdentityAliases: tiktokShareIdentity(video.ShareURL), Title: video.Title, Text: video.Description, PublishedAt: published, ExternalURL: video.ShareURL})
	}
	return page, nil
}

func tiktokShareIdentity(rawURL string) []string {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Scheme != "https" || (parsed.Host != "www.tiktok.com" && parsed.Host != "tiktok.com") || parsed.User != nil {
		return nil
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) != 3 || !strings.HasPrefix(parts[0], "@") || (parts[1] != "photo" && parts[1] != "video") || !numericContent.MatchString(parts[2]) {
		return nil
	}
	return []string{parts[2]}
}
