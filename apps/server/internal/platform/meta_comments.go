package platform

import (
	"encoding/json"
	"net/http"
)

// Meta's comment endpoints report permission and token failures as HTTP 400,
// and may embed the same error envelope in a successful HTTP response.
func metaCommentReadError(body []byte, requestErr error) error {
	if requestErr != nil {
		return normalizeMetaPublishError(requestErr)
	}
	var envelope struct {
		Error json.RawMessage `json:"error"`
	}
	if json.Unmarshal(body, &envelope) != nil || len(envelope.Error) == 0 || string(envelope.Error) == "null" {
		return nil
	}
	return normalizeMetaPublishError(NewHTTPError(http.StatusBadRequest, nil, body))
}
