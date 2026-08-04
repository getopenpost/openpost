package passwordmail

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

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
