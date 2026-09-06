package feedback

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
)

type DiscordDestination struct {
	webhookURL string
	client     *http.Client
}

type discordWebhookPayload struct {
	Username string         `json:"username,omitempty"`
	Embeds   []discordEmbed `json:"embeds"`
}

type discordEmbed struct {
	Title       string              `json:"title"`
	Description string              `json:"description"`
	Fields      []discordEmbedField `json:"fields,omitempty"`
}

type discordEmbedField struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline,omitempty"`
}

func (d *DiscordDestination) Deliver(ctx context.Context, report Report) error {
	payload := discordWebhookPayload{
		Username: "OpenPost feedback",
		Embeds: []discordEmbed{{
			Title:       strings.ToUpper(report.Category[:1]) + report.Category[1:] + " report",
			Description: report.Message,
			Fields: []discordEmbedField{
				{Name: "OpenPost version", Value: report.AppVersion, Inline: true},
				{Name: "User", Value: report.UserID, Inline: true},
				{Name: "Received", Value: report.CreatedAt, Inline: true},
			},
		}},
	}
	if report.Diagnostics != nil {
		summary, _ := json.Marshal(report.Diagnostics)
		value := string(summary)
		if len(value) > 1000 {
			value = value[:1000] + "…"
		}
		payload.Embeds[0].Fields = append(payload.Embeds[0].Fields, discordEmbedField{
			Name:  "Approved diagnostics",
			Value: "```json\n" + value + "\n```",
		})
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return errors.New("failed to encode feedback destination payload")
	}

	var body io.Reader = bytes.NewReader(payloadJSON)
	contentType := "application/json"
	if report.Screenshot != nil {
		screenshot, err := base64.StdEncoding.DecodeString(report.Screenshot.Data)
		if err != nil {
			return errors.New("invalid feedback screenshot")
		}
		var multipartBody bytes.Buffer
		writer := multipart.NewWriter(&multipartBody)
		if err := writer.WriteField("payload_json", string(payloadJSON)); err != nil {
			return errors.New("failed to encode feedback destination payload")
		}
		extension := "png"
		if report.Screenshot.MIMEType == "image/jpeg" {
			extension = "jpg"
		}
		part, err := writer.CreateFormFile("files[0]", "openpost-feedback."+extension)
		if err != nil {
			return errors.New("failed to encode feedback screenshot")
		}
		if _, err := part.Write(screenshot); err != nil {
			return errors.New("failed to encode feedback screenshot")
		}
		if err := writer.Close(); err != nil {
			return errors.New("failed to finish feedback payload")
		}
		body = &multipartBody
		contentType = writer.FormDataContentType()
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, d.webhookURL, body)
	if err != nil {
		return errors.New("failed to create feedback destination request")
	}
	request.Header.Set("Content-Type", contentType)
	response, err := d.client.Do(request)
	if err != nil {
		return errors.New("feedback destination is unavailable")
	}
	defer response.Body.Close()
	_, _ = io.CopyN(io.Discard, response.Body, 8192)
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("feedback destination returned HTTP %d", response.StatusCode)
	}
	return nil
}
