package telegram

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type publishOutcome struct {
	messages []Message
	err      error
}

type fakePublishingBotAPI struct {
	chat       Chat
	member     ChatMember
	requests   []OutboundRequest
	outcomes   []publishOutcome
	getMeCalls int
	getChat    int
	getMember  int
}

func (api *fakePublishingBotAPI) GetMe(context.Context) (User, error) {
	api.getMeCalls++
	return User{ID: 99, Username: "openpost_bot"}, nil
}

func (api *fakePublishingBotAPI) GetChat(context.Context, string) (Chat, error) {
	api.getChat++
	return api.chat, nil
}

func (api *fakePublishingBotAPI) GetChatMember(context.Context, string, int64) (ChatMember, error) {
	api.getMember++
	return api.member, nil
}

func (*fakePublishingBotAPI) SetWebhook(context.Context, SetWebhookRequest) error { return nil }

func (api *fakePublishingBotAPI) Send(_ context.Context, request OutboundRequest) ([]Message, error) {
	api.requests = append(api.requests, request)
	if len(api.outcomes) == 0 {
		return nil, errors.New("unexpected Telegram send")
	}
	outcome := api.outcomes[0]
	api.outcomes = api.outcomes[1:]
	return outcome.messages, outcome.err
}

func newPublishService(t *testing.T, db *bun.DB, api *fakePublishingBotAPI) *Service {
	t.Helper()
	if db == nil {
		var err error
		db, err = database.InitDBWithDriver("sqlite", "file:"+strings.ReplaceAll(t.Name(), "/", "-")+"?mode=memory&cache=shared")
		require.NoError(t, err)
		t.Cleanup(func() { require.NoError(t, db.Close()) })
		for _, model := range []any{
			(*models.SocialAccount)(nil), (*models.Rendition)(nil),
			(*models.TelegramConnection)(nil), (*models.TelegramPublishReceipt)(nil),
		} {
			_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
			require.NoError(t, err)
		}
		now := time.Date(2026, time.September, 3, 10, 0, 0, 0, time.UTC)
		_, err = db.NewInsert().Model(&models.SocialAccount{
			ID: "account-1", WorkspaceID: "workspace-1", Slug: "telegram-launches",
			Platform: "telegram", AccountID: "-1001", AccessTokenEnc: []byte{0}, IsActive: true, CreatedAt: now,
		}).Exec(t.Context())
		require.NoError(t, err)
		_, err = db.NewInsert().Model(&models.Rendition{
			ID: "rendition-1", PublicationID: "publication-1", SocialAccountID: "account-1",
			TargetKey: "telegram", Platform: "telegram", Profile: models.ContentProfileImagePost,
			Status: models.RenditionStatusPublishing, CreatedAt: now, UpdatedAt: now,
		}).Exec(t.Context())
		require.NoError(t, err)
		_, err = db.NewInsert().Model(&models.TelegramConnection{
			SocialAccountID: "account-1", WorkspaceID: "workspace-1", ChatID: "-1001", ChatType: "channel",
			InstalledAt: now.Add(-time.Hour), CoverageStartedAt: now.Add(-time.Hour),
			CoverageKind: CoverageSinceInstallation, PermissionsVerifiedAt: now.Add(-time.Minute), CreatedAt: now,
		}).Exec(t.Context())
		require.NoError(t, err)
	}
	service := NewService(db, api, "openpost_bot", "webhook-secret")
	service.SetNowForTest(func() time.Time { return time.Date(2026, time.September, 3, 10, 5, 0, 0, time.UTC) })
	return service
}

func publishRequest(content string) *platform.PublishRequest {
	req := &platform.PublishRequest{
		Content: content, RenditionID: "rendition-1", OperationID: "authorization:one:rendition-1:publish",
		Settings: map[string]interface{}{"chat_id": "-1001", "disable_notification": true, "protect_content": true},
	}
	req.SetWriteFence(func(platform.PublishResult) error { return nil }, func(platform.PublishResult) error { return nil })
	return req
}

