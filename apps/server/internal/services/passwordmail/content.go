package passwordmail

import (
	"fmt"
	"html"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/openpost/backend/internal/services/transactionalmail"
)

var verificationCodePattern = regexp.MustCompile(`^[0-9]{6}$`)

type messageContent struct {
	Subject string
	Text    string
	HTML    string
}

func resetContent(message ResetMessage) (messageContent, error) {
	resetURL := strings.TrimSpace(message.ResetURL)
	if resetURL == "" {
		return messageContent{}, fmt.Errorf("password reset URL is required")
	}
	expires := message.ExpiresAt.UTC().Format(time.RFC1123)
	text := "A password reset was requested for your OpenPost account.\n\n" +
		"Open this link to choose a new password:\n" + resetURL + "\n\n" +
		"This single-use link expires at " + expires + ".\n" +
		"If you did not request this change, you can ignore this email.\n"
	htmlBody := `<p>A password reset was requested for your OpenPost account.</p>` +
		`<p><a href="` + html.EscapeString(resetURL) + `">Choose a new password</a></p>` +
		`<p>This single-use link expires at ` + html.EscapeString(expires) + `.</p>` +
		`<p>If you did not request this change, you can ignore this email.</p>`
	return messageContent{Subject: "Reset your OpenPost password", Text: text, HTML: htmlBody}, nil
}

func verificationContent(message VerificationMessage) (messageContent, error) {
	code := strings.TrimSpace(message.Code)
	if !verificationCodePattern.MatchString(code) {
		return messageContent{}, fmt.Errorf("email verification code must contain six digits")
	}
	expires := message.ExpiresAt.UTC().Format(time.RFC1123)
	text := "Use this code to verify your OpenPost email address:\n\n" + code + "\n\n" +
		"This code expires at " + expires + ".\n" +
		"If you did not create an OpenPost account, you can ignore this email.\n"
	htmlBody := `<p>Use this code to verify your OpenPost email address:</p>` +
		`<p style="font-size:32px;font-weight:700;letter-spacing:0.2em">` + code + `</p>` +
		`<p>This code expires at ` + html.EscapeString(expires) + `.</p>` +
		`<p>If you did not create an OpenPost account, you can ignore this email.</p>`
	return messageContent{Subject: "Verify your OpenPost email", Text: text, HTML: htmlBody}, nil
}

func notificationContent(message notificationMessage) (messageContent, error) {
	title := strings.Join(strings.Fields(strings.TrimSpace(message.Title)), " ")
	if title == "" {
		return messageContent{}, fmt.Errorf("notification title is required")
	}
	if len([]rune(title)) > 160 {
		return messageContent{}, fmt.Errorf("notification title must not exceed 160 characters")
	}
	body := strings.TrimSpace(message.Body)
	if len([]rune(body)) > 2_000 {
		return messageContent{}, fmt.Errorf("notification body must not exceed 2000 characters")
	}
	actionURL, err := absoluteHTTPURL(message.ActionURL)
	if err != nil {
		return messageContent{}, fmt.Errorf("invalid notification action URL: %w", err)
	}
	preferencesURL, err := absoluteHTTPURL(message.PreferencesURL)
	if err != nil {
		return messageContent{}, fmt.Errorf("invalid notification preferences URL: %w", err)
	}

	textParts := []string{title}
	if body != "" {
		textParts = append(textParts, body)
	}
	if actionURL != "" {
		textParts = append(textParts, "Review in OpenPost:\n"+actionURL)
	}
	if preferencesURL != "" {
		textParts = append(textParts, "Manage notification preferences:\n"+preferencesURL)
	}

	htmlParts := []string{`<h1 style="font-size:20px;line-height:1.35">` + html.EscapeString(title) + `</h1>`}
	if body != "" {
		htmlParts = append(htmlParts, `<p>`+html.EscapeString(body)+`</p>`)
	}
	if actionURL != "" {
		htmlParts = append(htmlParts, `<p><a href="`+html.EscapeString(actionURL)+`">Review in OpenPost</a></p>`)
	}
	if preferencesURL != "" {
		htmlParts = append(htmlParts, `<p style="font-size:12px"><a href="`+
			html.EscapeString(preferencesURL)+`">Manage notification preferences</a></p>`)
	}

	return messageContent{
		Subject: "OpenPost: " + title,
		Text:    strings.Join(textParts, "\n\n") + "\n",
		HTML:    strings.Join(htmlParts, ""),
	}, nil
}

func workspaceInvitationContent(message transactionalmail.WorkspaceInvitationMessage) (messageContent, error) {
	workspaceName := strings.Join(strings.Fields(strings.TrimSpace(message.WorkspaceName)), " ")
	if workspaceName == "" {
		return messageContent{}, fmt.Errorf("workspace name is required")
	}
	inviterName := strings.Join(strings.Fields(strings.TrimSpace(message.InviterName)), " ")
	if inviterName == "" {
		return messageContent{}, fmt.Errorf("workspace invitation inviter is required")
	}
	role := strings.ToLower(strings.TrimSpace(message.Role))
	roleLabel := map[string]string{"admin": "Administrator", "editor": "Editor", "viewer": "Viewer"}[role]
	if roleLabel == "" {
		return messageContent{}, fmt.Errorf("workspace invitation role is invalid")
	}
	acceptURL, err := absoluteHTTPURL(message.AcceptURL)
	if err != nil || acceptURL == "" {
		return messageContent{}, fmt.Errorf("invalid workspace invitation acceptance URL")
	}
	if message.ExpiresAt.IsZero() {
		return messageContent{}, fmt.Errorf("workspace invitation expiry is required")
	}
	expires := message.ExpiresAt.UTC().Format(time.RFC1123)
	subject := "You are invited to " + workspaceName + " on OpenPost"
	text := inviterName + " invited you to join " + workspaceName + " on OpenPost.\n\n" +
		"Role: " + roleLabel + "\n" +
		"Accept the invitation:\n" + acceptURL + "\n\n" +
		"This single-use link expires at " + expires + ".\n" +
		"If you were not expecting this invitation, you can ignore this email.\n"
	htmlBody := `<p><strong>` + html.EscapeString(inviterName) + `</strong> invited you to join <strong>` +
		html.EscapeString(workspaceName) + `</strong> on OpenPost.</p>` +
		`<p>Role: ` + html.EscapeString(roleLabel) + `</p>` +
		`<p><a href="` + html.EscapeString(acceptURL) + `">Accept invitation</a></p>` +
		`<p>This single-use link expires at ` + html.EscapeString(expires) + `.</p>` +
		`<p>If you were not expecting this invitation, you can ignore this email.</p>`
	return messageContent{Subject: subject, Text: text, HTML: htmlBody}, nil
}

func absoluteHTTPURL(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	parsed, err := url.Parse(value)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil {
		return "", fmt.Errorf("URL must be absolute HTTP or HTTPS")
	}
	return parsed.String(), nil
}
