package platform

import (
	"encoding/json"
	"errors"
	"net/http"
)

// Meta's comment endpoints report permission and token failures as HTTP 400,
// and may embed the same error envelope in a successful HTTP response.
func metaCommentReadError(body []byte, requestErr error) error {
	if requestErr == nil {
		var envelope struct {
			Error json.RawMessage `json:"error"`
		}
		if json.Unmarshal(body, &envelope) != nil || len(envelope.Error) == 0 || string(envelope.Error) == "null" {
			return nil
		}
		requestErr = NewHTTPError(http.StatusBadRequest, nil, body)
	}
	err := normalizeMetaPublishError(requestErr)
	var providerErr *HTTPError
	if errors.As(err, &providerErr) && providerErr.Code == metaUnavailableTargetCode {
		// A read cannot distinguish a missing target from one hidden by the provider.
		// Use unavailable-target backoff without changing publish rejection behavior.
		providerErr.StatusCode = http.StatusNotFound
	}
	return err
}
