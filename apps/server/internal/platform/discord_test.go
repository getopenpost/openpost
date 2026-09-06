package platform

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestValidateDiscordWebhookURL(t *testing.T) {
	valid := []string{
		"https://discord.com/api/webhooks/123/token",
		"https://discord.com/api/v10/webhooks/123/token.with-parts",
		"https://canary.discord.com/api/webhooks/123/token",
	}
	for _, raw := range valid {
		if _, _, err := validateDiscordWebhookURL(raw); err != nil {
			t.Errorf("expected %q to be valid: %v", raw, err)
		}
	}
	invalid := []string{
		"http://discord.com/api/webhooks/123/token",
		"https://discord.com.evil.example/api/webhooks/123/token",
		"https://discord.com:8443/api/webhooks/123/token",
		"https://user@discord.com/api/webhooks/123/token",
		"https://discord.com/api/webhooks/123/token/messages/456",
		"https://discord.com/api/webhooks/123/token#fragment",
	}
	for _, raw := range invalid {
		if _, _, err := validateDiscordWebhookURL(raw); err == nil {
			t.Errorf("expected %q to be rejected", raw)
		}
	}
}

func TestDiscordPublishWithMediaStreamsMultipart(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodPost || req.URL.Host != "discord.com" || req.URL.Query().Get("wait") != "true" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
		}
		reader, err := req.MultipartReader()
		if err != nil {
			t.Fatalf("reading multipart request: %v", err)
		}
		var payload map[string]any
		files := map[string]string{}
		for {
			part, err := reader.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Fatalf("reading multipart part: %v", err)
			}
			data, _ := io.ReadAll(part)
			if part.FormName() == "payload_json" {
				if err := json.Unmarshal(data, &payload); err != nil {
					t.Fatalf("decoding payload_json: %v", err)
				}
			} else {
				files[part.FileName()] = string(data)
			}
		}
		if payload["content"] != "Launch update" {
			t.Fatalf("unexpected payload %#v", payload)
		}
		allowed := payload["allowed_mentions"].(map[string]any)
		if len(allowed["parse"].([]any)) != 0 {
			t.Fatalf("expected mentions to be disabled: %#v", allowed)
		}
		attachments := payload["attachments"].([]any)
		first := attachments[0].(map[string]any)
		if first["description"] != "Dashboard screenshot" {
			t.Fatalf("expected attachment description: %#v", first)
		}
		if files["dashboard.png"] != "png-data" || files["notes.txt"] != "notes-data" {
			t.Fatalf("unexpected files %#v", files)
		}
		return jsonResponse(req, `{"id":"message-123"}`), nil
	})}

	adapter := NewDiscordAdapter()
	messageID, err := adapter.PublishWithMedia(
		context.Background(),
		"https://discord.com/api/webhooks/123/token",
		"",
		&PublishRequest{
			Content:       " Launch update ",
			MediaAltTexts: []string{"Dashboard screenshot", ""},
		},
		[]UploadMediaRequest{
			{Filename: "../dashboard.png", Reader: strings.NewReader("png-data")},
			{Filename: "notes.txt", Reader: strings.NewReader("notes-data")},
		},
	)
	if err != nil {
		t.Fatalf("PublishWithMedia returned error: %v", err)
	}
	if messageID.ExternalID != "message-123" {
		t.Fatalf("unexpected message ID %q", messageID)
	}
}

func TestDiscordWebhookVerificationDoesNotFollowRedirects(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()
	calls := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{
			StatusCode: http.StatusFound,
			Header:     http.Header{"Location": {"https://example.com/collect"}},
			Body:       io.NopCloser(strings.NewReader("")),
			Request:    req,
		}, nil
	})}

	_, err := NewDiscordAdapter().GetProfile(t.Context(), "https://discord.com/api/webhooks/123/secret")
	if err == nil {
		t.Fatal("expected redirect response to fail verification")
	}
	if calls != 1 {
		t.Fatalf("expected one Discord request, got %d", calls)
	}
}

func TestDiscordBotAuthURLUsesInstallAndGuildSelectionScopes(t *testing.T) {
	adapter := NewDiscordBotAdapter("app-123", "secret", "bot-secret", "https://openpost.test/api/v1/accounts/discord/callback")
	raw, _ := adapter.GenerateAuthURL("state-token")
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Host != "discord.com" || parsed.Path != "/oauth2/authorize" {
		t.Fatalf("unexpected authorization URL %s", raw)
	}
	query := parsed.Query()
	if query.Get("state") != "state-token" || query.Get("scope") != "identify guilds bot" {
		t.Fatalf("unexpected OAuth query %v", query)
	}
	if query.Get("permissions") != "3072" {
		t.Fatalf("unexpected bot permissions %q", query.Get("permissions"))
	}
}

