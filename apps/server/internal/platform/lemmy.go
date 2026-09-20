package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// lemmyAPIVersionBoundary is the newest Lemmy line OpenPost publishes
// through. Lemmy 1.0 moves to a v4 API with breaking changes; instances on
// that line get an explicit error instead of silent breakage.
const lemmyAPIVersionBoundary = "1.0"

// LemmyAdapter publishes to Lemmy communities through the account's home
// server API (v3). The connected account ID is the numeric person ID; each
// rendition targets one concrete community destination.
type LemmyAdapter struct {
	instanceURL string
}

func NewLemmyAdapter(instanceURL string) *LemmyAdapter {
	return &LemmyAdapter{instanceURL: strings.TrimRight(strings.TrimSpace(instanceURL), "/")}
}

func (l *LemmyAdapter) InstanceURL() string {
	return l.instanceURL
}

func (l *LemmyAdapter) AuthorizationGrantDescriptor() AuthorizationGrantDescriptor {
	return AuthorizationGrantDescriptor{
		ProjectID:     l.instanceURL,
		ExecutionMode: "password",
		Evidence:      map[string]string{"protocol": "lemmy_jwt", "exchange": "password", "instance_url": l.instanceURL},
	}
}

func (l *LemmyAdapter) GenerateAuthURL(_ string) (string, map[string]string) {
	return "", nil
}

func (l *LemmyAdapter) ExchangeCode(_ context.Context, _ string, _ map[string]string) (*TokenResult, error) {
	return nil, fmt.Errorf("lemmy uses instance credentials, not OAuth redirect")
}

func (l *LemmyAdapter) RefreshCapability() RefreshCapability {
	return RefreshCapability{Supported: false, CredentialSource: RefreshCredentialNone}
}

func (l *LemmyAdapter) RefreshToken(_ context.Context, _ RefreshTokenInput) (*TokenResult, error) {
	return nil, fmt.Errorf("lemmy tokens do not expire")
}

func lemmyAuthHeaders(jwt string) map[string]string {
	return map[string]string{headerAuthorization: bearerPrefix + jwt}
}

type lemmyLoginResponse struct {
	JWT *string `json:"jwt"`
}

type lemmySiteResponse struct {
	Version string `json:"version"`
	MyUser  *struct {
		LocalUserView struct {
			Person lemmyPerson `json:"person"`
		} `json:"local_user_view"`
	} `json:"my_user"`
}

type lemmyPerson struct {
	ID          int64   `json:"id"`
	Name        string  `json:"name"`
	DisplayName *string `json:"display_name"`
	Avatar      *string `json:"avatar"`
	ActorID     string  `json:"ap_id"`
}

func lemmyPersonDisplayName(person lemmyPerson) string {
	if person.DisplayName != nil && strings.TrimSpace(*person.DisplayName) != "" {
		return strings.TrimSpace(*person.DisplayName)
	}
	return person.Name
}

func lemmyPersonAvatar(person lemmyPerson) string {
	if person.Avatar != nil {
		return strings.TrimSpace(*person.Avatar)
	}
	return ""
}

// checkLemmyVersion refuses Lemmy 1.x instances, whose v4 API breaks the v3
// contract this adapter publishes through.
func checkLemmyVersion(version string) error {
	trimmed := strings.TrimSpace(version)
	if trimmed == "" {
		return nil
	}
	major := strings.SplitN(trimmed, ".", 2)[0]
	boundary := strings.SplitN(lemmyAPIVersionBoundary, ".", 2)[0]
	if major >= boundary {
		return fmt.Errorf("lemmy %s uses API v4, which OpenPost does not publish through yet; connect an instance on 0.19.x", trimmed)
	}
	return nil
}

