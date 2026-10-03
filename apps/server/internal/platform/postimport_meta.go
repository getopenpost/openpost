package platform

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

type nativeGraphPost struct {
	ID           string `json:"id"`
	Caption      string `json:"caption"`
	Text         string `json:"text"`
	Message      string `json:"message"`
	Timestamp    string `json:"timestamp"`
	CreatedTime  string `json:"created_time"`
	Permalink    string `json:"permalink"`
	PermalinkURL string `json:"permalink_url"`
	From         struct {
		ID string `json:"id"`
	} `json:"from"`
	Owner struct {
		ID string `json:"id"`
	} `json:"owner"`
	IsReply      bool `json:"is_reply"`
	RepostedPost *struct {
		ID string `json:"id"`
	} `json:"reposted_post"`
}

type nativeGraphResponse struct {
	Data   []nativeGraphPost `json:"data"`
	Paging struct {
		Cursors struct {
			After string `json:"after"`
		} `json:"cursors"`
		Next string `json:"next"`
	} `json:"paging"`
}

func (t *ThreadsAdapter) NativePostSupport() NativePostSupport {
	return nativePostSupport("threads_basic")
}
func (i *InstagramAdapter) NativePostSupport() NativePostSupport {
	return nativePostSupport("instagram_basic")
}
func (f *FacebookAdapter) NativePostSupport() NativePostSupport {
	return nativePostSupport("pages_read_engagement")
}

func (t *ThreadsAdapter) ListNativePosts(ctx context.Context, token string, input NativePostRequest) (NativePostPage, error) {
	return listNativeGraphPosts(ctx, token, input, "https://graph.threads.net/v1.0/"+url.PathEscape(input.AccountID)+"/threads", "id,text,timestamp,permalink,owner,is_reply,reposted_post", providerThreads)
}
func (i *InstagramAdapter) ListNativePosts(ctx context.Context, token string, input NativePostRequest) (NativePostPage, error) {
	return listNativeGraphPosts(ctx, token, input, i.graphURL(url.PathEscape(input.AccountID)+"/media"), "id,caption,timestamp,permalink", providerInstagram)
}
func (f *FacebookAdapter) ListNativePosts(ctx context.Context, token string, input NativePostRequest) (NativePostPage, error) {
	// The Page's posts edge excludes visitor posts. Also verify returned authors
	// so a provider-side feed change cannot import somebody else's content.
	return listNativeGraphPosts(ctx, token, input, f.graphURL(url.PathEscape(input.AccountID)+"/posts"), "id,message,created_time,permalink_url,from", providerFacebook)
}
func listNativeGraphPosts(ctx context.Context, token string, input NativePostRequest, endpoint, fields, provider string) (NativePostPage, error) {
	if strings.TrimSpace(input.AccountID) == "" {
		return NativePostPage{}, NewNativePostError(NativePostFailed, "missing_account", 0)
	}
	query := url.Values{"fields": {fields}, "limit": {strconv.Itoa(nativePostPageSize(input, nativePostSupport()))}}
	if input.Cursor != "" {
		query.Set("after", input.Cursor)
	}
	if !input.PublishedAfter.IsZero() {
		query.Set("since", strconv.FormatInt(input.PublishedAfter.Unix(), 10))
	}
	result, err := DoBearerJSON[nativeGraphResponse](ctx, http.MethodGet, endpoint+"?"+query.Encode(), token, nil, "native posts")
	if err != nil {
		return NativePostPage{}, classifyNativePostError(err)
	}
	if result == nil || result.Data == nil {
		return NativePostPage{}, NewNativePostError(NativePostFailed, "empty_provider_response", 0)
	}
	next := ""
	if result.Paging.Next != "" {
		next = result.Paging.Cursors.After
		if next == "" {
			return NativePostPage{}, NewNativePostError(NativePostFailed, "missing_provider_cursor", 0)
		}
	}
	page, err := nativePostContinuation(next, input.Cursor)
	if err != nil {
		return page, err
	}
	for _, post := range result.Data {
		if !nativeGraphOriginal(post, input.AccountID, provider) {
			continue
		}
		appendNativePost(&page, input, NativePostItem{ProviderPostID: post.ID, Text: firstNonEmptyString(post.Text, post.Caption, post.Message), ExternalURL: firstNonEmptyString(post.Permalink, post.PermalinkURL), PublishedAt: nativePostTime(firstNonEmptyString(post.Timestamp, post.CreatedTime))})
	}
	return page, nil
}

func nativeGraphOriginal(post nativeGraphPost, accountID, provider string) bool {
	if post.IsReply || post.RepostedPost != nil {
		return false
	}
	if provider == providerFacebook {
		return post.From.ID == accountID
	}
	return post.Owner.ID == "" || post.Owner.ID == accountID
}
