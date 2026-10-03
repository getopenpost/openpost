package platform

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
)

func (p *PinterestAdapter) NativePostSupport() NativePostSupport {
	return nativePostSupport("pins:read", "boards:read")
}
func (p *PinterestAdapter) ListNativePosts(ctx context.Context, token string, input NativePostRequest) (NativePostPage, error) {
	query := url.Values{"page_size": {strconv.Itoa(nativePostPageSize(input, p.NativePostSupport()))}, "pin_filter": {"exclude_repins"}}
	if input.Cursor != "" {
		query.Set("bookmark", input.Cursor)
	}
	result, err := DoBearerJSON[struct {
		Items []struct {
			ID          string `json:"id"`
			Title       string `json:"title"`
			Description string `json:"description"`
			CreatedAt   string `json:"created_at"`
			IsOwner     bool   `json:"is_owner"`
			ParentPinID string `json:"parent_pin_id"`
		} `json:"items"`
		Bookmark string `json:"bookmark"`
	}](ctx, http.MethodGet, pinterestAPIBaseURL+"/pins?"+query.Encode(), token, nil, "native pins")
	if err != nil {
		return NativePostPage{}, classifyNativePostError(err)
	}
	page, err := nativePostContinuation(result.Bookmark, input.Cursor)
	if err != nil {
		return page, err
	}
	for _, pin := range result.Items {
		if !pin.IsOwner || pin.ParentPinID != "" {
			continue
		}
		appendNativePost(&page, input, NativePostItem{ProviderPostID: pin.ID, Title: pin.Title, Text: pin.Description, PublishedAt: nativePostTime(pin.CreatedAt), ExternalURL: "https://www.pinterest.com/pin/" + url.PathEscape(pin.ID) + "/"})
	}
	return page, nil
}
