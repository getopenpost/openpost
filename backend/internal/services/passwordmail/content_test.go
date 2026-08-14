package passwordmail

import (
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/services/transactionalmail"
	"github.com/stretchr/testify/require"
)

func TestWorkspaceInvitationContentIncludesExactAccessFactsAndEscapesValues(t *testing.T) {
	expiresAt := time.Date(2026, 8, 21, 12, 0, 0, 0, time.UTC)
	content, err := workspaceInvitationContent(transactionalmail.WorkspaceInvitationMessage{
		WorkspaceName: "Launch <team>", InviterName: "Ada & Grace", Role: "editor",
		AcceptURL: "https://app.openpost.test/invite?token=op_inv_secret&source=email",
		ExpiresAt: expiresAt,
	})
	require.NoError(t, err)
	require.Equal(t, "You are invited to Launch <team> on OpenPost", content.Subject)
	require.Contains(t, content.Text, "Ada & Grace invited you")
	require.Contains(t, content.Text, "Role: Editor")
	require.Contains(t, content.Text, expiresAt.Format(time.RFC1123))
	require.Contains(t, content.HTML, "Launch &lt;team&gt;")
	require.Contains(t, content.HTML, "token=op_inv_secret&amp;source=email")
	require.NotContains(t, content.HTML, "<team>")
}

func TestWorkspaceInvitationContentRejectsUnsafeOrIncompleteFacts(t *testing.T) {
	valid := transactionalmail.WorkspaceInvitationMessage{
		WorkspaceName: "Launch", InviterName: "Ada", Role: "viewer",
		AcceptURL: "https://app.openpost.test/invite?token=secret",
		ExpiresAt: time.Now().UTC().Add(time.Hour),
	}
	for _, mutate := range []func(*transactionalmail.WorkspaceInvitationMessage){
		func(message *transactionalmail.WorkspaceInvitationMessage) { message.WorkspaceName = "" },
		func(message *transactionalmail.WorkspaceInvitationMessage) { message.InviterName = "" },
		func(message *transactionalmail.WorkspaceInvitationMessage) { message.Role = "owner" },
		func(message *transactionalmail.WorkspaceInvitationMessage) { message.AcceptURL = "javascript:alert(1)" },
		func(message *transactionalmail.WorkspaceInvitationMessage) { message.ExpiresAt = time.Time{} },
	} {
		message := valid
		mutate(&message)
		_, err := workspaceInvitationContent(message)
		require.Error(t, err)
	}
}

func TestNotificationContentEscapesUserVisibleValues(t *testing.T) {
	content, err := notificationContent(NotificationMessage{
		Title:          "Publish <failed>",
		Body:           "A destination returned <script>alert(1)</script>.",
		ActionURL:      "https://app.openpost.test/activity?publication=one&view=failed",
		PreferencesURL: "https://app.openpost.test/settings?tab=notifications",
	})
	require.NoError(t, err)
	require.Equal(t, "OpenPost: Publish <failed>", content.Subject)
	require.Contains(t, content.HTML, "Publish &lt;failed&gt;")
	require.NotContains(t, content.HTML, "<script>")
	require.Contains(t, content.HTML, "publication=one&amp;view=failed")
	require.Contains(t, content.Text, "Manage notification preferences")
}

func TestNotificationContentRejectsUnsafeURLsAndHeaderInjection(t *testing.T) {
	_, err := notificationContent(NotificationMessage{
		Title: "Publish failed\r\nBcc: target@example.com", ActionURL: "javascript:alert(1)",
	})
	require.Error(t, err)

	content, err := notificationContent(NotificationMessage{Title: "Publish failed\r\nBcc: target@example.com"})
	require.NoError(t, err)
	require.False(t, strings.ContainsAny(content.Subject, "\r\n"))
}