func mediaInput(mime string, size int64) platform.UploadMediaRequest {
	return platform.UploadMediaRequest{MimeType: mime, Filename: "asset.bin", Size: size, Reader: bytes.NewBufferString("bytes")}
}

func TestHTTPBotAPISendsMediaGroupAndReturnsEveryMessageID(t *testing.T) {
	const token = "123456:private-bot-token"
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		require.Equal(t, "/bot"+token+"/sendMediaGroup", request.URL.Path)
		require.NoError(t, request.ParseMultipartForm(1<<20))
		require.Equal(t, "-1001", request.FormValue("chat_id"))
		require.Equal(t, "true", request.FormValue("protect_content"))
		require.Contains(t, request.FormValue("media"), `"caption":"launch"`)
		require.Len(t, request.MultipartForm.File["media_0"], 1)
		require.Len(t, request.MultipartForm.File["media_1"], 1)
		return &http.Response{
			StatusCode: http.StatusOK, Header: make(http.Header),
			Body: io.NopCloser(strings.NewReader(`{"ok":true,"result":[{"message_id":41},{"message_id":42}]}`)),
		}, nil
	})}
	api := NewHTTPBotAPIForTest(token, "https://api.telegram.test", client)
	messages, err := api.Send(t.Context(), OutboundRequest{
		Kind: "media_group", ChatID: "-1001", Caption: "launch", ProtectContent: true,
		Media: []OutboundMedia{
			{Type: "photo", Filename: "launch.jpg", Reader: bytes.NewBufferString("photo")},
			{Type: "video", Filename: "demo.mp4", Reader: bytes.NewBufferString("video")},
		},
	})
	require.NoError(t, err)
	require.Equal(t, []Message{{MessageID: 41}, {MessageID: 42}}, messages)
}

func TestTelegramPublishPlansSupportedShapesAndCurrentLimits(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		content   string
		media     []platform.UploadMediaRequest
		wantKinds []string
		wantErr   error
	}{
		{name: "plain text", content: "launch", wantKinds: []string{"message"}},
		{name: "photo", content: "caption", media: []platform.UploadMediaRequest{mediaInput("image/jpeg", telegramPhotoSizeLimit)}, wantKinds: []string{"photo"}},
		{name: "video", content: "caption", media: []platform.UploadMediaRequest{mediaInput("video/mp4", telegramFileSizeLimit)}, wantKinds: []string{"video"}},
		{name: "document", content: "caption", media: []platform.UploadMediaRequest{mediaInput("application/pdf", telegramFileSizeLimit)}, wantKinds: []string{"document"}},
		{name: "photo video group", content: "caption", media: []platform.UploadMediaRequest{mediaInput("image/png", 1), mediaInput("video/mp4", 1)}, wantKinds: []string{"media_group"}},
		{name: "document group", content: "caption", media: []platform.UploadMediaRequest{mediaInput("application/pdf", 1), mediaInput("application/pdf", 1)}, wantKinds: []string{"media_group"}},
		{name: "mixed document group rejected", content: "caption", media: []platform.UploadMediaRequest{mediaInput("application/pdf", 1), mediaInput("image/jpeg", 1)}, wantErr: ErrInvalidPublish},
		{name: "photo over limit", content: "caption", media: []platform.UploadMediaRequest{mediaInput("image/jpeg", telegramPhotoSizeLimit+1)}, wantErr: ErrInvalidPublish},
		{name: "video over limit", content: "caption", media: []platform.UploadMediaRequest{mediaInput("video/mp4", telegramFileSizeLimit+1)}, wantErr: ErrInvalidPublish},
		{name: "plain text over limit", content: strings.Repeat("a", telegramTextLimit+1), wantErr: ErrInvalidPublish},
		{name: "too many media", content: "caption", media: repeatMedia(telegramMediaGroupLimit + 1), wantErr: ErrInvalidPublish},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			steps, err := telegramPublishPlan("-1001", publishRequest(test.content), test.media)
			if test.wantErr != nil {
				require.ErrorIs(t, err, test.wantErr)
				return
			}
			require.NoError(t, err)
			kinds := make([]string, len(steps))
			for index := range steps {
				kinds[index] = steps[index].request.Kind
			}
			require.Equal(t, test.wantKinds, kinds)
		})
	}
}

