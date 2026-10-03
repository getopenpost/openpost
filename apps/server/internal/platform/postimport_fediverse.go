package platform

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

func (p *PixelfedAdapter) NativePostSupport() NativePostSupport { return nativePostSupport() }
func (p *PixelfedAdapter) ListNativePosts(ctx context.Context, token string, input NativePostRequest) (NativePostPage, error) {
	input.InstanceURL = p.compat.instanceURL
	return NewMastodonAdapter("", "", "", p.compat.instanceURL).ListNativePosts(ctx, token, input)
}

func (p *PeerTubeAdapter) NativePostSupport() NativePostSupport { return nativePostSupport() }
func (p *PeerTubeAdapter) ListNativePosts(ctx context.Context, token string, input NativePostRequest) (NativePostPage, error) {
	if input.AccountID == "" {
		return NativePostPage{}, NewNativePostError(NativePostFailed, "missing_channel", 0)
	}
	start, err := nativePostOffset(input.Cursor)
	if err != nil {
		return NativePostPage{}, err
	}
	count := nativePostPageSize(input, p.NativePostSupport())
	query := url.Values{"start": {strconv.Itoa(start)}, "count": {strconv.Itoa(count)}, "sort": {"-publishedAt"}, "privacyOneOf": {"1"}}
	result, err := DoBearerJSON[struct {
		Total int `json:"total"`
		Data  []struct {
			ID          int64  `json:"id"`
			UUID        string `json:"uuid"`
			Name        string `json:"name"`
			Description string `json:"description"`
			PublishedAt string `json:"publishedAt"`
			URL         string `json:"url"`
			Channel     struct {
				ID   int64  `json:"id"`
				Name string `json:"name"`
				Host string `json:"host"`
			} `json:"channel"`
			Privacy struct {
				ID int `json:"id"`
			} `json:"privacy"`
		} `json:"data"`
	}](ctx, http.MethodGet, nativePostEndpoint(p.instanceURL, "/api/v1/video-channels/"+url.PathEscape(input.AccountID)+"/videos", query), token, nil, "native channel videos")
	if err != nil {
		return NativePostPage{}, classifyNativePostError(err)
	}
	next := ""
	if len(result.Data) > 0 && start+len(result.Data) < result.Total {
		next = strconv.Itoa(start + len(result.Data))
	}
	page, err := nativePostContinuation(next, input.Cursor)
	if err != nil {
		return page, err
	}
	for _, video := range result.Data {
		if video.Privacy.ID != 1 {
			continue
		}
		// Connections store a channel ID, or a channel handle on older accounts.
		if strconv.FormatInt(video.Channel.ID, 10) != input.AccountID && video.Channel.Name != input.AccountID && video.Channel.Name+"@"+video.Channel.Host != input.AccountID {
			continue
		}
		published := nativePostTime(video.PublishedAt)
		if !published.IsZero() && !published.After(input.PublishedAfter) {
			page.NextCursor = ""
			page.Coverage = NativePostComplete
			continue
		}
		appendNativePost(&page, input, NativePostItem{ProviderPostID: video.UUID, Title: video.Name, Text: video.Description, PublishedAt: published, ExternalURL: video.URL})
	}
	return page, nil
}

func (l *LemmyAdapter) NativePostSupport() NativePostSupport  { return nativePostSupport() }
func (p *PieFedAdapter) NativePostSupport() NativePostSupport { return nativePostSupport() }
func (l *LemmyAdapter) ListNativePosts(ctx context.Context, token string, input NativePostRequest) (NativePostPage, error) {
	return listNativeCommunityPosts(ctx, token, input, l.instanceURL, "/api/v3/user")
}
func (p *PieFedAdapter) ListNativePosts(ctx context.Context, token string, input NativePostRequest) (NativePostPage, error) {
	return listNativeCommunityPosts(ctx, token, input, p.instanceURL, "/api/alpha/user")
}
func listNativeCommunityPosts(ctx context.Context, token string, input NativePostRequest, instance, path string) (NativePostPage, error) {
	person, err := strconv.ParseInt(input.AccountID, 10, 64)
	if err != nil || person <= 0 || strings.TrimSpace(instance) == "" {
		return NativePostPage{}, NewNativePostError(NativePostFailed, "invalid_person", 0)
	}
	pageNumber, err := nativePostOffset(input.Cursor)
	if err != nil {
		return NativePostPage{}, err
	}
	if pageNumber == 0 {
		pageNumber = 1
	}
	count := nativePostPageSize(input, nativePostSupport())
	query := url.Values{"person_id": {input.AccountID}, "page": {strconv.Itoa(pageNumber)}, "limit": {strconv.Itoa(count)}, "sort": {"New"}, "saved_only": {"false"}, "include_content": {"true"}}
	result, err := communityJSONGet[struct {
		Posts []struct {
			Post struct {
				ID        int64  `json:"id"`
				CreatorID int64  `json:"creator_id"`
				UserID    int64  `json:"user_id"`
				Name      string `json:"name"`
				Title     string `json:"title"`
				Body      string `json:"body"`
				Published string `json:"published"`
				ActorID   string `json:"ap_id"`
				Deleted   bool   `json:"deleted"`
				Removed   bool   `json:"removed"`
			} `json:"post"`
			Creator struct {
				ID int64 `json:"id"`
			} `json:"creator"`
		} `json:"posts"`
	}](ctx, instance, path, query, token, "native community posts")
	if err != nil {
		return NativePostPage{}, classifyNativePostError(err)
	}
	next := ""
	if len(result.Posts) >= count {
		next = strconv.Itoa(pageNumber + 1)
	}
	page, err := nativePostContinuation(next, input.Cursor)
	if err != nil {
		return page, err
	}
	for _, view := range result.Posts {
		post := view.Post
		if view.Creator.ID != person || post.Deleted || post.Removed {
			continue
		}
		appendNativePost(&page, input, NativePostItem{ProviderPostID: strconv.FormatInt(post.ID, 10), Title: firstNonEmptyString(post.Title, post.Name), Text: post.Body, PublishedAt: nativePostTime(post.Published), ExternalURL: post.ActorID})
	}
	return page, nil
}
