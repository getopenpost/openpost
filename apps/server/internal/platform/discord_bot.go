package platform

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	discordAPIBase                     = "https://discord.com/api/v10"
	discordOAuthAuthorizeURL           = "https://discord.com/oauth2/authorize"
	discordGuildTextChannel            = 0
	discordGuildAnnouncementChannel    = 5
	discordPermissionAdministrator     = uint64(1 << 3)
	discordPermissionManageGuild       = uint64(1 << 5)
	discordPermissionViewChannel       = uint64(1 << 10)
	discordPermissionSendMessages      = uint64(1 << 11)
	discordPermissionMentionEveryone   = uint64(1 << 17)
	discordApplicationGuildMembers     = uint64(1 << 14)
	discordApplicationGuildMembersLite = uint64(1 << 15)
	discordInstallPermissions          = discordPermissionViewChannel | discordPermissionSendMessages
	discordGuildCredentialPrefix       = "discord-guild:"
	discordChannelPermissionLostCode   = "discord_channel_permission_lost"
	discordMentionPermissionLostCode   = "discord_mention_permission_lost"
	discordEmbedInvalidCode            = "discord_embed_invalid"
	discordAnalyticsMaxMessages        = 25
)

type DiscordBotAdapter struct {
	clientID     string
	clientSecret string
	botToken     string
	redirectURI  string
}

func NewDiscordBotAdapter(clientID, clientSecret, botToken, redirectURI string) *DiscordBotAdapter {
	return &DiscordBotAdapter{
		clientID: strings.TrimSpace(clientID), clientSecret: strings.TrimSpace(clientSecret),
		botToken: strings.TrimSpace(botToken), redirectURI: strings.TrimSpace(redirectURI),
	}
}

func (d *DiscordBotAdapter) AuthorizationGrantDescriptor() AuthorizationGrantDescriptor {
	return AuthorizationGrantDescriptor{
		ProjectID: d.clientID, ExecutionMode: "bot_oauth2",
		Evidence: map[string]string{
			"protocol": "oauth2", "exchange": "authorization_code", "connection_type": ConnectionModeBot,
		},
	}
}

func (d *DiscordBotAdapter) GenerateAuthURL(state string) (string, map[string]string) {
	values := url.Values{
		"client_id":     {d.clientID},
		"redirect_uri":  {d.redirectURI},
		"response_type": {"code"},
		"scope":         {"identify guilds bot"},
		"permissions":   {strconv.FormatUint(discordInstallPermissions, 10)},
		"state":         {state},
	}
	return discordOAuthAuthorizeURL + "?" + values.Encode(), nil
}