func TestTelegramCaptionOverflowPreservesOrderAndEveryMessageID(t *testing.T) {
	api := &fakePublishingBotAPI{
		chat: Chat{ID: -1001, Type: "channel"}, member: ChatMember{Status: "administrator", CanPostMessages: true},
		outcomes: []publishOutcome{
			{messages: []Message{{MessageID: 101}, {MessageID: 102}}},
			{messages: []Message{{MessageID: 103}}},
			{messages: []Message{{MessageID: 104}}},
		},
	}
	service := newPublishService(t, nil, api)
	content := strings.Repeat("a", telegramCaptionLimit) + strings.Repeat("b", telegramTextLimit) + "tail"
	result, err := service.PublishWithMedia(t.Context(), "must-not-be-used", "-1001", publishRequest(content), []platform.UploadMediaRequest{
		mediaInput("image/jpeg", 10), mediaInput("video/mp4", 10),
	})
	require.NoError(t, err)
	require.Equal(t, "101", result.ExternalID)
	require.Len(t, api.requests, 3)
	require.Equal(t, "media_group", api.requests[0].Kind)
	require.Equal(t, strings.Repeat("a", telegramCaptionLimit), api.requests[0].Caption)
	require.Equal(t, strings.Repeat("b", telegramTextLimit), api.requests[1].Text)
	require.Equal(t, "tail", api.requests[2].Text)
	for _, request := range api.requests {
		require.True(t, request.DisableNotification)
		require.True(t, request.ProtectContent)
	}

	var receipts []models.TelegramPublishReceipt
	require.NoError(t, service.db.NewSelect().Model(&receipts).Order("message_index ASC").Scan(t.Context()))
	require.Equal(t, []string{"101", "102", "103", "104"}, receiptMessageIDs(receipts))
	for index, receipt := range receipts {
		require.Equal(t, index, receipt.MessageIndex)
		require.Equal(t, telegramReceiptAccepted, receipt.Status)
		require.Equal(t, "rendition-1", receipt.RenditionID)
	}
	require.Equal(t, 1, api.getMeCalls, "permissions are rechecked for the publish")
}

func TestTelegramPartialFailureResumesAfterRestartWithoutRepeatingAcceptedMessages(t *testing.T) {
	api := &fakePublishingBotAPI{
		chat: Chat{ID: -1001, Type: "channel"}, member: ChatMember{Status: "administrator", CanPostMessages: true},
		outcomes: []publishOutcome{
			{messages: []Message{{MessageID: 201}, {MessageID: 202}}},
			{err: &platform.HTTPError{StatusCode: http.StatusTooManyRequests, Code: "429"}},
		},
	}
	service := newPublishService(t, nil, api)
	content := strings.Repeat("a", telegramCaptionLimit) + "follow-up"
	media := []platform.UploadMediaRequest{mediaInput("image/jpeg", 10), mediaInput("image/png", 10)}
	_, err := service.PublishWithMedia(t.Context(), "", "-1001", publishRequest(content), media)
	require.Error(t, err)
	require.Len(t, api.requests, 2)

	var firstRows []models.TelegramPublishReceipt
	require.NoError(t, service.db.NewSelect().Model(&firstRows).Order("message_index ASC").Scan(t.Context()))
	require.Equal(t, []string{"201", "202", ""}, receiptMessageIDs(firstRows))
	require.Equal(t, telegramReceiptFailed, firstRows[2].Status)

	restartedAPI := &fakePublishingBotAPI{
		chat: api.chat, member: api.member,
		outcomes: []publishOutcome{{messages: []Message{{MessageID: 203}}}},
	}
	restarted := newPublishService(t, service.db, restartedAPI)
	result, err := restarted.PublishWithMedia(t.Context(), "", "-1001", publishRequest(content), []platform.UploadMediaRequest{
		mediaInput("image/jpeg", 10), mediaInput("image/png", 10),
	})
	require.NoError(t, err)
	require.Equal(t, "201", result.ExternalID)
	require.Len(t, restartedAPI.requests, 1)
	require.Equal(t, "message", restartedAPI.requests[0].Kind)

	var finalRows []models.TelegramPublishReceipt
	require.NoError(t, service.db.NewSelect().Model(&finalRows).Order("message_index ASC").Scan(t.Context()))
	require.Equal(t, []string{"201", "202", "203"}, receiptMessageIDs(finalRows))
}

