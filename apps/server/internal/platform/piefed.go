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

// PieFedAdapter publishes to PieFed communities through the account's home
// server alpha API. It shares the community-posting experience with Lemmy
// (see community.go) while speaking PieFed's native endpoints and
// representations. The connected account ID is the numeric person ID.
type PieFedAdapter struct {
	instanceURL string
}

func NewPieFedAdapter(instanceURL string) *PieFedAdapter {
	return &PieFedAdapter{instanceURL: strings.TrimRight(strings.TrimSpace(instanceURL), "/")}
}

func (p *PieFedAdapter) InstanceURL() string {
	return p.instanceURL
}

func (p *PieFedAdapter) AuthorizationGrantDescriptor() AuthorizationGrantDescriptor {
	return AuthorizationGrantDescriptor{
		ProjectID:     p.instanceURL,
		ExecutionMode: "password",
		Evidence:      map[string]string{"protocol": "piefed_jwt", "exchange": "password", "instance_url": p.instanceURL},
	}
}

func (p *PieFedAdapter) GenerateAuthURL(_ string) (string, map[string]string) {
	return "", nil
}

func (p *PieFedAdapter) ExchangeCode(_ context.Context, _ string, _ map[string]string) (*TokenResult, error) {
	return nil, fmt.Errorf("piefed uses instance credentials, not OAuth redirect")
}

func (p *PieFedAdapter) RefreshCapability() RefreshCapability {
	return RefreshCapability{Supported: false, CredentialSource: RefreshCredentialNone}
}

func (p *PieFedAdapter) RefreshToken(_ context.Context, _ RefreshTokenInput) (*TokenResult, error) {
	return nil, fmt.Errorf("piefed tokens do not expire")
}

func piefedAuthHeaders(jwt string) map[string]string {
	return map[string]string{headerAuthorization: bearerPrefix + jwt}
}

type piefedPerson struct {
	ID       int64   `json:"id"`
	UserName string  `json:"user_name"`
	Title    *string `json:"title"`
	Avatar   *string `json:"avatar"`
	ActorID  string  `json:"actor_id"`
}

func piefedPersonDisplayName(person piefedPerson) string {
	if person.Title != nil && strings.TrimSpace(*person.Title) != "" {
		return strings.TrimSpace(*person.Title)
	}
	return person.UserName
}

type piefedSiteResponse struct {
	Version string `json:"version"`
	MyUser  *struct {
		LocalUserView struct {
			Person piefedPerson `json:"person"`
		} `json:"local_user_view"`
	} `json:"my_user"`
}

// Login exchanges instance credentials for a JWT and returns the verified
// person profile. The password never leaves this call.
func (p *PieFedAdapter) Login(ctx context.Context, username, password string) (*TokenResult, *UserProfile, error) {
	username = strings.TrimSpace(username)
	if username == "" || strings.TrimSpace(password) == "" {
		return nil, nil, fmt.Errorf("piefed login requires a username and password")
	}
	login, err := communityJSONPost[struct {
		JWT string `json:"jwt"`
	}](ctx, p.instanceURL, "/api/alpha/user/login", map[string]string{
		"username": username,
		"password": password,
	}, "", "piefed login")
	if err != nil {
		return nil, nil, err
	}
	if strings.TrimSpace(login.JWT) == "" {
		return nil, nil, fmt.Errorf("piefed login returned no token")
	}
	token := &TokenResult{AccessToken: strings.TrimSpace(login.JWT), TokenType: tokenTypeBearer}
	profile, err := p.GetProfile(ctx, token.AccessToken)
	if err != nil {
		return nil, nil, err
	}
	return token, profile, nil
}

func (p *PieFedAdapter) fetchSite(ctx context.Context, jwt string) (piefedSiteResponse, error) {
	return communityJSONGet[piefedSiteResponse](ctx, p.instanceURL, "/api/alpha/site", nil, jwt, "piefed site")
}