func (d *DiscordBotAdapter) ExchangeCode(ctx context.Context, code string, _ map[string]string) (*TokenResult, error) {
	body, err := DoFormURLEncodedValues(ctx, http.MethodPost, discordAPIBase+"/oauth2/token", url.Values{
		"grant_type":   {"authorization_code"},
		"code":         {strings.TrimSpace(code)},
		"redirect_uri": {d.redirectURI},
	}, map[string]string{
		headerAuthorization: "Basic " + base64.StdEncoding.EncodeToString([]byte(d.clientID+":"+d.clientSecret)),
	})
	if err != nil {
		return nil, fmt.Errorf("exchanging discord authorization: %w", err)
	}
	var response struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
		TokenType    string `json:"token_type"`
		Scope        string `json:"scope"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decoding discord authorization: %w", err)
	}
	if strings.TrimSpace(response.AccessToken) == "" {
		return nil, fmt.Errorf("discord authorization did not return an access token")
	}
	return &TokenResult{
		AccessToken: response.AccessToken, RefreshToken: response.RefreshToken,
		ExpiresIn: response.ExpiresIn, TokenType: response.TokenType,
		Extra: map[string]string{"scope": response.Scope, "connection_type": ConnectionModeBot},
	}, nil
}

func (*DiscordBotAdapter) RefreshCapability() RefreshCapability {
	return RefreshCapability{Supported: false, CredentialSource: RefreshCredentialNone}
}

func (*DiscordBotAdapter) RefreshToken(context.Context, RefreshTokenInput) (*TokenResult, error) {
	return nil, fmt.Errorf("discord bot installations reconnect through OAuth")
}

func (d *DiscordBotAdapter) GetProfile(ctx context.Context, accessToken string) (*UserProfile, error) {
	var user discordUser
	if err := d.discordGetJSON(ctx, "/users/@me", "Bearer "+accessToken, &user); err != nil {
		return nil, fmt.Errorf("loading discord user: %w", err)
	}
	if user.ID == "" {
		return nil, fmt.Errorf("discord user response did not include an id")
	}
	return &UserProfile{ID: user.ID, Username: firstNonEmptyString(user.GlobalName, user.Username), AvatarURL: discordAvatarURL(user.ID, user.Avatar)}, nil
}

func (d *DiscordBotAdapter) RefreshAccountMetadata(ctx context.Context, _ string, input AccountMetadataRequest) (*UserProfile, error) {
	guildID := strings.TrimSpace(input.AccountID)
	if guildID == "" {
		return nil, fmt.Errorf("discord guild id is required")
	}
	var guild discordGuild
	if err := d.discordGetJSON(ctx, "/guilds/"+url.PathEscape(guildID)+"?with_counts=true", "Bot "+d.botToken, &guild); err != nil {
		return nil, fmt.Errorf("loading discord guild profile: %w", err)
	}
	if guild.ID != guildID {
		return nil, fmt.Errorf("discord guild profile returned a different id")
	}
	return &UserProfile{
		ID: guild.ID, Username: guild.Name, DisplayName: guild.Name,
		AvatarURL: discordGuildIconURL(guild.ID, guild.Icon),
	}, nil
}

func (d *DiscordBotAdapter) ListAccountSelections(ctx context.Context, token *TokenResult) ([]AccountSelectionOption, error) {
	if token == nil || strings.TrimSpace(token.AccessToken) == "" {
		return nil, fmt.Errorf("discord user authorization is unavailable")
	}
	guilds, err := d.userGuilds(ctx, token.AccessToken)
	if err != nil {
		return nil, err
	}
	options := make([]AccountSelectionOption, 0, len(guilds))
	for _, guild := range guilds {
		if !discordGuildSelectable(guild) {
			continue
		}
		installed, installErr := d.botInstalledInGuild(ctx, guild.ID)
		if installErr != nil {
			return nil, installErr
		}
		if !installed {
			continue
		}
		extra := map[string]string{}
		if guild.ApproximateMemberCount > 0 {
			extra["members"] = strconv.Itoa(guild.ApproximateMemberCount)
		}
		options = append(options, AccountSelectionOption{
			ID: guild.ID, Username: guild.Name, DisplayName: guild.Name,
			AvatarURL: discordGuildIconURL(guild.ID, guild.Icon), Kind: "guild", Extra: extra,
		})
	}
	sort.Slice(options, func(i, j int) bool {
		return strings.ToLower(options[i].DisplayName) < strings.ToLower(options[j].DisplayName)
	})
	return options, nil
}

func (d *DiscordBotAdapter) SelectAccount(ctx context.Context, token *TokenResult, selectionID string) (*SelectedAccount, error) {
	selectionID = strings.TrimSpace(selectionID)
	if token == nil || selectionID == "" {
		return nil, fmt.Errorf("discord guild selection is required")
	}
	guilds, err := d.userGuilds(ctx, token.AccessToken)
	if err != nil {
		return nil, err
	}
	for _, guild := range guilds {
		if guild.ID != selectionID || !discordGuildSelectable(guild) {
			continue
		}
		installed, installErr := d.botInstalledInGuild(ctx, guild.ID)
		if installErr != nil {
			return nil, installErr
		}
		if !installed {
			break
		}
		capabilityState := map[string]string{
			"connection_type":  ConnectionModeBot,
			"discord_guild_id": guild.ID,
		}
		if guild.ApproximateMemberCount > 0 {
			capabilityState["approximate_member_count"] = strconv.Itoa(guild.ApproximateMemberCount)
		}
		// The instance-owned bot token never crosses into Workspace credentials.
		// This non-secret installation reference lets account-scoped option reads
		// recover the selected guild while provider mutations use botToken.
		return &SelectedAccount{
			AccountID: guild.ID, AccountUsername: guild.Name,
			AccountAvatarURL: discordGuildIconURL(guild.ID, guild.Icon),
			Token: &TokenResult{
				AccessToken: discordGuildCredentialPrefix + guild.ID,
				TokenType:   "Installation",
				Extra:       map[string]string{"connection_type": ConnectionModeBot, "scope": "bot"},
			},
			CapabilityState: capabilityState,
		}, nil
	}
	return nil, fmt.Errorf("selected discord guild is unavailable or no longer manageable")
}

func (d *DiscordBotAdapter) ListDestinationOptions(ctx context.Context, credential string, _ DestinationOptionsInput) (map[string][]DestinationOption, error) {
	guildID, err := discordGuildIDFromCredential(credential)
	if err != nil {
		return nil, err
	}
	channels, err := d.permittedChannels(ctx, guildID)
	if err != nil {
		return nil, err
	}
	return map[string][]DestinationOption{"discord_channels": discordDestinationOptions(channels)}, nil
}

func (d *DiscordBotAdapter) SearchPublishingOptions(ctx context.Context, credential string, input PublishingOptionsInput) (PublishingOptionsPage, error) {
	guildID, err := discordGuildIDFromCredential(credential)
	if err != nil {
		return PublishingOptionsPage{}, err
	}
	limit := input.Limit
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	switch input.Source {
	case "discord_channels":
		groups, listErr := d.ListDestinationOptions(ctx, credential, DestinationOptionsInput{})
		if listErr != nil {
			return PublishingOptionsPage{}, listErr
		}
		return paginateDiscordOptions(groups[input.Source], input.Search, input.Cursor, limit), nil
	case "discord_roles":
		return d.searchDiscordRoles(ctx, guildID, input, limit)
	case "discord_members":
		return d.searchDiscordMembers(ctx, guildID, input, limit)
	default:
		return PublishingOptionsPage{}, nil
	}
}

func (d *DiscordBotAdapter) searchDiscordRoles(ctx context.Context, guildID string, input PublishingOptionsInput, limit int) (PublishingOptionsPage, error) {
	permissionContext, err := d.permissionContext(ctx, guildID)
	if err != nil {
		return PublishingOptionsPage{}, err
	}
	permissions, permitted := permissionContext.channelPermissions(discordPublishingContextChannelID(input.Context))
	if !permitted {
		return PublishingOptionsPage{}, nil
	}
	options := make([]DestinationOption, 0, len(permissionContext.guild.Roles))
	for _, role := range permissionContext.guild.Roles {
		if role.ID == permissionContext.guild.ID || (!role.Mentionable && permissions&discordPermissionMentionEveryone == 0) {
			continue
		}
		options = append(options, DestinationOption{Value: role.ID, Label: "@" + role.Name})
	}
	sort.Slice(options, func(i, j int) bool { return strings.ToLower(options[i].Label) < strings.ToLower(options[j].Label) })
	return paginateDiscordOptions(options, input.Search, input.Cursor, limit), nil
}

func (d *DiscordBotAdapter) searchDiscordMembers(ctx context.Context, guildID string, input PublishingOptionsInput, limit int) (PublishingOptionsPage, error) {
	query := strings.TrimSpace(input.Search)
	if query == "" {
		return PublishingOptionsPage{}, nil
	}
	permissionContext, err := d.permissionContext(ctx, guildID)
	if err != nil {
		return PublishingOptionsPage{}, err
	}
	if _, permitted := permissionContext.channelPermissions(discordPublishingContextChannelID(input.Context)); !permitted {
		return PublishingOptionsPage{}, nil
	}
	approved, err := d.memberSearchApproved(ctx)
	if err != nil || !approved {
		return PublishingOptionsPage{}, err
	}
	var members []discordGuildMember
	path := "/guilds/" + url.PathEscape(guildID) + "/members/search?query=" + url.QueryEscape(query) + "&limit=" + strconv.Itoa(limit)
	if err := d.discordGetJSON(ctx, path, "Bot "+d.botToken, &members); err != nil {
		return PublishingOptionsPage{}, normalizeDiscordMentionPermissionError(err)
	}
	options := make([]DestinationOption, 0, len(members))
	for _, member := range members {
		if member.User.ID == "" {
			continue
		}
		label := firstNonEmptyString(member.Nick, member.User.GlobalName, member.User.Username, member.User.ID)
		options = append(options, DestinationOption{Value: member.User.ID, Label: "@" + label})
	}
	return PublishingOptionsPage{Options: options}, nil
}

func (d *DiscordBotAdapter) ResolveAccountPublishingCapabilities(ctx context.Context, credential string, input AccountCapabilityInput) (AccountCapabilityResult, error) {
	guildID, err := discordGuildIDFromCredential(credential)
	if err != nil {
		return AccountCapabilityResult{}, err
	}
	permissionContext, err := d.permissionContext(ctx, guildID)
	if err != nil {
		return AccountCapabilityResult{}, err
	}
	groups := map[string][]DestinationOption{"discord_channels": discordDestinationOptions(permissionContext.permittedChannels())}
	channelPermissions, channelPermitted := permissionContext.channelPermissions(strings.TrimSpace(stringSetting(input.Settings, "channel_id")))
	memberSearchApproved := false
	if channelPermitted {
		memberSearchApproved, err = d.memberSearchApproved(ctx)
		if err != nil {
			return AccountCapabilityResult{}, err
		}
	}
	roleMentionsApproved := false
	if channelPermitted {
		for _, role := range permissionContext.guild.Roles {
			if role.ID != permissionContext.guild.ID && (role.Mentionable || channelPermissions&discordPermissionMentionEveryone != 0) {
				roleMentionsApproved = true
				break
			}
		}
	}
	result := AccountCapabilityResult{
		Revision: "discord-bot-v2", Options: groups,
		Constraints: map[string]interface{}{"text_limit": 2000, "media_max_count": 10},
		AvailableFeatures: map[string]bool{
			"channel_id":       len(groups["discord_channels"]) > 0,
			"mention_policy":   channelPermitted && (memberSearchApproved || roleMentionsApproved),
			"mention_user_ids": memberSearchApproved,
			"mention_role_ids": roleMentionsApproved,
		},
		State: map[string]string{"connection_type": ConnectionModeBot},
	}
	if len(groups["discord_channels"]) == 0 {
		result.UnavailableReason = "The bot cannot currently view and send to any text or announcement channel."
	}
	return result, nil
}

func (*DiscordBotAdapter) AnalyticsSupport() AnalyticsSupport {
	return AnalyticsSupport{Account: true, Content: true}
}

func (*DiscordBotAdapter) UsesProviderToken() bool {
	return false
}

func (*DiscordBotAdapter) RequiresProviderReferences() bool {
	return true
}

func (d *DiscordBotAdapter) FetchAccountAnalytics(ctx context.Context, _ string, input AccountAnalyticsRequest) (AnalyticsValues, error) {
	measurements, err := d.FetchAccountAnalyticsMeasurements(ctx, "", input)
	return discordAnalyticsValues(measurements), err
}

func (d *DiscordBotAdapter) FetchAccountAnalyticsMeasurements(ctx context.Context, _ string, input AccountAnalyticsRequest) (AnalyticsMeasurements, error) {
	guildID := strings.TrimSpace(input.AccountID)
	if guildID == "" {
		return nil, NewAnalyticsError(AnalyticsStatusNotFound, "missing_account_id")
	}
	var guild struct {
		ID                     string `json:"id"`
		ApproximateMemberCount *int64 `json:"approximate_member_count"`
	}
	if err := d.discordGetJSON(ctx, "/guilds/"+url.PathEscape(guildID)+"?with_counts=true", "Bot "+d.botToken, &guild); err != nil {
		return nil, fmt.Errorf("loading discord guild analytics: %w", err)
	}
	if guild.ID != guildID || guild.ApproximateMemberCount == nil {
		return nil, NewAnalyticsError(AnalyticsStatusNotFound, "discord_member_count_unavailable")
	}
	return AnalyticsMeasurements{
		MetricMembers: {
			Value: max(0, *guild.ApproximateMemberCount),
			AnalyticsMetricMetadata: AnalyticsMetricMetadata{
				Unit: AnalyticsMetricUnitCount, Aggregation: AnalyticsMetricAggregationCurrentSnapshot, Source: providerDiscord,
			},
		},
	}, nil
}

func (d *DiscordBotAdapter) FetchContentAnalytics(ctx context.Context, _ string, input ContentAnalyticsRequest) (AnalyticsValues, error) {
	measurements, err := d.FetchContentAnalyticsMeasurements(ctx, "", input)
	return discordAnalyticsValues(measurements), err
}

func (d *DiscordBotAdapter) FetchContentAnalyticsMeasurements(ctx context.Context, _ string, input ContentAnalyticsRequest) (AnalyticsMeasurements, error) {
	identities, err := discordAnalyticsMessageIdentities(input)
	if err != nil {
		return nil, err
	}
	var reactions, replies int64
	for _, identity := range identities {
		var message discordMessage
		path := "/channels/" + url.PathEscape(identity.channelID) + "/messages/" + url.PathEscape(identity.messageID)
		if err := d.discordGetJSON(ctx, path, "Bot "+d.botToken, &message); err != nil {
			return nil, fmt.Errorf("loading discord message analytics: %w", err)
		}
		if message.ID != identity.messageID || (message.ChannelID != "" && message.ChannelID != identity.channelID) {
			return nil, NewAnalyticsError(AnalyticsStatusNotFound, "discord_message_identity_mismatch")
		}
		for _, reaction := range message.Reactions {
			reactions += max(0, reaction.Count)
		}
		if message.Thread != nil {
			replies += max(0, message.Thread.MessageCount)
		}
	}
	metadata := AnalyticsMetricMetadata{
		Unit: AnalyticsMetricUnitCount, Aggregation: AnalyticsMetricAggregationLifetimeTotal, Source: providerDiscord,
	}
	return AnalyticsMeasurements{
		MetricReactions: {Value: reactions, AnalyticsMetricMetadata: metadata},
		MetricComments:  {Value: replies, AnalyticsMetricMetadata: metadata},
	}, nil
}

type discordAnalyticsMessageIdentity struct {
	channelID string
	messageID string
}

func discordAnalyticsMessageIdentities(input ContentAnalyticsRequest) ([]discordAnalyticsMessageIdentity, error) {
	persistedIDs := make(map[string]struct{}, len(input.ExternalIDs))
	for _, id := range input.ExternalIDs {
		if id = strings.TrimSpace(id); id != "" {
			persistedIDs[id] = struct{}{}
		}
	}
	if len(persistedIDs) == 0 {
		return nil, NewAnalyticsError(AnalyticsStatusNotFound, "missing_external_id")
	}
	if len(persistedIDs) > discordAnalyticsMaxMessages {
		return nil, NewAnalyticsError(AnalyticsStatusFailed, "discord_message_read_limit")
	}

	identities := make([]discordAnalyticsMessageIdentity, 0, len(input.ProviderReferences))
	seen := make(map[string]struct{}, len(input.ProviderReferences))
	for _, reference := range input.ProviderReferences {
		channelID, messageID, ok := parseDiscordMessageReference(reference)
		if !ok {
			continue
		}
		if _, persisted := persistedIDs[messageID]; !persisted {
			continue
		}
		key := channelID + "\x00" + messageID
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		seen[key] = struct{}{}
		identities = append(identities, discordAnalyticsMessageIdentity{channelID: channelID, messageID: messageID})
	}
	if len(identities) != len(persistedIDs) {
		return nil, NewAnalyticsError(AnalyticsStatusNotFound, "discord_message_receipt_missing")
	}
	return identities, nil
}

func discordAnalyticsValues(measurements AnalyticsMeasurements) AnalyticsValues {
	if measurements == nil {
		return nil
	}
	values := make(AnalyticsValues, len(measurements))
	for metric, measurement := range measurements {
		values[metric] = measurement.Value
	}
	return values
}

func (*DiscordBotAdapter) UploadMedia(context.Context, string, string, string, io.Reader) (string, error) {
	return "", fmt.Errorf("discord bot media is attached when the message is sent")
}

func (d *DiscordBotAdapter) Publish(ctx context.Context, _ string, guildID string, req *PublishRequest) (PublishResult, error) {
	return d.publish(ctx, guildID, req, nil)
}

func (d *DiscordBotAdapter) PublishWithMedia(ctx context.Context, _ string, guildID string, req *PublishRequest, media []UploadMediaRequest) (PublishResult, error) {
	if len(media) > 10 {
		return PublishResult{}, fmt.Errorf("discord messages support up to 10 attachments")
	}
	return d.publish(ctx, guildID, req, media)
}

func (d *DiscordBotAdapter) publish(ctx context.Context, guildID string, req *PublishRequest, media []UploadMediaRequest) (PublishResult, error) {
	guildID = strings.TrimSpace(guildID)
	channelID := strings.TrimSpace(stringSetting(req.Settings, "channel_id"))
	if channelID == "" {
		return PublishResult{}, &HTTPError{StatusCode: http.StatusBadRequest, Code: "discord_channel_required"}
	}
	embeds, err := discordEmbeds(req.Settings)
	if err != nil {
		return PublishResult{}, &HTTPError{StatusCode: http.StatusBadRequest, Code: discordEmbedInvalidCode}
	}
	permissionContext, err := d.permissionContext(ctx, guildID)
	if err != nil {
		return PublishResult{}, err
	}
	channelPermissions, permitted := permissionContext.channelPermissions(channelID)
	if !permitted {
		return PublishResult{}, &HTTPError{StatusCode: http.StatusForbidden, Code: discordChannelPermissionLostCode}
	}
	mentionUsers, mentionRoles, err := d.approvedMentions(ctx, permissionContext, channelPermissions, req.Settings)
	if err != nil {
		return PublishResult{}, err
	}

	body, err := json.Marshal(discordBotMessagePayload(req, media, embeds, mentionUsers, mentionRoles))
	if err != nil {
		return PublishResult{}, fmt.Errorf("encoding discord bot message: %w", err)
	}
	prepared := PublishResult{
		SubmissionState: PublishSubmissionUnknown,
		ProviderState:   "execute_bot_message",
		RetrySafety:     PublishRetryNever,
	}
	if err := req.BeginWrite(prepared); err != nil {
		return PublishResult{}, err
	}
	message, err := d.sendDiscordBotMessage(ctx, channelID, body, media)
	if err != nil {
		return prepared, err
	}
	result := discordAcceptedMessageResult(guildID, channelID, message)
	if err := req.Checkpoint(result); err != nil {
		return result, err
	}
	return result, nil
}

func discordBotMessagePayload(req *PublishRequest, media []UploadMediaRequest, embeds []discordEmbed, mentionUsers, mentionRoles []string) map[string]any {
	payload := map[string]any{
		"content":          strings.TrimSpace(req.Content),
		"allowed_mentions": discordAllowedMentions(mentionUsers, mentionRoles),
	}
	if len(embeds) > 0 {
		payload["embeds"] = embeds
	}
	if len(media) == 0 {
		return payload
	}
	attachments := make([]map[string]any, 0, len(media))
	for index, item := range media {
		attachment := map[string]any{"id": index, "filename": discordFilename(item.Filename, index)}
		if index < len(req.MediaAltTexts) && strings.TrimSpace(req.MediaAltTexts[index]) != "" {
			attachment["description"] = strings.TrimSpace(req.MediaAltTexts[index])
		}
		attachments = append(attachments, attachment)
	}
	payload["attachments"] = attachments
	return payload
}

func (d *DiscordBotAdapter) sendDiscordBotMessage(ctx context.Context, channelID string, body []byte, media []UploadMediaRequest) (discordMessage, error) {
	endpoint := discordAPIBase + "/channels/" + url.PathEscape(channelID) + "/messages"
	headers := map[string]string{headerAuthorization: "Bot " + d.botToken}
	var response []byte
	var err error
	if len(media) == 0 {
		headers[headerContentType] = contentTypeJSON
		response, err = DoRequest(ctx, http.MethodPost, endpoint, bytes.NewReader(body), headers)
	} else {
		response, err = doDiscordMultipartWithHeaders(ctx, endpoint, body, media, headers)
	}
	if err != nil {
		return discordMessage{}, fmt.Errorf("sending discord bot message: %w", err)
	}
	var message discordMessage
	if err := json.Unmarshal(response, &message); err != nil {
		return discordMessage{}, fmt.Errorf("decoding discord bot response: %w", err)
	}
	if message.ID == "" {
		return discordMessage{}, fmt.Errorf("discord bot response did not include a message id")
	}
	if message.ChannelID != "" && message.ChannelID != channelID {
		return discordMessage{}, fmt.Errorf("discord bot response identified an unexpected channel")
	}
	return message, nil
}

func (d *DiscordBotAdapter) ReconcilePublish(ctx context.Context, _ string, guildID, providerReference string) (PublishResult, error) {
	channelID, messageID, ok := parseDiscordMessageReference(providerReference)
	if !ok {
		return PublishResult{}, &HTTPError{StatusCode: http.StatusBadRequest, Code: "discord_message_reference_invalid"}
	}
	permissionContext, err := d.permissionContext(ctx, strings.TrimSpace(guildID))
	if err != nil {
		return PublishResult{}, err
	}
	if _, permitted := permissionContext.channelPermissions(channelID); !permitted {
		return PublishResult{}, &HTTPError{StatusCode: http.StatusForbidden, Code: discordChannelPermissionLostCode}
	}
	var message discordMessage
	err = d.discordGetJSON(ctx, "/channels/"+url.PathEscape(channelID)+"/messages/"+url.PathEscape(messageID), "Bot "+d.botToken, &message)
	if discordHTTPStatus(err) == http.StatusNotFound {
		return PublishResult{SubmissionState: PublishSubmissionRejected, ProviderState: "discord_message_missing", ProviderReference: providerReference, RetrySafety: PublishRetryNever}, &HTTPError{StatusCode: http.StatusNotFound, Code: "discord_message_not_found"}
	}
	if err != nil {
		return PublishResult{SubmissionState: PublishSubmissionPending, ProviderState: "discord_message_reconcile", ProviderReference: providerReference, RetrySafety: PublishRetryReconcileOnly}, err
	}
	if message.ID != messageID || (message.ChannelID != "" && message.ChannelID != channelID) {
		return PublishResult{SubmissionState: PublishSubmissionPending, ProviderState: "discord_message_reconcile", ProviderReference: providerReference, RetrySafety: PublishRetryReconcileOnly}, fmt.Errorf("discord message reconciliation returned an unexpected identity")
	}
	return discordAcceptedMessageResult(strings.TrimSpace(guildID), channelID, message), nil
}

type discordUser struct {
	ID         string `json:"id"`
	Username   string `json:"username"`
	GlobalName string `json:"global_name"`
	Avatar     string `json:"avatar"`
}

type discordGuildSummary struct {
	ID                     string `json:"id"`
	Name                   string `json:"name"`
	Icon                   string `json:"icon"`
	Owner                  bool   `json:"owner"`
	Permissions            string `json:"permissions"`
	ApproximateMemberCount int    `json:"approximate_member_count"`
}

type discordRole struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Permissions string `json:"permissions"`
	Mentionable bool   `json:"mentionable"`
}

type discordGuild struct {
	ID                     string        `json:"id"`
	Name                   string        `json:"name"`
	Icon                   string        `json:"icon"`
	Roles                  []discordRole `json:"roles"`
	ApproximateMemberCount int           `json:"approximate_member_count"`
}

type discordGuildMember struct {
	Nick  string      `json:"nick"`
	Roles []string    `json:"roles"`
	User  discordUser `json:"user"`
}

type discordApplication struct {
	Flags uint64 `json:"flags"`
}

type discordMessageAttachment struct {
	ID string `json:"id"`
}

type discordMessage struct {
	ID          string                     `json:"id"`
	ChannelID   string                     `json:"channel_id"`
	Attachments []discordMessageAttachment `json:"attachments"`
	Reactions   []discordMessageReaction   `json:"reactions"`
	Thread      *discordMessageThread      `json:"thread"`
}

type discordMessageReaction struct {
	Count int64 `json:"count"`
}

type discordMessageThread struct {
	MessageCount int64 `json:"message_count"`
}

type discordEmbed struct {
	Title       string              `json:"title,omitempty"`
	Description string              `json:"description,omitempty"`
	URL         string              `json:"url,omitempty"`
	Timestamp   string              `json:"timestamp,omitempty"`
	Color       *int                `json:"color,omitempty"`
	Footer      *discordEmbedFooter `json:"footer,omitempty"`
	Image       *discordEmbedMedia  `json:"image,omitempty"`
	Thumbnail   *discordEmbedMedia  `json:"thumbnail,omitempty"`
	Author      *discordEmbedAuthor `json:"author,omitempty"`
	Fields      []discordEmbedField `json:"fields,omitempty"`
}

type discordEmbedFooter struct {
	Text    string `json:"text"`
	IconURL string `json:"icon_url,omitempty"`
}

type discordEmbedMedia struct {
	URL string `json:"url"`
}

type discordEmbedAuthor struct {
	Name    string `json:"name"`
	URL     string `json:"url,omitempty"`
	IconURL string `json:"icon_url,omitempty"`
}

type discordEmbedField struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline,omitempty"`
}