// Login exchanges instance credentials for a JWT and returns the verified
// person profile. The password never leaves this call.
func (l *LemmyAdapter) Login(ctx context.Context, username, password string) (*TokenResult, *UserProfile, error) {
	username = strings.TrimSpace(username)
	if username == "" || strings.TrimSpace(password) == "" {
		return nil, nil, fmt.Errorf("lemmy login requires a username and password")
	}
	login, err := communityJSONPost[lemmyLoginResponse](ctx, l.instanceURL, "/api/v3/user/login", map[string]string{
		"username_or_email": username,
		"password":          password,
	}, "", "lemmy login")
	if err != nil {
		return nil, nil, err
	}
	if login.JWT == nil || strings.TrimSpace(*login.JWT) == "" {
		return nil, nil, fmt.Errorf("lemmy login returned no token")
	}
	token := &TokenResult{AccessToken: strings.TrimSpace(*login.JWT), TokenType: tokenTypeBearer}
	profile, err := l.GetProfile(ctx, token.AccessToken)
	if err != nil {
		return nil, nil, err
	}
	return token, profile, nil
}

func (l *LemmyAdapter) fetchSite(ctx context.Context, jwt string) (lemmySiteResponse, error) {
	return communityJSONGet[lemmySiteResponse](ctx, l.instanceURL, "/api/v3/site", nil, jwt, "lemmy site")
}

