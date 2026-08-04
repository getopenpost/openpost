package passwordmail

import (
	"fmt"
	"html"
	"regexp"
	"strings"
	"time"
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
