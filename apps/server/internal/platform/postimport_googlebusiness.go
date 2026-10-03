package platform

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

func (g *GoogleBusinessAdapter) NativePostSupport() NativePostSupport {
	return nativePostSupport("https://www.googleapis.com/auth/business.manage")
}
func (g *GoogleBusinessAdapter) ListNativePosts(ctx context.Context, token string, input NativePostRequest) (NativePostPage, error) {
	if !googleBusinessLocationNamePattern.MatchString(input.AccountID) {
		return NativePostPage{}, NewNativePostError(NativePostFailed, "invalid_location", 0)
	}
	query := url.Values{"pageSize": {strconv.Itoa(nativePostPageSize(input, g.NativePostSupport()))}}
	if input.Cursor != "" {
		query.Set("pageToken", input.Cursor)
	}
	result, err := DoBearerJSON[struct {
		Posts []struct {
			Name          string `json:"name"`
			State         string `json:"state"`
			Summary       string `json:"summary"`
			SearchURL     string `json:"searchUrl"`
			CreateTime    string `json:"createTime"`
			ScheduledTime string `json:"scheduledTime"`
			Event         struct {
				Title string `json:"title"`
			} `json:"event"`
		} `json:"localPosts"`
		NextPageToken string `json:"nextPageToken"`
	}](ctx, http.MethodGet, googleBusinessPostsBaseURL+"/"+input.AccountID+"/localPosts?"+query.Encode(), token, nil, "native local posts")
	if err != nil {
		return NativePostPage{}, classifyNativePostError(err)
	}
	page, err := nativePostContinuation(result.NextPageToken, input.Cursor)
	if err != nil {
		return page, err
	}
	for _, post := range result.Posts {
		if post.State != "LIVE" || !strings.HasPrefix(post.Name, input.AccountID+"/localPosts/") || !googleBusinessPostNamePattern.MatchString(post.Name) {
			continue
		}
		appendNativePost(&page, input, NativePostItem{ProviderPostID: post.Name, Title: post.Event.Title, Text: post.Summary, PublishedAt: nativePostTime(firstNonEmptyString(post.ScheduledTime, post.CreateTime)), ExternalURL: googleBusinessSearchURL(post.SearchURL)})
	}
	return page, nil
}