func (p *PieFedAdapter) GetProfile(ctx context.Context, accessToken string) (*UserProfile, error) {
	site, err := p.fetchSite(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	if site.MyUser == nil {
		return nil, fmt.Errorf("piefed profile is unavailable")
	}
	person := site.MyUser.LocalUserView.Person
	avatar := ""
	if person.Avatar != nil {
		avatar = strings.TrimSpace(*person.Avatar)
	}
	return &UserProfile{
		ID:              strconv.FormatInt(person.ID, 10),
		Username:        person.UserName,
		DisplayName:     piefedPersonDisplayName(person),
		AvatarURL:       avatar,
		CapabilityState: map[string]string{"fediverse_software": "piefed", "piefed_version": strings.TrimSpace(site.Version)},
	}, nil
}

type piefedCommunity struct {
	ID               int64   `json:"id"`
	Name             string  `json:"name"`
	Title            *string `json:"title"`
	Description      *string `json:"description"`
	ActorID          string  `json:"actor_id"`
	NSFW             bool    `json:"nsfw"`
	RestrictedToMods bool    `json:"restricted_to_mods"`
	PostingWarning   *string `json:"posting_warning"`
}

type piefedCommunityView struct {
	Community piefedCommunity `json:"community"`
}

func piefedCommunityIdentity(view piefedCommunityView) CommunityIdentity {
	community := view.Community
	title := community.Name
	if community.Title != nil && strings.TrimSpace(*community.Title) != "" {
		title = strings.TrimSpace(*community.Title)
	}
	description := ""
	if community.Description != nil {
		description = strings.TrimSpace(*community.Description)
	}
	if community.PostingWarning != nil && strings.TrimSpace(*community.PostingWarning) != "" {
		if description != "" {
			description += "\n\n"
		}
		description += strings.TrimSpace(*community.PostingWarning)
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
		PostingRestrictedToMods: community.RestrictedToMods,
		NSFW:                    community.NSFW,
		LocalID:                 strconv.FormatInt(community.ID, 10),
	}
}

// resolveCommunity resolves a user-supplied community reference through the
// connected instance.
func (p *PieFedAdapter) resolveCommunity(ctx context.Context, jwt, ref string) (CommunityIdentity, error) {
	return resolveCommunity(ctx, providerPieFed, p.instanceURL, "/api/alpha/resolve_object", jwt, ref, "piefed community resolution", piefedCommunityIdentity)
}

// SearchPublishingOptions searches communities on the connected instance for
// the composer destination picker. Values are canonical actor IDs.
func (p *PieFedAdapter) SearchPublishingOptions(ctx context.Context, accessToken string, input PublishingOptionsInput) (PublishingOptionsPage, error) {
	query := strings.TrimSpace(firstNonEmptyString(input.Search, input.Context["value"], input.Context["query"]))
	limit := input.Limit
	if limit <= 0 || limit > 25 {
		limit = 10
	}
	// The community list has no search filter and drops unknown parameters,
	// so the query goes through the search endpoint.
	response, err := communityJSONGet[struct {
		Communities []piefedCommunityView `json:"communities"`
	}](ctx, p.instanceURL, "/api/alpha/search", url.Values{
		"q":     {query},
		"type_": {"Communities"},
		"limit": {strconv.Itoa(limit)},
	}, accessToken, "piefed community search")
	if err != nil {
		return PublishingOptionsPage{}, err
	}
	page := PublishingOptionsPage{}
	for _, view := range response.Communities {
		identity := piefedCommunityIdentity(view)
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
func (p *PieFedAdapter) ValidatePublishingTarget(ctx context.Context, accessToken, _ string, settings map[string]interface{}) error {
	communityRef := settingString(settings, CommunitySettingCommunity)
	title := communityTitle("", settings)
	if err := ValidateCommunityPost("piefed", communityRef, title); err != nil {
		return err
	}
	identity, err := p.resolveCommunity(ctx, accessToken, communityRef)
	if err != nil {
		return err
	}
	if identity.PostingRestrictedToMods {
		return fmt.Errorf("community %s restricts posting to moderators", CommunityDisplayRef(identity.Name, identity.Host))
	}
	return nil
}

type piefedPost struct {
	ID        int64   `json:"id"`
	Title     string  `json:"title"`
	URL       *string `json:"url"`
	Body      *string `json:"body"`
	ActorID   string  `json:"ap_id"`
	NSFW      bool    `json:"nsfw"`
	Published string  `json:"published"`
}

func (p *PieFedAdapter) Publish(ctx context.Context, accessToken, _ string, req *PublishRequest) (PublishResult, error) {
	communityRef := settingString(req.Settings, CommunitySettingCommunity)
	title := communityTitle(req.Title, req.Settings)
	if err := ValidateCommunityPost("piefed", communityRef, title); err != nil {
		return PublishResult{}, err
	}
	prepared := PublishResult{ProviderState: "resolve_community", RetrySafety: PublishRetryNever}
	if err := req.BeginWrite(prepared); err != nil {
		return PublishResult{}, err
	}
	identity, err := p.resolveCommunity(ctx, accessToken, communityRef)
	if err != nil {
		return prepared, err
	}
	if identity.PostingRestrictedToMods {
		return prepared, fmt.Errorf("community %s restricts posting to moderators", CommunityDisplayRef(identity.Name, identity.Host))
	}
	communityID, err := strconv.ParseInt(identity.LocalID, 10, 64)
	if err != nil {
		return prepared, fmt.Errorf("piefed community identity is invalid")
	}
	payload := map[string]any{
		"title":        title,
		"community_id": communityID,
	}
	if body := communityBody(req.Content, req.Settings); body != "" {
		payload["body"] = body
	}
	if link := firstNonEmptyString(settingString(req.Settings, CommunitySettingURL), firstCommunityMediaURL(req)); link != "" {
		payload["url"] = link
	}
	if settingBool(req.Settings, CommunitySettingNSFW) {
		payload["nsfw"] = true
	}
	if languageID := settingInt(req.Settings, CommunitySettingLanguageID); languageID > 0 {
		payload["language_id"] = languageID
	}
	response, err := communityJSONPost[struct {
		PostView struct {
			Post piefedPost `json:"post"`
		} `json:"post_view"`
	}](ctx, p.instanceURL, "/api/alpha/post", payload, accessToken, "piefed post creation")
	if err != nil {
		return prepared, err
	}
	post := response.PostView.Post
	result := AcceptedPublishResult(strconv.FormatInt(post.ID, 10))
	result.ExternalURL = strings.TrimSpace(post.ActorID)
	result.ProviderState = "create_post"
	result.ProviderReference = CommunityTargetKey(providerPieFed, identity.Host, identity.Name)
	if err := req.Checkpoint(result); err != nil {
		return result, err
	}
	return result, nil
}

// UploadMedia uploads an image for link posts and returns its URL as the
// platform media ID.
func (p *PieFedAdapter) UploadMedia(ctx context.Context, accessToken, _ string, mimeType string, reader io.Reader) (string, error) {
	if !strings.HasPrefix(strings.ToLower(mimeType), "image/") {
		return "", fmt.Errorf("piefed image upload requires an image attachment")
	}
	data, err := io.ReadAll(reader)
	if err != nil {
		return "", fmt.Errorf("reading piefed media: %w", err)
	}
	if len(data) == 0 {
		return "", fmt.Errorf("piefed image upload requires a non-empty image")
	}
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	ext := ".bin"
	if exts, err := mime.ExtensionsByType(mimeType); err == nil && len(exts) > 0 {
		ext = exts[0]
	}
	part, err := writer.CreateFormFile("file", "upload"+ext)
	if err != nil {
		return "", fmt.Errorf("building piefed image upload: %w", err)
	}
	if _, err := part.Write(data); err != nil {
		return "", fmt.Errorf("building piefed image upload: %w", err)
	}
	if err := writer.Close(); err != nil {
		return "", fmt.Errorf("building piefed image upload: %w", err)
	}
	headers := piefedAuthHeaders(accessToken)
	headers[headerContentType] = writer.FormDataContentType()
	respBody, err := DoRequest(ctx, http.MethodPost, p.instanceURL+"/api/alpha/upload/image", &buf, headers)
	if err != nil {
		return "", fmt.Errorf("piefed image upload: %w", err)
	}
	var result struct {
		URL *string `json:"url"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("decoding piefed image upload: %w", err)
	}
	if result.URL == nil || strings.TrimSpace(*result.URL) == "" {
		return "", fmt.Errorf("piefed image upload returned no url")
	}
	return strings.TrimSpace(*result.URL), nil
}

type piefedComment struct {
	ID        int64   `json:"id"`
	PostID    int64   `json:"post_id"`
	Body      string  `json:"body"`
	Published string  `json:"published"`
	Updated   *string `json:"updated"`
	Deleted   bool    `json:"deleted"`
	Removed   bool    `json:"removed"`
	ActorID   string  `json:"ap_id"`
	Path      *string `json:"path"`
}

type piefedCommentView struct {
	Comment piefedComment `json:"comment"`
	Creator piefedPerson  `json:"creator"`
	// MyVote is the connected account's own vote on the reply: 1 for an
	// upvote, -1 for a downvote, 0 for none. A pointer keeps a response
	// that omits the field distinguishable from an explicit no-vote.
	MyVote *int64 `json:"my_vote"`
}

// piefedReplyView is a comment in the post replies tree. Replies to it are
// nested under it, not listed alongside it.
type piefedReplyView struct {
	piefedCommentView
	Replies []piefedReplyView `json:"replies"`
}

// flattenPieFedReplies lists every comment in the tree, each before its
// replies.
func flattenPieFedReplies(tree []piefedReplyView) []piefedCommentView {
	views := make([]piefedCommentView, 0, len(tree))
	for _, reply := range tree {
		views = append(views, reply.piefedCommentView)
		views = append(views, flattenPieFedReplies(reply.Replies)...)
	}
	return views
}

func (p *PieFedAdapter) EngagementSupport() EngagementSupport {
	return EngagementSupport{Enabled: true, CanReply: true, CanDelete: true, CanLike: true}
}

func (p *PieFedAdapter) ListComments(ctx context.Context, accessToken, accountID, externalID string) ([]Comment, error) {
	postID, err := strconv.ParseInt(strings.TrimSpace(externalID), 10, 64)
	if err != nil || postID <= 0 {
		return nil, fmt.Errorf("piefed comment listing requires a post id")
	}
	response, err := communityJSONGet[struct {
		Comments []piefedReplyView `json:"comments"`
	}](ctx, p.instanceURL, "/api/alpha/post/replies", url.Values{
		"post_id": {strconv.FormatInt(postID, 10)},
	}, accessToken, "piefed comment listing")
	if err != nil {
		return nil, err
	}
	views := flattenPieFedReplies(response.Comments)
	comments := make([]Comment, 0, len(views))
	for _, view := range views {
		comment := view.Comment
		if comment.Removed || comment.Deleted {
			continue
		}
		parentID := ""
		if comment.Path != nil {
			if parent := lemmyParentCommentID(*comment.Path); parent != "" {
				parentID = communityCommentRef(providerPieFed, postID, parent)
			}
		}
		// The reply's upvote count includes its author's own upvote, so only
		// my_vote says whether the connected account liked it. An omitted
		// my_vote leaves the vote state unknown so stored state is kept.
		liked := view.MyVote != nil && *view.MyVote > 0
		canLike, canUnlike := !liked, liked
		likeStateKnown := view.MyVote != nil
		if !likeStateKnown {
			canLike, canUnlike = true, true
		}
		comments = append(comments, Comment{
			ID:       communityCommentRef(providerPieFed, postID, strconv.FormatInt(comment.ID, 10)),
			ParentID: parentID, ConversationID: strconv.FormatInt(postID, 10),
			AuthorID:     strconv.FormatInt(view.Creator.ID, 10),
			AuthorName:   piefedPersonDisplayName(view.Creator),
			AuthorHandle: prefixHandle(view.Creator.UserName),
			Text:         comment.Body, CreatedAt: comment.Published,
			UpdatedAt: stringValue(comment.Updated),
			IsOurs:    strings.TrimSpace(accountID) == strconv.FormatInt(view.Creator.ID, 10),
			CanReply:  true,
			CanDelete: strings.TrimSpace(accountID) == strconv.FormatInt(view.Creator.ID, 10),
			CanLike:   canLike, CanUnlike: canUnlike,
			Liked: liked, LikeStateKnown: likeStateKnown,
		})
	}
	return comments, nil
}

func (p *PieFedAdapter) ReplyToComment(ctx context.Context, accessToken, _ string, commentID, message string) (string, error) {
	type replyResponse struct {
		CommentView piefedCommentView `json:"comment_view"`
	}
	return replyToCommunityComment(ctx, providerPieFed, p.instanceURL, "/api/alpha/comment", "body", accessToken, commentID, message, "piefed reply creation", func(response replyResponse) int64 {
		return response.CommentView.Comment.ID
	})
}

func (p *PieFedAdapter) HideComment(_ context.Context, _, _, _ string) error {
	return fmt.Errorf("piefed hide reply: %w", ErrUnsupportedCommentAction)
}

func (p *PieFedAdapter) DeleteComment(ctx context.Context, accessToken, _ string, commentID string) error {
	_, targetID, err := splitCommunityCommentRef(providerPieFed, commentID)
	if err != nil {
		return err
	}
	_, err = communityJSONPost[struct{}](ctx, p.instanceURL, "/api/alpha/comment/delete", map[string]any{
		"comment_id": targetID,
		"deleted":    true,
	}, accessToken, "piefed reply deletion")
	return err
}

func (p *PieFedAdapter) LikeComment(ctx context.Context, accessToken, _ string, commentID string) error {
	_, targetID, err := splitCommunityCommentRef(providerPieFed, commentID)
	if err != nil {
		return err
	}
	_, err = communityJSONPost[struct{}](ctx, p.instanceURL, "/api/alpha/comment/like", map[string]any{
		"comment_id": targetID,
		"score":      1,
	}, accessToken, "piefed reply like")
	return err
}

func (p *PieFedAdapter) UnlikeComment(ctx context.Context, accessToken, _ string, commentID string) error {
	_, targetID, err := splitCommunityCommentRef(providerPieFed, commentID)
	if err != nil {
		return err
	}
	_, err = communityJSONPost[struct{}](ctx, p.instanceURL, "/api/alpha/comment/like", map[string]any{
		"comment_id": targetID,
		"score":      0,
	}, accessToken, "piefed reply unlike")
	return err
}

func (p *PieFedAdapter) AnalyticsSupport() AnalyticsSupport {
	return AnalyticsSupport{Account: true, Content: true}
}

func (p *PieFedAdapter) FetchAccountAnalytics(ctx context.Context, accessToken string, input AccountAnalyticsRequest) (AnalyticsValues, error) {
	site, err := p.fetchSite(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	values := AnalyticsValues{}
	if site.MyUser != nil {
		personID := strconv.FormatInt(site.MyUser.LocalUserView.Person.ID, 10)
		if strings.TrimSpace(input.AccountID) != "" && strings.TrimSpace(input.AccountID) != personID {
			return nil, fmt.Errorf("piefed account analytics identity mismatch")
		}
	}
	return values, nil
}

func (p *PieFedAdapter) FetchContentAnalytics(ctx context.Context, accessToken string, input ContentAnalyticsRequest) (AnalyticsValues, error) {
	total := AnalyticsValues{}
	for _, externalID := range uniqueNonEmpty(input.ExternalIDs) {
		postID, err := strconv.ParseInt(strings.TrimSpace(externalID), 10, 64)
		if err != nil || postID <= 0 {
			continue
		}
		response, err := communityJSONGet[struct {
			PostView struct {
				Counts *struct {
					Comments *int64 `json:"comments"`
					Upvotes  *int64 `json:"upvotes"`
				} `json:"counts"`
			} `json:"post_view"`
		}](ctx, p.instanceURL, "/api/alpha/post", url.Values{"id": {strconv.FormatInt(postID, 10)}}, accessToken, "piefed content analytics")
		if err != nil {
			return nil, err
		}
		if response.PostView.Counts != nil {
			addOptionalMetric(total, MetricLikes, response.PostView.Counts.Upvotes)
			addOptionalMetric(total, MetricComments, response.PostView.Counts.Comments)
		}
	}
	subtractOwnReplies(total, input.OwnReplyCount)
	return total, nil
}

func (p *PieFedAdapter) AccountContentDiscoverySupport(input AnalyticsAccountContext) AccountContentDiscoverySupport {
	if strings.TrimSpace(input.AccountID) == "" {
		return AccountContentDiscoverySupport{UnavailableReason: "PieFed account content discovery requires a stable account identity."}
	}
	// Pages are numbered at a fixed size, so the job must not ask for less.
	return AccountContentDiscoverySupport{Supported: true, MinPageSize: 20, MaxPageSize: 20}
}

func (p *PieFedAdapter) DiscoverAccountContent(ctx context.Context, accessToken string, input AccountContentDiscoveryRequest) (AccountContentPage, error) {
	personID, err := strconv.ParseInt(strings.TrimSpace(input.AccountID), 10, 64)
	if err != nil || personID <= 0 {
		return AccountContentPage{}, NewAccountContentDiscoveryError(AccountContentDiscoveryUnsupported, "invalid_account", 0)
	}
	// The post list filters by person_id; any other name is accepted and
	// ignored, which lists the whole feed.
	params := url.Values{
		"person_id": {strconv.FormatInt(personID, 10)},
		"sort":      {"New"},
		"limit":     {"20"},
	}
	if cursor := strings.TrimSpace(input.Cursor); cursor != "" {
		params.Set("page", cursor)
	}
	response, err := communityJSONGet[struct {
		Posts []struct {
			Post piefedPost `json:"post"`
		} `json:"posts"`
		NextPage *string `json:"next_page"`
	}](ctx, p.instanceURL, "/api/alpha/post/list", params, accessToken, "piefed account content")
	if err != nil {
		return AccountContentPage{}, socialAccountContentDiscoveryError(err)
	}
	page := AccountContentPage{Coverage: AccountContentCoverage{
		Status:      AccountContentDiscoveryPartial,
		Description: "Only posts visible through the authenticated PieFed instance are included.",
	}}
	for _, view := range response.Posts {
		post := view.Post
		item, ok := normalizeCommunityAccountContent(
			providerPieFed, p.instanceURL, post.ID, piefedAccountContentProfile(post), post.Title,
			post.Body, post.ActorID, post.Published, input.PublishedAfter,
		)
		if !ok {
			continue
		}
		appendCommunityAccountContent(&page, item)
	}
	if response.NextPage != nil && strings.TrimSpace(*response.NextPage) != "" {
		page.NextCursor = strings.TrimSpace(*response.NextPage)
	}
	return page, nil
}

func piefedAccountContentProfile(post piefedPost) string {
	if post.URL != nil && strings.TrimSpace(*post.URL) != "" {
		return "link_share"
	}
	return "short_text"
}

func validateCommunityMedia(provider string, media []MediaItem) []MediaValidationIssue {
	if len(media) == 0 {
		return nil
	}
	for _, item := range media {
		if !strings.HasPrefix(strings.ToLower(item.MimeType), "image/") {
			return []MediaValidationIssue{{
				Provider: provider,
				MediaID:  item.ID,
				Severity: severityError,
				Message:  "Community posts accept images only; video and documents are not supported.",
			}}
		}
	}
	return nil
}

func validateLemmyMedia(media []MediaItem) []MediaValidationIssue {
	return validateCommunityMedia(providerLemmy, media)
}

func validatePieFedMedia(media []MediaItem) []MediaValidationIssue {
	return validateCommunityMedia(providerPieFed, media)
}