type discordPermissionOverwrite struct {
	ID    string `json:"id"`
	Type  int    `json:"type"`
	Allow string `json:"allow"`
	Deny  string `json:"deny"`
}

type discordChannel struct {
	ID                   string                       `json:"id"`
	GuildID              string                       `json:"guild_id"`
	Name                 string                       `json:"name"`
	Type                 int                          `json:"type"`
	Position             int                          `json:"position"`
	PermissionOverwrites []discordPermissionOverwrite `json:"permission_overwrites"`
}

func (d *DiscordBotAdapter) userGuilds(ctx context.Context, accessToken string) ([]discordGuildSummary, error) {
	var guilds []discordGuildSummary
	if err := d.discordGetJSON(ctx, "/users/@me/guilds?with_counts=true", "Bearer "+accessToken, &guilds); err != nil {
		return nil, fmt.Errorf("listing discord guilds: %w", err)
	}
	return guilds, nil
}

func discordGuildSelectable(guild discordGuildSummary) bool {
	if guild.Owner {
		return true
	}
	permissions, err := strconv.ParseUint(guild.Permissions, 10, 64)
	return err == nil && permissions&(discordPermissionAdministrator|discordPermissionManageGuild) != 0
}

func (d *DiscordBotAdapter) botInstalledInGuild(ctx context.Context, guildID string) (bool, error) {
	var guild discordGuild
	err := d.discordGetJSON(ctx, "/guilds/"+url.PathEscape(guildID)+"?with_counts=true", "Bot "+d.botToken, &guild)
	if err == nil {
		return guild.ID == guildID, nil
	}
	if status := discordHTTPStatus(err); status == http.StatusForbidden || status == http.StatusNotFound {
		return false, nil
	}
	return false, fmt.Errorf("verifying discord bot installation: %w", err)
}

