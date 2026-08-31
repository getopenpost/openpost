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
)

const (
	discordAPIBase                   = "https://discord.com/api/v10"
	discordOAuthAuthorizeURL         = "https://discord.com/oauth2/authorize"
	discordGuildTextChannel          = 0
	discordGuildAnnouncementChannel  = 5
	discordPermissionAdministrator   = uint64(1 << 3)
	discordPermissionManageGuild     = uint64(1 << 5)
	discordPermissionViewChannel     = uint64(1 << 10)
	discordPermissionSendMessages    = uint64(1 << 11)
	discordInstallPermissions        = discordPermissionViewChannel | discordPermissionSendMessages
	discordGuildCredentialPrefix     = "discord-guild:"
	discordChannelPermissionLostCode = "discord_channel_permission_lost"
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
	if input.Source != "discord_channels" {
		return PublishingOptionsPage{}, nil
	}
	groups, err := d.ListDestinationOptions(ctx, credential, DestinationOptionsInput{})
	if err != nil {
		return PublishingOptionsPage{}, err
	}
	options := groups[input.Source]
	query := strings.ToLower(strings.TrimSpace(input.Search))
	filtered := make([]DestinationOption, 0, len(options))
	for _, option := range options {
		if query == "" || strings.Contains(strings.ToLower(option.Label), query) {
			filtered = append(filtered, option)
		}
	}
	offset, _ := strconv.Atoi(input.Cursor)
	if offset < 0 || offset > len(filtered) {
		offset = 0
	}
	limit := input.Limit
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	end := min(offset+limit, len(filtered))
	page := PublishingOptionsPage{Options: filtered[offset:end]}
	if end < len(filtered) {
		page.NextCursor = strconv.Itoa(end)
	}
	return page, nil
}

func (d *DiscordBotAdapter) ResolveAccountPublishingCapabilities(ctx context.Context, credential string, _ AccountCapabilityInput) (AccountCapabilityResult, error) {
	groups, err := d.ListDestinationOptions(ctx, credential, DestinationOptionsInput{})
	if err != nil {
		return AccountCapabilityResult{}, err
	}
	result := AccountCapabilityResult{
		Revision: "discord-bot-v1", Options: groups,
		Constraints:       map[string]interface{}{"text_limit": 2000, "media_max_count": 10},
		AvailableFeatures: map[string]bool{"channel_id": len(groups["discord_channels"]) > 0},
		State:             map[string]string{"connection_type": ConnectionModeBot},
	}
	if len(groups["discord_channels"]) == 0 {
		result.UnavailableReason = "The bot cannot currently view and send to any text or announcement channel."
	}
	return result, nil
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
	channelID := strings.TrimSpace(stringSetting(req.Settings, "channel_id"))
	if channelID == "" {
		return PublishResult{}, &HTTPError{StatusCode: http.StatusBadRequest, Code: "discord_channel_required"}
	}
	permitted, err := d.channelPermitted(ctx, strings.TrimSpace(guildID), channelID)
	if err != nil {
		return PublishResult{}, err
	}
	if !permitted {
		return PublishResult{}, &HTTPError{StatusCode: http.StatusForbidden, Code: discordChannelPermissionLostCode}
	}

	payload := map[string]any{
		"content":          strings.TrimSpace(req.Content),
		"allowed_mentions": discordAllowedMentions(req.Settings),
	}
	if len(media) > 0 {
		attachments := make([]map[string]any, 0, len(media))
		for index, item := range media {
			attachment := map[string]any{"id": index, "filename": discordFilename(item.Filename, index)}
			if index < len(req.MediaAltTexts) && strings.TrimSpace(req.MediaAltTexts[index]) != "" {
				attachment["description"] = strings.TrimSpace(req.MediaAltTexts[index])
			}
			attachments = append(attachments, attachment)
		}
		payload["attachments"] = attachments
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return PublishResult{}, fmt.Errorf("encoding discord bot message: %w", err)
	}
	prepared := PublishResult{ProviderState: "execute_bot_message", RetrySafety: PublishRetryNever}
	return executePreparedPublishWrite(req, prepared, func() (string, error) {
		endpoint := discordAPIBase + "/channels/" + url.PathEscape(channelID) + "/messages"
		headers := map[string]string{headerAuthorization: "Bot " + d.botToken}
		var response []byte
		var requestErr error
		if len(media) == 0 {
			headers[headerContentType] = contentTypeJSON
			response, requestErr = DoRequest(ctx, http.MethodPost, endpoint, bytes.NewReader(body), headers)
		} else {
			response, requestErr = doDiscordMultipartWithHeaders(ctx, endpoint, body, media, headers)
		}
		if requestErr != nil {
			return "", fmt.Errorf("sending discord bot message: %w", requestErr)
		}
		var message struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(response, &message); err != nil {
			return "", fmt.Errorf("decoding discord bot response: %w", err)
		}
		if message.ID == "" {
			return "", fmt.Errorf("discord bot response did not include a message id")
		}
		return message.ID, nil
	})
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
	Permissions string `json:"permissions"`
}

