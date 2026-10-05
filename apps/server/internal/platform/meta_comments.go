package platform

import (
	"errors"
	"net/http"
)

// Comment reads retain Meta recovery codes and treat unavailable targets as missing.
func metaCommentReadError(requestErr error) error {
	err := normalizeMetaPublishError(requestErr)
	var providerErr *HTTPError
	if errors.As(err, &providerErr) && providerErr.Code == metaUnavailableTargetCode {
		// A read cannot distinguish a missing target from one hidden by the provider.
		// Use unavailable-target backoff without changing publish rejection behavior.
		providerErr.StatusCode = http.StatusNotFound
	}
	return err
}
