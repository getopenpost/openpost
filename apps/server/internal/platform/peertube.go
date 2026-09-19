package platform

import (
	"bytes"
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
)

// PeerTube privacy identifiers. See GET /api/v1/videos/privacies.
const (
	peertubePrivacyPublic   = 1
	peertubePrivacyUnlisted = 2
	peertubePrivacyPrivate  = 3
	peertubePrivacyInternal = 4
)

// PeerTube comment policies: enabled = 1, disabled = 2, requires approval = 3.
const (
	peertubeCommentsEnabled          = 1
	peertubeCommentsDisabled         = 2
	peertubeCommentsRequiresApproval = 3
)

// PeerTubeAdapter publishes videos to one PeerTube instance. Authentication
// follows the documented OAuth client + user token flow; the password is
// exchanged once for tokens and never stored. Each channel is a destination:
// channel selection happens at connect time through AccountSelectionAdapter,
// and the connected account ID is the channel name.
type PeerTubeAdapter struct {
	instanceURL string
}

func NewPeerTubeAdapter(instanceURL string) *PeerTubeAdapter {
	return &PeerTubeAdapter{instanceURL: strings.TrimRight(strings.TrimSpace(instanceURL), "/")}
}

func (p *PeerTubeAdapter) InstanceURL() string {
	return p.instanceURL
}

func (p *PeerTubeAdapter) AuthorizationGrantDescriptor() AuthorizationGrantDescriptor {
	return AuthorizationGrantDescriptor{
		ProjectID:     p.instanceURL,
		ExecutionMode: "password",
		Evidence:      map[string]string{"protocol": "oauth2", "exchange": "password", "instance_url": p.instanceURL},
	}
}

func (p *PeerTubeAdapter) GenerateAuthURL(_ string) (string, map[string]string) {
	return "", nil
}

func (p *PeerTubeAdapter) ExchangeCode(_ context.Context, _ string, _ map[string]string) (*TokenResult, error) {
	return nil, fmt.Errorf("peertube uses instance credentials, not OAuth redirect")
}

func (p *PeerTubeAdapter) RefreshCapability() RefreshCapability {
	return RefreshCapability{
		Supported:        true,
		CredentialSource: RefreshCredentialRefreshToken,
	}
}

func (p *PeerTubeAdapter) RefreshToken(ctx context.Context, input RefreshTokenInput) (*TokenResult, error) {
	if strings.TrimSpace(input.RefreshToken) == "" {
		return nil, fmt.Errorf("peertube token refresh requires a refresh token")
	}
	clientID, clientSecret, err := p.fetchOAuthClient(ctx)
	if err != nil {
		return nil, err
	}
	values := map[string]string{
		grantType:              oauthGrantRefresh,
		"refresh_token":        strings.TrimSpace(input.RefreshToken),
		oauthParamClientID:     clientID,
		oauthParamClientSecret: clientSecret,
	}
	return p.exchangeUserToken(ctx, values)
}

// Login exchanges instance credentials for tokens and returns the verified
// user profile. The password never leaves this call.
func (p *PeerTubeAdapter) Login(ctx context.Context, username, password string) (*TokenResult, *UserProfile, error) {
	username = strings.TrimSpace(username)
	if username == "" || strings.TrimSpace(password) == "" {
		return nil, nil, fmt.Errorf("peertube login requires a username and password")
	}
	clientID, clientSecret, err := p.fetchOAuthClient(ctx)
	if err != nil {
		return nil, nil, err
	}
	token, err := p.exchangeUserToken(ctx, map[string]string{
		grantType:              "password",
		"username":             username,
		"password":             password,
		oauthParamClientID:     clientID,
		oauthParamClientSecret: clientSecret,
	})
	if err != nil {
		return nil, nil, err
	}
	profile, err := p.GetProfile(ctx, token.AccessToken)
	if err != nil {
		return nil, nil, err
	}
	return token, profile, nil
}

func (p *PeerTubeAdapter) fetchOAuthClient(ctx context.Context) (string, string, error) {
	var client struct {
		ClientID     string `json:"client_id"`
		ClientSecret string `json:"client_secret"`
	}
	body, err := DoRequest(ctx, http.MethodGet, p.instanceURL+"/api/v1/oauth-clients/local", nil, nil)
	if err != nil {
		return "", "", fmt.Errorf("loading peertube oauth client: %w", err)
	}
	if err := json.Unmarshal(body, &client); err != nil {
		return "", "", fmt.Errorf("decoding peertube oauth client: %w", err)
	}
	if strings.TrimSpace(client.ClientID) == "" || strings.TrimSpace(client.ClientSecret) == "" {
		return "", "", fmt.Errorf("peertube oauth client response missing credentials")
	}
	return client.ClientID, client.ClientSecret, nil
}