func (l *LemmyAdapter) GetProfile(ctx context.Context, accessToken string) (*UserProfile, error) {
	site, err := l.fetchSite(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	if err := checkLemmyVersion(site.Version); err != nil {
		return nil, err
	}
	if site.MyUser == nil {
		return nil, fmt.Errorf("lemmy profile is unavailable")
	}
	person := site.MyUser.LocalUserView.Person
	return &UserProfile{
		ID:              strconv.FormatInt(person.ID, 10),
		Username:        person.Name,
		DisplayName:     lemmyPersonDisplayName(person),
		AvatarURL:       lemmyPersonAvatar(person),
		CapabilityState: map[string]string{"fediverse_software": "lemmy", "lemmy_version": strings.TrimSpace(site.Version)},
	}, nil
}

// lemmyCommunity is the API v3 community object. Its canonical actor URL is
// actor_id; ap_id only names posts and comments.
type lemmyCommunity struct {
	ID                      int64   `json:"id"`
	Name                    string  `json:"name"`
	Title                   *string `json:"title"`
	Description             *string `json:"sidebar"`
	ActorID                 string  `json:"actor_id"`
	NSFW                    bool    `json:"nsfw"`
	PostingRestrictedToMods bool    `json:"posting_restricted_to_mods"`
}

type lemmyCommunityView struct {
	Community lemmyCommunity `json:"community"`
}

func lemmyCommunityIdentity(view lemmyCommunityView) CommunityIdentity {
	community := view.Community
	title := community.Name
	if community.Title != nil && strings.TrimSpace(*community.Title) != "" {
		title = strings.TrimSpace(*community.Title)
	}
	description := ""
	if community.Description != nil {
		description = strings.TrimSpace(*community.Description)
	}
	host := ""
	if parsed, err := url.Parse(strings.TrimSpace(community.ActorID)); err == nil {
		host = strings.ToLower(parsed.Hostname())
	}
	return CommunityIdentity{
		ActorID:                 strings.TrimSpace(community.ActorID),
		Host:                    host,
		Name:                    community.Name,
		Title:                   title,
		Description:             description,
		PostingRestrictedToMods: community.PostingRestrictedToMods,
		NSFW:                    community.NSFW,
		LocalID:                 strconv.FormatInt(community.ID, 10),
	}
}

// resolveCommunity resolves a user-supplied community reference through the
// connected instance, so remote communities stay addressable without an
// account on their origin server.
func (l *LemmyAdapter) resolveCommunity(ctx context.Context, jwt, ref string) (CommunityIdentity, error) {
	return resolveCommunity(ctx, providerLemmy, l.instanceURL, "/api/v3/resolve_object", jwt, ref, "lemmy community resolution", lemmyCommunityIdentity)
}

// SearchPublishingOptions searches communities on the connected instance for
// the composer destination picker. Values are canonical actor IDs.
func (l *LemmyAdapter) SearchPublishingOptions(ctx context.Context, accessToken string, input PublishingOptionsInput) (PublishingOptionsPage, error) {
	query := strings.TrimSpace(firstNonEmptyString(input.Search, input.Context["value"], input.Context["query"]))
	limit := input.Limit
	if limit <= 0 || limit > 25 {
		limit = 10
	}
	params := url.Values{
		"q":     {query},
		"type_": {"Communities"},
		"limit": {strconv.Itoa(limit)},
	}
	response, err := communityJSONGet[struct {
		Communities []lemmyCommunityView `json:"communities"`
	}](ctx, l.instanceURL, "/api/v3/search", params, accessToken, "lemmy community search")
	if err != nil {
		return PublishingOptionsPage{}, err
	}
	page := PublishingOptionsPage{}
	for _, view := range response.Communities {
		identity := lemmyCommunityIdentity(view)
		if identity.ActorID == "" {
			continue
		}
		page.Options = append(page.Options, DestinationOption{
			Value: identity.ActorID,
			Label: CommunityDisplayRef(identity.Name, identity.Host) + " — " + identity.Title,
		})
	}
	return page, nil
}

// ValidatePublishingTarget rechecks the destination before any provider
// mutation begins. An unresolved community is never schedulable.
func (l *LemmyAdapter) ValidatePublishingTarget(ctx context.Context, accessToken, _ string, settings map[string]interface{}) error {
	communityRef := settingString(settings, CommunitySettingCommunity)
	title := communityTitle("", settings)
	if err := ValidateCommunityPost("lemmy", communityRef, title); err != nil {
		return err
	}
	identity, err := l.resolveCommunity(ctx, accessToken, communityRef)
	if err != nil {
		return err
	}
	if identity.PostingRestrictedToMods {
		return fmt.Errorf("community %s restricts posting to moderators", CommunityDisplayRef(identity.Name, identity.Host))
	}
	return nil
}

type lemmyPost struct {
	ID        int64   `json:"id"`
	Name      string  `json:"name"`
	URL       *string `json:"url"`
	Body      *string `json:"body"`
	ActorID   string  `json:"ap_id"`
	NSFW      bool    `json:"nsfw"`
	Published string  `json:"published"`
}

type lemmyPostView struct {
	Post   lemmyPost `json:"post"`
	Counts struct {
		Comments int64 `json:"comments"`
		Score    int64 `json:"score"`
		Upvotes  int64 `json:"upvotes"`
	} `json:"counts"`
}

func (l *LemmyAdapter) Publish(ctx context.Context, accessToken, _ string, req *PublishRequest) (PublishResult, error) {
	communityRef := settingString(req.Settings, CommunitySettingCommunity)
	title := communityTitle(req.Title, req.Settings)
	if err := ValidateCommunityPost("lemmy", communityRef, title); err != nil {
		return PublishResult{}, err
	}
	prepared := PublishResult{ProviderState: "resolve_community", RetrySafety: PublishRetryNever}
	if err := req.BeginWrite(prepared); err != nil {
		return PublishResult{}, err
	}
	identity, err := l.resolveCommunity(ctx, accessToken, communityRef)
	if err != nil {
		return prepared, err
	}
	if identity.PostingRestrictedToMods {
		return prepared, fmt.Errorf("community %s restricts posting to moderators", CommunityDisplayRef(identity.Name, identity.Host))
	}
	communityID, err := strconv.ParseInt(identity.LocalID, 10, 64)
	if err != nil {
		return prepared, fmt.Errorf("lemmy community identity is invalid")
	}
	payload := map[string]any{
		"name":         title,
		"community_id": communityID,
	}
	// Lemmy's native model pairs a required title with an optional link
	// and an optional body. Both may be present; neither is forced into a
	// Reddit-like link-or-text choice.
	if body := communityBody(req.Content, req.Settings); body != "" {
		payload["body"] = body
	}
	if link := firstNonEmptyString(settingString(req.Settings, CommunitySettingURL), firstCommunityMediaURL(req)); link != "" {
		payload["url"] = link
		if altText := settingString(req.Settings, "alt_text"); altText != "" {
			payload["alt_text"] = altText
		}
	}
	if settingBool(req.Settings, CommunitySettingNSFW) {
		payload["nsfw"] = true
	}
	if languageID := settingInt(req.Settings, CommunitySettingLanguageID); languageID > 0 {
		payload["language_id"] = languageID
	}
	response, err := communityJSONPost[struct {
		PostView lemmyPostView `json:"post_view"`
	}](ctx, l.instanceURL, "/api/v3/post", payload, accessToken, "lemmy post creation")
	if err != nil {
		return prepared, err
	}
	post := response.PostView.Post
	result := AcceptedPublishResult(strconv.FormatInt(post.ID, 10))
	result.ExternalURL = strings.TrimSpace(post.ActorID)
	result.ProviderState = "create_post"
	result.ProviderReference = CommunityTargetKey(providerLemmy, identity.Host, identity.Name)
	if err := req.Checkpoint(result); err != nil {
		return result, err
	}
	return result, nil
}

// UploadMedia uploads an image for link posts and returns its URL as the
// platform media ID. Publish attaches the first uploaded URL to the post.
func (l *LemmyAdapter) UploadMedia(ctx context.Context, accessToken, _ string, mimeType string, reader io.Reader) (string, error) {
	if !strings.HasPrefix(strings.ToLower(mimeType), "image/") {
		return "", fmt.Errorf("lemmy image upload requires an image attachment")
	}
	data, err := io.ReadAll(reader)
	if err != nil {
		return "", fmt.Errorf("reading lemmy media: %w", err)
	}
	if len(data) == 0 {
		return "", fmt.Errorf("lemmy image upload requires a non-empty image")
	}
	payload, contentType, err := encodeLemmyImageUpload(mimeType, data)
	if err != nil {
		return "", err
	}
	headers := lemmyAuthHeaders(accessToken)
	headers[headerContentType] = contentType
	// Lemmy 0.19 has no /api/v3 upload route; it proxies pict-rs at
	// /pictrs/image and serves each stored file under that path.
	respBody, err := DoRequest(ctx, http.MethodPost, l.instanceURL+"/pictrs/image", payload, headers)
	if err != nil {
		return "", fmt.Errorf("lemmy image upload: %w", err)
	}
	var result struct {
		Msg   string `json:"msg"`
		Files []struct {
			File string `json:"file"`
		} `json:"files"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("decoding lemmy image upload: %w", err)
	}
	if len(result.Files) == 0 || strings.TrimSpace(result.Files[0].File) == "" {
		return "", fmt.Errorf("lemmy image upload returned no file: %s", strings.TrimSpace(result.Msg))
	}
	return l.instanceURL + "/pictrs/image/" + url.PathEscape(strings.TrimSpace(result.Files[0].File)), nil
}

// lemmyComment is the API v3 comment object: its timestamps are published
// and updated, and its score lives in the view's counts.
type lemmyComment struct {
	ID        int64   `json:"id"`
	PostID    int64   `json:"post_id"`
	Content   string  `json:"content"`
	Published string  `json:"published"`
	Updated   *string `json:"updated"`
	Removed   bool    `json:"removed"`
	Deleted   bool    `json:"deleted"`
	Path      string  `json:"path"`
	ActorID   string  `json:"ap_id"`
}

type lemmyCommentView struct {
	Comment lemmyComment `json:"comment"`
	Creator lemmyPerson  `json:"creator"`
	// MyVote is the connected account's own vote: 1, -1, or absent.
	MyVote *int64 `json:"my_vote"`
}

func (l *LemmyAdapter) EngagementSupport() EngagementSupport {
	return EngagementSupport{Enabled: true, CanReply: true, CanDelete: true, CanLike: true}
}

func (l *LemmyAdapter) ListComments(ctx context.Context, accessToken, accountID, externalID string) ([]Comment, error) {
	postID, err := strconv.ParseInt(strings.TrimSpace(externalID), 10, 64)
	if err != nil || postID <= 0 {
		return nil, fmt.Errorf("lemmy comment listing requires a post id")
	}
	response, err := communityJSONGet[struct {
		Comments []lemmyCommentView `json:"comments"`
	}](ctx, l.instanceURL, "/api/v3/comment/list", url.Values{
		"post_id": {strconv.FormatInt(postID, 10)},
		"sort":    {"Old"},
		"limit":   {"100"},
	}, accessToken, "lemmy comment listing")
	if err != nil {
		return nil, err
	}
	comments := make([]Comment, 0, len(response.Comments))
	for _, view := range response.Comments {
		comment := view.Comment
		if comment.Removed || comment.Deleted {
			continue
		}
		parentID := lemmyParentCommentID(comment.Path)
		if parentID != "" {
			parentID = communityCommentRef(providerLemmy, postID, parentID)
		}
		// The comment's score includes its author's automatic upvote, so only
		// my_vote says whether the connected account liked it.
		liked := view.MyVote != nil && *view.MyVote > 0
		comments = append(comments, Comment{
			ID:       communityCommentRef(providerLemmy, postID, strconv.FormatInt(comment.ID, 10)),
			ParentID: parentID, ConversationID: strconv.FormatInt(postID, 10),
			AuthorID:        strconv.FormatInt(view.Creator.ID, 10),
			AuthorName:      lemmyPersonDisplayName(view.Creator),
			AuthorHandle:    prefixHandle(view.Creator.Name),
			AuthorAvatarURL: lemmyPersonAvatar(view.Creator),
			Text:            comment.Content, CreatedAt: comment.Published,
			UpdatedAt: stringValue(comment.Updated),
			IsOurs:    strings.TrimSpace(accountID) == strconv.FormatInt(view.Creator.ID, 10),
			CanReply:  true,
			CanDelete: strings.TrimSpace(accountID) == strconv.FormatInt(view.Creator.ID, 10),
			CanLike:   !liked, CanUnlike: liked,
			Liked: liked, LikeStateKnown: true,
		})
	}
	return comments, nil
}

// lemmyParentCommentID derives the parent from the materialized path
// ("0.12.34" replies to 12). A direct post reply has no parent.
func lemmyParentCommentID(path string) string {
	segments := []string{}
	for _, segment := range strings.Split(strings.TrimSpace(path), ".") {
		if segment != "" && segment != "0" {
			segments = append(segments, segment)
		}
	}
	if len(segments) < 2 {
		return ""
	}
	return segments[len(segments)-2]
}

func (l *LemmyAdapter) ReplyToComment(ctx context.Context, accessToken, _ string, commentID, message string) (string, error) {
	type replyResponse struct {
		CommentView lemmyCommentView `json:"comment_view"`
	}
	return replyToCommunityComment(ctx, providerLemmy, l.instanceURL, "/api/v3/comment", "content", accessToken, commentID, message, "lemmy reply creation", func(response replyResponse) int64 {
		return response.CommentView.Comment.ID
	})
}

func (l *LemmyAdapter) HideComment(_ context.Context, _, _, _ string) error {
	return fmt.Errorf("lemmy hide reply: %w", ErrUnsupportedCommentAction)
}

func (l *LemmyAdapter) DeleteComment(ctx context.Context, accessToken, _ string, commentID string) error {
	_, targetID, err := splitCommunityCommentRef(providerLemmy, commentID)
	if err != nil {
		return err
	}
	_, err = communityJSONPost[struct{}](ctx, l.instanceURL, "/api/v3/comment/delete", map[string]any{
		"comment_id": targetID,
		"deleted":    true,
	}, accessToken, "lemmy reply deletion")
	return err
}

func (l *LemmyAdapter) LikeComment(ctx context.Context, accessToken, _ string, commentID string) error {
	_, targetID, err := splitCommunityCommentRef(providerLemmy, commentID)
	if err != nil {
		return err
	}
	_, err = communityJSONPost[struct{}](ctx, l.instanceURL, "/api/v3/comment/like", map[string]any{
		"comment_id": targetID,
		"score":      1,
	}, accessToken, "lemmy reply like")
	return err
}

func (l *LemmyAdapter) UnlikeComment(ctx context.Context, accessToken, _ string, commentID string) error {
	_, targetID, err := splitCommunityCommentRef(providerLemmy, commentID)
	if err != nil {
		return err
	}
	_, err = communityJSONPost[struct{}](ctx, l.instanceURL, "/api/v3/comment/like", map[string]any{
		"comment_id": targetID,
		"score":      0,
	}, accessToken, "lemmy reply unlike")
	return err
}

func (l *LemmyAdapter) AnalyticsSupport() AnalyticsSupport {
	return AnalyticsSupport{Account: true, Content: true}
}

func (l *LemmyAdapter) FetchAccountAnalytics(ctx context.Context, accessToken string, input AccountAnalyticsRequest) (AnalyticsValues, error) {
	site, err := l.fetchSite(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	values := AnalyticsValues{}
	if site.MyUser != nil {
		personID := strconv.FormatInt(site.MyUser.LocalUserView.Person.ID, 10)
		if strings.TrimSpace(input.AccountID) != "" && strings.TrimSpace(input.AccountID) != personID {
			return nil, fmt.Errorf("lemmy account analytics identity mismatch")
		}
		person, err := communityJSONGet[struct {
			PersonView struct {
				Counts *struct {
					PostCount    *int64 `json:"post_count"`
					CommentCount *int64 `json:"comment_count"`
				} `json:"counts"`
			} `json:"person_view"`
		}](ctx, l.instanceURL, "/api/v3/user", url.Values{"person_id": {personID}}, accessToken, "lemmy account analytics")
		if err != nil {
			return nil, err
		}
		if person.PersonView.Counts != nil {
			addOptionalMetric(values, MetricPosts, person.PersonView.Counts.PostCount)
		}
	}
	return values, nil
}

func (l *LemmyAdapter) FetchContentAnalytics(ctx context.Context, accessToken string, input ContentAnalyticsRequest) (AnalyticsValues, error) {
	total := AnalyticsValues{}
	for _, externalID := range uniqueNonEmpty(input.ExternalIDs) {
		postID, err := strconv.ParseInt(strings.TrimSpace(externalID), 10, 64)
		if err != nil || postID <= 0 {
			continue
		}
		response, err := communityJSONGet[struct {
			PostView lemmyPostView `json:"post_view"`
		}](ctx, l.instanceURL, "/api/v3/post", url.Values{"id": {strconv.FormatInt(postID, 10)}}, accessToken, "lemmy content analytics")
		if err != nil {
			return nil, err
		}
		// Upvotes are the native approval counter, reported as likes with
		// that provenance; the net score is never relabelled.
		upvotes, comments := response.PostView.Counts.Upvotes, response.PostView.Counts.Comments
		addOptionalMetric(total, MetricLikes, &upvotes)
		addOptionalMetric(total, MetricComments, &comments)
	}
	subtractOwnReplies(total, input.OwnReplyCount)
	return total, nil
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// encodeLemmyImageUpload builds the pict-rs image upload body.
func encodeLemmyImageUpload(mimeType string, data []byte) (io.Reader, string, error) {
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	ext := ".bin"
	if exts, err := mime.ExtensionsByType(mimeType); err == nil && len(exts) > 0 {
		ext = exts[0]
	}
	part, err := writer.CreateFormFile("images[]", "upload"+ext)
	if err != nil {
		return nil, "", fmt.Errorf("building lemmy image upload: %w", err)
	}
	if _, err := part.Write(data); err != nil {
		return nil, "", fmt.Errorf("building lemmy image upload: %w", err)
	}
	if err := writer.Close(); err != nil {
		return nil, "", fmt.Errorf("building lemmy image upload: %w", err)
	}
	return &buf, writer.FormDataContentType(), nil
}