type discordPermissionContext struct {
	guild    discordGuild
	bot      discordGuildMember
	channels []discordChannel
}

func (d *DiscordBotAdapter) permissionContext(ctx context.Context, guildID string) (discordPermissionContext, error) {
	var guild discordGuild
	if err := d.discordGetJSON(ctx, "/guilds/"+url.PathEscape(guildID), "Bot "+d.botToken, &guild); err != nil {
		return discordPermissionContext{}, normalizeDiscordPermissionCheckError(err)
	}
	if guild.ID != guildID {
		return discordPermissionContext{}, &HTTPError{StatusCode: http.StatusForbidden, Code: discordChannelPermissionLostCode}
	}
	var botUser discordUser
	if err := d.discordGetJSON(ctx, "/users/@me", "Bot "+d.botToken, &botUser); err != nil {
		return discordPermissionContext{}, normalizeDiscordPermissionCheckError(err)
	}
	if botUser.ID == "" {
		return discordPermissionContext{}, &HTTPError{StatusCode: http.StatusForbidden, Code: discordChannelPermissionLostCode}
	}
	var member discordGuildMember
	if err := d.discordGetJSON(ctx, "/guilds/"+url.PathEscape(guildID)+"/members/"+url.PathEscape(botUser.ID), "Bot "+d.botToken, &member); err != nil {
		return discordPermissionContext{}, normalizeDiscordPermissionCheckError(err)
	}
	if member.User.ID == "" {
		member.User = botUser
	}
	var channels []discordChannel
	if err := d.discordGetJSON(ctx, "/guilds/"+url.PathEscape(guildID)+"/channels", "Bot "+d.botToken, &channels); err != nil {
		return discordPermissionContext{}, normalizeDiscordPermissionCheckError(err)
	}
	return discordPermissionContext{guild: guild, bot: member, channels: channels}, nil
}

