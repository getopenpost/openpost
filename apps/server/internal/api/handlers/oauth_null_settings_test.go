package handlers

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestLegacyMessagingUpdateAcceptsNullCapabilityState(t *testing.T) {
	for _, state := range []string{"null", "{}", `{"custom":"preserved"}`} {
		t.Run(state, func(t *testing.T) {
			e, handler := newNormServer(t, nil)
			handler.SetAccountFeaturesService(nil)
			api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
			handler.UpdateAccount(api)
			_, err := handler.db.NewInsert().Model(&models.SocialAccount{
				ID: "account-null", WorkspaceID: "ws-1", Platform: "facebook", AccountID: "page-1",
				Slug: "facebook", AccessTokenEnc: []byte("test-token"), IsActive: true, CapabilityState: state,
			}).Exec(t.Context())
			require.NoError(t, err)
			require.NotPanics(t, func() {
				response := oauthSelectionRequest(t, e, http.MethodPatch, "/api/v1/accounts/account-null", map[string]any{"slug": "facebook", "messages_enabled": false}, true)
				require.Equal(t, http.StatusOK, response.Code, response.Body.String())
			})
			var account models.SocialAccount
			require.NoError(t, handler.db.NewSelect().Model(&account).Where("id = ?", "account-null").Scan(t.Context()))
			var saved map[string]string
			require.NoError(t, json.Unmarshal([]byte(account.CapabilityState), &saved))
			require.Equal(t, "false", saved["messages_enabled"])
			if state != "null" && state != "{}" {
				require.Equal(t, "preserved", saved["custom"])
			}
		})
	}
}
