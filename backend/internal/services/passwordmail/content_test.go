package passwordmail

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNotificationContentRejectsUnsafeURLsAndHeaderInjection(t *testing.T) {
	_, err := notificationContent(notificationMessage{
		Title: "Publish failed\r\nBcc: target@example.com", ActionURL: "javascript:alert(1)",
	})
	require.Error(t, err)

	content, err := notificationContent(notificationMessage{Title: "Publish failed\r\nBcc: target@example.com"})
	require.NoError(t, err)
	require.False(t, strings.ContainsAny(content.Subject, "\r\n"))
}
