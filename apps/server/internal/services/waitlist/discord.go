package waitlist

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

func (s *Service) notifyDiscord(ctx context.Context, item entry) error {
	if s.webhookURL == "" {
		return errors.New("waitlist Discord webhook is not configured")
	}
	body, err := json.Marshal(map[string]any{
		"username":         "OpenPost waitlist",
		"allowed_mentions": map[string]any{"parse": []string{}},
		"embeds": []map[string]any{{
			"title":       "New Hosted waitlist signup",
			"description": item.Email,
			"timestamp":   item.CreatedAt.Format(time.RFC3339),
		}},
	})
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, s.webhookURL, bytes.NewReader(body))
	if err != nil {
		return errors.New("invalid waitlist Discord webhook")
	}
	request.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 8 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		// HTTP errors can include the webhook token. Keep it out of job errors.
		return errors.New("waitlist Discord webhook is unavailable")
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("waitlist Discord webhook returned HTTP %d", response.StatusCode)
	}
	return nil
}