func TestTelegramAmbiguousFollowUpIsFencedAcrossRestart(t *testing.T) {
	api := &fakePublishingBotAPI{
		chat: Chat{ID: -1001, Type: "channel"}, member: ChatMember{Status: "administrator", CanPostMessages: true},
		outcomes: []publishOutcome{
			{messages: []Message{{MessageID: 301}, {MessageID: 302}}},
			{err: ErrProviderUnavailable},
		},
	}
	service := newPublishService(t, nil, api)
	content := strings.Repeat("a", telegramCaptionLimit) + "follow-up"
	_, err := service.PublishWithMedia(t.Context(), "", "-1001", publishRequest(content), []platform.UploadMediaRequest{
		mediaInput("image/jpeg", 10), mediaInput("image/png", 10),
	})
	require.ErrorIs(t, err, ErrProviderUnavailable)

	restartedAPI := &fakePublishingBotAPI{chat: api.chat, member: api.member, outcomes: []publishOutcome{{messages: []Message{{MessageID: 999}}}}}
	restarted := newPublishService(t, service.db, restartedAPI)
	_, err = restarted.PublishWithMedia(t.Context(), "", "-1001", publishRequest(content), []platform.UploadMediaRequest{
		mediaInput("image/jpeg", 10), mediaInput("image/png", 10),
	})
	require.ErrorIs(t, err, ErrPublishAmbiguous)
	require.Empty(t, restartedAPI.requests, "an ambiguous Telegram write must never be replayed")
}

func TestTelegramPublishRechecksDestinationIdentityAndPermissions(t *testing.T) {
	tests := []struct {
		name    string
		chat    Chat
		member  ChatMember
		account string
		wantErr error
	}{
		{name: "channel permission retained", chat: Chat{ID: -1001, Type: "channel"}, member: ChatMember{Status: "administrator", CanPostMessages: true}, account: "-1001"},
		{name: "permission lost", chat: Chat{ID: -1001, Type: "channel"}, member: ChatMember{Status: "administrator"}, account: "-1001", wantErr: ErrInsufficientPermissions},
		{name: "identity changed", chat: Chat{ID: -2002, Type: "channel"}, member: ChatMember{Status: "administrator", CanPostMessages: true}, account: "-1001", wantErr: ErrChatIdentityMismatch},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			api := &fakePublishingBotAPI{chat: test.chat, member: test.member, outcomes: []publishOutcome{{messages: []Message{{MessageID: 1}}}}}
			service := newPublishService(t, nil, api)
			_, err := service.Publish(t.Context(), "global-token-must-not-cross-boundary", test.account, publishRequest("launch"))
			if test.wantErr != nil {
				require.ErrorIs(t, err, test.wantErr)
				require.Empty(t, api.requests)
				return
			}
			require.NoError(t, err)
			require.Len(t, api.requests, 1)
		})
	}
}

func repeatMedia(count int) []platform.UploadMediaRequest {
	result := make([]platform.UploadMediaRequest, count)
	for index := range result {
		result[index] = mediaInput("image/jpeg", 1)
	}
	return result
}

func receiptMessageIDs(rows []models.TelegramPublishReceipt) []string {
	result := make([]string, len(rows))
	for index := range rows {
		result[index] = rows[index].MessageID
	}
	return result
}