func TestDiscordBotExchangesAuthorizationCodeWithoutBotToken(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodPost || req.URL.Path != "/api/v10/oauth2/token" {
			t.Fatalf("unexpected exchange request %s %s", req.Method, req.URL.String())
		}
		if req.Header.Get("Authorization") != "Basic YXBwLTEyMzpjbGllbnQtc2VjcmV0" {
			t.Fatalf("unexpected client authorization %q", req.Header.Get("Authorization"))
		}
		body, _ := io.ReadAll(req.Body)
		values, err := url.ParseQuery(string(body))
		if err != nil || values.Get("code") != "provider-code" || values.Get("grant_type") != "authorization_code" {
			t.Fatalf("unexpected exchange body %q", body)
		}
		return jsonResponse(req, `{"access_token":"user-oauth-token","refresh_token":"user-refresh","expires_in":3600,"token_type":"Bearer","scope":"identify guilds"}`), nil
	})}

	result, err := NewDiscordBotAdapter("app-123", "client-secret", "global-bot-token", "https://openpost.test/callback").ExchangeCode(t.Context(), "provider-code", nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.AccessToken != "user-oauth-token" || result.Extra["connection_type"] != "bot" {
		t.Fatalf("unexpected token result %#v", result)
	}
	encoded, _ := json.Marshal(result)
	if strings.Contains(string(encoded), "global-bot-token") {
		t.Fatalf("global bot token leaked into OAuth result: %s", encoded)
	}
}