func (c discordPermissionContext) permittedChannels() []discordChannel {
	permitted := make([]discordChannel, 0, len(c.channels))
	for _, channel := range c.channels {
		if channel.GuildID == c.guild.ID && discordPermittedChannel(c.guild, c.bot, channel) {
			permitted = append(permitted, channel)
		}
	}
	sort.SliceStable(permitted, func(i, j int) bool {
		if permitted[i].Position != permitted[j].Position {
			return permitted[i].Position < permitted[j].Position
		}
		return strings.ToLower(permitted[i].Name) < strings.ToLower(permitted[j].Name)
	})
	return permitted
}

func (c discordPermissionContext) channelPermissions(channelID string) (uint64, bool) {
	if c.guild.ID == "" || strings.TrimSpace(channelID) == "" {
		return 0, false
	}
	for _, channel := range c.channels {
		if channel.ID != channelID || channel.GuildID != c.guild.ID || (channel.Type != discordGuildTextChannel && channel.Type != discordGuildAnnouncementChannel) {
			continue
		}
		permissions := discordBasePermissions(c.guild, c.bot)
		if permissions&discordPermissionAdministrator != 0 {
			return ^uint64(0), true
		}
		permissions = discordApplyOverwrites(permissions, c.guild.ID, c.bot, channel.PermissionOverwrites)
		needed := discordPermissionViewChannel | discordPermissionSendMessages
		return permissions, permissions&needed == needed
	}
	return 0, false
}