func (p *PeerTubeAdapter) exchangeUserToken(ctx context.Context, values map[string]string) (*TokenResult, error) {
	respBody, err := DoFormURLEncoded(ctx, "POST", p.instanceURL+"/api/v1/users/token", values, nil)
	if err != nil {
		return nil, fmt.Errorf("peertube token exchange: %w", err)
	}
	var tokenResp struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
		TokenType    string `json:"token_type"`
	}
	if err := json.Unmarshal(respBody, &tokenResp); err != nil {
		return nil, fmt.Errorf("decoding peertube token: %w", err)
	}
	if strings.TrimSpace(tokenResp.AccessToken) == "" {
		return nil, fmt.Errorf("peertube token exchange returned no access token")
	}
	return &TokenResult{
		AccessToken:  tokenResp.AccessToken,
		RefreshToken: tokenResp.RefreshToken,
		ExpiresIn:    tokenResp.ExpiresIn,
		TokenType:    firstNonEmptyString(tokenResp.TokenType, tokenTypeBearer),
	}, nil
}

type peertubeMe struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Account  struct {
		Name        string `json:"name"`
		DisplayName string `json:"displayName"`
	} `json:"account"`
}

func (p *PeerTubeAdapter) fetchMe(ctx context.Context, accessToken string) (peertubeMe, error) {
	profile, err := DoBearerJSON[peertubeMe](ctx, "GET", p.instanceURL+"/api/v1/users/me", accessToken, nil, "peertube profile")
	if err != nil {
		return peertubeMe{}, err
	}
	if profile == nil {
		return peertubeMe{}, fmt.Errorf("empty peertube profile response")
	}
	return *profile, nil
}

func (p *PeerTubeAdapter) GetProfile(ctx context.Context, accessToken string) (*UserProfile, error) {
	me, err := p.fetchMe(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	return &UserProfile{
		ID:              firstNonEmptyString(me.Account.Name, me.Username, strconv.FormatInt(me.ID, 10)),
		Username:        firstNonEmptyString(me.Account.Name, me.Username),
		DisplayName:     firstNonEmptyString(me.Account.DisplayName, me.Username),
		CapabilityState: map[string]string{"fediverse_software": "peertube"},
	}, nil
}

type peertubeChannel struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
}

// peerTubeListPageSize is the largest page PeerTube's paginated lists
// accept. Without a count they stop at 15.
const peerTubeListPageSize = 100

// listPeerTubePages reads every page of a paginated PeerTube list, which
// answers {total, data} and is addressed by start and count.
func listPeerTubePages[T any](ctx context.Context, endpoint, accessToken, label string) ([]T, error) {
	var items []T
	for start := 0; ; {
		var page struct {
			Total int64 `json:"total"`
			Data  []T   `json:"data"`
		}
		query := url.Values{"count": {strconv.Itoa(peerTubeListPageSize)}, "start": {strconv.Itoa(start)}}
		body, err := DoRequest(ctx, http.MethodGet, endpoint+"?"+query.Encode(), nil, map[string]string{
			headerAuthorization: bearerPrefix + accessToken,
		})
		if err != nil {
			return nil, fmt.Errorf("listing peertube %s: %w", label, err)
		}
		if err := json.Unmarshal(body, &page); err != nil {
			return nil, fmt.Errorf("decoding peertube %s: %w", label, err)
		}
		items = append(items, page.Data...)
		start += len(page.Data)
		// An empty page also ends the list, so a total that overcounts
		// cannot keep it requesting.
		if len(page.Data) == 0 || int64(start) >= page.Total {
			return items, nil
		}
	}
}