type discordGuild struct {
	ID                     string        `json:"id"`
	Name                   string        `json:"name"`
	Roles                  []discordRole `json:"roles"`
	ApproximateMemberCount int           `json:"approximate_member_count"`
}

type discordGuildMember struct {
	Roles []string    `json:"roles"`
	User  discordUser `json:"user"`
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

func (d *DiscordBotAdapter) permittedChannels(ctx context.Context, guildID string) ([]discordChannel, error) {
	var guild discordGuild
	if err := d.discordGetJSON(ctx, "/guilds/"+url.PathEscape(guildID), "Bot "+d.botToken, &guild); err != nil {
		return nil, normalizeDiscordPermissionCheckError(err)
	}
	if guild.ID != guildID {
		return nil, &HTTPError{StatusCode: http.StatusForbidden, Code: discordChannelPermissionLostCode}
	}
	var botUser discordUser
	if err := d.discordGetJSON(ctx, "/users/@me", "Bot "+d.botToken, &botUser); err != nil {
		return nil, normalizeDiscordPermissionCheckError(err)
	}
	if botUser.ID == "" {
		return nil, &HTTPError{StatusCode: http.StatusForbidden, Code: discordChannelPermissionLostCode}
	}
	var member discordGuildMember
	if err := d.discordGetJSON(ctx, "/guilds/"+url.PathEscape(guildID)+"/members/"+url.PathEscape(botUser.ID), "Bot "+d.botToken, &member); err != nil {
		return nil, normalizeDiscordPermissionCheckError(err)
	}
	if member.User.ID == "" {
		member.User = botUser
	}
	var channels []discordChannel
	if err := d.discordGetJSON(ctx, "/guilds/"+url.PathEscape(guildID)+"/channels", "Bot "+d.botToken, &channels); err != nil {
		return nil, normalizeDiscordPermissionCheckError(err)
	}
	permitted := channels[:0]
	for _, channel := range channels {
		if channel.GuildID == guildID && discordPermittedChannel(guild, member, channel) {
			permitted = append(permitted, channel)
		}
	}
	sort.SliceStable(permitted, func(i, j int) bool {
		if permitted[i].Position != permitted[j].Position {
			return permitted[i].Position < permitted[j].Position
		}
		return strings.ToLower(permitted[i].Name) < strings.ToLower(permitted[j].Name)
	})
	return permitted, nil
}

func (d *DiscordBotAdapter) channelPermitted(ctx context.Context, guildID, channelID string) (bool, error) {
	if guildID == "" || channelID == "" {
		return false, nil
	}
	channels, err := d.permittedChannels(ctx, guildID)
	if err != nil {
		return false, err
	}
	for _, channel := range channels {
		if channel.ID == channelID {
			return true, nil
		}
	}
	return false, nil
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

func discordAllowedMentions(settings map[string]interface{}) map[string]any {
	allowed := map[string]any{"parse": []string{}}
	if strings.TrimSpace(stringSetting(settings, "mention_policy")) != "selected" {
		return allowed
	}
	if users := stringSliceSetting(settings, "mention_user_ids"); len(users) > 0 {
		allowed["users"] = users
	}
	if roles := stringSliceSetting(settings, "mention_role_ids"); len(roles) > 0 {
		allowed["roles"] = roles
	}
	return allowed
}

func stringSetting(settings map[string]interface{}, key string) string {
	if settings == nil {
		return ""
	}
	value, _ := settings[key].(string)
	return value
}

func stringSliceSetting(settings map[string]interface{}, key string) []string {
	values, ok := settings[key].([]string)
	if ok {
		return values
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