func (d *DiscordBotAdapter) permittedChannels(ctx context.Context, guildID string) ([]discordChannel, error) {
	permissionContext, err := d.permissionContext(ctx, guildID)
	if err != nil {
		return nil, err
	}
	return permissionContext.permittedChannels(), nil
}

func discordPermittedChannel(guild discordGuild, member discordGuildMember, channel discordChannel) bool {
	if channel.Type != discordGuildTextChannel && channel.Type != discordGuildAnnouncementChannel {
		return false
	}
	permissions := discordBasePermissions(guild, member)
	if permissions&discordPermissionAdministrator != 0 {
		return true
	}
	permissions = discordApplyOverwrites(permissions, guild.ID, member, channel.PermissionOverwrites)
	needed := discordPermissionViewChannel | discordPermissionSendMessages
	return permissions&needed == needed
}

func discordBasePermissions(guild discordGuild, member discordGuildMember) uint64 {
	roleIDs := make(map[string]struct{}, len(member.Roles))
	for _, roleID := range member.Roles {
		roleIDs[roleID] = struct{}{}
	}
	var permissions uint64
	for _, role := range guild.Roles {
		if role.ID != guild.ID {
			if _, ok := roleIDs[role.ID]; !ok {
				continue
			}
		}
		value, _ := strconv.ParseUint(role.Permissions, 10, 64)
		permissions |= value
	}
	return permissions
}

func discordApplyOverwrites(base uint64, everyoneID string, member discordGuildMember, overwrites []discordPermissionOverwrite) uint64 {
	permissions := base
	roleIDs := make(map[string]struct{}, len(member.Roles))
	for _, roleID := range member.Roles {
		roleIDs[roleID] = struct{}{}
	}
	for _, overwrite := range overwrites {
		if overwrite.Type == 0 && overwrite.ID == everyoneID {
			permissions = applyDiscordOverwrite(permissions, overwrite)
			break
		}
	}
	var roleAllow, roleDeny uint64
	for _, overwrite := range overwrites {
		if overwrite.Type != 0 {
			continue
		}
		if _, ok := roleIDs[overwrite.ID]; !ok {
			continue
		}
		allow, _ := strconv.ParseUint(overwrite.Allow, 10, 64)
		deny, _ := strconv.ParseUint(overwrite.Deny, 10, 64)
		roleAllow |= allow
		roleDeny |= deny
	}
	permissions = (permissions &^ roleDeny) | roleAllow
	for _, overwrite := range overwrites {
		if overwrite.Type == 1 && overwrite.ID == member.User.ID {
			permissions = applyDiscordOverwrite(permissions, overwrite)
			break
		}
	}
	return permissions
}

func applyDiscordOverwrite(permissions uint64, overwrite discordPermissionOverwrite) uint64 {
	allow, _ := strconv.ParseUint(overwrite.Allow, 10, 64)
	deny, _ := strconv.ParseUint(overwrite.Deny, 10, 64)
	return (permissions &^ deny) | allow
}

func discordDestinationOptions(channels []discordChannel) []DestinationOption {
	options := make([]DestinationOption, 0, len(channels))
	for _, channel := range channels {
		options = append(options, DestinationOption{Value: channel.ID, Label: "#" + channel.Name})
	}
	return options
}

func discordGuildIDFromCredential(credential string) (string, error) {
	guildID := strings.TrimPrefix(strings.TrimSpace(credential), discordGuildCredentialPrefix)
	if guildID == "" || guildID == strings.TrimSpace(credential) {
		return "", fmt.Errorf("discord guild installation credential is invalid")
	}
	return guildID, nil
}