func TestDiscordBotGuildSelectionRechecksManageabilityAndInstallation(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/api/v10/users/@me/guilds":
			if req.Header.Get("Authorization") != "Bearer user-token" || req.URL.Query().Get("with_counts") != "true" {
				t.Fatalf("unexpected guild authorization: %s", req.Header.Get("Authorization"))
			}
			return jsonResponse(req, `[
				{"id":"100","name":"Owned","owner":true,"permissions":"0","approximate_member_count":12},
				{"id":"200","name":"Foreign","owner":false,"permissions":"0"},
				{"id":"300","name":"Not installed","owner":true,"permissions":"0"},
				{"id":"400","name":"Managed","owner":false,"permissions":"32"}
			]`), nil
		case "/api/v10/guilds/100":
			return jsonResponse(req, `{"id":"100","name":"Owned"}`), nil
		case "/api/v10/guilds/400":
			return jsonResponse(req, `{"id":"400","name":"Managed"}`), nil
		case "/api/v10/guilds/300":
			return &http.Response{StatusCode: http.StatusNotFound, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"code":10004}`)), Request: req}, nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, errors.New("unexpected request")
		}
	})}

	adapter := NewDiscordBotAdapter("app", "secret", "global-bot-token", "https://openpost.test/callback")
	options, err := adapter.ListAccountSelections(t.Context(), &TokenResult{AccessToken: "user-token"})
	if err != nil {
		t.Fatal(err)
	}
	if len(options) != 2 || options[0].ID != "400" || options[1].ID != "100" || options[1].Extra["members"] != "12" {
		t.Fatalf("unexpected owned or managed guild options %#v", options)
	}
	selected, err := adapter.SelectAccount(t.Context(), &TokenResult{AccessToken: "user-token"}, "100")
	if err != nil {
		t.Fatal(err)
	}
	if selected.AccountID != "100" || selected.Token.AccessToken != "discord-guild:100" || selected.CapabilityState["connection_type"] != "bot" {
		t.Fatalf("unexpected selected guild %#v", selected)
	}
}

func TestDiscordBotListsOnlyPermittedTextAndAnnouncementChannels(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Header.Get("Authorization") != "Bot global-bot-token" {
			t.Fatalf("bot authorization missing from %s", req.URL.Path)
		}
		switch req.URL.Path {
		case "/api/v10/guilds/100":
			return jsonResponse(req, `{"id":"100","roles":[{"id":"100","permissions":"3072"},{"id":"role-1","permissions":"0"}]}`), nil
		case "/api/v10/users/@me":
			return jsonResponse(req, `{"id":"bot-1","username":"OpenPost"}`), nil
		case "/api/v10/guilds/100/members/bot-1":
			return jsonResponse(req, `{"roles":["role-1"],"user":{"id":"bot-1"}}`), nil
		case "/api/v10/guilds/100/channels":
			return jsonResponse(req, `[
				{"id":"text","guild_id":"100","name":"general","type":0,"position":2},
				{"id":"announcement","guild_id":"100","name":"announcements","type":5,"position":1},
				{"id":"voice","guild_id":"100","name":"voice","type":2,"position":3},
				{"id":"foreign","guild_id":"999","name":"foreign","type":0,"position":4},
				{"id":"denied","guild_id":"100","name":"private","type":0,"position":5,"permission_overwrites":[{"id":"100","type":0,"allow":"0","deny":"2048"}]}
			]`), nil
		default:
			t.Fatalf("unexpected request %s", req.URL.String())
			return nil, errors.New("unexpected request")
		}
	})}

	adapter := NewDiscordBotAdapter("app", "secret", "global-bot-token", "https://openpost.test/callback")
	groups, err := adapter.ListDestinationOptions(t.Context(), "discord-guild:100", DestinationOptionsInput{})
	if err != nil {
		t.Fatal(err)
	}
	got := groups["discord_channels"]
	if len(got) != 2 || got[0].Value != "announcement" || got[1].Value != "text" {
		t.Fatalf("unexpected permitted channels %#v", got)
	}
}

func TestDiscordBotPublishesToSelectedPermittedChannel(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	permissionChecks := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Header.Get("Authorization") != "Bot global-bot-token" {
			t.Fatalf("bot authorization missing from %s", req.URL.Path)
		}
		switch req.URL.Path {
		case "/api/v10/guilds/100":
			permissionChecks++
			return jsonResponse(req, `{"id":"100","roles":[{"id":"100","permissions":"3072"}]}`), nil
		case "/api/v10/users/@me":
			return jsonResponse(req, `{"id":"bot-1"}`), nil
		case "/api/v10/guilds/100/members/bot-1":
			return jsonResponse(req, `{"user":{"id":"bot-1"}}`), nil
		case "/api/v10/guilds/100/channels":
			return jsonResponse(req, `[{"id":"channel-1","guild_id":"100","name":"general","type":0}]`), nil
		case "/api/v10/channels/channel-1/messages":
			if req.Method != http.MethodPost || permissionChecks != 1 {
				t.Fatalf("message mutation occurred before the permission check")
			}
			var payload map[string]any
			if err := json.NewDecoder(req.Body).Decode(&payload); err != nil || payload["content"] != "Ship it" {
				t.Fatalf("unexpected message payload %#v: %v", payload, err)
			}
			allowed := payload["allowed_mentions"].(map[string]any)
			if len(allowed) != 2 || len(allowed["parse"].([]any)) != 0 || allowed["replied_user"] != false {
				t.Fatalf("implicit mentions were not denied: %#v", allowed)
			}
			return jsonResponse(req, `{"id":"message-1","channel_id":"channel-1"}`), nil
		default:
			t.Fatalf("unexpected request %s", req.URL.String())
			return nil, errors.New("unexpected request")
		}
	})}

	writeStarted := false
	req := &PublishRequest{Content: "Ship it", Settings: map[string]interface{}{"channel_id": "channel-1"}}
	req.SetWriteFence(func(prepared PublishResult) error {
		writeStarted = prepared.ProviderState == "execute_bot_message"
		return nil
	}, nil)
	result, err := NewDiscordBotAdapter("app", "secret", "global-bot-token", "https://openpost.test/callback").Publish(t.Context(), "ignored", "100", req)
	if err != nil {
		t.Fatal(err)
	}
	if !writeStarted || result.ExternalID != "message-1" || result.RetrySafety != PublishRetryReconcileOnly || result.ProviderReference != "discord:channel-1:message-1:" {
		t.Fatalf("unexpected publish result %#v (write started: %v)", result, writeStarted)
	}
}

func TestDiscordBotPermissionLossFailsBeforeMessageMutation(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	postCalls := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method == http.MethodPost {
			postCalls++
			t.Fatalf("message mutation must not run after permission loss")
		}
		switch req.URL.Path {
		case "/api/v10/guilds/100":
			return jsonResponse(req, `{"id":"100","roles":[{"id":"100","permissions":"3072"}]}`), nil
		case "/api/v10/users/@me":
			return jsonResponse(req, `{"id":"bot-1"}`), nil
		case "/api/v10/guilds/100/members/bot-1":
			return jsonResponse(req, `{"user":{"id":"bot-1"}}`), nil
		case "/api/v10/guilds/100/channels":
			return jsonResponse(req, `[{"id":"channel-1","guild_id":"100","name":"private","type":0,"permission_overwrites":[{"id":"100","type":0,"allow":"0","deny":"2048"}]}]`), nil
		default:
			t.Fatalf("unexpected request %s", req.URL.String())
			return nil, errors.New("unexpected request")
		}
	})}

	writeStarted := false
	req := &PublishRequest{Content: "Do not send", Settings: map[string]interface{}{"channel_id": "channel-1"}}
	req.SetWriteFence(func(PublishResult) error { writeStarted = true; return nil }, nil)
	_, err := NewDiscordBotAdapter("app", "secret", "global-bot-token", "https://openpost.test/callback").Publish(t.Context(), "ignored", "100", req)
	var providerErr *HTTPError
	if !errors.As(err, &providerErr) || providerErr.StatusCode != http.StatusForbidden || providerErr.Code != discordChannelPermissionLostCode {
		t.Fatalf("expected safe permission error, got %v", err)
	}
	if writeStarted || postCalls != 0 {
		t.Fatalf("mutation boundary crossed after permission loss: write=%v posts=%d", writeStarted, postCalls)
	}
}

func TestDiscordBotRolePermissionLossRejectsExplicitIdentityBeforeWrite(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	postCalls := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method == http.MethodPost {
			postCalls++
			t.Fatal("message must not be sent after role mention permission loss")
		}
		switch req.URL.Path {
		case "/api/v10/guilds/100":
			return jsonResponse(req, `{"id":"100","roles":[{"id":"100","permissions":"3072"},{"id":"role-1","name":"Launch crew","permissions":"0","mentionable":false}]}`), nil
		case "/api/v10/users/@me":
			return jsonResponse(req, `{"id":"bot-1"}`), nil
		case "/api/v10/guilds/100/members/bot-1":
			return jsonResponse(req, `{"user":{"id":"bot-1"}}`), nil
		case "/api/v10/guilds/100/channels":
			return jsonResponse(req, `[{"id":"channel-1","guild_id":"100","name":"launches","type":0}]`), nil
		default:
			t.Fatalf("unexpected request %s", req.URL.String())
			return nil, errors.New("unexpected request")
		}
	})}

	writeStarted := false
	req := &PublishRequest{Content: "Do not mention", Settings: map[string]interface{}{
		"channel_id": "channel-1", "mention_policy": "selected", "mention_role_ids": []string{"role-1"},
	}}
	req.SetWriteFence(func(PublishResult) error { writeStarted = true; return nil }, nil)
	_, err := NewDiscordBotAdapter("app", "secret", "global-bot-token", "https://openpost.test/callback").Publish(t.Context(), "ignored", "100", req)
	var providerErr *HTTPError
	if !errors.As(err, &providerErr) || providerErr.Code != discordMentionPermissionLostCode {
		t.Fatalf("expected mention permission error, got %v", err)
	}
	if writeStarted || postCalls != 0 {
		t.Fatalf("write fence crossed after mention permission loss: write=%v posts=%d", writeStarted, postCalls)
	}
}

func TestDiscordBotAmbiguousSendIsMarkedNeverReplay(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	postCalls := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/api/v10/guilds/100":
			return jsonResponse(req, `{"id":"100","roles":[{"id":"100","permissions":"3072"}]}`), nil
		case "/api/v10/users/@me":
			return jsonResponse(req, `{"id":"bot-1"}`), nil
		case "/api/v10/guilds/100/members/bot-1":
			return jsonResponse(req, `{"user":{"id":"bot-1"}}`), nil
		case "/api/v10/guilds/100/channels":
			return jsonResponse(req, `[{"id":"channel-1","guild_id":"100","name":"launches","type":0}]`), nil
		case "/api/v10/channels/channel-1/messages":
			postCalls++
			return nil, io.ErrUnexpectedEOF
		default:
			t.Fatalf("unexpected request %s", req.URL.String())
			return nil, errors.New("unexpected request")
		}
	})}

	var prepared PublishResult
	checkpointed := false
	req := &PublishRequest{Content: "Possibly sent", Settings: map[string]interface{}{"channel_id": "channel-1"}}
	req.SetWriteFence(func(result PublishResult) error { prepared = result; return nil }, func(PublishResult) error { checkpointed = true; return nil })
	result, err := NewDiscordBotAdapter("app", "secret", "global-bot-token", "https://openpost.test/callback").Publish(t.Context(), "ignored", "100", req)
	if err == nil || prepared.RetrySafety != PublishRetryNever || result.RetrySafety != PublishRetryNever || result.SubmissionState != PublishSubmissionUnknown {
		t.Fatalf("ambiguous send was not fenced against replay: result=%#v prepared=%#v err=%v", result, prepared, err)
	}
	if postCalls != 1 || checkpointed {
		t.Fatalf("unexpected ambiguous send calls=%d checkpointed=%v", postCalls, checkpointed)
	}
}

func TestDiscordWebhookDeleteRegression(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodDelete || req.URL.String() != "https://discord.com/api/webhooks/123/token/messages/message-1" {
			t.Fatalf("unexpected webhook delete %s %s", req.Method, req.URL.String())
		}
		return &http.Response{StatusCode: http.StatusNoContent, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("")), Request: req}, nil
	})}

	if err := NewDiscordAdapter().DeletePublished(t.Context(), "https://discord.com/api/webhooks/123/token", "message-1"); err != nil {
		t.Fatal(err)
	}
}
