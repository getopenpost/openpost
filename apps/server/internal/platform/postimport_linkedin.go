package platform

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func (l *LinkedInAdapter) NativePostSupport() NativePostSupport { return nativePostSupport() }
func (l *LinkedInAdapter) ResolveAccountNativePostSupport(input NativePostAccountContext) NativePostSupport {
	if strings.HasPrefix(input.AccountID, "urn:li:organization:") {
		if !l.enableOrganizations {
			return NativePostSupport{UnavailableReason: "LinkedIn Page imports are disabled on this instance."}
		}
		return nativePostSupport("r_organization_social")
	}
	if !l.enableMemberReads {
		return NativePostSupport{UnavailableReason: "LinkedIn member imports require restricted read access approved by LinkedIn and enabled by your administrator."}
	}
	return nativePostSupport("r_member_social")
}
func (l *LinkedInAdapter) ListNativePosts(ctx context.Context, token string, input NativePostRequest) (NativePostPage, error) {
	author := linkedInAuthorURN(input.AccountID)
	if input.AccountID == "" {
		return NativePostPage{}, NewNativePostError(NativePostFailed, "missing_account", 0)
	}
	if !l.ResolveAccountNativePostSupport(NativePostAccountContext{AccountID: input.AccountID}).Supported {
		return NativePostPage{}, NewNativePostError(NativePostUnsupported, "organization_reads_disabled", 0)
	}
	start, err := nativePostOffset(input.Cursor)
	if err != nil {
		return NativePostPage{}, err
	}
	query := url.Values{"q": {"author"}, "author": {author}, "count": {strconv.Itoa(nativePostPageSize(input, l.NativePostSupport()))}, "sortBy": {"CREATED"}, "start": {strconv.Itoa(start)}}
	headers := linkedinHeaders(token, linkedInAPIVersion())
	headers["X-RestLi-Method"] = "FINDER"
	body, err := DoRequest(ctx, http.MethodGet, "https://api.linkedin.com/rest/posts?"+query.Encode(), nil, headers)
	if err != nil {
		return NativePostPage{}, classifyNativePostError(err)
	}
	var result struct {
		Elements []nativeLinkedInPost `json:"elements"`
		Paging   struct {
			Links []struct {
				Rel  string `json:"rel"`
				Href string `json:"href"`
			} `json:"links"`
		} `json:"paging"`
	}
	if json.Unmarshal(body, &result) != nil {
		return NativePostPage{}, NewNativePostError(NativePostFailed, "invalid_provider_response", 0)
	}
	next := ""
	for _, link := range result.Paging.Links {
		if link.Rel != "next" {
			continue
		}
		parsed, parseErr := url.Parse(link.Href)
		if parseErr != nil {
			return NativePostPage{}, NewNativePostError(NativePostFailed, "invalid_provider_cursor", 0)
		}
		offset, parseErr := strconv.Atoi(parsed.Query().Get("start"))
		if parseErr != nil || offset <= start {
			return NativePostPage{}, NewNativePostError(NativePostFailed, "invalid_provider_cursor", 0)
		}
		next = strconv.Itoa(offset)
	}
	page, err := nativePostContinuation(next, input.Cursor)
	if err != nil {
		return page, err
	}
	for _, post := range result.Elements {
		if !nativeLinkedInOriginal(post, author) {
			continue
		}
		appendNativePost(&page, input, NativePostItem{ProviderPostID: post.ID, Text: post.Commentary, PublishedAt: time.UnixMilli(post.PublishedAt).UTC(), ExternalURL: linkedinContentURL(post.ID)})
	}
	return page, nil
}

func nativePostOffset(cursor string) (int, error) {
	if cursor == "" {
		return 0, nil
	}
	offset, err := strconv.Atoi(cursor)
	if err != nil || offset < 0 || offset > 1_000_000 {
		return 0, NewNativePostError(NativePostFailed, "invalid_cursor", 0)
	}
	return offset, nil
}

type nativeLinkedInPost struct {
	ID             string `json:"id"`
	Author         string `json:"author"`
	Commentary     string `json:"commentary"`
	PublishedAt    int64  `json:"publishedAt"`
	LifecycleState string `json:"lifecycleState"`
	Visibility     string `json:"visibility"`
	Distribution   struct {
		FeedDistribution string `json:"feedDistribution"`
	} `json:"distribution"`
	ReshareContext *json.RawMessage `json:"reshareContext"`
	Content        struct {
		ReshareContext *json.RawMessage `json:"reshareContext"`
	} `json:"content"`
}

func nativeLinkedInOriginal(post nativeLinkedInPost, author string) bool {
	return post.Author == author && post.LifecycleState == "PUBLISHED" && post.Visibility == "PUBLIC" && post.PublishedAt > 0 && post.ReshareContext == nil && post.Content.ReshareContext == nil && post.Distribution.FeedDistribution != "NONE"
}