func (d *DiscordBotAdapter) approvedMentions(ctx context.Context, permissionContext discordPermissionContext, channelPermissions uint64, settings map[string]interface{}) ([]string, []string, error) {
	if strings.TrimSpace(stringSetting(settings, "mention_policy")) != "selected" {
		return nil, nil, nil
	}
	users := uniqueDiscordIDs(stringSliceSetting(settings, "mention_user_ids"))
	roles := uniqueDiscordIDs(stringSliceSetting(settings, "mention_role_ids"))
	if len(users) > 100 || len(roles) > 100 {
		return nil, nil, &HTTPError{StatusCode: http.StatusBadRequest, Code: "discord_mentions_limit"}
	}
	if err := d.validateDiscordMemberMentions(ctx, permissionContext.guild.ID, users); err != nil {
		return nil, nil, err
	}
	if err := validateDiscordRoleMentions(permissionContext.guild, channelPermissions, roles); err != nil {
		return nil, nil, err
	}
	return users, roles, nil
}

func (d *DiscordBotAdapter) validateDiscordMemberMentions(ctx context.Context, guildID string, users []string) error {
	if len(users) == 0 {
		return nil
	}
	approved, err := d.memberSearchApproved(ctx)
	if err != nil {
		return err
	}
	if !approved {
		return &HTTPError{StatusCode: http.StatusForbidden, Code: discordMentionPermissionLostCode}
	}
	for _, userID := range users {
		var member discordGuildMember
		path := "/guilds/" + url.PathEscape(guildID) + "/members/" + url.PathEscape(userID)
		if err := d.discordGetJSON(ctx, path, "Bot "+d.botToken, &member); err != nil {
			return normalizeDiscordMentionPermissionError(err)
		}
		if member.User.ID != userID {
			return &HTTPError{StatusCode: http.StatusForbidden, Code: discordMentionPermissionLostCode}
		}
	}
	return nil
}

func validateDiscordRoleMentions(guild discordGuild, channelPermissions uint64, roles []string) error {
	if len(roles) == 0 {
		return nil
	}
	available := make(map[string]bool, len(guild.Roles))
	for _, role := range guild.Roles {
		if role.ID != guild.ID {
			available[role.ID] = role.Mentionable || channelPermissions&discordPermissionMentionEveryone != 0
		}
	}
	for _, roleID := range roles {
		if !available[roleID] {
			return &HTTPError{StatusCode: http.StatusForbidden, Code: discordMentionPermissionLostCode}
		}
	}
	return nil
}

func (d *DiscordBotAdapter) memberSearchApproved(ctx context.Context) (bool, error) {
	var application discordApplication
	if err := d.discordGetJSON(ctx, "/oauth2/applications/@me", "Bot "+d.botToken, &application); err != nil {
		return false, normalizeDiscordMentionPermissionError(err)
	}
	approvedFlags := discordApplicationGuildMembers | discordApplicationGuildMembersLite
	return application.Flags&approvedFlags != 0, nil
}

func discordAllowedMentions(users, roles []string) map[string]any {
	allowed := map[string]any{"parse": []string{}, "replied_user": false}
	if len(users) > 0 {
		allowed["users"] = users
	}
	if len(roles) > 0 {
		allowed["roles"] = roles
	}
	return allowed
}

func uniqueDiscordIDs(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	unique := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		unique = append(unique, value)
	}
	return unique
}

func discordPublishingContextChannelID(contextValues map[string]string) string {
	raw := strings.TrimSpace(contextValues["value"])
	if raw == "" {
		return ""
	}
	var settings map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &settings); err != nil {
		return ""
	}
	return strings.TrimSpace(stringSetting(settings, "channel_id"))
}

func paginateDiscordOptions(options []DestinationOption, search, cursor string, limit int) PublishingOptionsPage {
	query := strings.ToLower(strings.TrimSpace(search))
	filtered := make([]DestinationOption, 0, len(options))
	for _, option := range options {
		if query == "" || strings.Contains(strings.ToLower(option.Label), query) {
			filtered = append(filtered, option)
		}
	}
	offset, _ := strconv.Atoi(cursor)
	if offset < 0 || offset > len(filtered) {
		offset = 0
	}
	end := min(offset+limit, len(filtered))
	page := PublishingOptionsPage{Options: filtered[offset:end]}
	if end < len(filtered) {
		page.NextCursor = strconv.Itoa(end)
	}
	return page
}

func stringSetting(settings map[string]interface{}, key string) string {
	if settings == nil {
		return ""
	}
	value, _ := settings[key].(string)
	return value
}

func stringSliceSetting(settings map[string]interface{}, key string) []string {
	if settings == nil {
		return nil
	}
	values, ok := settings[key].([]string)
	if ok {
		return values
	}
	if value, ok := settings[key].(string); ok {
		return strings.FieldsFunc(value, func(r rune) bool { return r == ',' || r == '\n' })
	}
	raw, ok := settings[key].([]interface{})
	if !ok {
		return nil
	}
	values = make([]string, 0, len(raw))
	for _, value := range raw {
		if item, ok := value.(string); ok && strings.TrimSpace(item) != "" {
			values = append(values, strings.TrimSpace(item))
		}
	}
	return values
}