func (p *PeerTubeAdapter) listOwnChannels(ctx context.Context, accessToken string) ([]peertubeChannel, error) {
	me, err := p.fetchMe(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	accountName := firstNonEmptyString(me.Account.Name, me.Username)
	if accountName == "" {
		return nil, fmt.Errorf("peertube account identity is unavailable")
	}
	return listPeerTubePages[peertubeChannel](ctx, p.instanceURL+"/api/v1/accounts/"+url.PathEscape(accountName)+"/video-channels", accessToken, "channels")
}

func (p *PeerTubeAdapter) ListAccountSelections(ctx context.Context, token *TokenResult) ([]AccountSelectionOption, error) {
	if token == nil || strings.TrimSpace(token.AccessToken) == "" {
		return nil, fmt.Errorf("peertube channel selection requires an access token")
	}
	channels, err := p.listOwnChannels(ctx, token.AccessToken)
	if err != nil {
		return nil, err
	}
	options := make([]AccountSelectionOption, 0, len(channels))
	for _, channel := range channels {
		name := strings.TrimSpace(channel.Name)
		if name == "" {
			continue
		}
		options = append(options, AccountSelectionOption{
			ID:          name,
			Username:    name,
			DisplayName: firstNonEmptyString(channel.DisplayName, name),
			Kind:        "channel",
			Extra:       map[string]string{"channel_id": strconv.FormatInt(channel.ID, 10)},
		})
	}
	return options, nil
}

func (p *PeerTubeAdapter) SelectAccount(ctx context.Context, token *TokenResult, selectionID string) (*SelectedAccount, error) {
	options, err := p.ListAccountSelections(ctx, token)
	if err != nil {
		return nil, err
	}
	for _, option := range options {
		if option.ID == strings.TrimSpace(selectionID) {
			return &SelectedAccount{
				AccountID:       option.ID,
				AccountUsername: firstNonEmptyString(option.DisplayName, option.Username),
				InstanceURL:     p.instanceURL,
				Token:           token,
				CapabilityState: map[string]string{"fediverse_software": "peertube", "peertube_channel": option.ID},
			}, nil
		}
	}
	return nil, fmt.Errorf("unknown peertube channel selection")
}

// SearchPublishingOptions serves the composer pickers for channels,
// categories, and licences from the connected instance.
func (p *PeerTubeAdapter) SearchPublishingOptions(ctx context.Context, accessToken string, input PublishingOptionsInput) (PublishingOptionsPage, error) {
	query := strings.TrimSpace(firstNonEmptyString(input.Search, input.Context["value"], input.Context["query"]))
	limit := input.Limit
	if limit <= 0 || limit > 50 {
		limit = 25
	}
	switch strings.TrimSpace(input.Source) {
	case "peertube_channels", "":
		channels, err := p.listOwnChannels(ctx, accessToken)
		if err != nil {
			return PublishingOptionsPage{}, err
		}
		page := PublishingOptionsPage{}
		for _, channel := range channels {
			name := strings.TrimSpace(channel.Name)
			if name == "" || (query != "" && !strings.Contains(strings.ToLower(firstNonEmptyString(channel.DisplayName, name)), strings.ToLower(query))) {
				continue
			}
			page.Options = append(page.Options, DestinationOption{
				Value: name,
				Label: firstNonEmptyString(channel.DisplayName, name),
			})
			if len(page.Options) >= limit {
				break
			}
		}
		return page, nil
	case "peertube_categories":
		return p.searchPeerTubeStaticOptions(ctx, accessToken, "categories", query, limit)
	case "peertube_licences":
		return p.searchPeerTubeStaticOptions(ctx, accessToken, "licences", query, limit)
	default:
		return PublishingOptionsPage{}, fmt.Errorf("unknown peertube publishing option source %q", input.Source)
	}
}

// peertubeCatalogEntry is one entry of a PeerTube static catalog.
type peertubeCatalogEntry struct {
	ID    int
	Label string
}

func (p *PeerTubeAdapter) searchPeerTubeStaticOptions(ctx context.Context, accessToken, collection, query string, limit int) (PublishingOptionsPage, error) {
	var entries []peertubeCatalogEntry
	body, err := DoRequest(ctx, http.MethodGet, p.instanceURL+"/api/v1/videos/"+collection, nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return PublishingOptionsPage{}, fmt.Errorf("loading peertube %s: %w", collection, err)
	}
	// PeerTube answers these catalogs with a plain id-to-label object, not a
	// paginated envelope. An envelope decodes into an empty list without
	// erroring, which left both pickers empty.
	var catalog map[string]string
	if err := json.Unmarshal(body, &catalog); err != nil {
		return PublishingOptionsPage{}, fmt.Errorf("decoding peertube %s: %w", collection, err)
	}
	if catalog == nil {
		return PublishingOptionsPage{}, fmt.Errorf("decoding peertube %s: expected id-to-label object", collection)
	}
	for id, label := range catalog {
		// Catalog keys are numeric ids; a nonnumeric key is a malformed
		// catalog, not id 0 (which the upload builder treats as unset).
		parsedID, err := strconv.Atoi(strings.TrimSpace(id))
		if err != nil {
			return PublishingOptionsPage{}, fmt.Errorf("decoding peertube %s: invalid catalog id %q: %w", collection, id, err)
		}
		entries = append(entries, peertubeCatalogEntry{ID: parsedID, Label: label})
	}
	// Map iteration is unordered; the picker lists catalog ids in order.
	slices.SortFunc(entries, func(a, b peertubeCatalogEntry) int { return cmp.Compare(a.ID, b.ID) })
	page := PublishingOptionsPage{}
	for _, item := range entries {
		if query != "" && !strings.Contains(strings.ToLower(item.Label), strings.ToLower(query)) {
			continue
		}
		page.Options = append(page.Options, DestinationOption{
			Value: strconv.Itoa(item.ID),
			Label: item.Label,
		})
		if len(page.Options) >= limit {
			break
		}
	}
	return page, nil
}

// ResolveAccountPublishingCapabilities advertises PeerTube's channel-scoped
// destination model. Static catalog limits stay conservative; the instance
// enforces quota and transcoding policy at upload time.
func (p *PeerTubeAdapter) ResolveAccountPublishingCapabilities(_ context.Context, _ string, _ AccountCapabilityInput) (AccountCapabilityResult, error) {
	return AccountCapabilityResult{
		Revision: "peertube:channel",
		Constraints: map[string]interface{}{
			"title_required": true,
		},
		AvailableFeatures: map[string]bool{
			"captions":  true,
			"thumbnail": true,
		},
	}, nil
}

// ValidatePublishingTarget rejects a publish before any bytes move when the
// destination channel is unresolved. A publication with an unresolved
// channel must not be schedulable.
func (p *PeerTubeAdapter) ValidatePublishingTarget(_ context.Context, _, accountID string, settings map[string]interface{}) error {
	if strings.TrimSpace(firstNonEmptyString(settingString(settings, "channel"), accountID)) == "" {
		return fmt.Errorf("peertube publish requires a channel: connect a channel or set one for this post")
	}
	return nil
}

func peertubeChannelForRequest(accountID string, settings map[string]interface{}) string {
	return strings.TrimSpace(firstNonEmptyString(settingString(settings, "channel"), accountID))
}

func peertubePrivacy(settings map[string]interface{}) (int, error) {
	switch normalized := strings.ToLower(settingString(settings, "privacy")); normalized {
	case "", "public":
		return peertubePrivacyPublic, nil
	case "unlisted":
		return peertubePrivacyUnlisted, nil
	case "private":
		return peertubePrivacyPrivate, nil
	case "internal":
		return peertubePrivacyInternal, nil
	default:
		return 0, fmt.Errorf("peertube privacy %q is not supported", settingString(settings, "privacy"))
	}
}

func (p *PeerTubeAdapter) resolveChannelID(ctx context.Context, accessToken, channel string) (int64, error) {
	var result peertubeChannel
	body, err := DoRequest(ctx, http.MethodGet, p.instanceURL+"/api/v1/video-channels/"+url.PathEscape(channel), nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return 0, fmt.Errorf("resolving peertube channel: %w", err)
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return 0, fmt.Errorf("decoding peertube channel: %w", err)
	}
	if result.ID == 0 {
		return 0, fmt.Errorf("peertube channel %q was not found", channel)
	}
	return result.ID, nil
}

type peertubeVideoState struct {
	ID    int    `json:"id"`
	Label string `json:"label"`
}

type peertubeVideo struct {
	ID        int64              `json:"id"`
	UUID      string             `json:"uuid"`
	ShortUUID string             `json:"shortUUID"`
	Name      string             `json:"name"`
	State     peertubeVideoState `json:"state"`
	Views     int64              `json:"views"`
	Likes     int64              `json:"likes"`
	Dislikes  int64              `json:"dislikes"`
}

func (p *PeerTubeAdapter) fetchVideo(ctx context.Context, accessToken, uuid string) (peertubeVideo, error) {
	var video peertubeVideo
	body, err := DoRequest(ctx, http.MethodGet, p.instanceURL+"/api/v1/videos/"+url.PathEscape(uuid), nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return peertubeVideo{}, fmt.Errorf("loading peertube video: %w", err)
	}
	if err := json.Unmarshal(body, &video); err != nil {
		return peertubeVideo{}, fmt.Errorf("decoding peertube video: %w", err)
	}
	return video, nil
}

func (p *PeerTubeAdapter) videoURL(video peertubeVideo, uuid string) string {
	short := strings.TrimSpace(video.ShortUUID)
	if short != "" {
		return p.instanceURL + "/w/" + short
	}
	if id := strings.TrimSpace(video.UUID); id != "" {
		return p.instanceURL + "/videos/watch/" + id
	}
	return p.instanceURL + "/videos/watch/" + uuid
}

// reconcileUploadedVideo turns an uploaded UUID into a publish result,
// distinguishing a published video from one still transcoding and from a
// transcoding failure. A remote video disappearing must not trigger a
// re-upload here; the durable pipeline drives retries.
func (p *PeerTubeAdapter) reconcileUploadedVideo(ctx context.Context, accessToken, uuid string) (PublishResult, error) {
	uuid = strings.TrimSpace(uuid)
	if uuid == "" {
		return PublishResult{}, fmt.Errorf("peertube publish reconciliation requires a video id")
	}
	video, err := p.fetchVideo(ctx, accessToken, uuid)
	if err != nil {
		var httpErr *HTTPError
		if errors.As(err, &httpErr) && httpErr.StatusCode == http.StatusNotFound {
			return PublishResult{
				SubmissionState:   PublishSubmissionRejected,
				ProviderState:     "missing",
				ProviderReference: uuid,
				RetrySafety:       PublishRetryNever,
			}, fmt.Errorf("peertube video %s is no longer available", uuid)
		}
		return PublishResult{
			SubmissionState:   PublishSubmissionPending,
			ProviderState:     "transcoding",
			ProviderReference: uuid,
			RetrySafety:       PublishRetryReconcileOnly,
			ReconcileAfter:    time.Minute,
		}, err
	}
	if video.State.ID == 1 {
		result := AcceptedPublishResult(video.UUID)
		if result.ExternalID == "" {
			result.ExternalID = uuid
		}
		result.ExternalURL = p.videoURL(video, uuid)
		result.ProviderState = "published"
		result.ProviderReference = uuid
		return result, nil
	}
	if strings.Contains(strings.ToLower(video.State.Label), "fail") {
		return PublishResult{
			SubmissionState:   PublishSubmissionRejected,
			ProviderState:     "transcoding_failed",
			ProviderReference: uuid,
			RetrySafety:       PublishRetryNever,
		}, fmt.Errorf("peertube transcoding failed for video %s", uuid)
	}
	return PublishResult{
		SubmissionState:   PublishSubmissionPending,
		ProviderState:     "transcoding",
		ProviderReference: uuid,
		RetrySafety:       PublishRetryReconcileOnly,
		ReconcileAfter:    time.Minute,
	}, nil
}

func (p *PeerTubeAdapter) Publish(ctx context.Context, accessToken, accountID string, req *PublishRequest) (PublishResult, error) {
	if err := p.ValidatePublishingTarget(ctx, accessToken, accountID, req.Settings); err != nil {
		return PublishResult{}, err
	}
	if len(req.PlatformMediaIDs) == 0 {
		return PublishResult{}, fmt.Errorf("peertube publish requires an uploaded video")
	}
	prepared := PublishResult{ProviderState: "reconcile_upload", RetrySafety: PublishRetryReconcileOnly, ReconcileAfter: time.Minute}
	if err := req.BeginWrite(prepared); err != nil {
		return PublishResult{}, err
	}
	result, err := p.reconcileUploadedVideo(ctx, accessToken, req.PlatformMediaIDs[0])
	if err != nil {
		if result.ProviderReference != "" {
			return result, err
		}
		return prepared, err
	}
	if err := req.Checkpoint(result); err != nil {
		return result, err
	}
	return result, nil
}

func (p *PeerTubeAdapter) ReconcilePublish(ctx context.Context, accessToken, _ string, providerReference string) (PublishResult, error) {
	return p.reconcileUploadedVideo(ctx, accessToken, providerReference)
}

// UploadMedia without metadata is unsupported: a PeerTube upload creates the
// video object and requires a title and channel up front.
func (p *PeerTubeAdapter) UploadMedia(_ context.Context, _, _, _ string, _ io.Reader) (string, error) {
	return "", fmt.Errorf("peertube video upload requires post metadata")
}

func validatePeerTubeMedia(media []MediaItem) []MediaValidationIssue {
	for _, item := range media {
		if !isVideoMime(item.MimeType) {
			return []MediaValidationIssue{{
				Provider: providerPeerTube,
				MediaID:  item.ID,
				Severity: severityError,
				Message:  "PeerTube only publishes video; attach a video file to this destination.",
			}}
		}
	}
	return nil
}

type peertubeAccount struct {
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
}

type peertubeComment struct {
	ID                 int64           `json:"id"`
	URL                string          `json:"url"`
	Text               string          `json:"text"`
	ThreadID           int64           `json:"threadId"`
	InReplyToCommentID *int64          `json:"inReplyToCommentId"`
	CreatedAt          string          `json:"createdAt"`
	UpdatedAt          string          `json:"updatedAt"`
	IsDeleted          bool            `json:"isDeleted"`
	TotalReplies       int64           `json:"totalReplies"`
	Account            peertubeAccount `json:"account"`
}

const (
	peerTubeCommentPageSize     = 100
	peerTubeCommentMaxTreeDepth = 10
)

type peertubeCommentRepliesPage struct {
	Data []peertubeCommentNode `json:"data"`
}

// peertubeCommentNode is one node of the reply tree PeerTube returns for a
// single thread.
type peertubeCommentNode struct {
	Comment       peertubeComment       `json:"comment"`
	Children      []peertubeCommentNode `json:"children"`
	TotalChildren int64                 `json:"totalChildren"`
}

func (p *PeerTubeAdapter) EngagementSupport() EngagementSupport {
	return EngagementSupport{Enabled: true, CanReply: true, CanDelete: true}
}

func (p *PeerTubeAdapter) ListComments(ctx context.Context, accessToken, _ string, externalID string) ([]Comment, error) {
	videoID := strings.TrimSpace(externalID)
	if videoID == "" {
		return nil, fmt.Errorf("peertube comment listing requires a video id")
	}
	ownAccount := ""
	if me, err := p.fetchMe(ctx, accessToken); err == nil {
		ownAccount = firstNonEmptyString(me.Account.Name, me.Username)
	}
	// The thread list carries each thread's first comment as a plain comment.
	// Replies are only returned by the per-thread tree endpoint.
	threads, err := listPeerTubePages[peertubeComment](ctx, p.instanceURL+"/api/v1/videos/"+url.PathEscape(videoID)+"/comment-threads", accessToken, "comments")
	if err != nil {
		return nil, err
	}
	comments := make([]Comment, 0)
	var walk func(node *peertubeCommentNode, parentRef string)
	walk = func(node *peertubeCommentNode, parentRef string) {
		ref := peertubeCommentRef(videoID, node.Comment.ID)
		if !node.Comment.IsDeleted {
			author := "@" + strings.TrimSpace(node.Comment.Account.Name)
			comments = append(comments, Comment{
				ID: ref, ParentID: parentRef, ConversationID: videoID,
				AuthorID:     node.Comment.Account.Name,
				AuthorName:   firstNonEmptyString(node.Comment.Account.DisplayName, node.Comment.Account.Name),
				AuthorHandle: author, AuthorAvatarURL: "",
				Text:      mastodonPlainText(node.Comment.Text),
				CreatedAt: node.Comment.CreatedAt, UpdatedAt: node.Comment.UpdatedAt,
				IsOurs: ownAccount != "" && strings.EqualFold(node.Comment.Account.Name, ownAccount),
				// The publishing channel owns the video, so its owner can
				// moderate the conversation even on comments from others.
				CanReply: true, CanDelete: true,
			})
		}
		for i := range node.Children {
			walk(&node.Children[i], ref)
		}
	}
	for i := range threads {
		node := peertubeCommentNode{Comment: threads[i]}
		if node.Comment.TotalReplies > 0 {
			tree, err := p.fetchCommentThread(ctx, accessToken, videoID, node.Comment.ID)
			if err != nil {
				return nil, err
			}
			if err := p.hydrateCommentTree(ctx, accessToken, videoID, &tree); err != nil {
				return nil, err
			}
			node = tree
		}
		walk(&node, "")
	}
	return comments, nil
}

func (p *PeerTubeAdapter) fetchCommentThread(ctx context.Context, accessToken, videoID string, threadID int64) (peertubeCommentNode, error) {
	body, err := DoRequest(ctx, http.MethodGet, p.instanceURL+"/api/v1/videos/"+url.PathEscape(videoID)+"/comment-threads/"+strconv.FormatInt(threadID, 10), nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return peertubeCommentNode{}, fmt.Errorf("fetching peertube comment thread: %w", err)
	}
	var tree peertubeCommentNode
	if err := json.Unmarshal(body, &tree); err != nil {
		return peertubeCommentNode{}, fmt.Errorf("decoding peertube comment thread: %w", err)
	}
	return tree, nil
}

func (p *PeerTubeAdapter) hydrateCommentTree(ctx context.Context, accessToken, videoID string, node *peertubeCommentNode) error {
	for start := len(node.Children); int64(start) < node.TotalChildren; {
		page, err := p.fetchCommentReplies(ctx, accessToken, videoID, node.Comment.ID, start)
		if err != nil {
			return err
		}
		if len(page.Data) == 0 {
			return fmt.Errorf("peertube comment %d replies ended at %d of %d", node.Comment.ID, start, node.TotalChildren)
		}
		node.Children = append(node.Children, page.Data...)
		start += len(page.Data)
	}

	for i := range node.Children {
		if err := p.hydrateCommentTree(ctx, accessToken, videoID, &node.Children[i]); err != nil {
			return err
		}
	}
	return nil
}

func (p *PeerTubeAdapter) fetchCommentReplies(ctx context.Context, accessToken, videoID string, commentID int64, start int) (peertubeCommentRepliesPage, error) {
	query := url.Values{
		"count":    {strconv.Itoa(peerTubeCommentPageSize)},
		"maxDepth": {strconv.Itoa(peerTubeCommentMaxTreeDepth)},
		"start":    {strconv.Itoa(start)},
	}
	body, err := DoRequest(ctx, http.MethodGet, p.instanceURL+"/api/v1/videos/"+url.PathEscape(videoID)+"/comments/"+strconv.FormatInt(commentID, 10)+"/replies?"+query.Encode(), nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return peertubeCommentRepliesPage{}, fmt.Errorf("fetching peertube comment replies: %w", err)
	}
	var page peertubeCommentRepliesPage
	if err := json.Unmarshal(body, &page); err != nil {
		return peertubeCommentRepliesPage{}, fmt.Errorf("decoding peertube comment replies: %w", err)
	}
	return page, nil
}

func (p *PeerTubeAdapter) ReplyToComment(ctx context.Context, accessToken, _ string, commentID, message string) (string, error) {
	videoID, parentCommentID, err := splitPeerTubeCommentRef(commentID)
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(map[string]string{"text": strings.TrimSpace(message)})
	if err != nil {
		return "", err
	}
	body, err := DoRequest(ctx, "POST", p.instanceURL+"/api/v1/videos/"+url.PathEscape(videoID)+"/comments/"+url.PathEscape(parentCommentID), bytes.NewReader(payload), map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
		headerContentType:   contentTypeJSON,
	})
	if err != nil {
		return "", fmt.Errorf("replying to peertube comment: %w", err)
	}
	var result struct {
		Comment struct {
			ID int64 `json:"id"`
		} `json:"comment"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("decoding peertube reply: %w", err)
	}
	return peertubeCommentRef(videoID, result.Comment.ID), nil
}

// splitPeerTubeCommentRef decodes the opaque reference built by
// peertubeCommentRef: the video plus the numeric comment being addressed.
func splitPeerTubeCommentRef(ref string) (videoID, commentID string, err error) {
	parts := strings.Split(strings.TrimSpace(ref), ":")
	if len(parts) != 3 || parts[0] != "peertube" || parts[1] == "" || parts[2] == "" {
		return "", "", fmt.Errorf("peertube reply reference is invalid")
	}
	if _, parseErr := strconv.ParseInt(parts[2], 10, 64); parseErr != nil {
		return "", "", fmt.Errorf("peertube reply reference is invalid")
	}
	return parts[1], parts[2], nil
}

func peertubeCommentRef(videoID string, commentID int64) string {
	return "peertube:" + videoID + ":" + strconv.FormatInt(commentID, 10)
}

func (p *PeerTubeAdapter) HideComment(_ context.Context, _, _, _ string) error {
	return fmt.Errorf("peertube hide reply: %w", ErrUnsupportedCommentAction)
}

func (p *PeerTubeAdapter) DeleteComment(ctx context.Context, accessToken, _ string, commentID string) error {
	videoID, targetCommentID, err := splitPeerTubeCommentRef(commentID)
	if err != nil {
		return err
	}
	_, err = DoRequest(ctx, http.MethodDelete, p.instanceURL+"/api/v1/videos/"+url.PathEscape(videoID)+"/comments/"+url.PathEscape(targetCommentID), nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return fmt.Errorf("deleting peertube comment: %w", err)
	}
	return nil
}

func (p *PeerTubeAdapter) AnalyticsSupport() AnalyticsSupport {
	return AnalyticsSupport{Account: true, Content: true}
}

func (p *PeerTubeAdapter) FetchAccountAnalytics(ctx context.Context, accessToken string, input AccountAnalyticsRequest) (AnalyticsValues, error) {
	channel := strings.TrimSpace(input.AccountID)
	if channel == "" {
		return nil, fmt.Errorf("peertube account analytics requires a channel")
	}
	var result struct {
		FollowersCount *int64 `json:"followersCount"`
	}
	body, err := DoRequest(ctx, http.MethodGet, p.instanceURL+"/api/v1/video-channels/"+url.PathEscape(channel), nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return nil, fmt.Errorf("peertube channel analytics: %w", err)
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("decoding peertube channel analytics: %w", err)
	}
	values := AnalyticsValues{}
	addOptionalMetric(values, MetricFollowers, result.FollowersCount)
	return values, nil
}

func (p *PeerTubeAdapter) FetchContentAnalytics(ctx context.Context, accessToken string, input ContentAnalyticsRequest) (AnalyticsValues, error) {
	total := AnalyticsValues{}
	for _, externalID := range uniqueNonEmpty(input.ExternalIDs) {
		video, err := p.fetchVideo(ctx, accessToken, externalID)
		if err != nil {
			return nil, fmt.Errorf("peertube content analytics: %w", err)
		}
		// PeerTube reports dislikes with no OpenPost-native counterpart;
		// they are omitted rather than relabelled, and a missing key
		// stays distinct from a measured zero.
		views, likes := video.Views, video.Likes
		addOptionalMetric(total, MetricViews, &views)
		addOptionalMetric(total, MetricLikes, &likes)
	}
	return total, nil
}

func (p *PeerTubeAdapter) AccountContentDiscoverySupport(input AnalyticsAccountContext) AccountContentDiscoverySupport {
	if strings.TrimSpace(input.AccountID) == "" {
		return AccountContentDiscoverySupport{UnavailableReason: "PeerTube account content discovery requires a channel."}
	}
	return AccountContentDiscoverySupport{Supported: true, MaxPageSize: 25}
}

type peertubeChannelVideo struct {
	UUID        string `json:"uuid"`
	ShortUUID   string `json:"shortUUID"`
	Name        string `json:"name"`
	Description string `json:"description"`
	PublishedAt string `json:"publishedAt"`
}

func (p *PeerTubeAdapter) DiscoverAccountContent(ctx context.Context, accessToken string, input AccountContentDiscoveryRequest) (AccountContentPage, error) {
	channel := strings.TrimSpace(input.AccountID)
	if channel == "" {
		return AccountContentPage{}, NewAccountContentDiscoveryError(AccountContentDiscoveryUnsupported, "missing_channel", 0)
	}
	start := 0
	if cursor := strings.TrimSpace(input.Cursor); cursor != "" {
		if parsed, err := strconv.Atoi(cursor); err == nil && parsed > 0 {
			start = parsed
		}
	}
	var result struct {
		Total int64                  `json:"total"`
		Data  []peertubeChannelVideo `json:"data"`
	}
	params := url.Values{"count": {"25"}, "sort": {"-publishedAt"}, "start": {strconv.Itoa(start)}}
	body, err := DoRequest(ctx, http.MethodGet, p.instanceURL+"/api/v1/video-channels/"+url.PathEscape(channel)+"/videos?"+params.Encode(), nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return AccountContentPage{}, socialAccountContentDiscoveryError(err)
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return AccountContentPage{}, fmt.Errorf("decoding peertube channel videos: %w", err)
	}
	page := AccountContentPage{Coverage: AccountContentCoverage{
		Status:      AccountContentDiscoveryPartial,
		Description: "Only videos visible through the authenticated PeerTube instance are included.",
	}}
	reachedLowerBound := false
	for _, video := range result.Data {
		item, ok := p.normalizeAccountContentVideo(video)
		if !ok {
			continue
		}
		// Videos come newest first, so the first one published before the
		// window means the rest of the channel is older too.
		if item.PublishedAt.Before(input.PublishedAfter) {
			reachedLowerBound = true
			break
		}
		page.Items = append(page.Items, item)
		if page.BackfillWatermark.IsZero() || item.PublishedAt.Before(page.BackfillWatermark) {
			page.BackfillWatermark = item.PublishedAt
		}
	}
	// The cursor is an offset into the listing, so it advances by every
	// video read, including those left out of the page.
	if next := int64(start + len(result.Data)); !reachedLowerBound && next < result.Total {
		page.NextCursor = strconv.FormatInt(next, 10)
	}
	return page, nil
}

func (p *PeerTubeAdapter) normalizeAccountContentVideo(video peertubeChannelVideo) (AccountContentItem, bool) {
	publishedAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(video.PublishedAt))
	if err != nil || publishedAt.IsZero() {
		return AccountContentItem{}, false
	}
	publishedAt = publishedAt.UTC()
	item := AccountContentItem{
		ProviderContentID: p.instanceURL + "/videos/watch/" + firstNonEmptyString(video.UUID, video.ShortUUID),
		ContentProfile:    "long_video",
		Title:             video.Name,
		Text:              video.Description,
		ExternalURL:       p.instanceURL + "/w/" + firstNonEmptyString(video.ShortUUID, video.UUID),
		PublishedAt:       publishedAt,
		Origin:            AccountContentOriginExternal,
		OriginConfidence:  AccountContentOriginConfidenceExact,
	}
	normalized, err := NormalizeAccountContentItem(providerPeerTube, item)
	return normalized, err == nil
}