func discordEmbeds(settings map[string]interface{}) ([]discordEmbed, error) {
	if settings == nil || settings["embed"] == nil || strings.TrimSpace(fmt.Sprint(settings["embed"])) == "" {
		return nil, nil
	}
	var raw []byte
	var err error
	switch value := settings["embed"].(type) {
	case string:
		raw = []byte(strings.TrimSpace(value))
	default:
		raw, err = json.Marshal(value)
		if err != nil {
			return nil, err
		}
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var embed discordEmbed
	if err := decoder.Decode(&embed); err != nil {
		return nil, err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return nil, fmt.Errorf("embed contains trailing data")
	}
	if err := validateDiscordEmbed(embed); err != nil {
		return nil, err
	}
	return []discordEmbed{embed}, nil
}

func validateDiscordEmbed(embed discordEmbed) error {
	if !discordEmbedHasVisibleContent(embed) {
		return fmt.Errorf("embed must contain visible content")
	}
	if len([]rune(embed.Title)) > 256 || len([]rune(embed.Description)) > 4096 || len(embed.Fields) > 25 {
		return fmt.Errorf("embed exceeds Discord limits")
	}
	if embed.Color != nil && (*embed.Color < 0 || *embed.Color > 0xFFFFFF) {
		return fmt.Errorf("embed color is outside the RGB range")
	}
	if embed.Timestamp != "" {
		if _, err := time.Parse(time.RFC3339, embed.Timestamp); err != nil {
			return fmt.Errorf("embed timestamp must use RFC 3339")
		}
	}
	if err := validateDiscordEmbedURLs(embed); err != nil {
		return err
	}
	return validateDiscordEmbedParts(embed)
}

func discordEmbedHasVisibleContent(embed discordEmbed) bool {
	return strings.TrimSpace(embed.Title) != "" || strings.TrimSpace(embed.Description) != "" || embed.Author != nil || embed.Footer != nil || embed.Image != nil || embed.Thumbnail != nil || len(embed.Fields) > 0
}

func validateDiscordEmbedURLs(embed discordEmbed) error {
	values := []string{embed.URL, discordEmbedMediaURL(embed.Image), discordEmbedMediaURL(embed.Thumbnail), discordEmbedFooterIconURL(embed.Footer), discordEmbedAuthorURL(embed.Author), discordEmbedAuthorIconURL(embed.Author)}
	for _, rawURL := range values {
		if rawURL == "" {
			continue
		}
		parsed, err := url.Parse(rawURL)
		if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" || parsed.User != nil {
			return fmt.Errorf("embed URL is invalid")
		}
	}
	return nil
}

func validateDiscordEmbedParts(embed discordEmbed) error {
	if embed.Footer != nil && (strings.TrimSpace(embed.Footer.Text) == "" || len([]rune(embed.Footer.Text)) > 2048) {
		return fmt.Errorf("embed footer is invalid")
	}
	if embed.Author != nil && (strings.TrimSpace(embed.Author.Name) == "" || len([]rune(embed.Author.Name)) > 256) {
		return fmt.Errorf("embed author is invalid")
	}
	totalLength := len([]rune(embed.Title)) + len([]rune(embed.Description))
	if embed.Footer != nil {
		totalLength += len([]rune(embed.Footer.Text))
	}
	if embed.Author != nil {
		totalLength += len([]rune(embed.Author.Name))
	}
	for _, field := range embed.Fields {
		if strings.TrimSpace(field.Name) == "" || strings.TrimSpace(field.Value) == "" || len([]rune(field.Name)) > 256 || len([]rune(field.Value)) > 1024 {
			return fmt.Errorf("embed field is invalid")
		}
		totalLength += len([]rune(field.Name)) + len([]rune(field.Value))
	}
	if totalLength > 6000 {
		return fmt.Errorf("embed exceeds Discord's total character limit")
	}
	return nil
}

func discordEmbedMediaURL(media *discordEmbedMedia) string {
	if media == nil {
		return ""
	}
	return strings.TrimSpace(media.URL)
}

func discordEmbedFooterIconURL(footer *discordEmbedFooter) string {
	if footer == nil {
		return ""
	}
	return strings.TrimSpace(footer.IconURL)
}

func discordEmbedAuthorURL(author *discordEmbedAuthor) string {
	if author == nil {
		return ""
	}
	return strings.TrimSpace(author.URL)
}

func discordEmbedAuthorIconURL(author *discordEmbedAuthor) string {
	if author == nil {
		return ""
	}
	return strings.TrimSpace(author.IconURL)
}

func discordAcceptedMessageResult(guildID, channelID string, message discordMessage) PublishResult {
	attachmentIDs := make([]string, 0, len(message.Attachments))
	for _, attachment := range message.Attachments {
		if attachment.ID != "" {
			attachmentIDs = append(attachmentIDs, attachment.ID)
		}
	}
	return PublishResult{
		ExternalID:        message.ID,
		ExternalURL:       "https://discord.com/channels/" + url.PathEscape(guildID) + "/" + url.PathEscape(channelID) + "/" + url.PathEscape(message.ID),
		SubmissionState:   PublishSubmissionAccepted,
		ProviderState:     "discord_message_published",
		ProviderReference: discordMessageReference(channelID, message.ID, attachmentIDs),
		RetrySafety:       PublishRetryReconcileOnly,
	}
}

func discordMessageReference(channelID, messageID string, attachmentIDs []string) string {
	return strings.Join([]string{"discord", channelID, messageID, strings.Join(attachmentIDs, ",")}, ":")
}

func parseDiscordMessageReference(reference string) (string, string, bool) {
	parts := strings.SplitN(strings.TrimSpace(reference), ":", 4)
	if len(parts) != 4 || parts[0] != "discord" || parts[1] == "" || parts[2] == "" {
		return "", "", false
	}
	return parts[1], parts[2], true
}

func (d *DiscordBotAdapter) discordGetJSON(ctx context.Context, path, authorization string, output any) error {
	headers := map[string]string{headerAuthorization: authorization}
	body, err := DoJSON(ctx, http.MethodGet, discordAPIBase+path, nil, headers)
	if err != nil {
		return err
	}
	if output == nil || len(body) == 0 {
		return nil
	}
	if err := json.Unmarshal(body, output); err != nil {
		return fmt.Errorf("decoding discord response: %w", err)
	}
	return nil
}

func discordAvatarURL(userID, avatar string) string {
	if userID == "" || avatar == "" {
		return ""
	}
	return "https://cdn.discordapp.com/avatars/" + url.PathEscape(userID) + "/" + url.PathEscape(avatar) + ".png"
}

func discordGuildIconURL(guildID, icon string) string {
	if guildID == "" || icon == "" {
		return ""
	}
	return "https://cdn.discordapp.com/icons/" + url.PathEscape(guildID) + "/" + url.PathEscape(icon) + ".png"
}

func discordHTTPStatus(err error) int {
	if providerErr, ok := err.(*HTTPError); ok {
		return providerErr.StatusCode
	}
	return 0
}

func normalizeDiscordPermissionCheckError(err error) error {
	status := discordHTTPStatus(err)
	if status == http.StatusUnauthorized || status == http.StatusForbidden || status == http.StatusNotFound {
		return &HTTPError{StatusCode: http.StatusForbidden, Code: discordChannelPermissionLostCode}
	}
	return err
}

func normalizeDiscordMentionPermissionError(err error) error {
	status := discordHTTPStatus(err)
	if status == http.StatusUnauthorized || status == http.StatusForbidden || status == http.StatusNotFound {
		return &HTTPError{StatusCode: http.StatusForbidden, Code: discordMentionPermissionLostCode}
	}
	return err
}
